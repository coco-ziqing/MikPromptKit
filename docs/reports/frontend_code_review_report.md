# 代码审查报告 — 前端核心

> 审查文件: 
- `frontend/index.html` (99KB)
- `frontend/static/js/app_core.js` (48KB)
- `frontend/static/js/app_tools.js` (84KB)  
- `frontend/static/js/app_collections.js` (71KB)
- `frontend/static/js/app_editor.js` (45KB)
- `frontend/static/js/auth_client.js` (22KB)
- `frontend/static/js/seedance_v2_composer.js` (184KB) - 部分读取
- `frontend/static/js/asset_library_ui.js` (46KB) - 部分读取

> 总行数: ~5000+ (基于文件大小估算)

---

## 🔴 阻断级风险 (CRITICAL)

| # | 文件：行号 | 问题描述 | 修复代码 |
|---|-----------|---------|----------|
| CR-1 | `app_core.js`:~379,405 处 `_renderSemanticResults()` | **XSS 漏洞** - HTML injection。模板字符串直接使用 `card.id`、`this._escape(card.content)` 等，但 `<div class="prompt-card" data-id="${card.id}" ...>` 中未对 ID 做转义 | ```js\n<div class="prompt-card\" data-id=\"${App._safeEscape(card.id)}\"\n    onclick=\"App.showCardDetail(${card.id})\">\n```<br>添加：`_escape()`/_safeEscape() 方法用于所有模板插值<br><br>在 `auth_client.js` 中：<br>`'onclick="App.handleCopy(' + card.id + ', \\'' + this._escape(card.content).replace(/'/g, "\\\\') + '\')"`\n--- |
| CR-2 | `seedance_v2_composer.js`:~70+ 行 _buildTimelineHTML()/_renderSceneCard() | **XSS** - innerHTML 渲染用户内容。镜头卡片中字段值：`App._escape(word)` 但未对所有文本输入做转义，特别是自定义词条 | ```js\n<div class=\"s2-right-card-item\" data-word=\"${this._safeEscape(card.word)}\"\n    title=\"${this._safeEscape((card.definition||'').substring(0,80))}\">\n```<br>统一使用：`_escape()` 或新增 `_safeHtml(text)` |
| CR-3 | `app_collections.js`:~52+ renderCollectionItems() | **DOM 操作未检查** - `for (var ci = 0; ci < colls.length; ci++)`直接遍历collections，若后端返回异常数据可能导致数组索引越界或 undefined访问<br><br>`collHtml += '<span...ondblclick=\"App.switchView...'`-事件监听器中 App 引用可能未定义 | ```js\nfor (let i = 0, len = colls?.length || 0; i < len; i++) {\n    const cc = colls[i];\n    if (!cc) continue;\n    // 使用 on 绑定而非 inline onclick\n} \nconst switchViewHandler = () => App.switchView('collections')?.openCollection(cc.id);\ncollHtml += `<span ... ondblclick=\"${switchViewHandler}\">` |
| CR-4 | `app_editor.js`:~150+ openEditModal() | **异步调用未处理** - `var td = await this.fetchJSON('/api/v2/tags/list');` 后续使用`this._allTags`，若 fetch 失败则_tags_为 undefined，`ti.addEventListener('input', ...)`会报错<br><br>且弹窗内所有 input/button onclick 直接引用 App.***若无 App初始化将抛错 | ```js\nasync openEditModal(promptId) {\n    this._allTags = [];\n    try { \n        const td = await this.fetchJSON('/api/v2/tags/list');\n        if (td?.tags) this._allTags = td.tags; \n    } catch(e) {} // 失败时保持空数组\n```\n--- |
| CR-5 | `auth_client.js`:~30+ _checkLogin() / ~190+ _doLogin() | **Token 明文存储** -`localStorage.setItem('pk_token', d.token);`<br>**CORS 预检缺失** - fetch('/api/auth/*')未设置 credentials<br><br>**XSS + CSRF**: innerHTML构建登录表单，user input直接渲染错误消息 `this._setAuthError('al_error', d.detail||...)` | ```js\n// Token 加密存储\nconst encrypted = CryptoJS.AES.encrypt(d.token, PK_AES_KEY).toString();\nlocalStorage.setItem('pk_token_encrypted', encrypted);\ncredentials: 'omit'\n```\n--- |

## 🟡 高危风险 (HIGH)  

| # | 文件：行号 | 问题描述 | 修复代码 |
|---|-----------|---------|----------|\
| H-1 | `app_core.js`:~290+ _semanticSearch() / ~350+_renderSemanticResults() | **DOM DOMContentLoaded竞争** - setTimeout(() => {...},80)与事件绑定竞态，可能导致元素未渲染就访问<br>**大数据渲染**：语义搜索一次生成 50-100 个卡片innerHTML一次性注入可能阻塞主线程 |\n```js\nconst fragment = document.createDocumentFragment();\nlet html = '';\nfor (item of items) {\n    const el = this._createPromptCard(item);\n    fragment.appendChild(el);\n}\ndocument.getElementById('promptList').insertAdjacentHTML('beforeend',fragment);```\n--- |\
| H-2 | `app_tools.js`:~50+ showRecommend() / ~386+_renderExportPreviewList() | **内存泄漏** - renderPrompts/recommend 多次调用innerHTML替换，DOM节点未 cleanup<br>`document.querySelectorAll('.nav-dropdown-menu').forEach(function(dd){ dd.classList.remove('open');})`\n无防抖导致频繁查询/操作\n| ```js\ndocument.removeEventListener(...)\nlet newNav = this._createDropdownMenu();\ns2AppendChild(newNav);```\n--- |\
| H-3 | `app_collections.js`:~480+ bindCardDragDrop() / ~516+_dropUploadImage() | **事件监听泄漏** - dragenter/dragover 等重复绑定，无防抖/节流<br><br>每次renderPrompts重新bindVideoHover可能导致累积多个 handler| ```js\nif (card.dataset.dragBound) return;\ncard.dataset.dragBound = '1';\nconst {handleDragEnter, handleDrop...} = this._createDragHandlers();\n[handleDragEnter，handleDragOver,...].forEach(h=> card.addEventListener(...));```\n--- |\
| H-4 | `app_editor.js`:~20+_replaceAndSaveUndo() / ~175+ _saveEditThumbnail() | **异步错误未处理** - upload thumbnail fetch 后 await loadPrompts/loadThumbLibrary，若任一失败会中断但无重试/降级<br><br>`await this.fetchJSON('/api/thumbnails/upload',...);var data=await resp.json();if(!data.ok)...`\n| ```js\ntry {\n    const res = await fetch('...', {...});\n    if (!res?.ok) throw new Error(res.statusText);\n    const data = await res.json();\n} catch (uploadErr) { \n    this.showToast(uploadMsg + uploadErr.message, 'error'); return; }\nt\nawait loadPrompts();```\n--- |\
| H-5 | `seedance_v2_composer.js`:~40+ init() / ~137+_renderRightPickerContent() | **长时渲染阻塞** - 右侧词库面板一次性生成数百个卡片，每个带 thumbnail video/poster/checkbox/select等大量 DOM<br><br>`cards.forEach(function(card){...})`直接 innerHTML插入大文本块 | ```js\nconst container = document.getElementById('s2RightPanel');\ncontainer.innerHTML = '<div class=\"loading\">加载词库...</div>';\ncacheParts = {};\nfor (let i=0, len=cards.length; i<len;i+=10) {\n    const pageCards = cards.slice(i，i+10);\n    requestAnimationFrame(()=>{\n        container.innerHTML += this._renderPageCards(pageCards); \n        if (!container.dataset.loadMore) { break; }\n});\nc\n``` |
| H-6 | `asset_library_ui.js`:~50 open() / loadProjects() | **并发请求无限制** - 同时 fetch('/api/projects',...)可能触发网络风暴，需添加背压/节流<br><br>**资源耗尽风险**:大量用户项目一次性加载导致内存飙升 |\n```js\nconst projects = await this._fetchProjectData(scope);\ncleanupOldGridItems();\nsortByRelevance(projects,userId,visibility);```\n--- |

## 🟠 中危风险 (MEDIUM)  

| # | 文件：行号 | 问题描述 | 修复代码 |\
| M-1 | `app_core.js`:~390+ _updateFilteredDisplay() / ~450+_makeExportFilename() | **性能隐患** - allCards.forEach函数式内嵌多次 find/indexOf，导致 O(n*m)复杂度<br><br>renderPrompts 中`for (const p of this.state.prompts)`遍历大数据集（数千词条）每次重新计算缩略图/收藏图标|\n```js\n// 建立 id -> promptData Map(一次性)\nconst promptMap = new Map(\n    prompts.map(p=>[p.id,p]).sort((a,b)=>a-promptId-b.promptId) // 按出现顺序排序 \n);\nallCards.forEach(card => {\n   const data = promptMap.get(parseInt(card.dataset.promptId));\n});```\n--- |\
| M-2 | `app_collections.js`:~150+ loadHistory() / ~380+_renderWordpackItems() | **DOM 深度过深** - historyList/wordpackItemList innerHTML渲染超过 N个卡片可能导致浏览器卡顿（单页>200)\n使用 virtual-scrolling\n| ```js\nif (items.length >15) { this.renderVirtualScroll(container, items);} else {\nc.innerHTML = cards.map(...);\nn}}\n``` |\
| M-3 | `seedance_v2_composer.js`:~86+ openProject() / ~704 renderComposerEmpty/empty-state 等 | **状态管理不一致** - projects/scenes/cards cache与state不同步<br><br>`this.scenes = d.scenes;`直接覆盖可能丢失未保存编辑\n需用 Immutable update（如 immer）| ```js\ndrafts=immer.createDraft(this.state); \nObject.assign(drafts, d);\nthis.state={...drafts};```\n--- |\
| M-4 | `app_tools.js`:~320+ doExport() / ~518+_populateModuleOptions() | **内存溢出风险** - 批量导出几百张图片时逐个 fetch('/api/export/prompt-to-png/*')<br><br>大文件 Blob createObjectURL后未及时 revoke |\n```js\nfor (const id of ids) {\n   const blob = await resp.blob();\ncleanupOldUrl(url); \ndownloadFile(blob，filename);\n} `revokeObjectURL` |
| M-5 | 多处（如 app_editor.js:~340 bindCardDragDrop） | **缩略图拖拽未防抖** - card.addEventListener('dragenter',...)直接绑定无节流可能导致频繁触发\n<br><br>粘贴事件监听器在 modal 打开/关闭时清理不当可能导致累积 |\n```js\ndragTimer = null;\ncard.addEventListener('mouseenter', () => {\n   clearTimeout(dragTimer);\n   dragTimer = setTimeout(()=>{\n      card.classList.add('drag-over');\n},150); // 防抖\n});```\n--- |

## 🟢 低危建议 (LOW)  

| # | 文件：行号 | 问题描述 | 修复代码 |\
| L-1 | `app_core.js`:~29+ state: / ~730 handleCopy() | **代码风格** - var vs const/let混用，部分函数未声明 strict<br><br>多处`var html = '';...innerHTML += '...'`可用模板字符串替换提高可读性| ```js\n'use strict';\nconst App=Object.create(App);\nclass PromptKit {\n constructor(){}``\ntemplate literal:\n```\n<div class=\"prompt-card\" data-id=${p.id}>\n  <div>${this._safeEscape(p.content)}</div>`\n``` |\
| L-2 | `seedance_v2_composer.js`:~40 init() / ~769 _buildTimelineHTML()\n**注释缺失** - seedance大模块缺少 JSDoc，函数职责不明<br><br>部分代码段标注 vX.Y.Z版本但无具体变更日志 |\n```js\n/**\n * @function renderProjectList \n * @desc 渲染分镜项目列表项（含模板来源标记）\n */\nrenderProjectList(){```\n--- |
| L-3 | `app_editor.js`:~86 openEditModal() / ~501 bindCardDragDrop()\n**国际化缺失** - button title/text硬编码英文<br><br>部分字符串未使用 App._t 占位符 |\n```js\nconst btnText =App._t('editor.drag_drop', '拖拽导入提示词');\ncard.setAttribute('title',btnText);```\n--- |
| L-4 | `auth_client.js`:~30 _applyThemeEarly() / ~215+ _injectNavButton()\n**安全头缺失** - 内联 script/src模块未设置 crossorigin/nonce<br><br>CSP header配置待后端补充 |\n```html\n<script \n    nonce=\"${window.crypto.randomUUID()}\"\n    src=\"/static/js/app_core.js?v=${version}\">\n</script>```\n--- |

## 📊 维度评分  

| 维度 | 得分/100 | 说明 |\
|------|---------|-------|\
| D-语法规范 (Naming, const/let, arrow func) | **65** | - 大量 var混用<br>- inline onclick vs on绑定不规范<br>+ 部分函数命名清晰（如 renderProjectList）\n--- |\
| D-业务逻辑缺陷 (状态/DOM/API错误处理) | **70** | + fetchJSON多数有 try/catch包裹<br>- DOM操作竞争未解决<br>- 异步流断裂风险高\n--- |\
| D-性能隐患 (批量DOM/事件泄漏/大数据渲染)\n| **58** | - innerHTML一次性注入大量节点阻塞主线程<br>- dragover/drop重复绑定无清理机制<br>+ use createDocumentFragment优化小范围\n---|\
| D-安全漏洞 (XSS/CORS/token) | **72**\n+ 大部分文本内容已使用 escape()转义<br>token加密存储需补充 CryptoJS<br>XSS高风险场景：语义搜索、自定义词条渲染未完全过滤HTML<br>- inline onclick事件存在脚本注入风险\n--- |\
| D-可维护性 (函数长度/全局变量耦合/JSDoc) | **68** | seedance_v2_composer.js>50KB，单文件 1+个类/方法混合（init/renderSceneCard/openProject...）\n建议拆分为独立 module<br>+ JSDoc缺失导致意图不清\n--- |\
| D-边界异常 (fetch无catch/null检查) | **74** + fetchJSON调用基本都有错误处理包裹，但 DOM查询如 document.getElementById('s2TimelineBar')未做存在性判断可能导致 undefined访问。建议统一封装为`_safeGetEl(id, optional=false)`\n--- |\

## 💡 全局优化建议  

1. **拆分超大模块** - seedance_v2_composer.js(>50KB)应拆分为独立文件：
   - `seedanceV2_core.js`(项目管理)\n- `seedanceV2_renderer.js` (场景渲染+时间轴）\n- `seedanceV2_extUnits.js`(拓展单元系统）

2. **建立 DOM 操作规范**:\n```js\n// ✅ 推荐：使用 documentFragment + requestAnimationFrame\nconst frag = new DocumentFragment(); // pre-render small pieces\nfrag.appendChild(this._renderCard(item)); \ndocument.getElementById('list').insertAdjacentHTML('beforeend', frag);```\n--- |

3. **统一事件监听管理**:\n```js\n// ✅ 推荐：绑定到组件实例，销毁时 cleanup\nclass PromptCardManager {\n   constructor(container){ this.container=container; }\n    bind(){ \n       container.addEventListener('dragover',this.handleDragOver); // single listener\n    } \n    destroy(){ container.removeEventListener(...)};\n}\n``` |

4. **性能优化** - 批量渲染使用 Virtual Scrolling(如 react-virtualized)\n大数据集（>50项）分页加载，避免一次性 innerHTML插入超过N个节点阻塞主线程。\n--- |\
\n5. **安全加固**: \n- Token AES加密存储<br>- inline onclick→on事件绑定+escape转义所有用户输入\n- 添加 CSP nonce策略头 <br>\n6.**状态管理**:\nseedanceV2改用 Redux-like store，确保 scenes/projects/cards数据一致性。避免直接 this.scenes=d.scenes覆盖丢失编辑态。\n--- |\
7. **文档补充**: JSDoc注释、CHANGELOG版本变更日志。<br>8。**测试用例**: 建议配合 Jest+Puppeteer进行自动化 UI 测试（DOM/事件流）\n--- |
