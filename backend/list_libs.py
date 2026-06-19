import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db

db = get_db()
rows = db.execute("SELECT id, dimension_key, dimension_name, category FROM prompt_library ORDER BY category, sort_order").fetchall()
for r in rows:
    print(f"  {r['id']:3d} | {r['category']:8s} | {r['dimension_key']:20s} | {r['dimension_name']}")
