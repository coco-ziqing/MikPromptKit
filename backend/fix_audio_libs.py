# Fix: merge audio_char + audio_narr into single library
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db

db = get_db()

# Find old libraries
char_lib = db.execute("SELECT id FROM prompt_library WHERE dimension_key='audio_char'").fetchone()
narr_lib = db.execute("SELECT id FROM prompt_library WHERE dimension_key='audio_narr'").fetchone()

# Delete word cards belonging to old libs
if char_lib:
    db.execute("DELETE FROM prompt_word_card WHERE library_id=?", (char_lib['id'],))
    print(f"Deleted word cards for audio_char (id={char_lib['id']})")
if narr_lib:
    db.execute("DELETE FROM prompt_word_card WHERE library_id=?", (narr_lib['id'],))
    print(f"Deleted word cards for audio_narr (id={narr_lib['id']})")

# Delete old libraries
db.execute("DELETE FROM prompt_library WHERE dimension_key IN ('audio_char','audio_narr')")
print("Deleted audio_char and audio_narr libraries")

# # Rename remaining: audio_bgm -> keep as bgm lib, audio_sfx -> keep as sfx lib
# # Actually don't rename, just fix their dimension_keys
# Wait - the user wants "角色旁白" as a single lib. I need to create a new one.
# Check if audio_char_narr already exists
existing = db.execute("SELECT id FROM prompt_library WHERE dimension_key='audio_char_narr'").fetchone()
if not existing:
    # Get max sort_order among audio category
    max_order = db.execute("SELECT MAX(sort_order) FROM prompt_library WHERE category='audio'").fetchone()[0] or 0
    db.execute(
        "INSERT INTO prompt_library (dimension_key, dimension_name, category, sort_order, description) VALUES (?,?,?,?,?)",
        ("audio_char_narr", "角色旁白", "audio", max_order + 1, "角色配音/旁白风格/语速/情绪")
    )
    new_lib_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    print(f"Created audio_char_narr (id={new_lib_id})")
else:
    new_lib_id = existing['id']
    print(f"audio_char_narr already exists (id={new_lib_id})")

# Seed data for 角色旁白 (combined character + narration)
seed_words = [
    # Character voices
    ("年轻男声", "20-30岁男性，中音区，清晰有力"),
    ("年轻女声", "20-30岁女性，柔和清亮"),
    ("成熟男声", "40-50岁男性，低沉磁性有阅历感"),
    ("成熟女声", "40-50岁女性，温暖沉稳"),
    ("少年音", "12-18岁少年，清亮有朝气"),
    ("少女音", "12-18岁少女，活泼甜美"),
    ("老年男声", "60岁以上，沙哑缓慢沧桑感"),
    ("老年女声", "60岁以上，柔和缓慢慈祥感"),
    ("童声", "5-10岁儿童，天真清脆"),
    ("播音腔男", "标准普通话男声，字正腔圆"),
    ("播音腔女", "标准普通话女声，亲切自然"),
    ("低沉磁性", "低音区，浑厚有磁性，男性魅力"),
    ("温柔女声", "轻柔甜美，治愈系"),
    ("御姐音", "成熟女性，自信有气场"),
    ("正太音", "少年偏童声，活泼天真"),
    ("烟嗓", "沙哑带颗粒感，有个性"),
    ("电子合成音", "机械感/AI感，科幻风"),
    ("英伦男声", "英式英语男性，优雅有教养"),
    ("美式女声", "美式英语女性，自信活泼"),
    ("机器人", "机械电子音，无感情"),
    ("怪物低吼", "低沉咆哮，恐怖氛围"),
    # Narration styles
    ("第一人称旁白", "我如何如何，代入感强"),
    ("第三人称旁白", "客观叙述，他/她如何"),
    ("纪录片风旁白", "客观冷静，事实陈述"),
    ("诗意旁白", "文学性强，比喻丰富有韵律感"),
    ("内心独白", "角色心理活动，情感细腻"),
    ("对话式旁白", "像跟观众聊天，亲切自然"),
    ("悬念式旁白", "营造悬疑氛围，层层递进"),
    ("哲理式旁白", "金句频出，引人深思"),
    ("快速节奏旁白", "语速快，信息密集，紧张感"),
    ("缓慢旁白", "语速慢，留白多，意境深远"),
    ("幽默吐槽旁白", "轻松诙谐，吐槽风格"),
    ("史诗感旁白", "宏大叙事，历史厚重"),
    ("日记体旁白", "如读日记，私密真实"),
    ("童话风旁白", "故事感，梦幻童真"),
    ("留白式旁白", "少说多留白，让画面说话"),
]

# Check existing count
existing_count = db.execute("SELECT COUNT(*) as cnt FROM prompt_word_card WHERE library_id=?", (new_lib_id,)).fetchone()['cnt']
if existing_count == 0:
    for i, (word_text, definition) in enumerate(seed_words):
        db.execute(
            "INSERT INTO prompt_word_card (library_id, word_text, definition, heat_weight, is_system) VALUES (?,?,?,?,1)",
            (new_lib_id, word_text, definition, 1.0 - i * 0.005)
        )
    db.commit()
    print(f"Seeded {len(seed_words)} words for audio_char_narr")
else:
    print(f"audio_char_narr already has {existing_count} cards, skipping seed")

# Verify final state
print("\n--- Final audio libraries ---")
for r in db.execute("SELECT id, dimension_key, dimension_name FROM prompt_library WHERE category='audio' ORDER BY sort_order").fetchall():
    cnt = db.execute("SELECT COUNT(*) as c FROM prompt_word_card WHERE library_id=?", (r['id'],)).fetchone()['c']
    print(f"  {r['id']:3d} | {r['dimension_key']:20s} | {r['dimension_name']:10s} | {cnt} cards")

db.commit()
print("\nDone.")
