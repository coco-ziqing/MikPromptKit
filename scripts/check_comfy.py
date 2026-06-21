import sqlite3, json
db = sqlite3.connect('C:/Users/ASUS/.openclaw/workspace/prompt-tool-dev/data/prompts.db')

# List tables containing 'config' or 'setting'
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables with config:", [t for t in tables if 'config' in t.lower() or 'setting' in t.lower()])

# Try to find comfyui config
for t in tables:
    try:
        cols = [c[1] for c in db.execute(f"PRAGMA table_info({t})").fetchall()]
        if 'config_key' in cols:
            r = db.execute(f"SELECT config_value FROM {t} WHERE config_key=?", ('comfyui_config',)).fetchone()
            if r:
                print(f"Found in {t}: {json.loads(r[0])}")
            else:
                print(f"NOT in {t} (config_key=comfyui_config not found)")
            break
    except:
        pass
else:
    print("No config table found — using default enabled=True")
    print("This means ComfyUI should NOT be skipped unless another setting overrides it")
db.close()
