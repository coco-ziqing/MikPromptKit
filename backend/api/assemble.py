# -*- coding: utf-8 -*-
"""
角色组装 API — v5.47.0 链路验证版
能力：装配记录 CRUD / 生成前校验 / 批量生成编排（复用 card_gen 任务链路）/ 批次查询
设计：套装 config_json 五 Tab → 组装提示词 + 渲染参数 → render_batch → card_gen_tasks 入队
      worker 由 card_gen 既有串行链路执行，本模块只做编排层（不新造生成引擎）
"""
import json
import os
import sqlite3
import time

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel

try:
    from database import get_db, safe_commit
except Exception:
    from ..database import get_db, safe_commit

from jwt_auth import get_current_user

from .style_suits import _db as _suit_db
from .card_gen import _create_tasks, _team_guard

router = APIRouter(tags=["角色组装"])


def _auth(request, require=True):
    u = get_current_user(request)
    if require and not (u and u.get("authenticated")):
        raise HTTPException(401, "请先登录")
    return u


OUTPUT_PARTS = {
    "main": {"label": "主角色定图", "task_type": "text2image"},
    "three_view": {"label": "三视图", "task_type": "text2image"},
    "face": {"label": "面部特写", "task_type": "text2image"},
    "costume": {"label": "服饰特写", "task_type": "text2image"},
    "expressions": {"label": "表情合集", "task_type": "text2image"},
}


def _db():
    return _suit_db()


def _now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _draft_dict(r):
    return {
        "id": r["id"],
        "name": r["name"],
        "base_asset_ref": json.loads(r["base_asset_ref"] or "{}"),
        "rune_card_ids": json.loads(r["rune_card_ids"] or "[]"),
        "suit_id": r["suit_id"],
        "accessory_list": json.loads(r["accessory_list"] or "[]"),
        "channel": r["channel"],
        "config_override": json.loads(r["config_override"] or "{}"),
        "status": r["status"],
        "owner_user_id": r["owner_user_id"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


def _batch_dict(r, with_tasks=False):
    d = {
        "id": r["id"],
        "draft_id": r["draft_id"],
        "suit_id": r["suit_id"],
        "channel": r["channel"],
        "status": r["status"],
        "total": r["total"],
        "done": r["done"],
        "fail": r["fail"],
        "task_ids": json.loads(r["task_ids"] or "[]"),
        "license_info": json.loads(r["license_info"] or "{}"),
        "created_by": r["created_by"],
        "created_at": r["created_at"],
        "finished_at": r["finished_at"],
    }
    if with_tasks and d["task_ids"]:
        c = _db()
        try:
            q = ",".join("?" * len(d["task_ids"]))
            rows = c.execute(
                f"SELECT id, task_type, prompt, status, progress, fail_category, error, result_filename FROM card_gen_tasks WHERE id IN ({q})",
                d["task_ids"],
            ).fetchall()
            d["tasks"] = [dict(x) for x in rows]
        finally:
            c.close()
    return d


def _load_suit_config(c, suit_id: int) -> dict:
    r = c.execute("SELECT config_json FROM style_suit WHERE id=? AND is_deleted=0", [suit_id]).fetchone()
    if not r:
        raise HTTPException(404, "套装不存在")
    return json.loads(r["config_json"] or "{}")


def _load_word_cards(c, card_ids: list) -> list:
    if not card_ids:
        return []
    q = ",".join("?" * len(card_ids))
    rows = c.execute(f"SELECT id, name, content, content_zh FROM word_card WHERE id IN ({q}) AND is_deleted=0", card_ids).fetchall()
    return [dict(x) for x in rows]


def _build_prompt(cfg: dict, rune_cards: list, base_ref: dict) -> str:
    """组装最终提示词：套装正向词 + 符文词卡内容 + 基底描述"""
    parts = []
    words = cfg.get("style_words", {}) or {}
    pos = (words.get("positive") or "").strip()
    if pos:
        parts.append(pos)
    for card in rune_cards:
        content = (card.get("content") or card.get("content_zh") or "").strip()
        if content:
            parts.append(content)
    if base_ref and base_ref.get("desc"):
        parts.append(f"人物基底参考：{base_ref['desc']}")
    return "\n".join(parts) if parts else ""


def _resolve_output_parts(cfg: dict, accessory_list: list) -> list:
    """视图资产 = 模板配置默认产出 + 视图资产选配临时增减"""
    parts = list(cfg.get("output_parts") or ["main"])
    for acc in accessory_list:
        p = acc.get("part") if isinstance(acc, dict) else acc
        if p and p not in parts:
            parts.append(p)
    return parts


# ==================== Pydantic ====================

class DraftSave(BaseModel):
    name: str = ""
    base_asset_ref: dict = {}
    rune_card_ids: list[int] = []
    suit_id: int = 0
    accessory_list: list = []
    channel: str = "virtual"
    config_override: dict = {}


# ==================== 草稿 CRUD ====================

@router.post("/api/assemble/draft")
def save_draft(data: DraftSave, request: Request):
    """保存/更新装配草稿（会话级临时装配，不改原套装）"""
    u = _auth(request)
    if data.channel not in ("virtual", "real"):
        raise HTTPException(400, "风控通道仅支持 virtual/real")
    c = _db()
    try:
        now = _now()
        uid = u.get("id") if u else None
        # 同用户同名草稿视为更新
        exist = c.execute(
            "SELECT id FROM assemble_draft WHERE name=? AND owner_user_id=? AND status='draft'",
            [data.name or "默认草稿", uid],
        ).fetchone()
        if exist:
            c.execute(
                """UPDATE assemble_draft SET base_asset_ref=?, rune_card_ids=?, suit_id=?, accessory_list=?,
                   channel=?, config_override=?, updated_at=? WHERE id=?""",
                [json.dumps(data.base_asset_ref, ensure_ascii=False),
                 json.dumps(data.rune_card_ids, ensure_ascii=False),
                 data.suit_id,
                 json.dumps(data.accessory_list, ensure_ascii=False),
                 data.channel,
                 json.dumps(data.config_override, ensure_ascii=False),
                 now, exist["id"]],
            )
            c.commit()
            r = c.execute("SELECT * FROM assemble_draft WHERE id=?", [exist["id"]]).fetchone()
            return {"ok": True, "item": _draft_dict(r), "updated": True}
        cur = c.execute(
            """INSERT INTO assemble_draft (name, base_asset_ref, rune_card_ids, suit_id, accessory_list, channel, config_override, status, owner_user_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            [data.name or "默认草稿",
             json.dumps(data.base_asset_ref, ensure_ascii=False),
             json.dumps(data.rune_card_ids, ensure_ascii=False),
             data.suit_id,
             json.dumps(data.accessory_list, ensure_ascii=False),
             data.channel,
             json.dumps(data.config_override, ensure_ascii=False),
             "draft", uid, now, now],
        )
        c.commit()
        r = c.execute("SELECT * FROM assemble_draft WHERE id=?", [cur.lastrowid]).fetchone()
        return {"ok": True, "item": _draft_dict(r), "updated": False}
    finally:
        c.close()


@router.get("/api/assemble/draft")
def list_drafts(request: Request):
    u = _auth(request)
    c = _db()
    try:
        rows = c.execute(
            "SELECT * FROM assemble_draft WHERE owner_user_id=? ORDER BY updated_at DESC",
            [u.get("id") if u else None],
        ).fetchall()
        return {"ok": True, "items": [_draft_dict(r) for r in rows]}
    finally:
        c.close()


@router.get("/api/assemble/draft/{draft_id}")
def get_draft(draft_id: int, request: Request):
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM assemble_draft WHERE id=?", [draft_id]).fetchone()
        if not r:
            raise HTTPException(404, "草稿不存在")
        return {"ok": True, "item": _draft_dict(r)}
    finally:
        c.close()


@router.delete("/api/assemble/draft/{draft_id}")
def delete_draft(draft_id: int, request: Request):
    _auth(request)
    c = _db()
    try:
        c.execute("DELETE FROM assemble_draft WHERE id=?", [draft_id])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


# ==================== 渲染前校验 ====================

@router.post("/api/assemble/precheck")
def assemble_precheck(request: Request, draft_id: int = Body(..., embed=True)):
    """渲染前置校验：基底必填 / 至少一个产出项 / 写实通道授权 / 参数合法性"""
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM assemble_draft WHERE id=?", [draft_id]).fetchone()
        if not r:
            raise HTTPException(404, "草稿不存在")
        draft = _draft_dict(r)
        issues = []
        # 1. 基底素材必填
        base = draft["base_asset_ref"] or {}
        if not base.get("id") and not base.get("url"):
            issues.append({"level": "error", "code": "no_base", "msg": "基底卡槽必填：请拖入/选择真人参考素材"})
        # 2. 至少一个产出项
        if draft["suit_id"]:
            cfg = _load_suit_config(c, draft["suit_id"])
        else:
            cfg = {}
        parts = _resolve_output_parts(cfg, draft["accessory_list"])
        if not parts:
            issues.append({"level": "error", "code": "no_output", "msg": "至少选择一个产出配件（主图/三视图/特写/表情）"})
        # 3. 写实通道授权（授权信息随渲染提交传入，草稿本身不存）
        license_info = {}
        if draft["channel"] == "real" and not license_info.get("authorized"):
            issues.append({"level": "error", "code": "no_license", "msg": "写实商用通道必须完成授权备案"})
        # 4. 渲染参数合法性（复用 card_gen 的 _validate_params 校验首个产出项）
        try:
            ttype = OUTPUT_PARTS.get(parts[0], {}).get("task_type", "text2image")
            params = dict(cfg.get("render_params") or {})
            params.update(draft["config_override"].get("render_params") or {})
            _validate_params_light(ttype, params)
        except HTTPException as e:
            issues.append({"level": "error", "code": "bad_param", "msg": str(e.detail)})
        ok = not any(i["level"] == "error" for i in issues)
        return {"ok": True, "passed": ok, "issues": issues, "summary": {
            "base": bool(base.get("id") or base.get("url")),
            "rune_cards": len(draft["rune_card_ids"]),
            "suit_id": draft["suit_id"],
            "output_parts": parts,
            "channel": draft["channel"],
        }}
    finally:
        c.close()


def _validate_params_light(ttype: str, params: dict):
    """轻量参数校验：仅检查必填字段与取值范围（避免完整引擎校验的强依赖）"""
    if ttype in ("text2image", "image2image"):
        model = str(params.get("model_version") or "5.0")
        if model not in ("3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"):
            raise HTTPException(400, f"无效模型版本 {model}")
        ratio = str(params.get("ratio") or "1:1")
        if ratio not in ("21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"):
            raise HTTPException(400, f"无效比例 {ratio}")
        res = str(params.get("resolution_type") or "2k")
        if res not in ("1k", "2k", "4k"):
            raise HTTPException(400, f"无效分辨率 {res}")


# ==================== 批量渲染编排 ====================

class RenderSubmit(BaseModel):
    draft_id: int
    license_info: dict = {}


@router.post("/api/assemble/render")
def submit_render(data: RenderSubmit, request: Request):
    """提交批量渲染：校验 → 建 render_batch → 逐产出项入队 card_gen_tasks（复用 worker 串行执行）"""
    u = _auth(request)
    _team_guard(request)  # 团队模式前置
    c = _db()
    try:
        r = c.execute("SELECT * FROM assemble_draft WHERE id=?", [data.draft_id]).fetchone()
        if not r:
            raise HTTPException(404, "草稿不存在")
        draft = _draft_dict(r)
        # 预检
        base = draft["base_asset_ref"] or {}
        if not base.get("id") and not base.get("url"):
            raise HTTPException(400, "基底素材必填")
        cfg = _load_suit_config(c, draft["suit_id"]) if draft["suit_id"] else {}
        parts = _resolve_output_parts(cfg, draft["accessory_list"])
        if not parts:
            raise HTTPException(400, "至少选择一个产出配件")
        if draft["channel"] == "real" and not data.license_info.get("authorized"):
            raise HTTPException(400, "写实商用通道必须完成授权备案")
        # 组装提示词 + 渲染参数（套装配置 + 会话级覆盖）
        rune_cards = _load_word_cards(c, draft["rune_card_ids"])
        prompt = _build_prompt(cfg, rune_cards, base)
        params = dict(cfg.get("render_params") or {})
        params.update(draft["config_override"].get("render_params") or {})
        if not params.get("model_version"):
            params["model_version"] = "5.0"
        if not params.get("ratio"):
            params["ratio"] = "1:1"
        if not params.get("resolution_type"):
            params["resolution_type"] = "2k"
        params["prompt"] = prompt
        # 建批次
        now = _now()
        cur = c.execute(
            """INSERT INTO render_batch (draft_id, suit_id, channel, status, total, task_ids, license_info, created_by, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            [draft["id"], draft["suit_id"], draft["channel"], "queued",
             len(parts), "[]", json.dumps(data.license_info, ensure_ascii=False),
             u.get("id") if u else None, now],
        )
        batch_id = cur.lastrowid
        # 确保装配产物专用组存在（group_type='assemble'，不进词库视图）
        grp = c.execute("SELECT id FROM word_card_group WHERE group_key='assemble_产物' AND group_type='assemble'").fetchone()
        if not grp:
            cur = c.execute(
                "INSERT INTO word_card_group (name, group_key, group_type, is_active, created_at, updated_at) VALUES (?,?,?,1,?,?)",
                ["装配产物", "assemble_产物", "assemble", now, now],
            )
            grp_id = cur.lastrowid
        else:
            grp_id = grp["id"]
        # 逐产出项入队 card_gen_tasks（按配件 → 对应 task_type）
        task_ids = []
        for part in parts:
            ttype = OUTPUT_PARTS.get(part, {}).get("task_type", "text2image")
            # 文本生图无需真实词卡 id，用临时词卡（content=组装提示词），挂专用组不污染词库
            tmp = c.execute(
                """INSERT INTO word_card (group_id, name, content, is_deleted, created_at, updated_at)
                   VALUES (?, ?, ?, 0, ?, ?)""",
                [grp_id, f"装配-{draft['name']}-{part}", prompt, now, now],
            )
            c.commit()
            tmp_id = tmp.lastrowid
            try:
                out = _create_tasks([tmp_id], ttype, params, u)
            except HTTPException as e:
                c.execute("UPDATE word_card SET is_deleted=1, deleted_at=? WHERE id=?", [now, tmp_id])
                c.commit()
                raise e
            if out:
                task_ids.append(out[0]["task_id"])
        if not task_ids:
            c.execute("UPDATE render_batch SET status='fail', finished_at=? WHERE id=?", [now, batch_id])
            c.commit()
            raise HTTPException(400, "任务入队失败：请检查套装产出配置与渲染参数")
        c.execute(
            "UPDATE render_batch SET task_ids=?, status='running' WHERE id=?",
            [json.dumps(task_ids), batch_id],
        )
        c.commit()
        b = c.execute("SELECT * FROM render_batch WHERE id=?", [batch_id]).fetchone()
        return {"ok": True, "batch": _batch_dict(b, with_tasks=True)}
    finally:
        c.close()


@router.get("/api/assemble/render")
def list_render_batches(request: Request, limit: int = Query(50, le=200)):
    u = _auth(request)
    c = _db()
    try:
        rows = c.execute(
            "SELECT * FROM render_batch WHERE created_by=? ORDER BY id DESC LIMIT ?",
            [u.get("id") if u else None, limit],
        ).fetchall()
        return {"ok": True, "items": [_batch_dict(r, with_tasks=True) for r in rows]}
    finally:
        c.close()


@router.get("/api/assemble/render/{batch_id}")
def get_render_batch(batch_id: int, request: Request):
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM render_batch WHERE id=?", [batch_id]).fetchone()
        if not r:
            raise HTTPException(404, "批次不存在")
        return {"ok": True, "batch": _batch_dict(r, with_tasks=True)}
    finally:
        c.close()


@router.post("/api/assemble/render/{batch_id}/refresh")
def refresh_render_batch(batch_id: int, request: Request):
    """刷新批次统计（从 card_gen_tasks 实时聚合 done/fail）"""
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM render_batch WHERE id=?", [batch_id]).fetchone()
        if not r:
            raise HTTPException(404, "批次不存在")
        task_ids = json.loads(r["task_ids"] or "[]")
        done = fail = 0
        if task_ids:
            q = ",".join("?" * len(task_ids))
            for x in c.execute(f"SELECT status FROM card_gen_tasks WHERE id IN ({q})", task_ids).fetchall():
                if x["status"] in ("done", "success"):
                    done += 1
                elif x["status"] in ("fail", "error", "canceled"):
                    fail += 1
        status = r["status"]
        if done + fail >= len(task_ids) and len(task_ids) > 0:
            status = "done" if fail == 0 else "fail"
            c.execute("UPDATE render_batch SET status=?, done=?, fail=?, finished_at=? WHERE id=?",
                      [status, done, fail, _now(), batch_id])
        else:
            c.execute("UPDATE render_batch SET done=?, fail=? WHERE id=?", [done, fail, batch_id])
        c.commit()
        r2 = c.execute("SELECT * FROM render_batch WHERE id=?", [batch_id]).fetchone()
        return {"ok": True, "batch": _batch_dict(r2, with_tasks=True)}
    finally:
        c.close()
