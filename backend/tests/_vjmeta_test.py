"""v5.50.62 简介生成：以词卡「图片生成提示词」为依据

验证：
  1) 简介不再搬运视频提示词原文
  2) 简介确实分析识别了图片生成提示词（含其片段）
  3) 长度/关键词/标题合规
  4) _llm_context 把图片生成提示词喂给原有 AI 优化链路

用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjmeta_test.py
"""
import sys, io, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from api import vjshi_upload as v

db = v._db()
try:
    row = db.execute(
        "SELECT t.id AS gid, t.card_id AS cid, t.prompt AS vprompt, w.content AS iprompt, w.name AS cname "
        "FROM card_gen_tasks t JOIN word_card w ON w.id = t.card_id "
        "WHERE t.prompt IS NOT NULL AND t.prompt <> '' AND w.content IS NOT NULL AND w.content <> '' "
        "ORDER BY t.id DESC LIMIT 1"
    ).fetchone()
finally:
    db.close()

if not row:
    print("SKIP: 没有同时带视频提示词与图片提示词的样本")
    sys.exit(2)

gid, cid = row["gid"], row["cid"]
vprompt, iprompt = row["vprompt"] or "", row["iprompt"] or ""
print(f"样本：生成任务 {gid} · 词卡 {cid} · {row['cname']}")
print(f"\n图片生成提示词({len(iprompt)}字): {iprompt[:120]}...")
print(f"\n视频提示词({len(vprompt)}字): {vprompt[:120]}...")

meta = v._build_meta(cid, gid, "")
desc = meta.get("description") or ""
print("\n--- 生成的简介 ---")
print(desc)
print("--- /简介 ---")
print("title:", meta.get("title"))
print("keywords:", meta.get("keywords"))

_t, _ctx = v._llm_context(cid, gid, meta.get("title") or "")
print("\n--- 喂给 AI 优化的上下文(前 200 字) ---")
print(_ctx[:200])
print("--- /上下文 ---")

fails = []
# 1. 不搬运视频提示词原文
for n in (30, 20, 12):
    if len(vprompt) >= n and vprompt[:n] in desc:
        fails.append(f"简介仍包含视频提示词前 {n} 字")
# 2. 确实分析识别了图片生成提示词
segs = v._analyze_prompt(iprompt)
allsegs = segs["content"] + segs["style"] + segs["motion"]
hit = [s for s in allsegs if len(s) >= 3 and s[:6] in desc]
print(f"\n图片提示词片段命中简介: {len(hit)} 个 -> {hit[:5]}")
if not hit:
    fails.append("简介没有体现任何图片生成提示词片段（未做分析识别）")
# 3. 长度 / 关键词 / 标题
if not desc.strip():
    fails.append("简介为空")
if len(desc) > 300:
    fails.append(f"简介超 300 字（{len(desc)}）")
if len(desc) < 40:
    fails.append(f"简介过短（{len(desc)}）")
if len((meta.get("keywords") or "").split()) < 5:
    fails.append("关键词少于 5 个")
if not (4 <= len(meta.get("title") or "") <= 30):
    fails.append("标题长度不在 4-30 字")
# 4. AI 优化上下文包含图提示词
if "图片生成提示词" not in _ctx:
    fails.append("_llm_context 未包含图片生成提示词")

print()
if fails:
    for f in fails:
        print("  FAIL ", f)
    print("\nRESULT: FAIL")
    sys.exit(1)
print("  PASS  不搬运视频提示词原文")
print(f"  PASS  已分析识别图提示词（命中 {len(hit)} 片段）")
print("  PASS  长度/关键词/标题合规")
print("  PASS  AI 优化上下文以图提示词为依据")
print("\nRESULT: PASS")
sys.exit(0)
