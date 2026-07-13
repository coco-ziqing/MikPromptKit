# -*- coding: utf-8 -*-
"""
Phase25 Track B P3 — 协作模块 API: 评论 / 通知 / 活动流
挂载前缀: /api/plugins/com.promptkit.project/

表: comments / notification_queue / activity_feed  (Phase18 已建)
当前用户: 由前端 auth_client 全局 patch 的 fetch 注入 Bearer -> JWT 中间件 -> request.state.user_id
"""
import json, os, sqlite3, time
from fastapi import APIRouter, HTTPException, Body, Request, Query
from typing import Optional

router = APIRouter(tags=["协作-通知-活动流"])

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "prompts.db")


def _rw():
    conn = sqlite3.connect(DB, timeout=3)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    return conn


def _rows(rs):
    return [dict(r) for r in rs]


def _safe_commit(db, n=15):
    for i in range(n):
        try:
            db.commit(); return
        except sqlite3.OperationalError:
            if i == n - 1: raise
            time.sleep(0.05 * (i + 1))


def _uid(request: Request) -> int:
    if request is not None and hasattr(request.state, "user_id"):
        try:
            return int(request.state.user_id)
        except Exception:
            return 1
    return 1


def _uname(db, uid: int) -> str:
    r = db.execute("SELECT COALESCE(display_name,username) v FROM users WHERE id=?", [uid]).fetchone()
    return r["v"] if r and r["v"] else ("用户%d" % uid)


# ============================================================
# 内部助手：活动流 + 通知
# ============================================================

def _log_activity(db, user_id, action, target_type=None, target_id=None, target_name=None, detail=None, project_id=None):
    try:
        db.execute(
            """INSERT INTO activity_feed (user_id, action, target_type, target_id, target_name, detail_json, project_id, created_at)
               VALUES (?,?,?,?,?,?,?,datetime('now','localtime'))""",
            [user_id, action, target_type, target_id, target_name,
             json.dumps(detail or {}, ensure_ascii=False), project_id])
    except Exception as e:
        print("[collab] log_activity err:", e)


def _notify(db, user_id, ntype, title, body="", target_url=""):
    if not user_id:
        return
    try:
        db.execute(
            """INSERT INTO notification_queue (user_id, type, title, body, target_url, is_read, created_at)
               VALUES (?,?,?,?,?,0,datetime('now','localtime'))""",
            [user_id, ntype, title, body, target_url])
    except Exception as e:
        print("[collab] notify err:", e)


# ============================================================
# 评论 (target_type: task / milestone / asset / sub_project / master)
# ============================================================

@router.get("/comments")
def list_comments(target_type: str = Query(...), target_id: int = Query(...)):
    db = _rw()
    try:
        rows = _rows(db.execute(
            """SELECT c.*, COALESCE(u.display_name,u.username) as user_name, u.avatar_color
               FROM comments c LEFT JOIN users u ON u.id=c.user_id
               WHERE c.target_type=? AND c.target_id=? AND COALESCE(c.is_deleted,0)=0
               ORDER BY c.created_at ASC""", [target_type, target_id]).fetchall())
        return {"ok": True, "comments": rows, "count": len(rows)}
    finally:
        db.close()


@router.post("/comments")
def add_comment(data: dict = Body(...), request: Request = None):
    uid = _uid(request)
    tt = (data.get("target_type") or "").strip()
    tid = data.get("target_id")
    content = (data.get("content") or "").strip()
    parent_id = data.get("parent_id")
    if not tt or tid is None or not content:
        raise HTTPException(400, "target_type / target_id / content 必填")
    db = _rw()
    try:
        cur = db.execute(
            """INSERT INTO comments (target_type, target_id, user_id, parent_id, content, created_at)
               VALUES (?,?,?,?,?,datetime('now','localtime'))""",
            [tt, int(tid), uid, parent_id, content])
        cid = cur.lastrowid

        # 活动流
        tname = ""
        master_pid = None
        if tt == "task":
            row = db.execute("SELECT title, assignee_id, master_project_id FROM project_tasks WHERE id=?", [int(tid)]).fetchone()
            if row:
                tname = row["title"] or ""
                master_pid = row["master_project_id"]
                # 通知被指派人（若非评论者本人）
                if row["assignee_id"]:
                    m = db.execute("SELECT user_id FROM project_members WHERE id=?", [row["assignee_id"]]).fetchone()
                    if m and m["user_id"] and m["user_id"] != uid:
                        _notify(db, m["user_id"], "comment",
                                "%s 评论了任务「%s」" % (_uname(db, uid), tname),
                                content[:80], "")
        _log_activity(db, uid, "comment", tt, int(tid), tname,
                      {"excerpt": content[:60]}, master_pid)
        _safe_commit(db)
        out = dict(db.execute(
            "SELECT c.*, COALESCE(u.display_name,u.username) as user_name, u.avatar_color FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=?",
            [cid]).fetchone())
        return {"ok": True, "comment": out}
    finally:
        db.close()


@router.delete("/comments/{comment_id}")
def del_comment(comment_id: int, request: Request = None):
    uid = _uid(request)
    db = _rw()
    try:
        row = db.execute("SELECT user_id FROM comments WHERE id=?", [comment_id]).fetchone()
        if not row:
            raise HTTPException(404, "评论不存在")
        urole = db.execute("SELECT role FROM users WHERE id=?", [uid]).fetchone()
        is_admin = urole and urole["role"] == "admin"
        if row["user_id"] != uid and not is_admin:
            raise HTTPException(403, "只能删除自己的评论")
        db.execute("UPDATE comments SET is_deleted=1, updated_at=datetime('now','localtime') WHERE id=?", [comment_id])
        _safe_commit(db)
        return {"ok": True}
    finally:
        db.close()


# ============================================================
# 通知（当前用户）
# ============================================================

@router.get("/notifications")
def list_notifications(unread_only: int = Query(0), limit: int = Query(50), request: Request = None):
    uid = _uid(request)
    db = _rw()
    try:
        where = "user_id=?"
        params = [uid]
        if unread_only:
            where += " AND COALESCE(is_read,0)=0"
        rows = _rows(db.execute(
            "SELECT * FROM notification_queue WHERE %s ORDER BY created_at DESC LIMIT ?" % where,
            params + [limit]).fetchall())
        unread = db.execute("SELECT COUNT(*) c FROM notification_queue WHERE user_id=? AND COALESCE(is_read,0)=0", [uid]).fetchone()["c"]
        return {"ok": True, "notifications": rows, "unread": unread}
    finally:
        db.close()


@router.get("/notifications/unread-count")
def unread_count(request: Request = None):
    uid = _uid(request)
    db = _rw()
    try:
        c = db.execute("SELECT COUNT(*) c FROM notification_queue WHERE user_id=? AND COALESCE(is_read,0)=0", [uid]).fetchone()["c"]
        return {"ok": True, "unread": c}
    finally:
        db.close()


@router.post("/notifications/{nid}/read")
def mark_read(nid: int, request: Request = None):
    uid = _uid(request)
    db = _rw()
    try:
        db.execute("UPDATE notification_queue SET is_read=1, read_at=datetime('now','localtime') WHERE id=? AND user_id=?", [nid, uid])
        _safe_commit(db)
        return {"ok": True}
    finally:
        db.close()


@router.post("/notifications/read-all")
def mark_all_read(request: Request = None):
    uid = _uid(request)
    db = _rw()
    try:
        db.execute("UPDATE notification_queue SET is_read=1, read_at=datetime('now','localtime') WHERE user_id=? AND COALESCE(is_read,0)=0", [uid])
        _safe_commit(db)
        return {"ok": True}
    finally:
        db.close()


# 供其它模块/测试创建通知
@router.post("/notifications/push")
def push_notification(data: dict = Body(...)):
    db = _rw()
    try:
        _notify(db, data.get("user_id"), data.get("type", "info"),
                data.get("title", ""), data.get("body", ""), data.get("target_url", ""))
        _safe_commit(db)
        return {"ok": True}
    finally:
        db.close()


# ============================================================
# 活动流（按总项目）
# ============================================================

@router.get("/master/{master_id}/activity")
def get_activity(master_id: int, limit: int = Query(60)):
    db = _rw()
    try:
        rows = _rows(db.execute(
            """SELECT a.*, COALESCE(u.display_name,u.username) as user_name, u.avatar_color
               FROM activity_feed a LEFT JOIN users u ON u.id=a.user_id
               WHERE a.project_id=? ORDER BY a.created_at DESC LIMIT ?""",
            [master_id, limit]).fetchall())
        return {"ok": True, "activity": rows, "count": len(rows)}
    finally:
        db.close()


@router.post("/master/{master_id}/activity")
def post_activity(master_id: int, data: dict = Body(...), request: Request = None):
    uid = _uid(request)
    action = (data.get("action") or "").strip()
    if not action:
        raise HTTPException(400, "action 必填")
    db = _rw()
    try:
        _log_activity(db, uid, action, data.get("target_type"), data.get("target_id"),
                      data.get("target_name"), data.get("detail"), master_id)
        _safe_commit(db)
        return {"ok": True}
    finally:
        db.close()
