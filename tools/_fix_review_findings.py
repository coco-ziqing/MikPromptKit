# -*- coding: utf-8 -*-
"""一次性修复审查发现的3个全局问题"""
from pathlib import Path
import re

BASE = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\backend")

# ========== 1. database.py：import logger + print→log + safe_fetch_one ==========
dbp = BASE / "database.py"
db = dbp.read_text(encoding="utf-8")

# 1a) 第6行末尾加 logger import
db = db.replace(
    "from paths import get_data_dir, get_db_path",
    "from paths import get_data_dir, get_db_path\nfrom logger import info as log_info, warn as log_warn, error as log_error"
)

# 1b) 全部 print("[数据库]" → log_error
def repl_print(m):
    msg = m.group(2).strip().rstrip(")")
    return f'log_error(f"[DB] {msg}", source="database")'
db = re.sub(r'(print\("[数据库]")([^)]+)\)', repl_print, db)

# 1c) 在 safe_commit() 后插入 safe_fetch_one/safe_count/safe_count_dict
helper_block = """
def safe_fetch_one(sql, params=None):
    \"\"\"安全取首条记录：表空返回 None，避免 fetchone()[0] / ['key'] 崩溃\"\"\"
    cur = safe_execute(sql, params)
    if cur is None:
        return None
    row = cur.fetchone()
    return row if row else None

def safe_count(sql, params=None, default=0):
    \"\"\"安全取计数：兜底返回 default，避免 NoneType 崩溃\"\"\"
    cur = safe_execute(sql, params)
    if cur is None:
        return default
    row = cur.fetchone()
    return row[0] if row else default

def safe_count_dict(sql, params=None, key="cnt", default=0):
    \"\"\"安全取字典计数：兜底返回 default\"\"\"
    cur = safe_execute(sql, params)
    if cur is None:
        return default
    row = cur.fetchone()
    return row[key] if row else default

"""
db = db.replace("def init_db():", helper_block + "\ndef init_db():")

dbp.write_text(db, encoding="utf-8")
print("[OK] database.py: import+print→logger+safe_fetch_one/safe_count")

# ========== 2. app_core.js：resp.json() 加固 ==========
jsp = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\static\js\app_core.js")
js = jsp.read_text(encoding="utf-8")

# 替换 await resp.json() → 加 ok 判
js = js.replace(
    "return await resp.json();",
    "if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);\n      return await resp.json();"
)
js = js.replace(
    "return await res.json();",
    "if (!res.ok) throw new Error(`HTTP ${res.status}`);\n      return await res.json();"
)
jsp.write_text(js, encoding="utf-8")
print("[OK] app_core.js: resp.json() 加 ok 判")

# ========== 3. 编译验证 ==========
import subprocess, sys
for p in [dbp]:
    r = subprocess.run([sys.executable, "-m", "py_compile", str(p)], capture_output=True, text=True)
    if r.returncode:
        print(f"[FAIL] compile {p.name}: {r.stderr[:200]}")
    else:
        print(f"[OK] compile {p.name}")
print("ALL_DONE")
