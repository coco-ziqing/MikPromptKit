"""
ComfyUI 批量生成任务队列（Phase 3.5 自 api/comfyui.py 拆分）
依赖主模块工具函数通过函数内延迟导入（避免模块加载循环）。
路由挂载: 主模块 router.include_router(comfyui_batch_router)，prefix 同为 /api/v2/comfyui
"""
import asyncio
import copy
import json
import os
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

# ==================== 缩略图来源判定（2026-08-10 多维度综合，防手动预览图误判） ====================
# AI 生成链路（thumb_gen.save_generated_image）只写 data/thumbnails/
# 手动指定链路（word_cards 上传/图库复制）写 data/wc_media/thumbs/ + 同步副本到 thumbnails/
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AI_THUMB_DIR = os.path.join(_PROJECT_ROOT, "data", "thumbnails")
WC_THUMBS_DIR = os.path.join(_PROJECT_ROOT, "data", "wc_media", "thumbs")
_FILE_CACHE = {}

# media_assets.source → 生成引擎（2026-08-10 引擎维度判定）
SOURCE_TO_ENGINE = {
    "dreamina": "dreamina",
    "libtv": "libtv",
    "ai_generated": "comfyui",       # ComfyUI 批量/单张链路
    "comfyui_workflow": "comfyui",   # ComfyUI 工作流库链路
}


def _ensure_thumb_engine_col():
    """幂等迁移：word_card 加 thumb_engine 列（2026-08-10 起 AI 落库写入引擎）"""
    db = get_db()
    cols = [r["name"] for r in db.execute("PRAGMA table_info(word_card)").fetchall()]
    if "thumb_engine" not in cols:
        db.execute("ALTER TABLE word_card ADD COLUMN thumb_engine TEXT DEFAULT ''")
        safe_commit()


def thumb_engine_of(row, db) -> str:
    """缩略图生成引擎判定（word_card）：thumb_engine 列优先，其次 media_assets.filename JOIN source
    返回: 'comfyui' / 'dreamina' / 'libtv' / 'manual' / 'unknown'
    """
    fname = row["thumbnail"] or ""
    if not fname:
        return "unknown"
    st = thumb_state_of(row)
    if st == "manual":
        return "manual"
    try:
        col_eng = row["thumb_engine"] or ""
    except Exception:
        col_eng = ""
    if col_eng:
        return col_eng
    try:
        m = db.execute("SELECT source FROM media_assets WHERE filename=? LIMIT 1", [fname]).fetchone()
        if m:
            return SOURCE_TO_ENGINE.get(m["source"], "unknown")
    except Exception:
        pass
    return "unknown"


def _file_in(dirpath: str, fname: str) -> bool:
    """文件存在性检查（按 basename 缓存，全库扫描 290+ 张时避免重复 stat）"""
    key = dirpath + "|" + (fname or "")
    if key not in _FILE_CACHE:
        _FILE_CACHE[key] = bool(fname) and os.path.exists(os.path.join(dirpath, os.path.basename(fname)))
    return _FILE_CACHE[key]


def thumb_state_of(row) -> str:
    """word_card 行缩略图来源判定（§2.3 规则，按优先级防误判）
    返回: none / ai / manual / unknown
    - wc_media/thumbs/ 存在 → manual（最强：仅手动链路写此目录）
    - 仅 thumbnails/ 存在 → ai（兼容 AI 尺寸 + 0x0 历史数据）
    - 文件丢失退化尺寸指纹: 非 320x213 → ai；320x213 → manual；0x0 → unknown
    """
    fname = row["thumbnail"] or ""
    if not fname:
        return "none"
    in_ai = _file_in(AI_THUMB_DIR, fname)
    in_wc = _file_in(WC_THUMBS_DIR, fname)
    if in_wc:
        return "manual"
    if in_ai:
        return "ai"
    w = row["thumb_width"] or 0
    h = row["thumb_height"] or 0
    if w > 0:
        return "ai" if not (w == 320 and h == 213) else "manual"
    return "unknown"


def _active_queued_pids(db) -> set:
    """所有活跃任务（排队/运行中）中的词卡 id 集合（防重复入队，服务端兜底）"""
    rows = db.execute("SELECT prompt_ids FROM comfyui_batch_tasks WHERE status IN ('queued','running')").fetchall()
    s = set()
    for r in rows:
        try:
            s.update(json.loads(r["prompt_ids"] or "[]"))
        except Exception:
            pass
    return s


def _filter_pending_ids(ids: list, ctm: dict = None, db=None, engine: str = "") -> tuple:
    """完成态过滤（单一事实来源：batch-scan 与 create_batch_task 共用，防两端判定漂移）
    判定规则 §2.3：manual/unknown 不跳过（纳入生成）；ai 按引擎细分：
      - engine 非空且缩略图引擎 != 当前引擎（含未知）→ 其他引擎生成，纳入待处理
      - 否则 ai 视为完成跳过；prompts 旧表无引擎信息 → 视为完成
    返回 (pending_ids, stats)
    stats: {ai_skip, other_engine, manual_count, unknown_skip, missing_skip, queued_skip, pending}
    """
    ctm = ctm or {}
    stats = {"ai_skip": 0, "other_engine": 0, "manual_count": 0, "unknown_skip": 0, "missing_skip": 0, "queued_skip": 0, "pending": 0}
    queued = _active_queued_pids(db)
    pending_ids = []
    for _pid in ids:
        _ct = ctm.get(str(_pid)) or ctm.get(_pid) or ""
        if _pid in queued:
            stats["queued_skip"] += 1
            continue
        _row = None
        if _ct == "word_card":
            _row = db.execute("SELECT thumbnail, thumb_width, thumb_height, thumb_engine FROM word_card WHERE id=? AND is_deleted=0", [_pid]).fetchone()
            if not _row:
                stats["missing_skip"] += 1
                continue
            _st = thumb_state_of(_row)
        elif _ct == "prompts":
            # prompts 旧表无尺寸/目录指纹，仅按关联表存在性判定（legacy：视为已有图跳过）
            _row2 = db.execute("SELECT 1 FROM prompt_thumbnails WHERE prompt_id=? AND media_type='image'", [_pid]).fetchone()
            _st = "ai" if _row2 else "none"
        else:
            # 未标注：先查 word_card 再查 prompts
            _row = db.execute("SELECT thumbnail, thumb_width, thumb_height, thumb_engine FROM word_card WHERE id=? AND is_deleted=0", [_pid]).fetchone()
            if _row:
                _st = thumb_state_of(_row)
            else:
                _row2 = db.execute("SELECT 1 FROM prompt_thumbnails WHERE prompt_id=? AND media_type='image'", [_pid]).fetchone()
                _st = "ai" if _row2 else "none"
        if _st == "ai":
            # 引擎维度：当前引擎生成的才算完成；其他明确引擎（dreamina/libtv/comfyui）→ 纳入待处理
            # 引擎未知（旧链路无法溯源）→ 默认视为完成跳过（2026-08-10 二喵决策）
            _eng = ""
            try:
                if _row is not None and (_row["thumbnail"] or ""):
                    _eng = thumb_engine_of(_row, db)
            except Exception:
                _eng = ""
            if engine and _eng and _eng != engine and _eng != "unknown":
                stats["other_engine"] += 1
                pending_ids.append(_pid)
                continue
            stats["ai_skip"] += 1
            continue
        if _st == "unknown":
            stats["unknown_skip"] += 1
            continue
        if _st == "manual":
            stats["manual_count"] += 1
        pending_ids.append(_pid)
    stats["pending"] = len(pending_ids)
    return pending_ids, stats


# ==================== 批量生成任务队列 ====================

# 全局批量并发锁：同一时刻只允许 1 个批量任务执行（其余排队），防止大量任务叠加提交 ComfyUI 卡死
_BATCH_GLOBAL_LOCK = threading.Lock()

# 已接管任务登记（2026-08-11 修复）：防「启动恢复」与「新建/重试」并发 spawn 双 worker
_RESUMED_TASKS = set()
_RESUMED_LOCK = threading.Lock()


def _mark_resumed(tid: int):
    """登记任务已由某 worker 接管（幂等，防重复恢复）"""
    with _RESUMED_LOCK:
        _RESUMED_TASKS.add(tid)


class BatchScanRequest(BaseModel):
    scope: str = "all"              # all / group / ids
    group_id: int = 0
    ids: list[int] = []
    card_type_map: dict = {}        # ids 场景下显式标注 {prompt_id: 'word_card'|'prompts'}
    include_legacy: bool = False    # ids 场景下是否包含 prompts 旧表条目
    engine: str = ""                # 当前选中生成引擎（comfyui/dreamina/libtv）；非空时其他引擎生成的卡计入 other_engine 纳入待处理


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
    batch_size: int = 0           # 每批切片张数（0=不切片单任务；>0 自动分片创建多任务）
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
            # 2026-08-11 续跑支持：服务重启后恢复时，从已确认完成处继续而非重头重新生成
            # 注意：current_index 是「处理前写入的序号+1」，中断时最后一张可能未完成；
            # 故以 len(results)（已确认完成数）为准，起点 = min(current_index, len(results))，
            # 未完成的张会被重新生成（不丢卡），已完成张靠 done_pids 跳过（不重复生成）
            resume_index = 0
            is_resume = d.get("status") == "running"
            if is_resume:
                try:
                    resume_index = max(0, int(d.get("current_index") or 0))
                except Exception:
                    resume_index = 0
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
            if is_resume:
                # 续跑：已完成进度从 DB 读回（results/success/failed），不重置计数
                try:
                    results = json.loads(d.get("results") or "[]")
                except Exception:
                    results = []
                if not isinstance(results, list):
                    results = []
                for _r in results:
                    if _r.get("ok"):
                        success += 1
                    else:
                        failed += 1
                # 起点修正：current_index 是处理前写的序号+1，中断张可能未完成（差值=1）
                resume_index = min(resume_index, len(results))
                if len(results) >= total:
                    # 全部完成但 done 未落库（进程在收尾时被杀）→ 直接标完成，不重复生成
                    _batch_update(task_id, status="done", success=success, failed=failed,
                                  current_index=total, current_prompt="",
                                  results=json.dumps(results, ensure_ascii=False), finished_at=_now_str())
                    return
                _batch_update(task_id, status="running", current_prompt="恢复运行中...")
            else:
                _batch_update(task_id, status="running", started_at=_now_str(), current_index=0,
                              current_prompt="准备中...", success=0, failed=0, results="[]")
            # 已确认完成的 pid（防重复生成；正常任务 results 为空不受影响）
            done_pids = {x.get("prompt_id") for x in results if x.get("ok")}
            for idx, pid in enumerate(prompt_ids):
                if idx < resume_index or pid in done_pids:
                    continue  # 续跑：已完成项跳过，不重复生成
                # 取消检查
                chk = db.execute("SELECT status FROM comfyui_batch_tasks WHERE id=?", [task_id]).fetchone()
                if not chk or chk["status"] == "cancelled":
                    _batch_update(task_id, status="cancelled", finished_at=_now_str())
                    return
                # 兼容两种数据源：prompts / word_card
                # 优先使用前端显式标注的类型（解决 id 跨表重叠时猜错表）
                _ct = card_type_map.get(str(pid)) or card_type_map.get(pid) or ""
                if _ct == "word_card":
                    row2 = db.execute("SELECT content, content_detailed, module FROM word_card WHERE id=? AND is_deleted=0", [pid]).fetchone()
                    src_table = "word_card"
                elif _ct == "prompts":
                    row2 = db.execute("SELECT content, module FROM prompts WHERE id=?", [pid]).fetchone()
                    src_table = "prompts"
                else:
                    # 旧任务/未标注：保持原猜测逻辑
                    row2 = db.execute("SELECT content, module FROM prompts WHERE id=?", [pid]).fetchone()
                    src_table = "prompts"
                    if not row2:
                        row2 = db.execute("SELECT content, content_detailed, module FROM word_card WHERE id=? AND is_deleted=0", [pid]).fetchone()
                        src_table = "word_card"
                if not row2:
                    failed += 1
                    results.append({"prompt_id": pid, "ok": False, "error": "提示词不存在", "prompt_text": ""})
                    _batch_update(task_id, current_index=idx + 1, success=success, failed=failed, results=json.dumps(results, ensure_ascii=False))
                    continue
                card_text = row2["content"]
                # 2026-08-10: 生成提示词优先级 overrides > content_detailed（优化后详细档）> content（标准档）
                # 修复「存了详细档但生成仍用标准档」——全库流水线要求用优化后的详细提示词生成
                if src_table == "word_card":
                    _det = row2["content_detailed"] or ""
                    if _det.strip():
                        card_text = _det
                # Ollama 优化结果覆盖（prompt_overrides，会话内未保存的临时结果优先）
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
                                                 model_version=d.get("model_version") or "5.0",
                                                 ratio=d.get("ratio") or "1:1",
                                                 resolution_type=d.get("resolution_type") or "2k",
                                                 width=int(d.get("width") or 0), height=int(d.get("height") or 0),
                                                 generate_num=1, poll=120, retries=1, timeout=150)
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
                                              d.get("libtv_ratio") or "1:1",
                                              timeout=150)
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


def _resume_orphaned_tasks():
    """启动恢复：接管上次进程遗留的 queued/running 任务（2026-08-11 修复）
    此前无恢复机制：服务重启后 DB 里的任务无人消费，前端永久显示"在队列中"。
    恢复时按 id 顺序 spawn worker（全局锁串行）；running 任务由 _batch_worker 从
    current_index 续跑，已完成结果从 DB 读回，不重复生成。
    """
    try:
        _ensure_batch_task_table()
        db = get_db()
        rows = db.execute(
            "SELECT id FROM comfyui_batch_tasks WHERE status IN ('queued','running') ORDER BY id"
        ).fetchall()
        if not rows:
            return
        started = 0
        with _RESUMED_LOCK:
            for r in rows:
                tid = r["id"]
                if tid in _RESUMED_TASKS:
                    continue
                _RESUMED_TASKS.add(tid)
                threading.Thread(target=_batch_worker, args=(tid,), daemon=True).start()
                started += 1
        if started:
            print(f"[Batch] 队列恢复: 接管 {started} 个未完成任务 (queued/running)")
    except Exception as e:
        print(f"[Batch] 队列恢复失败: {e}")


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
    """创建批量生成任务（立即返回 task_ids，后台线程执行，支持进度查询/取消/恢复）
    2026-08-10: 完成态过滤（多维度判定） + batch_size 切片（防在线引擎超限/降单批失败面）
    """
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
    # 2026-08-10: 完成态过滤（§2.3 多维度判定：AI 跳过/其他引擎纳入/手动指定纳入并覆盖）
    _ensure_thumb_engine_col()
    filtered_ids, stats = _filter_pending_ids(data.prompt_ids, data.card_type_map or {}, db, engine)
    if not filtered_ids:
        # 2026-08-10: 区分「均在队列」与「均已 AI 生成」文案
        if stats["queued_skip"] > 0:
            return {"ok": False, "error": f"所选 {stats['queued_skip']} 张词卡均在生成队列中，无需重复提交", "stats": stats}
        return {"ok": False, "error": f"所选 {stats['ai_skip'] + stats['unknown_skip']} 张词卡均已 AI 生成过缩略图，无需重复生成",
                "stats": stats}
    data.prompt_ids = filtered_ids
    if engine == "comfyui":
        workflow_cfg, wf_err = _find_workflow_v2(data.workflow_id)
        if workflow_cfg:
            wf_name = workflow_cfg.get("name", "") or ""
            model_type = _detect_model_type(workflow_cfg["workflow_json"])
        elif not data.workflow_id:
            return {"ok": False, "error": "请先选择生成工作流"}
    # batch_size 切片：>0 按每批 N 张创建多个任务（单事务，全部成功或全部回滚）
    batch_size = max(0, int(data.batch_size or 0))
    if batch_size <= 0:
        chunks = [filtered_ids]
    else:
        chunks = [filtered_ids[i:i + batch_size] for i in range(0, len(filtered_ids), batch_size)]
    new_ids = []
    try:
        for _chunk in chunks:
            cur = db.execute(
                """INSERT INTO comfyui_batch_tasks
                   (workflow_id, workflow_name, model_type, prompt_ids, total, status,
                    style_suffix, use_module_preset, preset_id, param_values, prompt_overrides,
                    engine, manual_text, model_version, ratio, resolution_type, width, height, card_type_map,
                    project_uuid, libtv_model, libtv_ratio)
                   VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [data.workflow_id, wf_name, model_type, json.dumps(_chunk), len(_chunk),
                 data.style_suffix, data.use_module_preset, data.preset_id,
                 json.dumps(data.param_values or {}, ensure_ascii=False),
                 json.dumps(data.prompt_overrides or {}, ensure_ascii=False),
                 engine, data.manual_text or "", data.model_version or "5.0", data.ratio or "1:1",
                 data.resolution_type or "2k", data.width or 0, data.height or 0,
                 json.dumps(data.card_type_map or {}, ensure_ascii=False),
                 data.project_uuid or "", data.libtv_model or "Z-image Turbo", data.libtv_ratio or "1:1"])
            new_ids.append(cur.lastrowid)
        safe_commit()
    except Exception as e:
        return {"ok": False, "error": f"任务创建失败: {e}"}
    for tid in new_ids:
        _mark_resumed(tid)
        threading.Thread(target=_batch_worker, args=(tid,), daemon=True).start()
    return {"ok": True, "task_ids": new_ids, "task_id": new_ids[0], "total": len(filtered_ids),
            "batches": len(chunks), "skipped": stats["ai_skip"] + stats["unknown_skip"], "stats": stats,
            "status": "queued", "workflow_name": wf_name, "model_type": model_type}


@router.post("/batch-scan")
def scan_batch_cards(data: BatchScanRequest):
    """全库/分组/指定卡完成态扫描（2026-08-10）：返回每卡缩略图来源判定 + 优化状态 + 队列状态 + 生成引擎，
    供前端一键流水线展示「本次将处理 N 张」并分类预览（不创建任何任务）
    engine 非空时：仅当前引擎生成的缩略图视为完成；其他引擎生成的卡计入 other_engine（纳入待处理）
    """
    _ensure_batch_task_table()
    _ensure_thumb_engine_col()
    db = get_db()
    cols = "wc.id, wc.name, wc.group_id, wc.module, wc.content_detailed, wc.thumbnail, wc.thumb_width, wc.thumb_height, wc.thumb_engine, wg.name AS group_name"
    if data.scope == "group":
        rows = db.execute(
            f"SELECT {cols} FROM word_card wc LEFT JOIN word_card_group wg ON wg.id=wc.group_id "
            "WHERE wc.is_deleted=0 AND wc.group_id=? ORDER BY wc.group_id, wc.id", [data.group_id]).fetchall()
        raw = [dict(r) for r in rows]
    elif data.scope == "ids":
        # 混合两表（收藏夹场景）：word_card 走多维判定，prompts 旧表仅存在性判定
        ctm = data.card_type_map or {}
        wc_ids, pr_ids = [], []
        for _pid in data.ids:
            if ctm.get(str(_pid)) == "word_card":
                wc_ids.append(_pid)
            else:
                pr_ids.append(_pid)
        raw = []
        if wc_ids:
            _ph = ",".join("?" * len(wc_ids))
            rows = db.execute(
                f"SELECT {cols}, 'word_card' AS _source FROM word_card wc LEFT JOIN word_card_group wg ON wg.id=wc.group_id "
                f"WHERE wc.is_deleted=0 AND wc.id IN ({_ph}) ORDER BY wc.group_id, wc.id", wc_ids).fetchall()
            raw += [dict(r) for r in rows]
        if pr_ids and data.include_legacy:
            _ph = ",".join("?" * len(pr_ids))
            rows = db.execute(
                "SELECT p.id, p.name, 0 AS group_id, p.module, '' AS content_detailed, '' AS thumbnail, 0 AS thumb_width, 0 AS thumb_height, '' AS group_name, 'prompts' AS _source "
                "FROM prompts p WHERE p.id IN (" + _ph + ")", pr_ids).fetchall()
            raw += [dict(r) for r in rows]
    else:  # all
        rows = db.execute(
            f"SELECT {cols} FROM word_card wc LEFT JOIN word_card_group wg ON wg.id=wc.group_id "
            "WHERE wc.is_deleted=0 ORDER BY wc.group_id, wc.id").fetchall()
        raw = [dict(r) for r in rows]
    queued = _active_queued_pids(db)
    stats = {"total": len(raw), "pending": 0, "opt_only": 0, "ai_generated": 0,
             "other_engine": 0, "manual": 0, "unknown": 0, "queued": 0}
    cur_engine = (data.engine or "").strip()
    items = []
    for r in raw:
        _src = r.get("_source") or "word_card"
        if _src == "prompts":
            _has = bool(db.execute("SELECT 1 FROM prompt_thumbnails WHERE prompt_id=? AND media_type='image'", [r["id"]]).fetchone())
            _st = "ai" if _has else "none"
            _eng = ""
        else:
            _st = thumb_state_of(r)
            _eng = thumb_engine_of(r, db)
        _opt = bool((r.get("content_detailed") or "").strip())
        _queued = r["id"] in queued
        if _queued:
            stats["queued"] += 1
        elif _st == "ai":
            # 引擎维度：当前引擎生成 → 完成；其他明确引擎 → 纳入待处理（other_engine）
            # 引擎未知（旧链路）→ 默认视为完成跳过（2026-08-10 二喵决策）
            if cur_engine and _eng and _eng != cur_engine and _eng != "unknown":
                stats["other_engine"] += 1
            else:
                stats["ai_generated"] += 1
        elif _st == "manual":
            stats["manual"] += 1
        elif _st == "unknown":
            stats["unknown"] += 1
        elif _opt:
            stats["opt_only"] += 1
        else:
            stats["pending"] += 1
        items.append({
            "id": r["id"], "name": r.get("name") or "", "group_id": r.get("group_id") or 0,
            "group_name": r.get("group_name") or "", "module": r.get("module") or "",
            "optimized": _opt, "thumbnail": r.get("thumbnail") or "",
            "thumb_state": _st, "thumb_engine": _eng, "queued": _queued,
        })
    return {"ok": True, "stats": stats, "items": items}


class BatchCardsRequest(BaseModel):
    ids: list[int] = []
    card_type_map: dict = {}        # {prompt_id: 'word_card'|'prompts'}（默认按 word_card 查）


@router.post("/batch-cards")
def batch_cards(data: BatchCardsRequest):
    """批量取词卡内容（2026-08-10）：供全词库模式 Ollama 优化取原文（一次拉取，避免 N 次单卡请求）
    返回: {ok, cards: [{id, name, content, content_detailed, module}]}
    """
    db = get_db()
    ctm = data.card_type_map or {}
    wc_ids, pr_ids = [], []
    for _pid in data.ids:
        if ctm.get(str(_pid)) == "prompts":
            pr_ids.append(_pid)
        else:
            wc_ids.append(_pid)
    cards = []
    if wc_ids:
        _ph = ",".join("?" * len(wc_ids))
        rows = db.execute(
            f"SELECT id, name, content, content_detailed, module FROM word_card WHERE id IN ({_ph}) AND is_deleted=0", wc_ids).fetchall()
        cards += [dict(r) for r in rows]
    if pr_ids:
        _ph = ",".join("?" * len(pr_ids))
        rows = db.execute(
            f"SELECT id, name, content, '' AS content_detailed, module FROM prompts WHERE id IN ({_ph})", pr_ids).fetchall()
        cards += [dict(r) for r in rows]
    return {"ok": True, "cards": cards}


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
    _mark_resumed(new_id)
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
