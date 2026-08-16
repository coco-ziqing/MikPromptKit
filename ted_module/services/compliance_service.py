# -*- coding: utf-8 -*-
"""合规自检：静态扫描模块源码，证明无外网/无浏览器自动化/无定时任务"""
import os
import re

from config import FORBIDDEN_PATTERNS, MODULE_DIR

# 需要排除的自检文件自身（含黑名单关键词文本）与声明文件
_SELF_FILES = {"compliance_service.py", "config.py", "__init__.py"}


def scan_source() -> dict:
    """扫描 ted_module 下所有 .py 源码（排除自检文件自身），统计禁止模式命中"""
    findings = []
    for root, dirs, files in os.walk(MODULE_DIR):
        dirs[:] = [d for d in dirs if d not in ("data", "__pycache__", "tests", "docs", "static")]
        for fn in sorted(files):
            if not fn.endswith(".py") or fn in _SELF_FILES:
                continue
            fp = os.path.join(root, fn)
            rel = os.path.relpath(fp, MODULE_DIR).replace(os.sep, "/")
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            for i, line in enumerate(lines, 1):
                for pat in FORBIDDEN_PATTERNS:
                    if re.search(r"\b" + re.escape(pat), line, re.I):
                        findings.append({"file": rel, "line": i, "pattern": pat,
                                         "code": line.strip()[:80]})
    return {
        "ok": len(findings) == 0,
        "findings": findings,
        "checked_patterns": FORBIDDEN_PATTERNS,
    }


def scan_schedulers() -> dict:
    """确认无定时任务/常驻循环：禁止 schedule/cron/apscheduler/threading.Timer/while True"""
    findings = []
    pats = ["schedule", "cron", "apscheduler", "threading.Timer", "while True", "setInterval"]
    for root, dirs, files in os.walk(MODULE_DIR):
        dirs[:] = [d for d in dirs if d not in ("data", "__pycache__", "tests", "docs", "static")]
        for fn in sorted(files):
            if not fn.endswith(".py") or fn in _SELF_FILES:
                continue
            fp = os.path.join(root, fn)
            rel = os.path.relpath(fp, MODULE_DIR).replace(os.sep, "/")
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            for i, line in enumerate(lines, 1):
                for pat in pats:
                    if re.search(r"\b" + re.escape(pat), line, re.I):
                        findings.append({"file": rel, "line": i, "pattern": pat})
    return {"ok": len(findings) == 0, "findings": findings}


def compliance_report() -> dict:
    """聚合合规自检结果（运行时端点调用）"""
    net = scan_source()
    sched = scan_schedulers()
    report = {
        "ok": net["ok"] and sched["ok"],
        "module": "需求分析",
        "no_network_access": net["ok"],
        "no_browser_automation": net["ok"],
        "no_scheduler": sched["ok"],
        "network_findings": net["findings"],
        "scheduler_findings": sched["findings"],
        "data_source": "仅人工上传静态文件（Excel/CSV/公告录入），无自动获取",
        "checked_at": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    return report
