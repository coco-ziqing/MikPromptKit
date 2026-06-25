"""Quick test 8088"""
import urllib.request, json
BASE = "http://127.0.0.1:8088"
def api(path, timeout=5):
    r = urllib.request.urlopen(f"{BASE}{path}", timeout=timeout)
    return json.loads(r.read())

# Quick check
r = api("/api/v4/atoms/stats")
print("stats:", r.get("totals"))

r = api("/api/v4/atoms/list")
print("list:", r.get("total"), "items")

# Test decompose with SHORT timeout to see error faster
import http.client
conn = http.client.HTTPConnection("127.0.0.1", 8088, timeout=15)
body = json.dumps({"prompt":"test","media_type":"image"})
conn.request("POST", "/api/v4/atoms/decompose", body, headers={"Content-Type": "application/json"})
try:
    r = conn.getresponse()
    print(f"decompose: {r.status}")
    print(r.read().decode()[:200])
except Exception as e:
    print(f"conn error: {e}")
conn.close()
