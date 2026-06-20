"""
Phase14 补充: 未分配自定义分组归位
"""
import sqlite3, os
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'prompts.db')

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# 在图像根下创建「🗂️ 自定义收纳」子类
conn.execute("INSERT INTO word_card_group (name,group_key,icon,description,group_type,parent_group_id,sort_order) VALUES (?,?,?,?,?,?,?)",
             ["🗂️ 自定义收纳", "sub_custom_misc", "🗂️", "未归类的自定义分组", "sub",
              conn.execute("SELECT id FROM word_card_group WHERE group_key='root_image'").fetchone()["id"], 99])
conn.commit()
sub_custom_id = conn.execute("SELECT id FROM word_card_group WHERE group_key='sub_custom_misc'").fetchone()["id"]
print(f"[子类] 自定义收纳 id={sub_custom_id}")

# 所有 group_type='custom' 且 parent_group_id IS NULL 的全放这里
remaining = conn.execute(
    "SELECT id,name,group_key FROM word_card_group WHERE group_type='custom' AND parent_group_id IS NULL AND is_active=1"
).fetchall()

for g in remaining:
    conn.execute("UPDATE word_card_group SET parent_group_id=? WHERE id=?", [sub_custom_id, g["id"]])
    print(f"  {g['group_key']} ({g['name']}) → 自定义收纳")
conn.commit()

# 验证
total = conn.execute("SELECT COUNT(*) FROM word_card_group WHERE is_active=1").fetchone()[0]
unassigned = conn.execute("SELECT COUNT(*) FROM word_card_group WHERE parent_group_id IS NULL AND group_type NOT IN ('root','sub') AND is_active=1").fetchone()[0]
print(f"\n[验证] 活跃分组: {total}, 未分配: {unassigned}")

# 列出树形结构
groups = conn.execute("""
    SELECT wg.id, wg.name, wg.group_key, wg.parent_group_id, wg.group_type,
           (SELECT COUNT(*) FROM word_card wc WHERE wc.group_id=wg.id AND wc.is_deleted=0) as card_count
    FROM word_card_group wg WHERE wg.is_active=1
    ORDER BY wg.group_type, wg.parent_group_id, wg.sort_order
""").fetchall()

print("\n=== 分类树 ===")
for g in groups:
    indent = ""
    if g["group_type"] == "sub": indent = "  "
    elif g["group_type"] in ("seedance","builtin","custom"): indent = "    "
    print(f"{indent}[{g['group_type']}] {g['group_key']:25s} cards={g['card_count']:3d} parent={g['parent_group_id']} \"{g['name']}\"")

conn.close()
