"""
提示词版本管理 API
- 自动保存：编辑提示词时自动创建新版本
- 历史列表：查看所有版本
- 恢复：回滚到指定版本
- Diff：对比两个版本差异
"""
from fastapi import APIRouter
from database import get_db
import json

router = APIRouter(prefix="/api/v2/versions", tags=["versions"])


def save_version(prompt_id: int, change_note: str = ""):
    """编辑提示词时自动调用：将当前内容存入历史版本"""
    db = get_db()
    row = db.execute("SELECT * FROM prompts WHERE id=?", [prompt_id]).fetchone()
    if not row:
        return None
    p = dict(row)

    # 计算下一个版本号
    last = db.execute(
        "SELECT MAX(version) as max_v FROM prompt_versions WHERE prompt_id=?",
        [prompt_id]
    ).fetchone()
    next_ver = (last["max_v"] or 0) + 1

    db.execute("""
        INSERT INTO prompt_versions
            (prompt_id, content, meaning, scene, module, category, subcategory, tags, change_note, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        prompt_id,
        p.get("content", ""),
        p.get("meaning", ""),
        p.get("scene", ""),
        p.get("module", ""),
        p.get("category", ""),
        p.get("subcategory", ""),
        p.get("tags", "[]"),
        change_note,
        next_ver
    ])
    db.commit()
    return {"version": next_ver, "id": prompt_id}


@router.get("/{prompt_id}")
def list_versions(prompt_id: int):
    """获取提示词的所有历史版本"""
    db = get_db()
    # 当前版本（从 prompts 表读）
    current = db.execute("SELECT * FROM prompts WHERE id=?", [prompt_id]).fetchone()
    if not current:
        return {"ok": False, "error": "提示词不存在"}

    # 历史版本
    rows = db.execute("""
        SELECT * FROM prompt_versions
        WHERE prompt_id=?
        ORDER BY version DESC
    """, [prompt_id]).fetchall()

    versions = []
    for r in rows:
        v = dict(r)
        try:
            v["tags"] = json.loads(v.get("tags", "[]"))
        except Exception:
            v["tags"] = []
        versions.append(v)

    current_dict = dict(current)
    try:
        current_dict["tags"] = json.loads(current_dict.get("tags", "[]"))
    except Exception:
        current_dict["tags"] = []

    return {
        "ok": True,
        "current": current_dict,
        "versions": versions,
        "total": len(versions)
    }


@router.post("/{prompt_id}/restore/{version_id}")
def restore_version(prompt_id: int, version_id: int):
    """恢复到指定版本"""
    db = get_db()

    # 查找版本
    version = db.execute(
        "SELECT * FROM prompt_versions WHERE id=? AND prompt_id=?",
        [version_id, prompt_id]
    ).fetchone()
    if not version:
        return {"ok": False, "error": "版本不存在"}

    v = dict(version)

    # 当前内容存档（作为新版本）
    save_version(prompt_id, f"回滚到版本 {v['version']}")

    # 恢复版本内容到 prompts 表
    db.execute("""
        UPDATE prompts SET
            content=?, meaning=?, scene=?, module=?,
            category=?, subcategory=?, tags=?
        WHERE id=?
    """, [
        v["content"], v["meaning"], v["scene"],
        v["module"], v["category"], v["subcategory"],
        v["tags"], prompt_id
    ])
    db.commit()

    return {"ok": True, "version": v["version"]}


@router.get("/{prompt_id}/diff/{v1_id}/{v2_id}")
def diff_versions(prompt_id: int, v1_id: int, v2_id: int):
    """对比两个版本的差异"""
    db = get_db()

    v1 = db.execute(
        "SELECT * FROM prompt_versions WHERE id=? AND prompt_id=?",
        [v1_id, prompt_id]
    ).fetchone()
    v2 = db.execute(
        "SELECT * FROM prompt_versions WHERE id=? AND prompt_id=?",
        [v2_id, prompt_id]
    ).fetchone()

    if not v1 or not v2:
        return {"ok": False, "error": "版本不存在"}

    def _diff_field(name, a, b):
        if a != b:
            return {"field": name, "old": a, "new": b}
        return None

    fields = ["content", "meaning", "scene", "module", "category", "tags"]
    diffs = []
    for f in fields:
        d = _diff_field(f, v1[f], v2[f])
        if d:
            diffs.append(d)

    return {
        "ok": True,
        "v1": {"version": v1["version"], "id": v1["id"], "created_at": v1["created_at"]},
        "v2": {"version": v2["version"], "id": v2["id"], "created_at": v2["created_at"]},
        "diffs": diffs,
        "total_changes": len(diffs)
    }
