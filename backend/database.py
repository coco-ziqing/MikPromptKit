"""
数据库模块 — SQLite 初始化与连接管理（加固版）
"""
import sqlite3
import os
import threading
import time

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DB_DIR, "prompts.db")

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
            print("[数据库] 连接失败:", e)
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
            print("[数据库] 执行失败:", sql[:80], e)
            return None
        except sqlite3.Error as e:
            print("[数据库] 错误:", e)
            return None


def safe_commit():
    """安全提交事务"""
    try:
        db = get_db()
        db.commit()
        return True
    except sqlite3.Error as e:
        print("[数据库] 提交失败:", e)
        return False


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
        conn.commit()
    except sqlite3.Error as e:
        print("[数据库] 建表失败:", e)
        conn.rollback()
        raise


def rebuild_fts():
    """重建全文索引（幂等，容错）"""
    try:
        db = get_db()
        db.execute("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')")
        db.commit()
    except sqlite3.Error as e:
        print("[数据库] 全文索引重建失败:", e)
