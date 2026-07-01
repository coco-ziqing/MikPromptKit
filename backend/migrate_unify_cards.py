# -*- coding: utf-8 -*-
"""
数据统一迁移: prompt_word_card → word_card
=====================================
将分镜组装器的独立词卡系统合并到统一 word_card 表
"""

import sqlite3, os, shutil, uuid

DB = r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data\prompts.db'
BASE = r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data'

# 源/目标目录
SRC_THUMB = os.path.join(BASE, 'wordcard_thumbs')
SRC_VIDEO = os.path.join(BASE, 'wordcard_videos')
DST_THUMB = os.path.join(BASE, 'wc_media', 'thumbs')
DST_VIDEO = os.path.join(BASE, 'wc_media', 'videos')

os.makedirs(DST_THUMB, exist_ok=True)
os.makedirs(DST_VIDEO, exist_ok=True)


def migrate():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row

    # ============================================================
    # 1. 构建 library_id → group_id 映射 (通过 dimension_key 匹配)
    #    prompt_library.dimension_key ↔ word_card_group.group_key
    # ============================================================
    lib_map = {}  # prompt_library.id → word_card_group.id
    libs = db.execute("SELECT id, dimension_key, dimension_name, category FROM prompt_library").fetchall()
    for lib in libs:
        g = db.execute(
            "SELECT id, name FROM word_card_group WHERE group_key=? AND group_type='seedance'",
            [lib['dimension_key']]
        ).fetchone()
        if g:
            lib_map[lib['id']] = g['id']
            print("  Map: lib_%d(%s) → group_%d(%s)" % (lib['id'], lib['dimension_name'], g['id'], g['name']))
        else:
            # 创建新的 word_card_group
            db.execute(
                "INSERT INTO word_card_group (name, group_key, group_type, icon, sort_order, is_active) VALUES (?,?,?,?,?,1)",
                [lib['dimension_name'], lib['dimension_key'], 'seedance', '📄',
                 db.execute("SELECT MAX(sort_order) FROM word_card_group WHERE group_type='seedance'").fetchone()[0] + 1]
            )
            new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            lib_map[lib['id']] = new_id
            print("  CREATE: lib_%d(%s) → NEW group_%d" % (lib['id'], lib['dimension_name'], new_id))
    db.commit()

    # ============================================================
    # 2. 检查重复 (同一 group_id 下的同名 word_text)
    # ============================================================
    existing = {}  # (group_id, content) → word_card.id
    for r in db.execute("SELECT id, group_id, content FROM word_card WHERE is_deleted=0").fetchall():
        existing[(r['group_id'], r['content'])] = r['id']

    # ============================================================
    # 3. 迁移 prompt_word_card → word_card
    # ============================================================
    cards = db.execute("SELECT * FROM prompt_word_card ORDER BY id").fetchall()
    print("\n  迁移 %d 条词卡..." % len(cards))

    migrated = 0
    skipped = 0
    file_copies = 0

    for card in cards:
        group_id = lib_map.get(card['library_id'])
        if not group_id:
            print("  SKIP card_%d: no group mapping for library_id=%d" % (card['id'], card['library_id']))
            skipped += 1
            continue

        content = card['word_text'] or ''
        key = (group_id, content)

        if key in existing:
            # 已存在同名同组词卡 → 更新已有记录的缩略图/视频/热度
            existing_id = existing[key]
            # 若已有记录无缩略图但迁移源有，则复制
            existing_card = db.execute("SELECT thumbnail, preview_media FROM word_card WHERE id=?", [existing_id]).fetchone()
            if not existing_card['thumbnail'] and card['preview_image']:
                new_filename = _copy_file(card['preview_image'], SRC_THUMB, DST_THUMB)
                db.execute("UPDATE word_card SET thumbnail=?, media_type='image', updated_at=datetime('now','localtime') WHERE id=?",
                           [new_filename or card['preview_image'], existing_id])
                file_copies += 1
            if not existing_card['preview_media'] and card['preview_video']:
                new_filename = _copy_file(card['preview_video'], SRC_VIDEO, DST_VIDEO)
                db.execute("UPDATE word_card SET preview_media=?, media_type='video', updated_at=datetime('now','localtime') WHERE id=?",
                           [new_filename or card['preview_video'], existing_id])
                file_copies += 1
            # 累加热度
            db.execute("UPDATE word_card SET heat_weight=MAX(heat_weight,?) WHERE id=?", [card['heat_weight'], existing_id])
            skipped += 1
            continue

        # 处理缩略图/视频文件
        thumbnail = ''
        preview_media = ''
        media_type = 'text'
        if card['preview_image']:
            new_name = _copy_file(card['preview_image'], SRC_THUMB, DST_THUMB)
            thumbnail = new_name or card['preview_image']
            media_type = 'image'
            file_copies += 1
        if card['preview_video']:
            new_name = _copy_file(card['preview_video'], SRC_VIDEO, DST_VIDEO)
            preview_media = new_name or card['preview_video']
            media_type = 'video'
            file_copies += 1

        db.execute("""
            INSERT INTO word_card (
                group_id, name, content, meaning, module, category,
                thumbnail, preview_media, media_type,
                usage_count, heat_weight, is_builtin,
                sort_order, source, card_role,
                created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),datetime('now','localtime'))
        """, [
            group_id,
            content[:60],  # name
            content,        # content
            card['definition'] or '',  # meaning
            'seedance_v2',  # module
            'seedance_v2',  # category
            thumbnail,
            preview_media,
            media_type,
            card['usage_count'] or 0,
            card['heat_weight'] or 0,
            card['is_system'] or 0,  # is_builtin
            0,  # sort_order
            'seedance_v2',  # source
            'seedance',     # card_role
        ])
        db.commit()
        migrated += 1

    print("  迁移完成: 新增 %d  跳过(重复) %d  文件复制 %d" % (migrated, skipped, file_copies))

    # ============================================================
    # 4. 验证
    # ============================================================
    total_wc = db.execute("SELECT COUNT(*) FROM word_card WHERE source='seedance_v2' AND is_deleted=0").fetchone()[0]
    print("\n  word_card 中 seedance_v2 来源的卡片: %d 条" % total_wc)

    # 分组统计
    for g in db.execute("SELECT id, name FROM word_card_group WHERE group_type='seedance' ORDER BY id").fetchall():
        cnt = db.execute("SELECT COUNT(*) FROM word_card WHERE group_id=? AND source='seedance_v2' AND is_deleted=0",
                         [g['id']]).fetchone()[0]
        if cnt > 0:
            print("    group_%d %s: %d cards" % (g['id'], g['name'], cnt))

    print("\n  ✅ 迁移成功！旧表 prompt_word_card 数据已同步到 word_card")
    print("  ⚠️  旧表保留未删除，确认无误后需手动 DROP TABLE prompt_word_card / prompt_library")
    print("  ⚠️  后端 seedance_v2.py 尚未适配，请继续执行步骤3")

    db.close()


def _copy_file(filename, src_dir, dst_dir):
    """复制文件到目标目录，若冲突则重命名。返回新文件名或 None"""
    if not filename:
        return None
    src = os.path.join(src_dir, os.path.basename(filename))
    dst = os.path.join(dst_dir, os.path.basename(filename))
    if not os.path.exists(src):
        print("    ⚠ 源文件不存在: %s" % src)
        return None
    if os.path.exists(dst):
        # 已存在同名 → 跳过不复制
        if os.path.getsize(src) == os.path.getsize(dst):
            return None  # 相同文件,无需复制
        # 不同文件 → 重命名
        name, ext = os.path.splitext(os.path.basename(filename))
        new_name = "%s_%s%s" % (name, uuid.uuid4().hex[:8], ext)
        dst = os.path.join(dst_dir, new_name)
        shutil.copy2(src, dst)
        return new_name
    shutil.copy2(src, dst)
    return None  # 返回 None 表示使用原文件名


if __name__ == '__main__':
    print("=" * 60)
    print("数据统一迁移: prompt_word_card → word_card")
    print("=" * 60)
    migrate()
