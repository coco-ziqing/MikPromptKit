import sqlite3
db = sqlite3.connect(r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data\prompts.db')
db.row_factory = sqlite3.Row
rows = db.execute("SELECT name,meaning,scene,module,version FROM word_card WHERE source='atom_decompose' AND is_deleted=0 LIMIT 3").fetchall()
for r in rows:
    print(f"name={r['name'][:30]:30s} meaning={r['meaning'][:25]:25s} scene={r['scene'][:25]:25s} module={r['module']:12s} ver={r['version']}")
