# -*- coding: utf-8 -*-
"""Deep dive into SyntaxError root cause"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from database import get_db

db = get_db()

# Get SyntaxError entries with full detail/stack
rows = db.execute(
    "SELECT id, level, source, message, detail, stack, path, created_at FROM runtime_log WHERE message LIKE '%SyntaxError%' ORDER BY id DESC LIMIT 5"
).fetchall()

for r in rows:
    d = dict(r)
    print(f"#{d['id']} [{d.get('source')}] {d.get('created_at','')}")
    print(f"  msg:    {d.get('message','')}")
    print(f"  path:   {d.get('path','')}")
    print(f"  detail: {d.get('detail','')[:300]}")
    print(f"  stack:  {d.get('stack','')[:300]}")
    print()

# Also check the IndexError
print("="*60)
err_rows = db.execute(
    "SELECT * FROM runtime_log WHERE id=2054"
).fetchall()
for r in err_rows:
    d = dict(r)
    print(f"#{d['id']} [{d.get('source')}] {d.get('message')}")
    print(f"  path:   {d.get('path','')}")
    print(f"  detail: {d.get('detail','')}")
    print(f"  stack:  {d.get('stack','')[:400]}")
