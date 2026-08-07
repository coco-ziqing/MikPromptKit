"""
ComfyUI Ollama 本地模型集成（Phase 3.5 自 api/comfyui.py 拆分）
路由挂载: 主模块 router.include_router(comfyui_ollama_router)，prefix 同为 /api/v2/comfyui
"""
import json

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from database import get_db, safe_commit

router = APIRouter(tags=["comfyui-ollama"])

# ==================== Ollama 本地模型提示词优化 ====================

OLLAMA_DEFAULTS = {"enabled": False, "url": "http://127.0.0.1:11434", "model": "", "language": "en"}


def _get_ollama_config():
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='ollama_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            for k in OLLAMA_DEFAULTS:
                cfg.setdefault(k, OLLAMA_DEFAULTS[k])
            return cfg
        except Exception:
            pass
    return dict(OLLAMA_DEFAULTS)


@router.get("/ollama/status")
def ollama_status():
    """检查 Ollama 连接状态与可用模型列表"""
    cfg = _get_ollama_config()
    url = (cfg.get("url") or "").rstrip("/")
    models = []
    connected = False
    if url:
        try:
            r = httpx.get(f"{url}/api/tags", timeout=5)
            if r.status_code == 200:
                models = [m.get("name", "") for m in (r.json().get("models", []) or []) if m.get("name")]
                connected = True
        except Exception:
            pass
    cfg["enabled"] = connected
    return {"ok": True, "config": cfg, "models": models, "connected": connected}


@router.post("/ollama/config")
def save_ollama_config(data: dict):
    """保存 Ollama 配置（地址/模型/语言/目标字数）"""
    cfg = _get_ollama_config()
    for k in ("url", "model", "language"):
        if data.get(k):
            cfg[k] = str(data[k])
    if data.get("max_chars") is not None:
        cfg["max_chars"] = int(data["max_chars"]) if int(data["max_chars"]) > 0 else 0
    db = get_db()
    db.execute("INSERT OR REPLACE INTO config (key, value) VALUES ('ollama_config', ?)",
               [json.dumps(cfg, ensure_ascii=False)])
    safe_commit()
    return {"ok": True, "config": cfg}


class OllamaEnhanceRequest(BaseModel):
    text: str = ""
    model: str = ""
    language: str = "en"   # en / zh
    max_chars: int = 0      # 目标字数限制（0=不限）


@router.post("/ollama/enhance")
def ollama_enhance(data: OllamaEnhanceRequest):
    """通过本地 Ollama 模型优化扩展提示词（保持原意，增强画面细节；输出中/英文）"""
    if not data.text or not data.text.strip():
        return {"ok": False, "error": "提示词为空"}
    cfg = _get_ollama_config()
    url = (cfg.get("url") or "").rstrip("/")
    model = data.model or cfg.get("model") or ""
    if not model:
        return {"ok": False, "error": "未指定 Ollama 模型，请先在设置中选择"}
    lang = data.language or "en"
    max_chars = data.max_chars or 0
    if lang == "zh":
        sys_prompt = ("你是 AI 图像提示词优化专家。请将给定提示词扩展优化为丰富的画面描述"
                      "（主体、环境、光线、风格、镜头角度、细节质感）。保持原意不变。"
                      "只输出优化后的中文提示词本身，不要任何解释或前后缀。"
                      "输出内容必须为纯文本，禁止包含任何 emoji、表情符号、图标或装饰字符。")
    else:
        sys_prompt = ("You are an expert AI image prompt engineer. Expand and optimize the given prompt "
                      "with vivid visual details (subject, environment, lighting, style, camera angle, "
                      "texture quality). Keep the original intent. Output ONLY the enhanced prompt "
                      "in English, no explanation, no quotes, no emoji.")
    user_msg = data.text
    if max_chars and max_chars > 0:
        user_msg += f"\n\n【长度要求】请将优化后的提示词总长度控制在 {max_chars} 字以内（当前内容 {len(data.text)} 字）。"
    try:
        r = httpx.post(f"{url}/api/chat", json={
            "model": model,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_msg},
            ],
            "stream": False,
            "think": False,
            "options": {"temperature": 0.7},
        }, timeout=180)
        if r.status_code != 200:
            return {"ok": False, "error": f"Ollama HTTP {r.status_code}: {r.text[:150]}"}
        content = (r.json().get("message", {}) or {}).get("content", "").strip()
        if not content:
            return {"ok": False, "error": "Ollama 未返回内容"}
        if content.startswith('"') and content.endswith('"'):
            content = content[1:-1].strip()
        # 记住模型/语言配置
        if model != cfg.get("model") or lang != cfg.get("language"):
            cfg["model"] = model
            cfg["language"] = lang
            db = get_db()
            db.execute("INSERT OR REPLACE INTO config (key, value) VALUES ('ollama_config', ?)",
                       [json.dumps(cfg, ensure_ascii=False)])
            safe_commit()
        return {"ok": True, "text": content, "model": model, "language": lang}
    except Exception as e:
        return {"ok": False, "error": f"Ollama 连接失败: {e}"}
