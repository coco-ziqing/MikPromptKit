# -*- coding: utf-8 -*-
"""
code-project-analyze / project_analyze_runner.py
================================================
统一编排入口（与 6 技能矩阵入口同构）：scan → route → render。

  full(PRO)   → 技术栈 + 目录分层 + 接口流转 + 业务链路 + 架构梳理
  quick(FLASH)→ 仅技术栈快照（语言/框架/构建工具/依赖数）

纯标准库；可 import 亦可 CLI。
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


scanner = _load("stack_scanner")
router = _load("model_router_dispatch")


def generate(root: str, user_input: str = "") -> dict:
    res = scanner.scan(root)
    signals = {
        "file_count": res.file_count,
        "layer_span": res.layer_span,
        "api_count": len(res.api_endpoints),
    }
    decision = router.route(user_input=user_input, signals=signals, raw_text=user_input)
    return {"route": decision.to_dict(), "scan": res.to_dict()}


def render_markdown(report: dict) -> str:
    route = report["route"]
    s = report["scan"]
    quick = route["mode"] == "quick"
    L = []
    L.append(f"# 🔍 源码工程结构化解析  ·  {'轻量技术栈快照' if quick else '完整全链路解析'}")
    L.append(f"- 路由模型：`{route['model']}`  | 模式：`{route['mode']}`"
             f"  | 强制指令：{'是' if route['forced_by_slash'] else '否'}")
    L.append(f"- 决策依据：{route['reason']}")
    L.append(f"- Token 预算：≤ {route['max_output_tokens']} tokens（{route['verbosity']}）")
    L.append(f"- 扫描文件数：{s['file_count']}  | 跨层：{s['layer_span']}（前/后/DB）")
    L.append("")

    # 技术栈（两档都给）
    L.append("## 🧱 技术栈识别")
    L.append(f"- 语言：{', '.join(s['languages']) or '未识别'}")
    L.append(f"- 框架：{', '.join(s['frameworks']) or '未识别'}")
    L.append(f"- 构建工具：{', '.join(s['build_tools']) or '未识别'}")
    L.append(f"- 依赖数：{len(s['dependencies'])}")
    if quick:
        deps = list(s["dependencies"].keys())[:10]
        if deps:
            L.append(f"- 主要依赖：{', '.join(deps)}")
        return "\n".join(L)

    # FULL：目录分层 + 接口 + 链路
    L.append("\n## 🗂 目录分层拆解")
    for layer, files in s["layers"].items():
        L.append(f"- **{layer}**（{len(files)}）：{', '.join(files[:6])}{' …' if len(files) > 6 else ''}")

    L.append("\n## 🔗 接口流转（HTTP API）")
    if s["api_endpoints"]:
        for ep in s["api_endpoints"]:
            L.append(f"- `{ep}`")
    else:
        L.append("- 未抓取到显式 API 路由")

    L.append("\n## 🧭 业务链路梳理")
    fe = "前端" in s["layers"]
    be = "后端" in s["layers"]
    if fe and be:
        L.append("- 前端(页面/组件) → API 客户端 → 后端路由 → 服务/模型 → 数据库")
        L.append("- 建议核对：前端 API 客户端路径与后端路由表是否一一对应")
    elif be:
        L.append("- 纯后端服务：路由 → 业务逻辑 → 数据层")
    elif fe:
        L.append("- 纯前端：路由 → 组件 → 状态管理 → API 调用")
    else:
        L.append("- 层次信息不足，建议提供更完整目录")

    L.append("\n## 📦 完整依赖清单")
    for k, v in list(s["dependencies"].items())[:30]:
        L.append(f"- {k}: {v}")
    return "\n".join(L)


def _main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description="code-project-analyze 工程结构化解析")
    ap.add_argument("root", help="项目目录路径")
    ap.add_argument("--input", default="", help='用户输入，识别 /analyze-code 或 /code-stack-only')
    ap.add_argument("--json", action="store_true", help="输出 JSON 而非 Markdown")
    args = ap.parse_args(argv[1:])
    report = generate(args.root, user_input=args.input)
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
