# -*- coding: utf-8 -*-
"""Phase35.3c 备份端到端"""
import os,sys,json,urllib.request,urllib.error,time,hashlib,tempfile,shutil
sys.path.insert(0,"backend")
from jwt_auth import generate_test_token

BASE="http://127.0.0.1:8080"
ADMIN=generate_test_token(1,"admin","admin")
TMP=os.path.join(tempfile.gettempdir(),"pk_backup_e2e")

def call(m,p,b=None,tk=ADMIN,h=None,dbytes=None):
    body=dbytes if dbytes is not None else (json.dumps(b).encode()if b is not None else None)
    r=urllib.request.Request(BASE+p,data=body,method=m)
    if b is not None:r.add_header("Content-Type","application/json")
    if dbytes is not None:r.add_header("Content-Type","application/octet-stream")
    if tk:r.add_header("Authorization","Bearer "+tk)
    if h:
        for k,v in h.items():r.add_header(k,v)
    try:
        with urllib.request.urlopen(r,timeout=30)as rr:return rr.status,json.loads(rr.read())
    except urllib.error.HTTPError as e:
        try:return e.code,json.loads(e.read())
        except:return e.code,{}

PASS=[];FAIL=[]
def ck(n,ok):(PASS if ok else FAIL).append(n)

# 1. 建测试文件
os.makedirs(TMP,exist_ok=True)
fpath=os.path.join(TMP,"scene_final.c4d")
payload=os.urandom(12*1024*1024)
with open(fpath,"wb")as f:f.write(payload)
FP=hashlib.sha256(payload).hexdigest()
SZ=len(payload)
print("测试文件: {} ({}MB) fp={}".format(fpath,SZ//1048576,FP[:16]))

# 2. 注册设备
st,d=call("POST","/api/devices/pair-code")
code=d.get("code","")
st,d=call("POST","/api/device/register",
    {"code":code,"name":"备份E2E","platform":"win","owner_username":"admin"})
ck("注册",st==200 and "token" in d)
TOKEN=d.get("token","")
DID=d.get("id")
HA={"X-Device-Token":TOKEN}

# 3. 上报
st,d=call("POST","/api/device/index-batch",
    {"items":[{"rel_path":"scene_final.c4d","filename":"scene_final.c4d","ext":".c4d","size":SZ,"mtime":time.time(),"fingerprint":FP}]},h=HA)
ck("上报",st==200 and d.get("new")==1)

# 4. 归档 critical
st,d=call("GET","/api/devices/{}/files?state=new".format(DID))
fid=d["items"][0]["id"]
from database import get_db
psid=(get_db().execute("SELECT id FROM project_space ORDER BY id LIMIT 1").fetchone()or{"id":1})["id"]
st,d=call("POST","/api/devices/files/{}/archive".format(fid),
    {"project_space_id":psid,"module_key":"project_c4d","is_critical":1})
ck("归档critical",st==200 and "catalog_id" in d)
CAT=d.get("catalog_id")

# 5. 心跳领任务
st,d=call("POST","/api/device/heartbeat",h=HA)
tasks=d.get("tasks",[])
ck("心跳领upload任务",st==200 and any(t["type"]=="upload" for t in tasks))
task=next(t for t in tasks if t["type"]=="upload")
TID=task["id"]
ck("任务指纹匹配",task.get("fingerprint")==FP)

# 6. 分块上传
CH=8*1024*1024
total=(SZ+CH-1)//CH
ok=True
with open(fpath,"rb")as f:
    for ci in range(total):
        chunk=f.read(CH)
        hd={**HA,"X-Chunk-Index":str(ci),"X-Chunk-Total":str(total),"X-Fingerprint":FP}
        st,d=call("POST","/api/device/upload/{}".format(TID),h=hd,dbytes=chunk,tk=None)
        if st!=200:ok=False;print(" chunk {} fail {}".format(ci,d))
ck("分块上传{}块".format(total),ok)
ck("最后块返回merged",d.get("merged")==True and d.get("size")==SZ)

# 7. L1 落盘
store=os.path.join("data","backup_store",FP[:2],FP)
ck("backup_store落盘",os.path.exists(store)and os.path.getsize(store)==SZ)
if os.path.exists(store):
    h2=hashlib.sha256(open(store,"rb").read()).hexdigest()
    ck("落盘字节一致",h2==FP)

# 8. catalog backed_up
row=get_db().execute("SELECT backup_status,backup_path FROM asset_catalog WHERE id=?",[CAT]).fetchone()
ck("catalog=backed_up",row and row["backup_status"]=="backed_up")

# 9. 再心跳无任务
st,d=call("POST","/api/device/heartbeat",h=HA)
ck("无pending任务",st==200 and not d.get("tasks"))

# 10. 备份覆盖率
st,d=call("GET","/api/devices")
td=next(x for x in d["devices"]if x["id"]==DID)
ck("覆盖率=1.0",td.get("backup_ratio")==1.0)

# 清理
call("DELETE","/api/devices/{}".format(DID))
shutil.rmtree(TMP,ignore_errors=True)

print()
for p in PASS:print("PASS",p)
for f in FAIL:print("FAIL",f)
print("\n{}/{} 通过".format(len(PASS),len(PASS)+len(FAIL)))
sys.exit(0 if not FAIL else 1)
