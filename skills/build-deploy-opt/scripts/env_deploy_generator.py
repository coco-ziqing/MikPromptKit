# -*- coding: utf-8 -*-
"""
build-deploy-opt / env_deploy_generator.py
==========================================
跨环境部署配置适配（能力⑤）+ 一键部署脚本生成（能力⑥）+ 全流程编排入口

职责：
  1. 解析现有 .env，检出多环境冲突（重复 key、写死本机地址、端口冲突、调试开关）；
  2. 生成 .env.development / .env.test / .env.production 三层分层配置；
  3. 生成本地启动脚本(start.bat) + 服务器 Nginx 反向代理 + 容器(docker) 简易部署；
  4. 作为统一入口编排：parse-config + error-fix + dep-clean + asset-compress + env-deploy；
  5. 按路由模式产出 quick / full 两种详尽度（控 Token）。

纯标准库；可 import 亦可 CLI。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Dict


def _load(name: str):
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(name, here / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # Py3.14 @dataclass 需模块已注册
    spec.loader.exec_module(mod)  # type: ignore
    return mod


bcp = _load("build_config_parser")
router = _load("model_router_dispatch")
bef = _load("build_error_fixer")
dco = _load("dep_clean_optimizer")
aco = _load("asset_compress_opt")

_ENV_LINE = re.compile(r"^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$")
_LOCALHOST = re.compile(r"localhost|127\.0\.0\.1")


@dataclass
class EnvReport:
    conflicts: List[str] = field(default_factory=list)
    duplicate_keys: List[str] = field(default_factory=list)
    hardcoded_local: List[str] = field(default_factory=list)
    layered_env: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def analyze_env(text: str) -> EnvReport:
    rep = EnvReport()
    seen: Dict[str, int] = {}
    kv: Dict[str, str] = {}
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = _ENV_LINE.match(ln)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        seen[key] = seen.get(key, 0) + 1
        if _LOCALHOST.search(val):
            rep.hardcoded_local.append(f"{key}={val}  → 写死本机地址，服务器环境不可用")
        kv[key] = val

    for k, c in seen.items():
        if c > 1:
            rep.duplicate_keys.append(f"{key_dup(k)} 重复定义 {c} 次（后值覆盖前值，易冲突）")

    # 端口冲突
    ports = {k: v for k, v in kv.items() if "PORT" in k}
    if len(set(ports.values())) < len([v for v in ports.values() if v]) and ports:
        rep.conflicts.append(f"多个端口变量取值相同，存在冲突：{ports}")
    if kv.get("VITE_DEBUG", "").lower() == "true" and kv.get("NODE_ENV") == "production":
        rep.conflicts.append("生产环境(NODE_ENV=production)仍开启 VITE_DEBUG=true，应关闭")
    if "VITE_ENV" not in kv:
        rep.conflicts.append("缺少 VITE_ENV 环境区分变量，无法识别 dev/test/prod")

    rep.layered_env = _gen_layered_env()
    return rep


def key_dup(k: str) -> str:
    return k


def _gen_layered_env() -> Dict[str, str]:
    dev = (
        "# .env.development —— 本地开发\n"
        "VITE_ENV=development\n"
        "NODE_ENV=development\n"
        "VITE_API_BASE=http://localhost:8080\n"
        "VITE_OLLAMA_URL=http://127.0.0.1:11434\n"
        "VITE_COMFYUI_URL=http://127.0.0.1:8188\n"
        "DEV_SERVER_PORT=5173\n"
        "VITE_DEBUG=true\n"
    )
    test = (
        "# .env.test —— 内网测试\n"
        "VITE_ENV=test\n"
        "NODE_ENV=production\n"
        "VITE_API_BASE=http://192.168.0.103:8080\n"
        "VITE_OLLAMA_URL=http://192.168.0.103:11434\n"
        "VITE_COMFYUI_URL=http://192.168.0.103:8188\n"
        "VITE_DEBUG=false\n"
    )
    prod = (
        "# .env.production —— 线上服务器\n"
        "VITE_ENV=production\n"
        "NODE_ENV=production\n"
        "VITE_API_BASE=/api          # 走 Nginx 同源反代，避免跨域\n"
        "VITE_OLLAMA_URL=/ollama     # 由 Nginx 代理到内部模型服务\n"
        "VITE_COMFYUI_URL=/comfyui\n"
        "VITE_DEBUG=false\n"
    )
    return {".env.development": dev, ".env.test": test, ".env.production": prod}


# ── 部署脚本生成（能力⑥）─────────────────────────────────────────────
def _gen_deploy_scripts(port: int = 8080) -> Dict[str, str]:
    start_bat = (
        "@echo off\n"
        "REM ===== PromptKit 本地启动脚本 =====\n"
        "chcp 65001 >nul\n"
        "echo [1/2] 构建前端产物...\n"
        "call npm run build\n"
        "echo [2/2] 启动后端服务(0.0.0.0:%PORT%)...\n"
        f"set PORT={port}\n"
        f"python backend\\main.py\n"
        "pause\n"
    )
    nginx_conf = (
        "# ===== PromptKit Nginx 反向代理 =====\n"
        "server {\n"
        "    listen 80;\n"
        "    server_name promptkit.local;\n"
        "    root /var/www/promptkit/dist;   # 前端构建产物\n"
        "    index index.html;\n"
        "    location / { try_files $uri $uri/ /index.html; }   # SPA history 路由\n"
        f"    location /api/     {{ proxy_pass http://127.0.0.1:{port}/api/; }}\n"
        "    location /ollama/  { proxy_pass http://127.0.0.1:11434/; }\n"
        "    location /comfyui/ { proxy_pass http://127.0.0.1:8188/; }\n"
        "    gzip on; gzip_static on;\n"
        "    gzip_types text/css application/javascript application/json image/svg+xml;\n"
        "}\n"
    )
    dockerfile = (
        "# ===== PromptKit 简易容器部署 =====\n"
        "FROM python:3.12-slim\n"
        "WORKDIR /app\n"
        "COPY requirements.txt .\n"
        "RUN pip install --no-cache-dir -r requirements.txt\n"
        "COPY . .\n"
        f"EXPOSE {port}\n"
        f"CMD [\"python\", \"backend/main.py\"]\n"
    )
    return {"start.bat": start_bat, "nginx.conf": nginx_conf, "Dockerfile": dockerfile}


@dataclass
class DeployReport:
    env: dict = field(default_factory=dict)
    scripts: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def generate(config_text: str = "", error_log: str = "", env_text: str = "",
             package_json: str = "", user_input: str = "") -> dict:
    """统一编排入口。各输入均可选；按提供内容运行对应模块。"""
    cfg = bcp.parse_config(config_text) if config_text else None
    fix = bef.analyze_log(error_log) if error_log else None
    env = analyze_env(env_text) if env_text else None
    deps = dco.analyze_package(package_json) if package_json else None
    tool = (cfg.tool if cfg else (fix.tool_hint if fix else "vite"))
    compress = aco.build_plan(tool if tool in ("vite", "webpack") else "vite")
    scripts = _gen_deploy_scripts()

    # 路由信号汇总
    signals = {
        "error_count": len(fix.matched_tags) if fix else 0,
        "risk_level": cfg.risk_level if cfg else "low",
        "env_conflicts": (len(env.conflicts) + len(env.duplicate_keys) + len(env.hardcoded_local)) if env else 0,
    }
    raw_blob = "\n".join([config_text, error_log, env_text])
    decision = router.route(user_input=user_input, signals=signals, raw_text=raw_blob)

    return {
        "route": decision.to_dict(),
        "config": cfg.to_dict() if cfg else None,
        "error_fix": fix.to_dict() if fix else None,
        "deps": deps.to_dict() if deps else None,
        "env": env.to_dict() if env else None,
        "compress": compress.to_dict(),
        "deploy_scripts": scripts,
    }


# ── Markdown 渲染（quick / full 控 Token）─────────────────────────────
def render_markdown(report: dict) -> str:
    route = report["route"]
    quick = route["mode"] == "quick"
    L = []
    L.append(f"# 🚀 工程打包&部署优化报告  ·  {'轻量校验' if quick else '全量深度优化'}")
    L.append(f"- 路由模型：`{route['model']}`  | 模式：`{route['mode']}`"
             f"  | 强制指令：{'是' if route['forced_by_slash'] else '否'}")
    L.append(f"- 决策依据：{route['reason']}")
    L.append(f"- Token 预算：≤ {route['max_output_tokens']} tokens（{route['verbosity']}）")
    L.append("")

    if quick:
        L.append("## ⚡ 快速校验结论")
        if report["config"]:
            c = report["config"]
            L.append(f"- 构建工具：{c['tool']}  | 风险等级：**{c['risk_level']}**")
            for g in c["optimization_gaps"][:3]:
                L.append(f"  - 缺失：{g['item']}")
        if report["error_fix"]:
            for f in report["error_fix"]["fixes"][:2]:
                L.append(f"- 报错[{f['tag']}] → {f['fix']}")
        if report["env"]:
            for x in (report["env"]["conflicts"] + report["env"]["hardcoded_local"])[:2]:
                L.append(f"- 环境：{x}")
        return "\n".join(L)

    # FULL
    if report["config"]:
        c = report["config"]
        L.append(f"## 🏗 构建配置分析（{c['tool']} / 风险 {c['risk_level']}, score={c['risk_score']}）")
        if c["bad_configs"]:
            L.append("**不当配置：**")
            for b in c["bad_configs"]:
                L.append(f"- ⚠️ {b['issue']}")
        L.append("**优化补全建议：**")
        for g in c["optimization_gaps"]:
            L.append(f"- 缺失 {g['item']}")
            if g["suggest"]:
                L.append(f"  ```js\n  {g['suggest']}\n  ```")

    if report["error_fix"]:
        L.append("\n## 🔧 构建报错根因与修复")
        for f in report["error_fix"]["fixes"]:
            loc = f"（位置: {', '.join(f['locations'])}）" if f["locations"] else ""
            L.append(f"### [{f['tag']}]{loc}")
            L.append(f"- 表层：{f['symptom']}")
            L.append(f"- 根因：{f['cause']}")
            L.append(f"- 修复：{f['fix']}")

    if report["deps"]:
        d = report["deps"]
        L.append(f"\n## 📦 依赖精简（可瘦身 {d['slimmable_count']} 项）")
        for cmd in d["uninstall_commands"]:
            L.append(f"- `{cmd}`")
        for h in d["heavy_suggest"]:
            L.append(f"- 重型包 **{h['pkg']}**：{h['suggest']}")

    if report["env"]:
        e = report["env"]
        L.append("\n## 🌐 跨环境配置适配")
        L.append("**检出冲突：**")
        for x in e["conflicts"] + e["duplicate_keys"] + e["hardcoded_local"]:
            L.append(f"- ⚠️ {x}")
        L.append("**分层配置（生成）：**")
        for fname in e["layered_env"]:
            L.append(f"- `{fname}` ✔")

    cz = report["compress"]
    L.append(f"\n## 🗜 静态资源压缩（{cz['tool']}）")
    for s in cz["strategies"]:
        L.append(f"- **{s['title']}**：{s['actions'][0]}")
    L.append("**gzip/brotli 配置：** 见 compression_code（已生成）")

    L.append("\n## 📜 一键部署脚本（生成）")
    for fname in report["deploy_scripts"]:
        L.append(f"- `{fname}` ✔")

    L.append("\n## 🛡 上线风险规避清单")
    L.append("- 生产关闭 source-map 与 debug 开关；分层 .env 严格区分；")
    L.append("- 部署前 `npm run build` 校验产物；Nginx try_files 兜底 SPA 路由；")
    L.append("- 端口/模型服务地址走反代同源，避免跨域与写死本机；")
    L.append("- 灰度先内网测试环境验证，再切线上。")
    return "\n".join(L)


def _read(p: str) -> str:
    pth = Path(p)
    return pth.read_text(encoding="utf-8", errors="replace") if pth.exists() else p


def _main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description="build-deploy-opt 构建部署优化生成器")
    ap.add_argument("--config", default="", help="vite/webpack 配置文件")
    ap.add_argument("--error", default="", help="构建报错日志文件")
    ap.add_argument("--env", default="", help=".env 配置文件")
    ap.add_argument("--package", default="", help="package.json 文件")
    ap.add_argument("--input", default="", help='用户输入，识别 /build-opt-full 或 /build-check-quick')
    ap.add_argument("--json", action="store_true", help="输出 JSON 而非 Markdown")
    args = ap.parse_args(argv[1:])

    report = generate(
        config_text=_read(args.config) if args.config else "",
        error_log=_read(args.error) if args.error else "",
        env_text=_read(args.env) if args.env else "",
        package_json=_read(args.package) if args.package else "",
        user_input=args.input,
    )
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
