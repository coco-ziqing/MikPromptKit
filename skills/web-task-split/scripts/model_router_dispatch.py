# -*- coding: utf-8 -*-
"""
web-task-split / model_router_dispatch.py
=========================================
双模型分层路由模块（控 Token 核心）

硬编码调度规则：
  - DeepSeek V4 Pro  → 高精度重型路由（大型复合/多模块联动/多版本排期/多人协作/边界模糊）
  - DeepSeek V4 Flash → 轻量化极速路由（单点功能/小型优化/短需求）

路由优先级：手动斜杠指令 > 自动场景判定（手动强制覆盖）。

只做"决策"，不发起真实模型调用——返回 RouteDecision，由上层 OpenClaw
调度层据此选择模型与输出预算，精准管控 Token。
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
    "/task-split-full": MODEL_PRO,
    "/task-quick": MODEL_FLASH,
}

# PRO 重型关键词（复合/联动/排期/协作/重构/推理改造/边界模糊）
_PRO_KEYWORDS = [
    "大版本", "大型", "复合", "多模块", "联动", "重构", "跨前后端", "异步任务",
    "队列", "语义搜索", "向量", "多人", "协作", "分工", "多版本", "分版本",
    "多轮", "里程碑", "排期", "推理服务", "comfyui", "ollama", "工作流",
]

_BUDGET = {
    MODEL_PRO: {"max_output_tokens": 2600, "verbosity": "full"},
    MODEL_FLASH: {"max_output_tokens": 500, "verbosity": "compact"},
}

# 自动判定阈值
_PRO_POINTS_THRESHOLD = 5      # 需求点 >= 5 倾向重型
_PRO_LAYER_THRESHOLD = 2       # 前/后/模型 跨 >=2 层倾向重型


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


def _auto_score(complexity: dict, raw_text_low: str) -> tuple[str, List[str]]:
    """根据复杂度信号 + 原始文本判定 PRO / FLASH。"""
    matched: List[str] = []
    c = complexity or {}

    if c.get("multi_version"):
        matched.append("多版本/迭代排期")
    if c.get("multi_people"):
        matched.append("多人协作分工")
    if c.get("vague_boundary"):
        matched.append("需求边界模糊需深度梳理")
    if c.get("layer_span", 0) >= _PRO_LAYER_THRESHOLD:
        matched.append(f"跨{c.get('layer_span')}层联动(前/后/模型)")
    if c.get("req_points", 0) >= _PRO_POINTS_THRESHOLD:
        matched.append(f"需求点{c.get('req_points')}条(复合需求)")
    if c.get("mentions_model"):
        matched.append("含模型/推理服务改造")

    kw_hit = [k for k in _PRO_KEYWORDS if k in raw_text_low]
    if kw_hit:
        matched.append("重型关键词:" + "/".join(kw_hit[:5]))

    if matched:
        return MODEL_PRO, matched
    return MODEL_FLASH, ["无重型信号，单点/小型需求 → 轻量极速拆分（压缩输出省Token）"]


def route(user_input: str = "", complexity: Optional[dict] = None,
          raw_text: str = "") -> RouteDecision:
    """
    主路由入口。
      user_input : 用户原始输入（识别斜杠强制指令）
      complexity : req_struct_parser 输出的 complexity_signals（可选）
      raw_text   : 原始需求文本（关键词兜底）
    """
    blob_low = (raw_text or "").lower()

    slash = _slash_in(user_input)
    if slash:
        model = _SLASH_LOCK[slash]
        b = _BUDGET[model]
        return RouteDecision(
            model=model,
            mode="full" if model == MODEL_PRO else "quick",
            reason=f"手动指令 {slash} 强制锁定（覆盖自动分流）",
            forced_by_slash=True,
            max_output_tokens=b["max_output_tokens"],
            verbosity=b["verbosity"],
            matched_signals=[f"slash:{slash}"],
        )

    model, matched = _auto_score(complexity or {}, blob_low)
    b = _BUDGET[model]
    return RouteDecision(
        model=model,
        mode="full" if model == MODEL_PRO else "quick",
        reason="自动场景判定" + ("（大型复合/联动→重型深度规划）" if model == MODEL_PRO
                              else "（单点/小型→轻量拆分，压缩输出省Token）"),
        forced_by_slash=False,
        max_output_tokens=b["max_output_tokens"],
        verbosity=b["verbosity"],
        matched_signals=matched,
    )


def _load_parser():
    import importlib.util
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("rsp", here / "req_struct_parser.py")
    rsp = importlib.util.module_from_spec(spec)
    sys.modules["rsp"] = rsp  # Py3.14 @dataclass 需模块已注册
    spec.loader.exec_module(rsp)  # type: ignore
    return rsp


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print('用法: python model_router_dispatch.py <需求文件> [--input "<用户输入>"]')
        return 2
    user_input = ""
    if "--input" in argv:
        i = argv.index("--input")
        if i + 1 < len(argv):
            user_input = argv[i + 1]

    rsp = _load_parser()
    p = Path(argv[1])
    raw = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    req = rsp.parse_requirement(raw)
    decision = route(user_input=user_input, complexity=req.complexity_signals, raw_text=raw)
    print(json.dumps(decision.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
