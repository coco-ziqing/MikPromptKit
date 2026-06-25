from pathlib import Path
p = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\backend\database.py")
t = p.read_text(encoding="utf-8")
lines = t.split("\n")
new = []
for ln in lines:
    s = ln.strip()
    if s.startswith("print(") and "[数据库]" in s:
        indent = ln[:len(ln) - len(ln.lstrip())]
        # extract the message part after the comma
        rest = s[len("print([数据库]"):].strip().lstrip(",").strip().rstrip(")")
        new.append(f'{indent}log_error(f"[DB] {rest}", source="database")')
    else:
        new.append(ln)
p.write_text("\n".join(new), encoding="utf-8")
print("database.py remaining prints replaced")
