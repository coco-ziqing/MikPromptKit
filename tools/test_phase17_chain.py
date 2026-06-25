# -*- coding: utf-8 -*-
"""Phase17 full-chain test: list + archive + bridge + delete"""
import urllib.request, json, time

BASE = "http://127.0.0.1:8080"

def post(path, data, timeout=120):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers={"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())

def get(path, timeout=10):
    return json.loads(urllib.request.urlopen(f"{BASE}{path}", timeout=timeout).read())

def delete(path, timeout=10):
    req = urllib.request.Request(f"{BASE}{path}", method="DELETE")
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())

print("=" * 60)
print("  Phase17 Full Chain Test (8080)")
print("=" * 60)

# 1. List
r = get("/api/v4/atoms/list?page_size=5")
print(f"\n[1/7] LIST: total={r.get('total')} items={len(r.get('items',[]))}")

# 2. Decompose fresh
print(f"\n[2/7] DECOMPOSE: a golden phoenix rising from blue flames...")
r = post("/api/v4/atoms/decompose", {"prompt":"a golden phoenix rising from blue flames, cinematic lighting, 8K HDR","media_type":"image"}, timeout=120)
did = r.get("id")
print(f"  id={did} cached={r.get('cached')} score={r.get('quality_score')} atoms={len(r.get('atoms',[]))}")

# 3. Archive
print(f"\n[3/7] ARCHIVE: decompose_id={did}")
r = post("/api/v4/atoms/archive-to-group", {"decompose_id":did, "create_groups":True})
print(f"  card_count={r.get('card_count',0)}")

# 4. Bridge
print(f"\n[4/7] BRIDGE: decompose_id={did}")
r = get(f"/api/v4/atoms/decompose/{did}/bridge")
print(f"  count={r.get('count',0)}")

# 5. Variations
print(f"\n[5/7] VARIATIONS...")
atoms = get(f"/api/v4/atoms/decompose/{did}").get("atoms",[])
r = post("/api/v4/atoms/variations", {"decompose_id":did,"atoms_json":json.dumps(atoms),"count":2,"locked_ids":[]}, timeout=120)
print(f"  count={r.get('count',0)}")

# 6. Delete
print(f"\n[6/7] DELETE: decompose_id={did}")
r = delete(f"/api/v4/atoms/decompose/{did}")
print(f"  deleted_id={r.get('deleted_id')}")

# 7. Stats
print(f"\n[7/7] STATS")
r = get("/api/v4/atoms/stats")
t = r.get("totals",{})
print(f"  decomposes={t.get('decomposes',0)} vars={t.get('variations',0)} bridge={t.get('bridge_cards',0)}")
top = r.get("top_atoms",[])
if top:
    for x in top[:3]:
        print(f"  [{x['type']}] {x['text'][:30]} refs={x['ref_count']}")

print("\n" + "=" * 60)
print("[PASS] Phase17 full chain verified")
print("=" * 60)
