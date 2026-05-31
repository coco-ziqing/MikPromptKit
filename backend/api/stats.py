"""
统计仪表盘 API
提供各模块使用频率 TOP、趋势、标签分布等数据聚合
"""
from fastapi import APIRouter
from database import get_db
import json
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/v2/stats", tags=["stats"])


@router.get("/dashboard")
def get_dashboard():
    """获取统计仪表盘数据"""
    db = get_db()

    # 1. 各模块词条数
    modules_raw = db.execute("""
        SELECT module, COUNT(*) as count
        FROM prompts WHERE deleted_at IS NULL
        GROUP BY module ORDER BY count DESC
    """).fetchall()
    modules = [{"name": r["module"], "count": r["count"]} for r in modules_raw]

    total = sum(m["count"] for m in modules)

    # 2. 各分类词条数（TOP 15）
    cats_raw = db.execute("""
        SELECT category, COUNT(*) as count
        FROM prompts WHERE deleted_at IS NULL AND category != ''
        GROUP BY category ORDER BY count DESC LIMIT 15
    """).fetchall()
    categories = [{"name": r["category"], "count": r["count"]} for r in cats_raw]

    # 3. 使用频率 TOP 10
    top_raw = db.execute("""
        SELECT id, content, module, category, usage_count
        FROM prompts WHERE deleted_at IS NULL
        ORDER BY usage_count DESC LIMIT 10
    """).fetchall()
    top_used = []
    for r in top_raw:
        top_used.append({
            "id": r["id"],
            "content": (r["content"] or "")[:50],
            "module": r["module"] or "",
            "category": r["category"] or "",
            "usage_count": r["usage_count"] or 0
        })

    # 4. 标签分布 TOP 20
    all_tags_raw = db.execute("SELECT tags FROM prompts WHERE deleted_at IS NULL").fetchall()
    tag_count = {}
    for r in all_tags_raw:
        try:
            t = json.loads(r["tags"]) if r["tags"] else []
            if isinstance(t, list):
                for tag in t:
                    if tag and isinstance(tag, str):
                        tag_count[tag.strip()] = tag_count.get(tag.strip(), 0) + 1
        except Exception:
            pass
    tag_dist = sorted([{"name": k, "count": v} for k, v in tag_count.items()], key=lambda x: -x["count"])[:20]

    # 5. 今日使用/新增
    today_str = datetime.now().strftime("%Y-%m-%d")
    today_usage = db.execute(
        "SELECT COUNT(*) FROM usage_history WHERE used_at >= ?", [today_str]
    ).fetchone()[0]

    # 6. 收藏总数
    coll_count = db.execute("SELECT COUNT(*) FROM collection_items").fetchone()[0]

    # 7. 词包总数
    wp_count = db.execute("SELECT COUNT(*) FROM wordpack_items").fetchone()[0]

    # 8. 回收站
    trash_count = db.execute("SELECT COUNT(*) FROM prompts WHERE deleted_at IS NOT NULL").fetchone()[0]

    return {
        "ok": True,
        "total_prompts": total,
        "modules": modules,
        "categories": categories,
        "top_used": top_used,
        "tags": tag_dist,
        "today_usage": today_usage,
        "total_collections": coll_count,
        "total_wordpack_items": wp_count,
        "trash_count": trash_count
    }
