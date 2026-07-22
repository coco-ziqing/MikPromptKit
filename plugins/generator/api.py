"""
com.promptkit.generator API 路由 v1.0.0 — 角色肖像生成
挂载前缀: /api/plugins/com.promptkit.generator/

功能:
  参数预设 CRUD / 提交生成任务(SSE流式) / 生成历史 / 词卡关联 / 角色组装器关联
"""
import json, os, sqlite3, time, asyncio, threading, copy
from fastapi import APIRouter, HTTPException, Query, Body, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import httpx

router = APIRouter(tags=["角色生成"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(_PROJECT_ROOT, "data", "prompts.db")
GEN_RESULTS_DIR = os.path.join(_PROJECT_ROOT, "data", "generator_results")
THUMB_DIR = os.path.join(_PROJECT_ROOT, "data", "thumbnails")

# 确保结果目录存在
os.makedirs(GEN_RESULTS_DIR, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)

# 导入参数引擎
from param_engine import (
    PARAM_SCHEMA, ASPECT_RATIOS, compose_prompt,
    get_default_params, params_to_summary
)

# ============================================================
# DB 工具
# ============================================================

def _rw():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    return conn

def _ro():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    return conn

def _safe_commit(db, max_retries=5):
    for i in range(max_retries):
        try:
            db.commit()
            return
        except sqlite3.OperationalError:
            if i == max_retries - 1: raise
            time.sleep(0.05 * (i + 1))

def _get_user_id(request: Request) -> int:
    """从 request.state 获取当前用户 ID，匿名返回 0"""
    try:
        uid = getattr(request.state, "user_id", None)
        return uid if uid else 0
    except:
        return 0

# ============================================================
# Pydantic 模型
# ============================================================

class PresetSave(BaseModel):
    name: str
    params_json: dict = {}
    aspect_ratio: str = "1:1"
    character_id: Optional[int] = None
    description: str = ""
    is_public: int = 0

class GenerateRequest(BaseModel):
    params_json: dict = {}
    aspect_ratio: str = "1:1"
    character_id: Optional[int] = None
    preset_id: Optional[int] = None
    note: str = ""

class BatchGenerateRequest(BaseModel):
    variations: list  # [{params_json, aspect_ratio, note}]
    base_params: dict = {}

class HistoryUpdate(BaseModel):
    rating: Optional[int] = None
    tags: Optional[list] = None
    note: Optional[str] = None

# ============================================================
# 1. 参数预设管理
# ============================================================

@router.get("/presets")
def list_presets(request: Request):
    db = _ro()
    uid = _get_user_id(request)
    rows = db.execute(
        """SELECT * FROM generator_character_presets 
           WHERE user_id = ? OR (is_public = 1) 
           ORDER BY updated_at DESC""",
        [uid]
    ).fetchall()
    return {"ok": True, "presets": [dict(r) for r in rows]}

@router.get("/presets/{pid}")
def get_preset(pid: int):
    db = _ro()
    row = db.execute("SELECT * FROM generator_character_presets WHERE id=?", [pid]).fetchone()
    if not row:
        return {"ok": False, "error": "预设不存在"}
    return {"ok": True, "preset": dict(row)}

@router.post("/presets")
def create_preset(data: PresetSave, request: Request):
    uid = _get_user_id(request)
    db = _rw()
    cursor = db.execute(
        """INSERT INTO generator_character_presets 
           (user_id, name, description, params_json, aspect_ratio, character_id, is_public)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [uid, data.name, data.description, json.dumps(data.params_json, ensure_ascii=False),
         data.aspect_ratio, data.character_id, data.is_public]
    )
    _safe_commit(db)
    return {"ok": True, "id": cursor.lastrowid}

@router.put("/presets/{pid}")
def update_preset(pid: int, data: PresetSave):
    db = _rw()
    db.execute(
        """UPDATE generator_character_presets 
           SET name=?, params_json=?, aspect_ratio=?, character_id=?, 
               description=?, is_public=?, updated_at=datetime('now','localtime')
           WHERE id=?""",
        [data.name, json.dumps(data.params_json, ensure_ascii=False),
         data.aspect_ratio, data.character_id, data.description, data.is_public, pid]
    )
    _safe_commit(db)
    return {"ok": True}

@router.delete("/presets/{pid}")
def delete_preset(pid: int):
    db = _rw()
    db.execute("DELETE FROM generator_character_presets WHERE id=?", [pid])
    _safe_commit(db)
    return {"ok": True}

# ============================================================
# 2. 参数/比例定义（前端渲染用）
# ============================================================

@router.get("/schema")
def get_param_schema():
    """返回参数分组定义，前端据此渲染滑块/选择器/色盘"""
    return {"ok": True, "schema": PARAM_SCHEMA, "aspect_ratios": ASPECT_RATIOS}

@router.get("/defaults")
def get_defaults():
    return {"ok": True, "params": get_default_params()}

# ============================================================
# 3. 生成任务提交（SSE 流式）
# ============================================================

# ============================================================
# 生成器专属 ComfyUI 配置 — 与词卡预览工作流完全独立
# ============================================================

GENERATOR_COMFYUI_DEFAULTS = {
    "server_url": "http://127.0.0.1:8188",
    "enabled": False,
    "workflows": [],
    "active_workflow": ""
}

def _get_gen_comfyui_config():
    """获取生成器专属 ComfyUI 配置（不从全局 comfyui_config 读取）"""
    db = _ro()
    row = db.execute("SELECT value FROM config WHERE key='generator_comfyui_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            for k in GENERATOR_COMFYUI_DEFAULTS:
                cfg.setdefault(k, GENERATOR_COMFYUI_DEFAULTS[k])
            return cfg
        except: pass
    return dict(GENERATOR_COMFYUI_DEFAULTS)

def _save_gen_comfyui_config(cfg: dict):
    """保存生成器专属 ComfyUI 配置"""
    db = _rw()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('generator_comfyui_config', ?)",
        [json.dumps(cfg, ensure_ascii=False)]
    )
    _safe_commit(db)

def _find_gen_workflow(cfg: dict):
    """查找生成器活跃的工作流配置"""
    wfs = cfg.get("workflows", [])
    if not wfs: return (None, "")
    active_id = cfg.get("active_workflow", "")
    if active_id:
        for w in wfs:
            if w.get("id") == active_id:
                return (w, w.get("name", ""))
    return (wfs[0], wfs[0].get("name", ""))


# ========== 生成器工作流配置 API ==========

class GenWorkflowConfig(BaseModel):
    config: dict

@router.get("/workflow-config")
def get_workflow_config():
    """获取生成器专属 ComfyUI 配置（与词卡预览独立）"""
    cfg = _get_gen_comfyui_config()
    return {"ok": True, "config": cfg}

@router.post("/workflow-config")
def update_workflow_config(data: GenWorkflowConfig):
    """保存生成器专属 ComfyUI 配置"""
    _save_gen_comfyui_config(data.config)
    return {"ok": True}

@router.post("/workflow-config/import")
async def import_workflow(request: Request):
    """导入 ComfyUI 工作流 JSON 到生成器"""
    body = await request.json()
    workflow_json = body.get("workflow_json")
    name = body.get("name", "角色肖像工作流")
    if not workflow_json:
        return {"ok": False, "error": "missing workflow_json"}
    
    # 检测节点
    text_nodes = []
    latent_nodes = []
    for nid, node in workflow_json.items():
        if node.get("class_type") in ("CLIPTextEncode", "CLIPTextEncodeSDXL"):
            if "text" in node.get("inputs", {}):
                text_nodes.append(nid)
        if node.get("class_type") == "EmptyLatentImage":
            latent_nodes.append(nid)
    
    prompt_node = text_nodes[0] if text_nodes else "6"
    latent_node = latent_nodes[0] if latent_nodes else ""
    
    cfg = _get_gen_comfyui_config()
    wf_id = "gen_wf_" + str(int(time.time() * 1000))
    wf_item = {
        "id": wf_id,
        "name": name,
        "description": f"检测节点: {len(workflow_json)} 个, 提示词节点: {prompt_node}",
        "prompt_node_id": prompt_node,
        "prompt_field": "text",
        "image_output_node_id": "9",
        "latent_node_id": latent_node,
        "workflow_json": workflow_json
    }
    cfg["workflows"].append(wf_item)
    cfg["active_workflow"] = wf_id
    _save_gen_comfyui_config(cfg)
    
    return {"ok": True, "workflow": wf_item}

async def _comfyui_queue_prompt(server_url: str, workflow: dict) -> dict:
    """提交工作流到 ComfyUI，返回 {prompt_id}"""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{server_url}/prompt",
            json={"prompt": workflow}
        )
        resp.raise_for_status()
        return resp.json()

async def _comfyui_wait_result(server_url: str, prompt_id: str, timeout_sec: int = 180) -> dict:
    """轮询 ComfyUI 直到生成完成，返回结果 JSON"""
    start = time.time()
    async with httpx.AsyncClient(timeout=10) as client:
        while time.time() - start < timeout_sec:
            try:
                resp = await client.get(f"{server_url}/history/{prompt_id}")
                data = resp.json()
                if prompt_id in data:
                    outputs = data[prompt_id].get("outputs", {})
                    if outputs:
                        return {"ok": True, "outputs": outputs, "history": data[prompt_id]}
            except Exception:
                pass
            await asyncio.sleep(2)
    return {"ok": False, "error": "生成超时"}

async def _download_result(server_url: str, filename: str, subfolder: str = "", folder_type: str = "output"):
    """从 ComfyUI 下载生成结果图片"""
    params = {"filename": filename, "subfolder": subfolder, "type": folder_type}
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(f"{server_url}/view", params=params)
        resp.raise_for_status()
        return resp.content

def _save_and_thumb(img_bytes: bytes, job_id: int) -> tuple:
    """保存原图 + 生成缩略图，返回 (result_path, thumb_path)"""
    import io
    from PIL import Image

    result_path = os.path.join(GEN_RESULTS_DIR, f"gen_{job_id}.png")
    thumb_path = os.path.join(THUMB_DIR, f"gen_{job_id}_thumb.jpg")

    with open(result_path, "wb") as f:
        f.write(img_bytes)

    try:
        img = Image.open(io.BytesIO(img_bytes))
        img.thumbnail((400, 400), Image.LANCZOS)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(thumb_path, "JPEG", quality=85)
    except:
        thumb_path = ""

    return result_path, thumb_path


@router.post("/generate")
async def submit_generation(data: GenerateRequest, request: Request):
    """提交生成任务 → SSE 流式推送进度和结果"""
    uid = _get_user_id(request)
    params = data.params_json or get_default_params()
    prompt_text = compose_prompt(params, data.aspect_ratio)

    # 获取生成器专属 ComfyUI 配置（与词卡预览工作流独立）
    cfg = _get_gen_comfyui_config()
    if not cfg.get("enabled"):
        return {"ok": False, "error": "生成工作流未启用，请在生成面板中配置并启用 ComfyUI 工作流"}

    wf_cfg, wf_name = _find_gen_workflow(cfg)
    if not wf_cfg or not wf_cfg.get("workflow_json"):
        return {"ok": False, "error": "未配置生成用工作流，请先导入角色肖像专用 ComfyUI 工作流 JSON"}

    server_url = cfg["server_url"].rstrip("/")
    workflow_template = copy.deepcopy(wf_cfg["workflow_json"])
    node_id = wf_cfg.get("prompt_node_id", "6")
    field = wf_cfg.get("prompt_field", "text")

    # 注入提示词到工作流
    prompt_node = str(node_id)
    if prompt_node in workflow_template:
        if "inputs" in workflow_template[prompt_node]:
            workflow_template[prompt_node]["inputs"][field] = prompt_text

    # 如果用户指定了作品比例，尝试注入宽高
    ar_def = next((a for a in ASPECT_RATIOS if a["value"] == data.aspect_ratio), None)
    if ar_def:
        # 找 EmptyLatentImage 节点注入尺寸
        for nid, node in workflow_template.items():
            if node.get("class_type") == "EmptyLatentImage":
                if "inputs" in node:
                    node["inputs"]["width"] = ar_def["width"]
                    node["inputs"]["height"] = ar_def["height"]
                break

    db = _rw()
    # 先创建 job 记录
    summary = params_to_summary(params)
    job_desc = f"{summary} [{data.aspect_ratio}]"
    cursor = db.execute(
        """INSERT INTO generator_jobs 
           (user_id, preset_id, character_id, prompt_text, params_json,
            workflow_id, status, note, aspect_ratio)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)""",
        [uid, data.preset_id, data.character_id, prompt_text,
         json.dumps(params, ensure_ascii=False),
         wf_cfg.get("id", ""), data.note, data.aspect_ratio]
    )
    _safe_commit(db)
    job_id = cursor.lastrowid

    async def event_stream():
        try:
            # 状态更新 → generating
            db2 = _rw()
            db2.execute("UPDATE generator_jobs SET status='generating' WHERE id=?", [job_id])
            _safe_commit(db2)

            yield f"data: {json.dumps({'type': 'status', 'job_id': job_id, 'status': 'generating', 'prompt': prompt_text[:200]}, ensure_ascii=False)}\n\n"

            # 提交 ComfyUI
            try:
                result = await _comfyui_queue_prompt(server_url, workflow_template)
                comfy_id = result.get("prompt_id", "")
            except Exception as e:
                db3 = _rw()
                db3.execute("UPDATE generator_jobs SET status='failed', error_message=? WHERE id=?",
                           [f"ComfyUI 连接失败: {str(e)}", job_id])
                _safe_commit(db3)
                yield f"data: {json.dumps({'type': 'error', 'job_id': job_id, 'error': str(e)}, ensure_ascii=False)}\n\n"
                return

            yield f"data: {json.dumps({'type': 'status', 'job_id': job_id, 'status': 'queued', 'comfyui_job': comfy_id}, ensure_ascii=False)}\n\n"

            # 等待结果
            result = await _comfyui_wait_result(server_url, comfy_id)

            if not result.get("ok"):
                db3 = _rw()
                db3.execute("UPDATE generator_jobs SET status='failed', error_message=? WHERE id=?",
                           [result.get("error", "未知错误"), job_id])
                _safe_commit(db3)
                yield f"data: {json.dumps({'type': 'error', 'job_id': job_id, 'error': result.get('error', '生成超时')}, ensure_ascii=False)}\n\n"
                return

            # 下载第一张输出图片
            img_bytes = None
            outputs = result.get("outputs", {})
            for node_out_id, node_outputs in outputs.items():
                images = node_outputs.get("images", [])
                if images:
                    img_info = images[0]
                    try:
                        img_bytes = await _download_result(
                            server_url,
                            img_info["filename"],
                            img_info.get("subfolder", ""),
                            img_info.get("type", "output")
                        )
                    except:
                        continue
                    if img_bytes:
                        break

            if not img_bytes:
                db3 = _rw()
                db3.execute("UPDATE generator_jobs SET status='failed', error_message='未获取到生成图片' WHERE id=?", [job_id])
                _safe_commit(db3)
                yield f"data: {json.dumps({'type': 'error', 'job_id': job_id, 'error': '未获取到生成图片'}, ensure_ascii=False)}\n\n"
                return

            # 保存图片
            result_path, thumb_path = _save_and_thumb(img_bytes, job_id)

            # 更新数据库
            now = time.strftime("%Y-%m-%d %H:%M:%S")
            db4 = _rw()
            db4.execute(
                """UPDATE generator_jobs 
                   SET status='done', result_path=?, thumb_path=?, 
                       comfyui_job_id=?, duration_ms=?
                   WHERE id=?""",
                [result_path, thumb_path, comfy_id,
                 int((time.time() - (result.get("history", {}).get("status", {}).get("status", {}).get("start_time", time.time())) * 1000)),
                 job_id]
            )
            _safe_commit(db4)

            yield f"data: {json.dumps({'type': 'done', 'job_id': job_id, 'thumb_path': f'/api/plugins/com.promptkit.generator/generate/{job_id}/thumb'}, ensure_ascii=False)}\n\n"

        except Exception as e:
            db5 = _rw()
            db5.execute("UPDATE generator_jobs SET status='failed', error_message=? WHERE id=?",
                       [str(e), job_id])
            _safe_commit(db5)
            yield f"data: {json.dumps({'type': 'error', 'job_id': job_id, 'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/generate/{job_id}")
def get_job_status(job_id: int):
    db = _ro()
    row = db.execute("SELECT * FROM generator_jobs WHERE id=?", [job_id]).fetchone()
    if not row:
        return {"ok": False, "error": "生成任务不存在"}
    return {"ok": True, "job": dict(row)}


@router.get("/generate/{job_id}/thumb")
def get_job_thumb(job_id: int):
    """返回缩略图文件"""
    from fastapi.responses import FileResponse
    thumb_path = os.path.join(THUMB_DIR, f"gen_{job_id}_thumb.jpg")
    if os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/jpeg")
    # 回退：尝试原图
    result_path = os.path.join(GEN_RESULTS_DIR, f"gen_{job_id}.png")
    if os.path.exists(result_path):
        return FileResponse(result_path, media_type="image/png")
    raise HTTPException(404, "图片不存在")


@router.get("/generate/{job_id}/image")
def get_job_image(job_id: int):
    from fastapi.responses import FileResponse
    result_path = os.path.join(GEN_RESULTS_DIR, f"gen_{job_id}.png")
    if os.path.exists(result_path):
        return FileResponse(result_path, media_type="image/png")
    raise HTTPException(404, "图片不存在")

# ============================================================
# 4. 生成历史
# ============================================================

@router.get("/history")
def list_history(request: Request, page: int = 1, limit: int = 20, status: str = ""):
    uid = _get_user_id(request)
    db = _ro()
    where = "WHERE user_id = ?"
    args = [uid]
    if status:
        where += " AND status = ?"
        args.append(status)
    
    offset = (page - 1) * limit
    rows = db.execute(
        f"SELECT id, preset_id, character_id, prompt_text, status, thumb_path, "
        f"result_path, duration_ms, rating, tags, note, aspect_ratio, error_message, "
        f"created_at FROM generator_jobs {where} "
        f"ORDER BY created_at DESC LIMIT ? OFFSET ?",
        args + [limit, offset]
    ).fetchall()
    
    count = db.execute(f"SELECT COUNT(*) as cnt FROM generator_jobs {where}", args).fetchone()["cnt"]
    
    return {
        "ok": True,
        "jobs": [dict(r) for r in rows],
        "total": count,
        "page": page,
        "pages": (count + limit - 1) // limit
    }


@router.patch("/history/{job_id}")
def update_history(job_id: int, data: HistoryUpdate):
    db = _rw()
    updates = []
    vals = []
    if data.rating is not None:
        updates.append("rating = ?")
        vals.append(data.rating)
    if data.tags is not None:
        updates.append("tags = ?")
        vals.append(json.dumps(data.tags, ensure_ascii=False))
    if data.note is not None:
        updates.append("note = ?")
        vals.append(data.note)
    if updates:
        vals.append(job_id)
        db.execute(f"UPDATE generator_jobs SET {', '.join(updates)} WHERE id=?", vals)
        _safe_commit(db)
    return {"ok": True}


@router.delete("/history/{job_id}")
def delete_history(job_id: int):
    # 删除图片文件
    result_path = os.path.join(GEN_RESULTS_DIR, f"gen_{job_id}.png")
    thumb_path = os.path.join(THUMB_DIR, f"gen_{job_id}_thumb.jpg")
    for p in [result_path, thumb_path]:
        if os.path.exists(p):
            try: os.remove(p)
            except: pass
    db = _rw()
    db.execute("DELETE FROM generator_jobs WHERE id=?", [job_id])
    _safe_commit(db)
    return {"ok": True}


@router.post("/history/{job_id}/archive")
def archive_result(job_id: int):
    """将生成结果归档到项目资产库"""
    db = _rw()
    row = db.execute("SELECT * FROM generator_jobs WHERE id=?", [job_id]).fetchone()
    if not row:
        return {"ok": False, "error": "记录不存在"}
    if not row["result_path"]:
        return {"ok": False, "error": "没有可归档的图片"}

    # 入库到 asset_catalog（如果有项目关联）
    char_id = row["character_id"]
    result_path = row["result_path"]
    
    try:
        from database import get_db, safe_commit as sc
        db2 = get_db()
        # 获取角色信息
        char_name = "未命名角色"
        if char_id:
            c_row = db2.execute("SELECT name FROM character_profiles WHERE id=?", [char_id]).fetchone()
            if c_row: char_name = c_row["name"]
        
        cursor = db2.execute(
            """INSERT INTO asset_catalog 
               (name, module_key, is_critical, status, created_at)
               VALUES (?, 'image', 1, 'active', datetime('now','localtime'))""",
            [f"生成-{char_name}-{job_id}"]
        )
        sc()
        asset_id = cursor.lastrowid

        # 更新 job 记录
        db.execute(
            "UPDATE generator_jobs SET is_archived=1, archived_asset_id=? WHERE id=?",
            [asset_id, job_id]
        )
        _safe_commit(db)

        return {"ok": True, "asset_id": asset_id}
    except Exception as e:
        return {"ok": False, "error": f"归档失败: {str(e)}"}

# ============================================================
# 5. 词卡关联
# ============================================================

@router.get("/wordcards")
def get_character_wordcards():
    """获取角色相关的词卡分组（从 word_card_group 中筛选角色相关）"""
    db = _ro()
    # 查找角色相关的分组
    char_groups = db.execute(
        """SELECT wcg.id, wcg.name, wcg.description, wcg.sort_order,
                  (SELECT COUNT(*) FROM word_card wc WHERE wc.group_id=wcg.id AND wc.is_deleted=0) as card_count
           FROM word_card_group wcg
           WHERE wcg.name LIKE '%角色%' OR wcg.name LIKE '%char%' OR wcg.name LIKE '%人物%'
              OR wcg.name LIKE '%头发%' OR wcg.name LIKE '%面部%' OR wcg.name LIKE '%五官%'
              OR wcg.name LIKE '%服装%' OR wcg.name LIKE '%表情%' OR wcg.name LIKE '%姿态%'
           ORDER BY wcg.sort_order""").fetchall()
    
    groups = []
    for g in char_groups:
        group = dict(g)
        # 获取该分组的词条列表
        cards = db.execute(
            """SELECT wc.id as card_id, wc.name as title, wc.content
               FROM word_card wc
               WHERE wc.group_id = ? AND wc.is_deleted = 0
               LIMIT 100""",
            [g["id"]]
        ).fetchall()
        group["cards"] = [dict(c) for c in cards]
        groups.append(group)
    
    return {"ok": True, "groups": groups}


@router.post("/wordcards/inject")
def inject_wordcard(data: dict = Body(...)):
    """
    将选中的词条映射为参数。输入: {card_ids: [1,2,3], current_params: {}}
    返回: {merged_params: {}}
    """
    card_ids = data.get("card_ids", [])
    current_params = data.get("current_params", {}) or get_default_params()
    
    if not card_ids:
        return {"ok": True, "params": current_params}
    
    db = _ro()
    cards = db.execute(
        "SELECT wc.id, wc.title, wc.content FROM word_card wc WHERE wc.id IN ({})".format(
            ",".join("?" * len(card_ids))
        ),
        card_ids
    ).fetchall()

    # 智能映射逻辑：根据词条内容关键词推测参数
    keyword_map = {
        # 脸型
        "圆脸": ("face", "face_shape", "round"), "鹅蛋": ("face", "face_shape", "oval"),
        "方脸": ("face", "face_shape", "square"), "长脸": ("face", "face_shape", "long"),
        # 眼型
        "杏眼": ("eyes", "eye_shape", "almond"), "圆眼": ("eyes", "eye_shape", "round"),
        "大眼": ("eyes", "eye_size", 1.3), "小眼": ("eyes", "eye_size", 0.7),
        "单眼皮": ("eyes", "eye_shape", "monolid"),
        # 鼻子
        "高鼻梁": ("eyes", "nose_shape", "straight"), "翘鼻": ("eyes", "nose_shape", "snub"),
        # 发型
        "长发": ("hair", "hair_style", "long_straight"), "短发": ("hair", "hair_style", "short_bob"),
        "卷发": ("hair", "hair_style", "curly"), "马尾": ("hair", "hair_style", "ponytail"),
        "丸子头": ("hair", "hair_style", "bun"),
        # 发色
        "黑发": ("hair", "hair_color", "#1a1a2e"), "金发": ("hair", "hair_color", "#f0e6d3"),
        "银发": ("hair", "hair_color", "#e0e0e0"), "白发": ("hair", "hair_color", "#ffffff"),
        # 表情
        "微笑": ("style", "expression", "smile"), "大笑": ("style", "expression", "big_smile"),
        "害羞": ("style", "expression", "shy"), "愤怒": ("style", "expression", "angry"),
        "惊讶": ("style", "expression", "surprised"), "严肃": ("style", "expression", "serious"),
        # 画风
        "写实": ("style", "art_style", "realistic"), "二次元": ("style", "art_style", "anime"),
        "动漫": ("style", "art_style", "anime"), "油画": ("style", "art_style", "oil_painting"),
        "水彩": ("style", "art_style", "watercolor"),
    }

    merged = copy.deepcopy(current_params)
    matched = 0
    for card in cards:
        text = (card["title"] or "") + " " + (card["content"] or "")
        for keyword, (group_key, param_key, value) in keyword_map.items():
            if keyword in text:
                merged.setdefault(group_key, {})[param_key] = value
                matched += 1

    return {"ok": True, "params": merged, "matched": matched}

# ============================================================
# 6. 角色组装器关联
# ============================================================

@router.get("/characters")
def list_characters():
    """获取所有角色组装器的角色列表"""
    db = _ro()
    rows = db.execute(
        "SELECT id, name, settings_json, template_id, created_at FROM character_profiles ORDER BY updated_at DESC"
    ).fetchall()
    characters = []
    for r in rows:
        c = dict(r)
        try:
            c["settings"] = json.loads(c.get("settings_json", "{}"))
        except:
            c["settings"] = {}
        characters.append(c)
    return {"ok": True, "characters": characters}

@router.post("/characters/load")
def load_character(data: dict = Body(...)):
    """
    从角色组装器加载角色设定到参数面板。
    输入: {character_id: 1}
    返回: {params: {...}, character_name: "xxx"}
    """
    char_id = data.get("character_id")
    if not char_id:
        return {"ok": False, "error": "缺少 character_id"}

    db = _ro()
    row = db.execute(
        "SELECT id, name, settings_json FROM character_profiles WHERE id=?", [char_id]
    ).fetchone()
    if not row:
        return {"ok": False, "error": "角色不存在"}

    try:
        settings = json.loads(row["settings_json"] or "{}")
    except:
        settings = {}

    # 角色组装器维度 → 捏脸参数映射
    field_map = {
        "gender": ("face", None),           # gender 不直接映射到捏脸
        "age": ("face", None),
        "hairstyle": ("hair", "hair_style"),
        "hair_color_field": ("hair", "hair_color"),
        "face_shape": ("face", "face_shape"),
        "eye": ("eyes", "eye_shape"),
        "eye_color": ("eyes", "eye_color"),
        "expression": ("style", "expression"),
        "clothing": ("body", "clothing"),
        "pose": ("body", "pose"),
        "style": ("style", "art_style"),
        "background": ("style", "background_type"),
        "lighting": ("style", "lighting"),
        "mood": ("style", "expression"),
        "makeup": ("eyes", None),
    }

    params = get_default_params()
    for setting_key, (group_key, param_key) in field_map.items():
        if param_key is None: continue
        val = settings.get(setting_key, "")
        if not val: continue
        val = val.strip()

        # 尝试模糊匹配到参数选项值
        param_def = PARAM_SCHEMA.get(group_key, {}).get("params", {}).get(param_key)
        if not param_def: continue
        if param_def.get("type") == "select":
            for opt in param_def.get("options", []):
                opt_label = opt["label"]
                opt_value = opt["value"]
                # 中文匹配
                if val in opt_label or opt_label in val:
                    params.setdefault(group_key, {})[param_key] = opt_value
                    break

    return {
        "ok": True,
        "params": params,
        "character_name": row["name"],
        "character_id": char_id
    }
