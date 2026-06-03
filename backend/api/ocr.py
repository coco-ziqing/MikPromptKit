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

# 模型池定义：语言 → 最佳模型
MODEL_POOL = {
    "chinese": {
        "model": "qwen3-vl:8b",
        "description": "阿里 Qwen 视觉模型 — 中文OCR最强",
    },
    "english": {
        "model": "llama3.2-vision:11b",
        "description": "Meta LLaMA 3.2 Vision — 英文OCR最强",
    },
    "mixed": {
        "model": "auto",
        "description": "自动并行双模型取最优",
    }
}

# ============ System Prompts（按模型定制） ============

SYSTEM_PROMPT_ZH = """你是一个专业的AI提示词截图分析助手。
注意：图片中的文字可能是中文或英文。

识别截图中的所有文字信息，并严格按照JSON格式返回（不附加任何说明，不使用```json代码块，仅返回纯净JSON）：

{
  "content": "提取截图中的提示词原文（prompt）。如有多段取最重要的一段。如果没有明确提示词，设为空字符串",
  "meaning": "这个提示词的中文释义或简短说明（3-20字）",
  "scene": "适用场景（如：人像摄影/风景/产品展示/概念艺术/视频生成）",
  "module": "所属模块：emotion(人物表情)/color(场景色彩)/tone(画面色调)/composition(构图运镜)/seedance(视频模板)",
  "category": "分类名称",
  "tags": ["标签1", "标签2"],
  "tips": "截图中提取到的参数设置、技巧说明等额外信息",
  "has_image_preview": false
}

没有内容时返回 {"content": "", "meaning": "", "scene": "", "module": "custom", "category": "", "tags": [], "tips": "", "has_image_preview": false}
"""

SYSTEM_PROMPT_EN = """You are a professional AI prompt screenshot analysis assistant.
The image may contain Chinese or English text. Focus on extracting text accurately.

Return ONLY the raw JSON object (no markdown, no code fences, no extra text):

{
  "content": "the extracted prompt text IN ITS ORIGINAL LANGUAGE. If none, empty string",
  "meaning": "short Chinese explanation of what this prompt does (3-20 chars)",
  "scene": "applicable scene in Chinese, e.g. portrait/landscape/product/advertisement",
  "module": "one of: emotion/color/tone/composition/seedance/custom",
  "category": "category name in Chinese",
  "tags": ["tag1", "tag2"],
  "tips": "any additional parameter settings or tips visible in the image",
  "has_image_preview": false
}

If no text content found: {"content": "", "meaning": "", "scene": "", "module": "custom", "category": "", "tags": [], "tips": "", "has_image_preview": false}
"""

LANG_SCAN_PROMPT = """Examine this image. Reply with EXACTLY ONE WORD: chinese, english, or mixed.
Reply with NOTHING else."""


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

async def _pre_scan_language(server_url: str, img_b64: str) -> str:
    """
    快速检测图片文字语言：chinese / english / mixed
    使用 qwen3-vl:8b，极简prompt，只返回一个单词，~5-8秒
    """
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            resp = await client.post(f"{server_url}/api/chat", json={
                "model": "qwen3-vl:8b",
                "messages": [
                    {"role": "user",
                     "content": LANG_SCAN_PROMPT,
                     "images": [img_b64]}
                ],
                "stream": False,
                "options": {"temperature": 0.0}
            })
            if resp.status_code != 200:
                return "chinese"
            raw = resp.json().get("message", {}).get("content", "").strip().lower()
            word = raw.split()[0] if raw else ""
            word = word.strip(".,!?\"'")
            if word in ("english", "en", "eng"):
                return "english"
            elif word in ("mixed", "both", "zh-en", "en-zh"):
                return "mixed"
            else:
                return "chinese"
    except Exception:
        return "chinese"


# ============ STEP 2b: 智能模型路由 ============

def _select_model_for_language(lang: str) -> dict:
    """
    根据检测到的语言选择最佳模型
    返回: {"model": str, "system_prompt": str}
    """
    pool = _get_usable_models()
    fallback_model = "qwen3-vl:8b"

    if lang == "english":
        model_name = pool.get("english", pool.get(lang, fallback_model))
        return {
            "model": model_name,
            "system_prompt": SYSTEM_PROMPT_EN,
            "lang": "english"
        }
    elif lang == "mixed":
        return {
            "model": "dual_parallel",
            "models": [
                pool.get("chinese", "qwen3-vl:8b"),
                pool.get("english", "llama3.2-vision:11b"),
            ],
            "system_prompt": SYSTEM_PROMPT_ZH,
            "system_prompt_en": SYSTEM_PROMPT_EN,
            "lang": "mixed"
        }
    else:
        model_name = pool.get("chinese", pool.get(lang, fallback_model))
        return {
            "model": model_name,
            "system_prompt": SYSTEM_PROMPT_ZH,
            "lang": "chinese"
        }


# ============ STEP 2c: 单模型调用 ============

async def _call_single_model(server_url: str, model: str, img_b64: str,
                              system_prompt: str, timeout_s: int = 60) -> dict:
    """调用单个 Ollama 视觉模型，返回结构化 dict"""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
            resp = await client.post(f"{server_url}/api/chat", json={
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
    智能调度入口：
    1. 预扫描语言
    2. 路由到最佳模型
    3. 返回结构化 JSON
    """
    cfg = _get_ollama_cfg()
    server_url = cfg.get("server_url", DEFAULT_OLLAMA_URL).rstrip("/")
    target_image = text_region_bytes or image_bytes
    img_b64 = base64.b64encode(target_image).decode("utf-8")

    # Stage 1: 预扫描
    lang = await _pre_scan_language(server_url, img_b64)

    # Stage 2: 路由
    route = _select_model_for_language(lang)
    route["_detected_lang"] = lang

    if route.get("model") == "dual_parallel":
        models = route.get("models", ["qwen3-vl:8b", "llama3.2-vision:11b"])
        results = await asyncio.gather(
            _call_single_model(server_url, models[0], img_b64, route["system_prompt"], 60),
            _call_single_model(server_url, models[1], img_b64, route.get("system_prompt_en", route["system_prompt"]), 60),
            return_exceptions=True
        )
        parsed = []
        for r in results:
            if isinstance(r, dict):
                parsed.append(r)
            elif isinstance(r, Exception):
                parsed.append({"error": str(r)[:80]})
        result = _merge_dual_results(parsed)
    else:
        result = await _call_single_model(
            server_url, route["model"], img_b64, route["system_prompt"], 60
        )

    result["_detected_lang"] = lang
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


def _save_thumbnail(image_bytes: bytes) -> str:
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
    thumb = img.resize((240, 160), Image.LANCZOS)
    filename = f"ocr_import_{uuid.uuid4().hex}.jpg"
    path = os.path.join(THUMB_DIR, filename)
    thumb.save(path, format="JPEG", quality=85)
    return filename


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
        text_img_name = None
        if text_region:
            text_img_name = _save_temp_file(text_region, "ocr_txt")
        preview = await _ollama_vision_parse(contents, text_region)
        if preview.get("error"):
            return {
                "ok": False, "error": preview["error"],
                "layout": layout,
                "temp_files": {"image": text_img_name} if text_img_name else {}
            }
        return {
            "ok": True, "preview": preview, "layout": layout,
            "temp_files": {"image": text_img_name} if text_img_name else {}
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
        thumb_filename = None
        if data.has_image and data.temp_image:
            src = os.path.join(TEMP_DIR, data.temp_image)
            if os.path.exists(src):
                with open(src, "rb") as f:
                    thumb_data = f.read()
                if thumb_data:
                    thumb_filename = _save_thumbnail(thumb_data)
        now = datetime.datetime.now().isoformat()
        db.execute("""
            INSERT INTO prompts (content, meaning, scene, module, category, tags, tips,
                                 thumbnail, usage_count, is_custom, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
        """, [
            data.content, data.meaning or "", data.scene or "",
            data.module or "custom", data.category or "OCR\u5bfc\u5165",
            json.dumps(data.tags, ensure_ascii=False) if data.tags else "[]",
            data.tips or "", thumb_filename or "", now, now
        ])
        safe_commit(db)
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
        "detect_prompt": LANG_SCAN_PROMPT
    }
