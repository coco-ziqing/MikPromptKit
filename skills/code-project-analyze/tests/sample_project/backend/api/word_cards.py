# backend/api/word_cards.py —— 词卡后端 API（样例源码 / FastAPI）
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v4/word-cards", tags=["word_cards"])


class WordCardIn(BaseModel):
    title: str
    content: str
    group_id: int | None = None


@router.get("/groups/tree")
async def get_group_tree():
    """返回分组树形结构"""
    return {"roots": []}


@router.post("")
async def create_card(payload: WordCardIn):
    """创建词卡"""
    return {"id": 1, **payload.model_dump()}


@router.put("/{card_id}")
async def update_card(card_id: int, payload: WordCardIn):
    """更新词卡"""
    if card_id <= 0:
        raise HTTPException(status_code=404, detail="not found")
    return {"id": card_id, **payload.model_dump()}


@router.post("/search")
async def search_cards(body: dict):
    """语义搜索词卡"""
    return {"results": [], "query": body.get("q", "")}
