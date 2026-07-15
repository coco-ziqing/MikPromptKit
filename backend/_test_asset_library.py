# -*- coding: utf-8 -*-
"""Phase35.1 资产库端到端测试。"""
import sys, os, json, io, uuid, urllib.request, urllib.error
sys.path.insert(0, "backend")
from jwt_auth import generate_test_token

BASE = "http://127.0.0.1:8080"
A = generate_test_token(1, "admin", "admin")      # owner
B = generate_test_token(2, "editor1", "editor")   # 他人

def req(method, path, token=None, data=None, ctype="application/json"):
    url = BASE + path
    body = None
    if data is not None:
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
    r = urllib.request.Request(url, data=body, method=method)
    if data is not None and ctype:
        r.add_header("Content-Type", ctype)
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read()
            try: return resp.status, json.loads(raw.decode())
            except Exception: return resp.status, raw
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}

def post_file(path, token, field_file_name, content: bytes, module, note=""):
    boundary = "----pk" + uuid.uuid4().hex
    parts = []
    def add_field(name, value):
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    add_field("module", module); add_field("note", note)
    parts.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{field_file_name}\"\r\n"
                  f"Content-Type: application/octet-stream\r\n\r\n").encode() + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return req("POST", path, token=token, data=body, ctype=f"multipart/form-data; boundary={boundary}")

def png_bytes(color=(200, 80, 80)):
    from PIL import Image
    im = Image.new("RGB", (64, 48), color)
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()

R = []
# 1 模块字典
st, d = req("GET", "/api/asset-modules", token=A)
R.append(("模块字典>=14", st == 200 and len(d.get("modules", [])) >= 14))

# 2 建私有项目
st, d = req("POST", "/api/projects", token=A, data={"name": "测试项目_351", "modules": ["image", "project_c4d"], "visibility": "private"})
pid = (d.get("project") or {}).get("id")
R.append(("建私有项目", st == 200 and pid))

# 3 上传图片
img = png_bytes()
st, d = post_file(f"/api/projects/{pid}/assets", A, "shot01.png", img, "image")
cid = (d.get("asset") or {}).get("id")
R.append(("上传图片成功", st == 200 and cid))
R.append(("图片生成缩略图", (d.get("asset") or {}).get("has_thumb") is True))
R.append(("图片非关键(默认)", (d.get("asset") or {}).get("is_critical") == 0))

# 4 重复上传（相同内容）
st, d = post_file(f"/api/projects/{pid}/assets", A, "shot01_copy.png", img, "image")
R.append(("查重命中", st == 200 and d.get("duplicate") is not None))

# 5 上传 c4d 工程文件 → 关键
st, d = post_file(f"/api/projects/{pid}/assets", A, "scene.c4d", b"FAKE_C4D_DATA" * 100, "project_c4d")
R.append(("上传C4D工程成功", st == 200))
R.append(("工程文件默认关键(备份)", (d.get("asset") or {}).get("is_critical") == 1))

# 6 错误扩展名
st, d = post_file(f"/api/projects/{pid}/assets", A, "bad.exe", b"x", "image")
R.append(("错误扩展名被拒", st == 400))

# 7 列表 + 计数
st, d = req("GET", f"/api/projects/{pid}/assets", token=A)
R.append(("资产列表", st == 200 and d.get("total") == 3 and d["counts"].get("image") == 2 and d["counts"].get("project_c4d") == 1))

# 8 缩略图服务
st, d = req("GET", f"/api/assets/{cid}/thumb", token=A)
R.append(("缩略图可服务", st == 200 and isinstance(d, bytes) and len(d) > 100))

# 9 原文件服务
st, d = req("GET", f"/api/assets/{cid}/file", token=A)
R.append(("原文件可服务", st == 200 and isinstance(d, bytes) and len(d) == len(img)))

# 10 查重报告
st, d = req("GET", f"/api/projects/{pid}/dedup", token=A)
R.append(("查重报告1组", st == 200 and d.get("total_groups") == 1))

# 11 私有隔离：B 看不到
st, d = req("GET", "/api/projects?scope=all", token=B)
ids = [p["id"] for p in d.get("projects", [])]
R.append(("他人列表不含私有项目", pid not in ids))
st, d = req("GET", f"/api/projects/{pid}", token=B)
R.append(("他人直接访问被拒", st == 404))
st, d = post_file(f"/api/projects/{pid}/assets", B, "x.png", img, "image")
R.append(("他人上传被拒", st in (403, 404)))

# 12 删除资产 + 项目
st, d = req("DELETE", f"/api/assets/{cid}", token=A)
R.append(("删除资产", st == 200))
st, d = req("GET", f"/api/projects/{pid}/assets", token=A)
R.append(("删后剩2", st == 200 and d.get("total") == 2))
st, d = req("DELETE", f"/api/projects/{pid}", token=A)
R.append(("删除项目", st == 200))
st, d = req("GET", f"/api/projects/{pid}", token=A)
R.append(("项目已删(404)", st == 404))

print("\n==== 资产库测试 ====")
ok = 0
for n, p in R:
    print(("  PASS " if p else "  FAIL ") + n); ok += 1 if p else 0
print(f"\n{ok}/{len(R)} 通过  (项目 pid={pid})")
sys.exit(0 if ok == len(R) else 1)
