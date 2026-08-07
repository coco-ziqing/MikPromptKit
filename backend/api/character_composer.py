"""
v5.1.0: 角色设定提示词组装器 — 人物提示词工业化装配
从 word_card 词库中各维度选取词条，自动拼接为完整角色提示词
"""
import json
import sqlite3

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import get_db, safe_commit

router = APIRouter(prefix="/api/character-composer", tags=["character-composer"])

# ==================== 角色维度定义（默认模版：绑定 char_ 角色词卡分组） ====================
CHARACTER_DIMENSIONS = {
    "gender":       {"label": "性别", "icon": "♀♂", "group_keys": ["char_gender_age"], "order": 1, "default": ""},
    "age":          {"label": "年龄", "icon": "🎂", "group_keys": ["char_gender_age"], "order": 2, "default": ""},
    "hairstyle":    {"label": "发型发色", "icon": "💇", "group_keys": ["char_hair"], "order": 3, "default": ""},
    "facial":       {"label": "脸型五官", "icon": "👁", "group_keys": ["char_face"], "order": 4, "default": ""},
    "expression":   {"label": "表情神态", "icon": "😊", "group_keys": ["char_expression"], "order": 5, "default": ""},
    "body":         {"label": "体型身材", "icon": "🧍", "group_keys": ["char_body"], "order": 6, "default": ""},
    "clothing":     {"label": "服装服饰", "icon": "👗", "group_keys": ["char_clothing"], "order": 7, "default": ""},
    "accessory":    {"label": "配饰道具", "icon": "💍", "group_keys": ["char_accessory"], "order": 8, "default": ""},
    "pose":         {"label": "姿态动作", "icon": "🤸", "group_keys": ["char_pose"], "order": 9, "default": ""},
    "occupation":   {"label": "职业身份", "icon": "🪪", "group_keys": ["char_occupation"], "order": 10, "default": ""},
    "temperament":  {"label": "气质性格", "icon": "✨", "group_keys": ["char_temperament"], "order": 11, "default": ""},
    "style":        {"label": "画风风格", "icon": "🎨", "group_keys": ["char_style"], "order": 12, "default": ""},
    "background":   {"label": "背景场景", "icon": "🏞", "group_keys": ["char_background"], "order": 13, "default": ""},
    "lighting":     {"label": "光照氛围", "icon": "💡", "group_keys": ["char_lighting"], "order": 14, "default": ""},
    "color_scheme": {"label": "色调质感", "icon": "🎞", "group_keys": ["char_color"], "order": 15, "default": ""},
    "quality":      {"label": "画质参数", "icon": "📐", "group_keys": ["char_color"], "order": 16, "default": ""},
    "negative":     {"label": "负面提示词", "icon": "⚠️", "group_keys": ["negative"], "order": 17, "default": ""},
}

# ==================== Pydantic Models ====================
class CharacterCreate(BaseModel):
    name: str = "新角色"
    settings: dict = {}
    template_id: int | None = None

class CharacterUpdate(BaseModel):
    name: str | None = None
    settings: dict | None = None
    template_id: int | None = None

class CharacterComposeReq(BaseModel):
    settings: dict = {}
    density: str = "standard"  # compact/standard/detailed
    language: str = "zh"       # zh/en

# ==================== 角色 CRUD ====================

# 字段映射：settings_json → character_profiles 富字段（双向互通角色库）
_SETTINGS_FIELD_MAP = [
    ("gender", "gender"),
    ("age", "age_range"),
    ("personality", "personality"),
    ("backstory", "backstory"),
    ("voice_type", "voice_type"),
]

def _derive_library_fields(settings: dict) -> dict:
    """从 Composer settings_json 派生 character_profiles 富字段

    settings 示例:
      {gender:"女性", age:"20岁", hairstyle:"长发", facial:"大眼",
       expression:"微笑", clothing:"水手服", pose:"站立",
       style:"吉卜力风格", background:"海边", lighting:"柔光",
       color_scheme:"暖色调", quality:"8K", negative:"丑陋"}
    → {gender:"女性", age_range:"20岁",
       personality:"微笑，吉卜力风格", occupation:"",
       appearance:"女性，20岁，长发，大眼，水手服，站立",
       backstory:"在海边，柔光包围", voice_type:""}
    """
    fields = {}
    # 1:1 映射
    for sk, fk in _SETTINGS_FIELD_MAP:
        val = (settings.get(sk) or "").strip()
        if val:
            fields[fk] = val
    # personality: expression + style
    parts_pers = []
    if settings.get("expression"): parts_pers.append(settings["expression"])
    if settings.get("style"): parts_pers.append(settings["style"])
    if settings.get("pose"): parts_pers.append(settings["pose"])
    if not fields.get("personality") and parts_pers:
        fields["personality"] = "，".join(parts_pers)
    # appearance: gender + age + hairstyle + facial + clothing + pose
    parts_app = []
    for k in ["gender", "age", "hairstyle", "facial", "clothing", "pose"]:
        v = (settings.get(k) or "").strip()
        if v:
            parts_app.append(v)
    if parts_app:
        fields["appearance"] = "，".join(parts_app)
    # backstory: background + lighting
    parts_bg = []
    if settings.get("background"): parts_bg.append(settings["background"])
    if settings.get("lighting"): parts_bg.append(settings["lighting"])
    if parts_bg:
        fields["backstory"] = "，".join(parts_bg)
    # occupation — 从 settings 中直接取
    occ = (settings.get("occupation") or settings.get("occupation_custom") or "").strip()
    if occ:
        fields["occupation"] = occ
    return fields


def _save_derived_fields(db, char_id: int, settings: dict):
    """将派生字段写入 character_profiles"""
    fields = _derive_library_fields(settings)
    if not fields:
        return
    set_parts = []
    vals = []
    for k, v in fields.items():
        set_parts.append(f"{k}=?")
        vals.append(v)
    set_parts.append("updated_at=datetime('now','localtime')")
    vals.append(char_id)
    sql = f"UPDATE character_profiles SET {', '.join(set_parts)} WHERE id=?"
    db.execute(sql, vals)
    try: db.commit()
    except sqlite3.OperationalError: pass
    else: return
    safe_commit()
@router.get("/characters")
def list_characters(page: int = 1, page_size: int = 20):
    """列出已保存的角色（含 rich 字段，供种子舞角色选择器调用）"""
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM character_profiles").fetchone()[0]
    rows = db.execute(
        "SELECT * FROM character_profiles ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        [page_size, (page - 1) * page_size]
    ).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        try: d["settings"] = json.loads(d.get("settings_json") or "{}")
        except Exception: d["settings"] = {}
        items.append(d)
    return {"ok": True, "items": items, "total": total}


@router.get("/characters/{char_id}")
def get_character(char_id: int):
    db = get_db()
    r = db.execute("SELECT * FROM character_profiles WHERE id=?", [char_id]).fetchone()
    if not r:
        raise HTTPException(404, "角色不存在")
    d = dict(r)
    try: d["settings"] = json.loads(d.get("settings_json") or "{}")
    except Exception: d["settings"] = {}
    return {"ok": True, "character": d}


@router.post("/characters")
def create_character(data: CharacterCreate):
    db = get_db()
    db.execute(
        "INSERT INTO character_profiles (name, settings_json, template_id) VALUES (?,?,?)",
        [data.name, json.dumps(data.settings, ensure_ascii=False), data.template_id]
    )
    safe_commit()
    cid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    # 同步派生字段到 character_profiles 富字段（角色库互通）
    _save_derived_fields(db, cid, data.settings)
    return {"ok": True, "id": cid, "name": data.name}


@router.put("/characters/{char_id}")
def update_character(char_id: int, data: CharacterUpdate):
    db = get_db()
    if data.name is not None:
        db.execute("UPDATE character_profiles SET name=?, updated_at=datetime('now','localtime') WHERE id=?",
                   [data.name, char_id])
    if data.settings is not None:
        db.execute("UPDATE character_profiles SET settings_json=?, updated_at=datetime('now','localtime') WHERE id=?",
                   [json.dumps(data.settings, ensure_ascii=False), char_id])
    if data.template_id is not None:
        db.execute("UPDATE character_profiles SET template_id=? WHERE id=?", [data.template_id, char_id])
    safe_commit()
    # 同步派生字段到 character_profiles 富字段（角色库互通）
    if data.settings is not None:
        _save_derived_fields(db, char_id, data.settings)
    return {"ok": True}


@router.delete("/characters/{char_id}")
def delete_character(char_id: int):
    db = get_db()
    db.execute("DELETE FROM character_profiles WHERE id=?", [char_id])
    db.commit()
    return {"ok": True}


# ==================== 维度卡片库（模版驱动） ====================
def _resolve_groups(db, group_keys):
    groups = []
    for gkey in group_keys:
        rows = db.execute(
            "SELECT id, name, icon FROM word_card_group WHERE group_key LIKE ? AND is_active=1 ORDER BY sort_order LIMIT 5",
            [f"%{gkey}%"]).fetchall()
        for r in rows:
            cnt = db.execute("SELECT COUNT(*) FROM word_card WHERE group_id=? AND is_deleted=0", [r["id"]]).fetchone()[0]
            if cnt > 0:
                groups.append({"id": r["id"], "name": r["name"], "icon": r["icon"] or "📄", "card_count": cnt})
    return groups


def _template_slots(db, template_id):
    """从模版 structure_json 构造类 CHARACTER_DIMENSIONS 结构；无效返回 None"""
    if not template_id:
        return None
    r = db.execute("SELECT structure_json FROM character_template WHERE id=?", [template_id]).fetchone()
    if not r:
        return None
    try:
        slots = json.loads(r["structure_json"] or "[]")
    except Exception:
        return None
    out = {}
    for s in slots:
        if not s.get("key"):
            continue
        out[s["key"]] = {"label": s.get("label", s["key"]), "icon": s.get("icon", ""),
                         "group_keys": s.get("group_keys", []), "order": s.get("order", 100), "default": ""}
    return out or None


@router.get("/dimensions")
def list_dimensions(template_id: int = None):
    """返回角色维度 + 对应词卡分组；传 template_id 则按模版槽位返回。"""
    db = get_db()
    dims_src = _template_slots(db, template_id) or CHARACTER_DIMENSIONS
    dims = []
    for key, dim in sorted(dims_src.items(), key=lambda x: x[1]["order"]):
        dims.append({
            "key": key, "label": dim["label"], "icon": dim["icon"], "order": dim["order"],
            "default": dim.get("default", ""), "groups": _resolve_groups(db, dim["group_keys"])
        })
    return {"ok": True, "dimensions": dims, "template_id": template_id}


@router.get("/dimensions/{dim_key}/cards")
def list_dimension_cards(dim_key: str, template_id: int = None, page: int = 1, page_size: int = 200):
    """列出某个维度的词卡（跨关联分组聚合）；可按模版解析槽位分组。"""
    db = get_db()
    dims_src = _template_slots(db, template_id) or CHARACTER_DIMENSIONS
    dim = dims_src.get(dim_key) or CHARACTER_DIMENSIONS.get(dim_key)
    if not dim:
        raise HTTPException(404, f"未知维度: {dim_key}")
    cards = []
    for gkey in dim["group_keys"]:
        rows = db.execute(
            """SELECT wc.id, wc.name, wc.content, wc.content_zh, wc.meaning, wc.thumbnail, wc.usage_count,
                      wg.name as group_name, wc.module, wc.category, wc.icon
               FROM word_card wc JOIN word_card_group wg ON wc.group_id=wg.id
               WHERE wg.group_key LIKE ? AND wc.is_deleted=0
               ORDER BY wc.usage_count DESC, wc.sort_order LIMIT ? OFFSET ?""",
            [f"%{gkey}%", page_size, (page - 1) * page_size]).fetchall()
        for r in rows:
            cards.append(dict(r))
    return {"ok": True, "dimension": dim_key, "cards": cards, "total": len(cards)}


# ==================== 组装引擎 ====================
@router.post("/compose")
def compose_character(data: CharacterComposeReq):
    """将角色各维度字段拼接为完整提示词"""
    settings = data.settings
    density = data.density
    lang = data.language

    parts = []
    json_parts = {}

    # 组装顺序（行业标准角色描述公式）
    # compact: 画风 + 主体概要（性别/年龄/发型/五官 + 服饰）
    # standard: 画风 + 主体 + 表情 + 姿态 + 背景 + 光影 + 色彩
    # detailed: 画风 + 主体 + 表情 + 姿态/服饰 + 背景 + 光影 + 色彩 + 画质 + 负面

    # 1. 画风(风格) — 所有密度
    style_val = settings.get("style", "").strip()
    if style_val:
        parts.append(style_val)
        json_parts["style"] = style_val

    # 2. 主体描述 (occupation + gender + age + body + hairstyle + facial)
    subject_parts = []
    for k in ["occupation", "gender", "age", "body", "hairstyle", "facial"]:
        v = settings.get(k, "").strip()
        if v:
            subject_parts.append(v)
            json_parts[k] = v
    if subject_parts:
        parts.append("，".join(subject_parts))

    # 3. 表情神态 + 气质性格
    for k in ["expression", "temperament"]:
        v = settings.get(k, "").strip()
        if v:
            parts.append(v)
            json_parts[k] = v

    # 4. 服饰 + 配饰 — standard+
    if density != "compact":
        for k in ["clothing", "accessory"]:
            v = settings.get(k, "").strip()
            if v:
                parts.append(v)
                json_parts[k] = v

    # 5. 姿态动作 — standard+
    if density != "compact":
        pose = settings.get("pose", "").strip()
        if pose:
            parts.append(pose)
            json_parts["pose"] = pose

    # 6. 背景场景 — standard+
    if density != "compact":
        bg = settings.get("background", "").strip()
        if bg:
            parts.append(bg)
            json_parts["background"] = bg

    # 7. 光影 — standard+
    if density != "compact":
        light = settings.get("lighting", "").strip()
        if light:
            parts.append(light)
            json_parts["lighting"] = light

    # 8. 色彩 — standard+
    if density != "compact":
        color = settings.get("color_scheme", "").strip()
        if color:
            parts.append(color)
            json_parts["color_scheme"] = color

    # 9. 画质 — detailed
    if density == "detailed":
        quality = settings.get("quality", "").strip()
        if quality:
            parts.append(quality)
            json_parts["quality"] = quality

    # 10. 负面
    negative = settings.get("negative", "").strip()
    json_parts["negative"] = negative

    # 拼接
    text = "，".join(p for p in parts if p)
    if negative and density != "compact":
        text += f"\n\n负面提示词: {negative}"

    # 语言切换
    if lang == "en":
        # 简单标记，实际翻译由翻译 API 处理
        pass

    # 字符统计
    stats = {
        "char_count": len(text),
        "dimension_count": len([k for k, v in settings.items() if v and str(v).strip()]),
        "density": density,
    }

    return {
        "ok": True, "text": text, "parts": json_parts,
        "stats": stats,
        "density": density
    }


# ==================== 预设模板 ====================
PRESET_TEMPLATES = {
    "anime_girl": {
        "name": "日系动漫少女",
        "settings": {
            "gender": "少女", "age": "16岁",
            "hairstyle": "双马尾，浅粉色长发",
            "facial": "大眼睛，樱桃小嘴，精致五官",
            "expression": "元气满满的笑容",
            "clothing": "日式水手服，百褶裙",
            "style": "新海诚风格，日系赛璐珞",
            "background": "樱花树下的校园操场",
            "lighting": "柔和的午日逆光，光斑散落",
            "color_scheme": "粉白暖色调",
            "quality": "8K超细腻，精致细节"
        }
    },
    "cyberpunk": {
        "name": "赛博朋克角色",
        "settings": {
            "gender": "女性", "age": "25岁",
            "hairstyle": "短发，霓虹蓝挑染",
            "facial": "机械义眼，凌厉眼神",
            "expression": "冷酷面瘫",
            "clothing": "发光纳米战甲，全息投影披风",
            "style": "赛博朋克2077风格",
            "background": "霓虹雨夜的城市街头",
            "lighting": "霓虹蓝紫色荧光，高对比",
            "color_scheme": "青蓝+紫粉撞色",
            "quality": "4K超写实，粒子特效"
        }
    },
    "fantasy": {
        "name": "奇幻冒险者",
        "settings": {
            "gender": "青年男性", "age": "22岁",
            "hairstyle": "银色中长发，随意披散",
            "facial": "锐利蓝瞳，剑眉星目",
            "expression": "坚定果敢，嘴角上扬",
            "clothing": "魔法轻甲，斗篷飞扬",
            "pose": "持剑站立，微风扬起披风",
            "style": "最终幻想风格，史诗幻想",
            "background": "远古遗迹，魔法结界环绕",
            "lighting": "神秘紫光从天而降，粒子漂浮",
            "color_scheme": "紫金史诗色调",
            "quality": "4K极致细节，CG渲染级"
        }
    }
}


@router.get("/presets")
def get_presets():
    return {"ok": True, "presets": PRESET_TEMPLATES}


# ==================== 角色设定模版库 ====================
class TemplateCreate(BaseModel):
    name: str = "新模版"
    description: str = ""
    structure: list = []
    default_settings: dict = {}

class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    structure: list | None = None
    default_settings: dict | None = None


def _tpl_dict(r):
    d = dict(r)
    try: d["structure"] = json.loads(d.get("structure_json") or "[]")
    except Exception: d["structure"] = []
    try: d["default_settings"] = json.loads(d.get("default_settings_json") or "{}")
    except Exception: d["default_settings"] = {}
    return d


@router.get("/templates")
def list_templates():
    db = get_db()
    rows = db.execute("SELECT * FROM character_template ORDER BY is_builtin DESC, sort_order, id").fetchall()
    return {"ok": True, "items": [_tpl_dict(r) for r in rows], "total": len(rows)}


@router.get("/templates/{tid}")
def get_template(tid: int):
    db = get_db()
    r = db.execute("SELECT * FROM character_template WHERE id=?", [tid]).fetchone()
    if not r:
        raise HTTPException(404, "模版不存在")
    return {"ok": True, "template": _tpl_dict(r)}


@router.post("/templates")
def create_template(data: TemplateCreate):
    db = get_db()
    db.execute("""INSERT INTO character_template (name,description,structure_json,default_settings_json,is_builtin,sort_order)
                 VALUES (?,?,?,?,0,100)""",
               [data.name, data.description, json.dumps(data.structure, ensure_ascii=False),
                json.dumps(data.default_settings, ensure_ascii=False)])
    safe_commit()
    return {"ok": True, "id": db.execute("SELECT last_insert_rowid()").fetchone()[0]}


@router.put("/templates/{tid}")
def update_template(tid: int, data: TemplateUpdate):
    db = get_db()
    if not db.execute("SELECT 1 FROM character_template WHERE id=?", [tid]).fetchone():
        raise HTTPException(404, "模版不存在")
    sets, vals = [], []
    if data.name is not None: sets.append("name=?"); vals.append(data.name)
    if data.description is not None: sets.append("description=?"); vals.append(data.description)
    if data.structure is not None: sets.append("structure_json=?"); vals.append(json.dumps(data.structure, ensure_ascii=False))
    if data.default_settings is not None: sets.append("default_settings_json=?"); vals.append(json.dumps(data.default_settings, ensure_ascii=False))
    if sets:
        sets.append("updated_at=datetime('now','localtime')"); vals.append(tid)
        db.execute(f"UPDATE character_template SET {', '.join(sets)} WHERE id=?", vals)
        safe_commit()
    return {"ok": True}


@router.delete("/templates/{tid}")
def delete_template(tid: int):
    db = get_db()
    r = db.execute("SELECT is_builtin FROM character_template WHERE id=?", [tid]).fetchone()
    if r and r["is_builtin"]:
        raise HTTPException(400, "内置模版不可删除")
    db.execute("DELETE FROM character_template WHERE id=?", [tid])
    db.commit()
    return {"ok": True}
