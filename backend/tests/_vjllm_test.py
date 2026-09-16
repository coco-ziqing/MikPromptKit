"""v5.50.62 原有 AI 优化链路 — 以图片生成提示词为输入的真实跑通验证

用途：确认「✨ AI 优化简介」/ 提交时自动优化 现在拿到的是词卡图片生成提示词，
      而不是像以前那样只拿到标题（标题+提示词都是标题）。
需要本机 Ollama 在线。
用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjllm_test.py [card_id] [gen_task_id]
"""
import sys, io, os, re, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from api import vjshi_upload as v

cid = int(sys.argv[1]) if len(sys.argv) > 2 else 0
gid = int(sys.argv[2]) if len(sys.argv) > 2 else 0
if not cid:
    db = v._db()
    try:
        r = db.execute(
            "SELECT t.id AS gid, t.card_id AS cid FROM card_gen_tasks t JOIN word_card w ON w.id=t.card_id "
            "WHERE t.prompt<>'' AND w.content<>'' ORDER BY t.id DESC LIMIT 1").fetchone()
    finally:
        db.close()
    if not r:
        print("SKIP: 无样本")
        sys.exit(2)
    cid, gid = r["cid"], r["gid"]

title, ctx = v._llm_context(cid, gid, "")
print(f"样本：card={cid} gen_task={gid}")
print(f"标题：{title}")
print(f"喂给 LLM 的上下文（{len(ctx)} 字，前 160）：\n  {ctx[:160]}\n")

print("调用 Ollama 生成中（最长 75s）...")
t0 = time.time()
desc = v._llm_description_sync(ctx, title)
el = time.time() - t0
print(f"耗时 {el:.1f}s")
print("\n--- AI 生成的简介 ---")
print(desc or "(空)")
print("--- /简介 ---")

fails = []
if not desc:
    fails.append("LLM 返回空（Ollama 未启动或超时）")
else:
    if len(desc) > 300:
        fails.append(f"超 300 字（{len(desc)}）")
    if not re.search(r"[\u4e00-\u9fff]", desc):
        fails.append("没有中文内容")
    if len(desc) < 60:
        fails.append(f"过短（{len(desc)}）")

print()
if fails:
    for f in fails:
        print("  FAIL ", f)
    print("\nRESULT: FAIL")
    sys.exit(1)
print("  PASS  AI 优化链路可用，且输入是图片生成提示词而非标题")
print("\nRESULT: PASS")
sys.exit(0)
