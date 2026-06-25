# -*- coding: utf-8 -*-
"""Check Ollama + start if needed + run fresh decompose test"""
import urllib.request, json, time, subprocess, sys

def check_ollama():
    try:
        r = urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=5)
        data = json.loads(r.read())
        models = [m["name"] for m in data.get("models", [])]
        return True, models
    except:
        return False, []

# 1. Check
ok, models = check_ollama()
if ok:
    print(f"[OK] Ollama online: {len(models)} models")
else:
    print("[INFO] Ollama offline, starting...")
    try:
        # Start ollama serve in background
        subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("[INFO] Waiting for Ollama to start...")
        for i in range(30):
            time.sleep(2)
            ok, models = check_ollama()
            if ok:
                print(f"[OK] Ollama started: {len(models)} models")
                break
            print(f"  waiting... ({i+1}/30)")
        if not ok:
            print("[FAIL] Ollama failed to start within 60s")
            sys.exit(1)
    except Exception as e:
        print(f"[FAIL] Cannot start Ollama: {e}")
        sys.exit(1)

# 2. Verify qwen3.5:4b available
target = "qwen3.5:4b"
if target not in models:
    print(f"[WARN] {target} not found, pulling...")
    subprocess.run(["ollama", "pull", target], timeout=300)
    ok, models = check_ollama()
    if target not in models:
        print(f"[FAIL] Cannot pull {target}")
        sys.exit(1)
    print(f"[OK] {target} pulled")

# 3. PromptKit health
try:
    r = urllib.request.urlopen("http://127.0.0.1:8080/api/health/check", timeout=5)
    data = json.loads(r.read())
    ollama_health = data.get("checks", {}).get("ollama", {})
    print(f"[PromptKit] Ollama health: ok={ollama_health.get('ok')} models={ollama_health.get('model_count',0)}")
except Exception as e:
    print(f"[WARN] PromptKit health check: {e}")

print("\n[READY] Ollama + PromptKit ready for decompose test")
