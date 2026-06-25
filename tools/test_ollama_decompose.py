# -*- coding: utf-8 -*-
"""Phase15 Ollama decompose E2E test (no emoji)"""
import urllib.request, json, time

BASE = "http://127.0.0.1:8082"

def api(path, data=None, timeout=90):
    url = f"{BASE}{path}"
    if data:
        body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    else:
        req = urllib.request.Request(url)
    r = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(r.read())

print("=" * 70)
print("  Phase15 Real Ollama Decompose E2E Test")
print("=" * 70)

# 1. Ollama status
try:
    r = api("/api/health/check")
    ollama = r.get("checks", {}).get("ollama", {})
    print(f"\n[1/6 Ollama] ok={ollama.get('ok')} models={ollama.get('model_count',0)}")
except Exception as e:
    print(f"[1/6 Ollama] health check error: {e}")

# 2. Single decompose
test_prompt = "cyberpunk rainy night alley, neon blue-purple lighting, low angle shot of giant holographic billboard, puddle reflections, 4K high quality"
t0 = time.time()
print(f"\n[2/6 Decompose] input: {test_prompt[:60]}...")
try:
    r = api("/api/v4/atoms/decompose", {"prompt": test_prompt, "media_type": "image"}, timeout=90)
    elapsed = time.time() - t0
    print(f"  time: {elapsed:.1f}s | cached={r.get('cached')} | score={r.get('quality_score')}")
    atoms = r.get("atoms", [])
    print(f"  atoms: {len(atoms)}")
    for i, a in enumerate(atoms[:10]):
        print(f"    #{i+1} [{a.get('type','?')}] {a.get('text','')[:50]}  w={a.get('weight',0)}")
except Exception as e:
    print(f"  FAIL: {e}")

# 3. Cache hit
print(f"\n[3/6 Cache] re-sending same prompt...")
t1 = time.time()
try:
    r = api("/api/v4/atoms/decompose", {"prompt": test_prompt, "media_type": "image"}, timeout=10)
    elapsed = time.time() - t1
    print(f"  time: {elapsed:.2f}s | cached={r.get('cached')}")
    if r.get("cached"):
        print("  [OK] MD5 cache HIT")
    else:
        print("  [MISS] cache not hit")
except Exception as e:
    print(f"  FAIL: {e}")

# 4. Text decompose
video_prompt = "drone aerial shot of majestic snow mountain sunrise, misty valley, backlit silhouette, 4K slow push-in"
t2 = time.time()
print(f"\n[4/6 TextDecompose] video prompt...")
try:
    r = api("/api/v4/atoms/decompose/text", {
        "text": video_prompt, "source_type": "manual", "media_type": "video"
    }, timeout=90)
    elapsed = time.time() - t2
    print(f"  time: {elapsed:.1f}s | atoms={r.get('atom_count')} | segs={r.get('segments')}")
    for a in r.get("atoms", [])[:5]:
        print(f"    [{a.get('type','?')}] {a.get('text','')[:40]}  w={a.get('weight',0)}")
except Exception as e:
    print(f"  FAIL: {e}")

# 5. Negative
print(f"\n[5/6 Negative] from: {test_prompt[:40]}...")
try:
    r = api("/api/v4/atoms/negative", {"prompt": test_prompt}, timeout=90)
    neg = r.get("negative", "")
    print(f"  negative ({len(neg)} chars): {neg[:120]}")
except Exception as e:
    print(f"  FAIL: {e}")

# 6. Variations
print(f"\n[6/6 Variations] lock style atom, generate 2 variants...")
atoms_json = json.dumps([
    {"id":"a1","type":"style","text":"cyberpunk","keywords":["cyberpunk"],"weight":0.9},
    {"id":"a2","type":"lighting","text":"neon blue-purple","keywords":["neon"],"weight":0.8},
    {"id":"a3","type":"camera","text":"low angle shot","keywords":["low_angle"],"weight":0.7}
])
try:
    r = api("/api/v4/atoms/variations", {
        "decompose_id": 1, "atoms_json": atoms_json, "count": 2, "locked_ids": ["a1"]
    }, timeout=90)
    for v in r.get("variations", []):
        print(f"  - {v.get('text','')[:100]}")
except Exception as e:
    print(f"  FAIL: {e}")

# Stats
print(f"\n[Stats]")
try:
    r = api("/api/v4/atoms/stats")
    t = r.get("totals", {})
    print(f"  decomposes={t.get('decomposes',0)} variations={t.get('variations',0)} bridge={t.get('bridge_cards',0)}")
    top = r.get("top_atoms", [])
    if top:
        for x in top[:3]:
            print(f"  [{x['type']}] {x['text'][:30]} refs={x['ref_count']}")
    else:
        print("  (no bridge data yet - archive first)")
except Exception as e:
    print(f"  FAIL: {e}")

print("\n" + "=" * 70)
print("[Done] Phase15 Real Ollama E2E Test")
print("=" * 70)
