// ============================================================
// 2026-08-04: ComfyUI 工作流存储调用空间 — 前端面板 v2
// 工作流库 + 参数化前端（编辑模式选参 / 用户模式锁定表单）+ 运行状态
// ============================================================

(function() {
'use strict';

if (!window.App || !App.fetchJSON) { setTimeout(arguments.callee, 200); return; }

App.comfyLib = {
    _wfList: [],
    _selectedWf: null,
    _candidates: [],
    _presets: [],
    _activePreset: null,
    _logs: [],
    _generating: false,
    _runtimeTimer: null,
};

// ============ 打开/关闭 ============

App.comfyLib.open = function() {
    var m = document.getElementById('modalComfyLib');
    if (!m) m = this._ensureModal();
    m.style.display = 'flex';
    this.loadList();
    this.loadLogs();
    this.refreshRuntime();
    if (this._runtimeTimer) clearInterval(this._runtimeTimer);
    var self = this;
    this._runtimeTimer = setInterval(function() { self.refreshRuntime(); }, 5000);
};

App.comfyLib.close = function() {
    if (this._runtimeTimer) { clearInterval(this._runtimeTimer); this._runtimeTimer = null; }
    var m = document.getElementById('modalComfyLib');
    if (m) m.style.display = 'none';
};

// 从词卡调取工作流（右键菜单入口）
App.comfyLib.openFromCard = async function(cardId) {
    App.showToast('正在从词卡调取工作流...', 'info');
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/by-card/' + cardId);
        if (d && d.ok) {
            this.open();
            await this.loadList();
            this.selectWf(d.workflow_id);
            App.showToast('已调取工作流「' + (d.name || '') + '」', 'success');
        } else {
            App.showToast('词卡未关联工作流: ' + (d && d.error ? d.error : ''), 'warning');
        }
    } catch(e) {
        App.showToast('调取失败: ' + e.message, 'error');
    }
};

App.comfyLib._ensureModal = function() {
    var overlay = document.createElement('div');
    overlay.id = 'modalComfyLib';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:none;z-index:720;';
    overlay.onclick = function(e) { if (e.target === overlay) App.comfyLib.close(); };

    overlay.innerHTML =
    '<div class="modal-content modal-wide" onclick="event.stopPropagation()" style="max-width:1060px;width:96%;max-height:92vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
      '<div class="modal-header" style="padding:12px 18px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
        '<h5 style="margin:0;font-size:15px;"><i class="bi bi-magic"></i> 工作流库 <span style="font-size:11px;color:var(--text-muted);">ComfyUI 存储调用空间</span></h5>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<button class="header-btn-sm" onclick="App.comfyLib.close()">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="modal-body" style="flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:14px;">' +

        // ===== 运行状态 =====
        '<div id="cwlRuntime" style="border:1px solid var(--border-color);border-radius:10px;padding:10px 14px;font-size:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--hover-bg,#f8fafc);">' +
          '<span style="font-weight:600;"><i class="bi bi-activity"></i> ComfyUI 运行状态</span>' +
          '<span id="cwlRtRunning" style="color:#10b981;">● 执行中: <b>0</b></span>' +
          '<span id="cwlRtPending" style="color:#f59e0b;">◌ 排队中: <b>0</b></span>' +
          '<span id="cwlRtDetail" style="color:var(--text-muted);font-size:11px;"></span>' +
          '<span style="margin-left:auto;display:flex;gap:8px;align-items:center;">' +
            '<button class="btn btn-sm" onclick="App.comfyLib.syncFromComfy()" title="从 ComfyUI 队列/历史同步最新工作流" style="font-size:11px;padding:4px 12px;border:1px solid var(--primary);color:var(--primary);border-radius:8px;"><i class="bi bi-arrow-repeat"></i> 从 ComfyUI 同步</button>' +
            '<span style="font-size:11px;color:var(--text-muted);">5s 自动刷新</span>' +
          '</span>' +
        '</div>' +

        // ===== 工作流列表 =====
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
          '<div style="font-size:13px;font-weight:600;"><i class="bi bi-collection"></i> 工作流模板 <span id="cwlCount" style="font-size:11px;color:var(--text-muted);"></span></div>' +
          '<div style="display:flex;gap:6px;align-items:center;">' +
            '<select id="cwlSort" onchange="App.comfyLib.loadList()" title="排序方式" style="font-size:11px;padding:5px 6px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);outline:none;">' +
              '<option value="recent">最近使用</option>' +
              '<option value="usage">使用最多</option>' +
              '<option value="newest">最新导入</option>' +
              '<option value="name">名称排序</option>' +
              '<option value="nodes">节点最多</option>' +
            '</select>' +
            '<span style="position:relative;display:inline-flex;align-items:center;">' +
              '<i class="bi bi-search" style="position:absolute;left:9px;font-size:12px;color:var(--text-muted);pointer-events:none;"></i>' +
              '<input id="cwlSearch" placeholder="搜索工作流名称 / 提示词..." style="font-size:12px;padding:6px 10px 6px 27px;width:230px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);outline:none;transition:border-color .15s,box-shadow .15s;" onfocus="this.style.borderColor=\'#6366f1\';this.style.boxShadow=\'0 0 0 2px rgba(99,102,241,0.18)\'" onblur="this.style.borderColor=\'#94a3b8\';this.style.boxShadow=\'none\'" oninput="App.comfyLib.loadList()">' +
            '</span>' +
            '<button class="btn btn-sm" onclick="document.getElementById(\'cwlPngFile\').click()" title="导入 ComfyUI 生成的 PNG（自动提取自带工作流）" style="font-size:11px;padding:5px 12px;border:1px solid #6366f1;color:#6366f1;border-radius:8px;"><i class="bi bi-upload"></i> 导入 PNG</button>' +
            '<button class="btn btn-sm" onclick="document.getElementById(\'cwlJsonFile\').click()" title="导入工作流 JSON 文件（API/UI 格式均可）" style="font-size:11px;padding:5px 12px;border:1px solid #0ea5e9;color:#0ea5e9;border-radius:8px;"><i class="bi bi-file-code"></i> 导入 JSON</button>' +
            '<input type="file" id="cwlPngFile" accept=".png,image/png" style="display:none;" onchange="App.comfyLib.importPng(this)">' +
            '<input type="file" id="cwlJsonFile" accept=".json,application/json" style="display:none;" onchange="App.comfyLib.importJson(this)">' +
          '</div>' +
        '</div>' +
        '<div id="cwlGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">' +
          '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted);font-size:12px;">加载中...</div>' +
        '</div>' +

        // ===== 生成区（含参数配置） =====
        '<div id="cwlGenPanel" style="border:1px solid var(--border-color);border-radius:10px;padding:12px 14px;display:none;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">' +
            '<span style="font-size:13px;font-weight:600;"><i class="bi bi-stars"></i> 生成</span>' +
            '<span id="cwlGenWfName" style="font-size:12px;color:var(--primary);"></span>' +
            '<span style="margin-left:auto;display:flex;gap:6px;">' +
              '<button class="btn btn-sm" id="cwlBtnEditParams" onclick="App.comfyLib.openParamEditor()" title="编辑模式：自主选择暴露哪些参数、命名、设置组件类型" style="font-size:11px;padding:3px 10px;border:1px solid #8b5cf6;color:#8b5cf6;"><i class="bi bi-sliders"></i> 参数配置</button>' +
            '</span>' +
          '</div>' +
          '<div id="cwlPresetBar" style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;"></div>' +
          '<div id="cwlParamForm"></div>' +
          '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-primary btn-sm" id="cwlBtnGen" onclick="App.comfyLib.generate()"><i class="bi bi-magic"></i> 生成图片</button>' +
            '<span id="cwlGenStatus" style="font-size:11px;color:var(--text-muted);"></span>' +
          '</div>' +
          '<div id="cwlGenResult" style="margin-top:10px;display:none;">' +
            '<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;">' +
              '<div style="flex-shrink:0;"><img id="cwlResultImg" style="max-width:280px;border-radius:10px;border:1px solid var(--border-color);display:block;background:#0f172a;"></div>' +
              '<div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px;">' +
                '<div style="font-size:11px;color:var(--text-muted);">结果已存 <code>data/comfyui_outputs/</code>（PNG 自带工作流元数据，可再次导入复用）</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                  '<button class="btn btn-sm" style="font-size:11px;padding:4px 12px;border:1px solid var(--primary);color:var(--primary);" onclick="App.comfyLib.saveAsCard()"><i class="bi bi-bookmark-plus"></i> 存为词卡</button>' +
                  '<a id="cwlDownload" class="btn btn-sm" style="font-size:11px;padding:4px 12px;border:1px solid var(--border-color);text-decoration:none;color:var(--text-main);" download><i class="bi bi-download"></i> 下载原图</a>' +
                  '<button class="btn btn-sm" style="font-size:11px;padding:4px 12px;" onclick="App.comfyLib.importResultAsWf()"><i class="bi bi-collection-plus"></i> 存为模板</button>' +
                '</div>' +
                '<div id="cwlSaveCardResult" style="font-size:11px;color:var(--text-muted);"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ===== 生成历史 =====
        '<div style="border-top:1px solid var(--border-color);padding-top:10px;">' +
          '<div style="font-size:13px;font-weight:600;margin-bottom:8px;"><i class="bi bi-clock-history"></i> 生成历史 <span style="font-size:11px;color:var(--text-muted);">最近 20 条</span></div>' +
          '<div id="cwlLogs" style="font-size:11px;color:var(--text-muted);">加载中...</div>' +
        '</div>' +

      '</div>' +
    '</div>';

    document.body.appendChild(overlay);
    return overlay;
};

// ============ 运行状态 ============

App.comfyLib.refreshRuntime = async function() {
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/runtime');
        if (!d || !d.ok) {
            var el = document.getElementById('cwlRtDetail');
            if (el) el.textContent = d && d.error ? ('⚠ ' + d.error) : '';
            return;
        }
        var r = document.getElementById('cwlRtRunning');
        var p = document.getElementById('cwlRtPending');
        var det = document.getElementById('cwlRtDetail');
        if (r) r.innerHTML = '● 执行中: <b>' + d.running_count + '</b>';
        if (p) p.innerHTML = '◌ 排队中: <b>' + d.pending_count + '</b>';
        if (det) {
            var parts = [];
            d.running.forEach(function(x) { parts.push('执行 ' + x.prompt_id.slice(0, 8) + '…'); });
            d.pending.forEach(function(x) { parts.push('排队 ' + x.prompt_id.slice(0, 8) + '…'); });
            det.textContent = parts.join('  ') || '';
        }
    } catch(e) { /* 忽略 */ }
};

// ============ 工作流列表 ============

App.comfyLib.loadList = async function() {
    var grid = document.getElementById('cwlGrid');
    if (!grid) return;
    var search = (document.getElementById('cwlSearch') || {}).value || '';
    var sort = (document.getElementById('cwlSort') || {}).value || 'recent';
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows?search=' + encodeURIComponent(search) + '&sort=' + encodeURIComponent(sort));
        if (!d || !d.items) throw new Error('获取失败');
        this._wfList = d.items;
        var cnt = document.getElementById('cwlCount');
        if (cnt) cnt.textContent = '(' + d.items.length + ')';
        this._renderList();
    } catch(e) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#ef4444;font-size:12px;">❌ ' + App._escape(e.message) + '</div>';
    }
};

App.comfyLib._renderList = function() {
    var grid = document.getElementById('cwlGrid');
    if (!grid) return;
    if (this._wfList.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted);font-size:12px;">' +
          '暂无工作流。<br>① 点击「导入 PNG」上传 ComfyUI 生成的图片（自动提取自带工作流）<br>② 或「从 ComfyUI 同步」获取当前运行的工作流</div>';
        return;
    }
    var html = '';
    var self = this;
    this._wfList.forEach(function(w) {
        var srcMap = { png_import: 'PNG导入', comfyui_sync: 'Comfy同步', manual: '手动', generate: '生成' };
        var src = srcMap[w.source] || w.source || '手动';
        var cover = w.thumbnail ? '/api/thumbnails/file/' + w.thumbnail
                  : (w.source === 'png_import' && w.source_file ? '/api/v2/comfyui/outputs/' + w.source_file : '');
        var isSel = self._selectedWf && self._selectedWf.id === w.id;
        var tip = (w.name || '') + (w.description ? '\n' + w.description : '') + (w.prompt_text ? '\n\n📝 ' + w.prompt_text : '');
        html += '<div class="cwl-card" onclick="App.comfyLib.selectWf(\'' + App._escape(w.id) + '\')" title="' + App._escape(tip) + '" ' +
          'style="border:1px solid ' + (isSel ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:10px;overflow:hidden;cursor:pointer;background:var(--bg-card);position:relative;">' +
          '<div style="height:84px;background:linear-gradient(135deg,#1e293b,#334155);display:flex;align-items:center;justify-content:center;position:relative;">' +
            (cover ? '<img src="' + cover + '" style="width:100%;height:100%;object-fit:cover;">' : '<span style="font-size:26px;opacity:0.5;">🎨</span>') +
            '<span style="position:absolute;top:6px;right:6px;font-size:9px;padding:2px 7px;border-radius:8px;background:rgba(0,0,0,0.55);color:#e2e8f0;">' + src + '</span>' +
            (w.is_favorite ? '<span style="position:absolute;top:6px;left:6px;font-size:11px;">⭐</span>' : '') +
          '</div>' +
          '<div style="padding:8px 10px;">' +
            '<div style="display:flex;align-items:center;gap:4px;">' +
              '<div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;" title="' + App._escape(w.name || '') + '">' + App._escape(w.name || '未命名') + '</div>' +
              '<span onclick="event.stopPropagation();App.comfyLib.renameWorkflow(\'' + App._escape(w.id) + '\')" title="重命名" style="font-size:12px;cursor:pointer;opacity:0.65;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.65">✎</span>' +
              '<span onclick="event.stopPropagation();App.comfyLib.duplicateWorkflow(\'' + App._escape(w.id) + '\')" title="复制模板" style="font-size:12px;cursor:pointer;opacity:0.65;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.65">⧉</span>' +
              '<span onclick="event.stopPropagation();App.comfyLib.toggleFavorite(\'' + App._escape(w.id) + '\')" title="' + (w.is_favorite ? '取消收藏' : '收藏') + '" style="font-size:13px;cursor:pointer;opacity:0.75;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.75">' + (w.is_favorite ? '⭐' : '☆') + '</span>' +
              '<span onclick="event.stopPropagation();App.comfyLib.deleteWorkflow(\'' + App._escape(w.id) + '\')" title="删除模板" style="font-size:12px;cursor:pointer;opacity:0.65;color:#ef4444;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.65">🗑</span>' +
            '</div>' +
            '<div style="font-size:10px;color:var(--text-muted);margin-top:3px;display:flex;justify-content:space-between;">' +
              '<span>' + (w.node_count || 0) + ' 节点</span><span>使用 ' + (w.usage_count || 0) + ' 次</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    grid.innerHTML = html;
};

// 重命名模板
App.comfyLib.renameWorkflow = async function(wfId) {
    var wf = null;
    for (var i = 0; i < this._wfList.length; i++) {
        if (this._wfList[i].id === wfId) { wf = this._wfList[i]; break; }
    }
    if (!wf) return;
    var name = prompt('重命名工作流模板：', wf.name || '');
    if (name === null) return;
    name = name.trim();
    if (!name) { App.showToast('名称不能为空', 'warning'); return; }
    try {
        await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        App.showToast('已重命名为「' + name + '」', 'success');
        this.loadList();
    } catch(e) {
        App.showToast('重命名失败: ' + e.message, 'error');
    }
};

// 复制模板
App.comfyLib.duplicateWorkflow = async function(wfId) {
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId) + '/duplicate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (d && d.ok) {
            App.showToast('已复制为「' + (d.workflow_id || '') + '」', 'success');
            this.loadList();
        } else {
            App.showToast('复制失败: ' + (d && d.error ? d.error : '未知'), 'error');
        }
    } catch(e) {
        App.showToast('复制失败: ' + e.message, 'error');
    }
};

// JSON 文件导入（ComfyUI 导出的 API 格式或 UI 格式）
App.comfyLib.importJson = async function(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    var self = this;
    reader.onload = async function(e) {
        try {
            var wf = JSON.parse(e.target.result);
            if (!wf || typeof wf !== 'object') throw new Error('无效的 JSON');
            var isApi = Object.keys(wf).some(function(k) { return wf[k] && wf[k].class_type; });
            var name = prompt('命名此工作流模板：', file.name.replace(/\.json$/i, ''));
            if (name === null) { input.value = ''; return; }
            name = (name || '').trim() || '导入模板';
            var body = { name: name, description: (isApi ? 'API 格式 JSON 导入' : 'UI 格式 JSON 导入（自动转换）') };
            if (isApi) {
                body.workflow_json = wf;
            } else {
                // UI 格式：先取 object_info 转换（复用后端转换器）
                body.workflow_json = wf;
                body.ui_json = JSON.stringify(wf);
                body.prompt_text = '';
            }
            var d = await App.fetchJSON('/api/v2/comfyui/workflows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (d && d.ok) {
                App.showToast('✅ 已导入「' + name + '」', 'success');
                input.value = '';
                self.loadList();
                self.selectWf(d.workflow_id);
            } else {
                App.showToast('导入失败: ' + (d && d.error ? d.error : '未知'), 'error');
                input.value = '';
            }
        } catch(err) {
            App.showToast('JSON 解析失败: ' + err.message, 'error');
            input.value = '';
        }
    };
    reader.readAsText(file);
};

// 收藏/取消收藏
App.comfyLib.toggleFavorite = async function(wfId) {
    var wf = null;
    for (var i = 0; i < this._wfList.length; i++) {
        if (this._wfList[i].id === wfId) { wf = this._wfList[i]; break; }
    }
    var next = wf && wf.is_favorite ? 0 : 1;
    try {
        await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_favorite: next })
        });
        App.showToast(next ? '⭐ 已收藏' : '已取消收藏', 'success');
        this.loadList();
    } catch(e) {
        App.showToast('操作失败: ' + e.message, 'error');
    }
};

// 删除工作流模板（二次确认）
App.comfyLib.deleteWorkflow = async function(wfId) {
    var wf = null;
    for (var i = 0; i < this._wfList.length; i++) {
        if (this._wfList[i].id === wfId) { wf = this._wfList[i]; break; }
    }
    var name = (wf && wf.name) || '该模板';
    if (!confirm('确定删除工作流模板「' + name + '」？\n删除后不可恢复（关联的生成记录与词卡不受影响）。')) return;
    try {
        await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId), { method: 'DELETE' });
        App.showToast('已删除「' + name + '」', 'success');
        if (this._selectedWf && this._selectedWf.id === wfId) {
            this._selectedWf = null;
            this._activePreset = null;
            var panel = document.getElementById('cwlGenPanel');
            if (panel) panel.style.display = 'none';
            var form = document.getElementById('cwlParamForm');
            if (form) form.innerHTML = '';
        }
        this.loadList();
    } catch(e) {
        App.showToast('删除失败: ' + e.message, 'error');
    }
};

App.comfyLib.selectWf = async function(id) {
    var wf = null;
    for (var i = 0; i < this._wfList.length; i++) {
        if (this._wfList[i].id === id) { wf = this._wfList[i]; break; }
    }
    if (!wf) {
        try {
            var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(id));
            wf = d.workflow;
        } catch(e) { return; }
    }
    this._selectedWf = wf;
    this._renderList();
    var panel = document.getElementById('cwlGenPanel');
    if (panel) panel.style.display = 'block';
    var nameEl = document.getElementById('cwlGenWfName');
    if (nameEl) nameEl.textContent = '「' + (wf.name || '未命名') + '」' + (wf.node_count ? ' · ' + wf.node_count + ' 节点' : '');
    var result = document.getElementById('cwlGenResult');
    if (result) result.style.display = 'none';
    // 加载参数分析 + 配置
    await this._loadParams(id);
};

// ============ 参数系统 ============

App.comfyLib._loadParams = async function(wfId) {
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId) + '/params/analyze');
        if (!d || !d.ok) throw new Error(d && d.error || '分析失败');
        this._candidates = d.candidates || [];
        this._presets = d.presets || [];
        this._renderPresetBar();
        // 默认选中第一个 user 模式配置
        var userPreset = null;
        for (var i = 0; i < this._presets.length; i++) {
            if (this._presets[i].mode === 'user') { userPreset = this._presets[i]; break; }
        }
        this._activePreset = userPreset || null;
        this._renderParamForm();
    } catch(e) {
        var form = document.getElementById('cwlParamForm');
        if (form) form.innerHTML = '<div style="font-size:11px;color:#ef4444;">参数分析失败: ' + App._escape(e.message) + '</div>';
    }
};

App.comfyLib._renderPresetBar = function() {
    var bar = document.getElementById('cwlPresetBar');
    if (!bar) return;
    if (this._presets.length === 0) {
        bar.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">尚未配置参数模块 — 点击「参数配置」在编辑模式中自主选择要暴露的调节参数</span>';
        return;
    }
    var html = '<span style="font-size:11px;color:var(--text-muted);">参数模块:</span>';
    var self = this;
    this._presets.forEach(function(p) {
        var isAct = self._activePreset && self._activePreset.id === p.id;
        var isEdit = p.mode === 'editor';
        html += '<span onclick="App.comfyLib.activatePreset(' + p.id + ')" style="cursor:pointer;font-size:11px;padding:3px 10px;border-radius:14px;border:1px solid ' + (isAct ? 'var(--primary)' : 'var(--border-color)') + ';color:' + (isAct ? 'var(--primary)' : 'var(--text-main)') + ';background:' + (isAct ? 'rgba(99,102,241,0.08)' : 'transparent') + ';">' +
          App._escape(p.name || '参数配置') + (isEdit ? ' <span style="color:#8b5cf6;">(编辑中)</span>' : ' <span style="color:#10b981;">🔒</span>') +
          (isAct ? ' <span onclick="event.stopPropagation();App.comfyLib.deletePreset(' + p.id + ')" title="删除" style="color:#ef4444;">✕</span>' : '') +
        '</span>';
    });
    bar.innerHTML = html;
};

App.comfyLib.activatePreset = function(pid) {
    for (var i = 0; i < this._presets.length; i++) {
        if (this._presets[i].id === pid) { this._activePreset = this._presets[i]; break; }
    }
    this._renderPresetBar();
    this._renderParamForm();
};

App.comfyLib.deletePreset = async function(pid) {
    if (!confirm('删除该参数配置？')) return;
    try {
        await App.fetchJSON('/api/v2/comfyui/presets/' + pid, { method: 'DELETE' });
        this._activePreset = null;
        this._loadParams(this._selectedWf.id);
    } catch(e) { App.showToast('删除失败: ' + e.message, 'error'); }
};

// 渲染用户模式参数表单
App.comfyLib._renderParamForm = function() {
    var form = document.getElementById('cwlParamForm');
    if (!form) return;
    var preset = this._activePreset;
    if (!preset) {
        // 无配置：简单提示词框
        form.innerHTML =
          '<label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">提示词</label>' +
          '<textarea id="cwlPrompt" rows="2" placeholder="输入提示词..." style="width:100%;font-size:12px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape((this._selectedWf && this._selectedWf.prompt_text) || '') + '</textarea>';
        return;
    }
    var params = [];
    try { params = JSON.parse(preset.params_json || '[]'); } catch(e) {}
    if (params.length === 0) {
        form.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">该配置未包含任何参数</div>';
        return;
    }
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">';
    var self = this;
    params.forEach(function(p) {
        html += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<label style="font-size:11px;font-weight:600;">' + App._escape(p.label || p.key) + '</label>' +
                '<span id="pv_' + App._escape(p.key) + '" style="font-size:11px;color:var(--primary);font-family:monospace;">' + App._escape(String(p.default === undefined ? '' : p.default)) + '</span>' +
                '</div>';
        var val = p.default;
        if (p.type === 'slider') {
            var min = (p.min === undefined ? 0 : p.min), max = (p.max === undefined ? 100 : p.max), step = (p.step === undefined ? 1 : p.step);
            html += '<input type="range" class="cwl-pv" data-key="' + App._escape(p.key) + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" style="width:100%;" oninput="document.getElementById(\'pv_' + App._escape(p.key) + '\').textContent=this.value">';
        } else if (p.type === 'checkbox') {
            html += '<input type="checkbox" class="cwl-pv" data-key="' + App._escape(p.key) + '" ' + (val ? 'checked' : '') + ' style="width:18px;height:18px;">';
        } else if (p.type === 'select_file') {
            html += '<input type="text" class="cwl-pv" data-key="' + App._escape(p.key) + '" value="' + App._escape(String(val)) + '" style="width:100%;font-size:11px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);" title="模型文件名">';
        } else {
            html += '<textarea class="cwl-pv" data-key="' + App._escape(p.key) + '" rows="' + (p.key.indexOf('.text') > -1 ? 2 : 1) + '" style="width:100%;font-size:11px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape(String(val === undefined ? '' : val)) + '</textarea>';
        }
        html += '</div>';
    });
    html += '</div>';
    form.innerHTML = html;
};

// ============ 参数配置编辑器（编辑模式） ============

App.comfyLib.openParamEditor = function() {
    var self = this;
    var overlay = document.getElementById('cwlParamEditor');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cwlParamEditor';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:none;z-index:740;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };
        overlay.innerHTML =
        '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:720px;max-height:86vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
          '<div class="modal-header" style="padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
            '<h5 style="margin:0;font-size:14px;"><i class="bi bi-sliders"></i> 参数配置 <span style="font-size:11px;color:var(--text-muted);">编辑模式 — 自主选择暴露参数</span></h5>' +
            '<button class="header-btn-sm" onclick="document.getElementById(\'cwlParamEditor\').style.display=\'none\'">&times;</button>' +
          '</div>' +
          '<div class="modal-body" style="flex:1;overflow-y:auto;padding:12px 16px;">' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">系统已自动分析当前工作流的可调参数（' + '，勾选要暴露的项，自定义名称与组件类型，保存后切换为锁定用户模式</div>' +
            '<div style="margin-bottom:10px;"><label style="font-size:11px;color:var(--text-muted);">配置名称</label><input id="cpeName" placeholder="如：基础出图参数" style="width:100%;font-size:12px;padding:6px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);margin-top:4px;"></div>' +
            '<div id="cpeList" style="display:flex;flex-direction:column;gap:8px;">加载中...</div>' +
          '</div>' +
          '<div class="modal-footer" style="padding:10px 16px;border-top:1px solid var(--border-color);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;">' +
            '<span style="margin-right:auto;font-size:11px;color:var(--text-muted);" id="cpeHint">🔒 保存后锁定为用户模式，仅显示所选参数</span>' +
            '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'cwlParamEditor\').style.display=\'none\'">取消</button>' +
            '<button class="btn btn-primary btn-sm" onclick="App.comfyLib.savePreset()"><i class="bi bi-lock"></i> 保存并锁定</button>' +
          '</div>' +
        '</div>';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    var nameInput = document.getElementById('cpeName');
    if (nameInput) nameInput.value = this._activePreset ? this._activePreset.name : ('「' + (this._selectedWf && this._selectedWf.name || '') + '」参数');
    var listEl = document.getElementById('cpeList');
    if (!listEl) return;
    if (this._candidates.length === 0) {
        listEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">未分析到可调参数（工作流可能没有数值/文本输入节点）</div>';
        return;
    }
    // 编辑已有配置时回填选中
    var selected = {};
    if (this._activePreset) {
        try { JSON.parse(this._activePreset.params_json || '[]').forEach(function(p) { selected[p.key] = p; }); } catch(e) {}
    }
    var html = '';
    this._candidates.forEach(function(c) {
        var isSel = !!selected[c.key];
        var sp = selected[c.key] || {};
        var label = sp.label || c.label || c.key;
        var type = sp.type || c.type;
        var min = sp.min === undefined ? (typeof c.value === 'number' && c.value >= 0 && c.value <= 100 ? (c.value <= 2 ? 0 : Math.max(0, Math.floor(c.value / 2))) : 0) : sp.min;
        var max = sp.max === undefined ? (typeof c.value === 'number' ? Math.max(100, Math.ceil(c.value * 2)) : 100) : sp.max;
        var step = sp.step === undefined ? (typeof c.value === 'number' && !Number.isInteger(c.value) ? 0.1 : 1) : sp.step;
        html += '<div style="border:1px solid ' + (isSel ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:8px;padding:8px 10px;">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<input type="checkbox" class="cpe-sel" data-key="' + App._escape(c.key) + '" ' + (isSel ? 'checked' : '') + ' onchange="App.comfyLib._toggleCandidate(this)" style="width:16px;height:16px;">' +
            '<span style="font-size:12px;font-weight:600;flex:1;">' + App._escape(c.label) + '</span>' +
            '<span onclick="App.comfyLib.renameCandidate(\'' + App._escape(c.key) + '\')" title="重命名此参数（勾选并编辑名称）" style="font-size:13px;cursor:pointer;opacity:0.7;color:#8b5cf6;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.7">✎</span>' +
            '<code style="font-size:10px;color:var(--text-muted);">' + App._escape(c.key) + ' = ' + App._escape(String(c.value)) + '</code>' +
          '</div>' +
          '<div class="cpe-detail" style="display:' + (isSel ? 'flex' : 'none') + ';gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">' +
            '<label style="font-size:10px;color:var(--text-muted);">名称 <input type="text" class="cpe-label" data-key="' + App._escape(c.key) + '" value="' + App._escape(label) + '" style="width:100px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);"></label>' +
            '<label style="font-size:10px;color:var(--text-muted);">组件 <select class="cpe-type" data-key="' + App._escape(c.key) + '" style="font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);">' +
              '<option value="slider" ' + (type === 'slider' ? 'selected' : '') + '>滑块</option>' +
              '<option value="text" ' + (type === 'text' ? 'selected' : '') + '>文本框</option>' +
              '<option value="checkbox" ' + (type === 'checkbox' ? 'selected' : '') + '>开关</option>' +
              '<option value="number" ' + (type === 'number' ? 'selected' : '') + '>数字输入</option>' +
            '</select></label>' +
            '<label style="font-size:10px;color:var(--text-muted);">范围 <input type="number" class="cpe-min" data-key="' + App._escape(c.key) + '" value="' + min + '" style="width:56px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);"> ~ <input type="number" class="cpe-max" data-key="' + App._escape(c.key) + '" value="' + max + '" style="width:56px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);"> 步长 <input type="number" class="cpe-step" data-key="' + App._escape(c.key) + '" value="' + step + '" style="width:56px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);"></label>' +
          '</div>' +
        '</div>';
    });
    listEl.innerHTML = html;
};

App.comfyLib._toggleCandidate = function(cb) {
    var detail = cb.closest('div').querySelector('.cpe-detail');
    if (detail) detail.style.display = cb.checked ? 'flex' : 'none';
    if (cb.checked) {
        // 勾选后自动聚焦名称输入框，方便直接重命名
        var key = cb.getAttribute('data-key');
        var labelInput = document.querySelector('.cpe-label[data-key="' + key + '"]');
        if (labelInput) {
            setTimeout(function() { labelInput.focus(); labelInput.select(); }, 50);
        }
    }
};

// 参数重命名入口：一键勾选 + 展开 + 聚焦名称输入框
App.comfyLib.renameCandidate = function(key) {
    var cb = document.querySelector('.cpe-sel[data-key="' + key + '"]');
    if (cb) {
        if (!cb.checked) {
            cb.checked = true;
            this._toggleCandidate(cb);
        }
        var labelInput = document.querySelector('.cpe-label[data-key="' + key + '"]');
        if (labelInput) {
            labelInput.focus();
            labelInput.select();
        }
        var detail = cb.closest('div').querySelector('.cpe-detail');
        if (detail) {
            detail.style.borderColor = '#8b5cf6';
            setTimeout(function() { detail.style.borderColor = ''; }, 1200);
        }
    }
};

App.comfyLib.savePreset = async function() {
    if (!this._selectedWf) return;
    var params = [];
    var cbs = document.querySelectorAll('.cpe-sel');
    var self = this;
    cbs.forEach(function(cb) {
        if (!cb.checked) return;
        var key = cb.getAttribute('data-key');
        var cand = null;
        for (var i = 0; i < self._candidates.length; i++) {
            if (self._candidates[i].key === key) { cand = self._candidates[i]; break; }
        }
        if (!cand) return;
        var p = {
            key: key, node_id: cand.node_id, field: cand.field,
            label: (document.querySelector('.cpe-label[data-key="' + key + '"]') || {}).value || cand.label,
            type: (document.querySelector('.cpe-type[data-key="' + key + '"]') || {}).value || 'text',
            default: cand.value,
            min: parseFloat((document.querySelector('.cpe-min[data-key="' + key + '"]') || {}).value) || 0,
            max: parseFloat((document.querySelector('.cpe-max[data-key="' + key + '"]') || {}).value) || 100,
            step: parseFloat((document.querySelector('.cpe-step[data-key="' + key + '"]') || {}).value) || 1,
        };
        params.push(p);
    });
    if (params.length === 0) { App.showToast('请至少勾选一个参数', 'warning'); return; }
    var name = (document.getElementById('cpeName') || {}).value || '参数配置';
    var body = { name: name, params: params, mode: 'user' };
    try {
        if (this._activePreset) {
            await App.fetchJSON('/api/v2/comfyui/presets/' + this._activePreset.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        } else {
            var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(this._selectedWf.id) + '/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (d && d.ok) this._activePreset = { id: d.preset_id, name: name, params_json: JSON.stringify(params), mode: 'user' };
        }
        document.getElementById('cwlParamEditor').style.display = 'none';
        App.showToast('✅ 已保存并锁定为用户模式', 'success');
        this._loadParams(this._selectedWf.id);
    } catch(e) {
        App.showToast('保存失败: ' + e.message, 'error');
    }
};

// ============ 生成 ============

App.comfyLib._collectParamValues = function() {
    var values = {};
    var els = document.querySelectorAll('.cwl-pv');
    for (var i = 0; i < els.length; i++) {
        var key = els[i].getAttribute('data-key');
        var v = els[i].value;
        if (els[i].type === 'checkbox') v = els[i].checked;
        else if (els[i].type === 'range' || els[i].type === 'number') v = parseFloat(v);
        values[key] = v;
    }
    return values;
};

App.comfyLib.generate = async function() {
    if (this._generating) return;
    if (!this._selectedWf) { App.showToast('请先选择一个工作流模板', 'warning'); return; }
    var status = document.getElementById('cwlGenStatus');
    var btn = document.getElementById('cwlBtnGen');
    if (status) status.textContent = '⏳ 正在生成（约 15-60s，请勿关闭面板）...';
    if (btn) btn.disabled = true;
    this._generating = true;
    var promptText = '';
    var promptEl = document.getElementById('cwlPrompt');
    if (promptEl) promptText = promptEl.value;
    var paramValues = this._collectParamValues();
    var presetId = this._activePreset ? this._activePreset.id : 0;
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt_id: 0,
                prompt_text: promptText,
                workflow_id: this._selectedWf.id,
                preset_id: presetId,
                param_values: paramValues
            })
        });
        if (!d || !d.ok) {
            if (status) status.textContent = '❌ ' + (d && d.error ? d.error : '生成失败');
            App.showToast('生成失败: ' + (d && d.error ? d.error : ''), 'error');
            if (btn) btn.disabled = false;
            this._generating = false;
            this.loadLogs();
            this.refreshRuntime();
            return;
        }
        if (status) status.textContent = '✅ 生成完成';
        this._lastResult = d;
        var result = document.getElementById('cwlGenResult');
        if (result) result.style.display = 'block';
        var img = document.getElementById('cwlResultImg');
        if (img) img.src = d.thumbnail_url || ('/api/thumbnails/file/' + d.thumbnail);
        var dl = document.getElementById('cwlDownload');
        if (dl && d.output_file) dl.href = '/api/v2/comfyui/outputs/' + encodeURIComponent(d.output_file);
        var sc = document.getElementById('cwlSaveCardResult');
        if (sc) sc.textContent = '';
        this.loadList();
        this.loadLogs();
        this.refreshRuntime();
    } catch(e) {
        if (status) status.textContent = '❌ ' + e.message;
        App.showToast('生成异常: ' + e.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
        this._generating = false;
    }
};

// ============ 存为词卡 / 存为模板 ============

App.comfyLib.saveAsCard = async function() {
    if (!this._lastResult || !this._lastResult.output_file) return;
    var promptText = (document.getElementById('cwlPrompt') || {}).value || '';
    var paramValues = this._collectParamValues();
    if (!promptText) {
        for (var k in paramValues) {
            if (k.indexOf('.text') > -1 && paramValues[k]) { promptText = String(paramValues[k]); break; }
        }
    }
    var sc = document.getElementById('cwlSaveCardResult');
    if (sc) sc.textContent = '正在创建词卡...';
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/generate/save-card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                output_file: this._lastResult.output_file,
                workflow_id: this._selectedWf ? this._selectedWf.id : '',
                prompt_text: promptText,
                module: 'custom'
            })
        });
        if (d && d.ok) {
            if (sc) sc.innerHTML = '✅ 已存为词卡 #' + d.card_id + '（缩略图已生成，可从词卡右键「用工作流生成」再次调用）';
            this.loadLogs();
        } else {
            if (sc) sc.textContent = '❌ ' + (d && d.error ? d.error : '保存失败');
        }
    } catch(e) {
        if (sc) sc.textContent = '❌ ' + e.message;
    }
};

App.comfyLib.importResultAsWf = async function() {
    if (!this._lastResult || !this._lastResult.output_file) return;
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/import-from-output', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ output_file: this._lastResult.output_file })
        });
        if (d && d.ok) {
            App.showToast('已存为模板: ' + (d.name || ''), 'success');
            this.loadList();
        } else {
            App.showToast(d && d.error ? d.error : '保存模板失败', 'error');
        }
    } catch(e) {
        App.showToast(e.message, 'error');
    }
};

// ============ PNG 导入 ============

App.comfyLib.importPng = async function(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    App.showToast('正在解析 PNG 工作流元数据...', 'info');
    var fd = new FormData();
    fd.append('file', file);
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/import-png', { method: 'POST', body: fd });
        if (d && d.ok) {
            App.showToast('✅ 已导入工作流「' + (d.name || '') + '」 ' + d.node_count + ' 节点', 'success');
            input.value = '';
            this.loadList();
            this.selectWf(d.workflow_id);
        } else {
            App.showToast('导入失败: ' + (d && d.error ? d.error : '未知'), 'error');
            input.value = '';
        }
    } catch(e) {
        App.showToast('导入失败: ' + e.message, 'error');
        input.value = '';
    }
};

// ============ 从 ComfyUI 同步 ============

App.comfyLib.syncFromComfy = async function() {
    App.showToast('正在获取 ComfyUI 工作流来源...', 'info');
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/available');
        if (!d || !d.ok) {
            App.showToast('获取失败: ' + (d && d.error ? d.error : '未知'), 'error');
            return;
        }
        this._showSourcePicker(d);
    } catch(e) {
        App.showToast('获取失败: ' + e.message, 'error');
    }
};

// 来源选择弹窗：已保存模板 / 最近运行 / 执行中排队中
App.comfyLib._showSourcePicker = function(d) {
    var overlay = document.getElementById('cwlSrcPicker');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cwlSrcPicker';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:none;z-index:760;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };
        overlay.innerHTML =
        '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:640px;max-height:82vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
          '<div class="modal-header" style="padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
            '<h5 style="margin:0;font-size:14px;"><i class="bi bi-diagram-3"></i> 从 ComfyUI 获取工作流</h5>' +
            '<button class="header-btn-sm" onclick="document.getElementById(\'cwlSrcPicker\').style.display=\'none\'">&times;</button>' +
          '</div>' +
          '<div class="modal-body" id="cwlSrcList" style="flex:1;overflow-y:auto;padding:10px 16px;"></div>' +
          '<div class="modal-footer" style="padding:8px 16px;border-top:1px solid var(--border-color);font-size:11px;color:var(--text-muted);flex-shrink:0;">点击任一来源即导入；已在库中匹配的会自动定位</div>' +
        '</div>';
        document.body.appendChild(overlay);
    }
    var html = '';
    // 已保存模板
    html += '<div style="font-size:12px;font-weight:600;margin:10px 0 6px;">📁 已保存模板 (' + (d.templates || []).length + ')</div>';
    if (!d.templates || d.templates.length === 0) {
        html += '<div style="font-size:11px;color:var(--text-muted);padding:4px 0 8px;">无（在 ComfyUI 中打开工作流后按 Ctrl+S 保存，即可出现在此）</div>';
    } else {
        d.templates.forEach(function(t) {
            html += '<div class="cwl-src-item" onclick="App.comfyLib._importSource(\'file=' + t.file + '\',\'' + App._escape(t.name) + '\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;" onmouseenter="this.style.borderColor=\'var(--primary)\';this.style.background=\'rgba(99,102,241,0.05)\';" onmouseleave="this.style.borderColor=\'var(--border-color)\';this.style.background=\'transparent\';">' +
              '<span>📄</span><span style="flex:1;">' + App._escape(t.name) + '</span>' +
              '<span style="color:var(--text-muted);font-size:10px;">' + t.node_count + ' 节点 · ' + App._escape(t.mtime) + '</span>' +
            '</div>';
        });
    }
    // 最近运行
    html += '<div style="font-size:12px;font-weight:600;margin:14px 0 6px;">🕘 最近运行 (' + (d.recent || []).length + ')</div>';
    (d.recent || []).forEach(function(r) {
        html += '<div class="cwl-src-item" onclick="App.comfyLib._importSource(\'history=' + r.prompt_id + '\',\'' + App._escape((r.prompt_text || r.prompt_id).slice(0, 18)) + '\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;" onmouseenter="this.style.borderColor=\'var(--primary)\';this.style.background=\'rgba(99,102,241,0.05)\';" onmouseleave="this.style.borderColor=\'var(--border-color)\';this.style.background=\'transparent\';">' +
          '<span>🕘</span><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(r.prompt_id) + '">' + App._escape((r.prompt_text || ('任务 ' + r.prompt_id.slice(0, 8))) + (r.status ? ' (' + r.status + ')' : '')) + '</span>' +
          '<span style="color:var(--text-muted);font-size:10px;">' + r.node_count + ' 节点</span>' +
        '</div>';
    });
    // 执行中/排队中
    if ((d.running || []).length + (d.pending || []).length > 0) {
        html += '<div style="font-size:12px;font-weight:600;margin:14px 0 6px;">▶ 执行中 / 排队中</div>';
        d.running.forEach(function(r) {
            html += '<div class="cwl-src-item" onclick="App.comfyLib._importSource(\'queue=' + r.prompt_id + '\',\'执行中任务\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #10b981;border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;color:#10b981;">' +
              '<span>▶</span><span style="flex:1;">执行中 ' + r.prompt_id.slice(0, 8) + '…</span><span style="font-size:10px;">' + r.node_count + ' 节点</span></div>';
        });
        d.pending.forEach(function(r) {
            html += '<div class="cwl-src-item" onclick="App.comfyLib._importSource(\'queue=' + r.prompt_id + '\',\'排队任务\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #f59e0b;border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;color:#f59e0b;">' +
              '<span>◌</span><span style="flex:1;">排队中 ' + r.prompt_id.slice(0, 8) + '…</span><span style="font-size:10px;">' + r.node_count + ' 节点</span></div>';
        });
    }
    document.getElementById('cwlSrcList').innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">无可获取的工作流来源</div>';
    overlay.style.display = 'flex';
};

App.comfyLib._importSource = async function(source, label) {
    var picker = document.getElementById('cwlSrcPicker');
    if (picker) picker.style.display = 'none';
    App.showToast('正在导入「' + label + '」...', 'info');
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: source })
        });
        if (d && d.ok) {
            App.showToast((d.matched ? '✅ 已匹配现有模板「' : '✅ 已导入新模板「') + (d.workflow_name || label) + '」', 'success');
            await this.loadList();
            if (d.workflow_id) this.selectWf(d.workflow_id);
        } else {
            App.showToast('导入失败: ' + (d && d.error ? d.error : '未知'), 'error');
        }
    } catch(e) {
        App.showToast('导入失败: ' + e.message, 'error');
    }
};

// ============ 生成历史 ============

App.comfyLib.loadLogs = async function() {
    var el = document.getElementById('cwlLogs');
    if (!el) return;
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/generation-logs?limit=20');
        if (!d || !d.items) throw new Error('获取失败');
        this._logs = d.items;
        if (d.items.length === 0) {
            el.innerHTML = '<span style="color:var(--text-muted);">暂无生成记录</span>';
            return;
        }
        var html = '<table style="width:100%;border-collapse:collapse;">' +
          '<tr style="color:var(--text-muted);text-align:left;"><th style="padding:4px 6px;font-weight:500;">时间</th><th style="padding:4px 6px;font-weight:500;">状态</th><th style="padding:4px 6px;font-weight:500;">引擎</th><th style="padding:4px 6px;font-weight:500;">耗时</th><th style="padding:4px 6px;font-weight:500;">词卡</th><th style="padding:4px 6px;font-weight:500;">提示词</th></tr>';
        d.items.forEach(function(lg) {
            var stColor = lg.status === 'success' ? '#10b981' : (lg.status === 'failed' ? '#ef4444' : '#f59e0b');
            html += '<tr style="border-top:1px solid var(--border-color);">' +
              '<td style="padding:4px 6px;">' + App._escape((lg.created_at || '').slice(5, 16)) + '</td>' +
              '<td style="padding:4px 6px;color:' + stColor + ';">' + App._escape(lg.status) + '</td>' +
              '<td style="padding:4px 6px;">' + App._escape(lg.engine) + '</td>' +
              '<td style="padding:4px 6px;">' + (lg.duration_sec ? Math.round(lg.duration_sec) + 's' : '-') + '</td>' +
              '<td style="padding:4px 6px;">' + (lg.card_id ? '#' + lg.card_id : '-') + '</td>' +
              '<td style="padding:4px 6px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(lg.prompt_text || '') + '">' + App._escape((lg.prompt_text || '').slice(0, 46)) + '</td>' +
            '</tr>';
        });
        html += '</table>';
        el.innerHTML = html;
    } catch(e) {
        el.innerHTML = '<span style="color:#ef4444;">' + App._escape(e.message) + '</span>';
    }
};

})();
