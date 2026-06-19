"""
v4.0.0-phase12.4: Playground 升级
- SSE 流式输出 (/stream)
- 多轮对话历史 (内存存储 + API)
- 多模型对比 (/compare)
- 统一 ollama_client 调用
"""
import json, time, hashlib
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from database import get_db
from ollama_client import ollama_chat, ollama_stream, get_model_for, get_server_url

router = APIRouter(prefix="/api/playground", tags=["playground"])

# ============ 配置 ============

DEFAULT_CONFIG = {
    "provider": "ollama",
    "ollama_url": "http://localhost:11434",
    "ollama_model": "qwen3.5:9b",
    "openai_url": "https://api.openai.com/v1",
    "openai_key": "",
    "openai_model": "gpt-4o-mini",
    "temperature": 0.7,
    "max_tokens": 2048,
    "system_prompt": "",
    "compare_models": ["qwen3.5:9b", "qwen3.6:27b"],  # 对比模式默认模型
}


def _get_config() -> dict:
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='playground_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            for k, v in DEFAULT_CONFIG.items():
                if k not in cfg:
                    cfg[k] = v
            return cfg
        except Exception:
            pass
    return dict(DEFAULT_CONFIG)


def _save_config(cfg: dict):
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('playground_config', ?)",
        [json.dumps(cfg, ensure_ascii=False)]
    )
    db.commit()


# ============ 对话历史（内存存储） ============
# session_id → [{role, content, time}, ...]
_conversations: dict = {}
_MAX_HISTORY = 50


def _init_conversation_table():
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS playground_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL DEFAULT 'default',
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            model TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    db.commit()


_init_conversation_table()


# ============ Models ============

class ConfigUpdate(BaseModel):
    config: dict

class TestRequest(BaseModel):
    prompt: str
    provider: str = None
    model: str = None
    temperature: float = None
    max_tokens: int = None
    system_prompt: str = None
    session_id: str = "default"

class CompareRequest(BaseModel):
    prompt: str
    models: list = []
    temperature: float = 0.7
    max_tokens: int = 2048
    system_prompt: str = ""


# ============ API ============

@router.get("/config")
def get_config():
    cfg = _get_config()
    safe = dict(cfg)
    if safe.get("openai_key"):
        safe["openai_key"] = safe["openai_key"][:6] + "..."
    return {"ok": True, "config": safe}


@router.post("/config")
def update_config(data: ConfigUpdate):
    current = _get_config()
    for k, v in data.config.items():
        if k in current:
            current[k] = v
    _save_config(current)
    return {"ok": True}


@router.post("/test")
async def test_prompt(data: TestRequest):
    """发送提示词到 LLM — 支持多轮对话历史"""
    cfg = _get_config()
    provider = data.provider or cfg.get("provider", "ollama")
    model = data.model or cfg.get("ollama_model", "qwen3.5:9b")
    temperature = data.temperature if data.temperature is not None else cfg["temperature"]
    max_tokens = data.max_tokens if data.max_tokens is not None else cfg["max_tokens"]
    system = data.system_prompt if data.system_prompt is not None else cfg["system_prompt"]
    sid = data.session_id or "default"

    # 构建消息（含历史）
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    history = _get_history(sid, 10)
    messages.extend(history)
    messages.append({"role": "user", "content": data.prompt})

    if provider == "ollama":
        result = await ollama_chat(
            messages=messages, model=model,
            temperature=temperature, max_tokens=max_tokens, timeout_s=120
        )
        if result.get("ok"):
            _save_message(sid, "user", data.prompt, model)
            _save_message(sid, "assistant", result["content"], model)
        return result

    elif provider == "openai":
        try:
            import httpx
            base_url = cfg.get("openai_url", "https://api.openai.com/v1")
            api_key = cfg.get("openai_key", "")
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(f"{base_url.rstrip('/')}/chat/completions", json={
                    "model": model, "messages": messages,
                    "temperature": temperature, "max_tokens": max_tokens
                }, headers=headers)
                r = resp.json()
                content = r.get("choices", [{}])[0].get("message", {}).get("content", "")
                usage = r.get("usage", {})
                _save_message(sid, "user", data.prompt, model)
                _save_message(sid, "assistant", content, model)
                return {"ok": True, "content": content, "model": model, "provider": "openai",
                        "usage": {"prompt_tokens": usage.get("prompt_tokens", 0),
                                  "completion_tokens": usage.get("completion_tokens", 0)}}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": False, "error": f"不支持的 provider: {provider}"}


@router.post("/stream")
async def test_stream(request: Request):
    """SSE 流式输出 — 支持多轮对话历史"""
    body = await request.json()
    cfg = _get_config()
    model = body.get("model") or cfg.get("ollama_model", "qwen3.5:9b")
    temperature = body.get("temperature", cfg["temperature"])
    max_tokens = body.get("max_tokens", cfg["max_tokens"])
    system = body.get("system_prompt", cfg["system_prompt"])
    prompt = body.get("prompt", "")
    sid = body.get("session_id", "default")

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    history = _get_history(sid, 8)
    messages.extend(history)
    messages.append({"role": "user", "content": prompt})

    _save_message(sid, "user", prompt, model)

    # 用列表收集完整回复
    full_content = [""]

    async def _stream():
        async for line in ollama_stream(
            messages=messages, model=model,
            temperature=temperature, max_tokens=max_tokens, timeout_s=300
        ):
            try:
                chunk = json.loads(line)
                if "message" in chunk and "content" in chunk["message"]:
                    full_content[0] += chunk["message"]["content"]
                if chunk.get("done"):
                    _save_message(sid, "assistant", full_content[0], model)
            except Exception:
                pass
            yield line

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.post("/compare")
async def compare_models(data: CompareRequest):
    """多模型对比 — 并发调用多个模型"""
    import asyncio

    cfg = _get_config()
    models = data.models if data.models else cfg.get("compare_models", ["qwen3.5:9b", "qwen3.6:27b"])
    if not models:
        models = ["qwen3.5:9b"]

    models = models[:4]  # 最多4个
    temperature = data.temperature if data.temperature is not None else cfg["temperature"]
    max_tokens = data.max_tokens if data.max_tokens is not None else cfg["max_tokens"]
    system = data.system_prompt or cfg["system_prompt"]

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": data.prompt})

    async def _call_one(model: str):
        t0 = time.time()
        result = await ollama_chat(
            messages=messages, model=model,
            temperature=temperature, max_tokens=max_tokens, timeout_s=180
        )
        elapsed = round((time.time() - t0) * 1000)
        return {
            "model": model,
            "ok": result.get("ok", False),
            "content": result.get("content", "") if result.get("ok") else "",
            "error": result.get("error", "") if not result.get("ok") else "",
            "elapsed_ms": elapsed,
            "usage": result.get("usage", {}),
        }

    tasks = [_call_one(m) for m in models]
    results = await asyncio.gather(*tasks)

    return {
        "ok": True,
        "prompt": data.prompt[:200],
        "results": results,
    }


@router.get("/history/{session_id}")
def get_history(session_id: str = "default", limit: int = 50):
    """获取对话历史"""
    return {"ok": True, "session_id": session_id, "history": _get_history(session_id, limit)}


@router.post("/history/clear")
def clear_history(session_id: str = "default"):
    """清除对话历史"""
    _clear_history(session_id)
    return {"ok": True, "message": f"已清除 {session_id} 的对话历史"}


@router.get("/models")
def list_models():
    """列出可用模型"""
    from ollama_client import refresh_model_cache
    models = refresh_model_cache()
    return {"ok": True, "models": models, "count": len(models)}


# ============ 内部函数 ============

def _get_history(session_id: str, limit: int) -> list:
    """获取内存中的对话历史"""
    hist = _conversations.get(session_id, [])
    return hist[-limit * 2:] if hist else []  # user+assistant 成对


def _save_message(session_id: str, role: str, content: str, model: str = ""):
    """保存消息到内存 + 数据库"""
    if not content:
        return
    msg = {"role": role, "content": content, "time": time.strftime("%H:%M:%S")}
    if session_id not in _conversations:
        _conversations[session_id] = []
    _conversations[session_id].append(msg)
    # 限制长度
    if len(_conversations[session_id]) > _MAX_HISTORY * 2:
        _conversations[session_id] = _conversations[session_id][-_MAX_HISTORY * 2:]

    # 写数据库
    try:
        db = get_db()
        db.execute(
            "INSERT INTO playground_history (session_id, role, content, model) VALUES (?,?,?,?)",
            [session_id, role, content, model]
        )
        db.commit()
    except Exception:
        pass


def _clear_history(session_id: str):
    _conversations.pop(session_id, None)
    try:
        db = get_db()
        db.execute("DELETE FROM playground_history WHERE session_id=?", [session_id])
        db.commit()
    except Exception:
        pass
