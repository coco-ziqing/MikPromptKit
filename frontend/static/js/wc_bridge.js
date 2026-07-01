// Phase14: 分类架构重构 — 树形侧边栏 + 陈列架首页
// 将侧边栏模块列表、首页卡片全部接入 word_card 统一数据源（嵌套分组树）
(function initWCBridge() {
'use strict';
// try/catch 兼容 const App（const 不设置 window.App）
try { if (!App || !App.fetchJSON) { setTimeout(initWCBridge, 200); return; } }
catch(e) { setTimeout(initWCBridge, 200); return; }

// ============================================================
// state 扩展
// ============================================================
App.state.groupTree = [];        // 嵌套树 [{...children:[...]}]
App.state.currentGroupId = null; // 当前选中的分组 ID (数字)
App.state.currentGroupName = ''; // 当前选中分组名
App.state.showcaseGroups = [];   // 陈列架分组列表（叶子节点）

// ============================================================
// 1. loadGroupTree: 加载嵌套分组树
// ============================================================
App.loadGroupTree = async function() {
    try {
        var d = await this.fetchJSON('/api/v4/word-cards/groups/tree');
        if (d && d.tree) {
            this.state.groupTree = d.tree;
            this.renderSidebar();
            // 延迟 Hook 搜索框（此时 DOM 已就绪）
            setTimeout(function() { App._wcHookSearchAndRestore(); }, 100);
        }
    } catch(e) { console.warn('[wc-bridge] loadGroupTree error:', e.message); }
};

// ============================================================
// 2. loadModules 重写：加载树 + 渲染
// ============================================================
var _origLoadModules = App.loadModules;
App.loadModules = function() {
    return App.loadGroupTree();
};

// ============================================================
// 3. switchGroup: 切换分组（按 group_id）
// ============================================================
App.switchGroup = async function(groupId, groupName) {
    this.state.currentGroupId = groupId;
    this.state.currentGroupName = groupName || '';
    this.state.searchQuery = '';
    this.state.page = 1;
    // 切换分组时保存当前选择 → 恢复目标分组选择
    this._swapBatchSet(groupId);
    // 按钮状态在 _wcLoadPrompts 数据加载完成后自动更新
    var si = document.getElementById('searchInput');
    if (si) si.value = '';
    try { localStorage.setItem('promptkit_group_id', String(groupId)); } catch(e) {}
    
    this._closeMobileMenu();
    // switchView('home') 内部会调用 renderSidebar + loadPrompts → _wcLoadPrompts
    this.switchView('home');
    // 侧边栏渲染完后，滚动到选中分组
    var self = this;
    setTimeout(function() { self._scrollSidebarToGroup(groupId); }, 150);
};

// 全部词库
App.switchAllGroups = function() {
    this.state.currentGroupId = null;
    this.state.currentGroupName = '';
    this.state.searchQuery = '';
    this.state.page = 1;
    // 回到陈列架时保存当前选择 → 清空（陈列架无批量操作）
    this._swapBatchSet(null);
    // 陈列架不显示批量栏，无需 updateBatchCount
    var si = document.getElementById('searchInput');
    if (si) si.value = '';
    try { localStorage.removeItem('promptkit_group_id'); } catch(e) {}
    this._closeMobileMenu();
    // switchView('home') 内部会调用 renderSidebar + loadPrompts → _wcLoadPrompts → _showShowcase
    this.switchView('home');
    // 侧边栏滚动到顶部
    setTimeout(function() {
        var sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.scrollTo({ top: 0, behavior: 'smooth' });
    }, 150);
};

// ============================================================
// 4. 兼容旧 switchModule（不再使用，重定向到 switchGroup）
// ============================================================
App.switchModule = function(moduleKey) {
    // 旧模块名 → 查找对应 group_id
    var gid = null;
    var findGroup = function(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].group_key === moduleKey) { gid = nodes[i].id; return; }
            if (nodes[i].children) findGroup(nodes[i].children);
        }
    };
    findGroup(this.state.groupTree);
    if (gid) { this.switchGroup(gid, moduleKey); }
    else { this.switchAllGroups(); }
};

App.switchAllModules = function() { this.switchAllGroups(); };

// ============================================================
// 5. 查找词组 — 全部分组平铺入口（根可折叠 / 子类永远展开）
// ============================================================
App._showShowcase = function() {
    var container = document.getElementById('promptList');
    if (!container) return;

    // 陈列架视图无批量操作，隐藏批量栏
    this._hideBatchBar();
    // 陈列架/查找词组页面：隐藏 AI 工具栏、面包屑、编辑工具栏
    App._aiToolbarSuppressed = true;
    if (App.aiTools) App.aiTools.hideToolbar();
    this._showBreadcrumb(false);
    this._hideBatchBar();
    this._hideEditFilterBar();
    
    var self = this;
    var tree = this.state.groupTree;
    if (!tree || tree.length === 0) {
        container.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary" role="status"></div><p>' + App._t('showcase.loading', '加载分组中...') + '</p></div>';
        return;
    }
    
    var html = '<div>';
    // 标题已由 page-header 统一显示，这里只保留极简导航提示
    
    for (var t = 0; t < tree.length; t++) {
        var root = tree[t];
        var rootId = 'showcase_root_' + t;
        
        // 计算根节点下总词卡数
        var rootTotal = 0;
        function sumCards(nodes) {
            for (var i = 0; i < nodes.length; i++) {
                rootTotal += (nodes[i].card_count || 0);
                if (nodes[i].children) sumCards(nodes[i].children);
            }
        }
        if (root.children) sumCards(root.children);
        
        html += '<div style="margin-bottom:12px;border:1px solid var(--border-color);border-radius:10px;overflow:hidden;">';
        // 根节点标题栏（可折叠）
        var rootAddBtnHtml = '';
        if (this.state.editMode) {
            rootAddBtnHtml = '<button onclick="event.stopPropagation();App._treeQuickAdd(' + root.id + ')" title="在此根下新建子分类" style="width:24px;height:24px;border:1px dashed var(--border-color);border-radius:50%;background:transparent;color:var(--text-muted);font-size:18px;line-height:1;cursor:pointer;opacity:0.6;margin-left:6px;transition:all 0.2s;" onmouseenter="this.style.borderColor=var(\'--primary\');this.style.background=var(\'--primary\');this.style.color=\'#fff\';this.style.opacity=\'1\'" onmouseleave="this.style.borderColor=var(\'--border-color\');this.style.background=\'transparent\';this.style.color=var(\'--text-muted\');this.style.opacity=\'0.6\'">+</button>';
        }
        html += '<div onclick="var c=document.getElementById(\'' + rootId + '\');c.style.display=c.style.display===\'none\'?\'block\':\'none\';var a=this.querySelector(\'.toggle-arrow\');if(a)a.textContent=c.style.display===\'none\'?\'▶\':\'▼\';" ';
        html += 'style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--hover-bg);user-select:none;">';
        html += '<span class="toggle-arrow" style="font-size:12px;width:18px;transition:transform 0.2s;">▼</span>';
        html += '<span style="font-size:22px;">' + (root.icon || '📁') + '</span>';
        html += '<span style="font-weight:700;font-size:15px;">' + App._escape(root.name.replace(root.icon||'','').trim()) + '</span>';
        html += '<span style="font-size:12px;color:var(--text-muted);margin-left:auto;">' + rootTotal + ' 条</span>';
        html += rootAddBtnHtml;
        html += '</div>';
        
        // root 子节点区域（默认展开）
        html += '<div id="' + rootId + '" style="display:block;padding:8px 16px 12px;">';
        
        if (root.children) {
            for (var s = 0; s < root.children.length; s++) {
                var sub = root.children[s];
                if (!sub.children || sub.children.length === 0) continue;
                
                var subLeaves = sub.children;
                var subTotal = subLeaves.reduce(function(sum,g){return sum+(g.card_count||0);},0);
                if (subTotal === 0 && sub.group_type !== 'sub') continue;
                
                // sub: 永远展开 + 包含关系框
                html += '<div style="border-left:2px solid var(--border-color);margin-left:8px;margin-bottom:6px;padding:6px 0 6px 12px;border-radius:0 8px 8px 0;">';
                html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;color:var(--text-muted);font-weight:600;">';
                html += '<span style="font-size:15px;">' + (sub.icon || '📂') + '</span>';
                html += '<span>' + App._escape(sub.name.replace(sub.icon||'','').trim()) + '</span>';
                html += '<span style="font-size:11px;margin-left:auto;">' + subTotal + ' 条</span>';
                if (self.state.editMode) {
                    html += '<button onclick="event.stopPropagation();App._treeQuickAdd(' + sub.id + ')" title="在此分组下新建" style="width:22px;height:22px;border:1px dashed var(--border-color);border-radius:50%;background:transparent;color:var(--text-muted);font-size:16px;line-height:1;cursor:pointer;opacity:0.5;flex-shrink:0;transition:all 0.2s;" onmouseenter="this.style.borderColor=var(\'--primary\');this.style.background=var(\'--primary\');this.style.color=\'#fff\';this.style.opacity=\'1\'" onmouseleave="this.style.borderColor=var(\'--border-color\');this.style.background=\'transparent\';this.style.color=var(\'--text-muted\');this.style.opacity=\'0.5\'">+</button>';
                }
                html += '</div>';
                
                // leaf 按钮平铺
                html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
                for (var g = 0; g < subLeaves.length; g++) {
                    var grp = subLeaves[g];
                    if (grp.group_type === 'sub' || grp.group_type === 'root') continue;
                    html += '<button onclick="event.stopPropagation();App.switchGroup(' + grp.id + ',\'' + (grp.name||'').replace(/'/g,"\\'") + '\')" ';
                    html += 'class="showcase-leaf-btn" style="font-size:13px;padding:6px 14px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);cursor:pointer;white-space:nowrap;transition:all 0.15s;line-height:1.5;"';
                    html += ' onmouseenter="this.style.borderColor=var(--primary);this.style.background=var(--hover-bg)" onmouseleave="this.style.borderColor=var(--border-color);this.style.background=var(--bg-card)"';
                    html += '>';
                    html += (grp.icon||'📄') + ' ' + App._escape(grp.name.replace(grp.icon||'','').trim());
                    html += '<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">' + (grp.card_count||0) + '</span>';
                    html += '</button>';
                }
                html += '</div>';
                // 编辑模式：底部添加行
                if (self.state.editMode) {
                    html += '<div onclick="event.stopPropagation();App._treeQuickAdd(' + sub.id + ')" style="margin-top:6px;margin-left:4px;padding:4px 10px;border:1px dashed var(--border-color);border-radius:6px;font-size:11px;color:var(--text-muted);cursor:pointer;opacity:0.6;transition:all 0.2s;" onmouseenter="this.style.borderColor=var(\'--primary\');this.style.color=var(\'--primary\');this.style.opacity=\'1\'" onmouseleave="this.style.borderColor=var(\'--border-color\');this.style.color=var(\'--text-muted\');this.style.opacity=\'0.6\'">+ 添加分组</div>';
                }
                html += '</div>'; // close sub container
            }
            
            // Phase17: atom 分组（root 直接叶子，无 sub 中间层）
            var atomLeaves = [];
            for (var a = 0; a < root.children.length; a++) {
                if (root.children[a].group_type === 'atom') atomLeaves.push(root.children[a]);
            }
            if (atomLeaves.length > 0) {
                var atomTotal = atomLeaves.reduce(function(sum,g){return sum+(g.card_count||0);},0);
                html += '<div style="border-left:2px solid var(--border-color);margin-left:8px;margin-bottom:6px;padding:6px 0 6px 12px;border-radius:0 8px 8px 0;">';
                html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;color:var(--text-muted);font-weight:600;">';
                html += '<span style="font-size:15px;">⚛</span><span>原子分组</span>';
                html += '<span style="font-size:11px;margin-left:auto;">' + atomTotal + ' 条</span></div>';
                html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
                for (var g = 0; g < atomLeaves.length; g++) {
                    var grp = atomLeaves[g];
                    html += '<button onclick="event.stopPropagation();App.switchGroup(' + grp.id + ',\'' + (grp.name||'').replace(/'/g,"\\'") + '\')" ';
                    html += 'class="showcase-leaf-btn" style="font-size:13px;padding:6px 14px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);cursor:pointer;white-space:nowrap;transition:all 0.15s;line-height:1.5;"';
                    html += ' onmouseenter="this.style.borderColor=var(--primary);this.style.background=var(--hover-bg)" onmouseleave="this.style.borderColor=var(--border-color);this.style.background=var(--bg-card)"';
                    html += '>';
                    html += (grp.icon||'📄') + ' ' + App._escape(grp.name.replace(grp.icon||'','').trim());
                    html += '<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">' + (grp.card_count||0) + '</span>';
                    html += '</button>';
                }
                html += '</div></div>';
            }
        }
        html += '</div></div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
    
    var totalLeaves = 0, totalCards = 0;
    function countAll(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.group_type !== 'root' && n.group_type !== 'sub') {
                totalLeaves++;
                totalCards += (n.card_count || 0);
            }
            if (n.children) countAll(n.children);
        }
    }
    countAll(tree);
    document.getElementById('countInfo').textContent = '共 ' + totalLeaves + ' 个分组 · ' + totalCards + ' 条词卡';
};


// 陈列架点击代理（data属性避免引号注入）（data属性避免引号注入）
App._showcaseClick = function(el) {
    var gid = parseInt(el.getAttribute('data-gid'));
    var gname = el.getAttribute('data-gname') || '';
    if (gid) App.switchGroup(gid, gname);
};

// 陈列架卡片
App._renderShowcaseCard = function(grp) {
    var icon = grp.icon || '📄';
    var cardName = grp.name || '';
    if (icon && cardName.indexOf(icon) === 0) cardName = cardName.substring(icon.length).trim();
    var badge = grp.group_type === 'builtin' ? '<span style="font-size:10px;background:var(--badge-builtin-bg,#6366f115);color:var(--badge-builtin-text,#6366f1);padding:1px 6px;border-radius:4px;">内置</span>' :
                grp.group_type === 'custom' ? '<span style="font-size:10px;background:var(--badge-custom-bg,#e8f5e9);color:var(--badge-custom-text,#2e7d32);padding:1px 6px;border-radius:4px;">自定义</span>' :
                grp.group_type === 'atom' ? '<span style="font-size:10px;background:var(--badge-atom-bg,#fff3e0);color:var(--badge-atom-text,#e65100);padding:1px 6px;border-radius:4px;">⚛ 原子</span>' : '';
    return '<div class="showcase-card" data-gid="' + grp.id + '" data-gname="' + (grp.name||'').replace(/"/g,'&quot;') + '" onclick="App._showcaseClick(this)" style="cursor:pointer;border:1px solid var(--border-color);border-radius:12px;padding:16px;background:var(--bg-card);transition:all 0.2s;display:flex;align-items:center;gap:12px;">' +
        '<div style="font-size:28px;flex-shrink:0;">' + icon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
                '<span style="font-weight:600;font-size:14px;">' + App._escape(cardName) + '</span>' +
                badge +
            '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);">' + grp.card_count + ' 条词卡</div>' +
        '</div>' +
        '<div style="color:var(--text-muted);font-size:18px;">→</div>' +
    '</div>';
};

// ============================================================
// 6. 侧边栏折叠按钮注入（补全缺失函数）
// ============================================================
App._injectSidebarToggle = function(sidebar) {
    // 移除旧按钮避免重复
    var old = document.getElementById('sidebarToggleBtn');
    if (old) old.remove();
    // 添加侧边栏折叠按钮（作为sidebar的兄弟元素，匹配CSS ~ 选择器）
    var btn = document.createElement('button');
    btn.id = 'sidebarToggleBtn';
    btn.className = 'sidebar-toggle-btn';
    btn.innerHTML = '<i class="bi bi-chevron-left"></i>';
    btn.title = '折叠侧边栏';
    btn.onclick = function(e) {
        e.stopPropagation();
        if (sidebar.classList.contains('collapsed')) {
            sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
            btn.innerHTML = '<i class="bi bi-chevron-left"></i>';
            btn.title = '折叠侧边栏';
        } else {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            btn.innerHTML = '<i class="bi bi-chevron-right"></i>';
            btn.title = '展开侧边栏';
        }
    };
    // 插入到sidebar后面（匹配CSS ~兄弟选择器）
    sidebar.parentNode.insertBefore(btn, sidebar.nextSibling);
};

// ============================================================
// 7. 重写 renderSidebar: 树形侧边栏（Phase15 交互重构）
// ============================================================
var _origRenderSidebar = App.renderSidebar;
App.renderSidebar = function() {
    try {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) { console.warn('[wc-bridge] sidebar DOM 元素不存在'); return; }

    // 强制显示侧边栏（防止被之前隐藏）
    sidebar.style.display = '';
    var btn = document.getElementById('sidebarToggleBtn');
    if (btn) btn.style.display = '';
    
    // 确保 _escape 可用（防御 app_editor.js 未加载场景）
    if (!App._escape) {
        App._escape = function(s) {
            if (s === null || s === undefined) return '';
            s = String(s);
            var div = document.createElement('div');
            div.textContent = s;
            return div.innerHTML;
        };
    }
    
    var tree = this.state.groupTree;
    if (!tree || tree.length === 0) {
        sidebar.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px;">📡 加载词库中...</div>';
        return;
    }
    
    var html = '<div style="padding:10px 14px 6px;color:var(--text-muted);font-size:12px;letter-spacing:1px;font-weight:600;">查找词组</div>';
    
    // 统一入口：全部词组
    var allActive = this.state.currentGroupId === null ? 'active' : '';
    html += '<div class="module-item ' + allActive + '" onclick="App.switchAllGroups()" style="margin:0 8px 4px;font-size:14px;">' +
        '<span class="icon">🏠</span><span>全部词组</span>' +
        '</div>';
    
    // 渲染树
    for (var t = 0; t < tree.length; t++) {
        html += this._renderTreeNode(tree[t], 0);
    }
    
    // 编辑模式底部按钮
    if (this.state.editMode) {
        html += '<div style="margin-top:auto;padding:12px;border-top:1px solid var(--border-color);display:flex;gap:6px;flex-wrap:wrap;">' +
            '<button onclick="App.showGroupManageModal()" style="flex:1;padding:8px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;color:var(--text-muted);cursor:pointer;font-size:12px;"><i class="bi bi-plus-circle"></i> 新建分组</button>' +
            '<button onclick="App.showGroupManageModal()" style="flex:1;padding:8px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;color:var(--text-muted);cursor:pointer;font-size:12px;"><i class="bi bi-gear"></i> 管理分组</button>' +
            '</div>';
    }
    
    sidebar.innerHTML = html;
    App._injectSidebarToggle(sidebar);
    } catch(e) {
        console.error('[wc-bridge] renderSidebar 崩溃:', e.message, e.stack);
        var sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.innerHTML = '<div style="padding:20px;color:#ef4444;font-size:13px;">侧边栏渲染失败: ' + e.message + '</div>';
    }
};

// Phase15: 渲染单个树节点（递归）— 只有 root 可折叠，sub 永远展开
App._renderTreeNode = function(node, depth) {
    var isLeaf = !node.children || node.children.length === 0;
    var isActive = this.state.currentGroupId === node.id;
    var padLeft = 12 + depth * 18;
    var icon = node.icon || (node.group_type === 'root' ? '📁' : node.group_type === 'sub' ? '📂' : '📄');
    // 防止 icon + name 开头重复图标：若 name 以 icon 开头则去掉
    var displayName = node.name || '';
    if (icon && displayName.indexOf(icon) === 0) {
        displayName = displayName.substring(icon.length).trim();
    }
    
    // 计算 countStr
    var countStr = '';
    if (node.group_type === 'root' || node.group_type === 'sub') {
        // 递归统计所有后代叶子节点的 card_count
        var totalCards = 0;
        function sumRecursive(ns) {
            for (var i = 0; i < ns.length; i++) {
                var n = ns[i];
                if (!n.children || n.children.length === 0) {
                    totalCards += (n.card_count || 0);
                } else {
                    sumRecursive(n.children);
                }
            }
        }
        if (node.children) sumRecursive(node.children);
        countStr = '<span class="count-badge" style="font-size:11px;">' + totalCards + '</span>';
    } else {
        countStr = '<span class="count-badge" style="font-size:11px;">' + (node.card_count || 0) + '</span>';
    }
    
    var nodeId = 'treeNode_' + (node.group_type || '') + '_' + node.id;
    
    // ── ROOT: 只有根节点可折叠 ──
    if (node.group_type === 'root') {
        var isExpanded = node._expanded !== false;
        var arrow = isExpanded ? '▼' : '▶';
        var expandIcon = '<span class="tree-arrow" data-node="' + nodeId + '" style="cursor:pointer;width:20px;display:inline-block;font-size:12px;text-align:center;">' + arrow + '</span>';
        
        var rootAddBtn = '';
        if (this.state.editMode) {
            rootAddBtn = '<button class="tree-add-btn" onclick="event.stopPropagation();App._treeQuickAdd(' + node.id + ')" title="在此根下新建子分类">+</button>';
        }
        
        var html = '<div id="' + nodeId + '" class="tree-node tree-root" onclick="App._toggleTreeNode(\'' + nodeId + '\',' + node.id + ')">' +
            expandIcon +
            '<span style="font-size:17px;width:22px;text-align:center;">' + icon + '</span>' +
            '<span style="font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;">' + App._escape(displayName) + '</span>' +
            countStr +
            rootAddBtn +
            '</div>';
        
        if (isExpanded && node.children) {
            html += '<div class="tree-children" id="children_' + nodeId + '" style="display:block;">';
            for (var c = 0; c < node.children.length; c++) {
                html += this._renderTreeNode(node.children[c], depth + 1);
            }
            html += '</div>';
        } else if (node.children) {
            html += '<div class="tree-children" id="children_' + nodeId + '" style="display:none;"></div>';
        }
        return html;
    }
    
    // ── SUB: 永远展开、无折叠箭头，编辑模式带 + 按钮 ──
    if (node.group_type === 'sub') {
        // 包含关系容器：sub 标题 + 所有子节点包在一个左边框容器里
        var addBtn = '';
        if (this.state.editMode) {
            addBtn = '<button class="tree-add-btn" onclick="event.stopPropagation();App._treeQuickAdd(' + node.id + ')" title="在此分组下新建子分组">+</button>';
        }
        var html = '<div class="tree-sub-container">'; // Phase15: 包含关系容器
        html += '<div class="tree-node tree-sub" style="cursor:default;">' +
            '<span style="width:20px;display:inline-block;">&nbsp;</span>' +
            '<span style="font-size:15px;width:22px;text-align:center;">' + icon + '</span>' +
            '<span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;">' + App._escape(displayName) + '</span>' +
            countStr +
            addBtn +
            '</div>';
        
        if (node.children && node.children.length > 0) {
            html += '<div class="tree-children" style="display:block;">';
            for (var c = 0; c < node.children.length; c++) {
                html += this._renderTreeNode(node.children[c], depth + 1);
            }
            html += '</div>';
        }
        // 编辑模式：底部「+ 添加分组」按钮
        if (this.state.editMode) {
            html += '<div class="tree-add-row" onclick="event.stopPropagation();App._treeQuickAdd(' + node.id + ')">' +
                '<i class="bi bi-plus-circle"></i> 添加分组' +
                '</div>';
        }
        html += '</div>'; // close tree-sub-container
        return html;
    }
    
    // ── LEAF: 可点击加载 ──
    var delBtn = '';
    if (node.group_type === 'custom' && this.state.editMode) {
        delBtn = '<button class="header-btn-sm" onclick="event.stopPropagation();App.gmDelete(' + node.id + ',\'' + (node.name||'').replace(/'/g,"\\'") + '\',this)" title="移除分组" style="font-size:11px;color:#ef4444;padding:0 3px;opacity:0.7;">✕</button>';
    }
    var editBtn = '';
    if (node.group_type === 'custom' && this.state.editMode) {
        editBtn = '<button class="header-btn-sm" onclick="event.stopPropagation();App.gmEdit(' + node.id + ',\'' + (node.name||'').replace(/'/g,"\\'") + '\',this)" title="重命名" style="font-size:11px;opacity:0.7;">✎</button>';
    }
    
    return '<div class="module-item ' + (isActive ? 'active' : '') + '" data-gid="' + node.id + '" data-gname="' + (node.name||'').replace(/"/g,'&quot;') + '" onclick="App._treeLeafClick(this)" ' +
        'style="margin:0 8px 2px;padding-left:' + padLeft + 'px;" data-group-id="' + node.id + '">' +
        '<span class="icon">' + icon + '</span>' +
        '<span>' + App._escape(displayName) + '</span>' +
        countStr +
        editBtn + delBtn +
        '</div>';
};

// Phase15: 侧边栏内快速添加分组
App._treeQuickAdd = function(parentId) {
    var name = prompt('在此分组下新建子分组名称：');
    if (!name || !name.trim()) return;
    var body = { name: name.trim(), icon: '📂', parent_group_id: parentId };
    var self = this;
    fetch('/api/v4/word-cards/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(function(r) {
        if (r.ok) {
            r.json().then(function() {
                self.showToast('已添加', 'success');
                self.loadGroupTree().then(function() {
                    // 添加后重渲染：侧边栏（loadGroupTree已做）+ 陈列架（currentGroupId=null需手动）
                    if (self.state.currentGroupId === null) self._showShowcase();
                });
            });
        } else {
            r.json().then(function(e) { self.showToast('添加失败: ' + (e.detail || 'HTTP ' + r.status), 'error'); })
                .catch(function() { self.showToast('添加失败', 'error'); });
        }
    }).catch(function(e) { self.showToast('出错: ' + e.message, 'error'); });
};

// 叶子节点点击代理（data属性避免引号注入）
App._treeLeafClick = function(el) {
    var gid = parseInt(el.getAttribute('data-gid'));
    var gname = el.getAttribute('data-gname') || '';
    if (gid) App.switchGroup(gid, gname);
};

// 折叠/展开树节点
App._toggleTreeNode = function(nodeId, groupId) {
    var children = document.getElementById('children_' + nodeId);
    if (!children) return;
    
    var node = document.getElementById(nodeId);
    var arrow = node ? node.querySelector('.tree-arrow') : null;
    
    var isCurrentlyExpanded = children.style.display !== 'none';
    
    if (!isCurrentlyExpanded) {
        // 展开
        children.style.display = 'block';
        if (arrow) arrow.textContent = '▼';
        // 懒加载子节点
        if (children.innerHTML.trim() === '') {
            this._loadTreeChildren(children, groupId);
        }
    } else {
        children.style.display = 'none';
        if (arrow) arrow.textContent = '▶';
    }
    
    // 持久化到树数据，确保 re-render 后状态不丢失
    var self = this;
    function setExpanded(nodes, targetId) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === targetId) {
                nodes[i]._expanded = !isCurrentlyExpanded;
                return true;
            }
            if (nodes[i].children && setExpanded(nodes[i].children, targetId)) return true;
        }
        return false;
    }
    setExpanded(this.state.groupTree, groupId);
};

// 懒加载树节点子元素
App._loadTreeChildren = function(container, parentId) {
    var tree = this.state.groupTree;
    var html = '';
    function findAndRender(nodes, depth) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === parentId && nodes[i].children) {
                for (var c = 0; c < nodes[i].children.length; c++) {
                    html += App._renderTreeNode(nodes[i].children[c], depth + 1);
                }
                return;
            }
            if (nodes[i].children) findAndRender(nodes[i].children, depth + 1);
        }
    }
    findAndRender(tree, 0);
    container.innerHTML = html;
};

// Phase15: 编辑模式下移动按钮已统一在 app_editor.js 模板中渲染，不再动态注入
App._wcInjectMoveButtons = function() {
    // 移动按钮已内联到卡片模板，无需动态注入
};

App._wcShowMovePicker = function(cardId) {
    // Phase15.1: 直接复用批量移动弹窗
    this._bmvIds = [cardId];
    var tree = this.state.groupTree;
    if (!tree || tree.length === 0) { this.showToast('分组未加载', 'error'); return; }
    document.getElementById('bmvTitle').textContent = '移动词卡到分组';
    this._wcRenderBmvTree(tree);
    document.getElementById('modalBatchMove').style.display = 'flex';
};

App._wcMoveCard = function(cardId, targetGroupId, groupName) {
    var self = this;
    fetch('/api/v4/word-cards/' + cardId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: targetGroupId })
    }).then(function(r) {
        if (r.ok) {
            self.showToast('已移动', 'success');
            self._wcLoadPrompts();
            // 刷新分组树统计（侧边栏 + 陈列架计数同步）
            self.loadGroupTree();
        } else {
            self.showToast('移动失败', 'error');
        }
    }).catch(function() { self.showToast('出错', 'error'); });
};

// Phase15: 批量移动 — 独立弹窗，完整展示分组树（root→sub→leaf 三级）
App._wcBatchMove = function() {
    var ids = [];
    try { ids = Array.from(App.state.batchSelected); } catch(e) { ids = []; }
    if (ids.length === 0) {
        document.querySelectorAll('#promptList .batch-checkbox:checked').forEach(function(cb) {
            ids.push(parseInt(cb.getAttribute('data-id')));
        });
    }
    if (ids.length === 0) { this.showToast('请先勾选词卡', 'warning'); return; }
    
    // 存储待移动 ID
    this._bmvIds = ids;
    var tree = this.state.groupTree;
    if (!tree || tree.length === 0) { this.showToast('分组树未加载', 'error'); return; }
    
    document.getElementById('bmvTitle').textContent = '批量移动 ' + ids.length + ' 条到分组';
    this._wcRenderBmvTree(tree);
    document.getElementById('modalBatchMove').style.display = 'flex';
};

App._wcCloseBatchMove = function() {
    document.getElementById('modalBatchMove').style.display = 'none';
};

// 渲染批量移动弹窗内的完整分组树
App._wcRenderBmvTree = function(tree) {
    var container = document.getElementById('bmvTreeList');
    if (!container) return;
    var gid = this.state.currentGroupId;
    var self = this;
    
    var html = '';
    for (var t = 0; t < tree.length; t++) {
        var root = tree[t];
        // 计算 root 总数
        var rt = 0;
        function s2(ns) { for (var i=0;i<ns.length;i++) { rt+=ns[i].card_count||0; if(ns[i].children)s2(ns[i].children); } }
        if (root.children) s2(root.children);
        
        html += '<div style="margin-bottom:14px;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;">';
        html += '<div style="padding:8px 14px;background:var(--hover-bg);font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;">';
        html += '<span style="font-size:20px;">' + (root.icon||'📁') + '</span>';
        html += App._escape(root.name.replace(root.icon||'','').trim());
        html += '<span style="font-size:11px;color:var(--text-muted);margin-left:auto;">' + rt + ' 条</span>';
        html += '</div>';
        html += '<div style="padding:6px 14px 10px;">';
        
        if (root.children) {
            for (var s = 0; s < root.children.length; s++) {
                var sub = root.children[s];
                if (!sub.children || sub.children.length === 0) continue;
                
                html += '<div style="border-left:2px solid var(--border-color);margin-bottom:4px;padding:4px 0 4px 10px;border-radius:0 6px 6px 0;">';
                html += '<div style="font-weight:600;font-size:12px;color:var(--text-muted);margin-bottom:4px;">';
                html += (sub.icon||'📂') + ' ' + App._escape(sub.name.replace(sub.icon||'','').trim());
                html += '</div>';
                html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
                
                for (var g = 0; g < sub.children.length; g++) {
                    var grp = sub.children[g];
                    if (grp.group_type === 'sub' || grp.group_type === 'root') continue;
                    var isCurrent = grp.id === gid;
                    html += '<div data-bmv-gid="' + grp.id + '" class="bmv-leaf-btn" style="font-size:12px;padding:5px 12px;border:1px solid ' + (isCurrent ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:6px;background:' + (isCurrent ? 'rgba(79,70,229,0.1)' : 'var(--bg-card)') + ';color:' + (isCurrent ? 'var(--primary)' : 'var(--text-main)') + ';cursor:pointer;white-space:nowrap;transition:all 0.15s;' + (isCurrent ? 'opacity:0.5;pointer-events:none;' : '') + '" onmouseenter="if(!this.dataset.disabled)this.style.borderColor=var(\'--primary\');this.style.background=var(\'--hover-bg\')" onmouseleave="if(!this.dataset.disabled){this.style.borderColor=var(\'--border-color\');this.style.background=var(\'--bg-card\')}">' + (grp.icon||'📄') + ' ' + App._escape(grp.name.replace(grp.icon||'','').trim()) + ' <span style="font-size:9px;color:var(--text-muted);">' + (grp.card_count||0) + '</span></div>';
                }
                html += '</div></div>';
            }
        }
        html += '</div></div>';
    }
    container.innerHTML = html;
    
    // 委托点击
    container.querySelectorAll('.bmv-leaf-btn').forEach(function(el) {
        el.addEventListener('click', function() {
            var tgId = parseInt(this.getAttribute('data-bmv-gid'));
            var tgName = this.textContent.replace(/\s*\d+\s*$/,'').trim();
            self._wcCloseBatchMove();
            self._wcDoBatchMove(self._bmvIds, tgId, tgName);
        });
    });
};

// Phase15: 执行批量移动
App._wcDoBatchMove = function(ids, targetGroupId, groupName) {
    var self = this;
    fetch('/api/v4/word-cards/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', ids: ids, group_id: targetGroupId })
    }).then(function(r) {
        if (r.ok) {
            self.showToast('已移动 ' + ids.length + ' 条到「' + groupName + '」', 'success');
            self.state.batchSelected.clear();
            self.updateBatchCount();
            self._wcLoadPrompts();
            self.loadGroupTree();
        } else {
            self.showToast('移动失败', 'error');
        }
    }).catch(function() { self.showToast('出错', 'error'); });
};

// Phase15: 隐藏编辑工具栏
App._hideBatchBar = function() {
    var bb = document.getElementById('batchBar');
    if (bb) bb.style.display = 'none';
};
App._hideEditFilterBar = function() {
    var fb = document.getElementById('editFilterBar');
    if (fb) fb.style.display = 'none';
};

// Phase15: 侧边栏滚动到选中分组（使其靠近顶部，父级可见）
App._scrollSidebarToGroup = function(groupId) {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    var el = sidebar.querySelector('[data-group-id="' + groupId + '"]') ||
             sidebar.querySelector('.module-item.active');
    if (!el) return;
    // 确保所有父级 root 展开
    var parent = el.parentElement;
    while (parent && parent !== sidebar) {
        if (parent.classList.contains('tree-children')) {
            parent.style.display = 'block';
        }
        parent = parent.parentElement;
    }
    // 滚动：目标元素显示在侧边栏顶部下方 80px
    sidebar.scrollTo({ top: Math.max(0, el.offsetTop - 80), behavior: 'smooth' });
};

// Phase15: 返回按钮 + 标题路径 — 整合到 page-header 行内
App._showBreadcrumb = function(show) {
    var btn = document.getElementById('btnBackToShowcase');
    if (!btn) return;
    if (!show) { btn.style.display = 'none'; return; }
    btn.style.display = 'inline-flex';
    // 标题旁显示路径（仅在 pageTitle 后追加）
    var gid = this.state.currentGroupId;
    var tree = this.state.groupTree;
    var path = '';
    function findPath(nodes, chain) {
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var nc = chain.concat([n.name]);
            if (n.id === gid) return nc;
            if (n.children) { var r = findPath(n.children, nc); if (r) return r; }
        }
        return null;
    }
    var chain = findPath(tree, []);
    var pt = document.getElementById('pageTitle');
    if (chain && chain.length > 1 && pt) {
        pt.textContent = chain[chain.length - 1];
    }
};

// ============================================================
// 8. 词卡加载（按 group_id）
// ============================================================
App._wcLoadPrompts = async function() {
    var s = this.state;
    if (s.currentGroupId === null) {
        // 无选中分组 → 显示陈列架
        this._showShowcase();
        return;
    }
    
    // 进入具体分组 → 恢复 AI 工具栏 + 显示面包屑
    App._aiToolbarSuppressed = false;
    if (App.aiTools) App.aiTools.showToolbar();
    this._showBreadcrumb(true);
    
    s.isLoading = true;
    if (s.prompts.length === 0) this.renderPrompts();

    var qs = 'page=' + s.page + '&page_size=' + s.pageSize + '&group_id=' + s.currentGroupId;
    if (s.searchQuery) qs += '&search=' + encodeURIComponent(s.searchQuery);

    try {
        var d = await this.fetchJSON('/api/v4/word-cards?' + qs);
        s.isLoading = false;
        if (!d || !d.items) { this.renderPrompts(); return; }

        s.prompts = d.items.map(function(item) {
            var tags = item.tags || [];
            if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch(e) { tags = []; } }
            return {
                id: item.id,
                content: item.content,
                content_en: item.content_en || '',
                content_zh: item.content_zh || '',
                meaning: item.meaning || '',
                module: item.module || '',
                category: item.category || '',
                tags: JSON.stringify(tags),
                thumbnail: item.thumbnail || '',
                original_ref: item.original_ref || '',
                media_type: item.media_type || 'image',
                usage_count: item.usage_count || 0,
                is_builtin: item.is_builtin || false,
                collections: [],  // 延迟填充：下方批量查询收藏归属
                group_name: item.group_name || '',
                scene: item.scene || '',
                subcategory: item.subcategory || '',
                card_role: item.card_role || '',
                preview_media: item.preview_media || '',
                _source: 'word_card'
            };
        });

        // Phase17: 批量查询所有词卡的收藏归属，注入到每张卡的 collections 字段
        var ids = s.prompts.map(function(p) { return p.id; });
        if (ids.length > 0) {
            try {
                var collMap = await this.fetchJSON('/api/v2/collections/prompt-batch?ids=' + ids.join(','), { _timeoutMs: 5000 });
                if (collMap) {
                    for (var pi = 0; pi < s.prompts.length; pi++) {
                        var pid = s.prompts[pi].id;
                        s.prompts[pi].collections = collMap[String(pid)] || collMap[pid] || [];
                    }
                }
            } catch(e) {
                console.warn('[wc-bridge] 收藏归属查询失败:', e.message);
            }
        }

        s.totalItems = d.total;
        s.totalPages = d.total_pages || 1;
        this.renderPrompts();
        this.renderPagination();
        this.updateBatchCount();  // 切换分组后：根据当前分组数据更新按钮状态
        document.getElementById('countInfo').textContent = '共 ' + d.total + ' 条词卡';
        document.getElementById('pageTitle').textContent = s.currentGroupName || '词卡列表';
        // 侧边栏滚动到当前分组（首次加载/刷新时也触发）
        var self = this;
        setTimeout(function() { self._scrollSidebarToGroup(s.currentGroupId); }, 200);
    } catch(e) {
        s.isLoading = false;
        this.renderPrompts();
        this.updateBatchCount();  // 错误降级也要刷新按钮状态
    }
};

// ============================================================
// 9. 重写 loadPrompts
// ============================================================
var _origLoadPrompts = App.loadPrompts;
App.loadPrompts = function() {
    if (this.state.currentGroupId !== null || this.state._searchMode === 'semantic') {
        return this._wcLoadPrompts();
    }
    return this._wcLoadPrompts(); // 无选中时也显示陈列架
};

// ============================================================
// 10. 搜索也走 word_card
// ============================================================
App._wcDoSearch = function() {
    this.state.page = 1;
    this.state.searchQuery = document.getElementById('searchInput').value.trim();
    if (!this.state.searchQuery) {
        // Phase17: 清空搜索词时恢复当前分组视图（不是陈列架）
        this._wcLoadPrompts();
        return;
    }
    // Phase17: 搜索在分组内进行（currentGroupId 保持不变）
    this._wcLoadPrompts();
};

// ============================================================
// 11. 搜索输入 Hook + 分组恢复（在 loadGroupTree 成功回调中调用）
// 不再覆盖 App.init（wc_bridge 现在在 app_core 之前加载）
// ============================================================
App._wcHookSearchAndRestore = function() {
    var origSearchInput = document.getElementById('searchInput');
    if (origSearchInput) {
        origSearchInput.setAttribute('onkeydown', "if(event.key==='Enter')App._wcDoSearch()");
    }
    // 恢复上次选中的分组
    var savedGroupId = null;
    try { savedGroupId = localStorage.getItem('promptkit_group_id'); } catch(e) {}
    if (savedGroupId) {
        this.state.currentGroupId = parseInt(savedGroupId) || null;
    }
};

// ============================================================
// 12. 分组管理 (Phase14.2 — 完整弹窗)
// ============================================================

// 打开管理弹窗
App.showGroupManageModal = function() {
    var modal = document.getElementById('modalGroupManager');
    if (!modal) { this.showToast('管理面板未加载', 'error'); return; }
    modal.style.display = 'flex';
    this.gmRefresh();
};

App.closeGroupManager = function() {
    document.getElementById('modalGroupManager').style.display = 'none';
};

// 刷新分组列表
App.gmRefresh = function() {
    var list = document.getElementById('gmGroupList');
    if (!list) return;
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">加载中...</div>';
    var self = this;
    // 加载完整分组列表（含空分组）
    this.fetchJSON('/api/v4/word-cards/groups?include_empty=true').then(function(d) {
        if (!d || !d.groups) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">加载失败</div>'; return; }
        var groups = d.groups;
        // 更新父级下拉
        var parentSel = document.getElementById('gmNewParent');
        if (parentSel) {
            // 保留第一项
            parentSel.innerHTML = '<option value="">无父级（根级）</option>';
            for (var i = 0; i < groups.length; i++) {
                var g = groups[i];
                if (g.group_type !== 'root') {
                    parentSel.innerHTML += '<option value="' + g.id + '">' + self._escape(g.name) + (g.group_type === 'sub' ? ' (子类)' : '') + '</option>';
                }
            }
        }
        // 渲染列表
        var html = '';
        for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            var typeLabel = g.group_type === 'root' ? '<span style="color:#6366f1;font-weight:600;">根</span>' :
                            g.group_type === 'sub' ? '<span style="color:#8b5cf6;">子类</span>' :
                            g.group_type === 'builtin' ? '<span style="color:#059669;">内置</span>' :
                            g.group_type === 'seedance' ? '<span style="color:#d97706;">模板</span>' :
                            '<span style="color:#64748b;">自定义</span>';
            var locked = g.group_type === 'root' || g.group_type === 'builtin' || g.group_type === 'seedance';
            var indent = Math.min(g._depth || 0, 5) * 20;
            var iconStr = g.icon || '';
            // 名称去掉开头的 icon emoji，避免双 emoji
            var displayName = self._escape(g.name);
            if (iconStr && displayName.indexOf(iconStr) === 0) {
                displayName = displayName.substring(iconStr.length).trim();
            }
            html += '<div style="display:flex;align-items:center;padding:6px 12px;border-bottom:1px solid var(--border-color);' + (i%2===0?'background:var(--bg-card);':'') + '">' +
                '<span style="width:30px;font-size:16px;">' + (iconStr || '📄') + '</span>' +
                '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:' + indent + 'px;">' +
                    '<span style="font-weight:500;">' + displayName + '</span>' +
                    (g.description ? '<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">' + self._escape(g.description) + '</span>' : '') +
                '</span>' +
                '<span style="width:60px;text-align:center;font-size:12px;color:var(--text-muted);">' + (g.card_count || 0) + '</span>' +
                '<span style="width:80px;text-align:center;font-size:11px;">' + typeLabel + '</span>' +
                '<span style="width:80px;text-align:center;display:flex;gap:4px;justify-content:center;">' +
                    '<button onclick="App.gmEdit(' + g.id + ',\'' + self._escape(g.name).replace(/'/g,"\\'") + '\')" style="font-size:10px;padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-primary);color:var(--text-muted);cursor:pointer;" title="重命名"><i class="bi bi-pencil"></i></button>' +
                    (locked ? '' : '<button onclick="App.gmDelete(' + g.id + ',\'' + self._escape(g.name).replace(/'/g,"\\'") + '\')" style="font-size:10px;padding:2px 6px;border:1px solid #ef4444;border-radius:4px;background:#fef2f2;color:#ef4444;cursor:pointer;" title="删除"><i class="bi bi-trash"></i></button>') +
                '</span>' +
            '</div>';
        }
        list.innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--text-muted);">暂无分组</div>';
    }).catch(function(e) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">加载出错: ' + e.message + '</div>';
    });
};

// 创建分组
App.gmCreate = function() {
    var nameEl = document.getElementById('gmNewName');
    var iconEl = document.getElementById('gmNewIcon');
    var parentEl = document.getElementById('gmNewParent');
    var name = (nameEl ? nameEl.value.trim() : '');
    if (!name) { this.showToast('请输入分组名称', 'warning'); return; }
    var icon = iconEl ? iconEl.value : '📂';
    var parentId = parentEl && parentEl.value ? parseInt(parentEl.value) : null;
    var body = { name: name, icon: icon };
    if (parentId) body.parent_group_id = parentId;
    var self = this;
    fetch('/api/v4/word-cards/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(function(r) {
        if (r.ok) {
            r.json().then(function() {
                self.showToast('分组「' + name + '」已创建', 'success');
                if (nameEl) nameEl.value = '';
                self.loadGroupTree().then(function() {
                    self.gmRefresh();
                });
            });
        } else {
            r.json().then(function(e) { self.showToast('创建失败: ' + (e.detail || 'HTTP ' + r.status), 'error'); })
                .catch(function() { self.showToast('创建失败: HTTP ' + r.status, 'error'); });
        }
    }).catch(function(e) { self.showToast('创建出错: ' + e.message, 'error'); });
};

// Phase15: 行内重命名（有 btnEl 时变输入框，否则回退 prompt）
App.gmEdit = function(groupId, oldName, btnEl) {
    if (!btnEl) { var n=prompt('修改名称：',oldName||''); if(!n||!n.trim())return; var s=this; fetch('/api/v4/word-cards/groups/'+groupId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n.trim()})}).then(function(r){if(r.ok){s.showToast('已更新','success');s.loadGroupTree().then(function(){s.gmRefresh()})}else{s.showToast('更新失败','error')}}); return; }
    var el = btnEl.closest('.module-item');
    var spans = el.querySelectorAll('span');
    var nameSpan = null;
    for (var i = 0; i < spans.length; i++) {
        var s = spans[i];
        if (!s.classList.contains('icon') && !s.classList.contains('count-badge') && s.textContent.trim() === oldName) {
            nameSpan = s; break;
        }
    }
    if (!nameSpan) return;
    var origText = nameSpan.textContent || '';
    nameSpan.style.display = 'none';
    var input = document.createElement('input');
    input.type = 'text'; input.className = 'tree-rename-input';
    input.value = origText;
    input.style.cssText = 'flex:1;min-width:60px;font-size:13px;margin:1px 0;';
    nameSpan.parentNode.insertBefore(input, nameSpan.nextSibling);
    input.focus(); input.select();
    var self = this;
    var done = function() {
        var v = input.value.trim();
        input.remove(); nameSpan.style.display = '';
        if (!v || v === origText) return;
        fetch('/api/v4/word-cards/groups/' + groupId, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: v })
        }).then(function(r) {
            if (r.ok) { self.showToast('已更新', 'success'); self.loadGroupTree(); }
            else { self.showToast('更新失败', 'error'); }
        }).catch(function() { self.showToast('出错', 'error'); });
    };
    input.onblur = done;
    input.onkeydown = function(e) {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = origText; input.blur(); }
    };
};

// Phase15: 删除确认弹窗（有 btnEl 时贴按钮，否则回退 confirm）
App.gmDelete = function(groupId, groupName, btnEl) {
    if (!btnEl) { if(!confirm('移除「'+groupName+'」？词卡移至未分类，可恢复。'))return; var s0=this; fetch('/api/v4/word-cards/groups/'+groupId,{method:'DELETE'}).then(function(r){if(r.ok){s0.showToast('已移除','info');s0.loadGroupTree().then(function(){s0.gmRefresh();if(s0.state.currentGroupId===groupId)s0.switchAllGroups();else s0._showShowcase()})}else{r.json().then(function(e){s0.showToast('失败','error')})}}); return; }
    var old = document.querySelector('.gm-confirm-popover');
    if (old) old.remove();
    var pop = document.createElement('div');
    pop.className = 'gm-confirm-popover';
    pop.innerHTML = '<div style="text-align:center;">⚠️ 移除「'+App._escape(groupName)+'」？</div>' +
        '<div style="text-align:center;font-size:10px;color:var(--text-muted);margin-top:2px;">词卡移至未分类，可恢复</div>' +
        '<div class="gm-confirm-actions">' +
            '<button onclick="this.closest(\'.gm-confirm-popover\').remove()">取消</button>' +
            '<button class="gm-btn-danger" id="gmConfirmDeleteBtn">移入回收站</button>' +
        '</div>';
    document.body.appendChild(pop);
    var rect = btnEl.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = Math.max(8, rect.left + rect.width/2 - 90) + 'px';
    pop.style.top = (rect.bottom + 6) + 'px';
    pop.style.transform = 'translate(-50%, 0)';
    var self = this;
    pop.querySelector('#gmConfirmDeleteBtn').onclick = function() {
        pop.remove();
        fetch('/api/v4/word-cards/groups/' + groupId, { method: 'DELETE' }).then(function(r) {
            if (r.ok) {
                self.showToast('已移除「'+groupName+'」', 'info');
                self.loadGroupTree().then(function() {
                    if (self.state.currentGroupId === groupId) self.switchAllGroups();
                    else if (self.state.currentGroupId === null) self._showShowcase();
                });
            } else {
                r.json().then(function(e) { self.showToast('移除失败: '+(e.detail||''), 'error'); });
            }
        });
    };
    setTimeout(function() {
        document.addEventListener('click', function _cp(e) {
            if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', _cp); }
        });
    }, 50);
};

// 批量移动词卡（将来扩展）
App.gmBatchMove = function(fromGroupId) {
    App.showToast('批量迁移功能开发中...', 'info');
};

// ============================================================
// 13. _updatePageTitle 增强
// ============================================================
var _origUpdateTitle = App._updatePageTitle;
App._updatePageTitle = function() {
    if (this.state.currentGroupId !== null && this.state.currentView === 'home') {
        document.getElementById('pageTitle').textContent = this.state.currentGroupName || '词组列表';
    } else if (this.state.currentView === 'home') {
        document.getElementById('pageTitle').textContent = '查找词组';
    } else {
        if (_origUpdateTitle) _origUpdateTitle.call(this);
    }
};

// ============================================================
// 15. Phase15: Hook renderPrompts — 全部词组页面编辑模式切换后重渲染陈列架
// （延迟等待 app_core.js 加载完毕后再 hook）
// ============================================================
(function _wcHookRenderPrompts() {
    try { if (!App || !App.renderPrompts) { setTimeout(_wcHookRenderPrompts, 200); return; } }
    catch(e) { setTimeout(_wcHookRenderPrompts, 200); return; }
    var _origRP = App.renderPrompts;
    App.renderPrompts = function() {
        if (this.state.currentGroupId === null && this.state.currentView === 'home') {
            this._showShowcase();
            this._hideBatchBar();
            this._hideEditFilterBar();
            return;
        }
        _origRP.call(this);
        if (this.state.editMode) this._wcInjectMoveButtons();
        // P0-6: 拖拽词卡到侧边栏分组
        this._wcSetupCardDrag();
    };
})();

console.log('[wc-bridge] v14.14 collection-badge OK');

// ============ P0-6: 拖拽词卡移动到分组 ============

App._wcSetupCardDrag = function() {
    var self = this;
    // 为所有 prompt-card 添加 draggable
    var cards = document.querySelectorAll('.prompt-card');
    cards.forEach(function(card) {
        if (card.dataset.dragBound) return;
        card.dataset.dragBound = '1';
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', function(e) {
            var cid = parseInt(card.dataset.promptId || card.dataset.cardId || this.getAttribute('data-id'));
            if (!cid) return;
            e.dataTransfer.setData('text/plain', String(cid));
            e.dataTransfer.effectAllowed = 'move';
            this.style.opacity = '0.4';
        });
        card.addEventListener('dragend', function(e) {
            this.style.opacity = '';
        });
    });
    
    // 侧边栏分组节点作为 drop target
    var sideNodes = document.querySelectorAll('#sidebar [data-gid], #sidebar .tree-node');
    sideNodes.forEach(function(node) {
        if (node.dataset.dropBound) return;
        node.dataset.dropBound = '1';
        node.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.style.background = 'rgba(79,70,229,0.08)';
            this.style.outline = '2px dashed var(--primary)';
        });
        node.addEventListener('dragleave', function(e) {
            this.style.background = '';
            this.style.outline = '';
        });
        node.addEventListener('drop', async function(e) {
            e.preventDefault();
            this.style.background = '';
            this.style.outline = '';
            var cid = parseInt(e.dataTransfer.getData('text/plain'));
            var gid = parseInt(this.dataset.gid);
            if (!cid || !gid) return;
            try {
                await self.fetchJSON('/api/v4/word-cards/' + cid, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ group_id: gid })
                });
                self.showToast('已移动词卡到分组', 'success');
                await self._wcLoadPrompts();
                await self.loadGroupTree();
            } catch(e) {
                self.showToast('移动失败: ' + e.message, 'danger');
            }
        });
    });
};

})();
