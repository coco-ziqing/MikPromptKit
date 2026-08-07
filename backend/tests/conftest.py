# -*- coding: utf-8 -*-
"""pytest 共享 fixture — 隔离数据目录 + TestClient（Phase 3.3 引入）

- PK_DATA_DIR 指向临时目录，测试不触碰真实 data/
- TestClient 触发 lifespan（建表 + 种子），离线可跑
"""
import os
import sys
import tempfile

# 必须在 import main 之前设置（database 等模块读取路径）
_tmp_data = tempfile.mkdtemp(prefix="pk_test_")
os.environ["PK_DATA_DIR"] = _tmp_data

# backend/ 加入 sys.path（main.py 同目录约定）
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import pytest
from fastapi.testclient import TestClient

from main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    """FastAPI TestClient（自动触发 lifespan 初始化）+ 幂等建 admin"""
    with TestClient(app) as c:
        _ensure_admin_user()
        yield c


def _ensure_admin_user():
    """双保险：lifespan 迁移已建 admin（修复后哈希正常）；此处补丁防御旧逻辑"""
    from database import get_db, safe_commit
    from password import hash_pw
    db = get_db()
    row = db.execute("SELECT id, password_hash FROM users WHERE username='admin'").fetchone()
    if not row:
        db.execute(
            "INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES (?,?,?,?,1)",
            ["admin", hash_pw("admin"), "主理人", "admin"],
        )
        safe_commit()
    elif not (row["password_hash"] if hasattr(row, "keys") else row[1]):
        db.execute("UPDATE users SET password_hash=? WHERE username='admin'", [hash_pw("admin")])
        safe_commit()


@pytest.fixture(scope="session")
def openapi_paths(client):
    """全部已注册路由路径集合"""
    return set(client.get("/openapi.json").json().get("paths", {}))
