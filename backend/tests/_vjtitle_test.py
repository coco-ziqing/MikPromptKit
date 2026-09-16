"""v5.50.67 素材名称优先级 —— 平台自动识别 > AI 推荐 > 本地兜底

用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjtitle_test.py
"""
import sys, io, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from api import vjshi_upload as v

fails = []


def ok(name, cond, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  " + str(extra)) if extra else ""))
    if not cond:
        fails.append(name)


P = v._pick_title

print("[1] 平台自动识别优先")
val, src = P("平台识别出的名称", "AI推荐的名称", "本地兜底名")
ok("取平台名称", val == "平台识别出的名称" and src == "平台自动识别", f"{src} / {val}")

print("[2] 平台没给 → 用 AI 推荐")
val, src = P("", "AI推荐的名称", "本地兜底名")
ok("取 AI 推荐", val == "AI推荐的名称" and src == "AI推荐标题", f"{src} / {val}")

print("[3] 平台与 AI 都没给 → 本地兜底")
val, src = P("", "   ", "本地兜底名")
ok("取本地兜底", val == "本地兜底名" and src == "本地兜底", f"{src} / {val}")

print("[4] 全空")
val, src = P("", "", "")
ok("返回空 + 无来源", val == "" and src == "无", f"{src} / {val}")

print("[5] 空白字符不算有效名称")
val, src = P("  ", "  ", "  ")
ok("全空白 → 无来源", val == "" and src == "无", f"{src} / {val}")

print("[6] 剥前后空格")
val, src = P("  名称A  ", "", "")
ok("已 strip", val == "名称A", repr(val))

print()
if fails:
    print("RESULT: FAIL ->", fails)
    sys.exit(1)
print("RESULT: PASS")
sys.exit(0)
