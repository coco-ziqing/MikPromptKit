import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from database import get_db
db = get_db()

# Check variations table
cnt = db.execute("SELECT COUNT(*) FROM atom_variation").fetchone()[0]
print(f"atom_variation rows: {cnt}")

# Check recent logs for variation-related
rows = db.execute("SELECT id, message, created_at FROM runtime_log WHERE message LIKE '%variation%' ORDER BY id DESC LIMIT 10").fetchall()
print(f"\nRecent variation logs: {len(rows)}")
for r in rows:
    print(f"  #{r[0]} {r[2]} {r[1][:200]}")

# Direct API test
import urllib.request, json
body = json.dumps({"decompose_id": 1, "atoms_json": json.dumps([{"id":"a1","type":"style","text":"test","keywords":[],"weight":0.5}]), "count": 2, "locked_ids": []}).encode()
req = urllib.request.Request("http://127.0.0.1:8080/api/v4/atoms/variations", data=body, headers={"Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=60)
    d = json.loads(r.read())
    print(f"\nDirect API test: ok={d.get('ok')} count={d.get('count')}")
except Exception as e:
    print(f"\nDirect API test FAIL: {e}")
