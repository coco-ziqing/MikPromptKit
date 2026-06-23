# -*- coding: utf-8 -*-
"""
web-task-split / module_split_analyzer.py
==========================================
业务模块智能拆分 + 依赖分析 + 优先级排序（能力②③）

职责：
  1. 按 5 层切割独立模块：前端页面 / 后端接口 / 模型调度 / 存储配置 / 工具脚本；
  2. 梳理模块间依赖关系（后端依赖存储、前端依赖后端、模型依赖后端调度…）；
  3. 区分独立功能与联动耦合功能；
  4. 优先级自动分级：P0 核心必做 / P1 次要迭代 / P2 优化体验 / P3 远期规划。

纯标准库；可 import 亦可 CLI 运行。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Dict

# ── 5 层模块归类规则：layer -> 关键词 ─────────────────────────────────
_LAYER_RULES = {
    "前端页面": ["页面", "详情页", "列表页", "搜索框", "按钮", "进度条", "弹窗", "深色模式",
              "缩略图", "拖拽", "前端", "vue", "react", "ui", "交互", "显示", "配色", "手机", "平板", "点"],
    "后端接口": ["接口", "api", "后端", "异步任务", "任务队列", "队列", "重试", "服务", "端点", "路由"],
    "模型调度": ["comfyui", "ollama", "大模型", "推理", "出图", "生成图", "语义", "向量",
              "sentence-transformers", "重排", "rerank", "模型"],
    "存储配置": ["存储", "存到", "本地", "数据库", "sqlite", ".pkb", "同步包", "打包", "导出",
              "持久化", "向量库", "索引", "配置"],
    "工具脚本": ["脚本", "迁移", "校验", "批量", "工具", "巡检", "备份"],
}

# ── 依赖关系图谱（静态领域知识）──────────────────────────────────────
_DEP_GRAPH = {
    "前端页面": ["后端接口"],
    "后端接口": ["存储配置", "模型调度"],
    "模型调度": ["存储配置"],
    "存储配置": [],
    "工具脚本": ["存储配置"],
}

# ── 优先级判定信号 ────────────────────────────────────────────────────
_P0_SIGNALS = ["核心", "必做", "跑通", "一键", "主流程", "出图", "生成", "搜索"]
_P1_SIGNALS = ["队列", "批量", "重试", "进度", "语义", "同步", "导出"]
_P2_SIGNALS = ["深色模式", "配色", "间距", "体验", "优化", "美化", "适配"]
_P3_SIGNALS = ["以后", "远期", "未来", "在线api", "多账号", "付费", "额度", "拓展", "扩展"]


@dataclass
class ModuleUnit:
    name: str
    layer: str
    priority: str           # P0/P1/P2/P3
    coupling: str           # "独立" | "联动"
    depends_on: List[str] = field(default_factory=list)
    evidence: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SplitResult:
    modules: List[ModuleUnit] = field(default_factory=list)
    layer_index: Dict[str, List[str]] = field(default_factory=dict)
    dep_graph: Dict[str, List[str]] = field(default_factory=dict)
    priority_index: Dict[str, List[str]] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "modules": [m.to_dict() for m in self.modules],
            "layer_index": self.layer_index,
            "dep_graph": self.dep_graph,
            "priority_index": self.priority_index,
        }


def _layer_of(point_low: str) -> List[str]:
    layers = []
    for layer, kws in _LAYER_RULES.items():
        if any(kw in point_low for kw in kws):
            layers.append(layer)
    return layers


def _priority_of(point_low: str) -> str:
    if any(s in point_low for s in _P3_SIGNALS):
        return "P3"
    if any(s in point_low for s in _P2_SIGNALS):
        return "P2"
    if any(s in point_low for s in _P0_SIGNALS):
        return "P0"
    if any(s in point_low for s in _P1_SIGNALS):
        return "P1"
    return "P1"  # 默认次要迭代


def _short_name(point: str, layer: str) -> str:
    """从需求点压一个简短模块名。"""
    s = re.sub(r"\s+", "", point)[:18]
    return f"[{layer}] {s}"


def analyze(structured_req) -> SplitResult:
    """
    入参：req_struct_parser.StructuredReq（或其 to_dict）。
    使用 raw_points 做模块切割，避免漏点。
    """
    if hasattr(structured_req, "raw_points"):
        points = structured_req.raw_points
        oos = getattr(structured_req, "out_of_scope_hint", [])
    else:
        points = structured_req.get("raw_points", [])
        oos = structured_req.get("out_of_scope_hint", [])

    res = SplitResult(dep_graph=dict(_DEP_GRAPH))
    seen_names = set()

    # 正常需求点
    for pt in points:
        low = pt.lower()
        layers = _layer_of(low)
        if not layers:
            layers = ["后端接口"]  # 兜底归后端
        prio = _priority_of(low)
        coupling = "联动" if len(layers) > 1 else "独立"
        for layer in layers:
            name = _short_name(pt, layer)
            if name in seen_names:
                continue
            seen_names.add(name)
            mu = ModuleUnit(
                name=name, layer=layer, priority=prio,
                coupling=coupling,
                depends_on=_DEP_GRAPH.get(layer, []),
                evidence=[pt],
            )
            res.modules.append(mu)

    # 范围外提示 → 强制 P3
    for pt in oos:
        name = _short_name(pt, "远期规划")
        if name in seen_names:
            continue
        seen_names.add(name)
        res.modules.append(ModuleUnit(
            name=name, layer="工具脚本", priority="P3",
            coupling="独立", depends_on=[], evidence=[pt],
        ))

    # 建索引
    for m in res.modules:
        res.layer_index.setdefault(m.layer, []).append(m.name)
        res.priority_index.setdefault(m.priority, []).append(m.name)

    # 优先级排序：P0<P1<P2<P3
    order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    res.modules.sort(key=lambda m: (order.get(m.priority, 9), m.layer))
    return res


def _load_parser():
    import importlib.util
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("rsp", here / "req_struct_parser.py")
    rsp = importlib.util.module_from_spec(spec)
    sys.modules["rsp"] = rsp
    spec.loader.exec_module(rsp)  # type: ignore
    return rsp


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python module_split_analyzer.py <需求文件>")
        return 2
    rsp = _load_parser()
    p = Path(argv[1])
    raw = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    req = rsp.parse_requirement(raw)
    res = analyze(req)
    print(json.dumps(res.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
