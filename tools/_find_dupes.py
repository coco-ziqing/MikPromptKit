import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from database import get_db

db = get_db()

# 重复词卡
rows = db.execute("""
    SELECT wc.content, COUNT(*) as cnt, wc.group_id, g.name
    FROM word_card wc JOIN word_card_group g ON wc.group_id=g.id
    WHERE g.group_type='atom' AND wc.is_deleted=0
    GROUP BY wc.content, wc.group_id HAVING cnt>1
    ORDER BY cnt DESC LIMIT 20
""").fetchall()

print("=== 原子分组重复词卡 ===")
for r in rows:
    print(f"  group=#{r['group_id']} {r['name']}  cnt={r['cnt']}  content={r['content'][:60]}")

total  = db.execute("SELECT COUNT(*) FROM word_card wc JOIN word_card_group g ON wc.group_id=g.id WHERE g.group_type='atom' AND wc.is_deleted=0").fetchone()[0]
uniq   = db.execute("SELECT COUNT(DISTINCT wc.content||'-'||wc.group_id) FROM word_card wc JOIN word_card_group g ON wc.group_id=g.id WHERE g.group_type='atom' AND wc.is_deleted=0").fetchone()[0]
dup    = total - uniq
print(f"\n总词卡: {total}, 独特(内容+分组): {uniq}, 重复条数: {dup}")

# 每分组统计
print("\n=== 各原子分组词卡数 ===")
for r in db.execute("SELECT g.id, g.name, COUNT(wc.id) as cnt FROM word_card_group g LEFT JOIN word_card wc ON wc.group_id=g.id AND wc.is_deleted=0 WHERE g.group_type='atom' AND g.is_active=1 GROUP BY g.id ORDER BY cnt DESC").fetchall():
    unique = db.execute("SELECT COUNT(DISTINCT wc.content) FROM word_card wc WHERE wc.group_id=? AND wc.is_deleted=0", [r['id']]).fetchone()[0]
    dup = r['cnt'] - unique
    print(f"  #{r['id']} {r['name']}: {r['cnt']} total, {unique} unique, {dup} duplicate")

# bridge 表统计
br_cnt = db.execute("SELECT COUNT(*) FROM atom_word_bridge").fetchone()[0]
print(f"\natom_word_bridge rows: {br_cnt}")
