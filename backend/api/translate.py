"""
翻译 API — 提示词中英文互译（Ollama 本地大模型 + 缓存）
"""
import json, hashlib
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_db, safe_commit
import httpx

router = APIRouter(prefix="/api/translate", tags=["translate"])

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "phi3:mini"

SYSTEM_PROMPT_ZH = "你是一个提示词翻译助手。请将以下英文AI提示词翻译成中文，保持专业术语准确，只返回翻译结果，不要加任何解释。"
SYSTEM_PROMPT_EN = "你是一个提示词翻译助手。请将以下中文AI提示词翻译成英文，保持专业术语准确，只返回翻译结果，不要加任何解释。"


def _get_ollama_config():
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='ollama_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            return cfg
        except Exception:
            pass
    return {"server_url": DEFAULT_OLLAMA_URL, "model": DEFAULT_MODEL}


def _save_ollama_config(cfg: dict):
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('ollama_config', ?)",
        [json.dumps(cfg, ensure_ascii=False)]
    )
    db.commit()


class ConfigUpdate(BaseModel):
    server_url: str = ""
    model: str = ""


class TranslateRequest(BaseModel):
    prompt_id: int
    target_lang: str = "zh"


def _init_translations_table():
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_id INTEGER NOT NULL,
            lang TEXT NOT NULL DEFAULT 'zh',
            content TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(prompt_id, lang)
        )
    """)
    db.commit()


@router.get("/config")
def get_config():
    cfg = _get_ollama_config()
    # Ensure table exists
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_id INTEGER NOT NULL,
            lang TEXT NOT NULL DEFAULT 'zh',
            content TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(prompt_id, lang)
        )
    """)
    db.commit()
    return {"ok": True, "config": cfg}


@router.post("/config")
def update_config(data: ConfigUpdate):
    cfg = {"server_url": data.server_url or DEFAULT_OLLAMA_URL, "model": data.model or DEFAULT_MODEL}
    _save_ollama_config(cfg)
    return {"ok": True}


@router.get("/{prompt_id}")
async def translate_prompt(prompt_id: int, target_lang: str = "zh"):
    """翻译指定提示词 — 先查缓存，缓存命中直接返回；否则调 Ollama 翻译后缓存"""
    # 1. 检查提示词存在
    db = get_db()
    row = db.execute("SELECT id, content, module, category FROM prompts WHERE id=?", [prompt_id]).fetchone()
    if not row:
        raise HTTPException(404, "提示词不存在")

    original_content = row["content"]
    if not original_content or not original_content.strip():
        raise HTTPException(400, "提示词内容为空")

    # 2. 判断目标语言
    target_lang = target_lang or "zh"
    if target_lang not in ("zh", "en"):
        raise HTTPException(400, "仅支持 zh（中文）或 en（英文）")

    source_lang = "en" if target_lang == "zh" else "zh"

    # 3. 查缓存
    cache = db.execute(
        "SELECT id, content, lang, created_at FROM translations WHERE prompt_id=? AND lang=?",
        [prompt_id, target_lang]
    ).fetchone()

    if cache:
        return {
            "ok": True,
            "prompt_id": prompt_id,
            "original": original_content,
            "translated": cache["content"],
            "lang": target_lang,
            "cached": True,
            "created_at": cache["created_at"]
        }

    # 4. 检查原始语言（如果是中文则翻英，英文则翻中）
    # 用简单启发式：含中文字符视为中文
    import re
    has_chinese = bool(re.search(r'[\u4e00-\u9fff]', original_content))

    if has_chinese and target_lang == "zh":
        # 已经是中文，返回原文
        return {
            "ok": True,
            "prompt_id": prompt_id,
            "original": original_content,
            "translated": original_content,
            "lang": "zh",
            "cached": False,
            "note": "原文已是中文"
        }
    elif not has_chinese and target_lang == "en":
        return {
            "ok": True,
            "prompt_id": prompt_id,
            "original": original_content,
            "translated": original_content,
            "lang": "en",
            "cached": False,
            "note": "原文已是英文"
        }

    # 5. 调 Ollama 翻译
    cfg = _get_ollama_config()
    server_url = cfg.get("server_url", DEFAULT_OLLAMA_URL).rstrip("/")
    model = cfg.get("model", DEFAULT_MODEL)

    if target_lang == "zh":
        system_prompt = SYSTEM_PROMPT_ZH
        prompt_text = f"Translate the following AI prompt to Chinese:\n\n{original_content}"
    else:
        system_prompt = SYSTEM_PROMPT_EN
        prompt_text = f"Translate the following AI prompt to English:\n\n{original_content}"

    ollama_payload = {
        "model": model,
        "system": system_prompt,
        "prompt": prompt_text,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 1024}
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            resp = await client.post(f"{server_url}/api/generate", json=ollama_payload)
            if resp.status_code != 200:
                return {"ok": False, "error": f"Ollama 返回错误 (HTTP {resp.status_code}): {resp.text[:200]}"}
            result = resp.json()
            translated = (result.get("response") or "").strip()
            if not translated:
                return {"ok": False, "error": "Ollama 返回空结果"}
    except Exception as e:
        return {"ok": False, "error": f"Ollama 调用失败: {str(e)}。请检查 Ollama 是否运行在 {server_url}"}

    # 6. 存入缓存
    try:
        db.execute(
            "INSERT OR REPLACE INTO translations (prompt_id, lang, content, created_at) VALUES (?, ?, ?, datetime('now','localtime'))",
            [prompt_id, target_lang, translated]
        )
        db.commit()
    except Exception:
        pass

    return {
        "ok": True,
        "prompt_id": prompt_id,
        "original": original_content,
        "translated": translated,
        "lang": target_lang,
        "cached": False,
        "model": model
    }


# Make sure BaseModel is imported
from pydantic import BaseModel
