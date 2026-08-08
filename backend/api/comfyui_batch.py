"""
ComfyUI 批量生成任务队列（Phase 3.5 自 api/comfyui.py 拆分）
依赖主模块工具函数通过函数内延迟导入（避免模块加载循环）。
路由挂载: 主模块 router.include_router(comfyui_batch_router)，prefix 同为 /api/v2/comfyui
"""
import asyncio
import copy
import json
import threading

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from database import get_db, safe_commit

router = APIRouter(tags=["comfyui-batch"])

class BatchGenerateRequest(BaseModel):
    prompt_ids: list[int]
    workflow_id: str = ""
    preset_id: int = 0           # 可选：参数预设（应用到全部卡片）
    param_values: dict = {}      # 可选：参数值（步数/CFG/尺寸/采样器等）
    style_suffix: str = ""      # 可选：品质后缀（空=不加后缀，省略=默认后缀）
    use_module_preset: int = 1   # 0=忽略模块主体预设



# ==================== 批量生成任务队列 ====================

# 全局批量并发锁：同一时刻只允许 1 个批量任务执行（其余排队），防止大量任务叠加提交 ComfyUI 卡死
_BATCH_GLOBAL_LOCK = threading.Lock()


class BatchTaskCreate(BaseModel):
    prompt_ids: list[int]
    workflow_id: str = ""
    preset_id: int = 0
    param_values: dict = {}
    style_suffix: str = ""
    use_module_preset: int = 1
    prompt_overrides: dict = {}   # {prompt_id: 优化后提示词}（Ollama 优化结果覆盖）
    card_type_map: dict = {}     # {prompt_id: 'word_card'|'prompts'} 前端按数据源显式标注，避免 id 重叠猜错表
    engine: str = "comfyui"      # comfyui / dreamina / libtv
    manual_text: str = ""         # 手动附加文本（追加到每条组合提示词末尾）
    # dreamina 引擎参数
    model_version: str = "5.0"
    ratio: str = "1:1"
    resolution_type: str = "2k"
    width: int = 0
    height: int = 0
    # libtv 引擎参数
    project_uuid: str = ""        # LibTV 目标画布
    libtv_model: str = "Z-image Turbo"
    libtv_ratio: str = "1:1"


def _ensure_batch_task_table():
    db = get_db()
    db.execute("""CREATE TABLE IF NOT EXISTS comfyui_batch_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT DEFAULT '',
        workflow_name TEXT DEFAULT '',
        model_type TEXT DEFAULT '',
        prompt_ids TEXT DEFAULT '[]',
        total INTEGER DEFAULT 0,
        status TEXT DEFAULT 'queued',
        success INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        current_index INTEGER DEFAULT 0,
        current_prompt TEXT DEFAULT '',
        results TEXT DEFAULT '[]',
        error TEXT DEFAULT '',
        style_suffix TEXT DEFAULT '',
        use_module_preset INTEGER DEFAULT 1,
        preset_id INTEGER DEFAULT 0,
        param_values TEXT DEFAULT '{}',
        prompt_overrides TEXT DEFAULT '{}',
        engine TEXT DEFAULT 'comfyui',
        manual_text TEXT DEFAULT '',
        model_version TEXT DEFAULT '5.0',
        ratio TEXT DEFAULT '1:1',
        resolution_type TEXT DEFAULT '2k',
        width INTEGER DEFAULT 0,
        height INTEGER DEFAULT 0,
        card_type_map TEXT DEFAULT '{}',
        project_uuid TEXT DEFAULT '',
        libtv_model TEXT DEFAULT 'Z-image Turbo',
        libtv_ratio TEXT DEFAULT '1:1',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        started_at TEXT DEFAULT '',
        finished_at TEXT DEFAULT ''
    )""")
    # 兼容旧表：补列
    cols = [r["name"] for r in db.execute("PRAGMA table_info(comfyui_batch_tasks)").fetchall()]
    for _col, _ddl in [("prompt_overrides", "prompt_overrides TEXT DEFAULT '{}'"),
                       ("engine", "engine TEXT DEFAULT 'comfyui'"),
                       ("manual_text", "manual_text TEXT DEFAULT ''"),
                       ("model_version", "model_version TEXT DEFAULT '5.0'"),
                       ("ratio", "ratio TEXT DEFAULT '1:1'"),
                       ("resolution_type", "resolution_type TEXT DEFAULT '2k'"),
                       ("width", "width INTEGER DEFAULT 0"),
                       ("height", "height INTEGER DEFAULT 0"),
                       ("card_type_map", "card_type_map TEXT DEFAULT '{}'"),
                       ("project_uuid", "project_uuid TEXT DEFAULT ''"),
                       ("libtv_model", "libtv_model TEXT DEFAULT 'Z-image Turbo'"),
                       ("libtv_ratio", "libtv_ratio TEXT DEFAULT '1:1'")]:
        if _col not in cols:
            db.execute(f"ALTER TABLE comfyui_batch_tasks ADD COLUMN {_ddl}")
    safe_commit()


def _batch_update(task_id: int, **kw):
    """更新任务字段（独立连接，避免与执行线程连接冲突）"""
    try:
        db = get_db()
        sets = [f"{k}=?" for k in kw]
        db.execute(f"UPDATE comfyui_batch_tasks SET {', '.join(sets)} WHERE id=?",
                   list(kw.values()) + [task_id])
        safe_commit()
    except Exception as e:
        print(f"[Batch] 任务更新失败: {e}")


def _batch_worker(task_id: int):
    from api.comfyui import (  # noqa: F401 (延迟导入打破循环)
        DEFAULT_STYLE_SUFFIX,
        _apply_params,
        _compose_prompt,
        _detect_model_type,
        _find_workflow_v2,
        _get_config,
        _get_module_presets,
        _run_comfyui,
    )
    """后台执行批量任务：全局锁串行，逐条生成并写入进度（不依赖 SSE 连接存活）"""
    with _BATCH_GLOBAL_LOCK:
        try:
            db = get_db()
            row = db.execute("SELECT * FROM comfyui_batch_tasks WHERE id=?", [task_id]).fetchone()
            if not row:
                return
            d = dict(row)
            if d["status"] == "cancelled":
                return
            prompt_ids = json.loads(d["prompt_ids"] or "[]")
            total = len(prompt_ids)
            engine = d.get("engine") or "comfyui"
            # 前端显式标注的数据源类型映射（{prompt_id: 'word_card'|'prompts'}）
            # 2026-08-06 修复：id 在 prompts/word_card 两表重叠时（如旧数据 id 81-130），
            # 不能再靠"先查 prompts 猜表"——用户从词卡视图勾选会被误写进 prompts 链路
            try:
                card_type_map = json.loads(d.get("card_type_map") or "{}")
            except Exception:
                card_type_map = {}
            cfg = _get_config()
            server_url = ""
            workflow_cfg = None
            workflow_template = None
            if engine == "comfyui":
                server_url = cfg.get("server_url", "").rstrip("/")
                if not server_url:
                    _batch_update(task_id, status="error", error="未配置服务器地址", finished_at=_now_str())
                    return
                workflow_cfg, wf_err = _find_workflow_v2(d.get("workflow_id") or "")
                if not workflow_cfg:
                    _batch_update(task_id, status="error", error=wf_err or "未找到工作流", finished_at=_now_str())
                    return
                workflow_template = workflow_cfg["workflow_json"]
            presets = _get_module_presets()
            preset_params = []
            if d.get("preset_id"):
                try:
                    prow = db.execute("SELECT params_json FROM comfyui_workflow_presets WHERE id=?", [d["preset_id"]]).fetchone()
                    if prow:
                        preset_params = json.loads(prow["params_json"])
                except Exception:
                    preset_params = []
            param_values = json.loads(d.get("param_values") or "{}")
            user_size = any(str(k).endswith(".width") or str(k).endswith(".height") for k in (param_values or {}))
            suffix = d.get("style_suffix") if d.get("style_suffix") is not None else DEFAULT_STYLE_SUFFIX
            use_preset = d.get("use_module_preset", 1) != 0
            model_type = _detect_model_type(workflow_template) if workflow_template else ""
            results = []
            success = 0
            failed = 0
            _batch_update(task_id, status="running", started_at=_now_str(), current_index=0,
                          current_prompt="准备中...", success=0, failed=0, results="[]")
            for idx, pid in enumerate(prompt_ids):
                # 取消检查
                chk = db.execute("SELECT status FROM comfyui_batch_tasks WHERE id=?", [task_id]).fetchone()
                if not chk or chk["status"] == "cancelled":
                    _batch_update(task_id, status="cancelled", finished_at=_now_str())
                    return
                # 兼容两种数据源：prompts / word_card
                # 优先使用前端显式标注的类型（解决 id 跨表重叠时猜错表）
                _ct = card_type_map.get(str(pid)) or card_type_map.get(pid) or ""
                if _ct == "word_card":
                    row2 = db.execute("SELECT content, module FROM word_card WHERE id=? AND is_deleted=0", [pid]).fetchone()
                    src_table = "word_card"
                elif _ct == "prompts":
                    row2 = db.execute("SELECT content, module FROM prompts WHERE id=?", [pid]).fetchone()
                    src_table = "prompts"
                else:
                    # 旧任务/未标注：保持原猜测逻辑
                    row2 = db.execute("SELECT content, module FROM prompts WHERE id=?", [pid]).fetchone()
                    src_table = "prompts"
                    if not row2:
                        row2 = db.execute("SELECT content, module FROM word_card WHERE id=? AND is_deleted=0", [pid]).fetchone()
                        src_table = "word_card"
                if not row2:
                    failed += 1
                    results.append({"prompt_id": pid, "ok": False, "error": "提示词不存在", "prompt_text": ""})
                    _batch_update(task_id, current_index=idx + 1, success=success, failed=failed, results=json.dumps(results, ensure_ascii=False))
                    continue
                card_text = row2["content"]
                # Ollama 优化结果覆盖（prompt_overrides）
                try:
                    overrides = json.loads(d.get("prompt_overrides") or "{}")
                except Exception:
                    overrides = {}
                if str(pid) in overrides and overrides[str(pid)]:
                    card_text = overrides[str(pid)]
                module_name = row2["module"] or ""
                preset_text = ""
                if use_preset and module_name:
                    pm = presets.get(module_name, {})
                    if pm.get("enabled") and pm.get("preset"):
                        preset_text = pm["preset"]
                final_prompt = _compose_prompt(preset_text, card_text, suffix)
                # 手动附加文本追加到末尾
                _manual = (d.get("manual_text") or "").strip()
                if _manual:
                    final_prompt = (final_prompt.rstrip(", ") + ", " + _manual) if final_prompt else _manual
                _batch_update(task_id, current_index=idx + 1, current_prompt=final_prompt[:80])
                try:
                    if engine == "dreamina":
                        # 即梦引擎：CLI 文生图 → 下载 → 缩略图落库
                        from api.dreamina import dreamina_text2image
                        from api.thumb_gen import save_generated_image
                        dr = dreamina_text2image(final_prompt,
                                                 d.get("model_version") or "5.0",
                                                 d.get("ratio") or "1:1",
                                                 d.get("resolution_type") or "2k",
                                                 int(d.get("width") or 0), int(d.get("height") or 0), 1)
                        if not dr.get("ok"):
                            result = {"ok": False, "error": dr.get("error", "即梦生成失败")}
                        else:
                            with httpx.Client(timeout=120) as _cl:
                                _rr = _cl.get(dr["image_url"])
                                if _rr.status_code != 200:
                                    result = {"ok": False, "error": f"图片下载失败 HTTP {_rr.status_code}"}
                                else:
                                    saved = save_generated_image(_rr.content, pid, src_table, "dreamina", dr.get("submit_id", ""))
                                    if saved.get("ok"):
                                        result = {"ok": True, "thumbnail": saved["thumbnail"], "thumbnail_url": saved["thumbnail_url"]}
                                    else:
                                        result = {"ok": False, "error": saved.get("error", "落库失败")}
                    elif engine == "libtv":
                        # LibTV 引擎：CLI 文生图（node create --run）→ 下载 → 缩略图落库
                        from api.libtv import libtv_text2image
                        from api.thumb_gen import save_generated_image
                        lt = libtv_text2image(final_prompt,
                                              d.get("project_uuid") or "",
                                              d.get("libtv_model") or "Z-image Turbo",
                                              d.get("libtv_ratio") or "1:1")
                        if not lt.get("ok"):
                            result = {"ok": False, "error": lt.get("error", "LibTV 生成失败")}
                        else:
                            with httpx.Client(timeout=120) as _cl:
                                _rr = _cl.get(lt["image_url"])
                                if _rr.status_code != 200:
                                    result = {"ok": False, "error": f"图片下载失败 HTTP {_rr.status_code}"}
                                else:
                                    saved = save_generated_image(_rr.content, pid, src_table, "libtv", lt.get("node_key", ""))
                                    if saved.get("ok"):
                                        result = {"ok": True, "thumbnail": saved["thumbnail"], "thumbnail_url": saved["thumbnail_url"]}
                                    else:
                                        result = {"ok": False, "error": saved.get("error", "落库失败")}
                    else:
                        wf = copy.deepcopy(workflow_template)
                        if preset_params and param_values:
                            _apply_params(wf, preset_params, param_values)
                        if model_type == "sd15" and not user_size:
                            for _nid, _node in wf.items():
                                if _node.get("class_type") == "EmptyLatentImage":
                                    _ins = _node.get("inputs", {}) or {}
                                    _w, _h = _ins.get("width"), _ins.get("height")
                                    if isinstance(_w, (int, float)) and isinstance(_h, (int, float)) and (_w >= 1024 or _h >= 1024):
                                        _ins["width"] = 512
                                        _ins["height"] = 512
                                        break
                        result = asyncio.run(_run_comfyui(server_url, wf, workflow_cfg, final_prompt, pid, src_table))
                    if result.get("ok"):
                        success += 1
                    else:
                        failed += 1
                    results.append({
                        "prompt_id": pid, "ok": result.get("ok", False),
                        "thumbnail": result.get("thumbnail", ""),
                        "thumbnail_url": result.get("thumbnail_url", ""),
                        "error": result.get("error", ""),
                        "prompt_text": final_prompt[:80],
                    })
                except Exception as e:
                    failed += 1
                    results.append({"prompt_id": pid, "ok": False, "error": str(e)[:200], "prompt_text": final_prompt[:80]})
                _batch_update(task_id, current_index=idx + 1, success=success, failed=failed,
                              results=json.dumps(results, ensure_ascii=False))
            _batch_update(task_id, status="done", success=success, failed=failed,
                          current_index=total, current_prompt="",
                          results=json.dumps(results, ensure_ascii=False), finished_at=_now_str())
        except Exception as e:
            _batch_update(task_id, status="error", error=str(e)[:300], finished_at=_now_str())
            print(f"[Batch] 任务 {task_id} 异常: {e}")


def _now_str():
    import datetime as _dt
    return _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@router.post("/batch-tasks")
def create_batch_task(data: BatchTaskCreate):
    from api.comfyui import (  # noqa: F401 (延迟导入打破循环)
        _detect_model_type,
        _find_workflow_v2,
        _get_config,
    )
    """创建批量生成任务（立即返回 task_id，后台线程执行，支持进度查询/取消/恢复）"""
    _ensure_batch_task_table()
    if not data.prompt_ids:
        return {"ok": False, "error": "未选择任何词条"}
    cfg = _get_config()
    if not cfg.get("enabled") or not cfg.get("server_url"):
        return {"ok": False, "error": "ComfyUI 未启用或服务器地址未配置"}
    db = get_db()
    engine = data.engine or "comfyui"
    wf_name = ""
    model_type = ""
    # 2026-08-08: 自动跳过已生成缩略图的词卡（避免重复生成/重复入队）
    ctm = data.card_type_map or {}
    filtered_ids = []
    skipped_existing = 0
    for _pid in data.prompt_ids:
        _ct = ctm.get(str(_pid)) or ctm.get(_pid) or ""
        if _ct == "word_card":
            _row = db.execute("SELECT thumbnail FROM word_card WHERE id=? AND is_deleted=0", [_pid]).fetchone()
            _has = bool(_row and _row["thumbnail"])
        elif _ct == "prompts":
            # prompts 旧表无 thumbnail 列，缩略图存 prompt_thumbnails 关联表
            _row = db.execute("SELECT 1 FROM prompt_thumbnails WHERE prompt_id=? AND media_type='image'", [_pid]).fetchone()
            _has = bool(_row)
        else:
            _row = db.execute("SELECT thumbnail FROM word_card WHERE id=? AND is_deleted=0", [_pid]).fetchone()
            _has = bool(_row and _row["thumbnail"])
            if not _has:
                _row = db.execute("SELECT 1 FROM prompt_thumbnails WHERE prompt_id=? AND media_type='image'", [_pid]).fetchone()
                _has = bool(_row)
        if _has:
            skipped_existing += 1
            continue
        filtered_ids.append(_pid)
    if not filtered_ids:
        return {"ok": False, "error": f"所选 {skipped_existing} 张词卡均已生成缩略图，无需重复生成"}
    data.prompt_ids = filtered_ids
    if engine == "comfyui":
        workflow_cfg, wf_err = _find_workflow_v2(data.workflow_id)
        if workflow_cfg:
            wf_name = workflow_cfg.get("name", "") or ""
            model_type = _detect_model_type(workflow_cfg["workflow_json"])
        elif not data.workflow_id:
            return {"ok": False, "error": "请先选择生成工作流"}
    cur = db.execute(
        """INSERT INTO comfyui_batch_tasks
           (workflow_id, workflow_name, model_type, prompt_ids, total, status,
            style_suffix, use_module_preset, preset_id, param_values, prompt_overrides,
            engine, manual_text, model_version, ratio, resolution_type, width, height, card_type_map,
            project_uuid, libtv_model, libtv_ratio)
           VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        [data.workflow_id, wf_name, model_type, json.dumps(data.prompt_ids), len(data.prompt_ids),
         data.style_suffix, data.use_module_preset, data.preset_id,
         json.dumps(data.param_values or {}, ensure_ascii=False),
         json.dumps(data.prompt_overrides or {}, ensure_ascii=False),
         engine, data.manual_text or "", data.model_version or "5.0", data.ratio or "1:1",
         data.resolution_type or "2k", data.width or 0, data.height or 0,
         json.dumps(data.card_type_map or {}, ensure_ascii=False),
         data.project_uuid or "", data.libtv_model or "Z-image Turbo", data.libtv_ratio or "1:1"])
    safe_commit()
    task_id = cur.lastrowid
    threading.Thread(target=_batch_worker, args=(task_id,), daemon=True).start()
    return {"ok": True, "task_id": task_id, "total": len(data.prompt_ids), "skipped": skipped_existing,
            "status": "queued", "workflow_name": wf_name, "model_type": model_type}


@router.get("/batch-tasks")
def list_batch_tasks(limit: int = Query(20, ge=1, le=100)):
    """批量任务列表（含运行中/排队/历史）"""
    _ensure_batch_task_table()
    db = get_db()
    rows = db.execute("SELECT * FROM comfyui_batch_tasks ORDER BY id DESC LIMIT ?", [limit]).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        try:
            d["prompt_ids"] = json.loads(d["prompt_ids"] or "[]")
        except Exception:
            d["prompt_ids"] = []
        try:
            d["results"] = json.loads(d["results"] or "[]")
        except Exception:
            d["results"] = []
        items.append(d)
    return {"ok": True, "items": items, "total": len(items)}


@router.get("/batch-tasks/{task_id}")
def get_batch_task(task_id: int):
    """查询单个任务进度（断线恢复/监督轮询）"""
    _ensure_batch_task_table()
    db = get_db()
    row = db.execute("SELECT * FROM comfyui_batch_tasks WHERE id=?", [task_id]).fetchone()
    if not row:
        return {"ok": False, "error": "任务不存在"}
    d = dict(row)
    try:
        d["prompt_ids"] = json.loads(d["prompt_ids"] or "[]")
    except Exception:
        d["prompt_ids"] = []
    try:
        d["results"] = json.loads(d["results"] or "[]")
    except Exception:
        d["results"] = []
    return {"ok": True, "task": d}


@router.post("/batch-tasks/{task_id}/cancel")
def cancel_batch_task(task_id: int):
    """取消任务（worker 在下一张前检查标志退出）"""
    _ensure_batch_task_table()
    db = get_db()
    row = db.execute("SELECT status FROM comfyui_batch_tasks WHERE id=?", [task_id]).fetchone()
    if not row:
        return {"ok": False, "error": "任务不存在"}
    if row["status"] in ("done", "cancelled", "error"):
        return {"ok": True, "status": row["status"]}
    db.execute("UPDATE comfyui_batch_tasks SET status='cancelled' WHERE id=?", [task_id])
    safe_commit()
    return {"ok": True, "status": "cancelled"}


@router.post("/batch-tasks/{task_id}/retry-failed")
def retry_batch_failed(task_id: int):
    """重试失败项：创建新任务（仅失败词条）"""
    _ensure_batch_task_table()
    db = get_db()
    row = db.execute("SELECT * FROM comfyui_batch_tasks WHERE id=?", [task_id]).fetchone()
    if not row:
        return {"ok": False, "error": "任务不存在"}
    d = dict(row)
    try:
        results = json.loads(d["results"] or "[]")
    except Exception:
        results = []
    failed_ids = [r["prompt_id"] for r in results if not r.get("ok")]
    if not failed_ids:
        return {"ok": False, "error": "没有失败项可重试"}
    cur = db.execute(
        """INSERT INTO comfyui_batch_tasks
           (workflow_id, workflow_name, model_type, prompt_ids, total, status,
            style_suffix, use_module_preset, preset_id, param_values, prompt_overrides,
            engine, manual_text, model_version, ratio, resolution_type, width, height, card_type_map,
            project_uuid, libtv_model, libtv_ratio)
           VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        [d["workflow_id"], d["workflow_name"] + " (重试)", d["model_type"],
         json.dumps(failed_ids), len(failed_ids),
         d["style_suffix"], d["use_module_preset"], d["preset_id"], d["param_values"],
         d.get("prompt_overrides") or "{}",
         d.get("engine") or "comfyui", d.get("manual_text") or "", d.get("model_version") or "5.0",
         d.get("ratio") or "1:1", d.get("resolution_type") or "2k",
         int(d.get("width") or 0), int(d.get("height") or 0),
         d.get("card_type_map") or "{}",
         d.get("project_uuid") or "", d.get("libtv_model") or "Z-image Turbo", d.get("libtv_ratio") or "1:1"])
    safe_commit()
    new_id = cur.lastrowid
    threading.Thread(target=_batch_worker, args=(new_id,), daemon=True).start()
    return {"ok": True, "task_id": new_id, "total": len(failed_ids), "failed_ids": failed_ids}



@router.post("/batch-generate")
async def batch_generate_thumbnail(data: BatchGenerateRequest):
    from api.comfyui import (  # noqa: F401 (延迟导入打破循环)
        DEFAULT_STYLE_SUFFIX,
        _apply_params,
        _compose_prompt,
        _detect_model_type,
        _find_workflow,
        _find_workflow_v2,
        _get_config,
        _get_module_presets,
        _run_comfyui,
    )
    """批量 AI 生成缩略图 — 逐条排队发送到 ComfyUI，SSE 流式返回，每生成一张即刻推送
    工作流来自工作流库（comfyui_workflows 表），支持参数预设注入与 SD1.5 默认 512 兜底
    """
    cfg = _get_config()
    if not cfg.get("enabled") or not cfg.get("server_url"):
        return {"ok": False, "error": "ComfyUI 未启用或服务器地址未配置"}
    if not data.prompt_ids:
        return {"ok": False, "error": "未选择任何词条"}

    # 工作流库优先（新架构），兼容旧 config 数组
    workflow_cfg, wf_err = _find_workflow_v2(data.workflow_id)
    if not workflow_cfg:
        old_cfg, _ = _find_workflow(cfg, data.workflow_id)
        if not old_cfg or not old_cfg.get("workflow_json"):
            return {"ok": False, "error": wf_err or "未找到工作流模板，请先在「工作流库」中导入或同步工作流"}
        workflow_cfg = {
            "workflow_json": old_cfg["workflow_json"],
            "prompt_node_id": old_cfg.get("prompt_node_id", "6"),
            "prompt_field": old_cfg.get("prompt_field", "text"),
            "image_output_node_id": old_cfg.get("image_output_node_id", "9"),
            "id": data.workflow_id or old_cfg.get("id", ""),
        }

    server_url = cfg["server_url"].rstrip("/")
    workflow_template = workflow_cfg["workflow_json"]
    presets = _get_module_presets()
    total = len(data.prompt_ids)
    model_type = _detect_model_type(workflow_template)
    wf_name = workflow_cfg.get("name", "") or ""

    # 参数预设注入（可选）：先加载 preset 参数定义
    preset_params = []
    if data.preset_id:
        try:
            prow = get_db().execute("SELECT params_json FROM comfyui_workflow_presets WHERE id=?", [data.preset_id]).fetchone()
            if prow:
                preset_params = json.loads(prow["params_json"])
        except Exception:
            preset_params = []
    user_size = False
    for _k in (data.param_values or {}):
        if str(_k).endswith(".width") or str(_k).endswith(".height"):
            user_size = True
            break

    async def event_stream():
        success_count = 0
        error_count = 0
        db = get_db()
        # 起始事件：工作流信息 + 总数，供前端展示提示
        yield f"data: {json.dumps({'start': True, 'total': total, 'workflow_name': wf_name, 'model_type': model_type}, ensure_ascii=False)}\n\n"

        for idx, pid in enumerate(data.prompt_ids):
            # 兼容两种数据源：prompts（旧词条）与 word_card（新词卡）
            row = db.execute("SELECT content, module FROM prompts WHERE id=?", [pid]).fetchone()
            if not row:
                row = db.execute("SELECT content, module FROM word_card WHERE id=? AND is_deleted=0", [pid]).fetchone()
            if not row:
                ev = {"prompt_id": pid, "ok": False, "error": "提示词不存在", "index": idx, "total": total, "done": idx + 1}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                error_count += 1
                continue

            card_text = row["content"]
            module_name = row["module"] or ""
            preset_text = ""
            if data.use_module_preset != 0 and module_name:
                pm = presets.get(module_name, {})
                if pm.get("enabled") and pm.get("preset"):
                    preset_text = pm["preset"]
            # 品质后缀：显式传空=不加；未传字段默认使用 DEFAULT_STYLE_SUFFIX
            suffix = DEFAULT_STYLE_SUFFIX
            if data.style_suffix is not None:
                suffix = data.style_suffix
            final_prompt = _compose_prompt(preset_text, card_text, suffix)

            wf = copy.deepcopy(workflow_template)
            # 参数预设注入（与单张生成一致）
            if preset_params and data.param_values:
                _apply_params(wf, preset_params, data.param_values or {})
            # SD1.5 默认 512 兜底：模板越界且用户未显式设置
            if model_type == "sd15" and not user_size:
                for _nid, _node in wf.items():
                    if _node.get("class_type") == "EmptyLatentImage":
                        _ins = _node.get("inputs", {}) or {}
                        _w, _h = _ins.get("width"), _ins.get("height")
                        if isinstance(_w, (int, float)) and isinstance(_h, (int, float)) and (_w >= 1024 or _h >= 1024):
                            _ins["width"] = 512
                            _ins["height"] = 512
                            break

            try:
                result = await _run_comfyui(server_url, wf, workflow_cfg, final_prompt, pid)
                if result.get("ok"):
                    success_count += 1
                else:
                    error_count += 1
                ev = {"prompt_id": pid, "ok": result.get("ok", False), "thumbnail": result.get("thumbnail"),
                      "thumbnail_url": result.get("thumbnail_url"), "error": result.get("error"),
                      "prompt_text": final_prompt[:60],
                      "index": idx, "total": total, "done": idx + 1,
                      "progress": round((idx + 1) / total * 100)}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            except Exception as e:
                ev = {"prompt_id": pid, "ok": False, "error": str(e), "prompt_text": card_text[:60],
                      "index": idx, "total": total, "done": idx + 1, "progress": round((idx + 1) / total * 100)}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                error_count += 1

            await asyncio.sleep(0.3)

        # 完成事件
        final = {"complete": True, "total": total, "success": success_count, "errors": error_count}
        yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
