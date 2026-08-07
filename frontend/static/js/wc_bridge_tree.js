(function boot() {
'use strict';
try { if (!App || (!App.fetchJSON && !window.PK)) { setTimeout(boot, 200); return; } }
catch(e) { setTimeout(boot, 200); return; }

App.loadGroupTree = async function() {
    // 2026-08-06 修复：瞬时失败（网络抖动/服务重启/语义重建锁库）不再永久空白侧边栏
    // 自动重试最多 4 次（2s/4s/8s/16s 退避），每次失败仍渲染占位 + 手动重试入口
    var self = this;
    if (!this._groupTreeRetry) this._groupTreeRetry = 0;
    try {
        var d = await this.fetchJSON('/api/v4/word-cards/groups/tree', { _timeoutMs: 15000 });
        if (d && d.tree) {
            this._groupTreeRetry = 0;  // 成功重置重试计数
            // 保存旧树展开状态（防止排序/编辑后折叠）
            var expandState = {};
            var _saveExpand = function(nodes) {
                for (var i = 0; i < nodes.length; i++) {
                    expandState[nodes[i].id] = nodes[i]._expanded;
                    if (nodes[i].children) _saveExpand(nodes[i].children);
                }
            };
            if (this.state.groupTree && this.state.groupTree.length > 0) {
                _saveExpand(this.state.groupTree);
            }
            // 所有根组/父组默认折叠，点击三角展开，点击名称打开子分组浏览器
            var _ensureCollapsed = function(nodes) {
                for (var i = 0; i < nodes.length; i++) {
                    var n = nodes[i];
                    // 优先恢复保存的展开状态，否则默认折叠
                    if (expandState.hasOwnProperty(n.id)) {
                        n._expanded = expandState[n.id];
                    } else if (n._expanded === undefined) {
                        // 2026-08-03: 默认展开（原 dev 设计默认折叠导致侧边栏分组"不显示"）
                        n._expanded = true;
                    }
                    if (n.children) _ensureCollapsed(n.children);
                }
            };
            _ensureCollapsed(d.tree);
            this.state.groupTree = d.tree;
            this.renderSidebar();
            // 延迟 Hook 搜索框（此时 DOM 已就绪）
            setTimeout(function() { App._wcHookSearchAndRestore(); }, 100);
            // 修复竞态：树到达后，若主区仍停在"加载分组中"占位且处于首页陈列架(无分组)，补渲染
            // 2026-08-06 增强：无分组时若主区被旧版 loadPrompts 渲染成词卡网格(prompt-grid)也强制回陈列架
            // （wc_bridge 200ms 重试晚于 init → init 降级走了 app_core 原始 loadPrompts → 词卡网格无分组按钮）
            try {
                var pl = document.getElementById('promptList');
                var vh = document.getElementById('viewHome');
                var homeActive = vh && vh.classList.contains('active-view');
                var showHome = !App.state.currentGroupId && !App.state.currentModule && !App.state.searchQuery;
                if (pl && homeActive && showHome) {
                    var needShowcase = /加载分组中|showcase\.loading|loading-spinner|prompt-grid/.test(pl.innerHTML)
                        || !/showcase_root_/.test(pl.innerHTML);
                    if (needShowcase && typeof App._showShowcase === 'function') {
                        App._showShowcase();
                    }
                }
            } catch(e2) {}
            return d;
        } else {
            // 网络/API 异常：置空树 + 渲染错误提示 + 自动重试
            console.warn('[wc-bridge] loadGroupTree: API 返回空数据');
            this.state.groupTree = [];
            this.renderSidebar();
            var pl2 = document.getElementById('promptList');
            if (pl2 && pl2.innerHTML.indexOf('词库数据加载失败') === -1) {
                pl2.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);"><p>📡 词库数据加载失败</p><button class="btn btn-sm btn-outline-primary" onclick="App.loadGroupTree()" style="margin-top:12px;">🔄 重试</button></div>';
            }
            this._scheduleGroupTreeRetry('空数据');
        }
    } catch(e) {
        console.warn('[wc-bridge] loadGroupTree error:', e.message);
        // 异常路径同样渲染侧边栏占位（防止 sidebar 完全空白），并自动重试
        this.state.groupTree = this.state.groupTree || [];
        try { if (typeof this.renderSidebar === 'function') this.renderSidebar(); } catch(e2) {}
        this._scheduleGroupTreeRetry(e.message);
    }
    return null;
};

// 失败自动重试（指数退避 2/4/8/16s，最多 4 次；成功后重置）
App._scheduleGroupTreeRetry = function(reason) {
    var self = this;
    if (this._groupTreeRetryTimer) { clearTimeout(this._groupTreeRetryTimer); }
    if (this._groupTreeRetry >= 4) {
        console.warn('[wc-bridge] loadGroupTree 重试耗尽，等待用户手动重试');
        return;
    }
    this._groupTreeRetry = (this._groupTreeRetry || 0) + 1;
    var delay = 2000 * Math.pow(2, this._groupTreeRetry - 1);  // 2/4/8/16s
    console.warn('[wc-bridge] loadGroupTree 自动重试 #' + this._groupTreeRetry + ' (' + delay + 'ms) 原因: ' + reason);
    this._groupTreeRetryTimer = setTimeout(function() {
        self._groupTreeRetryTimer = null;
        App.loadGroupTree();
    }, delay);
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
    // 行内搜索框：选中分组后显示
    var isb = document.getElementById('inlineSearchBox');
    var isi = document.getElementById('inlineSearchInput');
    if (isb) isb.style.display = 'flex';
    if (isi) isi.value = '';
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
    this.state._browserParentId = null;
    this.state.searchQuery = '';
    this.state.page = 1;
    // 回到陈列架时保存当前选择 → 清空（陈列架无批量操作）
    this._swapBatchSet(null);
    // 陈列架不显示批量栏，无需 updateBatchCount
    var si = document.getElementById('searchInput');
    if (si) si.value = '';
    // 陈列架/子分组浏览器不显示行内搜索框
    var isb = document.getElementById('inlineSearchBox');
    if (isb) isb.style.display = 'none';
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

    // 显示全部折叠按钮
    var btnCollapse = document.getElementById('btnCollapseAllGroups');
    if (btnCollapse) { btnCollapse.style.display = 'inline-block'; App._updateCollapseBtnLabel(); }

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
        // 2026-08-06 修复：树为空时触发自动重试（瞬时失败后自动恢复，不再无限转圈）
        if (typeof App._scheduleGroupTreeRetry === 'function') {
            App._scheduleGroupTreeRetry('showcase-empty');
        }
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
                    html += 'class="showcase-leaf-btn" style="font-size:13px;padding:6px 14px;line-height:1.5;"';
                    html += ' onmouseenter="this.style.borderColor=\'#3b82f6\';this.style.background=\'rgba(59,130,246,0.12)\';this.style.boxShadow=\'0 0 0 2px rgba(59,130,246,0.15)\'" onmouseleave="this.style.borderColor=\'\';this.style.background=\'\';this.style.boxShadow=\'\'"';
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
            
            // Phase20: sub 分组本身即为叶子容器（有词卡但无孙节点）
            // 如角色设定/场景设定/全局画风/全局负面 — 紧凑平铺，不占整行
            var selfLeafSubs = [];
            for (var sl = 0; sl < root.children.length; sl++) {
                var sub2 = root.children[sl];
                if (sub2.group_type === 'sub' && sub2.card_count > 0
                    && (!sub2.children || sub2.children.length === 0)) {
                    selfLeafSubs.push(sub2);
                }
            }
            if (selfLeafSubs.length > 0) {
                var allSubCards = selfLeafSubs.reduce(function(s,g){return s+(g.card_count||0);},0);
                html += '<div style="border-left:2px solid var(--border-color);margin-left:8px;margin-bottom:4px;padding:4px 0 4px 10px;border-radius:0 6px 6px 0;">';
                html += '<span style="font-size:11px;color:var(--text-muted);font-weight:600;">📂 ' + allSubCards + ' 条</span>';
                html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;">';
                for (var sl2 = 0; sl2 < selfLeafSubs.length; sl2++) {
                    var sub = selfLeafSubs[sl2];
                    html += '<button onclick="event.stopPropagation();App.switchGroup(' + sub.id + ',\'' + (sub.name||'').replace(/'/g,"\\'") + '\')" ';
                    html += 'class="showcase-leaf-btn" style="font-size:12px;padding:3px 10px;line-height:1.6;"';
                    html += ' onmouseenter="this.style.borderColor=\'#3b82f6\';this.style.background=\'rgba(59,130,246,0.12)\';this.style.boxShadow=\'0 0 0 2px rgba(59,130,246,0.15)\'" onmouseleave="this.style.borderColor=\'\';this.style.background=\'\';this.style.boxShadow=\'\'"';
                    html += '>';
                    html += (sub.icon||'📋') + ' ' + App._escape(sub.name.replace(sub.icon||'','').trim());
                    html += '<span style="font-size:10px;color:var(--text-muted);margin-left:3px;">' + (sub.card_count||0) + '</span>';
                    html += '</button>';
                }
                html += '</div></div>';
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
                    html += 'class="showcase-leaf-btn" style="font-size:13px;padding:6px 14px;line-height:1.5;"';
                    html += ' onmouseenter="this.style.borderColor=\'#3b82f6\';this.style.background=\'rgba(59,130,246,0.12)\';this.style.boxShadow=\'0 0 0 2px rgba(59,130,246,0.15)\'" onmouseleave="this.style.borderColor=\'\';this.style.background=\'\';this.style.boxShadow=\'\'"';
                    html += '>';
                    html += (grp.icon||'📄') + ' ' + App._escape(grp.name.replace(grp.icon||'','').trim());
                    html += '<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">' + (grp.card_count||0) + '</span>';
                    html += '</button>';
                }
                html += '</div></div>';
            }

            // Phase17.4: 无 sub 包裹的叶子分组（自定义分组 / 含词卡的 builtin 直挂 root 下）
            var uwLeaves = [];
            for (var u = 0; u < root.children.length; u++) {
                var cr = root.children[u];
                if (cr.group_type !== 'sub' && cr.group_type !== 'root' && cr.group_type !== 'atom'
                    && (!cr.children || cr.children.length === 0)) {
                    uwLeaves.push(cr);
                }
            }
            if (uwLeaves.length > 0) {
                var uwTotal = uwLeaves.reduce(function(sum,g){return sum+(g.card_count||0);},0);
                html += '<div style="border-left:2px solid var(--border-color);margin-left:8px;margin-bottom:6px;padding:6px 0 6px 12px;border-radius:0 8px 8px 0;">';
                html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;color:var(--text-muted);font-weight:600;">';
                html += '<span style="font-size:15px;">📂</span><span>自定义分组</span>';
                html += '<span style="font-size:11px;margin-left:auto;">' + uwTotal + ' 条</span></div>';
                html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
                for (var g2 = 0; g2 < uwLeaves.length; g2++) {
                    var grp = uwLeaves[g2];
                    html += '<button onclick="event.stopPropagation();App.switchGroup(' + grp.id + ',\'' + (grp.name||'').replace(/'/g,"\\'") + '\')" ';
                    html += 'class="showcase-leaf-btn" style="font-size:13px;padding:6px 14px;line-height:1.5;"';
                    html += ' onmouseenter="this.style.borderColor=\'#3b82f6\';this.style.background=\'rgba(59,130,246,0.12)\';this.style.boxShadow=\'0 0 0 2px rgba(59,130,246,0.15)\'" onmouseleave="this.style.borderColor=\'\';this.style.background=\'\';this.style.boxShadow=\'\'"';
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
// 5.1 子分组浏览器（词库树侧边栏 → 右侧子分组陈列页，点击加载对应子分组词卡）
// ============================================================
App._showSubGroupBrowser = function(rootId, rootKey) {
    var tree = this.state.groupTree;
    var root = null;
    var findRoot = function(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === rootId) { root = nodes[i]; return; }
            if (nodes[i].children) findRoot(nodes[i].children);
        }
    };
    findRoot(tree);
    if (!root || !root.children) return;
    
    // 子分组浏览器绕过 switchView → loadPrompts 链，直接操作 DOM
    // 避免 async _wcLoadPrompts 在浏览器 HTML 写入后再覆盖 promptList
    this.state.currentGroupId = null;
    this.state.currentGroupName = '';
    var btnCol = document.getElementById('btnCollapseAllGroups');
    if (btnCol) btnCol.style.display = 'none';
    var vh = document.getElementById('viewHome');
    if (vh) vh.classList.add('active-view');
    
    // 记住父组ID，后续从子分组返回时可回到此处
    this.state._browserParentId = rootId;
    
    var container = document.getElementById('promptList');
    if (!container) return;
    
    // 隐藏批量栏
    this._hideBatchBar();
    App._aiToolbarSuppressed = true;
    if (App.aiTools) App.aiTools.hideToolbar();
    this._showBreadcrumb(false);
    this._hideEditFilterBar();
    
    // 不展开侧边栏 —— 父组名称区域仅打开右侧子分组浏览器，三角箭头控制侧边栏折叠
    
    // 递归统计总卡片数
    var totalCards = 0;
    var sumCards = function(ns) {
        for (var i = 0; i < ns.length; i++) {
            totalCards += (ns[i].card_count || 0);
            if (ns[i].children) sumCards(ns[i].children);
        }
    };
    sumCards(root.children);
    
    var subs = root.children.filter(function(c) {
        // 只取叶子节点（无孙节点）作为子分组卡片展示
        // 不限制 group_type → 覆盖 sub/atom/builtin/custom/seedance 等所有类型
        return !c.children || c.children.length === 0;
    });
    // 若一级子节点全是中间容器，则取下一层叶子
    if (subs.length === 0 && root.children.some(function(c){ return c.children && c.children.length > 0; })) {
        for (var ri = 0; ri < root.children.length; ri++) {
            var mid = root.children[ri];
            if (mid.children) {
                for (var mi = 0; mi < mid.children.length; mi++) {
                    var leaf = mid.children[mi];
                    if (!leaf.children || leaf.children.length === 0) {
                        subs.push(leaf);
                    }
                }
            }
        }
    }
    
    // 分组名称清洗
    var cleanName = (root.name || root.group_key || '').replace(/^[🎭🏞🖼🎬\s]+/, '').trim();
    
    var html = '<div style="padding:0;">';
    html += '<div class="subgroup-browser-header" style="padding:16px 20px 12px;border-bottom:1px solid var(--border-color);">';
    html += '<h3 style="margin:0 0 4px;font-size:18px;display:flex;align-items:center;gap:8px;color:var(--text-main);">';
    html += '<span style="font-size:24px;">' + (root.icon || '📁') + '</span>';
    html += App._escape(cleanName);
    html += '</h3>';
    html += '<p style="margin:0;font-size:12px;color:var(--text-muted);">' + subs.length + ' 个子分组 · 共 ' + totalCards + ' 条词卡</p>';
    html += '</div>';
    
    // 「全部词卡」大按钮
    html += '<div style="padding:12px 20px;">';
    html += '<button onclick="App.switchGroup(' + root.id + ',\'' + (root.name||'').replace(/'/g,"\\'") + '\')" class="subgroup-browser-all" style="width:100%;padding:12px 16px;border:2px solid var(--primary,#3b82f6);border-radius:10px;background:var(--primary-light,rgba(59,130,246,.08));color:var(--primary,#3b82f6);font-size:15px;font-weight:600;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:8px;">';
    html += '<span style="font-size:20px;">📋</span> 全部词卡 <span style="font-size:13px;opacity:.8;">(' + totalCards + ' 条)</span>';
    html += '</button>';
    html += '</div>';
    
    // 子分组卡片网格
    html += '<div style="padding:0 20px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">';
    for (var s = 0; s < subs.length; s++) {
        var sub = subs[s];
        var sIcon = sub.icon || '📄';
        var sName = (sub.name || '').replace(/^[🎭🏞🖼🎬\s]+/, '').trim();
        if (sIcon && sName.indexOf(sIcon) === 0) sName = sName.substring(sIcon.length).trim();
        html += '<button onclick="event.stopPropagation();App.switchGroup(' + sub.id + ',\'' + (sub.name||'').replace(/'/g,"\\'") + '\')" class="subgroup-browser-card" style="padding:14px 16px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-card);cursor:pointer;text-align:left;transition:all .15s;">';
        html += '<div style="display:flex;align-items:center;gap:10px;">';
        html += '<span style="font-size:20px;flex-shrink:0;">' + sIcon + '</span>';
        html += '<span style="font-weight:600;font-size:14px;flex:1;color:var(--text-main);">' + App._escape(sName) + '</span>';
        html += '<span style="font-size:11px;font-weight:600;color:var(--primary,#3b82f6);background:var(--primary-light,rgba(59,130,246,.1));padding:3px 10px;border-radius:10px;flex-shrink:0;">' + (sub.card_count || 0) + ' 条</span>';
        html += '</div>';
        html += '</button>';
    }
    html += '</div>';
    html += '</div>';
    
    container.innerHTML = html;
    
    // 更新面包屑 — 统一标题为"词卡分组"（而非根节点原始名称如"角色设定"）
    var pt = document.getElementById('pageTitle');
    if (pt) pt.textContent = '词卡分组';
};

// 展开侧边栏中的指定节点（子分组浏览器内部用）
App._expandSidebarNode = function(nodeId) {
    var tree = this.state.groupTree;
    var setExpanded = function(nodes, targetId) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === targetId) {
                nodes[i]._expanded = true;
                return true;
            }
            if (nodes[i].children && setExpanded(nodes[i].children, targetId)) {
                nodes[i]._expanded = true;
                return true;
            }
        }
        return false;
    };
    if (setExpanded(tree, nodeId)) {
        this.renderSidebar();
    }
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
// 2026-08-06 修复：树形侧边栏实现保存为直接引用，供 app_editor 旧版 renderSidebar 检测转调
// 竞态背景：wc_bridge(同步) 200ms 重试 vs app_editor(defer) 执行顺序不定，
// 若 app_editor 后执行会覆盖树形 renderSidebar → modules 空 → return → 侧边栏空白
// 保存直接函数引用（而非经 App.renderSidebar 间接调用），避免二次覆盖污染
var _wcRenderSidebarImpl = function() {
    try {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) { console.warn('[wc-bridge] sidebar DOM 元素不存在'); return; }

    // 强制显示侧边栏（防止被之前隐藏）
    sidebar.style.display = '';
    var btn = document.getElementById('sidebarToggleBtn');
    if (btn) btn.style.display = '';
    
    // 确保 _escape 可用（防御 app_editor.js 未加载场景）
    if (!App._escape) {
        // T5: 优先用 PK 底座
        App._escape = (window.PK && PK._esc) ? PK._esc : function(s) {
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
    
    var html = '<div style="padding:10px 14px 6px;display:flex;justify-content:space-between;align-items:center;color:var(--text-muted);font-size:12px;letter-spacing:1px;font-weight:600;"><span>查找词组</span><button onclick="event.stopPropagation();App._toggleAllTreeNodes()" title="一键全部折叠/展开" style="font-size:10px;padding:2px 8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-muted);cursor:pointer;line-height:1.4;">📂 全部折叠</button></div>';
    
    // 统一入口：全部词组
    var allActive = this.state.currentGroupId === null ? 'active' : '';
    html += '<div class="module-item ' + allActive + '" onclick="App.switchAllGroups()" style="margin:0 8px 4px;font-size:14px;">' +
        '<span class="icon">🏠</span><span>提示词库</span>' +
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
    
    // Phase18: 插件侧边栏注入点（在所有分组之后）
    html += '<div id="pluginSidebarItems" style="border-top:1px solid var(--border-color);margin-top:8px;padding-top:4px;"></div>';
    
    sidebar.innerHTML = html;
    App._injectSidebarToggle(sidebar);
    } catch(e) {
        console.error('[wc-bridge] renderSidebar 崩溃:', e.message, e.stack);
        var sidebar2 = document.getElementById('sidebar');
        if (sidebar2) sidebar2.innerHTML = '<div style="padding:20px;color:#ef4444;font-size:13px;">侧边栏渲染未完成: ' + e.message + '</div>';
    }
};
// 树形实现直接引用（供 app_editor 旧版检测转调，避免二次覆盖污染）
App._renderSidebarTree = _wcRenderSidebarImpl;
App.renderSidebar = _wcRenderSidebarImpl;

// Phase44: 一键全部折叠/展开侧边栏树节点
App._toggleAllTreeNodes = function() {
    var tree = this.state.groupTree;
    if (!tree || tree.length === 0) return;
    // 判断当前是否全部折叠：检查第一个有子节点的 root 是否展开
    var allCollapsed = true;
    for (var ti = 0; ti < tree.length; ti++) {
        if (tree[ti].children && tree[ti].children.length > 0 && tree[ti]._expanded !== false) {
            allCollapsed = false;
            break;
        }
    }
    // 切换状态：如果全部折叠则全部展开，否则全部折叠
    var newState = allCollapsed;
    function setAll(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].children && nodes[i].children.length > 0) {
                nodes[i]._expanded = newState;
                setAll(nodes[i].children);
            }
        }
    }
    setAll(tree);
    // 重新渲染侧边栏
    this.renderSidebar();
};

// Phase44: 一键全部折叠/展开陈列架中所有根节点分组
App._toggleAllShowcaseGroups = function() {
    var tree = this.state.groupTree;
    if (!tree || tree.length === 0) return;
    // 判断当前是否全部折叠
    var allCollapsed = true;
    for (var i = 0; i < tree.length; i++) {
        var el = document.getElementById('showcase_root_' + i);
        if (el && el.style.display !== 'none') { allCollapsed = false; break; }
    }
    var newDisplay = allCollapsed ? 'block' : 'none';
    var newArrow = allCollapsed ? '▼' : '▶';
    for (var j = 0; j < tree.length; j++) {
        var el2 = document.getElementById('showcase_root_' + j);
        if (el2) { el2.style.display = newDisplay; }
    }
    // 更新所有箭头
    var container = document.getElementById('promptList');
    if (container) {
        var arrows = container.querySelectorAll('.toggle-arrow');
        for (var k = 0; k < arrows.length; k++) {
            arrows[k].textContent = newArrow;
        }
    }
    App._updateCollapseBtnLabel();
};

// 更新折叠按钮文案
App._updateCollapseBtnLabel = function() {
    var btn = document.getElementById('btnCollapseAllGroups');
    if (!btn) return;
    var allCollapsed = true;
    var tree = this.state.groupTree;
    for (var i = 0; i < tree.length; i++) {
        var el = document.getElementById('showcase_root_' + i);
        if (el && el.style.display !== 'none') { allCollapsed = false; break; }
    }
    btn.textContent = allCollapsed ? '📂 全部展开' : '📂 全部折叠';
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
    var hasChildren = node.children && node.children.length > 0;
    // sub 无子节点 → 自身即为叶子，直接用 card_count，不递归（递归会因无 children 永远为 0）
    if (node.group_type === 'sub' && !hasChildren) {
        countStr = '<span class="count-badge" style="font-size:11px;">' + (node.card_count || 0) + '</span>';
    } else if (node.group_type === 'root' || hasChildren) {
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
    
    // ── ROOT: 箭头→折叠/展开, 名称区域→子分组浏览器 ──
    var isRoot = node.group_type === 'root' || (node.children && node.children.length > 0 && node.group_type !== 'sub');
    if (isRoot) {
        var isExpanded = node._expanded === true;
        var arrow = isExpanded ? '\u25BC' : '\u25B6';
        // 箭头只负责折叠/展开，stopPropagation 防止冒泡到名称点击
        var expandIcon = '<span class="tree-arrow" onclick="event.stopPropagation();App._toggleTreeNode(\x27' + nodeId + '\x27,' + node.id + ')" style="cursor:pointer;width:20px;display:inline-block;font-size:12px;text-align:center;">' + arrow + '</span>';
        
        var rootAddBtn = '';
        if (this.state.editMode) {
            rootAddBtn = '<button class="tree-add-btn" onclick="event.stopPropagation();App._treeQuickAdd(' + node.id + ')\" title=\"在此根下新建子分类\">+</button>';
        }
        
        // 名称/图标区域点击 → 子分组浏览器（所有有子节点的父组统一行为）
        var nameOnClick = 'onclick="event.stopPropagation();App._showSubGroupBrowser(' + node.id + ',\x27' + (node.group_key||'').replace(/'/g,"\\'") + '\x27)"';
        
        var html = '<div id="' + nodeId + '" class="tree-node tree-root">' +
            expandIcon +
            '<span ' + nameOnClick + ' style="font-size:17px;width:22px;text-align:center;cursor:pointer;" title="查看子分组">' + icon + '</span>' +
            '<span ' + nameOnClick + ' style="font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;cursor:pointer;" title="查看子分组">' + App._escape(displayName) + '</span>' +
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
    
    // ── SUB-LEAF: 无子节点的sub节点，点击即加载该分组词卡 ──
    if (node.group_type === 'sub' && (!node.children || node.children.length === 0)) {
        var dragHandleSL = '';
        var ctxMenuSL = '';
        if (this.state.editMode) {
            dragHandleSL = '<span draggable="true" ondragstart="App._sbDragStart(event,' + node.id + ')" ondragend="App._sbDragEnd(event)" title="拖拽排序" style="cursor:grab;color:var(--text-muted);font-size:11px;margin-right:3px;opacity:0.5;user-select:none;flex-shrink:0;">⋮⋮</span>';
            var hasKidsSL = (node.children && node.children.length > 0) ? ',true' : '';
            ctxMenuSL = ' oncontextmenu="App._sbContextMenu(event,' + node.id + ',\'' + node.group_type + '\',\'' + App._escape(displayName).replace(/'/g,"\\'") + '\'' + hasKidsSL + ')"';
        }
        return '<div class="module-item sb-drag-target ' + (isActive ? 'active' : '') + '" data-gid="' + node.id + '" data-gname="' + (node.name||'').replace(/"/g,'&quot;') + '" data-gm-id="' + node.id + '" onclick="App._treeLeafClick(this)" ' +
            'ondragover="App._sbDragOver(event,' + node.id + ')" ondragleave="App._sbDragLeave(event)" ondrop="App._sbDragDrop(event,' + node.id + ')"' + ctxMenuSL +
            'style="margin:0 8px 2px;padding-left:' + padLeft + 'px;">' +
            dragHandleSL +
            '<span class="icon">' + icon + '</span>' +
            '<span>' + App._escape(displayName) + '</span>' +
            countStr +
            '</div>';
    }
    
    // ── SUB: 有子节点 → 包含容器，永远展开、无折叠箭头 ──
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
    // 侧栏拖拽手柄（编辑模式下，非 root/builtin 类型）
    var sbDragHandle = '';
    var sbCtxMenu = '';
    var sortable = (node.group_type === 'custom' || node.group_type === 'seedance' || node.group_type === 'atom');
    if (this.state.editMode && sortable) {
        sbDragHandle = '<span draggable="true" ondragstart="App._sbDragStart(event,' + node.id + ')" ondragend="App._sbDragEnd(event)" title="拖拽排序" style="cursor:grab;color:var(--text-muted);font-size:11px;margin-right:3px;opacity:0.5;user-select:none;flex-shrink:0;">⋮⋮</span>';
        var hasKidsCtx = (node.children && node.children.length > 0) ? ',true' : '';
        sbCtxMenu = ' oncontextmenu="App._sbContextMenu(event,' + node.id + ',\'' + node.group_type + '\',\'' + App._escape(displayName).replace(/'/g,"\\'") + '\'' + hasKidsCtx + ')"';
    }
    
    return '<div class="module-item sb-drag-target ' + (isActive ? 'active' : '') + '" data-gid="' + node.id + '" data-gname="' + (node.name||'').replace(/"/g,'&quot;') + '" data-gm-id="' + node.id + '" onclick="App._treeLeafClick(this)" ' +
        'ondragover="App._sbDragOver(event,' + node.id + ')" ondragleave="App._sbDragLeave(event)" ondrop="App._sbDragDrop(event,' + node.id + ')"' + sbCtxMenu +
        'style="margin:0 8px 2px;padding-left:' + padLeft + 'px;" data-group-id="' + node.id + '">' +
        sbDragHandle +
        '<span class="icon">' + icon + '</span>' +
        '<span>' + App._escape(displayName) + '</span>' +
        countStr +
        editBtn + delBtn +
        '</div>';
};

// Phase17.3: batchBar 新建词条 → 调用词卡编辑器（带入当前分组）
App._batchNewWordCard = function() {
    var gid = this.state.currentGroupId || null;
    var gname = this.state.currentGroupName || '';
    if (App.wordEditor && App.wordEditor.openCreate) {
        App.wordEditor.openCreate(gid, 'cards');
    } else {
        this.showToast('编辑器未就绪', 'error');
    }
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
            r.json().then(function(e) { self.showToast('添加未完成: ' + (e.detail || 'HTTP ' + r.status), 'error'); })
                .catch(function() { self.showToast('添加未完成', 'error'); });
        }
    }).catch(function(e) { self.showToast('遇到问题：' + e.message, 'error'); });
};

// 叶子节点点击代理（data属性避免引号注入）
// v14.50: 防御性修复 — 向上查找 data-gid + try-catch 边界保护
App._treeLeafClick = function(el) {
    try {
        // 向上遍历 DOM 直到找到 data-gid（防止点击到子元素 span/icon/count 等）
        var gid = null, gname = '', node = el;
        while (node && node !== document.body) {
            gid = parseInt(node.getAttribute('data-gid'));
            gname = node.getAttribute('data-gname') || '';
            if (gid) break;
            node = node.parentElement;
        }
        if (!gid) { console.warn('[wc-bridge] _treeLeafClick: 未找到 data-gid, el=', el); return; }
        App.switchGroup(gid, gname);
    } catch(e) {
        console.error('[wc-bridge] _treeLeafClick error:', e.message, e.stack);
    }
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
})();
