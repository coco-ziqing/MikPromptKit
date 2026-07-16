# -*- coding: utf-8 -*-
"""
PhaseE — 通知中心服务端推送辅助

用法（任意同步端点内）：
    from notify import notify_user
    notify_user(uid, event="asset_approve", title="资产已通过审核",
                body="「scene_final.c4d」已被 admin 批准", category="asset_approve")

实现：复用 ws_collab.push_to_user 线程安全推送；离线用户静默跳过（无落库，
      下次上线自然通过业务列表看到状态变化——保持轻量）。
"""
import time
import uuid


def notify_user(user_id, event="", title="", body="", category="") -> int:
    """向指定用户实时推送一条通知。返回送达连接数（0=离线）。"""
    try:
        from ws_collab import push_to_user
        payload = {
            "id": uuid.uuid4().hex[:12],
            "event": event,
            "title": title,
            "body": body,
            "category": category or event,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        return push_to_user(user_id, {"type": "notification", "payload": payload})
    except Exception:
        return 0


def notify_users(user_ids, **kw) -> int:
    """批量推送，返回总送达连接数。"""
    total = 0
    for uid in set(u for u in user_ids if u):
        total += notify_user(uid, **kw)
    return total
