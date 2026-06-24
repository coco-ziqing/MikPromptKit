# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from database import get_db

db = get_db()

# 1. Create 2 atom roots (idempotent)
for key, name, icon, sort in [
    ("root_atom_image", "[原子] 图像词库", "🖼️", 9000),
    ("root_atom_video", "[原子] 视频词库", "🎬", 9001),
]:
    existing = db.execute("SELECT id FROM word_card_group WHERE group_key=?", [key]).fetchone()
    if existing:
        print(f"[EXIST] #{existing[0]} {name}")
    else:
        db.execute(
            "INSERT INTO word_card_group (name,group_key,icon,group_type,sort_order,is_active) VALUES (?,?,?,?,?,1)",
            [name, key, icon, 'root', sort]
        )
        cid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        print(f"[CREATED] #{cid} {name}")

db.commit()

# 2. Move existing atom groups under image root
root_img = db.execute("SELECT id FROM word_card_group WHERE group_key='root_atom_image'").fetchone()
if root_img:
    moved = 0
    for g in db.execute("SELECT id,name FROM word_card_group WHERE group_type='atom' AND parent_group_id IS NULL AND is_active=1").fetchall():
        db.execute("UPDATE word_card_group SET parent_group_id=? WHERE id=?", [root_img[0], g[0]])
        moved += 1
    db.commit()
    print(f"[MOVED] {moved} atom groups -> parent #{root_img[0]}")

print("[DONE]")
