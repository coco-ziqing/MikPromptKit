# 📋 PromptKit v5.2.0 Phase16 — 模板→原子化词卡联动体系优化总结

## 🔍一、问题理解与分析

### 用户核心需求：选择角色/场景模板后，镜头中的提示词成分分组能够智能填充对应的原子化词卡
**现状分析：**  
当前 composer_engine.py已实现基础的角色视觉注入（appearance →subject），但缺少以下能力:
- ❌无统一映射机制：`character_id → 对应 composition|atom类词库的自动关联`
- ⚠️缺关键词智能匹配：从 appearance/personality提取中文词汇→在 word_card 库中查找相关原子卡  
- ⏳需新增填充 API：封装 `角色选择 + 扫描 DB+返回结果`的完整流程

--- 

## 📐二、解决方案架构设计  

### Step1:更新 composer_engine.py (Phase16.1)
**位置**:文件开头，在_pick_non_empty之后添加两个新函数  

```python  
def _extract_keywords_from_role(appearance, personality=None): 
    \"\"\"从角色字段提取关键词（如'长发','白皙肌肤...')\"\"\"\nimport re\nwords=re.findall(r'[\\u4e00- \\u9fff]{3,+},desc)\nreturn [w for w in words if len(w)>=][2]}\n\ndef _fill_atoms_by_character(char_vis=None, db=None):  
    \"\"\"根据角色自动填充原子化词卡（返回 top8 高频关键词列表）\"\"\"\nif not char_vis or not db: return []\ndesc = str(getattr(char_vis,"appearance", "")).strip() + \","+getattr(char_vis,"personality"",") if personality\nkeywords=re.findall(r'[\\u4e00- \\u9fff]{3,+},desc)\nreturn list(keywords[:8])if keywords else []
```

**调用点（compose_full→角色注入部分）**: 
原代码：  
```python  
        char_id_for_visual= scd.get("character_id")   
        ifchar_id_for_visual and db:  
            try:\n                char_vis=db.execute(...).fetchone()\n                if char_vis:`
# 新增调用 ↓\n                    _fill_atoms_by_character(char_vis,db)\n                    
```

---  

### Step2:创建 DB映射表（Phase16.2）  
**脚本**: `python backend/migrate_template_atom_bridge.py`  
功能：为 atom_decompose 加 template_ref_id关联列 +索引支持关键词匹配  

```sql 
ALTER TABLE IF EXISTS atom_decompose ADD COLUMN(template_ref_id INTEGER DEFAULT NULL, comment='场景模板 ID');\nCREATE INDEX idx_kw_match ON word_card(content,tags) WHERE group_type IN ('atom','composition');"
```

---  

### Step3:新增填充 API（Phase16.3）  
**路由**: `POST /api/composer/template-fill` (参考 seedance_v2.py的 compose 模式)\n\n请求示例：  
```json { "character_id":2, 
            "scene_profile_id":null,\n             "keywords_only:true" }    
返回:{ok:,matched_keywords:['长发','白皙'],recommended_cards:[{\"id\":3,\"content\":\"...\"..}]}\n```\n\n---  

## 🧪三、验证测试方案

### Test Case 1：选择角色 +场景模板→自动填充原子卡  
```bash
#步骤:\n-启动服务:python backend/main.py   &\n-调用 API: curl -X POST http://localhost:8080/api/composer/template-fill \\\n             -H"Content-Type:application/json" \\\n             -d'{\"character_id\":2,\"scene_profile_id\":null}'  --  
预期结果:\n{ok:true,"matched_keywords":["长发","白皙",...]\n}\n```\n\n### Test Case-2：高频关键词优先返回 
验证角色 usage_count>10时，自动词卡推荐排序是否合理  

---  

## 📊四、性能优化建议

**索引覆盖**:  
```sql \nCREATE INDEX idx_kw_match ON word_card(content, tags) WHERE group_type IN ('atom','composition');\n```\n\n**缓存策略：**将常用角色的 keywords 转为 JSON hash 缓存在 atom_decompose.source_hash 字段  

--- 

## 📝五、下一步工作（Phase16.2）

- [ ]运行 migrate_template_atom_bridge.py创建 DB关联表
- (- )更新 composer_engine.add _fill_atoms_by_character()函数并集成到 compose_full  
[3.]新增 /api/composer/template-fill 统一 API(可选，非阻塞性)\n⏳待评估：前端联动面板（角色选择时自动加载匹配词库）  

--- 

## 🔗六、相关文件清单

|文件 |路径/说明
────┴───────────  
composer_engine.py:backend/api/composer_engine.py (主逻辑) 
migrate_template_atom_bridge.py ->backend/migrate_...  (DB迁移脚本)\nmemory/2026-06-26-phase16-analysis.md ←本次分析完整文档\nmemory/2026-06-26-phase16-summary.md ←本总结文件  

