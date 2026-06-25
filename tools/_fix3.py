# fix3: main.py import safe + replace risky fetchones
from pathlib import Path
mp = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\backend\main.py")
m = mp.read_text(encoding="utf-8")

# import safe helpers (logger import is already there)
m = m.replace(
    "from logger import info as log_info, warn as log_warn, error as log_error, debug as log_debug",
    "from logger import info as log_info, warn as log_warn, error as log_error, debug as log_debug\nfrom database import safe_fetch_one, safe_count, safe_count_dict"
)

# replace the most brittle fetchone()[0] / fetchone()["cnt"] calls
# these are the COUNT(*) queries that crash if table is empty
maps = [
    ('db.execute("SELECT COUNT(*) FROM prompt_cards").fetchone()[0]',
     'safe_count("SELECT COUNT(*) FROM prompt_cards")'),
    ('db.execute("SELECT COUNT(*) FROM library_assets").fetchone()[0]',
     'safe_count("SELECT COUNT(*) FROM library_assets")'),
    ('db.execute("SELECT COUNT(*) as cnt FROM prompts").fetchone()["cnt"]',
     'safe_count_dict("SELECT COUNT(*) as cnt FROM prompts")'),
    ('db.execute("SELECT COUNT(*) as cnt FROM prompt_cards").fetchone()["cnt"]',
     'safe_count_dict("SELECT COUNT(*) as cnt FROM prompt_cards WHERE is_deleted=0")'),
    ('db.execute("SELECT COUNT(*) as cnt FROM library_assets").fetchone()["cnt"]',
     'safe_count_dict("SELECT COUNT(*) as cnt FROM library_assets")'),
    ('db.execute("SELECT SUM(usage_count) as cnt FROM prompts").fetchone()["cnt"]',
     'safe_count_dict("SELECT SUM(usage_count) as cnt FROM prompts")'),
]
for old, new in maps:
    if old in m:
        m = m.replace(old, new)
        print(f"  replaced: {old[:70]}")

mp.write_text(m, encoding="utf-8")
print("main.py done")
