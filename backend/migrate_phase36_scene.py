# -*- coding: utf-8 -*-
"""Phase36.1-scene 迁移 — 场景设定模版库。scene_template + scene_profiles.template_id + 种子内置模版。幂等+快照。"""
import os, sys, sqlite3, json, time
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
BK = os.path.join(HERE, "..", "data", "backups")

CANON_SLOTS = [
    ("location","场景类型","🏞",["scene_location"],1),
    ("architecture","建筑风格","🏛",["scene_architecture"],2),
    ("time","时间时刻","🕐",["scene_time"],3),
    ("season","季节气候","🍂",["scene_season"],4),
    ("weather","天气现象","🌦",["scene_weather"],5),
    ("atmosphere","氛围情绪","🎭",["scene_atmosphere"],6),
    ("lighting","光影效果","💡",["scene_lighting"],7),
    ("color_scheme","色彩搭配","🎨",["scene_color"],8),
    ("perspective","视角取景","📐",["scene_perspective"],9),
    ("composition","构图布局","🖼",["scene_composition"],10),
    ("details","细节元素","✨",["scene_details"],11),
    ("style","画风风格","🎨",["scene_style"],12),
    ("quality","画质参数","📐",["scene_quality"],13),
    ("negative","负面提示词","⚠️",["negative"],14),
]
def _slots():
    return [{"key":k,"label":l,"icon":ic,"group_keys":gk,"order":o} for (k,l,ic,gk,o) in CANON_SLOTS]

TEMPLATES = [
    ("通用场景设定","全维度环境设定框架，槽位绑定场景词卡分组，自由拼装",{},1),
    ("赛博朋克都市","霓虹未来都市预设",{"location":"霓虹闪耀的未来都市","architecture":"高耸的赛博摩天楼，全息广告牌","time":"深夜时分","season":"冬季","weather":"细雨霏霏，薄雾缭绕","atmosphere":"冷峻神秘，科技与颓废并存","lighting":"霓虹蓝紫色荧光从下方打亮","color_scheme":"青蓝+紫粉撞色，高对比","perspective":"仰视视角，纵深感极强","composition":"引导线构图，向天空延伸","style":"赛博朋克2077风格","quality":"4K超写实，粒子特效"},2),
    ("魔法森林秘境","精灵森林晨曦预设",{"location":"古老魔法森林深处","architecture":"精灵风格树屋，藤蔓缠绕的拱门","time":"晨曦时分","season":"春季","weather":"薄雾弥漫，光线穿透叶隙","atmosphere":"静谧神圣，充满生命力","lighting":"金色晨光洒落，光斑舞动","color_scheme":"翠绿+金色暖调","perspective":"平视，深远景","style":"吉卜力动画风格","quality":"4K极致细节，CG渲染级"},3),
    ("远古神殿遗迹","沙漠神殿黄昏预设",{"location":"沙漠中的远古神殿遗迹","architecture":"巨石柱廊，古老符文雕刻","time":"黄昏时分","season":"秋季","weather":"沙尘轻扬，夕阳低垂","atmosphere":"庄严神秘，岁月沧桑","lighting":"暖橙夕阳光穿过石柱，长影延伸","color_scheme":"金橙+深褐史诗色调","perspective":"低角度仰拍，强调宏伟","style":"史诗电影风格","quality":"8K超细腻，大气透视"},4),
    ("海滨日落","海边悬崖日落预设",{"location":"静谧海边悬崖","weather":"晴朗，晚霞漫天","time":"日落黄金时刻","season":"夏季","atmosphere":"浪漫宁静，无限遐想","lighting":"金色逆光，海面粼粼波光","color_scheme":"暖橙+粉紫渐变","perspective":"广角远眺，海天一线","style":"印象派油画风格","quality":"4K高画质"},5),
    ("冬日雪村","北欧雪村傍晚预设",{"location":"被大雪覆盖的北欧小村庄","architecture":"尖顶木屋，烟囱袅袅","time":"傍晚时分","season":"隆冬","weather":"大雪纷飞，银装素裹","atmosphere":"温馨宁静，节日氛围","lighting":"暖黄窗灯透出，雪地反光","color_scheme":"白+暖黄+深蓝","perspective":"鸟瞰俯视","style":"宫崎骏动画风格","quality":"4K细腻质感"},6),
]

def has(c,t,col): return any(r[1]==col for r in c.execute("PRAGMA table_info(%s)"%t))

def main():
    os.makedirs(BK, exist_ok=True)
    bak = os.path.join(BK, "phase36scene_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)"); s.execute("VACUUM INTO ?", [bak]); print("[OK] 备份", bak)
    except Exception as e:
        import shutil; shutil.copy2(DB, bak); print("[WARN] copy", e)
    finally:
        s.close()
    c = sqlite3.connect(DB, timeout=15); c.row_factory=sqlite3.Row; c.execute("PRAGMA journal_mode=WAL")
    try:
        c.execute("""CREATE TABLE IF NOT EXISTS scene_template (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '',
            structure_json TEXT NOT NULL DEFAULT '[]', default_settings_json TEXT NOT NULL DEFAULT '{}',
            is_builtin INTEGER NOT NULL DEFAULT 0, owner_user_id INTEGER, sort_order INTEGER DEFAULT 100,
            created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')))""")
        if not has(c,"scene_profiles","template_id"):
            c.execute("ALTER TABLE scene_profiles ADD COLUMN template_id INTEGER"); print("[OK] scene_profiles += template_id")
        slots_json = json.dumps(_slots(), ensure_ascii=False)
        n = 0
        for (name, desc, defaults, order) in TEMPLATES:
            ex = c.execute("SELECT id FROM scene_template WHERE name=? AND is_builtin=1", [name]).fetchone()
            if ex:
                c.execute("UPDATE scene_template SET structure_json=?, default_settings_json=?, description=?, sort_order=? WHERE id=?",
                          [slots_json, json.dumps(defaults,ensure_ascii=False), desc, order, ex["id"]])
                continue
            c.execute("INSERT INTO scene_template (name,description,structure_json,default_settings_json,is_builtin,sort_order) VALUES (?,?,?,?,1,?)",
                      [name, desc, slots_json, json.dumps(defaults,ensure_ascii=False), order]); n += 1
        c.commit()
        print("[OK] 内置模版新增 %d，总计 %d；[DONE] fk=%d" % (n, c.execute("SELECT COUNT(1) FROM scene_template").fetchone()[0], len(c.execute("PRAGMA foreign_key_check").fetchall())))
    finally:
        c.close()

if __name__ == "__main__":
    main()
