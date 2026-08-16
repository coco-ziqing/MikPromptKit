# -*- coding: utf-8 -*-
"""题材清洗、同义词聚类、数据归一化（纯本地字符串/数值运算）"""
import difflib
import json
import re

# 内置同义词词典（可扩展）：规范名 -> [别名...]
SYNONYM_DICT = {
    "城市夜景": ["城市夜景", "都市夜景", "夜景城市", "城市灯光夜景"],
    "古风人物": ["古风人物", "古装人物", "汉服人物", "国风人物"],
    "科技感": ["科技感", "未来科技", "赛博", "科技风", "数字科技"],
    "自然风光": ["自然风光", "风景", "山水风光", "自然风景", "户外风光"],
    "美食": ["美食", "食物", "美食特写", "甜品", "料理"],
    "萌宠": ["萌宠", "宠物", "猫咪", "小狗", "猫狗"],
    "国潮": ["国潮", "国风潮流", "新中式"],
    "治愈系": ["治愈系", "治愈", "温暖治愈"],
    "AI动画": ["AI动画", "动画风格", "动漫风", "二次元"],
    "短视频特效": ["短视频特效", "特效视频", "视觉特效"],
}

_STOP_WORDS = {"一个", "这个", "那个", "素材", "视频", "图片", "主题", "题材", "风格", "高清", "超清"}


def normalize(text: str) -> str:
    """归一化：全半角、空白、大小写、去停用词"""
    if not text:
        return ""
    s = str(text)
    # 全角转半角
    s = "".join(chr(0xFF01 + ord(c) - 0xFF01) if "\uFF01" <= c <= "\uFF5E" else c for c in s)
    s = s.replace("\u3000", " ").replace("　", "")
    s = re.sub(r"\s+", "", s)
    s = s.lower()
    return s.strip()


def clean_theme(raw: str) -> str:
    """题材名清洗：去括号内容、去前后缀、去停用词"""
    s = normalize(raw)
    s = re.sub(r"[（(].*?[)）]", "", s)          # 去括号注释
    s = re.sub(r"[【\[].*?[\]】]", "", s)        # 去方括号标签
    for w in _STOP_WORDS:
        s = s.replace(w, "")
    return s.strip()


def lookup_synonym(cleaned: str) -> str:
    """同义词词典命中 → 返回规范名；未命中返回原文"""
    for canon, aliases in SYNONYM_DICT.items():
        if cleaned == normalize(canon):
            return canon
        for a in aliases:
            if cleaned == normalize(a):
                return canon
    return cleaned


def fuzzy_cluster_key(cleaned: str, existing_keys, threshold=0.82) -> str:
    """模糊聚类：与已存在题材键做编辑距离相似度匹配，命中返回已有键"""
    for key in existing_keys:
        r = difflib.SequenceMatcher(None, cleaned, key).ratio()
        if r >= threshold:
            return key
    return cleaned


def cluster_records(records):
    """聚类：records = [{theme_raw, ...}] → {theme_key: [record,...]}
    规则：清洗 → 同义词词典 → 模糊聚类（按出现顺序建键）"""
    groups = {}
    order = []
    for rec in records:
        cleaned = clean_theme(rec.get("theme_raw", ""))
        if not cleaned:
            continue
        canon = lookup_synonym(cleaned)
        key = fuzzy_cluster_key(canon, order)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(rec)
    return groups, order


def minmax_normalize(values):
    """min-max 归一化到 0-100（全 0 时返回 0）"""
    vals = [v for v in values if v]
    if not vals:
        return [0.0] * len(values)
    lo, hi = min(vals), max(vals)
    if hi <= lo:
        return [100.0 if v > 0 else 0.0 for v in values]
    return [round((v - lo) / (hi - lo) * 100, 2) for v in values]


def aggregate_metrics(groups, order, version_id):
    """按聚类结果聚合题材指标（均值），并做 min-max 归一化"""
    metrics = []
    for key in order:
        recs = groups[key]
        n = len(recs)
        demand = sum(r.get("demand_index", 0) or 0 for r in recs) / n
        opp = sum(r.get("opportunity_index", 0) or 0 for r in recs) / n
        sales = sum(r.get("sales_qty", 0) or 0 for r in recs)
        revenue = sum(r.get("revenue", 0) or 0 for r in recs)
        metrics.append({
            "theme_key": key,
            "display_name": key,
            "aliases": sorted({clean_theme(r.get("theme_raw", "")) for r in recs} - {key}),
            "demand_raw": round(demand, 2),
            "opportunity_raw": round(opp, 2),
            "sales_qty": round(sales, 2),
            "revenue": round(revenue, 2),
            "record_count": n,
        })
    # 归一化（按版本内题材集合）
    demand_norm = minmax_normalize([m["demand_raw"] for m in metrics])
    opp_norm = minmax_normalize([m["opportunity_raw"] for m in metrics])
    for i, m in enumerate(metrics):
        m["demand_index"] = demand_norm[i]
        m["opportunity_index"] = opp_norm[i]
    return metrics
