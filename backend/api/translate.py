"""
v4.0.0-phase12.1: 翻译引擎升级
- 模型升级: phi3:mini → qwen3.5:9b (自动路由)
- 新增: 批量翻译 API + 翻译质量评估
- 新增: 翻译列表管理 + 缓存清除
- 统一 ollama_client 调用
"""
import json, re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_db
from ollama_client import ollama_generate, get_server_url, get_model_for, save_ollama_config

router = APIRouter(prefix="/api/translate", tags=["translate"])

# ============ Prompt 模板 ============
TRANSLATE_ZH_SYSTEM = """你是一个专业的AI提示词翻译专家。请将输入的英文/中文提示词翻译为目标语言。

翻译规则：
1. 保持AI提示词的专业术语和参数不变（如 aspect ratio, seed, CFG scale 等）
2. 摄影/绘画术语使用行业标准译法（如 cinematic lighting → 电影感布光）
3. 技术参数数值保持原样
4. 只输出翻译结果，不要添加任何解释或前缀
5. 如果输入已是目标语言，原样返回"""

QUALITY_SYSTEM = """你是一个翻译质量评估专家。请对比原文和译文，从以下维度评分(1-10)：
1. 准确性 (Accuracy): 术语是否正确翻译
2. 流畅性 (Fluency): 是否自然通顺
3. 完整性 (Completeness): 是否有遗漏
只返回JSON: {"accuracy": 8, "fluency": 9, "completeness": 10, "overall": 9, "comment": "一句话评语"}"""


def _init_table():
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_id INTEGER NOT NULL,
            lang TEXT NOT NULL DEFAULT 'zh',
            content TEXT NOT NULL DEFAULT '',
            quality_score REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(prompt_id, lang)
        )
    """)
    # 兼容旧表：补 quality_score 列
    try:
        db.execute("ALTER TABLE translations ADD COLUMN quality_score REAL DEFAULT 0")
    except Exception:
        pass
    db.commit()


_init_table()


# ============ Pydantic Models ============

class ConfigUpdate(BaseModel):
    server_url: str = ""
    model: str = ""
    translate_model: str = ""  # 翻译专用模型

class BatchTranslateRequest(BaseModel):
    prompt_ids: list  # [1, 2, 3, ...]
    target_lang: str = ""  # "" = auto-detect, "zh" = force, "en" = force
    quality_check: bool = False  # 是否评估质量

class QualityRequest(BaseModel):
    prompt_id: int
    lang: str = "zh"


# ============ API ============

@router.get("/config")
def get_config():
    """获取翻译配置"""
    from ollama_client import get_ollama_config
    cfg = get_ollama_config()
    return {
        "ok": True,
        "config": {
            "server_url": cfg.get("server_url", "http://127.0.0.1:11434"),
            "model": cfg.get("translate_model") or get_model_for("translate"),
            "fast_model": get_model_for("translate_fast"),
            "available_models": [get_model_for("translate"), get_model_for("translate_fast")],
        }
    }


@router.post("/config")
def update_config(data: ConfigUpdate):
    """更新翻译配置"""
    from ollama_client import get_ollama_config
    cfg = get_ollama_config()
    if data.server_url:
        cfg["server_url"] = data.server_url
    if data.translate_model:
        cfg["translate_model"] = data.translate_model
    elif data.model:
        cfg["translate_model"] = data.model
    save_ollama_config(cfg)
    return {"ok": True, "model": cfg.get("translate_model") or get_model_for("translate")}


@router.get("/{prompt_id}")
async def translate_single(prompt_id: int, target_lang: str = "zh"):
    """翻译单条提示词（兼容 prompts 和 word_card 两表）— Ollama 调用期间不持 DB 锁"""
    import sqlite3, os
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'prompts.db')

    # 第一步：读原文 + 查缓存（短连接，立即释放）
    conn = sqlite3.connect(db_path, timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT id, content FROM word_card WHERE id=? AND is_deleted=0", [prompt_id]).fetchone()
        table = "word_card"
        if not row:
            row = conn.execute("SELECT id, content FROM prompts WHERE id=?", [prompt_id]).fetchone()
            table = "prompts"
        if not row:
            raise HTTPException(404, "提示词不存在")

        original = row["content"]
        if not original or not original.strip():
            raise HTTPException(400, "提示词内容为空")

        if target_lang not in ("zh", "en"):
            raise HTTPException(400, "仅支持 zh/en")

        # 查缓存
        cache = conn.execute(
            "SELECT content, quality_score, created_at FROM translations WHERE prompt_id=? AND lang=?",
            [prompt_id, target_lang]
        ).fetchone()
    finally:
        conn.close()

    if cache:
        # 缓存命中 → 确保词卡双语字段已同步（可能因历史原因缺失）
        col = f"content_{target_lang}"
        if table == "word_card":
            try:
                _conn = sqlite3.connect(db_path, timeout=3)
                _conn.execute(f"UPDATE word_card SET {col}=? WHERE id=? AND ({col}='' OR {col} IS NULL)", [cache["content"], prompt_id])
                _conn.commit()
                _conn.close()
            except:
                pass
        return {
            "ok": True, "prompt_id": prompt_id, "original": original,
            "translated": cache["content"], "lang": target_lang,
            "cached": True, "quality_score": cache["quality_score"],
            "created_at": cache["created_at"]
        }

    # 语言检测
    has_cn = bool(re.search(r'[\u4e00-\u9fff]', original))
    if (has_cn and target_lang == "zh") or (not has_cn and target_lang == "en"):
        return {"ok": True, "prompt_id": prompt_id, "original": original,
                "translated": original, "lang": target_lang, "cached": False,
                "note": "原文已是目标语言"}

    # 第二步：调 Ollama（不持 DB 连接）
    direction = "中文" if target_lang == "zh" else "英文"
    prompt = f"请将以下AI提示词翻译成{direction}：\n\n{original}"

    model = get_model_for("translate")
    result = await ollama_generate(
        prompt=prompt, system=TRANSLATE_ZH_SYSTEM,
        model=model, temperature=0.1, max_tokens=4096, timeout_s=120
    )

    if not result.get("ok"):
        return {"ok": False, "error": result.get("error", "翻译失败"), "model": model}

    translated = result["content"]
    if not translated:
        return {"ok": False, "error": "Ollama 返回空结果"}

    # 第三步：写缓存 + 写回词卡（独立短连接）
    conn2 = None
    try:
        conn2 = sqlite3.connect(db_path, timeout=10)
        conn2.execute("PRAGMA busy_timeout=5000")
        conn2.execute(
            "INSERT OR REPLACE INTO translations (prompt_id, lang, content, quality_score, created_at) VALUES (?, ?, ?, 0, datetime('now','localtime'))",
            [prompt_id, target_lang, translated]
        )
        # 写回词卡双语字段（content_en 或 content_zh）
        col = f"content_{target_lang}"
        if table == "word_card":
            conn2.execute(f"UPDATE word_card SET {col}=? WHERE id=?", [translated, prompt_id])
        conn2.commit()
    except sqlite3.Error as e:
        pass
    finally:
        if conn2:
            try: conn2.close()
            except: pass

    # 同时返回双向内容供前端语言切换
    other_lang = "en" if target_lang == "zh" else "zh"
    other_trans = None
    if table == "word_card":
        try:
            other_col = f"content_{other_lang}"
            conn3 = sqlite3.connect(db_path, timeout=3)
            conn3.row_factory = sqlite3.Row
            ow = conn3.execute(f"SELECT {other_col} FROM word_card WHERE id=?", [prompt_id]).fetchone()
            conn3.close()
            if ow and ow[other_col]:
                other_trans = ow[other_col]
        except:
            pass

    return {
        "ok": True, "prompt_id": prompt_id, "original": original,
        "translated": translated, "lang": target_lang, "cached": False,
        "model": result.get("model", model),
        "usage": result.get("usage", {}),
        "content_zh": translated if target_lang == "zh" else (other_trans or ''),
        "content_en": translated if target_lang == "en" else (other_trans or ''),
    }


@router.post("/batch")
async def translate_batch(data: BatchTranslateRequest):
    """
    批量翻译 — 并发自动检测语言方向（中文→英文, 英文→中文）
    - prompt_ids: 提示词ID列表
    - target_lang: 固定目标语言（可选, 不传则自动检测）
    """
    import asyncio, sqlite3, os

    if not data.prompt_ids or len(data.prompt_ids) == 0:
        return {"ok": False, "error": "请提供待翻译的提示词ID列表"}

    if len(data.prompt_ids) > 20:
        return {"ok": False, "error": "单次最多20条"}

    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'prompts.db')
    force_lang = data.target_lang if data.target_lang else None  # empty string = auto-detect

    # 串行翻译 + 空结果自动重试（qwen3.5:9b 并发时偶发空返回）
    sem = asyncio.Semaphore(1)
    _retried = {}

    async def _translate_one(pid: int):
        async with sem:
            try:
                # 独立短连接读原文
                conn = sqlite3.connect(db_path, timeout=5)
                conn.row_factory = sqlite3.Row
                row = conn.execute("SELECT id, content FROM word_card WHERE id=? AND is_deleted=0", [pid]).fetchone()
                table = "word_card"
                if not row:
                    row = conn.execute("SELECT id, content FROM prompts WHERE id=?", [pid]).fetchone()
                    table = "prompts"
                conn.close()

                if not row or not row["content"]:
                    return {"prompt_id": pid, "ok": False, "error": "提示词不存在或为空"}

                original = row["content"]

                # 自动检测语言方向
                has_cn = bool(re.search(r'[\u4e00-\u9fff]', original))
                if force_lang:
                    target_lang = force_lang
                else:
                    target_lang = "en" if has_cn else "zh"

                # 已是目标语言则跳过
                if (has_cn and target_lang == "zh") or (not has_cn and target_lang == "en"):
                    return {"prompt_id": pid, "ok": True, "translated": original, "cached": False, "note": "已是目标语言", "direction": "zh→zh" if has_cn else "en→en"}

                # 查缓存（独立连接）
                conn2 = sqlite3.connect(db_path, timeout=3)
                conn2.row_factory = sqlite3.Row
                cache = conn2.execute(
                    "SELECT content FROM translations WHERE prompt_id=? AND lang=?",
                    [pid, target_lang]
                ).fetchone()
                conn2.close()

                if cache:
                    return {"prompt_id": pid, "ok": True, "translated": cache["content"], "cached": True, "direction": ("zh→en" if target_lang == "en" else "en→zh")}

                # 调 Ollama（不持 DB 连接）
                direction = "中文" if target_lang == "zh" else "英文"
                prompt = f"请将以下AI提示词翻译成{direction}：\n\n{original}"

                model = get_model_for("translate")
                result = await ollama_generate(
                    prompt=prompt, system=TRANSLATE_ZH_SYSTEM,
                    model=model, temperature=0.1, max_tokens=2048, timeout_s=120
                )

                if not result.get("ok"):
                    return {"prompt_id": pid, "ok": False, "error": result.get("error", "翻译失败"), "direction": ("zh→en" if target_lang == "en" else "en→zh")}

                translated = result["content"]
                if not translated:
                    # qwen3.5:9b 偶发空返回，重试一次（提高 temperature 增加随机性）
                    if pid not in _retried:
                        _retried[pid] = True
                        await asyncio.sleep(1.5)
                        result2 = await ollama_generate(
                            prompt=prompt, system=TRANSLATE_ZH_SYSTEM,
                            model=model, temperature=0.4, max_tokens=2048, timeout_s=120
                        )
                        if result2.get("ok") and result2.get("content"):
                            translated = result2["content"]
                        else:
                            return {"prompt_id": pid, "ok": False, "error": "Ollama 返回空结果（已重试）", "direction": ("zh→en" if target_lang == "en" else "en→zh")}
                    else:
                        return {"prompt_id": pid, "ok": False, "error": "Ollama 返回空结果", "direction": ("zh→en" if target_lang == "en" else "en→zh")}

                # 写缓存 + 写回词卡（独立连接）
                conn3 = sqlite3.connect(db_path, timeout=10)
                try:
                    conn3.execute("PRAGMA busy_timeout=5000")
                    conn3.execute(
                        "INSERT OR REPLACE INTO translations (prompt_id, lang, content, quality_score, created_at) VALUES (?, ?, ?, 0, datetime('now','localtime'))",
                        [pid, target_lang, translated]
                    )
                    col = f"content_{target_lang}"
                    if table == "word_card":
                        conn3.execute(f"UPDATE word_card SET {col}=? WHERE id=?", [translated, pid])
                    conn3.commit()
                except sqlite3.Error:
                    pass
                finally:
                    try: conn3.close()
                    except: pass

                return {"prompt_id": pid, "ok": True, "translated": translated, "model": model, "direction": ("zh→en" if target_lang == "en" else "en→zh")}
            except Exception as e:
                return {"prompt_id": pid, "ok": False, "error": str(e)[:200]}

    tasks = [_translate_one(pid) for pid in data.prompt_ids]
    results = await asyncio.gather(*tasks)

    success = [r for r in results if r.get("ok")]
    failed = [r for r in results if not r.get("ok")]

    return {
        "ok": True,
        "total": len(data.prompt_ids),
        "success": len(success),
        "failed": len(failed),
        "cached": sum(1 for r in success if r.get("cached")),
        "auto_detect": not force_lang,
        "results": results,
    }


@router.post("/quality")
async def assess_quality(data: QualityRequest):
    """评估翻译质量（1-10分）"""
    db = get_db()
    prompt_row = db.execute("SELECT content FROM prompts WHERE id=?", [data.prompt_id]).fetchone()
    trans_row = db.execute(
        "SELECT content FROM translations WHERE prompt_id=? AND lang=?",
        [data.prompt_id, data.lang]
    ).fetchone()

    if not prompt_row or not trans_row:
        raise HTTPException(404, "原文或翻译不存在")

    prompt_text = f"""原文:
{prompt_row['content'][:1000]}

译文:
{trans_row['content'][:1000]}"""

    result = await ollama_generate(
        prompt=prompt_text, system=QUALITY_SYSTEM,
        function="auto_tag", temperature=0.0, max_tokens=256, timeout_s=30
    )

    if not result.get("ok"):
        return {"ok": False, "error": result.get("error")}

    from ollama_client import extract_json
    scores = extract_json(result["content"])
    if scores:
        score = scores.get("overall", 0)
        db.execute("UPDATE translations SET quality_score=? WHERE prompt_id=? AND lang=?", [score, data.prompt_id, data.lang])
        db.commit()
        return {"ok": True, "prompt_id": data.prompt_id, "lang": data.lang, "scores": scores}

    return {"ok": False, "error": "无法解析质量评估结果", "raw": result["content"][:200]}


@router.get("/list/all")
def list_translations(page: int = 1, page_size: int = 50):
    """列出所有翻译记录"""
    db = get_db()
    offset = (page - 1) * page_size
    total = db.execute("SELECT COUNT(*) as c FROM translations").fetchone()["c"]
    rows = db.execute("""
        SELECT t.*, p.content as original_content
        FROM translations t
        LEFT JOIN prompts p ON t.prompt_id = p.id
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?
    """, [page_size, offset]).fetchall()
    return {
        "ok": True, "total": total, "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows]
    }


@router.post("/clear-cache")
def clear_translation_cache(prompt_id: int = None):
    """清除翻译缓存"""
    db = get_db()
    if prompt_id:
        db.execute("DELETE FROM translations WHERE prompt_id=?", [prompt_id])
        msg = f"已清除提示词 {prompt_id} 的翻译缓存"
    else:
        db.execute("DELETE FROM translations")
        msg = "已清除所有翻译缓存"
    db.commit()
    return {"ok": True, "message": msg}
