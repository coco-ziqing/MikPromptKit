# -*- coding: utf-8 -*-
"""v5.49.0 验证：预置模板 / 拼贴合成 / rolecard 归档 / 资产包导出（用假数据，不消耗额度）"""
import json, os, sys, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8080"
PASS = 0
FAIL = 0
TOKEN = ""

def login():
    global TOKEN
    req = urllib.request.Request(BASE + "/api/auth/login",
                                 data=json.dumps({"username": "admin", "password": "admin"}).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    lg = json.loads(urllib.request.urlopen(req, timeout=10).read())
    TOKEN = lg.get("token") or ""
    print("登录 OK, token:", len(TOKEN) > 0)

def call(method, path, body=None, expect=200, raw=False):
    global PASS, FAIL
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = resp.status
            content = resp.read()
    except urllib.error.HTTPError as e:
        status = e.code
        content = e.read()
    except Exception as e:
        status = 0
        content = str(e).encode()
    ok = status == expect
    if ok:
        PASS += 1
        print(f"  [PASS] {method} {path} -> {status}")
    else:
        FAIL += 1
        print(f"  [FAIL] {method} {path} -> {status} (期望 {expect}): {content[:200]}")
    if raw:
        return content
    try:
        return json.loads(content.decode("utf-8", errors="replace"))
    except Exception:
        return {}

login()

print("\n=== 1. 预置模板列表 ===")
r = call("GET", "/api/style-suits?tab=system")
items = r.get("items", [])
print(f"  预置模板: {len(items)} 套")
for it in items:
    print(f"    - {it['name']} (id={it['id']})")

print("\n=== 2. 拼贴合成（Pillow，无批次也可验证纯函数）===")
# 直接用预置模板配置验证 compose 需要批次；先验证 Pillow 可用
try:
    import PIL
    print("  Pillow 版本:", PIL.__version__)
    PASS += 1
except ImportError:
    print("  [FAIL] Pillow 缺失")
    FAIL += 1

print("\n=== 3. 归档参数校验 ===")
r = call("POST", "/api/assemble/render/9999/archive?master_project_id=1", {}, expect=404)
print(f"  不存在批次归档拦截: {r.get('detail', '')[:60]}")

print("\n=== 4. 导出参数校验 ===")
r = call("GET", "/api/assemble/render/9999/export", expect=404)
print(f"  不存在批次导出拦截: {r.get('detail', '')[:60]}")

print("\n=== 5. 拼贴参数校验 ===")
r = call("POST", "/api/assemble/render/9999/compose", expect=404)
print(f"  不存在批次拼贴拦截: {r.get('detail', '')[:60]}")

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
