"""v5.50.66 后端视频质检闸门 —— 必须与前端 precheck 开关一致

验证：同一个不合格视频
  precheck=1 → block=True（拦截，任务 fail/video_invalid）
  precheck=0 → block=False（放行，按用户选择继续上传）

用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjqc_gate_test.py
"""
import sys, io, os, glob

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from api import vjshi_upload as v

fails = []
V = v.CARD_GEN_VIDEO_DIR   # 真实视频目录（data/card_gen/videos）


def ok(name, cond, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  " + str(extra)) if extra else ""))
    if not cond:
        fails.append(name)


files = sorted(glob.glob(os.path.join(V, "*.mp4")))[:60]
print(f"视频样本目录: {V}（{len(files)} 个 mp4 参与扫描）")

bad = good = None
for p in files:
    _, errs, m = v._video_quality_gate(p)
    if errs and bad is None:
        bad = (p, errs, m)
    if not errs and good is None:
        good = (p, errs, m)
    if bad and good:
        break

if not bad:
    print("SKIP: 没找到质检不合格的视频，无法验证「关闭后放行」")
    v._set_setting("precheck", "0")
    sys.exit(2)
else:
    p, errs, m = bad
    print(f"\n不合格样本: {os.path.basename(p)}  {m.get('width')}x{m.get('height')}")
    print(f"  质检问题: {errs[:120]}")

    print("\n[1] precheck=1（开启）→ 应拦截")
    v._set_setting("precheck", "1")
    b1, e1, _ = v._video_quality_gate(p)
    ok("block=True（拦截）", b1 is True, b1)
    ok("仍然报出问题原因", bool(e1))

    print("\n[2] precheck=0（关闭）→ 应放行")
    v._set_setting("precheck", "0")
    b2, e2, _ = v._video_quality_gate(p)
    ok("block=False（放行）", b2 is False, b2)
    ok("问题仍被报出（用于提示，不拦截）", bool(e2))

if good:
    p2, _, m2 = good
    print(f"\n[3] 合格样本 {os.path.basename(p2)}  {m2.get('width')}x{m2.get('height')} → 任何开关下都不拦")
    v._set_setting("precheck", "1")
    b3, e3, _ = v._video_quality_gate(p2)
    ok("开启时也不拦截合格视频", b3 is False and not e3)

# 收尾：恢复为默认关闭
v._set_setting("precheck", "0")
print("\n收尾 precheck =", v._get_setting("precheck", "?"), "→", "开" if v._precheck_enabled() else "关")

print()
if fails:
    print("RESULT: FAIL ->", fails)
    sys.exit(1)
print("RESULT: PASS")
sys.exit(0)
