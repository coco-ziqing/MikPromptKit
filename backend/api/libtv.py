"""
LibTV 图片生成集成 — 词卡缩略图第三生成引擎
通过本地 libtv CLI 提交文生图任务（node create -t image --run），
产物 URL 从节点 JSON data.url[0] 提取，下载后走公共落库链路（thumb_gen）
"""
import os, json, re, subprocess, time as _t
from fastapi import APIRouter
from pydantic import BaseModel
from api.thumb_gen import save_generated_image
import httpx

router = APIRouter(prefix="/api/v2/libtv", tags=["libtv"])

LIBTV_BIN = os.path.join(os.path.expanduser("~"), ".libtv", "libtv.exe")

# 免费模型优先（积分不足时仍可用）；付费模型前端需明确提示
DEFAULT_MODEL = "Z-image Turbo"
FREE_MODELS = ["Z-image Turbo", "Seedream 4.0", "Seedream 4.5", "Seedream 5.0 Lite"]
RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]


def _libtv_run(args, timeout=300):
    """调用 libtv CLI，返回 (stdout, stderr, returncode)"""
    try:
        r = subprocess.run([LIBTV_BIN] + args, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
        return r.stdout or "", r.stderr or "", r.returncode
    except FileNotFoundError:
        return "", f"未找到 libtv CLI: {LIBTV_BIN}", -1
    except Exception as e:
        return "", str(e), -1


def _parse_json(out: str):
    """从 stdout/stderr 提取最后一个完整 JSON 对象（CLI 会先输出节点创建 JSON，再输出运行结果 JSON）
    用平衡括号扫描最外层对象，避免贪婪正则吞并多个 JSON
    兼容 CLI 非标准输出：单引号字符串、undefined、无引号键"""
    # 逐字符扫描所有顶层 {...} 块
    blocks = []
    depth = 0
    start = -1
    in_str = False
    esc = False
    for i, ch in enumerate(out):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                blocks.append(out[start:i + 1])
                start = -1

    def _loose_loads(s):
        # 标准解析优先
        try:
            return json.loads(s)
        except Exception:
            pass
        # 宽松：单引号→双引号、undefined→null、身份键到引号
        try:
            s2 = re.sub(r"'([^']*)'", r'"\1"', s)          # 单引号值
            s2 = re.sub(r"([{,])\s*(\w+)\s*:", r'\1"\2":', s2)  # 无引号键
            s2 = s2.replace("undefined", "null")
            return json.loads(s2)
        except Exception:
            return None

    for block in reversed(blocks):
        d = _loose_loads(block)
        if isinstance(d, dict):
            return d
    return None


@router.get("/status")
def libtv_status():
    """检查 libtv CLI 可用性 / 登录态 / 画布列表 / 图片模型列表"""
    cli_available = os.path.exists(LIBTV_BIN)
    logged_in = False
    projects = []
    models = []
    if cli_available:
        # 登录态：account info 含 user.uuid
        out, err, code = _libtv_run(["account", "info"], timeout=30)
        if '"uuid"' in out or '"user"' in out:
            logged_in = True
        # 画布列表：先默认范围（含自动生效 workspace），空则回退根目录 -w 0
        try:
            pout, _, _ = _libtv_run(["project", "list"], timeout=30)
            pd = _parse_json(pout)
            if not (pd and pd.get("projectMetaList")):
                pout, _, _ = _libtv_run(["project", "list", "-w", "0"], timeout=30)
                pd = _parse_json(pout)
            if pd and pd.get("projectMetaList"):
                for p in pd["projectMetaList"]:
                    projects.append({"uuid": p.get("uuid", ""), "name": p.get("name", ""),
                                     "workspaceId": p.get("workspaceId") or p.get("folderId", 0)})
        except Exception:
            pass
        # 图片模型列表（免费/付费分组）
        try:
            mout, _, _ = _libtv_run(["model", "search", "--type", "image"], timeout=30)
            md = _parse_json(mout)
            if md and md.get("matches"):
                for m in md["matches"]:
                    mk = m.get("modelKey", "")
                    mn = m.get("modelName", mk)
                    models.append({"modelKey": mk, "modelName": mn,
                                   "free": mn in FREE_MODELS,
                                   "vip": bool(m.get("vip")), "estimatedTime": m.get("estimatedTime", "")})
        except Exception:
            pass
    return {"ok": True, "cli_available": cli_available, "logged_in": logged_in,
            "projects": projects, "models": models,
            "default_model": DEFAULT_MODEL, "ratios": RATIOS,
            "bin": LIBTV_BIN}


class LibTVGenerateRequest(BaseModel):
    prompt: str = ""
    prompt_id: int = 0              # 关联词卡/词条 id
    card_type: str = "word_card"    # word_card / prompts
    project_uuid: str = ""          # LibTV 目标画布（必填）
    model: str = DEFAULT_MODEL      # 模型名（modelName，CLI 解析为 modelKey）
    ratio: str = "1:1"


def libtv_text2image(prompt: str, project_uuid: str, model: str = DEFAULT_MODEL,
                     ratio: str = "1:1", retries: int = 1, timeout: int = 300) -> dict:
    """调用 libtv CLI 文生图：node create -t image -p <uuid> -s model=... -s prompt=... --run
    返回 {ok, image_url, width, height, node_key}
    产物 URL 从返回 JSON data.url[0] 提取；节点名 thumb_<epoch_ms> 保证画布内唯一"""
    last_err = ""
    for attempt in range(retries + 1):
        node_name = f"thumb_{int(_t.time() * 1000)}"
        args = ["node", "create", node_name, "-t", "image",
                "-p", project_uuid,
                "-s", f"model={model}",
                "-s", f"prompt={prompt}",
                "-s", f"ratio={ratio}",
                "--run"]
        out, err, code = _libtv_run(args, timeout=timeout)
        data = _parse_json(out)
        if not data:
            # 提取 stderr 中的错误（API Request Error JSON）
            ejson = _parse_json(err)
            reason = ""
            if ejson:
                reason = str(ejson.get("msg") or ejson.get("extra_msg") or "")[:200]
            last_err = f"LibTV 生成失败: {reason or (err or out)[-200:]}"
        else:
            d = data.get("data") or {}
            urls = d.get("url") or []
            if urls:
                u = urls[0] if isinstance(urls, list) else str(urls)
                return {"ok": True, "image_url": u,
                        "width": 0, "height": 0, "node_key": data.get("nodeKey", node_name)}
            # 任务可能还在进行或失败；先查 stderr 的 API 错误（如算力不足）
            ejson2 = _parse_json(err)
            if ejson2 and (ejson2.get("code") or ejson2.get("msg")):
                reason = str(ejson2.get("msg") or ejson2.get("extra_msg") or "")[:200]
                last_err = f"LibTV 生成失败: {reason}"
            else:
                task = d.get("taskInfo") or {}
                status = task.get("status")
                if status == 2:
                    last_err = "LibTV 任务完成但未返回图片 URL"
                else:
                    reason = str(task.get("error") or data.get("error") or "")[:200]
                    last_err = f"LibTV 生成未完成(status={status}): {reason or '未知'}"
        if attempt < retries:
            _t.sleep(2 * (attempt + 1))
    return {"ok": False, "error": last_err or "LibTV 生成失败"}


@router.post("/generate")
def libtv_generate(data: LibTVGenerateRequest):
    """单张 LibTV 生成：文生图 → 下载 → 缩略图落库"""
    if not data.prompt or not data.prompt.strip():
        return {"ok": False, "error": "提示词为空"}
    if not data.project_uuid:
        return {"ok": False, "error": "未指定 LibTV 画布"}
    res = libtv_text2image(data.prompt, data.project_uuid, data.model, data.ratio)
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
    saved = save_generated_image(img_bytes, data.prompt_id, data.card_type, "libtv", res.get("node_key", ""))
    if not saved.get("ok"):
        return {"ok": False, "error": saved.get("error", "落库失败")}
    return {"ok": True, "thumbnail": saved["thumbnail"], "thumbnail_url": saved["thumbnail_url"],
            "width": saved["width"], "height": saved["height"], "node_key": res.get("node_key")}
