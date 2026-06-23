# -*- coding: utf-8 -*-
"""
web-log-resolve / model_router_dispatch.py
===========================================
双模型分层路由模块（能力核心：控 Token）

硬编码调度规则：
  - DeepSeek V4 Pro  → 高精度重型路由（高 Token，疑难场景）
  - DeepSeek V4 Flash → 轻量化极速路由（低 Token，简单场景）

路由优先级：手动斜杠指令 > 自动场景判定（手动强制覆盖自动分流）。

本模块只做"决策"，不发起真实模型调用——返回路由决策对象，
由上层 OpenClaw 调度层据此选择模型与输出预算，从而精准管控 Token。
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field, asdict
from typing import List, Optional

# 模型常量（与本机 deepseek 双模型对齐）
MODEL_PRO = "deepseek/deepseek-v4-pro"
MODEL_FLASH = "deepseek/deepseek-v4-flash"

# 强制锁定指令 → 模型
_SLASH_LOCK = {
    "/log-resolve-full": MODEL_PRO,
    "/log-check-quick": MODEL_FLASH,
}

# ── PRO 重型触发信号（疑难/连锁/底层）──────────────────────────────────
_PRO_FAULT_TAGS = {
    "OOM显存溢出", "KV缓存超限", "权重文件损坏", "Tokenizer加载失败",
    "多卡通信故障", "推理引擎崩溃",
}
_PRO_KEYWORDS = [
    "cuda out of memory", "kv cache", "nccl", "allreduce", "safetensor",
    "vllm", "deserializing header", "量化", "quantization", "多卡", "分布式",
    "transformers", "tokenizer",
]

# ── FLASH 轻型触发信号（语法/简单 4xx-5xx/单条）────────────────────────
_FLASH_FAULT_TAGS = {
    "JS运行时报错", "JSON解析失败", "接口404", "参数校验失败", "资源加载失败",
}

# 输出预算（Token 上限建议，交给上层裁剪输出）
_BUDGET = {
    MODEL_PRO: {"max_output_tokens": 2200, "verbosity": "full"},
    MODEL_FLASH: {"max_output_tokens": 450, "verbosity": "compact"},
}


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
    low = text.strip().lower()
    for cmd in _SLASH_LOCK:
        if low.startswith(cmd) or f" {cmd}" in f" {low}":
            return cmd
    return None


def _auto_score(records: List["object"], blob_low: str) -> tuple[str, List[str]]:
    """
    根据已解析记录 + 原始文本，自动判定 PRO / FLASH。
    返回 (model, matched_signals)。
    判定逻辑：命中任一 PRO 信号 → PRO；否则若全为轻量信号 → FLASH；
    多模块连锁(>=2 模块出现 ERROR/PANIC) → PRO。
    """
    matched: List[str] = []

    # 1) 故障标签信号
    tags = set()
    err_modules = set()
    for r in records:
        tags.update(getattr(r, "fault_tags", []) or [])
        if getattr(r, "level", "") in ("ERROR", "PANIC"):
            err_modules.add(getattr(r, "module", "未知"))

    pro_tag_hit = tags & _PRO_FAULT_TAGS
    if pro_tag_hit:
        matched += [f"重型故障标签:{t}" for t in pro_tag_hit]

    # 2) 关键词信号
    kw_hit = [k for k in _PRO_KEYWORDS if k in blob_low]
    if kw_hit:
        matched += [f"重型关键词:{k}" for k in kw_hit[:4]]

    # 3) 跨模块连锁
    chain = len(err_modules) >= 2
    if chain:
        matched.append(f"跨模块连锁故障:{'/'.join(sorted(err_modules))}")

    if pro_tag_hit or kw_hit or chain:
        return MODEL_PRO, matched

    # 否则轻量
    flash_tags = tags & _FLASH_FAULT_TAGS
    matched += [f"轻量故障标签:{t}" for t in flash_tags] or ["无重型信号，默认轻量巡检"]
    return MODEL_FLASH, matched


def route(user_input: str = "", records: Optional[List["object"]] = None,
          raw_text: str = "") -> RouteDecision:
    """
    主路由入口。
      user_input : 用户原始输入（用于识别斜杠强制指令）
      records    : log_struct_parser.parse_logs(...) 的结果（可选）
      raw_text   : 原始日志文本（用于关键词兜底）
    """
    records = records or []
    blob_low = (raw_text or "\n".join(getattr(r, "raw", "") for r in records)).lower()

    # ① 手动斜杠最高优先级
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

    # ② 自动场景判定
    model, matched = _auto_score(records, blob_low)
    b = _BUDGET[model]
    return RouteDecision(
        model=model,
        mode="full" if model == MODEL_PRO else "quick",
        reason="自动场景判定" + ("（疑难/连锁→重型）" if model == MODEL_PRO else "（简单→轻量，压缩输出省Token）"),
        forced_by_slash=False,
        max_output_tokens=b["max_output_tokens"],
        verbosity=b["verbosity"],
        matched_signals=matched,
    )


def _main(argv: List[str]) -> int:
    # CLI：python model_router_dispatch.py <日志文件> [--input "/log-resolve-full ..."]
    if len(argv) < 2:
        print('用法: python model_router_dispatch.py <日志文件> [--input "<用户输入>"]')
        return 2
    user_input = ""
    if "--input" in argv:
        i = argv.index("--input")
        if i + 1 < len(argv):
            user_input = argv[i + 1]

    # 复用解析器
    import importlib.util
    from pathlib import Path
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("lsp", here / "log_struct_parser.py")
    lsp = importlib.util.module_from_spec(spec)
    sys.modules["lsp"] = lsp  # Py3.14 @dataclass 需模块已注册
    spec.loader.exec_module(lsp)  # type: ignore

    raw = Path(argv[1]).read_text(encoding="utf-8", errors="replace")
    recs = lsp.parse_logs(raw, drop_noise=True)
    decision = route(user_input=user_input, records=recs, raw_text=raw)
    print(json.dumps(decision.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:  # Windows 控制台默认 GBK，强制 UTF-8 输出
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
