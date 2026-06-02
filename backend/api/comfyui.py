"""
ComfyUI 集成 — 发送提示词生成图片并自动收录为缩略图
包含：模块主体预设提示词组合、工作流同步、自动轮询生成
"""
import os, json, uuid, time, io, base64, asyncio, threading, copy
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from database import get_db, safe_commit
import httpx
from PIL import Image

router = APIRouter(prefix="/api/v2/comfyui", tags=["comfyui"])

# 项目根目录: backend/api/comfyui.py -> 上三层到项目根
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

THUMB_DIR = os.path.join(_PROJECT_ROOT, "data", "thumbnails")
ORIGINALS_DIR = os.path.join(_PROJECT_ROOT, "data", "originals")

DEFAULT_CONFIG = {
    "server_url": "http://127.0.0.1:8188",
    "enabled": False,
    "workflows": [],
    "active_workflow": ""
}


def _get_config():
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='comfyui_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            for k in DEFAULT_CONFIG:
                cfg.setdefault(k, DEFAULT_CONFIG[k])
            return cfg
        except Exception:
            pass
    return dict(DEFAULT_CONFIG)


def _save_config(cfg: dict):
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('comfyui_config', ?)",
        [json.dumps(cfg, ensure_ascii=False)]
    )
    db.commit()


# ==================== 模块主体预设提示词 ====================
DEFAULT_STYLE_SUFFIX = "cinematic lighting, high quality, 4k, detailed"

def _get_module_presets():
    """获取所有模块的主体预设提示词"""
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='module_presets'").fetchone()
    if row:
        try:
            return json.loads(row["value"])
        except Exception:
            pass
    return {}


def _save_module_presets(presets: dict):
    """保存模块主体预设提示词"""
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('module_presets', ?)",
        [json.dumps(presets, ensure_ascii=False)]
    )
    db.commit()


def _auto_populate_missing_presets(presets: dict) -> dict:
    """自动补全缺少预设的模块"""
    db = get_db()
    rows = db.execute("SELECT DISTINCT module FROM prompts WHERE is_builtin=1 AND module != '' ORDER BY module").fetchall()
    changed = False
    for r in rows:
        m = r["module"]
        if m not in presets:
            presets[m] = {
                "preset": f"",
                "enabled": False,
                "note": "该模块的共性主体描述，将自动与提示词卡片内容组合"
            }
            changed = True
    if changed:
        _save_module_presets(presets)
    return presets


def _compose_prompt(preset_text: str, card_text: str, style_suffix: str) -> str:
    """自然语言组合规则：预设主体 + 卡片差异 + 品质后缀"""
    parts = []
    if preset_text and preset_text.strip():
        parts.append(preset_text.strip().rstrip(","))
    if card_text and card_text.strip():
        parts.append(card_text.strip().rstrip(","))
    if style_suffix and style_suffix.strip():
        parts.append(style_suffix.strip().rstrip(","))

    # 自然语言编排：用 ", " 连接
    return ", ".join(parts)


class PresetsUpdate(BaseModel):
    presets: dict  # {module_name: {preset: str, enabled: bool}}


@router.get("/module-presets")
def get_module_presets():
    """获取所有模块的主体预设提示词"""
    presets = _get_module_presets()
    presets = _auto_populate_missing_presets(presets)
    # 额外获取模块列表供前端使用
    db = get_db()
    modules = []
    rows = db.execute("SELECT DISTINCT module FROM prompts WHERE module != '' ORDER BY module").fetchall()
    for r in rows:
        modules.append(r["module"])
    return {"ok": True, "presets": presets, "modules": modules, "style_suffix": DEFAULT_STYLE_SUFFIX}


@router.post("/module-presets")
def update_module_presets(data: PresetsUpdate):
    """保存模块主体预设提示词"""
    _save_module_presets(data.presets)
    return {"ok": True}


class ConfigUpdate(BaseModel):
    config: dict


@router.get("/config")
def get_comfyui_config():
    cfg = _get_config()
    return {"ok": True, "config": cfg}


@router.post("/config")
def update_comfyui_config(data: ConfigUpdate):
    _save_config(data.config)
    return {"ok": True}


class GenerateRequest(BaseModel):
    prompt_id: int
    prompt_text: str = ""        # 提示词卡片内容
    workflow_id: str = ""
    module_name: str = ""        # 所属模块，用于取预设
    module_preset: str = ""      # 模块主体预设（可在前端传递）


class SyncRequest(BaseModel):
    server_url: str = ""


class BatchGenerateRequest(BaseModel):
    prompt_ids: list[int]
    workflow_id: str = ""


@router.post("/batch-generate")
async def batch_generate_thumbnail(data: BatchGenerateRequest):
    """批量 AI 生成缩略图 — 逐条排队发送到 ComfyUI，SSE 流式返回，每生成一张即刻推送"""
    cfg = _get_config()
    if not cfg.get("enabled") or not cfg.get("server_url"):
        return {"ok": False, "error": "ComfyUI 未启用或服务器地址未配置"}

    workflow_cfg = None
    for w in cfg.get("workflows", []):
        if w.get("id") == data.workflow_id:
            workflow_cfg = w
            break
    if not workflow_cfg:
        workflow_cfg = cfg.get("workflows", [{}])[0] if cfg.get("workflows") else None
    if not workflow_cfg or not workflow_cfg.get("workflow_json"):
        return {"ok": False, "error": "未找到工作流模板，请先配置"}

    server_url = cfg["server_url"].rstrip("/")
    workflow_template = workflow_cfg["workflow_json"]
    node_id = workflow_cfg.get("prompt_node_id", "6")
    field = workflow_cfg.get("prompt_field", "text")
    presets = _get_module_presets()
    total = len(data.prompt_ids)

    async def event_stream():
        success_count = 0
        error_count = 0
        db = get_db()

        for idx, pid in enumerate(data.prompt_ids):
            row = db.execute("SELECT content, module FROM prompts WHERE id=?", [pid]).fetchone()
            if not row:
                ev = {"prompt_id": pid, "ok": False, "error": "提示词不存在", "index": idx, "total": total}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                error_count += 1
                continue

            card_text = row["content"]
            module_name = row["module"] or ""
            preset_text = ""
            if module_name:
                pm = presets.get(module_name, {})
                if pm.get("enabled") and pm.get("preset"):
                    preset_text = pm["preset"]
            final_prompt = _compose_prompt(preset_text, card_text, DEFAULT_STYLE_SUFFIX)

            wf = copy.deepcopy(workflow_template)
            if node_id in wf and field in wf[node_id]["inputs"]:
                wf[node_id]["inputs"][field] = final_prompt

            try:
                result = await _run_comfyui(server_url, wf, workflow_cfg, final_prompt, pid)
                if result.get("ok"):
                    success_count += 1
                else:
                    error_count += 1
                ev = {"prompt_id": pid, "ok": result.get("ok", False), "thumbnail": result.get("thumbnail"),
                      "thumbnail_url": result.get("thumbnail_url"), "error": result.get("error"),
                      "index": idx, "total": total, "done": idx + 1}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            except Exception as e:
                ev = {"prompt_id": pid, "ok": False, "error": str(e), "index": idx, "total": total, "done": idx + 1}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                error_count += 1

            await asyncio.sleep(0.5)

        # 完成事件
        final = {"complete": True, "total": total, "success": success_count, "errors": error_count}
        yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/sync")
def sync_workflow(data: SyncRequest = None):
    """从 ComfyUI queue/history 自动提取最新工作流并导入 PromptKit 配置"""
    cfg = _get_config()
    server_url = cfg.get("server_url", "http://127.0.0.1:8188").rstrip("/")
    if data and data.server_url:
        server_url = data.server_url.rstrip("/")

    try:
        import httpx
    except ImportError:
        httpx = None

    def _http_get(path):
        if httpx:
            import threading
            result = []
            def _fetch():
                import asyncio
                async def _get():
                    async with httpx.AsyncClient(timeout=10) as c:
                        r = await c.get(f"{server_url}{path}")
                        return r
                loop = asyncio.new_event_loop()
                try:
                    r = loop.run_until_complete(_get())
                    result.append((r.status_code, r.json()))
                except Exception as e:
                    result.append((0, {"error": str(e)}))
                finally:
                    loop.close()
            t = threading.Thread(target=_fetch, daemon=True)
            t.start()
            t.join(timeout=15)
            if result:
                return result[0]
            return (0, {"error": "timeout"})
        else:
            import requests
            try:
                r = requests.get(f"{server_url}{path}", timeout=10)
                return (r.status_code, r.json())
            except Exception as e:
                return (0, {"error": str(e)})

    code, qdata = _http_get("/queue")
    workflow = None
    source = ""

    if code == 200:
        for items, label in [(qdata.get("queue_running", []), "queued_running"),
                             (qdata.get("queue_pending", []), "queued_pending")]:
            if items:
                item = items[0]
                if isinstance(item, (list, tuple)) and len(item) >= 3:
                    wf = item[2]
                    if isinstance(wf, dict) and len(wf) > 3:
                        workflow = wf
                        source = label
                        break

    if not workflow:
        code, hist = _http_get("/history")
        if code == 200 and isinstance(hist, dict) and hist:
            hid = list(hist.keys())[0]
            entry = hist[hid]
            prompt_data = entry.get("prompt", [])
            if isinstance(prompt_data, list) and len(prompt_data) >= 3:
                wf = prompt_data[2]
                if isinstance(wf, dict) and len(wf) > 3:
                    workflow = wf
                    source = f"history"

    if not workflow:
        return {"ok": False, "error": "无法从 ComfyUI 获取工作流。请确保 ComfyUI 正在运行且队列/历史中有任务。"}

    prompt_node_id = None
    prompt_field = None
    candidates = []
    for nid, node in workflow.items():
        ct = node.get("class_type", "")
        inputs = node.get("inputs", {})
        if ct == "CLIPTextEncode" and "text" in inputs:
            candidates.append((nid, "text", inputs.get("text", "")))
    if len(candidates) == 1:
        prompt_node_id, prompt_field = candidates[0][0], candidates[0][1]
    elif len(candidates) > 1:
        non_empty = [(n, f, t) for n, f, t in candidates if t.strip()]
        if non_empty:
            prompt_node_id, prompt_field = non_empty[0][0], non_empty[0][1]
        else:
            prompt_node_id, prompt_field = candidates[0][0], candidates[0][1]

    output_node_id = None
    for nid, node in workflow.items():
        ct = node.get("class_type", "")
        if ct == "SaveImage":
            output_node_id = nid
            break

    if not prompt_node_id:
        for nid, node in workflow.items():
            inputs = node.get("inputs", {})
            if "text" in inputs:
                prompt_node_id, prompt_field = nid, "text"
                break
    if not prompt_node_id:
        prompt_node_id, prompt_field = "6", "text"
    if not prompt_field:
        prompt_field = "text"
    if not output_node_id:
        output_node_id = "9"

    wf_id = "wf_" + uuid.uuid4().hex[:12]
    name = "从ComfyUI同步"

    for w in cfg.get("workflows", []):
        ewf = w.get("workflow_json", {})
        if len(ewf) == len(workflow):
            if w.get("prompt_node_id") == prompt_node_id and w.get("image_output_node_id") == output_node_id:
                cfg["active_workflow"] = w["id"]
                _save_config(cfg)
                return {
                    "ok": True,
                    "status": "已切换",
                    "workflow_id": w["id"],
                    "workflow_name": w.get("name", ""),
                    "prompt_node_id": prompt_node_id,
                    "prompt_field": prompt_field,
                    "output_node_id": output_node_id,
                    "node_count": len(workflow),
                    "source": source
                }

    new_wf = {
        "id": wf_id,
        "name": name,
        "description": f"从ComfyUI {source}自动同步 ({len(workflow)}节点)",
        "prompt_node_id": prompt_node_id,
        "prompt_field": prompt_field,
        "image_output_node_id": output_node_id,
        "workflow_json": workflow
    }
    workflows = cfg.get("workflows", [])
    workflows.append(new_wf)
    cfg["workflows"] = workflows
    cfg["active_workflow"] = wf_id
    _save_config(cfg)

    return {
        "ok": True,
        "status": "已导入",
        "workflow_id": wf_id,
        "workflow_name": name,
        "prompt_node_id": prompt_node_id,
        "prompt_field": prompt_field,
        "output_node_id": output_node_id,
        "node_count": len(workflow),
        "source": source
    }


@router.post("/generate")
async def generate_thumbnail(data: GenerateRequest):
    """发送提示词到 ComfyUI → 等待生成 → 下载图片 → 设为缩略图
    自动组合：模块主体预设 + 卡片内容 + 品质后缀
    """
    cfg = _get_config()
    if not cfg.get("enabled") or not cfg.get("server_url"):
        return {"ok": False, "error": "ComfyUI 未启用或服务器地址未配置"}

    # 1. 取卡片内容
    db = get_db()
    if data.prompt_text:
        card_text = data.prompt_text
    else:
        row = db.execute("SELECT content FROM prompts WHERE id=?", [data.prompt_id]).fetchone()
        if not row:
            return {"ok": False, "error": "提示词不存在"}
        card_text = row["content"]

    # 2. 取模块主体预设 + 组合
    module_name = data.module_name or ""
    preset_text = data.module_preset or ""
    if not preset_text and module_name:
        presets = _get_module_presets()
        pm = presets.get(module_name, {})
        if pm.get("enabled") and pm.get("preset"):
            preset_text = pm["preset"]

    final_prompt = _compose_prompt(preset_text, card_text, DEFAULT_STYLE_SUFFIX)
    print(f"[ComfyUI] 组合后提示词: {final_prompt[:200]}")

    # 3. 查找工作流配置
    workflow_cfg = None
    for w in cfg.get("workflows", []):
        if w.get("id") == data.workflow_id:
            workflow_cfg = w
            break
    if not workflow_cfg:
        workflow_cfg = cfg.get("workflows", [{}])[0] if cfg.get("workflows") else None
    if not workflow_cfg or not workflow_cfg.get("workflow_json"):
        return {"ok": False, "error": "未找到工作流模板，请先配置"}

    server_url = cfg["server_url"].rstrip("/")
    workflow = workflow_cfg["workflow_json"]

    try:
        return await _run_comfyui(server_url, workflow, workflow_cfg, final_prompt, data.prompt_id)
    except Exception as e:
        import traceback
        print("[ComfyUI] 生成异常:", e)
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


async def _run_comfyui(server_url, workflow, workflow_cfg, prompt_text, prompt_id):
    """执行 ComfyUI 生成流程"""
    node_id = workflow_cfg.get("prompt_node_id", "6")
    field = workflow_cfg.get("prompt_field", "text")
    if node_id in workflow:
        if field in workflow[node_id]["inputs"]:
            workflow[node_id]["inputs"][field] = prompt_text
        else:
            print(f"[ComfyUI] 节点 {node_id} 没有字段 '{field}'，可用字段: {list(workflow[node_id]['inputs'].keys())}")

    timeout_cfg = httpx.Timeout(120.0, connect=15.0)
    async with httpx.AsyncClient(timeout=timeout_cfg) as client:
        resp = await client.post(f"{server_url}/prompt", json={"prompt": workflow})
        if resp.status_code != 200:
            body = resp.text[:500]
            return {"ok": False, "error": f"ComfyUI 返回错误 (HTTP {resp.status_code}): {body}"}
        result = resp.json()
        prompt_id_comfy = result.get("prompt_id")
        if not prompt_id_comfy:
            return {"ok": False, "error": "ComfyUI 未返回 prompt_id"}
        print(f"[ComfyUI] 已提交, prompt_id={prompt_id_comfy}")

    max_wait = 600
    interval = 2.0
    output_images = []

    for wait_elapsed in range(0, max_wait, int(interval)):
        await asyncio.sleep(interval)
        try:
            async with httpx.AsyncClient(timeout=5) as qc:
                qr = await qc.get(f"{server_url}/queue")
                if qr.status_code == 200:
                    qdata = qr.json()
                    is_running = any(p[1] == prompt_id_comfy for p in qdata.get("queue_running", []))
                    is_pending = any(p[1] == prompt_id_comfy for p in qdata.get("queue_pending", []))
                    if not is_running and not is_pending:
                        await asyncio.sleep(0.5)
        except Exception:
            pass

        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(f"{server_url}/history/{prompt_id_comfy}")
                if resp.status_code != 200:
                    if wait_elapsed > 600:
                        break
                    continue
                history = resp.json()
                if prompt_id_comfy not in history:
                    if wait_elapsed > 600:
                        break
                    continue
                outputs = history[prompt_id_comfy].get("outputs", {})
                for node_output in outputs.values():
                    for img_data in node_output.get("images", []):
                        if img_data.get("type") == "output":
                            output_images.append({
                                "filename": img_data["filename"],
                                "subfolder": img_data.get("subfolder", ""),
                                "type": "output"
                            })
                if output_images:
                    print(f"[ComfyUI] 获取到 {len(output_images)} 张输出图片")
                    break
        except Exception as e:
            print(f"[ComfyUI] 轮询异常 (第{wait_elapsed+2}s): {e}")
            continue

    if not output_images:
        return {"ok": False, "error": "生成超时（600秒），未获取到输出图片。请检查 ComfyUI 队列状态。"}

    img_info = output_images[0]
    print(f"[ComfyUI] 下载图片: {img_info['filename']}")
    timeout_dl = httpx.Timeout(60.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout_dl) as client:
        view_resp = await client.get(
            f"{server_url}/view",
            params={
                "filename": img_info["filename"],
                "subfolder": img_info["subfolder"] or "",
                "type": img_info["type"]
            }
        )
        if view_resp.status_code != 200:
            return {"ok": False, "error": f"下载生成图片失败 (HTTP {view_resp.status_code})"}
        img_bytes = view_resp.content

    print(f"[ComfyUI] 下载完成: {len(img_bytes)} bytes")

    os.makedirs(THUMB_DIR, exist_ok=True)
    os.makedirs(ORIGINALS_DIR, exist_ok=True)

    thumb_filename = uuid.uuid4().hex + ".jpg"
    thumb_path = os.path.join(THUMB_DIR, thumb_filename)

    try:
        img = Image.open(io.BytesIO(img_bytes))
        w, h = img.size
        target_ratio = 3 / 2
        current_ratio = w / h
        if current_ratio > target_ratio:
            new_w = int(h * target_ratio)
            offset = (w - new_w) // 2
            img = img.crop((offset, 0, offset + new_w, h))
        else:
            new_h = int(w / target_ratio)
            offset = (h - new_h) // 2
            img = img.crop((0, offset, w, offset + new_h))
        img = img.resize((240, 160), Image.LANCZOS)
        img.save(thumb_path, "JPEG", quality=85)
    except Exception as e:
        print(f"[ComfyUI] 缩略图裁剪失败 (降级): {e}")
        with open(thumb_path, "wb") as f:
            f.write(img_bytes)

    orig_filename = uuid.uuid4().hex + ".jpg"
    orig_path = os.path.join(ORIGINALS_DIR, orig_filename)
    with open(orig_path, "wb") as f:
        f.write(img_bytes)

    db = get_db()
    # 清除旧视频关联（确保从视频预览切换回静态图片）
    db.execute("DELETE FROM prompt_videos WHERE prompt_id=?", [prompt_id])
    db.execute(
        "INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) "
        "VALUES (?, ?, 'image', datetime('now','localtime'))",
        [prompt_id, thumb_filename]
    )
    safe_commit()

    print(f"[ComfyUI] 缩略图已关联到提示词 ID={prompt_id}: {thumb_filename}")

    return {
        "ok": True,
        "thumbnail": thumb_filename,
        "thumbnail_url": f"/api/thumbnails/file/{thumb_filename}",
        "original": orig_filename,
        "image_size": len(img_bytes),
        "generated_from": prompt_text[:80]
    }
