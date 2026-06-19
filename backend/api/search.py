"""
v4.0.0-phase12.5: 语义搜索 API 升级
- 新增混合搜索端点: FTS5 + embedding + LLM Rerank
- 保留原有语义搜索端点（兼容）
"""
from fastapi import APIRouter
from pydantic import BaseModel
from database import get_db
from semantic import search, rebuild_all_embeddings, get_status, update_embedding
import threading

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
    混合搜索: FTS5 关键词 + 语义向量 + LLM 语义重排
    三阶段渐进搜索，结果精准度大幅提升
    """
    from llm_rerank import hybrid_search as hs
    return await hs(data.query, top_k=data.top_k, use_rerank=data.use_rerank)


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
