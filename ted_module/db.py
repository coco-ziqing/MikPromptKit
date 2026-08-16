# -*- coding: utf-8 -*-
"""独立数据库访问层（仅操作 ted_analysis.db，绝不触碰主项目数据库）"""
import hashlib
import json
import os
import sqlite3

from config import DB_PATH, UPLOAD_DIR

_SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schemas.sql")


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db():
    """幂等建表（仅本模块表）"""
    with open(_SCHEMA_PATH, encoding="utf-8") as f:
        schema = f.read()
    conn = get_conn()
    try:
        conn.executescript(schema)
        conn.commit()
    finally:
        conn.close()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def save_upload_file(upload, dest_name: str) -> str:
    """保存上传文件到模块私有 uploads 目录，返回路径"""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    dest = os.path.join(UPLOAD_DIR, dest_name)
    content = upload.file.read()
    with open(dest, "wb") as f:
        f.write(content)
    return dest


def row_to_dict(row):
    return dict(row) if row else None
