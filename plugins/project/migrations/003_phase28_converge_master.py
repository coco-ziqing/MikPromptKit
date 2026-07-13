# -*- coding: utf-8 -*-
"""
Phase28 前向迁移 — 团队协作 4 表数据模型收敛
从 project_id(旧 seedance/projects 维度) 彻底收敛到 master_project_id 单主键。

幂等 & 安全:
  - 仅当表仍存在 project_id 列时才重建；已收敛的库直接跳过。
  - 整表重建(SQLite 官方做法)保留 id 不变，维持 project_task_scene 等外键。
  - 重建前将残留 project_id 死值行的 master_project_id 兜底(NULL 行会被跳过并告警)。

用法(独立执行):  python plugins/project/migrations/003_phase28_converge_master.py [db_path]
或由插件 on_db_init / 迁移器调用 run(conn)。
"""
import sqlite3, sys, os

TARGET = {
    'project_columns': {
        'ddl': """CREATE TABLE project_columns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            master_project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#6b7280',
            sort_order INTEGER DEFAULT 0,
            phase TEXT DEFAULT 'P3',
            created_at TEXT,
            FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE
        )""",
        'cols': ['id','master_project_id','name','color','sort_order','phase','created_at'],
        'idx': [],
    },
    'project_tasks': {
        'ddl': """CREATE TABLE project_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            master_project_id INTEGER NOT NULL,
            column_id INTEGER,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            assignee_id INTEGER,
            priority INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            due_date TEXT,
            sort_order INTEGER DEFAULT 0,
            completed_at TEXT,
            phase TEXT DEFAULT 'P3',
            task_type TEXT DEFAULT 'task',
            created_at TEXT,
            updated_at TEXT,
            FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE,
            FOREIGN KEY (column_id) REFERENCES project_columns(id) ON DELETE SET NULL
        )""",
        'cols': ['id','master_project_id','column_id','title','description','assignee_id','priority','status','due_date','sort_order','completed_at','phase','task_type','created_at','updated_at'],
        'idx': ["CREATE INDEX IF NOT EXISTS idx_pt_master ON project_tasks(master_project_id, column_id)"],
    },
    'project_milestones': {
        'ddl': """CREATE TABLE project_milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            master_project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            due_date TEXT,
            completed_at TEXT,
            sort_order INTEGER DEFAULT 0,
            phase TEXT DEFAULT 'P3',
            created_at TEXT,
            FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE
        )""",
        'cols': ['id','master_project_id','title','description','due_date','completed_at','sort_order','phase','created_at'],
        'idx': [],
    },
    'project_members': {
        'ddl': """CREATE TABLE project_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            master_project_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT DEFAULT 'viewer',
            real_name TEXT DEFAULT '',
            duty TEXT DEFAULT '',
            avatar TEXT DEFAULT '',
            avatar_color TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            parent_member_id INTEGER REFERENCES project_members(id),
            permissions_json TEXT DEFAULT '{}',
            joined_at TEXT,
            UNIQUE(master_project_id, user_id),
            FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE
        )""",
        'cols': ['id','master_project_id','user_id','role','real_name','duty','avatar','avatar_color','phone','email','parent_member_id','permissions_json','joined_at'],
        'idx': [],
    },
}


def _has_col(cur, table, col):
    return any(r[1] == col for r in cur.execute(f"PRAGMA table_info({table})"))


def run(conn):
    cur = conn.cursor()
    changed = []
    # 目标表尚不存在(全新库由插件 _ensure_tables 建正确结构) -> 无需迁移
    existing = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    todo = [t for t in TARGET if t in existing and _has_col(cur, t, 'project_id')]
    if not todo:
        print("[003_phase28] 已收敛，跳过。")
        return False

    cur.execute("PRAGMA foreign_keys=OFF")
    cur.execute("BEGIN")
    try:
        for t in todo:
            spec = TARGET[t]
            # 死值兜底：project_id 非 0 但 master_project_id 为空的行无法归属，保留告警
            null_master = cur.execute(f"SELECT COUNT(*) FROM {t} WHERE master_project_id IS NULL").fetchone()[0]
            if null_master:
                raise RuntimeError(f"{t} 有 {null_master} 行 master_project_id 为空，需先人工归属再迁移")
            collist = ",".join(spec['cols'])
            cur.execute(spec['ddl'].replace(f"CREATE TABLE {t}", f"CREATE TABLE {t}__new"))
            cur.execute(f"INSERT INTO {t}__new ({collist}) SELECT {collist} FROM {t}")
            cur.execute(f"DROP TABLE {t}")
            cur.execute(f"ALTER TABLE {t}__new RENAME TO {t}")
            for ix in spec['idx']:
                cur.execute(ix)
            changed.append(t)
        # 仅校验被改的表的外键
        bad = []
        for t in changed:
            bad += cur.execute(f"PRAGMA foreign_key_check({t})").fetchall()
        if bad:
            raise RuntimeError(f"foreign_key_check 失败: {bad}")
        conn.commit()
    except Exception as e:
        conn.rollback()
        cur.execute("PRAGMA foreign_keys=ON")
        raise
    cur.execute("PRAGMA foreign_keys=ON")
    print(f"[003_phase28] 收敛完成，重建表: {changed}")
    return True


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "data", "prompts.db")
    conn = sqlite3.connect(db, timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    run(conn)
    conn.close()
