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
# v5.36.4: 词卡预览视频目录（复用词库词卡视频管理机制）
WC_VIDEO_DIR = os.path.join(_PROJECT_ROOT, "data", "wc_media", "videos")
os.makedirs(WC_VIDEO_DIR, exist_ok=True)
# 分镜视频模版分组（seedance 类型，prompt_library VIEW 可识别）
TEMPLATE_GROUP_NAME = "分镜视频模版"
TEMPLATE_GROUP_SUBTYPE = "video_template"


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
    if tbl_cols and "progress" not in tbl_cols:
        db.execute("ALTER TABLE seedance_video_tasks ADD COLUMN progress INTEGER DEFAULT 0")
        print("[Seedance Video] seedance_video_tasks 增加列 progress")
    if tbl_cols and "fail_category" not in tbl_cols:
        db.execute("ALTER TABLE seedance_video_tasks ADD COLUMN fail_category TEXT DEFAULT ''")
        print("[Seedance Video] seedance_video_tasks 增加列 fail_category")
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
        progress INTEGER DEFAULT 0,
        fail_category TEXT DEFAULT '',
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


def _build_ref_aware_prompt(base_prompt: str, refs: list) -> str:
    """参考图模式提示词规范 — Seedance 全能参考官方 @Tag 引用语法（v5.36.6）
    依据全网交叉验证的官方规范：
      - 使用 @图像N 标记引用参考素材（模型训练学习的就是该语法）
      - 每个 @Tag 后必须说明用途（"生成@图像1中角色的..."），不能只丢标签
      - 图片负责静态层（外貌/服装/场景/色调），文字负责动态层（动作/运镜/融合）
      - 风格/约束前置，动作运镜在后
    结构: [参考引用段] + [动态描述段] + [约束段]
    """
    if not refs:
        return base_prompt
    # ── 参考引用段: @图像N + 用途说明（官方语法） ──
    refs_used = []
    char_names = []
    scene_names = []
    for idx, r in enumerate(refs, start=1):
        rtype = r.get("ref_type", "character")
        name = (r.get("ref_name") or "").strip()
        tag = f"@图像{idx}"
        if rtype == "scene":
            scene_names.append(name or f"场景{idx}")
            refs_used.append(f"{tag}作为场景背景")
        elif rtype == "style":
            refs_used.append(f"{tag}作为画面风格参考")
        else:
            char_names.append(name or f"角色{idx}")
            refs_used.append(f"{tag}作为角色{idx}外观参考")

    # 动态描述文本（原组装文本 = 主体/动作/场景/构图/光影）
    body = (base_prompt or "").strip()

    parts = []
    # ① 角色引用声明（显式 @图像N = 角色外观，锁脸锁造型）
    if char_names:
        char_usage = "，".join(refs_used)
        parts.append(f"参考{char_usage}，严格保持各角色外貌、服装、发型一致")
    elif refs_used:
        parts.append(f"参考{'、'.join(refs_used)}")
    # ② 动态描述（动作/运镜/场景变化 — 文字层）
    if body:
        parts.append(body)
    # ③ 约束兜底（防变脸/防穿模）
    parts.append("人物比例符合现实世界物理规律，动作流畅自然")
    return "，".join(parts)


# 参考图压缩预处理目录（提交前生成，避免 CLI 上传大图超时）
REF_TMP_DIR = os.path.join(_PROJECT_ROOT, "data", "video_refs", "tmp")
os.makedirs(REF_TMP_DIR, exist_ok=True)


def _compress_ref_image(src_path: str) -> str:
    """压缩参考图到 ≤1024px/JPEG q80（~100KB），返回临时文件路径
    解决 CLI 上传超时（3MB 大图 HOST 上传 1-2min 撞 deadline，压缩后秒级成功）
    """
    try:
        from PIL import Image
    except ImportError:
        return src_path  # 无 Pillow 则原样
    try:
        fname = os.path.basename(src_path)
        stem, ext = os.path.splitext(fname)
        if ext.lower() in ('.gif',):
            return src_path  # gif 不压缩（动画）
        dst = os.path.join(REF_TMP_DIR, f"cmp_{int(time.time()*1000)}_{stem[:20]}.jpg")
        im = Image.open(src_path)
        im.thumbnail((1024, 1024), Image.LANCZOS)
        if im.mode in ('RGBA', 'P'):
            im = im.convert('RGB')
        im.save(dst, 'JPEG', quality=80, optimize=True)
        return dst
    except Exception as e:
        print(f"[Seedance Video] 参考图压缩失败 {src_path}: {e}")
        return src_path


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
    # v5.36.6: 角色图优先、场景/风格随后（@图像N 编号与声明分组更清晰）
    refs.sort(key=lambda x: 0 if x["ref_type"] == "character" else (1 if x["ref_type"] == "scene" else 2))
    return refs


# 错误分类: CLI 原始错误 → 类别 + 用户引导（v5.36.7）
_ERROR_CATEGORIES = [
    ("ExceedConcurrencyLimit", "concurrency", "即梦账户并发任务超限。请等待当前生成完成后再提交，或稍后重试（系统会自动重试）。"),
    ("ret=1001", "param", "参数错误（可能为无效会话/画幅/分辨率）。请检查会话与参数设置后重试。"),
    ("AigcComplianceConfirmationRequired", "compliance", "该模型首次使用需先在即梦网页端完成一次模型授权确认，然后重试。"),
    ("no file upload", "upload", "参考图上传失败（大图可能超时，系统已自动压缩后重试）。"),
    ("upload", "upload", "参考图上传失败。请检查图片文件是否可读。"),
    ("timeout", "timeout", "任务超时。生成耗时过长，请重试或减少参考图数量。"),
    ("login", "login", "即梦未登录或登录态失效。请到「工具 → 生成引擎授权中心」重新登录。"),
]


def _classify_error(reason: str) -> dict:
    """将 CLI 原始错误归类，返回 {category, message, retryable}"""
    reason = reason or ""
    for pat, cat, msg in _ERROR_CATEGORIES:
        if pat.lower() in reason.lower():
            return {"category": cat, "message": msg,
                    "retryable": cat in ("concurrency", "upload", "timeout")}
    return {"category": "unknown", "message": reason[:200], "retryable": False}


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


def _fetch_session_list(force: bool = False):
    """拉取即梦会话列表（30s 缓存；force=True 时实时刷新）
    返回 [(id, name)]，失败返回 []"""
    import time as _t
    if force or _SESSION_CACHE["list"] is None or _t.time() - _SESSION_CACHE["ts"] > 30:
        try:
            out, _err, _code = _dreamina_run(["session", "list"], timeout=20)
            _SESSION_CACHE["list"] = out or ""
            _SESSION_CACHE["ts"] = _t.time()
        except Exception:
            _SESSION_CACHE["list"] = ""
    sessions = []
    for line in _SESSION_CACHE["list"].splitlines():
        m = re.match(r"^\s*(\d+)\s+(\S.*?)\s{2,}", line)
        if m:
            sessions.append((int(m.group(1)), m.group(2).strip()))
    if not sessions:
        sessions = [(0, "default")]
    return sessions


def _valid_session(session: int, force: bool = False) -> int:
    """校验即梦会话 ID 是否存在；不存在回退默认会话 0
    force=True 时实时校验（提交路径用），无效回退 0"""
    if session == 0:
        return 0
    ids = {s[0] for s in _fetch_session_list(force=force)}
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
    # 进度估算: 生成中按已耗时推进（即梦无进度接口，用时间估算，封顶 90）
    start_wait = time.time()
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
            _task_update(task_id, status="success", result_url=url, finished_at=_now_str(), progress=100)
            # 下载本地
            if url:
                try:
                    _task_update(task_id, progress=95)
                    import httpx
                    with httpx.Client(timeout=180) as cl:
                        r = cl.get(url)
                        if r.status_code == 200:
                            fname = f"task{task_id}_{int(time.time())}.mp4"
                            fpath = os.path.join(VIDEO_DIR, fname)
                            with open(fpath, "wb") as f:
                                f.write(r.content)
                            _task_update(task_id, result_local=fname, progress=100)
                except Exception as e:
                    _task_update(task_id, fail_reason=f"下载失败: {e}")
            return
        if last_status == "fail":
            reason = (data.get("fail_reason") or "").strip()
            cls = _classify_error(reason)
            _task_update(task_id, status="fail", fail_reason=reason or (err or out)[-200:],
                         finished_at=_now_str(), progress=100, fail_category=cls["category"])
            return
        # 仍在 querying: 按耗时推进进度（0-90 区间，5 分钟到 90 封顶）
        elapsed = time.time() - start_wait
        prog = int(min(90, 15 + elapsed / 300.0 * 75))
        _task_update(task_id, progress=prog)
        time.sleep(8)
    _task_update(task_id, status="fail", fail_reason=f"轮询超时({timeout_sec}s)，最后状态 {last_status}",
                 finished_at=_now_str(), progress=100)


def _video_worker(task_id: int):
    """任务执行体：提交 CLI → 轮询 → 下载（全局锁串行）"""
    global _VWORKER_STARTED
    with _VIDEO_QUEUE_LOCK:
        db = get_db()
        task = db.execute("SELECT * FROM seedance_video_tasks WHERE id=?", [task_id]).fetchone()
        if not task or task["status"] == "success":
            return
        _task_update(task_id, status="submitting", started_at=_now_str(), progress=10)
        try:
            ttype = task["task_type"] or "text2video"
            refs = []
            try:
                refs = json.loads(task["image_refs"] or "[]")
            except Exception:
                refs = []
            ref_paths = [r.get("file_path", "") for r in refs if r.get("file_path") and os.path.exists(r.get("file_path", ""))]
            # v5.36.7: 提交前压缩参考图（保持顺序），解决 CLI 大图上传超时
            if ref_paths:
                ref_paths = [_compress_ref_image(p) for p in ref_paths]
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
                reason = (data.get("fail_reason") or "")[:200]
                cls = _classify_error(reason)
                _task_update(task_id, status="fail", progress=100,
                             fail_reason=reason, finished_at=_now_str(), fail_category=cls["category"])
                return
            if status == "success":
                # 直接进入下载流程（submit 即成功）
                pass
        except Exception as e:
            reason = f"提交异常: {e}"
            cls = _classify_error(reason)
            _task_update(task_id, status="fail", fail_reason=reason, finished_at=_now_str(),
                         fail_category=cls["category"])
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

def _ensure_template_group() -> int:
    """确保「分镜视频模版」seedance 分组存在，返回 group_id（幂等）"""
    db = get_db()
    row = db.execute(
        "SELECT id FROM word_card_group WHERE group_type='seedance' AND seedance_subtype=? AND is_active=1",
        [TEMPLATE_GROUP_SUBTYPE]).fetchone()
    if row:
        return row["id"]
    # 创建分组：挂到「📹 视频模板」(63) 下，找不到则挂 53 视频词库
    parent = db.execute("SELECT id FROM word_card_group WHERE id=63 AND is_active=1").fetchone()
    parent_id = parent["id"] if parent else 53
    key = "video_template_" + str(int(time.time() * 1000))
    cur = db.execute(
        "INSERT INTO word_card_group (name, group_key, group_type, seedance_subtype, parent_group_id, sort_order) "
        "VALUES (?, ?, 'seedance', ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card_group))",
        [TEMPLATE_GROUP_NAME, key, TEMPLATE_GROUP_SUBTYPE, parent_id])
    safe_commit()
    print(f"[Seedance Video] 创建分镜视频模版分组 id={cur.lastrowid}")
    return cur.lastrowid


@router.get("/video/templates")
def list_video_templates():
    """列出分镜视频生成模版词卡（含视频 URL）"""
    _ensure_video_task_table()
    gid = _ensure_template_group()
    db = get_db()
    rows = db.execute(
        "SELECT * FROM word_card WHERE group_id=? AND is_deleted=0 ORDER BY id DESC LIMIT 100",
        [gid]).fetchall()
    items = []
    for r in rows:
        d2 = dict(r)
        if d2.get("preview_media"):
            d2["video_url"] = "/api/seedance/v2/videos/" + d2["preview_media"]
        items.append(d2)
    return {"items": items, "group_id": gid, "group_name": TEMPLATE_GROUP_NAME}


def _archive_task_to_template(task_id: int, name: str = "", allow_dup_suffix: bool = False) -> dict:
    """核心：将成功的视频生成任务存档为分镜视频模版词卡（单条/批量共用）
    复制视频到 wc_media/videos，词卡 content=提示词；同名冲突可加序号（批量）或报错（单条）
    """
    _ensure_video_task_table()
    db = get_db()
    task = db.execute("SELECT * FROM seedance_video_tasks WHERE id=?", [task_id]).fetchone()
    if not task:
        raise HTTPException(404, "任务不存在")
    if task["status"] != "success":
        raise HTTPException(400, "仅成功任务可存档为模版")
    src = task["result_local"] or ""
    src_path = ""
    if src:
        src_path = os.path.join(VIDEO_DIR, os.path.basename(src))
    if src_path and not os.path.exists(src_path):
        src_path = ""
    if not src_path:
        raise HTTPException(400, "视频文件不存在，无法存档（任务可能未下载到本地）")

    gid = _ensure_template_group()
    ext = os.path.splitext(src_path)[1].lower() or ".mp4"
    import uuid as _uuid
    dest_name = _uuid.uuid4().hex + ext
    import shutil
    dest_full = os.path.join(WC_VIDEO_DIR, dest_name)
    if os.path.exists(dest_full):
        try:
            os.remove(dest_full)
        except Exception:
            pass
    shutil.copy2(src_path, dest_full)

    if not name:
        proj = db.execute("SELECT name FROM user_project WHERE id=?", [task["project_id"]]).fetchone()
        proj_name = (proj["name"] if proj else "分镜")[:20]
        scene_tag = f"镜头{task['scene_id']}" if task["scene_id"] else "整项目"
        name = f"{proj_name}-{scene_tag}-{task['model_version']}"

    # 查重：同名冲突 → 报错（单条）或加序号（批量）
    dup = db.execute(
        "SELECT id FROM word_card WHERE group_id=? AND name=? AND is_deleted=0",
        [gid, name]).fetchone()
    if dup and not allow_dup_suffix:
        raise HTTPException(400, f"同名模版已存在: {name}")
    while dup and allow_dup_suffix:
        base = name
        idx = 2
        while True:
            name = f"{base}-{idx}"
            if not db.execute(
                "SELECT id FROM word_card WHERE group_id=? AND name=? AND is_deleted=0",
                [gid, name]).fetchone():
                break
            idx += 1
        dup = None

    cur = db.execute(
        "INSERT INTO word_card (group_id, name, content, meaning, media_type, preview_media, is_builtin, heat_weight, module, category, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, 'video', ?, 0, 0.5, 'seedance_video', 'video_template', datetime('now','localtime'), datetime('now','localtime'))",
        [gid, name, task["prompt"] or "", f"分镜视频模版 · {task['model_version']} · {task['ratio']} · {task['duration']}s", dest_name])
    safe_commit()
    return {"ok": True, "card_id": cur.lastrowid, "name": name, "video_url": "/api/seedance/v2/videos/" + dest_name}


@router.post("/video/tasks/{task_id}/archive-template")
def archive_task_as_template(task_id: int, data: dict = Body(default={})):
    """将成功的视频生成任务存档为分镜视频模版词卡
    body: { name: 可选模版名 }
    """
    return _archive_task_to_template(task_id, (data.get("name") or "").strip(), allow_dup_suffix=False)


@router.post("/video/tasks/archive-batch")
def archive_batch(data: dict = Body(default={})):
    """批量存档：将指定/全部成功任务存档为模版词卡（同名自动加序号）
    body: { task_ids: [可选，缺省=全部成功任务] }
    """
    _ensure_video_task_table()
    ids = data.get("task_ids")
    if not ids:
        db = get_db()
        rows = db.execute(
            "SELECT id FROM seedance_video_tasks WHERE status='success' ORDER BY id DESC").fetchall()
        ids = [r["id"] for r in rows]
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "没有可存档的成功任务")
    if len(ids) > 200:
        raise HTTPException(400, f"单次最多批量存档 200 条（当前 {len(ids)}）")
    results = []
    for tid in ids:
        try:
            r = _archive_task_to_template(int(tid), "", allow_dup_suffix=True)
            results.append({"task_id": int(tid), "ok": True, "name": r["name"]})
        except HTTPException as e:
            results.append({"task_id": int(tid), "ok": False, "error": str(e.detail)})
        except Exception as e:
            results.append({"task_id": int(tid), "ok": False, "error": str(e)})
    return {"ok": True, "results": results,
            "success": sum(1 for r in results if r["ok"]),
            "failed": sum(1 for r in results if not r["ok"])}


@router.post("/video/tasks/clear")
def clear_video_tasks(data: dict = Body(default={})):
    """清空生成历史：删除已完成/失败任务记录（可选删除本地视频文件），进行中任务保留
    body: { delete_files: bool(默认true), keep_active: bool(默认true) }
    """
    _ensure_video_task_table()
    db = get_db()
    delete_files = bool(data.get("delete_files", True))
    keep_active = bool(data.get("keep_active", True))
    cond = "status IN ('success','fail')" if keep_active else "1=1"
    rows = db.execute(f"SELECT id, result_local FROM seedance_video_tasks WHERE {cond}").fetchall()
    n = 0
    for r in rows:
        if delete_files and r["result_local"]:
            p = os.path.join(VIDEO_DIR, os.path.basename(r["result_local"]))
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception as e:
                    print(f"[Seedance Video] 历史视频删除失败 {p}: {e}")
        db.execute("DELETE FROM seedance_video_tasks WHERE id=?", [r["id"]])
        n += 1
    safe_commit()
    return {"ok": True, "deleted": n, "delete_files": delete_files, "keep_active": keep_active}


@router.post("/video/templates/{card_id}/regen")
def regen_from_template(card_id: int):
    """从模版词卡创建新分镜项目（内容=模版提示词，单镜头）"""
    db = get_db()
    card = db.execute("SELECT * FROM word_card WHERE id=? AND is_deleted=0", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "模版词卡不存在")
    content = card["content"] or ""
    if not content.strip():
        raise HTTPException(400, "模版提示词为空")
    # 创建项目
    import time as _t
    name = f"模版复用-{card['name'] or '视频模版'}"
    cur = db.execute(
        "INSERT INTO user_project (name, total_duration, aspect_ratio, resolution, global_style, created_at, updated_at) "
        "VALUES (?, 5, '16:9', '720p', '', datetime('now','localtime'), datetime('now','localtime'))",
        [name])
    pid = cur.lastrowid
    # 单镜头：把模版提示词作为 scene_desc 的补充（拆 @Tag 前缀后作为完整提示词存 details）
    db.execute(
        "INSERT INTO user_project_scene (project_id, scene_order, start_time, end_time, duration, is_locked, details, created_at) "
        "VALUES (?, 1, 0, 5, 5, 0, ?, datetime('now','localtime'))",
        [pid, content])
    safe_commit()
    return {"ok": True, "project_id": pid, "project_name": name, "prompt": content}


@router.delete("/video/templates/{card_id}")
def delete_video_template(card_id: int):
    """删除分镜视频模版词卡（含视频文件）"""
    db = get_db()
    card = db.execute("SELECT * FROM word_card WHERE id=? AND is_deleted=0", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "模版词卡不存在")
    if card["preview_media"]:
        p = os.path.join(WC_VIDEO_DIR, card["preview_media"])
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception as e:
                print(f"[Seedance Video] 模版视频删除失败 {p}: {e}")
    db.execute("UPDATE word_card SET is_deleted=1, deleted_at=datetime('now','localtime') WHERE id=?", [card_id])
    safe_commit()
    return {"ok": True}


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


@router.post("/video/precheck")
def precheck_video_tasks(data: dict = Body(...)):
    """提交前预检：逐镜头检查内容/参考图/时长/会话，返回问题清单（不消耗额度）
    body: { project_id, scope, scene_ids?, model_version, ratio, resolution, session }
    """
    _ensure_project_video_cols()
    _ensure_video_task_table()
    project_id = data.get("project_id")
    if not project_id:
        raise HTTPException(400, "project_id 必填")
    db = get_db()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj:
        raise HTTPException(404, "分镜项目不存在")
    model = data.get("model_version") or proj["video_model"] or "seedance2.0fast"
    resolution = data.get("resolution") or proj["video_resolution"] or "720p"
    session = int(data.get("session", proj["video_session"] or 0))

    issues = []
    warnings = []
    info = []

    # 1. 会话有效性
    valid_s = _valid_session(session, force=True)
    if valid_s != session:
        issues.append({"level": "warn", "item": "会话", "detail": f"会话 {session} 无效，将回退默认会话 0"})

    # 2. 分辨率合规
    res_ok = _valid_resolution(model, resolution)
    if res_ok != resolution:
        warnings.append({"level": "warn", "item": "分辨率", "detail": f"{resolution} 超出 {model} 上限，将降级为 {res_ok}"})

    # 3. 镜头检查
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
        issues.append({"level": "error", "item": "镜头", "detail": "项目没有镜头"})

    scene_items = []
    for s in rows:
        sp = _build_scene_prompt(dict(s), proj["global_style"] or "")
        refs = _collect_refs(project_id, s["id"])
        item = {"scene_id": s["id"], "scene_order": s["scene_order"],
                "has_content": bool(sp.strip()), "ref_count": len(refs),
                "refs": [{"ref_type": r["ref_type"], "ref_name": r["ref_name"]} for r in refs],
                "duration": s["duration"] or 5}
        problems = []
        if not sp.strip():
            problems.append("无内容（镜头字段为空）")
        if len(refs) > 9:
            problems.append(f"参考图 {len(refs)} 张超上限 9")
        for r in refs:
            if r["ref_type"] == "character" and not (r["ref_name"] or "").strip():
                problems.append("角色参考图未命名（提示词对应弱）")
        if problems:
            item["problems"] = problems
            issues.append({"level": "error" if "无内容" in problems else "warn",
                           "item": f"镜头{s['scene_order']}", "detail": "；".join(problems)})
        scene_items.append(item)

    # 4. 时长提示
    mn, mx, _ = _MODEL_LIMITS.get(model, _DEFAULT_LIMITS)
    for it in scene_items:
        dur = int(float(it["duration"] or 5))
        if dur < mn:
            warnings.append({"level": "info", "item": f"镜头{it['scene_order']} 时长",
                             "detail": f"{dur}s 低于模型下限 {mn}s，将自动用 {mn}s"})

    return {"ok": True, "scene_items": scene_items, "issues": issues, "warnings": warnings,
            "summary": {"scene_count": len(scene_items),
                        "error_count": sum(1 for i in issues if i["level"] == "error"),
                        "warn_count": len(warnings) + sum(1 for i in issues if i["level"] == "warn")}}


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
    video_session = _valid_session(int(data.get("session", proj["video_session"] or 0)), force=True)
    # 无效会话回退 0 时提示
    session_fallback = video_session != int(data.get("session", proj["video_session"] or 0))
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
        if refs:
            full = _build_ref_aware_prompt(full, refs)
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
            # v5.36.5: 参考图模式提示词规范（图声明段 + 动态描述）
            if refs:
                sp = _build_ref_aware_prompt(sp, refs)
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
            "model_version": model, "ratio": ratio, "video_resolution": resolution,
            "sessions": [{"id": s[0], "name": s[1]} for s in _fetch_session_list()],
            "session_fallback": session_fallback if 'session_fallback' in dir() else False}


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
    items = [dict(r) for r in rows]
    # v5.36.8: 附带统计（前端完成通知/聚合进度用）
    stats = {}
    if project_id:
        stats = {"total": 0, "done": 0, "fail": 0, "active": 0}
        for r2 in db.execute(
            "SELECT status, COUNT(*) as c FROM seedance_video_tasks WHERE project_id=? GROUP BY status",
            [project_id]).fetchall():
            s = r2["status"]
            if s == "success":
                stats["done"] = r2["c"]
            elif s == "fail":
                stats["fail"] = r2["c"]
            else:
                stats["active"] += r2["c"]
            stats["total"] += r2["c"]
    return {"items": items, "stats": stats}


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
                 started_at="", finished_at="", progress=0)
    threading.Thread(target=_video_worker, args=(task_id,), daemon=True).start()
    return {"ok": True}


@router.get("/video/files/{filename}")
def get_video_file(filename: str):
    """下载生成结果视频"""
    fpath = os.path.join(VIDEO_DIR, os.path.basename(filename))
    if not os.path.exists(fpath):
        raise HTTPException(404, "视频文件不存在")
    return FileResponse(fpath, media_type="video/mp4", filename=filename)
