#!/usr/bin/env python3
"""
PromptKit 预提交安全检查
==========================
在 git commit 前自动扫描暂存区，阻止敏感文件意外入库。

触发方式:
  git config core.hooksPath .githooks
  或手动: python pre_commit_check.py

扫描项:
  1. RSA 私钥 / PEM 文件
  2. License Key / 签名生成逻辑
  3. 商业插件目录引用
  4. 数据库文件 / 备份文件
  5. 硬编码密钥/密码
"""

import sys
import os
import subprocess
import re
from pathlib import Path

# 强制 UTF-8 避免 Windows GBK 编码问题
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ============================================================
# 敏感模式定义
# ============================================================

# 文件名绝对禁止
FORBIDDEN_FILES = [
    "private.pem", "private_key.pem", "private.key",
    "license_server.py",
    "generate_license_key.py",
    "*.pkb", "*.db", "*.db-shm", "*.db-wal",
]

# 文件内容敏感模式（扫描 new/changed 行）
FORBIDDEN_CONTENT_PATTERNS = [
    (r"-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----", "🚫 RSA 私钥"),
    (r"-----BEGIN\s+ENCRYPTED\s+PRIVATE\s+KEY-----", "🚫 加密私钥"),
    (r"def\s+encode_license_payload", "🚫 License 签名生成函数"),
    (r"def\s+_generate_rsa_keys", "🚫 RSA 密钥对生成"),
    (r"def\s+_rsa_sign", "🚫 RSA 签名函数"),
    (r"pk-aes-", "⚠️  AES 密钥派生（此为前缀常量，如不是硬编码密钥则忽略）"),
    (r"password\s*=\s*[\"'][^\"']{8,}[\"']", "⚠️  疑似硬编码密码"),
    (r"secret_key\s*=\s*[\"'][^\"']{8,}[\"']", "⚠️  疑似硬编码密钥"),
]

# 路径模式（不允许暂存）
FORBIDDEN_PATHS = [
    "plugins/project/",
    "plugins/project_mgmt/",
    "plugins/asset_mgmt/",
    "plugins/team_collab/",
    "data/licenses/",
    "data/backups/",
    "data/prompts.db",
    "data/originals/",
    "data/thumbnails/",
    "data/videos/",
    "data/wc_media/",
    "data/models/",
    "logs/",
    "dist/",
    "build/",
]


def get_staged_files():
    """获取暂存区文件列表"""
    try:
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
            capture_output=True, text=True, check=False, encoding='utf-8', errors='replace'
        )
        if result.returncode != 0:
            return []
        return [f.strip() for f in result.stdout.splitlines() if f.strip()]
    except Exception:
        return []


def get_staged_diff(filepath):
    """获取单个文件在暂存区的新增行"""
    try:
        result = subprocess.run(
            ["git", "diff", "--cached", "--unified=0", filepath],
            capture_output=True, text=True, check=False, encoding='utf-8', errors='replace'
        )
        if result.returncode != 0 or not result.stdout:
            return []
        # 只提取新增行（以 + 开头的行，排除 +++ 文件头）
        added_lines = []
        for line in result.stdout.splitlines():
            if line.startswith("+") and not line.startswith("+++"):
                added_lines.append(line[1:])  # 去掉 +
        return added_lines
    except Exception:
        return []


def check_filename(filename):
    """检查文件名是否命中禁止列表"""
    basename = os.path.basename(filename)
    for pattern in FORBIDDEN_FILES:
        if pattern.startswith("*."):
            if basename.endswith(pattern[1:]):
                return f"禁止的文件类型: {pattern}"
        elif basename == pattern:
            return f"禁止的文件: {pattern}"
    return None


def check_path(filename):
    """检查路径是否命中禁止模式"""
    for pattern in FORBIDDEN_PATHS:
        if filename.startswith(pattern) or pattern in filename:
            return f"禁止的路径: {pattern}"
    return None


def check_content(filename, added_lines):
    """扫描文件新增内容是否含敏感模式"""
    findings = []
    for i, line in enumerate(added_lines):
        for pattern, desc in FORBIDDEN_CONTENT_PATTERNS:
            if re.search(pattern, line):
                findings.append(f"  L{i+1}: {desc} → `{line.strip()[:100]}`")
                break  # 每行只报第一个敏感模式
    return findings


def main():
    staged = get_staged_files()
    if not staged:
        print("[预提交] ✅ 无暂存文件")
        return 0

    errors = []
    warnings = []

    for filepath in staged:
        # 跳过已删除的文件
        if not os.path.exists(filepath):
            continue

        # 检查文件名
        err = check_filename(filepath)
        if err:
            errors.append(f"  {filepath}: {err}")

        # 检查路径
        err = check_path(filepath)
        if err:
            errors.append(f"  {filepath}: {err}")

        # 检查内容（仅文本文件）
        if filepath.endswith((".py", ".js", ".json", ".sh", ".bat", ".txt", ".yml", ".yaml", ".cfg")):
            added_lines = get_staged_diff(filepath)
            findings = check_content(filepath, added_lines)
            if findings:
                for f in findings:
                    if "🚫" in f:
                        errors.append(f"  {filepath}:{f}")
                    elif "⚠️" in f:
                        warnings.append(f"  {filepath}:{f}")

    # 输出结果
    all_ok = True

    if warnings:
        print("\n⚠️  ⚠️  ⚠️  警告（请人工确认）⚠️  ⚠️  ⚠️")
        for w in warnings:
            print(w)
        print()

    if errors:
        print("\n🚫 🚫 🚫  错误: 禁止提交以下内容! 🚫 🚫 🚫")
        for e in errors:
            print(e)
        print()
        print("这些文件可能包含商业敏感信息，不应进入公开仓库。")
        print("如果这是误报，请在 .githooks/pre-commit 中添加例外。")
        print()
        print("商业代码应放在私有仓库 prompt-tool-dev-private/ 中。")
        print("详见 docs/REPO_ISOLATION.md")
        print()
        all_ok = False

    if all_ok and not warnings:
        print(f"[预提交] ✅ 检查通过 ({len(staged)} 个文件)")
    elif all_ok:
        print(f"[预提交] ✅ 检查通过 ({len(staged)} 个文件, {len(warnings)} 个警告)")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
