"""
API 路由 — Phase 3：Seedance 视频提示词组装器 + 画廊 + 模板引擎
"""
import json
from fastapi import APIRouter, Query, HTTPException, Body
from database import get_db

router = APIRouter(prefix="/api/seedance", tags=["seedance"])


# ==================== 1. 模板分类 ====================

@router.get("/categories")
def list_seedance_categories():
    """获取 Seedance 模板分类（含每个分类的模板数量和标签云）"""
    db = get_db()
    rows = db.execute("""
        SELECT category, COUNT(*) as cnt
        FROM prompts
        WHERE module='seedance'
        GROUP BY category
        ORDER BY cnt DESC
    """).fetchall()

    # 每个分类收集标签
    categories = []
    for r in rows:
        tag_rows = db.execute("""
            SELECT tags FROM prompts
            WHERE module='seedance' AND category=?
            LIMIT 30
        """, [r["category"]]).fetchall()
        all_tags = set()
        for tr in tag_rows:
            try:
                for t in json.loads(tr["tags"]):
                    all_tags.add(t)
            except Exception:
                pass
        categories.append({
            "id": r["category"],
            "name": r["category"],
            "count": r["cnt"],
            "tags": sorted(all_tags)[:10]  # 取前10个标签
        })

    return {"categories": categories}


# ==================== 2. 模板详情 ====================

@router.get("/templates")
def list_templates(
    category: str = Query(None),
    search: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50)
):
    """获取 Seedance 模板列表"""
    db = get_db()
    params = []

    sql = " FROM prompts p WHERE p.module='seedance'"
    if category:
        sql += " AND p.category=?"
        params.append(category)
    if search:
        like = f"%{search}%"
        sql += " AND (p.content LIKE ? OR p.meaning LIKE ? OR p.tags LIKE ?)"
        params += [like, like, like]

    total = db.execute(f"SELECT COUNT(*) as cnt{sql}", params).fetchone()["cnt"]

    offset = (page - 1) * page_size
    rows = db.execute(f"""
        SELECT p.id, p.module, p.category, p.subcategory,
               p.content, p.meaning, p.scene, p.tags,
               p.usage_count
        {sql}
        ORDER BY p.usage_count DESC, p.id ASC
        LIMIT ? OFFSET ?
    """, params + [page_size, offset]).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": [dict(r) for r in rows]
    }


@router.get("/templates/{tpl_id}")
def get_template(tpl_id: int):
    """获取单个模板详情（含推荐搭配词条）"""
    db = get_db()
    row = db.execute("SELECT * FROM prompts WHERE id=?", [tpl_id]).fetchone()
    if not row:
        raise HTTPException(404, "模板不存在")

    # 提取关键词，推荐关联模块的词条
    try:
        tags = json.loads(row["tags"])
    except Exception:
        tags = []

    # 推荐：跨模块的配搭词条（取色调/构图相关的高频词）
    recommended = []
    if any(t in ["情感", "故事", "电影感", "家庭"] for t in tags):
        recommended.extend(_get_recommended_by_tags(
            db, ["温馨", "暖色调", "中景", "柔光"], exclude_id=tpl_id, limit=4
        ))
    elif any(t in ["日系", "纯爱", "青春"] for t in tags):
        recommended.extend(_get_recommended_by_tags(
            db, ["日系", "清新", "逆光", "特写"], exclude_id=tpl_id, limit=4
        ))
    elif any(t in ["战斗", "动作", "武侠"] for t in tags):
        recommended.extend(_get_recommended_by_tags(
            db, ["动感", "快速", "冲击", "暗调"], exclude_id=tpl_id, limit=4
        ))
    else:
        recommended.extend(_get_recommended_by_tags(
            db, tags[:3], exclude_id=tpl_id, limit=4
        ))

    return {
        "template": dict(row),
        "recommended": recommended
    }


def _get_recommended_by_tags(db, tag_list, exclude_id, limit=4):
    """按标签列表推荐词条"""
    params = []
    or_clauses = []
    for t in tag_list:
        like = f"%{t}%"
        or_clauses.append("p.tags LIKE ?")
        params.append(like)
    params.append(exclude_id)
    where = " OR ".join(or_clauses)
    rows = db.execute(f"""
        SELECT p.id, p.module, p.category, p.content, p.meaning, p.tags
        FROM prompts p
        WHERE ({where}) AND p.is_builtin=1 AND p.id != ?
        ORDER BY p.usage_count DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    return [dict(r) for r in rows]


# ==================== 3. 时间轴组件助手 ====================

@router.post("/compose")
def compose_prompt(data: dict = Body(...)):
    """
    Seedance 提示词组装器
    将风格描述 + 时间轴分镜 + 声音设计 + 引用素材 拼装为完整提示词
    """
    style = data.get("style", "")
    duration = data.get("duration", 15)
    aspect_ratio = data.get("aspect_ratio", "16:9")
    scenes = data.get("scenes", [])  # [{"time": "0-3", "description": ""}, ...]
    sound = data.get("sound", "")
    references = data.get("references", [])  # ["@图片1 角色形象", "@视频1 运镜参考"]
    mood = data.get("mood", "")

    lines = []
    # 头部风格定义
    header_parts = []
    if style:
        header_parts.append(style)
    if duration:
        header_parts.append("%d秒" % duration)
    if aspect_ratio:
        header_parts.append(aspect_ratio)
    if mood:
        header_parts.append(mood)
    if header_parts:
        lines.append("【风格】" + "，".join(header_parts))
        lines.append("")

    # 时间轴
    if scenes:
        for sc in scenes:
            time_label = sc.get("time", "")
            desc = sc.get("description", "").strip()
            if time_label and desc:
                lines.append("%s秒：%s" % (time_label, desc))
        lines.append("")

    # 声音
    if sound:
        lines.append("【声音】%s" % sound)
        lines.append("")

    # 参考
    if references:
        ref_str = "，".join(references)
        lines.append("【参考】%s" % ref_str)

    prompt_text = "\n".join(lines).strip()
    return {
        "ok": True,
        "text": prompt_text,
        "length": len(prompt_text),
        "line_count": len(lines)
    }


# ==================== 4. 推荐画廊 ====================

@router.get("/gallery")
def get_gallery():
    """精选模板画廊（每个分类取前2个最高频模板）"""
    db = get_db()
    categories = db.execute("""
        SELECT DISTINCT category FROM prompts
        WHERE module='seedance'
        ORDER BY category
    """).fetchall()

    gallery = []
    for cat in categories:
        cid = cat["category"]
        rows = db.execute("""
            SELECT p.id, p.category, p.content, p.meaning, p.tags, p.usage_count
            FROM prompts p
            WHERE p.module='seedance' AND p.category=?
            ORDER BY p.usage_count DESC
            LIMIT 2
        """, [cid]).fetchall()
        items = []
        for r in rows:
            try:
                tag_list = json.loads(r["tags"])
            except Exception:
                tag_list = []
            items.append({
                "id": r["id"],
                "content_preview": r["content"][:80] + ("..." if len(r["content"]) > 80 else ""),
                "meaning": r["meaning"],
                "tags": tag_list[:4],
                "usage_count": r["usage_count"]
            })
        gallery.append({
            "category": cid,
            "count": len(items),
            "items": items
        })

    return {"gallery": gallery}


# ==================== 5. 镜头语言速查 ====================

CAMERA_GLOSSARY = [
    {"name": "推镜头", "keywords": "dolly in / push in", "effect": "从远到近推向主体", "use": "强调/入戏/情感"},
    {"name": "拉镜头", "keywords": "dolly out / pull back", "effect": "从近到远拉出画面", "use": "揭示/离场/孤独"},
    {"name": "摇镜头", "keywords": "pan shot", "effect": "水平旋转镜头", "use": "展示环境/连接场景"},
    {"name": "移镜头", "keywords": "tracking shot", "effect": "平行跟随主体移动", "use": "跟拍/连续/沉浸"},
    {"name": "跟镜头", "keywords": "follow shot", "effect": "在主体后方跟随", "use": "代入/跟随/动态"},
    {"name": "升降镜头", "keywords": "crane up/down", "effect": "垂直上下运动", "use": "宏大/变化/对比"},
    {"name": "环绕镜头", "keywords": "orbit shot", "effect": "围绕主体旋转", "use": "360展示/沉浸"},
    {"name": "滑动变焦", "keywords": "dolly zoom", "effect": "背景压缩/拉伸", "use": "希区柯克/紧张"},
    {"name": "呼吸感运镜", "keywords": "breathing motion", "effect": "轻微上下浮动", "use": "纪实/真实感"},
    {"name": "漂浮运镜", "keywords": "floating glide", "effect": "悬空平滑移动", "use": "梦境/抽象"},
    {"name": "甩镜头", "keywords": "whip pan", "effect": "极速扫转转场", "use": "快节奏/帅气转场"},
    {"name": "急推急拉", "keywords": "crash zoom", "effect": "瞬间推进或拉出", "use": "震惊/揭示"},
    {"name": "旋转俯冲", "keywords": "spiral dive", "effect": "边旋转边下降", "use": "炫技/极限"},
    {"name": "穿越机视角", "keywords": "FPV drone", "effect": "高速穿梭飞行", "use": "风光/极限"},
    {"name": "手持追焦", "keywords": "handheld follow", "effect": "晃动中追踪主体", "use": "奔跑/纪实"},
    {"name": "一镜到底", "keywords": "one-take", "effect": "全片无剪辑单镜头", "use": "炫技/沉浸"},
    {"name": "航拍大景", "keywords": "aerial wide", "effect": "高空俯瞰全景", "use": "开场/宏大"},
    {"name": "慢动作升格", "keywords": "slow motion HFR", "effect": "高速拍摄慢放", "use": "情感/唯美"},
    {"name": "穿越转场", "keywords": "portal transition", "effect": "穿过物体到新场景", "use": "创意转场"},
    {"name": "延时推拉", "keywords": "hyperlapse", "effect": "长时间变化压缩", "use": "城市/时间流逝"},
]

@router.get("/camera-glossary")
def get_camera_glossary():
    """获取镜头语言速查表"""
    return {"items": CAMERA_GLOSSARY}


# ==================== 6. 多模态引用语法速查 ====================

REFERENCE_SYNTAX = [
    {"pattern": "@图片N 作为首帧", "description": "指定图片作为视频第一帧"},
    {"pattern": "@图片N 作为角色形象参考", "description": "保持角色一致性"},
    {"pattern": "@图片N 作为场景参考", "description": "场景设计参考"},
    {"pattern": "@视频N 参考运镜方式", "description": "复刻参考视频的运镜"},
    {"pattern": "@视频N 参考动作节奏", "description": "动作节奏参考"},
    {"pattern": "@视频N 作为原视频延长", "description": "基于此视频继续生成"},
    {"pattern": "@音频N 用于配乐", "description": "背景音乐/氛围音"},
    {"pattern": "@音频N 用于对白参考", "description": "口播/配音参考"},
]

@router.get("/reference-syntax")
def get_reference_syntax():
    """获取多模态引用语法速查"""
    return {"items": REFERENCE_SYNTAX}


# ==================== 7. 画风词库 ====================

@router.get("/styles")
def get_styles():
    """获取画风词库（从 library_assets 读取）"""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM library_assets WHERE lib_type='style' ORDER BY sort_order, id"
    ).fetchall()
    # 按 category 分组
    cats = {}
    order = []
    for r in rows:
        cat_name = r['category']
        if cat_name not in cats:
            cats[cat_name] = {'id': cat_name, 'name': cat_name, 'icon': r['icon'] or '', 'styles': []}
            order.append(cat_name)
        cats[cat_name]['styles'].append({
            'id': r['definition'] or r['id'],
            'name': r['name'],
            'prompt': r['prompt']
        })
    return {'categories': [cats[k] for k in order]}


@router.get("/styles/{category_id}")
def get_style_category(category_id: str):
    """获取某分类下的所有画风"""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM library_assets WHERE lib_type='style' AND category=? ORDER BY sort_order",
        (category_id,)
    ).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="分类未找到")
    return {
        'id': category_id, 'name': category_id,
        'styles': [{'id': r['definition'] or r['id'], 'name': r['name'], 'prompt': r['prompt']} for r in rows]
    }


@router.get("/styles/prompt/{style_id}")
def get_style_prompt(style_id: str):
    """获取某画风的完整提示词"""
    db = get_db()
    r = db.execute(
        "SELECT * FROM library_assets WHERE lib_type='style' AND (definition=? OR id=?)",
        (style_id, int(style_id) if style_id.isdigit() else -1)
    ).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="画风未找到")
    return {'id': r['definition'] or r['id'], 'name': r['name'], 'prompt': r['prompt']}


# ==================== 8. 负面提示词词库 ====================

@router.get("/negative-prompts")
def get_negative_prompts():
    """获取负面提示词词库（从 library_assets 读取）"""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM library_assets WHERE lib_type='negative' ORDER BY sort_order, id"
    ).fetchall()
    cats = {}
    order = []
    for r in rows:
        cat_name = r['category']
        if cat_name not in cats:
            cats[cat_name] = {'id': cat_name, 'name': cat_name, 'icon': r['icon'] or '', 'items': []}
            order.append(cat_name)
        cats[cat_name]['items'].append({
            'id': r['definition'] or r['id'],
            'name': r['name'],
            'prompt': r['prompt']
        })
    return {'categories': [cats[k] for k in order]}


@router.get("/negative-prompts/{category_id}")
def get_negative_category(category_id: str):
    """获取某分类下的所有负面提示词"""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM library_assets WHERE lib_type='negative' AND category=? ORDER BY sort_order",
        (category_id,)
    ).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="分类未找到")
    return {
        'id': category_id, 'name': category_id,
        'items': [{'id': r['definition'] or r['id'], 'name': r['name'], 'prompt': r['prompt']} for r in rows]
    }
