# -*- coding: utf-8 -*-
"""
build-deploy-opt / asset_compress_opt.py
========================================
静态资源压缩处理模块（能力④）

职责：
  1. 基于构建配置/资源线索，输出图片/字体/js/css 压缩策略；
  2. 给出 gzip / brotli 压缩配置代码；
  3. 资源 CDN 路径改造建议、大文件分片打包方案；
  4. 小图 base64 内联阈值建议。

纯标准库；可 import 亦可 CLI。本模块以"策略生成"为主（无需真实压缩文件）。
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List

# ── 压缩策略库（按资源类型）──────────────────────────────────────────
_STRATEGY = {
    "image": {
        "title": "图片压缩",
        "actions": [
            "小图(<8KB)转 base64 内联，减少 HTTP 请求：Vite `build.assetsInlineLimit: 8192`",
            "大图改 WebP/AVIF；构建期用 vite-plugin-imagemin / image-webpack-loader 有损压缩",
            "雪碧图/字体图标合并，按需子集化图标字体",
        ],
    },
    "font": {
        "title": "字体优化",
        "actions": [
            "字体子集化(只保留用到的字形)，woff2 优先",
            "font-display: swap 避免阻塞渲染",
        ],
    },
    "js_css": {
        "title": "JS/CSS 压缩",
        "actions": [
            "生产关闭 source-map 或用 'hidden-source-map'，显著减小产物",
            "CSS 提取并 minify：mini-css-extract-plugin + cssnano",
            "JS 由 esbuild/terser minify；开启 tree-shaking 去除未用代码",
        ],
    },
}

# gzip / brotli 配置代码片段
_COMPRESSION_SNIPPETS = {
    "vite": (
        "// vite.config.js\n"
        "import viteCompression from 'vite-plugin-compression';\n"
        "export default defineConfig({\n"
        "  plugins: [\n"
        "    viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 10240 }),\n"
        "    viteCompression({ algorithm: 'brotliCompress', ext: '.br', threshold: 10240 }),\n"
        "  ],\n"
        "});"
    ),
    "webpack": (
        "// webpack.config.js\n"
        "const CompressionPlugin = require('compression-webpack-plugin');\n"
        "module.exports = {\n"
        "  plugins: [\n"
        "    new CompressionPlugin({ algorithm: 'gzip', test: /\\.(js|css|html|svg)$/, threshold: 10240 }),\n"
        "    new CompressionPlugin({ algorithm: 'brotliCompress', filename: '[path][base].br', threshold: 10240 }),\n"
        "  ],\n"
        "};"
    ),
}

# Nginx 启用压缩（配合预压缩文件）
_NGINX_COMPRESS = (
    "# nginx 启用 gzip/brotli（配合预压缩 .gz/.br 静态文件）\n"
    "gzip on;\n"
    "gzip_static on;            # 直接发送预压缩 .gz\n"
    "gzip_types text/css application/javascript application/json image/svg+xml;\n"
    "gzip_min_length 1024;\n"
    "# brotli on; brotli_static on; brotli_types ...;   # 需 ngx_brotli 模块"
)


@dataclass
class CompressPlan:
    tool: str = "vite"
    strategies: List[dict] = field(default_factory=list)
    compression_code: str = ""
    nginx_compress: str = ""
    cdn_advice: List[str] = field(default_factory=list)
    big_file_advice: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def build_plan(tool: str = "vite", has_big_assets: bool = True) -> CompressPlan:
    tool = tool if tool in ("vite", "webpack") else "vite"
    plan = CompressPlan(tool=tool)
    for v in _STRATEGY.values():
        plan.strategies.append({"title": v["title"], "actions": v["actions"]})
    plan.compression_code = _COMPRESSION_SNIPPETS[tool]
    plan.nginx_compress = _NGINX_COMPRESS
    plan.cdn_advice = [
        "静态资源(js/css/img)上传 CDN，构建配置 base/publicPath 指向 CDN 域名",
        "Vite: `base: 'https://cdn.example.com/promptkit/'`；Webpack: `output.publicPath`",
        "局域网无 CDN 时可忽略，仅做本地 gzip 预压缩即可",
    ]
    if has_big_assets:
        plan.big_file_advice = [
            "大依赖(如 echarts/三维库)单独分包 + 动态 import 按需加载",
            "超大单文件用 manualChunks 拆分，避免单 chunk 过大阻塞首屏",
            "媒体大文件走独立静态目录，不进 JS bundle",
        ]
    return plan


def _main(argv: List[str]) -> int:
    tool = argv[1] if len(argv) > 1 else "vite"
    print(json.dumps(build_plan(tool).to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
