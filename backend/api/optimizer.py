"""
v4.0.0-phase12.2: AI 提示词优化器
- 润色增强 (polish): 补充细节、优化用词、增加参数
- 格式适配 (adapt): SD/Flux/Midjourney/DALL-E 专属格式
- 精简压缩 (compress): 保留核心语义，去掉冗余
- 反向解析 (reverse): 从描述反推提示词
- 流式输出 + 预览对比 + 应用替换
"""
import json, asyncio
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from database import get_db
from ollama_client import (
    ollama_chat, ollama_stream, get_model_for, extract_json
)

router = APIRouter(prefix="/api/ai/optimize", tags=["ai_optimizer"])

# ============ 优化模式定义 ============
OPTIMIZE_MODES = {
    "polish": {
        "name": "润色增强",
        "icon": "✨",
        "desc": "补充细节描述、优化用词、增加技术参数、提升画面感",
        "system": """你是一个世界级AI提示词工程师。请对输入的提示词进行润色增强：

1. 补充缺失的视觉细节（光影/材质/氛围/构图）
2. 优化词汇选择（用更精确、更有画面感的词）
3. 适当添加技术参数（如分辨率前缀、质量后缀）
4. 保持原提示词的核心意图和风格方向不变
5. 如果原文很优秀，只做微小增强即可

返回JSON格式：
{"content": "润色后的完整提示词", "changes": ["改动1说明", "改动2说明"], "score_before": 6, "score_after": 8, "style_preserved": true}"""
    },
    "compress": {
        "name": "精简压缩",
        "icon": "📏",
        "desc": "保留核心语义、去除冗余修饰、精简至最简形式",
        "system": """你是一个AI提示词精炼专家。请对输入的提示词进行精简压缩：

1. 识别并保留最核心的视觉元素和风格定义
2. 去除重复、冗余、弱修饰词
3. 合并相似描述
4. 保持技术参数不变
5. 目标：减少30-50%长度，同时保持画面核心不变

返回JSON格式：
{"content": "精简后的提示词", "changes": ["删减说明"], "original_length": 100, "compressed_length": 60, "core_preserved": true}"""
    },
    "adapt": {
        "name": "格式适配",
        "icon": "🎯",
        "desc": "适配指定平台格式（SD/Flux/Midjourney/DALL-E）",
        "system": ""  # 动态生成
    },
    "reverse": {
        "name": "反向解析",
        "icon": "🔄",
        "desc": "从自然语言描述 / 图片描述 反推生成提示词",
        "system": """你是一个AI提示词逆向工程专家。请从给定的描述中，反向推导出生成该描述的提示词：

1. 提取核心主体、风格、构图元素
2. 补充合理的质量/技术参数后缀
3. 推演出可能使用的专业术语和关键词
4. 输出完整可用的提示词

返回JSON格式：
{"content": "推导出的提示词", "analysis": "分析说明", "confidence": 0.8}"""
    },
}

# 格式适配的模板
FORMAT_TEMPLATES = {
    "sdxl": "你是SDXL提示词专家。请将输入提示词转换为SDXL格式：\n- 使用逗号分隔的自然语言\n- 前部放主体+风格，后部放质量词+负向\n- 适当使用权重语法 (word:1.2)\n返回JSON: {\"content\": \"SDXL格式提示词\", \"negative\": \"建议的负向提示词\"}",
    "flux": "你是Flux提示词专家。请将输入提示词转换为Flux格式：\n- Flux偏好自然语言完整描述\n- 描述性句子优于标签堆叠\n- 保留场景氛围和情感描述\n返回JSON: {\"content\": \"Flux格式提示词\"}",
    "midjourney": "你是Midjourney提示词专家。请将输入提示词转换为MJ格式：\n- 使用 :: 分隔概念块\n- 添加 --ar --style --v 等参数\n- 末尾添加 --q 2 --s 750 等质量参数\n返回JSON: {\"content\": \"MJ格式提示词\", \"parameters\": \"--ar 16:9 --v 6.0\"}",
    "dalle": "你是DALL-E提示词专家。请将输入提示词转换为DALL-E格式：\n- 完整自然语言描述\n- 包含风格/媒介/光线/构图\n- 4000字符限制内尽可能详细\n返回JSON: {\"content\": \"DALL-E格式提示词\"}",
}


# ============ Pydantic Models ============

class OptimizeRequest(BaseModel):
    content: str
    mode: str = "polish"  # polish | compress | adapt | reverse
    target_format: str = ""  # sdxl | flux | midjourney | dalle (mode=adapt时)
    extra_context: str = ""  # 额外上下文（原提示词的模块/场景等）
    prompt_id: int = None  # 关联提示词ID（可选）
    apply: bool = False  # 是否直接应用到提示词


class OptimizeBatchRequest(BaseModel):
    items: list  # [{"content": "...", "id": 1}, ...]
    mode: str = "polish"
    target_format: str = ""


# ============ API ============

@router.get("/modes")
def get_modes():
    """返回所有优化模式"""
    return {
        "ok": True,
        "modes": [
            {"key": k, "name": v["name"], "icon": v["icon"], "desc": v["desc"]}
            for k, v in OPTIMIZE_MODES.items()
        ],
        "formats": [
            {"key": k, "name": {"sdxl":"SDXL","flux":"Flux","midjourney":"Midjourney","dalle":"DALL-E 3"}[k]}
            for k in FORMAT_TEMPLATES
        ]
    }


@router.post("/run")
async def optimize(data: OptimizeRequest):
    """AI 优化单条提示词"""
    mode = data.mode or "polish"
    if mode not in OPTIMIZE_MODES:
        return {"ok": False, "error": f"不支持的优化模式: {mode}"}

    mode_cfg = OPTIMIZE_MODES[mode]

    # 构建消息
    if mode == "adapt":
        fmt = data.target_format or "sdxl"
        if fmt not in FORMAT_TEMPLATES:
            return {"ok": False, "error": f"不支持的目标格式: {fmt}"}
        system = FORMAT_TEMPLATES[fmt]
    else:
        system = mode_cfg["system"]

    user_msg = data.content
    if data.extra_context:
        user_msg = f"上下文: {data.extra_context}\n\n提示词:\n{data.content}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg}
    ]

    result = await ollama_chat(
        messages=messages, function="optimize",
        temperature=0.3, max_tokens=4096, timeout_s=180
    )

    if not result.get("ok"):
        return {"ok": False, "error": result.get("error"), "model": result.get("model", "")}

    # 尝试解析 JSON
    structured = extract_json(result["content"])
    optimized_content = structured.get("content", "") if structured else result["content"]

    # 格式化输出
    response = {
        "ok": True,
        "mode": mode,
        "original": data.content,
        "optimized": optimized_content,
        "raw": result["content"],
        "model": result.get("model", ""),
        "usage": result.get("usage", {}),
        "structured": structured if structured else None,
    }

    # 如果要求应用到提示词
    if data.apply and data.prompt_id and optimized_content:
        apply_result = _apply_optimization(data.prompt_id, optimized_content, mode)
        response["applied"] = apply_result

    return response


@router.post("/stream")
async def optimize_stream(request: Request):
    """流式优化 — SSE 输出"""
    body = await request.json()
    mode = body.get("mode", "polish")
    content = body.get("content", "")
    target_format = body.get("target_format", "")
    extra_context = body.get("extra_context", "")

    if mode not in OPTIMIZE_MODES:
        async def _err():
            yield json.dumps({"error": f"不支持的优化模式: {mode}"}) + "\n"
        return StreamingResponse(_err(), media_type="text/event-stream")

    mode_cfg = OPTIMIZE_MODES[mode]
    if mode == "adapt":
        fmt = target_format or "sdxl"
        if fmt not in FORMAT_TEMPLATES:
            async def _err2():
                yield json.dumps({"error": f"不支持的目标格式: {fmt}"}) + "\n"
            return StreamingResponse(_err2(), media_type="text/event-stream")
        system = FORMAT_TEMPLATES[fmt]
    else:
        system = mode_cfg["system"]

    user_msg = content
    if extra_context:
        user_msg = f"上下文: {extra_context}\n\n提示词:\n{content}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg}
    ]

    async def _stream():
        async for line in ollama_stream(
            messages=messages, function="optimize",
            temperature=0.3, max_tokens=4096, timeout_s=300
        ):
            yield line

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.post("/batch")
async def optimize_batch(data: OptimizeBatchRequest):
    """批量优化"""
    import asyncio

    if not data.items or len(data.items) == 0:
        return {"ok": False, "error": "请提供待优化的提示词"}
    if len(data.items) > 10:
        return {"ok": False, "error": "单次最多10条"}

    sem = asyncio.Semaphore(3)
    mode = data.mode or "polish"
    mode_cfg = OPTIMIZE_MODES.get(mode)
    if not mode_cfg:
        return {"ok": False, "error": f"不支持的优化模式: {mode}"}

    async def _optimize_one(item):
        async with sem:
            try:
                c = item.get("content", "")
                if not c:
                    return {"id": item.get("id"), "ok": False, "error": "空内容"}

                if mode == "adapt":
                    system = FORMAT_TEMPLATES.get(data.target_format or "sdxl", FORMAT_TEMPLATES["sdxl"])
                else:
                    system = mode_cfg["system"]

                messages = [
                    {"role": "system", "content": system},
                    {"role": "user", "content": c}
                ]

                result = await ollama_chat(
                    messages=messages, function="optimize",
                    temperature=0.3, max_tokens=4096, timeout_s=180
                )

                if not result.get("ok"):
                    return {"id": item.get("id"), "ok": False, "error": result.get("error", "")}

                structured = extract_json(result["content"])
                opt = structured.get("content", "") if structured else result["content"]

                # 如果有关联ID，应用
                if item.get("id") and opt:
                    apply_result = _apply_optimization(item["id"], opt, mode)
                    return {"id": item["id"], "ok": True, "optimized": opt, "applied": apply_result}

                return {"id": item.get("id"), "ok": True, "optimized": opt}
            except Exception as e:
                return {"id": item.get("id"), "ok": False, "error": str(e)[:200]}

    tasks = [_optimize_one(item) for item in data.items]
    results = await asyncio.gather(*tasks)
    success = [r for r in results if r.get("ok")]
    failed = [r for r in results if not r.get("ok")]

    return {
        "ok": True, "mode": mode,
        "total": len(data.items), "success": len(success), "failed": len(failed),
        "results": results,
    }


# ============ 辅助函数 ============

def _apply_optimization(prompt_id: int, optimized_content: str, mode: str) -> dict:
    """
    将优化结果应用到提示词（创建新版本记录）
    策略：不直接覆盖，而是创建版本记录，用户可以回滚
    """
    from database import get_db, safe_commit
    db = get_db()

    # 检查提示词存在
    row = db.execute("SELECT id, content FROM prompts WHERE id=?", [prompt_id]).fetchone()
    if not row:
        return {"ok": False, "error": "提示词不存在"}

    old_content = row["content"]

    # 确保版本表存在
    db.execute("""
        CREATE TABLE IF NOT EXISTS prompt_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            version_tag TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # 保存旧版本
    db.execute(
        "INSERT INTO prompt_versions (prompt_id, content, version_tag) VALUES (?, ?, ?)",
        [prompt_id, old_content, f"AI优化前_{mode}"]
    )

    # 更新为新内容
    db.execute("UPDATE prompts SET content=? WHERE id=?", [optimized_content, prompt_id])
    safe_commit()

    # 更新语义搜索向量
    try:
        from semantic import update_embedding
        update_embedding(prompt_id, optimized_content)
    except Exception:
        pass

    return {
        "ok": True,
        "prompt_id": prompt_id,
        "version_saved": True,
        "mode": mode
    }
