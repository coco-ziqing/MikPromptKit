# -*- coding: utf-8 -*-
"""
com.promptkit.srs-review API routes
Prefix: /api/plugins/com.promptkit.srs-review/

15 endpoints: due / due-count / rate / preview-interval /
enroll / enroll-batch / delete / cards /
stats / history / calendar / optimize / config / params / enrollable
"""

import math
import os
import sqlite3
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Body

import sys
from pathlib import Path
_plugin_dir = Path(__file__).resolve().parent
if str(_plugin_dir) not in sys.path:
    sys.path.insert(0, str(_plugin_dir))

from fsrs import (
    FSRS, Card, State, Rating,
    optimize_parameters, format_interval,
    FSRS_DEFAULT_W, SECONDS_PER_DAY,
)

router = APIRouter(tags=["SRS Review"])

DB_PATH = None

def _get_db_path():
    global DB_PATH
    if DB_PATH:
        return DB_PATH
    project_root = _plugin_dir.parents[1]
    DB_PATH = str(project_root / "data" / "prompts.db")
    return DB_PATH

def _ro():
    db_path = _get_db_path()
    conn = sqlite3.connect(db_path, timeout=2)
    conn.row_factory = sqlite3.Row
    return conn

def _rw():
    db_path = _get_db_path()
    conn = sqlite3.connect(db_path, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    return conn

def _get_user_params(user_id=None):
    db = _ro()
    try:
        row = db.execute(
            "SELECT w0,w1,w2,w3,w4,w5,w6,w7,w8,w9,w10,w11,w12,w13,w14,w15,w16,target_retrievability "
            "FROM srs_params WHERE user_id IS ? LIMIT 1", [user_id]
        ).fetchone()
        if row:
            return [row[f"w{i}"] for i in range(17)]
    finally:
        db.close()
    return FSRS_DEFAULT_W.copy()

def _get_config(user_id=None):
    db = _ro()
    try:
        row = db.execute(
            "SELECT * FROM srs_deck_config WHERE user_id IS ? LIMIT 1", [user_id]
        ).fetchone()
        if row:
            return dict(row)
    finally:
        db.close()
    return {
        "daily_new_limit": 20, "daily_review_limit": 200,
        "review_order": "mixed", "auto_enroll": 0,
        "card_mode_default": "text", "notify_enabled": 0,
    }

def _load_card(row):
    return Card(
        state=State(row["state"] or 0),
        difficulty=row["difficulty"] or 0.0,
        stability=row["stability"] or 0.0,
        elapsed_days=row["elapsed_days"] or 0.0,
        scheduled_days=row["scheduled_days"] or 0.0,
        reps=row["reps"] or 0,
        lapses=row["lapses"] or 0,
        last_review=row["last_review"],
        due=row["due"],
    )

# ---- Review Queue ----

@router.get("/due")
def get_due_cards(limit: int = Query(50, ge=1, le=200),
                  offset: int = Query(0, ge=0),
                  user_id: Optional[int] = Query(None)):
    db = _ro()
    now = time.time()
    config = _get_config(user_id)
    order = config.get("review_order", "mixed")
    try:
        rows = db.execute("""
            SELECT sc.*, wc.name as title, wc.content, wc.meaning, wc.scene, wc.module,
                   wc.thumbnail, wc.preview_media, wc.tags, wc.category
            FROM srs_cards sc
            LEFT JOIN word_card wc ON sc.word_card_id = wc.id
            WHERE sc.is_active = 1
              AND (sc.due IS NULL OR sc.due <= ?)
              AND (sc.user_id IS NULL OR sc.user_id = ?)
            ORDER BY
                CASE ?
                    WHEN 'review_first' THEN (CASE WHEN sc.due IS NOT NULL THEN 0 ELSE 1 END)
                    WHEN 'new_first' THEN (CASE WHEN sc.due IS NULL THEN 0 ELSE 1 END)
                    ELSE sc.due
                END,
                sc.due ASC
            LIMIT ? OFFSET ?
        """, [now, user_id, order, min(limit, config.get("daily_review_limit", 200)), offset]).fetchall()
    finally:
        db.close()
    cards = []
    for row in rows:
        r = dict(row)
        card = _load_card(row)
        fsrs = FSRS(_get_user_params(user_id))
        elapsed = (now - card.last_review) / SECONDS_PER_DAY if card.last_review else 0
        retrievability = fsrs.forgetting_curve(elapsed, card.stability)
        preview = {}
        if card.state != State.NEW or card.reps > 0:
            for rating in [1, 2, 3, 4]:
                interval_days = fsrs.next_interval(card, Rating(rating))
                preview[str(rating)] = {"days": round(interval_days, 2), "label": format_interval(interval_days)}
        else:
            preview = {
                "1": {"days": 0.01, "label": "1 min"},
                "2": {"days": 0.5, "label": "12h"},
                "3": {"days": round(FSRS_DEFAULT_W[2], 1), "label": format_interval(FSRS_DEFAULT_W[2])},
                "4": {"days": round(FSRS_DEFAULT_W[3], 1), "label": format_interval(FSRS_DEFAULT_W[3])},
            }
        r.update({
            "retrievability": round(retrievability, 4),
            "preview": preview,
            "state_name": card.state.name,
            "card": card.to_dict(),
        })
        cards.append(r)
    return {"ok": True, "cards": cards, "count": len(cards)}

@router.get("/due-count")
def get_due_count(user_id: Optional[int] = Query(None)):
    db = _ro()
    now = time.time()
    try:
        new_count = db.execute(
            "SELECT COUNT(*) FROM srs_cards WHERE is_active=1 AND state=0 AND (user_id IS NULL OR user_id=?)",
            [user_id]
        ).fetchone()[0]
        due_review = db.execute(
            "SELECT COUNT(*) FROM srs_cards WHERE is_active=1 AND state!=0 AND due IS NOT NULL AND due<=? AND (user_id IS NULL OR user_id=?)",
            [now, user_id]
        ).fetchone()[0]
        total = db.execute(
            "SELECT COUNT(*) FROM srs_cards WHERE is_active=1 AND (user_id IS NULL OR user_id=?)",
            [user_id]
        ).fetchone()[0]
    finally:
        db.close()
    return {"ok": True, "new": new_count, "due_review": due_review,
            "total_due": new_count + due_review, "total_cards": total}

@router.post("/rate")
def rate_card(data: dict = Body(...)):
    card_id = data.get("card_id")
    rating_val = data.get("rating")
    review_time_ms = data.get("review_time_ms", 0)
    user_id = data.get("user_id")
    if not card_id or rating_val not in (1, 2, 3, 4):
        raise HTTPException(400, "card_id and rating(1-4) required")
    db = _rw()
    try:
        row = db.execute("SELECT * FROM srs_cards WHERE id=?", [card_id]).fetchone()
        if not row:
            raise HTTPException(404, "Card not found")
        card = _load_card(row)
        state_before = int(card.state)
        fsrs = FSRS(_get_user_params(user_id))
        result = fsrs.repeat(card, Rating(rating_val))
        updated_card = result["card"]
        log = result["log"]
        log.card_id = card_id
        log.review_time_ms = review_time_ms
        db.execute("""
            UPDATE srs_cards SET state=?, difficulty=?, stability=?, elapsed_days=?,
            scheduled_days=?, reps=?, lapses=?, last_review=?, due=?,
            updated_at=datetime('now','localtime') WHERE id=?
        """, [int(updated_card.state), round(updated_card.difficulty, 4),
              round(updated_card.stability, 4), round(updated_card.elapsed_days, 2),
              round(updated_card.scheduled_days, 2), updated_card.reps,
              updated_card.lapses, updated_card.last_review, updated_card.due, card_id])
        db.execute("""
            INSERT INTO srs_reviews (card_id, rating, state_before, state_after,
            elapsed_days, scheduled_days, review_time_ms, reviewed_at)
            VALUES (?,?,?,?,?,?,?,?)
        """, [card_id, rating_val, state_before,
              int(log.state_after), round(log.elapsed_days, 2),
              round(log.scheduled_days, 2), review_time_ms, log.timestamp])
        db.commit()
        return {"ok": True, "srs_card": updated_card.to_dict(),
                "next_review_label": format_interval(updated_card.scheduled_days)}
    finally:
        db.close()

@router.get("/preview-interval")
def preview_interval(card_id: int = Query(...), rating: int = Query(..., ge=1, le=4),
                     user_id: Optional[int] = Query(None)):
    db = _ro()
    try:
        row = db.execute("SELECT * FROM srs_cards WHERE id=?", [card_id]).fetchone()
        if not row:
            raise HTTPException(404, "Card not found")
        card = _load_card(row)
        fsrs = FSRS(_get_user_params(user_id))
        result = {}
        for r in [1, 2, 3, 4]:
            interval = fsrs.next_interval(card, Rating(r))
            result[str(r)] = {"days": round(interval, 2), "label": format_interval(interval)}
        return {"ok": True, "card_id": card_id, "preview": result}
    finally:
        db.close()

# ---- Card Management ----

@router.post("/enroll")
def enroll_card(data: dict = Body(...)):
    word_card_id = data.get("word_card_id")
    card_mode = data.get("card_mode", "text")
    user_id = data.get("user_id")
    if not word_card_id:
        raise HTTPException(400, "word_card_id required")
    db = _rw()
    try:
        wc = db.execute("SELECT id, name as title FROM word_card WHERE id=?", [word_card_id]).fetchone()
        if not wc:
            raise HTTPException(404, f"Word card {word_card_id} not found")
        existing = db.execute(
            "SELECT id FROM srs_cards WHERE word_card_id=? AND (user_id IS NULL OR user_id=?)",
            [word_card_id, user_id]
        ).fetchone()
        if existing:
            return {"ok": True, "card_id": existing["id"], "message": "Already enrolled"}
        db.execute("INSERT INTO srs_cards (word_card_id, card_mode, state, user_id) VALUES (?,?,0,?)",
                   [word_card_id, card_mode, user_id])
        db.commit()
        new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok": True, "card_id": new_id, "message": f"Enrolled: {wc['title']}"}
    finally:
        db.close()

@router.post("/enroll-batch")
def enroll_batch(data: dict = Body(...)):
    word_card_ids = data.get("word_card_ids", [])
    card_mode = data.get("card_mode", "text")
    collection_id = data.get("collection_id")
    user_id = data.get("user_id")
    if not word_card_ids:
        raise HTTPException(400, "word_card_ids cannot be empty")
    db = _rw()
    try:
        added = skipped = 0
        for wcid in word_card_ids:
            existing = db.execute(
                "SELECT id FROM srs_cards WHERE word_card_id=? AND (user_id IS NULL OR user_id=?)",
                [wcid, user_id]
            ).fetchone()
            if existing:
                skipped += 1; continue
            db.execute("INSERT INTO srs_cards (word_card_id, collection_id, card_mode, state, user_id) VALUES (?,?,?,0,?)",
                       [wcid, collection_id, card_mode, user_id])
            added += 1
        db.commit()
        return {"ok": True, "added": added, "skipped": skipped,
                "message": f"Added {added}, skipped {skipped}"}
    finally:
        db.close()

@router.delete("/cards/{card_id}")
def remove_card(card_id: int):
    db = _rw()
    try:
        db.execute("UPDATE srs_cards SET is_active=0, updated_at=datetime('now','localtime') WHERE id=?", [card_id])
        db.commit()
        return {"ok": True, "message": "Removed from review"}
    finally:
        db.close()

@router.get("/cards")
def list_cards(user_id: Optional[int] = Query(None), is_active: Optional[int] = Query(1),
               limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    db = _ro()
    try:
        rows = db.execute("""
            SELECT sc.*, wc.name as title, wc.content, wc.meaning, wc.thumbnail
            FROM srs_cards sc LEFT JOIN word_card wc ON sc.word_card_id = wc.id
            WHERE sc.is_active=? AND (sc.user_id IS NULL OR sc.user_id=?)
            ORDER BY sc.enrolled_at DESC LIMIT ? OFFSET ?
        """, [is_active, user_id, limit, offset]).fetchall()
        total = db.execute(
            "SELECT COUNT(*) FROM srs_cards WHERE is_active=? AND (user_id IS NULL OR user_id=?)",
            [is_active, user_id]
        ).fetchone()[0]
        cards = [dict(r) for r in rows]
        for c in cards:
            c["state_name"] = State(c.get("state", 0) or 0).name
            c["next_review"] = format_interval(c.get("scheduled_days", 0) or 0) if c.get("scheduled_days") else "Not started"
        return {"ok": True, "cards": cards, "total": total}
    finally:
        db.close()

# ---- Stats ----

@router.get("/stats")
def get_stats(user_id: Optional[int] = Query(None)):
    db = _ro()
    now = time.time()
    try:
        total_cards = db.execute(
            "SELECT COUNT(*) FROM srs_cards WHERE is_active=1 AND (user_id IS NULL OR user_id=?)",
            [user_id]
        ).fetchone()[0]
        total_reviews = db.execute("""
            SELECT COUNT(*) FROM srs_reviews r JOIN srs_cards sc ON r.card_id=sc.id
            WHERE (sc.user_id IS NULL OR sc.user_id=?)
        """, [user_id]).fetchone()[0]
        day_start = now - (now % SECONDS_PER_DAY)
        today_reviews = db.execute("""
            SELECT COUNT(*) FROM srs_reviews r JOIN srs_cards sc ON r.card_id=sc.id
            WHERE r.reviewed_at>=? AND (sc.user_id IS NULL OR sc.user_id=?)
        """, [day_start, user_id]).fetchone()[0]
        recall = db.execute("""
            SELECT COUNT(CASE WHEN r.rating>=3 THEN 1 END) as remembered, COUNT(*) as total
            FROM srs_reviews r JOIN srs_cards sc ON r.card_id=sc.id
            WHERE (sc.user_id IS NULL OR sc.user_id=?)
        """, [user_id]).fetchone()
        recall_rate = round(recall["remembered"] / recall["total"] * 100, 1) if recall["total"] > 0 else 0
        streak = _calculate_streak(db, user_id)
        state_dist = {}
        for s in [0, 1, 2, 3]:
            count = db.execute(
                "SELECT COUNT(*) FROM srs_cards WHERE is_active=1 AND state=? AND (user_id IS NULL OR user_id=?)",
                [s, user_id]
            ).fetchone()[0]
            state_dist[State(s).name] = count
        future_due = []
        for d in range(7):
            day_end = day_start + (d + 1) * SECONDS_PER_DAY
            count = db.execute("""
                SELECT COUNT(*) FROM srs_cards WHERE is_active=1 AND due IS NOT NULL AND due<? AND (user_id IS NULL OR user_id=?)
            """, [day_end, user_id]).fetchone()[0]
            future_due.append({"day": d, "label": f"D+{d}", "count": count})
    finally:
        db.close()
    return {"ok": True, "stats": {
        "total_cards": total_cards, "total_reviews": total_reviews,
        "today_reviews": today_reviews, "recall_rate": recall_rate,
        "streak_days": streak, "state_distribution": state_dist,
        "future_due": future_due,
    }}

def _calculate_streak(db, user_id=None):
    now = time.time()
    streak = 0
    for d in range(365):
        day_start = now - (now % SECONDS_PER_DAY) - d * SECONDS_PER_DAY
        day_end = day_start + SECONDS_PER_DAY
        count = db.execute("""
            SELECT COUNT(*) FROM srs_reviews r JOIN srs_cards sc ON r.card_id=sc.id
            WHERE r.reviewed_at>=? AND r.reviewed_at<? AND (sc.user_id IS NULL OR sc.user_id=?)
        """, [day_start, day_end, user_id]).fetchone()[0]
        if count > 0:
            streak += 1
        else:
            break
    return streak

@router.get("/history")
def get_history(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                user_id: Optional[int] = Query(None)):
    db = _ro()
    try:
        rows = db.execute("""
            SELECT r.*, wc.name as title, wc.content
            FROM srs_reviews r JOIN srs_cards sc ON r.card_id=sc.id
            LEFT JOIN word_card wc ON sc.word_card_id=wc.id
            WHERE (sc.user_id IS NULL OR sc.user_id=?)
            ORDER BY r.reviewed_at DESC LIMIT ? OFFSET ?
        """, [user_id, limit, offset]).fetchall()
        total = db.execute("""
            SELECT COUNT(*) FROM srs_reviews r JOIN srs_cards sc ON r.card_id=sc.id
            WHERE (sc.user_id IS NULL OR sc.user_id=?)
        """, [user_id]).fetchone()[0]
    finally:
        db.close()
    records = []
    for row in rows:
        r = dict(row)
        r["state_before_name"] = State(r.get("state_before", 0) or 0).name
        r["state_after_name"] = State(r.get("state_after", 0) or 0).name
        r["rating_name"] = {1: "Again", 2: "Hard", 3: "Good", 4: "Easy"}.get(r["rating"], "?")
        records.append(r)
    return {"ok": True, "records": records, "total": total}

@router.get("/calendar")
def get_calendar(year: int = Query(...), month: int = Query(...),
                 user_id: Optional[int] = Query(None)):
    import calendar as cal
    db = _ro()
    try:
        first_day = time.mktime((year, month, 1, 0, 0, 0, 0, 0, -1))
        if month == 12:
            last_day = time.mktime((year + 1, 1, 1, 0, 0, 0, 0, 0, -1))
        else:
            last_day = time.mktime((year, month + 1, 1, 0, 0, 0, 0, 0, -1))
        rows = db.execute("""
            SELECT date(datetime(r.reviewed_at, 'unixepoch', 'localtime')) as review_date,
                   COUNT(*) as review_count,
                   AVG(CASE WHEN r.rating>=3 THEN 1.0 ELSE 0.0 END) as day_recall
            FROM srs_reviews r JOIN srs_cards sc ON r.card_id=sc.id
            WHERE r.reviewed_at>=? AND r.reviewed_at<? AND (sc.user_id IS NULL OR sc.user_id=?)
            GROUP BY review_date ORDER BY review_date
        """, [first_day, last_day, user_id]).fetchall()
    finally:
        db.close()
    days = {}
    for row in rows:
        days[row["review_date"]] = {"count": row["review_count"],
                                     "recall": round(row["day_recall"] * 100, 1) if row["day_recall"] else 0}
    return {"ok": True, "year": year, "month": month, "days": days}

# ---- Optimize & Config ----

@router.post("/optimize")
def optimize_params(user_id: Optional[int] = Query(None)):
    db = _ro()
    try:
        rows = db.execute("""
            SELECT r.rating, r.elapsed_days, r.scheduled_days, r.state_before as state
            FROM srs_reviews r JOIN srs_cards sc ON r.card_id=sc.id
            WHERE (sc.user_id IS NULL OR sc.user_id=?)
            ORDER BY r.reviewed_at DESC LIMIT 500
        """, [user_id]).fetchall()
        if len(rows) < 50:
            return {"ok": False, "message": f"Need >=50 reviews (have {len(rows)})", "records_needed": 50}
        review_history = [dict(r) for r in rows]
        optimized_w = optimize_parameters(review_history, _get_user_params(user_id))
        db2 = _rw()
        try:
            db2.execute("""
                UPDATE srs_params SET w0=?,w1=?,w2=?,w3=?,w4=?,w5=?,w6=?,w7=?,w8=?,
                w9=?,w10=?,w11=?,w12=?,w13=?,w14=?,w15=?,w16=?,
                optimized_at=?, updated_at=datetime('now','localtime') WHERE user_id IS ?
            """, [*optimized_w, time.time(), user_id])
            db2.commit()
        finally:
            db2.close()
    finally:
        db.close()
    return {"ok": True, "message": "Parameters optimized", "records_used": len(rows)}

@router.get("/config")
def get_config(user_id: Optional[int] = Query(None)):
    config = _get_config(user_id)
    params = {}
    db = _ro()
    try:
        row = db.execute(
            "SELECT target_retrievability, optimized_at FROM srs_params WHERE user_id IS ?",
            [user_id]
        ).fetchone()
        if row:
            params["target_retrievability"] = row["target_retrievability"]
            params["optimized_at"] = row["optimized_at"]
    finally:
        db.close()
    return {"ok": True, "config": config, "fsrs_params": params}

@router.put("/config")
def update_config(data: dict = Body(...), user_id: Optional[int] = Query(None)):
    db = _rw()
    try:
        db.execute("INSERT OR IGNORE INTO srs_deck_config (user_id) VALUES (?)", [user_id])
        allowed = ["daily_new_limit", "daily_review_limit", "review_order",
                    "auto_enroll", "card_mode_default", "notify_enabled"]
        updates = []; values = []
        for field in allowed:
            if field in data:
                updates.append(f"{field}=?")
                values.append(data[field])
        if updates:
            values.append(user_id)
            db.execute(f"UPDATE srs_deck_config SET {', '.join(updates)}, updated_at=datetime('now','localtime') WHERE user_id IS ?", values)
        if "target_retrievability" in data:
            db.execute("INSERT OR IGNORE INTO srs_params (user_id) VALUES (?)", [user_id])
            db.execute("UPDATE srs_params SET target_retrievability=?, updated_at=datetime('now','localtime') WHERE user_id IS ?",
                       [data["target_retrievability"], user_id])
        db.commit()
    finally:
        db.close()
    return {"ok": True, "message": "Config updated"}

@router.get("/params")
def get_params(user_id: Optional[int] = Query(None)):
    w = _get_user_params(user_id)
    return {"ok": True, "params": {f"w{i}": v for i, v in enumerate(w)},
            "is_default": w == FSRS_DEFAULT_W}

# ---- Enrollable ----

@router.get("/enrollable")
def get_enrollable(q: Optional[str] = Query(None), limit: int = Query(50, ge=1, le=200),
                   user_id: Optional[int] = Query(None)):
    db = _ro()
    try:
        query_str = """
            SELECT wc.id, wc.name as title, wc.content, wc.meaning, wc.thumbnail, wc.module, wc.tags
            FROM word_card wc
            WHERE wc.id NOT IN (
                SELECT word_card_id FROM srs_cards WHERE is_active=1 AND (user_id IS NULL OR user_id=?)
            )
        """
        params_list = [user_id]
        if q:
            query_str += " AND (wc.name LIKE ? OR wc.content LIKE ? OR wc.tags LIKE ?)"
            like_q = f"%{q}%"
            params_list.extend([like_q, like_q, like_q])
        query_str += " ORDER BY wc.id DESC LIMIT ?"
        params_list.append(limit)
        rows = db.execute(query_str, params_list).fetchall()
    finally:
        db.close()
    return {"ok": True, "cards": [dict(r) for r in rows], "count": len(rows)}
