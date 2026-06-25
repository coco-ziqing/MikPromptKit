"""一次性修复 database.py + word_cards.py 剩余审查问题"""
from pathlib import Path
import re, subprocess, sys

BASE = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev")

# ===== database.py: logger import + print→log + safe_helpers =====
dbp = BASE / "backend" / "database.py"
db = dbp.read_text(encoding="utf-8")

# import logger
db = db.replace(
    "from paths import get_data_dir, get_db_path",
    "from paths import get_data_dir, get_db_path\nfrom logger import info as log_info, warn as log_warn, error as log_error"
)

# print("[数据库] ..." ) → log_error(...)
lines = db.split("\n")
new = []
for ln in lines:
    stripped = ln.strip()
    if stripped.startswith('print("[数据库]'):
        indent = ln[:len(ln)-len(ln.lstrip())]
        # extract: print("[数据库] xxx:", e) → f"[DB] xxx: {e}"
        # pattern: print("[数据库] 连接失败:", e)
        m = re.match(r'print\("\[数据库\]\s*([^"]+)"', stripped)
        if m:
            rest = m.group(1).strip().rstrip(":").rstrip(",")
            new.append(f'{indent}log_error(f"[DB] {rest}: {{e}}", source="database")')
        else:
            new.append(ln)
    else:
        new.append(ln)
db = "\n".join(new)

# safe_count_dict helper (already in file? check if git checkout removed it)
if "def safe_count_dict" not in db:
    helper = """
def safe_fetch_one(sql, params=None):
    \"\"\"安全取首条记录：表空返回 None，避免 fetchone()[0] / ['key'] 崩溃\"\"\"
    cur = safe_execute(sql, params)
    if cur is None:
        return None
    row = cur.fetchone()
    return row if row else None

def safe_count(sql, params=None, default=0):
    \"\"\"安全取计数：兜底返回 default\"\"\"
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
    db = db.replace("def init_db():", helper + "\ndef init_db():")

dbp.write_text(db, encoding="utf-8")
print("[OK] database.py: logger import + print→log + safe_helpers")

# ===== word_cards.py: replace risky fetchones =====
wcp = BASE / "backend" / "api" / "word_cards.py"
wc = wcp.read_text(encoding="utf-8")

# add import (idempotent check)
if "safe_count" not in wc[:200]:
    wc = wc.replace(
        "from database import get_db",
        "from database import get_db, safe_count, safe_count_dict, safe_fetch_one"
    )

# Replace the 8 risky patterns line by line — use exact unique anchors
# 1) line ~66: db.execute("SELECT id FROM ... WHERE group_key=?",[key]).fetchone()
wc = wc.replace(
    'if db.execute("SELECT id FROM word_card_group WHERE group_key=?", [key]).fetchone():',
    'if safe_fetch_one("SELECT id FROM word_card_group WHERE group_key=?", [key]):'
)

# 2) line ~71: db.execute(sort_sql, sort_params).fetchone()[0]
wc = re.sub(
    r'db\.execute\(sort_sql,\s*sort_params\)\.fetchone\(\)\[0\]',
    r'safe_count(sort_sql, sort_params)',
    wc
)

# 3) line ~75: db.execute("SELECT last_insert_rowid()").fetchone()[0]
wc = wc.replace(
    'db.execute("SELECT last_insert_rowid()").fetchone()[0]',
    'safe_count("SELECT last_insert_rowid()")'
)

# 4) line ~80: db.execute("SELECT id,group_type FROM word_card_group WHERE id=? AND is_active=1",[gid]).fetchone()
wc = wc.replace(
    'g = db.execute("SELECT id,group_type FROM word_card_group WHERE id=? AND is_active=1", [gid]).fetchone()',
    'g = safe_fetch_one("SELECT id,group_type FROM word_card_group WHERE id=? AND is_active=1", [gid])'
)

# 5) line ~95: if not db.execute("SELECT id FROM ... WHERE id=? AND group_type='custom'",[gid]).fetchone()
wc = wc.replace(
    'if not db.execute("SELECT id FROM word_card_group WHERE id=? AND group_type=\'custom\'", [gid]).fetchone():',
    'if not safe_fetch_one("SELECT id FROM word_card_group WHERE id=? AND group_type=\'custom\'", [gid]):'
)

# 6) line ~133: db.execute("SELECT content FROM word_card WHERE id=?",[card_id]).fetchone()
wc = wc.replace(
    'db.execute("SELECT content FROM word_card WHERE id=?", [card_id]).fetchone()',
    'safe_fetch_one("SELECT content FROM word_card WHERE id=?", [card_id])'
)

# 7) line ~158: db.execute("SELECT COUNT(*) as c FROM word_card WHERE is_deleted=0").fetchone()["c"]
wc = wc.replace(
    'db.execute("SELECT COUNT(*) as c FROM word_card WHERE is_deleted=0").fetchone()["c"]',
    'safe_count_dict("SELECT COUNT(*) as c FROM word_card WHERE is_deleted=0")'
)

# 8) line ~251: db.execute(f"SELECT COUNT(*) as c FROM word_card wc WHERE ...", params).fetchone()["c"]
wc = re.sub(
    r'db\.execute\(f"SELECT COUNT\(\*\) as c FROM word_card wc WHERE ([^"]+)"\s*,\s*params\)\.fetchone\(\)\["c"\]',
    r'safe_count_dict(f"SELECT COUNT(*) as c FROM word_card wc WHERE \1", params)',
    wc
)

wcp.write_text(wc, encoding="utf-8")
print("[OK] word_cards.py: 8 fetchone replaced")

# ===== compile verify =====
for fp_name in ["backend/database.py", "backend/api/word_cards.py", "backend/main.py"]:
    fp = BASE / fp_name
    r = subprocess.run([sys.executable, "-m", "py_compile", str(fp)], capture_output=True, text=True)
    status = "OK" if r.returncode == 0 else f"FAIL {r.stderr[:150]}"
    print(f"  compile {fp_name}: {status}")

print("ALL_DONE")
