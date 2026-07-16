# -*- coding: utf-8 -*-
"""
感知哈希相似搜索 + 智能合集
- pHash 图片感知哈希
- 汉明距离去重/相似查找
- 智能合集（保存搜索条件）
"""
import os, json, time, sqlite3
from pathlib import Path
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

try:
    import imagehash
    HAS_IH = True
except ImportError:
    HAS_IH = False

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")

def _rw():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c

def _ro():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA query_only=ON")
    return c

def _safe_commit(c):
    for i in range(5):
        try: c.commit(); return
        except sqlite3.OperationalError:
            if i == 4: raise
            time.sleep(0.05*(i+1))

# ═══════════════════════════
# pHash 感知哈希
# ═══════════════════════════

def compute_phash(image_path):
    """计算图片感知哈希"""
    if not HAS_PIL or not HAS_IH:
        return ""
    try:
        img = Image.open(image_path)
        # 缩放到合理尺寸
        img.thumbnail((512, 512), Image.LANCZOS)
        ph = imagehash.phash(img)
        return str(ph)
    except Exception:
        return ""

def compute_phash_from_bytes(data):
    """从 bytes 计算感知哈希"""
    if not HAS_PIL or not HAS_IH:
        return ""
    try:
        from io import BytesIO
        img = Image.open(BytesIO(data))
        img.thumbnail((512, 512), Image.LANCZOS)
        return str(imagehash.phash(img))
    except Exception:
        return ""

# ═══════════════════════════
# 去重检测
# ═══════════════════════════

def find_duplicates(phash_str, threshold=5):
    """
    查找相似的资产
    threshold: 汉明距离，0=完全相同，≤5=高度相似，≤10=较相似
    返回: [{catalog_id, filename, distance, project_name, module_key}]
    """
    if not phash_str or len(phash_str) < 8:
        return []

    db = _ro()
    results = []
    try:
        # 获取所有有 perceptual_hash 的资产
        rows = db.execute("""
            SELECT ac.id, ac.filename, ac.perceptual_hash, ac.module_key,
                   ps.name project_name, ac.project_space_id
            FROM asset_catalog ac
            LEFT JOIN project_space ps ON ac.project_space_id = ps.id
            WHERE ac.perceptual_hash IS NOT NULL AND ac.perceptual_hash != ''
              AND ac.status = 'active'
        """).fetchall()

        # 计算汉明距离
        for r in rows:
            try:
                # imagehash 的汉明距离
                h1 = imagehash.hex_to_hash(phash_str)
                h2 = imagehash.hex_to_hash(r["perceptual_hash"])
                distance = h1 - h2
                if distance <= threshold:
                    results.append({
                        "catalog_id": r["id"],
                        "filename": r["filename"],
                        "project_name": r["project_name"],
                        "module_key": r["module_key"],
                        "distance": distance,
                        "similarity": "完全相同" if distance == 0 else "高度相似" if distance <= 5 else "较相似",
                    })
            except Exception:
                continue

        # 按距离排序
        results.sort(key=lambda x: x["distance"])
    finally:
        db.close()
    return results


def find_exact_duplicate(phash_str):
    """查找完全相同（汉明距离=0）"""
    return find_duplicates(phash_str, threshold=0)


# ═══════════════════════════
# 智能合集
# ═══════════════════════════

def create_smart_collection(name, conditions, user_id):
    """
    创建智能合集
    conditions: {"project_id": 1, "module_key": "image", "tag": "机甲", ...}
    """
    db = _rw()
    try:
        db.execute("""INSERT INTO smart_collection (name, conditions_json, user_id)
                      VALUES (?, ?, ?)""",
                   [name, json.dumps(conditions, ensure_ascii=False), user_id])
        cid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        _safe_commit(db)
        return cid
    finally:
        db.close()


def get_smart_collections(user_id):
    db = _ro()
    try:
        rows = db.execute("SELECT * FROM smart_collection WHERE user_id=? OR user_id IS NULL ORDER BY created_at DESC",
                          [user_id]).fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()


def execute_smart_collection(collection_id):
    """
    执行智能合集查询，返回匹配的资产列表
    根据 conditions_json 动态构建 SQL
    """
    db = _ro()
    try:
        coll = db.execute("SELECT * FROM smart_collection WHERE id=?", [collection_id]).fetchone()
        if not coll:
            return []

        conditions = json.loads(coll["conditions_json"] or "{}")
        where, params = ["ac.status='active'"], []

        if conditions.get("project_id"):
            where.append("ac.project_space_id=?"); params.append(conditions["project_id"])
        if conditions.get("module_key"):
            where.append("ac.module_key=?"); params.append(conditions["module_key"])
        if conditions.get("is_critical") is not None:
            where.append("ac.is_critical=?"); params.append(conditions["is_critical"])
        if conditions.get("ext"):
            where.append("ac.ext=?"); params.append(conditions["ext"])
        if conditions.get("tag"):
            where.append("""ac.id IN (SELECT asset_id FROM asset_tags WHERE tag LIKE ?)""")
            params.append(f"%{conditions['tag']}%")
        if conditions.get("days"):
            where.append("ac.created_at >= datetime('now','localtime','-'||?||' days')")
            params.append(conditions["days"])
        if conditions.get("search"):
            where.append("ac.filename LIKE ?"); params.append(f"%{conditions['search']}%")

        w = "WHERE " + " AND ".join(where)
        rows = db.execute(f"""
            SELECT ac.*, ps.name project_name
            FROM asset_catalog ac
            LEFT JOIN project_space ps ON ac.project_space_id = ps.id
            {w}
            ORDER BY ac.created_at DESC
            LIMIT 200
        """, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()


def delete_smart_collection(collection_id):
    db = _rw()
    try:
        db.execute("DELETE FROM smart_collection WHERE id=?", [collection_id])
        _safe_commit(db)
        return True
    finally:
        db.close()


# ═══════════════════════════
# 迁移：smart_collection 表
# ═══════════════════════════

def ensure_smart_collection_table():
    db = _rw()
    try:
        exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='smart_collection'").fetchone()
        if not exists:
            db.execute("""CREATE TABLE smart_collection (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                conditions_json TEXT DEFAULT '{}',
                user_id INTEGER,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS idx_sc_user ON smart_collection(user_id)")
            _safe_commit(db)
            print("[OK] smart_collection table created")
        else:
            print("[OK] smart_collection already exists")
    finally:
        db.close()


if __name__ == "__main__":
    ensure_smart_collection_table()
    print("[TEST] Similarity engine loaded")
