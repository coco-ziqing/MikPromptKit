"""
种子数据迁移 — 启动时将 prompts/prompt_library/prompt_word_card 同步到 v4 表
"""
import json


def migrate_all_seed_data(db):
    """启动时调用：确保 v4 主表有数据"""
    _migrate_prompts_to_cards(db)
    _migrate_library_to_assets(db)


def _migrate_prompts_to_cards(db):
    """prompts → prompt_cards"""
    cards_count = db.execute("SELECT COUNT(*) FROM prompt_cards").fetchone()[0]
    if cards_count > 0:
        return
    rows = db.execute("SELECT * FROM prompts ORDER BY id").fetchall()
    if not rows:
        return
    for r in rows:
        r = dict(r)
        db.execute(
            """INSERT INTO prompt_cards
                (card_type, name, content, meaning, scene, module, category, tags,
                 structured_fields, usage_count, is_builtin, is_deleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)""",
            (
                'image',
                (r.get('subcategory') or '')[:60],
                r.get('content', ''),
                r.get('meaning', ''),
                r.get('scene', ''),
                r.get('module', ''),
                r.get('category', ''),
                r.get('tags', '[]'),
                '{}',
                r.get('usage_count', 0)
            )
        )
    db.commit()
    print(f"[迁移] prompts → prompt_cards: {len(rows)} 条")


def _migrate_library_to_assets(db):
    """prompt_library + prompt_word_card → library_assets"""
    assets_count = db.execute("SELECT COUNT(*) FROM library_assets").fetchone()[0]
    if assets_count > 0:
        return

    libs = db.execute("SELECT * FROM prompt_library ORDER BY sort_order").fetchall()
    for lib in libs:
        lib = dict(lib)
        # 每个词库在 library_assets 中创建一条分类条目
        db.execute(
            """INSERT INTO library_assets
                (name, lib_type, category, prompt, icon, is_builtin, sort_order)
            VALUES (?, 'style', ?, ?, '📚', 1, ?)""",
            (lib.get('dimension_name', ''), lib.get('category', ''), lib.get('description', ''), lib.get('sort_order', 0))
        )

        # 词库下的词卡同步
        cards = db.execute(
            "SELECT * FROM prompt_word_card WHERE library_id=? ORDER BY id",
            [lib['id']]
        ).fetchall()
        for card in cards:
            card = dict(card)
            db.execute(
                """INSERT INTO library_assets
                    (name, lib_type, category, prompt, icon, is_builtin, sort_order)
                VALUES (?, 'style', ?, ?, '📄', 1, 999)""",
                (
                    card.get('word_text', '')[:60],
                    lib.get('category', ''),
                    card.get('definition', card.get('word_text', '')),
                )
            )

    db.commit()
    total = db.execute("SELECT COUNT(*) FROM library_assets").fetchone()[0]
    print(f"[迁移] prompt_library → library_assets: {total} 条")
