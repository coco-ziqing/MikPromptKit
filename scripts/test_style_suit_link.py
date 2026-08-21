# -*- coding: utf-8 -*-
"""链路验证：套装 CRUD → 配置 → 草稿 → 预检 → 批量渲染入队 → 批次查询"""
import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8080"
PASS = 0
FAIL = 0
TOKEN = ""


def login(username="admin", password="admin"):
    req = urllib.request.Request(BASE + "/api/auth/login",
                                 data=json.dumps({"username": username, "password": password}).encode(),
                                 method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


try:
    lg = login()
    TOKEN = lg.get("token") or lg.get("access_token") or ""
    print(f"登录成功: user={lg.get('username')}, token长度={len(TOKEN)}")
    if not TOKEN:
        print(f"  [WARN] 响应字段: {list(lg.keys())}")
except Exception as e:
    print(f"登录失败: {e}")


def call(method, path, body=None, expect=200):
    global PASS, FAIL
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
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
    ok = status == expect
    if ok:
        PASS += 1
        print(f"  [PASS] {method} {path} -> {status}")
    else:
        FAIL += 1
        print(f"  [FAIL] {method} {path} -> {status} (期望 {expect}): {text[:200]}")
    try:
        return json.loads(text) if text.startswith("{") else {}
    except Exception:
        return {}


print("=== 1. 套装 CRUD ===")
r = call("POST", "/api/style-suits", {"name": "链路验证-影视写实", "tags": ["影视写实"], "remark": "链路验证用"})
suit_id = r.get("item", {}).get("id")
print(f"  -> 新建套装 id={suit_id}")
assert suit_id, "套装创建失败"

r = call("GET", f"/api/style-suits/{suit_id}")
print(f"  -> 默认配置: {json.dumps(r.get('item', {}).get('config', {}), ensure_ascii=False)[:120]}")

cfg = {
    "style_words": {"positive": "电影级写实，35mm镜头，浅景深，皮肤细节真实", "negative": "卡通，变形，低质量"},
    "render_params": {"canvas_size": "1:1", "denoise": 0.65, "cfg": 5.5, "sampler": "dpmpp_2m", "steps": 28,
                      "layer_render": False, "model_version": "5.0", "ratio": "1:1", "resolution_type": "2k"},
    "output_parts": ["main", "three_view", "face"],
    "layout": {"template": "default", "color_card": True, "title_text": "角色设定", "bg_color": "#1a1a2e"},
    "meta": {"name": "链路验证-影视写实", "tags": ["影视写实"], "remark": "链路验证用", "cover": ""},
}
r = call("PUT", f"/api/style-suits/{suit_id}", {"config": cfg})
print(f"  -> 更新后 version_count={r.get('item', {}).get('version_count')}, current_version_id={r.get('item', {}).get('current_version_id')}")

r = call("GET", f"/api/style-suits/{suit_id}/versions")
print(f"  -> 版本数: {len(r.get('items', []))}")

print("\n=== 2. 套装复制/收藏/导出 ===")
r = call("POST", f"/api/style-suits/{suit_id}/duplicate")
dup_id = r.get("item", {}).get("id")
print(f"  -> 复制出新套装 id={dup_id}")
r = call("PUT", f"/api/style-suits/{suit_id}/favorite", {"fav": True})
print(f"  -> 收藏: {r.get('ok')}")
r = call("GET", f"/api/style-suits/{suit_id}/export")
print(f"  -> 导出: format={r.get('doc', {}).get('format')}, schema={r.get('doc', {}).get('schema_version')}, name={r.get('doc', {}).get('name')}")

print("\n=== 3. .style 导入 ===")
doc = r.get("doc", {})
r = call("POST", "/api/style-suits/import", doc)
imp_id = r.get("item", {}).get("id")
print(f"  -> 导入新套装 id={imp_id}, 产出配件={r.get('item', {}).get('config', {}).get('output_parts')}")

print("\n=== 4. 装配草稿 ===")
r = call("POST", "/api/assemble/draft", {
    "name": "验证草稿",
    "base_asset_ref": {"source": "media", "id": 1, "url": "/media/1", "desc": "青年男性，正脸"},
    "rune_card_ids": [1, 2],
    "suit_id": suit_id,
    "accessory_list": [{"part": "expressions"}],
    "channel": "virtual",
    "config_override": {"render_params": {"cfg": 6.0}},
})
draft_id = r.get("item", {}).get("id")
print(f"  -> 草稿 id={draft_id}, rune_cards={r.get('item', {}).get('rune_card_ids')}")

r = call("POST", "/api/assemble/precheck", {"draft_id": draft_id})
print(f"  -> 预检 passed={r.get('passed')}, issues={len(r.get('issues', []))}, summary={json.dumps(r.get('summary', {}), ensure_ascii=False)}")

print("\n=== 5. 预检拦截：无基底 ===")
r = call("POST", "/api/assemble/draft", {
    "name": "无基底草稿", "base_asset_ref": {}, "rune_card_ids": [], "suit_id": suit_id,
    "accessory_list": [], "channel": "virtual", "config_override": {},
})
r = call("POST", "/api/assemble/precheck", {"draft_id": r.get("item", {}).get("id")})
print(f"  -> 无基底预检 passed={r.get('passed')}（应为 False）")
errs = [i["code"] for i in r.get("issues", [])]
print(f"  -> 问题码: {errs}（应含 no_base）")

print("\n=== 6. 批量渲染入队（编排层验证，worker 不真实提交）===")
r = call("POST", "/api/assemble/render", {"draft_id": draft_id, "license_info": {}})
batch = r.get("batch", {})
print(f"  -> batch id={batch.get('id')}, status={batch.get('status')}, total={batch.get('total')}, task_ids={batch.get('task_ids')}")

r = call("GET", f"/api/assemble/render/{batch.get('id')}")
print(f"  -> 批次查询: status={r.get('batch', {}).get('status')}, tasks={len(r.get('batch', {}).get('tasks', []))}")

r = call("POST", f"/api/assemble/render/{batch.get('id')}/refresh")
print(f"  -> 刷新统计: done={r.get('batch', {}).get('done')}, fail={r.get('batch', {}).get('fail')}")

print("\n=== 7. 回收站 ===")
r = call("DELETE", f"/api/style-suits/{dup_id}")
r = call("GET", "/api/style-suits", None, 200)
print(f"  -> 删除后 all tab 数量={r.get('total')}（应不含副本）")
r = call("GET", "/api/style-suits?tab=trash")
print(f"  -> 回收站数量={r.get('total')}（应含副本）")
r = call("POST", f"/api/style-suits/{dup_id}/restore")
r = call("GET", "/api/style-suits?tab=trash")
print(f"  -> 恢复后回收站数量={r.get('total')}")

print(f"\n========== 结果: PASS={PASS} FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
