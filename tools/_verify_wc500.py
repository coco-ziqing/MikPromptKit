"""Quick verify word-cards 500 fix"""
import urllib.request, json, time

time.sleep(8)  # wait for server
BASE = "http://127.0.0.1:8080"

def get(path, timeout=10):
    return json.loads(urllib.request.urlopen(f"{BASE}{path}", timeout=timeout).read())

# Test all previously-failing group_ids
all_ok = True
for gid in [11, 37, 17, 14, 13, 31, 29, None]:
    url = f"/api/v4/word-cards?page_size=1"
    if gid: url += f"&group_id={gid}"
    try:
        r = get(url)
        ok = r.get("ok") is True
        print(f"  group_id={gid}: {'OK' if ok else 'FAIL'} items={len(r.get('items',[]))}")
        if not ok:
            all_ok = False
    except Exception as e:
        print(f"  group_id={gid}: FAIL - {e}")
        all_ok = False

print(f"\n[{'PASS' if all_ok else 'FAIL'}] word-cards 500 fixed" if all_ok else "\n[FAIL] some groups still error")
