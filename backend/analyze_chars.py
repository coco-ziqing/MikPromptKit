import sys; sys.path.insert(0, r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\backend')
from database import get_db; db=get_db()

print('=== Scene columns (audio-related) ===')
for r in db.execute('PRAGMA table_info(user_project_scene)').fetchall():
    name = r[1]
    if any(k in name for k in ['audio','voice','narration','bgm','sfx','char']):
        print(f'  {name:30s} {r[2]:15s} default={r[4]}')

print('\n=== Audio libraries ===')
for r in db.execute("SELECT id, dimension_key, dimension_name, category FROM prompt_library WHERE category='audio' ORDER BY sort_order").fetchall():
    cnt = db.execute("SELECT COUNT(*) as c FROM prompt_word_card WHERE library_id=?", (r['id'],)).fetchone()['c']
    print(f'  [{r["id"]:2d}] {r["dimension_key"]:20s} | {r["dimension_name"]:10s} | {cnt} cards')

print('\n=== 查: existing character-related tables/libs ===')
for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%char%' OR name LIKE '%role%' OR name LIKE '%actor%'").fetchall():
    print(f'  table: {r[0]}')

# Check what data exists in character_voice field
samples = db.execute("SELECT id, character_voice, narration FROM user_project_scene WHERE character_voice!='' OR narration!='' LIMIT 5").fetchall()
print(f'\n=== scenes with voice data (sample) ===')
for s in samples:
    print(f'  scene {s["id"]}: cv={s["character_voice"][:40] if s["character_voice"] else "(empty)"} | narr={s["narration"][:40] if s["narration"] else "(empty)"}')

# How is character_voice populated -- via word cards?
samples2 = db.execute("SELECT pc.id, pc.word_text FROM prompt_word_card pc JOIN prompt_library pl ON pc.library_id=pl.id WHERE pl.dimension_key='audio_char_narr' LIMIT 8").fetchall()
print(f'\n=== audio_char_narr word cards (sample) ===')
for s in samples2:
    print(f'  card {s["id"]}: {s["word_text"]}')
