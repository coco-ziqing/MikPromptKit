"""
v4.0.0-phase12.6: AI 缩略图智能生成
- 用 LLM 分析提示词 → 生成视觉描述 → 创建智能配色缩略图
- 摆脱 ComfyUI 离线依赖，纯 LLM 驱动的卡片封面
- 支持: 单条生成 / 批量生成 / 配色预设
"""
import io, os, uuid, json, base64, asyncio
from fastapi import APIRouter
from pydantic import BaseModel
from database import get_db, safe_commit
from ollama_client import ollama_chat, extract_json, get_model_for

router = APIRouter(prefix="/api/ai/thumbnail", tags=["ai_thumbnail"])

# ============ 目录配置 ============
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
THUMB_DIR = os.path.join(_PROJECT_ROOT, "data", "thumbnails")
os.makedirs(THUMB_DIR, exist_ok=True)

# ============ 配色预设（按模块） ============
COLOR_PRESETS = {
    "emotion": ["#f472b6", "#ec4899", "#be185d", "#831843"],
    "color": ["#a78bfa", "#7c3aed", "#5b21b6", "#4c1d95"],
    "tone": ["#38bdf8", "#0ea5e9", "#0369a1", "#0c4a6e"],
    "composition": ["#34d399", "#10b981", "#047857", "#064e3b"],
    "seedance": ["#fbbf24", "#f59e0b", "#b45309", "#78350f"],
    "custom": ["#f87171", "#ef4444", "#b91c1c", "#7f1d1d"],
}

# ============ LLM 分析 Prompt ============
THUMBNAIL_SYSTEM = """你是视觉设计分析专家。请分析提示词，提取视觉关键词用于生成缩略图配色方案。

返回JSON:
{
  "primary_color": "#hex色值",
  "secondary_color": "#hex色值",
  "mood": "氛围词(如dark/mysterious/bright/warm/cool)",
  "style_keyword": "核心风格词(中文,3-8字)",
  "icon_emoji": "合适的emoji"
}"""


def _analyze_prompt(content: str) -> dict:
    """同步分析提示词（被异步包装调用）"""
    import httpx
    try:
        server_url = "http://127.0.0.1:11434"
        try:
            from ollama_client import get_server_url
            server_url = get_server_url()
        except Exception:
            pass

        model = get_model_for("thumbnail_desc")
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": THUMBNAIL_SYSTEM},
                {"role": "user", "content": content[:500]}
            ],
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 256}
        }
        with httpx.Client(timeout=30) as client:
            resp = client.post(f"{server_url}/api/chat", json=payload)
            if resp.status_code == 200:
                raw = resp.json().get("message", {}).get("content", "")
                return extract_json(raw)
    except Exception:
        pass
    return {}


def _generate_gradient_thumbnail(prompt_text: str, module: str = "custom") -> tuple:
    """
    智能生成缩略图: LLM分析 → 配色 → Pillow渲染渐变+文字
    返回 (thumb_filename, thumb_path)
    """
    from PIL import Image, ImageDraw, ImageFont

    # 分析配色
    analysis = _analyze_prompt(prompt_text)

    # 获取配色
    palette = COLOR_PRESETS.get(module, COLOR_PRESETS["custom"])
    primary = analysis.get("primary_color") or palette[0]
    secondary = analysis.get("secondary_color") or palette[2]

    # 创建 240x160 缩略图
    W, H = 240, 160
    img = Image.new("RGB", (W, H), secondary)

    # 渐变叠加
    from PIL import ImageFilter
    gradient = Image.new("RGB", (W, H))
    for y in range(H):
        r1, g1, b1 = int(primary[1:3], 16), int(primary[3:5], 16), int(primary[5:7], 16)
        r2, g2, b2 = int(secondary[1:3], 16), int(secondary[3:5], 16), int(secondary[5:7], 16)
        t = y / H
        r = int(r1 + (r2 - r1) * t)
        g = int(g1 + (g2 - g1) * t)
        b = int(b1 + (b2 - b1) * t)
        for x in range(W):
            gradient.putpixel((x, y), (r, g, b))
    img = Image.blend(img, gradient, 0.6)

    # 柔和
    img = img.filter(ImageFilter.GaussianBlur(radius=1))

    # 文字
    draw = ImageDraw.Draw(img)
    mood = analysis.get("mood", "")
    style = analysis.get("style_keyword", "") or prompt_text[:12]
    icon = analysis.get("icon_emoji", "🎨")

    # 用默认字体
    text = f"{icon} {style}"
    try:
        font = ImageFont.truetype("C:\\Windows\\Fonts\\msyh.ttc", 18)
    except Exception:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (W - tw) // 2
    y = (H - th) // 2

    # 阴影
    draw.text((x+1, y+1), text, fill=(0, 0, 0), font=font)
    draw.text((x, y), text, fill=(255, 255, 255), font=font)

    # 保存
    filename = f"ai_thumb_{uuid.uuid4().hex[:12]}.jpg"
    path = os.path.join(THUMB_DIR, filename)
    img.save(path, "JPEG", quality=85)

    return filename, path


# ============ Pydantic Models ============

class GenThumbnailRequest(BaseModel):
    prompt_id: int
    module: str = ""  # 可选，覆盖自动检测

class BatchGenRequest(BaseModel):
    prompt_ids: list
    module: str = ""


# ============ API ============

@router.post("/generate")
async def generate_thumbnail(data: GenThumbnailRequest):
    """为单个提示词生成AI缩略图"""
    db = get_db()
    row = db.execute("SELECT id, content, module FROM prompts WHERE id=?", [data.prompt_id]).fetchone()
    if not row:
        return {"ok": False, "error": "提示词不存在"}

    module = data.module or row["module"] or "custom"
    content = row["content"] or ""

    # 生成缩略图
    loop = asyncio.get_event_loop()
    filename, path = await loop.run_in_executor(None, _generate_gradient_thumbnail, content, module)

    # 关联到提示词
    db.execute("UPDATE prompts SET thumbnail=? WHERE id=?", [filename, data.prompt_id])
    db.commit()

    return {
        "ok": True,
        "prompt_id": data.prompt_id,
        "thumbnail": filename,
        "module": module
    }


@router.post("/batch-generate")
async def batch_generate(data: BatchGenRequest):
    """批量生成AI缩略图"""
    if not data.prompt_ids:
        return {"ok": False, "error": "请提供提示词ID列表"}
    if len(data.prompt_ids) > 20:
        return {"ok": False, "error": "单次最多20条"}

    sem = asyncio.Semaphore(3)
    db = get_db()

    async def _gen_one(pid):
        async with sem:
            try:
                row = db.execute("SELECT id, content, module FROM prompts WHERE id=?", [pid]).fetchone()
                if not row:
                    return {"prompt_id": pid, "ok": False, "error": "不存在"}

                module = data.module or row["module"] or "custom"
                content = row["content"] or ""

                loop = asyncio.get_event_loop()
                filename, path = await loop.run_in_executor(None, _generate_gradient_thumbnail, content, module)

                # 异步更新数据库（每个线程自己的连接）
                import sqlite3
                _db_path = os.path.join(os.path.dirname(THUMB_DIR), "prompts.db")
                _conn = sqlite3.connect(_db_path)
                _conn.execute("UPDATE prompts SET thumbnail=? WHERE id=?", [filename, pid])
                _conn.commit()
                _conn.close()

                return {"prompt_id": pid, "ok": True, "thumbnail": filename}
            except Exception as e:
                return {"prompt_id": pid, "ok": False, "error": str(e)[:200]}

    tasks = [_gen_one(pid) for pid in data.prompt_ids]
    results = await asyncio.gather(*tasks)
    success = [r for r in results if r.get("ok")]

    return {
        "ok": True,
        "total": len(data.prompt_ids),
        "success": len(success),
        "failed": len(results) - len(success),
        "results": results,
    }


@router.get("/analyze/{prompt_id}")
async def analyze_prompt_for_thumbnail(prompt_id: int):
    """分析提示词 → 返回推荐配色（不生成缩略图）"""
    db = get_db()
    row = db.execute("SELECT id, content, module FROM prompts WHERE id=?", [prompt_id]).fetchone()
    if not row:
        return {"ok": False, "error": "提示词不存在"}

    loop = asyncio.get_event_loop()
    analysis = await loop.run_in_executor(None, _analyze_prompt, row["content"] or "")

    palette = COLOR_PRESETS.get(row["module"] or "custom", COLOR_PRESETS["custom"])

    return {
        "ok": True,
        "prompt_id": prompt_id,
        "analysis": analysis,
        "default_palette": palette,
    }
