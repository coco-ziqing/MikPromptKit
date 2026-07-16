/**
 * app_import_export.js — 导入导出模块（从 app_tools.js 拆出）
 * 职责：拖拽导入、JSON/PNG/.pt 导入预览、导出弹窗、批量导出
 * T5: 使用 PK 底座（PK.api / PK.toast / PK._esc）
 */
(function() {
'use strict';
if (!App || App.showImportModal) return; // 已加载

Object.assign(App, {

// ============ 拖拽导入 ============
async handleDropPngFile(file) {
    try {
        var buf = await file.arrayBuffer();
        var formData = new FormData();
        formData.append('file', new Blob([buf]));
        var resp = await fetch('/api/export/preview-png', { method: 'POST', body: formData });
        var data = await resp.json();
        if (!data || !data.items || data.items.length === 0) {
            PK.toast('该 PNG 不包含有效的提示词数据', 'error');
            return;
        }
        this._showImportPreview(data.items);
        this.showImportModal();
    } catch (e) {
        PK.toast('PNG 解析失败: ' + e.message, 'error');
    }
},

async _handleDropFile(file) {
    var text = await file.text();
    try {
        var data = JSON.parse(text);
        var items = data.items || data.prompts || data;
        if (!Array.isArray(items)) items = [items];
        if (items.length === 0) { PK.toast('未找到有效的提示词条目', 'error'); return; }
        this._showImportPreview(items);
        this.showImportModal();
    } catch (e) {
        PK.toast('JSON 解析失败: ' + e.message, 'error');
    }
},

_showImportPreview(items) {
    this._importPreviewItems = items || [];
    this._renderDiItems(items);
},

// ============ 导入预览渲染（JSON / .pt / PNG 共用） ============
_renderDiItems(items) {
    var container = document.getElementById('diItemList');
    if (!container) return;
    var allSelected = true;
    var html = '<div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;">';
    html += '<label><input type="checkbox" id="diSelectAll" checked onchange="App._toggleDiSelectAll()"> 全选/取消</label>';
    html += '<span id="diCount" style="font-size:12px;color:var(--text-muted);"></span></div>';
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var content = it.content || '';
        var module = it.module || '';
        var category = it.category || '';
        var subcategory = it.subcategory || '';
        html += '<div class="di-item" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;margin-bottom:4px;">';
        html += '<input type="checkbox" class="di-cb" checked data-idx="' + i + '" onchange="App._updateDiCount()">';
        html += '<div style="flex:1;min-width:0;font-size:12px;">';
        html += '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + PK._esc(content.substring(0,120)) + '</div>';
        html += '<div style="font-size:10px;color:var(--text-muted);">' + PK._esc(module) + ' › ' + PK._esc(category) + (subcategory ? ' › ' + PK._esc(subcategory) : '') + '</div>';
        html += '</div></div>';
    }
    container.innerHTML = html;
    this._updateDiCount();
},

_updateDiCount() {
    var cbs = document.querySelectorAll('.di-cb:checked');
    var el = document.getElementById('diCount');
    if (el) el.textContent = '已选 ' + cbs.length + ' / ' + document.querySelectorAll('.di-cb').length + ' 条';
},

_toggleDiSelectAll() {
    var sel = document.getElementById('diSelectAll');
    document.querySelectorAll('.di-cb').forEach(function(cb) { cb.checked = sel.checked; });
    this._updateDiCount();
},

async _confirmDropImport() {
    var cbs = document.querySelectorAll('.di-cb:checked');
    if (cbs.length === 0) { PK.toast('请至少选择一条提示词', 'error'); return; }
    var items = [];
    cbs.forEach(function(cb) { var idx = parseInt(cb.getAttribute('data-idx')); if (!isNaN(idx)) items.push(App._importPreviewItems[idx]); });
    var data = JSON.stringify({ items: items, module: (document.getElementById('editModule') ? document.getElementById('editModule').value : '') });
    try {
        var d = await PK.api('/api/v2/import/from-json-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data });
        PK.toast('导入完成: ' + d.created + ' 成功' + (d.skipped ? ', ' + d.skipped + ' 跳过' : '') + (d.failed ? ', ' + d.failed + ' 失败' : ''), d.created > 0 ? 'success' : 'warning');
        document.getElementById('modalImportExport').style.display = 'none';
        if (App.loadGroupTree) App.loadGroupTree();
        if (this.state.currentView === 'home') this.renderPrompts();
    } catch (e) {
        PK.toast('导入失败: ' + (e.detail || e.message), 'error');
    }
},

// ============ .pt 包拖拽导入 ============
async _handleDropPtFile(file) {
    var formData = new FormData();
    formData.append('file', file);
    try {
        var resp = await fetch('/api/v2/pt/preview', { method: 'POST', body: formData });
        var d = await resp.json();
        if (d && d.items && d.items.length > 0) {
            this._showImportPreview(d.items);
            this.showImportModal();
        } else {
            PK.toast('未找到有效的提示词数据', 'error');
        }
    } catch (e) {
        PK.toast('预览失败: ' + e.message, 'error');
    }
},

// ============ 导出 / 导入弹窗 ============
showImportModal() {
    document.getElementById('modalImportExport').style.display = 'flex';
    this.switchIETab('import');
},

showExportModal() {
    document.getElementById('modalImportExport').style.display = 'flex';
    this.switchIETab('export');
},

switchIETab(tab) {
    document.querySelectorAll('.ie-tab-content').forEach(function(el) { el.style.display = 'none'; });
    document.querySelectorAll('.ie-tab-btn').forEach(function(el) { el.classList.remove('active'); });
    var tc = document.getElementById('ieTab' + tab);
    if (tc) { tc.style.display = 'block'; }
    var tb = document.querySelector('.ie-tab-btn[data-tab="' + tab + '"]');
    if (tb) tb.classList.add('active');
    if (tab === 'export') this._refreshExportPreview();
},

async _refreshExportPreview() {
    var ids = this._epItems ? this._epItems.map(function(p) { return p.id; }) : [];
    var selectedIds = [...this.state.batchSelected];
    if (selectedIds.length > 0) ids = selectedIds;
    if (ids.length === 0) {
        // try all visible
        var cards = document.querySelectorAll('#promptList .prompt-card');
        var el = document.getElementById('exportPreviewList');
        if (el) { el.innerHTML = '<div style="padding:12px;color:var(--text-muted);">请先选择要导出的词条</div>'; }
        return;
    }
    this._epItems = ids.map(function(id) { return { id: id }; });
    this._renderExportPreviewList(ids);
},

_renderExportPreviewList(ids) {
    var el = document.getElementById('exportPreviewList');
    if (!el) return;
    el.innerHTML = '<div style="padding:12px;color:var(--text-muted);">共 ' + ids.length + ' 条待导出</div>';
},

async doExport() {
    var fmt = document.querySelector('input[name="exportFmt"]:checked');
    fmt = fmt ? fmt.value : 'png';
    var ids = this._epItems ? this._epItems.map(function(p) { return p.id; }) : [];
    if (ids.length === 0) { PK.toast('没有可导出的词条', 'error'); return; }
    this._exportQueue = { ids: ids, fmt: fmt };
    this._showExportNameDialog(ids, fmt);
},

async batchExport(fmt) {
    var ids = [...this.state.batchSelected];
    if (ids.length === 0) { PK.toast('请先选择词条', 'error'); return; }
    this._exportQueue = { ids: ids, fmt: fmt };
    this._showExportNameDialog(ids, fmt);
},

// ============ 导出命名弹窗 ============
_showExportNameDialog(ids, fmt) {
    var fmtNames = { pt: '.pt 提示词包', png: '导出 PNG 卡片' };
    document.getElementById('exportNameTitle').textContent = '导出 ' + (fmtNames[fmt] || fmt.toUpperCase());
    document.getElementById('exportNameInput').value = '提示词导出_' + new Date().toISOString().slice(0,10);
    document.getElementById('exportNameCount').textContent = '共 ' + ids.length + ' 条 · 格式: ' + (fmt === 'pt' ? '.pt 压缩包' : 'PNG 图片');
    var savedPath = localStorage.getItem('promptkit_export_path') || '';
    document.getElementById('exportNameDialog').style.display = 'block';
},

async _confirmBatchExport() {
    if (!this._exportQueue) return;
    var ids = this._exportQueue.ids;
    var fmt = this._exportQueue.fmt;
    if (fmt === 'pt') {
        try {
            var r = await PK.api('/api/v2/pt/export', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ids: ids, name: 'export' }) });
            PK.toast('导出成功 (' + ids.length + ' 条)', 'success');
        } catch (e) {
            PK.toast('导出失败: ' + (e.detail || e.message), 'error');
        }
    } else {
        // PNG single export
        var saved = 0;
        for (var i = 0; i < ids.length; i++) {
            try {
                var pr = await fetch('/api/export/prompt-to-png/' + ids[i]);
                if (pr.ok) saved++;
            } catch (e) { console.warn('PNG export failed for #' + ids[i], e); }
        }
        PK.toast('导出成功 (' + saved + '/' + ids.length + ' 张 PNG)', 'success');
    }
    document.getElementById('exportNameDialog').style.display = 'none';
    this._exportQueue = null;
},

async openScreenshotImport() {
    this._ssTempImage = '';
    document.getElementById('ssImportText').value = '';
    document.getElementById('ssImportResult').innerHTML = '';
    document.getElementById('ssConfirmImportBtn').style.display = 'none';
    document.getElementById('modalScreenshotImport').style.display = 'block';
},

async batchCopy() {
    var ids = [...this.state.batchSelected];
    if (ids.length === 0) { PK.toast('请先选择词条', 'error'); return; }
    var texts = [];
    for (var i = 0; i < ids.length; i++) {
        var card = document.querySelector('#promptList .prompt-card[data-id="' + ids[i] + '"]');
        if (card) texts.push(card.getAttribute('data-content') || '');
    }
    var text = texts.join('\n\n---\n\n');
    try {
        await navigator.clipboard.writeText(text);
        PK.toast('已复制 ' + ids.length + ' 条', 'success');
    } catch (e) {
        PK.toast('复制失败: ' + e.message, 'error');
    }
},

async batchAddToWordpack() {
    var ids = [...this.state.batchSelected];
    if (ids.length === 0) { PK.toast('请先选择词条', 'error'); return; }
    if (!this.state.wordpacks || this.state.wordpacks.length === 0) { PK.toast('请先创建词包', 'error'); return; }
    PK.toast('批量加入词包功能开发中...', 'info');
},

_populateModuleOptions(selectedVal) {
    var select = document.getElementById('editModule');
    var modules = this.state.modules || [];
    if (!select) return;
    select.innerHTML = '<option value="">自动检测模块</option>';
    for (var i = 0; i < modules.length; i++) {
        var m = modules[i];
        if (m.id === 'custom' || m.id === 'seedance') continue;
        var opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        if (m.id === selectedVal) opt.selected = true;
        select.appendChild(opt);
    }
},

}); // end Object.assign
console.log('[PK] app_import_export loaded');
})();
