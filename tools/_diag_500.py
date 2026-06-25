# -*- coding: utf-8 -*-
"""Direct test to reproduce word-cards 500"""
import urllib.request, json

BASE = "http://127.0.0.1:8080"

def get(path, timeout=10):
    return json.loads(urllib.request.urlopen(f"{BASE}{path}", timeout=timeout).read())

# Test word-cards with different group_ids
for gid in [11, 37, 17, 14, 13, 31, 29, None]:
    url = f"/api/v4/word-cards?page_size=5"
    if gid:
        url += f"&group_id={gid}"
    try:
        r = get(url)
        print(f"  group_id={gid}: OK items={len(r.get('items',[]))}")
    except Exception as e:
        print(f"  group_id={gid}: ERROR {e}")

# Test atoms decompose with empty body
print("\nTest atoms decompose:")
try:
    body = json.dumps({"prompt":"test","media_type":"image"}).encode()
    req = urllib.request.Request(f"{BASE}/api/v4/atoms/decompose", data=body, headers={"Content-Type":"application/json"})
    r = urllib.request.urlopen(req, timeout=30)
    print(f"  OK: {json.loads(r.read()).get('cached')}")
except Exception as e:
    print(f"  ERROR: {e}")
