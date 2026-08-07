"""PhaseB Presence增强回归"""
import json
import sys
import urllib.error
import urllib.request

sys.path.insert(0,"backend")
from jwt_auth import generate_test_token

BASE="http://127.0.0.1:8080"
A=generate_test_token(1,"admin","admin")
E=generate_test_token(2,"editor1","editor")

def c(met,path,b=None,tk=A):
    r=urllib.request.Request(BASE+path,data=json.dumps(b).encode()if b else None,method=met)
    if b:r.add_header("Content-Type","application/json")
    if tk:r.add_header("Authorization","Bearer "+tk)
    try:
        with urllib.request.urlopen(r,timeout=10)as rr:return rr.status,json.loads(rr.read())
    except urllib.error.HTTPError as e:
        try:return e.code,json.loads(e.read())
        except:return e.code,{}

P=[];F=[]
def Ck(n,ok):(P if ok else F).append(n)

# 1. 快照含新字段
s,d=c("GET","/api/presence")
u0=d["users"][0]if d.get("users")else{}
Ck("快照含current_page", "current_page" in u0)
Ck("快照含current_project","current_project" in u0)
Ck("快照含current_project_id","current_project_id" in u0)

# 2. admin 强制下线不存在用户
s,d=c("POST","/api/presence/disconnect/99999")
Ck("下线不存在的(closed=0)",s==200 and d.get("closed",-1)==0)

# 3. 非admin 无权下线
s,d=c("POST","/api/presence/disconnect/1",tk=E)
Ck("非admin下线403",s==403)

# 4. admin 不能踢自己
s,d=c("POST","/api/presence/disconnect/1")
Ck("admin不能踢自己400",s==400)

# 5. 状态设置端点仍正常
s,d=c("POST","/api/presence/status",{"status":"away"})
Ck("手动状态away",s==200)

s,d=c("POST","/api/presence/status",{"status":"online"})
Ck("手动状态online",s==200)

# 6. 无效状态
s,_=c("POST","/api/presence/status",{"status":"invalid"})
Ck("无效状态400",s==400)

print()
for p in P:print("PASS",p)
for f in F:print("FAIL",f)
print("\n{}/{} 通过".format(len(P),len(P)+len(F)))
sys.exit(0 if not F else 1)
