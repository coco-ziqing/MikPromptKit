"""
API 路由 — Phase 1: 统一提示词卡 + 词库资产 API
兼容旧 prompts 表接口，逐步过渡到新 prompt_cards 表
"""
import json
from fastapi import APIRouter, Query, HTTPException
from database import get_db, safe_commit

router = APIRouter(prefix="/api/v4", tags=["v4-cards"])


# ==================== 1. 提示词卡 CRUD ====================

@router.get("/cards")
def list_cards(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    card_type: str = Query(None, regex='^(image|video|all)?$'),
    module: str = Query(None),
    search: str = Query(None),
    category: str = Query(None),
    sort: str = Query('created_at', regex='^(created_at|usage_count|updated_at|name)$'),
    order: str = Query('desc', regex='^(asc|desc)$')
):
    """统一提示词卡列表（兼容新旧数据）"""
    db = get_db()
    where = ['pc.is_deleted=0']
    params = []
    
    if card_type and card_type != 'all':
        where.append('pc.card_type=?')
        params.append(card_type)
    if module:
        where.append('pc.module=?')
        params.append(module)
    if category:
        where.append('pc.category=?')
        params.append(category)
    if search:
        where.append('(pc.content LIKE ? OR pc.meaning LIKE ? OR pc.name LIKE ? OR pc.tags LIKE ?)')
        s = f'%{search}%'
        params.extend([s, s, s, s])
    
    w = ' AND '.join(where)
    sort_col = sort if sort in ['created_at','usage_count','updated_at','name'] else 'created_at'
    sort_dir = 'DESC' if order == 'desc' else 'ASC'
    
    total = db.execute(f'SELECT COUNT(*) as c FROM prompt_cards pc WHERE {w}', params).fetchone()['c']
    
    offset = (page - 1) * page_size
    rows = db.execute(
        f'SELECT * FROM prompt_cards pc WHERE {w} ORDER BY pc.{sort_col} {sort_dir} LIMIT ? OFFSET ?',
        params + [page_size, offset]
    ).fetchall()
    
    items = []
    for r in rows:
        item = dict(r)
        item['structured_fields'] = json.loads(item.get('structured_fields') or '{}')
        item['tags'] = item.get('tags') or '[]'
        item['library_refs'] = json.loads(item.get('library_refs') or '[]')
        # 附加媒体信息（兼容旧渲染）
        thumb = db.execute("SELECT filename, media_type FROM prompt_thumbnails WHERE prompt_id=?", (item['id'],)).fetchone()
        video = db.execute("SELECT filename, duration FROM prompt_videos WHERE prompt_id=?", (item['id'],)).fetchone()
        item['thumbnail'] = thumb['filename'] if thumb else ''
        item['media_type'] = thumb['media_type'] if thumb else 'image'
        item['video_filename'] = video['filename'] if video else ''
        # 兼容旧渲染：收藏信息
        colls = db.execute(
            "SELECT c.id, c.name, c.icon FROM collections c "
            "JOIN collection_items ci ON c.id=ci.collection_id WHERE ci.prompt_id=?",
            (item['id'],)
        ).fetchall()
        item['collections'] = [dict(c) for c in colls]
        items.append(item)
    
    total_pages = max(1, -(-total // page_size))
    return {'ok': True, 'items': items, 'total': total, 'total_pages': total_pages, 'page': page, 'page_size': page_size}


@router.get("/cards/{card_id}")
def get_card(card_id: int):
    """获取单张提示词卡（含媒体+词库引用+版本）"""
    db = get_db()
    r = db.execute("SELECT * FROM prompt_cards WHERE id=? AND is_deleted=0", (card_id,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail='卡片不存在')
    item = dict(r)
    item['structured_fields'] = json.loads(item.get('structured_fields') or '{}')
    item['tags'] = item.get('tags') or '[]'
    lib_refs = json.loads(item.get('library_refs') or '[]')
    item['library_refs'] = lib_refs
    
    # 附加媒体资产
    media = db.execute("SELECT * FROM media_assets WHERE prompt_id=? ORDER BY created_at DESC", (card_id,)).fetchall()
    item['media'] = [dict(m) for m in media]
    
    # 附加词库引用详情
    lib_details = []
    for ref in lib_refs:
        if isinstance(ref, dict) and 'id' in ref:
            lib = db.execute("SELECT id, lib_type, name, prompt FROM library_assets WHERE id=?", (ref['id'],)).fetchone()
            if lib:
                d = dict(lib)
                d['field'] = ref.get('field', '')
                lib_details.append(d)
    item['library_details'] = lib_details
    
    # 附加版本历史
    versions = db.execute(
        "SELECT id, version, content, meaning, change_note, created_at FROM prompt_versions WHERE prompt_id=? ORDER BY version DESC LIMIT 5",
        (card_id,)
    ).fetchall()
    item['versions'] = [dict(v) for v in versions]
    
    # 附加收藏信息
    collections = db.execute(
        "SELECT c.id, c.name, c.icon FROM collections c JOIN collection_items ci ON c.id=ci.collection_id WHERE ci.prompt_id=?",
        (card_id,)
    ).fetchall()
    item['collections'] = [dict(c) for c in collections]
    
    # 附加使用统计
    usage = db.execute("SELECT COUNT(*) as c FROM usage_history WHERE prompt_id=?", (card_id,)).fetchone()['c']
    item['usage_history_count'] = usage
    
    return {'ok': True, 'card': item}


@router.post("/cards")
def create_card(data: dict):
    """创建提示词卡"""
    db = get_db()
    sf = json.dumps(data.get('structured_fields', {}), ensure_ascii=False)
    tags = json.dumps(data.get('tags', []), ensure_ascii=False)
    lib_refs = json.dumps(data.get('library_refs', []), ensure_ascii=False)
    
    cur = db.execute("""
        INSERT INTO prompt_cards 
            (card_type, name, content, meaning, scene, module, category,
             tags, structured_fields, library_refs, is_builtin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get('card_type', 'image'),
        data.get('name', ''),
        data.get('content', ''),
        data.get('meaning', ''),
        data.get('scene', ''),
        data.get('module', 'custom'),
        data.get('category', ''),
        tags, sf, lib_refs,
        data.get('is_builtin', 0)
    ))
    safe_commit()
    return {'ok': True, 'id': cur.lastrowid}


@router.put("/cards/{card_id}")
def update_card(card_id: int, data: dict):
    """更新提示词卡（编辑前自动存档当前版本）"""
    db = get_db()
    current = db.execute("SELECT * FROM prompt_cards WHERE id=? AND is_deleted=0", (card_id,)).fetchone()
    if not current:
        raise HTTPException(status_code=404, detail='卡片不存在')

    # 自动存档：编辑前将当前完整内容存入版本历史
    change_note = data.get('change_note', '') or ''
    if data.get('content') is not None or data.get('structured_fields') is not None:
        # 计算下一个版本号
        last_ver = db.execute(
            "SELECT MAX(version) as max_v FROM prompt_versions WHERE prompt_id=?",
            (card_id,)
        ).fetchone()
        next_ver = (last_ver['max_v'] or 0) + 1
        current_ver = current['version'] or 0

        db.execute("""
            INSERT INTO prompt_versions
                (prompt_id, content, meaning, scene, change_note, version)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            card_id,
            current['content'] or '',
            current['meaning'] or '',
            current['scene'] or '',
            change_note or '编辑存档',
            next_ver
        ])

    fields = []
    params = []
    for key in ['card_type','name','content','meaning','scene','module','category']:
        if key in data:
            fields.append(f'{key}=?')
            params.append(data[key])
    # 编辑时自动递增版本号
    if data.get('content') is not None or data.get('structured_fields') is not None:
        fields.append('version=?')
        params.append((current['version'] or 0) + 1)
    if 'structured_fields' in data:
        fields.append('structured_fields=?')
        params.append(json.dumps(data['structured_fields'], ensure_ascii=False))
    if 'tags' in data:
        fields.append('tags=?')
        params.append(json.dumps(data['tags'], ensure_ascii=False))
    if 'library_refs' in data:
        fields.append('library_refs=?')
        params.append(json.dumps(data['library_refs'], ensure_ascii=False))

    if fields:
        fields.append("updated_at=datetime('now','localtime')")
        params.append(card_id)
        db.execute(f'UPDATE prompt_cards SET {",".join(fields)} WHERE id=?', params)
        safe_commit()

    return {'ok': True}


@router.delete("/cards/{card_id}")
def delete_card(card_id: int, permanent: bool = Query(False)):
    """删除提示词卡（默认软删除）"""
    db = get_db()
    if permanent:
        db.execute("DELETE FROM prompt_cards WHERE id=?", (card_id,))
    else:
        db.execute("UPDATE prompt_cards SET is_deleted=1, deleted_at=datetime('now','localtime') WHERE id=?", (card_id,))
    safe_commit()
    return {'ok': True}


# ==================== 2. 词库资产 CRUD ====================

@router.get("/library")
def list_library(
    lib_type: str = Query(None),
    category: str = Query(None),
    search: str = Query(None)
):
    """统一词库资产列表"""
    db = get_db()
    where = ['1=1']
    params = []
    
    if lib_type:
        where.append('lib_type=?')
        params.append(lib_type)
    if category:
        where.append('category=?')
        params.append(category)
    if search:
        where.append('(name LIKE ? OR prompt LIKE ? OR definition LIKE ?)')
        s = f'%{search}%'
        params.extend([s, s, s])
    
    w = ' AND '.join(where)
    rows = db.execute(f'SELECT * FROM library_assets WHERE {w} ORDER BY sort_order, id', params).fetchall()
    
    items = [dict(r) for r in rows]
    return {'ok': True, 'items': items, 'total': len(items)}


@router.get("/library/types")
def list_library_types():
    """获取词库类型列表（含各类的数量）"""
    db = get_db()
    rows = db.execute("""
        SELECT lib_type, COUNT(*) as cnt 
        FROM library_assets 
        GROUP BY lib_type 
        ORDER BY cnt DESC
    """).fetchall()
    return {'ok': True, 'types': [dict(r) for r in rows]}


@router.get("/library/categories")
def list_library_categories(lib_type: str = Query(None)):
    """获取词库分类列表"""
    db = get_db()
    where = ['1=1']
    params = []
    if lib_type:
        where.append('lib_type=?')
        params.append(lib_type)
    
    rows = db.execute(f"""
        SELECT lib_type, category, icon, COUNT(*) as cnt 
        FROM library_assets WHERE {' AND '.join(where)}
        GROUP BY lib_type, category 
        ORDER BY cnt DESC
    """, params).fetchall()
    return {'ok': True, 'categories': [dict(r) for r in rows]}


@router.post("/library")
def create_library_item(data: dict):
    """创建词库条目"""
    db = get_db()
    cur = db.execute("""
        INSERT INTO library_assets 
            (lib_type, name, icon, category, prompt, definition, tags, is_builtin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data['lib_type'], data['name'], data.get('icon', ''),
        data.get('category', ''), data.get('prompt', ''),
        data.get('definition', ''),
        json.dumps(data.get('tags', []), ensure_ascii=False),
        data.get('is_builtin', 0)
    ))
    safe_commit()
    return {'ok': True, 'id': cur.lastrowid}


@router.put("/library/{item_id}")
def update_library_item(item_id: int, data: dict):
    """更新词库条目"""
    db = get_db()
    fields = []
    params = []
    for key in ['lib_type','name','icon','category','prompt','definition']:
        if key in data:
            fields.append(f'{key}=?')
            params.append(data[key])
    if 'tags' in data:
        fields.append('tags=?')
        params.append(json.dumps(data['tags'], ensure_ascii=False))
    
    if fields:
        fields.append("updated_at=datetime('now','localtime')")
        params.append(item_id)
        db.execute(f'UPDATE library_assets SET {",".join(fields)} WHERE id=?', params)
        safe_commit()
    
    return {'ok': True}


@router.delete("/library/{item_id}")
def delete_library_item(item_id: int):
    """删除词库条目"""
    db = get_db()
    db.execute("DELETE FROM library_assets WHERE id=?", (item_id,))
    safe_commit()
    return {'ok': True}


@router.get("/library/{item_id}")
def get_library_item(item_id: int):
    """获取单条词库条目"""
    db = get_db()
    r = db.execute("SELECT * FROM library_assets WHERE id=?", (item_id,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="条目未找到")
    return {'ok': True, 'item': dict(r)}


@router.get("/library/export")
def export_library(lib_type: str = Query(None)):
    """导出词库为 JSON"""
    db = get_db()
    if lib_type:
        rows = db.execute("SELECT * FROM library_assets WHERE lib_type=? ORDER BY sort_order", (lib_type,)).fetchall()
    else:
        rows = db.execute("SELECT * FROM library_assets ORDER BY lib_type, sort_order").fetchall()
    return {'ok': True, 'items': [dict(r) for r in rows], 'total': len(rows)}


@router.post("/library/batch-import")
def batch_import_library(data: dict):
    """批量导入词库条目"""
    items = data.get('items', [])
    if not items:
        return {'ok': False, 'error': '未提供条目'}
    db = get_db()
    imported = 0
    for item in items:
        try:
            db.execute("""INSERT INTO library_assets
                (lib_type, name, icon, category, prompt, definition, tags, is_builtin, sort_order)
                VALUES (?,?,?,?,?,?,?,?,?)""", (
                item.get('lib_type','custom'), item.get('name',''), item.get('icon',''),
                item.get('category',''), item.get('prompt',''), item.get('definition',''),
                json.dumps(item.get('tags',[]), ensure_ascii=False), 0, 0
            ))
            imported += 1
        except Exception:
            pass
    safe_commit()
    return {'ok': True, 'imported': imported}


@router.get("/library/stats")
def library_stats():
    """词库使用统计"""
    db = get_db()
    rows = db.execute("""SELECT la.id, la.name, la.lib_type, la.category,
        COUNT(pc.id) as ref_count
        FROM library_assets la
        LEFT JOIN prompt_cards pc ON pc.library_refs LIKE '%"'||la.id||'"%'
        GROUP BY la.id ORDER BY ref_count DESC, la.sort_order LIMIT 100""").fetchall()
    return {'ok': True, 'stats': [dict(r) for r in rows]}


# ==================== 3. 媒体资产统一管理 ====================

@router.get("/media")
def list_media(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    media_type: str = Query(None),
    prompt_id: int = Query(None)
):
    """统一媒体资产列表"""
    db = get_db()
    where = ['1=1']
    params = []
    if media_type:
        where.append('media_type=?')
        params.append(media_type)
    if prompt_id is not None:
        where.append('prompt_id=?')
        params.append(prompt_id)
    w = ' AND '.join(where)
    offset = (page - 1) * page_size
    total = db.execute(f'SELECT COUNT(*) as c FROM media_assets WHERE {w}', params).fetchone()['c']
    rows = db.execute(f'SELECT * FROM media_assets WHERE {w} ORDER BY created_at DESC LIMIT ? OFFSET ?',
                      params + [page_size, offset]).fetchall()
    return {'ok': True, 'items': [dict(r) for r in rows], 'total': total, 'page': page, 'page_size': page_size}


@router.put("/media/{media_id}")
def update_media(media_id: int, data: dict):
    """更新媒体资产元数据"""
    db = get_db()
    db.execute("UPDATE media_assets SET prompt_id=?, updated_at=datetime('now','localtime') WHERE id=?",
               (data.get('prompt_id', 0), media_id))
    safe_commit()
    return {'ok': True}


# ==================== 4. 统一搜索 ====================

@router.get("/search")
def unified_search(
    q: str = Query(''),
    scope: str = Query('all', regex='^(all|cards|library|media)$'),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100)
):
    """统一搜索（多表联合）"""
    db = get_db()
    result = {'cards': [], 'library': [], 'media': [], 'total': 0}
    if not q.strip():
        return {'ok': True, **result}
    s = f'%{q}%'
    offset_val = (page - 1) * page_size
    if scope in ('all', 'cards'):
        cards = db.execute(
            "SELECT id, card_type, name, content, meaning, module FROM prompt_cards "
            "WHERE is_deleted=0 AND (content LIKE ? OR meaning LIKE ? OR name LIKE ?) "
            "ORDER BY usage_count DESC LIMIT ? OFFSET ?",
            (s, s, s, page_size, offset_val)
        ).fetchall()
        result['cards'] = [dict(r) for r in cards]
    if scope in ('all', 'library'):
        libs = db.execute(
            "SELECT id, lib_type, name, category, prompt FROM library_assets "
            "WHERE name LIKE ? OR prompt LIKE ? OR category LIKE ? "
            "ORDER BY usage_count DESC LIMIT ? OFFSET ?",
            (s, s, s, page_size, offset_val)
        ).fetchall()
        result['library'] = [dict(r) for r in libs]
    if scope in ('all', 'media'):
        media = db.execute(
            "SELECT id, filename, original_filename, media_type FROM media_assets "
            "WHERE original_filename LIKE ? OR filename LIKE ? "
            "ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (s, s, page_size, offset_val)
        ).fetchall()
        result['media'] = [dict(r) for r in media]
    result['total'] = len(result['cards']) + len(result['library']) + len(result['media'])
    return {'ok': True, **result}


@router.get("/cards/{card_id}/full")
def get_card_full(card_id: int):
    """卡片完整详情（含媒体+词库引用+收藏+使用记录）"""
    db = get_db()
    r = db.execute("SELECT * FROM prompt_cards WHERE id=? AND is_deleted=0", (card_id,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail='卡片不存在')
    item = dict(r)
    item['structured_fields'] = json.loads(item.get('structured_fields') or '{}')
    item['tags'] = item.get('tags') or '[]'
    lib_refs = json.loads(item.get('library_refs') or '[]')
    item['library_refs'] = lib_refs
    item['media'] = [dict(m) for m in db.execute(
        "SELECT * FROM media_assets WHERE prompt_id=? ORDER BY created_at DESC", (card_id,)
    ).fetchall()]
    item['library_details'] = []
    for ref in lib_refs:
        ref_id = ref.get('id') if isinstance(ref, dict) else int(ref)
        lib = db.execute("SELECT id, lib_type, name, prompt FROM library_assets WHERE id=?", (ref_id,)).fetchone()
        if lib:
            d = dict(lib)
            d['field'] = ref.get('field', '') if isinstance(ref, dict) else ''
            item['library_details'].append(d)
    item['usage_count_total'] = db.execute(
        "SELECT COUNT(*) as c FROM usage_history WHERE prompt_id=?", (card_id,)
    ).fetchone()['c']
    item['collections'] = [dict(c) for c in db.execute(
        "SELECT c.id, c.name, c.icon FROM collections c "
        "JOIN collection_items ci ON c.id=ci.collection_id WHERE ci.prompt_id=?", (card_id,)
    ).fetchall()]
    return {'ok': True, 'card': item}


@router.post("/cards/{card_id}/rollback")
def rollback_card(card_id: int, data: dict):
    """回滚提示词卡到指定版本（完整恢复所有字段，回滚前存档当前版本）"""
    version = data.get("version")
    if not version:
        return {"ok": False, "error": "缺少版本号"}
    db = get_db()
    current = db.execute("SELECT * FROM prompt_cards WHERE id=? AND is_deleted=0", (card_id,)).fetchone()
    if not current:
        return {"ok": False, "error": "卡片不存在"}
    row = db.execute(
        "SELECT * FROM prompt_versions WHERE prompt_id=? AND version=?",
        (card_id, version)
    ).fetchone()
    if not row:
        return {"ok": False, "error": "版本未找到"}

    # 回滚前将当前内容存档
    last_ver = db.execute(
        "SELECT MAX(version) as max_v FROM prompt_versions WHERE prompt_id=?",
        (card_id,)
    ).fetchone()
    next_ver = (last_ver['max_v'] or 0) + 1
    db.execute("""
        INSERT INTO prompt_versions
            (prompt_id, content, meaning, scene, change_note, version)
        VALUES (?, ?, ?, ?, ?, ?)
    """, [card_id, current['content'] or '', current['meaning'] or '',
          current['scene'] or '', f'回滚到 v{version}', next_ver])

    # 完整恢复所有字段
    new_ver = next_ver + 1
    db.execute("""
        UPDATE prompt_cards SET
            content=?, meaning=?, scene=?,
            module=?, category=?, version=?
        WHERE id=?
    """, [
        row['content'] or '',
        row['meaning'] or '',
        row['scene'] or '',
        row['module'] or current['module'],
        row['category'] or current['category'],
        new_ver, card_id
    ])
    safe_commit()
    return {'ok': True, 'message': f'已回滚到 v{version}', 'new_version': new_ver, 'archived_as_v': next_ver}


# ==================== 7. v4 版本管理 ====================

@router.get("/cards/{card_id}/versions")
def card_version_history(card_id: int):
    """v4 卡片版本历史（含当前内容）"""
    db = get_db()
    current = db.execute("SELECT * FROM prompt_cards WHERE id=? AND is_deleted=0", (card_id,)).fetchone()
    if not current:
        return {"ok": False, "error": "卡片不存在"}

    rows = db.execute("""
        SELECT id, version, content, meaning, scene, module, category,
               change_note, created_at
        FROM prompt_versions WHERE prompt_id=?
        ORDER BY version DESC
    """, (card_id,)).fetchall()

    return {
        "ok": True,
        "current": {
            "id": current['id'],
            "version": current['version'],
            "content": current['content'],
            "meaning": current['meaning'],
            "scene": current['scene'],
            "module": current['module'],
            "category": current['category']
        },
        "versions": [dict(r) for r in rows],
        "total": len(rows)
    }


@router.get("/cards/{card_id}/versions/diff/{v1}/{v2}")
def card_version_diff(card_id: int, v1: int, v2: int):
    """v4 卡片两个版本差异对比"""
    db = get_db()
    ver1 = db.execute(
        "SELECT * FROM prompt_versions WHERE prompt_id=? AND version=?",
        (card_id, v1)
    ).fetchone()
    ver2 = db.execute(
        "SELECT * FROM prompt_versions WHERE prompt_id=? AND version=?",
        (card_id, v2)
    ).fetchone()
    if not ver1 or not ver2:
        return {"ok": False, "error": "版本不存在"}

    diffs = []
    for field in ['content', 'meaning', 'scene', 'module', 'category']:
        if ver1[field] != ver2[field]:
            diffs.append({
                "field": field,
                "old": ver1[field] or '',
                "new": ver2[field] or ''
            })

    return {
        "ok": True,
        "v1": {"version": ver1['version'], "id": ver1['id'], "created_at": ver1['created_at']},
        "v2": {"version": ver2['version'], "id": ver2['id'], "created_at": ver2['created_at']},
        "diffs": diffs,
        "total_changes": len(diffs)
    }
