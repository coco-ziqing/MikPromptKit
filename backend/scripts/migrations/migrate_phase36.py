# -*- coding: utf-8 -*-
"""Phase36.1 迁移 — 角色设定模版库。
- character_template(structure_json 槽位↔词卡分组绑定 + default_settings_json)
- character_profiles += template_id
- 种子内置模版：通用 + 日系动漫少女/赛博朋克/奇幻冒险者（复用旧 PRESET 默认值）
幂等 + 快照。
"""
import os, sys, sqlite3, json, time
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
BK = os.path.join(HERE, "..", "data", "backups")

# 规范槽位（key,label,icon,group_keys,order）—— 绑定到 char_ 角色分组
CANON_SLOTS = [
    ("gender","性别","♀♂",["char_gender_age"],1),
    ("age","年龄","🎂",["char_gender_age"],2),
    ("hairstyle","发型发色","💇",["char_hair"],3),
    ("facial","脸型五官","👁",["char_face"],4),
    ("expression","表情神态","😊",["char_expression"],5),
    ("body","体型身材","🧍",["char_body"],6),
    ("clothing","服装服饰","👗",["char_clothing"],7),
    ("accessory","配饰道具","💍",["char_accessory"],8),
    ("pose","姿态动作","🤸",["char_pose"],9),
    ("occupation","职业身份","🪪",["char_occupation"],10),
    ("temperament","气质性格","✨",["char_temperament"],11),
    ("style","画风风格","🎨",["char_style"],12),
    ("background","背景场景","🏞",["char_background"],13),
    ("lighting","光照氛围","💡",["char_lighting"],14),
    ("color_scheme","色调质感","🎞",["char_color"],15),
    ("quality","画质参数","📐",["char_color"],16),
    ("negative","负面提示词","⚠️",["negative"],17),
]

def _slots():
    return [{"key": k, "label": l, "icon": ic, "group_keys": gk, "order": o} for (k, l, ic, gk, o) in CANON_SLOTS]

TEMPLATES = [
    ("通用角色设定", "全维度角色设定框架，各槽位绑定角色词卡分组，自由拼装", {}, 1),
    ("日系动漫少女", "新海诚/赛璐珞风格少女预设", {
        "gender":"少女","age":"16岁","hairstyle":"双马尾，浅粉色长发","facial":"大眼睛，樱桃小嘴，精致五官",
        "expression":"元气满满的笑容","clothing":"日式水手服，百褶裙","style":"新海诚风格，日系赛璐珞",
        "background":"樱花树下的校园操场","lighting":"柔和的午日逆光，光斑散落","color_scheme":"粉白暖色调","quality":"8K超细腻，精致细节"}, 2),
    ("赛博朋克角色", "霓虹雨夜赛博风预设", {
        "gender":"女性","age":"25岁","hairstyle":"短发，霓虹蓝挑染","facial":"机械义眼，凌厉眼神",
        "expression":"冷酷面瘫","clothing":"发光纳米战甲，全息投影披风","style":"赛博朋克2077风格",
        "background":"霓虹雨夜的城市街头","lighting":"霓虹蓝紫色荧光，高对比","color_scheme":"青蓝+紫粉撞色","quality":"4K超写实，粒子特效"}, 3),
    ("奇幻冒险者", "史诗幻想冒险者预设", {
        "gender":"青年男性","age":"22岁","hairstyle":"银色中长发，随意披散","facial":"锐利蓝瞳，剑眉星目",
        "expression":"坚定果敢，嘴角上扬","clothing":"魔法轻甲，斗篷飞扬","pose":"持剑站立，微风扬起披风",
        "style":"最终幻想风格，史诗幻想","background":"远古遗迹，魔法结界环绕","lighting":"神秘紫光从天而降，粒子漂浮",
        "color_scheme":"紫金史诗色调","quality":"4K极致细节，CG渲染级"}, 4),
]

def has(c, t, col): return any(r[1] == col for r in c.execute("PRAGMA table_info(%s)" % t))

def main():
    os.makedirs(BK, exist_ok=True)
    bak = os.path.join(BK, "phase36_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)"); s.execute("VACUUM INTO ?", [bak]); print("[OK] 备份", bak)
    except Exception as e:
        import shutil; shutil.copy2(DB, bak); print("[WARN] copy", e)
    finally:
        s.close()
    c = sqlite3.connect(DB, timeout=15); c.execute("PRAGMA journal_mode=WAL")
    try:
        c.execute("""CREATE TABLE IF NOT EXISTS character_template (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            structure_json TEXT NOT NULL DEFAULT '[]',
            default_settings_json TEXT NOT NULL DEFAULT '{}',
            is_builtin INTEGER NOT NULL DEFAULT 0,
            owner_user_id INTEGER,
            sort_order INTEGER DEFAULT 100,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        if not has(c, "character_profiles", "template_id"):
            c.execute("ALTER TABLE character_profiles ADD COLUMN template_id INTEGER")
            print("[OK] character_profiles += template_id")
        slots_json = json.dumps(_slots(), ensure_ascii=False)
        n = 0
        for si, (name, desc, defaults, order) in enumerate(TEMPLATES):
            ex = c.execute("SELECT id FROM character_template WHERE name=? AND is_builtin=1", [name]).fetchone()
            if ex:
                # 更新结构（保持内置模版槽位随分组演进），保留
                c.execute("UPDATE character_template SET structure_json=?, default_settings_json=?, description=?, sort_order=? WHERE id=?",
                          [slots_json, json.dumps(defaults, ensure_ascii=False), desc, order, ex["id"] if hasattr(ex,'keys') else ex[0]])
                continue
            c.execute("""INSERT INTO character_template (name,description,structure_json,default_settings_json,is_builtin,sort_order)
                         VALUES (?,?,?,?,1,?)""",
                      [name, desc, slots_json, json.dumps(defaults, ensure_ascii=False), order])
            n += 1
        c.commit()
        print("[OK] 内置模版新增 %d，总计 %d" % (n, c.execute("SELECT COUNT(1) FROM character_template").fetchone()[0]))
        print("[DONE] Phase36.1 迁移完成 (fk=%d)" % len(c.execute("PRAGMA foreign_key_check").fetchall()))
    finally:
        c.close()

if __name__ == "__main__":
    main()
