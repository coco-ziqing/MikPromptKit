# -*- coding: utf-8 -*-
"""
code-review-audit / model_router_dispatch.py
=============================================
双模型分层路由（控 Token 核心）—— 与 6 技能矩阵统一 schema

  - DeepSeek V4 Pro  → 完整 6 维度深度审计（高 Token，安全/逻辑/性能全覆盖）
  - DeepSeek V4 Flash → 轻量规范检查（低 Token，语法/风格/格式）

路由优先级：手动斜杠指令 > 自动场景判定（手动强制覆盖）。
只做决策，不发起真实模型调用。
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Optional

MODEL_PRO = "deepseek/deepseek-v4-pro"
MODEL_FLASH = "deepseek/deepseek-v4-flash"

_SLASH_LOCK = {
    "/code-review-full": MODEL_PRO,
    "/code-review-quick": MODEL_FLASH,
}

# PRO 重型关键词（深度审计）
_PRO_KEYWORDS = [
    "代码审查", "代码评审", "code review", "检查漏洞", "安全审计", "pr评审",
    "diff校验", "重构建议", "找bug", "风险点排查", "审计",
]
# FLASH 轻量关键词（仅规范）
_FLASH_KEYWORDS = [
    "代码格式检查", "语法检查", "性能优化提示", "代码风格", "格式检查", "规范检查",
]

_BUDGET = {
    MODEL_PRO: {"max_output_tokens": 2600, "verbosity": "full"},
    MODEL_FLASH: {"max_output_tokens": 500, "verbosity": "compact"},
}

# 自动判定阈值
_PRO_FINDINGS_THRESHOLD = 3   # 命中安全/逻辑/性能类问题 >=3 倾向深度
_PRO_LINES_THRESHOLD = 60     # 代码行数 >=60 倾向深度


@dataclass
class RouteDecision:
    model: str
    mode: str                      # "full" | "quick"
    reason: str
    forced_by_slash: bool
    max_output_tokens: int
    verbosity: str
    matched_signals: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _slash_in(text: str) -> Optional[str]:
    low = (text or "").strip().lower()
    for cmd in _SLASH_LOCK:
        if low.startswith(cmd) or f" {cmd}" in f" {low}":
            return cmd
    return None


def _auto_score(signals: dict, raw_low: str) -> tuple[str, List[str]]:
    """
    signals 可含：
      high_severity  高危(安全/逻辑/性能)问题数
      code_lines     代码行数
      is_diff        是否为 diff/PR 片段
    """
    matched: List[str] = []
    s = signals or {}

    flash_kw = [k for k in _FLASH_KEYWORDS if k in raw_low]
    pro_kw = [k for k in _PRO_KEYWORDS if k in raw_low]

    if flash_kw and not pro_kw:
        return MODEL_FLASH, [f"轻量关键词:{flash_kw[0]}（仅规范检查）"]

    if pro_kw:
        matched.append("重型关键词:" + "/".join(pro_kw[:4]))
    if s.get("high_severity", 0) >= _PRO_FINDINGS_THRESHOLD:
        matched.append(f"高危问题{s['high_severity']}处(安全/逻辑/性能)")
    if s.get("code_lines", 0) >= _PRO_LINES_THRESHOLD:
        matched.append(f"代码{s['code_lines']}行(规模较大)")
    if s.get("is_diff"):
        matched.append("diff/PR 变更片段(需上下文审计)")

    if matched:
        return MODEL_PRO, matched
    return MODEL_FLASH, ["无重型信号 → 轻量规范检查（压缩输出省Token）"]


def route(user_input: str = "", signals: Optional[dict] = None, raw_text: str = "") -> RouteDecision:
    blob_low = (raw_text or "").lower()
    slash = _slash_in(user_input)
    if slash:
        model = _SLASH_LOCK[slash]
        b = _BUDGET[model]
        return RouteDecision(
            model=model, mode="full" if model == MODEL_PRO else "quick",
            reason=f"手动指令 {slash} 强制锁定（覆盖自动分流）",
            forced_by_slash=True, max_output_tokens=b["max_output_tokens"],
            verbosity=b["verbosity"], matched_signals=[f"slash:{slash}"],
        )
    model, matched = _auto_score(signals or {}, blob_low)
    b = _BUDGET[model]
    return RouteDecision(
        model=model, mode="full" if model == MODEL_PRO else "quick",
        reason="自动场景判定" + ("（高危/规模大→全维度审计）" if model == MODEL_PRO
                              else "（仅规范→轻量检查，压缩输出省Token）"),
        forced_by_slash=False, max_output_tokens=b["max_output_tokens"],
        verbosity=b["verbosity"], matched_signals=matched,
    )


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print('用法: python model_router_dispatch.py <代码文件> [--input "<用户输入>"]')
        return 2
    user_input = ""
    if "--input" in argv:
        i = argv.index("--input")
        if i + 1 < len(argv):
            user_input = argv[i + 1]
    p = Path(argv[1])
    raw = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    lines = len(raw.splitlines())
    is_diff = raw.lstrip().startswith("diff ") or "@@" in raw
    decision = route(user_input=user_input,
                     signals={"code_lines": lines, "is_diff": is_diff}, raw_text=user_input)
    print(json.dumps(decision.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
