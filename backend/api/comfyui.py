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
    safe_commit()


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
    safe_commit()


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


def _find_workflow(cfg: dict, workflow_id: str = ""):
    """查找工作流配置, 返回 (workflow_cfg, name)"""
    workflows = cfg.get("workflows", [])
    if not workflows:
        return (None, "")
    if workflow_id:
        for w in workflows:
            if w.get("id") == workflow_id:
                return (w, w.get("name", ""))
    return (workflows[0], workflows[0].get("name", ""))

def _compose_prompt(preset_text: str, card_text: str, style_suffix: str) -> str:
    """自然语言组合规则
    针对分镜构图模块：卡片内容(构图指令)优先，确保模型接收到明确的构图要求
    其他模块：预设主体 + 卡片细节
    """
    preset = preset_text.strip() if preset_text else ""
    card = card_text.strip() if card_text else ""
    suffix = style_suffix.strip() if style_suffix else ""
    preset_len = len(preset)
    card_len = len(card)

    parts = []
    if preset:
        # 卡片很短而预设很长时，卡片优先（典型：分镜构图词 + 长预设）
        if card and preset_len > 200 and card_len <= 60:
            parts.append(card.rstrip(","))
            parts.append(preset.rstrip(","))
        else:
            parts.append(preset.rstrip(","))
            if card:
                parts.append(card.rstrip(","))
    elif card:
        parts.append(card.rstrip(","))
    if suffix:
        parts.append(suffix.rstrip(","))

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

    workflow_cfg, _ = _find_workflow(cfg, data.workflow_id)
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
        _http_sync = httpx.Client(timeout=httpx.Timeout(10.0))
    except ImportError:
        try:
            import requests as _requests
            _http_sync = type('_',(),{'get':lambda self,url: _req(url)})()
            def _req(url):
                r = _requests.get(f"{server_url}{url}", timeout=10)
                return type('_',(),{'status_code':r.status_code,'json':lambda: r.json()})()
        except ImportError:
            return {"ok": False, "error": "需要安装 httpx 或 requests"}

    def _http_get(path):
        try:
            if isinstance(_http_sync, httpx.Client):
                r = _http_sync.get(f"{server_url}{path}")
                return (r.status_code, r.json())
            else:
                r = _http_sync.get(path)
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
    workflow_cfg, _ = _find_workflow(cfg, data.workflow_id)
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
    """执行 ComfyUI 生成流程（同步 httpx + 线程池，避免异步死锁）"""
    loop = asyncio.get_event_loop()
    import time as _time, uuid, io as _io

    def _sync_run():
        node_id = workflow_cfg.get("prompt_node_id", "6")
        field = workflow_cfg.get("prompt_field", "text")
        if node_id in workflow and field in workflow[node_id]["inputs"]:
            workflow[node_id]["inputs"][field] = prompt_text
        from database import get_db
        from PIL import Image as PILImage
        import os

        # Step 1: submit to ComfyUI
        with httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0)) as cl:
            r = cl.post(f"{server_url}/prompt", json={"prompt": workflow})
            if r.status_code != 200:
                return {"ok": False, "error": f"ComfyUI HTTP {r.status_code}: {r.text[:300]}"}
            pid = r.json().get("prompt_id")
            if not pid:
                return {"ok": False, "error": "ComfyUI 未返回 prompt_id"}
            print(f"[ComfyUI] 已提交 prompt_id={pid}")

        # Step 2: poll for completion
        out_imgs = []
        for sec in range(0, 600, 2):
            _time.sleep(2)
            try:
                with httpx.Client(timeout=5) as qc:
                    qd = qc.get(f"{server_url}/queue").json()
                    running = any(p[1] == pid for p in qd.get("queue_running", []))
                    pending = any(p[1] == pid for p in qd.get("queue_pending", []))
                    if not running and not pending:
                        _time.sleep(0.5)
            except:
                pass
            try:
                with httpx.Client(timeout=8) as cl:
                    hist = cl.get(f"{server_url}/history/{pid}").json()
                    if pid not in hist:
                        continue
                    for no in hist[pid].get("outputs", {}).values():
                        for im in no.get("images", []):
                            if im.get("type") == "output":
                                out_imgs.append(im)
                    if out_imgs:
                        print(f"[ComfyUI] 获取到 {len(out_imgs)} 张输出")
                        break
            except Exception as e:
                print(f"[ComfyUI] 轮询 {sec}s: {e}")

        if not out_imgs:
            return {"ok": False, "error": "生成超时(600s)"}

        # Step 3: download
        im = out_imgs[0]
        print(f"[ComfyUI] 下载: {im['filename']}")
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as cl:
            vr = cl.get(f"{server_url}/view", params={"filename": im["filename"], "subfolder": im.get("subfolder",""), "type": im["type"]})
            if vr.status_code != 200:
                return {"ok": False, "error": f"下载失败 HTTP {vr.status_code}"}
            img_bytes = vr.content
        print(f"[ComfyUI] 下载完成 {len(img_bytes)} bytes")

        # Step 4: save thumbnail + original
        os.makedirs(THUMB_DIR, exist_ok=True)
        os.makedirs(ORIGINALS_DIR, exist_ok=True)
        _base = uuid.uuid4().hex
        tf = _base + ".jpg"
        tp = os.path.join(THUMB_DIR, tf)
        iw, ih = 0, 0
        try:
            _im = PILImage.open(_io.BytesIO(img_bytes))
            iw, ih = _im.size
            sw, sh = _im.size
            tr = 240.0 / 160.0
            sr = sw / sh
            if sr > tr:
                nw = int(sh * tr)
                ox = (sw - nw) // 2
                _im = _im.crop((ox, 0, ox + nw, sh))
            else:
                nh = int(sw / tr)
                oy = (sh - nh) // 2
                _im = _im.crop((0, oy, sw, oy + nh))
            _im = _im.resize((240, 160), PILImage.LANCZOS)
            if _im.mode in ("RGBA", "P"):
                _im = _im.convert("RGB")
            _im.save(tp, "JPEG", quality=85)
        except Exception:
            with open(tp, "wb") as f:
                f.write(img_bytes)

        of = _base + ".jpg"
        op = os.path.join(ORIGINALS_DIR, of)
        with open(op, "wb") as f:
            f.write(img_bytes)

        # Step 5: write DB
        db = get_db()
        db.execute("DELETE FROM prompt_videos WHERE prompt_id=?", [prompt_id])
        db.execute("INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) VALUES (?,?,'image',datetime('now','localtime'))", [prompt_id, tf])
        try:
            ts = os.path.getsize(tp) if os.path.exists(tp) else 0
            db.execute("""INSERT OR IGNORE INTO media_assets
                (filename, original_filename, file_size, original_size,
                 media_type, width, height, mime_type, prompt_id, source)
                VALUES (?,?,?,?,'image',?,?,'image/jpeg',?,'ai_generated')""",
                [tf, of, ts, len(img_bytes), iw, ih, prompt_id])
        except Exception as _e:
            print(f"[ComfyUI] 媒体资产写入失败: {_e}")
        safe_commit()
        print(f"[ComfyUI] 已关联 prompt_id={prompt_id}: {tf}")
        return {"ok": True, "thumbnail": tf, "thumbnail_url": f"/api/thumbnails/file/{tf}", "original": of, "image_size": len(img_bytes), "generated_from": prompt_text[:80]}

    return await loop.run_in_executor(None, _sync_run)

