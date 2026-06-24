# -*- coding: utf-8 -*-
"""
api/atoms_import.py — Phase15 原子批量导入中间件
  支持 CSV / JSON / TXT 三种格式一键导入
  自动调用 atoms.py 的 decompose 引擎完成原子拆解
"""
from __future__ import annotations
import json, csv, io, hashlib, asyncio
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/v4/atoms/import", tags=["atoms-import"])

from database import get_db, safe_fetch_one, safe_count_dict
from api.atoms import decompose, DecomposeReq, ATOM_TYPE_TO_MODULE


class ImportOptions(BaseModel):
    """导入选项"""
    group_id: int = None          # 目标分组
    auto_archive: bool = True     # 自动归档到词卡
    dedup: bool = True            # MD5 去重
    source_label: str = "import"  # 来源标记


# ==================== CSV 导入 ====================

@router.post("/csv")
async def import_csv(file: UploadFile = File(...), group_id: int = None, auto_archive: bool = True):
    """CSV 批量导入 + 自动拆解
    CSV 格式: 第1列=提示词文本, 第2列=媒体类型(可选)
    """
    content = await file.read()
    text = content.decode("utf-8")
    reader = csv.reader(io.StringIO(text))
    lines = [row[0].strip() for row in reader if row and row[0].strip()]
    if not lines:
        raise HTTPException(400, "CSV 文件为空或格式不正确")

    results = []
    db = get_db()
    for line in lines:
        media_type = "image"
        # 检查是否包含媒体类型
        if "," in line:
            parts = [p.strip() for p in line.split(",", 1)]
            line = parts[0]
            if parts[1] in ("image", "video"):
                media_type = parts[1]

        # MD5 去重
        h = hashlib.md5(f"{media_type}:{line}".encode()).hexdigest()
        existing = safe_fetch_one("SELECT id FROM atom_decompose WHERE source_hash=?", [h])
        if existing:
            results.append({"text": line[:60], "status": "cached", "decompose_id": existing["id"]})
            continue

        try:
            r = await decompose(DecomposeReq(prompt=line, media_type=media_type))
            did = r.get("id")
            results.append({"text": line[:60], "status": "ok", "decompose_id": did, "atom_count": len(r.get("atoms", []))})

            # 自动归档
            if auto_archive and did:
                _auto_archive_one(db, did, json.loads(safe_fetch_one(
                    "SELECT atoms_json FROM atom_decompose WHERE id=?", [did]
                )["atoms_json"]), group_id)
        except Exception as e:
            results.append({"text": line[:60], "status": "error", "error": str(e)})

    return {"ok": True, "format": "csv", "total": len(lines), "results": results,
            "success": sum(1 for r in results if r["status"] in ("ok", "cached"))}


# ==================== JSON 导入 ====================

@router.post("/json")
async def import_json(file: UploadFile = File(...), group_id: int = None, auto_archive: bool = True):
    """JSON 批量导入 — 支持多格式
    格式1: [\"prompt1\", \"prompt2\", ...]
    格式2: [{\"text\":\"...\",\"media_type\":\"image\"}, ...]
    格式3: {\"prompts\": [{...}, ...]}
    """
    content = await file.read()
    data = json.loads(content.decode("utf-8"))

    # 统一为列表
    if isinstance(data, dict):
        items = data.get("prompts", data.get("items", []))
    elif isinstance(data, list):
        items = data
    else:
        raise HTTPException(400, "JSON 格式不正确，期望数组或 {prompts:[...]}")

    if not items:
        raise HTTPException(400, "JSON 中没有可导入的提示词")

    results = []
    db = get_db()
    for item in items:
        if isinstance(item, str):
            prompt_text = item
            media_type = "image"
        elif isinstance(item, dict):
            prompt_text = item.get("text", item.get("prompt", ""))
            media_type = item.get("media_type", "image")
        else:
            continue

        prompt_text = prompt_text.strip()
        if not prompt_text:
            continue

        h = hashlib.md5(f"{media_type}:{prompt_text}".encode()).hexdigest()
        existing = safe_fetch_one("SELECT id FROM atom_decompose WHERE source_hash=?", [h])
        if existing:
            results.append({"text": prompt_text[:60], "status": "cached", "decompose_id": existing["id"]})
            continue

        try:
            r = await decompose(DecomposeReq(prompt=prompt_text, media_type=media_type))
            did = r.get("id")
            results.append({"text": prompt_text[:60], "status": "ok", "decompose_id": did, "atom_count": len(r.get("atoms", []))})

            if auto_archive and did:
                _auto_archive_one(db, did, json.loads(safe_fetch_one(
                    "SELECT atoms_json FROM atom_decompose WHERE id=?", [did]
                )["atoms_json"]), group_id)
        except Exception as e:
            results.append({"text": prompt_text[:60], "status": "error", "error": str(e)})

    return {"ok": True, "format": "json", "total": len(items), "results": results,
            "success": sum(1 for r in results if r["status"] in ("ok", "cached"))}


# ==================== TXT 导入（纯文本分行） ====================

@router.post("/txt")
async def import_txt(file: UploadFile = File(...), group_id: int = None, auto_archive: bool = True):
    """TXT 纯文本导入 — 每行一个提示词
    支持注释行（以 # 开头）自动跳过
    """
    content = await file.read()
    text = content.decode("utf-8")
    lines = [line.strip() for line in text.split("\n")
             if line.strip() and not line.strip().startswith("#")]
    if not lines:
        raise HTTPException(400, "TXT 文件为空或全是注释")

    results = []
    db = get_db()
    for line in lines:
        h = hashlib.md5(f"image:{line}".encode()).hexdigest()
        existing = safe_fetch_one("SELECT id FROM atom_decompose WHERE source_hash=?", [h])
        if existing:
            results.append({"text": line[:60], "status": "cached", "decompose_id": existing["id"]})
            continue

        try:
            r = await decompose(DecomposeReq(prompt=line, media_type="image"))
            did = r.get("id")
            results.append({"text": line[:60], "status": "ok", "decompose_id": did, "atom_count": len(r.get("atoms", []))})

            if auto_archive and did:
                _auto_archive_one(db, did, json.loads(safe_fetch_one(
                    "SELECT atoms_json FROM atom_decompose WHERE id=?", [did]
                )["atoms_json"]), group_id)
        except Exception as e:
            results.append({"text": line[:60], "status": "error", "error": str(e)})

    return {"ok": True, "format": "txt", "total": len(lines), "results": results,
            "success": sum(1 for r in results if r["status"] in ("ok", "cached"))}


# ==================== 辅助函数 ====================

def _auto_archive_one(db, decompose_id: int, atoms: list, group_id: int = None) -> int:
    """自动归档单个拆解结果（P1-1: 复用 atoms._insert_atom_card）"""
    from api.atoms import _insert_atom_card
    if not atoms:
        return 0
    if not group_id:
        g = db.execute("SELECT id FROM word_card_group WHERE group_key='atom_auto_import' AND is_active=1").fetchone()
        if not g:
            db.execute("INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,description,sort_order) VALUES ('[原子] 自动导入','atom_auto_import','📥','atom',(SELECT id FROM word_card_group WHERE group_key='root_atom_image'),'AI批量导入原子',9999)")
            db.commit()
            group_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        else:
            group_id = g["id"]
    created = 0
    for atom in atoms:
        _insert_atom_card(db, atom, decompose_id, group_id)
        created += 1
    db.commit()
    return created
