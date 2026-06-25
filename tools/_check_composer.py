"""Quick check: compose output for a real seedance project"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from database import get_db

db = get_db()

# Find a project with scenes
proj = db.execute("SELECT id, name, total_duration FROM user_project ORDER BY id DESC LIMIT 1").fetchone()
if not proj:
    print("No project found. Create one in the seedance composer first.")
    exit()

print(f"Project: #{proj['id']} {proj['name']}")

scenes = db.execute("SELECT * FROM user_project_scene WHERE project_id=? ORDER BY scene_order", [proj['id']]).fetchall()
print(f"Scenes: {len(scenes)}")

# Dump first scene fields
if scenes:
    s = scenes[0]
    print(f"\nScene #{s['id']} fields (non-empty):")
    for k in s.keys():
        if k in ('id','project_id','scene_order','start_time','end_time','created_at','updated_at'): continue
        v = s[k]
        if v and str(v).strip():
            print(f"  {k:20s} = {str(v)[:80]}")

# Check atom word cards referencing
atom_bridge_count = db.execute("SELECT COUNT(*) FROM atom_word_bridge").fetchone()[0]
atom_card_count = db.execute("SELECT COUNT(*) FROM word_card WHERE source='atom_decompose' AND is_deleted=0").fetchone()[0]
print(f"\nAtom cards: {atom_card_count}, bridges: {atom_bridge_count}")
