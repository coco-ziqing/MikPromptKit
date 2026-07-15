# -*- coding: utf-8 -*-
"""Phase36.2 迁移 — 总项目 角色/场景 实例（继承公共模版 + 独立版本 + 档案）。
统一 project_role(role_type=character|scene) 三表；纯增量+快照。
"""
import os, sys, sqlite3, time
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
BK = os.path.join(HERE, "..", "data", "backups")

def main():
    os.makedirs(BK, exist_ok=True)
    bak = os.path.join(BK, "phase36_2_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)"); s.execute("VACUUM INTO ?", [bak]); print("[OK] 备份", bak)
    except Exception as e:
        import shutil; shutil.copy2(DB, bak); print("[WARN] copy", e)
    finally:
        s.close()
    c = sqlite3.connect(DB, timeout=15); c.execute("PRAGMA journal_mode=WAL")
    try:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS project_role (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            master_project_id INTEGER NOT NULL,
            role_type TEXT NOT NULL DEFAULT 'character',   -- character | scene
            name TEXT NOT NULL DEFAULT '未命名',
            settings_json TEXT NOT NULL DEFAULT '{}',
            source_profile_id INTEGER,                      -- 来源公共库 profile（继承血缘）
            source_kind TEXT DEFAULT '',                    -- character_profiles | scene_profiles
            template_id INTEGER,
            current_version_id INTEGER,
            version_count INTEGER NOT NULL DEFAULT 1,
            review_status TEXT NOT NULL DEFAULT 'draft',    -- draft | in_review | approved
            cover_image TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            owner_user_id INTEGER,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_prole_proj ON project_role(master_project_id, role_type);

        CREATE TABLE IF NOT EXISTS project_role_version (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_role_id INTEGER NOT NULL,
            version_no INTEGER NOT NULL DEFAULT 1,
            settings_json TEXT NOT NULL DEFAULT '{}',
            name TEXT DEFAULT '',
            note TEXT DEFAULT '',
            author_user_id INTEGER,
            author_name TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_prolev_role ON project_role_version(project_role_id, version_no);

        CREATE TABLE IF NOT EXISTS project_role_asset (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_role_id INTEGER NOT NULL,
            asset_kind TEXT NOT NULL DEFAULT 'ref_image',   -- ref_image|three_view|turnaround|material|other
            filename TEXT DEFAULT '',
            rel_path TEXT DEFAULT '',
            thumb_path TEXT DEFAULT '',
            caption TEXT DEFAULT '',
            size INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_proleas_role ON project_role_asset(project_role_id);
        """)
        c.commit()
        for t in ["project_role", "project_role_version", "project_role_asset"]:
            print("  %s rows=%d" % (t, c.execute("SELECT COUNT(1) FROM %s" % t).fetchone()[0]))
        print("[DONE] Phase36.2 迁移完成 fk=%d" % len(c.execute("PRAGMA foreign_key_check").fetchall()))
    finally:
        c.close()

if __name__ == "__main__":
    main()
