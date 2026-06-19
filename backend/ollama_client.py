"""
v4.0.0-phase12: Ollama 统一调用工具
所有 AI 功能模块的公共基座 — 配置读取、模型路由、连接检测、超时重试
"""
import json, asyncio, time
from typing import Optional, List
from database import get_db
import httpx

# ============ 默认配置 ============
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"

# 模型能力分级
MODEL_TIERS = {
    "ultra":    ["qwen3.6:27b", "deepseek-r1:14b", "qwen3-coder-next:Q4_K_M"],
    "high":     ["qwen3.5:9b", "qwen2.5-coder:14b", "glm-4.7-flash:latest", "phi4:latest"],
    "medium":   ["qwen3.5:4b", "qwen:7b"],
    "fast":     ["phi3:mini", "phi3:latest"],
}

# 能力路由表：功能 → 模型tier
FUNCTION_MODEL_MAP = {
    "translate":         "high",     # 翻译 — 需要强语言理解
    "translate_fast":    "medium",   # 快速翻译
    "optimize":          "ultra",    # 提示词优化 — 需要强推理
    "optimize_fast":     "high",     # 快速优化
    "auto_tag":          "medium",   # 自动标签 — 中等推理
    "rerank":            "high",     # 搜索重排 — 需要语义理解
    "thumbnail_desc":    "medium",   # 缩略图描述生成
    "vision_ocr":        "high",     # OCR — 视觉模型专用
    "playground":        "high",     # Playground — 用户可切换
}


def get_ollama_config() -> dict:
    """统一读取 Ollama 配置"""
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


def get_model_for(function: str) -> str:
    """
    根据功能获取最佳模型，按优先级查找本地已安装的
    1. 检查用户自定义配置 (ollama_config.{function}_model)
    2. 否则使用 tier 路由表
    """
    cfg = get_ollama_config()

    # 检查功能专属配置
    custom_key = f"{function}_model"
    if custom_key in cfg and cfg[custom_key]:
        return cfg[custom_key]

    # 使用 tier 路由
    tier = FUNCTION_MODEL_MAP.get(function, "medium")
    candidates = MODEL_TIERS.get(tier, MODEL_TIERS["medium"])

    # 检查哪些模型在本地可用（优先用缓存的模型列表）
    available = _get_cached_models()
    for model in candidates:
        for avail in available:
            if avail == model or avail.startswith(model.split(":")[0]):
                return model

    # 回退：使用全局默认模型或配置文件中的 model
    return cfg.get("model") or candidates[0]


# ============ 模型列表缓存 ============
_cached_models: List[str] = []
_cache_time: float = 0
_CACHE_TTL = 300  # 5分钟


def _get_cached_models() -> List[str]:
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


def refresh_model_cache() -> List[str]:
    """强制刷新模型列表缓存"""
    global _cached_models, _cache_time
    _cache_time = 0
    return _get_cached_models()


# ============ 通用调用封装 ============

async def ollama_chat(
    messages: list,
    model: str = None,
    function: str = None,
    temperature: float = 0.1,
    max_tokens: int = 2048,
    timeout_s: float = 120.0,
    stream: bool = False,
) -> dict:
    """
    统一 Ollama Chat API 调用
    - model: 指定模型，不传则按 function 自动路由
    - function: 功能名（用于自动路由）
    - 返回 {"ok": True, "content": "...", "model": "...", "usage": {...}}
    """
    if not model and function:
        model = get_model_for(function)
    if not model:
        model = "qwen3.5:9b"

    server_url = get_server_url()
    payload = {
        "model": model,
        "messages": messages,
        "stream": stream,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        }
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
            resp = await client.post(f"{server_url}/api/chat", json=payload)
            if resp.status_code != 200:
                return {"ok": False, "error": f"Ollama HTTP {resp.status_code}", "model": model}
            result = resp.json()
            content = result.get("message", {}).get("content", "")
            return {
                "ok": True,
                "content": content.strip(),
                "model": model,
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


async def ollama_generate(
    prompt: str,
    system: str = "",
    model: str = None,
    function: str = None,
    temperature: float = 0.1,
    max_tokens: int = 2048,
    timeout_s: float = 120.0,
) -> dict:
    """
    统一 Ollama Generate API 调用（兼容旧版）
    """
    if not model and function:
        model = get_model_for(function)
    if not model:
        model = "qwen3.5:9b"

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

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
            resp = await client.post(f"{server_url}/api/generate", json=payload)
            if resp.status_code != 200:
                return {"ok": False, "error": f"Ollama HTTP {resp.status_code}", "model": model}
            result = resp.json()
            response = (result.get("response") or "").strip()
            return {
                "ok": True,
                "content": response,
                "model": model,
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


async def ollama_stream(
    messages: list,
    model: str = None,
    function: str = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    timeout_s: float = 300.0,
):
    """
    SSE 流式输出生成器 — 用于 Playground / AI 优化器等
    返回 AsyncGenerator，yield 每个 token 的 JSON 字符串
    """
    if not model and function:
        model = get_model_for(function)
    if not model:
        model = "qwen3.5:9b"

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
    m = _re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 尝试直接匹配 JSON 对象
    m = _re.search(r'\{.*\}', raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return {}
