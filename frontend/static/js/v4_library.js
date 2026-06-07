// ================================================================
// v4 词库 + 媒体资产管理面板 — Phase 2 增强版
// 独立模块，在 app.js 加载后执行
// ================================================================
(function() {
    'use strict';
    if (!App) return;

    // ==================== 词库资产列表 ====================
    App.loadV4Library = async function() {
        var listEl = document.getElementById('v4libList');
        if (!listEl) return;
        var search = (document.getElementById('v4libSearch')?.value || '').trim();
        var typeFilter = document.getElementById('v4libTypeFilter')?.value || '';
        var url = '/api/v4/library';
        var params = [];
        if (typeFilter) params.push('lib_type=' + encodeURIComponent(typeFilter));
        if (search) params.push('search=' + encodeURIComponent(search));
        if (params.length) url += '?' + params.join('&');

        listEl.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary" role="status"></div></div>';
        try {
            var resp = await App.fetchJSON(url);
            if (!resp || !resp.items) { listEl.innerHTML = '<div class="empty-state"><p>加载失败</p></div>'; return; }
            App._populateV4LibTypes();
            App._updateV4LibStats();
            if (!resp.items.length) {
                listEl.innerHTML = '<div class="empty-state"><div class="icon">📦</div><p>暂无词条</p></div>';
                return;
            }
            var h = '';
            for (var i = 0; i < resp.items.length; i++) {
                var it = resp.items[i];
                var icon = it.icon || '📄';
                var typeLabel = { style: '🎨画风', negative: '🚫负面', camera: '🎬镜头', subject: '🧑主体', scene: '🌄场景', custom: '🔧自定义' }[it.lib_type] || it.lib_type;
                var preview = (it.prompt || '').length > 80 ? (it.prompt || '').substring(0, 80) + '...' : (it.prompt || '');
                h += '<div class="v4lib-card" style="border:1px solid var(--border-color);border-radius:8px;padding:12px;background:var(--bg-card,#fff);" data-prompt="' + App._escape(it.prompt || '') + '">';
                h += '  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">';
                h += '    <div><strong>' + icon + ' ' + App._escape(it.name) + '</strong> <span style="font-size:11px;color:#94a3b8;">(' + typeLabel + ')</span></div>';
                h += '    <div style="display:flex;gap:4px;">';
                h += '      <button class="btn btn-xs btn-outline" onclick="App.editV4LibItem(' + it.id + ')" title="编辑">✏️</button>';
                h += '      <button class="btn btn-xs btn-outline" onclick="App.deleteV4LibItem(' + it.id + ')" title="删除">🗑</button>';
                h += '      <button class="btn btn-xs btn-outline" onclick="App.copyV4LibPrompt(' + it.id + ')" title="复制提示词">📋</button>';
                h += '    </div></div>';
                if (it.category) h += '  <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">' + App._escape(it.category) + '</div>';
                h += '  <div style="font-size:12px;color:var(--text-main);line-height:1.4;">' + App._escape(preview) + '</div>';
                h += '</div>';
            }
            listEl.innerHTML = h;
        } catch (e) {
            listEl.innerHTML = '<div class="empty-state"><p>加载失败: ' + App._escape(e.message) + '</p></div>';
        }
    };

    App._populateV4LibTypes = async function() {
        var sel = document.getElementById('v4libTypeFilter');
        if (!sel) return;
        try {
            var resp = await App.fetchJSON('/api/v4/library/types');
            if (!resp || !resp.types) return;
            var v = sel.value;
            sel.innerHTML = '<option value="">全部类型</option>';
            for (var i = 0; i < resp.types.length; i++) {
                var t = resp.types[i];
                var label = { style: '🎨画风', negative: '🚫负面', camera: '🎬镜头', subject: '🧑主体', scene: '🌄场景', custom: '🔧自定义' }[t.lib_type] || t.lib_type;
                sel.innerHTML += '<option value="' + t.lib_type + '">' + label + ' (' + t.cnt + ')</option>';
            }
            sel.value = v;
        } catch (e) {}
    };

    App._updateV4LibStats = async function() {
        var el = document.getElementById('v4libStats');
        if (!el) return;
        try {
            var resp = await App.fetchJSON('/api/v4/library/types');
            if (!resp || !resp.types) return;
            var h = '';
            for (var i = 0; i < resp.types.length; i++) {
                var t = resp.types[i];
                var label = { style: '🎨画风', negative: '🚫负面', camera: '🎬镜头', subject: '🧑主体', scene: '🌄场景', custom: '🔧自定义' }[t.lib_type] || t.lib_type;
                h += '<div style="padding:6px 12px;border:1px solid var(--border-color);border-radius:6px;font-size:12px;background:var(--bg-card,#fff);">' + label + ' <strong>' + t.cnt + '</strong></div>';
            }
            el.innerHTML = h;
        } catch (e) {}
    };

    App.showV4LibCreateModal = function() {
        document.getElementById('v4libEditId').value = '';
        document.getElementById('v4libModalTitle').textContent = '新建词条';
        document.getElementById('v4libFormType').value = 'style';
        document.getElementById('v4libFormCategory').value = '';
        document.getElementById('v4libFormName').value = '';
        document.getElementById('v4libFormPrompt').value = '';
        document.getElementById('v4libFormIcon').value = '';
        document.getElementById('modalV4Lib').style.display = 'flex';
    };

    App.editV4LibItem = async function(id) {
        try {
            var resp = await App.fetchJSON('/api/v4/library/' + id);
            if (!resp || !resp.item) { App.showToast('未找到词条', 'error'); return; }
            var item = resp.item;
            document.getElementById('v4libEditId').value = id;
            document.getElementById('v4libModalTitle').textContent = '编辑词条';
            document.getElementById('v4libFormType').value = item.lib_type;
            document.getElementById('v4libFormCategory').value = item.category || '';
            document.getElementById('v4libFormName').value = item.name;
            document.getElementById('v4libFormPrompt').value = item.prompt || '';
            document.getElementById('v4libFormIcon').value = item.icon || '';
            document.getElementById('modalV4Lib').style.display = 'flex';
        } catch (e) {
            App.showToast('加载失败: ' + e.message, 'error');
        }
    };

    App.saveV4LibItem = async function() {
        var id = document.getElementById('v4libEditId').value;
        var data = {
            lib_type: document.getElementById('v4libFormType').value,
            category: document.getElementById('v4libFormCategory').value.trim(),
            name: document.getElementById('v4libFormName').value.trim(),
            prompt: document.getElementById('v4libFormPrompt').value.trim(),
            icon: document.getElementById('v4libFormIcon').value.trim()
        };
        if (!data.name) { App.showToast('请输入名称', 'warning'); return; }
        try {
            var resp = await App.fetchJSON('/api/v4/library' + (id ? '/' + id : ''), {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (resp && resp.ok) {
                App.showToast(id ? '已更新' : '已创建', 'success');
                document.getElementById('modalV4Lib').style.display = 'none';
                App.loadV4Library();
            } else {
                App.showToast('保存失败', 'error');
            }
        } catch (e) {
            App.showToast('保存失败: ' + e.message, 'error');
        }
    };

    App.deleteV4LibItem = async function(id) {
        if (!confirm('确定删除此词条？')) return;
        try {
            var resp = await App.fetchJSON('/api/v4/library/' + id, { method: 'DELETE' });
            if (resp && resp.ok) {
                App.showToast('已删除', 'info');
                App.loadV4Library();
            }
        } catch (e) {
            App.showToast('删除失败', 'error');
        }
    };

    App.copyV4LibPrompt = function(id) {
        var cards = document.querySelectorAll('.v4lib-card');
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].querySelector('button[onclick*="copyV4LibPrompt(' + id + ')"]')) {
                var text = cards[i].dataset.prompt || '';
                if (text) {
                    navigator.clipboard.writeText(text).then(function() {
                        App.showToast('提示词已复制', 'success');
                    }).catch(function() {
                        var ta = document.createElement('textarea');
                        ta.value = text;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        App.showToast('提示词已复制', 'success');
                    });
                    return;
                }
            }
        }
        App.showToast('未找到提示词', 'warning');
    };

    // ==================== 媒体资产管理 ====================
    App._v4MediaPage = 1;
    App.loadV4Media = async function() {
        var listEl = document.getElementById('v4mediaList');
        if (!listEl) return;
        var typeFilter = document.getElementById('v4mediaTypeFilter')?.value || '';
        var url = '/api/v4/media?page=' + App._v4MediaPage + '&page_size=50';
        if (typeFilter) url += '&media_type=' + encodeURIComponent(typeFilter);

        listEl.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary" role="status"></div></div>';
        try {
            var resp = await App.fetchJSON(url);
            if (!resp || !resp.items) { listEl.innerHTML = '<div class="empty-state"><p>加载失败</p></div>'; return; }
            var countEl = document.getElementById('v4mediaCount');
            if (countEl) countEl.textContent = '共 ' + resp.total + ' 个文件';

            if (!resp.items.length) {
                listEl.innerHTML = '<div class="empty-state"><div class="icon">🖼️</div><p>暂无媒体文件</p></div>';
                return;
            }
            var h = '';
            for (var i = 0; i < resp.items.length; i++) {
                var m = resp.items[i];
                var url_preview = m.media_type === 'image' ? '/api/thumbnails/file/' + m.filename
                    : m.media_type === 'video' ? '/api/thumbnails/video/' + m.filename : '';
                h += '<div class="v4media-card" style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;background:var(--bg-card,#fff);">';
                if (url_preview) {
                    if (m.media_type === 'image') {
                        h += '<div style="height:120px;overflow:hidden;background:#f1f5f9;"><img src="' + url_preview + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.parentElement.innerHTML=\'<div style=padding:40px;text-align:center;color:#94a3b8;font-size:12px;>❌</div>\'"></div>';
                    } else {
                        h += '<div style="height:120px;overflow:hidden;background:#1e293b;display:flex;align-items:center;justify-content:center;"><video src="' + url_preview + '" style="max-width:100%;max-height:100%;" muted loop preload="metadata"></video><div style="position:absolute;bottom:4px;right:4px;font-size:10px;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:4px;">🎬</div></div>';
                    }
                } else {
                    h += '<div style="height:120px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:24px;">🎵</div>';
                }
                h += '<div style="padding:8px;font-size:11px;">';
                h += '  <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + App._escape(m.original_filename || m.filename) + '</div>';
                h += '  <div style="color:#94a3b8;">' + (m.media_type || 'unknown') + (m.file_size ? ' · ' + Math.round(m.file_size / 1024) + 'KB' : '') + '</div>';
                h += '</div></div>';
            }
            listEl.innerHTML = h;

            // 分页
            var pg = document.getElementById('v4mediaPagination');
            if (pg) {
                var totalPages = Math.ceil(resp.total / 50);
                if (totalPages > 1) {
                    pg.innerHTML = '<div style="display:flex;gap:6px;justify-content:center;margin-top:12px;">';
                    if (App._v4MediaPage > 1) pg.innerHTML += '<button class="btn btn-xs btn-outline" onclick="App._v4MediaPage=' + (App._v4MediaPage - 1) + ';App.loadV4Media()">上一页</button>';
                    pg.innerHTML += '<span style="font-size:12px;padding:4px 8px;">' + App._v4MediaPage + '/' + totalPages + '</span>';
                    if (App._v4MediaPage < totalPages) pg.innerHTML += '<button class="btn btn-xs btn-outline" onclick="App._v4MediaPage=' + (App._v4MediaPage + 1) + ';App.loadV4Media()">下一页</button>';
                    pg.innerHTML += '</div>';
                } else {
                    pg.innerHTML = '';
                }
            }

            // 悬停播放视频
            listEl.querySelectorAll('video').forEach(function(v) {
                v.addEventListener('mouseenter', function() { this.play().catch(function() {}); });
                v.addEventListener('mouseleave', function() { this.pause(); this.currentTime = 0; });
            });
        } catch (e) {
            listEl.innerHTML = '<div class="empty-state"><p>加载失败: ' + App._escape(e.message) + '</p></div>';
        }
    };

    // ==================== 词库批量导入 ====================
    App.v4BatchImport = function() {
        var jsonStr = prompt('粘贴 JSON 数组格式的词条数据:\n[{"lib_type":"style","name":"...","prompt":"...","category":"...",...}]');
        if (!jsonStr) return;
        try {
            var items = JSON.parse(jsonStr);
            if (!Array.isArray(items) || !items.length) { App.showToast('无效的 JSON 数组', 'error'); return; }
            App.fetchJSON('/api/v4/library/batch-import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: items })
            }).then(function(resp) {
                if (resp && resp.ok) {
                    App.showToast('成功导入 ' + resp.imported + ' 条', 'success');
                    App.loadV4Library();
                } else {
                    App.showToast('导入失败', 'error');
                }
            });
        } catch (e) {
            App.showToast('JSON 解析失败: ' + e.message, 'error');
        }
    };

    // ==================== 词库导出 ====================
    App.v4ExportLibrary = async function() {
        var typeFilter = document.getElementById('v4libTypeFilter')?.value || '';
        var url = '/api/v4/library/export';
        if (typeFilter) url += '?lib_type=' + encodeURIComponent(typeFilter);
        try {
            var resp = await App.fetchJSON(url);
            if (resp && resp.items) {
                var jsonStr = JSON.stringify(resp.items, null, 2);
                var blob = new Blob([jsonStr], { type: 'application/json' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = (typeFilter || '全部') + '_词库_' + new Date().toISOString().slice(0, 10) + '.json';
                a.click();
                App.showToast('导出 ' + resp.total + ' 条', 'success');
            }
        } catch (e) {
            App.showToast('导出失败', 'error');
        }
    };

    // 在词库面板添加批量导入/导出按钮到 page-header
    var origCreateModal = App.showV4LibCreateModal;
    // 注入：在加载完词库后自动添加导出按钮
    var origLoad = App.loadV4Library;
    App.loadV4Library = async function() {
        await origLoad.call(this);
        // 在 page-header 里添加批量操作按钮
        var header = document.querySelector('#viewV4library .page-header');
        if (header) {
            var existing = document.getElementById('v4LibBatchActions');
            if (!existing) {
                var div = document.createElement('div');
                div.id = 'v4LibBatchActions';
                div.style.display = 'inline-flex';
                div.style.gap = '8px';
                div.innerHTML = '<button class="btn btn-sm btn-outline" onclick="App.v4BatchImport()" title="批量导入"><i class="bi bi-upload"></i> 导入</button>' +
                    '<button class="btn btn-sm btn-outline" onclick="App.v4ExportLibrary()" title="导出当前类型"><i class="bi bi-download"></i> 导出</button>';
                header.appendChild(div);
            }
        }
    };

    console.log('[v4] Phase 2 词库+媒体资产管理模块已加载');
})();
