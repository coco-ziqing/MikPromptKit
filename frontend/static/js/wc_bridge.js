// Phase14: 分类架构重构 — 树形侧边栏 + 陈列架首页
// 将侧边栏模块列表、首页卡片全部接入 word_card 统一数据源（嵌套分组树）
(function() {
'use strict';
if (!window.App || !App.fetchJSON) { setTimeout(arguments.callee, 200); return; }

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
    var si = document.getElementById('searchInput');
    if (si) si.value = '';
    try { localStorage.setItem('promptkit_group_id', String(groupId)); } catch(e) {}
    
    this._closeMobileMenu();
    // switchView('home') 内部会调用 renderSidebar + loadPrompts → _wcLoadPrompts
    this.switchView('home');
};

// 全部词库
App.switchAllGroups = function() {
    this.state.currentGroupId = null;
    this.state.currentGroupName = '';
    this.state.searchQuery = '';
    this.state.page = 1;
    var si = document.getElementById('searchInput');
    if (si) si.value = '';
    try { localStorage.removeItem('promptkit_group_id'); } catch(e) {}
    this._closeMobileMenu();
    // switchView('home') 内部会调用 renderSidebar + loadPrompts → _wcLoadPrompts → _showShowcase
    this.switchView('home');
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
// 5. 陈列架视图（首页默认，无分组选中时）
// ============================================================
App._showShowcase = function() {
    var container = document.getElementById('promptList');
    if (!container) return;
    
    var tree = this.state.groupTree;
    if (!tree || tree.length === 0) {
        container.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary" role="status"></div><p>加载分组中...</p></div>';
        return;
    }
    
    // 收集所有叶子分组（有 card_count > 0 的实际分组）
    var leafGroups = [];
    function collectLeaves(nodes, rootName) {
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if ((n.group_type === 'builtin' || n.group_type === 'seedance' || n.group_type === 'custom') && n.card_count > 0) {
                n._rootName = rootName;
                leafGroups.push(n);
            }
            if (n.children && n.children.length > 0) {
                collectLeaves(n.children, n.name);
            }
        }
    }
    for (var t = 0; t < tree.length; t++) {
        collectLeaves(tree[t].children, tree[t].name);
    }
    this.state.showcaseGroups = leafGroups;
    
    var html = '<div style="padding: 16px 0;"><h5 style="margin-bottom:4px;"><i class="bi bi-grid-3x3-gap-fill"></i> 词卡陈列架</h5>';
    html += '<p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">点击分组卡片进入词卡列表，或使用左侧分类树浏览</p>';
    
    // 按根分类分组展示
    for (var t = 0; t < tree.length; t++) {
        var root = tree[t];
        var rootLeaves = leafGroups.filter(function(g) { return g._rootName === root.name; });
        
        html += '<div style="margin-bottom:28px;">';
        html += '<h6 style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border-color);">';
        html += '<span style="font-size:20px;">' + (root.icon || '📁') + '</span>';
        html += '<span>' + App._escape(root.name) + '</span>';
        html += '<span style="font-size:12px;color:var(--text-muted);">' + rootLeaves.reduce(function(s,g){return s+g.card_count;},0) + ' 条</span>';
        html += '</h6>';
        
        // 按子类分组排列
        if (root.children) {
            for (var s = 0; s < root.children.length; s++) {
                var sub = root.children[s];
                var subLeaves = rootLeaves.filter(function(g) {
                    return g.parent_group_id === sub.id;
                });
                if (subLeaves.length === 0) continue;
                
                html += '<div style="margin-bottom:12px;">';
                html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:600;">' + (sub.icon || '') + ' ' + App._escape(sub.name) + '</div>';
                html += '<div class="prompt-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));">';
                
                for (var g = 0; g < subLeaves.length; g++) {
                    var grp = subLeaves[g];
                    html += App._renderShowcaseCard(grp);
                }
                html += '</div></div>';
            }
        }
        html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
    document.getElementById('countInfo').textContent = '共 ' + leafGroups.reduce(function(s,g){return s+g.card_count;},0) + ' 条词卡';
};

// 陈列架点击代理（data属性避免引号注入）
App._showcaseClick = function(el) {
    var gid = parseInt(el.getAttribute('data-gid'));
    var gname = el.getAttribute('data-gname') || '';
    if (gid) App.switchGroup(gid, gname);
};

// 陈列架卡片
App._renderShowcaseCard = function(grp) {
    var icon = grp.icon || '📄';
    var badge = grp.group_type === 'builtin' ? '<span style="font-size:10px;background:var(--bg-primary);color:var(--text-muted);padding:1px 6px;border-radius:4px;">内置</span>' :
                grp.group_type === 'custom' ? '<span style="font-size:10px;background:#e8f5e9;color:#2e7d32;padding:1px 6px;border-radius:4px;">自定义</span>' : '';
    return '<div class="showcase-card" data-gid="' + grp.id + '" data-gname="' + (grp.name||'').replace(/"/g,'&quot;') + '" onclick="App._showcaseClick(this)" style="cursor:pointer;border:1px solid var(--border-color);border-radius:12px;padding:16px;background:var(--bg-card);transition:all 0.2s;display:flex;align-items:center;gap:12px;">' +
        '<div style="font-size:28px;flex-shrink:0;">' + icon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
                '<span style="font-weight:600;font-size:14px;">' + App._escape(grp.name) + '</span>' +
                badge +
            '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);">' + grp.card_count + ' 条词卡</div>' +
        '</div>' +
        '<div style="color:var(--text-muted);font-size:18px;">→</div>' +
    '</div>';
};

// ============================================================
// 6. 重写 renderSidebar: 树形侧边栏
// ============================================================
var _origRenderSidebar = App.renderSidebar;
App.renderSidebar = function() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    
    var tree = this.state.groupTree;
    if (!tree || tree.length === 0) {
        sidebar.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:12px;">加载中...</div>';
        return;
    }
    
    var html = '<div style="padding:8px 14px 6px;color:var(--text-muted);font-size:11px;letter-spacing:1px;">分类导航</div>';
    
    // "全部词库" 入口
    var allActive = this.state.currentGroupId === null ? 'active' : '';
    html += '<div class="module-item ' + allActive + '" onclick="App.switchAllGroups()" style="margin:0 8px 4px;">' +
        '<span class="icon">🏠</span><span>全部词库</span>' +
        '</div>';
    
    // 渲染树
    for (var t = 0; t < tree.length; t++) {
        html += this._renderTreeNode(tree[t], 0);
    }
    
    // 编辑模式底部按钮
    if (this.state.editMode) {
        html += '<div style="margin-top:auto;padding:12px;border-top:1px solid var(--border-color);display:flex;gap:6px;flex-wrap:wrap;">' +
            '<button onclick="App.showGroupCreateModal()" style="flex:1;padding:6px 8px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;color:var(--text-muted);cursor:pointer;font-size:11px;"><i class="bi bi-plus-circle"></i> 新建分组</button>' +
            '<button onclick="App.showGroupManageModal()" style="flex:1;padding:6px 8px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;color:var(--text-muted);cursor:pointer;font-size:11px;"><i class="bi bi-gear"></i> 管理分组</button>' +
            '</div>';
    }
    
    sidebar.innerHTML = html;
    App._injectSidebarToggle(sidebar);
};

// 渲染单个树节点（递归）
App._renderTreeNode = function(node, depth) {
    if (node.group_type === 'custom' && node.card_count === 0 && depth > 0) return '';
    
    var isExpanded = node._expanded !== false; // 默认展开
    var isLeaf = !node.children || node.children.length === 0;
    var isActive = this.state.currentGroupId === node.id;
    var padLeft = 8 + depth * 16;
    var icon = node.icon || (node.group_type === 'root' ? '📁' : node.group_type === 'sub' ? '📂' : '📄');
    
    var countStr = '';
    if (node.group_type === 'root' || node.group_type === 'sub') {
        // 计算子节点总卡数
        var totalCards = node.card_count || 0;
        if (node.children) {
            for (var i = 0; i < node.children.length; i++) {
                totalCards += (node.children[i].card_count || 0);
            }
        }
        countStr = '<span class="count-badge" style="font-size:10px;">' + totalCards + '</span>';
    } else {
        countStr = '<span class="count-badge" style="font-size:10px;">' + (node.card_count || 0) + '</span>';
    }
    
    var nodeId = 'treeNode_' + (node.group_type || '') + '_' + node.id;
    
    // root 和 sub：可折叠，不可点击加载
    if (node.group_type === 'root' || node.group_type === 'sub') {
        var arrow = isExpanded ? '▼' : '▶';
        var expandIcon = isLeaf ? '<span style="width:16px;display:inline-block;">&nbsp;</span>' :
            '<span class="tree-arrow" data-node="' + nodeId + '" style="cursor:pointer;width:16px;display:inline-block;font-size:10px;">' + arrow + '</span>';
        
        var html = '<div id="' + nodeId + '" class="tree-node tree-' + node.group_type + '" style="padding:4px ' + (8 + depth*12) + 'px 4px ' + padLeft + 'px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted);" ' +
            'onclick="App._toggleTreeNode(\'' + nodeId + '\',' + node.id + ')">' +
            expandIcon +
            '<span style="font-size:13px;">' + icon + '</span>' +
            '<span style="font-weight:' + (node.group_type === 'root' ? '600' : '500') + ';flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + App._escape(node.name) + '</span>' +
            countStr +
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
    
    // leaf 节点（builtin/seedance/custom）：可点击加载（data属性避免引号注入）
    var delBtn = '';
    if (node.group_type === 'custom' && this.state.editMode) {
        delBtn = '<button class="header-btn-sm" onclick="event.stopPropagation();App.deleteGroupFromTree(' + node.id + ')" title="删除分组" style="font-size:10px;color:#ef4444;padding:0 3px;opacity:0.7;">✕</button>';
    }
    var editBtn = '';
    if (node.group_type === 'custom' && this.state.editMode) {
        editBtn = '<button class="header-btn-sm" onclick="event.stopPropagation();App.showGroupEditModal(' + node.id + ')" title="编辑分组" style="font-size:10px;opacity:0.7;">✎</button>';
    }
    
    return '<div class="module-item ' + (isActive ? 'active' : '') + '" data-gid="' + node.id + '" data-gname="' + (node.name||'').replace(/"/g,'&quot;') + '" onclick="App._treeLeafClick(this)" ' +
        'style="margin:0 8px 2px;padding-left:' + padLeft + 'px;" data-group-id="' + node.id + '">' +
        '<span class="icon">' + icon + '</span>' +
        '<span>' + App._escape(node.name) + '</span>' +
        countStr +
        editBtn + delBtn +
        '</div>';
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

// ============================================================
// 7. 词卡加载（按 group_id）
// ============================================================
App._wcLoadPrompts = async function() {
    var s = this.state;
    if (s.currentGroupId === null) {
        // 无选中分组 → 显示陈列架
        this._showShowcase();
        return;
    }
    
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
                meaning: item.meaning || '',
                module: item.module || '',
                category: item.category || '',
                tags: JSON.stringify(tags),
                thumbnail: item.thumbnail || '',
                media_type: item.media_type || 'image',
                usage_count: item.usage_count || 0,
                is_builtin: item.is_builtin || false,
                collections: [],
                group_name: item.group_name || '',
                scene: item.scene || '',
                subcategory: item.subcategory || '',
                video_filename: item.video_filename || '',
                video_fps: item.video_fps || '',
                _source: 'word_card'
            };
        });
        s.totalItems = d.total;
        s.totalPages = d.total_pages || 1;
        this.renderPrompts();
        this.renderPagination();
        document.getElementById('countInfo').textContent = '共 ' + d.total + ' 条词卡';
        document.getElementById('pageTitle').textContent = s.currentGroupName || '词卡列表';
    } catch(e) {
        s.isLoading = false;
        this.renderPrompts();
    }
};

// ============================================================
// 8. 重写 loadPrompts
// ============================================================
var _origLoadPrompts = App.loadPrompts;
App.loadPrompts = function() {
    if (this.state.currentGroupId !== null || this.state._searchMode === 'semantic') {
        return this._wcLoadPrompts();
    }
    return this._wcLoadPrompts(); // 无选中时也显示陈列架
};

// ============================================================
// 9. 搜索也走 word_card
// ============================================================
App._wcDoSearch = function() {
    this.state.page = 1;
    this.state.searchQuery = document.getElementById('searchInput').value.trim();
    if (!this.state.searchQuery) {
        this.state.currentGroupId = null;
        this._showShowcase();
        return;
    }
    this._wcLoadPrompts();
};

// ============================================================
// 10. Hook 全局搜索 + init
// ============================================================
if (typeof App.init === 'function') {
    var _origInit = App.init;
    App.init = function() {
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
        
        return _origInit.apply(this, arguments);
    };
}

// ============================================================
// 11. 分组管理 CRUD (Phase14)
// ============================================================
App.showGroupCreateModal = function() {
    var name = prompt('请输入新分组名称：');
    if (!name || !name.trim()) return;
    var icon = prompt('图标（emoji，默认 📂）：', '📂') || '📂';
    var parentIdStr = prompt('父级分组 ID（可选，留空则为自定义收纳）：', '');
    var parentId = parentIdStr ? parseInt(parentIdStr) : null;
    
    fetch('/api/v4/word-cards/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), icon: icon, parent_group_id: parentId || null })
    }).then(function(r) {
        if (r.ok) {
            r.json().then(function(d) {
                App.showToast('分组「' + name + '」已创建', 'success');
                App.loadGroupTree().then(function() {
                    App._showShowcase();
                });
            });
        } else {
            r.json().then(function(e) {
                App.showToast('创建失败: ' + (e.detail || e.error || 'HTTP ' + r.status), 'error');
            }).catch(function() {
                App.showToast('创建失败: HTTP ' + r.status, 'error');
            });
        }
    }).catch(function(e) {
        App.showToast('创建出错: ' + e.message, 'error');
    });
};

App.showGroupEditModal = function(groupId) {
    var name = prompt('修改分组名称：');
    if (!name || !name.trim()) return;
    
    fetch('/api/v4/word-cards/groups/' + groupId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
    }).then(function(r) {
        if (r.ok) {
            App.showToast('已更新', 'success');
            App.loadGroupTree().then(function() {
                App._showShowcase();
            });
        } else {
            App.showToast('更新失败', 'error');
        }
    });
};

App.deleteGroupFromTree = function(groupId) {
    if (!confirm('确定删除此分组？词卡将移至未分类。')) return;
    
    fetch('/api/v4/word-cards/groups/' + groupId, { method: 'DELETE' }).then(function(r) {
        if (r.ok) {
            App.showToast('已删除', 'info');
            App.loadGroupTree().then(function() {
                if (App.state.currentGroupId === groupId) {
                    App.switchAllGroups();
                } else {
                    App._showShowcase();
                }
            });
        } else {
            App.showToast('删除失败（可能不可删除）', 'error');
        }
    });
};

App.showGroupManageModal = function() {
    App.showToast('管理面板开发中...请在侧边栏中直接编辑/删除自定义分组', 'info');
};

// ============================================================
// 12. _updatePageTitle 增强
// ============================================================
var _origUpdateTitle = App._updatePageTitle;
App._updatePageTitle = function() {
    if (this.state.currentGroupId !== null && this.state.currentView === 'home') {
        document.getElementById('pageTitle').textContent = this.state.currentGroupName || '词卡列表';
    } else if (this.state.currentView === 'home') {
        document.getElementById('pageTitle').textContent = '词卡陈列架';
    } else {
        if (_origUpdateTitle) _origUpdateTitle.call(this);
    }
};

console.log('[wc-bridge] Phase14 树形侧边栏+陈列架已激活');
})();
