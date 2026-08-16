# -*- coding: utf-8 -*-
"""词卡提示词质检评分服务（v5.39.0 P0）
规则评分（本地即时）：完整性/合规性/生产适配/文本质量
AI 一致性评分（可选，Ollama qwen3.5:4b）：提示词与名称/分类一致性
总分 0-100；结果落库 word_card_quality（独立表，不碰主表结构）
"""
import json
import os
import re
import sqlite3

from database import get_db, safe_commit

# 违规词黑名单（合规性扣分）
BLACKLIST = [
    "加微信", "微信", "qq", "qq号", "联系方式", "电话", "手机号", "私聊",
    "购买", "下单", "优惠", "折扣价", "包邮", "广告位", "招商", "加盟",
    "代做", "外包", "刷单", "违禁", "赌博", "博彩", "色情", "代刷",
]
# 场景词（完整性：场景维度）
SCENE_WORDS = ["背景", "场景", "环境", "室内", "室外", "城市", "自然", "星空", "光影", "空间", "舞台", "街道", "海边", "森林", "天空"]
# 风格词（完整性：风格维度）
STYLE_WORDS = ["风格", "写实", "动漫", "卡通", "扁平", "科技感", "国潮", "治愈", "简约", "复古", "赛博", "油画", "水墨", "3d", "三维", "插画"]
# 主体词（完整性：主体维度）
SUBJECT_WORDS = ["人物", "角色", "女孩", "男孩", "动物", "猫", "狗", "汽车", "建筑", "产品", "美食", "植物", "花", "机器人", "宇航员"]
# 镜头词（完整性：镜头维度）
SHOT_WORDS = ["镜头", "特写", "远景", "近景", "中景", "全景", "俯拍", "仰拍", "运镜", "慢镜头", "推镜", "拉镜", "环绕", "固定镜头"]

_COMPLIANCE_EXCLUDE = ["中文", "英文", "繁体"]


def _norm(t: str) -> str:
    return re.sub(r"\s+", "", (t or "").lower())


def _score_complete(content: str) -> float:
    """完整性 0-100：主体/场景/风格/镜头 四要素覆盖度"""
    c = _norm(content)
    dims = 0
    if any(w in c for w in SUBJECT_WORDS):
        dims += 1
    if any(w in c for w in SCENE_WORDS):
        dims += 1
    if any(w in c for w in STYLE_WORDS):
        dims += 1
    if any(w in c for w in SHOT_WORDS):
        dims += 1
    # 有具体描述词也视为有效内容
    if len(c) >= 20:
        dims = max(dims, 1)
    return round(dims / 4 * 100, 1)


def _score_compliance(content: str) -> float:
    """合规性 0-100：命中黑名单扣分；含联系方式类重罚"""
    c = _norm(content)
    hit = [w for w in BLACKLIST if w in c]
    if not hit:
        return 100.0
    # 联系方式/交易类重罚（扣 60），营销词轻罚（扣 30）
    heavy = [w for w in hit if w in ("微信", "qq", "qq号", "联系方式", "电话", "手机号", "私聊", "购买", "下单", "刷单")]
    score = 100 - (60 if heavy else 30) * min(len(hit), 2)
    return round(max(score, 0), 1)


def _score_producible(content: str) -> float:
    """生产适配 0-100：文本长度适中（30-800 字），超长/过短扣分"""
    n = len(_norm(content))
    if 30 <= n <= 800:
        return 100.0
    if 800 < n <= 1500:
        return round(70 - (n - 800) / 700 * 20, 1)
    if n > 1500:
        return round(max(50 - (n - 1500) / 500 * 10, 20), 1)
    return round(max(30 + n * 2, 10), 1)  # 过短（<30 字）


def _score_text_quality(content: str) -> float:
    """文本质量 0-100：乱码/重复/异常符号检测"""
    c = _norm(content)
    score = 100.0
    if re.search(r"[�]|\\u[0-9a-f]{4}", content):
        score -= 40
    if re.search(r"(.)\1{8,}", c):  # 单字重复 9 次+
        score -= 30
    if content.count("，") > 30 or content.count(".") > 30:
        score -= 20
    if len(set(c)) < max(5, len(c) * 0.3):  # 字符多样性过低
        score -= 25
    return round(max(score, 0), 1)


async def _score_ai_consistency(name: str, category: str, content: str, timeout_s: float = 30.0) -> float:
    """AI 一致性 0-100（可选）：提示词与名称/分类是否匹配（本地 Ollama）"""
    try:
        from ollama_client import ollama_chat
        sys_prompt = (
            "你是提示词质检员。判断给定提示词与名称、分类是否一致，输出一个 0-100 的整数分数。"
            "分数规则：高度匹配 80-100；部分相关 50-79；明显不符 0-49。只输出数字。"
        )
        user = f"名称：{name or ''}\n分类：{category or ''}\n提示词：{(content or '')[:400]}"
        result = await ollama_chat([
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user},
        ], function="word_quality", temperature=0.2, timeout_s=timeout_s, think=False)
        raw = (result or {}).get("content") if isinstance(result, dict) else ""
        m = re.search(r"\d{1,3}", str(raw or ""))
        if m:
            return max(0, min(100, int(m.group(0))))
    except Exception:
        pass
    return 0.0


def _ensure_table():
    db = get_db()
    try:
        db.execute("""CREATE TABLE IF NOT EXISTS word_card_quality (
            word_card_id INTEGER PRIMARY KEY,
            score REAL DEFAULT 0,
            complete REAL DEFAULT 0,
            compliance REAL DEFAULT 0,
            producible REAL DEFAULT 0,
            text_quality REAL DEFAULT 0,
            ai_consistency REAL DEFAULT 0,
            report TEXT DEFAULT '{}',
            checked_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        safe_commit()
    finally:
        db.close()


def score_one(card: dict, use_ai: bool = False) -> dict:
    """单卡评分：返回维度分 + 总分 + 报告"""
    content = card.get("content") or card.get("content_detailed") or card.get("content_zh") or ""
    name = card.get("name") or ""
    category = card.get("category") or card.get("module") or ""
    complete = _score_complete(content)
    compliance = _score_compliance(content)
    producible = _score_producible(content)
    text_quality = _score_text_quality(content)
    ai = 0.0
    # 权重：完整 0.30 / 合规 0.25 / 生产 0.20 / 文本 0.15 / AI 0.10
    score = round(0.30 * complete + 0.25 * compliance + 0.20 * producible + 0.15 * text_quality + 0.10 * ai, 1)
    report = {
        "complete": complete, "compliance": compliance, "producible": producible,
        "text_quality": text_quality, "ai_consistency": ai,
        "issues": [],
    }
    if complete < 60:
        report["issues"].append("要素不全（主体/场景/风格/镜头缺失）")
    if compliance < 100:
        report["issues"].append("命中敏感/营销词，需检查")
    if producible < 60:
        report["issues"].append("文本长度不适配生产")
    if text_quality < 60:
        report["issues"].append("文本质量异常（乱码/重复）")
    return {"score": score, "report": report}


def check_cards(card_ids, use_ai: bool = False) -> dict:
    """批量质检：评分 + 落库（可选 AI 一致性，串行调用本地 Ollama）"""
    _ensure_table()
    db = get_db()
    try:
        results = []
        for cid in card_ids:
            row = db.execute("SELECT id, name, content, content_detailed, content_zh, category, module FROM word_card WHERE id=?", [cid]).fetchone()
            if not row:
                continue
            card = dict(row) if hasattr(row, "keys") else {
                "id": row[0], "name": row[1], "content": row[2], "content_detailed": row[3],
                "content_zh": row[4], "category": row[5], "module": row[6]}
            res = score_one(card)
            if use_ai:
                res["report"]["ai_consistency"] = _score_ai_consistency(
                    card.get("name"), card.get("category") or card.get("module"), card.get("content") or "")
                res["score"] = round(0.30 * res["report"]["complete"] + 0.25 * res["report"]["compliance"]
                                     + 0.20 * res["report"]["producible"] + 0.15 * res["report"]["text_quality"]
                                     + 0.10 * res["report"]["ai_consistency"], 1)
                res["report"]["ai_consistency"] = round(res["report"]["ai_consistency"], 1)
            db.execute(
                "INSERT INTO word_card_quality (word_card_id, score, complete, compliance, producible, text_quality, ai_consistency, report, checked_at) "
                "VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime')) "
                "ON CONFLICT(word_card_id) DO UPDATE SET score=excluded.score, complete=excluded.complete, "
                "compliance=excluded.compliance, producible=excluded.producible, text_quality=excluded.text_quality, "
                "ai_consistency=excluded.ai_consistency, report=excluded.report, checked_at=excluded.checked_at",
                [cid, res["score"], res["report"]["complete"], res["report"]["compliance"],
                 res["report"]["producible"], res["report"]["text_quality"], res["report"]["ai_consistency"],
                 json.dumps(res["report"], ensure_ascii=False)])
            results.append({"id": cid, "name": card.get("name"), "score": res["score"], "report": res["report"]})
        safe_commit()
        results.sort(key=lambda x: -x["score"])
        return {"total": len(results), "results": results}
    finally:
        db.close()


def list_quality(limit: int = 200, min_score: float = 0.0, keyword: str = "") -> dict:
    """评分排序视图：高分优先"""
    _ensure_table()
    db = get_db()
    try:
        sql = ("SELECT q.*, w.name, w.category, w.module FROM word_card_quality q "
               "JOIN word_card w ON w.id=q.word_card_id WHERE q.score >= ?")
        args = [min_score]
        if keyword:
            sql += " AND (w.name LIKE ? OR w.content LIKE ?)"
            args += [f"%{keyword}%", f"%{keyword}%"]
        sql += " ORDER BY q.score DESC LIMIT ?"
        args.append(limit)
        rows = db.execute(sql, args).fetchall()
        out = []
        for r in rows:
            d = dict(r) if hasattr(r, "keys") else {
                "word_card_id": r[0], "score": r[1], "complete": r[2], "compliance": r[3],
                "producible": r[4], "text_quality": r[5], "ai_consistency": r[6], "report": r[7],
                "checked_at": r[8], "name": r[9], "category": r[10], "module": r[11]}
            try:
                d["report"] = json.loads(d.get("report") or "{}")
            except Exception:
                d["report"] = {}
            out.append(d)
        return {"total": len(out), "items": out}
    finally:
        db.close()
