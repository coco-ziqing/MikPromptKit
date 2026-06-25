"""快速定位实际端口"""
import urllib.request, json
for port in range(8080, 8090):
    try:
        r = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health/check", timeout=2)
        data = json.loads(r.read())
        routes = urllib.request.urlopen(f"http://127.0.0.1:{port}/openapi.json", timeout=2)
        spec = json.loads(routes.read())
        atom_paths = [p for p in spec["paths"] if "atom" in p.lower()]
        print(f"端口 {port}: atom路由={len(atom_paths)} | version={data.get('version','?')}")
    except Exception as e:
        print(f"端口 {port}: 无服务 ({e})")
