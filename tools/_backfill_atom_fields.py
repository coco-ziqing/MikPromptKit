import sqlite3
db = sqlite3.connect(r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data\prompts.db')

SCENE_MAP = {
    "subject": "用于定义画面主体人物/对象的外观特征",
    "style": "用于定义画面的艺术风格和视觉调性",
    "composition": "用于定义画面的构图方式和取景角度",
    "lighting": "用于定义画面的光源方向和光影效果",
    "color": "用于定义画面的色彩倾向和色调氛围",
    "quality": "用于定义画面的技术画质和细节参数",
    "camera": "用于定义镜头焦段、光圈和拍摄设备",
    "atmosphere": "用于定义画面的情绪氛围和意境",
    "tone": "用于定义画面的色调风格和滤镜效果",
    "negative": "负面提示词 - 排除不希望出现的元素",
    "constraint": "限制条件 - 约束AI生成边界",
    "creative": "创意元素 - 添加特殊视觉效果或装饰",
    "action": "用于定义画面中的动态动作或运动方式",
}

import json

rows = db.execute("SELECT id, content, category, module, media_type, source FROM word_card WHERE source='atom_decompose' AND is_deleted=0").fetchall()
updated = 0
for r in rows:
    cid, content, cat, mod, mtype, src = r
    
    # Update meaning from content keywords
    db.execute("UPDATE word_card SET meaning=? WHERE id=?", [content[:80], cid])
    
    # Update scene
    scene = SCENE_MAP.get(mod, f"[{mod}] 类型原子提示词")
    db.execute("UPDATE word_card SET scene=? WHERE id=?", [scene, cid])
    
    # Update structured
    structured = json.dumps({"atom_type": mod, "weight": 0.5, "keywords": []}, ensure_ascii=False)
    db.execute("UPDATE word_card SET structured=? WHERE id=?", [structured, cid])
    
    # Update version
    db.execute("UPDATE word_card SET version=1 WHERE id=?", [cid])
    
    updated += 1

db.commit()
print(f"[DONE] Updated {updated} atom cards")
