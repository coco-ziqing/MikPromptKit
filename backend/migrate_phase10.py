# v4.0.0-phase10 DB migration: audio 4-elements
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db

db = get_db()

scene_cols = [
    ("character_voice", "TEXT DEFAULT ''"),
    ("narration", "TEXT DEFAULT ''"),
    ("bgm", "TEXT DEFAULT ''"),
    ("sfx", "TEXT DEFAULT ''"),
    ("audio_enabled", "INTEGER DEFAULT 0"),
]

for col, defn in scene_cols:
    try:
        db.execute(f"ALTER TABLE user_project_scene ADD COLUMN {col} {defn}")
        print(f"  [OK] user_project_scene.{col}")
    except Exception as e:
        err = str(e).lower()
        if "duplicate" in err:
            print(f"  [SKIP] user_project_scene.{col} (exists)")
        else:
            print(f"  [WARN] user_project_scene.{col}: {e}")

project_cols = [
    ("audio_enabled", "INTEGER DEFAULT 1"),
]

for col, defn in project_cols:
    try:
        db.execute(f"ALTER TABLE user_project ADD COLUMN {col} {defn}")
        print(f"  [OK] user_project.{col}")
    except Exception as e:
        err = str(e).lower()
        if "duplicate" in err:
            print(f"  [SKIP] user_project.{col} (exists)")
        else:
            print(f"  [WARN] user_project.{col}: {e}")

db.commit()
print("\nPhase10 DB migration done.")
