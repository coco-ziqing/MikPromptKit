"""
ComfyUI 集成 — 发送提示词生成图片并自动收录为缩略图
"""
import os, json, uuid, time, io, base64, asyncio, threading
from fastapi import APIRouter
from pydantic import BaseModel
from database import get_db, safe_commit
import httpx
from PIL import Image

router = APIRouter(prefix="/api/v2/comfyui", tags=["comfyui"])

THUMB_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "thumbnails"
)
ORIGINALS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "originals"
)

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
    prompt_text: str = ""
    workflow_id: str = ""


@router.post("/generate")
async def generate_thumbnail(data: GenerateRequest):
    """发送提示词到 ComfyUI → 等待生成 → 下载图片 → 设为缩略图"""
    cfg = _get_config()
    if not cfg.get("enabled") or not cfg.get("server_url"):
        return {"ok": False, "error": "ComfyUI 未启用或服务器地址未配置"}

    # 取提示词内容
    db = get_db()
    if data.prompt_text:
        prompt_text = data.prompt_text
    else:
        row = db.execute("SELECT content FROM prompts WHERE id=?", [data.prompt_id]).fetchone()
        if not row:
            return {"ok": False, "error": "提示词不存在"}
        prompt_text = row["content"]

    # 查找工作流配置
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
        return await _run_comfyui(server_url, workflow, workflow_cfg, prompt_text, data.prompt_id)
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _run_comfyui(server_url, workflow, workflow_cfg, prompt_text, prompt_id):
    """执行 ComfyUI 生成流程"""
    # 1. 注入提示词到工作流
    node_id = workflow_cfg.get("prompt_node_id", "6")
    field = workflow_cfg.get("prompt_field", "text")
    if node_id in workflow:
        if field in workflow[node_id]["inputs"]:
            workflow[node_id]["inputs"][field] = prompt_text

    # 2. 发送到 ComfyUI
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.post(f"{server_url}/prompt", json={"prompt": workflow})
        if resp.status_code != 200:
            return {"ok": False, "error": f"ComfyUI 返回错误: {resp.text}"}
        result = resp.json()
        prompt_id_comfy = result.get("prompt_id")
        if not prompt_id_comfy:
            return {"ok": False, "error": "ComfyUI 未返回 prompt_id"}

    # 3. 轮询等待完成（最长 120 秒）
    max_wait = 120
    interval = 1.5
    output_images = []
    
    for _ in range(int(max_wait / interval)):
        await asyncio.sleep(interval)
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{server_url}/history/{prompt_id_comfy}")
                if resp.status_code != 200:
                    continue
                history = resp.json()
                if prompt_id_comfy not in history:
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
                    break
        except Exception:
            continue

    if not output_images:
        return {"ok": False, "error": "生成超时（120秒），未获取到输出图片"}

    # 4. 下载第一张输出图片
    img_info = output_images[0]
    async with httpx.AsyncClient(timeout=30) as client:
        view_resp = await client.get(
            f"{server_url}/view",
            params={
                "filename": img_info["filename"],
                "subfolder": img_info["subfolder"],
                "type": img_info["type"]
            }
        )
        if view_resp.status_code != 200:
            return {"ok": False, "error": "下载生成图片失败"}
        img_bytes = view_resp.content

    # 5. 保存为缩略图（3:2 裁剪 240x160）
    os.makedirs(THUMB_DIR, exist_ok=True)
    os.makedirs(ORIGINALS_DIR, exist_ok=True)

    thumb_filename = uuid.uuid4().hex + ".jpg"
    thumb_path = os.path.join(THUMB_DIR, thumb_filename)

    try:
        img = Image.open(io.BytesIO(img_bytes))
        # 3:2 居中裁剪
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
        # 降级：直接保存原图
        with open(thumb_path, "wb") as f:
            f.write(img_bytes)

    # 6. 保存原图
    orig_filename = uuid.uuid4().hex + ".png"
    orig_path = os.path.join(ORIGINALS_DIR, orig_filename)
    with open(orig_path, "wb") as f:
        f.write(img_bytes)

    # 7. 关联到提示词
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) "
        "VALUES (?, ?, 'image', datetime('now','localtime'))",
        [prompt_id, thumb_filename]
    )
    safe_commit()

    return {
        "ok": True,
        "thumbnail": thumb_filename,
        "thumbnail_url": f"/api/thumbnails/file/{thumb_filename}",
        "original": orig_filename,
        "image_size": len(img_bytes),
        "generated_from": prompt_text[:60]
    }
