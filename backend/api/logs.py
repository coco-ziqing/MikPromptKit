"""
v4.3.0-phase16: Log API — 日志查询/实时流/清除/统计
"""
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from logger import query, stats, clear_before, stream_generator

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/query")
def query_logs(
    level: str = Query(None, description="debug/info/warn/error/fatal"),
    source: str = Query(None, description="日志来源: system/api/frontend"),
    search: str = Query(None, description="关键词搜索"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    order: str = Query("desc", regex="^(asc|desc)$")
):
    """查询日志"""
    items, total = query(level=level, source=source, search=search, limit=limit, offset=offset, order=order)
    return {"ok": True, "items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/stream")
async def stream_logs():
    """SSE 实时日志流"""
    return StreamingResponse(stream_generator(), media_type="text/event-stream")


@router.get("/stats")
def log_stats():
    """日志统计"""
    return {"ok": True, "stats": stats()}


@router.post("/clear")
def clear_logs(days: int = Query(7, ge=1, le=365)):
    """清理旧日志"""
    count = clear_before(days)
    return {"ok": True, "deleted": count, "message": f"清理了 {count} 条 {days} 天前的日志"}


class FrontendError(BaseModel):
    """前端上报错误"""
    message: str
    source: str = "frontend"
    stack: str = ""
    url: str = ""
    line: int = 0
    col: int = 0


@router.post("/report")
def report_frontend_error(data: FrontendError):
    """前端错误上报"""
    from logger import error
    detail = f"{data.url}:{data.line}:{data.col}"
    error(
        data.message,
        source="frontend",
        detail=detail,
        stack=data.stack,
        path=data.url
    )
    return {"ok": True}
