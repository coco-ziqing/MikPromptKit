"""
截图导入 — 预扫描语言检测 + 智能模型路由 + Ollama Vision OCR + 结构化
================================================================================
修复 v3.10.25:
  1. 主模型返回空内容时: 简化 prompt 重试一次 ✓
  2. 简化 prompt 仍空: 自动 fallback 到 llama3.2-vision:11b ✓
  3. 全部失败时: 返回 ok=false + 明确中文错误信息 ✓
  4. 布局分析: 改进空白区域检测，支持深色背景 ✓
  5. 前端 30s 超时 → 延长到 120s ✓
================================================================================
流程: 上传截图 → 版面分析(效果图/文字区分离)
     → 调用 qwen3-vl:8b (内置语言检测)
     → 空内容重试: 简化 prompt → fallback 模型
     → LLM结构化解析 → 预览确认 → 保存缩略图+创建词条
================================================================================
"""
import os, io, uuid, json, base64, datetime, re, asyncio
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from database import get_db, safe_commit
import httpx

router = APIRouter(prefix="/api/v2/ocr", tags=["ocr"])

# ============ 目录配置 ============
TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data", "temp_ocr")
THUMB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data", "thumbnails")
ORIGINALS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data", "originals")
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)
os.makedirs(ORIGINALS_DIR, exist_ok=True)

# ============ 默认配置 ============
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_VISION_MODEL = "qwen3-vl:8b"
DEFAULT_LLM_MODEL = "qwen3.5:9b"
FALLBACK_VISION_MODEL = "llama3.2-vision:11b"

# ============ 三阶段提示词（从严格到宽松） ============

# 阶段1：严格JSON (主调用)
SYSTEM_PROMPT_STRICT = """Return ONLY valid JSON with these exact keys: content, meaning, scene, module, category, tags, tips, has_image_preview, _language.
Extract ALL text from the image - the prompt text, parameters, everything visible.
If you see any text at all, put it in "content".
NO markdown formatting, NO extra text. ONLY the JSON object.

{
  "content": "extracted prompt text in original language",
  "meaning": "short Chinese explanation",
  "scene": "applicable scene in Chinese",
  "module": "emotion/color/tone/composition/seedance/custom",
  "category": "category name",
  "tags": ["tag1", "tag2"],
  "tips": "any settings visible",
  "has_image_preview": false,
  "_language": "chinese/english/mixed"
}"""

# 阶段2：简化提示词（空内容重试用）
SYSTEM_PROMPT_SIMPLE = """Look at this image and tell me what text you see.
Reply with a JSON object: {"content":"all text from the image","meaning":"Chinese meaning","scene":"","module":"custom","category":"","tags":[],"tips":""}
Be generous - if you see any text at all, include it in content. ONLY JSON, no other text."""

# 阶段3：英文专用（fallback）
SYSTEM_PROMPT_EN = """This is a screenshot of an AI prompt tool. Extract ALL visible text.
Return ONLY JSON: {"content":"all text from image","meaning":"Chinese meaning","scene":"scene","module":"emotion/color/tone/composition/seedance/custom","category":"category","tags":["tags"],"tips":"settings"}
Include every line of text you can see. ONLY JSON."""


# ============ Ollama 配置读取 ============

def _get_ollama_cfg():
    """读取 ollama 配置，支持 vision_models 模型池"""
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='ollama_config'").fetchone()
    if row:
        try:
            return json.loads(row["value"])
        except Exception:
            pass
    return {"server_url": DEFAULT_OLLAMA_URL, "model": DEFAULT_VISION_MODEL}


def _get_usable_models():
    """返回当前可用的视觉模型列表"""
    cfg = _get_ollama_cfg()
    pool = cfg.get("vision_models", None)
    if pool and isinstance(pool, dict):
        return pool
    return {
        "chinese": "qwen3-vl:8b",
        "english": "llama3.2-vision:11b",
    }


# ============ STEP 1: 版面分析 ============

def _layout_analysis(image_bytes: bytes):
    """
    用 Pillow 做简单的版面分析，将截图分为：
    - 效果图区域（上半部分，含最亮/最暗连续区域做分割线）
    - 文字区域（下半部分）

    v3.10.25: 改用亮度梯度检测，支持深色背景截图
    """
    from PIL import Image, ImageOps
    import io as _io

    img = Image.open(_io.BytesIO(image_bytes))
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    # RGBA（如PNG截图）转RGB，JPEG不支持透明度通道
    if img.mode == 'RGBA':
        background = Image.new('RGB', img.size, (30, 41, 59))  # 深色背景垫底，保持截图深色主题
        background.paste(img, mask=img.split()[3])
        img = background
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    w, h = img.size

    gray = img.convert("L")
    pixels = list(gray.getdata())

    # 计算每行平均亮度
    row_brightness = []
    for y in range(h):
        row = pixels[y * w : (y + 1) * w]
        row_brightness.append(sum(row) / len(row))

    # 边缘保护：不检测顶部8%和底部8%
    margin_top = int(h * 0.08)
    margin_bottom = int(h * 0.08)

    # 方法1：找亮度突变点（浅色截图的分割线）
    row_diffs = []
    for y in range(margin_top, h - margin_bottom - 2):
        diff = abs(row_brightness[y+1] - row_brightness[y])
        row_diffs.append((y, diff))

    # 按亮度差排序，取最大突变位置
    row_diffs.sort(key=lambda x: -x[1])

    split_y = None
    # 找亮度差最大的位置，且该位置两侧有显著差异
    if row_diffs and row_diffs[0][1] > 30:
        split_y = row_diffs[0][0]
        # 验证分割线两侧确实一边亮一边暗
        before = sum(row_brightness[max(0, split_y-10):split_y]) / 10
        after = sum(row_brightness[split_y:min(h, split_y+10)]) / 10
        if abs(before - after) < 20:
            split_y = None  # 差异不够大，不是真实分割线

    # 方法2：找连续空白行（浅色背景备选）
    if split_y is None:
        blank_threshold = 230  # 亮色阈值
        blank_runs = []
        current_run = []
        for y in range(margin_top, h - margin_bottom):
            if row_brightness[y] >= blank_threshold:
                current_run.append(y)
            else:
                if len(current_run) > 5:
                    blank_runs.append(current_run)
                current_run = []
        if current_run and len(current_run) > 5:
            blank_runs.append(current_run)

        if blank_runs:
            best_run = max(blank_runs, key=len)
            mid = best_run[0] + len(best_run) // 2
            # 确保分割线上方不是空的
            top_nonblank = any(b < blank_threshold for b in row_brightness[max(0, mid-30):mid])
            if top_nonblank:
                split_y = mid

    # 方法3：对深色截图，检查是否有明显颜色/内容变化
    if split_y is None:
        # 计算上半部分 vs 下半部分的平均亮度差异
        upper = sum(row_brightness[:h//2]) / (h//2)
        lower = sum(row_brightness[h//2:]) / (h//2)
        if abs(upper - lower) > 25:
            split_y = h // 2

    image_region_bytes = None
    text_region_bytes = None
    has_image_region = False

    if split_y and split_y > margin_top and split_y < h - margin_bottom:
        img_region = img.crop((0, 0, w, split_y))
        txt_region = img.crop((0, split_y, w, h))
        if img_region.size[1] > h * 0.15:
            buf = _io.BytesIO()
            img_region.save(buf, format="JPEG", quality=90)
            image_region_bytes = buf.getvalue()
            has_image_region = True
        else:
            txt_region = img
        buf = _io.BytesIO()
        txt_region.save(buf, format="JPEG", quality=90)
        text_region_bytes = buf.getvalue()
    else:
        # 没有找到分割线，整张图当文字区
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        text_region_bytes = buf.getvalue()

    return {
        "image_region": image_region_bytes,
        "text_region": text_region_bytes,
        "has_image_region": has_image_region,
        "image_size": f"{w}x{h}"
    }


# ============ STEP 2: OCR 核心调用 ============

def _call_model_sync(server_url: str, model: str, img_b64: str,
                     system_prompt: str, timeout_s: int = 120) -> dict:
    """同步调用 Ollama 视觉模型（线程池运行，避免事件循环死锁）"""
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
            resp = client.post(f"{server_url}/api/chat", json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "分析这张截图中的AI提示词信息，提取所有可见文字",
                     "images": [img_b64]}
                ],
                "stream": False,
                "options": {"temperature": 0.1}
            })
            if resp.status_code != 200:
                return {"error": f"Ollama HTTP {resp.status_code}", "_model": model}
            raw = resp.json().get("message", {}).get("content", "")
            return _parse_json_from_raw(raw, model)
    except httpx.TimeoutException:
        return {"error": f"timeout({timeout_s}s)", "_model": model}
    except Exception as e:
        return {"error": str(e)[:100], "_model": model}


async def _call_model(server_url: str, model: str, img_b64: str,
                      system_prompt: str, timeout_s: int = 120) -> dict:
    """异步包装：同步调用跑在线程池中"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _call_model_sync,
        server_url, model, img_b64, system_prompt, timeout_s
    )


def _parse_json_from_raw(raw: str, model: str = "") -> dict:
    """从模型原始回复中提取 JSON 并解析"""
    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
    json_str = None
    if json_match:
        json_str = json_match.group(1)
    else:
        brace_start = raw.find('{')
        brace_end = raw.rfind('}')
        if brace_start >= 0 and brace_end > brace_start:
            json_str = raw[brace_start:brace_end + 1]
    if json_str:
        try:
            parsed = json.loads(json_str)
            defaults = {
                "content": "", "meaning": "", "scene": "",
                "module": "custom", "category": "OCR导入",
                "tags": [], "tips": "", "has_image_preview": False
            }
            for k, v in defaults.items():
                if k not in parsed or parsed[k] is None:
                    parsed[k] = v
            if isinstance(parsed.get("tags"), str):
                parsed["tags"] = [t.strip() for t in parsed["tags"].split(",") if t.strip()]
            parsed["_model"] = model
            return parsed
        except json.JSONDecodeError:
            pass
    # JSON 解析失败，返回原始文本作为 content
    return {
        "content": raw[:500],
        "meaning": "OCR 识别结果（需手动整理）",
        "scene": "",
        "module": "custom",
        "category": "OCR导入",
        "tags": ["OCR"],
        "tips": "",
        "has_image_preview": False,
        "_raw": raw[:200],
        "_model": model
    }


# ============ STEP 3: 多模型级联 + 重试 ============

async def _ocr_pipeline(image_bytes: bytes, text_region_bytes: bytes = None) -> dict:
    """
    OCR 统一入口：三级重试策略
    1. 主模型 qwen3-vl:8b（严格 prompt）
    2. 空内容 → 简化 prompt 重试一次
    3. 仍空 → fallback 模型 llama3.2-vision:11b
    4. 全部失败 → 返回错误
    """
    cfg = _get_ollama_cfg()
    server_url = cfg.get("server_url", DEFAULT_OLLAMA_URL).rstrip("/")
    target_image = text_region_bytes or image_bytes
    img_b64 = base64.b64encode(target_image).decode("utf-8")

    primary_model = cfg.get("model", DEFAULT_VISION_MODEL)

    # === 阶段1：主模型，严格 prompt ===
    result = await _call_model(server_url, primary_model, img_b64, SYSTEM_PROMPT_STRICT, 120)

    content = (result.get("content") or "").strip()
    if content:
        detected_lang = result.get("_language", "chinese")
        if isinstance(detected_lang, str):
            detected_lang = detected_lang.strip().lower()
        result["_detected_lang"] = detected_lang
        return result

    # === 阶段2：空内容 → 简化 prompt 重试（同一模型） ===
    print(f"[OCR] {primary_model} returned empty, retrying with simple prompt...")
    result2 = await _call_model(server_url, primary_model, img_b64, SYSTEM_PROMPT_SIMPLE, 120)

    content2 = (result2.get("content") or "").strip()
    if content2:
        print(f"[OCR] Simple prompt succeeded, content={repr(content2[:50])}")
        result2["_detected_lang"] = result2.get("_language", "chinese")
        result2["_retry_simple_prompt"] = True
        return result2

    # === 阶段3：fallback 模型 ===
    pool = _get_usable_models()
    fallback_model = pool.get("english", FALLBACK_VISION_MODEL)
    if fallback_model != primary_model:
        print(f"[OCR] Retrying with fallback model: {fallback_model}...")
        result3 = await _call_model(server_url, fallback_model, img_b64, SYSTEM_PROMPT_EN, 120)
        content3 = (result3.get("content") or "").strip()
        if content3:
            print(f"[OCR] Fallback succeeded, content={repr(content3[:50])}")
            result3["_detected_lang"] = "english"
            result3["_fallback"] = True
            return result3

    # === 全部失败 ===
    print(f"[OCR] ALL models failed for this image")
    return {"error": "所有视觉模型均未能提取到内容"}


# ============ STEP 4: LLM 结构化备用 ============

async def _ollama_llm_parse_text(text: str) -> dict:
    """备用：用纯文本 LLM 解析 OCR 文字"""
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


# ============ 工具函数 ============

def _save_temp_file(data: bytes, prefix: str, ext: str = ".jpg") -> str:
    filename = f"{prefix}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(TEMP_DIR, filename)
    with open(path, "wb") as f:
        f.write(data)
    return filename


def _save_thumbnail(image_bytes: bytes) -> tuple:
    """保存缩略图 + 原图到媒体库，返回 (thumb_filename, orig_filename)"""
    from PIL import Image
    import io as _io
    base_name = uuid.uuid4().hex
    # 原图
    orig_filename = f"ocr_{base_name}_orig.jpg"
    orig_path = os.path.join(ORIGINALS_DIR, orig_filename)
    with open(orig_path, "wb") as f:
        f.write(image_bytes)
    # 缩略图 3:2 → 240x160
    img = Image.open(_io.BytesIO(image_bytes))
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
    thumb = img.resize((240, 160), Image.LANCZOS)
    thumb_filename = f"ocr_{base_name}_thumb.jpg"
    thumb_path = os.path.join(THUMB_DIR, thumb_filename)
    thumb.save(thumb_path, format="JPEG", quality=85)
    thumb_size = os.path.getsize(thumb_path) if os.path.exists(thumb_path) else 0
    # 写入媒体资产管理库
    try:
        db = get_db()
        db.execute("""
            INSERT OR IGNORE INTO media_assets
                (filename, original_filename, file_size, original_size,
                 media_type, width, height, mime_type, source)
            VALUES (?, ?, ?, ?, 'image', ?, ?, 'image/jpeg', 'ocr_import')
        """, [thumb_filename, orig_filename, thumb_size, len(image_bytes), w, h])
        db.commit()
    except Exception:
        pass
    return thumb_filename, orig_filename


# ============ API: 预览截图 ============

@router.post("/preview")
async def ocr_preview(file: UploadFile = File(...)):
    """上传截图 → 版面分析 → OCR三级重试 → 结构化提取"""
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        return {"ok": False, "error": "文件超过10MB限制"}
    try:
        layout = _layout_analysis(contents)
        text_region = layout.get("text_region")
        image_region = layout.get("image_region")

        # 保存预览图
        preview_img_name = None
        if image_region:
            preview_img_name = _save_temp_file(image_region, "ocr_img")
        elif text_region:
            preview_img_name = _save_temp_file(text_region, "ocr_txt")

        # OCR 三级重试
        preview = await _ocr_pipeline(contents, text_region)

        layout_meta = {
            "has_image_region": layout.get("has_image_region", False),
            "image_size": layout.get("image_size", "")
        }

        # 检查是否所有模型都失败
        if preview.get("error"):
            return {
                "ok": False,
                "error": preview["error"] + "。请确认截图中有清晰的提示词文字，或检查Ollama视觉模型状态。",
                "layout": layout_meta,
                "temp_files": {"image": preview_img_name} if preview_img_name else {}
            }

        # 即使有返回也检查 content 是否为空
        content = (preview.get("content") or "").strip()
        if not content:
            return {
                "ok": False,
                "error": "OCR未能提取到文字内容。截图可能没有清晰的提示词文字区域，或Ollama视觉模型响应异常。",
                "layout": layout_meta,
                "temp_files": {"image": preview_img_name} if preview_img_name else {}
            }

        return {
            "ok": True, "preview": preview, "layout": layout_meta,
            "temp_files": {"image": preview_img_name} if preview_img_name else {}
        }
    except Exception as e:
        return {"ok": False, "error": f"OCR 处理异常: {str(e)[:200]}"}


# ============ API: 去重检查 ============

@router.post("/check-duplicate")
async def ocr_check_duplicate(data: dict):
    content = (data.get("content") or "").strip()
    if not content:
        return {"ok": True, "duplicate": False, "exists": []}
    db = get_db()
    exact = db.execute(
        "SELECT id, module, content FROM prompts WHERE content = ?",
        [content]
    ).fetchall()
    if exact:
        return {"ok": True, "duplicate": True, "exists": [dict(r) for r in exact], "method": "exact"}
    clean_input = re.sub(r'[\s,.;:!?\u3000\uff0c\u3002\uff1b\uff1a\uff01\uff1f\u3001\u201c\u201d\u2018\u2019\u3010\u3011\u300a\u300b\u3008\u3009\uff08\uff09\[\]\(\)\-_]', '', content)
    if len(clean_input) > 20:
        prefix = clean_input[:30]
        fuzzy = db.execute(
            "SELECT id, module, content FROM prompts WHERE REPLACE(REPLACE(REPLACE(content,' ',''),'\uff0c',''),'\u3002','') LIKE ?",
            [f"%{prefix}%"]
        ).fetchall()
        if fuzzy:
            return {"ok": True, "duplicate": True, "exists": [dict(r) for r in fuzzy], "method": "fuzzy"}
    return {"ok": True, "duplicate": False, "exists": []}


# ============ API: 确认导入 ============

class OcrConfirmInput(BaseModel):
    content: str
    meaning: str = ""
    scene: str = ""
    module: str = "custom"
    category: str = "OCR导入"
    tags: list = []
    tips: str = ""
    temp_image: str = ""
    has_image: bool = False


@router.post("/confirm")
async def ocr_confirm(data: OcrConfirmInput):
    content = data.content.strip()
    if not content:
        return {"ok": False, "error": "内容为空"}
    try:
        db = get_db()
        now = datetime.datetime.now().isoformat()
        meaning = data.meaning or ""
        if data.tips:
            if meaning:
                meaning += "\n✨ " + data.tips[:200]
            else:
                meaning = "✨ " + data.tips[:200]
        db.execute("""
            INSERT INTO prompts (module, category, content, meaning, scene, tags, usage_count, is_builtin, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
        """, [
            data.module or "custom",
            data.category or "OCR导入",
            data.content.strip(),
            meaning,
            data.scene or "",
            json.dumps(data.tags, ensure_ascii=False) if data.tags else "[]",
            now
        ])
        db.commit()
        prompt_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        if data.has_image and data.temp_image:
            src = os.path.join(TEMP_DIR, data.temp_image)
            if os.path.exists(src):
                with open(src, "rb") as f:
                    img_data = f.read()
                if img_data:
                    thumb_filename, orig_filename = _save_thumbnail(img_data)
                    db.execute(
                        "INSERT INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) VALUES (?, ?, 'image', ?)",
                        [prompt_id, thumb_filename, now]
                    )
                    try:
                        db.execute(
                            "UPDATE media_assets SET prompt_id=? WHERE filename=?",
                            [prompt_id, thumb_filename]
                        )
                    except Exception:
                        pass
                    db.commit()
        if data.temp_image:
            tmp_path = os.path.join(TEMP_DIR, data.temp_image)
            if os.path.exists(tmp_path):
                try: os.remove(tmp_path)
                except: pass
        return {"ok": True, "message": "✅ 已导入"}
    except Exception as e:
        return {"ok": False, "error": f"保存失败: {str(e)[:200]}"}


# ============ API: 访问临时文件 ============

@router.get("/temp-file/{filename}")
async def get_temp_file(filename: str):
    import fastapi.responses
    safe_name = os.path.basename(filename)
    path = os.path.join(TEMP_DIR, safe_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return fastapi.responses.FileResponse(path, media_type="image/jpeg")


# ============ API: 模型状态检查 ============

@router.get("/model-status")
async def ocr_model_status():
    cfg = _get_ollama_cfg()
    pool = _get_usable_models()
    server_url = cfg.get("server_url", DEFAULT_OLLAMA_URL).rstrip("/")
    status = {}
    all_models = set(pool.values()) if isinstance(pool, dict) else {pool.get("chinese", "qwen3-vl:8b")}
    try:
        resp = httpx.get(f"{server_url}/api/tags", timeout=5)
        if resp.status_code == 200:
            installed = {m["name"] for m in resp.json().get("models", [])}
            for name in all_models:
                status[name] = "available" if name in installed else "not_found"
        else:
            for name in all_models:
                status[name] = f"ollama_error_{resp.status_code}"
    except Exception as e:
        for name in all_models:
            status[name] = f"connection_failed: {str(e)[:50]}"
    return {
        "config_model": cfg.get("model", DEFAULT_VISION_MODEL),
        "model_pool": pool,
        "model_status": status,
        "fallback_model": FALLBACK_VISION_MODEL
    }
