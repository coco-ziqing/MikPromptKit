# -*- coding: utf-8 -*-
"""
前端静态资源版本号自动更新（Phase 3.4）
=========================================
问题背景：index.html 中 60+ 个 <script src="/static/js/xxx.js?v=N"> 版本号手工维护，
改 JS 忘升版本号 → 浏览器缓存旧代码（历史踩坑多次）。

本脚本：扫描 HTML 中 /static/ 资源引用，按文件 content-hash(MD5 前8位) 自动重写 ?v=。

用法：
    python scripts/bump_asset_versions.py            # 更新全部 HTML
    python scripts/bump_asset_versions.py --check    # 只报告不一致，不写文件
"""
import argparse
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
STATIC = os.path.join(FRONTEND, "static")
HTML_FILES = ["index.html", "admin_users.html", "cover_editor.html", "login.html"]

# 匹配 /static/xxx.js?v=N 或 /static/xxx.css?v=N（无版本号也匹配）
REF_RE = re.compile(r'(/static/[^\s"\']+?\.(?:js|css))(?:\?v=[\w.-]+)?')


def file_hash(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()[:8]


def resolve_static(ref: str) -> str | None:
    """/static/js/xxx.js → 本地绝对路径；不存在返回 None"""
    rel = ref[len("/static/"):]
    p = os.path.join(STATIC, rel.replace("/", os.sep))
    return p if os.path.isfile(p) else None


def process_html(html_path: str, check_only: bool) -> tuple[int, int]:
    """返回 (改动数, 引用总数)"""
    changed = 0
    total = 0
    with open(html_path, encoding="utf-8") as f:
        content = f.read()

    def repl(m: re.Match) -> str:
        nonlocal changed, total
        ref = m.group(1)
        total += 1
        local = resolve_static(ref)
        if local is None:
            return m.group(0)  # 资源不存在，原样保留
        new_ref = f"{ref}?v={file_hash(local)}"
        if new_ref != m.group(0):
            changed += 1
        return new_ref

    new_content = REF_RE.sub(repl, content)
    if not check_only and new_content != content:
        with open(html_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(new_content)
    return changed, total


def main():
    ap = argparse.ArgumentParser(description="前端静态资源 ?v= 版本号自动更新")
    ap.add_argument("--check", action="store_true", help="只报告不写入")
    args = ap.parse_args()

    total_changed = 0
    total_refs = 0
    for name in HTML_FILES:
        p = os.path.join(FRONTEND, name)
        if not os.path.exists(p):
            continue
        c, t = process_html(p, args.check)
        total_changed += c
        total_refs += t
        print(f"  {name}: {c} changed / {t} refs")

    print(f"\n{'[check] ' if args.check else ''}total: {total_changed}/{total_refs} refs "
          f"{'WOULD change' if args.check else 'updated'}")
    sys.exit(0)


if __name__ == "__main__":
    main()
