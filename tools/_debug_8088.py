"""Debug 405 on 8088"""
import urllib.request, json
BASE = "http://127.0.0.1:8088"
def api(path, data=None, method="GET", timeout=30):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    headers = {"Content-Type": "application/json"} if body else {}
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    r = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(r.read())

# 1. GET openapi to see routes
r = api("/openapi.json")
atom_paths = [(p, list(v.keys())) for p,v in r["paths"].items() if "atom" in p]
for p, methods in sorted(atom_paths):
    print(f"{methods} {p}")

# 2. Direct decompose
print("\nTesting POST /api/v4/atoms/decompose...")
try:
    r = api("/api/v4/atoms/decompose", {"prompt": "test prompt", "media_type": "image"})
    print(f"OK cached={r.get('cached')}")
except Exception as e:
    print(f"FAIL: {e}")
