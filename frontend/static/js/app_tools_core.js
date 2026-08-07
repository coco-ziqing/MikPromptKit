/**
 * PromptKit — app_tools 模块分片 (core)
 * 自 app_tools.js 拆分（Phase 3.5），方法经 this 互访
 */
(function() {
'use strict';
Object.assign(App, {

    async showRecommend(promptId) {
        this.state.currentPromptId = promptId;
        const panel = document.getElementById('recommendPanel');
        const list = document.getElementById('recommendList');
        list.innerHTML = '<div class="rec-empty">加载推荐中...</div>';
        panel.classList.add('open');
        document.getElementById('mainContent').classList.add('with-rec');

        const data = await this.fetchJSON(`/api/v2/recommend/${promptId}?limit=6`);
        if (!data || !data.items || data.items.length === 0) {
            list.innerHTML = '<div class="rec-empty">暂无推荐词条</div>';
            return;
        }
        let html = '';
        for (const r of data.items) {
            html += `
                <div class="rec-item">
                    <div class="rec-content">${this._escape(r.content)}</div>
                    <div class="rec-meta">${r.module} › ${r.category} · 使用 ${r.usage_count} 次</div>
                    <span class="rec-copy" onclick="App.handleCopy(${r.id}, '${this._escape(r.content).replace(/'/g, "\\'")}')">📋 复制</span>
                </div>
            `;
        }
        list.innerHTML = html;
    },


    closeRecommend() {
        const panel = document.getElementById('recommendPanel');
        panel.classList.remove('open');
        document.getElementById('mainContent').classList.remove('with-rec');
    },

    // 移动端：切换侧边栏菜单（汉堡菜单）

    toggleMobileMenu() {
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        if (!sidebar || !overlay) return;
        var isOpen = sidebar.classList.contains('mobile-show');
        if (isOpen) {
            sidebar.classList.remove('mobile-show');
            overlay.classList.remove('show');
            document.body.style.overflow = '';
        } else {
            sidebar.classList.add('mobile-show');
            overlay.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    },

    // 移动端：关闭侧边栏菜单（供模块切换时自动调用）

    _closeMobileMenu() {
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        if (!sidebar || !overlay) return;
        sidebar.classList.remove('mobile-show');
        overlay.classList.remove('show');
        document.body.style.overflow = '';
    },


    toggleEditMode() {
        // 编辑模式适用于 home 和 collections 视图
        if (this.state.currentView !== 'home' && this.state.currentView !== 'collections') {
            this.switchView('home');
        }
        this.state.editMode = !this.state.editMode;
        
        var eb = document.getElementById('batchBar');
        var fb = document.getElementById('editFilterBar');
        var isCollView = this.state.currentView === 'collections' && !!this.state.currentCollection;
        if (this.state.editMode) {
            this.state.batchSelected.clear();
            this._editFilterQuery = '';
            this._editFilterModule = '';
            this._editFilterCollected = '';
            if (eb) { eb.style.display = 'flex'; }
            if (fb) { fb.style.display = isCollView ? 'none' : 'block'; }
            if (!isCollView) this._populateEditFilterModules();
            this.updateBatchCount();
            try { localStorage.setItem('promptkit_editmode', '1'); } catch(e) {}
            if (App.aiTools) App.aiTools.showToolbar();  // 编辑模式显示优化/翻译/适配/缩图工具栏
        } else {
            this.state.batchSelected.clear();
            if (eb) eb.style.display = 'none';
            if (fb) fb.style.display = 'none';
            try { localStorage.removeItem('promptkit_editmode'); } catch(e) {}
            if (App.aiTools) App.aiTools.hideToolbar();  // 退出编辑模式隐藏工具栏
        }
        var btn = document.getElementById('btnEditMode');
        if (this.state.editMode) {
            btn.style.color = '#4f46e5';
            btn.classList.add('active');
        } else {
            btn.style.color = '#94a3b8';
            btn.classList.remove('active');
        }
        // 根据当前视图渲染对应内容
        if (this.state.currentView === 'collections' && this.state.currentCollection) {
            this.renderCollectionItems();
        } else {
            this.renderPrompts();
        }
        this.renderSidebar();
    },


    _populateEditFilterModules() {
        var select = document.getElementById('editFilterModule');
        if (!select || !this.state.modules) return;
        var currentVal = select.value || '';
        select.innerHTML = '<option value="">全部模块</option>';
        for (var i = 0; i < this.state.modules.length; i++) {
            var m = this.state.modules[i];
            if (m.id === 'custom' || m.id === 'seedance') continue;
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === currentVal) opt.selected = true;
            select.appendChild(opt);
        }
    },

    // 编辑模式筛选

    _applyEditFilter() {
        this._editFilterQuery = (document.getElementById('editFilterInput').value || '').trim().toLowerCase();
        this._editFilterModule = document.getElementById('editFilterModule').value || '';
        this._editFilterCollected = document.getElementById('editFilterCollected').value || '';
        this._updateFilteredDisplay();
    },


    _resetEditFilter() {
        if (document.getElementById('editFilterInput')) document.getElementById('editFilterInput').value = '';
        if (document.getElementById('editFilterModule')) document.getElementById('editFilterModule').value = '';
        if (document.getElementById('editFilterCollected')) document.getElementById('editFilterCollected').value = '';
        this._editFilterQuery = '';
        this._editFilterModule = '';
        this._editFilterCollected = '';
        this._updateFilteredDisplay();
    },


    _updateFilteredDisplay() {
        // 编辑模式下对渲染的卡片做客户端过滤（只隐藏，不重新请求后端）
        var allCards = document.querySelectorAll('#promptList .prompt-card');
        var visibleCount = 0;
        var self = this;
        allCards.forEach(function(card) {
            var id = parseInt(card.getAttribute('data-id'));
            var promptData = self.state.prompts.find(function(p) { return p.id === id; });
            if (!promptData) { card.style.display = 'none'; return; }
            var show = true;
            // 关键词筛选
            if (self._editFilterQuery) {
                var q = self._editFilterQuery;
                var contentMatch = (promptData.content || '').toLowerCase().indexOf(q) >= 0;
                var meaningMatch = (promptData.meaning || '').toLowerCase().indexOf(q) >= 0;
                var catMatch = (promptData.category || '').toLowerCase().indexOf(q) >= 0;
                if (!contentMatch && !meaningMatch && !catMatch) show = false;
            }
            // 模块筛选
            if (show && self._editFilterModule) {
                if ((promptData.module || '') !== self._editFilterModule) show = false;
            }
            // 收藏筛选
            if (show && self._editFilterCollected) {
                var colls = promptData.collections || [];
                if (self._editFilterCollected === 'collected' && colls.length === 0) show = false;
                if (self._editFilterCollected === 'uncollected' && colls.length > 0) show = false;
            }
            card.style.display = show ? '' : 'none';
            if (show) visibleCount++;
        });
        var countEl = document.getElementById('editFilterCount');
        if (countEl) {
            var total = allCards.length;
            countEl.textContent = visibleCount < total ? (visibleCount + '/' + total + ' 条匹配') : '';
        }
    },


    toggleSelect(promptId) {
        if (this.state.batchSelected.has(promptId)) {
            this.state.batchSelected.delete(promptId);
        } else {
            this.state.batchSelected.add(promptId);
        }
        // 根据当前视图渲染对应内容
        if (this.state.currentView === 'collections' && this.state.currentCollection) {
            this.renderCollectionItems();
        } else {
            this.renderPrompts();
        }
        this.updateBatchCount();
    },


    selectAllPrompts() {
        // Phase17.4: 分组级全选/取消 — 切换分组保留原有选中，只对当前页操作
        //  当前页全选中 → 取消当前页选中（保留其他分组选中不变）
        //  当前页未全选 → 全选当前页（累加到已有选中）
        var items = (this.state.currentView === 'collections' && this.state.currentCollection)
            ? (this.state.collectionItems || [])
            : (this.state.prompts || []);
        var allIds = items.map(function(p) { return p.id; });
        var allSelected = allIds.length > 0 && allIds.every(function(id) { return App.state.batchSelected.has(id); });

        if (allSelected) {
            // 当前页全部已选中 → 只取消当前页的选中（不碰其他分组的选中）
            for (var i = 0; i < allIds.length; i++) {
                this.state.batchSelected.delete(allIds[i]);
            }
        } else {
            // 当前页未全选 → 全选当前页（累加到已有选中）
            for (var i = 0; i < allIds.length; i++) {
                this.state.batchSelected.add(allIds[i]);
            }
        }
        // 根据当前视图渲染对应内容
        if (this.state.currentView === 'collections' && this.state.currentCollection) {
            this.renderCollectionItems();
        } else {
            this.renderPrompts();
        }
        this.updateBatchCount();
    },


    updateBatchCount() {
        var count = this.state.batchSelected.size;
        var el = document.getElementById('batchCount');
        if (el) el.textContent = '已选 ' + count + ' 项';

        // 按钮文字：获取当前视图下的所有条目
        var allItems = (this.state.currentView === 'collections' && this.state.currentCollection)
            ? (this.state.collectionItems || [])
            : (this.state.prompts || []);
        var allIds = allItems.map(function(p) { return p.id; });
        var allSelected = allIds.length > 0 && allIds.every(function(id) { return App.state.batchSelected.has(id); });
        var btn = document.getElementById('btnSelectAllPrompts');
        if (btn) {
            btn.innerHTML = allSelected
                ? '<i class="bi bi-x-square"></i> 取消全选'
                : '<i class="bi bi-check-all"></i> 全选';
        }

        // Phase17.2: 收藏夹专用按钮显隐（移出本分组 仅收藏夹显示）
        var isCollView = this.state.currentView === 'collections' && !!this.state.currentCollection;
        document.querySelectorAll('.btn-batch-coll').forEach(function(b) {
            b.style.display = isCollView ? '' : 'none';
        });
    },


    async exportSelected() {
        // 将 editMode 下的选中项传给导出弹窗的「已选择的词条」模式
        var ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先勾选要导出的词条', 'error'); return; }
        document.getElementById('modalImportExport').style.display = 'flex';
        this.switchIETab('export');
        // 自动选中「已选择的词条」范围
        document.getElementById('ieExportScope').value = 'selected';
        this._updateExportBtn();
    },


    _renderExportPreviewList(items) {
        var container = document.getElementById('epItemList');
        var html = '<table style="width:100%;border-collapse:collapse;">';
        html += '<thead><tr style="background:var(--hover-bg,#f1f5f9);"><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">#</th><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">模块</th><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">分类</th><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">内容预览</th><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">使用</th></tr></thead><tbody>';
        for (var i = 0; i < items.length; i++) {
            var p = items[i];
            var preview = (p.content || '').length > 50 ? (p.content || '').slice(0, 50) + '...' : (p.content || '');
            html += '<tr>';
            html += '<td style="padding:4px 6px;font-size:11px;color:var(--text-muted);border-bottom:1px dashed var(--border-color);">' + (i + 1) + '</td>';
            html += '<td style="padding:4px 6px;font-size:11px;border-bottom:1px dashed var(--border-color);">' + this._escape(p.module || '') + '</td>';
            html += '<td style="padding:4px 6px;font-size:11px;border-bottom:1px dashed var(--border-color);">' + this._escape(p.category || '') + '</td>';
            html += '<td style="padding:4px 6px;font-size:11px;border-bottom:1px dashed var(--border-color);color:var(--text-muted);">' + this._escape(preview) + '</td>';
            html += '<td style="padding:4px 6px;font-size:11px;border-bottom:1px dashed var(--border-color);text-align:center;">' + (p.usage_count || 0) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    },


    _refreshExportPreview() {
        var items = this._epItems || [];
        if (items.length === 0) {
            document.getElementById('epContent').value = '';
            return;
        }
        var fmt = document.querySelector('input[name="epFmt"]:checked');
        fmt = fmt ? fmt.value : 'txt';
        var content = '';
        if (fmt === 'json') {
            var exportData = {
                exported_at: new Date().toISOString(),
                count: items.length,
                prompts: items.map(function(p) {
                    return { id: p.id, content: p.content, meaning: p.meaning, module: p.module, category: p.category, tags: p.tags };
                })
            };
            content = JSON.stringify(exportData, null, 2);
        } else {
            var lines = [
                '# 提示词导出 - ' + new Date().toLocaleString('zh-CN'),
                '# 共 ' + items.length + ' 条',
                '', '---', ''
            ];
            for (var i = 0; i < items.length; i++) {
                var p = items[i];
                lines.push('[' + (i + 1) + '] [' + (p.module || '') + '/' + (p.category || '') + '] ' + (p.content || ''));
                if (p.meaning) lines.push('    释义: ' + p.meaning);
                if (p.scene) lines.push('    场景: ' + p.scene);
                lines.push('');
            }
            content = lines.join('\n');
        }
        document.getElementById('epContent').value = content;
        document.getElementById('epCount').textContent = '选中 ' + items.length + ' 条 · ' + (fmt === 'json' ? App._t('auto.str_c4cee7d7', 'JSON 格式') : App._t('auto.str_8d90f45c', 'TXT 格式'));
    },


    async _doExportPreview() {
        var ids = this._epItems ? this._epItems.map(function(p) { return p.id; }) : [];
        if (ids.length === 0) { this.showToast('没有可导出的词条', 'error'); return; }
        var fmt = document.querySelector('input[name="epFmt"]:checked');
        fmt = fmt ? fmt.value : 'txt';
        document.getElementById('modalExportPreview').style.display = 'none';

        if (fmt === 'png') {
            this._exportQueue = { ids: ids, fmt: 'png' };
            this._showExportNameDialog(ids, 'png');
            return;
        }

        try {
            var res = await fetch('/api/v2/batch/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_ids: ids, format: fmt })
            });
            var blob = await res.blob();
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = this._makeExportFilename(this._epItems || [], fmt);
            a.click();
            URL.revokeObjectURL(url);
            this.showToast(App._t('common.export', '导出成功 (') + ids.length + ' 条)', 'success');
            document.getElementById('modalExportPreview').style.display = 'none';
        } catch (e) {
            this.showToast(App._t('common.export', '导出未完成: ') + e.message, 'error');
        }
    },

    // ============ 拖拽导入 ============

    // _initDropZone 实现在 app_editor.js 中（此处不覆盖）

    // ============ 导入分组规则统一（PNG/.pt/JSON/TXT-MD 共用） ============
    // 2026-08-03: 统一选择分组规则 — 文件内原始默认分组第一顺位(★)，当前所在分组第二顺位(●)
});
})();
