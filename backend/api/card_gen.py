# -*- coding: utf-8 -*-
"""
v5.37.0: 词卡 AI 生成队列（高清/图生图/文生图/视频生成）
- 产物自动归档为「词卡生成历史」（card_gen_tasks，不新建词卡）
- 生成完成自动设为当前预览（更新 word_card 四字段）；用户可随时切换历史产物
- 批量入队（文生图/图生图/视频）；仅团队模式可用（后端 403 兜底）
存储：图片 data/originals/ + data/thumbnails/（复用 save_generated_image）
      视频 data/card_gen/videos/ + poster data/thumbnails/
"""
import json
import os
import re
import threading

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel

from jwt_auth import get_current_user

router = APIRouter(tags=["card-gen"])

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from paths import get_data_dir
    DATA_DIR = get_data_dir()
except Exception:
    DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "data"))
DB = os.path.join(DATA_DIR, "prompts.db")
THUMB_DIR = os.path.join(DATA_DIR, "thumbnails")
ORIGINALS_DIR = os.path.join(DATA_DIR, "originals")
CARD_GEN_DIR = os.path.join(DATA_DIR, "card_gen")
CARD_GEN_VIDEO_DIR = os.path.join(CARD_GEN_DIR, "videos")
os.makedirs(THUMB_DIR, exist_ok=True)
os.makedirs(ORIGINALS_DIR, exist_ok=True)
os.makedirs(CARD_GEN_VIDEO_DIR, exist_ok=True)

# 全局串行：词卡生成任务一次只跑一个（防 CLI 并发 + 即梦 ExceedConcurrencyLimit）
_GEN_QUEUE_LOCK = threading.Lock()
_RESUME_STARTED = False

TASK_TYPES = ("upscale", "image2image", "text2image", "text2video", "image2video")
TYPE_LABELS = {"upscale": "高清", "image2image": "图生图", "text2image": "文生图",
               "text2video": "文生视频", "image2video": "图生视频"}
IMAGE_TYPES = ("upscale", "image2image", "text2image")
VIDEO_TYPES = ("text2video", "image2video")


def _db():
    c = __import__("sqlite3").connect(DB, timeout=5)
    c.row_factory = __import__("sqlite3").Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=4000")
    return c


def _auth(request, require=True):
    u = get_current_user(request)
    if require and not (u and u.get("authenticated")):
        raise HTTPException(401, "请先登录")
    return u


def _team_active() -> bool:
    """团队版激活状态（card-gen 仅团队模式可用）"""
    try:
        from api.license import license_info
        d = license_info()
        return bool(d.get("tiers", {}).get("team", {}).get("active"))
    except Exception:
        return False


def _team_guard(request):
    _auth(request)
    if not _team_active():
        raise HTTPException(403, "词卡 AI 生成为团队版专属功能，请先激活团队版")


# ==================== 表 ====================

def _ensure_card_gen_table():
    c = _db()
    try:
        c.execute("""CREATE TABLE IF NOT EXISTS card_gen_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER NOT NULL,
            task_type TEXT NOT NULL,
            engine TEXT DEFAULT 'dreamina',
            source_image TEXT DEFAULT '',
            prompt TEXT DEFAULT '',
            model_version TEXT DEFAULT '',
            ratio TEXT DEFAULT '1:1',
            resolution_type TEXT DEFAULT '',
            duration INTEGER DEFAULT 5,
            video_resolution TEXT DEFAULT '',
            session INTEGER DEFAULT 0,
            submit_id TEXT DEFAULT '',
            status TEXT DEFAULT 'queued',
            progress INTEGER DEFAULT 0,
            media_type TEXT DEFAULT '',
            result_filename TEXT DEFAULT '',
            result_original TEXT DEFAULT '',
            poster_filename TEXT DEFAULT '',
            is_current INTEGER DEFAULT 0,
            fail_category TEXT DEFAULT '',
            error TEXT DEFAULT '',
            creator_id INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            finished_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_card_gen_card ON card_gen_tasks(card_id, id)")
        c.commit()
    finally:
        c.close()


def _task_update(tid: int, **kw):
    c = _db()
    try:
        if kw:
            sets = ["%s=?" % k for k in kw]
            vals = list(kw.values()) + [tid]
            c.execute("UPDATE card_gen_tasks SET %s, updated_at=datetime('now','localtime') WHERE id=?" % ", ".join(sets), vals)
            c.commit()
    finally:
        c.close()


def _task_dict(r, with_card_name=True):
    d = dict(r)
    d["task_type_label"] = TYPE_LABELS.get(r["task_type"], r["task_type"])
    if with_card_name and d.get("card_id"):
        try:
            c = _db()
            try:
                card = c.execute("SELECT name, content FROM word_card WHERE id=?", [d["card_id"]]).fetchone()
                if card:
                    d["card_name"] = card["name"] or (card["content"] or "")[:40]
                else:
                    d["card_name"] = ""
            finally:
                c.close()
        except Exception:
            d["card_name"] = ""
    d["preview_url"] = ""
    if d.get("media_type") == "video" and d.get("result_filename"):
        d["preview_url"] = f"/api/thumbnails/video/{d['result_filename']}"
    elif d.get("media_type") == "image" and d.get("result_filename"):
        d["preview_url"] = f"/api/thumbnails/file/{d['result_filename']}"
    d.pop("source_image", None)
    return d


# ==================== 词卡原图解析 ====================

def _resolve_card_original_path(card_id: int) -> str:
    """解析词卡原图本地路径（多目录探测，对齐 media.serve_original）"""
    c = _db()
    try:
        row = c.execute("SELECT original_ref, thumbnail, preview_media FROM word_card WHERE id=?", [card_id]).fetchone()
    finally:
        c.close()
    if not row:
        return ""
    cands = []
    for v in (row["original_ref"], row["thumbnail"], row["preview_media"]):
        if v:
            cands.append(os.path.basename(v))
    dirs = [
        os.path.join(DATA_DIR, "originals"),
        os.path.join(DATA_DIR, "wc_media", "originals"),
        os.path.join(DATA_DIR, "comfyui_outputs"),
        os.path.join(DATA_DIR, "dreamina_assets", "images"),
        os.path.join(DATA_DIR, "thumbnails"),
    ]
    for fname in cands:
        for d in dirs:
            p = os.path.join(d, fname)
            if os.path.isfile(p):
                return p
    return ""


def _compress_img(src_path: str) -> str:
    """压缩图片（≤1024px / JPEG q80），解决 CLI 大图上传超时（v5.36.7 教训）"""
    try:
        import io as _io
        from PIL import Image
        im = Image.open(src_path)
        im.thumbnail((1024, 1024), Image.LANCZOS)
        if im.mode in ("RGBA", "P"):
            im = im.convert("RGB")
        buf = _io.BytesIO()
        im.save(buf, "JPEG", quality=80)
        tmp = os.path.join(CARD_GEN_DIR, "tmp_%s.jpg" % __import__("uuid").uuid4().hex[:10])
        with open(tmp, "wb") as f:
            f.write(buf.getvalue())
        return tmp
    except Exception:
        return src_path


# ==================== 轮询（图片/视频） ====================

def _poll_dreamina_image(submit_id: str, timeout_sec: int = 900):
    """轮询即梦 query_result 直到终态，成功返回 (img_bytes, None)"""
    import time as _t
    import tempfile
    import glob as _glob
    from api.dreamina import _dreamina_run
    deadline = _t.time() + timeout_sec
    while _t.time() < deadline:
        out, err, code = _dreamina_run(["query_result", "--submit_id=" + str(submit_id)], timeout=60)
        data = None
        for cand in reversed(re.findall(r"\{.*\}", out, re.S)):
            try:
                d = json.loads(cand)
                if isinstance(d, dict) and "gen_status" in d:
                    data = d
                    break
            except Exception:
                continue
        if not data:
            if "not found" in (err or "").lower():
                return None, f"即梦任务不存在: {(err or out)[:150]}"
            _t.sleep(10)
            continue
        status = data.get("gen_status", "querying")
        if status == "success":
            url = ""
            try:
                rj = data.get("result_json") or {}
                imgs = rj.get("images") or rj.get("results") or []
                for im in imgs:
                    if im.get("image_url"):
                        url = im["image_url"]
                        break
            except Exception:
                pass
            if url:
                try:
                    import httpx
                    with httpx.Client(timeout=180) as cl:
                        r = cl.get(url)
                        if r.status_code == 200:
                            return r.content, None
                except Exception as e:
                    return None, f"图片下载失败: {e}"
            tmpd = tempfile.mkdtemp(prefix="cg_dl_")
            try:
                out2, err2, code2 = _dreamina_run(
                    ["query_result", "--submit_id=" + str(submit_id), "--download_dir=" + tmpd], timeout=300)
                paths = []
                try:
                    d2 = json.loads(out2)
                    rj2 = d2.get("result_json") or {}
                    paths = [i.get("path") for i in (rj2.get("images") or []) if i.get("path")]
                except Exception:
                    pass
                for p in paths:
                    if p and os.path.isfile(p):
                        with open(p, "rb") as f:
                            return f.read(), None
                fs = _glob.glob(os.path.join(tmpd, "*"))
                if fs:
                    with open(fs[0], "rb") as f:
                        return f.read(), None
            finally:
                import shutil
                shutil.rmtree(tmpd, ignore_errors=True)
            return None, "即梦任务成功但未找到图片文件"
        if status == "fail":
            reason = (data.get("fail_reason") or "").strip()
            return None, reason or "即梦生成失败"
        _t.sleep(8)
    return None, f"轮询超时({timeout_sec}s)"


def _poll_dreamina_video(submit_id: str, timeout_sec: int = 900):
    """轮询即梦 query_result 直到终态，成功返回 (video_bytes, None)"""
    import time as _t
    from api.dreamina import _dreamina_run
    deadline = _t.time() + timeout_sec
    while _t.time() < deadline:
        out, err, code = _dreamina_run(["query_result", "--submit_id=" + str(submit_id)], timeout=60)
        data = None
        for cand in reversed(re.findall(r"\{.*\}", out, re.S)):
            try:
                d = json.loads(cand)
                if isinstance(d, dict) and "gen_status" in d:
                    data = d
                    break
            except Exception:
                continue
        if not data:
            if "not found" in (err or "").lower():
                return None, f"即梦任务不存在: {(err or out)[:150]}"
            _t.sleep(10)
            continue
        status = data.get("gen_status", "querying")
        if status == "success":
            url = ""
            try:
                rj = data.get("result_json") or {}
                vids = rj.get("videos") or rj.get("results") or []
                for v in vids:
                    if v.get("video_url"):
                        url = v["video_url"]
                        break
            except Exception:
                pass
            if not url:
                m = re.search(r'"video_url"\s*:\s*"([^"]+)"', out)
                if m:
                    url = m.group(1)
            if url:
                try:
                    import httpx
                    with httpx.Client(timeout=300) as cl:
                        r = cl.get(url)
                        if r.status_code == 200:
                            return r.content, None
                except Exception as e:
                    return None, f"视频下载失败: {e}"
            return None, "即梦任务成功但未找到视频 URL"
        if status == "fail":
            reason = (data.get("fail_reason") or "").strip()
            return None, reason or "即梦生成失败"
        _t.sleep(8)
    return None, f"轮询超时({timeout_sec}s)"


# ==================== 产物归档 ====================

def _mark_current(c, card_id: int, task_id: int):
    """同卡其他记录取消当前，本记录设为当前"""
    c.execute("UPDATE card_gen_tasks SET is_current=0 WHERE card_id=?", [card_id])
    c.execute("UPDATE card_gen_tasks SET is_current=1 WHERE id=?", [task_id])


def _archive_image_result(task_id: int, card_id: int, img_bytes: bytes, submit_id: str):
    """图片产物归档：save_generated_image（原图+缩略图+词卡字段自动更新）"""
    from api.thumb_gen import save_generated_image
    saved = save_generated_image(img_bytes, card_id, "word_card", "dreamina", submit_id)
    if not saved.get("ok"):
        return saved.get("error", "图片落库失败")
    c = _db()
    try:
        _mark_current(c, card_id, task_id)
        c.execute("""UPDATE card_gen_tasks SET media_type='image',
                     result_filename=?, result_original=? WHERE id=?""",
                  [saved["thumbnail"], saved.get("original", ""), task_id])
        c.commit()
    finally:
        c.close()
    return None


def _make_video_poster(video_path: str) -> str:
    """ffmpeg 提取首帧为 poster，存 thumbnails/，返回文件名"""
    import subprocess
    import uuid as _uuid
    base = _uuid.uuid4().hex
    poster = base + ".jpg"
    try:
        subprocess.run(
            ["ffmpeg", "-ss", "0.1", "-i", video_path, "-vframes", "1",
             "-q:v", "2", os.path.join(THUMB_DIR, poster), "-y"],
            capture_output=True, timeout=30)
        if os.path.isfile(os.path.join(THUMB_DIR, poster)):
            return poster
    except Exception:
        pass
    return ""


def _archive_video_result(task_id: int, card_id: int, video_bytes: bytes):
    """视频产物归档：存 card_gen/videos/ + poster + 词卡字段更新"""
    import uuid as _uuid
    base = _uuid.uuid4().hex
    fname = "cg_%s.mp4" % base
    vpath = os.path.join(CARD_GEN_VIDEO_DIR, fname)
    with open(vpath, "wb") as f:
        f.write(video_bytes)
    poster = _make_video_poster(vpath)
    c = _db()
    try:
        c.execute("""UPDATE word_card SET thumbnail=?, preview_media=?, original_ref='',
                     media_type='video', updated_at=datetime('now','localtime') WHERE id=?""",
                  [poster, fname, card_id])
        _mark_current(c, card_id, task_id)
        c.execute("""UPDATE card_gen_tasks SET media_type='video',
                     result_filename=?, poster_filename=? WHERE id=?""",
                  [fname, poster, task_id])
        c.commit()
    finally:
        c.close()
    return None


def _activate_task(task_id: int):
    """用户切换：将指定生成记录设为词卡当前预览"""
    c = _db()
    try:
        t = c.execute("SELECT * FROM card_gen_tasks WHERE id=?", [task_id]).fetchone()
        if not t:
            raise HTTPException(404, "生成记录不存在")
        if t["status"] != "success" or not t["result_filename"]:
            raise HTTPException(400, "该记录无可用产物")
        card_id = t["card_id"]
        if t["media_type"] == "video":
            c.execute("""UPDATE word_card SET thumbnail=?, preview_media=?, original_ref='',
                         media_type='video', updated_at=datetime('now','localtime') WHERE id=?""",
                      [t["poster_filename"], t["result_filename"], card_id])
        else:
            c.execute("""UPDATE word_card SET thumbnail=?, preview_media='',
                         original_ref=?, media_type='image', updated_at=datetime('now','localtime') WHERE id=?""",
                      [t["result_filename"], t["result_original"] or t["result_filename"], card_id])
        _mark_current(c, card_id, task_id)
        c.commit()
        return {"ok": True, "media_type": t["media_type"]}
    finally:
        c.close()


# ==================== worker ====================

def _submit_task(task) -> dict:
    """按 task_type 分发 CLI 提交（--poll 0），返回 {ok, submit_id}"""
    if hasattr(task, "keys"):
        task = dict(task)  # sqlite3.Row → dict（Row 无 .get）
    from api.dreamina import (dreamina_submit_image2image, dreamina_submit_image2video,
                              dreamina_submit_text2image, dreamina_submit_text2video,
                              dreamina_submit_upscale)
    ttype = task["task_type"]
    prompt = task["prompt"] or ""
    src = ""
    if task.get("source_image"):
        src = os.path.join(DATA_DIR, task["source_image"].replace("/", os.sep))
        if not os.path.isfile(src):
            # 兼容直接存文件名
            src = _resolve_card_original_path(task["card_id"]) or src
        if os.path.isfile(src):
            src = _compress_img(src)
    if ttype == "upscale":
        return dreamina_submit_upscale(src or _resolve_card_original_path(task["card_id"]),
                                       resolution_type=task["resolution_type"] or "4k")
    if ttype == "image2image":
        if not (src and os.path.isfile(src)):
            return {"ok": False, "error": "词卡无原图，无法图生图"}
        return dreamina_submit_image2image([src], prompt=prompt, model_version=task["model_version"] or "5.0",
                                           ratio=task["ratio"] or "1:1", resolution_type=task["resolution_type"] or "2k")
    if ttype == "text2image":
        return dreamina_submit_text2image(prompt=prompt, model_version=task["model_version"] or "5.0",
                                          ratio=task["ratio"] or "1:1", resolution_type=task["resolution_type"] or "2k")
    if ttype == "text2video":
        return dreamina_submit_text2video(prompt=prompt, model_version=task["model_version"] or "seedance2.0_vip",
                                          ratio=task["ratio"] or "16:9", duration=task["duration"] or 5,
                                          video_resolution=task["video_resolution"] or "720p",
                                          session=task["session"] or 0)
    if ttype == "image2video":
        if not (src and os.path.isfile(src)):
            return {"ok": False, "error": "词卡无原图，无法图生视频"}
        return dreamina_submit_image2video(src, prompt=prompt, model_version=task["model_version"] or "seedance2.0_vip",
                                           duration=task["duration"] or 5,
                                           video_resolution=task["video_resolution"] or "720p",
                                           session=task["session"] or 0)
    return {"ok": False, "error": f"未知任务类型 {ttype}"}


def _classify_error(reason: str) -> str:
    r = (reason or "").lower()
    if "concurrency" in r or "1310" in r:
        return "concurrency"
    if "param" in r or "1001" in r:
        return "param"
    if "compliance" in r or "confirm" in r:
        return "compliance"
    if "upload" in r or "file" in r:
        return "upload"
    if "timeout" in r or "deadline" in r:
        return "timeout"
    if "login" in r or "unauthorized" in r or "401" in r:
        return "login"
    if "final generation" in r or "generation failed" in r:
        return "gen_failed"
    return "other"


def _card_gen_worker(task_id: int):
    """任务执行体：提交 → 轮询 → 下载 → 归档（全局锁串行）"""
    with _GEN_QUEUE_LOCK:
        c = _db()
        try:
            t = c.execute("SELECT * FROM card_gen_tasks WHERE id=?", [task_id]).fetchone()
        finally:
            c.close()
        if not t or t["status"] in ("success", "fail"):
            return
        card_id = t["card_id"]
        ttype = t["task_type"]
        _task_update(task_id, status="submitting", progress=10)
        try:
            # 未提交 → 提交
            submit_id = (t["submit_id"] or "").strip()
            if not submit_id:
                res = _submit_task(t)
                if not res.get("ok"):
                    _task_update(task_id, status="fail", error=res.get("error", "提交失败"),
                                 progress=100, finished_at=_now_str(),
                                 fail_category=_classify_error(res.get("error", "")))
                    return
                submit_id = res["submit_id"]
                _task_update(task_id, status="querying", submit_id=submit_id, progress=15)
                if res.get("gen_status") == "fail":
                    _task_update(task_id, status="fail", error="即梦拒绝提交",
                                 progress=100, finished_at=_now_str(), fail_category="param")
                    return
            else:
                _task_update(task_id, status="querying", progress=15)
            # 轮询 + 下载 + 归档
            if ttype in IMAGE_TYPES:
                img_bytes, err = _poll_dreamina_image(submit_id)
                if err:
                    _task_update(task_id, status="fail", error=err, progress=100,
                                 finished_at=_now_str(), fail_category=_classify_error(err))
                    return
                err2 = _archive_image_result(task_id, card_id, img_bytes, submit_id)
                if err2:
                    _task_update(task_id, status="fail", error=err2, progress=100,
                                 finished_at=_now_str())
                    return
            else:  # video
                video_bytes, err = _poll_dreamina_video(submit_id)
                if err:
                    _task_update(task_id, status="fail", error=err, progress=100,
                                 finished_at=_now_str(), fail_category=_classify_error(err))
                    return
                err2 = _archive_video_result(task_id, card_id, video_bytes)
                if err2:
                    _task_update(task_id, status="fail", error=err2, progress=100,
                                 finished_at=_now_str())
                    return
            _task_update(task_id, status="success", progress=100, finished_at=_now_str())
        except Exception as e:
            _task_update(task_id, status="fail", error=f"生成异常: {e}", progress=100,
                         finished_at=_now_str(), fail_category="other")


def _now_str():
    import datetime
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _resume_orphaned_card_gen_tasks():
    """启动时接管 queued/submitting/querying 任务"""
    global _RESUME_STARTED
    if _RESUME_STARTED:
        return
    _RESUME_STARTED = True
    try:
        _ensure_card_gen_table()
        c = _db()
        try:
            rows = c.execute(
                "SELECT id FROM card_gen_tasks WHERE status IN ('queued','submitting','querying')").fetchall()
        finally:
            c.close()
        for r in rows:
            threading.Thread(target=_card_gen_worker, args=(r["id"],), daemon=True).start()
    except Exception as e:
        print(f"[CardGen] 孤儿任务接管失败: {e}")


# ==================== 校验 ====================

def _validate_params(ttype: str, params: dict) -> dict:
    """参数归一化 + 严格校验（400 不静默降级）"""
    p = dict(params or {})
    if ttype == "upscale":
        res = str(p.get("resolution_type") or "4k")
        if res not in ("2k", "4k", "8k"):
            raise HTTPException(400, "高清分辨率必须是 2k/4k/8k")
        p["resolution_type"] = res
    elif ttype in ("image2image", "text2image"):
        model = str(p.get("model_version") or "5.0")
        if model not in ("3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"):
            raise HTTPException(400, "无效模型版本")
        res = str(p.get("resolution_type") or "2k")
        if res not in ("1k", "2k", "4k"):
            raise HTTPException(400, "无效分辨率")
        ratio = str(p.get("ratio") or "1:1")
        if ratio not in ("21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"):
            raise HTTPException(400, "无效比例")
        p.update(model_version=model, resolution_type=res, ratio=ratio)
    elif ttype in ("text2video", "image2video"):
        model = str(p.get("model_version") or "seedance2.0_vip")
        if model not in ("seedance1.5pro", "seedance2.0", "seedance2.0fast", "seedance2.0_vip",
                         "seedance2.0fast_vip", "seedance2.0mini", "seedance2.5"):
            raise HTTPException(400, "无效视频模型")
        try:
            dur = int(p.get("duration") or 5)
        except Exception:
            raise HTTPException(400, "无效时长")
        if not (4 <= dur <= 30):
            raise HTTPException(400, "时长范围 4-30s")
        res = str(p.get("video_resolution") or "720p")
        if res not in ("480p", "720p", "1080p", "4k"):
            raise HTTPException(400, "无效视频分辨率")
        if model == "seedance2.5" and res not in ("480p", "720p"):
            raise HTTPException(400, "seedance2.5 仅支持 480p/720p")
        if model == "seedance2.0_vip" and res not in ("720p", "1080p", "4k"):
            raise HTTPException(400, "seedance2.0_vip 仅支持 720p/1080p/4k")
        if model not in ("seedance2.5", "seedance2.0_vip") and res != "720p":
            raise HTTPException(400, f"{model} 仅支持 720p")
        # 时长上限对齐 CLI（seedance1.5pro: 5-12s；seedance2.5: 4-30s；其余: 4-15s）
        if model == "seedance1.5pro" and not (5 <= dur <= 12):
            raise HTTPException(400, "seedance1.5pro 时长范围 5-12s")
        if model != "seedance2.5" and model != "seedance1.5pro" and dur > 15:
            raise HTTPException(400, f"{model} 时长上限 15s")
        p.update(model_version=model, video_resolution=res, duration=dur)
        if ttype == "text2video":
            ratio = str(p.get("ratio") or "16:9")
            if ratio not in ("21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"):
                raise HTTPException(400, "无效比例")
            p["ratio"] = ratio
    else:
        raise HTTPException(400, f"未知任务类型 {ttype}")
    return p


def _create_tasks(card_ids, ttype, params, u) -> list:
    """批量建任务，返回 [{card_id, task_id}]"""
    out = []
    c = _db()
    try:
        for cid in card_ids:
            card = c.execute("SELECT id, content, original_ref FROM word_card WHERE id=? AND is_deleted=0", [cid]).fetchone()
            if not card:
                continue
            prompt = (params.get("prompt") or "").strip() or (card["content"] or "")
            if not prompt and ttype in ("text2image", "text2video"):
                continue
            cur = c.execute(
                """INSERT INTO card_gen_tasks (card_id, task_type, prompt, source_image, model_version,
                   ratio, resolution_type, duration, video_resolution, session, creator_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                [cid, ttype, prompt, card["original_ref"] or "",
                 params.get("model_version", ""), params.get("ratio", ""),
                 params.get("resolution_type", ""), params.get("duration", 5),
                 params.get("video_resolution", ""), params.get("session", 0), u.get("id")])
            out.append({"card_id": cid, "task_id": cur.lastrowid})
        c.commit()
    finally:
        c.close()
    return out


# ==================== API ====================

class CardGenRequest(BaseModel):
    card_id: int
    task_type: str
    params: dict = {}


class CardGenBatchRequest(BaseModel):
    card_ids: list[int]
    task_type: str
    params: dict = {}


@router.get("/api/team/status")
def team_status(request: Request):
    """团队版激活状态（前端渲染词卡生成按钮的前置判定）"""
    _auth(request)
    return {"ok": True, "team_active": _team_active()}


@router.get("/api/card-gen/capabilities")
def card_gen_capabilities(request: Request):
    """能力清单 + 参数约束（前端渲染下拉）"""
    _auth(request)
    return {
        "ok": True,
        "team_active": _team_active(),
        "task_types": {
            "upscale": {"label": "高清", "resolutions": ["2k", "4k", "8k"]},
            "image2image": {"label": "图生图", "models": ["3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"],
                            "ratios": ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
                            "resolutions": ["1k", "2k", "4k"]},
            "text2image": {"label": "文生图", "models": ["3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"],
                           "ratios": ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
                           "resolutions": ["1k", "2k", "4k"]},
            "text2video": {"label": "文生视频", "models": ["seedance1.5pro", "seedance2.0", "seedance2.0fast",
                           "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini", "seedance2.5"],
                           "ratios": ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
                           "video_resolutions": ["480p", "720p", "1080p", "4k"], "duration_min": 4, "duration_max": 30},
            "image2video": {"label": "图生视频", "models": ["seedance1.5pro", "seedance2.0", "seedance2.0fast",
                            "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini", "seedance2.5"],
                            "video_resolutions": ["480p", "720p", "1080p", "4k"], "duration_min": 4, "duration_max": 30},
        },
    }


@router.post("/api/card-gen/tasks")
def create_card_gen_task(data: CardGenRequest, request: Request):
    """单卡生成任务入队"""
    _team_guard(request)
    if data.task_type not in TASK_TYPES:
        raise HTTPException(400, "无效任务类型")
    params = _validate_params(data.task_type, data.params)
    u = _auth(request)
    created = _create_tasks([data.card_id], data.task_type, params, u)
    if not created:
        raise HTTPException(400, "词卡不存在或内容为空")
    tid = created[0]["task_id"]
    threading.Thread(target=_card_gen_worker, args=(tid,), daemon=True).start()
    return {"ok": True, "task_id": tid, "card_id": data.card_id}


@router.post("/api/card-gen/batch")
def create_card_gen_batch(data: CardGenBatchRequest, request: Request):
    """批量生成任务入队（逐卡一条，worker 串行）"""
    _team_guard(request)
    if data.task_type not in TASK_TYPES:
        raise HTTPException(400, "无效任务类型")
    if not data.card_ids:
        raise HTTPException(400, "card_ids 不能为空")
    if len(data.card_ids) > 200:
        raise HTTPException(400, "单次批量最多 200 张")
    params = _validate_params(data.task_type, data.params)
    u = _auth(request)
    created = _create_tasks(data.card_ids, data.task_type, params, u)
    for item in created:
        threading.Thread(target=_card_gen_worker, args=(item["task_id"],), daemon=True).start()
    return {"ok": True, "count": len(created), "tasks": created}


@router.get("/api/card-gen/tasks")
def list_card_gen_tasks(request: Request, card_id: int = Query(None),
                        status: str = Query(None), active: int = Query(None),
                        limit: int = Query(50, ge=1, le=200)):
    """生成任务列表（?card_id= 词卡生成历史；?active=1 队列活动任务）"""
    _auth(request)
    _ensure_card_gen_table()
    sql = "SELECT * FROM card_gen_tasks WHERE 1=1"
    args = []
    if card_id:
        sql += " AND card_id=?"
        args.append(card_id)
    if status:
        sql += " AND status=?"
        args.append(status)
    if active == 1:
        sql += " AND status IN ('queued','submitting','querying')"
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    c = _db()
    try:
        rows = c.execute(sql, args).fetchall()
        return {"ok": True, "tasks": [_task_dict(r) for r in rows]}
    finally:
        c.close()


@router.get("/api/card-gen/history-summary")
def card_gen_history_summary(request: Request, card_ids: str = ""):
    """批量查询词卡生成历史概要（卡片切换器用）：每卡成功产物数 + 当前产物类型"""
    _auth(request)
    _ensure_card_gen_table()
    ids = [int(x) for x in card_ids.split(",") if x.strip().isdigit()]
    if not ids:
        return {"ok": True, "summaries": {}}
    out = {}
    c = _db()
    try:
        ph = ",".join("?" * len(ids))
        rows = c.execute(
            "SELECT card_id, COUNT(1) n FROM card_gen_tasks "
            "WHERE card_id IN (%s) AND status='success' AND result_filename!='' GROUP BY card_id" % ph, ids).fetchall()
        for r in rows:
            out[str(r["card_id"])] = {"count": r["n"], "current": None}
        cur_rows = c.execute(
            "SELECT card_id, media_type FROM card_gen_tasks WHERE card_id IN (%s) AND is_current=1" % ph, ids).fetchall()
        for r in cur_rows:
            if str(r["card_id"]) in out:
                out[str(r["card_id"])]["current"] = {"media_type": r["media_type"]}
    finally:
        c.close()
    return {"ok": True, "summaries": out}


@router.get("/api/card-gen/tasks/{tid}")
def get_card_gen_task(tid: int, request: Request):
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM card_gen_tasks WHERE id=?", [tid]).fetchone()
        if not r:
            raise HTTPException(404, "任务不存在")
        return {"ok": True, "task": _task_dict(r)}
    finally:
        c.close()


@router.post("/api/card-gen/tasks/{tid}/activate")
def activate_card_gen_task(tid: int, request: Request):
    """将指定生成记录设为词卡当前预览"""
    _team_guard(request)
    return _activate_task(tid)


@router.post("/api/card-gen/tasks/{tid}/retry")
def retry_card_gen_task(tid: int, request: Request):
    """失败任务重试"""
    _team_guard(request)
    c = _db()
    try:
        t = c.execute("SELECT * FROM card_gen_tasks WHERE id=?", [tid]).fetchone()
        if not t:
            raise HTTPException(404, "任务不存在")
        if t["status"] == "success":
            raise HTTPException(400, "任务已成功")
        c.execute("UPDATE card_gen_tasks SET status='queued', error='', progress=0, submit_id='', "
                  "finished_at='', updated_at=datetime('now','localtime') WHERE id=?", [tid])
        c.commit()
    finally:
        c.close()
    threading.Thread(target=_card_gen_worker, args=(tid,), daemon=True).start()
    return {"ok": True, "task_id": tid}


@router.delete("/api/card-gen/tasks/{tid}")
def delete_card_gen_task(tid: int, request: Request):
    """删除生成记录（含产物文件；不影响词卡当前预览）"""
    _team_guard(request)
    c = _db()
    try:
        t = c.execute("SELECT * FROM card_gen_tasks WHERE id=?", [tid]).fetchone()
        if not t:
            raise HTTPException(404, "任务不存在")
        for f in (t["result_filename"], t["result_original"], t["poster_filename"]):
            if not f:
                continue
            for d in (THUMB_DIR, ORIGINALS_DIR, CARD_GEN_VIDEO_DIR):
                p = os.path.join(d, f)
                if os.path.isfile(p) and os.path.abspath(p).startswith(DATA_DIR):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
        c.execute("DELETE FROM card_gen_tasks WHERE id=?", [tid])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


# 启动时接管孤儿任务（幂等）
threading.Thread(target=_resume_orphaned_card_gen_tasks, daemon=True).start()
