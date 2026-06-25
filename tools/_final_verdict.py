# -*- coding: utf-8 -*-
"""Final: real Ollama AI decompose + full chain verdict (no emoji)"""
import urllib.request, json, time, http.client

BASE = "http://127.0.0.1:8080"

def post(path, data, timeout=120):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers={"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())

def get(path, timeout=10):
    return json.loads(urllib.request.urlopen(f"{BASE}{path}", timeout=timeout).read())

def delete(path, timeout=10):
    conn = http.client.HTTPConnection("127.0.0.1", 8080, timeout=timeout)
    conn.request("DELETE", path)
    resp = conn.getresponse()
    data = json.loads(resp.read())
    conn.close()
    return data

print("=" * 70)
print("  Phase17 Final: Real Ollama AI Decompose Verdict")
print("=" * 70)

# Use a prompt NOT in cache (short, leaves room for model load)
prompt = "steampunk submarine exploring deep ocean trench, bioluminescent jellyfish, brass porthole view, volumetric light rays, 8K cinematic"
print(f"\n[PROMPT] {prompt[:80]}...")

# 1. Real decompositions
t0 = time.time()
r = post("/api/v4/atoms/decompose", {"prompt": prompt, "media_type": "image"}, timeout=180)
elapsed = time.time() - t0
print(f"[1/7] DECOMPOSE: {elapsed:.1f}s | cached={r.get('cached')} | score={r.get('quality_score')}")
atoms = r.get("atoms", [])
did = r.get("id")
print(f"       atoms: {len(atoms)}")
for i, a in enumerate(atoms[:8]):
    print(f"       #{i+1} [{a.get('type','?'):12s}] \"{a.get('text','')[:50]}\"  w={a.get('weight',0)}")

if len(atoms) <= 1:
    print("\n[VERDICT] FAIL - only 1 atom (AI fallback mode)")
else:
    print(f"\n[VERDICT] PASS - {len(atoms)} AI-extracted atoms!")

    # 2. Cache
    t1 = time.time()
    r2 = post("/api/v4/atoms/decompose", {"prompt": prompt, "media_type": "image"}, timeout=10)
    print(f"[2/7] CACHE: {time.time()-t1:.2f}s | cached={r2.get('cached')} ({len(r2.get('atoms',[]))} atoms)")

    # 3. Archive
    r3 = post("/api/v4/atoms/archive-to-group", {"decompose_id": did, "create_groups": True}, timeout=30)
    print(f"[3/7] ARCHIVE: card_count={r3.get('card_count',0)}")

    # 4. Bridge
    r4 = get(f"/api/v4/atoms/decompose/{did}/bridge")
    print(f"[4/7] BRIDGE: count={r4.get('count',0)}")
    for b in r4.get("bridge", [])[:3]:
        print(f"       [{b.get('atom_type','?')}] -> card#{b.get('word_card_id')} group={b.get('group_name','?')}")

    # 5. Stats
    r5 = get("/api/v4/atoms/stats")
    t = r5.get("totals", {})
    print(f"[5/7] STATS: decomposes={t.get('decomposes',0)} vars={t.get('variations',0)} bridge={t.get('bridge_cards',0)}")
    top = r5.get("top_atoms", [])
    if top:
        print(f"       top3: {[(x['text'][:15], x['ref_count']) for x in top[:3]]}")

    # 6. Delete (cleanup)
    r6 = delete(f"/api/v4/atoms/decompose/{did}")
    print(f"[6/7] DELETE: deleted_id={r6.get('deleted_id')}")

    # 7. Verdict
    print(f"\n[7/7] FINAL VERDICT:")
    checks = [
        ("AI atoms (>=2)", len(atoms) >= 2),
        ("MD5 cache hit", r2.get("cached") is True),
        ("Archive to group", r3.get("card_count", 0) > 0),
        ("Bridge linked", r4.get("count", 0) > 0),
        ("Stats updated", t.get("bridge_cards", 0) > 0),
        ("Cascade delete OK", r6.get("deleted_id") == did),
    ]
    all_pass = True
    for name, result in checks:
        status = "OK" if result else "FAIL"
        print(f"  [{status}] {name}")
        if not result:
            all_pass = False

    if all_pass:
        print(f"\n{'='*70}")
        print("  ALL TESTS PASSED")
        print("  PromptKit v5.0 — Atom Platform Ready")
        print(f"{'='*70}")
    else:
        print(f"\n  Some tests failed - review above")
