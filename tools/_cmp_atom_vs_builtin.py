import sqlite3
db = sqlite3.connect(r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data\prompts.db')
db.row_factory = sqlite3.Row

# Atom card
a = db.execute("SELECT * FROM word_card WHERE source='atom_decompose' AND is_deleted=0 LIMIT 1").fetchone()
# Builtin card
b = db.execute("SELECT * FROM word_card WHERE is_builtin=1 AND is_deleted=0 LIMIT 1").fetchone()

print("=== Atom card fields (non-empty) ===")
for k in a.keys():
    if a[k]:
        print(f"  {k:16s} = {str(a[k])[:60]}")

print("\n=== Builtin card fields (non-empty) ===")
for k in b.keys():
    if b[k]:
        print(f"  {k:16s} = {str(b[k])[:60]}")

# Compare: what builtin has that atom doesn't
print("\n=== Missing in atom cards ===")
for k in b.keys():
    if b[k] and (k not in a.keys() or not a[k]):
        print(f"  {k:16s} = {str(b[k])[:60]}")
