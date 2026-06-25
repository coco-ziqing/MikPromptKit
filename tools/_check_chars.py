import sqlite3, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
db = sqlite3.connect(r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data\prompts.db')
db.row_factory = sqlite3.Row

print("=== Character-related groups ===")
rows = db.execute("""
    SELECT id, name, group_key, group_type, icon, parent_group_id
    FROM word_card_group 
    WHERE (name LIKE '%人物%' OR name LIKE '%角色%' OR name LIKE '%服饰%' 
           OR name LIKE '%表情%' OR name LIKE '%神态%' OR name LIKE '%情绪%'
           OR group_key IN ('root_image', 'root_video', 'root_atom_image', 'root_atom_video'))
    AND is_active=1
    ORDER BY parent_group_id, sort_order
""").fetchall()
for r in rows:
    n = r['name'].replace('[原子] ', '')
    print(f"  #{r['id']:3d} [{r['group_type']:8s}] {n:30s}  parent={r['parent_group_id']}")

# count cards
print("\n=== Card counts ===")
for r in rows:
    cnt = db.execute("SELECT COUNT(*) FROM word_card WHERE group_id=? AND is_deleted=0", [r['id']]).fetchone()[0]
    if cnt > 0:
        print(f"  {r['name']}: {cnt} cards")

# character_profiles
print("\n=== character_profiles ===")
try:
    chars = db.execute("SELECT id, name FROM character_profiles LIMIT 10").fetchall()
    for c in chars:
        print(f"  #{c['id']} {c['name']}")
    total = db.execute("SELECT COUNT(*) FROM character_profiles").fetchone()[0]
    print(f"  Total: {total}")
except Exception as e:
    print(f"  Error: {e}")

# existing character_viewer or character_editor scripts
print("\n=== seedance tabs in index.html ===")
# Check composer structure for reference
print("Composer has: templates, composer, gallery, glossary tabs")

# atom groups summary
atoms = db.execute("SELECT COUNT(*) FROM word_card_group WHERE group_type='atom' AND is_active=1").fetchone()[0]
print(f"\nAtom groups total: {atoms}")
