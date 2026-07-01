"""
v4.3.0-phase16: Log API — 日志查询/实时流/清除/统计 + Phase17 用户行为追踪
"""
from fastapi import APIRouter, Query, Request, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from logger import query, stats, clear_before, stream_generator
from action_logger import record_action, query_actions, action_stream_generator

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
    session_id: str = ""
    breadcrumbs: list = []


@router.post("/report")
def report_frontend_error(data: FrontendError):
    """前端错误上报"""
    from logger import error
    from breadcrumb_logger import record_breadcrumb, flush_breadcrumbs
    detail_parts = [f"{data.url}:{data.line}:{data.col}"]
    # 记录面包屑
    sid = data.session_id or ""
    if data.breadcrumbs:
        for c in data.breadcrumbs:
            record_breadcrumb(sid, c.get("event", ""), c.get("data", ""))
        flush_breadcrumbs(sid)
        detail_parts.append(f"面包屑: {len(data.breadcrumbs)} 条")
    error(
        data.message,
        source="frontend",
        detail=" | ".join(detail_parts),
        stack=data.stack,
        path=data.url
    )
    return {"ok": True}


@router.post("/breadcrumbs")
async def report_breadcrumbs(request: Request):
    """前端上报面包屑（错误上下文）— 兼容 sendBeacon text/plain"""
    from breadcrumb_logger import record_breadcrumb, flush_breadcrumbs
    try:
        # sendBeacon 发 text/plain，手动解析 JSON
        raw = await request.body()
        data = json.loads(raw.decode("utf-8", errors="replace"))
        sid = data.get("session_id", "")
        crumbs = data.get("crumbs", [])
        for c in crumbs:
            record_breadcrumb(sid, c.get("event", ""), c.get("data", ""))
        flush_breadcrumbs(sid)
    except Exception as e:
        pass  # sendBeacon 不可重试，静默丢弃
    return {"ok": True}


@router.get("/breadcrumbs")
def get_breadcrumbs(session_id: str = Query(...)):
    """查询指定 session 的面包屑"""
    from breadcrumb_logger import get_breadcrumbs
    items = get_breadcrumbs(session_id, limit=100)
    return {"ok": True, "items": items, "total": len(items)}


# ============================
# Phase17: 用户行为追踪 API
# ============================

class ActionEntry(BaseModel):
    action: str = ""
    category: str = "click"
    target: str = ""
    detail: str = ""
    url: str = ""
    user_agent: str = ""


class BatchActions(BaseModel):
    actions: list = []


@router.post("/actions")
async def report_batch_actions(batch: BatchActions, request: Request):
    """批量接收前端用户行为"""
    client_ip = request.client.host if request.client else ""
    count = 0
    for item in batch.actions:
        if isinstance(item, dict):
            record_action(
                action=item.get("action", ""),
                category=item.get("category", "click"),
                target=item.get("target", ""),
                detail=item.get("detail", ""),
                url=item.get("url", ""),
                user_agent=item.get("user_agent", ""),
                client_ip=client_ip,
            )
            count += 1
    return {"ok": True, "count": count}


@router.post("/action")
async def report_single_action(data: ActionEntry, request: Request):
    """单条用户行为上报"""
    client_ip = request.client.host if request.client else ""
    record_action(
        action=data.action,
        category=data.category,
        target=data.target,
        detail=data.detail,
        url=data.url,
        user_agent=data.user_agent,
        client_ip=client_ip,
    )
    return {"ok": True}


@router.get("/actions")
def query_user_actions(
    category: str = Query(None),
    action: str = Query(None),
    search: str = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0)
):
    """查询用户操作记录"""
    items, total = query_actions(category=category, action=action, search=search, limit=limit, offset=offset)
    return {"ok": True, "items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/actions/stream")
async def stream_actions():
    """SSE 实时用户操作流"""
    return StreamingResponse(action_stream_generator(), media_type="text/event-stream")
