"""
API 路由 — Phase 6: 组装器 v3（基于 prompt_cards 的智能编排）
Phase 14.1 重构:
  - 修复 FIELD_MAP 重复 key
  - compose 端点接入共享组装引擎（5格式/3密度/音频）
  - 创建时调用 _recalculate 确保时间轴正确
"""
import json
from fastapi import APIRouter, Query, HTTPException
from database import get_db, safe_commit
from .composer_engine import compose_full

router = APIRouter(prefix="/api/v4/composer", tags=["v4-composer"])

# 结构化字段 → 场景字段 映射表（去重后18条）
FIELD_MAP = {
    'subject': 'subject',
    'scene_desc': 'scene_desc',
    'scene': 'scene_desc',
    'composition': 'composition',
    'lighting': 'lighting',
    'camera_move': 'camera_move',
    'camera': 'camera_move',
    'action': 'action',
    'motion': 'action',
    'focal_length': 'focal_length',
    'texture': 'texture',
    'speed': 'speed',
    'emotion': 'emotion',
    'mood': 'emotion',
    'color_grade': 'color_grade',
    'weather': 'weather',
    'particles': 'particles',
    'perspective': 'perspective',
    'depth_of_field': 'depth_of_field',
    'filter': 'filter',
    'natural_force': 'natural_force',
    'environment_detail': 'environment_detail',
    'film_flaw': 'film_flaw',
    'fantasy_physics': 'fantasy_physics',
    'style': 'texture',
}


@router.post("/projects")
def create_composer_project(data: dict):
    """从选中的 prompt_cards 创建组装器项目（自动映射字段到场景）"""
    name = data.get('name', '新项目')
    card_ids = data.get('card_ids', [])
    if not card_ids:
        return {'ok': False, 'error': '请选择至少一张提示词卡'}
    
    db = get_db()
    
    # 1. 创建项目
    ar = data.get('aspect_ratio', '16:9')
    res = data.get('resolution', '1080p')
    dur = data.get('total_duration', 15)
    global_style = data.get('global_style', '')
    negative_prompt = data.get('negative_prompt', '')
    
    cur = db.execute("""
        INSERT INTO user_project 
            (name, total_duration, aspect_ratio, resolution, global_style, negative_prompt)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (name, dur, ar, res, global_style, negative_prompt))
    project_id = cur.lastrowid
    
    # 2. 逐张卡片创建场景
    scene_duration = max(2, min(8, dur // max(len(card_ids), 1)))
    total_dur_input = 0
    
    for order, card_id in enumerate(card_ids):
        card = db.execute(
            "SELECT * FROM prompt_cards WHERE id=? AND is_deleted=0", (card_id,)
        ).fetchone()
        if not card:
            continue
        
        card = dict(card)
        sf = json.loads(card.get('structured_fields') or '{}')
        
        # 3. 结构化字段映射到场景字段
        scene_data = {v: '' for v in [
            'camera_move','subject','scene_desc','shot_scale','composition','lighting','action',
            'focal_length','texture','speed','emotion','color_grade','weather',
            'particles','perspective','depth_of_field','filter','natural_force',
            'environment_detail','film_flaw','fantasy_physics'
        ]}
        
        for sf_key, sf_val in sf.items():
            if sf_val and sf_key in FIELD_MAP:
                target = FIELD_MAP[sf_key]
                scene_data[target] = sf_val
        
        start_time = total_dur_input
        end_time = total_dur_input + scene_duration
        total_dur_input = end_time
        
        if order == len(card_ids) - 1 and total_dur_input < dur:
            end_time = dur
            total_dur_input = dur
        
        db.execute("""
            INSERT INTO user_project_scene
                (project_id, scene_order, start_time, end_time,
                 camera_move, subject, scene_desc, shot_scale, composition, lighting,
                 action, focal_length, texture, speed, emotion, color_grade,
                 weather, particles, perspective, depth_of_field, filter,
                 natural_force, environment_detail, film_flaw, fantasy_physics)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            project_id, order + 1, start_time, end_time,
            scene_data['camera_move'], scene_data['subject'], scene_data['scene_desc'],
            scene_data['shot_scale'], scene_data['composition'], scene_data['lighting'],
            scene_data['action'],
            scene_data['focal_length'], scene_data['texture'], scene_data['speed'],
            scene_data['emotion'], scene_data['color_grade'], scene_data['weather'],
            scene_data['particles'], scene_data['perspective'], scene_data['depth_of_field'],
            scene_data['filter'], scene_data['natural_force'], scene_data['environment_detail'],
            scene_data['film_flaw'], scene_data['fantasy_physics']
        ))
    
    # 创建后重算时间轴
    from .seedance_v2 import _recalculate_scene_times
    _recalculate_scene_times(project_id)
    safe_commit()
    return {'ok': True, 'project_id': project_id}


@router.get("/cards-available")
def list_composer_cards(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    card_type: str = Query(None),
    search: str = Query(None)
):
    """获取可用于组装的提示词卡列表（含结构化字段摘要）"""
    db = get_db()
    where = ['is_deleted=0']
    params = []
    
    if card_type:
        where.append('card_type=?')
        params.append(card_type)
    if search:
        where.append('(content LIKE ? OR meaning LIKE ? OR name LIKE ?)')
        s = f'%{search}%'
        params.extend([s, s, s])
    
    w = ' AND '.join(where)
    offset = (page - 1) * page_size
    total = db.execute(f'SELECT COUNT(*) as c FROM prompt_cards WHERE {w}', params).fetchone()['c']
    rows = db.execute(
        f"SELECT id, card_type, name, content, meaning, module, category, "
        f"usage_count, structured_fields FROM prompt_cards WHERE {w} "
        f"ORDER BY usage_count DESC, id DESC LIMIT ? OFFSET ?",
        params + [page_size, offset]
    ).fetchall()
    
    items = []
    for r in rows:
        item = dict(r)
        item['structured_fields'] = json.loads(item.get('structured_fields') or '{}')
        items.append(item)
    
    return {'ok': True, 'items': items, 'total': total, 'page': page, 'page_size': page_size}


@router.get("/projects/{project_id}/compose")
def compose_project(project_id: int,
                    format: str = Query("seedance"),
                    density: str = Query("standard"),
                    include_audio: bool = Query(False)):
    """
    生成项目的输出提示词文本（使用共享组装引擎）
    
    参数:
      format: seedance|kling|minimax|comfyui|raw (default: seedance)
      density: compact|standard|detailed (default: standard)
      include_audio: 是否含音频 (default: false)
    """
    db = get_db()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", (project_id,)).fetchone()
    if not proj:
        raise HTTPException(status_code=404, detail='项目未找到')
    
    scenes = db.execute(
        "SELECT * FROM user_project_scene WHERE project_id=? ORDER BY scene_order",
        (project_id,)
    ).fetchall()
    
    if not scenes:
        return {'ok': True, 'output': '', 'output_json': {'header': '', 'scenes': []}}
    
    # 使用共享组装引擎
    result = compose_full(scenes, dict(proj), fmt=format, density=density,
                          include_audio=include_audio, db=db)
    
    # 向后兼容的字段映射
    return {
        'ok': True,
        'output': result['text'],
        'output_json': result['json'],
        'length': result['length'],
        'shot_count': result['shot_count'],
        'duration': result['duration'],
        'format': result['format'],
        'density': result['density'],
        'pixel_res': result['pixel_res'],
    }
