# -*- coding: utf-8 -*-
"""
build-deploy-opt / build_config_parser.py
=========================================
Webpack/Vite 构建配置解析优化模块（能力①）

职责：
  1. 识别构建工具类型（vite / webpack / 未知）；
  2. 提取关键配置项：output/分包/缓存/tree-shaking/代码分割/懒加载/sourcemap/压缩/alias；
  3. 检出缺失或不当的优化项，输出 optimization_gaps（每项含 问题/建议配置）；
  4. 评估构建体积/性能风险等级（low/medium/high）供路由层判定。

设计原则：纯标准库、零依赖、可 import 亦可 CLI、解析永不抛出。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Dict

# ── 构建工具识别 ─────────────────────────────────────────────────────
def detect_tool(text: str) -> str:
    low = text.lower()
    if "defineconfig" in low or "vite" in low or "@vitejs" in low:
        return "vite"
    if "module.exports" in low and ("webpack" in low or "splitchunks" in low
                                    or "loader" in low or "output" in low):
        return "webpack"
    if "webpack" in low:
        return "webpack"
    return "未知"

# ── 配置项探测：key -> (正则, 人类名)──────────────────────────────────
_PRESENCE = {
    "splitChunks": (r"splitchunks", "代码分割(splitChunks)"),
    "cache": (r"\bcache\s*:", "构建缓存(cache)"),
    "treeShaking": (r"sideeffects|usedexports|treeshak", "Tree-Shaking"),
    "contenthash": (r"contenthash|chunkhash", "产物哈希(长效缓存)"),
    "compression": (r"compression|gzip|brotli", "gzip/brotli 压缩"),
    "analyzer": (r"visualizer|bundleanalyzer|rollup-plugin-visualizer", "体积分析"),
    "alias": (r"alias\s*:|resolve\.alias", "路径别名(alias)"),
    "lazyLoad": (r"import\(|lazy\(|defineasynccomponent", "懒加载/动态import"),
    "minify": (r"minify|terser|esbuild.*minify", "代码压缩(minify)"),
}

# ── 不当配置探测：会增大体积/拖慢构建 ────────────────────────────────
_BAD_PATTERNS = {
    "prodSourceMap": (r"devtool\s*:\s*['\"]source-map['\"]", "生产环境使用 source-map 会显著增大体积"),
    "singleBundle": (r"filename\s*:\s*['\"][^'\"]*bundle\.js['\"]", "单文件输出(bundle.js)无分包，首屏体积大"),
    "babelNoExclude": (r"babel-loader(?![\s\S]{0,120}exclude)", "babel-loader 未 exclude node_modules，编译慢"),
    "fileLoaderImg": (r"file-loader", "图片用 file-loader，小图未转 base64/未压缩"),
}


@dataclass
class BuildConfig:
    tool: str = "未知"
    present: Dict[str, bool] = field(default_factory=dict)
    optimization_gaps: List[dict] = field(default_factory=list)
    bad_configs: List[dict] = field(default_factory=list)
    risk_level: str = "low"
    risk_score: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


# 建议配置片段（针对缺失项给出可落地代码）
_SUGGEST = {
    "splitChunks": "optimization: { splitChunks: { chunks: 'all', cacheGroups: { vendor: { test: /[\\\\/]node_modules[\\\\/]/, name: 'vendors', priority: 10 } } } }",
    "cache": "cache: { type: 'filesystem', buildDependencies: { config: [__filename] } }  // webpack5 持久化缓存，二次构建提速",
    "treeShaking": "package.json 加 \"sideEffects\": false；并确保使用 ESM import",
    "contenthash": "filename: '[name].[contenthash:8].js'  // 长效缓存，内容不变则文件名不变",
    "compression": "Vite: import viteCompression from 'vite-plugin-compression'; plugins:[viteCompression({algorithm:'brotliCompress'})]",
    "analyzer": "Vite: import {visualizer} from 'rollup-plugin-visualizer'; plugins:[visualizer({open:true})]",
    "alias": "resolve: { alias: { '@': path.resolve(__dirname, 'src') } }  // 消除 ../../.. 深层相对路径",
    "lazyLoad": "路由用动态 import：const X = () => import('@/views/X.vue')  // 按需加载减小首屏",
    "minify": "Vite 默认 esbuild minify；Webpack 生产模式默认 TerserPlugin，确认 mode:'production'",
}


def parse_config(text: str) -> BuildConfig:
    cfg = BuildConfig()
    low = text.lower()
    cfg.tool = detect_tool(text)

    for key, (pat, _name) in _PRESENCE.items():
        cfg.present[key] = bool(re.search(pat, low))

    score = 0
    for key, present in cfg.present.items():
        if not present:
            name = _PRESENCE[key][1]
            cfg.optimization_gaps.append({
                "item": name,
                "missing": True,
                "suggest": _SUGGEST.get(key, ""),
            })
            # 关键优化项缺失权重更高
            score += 2 if key in ("splitChunks", "compression", "cache", "treeShaking") else 1

    for key, (pat, desc) in _BAD_PATTERNS.items():
        if re.search(pat, low):
            cfg.bad_configs.append({"issue": desc})
            score += 2

    cfg.risk_score = score
    cfg.risk_level = "high" if score >= 8 else ("medium" if score >= 4 else "low")
    return cfg


def parse_file(path: str | Path) -> BuildConfig:
    return parse_config(Path(path).read_text(encoding="utf-8", errors="replace"))


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python build_config_parser.py <配置文件>")
        return 2
    p = Path(argv[1])
    text = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    print(json.dumps(parse_config(text).to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
