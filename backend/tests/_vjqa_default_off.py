"""把本机 vjshi_settings.precheck 置为 '0'（v5.50.61：投稿前质检默认关闭）

一次性脚本，用于让已存在的库回落到新默认值。
用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjqa_default_off.py
"""
import sys, io, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from api import vjshi_upload as v

v._ensure_settings_table()
before = v._get_setting("precheck", "<无记录>")
v._set_setting("precheck", "0")
after = v._get_setting("precheck", "<无记录>")
print(f"precheck: {before} -> {after}")
print("质检开关当前状态:", "开启" if v._precheck_enabled() else "关闭")
