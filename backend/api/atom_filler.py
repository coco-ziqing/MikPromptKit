# -*- coding: utf-8 -*-
"""
Phase16-v5.2.0: atom_filler — 原子化词卡智能填充引擎

核心能力:
  POST /fill/character   — 选择角色→自动匹配角色域原子 + 通用域原子
  POST /fill/scene       — 选择场景→自动匹配场景域原子
  POST /fill/camera      — 选择镜头模板→自动匹配镜头域原子
  POST /fill/assemble    — 统一组装填充: 角色+场景+镜头 → 全维度原子注入
  GET  /fill/query       — 关键词查询 atom_asset_library (通用检索)

数据源: atom_asset_library (Phase16-v5.2.0 统一资产表, 928条)
"""
import json, re, hashlib
from fastapi import APIRouter, Query, HTTPException, Body
from pydantic import BaseModel
from typing import Optional, List
from database import get_db, safe_fetch_one

router = APIRouter(prefix="/api/composer", tags=["atom-filler"])

# ==================== Pydantic Models ====================

class CharacterFillReq(BaseModel):
    character_id: int
    media_category: str = "image"  # image | video | both
    limit: int = 10
    include_general: bool = True   # 是否也拉取通用域原子

class SceneFillReq(BaseModel):
    scene_id: int
    media_category: str = "image"
    limit: int = 10
    include_general: bool = True

class CameraFillReq(BaseModel):
    camera_fields: dict = {}        # {camera_move: "推轨", subject: "人物", ...}
    media_category: str = "video"
    limit: int = 8

class AssembleFillReq(BaseModel):
    character_id: Optional[int] = None
    scene_id: Optional[int] = None
    camera_fields: Optional[dict] = None
    media_category: str = "image"
    limit_per_domain: int = 6
    density: str = "standard"  # compact|standard|detailed


# ==================== 核心查询函数 ====================

def _query_atoms(db, linked_type: str = None, linked_id: int = None,
                 media_category: str = "image", keywords: List[str] = None,
                 atom_types: List[str] = None, limit: int = 10,
                 source: str = None) -> list:
    """
    统一原子资产查询引擎
    
    参数:
      linked_type: character|scene|camera|audio|general
      linked_id:   character_profiles.id | scene_profiles.id
      media_category: image|video|both
      keywords:    [keyword1, keyword2...] 用于模糊匹配 atom_text
      atom_types:  [subject, style, lighting...] 类型过滤
      limit:       返回数量上限
      source:      manual|ai_decompose|character_extract|...
    """
    conditions = ["aal.is_active=1"]
    params = []

    if linked_type:
        conditions.append("aal.linked_type=?")
        params.append(linked_type)
    if linked_id:
        conditions.append("aal.linked_id=?")
        params.append(linked_id)
    if media_category and media_category != "both":
        conditions.append("(aal.media_category=? OR aal.media_category='both')")
        params.append(media_category)
    if source:
        conditions.append("aal.source=?")
        params.append(source)
    if atom_types:
        placeholders = ",".join(["?"] * len(atom_types))
        conditions.append(f"aal.atom_type IN ({placeholders})")
        params.extend(atom_types)

    # 关键词匹配
    keyword_conditions = []
    if keywords:
        for kw in keywords:
            kw = kw.strip()
            if len(kw) >= 2:
                keyword_conditions.append("aal.atom_text LIKE ?")
                params.append(f"%{kw}%")
    if keyword_conditions:
        conditions.append(f"({' OR '.join(keyword_conditions)})")

    where = " AND ".join(conditions)
    sql = f"""
        SELECT aal.* FROM atom_asset_library aal
        WHERE {where}
        ORDER BY aal.usage_count DESC, aal.combo_count DESC, aal.quality_score DESC
        LIMIT ?
    """
    params.append(limit)
    rows = db.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def _extract_keywords(text: str, max_kw: int = 8) -> List[str]:
    """从文本中提取中文关键词（供原子库匹配用）"""
    if not text:
        return []
    words = re.findall(r'[\u4e00-\u9fff]{2,}', str(text))
    # 过滤停用词
    stop_words = {"一个", "一种", "这是", "就是", "可以", "非常", "特别",
                  "比较", "没有", "什么", "这个", "那个", "不是", "还是",
                  "但是", "因为", "所以", "如果", "虽然", "不过", "然后"}
    filtered = [w for w in words if w not in stop_words]
    # 去重
    seen = set()
    unique = []
    for w in filtered:
        if w not in seen:
            seen.add(w)
            unique.append(w)
    return unique[:max_kw]


# ==================== API 端点 ====================

@router.post("/fill/character")
def fill_by_character(req: CharacterFillReq):
    """
    选择角色模板 → 自动填充关联的原子化词卡

    流程:
      ① 查询 character_profiles 获取 appearance/personality
      ② 提取关键词
      ③ 查询 atom_asset_library WHERE linked_type='character' AND linked_id=?
      ④ 关键词模糊匹配补充 (linked_type='character' + 通用)
      ⑤ 按 usage_count DESC 排序返回
    """
    db = get_db()
    char = safe_fetch_one("""
        SELECT id, name, appearance, personality, occupation, gender, age_range
        FROM character_profiles WHERE id=?
    """, [req.character_id])
    if not char:
        raise HTTPException(404, "角色不存在")

    # 提取关键词
    appearance = (char["appearance"] or "").strip()
    personality = (char["personality"] or "").strip()
    occupation = (char["occupation"] or "").strip()
    keywords = _extract_keywords(f"{appearance} {personality} {occupation}")

    # 查询角色域原子（直接关联）
    direct_atoms = _query_atoms(
        db, linked_type="character", linked_id=req.character_id,
        media_category=req.media_category, limit=req.limit
    )

    # 查询角色域原子（关键词匹配）
    kw_atoms = _query_atoms(
        db, linked_type="character", keywords=keywords,
        media_category=req.media_category, limit=req.limit
    )

    # 通用域原子（关键词匹配）
    general_atoms = []
    if req.include_general:
        general_atoms = _query_atoms(
            db, linked_type="general", keywords=keywords,
            media_category=req.media_category, limit=req.limit // 2
        )

    # 去重合并
    seen_hashes = set()
    merged = []
    for atom in direct_atoms + kw_atoms + general_atoms:
        h = atom["atom_hash"]
        if h not in seen_hashes:
            seen_hashes.add(h)
            merged.append(atom)

    # 按热度排序
    merged.sort(key=lambda x: (x["usage_count"] + x["combo_count"]), reverse=True)

    return {
        "ok": True,
        "character_id": req.character_id,
        "character_name": char["name"],
        "keywords": keywords,
        "atoms": merged[:req.limit],
        "total_matched": len(merged),
        "sources": {
            "direct": len(direct_atoms),
            "keyword": len(kw_atoms),
            "general": len(general_atoms)
        }
    }


@router.post("/fill/scene")
def fill_by_scene(req: SceneFillReq):
    """
    选择场景模板 → 自动填充关联的原子化词卡

    流程:
      ① 查询 scene_profiles 获取 settings_json
      ② 提取各维度关键词
      ③ 查询 atom_asset_library WHERE linked_type='scene' AND linked_id=?
      ④ 补充场景域通用原子 + 通用域原子
    """
    db = get_db()
    scene = safe_fetch_one("""
        SELECT id, name, settings_json FROM scene_profiles WHERE id=?
    """, [req.scene_id])
    if not scene:
        raise HTTPException(404, "场景不存在")

    try:
        settings = json.loads(scene["settings_json"] or "{}")
    except:
        settings = {}

    # 提取关键词
    keywords = _extract_keywords(json.dumps(settings, ensure_ascii=False))

    # 查询场景域原子（直接关联）
    direct_atoms = _query_atoms(
        db, linked_type="scene", linked_id=req.scene_id,
        media_category=req.media_category, limit=req.limit
    )

    # 查询场景域原子（关键词匹配）
    kw_atoms = _query_atoms(
        db, linked_type="scene", keywords=keywords,
        media_category=req.media_category, limit=req.limit
    )

    # 通用域
    general_atoms = []
    if req.include_general:
        general_atoms = _query_atoms(
            db, linked_type="general", keywords=keywords,
            media_category=req.media_category, limit=req.limit // 2
        )

    # 去重合并
    seen_hashes = set()
    merged = []
    for atom in direct_atoms + kw_atoms + general_atoms:
        h = atom["atom_hash"]
        if h not in seen_hashes:
            seen_hashes.add(h)
            merged.append(atom)

    merged.sort(key=lambda x: (x["usage_count"] + x["combo_count"]), reverse=True)

    return {
        "ok": True,
        "scene_id": req.scene_id,
        "scene_name": scene["name"],
        "keywords": keywords,
        "atoms": merged[:req.limit],
        "total_matched": len(merged),
        "dimensions": list(settings.keys())
    }


@router.post("/fill/camera")
def fill_by_camera(req: CameraFillReq):
    """
    镜头维度字段 → 匹配镜头域原子 + 视频类原子

    流程:
      ① 从 camera_fields 提取各维度关键词
      ② 查询 atom_asset_library WHERE linked_type='camera' + 关键词匹配
    """
    db = get_db()
    fields = req.camera_fields
    if not fields:
        raise HTTPException(400, "请提供 camera_fields")

    # 提取关键词
    keywords = _extract_keywords(json.dumps(fields, ensure_ascii=False))

    # 按各个维度分别查询对应的 atom_type
    type_field_map = {
        "camera_move": ["camera"],
        "subject": ["subject"],
        "action": ["action"],
        "composition": ["composition"],
        "lighting": ["lighting"],
        "focal_length": ["camera"],
        "texture": ["quality"],
        "speed": ["action"],
        "emotion": ["creative"],
        "color_grade": ["color"],
        "weather": ["atmosphere"],
        "particles": ["creative"],
        "perspective": ["camera"],
        "depth_of_field": ["camera"]
    }

    all_results = []
    seen_hashes = set()
    for fname, fval in fields.items():
        if not fval or not str(fval).strip():
            continue
        fval_str = str(fval).strip()
        if len(fval_str) < 1:
            continue

        # 直接用字段值作为关键词
        kw = [fval_str[:30]]

        # 用对应 atom_type 查询
        types = type_field_map.get(fname, ["general"])
        rows = _query_atoms(
            db, linked_type="camera", keywords=kw,
            atom_types=types, media_category=req.media_category,
            limit=3
        )
        for r in rows:
            if r["atom_hash"] not in seen_hashes:
                seen_hashes.add(r["atom_hash"])
                all_results.append(r)

    # 全局关键词匹配补充
    extra = _query_atoms(
        db, linked_type="camera", keywords=keywords,
        media_category=req.media_category, limit=req.limit
    )
    for r in extra:
        if r["atom_hash"] not in seen_hashes:
            seen_hashes.add(r["atom_hash"])
            all_results.append(r)

    all_results.sort(key=lambda x: (x["usage_count"] + x["combo_count"]), reverse=True)

    return {
        "ok": True,
        "keywords": keywords,
        "atoms": all_results[:req.limit],
        "total_matched": len(all_results)
    }


@router.post("/fill/assemble")
def fill_assemble(req: AssembleFillReq):
    """
    统一组装填充: 角色 + 场景 + 镜头 → 全维度原子注入

    这是最常用的端点，前端一键调用即可获取所有维度的推荐原子。

    返回结构:
      {
        "character_atoms": [...],
        "scene_atoms": [...],
        "camera_atoms": [...],
        "merged_suggestions": [...]  -- 去重后的全量推荐
      }
    """
    db = get_db()
    result = {
        "ok": True,
        "media_category": req.media_category,
        "density": req.density,
        "character_atoms": [],
        "scene_atoms": [],
        "camera_atoms": [],
        "merged_atoms": []
    }

    all_keywords = []
    seen_hashes = set()

    # ① 角色域
    if req.character_id:
        char = safe_fetch_one(
            "SELECT id, name, appearance, personality, occupation FROM character_profiles WHERE id=?",
            [req.character_id]
        )
        if char:
            appearance = (char["appearance"] or "").strip()
            personality = (char["personality"] or "").strip()
            occupation = (char["occupation"] or "").strip()
            kw = _extract_keywords(f"{appearance} {personality} {occupation}")
            all_keywords.extend(kw)

            atoms = _query_atoms(
                db, linked_type="character", keywords=kw,
                media_category=req.media_category, limit=req.limit_per_domain
            )
            result["character_atoms"] = atoms
            for a in atoms:
                if a["atom_hash"] not in seen_hashes:
                    seen_hashes.add(a["atom_hash"])
                    result["merged_atoms"].append(a)

    # ② 场景域
    if req.scene_id:
        scene = safe_fetch_one(
            "SELECT id, name, settings_json FROM scene_profiles WHERE id=?",
            [req.scene_id]
        )
        if scene:
            try:
                settings = json.loads(scene["settings_json"] or "{}")
            except:
                settings = {}
            kw = _extract_keywords(json.dumps(settings, ensure_ascii=False))
            all_keywords.extend(kw)

            atoms = _query_atoms(
                db, linked_type="scene", keywords=kw,
                media_category=req.media_category, limit=req.limit_per_domain
            )
            result["scene_atoms"] = atoms
            for a in atoms:
                if a["atom_hash"] not in seen_hashes:
                    seen_hashes.add(a["atom_hash"])
                    result["merged_atoms"].append(a)

    # ③ 镜头域
    if req.camera_fields:
        cf = req.camera_fields
        cf_kw = _extract_keywords(json.dumps(cf, ensure_ascii=False))
        all_keywords.extend(cf_kw)

        atoms = _query_atoms(
            db, linked_type="camera", keywords=cf_kw,
            media_category=req.media_category, limit=req.limit_per_domain
        )
        result["camera_atoms"] = atoms
        for a in atoms:
            if a["atom_hash"] not in seen_hashes:
                seen_hashes.add(a["atom_hash"])
                result["merged_atoms"].append(a)

    # ④ 通用域补充（用所有关键词）
    if all_keywords:
        general = _query_atoms(
            db, linked_type="general", keywords=all_keywords,
            media_category=req.media_category, limit=req.limit_per_domain
        )
        result["general_atoms"] = general
        for a in general:
            if a["atom_hash"] not in seen_hashes:
                seen_hashes.add(a["atom_hash"])
                result["merged_atoms"].append(a)

    # 按热度排序
    result["merged_atoms"].sort(
        key=lambda x: (x["usage_count"] + x["combo_count"]), reverse=True
    )

    result["total_atoms"] = len(result["merged_atoms"])
    result["keywords"] = all_keywords[:20]

    return result


@router.get("/fill/query")
def query_atoms(
    q: str = Query(..., description="搜索关键词"),
    media_category: str = Query("image"),
    linked_type: str = Query(None),
    atom_type: str = Query(None),
    limit: int = Query(20, ge=1, le=100)
):
    """
    通用原子查询接口 — 前端搜索框 / 选取器调用
    """
    db = get_db()
    keywords = _extract_keywords(q)

    atom_types = [atom_type] if atom_type else None

    atoms = _query_atoms(
        db, linked_type=linked_type, keywords=keywords,
        media_category=media_category, atom_types=atom_types,
        limit=limit
    )

    return {
        "ok": True,
        "query": q,
        "keywords": keywords,
        "atoms": atoms,
        "total": len(atoms)
    }


@router.get("/fill/stats")
def fill_stats():
    """原子资产库概览统计"""
    db = get_db()
    total = db.execute("SELECT COUNT(*) as c FROM atom_asset_library WHERE is_active=1").fetchone()["c"]

    by_media = {}
    for cat in ["image", "video", "both"]:
        by_media[cat] = db.execute(
            "SELECT COUNT(*) as c FROM atom_asset_library WHERE media_category=? AND is_active=1", [cat]
        ).fetchone()["c"]

    by_linked = {}
    for lt in ["character", "scene", "camera", "audio", "general"]:
        by_linked[lt] = db.execute(
            "SELECT COUNT(*) as c FROM atom_asset_library WHERE linked_type=? AND is_active=1", [lt]
        ).fetchone()["c"]

    top_types = db.execute("""
        SELECT atom_type, COUNT(*) as c FROM atom_asset_library
        WHERE is_active=1 GROUP BY atom_type ORDER BY c DESC LIMIT 10
    """).fetchall()

    hot_atoms = db.execute("""
        SELECT atom_text, atom_type, usage_count, combo_count
        FROM atom_asset_library
        WHERE is_active=1
        ORDER BY usage_count DESC LIMIT 10
    """).fetchall()

    return {
        "ok": True,
        "total_atoms": total,
        "by_media": by_media,
        "by_linked": by_linked,
        "top_types": [{"type": r["atom_type"], "count": r["c"]} for r in top_types],
        "hot_atoms": [dict(r) for r in hot_atoms]
    }
