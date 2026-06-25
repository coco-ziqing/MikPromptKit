"""一键检查所有表"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'backend'))
from database import get_db
db = get_db()
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
print(f"=== {len(tables)} tables ===")
for t in tables:
    cnt = db.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
    print(f"  {t}: {cnt} rows")
# atom tables
atoms = [t for t in tables if 'atom' in t.lower()]
print(f"\n=== atom tables ({len(atoms)}) ===")
for t in atoms:
    cols = [c[1] for c in db.execute(f"PRAGMA table_info([{t}])").fetchall()]
    print(f"  {t}: {cols}")
