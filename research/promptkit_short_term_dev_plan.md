# PromptKit 短期迭代规划 — 详细开发方案

> 基线版本: v4.1.0-phase13  
> 计划周期: 2026-06-20 ~ 2026-08-20（2个月）  
> 基于: `research/promptkit_product_analysis_v4.1.md` 第6章 Phase 13.x  
> 文件: `research/promptkit_short_term_dev_plan.md`

---

## 一、Phase 13.1: 统一词卡接入完善（1周）

**目标：** 解决当前桥接组件（`composer_wc_bridge.js`）与原生组件的兼容性问题，完善词卡管理基础体验。

### 1.1.1 桥接组件验证与加固

**背景分析：**
当前 `composer_wc_bridge.js` 使用函数劫持模式（`__origORP`等）Hook 原生 `seedance_v2_composer.js` 的方法。核心风险在于：
- `_openRightPicker` 的手动循环匹配逻辑与原生 `getLibraryByKey` 不一致
- 桥接的 `loadLibraries` 替换了原生方法，请求 `/api/v4/word-cards/groups`，而原生方法请求 `/api/seedance/v2/libraries`
- 两个数据源格式不同，桥接层做了字段映射但未做全面的深度校验

**实施方案：**

```javascript
// 步骤1：在 composer_wc_bridge.js 中增加 fallback 链
// 当前: var dimKey = S._fieldToDim && S._fieldToDim[field] ? S._fieldToDim[field] : field;
// 改为: var dimKey = S._fieldToDim && S._fieldToDim[field] ? S._fieldToDim[field] : 
//                (S._fieldToKey && S._fieldToKey[field] ? S._fieldToKey[field] : field);

// 步骤2：支持 custom_ 前缀字段
if (field && field.startsWith('custom_')) {
  isCustomKey = true;
  // custom_ 字段直接调原生 _openRightPicker
  S.__origORP.call(S, sid, field);
  return;
}

// 步骤3：双重检查 libraries 加载状态
if (!S.libraries || S.libraries.length === 0) {
  App.showToast('词库正在加载，请稍候...', 'info');
  var checkLoaded = setInterval(function() {
    if (S.libraries && S.libraries.length > 0) {
      clearInterval(checkLoaded);
      S._openRightPicker(sid, field);
    }
  }, 300);
  return;
}
```

**受影响的文件：**
- `frontend/static/js/composer_wc_bridge.js` — 核心修复
- `frontend/static/js/seedance_v2_composer.js` — 检查 `_fieldToDim` 映射完整性

**验收标准：**
- [ ] 所有25+维度的字段点击后，右面板均显示对应的词库
- [ ] `custom_` 前缀字段fallback到原生处理
- [ ] libraries 未加载完成时给出友好提示而非空错误
- [ ] 桥接层与原生层在相同输入下行为一致

### 1.1.2 词卡组间拖拽移动

**后端改动（`backend/api/word_cards.py`）：**

```python
@router.post("/batch")
def batch_operation(data: dict):
    # 已有 action="move" 支持，但需确保：
    # 1. 移动后更新目标分组的 sort_order（追加到最后）
    # 2. 返回移动后的新 sort_order
    if action == "move":
        tg = data.get("group_id")
        max_sort = db.execute("SELECT COALESCE(MAX(sort_order),0) FROM word_card WHERE group_id=?", [tg]).fetchone()[0]
        for idx, cid in enumerate(ids):
            db.execute("UPDATE word_card SET group_id=?, sort_order=?, updated_at=datetime('now','localtime') WHERE id=?",
                       [tg, max_sort + 1 + idx, cid])
```

**前端改动（`frontend/static/js/word_card_manager.js`）：**
- 分组列表支持拖拽排序（HTML5 Drag & Drop API）
- 词卡列表横向拖拽到目标分组
- 拖拽状态视觉反馈（高亮目标分组、幽灵元素跟随）

**交互流程：**
```
用户长按词卡 → 出现拖拽幽灵 → 拖到左侧分组列表 → 分组高亮 → 释放 → 
POST /api/v4/word-cards/batch {action:"move", ids:[...], group_id:X} → 
刷新当前视图
```

### 1.1.3 词卡批量导入/导出

**后端新增（`backend/api/word_cards.py`）：**

```python
@router.post("/export")
def export_cards(data: dict):
    """导出词卡为CSV/JSON格式"""
    fmt = data.get("format", "json")  # json/csv
    ids = data.get("ids", [])
    db = get_db()
    if ids:
        ph = ",".join("?" * len(ids))
        rows = db.execute(f"SELECT * FROM word_card WHERE id IN ({ph}) AND is_deleted=0", ids).fetchall()
    else:
        rows = db.execute("SELECT * FROM word_card WHERE is_deleted=0 ORDER BY group_id, sort_order").fetchall()
    items = [dict(r) for r in rows]
    if fmt == "csv":
        import csv, io
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id","group_id","name","content","meaning","tags","module"])
        for it in items:
            writer.writerow([it["id"],it["group_id"],it["name"],it["content"],it["meaning"],it["tags"],it["module"]])
        return Response(output.getvalue(), media_type="text/csv; charset=utf-8", 
                        headers={"Content-Disposition": "attachment; filename=word_cards.csv"})
    return {"ok": True, "items": items, "total": len(items)}

@router.post("/import")
async def import_cards(file: UploadFile = File(...)):
    """从CSV/JSON文件导入词卡"""
    content = await file.read()
    ext = os.path.splitext(file.filename or "")[1].lower()
    db = get_db()
    count = 0
    if ext == ".json":
        data = json.loads(content)
        items = data if isinstance(data, list) else data.get("items", [])
        for it in items:
            db.execute("INSERT INTO word_card (group_id,name,content,meaning,tags,module,is_builtin) VALUES (?,?,?,?,?,?,0)",
                       [it.get("group_id"), it.get("name","")[:60], it.get("content",""), it.get("meaning",""),
                        json.dumps(it.get("tags",[])), it.get("module","custom")])
            count += 1
    elif ext == ".csv":
        import csv, io
        reader = csv.DictReader(io.StringIO(content.decode("utf-8")))
        for row in reader:
            db.execute("INSERT INTO word_card (group_id,name,content,meaning,tags,module,is_builtin) VALUES (?,?,?,?,?,?,0)",
                       [row.get("group_id"), (row.get("name") or "")[:60], row.get("content",""), 
                        row.get("meaning",""), row.get("tags","[]"), row.get("module","custom")])
            count += 1
    safe_commit()
    return {"ok": True, "imported": count}
```

**前端改动（`frontend/static/js/word_card_manager.js`）：**
- 工具栏增加"导入"和"导出"按钮
- 导出弹出格式选择（JSON/CSV）+ 选择范围（当前分组/全部/已选）
- 导入弹窗支持文件拖入 + 文件选择器 + 预览（前5条）+ 确认导入
- 导入冲突策略：跳过/覆盖/重命名

### 1.1.4 分组编辑UI优化

**前端改动（`frontend/static/js/word_card_manager.js` + `frontend/static/css/style.css`）：**

- 分组创建弹窗增加图标选取器（emoji网格 8×5，支持搜索）
- 分组卡片显示颜色标签条（左侧4px色条）
- 分组列表悬停显示操作图标（编辑/删除/导出）
- 分组折叠/展开

---

## 二、Phase 13.2: 前端代码重构（2周）

### 1.2.1 模块拆分（当前 app_core.js → 目标 4 个子模块）

**现状分析：**
`frontend/static/js/app_core.js` 是一个单一文件，混合了首页词库、搜索、导航、主题、导入导出等逻辑。代码行数约6000+行，维护困难。

**拆分方案：**

| 当前文件 | 拆分目标 | 职责 | 预估行数 |
|---------|---------|------|---------|
| `app_core.js` | `app_search.js` | 搜索逻辑/FTS/语义搜索 | 800行 |
| `app_core.js` | `app_export.js` | 批量导出(PNG/TXT/MD/JSON) | 600行 |
| `app_core.js` | `app_theme.js` | 深色模式/主题管理 | 400行 |
| `app_core.js` | 保留 | 导航/首页渲染/核心路由器 | 4200行 |

**迁移策略：**

```javascript
// 步骤1：在 index.html 中按依赖顺序加载
<script src="/static/js/app_core.js"></script>
<script src="/static/js/app_search.js"></script>
<script src="/static/js/app_export.js"></script>
<script src="/static/js/app_theme.js"></script>

// 步骤2：使用 App 命名空间，各模块 Attach 方法
// app_search.js
(function() {
  'use strict';
  App.performSearch = function(query) { ... };
  App.toggleSearchMode = function() { ... };
  // 保持 App 命名空间不变，调用方无需改动
})();

// 步骤3：验证所有引用路径
// grep -n "App\.performSearch\|App\.toggleSearchMode" frontend/static/js/*.js
// 确认跨文件调用全部正确
```

### 1.2.2 CSS变量规范化审计

**审计策略：**

```bash
# 审计命令（PowerShell）：
cd frontend/static/css
Select-String -Path "style.css" -Pattern "(background|color|border-color|border-top|background-color):\s*#[0-9a-fA-F]{3,8}" | 
  Where-Object { $_ -notmatch "var\(" } |
  Select-Object -First 50
```

**已知硬编码位置（来自 MEMORY.md 深色模式修复记录）：**
- `#ffffff` → `var(--bg-card, #fff)`
- `#f1f5f9` → `var(--hover-bg)`
- `#eef2ff` → `rgba(79,70,229,0.12)`
- `#64748b` → `var(--text-muted)`
- `#e2e8f0` → `var(--border-color)`

**处理优先级：**
1. **P0（立刻修复）：** 新增 UI 组件的硬编码（如监测仪表盘、角色库）
2. **P1（1周内）：** 老组件的遗留硬编码（首页卡片、分类标签）
3. **P2（2周内）：** 弹窗和模态框的边角问题

### 1.2.3 移动端触控优化

**问题清单（来自实际移动端测试）：**

| 问题 | 位置 | 解决方案 |
|------|------|---------|
| 组装器字段芯片点击不灵敏 | `seedance_v2_composer.js` | 增加 touch 事件支持 + 增大点击区域(48px最小) |
| 滑块控件在手机难对齐 | `style.css` `.column-slider` | 增加滑块手柄尺寸(24px→32px) |
| 侧边栏展开后遮挡内容 | `style.css` `.sidebar` | 侧边栏改为覆盖式(z-index层级调整) |
| 卡片列表在手机上太挤 | `style.css` `.prompt-card` | 移动端强制1~2列 + 缩小padding |
| 弹窗在手机上超出视口 | `style.css` `.modal-content` | 增加 `max-height: 90vh; overflow-y: auto` |

### 1.2.4 加载状态骨架屏

**实施方案：**

```css
/* style.css 新增 */
.skeleton-card {
  background: var(--skeleton-bg, #e2e8f0);
  border-radius: 8px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  min-height: 120px;
}
body.dark-theme .skeleton-card {
  background: var(--skeleton-bg-dark, #334155);
}
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

```javascript
// app_core.js 新增 renderSkeleton 方法
App.renderSkeleton = function(count) {
  var html = '';
  for (var i = 0; i < (count || 6); i++) {
    html += '<div class="skeleton-card"><div class="skeleton-line skeleton-title"></div>' +
            '<div class="skeleton-line skeleton-text"></div>' +
            '<div class="skeleton-line skeleton-text-short"></div></div>';
  }
  document.getElementById('promptList').innerHTML = '<div class="card-grid">' + html + '</div>';
};
```

### 1.2.5 错误边界处理

```javascript
// app_core.js 新增全局错误处理
App._safeFetch = async function(url, options) {
  try {
    var resp = await fetch(url, options);
    if (!resp.ok) {
      var text = await resp.text();
      console.error('[API Error]', url, resp.status, text);
      App.showToast('请求失败: ' + (text.detail || resp.statusText), 'error');
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.error('[Network Error]', url, e);
    App.showToast('网络连接失败: ' + e.message, 'error');
    return null;
  }
};
```

---

## 三、Phase 13.3: 国际化 I18n（1周）

### 1.3.1 架构设计

```javascript
// frontend/static/js/i18n.js — 新建文件
(function() {
  'use strict';
  var LANG = localStorage.getItem('promptkit_lang') || 'zh-CN';

  App.i18n = {
    current: LANG,
    dicts: {},
    
    load: async function(lang) {
      if (this.dicts[lang]) return;
      try {
        var resp = await fetch('/static/i18n/' + lang + '.json');
        this.dicts[lang] = await resp.json();
      } catch(e) {
        console.warn('[i18n] Failed to load:', lang, e);
        this.dicts[lang] = {};
      }
    },
    
    t: function(key, fallback) {
      var lang = this.current;
      // 先查当前语言
      if (this.dicts[lang] && this.dicts[lang][key] !== undefined)
        return this.dicts[lang][key];
      // fallback 到英文
      if (this.dicts['en'] && this.dicts['en'][key] !== undefined)
        return this.dicts['en'][key];
      return fallback || key;
    },
    
    switchTo: async function(lang) {
      if (!this.dicts[lang]) await this.load(lang);
      this.current = lang;
      localStorage.setItem('promptkit_lang', lang);
      // 触发全局字符串刷新
      document.dispatchEvent(new CustomEvent('i18n-changed'));
    }
  };

  // 自动加载当前语言
  App.i18n.load(LANG);
  App.i18n.load('en'); // 预加载英文 fallback
})();
```

### 1.3.2 翻译字典

```json
// frontend/static/i18n/en.json
{
  "brand.name": "MiKa Prompt Assistant",
  "brand.version": "v4.1.0",
  "nav.home": "Home",
  "nav.collections": "Collections",
  "nav.wordpacks": "Word Packs",
  "nav.history": "History",
  "nav.trash": "Trash",
  "nav.composer": "Prompt Composer",
  "nav.library": "Library Assets",
  "nav.wordcards": "Word Cards",
  "nav.media": "Media Assets",
  "search.placeholder": "Search prompts...",
  "search.mode.text": "Text",
  "search.mode.semantic": "Semantic",
  "common.loading": "Loading...",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.copy": "Copy",
  "common.export": "Export",
  "common.import": "Import",
  "card.empty": "No prompts found",
  "error.network": "Network connection failed",
  "error.api": "Request failed",
  // ... 预计 200+ 个 key
}
```

### 1.3.3 后端国际化准备

```python
# backend/i18n.py — 新建文件
# 后端消息（报错、提示）也需要国际化

I18N_ZH = {
    "prompt_not_found": "提示词不存在",
    "group_name_required": "分组名称不能为空",
    "group_already_exists": "分组已存在",
    "word_card_empty": "词卡内容不能为空",
    "file_too_large": "文件太大，最大{max}MB",
    "network_error": "网络连接失败，请检查服务是否运行",
}
I18N_EN = {
    "prompt_not_found": "Prompt not found",
    "group_name_required": "Group name is required",
    "group_already_exists": "Group already exists",
    "word_card_empty": "Word card content cannot be empty",
    "file_too_large": "File too large, max {max}MB",
    "network_error": "Network error, please check if the service is running",
}

def _(key: str, lang: str = "zh", **kwargs) -> str:
    d = I18N_EN if lang == "en" else I18N_ZH
    msg = d.get(key, key)
    if kwargs:
        msg = msg.format(**kwargs)
    return msg

# 在 API 中通过 Accept-Language header 获取语言偏好
# 然后调用 _(key, lang) 返回对应语言的消息
```

### 1.3.4 种子数据英文版

```python
# backend/seed_data_en.py — 新建文件
# 英文版种子数据，与 seed_data.py 结构一致
SEED_PROMPTS_EN = [
    # ("module", "category", "subcategory", "content", "meaning", "scene", "tags")
    ("emotion", "Expression", "Surprise", "surprised, wide eyes, mouth agape, eyebrows raised",
     "Surprise expression", "Close-up portrait", "[\"expression\",\"surprise\"]"),
    # ... 165条英文版种子数据
]

# 在 main.py 的 lifespan 中判断语言，选择导入中文或英文种子
```

---

## 四、Phase 13.4: 用户体验细节（2周）

### 1.4.1 一键出图到 ComfyUI

**后端新增（`backend/api/comfyui.py`）：**

```python
@router.post("/compose-and-send")
async def compose_and_send(data: dict):
    """组装提示词并发送到 ComfyUI"""
    # 1. 调用组装器引擎生成 final prompt
    project_id = data.get("project_id")
    prompt_text = await _compose_project(project_id)
    
    # 2. 根据 ComfyUI 预设工作流，组装请求
    comfy_url = _get_comfy_url()
    workflow_template = _get_workflow_template(data.get("workflow_id"))
    workflow = _inject_prompt(workflow_template, prompt_text)
    
    # 3. 发送到 ComfyUI
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{comfy_url}/prompt", json={"prompt": workflow})
    
    return {"ok": True, "prompt_id": resp.json().get("prompt_id")}
```

**前端改动（`seedance_v2_composer.js`）：**
- 输出面板增加"发送到 ComfyUI"按钮
- 弹出工作流选择（预设工作流列表）
- 发送进度显示（等待、队列位置、完成后提示）

### 1.4.2 高级搜索（组合搜索）

**后端改动（`backend/api/search.py`）：**

```python
@router.post("/advanced")
def advanced_search(data: dict):
    """高级组合搜索：AND/OR/NOT + 字段限定"""
    query = data.get("query", "")
    mode = data.get("mode", "and")  # and / or
    exclude = data.get("exclude", [])
    field = data.get("field", "all")  # all / content / meaning / tags
    module = data.get("module")
    has_thumbnail = data.get("has_thumbnail")  # yes/no/any
    date_from = data.get("date_from")
    
    db = get_db()
    where = ["wc.is_deleted=0"]
    params = []
    
    if query:
        if mode == "and":
            keywords = query.split()
            for kw in keywords:
                if field == "all":
                    where.append("(wc.content LIKE ? OR wc.meaning LIKE ? OR wc.tags LIKE ?)")
                    params.extend([f"%{kw}%"] * 3)
                elif field == "content":
                    where.append("wc.content LIKE ?")
                    params.append(f"%{kw}%")
                elif field == "meaning":
                    where.append("wc.meaning LIKE ?")
                    params.append(f"%{kw}%")
        elif mode == "or":
            if field == "all":
                clauses = []
                for kw in query.split():
                    clauses.append("(wc.content LIKE ? OR wc.meaning LIKE ? OR wc.tags LIKE ?)")
                    params.extend([f"%{kw}%"] * 3)
                where.append(f"({' OR '.join(clauses)})")
    
    # 排除特定ID
    if exclude:
        ph = ",".join("?" * len(exclude))
        where.append(f"wc.id NOT IN ({ph})")
        params.extend(exclude)
    
    if module:
        where.append("wc.module=?")
        params.append(module)
    
    if has_thumbnail == "yes":
        where.append("wc.thumbnail != ''")
    elif has_thumbnail == "no":
        where.append("(wc.thumbnail IS NULL OR wc.thumbnail = '')")
    
    w = " AND ".join(where)
    rows = db.execute(f"SELECT * FROM word_card wc WHERE {w} ORDER BY wc.usage_count DESC LIMIT 100", params).fetchall()
    return {"ok": True, "items": [dict(r) for r in rows], "total": len(rows)}
```

**前端改动（`app_search.js`）：**
- 搜索框右侧增加"高级搜索"展开面板
- 面板包括：搜索模式切换（AND/OR）、字段限定（全部/内容/释义/标签）、模块筛选、缩略图筛选、日期筛选
- 搜索结果以卡片网格展示（与首页一致）
- 搜索条件可保存为"搜索快照"

### 1.4.3 组装器快捷键

```javascript
// seedance_v2_composer.js 添加全局快捷键监听
document.addEventListener('keydown', function(e) {
  var S = App.seedanceV2;
  if (!S.currentProjectId) return;
  
  // Ctrl+S = 保存项目
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    S.saveProject();
    return;
  }
  
  // Ctrl+Z = 撤销（最近5次修改）
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    S._undoLastChange();
    return;
  }
  
  // Esc = 关闭所有弹窗/返回项目列表
  if (e.key === 'Escape') {
    var panels = ['s2CardPicker', 's2RightPanel', 's2RemainingModal'];
    for (var i = 0; i < panels.length; i++) {
      var el = document.getElementById(panels[i]);
      if (el && el.style.display !== 'none') {
        el.style.display = 'none';
        e.preventDefault();
        return;
      }
    }
  }
  
  // ArrowUp/ArrowDown = 在镜头间切换选中
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    var cards = document.querySelectorAll('.s2-scene-card');
    if (!cards.length) return;
    var focused = document.activeElement ? document.activeElement.closest('.s2-scene-card') : null;
    var idx = focused ? Array.from(cards).indexOf(focused) : -1;
    var next = e.key === 'ArrowDown' ? Math.min(idx + 1, cards.length - 1) : Math.max(idx - 1, 0);
    if (next >= 0 && next < cards.length && next !== idx) {
      cards[next].scrollIntoView({ behavior: 'smooth', block: 'center' });
      cards[next].style.boxShadow = '0 0 0 2px var(--primary)';
      setTimeout(function() { cards[next].style.boxShadow = ''; }, 1500);
    }
  }
});
```

### 1.4.4 组装器渲染性能优化

**问题定位：** 10个镜头的场景下，`renderScenes()` 每次调用会重新生成整个 HTML 并替换 `innerHTML`。每个镜头卡片包含25+字段芯片、拓展单元、音频单元等，HTML 生成量约 3KB/镜头，10镜头=30KB HTML。

**优化方案：**

```javascript
// 方案1：虚拟 DOM diff（轻量级实现）
// 只更新变化的卡片，而不是全部重绘
S._dirtySceneIds = new Set();

S._markSceneDirty = function(sceneId) {
  this._dirtySceneIds.add(sceneId);
  if (!this._renderTimer) {
    this._renderTimer = setTimeout(function() {
      S._flushDirtyRender();
    }, 50); // 50ms 防抖
  }
};

S._flushDirtyRender = function() {
  this._renderTimer = null;
  var ids = Array.from(this._dirtySceneIds);
  this._dirtySceneIds.clear();
  
  for (var i = 0; i < ids.length; i++) {
    var scene = this._getSceneById(ids[i]);
    if (!scene) continue;
    var card = document.querySelector('.s2-scene-card[data-scene-id="' + ids[i] + '"]');
    if (card) {
      var newHTML = this.renderSceneCard(scene, scene.scene_order - 1);
      card.outerHTML = newHTML;
    }
  }
  this._refreshTimeline();
};

// 方案2：字段级更新（只更新变化的芯片，不重绘整张卡片）
S.updateSceneField = function(sceneId, field, value) {
  var scene = this._getSceneById(sceneId);
  if (!scene) return;
  scene[field] = value;
  
  // 字段级更新：只更新该镜头中对应的芯片
  var chip = document.querySelector(
    '.s2-field-chip[data-scene-id="' + sceneId + '"][data-field="' + field + '"]'
  );
  if (chip) {
    chip.classList.toggle('s2-filled', !!value);
    chip.querySelector('.s2-chip-val').textContent = 
      value && value.length > 10 ? value.substring(0, 10) + '..' : (value || '+');
  }
  
  this._markSceneDirty(sceneId); // 背景标记，非关键更新
  this.compose(); // 触发拼装更新
};
```

---

## 五、短期迭代的依赖关系与并行度

```
Week 1:  P13.1 [桥接加固]───────┐
          P13.4 [高级搜索]───────┤
          P13.4 [快捷键]────────┤  ← 可并行
          P13.4 [一键出图]───────┘
                                    
Week 2-3: P13.2 [前端重构]──────┐
          P13.2 [CSS审计]───────┤  ← 可并行
          P13.1 [拖拽/导入导出]───┘
                                    
Week 4:   P13.3 [i18n架构]──────┐
          P13.4 [渲染性能]───────┤  ← 可并行
          P13.2 [骨架屏/错误边界]─┘
                                    
Week 5-6: P13.3 [翻译字典]──────┐
          P13.2 [移动端优化]─────┤  ← 可并行
          P13.4 [收藏夹排序]─────┘
                                    
Week 7-8: 集成测试 + 回归 + 文档 + 发布 v4.2.0
```

---

## 六、估算工作量

| 子阶段 | 任务 | 预估天数 | 涉及文件数 | 难度 |
|-------|------|---------|-----------|------|
| P13.1 | bridge 加固 | 1 | 2 | ⭐⭐ |
| P13.1 | 词卡拖拽移动 | 2 | 3 | ⭐⭐⭐ |
| P13.1 | 导入/导出 | 2 | 3 | ⭐⭐ |
| P13.1 | 分组UI优化 | 1 | 2 | ⭐ |
| P13.2 | 前端拆分 | 3 | 5 | ⭐⭐⭐⭐ |
| P13.2 | CSS审计 | 2 | 1 | ⭐⭐ |
| P13.2 | 移动端触控 | 2 | 3 | ⭐⭐⭐ |
| P13.2 | 骨架屏 | 1 | 2 | ⭐ |
| P13.2 | 错误边界 | 1 | 2 | ⭐⭐ |
| P13.3 | i18n架构 | 2 | 4 | ⭐⭐⭐ |
| P13.3 | 翻译字典 | 3 | 2 | ⭐⭐ |
| P13.3 | 种子英文版 | 1 | 1 | ⭐⭐ |
| P13.4 | 一键出图 | 2 | 3 | ⭐⭐⭐ |
| P13.4 | 高级搜索 | 2 | 3 | ⭐⭐⭐ |
| P13.4 | 快捷键 | 1 | 1 | ⭐ |
| P13.4 | 渲染性能 | 2 | 1 | ⭐⭐⭐⭐ |
| — | **总计** | **28天** | **38文件** | — |

---

## 七、关键成功指标（KPI）

| 指标 | 当前状态 | P13.x 目标 | 测量方法 |
|------|---------|-----------|---------|
| 字段点击成功率 | ~85%（部分桥接失败） | 100% | 手动遍历所有25+字段点击验证 |
| 前端渲染时间(10镜头) | ~3s | <1s | Performance.now() 计时 |
| 首次加载白屏时间 | ~1.5s | <800ms | Lighthouse模拟 |
| 移动端字段点选成功率 | ~60% | 100% | 安卓/iPhone实机测试 |
| CSS变量覆盖率 | ~90% | 100% | grep审计脚本 |
| 报错信息可读性 | 原始API错误 | 用户友好提示 | 人工评审 |
| i18n key 覆盖率 | 0 | 200+ key | 自动统计 |
| API 响应 P50 | 24ms | <10ms | monitor仪表盘 |
| 词卡管理用户操作路径 | 5步 | 3步 | 任务完成路径分析 |

---

*生成时间: 2026-06-19 22:30 CST*  
*基于: PromptKit v4.1.0-phase13 完全源代码分析*  
*报告路径: `research/promptkit_short_term_dev_plan.md`*
