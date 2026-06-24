# -*- coding: utf-8 -*-
"""
migrate_atom_tables.py — V2 提示词原子化全链路 · DB 建表 (2026-06-24)
创建 3 张核心表 + 索引 + MD5 缓存支持
幂等执行（IF NOT EXISTS），可重复运行
"""
import sqlite3, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from database import get_db, safe_execute, safe_commit

def migrate():
    db = get_db()
    safe_execute("""
        CREATE TABLE IF NOT EXISTS atom_decompose (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            source_prompt   TEXT    NOT NULL,
            media_type      TEXT    NOT NULL DEFAULT 'image',
            source_hash     TEXT    NOT NULL UNIQUE,
            atoms_json      TEXT    NOT NULL DEFAULT '[]',
            model_used      TEXT    DEFAULT '',
            quality_score   REAL    DEFAULT 0,
            created_at      TEXT    DEFAULT (datetime('now','localtime'))
        )
    """, commit=True)

    safe_execute("CREATE INDEX IF NOT EXISTS idx_atom_hash ON atom_decompose(source_hash)")

    safe_execute("""
        CREATE TABLE IF NOT EXISTS atom_variation (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            decompose_id    INTEGER NOT NULL,
            version_name    TEXT    DEFAULT '',
            prompt_text     TEXT    NOT NULL,
            atoms_json      TEXT    NOT NULL DEFAULT '[]',
            parent_version  INTEGER DEFAULT NULL,
            branch_tag      TEXT    DEFAULT 'main',
            is_starred      INTEGER DEFAULT 0,
            quality_score   REAL    DEFAULT 0,
            created_at      TEXT    DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (decompose_id) REFERENCES atom_decompose(id) ON DELETE CASCADE
        )
    """, commit=True)

    safe_execute("CREATE INDEX IF NOT EXISTS idx_variation_decompose ON atom_variation(decompose_id)")

    safe_execute("""
        CREATE TABLE IF NOT EXISTS atom_template (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            variation_id    INTEGER NOT NULL,
            title           TEXT    NOT NULL,
            description     TEXT    DEFAULT '',
            tags_json       TEXT    DEFAULT '[]',
            params_json     TEXT    DEFAULT '[]',
            downloads       INTEGER DEFAULT 0,
            rating          REAL    DEFAULT 0,
            rating_count    INTEGER DEFAULT 0,
            is_published    INTEGER DEFAULT 0,
            published_at    TEXT    DEFAULT NULL,
            created_at      TEXT    DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (variation_id) REFERENCES atom_variation(id) ON DELETE CASCADE
        )
    """, commit=True)

    safe_execute("CREATE INDEX IF NOT EXISTS idx_template_published ON atom_template(is_published)")

    # 4. 原子溯源统计表
    safe_execute("""
        CREATE TABLE IF NOT EXISTS atom_stats (
            atom_id         TEXT    NOT NULL,
            decompose_id    INTEGER NOT NULL,
            text_hash       TEXT    NOT NULL,
            atom_type       TEXT    DEFAULT '',
            usage_count     INTEGER DEFAULT 0,
            combo_count     INTEGER DEFAULT 0,
            export_count    INTEGER DEFAULT 0,
            last_used_at    TEXT    DEFAULT NULL,
            created_at      TEXT    DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (atom_id, decompose_id)
        )
    """, commit=True)
    safe_execute("CREATE INDEX IF NOT EXISTS idx_stats_count ON atom_stats(usage_count DESC)")
    safe_execute("CREATE INDEX IF NOT EXISTS idx_stats_hash ON atom_stats(text_hash)")

    # 5. atom_decompose 加溯源字段（幂等：忽略已存在列的错误）
    for col, dtype in [("parent_decompose_id", "INTEGER DEFAULT NULL"),
                        ("source_card_id", "INTEGER DEFAULT NULL")]:
        try:
            safe_execute(f"ALTER TABLE atom_decompose ADD COLUMN {col} {dtype}")
        except Exception:
            pass

    # 6. Phase15 新增: 原子↔词卡 双向桥接表
    safe_execute("""
        CREATE TABLE IF NOT EXISTS atom_word_bridge (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            atom_hash       TEXT    NOT NULL,
            decompose_id    INTEGER NOT NULL,
            word_card_id    INTEGER NOT NULL,
            atom_type       TEXT    DEFAULT '',
            atom_text       TEXT    DEFAULT '',
            created_at      TEXT    DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (decompose_id) REFERENCES atom_decompose(id) ON DELETE CASCADE,
            FOREIGN KEY (word_card_id) REFERENCES word_card(id) ON DELETE CASCADE
        )
    """, commit=True)
    safe_execute("CREATE INDEX IF NOT EXISTS idx_bridge_atom_hash ON atom_word_bridge(atom_hash)")
    safe_execute("CREATE INDEX IF NOT EXISTS idx_bridge_card ON atom_word_bridge(word_card_id)")
    safe_execute("CREATE INDEX IF NOT EXISTS idx_bridge_type ON atom_word_bridge(atom_type)")

    # 7. 为 word_card_group 补充 atom 类型支持
    try:
        safe_execute("UPDATE word_card_group SET group_type='atom' WHERE group_key LIKE 'atom_%' AND group_type='custom'")
    except Exception:
        pass

    safe_commit()
    print("[OK] atom_decompose + atom_variation + atom_template + atom_stats + atom_word_bridge + trace 已建")

if __name__ == "__main__":
    migrate()
