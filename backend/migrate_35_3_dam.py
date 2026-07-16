# -*- coding: utf-8 -*-
"""
Phase35.3-DAM 深度归档迁移 — 幂等，快照
扩展 asset_catalog + 新表 blob_store / project_snapshot / archive_policy
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
    # ── 快照 ──
    fk = os.path.join(BK, "phase35_3_dam_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
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
        # ════════════════════════════════════════
        # 1. asset_catalog 补充归档列
        # ════════════════════════════════════════
        ac_cols = [
            ("archive_path",      "TEXT DEFAULT ''",        "压缩存档路径（master/xxx.lzma）"),
            ("compression",       "TEXT DEFAULT ''",        "压缩方式: none|lzma|flac|webp_lossless|webp_q85"),
            ("compressed_size",   "INTEGER DEFAULT 0",      "压缩后字节数"),
            ("original_size",     "INTEGER DEFAULT 0",      "归档时原始字节数"),
            ("proxy_path",        "TEXT DEFAULT ''",        "代理文件路径"),
            ("proxy_type",        "TEXT DEFAULT ''",        "代理类型: thumb|video_proxy|audio_proxy"),
            ("frozen",            "INTEGER DEFAULT 0",      "1=已归档只读，不可覆盖"),
            ("metadata_json",     "TEXT DEFAULT ''",        "技术元数据 JSON"),
            ("source_device_id",  "INTEGER DEFAULT 0",      "来源设备 ID"),
            ("source_path",       "TEXT DEFAULT ''",        "原始位置路径（追溯用）"),
            ("blob_hash",         "TEXT DEFAULT ''",        "blob_store 内容寻址 hash"),
        ]
        for col_name, col_ddl, _comment in ac_cols:
            if not has_col(c, "asset_catalog", col_name):
                c.execute(f"ALTER TABLE asset_catalog ADD COLUMN {col_name} {col_ddl}")
                print("[OK] asset_catalog +=", col_name)

        # 回填：已有 backup_path 且非空的，标记 frozen=1
        c.execute("UPDATE asset_catalog SET frozen=1 WHERE backup_path IS NOT NULL AND backup_path != ''")
        # 回填 original_size（用 size 列）
        c.execute("UPDATE asset_catalog SET original_size=size WHERE original_size=0 AND size>0")
        print("[OK] 回填 frozen/original_size")

        # ════════════════════════════════════════
        # 2. blob_store — 全局内容寻址去重存储
        # ════════════════════════════════════════
        if not has_table(c, "blob_store"):
            c.execute("""CREATE TABLE blob_store (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blob_hash TEXT NOT NULL UNIQUE,
                compressed_size INTEGER DEFAULT 0,
                original_size INTEGER DEFAULT 0,
                compression TEXT DEFAULT '',
                ref_count INTEGER DEFAULT 0,
                storage_tier TEXT DEFAULT 'hot',
                storage_path TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                last_accessed_at TEXT DEFAULT (datetime('now','localtime'))
            )""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_blob_hash ON blob_store(blob_hash)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_blob_tier ON blob_store(storage_tier)")
            print("[OK] blob_store")

        # ════════════════════════════════════════
        # 3. project_snapshot — 项目时间点快照
        # ════════════════════════════════════════
        if not has_table(c, "project_snapshot"):
            c.execute("""CREATE TABLE project_snapshot (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_space_id INTEGER NOT NULL,
                name TEXT DEFAULT '',
                asset_version_map TEXT DEFAULT '{}',
                created_by INTEGER,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (project_space_id) REFERENCES project_space(id) ON DELETE CASCADE
            )""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_psnap_project ON project_snapshot(project_space_id, created_at)")
            print("[OK] project_snapshot")

        # ════════════════════════════════════════
        # 4. archive_policy — 归档策略配置（全局+按项目覆盖）
        # ════════════════════════════════════════
        if not has_table(c, "archive_policy"):
            c.execute("""CREATE TABLE archive_policy (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_space_id INTEGER,
                compression_level TEXT DEFAULT 'standard',
                generate_proxy INTEGER DEFAULT 1,
                video_proxy INTEGER DEFAULT 1,
                image_thumb INTEGER DEFAULT 1,
                audio_proxy INTEGER DEFAULT 0,
                version_retention TEXT DEFAULT 'all',
                version_max_count INTEGER DEFAULT 0,
                storage_limit_gb REAL DEFAULT 100,
                auto_archive_enabled INTEGER DEFAULT 0,
                auto_archive_rules_json TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            )""")
            # 插入默认全局策略
            c.execute("INSERT INTO archive_policy(project_space_id,compression_level) VALUES(NULL,'standard')")
            print("[OK] archive_policy")

        # ════════════════════════════════════════
        # 5. agent_local_cache — Agent 本地缓存记录（注册时用）
        # ════════════════════════════════════════
        # 实际 SQLite 文件在 Agent 端，服务器只记录上次全量上报的时间戳
        if not has_col(c, "device", "last_full_scan_at"):
            c.execute("ALTER TABLE device ADD COLUMN last_full_scan_at TEXT DEFAULT ''")
            c.execute("ALTER TABLE device ADD COLUMN indexed_file_count INTEGER DEFAULT 0")
            print("[OK] device += last_full_scan_at, indexed_file_count")

        # ════════════════════════════════════════
        # 6. 通知表（已有 sys_notifications? 检查）
        # ════════════════════════════════════════
        if not has_table(c, "sys_notifications"):
            c.execute("""CREATE TABLE sys_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                title TEXT DEFAULT '',
                message TEXT DEFAULT '',
                category TEXT DEFAULT 'info',
                target_type TEXT DEFAULT '',
                target_id INTEGER DEFAULT 0,
                is_read INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_notify_user ON sys_notifications(user_id, is_read)")
            print("[OK] sys_notifications")

        # ── FK ──
        fk_count = c.execute("PRAGMA foreign_keys").fetchone()[0]
        print("[FK]", fk_count, "(0=off, app层手动级联)")

        c.commit()
        print("[OK] Phase35.3-DAM 迁移完成")
    finally:
        c.close()

if __name__ == "__main__":
    main()
