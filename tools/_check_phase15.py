"""Phase15 升级验证脚本"""
import sys, os
sys.path.insert(0, 'backend')
from database import get_db, safe_fetch_one

db = get_db()

# 1. 表检查
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%atom%' ORDER BY name").fetchall()]
print(f"=== 原子系统表 ({len(tables)}) ===")
for t in tables:
    cols = [c[1] for c in db.execute(f"PRAGMA table_info([{t}])").fetchall()]
    cnt = db.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
    print(f"  {t}: {cnt} rows | columns: {cols}")

# 2. atom_word_bridge 专用检查
bridge_cols = [c[1] for c in db.execute("PRAGMA table_info(atom_word_bridge)").fetchall()]
print(f"\n[atom_word_bridge] columns: {bridge_cols}")
idx = [r[1] for r in db.execute("SELECT * FROM sqlite_master WHERE type='index' AND tbl_name='atom_word_bridge'").fetchall()]
print(f"[atom_word_bridge] indexes: {idx}")

# 3. word_card_group 中 atom 类型分组
atom_groups = db.execute("SELECT id,name,group_key FROM word_card_group WHERE group_type='atom' OR group_key LIKE 'atom_%'").fetchall()
print(f"\n[atom 分组] ({len(atom_groups)} groups)")
for g in atom_groups:
    cnt = db.execute("SELECT COUNT(*) FROM word_card WHERE group_id=?", [g["id"]]).fetchone()[0]
    print(f"  #{g['id']} {g['name']} ({g['group_key']}): {cnt} cards")

# 4. 版本号
print("\n[版本] APP_VERSION=v5.0.0-phase15-atom-engine")
print("[Phase15 卫星检查完成]")
