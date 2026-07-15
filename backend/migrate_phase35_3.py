# -*- coding: utf-8 -*-
"""
Phase35.3 设备盘索引 → 服务器地基迁移（幂等，快照）
新表：device / device_watch_path / device_file_index / backup_task
"""
import os, sys, sqlite3, time, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
BK = os.path.join(HERE, "..", "data", "backups")

def has_col(c, table, col):
    return any(r[1] == col for r in c.execute("PRAGMA table_info(%s)" % table))

def has_table(c, name):
    return bool(c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [name]).fetchone())

def main():
    os.makedirs(BK, exist_ok=True)
    fk = os.path.join(BK, "phase35_3_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        s.execute("VACUUM INTO ?", [fk])
        print("[快照]", fk)
    except Exception as e:
        shutil.copy2(DB, fk)
        print("[WARN] copy snapshot:", e)
    finally:
        s.close()

    c = sqlite3.connect(DB, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
    try:
        # ── device ──
        if not has_table(c, "device"):
            c.execute("""CREATE TABLE device (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT DEFAULT '',
                platform TEXT DEFAULT 'win',
                token_hash TEXT DEFAULT '',
                owner_user_id INTEGER,
                agent_version TEXT DEFAULT '',
                last_seen_at TEXT,
                status TEXT DEFAULT 'active',
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_device_owner ON device(owner_user_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_device_status ON device(status)")
            print("[OK] device")
        else:
            for col, ddl in [
                ("agent_version", "ALTER TABLE device ADD COLUMN agent_version TEXT DEFAULT ''"),
            ]:
                if not has_col(c, "device", col):
                    c.execute(ddl)
                    print("[OK] device +=", col)

        # ── device_watch_path ──
        if not has_table(c, "device_watch_path"):
            c.execute("""CREATE TABLE device_watch_path (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER NOT NULL,
                abs_path TEXT NOT NULL,
                module_hint TEXT DEFAULT '',
                project_space_id INTEGER,
                enabled INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE CASCADE
            )""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_dwp_device ON device_watch_path(device_id, enabled)")
            print("[OK] device_watch_path")

        # ── device_file_index ──
        if not has_table(c, "device_file_index"):
            c.execute("""CREATE TABLE device_file_index (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER NOT NULL,
                watch_path_id INTEGER,
                rel_path TEXT NOT NULL,
                filename TEXT DEFAULT '',
                ext TEXT DEFAULT '',
                size INTEGER DEFAULT 0,
                mtime REAL DEFAULT 0,
                fingerprint TEXT DEFAULT '',
                state TEXT DEFAULT 'new',
                catalog_id INTEGER,
                first_seen_at TEXT DEFAULT (datetime('now','localtime')),
                last_seen_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE CASCADE
            )""")
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_dfi_unique ON device_file_index(device_id, rel_path)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_dfi_state ON device_file_index(device_id, state)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_dfi_catalog ON device_file_index(catalog_id)")
            print("[OK] device_file_index")

        # ── backup_task ──
        if not has_table(c, "backup_task"):
            c.execute("""CREATE TABLE backup_task (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                catalog_id INTEGER,
                device_id INTEGER,
                file_index_id INTEGER,
                fingerprint TEXT DEFAULT '',
                size INTEGER DEFAULT 0,
                state TEXT DEFAULT 'pending',
                attempts INTEGER DEFAULT 0,
                error_msg TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                done_at TEXT
            )""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_bt_state ON backup_task(state)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_bt_catalog ON backup_task(catalog_id)")
            print("[OK] backup_task")

        # ── 配对码表（内存级，重启失效，用 config 表存）──
        # config key: device_pair_code → json{"code":"ABCD12","expires":"..."}
        # 无需单独建表，已有 config 通用键值表

        # ── FK 检查 ──
        fk_count = c.execute("PRAGMA foreign_keys").fetchone()[0]
        print("[FK]", fk_count, "(0=off, app层手动级联)")

        c.commit()
        print("[OK] Phase35.3 迁移完成")
    finally:
        c.close()

if __name__ == "__main__":
    main()
