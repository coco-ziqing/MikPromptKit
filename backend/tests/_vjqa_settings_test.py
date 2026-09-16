"""v5.50.59 投稿前质检开关 — 路由层验证（不走 HTTP，无需登录凭据）

做法：直接调用真实路由函数，仅把 get_current_user 打成已登录的 admin，
      从而覆盖 _auth + _team_guard + 读写落库 全链路。
用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjqa_settings_test.py
"""
import sys, io, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from api import vjshi_upload as v


class FakeReq:
    """最小 Request 替身（路由函数只把它透传给 _auth）"""
    pass


v.get_current_user = lambda request: {
    "authenticated": True, "id": 1, "username": "admin", "role": "admin"
}

req = FakeReq()
v._ensure_settings_table()

# 0) 默认值：无记录时应为「关闭」（v5.50.61 起）
_c = v._db()
try:
    _c.execute("DELETE FROM vjshi_settings WHERE key='precheck'")
    _c.commit()
finally:
    _c.close()
print("0) 无记录时默认值  :", v._precheck_enabled(), "（期望 False）")

print("1) 初始值          :", v.vjshi_settings_get(req))
print("2) PUT precheck=关 :", v.vjshi_settings_put(req, {"precheck": False}))
print("3) 读回            :", v.vjshi_settings_get(req))
print("4) PUT precheck=开 :", v.vjshi_settings_put(req, {"precheck": True}))
print("5) 读回            :", v.vjshi_settings_get(req))
print("6) 只传 headless   :", v.vjshi_settings_put(req, {"headless": False}))
print("7) precheck 未受影响:", v._precheck_enabled())

# 断言
ok = True
# 先清掉记录，验证无记录时的默认值（应为关闭）
_c = v._db()
try:
    _c.execute("DELETE FROM vjshi_settings WHERE key='precheck'")
    _c.commit()
finally:
    _c.close()
if v._precheck_enabled() is not False:
    ok = False
    print("!! 无记录时 _precheck_enabled 应为默认 False")
v.vjshi_settings_put(req, {"precheck": False})
if v._precheck_enabled() is not False:
    ok = False
    print("!! 关闭后 _precheck_enabled 应为 False")
if v.vjshi_settings_get(req).get("precheck") is not False:
    ok = False
    print("!! GET 未返回 precheck=false")
v.vjshi_settings_put(req, {"precheck": True})
if v._precheck_enabled() is not True:
    ok = False
    print("!! 开启后 _precheck_enabled 应为 True")
if v.vjshi_settings_get(req).get("precheck") is not True:
    ok = False
    print("!! GET 未返回 precheck=true")

print("\nRESULT:", "PASS" if ok else "FAIL")
# 收尾：把开关恢复成新默认值「关闭」，避免测试把本机状态改成开启
v._set_setting("precheck", "0")
print("收尾 precheck =", v._get_setting("precheck", "?"), "→ 质检开关:", "开" if v._precheck_enabled() else "关")
sys.exit(0 if ok else 1)
