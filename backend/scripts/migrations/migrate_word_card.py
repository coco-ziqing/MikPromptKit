"""
v4.1.0: 数据归并 — 4源 → 统一词卡池
prompts(151) + prompt_cards(151) + library_assets(233) + prompt_word_card(297)
→ word_card + word_card_group

幂等: 已归并数据不重复插入
"""
import json, hashlib, sys, os, re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db, safe_commit

db = get_db()
db.row_factory = sqlite3 = __import__('sqlite3')
db.row_factory = sqlite3.Row


def _hash_content(text):
    clean = re.sub(r'\s+', ' ', (text or '').strip().lower())
    return hashlib.md5(clean.encode()).hexdigest()[:12]


def _parse_tags(val):
    if not val: return []
    if isinstance(val, list): return val
    try: return json.loads(val)
    except Exception: return [t.strip() for t in str(val).split(",") if t.strip()]


existing = db.execute("SELECT COUNT(*) as c FROM word_card").fetchone()["c"]
if existing > 0:
    print("[迁移] word_card 已有 %d 条，跳过" % existing)
    sys.exit(0)

# ========== STEP 1: 归并词卡组 ==========
print("[迁移] Step 1: 归并词卡组...")
group_map = {}

# 从 prompt_library
for r in db.execute("SELECT * FROM prompt_library ORDER BY sort_order").fetchall():
    key = r["dimension_key"]
    if key in group_map: continue
    db.execute("INSERT INTO word_card_group (name, group_key, icon, description, group_type, sort_order) VALUES (?,?,?,?,'seedance',?)",
               [r["dimension_name"], key, '', r["description"] or '', r["sort_order"]])
    gid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    group_map["seedance:" + key] = gid

# 系统内置模块
MODULE_ICONS = {"emotion":"😊","color":"🎨","tone":"🌅","composition":"📐","seedance":"🎬","custom":"📝"}
for mod in ["emotion","color","tone","composition","seedance"]:
    db.execute("INSERT INTO word_card_group (name, group_key, icon, description, group_type, sort_order) VALUES (?,?,?,?,?,?)",
               [mod, mod, MODULE_ICONS.get(mod,"📄"), mod+" 模块词卡", "builtin", len(group_map)])
    gid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    group_map["builtin:" + mod] = gid

# 自定义模块
all_mods = [r["module"] for r in db.execute("SELECT DISTINCT module FROM prompts WHERE module NOT IN ('emotion','color','tone','composition','seedance') AND module != ''").fetchall()]
for mod in all_mods:
    db.execute("INSERT INTO word_card_group (name, group_key, icon, description, group_type, sort_order) VALUES (?,?,?,?,?,?)",
               [mod, mod, "📂", "自定义模块: "+mod, "custom", len(group_map)])
    gid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    group_map["custom:" + mod] = gid

print("  词卡组: %d 个" % len(group_map))

# ========== STEP 2: 归并词卡 ==========
print("[迁移] Step 2: 归并词卡...")
content_seen = set()
cnt = {"prompts":0, "library_assets":0, "word_card":0}

def insert_card(name, content, meaning, scene, module, category, tags, icon,
                thumbnail, preview_media, media_type, group_id, sort_order,
                is_builtin, source, source_id, usage_count=0, heat_weight=0):
    h = _hash_content(content)
    if h in content_seen: return False
    content_seen.add(h)
    db.execute("INSERT INTO word_card (name,content,meaning,scene,module,category,tags,icon,thumbnail,preview_media,media_type,group_id,sort_order,is_builtin,usage_count,heat_weight,source,source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               [name, content, meaning, scene, module, category, json.dumps(tags, ensure_ascii=False),
                icon, thumbnail, preview_media, media_type, group_id, sort_order,
                is_builtin, usage_count, heat_weight, source, source_id])
    return True

# 3a: prompts
print("  归并 prompts...")
for r in db.execute("SELECT * FROM prompts WHERE deleted_at IS NULL ORDER BY id").fetchall():
    mod = r["module"] or "custom"
    gid = group_map.get("builtin:"+mod) or group_map.get("custom:"+mod)
    thumb_row = db.execute("SELECT filename,media_type FROM prompt_thumbnails WHERE prompt_id=?", [r["id"]]).fetchone()
    vid_row = db.execute("SELECT filename FROM prompt_videos WHERE prompt_id=?", [r["id"]]).fetchone()
    name = (r["subcategory"] or r["content"] or "")[:60]
    uc = r["usage_count"] if "usage_count" in r.keys() else 0
    ib = 1 if r["is_builtin"] else 0
    if insert_card(name=name, content=r["content"], meaning=r["meaning"] or "",
                   scene=r["scene"] or "", module=mod, category=r["category"] or "",
                   tags=_parse_tags(r["tags"]), icon=MODULE_ICONS.get(mod,""),
                   thumbnail=thumb_row["filename"] if thumb_row else "",
                   preview_media=vid_row["filename"] if vid_row else "",
                   media_type=thumb_row["media_type"] if thumb_row else "image",
                   group_id=gid, sort_order=r["id"], is_builtin=ib,
                   source="prompts", source_id=r["id"], usage_count=uc):
        cnt["prompts"] += 1

# 3b: library_assets
print("  归并 library_assets...")
def_gid = group_map.get("builtin:custom")
for r in db.execute("SELECT * FROM library_assets ORDER BY sort_order").fetchall():
    name = (r["name"] or "")[:60]
    tags_val = r["tags"] if "tags" in r.keys() else ""
    uc = r["usage_count"] if "usage_count" in r.keys() else 0
    ib = 1 if r["is_builtin"] else 0
    if insert_card(name=name, content=r["prompt"] or "", meaning=r["definition"] or "",
                   scene="", module="custom", category=r["category"] or "",
                   tags=_parse_tags(tags_val), icon=r["icon"] or "",
                   thumbnail="", preview_media="", media_type="image",
                   group_id=def_gid, sort_order=r["sort_order"] or 0,
                   is_builtin=ib, source="library_assets", source_id=r["id"],
                   usage_count=uc):
        cnt["library_assets"] += 1

# 3c: prompt_word_card
print("  归并 prompt_word_card...")
for r in db.execute("SELECT wc.*, pl.dimension_key FROM prompt_word_card wc JOIN prompt_library pl ON pl.id=wc.library_id ORDER BY wc.id").fetchall():
    key = r["dimension_key"]
    gid = group_map.get("seedance:"+key) or def_gid
    name = (r["word_text"] or "")[:60]
    uc = r["usage_count"] if "usage_count" in r.keys() else 0
    hw = r["heat_weight"] if "heat_weight" in r.keys() else 0
    ib = 1 if r["is_system"] else 0
    if insert_card(name=name, content=r["word_text"] or "", meaning=r["definition"] or "",
                   scene="", module="custom", category=key, tags=[], icon="",
                   thumbnail=r["preview_image"] or "", preview_media=r["preview_video"] or "",
                   media_type="image", group_id=gid, sort_order=r["id"],
                   is_builtin=ib, source="prompt_word_card", source_id=r["id"],
                   usage_count=uc, heat_weight=hw):
        cnt["word_card"] += 1

safe_commit()

# ========== STEP 3: 统计 ==========
total = db.execute("SELECT COUNT(*) as c FROM word_card").fetchone()["c"]
print("\n  归并完成: %d 条统一词卡" % total)
print("    prompts → %d" % cnt["prompts"])
print("    library_assets → %d" % cnt["library_assets"])
print("    prompt_word_card → %d" % cnt["word_card"])

for g in db.execute("SELECT wcg.name, wcg.group_type, COUNT(wc.id) as cnt FROM word_card_group wcg LEFT JOIN word_card wc ON wc.group_id=wcg.id AND wc.is_deleted=0 GROUP BY wcg.id ORDER BY cnt DESC").fetchall():
    print("    %-22s [%-8s] %4d 张" % (g["name"], g["group_type"], g["cnt"]))

print("\n[迁移] 统一词卡池构建完成")
