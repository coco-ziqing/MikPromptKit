# -*- coding: utf-8 -*-
"""光厂投稿 v5.41.0 手动测试数据准备（可重复运行，先清后插）

插入（全部标记 [测试] 前缀，便于清理）：
- card_gen_tasks × 4（done+video 候选）：2 合格（15.1s/5.1s）+ 2 不合格（4.1s）
- vjshi_upload_tasks：
  · 2 条 queued（测 ETA；⚠️ 勿点「恢复」否则会真实上传）
  · 1 条 fail(timeout)（测失败分类徽章）
  · 1 条 submitted 无审核（测「待审核」计数）
  · 1 条 submitted+online（测审核流程指示 + 台账一键加入）
- 均不会自动执行（直插 DB 无 worker 接管；resume 仅在服务重启时扫描）
"""
import sqlite3, os

DB = r'C:\Users\admin\prompt-tool-dev\MikPromptKit\data\prompts.db'
V = r'C:\Users\admin\prompt-tool-dev\MikPromptKit\data\card_gen\videos'

# 真实存在的视频（已探测：4.1s=不合格 / 5.1s、15.1s=合格）
GOOD1 = 'cg_23846a6650ed46ceb6dd1ff82a1c352d.mp4'   # 15.1s ✅
GOOD2 = 'cg_95411abd65904760901fa2ec79629abc.mp4'   # 5.1s  ✅
BAD1  = 'cg_1d89ea86cbfb4e17a90f8f700a10567d.mp4'   # 4.1s ❌
BAD2  = 'cg_66ab5ab48ff9419cacfe7d351acceadd.mp4'   # 4.1s ❌

for f in (GOOD1, GOOD2, BAD1, BAD2):
    assert os.path.isfile(os.path.join(V, f)), f"视频缺失: {f}"

c = sqlite3.connect(DB)
c.execute("PRAGMA busy_timeout=4000")

# 清理旧测试数据
c.execute("DELETE FROM vjshi_upload_tasks WHERE title LIKE '%[测试]%'")
c.execute("DELETE FROM card_gen_tasks WHERE prompt LIKE '%[测试]%'")
c.commit()

# 词卡 id（存在即用，不存在用 0）
row = c.execute("SELECT id, name FROM word_card WHERE is_deleted=0 LIMIT 1").fetchone()
card_id = row[0] if row else 0
card_name = row[1] if row else ''

def add_gen(video, dur):
    cur = c.execute(
        "INSERT INTO card_gen_tasks (card_id, task_type, prompt, status, media_type, result_filename, model_version, video_resolution, duration, created_at) "
        "VALUES (?, 'text2video', ?, 'done', 'video', ?, 'seedance-2.0-fast', '1080p', ?, datetime('now','localtime'))",
        [card_id, f'[测试] {os.path.splitext(video)[0]} 素材 蓝色背景 商务科技 光效粒子 数字科技感', video, dur])
    return cur.lastrowid

g1 = add_gen(GOOD1, 15)
g2 = add_gen(GOOD2, 5)
g3 = add_gen(BAD1, 4)
g4 = add_gen(BAD2, 4)
c.commit()
print(f"card_gen_tasks 候选: {g1},{g2},{g3},{g4} (card_id={card_id} {card_name})")

def add_task(video, status, review='', title='', fail_cat=''):
    cur = c.execute(
        "INSERT INTO vjshi_upload_tasks (card_id, gen_task_id, video_file, title, keywords, description, category, price, is_ai, status, fail_category, review_status, creator_id) "
        "VALUES (?,?,?,?,?,?,?,10,1,?,?,?,1)",
        [card_id, 0, video, title, '蓝色 背景 商务 科技 光效 粒子', 'AI生成视频素材测试数据', '创意',
         status, fail_cat, review])
    return cur.lastrowid

t1 = add_task(os.path.join(V, GOOD1), 'queued', title='[测试] 排队任务A（勿恢复）')
t2 = add_task(os.path.join(V, GOOD2), 'queued', title='[测试] 排队任务B（勿恢复）')
t3 = add_task(os.path.join(V, BAD1), 'fail', title='[测试] 超时失败任务', fail_cat='timeout')
t4 = add_task(os.path.join(V, GOOD1), 'submitted', title='[测试] 待审核任务')
t5 = add_task(os.path.join(V, GOOD2), 'submitted', title='[测试] 已上架任务', review='online')
c.commit()
print(f"vjshi_upload_tasks: queued={t1},{t2} fail={t3} submitted={t4} online={t5}")
print("DONE — 测试数据就绪。测完运行 _clean_vjshi_testdata.py 清理。")
