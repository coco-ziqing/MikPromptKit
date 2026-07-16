"""
PromptKit 开发日报生成 + 邮件发送
用法: python backend/daily_report.py [--send] [--date 2026-07-15]
  --send   : 实际发送邮件（不带则仅预览）
  --date   : 指定日期，默认今天
"""

import os
import sys
import json
import subprocess
import datetime
import smtplib
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from typing import Optional

# ---- 配置加载 ----
BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / ".env.mail"

DEFAULT_CONFIG = {
    "smtp_host": "smtp.qq.com",
    "smtp_port": 465,
    "smtp_ssl": True,
    "sender_email": "",
    "sender_name": "PromptKit Dev Bot",
    "sender_auth_code": "",
    "recipient_email": "",
    "recipient_name": "ASUS",
}

def load_config() -> dict:
    cfg = DEFAULT_CONFIG.copy()
    if CONFIG_PATH.exists():
        for line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k in cfg:
                    if k in ("smtp_port",):
                        cfg[k] = int(v)
                    elif k == "smtp_ssl":
                        cfg[k] = v.lower() in ("true", "1", "yes")
                    else:
                        cfg[k] = v
    return cfg

def check_config(cfg: dict) -> list:
    missing = []
    for k in ("sender_email", "sender_auth_code", "recipient_email"):
        if not cfg.get(k):
            missing.append(k)
    return missing

# ---- Git 日志抓取 ----
def get_git_log(date_str: str) -> list[dict]:
    """抓取指定日期的 git log"""
    since = f"{date_str}T00:00:00+08:00"
    until = f"{date_str}T23:59:59+08:00"
    try:
        result = subprocess.run(
            ["git", "log", f"--since={since}", f"--until={until}",
             "--format=%H|%h|%s|%ai|%an"],
            capture_output=True, text=True, encoding="utf-8",
            cwd=str(BASE_DIR), timeout=15
        )
        commits = []
        for line in result.stdout.strip().splitlines():
            if not line:
                continue
            parts = line.split("|", 4)
            if len(parts) >= 4:
                commits.append({
                    "hash": parts[0],
                    "short": parts[1],
                    "subject": parts[2],
                    "date": parts[3][:19] if len(parts) > 3 else "",
                    "author": parts[4] if len(parts) > 4 else "",
                })
        return commits
    except Exception as e:
        print(f"[WARN] git log 抓取失败: {e}")
        return []

def get_latest_tags(count: int = 5) -> list[dict]:
    """获取最近 tag"""
    try:
        result = subprocess.run(
            ["git", "tag", "--sort=-creatordate", f"-n{count}"],
            capture_output=True, text=True, encoding="utf-8",
            cwd=str(BASE_DIR), timeout=10
        )
        tags = []
        for line in result.stdout.strip().splitlines()[:count]:
            parts = line.split(None, 1)
            tags.append({
                "name": parts[0] if parts else "",
                "message": parts[1] if len(parts) > 1 else "",
            })
        # 获取 tag 对应 commit 摘要
        for t in tags:
            try:
                r = subprocess.run(
                    ["git", "log", "-1", "--format=%s", t["name"]],
                    capture_output=True, text=True, encoding="utf-8",
                    cwd=str(BASE_DIR), timeout=5
                )
                t["commit_subject"] = r.stdout.strip()
            except Exception:
                t["commit_subject"] = ""
        return tags
    except Exception as e:
        print(f"[WARN] tag 抓取失败: {e}")
        return []

def get_git_diff_stats(date_str: Optional[str] = None) -> str:
    """获取工作区未提交变更或当日 diff 统计"""
    try:
        # 优先看未暂存变更
        r = subprocess.run(
            ["git", "diff", "--stat", "HEAD"],
            capture_output=True, text=True, encoding="utf-8",
            cwd=str(BASE_DIR), timeout=10
        )
        if r.stdout.strip():
            return r.stdout.strip()
        # 否则看暂存区
        r = subprocess.run(
            ["git", "diff", "--cached", "--stat", "HEAD"],
            capture_output=True, text=True, encoding="utf-8",
            cwd=str(BASE_DIR), timeout=10
        )
        return r.stdout.strip()
    except Exception:
        return ""

def get_uncommitted_files() -> list[str]:
    """获取未提交/未跟踪的文件列表"""
    try:
        r = subprocess.run(
            ["git", "status", "--short"],
            capture_output=True, text=True, encoding="utf-8",
            cwd=str(BASE_DIR), timeout=10
        )
        return [line.strip() for line in r.stdout.strip().splitlines() if line.strip()]
    except Exception:
        return []

# ---- 记忆/日志文件读取 ----
def get_today_memory(date_str: str) -> str:
    """读取当天的 memory 文件"""
    mem_path = BASE_DIR / "memory" / f"{date_str}.md"
    if mem_path.exists():
        return mem_path.read_text(encoding="utf-8")
    # fallback: 搜 MEMORY.md 中当天内容
    mem_main = BASE_DIR / "MEMORY.md"
    if mem_main.exists():
        content = mem_main.read_text(encoding="utf-8")
        # 尝试提取当天相关段落
        marker = f"## {date_str}"
        if marker in content:
            idx = content.index(marker)
            return content[idx:idx+8000]
    return ""

def extract_sections(text: str) -> dict:
    """从 memory markdown 提取结构化段落"""
    sections = {
        "overview": "",
        "commits_summary": "",
        "bugfixes": "",
        "new_features": "",
        "tests": "",
        "files": "",
        "decisions": "",
    }
    if not text:
        return sections

    # 提取各段落到 sections
    lines = text.splitlines()
    current_key = "overview"
    for line in lines:
        line_lower = line.lower().strip("# ")
        if "bug" in line_lower and ("修复" in line_lower or "fix" in line_lower):
            current_key = "bugfixes"
        elif "新增" in line_lower or "new" in line_lower or "feat" in line_lower:
            current_key = "new_features"
        elif "回归" in line_lower or "test" in line_lower or "验证" in line_lower:
            current_key = "tests"
        elif "文件清单" in line_lower or "文件" in line_lower:
            current_key = "files"
        elif "决策" in line_lower or "技术决策" in line_lower:
            current_key = "decisions"
        elif "提交" in line_lower or "commit" in line_lower:
            current_key = "commits_summary"
        sections[current_key] += line + "\n"

    return sections

# ---- HTML 日报生成 ----
def generate_html_report(
    date_str: str,
    commits: list[dict],
    tags: list[dict],
    diff_stats: str,
    uncommitted: list[str],
    memory_text: str,
) -> str:
    """生成 HTML 格式日报"""
    date_display = f"{date_str[:4]}年{date_str[5:7]}月{date_str[8:10]}日"
    sections = extract_sections(memory_text)

    # 分类提交
    fixes = [c for c in commits if "fix" in c["subject"].lower() or "修复" in c["subject"]]
    feats = [c for c in commits if "feat" in c["subject"].lower() or "新增" in c["subject"] or "Phase" in c["subject"]]
    others = [c for c in commits if c not in fixes and c not in feats]

    commits_html = ""
    if commits:
        # 按时间排序
        for c in sorted(commits, key=lambda x: x["date"]):
            emoji = ""
            cls = ""
            if c in fixes:
                emoji = "🐛"
                cls = "fix"
            elif c in feats:
                emoji = "✨"
                cls = "feat"
            else:
                emoji = "🔧"
                cls = "other"
            commit_time = c["date"][11:19] if len(c["date"]) >= 19 else c["date"]
            commits_html += f"""
            <tr class="commit-{cls}">
              <td style="color:#666;font-size:12px;white-space:nowrap;">{commit_time}</td>
              <td style="font-family:monospace;font-size:12px;color:#c0392b;">{c['short']}</td>
              <td>{emoji} {c['subject']}</td>
            </tr>"""
    else:
        commits_html = '<tr><td colspan="3" style="color:#999;text-align:center;">本日无提交</td></tr>'

    tags_html = ""
    if tags:
        for t in tags:
            tags_html += f"""
            <tr>
              <td style="font-family:monospace;color:#2980b9;white-space:nowrap;">🏷 {t['name']}</td>
              <td style="font-size:13px;">{t.get('commit_subject', '')}</td>
            </tr>"""
    else:
        tags_html = '<tr><td colspan="2" style="color:#999;text-align:center;">无 tag</td></tr>'

    uncommitted_html = ""
    if uncommitted:
        uncommitted_html = "<ul style='margin:4px 0;'>" + "".join(
            f"<li><code>{f}</code></li>" for f in uncommitted[:15]
        ) + "</ul>"
        if len(uncommitted) > 15:
            uncommitted_html += f"<p style='color:#999;'>... 还有 {len(uncommitted)-15} 个文件</p>"
    else:
        uncommitted_html = '<span style="color:#27ae60;">✅ 工作区干净</span>'

    # 统计数据
    total_commits = len(commits)
    total_fixes = len(fixes)
    total_feats = len(feats)

    # 回归测试行
    test_lines = [l for l in sections["tests"].splitlines() if l.strip() and ("PASS" in l or "exit" in l or "0" in l)]
    test_summary = "<br>".join(test_lines[:5]) if test_lines else "未记录"

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PromptKit 开发日报 — {date_display}</title>
<style>
  body {{ font-family: -apple-system, 'Microsoft YaHei', sans-serif; background:#f5f6fa; margin:0; padding:20px; color:#2c3e50; }}
  .container {{ max-width:720px; margin:0 auto; background:#fff; border-radius:12px; box-shadow:0 2px 16px rgba(0,0,0,0.06); overflow:hidden; }}
  .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:#fff; padding:28px 32px; }}
  .header h1 {{ margin:0 0 4px 0; font-size:22px; }}
  .header .subtitle {{ opacity:0.85; font-size:13px; }}
  .header .stats {{ display:flex; gap:20px; margin-top:16px; }}
  .header .stat {{ text-align:center; }}
  .header .stat-num {{ font-size:28px; font-weight:700; }}
  .header .stat-label {{ font-size:11px; opacity:0.75; }}
  .section {{ padding:20px 32px; border-bottom:1px solid #eee; }}
  .section:last-child {{ border-bottom:none; }}
  .section h2 {{ font-size:16px; margin:0 0 12px 0; padding-bottom:8px; border-bottom:2px solid #667eea; display:inline-block; }}
  table {{ width:100%; border-collapse:collapse; font-size:13px; }}
  td {{ padding:6px 8px; border-bottom:1px solid #f0f0f0; vertical-align:top; }}
  tr:last-child td {{ border-bottom:none; }}
  .commit-fix td:first-child {{ border-left:3px solid #e74c3c; }}
  .commit-feat td:first-child {{ border-left:3px solid #27ae60; }}
  .commit-other td:first-child {{ border-left:3px solid #bdc3c7; }}
  .badge {{ display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }}
  .badge-fix {{ background:#fde8e8; color:#c0392b; }}
  .badge-feat {{ background:#e8f8f0; color:#27ae60; }}
  .badge-tag {{ background:#e8f0fe; color:#2980b9; }}
  .summary-box {{ background:#f8f9fa; border-radius:8px; padding:16px; font-size:13px; line-height:1.7; white-space:pre-wrap; }}
  .footer {{ padding:16px 32px; background:#f8f9fa; color:#95a5a6; font-size:11px; text-align:center; }}
  code {{ background:#f0f0f0; padding:1px 4px; border-radius:3px; font-size:12px; }}
  .divider {{ border:none; border-top:1px dashed #ddd; margin:16px 0; }}
</style>
</head>
<body>
<div class="container">
  <!-- Header -->
  <div class="header">
    <h1>📊 PromptKit 开发日报</h1>
    <div class="subtitle">{date_display} · 自动生成</div>
    <div class="stats">
      <div class="stat"><div class="stat-num">{total_commits}</div><div class="stat-label">提交 Commits</div></div>
      <div class="stat"><div class="stat-num">{total_feats}</div><div class="stat-label">功能 Feature</div></div>
      <div class="stat"><div class="stat-num">{total_fixes}</div><div class="stat-label">修复 BugFix</div></div>
      <div class="stat"><div class="stat-num">{len(tags)}</div><div class="stat-label">标签 Tags</div></div>
    </div>
  </div>

  <!-- 版本标签 -->
  <div class="section">
    <h2>🏷 版本标签</h2>
    <table>{tags_html}</table>
  </div>

  <!-- 提交记录 -->
  <div class="section">
    <h2>📝 Git 提交记录 ({total_commits})</h2>
    <table>
      <thead><tr>
        <th style="width:70px;">时间</th>
        <th style="width:70px;">Commit</th>
        <th>描述</th>
      </tr></thead>
      <tbody>{commits_html}</tbody>
    </table>
  </div>

  <!-- 工作区状态 -->
  <div class="section">
    <h2>📁 工作区状态</h2>
    <p style="font-size:13px;"><strong>未提交/未跟踪文件:</strong></p>
    {uncommitted_html}
    <hr class="divider">
    <p style="font-size:13px;"><strong>Diff 统计:</strong></p>
    <pre style="background:#f8f9fa;padding:12px;border-radius:8px;font-size:12px;overflow-x:auto;">{diff_stats if diff_stats else '(无变更)'}</pre>
  </div>

  <!-- 开发摘要 -->
  <div class="section">
    <h2>📋 开发摘要</h2>
    <div class="summary-box">{sections['overview'][:3000] if sections['overview'] else '(未从 memory 提取到摘要)'}</div>
  </div>

  <!-- Bug 修复 -->
  <div class="section">
    <h2>🐛 Bug 修复</h2>
    <div class="summary-box">{sections['bugfixes'][:2000] if sections['bugfixes'].strip() and len(sections['bugfixes'].strip()) > 5 else '本日无 Bug 修复记录'}</div>
  </div>

  <!-- 回归测试 -->
  <div class="section">
    <h2>✅ 回归测试</h2>
    <div class="summary-box">{test_summary}</div>
  </div>

  <!-- Footer -->
  <div class="footer">
    PromptKit Dev Bot · {date_display} · 自动生成于 {datetime.datetime.now().strftime('%H:%M:%S')}
  </div>
</div>
</body>
</html>"""
    return html


# ---- 邮件发送 ----
def send_email(cfg: dict, html_body: str, date_str: str):
    """通过 QQ SMTP 发送邮件"""
    date_display = f"{date_str[:4]}年{date_str[5:7]}月{date_str[8:10]}日"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"📊 PromptKit 开发日报 — {date_display}"
    msg["From"] = f"{cfg['sender_name']} <{cfg['sender_email']}>"
    msg["To"] = f"{cfg['recipient_name']} <{cfg['recipient_email']}>"

    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        if cfg["smtp_ssl"]:
            server = smtplib.SMTP_SSL(cfg["smtp_host"], cfg["smtp_port"], timeout=15)
        else:
            server = smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=15)
            server.starttls()

        server.login(cfg["sender_email"], cfg["sender_auth_code"])
        server.sendmail(cfg["sender_email"], cfg["recipient_email"], msg.as_string())
        server.quit()
        print(f"[OK] 邮件已发送 → {cfg['recipient_email']}")
        return True
    except smtplib.SMTPAuthenticationError:
        print("[ERROR] SMTP 认证失败！请检查邮箱地址和授权码是否正确")
        print("  提示: QQ邮箱需要使用「授权码」而非QQ密码")
        print("  获取方式: QQ邮箱 → 设置 → 账户 → POP3/SMTP服务 → 生成授权码")
        return False
    except smtplib.SMTPException as e:
        print(f"[ERROR] SMTP 发送失败: {e}")
        return False
    except Exception as e:
        print(f"[ERROR] 发送异常: {e}")
        return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description="PromptKit 开发日报生成")
    parser.add_argument("--send", action="store_true", help="实际发送邮件")
    parser.add_argument("--date", type=str, help="日期 YYYY-MM-DD，默认今天")
    parser.add_argument("--output", type=str, help="输出HTML到文件（预览用）")
    args = parser.parse_args()

    date_str = args.date or datetime.date.today().isoformat()
    cfg = load_config()

    print(f"=== PromptKit 开发日报 ===")
    print(f"日期: {date_str}")
    print(f"工作区: {BASE_DIR}")
    print()

    # 1. Git 日志
    print("[1/5] 抓取 Git 日志...")
    commits = get_git_log(date_str)
    tags = get_latest_tags(5)
    diff_stats = get_git_diff_stats(date_str)
    uncommitted = get_uncommitted_files()
    print(f"  提交: {len(commits)} 条 | Tag: {len(tags)} 个 | 未提交: {len(uncommitted)} 文件")

    # 2. Memory 文件
    print("[2/5] 读取开发记忆...")
    memory_text = get_today_memory(date_str)
    print(f"  记忆长度: {len(memory_text)} 字符")

    # 3. 生成 HTML
    print("[3/5] 生成 HTML 日报...")
    html = generate_html_report(date_str, commits, tags, diff_stats, uncommitted, memory_text)

    # 4. 输出预览
    out_path = Path(args.output) if args.output else (BASE_DIR / "reports" / f"daily_{date_str}.html")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    print(f"  日报已保存: {out_path}")

    # 5. 发送邮件
    if args.send:
        print("[4/5] 检查邮件配置...")
        missing = check_config(cfg)
        if missing:
            print(f"[ERROR] 缺少配置: {', '.join(missing)}")
            print(f"  请编辑 {CONFIG_PATH} 文件填入缺失项")
            sys.exit(1)
        print("[5/5] 发送邮件...")
        ok = send_email(cfg, html, date_str)
        sys.exit(0 if ok else 1)
    else:
        print("[4/5] 跳过发送（加 --send 参数启用邮件发送）")
        print(f"[提示] 预览: {out_path}")

    print("\nDone.")


if __name__ == "__main__":
    main()
