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
import threading
import time

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel

try:
    from database import get_db, safe_commit
except Exception:
    from ..database import get_db, safe_commit

from jwt_auth import get_current_user

from .style_suits import _db as _suit_db
from .card_gen import _card_gen_worker, _create_tasks, _team_guard

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
            # v5.50.21: task_ids 兼容 [{task_id, part}]（v5.49.0+）与 [int]（旧）
            id_list = []
            for x in d["task_ids"]:
                if isinstance(x, dict):
                    id_list.append(int(x.get("task_id") or 0))
                else:
                    id_list.append(int(x))
            if id_list:
                q = ",".join("?" * len(id_list))
                rows = c.execute(
                    f"SELECT id, task_type, prompt, status, progress, fail_category, error, result_filename FROM card_gen_tasks WHERE id IN ({q})",
                    id_list,
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


def _build_prompt(cfg: dict, rune_cards: list, base_ref: dict, rune_texts: list = None) -> str:
    """组装最终提示词 — seeDream @图像N 参考图规范（v5.50.22）
    结构: [参考引用段] + [风格词条段] + [符文词条段（词卡+手动文本）] + [约束段]
    """
    words = cfg.get("style_words", {}) or {}
    pos = (words.get("positive") or "").strip()
    parts = []
    # ① 参考引用段：基底图 @图像1（锁角色外观）
    base_desc = (base_ref or {}).get("desc") or ""
    if base_ref and (base_ref.get("url") or base_ref.get("file_path")):
        ref_usage = "参考@图像1作为角色外观参考"
        if base_desc:
            ref_usage += f"（{base_desc}）"
        ref_usage += "，严格保持角色外貌、服装、发型一致"
        parts.append(ref_usage)
    # ② 风格词条段（模板固定正向画风词）
    if pos:
        parts.append(pos)
    # ③ 符文词条段（词卡 + 手动文本叠加）
    for card in rune_cards:
        content = (card.get("content") or card.get("content_zh") or "").strip()
        if content:
            parts.append(content)
    for txt in (rune_texts or []):
        t = str(txt or "").strip()
        if t:
            parts.append(t)
    # ④ 约束兜底（防变形/物理规律）
    parts.append("人物比例符合现实世界物理规律，构图完整，细节清晰")
    return "，".join(parts) if parts else ""


def _build_negative_prompt(cfg: dict) -> str:
    """取套装负面词"""
    words = cfg.get("style_words", {}) or {}
    return (words.get("negative") or "").strip()


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
        # 4. 生成参数合法性（按通道适配校验）
        try:
            ttype = OUTPUT_PARTS.get(parts[0], {}).get("task_type", "text2image")
            params = dict(cfg.get("render_params") or {})
            params.update(draft["config_override"].get("render_params") or {})
            _validate_params_light(ttype, params, draft["channel"])
        except HTTPException as e:
            issues.append({"level": "error", "code": "bad_param", "msg": str(e.detail)})
        # 5. 通道参数映射提示（非阻塞）
        try:
            adapted, hints = _channel_adapt_params(draft["channel"], ttype, params)
            for h in hints:
                issues.append({"level": "warn", "code": "channel_adapt", "msg": h})
        except Exception:
            pass
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


def _validate_params_light(ttype: str, params: dict, channel: str = "virtual"):
    """轻量参数校验：仅检查必填字段与取值范围（避免完整引擎校验的强依赖）
    channel: virtual(即梦) 用即梦约束；real(ComfyUI) 放宽模型版本约束（工作流自定义）
    """
    if ttype in ("text2image", "image2image"):
        if channel != "real":
            model = str(params.get("model_version") or "5.0")
            if model not in ("3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"):
                raise HTTPException(400, f"无效模型版本 {model}")
        ratio = str(params.get("ratio") or "1:1")
        if ratio not in ("21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"):
            raise HTTPException(400, f"无效比例 {ratio}")
        res = str(params.get("resolution_type") or "2k")
        if res not in ("1k", "2k", "4k"):
            raise HTTPException(400, f"无效分辨率 {res}")


# ==================== 双通道参数映射（v5.50.0） ====================

# 写实商用通道（ComfyUI）参数映射表：将套装通用参数映射为 ComfyUI 工作流参数
_REAL_CHANNEL_RATIO_MAP = {
    "21:9": "1344x576", "16:9": "1216x832", "3:2": "1216x832",
    "4:3": "896x1152", "1:1": "1024x1024", "3:4": "896x1152",
    "2:3": "832x1216", "9:16": "832x1216",
}

_REAL_CHANNEL_RES_MAP = {
    "1k": "1024", "2k": "2048", "4k": "4096",
}


def _channel_adapt_params(channel: str, ttype: str, params: dict):
    """按通道适配参数，返回 (适配后参数, 提示列表)
    virtual(即梦): 直接使用，无需适配
    real(ComfyUI): 分辨率/比例映射为工作流尺寸，采样器/步数对齐
    """
    hints = []
    if channel != "real":
        return params, hints
    adapted = dict(params)
    # 比例 → 工作流尺寸
    ratio = str(params.get("ratio") or "1:1")
    size = _REAL_CHANNEL_RATIO_MAP.get(ratio)
    if size:
        adapted["real_size"] = size
        hints.append(f"写实通道：比例 {ratio} → 工作流尺寸 {size}")
    # 分辨率 → 基础边长
    res = str(params.get("resolution_type") or "2k")
    base = _REAL_CHANNEL_RES_MAP.get(res)
    if base:
        adapted["real_base"] = base
        hints.append(f"写实通道：分辨率 {res} → 基础边长 {base}px")
    # 采样器对齐（ComfyUI 常用名）
    sampler = str(params.get("sampler") or "").strip()
    if sampler and sampler not in ("euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "uni_pc"):
        adapted["sampler"] = "dpmpp_2m"
        hints.append(f"写实通道：采样器 {sampler} → dpmpp_2m（ComfyUI 兼容）")
    # 模型版本说明
    model = str(params.get("model_version") or "5.0")
    adapted["real_model_note"] = f"ComfyUI 工作流模型由节点配置决定（套装标记 {model} 仅供参考）"
    hints.append("写实通道：模型由 ComfyUI 工作流节点决定，套装模型标记不生效")
    return adapted, hints


# ==================== 批量渲染编排 ====================

class RenderSubmit(BaseModel):
    draft_id: int
    license_info: dict = {}
    engine: str = "dreamina"  # v5.50.7: 生成平台（dreamina/comfyui）
    rune_texts: list[str] = []  # v5.50.22: 手动文本词条（不落草稿表，提交时直接传）
    params: dict = {}  # v5.50.30: 提交前用户参数覆盖（model_version/ratio/resolution_type）


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
        prompt = _build_prompt(cfg, rune_cards, base, data.rune_texts)
        params = dict(cfg.get("render_params") or {})
        params.update(draft["config_override"].get("render_params") or {})
        # v5.50.30: 提交时用户显式参数覆盖（最高优先级，前端参数弹窗选择）
        if isinstance(data.params, dict):
            for pk, pv in data.params.items():
                if pv is not None and str(pv).strip() != "":
                    params[pk] = pv
        if not params.get("model_version"):
            params["model_version"] = "5.0"
        if not params.get("ratio"):
            params["ratio"] = "1:1"
        if not params.get("resolution_type"):
            params["resolution_type"] = "2k"
        # v5.50.0: 双通道参数适配（real→ComfyUI 工作流参数映射）
        try:
            params, adapt_hints = _channel_adapt_params(draft["channel"], "text2image", params)
        except Exception:
            adapt_hints = []
        params["prompt"] = prompt
        params["channel_hints"] = adapt_hints
        # v5.50.28: 基底图作为参考图传入任务（source_image → _create_tasks → 提交时 --image）
        if base.get("file_path"):
            params["source_image"] = base["file_path"]
        elif base.get("original_file_path"):
            params["source_image"] = base["original_file_path"]
        # v5.50.22: 负面词独立传递
        neg = _build_negative_prompt(cfg)
        if neg:
            params["negative_prompt"] = neg
        # v5.50.7: 生成平台引擎写入（_create_tasks 落 engine 列）
        engine = (data.engine or "dreamina").strip()
        if engine not in ("dreamina", "comfyui"):
            engine = "dreamina"
        params["engine"] = engine
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
                # v5.49.0: task_ids 存对象数组 [{task_id, part}]，归档可还原配件名
                task_ids.append({"task_id": out[0]["task_id"], "part": part})
                # v5.50.30: 建任务后立即起 worker（否则任务卡 queued 直到服务重启被 resume 接管）
                threading.Thread(target=_card_gen_worker, args=(out[0]["task_id"],), daemon=True).start()
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
        # v5.50.24: task_ids 兼容对象数组 [{task_id, part}]（v5.49.0+）与纯 id 列表（旧）
        raw_ids = json.loads(r["task_ids"] or "[]")
        task_ids = [x["task_id"] if isinstance(x, dict) else x for x in raw_ids]
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
