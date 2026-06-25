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
_embedding_dim = 384
_is_indexing = False


def _get_model():
    global _model
    if not _ML_OK:
        return None
    if _model is None:
        with _model_lock:
            if _model is None:
                print("[语义搜索] 加载模型 all-MiniLM-L6-v2...")
                t0 = time.time()
                # 使用本地缓存优先，避免 HuggingFace 超时阻塞启动
                _model = SentenceTransformer(
                    'all-MiniLM-L6-v2',
                    cache_folder=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'models', 'semantic')
                )
                print("[语义搜索] 模型加载完成 (%.1fs)" % (time.time() - t0))
    return _model


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
    total = 0
    try:
        indexed = db.execute("SELECT COUNT(*) FROM prompt_embeddings").fetchone()[0]
        total = db.execute("SELECT COUNT(*) FROM prompts WHERE deleted_at IS NULL").fetchone()[0]
    except Exception:
        pass
    return {
        "ok": True,
        "ml_available": _ML_OK and _NUMPY_OK,
        "model_loaded": _model is not None if _ML_OK else False,
        "model_name": "all-MiniLM-L6-v2" if _ML_OK else "N/A",
        "embedding_dim": _embedding_dim,
        "indexed": indexed,
        "total_prompts": total,
        "index_percent": round(indexed / total * 100, 1) if total > 0 else 0,
        "is_indexing": _is_indexing
    }
