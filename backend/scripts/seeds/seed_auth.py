# -*- coding: utf-8 -*-
"""
Phase23.1 种子数据 — 默认管理员账户 + users/sessions 表确保存在
幂等执行，可安全重复运行
"""
import os, sys, sqlite3, io
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from password import hash_pw

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "prompts.db")
conn = sqlite3.connect(DB)
conn.execute("PRAGMA journal_mode=WAL")

# 确保表存在
conn.execute("""
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    display_name    TEXT DEFAULT '',
    role            TEXT DEFAULT 'editor',
    avatar_color    TEXT DEFAULT '#6366f1',
    is_active       INTEGER DEFAULT 1,
    settings_json   TEXT DEFAULT '{}',
    created_at      TEXT,
    last_login_at   TEXT
)
""")
conn.execute("""
CREATE TABLE IF NOT EXISTS user_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    token       TEXT,
    client_ip   TEXT,
    user_agent  TEXT,
    created_at  TEXT,
    expires_at  TEXT,
    is_active   INTEGER DEFAULT 1
)
""")

# 种子默认管理员（如果不存在）
existing = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()
if not existing:
    pw_hash = hash_pw("admin")
    conn.execute("INSERT INTO users (username, password_hash, display_name, role, avatar_color, is_active, settings_json, bio, website, created_at) VALUES (?,?,?,?,?,'1','{}','','',datetime('now','localtime'))",
    ["admin", pw_hash, "管理员", "admin", "#6366f1"])
    conn.commit()
    print("✅ 默认管理员创建: admin / admin")
else:
    # 更新密码为默认值（防止忘记密码）
    pw_hash = hash_pw("admin")
    conn.execute("UPDATE users SET password_hash=? WHERE username='admin'", [pw_hash])
    conn.commit()
    print("✅ 管理员密码已重置: admin / admin")

# 种子测试用户
test_users = [
    ("editor1", "editor1", "编辑员", "editor"),
    ("viewer1", "viewer1", "观察者", "viewer"),
]
for uname, pwd, dname, role in test_users:
    ex = conn.execute("SELECT id FROM users WHERE username=?", [uname]).fetchone()
    if not ex:
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role, is_active, settings_json, created_at) VALUES (?,?,?,?,1,'{}',datetime('now','localtime'))",
            [uname, hash_pw(pwd), dname, role])
        conn.commit()
        print(f"✅ 测试用户: {uname} / {pwd} ({role})")

conn.close()
print("\nPhase23.1 种子数据完成!")
