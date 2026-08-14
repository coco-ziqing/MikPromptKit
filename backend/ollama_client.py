"""
v4.0.0-phase12: 统一 AI 调用工具 — 多提供商路由
所有 AI 功能模块的公共基座 — 配置读取、模型路由、连接检测、超时重试
Phase17.4: 连接池复用 + 自动重试(3次退避) + 保活探测
Phase38: Kimi (Moonshot) 接入主模型路由 — ollama/kimi 双通道自动分发
"""
import asyncio
import json
import os
import time

import httpx

from database import get_db

# ============ Phase17.4: 模块级连接池 ============
# 复用 TCP 连接，避免每次调用建连导致 socket 耗尽
_ollama_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()

async def _get_client(timeout_s: float = 120.0) -> httpx.AsyncClient:
    """获取或创建持久化 AsyncClient（连接池 + keep-alive）"""
    global _ollama_client
    if _ollama_client is None or _ollama_client.is_closed:
        async with _client_lock:
            if _ollama_client is None or _ollama_client.is_closed:
                _ollama_client = httpx.AsyncClient(
                    timeout=httpx.Timeout(timeout_s, connect=8.0, read=timeout_s),
                    limits=httpx.Limits(max_keepalive_connections=4, max_connections=8, keepalive_expiry=30.0),
                    transport=httpx.AsyncHTTPTransport(retries=1),
                )
    return _ollama_client

# ============ 默认配置 ============
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_AI_PROVIDER = "ollama"  # ollama | kimi | openai

# 模型能力分级（ollama 本地模型）
MODEL_TIERS = {
    "ultra":    ["qwen3.5:27b", "deepseek-r1:14b", "qwen3-coder-next:Q4_K_M"],
    "high":     ["glm-4.7-flash:latest", "qwen3.5:9b", "qwen2.5-coder:14b", "phi4:latest"],
    "medium":   ["qwen3.5:9b", "qwen:7b"],
    "fast":     ["phi3:mini", "phi3:latest"],
}

# Kimi 模型 → 按接口规模分级
KIMI_MODEL_TIERS = {
    "ultra":    "kimi-k2.6",
    "high":     "kimi-k2.6",
    "medium":   "kimi-k2.7-code",
    "fast":     "kimi-k2.7-code",
}

# 能力路由表：功能 → 模型tier
FUNCTION_MODEL_MAP = {
    "translate":         "medium",   # 翻译 — 用 medium 避开 thinking 模型
    "translate_fast":    "medium",   # 快速翻译
    "optimize":          "ultra",    # 提示词优化 — 需要强推理
    "optimize_fast":     "high",     # 快速优化
    "auto_tag":          "high",      # 自动标签 — 需要 JSON 输出，避开 thinking 模型
    "rerank":            "high",     # 搜索重排 — 需要语义理解
    "thumbnail_desc":    "medium",   # 缩略图描述生成
    "role_parse":        "high",     # 角色设定解析 — 需 JSON 输出，避开 thinking 模型     
    "vjshi_desc":        "high",     # 光厂素材简介 — 避开 thinking 模型（2026-08-14）
    "vision_ocr":        "high",     # OCR — 视觉模型专用
    "playground":        "high",     # Playground — 用户可切换
}


# ============ Phase38: 全局 AI 提供商配置 ============

def get_ai_config() -> dict:
    """读取全局 AI 提供商配置（ollama/kimi/openai）"""
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='ai_provider_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            return cfg
        except Exception:
            pass
    # 回退默认配置（kimi_key 已在加密存储中，这里不读明文）
    return {
        "provider": DEFAULT_AI_PROVIDER,
        "ollama_url": "http://127.0.0.1:11434",
        "ollama_model": "qwen3.5:9b",
        "kimi_url": "https://api.moonshot.cn/v1",
        "kimi_key": "",  # 从加密存储解密
        "kimi_model": "kimi-k2.6",
    }


def _get_decrypted_kimi_key() -> str:
    """安全读取 Kimi API Key：环境变量 > 加密 DB > 空"""
    # 1. 环境变量（CI/容器注入）
    env_key = os.getenv("KIMI_API_KEY", "").strip()
    if env_key:
        return env_key
    # 2. 加密存储
    try:
        from crypto_utils import decrypt_api_key
        db = get_db()
        row = db.execute("SELECT value FROM config WHERE key='kimi_key_enc'").fetchone()
        if row:
            val = row[0] if isinstance(row, tuple) else row["value"]
            if val:
                decrypted = decrypt_api_key(val)
                if decrypted:
                    return decrypted
    except Exception as e:
        import traceback
        print(f"[SECURITY] kimi_key decrypt failed: {type(e).__name__}: {e}")
        traceback.print_exc()
    return ""


def save_ai_config(cfg: dict):
    """保存全局 AI 提供商配置"""
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('ai_provider_config', ?)",
        [json.dumps(cfg, ensure_ascii=False)]
    )
    db.commit()


def get_ollama_config() -> dict:
    """统一读取 Ollama 配置（兼容旧接口）"""
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='ollama_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            return cfg
        except Exception:
            pass
    return {"server_url": DEFAULT_OLLAMA_URL, "model": "qwen3.5:9b"}


def save_ollama_config(cfg: dict):
    """统一保存 Ollama 配置"""
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('ollama_config', ?)",
        [json.dumps(cfg, ensure_ascii=False)]
    )
    db.commit()


def get_server_url() -> str:
    """获取 Ollama 服务地址"""
    cfg = get_ollama_config()
    return (cfg.get("server_url") or DEFAULT_OLLAMA_URL).rstrip("/")


def get_effective_provider(provider: str = None) -> str:
    """获取当前生效的 AI 提供商"""
    if provider:
        return provider
    cfg = get_ai_config()
    return cfg.get("provider", DEFAULT_AI_PROVIDER)


def get_model_for(function: str, provider: str = None) -> str:
    """
    根据功能获取最佳模型
    1. 检查用户自定义配置
    2. 按 provider 路由到对应 tier 表
    3. 回退默认模型
    """
    prov = get_effective_provider(provider)
    tier = FUNCTION_MODEL_MAP.get(function, "medium")

    if prov == "kimi":
        return KIMI_MODEL_TIERS.get(tier, "kimi-k2.6")

    # Ollama: 检查功能专属配置
    cfg = get_ollama_config()
    custom_key = f"{function}_model"
    if custom_key in cfg and cfg[custom_key]:
        return cfg[custom_key]

    # Ollama tier 路由
    candidates = MODEL_TIERS.get(tier, MODEL_TIERS["medium"])
    available = _get_cached_models()
    for model in candidates:
        for avail in available:
            if avail == model or avail.startswith(model.split(":")[0]):
                return model

    return cfg.get("model") or candidates[0]


# ============ 模型列表缓存 ============
_cached_models: list[str] = []
_cache_time: float = 0
_CACHE_TTL = 300  # 5分钟


def _get_cached_models() -> list[str]:
    """获取本地 Ollama 模型列表（5分钟缓存）"""
    global _cached_models, _cache_time
    now = time.time()
    if _cached_models and (now - _cache_time) < _CACHE_TTL:
        return _cached_models
    try:
        url = get_server_url()
        with httpx.Client(timeout=5) as client:
            resp = client.get(f"{url}/api/tags")
            if resp.status_code == 200:
                models = [m.get("name", "") for m in resp.json().get("models", [])]
                _cached_models = models
                _cache_time = now
                return models
    except Exception:
        pass
    return _cached_models


def refresh_model_cache() -> list[str]:
    """强制刷新模型列表缓存"""
    global _cached_models, _cache_time
    _cache_time = 0
    return _get_cached_models()


# ============ 通用调用封装（多提供商） ============

async def _kimi_chat(
    messages: list,
    model: str = "kimi-k2.6",
    temperature: float = 1.0,
    max_tokens: int = 4096,
    timeout_s: float = 120.0,
) -> dict:
    """Kimi (Moonshot) OpenAI 兼容 Chat API"""
    cfg = get_ai_config()
    api_key = _get_decrypted_kimi_key()
    if not api_key:
        return {"ok": False, "error": "Kimi API key 未配置", "model": model}
    base_url = (cfg.get("kimi_url", "https://api.moonshot.cn/v1")).rstrip("/")

    # K2 系列只接受 temperature=1
    req_temp = 1.0 if model.startswith("kimi-k2") else temperature

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                json={
                    "model": model, "messages": messages,
                    "temperature": req_temp, "max_tokens": max_tokens
                },
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            )
            if resp.status_code != 200:
                err_detail = resp.text[:200]
                return {"ok": False, "error": f"Kimi HTTP {resp.status_code}: {err_detail}", "model": model}
            r = resp.json()
            if "error" in r:
                return {"ok": False, "error": r["error"].get("message", str(r["error"])), "model": model}
            msg = r.get("choices", [{}])[0].get("message", {})
            content = msg.get("content", "") or ""
            # thinking 模型：如果 content 为空但有 reasoning，使用 reasoning
            if not content.strip() and msg.get("reasoning_content", "").strip():
                content = msg["reasoning_content"]
            usage = r.get("usage", {})
            return {
                "ok": True,
                "content": content.strip(),
                "model": model,
                "provider": "kimi",
                "usage": {
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", 0),
                }
            }
    except httpx.TimeoutException:
        return {"ok": False, "error": f"Kimi 超时 ({timeout_s}s)", "model": model}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200], "model": model}


async def _ollama_chat_impl(
    messages: list,
    model: str,
    temperature: float = 0.1,
    max_tokens: int = 2048,
    timeout_s: float = 120.0,
    think: bool = None,
) -> dict:
    """Ollama Chat 实现"""
    server_url = get_server_url()
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        }
    }
    if think is not None:
        payload["think"] = think
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
            resp = await client.post(f"{server_url}/api/chat", json=payload)
            if resp.status_code != 200:
                return {"ok": False, "error": f"Ollama HTTP {resp.status_code}", "model": model}
            result = resp.json()
            msg = result.get("message", {})
            content = msg.get("content", "") or ""
            if not content.strip() and msg.get("thinking", "").strip():
                content = msg["thinking"]
            return {
                "ok": True,
                "content": content.strip(),
                "model": model,
                "provider": "ollama",
                "is_thinking": bool(msg.get("thinking", "").strip()),
                "usage": {
                    "prompt_tokens": result.get("prompt_eval_count", 0),
                    "completion_tokens": result.get("eval_count", 0),
                    "duration_ms": result.get("total_duration", 0) // 1_000_000 if result.get("total_duration") else 0,
                }
            }
    except httpx.TimeoutException:
        return {"ok": False, "error": f"Ollama 超时 ({timeout_s}s)", "model": model}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200], "model": model}


async def ollama_chat(
    messages: list,
    model: str = None,
    function: str = None,
    provider: str = None,
    temperature: float = 0.1,
    max_tokens: int = 2048,
    timeout_s: float = 120.0,
    stream: bool = False,
    think: bool = None,
) -> dict:
    """
    统一 AI Chat API（多提供商路由）
    - model: 指定模型，不传则按 function + provider 自动路由
    - function: 功能名（用于自动路由，决定 tier）
    - provider: 提供商（ollama/kimi），不传走全局配置
    - think: 关闭思考模式（qwen3 等 thinking 模型，False 时直接输出答案更快）
    - 返回 {"ok": True, "content": "...", "model": "...", "provider": "...", "usage": {...}}
    """
    prov = get_effective_provider(provider)
    if not model and function:
        model = get_model_for(function, prov)
    if not model:
        model = "kimi-k2.6" if prov == "kimi" else "qwen3.5:9b"

    if prov == "kimi":
        return await _kimi_chat(messages, model, temperature, max_tokens, timeout_s)
    else:
        return await _ollama_chat_impl(messages, model, temperature, max_tokens, timeout_s, think)


async def ollama_generate(
    prompt: str,
    system: str = "",
    model: str = None,
    function: str = None,
    provider: str = None,
    temperature: float = 0.1,
    max_tokens: int = 2048,
    timeout_s: float = 120.0,
    max_retries: int = 3,
) -> dict:
    """
    统一 AI Generate API（多提供商路由）
    Phase38: ollama/kimi 双通道，自动重试
    """
    prov = get_effective_provider(provider)
    if not model and function:
        model = get_model_for(function, prov)
    if not model:
        model = "kimi-k2.6" if prov == "kimi" else "qwen3.5:9b"

    if prov == "kimi":
        # Kimi: 用 chat 接口模拟 generate
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return await _kimi_chat(messages, model, temperature, max_tokens, timeout_s)

    # Ollama Generate API
    server_url = get_server_url()
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        }
    }
    if system:
        payload["system"] = system

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            client = await _get_client(timeout_s)
            resp = await client.post(f"{server_url}/api/generate", json=payload)
            if resp.status_code != 200:
                err_text = resp.text[:200]
                if resp.status_code >= 500 and attempt < max_retries:
                    wait = min(1.0 * (2 ** attempt), 8.0)
                    await asyncio.sleep(wait)
                    continue
                return {"ok": False, "error": f"Ollama HTTP {resp.status_code}: {err_text}", "model": model}

            result = resp.json()
            response = (result.get("response") or "").strip()

            # qwen3.5:9b 偶发空返回 → 提高 temperature 重试
            if not response and attempt < max_retries:
                payload["options"]["temperature"] = min(temperature + 0.15 * (attempt + 1), 0.7)
                wait = min(1.0 * (2 ** attempt), 4.0)
                await asyncio.sleep(wait)
                continue

            return {
                "ok": True,
                "content": response,
                "model": model,
                "provider": "ollama",
                "usage": {
                    "prompt_tokens": result.get("prompt_eval_count", 0),
                    "completion_tokens": result.get("eval_count", 0),
                    "duration_ms": result.get("total_duration", 0) // 1_000_000 if result.get("total_duration") else 0,
                }
            }
        except httpx.TimeoutException:
            last_error = f"Ollama 超时 ({timeout_s}s)"
            if attempt < max_retries:
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
        except (httpx.ConnectError, httpx.RemoteProtocolError) as e:
            last_error = f"Ollama 连接错误: {str(e)[:100]}"
            if attempt < max_retries:
                wait = min(1.5 * (2 ** attempt), 6.0)
                await asyncio.sleep(wait)
                continue
        except Exception as e:
            last_error = str(e)[:200]
            if attempt < max_retries:
                await asyncio.sleep(1.0)
                continue

    return {"ok": False, "error": last_error or "Ollama 调用失败", "model": model}


async def ollama_stream(
    messages: list,
    model: str = None,
    function: str = None,
    provider: str = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    timeout_s: float = 300.0,
    think: bool = None,
):
    """
    SSE 流式输出生成器 — 多提供商路由
    返回 AsyncGenerator，yield 每个 token 的 JSON 字符串
    Phase38: ollama/kimi 双通道流式
    think: 关闭思考模式（qwen3 等 thinking 模型）
    """
    prov = get_effective_provider(provider)
    if not model and function:
        model = get_model_for(function, prov)
    if not model:
        model = "kimi-k2.6" if prov == "kimi" else "qwen3.5:9b"

    if prov == "kimi":
        cfg = get_ai_config()
        api_key = _get_decrypted_kimi_key()
        base_url = (cfg.get("kimi_url", "https://api.moonshot.cn/v1")).rstrip("/")
        req_temp = 1.0 if model.startswith("kimi-k2") else temperature
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
                async with client.stream(
                    "POST", f"{base_url}/chat/completions",
                    json={
                        "model": model, "messages": messages,
                        "temperature": req_temp, "max_tokens": max_tokens,
                        "stream": True
                    },
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                ) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                yield json.dumps({"done": True}) + "\n"
                                break
                            try:
                                chunk = json.loads(data)
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                content = delta.get("content", "")
                                yield json.dumps({"message": {"content": content}}) + "\n"
                            except json.JSONDecodeError:
                                pass
        except Exception as e:
            yield json.dumps({"error": str(e)}) + "\n"
        return

    # Ollama 流式
    server_url = get_server_url()
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        }
    }
    if think is not None:
        payload["think"] = think
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
        async with client.stream("POST", f"{server_url}/api/chat", json=payload) as resp:
            if resp.status_code != 200:
                yield json.dumps({"error": f"Ollama HTTP {resp.status_code}"}) + "\n"
                return
            async for line in resp.aiter_lines():
                if line:
                    yield line + "\n"


# ============ 提取 JSON 工具 ============
import re as _re


def extract_json(raw: str) -> dict:
    """从 LLM 原始输出中提取 JSON"""
    # 尝试 code fence
    m = _re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, _re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 尝试直接匹配 JSON 对象
    m = _re.search(r'\{.*\}', raw, _re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return {}
