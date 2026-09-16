"""v5.50.64 光厂登录态检测优化 — 缓存逻辑验证（不拉起浏览器）

用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjlogin_cache_test.py
"""
import sys, io, os, time

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


print("[1] 写缓存 + 落盘")
v._ensure_settings_table()
v._login_cache_put({"ok": True, "logged_in": True})
ok("缓存已写入", bool(v._LOGIN_CACHE.get("data")))
ok("落盘 login_state=1", v._get_setting("login_state", "") == "1")
ok("落盘 login_checked_at 有值", v._get_setting("login_checked_at", "").isdigit())

print("[2] 命中缓存 → 秒回，不拉浏览器")
t0 = time.time()
d = v.check_login(force=False)
el = time.time() - t0
ok("返回 cached=True", d.get("cached") is True, d)
ok("耗时 < 1s（未拉起浏览器）", el < 1.0, f"{el:.3f}s")
ok("状态为已登录", d.get("logged_in") is True)

print("[3] 上传任务进行中 → 返回上次结果并标 stale")
v._VJSHI_BUSY.set()
try:
    v._LOGIN_CACHE["ts"] = time.time() - 3600   # 把缓存做旧，绕过 TTL
    d2 = v.check_login(force=False)
    ok("busy 时仍返回结果而非报错", d2.get("ok") is True, d2)
    ok("标记 stale=True", d2.get("stale") is True)
    ok("age_sec 约 3600", abs((d2.get("age_sec") or 0) - 3600) < 5, d2.get("age_sec"))

    print("[4] 强制检测遇到 busy → 也回落上次结果")
    d3 = v.check_login(force=True)
    ok("force+busy 回落缓存", d3.get("stale") is True and d3.get("ok") is True)
finally:
    v._VJSHI_BUSY.clear()

print("[5] 重启后从盘里恢复")
v._LOGIN_CACHE["data"] = None
v._LOGIN_CACHE["ts"] = 0.0
d4 = v._login_cache()
ok("能从 vjshi_settings 恢复登录态", bool(d4.get("data")) and d4["data"].get("logged_in") is True)
ok("恢复来源标记 from_disk", d4["data"].get("from_disk") is True)

print()
# 收尾：清掉本次测试写入的登录态（避免测试环境里显示“已登录”误导）
try:
    _c = v._db()
    try:
        _c.execute("DELETE FROM vjshi_settings WHERE key IN ('login_state','login_checked_at')")
        _c.commit()
    finally:
        _c.close()
    v._LOGIN_CACHE["data"] = None
    v._LOGIN_CACHE["ts"] = 0.0
    print("收尾：已清除测试写入的登录态缓存")
except Exception as e:
    print("收尾失败:", e)

if fails:
    print("RESULT: FAIL ->", fails)
    sys.exit(1)
print("RESULT: PASS")
sys.exit(0)
