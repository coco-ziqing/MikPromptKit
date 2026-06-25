# -*- coding: utf-8 -*-
"""直接探测 Ollama HTTP 服务 + 服务端 ollama_client 调用测试 (无 emoji 版)"""
import urllib.request, json, sys, os
sys.path.insert(0, 'backend')

# 1. 直接 HTTP 探测 Ollama
print("=" * 60)
print("  Ollama Service Check & LLM Call Chain Test")
print("=" * 60)

try:
    r = urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=5)
    data = json.loads(r.read())
    models = [m["name"] for m in data.get("models", [])]
    print(f"\n[Ollama HTTP] ONLINE | {len(models)} models: {models}")
except Exception as e:
    print(f"\n[Ollama HTTP] OFFLINE: {e}")

# 2. 服务端 ollama_client 调用测试
print("\n[Server-side LLM] testing ollama_client direct call...")
try:
    from ollama_client import ollama_generate, get_model_for, get_ollama_config
    cfg = get_ollama_config()
    print(f"  config: server={cfg.get('server_url','?')} model={cfg.get('model','?')}")
    
    model = get_model_for("optimize_fast")
    print(f"  model for optimize_fast: {model}")
    
    print(f"  Calling Ollama (timeout=30s)...")
    result = ollama_generate(
        prompt="Decompose this prompt into structured atoms: cyberpunk rainy night alley, neon blue-purple lighting, low angle shot of giant holographic billboard, puddle reflections, 4K high quality",
        system="You are a prompt decomposition expert. Output JSON array only.",
        function="optimize_fast",
        temperature=0.3,
        max_tokens=300,
        timeout_s=30
    )
    ok = result.get("ok")
    content = str(result.get("content",""))[:200]
    print(f"  result: ok={ok}")
    print(f"  content: {content}")
    if result.get("usage"):
        u = result["usage"]
        print(f"  tokens: prompt={u.get('prompt_tokens',0)} completion={u.get('completion_tokens',0)}")
except ImportError as e:
    print(f"  ImportError: {e}")
except Exception as e:
    print(f"  Error: {e}")

print("\n[Done]")
