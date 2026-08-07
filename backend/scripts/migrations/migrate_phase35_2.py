# -*- coding: utf-8 -*-
"""
Phase35.2 迁移 — 版本管理 + 验证审核 + 团队协作成员

新增：
- asset_version   资产版本快照
- asset_review    审核/评论记录
- project_space_member  项目成员(owner/reviewer/editor/viewer)
- asset_catalog +current_version_id/+review_status/+version_count

回填：
- 每个 project_space → owner 加为 owner 成员
- 每个 asset_catalog → 生成 v1 版本，回填 current_version_id/version_count=1/review_status='draft'

安全：纯增量、幂等、执行前 VACUUM INTO 快照。
"""
import os, sys, sqlite3, time

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
BACKUP_DIR = os.path.join(HERE, "..", "data", "backups")


def _has_col(c, t, col):
    try:
        return any(r[1] == col for r in c.execute(f"PRAGMA table_info({t})"))
    except Exception:
        return False


def main():
    if not os.path.exists(DB):
        print("[ERR] DB missing"); sys.exit(1)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    bak = os.path.join(BACKUP_DIR, f"phase35_2_pre_{time.strftime('%Y%m%d_%H%M%S')}.db")
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)"); s.execute("VACUUM INTO ?", [bak]); print(f"[OK] 备份 -> {bak}")
    except Exception as e:
        import shutil; shutil.copy2(DB, bak); print(f"[WARN] VACUUM 失败({e})，已复制")
    finally:
        s.close()

    c = sqlite3.connect(DB, timeout=10); c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    try:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS asset_version (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            catalog_id INTEGER NOT NULL,
            version_no INTEGER NOT NULL DEFAULT 1,
            fingerprint TEXT DEFAULT '',
            filename TEXT DEFAULT '',
            size INTEGER DEFAULT 0,
            local_rel_path TEXT DEFAULT '',
            thumb_path TEXT DEFAULT '',
            origin_device TEXT DEFAULT 'server',
            author_user_id INTEGER,
            author_name TEXT DEFAULT '',
            note TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',   -- draft|in_review|approved|rejected
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_ver_cat ON asset_version(catalog_id, version_no);

        CREATE TABLE IF NOT EXISTS asset_review (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            catalog_id INTEGER NOT NULL,
            version_id INTEGER,
            reviewer_user_id INTEGER,
            reviewer_name TEXT DEFAULT '',
            action TEXT NOT NULL DEFAULT 'comment', -- submit|approve|reject|comment
            comment TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_rev_cat ON asset_review(catalog_id, id);

        CREATE TABLE IF NOT EXISTS project_space_member (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_space_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',    -- owner|reviewer|editor|viewer
            added_by INTEGER,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(project_space_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_psm_proj ON project_space_member(project_space_id);
        CREATE INDEX IF NOT EXISTS idx_psm_user ON project_space_member(user_id);
        """)
        print("[OK] 新表: asset_version / asset_review / project_space_member")

        for col, ddl in [
            ("current_version_id", "ALTER TABLE asset_catalog ADD COLUMN current_version_id INTEGER"),
            ("review_status",      "ALTER TABLE asset_catalog ADD COLUMN review_status TEXT DEFAULT 'draft'"),
            ("version_count",      "ALTER TABLE asset_catalog ADD COLUMN version_count INTEGER DEFAULT 1"),
        ]:
            if not _has_col(c, "asset_catalog", col):
                c.execute(ddl); print(f"[OK] asset_catalog += {col}")

        # 回填成员：项目 owner
        n_m = 0
        for p in c.execute("SELECT id, owner_user_id FROM project_space WHERE owner_user_id IS NOT NULL"):
            try:
                cur = c.execute("INSERT OR IGNORE INTO project_space_member (project_space_id,user_id,role,added_by) VALUES (?,?, 'owner', ?)",
                                [p["id"], p["owner_user_id"], p["owner_user_id"]])
                n_m += cur.rowcount
            except Exception:
                pass
        print(f"[OK] 回填 owner 成员: {n_m}")

        # 回填版本：每个 catalog → v1
        n_v = 0
        for a in c.execute("SELECT * FROM asset_catalog WHERE current_version_id IS NULL"):
            c.execute("""INSERT INTO asset_version
                (catalog_id,version_no,fingerprint,filename,size,local_rel_path,thumb_path,origin_device,author_user_id,note,status)
                VALUES (?,1,?,?,?,?,?,?,?, '', 'draft')""",
                [a["id"], a["fingerprint"], a["filename"], a["size"], a["local_rel_path"],
                 a["thumb_path"] or "", a["origin_device"] or "server", a["owner_user_id"]])
            vid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            c.execute("UPDATE asset_catalog SET current_version_id=?, version_count=1, review_status='draft' WHERE id=?", [vid, a["id"]])
            n_v += 1
        print(f"[OK] 回填 v1 版本: {n_v}")

        c.commit()
        print("\n==== 摘要 ====")
        for t in ["asset_version", "asset_review", "project_space_member"]:
            print(f"  {t}: {c.execute(f'SELECT COUNT(1) FROM {t}').fetchone()[0]}")
        print("  fk_check:", len(c.execute("PRAGMA foreign_key_check").fetchall()))
        print("[DONE] Phase35.2 迁移完成")
    finally:
        c.close()


if __name__ == "__main__":
    main()
