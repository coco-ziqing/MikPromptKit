# -*- coding: utf-8 -*-
"""Phase35.2 版本/审核/团队成员 端到端测试。"""
import sys, json, io, uuid, urllib.request, urllib.error
sys.path.insert(0, "backend")
from jwt_auth import generate_test_token

BASE = "http://127.0.0.1:8080"
ADMIN = generate_test_token(1, "admin", "admin")
ED = generate_test_token(2, "editor1", "editor")
V1 = generate_test_token(3, "viewer1", "viewer")

def req(method, path, tk=None, data=None, ctype="application/json"):
    body = None if data is None else (data if isinstance(data, bytes) else json.dumps(data).encode())
    r = urllib.request.Request(BASE + path, data=body, method=method)
    if data is not None and ctype: r.add_header("Content-Type", ctype)
    if tk: r.add_header("Authorization", "Bearer " + tk)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read()
            try: return resp.status, json.loads(raw.decode())
            except Exception: return resp.status, raw
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}

def post_file(path, tk, fname, content, extra):
    b = "----pk" + uuid.uuid4().hex
    parts = []
    for k, v in extra.items():
        parts.append(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    parts.append((f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fname}\"\r\n"
                  f"Content-Type: application/octet-stream\r\n\r\n").encode() + content + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    return req("POST", path, tk=tk, data=b"".join(parts), ctype=f"multipart/form-data; boundary={b}")

def png(c=(120, 60, 200)):
    from PIL import Image
    buf = io.BytesIO(); Image.new("RGB", (48, 36), c).save(buf, "PNG"); return buf.getvalue()

R = []
st, d = req("POST", "/api/projects", tk=ADMIN, data={"name": "审核测试_352", "modules": ["image"], "visibility": "private"})
pid = (d.get("project") or {}).get("id"); R.append(("建私有项目", st == 200 and pid))
st, d = post_file(f"/api/projects/{pid}/assets", ADMIN, "a.png", png(), {"module": "image", "note": ""})
cid = (d.get("asset") or {}).get("id"); R.append(("上传v1", st == 200 and cid))
st, d = req("GET", f"/api/assets/{cid}/versions", tk=ADMIN)
R.append(("版本数1+draft", st == 200 and len(d.get("versions", [])) == 1 and d.get("review_status") == "draft"))
st, d = post_file(f"/api/assets/{cid}/versions", ADMIN, "a.png", png((10, 200, 90)), {"note": "改了颜色"})
R.append(("上传v2", st == 200 and d.get("version_no") == 2))
st, d = req("GET", f"/api/assets/{cid}/versions", tk=ADMIN)
R.append(("版本数2", st == 200 and len(d.get("versions", [])) == 2))
cur_v1 = [v for v in d["versions"] if v["version_no"] == 1][0]["id"]
st, d = req("POST", f"/api/assets/{cid}/rollback/{cur_v1}", tk=ADMIN)
R.append(("回滚到v1", st == 200 and d.get("current_version_id") == cur_v1))
st, d = req("POST", f"/api/assets/{cid}/submit", tk=ADMIN, data={})
R.append(("提交审核in_review", st == 200 and d.get("review_status") == "in_review"))
st, d = req("GET", f"/api/projects/{pid}", tk=ED)
R.append(("非成员访问被拒", st == 404))
st, d = req("POST", f"/api/projects/{pid}/members", tk=ADMIN, data={"user_id": 2, "role": "reviewer"})
R.append(("添加reviewer成员", st == 200))
st, d = req("GET", f"/api/projects/{pid}", tk=ED)
R.append(("成员可访问", st == 200))
st, d = req("POST", f"/api/assets/{cid}/review", tk=ED, data={"action": "approve", "comment": "通过"})
R.append(("reviewer批准", st == 200 and d.get("review_status") == "approved"))
st, d = req("GET", f"/api/assets/{cid}", tk=ADMIN)
R.append(("批准后标记关键", st == 200 and d["asset"].get("is_critical") == 1))
st, d = req("GET", f"/api/assets/{cid}/reviews", tk=ADMIN)
acts = [r["action"] for r in d.get("reviews", [])]
R.append(("审核记录含submit+approve", "submit" in acts and "approve" in acts))
st, d = req("POST", f"/api/assets/{cid}/comment", tk=ED, data={"comment": "很好"})
R.append(("评论成功", st == 200))
st, d = req("GET", f"/api/projects/{pid}", tk=V1)
R.append(("无关用户访问被拒", st == 404))
st, d = req("GET", f"/api/projects/{pid}/members", tk=ADMIN)
roles = sorted([m["role"] for m in d.get("members", [])])
R.append(("成员=owner+reviewer", st == 200 and roles == ["owner", "reviewer"]))
st, d = req("POST", f"/api/projects/{pid}/members", tk=ED, data={"user_id": 3, "role": "viewer"})
R.append(("非owner加成员被拒", st == 403))
st, d = req("DELETE", f"/api/projects/{pid}/members/2", tk=ADMIN)
R.append(("移除成员", st == 200))
st, d = req("GET", f"/api/projects/{pid}", tk=ED)
R.append(("移除后不可访问", st == 404))
st, d = req("DELETE", f"/api/projects/{pid}/members/1", tk=ADMIN)
R.append(("不能移除owner", st == 400))
st, d = req("DELETE", f"/api/projects/{pid}", tk=ADMIN)
R.append(("删除项目", st == 200))

print("\n==== 35.2 测试 ====")
ok = 0
for n, p in R:
    print(("  PASS " if p else "  FAIL ") + n); ok += 1 if p else 0
print(f"\n{ok}/{len(R)} 通过 (pid={pid})")
sys.exit(0 if ok == len(R) else 1)
