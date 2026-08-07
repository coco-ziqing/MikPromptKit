"""
Phase18 统一数据库迁移脚本 — 插件框架 + 多用户预埋 + 表骨架
版本: v5.1.0-phase18
幂等性: 所有操作均可安全重复执行（IF NOT EXISTS / ALTER IGNORE）
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from database import get_db, safe_commit


def _execute_safe(db, sql, desc=""):
    """执行SQL，忽略预期的错误（如重复建表、重复加列）"""
    try:
        db.execute(sql)
        if desc:
            print(f"  [OK] {desc}")
    except Exception as e:
        err = str(e).lower()
        # 这些错误是幂等操作预期的
        if any(x in err for x in ['already exists', 'duplicate column', 'duplicate key',
                                    'duplicate index', 'unique constraint', 'already has']):
            if desc:
                print(f"  [SKIP] {desc} (已存在)")
        else:
            print(f"  [WARN] {desc}: {e}")


# ================================================================
# 1. 插件系统表
# ================================================================

PLUGIN_TABLES = {
    "plugin_registry": """
        CREATE TABLE IF NOT EXISTS plugin_registry (
            plugin_id       TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            version         TEXT NOT NULL DEFAULT '1.0.0',
            enabled         INTEGER NOT NULL DEFAULT 0,
            license_tier    TEXT NOT NULL DEFAULT 'free',
            config_json     TEXT DEFAULT '{}',
            installed_at    TEXT,
            last_migration  TEXT,
            updated_at      TEXT
        )
    """,

    "plugin_migrations": """
        CREATE TABLE IF NOT EXISTS plugin_migrations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            plugin_id       TEXT NOT NULL,
            migration_name  TEXT NOT NULL,
            applied_at      TEXT NOT NULL,
            checksum        TEXT,
            UNIQUE(plugin_id, migration_name)
        )
    """,

    "plugin_licenses": """
        CREATE TABLE IF NOT EXISTS plugin_licenses (
            plugin_id           TEXT PRIMARY KEY,
            license_key_enc     TEXT NOT NULL,       -- AES-256-GCM 加密存储
            activated_at        TEXT,
            expires_at          TEXT,                -- NULL = 买断永不过期
            machine_hash        TEXT,                -- 机器指纹 SHA256
            signature           TEXT,                -- RSA-SHA256 签名
            license_tier        TEXT DEFAULT 'free',
            seat_count          INTEGER DEFAULT 1,
            last_verify_at      TEXT,
            verify_fail_count   INTEGER DEFAULT 0
        )
    """,

    "plugin_configs": """
        CREATE TABLE IF NOT EXISTS plugin_configs (
            plugin_id   TEXT NOT NULL,
            config_key  TEXT NOT NULL,
            config_value TEXT,
            updated_at  TEXT,
            PRIMARY KEY (plugin_id, config_key)
        )
    """,
}


# ================================================================
# 2. 用户系统预埋表
# ================================================================

USER_TABLES = {
    "users": """
        CREATE TABLE IF NOT EXISTS users (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            username        TEXT UNIQUE NOT NULL,
            password_hash   TEXT NOT NULL,            -- bcrypt/argon2
            display_name    TEXT DEFAULT '',
            role            TEXT DEFAULT 'editor',    -- admin / editor / viewer
            avatar_color    TEXT DEFAULT '#6366f1',    -- 自动生成头像颜色
            is_active       INTEGER DEFAULT 1,
            settings_json   TEXT DEFAULT '{}',         -- {theme, language, column_count}
            created_at      TEXT,
            last_login_at   TEXT
        )
    """,

    "user_sessions": """
        CREATE TABLE IF NOT EXISTS user_sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            token           TEXT UNIQUE NOT NULL,      -- JWT token
            client_ip       TEXT,
            user_agent      TEXT,
            created_at      TEXT,
            expires_at      TEXT,
            is_active       INTEGER DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """,
}


# ================================================================
# 3. 项目管理表骨架（仅DDL，功能Phase19实现）
# ================================================================

PROJECT_TABLES = {
    "projects": """
        CREATE TABLE IF NOT EXISTS projects (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            description     TEXT DEFAULT '',
            status          TEXT DEFAULT 'active',     -- active / archived / completed
            template_id     INTEGER,
            owner_user_id   INTEGER,
            cover_image     TEXT,                      -- 封面缩略图路径
            progress_pct    INTEGER DEFAULT 0,         -- 进度百分比 0-100
            deadline        TEXT,                      -- 截止日期 ISO8601
            settings_json   TEXT DEFAULT '{}',          -- 项目设置JSON
            created_at      TEXT,
            updated_at      TEXT
        )
    """,

    "project_columns": """
        CREATE TABLE IF NOT EXISTS project_columns (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      INTEGER NOT NULL,
            name            TEXT NOT NULL,              -- 列名: "概念阶段", "制作中"
            color           TEXT DEFAULT '#6b7280',     -- 列颜色
            sort_order      INTEGER DEFAULT 0,
            created_at      TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    """,

    "project_tasks": """
        CREATE TABLE IF NOT EXISTS project_tasks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      INTEGER NOT NULL,
            column_id       INTEGER,
            title           TEXT NOT NULL,
            description     TEXT DEFAULT '',
            assignee_id     INTEGER,                   -- 负责人 user_id
            priority        INTEGER DEFAULT 0,         -- 0=普通 1=高 2=紧急
            status          TEXT DEFAULT 'pending',     -- pending / in_progress / done
            due_date        TEXT,
            sort_order      INTEGER DEFAULT 0,
            completed_at    TEXT,
            created_at      TEXT,
            updated_at      TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    """,

    "task_prompt_refs": """
        CREATE TABLE IF NOT EXISTS task_prompt_refs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id         INTEGER NOT NULL,
            ref_type        TEXT NOT NULL,              -- word_card / prompt_card / atom
            ref_id          INTEGER NOT NULL,
            created_at      TEXT,
            FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE
        )
    """,

    "project_templates": """
        CREATE TABLE IF NOT EXISTS project_templates (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            description     TEXT DEFAULT '',
            is_builtin      INTEGER DEFAULT 1,         -- 内置模板
            template_json   TEXT NOT NULL,              -- 完整项目结构JSON
            sort_order      INTEGER DEFAULT 0,
            created_at      TEXT
        )
    """,

    "project_milestones": """
        CREATE TABLE IF NOT EXISTS project_milestones (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      INTEGER NOT NULL,
            title           TEXT NOT NULL,
            description     TEXT DEFAULT '',
            due_date        TEXT,
            completed_at    TEXT,
            sort_order      INTEGER DEFAULT 0,
            created_at      TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    """,
}


# ================================================================
# 4. 资产管理表骨架（仅DDL，功能Phase20实现）
# ================================================================

ASSET_TABLES = {
    "project_assets": """
        CREATE TABLE IF NOT EXISTS project_assets (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            filename        TEXT NOT NULL,
            original_filename TEXT,
            file_path       TEXT NOT NULL,
            file_size       INTEGER DEFAULT 0,
            media_type      TEXT DEFAULT 'image',       -- image / video / audio / other
            mime_type       TEXT,
            width           INTEGER,
            height          INTEGER,
            duration        REAL,                      -- 视频长度(秒)
            file_hash       TEXT,                      -- SHA256 文件哈希
            project_id      INTEGER,
            owner_user_id   INTEGER,
            rating          INTEGER DEFAULT 0,         -- 1-5 评分
            notes           TEXT DEFAULT '',
            gen_prompt      TEXT,                      -- 生成时使用的提示词
            gen_model       TEXT,                      -- 生成模型: SDXL/Flux/Midjourney
            gen_params_json TEXT DEFAULT '{}',          -- 生成参数JSON
            version_chain   TEXT,                      -- 版本链: [v1_id, v2_id]
            is_deleted      INTEGER DEFAULT 0,
            created_at      TEXT,
            updated_at      TEXT
        )
    """,

    "asset_tags": """
        CREATE TABLE IF NOT EXISTS asset_tags (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id        INTEGER NOT NULL,
            tag             TEXT NOT NULL,
            created_at      TEXT,
            FOREIGN KEY (asset_id) REFERENCES project_assets(id) ON DELETE CASCADE
        )
    """,

    "asset_prompt_ref": """
        CREATE TABLE IF NOT EXISTS asset_prompt_ref (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id        INTEGER NOT NULL,
            ref_type        TEXT NOT NULL,              -- word_card / prompt_card
            ref_id          INTEGER NOT NULL,
            created_at      TEXT,
            FOREIGN KEY (asset_id) REFERENCES project_assets(id) ON DELETE CASCADE
        )
    """,

    "asset_versions": """
        CREATE TABLE IF NOT EXISTS asset_versions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id        INTEGER NOT NULL,
            version         INTEGER NOT NULL DEFAULT 1,
            file_path       TEXT NOT NULL,
            file_hash       TEXT,
            notes           TEXT DEFAULT '',
            created_at      TEXT,
            FOREIGN KEY (asset_id) REFERENCES project_assets(id) ON DELETE CASCADE
        )
    """,

    "asset_ratings": """
        CREATE TABLE IF NOT EXISTS asset_ratings (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id        INTEGER NOT NULL,
            user_id         INTEGER NOT NULL,
            rating          INTEGER NOT NULL,           -- 1-5
            created_at      TEXT,
            UNIQUE(asset_id, user_id),
            FOREIGN KEY (asset_id) REFERENCES project_assets(id) ON DELETE CASCADE
        )
    """,

    "asset_duplicates": """
        CREATE TABLE IF NOT EXISTS asset_duplicates (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id        INTEGER NOT NULL,
            duplicate_of    INTEGER NOT NULL,           -- 指向原始资产
            detected_at     TEXT,
            FOREIGN KEY (asset_id) REFERENCES project_assets(id) ON DELETE CASCADE
        )
    """,
}


# ================================================================
# 5. 团队协作表骨架（仅DDL，功能Phase21实现）
# ================================================================

TEAM_TABLES = {
    "project_members": """
        CREATE TABLE IF NOT EXISTS project_members (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      INTEGER NOT NULL,
            user_id         INTEGER NOT NULL,
            role            TEXT DEFAULT 'viewer',       -- admin / editor / viewer / reviewer
            joined_at       TEXT,
            UNIQUE(project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    """,

    "comments": """
        CREATE TABLE IF NOT EXISTS comments (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            target_type     TEXT NOT NULL,              -- word_card / task / asset / project
            target_id       INTEGER NOT NULL,
            user_id         INTEGER NOT NULL,
            parent_id       INTEGER,                   -- 回复的评论ID
            content         TEXT NOT NULL,
            created_at      TEXT,
            updated_at      TEXT,
            is_deleted      INTEGER DEFAULT 0
        )
    """,

    "review_requests": """
        CREATE TABLE IF NOT EXISTS review_requests (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      INTEGER NOT NULL,
            submitter_id    INTEGER NOT NULL,
            reviewer_id     INTEGER NOT NULL,
            target_type     TEXT DEFAULT 'project',     -- project / asset
            target_id       INTEGER,
            status          TEXT DEFAULT 'pending',     -- pending / approved / rejected
            feedback        TEXT DEFAULT '',
            submitted_at    TEXT,
            reviewed_at     TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    """,

    "activity_feed": """
        CREATE TABLE IF NOT EXISTS activity_feed (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER,
            action          TEXT NOT NULL,              -- create / update / delete / comment / review
            target_type     TEXT,                       -- word_card / project / task / asset
            target_id       INTEGER,
            target_name     TEXT,
            detail_json     TEXT DEFAULT '{}',
            project_id      INTEGER,
            created_at      TEXT
        )
    """,

    "operation_log": """
        CREATE TABLE IF NOT EXISTS operation_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER,
            target_table    TEXT NOT NULL,
            target_id       INTEGER,
            operation       TEXT NOT NULL,              -- INSERT / UPDATE / DELETE
            change_json     TEXT DEFAULT '{}',          -- 变更前后数据
            vector_clock    TEXT DEFAULT '{}',           -- CRDT 向量时钟 (Phase21)
            session_id      TEXT,
            created_at      TEXT
        )
    """,

    "notification_queue": """
        CREATE TABLE IF NOT EXISTS notification_queue (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            type            TEXT NOT NULL,              -- comment / review / mention / deadline
            title           TEXT,
            body            TEXT,
            target_url      TEXT,                      -- 点击跳转的URL片段
            is_read         INTEGER DEFAULT 0,
            created_at      TEXT,
            read_at         TEXT
        )
    """,
}


# ================================================================
# 6. 旧表 ALTER 加 owner_user_id
# ================================================================

OWNER_COLUMN_ALTERS = [
    "ALTER TABLE word_card ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE prompt_cards ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE collections ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE wordpacks ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE user_project ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE library_assets ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE character_profiles ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE scene_profiles ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE atom_decompose ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE media_assets ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE prompt_versions ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    "ALTER TABLE translations ADD COLUMN owner_user_id INTEGER DEFAULT NULL",
    # 审计日志扩展
    "ALTER TABLE user_actions ADD COLUMN plugin_id TEXT DEFAULT NULL",
    "ALTER TABLE user_actions ADD COLUMN actor_id INTEGER DEFAULT NULL",
]

OWNER_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_wc_owner ON word_card(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_pc_owner ON prompt_cards(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_col_owner ON collections(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_wp_owner ON wordpacks(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_up_owner ON user_project(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_la_owner ON library_assets(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_cp_owner ON character_profiles(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_sp_owner ON scene_profiles(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_ad_owner ON atom_decompose(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_ma_owner ON media_assets(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_ua_plugin ON user_actions(plugin_id)",
    "CREATE INDEX IF NOT EXISTS idx_ua_actor ON user_actions(actor_id)",
    # 插件系统索引
    "CREATE INDEX IF NOT EXISTS idx_pm_plugin ON plugin_migrations(plugin_id)",
    "CREATE INDEX IF NOT EXISTS idx_op_log_user ON operation_log(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_op_log_target ON operation_log(target_table, target_id)",
    # activity_feed 索引（列存才建，兼容旧表缺 project_id 的版本）
    "CREATE INDEX IF NOT EXISTS idx_af_project ON activity_feed(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_af_user ON activity_feed(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_af_created ON activity_feed(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_pa_project ON project_assets(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_pa_hash ON project_assets(file_hash)",
    "CREATE INDEX IF NOT EXISTS idx_pa_media ON project_assets(media_type)",
    "CREATE INDEX IF NOT EXISTS idx_pt_project ON project_tasks(project_id, column_id)",
    "CREATE INDEX IF NOT EXISTS idx_nq_user ON notification_queue(user_id, is_read)",
]

# 需要先检查列存在再建索引的表/列映射
INDEX_COL_CHECK = {
    "idx_af_project": ("activity_feed", "project_id"),
    "idx_pt_project": ("project_tasks", "project_id"),
    "idx_pa_project": ("project_assets", "project_id"),
    "idx_nq_user": ("notification_queue", "user_id"),
}


# ================================================================
# 7. 种子数据
# ================================================================

def seed_default_admin(db):
    """插入默认管理员用户（个人版跳过登录，此处仅预埋）"""
    _execute_safe(db, """
        INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, is_active, created_at)
        VALUES (1, 'admin', '', '管理员', 'admin', 1, datetime('now'))
    """, "默认管理员 seed")


def seed_system_config(db):
    """系统配置初始化"""
    _execute_safe(db, """
        INSERT OR IGNORE INTO plugin_registry (plugin_id, name, version, enabled, license_tier, installed_at)
        VALUES ('com.promptkit.core', 'PromptKit Core', '5.1.0', 1, 'free', datetime('now'))
    """, "核心插件注册")


# ================================================================
# 主迁移入口
# ================================================================

def run_migration(db=None):
    """
    执行所有 Phase18 迁移。
    幂等：可安全重复执行。
    
    返回: dict {tables_created: int, columns_altered: int, indexes_created: int}
    """
    if db is None:
        db = get_db()

    print("[Phase18] 开始数据库迁移...")
    start_time = time.time()

    tables_created = 0
    columns_altered = 0
    indexes_created = 0

    # ---- 1. 插件系统表 ----
    print("\n  --- 插件系统表 ---")
    for name, sql in PLUGIN_TABLES.items():
        _execute_safe(db, sql, f"建表 {name}")
        tables_created += 1

    # ---- 2. 用户系统表 ----
    print("\n  --- 用户系统表 ---")
    for name, sql in USER_TABLES.items():
        _execute_safe(db, sql, f"建表 {name}")
        tables_created += 1

    # ---- 3. 项目管理表 ----
    print("\n  --- 项目管理表 ---")
    for name, sql in PROJECT_TABLES.items():
        _execute_safe(db, sql, f"建表 {name}")
        tables_created += 1

    # ---- 4. 资产管理表 ----
    print("\n  --- 资产管理表 ---")
    for name, sql in ASSET_TABLES.items():
        _execute_safe(db, sql, f"建表 {name}")
        tables_created += 1

    # ---- 5. 团队协作表 ----
    print("\n  --- 团队协作表 ---")
    for name, sql in TEAM_TABLES.items():
        _execute_safe(db, sql, f"建表 {name}")
        tables_created += 1

    # ---- 6. ALTER 旧表加列 ----
    print("\n  --- 旧表字段扩展 ---")
    for sql in OWNER_COLUMN_ALTERS:
        _execute_safe(db, sql)
        columns_altered += 1

    # 2026-08-02 修复: users 表缺列（phone/email/wechat）→ /auth/me 500 → 登录后弹回封面
    # v5.26 团队空间升级新增的个人资料列，旧库（含恢复的备份）缺此迁移
    for col, typ in [
        ("phone",       "TEXT DEFAULT ''"),
        ("email",       "TEXT DEFAULT ''"),
        ("wechat",      "TEXT DEFAULT ''"),
        ("avatar_url",  "TEXT DEFAULT ''"),
        ("bio",         "TEXT DEFAULT ''"),
        ("website",     "TEXT DEFAULT ''"),
        ("cover_url",   "TEXT DEFAULT ''"),
    ]:
        try:
            cols = [c[1] for c in db.execute("PRAGMA table_info(users)").fetchall()]
            if col not in cols:
                db.execute(f"ALTER TABLE users ADD COLUMN {col} {typ}")
                columns_altered += 1
                print(f"  [OK] users 补列 {col}")
        except Exception:
            pass

    # ---- 7. 索引 ----
    print("\n  --- 索引创建 ---")
    for sql in OWNER_INDEXES:
        # 提取索引名，检查所属表的列是否存在
        import re as _re
        match = _re.search(r'idx_\w+', sql)
        if match and match.group() in INDEX_COL_CHECK:
            tbl, col = INDEX_COL_CHECK[match.group()]
            cols = [c[1] for c in db.execute(f"PRAGMA table_info({tbl})").fetchall()]
            if col not in cols:
                if desc := INDEX_COL_CHECK.get(match.group()): pass  # noop
                continue  # 列不存在，跳过此索引
        _execute_safe(db, sql)
        indexes_created += 1

    # ---- 8. 种子数据 ----
    print("\n  --- 种子数据 ---")
    seed_default_admin(db)
    seed_system_config(db)

    safe_commit()

    elapsed = time.time() - start_time
    result = {
        "tables_created": tables_created,
        "columns_altered": columns_altered,
        "indexes_created": indexes_created,
        "elapsed_ms": round(elapsed * 1000),
    }
    print(f"\n[Phase18] 迁移完成! {result} ({elapsed:.2f}s)")
    return result


# ================================================================
# CLI 入口
# ================================================================

if __name__ == "__main__":
    print("PromptKit Phase18 数据库迁移")
    print("=" * 50)
    result = run_migration()
    print("\n迁移摘要:")
    print(f"  新建表: {result['tables_created']}")
    print(f"  字段扩展: {result['columns_altered']}")
    print(f"  索引创建: {result['indexes_created']}")
    print(f"  耗时: {result['elapsed_ms']}ms")
