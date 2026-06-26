# Phase16-v5.2.0: 提示词组装器联动体系深度优化 — Analysis & Upgrade Plan

## 📅 Session Date
**Fri 2026-06-26 07:30 GMT+8 (Asia/Shanghai)**  

--- 

## 🔍一、当前架构分析（Phase15→Phase16）

### 核心模块关系图：
```
┌─────────────────┐      ┌──────────────┐     ┌─────────────────┐  
│   角色库 system │ →→→→>│ Atom Extractor ├⇒ =>│ Composer Engine │ 
│ (characters.py) │      │ atom_decomp. │     │ composer_engine.│
└─────────────────┘      └──────────────┘     └─────────────────┘  
         ↑                   ↓                       ↑                  
    scene_composer          word_cards              输出提示词模板      
```

### 🎯Phase16优化目标：选择角色/场景模板→自动填充对应的原子化词卡
**现状：**
- ✅已有基础的角色注入逻辑（appearance →subject）
- ⚠️缺少智能映射机制：`SELECT character_id → word_card_group[atom/composition]`  
- ❌无统一 API 处理「模板选择→词库扫描→自动填充」全流程

--- 

## 📐二、优化方案设计

### Step1:创建 Atom Bridge Mapping表（扩展 atom_word_bridge）
**目的**:建立 角色/场景ID ↔原子化词卡列表的映射关系  

```sql  
ALTER TABLE word_card_group ADD COLUMN template_ref_id INTEGER DEFAULT NULL; -- ←模板引用列
CREATE INDEX idx_template_atom ON (template_ref_id, group_type); 
-- →支持「选择某个角色的 scene」→自动返回该角色对应的 composition/atom 类词卡

INSERT INTO atom_word_bridge(template_ref_id, keywords_match) VALUES  
    (?, ARRAY['长发','白皙', '坚韧']) -- ←从 appearance/personality 提取的关键词
```  

### Step2:更新 Composer Engine（在现有逻辑内扩展）


**修改点**:composer_engine.py → _fill_atoms_by_character(char_vis, db)

```python
def _fill_atoms_by_character(char_vis, db):
    """根据角色自动填充原子化词卡 (Phase16-v5.2.0)""" 
# 从 appearance/personality/occupation提取关键词  
keywords = set(re.findall(r'[\u4e00-\u9fff]{3,+},appearance)) ∪ {re.findal...}
    # ←返回前 N(如 8)个高频词，供场景维度匹配
    
    for kw in keywords: 
        cards = db.execute("""  
            SELECT id, name, content FROM word_card WHERE 
                (content LIKE ? OR tags LIKE?) AND group_type IN ('atom','composition')
            ORDER BY usage_count DESC LIMIT?""", [f"%{kw}%"']*3]
```

### Step-三：统一填充 API（新增） 

**路由**: `POST /api/composer/template-fill`  
**Body示例：**
```json 
{
    "scene_id":1,        // 场景模板 ID(从 scene_composer.py)
    "character_id":3,   //角色 ID (from characters.py)
    "auto_match_keywords:true"    
}

返回: {ok:,filled_atoms:[{"card_id":1,"content":"留着飘逸长发"},{"keyword":"坚韧"...}]...}


## 🚀三、实施计划（优先级排序）  

| 任务 |文件 |工作量 | 预计耗时 P0-P3  
───────┴────────────────────────┴────────---┬────────  
✅P-1:创建 atom_bridge 表迁移脚本 → migrate_template_atom_bridge_v520.sql   ───→Phase16.1
 ✅P-2：更新 composer_engine.add _fill_atoms_by_character()函数              ────→ Phase16.2  
⚠️ P3 :新增 /api/composer/template-fill 统一 API                            ----->Phase16.3 
 ⏳ -4:前端联动面板（角色/场景选择时自动加载原子卡）                        -------->待评估

--- 

## ✅四、验证标准  

- [ ] 测试 Case-1：选择"主角・李明"(ID=2) + "赛博朋克都市"(scene_id=3): →返回 composition+atom 类词卡 (预期:>=5 条匹配)
  - [ ]原子化填充内容出现在 subject/场景描述的正确位置  
  - [-]无阻塞性异常（即使部分数据库查询失败也不影响正常组装）  

- (- )测试 Case2：高频角色(usage_count>10)+高热度关键词→自动优先返回这些词卡

--- 

## 📊五、性能优化建议  

**原子化填充策略**:
  - 预计算常用角色的 keywords hash（MD5 缓存到 atom_decompose.source_hash）  
  - 仅对 character_id/scene_profile_id变化的镜头重新扫描 word_card
  
**数据库索引：**
  ```sql CREATE INDEX idx_kw_match ON (content, tags) WHERE group_type IN ('atom','composition') 
```

--- 

## 📝六、待办事项（TodoList）  

- [ ]1.创建 migrate_template_atom_bridge_v520.sql，执行后刷新 DB  
  - (- )幂等性验证：重复运行不报错
  - [-]索引覆盖率>80% (keywords_match, template_ref_id) 

[ ]2.py 更新 composer_engine.py:在角色注入部分调用_fill_atoms_by_character()  

- [3.新增 /api/composer/template-fill API，返回自动填充的原子卡列表  
  - (- )文档补充：OpenAPI/YAML spec
  - [-]单元测试（pytest）覆盖边界条件

[ ]4前端联动面板（可选 P2,非阻塞性) 
  - [-]场景编辑器添加「智能词库匹配」开关
  - [- ]展示原子卡热力图（高频→低频可视化）

--- 

## 🔗七、相关技术栈  

|组件 |版本/路径  
────────┴───────  
数据库：SQLite (WAL+FTS5)  
API:FastAPI + Pydantic  
AI引擎：Ollama 本地大模型池(16 个模型)  
前端：Bootstrap-CDN Vanilla JS SPA

--- 

## 📞八、联系方式 &反馈渠道  

**问题提报**:openclaw-tasks → session_key="phase16-review"  
**性能监控**:GET /api/composer/template-fill/stats →返回填充耗时/命中率统计   

