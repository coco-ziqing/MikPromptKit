"""
Dreamina（即梦）图片生成集成 — 词卡缩略图第二生成引擎
通过本地 dreamina CLI 提交文生图任务，下载原图并生成为词卡缩略图（与 ComfyUI 引擎同落库链路）
"""
import os, json, uuid, re, subprocess
from fastapi import APIRouter
from pydantic import BaseModel
from database import get_db, safe_commit
import httpx
from PIL import Image

router = APIRouter(prefix="/api/v2/dreamina", tags=["dreamina"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
THUMB_DIR = os.path.join(_PROJECT_ROOT, "data", "thumbnails")
ORIGINALS_DIR = os.path.join(_PROJECT_ROOT, "data", "originals")

DREAMINA_BIN = os.path.join(os.path.expanduser("~"), "bin", "dreamina.exe")

# 即梦支持的参数集合（供前端渲染）
MODEL_VERSIONS = ["3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"]
RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]
RESOLUTION_TYPES = ["1k", "2k", "4k"]


def _dreamina_run(args, timeout=300):
    """调用 dreamina CLI，返回 (stdout, stderr, returncode)"""
    try:
        r = subprocess.run([DREAMINA_BIN] + args, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
        return r.stdout or "", r.stderr or "", r.returncode
    except FileNotFoundError:
        return "", f"未找到 dreamina CLI: {DREAMINA_BIN}", -1
    except Exception as e:
        return "", str(e), -1


@router.get("/status")
def dreamina_status():
    """检查 dreamina CLI 可用性与登录状态"""
    cli_available = os.path.exists(DREAMINA_BIN)
    logged_in = False
    vip = ""
    if cli_available:
        out, err, code = _dreamina_run(["user_credit"], timeout=30)
        if '"total_credit"' in out:
            logged_in = True
            try:
                m = re.search(r'"vip_level"\s*:\s*"([^"]+)"', out)
                if m:
                    vip = m.group(1)
            except Exception:
                pass
    return {"ok": True, "cli_available": cli_available, "logged_in": logged_in, "vip_level": vip,
            "model_versions": MODEL_VERSIONS, "ratios": RATIOS, "resolution_types": RESOLUTION_TYPES}


class DreaminaGenerateRequest(BaseModel):
    prompt: str = ""
    prompt_id: int = 0              # 关联词卡/词条 id
    card_type: str = "word_card"    # word_card / prompts
    model_version: str = "5.0"
    ratio: str = "1:1"
    resolution_type: str = "2k"
    width: int = 0
    height: int = 0
    generate_num: int = 1


def dreamina_text2image(prompt: str, model_version: str = "5.0", ratio: str = "1:1",
                        resolution_type: str = "2k", width: int = 0, height: int = 0,
                        generate_num: int = 1, poll: int = 180, retries: int = 2) -> dict:
    """调用 dreamina CLI 文生图，返回 {ok, image_url, width, height, submit_id}
    即梦生成阶段偶发失败（final generation failed），自动重试 retries 次"""
    import time as _t
    last_err = ""
    for attempt in range(retries + 1):
        args = ["text2image", "--prompt", prompt, "--model_version", model_version,
                "--generate_num", str(generate_num), "--poll", str(poll)]
        if width and height:
            args += ["--width", str(width), "--height", str(height), "--resolution_type", resolution_type]
        else:
            args += ["--ratio", ratio, "--resolution_type", resolution_type]
        out, err, code = _dreamina_run(args)
        # 解析 stdout 中最后一个含 gen_status 的 JSON
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
            last_err = f"CLI 输出解析失败: {(err or out)[:250]}"
        else:
            status = data.get("gen_status", "")
            if status == "success":
                imgs = ((data.get("result_json") or {}).get("images") or [])
                if imgs:
                    return {"ok": True, "image_url": imgs[0].get("image_url", ""),
                            "width": imgs[0].get("width", 0), "height": imgs[0].get("height", 0),
                            "submit_id": data.get("submit_id", "")}
                last_err = "即梦未返回图片"
            else:
                reason = (data.get("fail_reason") or "").strip()
                last_err = f"即梦生成失败({status}): {reason or out[-200:]}"
        if attempt < retries:
            _t.sleep(2 * (attempt + 1))
    return {"ok": False, "error": last_err or "即梦生成失败"}


def save_generated_image(img_bytes: bytes, prompt_id: int, card_type: str = "word_card",
                         source: str = "dreamina", ref_id: str = "") -> dict:
    """保存生成图片：缩略图 240x160 + 原图 + 落库（word_card/prompts 同 ComfyUI 链路）
    返回 {ok, thumbnail, thumbnail_url, width, height}"""
    try:
        os.makedirs(THUMB_DIR, exist_ok=True)
        os.makedirs(ORIGINALS_DIR, exist_ok=True)
        _base = uuid.uuid4().hex
        tf = _base + ".jpg"
        tp = os.path.join(THUMB_DIR, tf)
        iw = ih = 0
        try:
            _im = Image.open(__import__("io").BytesIO(img_bytes))
            iw, ih = _im.size
            sw, sh = _im.size
            tr = 240.0 / 160.0
            sr = sw / sh
            if sr > tr:
                nw = int(sh * tr); ox = (sw - nw) // 2; _im = _im.crop((ox, 0, ox + nw, sh))
            else:
                nh = int(sw / tr); oy = (sh - nh) // 2; _im = _im.crop((0, oy, sw, oy + nh))
            _im = _im.resize((240, 160), Image.LANCZOS)
            if _im.mode in ("RGBA", "P"):
                _im = _im.convert("RGB")
            _im.save(tp, "JPEG", quality=85)
        except Exception:
            with open(tp, "wb") as f:
                f.write(img_bytes)
        of = _base + ".jpg"
        with open(os.path.join(ORIGINALS_DIR, of), "wb") as f:
            f.write(img_bytes)
        db = get_db()
        src_table = card_type if card_type in ("word_card", "prompts") else ("word_card" if card_type == "word_card" else "prompts")
        if prompt_id > 0 and src_table == "word_card":
            db.execute("UPDATE word_card SET thumbnail=?, preview_media='', media_type='image', thumb_width=?, thumb_height=?, original_ref=?, updated_at=datetime('now','localtime') WHERE id=?",
                       [tf, iw, ih, of, prompt_id])
        elif prompt_id > 0:
            db.execute("DELETE FROM prompt_videos WHERE prompt_id=?", [prompt_id])
            db.execute("INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) VALUES (?,?,'image',datetime('now','localtime'))",
                       [prompt_id, tf])
        try:
            db.execute("""INSERT OR IGNORE INTO media_assets
                (filename, original_filename, file_size, original_size, media_type, width, height, mime_type, prompt_id, source, workflow_id)
                VALUES (?,?,?,?,'image',?,?,'image/jpeg',?,?,?)""",
                [tf, of, len(img_bytes), len(img_bytes), iw, ih, prompt_id, source, ref_id])
        except Exception as e:
            print(f"[Dreamina] 媒体资产写入失败: {e}")
        safe_commit()
        return {"ok": True, "thumbnail": tf, "thumbnail_url": f"/api/thumbnails/file/{tf}",
                "width": iw, "height": ih}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/generate")
def dreamina_generate(data: DreaminaGenerateRequest):
    """单张即梦生成：文生图 → 下载 → 缩略图落库"""
    if not data.prompt or not data.prompt.strip():
        return {"ok": False, "error": "提示词为空"}
    res = dreamina_text2image(data.prompt, data.model_version, data.ratio,
                              data.resolution_type, data.width, data.height, data.generate_num)
    if not res.get("ok"):
        return {"ok": False, "error": res.get("error", "生成失败")}
    try:
        with httpx.Client(timeout=120) as cl:
            r = cl.get(res["image_url"])
            if r.status_code != 200:
                return {"ok": False, "error": f"图片下载失败 HTTP {r.status_code}"}
            img_bytes = r.content
    except Exception as e:
        return {"ok": False, "error": f"图片下载失败: {e}"}
    saved = save_generated_image(img_bytes, data.prompt_id, data.card_type, "dreamina", res.get("submit_id", ""))
    if not saved.get("ok"):
        return {"ok": False, "error": saved.get("error", "落库失败")}
    return {"ok": True, "thumbnail": saved["thumbnail"], "thumbnail_url": saved["thumbnail_url"],
            "width": saved["width"], "height": saved["height"], "submit_id": res.get("submit_id")}
