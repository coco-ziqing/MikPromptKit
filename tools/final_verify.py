import re, subprocess, sys
from pathlib import Path
BASE = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev")

files = ["backend/database.py", "backend/main.py", "backend/api/word_cards.py",
         "frontend/static/js/app_core.js", "frontend/static/js/wc_bridge.js"]

print("=" * 50)
print("审查修复最终验证")
print("=" * 50)

for f in files:
    t = (BASE / f).read_text(encoding="utf-8")
    risky = len(re.findall(r'fetchone\(\)\[0\]|fetchone\(\)\["', t))
    prints = len(re.findall(r'^\s+print\(', t, re.M))
    unsafe = len(re.findall(r'return await (resp|res)\.json\(\)', t))
    has_guard = len(re.findall(r'if \(!(resp|res)\.ok\)', t))
    print(f"  {f}")
    print(f"    fetchone-risk={risky} print={prints} unsafe-json={unsafe} has-guard={has_guard}")

# backend compile
print("\nbackend compile...")
for p in (BASE / "backend").rglob("*.py"):
    if "__pycache__" in str(p):
        continue
    r = subprocess.run([sys.executable, "-m", "py_compile", str(p)], capture_output=True, text=True)
    if r.returncode:
        print(f"  FAIL: {p.name}")

print("ALL_DONE")
