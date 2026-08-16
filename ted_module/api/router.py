# -*- coding: utf-8 -*-
"""需求分析 API 路由（独立 router，仅挂载到本模块独立服务）"""
import json

from fastapi import APIRouter, Body, File, Form, HTTPException, Query, UploadFile

from db import get_conn, init_db, row_to_dict
from services import compliance_service, import_service, plan_service, score_service

router = APIRouter(prefix="/api/ted", tags=["ted"])


@router.get("/health")
def health():
    init_db()
    return {"ok": True, "module": "需求分析", "version": "1.0.0",
            "network": "offline-only", "data_source": "manual-upload-only"}


# ============ 上传与录入 ============

@router.post("/upload")
def upload_snapshot(
    file: UploadFile = File(...),
    source_type: str = Form("excel"),
    version_name: str = Form(""),
    uploaded_by: str = Form(""),
    note: str = Form(""),
):
    """人工上传指数快照（Excel/CSV）。source_type: excel | csv（默认按扩展名识别）"""
    if not file.filename:
        raise HTTPException(400, "未选择文件")
    try:
        result = import_service.import_snapshot(
            file, file.filename, source_type, version_name, uploaded_by, note)
        return {"ok": True, **result}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/announcements")
def create_announcement(data: dict = Body(...)):
    """官方公告人工录入（人工粘贴内容与来源说明，无自动获取）"""
    title = (data.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "标题必填")
    aid = import_service.add_announcement(
        title, data.get("content") or "", data.get("publish_date") or "",
        data.get("source_hint") or "", data.get("entered_by") or "")
    return {"ok": True, "id": aid}


# ============ 数据查询 ============

@router.get("/versions")
def list_versions(limit: int = Query(50, ge=1, le=200)):
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM snapshot_versions ORDER BY id DESC LIMIT ?", [limit]).fetchall()
        return {"ok": True, "versions": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.get("/versions/{vid}/records")
def version_records(vid: int, limit: int = Query(200, ge=1, le=1000)):
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM raw_records WHERE version_id=? ORDER BY id LIMIT ?", [vid, limit]).fetchall()
        return {"ok": True, "records": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.get("/announcements")
def list_announcements(limit: int = Query(50, ge=1, le=200)):
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM announcements ORDER BY id DESC LIMIT ?", [limit]).fetchall()
        return {"ok": True, "announcements": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.get("/upload-logs")
def upload_logs(limit: int = Query(50, ge=1, le=200)):
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM upload_logs ORDER BY id DESC LIMIT ?", [limit]).fetchall()
        return {"ok": True, "logs": [dict(r) for r in rows]}
    finally:
        conn.close()


# ============ 分析 ============

@router.post("/analyze/{version_id}")
def analyze(version_id: int, sales_version_id: int = Query(0)):
    """清洗聚类 → 归一化 → 评分 → 四池划分 → 落库
    sales_version_id: 可选，合并销售记录版本（按题材匹配注入真实销量信号）"""
    try:
        result = score_service.analyze_version(version_id, sales_version_id)
        return {"ok": True, **result}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/pools")
def pools(version_id: int = Query(0)):
    """题材池结果（默认最新已分析版本）"""
    conn = get_conn()
    try:
        if not version_id:
            row = conn.execute(
                "SELECT id FROM snapshot_versions WHERE status='analyzed' ORDER BY id DESC LIMIT 1").fetchone()
            if not row:
                raise HTTPException(404, "暂无已分析版本，请先上传并运行分析")
            version_id = row["id"]
        rows = conn.execute(
            "SELECT p.*, t.display_name, t.aliases, m.works_count, m.sheet_count FROM theme_pools p "
            "JOIN themes t ON t.id=p.theme_id "
            "LEFT JOIN (SELECT version_id, theme_id, works_count, COUNT(*) AS sheet_count FROM theme_metrics GROUP BY version_id, theme_id) m "
            "ON m.theme_id=p.theme_id AND m.version_id=p.version_id "
            "WHERE p.version_id=? ORDER BY p.rank_no", [version_id]).fetchall()
        ver = conn.execute("SELECT * FROM snapshot_versions WHERE id=?", [version_id]).fetchone()
        result = {"ok": True, "version_id": version_id,
                  "version_name": ver["name"] if ver else "",
                  "pools": {}}
        for r in rows:
            d = dict(r)
            d["aliases"] = json.loads(d.get("aliases") or "[]")
            result["pools"].setdefault(d["pool_type"], []).append(d)
        return result
    finally:
        conn.close()


# ============ 研判工作台 ============

@router.get("/themes")
def themes(keyword: str = Query(""), limit: int = Query(200, ge=1, le=1000)):
    conn = get_conn()
    try:
        sql = "SELECT * FROM themes WHERE 1=1"
        args = []
        if keyword:
            sql += " AND (display_name LIKE ? OR aliases LIKE ?)"
            args += [f"%{keyword}%", f"%{keyword}%"]
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        rows = conn.execute(sql, args).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["aliases"] = json.loads(d.get("aliases") or "[]")
            out.append(d)
        return {"ok": True, "themes": out}
    finally:
        conn.close()


@router.post("/research")
def create_research(data: dict = Body(...)):
    """考察台账新增"""
    theme_id = data.get("theme_id") or 0
    if not theme_id:
        raise HTTPException(400, "theme_id 必填")
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO research_records (theme_id, version_id, research_date, researcher, conclusion, evidence, risk_points, decision) "
            "VALUES (?,?,?,?,?,?,?,?)",
            [theme_id, data.get("version_id") or 0, data.get("research_date") or "",
             data.get("researcher") or "", data.get("conclusion") or "",
             data.get("evidence") or "", data.get("risk_points") or "",
             data.get("decision") or "待定"])
        conn.commit()
        return {"ok": True, "id": cur.lastrowid}
    finally:
        conn.close()


@router.get("/research")
def list_research(theme_id: int = Query(0), limit: int = Query(100, ge=1, le=500)):
    conn = get_conn()
    try:
        sql = "SELECT * FROM research_records WHERE 1=1"
        args = []
        if theme_id:
            sql += " AND theme_id=?"
            args.append(theme_id)
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        rows = conn.execute(sql, args).fetchall()
        return {"ok": True, "records": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.post("/risks")
def create_risk(data: dict = Body(...)):
    """风险记录新增"""
    theme_id = data.get("theme_id") or 0
    if not theme_id:
        raise HTTPException(400, "theme_id 必填")
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO risk_records (theme_id, risk_type, risk_level, description, mitigation) VALUES (?,?,?,?,?)",
            [theme_id, data.get("risk_type") or "", data.get("risk_level") or "中",
             data.get("description") or "", data.get("mitigation") or ""])
        conn.commit()
        return {"ok": True, "id": cur.lastrowid}
    finally:
        conn.close()


@router.get("/risks")
def list_risks(theme_id: int = Query(0), limit: int = Query(100, ge=1, le=500)):
    conn = get_conn()
    try:
        sql = "SELECT * FROM risk_records WHERE 1=1"
        args = []
        if theme_id:
            sql += " AND theme_id=?"
            args.append(theme_id)
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        rows = conn.execute(sql, args).fetchall()
        return {"ok": True, "records": [dict(r) for r in rows]}
    finally:
        conn.close()


# ============ 规划书 ============

@router.post("/plan/generate")
def generate_plan(version_id: int = Body(..., embed=True), generated_by: str = Body("", embed=True)):
    try:
        pid = plan_service.generate_plan(version_id, generated_by)
        return {"ok": True, "plan_id": pid}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/plan/{pid}")
def get_plan(pid: int):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM plan_documents WHERE id=?", [pid]).fetchone()
        if not row:
            raise HTTPException(404, "规划书不存在")
        return {"ok": True, "plan": dict(row)}
    finally:
        conn.close()


@router.get("/plans")
def list_plans(limit: int = Query(50, ge=1, le=200)):
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM plan_documents ORDER BY id DESC LIMIT ?", [limit]).fetchall()
        return {"ok": True, "plans": [dict(r) for r in rows]}
    finally:
        conn.close()


# ============ 合规自检 ============

@router.get("/compliance/selfcheck")
def selfcheck():
    """合规自检：证明模块无外网请求/无浏览器自动化/无定时任务"""
    report = compliance_service.compliance_report()
    return {"ok": True, "report": report}
