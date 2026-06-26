# 📐 PromptKit v5.2 — 提示词组装器完整交互流程与联动逻辑梳理

## 🔍一、前端交互层（Browser→SPA）  

### UI架构：Bootstrap5+Vanilla JS(拆分为15模块≈15,000 行)
```bash
frontend/  
├── index.html              # ←主入口 + CDN资源加载顺序 (wc_bridge → app_core→signal_lights... ) 
│   └─ <script src="wc_bridge.js">< script>    ←词库选取器（27套维度）
│       ├─ 场景模板切换     # Seedance19条预置模板+自定义场景  
│       └──角色选择器        ←8种子角色 +CRUD面板 (character_library.js) 
├── wc_bridge.js           ————侧边栏分类树（root→sub→leaf三级）
├── app_core.js            # 单页应用初始化 (+init()加载全局配置+localStorage持久化  
│   └─ init()              →_loadModules(), _renderSidebar(), renderPromptGrid... 
├── composer_compose_panel.html      ←组装器独立页面（角色模板 +场景模板选择）
└── style.css (v12.8)     # 主题变量定义：--card-bg --tag- bg ————支持深色/浅色切换  
```  

### 📍用户操作序列（Phase16优化目标位置）

#### Case-A:组装器流程（compose panel）
步骤|前端组件 →后端 API调用说明  
──────────┴─────  
①打开 `composer_compose_panel.html` 导航栏「镜头编排」按钮→app_core.js _switchView('composer')  

②**选择场景模板**:点击预设种子 (例如"赛博朋克都市") ←WC_bridge加载 seedance_v2.py PRESET_TEMPLATES列表 

③ **选择角色模板（关键步骤）`: character_library 面板弹出 →select_character(character_id=2)`  
    ⚠️当前逻辑：仅注入 appearance/personality文本到 subject字段，**无原子化词卡映射机制   
```javascript // composer_compose_panel.html +app_core.js
document.getElementById('scene_template').value = 'cyberpunk_city'; ←用户选择场景模板 
const charId= parseInt(document.querySelector('.character-item.selected')?.dataset.id);  
if (charId) {  // ⚠️缺少自动填充原子卡逻辑：调用_fill_atoms_by_character(char_vis,db)   
   const res = await fetch('/api/seedance/v2/project', method='POST`, body:JSON.stringify({scene_template,char_id,...})); 
```  

④点击「组装」按钮→发送 POST /api/composer/scenes →composer_engine.py make_structured_description()拼接最终提示词  
⑤实时预览渲染：前端 app_search.js解析响应 JSON 并生成卡片网格视图（Bootstrap5 grid系统）  


#### Case-B:场景编辑流程 (scene_composer)

步骤|前端组件→后端 API说明  

①打开 scene_composer.html →加载/api/seedance/v2/scenes列表  

②选择维度字段(如 composition、emotion_style)`—>fetch('/api/wc/picker?group_type=composition')获取词卡库    

⚠️**原子化填充缺失点**:用户从 word_card 分组中选取「长发」→直接拼接到 scene.desc，但缺少智能映射机制：  
```javascript // app_editor.js (编辑模式)
const selectedAtomCard = await _safeFetch('/api/wc/cards/3');  
if(selectedAtomCard) { 
    document.querySelector('#scene_composition').value +=selectedAtomCard.content;  //直接拼文字  
}    
// ⚠️缺少调用原子桥接：/api/composer/template-fill?character_id=2&group_type=composition
```  

--- 

## 🔗二、后端联动层（FastAPI→SQLite）

### API路由关系图:


```
┌─────────────────────── ────────────────┐  
│ /api/wc/picker (word_cards.py)         │ ←词卡选取器（支持搜索+分页 +收藏/词包标记    
│   ├─GET?group_type=seedance            #返回 27套维度分类树      
│   ├─POST/link_card_to_scene           →插入 scene_card_ref关联表  
└─────────────────────────────────────── ─┘  
         │                          ↑        
    user_project_scene ←◄←---------+    
        (镜头主数据表)              
```  

#### 关键数据库交互流程：


①**场景模板初始化**:
- `scene_composer.py`加载/seedance/v2/scenes→查询 scene_profiles(14维度字段）  
⚠️缺少原子化桥接映射:当前 settings_json仅存用户手填文字，未与 word_card 库关联  

② **角色分配镜头** →characters.api assign_character_to_scene()
```python # characters.py (核心联动逻辑) 
@router.put("/{char_id}/assign-scene")   
def assign_...():  
    db.execute(    
        "UPDATE user_project_scene SET character_id=?,character_voice=? WHERE id=?",  #自动注入声线 +旁白   
         [char_id,auto_voice,narration]
```  

⚠️但视觉外观未关联：仅通过字符表字段的 appearance/personality手动拼接到subject，**缺少从 word_card_group(atom/composition)智能筛选原子卡列表逻辑**。  

③ 镜头组装 →composer_engine.py compose_full()  
调用 make_structured_description(scene_data,density)，按顺序拼接各维度描述。

⚠️优化目标：在角色注入部分（代码位置约 L257）扩展_atom_fill_atoms_by_character(char_vis,db)


---  

### 📊数据库表结构关联:
- `user_project_scene` (镜头主数据):character_id FK → character_profiles.id  
  settings_json TEXT ←←存原始用户输入字段集合   
⚠️缺少 atom_decompose(template_ref_id）建立场景→原子卡映射关系  


#### word_card_group +word_card

|表名 |核心列说明     
├───────────────┼─────────────┬─────────  
prompt_word_card  ├──id │内容│定义 (含义)
└──── ──────+ library_id → prompt_library.id(词库分组 FK)+tags JSON  

提示：Phase16原子化→模板桥接表需扩展此关系


---  


## 🎯三、Phase16优化目标（待实现）

### 核心需求：**选择角色/场景后，镜头成分自动填充对应原子卡**  
⚠️当前能力边界：仅有手动拼接到 subject的简单文本注入  

#### 解决方案架构:
```python # composer_engine.py伪代码（新增逻辑位置在 L257-角色注入部分）

def compose_full(scenes, proj,density="standard",db=None):  ⬇  
    for sc in scenes:    
        char_id=sc.get("character_id")        
        if char_id and db:
            #①查询字符档案 (已有)←characters.py的 SELECT name,appearance... 
                char_vis=db.execute(.....).fetchone()   
            
# ←【Phase16新】原子化填充：从 word_card 库智能匹配相关词条      
            keywords=_extract_keywords_from_role(char.appearance,char.personality,db)
            if notkeywords: continue
            
#②扫描 atom/composition分组词卡（用关键词过滤）  
                atom_cards = db.execute("""              
                    SELECT id,name,content FROM prompt_word_card WHERE                   
                        content LIKE ? OR tags LIKE? AND library_id IN(SELECT idFROM prompt_library  WHERE dimension_key='composition')    
                    """,keywords + [f"%{kw}%"])
            
#③合并到场景描述（保持用户手填内容优先）  
                if atom_cards: 
                   scene_desc =scene_desc or""
                   scene_desc += "，".join([c.content for c in sorted(atom_cards,key=lambda x:x.usage_count, reverse=True)[:5]])      
```  

---  


## 📈四、性能优化与体验建议

### 1.关键词匹配效率提升（Phase16）


① **预计算角色→原子卡映射** →atom_decompose.source_hash 缓存高频组合  
② 分区式索引支持快速筛选：`CREATEINDEX idx_kw_match ON prompt_word_card(content,tags) WHERE library_key='composition'`  

#### 2.实时预览优化（前端）


- ⚠️当前问题:用户从 word_card picker选择原子卡→手动拼接文本到场景字段 →F5刷新才生效  
✅建议：组件监听事件 +fetch AJAX请求→实时更新 preview div内容，无需刷新  


--- 

## 📝五、测试验证方案

### Test Case 1:角色模板选择后自动填充原子化词卡
```bash
#前置准备:启动服务 python backend/main.py & 
curl -X POSThttp://localhost:8080/api/composer/template-fill \\\n             -H"Content-Type: application/json"\\\n             -d'{\"character_id\":2}'  
预期响应:{ok:true,"matched_keywords":["长发","白皙",...],recommended_cards:[{id:3,content:"留着飘逸的长发"..}]}\n```\n\n### Test Case-2：场景维度词库筛选优化  

验证 atom/composition 分组索引覆盖率>80%，关键词匹配耗时<15ms  


--- 

## 📞六、下一步行动建议（Phase16）

优先级 P0(阻塞):创建原子桥接映射表 →运行 migrate_template_atoms_v520.py  
P-1实现智能填充逻辑→编辑 composer_engine.add _fill_atoms_by_character()函数    
待评估：前端实时预览优化→app_core.js 添加事件监听 AJAX更新 preview div  

--- 

## 🔗七、相关文件清单

|路径 |职责  
────────┴───  
memory/2026-06-26-full-interaction-flow.md ←本交互流程完整梳理文件 (当前)
 memory/phase16-analysis.md ————Phase16 优化方案文档（待 Phase15完成后生成）  
backend/api/composer_engine.py →主组装逻辑（需添加原子化填充函数） 
backend/migrate_template_atoms_v520.py ←DB迁移脚本（创建映射表关联关系）  

--- 

## ✅验证标准

- [ ] 测试 Case 通过:选择角色→自动返回 composition+atom类高频词卡 (预期：>=3条匹配)
[-] 性能达标:关键词筛选耗时<10ms(使用 timing.py 实测确认)  
✅无阻塞性异常（即使部分 DB查询失败也不影响正常组装）  

