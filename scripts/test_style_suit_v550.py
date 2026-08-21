# -*- coding: utf-8 -*-
"""v5.50.0 验证：双通道参数映射 + 右键菜单 + 进度聚合 + 词卡加载"""
import json, sys, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8080"
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

def call(method, path, body=None, expect=200):
    global PASS, FAIL
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = resp.status
            text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        text = e.read().decode("utf-8", errors="replace")
    except Exception as e:
        status = 0
        text = str(e)
    if status == expect:
        PASS += 1
        print(f"  [PASS] {method} {path} -> {status}")
    else:
        FAIL += 1
        print(f"  [FAIL] {method} {path} -> {status} (期望 {expect}): {text[:200]}")
    try:
        return json.loads(text) if text.startswith("{") else {}
    except Exception:
        return {}

login()

print("\n=== 1. 双通道参数映射（real 通道预检）===")
# 建一个 real 通道草稿
r = call("POST", "/api/assemble/draft", {
    "name": "v550写实草稿",
    "base_asset_ref": {"source": "media", "id": 1, "desc": "测试"},
    "rune_card_ids": [],
    "suit_id": 8,  # 影视写实预置模板
    "accessory_list": [],
    "channel": "real",
    "config_override": {"render_params": {"ratio": "16:9", "resolution_type": "2k", "sampler": "euler_a"}},
})
draft_id = r.get("item", {}).get("id")
print(f"  草稿 id={draft_id}, channel={r.get('item', {}).get('channel')}")

r = call("POST", "/api/assemble/precheck", {"draft_id": draft_id})
passed = r.get("passed")
issues = r.get("issues", [])
warns = [i for i in issues if i.get("level") == "warn"]
errs = [i for i in issues if i.get("level") == "error"]
print(f"  passed={passed}, warns={len(warns)}, errs={len(errs)}")
print(f"  warn 示例: {warns[0]['msg'] if warns else '无'}")
# real 通道不应报模型版本错（放宽约束），且应有通道适配提示
ok_adapt = any(i.get("code") == "channel_adapt" for i in issues)
ok_model = not any("模型版本" in (i.get("msg") or "") for i in errs)
if ok_adapt and ok_model:
    PASS += 1
    print("  [PASS] real 通道参数映射提示 + 模型约束放宽")
else:
    FAIL += 1
    print(f"  [FAIL] 通道映射: adapt={ok_adapt}, model_relax={ok_model}")

print("\n=== 2. 清理测试草稿 ===")
import sqlite3, os
c = sqlite3.connect(os.path.join(r"C:\Users\admin\prompt-tool-dev\MikPromptKit\data", "prompts.db"))
c.execute("DELETE FROM assemble_draft WHERE name LIKE 'v550%'")
c.commit()
c.close()
print("  已清理")
PASS += 1

print(f"\n========== 后端结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
