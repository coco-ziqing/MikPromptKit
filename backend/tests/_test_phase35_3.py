"""Phase35.3a 回归测试"""
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
VIEWER = generate_test_token(3, "viewer1", "viewer")

def call(method, path, body=None, token=None, raw=False, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data: req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    if headers:
        for k, v in headers.items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            if raw: return r.status, r.read()
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}

PASS = []; FAIL = []
def check(name, ok): (PASS if ok else FAIL).append(name)

# === 1 配对码 ===
st,d = call("POST","/api/devices/pair-code", token=ADMIN)
check("生成配对码", st==200 and "code" in d and len(d["code"])==6)
pair_code = d.get("code","")

# editor 不能配对（require_role("admin") 守卫生效）
st2,_ = call("POST","/api/devices/pair-code", token=EDITOR)
check("editor不能配对", st2==403)

# viewer 也不能配对
st_v,_ = call("POST","/api/devices/pair-code", token=VIEWER)
check("viewer不能配对", st_v==403)

# === 2 注册（用editor的码，因为配完即用，admin的码已被editor覆盖） ===
st,_ = call("POST","/api/device/register", {"name":"test","platform":"win"})
check("无码注册400", st==400)

st,_ = call("POST","/api/device/register", {"code":"ZZZZZZ","name":"test","platform":"win"})
check("错码注册400", st==400)

# 生成新配对码 + 立即使用
st,d = call("POST","/api/devices/pair-code", token=ADMIN)
code3 = d.get("code","")
st,d = call("POST","/api/device/register", {
    "code":code3,"name":"Agent测试机","platform":"win",
    "agent_version":"0.1.0","owner_username":"admin"
})
check("配对注册200", st==200 and "token" in d)
dev_token = d.get("token","")
did = d.get("id")

# === 3 心跳 ===
st,d = call("POST","/api/device/heartbeat", headers={"X-Device-Token":dev_token})
check("心跳200", st==200 and "tasks" in d)

# === 4 批量上报 ===
st,d = call("POST","/api/device/index-batch", {
    "items":[
        {"rel_path":"project_a/render_v1.exr","filename":"render_v1.exr","ext":".exr","size":1024000,"mtime":1752576800,"fingerprint":"a1b2c3d4e5f6"},
        {"rel_path":"project_a/hero.psd","filename":"hero.psd","ext":".psd","size":8192000,"mtime":1752576900,"fingerprint":"b2c3d4e5f6a7"},
        {"rel_path":"project_a/audio.wav","filename":"audio.wav","ext":".wav","size":512000,"mtime":1752577000,"fingerprint":"c3d4e5f6a7b8"},
    ]
}, headers={"X-Device-Token":dev_token})
check("批量上报3文件", st==200 and d.get("new")==3)

time.sleep(0.3)

# === 5 设备列表 ===
st,d = call("GET","/api/devices", token=ADMIN)
devices = d.get("devices",[])
td = next((x for x in devices if x["name"]=="Agent测试机"), None)
check("设备列表含Agent测试机", td is not None)
if td:
    check("file_count=3", td.get("file_count")==3)
    check("new_count=3", td.get("new_count")==3)
    check("online字段存在", "online" in td)

# === 6 文件列表 ===
st,d = call("GET",f"/api/devices/{did}/files?state=new", token=ADMIN)
check("文件列表3条", st==200 and d.get("total")==3)
fi1 = d["items"][0]
fid1 = fi1["id"]

# === 7 路径管理 ===
st,_ = call("POST",f"/api/devices/{did}/paths",{"abs_path":"D:\\ProjectA"}, token=ADMIN)
check("添加路径200", st==200)

st,dp = call("GET",f"/api/devices/{did}/paths", token=ADMIN)
check("路径列表>=1", st==200 and len(dp.get("paths",[]))>=1)
if dp.get("paths"):
    pid = dp["paths"][0]["id"]
    st,_ = call("DELETE",f"/api/devices/{did}/paths/{pid}", token=ADMIN)
    check("删除路径200", st==200)
else:
    check("删除路径200", False)

# === 8 改名 ===
st,_ = call("PUT",f"/api/devices/{did}",{"name":"Agent测试机-改"}, token=ADMIN)
check("改名200", st==200)

# === 9 归档 ===
from database import get_db

db = get_db()
proj_space = db.execute("SELECT id FROM project_space ORDER BY id LIMIT 1").fetchone()
psid = proj_space["id"] if proj_space else 1

st,d = call("POST",f"/api/devices/files/{fid1}/archive",
            {"project_space_id":psid,"module_key":"image","is_critical":1}, token=ADMIN)
check("归档200", st==200 and "catalog_id" in d)

st,d = call("GET",f"/api/devices/{did}/files?state=archived", token=ADMIN)
check("归档后archived", st==200 and d.get("total",0)>=1)

# === 10 告警 ===
st,d = call("GET","/api/devices/alerts", token=ADMIN)
check("告警new>0", st==200 and d["summary"].get("new",0)>0)
check("告警failed_backups=0", d["summary"].get("failed_backups",-1)==0)

# === 11 权限 ===
st3,_ = call("PUT",f"/api/devices/{did}",{"name":"hack"}, token=VIEWER)
check("非owner改名403", st3==403)

# === 12 吊销 ===
st,_ = call("DELETE",f"/api/devices/{did}", token=ADMIN)
check("吊销200", st==200)

st,_ = call("POST","/api/device/heartbeat", headers={"X-Device-Token":dev_token})
check("吊销后心跳401", st==401)

st,_ = call("POST","/api/device/heartbeat", headers={"X-Device-Token":"fake-token-12345"})
check("假token401", st==401)

# === 汇总 ===
all_ok = len(PASS) + len(FAIL)
for p in PASS: print("PASS",p)
for f in FAIL: print("FAIL",f)
print(f"\n{len(PASS)}/{all_ok} 通过")
sys.exit(0 if len(FAIL)==0 else 1)
