# -*- coding: utf-8 -*-
"""
封装前建表列完整性检查 — 对比 init_db() CREATE TABLE 与所有 migrate 脚本的 ALTER TABLE
用法: python backend/_lint_columns.py
返回: exit 0 = 全绿, exit 1 = 缺失列
"""
import os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_FILE = ROOT / "database.py"

# 从 init_db() 提取 CREATE TABLE 语句中的列名
def extract_create_columns(content: str) -> dict:
    tables = {}
    # 匹配 CREATE TABLE IF NOT EXISTS <name> (...) 内的列定义
    pattern = r"CREATE TABLE IF NOT EXISTS (\w+)\s*\(((?:[^()]|\([^)]*\))*)\)"
    for m in re.finditer(pattern, content, re.DOTALL):
        tname = m.group(1)
        cols = set()
        body = m.group(2)
        for line in body.split("\n"):
            line = line.strip()
            if not line or line.startswith("--"):
                continue
            col_match = re.match(r"(\w+)\s+", line)
            if col_match and col_match.group(1).upper() not in ("PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT", "CREATE"):
                cols.add(col_match.group(1))
        tables[tname] = cols
    return tables

# 从所有 migrate 脚本提取 ALTER TABLE ADD COLUMN
def extract_alter_columns(root: Path) -> set:
    alter_cols = set()
    for fp in root.glob("migrate*.py"):
        content = fp.read_text(encoding="utf-8", errors="ignore")
        pattern = r"ALTER TABLE (\w+) ADD COLUMN (\w+)"
        for m in re.finditer(pattern, content):
            alter_cols.add(m.group(2))
    return alter_cols

print("=" * 60)
print("  PromptKit 封装前建表列完整性检查")
print("=" * 60)

content = DB_FILE.read_text(encoding="utf-8")
create_cols = extract_create_columns(content)
alter_cols = extract_alter_columns(ROOT)

# 收集 CREATE TABLE 中的所有列
all_table_cols = set()
for tname, cols in create_cols.items():
    all_table_cols.update(cols)

# 找出在 migrate 脚本中 ADD 过但 CREATE TABLE 中缺少的列
missing = alter_cols - all_table_cols

if missing:
    print(f"\n❌ 发现 {len(missing)} 个迁移列未在 init_db() 建表语句中:")
    for col in sorted(missing):
        # 找哪个迁移脚本加的
        for fp in ROOT.glob("migrate*.py"):
            c = fp.read_text(encoding="utf-8", errors="ignore")
            if f"ADD COLUMN {col}" in c:
                print(f"  ❌ {col} (来源: {fp.name})")
                break
    print("\n修复方法: 在 database.py 的 CREATE TABLE 语句中添加这些列")
    sys.exit(1)

# 统计
total_tables = len(create_cols)
total_cols = len(all_table_cols)
print(f"  Tables: {total_tables} | Columns: {total_cols}")
print(f"  Migrate ALTER columns: {len(alter_cols)}")
print(f"  Missing from init_db: 0")
print(f"\n✅ 建表列完整性检查通过")
sys.exit(0)
