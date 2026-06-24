/**
 * Phase16: 原子编辑器模块 (atom_editor.js)
 * 功能：原子列表 / AI拆解面板 / SSE批量进度 / 归档到词卡分组
 */
(function initAtomEditor() {
'use strict';
try { if (!window.App || !App.fetchJSON) { setTimeout(initAtomEditor, 300); return; } }
catch(e) { setTimeout(initAtomEditor, 300); return; }

// ============ state ============
App.state.atomDecomposes = [];
App.state.atomStats = {};
App.state.atomIsDecomposing = false;

// ============ 兼容：App.toast → App.showToast ============
App.toast = function(msg, type) { App.showToast(msg, type || 'success'); };

// ============ 视图切换 ============
App._atomOriginSwitchView = App.switchView;
App.switchView = function(view, ...args) {
    if (view === 'atom_editor') {
        this._showAtomEditor();
        return;
    }
    // 从原子编辑器切出时，移除原子面板，恢复其他视图
    var atomPanel = document.getElementById('viewAtomEditor');
    if (atomPanel) atomPanel.style.display = 'none';
    // 恢复所有被隐藏的 view-panel（去掉 atom_editor 设置的 inline display:none）
    var allViews = document.querySelectorAll('.view-panel');
    allViews.forEach(function(v) { v.style.display = ''; });
    // 委托给原始 switchView
    return this._atomOriginSwitchView(view, ...args);
};

// ============ 兼容：App.toast → App.showToast ============
App.toast = function(msg, type) { App.showToast(msg, type || 'success'); };

// ============ 主入口 ============
App._showAtomEditor = async function() {
    var mc = document.getElementById('mainContent');
    if (!mc) return;

    // 隐藏所有视图面板
    var allViews = mc.querySelectorAll('.view-panel');
    allViews.forEach(function(v) { v.style.display = 'none'; });

    // 创建/显示原子编辑器面板
    var panel = document.getElementById('viewAtomEditor');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'viewAtomEditor';
        panel.className = 'view-panel';
        mc.appendChild(panel);
    }
    panel.style.display = 'block';
    panel.innerHTML = App._atomRenderHTML();

    // 加载数据
    await App._atomLoadStats();
    await App._atomLoadList();

    // 绑定事件
    App._atomBindEvents();
};

// ============ HTML 模板 ============
App._atomRenderHTML = function() {
    return '' +
'<div class="atom-editor-container">' +
'  <!-- 顶部标题栏 -->' +
'  <div class="atom-header">' +
'    <h3 style="margin:0;display:flex;align-items:center;gap:8px;">' +
'      <span style="font-size:24px;">⚛️</span> 原子引擎' +
'      <small style="color:var(--text-muted);font-size:13px;font-weight:400;">v5.0 Phase15</small>' +
'    </h3>' +
'    <span id="atomStatsBar" style="font-size:12px;color:var(--text-muted);">加载中...</span>' +
'  </div>' +

'  <!-- 三栏布局 -->' +
'  <div class="atom-body">' +
'    <!-- 左栏：AI拆解面板 -->' +
'    <div class="atom-panel atom-panel-input">' +
'      <div class="atom-panel-title"><i class="bi bi-magic"></i> AI 拆解</div>' +
'      <textarea id="atomInput" class="atom-input" rows="12" ' +
'        placeholder="粘贴提示词文本，AI自动拆解为结构化原子...&#10;&#10;支持：单条、长段落（自动分段）、OCR图片文字"></textarea>' +
'      <div class="atom-input-options">' +
'        <select id="atomMediaType" class="modal-input" style="flex:1;font-size:12px;padding:6px;">' +
'          <option value="image">🖼️ 图像提示词</option>' +
'          <option value="video">🎬 视频提示词</option>' +
'        </select>' +
'        <button id="btnAtomDecompose" class="btn-atom-primary">' +
'          <span id="btnAtomDecomposeIcon">🤖</span> AI拆解' +
'        </button>' +
'      </div>' +
'      <!-- 进度条 -->' +
'      <div id="atomProgress" class="atom-progress" style="display:none;">' +
'        <div class="atom-progress-bar"><div id="atomProgressFill" class="atom-progress-fill"></div></div>' +
'        <span id="atomProgressText" style="font-size:11px;color:var(--text-muted);">0/0</span>' +
'      </div>' +
'      <!-- 质量分 -->' +
'      <div id="atomQuality" class="atom-quality" style="display:none;"></div>' +
'    </div>' +

'    <!-- 中栏：原子列表 -->' +
'    <div class="atom-panel atom-panel-list">' +
'      <div class="atom-panel-title">' +
'        <i class="bi bi-diagram-3"></i> 拆解记录' +
'        <span id="atomListCount" style="font-size:11px;color:var(--text-muted);margin-left:auto;"></span>' +
'      </div>' +
'      <div id="atomList" class="atom-list">' +
'      <div class="atom-empty">输入提示词，点击「AI拆解」开始</div>' +
'      </div>' +
'    </div>' +

'    <!-- 右栏：统计 + 操作 -->' +
'    <div class="atom-panel atom-panel-stats">' +
'      <div class="atom-panel-title"><i class="bi bi-bar-chart"></i> 资产溯源</div>' +
'      <div id="atomStatsPanel" class="atom-stats-content">加载中...</div>' +
'      <hr style="margin:12px 0;border-color:var(--border-color);">' +
'      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">📥 批量导入</div>' +
'      <div style="display:flex;flex-direction:column;gap:6px;">' +
'        <button class="btn-atom-secondary" onclick="App._atomImportCSV()"><i class="bi bi-filetype-csv"></i> CSV 导入</button>' +
'        <button class="btn-atom-secondary" onclick="App._atomImportJSON()"><i class="bi bi-filetype-json"></i> JSON 导入</button>' +
'        <button class="btn-atom-secondary" onclick="App._atomImportTXT()"><i class="bi bi-filetype-txt"></i> TXT 导入</button>' +
'      </div>' +
'    </div>' +
'  </div>' +
'</div>';
};

// ============ 数据加载 ============
App._atomLoadStats = async function() {
    try {
        var d = await this.fetchJSON('/api/v4/atoms/stats');
        this.state.atomStats = d;
        var bar = document.getElementById('atomStatsBar');
        if (bar) {
            var t = d.totals || {};
            bar.textContent = '拆解:' + (t.decomposes||0) + ' | 变异:' + (t.variations||0) + ' | 桥接:' + (t.bridge_cards||0);
        }
        // 渲染统计面板
        var sp = document.getElementById('atomStatsPanel');
        if (sp) {
            sp.innerHTML = App._atomRenderStats(d);
        }
    } catch(e) { console.warn('atom stats error:', e); }
};

App._atomRenderStats = function(d) {
    var html = '';
    var top = d.top_atoms || [];
    if (top.length > 0) {
        html += '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">🔥 热门 Top5</div>';
        top.slice(0, 5).forEach(function(a, i) {
            html += '<div class="atom-stat-row"><span class="atom-stat-rank">#'+(i+1)+'</span> ' +
                    '<span class="atom-stat-type">['+a.type+']</span> ' +
                    '<span class="atom-stat-text">'+(a.text||'').slice(0,20)+'</span> ' +
                    '<span class="atom-stat-count">x'+a.ref_count+'</span></div>';
        });
    }
    var dead = d.dead_atoms || [];
    if (dead.length > 0) {
        html += '<div style="font-size:12px;font-weight:600;margin:10px 0 6px;color:#ef4444;">💀 死码检测 ('+dead.length+')</div>';
        dead.slice(0,3).forEach(function(a) {
            html += '<div class="atom-stat-row" style="color:var(--danger);">' +
                    (a.text||'').slice(0,20) + ' <small>未复用</small></div>';
        });
    }
    var td = d.type_distribution || [];
    if (td.length > 0) {
        html += '<div style="font-size:12px;font-weight:600;margin:10px 0 6px;">📊 类型分布</div>';
        td.forEach(function(t) {
            html += '<div class="atom-stat-row"><span style="flex:1;">'+t.type+'</span><span>'+t.count+'</span></div>';
        });
    }
    return html || '<div class="atom-empty">暂无统计数据</div>';
};

App._atomLoadList = async function() {
    try {
        var d = await this.fetchJSON('/api/v4/atoms/list?page_size=50');
        this.state.atomDecomposes = d.items || [];
        var list = document.getElementById('atomList');
        var count = document.getElementById('atomListCount');
        if (count) count.textContent = (d.total || 0) + ' 条记录';
        if (list) list.innerHTML = App._atomRenderDecomposeList(d.items || []);
    } catch(e) {
        console.warn('atom list error:', e);
        var list = document.getElementById('atomList');
        if (list) list.innerHTML = '<div class="atom-empty">加载失败: ' + e.message + '</div>';
    }
};

// ============ 拆解记录列表渲染 ============
// ============ 安全检查：HTML 转义 ============
var _escapeHtml = function(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
};

App._atomRenderDecomposeList = function(items) {
    if (!items || items.length === 0) return '<div class="atom-empty">暂无拆解记录<br><small>输入提示词，点击「AI拆解」开始</small></div>';
    var self = this;
    var selCount = this._atomSelectedRecords ? this._atomSelectedRecords.size : 0;
    var html = '';
    // 批量操作栏
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 10px;background:var(--bg-main);border-radius:8px;font-size:12px;color:var(--text-muted);">' +
        '<span>' + items.length + ' 条记录</span>' +
        '<span style="margin-left:auto;">' + (selCount > 0 ? '已选 ' + selCount + ' 条' : '') + '</span>' +
        '<button class="btn-atom-primary" onclick="event.stopPropagation();App._atomBatchArchive()" style="font-size:11px;padding:3px 12px;' + (selCount === 0 ? 'opacity:0.4;cursor:not-allowed;' : '') + '"' + (selCount === 0 ? ' title="勾选拆解记录后可批量归档"' : '') + '>📥 批量归档' + (selCount > 0 ? '(' + selCount + ')' : '') + '</button>' +
        '</div>';
    items.forEach(function(it, idx) {
        var sourcePreview = _escapeHtml((it.source_prompt || '').slice(0, 80));
        var mediaIcon = it.media_type === 'video' ? '🎬' : '🎨';
        var scoreColor = (it.quality_score||0) >= 0.8 ? 'var(--primary,#4f46e5)' : (it.quality_score||0) >= 0.5 ? '#f59e0b' : '#ef4444';
        var atomCount = (it.atoms || []).length;
        var isArchived = (it.bridge_count || 0) > 0;
        var isSelected = self._atomSelectedRecords && self._atomSelectedRecords.has(it.id);
        
        html += '<div class="atom-record' + (isSelected ? ' atom-record-selected' : '') + '" style="' + (isSelected ? 'border-color:var(--primary);background:rgba(79,70,229,0.03);' : '') + '" onclick="App._atomExpandRecord(' + it.id + ')">' +
            '<div class="atom-record-hd">' +
            '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation();App._atomToggleSelect(' + it.id + ', this)" style="margin-right:4px;flex-shrink:0;cursor:pointer;" title="选择此记录">' +
            '<span class="atom-record-media">' + mediaIcon + '</span>' +
            '<span class="atom-record-prompt" title="' + _escapeHtml(it.source_prompt||'') + '">' + sourcePreview + '</span>' +
            (isArchived ? '<span title="已归档" style="flex-shrink:0;font-size:14px;opacity:0.6;">🗄️</span>' : '') +
            '<span class="atom-record-score" style="color:' + scoreColor + ';font-weight:700;">' + (it.quality_score||0).toFixed(1) + '</span>' +
            '<span class="atom-record-count">' + atomCount + ' 原子 | ' + (it.var_count||0) + ' 变异 | ' + (it.bridge_count||0) + ' 卡片</span>' +
            '<span style="font-size:10px;color:var(--text-muted);">' + _escapeHtml((it.created_at||'').slice(0,16)) + '</span>' +
            '<button class="atom-record-del" onclick="event.stopPropagation();App._atomDeleteRecord(' + it.id + ')" title="删除">✕</button>' +
            '</div>' +
            '<div id="atomExpand_' + it.id + '" class="atom-record-expand" style="display:none;">' +
            '<div class="atom-record-atoms">' + App._atomRenderCards(it.atoms || []) + '</div>' +
            '<div class="atom-record-actions">' +
            '<button class="btn-atom-secondary" onclick="event.stopPropagation();App._atomArchive(' + it.id + ',\'' + encodeURIComponent(JSON.stringify(it.atoms||[])) + '\')">📥 归档到词卡</button>' +
            '<button class="btn-atom-secondary" style="border-color:#8b5cf6;color:#8b5cf6;" onclick="event.stopPropagation();App._atomSendToComposer(' + it.id + ')" title="归档后打开组装器调用原子词卡">♻ 发送到组装器</button>' +
            '</div></div></div>';
    });
    return html;
};

// ============ 展开/折叠记录 ============
App._atomExpandRecord = function(id) {
    var el = document.getElementById('atomExpand_' + id);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

// ============ 删除记录 ============
App._atomDeleteRecord = async function(id) {
    if (!confirm('确定删除此拆解记录？（级联删除变异+桥接+统计）')) return;
    try {
        await this.fetchJSON('/api/v4/atoms/decompose/' + id, { method: 'DELETE' });
        App.toast('已删除', 'success');
        await this._atomLoadList();
        await this._atomLoadStats();
    } catch(e) {
        App.toast('删除失败: ' + e.message, 'danger');
    }
};

// ============ 批量选择 ============
App._atomToggleSelect = function(id, checkbox) {
    if (!this._atomSelectedRecords) this._atomSelectedRecords = new Set();
    if (checkbox.checked) {
        this._atomSelectedRecords.add(id);
    } else {
        this._atomSelectedRecords.delete(id);
    }
    // 局部刷新列表（保留展开状态）
    var list = document.getElementById('atomList');
    if (list && this.state.atomDecomposes) {
        list.innerHTML = this._atomRenderDecomposeList(this.state.atomDecomposes);
    }
};

// ============ 批量归档 ============
App._atomBatchArchive = async function() {
    if (!this._atomSelectedRecords || this._atomSelectedRecords.size === 0) {
        App.toast('请先选择要归档的记录', 'warning');
        return;
    }
    var ids = Array.from(this._atomSelectedRecords);
    if (!confirm('批量归档 ' + ids.length + ' 条拆解记录到词卡分组？\\n已归档的记录会自动跳过。')) return;
    
    App.toast('批量归档中...', 'info');
    var success = 0, skip = 0, fail = 0;
    for (var i = 0; i < ids.length; i++) {
        var did = ids[i];
        try {
            var d = await this.fetchJSON('/api/v4/atoms/archive-to-group', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ decompose_id: did, atom_ids: [], create_groups: true }),
                _timeoutMs: 30000
            });
            if (d && d.ok) {
                success += (d.card_count || 0);
            } else if (d && d.error && d.error.indexOf('已归档') >= 0) {
                skip++;
            } else {
                fail++;
            }
        } catch(e) {
            fail++;
        }
    }
    App.toast('归档完成: ' + success + ' 卡片 / ' + skip + ' 跳过 / ' + fail + ' 失败', fail > 0 ? 'warning' : 'success');
    this._atomSelectedRecords.clear();
    await this._atomLoadList();
    await this._atomLoadStats();
    // 同步刷新全部词组 + 词卡管理侧边栏
    try { await App.loadGroupTree(); } catch(e) { console.warn('loadGroupTree refresh failed:', e); }
    if (App.state.currentGroupId) {
        try { await App.loadPrompts(App.state.currentGroupId); } catch(e) {}
    }
};

// ============ 核心操作：AI拆解 ============
App._atomDoDecompose = async function() {
    var input = document.getElementById('atomInput');
    var btn = document.getElementById('btnAtomDecompose');
    var btnIcon = document.getElementById('btnAtomDecomposeIcon');
    var mediaType = document.getElementById('atomMediaType');
    if (!input || !btn) return;

    var text = input.value.trim();
    if (!text) { App.toast('请先输入提示词文本'); return; }

    // UI 锁定
    this.state.atomIsDecomposing = true;
    btn.disabled = true;
    btnIcon.textContent = '⏳';

    // 显示进度条
    var prog = document.getElementById('atomProgress');
    if (prog) prog.style.display = 'block';
    App._atomSetProgress(10, 'AI 拆解中...');

    try {
        // 判断短文本/长文本
        var endpoint = text.length <= 200 ? '/api/v4/atoms/decompose' : '/api/v4/atoms/decompose/text';
        var body = text.length <= 200
            ? { prompt: text, media_type: (mediaType ? mediaType.value : 'image') }
            : { text: text, source_type: 'manual', media_type: (mediaType ? mediaType.value : 'image') };

        var d = await this.fetchJSON(endpoint, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), _timeoutMs: 180000 });
        if (!d || !d.ok) { App._atomSetProgress(0, '请求失败'); App.toast('AI拆解请求失败，请刷新重试', 'danger'); return; }
        App._atomSetProgress(100, '完成！');

        // 渲染结果
        var atoms = d.atoms || [];
        var quality = document.getElementById('atomQuality');
        if (quality) {
            quality.style.display = 'block';
            var score = d.quality_score || 0;
            var color = score >= 0.8 ? '#22c55e' : score >= 0.5 ? '#f59e0b' : '#ef4444';
            quality.innerHTML = '<span style="color:'+color+';">质量分: ' + score.toFixed(2) + '</span>' +
                ' | 原子数: ' + atoms.length + ' | ' +
                (d.cached ? '⚡缓存命中' : '🤖AI生成') +
                (d.text_length ? ' | 文本长度: ' + d.text_length : '') +
                (d.segments ? ' | 分段: ' + d.segments : '');

            // 归档按钮
            if (atoms.length > 0) {
                quality.innerHTML += ' <button class="btn-atom-primary" style="margin-left:8px;font-size:11px;padding:3px 10px;" ' +
                    'onclick="App._atomArchive(' + (d.id || d.decompose_ids ? (d.id || (d.decompose_ids||[])[0]) : 0) + ', \'' +
                    encodeURIComponent(JSON.stringify(atoms)) + '\')">📥 归档到词卡</button>';
            }
        }

        // 渲染原子卡片
        var list = document.getElementById('atomList');
        if (list) {
            list.innerHTML = App._atomRenderCards(atoms);
        }

        // 刷新统计 + 列表
        await App._atomLoadStats();
        await App._atomLoadList();

        // 隐藏进度条
        setTimeout(function() {
            var p = document.getElementById('atomProgress');
            if (p) p.style.display = 'none';
        }, 2000);

    } catch(e) {
        App.toast('拆解失败: ' + e.message, 'danger');
        App._atomSetProgress(0, '失败');
    } finally {
        this.state.atomIsDecomposing = false;
        btn.disabled = false;
        btnIcon.textContent = '🤖';
    }
};

// ============ 原子卡片渲染 ============
App._atomRenderCards = function(atoms) {
    if (!atoms || atoms.length === 0) return '<div class="atom-empty">无拆解结果</div>';
    var html = '';
    atoms.forEach(function(a, i) {
        var typeLabel = a.type || 'creative';
        var typeColor = {
            'style': '#8b5cf6', 'lighting': '#f59e0b', 'color': '#ec4899',
            'composition': '#06b6d4', 'camera': '#22c55e', 'quality': '#3b82f6',
            'subject': '#ef4444', 'atmosphere': '#a855f7', 'negative': '#6b7280',
            'creative': '#f97316', 'constraint': '#64748b', 'tone': '#14b8a6',
            'action': '#84cc16'
        }[typeLabel] || '#94a3b8';

        html += '<div class="atom-card">' +
            '<span class="atom-card-type" style="background:'+_escapeHtml(typeColor)+';">' + _escapeHtml(typeLabel) + '</span>' +
            '<span class="atom-card-text" title="' + _escapeHtml(a.text||'') + '">' + _escapeHtml((a.text||'').slice(0, 60)) + '</span>' +
            '<span class="atom-card-weight">w:' + (a.weight||0).toFixed(1) + '</span>' +
            (a.keywords && a.keywords.length ? '<span class="atom-card-kw">' + _escapeHtml(a.keywords.slice(0,3).join(', ')) + '</span>' : '') +
            '</div>';
    });
    return html;
};

// ============ 进度条 ============
App._atomSetProgress = function(pct, text) {
    var fill = document.getElementById('atomProgressFill');
    var txt = document.getElementById('atomProgressText');
    if (fill) fill.style.width = pct + '%';
    if (txt) txt.textContent = text || (pct + '%');
};

// ============ 归档到词卡 ============
App._atomArchive = async function(decomposeId, atomsJsonEncoded) {
    try {
        var atoms = JSON.parse(decodeURIComponent(atomsJsonEncoded));
        if (!atoms || atoms.length === 0) return;
    } catch(e) { return App.toast('原子数据解析失败', 'danger'); }

    // 确认弹窗
    var ok = confirm('将 ' + atoms.length + ' 个原子归档到词卡分组？\n会自动创建 [原子] 类型分组并按语义分类。');
    if (!ok) return;

    try {
        var d = await this.fetchJSON('/api/v4/atoms/archive-to-group', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ decompose_id: decomposeId || 0, atom_ids: [], create_groups: true }),
            _timeoutMs: 60000
        });
        if (!d || !d.ok) { App.toast('归档失败，请检查网络后重试', 'danger'); return; }
        App.toast('已归档 ' + (d.card_count || 0) + ' 个词卡到分组', 'success');
        await App._atomLoadStats();
        await App._atomLoadList();
        // 同步刷新全部词组 + 词卡管理侧边栏
        try { await App.loadGroupTree(); } catch(e) { console.warn('loadGroupTree refresh failed:', e); }
        // 如果当前正在词卡管理页，刷新当前分组卡片列表
        if (App.state.currentGroupId) {
            try { await App.loadPrompts(App.state.currentGroupId); } catch(e) {}
        }
    } catch(e) {
        App.toast('归档失败: ' + e.message, 'danger');
    }
};

// ============ 发送到组装器 ============
App._atomSendToComposer = async function(decomposeId) {
    // 先归档（幂等：已归档自动跳过）
    App.toast('归档并跳转到组装器...', 'info');
    try {
        var d = await this.fetchJSON('/api/v4/atoms/archive-to-group', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ decompose_id: decomposeId, atom_ids: [], create_groups: true }),
            _timeoutMs: 30000
        });
        if (d && d.ok) {
            // 刷新全部词组侧边栏（组装器需要最新数据）
            try { await App.loadGroupTree(); } catch(e) {}
            // 切换到组装器
            App.switchView('seedance');
            setTimeout(function() {
                App.switchSeedanceTab('composer');
                App.toast('已归档并打开组装器 — 点击右侧底部「⚛ 原子引擎」调用词卡', 'success');
            }, 300);
        } else {
            App.toast('归档失败，请检查网络后重试', 'danger');
        }
    } catch(e) {
        App.toast('跳转失败: ' + e.message, 'danger');
    }
};

// ============ 导入 ============
App._atomImportCSV = function() {
    App.toast('CSV 批量导入：将打开文件选择器，选择 .csv 文件自动拆解', 'info');
    // 简化版：提示功能可用性
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.csv';
    inp.onchange = async function(e) {
        var file = e.target.files[0];
        if (!file) return;
        App.toast('CSV 导入中...', 'info');
        var form = new FormData();
        form.append('file', file);
        try {
            var d = await App.fetchJSON('/api/v4/atoms/import/csv?auto_archive=true', {
                method: 'POST', body: form, headers: {}
            });
            App.toast('导入完成: ' + (d.success||0) + '/' + (d.total||0) + ' 条', 'success');
            await App._atomLoadStats();
        } catch(e) { App.toast('导入失败: ' + e.message, 'danger'); }
    };
    inp.click();
};

App._atomImportJSON = function() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = async function(e) {
        var file = e.target.files[0];
        if (!file) return;
        App.toast('JSON 导入中...', 'info');
        var form = new FormData();
        form.append('file', file);
        try {
            var d = await App.fetchJSON('/api/v4/atoms/import/json?auto_archive=true', {
                method: 'POST', body: form, headers: {}
            });
            App.toast('导入完成: ' + (d.success||0) + '/' + (d.total||0) + ' 条', 'success');
            await App._atomLoadStats();
        } catch(e) { App.toast('导入失败: ' + e.message, 'danger'); }
    };
    inp.click();
};

App._atomImportTXT = function() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.txt';
    inp.onchange = async function(e) {
        var file = e.target.files[0];
        if (!file) return;
        App.toast('TXT 导入中...', 'info');
        var form = new FormData();
        form.append('file', file);
        try {
            var d = await App.fetchJSON('/api/v4/atoms/import/txt?auto_archive=true', {
                method: 'POST', body: form, headers: {}
            });
            App.toast('导入完成: ' + (d.success||0) + '/' + (d.total||0) + ' 条', 'success');
            await App._atomLoadStats();
        } catch(e) { App.toast('导入失败: ' + e.message, 'danger'); }
    };
    inp.click();
};

// ============ 事件绑定 ============
App._atomBindEvents = function() {
    // AI拆解按钮
    var btn = document.getElementById('btnAtomDecompose');
    if (btn) {
        btn.onclick = function() { App._atomDoDecompose(); };
    }

    // 回车快速拆解
    var inp = document.getElementById('atomInput');
    if (inp) {
        inp.onkeydown = function(e) {
            if (e.ctrlKey && e.key === 'Enter') {
                App._atomDoDecompose();
            }
        };
    }
};

// 初始化完成
console.log('[atom_editor] Phase16 原子编辑器已就绪 (v5.0)');

})();
