# -*- coding: utf-8 -*-
"""
T2 第一步：迁移 prompts + prompt_cards -> word_card
- 每个 prompts 行 -> 按 content sha256 去重，映射到 word_card（遗留导入分组）
- 每个 prompt_cards 行 -> 同理
- 幂等：重复运行不产生重复数据（content_hash 去重）
"""
import sys, os, hashlib, sqlite3
sys.path.insert(0, "backend")
from paths import get_data_dir

DB = os.path.join(get_data_dir(), "prompts.db")
c = sqlite3.connect(DB, timeout=10)
c.execute("PRAGMA journal_mode=WAL")
c.row_factory = sqlite3.Row

def _ensure_legacy_group():
    g = c.execute("SELECT id FROM word_card_group WHERE id=999999").fetchone()
    if g:
        return g["id"]
    c.execute("""INSERT OR IGNORE INTO word_card_group
        (id,name,group_type,parent_group_id,description,is_active)
        VALUES (999999,'遗留导入','auto',1,'从旧 prompts/prompt_cards 表迁移',1)""")
    c.commit()
    return 999999

def content_hash(content):
    return hashlib.sha256((content or "").encode("utf-8")).hexdigest()

# 1. 确保 content_hash 列存在
try:
    c.execute("ALTER TABLE word_card ADD COLUMN content_hash TEXT DEFAULT ''")
    c.commit()
except Exception:
    pass

# 2. 回填现有 word_card 的 content_hash
rows = c.execute("SELECT id, content FROM word_card WHERE content_hash IS NULL OR content_hash=''").fetchall()
for r in rows:
    h = content_hash(r["content"])
    c.execute("UPDATE word_card SET content_hash=? WHERE id=?", [h, r["id"]])
c.commit()

def migrate_prompts():
    moved = 0
    gid = _ensure_legacy_group()
    rows = c.execute("SELECT * FROM prompts").fetchall()
    for r in rows:
        content = (r["content"] or "").strip()
        if not content:
            continue
        h = content_hash(content)
        existing = c.execute("SELECT id FROM word_card WHERE content_hash=? AND is_deleted=0", [h]).fetchone()
        if existing:
            continue
        name = (str(r["subcategory"] or "") or str(r["category"] or "") or "")[:60]
        if not name:
            name = content[:40]
        c.execute("""INSERT INTO word_card
            (group_id, name, content, meaning, tags, icon, card_role, media_type,
             structured, version, sort_order, is_builtin, is_deleted, source, content_hash, created_at, updated_at)
            VALUES (?,?,?,?,'[]','\U0001f4c4','prompt','text','{}',1,0,1,0,'prompts_migration',?,
                    COALESCE(?,datetime('now','localtime')),datetime('now','localtime'))""",
            [gid, name, content, r["meaning"] or "", h, r["created_at"]])
        moved += 1
    c.commit()
    return moved

def migrate_prompt_cards():
    moved = 0
    gid = _ensure_legacy_group()
    rows = c.execute("SELECT * FROM prompt_cards WHERE is_deleted=0").fetchall()
    for r in rows:
        content = (r["content"] or "").strip()
        if not content:
            continue
        h = content_hash(content)
        existing = c.execute("SELECT id FROM word_card WHERE content_hash=? AND is_deleted=0", [h]).fetchone()
        if existing:
            continue
        name = (str(r["name"] or "") or "")[:60]
        if not name:
            name = content[:40]
        tags = str(r["tags"] or "") or "[]"
        if not tags.startswith("["):
            tags = "[]"
        c.execute("""INSERT INTO word_card
            (group_id, name, content, meaning, tags, icon, card_role, media_type,
             structured, version, sort_order, is_builtin, is_deleted, source, content_hash, created_at, updated_at)
            VALUES (?,?,?,?,?,'\U0001f4c4','prompt','text','{}',1,0,0,0,'prompt_cards_migration',?,
                    COALESCE(?,datetime('now','localtime')),datetime('now','localtime'))""",
            [gid, name, content, r["meaning"] or "", tags, h, r["created_at"]])
        moved += 1
    c.commit()
    return moved

n1 = migrate_prompts()
n2 = migrate_prompt_cards()
total = c.execute("SELECT COUNT(*) c FROM word_card").fetchone()["c"]
print(f"迁移完成: prompts->word_card {n1}, prompt_cards->word_card {n2}")
print(f"word_card 总量: {total}")
c.close()
