# -*- coding: utf-8 -*-
"""Direct test on port 8085 (latest server with qwen3.5:4b fix)"""
import urllib.request, json, time

BASE = "http://127.0.0.1:8085"

def api(path, data=None, timeout=90):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"} if body else {})
    r = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(r.read())

# Completely fresh prompts (never seen before)
prompt = "a steampunk airship floating above Victorian London at dusk, brass gears and copper pipes, warm gaslight glow, cinematic wide shot, volumetric clouds, 8K HDR"

print("=" * 70)
print("  Phase15 Final: Real Ollama Decompose (qwen3.5:4b + 4000 tokens)")
print("=" * 70)

t0 = time.time()
r = api("/api/v4/atoms/decompose", {"prompt": prompt, "media_type": "image"}, timeout=120)
elapsed = time.time() - t0

print(f"\ntime: {elapsed:.1f}s")
print(f"cached: {r.get('cached')}")
print(f"score: {r.get('quality_score')}")
atoms = r.get("atoms", [])
print(f"atoms: {len(atoms)}")

if len(atoms) <= 1:
    print("\n[FAIL] Only {len(atoms)} atom(s) - LLM output not parsed")
    print("Check server console for [ATOM-LOG] messages")
else:
    print("\n[PASS] LLM decompose works!")
    for a in atoms[:10]:
        print(f"  [{a.get('type','?')}] \"{a.get('text','')[:50]}\"  w={a.get('weight',0)}  kw={a.get('keywords',[])}")

# Cache test
t1 = time.time()
r2 = api("/api/v4/atoms/decompose", {"prompt": prompt, "media_type": "image"}, timeout=5)
print(f"\ncache retest: {time.time()-t1:.2f}s  cached={r2.get('cached')}")

# Stats
print(f"\n[Stats]")
r3 = api("/api/v4/atoms/stats")
stats = r3.get("totals", {})
print(f"  decomposes={stats.get('decomposes',0)} variations={stats.get('variations',0)} bridge={stats.get('bridge_cards',0)}")
