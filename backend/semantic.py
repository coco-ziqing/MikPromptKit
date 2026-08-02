"""
语义搜索引擎
基于 sentence-transformers (all-MiniLM-L6-v2) 实现
- 启动时加载模型 + 生成所有提示词向量
- 新增/编辑提示词时更新向量
- 余弦相似度搜索
- 无 numpy/sentence-transformers 时优雅降级
"""
import os
import time
import json
import re
import sqlite3
import threading
from database import get_db

# ---- 网络加速：优先使用国内 HuggingFace 镜像 ----
if not os.environ.get("HF_ENDPOINT"):
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

# ---- ML 依赖检测，EXE 环境下优雅降级 ----
try:
    import numpy as np
    _NUMPY_OK = True
except Exception:
    _NUMPY_OK = False
    np = None

_ML_OK = False
try:
    from sentence_transformers import SentenceTransformer
    _ML_OK = True
except Exception:
    SentenceTransformer = None


# ---- 全局状态 ----
_model = None
_model_lock = threading.Lock()
_embedding_dim = 512  # BGE-small-zh-v1.5
_is_indexing = False


def _get_model():
    global _model
    if not _ML_OK:
        return None
    if _model is None:
        with _model_lock:
            if _model is None:
                # 优先中文模型 bge-small-zh-v1.5，回退 all-MiniLM-L6-v2
                for model_name, model_dim in [
                    ("BAAI/bge-small-zh-v1.5", 512),
                    ("all-MiniLM-L6-v2", 384),
                ]:
                    try:
                        print(f"[语义搜索] 加载模型 {model_name}...")
                        t0 = time.time()
                        _model = SentenceTransformer(
                            model_name,
                            cache_folder=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'models', 'semantic')
                        )
                        global _embedding_dim
                        _embedding_dim = model_dim
                        print(f"[语义搜索] 模型加载完成 {model_name} ({model_dim}维, %.1fs)" % (time.time() - t0))
                        break
                    except Exception as e:
                        print(f"[语义搜索] 模型 {model_name} 不可用: {e}")
                        continue
    return _model


# ---- 查询向量缓存（LRU，重复查询秒返）----
_query_cache = {}
_query_cache_max = 128


def _cached_encode(text: str):
    """带 LRU 缓存向量编码"""
    if text in _query_cache:
        return _query_cache[text]
    emb = encode_text(text)
    if emb is None:
        return None
    if len(_query_cache) >= _query_cache_max:
        _query_cache.pop(next(iter(_query_cache)))
    _query_cache[text] = emb
    return emb


def _ensure_table():
    db = get_db()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS prompt_embeddings (
                prompt_id INTEGER PRIMARY KEY,
                embedding BLOB NOT NULL,
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
            )
        """)
        db.commit()
    except Exception as e:
        print("[语义搜索] 建表失败:", e)


def _embedding_to_blob(embedding):
    return embedding.astype(np.float32).tobytes()


def _blob_to_embedding(blob):
    return np.frombuffer(blob, dtype=np.float32)


def encode_text(text: str):
    """将文本编码为向量，ML不可用时返回None"""
    if not _ML_OK or not _NUMPY_OK:
        return None
    if not text or not text.strip():
        text = " "
    model = _get_model()
    if model is None:
        return None
    return model.encode(text, normalize_embeddings=True)


def update_embedding(prompt_id: int, content: str = None):
    """更新单个提示词的向量"""
    if not _ML_OK or not _NUMPY_OK:
        return
    _ensure_table()
    db = get_db()
    if content is None:
        row = db.execute("SELECT content FROM prompts WHERE id=?", [prompt_id]).fetchone()
        if not row:
            return
        content = row["content"] or ""
    try:
        emb = encode_text(content)
        if emb is None:
            return
        blob = _embedding_to_blob(emb)
        db.execute("""
            INSERT OR REPLACE INTO prompt_embeddings (prompt_id, embedding, updated_at)
            VALUES (?, ?, datetime('now','localtime'))
        """, [prompt_id, blob])
        db.commit()
    except Exception as e:
        print("[语义搜索] 更新嵌入失败 (id=%d): %s" % (prompt_id, e))


def rebuild_all_embeddings(progress_callback=None):
    """重建所有提示词的向量索引，ML不可用时跳过"""
    global _is_indexing
    if not _ML_OK or not _NUMPY_OK:
        print("[语义搜索] ML 依赖不可用，跳过索引重建")
        _is_indexing = False
        return {"total": 0, "success": 0, "elapsed": 0, "note": "ML dependencies unavailable"}
    _is_indexing = True
    _ensure_table()
    _get_model()
    db = get_db()
    rows = db.execute("SELECT id, content FROM prompts WHERE deleted_at IS NULL ORDER BY id").fetchall()
    total = len(rows)
    print("[语义搜索] 开始重建索引: %d 条" % total)
    t0 = time.time()
    success = 0
    for i, row in enumerate(rows):
        try:
            emb = encode_text(row["content"] or "")
            if emb is None:
                continue
            blob = _embedding_to_blob(emb)
            db.execute("""
                INSERT OR REPLACE INTO prompt_embeddings (prompt_id, embedding, updated_at)
                VALUES (?, ?, datetime('now','localtime'))
            """, [row["id"], blob])
            success += 1
            # 2026-08-02 修复: 分批 commit，避免单一大事务长期持有写锁导致全库 database is locked
            if success % 50 == 0:
                db.commit()
            if progress_callback and i % 10 == 0:
                progress_callback(i, total)
        except Exception as e:
            print("[语义搜索] 索引失败 (id=%d): %s" % (row["id"], e))
    db.commit()
    elapsed = time.time() - t0
    print("[语义搜索] 索引重建完成: %d/%d 条 (%.1fs)" % (success, total, elapsed))
    _is_indexing = False
    return {"total": total, "success": success, "elapsed": elapsed}


def search(query: str, top_k: int = 20) -> list:
    """语义搜索，ML不可用时返回空"""
    if not _ML_OK or not _NUMPY_OK:
        return []
    if not query or not query.strip():
        return []
    _ensure_table()
    t0 = time.time()
    query_emb = encode_text(query)
    if query_emb is None:
        return []
    db = get_db()
    rows = db.execute("""
        SELECT p.id, p.content, p.meaning, p.module, p.category, p.tags, e.embedding
        FROM prompts p
        JOIN prompt_embeddings e ON e.prompt_id = p.id
        WHERE p.deleted_at IS NULL
    """).fetchall()
    if not rows:
        return []
    results = []
    for row in rows:
        emb = _blob_to_embedding(row["embedding"])
        score = float(np.dot(query_emb, emb))
        results.append({
            "id": row["id"],
            "content": row["content"],
            "meaning": row["meaning"],
            "module": row["module"],
            "category": row["category"],
            "tags": row["tags"],
            "score": round(score, 4)
        })
    results.sort(key=lambda x: x["score"], reverse=True)
    elapsed = time.time() - t0
    print("[语义搜索] 查询 \"%s\" 完成 (%.3fs, %d 结果)" % (query, elapsed, len(results)))
    return results[:top_k]


def get_status() -> dict:
    global _is_indexing
    db = get_db()
    indexed = 0
    wc_indexed = 0
    wc_total = 0
    total = 0
    try:
        indexed = db.execute("SELECT COUNT(*) FROM prompt_embeddings").fetchone()[0]
        total = db.execute("SELECT COUNT(*) FROM prompts WHERE deleted_at IS NULL").fetchone()[0]
    except Exception:
        pass
    try:
        wc_indexed = db.execute("SELECT COUNT(*) FROM word_card_embeddings").fetchone()[0]
        wc_total = db.execute("SELECT COUNT(*) FROM word_card WHERE is_deleted=0").fetchone()[0]
    except Exception:
        pass
    return {
        "ok": True,
        "ml_available": _ML_OK and _NUMPY_OK,
        "model_loaded": _model is not None if _ML_OK else False,
        "model_name": "BAAI/bge-small-zh-v1.5 (fallback: all-MiniLM-L6-v2)" if _ML_OK else "N/A",
        "embedding_dim": _embedding_dim,
        "indexed": indexed,
        "total_prompts": total,
        "index_percent": round(indexed / total * 100, 1) if total > 0 else 0,
        "wc_indexed": wc_indexed,
        "wc_total": wc_total,
        "wc_index_percent": round(wc_indexed / wc_total * 100, 1) if wc_total > 0 else 0,
        "is_indexing": _is_indexing
    }


# ==================== 词卡语义引擎（v4.x 统一词库） ====================

def _ensure_wc_table():
    """词卡语义向量表"""
    db = get_db()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS word_card_embeddings (
                card_id INTEGER PRIMARY KEY,
                embedding BLOB NOT NULL,
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (card_id) REFERENCES word_card(id) ON DELETE CASCADE
            )
        """)
        db.commit()
    except Exception as e:
        print("[语义搜索] 词卡向量表创建失败:", e)


def update_wc_embedding(card_id: int, content: str = None):
    """更新单张词卡的语义向量（合并全部文本字段 name+content+meaning+tags+scene+content_en+content_zh）"""
    if not _ML_OK or not _NUMPY_OK:
        return
    _ensure_wc_table()
    db = get_db()
    row = db.execute(
        "SELECT name, content, meaning, tags, scene, content_en, content_zh FROM word_card WHERE id=? AND is_deleted=0",
        [card_id]).fetchone()
    if not row:
        return
    # 合并全部文本字段，构造语义向量输入
    parts = []
    if row["name"]: parts.append(row["name"])
    if row["content"]: parts.append(row["content"])
    if row["meaning"]: parts.append(row["meaning"])
    if row["scene"]: parts.append(row["scene"])
    if row["content_zh"]: parts.append(row["content_zh"])
    if row["content_en"]: parts.append(row["content_en"])
    if row["tags"]:
        try:
            t = json.loads(row["tags"]) if isinstance(row["tags"], str) else (row["tags"] or [])
            if isinstance(t, list): parts.append(" ".join(t))
        except Exception:
            pass
    combined = " ".join(parts)[:512].strip()
    if not combined:
        combined = " "
    try:
        emb = encode_text(combined)
        if emb is None:
            return
        blob = _embedding_to_blob(emb)
        db.execute("""
            INSERT OR REPLACE INTO word_card_embeddings (card_id, embedding, updated_at)
            VALUES (?, ?, datetime('now','localtime'))
        """, [card_id, blob])
        db.commit()
    except Exception as e:
        print("[语义搜索] 词卡向量更新失败 (id=%d): %s" % (card_id, e))


def search_word_cards(query: str, top_k: int = 20, group_id: int = None) -> list:
    """语义搜索 word_card 表 — 余弦相似度 + 热度加权 + 缓存优化 + 分组过滤"""
    if not _ML_OK or not _NUMPY_OK:
        return []
    if not query or not query.strip():
        return []
    _ensure_wc_table()
    t0 = time.time()
    query_emb = _cached_encode(query.strip())
    if query_emb is None:
        return []
    db = get_db()
    # 支持分组过滤：限定搜索范围
    where_g = ""
    params = []
    if group_id:
        # 递归包含子孙分组
        gids = [group_id]
        try:
            children = db.execute(
                "SELECT id FROM word_card_group WHERE parent_group_id=? AND is_active=1", [group_id]
            ).fetchall()
            for c in children:
                gids.append(c["id"])
                grandchildren = db.execute(
                    "SELECT id FROM word_card_group WHERE parent_group_id=? AND is_active=1", [c["id"]]
                ).fetchall()
                for gc in grandchildren:
                    gids.append(gc["id"])
        except Exception:
            pass
        where_g = f" AND wc.group_id IN ({','.join('?'*len(gids))})"
        params = gids
    rows = db.execute(f"""
        SELECT wc.id, wc.name, wc.content, wc.meaning, wc.module,
               wc.category, wc.tags, wc.thumbnail, wc.icon, wc.usage_count,
               wc.heat_weight, wc.group_id, wg.name as group_name,
               we.embedding
        FROM word_card wc
        JOIN word_card_embeddings we ON we.card_id = wc.id
        LEFT JOIN word_card_group wg ON wg.id = wc.group_id
        WHERE wc.is_deleted = 0{where_g}
    """, params).fetchall()
    if not rows:
        return []
    results = []
    for row in rows:
        emb = _blob_to_embedding(row["embedding"])
        cosine = float(np.dot(query_emb, emb))
        # 热度+频次混合加权：高质量高频词卡排名提升
        heat_boost = 1.0 + 0.15 * (row["heat_weight"] or 0.5)
        usage_boost = 1.0 + 0.02 * min((row["usage_count"] or 0), 200)
        score = cosine * heat_boost * usage_boost
        results.append({
            "id": row["id"],
            "name": row["name"],
            "content": row["content"],
            "meaning": row["meaning"],
            "module": row["module"],
            "category": row["category"],
            "tags": row["tags"],
            "thumbnail": row["thumbnail"],
            "icon": row["icon"],
            "usage_count": row["usage_count"],
            "heat_weight": row["heat_weight"],
            "group_id": row["group_id"],
            "group_name": row["group_name"],
            "score": round(score, 4)
        })
    results.sort(key=lambda x: x["score"], reverse=True)
    elapsed = time.time() - t0
    print("[语义搜索·词卡] \"%s\" 完成 (%.3fs, %d 结果)" % (query, elapsed, len(results)))
    return results[:top_k]


def rebuild_wc_embeddings(progress_callback=None):
    """重建所有词卡的语义向量索引"""
    global _is_indexing
    if not _ML_OK or not _NUMPY_OK:
        print("[语义搜索] ML 依赖不可用，跳过词卡索引重建")
        return {"total": 0, "success": 0, "elapsed": 0, "note": "ML unavailable"}
    _is_indexing = True
    _ensure_wc_table()
    _get_model()
    db = get_db()
    rows = db.execute(
        "SELECT id, name, content, meaning, tags, scene, content_en, content_zh FROM word_card WHERE is_deleted=0 ORDER BY id"
    ).fetchall()
    total = len(rows)
    print("[语义搜索] 开始重建词卡索引: %d 条 (7字段全量)" % total)
    t0 = time.time()
    success = 0
    for i, row in enumerate(rows):
        try:
            parts = []
            if row["name"]: parts.append(row["name"])
            if row["content"]: parts.append(row["content"])
            if row["meaning"]: parts.append(row["meaning"])
            if row["scene"]: parts.append(row["scene"])
            if row["content_zh"]: parts.append(row["content_zh"])
            if row["content_en"]: parts.append(row["content_en"])
            if row["tags"]:
                try:
                    t = json.loads(row["tags"]) if isinstance(row["tags"], str) else (row["tags"] or [])
                    if isinstance(t, list): parts.append(" ".join(t))
                except Exception: pass
            combined = " ".join(parts)[:512].strip()
            emb = encode_text(combined or row["content"] or " ")
            if emb is None:
                continue
            blob = _embedding_to_blob(emb)
            db.execute("""
                INSERT OR REPLACE INTO word_card_embeddings (card_id, embedding, updated_at)
                VALUES (?, ?, datetime('now','localtime'))
            """, [row["id"], blob])
            success += 1
            # 2026-08-02 修复: 分批 commit，避免单一大事务长期持有写锁导致全库 database is locked
            if success % 50 == 0:
                db.commit()
            if progress_callback and i % 50 == 0:
                progress_callback(i, total)
        except Exception as e:
            print("[语义搜索] 词卡索引失败 (id=%d): %s" % (row["id"], e))
    try:
        db.commit()
    except Exception:
        pass
    elapsed = time.time() - t0
    print("[语义搜索] 词卡索引重建完成: %d/%d 条 (%.1fs)" % (success, total, elapsed))
    _is_indexing = False
    return {"total": total, "success": success, "elapsed": round(elapsed, 1)}
