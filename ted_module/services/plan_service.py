# -*- coding: utf-8 -*-
"""开发规划书生成（Markdown，含合规风控章节；纯本地模板渲染）"""
import datetime

from db import get_conn, init_db, row_to_dict

from services.score_service import POOL_LABELS, sales_signal


def _pool_intro(ptype):
    return {
        "main_pool": "需求与机会双高，建议作为近期主力投产方向，按排期集中产出并保持监测。",
        "red_ocean": "需求旺盛但机会指数偏低（竞争充分），建议谨慎投入：差异化切入或暂缓放量。",
        "blue_ocean": "机会向好但需求尚待培育，建议小批量试探、观察需求拐点后再加码。",
        "sunset": "需求与机会双低，建议收缩产能、去库存，避免资源沉没。",
    }.get(ptype, "")


def generate_plan(version_id: int, generated_by: str = "") -> int:
    """生成规划书并落库，返回 plan_documents.id"""
    init_db()
    conn = get_conn()
    try:
        ver = conn.execute("SELECT * FROM snapshot_versions WHERE id=?", [version_id]).fetchone()
        if not ver:
            raise ValueError("版本不存在")
        rows = conn.execute(
            "SELECT p.*, t.display_name, m.sales_qty, m.revenue, m.works_count FROM theme_pools p "
            "JOIN themes t ON t.id=p.theme_id "
            "LEFT JOIN theme_metrics m ON m.theme_id=p.theme_id AND m.version_id=p.version_id "
            "WHERE p.version_id=? ORDER BY p.rank_no", [version_id]).fetchall()
        if not rows:
            raise ValueError("该版本尚未分析（请先运行分析）")

        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        md = []
        md.append(f"# 题材开发规划书")
        md.append("")
        md.append(f"- 数据版本：{ver['name']}（ID {version_id}）")
        md.append(f"- 数据来源：人工上传静态快照（{ver['source_type']}：{ver['file_name']}），共 {ver['rows_count']} 行")
        md.append(f"- 上传人：{ver['uploaded_by'] or '—'} ｜ 生成时间：{now} ｜ 生成人：{generated_by or '—'}")
        md.append("")
        md.append("> 本规划书所有数据均来自人工整理上传的官方公开指数快照与自有销售报表，")
        md.append("> 模块不访问光厂官网、不抓取任何榜单/指数/页面数据。")
        md.append("")

        # 四池概览
        md.append("## 一、题材池概览")
        md.append("")
        md.append("| 题材池 | 说明 | 数量 |")
        md.append("|--------|------|------|")
        pools = {}
        for r in rows:
            pools.setdefault(r["pool_type"], []).append(r)
        for pt, label in POOL_LABELS.items():
            md.append(f"| {label} | {_pool_intro(pt)} | {len(pools.get(pt, []))} |")
        md.append("")

        # 各池明细
        for pt, label in POOL_LABELS.items():
            items = pools.get(pt, [])
            md.append(f"## 二、{label}（{len(items)}）")
            md.append("")
            if not items:
                md.append("（暂无）")
                md.append("")
                continue
            md.append("| 排名 | 题材 | 综合分 | 需求 | 机会 | 作品数 | 研判理由 |")
            md.append("|------|------|--------|------|------|--------|----------|")
            for r in items:
                sig = sales_signal(r["sales_qty"] or 0, r["revenue"] or 0)
                md.append(
                    f"| {r['rank_no']} | {r['display_name']} | {r['composite_score']:.1f} | "
                    f"{r['demand_score']:.1f} | {r['opportunity_score']:.1f} | "
                    f"{r['works_count'] or 0:.0f} | {r['reason']} |")
            md.append("")

        # 建议排期
        main_items = pools.get("main_pool", [])
        md.append("## 三、建议投产排期（人工研判后调整）")
        md.append("")
        if main_items:
            md.append("| 优先级 | 题材 | 建议 |")
            md.append("|--------|------|------|")
            for i, r in enumerate(main_items[:10], 1):
                md.append(f"| P{i} | {r['display_name']} | 主力投产（结合人工考察台账确认） |")
        else:
            md.append("当前版本无主力投产池题材，建议从蓝海观察池中人工筛选候选。")
        md.append("")

        # 合规风控章节
        md.append("## 四、合规风控章节（必读）")
        md.append("")
        md.append("### 4.1 数据合规声明")
        md.append("")
        md.append("- 本模块**不访问**光厂官网，**不抓取**榜单、行情指数、作品预览等任何站点资源；")
        md.append("- 全部输入数据来源于人工浏览、人工整理后**手动上传**的静态文件（Excel/CSV）与人工录入的公告；")
        md.append("- 模块运行全程**无外网 HTTP 请求**、无浏览器自动化、无定时任务、无爬虫/RPA 逻辑；")
        md.append("- 数据仅存本机独立数据库（ted_module/data/ted_analysis.db），不对外传输。")
        md.append("")
        md.append("### 4.2 平台协议风险提示")
        md.append("")
        md.append("- 所有指数/榜单数据的使用须遵守光厂平台用户协议与供稿人协议，仅供内部经营分析参考；")
        md.append("- 人工采集时注意频度与方式，避免触发平台风控；批量数据须在人工确认后整理上传；")
        md.append("- 素材创作与投稿须保证原创性与合规标注（AI 内容如实标注）。")
        md.append("")
        md.append("### 4.3 风险台账")
        md.append("")
        md.append("- 已记录风险条目：见模块「风险记录」工作台（theme 维度）。")
        md.append("- 每个题材投产前，建议在「研判工作台」完成考察记录并确认风险应对措施。")
        md.append("")

        title = f"题材开发规划书 - {ver['name']}（{now[:10]}）"
        cur = conn.execute(
            "INSERT INTO plan_documents (version_id, title, content_md, status, generated_by) VALUES (?,?,?,?,?)",
            [version_id, title, "\n".join(md), "draft", generated_by])
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()
