"""
同步 library_assets → Seedance V2 prompt_library + prompt_word_card
让新词库在组装器选词面板中可用
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db, safe_commit

# lib_type → Seedance dimension_key 映射
DIM_MAP = {
    'action': 'action',
    'camera_move': 'camera_move',
    'lighting': 'lighting',
    'scene': 'scene',
    'emotion': 'emotion',
    'weather': 'weather',
    'speed': 'speed',
    'composition': 'composition',
    'shot_scale': 'shot_scale',
}

# 中文名称
DIM_NAMES = {
    'action': '动作词库',
    'camera_move': '运镜词库',
    'lighting': '光影词库',
    'scene': '场景词库',
    'emotion': '情绪词库',
    'weather': '天气词库',
    'speed': '速率词库',
    'composition': '构图词库',
    'shot_scale': '景别词库',
}

def run():
    db = get_db()
    total_new_libs = 0
    total_new_cards = 0
    
    for lib_type, dim_key in DIM_MAP.items():
        # 检查 prompt_library 是否已有
        existing_lib = db.execute(
            "SELECT id FROM prompt_library WHERE dimension_key=?", (dim_key,)
        ).fetchone()
        
        if existing_lib:
            lib_id = existing_lib['id']
            print(f'[已存在] prompt_library: {dim_key} (id={lib_id})')
        else:
            # 创建新词库
            cur = db.execute("""
                INSERT INTO prompt_library 
                    (dimension_key, dimension_name, category, sort_order)
                VALUES (?, ?, ?, ?)
            """, (dim_key, DIM_NAMES.get(lib_type, lib_type), 'basic', 100))
            lib_id = cur.lastrowid
            total_new_libs += 1
            print(f'[新建] prompt_library: {dim_key} (id={lib_id})')
        
        # 获取 library_assets 中该类型所有条目
        assets = db.execute(
            "SELECT name, prompt, definition FROM library_assets WHERE lib_type=? ORDER BY sort_order",
            (lib_type,)
        ).fetchall()
        
        # 检查已存在哪些词卡
        existing_words = db.execute(
            "SELECT word_text FROM prompt_word_card WHERE library_id=?", (lib_id,)
        ).fetchall()
        existing_set = set(r['word_text'] for r in existing_words)
        
        new_count = 0
        for a in assets:
            word = a['name']
            if word in existing_set:
                continue
            db.execute("""
                INSERT INTO prompt_word_card 
                    (library_id, word_text, definition, is_system, usage_count)
                VALUES (?, ?, ?, 1, 0)
            """, (lib_id, word, a['prompt']))
            new_count += 1
        
        if new_count > 0:
            total_new_cards += new_count
            print(f'  -> 新增 {new_count} 个词卡')
        else:
            print(f'  -> 无新增词卡')
        
        safe_commit()
    
    print(f'\n[完成] 新建词库: {total_new_libs} 个, 新增词卡: {total_new_cards} 个')
    
    # 打印所有 prompt_library
    rows = db.execute("SELECT id, dimension_key, dimension_name FROM prompt_library ORDER BY sort_order, id").fetchall()
    print(f'\n当前所有 Seedance 词库:')
    for r in rows:
        cnt = db.execute("SELECT COUNT(*) as c FROM prompt_word_card WHERE library_id=?", (r['id'],)).fetchone()['c']
        print(f'  [{r["id"]}] {r["dimension_key"]} - {r["dimension_name"]}: {cnt} 词')

if __name__ == '__main__':
    run()
