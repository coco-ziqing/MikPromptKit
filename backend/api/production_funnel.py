# -*- coding: utf-8 -*-
"""生产链路漏斗看板 API（v5.40.1 P2）
聚合：题材池（需求分析模块 :8085，本地服务间调用）→ 词卡 → 生成 → 投稿 → 上架台账
全部为本地数据统计；8085 不可用时题材环节降级为 null（不阻塞）
"""
from fastapi import APIRouter

from database import get_db

router = APIRouter(tags=["production"])


def _count(sql: str, args=None) -> int:
    db = get_db()
    try:
        r = db.execute(sql, args or []).fetchone()
        return r[0] if r else 0
    finally:
        db.close()


@router.get("/api/production/funnel")
def production_funnel():
    # 1) 题材池（需求分析模块 8085，本地服务间）
    themes = None
    try:
        import httpx
        r = httpx.get("http://127.0.0.1:8085/api/ted/pools", timeout=3)
        if r.status_code == 200:
            d = r.json()
            pools = d.get("pools") or {}
            themes = {
                "total": sum(len(v) for v in pools.values()),
                "main_pool": len(pools.get("main_pool", [])),
                "red_ocean": len(pools.get("red_ocean", [])),
                "blue_ocean": len(pools.get("blue_ocean", [])),
                "sunset": len(pools.get("sunset", [])),
                "version": d.get("version_name") or "",
            }
    except Exception:
        themes = None

    # 2) 词卡
    cards_total = _count("SELECT COUNT(*) FROM word_card WHERE is_deleted=0")
    cards_quality = _count("SELECT COUNT(*) FROM word_card_quality")

    # 3) 生成任务
    gen_total = _count("SELECT COUNT(*) FROM card_gen_tasks")
    gen_done = _count("SELECT COUNT(*) FROM card_gen_tasks WHERE status='done'")

    # 4) 投稿
    sub_total = _count("SELECT COUNT(*) FROM vjshi_upload_tasks")
    sub_online = _count("SELECT COUNT(*) FROM vjshi_upload_tasks WHERE review_status='online'")
    sub_reviewing = _count("SELECT COUNT(*) FROM vjshi_upload_tasks WHERE review_status='reviewing'")
    sub_rejected = _count("SELECT COUNT(*) FROM vjshi_upload_tasks WHERE review_status='rejected'")

    # 5) 上架台账
    cat_online = _count("SELECT COUNT(*) FROM vjshi_online_catalog WHERE status='online'")
    cat_removed = _count("SELECT COUNT(*) FROM vjshi_online_catalog WHERE status='removed'")
    db = get_db()
    try:
        r = db.execute("SELECT COALESCE(SUM(sales_qty),0), COALESCE(SUM(revenue),0) FROM vjshi_online_catalog WHERE status='online'").fetchone()
        cat_sales = r[0] if r else 0
        cat_revenue = r[1] if r else 0
    finally:
        db.close()

    return {
        "ok": True,
        "stages": {
            "themes": themes,
            "cards": {"total": cards_total, "quality_checked": cards_quality},
            "generated": {"total": gen_total, "done": gen_done},
            "submitted": {"total": sub_total, "online": sub_online, "reviewing": sub_reviewing, "rejected": sub_rejected},
            "catalog": {"online": cat_online, "removed": cat_removed, "sales_qty": round(cat_sales, 1), "revenue": round(cat_revenue, 2)},
        },
    }
