# -*- coding: utf-8 -*-
"""
code-project-analyze / stack_scanner.py
=======================================
工程结构化扫描（核心业务）：
  1. 技术栈识别（语言/框架/构建工具/依赖，从 package.json 等清单提取）；
  2. 目录分层拆解（frontend/backend/db/infra/shared）；
  3. 交互逻辑识别（抓 HTTP API 路由 + 方法 + 路径）；
  4. 业务链路线索汇总。

纯标准库；可 import 亦可 CLI。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Dict

# ── 清单文件 → 技术栈线索 ────────────────────────────────────────────
_MANIFESTS = {
    "package.json": "Node/前端",
    "requirements.txt": "Python",
    "pyproject.toml": "Python",
    "pom.xml": "Java/Maven",
    "build.gradle": "Java/Gradle",
    "go.mod": "Go",
    "Cargo.toml": "Rust",
    "composer.json": "PHP",
}
# 框架特征：依赖名/文件 → 框架
_FRAMEWORK_HINTS = {
    "vue": "Vue", "react": "React", "angular": "Angular", "next": "Next.js",
    "svelte": "Svelte", "fastapi": "FastAPI", "flask": "Flask", "django": "Django",
    "express": "Express", "koa": "Koa", "spring": "Spring", "gin": "Gin",
}
_BUILD_TOOLS = {"vite": "Vite", "webpack": "Webpack", "rollup": "Rollup", "esbuild": "esbuild"}

# ── 目录分层规则 ─────────────────────────────────────────────────────
_LAYER_RULES = {
    "前端": ["frontend", "src/views", "src/components", "src/pages", "src/router", "src/store", "src/api", "src/", ".vue", ".jsx", ".tsx"],
    "后端": ["backend", "api", "controller", "service", "router", "main.py", "app.py", "server"],
    "数据库": ["db", "migration", "models", "schema", "sql", ".sql"],
    "基础设施": ["infra", "deploy", "docker", "ci", ".github", "nginx", "k8s"],
    "公共": ["shared", "common", "utils", "lib", "constants"],
}

# ── API 路由抓取（多语言风格）────────────────────────────────────────
_API_PATTERNS = [
    re.compile(r"@router\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"]", re.I),   # FastAPI
    re.compile(r"@app\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"]", re.I),       # Flask
    re.compile(r"\.(get|post|put|delete|patch)\(\s*[`'\"]([^`'\"]+)[`'\"]", re.I),         # Express/axios
    re.compile(r"axios\.(get|post|put|delete|patch)\(\s*[`'\"]([^`'\"]+)[`'\"]", re.I),    # axios client
]


@dataclass
class ScanResult:
    languages: List[str] = field(default_factory=list)
    frameworks: List[str] = field(default_factory=list)
    build_tools: List[str] = field(default_factory=list)
    dependencies: Dict[str, str] = field(default_factory=dict)
    layers: Dict[str, List[str]] = field(default_factory=dict)
    api_endpoints: List[str] = field(default_factory=list)
    file_count: int = 0
    layer_span: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def _scan_manifest(path: Path, res: ScanResult) -> None:
    name = path.name
    if name not in _MANIFESTS:
        return
    lang = _MANIFESTS[name]
    if lang not in res.languages:
        res.languages.append(lang)
    text = path.read_text(encoding="utf-8", errors="replace")
    low = text.lower()
    # package.json 提取依赖
    if name == "package.json":
        try:
            pkg = json.loads(text)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            res.dependencies.update(deps)
        except Exception:
            pass
    for k, fw in _FRAMEWORK_HINTS.items():
        # 词边界匹配，避免 gin∈plugin、next∈nextick 等子串误判
        if re.search(rf"\b{re.escape(k)}\b", low) and fw not in res.frameworks:
            res.frameworks.append(fw)
    for k, bt in _BUILD_TOOLS.items():
        if k in low and bt not in res.build_tools:
            res.build_tools.append(bt)


def _classify_layer(rel_low: str) -> List[str]:
    hits = []
    for layer, kws in _LAYER_RULES.items():
        if any(kw in rel_low for kw in kws):
            hits.append(layer)
    return hits


def scan(root: str | Path) -> ScanResult:
    root = Path(root)
    res = ScanResult()
    if not root.exists():
        return res

    files = list(root.rglob("*.*")) if root.is_dir() else [root]
    files = [f for f in files if "__pycache__" not in str(f) and ".git" not in str(f)]
    res.file_count = len(files)

    for f in files:
        if not f.is_file():
            continue
        _scan_manifest(f, res)
        rel = str(f.relative_to(root)) if root.is_dir() else f.name
        rel_low = rel.lower().replace("\\", "/")
        for layer in _classify_layer(rel_low):
            res.layers.setdefault(layer, [])
            if rel not in res.layers[layer]:
                res.layers[layer].append(rel)
        # 抓接口（仅源码文件）
        if f.suffix.lower() in (".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".java"):
            try:
                src = f.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            for pat in _API_PATTERNS:
                for m in pat.finditer(src):
                    ep = f"{m.group(1).upper()} {m.group(2)}"
                    if ep not in res.api_endpoints:
                        res.api_endpoints.append(ep)

    res.layer_span = len([L for L in ("前端", "后端", "数据库") if L in res.layers])
    return res


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python stack_scanner.py <项目目录>")
        return 2
    print(json.dumps(scan(argv[1]).to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
