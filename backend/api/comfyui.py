"""
ComfyUI 集成 — 发送提示词生成图片并自动收录为缩略图
包含：模块主体预设提示词组合、工作流同步、自动轮询生成
"""
import os, json, uuid, time, io, base64, asyncio, threading, copy
from fastapi import APIRouter, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from database import get_db, safe_commit
import httpx
from PIL import Image

router = APIRouter(prefix="/api/v2/comfyui", tags=["comfyui"])

# 项目根目录: backend/api/comfyui.py -> 上三层到项目根
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

THUMB_DIR = os.path.join(_PROJECT_ROOT, "data", "thumbnails")
ORIGINALS_DIR = os.path.join(_PROJECT_ROOT, "data", "originals")
OUTPUTS_DIR = os.path.join(_PROJECT_ROOT, "data", "comfyui_outputs")

DEFAULT_CONFIG = {
    "server_url": "http://127.0.0.1:8188",
    "enabled": False,
    "workflows": [],
    "active_workflow": ""
}


def _get_config():
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='comfyui_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            for k in DEFAULT_CONFIG:
                cfg.setdefault(k, DEFAULT_CONFIG[k])
            return cfg
        except Exception:
            pass
    return dict(DEFAULT_CONFIG)


def _save_config(cfg: dict):
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('comfyui_config', ?)",
        [json.dumps(cfg, ensure_ascii=False)]
    )
    safe_commit()


# ==================== 模块主体预设提示词 ====================
DEFAULT_STYLE_SUFFIX = "cinematic lighting, high quality, 4k, detailed"

def _get_module_presets():
    """获取所有模块的主体预设提示词"""
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='module_presets'").fetchone()
    if row:
        try:
            return json.loads(row["value"])
        except Exception:
            pass
    return {}


def _save_module_presets(presets: dict):
    """保存模块主体预设提示词"""
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('module_presets', ?)",
        [json.dumps(presets, ensure_ascii=False)]
    )
    safe_commit()


def _auto_populate_missing_presets(presets: dict) -> dict:
    """自动补全缺少预设的模块"""
    db = get_db()
    rows = db.execute("SELECT DISTINCT module FROM prompts WHERE is_builtin=1 AND module != '' ORDER BY module").fetchall()
    changed = False
    for r in rows:
        m = r["module"]
        if m not in presets:
            presets[m] = {
                "preset": f"",
                "enabled": False,
                "note": "该模块的共性主体描述，将自动与提示词卡片内容组合"
            }
            changed = True
    if changed:
        _save_module_presets(presets)
    return presets


def _find_workflow(cfg: dict, workflow_id: str = ""):
    """查找工作流配置, 返回 (workflow_cfg, name)"""
    workflows = cfg.get("workflows", [])
    if not workflows:
        return (None, "")
    if workflow_id:
        for w in workflows:
            if w.get("id") == workflow_id:
                return (w, w.get("name", ""))
    return (workflows[0], workflows[0].get("name", ""))


# ==================== 工作流库（comfyui_workflows 表） ====================

# 不可执行的 UI 注释类节点（ComfyUI 无法识别，提交前必须过滤，否则 400 invalid_prompt）
_SKIP_NODE_TYPES = {"MarkdownNote", "Note", "TextNote"}


def _strip_ui_nodes(workflow: dict) -> dict:
    """过滤工作流中不可执行的 UI 注释节点（MarkdownNote/Note 等），返回新 dict 不污染原对象"""
    if not isinstance(workflow, dict):
        return workflow
    return {k: v for k, v in workflow.items()
            if not (isinstance(v, dict) and v.get("class_type") in _SKIP_NODE_TYPES)}


def _sanitize_workflow_inputs(workflow: dict, object_info: dict):
    """清洗工作流输入值：UI 占位符（steps=randomize / denoise=normal / 枚举位置数字）会导致
    ComfyUI 400 invalid_input_type。按节点定义的类型/默认值强制转换，失败则回退默认值。
    仅清洗标量输入，链接型输入（list/dict）不动。"""
    if not isinstance(workflow, dict):
        return
    for nid, node in workflow.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        info = (object_info or {}).get(ct, {})
        ins = node.get("inputs")
        if not isinstance(ins, dict):
            continue
        defs = (info.get("input", {}) or {})
        confs = {}
        confs.update(defs.get("required", {}) or {})
        confs.update(defs.get("optional", {}) or {})
        for field, val in list(ins.items()):
            if isinstance(val, (list, dict)) or val is None:
                continue  # 链接型/复杂输入
            conf = confs.get(field)
            if not conf or not isinstance(conf, list) or not conf:
                continue
            vtype = conf[0]
            meta = conf[1] if len(conf) > 1 else {}
            # 兼容新版 ComfyUI：COMBO 类型直接是选项列表（[['euler',...], {tooltip}]）
            if isinstance(vtype, list):
                valid = vtype
                if isinstance(val, (int, float)) or val not in valid:
                    default = meta.get("default") if isinstance(meta, dict) else None
                    if default in valid:
                        ins[field] = default
                    elif valid:
                        ins[field] = valid[0]
                    else:
                        ins[field] = default
                continue
            default = meta.get("default") if isinstance(meta, dict) else None
            if vtype == "INT":
                try:
                    ins[field] = int(float(val))
                except Exception:
                    ins[field] = default if isinstance(default, int) else 20
            elif vtype == "FLOAT":
                try:
                    ins[field] = float(val)
                except Exception:
                    ins[field] = default if isinstance(default, (int, float)) else 1.0
            elif vtype == "COMBO":
                valid = meta if isinstance(meta, list) else (meta.get("options") if isinstance(meta, dict) else [])
                if valid and (isinstance(val, (int, float)) or val not in valid):
                    if default in valid:
                        ins[field] = default
                    elif valid:
                        ins[field] = valid[0]
                    else:
                        ins[field] = default
            elif vtype == "BOOLEAN" and isinstance(val, str):
                ins[field] = val.lower() in ("true", "1", "yes", "on")


def _extract_positive_text(wf) -> str:
    """从工作流提取 positive 提示词：优先跟随 KSampler.positive 链路的 CLIPTextEncode，
    无则取第一个非空 CLIPTextEncode"""
    try:
        if isinstance(wf, str):
            wf = json.loads(wf)
        if not isinstance(wf, dict):
            return ""
        for nid, node in wf.items():
            if node.get("class_type") == "KSampler":
                pos = node.get("inputs", {}).get("positive")
                if isinstance(pos, list) and len(pos) >= 1:
                    tnode = wf.get(str(pos[0]))
                    if tnode and tnode.get("class_type") == "CLIPTextEncode":
                        return (tnode.get("inputs", {}).get("text", "") or "").strip()
        for nid, node in wf.items():
            if node.get("class_type") == "CLIPTextEncode":
                t = (node.get("inputs", {}).get("text", "") or "").strip()
                if t:
                    return t
    except Exception:
        pass
    return ""


def _parse_png_workflow(data: bytes) -> dict:
    """解析 ComfyUI 生成 PNG 的自带工作流元数据
    返回 {"prompt": dict|None, "workflow": str|None, "width": int, "height": int};
    SaveImage 节点写入 tEXt chunk: prompt(API格式) + workflow(UI格式)
    """
    import io as _io
    try:
        img = Image.open(_io.BytesIO(data))
        info = img.info or {}
        w, h = img.size
    except Exception:
        return {"prompt": None, "workflow": None, "width": 0, "height": 0}
    prompt_raw = info.get("prompt", "")
    prompt = None
    if prompt_raw:
        try:
            prompt = json.loads(prompt_raw)
        except Exception:
            prompt = None
    return {
        "prompt": prompt,
        "workflow": info.get("workflow", "") or "",
        "width": w, "height": h
    }


def _migrate_legacy_workflows():
    """幂等迁移：config.comfyui_config.workflows[] → comfyui_workflows 表
    用 config key 标记迁移状态（一次性），不依赖表是否为空（避免删光后复活）
    """
    try:
        db = get_db()
        row = db.execute("SELECT value FROM config WHERE key='comfyui_config'").fetchone()
        if not row:
            return
        cfg = json.loads(row["value"])
        workflows = cfg.get("workflows") or []
        if not workflows:
            return
        mark = db.execute("SELECT value FROM config WHERE key='comfyui_wf_migrated'").fetchone()
        if mark:
            return
        for w in workflows:
            wf_json = w.get("workflow_json", {})
            if isinstance(wf_json, str):
                try:
                    wf_json = json.loads(wf_json)
                except Exception:
                    wf_json = {}
            db.execute(
                """INSERT OR IGNORE INTO comfyui_workflows
                   (id, name, description, workflow_json, ui_json, prompt_text, thumbnail, source, tags)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                [w.get("id", "wf_" + uuid.uuid4().hex[:10]),
                 w.get("name", "未命名"), w.get("description", ""),
                 json.dumps(wf_json, ensure_ascii=False), "",
                 _extract_positive_text(wf_json), "", "comfyui_sync", ""])
        db.execute("INSERT OR REPLACE INTO config (key, value) VALUES ('comfyui_wf_migrated', '1')")
        safe_commit()
        print(f"[ComfyUI] 已迁移 {len(workflows)} 个工作流到 comfyui_workflows 表（一次性标记）")
    except Exception as e:
        print(f"[ComfyUI] 工作流迁移跳过: {e}")


def _find_workflow_v2(workflow_id: str = ""):
    """从工作流库取工作流，返回 (row_dict, None) 或 (None, error)"""
    try:
        _migrate_legacy_workflows()
        db = get_db()
        if workflow_id:
            row = db.execute("SELECT * FROM comfyui_workflows WHERE id=?", [workflow_id]).fetchone()
            if row:
                d = dict(row)
                d["workflow_json"] = json.loads(d["workflow_json"])
                return (d, None)
        row = db.execute("SELECT * FROM comfyui_workflows ORDER BY is_favorite DESC, updated_at DESC LIMIT 1").fetchone()
        if row:
            d = dict(row)
            d["workflow_json"] = json.loads(d["workflow_json"])
            return (d, None)
        return (None, "工作流库为空，请先导入或同步工作流")
    except Exception as e:
        return (None, f"工作流库读取失败: {e}")


# ==================== 工作流库 API ====================

class WorkflowCreate(BaseModel):
    name: str = ""
    description: str = ""
    workflow_json: dict = {}
    ui_json: str = ""
    prompt_text: str = ""
    tags: str = ""

class WorkflowUpdate(BaseModel):
    name: str = ""
    description: str = ""
    workflow_json: dict = None
    ui_json: str = ""
    prompt_text: str = ""
    tags: str = ""
    thumbnail: str = ""
    is_favorite: int = None


@router.get("/workflows")
def list_workflows(search: str = "", source: str = "", favorite: int = 0, sort: str = "recent"):
    """工作流库列表
    sort: recent(默认 收藏+最近使用) / usage(使用最多) / name(名称) / nodes(节点数) / newest(最新导入)
    """
    _migrate_legacy_workflows()
    db = get_db()
    sql = "SELECT * FROM comfyui_workflows WHERE 1=1"
    args = []
    if search:
        sql += " AND (name LIKE ? OR description LIKE ? OR tags LIKE ? OR prompt_text LIKE ?)"
        args += [f"%{search}%"] * 4
    if source:
        sql += " AND source=?"
        args.append(source)
    if favorite:
        sql += " AND is_favorite=1"
    order = {
        "recent": "is_favorite DESC, COALESCE(last_used_at,'') DESC, updated_at DESC, created_at DESC",
        "usage": "usage_count DESC, COALESCE(last_used_at,'') DESC",
        "name": "name ASC",
        "nodes": "(SELECT COUNT(*) FROM json_each(workflow_json)) DESC, usage_count DESC",
        "newest": "created_at DESC",
    }.get(sort, "is_favorite DESC, COALESCE(last_used_at,'') DESC, updated_at DESC")
    sql += f" ORDER BY {order}"
    rows = db.execute(sql, args).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        try:
            d["node_count"] = len(json.loads(d["workflow_json"]))
        except Exception:
            d["node_count"] = 0
        items.append(d)
    return {"ok": True, "items": items, "total": len(items)}


@router.post("/workflows")
def create_workflow(data: WorkflowCreate):
    """手动保存工作流（API 格式直接存；UI 格式带 ui_json 自动转换）"""
    wf_id = "wf_" + str(int(time.time() * 1000)) + "_" + uuid.uuid4().hex[:6]
    wf_json = data.workflow_json
    ui_json = data.ui_json or ""
    # UI 格式 → API 格式转换
    if ui_json and not any(isinstance(v, dict) and v.get("class_type") for v in wf_json.values()):
        try:
            cfg = _get_config()
            url = (cfg.get("server_url") or "").rstrip("/")
            obj_info = _get_object_info(url)
            ui_obj = json.loads(ui_json) if isinstance(ui_json, str) else ui_json
            wf_json = _ui_to_api_wf(ui_obj, obj_info)
        except Exception as e:
            return {"ok": False, "error": f"UI 格式转换失败: {e}"}
    db = get_db()
    db.execute(
        """INSERT INTO comfyui_workflows
           (id, name, description, workflow_json, ui_json, prompt_text, tags, source)
           VALUES (?,?,?,?,?,?,?,?)""",
        [wf_id, data.name or "未命名", data.description,
         json.dumps(wf_json, ensure_ascii=False), ui_json,
         data.prompt_text or _extract_positive_text(wf_json),
         data.tags, "manual"])
    safe_commit()
    return {"ok": True, "workflow_id": wf_id}


@router.get("/workflows/{wf_id}")
def get_workflow(wf_id: str):
    db = get_db()
    row = db.execute("SELECT * FROM comfyui_workflows WHERE id=?", [wf_id]).fetchone()
    if not row:
        return {"ok": False, "error": "工作流不存在"}
    d = dict(row)
    try:
        d["workflow_json"] = json.loads(d["workflow_json"])
    except Exception:
        pass
    return {"ok": True, "workflow": d}


@router.put("/workflows/{wf_id}")
def update_workflow(wf_id: str, data: WorkflowUpdate):
    db = get_db()
    row = db.execute("SELECT * FROM comfyui_workflows WHERE id=?", [wf_id]).fetchone()
    if not row:
        return {"ok": False, "error": "工作流不存在"}
    sets = ["updated_at=datetime('now','localtime')"]
    args = []
    if data.name:
        sets.append("name=?"); args.append(data.name)
    if data.description is not None:
        sets.append("description=?"); args.append(data.description)
    if data.workflow_json is not None:
        sets.append("workflow_json=?"); args.append(json.dumps(data.workflow_json, ensure_ascii=False))
        if not data.prompt_text:
            sets.append("prompt_text=?"); args.append(_extract_positive_text(data.workflow_json))
    if data.ui_json is not None:
        sets.append("ui_json=?"); args.append(data.ui_json)
    if data.prompt_text is not None:
        sets.append("prompt_text=?"); args.append(data.prompt_text)
    if data.tags is not None:
        sets.append("tags=?"); args.append(data.tags)
    if data.thumbnail:
        sets.append("thumbnail=?"); args.append(data.thumbnail)
    if data.is_favorite is not None:
        sets.append("is_favorite=?"); args.append(data.is_favorite)
    args.append(wf_id)
    db.execute(f"UPDATE comfyui_workflows SET {', '.join(sets)} WHERE id=?", args)
    safe_commit()
    return {"ok": True}


@router.delete("/workflows/{wf_id}")
def delete_workflow(wf_id: str):
    db = get_db()
    db.execute("DELETE FROM comfyui_workflows WHERE id=?", [wf_id])
    # 同步清理旧配置 workflows 数组 + active_workflow，防止迁移逻辑复活已删模板
    try:
        row = db.execute("SELECT value FROM config WHERE key='comfyui_config'").fetchone()
        if row:
            cfg = json.loads(row["value"])
            changed = False
            if cfg.get("workflows"):
                cfg["workflows"] = [w for w in cfg["workflows"] if w.get("id") != wf_id]
                changed = True
            if cfg.get("active_workflow") == wf_id:
                cfg["active_workflow"] = ""
                changed = True
            if changed:
                db.execute("INSERT OR REPLACE INTO config (key, value) VALUES ('comfyui_config', ?)",
                           [json.dumps(cfg, ensure_ascii=False)])
    except Exception as e:
        print(f"[ComfyUI] 删除时清理旧配置失败: {e}")
    safe_commit()
    return {"ok": True}


@router.post("/workflows/{wf_id}/duplicate")
def duplicate_workflow(wf_id: str):
    db = get_db()
    row = db.execute("SELECT * FROM comfyui_workflows WHERE id=?", [wf_id]).fetchone()
    if not row:
        return {"ok": False, "error": "工作流不存在"}
    d = dict(row)
    new_id = "wf_" + str(int(time.time() * 1000)) + "_" + uuid.uuid4().hex[:6]
    db.execute(
        """INSERT INTO comfyui_workflows
           (id, name, description, workflow_json, ui_json, prompt_text, thumbnail, source, tags)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        [new_id, d["name"] + " (副本)", d["description"], d["workflow_json"],
         d["ui_json"], d["prompt_text"], d["thumbnail"], "manual", d["tags"]])
    safe_commit()
    return {"ok": True, "workflow_id": new_id}


@router.post("/workflows/import-png")
async def import_workflow_from_png(file: UploadFile = File(...)):
    """从 ComfyUI 生成的 PNG 提取自带工作流元数据（prompt/workflow chunk）入库"""
    data = await file.read()
    if not data:
        return {"ok": False, "error": "空文件"}
    parsed = _parse_png_workflow(data)
    if not parsed["prompt"]:
        return {"ok": False, "error": "PNG 中未找到 prompt 工作流元数据。请确认图片由 ComfyUI SaveImage 节点生成"}
    wf = parsed["prompt"]
    pos_text = _extract_positive_text(wf)
    wf_id = "wf_" + str(int(time.time() * 1000)) + "_" + uuid.uuid4().hex[:6]
    name = (pos_text[:20] + "…") if len(pos_text) > 20 else (pos_text or "从PNG导入")
    # 原图存档（PNG 自带元数据，可再次提取）
    os.makedirs(OUTPUTS_DIR, exist_ok=True)
    fname = wf_id + ".png"
    with open(os.path.join(OUTPUTS_DIR, fname), "wb") as f:
        f.write(data)
    db = get_db()
    db.execute(
        """INSERT INTO comfyui_workflows
           (id, name, description, workflow_json, ui_json, prompt_text, source, source_file)
           VALUES (?,?,?,?,?,?,?,?)""",
        [wf_id, name, f"从 PNG 导入（{len(wf)} 节点, {parsed['width']}x{parsed['height']}）",
         json.dumps(wf, ensure_ascii=False), parsed["workflow"], pos_text, "png_import", fname])
    safe_commit()
    return {"ok": True, "workflow_id": wf_id, "name": name, "node_count": len(wf),
            "prompt_text": pos_text, "image_file": fname,
            "width": parsed["width"], "height": parsed["height"]}


@router.get("/outputs/{filename}")
def serve_output_file(filename: str):
    """访问 data/comfyui_outputs/ 下的生成原图（PNG 带工作流元数据）"""
    from fastapi.responses import FileResponse
    safe = os.path.basename(filename)
    p = os.path.join(OUTPUTS_DIR, safe)
    if not os.path.exists(p):
        return {"ok": False, "error": "文件不存在"}
    return FileResponse(p, media_type="image/png")


class ImportFromOutputRequest(BaseModel):
    output_file: str = ""


@router.post("/workflows/import-from-output")
def import_workflow_from_output(data: ImportFromOutputRequest):
    """从存档的生成 PNG（comfyui_outputs/）提取工作流入库"""
    if not data.output_file:
        return {"ok": False, "error": "缺少 output_file"}
    p = os.path.join(OUTPUTS_DIR, os.path.basename(data.output_file))
    if not os.path.exists(p):
        return {"ok": False, "error": "文件不存在"}
    with open(p, "rb") as f:
        parsed = _parse_png_workflow(f.read())
    if not parsed["prompt"]:
        return {"ok": False, "error": "PNG 中未找到工作流元数据"}
    wf = parsed["prompt"]
    pos_text = _extract_positive_text(wf)
    wf_id = "wf_" + str(int(time.time() * 1000)) + "_" + uuid.uuid4().hex[:6]
    name = (pos_text[:20] + "…") if len(pos_text) > 20 else (pos_text or "从生成结果导入")
    db = get_db()
    db.execute(
        """INSERT INTO comfyui_workflows
           (id, name, description, workflow_json, ui_json, prompt_text, source, source_file)
           VALUES (?,?,?,?,?,?,?,?)""",
        [wf_id, name, f"从生成结果导入（{len(wf)} 节点）",
         json.dumps(wf, ensure_ascii=False), parsed["workflow"], pos_text, "generate", os.path.basename(p)])
    safe_commit()
    return {"ok": True, "workflow_id": wf_id, "name": name, "node_count": len(wf), "prompt_text": pos_text}


# ==================== 工作流前端参数系统 ====================

# 字段语义 → 组件类型（优先于按值推断，保证对应关系正确）
_FIELD_TYPE_HINTS = {
    "seed": "number", "noise_seed": "number",
    "steps": "slider", "cfg": "slider", "denoise": "slider", "guidance": "slider",
    "strength": "slider", "strength_model": "slider", "strength_1": "slider", "strength_2": "slider",
    "batch_size": "slider", "width": "slider", "height": "slider",
    "sampler_name": "select", "scheduler": "select",
    "lora_name": "select_file", "ckpt_name": "select_file", "unet_name": "select_file",
    "vae_name": "select_file", "clip_name1": "select_file", "clip_name2": "select_file",
}


def _infer_param_type(val, field=""):
    """根据字段语义 + 当前值推断前端组件类型"""
    hint = _FIELD_TYPE_HINTS.get(field)
    if hint:
        return hint
    if isinstance(val, bool):
        return "checkbox"
    if isinstance(val, (int, float)):
        return "slider"
    if isinstance(val, str):
        if val.endswith((".safetensors", ".sft", ".ckpt", ".pt", ".pth", ".onnx", ".gguf")):
            return "select_file"
        return "text"
    return "text"


def _field_enum_options(object_info: dict, class_type: str, field: str) -> list:
    """从 object_info 取枚举字段（sampler_name/scheduler 等）的合法选项"""
    try:
        info = (object_info or {}).get(class_type, {})
        defs = (info.get("input", {}) or {})
        conf = (defs.get("required", {}) or {}).get(field) or (defs.get("optional", {}) or {}).get(field)
        if not conf or not isinstance(conf, list) or not conf:
            return []
        if isinstance(conf[0], list):
            return conf[0]
        if conf[0] == "COMBO" and len(conf) > 1:
            meta = conf[1]
            if isinstance(meta, list):
                return meta
            if isinstance(meta, dict) and isinstance(meta.get("options"), list):
                return meta["options"]
    except Exception:
        pass
    return []


def _analyze_workflow_params(wf, object_info: dict = None) -> list:
    """自动分析工作流可参数化节点：遍历所有节点的非链接输入
    传入 object_info 时先清洗占位符值（randomize/normal 等），并携带枚举选项"""
    try:
        if isinstance(wf, str):
            wf = json.loads(wf)
    except Exception:
        return []
    if not isinstance(wf, dict):
        return []
    if object_info:
        # 清洗占位符：steps=randomize / denoise=normal / 枚举位置数字 → 合法值，类型推断才正确
        _sanitize_workflow_inputs(wf, object_info)
    candidates = []
    seen = set()
    pos_node = _find_positive_node(wf)
    neg_node = _find_negative_node(wf)
    for nid, node in wf.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        for field, val in inputs.items():
            if isinstance(val, (list, dict)):
                continue  # 链接型/复杂输入不暴露
            key = f"{nid}.{field}"
            if key in seen:
                continue
            seen.add(key)
            label_map = {
                "text": "提示词", "seed": "随机种子", "noise_seed": "随机种子",
                "steps": "步数", "cfg": "CFG", "denoise": "重绘幅度", "guidance": "引导强度",
                "width": "宽度", "height": "高度", "batch_size": "批量数",
                "sampler_name": "采样器", "scheduler": "调度器",
                "filename_prefix": "输出文件名前缀", "strength_model": "LoRA强度",
                "lora_name": "模型文件", "ckpt_name": "模型文件", "unet_name": "模型文件", "vae_name": "模型文件",
                "clip_name1": "CLIP模型1", "clip_name2": "CLIP模型2",
            }
            role = ""
            if ct == "CLIPTextEncode" and field == "text":
                if str(nid) == str(pos_node):
                    role = "positive"
                elif str(nid) == str(neg_node):
                    role = "negative"
            candidates.append({
                "node_id": str(nid),
                "field": field,
                "class_type": ct,
                "key": key,
                "label": label_map.get(field, f"{ct}.{field}"),
                "value": val,
                "type": _infer_param_type(val, field),
                "default": val,
                "role": role,
                "options": _field_enum_options(object_info, ct, field),
            })
    return candidates


def _apply_params(workflow: dict, params: list, values: dict):
    """把用户表单参数值写回工作流对应节点"""
    for p in params or []:
        nid = str(p.get("node_id", ""))
        field = p.get("field", "")
        key = p.get("key", "")
        if key not in values:
            continue
        if nid in workflow and isinstance(workflow[nid].get("inputs"), dict):
            try:
                cur = workflow[nid]["inputs"].get(field)
                v = values[key]
                if isinstance(cur, bool):
                    v = bool(v)
                elif isinstance(cur, int):
                    v = int(float(v))
                elif isinstance(cur, float):
                    v = float(v)
                workflow[nid]["inputs"][field] = v
            except Exception:
                pass


class PresetCreate(BaseModel):
    name: str = ""
    params: list = []          # [{key,label,node_id,field,type,min,max,step,default,options}]
    mode: str = "user"        # editor / user

class PresetUpdate(BaseModel):
    name: str = None
    params: list = None
    mode: str = None


def _detect_model_type(wf) -> str:
    """根据工作流节点识别模型类型：flux / sdxl / sd15 / unknown
    依据：加载类节点模型文件名关键词 + FLUX/SDXL 特征节点 + 常见 SD1.5 模型名"""
    try:
        if isinstance(wf, str):
            wf = json.loads(wf)
    except Exception:
        return "unknown"
    if not isinstance(wf, dict):
        return "unknown"
    names = []
    has_flux_nodes = False
    has_sdxl_nodes = False
    for nid, node in wf.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        if ct in ("FluxGuidance", "ModelSamplingFlux", "DualCLIPLoader", "UNETLoaderGGUF"):
            has_flux_nodes = True
        if ct == "CLIPTextEncodeSDXL":
            has_sdxl_nodes = True
        if ct not in ("UNETLoader", "CheckpointLoaderSimple", "CheckpointLoader",
                      "DualCLIPLoader", "LoraLoader", "LoraLoaderModelOnly"):
            continue
        ins = node.get("inputs", {}) or {}
        for f in ("unet_name", "ckpt_name", "clip_name1", "lora_name"):
            v = ins.get(f)
            if isinstance(v, str) and v:
                names.append(v.lower())
    joined = " ".join(names)
    if "flux" in joined or ("fp8" in joined and "sd" not in joined):
        return "flux"
    if has_flux_nodes:
        return "flux"
    if "sdxl" in joined or "xl" in joined or "sd_xl" in joined:
        return "sdxl"
    if has_sdxl_nodes:
        return "sdxl"
    if "sd1" in joined or "1.5" in joined or "v1-" in joined:
        return "sd15"
    # 常见 SD1.5 模型名兜底（文件名无显式标识）
    for kw in ("dreamshaper", "anything", "realistic", "deliberate", "chillout",
               "meinamix", "revanimated", "cetusmix", "abyss", "ghostmix",
               "anime", "majicmix", "counterfeit", "pastel"):
        if kw in joined:
            return "sd15"
    return "unknown"


@router.get("/workflows/{wf_id}/params/analyze")
def analyze_workflow_params(wf_id: str):
    """分析工作流可参数化节点，返回候选参数 + 已保存配置 + 模型类型"""
    wf, err = _find_workflow_v2(wf_id)
    if not wf:
        return {"ok": False, "error": err or "工作流不存在"}
    candidates = _analyze_workflow_params(wf["workflow_json"], _get_object_info((_get_config().get("server_url") or "").rstrip("/")))
    db = get_db()
    presets = db.execute("SELECT * FROM comfyui_workflow_presets WHERE workflow_id=? ORDER BY id", [wf_id]).fetchall()
    return {"ok": True, "candidates": candidates, "presets": [dict(r) for r in presets],
            "model_type": _detect_model_type(wf["workflow_json"])}


@router.get("/workflows/{wf_id}/presets")
def list_presets(wf_id: str):
    db = get_db()
    rows = db.execute("SELECT * FROM comfyui_workflow_presets WHERE workflow_id=? ORDER BY id", [wf_id]).fetchall()
    return {"ok": True, "items": [dict(r) for r in rows]}


@router.post("/workflows/{wf_id}/presets")
def create_preset(wf_id: str, data: PresetCreate):
    """保存参数配置（编辑模式保存后前端可切换锁定为用户模式）"""
    db = get_db()
    db.execute(
        """INSERT INTO comfyui_workflow_presets (workflow_id, name, params_json, mode)
           VALUES (?,?,?,?)""",
        [wf_id, data.name or "参数配置", json.dumps(data.params, ensure_ascii=False), data.mode])
    safe_commit()
    pid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    return {"ok": True, "preset_id": pid}


@router.put("/presets/{preset_id}")
def update_preset(preset_id: int, data: PresetUpdate):
    db = get_db()
    sets = ["updated_at=datetime('now','localtime')"]
    args = []
    if data.name is not None:
        sets.append("name=?"); args.append(data.name)
    if data.params is not None:
        sets.append("params_json=?"); args.append(json.dumps(data.params, ensure_ascii=False))
    if data.mode is not None:
        sets.append("mode=?"); args.append(data.mode)
    args.append(preset_id)
    db.execute(f"UPDATE comfyui_workflow_presets SET {', '.join(sets)} WHERE id=?", args)
    safe_commit()
    return {"ok": True}


@router.delete("/presets/{preset_id}")
def delete_preset(preset_id: int):
    db = get_db()
    db.execute("DELETE FROM comfyui_workflow_presets WHERE id=?", [preset_id])
    safe_commit()
    return {"ok": True}


@router.get("/runtime")
def comfyui_runtime():
    """当前 ComfyUI 运行状态：执行中 + 排队中的任务（供前端直观查看）"""
    cfg = _get_config()
    if not cfg.get("enabled"):
        return {"ok": False, "error": "ComfyUI 未启用"}
    url = (cfg.get("server_url") or "").rstrip("/")
    if not url:
        return {"ok": False, "error": "未配置服务器地址"}
    try:
        with httpx.Client(timeout=5) as cl:
            q = cl.get(f"{url}/queue").json()
        def _fmt(item):
            return {"prompt_id": item[1] if len(item) > 1 else "",
                    "node_count": len(item[2]) if len(item) > 2 and isinstance(item[2], dict) else 0}
        running = [_fmt(i) for i in q.get("queue_running", [])]
        pending = [_fmt(i) for i in q.get("queue_pending", [])]
        return {"ok": True, "running": running, "pending": pending,
                "running_count": len(running), "pending_count": len(pending)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/workflows/by-card/{card_id}")
def get_workflow_by_card(card_id: int):
    """从词卡调取工作流：优先 workflow_id 关联，否则从预览 PNG 元数据提取（查重复用）"""
    db = get_db()
    row = db.execute("SELECT id, workflow_id, preview_media, original_ref, content FROM word_card WHERE id=?", [card_id]).fetchone()
    if not row:
        return {"ok": False, "error": "词卡不存在"}
    if row["workflow_id"]:
        wf, err = _find_workflow_v2(row["workflow_id"])
        if wf:
            return {"ok": True, "workflow_id": wf["id"], "name": wf.get("name", ""), "via": "word_card"}
    # 从原图/预览媒体 PNG 提取（图片词卡原图在 original_ref，视频词卡才用 preview_media）
    media = row["original_ref"] or row["preview_media"] or ""
    if media.lower().endswith(".png"):
        for base in (OUTPUTS_DIR, ORIGINALS_DIR, THUMB_DIR):
            pp = os.path.join(base, os.path.basename(media))
            if not os.path.exists(pp):
                continue
            with open(pp, "rb") as f:
                parsed = _parse_png_workflow(f.read())
            if not parsed["prompt"]:
                continue
            wf = parsed["prompt"]
            wf_str = json.dumps(wf, ensure_ascii=False, sort_keys=True)
            # 查重：结构与库中已有工作流相同则复用
            existing = db.execute("SELECT id FROM comfyui_workflows").fetchall()
            for ex in existing:
                try:
                    e = db.execute("SELECT workflow_json FROM comfyui_workflows WHERE id=?", [ex["id"]]).fetchone()
                    if e and json.dumps(json.loads(e["workflow_json"]), ensure_ascii=False, sort_keys=True) == wf_str:
                        db.execute("UPDATE word_card SET workflow_id=? WHERE id=?", [ex["id"], card_id])
                        safe_commit()
                        return {"ok": True, "workflow_id": ex["id"], "via": "word_card", "matched": True}
                except Exception:
                    pass
            # 新导入
            wf_id = "wf_" + str(int(time.time() * 1000)) + "_" + uuid.uuid4().hex[:6]
            pos_text = _extract_positive_text(wf)
            name = (pos_text[:20] + "…") if len(pos_text) > 20 else (pos_text or "从词卡提取")
            db.execute(
                """INSERT INTO comfyui_workflows
                   (id, name, description, workflow_json, prompt_text, source)
                   VALUES (?,?,?,?,?,?)""",
                [wf_id, name, f"从词卡 #{card_id} 提取", json.dumps(wf, ensure_ascii=False), pos_text, "generate"])
            db.execute("UPDATE word_card SET workflow_id=? WHERE id=?", [wf_id, card_id])
            safe_commit()
            return {"ok": True, "workflow_id": wf_id, "name": name, "via": "png_extract"}
    return {"ok": False, "error": "词卡未关联工作流且预览媒体非 ComfyUI PNG"}


# ==================== UI 格式 → API 格式转换 ====================

_comfy_object_info_cache = None
_comfy_object_info_ts = 0


def _get_object_info(server_url: str):
    """获取 ComfyUI 节点定义（带 5min 缓存）"""
    global _comfy_object_info_cache, _comfy_object_info_ts
    now = time.time()
    if _comfy_object_info_cache and now - _comfy_object_info_ts < 300:
        return _comfy_object_info_cache
    try:
        with httpx.Client(timeout=8) as cl:
            info = cl.get(f"{server_url}/object_info").json()
        _comfy_object_info_cache = info
        _comfy_object_info_ts = now
        return info
    except Exception:
        return _comfy_object_info_cache or {}


def _ui_to_api_wf(ui_wf: dict, object_info: dict = None) -> dict:
    """ComfyUI UI 格式工作流 → API 格式（可提交执行）
    widgets_values 按 object_info input 顺序映射，links 填充连线输入
    """
    api = {}
    nodes = {n.get("id"): n for n in ui_wf.get("nodes", []) if n.get("type")}
    in_links = {}
    for link in ui_wf.get("links", []) or []:
        if len(link) < 6:
            continue
        _id, from_node, from_slot, to_node, to_slot, _t = link[:6]
        in_links.setdefault((to_node, to_slot), []).append((from_node, from_slot))

    for nid, node in nodes.items():
        ct = node.get("type", "")
        # 跳过 UI 注释类节点（MarkdownNote/Note），避免入库后提交 400
        if ct in _SKIP_NODE_TYPES:
            continue
        inputs = {}
        info = (object_info or {}).get(ct, {})
        req = info.get("input", {}).get("required", {}) or {}
        opt = info.get("input", {}).get("optional", {}) or {}
        order = list(req.keys()) + list(opt.keys())
        widgets = node.get("widgets_values") or []
        node_inputs_def = node.get("inputs") or []
        # 新版 ComfyUI(0.10+)：widget 输入也定义在 inputs 中（带 widget 字段）
        # 此时 node.inputs 顺序即 widgets_values 顺序，直接按序映射
        has_widget_defs = any(i.get("widget") for i in node_inputs_def)
        if has_widget_defs:
            wi = 0
            for i, inp in enumerate(node_inputs_def):
                name = inp.get("name", "")
                if not name:
                    continue
                if inp.get("link") is not None or (nid, i) in in_links:
                    conns = in_links.get((nid, i))
                    if conns:
                        inputs[name] = [str(conns[0][0]), conns[0][1]]
                elif inp.get("widget"):
                    if wi < len(widgets):
                        val = widgets[wi]
                        wi += 1
                        if val is None:
                            continue
                        if isinstance(val, str) and val in ("true", "false"):
                            val = val == "true"
                        inputs[name] = val
        else:
            # 旧版兼容：widgets_values 按 object_info order 映射 + links 填连接
            info = (object_info or {}).get(ct, {})
            req = info.get("input", {}).get("required", {}) or {}
            opt = info.get("input", {}).get("optional", {}) or {}
            order = list(req.keys()) + list(opt.keys())
            slot_names = {i.get("name") for i in node_inputs_def if i.get("name")}
            wi = 0
            for name in order:
                if name in slot_names:
                    continue
                if wi >= len(widgets):
                    break
                val = widgets[wi]
                wi += 1
                if val is None:
                    continue
                if isinstance(val, str) and val in ("true", "false"):
                    val = val == "true"
                inputs[name] = val
            for i, inp in enumerate(node_inputs_def):
                name = inp.get("name", "")
                conns = in_links.get((nid, i))
                if conns and name:
                    inputs[name] = [str(conns[0][0]), conns[0][1]]
        api[str(nid)] = {"class_type": ct, "inputs": inputs}
    return api


def _find_comfy_workflows_dir():
    """定位 ComfyUI 保存模板目录（user/default/workflows）
    从进程命令行解析 main.py 完整路径
    """
    try:
        import subprocess
        out = subprocess.run(["wmic", "process", "where", "name='python.exe'", "get", "commandline"],
                             capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            if "main.py" not in line:
                continue
            m_idx = line.lower().find("main.py")
            if m_idx < 0:
                continue
            start = line.rfind('"', 0, m_idx)
            if start == -1:
                start = line.rfind(' ', 0, m_idx)
            main_path = line[start + 1:m_idx].strip().strip('"').strip()
            if not main_path:
                continue
            d = os.path.join(os.path.dirname(main_path), "user", "default", "workflows")
            if os.path.isdir(d):
                return d
    except Exception:
        pass
    return None


@router.get("/available")
def list_available_sources():
    """列出可从 ComfyUI 获取的工作流来源：已保存模板 / 运行中 / 排队中 / 最近运行"""
    cfg = _get_config()
    url = (cfg.get("server_url") or "").rstrip("/")
    result = {"ok": True, "templates": [], "running": [], "pending": [], "recent": [], "server_url": url}
    # 1. 已保存模板（文件系统）
    wf_dir = _find_comfy_workflows_dir()
    if wf_dir and os.path.isdir(wf_dir):
        try:
            for fn in sorted(os.listdir(wf_dir)):
                if not fn.lower().endswith(".json"):
                    continue
                fp = os.path.join(wf_dir, fn)
                try:
                    with open(fp, "r", encoding="utf-8") as f:
                        ui = json.load(f)
                    n_nodes = len(ui.get("nodes", []))
                    mtime = time.strftime("%m-%d %H:%M", time.localtime(os.path.getmtime(fp)))
                    result["templates"].append({
                        "name": fn[:-5], "file": fn, "node_count": n_nodes, "mtime": mtime, "path": fp
                    })
                except Exception:
                    pass
        except Exception:
            pass
    # 2. 运行中/排队中
    if url:
        try:
            with httpx.Client(timeout=5) as cl:
                q = cl.get(f"{url}/queue").json()
            for item in q.get("queue_running", []):
                wf = item[2] if len(item) > 2 and isinstance(item[2], dict) else {}
                result["running"].append({"prompt_id": item[1] if len(item) > 1 else "", "node_count": len(wf)})
            for item in q.get("queue_pending", []):
                wf = item[2] if len(item) > 2 and isinstance(item[2], dict) else {}
                result["pending"].append({"prompt_id": item[1] if len(item) > 1 else "", "node_count": len(wf)})
        except Exception:
            pass
        # 3. 最近运行（history 前 5）
        try:
            with httpx.Client(timeout=5) as cl:
                hist = cl.get(f"{url}/history").json()
            for pid, e in list(hist.items())[:5]:
                p = e.get("prompt", [])
                wf = p[2] if len(p) > 2 and isinstance(p[2], dict) else {}
                pos_text = _extract_positive_text(wf)
                status = e.get("status", {}).get("status_str", "")
                result["recent"].append({
                    "prompt_id": pid, "node_count": len(wf),
                    "prompt_text": pos_text[:60], "status": status
                })
        except Exception:
            pass
    return result


class RewriteWorkflowRequest(BaseModel):
    prompt_text: str = ""        # positive 提示词
    negative_text: str = ""      # negative 提示词
    params: dict = {}             # {"{node_id}.{field}": value} 写回对应节点


def _trace_conditioning(wf: dict, node_id, depth=0):
    """沿 conditioning 链路追踪到 CLIPTextEncode 节点（穿透 FluxGuidance 等中间节点）"""
    if depth > 5:
        return None
    nid = str(node_id)
    if nid not in wf:
        return None
    node = wf[nid]
    ct = node.get("class_type", "")
    if ct == "CLIPTextEncode":
        return nid
    ins = node.get("inputs", {})
    for key in ("conditioning", "positive"):
        v = ins.get(key)
        if isinstance(v, list) and len(v) >= 1:
            r = _trace_conditioning(wf, v[0], depth + 1)
            if r:
                return r
    return None


def _find_positive_node(wf: dict):
    """定位 positive 提示词节点
    优先级：KSampler.positive → SamplerCustomAdvanced.guider 链路 → 其他 Guider → fallback 首个有 text 的 CLIPTextEncode
    """
    # 1. KSampler.positive 链路
    for nid, node in wf.items():
        if node.get("class_type") == "KSampler":
            pos = node.get("inputs", {}).get("positive")
            if isinstance(pos, list) and len(pos) >= 1:
                r = _trace_conditioning(wf, pos[0])
                if r:
                    return r
    # 2. SamplerCustomAdvanced.guider 链路（Flux 原生采样）
    for nid, node in wf.items():
        if node.get("class_type") == "SamplerCustomAdvanced":
            g = node.get("inputs", {}).get("guider")
            if isinstance(g, list) and len(g) >= 1:
                r = _trace_conditioning(wf, g[0])
                if r:
                    return r
    # 3. 其他 Guider 节点
    for nid, node in wf.items():
        ct = node.get("class_type", "")
        if "Guider" in ct or ct in ("BasicGuider", "CFGGuider"):
            cond = node.get("inputs", {}).get("conditioning")
            if isinstance(cond, list) and len(cond) >= 1:
                r = _trace_conditioning(wf, cond[0])
                if r:
                    return r
    # 4. fallback：首个有 text 键的 CLIPTextEncode（字符串或连线均可）
    for nid, node in wf.items():
        if node.get("class_type") == "CLIPTextEncode" and "text" in node.get("inputs", {}):
            return str(nid)
    return None


def _find_negative_node(wf: dict):
    """定位 negative 提示词节点"""
    # 1. KSampler.negative 链路
    for nid, node in wf.items():
        if node.get("class_type") == "KSampler":
            neg = node.get("inputs", {}).get("negative")
            if isinstance(neg, list) and len(neg) >= 1:
                r = _trace_conditioning(wf, neg[0])
                if r:
                    return r
    # 2. fallback：positive 之外的 CLIPTextEncode（优先空字符串）
    pos = _find_positive_node(wf)
    empty = None
    for nid, node in wf.items():
        if node.get("class_type") == "CLIPTextEncode" and str(nid) != str(pos):
            t = node.get("inputs", {}).get("text", "")
            if isinstance(t, str) and not t.strip():
                empty = str(nid)
                break
    if empty:
        return empty
    for nid, node in wf.items():
        if node.get("class_type") == "CLIPTextEncode" and str(nid) != str(pos):
            return str(nid)
    return None


@router.post("/workflows/{wf_id}/reset")
def reset_workflow(wf_id: str):
    """清零工作流：清空所有 CLIPTextEncode 提示词 + seed 归零，保留模板结构"""
    wf, err = _find_workflow_v2(wf_id)
    if not wf:
        return {"ok": False, "error": err or "工作流不存在"}
    wj = wf["workflow_json"]
    cleared_text = 0
    cleared_seed = 0
    # 文本型节点（CLIPTextEncode / Text Multiline / Text Concatenate 等）的 text 字符串字段清空
    for nid, node in wj.items():
        if not isinstance(node, dict):
            continue
        ins = node.get("inputs", {})
        if not isinstance(ins, dict):
            continue
        for field, val in ins.items():
            if field == "text" and isinstance(val, str) and val:
                ins[field] = ""
                cleared_text += 1
        ct = node.get("class_type", "")
        if ct in ("KSampler", "SamplerCustomAdvanced") and "seed" in ins and ins["seed"]:
            ins["seed"] = 0
            cleared_seed += 1
    db = get_db()
    db.execute("UPDATE comfyui_workflows SET workflow_json=?, prompt_text='', updated_at=datetime('now','localtime') WHERE id=?",
               [json.dumps(wj, ensure_ascii=False), wf_id])
    safe_commit()
    return {"ok": True, "cleared_text": cleared_text, "cleared_seed": cleared_seed}


@router.post("/workflows/{wf_id}/rewrite")
def rewrite_workflow(wf_id: str, data: RewriteWorkflowRequest):
    """重写工作流：覆盖提示词（positive/negative）与任意参数（node_id.field），保存到库中模板"""
    wf, err = _find_workflow_v2(wf_id)
    if not wf:
        return {"ok": False, "error": err or "工作流不存在"}
    wj = wf["workflow_json"]
    # 1. 参数直接写回
    applied = 0
    for key, val in (data.params or {}).items():
        parts = key.split(".")
        if len(parts) == 2 and parts[0] in wj:
            ins = wj[parts[0]].get("inputs", {})
            if parts[1] in ins:
                try:
                    cur = ins[parts[1]]
                    if isinstance(cur, bool):
                        val = bool(val)
                    elif isinstance(cur, int):
                        val = int(float(val))
                    elif isinstance(cur, float):
                        val = float(val)
                except Exception:
                    pass
                ins[parts[1]] = val
                applied += 1
    # 2. 提示词写入 positive / negative 节点
    pos_node = _find_positive_node(wj)
    if pos_node and data.prompt_text is not None:
        wj[pos_node]["inputs"]["text"] = data.prompt_text
    neg_node = _find_negative_node(wj)
    if neg_node and data.negative_text is not None:
        wj[neg_node]["inputs"]["text"] = data.negative_text
    db = get_db()
    db.execute("UPDATE comfyui_workflows SET workflow_json=?, prompt_text=?, updated_at=datetime('now','localtime') WHERE id=?",
               [json.dumps(wj, ensure_ascii=False), data.prompt_text or "", wf_id])
    safe_commit()
    return {"ok": True, "applied": applied, "positive_node": pos_node, "negative_node": neg_node}


def _compose_prompt(preset_text: str, card_text: str, style_suffix: str) -> str:
    """自然语言组合规则
    针对分镜构图模块：卡片内容(构图指令)优先，确保模型接收到明确的构图要求
    其他模块：预设主体 + 卡片细节
    """
    preset = preset_text.strip() if preset_text else ""
    card = card_text.strip() if card_text else ""
    suffix = style_suffix.strip() if style_suffix else ""
    preset_len = len(preset)
    card_len = len(card)

    parts = []
    if preset:
        # 卡片很短而预设很长时，卡片优先（典型：分镜构图词 + 长预设）
        if card and preset_len > 200 and card_len <= 60:
            parts.append(card.rstrip(","))
            parts.append(preset.rstrip(","))
        else:
            parts.append(preset.rstrip(","))
            if card:
                parts.append(card.rstrip(","))
    elif card:
        parts.append(card.rstrip(","))
    if suffix:
        parts.append(suffix.rstrip(","))

    return ", ".join(parts)


class PresetsUpdate(BaseModel):
    presets: dict  # {module_name: {preset: str, enabled: bool}}


@router.get("/module-presets")
def get_module_presets():
    """获取所有模块的主体预设提示词"""
    presets = _get_module_presets()
    presets = _auto_populate_missing_presets(presets)
    # 额外获取模块列表供前端使用
    db = get_db()
    modules = []
    rows = db.execute("SELECT DISTINCT module FROM prompts WHERE module != '' ORDER BY module").fetchall()
    for r in rows:
        modules.append(r["module"])
    return {"ok": True, "presets": presets, "modules": modules, "style_suffix": DEFAULT_STYLE_SUFFIX}


@router.post("/module-presets")
def update_module_presets(data: PresetsUpdate):
    """保存模块主体预设提示词"""
    _save_module_presets(data.presets)
    return {"ok": True}


class ConfigUpdate(BaseModel):
    config: dict


@router.get("/config")
def get_comfyui_config():
    cfg = _get_config()
    return {"ok": True, "config": cfg}


@router.post("/config")
def update_comfyui_config(data: ConfigUpdate):
    _save_config(data.config)
    return {"ok": True}


class GenerateRequest(BaseModel):
    prompt_id: int
    prompt_text: str = ""        # 提示词卡片内容
    workflow_id: str = ""
    module_name: str = ""        # 所属模块，用于取预设
    module_preset: str = ""      # 模块主体预设（可在前端传递）
    preset_id: int = 0           # 工作流参数配置（用户模式表单提交）
    param_values: dict = {}      # {参数key: 值}，注入到工作流对应节点


class SyncRequest(BaseModel):
    server_url: str = ""
    source: str = ""   # ''=最近运行 / file=<模板文件名> / history=<prompt_id> / queue=<prompt_id>


class BatchGenerateRequest(BaseModel):
    prompt_ids: list[int]
    workflow_id: str = ""


@router.post("/batch-generate")
async def batch_generate_thumbnail(data: BatchGenerateRequest):
    """批量 AI 生成缩略图 — 逐条排队发送到 ComfyUI，SSE 流式返回，每生成一张即刻推送"""
    cfg = _get_config()
    if not cfg.get("enabled") or not cfg.get("server_url"):
        return {"ok": False, "error": "ComfyUI 未启用或服务器地址未配置"}

    workflow_cfg, _ = _find_workflow(cfg, data.workflow_id)
    if not workflow_cfg or not workflow_cfg.get("workflow_json"):
        return {"ok": False, "error": "未找到工作流模板，请先配置"}

    server_url = cfg["server_url"].rstrip("/")
    workflow_template = workflow_cfg["workflow_json"]
    node_id = workflow_cfg.get("prompt_node_id", "6")
    field = workflow_cfg.get("prompt_field", "text")
    presets = _get_module_presets()
    total = len(data.prompt_ids)

    async def event_stream():
        success_count = 0
        error_count = 0
        db = get_db()

        for idx, pid in enumerate(data.prompt_ids):
            row = db.execute("SELECT content, module FROM prompts WHERE id=?", [pid]).fetchone()
            if not row:
                ev = {"prompt_id": pid, "ok": False, "error": "提示词不存在", "index": idx, "total": total}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                error_count += 1
                continue

            card_text = row["content"]
            module_name = row["module"] or ""
            preset_text = ""
            if module_name:
                pm = presets.get(module_name, {})
                if pm.get("enabled") and pm.get("preset"):
                    preset_text = pm["preset"]
            final_prompt = _compose_prompt(preset_text, card_text, DEFAULT_STYLE_SUFFIX)

            wf = copy.deepcopy(workflow_template)
            if node_id in wf and field in wf[node_id]["inputs"]:
                wf[node_id]["inputs"][field] = final_prompt

            try:
                result = await _run_comfyui(server_url, wf, workflow_cfg, final_prompt, pid)
                if result.get("ok"):
                    success_count += 1
                else:
                    error_count += 1
                ev = {"prompt_id": pid, "ok": result.get("ok", False), "thumbnail": result.get("thumbnail"),
                      "thumbnail_url": result.get("thumbnail_url"), "error": result.get("error"),
                      "index": idx, "total": total, "done": idx + 1}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            except Exception as e:
                ev = {"prompt_id": pid, "ok": False, "error": str(e), "index": idx, "total": total, "done": idx + 1}
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                error_count += 1

            await asyncio.sleep(0.5)

        # 完成事件
        final = {"complete": True, "total": total, "success": success_count, "errors": error_count}
        yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/sync")
def sync_workflow(data: SyncRequest = None):
    """从 ComfyUI queue/history 自动提取最新工作流并导入 PromptKit 配置"""
    cfg = _get_config()
    server_url = cfg.get("server_url", "http://127.0.0.1:8188").rstrip("/")
    if data and data.server_url:
        server_url = data.server_url.rstrip("/")

    try:
        import httpx
        _http_sync = httpx.Client(timeout=httpx.Timeout(10.0))
    except ImportError:
        try:
            import requests as _requests
            _http_sync = type('_',(),{'get':lambda self,url: _req(url)})()
            def _req(url):
                r = _requests.get(f"{server_url}{url}", timeout=10)
                return type('_',(),{'status_code':r.status_code,'json':lambda: r.json()})()
        except ImportError:
            return {"ok": False, "error": "需要安装 httpx 或 requests"}

    def _http_get(path):
        try:
            if isinstance(_http_sync, httpx.Client):
                r = _http_sync.get(f"{server_url}{path}")
                return (r.status_code, r.json())
            else:
                r = _http_sync.get(path)
                return (r.status_code, r.json())
        except Exception as e:
            return (0, {"error": str(e)})

    code, qdata = _http_get("/queue")
    workflow = None
    source = ""
    source_name = ""

    # ===== 指定来源导入 =====
    src = (data.source if data else "") or ""
    if src:
        if src.startswith("file="):
            fname = src[5:]
            wf_dir = _find_comfy_workflows_dir()
            fp = os.path.join(wf_dir, fname) if wf_dir else ""
            if not fp or not os.path.exists(fp):
                return {"ok": False, "error": f"模板文件不存在: {fname}"}
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    ui = json.load(f)
                obj_info = _get_object_info(server_url)
                workflow = _ui_to_api_wf(ui, obj_info)
                source = "saved_template"
                source_name = fname[:-5]
            except Exception as e:
                return {"ok": False, "error": f"模板解析失败: {e}"}
        elif src.startswith("history="):
            pid = src[8:]
            code_h, hentry = _http_get(f"/history/{pid}")
            if code_h == 200 and isinstance(hentry, dict) and pid in hentry:
                p = hentry[pid].get("prompt", [])
                if len(p) > 2 and isinstance(p[2], dict):
                    workflow = p[2]
                    source = "history"
                    source_name = pid[:8]
            if not workflow:
                return {"ok": False, "error": "未找到该历史任务的工作流"}
        elif src.startswith("queue="):
            qpid = src[6:]
            for items in (qdata.get("queue_running", []), qdata.get("queue_pending", [])):
                for item in items:
                    if len(item) > 1 and item[1] == qpid and isinstance(item[2], dict):
                        workflow = item[2]
                        source = "queue"
                        source_name = qpid[:8]
                        break
                if workflow:
                    break
            if not workflow:
                return {"ok": False, "error": "队列中未找到该任务"}

    if not workflow:
        for items, label in [(qdata.get("queue_running", []), "queued_running"),
                             (qdata.get("queue_pending", []), "queued_pending")]:
            if items:
                item = items[0]
                if isinstance(item, (list, tuple)) and len(item) >= 3:
                    wf = item[2]
                    if isinstance(wf, dict) and len(wf) > 3:
                        workflow = wf
                        source = label
                        break

    if not workflow:
        code, hist = _http_get("/history")
        if code == 200 and isinstance(hist, dict) and hist:
            hid = list(hist.keys())[0]
            entry = hist[hid]
            prompt_data = entry.get("prompt", [])
            if isinstance(prompt_data, list) and len(prompt_data) >= 3:
                wf = prompt_data[2]
                if isinstance(wf, dict) and len(wf) > 3:
                    workflow = wf
                    source = f"history"

    if not workflow:
        return {"ok": False, "error": "无法从 ComfyUI 获取工作流。请确保 ComfyUI 正在运行且队列/历史中有任务。"}

    prompt_node_id = None
    prompt_field = None
    candidates = []
    for nid, node in workflow.items():
        ct = node.get("class_type", "")
        inputs = node.get("inputs", {})
        if ct == "CLIPTextEncode" and "text" in inputs:
            candidates.append((nid, "text", inputs.get("text", "")))
    if len(candidates) == 1:
        prompt_node_id, prompt_field = candidates[0][0], candidates[0][1]
    elif len(candidates) > 1:
        non_empty = [(n, f, t) for n, f, t in candidates if t.strip()]
        if non_empty:
            prompt_node_id, prompt_field = non_empty[0][0], non_empty[0][1]
        else:
            prompt_node_id, prompt_field = candidates[0][0], candidates[0][1]

    output_node_id = None
    for nid, node in workflow.items():
        ct = node.get("class_type", "")
        if ct == "SaveImage":
            output_node_id = nid
            break

    if not prompt_node_id:
        for nid, node in workflow.items():
            inputs = node.get("inputs", {})
            if "text" in inputs:
                prompt_node_id, prompt_field = nid, "text"
                break
    if not prompt_node_id:
        prompt_node_id, prompt_field = "6", "text"
    if not prompt_field:
        prompt_field = "text"
    if not output_node_id:
        output_node_id = "9"

    wf_id = "wf_" + uuid.uuid4().hex[:12]
    name = source_name or "从ComfyUI同步"

    # 查重（仅自动同步模式；用户主动选择来源时总是新增，避免“选了没反应”）
    if not src:
        for w in cfg.get("workflows", []):
            ewf = w.get("workflow_json", {})
            if len(ewf) == len(workflow):
                if w.get("prompt_node_id") == prompt_node_id and w.get("image_output_node_id") == output_node_id:
                    cfg["active_workflow"] = w["id"]
                    _save_config(cfg)
                    return {
                        "ok": True,
                        "status": "已匹配",
                        "matched": True,
                        "workflow_id": w["id"],
                        "workflow_name": w.get("name", ""),
                        "prompt_node_id": prompt_node_id,
                        "prompt_field": prompt_field,
                        "output_node_id": output_node_id,
                        "node_count": len(workflow),
                        "source": source
                    }

    # 新模板写入 comfyui_workflows 表（此前误写 config 旧数组导致列表不显示）
    _db2 = get_db()
    _db2.execute(
        """INSERT OR IGNORE INTO comfyui_workflows
           (id, name, description, workflow_json, ui_json, prompt_text, thumbnail, source, tags)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        [wf_id, name, f"从ComfyUI {source}自动同步 ({len(workflow)}节点)",
         json.dumps(workflow, ensure_ascii=False), "",
         _extract_positive_text(workflow), "", "comfyui_sync", ""])
    # active_workflow 记录到 config（兼容旧逻辑），旧数组不再追加（防复活）
    cfg["active_workflow"] = wf_id
    _save_config(cfg)
    return {
        "ok": True,
        "status": "已导入",
        "matched": False,
        "workflow_id": wf_id,
        "workflow_name": name,
        "prompt_node_id": prompt_node_id,
        "prompt_field": prompt_field,
        "output_node_id": output_node_id,
        "node_count": len(workflow),
        "source": source
    }


@router.post("/generate")
async def generate_thumbnail(data: GenerateRequest):
    """发送提示词到 ComfyUI → 等待生成 → 下载图片 → 设为缩略图
    自动组合：模块主体预设 + 卡片内容 + 品质后缀
    """
    cfg = _get_config()
    if not cfg.get("enabled") or not cfg.get("server_url"):
        return {"ok": False, "error": "ComfyUI 未启用或服务器地址未配置"}

    # 1. 取卡片内容（若参数配置已含提示词参数值，无需查库）
    db = get_db()
    preset_prompt_val = None
    if data.preset_id and data.param_values:
        try:
            _prow = db.execute("SELECT params_json FROM comfyui_workflow_presets WHERE id=?", [data.preset_id]).fetchone()
            if _prow:
                for _p in json.loads(_prow["params_json"]):
                    if _p.get("key") in data.param_values and _p.get("type") == "text":
                        preset_prompt_val = str(data.param_values[_p.get("key")])
                        break
        except Exception:
            pass
    if data.prompt_text:
        card_text = data.prompt_text
    elif preset_prompt_val:
        card_text = preset_prompt_val
    else:
        row = db.execute("SELECT content FROM prompts WHERE id=?", [data.prompt_id]).fetchone()
        if not row:
            return {"ok": False, "error": "提示词不存在"}
        card_text = row["content"]

    # 2. 取模块主体预设 + 组合
    module_name = data.module_name or ""
    preset_text = data.module_preset or ""
    if not preset_text and module_name:
        presets = _get_module_presets()
        pm = presets.get(module_name, {})
        if pm.get("enabled") and pm.get("preset"):
            preset_text = pm["preset"]

    final_prompt = _compose_prompt(preset_text, card_text, DEFAULT_STYLE_SUFFIX)
    print(f"[ComfyUI] 组合后提示词: {final_prompt[:200]}")

    # 3. 查找工作流（工作流库优先，兼容旧配置）
    workflow_cfg, wf_err = _find_workflow_v2(data.workflow_id)
    if not workflow_cfg:
        cfg_old, _ = _find_workflow(cfg, data.workflow_id)
        if not cfg_old or not cfg_old.get("workflow_json"):
            return {"ok": False, "error": wf_err or "未找到工作流模板，请先配置"}
        workflow_cfg = {
            "workflow_json": cfg_old["workflow_json"],
            "prompt_node_id": cfg_old.get("prompt_node_id", "6"),
            "prompt_field": cfg_old.get("prompt_field", "text"),
            "image_output_node_id": cfg_old.get("image_output_node_id", "9"),
            "id": data.workflow_id or cfg_old.get("id", ""),
        }

    server_url = cfg["server_url"].rstrip("/")
    workflow = workflow_cfg["workflow_json"]
    # 记录工作流使用次数
    if workflow_cfg.get("id"):
        try:
            db.execute("UPDATE comfyui_workflows SET usage_count=usage_count+1, last_used_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?", [workflow_cfg["id"]])
            safe_commit()
        except Exception:
            pass

    # 参数配置注入（用户模式表单）：把 param_values 写回工作流对应节点
    if data.preset_id:
        try:
            prow = db.execute("SELECT params_json FROM comfyui_workflow_presets WHERE id=? AND workflow_id=?",
                              [data.preset_id, workflow_cfg.get("id", "")]).fetchone()
            if prow:
                params = json.loads(prow["params_json"])
                _apply_params(workflow, params, data.param_values or {})
                # 若参数表单包含提示词节点字段且用户填写，优先使用表单提示词
                pn, pf = workflow_cfg.get("prompt_node_id", "6"), workflow_cfg.get("prompt_field", "text")
                for p in params:
                    if str(p.get("node_id")) == str(pn) and p.get("field") == pf and p.get("key") in (data.param_values or {}):
                        final_prompt = str(data.param_values[p["key"]])
                        break
        except Exception as e:
            print(f"[ComfyUI] 参数注入失败: {e}")

    # SD1.5 默认 512 分辨率兜底：模板 EmptyLatentImage 默认宽高任一 >1024 且用户未通过参数显式设置时，
    # 降级为 512×512（SD1.5 原生训练分辨率，1024+ 会构图畸形/多人物）
    try:
        if _detect_model_type(workflow) == "sd15":
            user_size = False
            if data.preset_id and data.param_values:
                for _k in (data.param_values or {}):
                    if str(_k).endswith(".width") or str(_k).endswith(".height"):
                        user_size = True
                        break
            if not user_size:
                for _nid, _node in workflow.items():
                    if _node.get("class_type") == "EmptyLatentImage":
                        _ins = _node.get("inputs", {}) or {}
                        _w, _h = _ins.get("width"), _ins.get("height")
                        if isinstance(_w, (int, float)) and isinstance(_h, (int, float)) and (_w >= 1024 or _h >= 1024):
                            _ins["width"] = 512
                            _ins["height"] = 512
                            print(f"[ComfyUI] SD1.5 模板尺寸 {_w}x{_h} 越界，已按默认降级为 512x512")
    except Exception as _e:
        print(f"[ComfyUI] SD15 尺寸兜底失败: {_e}")

    try:
        return await _run_comfyui(server_url, workflow, workflow_cfg, final_prompt, data.prompt_id)
    except Exception as e:
        import traceback
        print("[ComfyUI] 生成异常:", e)
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


class SaveCardRequest(BaseModel):
    output_file: str = ""     # data/comfyui_outputs 下文件名
    workflow_id: str = ""
    prompt_text: str = ""
    name: str = ""
    group_id: int = 0         # 可选：存到指定词卡组
    module: str = "custom"


@router.post("/generate/save-card")
def save_generated_as_card(data: SaveCardRequest):
    """将 ComfyUI 生成结果存为词卡：原图关联 original_ref + 缩略图 + content=提示词
    注意：preview_media 是词库「视频预览」专用字段（前端据此渲染 <video>），
    图片词卡必须留空，否则缩略图会被误渲染为视频控件。
    """
    import shutil
    if not data.output_file:
        return {"ok": False, "error": "缺少 output_file"}
    src = os.path.join(OUTPUTS_DIR, os.path.basename(data.output_file))
    if not os.path.exists(src):
        return {"ok": False, "error": f"生成文件不存在: {data.output_file}"}
    db = get_db()
    # 1. 缩略图：优先复用生成流程已建的 {原图basename}.jpg（_run_comfyui 已生成），
    #    避免同一生成图在图片库出现两张；不存在时才创建 ai_thumb_*
    os.makedirs(THUMB_DIR, exist_ok=True)
    src_base = os.path.splitext(os.path.basename(src))[0]
    thumb_name = src_base + ".jpg"
    tp = os.path.join(THUMB_DIR, thumb_name)
    iw = ih = 0
    if not os.path.exists(tp):
        thumb_name = "ai_thumb_" + uuid.uuid4().hex[:12] + ".jpg"
        tp = os.path.join(THUMB_DIR, thumb_name)
        try:
            _im = Image.open(src)
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
            shutil.copy(src, tp)
    else:
        # 复用已有缩略图，仅读取原图尺寸
        try:
            _im = Image.open(src)
            iw, ih = _im.size
        except Exception:
            pass
    # 2. 创建词卡（word_card）
    content = data.prompt_text or ""
    if not content:
        with open(src, "rb") as f:
            parsed = _parse_png_workflow(f.read())
        if parsed["prompt"]:
            content = _extract_positive_text(parsed["prompt"])
    name = data.name or (content[:20] + "…" if len(content) > 20 else (content or "ComfyUI 生成"))
    import datetime
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.execute(
        """INSERT INTO word_card
           (group_id, name, content, meaning, scene, module, category, tags, icon, thumbnail,
            preview_media, media_type, is_builtin, is_deleted, source, created_at, updated_at,
            thumb_width, thumb_height, original_ref, workflow_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        [data.group_id or 1, name, content, "", "", data.module or "custom", "", "[]", "🖼️",
         thumb_name, "", "image", 0, 0, "comfyui_generated",
         now, now, iw, ih, os.path.basename(src), data.workflow_id])
    card_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    # 3. media_assets 登记
    try:
        fsize = os.path.getsize(src)
        db.execute(
            """INSERT OR IGNORE INTO media_assets
               (filename, original_filename, file_size, original_size, media_type,
                width, height, mime_type, prompt_id, source, workflow_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            [os.path.basename(src), os.path.basename(src), fsize, fsize, "image",
             iw, ih, "image/png", card_id, "comfyui_workflow", data.workflow_id])
    except Exception as e:
        print(f"[ComfyUI] 资产登记失败: {e}")
    # 4. 更新生成日志关联
    try:
        db.execute("UPDATE comfyui_generation_logs SET card_id=?, card_type='word_card', thumb_file=? WHERE output_file=? AND card_id=0",
                   [card_id, thumb_name, os.path.basename(src)])
    except Exception:
        pass
    safe_commit()
    return {"ok": True, "card_id": card_id, "name": name, "thumbnail": thumb_name,
            "preview_media": "", "original_ref": os.path.basename(src)}


@router.get("/generation-logs")
def list_generation_logs(limit: int = Query(50, ge=1, le=200), status: str = ""):
    """生成历史记录（附带解析后的缩略图 URL）
    thumb_file 兜底解析：旧 ai_thumb_* 已迁移，按 output_file 同名 {base}.jpg 或词卡 thumbnail 还原
    """
    db = get_db()
    sql = "SELECT * FROM comfyui_generation_logs"
    args = []
    if status:
        sql += " WHERE status=?"
        args.append(status)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    rows = db.execute(sql, args).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        thumb = d.get("thumb_file") or ""
        if thumb and not os.path.exists(os.path.join(THUMB_DIR, thumb)):
            # 按 output_file（{base}.png）推导同名 {base}.jpg
            base = (d.get("output_file") or "").rsplit(".", 1)[0]
            cand = base + ".jpg" if base else ""
            if cand and os.path.exists(os.path.join(THUMB_DIR, cand)):
                thumb = cand
            elif d.get("card_id"):
                row2 = db.execute("SELECT thumbnail FROM word_card WHERE id=?", [d["card_id"]]).fetchone()
                if row2 and row2["thumbnail"] and os.path.exists(os.path.join(THUMB_DIR, row2["thumbnail"])):
                    thumb = row2["thumbnail"]
        d["thumb_url"] = ("/api/thumbnails/file/" + thumb) if thumb else ""
        items.append(d)
    return {"ok": True, "items": items}



async def _run_comfyui(server_url, workflow, workflow_cfg, prompt_text, prompt_id):
    """执行 ComfyUI 生成流程（同步 httpx + 线程池，避免异步死锁）"""
    loop = asyncio.get_event_loop()
    import time as _time, uuid, io as _io

    def _sync_run():
        nonlocal workflow
        _t0 = _time.time()
        import random
        # 过滤不可执行的 UI 注释节点（如 MarkdownNote），避免 ComfyUI 400 invalid_prompt
        workflow = _strip_ui_nodes(workflow)
        # 清洗 UI 占位符输入值（steps=randomize / denoise=normal / 枚举位置数字）
        _sanitize_workflow_inputs(workflow, _get_object_info(server_url))
        node_id = workflow_cfg.get("prompt_node_id", "6")
        field = workflow_cfg.get("prompt_field", "text")
        if node_id in workflow and field in workflow[node_id]["inputs"]:
            workflow[node_id]["inputs"][field] = prompt_text
        # 随机 seed：每次生成结果不同
        # 覆盖所有 seed 类字段（KSampler.seed / RandomNoise.noise_seed / SamplerCustomAdvanced.seed 等），
        # 避免 FLUX 等工作流 seed 固定 → 相同提示词命中 ComfyUI 结果缓存 → 无输出 → 超时失败
        for _nid, _node in workflow.items():
            if not isinstance(_node, dict):
                continue
            _ins = _node.get("inputs")
            if not isinstance(_ins, dict):
                continue
            for _k, _v in _ins.items():
                if _k in ("seed", "noise_seed") and isinstance(_v, (int, float)) and not isinstance(_v, bool):
                    _ins[_k] = random.randint(0, 2**53 - 1)
        from database import get_db
        from PIL import Image as PILImage
        import os

        # Step 1: submit to ComfyUI
        with httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0)) as cl:
            r = cl.post(f"{server_url}/prompt", json={"prompt": workflow})
            if r.status_code != 200:
                return {"ok": False, "error": f"ComfyUI HTTP {r.status_code}: {r.text[:300]}"}
            pid = r.json().get("prompt_id")
            if not pid:
                return {"ok": False, "error": "ComfyUI 未返回 prompt_id"}
            print(f"[ComfyUI] 已提交 prompt_id={pid}")

        # Step 2: poll for completion
        out_imgs = []
        for sec in range(0, 600, 2):
            _time.sleep(2)
            try:
                with httpx.Client(timeout=5) as qc:
                    qd = qc.get(f"{server_url}/queue").json()
                    running = any(p[1] == pid for p in qd.get("queue_running", []))
                    pending = any(p[1] == pid for p in qd.get("queue_pending", []))
                    if not running and not pending:
                        _time.sleep(0.5)
            except:
                pass
            try:
                with httpx.Client(timeout=8) as cl:
                    hist = cl.get(f"{server_url}/history/{pid}").json()
                    if pid not in hist:
                        continue
                    for no in hist[pid].get("outputs", {}).values():
                        for im in no.get("images", []):
                            if im.get("type") in ("output", "temp"):
                                out_imgs.append(im)
                    if out_imgs:
                        print(f"[ComfyUI] 获取到 {len(out_imgs)} 张输出")
                        break
                    # 任务已结束但无输出：ComfyUI 结果缓存命中（相同提示词+相同 seed）或节点静默失败，
                    # 立即返回明确错误，避免干等 600s
                    st = hist[pid].get("status", {}) or {}
                    if st.get("completed"):
                        return {"ok": False, "error": "ComfyUI 任务已结束但未产出图片（相同提示词+相同种子命中结果缓存，请更换提示词或种子重试）"}
            except Exception as e:
                print(f"[ComfyUI] 轮询 {sec}s: {e}")

        if not out_imgs:
            return {"ok": False, "error": "生成超时(600s)"}

        # Step 3: download
        im = out_imgs[0]
        print(f"[ComfyUI] 下载: {im['filename']}")
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as cl:
            vr = cl.get(f"{server_url}/view", params={"filename": im["filename"], "subfolder": im.get("subfolder",""), "type": im["type"]})
            if vr.status_code != 200:
                return {"ok": False, "error": f"下载失败 HTTP {vr.status_code}"}
            img_bytes = vr.content
        print(f"[ComfyUI] 下载完成 {len(img_bytes)} bytes")

        # Step 4: save thumbnail + original
        os.makedirs(THUMB_DIR, exist_ok=True)
        os.makedirs(ORIGINALS_DIR, exist_ok=True)
        _base = uuid.uuid4().hex
        tf = _base + ".jpg"
        tp = os.path.join(THUMB_DIR, tf)
        iw, ih = 0, 0
        try:
            _im = PILImage.open(_io.BytesIO(img_bytes))
            iw, ih = _im.size
            sw, sh = _im.size
            tr = 240.0 / 160.0
            sr = sw / sh
            if sr > tr:
                nw = int(sh * tr)
                ox = (sw - nw) // 2
                _im = _im.crop((ox, 0, ox + nw, sh))
            else:
                nh = int(sw / tr)
                oy = (sh - nh) // 2
                _im = _im.crop((0, oy, sw, oy + nh))
            _im = _im.resize((240, 160), PILImage.LANCZOS)
            if _im.mode in ("RGBA", "P"):
                _im = _im.convert("RGB")
            _im.save(tp, "JPEG", quality=85)
        except Exception:
            with open(tp, "wb") as f:
                f.write(img_bytes)

        of = _base + ".jpg"
        op = os.path.join(ORIGINALS_DIR, of)
        with open(op, "wb") as f:
            f.write(img_bytes)

        # 原图 PNG 存档（保留自带 prompt/workflow 元数据，可再次提取工作流）
        os.makedirs(OUTPUTS_DIR, exist_ok=True)
        png_name = _base + ".png"
        with open(os.path.join(OUTPUTS_DIR, png_name), "wb") as f:
            f.write(img_bytes)

        # Step 5: write DB
        db = get_db()
        if prompt_id > 0:
            db.execute("DELETE FROM prompt_videos WHERE prompt_id=?", [prompt_id])
            db.execute("INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) VALUES (?,?,'image',datetime('now','localtime'))", [prompt_id, tf])
            try:
                ts = os.path.getsize(tp) if os.path.exists(tp) else 0
                db.execute("""INSERT OR IGNORE INTO media_assets
                    (filename, original_filename, file_size, original_size,
                     media_type, width, height, mime_type, prompt_id, source, workflow_id)
                    VALUES (?,?,?,?,'image',?,?,'image/jpeg',?,'ai_generated',?)""",
                    [tf, of, ts, len(img_bytes), iw, ih, prompt_id, workflow_cfg.get("id", "")])
            except Exception as _e:
                print(f"[ComfyUI] 媒体资产写入失败: {_e}")
        # 生成日志（可追溯）
        try:
            db.execute(
                """INSERT INTO comfyui_generation_logs
                   (workflow_id, prompt_text, seed, status, output_file, thumb_file, duration_sec, engine)
                   VALUES (?,?,?,?,?,?,?,?)""",
                [workflow_cfg.get("id", ""), prompt_text[:500],
                 next((n["inputs"]["seed"] for n in workflow.values() if n.get("class_type") == "KSampler"), 0),
                 "success", png_name, tf, _time.time() - _t0, "comfyui"])
        except Exception as _e:
            print(f"[ComfyUI] 生成日志写入失败: {_e}")
        safe_commit()
        print(f"[ComfyUI] 已关联 prompt_id={prompt_id}: {tf}")
        return {"ok": True, "thumbnail": tf, "thumbnail_url": f"/api/thumbnails/file/{tf}", "original": of, "output_file": png_name, "image_size": len(img_bytes), "generated_from": prompt_text[:80]}

    return await loop.run_in_executor(None, _sync_run)

