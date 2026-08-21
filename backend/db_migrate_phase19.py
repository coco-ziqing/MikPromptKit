# -*- coding: utf-8 -*-
"""
Phase19 风格套装系统数据库迁移（幂等）
表：
  style_suit          套装主表（名称/标签/封面/备注/收藏/回收站/版本）
  style_suit_version  套装编辑版本池（每次保存自动快照）
  assemble_draft      操作台会话级临时装配草稿
  render_batch        批量渲染批次（套装+基底+词卡+配件 → 任务组）
版本: v5.47.0-phase19
幂等性: 所有操作均可安全重复执行（IF NOT EXISTS / 列探测）
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from database import get_db, safe_commit


def _execute_safe(db, sql, desc=""):
    try:
        db.execute(sql)
        if desc:
            print(f"  [OK] {desc}")
    except Exception as e:
        err = str(e).lower()
        if any(x in err for x in ['already exists', 'duplicate column', 'duplicate key',
                                  'duplicate index', 'unique constraint', 'already has']):
            if desc:
                print(f"  [SKIP] {desc} (已存在)")
        else:
            print(f"  [WARN] {desc}: {e}")


TABLES = {
    "style_suit": """
        CREATE TABLE IF NOT EXISTS style_suit (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            name               TEXT NOT NULL,
            tags               TEXT NOT NULL DEFAULT '[]',
            cover_image        TEXT NOT NULL DEFAULT '',
            remark             TEXT NOT NULL DEFAULT '',
            config_json        TEXT NOT NULL DEFAULT '{}',
            source             TEXT NOT NULL DEFAULT 'user',   -- user/system
            is_favorite        INTEGER NOT NULL DEFAULT 0,
            is_deleted         INTEGER NOT NULL DEFAULT 0,
            deleted_at         TEXT NOT NULL DEFAULT '',
            version_count      INTEGER NOT NULL DEFAULT 1,
            current_version_id INTEGER NOT NULL DEFAULT 0,
            owner_user_id      INTEGER,
            created_at         TEXT NOT NULL DEFAULT '',
            updated_at         TEXT NOT NULL DEFAULT ''
        )
    """,
    "style_suit_version": """
        CREATE TABLE IF NOT EXISTS style_suit_version (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            suit_id       INTEGER NOT NULL,
            version       INTEGER NOT NULL DEFAULT 1,
            config_json   TEXT NOT NULL DEFAULT '{}',
            name_snapshot TEXT NOT NULL DEFAULT '',
            created_by    INTEGER,
            created_at    TEXT NOT NULL DEFAULT ''
        )
    """,
    "assemble_draft": """
        CREATE TABLE IF NOT EXISTS assemble_draft (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL DEFAULT '',
            base_asset_ref   TEXT NOT NULL DEFAULT '',   -- 基底素材引用 {source,id,url}
            rune_card_ids    TEXT NOT NULL DEFAULT '[]', -- 符文词卡 word_card ids
            suit_id          INTEGER NOT NULL DEFAULT 0,
            accessory_list   TEXT NOT NULL DEFAULT '[]', -- 配件选配列表
            channel          TEXT NOT NULL DEFAULT 'virtual', -- virtual/real
            config_override  TEXT NOT NULL DEFAULT '{}', -- 会话级临时修改（不改原套装）
            status           TEXT NOT NULL DEFAULT 'draft',
            owner_user_id    INTEGER,
            created_at       TEXT NOT NULL DEFAULT '',
            updated_at       TEXT NOT NULL DEFAULT ''
        )
    """,
    "render_batch": """
        CREATE TABLE IF NOT EXISTS render_batch (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_id      INTEGER NOT NULL DEFAULT 0,
            suit_id       INTEGER NOT NULL DEFAULT 0,
            channel       TEXT NOT NULL DEFAULT 'virtual',
            status        TEXT NOT NULL DEFAULT 'queued', -- queued/running/done/fail
            total         INTEGER NOT NULL DEFAULT 0,
            done          INTEGER NOT NULL DEFAULT 0,
            fail          INTEGER NOT NULL DEFAULT 0,
            task_ids      TEXT NOT NULL DEFAULT '[]',
            license_info  TEXT NOT NULL DEFAULT '{}',
            created_by    INTEGER,
            created_at    TEXT NOT NULL DEFAULT '',
            finished_at   TEXT NOT NULL DEFAULT ''
        )
    """,
}

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_style_suit_owner ON style_suit(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_style_suit_deleted ON style_suit(is_deleted)",
    "CREATE INDEX IF NOT EXISTS idx_suit_version_suit ON style_suit_version(suit_id)",
    "CREATE INDEX IF NOT EXISTS idx_draft_owner ON assemble_draft(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_render_batch_owner ON render_batch(created_by)",
]


def run_migration(db=None):
    started = time.time()
    own_conn = db is None
    db = db or get_db()
    tables_created = 0
    indexes_created = 0

    print("[Phase19] 风格套装系统迁移开始...")
    for name, sql in TABLES.items():
        exists = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [name]
        ).fetchone()
        _execute_safe(db, sql, f"建表 {name}")
        if not exists:
            tables_created += 1

    for sql in INDEXES:
        idx_name = sql.split("ON ")[0].split(" ")[-1]
        exists = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", [idx_name]
        ).fetchone()
        _execute_safe(db, sql, f"建索引 {idx_name}")
        if not exists:
            indexes_created += 1

    if own_conn:
        safe_commit()
        db.close()

    elapsed = time.time() - started
    result = {
        "tables_created": tables_created,
        "indexes_created": indexes_created,
        "elapsed_ms": round(elapsed * 1000),
    }
    print(f"\n[Phase19] 迁移完成! {result} ({elapsed:.2f}s)")
    return result


if __name__ == "__main__":
    print("MikPromptKit Phase19 风格套装系统数据库迁移")
    print("=" * 50)
    result = run_migration()
    print("\n迁移摘要:")
    print(f"  新建表: {result['tables_created']}")
    print(f"  索引创建: {result['indexes_created']}")
    print(f"  耗时: {result['elapsed_ms']}ms")
