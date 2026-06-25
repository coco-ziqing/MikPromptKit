# -*- coding: utf-8 -*-
"""Diagnose IndexError on /api/v4/word-cards"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from database import get_db

db = get_db()

# Find the IndexError entry with full stack
rows = db.execute(
    "SELECT id, message, detail, stack, path, created_at FROM runtime_log WHERE id=2054"
).fetchall()
for r in rows:
    d = dict(r)
    print(f"path: {d.get('path')}")
    print(f"msg:  {d.get('message')}")
    print(f"detail: {d.get('detail')}")
    print(f"FULL STACK:")
    print(d.get('stack', '')[:1000])
