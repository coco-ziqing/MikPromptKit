/**
 * PromptKit — app_tools 模块
 * 智能推荐, 拖拽导入, 导入预览渲染（JSON / .pt 共用）
 * 自动生成 — 勿手动编辑
 */
(function() {
'use strict';
Object.assign(App, {
    // ============ 智能推荐 ============
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
        // 编辑模式仅适用于 home 视图，非 home 视图时先切换
        if (this.state.currentView !== 'home') {
            this.switchView('home');
        }
        this.state.editMode = !this.state.editMode;
        
        var eb = document.getElementById('batchBar');
        var fb = document.getElementById('editFilterBar');
        if (this.state.editMode) {
            this.state.batchSelected.clear();
            this._editFilterQuery = '';
            this._editFilterModule = '';
            this._editFilterCollected = '';
            if (eb) { eb.style.display = 'flex'; }
            if (fb) { fb.style.display = 'block'; }
            this._populateEditFilterModules();
            this.updateBatchCount();
            // 持久化编辑模式状态
            try { localStorage.setItem('promptkit_editmode', '1'); } catch(e) {}
        } else {
            this.state.batchSelected.clear();
            if (eb) eb.style.display = 'none';
            if (fb) fb.style.display = 'none';
            try { localStorage.removeItem('promptkit_editmode'); } catch(e) {}
        }
        var btn = document.getElementById('btnEditMode');
        if (this.state.editMode) {
            btn.style.color = '#4f46e5';
            btn.classList.add('active');
        } else {
            btn.style.color = '#94a3b8';
            btn.classList.remove('active');
        }
        this.renderPrompts();
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
        this.renderPrompts();
        this.updateBatchCount();
    },

    selectAllPrompts() {
        var allIds = this.state.prompts.map(function(p) { return p.id; });
        // 如果当前已全选 → 取消全选；否则全选
        var allSelected = allIds.every(function(id) { return App.state.batchSelected.has(id); });
        if (allSelected) {
            this.state.batchSelected.clear();
        } else {
            for (const p of this.state.prompts) {
                this.state.batchSelected.add(p.id);
            }
        }
        this.renderPrompts();
        this.updateBatchCount();
    },

    updateBatchCount() {
        var count = this.state.batchSelected.size;
        var el = document.getElementById('batchCount');
        if (el) el.textContent = '已选 ' + count + ' 项';
        // 更新按钮文字
        var btn = document.getElementById('btnSelectAllPrompts');
        if (btn) {
            var allIds = this.state.prompts.map(function(p) { return p.id; });
            var allSelected = allIds.every(function(id) { return App.state.batchSelected.has(id); });
            btn.innerHTML = allSelected
                ? '<i class="bi bi-x-square"></i> 取消全选'
                : '<i class="bi bi-check-all"></i> 全选';
        }
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
        document.getElementById('epCount').textContent = '选中 ' + items.length + ' 条 · ' + (fmt === 'json' ? 'JSON 格式' : 'TXT 格式');
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
            this.showToast('导出成功 (' + ids.length + ' 条)', 'success');
            document.getElementById('modalExportPreview').style.display = 'none';
        } catch (e) {
            this.showToast('导出失败: ' + e.message, 'error');
        }
    },

    // ============ 拖拽导入 ============

    _initDropZone() { this._dropAttached = true; },

    async handleDropPngFile(file) {
        try {
            // 立即读取文件为 ArrayBuffer，避免拖拽 File 流被消耗后无法复用
            this._diPngBuffer = await file.arrayBuffer();
            this._diPngName = file.name;

            var formData = new FormData();
            formData.append('file', new File([this._diPngBuffer], this._diPngName, {type: 'image/png'}));
            var resp = await fetch('/api/export/preview-png', { method: 'POST', body: formData });
            var preview = await resp.json();
            if (!preview.ok || !preview.preview) {
                this.showToast('该 PNG 不包含有效的提示词数据', 'error');
                return;
            }
            var p = preview.preview;
            var item = {
                content: p.content || '',
                meaning: p.meaning || '',
                scene: p.scene || '',
                module: p.module || 'custom',
                category: p.category || '',
                tags: p.tags || []
            };
            this._diFile = file;
            this._diItems = [item];
            this._diIsPt = false;
            this._diIsPng = true;
            this._diPngFile = file;
            document.getElementById('diFileName').textContent = file.name;
            document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB · 1 条提示词';
            document.getElementById('diCount').textContent = '共 1 条提示词';
            this._renderDiItems([item]);
            document.getElementById('diSelectAll').checked = true;
            document.getElementById('diResult').style.display = 'none';
            document.getElementById('btnDiImport').disabled = false;
            document.getElementById('btnDiImport').innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
            document.getElementById('modalDropImport').style.display = 'flex';
        } catch (e) {
            this.showToast('PNG 解析失败: ' + e.message, 'error');
        }
    },

    async _handleDropFile(file) {
        // 读取并解析 JSON
        var text = await file.text();
        var data;
        try {
            data = JSON.parse(text);
        } catch(e) {
            this.showToast('JSON 解析失败：' + e.message, 'error');
            return;
        }
        // 兼容两种格式：{prompts: [...]} 或直接数组
        var items = data.prompts || data;
        if (!Array.isArray(items) || items.length === 0) {
            this.showToast('未找到有效的提示词数据', 'error');
            return;
        }
        // 规范化：确保每个 item 有 content
        items = items.filter(function(item) {
            return item.content || item.prompt;
        }).map(function(item) {
            // 兼容 prompt 字段
            if (!item.content && item.prompt) item.content = item.prompt;
            return item;
        });
        if (items.length === 0) {
            this.showToast('未找到有效的提示词条目', 'error');
            return;
        }

        this._diFile = file;
        this._diItems = items;
        this._diIsPt = false;

        // 填充弹窗信息
        document.getElementById('diFileName').textContent = file.name;
        document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB · ' + items.length + ' 条提示词';
        document.getElementById('diCount').textContent = '共 ' + items.length + ' 条提示词';

        // 统一渲染预览列表
        this._renderDiItems(items);

        document.getElementById('diSelectAll').checked = true;
        document.getElementById('diResult').style.display = 'none';
        document.getElementById('btnDiImport').disabled = false;
        document.getElementById('btnDiImport').innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';

        // 显示弹窗
        document.getElementById('modalDropImport').style.display = 'flex';
    },

    // ============ 导入预览渲染（JSON / .pt 共用） ============

    _renderDiItems(items) {
        var container = document.getElementById('diItemList');
        var moduleOpts = '';
        var modList = this.state.modules || [];
        for (var mi = 0; mi < modList.length; mi++) {
            var m = modList[mi];
            if (m.id === 'seedance') continue;
            moduleOpts += '<option value="' + this._escape(m.id) + '">' + this._escape(m.name || m.id) + '</option>';
        }
        var html = '<table>';
        html += '<thead><tr><th style="width:30px;"></th><th>模块</th><th>分类</th><th>词条内容（点击编辑）</th></tr></thead><tbody>';
        var limit = Math.min(50, items.length);
        for (var i = 0; i < limit; i++) {
            var item = items[i];
            var escContent = this._escape(item.content || '');
            var itemModule = item.module || 'custom';
            var escCategory = this._escape(item.category || '通用');
            var optHtml = moduleOpts.replace('value="' + itemModule + '"', 'value="' + itemModule + '" selected');
            var hasModule = modList.some(function(m) { return m.id === itemModule; });
            if (!hasModule) {
                optHtml = '<option value="' + this._escape(itemModule) + '" selected>' + this._escape(itemModule) + '</option>' + optHtml;
            }
            html += '<tr>';
            html += '<td><input type="checkbox" class="di-item-cb" data-idx="' + i + '" checked onchange="App._updateDiCount()"></td>';
            html += '<td><select class="di-module-select" data-idx="' + i + '">' + optHtml + '</select></td>';
            html += '<td><input class="di-category-input" data-idx="' + i + '" value="' + escCategory + '"></td>';
            html += '<td><input class="di-content-input" data-idx="' + i + '" value="' + escContent + '"></td>';
            html += '</tr>';
        }
        if (items.length > 50) {
            html += '<tr><td colspan="4" style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted);">... 还有 ' + (items.length - 50) + ' 条（导入时全部导入）</td></tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    },

    _updateDiCount() {
        var checkboxes = document.querySelectorAll('.di-item-cb:checked');
        document.getElementById('diCount').textContent = '已选 ' + checkboxes.length + ' / ' + this._diItems.length + ' 条';
    },

    _toggleDiSelectAll() {
        var checked = document.getElementById('diSelectAll').checked;
        var cbs = document.querySelectorAll('.di-item-cb');
        for (var i = 0; i < cbs.length; i++) cbs[i].checked = checked;
        this._updateDiCount();
    },

    async _confirmDropImport() {
        var cbs = document.querySelectorAll('.di-item-cb:checked');
        if (cbs.length === 0) { this.showToast('请至少选择一条提示词', 'error'); return; }
        var btn = document.getElementById('btnDiImport');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div> 正在导入...';

        var data;
        if (this._diIsPng && this._diPngBuffer) {
            // PNG 导入：收集用户编辑覆盖
            var conflict = document.getElementById('diConflictSelect').value;
            var overrides = [];
            for (var cbi = 0; cbi < cbs.length; cbi++) {
                var idx = parseInt(cbs[cbi].getAttribute('data-idx'));
                var contentInput = document.querySelector('.di-content-input[data-idx="' + idx + '"]');
                var moduleSelect = document.querySelector('.di-module-select[data-idx="' + idx + '"]');
                var categoryInput = document.querySelector('.di-category-input[data-idx="' + idx + '"]');
                overrides.push({
                    content: contentInput ? contentInput.value.trim() : null,
                    module: moduleSelect ? moduleSelect.value : null,
                    category: categoryInput ? categoryInput.value.trim() : null
                });
            }
            var formData = new FormData();
            // 使用缓存的 ArrayBuffer 重建 File，避免拖拽 File 流被消费后失效
            formData.append('file', new File([this._diPngBuffer], this._diPngName, {type: 'image/png'}));
            formData.append('conflict', conflict);
            formData.append('overrides', JSON.stringify(overrides));
            try {
                var resp = await fetch('/api/export/import-png', { method: 'POST', body: formData });
                data = await resp.json();
            } catch (e) {
                this.showToast('PNG 导入失败', 'error');
                btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
                return;
            }
            // 标准化返回值（后端 import-png 返回 {ok, result}，统一为 {created, skipped}）
            if (data && data.ok) {
                if (data.result && data.result.created) {
                    data.created = 1;
                    data.skipped = 0;
                    data.failed = 0;
                } else if (data.result && data.result.reason === 'skip') {
                    data.created = 0;
                    data.skipped = 1;
                    data.failed = 0;
                } else {
                    data.created = 0;
                    data.skipped = 0;
                    data.failed = 1;
                }
            }
        } else if (this._diIsPt) {
            // .pt 包导入：收集用户编辑覆盖 + 上传原文件
            var overrides = [];
            for (var cbi = 0; cbi < cbs.length; cbi++) {
                var idx = parseInt(cbs[cbi].getAttribute('data-idx'));
                var contentInput = document.querySelector('.di-content-input[data-idx="' + idx + '"]');
                var moduleSelect = document.querySelector('.di-module-select[data-idx="' + idx + '"]');
                var categoryInput = document.querySelector('.di-category-input[data-idx="' + idx + '"]');
                overrides.push({
                    content: contentInput ? contentInput.value.trim() : null,
                    module: moduleSelect ? moduleSelect.value : null,
                    category: categoryInput ? categoryInput.value.trim() : null
                });
            }
            var formData = new FormData();
            formData.append('file', this._diPtFile);
            formData.append('conflict', document.getElementById('diConflictSelect').value);
            formData.append('overrides', JSON.stringify(overrides));
            try {
                var resp = await fetch('/api/v2/pt/import', { method: 'POST', body: formData });
                data = await resp.json();
            } catch (e) {
                this.showToast('导入失败', 'error');
                btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
                return;
            }
        } else {
            // JSON 导入：收集编辑后的值
            var items = [];
            for (var i = 0; i < cbs.length; i++) {
                var idx = parseInt(cbs[i].getAttribute('data-idx'));
                var original = this._diItems[idx];
                var contentInput = document.querySelector('.di-content-input[data-idx="' + idx + '"]');
                var moduleSelect = document.querySelector('.di-module-select[data-idx="' + idx + '"]');
                var categoryInput = document.querySelector('.di-category-input[data-idx="' + idx + '"]');
                items.push({
                    content: contentInput ? contentInput.value.trim() : (original.content || ''),
                    meaning: original.meaning || '',
                    scene: original.scene || '',
                    module: moduleSelect ? moduleSelect.value : (original.module || 'custom'),
                    category: categoryInput ? categoryInput.value.trim() : (original.category || '通用'),
                    tags: original.tags || []
                });
            }
            var conflict = document.getElementById('diConflictSelect').value;
            data = await this.fetchJSON('/api/v2/import/from-json-data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: items, conflict: conflict })
            });
        }

        if (!data) {
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
            this.showToast('导入失败，请重试', 'error');
            return;
        }

        var resultEl = document.getElementById('diResult');
        resultEl.style.display = 'block';
        if (data.failed > 0) {
            resultEl.style.color = '#ef4444';
            resultEl.innerHTML = '导入完成：' + data.created + ' 成功, ' + data.skipped + ' 跳过, ' + data.failed + ' 失败';
        } else {
            resultEl.style.color = '#059669';
            resultEl.innerHTML = '✅ 导入成功！' + data.created + ' 条提示词已添加';
        }

        btn.disabled = false; btn.innerHTML = '✅ 已完成';
        btn.onclick = function() { document.getElementById('modalDropImport').style.display = 'none'; };

        if (data.created > 0) {
            this.state.page = 1;
            await this.loadPrompts();
            this.showToast('成功导入 ' + data.created + ' 条提示词', 'success');
        }
    },

    // ============ .pt 包拖拽导入 ============

    async _handleDropPtFile(file) {
        var formData = new FormData();
        formData.append('file', file);
        var resp = await fetch('/api/v2/pt/preview', { method: 'POST', body: formData });
        if (!resp.ok) {
            var errText = await resp.text();
            this.showToast('预览失败: ' + errText, 'error');
            return;
        }
        var data = await resp.json();
        if (!data || !data.items || data.items.length === 0) {
            this.showToast('未找到有效的提示词数据', 'error');
            return;
        }
        this._diPtFile = file;
        this._diIsPt = true;
        this._diItems = data.items;
        document.getElementById('diFileName').textContent = file.name;
        document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB \u00B7 ' + data.count + ' \u6761\u63D0\u793A\u8BCD';
        document.getElementById('diCount').textContent = '共 ' + data.count + ' 条提示词';
        this._renderDiItems(data.items);
        document.getElementById('diSelectAll').checked = true;
        document.getElementById('diResult').style.display = 'none';
        document.getElementById('btnDiImport').disabled = false;
        document.getElementById('btnDiImport').innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
        document.getElementById('modalDropImport').style.display = 'flex';
    },

    _copyExportPreview() {
        var text = document.getElementById('epContent').value;
        if (!text) { this.showToast('没有内容可复制', 'error'); return; }
        this.copyText(text, '已复制导出内容');
    },

    clearEditSelection() {
        this.state.batchSelected.clear();
        this.renderPrompts();
        this.updateBatchCount();
    },

    async batchCopy() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先选择提示词', 'error'); return; }
        const data = await this.fetchJSON('/api/v2/batch/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        if (!data) return;
        // 显示模态框
        document.getElementById('batchResultText').value = data.text;
        document.getElementById('modalBatchResult').style.display = 'flex';
    },

    async copyBatchResult() {
        const text = document.getElementById('batchResultText').value;
        await this.copyText(text, '已复制全部内容');
    },

    async batchExport(fmt) {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先选择提示词', 'error'); return; }
        if (fmt === 'pt' || fmt === 'png') {
            this._exportQueue = { ids: ids, fmt: fmt };
            this._showExportNameDialog(ids, fmt);
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
            a.download = App._makeExportFilename(ids, fmt);
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('导出成功 (' + ids.length + ' 条)', 'success');
        } catch (e) {
            this.showToast('导出失败', 'error');
        }
    },

    // ============ 导出命名弹窗 ============

    _showExportNameDialog(ids, fmt) {
        var fmtNames = { pt: '.pt 提示词包', png: '导出 PNG 卡片' };
        document.getElementById('exportNameTitle').textContent = '导出 ' + (fmtNames[fmt] || fmt.toUpperCase());
        var defaultName = this._makeExportFilename(ids, fmt).replace('.' + fmt, '');
        document.getElementById('exportNameInput').value = defaultName;
        document.getElementById('exportNameCount').textContent = '共 ' + ids.length + ' 条 · 格式: ' + (fmt === 'pt' ? '.pt 提示词包' : 'PNG 卡片');

        var savedPath = localStorage.getItem('promptkit_export_path') || '';
        var pi = document.getElementById('exportPathInput');
        var se = document.getElementById('exportPathStatus');
        if (savedPath && (savedPath.includes(":\\") || savedPath.includes(":/"))) {
            pi.value = savedPath;
            if (se) { se.innerHTML = '\u2705 目录: <strong>' + savedPath + '</strong>'; se.style.color = '#059669'; }
        } else if (savedPath) {
            pi.value = '\U0001f4c1 ' + savedPath;
            if (se) { se.innerHTML = '\u2705 文件夹: <strong>' + savedPath + '</strong>'; se.style.color = '#059669'; }
        } else {
            pi.value = '';
            if (se) { se.innerHTML = '\U0001f4a1 点击输入框选择文件夹，或直接输入完整磁盘路径'; se.style.color = 'var(--text-muted)'; }
        }

        pi.oninput = function() {
            var v = this.value.trim();
            var s = document.getElementById('exportPathStatus');
            if (!s) return;
            if (!v) { s.innerHTML = '\U0001f4a1 点击输入框选择文件夹，或直接输入完整磁盘路径'; s.style.color = 'var(--text-muted)'; }
            else if (v.includes(":\\") || v.includes(":/")) {
                s.innerHTML = '\u23f3 验证路径...';
                s.style.color = '#f59e0b';
                clearTimeout(this._pathCheckTimer);
                this._pathCheckTimer = setTimeout(function() {
                    fetch('/api/utils/check-path', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: document.getElementById('exportPathInput').value.trim() })
                    }).then(function(r) { return r.json(); }).then(function(d) {
                        if (d.ok) { s.innerHTML = '\u2705 目录存在: <strong>' + d.path + '</strong>'; s.style.color = '#059669'; localStorage.setItem('promptkit_export_path', d.path); }
                        else { s.innerHTML = '\u26a0\ufe0f ' + d.error; s.style.color = '#ef4444'; }
                    }).catch(function() { s.innerHTML = ''; });
                }, 500);
            } else {
                s.innerHTML = '';
            }
        };

        var ext = fmt === 'pt' ? '.pt' : '.png';
        document.getElementById('exportPathPreview').innerHTML = fmt === 'pt'
            ? '\U0001f4c4 将保存为: <strong>' + defaultName + ext + '</strong>'
            : '\U0001f4c4 将保存 <strong>' + ids.length + '</strong> 张 PNG 图片到目录: <strong>' + defaultName + '</strong>';

        document.getElementById('exportNameInput').oninput = function() {
            var val = this.value.trim() || defaultName;
            var ext = fmt === 'pt' ? '.pt' : '.png';
            document.getElementById('exportPathPreview').innerHTML = fmt === 'pt'
                ? '\U0001f4c4 将保存为: <strong>' + val + ext + '</strong>'
                : '\U0001f4c4 将保存 <strong>' + ids.length + '</strong> 张 PNG 图片到目录: <strong>' + val + '</strong>';
        };

        document.getElementById('btnConfirmExportName').onclick = function() { App._confirmBatchExport(); };
        document.getElementById('modalExportName').style.display = 'flex';
    },

    async _confirmBatchExport() {
        if (!this._exportQueue) return;
        var ids = this._exportQueue.ids;
        var fmt = this._exportQueue.fmt;
        var customName = document.getElementById('exportNameInput').value.trim();

        var saveDir = document.getElementById('exportPathInput').value.trim().replace(/^\U0001f4c1\s*/, '');
        if (saveDir.includes(":\\") || saveDir.includes(":/")) {
            localStorage.setItem('promptkit_export_path', saveDir);
        } else {
            saveDir = '';
        }

        document.getElementById('modalExportName').style.display = 'none';

        try {
            if (fmt === 'pt') {
                var r = await fetch('/api/v2/pt/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt_ids: ids })
                });
                var b = await r.blob();
                var cd = r.headers.get('Content-Disposition') || '';
                var m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/);
                var dn = customName ? (customName + '.pt') : (m ? decodeURIComponent(m[1]) : App._makeExportFilename(ids, 'pt'));

                if (saveDir) {
                    var ok = await App._saveBlobToPath(b, saveDir + '\\' + dn);
                    if (ok) { App.showToast('导出成功 (' + ids.length + ' 条)', 'success'); }
                    else { App._fallbackDownload(b, dn); App.showToast('写入失败，已改为下载', 'warning'); }
                } else {
                    App._fallbackDownload(b, dn);
                    App.showToast('导出成功 (' + ids.length + ' 条)', 'success');
                }
            } else if (fmt === 'png') {
                var saved = 0;
                for (var i = 0; i < ids.length; i++) {
                    var p = this.state.prompts ? this.state.prompts.find(function(x) { return x.id === ids[i]; }) : null;
                    var pr = await fetch('/api/export/prompt-to-png/' + ids[i]);
                    var pb = await pr.blob();
                    var pn = App._makeExportFilename(p ? [p] : [{id: ids[i]}], 'png');
                    if (saveDir) {
                        var ok = await App._saveBlobToPath(pb, saveDir + '\\' + pn);
                        if (ok) saved++;
                        else App._fallbackDownload(pb, pn);
                    } else {
                        App._fallbackDownload(pb, pn);
                        saved++;
                    }
                }
                App.showToast('导出成功 (' + saved + '/' + ids.length + ' 张 PNG)', 'success');
            }
        } catch (e) {
            App.showToast('导出失败: ' + e.message, 'error');
        }
        this._exportQueue = null;
    },

    async _pickExportPath() {
        try {
            var r = await fetch('/api/utils/pick-folder', { method: 'POST' });
            var d = await r.json();
            if (d.ok && d.path) {
                this._exportPath = d.path;
                localStorage.setItem('promptkit_export_path', d.path);
                document.getElementById('exportPathInput').value = d.path;
                var s = document.getElementById('exportPathStatus');
                if (s) { s.innerHTML = '\u2705 目录: <strong>' + d.path + '</strong>'; s.style.color = '#059669'; }
            } else if (d.error && d.error !== '未选择目录') {
                this.showToast('选择目录失败: ' + d.error, 'error');
            }
        } catch (e) {
            this.showToast('目录选择器调用失败', 'error');
        }
    },

    _fallbackDownload(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    _blobToBase64(blob) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onloadend = function() { resolve(reader.result.split(',')[1]); };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },

    async _saveBlobToPath(blob, fullPath) {
        try {
            var b64 = await this._blobToBase64(blob);
            var r = await fetch('/api/utils/save-blob', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: fullPath, content: b64 })
            });
            var d = await r.json();
            return d.ok;
        } catch (e) {
            console.warn('保存文件失败:', e.message);
            return false;
        }
    },

    async batchAddToWordpack() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先选择提示词', 'error'); return; }
        // 加载词包列表
        const data = await this.fetchJSON('/api/v2/wordpacks');
        if (!data || data.items.length === 0) {
            this.showToast('请先创建词包', 'error');
            return;
        }
        document.getElementById('modalAddToTitle').textContent = '添加到词包';
        let html = '<p style="margin-bottom:12px;font-size:13px;color:var(--text-muted);">选择要添加到的词包:</p>';
        for (const wp of data.items) {
            html += `<div class="cat-tab" style="display:block;margin-bottom:6px;text-align:left;" onclick="App.doAddToWordpack(${wp.id}, '${this._escape(wp.name)}')">
                📁 ${this._escape(wp.name)} (${wp.item_count} 条)
            </div>`;
        }
        document.getElementById('wordpackSelectList').innerHTML = html;
        document.getElementById('modalAddToWordpack').style.display = 'flex';
    },

    // ============ 弹窗模块下拉填充 ============

    _populateModuleOptions(selectedVal) {
        var select = document.getElementById('editModule');
        var modules = this.state.modules || [];
        select.innerHTML = '';
        for (var i = 0; i < modules.length; i++) {
            var m = modules[i];
            if (m.id === 'custom') continue;
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === selectedVal) opt.selected = true;
            select.appendChild(opt);
        }
    },

    // ============ 导入/导出 ============

    showImportModal() {
        document.getElementById('modalImportExport').style.display = 'flex';
        this.switchIETab('import');
    },

    showExportModal() {
        document.getElementById('modalImportExport').style.display = 'flex';
        this.switchIETab('export');
        this._updateExportBtn();
    },

    // ============ 截图导入 ============

    async openScreenshotImport() {
        // 重置状态
        this._ssTempImage = '';
        this._ssHasImage = false;
        this._ssContinueMode = false;
        document.getElementById('ssUploadArea').style.display = 'block';
        document.getElementById('ssLoading').style.display = 'none';
        document.getElementById('ssPreviewArea').style.display = 'none';
        document.getElementById('ssError').style.display = 'none';
        document.getElementById('ssBtnImport').style.display = 'none';
        document.getElementById('ssBtnContinue').style.display = 'none';
        document.getElementById('ssBtnRetry').style.display = 'none';
        document.getElementById('ssFileInput').value = '';
        document.getElementById('ssPastePreview').style.display = 'none';
        this._ssPasteFile = null;
        this._populateSSModule();
        document.getElementById('modalScreenshotImport').style.display = 'flex';
        // 弹窗打开时自动激活粘贴监听，Ctrl+V 直接进入分析
        this._activatePasteListener();
    },

    _populateSSModule() {
        var select = document.getElementById('ssModule');
        if (!select) return;
        var modules = this.state.modules || [];
        // 默认选中当前所在模块（侧边栏选中的模块），无选中时回退到现有值或 custom
        var currentVal = this.state.currentModule || select.value || 'custom';
        select.innerHTML = '';
        var hasOptions = false;
        for (var i = 0; i < modules.length; i++) {
            var m = modules[i];
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === currentVal) opt.selected = true;
            select.appendChild(opt);
            hasOptions = true;
        }
        if (!hasOptions) {
            var fb = { emotion: '人物表情', color: '场景色彩', tone: '画面色调', composition: '构图运镜', seedance: '视频模板', custom: '自定义' };
            for (var k in fb) {
                var opt2 = document.createElement('option');
                opt2.value = k;
                opt2.textContent = fb[k];
                if (k === currentVal) opt2.selected = true;
                select.appendChild(opt2);
            }
        }
    },

    async _onSSFileSelect(event) {
        var file = event.target.files[0];
        if (!file) return;
        this._processSSFile(file);
    },

    async _processSSFile(file) {
        var self = this;
        document.getElementById('ssUploadArea').style.display = 'none';
        document.getElementById('ssLoading').style.display = 'block';
        document.getElementById('ssPreviewArea').style.display = 'none';
        document.getElementById('ssError').style.display = 'none';
        document.getElementById('ssBtnImport').style.display = 'none';
        document.getElementById('ssBtnContinue').style.display = 'none';
        document.getElementById('ssBtnRetry').style.display = 'none';

        var formData = new FormData();
        formData.append('file', file);

        try {
            var resp = await fetch('/api/v2/ocr/preview', { method: 'POST', body: formData, signal: controller.signal });
            var data = await resp.json();

            document.getElementById('ssLoading').style.display = 'none';

            if (!data.ok) {
                var errEl = document.getElementById('ssError');
                errEl.innerHTML = '<strong>\u274c ' + (data.error || '识别失败') + '</strong><br><span style="font-size:12px;margin-top:8px;display:block;">\u8bf7\u786e\u8ba4 Ollama \u6b63\u5728\u8fd0\u884c\u4e14\u6709\u89c6\u89c9\u6a21\u578b\u53ef\u7528\u3002</span>';
                errEl.style.display = 'block';
                document.getElementById('ssBtnRetry').style.display = 'inline-block';
                return;
            }

            var preview = data.preview || {};
            self._ssTempImage = (data.temp_files && data.temp_files.image) || '';
            self._ssHasImage = data.layout && data.layout.has_image_region;

            var content = preview.content || '';
            document.getElementById('ssContent').value = content;
            document.getElementById('ssMeaning').value = preview.meaning || '';
            document.getElementById('ssScene').value = preview.scene || '';
            document.getElementById('ssCategory').value = preview.category || 'OCR导入';
            document.getElementById('ssTags').value = JSON.stringify(preview.tags || []);
            document.getElementById('ssTips').value = preview.tips || '';

            this._populateSSModule();
            var moduleSelect = document.getElementById('ssModule');
            if (preview.module && preview.module !== 'custom') {
                for (var i = 0; i < moduleSelect.options.length; i++) {
                    if (moduleSelect.options[i].value === preview.module) {
                        moduleSelect.value = preview.module;
                        break;
                    }
                }
            }

            if (self._ssHasImage && self._ssTempImage) {
                document.getElementById('ssThumbPreview').innerHTML = '<img src="/api/v2/ocr/temp-file/' + self._ssTempImage + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">';
            } else {
                document.getElementById('ssThumbPreview').textContent = '无效果图';
            }

            var rawText = content;
            if (preview.meaning) rawText += '\n' + preview.meaning;
            if (preview.tips) rawText += '\n\u2728 ' + preview.tips;
            document.getElementById('ssRawText').textContent = rawText.substring(0, 300) + (rawText.length > 300 ? '...' : '');

            document.getElementById('ssPreviewArea').style.display = 'block';
            document.getElementById('ssBtnImport').style.display = 'inline-block';
            document.getElementById('ssBtnContinue').style.display = 'inline-block';
            if (data.error) {
                document.getElementById('ssBtnRetry').style.display = 'inline-block';
            }

            // 去重检查
            if (content) {
                try {
                    var dupResp = await fetch('/api/v2/ocr/check-duplicate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: content })
                    });
                    var dupData = await dupResp.json();
                    if (dupData && dupData.ok && dupData.duplicate) {
                        self.showToast('\u26a0\ufe0f 已存在相同内容的词条 (模块: ' + (dupData.exists[0]?.module || '?') + ')，请确认', 'warning', 6000);
                        document.getElementById('ssContent').style.borderColor = '#f59e0b';
                    } else {
                        document.getElementById('ssContent').style.borderColor = '';
                    }
                } catch(e) {}
            }

            setTimeout(function() { var c = document.getElementById('ssContent'); if (c) { c.focus(); c.select(); } }, 50);
        } catch(e) {
            document.getElementById('ssLoading').style.display = 'none';
            var errEl = document.getElementById('ssError');
            errEl.innerHTML = '<strong>\u274c 请求失败: ' + this._escape(e.message) + '</strong><br><span style="font-size:12px;margin-top:8px;display:block;">\u8bf7\u68c0\u67e5\u540e\u7aef\u670d\u52a1\u548c Ollama \u662f\u5426\u8fd0\u884c</span>';
            errEl.style.display = 'block';
            document.getElementById('ssBtnRetry').style.display = 'inline-block';
        }
    },

    async _confirmSSImport(continueMode) {
        var content = document.getElementById('ssContent').value.trim();
        if (!content) { this.showToast('请输入提示词内容', 'error'); return; }

        var tags = document.getElementById('ssTags').value.trim();
        try { tags = JSON.parse(tags || '[]'); } catch(e) { tags = []; }
        if (!Array.isArray(tags)) tags = [];

        var data = {
            content: content,
            meaning: document.getElementById('ssMeaning').value.trim(),
            scene: document.getElementById('ssScene').value.trim(),
            module: document.getElementById('ssModule').value,
            category: document.getElementById('ssCategory').value.trim() || 'OCR导入',
            tags: tags,
            tips: document.getElementById('ssTips').value.trim(),
            temp_image: this._ssTempImage || '',
            has_image: this._ssHasImage
        };

        this.showToast('\u23f3 正在导入...', 'info');
        var result = await this.fetchJSON('/api/v2/ocr/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (result && result.ok) {
            this.showToast(result.message || '\u2714 已导入', 'success');
            // 先关弹窗，再刷新数据（防止 loadPrompts 异常阻塞关闭）
            if (continueMode) {
                this._ssTempImage = '';
                this._ssHasImage = false;
                document.getElementById('ssUploadArea').style.display = 'block';
                document.getElementById('ssPreviewArea').style.display = 'none';
                document.getElementById('ssBtnImport').style.display = 'none';
                document.getElementById('ssBtnContinue').style.display = 'none';
                document.getElementById('ssFileInput').value = '';
            } else {
                document.getElementById('modalScreenshotImport').style.display = 'none';
            }
            await this.loadPrompts();
            this.loadStats();
        } else {
            this.showToast('导入失败: ' + (result ? result.error : '未知错误'), 'error');
        }
    },

    _retrySSUpload() {
        document.getElementById('ssFileInput').click();
    },

        // 从剪贴板粘贴截图图片
    // navigator.clipboard.read() 只在 HTTPS/localhost 工作，
    // 激活粘贴监听器（弹窗打开时自动激活，Ctrl+V 直接走分析流程）
    // 局域网 HTTP 下 navigator.clipboard.read() 不可用，必须用 paste 事件
    _activatePasteListener() {
        var self = this;

        // 清理旧监听器
        var old = document.getElementById('ssPasteHelper');
        if (old) old.remove();
        if (this._ssPasteHandler) {
            document.removeEventListener('keydown', this._ssPasteHandler);
            this._ssPasteHandler = null;
        }

        // 创建隐藏 textarea 用于捕获 paste 事件
        var ta = document.createElement('textarea');
        ta.id = 'ssPasteHelper';
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();

        function cleanup() {
            var el = document.getElementById('ssPasteHelper');
            if (el) el.remove();
        }

        // 监听 paste 事件
        ta.addEventListener('paste', function(e) {
            e.preventDefault();
            self._handleClipboardPaste(e);
        });

        // 全局键盘监听：Ctrl+V 时截取剪贴板数据
        this._ssPasteHandler = function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                var modal = document.getElementById('modalScreenshotImport');
                if (!modal || modal.style.display === 'none') return;
                // 截取 clipboardData 传入处理函数
                var cd = e.clipboardData || window.clipboardData;
                setTimeout(function() {
                    self._handleClipboardPaste({clipboardData: cd});
                }, 10);
            }
        };
        document.addEventListener('keydown', this._ssPasteHandler);

        // 弹窗关闭时自动清理监听器
        var modal = document.getElementById('modalScreenshotImport');
        var observer = new MutationObserver(function() {
            if (modal.style.display === 'none') {
                cleanup();
                if (self._ssPasteHandler) {
                    document.removeEventListener('keydown', self._ssPasteHandler);
                    self._ssPasteHandler = null;
                }
                observer.disconnect();
            }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
    },

    // 处理剪贴板粘贴：提取图片 -> 显示预览 -> 确认后再分析
    _handleClipboardPaste(e) {
        var self = this;
        var items = e.clipboardData && e.clipboardData.items;
        if (!items || items.length === 0) {
            self.showToast('剪贴板中未找到图片', 'warning');
            return;
        }

        // 提取图片 blob 的函数
        function showPastePreview(blob) {
            var file = new File([blob], 'clipboard_' + Date.now() + '.png', { type: blob.type });
            // 存为临时文件，等确认后再分析
            self._ssPasteFile = file;
            // 显示预览
            document.getElementById('ssUploadArea').style.display = 'none';
            var thumb = document.getElementById('ssPasteThumb');
            var url = URL.createObjectURL(blob);
            thumb.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:200px;object-fit:contain;border-radius:8px;">';
            document.getElementById('ssPastePreview').style.display = 'block';
            self.showToast('已粘贴截图，点击确认后开始分析', 'info', 2000);
        }

        // 尝试提取图片
        for (var i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.startsWith('image/')) {
                var blob = items[i].getAsFile ? items[i].getAsFile() : null;
                if (blob) { showPastePreview(blob); return; }
            }
        }

        // 没有直接图片，检查 text/html 中是否有 base64 图片（微信截图）
        for (var i = 0; i < items.length; i++) {
            if (items[i].type === 'text/html') {
                items[i].getAsString(function(html) {
                    var m = html.match(/<img[^>]+src=["']?(data:image\/[^"'>]+)["']?/i);
                    if (m) {
                        fetch(m[1]).then(function(r) { return r.blob(); }).then(function(blob) {
                            showPastePreview(blob);
                        }).catch(function() {
                            self.showToast('解析剪贴板图片失败', 'error');
                        });
                    } else {
                        self.showToast('剪贴板中未找到图片，请先截图再按 Ctrl+V', 'warning', 3000);
                    }
                });
                return;
            }
        }

        self.showToast('剪贴板中未找到图片，请先截图再按 Ctrl+V', 'warning', 3000);
    },

    // 确认粘贴图片：开始分析
    _confirmSSPaste() {
        if (this._ssPasteFile) {
            document.getElementById('ssPastePreview').style.display = 'none';
            this._processSSFile(this._ssPasteFile);
        }
    },

    // 取消粘贴图片：返回上传区
    _cancelSSPaste() {
        this._ssPasteFile = null;
        document.getElementById('ssPastePreview').style.display = 'none';
        document.getElementById('ssUploadArea').style.display = 'block';
    },

    // 粘贴按钮点击：重新聚焦 + 提示用户按 Ctrl+V
    async _onSSPaste() {
        var self = this;
        var ta = document.getElementById('ssPasteHelper');
        if (!ta) {
            this._activatePasteListener();
            ta = document.getElementById('ssPasteHelper');
        }
        if (ta) {
            ta.focus();
            ta.select();
        }
        self.showToast('请按 Ctrl+V 粘贴截图', 'info', 3000);
    },switchIETab(tab) {
        document.getElementById('ieTabImport').className = tab === 'import' ? 'seedance-tab active' : 'seedance-tab';
        document.getElementById('ieTabExport').className = tab === 'export' ? 'seedance-tab active' : 'seedance-tab';
        document.getElementById('ieImportPanel').style.display = tab === 'import' ? 'block' : 'none';
        document.getElementById('ieExportPanel').style.display = tab === 'export' ? 'block' : 'none';
        document.getElementById('modalIETitle').textContent = tab === 'import' ? '导入提示词' : '导出提示词';
    },

    _updateExportBtn() {
        var scope = document.getElementById('ieExportScope').value;
        var moduleArea = document.getElementById('ieModuleSelectArea');
        if (moduleArea) {
            moduleArea.style.display = scope === 'module' ? 'block' : 'none';
            if (scope === 'module' && this.state.modules) {
                // 渲染模块多选复选框
                var cbContainer = document.getElementById('ieModuleCheckboxes');
                if (cbContainer) {
                    var ch = '';
                    for (var mi = 0; mi < this.state.modules.length; mi++) {
                        var m = this.state.modules[mi];
                        ch += '<label style="font-size:12px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;">' +
                            '<input type="checkbox" value="' + m.id + '" checked> ' + m.name +
                            '</label>';
                    }
                    cbContainer.innerHTML = ch;
                }
            }
        }
    },

    async doImport() {
        var files = document.getElementById('ieFileInput').files;
        if (!files || files.length === 0) { this.showToast('请先选择文件', 'error'); return; }
        var conflict = document.getElementById('ieConflictSelect').value;
        var btn = document.getElementById('btnDoImport');
        btn.disabled = true; btn.textContent = '正在导入...';
        var created = 0, skipped = 0, failed = 0;
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var formData = new FormData();
            formData.append('file', file);
            try {
                var name = file.name.toLowerCase();
                var endpoint;
                if (name.endsWith('.json')) {
                    endpoint = '/api/export/import-json';
                } else if (name.endsWith('.pt')) {
                    endpoint = '/api/v2/pt/import';
                } else {
                    endpoint = '/api/export/import-png';
                }
                formData.append('conflict', conflict);
                var resp = await fetch(endpoint, { method: 'POST', body: formData });
                var data = await resp.json();
                if (data.ok) {
                    if (data.result && data.result.created) created++;
                    else if (data.result && data.result.reason === 'skip') skipped++;
                    else if (data.created) created += data.created;
                    else if (data.skipped) skipped += data.skipped;
                    else if (data.created === 0 && data.total > 0) skipped++;
                    else failed++;
                } else failed++;
            } catch(e) { failed++; }
        }
        btn.disabled = false; btn.textContent = '开始导入';
        var el = document.getElementById('ieImportResult');
        el.style.display = 'block';
        el.style.color = failed > 0 ? '#ef4444' : '#059669';
        el.innerHTML = '导入完成: ' + created + ' 成功, ' + skipped + ' 跳过, ' + failed + ' 失败';
        if (created > 0) await this.loadPrompts();
    },

    async doExport() {
        var fmt = document.querySelector('input[name="exportFmt"]:checked');
        fmt = fmt ? fmt.value : 'png';
        var scope = document.getElementById('ieExportScope').value;
        var btn = document.getElementById('btnDoExport');
        btn.disabled = true; btn.textContent = '正在导出...';
        var ids = [];
        if (scope === 'selected') {
            ids = [...this.state.batchSelected];
            if (ids.length === 0) { this.showToast('请先选择词条', 'error'); btn.disabled = false; btn.textContent = '导出'; return; }
        } else if (scope === 'collection-item' && this.state.currentCollection) {
            ids = (this.state.collectionItems || []).map(function(p) { return p.id; });
        } else if (scope === 'all') {
            var allData = await this.fetchJSON('/api/prompts?page_size=500');
            if (allData && allData.items) ids = allData.items.map(function(p) { return p.id; });
        } else if (scope === 'module') {
            // 按模块导出：收集所有选中模块的 ids
            var modCbs = document.querySelectorAll('#ieModuleCheckboxes input[type="checkbox"]:checked');
            var mods = [];
            for (var mi = 0; mi < modCbs.length; mi++) mods.push(modCbs[mi].value);
            if (mods.length === 0) { this.showToast('请选择至少一个模块', 'error'); btn.disabled = false; btn.textContent = '导出'; return; }
            var allData = await this.fetchJSON('/api/prompts?page_size=500');
            if (allData && allData.items) {
                ids = allData.items.filter(function(p) { return mods.indexOf(p.module) >= 0; }).map(function(p) { return p.id; });
            }
        }
        if (ids.length === 0) { this.showToast('没有可导出的词条', 'error'); btn.disabled = false; btn.textContent = '导出'; return; }
        try {
            if (fmt === 'png') {
                if (ids.length === 1) {
                    var resp = await fetch('/api/export/prompt-to-png/' + ids[0]);
                    var blob = await resp.blob();
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a'); a.href = url; a.download = 'prompt_' + ids[0] + '.png'; a.click();
                    URL.revokeObjectURL(url);
                } else {
                    var resp = await fetch('/api/export/batch-to-png', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt_ids: ids })
                    });
                    var blob = await resp.blob();
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a'); a.href = url; a.download = 'prompt_cards_' + new Date().toISOString().slice(0,10) + '.zip'; a.click();
                    URL.revokeObjectURL(url);
                }
            } else {
                var resp = await fetch('/api/v2/batch/export', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt_ids: ids, format: fmt })
                });
                var blob = await resp.blob();
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a'); a.href = url;
                // 取第一条提示词内容做文件名
                var firstItem = null;
                if (this.state.prompts) firstItem = this.state.prompts.find(function(p) { return p.id === (ids[0] || 0); });
                a.download = this._makeExportFilename(firstItem ? [firstItem] : [], fmt);
                a.click();
                URL.revokeObjectURL(url);
            }
            document.getElementById('ieExportResult').style.display = 'block';
            document.getElementById('ieExportResult').style.color = '#059669';
            document.getElementById('ieExportResult').innerHTML = '导出成功，' + ids.length + ' 条词条已下载';
        } catch(e) {
            document.getElementById('ieExportResult').style.display = 'block';
            document.getElementById('ieExportResult').style.color = '#ef4444';
            document.getElementById('ieExportResult').innerHTML = '导出失败: ' + e.message;
        }
        btn.disabled = false; btn.textContent = '导出';
    },

    async doAddToWordpack(wpId, wpName) {
        const ids = [...this.state.batchSelected];
        const data = await this.fetchJSON(`/api/v2/wordpacks/${wpId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        document.getElementById('modalAddToWordpack').style.display = 'none';
        if (data) {
            this.showToast(`已添加 ${data.added} 条到「${wpName}」`, 'success');
            this.toggleEditMode();
            this.loadWordpacks();
        }
    },

    // ============ 标签自动补全 ============

    _onTagInput() {
        var inp = document.getElementById('editTags');
        var sug = document.getElementById('tagSuggestions');
        if (!inp || !sug || !this._allTags) return;
        var val = inp.value;
        var cp = inp.selectionStart || 0;
        var bef = val.substring(0, cp);
        var lq = bef.lastIndexOf('"');
        var cur = lq >= 0 ? bef.substring(lq + 1) : val;
        cur = cur.replace(/[\[\],\s"]/g, '');
        if (!cur) { sug.style.display = 'none'; return; }
        var ms = this._allTags.filter(function(t) {
            return t.toLowerCase().indexOf(cur.toLowerCase()) >= 0;
        });
        if (ms.length === 0) { sug.style.display = 'none'; return; }
        var h = '';
        for (var i = 0; i < Math.min(ms.length, 8); i++) {
            var tag = ms[i];
            h += '<div class="tag-sug-item" onmousedown="App._pickTag(\'' + tag.replace(/'/g, "\\'") + '\')">' + this._escape(tag) + '</div>';
        }
        sug.innerHTML = h;
        sug.style.display = 'block';
    },

    _pickTag(tag) {
        var inp = document.getElementById('editTags');
        if (!inp) return;
        try {
            var arr = JSON.parse(inp.value || '[]');
            if (!Array.isArray(arr)) arr = [];
            if (arr.indexOf(tag) < 0) arr.push(tag);
            inp.value = JSON.stringify(arr);
        } catch(e) {
            var cur = inp.value.trim();
            inp.value = cur ? cur + ',"' + tag + '"' : '["' + tag + '"]';
        }
        var sug = document.getElementById('tagSuggestions');
        if (sug) sug.style.display = 'none';
        inp.focus();
    },

    async batchTag() {
        var ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先选择词条', 'error'); return; }
        var tags = prompt('输入标签（多个用逗号分隔）:\n例如: 自然,温暖,户外');
        if (!tags) return;
        var list = tags.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; });
        if (list.length === 0) return;
        var mode = confirm('确定添加标签？\n\n取消 = 移除这些标签') ? 'add' : 'remove';
        var data = await this.fetchJSON('/api/v2/tags/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids, tags: list, mode: mode })
        });
        if (data && data.ok) {
            this.showToast('已' + (mode === 'add' ? '添加' : '移除') + ' ' + data.updated + ' 条词条的标签', 'success');
            this.loadPrompts();
        } else {
            this.showToast('操作失败', 'error');
        }
    },


});
})();
