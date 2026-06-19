"""
v4.0.0-phase12.3: AI 自动标签 & 分类
- 分析提示词内容，自动生成: 标签、模块、场景、释义
- 新建/编辑词条时一键自动填充元数据
- 支持批量分析
"""
import json, asyncio
from fastapi import APIRouter
from pydantic import BaseModel
from database import get_db
from ollama_client import ollama_chat, extract_json, get_model_for

router = APIRouter(prefix="/api/ai/auto-tag", tags=["auto_tag"])

# ============ 现有模块/标签上下文 ============

SYSTEM_PROMPT = """你是AI提示词分析专家。请分析输入的提示词，输出结构化的元数据。

模块选择规则：
- emotion: 情绪/表情/氛围/情感表达
- color: 色彩/配色/色调/光影
- tone: 色调风格/整体调性
- composition: 构图/景别/视角/空间
- seedance: 视频/动画/运镜/动态
- custom: 其他/综合

标签选择：从提供的候选标签列表中选择最多5个最匹配的，也可加入新标签。

返回严格JSON:
{"module": "emotion", "category": "最合适的二级分类(3-8字)", "tags": ["标签1", "标签2"], "meaning": "一句话中文释义(20-50字)", "scene": "适用场景说明(10-30字)", "confidence": 0.85}"""


def _get_existing_tags() -> list:
    """获取数据库中所有已有标签"""
    db = get_db()
    rows = db.execute("SELECT tags FROM prompts WHERE tags != '' AND tags != '[]'").fetchall()
    all_tags = set()
    for r in rows:
        try:
            tags = json.loads(r["tags"]) if isinstance(r["tags"], str) else (r["tags"] or [])
            for t in tags:
                if t and t.strip():
                    all_tags.add(t.strip())
        except Exception:
            pass
    return sorted(all_tags)[:100]


def _get_existing_modules() -> list:
    """获取所有模块"""
    db = get_db()
    rows = db.execute("SELECT DISTINCT module FROM prompts WHERE module != '' ORDER BY module").fetchall()
    return [r["module"] for r in rows]


# ============ Pydantic Models ============

class AutoTagRequest(BaseModel):
    content: str
    extra_hints: str = ""  # 用户可额外提示

class AutoTagBatchRequest(BaseModel):
    items: list  # [{"content": "...", "id": 1}, ...]

class ApplyRequest(BaseModel):
    prompt_id: int
    module: str = ""
    category: str = ""
    tags: list = []
    meaning: str = ""
    scene: str = ""


# ============ API ============

@router.get("/context")
def get_context():
    """获取标签分析上下文"""
    return {
        "ok": True,
        "modules": _get_existing_modules(),
        "existing_tags": _get_existing_tags(),
        "module_rules": {
            "emotion": "情绪/表情/氛围/情感表达",
            "color": "色彩/配色/色调/光影",
            "tone": "色调风格/整体调性",
            "composition": "构图/景别/视角/空间",
            "seedance": "视频/动画/运镜/动态",
            "custom": "其他/综合",
        }
    }


@router.post("/analyze")
async def analyze(data: AutoTagRequest):
    """分析单条提示词，返回推荐元数据"""
    if not data.content or not data.content.strip():
        return {"ok": False, "error": "提示词内容为空"}

    existing_tags = _get_existing_tags()
    modules = _get_existing_modules()

    user_msg = data.content[:2000]
    if data.extra_hints:
        user_msg = f"额外提示: {data.extra_hints}\n\n提示词:\n{data.content[:2000]}"

    # 补充上下文
    context = f"现有模块: {', '.join(modules[:10])}\n候选标签前30: {', '.join(existing_tags[:30])}\n\n{user_msg}"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": context}
    ]

    result = await ollama_chat(
        messages=messages, function="auto_tag",
        temperature=0.1, max_tokens=1024, timeout_s=60
    )

    if not result.get("ok"):
        return {"ok": False, "error": result.get("error", "分析失败"), "model": result.get("model", "")}

    structured = extract_json(result["content"])
    if not structured:
        # 尝试从原始文本提取
        return {
            "ok": True,
            "analysis": result["content"],
            "raw": True,
            "model": result.get("model", ""),
            "note": "无法解析JSON，请手动选择"
        }

    return {
        "ok": True,
        "module": structured.get("module", "custom"),
        "category": structured.get("category", ""),
        "tags": structured.get("tags", []),
        "meaning": structured.get("meaning", ""),
        "scene": structured.get("scene", ""),
        "confidence": structured.get("confidence", 0.5),
        "model": result.get("model", ""),
        "raw": result["content"]
    }


@router.post("/batch")
async def analyze_batch(data: AutoTagBatchRequest):
    """批量分析（最多20条）"""
    if not data.items or len(data.items) == 0:
        return {"ok": False, "error": "请提供待分析内容"}
    if len(data.items) > 20:
        return {"ok": False, "error": "单次最多20条"}

    sem = asyncio.Semaphore(4)
    existing_tags = _get_existing_tags()
    modules = _get_existing_modules()
    context_prefix = f"现有模块: {', '.join(modules[:10])}\n候选标签: {', '.join(existing_tags[:30])}\n\n"

    async def _analyze_one(item):
        async with sem:
            try:
                c = item.get("content", "").strip()
                if not c:
                    return {"id": item.get("id"), "ok": False, "error": "空内容"}

                messages = [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"{context_prefix}{c[:1500]}"}
                ]

                result = await ollama_chat(
                    messages=messages, function="auto_tag",
                    temperature=0.1, max_tokens=1024, timeout_s=60
                )

                if not result.get("ok"):
                    return {"id": item.get("id"), "ok": False, "error": result.get("error", "")}

                structured = extract_json(result["content"])
                if structured:
                    # 自动应用到数据库
                    if item.get("id"):
                        db = get_db()
                        updates = []
                        params = []
                        for field in ["module", "category", "meaning", "scene"]:
                            if structured.get(field):
                                updates.append(f"{field}=?")
                                params.append(structured[field])
                        if structured.get("tags"):
                            updates.append("tags=?")
                            params.append(json.dumps(structured["tags"], ensure_ascii=False))
                        if updates:
                            params.append(item["id"])
                            db.execute(f"UPDATE prompts SET {', '.join(updates)} WHERE id=?", params)
                            db.commit()

                    return {
                        "id": item.get("id"), "ok": True,
                        "module": structured.get("module", ""),
                        "category": structured.get("category", ""),
                        "tags": structured.get("tags", []),
                        "meaning": structured.get("meaning", ""),
                        "scene": structured.get("scene", ""),
                    }
                return {"id": item.get("id"), "ok": True, "raw": True, "analysis": result["content"]}
            except Exception as e:
                return {"id": item.get("id"), "ok": False, "error": str(e)[:200]}

    tasks = [_analyze_one(item) for item in data.items]
    results = await asyncio.gather(*tasks)
    success = [r for r in results if r.get("ok")]
    failed = [r for r in results if not r.get("ok")]

    return {
        "ok": True, "total": len(data.items),
        "success": len(success), "failed": len(failed),
        "results": results,
    }


@router.post("/apply")
def apply_auto_tag(data: ApplyRequest):
    """手动应用标签到指定提示词"""
    db = get_db()
    row = db.execute("SELECT id FROM prompts WHERE id=?", [data.prompt_id]).fetchone()
    if not row:
        return {"ok": False, "error": "提示词不存在"}

    updates = []
    params = []
    if data.module:
        updates.append("module=?")
        params.append(data.module)
    if data.category:
        updates.append("category=?")
        params.append(data.category)
    if data.tags:
        updates.append("tags=?")
        params.append(json.dumps(data.tags, ensure_ascii=False))
    if data.meaning:
        updates.append("meaning=?")
        params.append(data.meaning)
    if data.scene:
        updates.append("scene=?")
        params.append(data.scene)

    if updates:
        params.append(data.prompt_id)
        db.execute(f"UPDATE prompts SET {', '.join(updates)} WHERE id=?", params)
        db.commit()
        return {"ok": True, "prompt_id": data.prompt_id, "updated_fields": [u.split("=")[0] for u in updates]}
    return {"ok": False, "error": "无更新内容"}
