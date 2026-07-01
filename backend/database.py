"""
数据库模块 — SQLite 初始化与连接管理（加固版）
"""
import sqlite3
import os
import sys
import threading
import time
from paths import get_data_dir, get_db_path
from logger import info as log_info, warn as log_warn, error as log_error

DB_DIR = get_data_dir()
DB_PATH = get_db_path()

_local = threading.local()

# 最大重试次数（WAL 模式下写冲突极少，但兜底）
_MAX_RETRIES = 3
_RETRY_DELAY = 0.05


def get_db():
    """获取当前线程的数据库连接（惰性创建）"""
    if not hasattr(_local, "conn") or _local.conn is None:
        try:
            os.makedirs(DB_DIR, exist_ok=True)
            conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA synchronous=NORMAL")   # WAL 模式下 NORMAL 足够安全且更快
            conn.execute("PRAGMA busy_timeout=5000")     # 忙等待 5 秒
            _local.conn = conn
        except sqlite3.Error as e:
            log_error(f"[DB] 连接失败: {e}", source="database")
            raise
    return _local.conn


def close_db():
    """安全关闭当前线程的数据库连接"""
    if hasattr(_local, "conn") and _local.conn:
        try:
            _local.conn.close()
        except sqlite3.Error:
            pass
        _local.conn = None


def safe_execute(sql, params=None, commit=False):
    """
    安全执行 SQL（带重试机制）
    返回 sqlite3.Cursor 或 None
    """
    for attempt in range(_MAX_RETRIES):
        try:
            db = get_db()
            if params is not None:
                cur = db.execute(sql, params)
            else:
                cur = db.execute(sql)
            if commit:
                db.commit()
            return cur
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() or "busy" in str(e).lower():
                if attempt < _MAX_RETRIES - 1:
                    time.sleep(_RETRY_DELAY * (attempt + 1))
                    continue
            log_error(f"[DB] 执行失败: {e}", source="database")
            return None
        except sqlite3.Error as e:
            log_error(f"[DB] 错误: {e}", source="database")
            return None


def safe_commit():
    """安全提交事务（WAL 模式下自动重试锁冲突）"""
    import time as _time
    db = get_db()
    for attempt in range(10):
        try:
            db.commit()
            return True
        except sqlite3.OperationalError as e:
            if ('locked' in str(e).lower() or 'busy' in str(e).lower()) and attempt < 9:
                _time.sleep(0.3 * (attempt + 1))
                continue
            log_error(f"[DB] 提交失败: {e}", source="database")
            return False
        except sqlite3.Error as e:
            log_error(f"[DB] 提交失败: {e}", source="database")
            return False
    return False



def safe_fetch_one(sql, params=None):
    """安全取首条记录：表空返回 None，避免 fetchone()[0] / ['key'] 崩溃"""
    cur = safe_execute(sql, params)
    if cur is None:
        return None
    row = cur.fetchone()
    return row if row else None

def safe_count(sql, params=None, default=0):
    """安全取计数：兜底返回 default"""
    cur = safe_execute(sql, params)
    if cur is None:
        return default
    row = cur.fetchone()
    return row[0] if row else default

def safe_count_dict(sql, params=None, key="cnt", default=0):
    """安全取字典计数：兜底返回 default"""
    cur = safe_execute(sql, params)
    if cur is None:
        return default
    row = cur.fetchone()
    return row[key] if row else default

def init_db():
    """建表（幂等 + 事务保护）"""
    conn = get_db()
    try:
        conn.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;

            CREATE TABLE IF NOT EXISTS prompts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                module      TEXT    NOT NULL DEFAULT '',
                category    TEXT    NOT NULL DEFAULT '',
                subcategory TEXT    DEFAULT '',
                content     TEXT    NOT NULL DEFAULT '',
                meaning     TEXT    DEFAULT '',
                scene       TEXT    DEFAULT '',
                tags        TEXT    DEFAULT '[]',
                usage_count INTEGER DEFAULT 0,
                is_builtin  INTEGER DEFAULT 1,
                created_at  TEXT    DEFAULT (datetime('now','localtime'))
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
                content, meaning, tags,
                content='prompts', content_rowid='id'
            );

            CREATE TABLE IF NOT EXISTS config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- 媒体资产管理库（统一管理缩略图+原图+视频）
            CREATE TABLE IF NOT EXISTS media_assets (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                filename          TEXT NOT NULL UNIQUE,
                original_filename TEXT DEFAULT '',
                file_size         INTEGER DEFAULT 0,
                original_size     INTEGER DEFAULT 0,
                media_type        TEXT DEFAULT 'image',
                width             INTEGER DEFAULT 0,
                height            INTEGER DEFAULT 0,
                mime_type         TEXT DEFAULT '',
                prompt_id         INTEGER DEFAULT 0,
                source            TEXT DEFAULT 'upload',
                created_at        TEXT DEFAULT (datetime('now','localtime')),
                updated_at        TEXT DEFAULT (datetime('now','localtime'))
            );

            -- thumb_hash + thumb_meta（已有则跳过）
            CREATE TABLE IF NOT EXISTS thumb_hash (
                filename TEXT PRIMARY KEY,
                hash     TEXT NOT NULL,
                size     INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS thumb_meta (
                filename      TEXT PRIMARY KEY,
                original_name TEXT DEFAULT '',
                media_type    TEXT DEFAULT 'image'
            );

            CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
                INSERT INTO prompts_fts(rowid, content, meaning, tags)
                VALUES (new.id, new.content, new.meaning, new.tags);
            END;

            CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
                INSERT INTO prompts_fts(prompts_fts, rowid, content, meaning, tags)
                VALUES ('delete', old.id, old.content, old.meaning, old.tags);
            END;

            CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE ON prompts BEGIN
                INSERT INTO prompts_fts(prompts_fts, rowid, content, meaning, tags)
                VALUES ('delete', old.id, old.content, old.meaning, old.tags);
                INSERT INTO prompts_fts(rowid, content, meaning, tags)
                VALUES (new.id, new.content, new.meaning, new.tags);
            END;

            CREATE TABLE IF NOT EXISTS prompt_thumbnails (
                prompt_id INTEGER PRIMARY KEY,
                filename  TEXT NOT NULL DEFAULT '',
                media_type TEXT DEFAULT 'image',
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS prompt_videos (
                prompt_id INTEGER PRIMARY KEY,
                filename  TEXT NOT NULL DEFAULT '',
                poster     TEXT DEFAULT '',
                duration   REAL DEFAULT 0,
                fps        REAL DEFAULT 0,
                width      INTEGER DEFAULT 0,
                height     INTEGER DEFAULT 0,
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS collections (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT    NOT NULL DEFAULT '',
                icon      TEXT    DEFAULT '\u2b50',
                sort_order INTEGER DEFAULT 0,
                created_at TEXT    DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS collection_items (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL DEFAULT 0,
                prompt_id     INTEGER NOT NULL DEFAULT 0,
                note          TEXT    DEFAULT '',
                added_at      TEXT    DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
                UNIQUE(collection_id, prompt_id)
            );

            CREATE TABLE IF NOT EXISTS wordpacks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL DEFAULT '',
                description TEXT    DEFAULT '',
                sort_order  INTEGER DEFAULT 0,
                created_at  TEXT    DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS wordpack_items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                wordpack_id INTEGER NOT NULL DEFAULT 0,
                prompt_id  INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                added_at   TEXT    DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (wordpack_id) REFERENCES wordpacks(id) ON DELETE CASCADE,
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
                UNIQUE(wordpack_id, prompt_id)
            );

            CREATE TABLE IF NOT EXISTS usage_history (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt_id  INTEGER NOT NULL DEFAULT 0,
                used_at    TEXT    DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
            );
        """)
        # 迁移：为旧表添加 fps/width/height 列
        try:
            conn.execute("ALTER TABLE prompt_videos ADD COLUMN fps REAL DEFAULT 0")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE prompt_videos ADD COLUMN width INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE user_project_scene ADD COLUMN shot_scale TEXT DEFAULT ''")
        except:
            pass
        try:
            conn.execute("ALTER TABLE prompt_videos ADD COLUMN height INTEGER DEFAULT 0")
        except Exception:
            pass
        # 视频缓存表
        try:
            conn.execute("""CREATE TABLE IF NOT EXISTS video_cache (
                filename    TEXT PRIMARY KEY,
                fps         REAL DEFAULT 0,
                width       INTEGER DEFAULT 0,
                height      INTEGER DEFAULT 0,
                duration    REAL DEFAULT 0,
                cover_exists INTEGER DEFAULT 0,
                cached_at   TEXT DEFAULT (datetime('now','localtime'))
            )""")
        except Exception:
            pass
        # 缩略图 hash 缓存表（去重）和元数据表
        try:
            conn.execute("""CREATE TABLE IF NOT EXISTS thumb_hash (
                filename TEXT PRIMARY KEY,
                hash     TEXT NOT NULL,
                size     INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )""")
        except Exception:
            pass
        try:
            conn.execute("""CREATE TABLE IF NOT EXISTS thumb_meta (
                filename      TEXT PRIMARY KEY,
                original_name TEXT NOT NULL DEFAULT '',
                media_type    TEXT DEFAULT 'image',
                created_at    TEXT DEFAULT (datetime('now','localtime'))
            )""")
        except Exception:
            pass
        # collections 表加缩略图字段
        try:
            conn.execute("ALTER TABLE collections ADD COLUMN thumbnail TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE collections ADD COLUMN video_filename TEXT DEFAULT ''")
        except Exception:
            pass
        # prompts 表加回收站标记
        try:
            conn.execute("ALTER TABLE prompts ADD COLUMN deleted_at TEXT DEFAULT NULL")
        except Exception:
            pass
        # 自定义模块表
        try:
            conn.execute("""CREATE TABLE IF NOT EXISTS custom_modules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )""")
        except Exception:
            pass
        # 提示词版本管理表
        try:
            conn.execute("""CREATE TABLE IF NOT EXISTS prompt_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt_id INTEGER NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                meaning TEXT DEFAULT '',
                scene TEXT DEFAULT '',
                module TEXT DEFAULT '',
                category TEXT DEFAULT '',
                subcategory TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                change_note TEXT DEFAULT '',
                version INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
            )""")
        except Exception:
            pass
        # 兼容旧表（prompt_versions 列存在检查）
        try:
            conn.execute("ALTER TABLE prompt_versions ADD COLUMN change_note TEXT DEFAULT ''")
        except Exception:
            pass
        # 兼容旧表（collection_items 加 sort_order）
        try:
            conn.execute("ALTER TABLE collection_items ADD COLUMN sort_order INTEGER DEFAULT 0")
        except Exception:
            pass

        # ========== Seedance V2 多镜头组装器 7 表 ==========
        conn.executescript("""
            -- 1. 系统全局配置
            CREATE TABLE IF NOT EXISTS sys_global_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                config_key TEXT UNIQUE NOT NULL,
                config_value TEXT NOT NULL,
                description TEXT,
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );

            -- 2. 词库总表 (27套维度)
            CREATE TABLE IF NOT EXISTS prompt_library (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dimension_key TEXT UNIQUE NOT NULL,
                dimension_name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'basic',
                sort_order INTEGER DEFAULT 0,
                description TEXT,
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );

            -- 3. 词卡库存
            CREATE TABLE IF NOT EXISTS prompt_word_card (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                library_id INTEGER NOT NULL REFERENCES prompt_library(id),
                word_text TEXT NOT NULL,
                definition TEXT,
                preview_image TEXT,
                preview_video TEXT DEFAULT '',
                heat_weight REAL DEFAULT 0,
                is_system INTEGER DEFAULT 1,
                usage_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );

            -- 4. 用户分镜项目总表
            CREATE TABLE IF NOT EXISTS user_project (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                total_duration INTEGER DEFAULT 15,
                aspect_ratio TEXT DEFAULT '16:9',
                resolution TEXT DEFAULT '4K',
                global_style TEXT,
                global_transition TEXT,
                negative_prompt TEXT,
                bgm TEXT DEFAULT '',
                sfx TEXT DEFAULT '',
                dialogue TEXT DEFAULT '',
                template_id INTEGER DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );

            -- 5. 镜头时间轴表
            CREATE TABLE IF NOT EXISTS user_project_scene (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES user_project(id) ON DELETE CASCADE,
                scene_order INTEGER NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL NOT NULL,
                camera_move TEXT DEFAULT '',
                subject TEXT DEFAULT '',
                scene_desc TEXT DEFAULT '',
                shot_scale TEXT DEFAULT '',
                composition TEXT DEFAULT '',
                lighting TEXT DEFAULT '',
                focal_length TEXT DEFAULT '',
                texture TEXT DEFAULT '',
                speed TEXT DEFAULT '',
                perspective TEXT DEFAULT '',
                particles TEXT DEFAULT '',
                weather TEXT DEFAULT '',
                color_grade TEXT DEFAULT '',
                emotion TEXT DEFAULT '',
                natural_force TEXT DEFAULT '',
                depth_of_field TEXT DEFAULT '',
                filter TEXT DEFAULT '',
                film_flaw TEXT DEFAULT '',
                fantasy_physics TEXT DEFAULT '',
                environment_detail TEXT DEFAULT '',
                action TEXT DEFAULT '',
                details TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );

            -- 6. 镜头-词卡关联表
            CREATE TABLE IF NOT EXISTS user_scene_prompt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scene_id INTEGER NOT NULL REFERENCES user_project_scene(id) ON DELETE CASCADE,
                word_card_id INTEGER NOT NULL REFERENCES prompt_word_card(id),
                dimension_key TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );

            -- 7. 用户自定义词条表
            CREATE TABLE IF NOT EXISTS user_custom_word (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                library_id INTEGER NOT NULL REFERENCES prompt_library(id),
                word_text TEXT NOT NULL,
                definition TEXT,
                preview_image TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );
        """)

        # ========== Phase 1: 统一提示词卡 + 词库资产库 ==========
        conn.executescript("""
            -- 核心提示词卡表 (统一生图/生视频)
            CREATE TABLE IF NOT EXISTS prompt_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_type TEXT NOT NULL DEFAULT 'image',
                name TEXT DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                meaning TEXT DEFAULT '',
                scene TEXT DEFAULT '',
                module TEXT NOT NULL DEFAULT 'custom',
                category TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                structured_fields TEXT DEFAULT '{}',
                version INTEGER DEFAULT 1,
                parent_card_id INTEGER DEFAULT NULL,
                library_refs TEXT DEFAULT '[]',
                usage_count INTEGER DEFAULT 0,
                is_builtin INTEGER DEFAULT 0,
                is_deleted INTEGER DEFAULT 0,
                deleted_at TEXT DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (parent_card_id) REFERENCES prompt_cards(id)
            );

            -- 统一词库资产表
            CREATE TABLE IF NOT EXISTS library_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lib_type TEXT NOT NULL,
                name TEXT NOT NULL,
                icon TEXT DEFAULT '',
                category TEXT DEFAULT '',
                prompt TEXT DEFAULT '',
                definition TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                usage_count INTEGER DEFAULT 0,
                is_builtin INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );

            -- 索引
            CREATE INDEX IF NOT EXISTS idx_prompt_cards_type ON prompt_cards(card_type);
            CREATE INDEX IF NOT EXISTS idx_prompt_cards_module ON prompt_cards(module);
            CREATE INDEX IF NOT EXISTS idx_prompt_cards_deleted ON prompt_cards(is_deleted);
            CREATE INDEX IF NOT EXISTS idx_library_assets_type ON library_assets(lib_type);
            CREATE INDEX IF NOT EXISTS idx_library_assets_builtin ON library_assets(is_builtin);
        """)

        # ========== v4.1.0: 统一词卡表 — 所有词卡模块的单一数据源 ==========
        conn.executescript("""
            -- 词卡组（替代 prompt_library 维库分组）
            CREATE TABLE IF NOT EXISTS word_card_group (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL DEFAULT '',
                group_key       TEXT NOT NULL DEFAULT '',
                icon            TEXT DEFAULT '',
                description     TEXT DEFAULT '',
                group_type      TEXT DEFAULT 'builtin',
                parent_group_id INTEGER DEFAULT NULL,
                sort_order      INTEGER DEFAULT 0,
                is_active       INTEGER DEFAULT 1,
                created_at      TEXT DEFAULT (datetime('now','localtime')),
                updated_at      TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_wcg_type ON word_card_group(group_type);
            CREATE INDEX IF NOT EXISTS idx_wcg_parent ON word_card_group(parent_group_id);

            -- 统一词卡表（唯一数据源）
            CREATE TABLE IF NOT EXISTS word_card (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id        INTEGER DEFAULT NULL,
                name            TEXT NOT NULL DEFAULT '',
                content         TEXT NOT NULL DEFAULT '',
                meaning         TEXT DEFAULT '',
                scene           TEXT DEFAULT '',
                module          TEXT DEFAULT 'custom',
                category        TEXT DEFAULT '',
                tags            TEXT DEFAULT '[]',
                icon            TEXT DEFAULT '',
                thumbnail       TEXT DEFAULT '',
                preview_media   TEXT DEFAULT '',
                media_type      TEXT DEFAULT '',
                structured      TEXT DEFAULT '{}',
                version         INTEGER DEFAULT 1,
                sort_order      INTEGER DEFAULT 0,
                usage_count     INTEGER DEFAULT 0,
                heat_weight     REAL DEFAULT 0,
                is_builtin      INTEGER DEFAULT 0,
                is_deleted      INTEGER DEFAULT 0,
                deleted_at      TEXT DEFAULT NULL,
                source          TEXT DEFAULT '',
                source_id       INTEGER DEFAULT NULL,
                created_at      TEXT DEFAULT (datetime('now','localtime')),
                updated_at      TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (group_id) REFERENCES word_card_group(id)
            );
            CREATE INDEX IF NOT EXISTS idx_wc_group ON word_card(group_id);
            CREATE INDEX IF NOT EXISTS idx_wc_module ON word_card(module);
            CREATE INDEX IF NOT EXISTS idx_wc_deleted ON word_card(is_deleted);
            CREATE INDEX IF NOT EXISTS idx_wc_builtin ON word_card(is_builtin);
            CREATE INDEX IF NOT EXISTS idx_wc_source ON word_card(source, source_id);

            -- FTS5 全文索引
            CREATE VIRTUAL TABLE IF NOT EXISTS word_card_fts USING fts5(
                content, meaning, name, tags,
                content='word_card', content_rowid='id'
            );

            -- 触发器：自动同步 FTS
            CREATE TRIGGER IF NOT EXISTS wc_fts_ai AFTER INSERT ON word_card BEGIN
                INSERT INTO word_card_fts(rowid, content, meaning, name, tags)
                VALUES (new.id, new.content, new.meaning, new.name, new.tags);
            END;
            CREATE TRIGGER IF NOT EXISTS wc_fts_ad AFTER DELETE ON word_card BEGIN
                INSERT INTO word_card_fts(word_card_fts, rowid, content, meaning, name, tags)
                VALUES ('delete', old.id, old.content, old.meaning, old.name, old.tags);
            END;
            CREATE TRIGGER IF NOT EXISTS wc_fts_au AFTER UPDATE ON word_card BEGIN
                INSERT INTO word_card_fts(word_card_fts, rowid, content, meaning, name, tags)
                VALUES ('delete', old.id, old.content, old.meaning, old.name, old.tags);
                INSERT INTO word_card_fts(rowid, content, meaning, name, tags)
                VALUES (new.id, new.content, new.meaning, new.name, new.tags);
            END;

            -- 词卡→场景引用表（替代 user_scene_prompt）
            CREATE TABLE IF NOT EXISTS scene_card_ref (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                scene_id    INTEGER NOT NULL,
                card_id     INTEGER NOT NULL,
                card_content TEXT DEFAULT '',
                created_at  TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (card_id) REFERENCES word_card(id),
                UNIQUE(scene_id, card_id)
            );
            CREATE INDEX IF NOT EXISTS idx_scr_scene ON scene_card_ref(scene_id);
            CREATE INDEX IF NOT EXISTS idx_scr_card ON scene_card_ref(card_id);
        """)

        # === Seedance V2 缺列补丁（幂等 ALTER TABLE）===
        for sql in [
            "ALTER TABLE user_project ADD COLUMN bgm TEXT DEFAULT ''",
            "ALTER TABLE user_project ADD COLUMN sfx TEXT DEFAULT ''",
            "ALTER TABLE user_project ADD COLUMN dialogue TEXT DEFAULT ''",
            "ALTER TABLE user_project ADD COLUMN template_id INTEGER DEFAULT NULL",
            "ALTER TABLE user_project_scene ADD COLUMN duration REAL DEFAULT 3",
            "ALTER TABLE user_project_scene ADD COLUMN is_manual INTEGER DEFAULT 0",
            "ALTER TABLE user_project_scene ADD COLUMN is_locked INTEGER DEFAULT 0",
            # v4.0.0-phase10: audio 4-elements
            "ALTER TABLE user_project_scene ADD COLUMN character_voice TEXT DEFAULT ''",
            "ALTER TABLE user_project_scene ADD COLUMN narration TEXT DEFAULT ''",
            "ALTER TABLE user_project_scene ADD COLUMN bgm TEXT DEFAULT ''",
            "ALTER TABLE user_project_scene ADD COLUMN sfx TEXT DEFAULT ''",
            "ALTER TABLE user_project_scene ADD COLUMN audio_enabled INTEGER DEFAULT 0",
            "ALTER TABLE user_project ADD COLUMN audio_enabled INTEGER DEFAULT 1",
            # v4.0.0-phase10.1: character library
            "ALTER TABLE user_project_scene ADD COLUMN character_id INTEGER DEFAULT NULL",
            # Phase16: character/scene composer settings_json
            "ALTER TABLE character_profiles ADD COLUMN settings_json TEXT DEFAULT '{}'",
            "ALTER TABLE scene_profiles ADD COLUMN settings_json TEXT DEFAULT '{}'",
            # Phase17: 词卡双语翻译字段
            "ALTER TABLE word_card ADD COLUMN content_en TEXT DEFAULT ''",
            "ALTER TABLE word_card ADD COLUMN content_zh TEXT DEFAULT ''",
        ]:
            try:
                conn.execute(sql)
            except Exception:
                pass  # 列已存在则跳过

        # v4.0.0-phase10.1: character library tables
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS character_profiles (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id        INTEGER DEFAULT 0,
                name              TEXT NOT NULL DEFAULT '',
                gender            TEXT DEFAULT '',
                age_range         TEXT DEFAULT '',
                occupation        TEXT DEFAULT '',
                personality       TEXT DEFAULT '',
                appearance        TEXT DEFAULT '',
                voice_type        TEXT DEFAULT '',
                voice_detail      TEXT DEFAULT '',
                narration_style   TEXT DEFAULT '',
                role_position     TEXT DEFAULT '',
                backstory         TEXT DEFAULT '',
                notes             TEXT DEFAULT '',
                tags              TEXT DEFAULT '[]',
                avatar            TEXT DEFAULT '',
                preview_image     TEXT DEFAULT '',
                sort_order        INTEGER DEFAULT 0,
                is_builtin        INTEGER DEFAULT 0,
                usage_count       INTEGER DEFAULT 0,
                created_at        TEXT DEFAULT (datetime('now','localtime')),
                updated_at        TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE TABLE IF NOT EXISTS character_images (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id    INTEGER NOT NULL,
                filename        TEXT NOT NULL,
                image_type      TEXT DEFAULT 'reference',
                caption         TEXT DEFAULT '',
                sort_order      INTEGER DEFAULT 0,
                created_at      TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (character_id) REFERENCES character_profiles(id) ON DELETE CASCADE
            );
        """)

        conn.commit()
    except sqlite3.Error as e:
        log_error(f"[DB] 建表失败: {e}", source="database")
        conn.rollback()
        raise


def rebuild_fts():
    """重建全文索引（幂等，容错）"""
    try:
        db = get_db()
        db.execute("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')")
        db.commit()
    except sqlite3.Error as e:
        log_error(f"[DB] 全文索引重建失败: {e}", source="database")
