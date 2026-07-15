# -*- coding: utf-8 -*-
"""Phase36 优化 — project_role 审核记录表。幂等+快照。"""
import os, sqlite3, time
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
BK = os.path.join(HERE, "..", "data", "backups")
os.makedirs(BK, exist_ok=True)
bak = os.path.join(BK, "phase36rev_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
s = sqlite3.connect(DB, timeout=10)
try:
    s.execute("PRAGMA wal_checkpoint(TRUNCATE)"); s.execute("VACUUM INTO ?", [bak]); print("[OK] 备份", bak)
except Exception as e:
    import shutil; shutil.copy2(DB, bak); print("[WARN] copy", e)
finally:
    s.close()
c = sqlite3.connect(DB, timeout=10); c.execute("PRAGMA journal_mode=WAL")
try:
    c.execute("""CREATE TABLE IF NOT EXISTS project_role_review (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_role_id INTEGER NOT NULL,
        reviewer_user_id INTEGER,
        reviewer_name TEXT DEFAULT '',
        action TEXT NOT NULL DEFAULT 'comment',  -- submit|approve|reject|comment
        comment TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_prrev_role ON project_role_review(project_role_id, id)")
    c.commit()
    print("[DONE] project_role_review 就绪 fk=%d" % len(c.execute("PRAGMA foreign_key_check").fetchall()))
finally:
    c.close()
