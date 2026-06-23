# -*- coding: utf-8 -*-
"""
build-deploy-opt / model_router_dispatch.py
===========================================
双模型分层路由模块（控 Token 核心）

  - DeepSeek V4 Pro  → 复杂构建部署（崩溃报错/深度瘦身/多环境/配置重构/性能调优）
  - DeepSeek V4 Flash → 简单校验（单命令/语法检查/小压缩建议/快速冗余筛查）

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
    "/build-opt-full": MODEL_PRO,
    "/build-check-quick": MODEL_FLASH,
}

# PRO 重型关键词
_PRO_KEYWORDS = [
    "heap out of memory", "reached heap limit", "build failed", "fatal error",
    "cannot find module", "failed to resolve", "rollup failed", "崩溃", "深度瘦身",
    "多环境", "重构", "splitchunks", "分包", "性能", "卡顿", "nginx", "部署", "镜像",
    "docker", "权限", "transform failed",
]

_BUDGET = {
    MODEL_PRO: {"max_output_tokens": 2600, "verbosity": "full"},
    MODEL_FLASH: {"max_output_tokens": 500, "verbosity": "compact"},
}


@dataclass
class RouteDecision:
    model: str
    mode: str
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
    signals 可包含：
      error_count   构建报错条数
      risk_level    配置风险等级 low/medium/high
      env_conflicts 环境冲突条数
    """
    matched: List[str] = []
    s = signals or {}

    if s.get("error_count", 0) >= 2:
        matched.append(f"构建报错{s['error_count']}条(多层故障)")
    if s.get("risk_level") == "high":
        matched.append("配置风险=high(需深度瘦身)")
    if s.get("env_conflicts", 0) >= 2:
        matched.append(f"多环境冲突{s['env_conflicts']}处")

    kw = [k for k in _PRO_KEYWORDS if k in raw_low]
    if kw:
        matched.append("重型关键词:" + "/".join(kw[:5]))

    if matched:
        return MODEL_PRO, matched
    return MODEL_FLASH, ["无重型信号 → 轻量配置校验（压缩输出省Token）"]


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
        reason="自动场景判定" + ("（复杂构建/部署→重型深度优化）" if model == MODEL_PRO
                              else "（简单校验→轻量，压缩输出省Token）"),
        forced_by_slash=False, max_output_tokens=b["max_output_tokens"],
        verbosity=b["verbosity"], matched_signals=matched,
    )


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print('用法: python model_router_dispatch.py <文件> [--input "<用户输入>"]')
        return 2
    user_input = ""
    if "--input" in argv:
        i = argv.index("--input")
        if i + 1 < len(argv):
            user_input = argv[i + 1]
    p = Path(argv[1])
    raw = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    # 简单信号：统计 error 行
    err = sum(1 for ln in raw.lower().splitlines() if "error" in ln or "failed" in ln)
    decision = route(user_input=user_input, signals={"error_count": err}, raw_text=raw)
    print(json.dumps(decision.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
