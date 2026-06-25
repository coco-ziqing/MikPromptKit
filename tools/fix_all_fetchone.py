# fix_all_fetchone.py: main.py + word_cards 安全替换 + 统一编译
from pathlib import Path
import re, subprocess, sys

BASE = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\backend")

# ──────────── main.py ────────────
mp = BASE / "main.py"
m = mp.read_text(encoding="utf-8")
# import safe helpers
m = m.replace(
    "from logger import info as log_info, warn as log_warn, error as log_error, debug as log_debug",
    "from logger import info as log_info, warn as log_warn, error as log_error, debug as log_debug\nfrom database import safe_fetch_one, safe_count, safe_count_dict"
)
maps = [
    ('db.execute("SELECT COUNT(*) FROM prompt_cards").fetchone()[0]',
     'safe_count("SELECT COUNT(*) FROM prompt_cards")'),
    ('db.execute("SELECT COUNT(*) FROM library_assets").fetchone()[0]',
     'safe_count("SELECT COUNT(*) FROM library_assets")'),
    ('db.execute("SELECT COUNT(*) as cnt FROM prompts").fetchone()["cnt"]',
     'safe_count_dict("SELECT COUNT(*) as cnt FROM prompts")'),
    ('db.execute("SELECT COUNT(*) as cnt FROM prompt_cards WHERE is_deleted=0").fetchone()["cnt"]',
     'safe_count_dict("SELECT COUNT(*) as cnt FROM prompt_cards WHERE is_deleted=0")'),
    ('db.execute("SELECT COUNT(*) as cnt FROM library_assets").fetchone()["cnt"]',
     'safe_count_dict("SELECT COUNT(*) as cnt FROM library_assets")'),
    ('db.execute("SELECT SUM(usage_count) as cnt FROM prompts").fetchone()["cnt"]',
     'safe_count_dict("SELECT SUM(usage_count) as cnt FROM prompts")'),
]
cnt = 0
for old, new in maps:
    if old in m:
        m = m.replace(old, new)
        cnt += 1
mp.write_text(m, encoding="utf-8")
print(f"main.py: {cnt} fetchone replaced")

# ──────────── word_cards.py ────────────
wcp = BASE / "api" / "word_cards.py"
wc = wcp.read_text(encoding="utf-8")

# add import
wc = wc.replace(
    "from database import get_db",
    "from database import get_db, safe_fetch_one, safe_count, safe_count_dict"
)

# generic COUNT(*) → safe_count (bulletproof for all 16 locations)
# COUNT pattern: db.execute("SELECT COUNT(*) ...").fetchone()[0]
wc = re.sub(
    r'db\.execute\("SELECT COUNT\(\*\) ([^"]+)"(?:\s*,\s*\[([^\]]*)\])?\)\.fetchone\(\)\[0\]',
    r'safe_count("SELECT COUNT(*) \1", [\2] if \2 else None)',
    wc
)
# COUNT(*) as c / cnt → safe_count_dict
wc = re.sub(
    r'db\.execute\("SELECT COUNT\(\*\) as (\w+) ([^"]*)"(?:\s*,\s*(\[[^\]]*\]))?\)\.fetchone\(\)\[\"\1\"\]',
    r'safe_count_dict("SELECT COUNT(*) as \1 \2", \3 if \3 else None, "\1")',
    wc
)
# last_insert_rowid → safe_fetch_one
wc = re.sub(
    r'db\.execute\("SELECT last_insert_rowid\(\)"\)\.fetchone\(\)\[0\]',
    r'safe_count("SELECT last_insert_rowid()")',
    wc
)
# SELECT ... WHERE id=? → keep as fetchone but wrap in null-check via safe_fetch_one
# for these, replace db.execute(...).fetchone() → safe_fetch_one(...)
wc = re.sub(
    r"db\.execute\((f?\"SELECT [^\"]+ WHERE [^\"]+\"[^)]*)\)\.fetchone\(\)",
    r"safe_fetch_one(\1)",
    wc
)

wcp.write_text(wc, encoding="utf-8")
print("word_cards.py: fetchone patterns replaced")

# ──────────── compile check ────────────
for fp in [mp, wcp]:
    r = subprocess.run([sys.executable, "-m", "py_compile", str(fp)], capture_output=True, text=True)
    status = "OK" if r.returncode == 0 else f"FAIL {r.stderr[:120]}"
    print(f"  compile {fp.name}: {status}")

# ──────────── count remaining risky fetchones ────────────
for fp in [mp, wcp]:
    text = fp.read_text(encoding="utf-8")
    risky = len(re.findall(r'\.fetchone\(\)\[0\]|fetchone\(\)\["', text))
    print(f"  {fp.name}: remaining risky fetchone = {risky} (0=all safe)")

print("ALL_DONE")
