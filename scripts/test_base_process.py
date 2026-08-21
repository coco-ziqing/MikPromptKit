# -*- coding: utf-8 -*-
"""v5.50.7 后端验证：基底预处理 + 平台清单"""
import json, os, sys, urllib.request, uuid
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8080"
DATA = r"C:\Users\admin\prompt-tool-dev\MikPromptKit\data"
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
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            content = resp.read()
    except urllib.error.HTTPError as e:
        status = e.code
        content = e.read()
    except Exception as e:
        status = 0
        content = str(e).encode()
    if status == expect:
        PASS += 1
        print(f"  [PASS] {method} {path.split('?')[0]} -> {status}")
    else:
        FAIL += 1
        print(f"  [FAIL] {method} {path.split('?')[0]} -> {status} (期望 {expect}): {content[:200]}")
    if raw:
        return content
    try:
        return json.loads(content.decode("utf-8", errors="replace"))
    except Exception:
        return {}

login()

print("\n=== 1. 平台清单 ===")
r = call("GET", "/api/assemble/platforms")
plats = r.get("platforms", {})
print(f"  平台: {list(plats.keys())}")

print("\n=== 2. 基底预处理（先造一张非标比例图上传）===")
# 造一张 2:1 横图（非标准比例，测试居中裁剪）
from PIL import Image
fname = f"v5507_{uuid.uuid4().hex[:8]}.png"
img_path = os.path.join(DATA, "video_refs", fname)
Image.new("RGB", (800, 400), (120, 80, 200)).save(img_path)

# 用 file_path 直接处理（不经上传接口，验证预处理本身）
r = call("POST", "/api/assemble/base-process", {"file_path": img_path, "ratio": "1:1"})
proc = r
print(f"  处理结果: w={proc.get('width')} h={proc.get('height')} ratio={proc.get('ratio')} url={proc.get('url')}")
if proc.get("width") == proc.get("height"):
    PASS += 1
    print("  [PASS] 2:1 横图居中裁剪为 1:1 方形")
else:
    FAIL += 1
    print(f"  [FAIL] 裁剪未生效: {proc.get('width')}x{proc.get('height')}")

# 3:4 竖比例
r2 = call("POST", "/api/assemble/base-process", {"file_path": img_path, "ratio": "3:4"})
if r2.get("width") and r2.get("height") and r2["width"] < r2["height"]:
    PASS += 1
    print(f"  [PASS] 3:4 竖比例裁剪: {r2['width']}x{r2['height']}")
else:
    FAIL += 1
    print(f"  [FAIL] 3:4 裁剪: {r2.get('width')}x{r2.get('height')}")

# 预览图可访问
if proc.get("preview_url"):
    content = call("GET", proc["preview_url"], expect=200, raw=True)
    if content[:2] == b"\xff\xd8":
        PASS += 1
        print("  [PASS] 预览图 JPEG 可访问")
    else:
        FAIL += 1
        print(f"  [FAIL] 预览图非 JPEG: {content[:10]}")

# 非法比例拦截
call("POST", "/api/assemble/base-process", {"file_path": img_path, "ratio": "7:1"}, expect=400)

print("\n=== 3. 清理 ===")
if os.path.isfile(img_path):
    os.remove(img_path)
# 清理处理产物
import glob
for f in glob.glob(os.path.join(DATA, "base_refs", "base_*")):
    os.remove(f)
print("  清理完成")
PASS += 1

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
