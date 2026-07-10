"""
WebSocket 协作端点 — Phase18 预埋
Phase21 团队版: 实现实时协作同步（CRDT + WebSocket推送）

端点:
  ws://host:8080/ws/collab/{project_id}
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jwt_auth import verify_jwt, get_current_user

router = APIRouter()

# 活跃连接池（Phase21 使用 Redis 或内存 dict）
_active_connections: dict = {}  # {project_id: {user_id: WebSocket}}


@router.websocket("/ws/collab/{project_id}")
async def websocket_collab(websocket: WebSocket, project_id: str):
    """
    项目协作 WebSocket（Phase21 实现）。
    当前返回 NOT_IMPLEMENTED 消息后关闭连接。
    """
    await websocket.accept()
    
    # Phase18: 提示功能未实现
    await websocket.send_json({
        "type": "system",
        "status": "not_implemented",
        "message": "团队协作功能将在 Phase21 团队版中实现。当前为预埋端点。",
        "project_id": project_id,
        "phase": 18,
    })
    
    # 保持连接几秒后关闭
    await websocket.close(code=1000, reason="phase18_preview")


@router.websocket("/ws/notifications/{user_id}")
async def websocket_notifications(websocket: WebSocket, user_id: str):
    """
    通知推送 WebSocket（Phase21 实现）。
    """
    await websocket.accept()
    
    await websocket.send_json({
        "type": "system",
        "status": "not_implemented",
        "message": "通知推送功能将在后续版本中实现。",
    })
    
    await websocket.close(code=1000, reason="phase18_preview")


# Phase21 完整实现框架:
#
# @router.websocket("/ws/collab/{project_id}")
# async def websocket_collab_real(websocket: WebSocket, project_id: str):
#     token = websocket.query_params.get("token", "")
#     user = verify_jwt(token)
#     if not user:
#         await websocket.close(code=4001, reason="unauthorized")
#         return
#     
#     await websocket.accept()
#     
#     # 加入房间
#     if project_id not in _active_connections:
#         _active_connections[project_id] = {}
#     _active_connections[project_id][user["user_id"]] = websocket
#     
#     # 广播加入事件
#     await _broadcast(project_id, {
#         "type": "user_joined",
#         "user": user["username"],
#         "timestamp": time.time(),
#     })
#     
#     try:
#         while True:
#             data = await websocket.receive_json()
#             # 处理 CRDT 操作
#             # data: {type, target_table, target_id, operation, vector_clock, changes}
#             
#             # 冲突检测 & 合并
#             # merged = _apply_crdt_op(data)
#             
#             # 广播给房间内其他用户
#             await _broadcast(project_id, data, exclude=user["user_id"])
#             
#     except WebSocketDisconnect:
#         _active_connections[project_id].pop(user["user_id"], None)
#         await _broadcast(project_id, {
#             "type": "user_left",
#             "user": user["username"],
#         })
