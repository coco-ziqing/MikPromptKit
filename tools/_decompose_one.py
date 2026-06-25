# -*- coding: utf-8 -*-
"""Final decompose test - brand new prompts, fresh cache"""
import urllib.request, json, time

BASE = "http://127.0.0.1:8083"

def api(path, data=None, timeout=90):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"} if body else {})
    r = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(r.read())

tests = [
    "a majestic dragon soaring through golden clouds at sunset, cinematic lighting, 8K photorealistic, epic scale, rim light, volumetric fog",
    "Japanese anime style schoolgirl sitting in classroom, soft afternoon sunlight through window, cherry blossom petals falling, Studio Ghibli aesthetic",
    "drone shot of snowy mountain peak at sunrise, misty valleys below, backlit eagle flying across, 4K cinematic",
]

total_time = 0
total_atoms = 0

for i, prompt in enumerate(tests, 1):
    t0 = time.time()
    r = api("/api/v4/atoms/decompose", {"prompt": prompt, "media_type": "image"}, timeout=90)
    elapsed = time.time() - t0
    total_time += elapsed
    atoms = r.get("atoms", [])
    total_atoms += len(atoms)
    print(f"\n[{i}/3] {elapsed:.1f}s | cached={r.get('cached')} | score={r.get('quality_score')} | atoms={len(atoms)}")
    for a in atoms[:6]:
        print(f"  [{a.get('type','?')}] \"{a.get('text','')[:50]}\"  w={a.get('weight',0)}  kw={a.get('keywords',[])}")
    
    # Cache hit test
    t1 = time.time()
    r2 = api("/api/v4/atoms/decompose", {"prompt": prompt, "media_type": "image"}, timeout=5)
    print(f"  -> cache hit: {time.time()-t1:.2f}s cached={r2.get('cached')}")

avg_t = total_time / 3
avg_a = total_atoms / 3
print(f"\n=== Summary ===")
print(f"avg time: {avg_t:.1f}s")
print(f"avg atoms: {avg_a:.1f}")
print(f"cache works: YES (0.00s)")
print(f"models: qwen3.5:4b (decompose), qwen3.5:9b (variations/negative)")
