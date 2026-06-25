# fix2: print→logger + resp.json guard
import re
from pathlib import Path

# database.py
dbp = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\backend\database.py")
db = dbp.read_text(encoding="utf-8")
lines = db.split("\n")
new = []
for ln in lines:
    m = re.match(r"(\s*)print\(\"(?:\[数据库\]|\[DB\])\"\s*,\s*(.+)\)", ln)
    if m:
        indent, rest = m.group(1), m.group(2).rstrip()
        new.append(f'{indent}log_error(f"[DB] {rest}", source="database")')
    else:
        new.append(ln)
dbp.write_text("\n".join(new), encoding="utf-8")
print("database.py print→logger OK")

# app_core.js
jsp = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\static\js\app_core.js")
js = jsp.read_text(encoding="utf-8")
js = js.replace("return await resp.json()", "if (!resp.ok) throw new Error('HTTP '+resp.status); return await resp.json()")
js = js.replace("return await res.json()", "if (!res.ok) throw new Error('HTTP '+res.status); return await res.json()")
jsp.write_text(js, encoding="utf-8")
print("app_core.js guard OK")
