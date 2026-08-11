"""
邮件推送模块（2026-08-11 关机准备/日志推送）
QQ 邮箱 SMTP: smtp.qq.com:465 (SSL)，使用「授权码」而非登录密码。
配置存 sys_global_config（key 前缀 mail.）:
    mail.smtp_host / mail.smtp_port / mail.smtp_user / mail.smtp_pass / mail.to / mail.enabled
"""
import ssl
import smtplib
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from database import get_db, safe_commit

DEFAULTS = {
    "mail.smtp_host": "smtp.qq.com",
    "mail.smtp_port": "465",
    "mail.smtp_user": "",   # 发件邮箱（如 2547159966@qq.com）
    "mail.smtp_pass": "",   # QQ 邮箱授权码（设置→账户→开启 SMTP 生成；非登录密码）
    "mail.to": "",          # 收件邮箱（默认推送目标 2547159966@qq.com）
    "mail.enabled": "0",
}

_SECRET_KEYS = ("mail.smtp_pass",)


def get_mail_config() -> dict:
    """读取邮件配置（合并默认值）"""
    cfg = dict(DEFAULTS)
    try:
        db = get_db()
        rows = db.execute(
            "SELECT config_key, config_value FROM sys_global_config WHERE config_key LIKE 'mail.%'"
        ).fetchall()
        for r in rows:
            cfg[r["config_key"]] = r["config_value"] or ""
    except Exception:
        pass
    return cfg


def get_mail_config_public() -> dict:
    """返回给前端的配置（授权码脱敏）"""
    cfg = get_mail_config()
    out = {}
    for k, v in cfg.items():
        if k in _SECRET_KEYS:
            out[k] = "******" if v else ""
        else:
            out[k] = v
    out["configured"] = bool(cfg.get("mail.smtp_user") and cfg.get("mail.smtp_pass") and cfg.get("mail.to"))
    return out


def save_mail_config(data: dict) -> dict:
    """保存配置；密码字段为空串时保留原值（前端脱敏回显场景）"""
    cfg = get_mail_config()
    db = get_db()
    for k, v in (data or {}).items():
        if k not in DEFAULTS:
            continue
        val = str(v or "").strip()
        if k in _SECRET_KEYS and (val == "" or val == "******"):
            val = cfg.get(k, "")  # 未修改则保留原授权码
        row = db.execute("SELECT 1 FROM sys_global_config WHERE config_key=?", [k]).fetchone()
        if row:
            db.execute(
                "UPDATE sys_global_config SET config_value=?, updated_at=datetime('now','localtime') WHERE config_key=?",
                [val, k])
        else:
            db.execute(
                "INSERT INTO sys_global_config (config_key, config_value, description, updated_at) "
                "VALUES (?,?,?,datetime('now','localtime'))", [k, val, k])
    safe_commit()
    return get_mail_config_public()


def send_mail(subject: str, body_text: str, attachments=None) -> dict:
    """发送邮件
    attachments: [(filename, content_bytes)] — 文本附件（日志包等）
    返回 {ok, error?}
    """
    cfg = get_mail_config()
    user = cfg.get("mail.smtp_user", "").strip()
    pwd = cfg.get("mail.smtp_pass", "").strip()
    to = cfg.get("mail.to", "").strip()
    host = cfg.get("mail.smtp_host", "smtp.qq.com").strip()
    try:
        port = int(cfg.get("mail.smtp_port", "465") or 465)
    except Exception:
        port = 465
    if not user or not pwd or not to:
        return {"ok": False, "error": "邮件配置不完整：请先设置发件邮箱、授权码与收件人"}
    try:
        msg = MIMEMultipart()
        msg["From"] = user
        msg["To"] = to
        msg["Subject"] = Header(subject, "utf-8")
        msg.attach(MIMEText(body_text, "plain", "utf-8"))
        for fname, content in (attachments or []):
            try:
                text = content.decode("utf-8", "replace")
            except Exception:
                text = str(content)
            part = MIMEText(text, "plain", "utf-8")
            part.add_header("Content-Disposition", "attachment", filename=("utf-8", "", fname))
            msg.attach(part)
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, timeout=30, context=ctx) as s:
            s.login(user, pwd)
            s.sendmail(user, [to], msg.as_string())
        return {"ok": True}
    except smtplib.SMTPAuthenticationError:
        return {"ok": False, "error": "SMTP 认证失败：请检查发件邮箱与授权码（QQ 邮箱需用授权码而非密码）"}
    except smtplib.SMTPException as e:
        return {"ok": False, "error": f"SMTP 发送失败: {e}"}
    except Exception as e:
        return {"ok": False, "error": f"发送异常: {e}"}
