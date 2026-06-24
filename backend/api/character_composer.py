"""
v5.1.0: 角色设定提示词组装器 — 人物提示词工业化装配
从 word_card 词库中各维度选取词条，自动拼接为完整角色提示词
"""
import json, re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_db
from typing import Optional

router = APIRouter(prefix="/api/character-composer", tags=["character-composer"])

# ==================== 角色维度定义 ====================
CHARACTER_DIMENSIONS = {
    "gender":       {"label": "性别", "icon": "♂♀", "group_keys": ["emotion_style", "custom"],
                     "order": 1, "default": ""},
    "age":          {"label": "年龄", "icon": "🎂", "group_keys": ["custom"],
                     "order": 2, "default": ""},
    "hairstyle":    {"label": "发型", "icon": "💇", "group_keys": ["custom"],
                     "order": 3, "default": ""},
    "facial":       {"label": "五官面容", "icon": "👁", "group_keys": ["custom"],
                     "order": 4, "default": ""},
    "expression":   {"label": "表情神态", "icon": "😊", "group_keys": ["emotion_style", "custom"],
                     "order": 5, "default": ""},
    "clothing":     {"label": "服饰道具", "icon": "👗", "group_keys": ["emotion_style", "custom"],
                     "order": 6, "default": ""},
    "pose":         {"label": "姿态动作", "icon": "🧍", "group_keys": ["custom"],
                     "order": 7, "default": ""},
    "style":        {"label": "画风风格", "icon": "🎨", "group_keys": ["composition", "custom"],
                     "order": 8, "default": ""},
    "background":   {"label": "背景场景", "icon": "🏞", "group_keys": ["composition", "custom"],
                     "order": 9, "default": ""},
    "lighting":     {"label": "光影效果", "icon": "💡", "group_keys": ["tone", "custom"],
                     "order": 10, "default": ""},
    "color_scheme": {"label": "色彩搭配", "icon": "🎨", "group_keys": ["color", "custom"],
                     "order": 11, "default": ""},
    "quality":      {"label": "画质参数", "icon": "📐", "group_keys": ["quality", "custom"],
                     "order": 12, "default": ""},
    "negative":     {"label": "负面提示词", "icon": "⚠️", "group_keys": ["negative", "custom"],
                     "order": 13, "default": ""},
}

# ==================== Pydantic Models ====================
class CharacterCreate(BaseModel):
    name: str = "新角色"
    settings: dict = {}

class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    settings: Optional[dict] = None

class CharacterComposeReq(BaseModel):
    settings: dict = {}
    density: str = "standard"  # compact/standard/detailed
    language: str = "zh"       # zh/en

# ==================== 角色 CRUD ====================
@router.get("/characters")
def list_characters(page: int = 1, page_size: int = 20):
    """列出已保存的角色"""
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
        except: d["settings"] = {}
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
    except: d["settings"] = {}
    return {"ok": True, "character": d}


@router.post("/characters")
def create_character(data: CharacterCreate):
    db = get_db()
    db.execute(
        "INSERT INTO character_profiles (name, settings_json) VALUES (?,?)",
        [data.name, json.dumps(data.settings, ensure_ascii=False)]
    )
    db.commit()
    cid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
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
    db.commit()
    return {"ok": True}


@router.delete("/characters/{char_id}")
def delete_character(char_id: int):
    db = get_db()
    db.execute("DELETE FROM character_profiles WHERE id=?", [char_id])
    db.commit()
    return {"ok": True}


# ==================== 维度卡片库 ====================
@router.get("/dimensions")
def list_dimensions():
    """返回角色维度 + 对应词卡分组（供前端渲染选择器）"""
    db = get_db()

    dims = []
    for key, dim in sorted(CHARACTER_DIMENSIONS.items(), key=lambda x: x[1]["order"]):
        # 查找对应分组
        groups = []
        for gkey in dim["group_keys"]:
            rows = db.execute(
                "SELECT id, name, icon FROM word_card_group WHERE group_key LIKE ? AND is_active=1 ORDER BY sort_order LIMIT 5",
                [f"%{gkey}%"]
            ).fetchall()
            for r in rows:
                cnt = db.execute("SELECT COUNT(*) FROM word_card WHERE group_id=? AND is_deleted=0", [r["id"]]).fetchone()[0]
                if cnt > 0:
                    groups.append({"id": r["id"], "name": r["name"], "icon": r["icon"] or "📄", "card_count": cnt})
        dims.append({
            "key": key, "label": dim["label"], "icon": dim["icon"], "order": dim["order"],
            "default": dim["default"], "groups": groups
        })

    return {"ok": True, "dimensions": dims}


@router.get("/dimensions/{dim_key}/cards")
def list_dimension_cards(dim_key: str, page: int = 1, page_size: int = 200):
    """列出某个维度的词卡（跨关联分组聚合）"""
    dim = CHARACTER_DIMENSIONS.get(dim_key)
    if not dim:
        raise HTTPException(404, f"未知维度: {dim_key}")
    db = get_db()

    cards = []
    for gkey in dim["group_keys"]:
        rows = db.execute(
            """SELECT wc.id, wc.content, wc.meaning, wc.thumbnail, wc.usage_count,
                      wg.name as group_name, wc.module, wc.category
               FROM word_card wc
               JOIN word_card_group wg ON wc.group_id=wg.id
               WHERE wg.group_key LIKE ? AND wc.is_deleted=0
               ORDER BY wc.usage_count DESC, wc.sort_order
               LIMIT ? OFFSET ?""",
            [f"%{gkey}%", page_size, (page-1)*page_size]
        ).fetchall()
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

    # 2. 主体描述 (gender + age + hairstyle + facial)
    subject_parts = []
    for k in ["gender", "age", "hairstyle", "facial"]:
        v = settings.get(k, "").strip()
        if v:
            subject_parts.append(v)
            json_parts[k] = v
    if subject_parts:
        parts.append("，".join(subject_parts))

    # 3. 表情神态 — compact+
    expr = settings.get("expression", "").strip()
    if expr:
        parts.append(expr)
        json_parts["expression"] = expr

    # 4. 服饰道具 — standard+
    if density != "compact":
        clothing = settings.get("clothing", "").strip()
        if clothing:
            parts.append(clothing)
            json_parts["clothing"] = clothing

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
