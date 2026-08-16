# -*- coding: utf-8 -*-
"""导入服务：解析人工上传的 Excel/CSV 快照，写入独立库并留痕。

合规声明：本模块只读取【人工上传到本机】的静态文件，不发起任何网络请求。
"""
import csv
import json
import os
import re
import time

from db import get_conn, init_db, row_to_dict, save_upload_file, sha256_file

# 支持的中文/英文列名映射
COLUMN_MAP = {
    "theme": ["题材", "主题", "素材题材", "题材名", "主题词", "theme", "topic", "subject", "名称", "题材名称"],
    "demand": ["需求指数", "需求", "需求分", "指数", "demand", "demand_index", "需求热度"],
    "opportunity": ["机会指数", "机会", "机会分", "opportunity", "opportunity_index", "机会度"],
    "sales": ["销量", "销售数量", "数量", "sales", "qty", "sales_qty", "成交数"],
    "revenue": ["销售额", "销售额(元)", "销售金额", "金额", "revenue", "amount", "成交额"],
    "rank": ["排名", "榜单位次", "位次", "rank", "ranking", "名次"],
}


def _norm_header(h: str) -> str:
    return re.sub(r"[\s（）()【】\[\]：:]+", "", (h or "").strip().lower())


def _match_column(headers, key):
    """按列名映射找到目标列下标；返回 -1 表示未找到"""
    norm_headers = [_norm_header(h) for h in headers]
    for cand in COLUMN_MAP[key]:
        c = _norm_header(cand)
        if c in norm_headers:
            return norm_headers.index(c)
    return -1


def _to_float(v):
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("，", "").replace("%", "")
    if s in ("", "-", "--", "N/A", "null", "None"):
        return 0.0
    try:
        return float(s)
    except Exception:
        return 0.0


def _to_int(v):
    return int(_to_float(v))


def parse_excel(path: str):
    """解析人工 Excel 快照 → [(theme, demand, opp, sales, revenue, rank), ...]"""
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not rows:
        return []
    headers = [str(h) if h is not None else "" for h in rows[0]]
    idx = {
        "theme": _match_column(headers, "theme"),
        "demand": _match_column(headers, "demand"),
        "opportunity": _match_column(headers, "opportunity"),
        "sales": _match_column(headers, "sales"),
        "revenue": _match_column(headers, "revenue"),
        "rank": _match_column(headers, "rank"),
    }
    out = []
    for r in rows[1:]:
        if not r or all(v is None or str(v).strip() == "" for v in r):
            continue
        theme = str(r[idx["theme"]]).strip() if idx["theme"] >= 0 and idx["theme"] < len(r) else ""
        if not theme:
            continue
        out.append({
            "theme_raw": theme,
            "demand_index": _to_float(r[idx["demand"]]) if idx["demand"] >= 0 else 0.0,
            "opportunity_index": _to_float(r[idx["opportunity"]]) if idx["opportunity"] >= 0 else 0.0,
            "sales_qty": _to_float(r[idx["sales"]]) if idx["sales"] >= 0 else 0.0,
            "revenue": _to_float(r[idx["revenue"]]) if idx["revenue"] >= 0 else 0.0,
            "rank_no": _to_int(r[idx["rank"]]) if idx["rank"] >= 0 else 0,
        })
    return out


def parse_csv(path: str):
    """解析人工 CSV 快照（自动探测编码 UTF-8/GBK）"""
    data = None
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            with open(path, "r", encoding=enc, newline="") as f:
                data = list(csv.reader(f))
            break
        except Exception:
            continue
    if data is None:
        raise ValueError("CSV 编码无法识别（支持 UTF-8 / GBK）")
    if not data:
        return []
    headers = [str(h) if h is not None else "" for h in data[0]]
    idx = {
        "theme": _match_column(headers, "theme"),
        "demand": _match_column(headers, "demand"),
        "opportunity": _match_column(headers, "opportunity"),
        "sales": _match_column(headers, "sales"),
        "revenue": _match_column(headers, "revenue"),
        "rank": _match_column(headers, "rank"),
    }
    out = []
    for r in data[1:]:
        if not r or all(str(v).strip() == "" for v in r):
            continue
        theme = str(r[idx["theme"]]).strip() if idx["theme"] >= 0 and idx["theme"] < len(r) else ""
        if not theme:
            continue
        out.append({
            "theme_raw": theme,
            "demand_index": _to_float(r[idx["demand"]]) if idx["demand"] >= 0 else 0.0,
            "opportunity_index": _to_float(r[idx["opportunity"]]) if idx["opportunity"] >= 0 else 0.0,
            "sales_qty": _to_float(r[idx["sales"]]) if idx["sales"] >= 0 else 0.0,
            "revenue": _to_float(r[idx["revenue"]]) if idx["revenue"] >= 0 else 0.0,
            "rank_no": _to_int(r[idx["rank"]]) if idx["rank"] >= 0 else 0,
        })
    return out


def import_snapshot(file, file_name: str, source_type: str, version_name: str,
                    uploaded_by: str = "", note: str = "") -> dict:
    """人工上传快照入库：保存文件 → 解析 → 写 raw_records + snapshot_versions → 留痕"""
    init_db()
    ext = os.path.splitext(file_name)[1].lower()
    dest_name = f"{int(time.time())}_{file_name.replace(os.sep, '_')}"
    path = save_upload_file(file, dest_name)
    fhash = sha256_file(path)

    try:
        if source_type == "csv" or ext == ".csv":
            records = parse_csv(path)
        else:
            records = parse_excel(path)
    except Exception as e:
        _log_upload(file_name, source_type, 0, 0, 0, str(e), fhash, uploaded_by)
        raise ValueError(f"文件解析失败：{e}")

    if not records:
        _log_upload(file_name, source_type, 0, 0, 0, "无有效数据行（请检查表头：题材/需求指数/机会指数/销量/销售额/排名）",
                    fhash, uploaded_by)
        raise ValueError("未解析到有效数据行，请检查表头命名（支持：题材/需求指数/机会指数/销量/销售额/排名）")

    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO snapshot_versions (name, source_type, file_name, file_hash, rows_count, status, uploaded_by, note) "
            "VALUES (?,?,?,?,?,?,?,?)",
            [version_name or file_name, source_type, file_name, fhash, len(records), "imported", uploaded_by, note])
        vid = cur.lastrowid
        for r in records:
            conn.execute(
                "INSERT INTO raw_records (version_id, theme_raw, demand_index, opportunity_index, sales_qty, revenue, rank_no) "
                "VALUES (?,?,?,?,?,?,?)",
                [vid, r["theme_raw"], r["demand_index"], r["opportunity_index"],
                 r["sales_qty"], r["revenue"], r["rank_no"]])
        conn.commit()
        _log_upload(file_name, source_type, len(records), len(records), 0, "", fhash, uploaded_by)
        return {"version_id": vid, "rows": len(records), "file_hash": fhash[:16]}
    finally:
        conn.close()


def _log_upload(file_name, source_type, rows_total, rows_ok, rows_fail, errors, fhash, uploaded_by):
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO upload_logs (file_name, source_type, rows_total, rows_ok, rows_fail, errors, file_hash, uploaded_by) "
            "VALUES (?,?,?,?,?,?,?,?)",
            [file_name, source_type, rows_total, rows_ok, rows_fail, errors[:500], fhash, uploaded_by])
        conn.commit()
    finally:
        conn.close()


def add_announcement(title: str, content: str, publish_date: str = "",
                     source_hint: str = "", entered_by: str = "") -> int:
    """官方公告人工录入（人工粘贴，无任何自动获取）"""
    init_db()
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO announcements (title, content, publish_date, source_hint, entered_by) VALUES (?,?,?,?,?)",
            [title, content, publish_date, source_hint, entered_by])
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()
