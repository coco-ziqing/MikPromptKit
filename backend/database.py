"""
数据库模块 — SQLite 初始化与连接管理
"""
import sqlite3
import os
import threading

# 数据库文件路径（默认在项目根目录 data/ 下）
DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DB_DIR, "prompts.db")

# 线程本地存储，避免多线程共用同一连接
_local = threading.local()

def get_db():
    """获取当前线程的数据库连接"""
    if not hasattr(_local, "conn") or _local.conn is None:
        os.makedirs(DB_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")       # 写入性能优化
        conn.execute("PRAGMA foreign_keys=ON")         # 外键约束
        _local.conn = conn
    return _local.conn

def close_db():
    """关闭当前线程的数据库连接"""
    if hasattr(_local, "conn") and _local.conn:
        _local.conn.close()
        _local.conn = None

def init_db():
    """建表（幂等）"""
    conn = get_db()
    conn.executescript("""
        -- ============================
        -- 提示词主表
        -- ============================
        CREATE TABLE IF NOT EXISTS prompts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            module      TEXT    NOT NULL,   -- emotion / color / tone / composition
            category    TEXT    NOT NULL,   -- 二级分类名
            subcategory TEXT    DEFAULT '', -- 三级分类名
            content     TEXT    NOT NULL,   -- 提示词内容
            meaning     TEXT    DEFAULT '', -- 释义
            scene       TEXT    DEFAULT '', -- 适用场景
            tags        TEXT    DEFAULT '[]', -- JSON 数组
            usage_count INTEGER DEFAULT 0,
            is_builtin  INTEGER DEFAULT 1, -- 1=内置词条, 0=用户自建
            created_at  TEXT    DEFAULT (datetime('now','localtime'))
        );

        -- ============================
        -- 全文搜索虚拟表（FTS5）
        -- ============================
        CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
            content,
            meaning,
            tags,
            content='prompts',
            content_rowid='id'
        );

        -- ============================
        -- 系统配置表
        -- ============================
        CREATE TABLE IF NOT EXISTS config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- 触发器：prompts INSERT → FTS 同步
        CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
            INSERT INTO prompts_fts(rowid, content, meaning, tags)
            VALUES (new.id, new.content, new.meaning, new.tags);
        END;

        -- 触发器：prompts DELETE → FTS 同步
        CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
            INSERT INTO prompts_fts(prompts_fts, rowid, content, meaning, tags)
            VALUES ('delete', old.id, old.content, old.meaning, old.tags);
        END;

        -- 触发器：prompts UPDATE → FTS 同步
        CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE ON prompts BEGIN
            INSERT INTO prompts_fts(prompts_fts, rowid, content, meaning, tags)
            VALUES ('delete', old.id, old.content, old.meaning, old.tags);
            INSERT INTO prompts_fts(rowid, content, meaning, tags)
            VALUES (new.id, new.content, new.meaning, new.tags);
        END;

        -- ============================
        -- 提示词缩略图表
        -- ============================
        CREATE TABLE IF NOT EXISTS prompt_thumbnails (
            prompt_id INTEGER PRIMARY KEY,
            filename  TEXT NOT NULL,
            media_type TEXT DEFAULT 'image',  -- 'image' 或 'video'
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
        );

        -- ============================
        -- 提示词视频关联表
        -- ============================
        CREATE TABLE IF NOT EXISTS prompt_videos (
            prompt_id INTEGER PRIMARY KEY,
            filename  TEXT NOT NULL,
            poster     TEXT DEFAULT '',       -- 封面图文件名
            duration   REAL DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
        );
        -- ============================
        -- 收藏分组表
        -- ============================
        CREATE TABLE IF NOT EXISTS collections (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT    NOT NULL,
            icon      TEXT    DEFAULT '\u2b50',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT    DEFAULT (datetime('now','localtime'))
        );

        -- 收藏词条关联表
        CREATE TABLE IF NOT EXISTS collection_items (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            prompt_id     INTEGER NOT NULL,
            note          TEXT    DEFAULT '',
            added_at      TEXT    DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
            FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
            UNIQUE(collection_id, prompt_id)
        );

        -- ============================
        -- 用户词包表
        -- ============================
        CREATE TABLE IF NOT EXISTS wordpacks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            description TEXT    DEFAULT '',
            sort_order  INTEGER DEFAULT 0,
            created_at  TEXT    DEFAULT (datetime('now','localtime'))
        );

        -- 词包-词条关联
        CREATE TABLE IF NOT EXISTS wordpack_items (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            wordpack_id INTEGER NOT NULL,
            prompt_id  INTEGER NOT NULL,
            sort_order INTEGER DEFAULT 0,
            added_at   TEXT    DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (wordpack_id) REFERENCES wordpacks(id) ON DELETE CASCADE,
            FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
            UNIQUE(wordpack_id, prompt_id)
        );

        -- ============================
        -- 使用历史表
        -- ============================
        CREATE TABLE IF NOT EXISTS usage_history (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_id  INTEGER NOT NULL,
            used_at    TEXT    DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
        );
    """)
    conn.commit()

def rebuild_fts():
    """重建全文索引（首次导入数据后调用）"""
    conn = get_db()
    conn.execute("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')")
    conn.commit()
