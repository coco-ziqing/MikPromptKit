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

// ============ 兼容：App.toast → App.showToast ============
App.toast = function(msg, type) { App.showToast(msg, type || 'success'); };

// ============ 视图切换 ============
App._atomOriginSwitchView = App.switchView;
App.switchView = function(view, ...args) {
    if (view === 'atom_editor') {
        this._showAtomEditor();
        return;
    }
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
    var html = '';
    items.forEach(function(it, idx) {
        var sourcePreview = _escapeHtml((it.source_prompt || '').slice(0, 80));
        var mediaIcon = it.media_type === 'video' ? '🎬' : '🎨';
        var scoreColor = (it.quality_score||0) >= 0.8 ? 'var(--primary,#4f46e5)' : (it.quality_score||0) >= 0.5 ? '#f59e0b' : '#ef4444';
        var atomCount = (it.atoms || []).length;
        
        html += '<div class="atom-record" onclick="App._atomExpandRecord(' + it.id + ')">' +
            '<div class="atom-record-hd">' +
            '<span class="atom-record-media">' + mediaIcon + '</span>' +
            '<span class="atom-record-prompt" title="' + _escapeHtml(it.source_prompt||'') + '">' + sourcePreview + '</span>' +
            '<span class="atom-record-score" style="color:' + scoreColor + ';font-weight:700;">' + (it.quality_score||0).toFixed(1) + '</span>' +
            '<span class="atom-record-count">' + atomCount + ' 原子 | ' + (it.var_count||0) + ' 变异 | ' + (it.bridge_count||0) + ' 卡片</span>' +
            '<span style="font-size:10px;color:var(--text-muted);">' + _escapeHtml((it.created_at||'').slice(0,16)) + '</span>' +
            '<button class="atom-record-del" onclick="event.stopPropagation();App._atomDeleteRecord(' + it.id + ')" title="删除">✕</button>' +
            '</div>' +
            '<div id="atomExpand_' + it.id + '" class="atom-record-expand" style="display:none;">' +
            '<div class="atom-record-atoms">' + App._atomRenderCards(it.atoms || []) + '</div>' +
            '<div class="atom-record-actions">' +
            '<button class="btn-atom-secondary" onclick="event.stopPropagation();App._atomArchive(' + it.id + ',\'' + encodeURIComponent(JSON.stringify(it.atoms||[])) + '\')">📥 归档到词卡</button>' +
            '<button class="btn-atom-secondary" onclick="event.stopPropagation();App._atomShowVariations(' + it.id + ')">🔄 生成变异</button>' +
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

// ============ 变异生成弹窗 ============
App._atomShowVariations = async function(decomposeId) {
    var atoms = [];
    var record = (this.state.atomDecomposes || []).find(function(r) { return r.id === decomposeId; });
    if (record) atoms = record.atoms || [];
    if (!atoms.length) { App.toast('无原子数据', 'danger'); return; }
    App.toast('变异生成中...', 'info');
    try {
        var d = await this.fetchJSON('/api/v4/atoms/variations', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ decompose_id: decomposeId, atoms_json: JSON.stringify(atoms), count: 3, locked_ids: [] })
        });
        if (d.ok && d.variations) {
            var msg = '生成 ' + d.count + ' 个变体:\n';
            d.variations.forEach(function(v, i) { msg += (i+1) + '. ' + (v.text||'').slice(0, 80) + '\n'; });
            alert(msg);
            await this._atomLoadList();
            await this._atomLoadStats();
        }
    } catch(e) { App.toast('变异失败: ' + e.message, 'danger'); }
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

        var d = await this.fetchJSON(endpoint, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
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
            '<span class="atom-card-text">' + _escapeHtml((a.text||'').slice(0, 60)) + '</span>' +
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
            body: JSON.stringify({
                decompose_id: decomposeId || 0,
                atom_ids: [],
                create_groups: true
            })
        });
        App.toast('已归档 ' + (d.card_count || 0) + ' 个词卡到分组', 'success');
        await App._atomLoadStats();
    } catch(e) {
        App.toast('归档失败: ' + e.message, 'danger');
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
