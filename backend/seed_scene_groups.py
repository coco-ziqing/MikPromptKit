# -*- coding: utf-8 -*-
"""场景设定词卡分组种子 — 词库中建「🏞 场景设定」根组 + 13 子分组并填充词卡，供场景组装调用。幂等+快照。"""
import os, sys, sqlite3, time
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
BK = os.path.join(HERE, "..", "data", "backups")
ROOT = ("scene_root", "🏞 场景设定", "🏞")
GROUPS = [
 ("scene_location","场景类型","🏞",[
   ("未来都市","futuristic neon city","霓虹未来都市","🌆"),("魔法森林","ancient magic forest","古老魔法森林","🌲"),
   ("远古神殿","ancient temple ruins","远古神殿遗迹","🏛"),("海边悬崖","seaside cliff","静谧海边悬崖","🌊"),
   ("北欧雪村","snowy nordic village","北欧雪村","🏘"),("繁华街道","bustling city street","繁华街道","🏙"),
   ("室内咖啡馆","cozy cafe interior","室内咖啡馆","☕"),("山谷","misty valley","云雾山谷","⛰")]),
 ("scene_architecture","建筑风格","🏛",[
   ("赛博摩天楼","cyberpunk skyscrapers","赛博摩天楼","🏢"),("精灵树屋","elven treehouse","精灵树屋","🌳"),
   ("巨石柱廊","massive stone colonnade","巨石柱廊","🏛"),("尖顶木屋","pitched-roof wooden house","尖顶木屋","🏠"),
   ("哥特教堂","gothic cathedral","哥特教堂","⛪"),("中式庭院","Chinese courtyard","中式庭院","🏯"),
   ("玻璃幕墙","modern glass curtain wall","现代玻璃幕墙","🏬"),("废墟","crumbling ruins","断壁残垣废墟","🏚")]),
 ("scene_time","时间时刻","🕐",[
   ("清晨","early morning","清晨","🌅"),("正午","high noon","正午","☀"),("黄昏","dusk","黄昏时分","🌇"),
   ("深夜","late night","深夜","🌃"),("日落黄金时刻","golden hour sunset","日落黄金时刻","🌄"),
   ("晨曦","dawn twilight","晨曦微光","🌤"),("傍晚","evening","傍晚","🌆"),("凌晨","pre-dawn","凌晨","🌌")]),
 ("scene_season","季节气候","🍂",[
   ("春季","spring","春季","🌸"),("盛夏","midsummer","盛夏","🌞"),("深秋","late autumn","深秋","🍁"),
   ("隆冬","deep winter","隆冬","❄"),("初春","early spring","初春","🌱"),("金秋","golden autumn","金秋","🍂")]),
 ("scene_weather","天气现象","🌦",[
   ("晴朗","clear sky","晴朗","☀"),("细雨","light drizzle","细雨霏霏","🌧"),("薄雾","thin mist","薄雾缭绕","🌫"),
   ("大雪纷飞","heavy snowfall","大雪纷飞","🌨"),("沙尘","dust haze","沙尘轻扬","🏜"),("雷暴","thunderstorm","雷暴","⛈"),
   ("晚霞满天","sky full of sunset glow","晚霞漫天","🌅"),("多云","cloudy","多云","☁")]),
 ("scene_atmosphere","氛围情绪","🎭",[
   ("冷峻神秘","cold and mysterious","冷峻神秘","🌑"),("静谧神圣","serene and sacred","静谧神圣","🕊"),
   ("庄严沧桑","solemn and weathered","庄严沧桑","🗿"),("浪漫宁静","romantic and tranquil","浪漫宁静","💗"),
   ("温馨节日","warm festive","温馨节日","🎄"),("压抑黑暗","oppressive dark","压抑黑暗","🖤"),
   ("梦幻空灵","dreamy ethereal","梦幻空灵","✨"),("热闹喧嚣","lively bustling","热闹喧嚣","🎉")]),
 ("scene_lighting","光影效果","💡",[
   ("霓虹荧光","neon glow from below","霓虹荧光下打","🌈"),("金色晨光","golden morning light","金色晨光","🌅"),
   ("暖橙夕阳","warm orange sunset light","暖橙夕阳","🌇"),("丁达尔光束","Tyndall god rays","丁达尔光束","🌤"),
   ("冷白光","cool white light","冷白光","❄"),("烛光","candlelight","温暖烛光","🕯"),
   ("月光","moonlight","清冷月光","🌙"),("逆光","backlight silhouette","逆光剪影","🔆")]),
 ("scene_color","色彩搭配","🎨",[
   ("青蓝紫粉撞色","cyan-blue and purple-pink contrast","青蓝+紫粉撞色","🟣"),("翠绿金色","emerald and gold","翠绿+金色暖调","💚"),
   ("金橙深褐","gold-orange and deep brown","金橙+深褐史诗色","🟤"),("暖橙粉紫渐变","warm orange to pink-purple gradient","暖橙+粉紫渐变","🌈"),
   ("白暖黄深蓝","white warm-yellow deep-blue","白+暖黄+深蓝","🔵"),("莫兰迪","Morandi muted palette","莫兰迪配色","🩶"),
   ("高饱和","high saturation vivid","高饱和鲜艳","🌟"),("黑金","black and gold luxury","黑金奢华","🖤")]),
 ("scene_perspective","视角取景","📐",[
   ("仰视","low-angle upward view","仰视视角","⬆"),("俯视鸟瞰","bird's-eye top view","俯视鸟瞰","🦅"),
   ("平视远景","eye-level wide shot","平视远景","👁"),("广角","wide-angle","广角","📷"),
   ("微距特写","macro close-up","微距特写","🔬"),("低角度","low angle","低角度","📐"),
   ("航拍","aerial drone shot","航拍视角","🚁"),("第一人称","first-person POV","第一人称视角","🎮")]),
 ("scene_composition","构图布局","🖼",[
   ("引导线","leading lines","引导线构图","➡"),("三分法","rule of thirds","三分法","▦"),("对称","symmetrical","对称构图","🪞"),
   ("框架式","framing composition","框架式构图","🖼"),("中心构图","centered composition","中心构图","🎯"),
   ("黄金分割","golden ratio","黄金分割","🌀"),("留白","negative space","大量留白","⬜"),("前景遮挡","foreground occlusion","前景遮挡","🌿")]),
 ("scene_details","细节元素","✨",[
   ("藤蔓缠绕","tangled vines","藤蔓缠绕","🌿"),("全息广告牌","holographic billboards","全息广告牌","📺"),
   ("古老符文","ancient runes carved","古老符文雕刻","🔯"),("飘落花瓣","falling petals","飘落花瓣","🌸"),
   ("粒子漂浮","floating particles","粒子漂浮","✨"),("水面倒影","water reflection","水面倒影","💧"),
   ("烟雾缭绕","swirling mist smoke","烟雾缭绕","💨"),("光斑","bokeh light spots","散落光斑","🔆")]),
 ("scene_style","画风风格","🎨",[
   ("赛博朋克2077","Cyberpunk 2077 style","赛博朋克2077风格","🤖"),("吉卜力","Studio Ghibli style","吉卜力动画风格","🌿"),
   ("史诗电影","epic cinematic style","史诗电影风格","🎬"),("印象派油画","impressionist oil painting","印象派油画","🖌"),
   ("宫崎骏","Hayao Miyazaki style","宫崎骏动画风格","🍃"),("写实","photorealistic","超写实风格","📷"),
   ("水墨","Chinese ink painting","水墨画风格","🖤"),("新海诚","Makoto Shinkai style","新海诚风格","🌆")]),
 ("scene_quality","画质参数","📐",[
   ("8K超细腻","8K ultra fine detail","8K超细腻","🔬"),("4K超写实","4K photorealistic","4K超写实","📺"),
   ("CG渲染级","CG render quality","CG渲染级","🖥"),("大气透视","atmospheric perspective","大气透视","🌫"),
   ("粒子特效","particle effects","粒子特效","✨"),("HDR","HDR high dynamic range","HDR高动态","🌈"),
   ("电影级","cinematic grade","电影级质感","🎞"),("景深虚化","depth of field bokeh","景深虚化","🔭")]),
]

def main():
    os.makedirs(BK, exist_ok=True)
    bak = os.path.join(BK, "sceneseed_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
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
        def gid(key):
            r = c.execute("SELECT id FROM word_card_group WHERE group_key=?", [key]).fetchone()
            return r["id"] if r else None
        root = gid(ROOT[0])
        if not root:
            c.execute("""INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,sort_order,is_active,created_at,updated_at)
                         VALUES (?,?,?,'custom',NULL,7,1,datetime('now','localtime'),datetime('now','localtime'))""", [ROOT[1], ROOT[0], ROOT[2]])
            root = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            print("[OK] 根组 scene_root id=%d" % root)
        else:
            print("[SKIP] 根组已存在 id=%d" % root)
        n_g = n_c = 0
        for si, (gkey, gname, gicon, cards) in enumerate(GROUPS):
            g = gid(gkey)
            if not g:
                c.execute("""INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,sort_order,is_active,created_at,updated_at)
                             VALUES (?,?,?,'sub',?,?,1,datetime('now','localtime'),datetime('now','localtime'))""", [gname, gkey, gicon, root, 10 + si])
                g = c.execute("SELECT last_insert_rowid()").fetchone()[0]; n_g += 1
            for ci, (cn, en, zh, ic) in enumerate(cards):
                if c.execute("SELECT 1 FROM word_card WHERE group_id=? AND name=?", [g, cn]).fetchone():
                    continue
                c.execute("""INSERT INTO word_card
                    (group_id,name,content,content_zh,content_en,meaning,module,category,media_type,card_role,structured,version,sort_order,usage_count,heat_weight,is_builtin,is_deleted,icon,tags,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?, 'image','component','{}',1,?,0,0.0,1,0,?, '[]', datetime('now','localtime'),datetime('now','localtime'))""",
                    [g, cn, en, zh or cn, en, zh or cn, "scene", gname, ci, ic])
                n_c += 1
        c.commit()
        total = c.execute("SELECT COUNT(1) FROM word_card w JOIN word_card_group g ON g.id=w.group_id WHERE g.group_key LIKE 'scene_%'").fetchone()[0]
        print("\n[DONE] 新增子分组 %d，新增词卡 %d；场景分组词卡总计 %d；FTS=%d" % (n_g, n_c, total, c.execute("SELECT COUNT(1) FROM word_card_fts").fetchone()[0]))
    finally:
        c.close()

if __name__ == "__main__":
    main()
