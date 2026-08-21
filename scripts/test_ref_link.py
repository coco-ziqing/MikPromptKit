# -*- coding: utf-8 -*-
"""v5.50.28 参考图链路修复验证：mock 提交分发 + source_image 落库 + params 组装"""
import sys, os, sqlite3, json, tempfile
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, r"C:\Users\admin\prompt-tool-dev\MikPromptKit\backend")
os.chdir(r"C:\Users\admin\prompt-tool-dev\MikPromptKit\backend")

PASS = 0
FAIL = 0
def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name} {extra}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {extra}")

# ---------- 1. _submit_task 分发：text2image 带图 → image2image ----------
import api.card_gen as card_gen
import api.dreamina as dreamina_mod

calls = []
def fake_image2image(paths, prompt, **kw):
    calls.append(("image2image", paths, prompt, kw))
    return {"ok": True, "submit_id": "mock-img2img"}
def fake_text2image(prompt, **kw):
    calls.append(("text2image", [], prompt, kw))
    return {"ok": True, "submit_id": "mock-txt2img"}

# _submit_task 函数内 from api.dreamina import ... → mock api.dreamina 模块属性
dreamina_mod.dreamina_submit_image2image = fake_image2image
dreamina_mod.dreamina_submit_text2image = fake_text2image

# 造真实测试图
test_img = os.path.join(tempfile.gettempdir(), "v55028_ref.png")
from PIL import Image
Image.new("RGB", (128, 128), (200, 80, 60)).save(test_img)

# 带 source_image 的 text2image 任务
task_with_img = {"task_type": "text2image", "engine": "dreamina",
                 "prompt": "参考@图像1作为角色外观参考，严格保持角色外貌一致，电影级写实",
                 "source_image": test_img, "model_version": "5.0",
                 "ratio": "1:1", "resolution_type": "2k"}
res = card_gen._submit_task(task_with_img)
ok("带图 text2image 走 image2image", calls and calls[-1][0] == "image2image", f"({calls[-1][0] if calls else '无调用'})")
ok("image2image 传图路径(压缩后)", bool(calls) and calls[-1][1] and os.path.isfile(calls[-1][1][0]), f"({calls[-1][1][0][-40:] if calls and calls[-1][1] else '无'})")
ok("image2image 带 prompt", bool(calls) and "参考@图像1" in calls[-1][2])

# 不带图 → 纯 text2image
calls.clear()
task_no_img = {"task_type": "text2image", "engine": "dreamina",
               "prompt": "纯文本生成", "source_image": "", "model_version": "5.0",
               "ratio": "1:1", "resolution_type": "2k"}
res2 = card_gen._submit_task(task_no_img)
ok("无图 text2image 走纯文生图", calls and calls[-1][0] == "text2image")

# ---------- 2. _create_tasks：source_image 从 params 取 ----------
import api.assemble as assemble_mod
DB = r"C:\Users\admin\prompt-tool-dev\MikPromptKit\data\prompts.db"
c = sqlite3.connect(DB)
c.row_factory = sqlite3.Row
now = "2026-08-21 21:10:00"
grp = c.execute("SELECT id FROM word_card_group WHERE group_key='assemble_产物' LIMIT 1").fetchone()
gid = grp["id"]
cur = c.execute("INSERT INTO word_card (group_id, name, content, is_deleted, created_at, updated_at) VALUES (?,?,?,0,?,?)",
                [gid, "装配-参考图验证", "测试内容", now, now])
tmp_id = cur.lastrowid
c.commit()

fake_u = {"id": 1}
out = card_gen._create_tasks([tmp_id], "text2image",
                             {"prompt": "参考@图像1...", "source_image": test_img,
                              "model_version": "5.0", "ratio": "1:1", "resolution_type": "2k",
                              "engine": "dreamina"}, fake_u)
tid = out[0]["task_id"]
row = c.execute("SELECT source_image, task_type, prompt FROM card_gen_tasks WHERE id=?", [tid]).fetchone()
ok("_create_tasks 落 source_image=params", row["source_image"] == test_img, f"({row['source_image'][:40]})")
ok("任务类型 text2image", row["task_type"] == "text2image")

# 无 params.source_image → 回退词卡 original_ref
cur2 = c.execute("INSERT INTO word_card (group_id, name, content, original_ref, is_deleted, created_at, updated_at) VALUES (?,?,?,?,0,?,?)",
                 [gid, "装配-无图", "测试", "media/original/test.jpg", now, now])
tmp2 = cur2.lastrowid
c.commit()
out2 = card_gen._create_tasks([tmp2], "text2image", {"prompt": "x", "engine": "dreamina"}, fake_u)
row2 = c.execute("SELECT source_image FROM card_gen_tasks WHERE id=?", [out2[0]["task_id"]]).fetchone()
ok("无 params 时回退词卡 original_ref", row2["source_image"] == "media/original/test.jpg")

# 清理测试数据
c.execute("DELETE FROM card_gen_tasks WHERE id IN (?,?)", [tid, out2[0]["task_id"]])
c.execute("DELETE FROM word_card WHERE id IN (?,?)", [tmp_id, tmp2])
c.commit()
c.close()

# ---------- 3. assemble.submit_render params 静态断言 ----------
src = open(os.path.join(r"C:\Users\admin\prompt-tool-dev\MikPromptKit\backend", "api", "assemble.py"), encoding="utf-8").read()
ok("submit_render 写入 params.source_image", 'params["source_image"]' in src or "params['source_image']" in src)
ok("_build_prompt 含 @图像1 声明", "参考@图像1" in src)

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
