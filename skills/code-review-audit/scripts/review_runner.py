# -*- coding: utf-8 -*-
"""
code-review-audit / review_runner.py
====================================
统一编排入口（与 6 技能矩阵入口同构）：audit → route → render。

  full(PRO)   → 6 维度逐条 findings + 修复码 + 严重级汇总 + 评审结论
  quick(FLASH)→ 仅高危/规范要点 + 极简修复（压缩 Token）

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


auditor = _load("review_auditor")
router = _load("model_router_dispatch")


def generate(code_text: str, user_input: str = "") -> dict:
    rep = auditor.audit(code_text)
    signals = {
        "high_severity": rep.high_severity,
        "code_lines": rep.code_lines,
        "is_diff": rep.is_diff,
    }
    decision = router.route(user_input=user_input, signals=signals, raw_text=user_input)
    return {"route": decision.to_dict(), "audit": rep.to_dict()}


def render_markdown(report: dict) -> str:
    route = report["route"]
    a = report["audit"]
    quick = route["mode"] == "quick"
    L = []
    L.append(f"# 🔎 标准化代码审查报告  ·  {'轻量规范检查' if quick else '全维度深度审计'}")
    L.append(f"- 路由模型：`{route['model']}`  | 模式：`{route['mode']}`"
             f"  | 强制指令：{'是' if route['forced_by_slash'] else '否'}")
    L.append(f"- 决策依据：{route['reason']}")
    L.append(f"- Token 预算：≤ {route['max_output_tokens']} tokens（{route['verbosity']}）")
    L.append(f"- 代码行数：{a['code_lines']}  | 问题总数：{len(a['findings'])}"
             f"  | 高危：{a['high_severity']}")
    L.append(f"- 维度分布：{a['by_dimension'] or '无'}")
    L.append("")

    if quick:
        L.append("## ⚡ 关键问题（高危优先）")
        shown = [f for f in a["findings"] if f["severity"] == "high"][:4] or a["findings"][:4]
        for f in shown:
            L.append(f"- [{f['severity']}] L{f['line']} {f['dimension']}：{f['issue']} → {f['fix']}")
        if not a["findings"]:
            L.append("- 未命中已知规则，规范层面基本通过。")
        return "\n".join(L)

    L.append("## 🧫 六维度评审结果")
    for dim in ["安全", "逻辑", "性能", "可维护性", "语法规范", "边界异常"]:
        items = [f for f in a["findings"] if f["dimension"] == dim]
        if not items:
            continue
        L.append(f"\n### 维度 · {dim}（{len(items)}）")
        for f in items:
            L.append(f"- **[{f['severity']}] 第 {f['line']} 行**：{f['issue']}")
            L.append(f"  - 代码：`{f['snippet']}`")
            L.append(f"  - 修复：{f['fix']}")

    L.append("\n## 📌 评审结论")
    if a["high_severity"] > 0:
        L.append(f"- ⛔ 存在 {a['high_severity']} 处**高危问题（安全/逻辑）**，建议修复后再合并。")
    elif a["findings"]:
        L.append("- ⚠️ 无高危，但有规范/可维护性改进项，建议一并处理。")
    else:
        L.append("- ✅ 未发现明显问题，通过评审。")
    L.append("- 建议：高危必改 → 性能/逻辑评估 → 规范项批量整改。")
    return "\n".join(L)


def _read(p: str) -> str:
    pth = Path(p)
    return pth.read_text(encoding="utf-8", errors="replace") if pth.exists() else p


def _main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description="code-review-audit 标准化代码审查")
    ap.add_argument("path", help="代码文件 / diff 文件，或直接粘贴的代码文本")
    ap.add_argument("--input", default="", help='用户输入，识别 /code-review-full 或 /code-review-quick')
    ap.add_argument("--json", action="store_true", help="输出 JSON 而非 Markdown")
    args = ap.parse_args(argv[1:])
    report = generate(_read(args.path), user_input=args.input)
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
