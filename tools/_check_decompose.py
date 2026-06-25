"""快速检查 decompose 端点 - 修正端口"""
import urllib.request, json
BASE = "http://127.0.0.1:8081"

# 1. 健康检查
r = urllib.request.urlopen(f"{BASE}/api/health/check", timeout=5)
print(f"[health] {r.status}")

# 2. 查看 atoms 路由
r = urllib.request.urlopen(f"{BASE}/openapi.json", timeout=5)
spec = json.loads(r.read())
atom_paths = [p for p in spec["paths"] if "atom" in p.lower()]
for p in sorted(atom_paths):
    methods = list(spec["paths"][p].keys())
    print(f"  {methods} {p}")

# 3. 测试 decompose
data = json.dumps({"prompt": "日系赛璐珞风格线条干净的少女，柔和侧光", "media_type": "image"}).encode("utf-8")
req = urllib.request.Request(f"{BASE}/api/v4/atoms/decompose", data=data,
                             headers={"Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=30)
    resp = json.loads(r.read())
    print(f"\n[decompose] ok={resp.get('ok')} cached={resp.get('cached')}")
except Exception as e:
    print(f"\n[decompose ERROR] {e}")
