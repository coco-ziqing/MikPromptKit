"""
API 路由 — PNG 提示词卡片导出/导入
"""
import json, io, zipfile, os, uuid, datetime
from fastapi import APIRouter, Query, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse
from database import get_db
from exporter import export_prompt_to_png, import_prompt_from_png, batch_export_prompts, batch_import_pngs

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
        from PIL import Image
        import json
        img = Image.open(io.BytesIO(file_bytes))
        meta_str = img.info.get("prompt_kit")
        if not meta_str:
            raise HTTPException(400, "该图片不包含有效的提示词数据")
        meta = json.loads(meta_str)
        data = meta.get("prompt_kit", {}).get("data", {})
        return {
            "ok": True,
            "preview": {
                "content": str(data.get("content", ""))[:100],
                "meaning": str(data.get("meaning", ""))[:80],
                "category": data.get("category", ""),
                "module": data.get("module", ""),
                "tags": data.get("tags", []),
                "collections": data.get("collections", []),
                "has_thumbnail": bool(data.get("thumbnail_base64")),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"解析失败: {e}")


@router.post("/import-png")
async def import_single_png(
    file: UploadFile = File(...),
    conflict: str = Form("skip")
):
    """导入单条 PNG 提示词卡片"""
    if conflict not in ("skip", "overwrite", "rename"):
        conflict = "skip"
    file_bytes = await file.read()
    result = import_prompt_from_png(file_bytes, conflict=conflict)
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
