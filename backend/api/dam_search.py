# -*- coding: utf-8 -*-
"""
DAM 统一搜索 & 检索增强 API
- 跨项目/跨设备/跨文件类型的统一搜索
- AI 标签管理
- 感知哈希相似搜索
- 智能合集 CRUD
"""
import os, sys, json, time, sqlite3
from fastapi import APIRouter, Request, HTTPException, Query, Body
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
try:
    from paths import get_db_path
    DB = get_db_path()
except Exception:
    DB = os.path.join(ROOT, "data", "prompts.db")
sys.path.insert(0, os.path.join(HERE, ".."))

from ai_tagger import analyze_file, batch_tag_unlabeled, enqueue_tag_analysis
from sim_search import (
    compute_phash, find_duplicates, find_exact_duplicate,
    create_smart_collection, get_smart_collections, execute_smart_collection,
    delete_smart_collection, ensure_smart_collection_table
)

router = APIRouter(prefix="/api/search", tags=["DAM检索增强"])

def _rw():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c

def _ro():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA query_only=ON")
    return c

def _safe_commit(c):
    for i in range(5):
        try: c.commit(); return
        except sqlite3.OperationalError:
            if i == 4: raise
            time.sleep(0.05*(i+1))

def _get_user(request: Request):
    try:
        from jwt_auth import get_current_user
        u = get_current_user(request)
        if u and u.get("authenticated"): return u
    except Exception: pass
    return None


# ════════════════════════════════════════
# 1. 统一搜索 — 关键字搜全部
# ════════════════════════════════════════

@router.get("/unified")
def unified_search(request: Request,
                   q: str = Query("", min_length=0),
                   file_type: str = Query(None),    # image/video/audio/3d/document/other
                   project_id: int = Query(None),
                   device_id: int = Query(None),
                   tag: str = Query(None),
                   is_critical: int = Query(None),
                   days: int = Query(None),
                   limit: int = Query(50, le=200),
                   offset: int = Query(0)):
    """
    统一搜索 - 跨资产库/设备索引/标签
    """
    user = _get_user(request)
    if not user: raise HTTPException(403, "请先登录")

    c = _ro()
    try:
        where, params = [], []

        # 权限过滤
        if user.get("role") != "admin":
            where.append("""(ac.project_space_id IN (
                SELECT ps.id FROM project_space ps
                LEFT JOIN project_space_member psm ON ps.id=psm.project_space_id AND psm.user_id=?
                WHERE ps.visibility='shared' OR ps.owner_user_id=? OR psm.user_id IS NOT NULL
            ))""")
            params += [user["id"], user["id"]]

        where.append("ac.status='active'")

        # 关键词搜索（文件名 + 标签 + 元数据）
        if q:
            where.append("""(ac.filename LIKE ? OR ac.metadata_json LIKE ?
                          OR ac.id IN (SELECT asset_id FROM asset_tags WHERE tag LIKE ?))""")
            params += [f"%{q}%", f"%{q}%", f"%{q}%"]

        # 文件类型筛选
        if file_type:
            _map = {
                "image": "('.png','.jpg','.jpeg','.webp','.bmp','.tiff','.exr','.psd','.ai')",
                "video": "('.mp4','.mov','.avi','.mkv')",
                "audio": "('.wav','.mp3','.aiff','.flac','.ogg')",
                "3d": "('.c4d','.blend','.max','.fbx','.obj','.gltf')",
                "document": "('.pdf','.docx','.txt')",
                "project": "('.ae','.prproj')",
            }
            ext_list = _map.get(file_type, f"('{file_type}')")
            where.append(f"ac.ext IN {ext_list}")

        if project_id:
            where.append("ac.project_space_id=?"); params.append(project_id)
        if device_id is not None and device_id > 0:
            where.append("ac.source_device_id=?"); params.append(device_id)
        if is_critical is not None:
            where.append("ac.is_critical=?"); params.append(is_critical)
        if tag:
            where.append("ac.id IN (SELECT asset_id FROM asset_tags WHERE tag=?)")
            params.append(tag)
        if days:
            where.append("ac.created_at >= datetime('now','localtime','-'||?||' days')")
            params.append(days)

        w = "WHERE " + " AND ".join(where)

        total = c.execute(f"SELECT COUNT(1) n FROM asset_catalog ac {w}", params).fetchone()["n"]
        rows = c.execute(f"""
            SELECT ac.id, ac.filename, ac.ext, ac.compressed_size, ac.original_size,
                   ac.module_key, ac.project_space_id, ps.name project_name,
                   ac.proxy_path, ac.proxy_type, ac.is_critical, ac.frozen,
                   ac.blob_hash, ac.compression, ac.created_at, ac.metadata_json
            FROM asset_catalog ac
            LEFT JOIN project_space ps ON ac.project_space_id = ps.id
            {w}
            ORDER BY ac.created_at DESC
            LIMIT ? OFFSET ?
        """, params + [limit, offset]).fetchall()

        items = []
        for r in rows:
            d = dict(r)
            # 解析 tags
            tags = []
            meta = {}
            try:
                if d.get("metadata_json"):
                    meta = json.loads(d["metadata_json"])
                    tags = meta.get("ai_tags", [])
            except Exception:
                pass
            d["tags"] = tags
            d["saved_pct"] = round((1 - (d.get("compressed_size",0) or 0)/max(d.get("original_size",1) or 1, 1)) * 100, 1)
            # 去元数据json避免太大
            del d["metadata_json"]
            items.append(d)

        # 也搜设备索引
        device_results = []
        if q:
            di = c.execute("""
                SELECT dfi.id, dfi.filename, dfi.ext, dfi.size, dfi.state,
                       dfi.rel_path, dfi.device_id, d.name device_name
                FROM device_file_index dfi
                JOIN device d ON d.id = dfi.device_id
                WHERE (dfi.filename LIKE ? OR dfi.rel_path LIKE ?)
                  AND dfi.state != 'missing'
                ORDER BY dfi.last_seen_at DESC LIMIT 20
            """, [f"%{q}%", f"%{q}%"]).fetchall()
            device_results = [dict(r) for r in di]

        return {"ok": True, "items": items, "device_results": device_results,
                "total": total, "limit": limit, "offset": offset}
    finally:
        c.close()


# ════════════════════════════════════════
# 2. 标签管理
# ════════════════════════════════════════

@router.get("/tags")
def list_tags(request: Request, limit: int = Query(50, le=100)):
    """列出所有标签及使用次数"""
    c = _ro()
    try:
        rows = c.execute("""
            SELECT tag, COUNT(1) cnt
            FROM asset_tags
            GROUP BY tag
            ORDER BY cnt DESC, tag
            LIMIT ?
        """, [limit]).fetchall()
        return {"ok": True, "tags": [{"name": r["tag"], "count": r["cnt"]} for r in rows]}
    finally:
        c.close()


@router.get("/tags/{tag_name}/assets")
def get_assets_by_tag(tag_name: str, request: Request, limit: int = Query(30)):
    """根据标签名获取资产列表"""
    c = _ro()
    try:
        rows = c.execute("""
            SELECT ac.id, ac.filename, ac.ext, ac.module_key,
                   ac.proxy_path, ac.is_critical, ac.frozen,
                   ps.name project_name, ac.created_at
            FROM asset_catalog ac
            JOIN asset_tags at ON ac.id = at.asset_id
            LEFT JOIN project_space ps ON ac.project_space_id = ps.id
            WHERE at.tag = ? AND ac.status = 'active'
            ORDER BY ac.created_at DESC
            LIMIT ?
        """, [tag_name, limit]).fetchall()
        return {"ok": True, "items": [dict(r) for r in rows], "tag": tag_name}
    finally:
        c.close()


@router.post("/tags/analyze")
def trigger_tag_analysis(request: Request, data: dict = Body(...)):
    """
    对指定资产触发 AI 标签分析
    body: {catalog_id} 或 {catalog_ids: [1,2,3]}
    """
    user = _get_user(request)
    if not user: raise HTTPException(403)

    ids = data.get("catalog_ids") or [data.get("catalog_id")]
    if not ids:
        raise HTTPException(400, "catalog_ids 必填")

    c = _rw()
    try:
        count = 0
        for cid in ids:
            ac = c.execute("SELECT id, filename, ext, proxy_path, archive_path FROM asset_catalog WHERE id=?",
                           [cid]).fetchone()
            if not ac: continue
            # 用缩略图做分析（有 proxy 优先 proxy）
            img_path = ""
            if ac["proxy_path"]:
                img_path = os.path.join(ROOT, "data", "archive", "proxy",
                                        os.path.basename(ac["proxy_path"]))
            if not img_path or not os.path.exists(img_path):
                # 回退到 archive path
                img_path = ac["archive_path"] or ""
            if img_path and os.path.exists(img_path):
                enqueue_tag_analysis(cid, img_path, ac["ext"] or "")
                count += 1
        _safe_commit(c)
        return {"ok": True, "queued": count}
    finally:
        c.close()


@router.post("/tags/batch-analyze")
def batch_analyze(request: Request, data: dict = Body(...)):
    """批量分析无标签资产 body: {limit: 20}"""
    user = _get_user(request)
    if not user: raise HTTPException(403)
    if user.get("role") != "admin": raise HTTPException(403, "仅管理员")

    limit_val = data.get("limit", 20)
    count = batch_tag_unlabeled(limit_val)
    return {"ok": True, "queued": count, "message": f"已加入 {count} 个待分析任务"}


@router.delete("/tags/{catalog_id}/{tag_name}")
def delete_asset_tag(catalog_id: int, tag_name: str, request: Request):
    c = _rw()
    try:
        c.execute("DELETE FROM asset_tags WHERE asset_id=? AND tag=?", [catalog_id, tag_name])
        _safe_commit(c)
        return {"ok": True}
    finally:
        c.close()


# ════════════════════════════════════════
# 3. 相似搜索
# ════════════════════════════════════════

@router.post("/similar")
def find_similar_assets(request: Request, data: dict = Body(...)):
    """
    查找相似资产
    body: {catalog_id} 或 {phash}
    """
    user = _get_user(request)
    if not user: raise HTTPException(403)

    threshold = data.get("threshold", 5)
    phash_val = data.get("phash", "")

    # 从 catalog_id 获取 phash
    if not phash_val and data.get("catalog_id"):
        c = _ro()
        try:
            ac = c.execute("SELECT perceptual_hash, proxy_path FROM asset_catalog WHERE id=?",
                           [data["catalog_id"]]).fetchone()
            if ac:
                phash_val = ac["perceptual_hash"] or ""
                # 如果没计算过，现在计算
                if not phash_val and ac["proxy_path"]:
                    proxy_full = os.path.join(ROOT, "data", "archive", "proxy",
                                              os.path.basename(ac["proxy_path"]))
                    if os.path.exists(proxy_full):
                        phash_val = compute_phash(proxy_full)
                        if phash_val:
                            # 回写
                            c2 = _rw()
                            try:
                                c2.execute("UPDATE asset_catalog SET perceptual_hash=? WHERE id=?",
                                           [phash_val, data["catalog_id"]])
                                _safe_commit(c2)
                            finally: c2.close()
            if not phash_val:
                return {"ok": False, "error": "未能计算感知哈希", "similar": []}
        finally:
            c.close()

    if not phash_val:
        return {"ok": False, "error": "缺少 phash", "similar": []}

    results = find_duplicates(phash_val, threshold)
    return {"ok": True, "phash": phash_val, "similar": results, "threshold": threshold}


@router.post("/similar/compute-phash")
def compute_phash_for_asset(request: Request, data: dict = Body(...)):
    """为指定资产计算并存储感知哈希"""
    user = _get_user(request)
    if not user: raise HTTPException(403)

    cid = data.get("catalog_id")
    if not cid: raise HTTPException(400)

    c = _rw()
    try:
        ac = c.execute("SELECT proxy_path FROM asset_catalog WHERE id=?", [cid]).fetchone()
        if not ac: raise HTTPException(404)

        phash_val = ""
        if ac["proxy_path"]:
            full = os.path.join(ROOT, "data", "archive", "proxy",
                                os.path.basename(ac["proxy_path"]))
            if os.path.exists(full):
                phash_val = compute_phash(full)

        if phash_val:
            c.execute("UPDATE asset_catalog SET perceptual_hash=? WHERE id=?", [phash_val, cid])
            _safe_commit(c)
            return {"ok": True, "phash": phash_val}
        return {"ok": False, "error": "无法计算感知哈希（无代理文件或图片）"}
    finally:
        c.close()


# ════════════════════════════════════════
# 4. 智能合集
# ════════════════════════════════════════

@router.get("/collections")
def list_collections(request: Request):
    user = _get_user(request)
    if not user: raise HTTPException(403)
    # 确保表存在
    try: ensure_smart_collection_table()
    except Exception: pass
    return {"ok": True, "collections": get_smart_collections(user["id"])}


@router.post("/collections")
def create_collection(request: Request, data: dict = Body(...)):
    """创建智能合集"""
    user = _get_user(request)
    if not user: raise HTTPException(403)

    name = data.get("name", "").strip()
    conditions = data.get("conditions", {})
    if not name: raise HTTPException(400, "name 必填")

    try: ensure_smart_collection_table()
    except Exception: pass
    cid = create_smart_collection(name, conditions, user["id"])
    return {"ok": True, "id": cid, "name": name}


@router.get("/collections/{cid}/results")
def get_collection_results(cid: int, request: Request):
    """获取智能合集的查询结果"""
    user = _get_user(request)
    if not user: raise HTTPException(403)
    results = execute_smart_collection(cid)
    return {"ok": True, "collection_id": cid, "items": results, "count": len(results)}


@router.delete("/collections/{cid}")
def remove_collection(cid: int, request: Request):
    user = _get_user(request)
    if not user: raise HTTPException(403)
    delete_smart_collection(cid)
    return {"ok": True}


# ════════════════════════════════════════
# 5. 自动建议（内置智能合集）
# ════════════════════════════════════════

@router.get("/suggestions")
def get_suggestions(request: Request):
    """系统预置的智能合集"""
    user = _get_user(request)
    if not user: raise HTTPException(403)

    suggestions = [
        {"key": "recent_week", "label": "📅 最近7天存入", "conditions": {"days": 7}},
        {"key": "recent_30d", "label": "📅 最近30天", "conditions": {"days": 30}},
        {"key": "critical", "label": "⭐ 重要资产", "conditions": {"is_critical": 1}},
        {"key": "images", "label": "🖼 所有图片", "conditions": {"ext": ".png"}},  # 会被统一搜索多类型覆盖
        {"key": "videos", "label": "🎬 视频文件", "conditions": {"search": ".mp4"}},
        {"key": "3d_models", "label": "🎨 3D模型", "conditions": {"search": ".c4d"}},
        {"key": "no_tags", "label": "🏷 未标记资产", "conditions": {"tag": "__NONE__"}},
        {"key": "frozen", "label": "📦 已归档冻结", "conditions": {"is_critical": -1}},  # 实际用 frozen字段
    ]
    return {"ok": True, "suggestions": suggestions}
