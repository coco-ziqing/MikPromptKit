# -*- coding: utf-8 -*-
"""
SQLite VIEW 适配方案：零代码改动统一两张表
===========================================
1. word_card_group 添加 seedance_subtype 列（保留原有 basic/extended/audio/global/custom 分类）
2. RENAME 旧表 prompt_word_card / prompt_library → _old_*
3. CREATE VIEW prompt_word_card → word_card (列别名映射)
4. CREATE VIEW prompt_library → word_card_group (列别名+seedance过滤)
5. INSTEAD OF 触发器处理 INSERT/UPDATE/DELETE
"""
import sqlite3, os, shutil

DB = r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data\prompts.db'
BAK = DB + '.before_view_migration'

# 备份
shutil.copy2(DB, BAK)
print("备份:", BAK)

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

# ============================================================
# Step 1: 迁移 prompt_library.category → word_card_group.seedance_subtype
# ============================================================
# 检查列是否已存在
cols = [c['name'] for c in db.execute("PRAGMA table_info(word_card_group)")]
if 'seedance_subtype' not in cols:
    db.execute("ALTER TABLE word_card_group ADD COLUMN seedance_subtype TEXT DEFAULT ''")
    print("Added word_card_group.seedance_subtype column")

# 从 prompt_library 复制 category 到 word_card_group.seedance_subtype
updated = 0
for lib in db.execute("SELECT * FROM prompt_library").fetchall():
    # 通过 dimension_key 匹配
    r = db.execute(
        "UPDATE word_card_group SET seedance_subtype=? WHERE group_key=? AND group_type='seedance'",
        [lib['category'] or '', lib['dimension_key']]
    ).rowcount
    updated += r
print("Populated seedance_subtype for %d groups" % updated)

db.commit()

# ============================================================
# Step 2: RENAME 旧表，避免冲突
# ============================================================
try:
    db.execute("ALTER TABLE prompt_word_card RENAME TO _old_prompt_word_card")
    print("Renamed: prompt_word_card → _old_prompt_word_card")
except sqlite3.OperationalError as e:
    print("Skip rename prompt_word_card:", e)

try:
    db.execute("ALTER TABLE prompt_library RENAME TO _old_prompt_library")
    print("Renamed: prompt_library → _old_prompt_library")
except sqlite3.OperationalError as e:
    print("Skip rename prompt_library:", e)

db.commit()

# ============================================================
# Step 3: CREATE VIEW prompt_word_card
# ============================================================
db.execute("DROP VIEW IF EXISTS prompt_word_card")
db.execute("""
    CREATE VIEW prompt_word_card AS
    SELECT 
        wc.id,
        wc.group_id AS library_id,
        wc.content AS word_text,
        wc.meaning AS definition,
        wc.thumbnail AS preview_image,
        wc.preview_media AS preview_video,
        wc.heat_weight,
        wc.is_builtin AS is_system,
        COALESCE(wc.usage_count, 0) AS usage_count,
        wc.created_at
    FROM word_card wc
    JOIN word_card_group wg ON wg.id = wc.group_id
    WHERE wg.group_type = 'seedance' AND wc.is_deleted = 0
""")
print("Created VIEW: prompt_word_card")

# ============================================================
# Step 4: CREATE VIEW prompt_library
# ============================================================
db.execute("DROP VIEW IF EXISTS prompt_library")
db.execute("""
    CREATE VIEW prompt_library AS
    SELECT 
        id,
        group_key AS dimension_key,
        name AS dimension_name,
        COALESCE(NULLIF(seedance_subtype, ''), 'basic') AS category,
        sort_order,
        description,
        updated_at
    FROM word_card_group
    WHERE group_type = 'seedance' AND is_active = 1
""")
print("Created VIEW: prompt_library")

# ============================================================
# Step 5: INSTEAD OF triggers for prompt_word_card
# ============================================================

# INSERT
db.execute("DROP TRIGGER IF EXISTS trg_pwc_insert")
db.execute("""
    CREATE TRIGGER trg_pwc_insert INSTEAD OF INSERT ON prompt_word_card
    BEGIN
        INSERT INTO word_card (
            group_id, content, meaning, thumbnail, preview_media,
            heat_weight, is_builtin, usage_count,
            module, category, sort_order
        ) VALUES (
            NEW.library_id,
            NEW.word_text,
            NEW.definition,
            NEW.preview_image,
            NEW.preview_video,
            COALESCE(NEW.heat_weight, 0.5),
            COALESCE(NEW.is_system, 0),
            COALESCE(NEW.usage_count, 0),
            'seedance_v2',
            'seedance_v2',
            0
        );
    END
""")

# UPDATE
db.execute("DROP TRIGGER IF EXISTS trg_pwc_update")
db.execute("""
    CREATE TRIGGER trg_pwc_update INSTEAD OF UPDATE ON prompt_word_card
    BEGIN
        UPDATE word_card SET
            group_id = NEW.library_id,
            content = NEW.word_text,
            meaning = NEW.definition,
            thumbnail = NEW.preview_image,
            preview_media = NEW.preview_video,
            heat_weight = NEW.heat_weight,
            is_builtin = NEW.is_system,
            usage_count = NEW.usage_count,
            updated_at = datetime('now','localtime')
        WHERE id = OLD.id;
    END
""")

# DELETE
db.execute("DROP TRIGGER IF EXISTS trg_pwc_delete")
db.execute("""
    CREATE TRIGGER trg_pwc_delete INSTEAD OF DELETE ON prompt_word_card
    BEGIN
        UPDATE word_card SET is_deleted = 1, deleted_at = datetime('now','localtime') WHERE id = OLD.id;
    END
""")

print("Created triggers for prompt_word_card")

# ============================================================
# Step 6: INSTEAD OF triggers for prompt_library
# ============================================================

db.execute("DROP TRIGGER IF EXISTS trg_pl_insert")
db.execute("""
    CREATE TRIGGER trg_pl_insert INSTEAD OF INSERT ON prompt_library
    BEGIN
        INSERT INTO word_card_group (
            group_key, name, group_type, seedance_subtype, sort_order, description
        ) VALUES (
            NEW.dimension_key,
            NEW.dimension_name,
            'seedance',
            COALESCE(NEW.category, 'custom'),
            COALESCE(NEW.sort_order, 
                (SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card_group WHERE group_type='seedance')
            ),
            NEW.description
        );
    END
""")

db.execute("DROP TRIGGER IF EXISTS trg_pl_update")
db.execute("""
    CREATE TRIGGER trg_pl_update INSTEAD OF UPDATE ON prompt_library
    BEGIN
        UPDATE word_card_group SET
            group_key = NEW.dimension_key,
            name = NEW.dimension_name,
            seedance_subtype = COALESCE(NEW.category, seedance_subtype),
            sort_order = NEW.sort_order,
            description = NEW.description,
            updated_at = datetime('now','localtime')
        WHERE id = OLD.id AND group_type = 'seedance';
    END
""")

db.execute("DROP TRIGGER IF EXISTS trg_pl_delete")
db.execute("""
    CREATE TRIGGER trg_pl_delete INSTEAD OF DELETE ON prompt_library
    BEGIN
        -- 级联软删除关联词卡
        UPDATE word_card SET is_deleted = 1, deleted_at = datetime('now','localtime') WHERE group_id = OLD.id;
        -- 标记分组为不活跃
        UPDATE word_card_group SET is_active = 0, updated_at = datetime('now','localtime') WHERE id = OLD.id;
    END
""")

print("Created triggers for prompt_library")

# ============================================================
# Step 7: 验证
# ============================================================

# 7a. prompt_library VIEW
print("\n=== 验证 prompt_library VIEW ===")
rows = db.execute("SELECT * FROM prompt_library ORDER BY sort_order").fetchall()
print("  Total: %d libraries" % len(rows))
for r in rows[:5]:
    print("  [%s] %-25s key=%-20s cat=%s" % (r['id'], r['dimension_name'], r['dimension_key'], r['category']))

# 7b. prompt_word_card VIEW
print("\n=== 验证 prompt_word_card VIEW ===")
cnt = db.execute("SELECT COUNT(*) as c FROM prompt_word_card").fetchone()['c']
print("  Total: %d cards" % cnt)
# 随机 3 条
samples = db.execute("SELECT * FROM prompt_word_card ORDER BY RANDOM() LIMIT 3").fetchall()
for r in samples:
    print("  [%s] lib=%s word=%s prev=%s" % (r['id'], r['library_id'], str(r['word_text'])[:30], r.get('preview_image', '') or ''))

# 7c. 测试 INSERT → SELECT → DELETE 完整链路
print("\n=== 测试 INSERT/UPDATE/DELETE 链路 ===")

# 找到第一个 seedance 分组
first_lib = db.execute("SELECT id, dimension_key FROM prompt_library ORDER BY sort_order LIMIT 1").fetchone()
if first_lib:
    lib_id = first_lib['id']
    print("  Test lib: id=%s key=%s" % (lib_id, first_lib['dimension_key']))

    # INSERT
    db.execute("INSERT INTO prompt_word_card (library_id, word_text, definition, is_system, heat_weight) VALUES (?, 'TEST_VIEW_CARD', '测试词条', 0, 1.0)", [lib_id])
    db.commit()
    new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    print("  INSERT OK, id=%s" % new_id)

    # Verify in word_card table directly
    wc = db.execute("SELECT * FROM word_card WHERE id=?", [new_id]).fetchone()
    if wc:
        print("  word_card: content=%s meaning=%s group_id=%s" % (wc['content'], wc['meaning'], wc['group_id']))

    # Verify in VIEW
    vc = db.execute("SELECT * FROM prompt_word_card WHERE id=?", [new_id]).fetchone()
    if vc:
        print("  VIEW: word_text=%s definition=%s library_id=%s" % (vc['word_text'], vc['definition'], vc['library_id']))

    # UPDATE
    db.execute("UPDATE prompt_word_card SET word_text='UPDATED_TEST', definition='已更新' WHERE id=?", [new_id])
    db.commit()
    vc2 = db.execute("SELECT * FROM prompt_word_card WHERE id=?", [new_id]).fetchone()
    print("  UPDATE: word_text=%s definition=%s" % (vc2['word_text'], vc2['definition']))

    # DELETE
    db.execute("DELETE FROM prompt_word_card WHERE id=?", [new_id])
    db.commit()
    vc3 = db.execute("SELECT * FROM prompt_word_card WHERE id=?", [new_id]).fetchone()
    print("  DELETE: found=%s (should be None)" % (vc3 is not None))

print("\n✅ VIEW 迁移完成！seedance_v2.py 无需任何修改。")

db.close()
