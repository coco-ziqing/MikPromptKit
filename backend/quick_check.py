import sys; sys.path.insert(0, r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\backend')
from database import get_db; db=get_db()
print('Characters:', db.execute('SELECT COUNT(*) as c FROM character_profiles').fetchone()['c'])
c = db.execute('SELECT id,name,voice_type,narration_style FROM character_profiles LIMIT 3').fetchall()
for r in c:
    print(f'  [{r["id"]}] {r["name"]:15s} voice={r["voice_type"]:20s} narr={r["narration_style"]}')
s = db.execute('PRAGMA table_info(user_project_scene)').fetchall()
for r in s:
    if r[1]=='character_id':
        print(f'  character_id: type={r[2]} default={r[4]} -- READY')
