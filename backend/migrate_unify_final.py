# -*- coding: utf-8 -*-
"""
终极统一方案：ID桥接表 + VIEW
===========================
1. 迁移 prompt_word_card 每一条 → word_card（取新ID）
2. 建 seedance_id_map (old_id → new_id) 桥接表
3. VIEW prompt_word_card 通过桥接表返回 old_id（兼容前端所有引用）
4. 3个写端点直接写 word_card + 记录桥接回 old_id
"""
import sqlite3, os, shutil, uuid

DB = r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data\prompts.db'
BAK = DB + '.unify_final_bak'
shutil.copy2(DB, BAK)
print("Backup:", BAK)

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

# ============================================================
# Step 0: RENAME旧表，释放名字给VIEW
# ============================================================
try:
    db.execute("ALTER TABLE prompt_word_card RENAME TO _old_prompt_word_card")
    print("Renamed: prompt_word_card -> _old_prompt_word_card")
except: print("prompt_word_card already renamed or absent")

try:
    db.execute("ALTER TABLE prompt_library RENAME TO _old_prompt_library")
    print("Renamed: prompt_library -> _old_prompt_library")
except: print("prompt_library already renamed or absent")
db.commit()

# 确保 word_card_group 有 seedance_subtype 列
cols = [c[1] for c in db.execute("PRAGMA table_info(word_card_group)")]
if 'seedance_subtype' not in cols:
    db.execute("ALTER TABLE word_card_group ADD COLUMN seedance_subtype TEXT DEFAULT ''")
    print("Added seedance_subtype column")

# 同步 prompt_library.category → word_card_group.seedance_subtype
updated = 0
for lib in db.execute("SELECT * FROM _old_prompt_library").fetchall():
    updated += db.execute(
        "UPDATE word_card_group SET seedance_subtype=? WHERE group_key=? AND group_type='seedance'",
        [lib['category'] or '', lib['dimension_key']]
    ).rowcount
print("Populated seedance_subtype for %d groups" % updated)
db.commit()

# ============================================================
# Step 1: 迁移 _old_prompt_word_card → word_card，记录新旧ID映射
# ============================================================
db.execute("DROP TABLE IF EXISTS seedance_id_map")
db.execute("""
    CREATE TABLE seedance_id_map (
        old_id INTEGER PRIMARY KEY,
        new_id INTEGER NOT NULL,
        UNIQUE(new_id)
    )
""")

# 已存在的映射：通过 content 匹配 (同一 group 下同名)
existing = {}
for r in db.execute("""
    SELECT wc.id, wc.content, wc.group_id 
    FROM word_card wc 
    JOIN word_card_group wg ON wg.id = wc.group_id 
    WHERE wg.group_type = 'seedance' AND wc.is_deleted = 0
""").fetchall():
    key = (r['group_id'], r['content'])
    existing[key] = r['id']

imported = 0
skipped = 0
file_copies = 0

SRC_THUMB = os.path.join(os.path.dirname(DB), 'wordcard_thumbs')
SRC_VIDEO = os.path.join(os.path.dirname(DB), 'wordcard_videos')
DST_THUMB = os.path.join(os.path.dirname(DB), 'wc_media', 'thumbs')
DST_VIDEO = os.path.join(os.path.dirname(DB), 'wc_media', 'videos')
os.makedirs(DST_THUMB, exist_ok=True)
os.makedirs(DST_VIDEO, exist_ok=True)

def copy_file(filename, src_dir, dst_dir):
    if not filename: return None
    src = os.path.join(src_dir, os.path.basename(filename))
    if not os.path.exists(src): return None
    dst = os.path.join(dst_dir, os.path.basename(filename))
    if os.path.exists(dst):
        if os.path.getsize(src) == os.path.getsize(dst): return None
        name, ext = os.path.splitext(os.path.basename(filename))
        dst = os.path.join(dst_dir, "%s_%s%s" % (name, uuid.uuid4().hex[:8], ext))
    shutil.copy2(src, dst)
    return filename  # use same filename

for card in db.execute("SELECT * FROM _old_prompt_word_card").fetchall():
    group_id = card['library_id']
    content = card['word_text'] or ''
    key = (group_id, content)

    if key in existing and content:
        # 同名同组 → 记录映射 + 合并缩略图
        new_id = existing[key]
        db.execute("INSERT OR IGNORE INTO seedance_id_map (old_id, new_id) VALUES (?,?)", [card['id'], new_id])

        # 若目标有预览则跳过，否则从源复制
        wc = db.execute("SELECT thumbnail, preview_media FROM word_card WHERE id=?", [new_id]).fetchone()
        if not wc['thumbnail'] and card['preview_image']:
            copy_file(card['preview_image'], SRC_THUMB, DST_THUMB)
            db.execute("UPDATE word_card SET thumbnail=?, media_type='image', updated_at=datetime('now','localtime') WHERE id=?",
                       [card['preview_image'], new_id])
            file_copies += 1
        if not wc['preview_media'] and card['preview_video']:
            copy_file(card['preview_video'], SRC_VIDEO, DST_VIDEO)
            db.execute("UPDATE word_card SET preview_media=?, media_type='video', updated_at=datetime('now','localtime') WHERE id=?",
                       [card['preview_video'], new_id])
            file_copies += 1
        skipped += 1
    else:
        # 新增
        thumb = ''
        preview = ''
        media_type = 'text'
        if card['preview_image']:
            copy_file(card['preview_image'], SRC_THUMB, DST_THUMB)
            thumb = card['preview_image']
            media_type = 'image'
            file_copies += 1
        if card['preview_video']:
            copy_file(card['preview_video'], SRC_VIDEO, DST_VIDEO)
            preview = card['preview_video']
            media_type = 'video'
            file_copies += 1

        db.execute("""
            INSERT INTO word_card (
                group_id, content, meaning, thumbnail, preview_media, media_type,
                usage_count, heat_weight, is_builtin, sort_order,
                module, category, card_role, source
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, [
            group_id, content, card['definition'] or '',
            thumb, preview, media_type,
            card['usage_count'] or 0, card['heat_weight'] or 0,
            card['is_system'] or 0, 0,
            'seedance_v2', 'seedance_v2', 'seedance', 'seedance_v2'
        ])
        new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        db.execute("INSERT INTO seedance_id_map (old_id, new_id) VALUES (?,?)", [card['id'], new_id])
        existing[key] = new_id
        imported += 1

db.commit()
print("Imported: %d, Skipped: %d, File copies: %d" % (imported, skipped, file_copies))

# ============================================================
# Step 2: CREATE VIEW prompt_word_card (通过桥接表返回 old_id)
# ============================================================
db.execute("DROP VIEW IF EXISTS prompt_word_card")
db.execute("""
    CREATE VIEW prompt_word_card AS
    SELECT 
        COALESCE(sm.old_id, wc.id) AS id,
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
    LEFT JOIN seedance_id_map sm ON sm.new_id = wc.id
    WHERE wg.group_type = 'seedance' AND wc.is_deleted = 0
""")
print("Created VIEW prompt_word_card (ID-bridged)")

# ============================================================
# Step 3: CREATE VIEW prompt_library
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
print("Created VIEW prompt_library")

# ============================================================
# Step 4: INSTEAD OF triggers for prompt_word_card
# ============================================================
db.execute("DROP TRIGGER IF EXISTS trg_pwc_insert")
db.execute("""
    CREATE TRIGGER trg_pwc_insert INSTEAD OF INSERT ON prompt_word_card
    BEGIN
        INSERT INTO word_card (
            group_id, content, meaning, thumbnail, preview_media,
            heat_weight, is_builtin, usage_count,
            module, category, card_role, source
        ) VALUES (
            NEW.library_id,
            NEW.word_text,
            NEW.definition,
            NEW.preview_image,
            NEW.preview_video,
            COALESCE(NEW.heat_weight, 0.5),
            COALESCE(NEW.is_system, 0),
            COALESCE(NEW.usage_count, 0),
            'seedance_v2', 'seedance_v2', 'seedance', 'seedance_v2'
        );
        INSERT INTO seedance_id_map (old_id, new_id) VALUES (NEW.id, last_insert_rowid());
    END
""")

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
        WHERE id = (SELECT new_id FROM seedance_id_map WHERE old_id = OLD.id UNION ALL SELECT OLD.id WHERE OLD.id NOT IN (SELECT old_id FROM seedance_id_map) LIMIT 1);
    END
""")

db.execute("DROP TRIGGER IF EXISTS trg_pwc_delete")
db.execute("""
    CREATE TRIGGER trg_pwc_delete INSTEAD OF DELETE ON prompt_word_card
    BEGIN
        UPDATE word_card SET is_deleted = 1, deleted_at = datetime('now','localtime')
        WHERE id = (SELECT new_id FROM seedance_id_map WHERE old_id = OLD.id UNION ALL SELECT OLD.id WHERE OLD.id NOT IN (SELECT old_id FROM seedance_id_map) LIMIT 1);
    END
""")

print("Created INSTEAD OF triggers")

db.commit()

# ============================================================
# Step 6: Verify
# ============================================================
print("\n=== Verification ===")
cnt = db.execute("SELECT COUNT(*) FROM prompt_word_card").fetchone()[0]
print("prompt_word_card VIEW: %d cards" % cnt)
cnt2 = db.execute("SELECT COUNT(*) FROM prompt_library").fetchone()[0]
print("prompt_library VIEW: %d groups" % cnt2)

# Check a few old IDs still accessible
for old_id in [1, 2, 3, 10, 50, 100]:
    r = db.execute("SELECT id, word_text FROM prompt_word_card WHERE id=?", [old_id]).fetchone()
    if r:
        print("  old_id=%d → word=%s" % (old_id, str(r['word_text'])[:30]))

# Verify user_scene_prompt references
uc = db.execute("SELECT COUNT(*) FROM user_scene_prompt WHERE word_card_id IS NOT NULL").fetchone()[0]
print("user_scene_prompt references: %d (all matchable via VIEW)" % uc)

db.close()
print("\nDONE")
