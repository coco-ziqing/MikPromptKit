# -*- coding: utf-8 -*-
"""并入「生成参数溯源 + 提示词/词卡关联」到 asset_catalog（原资产管理专业版特性）。幂等+快照。"""
import os, sys, sqlite3, time
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
BK = os.path.join(HERE, "..", "data", "backups")

def has(c, t, col): return any(r[1] == col for r in c.execute("PRAGMA table_info(%s)" % t))

def main():
    os.makedirs(BK, exist_ok=True)
    bak = os.path.join(BK, "prov_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)"); s.execute("VACUUM INTO ?", [bak]); print("[OK] 备份", bak)
    except Exception as e:
        import shutil; shutil.copy2(DB, bak); print("[WARN] copy backup", e)
    finally:
        s.close()
    c = sqlite3.connect(DB, timeout=10); c.execute("PRAGMA journal_mode=WAL")
    try:
        for col, ddl in [
            ("gen_prompt", "ALTER TABLE asset_catalog ADD COLUMN gen_prompt TEXT DEFAULT ''"),
            ("gen_model", "ALTER TABLE asset_catalog ADD COLUMN gen_model TEXT DEFAULT ''"),
            ("gen_params_json", "ALTER TABLE asset_catalog ADD COLUMN gen_params_json TEXT DEFAULT '{}'"),
            ("rating", "ALTER TABLE asset_catalog ADD COLUMN rating INTEGER DEFAULT 0"),
        ]:
            if not has(c, "asset_catalog", col):
                c.execute(ddl); print("[OK] asset_catalog +=", col)
        c.execute("""CREATE TABLE IF NOT EXISTS asset_catalog_ref (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            catalog_id INTEGER NOT NULL,
            ref_type TEXT NOT NULL DEFAULT 'word_card',  -- word_card | prompt | shot
            ref_id INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(catalog_id, ref_type, ref_id)
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_acr_cat ON asset_catalog_ref(catalog_id)")
        c.commit()
        print("[OK] asset_catalog_ref 就绪")
        print("[DONE] provenance/refs 迁移完成 (fk_check=%d)" % len(c.execute("PRAGMA foreign_key_check").fetchall()))
    finally:
        c.close()

if __name__ == "__main__":
    main()
