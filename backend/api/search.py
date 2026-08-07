"""
v4.0.0-phase12.5: 语义搜索 API 升级
- 混合搜索端点: FTS5 + embedding + LLM Rerank（支持 word_card）
- 词卡语义搜索独立端点
- 保留原有语义搜索端点（兼容旧 prompts 表）
"""
import json
import threading

from fastapi import APIRouter, Query
from pydantic import BaseModel

from database import get_db
from semantic import (
    get_status,
    rebuild_all_embeddings,
    rebuild_wc_embeddings,
    search,
    search_word_cards,
)

router = APIRouter(prefix="/api/v2/search", tags=["search"])


class SearchQuery(BaseModel):
    query: str
    top_k: int = 20
    use_rerank: bool = False  # 是否启用 LLM 重排


class HybridSearchQuery(BaseModel):
    query: str
    top_k: int = 10
    use_rerank: bool = True


@router.post("/semantic")
def semantic_search(data: SearchQuery):
    """语义搜索（原有）"""
    results = search(data.query, top_k=data.top_k)

    import json
    items = []
    for r in results:
        try:
            tags = json.loads(r["tags"]) if isinstance(r["tags"], str) else (r["tags"] or [])
        except Exception:
            tags = []
        items.append({
            "id": r["id"],
            "content": r["content"],
            "meaning": r["meaning"],
            "module": r["module"],
            "category": r["category"],
            "tags": tags,
            "score": r["score"]
        })

    return {"ok": True, "items": items, "total": len(items)}


@router.post("/hybrid")
async def hybrid_search(data: HybridSearchQuery):
    """
    混合搜索（旧 prompts 表兼容）: FTS5 关键词 + 语义向量 + LLM 语义重排
    """
    from llm_rerank import hybrid_search as hs
    return await hs(data.query, top_k=data.top_k, use_rerank=data.use_rerank)


@router.post("/wc-hybrid")
async def wc_hybrid_search(data: HybridSearchQuery):
    """
    词卡混合搜索: FTS5 + 语义向量 + LLM重排（word_card 数据源）
    三阶段渐进搜索，结果精准度大幅提升
    """
    from llm_rerank import hybrid_search_word_cards as hs
    return await hs(data.query, top_k=data.top_k, use_rerank=data.use_rerank)


@router.get("/wc-semantic")
def wc_semantic_search(q: str = Query(..., description="搜索关键词"),
                       top_k: int = Query(20, ge=1, le=50),
                       group_id: int = Query(None, description="限定分组ID，包含子孙分组")):
    """词卡语义搜索（余弦相似度 + 热度加权 + 缓存优化）"""
    results = search_word_cards(q, top_k=top_k, group_id=group_id)
    items = []
    for r in results:
        try:
            tags = json.loads(r["tags"]) if isinstance(r["tags"], str) else (r["tags"] or [])
        except Exception:
            tags = []
        items.append({
            "id": r["id"],
            "name": r["name"],
            "content": r["content"],
            "meaning": r["meaning"],
            "module": r["module"],
            "category": r["category"],
            "tags": tags,
            "thumbnail": r.get("thumbnail"),
            "icon": r.get("icon"),
            "usage_count": r.get("usage_count", 0),
            "group_name": r.get("group_name", ""),
            "score": r["score"]
        })
    return {"ok": True, "items": items, "total": len(items)}


@router.get("/status")
def search_status():
    return get_status()


@router.post("/rebuild")
def rebuild_index():
    def _rebuild():
        rebuild_all_embeddings()
    t = threading.Thread(target=_rebuild, daemon=True)
    t.start()
    return {"ok": True, "message": "索引重建已启动"}


@router.post("/rebuild-wc")
def rebuild_wc_index():
    """重建所有词卡语义向量索引"""
    def _rebuild():
        rebuild_wc_embeddings()
    t = threading.Thread(target=_rebuild, daemon=True)
    t.start()
    return {"ok": True, "message": "词卡语义索引重建已启动"}


# ==================== Phase13.4: 高级搜索 ====================

@router.post("/advanced")
def advanced_search(data: dict):
    """高级组合搜索: AND/OR/NOT + 字段限定 + 模块/缩略图/日期筛选"""
    query = data.get("query", "").strip()
    mode = data.get("mode", "and")
    field = data.get("field", "all")
    module = data.get("module", "")
    has_thumbnail = data.get("has_thumbnail", "any")
    exclude = data.get("exclude", [])
    date_from = data.get("date_from", "")

    db = get_db()
    where = ["wc.is_deleted=0"]
    params = []

    if query:
        kw = query.split()
        if mode == "and":
            for k in kw:
                if len(k) < 2: continue
                like = f"%{k}%"
                if field == "all":
                    where.append("(wc.content LIKE ? OR wc.meaning LIKE ? OR wc.tags LIKE ?)")
                    params.extend([like, like, like])
                elif field == "content":
                    where.append("wc.content LIKE ?")
                    params.append(like)
                elif field == "meaning":
                    where.append("wc.meaning LIKE ?")
                    params.append(like)
                elif field == "tags":
                    where.append("wc.tags LIKE ?")
                    params.append(like)
        elif mode == "or":
            clauses = []
            for k in kw:
                if len(k) < 2: continue
                like = f"%{k}%"
                if field == "all":
                    clauses.append("(wc.content LIKE ? OR wc.meaning LIKE ? OR wc.tags LIKE ?)")
                    params.extend([like, like, like])
                elif field == "content":
                    clauses.append("wc.content LIKE ?")
                    params.append(like)
                elif field == "meaning":
                    clauses.append("wc.meaning LIKE ?")
                    params.append(like)
                elif field == "tags":
                    clauses.append("wc.tags LIKE ?")
                    params.append(like)
            if clauses:
                where.append(f"({' OR '.join(clauses)})")

    if exclude:
        ph = ",".join("?" * len(exclude))
        where.append(f"wc.id NOT IN ({ph})")
        params.extend(exclude)

    if module:
        where.append("wc.module=?")
        params.append(module)

    if has_thumbnail == "yes":
        where.append("(wc.thumbnail IS NOT NULL AND wc.thumbnail != '')")
    elif has_thumbnail == "no":
        where.append("(wc.thumbnail IS NULL OR wc.thumbnail = '')")

    if date_from:
        where.append("wc.created_at >= ?")
        params.append(date_from)

    w = " AND ".join(where)
    try:
        total = db.execute(f"SELECT COUNT(*) as c FROM word_card wc WHERE {w}", params).fetchone()["c"]
        rows = db.execute(f"SELECT wc.*,wg.name as group_name FROM word_card wc LEFT JOIN word_card_group wg ON wg.id=wc.group_id WHERE {w} ORDER BY wc.usage_count DESC LIMIT 100", params).fetchall()
        items = []
        for r in rows:
            it = dict(r)
            try: it["tags"] = json.loads(it["tags"]) if isinstance(it["tags"], str) else (it["tags"] or [])
            except: it["tags"] = []
            items.append(it)
        return {"ok": True, "items": items, "total": total}
    except Exception as e:
        return {"ok": False, "error": str(e), "items": [], "total": 0}
