# -*- coding: utf-8 -*-
"""v5.49.0 真实功能验证 v2：Body 参数 + task_ids 对象数组格式"""
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
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = resp.status
            content = resp.read()
    except urllib.error.HTTPError as e:
        status = e.code
        content = e.read()
    except Exception as e:
        status = 0
        content = str(e).encode()
    ok = status == expect
    if ok:
        PASS += 1
        print(f"  [PASS] {method} {path} -> {status}")
    else:
        FAIL += 1
        print(f"  [FAIL] {method} {path} -> {status} (期望 {expect}): {content[:300]}")
    if raw:
        return content
    try:
        return json.loads(content.decode("utf-8", errors="replace"))
    except Exception:
        return {}

login()

print("=== 造批次（task_ids 对象数组格式）+ 假完成图片 ===")
import sqlite3
c = sqlite3.connect(os.path.join(DATA, "prompts.db"))
c.row_factory = sqlite3.Row
now = "2026-08-21 11:30:00"
cur = c.execute(
    """INSERT INTO render_batch (draft_id, suit_id, channel, status, total, done, task_ids, license_info, created_by, created_at)
       VALUES (0, 8, 'virtual', 'done', 3, 3, '[]', '{}', 1, ?)""", [now])
batch_id = cur.lastrowid

try:
    from PIL import Image
    task_entries = []
    for i, lb in enumerate(["main", "three_view", "face"]):
        fname = f"v549b_{uuid.uuid4().hex[:8]}_{lb}.png"
        img = Image.new("RGB", (512, 512), (i * 60 + 40, 100, 200))
        img.save(os.path.join(DATA, "originals", fname))
        cur = c.execute(
            """INSERT INTO card_gen_tasks (card_id, task_type, prompt, status, media_type, result_filename, result_original, creator_id, created_at)
               VALUES (0, 'text2image', ?, 'done', 'image', ?, ?, 1, ?)""",
            [f"测试 {lb}", fname, fname, now])
        task_entries.append({"task_id": cur.lastrowid, "part": lb})
    c.execute("UPDATE render_batch SET task_ids=?, done=3 WHERE id=?", [json.dumps(task_entries), batch_id])
    c.commit()
    print(f"  批次 {batch_id} 任务对象: {task_entries}")
    PASS += 1
except Exception as e:
    print("  造假数据失败:", e)
    FAIL += 1
finally:
    c.close()

print("\n=== 拼贴合成（Body 中文参数）===")
r = call("POST", f"/api/assemble/render/{batch_id}/compose",
         {"template": "default", "title_text": "验证角色·电影感", "bg_color": "#1a1a2e"})
img_url = r.get("image", "")
colors = r.get("colors", [])
print(f"  拼贴图: {img_url}")
print(f"  色卡: {json.dumps(colors[:3], ensure_ascii=False)}")

print("\n=== rolecard 归档（Body 中文参数）===")
r = call("POST", f"/api/assemble/render/{batch_id}/archive",
         {"master_project_id": 1, "name": "验证归档角色·影视写实"})
print(f"  归档: role_id={r.get('role_id')}, name={r.get('name')}, assets={r.get('archived')}")

print("\n=== 归档资产核验 ===")
rid = r.get("role_id")
c = sqlite3.connect(os.path.join(DATA, "prompts.db"))
c.row_factory = sqlite3.Row
if rid:
    assets = c.execute("SELECT filename, asset_kind, caption FROM project_role_asset WHERE project_role_id=?", [rid]).fetchall()
    for a in assets:
        print(f"    - [{a['asset_kind']}] {a['caption']}: {a['filename']}")
    ok = len(assets) == 3
    PASS += 1 if ok else 0
    FAIL += 0 if ok else 1
    print(f"  资产数: {len(assets)}（应 3）")
c.close()

print("\n=== 资产包导出 ===")
content = call("GET", f"/api/assemble/render/{batch_id}/export", expect=200, raw=True)
if content[:2] == b"PK":
    import io, zipfile
    zf = zipfile.ZipFile(io.BytesIO(content))
    names = zf.namelist()
    print(f"  zip 内容: {names}")
    has_labels = any("主角色定图" in n for n in names) and any("三视图" in n for n in names)
    ok = has_labels
    PASS += 1 if ok else 0
    FAIL += 0 if ok else 1
    print(f"  配件名区分: {has_labels}")
else:
    print("  [FAIL] 非 zip 响应")
    FAIL += 1

print("\n=== 清理测试数据 ===")
c = sqlite3.connect(os.path.join(DATA, "prompts.db"))
c.row_factory = sqlite3.Row
for entry in task_entries:
    tid = entry["task_id"]
    row = c.execute("SELECT result_original FROM card_gen_tasks WHERE id=?", [tid]).fetchone()
    if row and row["result_original"]:
        fp = os.path.join(DATA, "originals", row["result_original"])
        if os.path.isfile(fp):
            os.remove(fp)
    c.execute("DELETE FROM card_gen_tasks WHERE id=?", [tid])
c.execute("DELETE FROM render_batch WHERE id=?", [batch_id])
if rid:
    assets = c.execute("SELECT rel_path FROM project_role_asset WHERE project_role_id=?", [rid]).fetchall()
    for a in assets:
        fp = os.path.join(DATA, a["rel_path"].replace("/", os.sep))
        if os.path.isfile(fp):
            os.remove(fp)
    c.execute("DELETE FROM project_role_asset WHERE project_role_id=?", [rid])
    c.execute("DELETE FROM project_role WHERE id=?", [rid])
    print(f"  清理归档角色 {rid}")
import glob
for f in glob.glob(os.path.join(DATA, "thumbnails", f"rolesheet_{batch_id}_*.jpg")):
    os.remove(f)
for f in glob.glob(os.path.join(DATA, "rolecard_archives", f"rolecard_batch{batch_id}_*.zip")):
    os.remove(f)
c.commit()
c.close()
print("  清理完成")

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
