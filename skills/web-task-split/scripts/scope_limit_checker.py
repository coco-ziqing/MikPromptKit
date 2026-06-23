# -*- coding: utf-8 -*-
"""
web-task-split / scope_limit_checker.py
=======================================
功能边界定义 & 防过度开发模块（能力⑥）

职责：
  1. 明确"本期实现边界"（in_scope）与"明确不做"（out_of_scope）；
  2. 识别范围蔓延 / 过度设计信号并给出告警；
  3. 输出防过度开发约束清单（约束开发只做 P0/P1，P3 显式排除）。

纯标准库；可 import 亦可 CLI 运行。
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List

# ── 过度开发 / 范围蔓延 信号 ─────────────────────────────────────────
_OVERBUILD_SIGNALS = {
    "多账号/权限体系": ["多账号", "多用户", "权限", "rbac", "登录注册"],
    "付费/计费系统": ["付费", "额度", "计费", "订阅", "支付"],
    "在线/云端依赖": ["在线api", "云端", "公网", "saas", "云服务"],
    "通用化过度抽象": ["插件化", "通用引擎", "全平台", "万能", "可扩展任意"],
    "未确定需求": ["不一定做", "可能还想", "以后再说", "也许", "远期", "未来"],
}


@dataclass
class ScopeResult:
    in_scope: List[str] = field(default_factory=list)
    out_of_scope: List[str] = field(default_factory=list)
    overbuild_warnings: List[str] = field(default_factory=list)
    constraints: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def check(structured_req, split_result=None) -> ScopeResult:
    """
    入参：
      structured_req : req_struct_parser.StructuredReq（或 dict）
      split_result   : module_split_analyzer.SplitResult（可选，用于按优先级界定边界）
    """
    res = ScopeResult()

    # 取字段（兼容对象/字典）
    def g(obj, name, default=None):
        if hasattr(obj, name):
            return getattr(obj, name)
        return (obj or {}).get(name, default if default is not None else [])

    oos_hint = g(structured_req, "out_of_scope_hint", []) or []
    raw_points = g(structured_req, "raw_points", []) or []

    # 1) out_of_scope：来自需求中"以后/不一定"描述
    res.out_of_scope.extend(oos_hint)

    # 2) 过度开发信号扫描（全文）
    blob = " ".join(raw_points + oos_hint).lower()
    for tag, kws in _OVERBUILD_SIGNALS.items():
        if any(k in blob for k in kws):
            res.overbuild_warnings.append(f"检测到「{tag}」相关描述，建议明确排除出本期，避免范围蔓延。")

    # 3) in_scope / out_of_scope 按优先级界定
    if split_result is not None:
        mods = split_result.modules if hasattr(split_result, "modules") else split_result.get("modules", [])
        for m in mods:
            name = m.name if hasattr(m, "name") else m.get("name")
            prio = m.priority if hasattr(m, "priority") else m.get("priority")
            if prio in ("P0", "P1"):
                res.in_scope.append(f"{prio} · {name}")
            elif prio == "P2":
                res.in_scope.append(f"P2(可选) · {name}")
            else:  # P3
                res.out_of_scope.append(f"P3(本期排除) · {name}")

    # 4) 防过度开发约束清单
    res.constraints = [
        "本期仅交付 P0(核心必做) + P1(次要迭代)；P2 视排期可选，P3 一律不在本期范围。",
        "禁止为未确定需求提前预留通用抽象/插件化架构（YAGNI 原则）。",
        "每个开发单元须对应明确验收标准，无验收标准的功能不进入本期。",
        "联动耦合模块须先完成被依赖方（存储/后端）再做依赖方（前端），禁止反向阻塞。",
        "范围外功能仅在文档登记，不写代码、不留半成品接口。",
    ]
    if not res.overbuild_warnings:
        res.overbuild_warnings.append("未检测到明显过度开发信号，需求边界相对清晰。")
    return res


def _load(name: str):
    import importlib.util
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(name, here / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore
    return mod


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python scope_limit_checker.py <需求文件>")
        return 2
    rsp = _load("req_struct_parser")
    msa = _load("module_split_analyzer")
    p = Path(argv[1])
    raw = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    req = rsp.parse_requirement(raw)
    split = msa.analyze(req)
    res = check(req, split)
    print(json.dumps(res.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
