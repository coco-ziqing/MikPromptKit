# -*- coding: utf-8 -*-
"""
api/atoms.py — V2 提示词原子化核心 API (Phase15 引擎加固)
  POST /decompose              — 原子拆解（LLM 语义 + MD5 缓存）
  POST /decompose/batch        — 批量拆解（异步队列 + SSE 进度）
  GET  /decompose/{id}         — 读取缓存
  POST /extract-from-image     — OCR 图片文字提取 + 自动拆解
  POST /decompose/text         — 纯文本自动拆解（支持长段落）
  POST /archive-to-group       — 原子归档到词卡分组
  POST /variations             — 重组+变异生成
  POST /negative               — 负向词自动生成
  GET  /stats                  — 资产溯源统计（热门Top10/死码检测）
"""
from __future__ import annotations
import hashlib, json, asyncio, time, re
from typing import List
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/v4/atoms", tags=["atoms"])

from database import get_db, safe_fetch_one, safe_count_dict
from ollama_client import ollama_chat, ollama_generate, get_ollama_config, get_model_for


# ============ 内部适配器（封装 ollama_chat → call_ollama） ============
async def call_ollama(function: str, prompt: str, system: str = "", temperature: float = 0.3,
                     max_tokens: int = 4000, image_base64: str = "") -> str:
    """统一 LLM 调用适配器 — 自动将 system 注入 messages
    
    max_tokens 默认 4000：qwen3.5 思考模型需大预算（thinking ~3000 + content ~1000）"""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    
    # decompose 系列用 qwen3.5:4b (小模型、快、thinking 开销低)
    model_name = None
    if function in ("decompose", "optimize_fast"):
        model_name = "qwen3.5:4b"
    
    result = await ollama_chat(
        messages=messages,
        model=model_name,
        function=function if not model_name else None,
        temperature=temperature,
        max_tokens=max_tokens
    )
    if result.get("ok"):
        return result["content"]
    raise RuntimeError(result.get("error", "LLM 调用失败"))


class DecomposeReq(BaseModel):
    prompt: str
    media_type: str = "image"

class DecomposeBatchReq(BaseModel):
    prompts: list[DecomposeReq]

class VariationReq(BaseModel):
    decompose_id: int
    atoms_json: str  # 当前离线编辑后的原子数组
    count: int = 3
    locked_ids: list[str] = []

class NegativeReq(BaseModel):
    prompt: str


class ImageExtractReq(BaseModel):
    """图片OCR提取请求"""
    image_base64: str = ""  # base64编码的图片
    image_path: str = ""     # 服务端本地路径（优先）
    language: str = "zh"     # OCR识别语言


class TextDecomposeReq(BaseModel):
    """纯文本拆解请求"""
    text: str
    source_type: str = "manual"  # manual|import|ocr
    media_type: str = "image"
    group_id: int = None  # 可选：自动归档到指定分组


class ArchiveReq(BaseModel):
    """原子归档到词卡分组"""
    decompose_id: int
    atom_ids: list[str] = []  # 空=全部归档
    group_id: int = 0         # 目标 word_card_group.id
    create_groups: bool = True  # 自动创建缺失分组


DECOMPOSE_SYS_EN = """You are a prompt decomposition expert. Decompose the given prompt into structured atoms.

Return ONLY a JSON array (no markdown, no explanation). Each element:
  id: uuid string
  type: creative|style|composition|constraint|tone|negative|quality|subject|lighting|color|action|camera|atmosphere
  text: extracted phrase (under 15 words)
  keywords: array of 1-3 keywords
  weight: 0.0-1.0 (higher = more important)

Example output:
[{"id":"a1","type":"style","text":"cyberpunk aesthetic","keywords":["cyberpunk"],"weight":0.9},
 {"id":"a2","type":"lighting","text":"neon blue-purple glow","keywords":["neon","purple"],"weight":0.8}]

DO NOT include any text before or after the JSON array. Output ONLY the array."""

DECOMPOSE_SYS_ZH = """你是一个提示词原子化拆解专家。将用户输入的提示词拆解为结构化原子。

严格只返回 JSON 数组（不要 markdown 代码块，不要任何解释文字）。每个元素包含:
  id: 唯一标识(uuid格式)
  type: creative|style|composition|constraint|tone|negative 之一
  text: 原文提取片段(15字以内)
  keywords: 1-3个关键词
  weight: 权重(0-1, 越核心越接近1)

示例输出:
[{"id":"a1","type":"style","text":"日系赛璐珞风格","keywords":["赛璐珞"],"weight":0.9}]

只输出 JSON 数组，不要任何其他内容。"""
ATOM_TYPE_TO_MODULE = {
    "creative":    "composition",  # 创意→构图模块
    "style":       "style",
    "composition": "composition",
    "constraint":  "negative",     # 约束→负面提示词
    "tone":        "tone",
    "negative":    "negative",
    "quality":     "quality",
    "subject":     "subject",
    "lighting":    "lighting",
    "color":       "color",
    "action":      "action",
    "camera":      "camera",
    "atmosphere":  "atmosphere",
}

ATOM_TYPE_TO_CATEGORY = {
    "creative":    "创意元素",
    "style":       "风格表现",
    "composition": "构图取景",
    "constraint":  "限制条件",
    "tone":        "色调氛围",
    "negative":    "负面约束",
    "quality":     "画质参数",
    "subject":     "主体描述",
    "lighting":    "光影效果",
    "color":       "色彩搭配",
    "action":      "动作姿态",
    "camera":      "镜头语言",
    "atmosphere":  "环境气氛",
}


@router.post("/decompose")
async def decompose(req: DecomposeReq):
    """原子拆解：LLM 语义解析 + MD5 缓存命中"""
    h = hashlib.md5(f"{req.media_type}:{req.prompt}".encode()).hexdigest()
    db = get_db()

    cached = safe_fetch_one("SELECT * FROM atom_decompose WHERE source_hash=?", [h])
    if cached:
        return {
            "ok": True, "cached": True,
            "id": cached["id"], "atoms": json.loads(cached["atoms_json"]),
            "quality_score": cached["quality_score"],
            "model_used": cached["model_used"],
        }

    # 语言检测：中文输入→中文输出，英文输入→英文输出
    cjk_chars = sum(1 for ch in req.prompt if '\u4e00' <= ch <= '\u9fff' or '\u3400' <= ch <= '\u4dbf')
    is_chinese = cjk_chars >= 3 or cjk_chars >= len(req.prompt) * 0.15
    sys_prompt = DECOMPOSE_SYS_ZH if is_chinese else DECOMPOSE_SYS_EN
    prompt_lang = "zh" if is_chinese else "en"
    print(f"[ATOM-LOG] 语言检测: {'中文' if is_chinese else '英文'} (CJK={cjk_chars}/{len(req.prompt)}), 使用 {'ZH' if is_chinese else 'EN'} system prompt")

    # LLM 拆解
    prompt = f"Prompt text to decompose (media_type={req.media_type}):\n{req.prompt}"
    try:
        raw = await call_ollama("optimize_fast", prompt, system=sys_prompt, temperature=0.3, max_tokens=4000)
        text = str(raw).strip()
        print(f"[ATOM-LOG] LLM raw output ({len(text)} chars): {text[:300]}")
        # 鲁棒 JSON 提取：尝试多种格式
        atoms = _extract_json_array(text)
        if not atoms:
            print(f"[ATOM-LOG] _extract_json_array returned None, falling back")
            raise ValueError("no valid JSON array found in LLM output")
    except Exception:
        # fallback: token 级别切分
        chunks = re.findall(r'[\u4e00-\u9fff\w\s,\-\"]+', req.prompt[:100])
        atoms = [{"id": f"fb{i}", "type": "creative", "text": c.strip()[:20], "keywords": [], "weight": 1.0}
                 for i, c in enumerate(chunks[:3]) if c.strip()]
        if not atoms:
            atoms = [{"id": "fallback", "type": "creative", "text": req.prompt[:20], "keywords": [], "weight": 1.0}]

    # 计算质量分
    types = set(a.get("type", "") for a in atoms)
    score = round(min(len(atoms) / 6, 1.0) * 0.6 + min(len(types) / 4, 1.0) * 0.4, 2)

    db.execute(
        "INSERT INTO atom_decompose (source_prompt,media_type,source_hash,atoms_json,model_used,quality_score) VALUES (?,?,?,?,?,?)",
        [req.prompt, req.media_type, h, json.dumps(atoms, ensure_ascii=False), "ollama/optimize_fast", score]
    )
    db.commit()
    cid = db.execute("SELECT last_insert_rowid()").fetchone()[0]

    return {"ok": True, "cached": False, "id": cid, "atoms": atoms, "quality_score": score}


# ==================== P17.1: 列表 + 桥接 + 删除 ====================

@router.get("/list")
async def list_decomposes(page: int = 1, page_size: int = 20):
    """列出拆解记录（分页+最近优先）— 必须在 GET /decompose/{did} 之前注册"""
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM atom_decompose").fetchone()[0]
    rows = db.execute(
        """SELECT ad.*,
            (SELECT COUNT(*) FROM atom_variation av WHERE av.decompose_id=ad.id) as var_count,
            (SELECT COUNT(*) FROM atom_word_bridge awb WHERE awb.decompose_id=ad.id) as bridge_count
         FROM atom_decompose ad
         ORDER BY ad.id DESC
         LIMIT ? OFFSET ?""",
        [page_size, (page-1)*page_size]
    ).fetchall()
    items = []
    for r in rows:
        it = dict(r)
        try: it["atoms"] = json.loads(it["atoms_json"])
        except: it["atoms"] = []
        items.append(it)
    return {"ok": True, "items": items, "total": total}


@router.get("/decompose/{did}/bridge")
async def get_decompose_bridge(did: int):
    """获取拆解→词卡桥接记录"""
    db = get_db()
    rows = db.execute(
        "SELECT awb.*, wc.name, wc.content, wg.name as group_name FROM atom_word_bridge awb LEFT JOIN word_card wc ON wc.id=awb.word_card_id LEFT JOIN word_card_group wg ON wg.id=wc.group_id WHERE awb.decompose_id=?", [did]
    ).fetchall()
    return {"ok": True, "decompose_id": did, "bridge": [dict(r) for r in rows], "count": len(rows)}


@router.delete("/decompose/{did}")
async def delete_decompose(did: int):
    """删除拆解记录（级联删除变异+桥接+统计）"""
    db = get_db()
    row = db.execute("SELECT id FROM atom_decompose WHERE id=?", [did]).fetchone()
    if not row: raise HTTPException(404, "拆解记录不存在")
    db.execute("DELETE FROM atom_variation WHERE decompose_id=?", [did])
    db.execute("DELETE FROM atom_word_bridge WHERE decompose_id=?", [did])
    db.execute("DELETE FROM atom_stats WHERE decompose_id=?", [did])
    db.execute("DELETE FROM atom_decompose WHERE id=?", [did])
    db.commit()
    return {"ok": True, "deleted_id": did}


@router.post("/decompose/batch")
async def decompose_batch(req: DecomposeBatchReq):
    """批量拆解：并发 LLM + SSE 进度推送"""
    total = len(req.prompts)
    results = [None] * total
    cache_hits = 0

    async def gen():
        nonlocal cache_hits
        for i, item in enumerate(req.prompts):
            h = hashlib.md5(f"{item.media_type}:{item.prompt}".encode()).hexdigest()
            db = get_db()
            c = safe_fetch_one("SELECT * FROM atom_decompose WHERE source_hash=?", [h])
            if c:
                cache_hits += 1
                results[i] = {"ok": True, "cached": True, "atoms": json.loads(c["atoms_json"]), "index": i}
            else:
                try:
                    r = await decompose(item)
                    results[i] = {**r, "index": i}
                except Exception as e:
                    results[i] = {"ok": False, "error": str(e), "index": i}
            yield f"data: {json.dumps({'done':i+1, 'total':total, 'cached':cache_hits, 'index':i}, ensure_ascii=False)}\n\n"

        yield f"data: {json.dumps({'done':total, 'total':total, 'cached':cache_hits, 'results':[r for r in results if r]}, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/decompose/{did}")
async def get_decompose(did: int):
    """读取已缓存的拆解结果"""
    row = safe_fetch_one("SELECT * FROM atom_decompose WHERE id=?", [did])
    if not row:
        raise HTTPException(404, "decompose not found")
    return {"ok": True, "id": row["id"], "atoms": json.loads(row["atoms_json"]),
            "quality_score": row["quality_score"], "source_prompt": row["source_prompt"],
            "media_type": row["media_type"]}


@router.post("/variations")
async def create_variations(req: VariationReq):
    """重组+变异生成：基于原子重组为多版本提示词"""
    atoms = json.loads(req.atoms_json)
    if not atoms:
        raise HTTPException(400, "atoms_json 不能为空")

    # 锁定原子不变，其余交 LLM 改写
    locked = [a for a in atoms if a.get("id") in req.locked_ids]
    free = [a for a in atoms if a.get("id") not in req.locked_ids]
    free_texts = " | ".join(a.get("text", "") for a in free)
    prompt = f"Generate {req.count} alternative phrasings for this prompt by varying these semantic segments:\n{free_texts}"
    if locked:
        lock_texts = " | ".join(a.get("text", "") for a in locked)
        prompt += f"\n\nKeep these elements unchanged: {lock_texts}"
    prompt += f"\n\nReturn EXACTLY {req.count} lines, one complete prompt per line. No numbering, no markdown, no explanation."

    try:
        raw = await call_ollama("decompose", prompt, temperature=0.7, max_tokens=4000)
        variants = [v.strip() for v in str(raw).split("\n") if v.strip() and len(v) > 10][:req.count]
    except Exception:
        variants = [" [variation failed] "]

    if len(variants) < req.count:
        variants += [variants[0] + f" (var{v})" for v in range(req.count - len(variants))]

    db = get_db()
    created = []
    for v in variants:
        # 标记变异后的原子（复制原 atoms + diff 标记）
        var_atoms = json.loads(req.atoms_json)
        for a in var_atoms:
            a["_varied"] = a.get("id") not in req.locked_ids
        db.execute(
            "INSERT INTO atom_variation (decompose_id,version_name,prompt_text,atoms_json,parent_version,branch_tag,quality_score) VALUES (?,?,?,?,?,?,?)",
            [req.decompose_id, f"v{len(created)+1}", v, json.dumps(var_atoms, ensure_ascii=False),
             None, "main", 0.7]
        )
        db.commit()
        vid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        created.append({"id": vid, "text": v, "atoms": var_atoms})

    return {"ok": True, "decompose_id": req.decompose_id, "variations": created, "count": len(created)}


@router.post("/negative")
async def generate_negative(req: NegativeReq):
    """根据正向提示词自动生成负向词"""
    prompt = f"基于以下正向提示词，生成配套的负面提示词(negative prompt)，只输出一行英文，不要解释:\n{req.prompt}"
    try:
        raw = await call_ollama("optimize_fast", prompt, temperature=0.3, max_tokens=200)
        negative = str(raw).strip()
    except Exception:
        negative = "low quality, blurry, distorted"
    return {"ok": True, "negative": negative, "source_prompt": req.prompt}


# ==================== Phase15 新增端点 ====================

@router.post("/extract-from-image")
async def extract_from_image(req: ImageExtractReq):
    """OCR 图片文字提取 → 自动原子拆解（P15.1 多端导入核心）
    图片识别：优先用内置 OCR 模块提取文本，再经 LLM 拆解为 PromptToken 数组
    """
    from PIL import Image
    import base64, io, os

    # 1. 加载图片
    img = None
    if req.image_path and os.path.isfile(req.image_path):
        img = Image.open(req.image_path)
    elif req.image_base64:
        raw = base64.b64decode(req.image_base64)
        img = Image.open(io.BytesIO(raw))
    else:
        raise HTTPException(400, "请提供 image_path 或 image_base64")

    # 2. OCR 提取文本
    extracted_text = ""
    try:
        from api.ocr import _ocr_image
        extracted_text = await _ocr_image(img, req.language)
    except Exception:
        # OCR 降级：用 Ollama vision 模型
        try:
            import io
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()
            prompt = "请提取这张图片中所有可见的文字，只返回文字内容，不要解释。"
            extracted_text = await call_ollama("vision_ocr", prompt, image_base64=b64, temperature=0.1, max_tokens=400)
            extracted_text = str(extracted_text).strip()
        except Exception as e:
            raise HTTPException(500, f"OCR 提取失败: {e}")

    if not extracted_text or len(extracted_text.strip()) < 2:
        return {"ok": True, "extracted_text": "", "atoms": [], "hint": "图片中未检测到文字"}

    # 3. 对提取文本执行原子拆解
    decompose_result = await decompose(
        DecomposeReq(prompt=extracted_text.strip(), media_type="image")
    )

    return {
        "ok": True,
        "extracted_text": extracted_text.strip(),
        "decompose_id": decompose_result.get("id"),
        "atoms": decompose_result.get("atoms", []),
        "quality_score": decompose_result.get("quality_score", 0),
        "cached": decompose_result.get("cached", False),
    }


@router.post("/decompose/text")
async def decompose_text(req: TextDecomposeReq):
    """纯文本智能拆解 — 支持长段落拆分 + 自动归档到词卡分组（P15.1）
    支持三种模式：
    1. 短文本(≤200字) → 直接 LLM 拆解
    2. 长文本(>200字) → 先分段 → 逐段并发拆解 → 去重合并
    3. 来源标记(source_type) → OCR/导入/手动
    可选自动归档到指定 word_card_group
    """
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "文本不能为空")

    db = get_db()

    # 分段策略
    if len(text) <= 200:
        # 短文本直接拆解
        decompose_result = await decompose(
            DecomposeReq(prompt=text, media_type=req.media_type)
        )
        all_atoms = decompose_result.get("atoms", [])
        decompose_ids = [decompose_result.get("id")]
    else:
        # 长文本分段拆解
        segments = _split_text(text, 200)
        all_atoms = []
        decompose_ids = []
        seen_hashes = set()

        for seg in segments:
            try:
                r = await decompose(DecomposeReq(prompt=seg, media_type=req.media_type))
                if r.get("id"):
                    decompose_ids.append(r["id"])
                for a in r.get("atoms", []):
                    h = hashlib.md5(a.get("text", "").encode()).hexdigest()
                    if h not in seen_hashes:
                        seen_hashes.add(h)
                        all_atoms.append(a)
            except Exception:
                continue

    # 保存来源标记
    if decompose_ids:
        main_id = decompose_ids[0]
        try:
            db.execute(
                "UPDATE atom_decompose SET source_card_id=? WHERE id=?",
                [req.source_type, main_id]
            )
            db.commit()
        except Exception:
            pass

    # 自动归档到词卡分组（可选）
    archive_result = None
    if req.group_id and all_atoms:
        archive_result = _archive_atoms_to_group(db, decompose_ids[0] if decompose_ids else 0, all_atoms, req.group_id)

    return {
        "ok": True,
        "source_type": req.source_type,
        "text_length": len(text),
        "segments": len(segments) if len(text) > 200 else 1,
        "decompose_ids": decompose_ids,
        "atom_count": len(all_atoms),
        "atoms": all_atoms,
        "archived": archive_result,
    }


@router.post("/archive-to-group")
async def archive_to_group(req: ArchiveReq):
    """将已拆解的原子归档到 word_card 词卡 + word_card_group 分组（P15.2 双向桥接）
    P1-1: 统一使用 _ensure_atom_group + _insert_atom_card 消除重复代码
    P1-2: 统一 commit 消除 N+1 磁盘写入
    """
    db = get_db()
    row = db.execute("SELECT * FROM atom_decompose WHERE id=?", [req.decompose_id]).fetchone()
    if not row:
        raise HTTPException(404, "原子拆解记录不存在")
    atoms = json.loads(row["atoms_json"])
    if req.atom_ids:
        atoms = [a for a in atoms if a.get("id") in req.atom_ids]
    if not atoms:
        raise HTTPException(400, "没有可归档的原子")

    media_type = row["media_type"] if row["media_type"] else "image"

    created = []
    for atom in atoms:
        atom_type = atom.get("type", "creative")
        if req.create_groups and not req.group_id:
            gid = _ensure_atom_group(db, atom_type, media_type)
        else:
            gid = req.group_id
        if not gid:
            raise HTTPException(400, "请提供 group_id 或设置 create_groups=true")
        cid = _insert_atom_card(db, atom, req.decompose_id, gid)
        created.append({"card_id": cid, "group_id": gid, "text": atom.get("text", "").strip()[:40]})

    db.commit()
    return {"ok": True, "decompose_id": req.decompose_id, "card_count": len(created),
            "created_cards": created if req.create_groups and not req.group_id else None}


class MatchModelReq(BaseModel):
    """智能模型匹配请求"""
    prompt: str
    aspect_ratio: str = "16:9"
    resolution: str = "4K"
    duration: int = 15
    shot_count: int = 1


@router.post("/match-model")
async def match_model(req: MatchModelReq):
    """
    智能模型匹配：分析提示词结构 + 项目参数，推荐最佳视频生成模型
    - 分析维度：提示词长度、语言复杂度、画质需求、时长、镜头数
    - 输出 Top5 推荐模型及评分理由
    """
    # 模型知识库（评分权重：复杂度40% + 时长适配30% + 画质20% + 镜头适配10%）
    MODELS = [
        {"model": "Seedance 1.0 (文生视频)", "platform": "Seedance / 即梦", "tags": ["文生视频", "中长镜头", "16:9"],
         "max_duration": 16, "max_shot": 8, "ideal_duration": 8, "quality_desc": "影视级4K",
         "strengths": ["AI原生理解力强", "中文语义精准", "镜头连续性高"],
         "cost_per_second": "免费/会员", "best_for": "多镜头故事短剧、创意广告"},
        {"model": "Kling 2.5 (图生视频)", "platform": "可灵 / Kuaishou", "tags": ["图生视频", "高画质", "写实"],
         "max_duration": 10, "max_shot": 1, "ideal_duration": 5, "quality_desc": "超写实4K",
         "strengths": ["运动幅度大", "拟真光影", "物理一致"],
         "cost_per_second": "~2元/秒", "best_for": "单镜头高画质写实场景"},
        {"model": "Runway Gen-4", "platform": "Runway", "tags": ["图生视频", "创意特效", "多画幅"],
         "max_duration": 16, "max_shot": 1, "ideal_duration": 4, "quality_desc": "1080p-4K",
         "strengths": ["创意特效强", "风格迁移", "唇形同步"],
         "cost_per_second": "$0.05-0.20/秒", "best_for": "创意特效短片、概念艺术"},
        {"model": "Pika 2.0", "platform": "Pika Labs", "tags": ["文生视频", "快速原型", "社交媒体"],
         "max_duration": 10, "max_shot": 1, "ideal_duration": 3, "quality_desc": "1080p",
         "strengths": ["出图极快", "社交媒体适配", "文本响应度高"],
         "cost_per_second": "$0.01-0.05/秒", "best_for": "短视频快速迭代、社交媒体内容"},
        {"model": "Hailuo/Minimax", "platform": "海螺 / Minimax", "tags": ["文生视频", "超长镜头", "9:16"],
         "max_duration": 60, "max_shot": 1, "ideal_duration": 15, "quality_desc": "1080p-2K",
         "strengths": ["超长时长", "人物表情丰富", "中文理解"],
         "cost_per_second": "~1元/秒", "best_for": "长镜头叙事、人物对话场景"},
        {"model": "Sora", "platform": "OpenAI", "tags": ["文生视频", "物理世界", "长时序"],
         "max_duration": 60, "max_shot": 1, "ideal_duration": 20, "quality_desc": "1080p-4K",
         "strengths": ["物理规律最准确", "长时序连贯", "世界模型"],
         "cost_per_second": "$1-3/秒", "best_for": "复杂物理交互、纪录片风格"},
        {"model": "Luma Dream Machine", "platform": "Luma AI", "tags": ["图生视频", "3D", "多视角"],
         "max_duration": 5, "max_shot": 1, "ideal_duration": 3, "quality_desc": "1080p",
         "strengths": ["3D空间理解", "多视角一致", "材质逼真"],
         "cost_per_second": "$0.05/秒", "best_for": "产品360展示、3D场景"},
        {"model": "Vidu 2.0", "platform": "Vidu / 生数科技", "tags": ["图生视频", "中国风", "动漫"],
         "max_duration": 8, "max_shot": 1, "ideal_duration": 4, "quality_desc": "1080p",
         "strengths": ["中国风适配", "动漫风格强", "主体一致性"],
         "cost_per_second": "~1元/秒", "best_for": "国风动漫、二次元创作"},
    ]

    prompt = req.prompt
    # 评分计算
    text_len = len(prompt)
    has_cn = bool(re.search(r'[\u4e00-\u9fff]', prompt))
    # 复杂度评分：长文本 + 多关键词 → 适合AI理解强的模型
    complexity = min(1.0, max(0.2, text_len / 500))  # 200字≈0.4, 500字≈1.0
    # 镜头数评分
    multi_shot = req.shot_count > 1

    scored = []
    for m in MODELS:
        score = 0.7  # baseline

        # 1) 时长适配 (30%)
        dur_over = max(0, req.duration - m["max_duration"])
        if dur_over == 0:
            if req.duration <= m["ideal_duration"] * 1.5:
                score += 0.15  # 理想范围内
            else:
                score += 0.05
        else:
            score -= dur_over * 0.05  # 超出越多扣越多

        # 2) 复杂度适配 (40%)
        if has_cn and "中文" in str(m["strengths"]):
            score += 0.12  # 中文提示词 → 中文理解强的模型加分
        if complexity > 0.5 and "多镜头" in m.get("best_for", ""):
            score += 0.1

        # 3) 画质适配 (20%)
        if req.resolution in ("4K", "6K", "8K") and "4K" in str(m.get("quality_desc", "")):
            score += 0.08
        if req.aspect_ratio == "9:16" and "9:16" in str(m.get("tags", [])):
            score += 0.05
        if req.aspect_ratio == "16:9" and "16:9" in str(m.get("tags", [])):
            score += 0.03

        # 4) 镜头数适配 (10%)
        if multi_shot and m["max_shot"] >= req.shot_count:
            score += 0.1
        elif multi_shot:
            score -= 0.1  # 不支持多镜头扣分
        if not multi_shot and m["max_shot"] == 1:
            score += 0.03  # 单镜头场景不扣分

        # 5) 复杂度相关性
        if complexity > 0.4 and req.shot_count <= m["max_shot"] and req.duration <= m["max_duration"]:
            score += 0.05

        score = max(0.1, min(1.0, score))
        reason_parts = []
        if req.duration <= m["ideal_duration"] * 1.5:
            reason_parts.append(f"时长适配")
        if has_cn and "中文" in str(m["strengths"]):
            reason_parts.append("中文语义精准")
        if multi_shot and m["max_shot"] >= req.shot_count:
            reason_parts.append(f"支持{req.shot_count}镜头")
        if req.resolution in ("4K", "6K", "8K") and "4K" in str(m.get("quality_desc", "")):
            reason_parts.append(f"原生{req.resolution}")
        reason = "，".join(reason_parts[:3]) if reason_parts else "通用兼容"

        # 预估时间
        est_sec = m["ideal_duration"] * req.shot_count * 2  # 2x系数
        est_min = max(1, round(est_sec / 60))
        est_time = f"~{est_min}分钟"

        scored.append({
            "model": m["model"], "platform": m["platform"],
            "score": round(score, 2),
            "reason": reason,
            "estimated_time": est_time,
            "estimated_cost": m["cost_per_second"],
            "tags": m.get("tags", []),
            "strengths": m.get("strengths", []),
            "quality_desc": m.get("quality_desc", ""),
            "best_for": m.get("best_for", ""),
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    for i, s in enumerate(scored):
        s["rank"] = i + 1

    top = scored[:6]
    summary = f"基于 {req.shot_count}镜头·{req.resolution}·{req.duration}s·{req.aspect_ratio} 参数，首推 {top[0]['model']} ({top[0]['reason']})"

    return {"ok": True, "recommendations": top, "summary": summary,
            "params": {"aspect_ratio": req.aspect_ratio, "resolution": req.resolution,
                        "duration": req.duration, "shot_count": req.shot_count}}


@router.get("/stats")
async def get_atom_stats():
    """资产溯源统计（P15.3）
    - 热门 Top10：按 usage_count 降序
    - 死码检测：created_at > 7天 且 usage_count=0
    - 通用性矩阵：按 atom_type 分布 + 跨 decompose 复用次数
    """
    db = get_db()

    # 总体统计
    total_decompose = db.execute("SELECT COUNT(*) FROM atom_decompose").fetchone()[0]
    total_variations = db.execute("SELECT COUNT(*) FROM atom_variation").fetchone()[0]
    total_cards = db.execute("SELECT COUNT(*) FROM atom_word_bridge").fetchone()[0]

    # Top10 热门原子
    top_atoms = db.execute("""
        SELECT awb.atom_type, awb.atom_text, COUNT(*) as ref_count,
               ad.source_prompt, ad.quality_score
        FROM atom_word_bridge awb
        LEFT JOIN atom_decompose ad ON ad.id=awb.decompose_id
        GROUP BY awb.atom_hash
        ORDER BY ref_count DESC
        LIMIT 10
    """).fetchall()

    # 死码检测（7天内使用次数为0的原子）
    dead_atoms = db.execute("""
        SELECT awb.atom_text, awb.atom_type, ad.created_at
        FROM atom_word_bridge awb
        LEFT JOIN atom_decompose ad ON ad.id=awb.decompose_id
        WHERE ad.created_at < datetime('now','-7 days','localtime')
          AND awb.atom_hash NOT IN (
            SELECT atom_hash FROM atom_word_bridge
            WHERE atom_hash IN (SELECT atom_hash FROM atom_word_bridge GROUP BY atom_hash HAVING COUNT(*) > 1)
          )
        LIMIT 20
    """).fetchall()

    # 类型分布
    type_dist = db.execute("""
        SELECT atom_type, COUNT(*) as cnt
        FROM atom_word_bridge
        GROUP BY atom_type
        ORDER BY cnt DESC
    """).fetchall()

    return {
        "ok": True,
        "totals": {
            "decomposes": total_decompose,
            "variations": total_variations,
            "bridge_cards": total_cards,
        },
        "top_atoms": [
            {"type": r["atom_type"], "text": r["atom_text"],
             "ref_count": r["ref_count"], "quality_score": r["quality_score"]}
            for r in top_atoms
        ],
        "dead_atoms": [
            {"text": r["atom_text"], "type": r["atom_type"],
             "created_at": r["created_at"]}
            for r in dead_atoms
        ],
        "type_distribution": [
            {"type": r["atom_type"], "count": r["cnt"]}
            for r in type_dist
        ],
    }


# ============ 辅助函数 ============

def _ensure_atom_group(db, atom_type: str, media_type: str = "image") -> int:
    """查找或创建 atom 类型分组，返回 group_id
    media_type: 'image' → [原子]图像词库 | 'video' → [原子]视频词库"""
    # 确定父根
    root_key = "root_atom_video" if media_type == "video" else "root_atom_image"
    root = db.execute("SELECT id FROM word_card_group WHERE group_key=? AND is_active=1", [root_key]).fetchone()
    parent_id = root["id"] if root else None
    
    name = f"[原子] {ATOM_TYPE_TO_CATEGORY.get(atom_type, atom_type)}"
    g = db.execute("SELECT id, parent_group_id FROM word_card_group WHERE name=? AND group_type='atom' AND is_active=1", [name]).fetchone()
    if g:
        # 确保 parent 正确（幂等修复）
        if g["parent_group_id"] != parent_id:
            db.execute("UPDATE word_card_group SET parent_group_id=? WHERE id=?", [parent_id, g["id"]])
        return g["id"]
    gkey = "atom_" + hashlib.md5(atom_type.encode()).hexdigest()[:8]
    db.execute(
        "INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,description) VALUES (?,?,?,'atom',?,?)",
        [name, gkey, "⚛️", parent_id, f"AI auto-decompose {atom_type}"]
    )
    return db.execute("SELECT last_insert_rowid()").fetchone()[0]


def _insert_atom_card(db, atom: dict, decompose_id: int, group_id: int) -> int:
    """创建词卡 + 写入桥接表（单原子），返回 word_card.id
    去重：通过 atom_word_bridge 的 atom_hash 检查同一 group 内是否已有相同原子
    """
    atom_type = atom.get("type", "creative")
    atom_text = atom.get("text", "")
    atom_hash = hashlib.md5(atom_text.encode()).hexdigest()
    
    # 去重：同一 group 内相同 atom_text 只保留一条词卡
    existing = db.execute(
        "SELECT b.word_card_id FROM atom_word_bridge b JOIN word_card wc ON b.word_card_id=wc.id WHERE b.atom_hash=? AND wc.group_id=? AND wc.is_deleted=0",
        [atom_hash, group_id]
    ).fetchone()
    if existing:
        return existing[0]
    
    module = ATOM_TYPE_TO_MODULE.get(atom_type, "composition")
    card_name = atom_text[:60]
    category = ATOM_TYPE_TO_CATEGORY.get(atom_type, atom_type)
    keywords = atom.get("keywords", [])
    meaning = ", ".join(keywords) if keywords else ""
    # 构建场景描述（从原子类型推导使用场景）
    scene_map = {
        "subject": "用于定义画面主体人物/对象的外观特征",
        "style": "用于定义画面的艺术风格和视觉调性",
        "composition": "用于定义画面的构图方式和取景角度",
        "lighting": "用于定义画面的光源方向和光影效果",
        "color": "用于定义画面的色彩倾向和色调氛围",
        "quality": "用于定义画面的技术画质和细节参数",
        "camera": "用于定义镜头焦段、光圈和拍摄设备",
        "atmosphere": "用于定义画面的情绪氛围和意境",
        "tone": "用于定义画面的色调风格和滤镜效果",
        "negative": "负面提示词 — 排除不希望出现的元素",
        "constraint": "限制条件 — 约束 AI 的生成边界",
        "creative": "创意元素 — 添加特殊视觉效果或装饰",
        "action": "用于定义画面中的动态动作或运动方式",
    }
    scene = scene_map.get(atom_type, f"[{atom_type}] 类型原子提示词")
    # structured: 原子完整元数据
    structured = json.dumps({
        "atom_type": atom_type,
        "weight": atom.get("weight", 0.5),
        "keywords": keywords,
        "decompose_id": decompose_id
    }, ensure_ascii=False)
    db.execute(
        """INSERT INTO word_card (group_id,name,content,meaning,scene,module,category,tags,icon,card_role,media_type,structured,version,sort_order,is_builtin,source)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,
           (SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card WHERE group_id=?),0,'atom_decompose')""",
        [group_id, card_name, atom_text, meaning, scene,
         module, category,
         json.dumps(keywords, ensure_ascii=False),
         "⚛️", "atom", atom_type or "image", structured, group_id]
    )
    card_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute(
        "INSERT OR REPLACE INTO atom_word_bridge (atom_hash,decompose_id,word_card_id,atom_type,atom_text) VALUES (?,?,?,?,?)",
        [atom_hash, decompose_id, card_id, atom_type, atom_text]
    )
    return card_id


def _split_text(text: str, max_len: int = 200) -> list[str]:
    """长文本智能分段（按句号/换行优先，避免截断词）"""
    if len(text) <= max_len:
        return [text]
    segments = []
    # 按换行优先
    lines = text.split("\n")
    buf = ""
    for line in lines:
        if len(buf) + len(line) <= max_len:
            buf += line + "\n"
        else:
            if buf.strip():
                segments.append(buf.strip())
            buf = line + "\n"
    if buf.strip():
        segments.append(buf.strip())
    return segments if segments else [text[:max_len]]


def _extract_json_array(text: str) -> list | None:
    """鲁棒 JSON 数组提取 — 处理 LLM 各种输出格式"""
    text = text.strip()
    if "```" in text:
        m = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
        if m:
            text = m.group(1).strip()
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        text = text[start:end+1]
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError:
        pass
    return None


def _archive_atoms_to_group(db, decompose_id: int, atoms: list, group_id: int) -> dict:
    """内部函数：将原子批量归档到词卡分组（复用 _insert_atom_card）"""
    created = 0
    for atom in atoms:
        _insert_atom_card(db, atom, decompose_id, group_id)
        created += 1
    db.commit()
    return {"group_id": group_id, "cards_created": created}
