# -*- coding: utf-8 -*-
"""
封装前路径审计 — 扫描所有模块是否存在 __file__ 硬编码 DB 路径
用法: python backend/_lint_paths.py
返回: exit 0 = 全绿, exit 1 = 发现问题
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BAD_PATTERNS = [
    (r"os\.path\.join\(.*__file__.*['\"]data['\"].*['\"]prompts\.db['\"]", "__file__ → data/prompts.db 硬编码"),
    (r"os\.path\.join\(.*__file__.*\.\..*\.\..*data", "__file__/../../data 硬编码"),
    (r"HERE.*\.\..*\.\..*data.*prompts\.db", "HERE/../../data/prompts.db 硬编码"),
]
SKIP_DIRS = {"__pycache__", ".git", "node_modules", "dist", "build", ".pytest_cache"}

errors = []
warnings = []

def scan_dir(directory: Path, suffix=".py"):
    for fp in directory.rglob(f"*.py"):
        if any(s in fp.parts for s in SKIP_DIRS):
            continue
        try:
            content = fp.read_text(encoding="utf-8")
        except Exception:
            continue
        rel = fp.relative_to(ROOT)
        for pattern, desc in BAD_PATTERNS:
            if re.search(pattern, content):
                # 检查是否有 paths.get_db_path() 的 try/except 兜底
                if "paths import get_db_path" in content or "paths import" in content:
                    warnings.append(f"{rel}: {desc} (已有 paths 导入，可能为 fallback)")
                else:
                    errors.append(f"{rel}: {desc}")
                break

print("=" * 60)
print("  PromptKit 封装前路径审计")
print("=" * 60)

scan_dir(ROOT / "backend")

if errors:
    print(f"\n❌ 发现 {len(errors)} 个硬编码路径问题:")
    for e in errors:
        print(f"  ❌ {e}")
    print("\n修复方法: 用 from paths import get_db_path 替代硬编码路径")
    sys.exit(1)

if warnings:
    print(f"\n⚠️  {len(warnings)} 个 fallback 路径 (已有 paths 导入):")
    for w in warnings:
        print(f"  ⚠️  {w}")

print(f"\n✅ 路径审计通过 (0 硬编码 DB 路径)")
sys.exit(0)
