"""
v4.0.0-phase10: 音频四要素词库种子数据
- audio_char: 人物角色/对白
- audio_narr: 旁白
- audio_bgm: 背景音乐
- audio_sfx: 音效
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db

db = get_db()

# 检查是否已存在，幂等
existing = db.execute(
    "SELECT dimension_key FROM prompt_library WHERE dimension_key IN ('audio_char','audio_narr','audio_bgm','audio_sfx')"
).fetchall()
existing_keys = {r['dimension_key'] for r in existing}

# 4套音频词库定义
AUDIO_LIBS = [
    ("audio_char", "人物角色", "audio", 1, "角色类型/性别/年龄/声线特征"),
    ("audio_narr", "旁白", "audio", 2, "旁白风格/语速/情绪"),
    ("audio_bgm", "背景音乐", "audio", 3, "音乐风格/乐器/节奏/情绪"),
    ("audio_sfx", "音效", "audio", 4, "环境音/动作音/氛围音"),
]

for dim_key, dim_name, cat, order, desc in AUDIO_LIBS:
    if dim_key in existing_keys:
        print(f"  [SKIP] {dim_key} exists")
        continue
    db.execute(
        "INSERT INTO prompt_library (dimension_key, dimension_name, category, sort_order, description) VALUES (?,?,?,?,?)",
        (dim_key, dim_name, cat, order, desc)
    )
    print(f"  [OK] created library: {dim_key} ({dim_name})")

db.commit()

# 获取刚创建的库ID
libs = {
    r['dimension_key']: r['id']
    for r in db.execute(
        "SELECT id, dimension_key FROM prompt_library WHERE dimension_key IN ('audio_char','audio_narr','audio_bgm','audio_sfx')"
    ).fetchall()
}

# 种子词卡数据
SEED_WORDS = {
    "audio_char": [
        # (word_text, definition)
        ("年轻男声", "20-30岁男性，中音区，清晰有力"),
        ("年轻女声", "20-30岁女性，柔和清亮"),
        ("成熟男声", "40-50岁男性，低沉磁性，有阅历感"),
        ("成熟女声", "40-50岁女性，温暖沉稳"),
        ("少年音", "12-18岁少年，清亮有朝气"),
        ("少女音", "12-18岁少女，活泼甜美"),
        ("老年男声", "60岁以上，沙哑缓慢，沧桑感"),
        ("老年女声", "60岁以上，柔和缓慢，慈祥感"),
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
        ("日系少女", "日语少女音，可爱元气"),
        ("沉稳解说", "纪录片风格，平稳客观"),
        ("激昂演讲", "气势磅礴，有感染力"),
        ("轻声细语", "气声/耳语感，亲密私密"),
        ("机器人", "机械电子音，无感情"),
        ("怪物低吼", "低沉咆哮，恐怖氛围"),
    ],
    "audio_narr": [
        ("第一人称", "我如何如何...，代入感强"),
        ("第三人称", "客观叙述，他/她如何..."),
        ("上帝视角", "全知全能叙述，俯瞰全局"),
        ("纪录片风", "客观冷静，事实陈述"),
        ("诗意旁白", "文学性强，比喻丰富，有韵律感"),
        ("散文风", "自由流畅，意境优美"),
        ("内心独白", "角色心理活动，情感细腻"),
        ("对话式", "像跟观众聊天，亲切自然"),
        ("悬念式", "营造悬疑氛围，层层递进"),
        ("哲理式", "金句频出，引人深思"),
        ("快速节奏", "语速快，信息密集，紧张感"),
        ("缓慢悠长", "语速慢，留白多，意境深远"),
        ("幽默吐槽", "轻松诙谐，吐槽风格"),
        ("史诗感", "宏大叙事，历史厚重"),
        ("日记体", "如读日记，私密真实"),
        ("书信体", "如读信件，深情告白"),
        ("童话风", "故事感，梦幻童真"),
        ("新闻报道", "时效性强，事实导向"),
        ("访谈式", "一问一答，互动感"),
        ("留白式", "少说多留白，让画面说话"),
    ],
    "audio_bgm": [
        ("史诗管弦", "大型交响乐团，气势磅礴"),
        ("钢琴独奏", "纯净钢琴，抒情优雅"),
        ("电子合成", "合成器音色，现代科技感"),
        ("轻音乐", "舒缓柔和，放松治愈"),
        ("爵士乐", "即兴摇摆，慵懒优雅"),
        ("古典弦乐", "提琴四重奏，典雅庄重"),
        ("摇滚乐", "电吉他+鼓，热血澎湃"),
        ("中国风", "古筝/二胡/琵琶，东方韵味"),
        ("日本和风", "尺八/三味线，和风意境"),
        ("民族音乐", "各国民俗乐器，地域特色"),
        ("环境氛围", "无旋律纯氛围声景"),
        ("8-bit芯片", "复古游戏机音色，像素风"),
        ("Lofi HipHop", "低保真嘻哈，放松自习"),
        ("Trap", "808鼓+合成器，潮流前卫"),
        ("管风琴", "教堂管风琴，神圣庄严"),
        ("梦幻流行", "Dream Pop，迷幻空灵"),
        ("后摇滚", "Post-Rock，渐进爆发"),
        ("拉丁风情", "拉丁节奏，热情奔放"),
        ("印度风格", "西塔琴+塔布拉鼓，异域风情"),
        ("非洲鼓乐", "打击乐为主，原始力量"),
        ("极简主义", "重复音型，冥想感"),
        ("恐怖氛围", "不和谐音程+低频，紧张不安"),
        ("浪漫华尔兹", "三拍子舞曲，优雅旋转"),
        ("进行曲", "坚定有力，行进节奏"),
        ("环境白噪声", "雨声/海浪/风声作为背景音"),
    ],
    "audio_sfx": [
        ("脚步声", "不同地面材质：木地板/沙地/雪地"),
        ("开门声", "木门吱呀/铁门沉重/自动门滑动"),
        ("关门声", "轻关/重关/摔门"),
        ("风声", "微风/狂风/穿堂风"),
        ("雨声", "细雨/暴雨/雨打窗户"),
        ("雷声", "远雷轰鸣/近雷炸裂"),
        ("海浪声", "轻拍沙滩/巨浪拍岸"),
        ("鸟鸣", "清晨鸟叫/群鸟振翅"),
        ("虫鸣", "夏夜蝉鸣/蟋蟀"),
        ("汽车引擎", "启动/行驶/刹车/轰鸣"),
        ("火车声", "汽笛/铁轨/进站"),
        ("飞机声", "起飞/飞行/降落"),
        ("钟声", "教堂钟/寺庙钟/报时钟"),
        ("心跳声", "正常/加速/沉重"),
        ("呼吸声", "平静/急促/喘息"),
        ("枪声", "手枪/步枪/霰弹枪"),
        ("爆炸声", "近距/远距/闷响"),
        ("玻璃碎裂", "碎落一地/裂纹扩散"),
        ("水声", "滴水/流水/水花/水下"),
        ("火焰声", "篝火噼啪/大火燃烧"),
        ("纸张声", "翻页/撕纸/揉纸"),
        ("键盘打字", "机械键盘/薄膜键盘"),
        ("手机提示音", "消息/来电/振动"),
        ("刀剑声", "出鞘/碰撞/划破空气"),
        ("魔法音效", "咒语/传送/能量聚集"),
        ("动物叫声", "狗吠/猫叫/狼嚎/马嘶"),
        ("人群嘈杂", "餐厅/街道/商场环境音"),
        ("机械运转", "齿轮/引擎/机器人"),
        ("电闪音", "电流滋滋/电弧"),
        ("科幻音效", "传送门/光剑/UFO"),
    ],
}

for dim_key, words in SEED_WORDS.items():
    lib_id = libs.get(dim_key)
    if not lib_id:
        print(f"  [WARN] lib {dim_key} not found")
        continue
    
    # 检查是否已有数据
    existing_count = db.execute(
        "SELECT COUNT(*) as cnt FROM prompt_word_card WHERE library_id=?", (lib_id,)
    ).fetchone()['cnt']
    if existing_count > 0:
        print(f"  [SKIP] {dim_key}: {existing_count} cards exist")
        continue
    
    for i, (word_text, definition) in enumerate(words):
        db.execute(
            "INSERT INTO prompt_word_card (library_id, word_text, definition, heat_weight, is_system) VALUES (?,?,?,?,1)",
            (lib_id, word_text, definition, 1.0 - i * 0.01)
        )
    db.commit()
    print(f"  [OK] {dim_key}: {len(words)} seed cards")

print("\nPhase10 seed data done.")
