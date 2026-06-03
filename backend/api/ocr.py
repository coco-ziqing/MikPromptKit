"""
截图导入 — 预扫描语言检测 + 智能模型路由 + Ollama Vision OCR + 结构化
========================================================================
流程: 上传截图 → 版面分析(效果图/文字区分离)
     → [新] 语言预扫描 (qwen3-vl:8b, ~5-8s, 返回 chinese/english/mixed)
     → 根据语言路由最佳模型:
         chinese → qwen3-vl:8b (阿里原生中文, 中文OCR最强)
         english → llama3.2-vision:11b (Meta原生英文, 英文OCR最强)
         mixed   → 双模型并行, 取 content 更长/结构更完整的
     → LLM结构化解析 → 预览确认 → 保存缩略图+创建词条
========================================================================
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

# 视觉模型池（用于 fallback：主模型 qwen3-vl:8b 提取为空时尝试）
FALLBACK_VISION_MODEL = "llama3.2-vision:11b"

# ============ System Prompts（按模型定制） ============

SYSTEM_PROMPT = """Return ONLY JSON {"content":"prompt text","meaning":"chinese explanation short","scene":"scene","module":"emotion|color|tone|composition|seedance|custom","category":"cat","tags":["t"],"tips":"","has_image_preview":false,"_language":"chinese|english|mixed"}. NO MARKDOWN, ONLY JSON."""

# 英文截图的增强 prompt（当检测到 mixed 时用于第二模型）
SYSTEM_PROMPT_EN = """You are a professional AI prompt screenshot analysis assistant.
This image may contain Chinese or English text.

Return ONLY the raw JSON object (no extra text):

{
  "content": "the extracted prompt text IN ITS ORIGINAL LANGUAGE",
  "meaning": "short Chinese explanation",
  "scene": "applicable scene in Chinese",
  "module": "emotion/color/tone/composition/seedance/custom",
  "category": "category name in Chinese",
  "tags": ["tag1", "tag2"],
  "tips": "any parameter settings visible",
  "has_image_preview": false
}

No text: {"content": "", "meaning": "", "scene": "", "module": "custom", "category": "", "tags": [], "tips": "", "has_image_preview": false}
"""


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
    """返回当前可用的视觉模型列表（优先从配置读取，回退默认池）"""
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
    - 效果图区域（最大矩形轮廓）
    - 文字区域（其余部分）

    返回: {
        "image_region": cropped_bytes | None,
        "text_region": cropped_bytes,
        "has_image_region": bool,
        "image_size": str
    }
    """
    from PIL import Image, ImageOps
    import io

    img = Image.open(io.BytesIO(image_bytes))
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    w, h = img.size

    gray = img.convert("L")
    pixels = list(gray.getdata())

    row_brightness = []
    for y in range(h):
        row = pixels[y * w : (y + 1) * w]
        row_brightness.append(sum(row) / len(row))

    blank_threshold = 240
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

    margin_top = int(h * 0.05)
    margin_bottom = int(h * 0.05)
    image_region_bytes = None
    text_region_bytes = None
    has_image_region = False

    interior_blank_runs = [
        run for run in blank_runs
        if run[-1] > margin_top and run[0] < h - margin_bottom
    ]

    if interior_blank_runs:
        best_run = max(interior_blank_runs, key=len)
        split_y = best_run[0] + len(best_run) // 2
        img_region = img.crop((0, 0, w, split_y))
        txt_region = img.crop((0, split_y, w, h))
        if img_region.size[1] > h * 0.15:
            buf = io.BytesIO()
            img_region.save(buf, format="JPEG", quality=90)
            image_region_bytes = buf.getvalue()
            has_image_region = True
        else:
            txt_region = img
        buf = io.BytesIO()
        txt_region.save(buf, format="JPEG", quality=90)
        text_region_bytes = buf.getvalue()
    else:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        text_region_bytes = buf.getvalue()

    return {
        "image_region": image_region_bytes,
        "text_region": text_region_bytes,
        "has_image_region": has_image_region,
        "image_size": f"{w}x{h}"
    }


# ============ STEP 2a: 语言预扫描 (Pre-scan) ============

# 预扫描已废弃：语言检测已内嵌到主提取 SYSTEM_PROMPT 的 _language 字段中
# 不再单独调用模型，避免重复推理耗时


# ============ STEP 2b: 智能模型路由 ============

def _select_model_for_language(lang: str, default_model: str) -> dict:
    """
    根据检测到的语言选择备用模型（仅在主模型返回空内容时触发）
    返回: {"model": str, "system_prompt": str}
    """
    pool = _get_usable_models()
    if lang == "english":
        model_name = pool.get("english", "llama3.2-vision:11b")
        if model_name != default_model:
            return {"model": model_name, "system_prompt": SYSTEM_PROMPT_EN}
    # chinese/mixed/默认都回退到已有主模型，无需二次调用
    return None


# ============ STEP 2c: 单模型调用 ============

def _call_single_model_sync(server_url: str, model: str, img_b64: str,
                              system_prompt: str, timeout_s: int = 120) -> dict:
    """同步调用 Ollama 视觉模型（避免 async httpx 与 Uvicorn 事件循环死锁）"""
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
            resp = client.post(f"{server_url}/api/chat", json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "分析这张截图中的AI提示词信息，返回JSON",
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


async def _call_single_model(server_url: str, model: str, img_b64: str,
                              system_prompt: str, timeout_s: int = 120) -> dict:
    """异步包装：同步调用跑在线程池中，避免事件循环阻塞"""
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _call_single_model_sync,
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
    return {
        "content": raw[:500],
        "meaning": "OCR 识别结果（需手动整理）",
        "scene": "", "module": "custom",
        "category": "OCR导入", "tags": ["OCR"],
        "tips": "", "has_image_preview": False,
        "_raw": raw[:200], "_model": model
    }


# ============ STEP 2d: 双模型并行（中英混合） ============

def _merge_dual_results(results: list) -> dict:
    """合并双模型结果，取 content 最长 + 结构最完整的"""
    valid = [r for r in results if r and not r.get("error") and r.get("content")]
    if not valid:
        return results[0] if results else {"error": "all models failed"}
    valid.sort(key=lambda r: len(r.get("content", "")), reverse=True)
    best = valid[0]
    if len(valid) > 1:
        c1, c2 = len(best.get("content", "")), len(valid[1].get("content", ""))
        if c2 > 0 and abs(c1 - c2) / max(c1, c2) < 0.2:
            def richness(r):
                return len(r.get("tags", [])) + len(r.get("tips", ""))
            valid.sort(key=richness, reverse=True)
            best = valid[0]
    best["_merged"] = True
    return best


# ============ STEP 2e: 统一入口 ============

async def _ollama_vision_parse(image_bytes: bytes, text_region_bytes: bytes = None) -> dict:
    """
    统一入口：调用一次 qwen3-vl:8b，内嵌语言检测
    仅在 content 为空且检测到英文时，fallback 调用 llama3.2-vision:11b
    """
    cfg = _get_ollama_cfg()
    server_url = cfg.get("server_url", DEFAULT_OLLAMA_URL).rstrip("/")
    target_image = text_region_bytes or image_bytes
    img_b64 = base64.b64encode(target_image).decode("utf-8")

    # 默认模型：qwen3-vl:8b（同时提取文字+检测语言）
    default_model = cfg.get("model", DEFAULT_VISION_MODEL)
    result = await _call_single_model(
        server_url, default_model, img_b64, SYSTEM_PROMPT, 120
    )

    # 从结果中读取语言标记
    detected_lang = result.get("_language", "chinese")
    if isinstance(detected_lang, str):
        detected_lang = detected_lang.strip().lower()
    else:
        detected_lang = "chinese"

    # 对英文判断标准化
    if detected_lang in ("eng", "en"):
        detected_lang = "english"

    # 如果主模型提取到内容，直接返回（无论什么语言，qwen3-vl:8b 都够用）
    content = result.get("content", "").strip()
    if content:
        result["_detected_lang"] = detected_lang
        return result

    # 主模型未提取到内容，尝试英文专用模型
    fallback = _select_model_for_language(detected_lang, default_model)
    if fallback:
        result2 = await _call_single_model(
            server_url, fallback["model"], img_b64, fallback["system_prompt"], 120
        )
        content2 = result2.get("content", "").strip()
        if content2:
            result2["_detected_lang"] = detected_lang
            result2["_fallback"] = True
            return result2

    # 都失败了，返回主模型的结果
    result["_detected_lang"] = detected_lang
    return result


# ============ STEP 3: LLM 结构化备用 ============

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

    # 1. 保存原图（原始完整尺寸）
    orig_filename = f"ocr_{base_name}_orig.jpg"
    orig_path = os.path.join(ORIGINALS_DIR, orig_filename)
    with open(orig_path, "wb") as f:
        f.write(image_bytes)

    # 2. 生成缩略图（3:2 裁剪 + 240x160）
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

    # 3. 写入媒体资产管理库
    try:
        from PIL import Image as PILImg
        _tmp = PILImg.open(_io.BytesIO(image_bytes))
        iw, ih = _tmp.size
        db = get_db()
        db.execute("""
            INSERT OR IGNORE INTO media_assets
                (filename, original_filename, file_size, original_size,
                 media_type, width, height, mime_type, source)
            VALUES (?, ?, ?, ?, 'image', ?, ?, 'image/jpeg', 'ocr_import')
        """, [thumb_filename, orig_filename, thumb_size, len(image_bytes), iw, ih])
        db.commit()
    except Exception:
        pass

    return thumb_filename, orig_filename


# ============ API: 预览截图 ============

@router.post("/preview")
async def ocr_preview(file: UploadFile = File(...)):
    """上传截图 -> 版面分析 -> 语言预扫描 -> 模型路由 -> 结构化提取"""
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        return {"ok": False, "error": "文件超过10MB限制"}
    try:
        layout = _layout_analysis(contents)
        text_region = layout.get("text_region")
        image_region = layout.get("image_region")

        # 保存预览图（优先用效果图区域，否则用文字区预览）
        preview_img_name = None
        if image_region:
            preview_img_name = _save_temp_file(image_region, "ocr_img")
        elif text_region:
            preview_img_name = _save_temp_file(text_region, "ocr_txt")

        preview = await _ollama_vision_parse(contents, text_region)

        # layout 包含二进制 bytes，不能直接 JSON 序列化，只返回元数据
        layout_meta = {
            "has_image_region": layout.get("has_image_region", False),
            "image_size": layout.get("image_size", "")
        }
        if preview.get("error"):
            return {
                "ok": False, "error": preview["error"],
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

        # 保存提示词（合并 tips 到 meaning 末尾）
        meaning = data.meaning or ""
        if data.tips:
            if meaning:
                meaning += "\n\u2728 " + data.tips[:200]
            else:
                meaning = "\u2728 " + data.tips[:200]

        db.execute("""
            INSERT INTO prompts (module, category, content, meaning, scene, tags, usage_count, is_builtin, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
        """, [
            data.module or "custom",
            data.category or "OCR\u5bfc\u5165",
            data.content.strip(),
            meaning,
            data.scene or "",
            json.dumps(data.tags, ensure_ascii=False) if data.tags else "[]",
            now
        ])
        db.commit()

        # 获取新 ID
        prompt_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

        # 保存缩略图 + 原图 + 媒体资产入库
        if data.has_image and data.temp_image:
            src = os.path.join(TEMP_DIR, data.temp_image)
            if os.path.exists(src):
                with open(src, "rb") as f:
                    img_data = f.read()
                if img_data:
                    thumb_filename, orig_filename = _save_thumbnail(img_data)
                    # 关联到提示词
                    db.execute(
                        "INSERT INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) VALUES (?, ?, 'image', ?)",
                        [prompt_id, thumb_filename, now]
                    )
                    # 更新 media_assets 的 prompt_id 关联
                    try:
                        db.execute(
                            "UPDATE media_assets SET prompt_id=? WHERE filename=?",
                            [prompt_id, thumb_filename]
                        )
                    except Exception:
                        pass
                    db.commit()

        # 清理临时文件
        if data.temp_image:
            tmp_path = os.path.join(TEMP_DIR, data.temp_image)
            if os.path.exists(tmp_path):
                try: os.remove(tmp_path)
                except: pass

        return {"ok": True, "message": "\u2705 \u5df2\u5bfc\u5165"}
    except Exception as e:
        return {"ok": False, "error": f"\u4fdd\u5b58\u5931\u8d25: {str(e)[:200]}"}


# ============ API: 访问临时文件 ============

@router.get("/temp-file/{filename}")
async def get_temp_file(filename: str):
    import fastapi.responses
    safe_name = os.path.basename(filename)
    path = os.path.join(TEMP_DIR, safe_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="\u6587\u4ef6\u4e0d\u5b58\u5728")
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
