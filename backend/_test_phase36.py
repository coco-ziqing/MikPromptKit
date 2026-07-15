# -*- coding: utf-8 -*-
"""Phase36 回归组合测试：模版库 + 组装器维度 + 项目实例 + 版本/档案 + 审核 + 分镜联动。"""
import sys, json, sqlite3, urllib.request, urllib.error
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, "backend")
from jwt_auth import generate_test_token
ADMIN = generate_test_token(1, "admin", "admin")
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request("http://127.0.0.1:8080" + path, data=data, method=method)
    if data: r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + ADMIN)
    try:
        with urllib.request.urlopen(r, timeout=12) as resp: return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}
R = []

# 1. 角色模版
st, d = call("GET", "/api/character-composer/templates")
R.append(("角色模版>=4", d.get("total",0) >= 4))
a = d["items"][0]
st, d = call("GET", "/api/character-composer/templates/%d" % a["id"])
R.append(("模版结构含槽位", len(d["template"]["structure"]) >= 14))

# 2. 角色维度重绑 char_ 组
st, d = call("GET", "/api/character-composer/dimensions")
R.append(("角色dimensions=17", len(d["dimensions"]) == 17))
hd = next((x for x in d["dimensions"] if x["key"] == "hairstyle"), {})
R.append(("hairstyle绑定char_hair有卡", bool(hd.get("groups")) and hd["groups"][0]["card_count"]>0))

# 3. 按模版取维度
st, d = call("GET", "/api/character-composer/dimensions?template_id=%d" % a["id"])
R.append(("按模版dimensions=17", len(d["dimensions"]) == 17))

# 4. compose 连通
st, d = call("POST", "/api/character-composer/compose", {"settings": {"gender":"女性","hairstyle":"黑长直","style":"新海诚"}, "density":"standard"})
R.append(("compose有输出", len(d.get("text","")) > 5))

# 5. 场景对称验证
st, d = call("GET", "/api/scene-composer/templates")
R.append(("场景模版>=6", d.get("total",0) >= 6))
st, d = call("GET", "/api/scene-composer/dimensions")
R.append(("场景dimensions=14", len(d["dimensions"]) == 14))
st, d = call("POST", "/api/scene-composer/compose", {"settings": {"location":"魔法森林深处","time":"晨曦","style":"吉卜力"}, "density":"standard"})
R.append(("场景compose", "森林" in d.get("text","")))

# 6. 总项目角色实例继承
src = sqlite3.connect('data/prompts.db').execute("SELECT id FROM character_profiles ORDER BY id LIMIT 1").fetchone()[0]
d2 = sqlite3.connect('data/prompts.db').execute("SELECT id FROM master_project ORDER BY id LIMIT 1").fetchone()[0]
st, d = call("POST", "/api/master/%d/roles/adopt" % d2, {"role_type":"character","source_profile_id":src})
rid = d.get("id"); R.append(("继承角色实例", st == 200 and rid))
st, d = call("GET", "/api/roles/%d" % rid)
R.append(("实例settings继承", bool(d["role"].get("settings"))))
R.append(("version_count=1", d["role"]["version_count"] == 1))

# 7. 编辑→新版本
st, d = call("PUT", "/api/roles/%d" % rid, {"settings": {"gender":"改了"}})
R.append(("编辑settings变更", d.get("changed")))
st, d = call("GET", "/api/roles/%d/versions" % rid)
R.append(("版本数=2", len(d["versions"]) == 2))

# 8. 审核
st, d = call("POST", "/api/roles/%d/review" % rid, {"action":"submit"})
R.append(("提交in_review", d.get("review_status") == "in_review"))
st, d = call("POST", "/api/roles/%d/review" % rid, {"action":"approve","comment":"OK"})
R.append(("批准approved", d.get("review_status") == "approved"))

# 9. 分镜联动
spid = sqlite3.connect('data/prompts.db').execute("SELECT seedance_project_id FROM master_sub_project WHERE master_project_id=? LIMIT 1", [d2]).fetchone()
if spid:
    spid = spid[0]
    st, d = call("GET", "/api/seedance/%d/roles?role_type=character" % spid)
    R.append(("seedance解析master列实例", d.get("master_project_id") == d2))
else:
    R.append(("种子舞关联(无数据跳过)", True))

# 清理
call("DELETE", "/api/roles/%d" % rid)
st, d = call("GET", "/api/roles/%d" % rid)
R.append(("删后404", st == 404))

print("\n==== Phase36 回归 ====")
ok = 0
for n, p in R:
    print(("  PASS " if p else "  FAIL ") + n); ok += 1 if p else 0
print("\n%d/%d 通过" % (ok, len(R)))
sys.exit(0 if ok == len(R) else 1)
