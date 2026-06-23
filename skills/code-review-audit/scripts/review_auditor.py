# -*- coding: utf-8 -*-
"""
code-review-audit / review_auditor.py
=====================================
6 维度标准化代码审查（核心业务）：
  维度1 语法与编码规范   维度2 业务逻辑缺陷   维度3 性能隐患
  维度4 安全高危漏洞     维度5 可维护性       维度6 边界异常

每条 finding 含：维度/严重级(high/medium/low)/行号/问题/可复制修复建议。
内置规则库 RULES（正则驱动）；纯标准库；可 import 亦可 CLI。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List

# ── 规则库：每条 = (维度, 严重级, 正则, 问题描述, 修复建议) ─────────────
RULES = [
    # 维度4 安全（high）
    ("安全", "high", re.compile(r"(execute|query)\s*\(\s*[\"'].*?\+|\+\s*str\(\w+\)\s*\)"),
     "SQL 注入风险：字符串拼接 SQL", "改用参数化查询：cur.execute('... WHERE id=?',(uid,))"),
    ("安全", "high", re.compile(r"(API_KEY|SECRET|PASSWORD|TOKEN)\s*=\s*[\"'][^\"']+[\"']", re.I),
     "敏感信息硬编码（密钥/密码明文）", "移入环境变量/密钥管理：os.environ['API_KEY']"),
    ("安全", "high", re.compile(r"innerHTML\s*=|<div>[\"']\s*\+|<[^>]*>[\"']\s*\+\s*\w+"),
     "XSS 风险：未转义拼接 HTML", "用 textContent / 框架绑定 / DOMPurify 转义"),
    ("安全", "high", re.compile(r"\beval\s*\(|\bexec\s*\("),
     "动态执行(eval/exec)高危", "避免 eval/exec；用安全解析替代"),
    # 维度3 性能（medium）
    ("性能", "medium", re.compile(r"\.append\(\s*\w+\([^)]*\)\s*\)"),
     "循环内函数调用累积，疑似 N+1 或重复计算", "批量查询/缓存，循环外聚合，避免 N+1"),
    # 维度2 业务逻辑（medium）
    ("逻辑", "medium", re.compile(r"return\s+\w+\s*/\s*\w+\s*$"),
     "除法未处理除零边界", "加 if b==0 兜底或 try/except ZeroDivisionError"),
    # 维度5 可维护性（low）
    ("可维护性", "low", re.compile(r"=\s*\d{4,}\b"),
     "魔法数字（大数字面量）", "提取为具名常量，如 SECONDS_PER_DAY = 86400"),
    ("可维护性", "low", re.compile(r"\b(print|console\.log)\s*\("),
     "残留调试输出", "移除 print/console.log 或改用日志框架"),
    # 维度1 语法规范（low）
    ("语法规范", "low", re.compile(r".{121,}"),
     "单行过长(>120 字符)", "拆分长行，提升可读性"),
    ("语法规范", "low", re.compile(r"\t"),
     "使用了 Tab 缩进（建议统一空格）", "统一为 4 空格缩进（PEP8 / 项目规范）"),
    # 维度6 边界异常（medium）
    ("边界异常", "medium", re.compile(r"\.json\(\)"),
     "解析 JSON 前未校验响应状态/类型", "先判 res.ok 与 content-type，失败走错误分支"),
    ("边界异常", "medium", re.compile(r"\bfetchone\(\)"),
     "取首条结果未判空", "先判 None 再取值，避免 NoneType 错误"),
]

_SEV_ORDER = {"high": 0, "medium": 1, "low": 2}
# 仅匹配行长/Tab 的"格式类"规则，即便在注释行也应检查
_FORMAT_DIMS = {"语法规范"}


@dataclass
class Finding:
    dimension: str
    severity: str
    line: int
    issue: str
    fix: str
    snippet: str = ""


@dataclass
class AuditReport:
    findings: List[Finding] = field(default_factory=list)
    by_dimension: dict = field(default_factory=dict)
    by_severity: dict = field(default_factory=dict)
    high_severity: int = 0
    code_lines: int = 0
    is_diff: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


def audit(text: str) -> AuditReport:
    rep = AuditReport()
    lines = text.splitlines()
    rep.code_lines = len(lines)
    rep.is_diff = text.lstrip().startswith("diff ") or "@@" in text

    for i, ln in enumerate(lines, 1):
        stripped = ln.strip()
        is_comment = stripped.startswith("#") or stripped.startswith("//")
        blank = not stripped
        for dim, sev, pat, issue, fix in RULES:
            # 空行/注释行：仅检查格式类规则（行长/Tab）
            if (blank or is_comment) and dim not in _FORMAT_DIMS:
                continue
            if pat.search(ln):
                rep.findings.append(Finding(
                    dimension=dim, severity=sev, line=i, issue=issue, fix=fix,
                    snippet=stripped[:80],
                ))

    # 去重（同行同问题只留一条）
    seen = set()
    uniq = []
    for f in rep.findings:
        key = (f.line, f.issue)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(f)
    rep.findings = uniq

    for f in rep.findings:
        rep.by_dimension[f.dimension] = rep.by_dimension.get(f.dimension, 0) + 1
        rep.by_severity[f.severity] = rep.by_severity.get(f.severity, 0) + 1
    rep.high_severity = rep.by_severity.get("high", 0)
    rep.findings.sort(key=lambda f: (_SEV_ORDER.get(f.severity, 9), f.line))
    return rep


def audit_file(path: str | Path) -> AuditReport:
    return audit(Path(path).read_text(encoding="utf-8", errors="replace"))


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python review_auditor.py <代码文件>")
        return 2
    p = Path(argv[1])
    text = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    print(json.dumps(audit(text).to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
