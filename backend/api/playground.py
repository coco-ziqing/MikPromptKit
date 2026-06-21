"""
v4.2.2-phase15: Playground 深度升级
- 目标模型预设 (SD1.5/SDXL/Flux/Midjourney/ComfyUI+LoRA/Seedance/Hunyuan/Kling)
- 优化方向 (格式转换/细节增强/精简压缩/负面提词/质量分析/多语言翻译/风格迁移/批量变体)
- 智能 system prompt 模板引擎
- 一键保存到词卡库
"""
import json, time, hashlib
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from database import get_db
from ollama_client import ollama_chat, ollama_stream, get_model_for, get_server_url

router = APIRouter(prefix="/api/playground", tags=["playground"])

# ============ 配置 ============

DEFAULT_CONFIG = {
    "provider": "ollama",
    "ollama_url": "http://localhost:11434",
    "ollama_model": "qwen3.5:9b",
    "openai_url": "https://api.openai.com/v1",
    "openai_key": "",
    "openai_model": "gpt-4o-mini",
    "temperature": 0.7,
    "max_tokens": 2048,
    "system_prompt": "",
    "compare_models": ["qwen3.5:9b", "qwen3.6:27b"],  # 对比模式默认模型
}


def _get_config() -> dict:
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='playground_config'").fetchone()
    if row:
        try:
            cfg = json.loads(row["value"])
            for k, v in DEFAULT_CONFIG.items():
                if k not in cfg:
                    cfg[k] = v
            return cfg
        except Exception:
            pass
    return dict(DEFAULT_CONFIG)


def _save_config(cfg: dict):
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('playground_config', ?)",
        [json.dumps(cfg, ensure_ascii=False)]
    )
    db.commit()


# ============ 对话历史（内存存储） ============
# session_id → [{role, content, time}, ...]
_conversations: dict = {}
_MAX_HISTORY = 50


def _init_conversation_table():
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS playground_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL DEFAULT 'default',
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            model TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    db.commit()


_init_conversation_table()


# ============ Models ============

class ConfigUpdate(BaseModel):
    config: dict

class TestRequest(BaseModel):
    prompt: str
    provider: str = None
    model: str = None
    temperature: float = None
    max_tokens: int = None
    system_prompt: str = None
    session_id: str = "default"

class CompareRequest(BaseModel):
    prompt: str
    models: list = []
    temperature: float = 0.7
    max_tokens: int = 2048
    system_prompt: str = ""

class OptimizeRequest(BaseModel):
    prompt: str
    target_model: str = "flux"      # 预设 key
    direction: str = "convert"      # 优化方向 key
    custom_instruction: str = ""    # 用户补充指令
    provider: str = None
    model: str = None
    temperature: float = None
    save_to_library: bool = False    # 是否自动保存到词卡库
    group_id: int = None             # 保存到哪个分组


# ================================================================
# 模型预设 + 优化方向 模板引擎 (Phase15)
# ================================================================

MODEL_PRESETS = {
    "sd15": {
        "name": "Stable Diffusion 1.5",
        "icon": "🎨",
        "family": "sd",
        "format": "逗号分隔关键词堆叠，用 (tag:weight) 调权重，质量词前置",
        "tips": ["用逗号分隔而非自然语言", "质量词放在最前面", "用 (keyword:1.2) 语法调权重", "添加 masterpiece, high quality 等质量词"],
        "system_prompt": """你是 Stable Diffusion 1.5 提示词优化专家。SD1.5 使用逗号分隔的 Danbooru 风格标签系统。

规则:
- 输出必须是逗号分隔的英文标签，不是自然语言句子
- 质量词放在最前面: masterpiece, best quality, high resolution
- 用括号调权重: (keyword:1.2) 表示增强, (keyword:0.8) 表示减弱
- 人物描述顺序: 主体→面部→发型→服装→姿态→背景
- 风格标签用简短词汇: anime, photorealistic, oil painting
- 避免超过 80 个标签，太长会稀释效果
- 如果有负面提示词需求，单独输出在 ===negative=== 之后""",
        "example_raw": "a beautiful girl standing in a flower field during sunset with warm lighting and cinematic composition",
        "example_optimized": "masterpiece, best quality, high resolution, 1girl, solo, beautiful, detailed eyes, long hair, flowing dress, standing, flower field, sunset, warm lighting, golden hour, cinematic composition, depth of field, bokeh, nature, outdoors"
    },
    "sdxl": {
        "name": "SDXL",
        "icon": "🖼️",
        "family": "sd",
        "format": "自然语言+关键词混合，长文本支持好，可用完整句子描述",
        "tips": ["可以用完整句子描述场景", "质量词 + 风格词 + 具体细节", "SDXL 能理解空间关系和光照描述", "支持更长更详细的 prompt"],
        "system_prompt": """你是 SDXL 提示词优化专家。SDXL 支持自然语言和标签混合。

规则:
- 可以用完整英文句子描述场景，会更好理解构图关系
- 开头加质量词: masterpiece, best quality, highly detailed
- 详细描述光照、构图、情绪氛围，SDXL 对这些敏感
- 风格词如 cinematic lighting, professional photography, 8k 效果显著
- 建议 50-150 词，太短缺少细节，太长可能冲突
- 用 BREAK 分隔不同区域（可选）
- 如果有负面提示词需求，单独输出在 ===negative=== 之后""",
        "example_raw": "a beautiful girl standing in a flower field during sunset",
        "example_optimized": "masterpiece, best quality, highly detailed, a beautiful young woman with flowing auburn hair standing gracefully in a vast lavender flower field, golden hour sunset casting warm amber light across the scene, soft breeze gently moving her dress and flowers, cinematic composition with shallow depth of field, professional photography, 8k resolution, vibrant colors, dreamy atmosphere"
    },
    "flux": {
        "name": "Flux",
        "icon": "⚡",
        "family": "flux",
        "format": "自然语言描述为主，Claude/ChatGPT 风格的长文本，支持复杂场景",
        "tips": ["用自然段落描述而非标签", "描述空间关系: 前景/中景/背景", "详细描述材质和纹理", "光线和阴影描述越具体越好"],
        "system_prompt": """你是 Flux 提示词优化专家。Flux 偏好自然语言长文本描述，类似 ChatGPT 风格。

规则:
- 用自然段落写，像在写给人类看的一样
- 从整体场景到局部细节，层层递进
- 详细描述: 光线方向/质感/颜色/构图/情绪
- 空间关系: foreground/midground/background 分段描述
- 材质描述具体: 不要只说 "metal"，说 "polished brass with subtle patina"
- 推荐 100-250 词，给模型足够的语义信息
- 不要用逗号标签堆砌（这会降低质量）""",
        "example_raw": "a beautiful girl in a flower field sunset",
        "example_optimized": "A stunning portrait of a young woman standing in an expansive lavender field during the golden hour. The setting sun casts warm, directional light from the left, creating dramatic rim lighting along her silhouette and illuminating stray strands of her chestnut hair. Her expression is serene and contemplative, with soft catchlights in her eyes reflecting the amber sky. She wears a flowing white linen dress that catches the evening breeze. In the foreground, clusters of purple lavender create natural framing. The midground reveals rolling hills with scattered wildflowers. The background features a dramatic sky with cumulus clouds painted in shades of orange, pink, and deep purple. Shot with a 85mm lens at f/1.8 for shallow depth of field, the overall mood is dreamy, peaceful, and cinematic."
    },
    "midjourney": {
        "name": "Midjourney",
        "icon": "🌅",
        "family": "mj",
        "format": "简短描述+参数标记，支持 --ar --stylize --chaos 等参数",
        "tips": ["简练的描述 + 风格关键词 + 参数", "用 --ar 控制宽高比", "用 --stylize 控制艺术化程度", ":: 分隔不同元素并调权重"],
        "system_prompt": """你是 Midjourney 提示词优化专家。Midjourney 使用简练的英文描述+参数。

规则:
- 描述要简练但是信息密度高，不要超过 2-3 句话
- 风格关键词: cinematic, photorealistic, anime style, oil painting
- 必加参数: --ar 16:9 (宽高比)
- 可选参数: --stylize 100-1000 (风格强度), --chaos 0-100 (变化度)
- 用 :: 分隔不同概念并可加权: girl::2 flower::1
- 参考风格: --style raw (减少 Midjourney 默认美化)
- 版本: --v 6 或 --v 6.1""",
        "example_raw": "a beautiful girl in a flower field sunset",
        "example_optimized": "beautiful young woman standing in lavender field at golden hour sunset, flowing dress in breeze, cinematic lighting, shallow depth of field, soft bokeh background, warm color palette, dreamy atmosphere, photorealistic --ar 16:9 --stylize 250 --v 6.1"
    },
    "comfyui": {
        "name": "ComfyUI + LoRA",
        "icon": "🔌",
        "family": "sd",
        "format": "可配置工作流，支持触发词+Lora标记，输出直接对接 ComfyUI 节点",
        "tips": ["检查是否包含 LoRA 触发词", "指定采样器和步数建议", "CFG scale 建议写到 prompt 注释中", "考虑工作流中正/负提示词节点分离"],
        "system_prompt": """你是 ComfyUI 工作流提示词优化专家。ComfyUI 通常配合 SDXL/Flux + LoRA 使用。

规则:
- 如果用户指定了 LoRA，确保包含触发词（通常放在最前面）
- 输出干净的英文提示词，不要加 ComfyUI 节点语法
- 如果需要负面提示词，单独输出在 ===negative=== 之后
- 在末尾用 [CFG:7] [Steps:30] [Sampler:euler] 格式附加推荐参数
- 适配 ComfyUI 的 CLIPTextEncode 节点输入格式""",
        "example_raw": "a beautiful girl flower field sunset",
        "example_optimized": "masterpiece, best quality, highly detailed, 1girl, solo, beautiful detailed eyes, long flowing brown hair, serene expression, soft smile, standing in lavender field, golden hour sunset, warm lighting, cinematic composition, depth of field, dreamy atmosphere, 8k, professional photography\n===negative=== \nbad quality, worst quality, blurry, distorted face, extra limbs, bad anatomy, watermark, signature\n[CFG:7] [Steps:25] [Sampler:dpmpp_2m]"
    },
    "seedance": {
        "name": "Seedance / SVD",
        "icon": "🎬",
        "family": "video",
        "format": "视频提示词: 主体+动作+场景+相机运动+时间描述",
        "tips": ["必须描述动作和运动", "包含相机运动（推拉摇移）", "描述时序变化（开始→过程→结束）", "帧间一致性关键词很重要"],
        "system_prompt": """你是视频生成提示词优化专家（适用 Seedance / SVD / Kling）。

规则:
- 必须包含动作描述: 主体在做什么、怎么动
- 相机运动: camera slowly pans right, static shot, zoom in, tracking shot
- 时序: 描述开始状态→中间变化→结束状态
- 保持帧间一致性: consistent lighting, smooth motion, coherent background
- 速度感: slow motion, time-lapse, real-time
- 长度控制在 50-100 词，太长江容易时序漂移""",
        "example_raw": "a girl in a flower field",
        "example_optimized": "A young woman in a white dress walks slowly through a lavender field at sunset. She gently runs her hand through the flowers as she moves forward. Camera tracks alongside her at walking speed, maintaining a medium close-up. Wind softly blows her hair and dress, wildflowers sway in the breeze. Golden hour sunlight creates warm lens flares. Consistent lighting, smooth motion, 8-second shot."
    },
    "hunyuan": {
        "name": "混元 (Hunyuan)",
        "icon": "☯️",
        "family": "other",
        "format": "中文+英文混合，中文理解力强，对自然语言描述敏感",
        "tips": ["中文描述理解力强", "可用中文直接写场景描述", "质量词用英文效果更好", "人物描述中文+风格词英文混合"],
        "system_prompt": """你是腾讯混元图片生成模型的提示词优化专家。混元对中英文混合输入理解力强。

规则:
- 场景和意境用中文描述，更能传递文化细节和情感
- 质量词和风格词用英文: masterpiece, best quality, 8k, photorealistic
- 人物细节可中英混合: 少女, detailed face, 长发飘飘
- 中文古诗/成语意境可直接使用: 落霞与孤鹜齐飞
- 控制在 80-150 词""",
        "example_raw": "一个女孩在花田里",
        "example_optimized": "masterpiece, best quality, highly detailed, 一位少女站在薰衣草花田中，夕阳金色的光芒洒在她柔顺的长发上，微风轻拂裙摆。她的眼神温柔而深邃，望向远方。远处天空呈现橘粉渐变色，云彩稀疏。前景花朵虚化形成自然画框。8k, photorealistic, cinematic lighting, shallow depth of field, dreamy atmosphere, warm color palette"
    },
    "kling": {
        "name": "可灵 (Kling)",
        "icon": "🎞️",
        "family": "video",
        "format": "视频提示词: 中文描述+动作细节+运镜+时长",
        "tips": ["中文为主，动作描述要具体", "运镜关键词: 推拉摇移跟", "加上画幅和时长参数", "风格参考: 电影质感/纪录片/动画"],
        "system_prompt": """你是可灵 Kling 视频生成提示词优化专家。Kling 偏好中文描述。

规则:
- 使用中文描述整个场景
- 动作描述要具体: 不要只说「走路」，要说「缓步前行，裙摆随步伐轻轻摆动」
- 运镜: 镜头缓慢推进/固定机位/跟拍
- 可选: 画幅16:9 时长5秒
- 风格: 电影质感/写实/动漫/水墨
- 控制在 60-120 字""",
        "example_raw": "一个女孩在花田里",
        "example_optimized": "少女在薰衣草花田中缓步前行，手轻抚花穗。镜头从中景缓慢推近至面部特写。金色夕阳逆光，发丝被风吹起。远处山丘起伏，天空由橙渐变至深紫。画幅16:9，电影质感，升格慢动作，时长8秒。"
    }
}

OPTIMIZATION_DIRECTIONS = {
    "convert": {
        "name": "格式转换",
        "icon": "🔄",
        "desc": "将提示词适配到目标模型的格式",
        "instruction": "请将以下提示词转换为 {target_name} 格式。{format_rules}"
    },
    "enhance": {
        "name": "细节增强",
        "icon": "🔍",
        "desc": "补充材质/光线/构图等缺失细节",
        "instruction": """请在保持原意不变的前提下，增强以下提示词的细节:
- 补充缺失的材质描述（皮肤/布料/金属/自然材质）
- 添加具体的光线方向和光照类型
- 丰富构图元素（前景/中景/背景）
- 增加情绪和氛围关键词
- 保持原有的主体和场景不变"""
    },
    "compress": {
        "name": "精简压缩",
        "icon": "📦",
        "desc": "去除冗余，保留核心语义",
        "instruction": "请精简以下提示词，去掉重复和冗余描述，保留最核心的关键词和语义。输出更紧凑但信息完整的版本。"
    },
    "negative": {
        "name": "生成负面提词",
        "icon": "🚫",
        "desc": "反推适配的 negative prompt",
        "instruction": """请根据以下正向提示词，生成对应的负面提示词 (negative prompt)，适配 {target_name}。
包含:
- 常见质量缺陷: low quality, blurry, distorted
- 人体结构错误: bad anatomy, extra limbs, deformed hands
- 不想要的元素: watermark, signature, text
- 与该场景相冲突的元素
输出格式: 先输出优化后的正向提示词，然后在 ===negative=== 之后单独输出负面提示词。"""
    },
    "analyze": {
        "name": "质量分析",
        "icon": "📊",
        "desc": "分析优缺点，给出具体改进建议",
        "instruction": """请分析以下提示词的优缺点，给出结构化的改进建议:
1. 评分 (1-10分)
2. 优点（至少3条）
3. 缺点/缺失部分（至少3条）
4. 具体改进建议（逐条）
5. 改写后的优化版本（适配 {target_name}）
6. 如果有必要，提供负面提示词"""
    },
    "translate": {
        "name": "多语言翻译",
        "icon": "🌐",
        "desc": "中英互译，保留提示词结构和术语",
        "instruction": """请将以下提示词翻译，适配 {target_name} 的格式要求:
- 如果原文是中文，翻译为英文并适配格式
- 如果原文是英文，翻译为中文并适配格式
- 保留专业术语和风格关键词
- 按目标模型的格式要求输出"""
    },
    "style_transfer": {
        "name": "风格迁移",
        "icon": "🎭",
        "desc": "保持主体不变，切换艺术风格",
        "instruction": """请将以下提示词的主体和场景保持不变，但切换艺术风格为用户指定的风格。
可用风格参考: 赛博朋克/水墨画/油画/动漫/像素风/3D渲染/素描/水彩/浮世绘/波普艺术/极简主义/蒸汽波
如果用户指定了具体风格，优先使用用户指定的风格。"""
    },
    "variants": {
        "name": "批量变体",
        "icon": "🧬",
        "desc": "生成3-5个不同风格/情绪/构图的变体",
        "instruction": """请基于以下提示词，生成 3 个不同的变体，适配 {target_name}:
1. 不同情绪: (如 忧郁→温暖→神秘)
2. 不同光照: (如 黄金时刻→月光→霓虹灯)
3. 不同构图: (如 特写→全身→俯瞰)
每个变体标注 #变体1 #变体2 #变体3，保持核心主体不变。"""
    }
}


# ============ API ============

@router.get("/config")
def get_config():
    cfg = _get_config()
    safe = dict(cfg)
    if safe.get("openai_key"):
        safe["openai_key"] = safe["openai_key"][:6] + "..."
    return {"ok": True, "config": safe}


@router.post("/config")
def update_config(data: ConfigUpdate):
    current = _get_config()
    for k, v in data.config.items():
        if k in current:
            current[k] = v
    _save_config(current)
    return {"ok": True}


@router.post("/test")
async def test_prompt(data: TestRequest):
    """发送提示词到 LLM — 支持多轮对话历史"""
    cfg = _get_config()
    provider = data.provider or cfg.get("provider", "ollama")
    model = data.model or cfg.get("ollama_model", "qwen3.5:9b")
    temperature = data.temperature if data.temperature is not None else cfg["temperature"]
    max_tokens = data.max_tokens if data.max_tokens is not None else cfg["max_tokens"]
    system = data.system_prompt if data.system_prompt is not None else cfg["system_prompt"]
    sid = data.session_id or "default"

    # 构建消息（含历史）
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    history = _get_history(sid, 10)
    messages.extend(history)
    messages.append({"role": "user", "content": data.prompt})

    if provider == "ollama":
        result = await ollama_chat(
            messages=messages, model=model,
            temperature=temperature, max_tokens=max_tokens, timeout_s=120
        )
        if result.get("ok"):
            _save_message(sid, "user", data.prompt, model)
            _save_message(sid, "assistant", result["content"], model)
        return result

    elif provider == "openai":
        try:
            import httpx
            base_url = cfg.get("openai_url", "https://api.openai.com/v1")
            api_key = cfg.get("openai_key", "")
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(f"{base_url.rstrip('/')}/chat/completions", json={
                    "model": model, "messages": messages,
                    "temperature": temperature, "max_tokens": max_tokens
                }, headers=headers)
                r = resp.json()
                content = r.get("choices", [{}])[0].get("message", {}).get("content", "")
                usage = r.get("usage", {})
                _save_message(sid, "user", data.prompt, model)
                _save_message(sid, "assistant", content, model)
                return {"ok": True, "content": content, "model": model, "provider": "openai",
                        "usage": {"prompt_tokens": usage.get("prompt_tokens", 0),
                                  "completion_tokens": usage.get("completion_tokens", 0)}}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": False, "error": f"不支持的 provider: {provider}"}


@router.post("/stream")
async def test_stream(request: Request):
    """SSE 流式输出 — 支持多轮对话历史"""
    body = await request.json()
    cfg = _get_config()
    model = body.get("model") or cfg.get("ollama_model", "qwen3.5:9b")
    temperature = body.get("temperature", cfg["temperature"])
    max_tokens = body.get("max_tokens", cfg["max_tokens"])
    system = body.get("system_prompt", cfg["system_prompt"])
    prompt = body.get("prompt", "")
    sid = body.get("session_id", "default")

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    history = _get_history(sid, 8)
    messages.extend(history)
    messages.append({"role": "user", "content": prompt})

    _save_message(sid, "user", prompt, model)

    # 用列表收集完整回复
    full_content = [""]

    async def _stream():
        async for line in ollama_stream(
            messages=messages, model=model,
            temperature=temperature, max_tokens=max_tokens, timeout_s=300
        ):
            try:
                chunk = json.loads(line)
                if "message" in chunk and "content" in chunk["message"]:
                    full_content[0] += chunk["message"]["content"]
                if chunk.get("done"):
                    _save_message(sid, "assistant", full_content[0], model)
            except Exception:
                pass
            yield line

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.post("/compare")
async def compare_models(data: CompareRequest):
    """多模型对比 — 并发调用多个模型"""
    import asyncio

    cfg = _get_config()
    models = data.models if data.models else cfg.get("compare_models", ["qwen3.5:9b", "qwen3.6:27b"])
    if not models:
        models = ["qwen3.5:9b"]

    models = models[:4]  # 最多4个
    temperature = data.temperature if data.temperature is not None else cfg["temperature"]
    max_tokens = data.max_tokens if data.max_tokens is not None else cfg["max_tokens"]
    system = data.system_prompt or cfg["system_prompt"]

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": data.prompt})

    async def _call_one(model: str):
        t0 = time.time()
        result = await ollama_chat(
            messages=messages, model=model,
            temperature=temperature, max_tokens=max_tokens, timeout_s=180
        )
        elapsed = round((time.time() - t0) * 1000)
        return {
            "model": model,
            "ok": result.get("ok", False),
            "content": result.get("content", "") if result.get("ok") else "",
            "error": result.get("error", "") if not result.get("ok") else "",
            "elapsed_ms": elapsed,
            "usage": result.get("usage", {}),
        }

    tasks = [_call_one(m) for m in models]
    results = await asyncio.gather(*tasks)

    return {
        "ok": True,
        "prompt": data.prompt[:200],
        "results": results,
    }


@router.get("/history/{session_id}")
def get_history(session_id: str = "default", limit: int = 50):
    """获取对话历史"""
    return {"ok": True, "session_id": session_id, "history": _get_history(session_id, limit)}


@router.post("/history/clear")
def clear_history(session_id: str = "default"):
    """清除对话历史"""
    _clear_history(session_id)
    return {"ok": True, "message": f"已清除 {session_id} 的对话历史"}


@router.get("/models")
def list_models():
    """列出可用模型"""
    from ollama_client import refresh_model_cache
    models = refresh_model_cache()
    return {"ok": True, "models": models, "count": len(models)}


@router.get("/presets")
def get_presets():
    """Phase15: 返回所有模型预设 + 优化方向，供前端动态渲染"""
    presets_out = []
    for key, p in MODEL_PRESETS.items():
        presets_out.append({
            "key": key, "name": p["name"], "icon": p["icon"], "family": p["family"],
            "format": p["format"], "tips": p["tips"],
            "example_raw": p["example_raw"], "example_optimized": p["example_optimized"]
        })
    directions_out = []
    for key, d in OPTIMIZATION_DIRECTIONS.items():
        directions_out.append({
            "key": key, "name": d["name"], "icon": d["icon"], "desc": d["desc"]
        })
    return {"ok": True, "models": presets_out, "directions": directions_out}


@router.post("/optimize")
async def optimize_prompt(data: OptimizeRequest):
    """Phase15: 智能提示词优化 — 模型预设×优化方向"""
    cfg = _get_config()
    provider = data.provider or cfg.get("provider", "ollama")
    llm_model = data.model or cfg.get("ollama_model", "qwen3.5:9b")
    temperature = data.temperature if data.temperature is not None else cfg["temperature"]
    max_tokens = cfg["max_tokens"]

    # 获取目标预设
    target = MODEL_PRESETS.get(data.target_model, MODEL_PRESETS["flux"])
    direction = OPTIMIZATION_DIRECTIONS.get(data.direction, OPTIMIZATION_DIRECTIONS["convert"])

    # 构建 system prompt
    system = target["system_prompt"]
    if direction["instruction"]:
        fmt_instruction = direction["instruction"].replace("{target_name}", target["name"])
        if "{format_rules}" in fmt_instruction:
            fmt_instruction = fmt_instruction.replace("{format_rules}", target["format"] + ". 具体:\n" + "\n".join(f"- {t}" for t in target["tips"]))
        system += "\n\n【当前任务】\n" + fmt_instruction

    # 用户补充指令
    user_extra = ""
    if data.custom_instruction:
        user_extra = f"\n\n用户额外要求: {data.custom_instruction}"

    user_msg = f"原始提示词:\n{data.prompt}{user_extra}\n\n请输出优化结果:"

    # 调用 LLM
    if provider == "ollama":
        result = await ollama_chat(
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
            model=llm_model, temperature=temperature, max_tokens=max_tokens, timeout_s=180
        )
        if result.get("ok"):
            optimized = result["content"]
            # 自动保存到词卡库
            saved_card = None
            if data.save_to_library:
                saved_card = _save_to_library(data.prompt, optimized, data.target_model, data.group_id)
            return {
                "ok": True,
                "original": data.prompt,
                "optimized": optimized,
                "target_model": data.target_model,
                "direction": data.direction,
                "llm_model": llm_model,
                "saved_card": saved_card
            }
        return {"ok": False, "error": result.get("error", "未知错误")}

    elif provider == "openai":
        try:
            import httpx
            base_url = cfg.get("openai_url", "https://api.openai.com/v1")
            api_key = cfg.get("openai_key", "")
            async with httpx.AsyncClient(timeout=180) as client:
                resp = await client.post(f"{base_url.rstrip('/')}/chat/completions", json={
                    "model": llm_model,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
                    "temperature": temperature, "max_tokens": max_tokens
                }, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
                r = resp.json()
                optimized = r.get("choices", [{}])[0].get("message", {}).get("content", "")
                saved_card = None
                if data.save_to_library and optimized:
                    saved_card = _save_to_library(data.prompt, optimized, data.target_model, data.group_id)
                return {"ok": True, "original": data.prompt, "optimized": optimized,
                        "target_model": data.target_model, "direction": data.direction,
                        "llm_model": llm_model, "provider": "openai", "saved_card": saved_card}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": False, "error": f"不支持的 provider: {provider}"}


def _save_to_library(original: str, optimized: str, target_model: str, group_id: int = None) -> dict | None:
    """将优化结果保存到 word_card 词卡库"""
    try:
        target_info = MODEL_PRESETS.get(target_model, {})
        name = (target_info.get("name", target_model) + " 优化")[:60]
        content = optimized[:2000]
        db = get_db()
        # 查找或使用指定 group_id
        gid = group_id
        if not gid:
            # 自动归类到对应 family
            row = db.execute(
                "SELECT id FROM word_card_group WHERE group_key=? AND group_type='builtin'",
                [f"custom_{target_model}"]
            ).fetchone()
            if not row:
                # 落到第一个自定义分组
                row = db.execute(
                    "SELECT id FROM word_card_group WHERE group_type='custom' AND is_active=1 LIMIT 1"
                ).fetchone()
            gid = row["id"] if row else None
        max_sort = db.execute(
            "SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card WHERE group_id=?", [gid]
        ).fetchone()[0] if gid else 0
        db.execute(
            "INSERT INTO word_card (group_id,name,content,meaning,module,category,tags,sort_order,is_builtin,source) VALUES (?,?,?,?,?,?,?,?,0,'playground')",
            [gid, name, content, f"从 Playground 优化: {original[:100]}", "playground", target_model,
             json.dumps(["playground", target_model], ensure_ascii=False), max_sort]
        )
        db.commit()
        cid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"id": cid, "name": name, "group_id": gid, "target_model": target_model}
    except Exception as e:
        print(f"[Playground] 保存失败: {e}")
        return None


# ============ 内部函数 ============

def _get_history(session_id: str, limit: int) -> list:
    """获取内存中的对话历史"""
    hist = _conversations.get(session_id, [])
    return hist[-limit * 2:] if hist else []  # user+assistant 成对


def _save_message(session_id: str, role: str, content: str, model: str = ""):
    """保存消息到内存 + 数据库"""
    if not content:
        return
    msg = {"role": role, "content": content, "time": time.strftime("%H:%M:%S")}
    if session_id not in _conversations:
        _conversations[session_id] = []
    _conversations[session_id].append(msg)
    # 限制长度
    if len(_conversations[session_id]) > _MAX_HISTORY * 2:
        _conversations[session_id] = _conversations[session_id][-_MAX_HISTORY * 2:]

    # 写数据库
    try:
        db = get_db()
        db.execute(
            "INSERT INTO playground_history (session_id, role, content, model) VALUES (?,?,?,?)",
            [session_id, role, content, model]
        )
        db.commit()
    except Exception:
        pass


def _clear_history(session_id: str):
    _conversations.pop(session_id, None)
    try:
        db = get_db()
        db.execute("DELETE FROM playground_history WHERE session_id=?", [session_id])
        db.commit()
    except Exception:
        pass
