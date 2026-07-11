# -*- coding: utf-8 -*-
"""
Phase21 DB migration: project_members fields + project_task_scene table
Idempotent, safe to re-run.
"""
import sqlite3, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "data", "prompts.db")
conn = sqlite3.connect(DB)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA busy_timeout=2000")

# Get existing columns
cols = [r[1] for r in conn.execute("PRAGMA table_info(project_members)").fetchall()]

needed = [
    ("real_name", "TEXT DEFAULT ''"),
    ("duty", "TEXT DEFAULT ''"),
    ("avatar", "TEXT DEFAULT ''"),
    ("avatar_color", "TEXT DEFAULT ''"),
    ("phone", "TEXT DEFAULT ''"),
    ("email", "TEXT DEFAULT ''"),
    ("parent_member_id", "INTEGER"),
    ("permissions_json", "TEXT DEFAULT '{}'"),
]

for col_name, col_def in needed:
    if col_name in cols:
        print(f"  [skip] {col_name} (exists)")
    else:
        conn.execute(f"ALTER TABLE project_members ADD COLUMN {col_name} {col_def}")
        print(f"  [OK] {col_name}")

# Create project_task_scene
conn.execute("""
CREATE TABLE IF NOT EXISTS project_task_scene (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL,
    scene_id   INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES user_project_scene(id) ON DELETE CASCADE,
    UNIQUE(task_id, scene_id)
)
""")
print("  [OK] project_task_scene table")

conn.commit()
conn.close()
print("Phase21 migration done!")
