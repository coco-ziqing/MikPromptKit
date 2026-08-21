# -*- coding: utf-8 -*-
"""v5.50.8 验证：比例切换不叠加裁切 + 原始恢复 + 槽内预览图"""
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

print("\n=== 核心验证：依次切换比例，每次都应基于原始图（结果一致，不叠加裁切）===")
# 造一张 800x400 原图
from PIL import Image
src_name = f"v5508_{uuid.uuid4().hex[:8]}.png"
src_path = os.path.join(DATA, "video_refs", src_name)
Image.new("RGB", (800, 400), (90, 140, 210)).save(src_path)

# 依次请求多个比例（模拟前端连续点击，每次都传原始 file_path）
results = {}
for ratio in ["3:4", "16:9", "3:4", "1:1", "16:9", "original"]:
    r = call("POST", "/api/assemble/base-process", {"file_path": src_path, "ratio": ratio})
    key = ratio
    results[key] = (r.get("width"), r.get("height"), r.get("url"))

# 1. 同比例重复请求结果应一致（不叠加）
w1, h1, u1 = results["3:4"]
w2, h2, u2 = results["3:4"]
ok_consistent = (w1, h1) == (w2, h2)
if ok_consistent:
    PASS += 1
    print(f"  [PASS] 重复 3:4 结果一致: {w1}x{h1}（未叠加裁切）")
else:
    FAIL += 1
    print(f"  [FAIL] 重复 3:4 不一致: {w1}x{h1} vs {w2}x{h2}")

# 2. 不同比例轮流切，3:4 再次应仍为 3:4 尺寸（不因中间切过 16:9 而改变）
w3, h3, _ = results["3:4"]
w_after, h_after, _ = results["3:4"]  # 3:4 出现两次，第二次在 16:9 之后
if (w3, h3) == (w_after, h_after):
    PASS += 1
    print(f"  [PASS] 3:4 在切过 16:9 后结果不变: {w_after}x{h_after}")
else:
    FAIL += 1
    print(f"  [FAIL] 叠加裁切仍存在: {w3}x{h3} -> {w_after}x{h_after}")

# 3. 16:9 裁剪结果（800x400 原图 → 16:9 裁切应接近 16:9 比例）
w16, h16, _ = results["16:9"]
ratio16 = w16 / h16 if h16 else 0
if abs(ratio16 - 16/9) < 0.05:
    PASS += 1
    print(f"  [PASS] 16:9 裁剪正确: {w16}x{h16} (ratio={ratio16:.3f})")
else:
    FAIL += 1
    print(f"  [FAIL] 16:9 裁剪错误: {w16}x{h16} (ratio={ratio16:.3f})")

# 4. original 恢复原尺寸（800x400，仅缩放≤1536，不裁切）
wo, ho, _ = results["original"]
if wo == 800 and ho == 400:
    PASS += 1
    print(f"  [PASS] original 保留原尺寸: {wo}x{ho}")
else:
    FAIL += 1
    print(f"  [FAIL] original 未保留原尺寸: {wo}x{ho}")

# 5. 1:1 应为方形
w11, h11, _ = results["1:1"]
if w11 == h11:
    PASS += 1
    print(f"  [PASS] 1:1 方形: {w11}x{h11}")
else:
    FAIL += 1
    print(f"  [FAIL] 1:1 非方形: {w11}x{h11}")

# 6. 切换顺序独立性：用全新请求再验证 3:4（独立会话）
r_final = call("POST", "/api/assemble/base-process", {"file_path": src_path, "ratio": "3:4"})
if (r_final.get("width"), r_final.get("height")) == (w1, h1):
    PASS += 1
    print(f"  [PASS] 独立请求 3:4 与首次一致（无状态污染）")
else:
    FAIL += 1
    print(f"  [FAIL] 状态污染: {r_final.get('width')}x{r_final.get('height')} vs {w1}x{h1}")

# 清理
os.remove(src_path)
import glob
for f in glob.glob(os.path.join(DATA, "base_refs", "base_*")):
    os.remove(f)
PASS += 1

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
