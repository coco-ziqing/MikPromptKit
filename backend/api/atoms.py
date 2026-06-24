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

    # LLM 拆解 — 用英文 system prompt（qwen3.5 英文 JSON 输出更稳定）
    prompt = f"Prompt text to decompose (media_type={req.media_type}):\n{req.prompt}"
    try:
        raw = await call_ollama("optimize_fast", prompt, system=DECOMPOSE_SYS_EN, temperature=0.3, max_tokens=4000)
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

    created = []
    for atom in atoms:
        atom_type = atom.get("type", "creative")
        if req.create_groups and not req.group_id:
            gid = _ensure_atom_group(db, atom_type)
        else:
            gid = req.group_id
        if not gid:
            raise HTTPException(400, "请提供 group_id 或设置 create_groups=true")
        cid = _insert_atom_card(db, atom, req.decompose_id, gid)
        created.append({"card_id": cid, "group_id": gid, "text": atom.get("text", "").strip()[:40]})

    db.commit()
    return {"ok": True, "decompose_id": req.decompose_id, "card_count": len(created),
            "created_cards": created if req.create_groups and not req.group_id else None}


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

def _ensure_atom_group(db, atom_type: str) -> int:
    """查找或创建 atom 类型分组，返回 group_id"""
    name = f"[原子] {ATOM_TYPE_TO_CATEGORY.get(atom_type, atom_type)}"
    g = db.execute("SELECT id FROM word_card_group WHERE name=? AND group_type='atom' AND is_active=1", [name]).fetchone()
    if g:
        return g["id"]
    gkey = "atom_" + hashlib.md5(atom_type.encode()).hexdigest()[:8]
    db.execute(
        "INSERT INTO word_card_group (name,group_key,icon,group_type,description) VALUES (?,?,?,'atom',?)",
        [name, gkey, "⚛️", f"AI自动拆解-{atom_type}"]
    )
    return db.execute("SELECT last_insert_rowid()").fetchone()[0]


def _insert_atom_card(db, atom: dict, decompose_id: int, group_id: int) -> int:
    """创建词卡 + 写入桥接表（单原子），返回 word_card.id"""
    atom_type = atom.get("type", "creative")
    module = ATOM_TYPE_TO_MODULE.get(atom_type, "composition")
    card_name = (atom.get("text") or "")[:60]
    db.execute(
        """INSERT INTO word_card (group_id,name,content,meaning,module,category,tags,icon,card_role,media_type,sort_order,is_builtin,source)
           VALUES (?,?,?,?,?,?,?,?,?,?,
           (SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card WHERE group_id=?),0,'atom_decompose')""",
        [group_id, card_name, atom.get("text", ""), ",".join(atom.get("keywords", [])),
         module, ATOM_TYPE_TO_CATEGORY.get(atom_type, atom_type),
         json.dumps(atom.get("keywords", []), ensure_ascii=False),
         "⚛️", "atom", atom_type or "image", group_id]
    )
    card_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute(
        "INSERT OR REPLACE INTO atom_word_bridge (atom_hash,decompose_id,word_card_id,atom_type,atom_text) VALUES (?,?,?,?,?)",
        [hashlib.md5(atom.get("text", "").encode()).hexdigest(), decompose_id, card_id, atom_type, atom.get("text", "")]
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
