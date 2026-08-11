"""
维护工具 API（2026-08-11 关机准备方案优化）
- 邮件推送配置/测试/发送日志包（QQ 邮箱 SMTP）
- 关机准备检查报告（git / 队列 / DB 完整性 / 备份 / 日志包）
路由: /api/maintenance
"""
import datetime
import json
import os
import subprocess

from fastapi import APIRouter, Body
from pydantic import BaseModel

from database import get_db
from logger import query as query_logs

from mailer import get_mail_config_public, save_mail_config, send_mail

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DATA_DIR = os.path.join(_PROJECT_ROOT, "data")
_SERVER_LOG = os.path.join(_DATA_DIR, "start_dev_stdout.log")
_SERVER_ERR = os.path.join(_DATA_DIR, "start_dev_stderr.log")
_BACKUP_DIR = os.path.join(_DATA_DIR, "backups")


def _now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _tail(path, lines=80):
    """读取文件尾部（安全）"""
    try:
        if not os.path.exists(path):
            return f"(文件不存在: {os.path.basename(path)})"
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        arr = content.splitlines()
        return "\n".join(arr[-lines:]) if len(arr) > lines else content
    except Exception as e:
        return f"(读取失败: {e})"


def _git(cmd_args):
    """在项目根执行 git 命令"""
    try:
        r = subprocess.run(["git", "-C", _PROJECT_ROOT] + cmd_args,
                           capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=15, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        return (r.stdout or "").strip()
    except Exception as e:
        return f"(git 不可用: {e})"


def _queue_stats():
    try:
        db = get_db()
        rows = db.execute(
            "SELECT status, COUNT(*) AS c, SUM(total) AS total FROM comfyui_batch_tasks GROUP BY status"
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        return [{"error": str(e)}]


def _db_integrity():
    """quick_check 数据库完整性（独立连接，不阻塞业务）"""
    import sqlite3
    try:
        con = sqlite3.connect(os.path.join(_DATA_DIR, "prompts.db"), timeout=5)
        try:
            r = con.execute("PRAGMA quick_check").fetchone()
            return r[0] if r else "unknown"
        finally:
            con.close()
    except Exception as e:
        return f"error: {e}"


def build_log_package(log_lines: int = 300) -> dict:
    """构建日志包：版本 + 队列 + 运行日志 + 服务日志尾部 + DB 完整性 + 备份状态"""
    items, total = query_logs(limit=log_lines, order="desc")
    log_text = "\n".join(
        f"[{it.get('created_at', '')}] [{it.get('level', '')}] [{it.get('source', '')}] {it.get('message', '')}"
        for it in items
    )
    queue = _queue_stats()
    queue_text = "\n".join(f"  {q.get('status', '?')}: {q.get('c', 0)} 个任务（共 {q.get('total', 0) or 0} 张）" for q in queue)
    try:
        backup_files = []
        if os.path.isdir(_BACKUP_DIR):
            for f in sorted(os.listdir(_BACKUP_DIR), reverse=True)[:5]:
                p = os.path.join(_BACKUP_DIR, f)
                backup_files.append(f"{f} ({os.path.getsize(p) // 1024}KB)")
        backup_text = "\n".join(f"  {b}" for b in backup_files) or "  （无备份）"
    except Exception as e:
        backup_text = f"  （读取失败: {e}）"
    package = {
        "generated_at": _now(),
        "app_version": _git(["describe", "--tags", "--always"]) or "unknown",
        "git_branch": _git(["branch", "--show-current"]) or "unknown",
        "git_head": _git(["log", "-1", "--format=%h %s"]) or "",
        "queue_stats": queue,
        "db_integrity": _db_integrity(),
        "backups": backup_files if 'backup_files' in dir() else [],
        "runtime_logs": items,
    }
    text = (
        "===== MikPromptKit 日志包 =====\n"
        f"生成时间: {package['generated_at']}\n"
        f"版本: {package['app_version']} (branch: {package['git_branch']})\n"
        f"HEAD: {package['git_head']}\n"
        f"DB 完整性(quick_check): {package['db_integrity']}\n"
        f"\n----- 生成队列状态 -----\n{queue_text}\n"
        f"\n----- 最近备份 -----\n{backup_text}\n"
        f"\n----- 运行日志(最近 {log_lines} 条) -----\n{log_text}\n"
        f"\n----- 服务标准输出尾部 -----\n{_tail(_SERVER_LOG, 60)}\n"
        f"\n----- 服务错误输出尾部 -----\n{_tail(_SERVER_ERR, 40)}\n"
    )
    return {"package": package, "text": text}


class MailConfigBody(BaseModel):
    config: dict = {}


@router.get("/mail/config")
def mail_config_get():
    """读取邮件配置（授权码脱敏）"""
    return {"ok": True, "config": get_mail_config_public()}


@router.post("/mail/config")
def mail_config_save(data: MailConfigBody):
    """保存邮件配置"""
    cfg = save_mail_config(data.config or {})
    return {"ok": True, "config": cfg}


@router.post("/mail/test")
def mail_test(data: MailConfigBody):
    """发送测试邮件"""
    cfg = get_mail_config_public()
    if data.config:
        save_mail_config(data.config or {})
        cfg = get_mail_config_public()
    to = cfg.get("mail.to", "")
    if not to:
        return {"ok": False, "error": "未设置收件人"}
    res = send_mail(
        "【MikPromptKit】邮件推送测试",
        f"测试成功！\n\n时间: {_now()}\n发件: {cfg.get('mail.smtp_user', '')}\n收件: {to}\n\n若收到本邮件，说明 SMTP 配置正确。",
    )
    return res


@router.post("/mail/send-log")
def mail_send_log(data: MailConfigBody):
    """构建日志包并发送到配置邮箱（关机准备核心）"""
    if data.config:
        save_mail_config(data.config or {})
    pkg = build_log_package()
    subject = f"【MikPromptKit】日志推送 {pkg['package']['app_version']} {_now()[:16]}"
    res = send_mail(
        subject,
        "本邮件由 MikPromptKit 关机准备/日志推送功能自动发送。\n"
        "日志包摘要见附件，详情如下：\n\n" + pkg["text"][:2000],
        attachments=[("mikpromptkit-logs.txt", pkg["text"].encode("utf-8"))],
    )
    if res.get("ok"):
        return {"ok": True, "message": "日志已发送到邮箱", "generated_at": pkg["package"]["generated_at"]}
    return res


@router.get("/shutdown-prepare")
def shutdown_prepare():
    """关机准备检查报告：git 状态 / tag / 队列 / DB 完整性 / 备份 / 日志包就绪"""
    status = _git(["status", "--porcelain"]) or "(clean)"
    unpushed = _git(["log", "origin/master..HEAD", "--oneline"]) or "(无未推送提交)"
    tag = _git(["describe", "--tags", "--abbrev=0"]) or "(无 tag)"
    queue = _queue_stats()
    active = [q for q in queue if q.get("status") in ("queued", "running")]
    integrity = _db_integrity()
    mail_cfg = get_mail_config_public()
    return {
        "ok": True,
        "report": {
            "checked_at": _now(),
            "git_status": status,
            "unpushed": unpushed,
            "current_tag": tag,
            "head": _git(["log", "-1", "--format=%h %s"]),
            "queue": queue,
            "active_tasks": sum(q.get("c", 0) for q in active),
            "db_integrity": integrity,
            "mail_configured": mail_cfg.get("configured", False),
            "mail_to": mail_cfg.get("mail.to", ""),
            "hints": [
                "工作区存在未提交改动，建议先提交" if status != "(clean)" else None,
                "存在未推送提交，建议 push" if unpushed != "(无未推送提交)" else None,
                f"队列仍有 {sum(q.get('c', 0) for q in active)} 个任务在运行/排队，关机后下次启动将自动断点恢复" if active else None,
                "数据库完整性检查通过" if integrity == "ok" else f"数据库完整性异常: {integrity}",
                "邮件推送已配置，可发送日志到 " + mail_cfg.get("mail.to", "") if mail_cfg.get("configured") else "邮件推送未配置（可到「工具 → 邮件推送设置」配置）",
            ],
        },
    }
