"""
语义搜索 API
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


@router.post("/semantic")
def semantic_search(data: SearchQuery):
    """语义搜索"""
    results = search(data.query, top_k=data.top_k)

    # 标准化返回格式
    items = []
    for r in results:
        import json
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


@router.get("/status")
def search_status():
    """语义搜索状态"""
    return get_status()


@router.post("/rebuild")
def rebuild_index():
    """重建向量索引（异步）"""
    def _rebuild():
        rebuild_all_embeddings()
    t = threading.Thread(target=_rebuild, daemon=True)
    t.start()
    return {"ok": True, "message": "索引重建已启动"}
