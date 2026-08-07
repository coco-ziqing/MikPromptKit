# -*- coding: utf-8 -*-
"""Phase UX-Profile 迁移 - 用户个性化资料字段扩展 + 头像存储目录"""
import os, sqlite3

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "prompts.db")
AVATAR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "avatars")
os.makedirs(AVATAR_DIR, exist_ok=True)

conn = sqlite3.connect(DB)
conn.execute("PRAGMA journal_mode=WAL")

# 新增字段
new_cols = [
    ("avatar_url",  "TEXT DEFAULT ''"),
    ("bio",         "TEXT DEFAULT ''"),
    ("website",     "TEXT DEFAULT ''"),
    ("cover_url",   "TEXT DEFAULT ''"),
]

for col, typ in new_cols:
    try:
        conn.execute(f"ALTER TABLE users ADD COLUMN {col} {typ}")
        print(f"  ✅ 新增 users.{col}")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            print(f"  ⏭ users.{col} 已存在")
        else:
            raise

conn.commit()

# 检查字段
cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
print(f"  users 字段: {cols}")
print(f"  头像目录: {AVATAR_DIR}")
conn.close()
print("✅ Phase UX-Profile 迁移完成")
