"""
批量 OCR 导入 — 从截图/图片识别提示词文本
"""
import os, io, uuid, json, tempfile, subprocess
from fastapi import APIRouter, UploadFile, File, Form
from database import get_db, safe_commit

router = APIRouter(prefix="/api/v2/ocr", tags=["ocr"])


def _tesseract_available():
    """检测 tesseract 是否可用"""
    try:
        import pytesseract
        # 尝试调用 tesseract --version
        subprocess.run(["tesseract", "--version"], capture_output=True, timeout=5)
        return True
    except Exception:
        return False


@router.post("/extract")
async def ocr_extract(file: UploadFile = File(...)):
    """从图片中提取文本"""
    if not _tesseract_available():
        return {
            "ok": False,
            "error": "Tesseract OCR 未安装。请先安装: https://github.com/UB-Mannheim/tesseract/wiki",
            "solution": "下载安装后，确保 tesseract.exe 在 PATH 中"
        }
    
    file_bytes = await file.read()
    if not file_bytes:
        return {"ok": False, "error": "文件为空"}
    
    try:
        from PIL import Image
        import pytesseract
        
        img = Image.open(io.BytesIO(file_bytes))
        
        # 尝试中文+英文识别
        try:
            text = pytesseract.image_to_string(img, lang='chi_sim+eng')
        except Exception:
            # 回退到纯英文
            text = pytesseract.image_to_string(img, lang='eng')
        
        text = text.strip()
        if not text:
            return {"ok": True, "text": "", "message": "未识别到文字"}
        
        return {"ok": True, "text": text, "lines": len(text.split('\n'))}
    
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/import")
async def ocr_import(
    file: UploadFile = File(...),
    module: str = Form("custom"),
    category: str = Form("OCR导入"),
    conflict: str = Form("rename")
):
    """OCR 识别图片并直接导入为提示词"""
    if not _tesseract_available():
        return {
            "ok": False,
            "error": "Tesseract OCR 未安装。请先安装: https://github.com/UB-Mannheim/tesseract/wiki"
        }
    
    file_bytes = await file.read()
    if not file_bytes:
        return {"ok": False, "error": "文件为空"}
    
    try:
        from PIL import Image
        import pytesseract
        
        img = Image.open(io.BytesIO(file_bytes))
        try:
            text = pytesseract.image_to_string(img, lang='chi_sim+eng')
        except Exception:
            text = pytesseract.image_to_string(img, lang='eng')
        
        text = text.strip()
        if not text:
            return {"ok": False, "error": "未识别到文字"}
        
        # 导入到数据库
        db = get_db()
        
        # 冲突检测
        existing = db.execute("SELECT id FROM prompts WHERE content=?", [text]).fetchone()
        created = False
        prompt_id = None
        
        if existing:
            if conflict == "skip":
                return {"ok": True, "created": False, "reason": "skip", "existing_id": existing["id"]}
            elif conflict == "rename":
                text = text + " (OCR " + uuid.uuid4().hex[:4] + ")"
        
        db.execute(
            "INSERT INTO prompts (module, category, content, meaning, scene, tags, is_builtin) "
            "VALUES (?, ?, ?, ?, ?, ?, 0)",
            [module, category, text, "OCR 识别导入", "", json.dumps(["OCR"]), 0]
        )
        db.commit()
        prompt_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        
        return {
            "ok": True,
            "created": True,
            "id": prompt_id,
            "content_preview": text[:80],
            "text_length": len(text)
        }
    
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/check")
def check_ocr():
    """检查 OCR 引擎状态"""
    available = _tesseract_available()
    return {
        "ok": True,
        "tesseract_available": available,
        "message": "OCR 引擎就绪" if available else "未安装 Tesseract"
    }
