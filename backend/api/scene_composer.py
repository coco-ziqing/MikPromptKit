"""
v5.1.0: 场景设定组装器 — 环境/场景提示词工业化装配
从 word_card 词库中各维度选取词条，自动拼接为完整场景提示词
"""
import json, re
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
from database import get_db, safe_commit
from typing import Optional

router = APIRouter(prefix="/api/scene-composer", tags=["scene-composer"])

# ==================== 场景维度定义 ====================
SCENE_DIMENSIONS = {
    "location":     {"label": "场景类型", "icon": "📍", "group_keys": ["composition", "custom"],
                     "order": 1, "default": ""},
    "architecture": {"label": "建筑风格", "icon": "🏛", "group_keys": ["composition", "custom"],
                     "order": 2, "default": ""},
    "time":         {"label": "时间时刻", "icon": "🕐", "group_keys": ["tone", "custom"],
                     "order": 3, "default": ""},
    "season":       {"label": "季节气候", "icon": "🌤", "group_keys": ["tone", "custom"],
                     "order": 4, "default": ""},
    "weather":      {"label": "天气现象", "icon": "🌧", "group_keys": ["tone", "custom"],
                     "order": 5, "default": ""},
    "atmosphere":   {"label": "氛围情绪", "icon": "🌫", "group_keys": ["emotion_style", "tone", "custom"],
                     "order": 6, "default": ""},
    "lighting":     {"label": "光影效果", "icon": "💡", "group_keys": ["tone", "custom"],
                     "order": 7, "default": ""},
    "color_scheme": {"label": "色彩搭配", "icon": "🎨", "group_keys": ["color", "custom"],
                     "order": 8, "default": ""},
    "perspective":  {"label": "视角取景", "icon": "📐", "group_keys": ["composition", "custom"],
                     "order": 9, "default": ""},
    "composition":  {"label": "构图布局", "icon": "🖼", "group_keys": ["composition", "custom"],
                     "order": 10, "default": ""},
    "details":      {"label": "细节元素", "icon": "🔍", "group_keys": ["custom"],
                     "order": 11, "default": ""},
    "style":        {"label": "画风风格", "icon": "🎭", "group_keys": ["composition", "custom"],
                     "order": 12, "default": ""},
    "quality":      {"label": "画质参数", "icon": "⚡", "group_keys": ["quality", "custom"],
                     "order": 13, "default": ""},
    "negative":     {"label": "负面提示词", "icon": "⚠️", "group_keys": ["negative", "custom"],
                     "order": 14, "default": ""},
}

# ==================== Pydantic Models ====================
class SceneCreate(BaseModel):
    name: str = "新场景"
    settings: dict = {}

class SceneUpdate(BaseModel):
    name: Optional[str] = None
    settings: Optional[dict] = None

class SceneComposeReq(BaseModel):
    settings: dict = {}
    density: str = "standard"
    language: str = "zh"


# ==================== DB: 确保 scene_profiles 表存在 ====================
def _ensure_scene_table():
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS scene_profiles (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL DEFAULT '',
            settings_json   TEXT DEFAULT '{}',
            is_builtin      INTEGER DEFAULT 0,
            sort_order      INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            updated_at      TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    db.commit()


# ==================== 场景 CRUD ====================

# 字段映射：settings_json → scene_profiles 富字段（双向互通提示词组装器）
_SETTINGS_TO_FIELDS = {
    "location": "location_desc",
    "atmosphere": "atmosphere",
    "architecture": "architecture",
    "lighting": "lighting_desc",
    "time": "time_period",
    "weather": "weather_desc",
    "color_scheme": "color_scheme",
    "style": "architecture",  # 画风→建筑（可覆盖）
}


def _derive_scene_fields(settings: dict) -> dict:
    """从 settings_json 派生 scene_profiles 富字段"""
    fields = {}
    for sk, fk in _SETTINGS_TO_FIELDS.items():
        val = (settings.get(sk) or "").strip()
        if val:
            fields[fk] = val
    # atmosphere 降级：如果没传 atmosphere 但有 lighting + weather + time 则拼接
    if not fields.get("atmosphere"):
        parts = []
        for k in ["weather", "time", "lighting", "composition"]:
            v = (settings.get(k) or "").strip()
            if v: parts.append(v)
        if parts:
            fields["atmosphere"] = "，".join(parts)
    return fields


def _save_scene_rich_fields(db, scene_id: int, settings: dict):
    """将派生字段写入 scene_profiles"""
    fields = _derive_scene_fields(settings)
    if not fields:
        return
    set_parts = []
    vals = []
    for k, v in fields.items():
        set_parts.append(f"{k}=?")
        vals.append(v)
    set_parts.append("updated_at=datetime('now','localtime')")
    vals.append(scene_id)
    sql = f"UPDATE scene_profiles SET {', '.join(set_parts)} WHERE id=?"
    db.execute(sql, vals)
    try:
        db.commit()
    except:
        safe_commit()
@router.get("/scenes")
def list_scenes(page: int = 1, page_size: int = 20):
    _ensure_scene_table()
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM scene_profiles").fetchone()[0]
    rows = db.execute(
        "SELECT * FROM scene_profiles ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        [page_size, (page - 1) * page_size]
    ).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        try: d["settings"] = json.loads(d.get("settings_json") or "{}")
        except: d["settings"] = {}
        items.append(d)
    return {"ok": True, "items": items, "total": total}


@router.get("/scenes/{scene_id}")
def get_scene(scene_id: int):
    _ensure_scene_table()
    db = get_db()
    r = db.execute("SELECT * FROM scene_profiles WHERE id=?", [scene_id]).fetchone()
    if not r:
        raise HTTPException(404, "场景不存在")
    d = dict(r)
    try: d["settings"] = json.loads(d.get("settings_json") or "{}")
    except: d["settings"] = {}
    return {"ok": True, "scene": d}


@router.post("/scenes")
def create_scene(data: SceneCreate):
    _ensure_scene_table()
    db = get_db()
    db.execute(
        "INSERT INTO scene_profiles (name, settings_json) VALUES (?,?)",
        [data.name, json.dumps(data.settings, ensure_ascii=False)]
    )
    db.commit()
    sid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    # 同步派生字段（场景库互通）
    _save_scene_rich_fields(db, sid, data.settings)
    return {"ok": True, "id": sid, "name": data.name}


@router.put("/scenes/{scene_id}")
def update_scene(scene_id: int, data: SceneUpdate):
    _ensure_scene_table()
    db = get_db()
    if data.name is not None:
        db.execute("UPDATE scene_profiles SET name=?, updated_at=datetime('now','localtime') WHERE id=?",
                   [data.name, scene_id])
    if data.settings is not None:
        db.execute("UPDATE scene_profiles SET settings_json=?, updated_at=datetime('now','localtime') WHERE id=?",
                   [json.dumps(data.settings, ensure_ascii=False), scene_id])
    db.commit()
    # 同步派生字段
    if data.settings is not None:
        _save_scene_rich_fields(db, scene_id, data.settings)
    return {"ok": True}


@router.delete("/scenes/{scene_id}")
def delete_scene(scene_id: int):
    _ensure_scene_table()
    db = get_db()
    db.execute("DELETE FROM scene_profiles WHERE id=?", [scene_id])
    db.commit()
    return {"ok": True}


# ==================== 维度卡片库 ====================
@router.get("/dimensions")
def list_dimensions():
    """返回场景维度 + 对应词卡分组"""
    _ensure_scene_table()
    db = get_db()
    dims = []
    for key, dim in sorted(SCENE_DIMENSIONS.items(), key=lambda x: x[1]["order"]):
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


# ==================== 组装引擎 ====================
@router.post("/compose")
def compose_scene(data: SceneComposeReq):
    """将场景各维度字段拼接为完整环境提示词"""
    settings = data.settings
    density = data.density
    parts = []
    json_parts = {}

    # 组装顺序（行业标准环境描述公式）
    # compact:  地点+时间+天气+氛围
    # standard: 画风+地点+建筑+时间+季节+天气+氛围+光影+色彩+视角
    # detailed: 全部14维度

    # 1. 画风 — 所有密度
    style = settings.get("style", "").strip()
    if style:
        parts.append(style)
        json_parts["style"] = style

    # 2. 地点
    loc = settings.get("location", "").strip()
    if loc:
        parts.append(loc)
        json_parts["location"] = loc

    # 3. 建筑 (standard+)
    if density != "compact":
        arch = settings.get("architecture", "").strip()
        if arch:
            parts.append(arch)
            json_parts["architecture"] = arch

    # 4. 时间
    time = settings.get("time", "").strip()
    if time:
        parts.append(time)
        json_parts["time"] = time

    # 5. 季节 (standard+)
    if density != "compact":
        season = settings.get("season", "").strip()
        if season:
            parts.append(season)
            json_parts["season"] = season

    # 6. 天气
    weather = settings.get("weather", "").strip()
    if weather:
        parts.append(weather)
        json_parts["weather"] = weather

    # 7. 氛围
    atmo = settings.get("atmosphere", "").strip()
    if atmo:
        parts.append(atmo)
        json_parts["atmosphere"] = atmo

    # 8. 光影 (standard+)
    if density != "compact":
        light = settings.get("lighting", "").strip()
        if light:
            parts.append(light)
            json_parts["lighting"] = light

    # 9. 色彩 (standard+)
    if density != "compact":
        color = settings.get("color_scheme", "").strip()
        if color:
            parts.append(color)
            json_parts["color_scheme"] = color

    # 10. 视角 (standard+)
    if density != "compact":
        persp = settings.get("perspective", "").strip()
        if persp:
            parts.append(persp)
            json_parts["perspective"] = persp

    # 11. 构图 (standard+)
    if density != "compact":
        comp = settings.get("composition", "").strip()
        if comp:
            parts.append(comp)
            json_parts["composition"] = comp

    # 12. 细节 (detailed)
    if density == "detailed":
        det = settings.get("details", "").strip()
        if det:
            parts.append(det)
            json_parts["details"] = det

    # 13. 画质 (detailed)
    if density == "detailed":
        qual = settings.get("quality", "").strip()
        if qual:
            parts.append(qual)
            json_parts["quality"] = qual

    # 14. 负面
    negative = settings.get("negative", "").strip()
    json_parts["negative"] = negative

    text = "，".join(p for p in parts if p)
    if negative and density != "compact":
        text += f"\n\n负面提示词: {negative}"

    stats = {
        "char_count": len(text),
        "dimension_count": len([k for k, v in settings.items() if v and str(v).strip()]),
        "density": density,
    }
    return {"ok": True, "text": text, "parts": json_parts, "stats": stats, "density": density}


# ==================== 预设模板 ====================
PRESET_TEMPLATES = {
    "cyberpunk_city": {
        "name": "赛博朋克都市",
        "settings": {
            "location": "霓虹闪耀的未来都市",
            "architecture": "高耸的赛博摩天楼，全息广告牌",
            "time": "深夜时分",
            "season": "冬季",
            "weather": "细雨霏霏，薄雾缭绕",
            "atmosphere": "冷峻神秘，科技与颓废并存",
            "lighting": "霓虹蓝紫色荧光从下方打亮",
            "color_scheme": "青蓝+紫粉撞色，高对比",
            "perspective": "仰视视角，纵深感极强",
            "composition": "引导线构图，向天空延伸",
            "style": "赛博朋克2077风格",
            "quality": "4K超写实，粒子特效"
        }
    },
    "fantasy_forest": {
        "name": "魔法森林秘境",
        "settings": {
            "location": "古老魔法森林深处",
            "architecture": "精灵风格树屋，藤蔓缠绕的拱门",
            "time": "晨曦时分",
            "season": "春季",
            "weather": "薄雾弥漫，光线穿透叶隙",
            "atmosphere": "静谧神圣，充满生命力",
            "lighting": "金色晨光洒落，光斑舞动",
            "color_scheme": "翠绿+金色暖调",
            "perspective": "平视，深远景",
            "style": "吉卜力动画风格",
            "quality": "4K极致细节，CG渲染级"
        }
    },
    "ancient_temple": {
        "name": "远古神殿遗迹",
        "settings": {
            "location": "沙漠中的远古神殿遗迹",
            "architecture": "巨石柱廊，古老符文雕刻",
            "time": "黄昏时分",
            "season": "秋季",
            "weather": "沙尘轻扬，夕阳低垂",
            "atmosphere": "庄严神秘，岁月沧桑",
            "lighting": "暖橙夕阳光穿过石柱，长影延伸",
            "color_scheme": "金橙+深褐史诗色调",
            "perspective": "低角度仰拍，强调宏伟",
            "style": "史诗电影风格",
            "quality": "8K超细腻，大气透视"
        }
    },
    "coastal_sunset": {
        "name": "海滨日落",
        "settings": {
            "location": "静谧海边悬崖",
            "weather": "晴朗，晚霞漫天",
            "time": "日落黄金时刻",
            "season": "夏季",
            "atmosphere": "浪漫宁静，无限遐想",
            "lighting": "金色逆光，海面粼粼波光",
            "color_scheme": "暖橙+粉紫渐变",
            "perspective": "广角远眺，海天一线",
            "style": "印象派油画风格",
            "quality": "4K高画质"
        }
    },
    "winter_village": {
        "name": "冬日雪村",
        "settings": {
            "location": "被大雪覆盖的北欧小村庄",
            "architecture": "尖顶木屋，烟囱袅袅",
            "time": "傍晚时分",
            "season": "隆冬",
            "weather": "大雪纷飞，银装素裹",
            "atmosphere": "温馨宁静，节日氛围",
            "lighting": "暖黄窗灯透出，雪地反光",
            "color_scheme": "白+暖黄+深蓝",
            "perspective": "鸟瞰俯视",
            "style": "宫崎骏动画风格",
            "quality": "4K细腻质感"
        }
    }
}

@router.get("/presets")
def get_presets():
    return {"ok": True, "presets": PRESET_TEMPLATES}


# ============================================================
# 场景模板 → 提示词组装器 桥接（种子舞镜头选取场景档案）
# ============================================================

@router.put("/scenes/{scene_id}/apply-to-shot")
def apply_scene_to_shot(scene_id: int, data: dict = Body(...)):
    """将场景模板应用到提示词组装器的镜头

    入参: { shot_id: int }
    动作:
      1. 读 scene_profiles.settings_json
      2. 将维度字段映射到 user_project_scene 对应列
      3. UPDATE user_project_scene SET ... WHERE id=?
    返回: { ok, shot_id, applied_fields }
    """
    shot_id = data.get("shot_id")
    if not shot_id:
        raise HTTPException(400, "shot_id 必填")

    db = get_db()
    scene = db.execute("SELECT * FROM scene_profiles WHERE id=?", [scene_id]).fetchone()
    if not scene:
        raise HTTPException(404, "场景模板不存在")

    try:
        settings = json.loads(scene["settings_json"] or "{}")
    except:
        settings = {}

    # 字段映射：scene_composer dimension key → user_project_scene column
    FIELD_MAP = {
        "location": "scene_desc",
        "atmosphere": "emotion",
        "lighting": "lighting",
        "weather": "weather",
        "color_scheme": "color_grade",
        "perspective": "perspective",
        "composition": "composition",
        "details": "environment_detail",
        "style": "filter",
        "time": "emotion",  # time_period → emotion 附加
    }

    applied = {}
    set_parts = []
    vals = []
    for dim_key, col in FIELD_MAP.items():
        val = (settings.get(dim_key) or "").strip()
        if not val:
            continue
        # 如果目标列已有值且不覆盖同名列则追加
        if col in applied:
            existing = db.execute(f"SELECT {col} FROM user_project_scene WHERE id=?", [shot_id]).fetchone()
            if existing and existing[0]:
                val = str(existing[0]) + "，" + val
        set_parts.append(f"{col}=?")
        vals.append(val)
        applied[col] = val

    if not set_parts:
        return {"ok": True, "shot_id": shot_id, "applied_fields": {}, "note": "场景模板无有效字段"}

    vals.append(shot_id)
    db.execute(f"UPDATE user_project_scene SET {', '.join(set_parts)} WHERE id=?", vals)
    safe_commit()

    # 同时设置 scene_profile_id 外键
    db.execute("UPDATE user_project_scene SET scene_profile_id=? WHERE id=?", [scene_id, shot_id])
    safe_commit()

    return {"ok": True, "shot_id": shot_id, "applied_fields": applied,
            "scene_name": scene["name"], "field_count": len(applied)}
