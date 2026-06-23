import sqlite3
conn = sqlite3.connect(r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data\prompts.db')
tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%fts%' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
for t in tables:
    cols = conn.execute(f"PRAGMA table_info('{t[0]}')").fetchall()
    print(f"## {t[0]:35s} ({len(cols)} columns)")
    for c in cols[:10]:
        pk = "PK" if c[5] else ""
        null = "NULL" if not c[3] else ""
        print(f"  | {c[1]:30s} {c[2]:10s} {pk:3s} {null:5s}")
    if len(cols) > 10:
        print(f"  ... ({len(cols)-10} more columns)")
    print()
conn.close()
