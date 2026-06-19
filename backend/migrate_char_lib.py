"""
v4.0.0-phase10.1: Character Library System
Database migration + tables
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db, safe_commit

db = get_db()

# ========== 1. character_profiles 角色档案主表 ==========
db.executescript("""
    CREATE TABLE IF NOT EXISTS character_profiles (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id        INTEGER DEFAULT 0,
        name              TEXT NOT NULL DEFAULT '',
        gender            TEXT DEFAULT '',
        age_range         TEXT DEFAULT '',
        occupation        TEXT DEFAULT '',
        personality       TEXT DEFAULT '',
        appearance        TEXT DEFAULT '',
        voice_type        TEXT DEFAULT '',
        voice_detail      TEXT DEFAULT '',
        narration_style   TEXT DEFAULT '',
        role_position     TEXT DEFAULT '',
        backstory         TEXT DEFAULT '',
        notes             TEXT DEFAULT '',
        tags              TEXT DEFAULT '[]',
        avatar            TEXT DEFAULT '',
        preview_image     TEXT DEFAULT '',
        sort_order        INTEGER DEFAULT 0,
        is_builtin        INTEGER DEFAULT 0,
        usage_count       INTEGER DEFAULT 0,
        created_at        TEXT DEFAULT (datetime('now','localtime')),
        updated_at        TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 角色参考图集（多角度设定图等）
    CREATE TABLE IF NOT EXISTS character_images (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id    INTEGER NOT NULL,
        filename        TEXT NOT NULL,
        image_type      TEXT DEFAULT 'reference',
        caption         TEXT DEFAULT '',
        sort_order      INTEGER DEFAULT 0,
        created_at      TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (character_id) REFERENCES character_profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_char_profiles_project
        ON character_profiles(project_id);
    CREATE INDEX IF NOT EXISTS idx_char_images_char
        ON character_images(character_id);
""")

# ========== 2. user_project_scene 加 character_id FK ==========
for sql in [
    "ALTER TABLE user_project_scene ADD COLUMN character_id INTEGER DEFAULT NULL",
]:
    try:
        db.execute(sql)
        print(f"  [OK] {sql}")
    except Exception as e:
        err = str(e).lower()
        if "duplicate" in err:
            print(f"  [SKIP] already exists")
        else:
            print(f"  [WARN] {e}")

# ========== 3. 角色图片目录 ==========
IMG_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "character_images"
)
os.makedirs(IMG_DIR, exist_ok=True)
print(f"\n  [OK] Image dir: {IMG_DIR}")

db.commit()
print("Phase10.1 migration done.")
