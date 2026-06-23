# -*- coding: utf-8 -*-
"""
code-project-analyze / model_router_dispatch.py
================================================
双模型分层路由（控 Token 核心）—— 与 6 技能矩阵统一 schema

  - DeepSeek V4 Pro  → 完整工程结构化解析（高 Token，多文件/全链路）
  - DeepSeek V4 Flash → 轻量技术栈快照（低 Token，仅识别框架/依赖）

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
    "/analyze-code": MODEL_PRO,
    "/code-stack-only": MODEL_FLASH,
}

# PRO 重型关键词（完整结构化解析）
_PRO_KEYWORDS = [
    "源码分析", "项目梳理", "代码架构", "全链路", "工程拆解", "梳理接口",
    "读代码", "业务链路", "分层架构", "接口流转", "前后端",
]
# FLASH 轻量关键词（仅技术栈）
_FLASH_KEYWORDS = [
    "技术栈识别", "是什么项目", "用了什么框架", "依赖清单", "技术栈",
]

_BUDGET = {
    MODEL_PRO: {"max_output_tokens": 2600, "verbosity": "full"},
    MODEL_FLASH: {"max_output_tokens": 500, "verbosity": "compact"},
}

# 自动判定阈值：源文件数 / 是否跨前后端层
_PRO_FILES_THRESHOLD = 4


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
    signals 可含：file_count（源文件数）、layer_span（前/后/db 跨层数）、api_count（接口数）。
    """
    matched: List[str] = []
    s = signals or {}

    # 轻量关键词优先（用户明确只要技术栈）
    flash_kw = [k for k in _FLASH_KEYWORDS if k in raw_low]
    pro_kw = [k for k in _PRO_KEYWORDS if k in raw_low]

    if flash_kw and not pro_kw:
        return MODEL_FLASH, [f"轻量关键词:{flash_kw[0]}（仅技术栈快照）"]

    if pro_kw:
        matched.append("重型关键词:" + "/".join(pro_kw[:4]))
    if s.get("file_count", 0) >= _PRO_FILES_THRESHOLD:
        matched.append(f"源文件{s['file_count']}个(多文件工程)")
    if s.get("layer_span", 0) >= 2:
        matched.append(f"跨{s['layer_span']}层(前端/后端/DB)")
    if s.get("api_count", 0) >= 3:
        matched.append(f"接口{s['api_count']}个(需全链路梳理)")

    if matched:
        return MODEL_PRO, matched
    return MODEL_FLASH, ["无重型信号 → 轻量技术栈快照（压缩输出省Token）"]


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
        reason="自动场景判定" + ("（多文件/全链路→完整解析）" if model == MODEL_PRO
                              else "（仅技术栈→轻量快照，压缩输出省Token）"),
        forced_by_slash=False, max_output_tokens=b["max_output_tokens"],
        verbosity=b["verbosity"], matched_signals=matched,
    )


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print('用法: python model_router_dispatch.py <项目目录|文件> [--input "<用户输入>"]')
        return 2
    user_input = ""
    if "--input" in argv:
        i = argv.index("--input")
        if i + 1 < len(argv):
            user_input = argv[i + 1]
    p = Path(argv[1])
    file_count = sum(1 for _ in p.rglob("*.*")) if p.is_dir() else 1
    decision = route(user_input=user_input, signals={"file_count": file_count}, raw_text=user_input)
    print(json.dumps(decision.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
