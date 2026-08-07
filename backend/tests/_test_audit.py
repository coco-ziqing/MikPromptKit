"""Phase35 审计日志端到端测试：注册/登录/失败/管理操作 → 审计入库 → 管理员查询。"""
import json
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, "backend")
from jwt_auth import generate_test_token

BASE = "http://127.0.0.1:8080"
ADMIN = generate_test_token(1, "admin", "admin")
EDITOR = generate_test_token(2, "editor1", "editor")

def call(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data: req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}

results = []
uname = "audittmp_" + str(int(time.time()) % 100000)

# 1. 注册临时用户
st, d = call("POST", "/api/auth/register", {"username": uname, "password": "test123", "display_name": "审计测试号"})
newid = d.get("id")
results.append(("注册成功", st == 200 and newid))

# 2. 登录失败（错密码）
st, d = call("POST", "/api/auth/login", {"username": uname, "password": "wrongpw"})
results.append(("错误密码登录被拒", st == 401))

# 3. 登录成功
st, d = call("POST", "/api/auth/login", {"username": uname, "password": "test123"})
results.append(("正确密码登录成功", st == 200 and d.get("ok")))

time.sleep(0.3)

# 4. 管理员查该用户审计事件
st, d = call("GET", f"/api/audit/user/{newid}", token=ADMIN)
events = [it["event_type"] for it in d.get("items", [])]
results.append(("审计含 login", st == 200 and "login" in events))
results.append(("审计含 login_failed", "login_failed" in events))
results.append(("审计含 register", "register" in events))

# 5. summary
st, d = call("GET", f"/api/audit/user/{newid}/summary", token=ADMIN)
s = d.get("summary", {})
results.append(("summary 登录次数>=1", s.get("login_count", 0) >= 1))
results.append(("summary 失败次数>=1", s.get("login_failed_count", 0) >= 1))
results.append(("summary 含最后登录时间", bool(s.get("last_login_at"))))

# 6. 登录会话
st, d = call("GET", f"/api/audit/user/{newid}/sessions", token=ADMIN)
results.append(("会话历史>=1且含device", st == 200 and len(d.get("items", [])) >= 1 and "device" in (d["items"][0] if d.get("items") else {})))

# 7. 管理员改角色 → user_update
st, d = call("PUT", f"/api/auth/users/{newid}", {"role": "viewer", "display_name": "审计测试号改"}, token=ADMIN)
results.append(("改用户成功", st == 200))
# 8. 停用 → user_toggle
st, d = call("PUT", f"/api/auth/users/{newid}", {"is_active": 0}, token=ADMIN)
results.append(("停用成功", st == 200))
time.sleep(0.3)
st, d = call("GET", f"/api/audit/user/{newid}", token=ADMIN)
ev2 = [it["event_type"] for it in d.get("items", [])]
results.append(("审计含 user_update", "user_update" in ev2))
results.append(("审计含 user_toggle", "user_toggle" in ev2))

# 9. 非管理员访问被拒
st, d = call("GET", f"/api/audit/user/{newid}", token=EDITOR)
results.append(("非管理员访问返回403", st == 403))

# 10. 全局 feed
st, d = call("GET", "/api/audit/feed?limit=20", token=ADMIN)
results.append(("全局feed可用", st == 200 and len(d.get("items", [])) >= 1))

# 11. 删除临时用户 → user_delete
st, d = call("DELETE", f"/api/auth/users/{newid}", token=ADMIN)
results.append(("删除临时用户成功", st == 200))
time.sleep(0.3)
st, d = call("GET", "/api/audit/feed?event=user_delete&limit=5", token=ADMIN)
results.append(("审计含 user_delete", st == 200 and any(str(it.get("target_id")) == str(newid) for it in d.get("items", []))))

print("\n==== 审计测试结果 ====")
ok = 0
for name, passed in results:
    print(("  PASS " if passed else "  FAIL ") + name)
    ok += 1 if passed else 0
print(f"\n{ok}/{len(results)} 通过  (临时用户 {uname} id={newid} 已清理)")
sys.exit(0 if ok == len(results) else 1)
