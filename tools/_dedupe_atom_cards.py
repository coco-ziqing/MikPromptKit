import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from database import get_db

db = get_db()

# 找所有重复（同 group + 同 content），保留 MIN(id)
rows = db.execute("""
    SELECT wc.id, wc.group_id, wc.content
    FROM word_card wc JOIN word_card_group g ON wc.group_id=g.id
    WHERE g.group_type='atom' AND wc.is_deleted=0
    ORDER BY wc.group_id, wc.content, wc.id
""").fetchall()

# 分组去重
seen = {}
to_mark = []
for r in rows:
    key = (r['group_id'], r['content'])
    if key in seen:
        to_mark.append(r['id'])
    else:
        seen[key] = r['id']

print(f"Keep: {len(seen)} unique cards")
print(f"Mark deleted: {len(to_mark)} duplicates")

for cid in to_mark:
    db.execute("UPDATE word_card SET is_deleted=1 WHERE id=?", [cid])

# 清理 orphan bridge rows
db.execute("""
    DELETE FROM atom_word_bridge WHERE word_card_id IN (
        SELECT b.word_card_id FROM atom_word_bridge b
        LEFT JOIN word_card wc ON b.word_card_id=wc.id
        WHERE wc.id IS NULL OR wc.is_deleted=1
    )
""")
db.commit()
print(f"Cleaned bridges. Done.")
