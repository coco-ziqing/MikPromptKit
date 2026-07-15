# -*- coding: utf-8 -*-
"""2026-07-15 遗留项回归：master_project 业务端点审计埋点 + 审计导出CSV + 保留期清理。
运行：python backend\\_test_legacy_0715.py（需服务已启动 8080）"""
import sys, json, urllib.request, urllib.error, time
sys.path.insert(0, "backend")
from jwt_auth import generate_test_token

BASE = "http://127.0.0.1:8080"
PLUGIN = "/api/plugins/com.promptkit.project"
ADMIN = generate_test_token(1, "admin", "admin")
EDITOR = generate_test_token(2, "editor1", "editor")

def call(method, path, body=None, token=None, raw=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data: req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            content = r.read()
            if raw: return r.status, content
            return r.status, json.loads(content.decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}

def feed_events(**kw):
    """取最近全局审计流的 (event_type, detail) 列表"""
    q = "&".join(f"{k}={v}" for k, v in kw.items())
    st, d = call("GET", f"/api/audit/feed?limit=50" + ("&" + q if q else ""), token=ADMIN)
    return [(it["event_type"], it.get("detail", ""), it.get("target_id", "")) for it in d.get("items", [])]

results = []
tag = "遗留测%d" % (int(time.time()) % 100000)

# ===== 1. master_project 埋点 =====
st, d = call("POST", f"{PLUGIN}/master", {"name": tag}, token=ADMIN)
mid = d.get("id")
results.append(("创建总项目", st == 200 and mid))

st, _ = call("PUT", f"{PLUGIN}/master/{mid}", {"description": "audit test"}, token=ADMIN)
results.append(("更新总项目", st == 200))

# 素材
st, d = call("POST", f"{PLUGIN}/master/{mid}/assets", {"name": tag + "素材", "asset_type": "other"}, token=ADMIN)
aid = d.get("id")
results.append(("新建素材", st == 200 and aid))
st, _ = call("PUT", f"{PLUGIN}/master/assets/{aid}", {"description": "x"}, token=ADMIN)
results.append(("修改素材", st == 200))
st, _ = call("DELETE", f"{PLUGIN}/master/assets/{aid}", token=ADMIN)
results.append(("删除素材", st == 200))

# 成员（user 2）
st, _ = call("POST", f"{PLUGIN}/members", {"master_project_id": mid, "user_id": 2, "role": "viewer"}, token=ADMIN)
results.append(("添加成员", st == 200))
st, d = call("GET", f"{PLUGIN}/members?master_project_id={mid}", token=ADMIN)
mem_id = None
for m in d.get("members", []):
    if m.get("user_id") == 2: mem_id = m.get("id")
if mem_id:
    st, _ = call("PUT", f"{PLUGIN}/members/{mem_id}", {"duty": "测试"}, token=ADMIN)
    results.append(("修改成员", st == 200))
    st, _ = call("DELETE", f"{PLUGIN}/members/{mem_id}", token=ADMIN)
    results.append(("移除成员", st == 200))
else:
    results.append(("修改成员", False)); results.append(("移除成员", False))

# 删除总项目
st, _ = call("DELETE", f"{PLUGIN}/master/{mid}", token=ADMIN)
results.append(("删除总项目", st == 200))

time.sleep(0.5)
evs = feed_events()
types = [e[0] for e in evs]
for et in ["project_create", "project_update", "asset_upload", "asset_update", "asset_delete",
           "member_add", "member_update", "member_remove", "project_delete"]:
    results.append((f"审计流含 {et}", et in types))
# 归属校验：project_create 由 admin(uid=1) 发起
st, d = call("GET", "/api/audit/feed?event=project_create&limit=5", token=ADMIN)
it = (d.get("items") or [{}])[0]
results.append(("埋点归属 admin", it.get("user_id") == 1 and it.get("username") == "admin"))

# ===== 2. 导出 CSV =====
st, content = call("GET", "/api/audit/export?event=project_create&days=1", token=ADMIN, raw=True)
txt = content.decode("utf-8-sig") if isinstance(content, bytes) else ""
lines = [l for l in txt.split("\n") if l.strip()]
results.append(("导出CSV 200且有表头", st == 200 and lines and lines[0].startswith("id,created_at")))
results.append(("导出CSV 含数据行", len(lines) >= 2))
results.append(("导出CSV BOM(Excel兼容)", isinstance(content, bytes) and content.startswith(b"\xef\xbb\xbf")))
# 非管理员被拒
st, _ = call("GET", "/api/audit/export", token=EDITOR)
results.append(("非管理员导出403", st == 403))

# ===== 3. 保留期 =====
st, d = call("GET", "/api/audit/retention", token=ADMIN)
results.append(("retention查询", st == 200 and "days" in d and "total" in d))
st, d = call("POST", "/api/audit/retention", {"days": 365}, token=ADMIN)
results.append(("retention设置365", st == 200 and d.get("days") == 365))
st, d = call("GET", "/api/audit/retention", token=ADMIN)
results.append(("retention持久化", d.get("days") == 365))
st, d = call("POST", "/api/audit/retention", {"days": 0}, token=ADMIN)
results.append(("retention还原0", st == 200 and d.get("days") == 0))
st, _ = call("POST", "/api/audit/retention", {"days": 9999}, token=ADMIN)
results.append(("retention越界400", st == 400))
st, _ = call("GET", "/api/audit/retention", token=EDITOR)
results.append(("非管理员retention403", st == 403))

ok = sum(1 for _, p in results if p)
for name, p in results:
    print(("PASS" if p else "FAIL"), name)
print(f"\n{ok}/{len(results)} 通过")
sys.exit(0 if ok == len(results) else 1)
