(function boot() {
'use strict';
try { if (!App || (!App.fetchJSON && !window.PK)) { setTimeout(boot, 200); return; } }
catch(e) { setTimeout(boot, 200); return; }

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
            self.showToast('移动未完成', 'error');
        }
    }).catch(function() { self.showToast('出错', 'error'); });
};

// Phase15: 批量移动 — 独立弹窗，完整展示分组树（root→sub→leaf 三级）
// Phase17.3: 统一获取批量选中的词卡 ID（batchSelected Set 优先，DOM 兜底）
App._getBatchSelectedIds = function() {
    var ids = [];
    try { ids = Array.from(this.state.batchSelected); } catch(e) {}
    if (ids.length === 0) {
        document.querySelectorAll('#promptList .batch-checkbox:checked').forEach(function(cb) {
            var id = parseInt(cb.getAttribute('data-id'));
            if (!isNaN(id)) ids.push(id);
        });
    }
    return ids;
};

App._wcBatchMove = function() {
    var ids = this._getBatchSelectedIds();
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
            self.showToast('移动未完成', 'error');
        }
    }).catch(function() { self.showToast('出错', 'error'); })
    .finally(function() { self._bmvIds = null; });
};

// Phase20: 批量清除预览（缩略图 + 视频）
App._wcBatchClearPreview = function() {
    var ids = this._getBatchSelectedIds();
    if (ids.length === 0) { this.showToast('请先勾选词卡', 'warning'); return; }
    if (!confirm('确认清除 ' + ids.length + ' 条词卡的缩略图和视频预览？\n不会删除词卡内容本身。')) return;
    var self = this;
    fetch('/api/v4/word-cards/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_preview', ids: ids })
    }).then(function(r) {
        if (r.ok) {
            self.showToast('已清除 ' + ids.length + ' 条的预览媒体', 'success');
            self.state.batchSelected.clear();
            self.updateBatchCount();
            self._wcLoadPrompts();
        } else {
            r.json().then(function(d) { self.showToast(d.detail || '操作失败', 'error'); });
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

// Phase15: 智能返回 — 从子分组返回父组浏览器, 从父组返回词库首页
App._wcGoBack = function() {
    var pid = this.state._browserParentId;
    if (pid) {
        // 当前有浏览器父组 → 返回父组浏览器
        var tree = this.state.groupTree;
        var root = null;
        var findRoot = function(nodes) {
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i].id === pid) { root = nodes[i]; return; }
                if (nodes[i].children) findRoot(nodes[i].children);
            }
        };
        findRoot(tree);
        if (root) {
            // 清空当前分组ID, 防止 switchView('home') 触发 _wcLoadPrompts 覆盖浏览器
            this.state.currentGroupId = null;
            this.state.currentGroupName = '';
            this._showSubGroupBrowser(pid, root.group_key || '');
            return;
        }
    }
    // 无父组上下文 → 返回词库首页
    this.switchAllGroups();
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
        this._showShowcase();
        return;
    }
    // 进入具体分组 → 隐藏全部折叠按钮
    var btnCollapse = document.getElementById('btnCollapseAllGroups');
    if (btnCollapse) btnCollapse.style.display = 'none';
    // 防御：渲染器未就绪或分组ID无效时直接降级到陈列架
    if (typeof this.renderPrompts !== 'function') {
        if (!this.state.groupTree || this.state.groupTree.length === 0) {
            this._showShowcase();
            return;
        }
        // 分组存在性检查
        var found = false;
        var findGid = function(nodes) { for (var i=0;i<nodes.length;i++){ if(nodes[i].id===s.currentGroupId){found=true;return;} if(nodes[i].children)findGid(nodes[i].children); }};
        findGid(this.state.groupTree);
        if (!found) { s.currentGroupId=null; this._showShowcase(); return; }
        for (var _w = 0; _w < 15; _w++) {
            await new Promise(function(r) { setTimeout(r, 200); });
            if (typeof App.renderPrompts === 'function') break;
        }
        if (typeof this.renderPrompts !== 'function') {
            this._showShowcase();
            return;
        }
    }
    
    // 进入具体分组 → 恢复 AI 工具栏 + 显示面包屑
    App._aiToolbarSuppressed = false;
    if (App.aiTools) App.aiTools.showToolbar();
    this._showBreadcrumb(true);
    
    s.isLoading = true;
    if (s.prompts.length === 0 && typeof this.renderPrompts === 'function') this.renderPrompts();

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
                content_simple: item.content_simple || '',
                content_simple_en: item.content_simple_en || '',
                content_simple_zh: item.content_simple_zh || '',
                content_detailed: item.content_detailed || '',
                content_detailed_en: item.content_detailed_en || '',
                content_detailed_zh: item.content_detailed_zh || '',
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
                console.warn('[wc-bridge] 收藏归属查询未完成:', e.message);
            }
        }

        s.totalItems = d.total;
        s.totalPages = d.total_pages || 1;
        this.renderPrompts();
        this.renderPagination();
        this.updateBatchCount();  // 切换分组后：根据当前分组数据更新按钮状态
        document.getElementById('countInfo').textContent = '共 ' + d.total + ' 条词卡';
        document.getElementById('pageTitle').textContent = s.currentGroupName || '词卡分组';
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
})();
