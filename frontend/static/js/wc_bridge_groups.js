(function boot() {
'use strict';
try { if (!App || (!App.fetchJSON && !window.PK)) { setTimeout(boot, 200); return; } }
catch(e) { setTimeout(boot, 200); return; }

App.showGroupManageModal = function() {
    var modal = document.getElementById('modalGroupManager');
    if (!modal) { this.showToast('管理面板未加载', 'error'); return; }
    this._gmSelected.clear();
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
        if (!d || !d.groups) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">加载未完成</div>'; return; }
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
            // 排序控件：仅编辑模式下对非锁定分组显示
            var sortBtns = '';
            var dragAttrs = '';
            if (self.state.editMode && !locked) {
                // 拖拽手柄 + ▲▼ 排序按钮
                sortBtns = '<span draggable="true" ondragstart="App._gmDragStart(event,' + g.id + ')" ondragend="App._gmDragEnd(event)" ' +
                    'title="拖拽排序" style="display:flex;align-items:center;justify-content:center;width:22px;height:36px;margin-right:2px;cursor:grab;color:var(--text-muted);font-size:14px;letter-spacing:-2px;user-select:none;border-radius:4px;transition:background 0.15s;" ' +
                    'onmouseenter="this.style.background=' + "'" + 'var(\'--hover-bg\')' + "'" + ';this.style.color=' + "'" + 'var(\'--primary\')' + "'" + '" ' +
                    'onmouseleave="this.style.background=' + "'" + 'transparent' + "'" + ';this.style.color=' + "'" + 'var(\'--text-muted\')' + "'" + '">' +
                    '⋮⋮</span>';
                sortBtns += '<span style="display:flex;flex-direction:column;gap:1px;font-size:0;">' +
                    '<button onclick="App.gmMoveUp(' + g.id + ')" title="上移" style="font-size:10px;padding:0 3px;line-height:1.2;border:1px solid var(--border-color);border-radius:3px 3px 0 0;background:var(--bg-primary);color:var(--text-muted);cursor:pointer;">▲</button>' +
                    '<button onclick="App.gmMoveDown(' + g.id + ')" title="下移" style="font-size:10px;padding:0 3px;line-height:1.2;border:1px solid var(--border-color);border-top:none;border-radius:0 0 3px 3px;background:var(--bg-primary);color:var(--text-muted);cursor:pointer;">▼</button>' +
                '</span>';
                dragAttrs = ' ondragover="App._gmDragOver(event,' + g.id + ')" ondragleave="App._gmDragLeave(event)" ondrop="App._gmDragDrop(event,' + g.id + ')"';
            }
            // 批量选择复选框（编辑模式下非锁定分组）
            var batchCb = '';
            if (self.state.editMode && !locked) {
                batchCb = '<input type="checkbox" onchange="App._gmToggleSelect(' + g.id + ',this.checked)" title="选择此项" style="margin-right:6px;cursor:pointer;flex-shrink:0;" data-gm-cb="' + g.id + '">';
            } else if (self.state.editMode) {
                batchCb = '<span style="width:22px;display:inline-block;flex-shrink:0;"></span>';
            }
            var iconClick = (!locked && self.state.editMode) ? ' onclick="App.gmPickIcon(event,' + g.id + ')" style="cursor:pointer;" title="点击更换图标"' : '';
            html += '<div style="display:flex;align-items:center;padding:6px 12px;border-bottom:1px solid var(--border-color);' + (i%2===0?'background:var(--bg-card);':'') + '" data-gm-row="' + g.id + '" class="gm-sortable-row"' + dragAttrs + '>' +
                sortBtns +
                batchCb +
                '<span' + iconClick + ' style="width:30px;font-size:16px;' + ((!locked && self.state.editMode) ? 'border-radius:4px;transition:background 0.15s;' : '') + '" onmouseenter="if(this.getAttribute(\'onclick\'))this.style.background=' + "'" + 'var(\'--hover-bg\')' + "'" + '" onmouseleave="if(this.getAttribute(\'onclick\'))this.style.background=\'transparent\'">' + (iconStr || '📄') + '</span>' +
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
        list.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">加载遇到问题: ' + e.message + '</div>';
    });
};

// 排序 — 将 groupId 与同级前后项交换，批量更新 sort_order
App.gmMoveUp = function(groupId) { App._gmMove(groupId, 'up'); };
App.gmMoveDown = function(groupId) { App._gmMove(groupId, 'down'); };
App._gmMove = function(groupId, direction) {
    var self = this;
    this.fetchJSON('/api/v4/word-cards/groups?include_empty=true').then(function(d) {
        if (!d || !d.groups) { self.showToast('加载分组数据未完成', 'error'); return; }
        var groups = d.groups;
        // 找到目标分组
        var targetIdx = -1;
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].id === groupId) { targetIdx = i; break; }
        }
        if (targetIdx === -1) { self.showToast('分组未找到', 'error'); return; }
        var target = groups[targetIdx];
        var targetPid = target.parent_group_id;
        // 找同级（同一 parent_group_id）的相邻分组
        var swapIdx = -1;
        if (direction === 'up') {
            for (var i = targetIdx - 1; i >= 0; i--) {
                if (groups[i].parent_group_id === targetPid) { swapIdx = i; break; }
            }
        } else {
            for (var i = targetIdx + 1; i < groups.length; i++) {
                if (groups[i].parent_group_id === targetPid) { swapIdx = i; break; }
            }
        }
        if (swapIdx === -1) {
            self.showToast(direction === 'up' ? '已是同级最前' : '已是同级最后', 'info');
            return;
        }
        // 构造同级所有分组的有序ID列表（保持原顺序，交换 target 与 swap）
        var siblings = [];
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].parent_group_id === targetPid && groups[i].group_type !== 'root' && groups[i].group_type !== 'builtin') {
                siblings.push(groups[i].id);
            }
        }
        // 在 siblings 中交换 targetId 与 swapId
        var swapId = groups[swapIdx].id;
        var posTarget = siblings.indexOf(groupId);
        var posSwap = siblings.indexOf(swapId);
        if (posTarget >= 0 && posSwap >= 0) {
            var tmp = siblings[posTarget];
            siblings[posTarget] = siblings[posSwap];
            siblings[posSwap] = tmp;
        }
        // 调后端 API 批量重排
        fetch('/api/v4/word-cards/groups/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ordered_ids: siblings })
        }).then(function(r) {
            if (r.ok) {
                // 刷新侧栏 → 联动侧边栏排序
                self.loadGroupTree().then(function() {
                    // 刷新管理弹窗列表
                    self.gmRefresh();
                    self._gmFlashRow(groupId);
                    // 如果当前在全部词组页面，刷新陈列架
                    if (self.state.currentGroupId === null) self._showShowcase();
                });
            } else {
                r.json().then(function(e) { self.showToast('排序未完成: ' + (e.detail || 'HTTP ' + r.status), 'error'); })
                    .catch(function() { self.showToast('排序未完成', 'error'); });
            }
        }).catch(function(e) { self.showToast('排序遇到问题: ' + e.message, 'error'); });
    }).catch(function(e) { self.showToast('加载数据遇到问题: ' + e.message, 'error'); });
};

// ── 拖拽排序 (HTML5 DnD) ──
App._gmDragStart = function(e, groupId) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(groupId));
    // 拖拽源视觉反馈
    var row = e.target.closest('[data-gm-row]');
    if (row) { row.style.opacity = '0.4'; row.classList.add('gm-dragging'); }
    // 设置拖拽图像为半透明手柄
    try { var ghost = e.target.cloneNode(true); ghost.style.opacity = '0.6'; ghost.style.position = 'absolute'; ghost.style.top = '-9999px'; document.body.appendChild(ghost); e.dataTransfer.setDragImage(ghost, 10, 10); setTimeout(function() { document.body.removeChild(ghost); }, 0); } catch(ignore) {}
};

App._gmDragOver = function(e, targetId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var row = e.currentTarget;
    if (!row || row.classList.contains('gm-dragging')) return;
    // 高亮目标行
    var allRows = row.parentNode.querySelectorAll('[data-gm-row]');
    for (var i = 0; i < allRows.length; i++) { allRows[i].classList.remove('gm-drag-over'); }
    row.classList.add('gm-drag-over');
};

App._gmDragLeave = function(e) {
    var row = e.currentTarget;
    if (row) row.classList.remove('gm-drag-over');
};

App._gmDragDrop = function(e, targetId) {
    e.preventDefault();
    var row = e.currentTarget;
    if (row) row.classList.remove('gm-drag-over');
    var sourceId = parseInt(e.dataTransfer.getData('text/plain'));
    if (!sourceId || sourceId === targetId) return;
    // 查找所有同级分组，交换 sourceId 和 targetId 位置
    var self = this;
    this.fetchJSON('/api/v4/word-cards/groups?include_empty=true').then(function(d) {
        if (!d || !d.groups) return;
        var groups = d.groups;
        var source = null, target = null;
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].id === sourceId) source = groups[i];
            if (groups[i].id === targetId) target = groups[i];
        }
        if (!source || !target || source.parent_group_id !== target.parent_group_id) {
            self.showToast('只能对同级分组拖拽排序', 'warning');
            self.gmRefresh();
            return;
        }
        if (source.group_type === 'root' || source.group_type === 'builtin' ||
            target.group_type === 'root' || target.group_type === 'builtin') {
            self.showToast('内置分组不可排序', 'warning');
            self.gmRefresh();
            return;
        }
        // 构造同级有序ID（source 移到 target 位置）
        var siblings = [];
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].parent_group_id === source.parent_group_id &&
                groups[i].group_type !== 'root' && groups[i].group_type !== 'builtin') {
                siblings.push(groups[i].id);
            }
        }
        var srcIdx = siblings.indexOf(sourceId);
        var tgtIdx = siblings.indexOf(targetId);
        if (srcIdx >= 0 && tgtIdx >= 0 && srcIdx !== tgtIdx) {
            siblings.splice(srcIdx, 1);
            var newTgt = siblings.indexOf(targetId);
            siblings.splice(newTgt, 0, sourceId);
        }
        fetch('/api/v4/word-cards/groups/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ordered_ids: siblings })
        }).then(function(r) {
            if (r.ok) {
                self.loadGroupTree().then(function() {
                    self.gmRefresh();
                    self._gmFlashRow(sourceId);
                    if (self.state.currentGroupId === null) self._showShowcase();
                });
            } else {
                r.json().then(function(e) { self.showToast('拖拽排序未完成: ' + (e.detail || 'HTTP ' + r.status), 'error'); })
                    .catch(function() { self.showToast('拖拽排序未完成', 'error'); });
                self.gmRefresh();
            }
        }).catch(function() { self.gmRefresh(); });
    }).catch(function() { self.gmRefresh(); });
};

App._gmDragEnd = function(e) {
    // 清理所有拖拽视觉状态
    var rows = document.querySelectorAll('.gm-sortable-row');
    for (var i = 0; i < rows.length; i++) {
        rows[i].style.opacity = '';
        rows[i].classList.remove('gm-dragging', 'gm-drag-over');
    }
};

// ── 侧栏节点拖拽排序 ──
App._sbDragStart = function(e, groupId) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-sb-group-id', String(groupId));
    // 拖拽源高亮
    var item = e.target.closest('.module-item');
    if (item) { item.style.opacity = '0.4'; item.classList.add('sb-dragging'); }
};

App._sbDragOver = function(e, targetId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var item = e.currentTarget;
    if (!item || item.classList.contains('sb-dragging')) return;
    // 清除所有高亮，设置当前
    var all = item.parentNode.querySelectorAll('.sb-drag-target');
    for (var i = 0; i < all.length; i++) { all[i].classList.remove('sb-drag-over'); }
    item.classList.add('sb-drag-over');
};

App._sbDragLeave = function(e) {
    var item = e.currentTarget;
    if (item) item.classList.remove('sb-drag-over');
};

App._sbDragDrop = function(e, targetId) {
    e.preventDefault();
    var item = e.currentTarget;
    if (item) item.classList.remove('sb-drag-over');
    var sourceId = parseInt(e.dataTransfer.getData('application/x-sb-group-id'));
    if (!sourceId || sourceId === targetId) return;
    var self = this;
    this.fetchJSON('/api/v4/word-cards/groups?include_empty=true').then(function(d) {
        if (!d || !d.groups) { self._sbDragEnd(); return; }
        var groups = d.groups;
        var source = null, target = null;
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].id === sourceId) source = groups[i];
            if (groups[i].id === targetId) target = groups[i];
        }
        if (!source || !target || source.parent_group_id !== target.parent_group_id) {
            self._sbDragEnd();
            return;
        }
        if (source.group_type === 'root' || source.group_type === 'builtin' ||
            target.group_type === 'root' || target.group_type === 'builtin') {
            self._sbDragEnd();
            return;
        }
        // 构造同级有序ID，source 移到 target 位置
        var siblings = [];
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].parent_group_id === source.parent_group_id &&
                groups[i].group_type !== 'root' && groups[i].group_type !== 'builtin') {
                siblings.push(groups[i].id);
            }
        }
        var srcIdx = siblings.indexOf(sourceId);
        var tgtIdx = siblings.indexOf(targetId);
        if (srcIdx >= 0 && tgtIdx >= 0 && srcIdx !== tgtIdx) {
            siblings.splice(srcIdx, 1);
            var newTgt = siblings.indexOf(targetId);
            siblings.splice(newTgt, 0, sourceId);
        }
        fetch('/api/v4/word-cards/groups/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ordered_ids: siblings })
        }).then(function(r) {
            if (r.ok) {
                // 侧栏刷新（loadGroupTree 内部调 renderSidebar）
                self.loadGroupTree().then(function() {
                    self._gmFlashRow(sourceId);
                    if (self.state.currentGroupId === null) self._showShowcase();
                });
            }
            self._sbDragEnd();
        }).catch(function() { self._sbDragEnd(); });
    }).catch(function() { self._sbDragEnd(); });
};

App._sbDragEnd = function(e) {
    var items = document.querySelectorAll('.sb-drag-target');
    for (var i = 0; i < items.length; i++) {
        items[i].style.opacity = '';
        items[i].classList.remove('sb-dragging', 'sb-drag-over');
    }
};

// ── 侧栏右键菜单 ──
App._sbContextMenu = function(e, groupId, groupType, groupName, hasChildren) {
    e.preventDefault();
    e.stopPropagation();
    // 移除已有
    var old = document.querySelector('.sb-context-menu');
    if (old) old.remove();
    var menu = document.createElement('div');
    menu.className = 'sb-context-menu';
    menu.style.cssText = 'position:fixed;z-index:750;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:4px;box-shadow:0 4px 20px rgba(0,0,0,0.35);min-width:140px;font-size:13px;';
    menu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px';
    var self = this;
    var items = [];
    items.push({ label: '✎ 重命名', action: function() { App.gmEdit(groupId, groupName); } });
    items.push({ label: '🎨 更改图标', action: function() { var mr = menu.getBoundingClientRect(); menu.remove(); App._gmPickIconAt(mr.left, mr.top, groupId); } });
    if (groupType === 'sub') {
        items.push({ label: '➕ 新建子分组', action: function() { App._treeQuickAdd(groupId); } });
    }
    items.push({ label: '✕ 删除', danger: true, disabled: !!hasChildren, action: function() { App.gmDelete(groupId, groupName); } });
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.disabled) continue;
        var row = document.createElement('div');
        row.textContent = it.label;
        row.style.cssText = 'padding:6px 10px;cursor:pointer;border-radius:4px;color:' + (it.danger ? '#ef4444' : 'var(--text-main)') + ';transition:background 0.12s;';
        row.onmouseenter = function() { this.style.background = 'var(--hover-bg)'; };
        row.onmouseleave = function() { this.style.background = ''; };
        (function(act) {
            row.onclick = function() { menu.remove(); act(); };
        })(it.action);
        menu.appendChild(row);
    }
    if (hasChildren) {
        var hint = document.createElement('div');
        hint.textContent = '含子分组，不可删除';
        hint.style.cssText = 'padding:4px 10px;font-size:10px;color:var(--text-muted);opacity:0.6;';
        menu.appendChild(hint);
    }
    document.body.appendChild(menu);
    setTimeout(function() {
        document.addEventListener('click', function _closeCtx() {
            if (menu.parentNode) menu.remove();
            document.removeEventListener('click', _closeCtx);
        });
    }, 50);
};

// ── 排序闪烁动画辅助 ──
App._gmFlashRow = function(groupId) {
    setTimeout(function() {
        var row = document.querySelector('[data-gm-row="' + groupId + '"]');
        if (row) { row.classList.add('gm-flash'); setTimeout(function() { row.classList.remove('gm-flash'); }, 700); }
        var sbItem = document.querySelector('.module-item[data-gm-id="' + groupId + '"]');
        if (sbItem) { sbItem.classList.add('sb-flash'); setTimeout(function() { sbItem.classList.remove('sb-flash'); }, 700); }
    }, 100);
};

// ── 批量选择 ──
App._gmSelected = new Set();

App._gmToggleSelect = function(groupId, checked) {
    if (checked) { App._gmSelected.add(groupId); }
    else { App._gmSelected.delete(groupId); }
    App._gmUpdateBatchBar();
};

App._gmSelectAll = function() {
    var cbs = document.querySelectorAll('[data-gm-cb]');
    var allChecked = true;
    for (var i = 0; i < cbs.length; i++) { if (!cbs[i].checked) { allChecked = false; break; } }
    App._gmSelected.clear();
    for (var i = 0; i < cbs.length; i++) {
        cbs[i].checked = !allChecked;
        if (!allChecked) App._gmSelected.add(parseInt(cbs[i].getAttribute('data-gm-cb')));
    }
    App._gmUpdateBatchBar();
};

App._gmUpdateBatchBar = function() {
    var bar = document.getElementById('gmBatchBar');
    if (!bar) return;
    var count = App._gmSelected.size;
    if (count > 0) {
        bar.style.display = 'flex';
        bar.querySelector('.gm-batch-count').textContent = '已选 ' + count + ' 项';
    } else {
        bar.style.display = 'none';
    }
};

App.gmBatchDelete = function() {
    if (App._gmSelected.size === 0) return;
    if (!confirm('确认删除 ' + App._gmSelected.size + ' 个分组？词卡将移至未分类。')) return;
    var ids = Array.from(App._gmSelected);
    var self = this;
    var done = 0;
    var failed = 0;
    function next() {
        if (ids.length === 0) {
            App._gmSelected.clear();
            self.showToast('已删除 ' + done + ' 个分组' + (failed > 0 ? '，' + failed + ' 个失败' : ''), failed > 0 ? 'warning' : 'success');
            self.loadGroupTree().then(function() {
                self.gmRefresh();
                if (self.state.currentGroupId === null) self._showShowcase();
                var bar = document.getElementById('gmBatchBar');
                if (bar) bar.style.display = 'none';
            });
            return;
        }
        var id = ids.shift();
        fetch('/api/v4/word-cards/groups/' + id, { method: 'DELETE' }).then(function(r) {
            if (r.ok) done++; else failed++;
            next();
        }).catch(function() { failed++; next(); });
    }
    next();
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
                    // Phase17.4: 如果当前在全部词组页面，刷新陈列架显示
                    if (self.state.currentGroupId === null) self._showShowcase();
                });
            });
        } else {
            r.json().then(function(e) { self.showToast('创建未完成: ' + (e.detail || 'HTTP ' + r.status), 'error'); })
                .catch(function() { self.showToast('创建未完成: HTTP ' + r.status, 'error'); });
        }
    }).catch(function(e) { self.showToast('创建遇到问题: ' + e.message, 'error'); });
};

// Phase15: 行内重命名（有 btnEl 时变输入框，否则回退 prompt）
App.gmEdit = function(groupId, oldName, btnEl) {
    if (!btnEl) { var n=prompt('修改名称：',oldName||''); if(!n||!n.trim())return; var s=this; fetch('/api/v4/word-cards/groups/'+groupId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n.trim()})}).then(function(r){if(r.ok){s.showToast('已更新','success');s.loadGroupTree().then(function(){s.gmRefresh();if(s.state.currentGroupId===null)s._showShowcase()})}else{s.showToast('更新未完成','error')}}); return; }
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
            if (r.ok) { self.showToast('已更新', 'success'); self.loadGroupTree().then(function() { if (self.state.currentGroupId === null) self._showShowcase(); }); }
            else { self.showToast('更新未完成', 'error'); }
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
                r.json().then(function(e) { self.showToast('暂未移除: '+(e.detail||''), 'error'); });
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
    PK.toast('批量迁移功能开发中...', 'info');
};

// 分组图标选择器
App._gmShowIconPicker = function(x, y, groupId) {
    var old = document.querySelector('.gm-icon-popover');
    if (old) old.remove();
    // 分类图标：{ label, emojis[] }
    var categories = [
        { label: '📁 文件', emojis: ['📁','📂','🗂️','📦','🗃️','📝','📋','📌','📑','🔖'] },
        { label: '🏷️ 标记', emojis: ['🏷️','⭐','💎','🔥','✨','🌟','💬','🔔','💯','🎖️'] },
        { label: '🎨 视觉', emojis: ['🎨','🎭','🎪','🎬','🎵','🎤','🎧','📷','🖼️','🎞️','🖌️'] },
        { label: '🛠️ 工具', emojis: ['🛠️','🔧','🔨','⚙️','🔮','🔍','📡','📐','🧲','🎛️','🗝️'] },
        { label: '💡 创意', emojis: ['💡','🧠','🧩','🎯','🚀','🌈','🔬','🧬','🪄','🎲','🎮'] },
        { label: '📊 数据', emojis: ['📊','💾','🗄️','📈','📉','🗓️','🧮','🏗️','⚡','🔄','📟'] }
    ];
    var pop = document.createElement('div');
    pop.className = 'gm-icon-popover';
    pop.style.cssText = 'position:fixed;z-index:700;background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:8px;box-shadow:0 6px 24px rgba(0,0,0,0.35);max-width:340px;max-height:380px;overflow-y:auto;';
    pop.style.left = Math.min(x, window.innerWidth - 350) + 'px';
    pop.style.top = Math.min(y + 4, window.innerHeight - 390) + 'px';
    var self = this;
    // 按钮创建工厂
    function makeBtn(emoji) {
        var btn = document.createElement('span');
        btn.textContent = emoji;
        btn.style.cssText = 'width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;border-radius:5px;transition:background 0.12s,transform 0.1s;flex-shrink:0;';
        btn.onmouseenter = function() { this.style.background = 'var(--hover-bg)'; this.style.transform = 'scale(1.15)'; };
        btn.onmouseleave = function() { this.style.background = ''; this.style.transform = ''; };
        btn.onclick = function(ev) {
            ev.stopPropagation();
            pop.remove();
            fetch('/api/v4/word-cards/groups/' + groupId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ icon: emoji })
            }).then(function(r) {
                if (r.ok) {
                    self.showToast('图标已更新', 'success');
                    self.loadGroupTree().then(function() {
                        self.gmRefresh();
                        if (self.state.currentGroupId === null) self._showShowcase();
                    });
                }
            });
        };
        return btn;
    }
    for (var i = 0; i < categories.length; i++) {
        var cat = categories[i];
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:4px;margin-bottom:4px;';
        var label = document.createElement('span');
        label.textContent = cat.label;
        label.style.cssText = 'font-size:10px;color:var(--text-muted);width:48px;flex-shrink:0;text-align:right;padding-top:6px;line-height:1.2;';
        row.appendChild(label);
        var iconsWrap = document.createElement('span');
        iconsWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;';
        for (var j = 0; j < cat.emojis.length; j++) {
            iconsWrap.appendChild(makeBtn(cat.emojis[j]));
        }
        row.appendChild(iconsWrap);
        pop.appendChild(row);
    }
    document.body.appendChild(pop);
    // 鼠标移开自动关闭
    var leaveTimer = null;
    pop.onmouseenter = function() { if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; } };
    pop.onmouseleave = function() { leaveTimer = setTimeout(function() { pop.remove(); }, 400); };
    // 点击外部关闭
    setTimeout(function() {
        document.addEventListener('click', function _close(e2) {
            if (!pop.contains(e2.target)) { pop.remove(); document.removeEventListener('click', _close); }
        });
    }, 50);
};

App.gmPickIcon = function(e, groupId) {
    e.stopPropagation();
    var rect = e.target.getBoundingClientRect();
    App._gmShowIconPicker(rect.left, rect.bottom, groupId);
};

App._gmPickIconAt = function(x, y, groupId) {
    App._gmShowIconPicker(x, y, groupId);
};

// ============================================================
// 13. _updatePageTitle 增强
// ============================================================
var _origUpdateTitle = App._updatePageTitle;
App._updatePageTitle = function() {
    if (this.state.currentGroupId !== null && this.state.currentView === 'home') {
        document.getElementById('pageTitle').textContent = this.state.currentGroupName || '词卡分组';
    } else if (this.state.currentView === 'home') {
        document.getElementById('pageTitle').textContent = '提示词库';
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
        if (this.state.currentGroupId === null && this.state.currentView === 'home'
            && !this.state.currentCategory && !this.state.searchQuery) {
            this._showShowcase();
            this._hideBatchBar();
            this._hideEditFilterBar();
            return;
        }
        _origRP.call(this);
        if (this.state.editMode) {
            this._wcInjectMoveButtons();
            // 恢复编辑模式全局 UI（batchBar/editFilterBar/AI 工具栏）
            // 防止 _showShowcase 隐藏后未恢复的竞态
            var eb = document.getElementById('batchBar');
            var fb = document.getElementById('editFilterBar');
            if (eb && eb.style.display !== 'flex') eb.style.display = 'flex';
            if (fb) fb.style.display = 'block';
            var btn = document.getElementById('btnEditMode');
            if (btn) { btn.style.color = '#4f46e5'; btn.classList.add('active'); }
        }
        // 编辑/非编辑模式均同步工具栏：编辑模式全量按钮，非编辑模式仅批量类按钮子集
        if (App.aiTools) App.aiTools.showToolbar();
        // P0-6: 拖拽词卡到侧边栏分组
        this._wcSetupCardDrag();
    };
})();

console.log('[wc-bridge] v14.14 collection-badge OK');

// ============ P0-6: 拖拽词卡移动到分组 ============

})();
