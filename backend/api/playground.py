"""
LLM Playground — 在线提示词测试面板
支持 Ollama（本地）和 OpenAI 兼容 API
"""
import os
import json
import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from database import get_db

router = APIRouter(prefix="/api/playground", tags=["playground"])

# ============ 配置管理 ============

DEFAULT_CONFIG = {
    "provider": "ollama",       # "ollama" | "openai"
    "ollama_url": "http://localhost:11434",
    "ollama_model": "qwen2.5:7b",
    "openai_url": "https://api.openai.com/v1",
    "openai_key": "",
    "openai_model": "gpt-4o-mini",
    "temperature": 0.7,
    "max_tokens": 512,
    "system_prompt": ""
}


def _get_config() -> dict:
    """从数据库读取 playground 配置"""
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='playground_config'").fetchone()
    if row:
        try:
            config = json.loads(row["value"])
            # 合并默认值（防止缺字段）
            for k, v in DEFAULT_CONFIG.items():
                if k not in config:
                    config[k] = v
            return config
        except Exception:
            pass
    return dict(DEFAULT_CONFIG)


def _save_config(config: dict):
    """保存 playground 配置到数据库"""
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('playground_config', ?)",
        [json.dumps(config, ensure_ascii=False)]
    )
    db.commit()


class ConfigUpdate(BaseModel):
    config: dict


@router.get("/config")
def get_playground_config():
    """获取 playground 配置"""
    config = _get_config()
    # 返回时隐藏 API key
    safe = dict(config)
    if safe.get("openai_key"):
        safe["openai_key"] = safe["openai_key"][:6] + "..." if len(safe["openai_key"]) > 6 else "***"
    return {"ok": True, "config": safe}


@router.post("/config")
def update_playground_config(data: ConfigUpdate):
    """更新 playground 配置"""
    current = _get_config()
    for k, v in data.config.items():
        if k in current:
            current[k] = v
    _save_config(current)
    return {"ok": True}


# ============ 测试执行 ============

class TestRequest(BaseModel):
    prompt: str
    provider: str = None
    model: str = None
    temperature: float = None
    max_tokens: int = None
    system_prompt: str = None
    ollama_url: str = None
    openai_url: str = None
    openai_key: str = None


@router.post("/test")
async def test_prompt(data: TestRequest):
    """发送提示词到 LLM 并返回结果"""
    config = _get_config()

    provider = data.provider or config.get("provider", "ollama")
    model = data.model or config.get("ollama_model" if provider == "ollama" else "openai_model", "")
    temperature = data.temperature if data.temperature is not None else config.get("temperature", 0.7)
    max_tokens = data.max_tokens if data.max_tokens is not None else config.get("max_tokens", 512)
    system_prompt = data.system_prompt if data.system_prompt is not None else config.get("system_prompt", "")

    try:
        if provider == "ollama":
            base_url = data.ollama_url or config.get("ollama_url", "http://localhost:11434")
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": data.prompt})

            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(f"{base_url.rstrip('/')}/api/chat", json={
                    "model": model,
                    "messages": messages,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens
                    },
                    "stream": False
                })
                result = resp.json()
                content = result.get("message", {}).get("content", "")
                return {
                    "ok": True,
                    "content": content,
                    "model": model,
                    "provider": "ollama",
                    "usage": {
                        "prompt_tokens": result.get("prompt_eval_count", 0),
                        "completion_tokens": result.get("eval_count", 0),
                    }
                }

        elif provider == "openai":
            base_url = data.openai_url or config.get("openai_url", "https://api.openai.com/v1")
            api_key = data.openai_key or config.get("openai_key", "")

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": data.prompt})

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(f"{base_url.rstrip('/')}/chat/completions", json={
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens
                }, headers=headers)
                result = resp.json()
                content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                usage = result.get("usage", {})
                return {
                    "ok": True,
                    "content": content,
                    "model": model,
                    "provider": "openai",
                    "usage": {
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "completion_tokens": usage.get("completion_tokens", 0),
                    }
                }

        else:
            return {"ok": False, "error": f"不支持的 provider: {provider}"}

    except Exception as e:
        return {"ok": False, "error": str(e)}
