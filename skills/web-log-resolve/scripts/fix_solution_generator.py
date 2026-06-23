# -*- coding: utf-8 -*-
"""
web-log-resolve / fix_solution_generator.py
===========================================
修复方案生成 + 批量同类Bug聚合（能力③⑤ + 全流程编排）

职责：
  1. 编排管道：parse → route → analyze → 生成修复方案；
  2. 批量多日志导入，聚合同源重复故障（按 primary_tag 归并）；
  3. 依据路由模式产出不同详尽度：
       FLASH(quick) → 单层核心根因 + 极简修复步骤（压缩 Token）
       PRO(full)    → 完整元数据 + 三层根因 + 临时修复 + 全局根治 + 四层防复发
  4. 输出 Markdown 报告（人读）与 JSON（机读）。

纯标准库；可 import 亦可 CLI 运行。这是 SKILL.md 指向的统一入口。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import List


# ── 动态加载同目录兄弟模块（避免包结构依赖）──────────────────────────
def _load(name: str):
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(name, here / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    # 关键：先注册到 sys.modules，否则 Py3.14 @dataclass 处理时
    # cls.__module__ 找不到模块导致 AttributeError。
    sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore
    return mod


lsp = _load("log_struct_parser")
router = _load("model_router_dispatch")
rca = _load("root_cause_analyzer")


def _aggregate(records: List["object"]) -> dict:
    """按 fault_tag 聚合同类故障，统计出现次数与代表样本。"""
    groups: dict = {}
    for r in records:
        for t in (getattr(r, "fault_tags", []) or []):
            g = groups.setdefault(t, {"count": 0, "samples": [], "modules": set()})
            g["count"] += 1
            g["modules"].add(getattr(r, "module", "未知"))
            sample = (getattr(r, "message", "") or getattr(r, "raw", ""))[:140]
            if sample and len(g["samples"]) < 3:
                g["samples"].append(sample)
    for g in groups.values():
        g["modules"] = sorted(g["modules"])
    return groups


def generate(raw_text: str, user_input: str = "") -> dict:
    """主入口：返回结构化报告字典。"""
    records = lsp.parse_logs(raw_text, drop_noise=True)
    decision = router.route(user_input=user_input, records=records, raw_text=raw_text)
    analysis = rca.analyze(records)
    groups = _aggregate(records)

    # 修复方案：从故障库取，主根因优先
    fixes = []
    ordered_tags = ([analysis.primary_tag] if analysis.primary_tag else []) + \
                   [t for t in analysis.all_tags if t != analysis.primary_tag]
    for t in ordered_tags:
        lib = rca.FAULT_LIBRARY.get(t)
        if not lib:
            continue
        fixes.append({
            "tag": t,
            "count": groups.get(t, {}).get("count", 1),
            "modules": groups.get(t, {}).get("modules", []),
            "quick_fix": lib["quick_fix"],
            "global_fix": lib["global_fix"],
            "prevent": lib["prevent"],
        })

    return {
        "route": decision.to_dict(),
        "summary": {
            "total_records": len(records),
            "fault_groups": {k: v["count"] for k, v in groups.items()},
            "primary_tag": analysis.primary_tag,
            "chain_note": analysis.chain_note,
        },
        "analysis": analysis.to_dict(),
        "fixes": fixes,
        "records": [r.to_dict() for r in records],
    }


# ── Markdown 渲染（区分 quick / full 详尽度，控 Token）─────────────────
def render_markdown(report: dict) -> str:
    route = report["route"]
    smry = report["summary"]
    quick = route["mode"] == "quick"
    L = []
    L.append(f"# 🩺 报错日志解析报告  ·  {'轻量极速' if quick else '深度全链路'}")
    L.append(f"- 路由模型：`{route['model']}`  | 模式：`{route['mode']}`"
             f"  | 强制指令：{'是' if route['forced_by_slash'] else '否'}")
    L.append(f"- 决策依据：{route['reason']}")
    L.append(f"- Token 预算：≤ {route['max_output_tokens']} tokens（{route['verbosity']}）")
    L.append(f"- 日志记录数：{smry['total_records']}  | 故障分组：{smry['fault_groups'] or '无'}")
    if smry.get("primary_tag"):
        L.append(f"- **主根因：`{smry['primary_tag']}`**")
    if smry.get("chain_note"):
        L.append(f"- 连锁分析：{smry['chain_note']}")
    L.append("")

    if quick:
        # FLASH：单层核心根因 + 极简修复，严格压缩
        L.append("## ⚡ 极速修复")
        for f in report["fixes"][:3]:
            L.append(f"- **{f['tag']}**（x{f['count']}）→ {f['quick_fix']}")
        if not report["fixes"]:
            L.append("- 未命中已知规则，建议 `/log-resolve-full` 深度分析。")
        return "\n".join(L)

    # PRO：三层根因 + 临时/全局/防复发四层
    L.append("## 🔬 三层根因拆解")
    for layer in report["analysis"]["layers"]:
        L.append(f"### {layer['tag']}")
        L.append(f"- 表层(symptom)：{layer['symptom']}")
        L.append(f"- 中层(code/param/comm)：{layer['mid']}")
        L.append(f"- 底层(root)：{layer['root']}")
        if layer.get("evidence"):
            L.append(f"- 证据：`{layer['evidence'][0]}`")
        L.append("")

    L.append("## 🛠 分层修复方案")
    for f in report["fixes"]:
        L.append(f"### {f['tag']}  （命中 {f['count']} 次 / 模块: {', '.join(f['modules']) or 'N/A'}）")
        L.append(f"1. 临时快速修复：{f['quick_fix']}")
        L.append(f"2. 项目全局根治：{f['global_fix']}")
        L.append(f"3. 长效防复发：{f['prevent']}")
        L.append("")

    L.append("## 🧱 四层防复发（代码/配置/运维/工程）")
    L.append("- **代码层**：关键路径异常捕获 + 入参 schema 校验 + 空值兜底。")
    L.append("- **配置层**：资源阈值限流（显存/连接/并发）+ 超时与重试。")
    L.append("- **运维层**：线上日志告警监控 + 进程守护自动重启 + 健康探针。")
    L.append("- **工程层**：版本矩阵锁定 + 契约/兼容性自检纳入 CI + 部署后巡检。")
    return "\n".join(L)


def _read_inputs(paths: List[str]) -> str:
    """支持多文件批量导入：拼接为一段文本做统一聚合。"""
    blobs = []
    for p in paths:
        pth = Path(p)
        if pth.exists():
            blobs.append(f"# ===== {pth.name} =====\n" +
                         pth.read_text(encoding="utf-8", errors="replace"))
        else:
            blobs.append(p)  # 当作直接粘贴的日志文本
    return "\n".join(blobs)


def _main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description="web-log-resolve 修复方案生成器")
    ap.add_argument("paths", nargs="+", help="一个或多个日志文件路径（支持批量），或直接粘贴的日志文本")
    ap.add_argument("--input", default="", help='用户原始输入，用于识别 /log-resolve-full 或 /log-check-quick')
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
    try:  # Windows 控制台默认 GBK，强制 UTF-8 输出避免 emoji/中文编码错误
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
