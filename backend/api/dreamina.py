"""
Dreamina（即梦）图片生成集成 — 词卡缩略图第二生成引擎
通过本地 dreamina CLI 提交文生图任务，下载原图并生成为词卡缩略图（与 ComfyUI 引擎同落库链路）
"""
import json
import os
import re
import subprocess

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from api.thumb_gen import save_generated_image  # 公共落库链路（2026-08-06 提取）

router = APIRouter(prefix="/api/v2/dreamina", tags=["dreamina"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.cli_paths import find_dreamina_bin  # 位置无关探测（2026-08-06）

DREAMINA_BIN = find_dreamina_bin()

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
            "model_versions": MODEL_VERSIONS, "ratios": RATIOS, "resolution_types": RESOLUTION_TYPES,
            "bin": DREAMINA_BIN}


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


def dreamina_submit_text2image(prompt: str, model_version: str = "5.0", ratio: str = "1:1",
                        resolution_type: str = "2k", width: int = 0, height: int = 0,
                        generate_num: int = 1, timeout: int = 180) -> dict:
    """异步提交文生图任务（--poll 0 立即返回），不等待生成完成。
    返回 {ok, submit_id, gen_status}；调用方需自行轮询 query_result 并下载。
    用于三视图等异步回写链路（v5.36.46）。
    """
    args = ["text2image", "--prompt", prompt, "--model_version", model_version,
            "--generate_num", str(generate_num), "--poll", "0"]
    if width and height:
        args += ["--width", str(width), "--height", str(height), "--resolution_type", resolution_type]
    else:
        args += ["--ratio", ratio, "--resolution_type", resolution_type]
    out, err, code = _dreamina_run(args, timeout=timeout)
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
        return {"ok": False, "error": f"CLI 输出解析失败: {(err or out)[:250]}"}
    submit_id = str(data.get("submit_id") or "").strip()
    if not submit_id:
        return {"ok": False, "error": str(data.get("fail_reason") or "未返回 submit_id")[:250]}
    return {"ok": True, "submit_id": submit_id, "gen_status": data.get("gen_status", "querying")}


def dreamina_text2image(prompt: str, model_version: str = "5.0", ratio: str = "1:1",
                        resolution_type: str = "2k", width: int = 0, height: int = 0,
                        generate_num: int = 1, poll: int = 180, retries: int = 2,
                        timeout: int = 300) -> dict:
    """调用 dreamina CLI 文生图，返回 {ok, image_url, width, height, submit_id}
    即梦生成阶段偶发失败（final generation failed），自动重试 retries 次
    timeout: CLI 子进程超时（秒），防网络悬挂阻塞调用方（2026-08-11 批量场景收紧）"""
    import time as _t
    last_err = ""
    for attempt in range(retries + 1):
        args = ["text2image", "--prompt", prompt, "--model_version", model_version,
                "--generate_num", str(generate_num), "--poll", str(poll)]
        if width and height:
            args += ["--width", str(width), "--height", str(height), "--resolution_type", resolution_type]
        else:
            args += ["--ratio", ratio, "--resolution_type", resolution_type]
        out, err, code = _dreamina_run(args, timeout=timeout)
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
# ==================== 授权管理（2026-08-06 内嵌系统，封装版独立授权） ====================

@router.post("/auth/login-start")
def dreamina_login_start():
    """发起 OAuth Device Flow 授权，返回 verification_uri / user_code / device_code
    前端展示验证码链接，用户浏览器授权后由 login-poll 轮询完成"""
    if not os.path.exists(DREAMINA_BIN):
        return {"ok": False, "error": f"未找到即梦 CLI: {DREAMINA_BIN}"}
    out, err, code = _dreamina_run(["login", "--headless"], timeout=30)
    m_uri = re.search(r"verification_uri:\s*(\S+)", out)
    m_code = re.search(r"user_code:\s*(\S+)", out)
    m_dev = re.search(r"device_code:\s*(\S+)", out)
    m_int = re.search(r"poll_interval:\s*(\S+)", out)
    m_exp = re.search(r"expires_at:\s*(\S+)", out)
    if not (m_uri and m_code and m_dev):
        # 可能已登录复用状态
        if "已" in out or "reuse" in out.lower():
            return {"ok": True, "already_logged_in": True}
        return {"ok": False, "error": f"授权材料获取失败: {(err or out)[:200]}"}
    return {"ok": True, "verification_uri": m_uri.group(1), "user_code": m_code.group(1),
            "device_code": m_dev.group(1),
            "poll_interval": int(m_int.group(1).rstrip("s") or 1) if m_int else 1,
            "expires_at": m_exp.group(1) if m_exp else ""}


class LoginPollRequest(BaseModel):
    device_code: str = ""
    poll: int = 60


@router.post("/auth/login-poll")
def dreamina_login_poll(data: LoginPollRequest):
    """轮询 Device Flow 授权结果：checklogin --device_code --poll"""
    if not data.device_code:
        return {"ok": False, "error": "缺少 device_code"}
    out, err, code = _dreamina_run(["login", "checklogin", "--device_code=" + data.device_code,
                                    "--poll=" + str(data.poll)], timeout=int(data.poll) + 15)
    if "success" in out.lower() or "已" in out or "登录成功" in out:
        return {"ok": True, "logged_in": True}
    m_fail = re.search(r"(?i)(?:fail|error|拒绝|失败|expired|过期)[^\n]*", out + "\n" + err)
    return {"ok": False, "pending": True,
            "error": (m_fail.group(0) if m_fail else "等待授权中...")[:200]}


@router.post("/auth/logout")
def dreamina_logout():
    """退出登录：清除本地 OAuth 状态"""
    out, err, code = _dreamina_run(["logout"], timeout=30)
    if code == 0 and ("已清除" in out or "cleared" in out.lower() or "removed" in out.lower() or not out.strip()):
        return {"ok": True}
    return {"ok": True, "note": (err or out)[:150]}  # logout 无状态时也视为成功


class AccountUseRequest(BaseModel):
    account_id: int = 0


@router.post("/auth/account-list")
def dreamina_account_list():
    """列出可切换账号（dreamina CLI 无多账号，返回当前用户信息）"""
    out, err, code = _dreamina_run(["user_credit"], timeout=30)
    logged_in = '"total_credit"' in out
    info = {}
    try:
        m = re.search(r'"user"\s*:\s*\{([^}]*)\}', out)
        if m:
            for kv in re.findall(r'"(\w+)"\s*:\s*"([^"]*)"', m.group(1)):
                info[kv[0]] = kv[1]
    except Exception:
        pass
    return {"ok": True, "logged_in": logged_in,
            "accounts": [{"accountId": 0, "accountName": info.get("name") or "当前账号",
                          "isActive": True, "info": info}] if logged_in else []}


@router.post("/auth/account-use")
def dreamina_account_use(data: AccountUseRequest):
    """切换账号：即梦 CLI 无多账号，重登即切换（logout + login-start 引导）"""
    dreamina_logout()
    return {"ok": True, "need_relogin": True}
