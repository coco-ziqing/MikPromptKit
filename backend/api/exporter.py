"""
API 路由 — PNG 提示词卡片导出/导入
"""
import datetime
import io
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from database import get_db
from exporter import (
    batch_export_prompts,
    batch_import_pngs,
    export_prompt_to_png,
    import_prompt_from_png,
)

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/prompt-to-png/{prompt_id}")
def export_single_prompt(prompt_id: int):
    """导出单条提示词为 PNG 卡片"""
    png_bytes = export_prompt_to_png(prompt_id)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": f"attachment; filename=prompt_{prompt_id}.png"}
    )


@router.post("/batch-to-png")
def batch_export_prompts_api(data: dict):
    """批量导出为 ZIP"""
    prompt_ids = data.get("prompt_ids", [])
    if not prompt_ids:
        raise HTTPException(400, "缺少 prompt_ids")

    zip_bytes = batch_export_prompts(prompt_ids)

    # 生成友好文件名
    zip_name = f"提示词卡片_导出_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'}
    )


@router.post("/preview-png")
async def preview_png_import(file: UploadFile = File(...)):
    """上传 PNG 预览元数据（仅解析，不导入）"""
    file_bytes = await file.read()
    try:
        import json

        from PIL import Image
        img = Image.open(io.BytesIO(file_bytes))
        meta_str = img.info.get("prompt_kit")
        if not meta_str:
            raise HTTPException(400, "该图片不包含有效的提示词数据")
        meta = json.loads(meta_str)
        data = meta.get("prompt_kit", {}).get("data", {})
        return {
            "ok": True,
            "preview": {
                "content": str(data.get("content", "")),
                "meaning": str(data.get("meaning", "")),
                "category": data.get("category", ""),
                "module": data.get("module", ""),
                "tags": data.get("tags", []),
                "collections": data.get("collections", []),
                "thumbnail_base64": data.get("thumbnail_base64"),
                "thumbnail_filename": data.get("thumbnail_filename", ""),
                "scene": data.get("scene", ""),
                "group_id": data.get("group_id"),
                "group_name": data.get("group_name", ""),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"解析失败: {e}")


@router.post("/import-png")
async def import_single_png(
    file: UploadFile = File(...),
    conflict: str = Form("skip"),
    overrides: str = Form("[]")
):
    """导入单条 PNG 提示词卡片"""
    if conflict not in ("skip", "overwrite", "rename"):
        conflict = "skip"
    file_bytes = await file.read()
    # 解析 overrides 并直接传入 importer（避免二次 UPDATE 双表不同步）
    import json
    ov_mod = None
    ov_cat = None
    ov_cont = None
    ov_gid = None
    try:
        ov_list = json.loads(overrides) if overrides and overrides != "[]" else []
        if ov_list and len(ov_list) > 0:
            ov = ov_list[0]
            ov_mod = ov.get("module")
            ov_cat = ov.get("category")
            ov_cont = ov.get("content")
            ov_gid = ov.get("group_id")
            if ov_gid is not None:
                try: ov_gid = int(ov_gid)
                except Exception: ov_gid = None
    except Exception:
        pass
    result = import_prompt_from_png(file_bytes, conflict=conflict,
                                     override_module=ov_mod,
                                     override_category=ov_cat,
                                     override_content=ov_cont,
                                     override_group_id=ov_gid)
    return {"ok": True, "result": result}


@router.post("/import-batch-png")
async def import_batch_png(
    files: list[UploadFile] = File(...),
    conflict: str = Form("skip")
):
    """批量导入 PNG 提示词卡片"""
    if conflict not in ("skip", "overwrite", "rename"):
        conflict = "skip"
    all_bytes = []
    for f in files:
        fb = await f.read()
        if fb:
            all_bytes.append(fb)

    results = batch_import_pngs(all_bytes, conflict=conflict)
    created = sum(1 for r in results if r.get("created"))
    skipped = sum(1 for r in results if r.get("reason") == "skip")
    failed = sum(1 for r in results if not r.get("created") and r.get("reason") != "skip")

    return {
        "ok": True,
        "total": len(results),
        "created": created,
        "skipped": skipped,
        "failed": failed,
        "results": results
    }


@router.post("/preview-text")
async def preview_text_import(file: UploadFile = File(...)):
    """解析 TXT/MD 提示词文本 — 支持本系统导出的 txt/md 格式 + 裸文本行

    2026-08-03: 对齐 PNG 导入链路新增，供拖拽/弹窗导入预览。
    识别格式:
      TXT:  [i] [module/category] 标题\n    释义: xxx
      MD:   ### i. 标题\n- **模块**: m  |  **分类**: c\n- **释义**: xxx
      裸文本: 每行一条 content
    """
    import re as _re
    raw = (await file.read()).decode("utf-8", errors="replace")
    items = []
    # 1) 结构化 TXT/MD 条目: [n] [模块/分类] 标题 或 ### n. 标题
    structured = _re.split(r"\n(?=(?:\[\d+\]|###\s*\d+\.))", raw)
    for block in structured:
        block = block.strip()
        if not block:
            continue
        m = _re.match(r"^\[(\d+)\]\s*\[([^/\]]+)(?:/([^\]]+))?\]\s*(.+)$", block, _re.M)
        h = _re.match(r"^###\s*\d+\.\s*(.+)$", block, _re.M)
        if m:
            module = (m.group(2) or "").strip()
            category = (m.group(3) or "").strip()
            content = m.group(4).strip()
            meaning = ""
            mm = _re.search(r"释义[:：]\s*(.+)$", block, _re.M)
            if mm:
                meaning = mm.group(1).strip()
            if content:
                items.append({"content": content, "meaning": meaning,
                              "module": module, "category": category})
        elif h:
            content = h.group(1).strip()
            module = category = meaning = ""
            mm = _re.search(r"\*\*模块\*\*[:：]\s*([^|]+)", block)
            if mm:
                module = mm.group(1).strip()
            cc = _re.search(r"\*\*分类\*\*[:：]\s*([^|\n]+)", block)
            if cc:
                category = cc.group(1).strip()
            mm2 = _re.search(r"\*\*释义\*\*[:：]\s*(.+)$", block, _re.M)
            if mm2:
                meaning = mm2.group(1).strip()
            if content:
                items.append({"content": content, "meaning": meaning,
                              "module": module, "category": category})
    # 2) 兜底: 裸文本行（跳过标题/分隔线）
    if not items:
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("---"):
                continue
            items.append({"content": line, "meaning": "", "module": "", "category": ""})
    if not items:
        raise HTTPException(400, "未识别到有效的提示词条目")
    return {"ok": True, "items": items, "count": len(items)}


@router.post("/import-json")
async def import_json_backup(file: UploadFile = File(...), conflict: str = Form("skip")):
    """导入 JSON 备份文件"""
    import json
    file_bytes = await file.read()
    try:
        data = json.loads(file_bytes)
        prompts_data = data.get("prompts", [])
        if not prompts_data and isinstance(data, list):
            prompts_data = data
    except Exception as e:
        raise HTTPException(400, f"JSON 解析失败: {e}")

    if conflict not in ("skip", "overwrite", "rename"):
        conflict = "skip"

    db = get_db()
    created = 0
    skipped = 0
    failed = 0
    for item in prompts_data:
        content = item.get("content", item.get("prompt", ""))
        if not content:
            failed += 1
            continue
        existing = db.execute("SELECT id FROM prompts WHERE content=?", [content]).fetchone()
        if existing:
            if conflict == "skip":
                skipped += 1
                continue
            elif conflict == "rename":
                content += " (导入副本 " + uuid.uuid4().hex[:4] + ")"
            elif conflict == "overwrite":
                db.execute("DELETE FROM prompts WHERE id=?", [existing["id"]])

        module = item.get("module", "emotion")
        category = item.get("category", "通用")
        meaning = item.get("meaning", "")
        scene = item.get("scene", "")
        tags = json.dumps(item.get("tags", []), ensure_ascii=False)

        db.execute(
            "INSERT INTO prompts (module, category, subcategory, content, meaning, scene, tags) VALUES (?,?,?,?,?,?,?)",
            [module, category, item.get("subcategory", ""), content, meaning, scene, tags]
        )
        db.commit()
        created += 1

    return {
        "ok": True,
        "result": {"created": created > 0, "created_count": created, "skipped": skipped, "failed": failed, "reason": None if created > 0 else "skip"}
    }
