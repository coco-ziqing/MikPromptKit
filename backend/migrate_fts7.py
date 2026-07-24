"""
迁移: 重建 word_card_fts 索引 — 从 4 字段扩展到 7 字段
新增: scene, content_en, content_zh
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db, safe_commit

def migrate():
    db = get_db()
    print("[FTS补全] 开始重建 word_card_fts (4→7字段)...")

    # 1. 删旧 FTS 表及触发器
    db.executescript("""
        DROP TRIGGER IF EXISTS wc_fts_ai;
        DROP TRIGGER IF EXISTS wc_fts_ad;
        DROP TRIGGER IF EXISTS wc_fts_au;
        DROP TABLE IF EXISTS word_card_fts;
    """)

    # 2. 建新 FTS 表（7字段）
    db.execute("""
        CREATE VIRTUAL TABLE word_card_fts USING fts5(
            content, meaning, name, tags, scene, content_en, content_zh,
            content='word_card', content_rowid='id'
        )
    """)

    # 3. 重建触发器（7字段）
    db.executescript("""
        CREATE TRIGGER wc_fts_ai AFTER INSERT ON word_card BEGIN
            INSERT INTO word_card_fts(rowid, content, meaning, name, tags, scene, content_en, content_zh)
            VALUES (new.id, new.content, new.meaning, new.name, new.tags, new.scene, new.content_en, new.content_zh);
        END;
        CREATE TRIGGER wc_fts_ad AFTER DELETE ON word_card BEGIN
            INSERT INTO word_card_fts(word_card_fts, rowid, content, meaning, name, tags, scene, content_en, content_zh)
            VALUES ('delete', old.id, old.content, old.meaning, old.name, old.tags, old.scene, old.content_en, old.content_zh);
        END;
        CREATE TRIGGER wc_fts_au AFTER UPDATE ON word_card BEGIN
            INSERT INTO word_card_fts(word_card_fts, rowid, content, meaning, name, tags, scene, content_en, content_zh)
            VALUES ('delete', old.id, old.content, old.meaning, old.name, old.tags, old.scene, old.content_en, old.content_zh);
            INSERT INTO word_card_fts(rowid, content, meaning, name, tags, scene, content_en, content_zh)
            VALUES (new.id, new.content, new.meaning, new.name, new.tags, new.scene, new.content_en, new.content_zh);
        END;
    """)

    # 4. 全量回填
    count = db.execute(
        "INSERT INTO word_card_fts(rowid, content, meaning, name, tags, scene, content_en, content_zh) "
        "SELECT id, content, meaning, name, tags, scene, content_en, content_zh FROM word_card WHERE is_deleted=0"
    ).rowcount
    safe_commit()

    # 5. 验证
    fts_count = db.execute("SELECT COUNT(*) FROM word_card_fts").fetchone()[0]
    print(f"[FTS补全] 完成: {fts_count}/{count} 条索引, 7个字段(content,meaning,name,tags,scene,content_en,content_zh)")
    return {"fts_rows": fts_count, "wc_rows": count}

if __name__ == "__main__":
    print(migrate())
