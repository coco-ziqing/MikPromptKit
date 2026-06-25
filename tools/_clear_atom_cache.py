"""Clear atom_decompose cache for fresh test"""
import urllib.request, json, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from database import get_db

db = get_db()
before = db.execute("SELECT COUNT(*) FROM atom_decompose").fetchone()[0]
db.execute("DELETE FROM atom_decompose WHERE quality_score < 0.5")
db.execute("DELETE FROM atom_variation")
db.commit()
after = db.execute("SELECT COUNT(*) FROM atom_decompose").fetchone()[0]
print(f"Cleared {before - after} low-quality decompose caches ({after} remain)")
