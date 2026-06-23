# -*- coding: utf-8 -*-
"""
web-task-split / todo_iter_generator.py
=======================================
开发 Todo 清单生成 + 迭代版本周期规划（能力④⑤）+ 全流程编排入口

职责：
  1. 编排管道：parse → route → split → scope → 生成 Todo + 迭代规划；
  2. 按模块拆最小可执行开发单元，每条标注：模块/层/优先级/开发范围/验收标准；
  3. 多轮迭代里程碑划分（按优先级 P0→P1→P2 切版本，避免一次堆砌）；
  4. 依据路由模式产出不同详尽度：
       FLASH(quick) → 单层功能拆分 + 极简 Todo（压缩 Token）
       PRO(full)    → 结构化需求 + 模块分层 + 依赖图谱 + 优先级 + 多版本 + Todo + 边界约束
  5. 输出 Markdown（人读）与 JSON（机读）。这是 SKILL.md 指向的统一入口。

纯标准库；可 import 亦可 CLI 运行。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import List


def _load(name: str):
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(name, here / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # Py3.14 @dataclass 需模块已注册
    spec.loader.exec_module(mod)  # type: ignore
    return mod


rsp = _load("req_struct_parser")
router = _load("model_router_dispatch")
msa = _load("module_split_analyzer")
slc = _load("scope_limit_checker")


# ── 验收标准模板（按层给出可检验标准）────────────────────────────────
_ACCEPTANCE_TPL = {
    "前端页面": "页面可在 PC + 手机浏览器正常渲染，深色/浅色模式均适配，交互无报错。",
    "后端接口": "接口返回结构正确，4xx/5xx 有兜底，局域网(0.0.0.0:8080)可访问。",
    "模型调度": "调用本地模型成功返回结果，超时/失败有降级，不阻塞主接口。",
    "存储配置": "数据正确持久化到本地，可随 .pkb 同步包导出/恢复。",
    "工具脚本": "脚本可独立运行，幂等、可重跑，有清晰日志输出。",
    "远期规划": "仅登记需求，不在本期实现。",
}


def _make_todos(split) -> List[dict]:
    todos = []
    for i, m in enumerate(split.modules, 1):
        todos.append({
            "id": f"T{i:02d}",
            "module": m.name,
            "layer": m.layer,
            "priority": m.priority,
            "coupling": m.coupling,
            "depends_on": m.depends_on,
            "dev_scope": m.evidence[0] if m.evidence else "",
            "acceptance": _ACCEPTANCE_TPL.get(m.layer, "功能可用且通过手工验收。"),
        })
    return todos


def _make_iterations(todos: List[dict]) -> List[dict]:
    """按优先级切迭代里程碑：v_next(P0) → v+1(P1) → v+2(P2) → backlog(P3)。"""
    buckets = {"P0": [], "P1": [], "P2": [], "P3": []}
    for t in todos:
        buckets.get(t["priority"], buckets["P1"]).append(t["id"])
    plan = [
        {"milestone": "迭代1 · 核心跑通(MVP)", "scope": "P0", "tasks": buckets["P0"],
         "goal": "打通核心主流程，可演示可验收，不堆砌附加功能。"},
        {"milestone": "迭代2 · 功能完善", "scope": "P1", "tasks": buckets["P1"],
         "goal": "补齐次要功能（队列/批量/语义/同步等）。"},
        {"milestone": "迭代3 · 体验优化", "scope": "P2", "tasks": buckets["P2"],
         "goal": "深色模式/间距/适配等体验项。"},
        {"milestone": "Backlog · 远期(本期排除)", "scope": "P3", "tasks": buckets["P3"],
         "goal": "仅登记，不开发。"},
    ]
    return [p for p in plan if p["tasks"]]


def generate(raw_text: str, user_input: str = "") -> dict:
    req = rsp.parse_requirement(raw_text)
    decision = router.route(user_input=user_input,
                            complexity=req.complexity_signals, raw_text=raw_text)
    split = msa.analyze(req)
    scope = slc.check(req, split)
    todos = _make_todos(split)
    iters = _make_iterations(todos)
    return {
        "route": decision.to_dict(),
        "structured_req": req.to_dict(),
        "split": split.to_dict(),
        "scope": scope.to_dict(),
        "todos": todos,
        "iterations": iters,
    }


# ── Markdown 渲染（区分 quick / full，控 Token）───────────────────────
def render_markdown(report: dict) -> str:
    route = report["route"]
    quick = route["mode"] == "quick"
    req = report["structured_req"]
    L = []
    L.append(f"# 🧩 需求拆解 & 开发任务规划  ·  {'轻量极速' if quick else '完整项目级'}")
    L.append(f"- 路由模型：`{route['model']}`  | 模式：`{route['mode']}`"
             f"  | 强制指令：{'是' if route['forced_by_slash'] else '否'}")
    L.append(f"- 决策依据：{route['reason']}")
    L.append(f"- Token 预算：≤ {route['max_output_tokens']} tokens（{route['verbosity']}）")
    L.append(f"- 需求点：{req['complexity_signals'].get('req_points', 0)} 条"
             f"  | 跨层：{req['complexity_signals'].get('layer_span', 0)}（前/后/模型）")
    L.append("")

    if quick:
        # FLASH：单层功能拆分 + 极简 Todo
        L.append("## ⚡ 极速拆分")
        if req["business_goal"]:
            L.append(f"- **目标**：{req['business_goal'][0]}")
        L.append("### ✅ 开发 Todo")
        for t in report["todos"][:6]:
            L.append(f"- [{t['priority']}] {t['module']} — 验收：{t['acceptance']}")
        if report["scope"]["out_of_scope"]:
            L.append("### 🚧 本期不做")
            for x in report["scope"]["out_of_scope"][:3]:
                L.append(f"- {x}")
        return "\n".join(L)

    # PRO：完整规划
    L.append("## 📋 结构化需求")
    _section(L, "业务目标", req["business_goal"])
    _section(L, "用户场景", req["user_scenarios"])
    _section(L, "输入输出约束", req["io_constraints"])
    _section(L, "交互规则", req["interaction"])
    _section(L, "依赖外部服务", req["deps_external"])
    _section(L, "验收标准", req["acceptance"])

    L.append("\n## 🧱 业务模块分层拆分")
    for layer, names in report["split"]["layer_index"].items():
        L.append(f"- **{layer}**（{len(names)}）：{', '.join(names)}")

    L.append("\n## 🔗 模块依赖图谱")
    for layer, deps in report["split"]["dep_graph"].items():
        arrow = " → " + ", ".join(deps) if deps else " （无前置依赖）"
        L.append(f"- {layer}{arrow}")

    L.append("\n## 🎯 开发优先级分级")
    for prio in ["P0", "P1", "P2", "P3"]:
        names = report["split"]["priority_index"].get(prio, [])
        if names:
            tag = {"P0": "核心必做", "P1": "次要迭代", "P2": "优化体验", "P3": "远期规划"}[prio]
            L.append(f"- **{prio}（{tag}）**：{len(names)} 项")

    L.append("\n## ✅ 标准化开发 Todo 清单")
    for t in report["todos"]:
        dep = f" | 依赖: {', '.join(t['depends_on'])}" if t["depends_on"] else ""
        L.append(f"- **{t['id']} [{t['priority']}] {t['module']}**（{t['coupling']}{dep}）")
        L.append(f"  - 开发范围：{t['dev_scope']}")
        L.append(f"  - 验收标准：{t['acceptance']}")

    L.append("\n## 🗓 迭代版本周期规划")
    for it in report["iterations"]:
        L.append(f"### {it['milestone']}（{it['scope']}）")
        L.append(f"- 目标：{it['goal']}")
        L.append(f"- 任务：{', '.join(it['tasks']) or '无'}")

    L.append("\n## 🚧 功能边界 & 防过度开发")
    L.append("**本期范围（in scope）：**")
    for x in report["scope"]["in_scope"]:
        L.append(f"- {x}")
    L.append("\n**明确不做（out of scope）：**")
    for x in report["scope"]["out_of_scope"] or ["（无）"]:
        L.append(f"- {x}")
    L.append("\n**防过度开发约束：**")
    for c in report["scope"]["constraints"]:
        L.append(f"- {c}")
    L.append("\n**风险/过度开发预警：**")
    for w in report["scope"]["overbuild_warnings"]:
        L.append(f"- ⚠️ {w}")
    return "\n".join(L)


def _section(L: List[str], title: str, items: List[str]) -> None:
    if items:
        L.append(f"### {title}")
        for x in items:
            L.append(f"- {x}")


def _read_inputs(paths: List[str]) -> str:
    blobs = []
    for p in paths:
        pth = Path(p)
        if pth.exists():
            blobs.append(pth.read_text(encoding="utf-8", errors="replace"))
        else:
            blobs.append(p)
    return "\n".join(blobs)


def _main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description="web-task-split 需求拆解与任务规划生成器")
    ap.add_argument("paths", nargs="+", help="需求文件路径，或直接粘贴的需求文本")
    ap.add_argument("--input", default="", help='用户原始输入，用于识别 /task-split-full 或 /task-quick')
    ap.add_argument("--json", action="store_true", help="输出 JSON 而非 Markdown")
    args = ap.parse_args(argv[1:])

    raw = _read_inputs(args.paths)
    report = generate(raw, user_input=args.input)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(report))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
