# -*- coding: utf-8 -*-
"""Phase35.3b Agent集成测试：配对→IN→首扫上报→心跳→增量检测"""
import os, sys, json, urllib.request, time, tempfile, shutil
sys.path.insert(0, "backend")
from jwt_auth import generate_test_token

BASE = "http://127.0.0.1:8080"
ADMIN = generate_test_token(1, "admin", "admin")
TMP = os.path.join(tempfile.gettempdir(), "pk_agent_test")

def call(m, p, b=None, t=ADMIN, h=None):
    r = urllib.request.Request(BASE+p, data=json.dumps(b).encode() if b else None, method=m)
    if b: r.add_header("Content-Type","application/json")
    if t: r.add_header("Authorization","Bearer "+t)
    if h:
        for k,v in h.items(): r.add_header(k,v)
    try:
        with urllib.request.urlopen(r, timeout=10) as rr:
            return rr.status, json.loads(rr.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except: return e.code,{}

PASS = []; FAIL = []
def chk(n, ok): (PASS if ok else FAIL).append(n)

# 1. 创建测试目录 + 文件
os.makedirs(TMP, exist_ok=True)
with open(os.path.join(TMP,"test.png"),"wb") as f: f.write(b"PNG_TEST"*100)
with open(os.path.join(TMP,"config.json"),"w") as f: f.write('{"ok":1}')
print(f"测试目录: {TMP} ({len(os.listdir(TMP))} 文件)")

# 2. 生成配对码 + 注册设备
st,d = call("POST","/api/devices/pair-code")
code = d.get("code","")
chk("配对码", st==200 and len(code)==6)

st,d = call("POST","/api/device/register",
    {"code":code,"name":"Agent集成测试","platform":"win","agent_version":"0.1","owner_username":"admin"})
chk("注册", st==200 and "token" in d)
TOKEN = d["token"]
DID = d["id"]

# 3. 心跳
st,d = call("POST","/api/device/heartbeat", h={"X-Device-Token":TOKEN})
chk("心跳", st==200)

# 4. 模拟 Agent 首扫：扫描目录 → 算指纹 → batch 上报
import hashlib
items = []
for fn in os.listdir(TMP):
    fp = os.path.join(TMP, fn)
    sz = os.path.getsize(fp)
    h = hashlib.sha256()
    with open(fp,"rb") as f:
        while True:
            buf = f.read(8192*1024)
            if not buf: break
            h.update(buf)
    items.append({
        "rel_path": fn,
        "filename": fn,
        "ext": os.path.splitext(fn)[1],
        "size": sz,
        "mtime": os.path.getmtime(fp),
        "fingerprint": h.hexdigest()
    })
st,d = call("POST","/api/device/index-batch",{"items":items}, h={"X-Device-Token":TOKEN})
chk(f"首扫上报{len(items)}文件", st==200 and d.get("new")==len(items))

# 5. 验证服务器侧能看到
st,d = call("GET",f"/api/devices/{DID}/files", t=ADMIN)
chk(f"服务器侧{len(items)}文件", st==200 and d.get("total")==len(items))

# 6. 增量检测：不变
st,d = call("POST","/api/device/index-batch",{"items":items}, h={"X-Device-Token":TOKEN})
chk("增量无变化(new=0)", st==200 and d.get("new")==0)

# 7. 修改文件 → 指纹变化
with open(os.path.join(TMP,"config.json"),"w") as f: f.write('{"changed":true}')
sz2 = os.path.getsize(os.path.join(TMP,"config.json"))
h2 = hashlib.sha256()
with open(os.path.join(TMP,"config.json"),"rb") as f: h2.update(f.read())
items2 = [{"rel_path":"config.json","filename":"config.json","ext":".json","size":sz2,"mtime":os.path.getmtime(os.path.join(TMP,"config.json")),"fingerprint":h2.hexdigest()}]
st,d = call("POST","/api/device/index-batch",{"items":items2}, h={"X-Device-Token":TOKEN})
chk("变化上报(state=changed)", st==200 and d.get("updated",0)>=0)

# 8. 消失检测
st,d = call("POST","/api/device/index-batch",{"items":[],"removed":["test.png"]}, h={"X-Device-Token":TOKEN})
chk("消失上报(test.png→missing)", st==200 and "test.png" in d.get("missing",[]))

# 9. 告警
st,d = call("GET","/api/devices/alerts", t=ADMIN)
chk("告警含missing", d["summary"].get("missing",0)>=1)

# 10. 告警含changed
chk("告警含changed", d["summary"].get("changed",0)>=1)

# 清理
shutil.rmtree(TMP, ignore_errors=True)

# 汇总
print()
for p in PASS: print("PASS",p)
for f in FAIL: print("FAIL",f)
print(f"\n{len(PASS)}/{len(PASS)+len(FAIL)} 通过")
sys.exit(0 if not FAIL else 1)
