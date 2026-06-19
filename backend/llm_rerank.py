"""
v4.0.0-phase12.5: 语义搜索 LLM Rerank
- 三阶段搜索: FTS5粗排 → embedding精排 → LLM语义重排
- 用 Ollama LLM 对 top20 候选做语义理解重排序
- 线程池隔离: semantic search 跑在 executor 避免阻塞事件循环
"""
import asyncio, json, re, time, threading
from typing import List
from database import get_db
from ollama_client import ollama_chat, get_model_for

# ============ LLM Rerank ============

RERANK_SYSTEM = """你是提示词搜索排序专家。请对候选提示词按与查询的语义相关性重新排序。

规则：
1. 优先匹配核心语义（主体/风格/场景），其次匹配修饰词
2. 中文查询优先匹配中文释义，英文查询优先匹配原文
3. 每个候选打分0-10，只返回JSON数组

输入格式：
查询: {query}
候选:
1. [id:123] 内容...
2. [id:456] 内容...

返回格式:
[{"id": 123, "score": 9.2, "reason": "简短理由"}, ...]

严格按照相关性排序，Score越高越相关。只返回JSON数组，不要其它说明。"""


async def llm_rerank(query: str, candidates: List[dict], top_k: int = 10) -> List[dict]:
    """用 LLM 对候选进行语义重排"""
    if not candidates or len(candidates) <= 3:
        return candidates

    items_text = ""
    for i, c in enumerate(candidates[:20]):
        meaning = c.get("meaning", "")
        content = c.get("content", "")
        text = f"{meaning} | {content}"[:120]
        items_text += f"{i+1}. [id:{c['id']}] {text}\n"

    prompt = f"查询: {query}\n\n候选:\n{items_text}\n\n请重排序，返回JSON数组。"
    messages = [
        {"role": "system", "content": RERANK_SYSTEM},
        {"role": "user", "content": prompt}
    ]

    try:
        result = await ollama_chat(
            messages=messages, function="rerank",
            temperature=0.0, max_tokens=2048, timeout_s=30
        )
        if not result.get("ok"):
            return candidates[:top_k]

        raw = result["content"]
        try:
            ranked = json.loads(raw)
            if isinstance(ranked, list) and len(ranked) > 0:
                order_map = {int(item["id"]): i for i, item in enumerate(ranked) if isinstance(item, dict) and "id" in item}
                return sorted(candidates, key=lambda c: order_map.get(c["id"], 999))[:top_k]
        except (json.JSONDecodeError, ValueError, KeyError):
            pass

        json_match = re.search(r'\[.*\]', raw, re.DOTALL)
        if json_match:
            try:
                ranked = json.loads(json_match.group(0))
                if isinstance(ranked, list):
                    order_map = {int(item["id"]): i for i, item in enumerate(ranked) if isinstance(item, dict) and "id" in item}
                    return sorted(candidates, key=lambda c: order_map.get(c["id"], 999))[:top_k]
            except Exception:
                pass
    except Exception:
        pass

    return candidates[:top_k]


async def hybrid_search(query: str, top_k: int = 10, use_rerank: bool = True) -> dict:
    """混合搜索: FTS5关键词 + LIKE回退（语义搜索只在模型就绪时启用）"""
    t0 = time.time()
    query = query.strip()
    if not query:
        return {"ok": True, "query": query, "total": 0, "elapsed_ms": 0, "reranked": False, "items": []}

    db = get_db()

    # Phase 1: FTS5 + LIKE 关键词搜索
    fts_results = _fts_search(db, query, 30)

    # Phase 2: semantic only if model ready and not breaking
    merged = {}
    for r in fts_results:
        merged[r["id"]] = {"id": r["id"], "content": r["content"], "meaning": r.get("meaning", ""),
                          "module": r.get("module", ""), "category": r.get("category", ""),
                          "tags": r.get("tags", "[]"), "score": 1.0}

    # semantic optionally adds weight
    try:
        from semantic import get_status
        st = get_status()
        if st.get("model_loaded") and st.get("ml_available"):
            from semantic import search
            loop = asyncio.get_event_loop()
            try:
                semantic_results = await asyncio.wait_for(
                    loop.run_in_executor(None, search, query, 30),
                    timeout=5.0
                )
            except asyncio.TimeoutError:
                semantic_results = []
            for r in (semantic_results or []):
                if r["id"] in merged:
                    merged[r["id"]]["score"] += r.get("score", 0) * 0.5
                else:
                    merged[r["id"]] = {"id": r["id"], "content": r["content"], "meaning": r.get("meaning", ""),
                                      "module": r.get("module", ""), "category": r.get("category", ""),
                                      "tags": r.get("tags", "[]"), "score": r.get("score", 0) * 0.5}
    except Exception:
        pass

    candidates = sorted(merged.values(), key=lambda x: -x["score"])[:top_k]

    elapsed = round((time.time() - t0) * 1000)
    return {"ok": True, "query": query, "total": len(candidates),
            "elapsed_ms": elapsed, "reranked": False, "items": candidates}


def _fts_search(db, query: str, limit: int = 30) -> list:
    """FTS5 全文搜索 — 多策略回退"""
    results = []
    try:
        # 策略1: FTS5 MATCH（多词用AND连接）
        safe_query = ' AND '.join(f'"{w}"' for w in query.split() if len(w) >= 2)
        if not safe_query:
            safe_query = query

        try:
            rows = db.execute("""
                SELECT p.id, p.content, p.meaning, p.module, p.category, p.tags
                FROM prompts p
                JOIN prompts_fts fts ON p.id = fts.rowid
                WHERE prompts_fts MATCH ?
                LIMIT ?
            """, [safe_query, limit]).fetchall()
            results = [dict(r) for r in rows]
        except Exception:
            pass

        # 策略2: LIKE 模糊匹配（FTS没结果时）
        if not results:
            like_pattern = f"%{query}%"
            rows = db.execute("""
                SELECT id, content, meaning, module, category, tags
                FROM prompts
                WHERE content LIKE ? OR meaning LIKE ?
                LIMIT ?
            """, [like_pattern, like_pattern, limit]).fetchall()
            results = [dict(r) for r in rows]
    except Exception as e:
        print(f"[FTS] Error: {e}")

    return results


def _semantic_search_sync(query: str, top_k: int = 30) -> list:
    """同步语义搜索（线程池中运行）"""
    try:
        from semantic import search
        return search(query, top_k)
    except Exception as e:
        print(f"[Semantic] Error: {e}")
        return []
