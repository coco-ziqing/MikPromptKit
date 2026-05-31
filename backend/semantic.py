"""
语义搜索引擎
基于 sentence-transformers (all-MiniLM-L6-v2) 实现
- 启动时加载模型 + 生成所有提示词向量
- 新增/编辑提示词时更新向量
- 余弦相似度搜索
"""
import os
import time
import sqlite3
import numpy as np
import threading
from database import get_db

# 全局模型（惰性加载）
_model = None
_model_lock = threading.Lock()
_embedding_dim = 384  # all-MiniLM-L6-v2

# 标记：是否正在索引
_is_indexing = False


def _get_model():
    """惰性加载 sentence-transformers 模型"""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                print("[语义搜索] 加载模型 all-MiniLM-L6-v2...")
                t0 = time.time()
                from sentence_transformers import SentenceTransformer
                _model = SentenceTransformer('all-MiniLM-L6-v2')
                print("[语义搜索] 模型加载完成 (%.1fs)" % (time.time() - t0))
    return _model


def _ensure_table():
    """确保向量存储表存在"""
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
    """numpy 向量 → SQLite BLOB"""
    return embedding.astype(np.float32).tobytes()


def _blob_to_embedding(blob):
    """SQLite BLOB → numpy 向量"""
    return np.frombuffer(blob, dtype=np.float32)


def encode_text(text: str) -> np.ndarray:
    """将文本编码为向量"""
    if not text or not text.strip():
        text = " "
    model = _get_model()
    return model.encode(text, normalize_embeddings=True)


def update_embedding(prompt_id: int, content: str = None):
    """更新单个提示词的向量"""
    _ensure_table()
    db = get_db()
    if content is None:
        row = db.execute("SELECT content FROM prompts WHERE id=?", [prompt_id]).fetchone()
        if not row:
            return
        content = row["content"] or ""
    try:
        emb = encode_text(content)
        blob = _embedding_to_blob(emb)
        db.execute("""
            INSERT OR REPLACE INTO prompt_embeddings (prompt_id, embedding, updated_at)
            VALUES (?, ?, datetime('now','localtime'))
        """, [prompt_id, blob])
        db.commit()
    except Exception as e:
        print("[语义搜索] 更新嵌入失败 (id=%d): %s" % (prompt_id, e))


def rebuild_all_embeddings(progress_callback=None):
    """重建所有提示词的向量索引"""
    global _is_indexing
    _is_indexing = True
    _ensure_table()
    _get_model()  # 确保模型已加载

    db = get_db()
    rows = db.execute("SELECT id, content FROM prompts WHERE deleted_at IS NULL ORDER BY id").fetchall()
    total = len(rows)
    print("[语义搜索] 开始重建索引: %d 条" % total)

    t0 = time.time()
    success = 0
    for i, row in enumerate(rows):
        try:
            emb = encode_text(row["content"] or "")
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
    """语义搜索：返回相似提示词列表"""
    if not query or not query.strip():
        return []

    _ensure_table()
    t0 = time.time()

    # 编码查询
    query_emb = encode_text(query)

    # 读取所有向量
    db = get_db()
    rows = db.execute("""
        SELECT p.id, p.content, p.meaning, p.module, p.category, p.tags, e.embedding
        FROM prompts p
        JOIN prompt_embeddings e ON e.prompt_id = p.id
        WHERE p.deleted_at IS NULL
    """).fetchall()

    if not rows:
        return []

    # 计算余弦相似度
    results = []
    for row in rows:
        emb = _blob_to_embedding(row["embedding"])
        # 向量已经是归一化的，点积 = 余弦相似度
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

    # 按相似度排序
    results.sort(key=lambda x: x["score"], reverse=True)

    elapsed = time.time() - t0
    print("[语义搜索] 查询 \"%s\" 完成 (%.3fs, %d 结果)" % (query, elapsed, len(results)))

    return results[:top_k]


def get_status() -> dict:
    """获取语义搜索状态"""
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
        "model_loaded": _model is not None,
        "model_name": "all-MiniLM-L6-v2",
        "embedding_dim": _embedding_dim,
        "indexed": indexed,
        "total_prompts": total,
        "index_percent": round(indexed / total * 100, 1) if total > 0 else 0,
        "is_indexing": _is_indexing
    }
