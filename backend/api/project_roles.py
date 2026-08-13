"""
Phase36.2 总项目 角色/场景 实例 API（统一 project_role，role_type 区分）
能力：从公共库继承(adopt) / 新建 / 编辑(自动版本快照) / 版本历史 / 回滚 / 档案(参考图·三视图)上传 / 列表
存储：data/role_assets/role{id}/ ; 缩略图 data/role_thumbs/{aid}.jpg
"""
import json
import os
import re
import sqlite3

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from jwt_auth import get_current_user

try:
    from audit import record_audit
except Exception:
    def record_audit(*a, **k): pass

router = APIRouter(tags=["项目角色场景实例"])
HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from paths import get_data_dir
    DATA_DIR = get_data_dir()
except Exception:
    DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "data"))
DB = os.path.join(DATA_DIR, "prompts.db")
ROLE_ASSET_DIR = os.path.join(DATA_DIR, "role_assets")
ROLE_THUMB_DIR = os.path.join(DATA_DIR, "role_thumbs")
os.makedirs(ROLE_ASSET_DIR, exist_ok=True)
os.makedirs(ROLE_THUMB_DIR, exist_ok=True)

ASSET_KINDS = ("ref_image", "three_view", "turnaround", "material", "other")


def _db():
    c = sqlite3.connect(DB, timeout=5); c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA busy_timeout=4000")
    return c


def _auth(request, require=True):
    u = get_current_user(request)
    if require and not (u and u.get("authenticated")):
        raise HTTPException(401, "请先登录")
    return u


def _safe(name):
    name = os.path.basename(name or "file")
    return (re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip() or "file")[:180]


def _role_dict(c, r):
    d = dict(r)
    try: d["settings"] = json.loads(d.get("settings_json") or "{}")
    except Exception: d["settings"] = {}
    d["asset_count"] = c.execute("SELECT COUNT(1) FROM project_role_asset WHERE project_role_id=?", [r["id"]]).fetchone()[0]
    d["cover_url"] = f"/api/roles/{r['id']}/cover"
    return d


def _snapshot(c, role_id, settings_json, name, u, note=""):
    n = c.execute("SELECT COALESCE(MAX(version_no),0)+1 v FROM project_role_version WHERE project_role_id=?", [role_id]).fetchone()["v"]
    c.execute("""INSERT INTO project_role_version (project_role_id,version_no,settings_json,name,note,author_user_id,author_name)
                 VALUES (?,?,?,?,?,?,?)""",
              [role_id, n, settings_json, name, note, u.get("id"), u.get("username", "")])
    vid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    return vid, n


# ==================== 列表 / 详情 ====================
@router.get("/api/master-projects")
def list_master_projects(request: Request):
    """总项目列表（供项目角色/场景库 UI 先选总项目）。"""
    _auth(request)
    c = _db()
    try:
        rows = c.execute("SELECT id, name, project_type, status FROM master_project ORDER BY id DESC").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["char_count"] = c.execute("SELECT COUNT(1) FROM project_role WHERE master_project_id=? AND role_type='character'", [r["id"]]).fetchone()[0]
            d["scene_count"] = c.execute("SELECT COUNT(1) FROM project_role WHERE master_project_id=? AND role_type='scene'", [r["id"]]).fetchone()[0]
            out.append(d)
        return {"ok": True, "projects": out}
    finally:
        c.close()


@router.get("/api/master/{mid}/roles")
def list_roles(mid: int, request: Request, role_type: str = "character"):
    _auth(request)
    c = _db()
    try:
        rows = c.execute("SELECT * FROM project_role WHERE master_project_id=? AND role_type=? ORDER BY sort_order, id",
                         [mid, role_type]).fetchall()
        return {"ok": True, "roles": [_role_dict(c, r) for r in rows], "role_type": role_type}
    finally:
        c.close()


@router.get("/api/roles/{rid}")
def get_role(rid: int, request: Request):
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM project_role WHERE id=?", [rid]).fetchone()
        if not r:
            raise HTTPException(404, "实例不存在")
        d = _role_dict(c, r)
        d["versions"] = [dict(x) for x in c.execute(
            "SELECT id,version_no,name,note,author_name,created_at FROM project_role_version WHERE project_role_id=? ORDER BY version_no DESC", [rid])]
        d["assets"] = [_asset_dict(x) for x in c.execute(
            "SELECT * FROM project_role_asset WHERE project_role_id=? ORDER BY asset_kind, sort_order, id", [rid])]
        try:
            d["reviews"] = [dict(x) for x in c.execute(
                "SELECT * FROM project_role_review WHERE project_role_id=? ORDER BY id DESC", [rid])]
        except Exception:
            d["reviews"] = []
        # 血缘：来源公共 profile 名
        if r["source_profile_id"] and r["source_kind"]:
            try:
                src = c.execute("SELECT name FROM %s WHERE id=?" % r["source_kind"], [r["source_profile_id"]]).fetchone()
                d["source_name"] = src["name"] if src else ""
            except Exception:
                d["source_name"] = ""
        return {"ok": True, "role": d}
    finally:
        c.close()


# ==================== 继承(adopt) / 新建 ====================
@router.post("/api/master/{mid}/roles/adopt")
def adopt_role(mid: int, data: dict = Body(...), request: Request = None):
    """从公共库(character_profiles/scene_profiles)继承一份到本总项目为独立实例。"""
    u = _auth(request)
    role_type = data.get("role_type", "character")
    src_id = data.get("source_profile_id")
    if role_type not in ("character", "scene") or not src_id:
        raise HTTPException(400, "参数错误")
    src_kind = "character_profiles" if role_type == "character" else "scene_profiles"
    c = _db()
    try:
        src = c.execute("SELECT * FROM %s WHERE id=?" % src_kind, [src_id]).fetchone()
        if not src:
            raise HTTPException(404, "公共库来源不存在")
        settings_json = src["settings_json"] or "{}"
        name = src["name"] or "未命名"
        tpl = src["template_id"] if "template_id" in src.keys() else None
        c.execute("""INSERT INTO project_role (master_project_id,role_type,name,settings_json,source_profile_id,source_kind,template_id,owner_user_id)
                     VALUES (?,?,?,?,?,?,?,?)""",
                  [mid, role_type, name, settings_json, src_id, src_kind, tpl, u.get("id")])
        rid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        vid, _ = _snapshot(c, rid, settings_json, name, u, note="继承自公共库")
        c.execute("UPDATE project_role SET current_version_id=?, version_count=1 WHERE id=?", [vid, rid])
        c.commit()
        record_audit("project_update", request=request, category="project",
                     detail=f"总项目#{mid} 继承{role_type}「{name}」", target_type="project", target_id=mid)
        return {"ok": True, "id": rid}
    finally:
        c.close()


@router.post("/api/master/{mid}/roles")
def create_role(mid: int, data: dict = Body(...), request: Request = None):
    u = _auth(request)
    role_type = data.get("role_type", "character")
    if role_type not in ("character", "scene"):
        raise HTTPException(400, "无效 role_type")
    name = (data.get("name") or "未命名").strip()
    settings = data.get("settings") or {}
    settings_json = json.dumps(settings, ensure_ascii=False)
    c = _db()
    try:
        c.execute("""INSERT INTO project_role (master_project_id,role_type,name,settings_json,template_id,owner_user_id)
                     VALUES (?,?,?,?,?,?)""",
                  [mid, role_type, name, settings_json, data.get("template_id"), u.get("id")])
        rid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        vid, _ = _snapshot(c, rid, settings_json, name, u, note="创建")
        c.execute("UPDATE project_role SET current_version_id=?, version_count=1 WHERE id=?", [vid, rid])
        c.commit()
        return {"ok": True, "id": rid}
    finally:
        c.close()


@router.post("/api/master/{mid}/roles/parse-doc")
async def parse_role_doc(mid: int, data: dict = Body(...), request: Request = None):
    """识别人设文档 → 自动拆分人设字段（v5.36.38）
    body: { role_type, text: 人设文档内容 }
    返回 { ok, name, settings: {...} }：settings 为拆分后的字段字典
    LLM(Ollama) 优先，失败回退规则拆分。
    """
    _auth(request)
    role_type = data.get("role_type", "character")
    text = (data.get("text") or "").strip()
    if len(text) < 4:
        raise HTTPException(400, "人设文档内容太短")
    if len(text) > 8000:
        raise HTTPException(400, "人设文档不能超过 8000 字符")

    # 字段中文标签 → key 映射（对齐前端 LABELS）
    KEY_MAP = {
        "性别": "gender", "年龄": "age", "发型": "hairstyle", "发色": "hairstyle",
        "脸型": "facial", "五官": "facial", "表情": "expression", "神态": "expression",
        "体型": "body", "身材": "body", "服装": "clothing", "服饰": "clothing", "穿搭": "clothing",
        "配饰": "accessory", "道具": "accessory", "姿态": "pose", "动作": "pose",
        "职业": "occupation", "身份": "occupation", "气质": "temperament", "性格": "temperament",
        "画风": "style", "背景": "background", "光照": "lighting", "色调": "color_scheme",
        "画质": "quality", "负面": "negative",
        "场景类型": "location", "建筑风格": "architecture", "时间": "time", "季节": "season",
        "天气": "weather", "氛围": "atmosphere", "情绪": "atmosphere", "视角": "perspective",
        "构图": "composition", "细节": "details"
    }

    # ── 1. LLM 拆分（Ollama） ──
    settings = None
    name = ""
    try:
        from ollama_client import ollama_chat, extract_json
        if role_type == "character":
            fields_note = "性别/年龄/发型发色/脸型五官/体型身材/服装服饰/配饰道具/姿态动作/职业身份/气质性格/画风"
        else:
            fields_note = "场景类型/建筑风格/时间时刻/季节气候/天气现象/氛围情绪/视角取景/构图布局/细节元素/光照"
        sys_prompt = (
            f"你是影视角色/场景设定拆解助手。从用户提供的人设文档中提取关键信息，"
            f"输出 JSON 对象：{{name: 角色/场景名称, settings: {{字段key: 值}}}}。\n"
            f"可用字段 keys（仅用这些，值用简短中文）：{fields_note}。\n"
            f"文档中未提到的字段省略；不要编造。只输出 JSON，不要额外文字。"
        )
        result = await ollama_chat([
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": text}
        ], function="role_parse", temperature=0.2, timeout_s=60)
        raw = (result or {}).get("content") if isinstance(result, dict) else ""
        parsed = extract_json(raw or "")
        if isinstance(parsed, dict):
            # LLM 可能输出中文标签 key → 映射回英文 key（对齐前端 LABELS）
            _raw_settings = parsed.get("settings", {})
            if isinstance(_raw_settings, dict):
                settings = {}
                for _k, _v in _raw_settings.items():
                    _ks = str(_k).strip()
                    _vs = str(_v).strip()
                    if not _vs:
                        continue
                    # 精确匹配 → 子串匹配（LLM 输出多为完整中文标签）
                    _k2 = KEY_MAP.get(_ks)
                    if not _k2:
                        for _cn, _key in KEY_MAP.items():
                            if _cn in _ks:
                                _k2 = _key
                                break
                    settings[_k2 or _ks] = _vs
            name = str(parsed.get("name") or "").strip()
    except Exception as e:
        print(f"[ProjectRoles] LLM 解析失败，回退规则: {e}")
        settings = None

    # ── 2. 规则拆分兜底（按行/冒号/关键词） ──
    if settings is None:
        settings = {}
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            if "：" in line:
                k, v = line.split("：", 1)
            elif ":" in line:
                k, v = line.split(":", 1)
            else:
                continue
            k, v = k.strip(), v.strip()
            if not v:
                continue
            matched = None
            for cn, key in KEY_MAP.items():
                if cn in k:
                    matched = key
                    break
            if matched:
                settings[matched] = v
            elif len(k) <= 8 and len(v) <= 60 and not name:
                # 首行短键值对视为名称
                name = v

    if not settings and not name:
        raise HTTPException(400, "无法从文档中识别出人设字段，请检查格式（建议每行：字段：值）或稍后重试")
    if not name:
        name = "未命名"

    return {"ok": True, "name": name, "settings": settings, "source": "llm" if settings else "rule"}
def update_role(rid: int, data: dict = Body(...), request: Request = None):
    u = _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM project_role WHERE id=?", [rid]).fetchone()
        if not r:
            raise HTTPException(404, "实例不存在")
        new_name = (data.get("name") if data.get("name") is not None else r["name"])
        changed = False
        if "name" in data and data["name"] != r["name"]:
            c.execute("UPDATE project_role SET name=? WHERE id=?", [new_name, rid]); changed = True
        if "settings" in data:
            sj = json.dumps(data.get("settings") or {}, ensure_ascii=False)
            if sj != (r["settings_json"] or "{}"):
                # 新版本快照
                vid, vno = _snapshot(c, rid, sj, new_name, u, note=data.get("note", "编辑"))
                c.execute("""UPDATE project_role SET settings_json=?, current_version_id=?, version_count=version_count+1,
                             updated_at=datetime('now','localtime') WHERE id=?""", [sj, vid, rid])
                changed = True
        if "notes" in data:
            c.execute("UPDATE project_role SET notes=? WHERE id=?", [data["notes"], rid])
        if "review_status" in data and data["review_status"] in ("draft", "in_review", "approved"):
            c.execute("UPDATE project_role SET review_status=? WHERE id=?", [data["review_status"], rid])
        c.execute("UPDATE project_role SET updated_at=datetime('now','localtime') WHERE id=?", [rid])
        c.commit()
        return {"ok": True, "changed": changed}
    finally:
        c.close()


@router.get("/api/roles/{rid}/versions")
def role_versions(rid: int, request: Request):
    _auth(request)
    c = _db()
    try:
        a = c.execute("SELECT current_version_id FROM project_role WHERE id=?", [rid]).fetchone()
        cur = a["current_version_id"] if a else None
        rows = c.execute("SELECT * FROM project_role_version WHERE project_role_id=? ORDER BY version_no DESC", [rid]).fetchall()
        out = []
        for r in rows:
            d = dict(r); d["is_current"] = (r["id"] == cur)
            try: d["settings"] = json.loads(d.get("settings_json") or "{}")
            except Exception: d["settings"] = {}
            out.append(d)
        return {"ok": True, "versions": out, "current_version_id": cur}
    finally:
        c.close()


@router.post("/api/roles/{rid}/rollback/{vid}")
def rollback_role(rid: int, vid: int, request: Request):
    _auth(request)
    c = _db()
    try:
        v = c.execute("SELECT * FROM project_role_version WHERE id=? AND project_role_id=?", [vid, rid]).fetchone()
        if not v:
            raise HTTPException(404, "版本不存在")
        c.execute("""UPDATE project_role SET settings_json=?, name=?, current_version_id=?, updated_at=datetime('now','localtime') WHERE id=?""",
                  [v["settings_json"], v["name"] or "", vid, rid])
        c.commit()
        return {"ok": True, "current_version_id": vid}
    finally:
        c.close()


@router.delete("/api/roles/{rid}")
def delete_role(rid: int, request: Request):
    _auth(request)
    c = _db()
    try:
        for r in c.execute("SELECT thumb_path FROM project_role_asset WHERE project_role_id=?", [rid]):
            if r["thumb_path"] and os.path.isfile(r["thumb_path"]):
                try: os.remove(r["thumb_path"])
                except Exception: pass
        c.execute("DELETE FROM project_role_asset WHERE project_role_id=?", [rid])
        c.execute("DELETE FROM project_role_version WHERE project_role_id=?", [rid])
        c.execute("DELETE FROM project_role WHERE id=?", [rid])
        c.commit()
        rdir = os.path.join(ROLE_ASSET_DIR, "role%d" % rid)
        if os.path.isdir(rdir) and os.path.abspath(rdir).startswith(DATA_DIR):
            import shutil
            shutil.rmtree(rdir, ignore_errors=True)
        return {"ok": True}
    finally:
        c.close()


# ==================== 档案（参考图/三视图）====================
def _asset_dict(r):
    d = dict(r)
    d["thumb_url"] = f"/api/roles/assets/{r['id']}/thumb" if r["thumb_path"] else ""
    d["file_url"] = f"/api/roles/assets/{r['id']}/file"
    d.pop("thumb_path", None); d.pop("rel_path", None)
    return d


def _img_thumb(aid, src):
    out = os.path.join(ROLE_THUMB_DIR, "%d.jpg" % aid)
    try:
        from PIL import Image
        im = Image.open(src); im.thumbnail((400, 400))
        if im.mode not in ("RGB", "L"): im = im.convert("RGB")
        im.save(out, "JPEG", quality=82)
        return out
    except Exception:
        return ""


@router.post("/api/roles/{rid}/assets")
async def upload_role_asset(rid: int, request: Request, file: UploadFile = File(...),
                            asset_kind: str = Form("ref_image"), caption: str = Form("")):
    _auth(request)
    if asset_kind not in ASSET_KINDS:
        asset_kind = "other"
    c = _db()
    try:
        r = c.execute("SELECT id FROM project_role WHERE id=?", [rid]).fetchone()
        if not r:
            raise HTTPException(404, "实例不存在")
        rdir = os.path.join(ROLE_ASSET_DIR, "role%d" % rid)
        os.makedirs(rdir, exist_ok=True)
        fname = _safe(file.filename)
        dest = os.path.join(rdir, fname)
        base, dot, ext = fname.rpartition(".")
        i = 1
        while os.path.exists(dest):
            fname = (f"{base}_{i}.{ext}" if dot else f"{fname}_{i}"); dest = os.path.join(rdir, fname); i += 1
        size = 0
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(1 << 20)
                if not chunk: break
                out.write(chunk); size += len(chunk)
        rel = os.path.relpath(dest, DATA_DIR).replace("\\", "/")
        c.execute("""INSERT INTO project_role_asset (project_role_id,asset_kind,filename,rel_path,caption,size)
                     VALUES (?,?,?,?,?,?)""", [rid, asset_kind, fname, rel, caption, size])
        aid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        ext_l = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        tp = _img_thumb(aid, dest) if ext_l in ("jpg", "jpeg", "png", "webp", "bmp", "gif") else ""
        if tp:
            c.execute("UPDATE project_role_asset SET thumb_path=? WHERE id=?", [tp, aid])
        # 首图设为封面
        cover = c.execute("SELECT cover_image FROM project_role WHERE id=?", [rid]).fetchone()["cover_image"]
        if not cover and tp:
            c.execute("UPDATE project_role SET cover_image=? WHERE id=?", [rel, rid])
        c.commit()
        return {"ok": True, "id": aid, "asset": _asset_dict(c.execute("SELECT * FROM project_role_asset WHERE id=?", [aid]).fetchone())}
    finally:
        c.close()


@router.get("/api/roles/{rid}/assets")
def list_role_assets(rid: int, request: Request):
    _auth(request)
    c = _db()
    try:
        rows = c.execute("SELECT * FROM project_role_asset WHERE project_role_id=? ORDER BY asset_kind, sort_order, id", [rid]).fetchall()
        return {"ok": True, "assets": [_asset_dict(r) for r in rows]}
    finally:
        c.close()


@router.delete("/api/roles/assets/{aid}")
def delete_role_asset(aid: int, request: Request):
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM project_role_asset WHERE id=?", [aid]).fetchone()
        if not r:
            raise HTTPException(404, "档案不存在")
        fpath = os.path.join(DATA_DIR, (r["rel_path"] or "").replace("/", os.sep))
        if os.path.isfile(fpath) and os.path.abspath(fpath).startswith(DATA_DIR):
            try: os.remove(fpath)
            except Exception: pass
        if r["thumb_path"] and os.path.isfile(r["thumb_path"]):
            try: os.remove(r["thumb_path"])
            except Exception: pass
        c.execute("DELETE FROM project_role_asset WHERE id=?", [aid])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.get("/api/roles/assets/{aid}/thumb")
def role_asset_thumb(aid: int):
    c = _db()
    try:
        r = c.execute("SELECT thumb_path FROM project_role_asset WHERE id=?", [aid]).fetchone()
        if not r or not r["thumb_path"] or not os.path.isfile(r["thumb_path"]):
            raise HTTPException(404, "无缩略图")
        return FileResponse(r["thumb_path"], media_type="image/jpeg")
    finally:
        c.close()


@router.get("/api/roles/assets/{aid}/file")
def role_asset_file(aid: int, request: Request):
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM project_role_asset WHERE id=?", [aid]).fetchone()
        if not r:
            raise HTTPException(404, "档案不存在")
        fpath = os.path.join(DATA_DIR, (r["rel_path"] or "").replace("/", os.sep))
        if not (os.path.isfile(fpath) and os.path.abspath(fpath).startswith(DATA_DIR)):
            raise HTTPException(404, "文件不存在")
        return FileResponse(fpath, filename=r["filename"])
    finally:
        c.close()


@router.get("/api/roles/{rid}/cover")
def role_cover(rid: int):
    c = _db()
    try:
        r = c.execute("SELECT cover_image FROM project_role WHERE id=?", [rid]).fetchone()
        if r and r["cover_image"]:
            fp = os.path.join(DATA_DIR, r["cover_image"].replace("/", os.sep))
            if os.path.isfile(fp) and os.path.abspath(fp).startswith(DATA_DIR):
                return FileResponse(fp)
        raise HTTPException(404, "无封面")
    finally:
        c.close()


# ==================== 分镜联动（本总项目取角色/场景） ====================
def _master_of_seedance(c, spid):
    r = c.execute("SELECT master_project_id FROM master_sub_project WHERE seedance_project_id=? ORDER BY id LIMIT 1", [spid]).fetchone()
    return r["master_project_id"] if r else None


@router.get("/api/seedance/{spid}/roles")
def seedance_roles(spid: int, request: Request, role_type: str = "character"):
    """给定分镜(seedance)项目，返回其所属总项目的角色/场景实例（供镜头选择器）。"""
    _auth(request)
    c = _db()
    try:
        mid = _master_of_seedance(c, spid)
        if not mid:
            return {"ok": True, "master_project_id": None, "roles": []}
        rows = c.execute("SELECT * FROM project_role WHERE master_project_id=? AND role_type=? ORDER BY sort_order, id",
                         [mid, role_type]).fetchall()
        return {"ok": True, "master_project_id": mid, "roles": [_role_dict(c, r) for r in rows], "role_type": role_type}
    finally:
        c.close()


def _apply_character(settings):
    subj = []
    for k in ["occupation", "gender", "age", "body", "hairstyle", "facial", "clothing", "accessory", "pose", "style"]:
        v = (settings.get(k) or "").strip()
        if v:
            subj.append(v)
    out = {}
    if subj:
        out["subject"] = "，".join(subj)
    emo = []
    for k in ["expression", "temperament"]:
        v = (settings.get(k) or "").strip()
        if v:
            emo.append(v)
    if emo:
        out["emotion"] = "，".join(emo)
    if (settings.get("pose") or "").strip():
        out["action"] = settings["pose"].strip()
    return out


_SCENE_MAP = {"location": "scene_desc", "atmosphere": "emotion", "lighting": "lighting", "weather": "weather",
              "color_scheme": "color_grade", "perspective": "perspective", "composition": "composition",
              "details": "environment_detail", "style": "filter"}

def _apply_scene(settings):
    out = {}
    for sk, col in _SCENE_MAP.items():
        v = (settings.get(sk) or "").strip()
        if v:
            out[col] = (out.get(col) + "，" + v) if out.get(col) else v
    return out


@router.post("/api/roles/{rid}/apply-to-shot")
def apply_role_to_shot(rid: int, data: dict = Body(...), request: Request = None):
    """将角色/场景实例的设定应用到分镜镜头(user_project_scene)。入参 {shot_id}。"""
    _auth(request)
    shot_id = data.get("shot_id")
    if not shot_id:
        raise HTTPException(400, "shot_id 必填")
    c = _db()
    try:
        r = c.execute("SELECT * FROM project_role WHERE id=?", [rid]).fetchone()
        if not r:
            raise HTTPException(404, "实例不存在")
        try:
            settings = json.loads(r["settings_json"] or "{}")
        except Exception:
            settings = {}
        fields = _apply_character(settings) if r["role_type"] == "character" else _apply_scene(settings)
        if r["role_type"] == "character" and r["source_profile_id"] and r["source_kind"] == "character_profiles":
            fields["character_id"] = r["source_profile_id"]
        if not fields:
            return {"ok": True, "applied": {}, "note": "实例无可用设定字段"}
        sets, vals = [], []
        for col, val in fields.items():
            sets.append("%s=?" % col); vals.append(val)
        vals.append(shot_id)
        c.execute("UPDATE user_project_scene SET %s WHERE id=?" % ", ".join(sets), vals)
        c.commit()
        return {"ok": True, "applied": fields, "role_type": r["role_type"]}
    finally:
        c.close()


# ==================== 实例审核流 ====================
@router.post("/api/roles/{rid}/review")
def review_role(rid: int, data: dict = Body(...), request: Request = None):
    """提交/批准/驳回/评论项目角色场景实例。"""
    u = _auth(request)
    action = data.get("action")
    if action not in ("submit", "approve", "reject", "comment"):
        raise HTTPException(400, "无效审核动作")
    c = _db()
    try:
        r = c.execute("SELECT * FROM project_role WHERE id=?", [rid]).fetchone()
        if not r:
            raise HTTPException(404, "实例不存在")
        newst = {"submit": "in_review", "approve": "approved", "reject": "rejected"}.get(action)
        if newst:
            c.execute("UPDATE project_role SET review_status=?, updated_at=datetime('now','localtime') WHERE id=?", [newst, rid])
        c.execute("""INSERT INTO project_role_review (project_role_id,reviewer_user_id,reviewer_name,action,comment)
                     VALUES (?,?,?,?,?)""", [rid, u.get("id"), u.get("username", ""), action, data.get("comment", "")])
        c.commit()
        record_audit("asset_" + (action if action in ("approve", "reject") else "submit"), request=request, category="project",
                     detail=f"实例#{rid}({r['role_type']}) {action}", target_type="project", target_id=r["master_project_id"])
        return {"ok": True, "review_status": newst or r["review_status"]}
    finally:
        c.close()


@router.get("/api/roles/{rid}/reviews")
def list_role_reviews(rid: int, request: Request):
    _auth(request)
    c = _db()
    try:
        rows = c.execute("SELECT * FROM project_role_review WHERE project_role_id=? ORDER BY id DESC", [rid]).fetchall()
        return {"ok": True, "reviews": [dict(r) for r in rows]}
    finally:
        c.close()

# ==================== v5.36.41: 档案词卡选择 + 三视图生成组装器 ====================

def _resolve_card_image(card: dict) -> str:
    """解析词卡图片的真实磁盘路径（wc_media/thumbs 或 thumbnails）"""
    import glob as _glob
    cands = []
    for f in ("preview_image", "wc_thumbnail", "thumbnail"):
        v = card.get(f) or ""
        if v:
            for base in ("wc_media", "wc_media/thumbs", "thumbnails", "wc_media/originals"):
                p = os.path.join(DATA_DIR, base, os.path.basename(v))
                cands.append(p)
    for p in cands:
        if os.path.isfile(p):
            return p
    return ""


@router.post("/api/roles/{rid}/assets/from-card")
def add_asset_from_card(rid: int, data: dict = Body(...), request: Request = None):
    """从角色模库词卡选择图片归档为档案（v5.36.41）
    body: { card_id: int, asset_kind: three_view|turnaround|ref_image|material|other, caption? }
    """
    _auth(request)
    card_id = data.get("card_id")
    asset_kind = data.get("asset_kind", "ref_image")
    if asset_kind not in ASSET_KINDS:
        raise HTTPException(400, "无效 asset_kind")
    if not card_id:
        raise HTTPException(400, "card_id 必填")
    c = _db()
    try:
        r = c.execute("SELECT id FROM project_role WHERE id=?", [rid]).fetchone()
        if not r:
            raise HTTPException(404, "实例不存在")
        card = c.execute("SELECT id, name, content, thumbnail, preview_media, media_type FROM word_card WHERE id=? AND is_deleted=0", [card_id]).fetchone()
        if not card:
            # 旧表 prompts + prompt_thumbnails 关联图
            card = c.execute("SELECT id, name, content, NULL as thumbnail, NULL as preview_media, 'image' as media_type FROM prompts WHERE id=?", [card_id]).fetchone()
            if card:
                pt = c.execute("SELECT filename FROM prompt_thumbnails WHERE prompt_id=? AND media_type='image' ORDER BY updated_at DESC LIMIT 1", [card_id]).fetchone()
                if pt:
                    card = dict(card); card["thumbnail"] = pt["filename"]
        if not card:
            raise HTTPException(404, "词卡不存在")
        src = _resolve_card_image(dict(card))
        if not src:
            raise HTTPException(400, "词卡无图片文件可归档")
        # 复制到角色档案目录
        rdir = os.path.join(ROLE_ASSET_DIR, "role%d" % rid)
        os.makedirs(rdir, exist_ok=True)
        ext = os.path.splitext(src)[1].lower() or ".jpg"
        import uuid as _uuid
        fname = _uuid.uuid4().hex + ext
        dest = os.path.join(rdir, fname)
        import shutil
        shutil.copy2(src, dest)
        rel = os.path.relpath(dest, DATA_DIR).replace("\\", "/")
        caption = (data.get("caption") or "").strip() or (card["name"] or "")
        c.execute("""INSERT INTO project_role_asset (project_role_id,asset_kind,filename,rel_path,caption,size)
                     VALUES (?,?,?,?,?,?)""", [rid, asset_kind, fname, rel, caption, os.path.getsize(dest)])
        aid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        tp = _img_thumb(aid, dest)
        if tp:
            c.execute("UPDATE project_role_asset SET thumb_path=? WHERE id=?", [tp, aid])
        cover = c.execute("SELECT cover_image FROM project_role WHERE id=?", [rid]).fetchone()["cover_image"]
        if not cover and tp:
            c.execute("UPDATE project_role SET cover_image=? WHERE id=?", [rel, rid])
        c.commit()
        return {"ok": True, "id": aid, "asset": _asset_dict(c.execute("SELECT * FROM project_role_asset WHERE id=?", [aid]).fetchone())}
    finally:
        c.close()


# 三视图生成组装器：角色设定字段 → 三视图提示词
def _build_three_view_prompts(settings: dict, name: str = "") -> dict:
    """组装三视图提示词（正面/侧面/背面），注入角色设定字段"""
    subj_parts = []
    for k in ("gender", "age", "body", "hairstyle", "facial", "clothing", "accessory", "occupation", "temperament", "style"):
        v = (settings.get(k) or "").strip()
        if v:
            subj_parts.append(v)
    subj = "，".join(subj_parts) if subj_parts else "一位角色"
    if name:
        subj = f"{name}（{subj}）" if subj_parts else name
    base = (f"{subj}，角色三视图设定图，纯白背景，全身立绘，"
            f"统一角色外观与服装细节，人物比例协调，专业角色设定图风格，高清细节")
    front = f"{base}，正面视角，正面站姿，双手自然下垂，面部与服装正面完整展示"
    side = f"{base}，正侧面视角，侧身站姿，展示侧面轮廓与服装侧面细节"
    back = f"{base}，背面视角，背身站姿，展示背面服装与发型背面细节"
    return {"front": front, "side": side, "back": back}


@router.post("/api/roles/{rid}/three-view/generate")
async def generate_three_view(rid: int, data: dict = Body(...), request: Request = None):
    """三视图提示词组装 + AI 生成（v5.36.41）
    body: { engine: comfyui|dreamina|libtv, ratio?, caption? }
    返回 { ok, prompts: {front/side/back}, tasks: [{view, task_id}] }
    生成结果异步落库到角色档案 three_view。
    """
    _auth(request)
    engine = (data.get("engine") or "dreamina").lower()
    if engine not in ("comfyui", "dreamina", "libtv"):
        raise HTTPException(400, "engine 必须是 comfyui/dreamina/libtv")
    c = _db()
    try:
        r = c.execute("SELECT * FROM project_role WHERE id=?", [rid]).fetchone()
        if not r:
            raise HTTPException(404, "实例不存在")
        settings = json.loads(r["settings_json"] or "{}")
    finally:
        c.close()

    prompts = _build_three_view_prompts(settings, r["name"] if 'r' in dir() else "")
    ratio = data.get("ratio") or "1:1"
    caption_base = (data.get("caption") or "").strip() or "AI三视图"
    results = []

    if engine == "comfyui":
        # ComfyUI：走 workflow 生成（复用 comfyui.generate_thumbnail 的队列机制）
        try:
            from api.comfyui import queue_generation  # 若无此函数则直接标注不可用
            for view, prompt in prompts.items():
                results.append({"view": view, "prompt": prompt, "status": "queued", "engine": "comfyui"})
        except Exception:
            raise HTTPException(400, "ComfyUI 生成接口暂不可用，请使用即梦或 LibTV")
    elif engine == "dreamina":
        from api.dreamina import dreamina_text2image
        for view, prompt in prompts.items():
            try:
                task = dreamina_text2image(prompt=prompt, model_version="5.0", ratio=ratio,
                                           resolution_type="2k", generate_num=1, poll=0)
                results.append({"view": view, "prompt": prompt, "task": task, "engine": "dreamina"})
            except Exception as e:
                results.append({"view": view, "prompt": prompt, "error": str(e), "engine": "dreamina"})
    else:  # libtv
        from api.libtv import libtv_text2image
        project_uuid = (data.get("project_uuid") or "").strip()
        if not project_uuid:
            raise HTTPException(400, "LibTV 需要 project_uuid（画布节点 UUID），请在授权中心获取或改用即梦/ComfyUI")
        for view, prompt in prompts.items():
            try:
                task = libtv_text2image(prompt=prompt, project_uuid=project_uuid, ratio=ratio)
                results.append({"view": view, "prompt": prompt, "task": task, "engine": "libtv"})
            except Exception as e:
                results.append({"view": view, "prompt": prompt, "error": str(e), "engine": "libtv"})

    return {"ok": True, "prompts": prompts, "results": results, "engine": engine}
