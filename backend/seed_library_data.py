"""
词库填充脚本 — 完善各分类词库数据
插入到 library_assets 表
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db, safe_commit

DATA = {
    "action": {
        "lib_type": "action",
        "name": "动作词库",
        "icon": "🏃",
        "items": [
            # 行走/移动
            {"name": "行走", "prompt": "walking, walking forward, walking slowly"},
            {"name": "奔跑", "prompt": "running, sprinting, dashing forward, rushing"},
            {"name": "跳跃", "prompt": "jumping, leaping, hopping, bouncing up"},
            {"name": "攀爬", "prompt": "climbing, scaling, crawling up"},
            {"name": "滑行", "prompt": "sliding, gliding, skating, slipping across"},
            {"name": "旋转", "prompt": "spinning, twirling, rotating, pirouetting"},
            {"name": "漂浮", "prompt": "floating, hovering, drifting, levitating"},
            {"name": "坠落", "prompt": "falling, dropping, plunging, descending rapidly"},
            {"name": "游泳", "prompt": "swimming, diving, paddling, submerging"},
            {"name": "飞行", "prompt": "flying, soaring, gliding through air, hovering above"},
            # 战斗/攻击
            {"name": "挥拳", "prompt": "punching, throwing a punch, striking with fist"},
            {"name": "踢击", "prompt": "kicking, roundhouse kick, high kick, side kick"},
            {"name": "挥剑", "prompt": "swinging a sword, blade slash, sword strike"},
            {"name": "射击", "prompt": "shooting, firing a gun, aiming and shooting"},
            {"name": "闪避", "prompt": "dodging, evading, ducking, sidestepping"},
            {"name": "格挡", "prompt": "blocking, parrying, deflecting, guarding"},
            {"name": "翻滚", "prompt": "rolling, tumbling, somersaulting, barrel roll"},
            {"name": "冲刺", "prompt": "charging, lunging, lunging forward, dashing in"},
            {"name": "投掷", "prompt": "throwing, tossing, hurling, flinging object"},
            {"name": "爆炸冲击", "prompt": "explosion blast, shockwave, debris flying outward"},
            # 舞蹈/表演
            {"name": "舞蹈", "prompt": "dancing, performing, moving rhythmically"},
            {"name": "鞠躬", "prompt": "bowing, taking a bow, bending forward gracefully"},
            {"name": "伸展", "prompt": "stretching, reaching out, extending arms"},
            {"name": "挥手", "prompt": "waving, hand waving, gesturing with hand"},
            # 生活动作
            {"name": "坐下", "prompt": "sitting down, taking a seat, lowering onto chair"},
            {"name": "站起", "prompt": "standing up, rising to feet, getting up"},
            {"name": "转身", "prompt": "turning around, turning back, rotating body"},
            {"name": "蹲下", "prompt": "crouching, squatting, ducking down, kneeling"},
            {"name": "拿起", "prompt": "picking up, grabbing, lifting, taking in hand"},
            {"name": "放下", "prompt": "putting down, placing, setting down gently"},
            {"name": "推拉", "prompt": "pushing, pulling, dragging, tugging"},
            {"name": "拥抱", "prompt": "hugging, embracing, holding close, cuddling"},
            {"name": "握手", "prompt": "handshake, shaking hands, greeting with handshake"},
            {"name": "进食", "prompt": "eating, drinking, sipping, taking a bite"},
            # 表情/情绪动作
            {"name": "微笑", "prompt": "smiling, gentle smile, beaming, grinning"},
            {"name": "哭泣", "prompt": "crying, weeping, sobbing, tears streaming down"},
            {"name": "回头", "prompt": "looking back, glancing back, turning head to look behind"},
            {"name": "凝视", "prompt": "gazing, staring, looking intently, eyes fixed on"},
            {"name": "眨眼", "prompt": "blinking, winking, flutter of eyelashes"},
            # 慢动作
            {"name": "慢动作行走", "prompt": "slow motion walking, walking in slow motion, graceful stride"},
            {"name": "慢动作奔跑", "prompt": "slow motion running, running in slow motion, each step visible"},
            {"name": "慢动作转身", "prompt": "slow motion turn, turning slowly, gradual rotation"},
            {"name": "慢动作舞蹈", "prompt": "slow motion dance, dancing in slow motion, fluid movement"},
            {"name": "慢动作跳跃", "prompt": "slow motion jump, leaping in slow motion, floating through air"},
        ]
    },
    "camera_move": {
        "lib_type": "camera_move",
        "name": "运镜词库",
        "icon": "🎥",
        "items": [
            {"name": "推镜", "prompt": "camera slow push-in, dolly in towards subject"},
            {"name": "拉镜", "prompt": "camera pull-out, dolly out, reveal wide shot"},
            {"name": "摇镜", "prompt": "camera pan left, lateral motion, panning across scene"},
            {"name": "跟镜", "prompt": "tracking shot, camera follows subject movement"},
            {"name": "环绕", "prompt": "camera orbit, arc around subject, circling shot"},
            {"name": "航拍", "prompt": "aerial shot, drone shot, bird's eye view descending"},
            {"name": "手持", "prompt": "handheld camera, slight natural shake, documentary style"},
            {"name": "固定", "prompt": "locked-off camera, fixed frame, stationary shot"},
            {"name": "升降", "prompt": "camera crane up, boom shot, rising elevation"},
            {"name": "低角度", "prompt": "low angle shot, camera looking up, ground level view"},
            {"name": "高角度", "prompt": "high angle shot, overhead view, looking down"},
            {"name": "特写推入", "prompt": "extreme close-up push-in, slow zoom to face"},
            {"name": "急推", "prompt": "quick push-in, rapid dolly towards subject, dramatic emphasis"},
            {"name": "横移", "prompt": "camera lateral tracking, side movement, sliding sideways"},
            {"name": "俯拍", "prompt": "top-down shot, overhead camera, directly above"},
            {"name": "仰拍", "prompt": "low angle looking up, worm's eye view"},
            {"name": "甩镜", "prompt": "camera whip pan, fast horizontal swish, rapid turn"},
            {"name": "伸缩", "prompt": "camera zoom in then pull out, dolly zoom effect"},
            {"name": "滑轨", "prompt": "slider shot, smooth lateral dolly, cinematic slide"},
            {"name": "斯坦尼康", "prompt": "Steadicam shot, smooth following camera, walking alongside"},
        ]
    },
    "lighting": {
        "lib_type": "lighting",
        "name": "光影词库",
        "icon": "💡",
        "items": [
            {"name": "黄金时刻", "prompt": "golden hour lighting, warm sunset glow, soft warm tones"},
            {"name": "蓝色时刻", "prompt": "blue hour, twilight lighting, cool blue tones, dusk glow"},
            {"name": "逆光", "prompt": "backlighting, rim light, subject silhouetted against light"},
            {"name": "侧光", "prompt": "side lighting, dramatic shadows, chiaroscuro effect"},
            {"name": "顶光", "prompt": "top lighting, overhead light, noon sun, harsh shadows"},
            {"name": "柔光", "prompt": "soft lighting, diffused light, gentle illumination, overcast"},
            {"name": "硬光", "prompt": "hard lighting, direct light, strong contrast, sharp shadows"},
            {"name": "霓虹光", "prompt": "neon lighting, cyberpunk glow, colored neon tubes"},
            {"name": "烛光", "prompt": "candlelight, warm flickering flame, intimate low light"},
            {"name": "月光", "prompt": "moonlight, silver blue glow, night illumination, pale light"},
            {"name": "日光灯", "prompt": "fluorescent lighting, cool white, office flat light"},
            {"name": "聚光灯", "prompt": "spotlight, focused beam, stage lighting, center illuminated"},
            {"name": "窗光", "prompt": "window light, natural side illumination, soft daylight pouring in"},
            {"name": "火光", "prompt": "fire light, warm orange glow, flickering flame illumination"},
            {"name": "闪电", "prompt": "lightning flash, stroboscopic, brief bright burst"},
            {"name": "彩色凝胶", "prompt": "colored gel lighting, magenta cyan mix, dramatic stage color"},
            {"name": "伦勃朗光", "prompt": "Rembrandt lighting, triangle light on cheek, classic portrait"},
            {"name": "蝴蝶光", "prompt": "butterfly lighting, loop lighting, beauty portrait classic"},
            {"name": "投影", "prompt": "projected shadows, patterned light, shadow play on surface"},
            {"name": "体积光", "prompt": "volumetric lighting, god rays, light beams through fog"},
        ]
    },
    "scene": {
        "lib_type": "scene",
        "name": "场景词库",
        "icon": "🌄",
        "items": [
            {"name": "城市街道", "prompt": "urban street, city sidewalk, bustling city street"},
            {"name": "霓虹夜市", "prompt": "neon night market, illuminated street stalls, evening bazaar"},
            {"name": "摩天楼顶", "prompt": "skyscraper rooftop, high-rise terrace, city skyline view"},
            {"name": "森林深处", "prompt": "deep forest, dense woodland, ancient trees, mossy ground"},
            {"name": "海边沙滩", "prompt": "beach shoreline, sandy beach, ocean waves, seaside"},
            {"name": "悬崖海岸", "prompt": "cliffside coast, rocky shore, waves crashing, dramatic coastline"},
            {"name": "雪山峰顶", "prompt": "snowy mountain peak, alpine summit, snow-covered ridge"},
            {"name": "沙漠戈壁", "prompt": "desert dunes, sandy expanse, arid landscape, golden sand"},
            {"name": "古老寺庙", "prompt": "ancient temple, traditional shrine, pagoda, sacred architecture"},
            {"name": "废墟遗迹", "prompt": "ruins, ancient ruins, collapsed columns, abandoned structure"},
            {"name": "城堡内部", "prompt": "castle interior, stone hall, grand staircase, medieval chamber"},
            {"name": "未来城市", "prompt": "futuristic city, neon metropolis, flying vehicles, high tech"},
            {"name": "赛博朋克街巷", "prompt": "cyberpunk alley, neon signs, rain soaked streets, holograms"},
            {"name": "太空站", "prompt": "space station, zero gravity, starfield view, orbital module"},
            {"name": "地下洞穴", "prompt": "underground cave, stalactites, crystal cavern, dark grotto"},
            {"name": "雨中街道", "prompt": "rainy street, wet pavement, umbrella, rain reflections"},
            {"name": "清晨薄雾", "prompt": "morning mist, foggy dawn, hazy landscape, soft morning light"},
            {"name": "夕阳晚霞", "prompt": "sunset, orange sky, purple horizon, golden clouds, dusk"},
            {"name": "樱花树下", "prompt": "under cherry blossoms, falling petals, pink canopy, spring scene"},
            {"name": "竹林小径", "prompt": "bamboo forest path, green stalks, dappled light, tranquil walk"},
            {"name": "图书馆", "prompt": "library, tall bookshelves, reading room, quiet study space"},
            {"name": "咖啡馆", "prompt": "cafe interior, coffee shop, cozy seating, warm ambient lighting"},
            {"name": "教室", "prompt": "classroom, desks, chalkboard, school windows, daylight"},
            {"name": "地下车库", "prompt": "underground parking, concrete pillars, dim lighting, empty garage"},
            {"name": "火车站台", "prompt": "train platform, railway station, arriving train, commuters"},
            {"name": "水下世界", "prompt": "underwater, coral reef, marine life, sun rays through water"},
            {"name": "花田", "prompt": "flower field, blooming meadow, wildflowers, colorful petals"},
            {"name": "火山熔岩", "prompt": "volcanic landscape, flowing lava, molten rock, volcanic glow"},
            {"name": "极光天空", "prompt": "aurora borealis, northern lights, green sky, starry night"},
            {"name": "战争废墟", "prompt": "war ruins, destroyed buildings, smoke, debris, post apocalyptic"},
        ]
    },
    "emotion": {
        "lib_type": "emotion",
        "name": "情绪词库",
        "icon": "💫",
        "items": [
            {"name": "欢乐", "prompt": "joyful, happy, cheerful, delighted, elated mood"},
            {"name": "悲伤", "prompt": "sad, sorrowful, melancholic, grieving, mournful"},
            {"name": "愤怒", "prompt": "angry, furious, enraged, irritated, wrathful expression"},
            {"name": "恐惧", "prompt": "fearful, terrified, scared, panicked, horrified"},
            {"name": "惊讶", "prompt": "surprised, astonished, amazed, stunned, shocked"},
            {"name": "平静", "prompt": "calm, serene, peaceful, tranquil, composed"},
            {"name": "浪漫", "prompt": "romantic, tender, affectionate, loving, intimate"},
            {"name": "神秘", "prompt": "mysterious, enigmatic, cryptic, secretive, mystical"},
            {"name": "紧张", "prompt": "tense, nervous, anxious, uneasy, strained atmosphere"},
            {"name": "梦幻", "prompt": "dreamy, ethereal, surreal, otherworldly, whimsical"},
            {"name": "忧郁", "prompt": "melancholy, wistful, blue, somber, pensive mood"},
            {"name": "怀旧", "prompt": "nostalgic, sentimental, reminiscent, longing for past"},
            {"name": "庄严", "prompt": "solemn, majestic, grand, dignified, ceremonial"},
            {"name": "诡异", "prompt": "eerie, uncanny, unsettling, creepy, ominous atmosphere"},
            {"name": "希望", "prompt": "hopeful, optimistic, uplifting, inspiring, bright future"},
            {"name": "孤独", "prompt": "lonely, isolated, solitary, abandoned, forlorn"},
            {"name": "温暖", "prompt": "warm, cozy, comfortable, heartwarming, fuzzy feeling"},
            {"name": "肃穆", "prompt": "somber, grave, serious, austere, subdued mood"},
            {"name": "狂喜", "prompt": "ecstatic, euphoric, overjoyed, exhilarated, thrilled"},
            {"name": "沉思", "prompt": "contemplative, thoughtful, reflective, introspective, pensive"},
        ]
    },
    "weather": {
        "lib_type": "weather",
        "name": "天气词库",
        "icon": "🌤️",
        "items": [
            {"name": "晴天", "prompt": "sunny, clear sky, bright daylight, cloudless"},
            {"name": "多云", "prompt": "cloudy, overcast, gray sky, diffused light"},
            {"name": "下雨", "prompt": "rainy, light rain, pouring, drizzle, rainstorm"},
            {"name": "暴雨", "prompt": "heavy rain, downpour, torrential rain, thunderstorm"},
            {"name": "暴风雪", "prompt": "blizzard, snowstorm, heavy snowfall, whiteout conditions"},
            {"name": "下雪", "prompt": "snowing, gentle snowfall, snowflakes falling, winter scene"},
            {"name": "起雾", "prompt": "foggy, misty, hazy, low visibility, fog rolling in"},
            {"name": "大风", "prompt": "windy, strong wind, gusts, blustery, leaves blowing"},
            {"name": "沙尘暴", "prompt": "sandstorm, dust storm, desert wind, airborne sand"},
            {"name": "雷暴", "prompt": "thunderstorm, lightning, thunder, electrical storm"},
            {"name": "彩虹", "prompt": "rainbow, colorful arc across sky, after rain"},
            {"name": "雨后", "prompt": "after rain, wet ground, fresh air, puddles reflecting sky"},
        ]
    },
    "speed": {
        "lib_type": "speed",
        "name": "速率词库",
        "icon": "⚡",
        "items": [
            {"name": "极慢", "prompt": "imperceptible movement, barely moving, almost still"},
            {"name": "缓慢", "prompt": "slow, gentle, gradual movement, unhurried pace"},
            {"name": "中等", "prompt": "smooth, controlled, natural rhythm, moderate pace"},
            {"name": "快速", "prompt": "dynamic, swift, rapid, fast-paced, energetic motion"},
            {"name": "极速", "prompt": "extremely fast, lightning speed, blurring motion, supersonic"},
            {"name": "慢速优雅", "prompt": "slow and graceful, elegant movement, deliberate pace"},
            {"name": "加速", "prompt": "accelerating, gradually speeding up, picking up speed"},
            {"name": "减速", "prompt": "decelerating, slowing down, gradually stopping"},
            {"name": "急促", "prompt": "urgent, hurried, rushed, frantic movement"},
            {"name": "平稳", "prompt": "steady, stable, consistent pace, even speed"},
        ]
    },
    "composition": {
        "lib_type": "composition",
        "name": "构图词库",
        "icon": "📐",
        "items": [
            {"name": "中心构图", "prompt": "centered composition, subject in middle, symmetrical frame"},
            {"name": "三分法", "prompt": "rule of thirds, subject off-center, balanced negative space"},
            {"name": "引导线", "prompt": "leading lines, converging lines, depth perspective"},
            {"name": "框架构图", "prompt": "framed composition, natural frame, doorway framing"},
            {"name": "对称构图", "prompt": "symmetrical composition, mirror image, balanced halves"},
            {"name": "斜线构图", "prompt": "diagonal composition, dynamic angle, asymmetrical tension"},
            {"name": "留白构图", "prompt": "negative space, ample empty space, minimalist composition"},
            {"name": "填充构图", "prompt": "filling the frame, tight crop, close crop on subject"},
            {"name": "俯瞰构图", "prompt": "top-down composition, bird's eye layout, flat lay"},
            {"name": "特写构图", "prompt": "close-up composition, tight framing, detail focused"},
            {"name": "广角构图", "prompt": "wide angle composition, expansive view, distorted edges"},
            {"name": "长焦构图", "prompt": "telephoto composition, compressed perspective, flat depth"},
            {"name": "前景构图", "prompt": "foreground framing, layered composition, depth through foreground"},
            {"name": "倒影构图", "prompt": "reflection composition, mirror reflection, water reflection"},
            {"name": "剪影构图", "prompt": "silhouette composition, subject dark against bright background"},
        ]
    },
}

def run():
    db = get_db()
    total = 0
    
    for cat_key, cat_data in DATA.items():
        lib_type = cat_data["lib_type"]
        existing = db.execute(
            "SELECT COUNT(*) as c FROM library_assets WHERE lib_type=?", (lib_type,)
        ).fetchone()["c"]
        
        if existing > 0:
            print(f"[跳过] {lib_type} 已有 {existing} 条")
            # 仍然打印统计但不重复插入
            total += existing
            continue
        
        sort = 0
        for item in cat_data["items"]:
            db.execute("""
                INSERT INTO library_assets 
                    (lib_type, name, icon, category, prompt, definition, tags, is_builtin, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            """, (
                lib_type,
                item["name"],
                cat_data.get("icon", ""),
                cat_data["name"],
                item["prompt"],
                item["name"],
                json.dumps([cat_data["name"]], ensure_ascii=False),
                sort
            ))
            sort += 1
            total += 1
        
        safe_commit()
        print(f"[新增] {lib_type}: {len(cat_data['items'])} 条")
    
    # 重新统计各类别
    rows = db.execute("""
        SELECT lib_type, COUNT(*) as cnt 
        FROM library_assets 
        GROUP BY lib_type 
        ORDER BY cnt DESC
    """).fetchall()
    
    print(f"\n{'='*50}")
    print("词库总统计:")
    grand = 0
    for r in rows:
        print(f"  {r['lib_type']}: {r['cnt']} 条")
        grand += r['cnt']
    print(f"  总计: {grand} 条")
    print(f"{'='*50}")

if __name__ == "__main__":
    run()
