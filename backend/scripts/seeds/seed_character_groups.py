# -*- coding: utf-8 -*-
"""角色设定词卡分组种子 — 在词库中建「🎭 角色设定」根组 + 14 子分组并填充词卡，供角色组装调用。
幂等：分组按 group_key、词卡按(group_id,name)去重；执行前 VACUUM 快照。"""
import os, sys, sqlite3, time
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
BK = os.path.join(HERE, "..", "data", "backups")

ROOT = ("char_root", "🎭 角色设定", "🎭")
# key, 中文名, icon, [ (词卡名, content_en, content_zh, icon) ... ]
GROUPS = [
 ("char_gender_age","性别年龄","👥",[
   ("少女","young girl, teenage","妙龄少女","👧"),("青年女性","young woman","青年女性","👩"),
   ("成熟女性","mature elegant woman","成熟女性","💃"),("少年","teenage boy","翩翩少年","👦"),
   ("青年男性","young man","青年男性","👨"),("成熟男性","mature man","成熟男性","🧔"),
   ("儿童","cute child","可爱儿童","🧒"),("老者","elderly wise person","睿智老者","👴")]),
 ("char_hair","发型发色","💇",[
   ("黑长直","long straight black hair","黑色长直发","💇"),("大波浪卷","long wavy curls","大波浪卷发","🌊"),
   ("双马尾","twin ponytails","双马尾","🎀"),("低丸子头","low messy bun","慵懒低丸子头","🍡"),
   ("空气刘海","airy see-through bangs","空气刘海","🌬"),("银色中长发","silver medium hair","银色中长发","🩶"),
   ("冷棕短发","cool brown short hair","冷棕色短发","🟤"),("蓬松碎发","fluffy layered hair, wispy","蓬松凌乱碎发","☁")]),
 ("char_face","脸型五官","👁",[
   ("瓜子脸","oval face, pointed chin","瓜子脸尖下巴","🥚"),("圆脸","round soft face","圆润脸型","⭕"),
   ("精致五官","delicate refined features","精致五官","💎"),("大眼睛","big bright eyes","明亮大眼","👁"),
   ("卧蚕","aegyo-sal under eyes","卧蚕微凸","🌙"),("剑眉星目","sword brows, starry eyes","剑眉星目","⭐"),
   ("樱桃小嘴","small cherry lips","樱桃小嘴","🍒"),("挺直鼻梁","high straight nose bridge","高挺鼻梁","👃")]),
 ("char_expression","表情神态","😊",[
   ("元气笑容","energetic bright smile","元气满满笑容","😄"),("清冷疏离","cold aloof look","清冷疏离","🧊"),
   ("慵懒","languid lazy expression","慵懒神态","😪"),("温柔","gentle tender expression","温柔神情","🥰"),
   ("冷艳","cold glamorous expression","冷艳气场","💋"),("俏皮灵动","playful lively look","俏皮灵动","😜"),
   ("忧郁","melancholic gaze","柔和忧郁","🥀"),("坚定果敢","determined resolute","坚定果敢","🔥")]),
 ("char_body","体型身材","🧍",[
   ("纤瘦","slim slender figure","纤细身材","🌿"),("高挑","tall slender","高挑身姿","📏"),
   ("娇小","petite","娇小玲珑","🐚"),("健硕","muscular athletic build","健硕身材","💪"),
   ("标准身材","well-proportioned figure","匀称身材","⚖"),("丰腴","curvy figure","丰腴曲线","🍑")]),
 ("char_clothing","服装服饰","👗",[
   ("日式水手服","Japanese sailor uniform","日式水手服","🎽"),("汉服","Hanfu traditional dress","中国汉服","🀄"),
   ("黑色西装","black tailored suit","黑色廓形西装","🕴"),("oversize夹克","oversized jacket","oversize夹克","🧥"),
   ("机能风外套","techwear hooded jacket","机能风连帽外套","🧷"),("魔法轻甲","light magic armor","魔法轻甲","🛡"),
   ("波西米亚长裙","bohemian long dress","波西米亚长裙","👘"),("吊带连衣裙","slip dress","细肩带连衣裙","👗")]),
 ("char_accessory","配饰道具","💍",[
   ("银饰项链","silver necklace","银饰项链","📿"),("碎钻耳钉","diamond stud earrings","碎钻耳钉","💎"),
   ("草编帽","wide-brim straw hat","大檐草编帽","👒"),("黑框墨镜","black-framed sunglasses","黑框墨镜","🕶"),
   ("头戴耳机","over-ear headphones","复古头戴耳机","🎧"),("持剑","holding a sword","手持长剑","⚔"),
   ("花束","holding a bouquet","手捧花束","💐"),("发间花饰","floral hair accessory","发间花饰","🌸")]),
 ("char_pose","姿态动作","🤸",[
   ("持剑站立","standing with sword, cape flowing","持剑站立披风飞扬","🗡"),("双手托腮","hands cupping cheeks","双手托腮","🤲"),
   ("侧身回眸","looking back over shoulder","侧身回眸","🔄"),("倚墙而立","leaning against wall","随性倚墙","🧱"),
   ("慵懒坐姿","lounging sitting pose","慵懒坐姿","🛋"),("仰头","head tilted upward","微微仰头","⬆"),
   ("微风扬发","hair blowing in breeze","微风扬起发丝","🌬"),("手扶帽檐","hand on hat brim","单手扶帽檐","🎩")]),
 ("char_style","画风风格","🎨",[
   ("新海诚风格","Makoto Shinkai style","新海诚风格","🌅"),("日系赛璐珞","anime cel-shading","日系赛璐珞","🖍"),
   ("最终幻想风","Final Fantasy epic style","最终幻想史诗风","⚔"),("写实风格","photorealistic","超写实风格","📷"),
   ("CG渲染级","CG render quality","CG渲染级","🖥"),("港风复古","retro Hong Kong style","90年代港风","🎞"),
   ("胶片质感","film photography texture","胶片质感","🎬"),("水彩插画","watercolor illustration","水彩插画","🎨")]),
 ("char_lighting","光照氛围","💡",[
   ("逆光","backlight rim light","逆光轮廓光","🔆"),("丁达尔光束","Tyndall light beams, god rays","丁达尔光束","🌤"),
   ("冷白光","cool white light","冷白光","❄"),("暖金逆光","warm golden backlight","暖金逆光","🌇"),
   ("闪光灯直打","direct camera flash","手机闪光灯直打","📸"),("柔和窗光","soft window light","柔和窗光","🪟"),
   ("霓虹光","neon lighting","霓虹光","🌃"),("电影级布光","cinematic lighting","电影级布光","🎥")]),
 ("char_color","色调质感","🎞",[
   ("冷白皮","cool fair porcelain skin","冷白皮","🤍"),("暖色调","warm tone","暖色调","🟧"),
   ("莫兰迪配色","Morandi color palette","莫兰迪配色","🎨"),("低饱和清新","low-saturation fresh tone","低饱和清新","🌾"),
   ("胶片颗粒","film grain texture","胶片颗粒感","🎞"),("8K超清","8K ultra HD, hyper detailed","8K超清细节","🔬"),
   ("皮肤通透","translucent skin texture","皮肤通透质感","💧"),("高级灰调","sophisticated gray tone","高级灰调","🩶")]),
 ("char_occupation","职业身份","🪪",[
   ("学生","student","学生","🎓"),("冒险者","adventurer","冒险者","🧭"),("魔法师","mage sorcerer","魔法师","🔮"),
   ("骑士","knight in armor","骑士","🛡"),("都市白领","urban office lady","都市白领","💼"),
   ("音乐人","musician","音乐人","🎸"),("战士","warrior","战士","⚔"),("侦探","detective","侦探","🔍")]),
 ("char_temperament","气质性格","✨",[
   ("清冷","cold elegant aura","清冷气质","🧊"),("纯欲","pure yet alluring","纯欲风","🍑"),
   ("英气","heroic spirited","英气飒爽","⚡"),("优雅高冷","elegant and aloof","优雅高冷","🦢"),
   ("治愈甜美","healing sweet","治愈甜美","🍬"),("神秘","mysterious","神秘感","🌌"),
   ("腹黑","scheming charming","腹黑","😏"),("松弛慵懒","relaxed languid","松弛慵懒","🌴")]),
 ("char_background","背景场景","🏞",[
   ("樱花校园","cherry blossom campus","樱花校园","🌸"),("远古遗迹","ancient ruins","远古遗迹","🏛"),
   ("都市街道","urban city street","都市街道","🏙"),("海边","seaside beach","海边","🏖"),
   ("咖啡馆","cozy cafe interior","咖啡馆","☕"),("森林","lush forest","森林","🌲"),
   ("霓虹夜景","neon night cityscape","霓虹夜景","🌃"),("室内暖光","warm indoor room","室内暖光房间","🛏")]),
]


def main():
    os.makedirs(BK, exist_ok=True)
    bak = os.path.join(BK, "charseed_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)"); s.execute("VACUUM INTO ?", [bak]); print("[OK] 备份", bak)
    except Exception as e:
        import shutil; shutil.copy2(DB, bak); print("[WARN] copy", e)
    finally:
        s.close()

    c = sqlite3.connect(DB, timeout=15); c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    try:
        def get_group(key):
            r = c.execute("SELECT id FROM word_card_group WHERE group_key=?", [key]).fetchone()
            return r["id"] if r else None
        # 根组
        root_id = get_group(ROOT[0])
        if not root_id:
            c.execute("""INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,sort_order,is_active,created_at,updated_at)
                         VALUES (?,?,?,'custom',NULL,6,1,datetime('now','localtime'),datetime('now','localtime'))""",
                      [ROOT[1], ROOT[0], ROOT[2]])
            root_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            print("[OK] 根组 char_root id=%d" % root_id)
        else:
            print("[SKIP] 根组已存在 id=%d" % root_id)

        n_g = n_c = 0
        for si, (gkey, gname, gicon, cards) in enumerate(GROUPS):
            gid = get_group(gkey)
            if not gid:
                c.execute("""INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,sort_order,is_active,created_at,updated_at)
                             VALUES (?,?,?,'sub',?,?,1,datetime('now','localtime'),datetime('now','localtime'))""",
                          [gname, gkey, gicon, root_id, 10 + si])
                gid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
                n_g += 1
            for ci, (cn, en, zh, ic) in enumerate(cards):
                ex = c.execute("SELECT 1 FROM word_card WHERE group_id=? AND name=?", [gid, cn]).fetchone()
                if ex:
                    continue
                c.execute("""INSERT INTO word_card
                    (group_id,name,content,content_zh,content_en,meaning,module,category,media_type,card_role,structured,version,sort_order,usage_count,heat_weight,is_builtin,is_deleted,icon,tags,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?, 'image','component','{}',1,?,0,0.0,1,0,?, '[]', datetime('now','localtime'),datetime('now','localtime'))""",
                    [gid, cn, en, zh or cn, en, zh or cn, "character", gname, ci, ic])
                n_c += 1
        c.commit()
        total = c.execute("SELECT COUNT(1) FROM word_card w JOIN word_card_group g ON g.id=w.group_id WHERE g.group_key LIKE 'char_%'").fetchone()[0]
        print("\n[DONE] 新增子分组 %d，新增词卡 %d；角色分组词卡总计 %d" % (n_g, n_c, total))
        print("FTS 计数:", c.execute("SELECT COUNT(1) FROM word_card_fts").fetchone()[0])
    finally:
        c.close()


if __name__ == "__main__":
    main()
