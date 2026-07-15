# -*- coding: utf-8 -*-
"""
Phase35.0 迁移 — 多用户工作空间 + 项目空间 + 文件夹预设 + 中心资产索引(catalog)

安全原则：纯增量、幂等、可重复执行；执行前自动 VACUUM INTO 快照备份。
不删除/不重构现有表；master_project 仅追加一个可空 workspace_id 并回填默认公共空间。
"""
import os, sys, sqlite3, json, time

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
DATA_DIR = os.path.join(HERE, "..", "data")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

# 系统内置「影视/短视频项目」7 段预设（可后续在 UI 完善）
SYSTEM_PRESET = {
    "name": "影视/短视频项目",
    "description": "标准创作流程目录：剧本→角色→场景→分镜→素材→输出→归档",
    "structure": [
        "01_剧本脚本", "02_角色设定", "03_场景设定", "04_分镜提示词",
        "05_参考素材", "05_参考素材/图片", "05_参考素材/视频", "05_参考素材/音频",
        "06_成片输出", "07_归档",
    ],
}


def _has_col(c, table, col):
    try:
        return any(r[1] == col for r in c.execute(f"PRAGMA table_info({table})"))
    except Exception:
        return False


def _table_exists(c, name):
    return c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [name]).fetchone() is not None


def main():
    if not os.path.exists(DB):
        print("[ERR] 数据库不存在:", DB); sys.exit(1)
    os.makedirs(BACKUP_DIR, exist_ok=True)

    # 1) 备份快照（VACUUM INTO 生成一致性单文件）
    stamp = time.strftime("%Y%m%d_%H%M%S")
    bak = os.path.join(BACKUP_DIR, f"phase35_pre_{stamp}.db")
    src = sqlite3.connect(DB, timeout=10)
    try:
        src.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        src.execute("VACUUM INTO ?", [bak])
        print(f"[OK] 备份快照 -> {bak}")
    except Exception as e:
        print(f"[WARN] VACUUM INTO 备份失败({e})，改用文件复制")
        import shutil; shutil.copy2(DB, bak)
    finally:
        src.close()

    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    try:
        # 2) 新表（IF NOT EXISTS，幂等）
        c.executescript("""
        CREATE TABLE IF NOT EXISTS user_workspace (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER,
            name TEXT NOT NULL DEFAULT '我的工作空间',
            description TEXT DEFAULT '',
            location TEXT NOT NULL DEFAULT 'server',   -- 'server'(主盘/共享) | 'device'(各自设备盘)
            storage_root TEXT DEFAULT '',              -- server 位置的磁盘根；device 位置由代理/客户端提供
            device_label TEXT DEFAULT '',              -- device 位置的设备标识
            preset_id INTEGER,
            visibility TEXT NOT NULL DEFAULT 'private', -- 'private' | 'shared'
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_ws_owner ON user_workspace(owner_user_id);

        CREATE TABLE IF NOT EXISTS folder_preset (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER,                     -- NULL=系统内置
            name TEXT NOT NULL DEFAULT '',
            description TEXT DEFAULT '',
            structure_json TEXT NOT NULL DEFAULT '[]', -- 相对路径列表(支持 a/b 嵌套)
            is_system INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS project_space (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id INTEGER NOT NULL,
            owner_user_id INTEGER,
            name TEXT NOT NULL DEFAULT '未命名项目',
            description TEXT DEFAULT '',
            project_root TEXT DEFAULT '',              -- 相对 workspace.storage_root 或设备端根
            preset_id INTEGER,
            status TEXT NOT NULL DEFAULT 'active',      -- active|archived
            cover_thumb TEXT DEFAULT '',
            visibility TEXT NOT NULL DEFAULT 'private',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_ps_ws ON project_space(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_ps_owner ON project_space(owner_user_id);

        CREATE TABLE IF NOT EXISTS asset_catalog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_space_id INTEGER,
            workspace_id INTEGER,
            owner_user_id INTEGER,
            fingerprint TEXT DEFAULT '',               -- sha256，用于查重/去重
            perceptual_hash TEXT DEFAULT '',           -- 可选，图像相似
            filename TEXT DEFAULT '',
            ext TEXT DEFAULT '',
            size INTEGER DEFAULT 0,
            media_type TEXT DEFAULT '',                -- image|video|audio|project_file|other
            project_file_type TEXT DEFAULT '',         -- c4d|ae|ps|...
            origin_device TEXT DEFAULT '',             -- 原始文件所在设备
            local_rel_path TEXT DEFAULT '',            -- 该设备上相对 project_root 的路径
            thumb_path TEXT DEFAULT '',                -- 服务器端小缩略图(跨设备可浏览)
            status TEXT NOT NULL DEFAULT 'present',      -- present|missing|archived
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            indexed_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_cat_fp ON asset_catalog(fingerprint);
        CREATE INDEX IF NOT EXISTS idx_cat_ps ON asset_catalog(project_space_id);
        CREATE INDEX IF NOT EXISTS idx_cat_owner ON asset_catalog(owner_user_id);
        """)
        print("[OK] 新表已就绪: user_workspace / folder_preset / project_space / asset_catalog")

        # 3) master_project 追加 workspace_id（可空）
        if _table_exists(c, "master_project") and not _has_col(c, "master_project", "workspace_id"):
            c.execute("ALTER TABLE master_project ADD COLUMN workspace_id INTEGER")
            print("[OK] master_project 追加列 workspace_id")
        else:
            print("[SKIP] master_project.workspace_id 已存在或表不存在")

        # 4) 系统内置预设（按 name+is_system 幂等）
        row = c.execute("SELECT id FROM folder_preset WHERE name=? AND is_system=1", [SYSTEM_PRESET["name"]]).fetchone()
        if row:
            preset_id = row["id"]
            print(f"[SKIP] 系统预设已存在 id={preset_id}")
        else:
            c.execute(
                "INSERT INTO folder_preset (owner_user_id,name,description,structure_json,is_system) VALUES (NULL,?,?,?,1)",
                [SYSTEM_PRESET["name"], SYSTEM_PRESET["description"], json.dumps(SYSTEM_PRESET["structure"], ensure_ascii=False)])
            preset_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            print(f"[OK] 写入系统预设 id={preset_id}")

        # 5) 默认公共工作空间（server 盘/共享），幂等
        drow = c.execute("SELECT id FROM user_workspace WHERE is_default=1").fetchone()
        if drow:
            default_ws = drow["id"]
            print(f"[SKIP] 默认公共工作空间已存在 id={default_ws}")
        else:
            server_root = os.path.abspath(DATA_DIR)
            c.execute(
                """INSERT INTO user_workspace
                   (owner_user_id,name,description,location,storage_root,preset_id,visibility,is_default)
                   VALUES (NULL,?,?, 'server', ?, ?, 'shared', 1)""",
                ["默认公共工作空间", "承载历史全局数据与共享项目（服务器主盘）", server_root, preset_id])
            default_ws = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            print(f"[OK] 创建默认公共工作空间 id={default_ws} root={server_root}")

        # 6) 回填 master_project.workspace_id → 默认公共空间
        if _table_exists(c, "master_project"):
            n = c.execute("UPDATE master_project SET workspace_id=? WHERE workspace_id IS NULL", [default_ws]).rowcount
            print(f"[OK] 回填 master_project.workspace_id={default_ws}：{n} 行")

        c.commit()

        # 7) 摘要
        print("\n==== 迁移摘要 ====")
        for t in ["user_workspace", "folder_preset", "project_space", "asset_catalog"]:
            print(f"  {t}: {c.execute(f'SELECT COUNT(1) FROM {t}').fetchone()[0]} 行")
        fk = c.execute("PRAGMA foreign_key_check").fetchall()
        print(f"  foreign_key_check violations: {len(fk)}")
        print("[DONE] Phase35.0 迁移完成")
    finally:
        c.close()


if __name__ == "__main__":
    main()
