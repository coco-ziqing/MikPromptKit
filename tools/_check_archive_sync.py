import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from database import get_db

db = get_db()

# 原子分组词卡数
rows = db.execute("""
    SELECT g.id, g.name, COUNT(wc.id) as cnt
    FROM word_card_group g
    LEFT JOIN word_card wc ON wc.group_id=g.id AND wc.is_deleted=0
    WHERE g.group_type='atom' AND g.is_active=1
    GROUP BY g.id ORDER BY cnt DESC
""").fetchall()

print("=== 原子分组词卡数 ===")
for r in rows:
    print(f"  #{r['id']} {r['name']}: {r['cnt']} cards")

# 最新归档的词卡
print("\n=== 最近 5 条原子词卡 ===")
for r in db.execute("""
    SELECT wc.id, wc.name, wc.content, g.name as gname, wc.created_at
    FROM word_card wc JOIN word_card_group g ON wc.group_id=g.id
    WHERE g.group_type='atom' AND wc.is_deleted=0
    ORDER BY wc.id DESC LIMIT 5
""").fetchall():
    print(f"  #{r['id']} [{r['gname']}] {r['name'][:40]} | {r['content'][:50]}")

# 全部词组 tree 根节点统计
print("\n=== tree API 根节点统计 ===")
for r in db.execute("""
    SELECT id, name, group_key FROM word_card_group
    WHERE group_type='root' AND is_active=1 ORDER BY sort_order LIMIT 10
""").fetchall():
    child_cnt = sum(r2[0] for r2 in db.execute("""
        SELECT COUNT(wc.id) FROM word_card wc
        WHERE wc.group_id IN (
            WITH RECURSIVE cte AS (
                SELECT id FROM word_card_group WHERE parent_group_id=?
                UNION ALL
                SELECT g.id FROM word_card_group g JOIN cte ON g.parent_group_id=cte.id
            ) SELECT id FROM cte
        ) AND wc.is_deleted=0""", [r['id']]).fetchall())
    print(f"  #{r['id']} {r['name']}: {child_cnt} cards (recursive)")
