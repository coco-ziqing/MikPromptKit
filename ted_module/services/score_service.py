# -*- coding: utf-8 -*-
"""评分模型 + 四类题材池划分（纯本地数值运算）

评分模型：composite = W_DEMAND*需求指数 + W_OPPORTUNITY*机会指数 [+ W_SALES*销售信号]
四类题材池：
  - main_pool 主力投产池：需求高 & 机会高
  - red_ocean 内卷慎入池：需求高 & 机会低
  - blue_ocean 蓝海观察池：需求低 & 机会高
  - sunset    滞销淘汰池：需求低 & 机会低
"""
import json
import math

from config import (POOL_THRESHOLD_DEMAND, POOL_THRESHOLD_OPP, W_DEMAND,
                    W_OPPORTUNITY, W_SALES)
from db import get_conn, init_db, row_to_dict


def sales_signal(sales_qty, revenue):
    """自有销售信号 0-100：对数缩放（销量为主，销售额为辅）"""
    base = math.log10(sales_qty + 1) / math.log10(10000 + 1) * 100 if sales_qty > 0 else 0.0
    rev = math.log10(revenue + 1) / math.log10(100000 + 1) * 100 if revenue > 0 else 0.0
    return round(0.7 * base + 0.3 * rev, 2)


def composite_score(demand, opp, sales=0.0, has_sales=False):
    """综合评分 0-100；有销售数据时启用销售信号权重"""
    if has_sales and sales > 0:
        return round(0.5 * demand + 0.3 * opp + 0.2 * sales, 2)
    return round(W_DEMAND * demand + W_OPPORTUNITY * opp, 2)


def classify_pool(demand, opp):
    """四池划分（阈值见 config）"""
    d_high = demand >= POOL_THRESHOLD_DEMAND
    o_high = opp >= POOL_THRESHOLD_OPP
    if d_high and o_high:
        return "main_pool", f"需求{demand:.0f}≥{POOL_THRESHOLD_DEMAND} 且 机会{opp:.0f}≥{POOL_THRESHOLD_OPP}：双高，优先投产"
    if d_high:
        return "red_ocean", f"需求{demand:.0f}≥{POOL_THRESHOLD_DEMAND} 但 机会{opp:.0f}<{POOL_THRESHOLD_OPP}：需求大但竞争激烈"
    if o_high:
        return "blue_ocean", f"需求{demand:.0f}<{POOL_THRESHOLD_DEMAND} 但 机会{opp:.0f}≥{POOL_THRESHOLD_OPP}：需求待培育，机会向好"
    return "sunset", f"需求{demand:.0f}<{POOL_THRESHOLD_DEMAND} 且 机会{opp:.0f}<{POOL_THRESHOLD_OPP}：双低，建议收缩/淘汰"


POOL_LABELS = {
    "main_pool": "主力投产池",
    "red_ocean": "内卷慎入池",
    "blue_ocean": "蓝海观察池",
    "sunset": "滞销淘汰池",
}


def analyze_version(version_id: int, sales_version_id: int = 0) -> dict:
    """对指定版本执行：聚类 → 聚合归一化 → 评分 → 分池 → 落库（theme_metrics + theme_pools）
    sales_version_id: 可选，合并销售记录版本（按题材匹配注入真实销量/收益信号）"""
    from services.clean_service import aggregate_metrics, cluster_records, percentile_normalize

    init_db()
    conn = get_conn()
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(theme_pools)").fetchall()]
        if "verified_orders" not in cols:
            conn.execute("ALTER TABLE theme_pools ADD COLUMN verified_orders INTEGER DEFAULT 0")
            conn.commit()
        rows = conn.execute("SELECT * FROM raw_records WHERE version_id=?", [version_id]).fetchall()
        if not rows:
            raise ValueError("该版本无原始数据，请先上传快照")
        records = [dict(r) for r in rows]
        groups, order = cluster_records(records)
        metrics = aggregate_metrics(groups, order, version_id)

        # 跨版本合并：销售记录版本 → 按题材 key 匹配注入 sales_qty/revenue（真实出单验证）
        merged_orders = 0
        if sales_version_id and sales_version_id != version_id:
            srows = conn.execute("SELECT * FROM raw_records WHERE version_id=?", [sales_version_id]).fetchall()
            if srows:
                sgroups, sorder = cluster_records([dict(r) for r in srows])
                sales_map = {}
                for key in sorder:
                    recs = sgroups[key]
                    sales_map[key] = {
                        "sales_qty": sum(r.get("sales_qty", 0) or 0 for r in recs),
                        "revenue": sum(r.get("revenue", 0) or 0 for r in recs),
                        "orders": len(recs),
                    }
                for m in metrics:
                    if m["theme_key"] in sales_map:
                        sm = sales_map[m["theme_key"]]
                        m["sales_qty"] = sm["sales_qty"]
                        m["revenue"] = sm["revenue"]
                        m["merged_orders"] = sm["orders"]
                        merged_orders += sm["orders"]
                if merged_orders:
                    for m in metrics:
                        m.pop("_dim_source", None)

        has_sales = any(m["sales_qty"] > 0 or m["revenue"] > 0 for m in metrics)
        has_opportunity = any(m["opportunity_index"] > 0 for m in metrics)
        single_dim = not has_opportunity  # 无需求/机会指数的单维版本
        if single_dim:
            # 单维数据源判定：作品数（官方热搜榜）→ 销售次数（自有销售记录）→ 原始需求值
            if not any(m["demand_index"] > 0 for m in metrics) and any(m["works_count"] > 0 for m in metrics):
                wnorm = percentile_normalize([m["works_count"] for m in metrics])
                for m, w in zip(metrics, wnorm):
                    m["demand_index"] = w
                    m["_dim_source"] = "works"
            elif not any(m["demand_index"] > 0 for m in metrics) and any(m["sales_qty"] > 0 for m in metrics):
                snorm = percentile_normalize([m["sales_qty"] for m in metrics])
                for m, sc in zip(metrics, snorm):
                    m["demand_index"] = sc
                    m["_dim_source"] = "sales"
            else:
                for m in metrics:
                    m["_dim_source"] = "demand"

        # 落库 themes
        for m in metrics:
            conn.execute(
                "INSERT INTO themes (theme_key, display_name, aliases) VALUES (?,?,?) "
                "ON CONFLICT(theme_key) DO UPDATE SET display_name=excluded.display_name, aliases=excluded.aliases",
                [m["theme_key"], m["display_name"], json.dumps(m["aliases"], ensure_ascii=False)])
        conn.commit()

        # 评分 + 分池
        results = []
        for m in metrics:
            sales = sales_signal(m["sales_qty"], m["revenue"])
            comp = composite_score(m["demand_index"], m["opportunity_index"], sales, has_sales)
            if single_dim:
                src = m.get("_dim_source", "demand")
                if src == "sales":
                    if m["demand_index"] >= POOL_THRESHOLD_DEMAND:
                        pool, reason = "main_pool", f"销售次数{m['sales_qty']:.0f}（销售表现高）：已实际出单，优先投产候选（单维销售数据）"
                    elif m["demand_index"] >= 30:
                        pool, reason = "blue_ocean", f"销售次数{m['sales_qty']:.0f}（销售表现中）：少量出单，建议观察（单维销售数据）"
                    else:
                        pool, reason = "sunset", f"销售次数{m['sales_qty']:.0f}（销售表现低）：无/极少出单，建议收缩（单维销售数据）"
                elif src == "works":
                    if m["demand_index"] >= POOL_THRESHOLD_DEMAND:
                        pool, reason = "main_pool", f"作品数{m['works_count']:.0f}（热搜热度高）：高热度词，优先投产候选（单维热搜数据）"
                    elif m["demand_index"] >= 30:
                        pool, reason = "blue_ocean", f"作品数{m['works_count']:.0f}（热搜热度中）：热度中等，建议观察（单维热搜数据）"
                    else:
                        pool, reason = "sunset", f"作品数{m['works_count']:.0f}（热搜热度低）：低热度，建议淘汰/收缩（单维热搜数据）"
                else:
                    if m["demand_index"] >= POOL_THRESHOLD_DEMAND:
                        pool, reason = "main_pool", f"热度{m['demand_index']:.0f}：高热度方向，优先投产候选（单维数据）"
                    elif m["demand_index"] >= 30:
                        pool, reason = "blue_ocean", f"热度{m['demand_index']:.0f}：热度中等，建议观察（单维数据）"
                    else:
                        pool, reason = "sunset", f"热度{m['demand_index']:.0f}：低热度，建议淘汰/收缩（单维数据）"
            else:
                pool, reason = classify_pool(m["demand_index"], m["opportunity_index"])
            results.append({
                "theme_key": m["theme_key"],
                "demand_index": m["demand_index"],
                "opportunity_index": m["opportunity_index"],
                "works_count": m["works_count"],
                "sales_signal": sales,
                "composite_score": comp,
                "pool_type": pool,
                "reason": reason,
                "sales_qty": m["sales_qty"],
                "revenue": m["revenue"],
                "record_count": m["record_count"],
                "merged_orders": m.get("merged_orders", 0),
            })
        results.sort(key=lambda x: -x["composite_score"])

        # 清旧 + 写 metrics/pools
        conn.execute("DELETE FROM theme_metrics WHERE version_id=?", [version_id])
        conn.execute("DELETE FROM theme_pools WHERE version_id=?", [version_id])
        for i, r in enumerate(results, 1):
            tid = conn.execute("SELECT id FROM themes WHERE theme_key=?", [r["theme_key"]]).fetchone()["id"]
            conn.execute(
                "INSERT INTO theme_metrics (version_id, theme_id, demand_index, opportunity_index, works_count, sales_qty, revenue, record_count) "
                "VALUES (?,?,?,?,?,?,?,?)",
                [version_id, tid, r["demand_index"], r["opportunity_index"], r["works_count"],
                 r["sales_qty"], r["revenue"], r["record_count"]])
            conn.execute(
                "INSERT INTO theme_pools (version_id, theme_id, pool_type, composite_score, demand_score, opportunity_score, reason, rank_no, verified_orders) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                [version_id, tid, r["pool_type"], r["composite_score"], r["demand_index"],
                 r["opportunity_index"], r["reason"], i, r.get("merged_orders", 0)])
        conn.execute("UPDATE snapshot_versions SET status='analyzed' WHERE id=?", [version_id])
        conn.commit()
        return {
            "version_id": version_id,
            "theme_count": len(results),
            "has_sales": has_sales,
            "single_dim": single_dim,
            "merged_orders": merged_orders,
            "pools": {pt: sum(1 for r in results if r["pool_type"] == pt) for pt in POOL_LABELS},
        }
    finally:
        conn.close()
