"""生成队列缩略图 404 回归测试（v5.50.69）

现象：生成队列里「生成图片记录」的缩略图裂图。
根因：图片产物落在 data/originals/，而 /api/thumbnails/file/<name> 只查 data/thumbnails/
      与 data/wc_media/thumbs/ → 404。
本脚本直接调用真实路由函数（不经 HTTP，无需登录），覆盖三类文件名：
  ① 产物在 data/originals/（原本 404，修后应返回图片）
  ② 产物在 data/thumbnails/（本来就通，回归）
  ③ 产物在 data/wc_media/thumbs/（本来就通，回归）
用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_thumb_file_fallback_test.py
"""
import io, os, sqlite3, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(BASE)
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from fastapi import HTTPException
from api import thumbnails as th


def probe(name):
    """返回 (状态, 说明)"""
    try:
        resp = th.serve_thumbnail(name, None)
        p = getattr(resp, "path", "") or ""
        return "200", os.path.relpath(p, ROOT) if p else "FileResponse"
    except HTTPException as e:
        return str(e.status_code), e.detail
    except Exception as e:
        return "ERR", f"{type(e).__name__}: {e}"


db = sqlite3.connect(os.path.join(ROOT, "data", "prompts.db"))
db.row_factory = sqlite3.Row

print("=== 从真实任务里挑样本 ===")
samples = {}
for r in db.execute(
    "SELECT task_type, media_type, result_filename FROM card_gen_tasks "
    "WHERE status IN ('success','done') AND media_type='image' AND result_filename<>'' ORDER BY id DESC"
):
    fn = os.path.basename(r["result_filename"])
    in_orig = os.path.exists(os.path.join(ROOT, "data", "originals", fn))
    in_thumb = os.path.exists(os.path.join(ROOT, "data", "thumbnails", fn))
    in_wc = os.path.exists(os.path.join(ROOT, "data", "wc_media", "thumbs", fn))
    kind = "①originals" if in_orig else ("②thumbnails" if in_thumb else ("③wc_thumbs" if in_wc else "④哪里都没有"))
    if kind not in samples:
        samples[kind] = fn
        print(f"  {kind:<14} {fn}  ({r['task_type']})")

if not samples:
    print("SKIP: 库里没有图片任务产物，无法验证")
    sys.exit(2)

print("\n=== 逐个调用 serve_thumbnail ===")
fails = []
for kind, fn in sorted(samples.items()):
    code, info = probe(fn)
    expect_ok = not kind.startswith("④")
    good = (code == "200") if expect_ok else True
    print(f"  [{'PASS' if good else 'FAIL'}] {kind:<14} {fn[:34]:<36} → {code} {info}")
    if not good:
        fails.append(f"{kind}:{fn}")

# 额外：不存在的文件名必须仍然是 404（不能改成一律放行）
code2, info2 = probe("__definitely_not_exist__.jpg")
print(f"\n  [{'PASS' if code2 == '404' else 'FAIL'}] 不存在的文件仍应 404 → {code2} {info2}")
if code2 != "404":
    fails.append("不存在的文件未返回 404")

print()
if fails:
    print("RESULT: FAIL ->", fails)
    sys.exit(1)
print("RESULT: PASS")
sys.exit(0)
