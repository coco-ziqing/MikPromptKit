# -*- coding: utf-8 -*-
"""
Seedance V2 即梦视频生成任务模块（v5.36.0）
分镜组装器 → 即梦 CLI 视频任务提交 / 队列 / 轮询 / 下载
- text2video 文生视频（v1 范围）
- DB 持久化队列 + 全局串行锁 + 服务重启孤儿接管（复用 comfyui_batch 模式）
路由挂载: seedance_v2.py include_router，prefix 同为 /api/seedance/v2
"""
import json
import os
import re
import threading
import time

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

from database import get_db, safe_commit
from api.dreamina import DREAMINA_BIN, _dreamina_run

router = APIRouter(tags=["seedance-v2-video"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VIDEO_DIR = os.path.join(_PROJECT_ROOT, "data", "videos")
os.makedirs(VIDEO_DIR, exist_ok=True)

# 即梦支持的模型与参数（v1 固定集，后续按 CLI -h 扩展）
MODEL_VERSIONS = ["seedance2.0fast", "seedance2.0", "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini", "seedance2.5"]
RATIOS = ["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"]
RESOLUTIONS = ["480p", "720p", "1080p", "4k"]
# 模型 → (最短s, 最长s, 允许分辨率)
_MODEL_LIMITS = {
    "seedance2.5": (4, 30, ["480p", "720p"]),
    "seedance2.0_vip": (4, 15, ["720p", "1080p", "4k"]),
    "seedance2.0fast_vip": (4, 15, ["720p"]),
}
_DEFAULT_LIMITS = (4, 15, ["720p"])

_VIDEO_QUEUE_LOCK = threading.Lock()   # 全局串行：一次只跑一个视频任务
_VWORKER_STARTED = False

# 前端字段 → 组装器维度字段映射（与 composer_engine 拼接一致）
_FIELD_ORDER = ['camera_move', 'subject', 'action', 'scene_desc', 'composition', 'lighting',
                'focal_length', 'texture', 'speed', 'emotion', 'color_grade', 'weather',
                'particles', 'perspective', 'depth_of_field', 'filter', 'natural_force',
                'environment_detail', 'film_flaw', 'fantasy_physics', 'character_voice', 'bgm', 'sfx']


def _now_str():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _ensure_project_video_cols():
    """幂等迁移: user_project 增加即梦视频参数列（PRAGMA 探测，无异常路径）"""
    db = get_db()
    cols = [r["name"] for r in db.execute("PRAGMA table_info(user_project)").fetchall()]
    if "video_model" not in cols:
        db.execute("ALTER TABLE user_project ADD COLUMN video_model TEXT DEFAULT 'seedance2.0fast'")
        print("[Seedance Video] user_project 增加列 video_model")
    if "video_session" not in cols:
        db.execute("ALTER TABLE user_project ADD COLUMN video_session INTEGER DEFAULT 0")
        print("[Seedance Video] user_project 增加列 video_session")
    if "video_resolution" not in cols:
        db.execute("ALTER TABLE user_project ADD COLUMN video_resolution TEXT DEFAULT '720p'")
        print("[Seedance Video] user_project 增加列 video_resolution")
    safe_commit()


def _ensure_video_task_table():
    db = get_db()
    # 旧表补列（幂等 PRAGMA 探测，CREATE IF NOT EXISTS 不更新旧表）
    tbl_cols = [r["name"] for r in db.execute("PRAGMA table_info(seedance_video_tasks)").fetchall()] if any(
        r["name"] == "seedance_video_tasks" for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='seedance_video_tasks'").fetchall()
    ) else []
    if tbl_cols and "session" not in tbl_cols:
        db.execute("ALTER TABLE seedance_video_tasks ADD COLUMN session INTEGER DEFAULT 0")
        print("[Seedance Video] seedance_video_tasks 增加列 session")
    if tbl_cols and "image_refs" not in tbl_cols:
        db.execute("ALTER TABLE seedance_video_tasks ADD COLUMN image_refs TEXT DEFAULT ''")
        print("[Seedance Video] seedance_video_tasks 增加列 image_refs")
    db.execute("""CREATE TABLE IF NOT EXISTS seedance_video_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        scene_id INTEGER,
        task_type TEXT DEFAULT 'text2video',
        prompt TEXT DEFAULT '',
        model_version TEXT DEFAULT 'seedance2.0fast',
        ratio TEXT DEFAULT '16:9',
        duration INTEGER DEFAULT 5,
        video_resolution TEXT DEFAULT '720p',
        session INTEGER DEFAULT 0,
        image_refs TEXT DEFAULT '',
        submit_id TEXT DEFAULT '',
        status TEXT DEFAULT 'queued',
        fail_reason TEXT DEFAULT '',
        result_url TEXT DEFAULT '',
        result_local TEXT DEFAULT '',
        created_at TEXT,
        started_at TEXT DEFAULT '',
        finished_at TEXT DEFAULT ''
    )""")
    safe_commit()


def _task_update(task_id: int, **kw):
    db = get_db()
    sets = ", ".join(f"{k}=?" for k in kw)
    db.execute(f"UPDATE seedance_video_tasks SET {sets} WHERE id=?", list(kw.values()) + [task_id])
    safe_commit()


def _build_scene_prompt(scene: dict, global_style: str = "") -> str:
    """单镜头提示词：按标准拼接公式（standard 密度）+ 全局画风前缀"""
    parts = []
    if scene.get("camera_move", "").strip():
        parts.append(scene["camera_move"].strip())
    if scene.get("subject", "").strip():
        parts.append(scene["subject"].strip())
    if scene.get("action", "").strip():
        parts.append(scene["action"].strip())
    if scene.get("scene_desc", "").strip():
        parts.append(scene["scene_desc"].strip())
    if scene.get("composition", "").strip():
        parts.append(scene["composition"].strip())
    if scene.get("lighting", "").strip():
        parts.append(scene["lighting"].strip())
    mood = ""
    for k in ("emotion", "color_grade", "weather"):
        if scene.get(k, "").strip():
            mood = scene[k].strip()
            break
    if mood:
        parts.append(mood)
    for k in ("particles", "natural_force", "fantasy_physics", "filter"):
        if scene.get(k, "").strip():
            parts.append(scene[k].strip())
    text = "，".join(parts)
    if not text.strip():
        return ""
    style = (global_style or "").strip()
    return (style + "，" + text) if style else text


def _collect_refs(project_id: int, scene_id) -> list:
    """收集参考图：镜头级 + 全局级合并去重（按 file_path）
    返回 [{ref_type, ref_name, file_path, url}]，总数 ≤9
    """
    db = get_db()
    refs = []
    seen = set()
    rows = []
    try:
        if scene_id:
            rows += db.execute(
                "SELECT * FROM seedance_image_refs WHERE project_id=? AND scene_id=? ORDER BY sort_order, id",
                [project_id, scene_id]).fetchall()
        rows += db.execute(
            "SELECT * FROM seedance_image_refs WHERE project_id=? AND scene_id IS NULL ORDER BY sort_order, id",
            [project_id]).fetchall()
    except Exception:
        return []
    for r in rows:
        fp = r["file_path"] or ""
        if not fp or fp in seen:
            continue
        seen.add(fp)
        refs.append({"ref_type": r["ref_type"] or "character",
                     "ref_name": r["ref_name"] or "",
                     "file_path": fp,
                     "url": r["url"] or ""})
    return refs


def _pick_task_type(refs: list, requested: str) -> str:
    """确定生成方式：无图=text2video；单图=image2video；多图=multimodal2video"""
    n = len(refs)
    if n == 0:
        return "text2video"
    if n == 1:
        if requested == "multimodal2video":
            return "multimodal2video"
        return "image2video"
    return "multimodal2video"


_SESSION_CACHE = {"list": None, "ts": 0}


def _valid_session(session: int) -> int:
    """校验即梦会话 ID 是否存在；不存在回退默认会话 0
    用 CLI `session list` 探测（30s 缓存），失败保守放行（0）"""
    if session == 0:
        return 0
    import time as _t
    if _SESSION_CACHE["list"] is None or _t.time() - _SESSION_CACHE["ts"] > 30:
        try:
            out, _err, _code = _dreamina_run(["session", "list"], timeout=20)
            _SESSION_CACHE["list"] = out or ""
            _SESSION_CACHE["ts"] = _t.time()
        except Exception:
            _SESSION_CACHE["list"] = ""
    if _SESSION_CACHE["list"]:
        ids = set()
        for line in _SESSION_CACHE["list"].splitlines():
            m = re.match(r"^\s*(\d+)\s+", line)
            if m:
                ids.add(int(m.group(1)))
        if session not in ids:
            return 0
    return session


def _validate_duration(model: str, duration: int):
    mn, mx, _res = _MODEL_LIMITS.get(model, _DEFAULT_LIMITS)
    return max(mn, min(mx, duration))


def _valid_resolution(model: str, res: str):
    _mn, _mx, res_list = _MODEL_LIMITS.get(model, _DEFAULT_LIMITS)
    if res not in res_list:
        return res_list[-1] if res_list else "720p"
    return res


def _parse_cli_json(out: str, err: str):
    """解析 CLI stdout 中最后一个含 gen_status 的 JSON"""
    for cand in reversed(re.findall(r"\{.*\}", out, re.S)):
        try:
            d = json.loads(cand)
            if isinstance(d, dict) and "gen_status" in d:
                return d
        except Exception:
            continue
    return None


def _query_and_download(task_id: int):
    """轮询 query_result 直到终态，成功后下载视频到本地"""
    db = get_db()
    task = db.execute("SELECT * FROM seedance_video_tasks WHERE id=?", [task_id]).fetchone()
    if not task:
        return
    submit_id = task["submit_id"]
    timeout_sec = 900  # 最长 15 分钟
    deadline = time.time() + timeout_sec
    last_status = "querying"
    while time.time() < deadline:
        out, err, code = _dreamina_run(["query_result", "--submit_id=" + str(submit_id)], timeout=60)
        data = _parse_cli_json(out, err)
        if not data:
            _task_update(task_id, fail_reason=(err or out)[:200])
            time.sleep(10)
            continue
        last_status = data.get("gen_status", "querying")
        if last_status == "success":
            urls = []
            try:
                rj = data.get("result_json") or {}
                videos = rj.get("videos") or rj.get("results") or []
                for v in videos:
                    if v.get("video_url"):
                        urls.append(v["video_url"])
            except Exception:
                pass
            if not urls:
                m = re.search(r'"video_url"\s*:\s*"([^"]+)"', out)
                if m:
                    urls.append(m.group(1))
            url = urls[0] if urls else ""
            _task_update(task_id, status="success", result_url=url, finished_at=_now_str())
            # 下载本地
            if url:
                try:
                    import httpx
                    with httpx.Client(timeout=180) as cl:
                        r = cl.get(url)
                        if r.status_code == 200:
                            fname = f"task{task_id}_{int(time.time())}.mp4"
                            fpath = os.path.join(VIDEO_DIR, fname)
                            with open(fpath, "wb") as f:
                                f.write(r.content)
                            _task_update(task_id, result_local=fname)
                except Exception as e:
                    _task_update(task_id, fail_reason=f"下载失败: {e}")
            return
        if last_status == "fail":
            reason = (data.get("fail_reason") or "").strip()
            _task_update(task_id, status="fail", fail_reason=reason or (err or out)[-200:],
                         finished_at=_now_str())
            return
        # 仍在 querying
        time.sleep(8)
    _task_update(task_id, status="fail", fail_reason=f"轮询超时({timeout_sec}s)，最后状态 {last_status}",
                 finished_at=_now_str())


def _video_worker(task_id: int):
    """任务执行体：提交 CLI → 轮询 → 下载（全局锁串行）"""
    global _VWORKER_STARTED
    with _VIDEO_QUEUE_LOCK:
        db = get_db()
        task = db.execute("SELECT * FROM seedance_video_tasks WHERE id=?", [task_id]).fetchone()
        if not task or task["status"] == "success":
            return
        _task_update(task_id, status="submitting", started_at=_now_str())
        try:
            ttype = task["task_type"] or "text2video"
            refs = []
            try:
                refs = json.loads(task["image_refs"] or "[]")
            except Exception:
                refs = []
            ref_paths = [r.get("file_path", "") for r in refs if r.get("file_path") and os.path.exists(r.get("file_path", ""))]
            if ttype in ("image2video", "multimodal2video") and ref_paths:
                # 图像参考模式：image2video(单图) / multimodal2video(多图)
                cmd = "image2video" if (ttype == "image2video" and len(ref_paths) == 1) else "multimodal2video"
                args = [cmd, "--prompt", task["prompt"],
                        "--model_version", task["model_version"],
                        "--duration", str(task["duration"]),
                        "--video_resolution", task["video_resolution"],
                        "--session", str(task["session"] or 0),
                        "--poll", "0"]
                for rp in ref_paths:
                    args += ["--image", rp]
            else:
                args = ["text2video", "--prompt", task["prompt"],
                        "--model_version", task["model_version"],
                        "--ratio", task["ratio"],
                        "--duration", str(task["duration"]),
                        "--video_resolution", task["video_resolution"],
                        "--session", str(task["session"] or 0),
                        "--poll", "0"]
            out, err, code = _dreamina_run(args, timeout=180)
            data = _parse_cli_json(out, err)
            if not data:
                _task_update(task_id, status="fail", fail_reason=f"提交解析失败: {(err or out)[:200]}",
                             finished_at=_now_str())
                return
            status = data.get("gen_status", "querying")
            submit_id = data.get("submit_id", "")
            if not submit_id:
                _task_update(task_id, status="fail",
                             fail_reason=data.get("fail_reason") or "未返回 submit_id",
                             finished_at=_now_str())
                return
            _task_update(task_id, status="querying", submit_id=str(submit_id))
            if status == "fail":
                _task_update(task_id, status="fail",
                             fail_reason=(data.get("fail_reason") or "")[:200], finished_at=_now_str())
                return
            if status == "success":
                # 直接进入下载流程（submit 即成功）
                pass
        except Exception as e:
            _task_update(task_id, status="fail", fail_reason=f"提交异常: {e}", finished_at=_now_str())
            return
    # 锁外轮询（不阻塞其他任务提交）
    _query_and_download(task_id)


def _resume_orphaned_video_tasks():
    """服务重启后接管 queued/submitting/querying 孤儿任务"""
    global _VWORKER_STARTED
    try:
        _ensure_video_task_table()
        db = get_db()
        rows = db.execute(
            "SELECT id FROM seedance_video_tasks WHERE status IN ('queued','submitting','querying')"
        ).fetchall()
        for r in rows:
            threading.Thread(target=_video_worker, args=(r["id"],), daemon=True).start()
        if rows:
            print(f"[Seedance Video] 恢复孤儿视频任务 {len(rows)} 个")
    except Exception as e:
        print(f"[Seedance Video] 孤儿接管跳过: {e}")


# ==================== API ====================

@router.get("/video/config")
def video_config():
    """视频生成参数集（供前端渲染）+ 分辨率/模型映射规则"""
    _ensure_project_video_cols()
    # 项目分辨率档位 → 即梦建议映射（按模型上限）
    proj_res_map = {
        "480p": "480p", "720p": "720p", "1080p": "1080p",
        "2K": "1080p", "4K": "4k", "6K": "4k", "8K": "4k"
    }
    # 模型 → 最高分辨率
    model_max_res = {
        "seedance2.0fast": "720p", "seedance2.0": "720p", "seedance2.0mini": "720p",
        "seedance2.0fast_vip": "720p", "seedance2.0_vip": "4k", "seedance2.5": "720p"
    }
    return {"ok": True, "model_versions": MODEL_VERSIONS, "ratios": RATIOS,
            "resolutions": RESOLUTIONS, "cli_available": os.path.exists(DREAMINA_BIN),
            "video_dir": VIDEO_DIR,
            "proj_res_map": proj_res_map, "model_max_res": model_max_res,
            "model_limits": {k: {"duration": v} for k, v in _MODEL_LIMITS.items()}}


@router.post("/video/tasks")
def create_video_tasks(data: dict = Body(...)):
    """提交视频生成任务
    body: {
      project_id: int,
      scope: "all"|"scenes",        # all=整项目单任务；scenes=逐镜头多任务
      scene_ids: [int]|None,        # scope=scenes 时可指定子集
      model_version: str,
      ratio: str,
      resolution: str,
      task_type: "text2video"
    }
    """
    global _VWORKER_STARTED
    _ensure_project_video_cols()
    _ensure_video_task_table()
    project_id = data.get("project_id")
    if not project_id:
        raise HTTPException(400, "project_id 必填")
    db = get_db()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj:
        raise HTTPException(404, "分镜项目不存在")
    scope = data.get("scope", "scenes")
    task_type = data.get("task_type", "text2video")  # text2video / image2video / multimodal2video
    # 项目持久化的即梦参数作为默认（v5.36.0 全局参数联动）
    model = data.get("model_version") or proj["video_model"] or "seedance2.0fast"
    ratio = data.get("ratio") or proj["aspect_ratio"] or "16:9"
    resolution = data.get("resolution") or proj["video_resolution"] or "720p"
    video_session = _valid_session(int(data.get("session", proj["video_session"] or 0)))
    if model not in MODEL_VERSIONS:
        raise HTTPException(400, f"不支持的模型: {model}")
    if ratio not in RATIOS:
        raise HTTPException(400, f"不支持的画幅: {ratio}")
    resolution = _valid_resolution(model, resolution)

    # 图像参考数量限制（角色+场景合计 ≤9，对齐 multimodal2video 2.0系 image≤9）
    def _check_ref_limit(refs, scope_label):
        n = len(refs)
        if n > 9:
            raise HTTPException(400, f"{scope_label}参考图 {n} 张超过上限 9 张（即梦 multimodal 限制），请减少后再提交")
        return n

    # 组装任务列表
    tasks = []
    if scope == "all":
        dur = _validate_duration(model, int(proj["total_duration"] or 15))
        scenes = db.execute(
            "SELECT * FROM user_project_scene WHERE project_id=? ORDER BY scene_order",
            [project_id]).fetchall()
        prompt_parts = []
        for s in scenes:
            sp = _build_scene_prompt(dict(s), proj["global_style"] or "")
            if sp:
                prompt_parts.append(f"镜头{s['scene_order']}: {sp}")
        full = "；".join(prompt_parts)
        if not full.strip():
            raise HTTPException(400, "项目没有可组装的镜头内容")
        refs = _collect_refs(project_id, None)
        _check_ref_limit(refs, "全局")
        tt = _pick_task_type(refs, task_type)
        tasks.append({"scene_id": None, "prompt": full, "duration": dur, "refs": refs, "task_type": tt})
    else:
        scene_ids = data.get("scene_ids")
        if scene_ids:
            placeholders = ",".join("?" for _ in scene_ids)
            rows = db.execute(
                f"SELECT * FROM user_project_scene WHERE project_id=? AND id IN ({placeholders}) ORDER BY scene_order",
                [project_id] + scene_ids).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM user_project_scene WHERE project_id=? ORDER BY scene_order",
                [project_id]).fetchall()
        if not rows:
            raise HTTPException(400, "项目没有镜头")
        for s in rows:
            sp = _build_scene_prompt(dict(s), proj["global_style"] or "")
            if not sp.strip():
                continue
            dur = _validate_duration(model, int(float(s["duration"] or 5)))
            refs = _collect_refs(project_id, s["id"])
            _check_ref_limit(refs, f"镜头{s['scene_order']}")
            tt = _pick_task_type(refs, task_type)
            tasks.append({"scene_id": s["id"], "prompt": sp, "duration": dur, "refs": refs, "task_type": tt})

    if not tasks:
        raise HTTPException(400, "没有可生成的内容（请先填充镜头字段）")

    # 写入队列（v5.36.2: 携带参考图 JSON）
    created_ids = []
    for t in tasks:
        refs_json = json.dumps(t["refs"], ensure_ascii=False)
        cur = db.execute(
            "INSERT INTO seedance_video_tasks (project_id, scene_id, task_type, prompt, model_version, ratio, duration, video_resolution, session, image_refs, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
            [project_id, t["scene_id"], t["task_type"], t["prompt"], model, ratio, t["duration"], resolution, video_session, refs_json, _now_str()]
        )
        created_ids.append(cur.lastrowid)
    safe_commit()

    # 串行启动 worker（不阻塞响应）
    if not _VWORKER_STARTED:
        _VWORKER_STARTED = True
        threading.Thread(target=_resume_orphaned_video_tasks, daemon=True).start()
    for tid in created_ids:
        threading.Thread(target=_video_worker, args=(tid,), daemon=True).start()

    return {"ok": True, "task_ids": created_ids, "count": len(created_ids),
            "model_version": model, "ratio": ratio, "video_resolution": resolution}


@router.get("/video/tasks")
def list_video_tasks(project_id: int = Query(None), status: str = Query(None),
                     limit: int = Query(50, ge=1, le=200)):
    """任务列表（可按项目/状态过滤）"""
    db = get_db()
    sql = "SELECT * FROM seedance_video_tasks WHERE 1=1"
    params = []
    if project_id:
        sql += " AND project_id=?"
        params.append(project_id)
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    rows = db.execute(sql, params).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/video/tasks/{task_id}")
def get_video_task(task_id: int):
    db = get_db()
    row = db.execute("SELECT * FROM seedance_video_tasks WHERE id=?", [task_id]).fetchone()
    if not row:
        raise HTTPException(404, "任务不存在")
    return {"task": dict(row)}


@router.post("/video/tasks/{task_id}/retry")
def retry_video_task(task_id: int):
    """失败任务重试（重新入队）"""
    db = get_db()
    row = db.execute("SELECT * FROM seedance_video_tasks WHERE id=?", [task_id]).fetchone()
    if not row:
        raise HTTPException(404, "任务不存在")
    if row["status"] == "success":
        raise HTTPException(400, "任务已成功，无需重试")
    _task_update(task_id, status="queued", fail_reason="", submit_id="", result_url="", result_local="",
                 started_at="", finished_at="")
    threading.Thread(target=_video_worker, args=(task_id,), daemon=True).start()
    return {"ok": True}


@router.get("/video/files/{filename}")
def get_video_file(filename: str):
    """下载生成结果视频"""
    fpath = os.path.join(VIDEO_DIR, os.path.basename(filename))
    if not os.path.exists(fpath):
        raise HTTPException(404, "视频文件不存在")
    return FileResponse(fpath, media_type="video/mp4", filename=filename)
