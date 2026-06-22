"""
版本管理公共工具模块 (v1.0.0 — P2 双轨合并)

供 versions.py (旧 pormpts 表) 和 cards.py (新 prompt_cards 表)
统一调用，消除重复代码。

用法:
    from api.version_helpers import archive_current, compute_next_version, build_diff, parse_tags_safe
"""
import json


# prompt_versions 表存档时全部10字段
ARCHIVE_FIELDS = [
    "content", "meaning", "scene", "module", "category",
    "subcategory", "tags", "change_note", "version"
]

# 回滚/恢复时恢复的全部8字段 (含 version)
RESTORE_FIELDS = [
    "content", "meaning", "scene", "module", "category",
    "subcategory", "tags", "version"
]

# diff 对比的全部字符串字段
DIFF_FIELDS = [
    "content", "meaning", "scene", "module", "category",
    "subcategory", "tags"
]


def compute_next_version(db, prompt_id):
    """
    计算下一个版本号 (幂等, 新记录从 1 开始)

    Args:
        db: SQLite 连接
        prompt_id: 提示词/卡片 ID

    Returns:
        int: 下一个版本号
    """
    last = db.execute(
        "SELECT MAX(version) as max_v FROM prompt_versions WHERE prompt_id=?",
        (prompt_id,)
    ).fetchone()
    return (last["max_v"] if last and last["max_v"] else 0) + 1


def parse_tags_safe(tags_value):
    """
    安全解析 tags 字段 (可能是 str/list/None)

    Args:
        tags_value: tags 原始值

    Returns:
        list: 解析后的标签列表
    """
    if tags_value is None:
        return []
    if isinstance(tags_value, list):
        return tags_value
    if isinstance(tags_value, str) and tags_value.strip():
        try:
            parsed = json.loads(tags_value)
            return parsed if isinstance(parsed, list) else []
        except (json.JSONDecodeError, TypeError, AttributeError):
            return []
    return []


def archive_current(db, row, prompt_id, change_note, table_columns):
    """
    将当前内容存入 prompt_versions 表 (双轨统一入口)

    Args:
        db: SQLite 连接
        row: 当前行 (sqlite3.Row 或 dict)
        prompt_id: 提示词/卡片 ID
        change_note: 存档备注
        table_columns: 源表列名列表 (用于字段映射)

    Returns:
        int: 存档的版本号
    """
    next_ver = compute_next_version(db, prompt_id)

    def get_val(key, default=""):
        v = row.get(key) if hasattr(row, "get") else row[key] if key in row.keys() else default
        if v is None:
            return default
        return v

    tags = get_val("tags", "")
    if isinstance(tags, list):
        tags = json.dumps(tags, ensure_ascii=False)

    content = get_val("content", "")
    meaning = get_val("meaning", "")
    scene = get_val("scene", "")
    module = get_val("module", "")
    category = get_val("category", "")
    subcategory = get_val("subcategory", "")

    db.execute("""
        INSERT INTO prompt_versions
            (prompt_id, content, meaning, scene, module, category,
             subcategory, tags, change_note, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        prompt_id, content, meaning, scene, module, category,
        subcategory, tags, change_note, next_ver
    ])
    return next_ver


def build_diff(v1, v2, fields=None):
    """
    对比两个版本的差异

    Args:
        v1: 版本1 (sqlite3.Row 或 dict)
        v2: 版本2
        fields: 要对比的字段列表 (默认 DIFF_FIELDS)

    Returns:
        list[dict]: 差异列表 [{field, old, new}, ...]
    """
    if fields is None:
        fields = DIFF_FIELDS
    diffs = []
    for f in fields:
        a = v1[f] if hasattr(v1, "get") else v1[f]
        b = v2[f] if hasattr(v2, "get") else v2[f]
        if a != b:
            diffs.append({"field": f, "old": a or "", "new": b or ""})
    return diffs


def restore_fields(db, table_name, id_field, id_value, version_row, restore_cols=None):
    """
    将版本记录回写到指定表

    Args:
        db: SQLite 连接
        table_name: 目标表名 (prompts 或 prompt_cards)
        id_field: 主键列名 (id)
        id_value: 主键值
        version_row: 版本行 (sqlite3.Row 或 dict)
        restore_cols: 要恢复的列 (默认 RESTORE_FIELDS 不含 version)

    返回:
        int: 新版本号
    """
    if restore_cols is None:
        restore_cols = [c for c in RESTORE_FIELDS if c != "version"]

    def get_val(key, default=""):
        return (version_row.get(key) if hasattr(version_row, "get")
                else version_row[key]) or default

    sets = [f"{col}=?" for col in restore_cols]
    vals = [get_val(col) for col in restore_cols]
    vals.append(id_value)

    db.execute(
        f"UPDATE {table_name} SET {', '.join(sets)} WHERE {id_field}=?",
        vals
    )
    return compute_next_version(db, id_value)
