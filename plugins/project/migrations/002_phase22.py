# -*- coding: utf-8 -*-
"""
Phase22 DB Migration — 项目管理重大架构升级
新增: master_project, master_sub_project, master_asset
扩展: project_columns/tasks/milestones 增加 master_project_id + phase 字段
幂等执行，可安全重复运行
"""
import sqlite3, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "data", "prompts.db")
conn = sqlite3.connect(DB)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA busy_timeout=2000")
conn.execute("PRAGMA foreign_keys=ON")

print("Phase22 Migration 开始...")

# ============================================================
# 1. 新建 master_project — 总项目表
# ============================================================
conn.execute("""
CREATE TABLE IF NOT EXISTS master_project (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    project_type TEXT DEFAULT 'short_film',
    aspect_ratio TEXT DEFAULT '16:9',
    resolution   TEXT DEFAULT '4K',
    status       TEXT DEFAULT 'draft',
    cover_image  TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
)
""")
print("  [OK] master_project")

# ============================================================
# 2. 新建 master_sub_project — 子项目（桥接总项目↔seedance）
# ============================================================
conn.execute("""
CREATE TABLE IF NOT EXISTS master_sub_project (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    master_project_id INTEGER NOT NULL,
    seedance_project_id INTEGER,
    name              TEXT NOT NULL,
    sub_type          TEXT DEFAULT 'storyboard',
    description       TEXT DEFAULT '',
    phase             TEXT DEFAULT 'P3',
    sort_order        INTEGER DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE,
    FOREIGN KEY (seedance_project_id) REFERENCES user_project(id) ON DELETE SET NULL
)
""")
conn.execute("CREATE INDEX IF NOT EXISTS idx_msp_master ON master_sub_project(master_project_id)")
print("  [OK] master_sub_project")

# ============================================================
# 3. 新建 master_asset — 统一资产表
# ============================================================
conn.execute("""
CREATE TABLE IF NOT EXISTS master_asset (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    master_project_id INTEGER NOT NULL,
    sub_project_id    INTEGER,
    asset_type        TEXT NOT NULL,
    name              TEXT NOT NULL,
    description       TEXT DEFAULT '',
    content           TEXT DEFAULT '',
    image_path        TEXT DEFAULT '',
    tags              TEXT DEFAULT '[]',
    word_card_id      INTEGER,
    sort_order        INTEGER DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now','localtime')),
    updated_at        TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE,
    FOREIGN KEY (sub_project_id) REFERENCES master_sub_project(id) ON DELETE SET NULL,
    FOREIGN KEY (word_card_id) REFERENCES word_card(id) ON DELETE SET NULL
)
""")
conn.execute("CREATE INDEX IF NOT EXISTS idx_ma_master ON master_asset(master_project_id)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_ma_type ON master_asset(asset_type)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_ma_sub ON master_asset(sub_project_id)")
print("  [OK] master_asset")

# ============================================================
# 4. 扩展旧表 — project_columns/tasks/milestones 增加 master_project_id + phase
# ============================================================
alters = [
    ("project_columns", "master_project_id", "INTEGER"),
    ("project_columns", "phase", "TEXT DEFAULT 'P3'"),
    ("project_tasks", "master_project_id", "INTEGER"),
    ("project_tasks", "phase", "TEXT DEFAULT 'P3'"),
    ("project_tasks", "task_type", "TEXT DEFAULT 'task'"),
    ("project_milestones", "master_project_id", "INTEGER"),
    ("project_milestones", "phase", "TEXT DEFAULT 'P3'"),
]

for tbl, col, defn in alters:
    existing = [r[1] for r in conn.execute(f"PRAGMA table_info({tbl})").fetchall()]
    if col in existing:
        print(f"  [skip] {tbl}.{col}")
    else:
        try:
            conn.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} {defn}")
            print(f"  [OK] {tbl}.{col}")
        except Exception as e:
            print(f"  [ERR] {tbl}.{col}: {e}")

conn.commit()
conn.close()
print("\nPhase22 迁移完成!")
