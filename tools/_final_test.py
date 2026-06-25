# -*- coding: utf-8 -*-
"""Auto-detect port + run decompose test"""
import urllib.request, json, time, sys

# auto-find active promptkit port
def find_port():
    for p in range(8080, 8095):
        try:
            r = urllib.request.urlopen(f"http://127.0.0.1:{p}/openapi.json", timeout=2)
            spec = json.loads(r.read())
            paths = [k for k in spec.get("paths", {}) if "atom" in k.lower()]
            if len(paths) >= 10:
                return p, len(paths)
        except:
            pass
    return None, 0

port, routes = find_port()
if not port:
    print("No PromptKit server with atoms API found. Start with: python backend/main.py")
    sys.exit(1)

print(f"Found server on port {port} ({routes} atom routes)")

BASE = f"http://127.0.0.1:{port}"
def api(path, data=None, timeout=90):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"} if body else {})
    r = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(r.read())

# Delete ALL old decomposes first (via health API to get DB, or just use new prompts)
# Use entirely new, never-seen prompts
tests = [
    "a futuristic neon-lit marketplace at midnight, floating holographic stalls, rain-slicked streets reflecting purple light, cyberpunk architecture, 8K",
    "hand-drawn watercolor illustration of a cozy cottage in the woods, warm fireplace glow through windows, autumn leaves falling, storybook style",
    "macro photography of a dewdrop on a spider web at dawn, golden hour backlight, intricate water refraction, bokeh background, ultra detailed",
]

print("=" * 70)
print("  Phase15 Final Decompose Test (qwen3.5:4b + 4000 tokens)")
print("=" * 70)

ok_count = 0
for i, prompt in enumerate(tests, 1):
    t0 = time.time()
    try:
        r = api("/api/v4/atoms/decompose", {"prompt": prompt, "media_type": "image"}, timeout=90)
        elapsed = time.time() - t0
        atoms = r.get("atoms", [])
        cached = r.get("cached", False)
        score = r.get("quality_score", 0)
        
        print(f"\n[{i}/3] {elapsed:.1f}s | cached={cached} | score={score} | atoms={len(atoms)}")
        if len(atoms) > 1:
            ok_count += 1
        for a in atoms[:8]:
            print(f"  [{a.get('type','?')}] \"{a.get('text','')[:50]}\" w={a.get('weight',0)} kw={a.get('keywords',[])}")
    except Exception as e:
        print(f"\n[{i}/3] FAIL: {e}")

print(f"\n[RESULT] {ok_count}/3 tests decomposed >1 atom")
if ok_count >= 2:
    print("[PASS] Ollama LLM decompose chain works!")
else:
    print("[FAIL] LLM output not parsed correctly - check server logs")

# Also test neg + stats
print("\n[Negative]")
try:
    r = api("/api/v4/atoms/negative", {"prompt": tests[0]}, timeout=60)
    neg = r.get("negative", "")
    print(f"  neg ({len(neg)} chars): {neg[:120]}")
except Exception as e:
    print(f"  FAIL: {e}")

print("[Done]")
