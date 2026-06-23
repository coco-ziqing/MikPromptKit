# -*- coding: utf-8 -*-
"""
build-deploy-opt / build_error_fixer.py
=======================================
构建报错自动修复模块（能力③）

解析终端构建报错日志，定位：语法错误、插件/模块缺失、资源路径异常、
版本兼容冲突、内存溢出等，给出可替换修复代码/命令。

内置构建故障规则库 BUILD_FAULTS；纯标准库；可 import 亦可 CLI。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List

# ── 构建故障规则库：tag -> 匹配关键词 + 三层定位 + 修复 ───────────────
BUILD_FAULTS = {
    "语法错误": {
        "kw": ["transform failed", "expected", "unexpected token", "syntaxerror", "parse error"],
        "symptom": "esbuild/babel 转译失败，提示 Expected/Unexpected token。",
        "cause": "源码语法错误（如缺分号、函数声明不完整、JSX/Vue 模板语法错）。",
        "fix": "按报错文件:行号定位修复语法；示例：`async function loadList() {` 缺少函数体大括号需补全。",
    },
    "模块缺失": {
        "kw": ["cannot find module", "module not found", "cannot resolve"],
        "symptom": "Cannot find module 'xxx' / Module not found。",
        "cause": "依赖未安装，或插件包未在 package.json 声明。",
        "fix": "安装缺失包：`npm i -D <module>`（如 `npm i -D rollup-plugin-visualizer`）；或移除 config 中对该插件的引用。",
    },
    "路径解析失败": {
        "kw": ["failed to resolve import", "rollup failed to resolve", "can't resolve"],
        "symptom": "Rollup/Webpack 无法解析 import 路径（如 '@/utils/request'）。",
        "cause": "缺少 alias 别名配置，或文件路径/大小写错误。",
        "fix": "配置 alias：Vite `resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}}`；核对文件真实存在。",
    },
    "版本兼容冲突": {
        "kw": ["peer dep", "version mismatch", "engine", "unsupported engine", "requires"],
        "symptom": "peerDependencies / engine 版本不匹配告警或报错。",
        "cause": "依赖版本与 node/构建工具版本不兼容。",
        "fix": "对齐版本矩阵：升/降级冲突包；`npm ls <pkg>` 查看依赖树；必要时 `overrides` 锁版本。",
    },
    "内存溢出": {
        "kw": ["heap out of memory", "reached heap limit", "allocation failed"],
        "symptom": "JavaScript heap out of memory，构建进程崩溃。",
        "cause": "项目大/source-map 全量生成/无分包，构建峰值内存超 Node 默认上限(~2GB)。",
        "fix": "临时：`set NODE_OPTIONS=--max-old-space-size=4096 && npm run build`(Win)；根治：开启分包+关生产 source-map+持久化缓存。",
    },
    "插件配置错误": {
        "kw": ["is not a function", "invalid options", "invalid plugin", "plugin error"],
        "symptom": "插件初始化报错 / 配置项非法。",
        "cause": "插件 API 用法或版本不匹配，或配置项拼写错误。",
        "fix": "核对插件文档与版本；按 README 修正插件初始化参数。",
    },
}

_FILE_LINE = re.compile(r"([\w./\\@-]+\.(?:vue|js|ts|jsx|tsx|css)):(\d+)(?::(\d+))?")


@dataclass
class FixItem:
    tag: str
    symptom: str
    cause: str
    fix: str
    locations: List[str] = field(default_factory=list)


@dataclass
class FixReport:
    tool_hint: str
    fixes: List[FixItem] = field(default_factory=list)
    matched_tags: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def analyze_log(text: str) -> FixReport:
    low = text.lower()
    tool = "vite" if "vite" in low else ("webpack" if "webpack" in low else "未知")
    rep = FixReport(tool_hint=tool)
    locs = [f"{m.group(1)}:{m.group(2)}" for m in _FILE_LINE.finditer(text)]

    for tag, rule in BUILD_FAULTS.items():
        if any(k in low for k in rule["kw"]):
            rep.matched_tags.append(tag)
            rep.fixes.append(FixItem(
                tag=tag, symptom=rule["symptom"], cause=rule["cause"], fix=rule["fix"],
                locations=locs[:5] if tag in ("语法错误", "路径解析失败") else [],
            ))
    if not rep.fixes:
        rep.fixes.append(FixItem(
            tag="未识别", symptom="未命中已知构建故障规则。",
            cause="日志信息不足或为新型报错。",
            fix="建议 /build-opt-full 走 PRO 深度分析，或提供更完整构建日志。",
        ))
    return rep


def analyze_file(path: str | Path) -> FixReport:
    return analyze_log(Path(path).read_text(encoding="utf-8", errors="replace"))


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python build_error_fixer.py <构建日志>")
        return 2
    p = Path(argv[1])
    text = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    rep = analyze_log(text)
    print(json.dumps(rep.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
