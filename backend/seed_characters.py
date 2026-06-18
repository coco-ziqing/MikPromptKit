"""
v4.0.0-phase10.1: Character Library Seed Data
8个预设角色模板（涵盖常见角色类型）
"""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db

db = get_db()

# Check if already seeded
count = db.execute("SELECT COUNT(*) as c FROM character_profiles WHERE is_builtin=1").fetchone()["c"]
if count > 0:
    print(f"[SKIP] {count} built-in characters already exist")
    exit(0)

CHARACTERS = [
    {
        "name": "主角·李明",
        "gender": "男",
        "age_range": "25-30岁",
        "occupation": "都市白领 / 程序员",
        "personality": "内向沉稳、逻辑清晰、重情义、偶尔腹黑",
        "appearance": "中等身材，戴黑框眼镜，短发整洁，穿深色休闲西装，眼神专注而温和",
        "voice_type": "年轻男声，中音区，清晰有力",
        "voice_detail": "语速适中，声线干净，咬字清楚",
        "narration_style": "第一人称",
        "role_position": "故事主角 / 第一视角叙述者",
        "backstory": "从小城市来到大都市打拼的青年，在一家科技公司做前端开发。热爱摄影和咖啡，独自租住在一间能看到城市天际线的公寓里。父母在老家开小超市，每月会视频通话。",
        "tags": ["都市", "奋斗", "内敛", "主角"],
    },
    {
        "name": "女主·苏雨晴",
        "gender": "女",
        "age_range": "22-26岁",
        "occupation": "插画师 / 自由职业者",
        "personality": "温柔独立、略带傲娇、艺术气质、内心敏感",
        "appearance": "长发及肩带微卷，常扎低马尾，爱穿米色/浅蓝等柔色调衣服，手腕常戴一条手工编织的红绳，皮肤白皙，笑起来眼睛弯弯的",
        "voice_type": "年轻女声，柔和清亮",
        "voice_detail": "声线甜美但有力度，情绪变化丰富",
        "narration_style": "内心独白",
        "role_position": "故事女主角 / 情感核心",
        "backstory": "美院毕业后成为自由插画师，在社交媒体上有不少粉丝。梦想是出自己的绘本。小时候父母离异，跟妈妈长大，所以性格既独立又渴望被爱。养了一只叫小橘的橘猫。",
        "tags": ["都市", "文艺", "独立女性", "女主"],
    },
    {
        "name": "反派·暗影",
        "gender": "男",
        "age_range": "40-50岁",
        "occupation": "商业巨头 / 神秘组织首脑",
        "personality": "冷静狠辣、城府极深、对下属严苛、有自己的一套道德观",
        "appearance": "高个子，银灰色背头，眼神锐利，穿定制黑色长外套，常戴皮革手套，右手无名指有一枚银色蛇形戒指，面容棱角分明",
        "voice_type": "低沉磁性，浑厚有力",
        "voice_detail": "语速慢而有力，每句话都有分量，偶尔冷笑",
        "narration_style": "第三人称",
        "role_position": "主要反派 / 幕后操盘者",
        "backstory": "出身贫寒，靠自己的手腕和冷酷一步步建立商业帝国。认为世界是弱肉强食的丛林，对弱者既鄙视又怜悯。曾有一个挚爱的妹妹因病去世，成为他内心唯一的柔软之处。",
        "tags": ["黑暗", "精英", "反派", "复杂"],
    },
    {
        "name": "导师·老陈",
        "gender": "男",
        "age_range": "55-65岁",
        "occupation": "退休教授 / 技术顾问",
        "personality": "睿智幽默、看透世事、偶尔毒舌、心怀大爱",
        "appearance": "花白短发，戴老花镜，爱穿格子衬衫和棕色夹克，手里常端着一杯茶，笑起来眼睛眯成缝，有点驼背但精神矍铄",
        "voice_type": "老年男声，沙哑缓慢，沧桑感",
        "voice_detail": "语速慢，带一点北方口音，说话时喜欢停顿思考",
        "narration_style": "哲理式",
        "role_position": "智慧导师 / 剧情推动者",
        "backstory": "曾是某知名大学的计算机系教授，退休后隐居在郊外一间小院里。妻子过世多年，儿女在国外。喜欢种花和修理老式收音机。年轻时参与过国家级项目，但从不炫耀。",
        "tags": ["智慧", "温暖", "导师", "老派"],
    },
    {
        "name": "少女·小铃",
        "gender": "女",
        "age_range": "14-17岁",
        "occupation": "高中生 / 短视频博主",
        "personality": "活泼开朗、好奇心旺盛、有点莽撞、重朋友义气",
        "appearance": "齐耳短发，大眼睛闪闪发光，常穿宽松卫衣和帆布鞋，背着一个挂满徽章的双肩包，笑起来有虎牙，脸上有几点雀斑",
        "voice_type": "少女音，活泼甜美",
        "voice_detail": "语速快，音调高，笑声有感染力",
        "narration_style": "第一人称",
        "role_position": "年轻视角角色 / 喜剧担当",
        "backstory": "普通高中生，喜欢拍短视频记录日常生活。家里开了一家小面馆，放学后会去帮忙。梦想是成为旅行博主环游世界。最好的朋友是同桌小美，两人经常一起做傻事。",
        "tags": ["青春", "活力", "治愈", "少女"],
    },
    {
        "name": "硬汉·雷哥",
        "gender": "男",
        "age_range": "35-42岁",
        "occupation": "退伍军人 / 私家侦探",
        "personality": "沉默寡言、行动派、正义感强、对亲近的人话多",
        "appearance": "体格魁梧，短发板寸，脸上有一道从左眉到颧骨的旧伤疤，常穿深色战术夹克，右手腕戴军用手表，肌肉结实但不夸张",
        "voice_type": "成熟男声，低沉有力",
        "voice_detail": "说话简洁，不爱废话，愤怒时声音低沉如雷",
        "narration_style": "留白式",
        "role_position": "动作担当 / 保护者",
        "backstory": "曾是特种部队成员，在一次任务中负伤退役。现在开了一家小型私人侦探所，接些寻人寻物的案子。养了一条退役军犬叫黑豹。内心深处仍在处理战争留下的创伤。",
        "tags": ["硬汉", "动作", "正义", "退伍"],
    },
    {
        "name": "神秘人·白",
        "gender": "未知",
        "age_range": "外表25岁，实际年龄不详",
        "occupation": "情报贩子 / 中间人",
        "personality": "神秘莫测、优雅从容、不说真话也不说假话、永远留后手",
        "appearance": "中性装扮，白色长外套，银白色长发束在脑后，瞳孔颜色极浅近乎透明，肤色苍白，声音中性无法判断性别，手指修长，总戴一只银色手镯",
        "voice_type": "电子合成音/中性音",
        "voice_detail": "经过变声处理的中性音，语气平静如水，不带任何情绪",
        "narration_style": "第三人称",
        "role_position": "关键配角 / 信息源头",
        "backstory": "身份成谜。有人说TA是某个情报机构的叛逃者，有人说TA是AI。没人知道TA的真名和来历，但所有地下情报交易都绕不开TA。永远准时，永远在暗处交易。",
        "tags": ["神秘", "中性", "情报", "高冷"],
    },
    {
        "name": "宠物·小橘",
        "gender": "公",
        "age_range": "2岁",
        "occupation": "橘猫 / 家庭宠物",
        "personality": "贪吃慵懒、傲娇可爱、关键时刻意外靠谱",
        "appearance": "橘色短毛猫，胖乎乎的，肚皮白色，圆脸大眼，尾巴又粗又长，戴一个红色小铃铛项圈",
        "voice_type": "喵叫 + 心理活动拟人化（少年音）",
        "voice_detail": "心理活动用少年音，可爱卖萌，偶尔吐槽",
        "narration_style": "内心独白",
        "role_position": "萌宠担当 / 搞笑调节",
        "backstory": "苏雨晴养的橘猫，在宠物店花30块钱买的。除了吃和睡什么都不上心，但总能在主人难过时蹭过去安慰。其实非常聪明，只是懒得表现出来。",
        "tags": ["宠物", "猫咪", "治愈", "搞笑"],
    },
]

for i, c in enumerate(CHARACTERS):
    db.execute("""
        INSERT INTO character_profiles (
            name, gender, age_range, occupation, personality, appearance,
            voice_type, voice_detail, narration_style, role_position,
            backstory, notes, tags, is_builtin, sort_order
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
    """, [
        c["name"], c["gender"], c["age_range"], c["occupation"],
        c["personality"], c["appearance"], c["voice_type"],
        c["voice_detail"], c["narration_style"], c["role_position"],
        c["backstory"], "", json.dumps(c.get("tags", []), ensure_ascii=False),
        i + 1
    ])

db.commit()
print(f"[OK] Seeded {len(CHARACTERS)} built-in character profiles")
