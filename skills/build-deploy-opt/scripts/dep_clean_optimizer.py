# -*- coding: utf-8 -*-
"""
build-deploy-opt / dep_clean_optimizer.py
=========================================
冗余依赖智能清理模块（能力②）

职责：
  1. 解析 package.json（dependencies / devDependencies）；
  2. 检出：开发/生产依赖混淆、重复/可合并包、已知冗余/可替换重型包、版本冲突风险；
  3. 输出可直接执行的卸载/迁移精简命令；
  4. 估算可瘦身的依赖数量。

纯标准库（json）；可 import 亦可 CLI。
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Dict

# 应归为 devDependencies 的构建期工具（若出现在 dependencies 即混淆）
_DEV_ONLY = {
    "vite", "webpack", "webpack-cli", "rollup", "esbuild", "babel-loader",
    "@babel/core", "eslint", "prettier", "typescript", "sass", "less",
    "vite-plugin-compression", "rollup-plugin-visualizer", "compression-webpack-plugin",
    "@vitejs/plugin-vue", "vue-loader", "css-loader", "style-loader", "file-loader",
    "terser-webpack-plugin", "mini-css-extract-plugin",
}

# 重型/可替换包 → 轻量建议
_HEAVY_ALTERNATIVES = {
    "moment": "改用 day.js（体积 ~2KB，API 兼容大部分）",
    "lodash": "按需引入 lodash-es 或单函数 import，避免整包",
    "jquery": "现代框架(Vue/React)下通常可移除，用原生 DOM/框架能力替代",
    "axios": "轻量需求可用原生 fetch；若保留建议按需封装",
    "core-js": "确认 targets 后由 babel 按需注入，避免全量 polyfill",
}


@dataclass
class DepReport:
    total_deps: int = 0
    total_dev_deps: int = 0
    misplaced_to_dev: List[str] = field(default_factory=list)
    heavy_suggest: List[dict] = field(default_factory=list)
    duplicate_risk: List[str] = field(default_factory=list)
    uninstall_commands: List[str] = field(default_factory=list)
    slimmable_count: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def analyze_package(pkg_text: str) -> DepReport:
    rep = DepReport()
    try:
        pkg = json.loads(pkg_text)
    except Exception as e:
        rep.duplicate_risk.append(f"package.json 解析失败: {e}")
        return rep

    deps = pkg.get("dependencies", {}) or {}
    dev = pkg.get("devDependencies", {}) or {}
    rep.total_deps = len(deps)
    rep.total_dev_deps = len(dev)

    # 1) 开发依赖被错放进 dependencies
    for name in deps:
        if name in _DEV_ONLY:
            rep.misplaced_to_dev.append(name)
            rep.uninstall_commands.append(
                f"npm uninstall {name} && npm i -D {name}   # 迁移到 devDependencies"
            )

    # 2) 重型包替换建议（按包名去重）
    seen_heavy = set()
    for name in list(deps) + list(dev):
        if name in _HEAVY_ALTERNATIVES and name not in seen_heavy:
            seen_heavy.add(name)
            rep.heavy_suggest.append({"pkg": name, "suggest": _HEAVY_ALTERNATIVES[name]})

    # 3) 重复/版本冲突风险：同名出现在 deps 与 dev
    both = set(deps) & set(dev)
    for name in both:
        rep.duplicate_risk.append(
            f"{name} 同时存在于 dependencies({deps[name]}) 与 devDependencies({dev[name]})，建议保留其一"
        )
        rep.uninstall_commands.append(f"npm uninstall {name}   # 去重后重新安装到正确位置")

    # 4) 常见可合并：同时引入 moment + dayjs / axios + fetch 封装
    if "moment" in deps and "dayjs" in deps:
        rep.duplicate_risk.append("同时引入 moment 与 dayjs，建议统一为 dayjs 并移除 moment")
        rep.uninstall_commands.append("npm uninstall moment")

    rep.slimmable_count = len(rep.misplaced_to_dev) + len(rep.heavy_suggest) + len(both)
    return rep


def analyze_file(path: str | Path) -> DepReport:
    return analyze_package(Path(path).read_text(encoding="utf-8", errors="replace"))


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python dep_clean_optimizer.py <package.json>")
        return 2
    p = Path(argv[1])
    text = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    print(json.dumps(analyze_package(text).to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
