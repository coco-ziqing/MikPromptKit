"""
截图导入 — 版面分析 + Ollama Vision OCR + LLM 结构化 → 导入提示词卡
流程: 上传截图 → Pillow版面分割(效果图区/文字区) → Ollama Vision OCR+结构化
     → 预览确认 → 保存缩略图+创建词条
"""
import os, io, uuid, json, base64, datetime, re
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from database import get_db, safe_commit
import httpx

router = APIRouter(prefix="/api/v2/ocr", tags=["ocr"])

# ============ 配置 ============
TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data", "temp_ocr")
THUMB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data", "thumbnails")
ORIGINALS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data", "originals")
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)
os.makedirs(ORIGINALS_DIR, exist_ok=True)

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_VISION_MODEL = "llava:7b"
DEFAULT_LLM_MODEL = "qwen3.5:9b"  # 结构化备用（若视觉模型输出不够规范）

# ============ Ollama 配置 ============
def _get_ollama_cfg():
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='ollama_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            return cfg
        except Exception:
            pass
    return {"server_url": DEFAULT_OLLAMA_URL, "model": DEFAULT_VISION_MODEL}

# ============ STEP 1: 版面分析 ============
def _layout_analysis(image_bytes: bytes):
    """
    用 Pillow 做简单的版面分析，将截图分为：
    - 效果图区域（最大矩形轮廓）
    - 文字区域（其余部分）

    返回: {
        "image_region": cropped_bytes | None,   # 效果图裁剪
        "text_region": cropped_bytes,             # 文字区裁剪
        "has_image_region": bool
    }
    """
    from PIL import Image, ImageFilter, ImageOps
    import io

    img = Image.open(io.BytesIO(image_bytes))
    # EXIF 自动修正方向（手机竖屏截图）
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    w, h = img.size

    # 对于常见截图布局（上-下分割），水平投影找分界
    # 转灰度
    gray = img.convert("L")
    pixels = list(gray.getdata())

    # 计算每行的平均亮度
    row_brightness = []
    for y in range(h):
        row = pixels[y * w : (y + 1) * w]
        avg = sum(row) / len(row)
        row_brightness.append(avg)

    # 找最暗的行（分割线或文字密集区）
    # 通常分割线是一条较暗的细线，或空白间隙
    # 策略：找到长度 > 图像宽度 60% 的连续较亮行（空白间隙）作为分割候选
    blank_threshold = 240  # 接近白色
    blank_runs = []
    current_run = []
    for y, brightness in enumerate(row_brightness):
        if brightness >= blank_threshold:
            current_run.append(y)
        else:
            if len(current_run) > 3:
                blank_runs.append(current_run)
            current_run = []

    if current_run and len(current_run) > 3:
        blank_runs.append(current_run)

    # 找最长的空白行区间作为分割候选
    margin_top = int(h * 0.05)
    margin_bottom = int(h * 0.05)

    image_region_bytes = None
    text_region_bytes = None
    has_image_region = False

    # 过滤掉边缘空白（顶部/底部的边距）
    interior_blank_runs = [
        run for run in blank_runs
        if run[-1] > margin_top and run[0] < h - margin_bottom
    ]

    if interior_blank_runs:
        # 找到最长的连续空白行
        best_run = max(interior_blank_runs, key=len)
        split_y = best_run[0] + len(best_run) // 2

        # 上半部分作为效果图
        image_region = img.crop((0, 0, w, split_y))
        text_region = img.crop((0, split_y, w, h))

        # 效果图太小则不视为有效
        if image_region.size[1] > h * 0.15:
            buf = io.BytesIO()
            image_region.save(buf, format="JPEG", quality=90)
            image_region_bytes = buf.getvalue()
            has_image_region = True
        else:
            # 效果图太小，整个作为文字区
            text_region = img

        buf = io.BytesIO()
        text_region.save(buf, format="JPEG", quality=90)
        text_region_bytes = buf.getvalue()
    else:
        # 找不到明显分界，整张图作为文字区
        text_region = img
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        text_region_bytes = buf.getvalue()

    return {
        "image_region": image_region_bytes,
        "text_region": text_region_bytes,
        "has_image_region": has_image_region,
        "image_size": f"{w}x{h}"
    }


# ============ STEP 2: Ollama Vision 解析 ============

SYSTEM_PROMPT = """你是一个AI提示词分析助手。用户发来的截图包含AI生成图片/视频的技巧分享。

请分析图中的文字信息，并以JSON格式返回以下字段（严格JSON，不附加说明）：

{
  "content": "提取截图中的提示词原文（prompt），如果有多段取最重要的",
  "meaning": "这个提示词的中文释义或简短说明",
  "scene": "适用场景（如：人像摄影/风景/产品展示/概念艺术/视频生成）",
  "module": "所属模块，从以下选一个最接近的：emotion(人物表情)/color(场景色彩)/tone(画面色调)/composition(构图运镜)/seedance(视频模板)",
  "category": "分类名称（如：肖像/风景/产品/抽象/写真/广告）",
  "tags": ["标签1", "标签2", "标签3"],
  "tips": "截图中提取到的参数设置、技巧说明等额外信息",
  "has_image_preview": true
}

注：has_image_preview 表示截图中是否包含效果预览图。
如果截图中没有明确提示词内容，content字段设为空字符串""
"""


async def _ollama_vision_parse(image_bytes: bytes, text_region_bytes: bytes = None) -> dict:
    """调用 Ollama 视觉模型分析截图，返回结构化 JSON"""
    cfg = _get_ollama_cfg()
    server_url = cfg.get("server_url", DEFAULT_OLLAMA_URL).rstrip("/")
    model = cfg.get("model", DEFAULT_VISION_MODEL)

    # 优先用文字区，没有则用原图
    target_image = text_region_bytes or image_bytes
    img_b64 = base64.b64encode(target_image).decode("utf-8")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            resp = await client.post(f"{server_url}/api/chat", json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": "分析这张截图中的AI提示词信息，返回JSON", "images": [img_b64]}
                ],
                "stream": False,
                "options": {"temperature": 0.1}
            })
            if resp.status_code != 200:
                return {"error": f"Ollama 返回错误 (HTTP {resp.status_code})"}

            result = resp.json()
            raw = result.get("message", {}).get("content", "")

            # 提取 JSON（模型可能附带了 ```json 标记）
            json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
            else:
                # 尝试直接在内容中找 JSON 对象
                brace_start = raw.find('{')
                brace_end = raw.rfind('}')
                if brace_start >= 0 and brace_end > brace_start:
                    json_str = raw[brace_start:brace_end + 1]
                else:
                    json_str = raw

            try:
                parsed = json.loads(json_str)
                # 确保必填字段存在
                defaults = {
                    "content": "", "meaning": "", "scene": "",
                    "module": "custom", "category": "OCR导入",
                    "tags": [], "tips": "", "has_image_preview": False
                }
                for k, v in defaults.items():
                    if k not in parsed or parsed[k] is None:
                        parsed[k] = v
                # tags 如果是字符串转数组
                if isinstance(parsed.get("tags"), str):
                    parsed["tags"] = [t.strip() for t in parsed["tags"].split(",") if t.strip()]
                return parsed
            except json.JSONDecodeError:
                # JSON 解析失败，返回纯文本
                return {
                    "content": raw[:500],
                    "meaning": "OCR 识别结果（需手动整理）",
                    "scene": "",
                    "module": "custom",
                    "category": "OCR导入",
                    "tags": ["OCR"],
                    "tips": "",
                    "has_image_preview": False,
                    "_raw": raw[:200]
                }

    except Exception as e:
        return {"error": f"Ollama 调用失败: {str(e)}"}


async def _ollama_llm_parse_text(text: str) -> dict:
    """备用：用纯文本 LLM 解析 OCR 文字（当视觉模型结果不符合预期时）"""
    cfg = _get_ollama_cfg()
    server_url = cfg.get("server_url", DEFAULT_OLLAMA_URL).rstrip("/")

    prompt = f"""从以下AI提示词截图中提取的文字，请分析并返回JSON格式：

{text[:2000]}

要求JSON格式：
{{
  "content": "提示词原文",
  "meaning": "中文释义",
  "scene": "适用场景",
  "module": "emotion/color/tone/composition/seedance/custom",
  "category": "分类",
  "tags": ["标签"],
  "tips": "技巧说明"
}}
只返回JSON，不要附加说明。"""

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            resp = await client.post(f"{server_url}/api/chat", json={
                "model": DEFAULT_LLM_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.1}
            })
            if resp.status_code != 200:
                return {}
            raw = resp.json().get("message", {}).get("content", "")
            json_match = re.search(r'\{.*\}', raw, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
    except Exception:
        pass
    return {}


# ============ 工具：保存临时文件 ============

def _save_temp_file(data: bytes, prefix: str, ext: str = ".jpg") -> str:
    """保存临时文件，返回相对路径"""
    filename = f"{prefix}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(TEMP_DIR, filename)
    with open(path, "wb") as f:
        f.write(data)
    return filename


def _save_thumbnail(image_bytes: bytes) -> str:
    """保存缩略图（3:2 裁剪 + 240x160）"""
    from PIL import Image
    img = Image.open(io.BytesIO(image_bytes))
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

    filename = uuid.uuid4().hex + ".jpg"
    img.save(os.path.join(THUMB_DIR, filename), "JPEG", quality=85)
    return filename


def _save_original(image_bytes: bytes) -> str:
    """保存原图"""
    filename = uuid.uuid4().hex + ".jpg"
    with open(os.path.join(ORIGINALS_DIR, filename), "wb") as f:
        f.write(image_bytes)
    return filename


# ============ API 端点 ============


@router.post("/preview")
@router.post("/preview")
async def ocr_preview(file: UploadFile = File(...)):
    """上传截图 → 版面分析 + Ollama Vision 解析 → 返回预览数据"""
    file_bytes = await file.read()
    if not file_bytes or len(file_bytes) < 100:
        raise HTTPException(400, "文件无效或为空")
    # 文件大小限制 10MB
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(400, "文件过大，请上传小于 10MB 的截图")

    # STEP 1: 版面分析
    layout = _layout_analysis(file_bytes)

    # 保存效果图区域（如果有）
    image_filename = None
    if layout["image_region"]:
        image_filename = _save_temp_file(layout["image_region"], "ocr_img")
        # 同时也保存原图，后续确认时转正
    else:
        image_filename = _save_temp_file(file_bytes, "ocr_full")

    # 也保存文字区域用于调试
    text_filename = _save_temp_file(layout["text_region"], "ocr_txt")

    # STEP 2: Ollama Vision 解析
    parsed = await _ollama_vision_parse(file_bytes, layout["text_region"])

    if parsed.get("error"):
        # Ollama 调用失败，返回错误但保留布局数据
        return {
            "ok": False,
            "error": parsed["error"],
            "layout": {
                "has_image_region": layout["has_image_region"],
                "image_size": layout["image_size"]
            }
        }

    return {
        "ok": True,
        "preview": parsed,
        "layout": {
            "has_image_region": layout["has_image_region"],
            "image_size": layout["image_size"]
        },
        "temp_files": {
            "image": image_filename,
            "text_region": text_filename
        }
    }


class ConfirmImport(BaseModel):
    content: str
    meaning: str = ""
    scene: str = ""
    module: str = "custom"
    category: str = "OCR导入"
    tags: list = []
    tips: str = ""
    temp_image: str = ""       # 临时效果图文件名
    has_image: bool = False    # 是否有效果图


@router.post("/confirm")
async def ocr_confirm(data: ConfirmImport):
    """确认导入 — 保存缩略图 + 创建提示词卡"""
    if not data.content or not data.content.strip():
        raise HTTPException(400, "内容不能为空")

    db = get_db()

    # 保存缩略图（如果有效果图）
    thumbnail_filename = None
    original_filename = None
    if data.has_image and data.temp_image:
        temp_path = os.path.join(TEMP_DIR, data.temp_image)
        if os.path.exists(temp_path):
            with open(temp_path, "rb") as f:
                img_bytes = f.read()
            # 保存缩略图
            thumbnail_filename = _save_thumbnail(img_bytes)
            # 保存原图
            original_filename = _save_original(img_bytes)

    # 创建提示词
    tags_json = json.dumps(data.tags if isinstance(data.tags, list) else ["OCR"], ensure_ascii=False)
    category = data.category or "OCR导入"
    module = data.module or "custom"
    meaning = data.meaning or ""
    scene = data.scene or ""

    # 如果 tips 不为空，追加到释义中
    if data.tips:
        if meaning:
            meaning += f"\n💡 {data.tips[:200]}"
        else:
            meaning = f"💡 {data.tips[:200]}"

    db.execute(
        "INSERT INTO prompts (module, category, content, meaning, scene, tags, is_builtin) "
        "VALUES (?, ?, ?, ?, ?, ?, 0)",
        [module, category, data.content.strip(), meaning, scene, tags_json, 0]
    )
    db.commit()
    prompt_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

    # 关联缩略图
    if thumbnail_filename:
        db.execute(
            "INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) "
            "VALUES (?, ?, 'image', datetime('now','localtime'))",
            [prompt_id, thumbnail_filename]
        )
        db.commit()

    # 清理临时文件
    _clean_temp_files(data.temp_image)

    return {
        "ok": True,
        "id": prompt_id,
        "thumbnail": thumbnail_filename,
        "original": original_filename,
        "message": f"已导入提示词「{data.content[:40]}...」" if len(data.content) > 40 else f"已导入提示词「{data.content}」"
    }


def _clean_temp_files(*filenames):
    """清理临时文件"""
    for fname in filenames:
        if not fname:
            continue
        fpath = os.path.join(TEMP_DIR, fname)
        try:
            if os.path.exists(fpath):
                os.remove(fpath)
        except Exception:
            pass


@router.post("/check-duplicate")
async def ocr_check_duplicate(data: dict):
    """检查提示词内容是否已存在（用于导入前去重）"""
    content = (data.get("content") or "").strip()
    if not content:
        return {"ok": False, "duplicate": False, "exists": []}
    db = get_db()
    rows = db.execute(
        "SELECT id, content, module, category FROM prompts WHERE content = ? AND deleted_at IS NULL",
        [content]
    ).fetchall()
    if rows:
        return {
            "ok": True,
            "duplicate": True,
            "exists": [{"id": r["id"], "content": r["content"], "module": r["module"], "category": r["category"]} for r in rows]
        }
    # 模糊匹配：截断空格/标点差异后对比
    clean = re.sub(r'[\s\p{P}]+', '', content)
    candidates = db.execute(
        "SELECT id, content, module, category FROM prompts WHERE deleted_at IS NULL"
    ).fetchall()
    for r in candidates:
        r_clean = re.sub(r'[\\s\\p{P}]+', '', r["content"])
        if r_clean == clean:
            return {
                "ok": True,
                "duplicate": True,
                "exists": [{"id": r["id"], "content": r["content"], "module": r["module"], "category": r["category"]}]
            }
    return {"ok": True, "duplicate": False, "exists": []}


@router.post("/re-parse")
async def ocr_reparse(file: UploadFile = File(...)):
    """备用：直接用上传的图片做分析（跳过版面分割）"""
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "文件无效")

    parsed = await _ollama_vision_parse(file_bytes, file_bytes)
    if parsed.get("error"):
        return {"ok": False, "error": parsed["error"]}

    return {"ok": True, "preview": parsed}


@router.get("/status")
def ocr_status():
    """检查 OCR 引擎状态"""
    return {
        "ok": True,
        "ollama_url": _get_ollama_cfg().get("server_url", DEFAULT_OLLAMA_URL),
        "vision_model": _get_ollama_cfg().get("model", DEFAULT_VISION_MODEL),
        "available": True,
        "note": "使用 Ollama 视觉模型（llava/qwen-vl/llama3.2-vision）"
    }


@router.get("/temp-file/{filename}")
def serve_temp_file(filename: str):
    """提供临时文件预览（仅用于导入预览阶段）"""
    from fastapi.responses import FileResponse
    import os
    fpath = os.path.join(TEMP_DIR, os.path.basename(filename))
    if not os.path.exists(fpath):
        raise HTTPException(404, "文件不存在")
    return FileResponse(fpath, media_type="image/jpeg")
