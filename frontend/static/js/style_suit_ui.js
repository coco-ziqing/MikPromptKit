// v5.48.1: 角色设定集系统前端 — 角色设定集库 + 5-Tab 编辑器弹窗 + 角色组装工作台 + 生成结果面板（简化交互版，无拖拽）
// 依赖: App.fetchJSON / App._escape / PK_AUTH_CLIENT._token
(function() {
'use strict';

// ==================== 等待 App 就绪 ====================
(function _wait() {
    try { if (!App || !App.fetchJSON || !App.switchView) { setTimeout(_wait, 200); return; } }
    catch(e) { setTimeout(_wait, 200); return; }
    _init();
})();

function _init() {

// ==================== 常量 ====================
var TABS = [
    { key: 'all',      label: '全部' },
    { key: 'user',     label: '自建' },
    { key: 'system',   label: '系统预置' },
    { key: 'favorite', label: '收藏' },
    { key: 'trash',    label: '回收站' }
];

var OUTPUT_PARTS = [
    { key: 'main',        label: '主角色定图' },
    { key: 'three_view',  label: '三视图' },
    { key: 'face',        label: '面部特写' },
    { key: 'costume',     label: '服饰特写' },
    { key: 'expressions', label: '表情合集' }
];

// ==================== 全局状态 ====================
var state = {
    tab: 'all',
    q: '',
    items: [],
    current: null,          // 当前选中套装（详情面板）
    editor: null,           // 编辑器弹窗数据
    editorIsNew: false,
    workbench: {            // 组装工作台装配状态（会话级）
        name: '默认装配',
        base_asset_ref: {},
        rune_card_ids: [],
        suit_id: 0,
        suit_config: null,
        accessory_list: [],
        channel: 'virtual',
        config_override: {},
        draftId: null
    },
    batches: []
};

// ==================== 工具 ====================
function _esc(s) { return App._escape ? App._escape(s) : String(s == null ? '' : s); }
function _now() { return new Date().toLocaleString('zh-CN', { hour12: false }); }

function _token() {
    try {
        if (window.PK_AUTH_CLIENT && PK_AUTH_CLIENT._token) return PK_AUTH_CLIENT._token;
    } catch(e) {}
    return localStorage.getItem('pk_token') || '';
}

function _authHeaders(extra) {
    var h = Object.assign({}, extra || {});
    var t = _token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
}

async function _api(url, opts) {
    var options = Object.assign({}, opts || {});
    options.headers = _authHeaders(options.headers || {});
    var d = await App.fetchJSON(url, options);
    if (!d) throw new Error('请求失败（请确认已登录）');
    return d;
}

function _showToast(msg, isErr) {
    try {
        if (App._toast) { App._toast(msg, isErr ? 'error' : 'success'); return; }
    } catch(e) {}
    alert((isErr ? '⚠️ ' : '✅ ') + msg);
}

function _confirm(msg) {
    try {
        if (App.confirmDialog) return App.confirmDialog(msg);
    } catch(e) {}
    return window.confirm(msg);
}

// ==================== 视图面板注册 ====================
function _ensurePanel(id) {
    var el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'view-panel';
        document.getElementById('mainContent').appendChild(el);
    }
    return el;
}

function _activatePanel(id) {
    var el = _ensurePanel(id);
    // 隐藏所有视图（与 App.switchView 行为一致）
    document.querySelectorAll('.view-panel').forEach(function(x) { x.classList.remove('active-view'); });
    el.classList.add('active-view');
    return el;
}

// ==================== 入口：switchView 挂载 ====================
// 在 App.switchView 无 style_suit 分支时由导航直接调用本函数
window.STYLE_SUIT = {
    open: function() { _openBag(); },
    openBag: function() { _openBag(); },
    openEditor: function(id) { _openEditor(id); },
    openWorkbench: function() { _openWorkbench(); },
    openResult: function(batchId) { _openResult(batchId); }
};

// ==================== ① 角色设定集库 ====================
async function _openBag() {
    _activatePanel('viewStyleSuit');
    // v5.50.3: 进入页面自动折叠侧边栏，最大化内容区
    try { if (App._collapseSidebar) App._collapseSidebar(); } catch(e) {}
    var el = document.getElementById('viewStyleSuit');
    el.innerHTML = _bagShell();
    _bindBagEvents(el);
    await _loadSuits();
}

function _bagShell() {
    var tabsHtml = TABS.map(function(t) {
        return '<button class="suit-tab-btn" data-tab="' + t.key + '">' + t.label + '</button>';
    }).join('');
    return '' +
    '<div class="suit-bag">' +
      '<div class="suit-bag-header">' +
        '<div class="suit-bag-title"><i class="bi bi-magic"></i> 角色设定集</div>' +
        '<div class="suit-bag-actions">' +
          '<button class="suit-btn suit-btn-primary" id="suitBtnNew"><i class="bi bi-plus-lg"></i> 新建角色设定集</button>' +
          '<button class="suit-btn" id="suitBtnImport" title="导入 .style 文件"><i class="bi bi-box-arrow-in-down"></i> 导入</button>' +
          '<button class="suit-btn" id="suitBtnWorkbench" title="打开角色组装工作台"><i class="bi bi-tools"></i> 组装工作台</button>' +
        '</div>' +
      '</div>' +
      '<div class="suit-bag-tabs">' + tabsHtml + '</div>' +
      '<div class="suit-bag-toolbar">' +
        '<input type="text" class="suit-search" id="suitSearch" placeholder="搜索名称 / 标签 / 备注...">' +
        '<span class="suit-count" id="suitCount"></span>' +
      '</div>' +
      '<div class="suit-bag-body">' +
        '<div class="suit-grid" id="suitGrid"></div>' +
        '<div class="suit-detail" id="suitDetail"></div>' +
      '</div>' +
    '</div>';
}

function _bindBagEvents(el) {
    el.querySelectorAll('.suit-tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            state.tab = btn.getAttribute('data-tab');
            el.querySelectorAll('.suit-tab-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            _loadSuits();
        });
    });
    var search = el.querySelector('#suitSearch');
    search.addEventListener('input', function() {
        state.q = search.value.trim();
        _loadSuits();
    });
    el.querySelector('#suitBtnNew').addEventListener('click', function() { _openEditor(null); });
    el.querySelector('#suitBtnImport').addEventListener('click', _importSuit);
    el.querySelector('#suitBtnWorkbench').addEventListener('click', function() { _openWorkbench(); });
}

async function _loadSuits() {
    var el = document.getElementById('viewStyleSuit');
    if (!el) return;
    var grid = el.querySelector('#suitGrid');
    var count = el.querySelector('#suitCount');
    grid.innerHTML = '<div class="suit-empty">加载中...</div>';
    try {
        var params = 'tab=' + encodeURIComponent(state.tab);
        if (state.q) params += '&q=' + encodeURIComponent(state.q);
        var d = await _api('/api/style-packs?' + params);
        state.items = d.items || [];
        count.textContent = state.tab === 'trash' ? '回收站 ' + state.items.length + ' 项' : '共 ' + state.items.length + ' 套';
        _renderGrid(el, state.items);
    } catch(e) {
        grid.innerHTML = '<div class="suit-empty" style="color:#ef4444;">' + _esc(e.message) + '</div>';
    }
}

function _renderGrid(el, items) {
    var grid = el.querySelector('#suitGrid');
    if (!items.length) {
        grid.innerHTML = '<div class="suit-empty"><div class="suit-empty-icon">🧰</div><p>' +
            (state.tab === 'trash' ? '回收站空空如也' : '还没有风格模板，点击右上角「新建角色设定集」创建第一套风格模板！') + '</p></div>';
        return;
    }
    var html = '';
    items.forEach(function(it) {
        var tags = (it.tags || []).slice(0, 3).map(function(t) { return '<span class="suit-tag">' + _esc(t) + '</span>'; }).join('');
        var cover = it.cover_image ? '<img class="suit-cover" src="' + _esc(it.cover_image) + '" onerror="this.style.display=\'none\'">' : '<div class="suit-cover suit-cover-fallback">🎨</div>';
        var fav = it.is_favorite ? '<i class="bi bi-star-fill suit-star"></i>' : '';
        var badge = it.source === 'system' ? '<span class="suit-badge">预置</span>' : '';
        html += '<div class="suit-card" data-id="' + it.id + '" data-name="' + _esc(it.name) + '">' +
          cover + fav + badge +
          '<div class="suit-card-name">' + _esc(it.name) + '</div>' +
          '<div class="suit-card-tags">' + tags + '</div>' +
          '<div class="suit-card-actions">' +
            _cardActions(it) +
          '</div>' +
        '</div>';
    });
    grid.innerHTML = html;
    // 绑定事件
    grid.querySelectorAll('.suit-card').forEach(function(card) {
        card.addEventListener('click', function(ev) {
            if (ev.target.closest('.suit-card-action')) return; // 按钮点击不触发选中
            var id = parseInt(card.getAttribute('data-id'), 10);
            var it = state.items.find(function(x) { return x.id === id; });
            if (it) _showDetail(it);
        });
        // v5.50.0: 右键菜单
        card.addEventListener('contextmenu', function(ev) {
            ev.preventDefault();
            var id = parseInt(card.getAttribute('data-id'), 10);
            var it = state.items.find(function(x) { return x.id === id; });
            _showContextMenu(ev.clientX, ev.clientY, it);
        });
    });
    grid.querySelectorAll('.suit-card-action').forEach(function(btn) {
        btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var id = parseInt(btn.getAttribute('data-id'), 10);
            var act = btn.getAttribute('data-act');
            _handleCardAction(id, act);
        });
    });
}

function _cardActions(it) {
    if (state.tab === 'trash') {
        return '<button class="suit-card-action" data-act="restore" data-id="' + it.id + '" title="恢复">♻️</button>' +
               '<button class="suit-card-action" data-act="purge" data-id="' + it.id + '" title="永久删除">🗑️</button>';
    }
    return '<button class="suit-card-action" data-act="edit" data-id="' + it.id + '" title="编辑">✏️</button>' +
           '<button class="suit-card-action" data-act="dup" data-id="' + it.id + '" title="复制衍生">📋</button>' +
           '<button class="suit-card-action" data-act="export" data-id="' + it.id + '" title="导出 .style">⬇️</button>' +
           (it.is_favorite
               ? '<button class="suit-card-action" data-act="unfav" data-id="' + it.id + '" title="取消收藏">⭐</button>'
               : '<button class="suit-card-action" data-act="fav" data-id="' + it.id + '" title="收藏">☆</button>') +
           '<button class="suit-card-action" data-act="del" data-id="' + it.id + '" title="删除">🗑️</button>';
}

async function _handleCardAction(id, act) {
    try {
        if (act === 'edit') { _openEditor(id); return; }
        if (act === 'rename') {
            var it = state.items.find(function(x) { return x.id === id; });
            var nn = prompt('重命名套装：', it ? it.name : '');
            if (!nn || !nn.trim()) return;
            await _api('/api/style-packs/' + id, { method: 'PUT', body: JSON.stringify({ name: nn.trim() }) });
            _showToast('已重命名');
        } else if (act === 'dup') {
            if (!_confirm('复制该风格模板为新模板？')) return;
            await _api('/api/style-packs/' + id + '/duplicate', { method: 'POST' });
            _showToast('已复制为新模板');
        } else if (act === 'export') {
            var d = await _api('/api/style-packs/' + id + '/export');
            _downloadStyle(d.doc, d.filename);
        } else if (act === 'fav') {
            await _api('/api/style-packs/' + id + '/favorite', { method: 'PUT', body: JSON.stringify({ fav: true }) });
        } else if (act === 'unfav') {
            await _api('/api/style-packs/' + id + '/favorite', { method: 'PUT', body: JSON.stringify({ fav: false }) });
        } else if (act === 'del') {
            if (!_confirm('移入回收站？')) return;
            await _api('/api/style-packs/' + id, { method: 'DELETE' });
        } else if (act === 'restore') {
            await _api('/api/style-packs/' + id + '/restore', { method: 'POST' });
        } else if (act === 'purge') {
            if (!_confirm('永久删除该风格模板？不可恢复！')) return;
            await _api('/api/style-packs/' + id + '?force=true', { method: 'DELETE' });
        }
        await _loadSuits();
    } catch(e) {
        _showToast(e.message, true);
    }
}

function _showContextMenu(x, y, it) {
    // 移除旧菜单
    var old = document.getElementById('suitCtxMenu');
    if (old) old.remove();
    if (!it) return;
    var isTrash = state.tab === 'trash';
    var items = isTrash ? [
        { act: 'restore', icon: '♻️', label: '恢复' },
        { act: 'purge', icon: '🗑️', label: '永久删除' }
    ] : [
        { act: 'edit', icon: '✏️', label: '编辑' },
        { act: 'rename', icon: '🏷️', label: '重命名' },
        { act: 'dup', icon: '📋', label: '复制衍生' },
        { act: 'export', icon: '⬇️', label: '导出 .style' },
        it.is_favorite
            ? { act: 'unfav', icon: '⭐', label: '取消收藏' }
            : { act: 'fav', icon: '☆', label: '收藏' },
        { act: 'del', icon: '🗑️', label: '移入回收站' }
    ];
    var menu = document.createElement('div');
    menu.id = 'suitCtxMenu';
    menu.className = 'suit-ctx-menu';
    menu.style.left = Math.min(x, window.innerWidth - 160) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - items.length * 34 - 10) + 'px';
    menu.innerHTML = '<div class="suit-ctx-title">' + _esc(it.name) + '</div>' +
        items.map(function(m) {
            return '<div class="suit-ctx-item" data-act="' + m.act + '" data-id="' + it.id + '">' + m.icon + ' ' + m.label + '</div>';
        }).join('');
    document.body.appendChild(menu);
    menu.querySelectorAll('.suit-ctx-item').forEach(function(item) {
        item.addEventListener('click', function() {
            var act = item.getAttribute('data-act');
            var id = parseInt(item.getAttribute('data-id'), 10);
            menu.remove();
            _handleCardAction(id, act);
        });
    });
    // 点击别处关闭
    setTimeout(function() {
        document.addEventListener('click', function _close() {
            var m = document.getElementById('suitCtxMenu');
            if (m) m.remove();
            document.removeEventListener('click', _close);
        }, { once: true });
    }, 10);
}

function _showDetail(it) {
    state.current = it;
    var el = document.getElementById('viewStyleSuit');
    if (!el) return;
    var detail = el.querySelector('#suitDetail');
    var cfg = it.config || {};
    var words = cfg.style_words || {};
    var rp = cfg.render_params || {};
    var parts = (cfg.output_parts || []).map(function(p) {
        var m = OUTPUT_PARTS.find(function(x) { return x.key === p; });
        return '<span class="suit-tag">' + _esc(m ? m.label : p) + '</span>';
    }).join('');
    var layout = cfg.layout || {};
    detail.innerHTML = '' +
      '<div class="suit-detail-head">' +
        '<div class="suit-detail-name">' + _esc(it.name) + '</div>' +
        '<div class="suit-detail-meta">v' + it.version_count + ' · ' + (it.source === 'system' ? '系统预置' : '自建') + ' · 更新于 ' + _esc(it.updated_at || '') + '</div>' +
      '</div>' +
      (it.remark ? '<div class="suit-detail-remark">' + _esc(it.remark) + '</div>' : '') +
      '<div class="suit-detail-section"><div class="suit-detail-label">🎨 风格词条</div>' +
        '<div class="suit-detail-line"><b>正向：</b>' + _esc(words.positive || '（空）') + '</div>' +
        '<div class="suit-detail-line"><b>负面：</b>' + _esc(words.negative || '（空）') + '</div></div>' +
      '<div class="suit-detail-section"><div class="suit-detail-label">⚙️ 生成参数</div>' +
        '<div class="suit-detail-line">模型 ' + _esc(rp.model_version || '5.0') + ' · ' + _esc(rp.ratio || '1:1') + ' · ' + _esc(rp.resolution_type || '2k') +
        ' · CFG ' + _esc(rp.cfg) + ' · 步数 ' + _esc(rp.steps) + '</div></div>' +
      '<div class="suit-detail-section"><div class="suit-detail-label">📦 视图资产</div><div>' + (parts || '<span class="suit-tag">主角色定图</span>') + '</div></div>' +
      '<div class="suit-detail-section"><div class="suit-detail-label">🖼️ 整合排版</div>' +
        '<div class="suit-detail-line">模板 ' + _esc(layout.template || 'default') + ' · 色卡 ' + (layout.color_card ? '开' : '关') + ' · 标题 ' + _esc(layout.title_text || '（无）') + '</div></div>' +
      '<div class="suit-detail-actions">' +
        '<button class="suit-btn suit-btn-primary" id="suitDetailEdit">✏️ 编辑</button>' +
        '<button class="suit-btn" id="suitDetailAssemble">🧩 载入组装工作台</button>' +
        '<button class="suit-btn" id="suitDetailExport">⬇️ 导出</button>' +
        '<button class="suit-btn" id="suitDetailVersions">📜 版本</button>' +
      '</div>';
    detail.querySelector('#suitDetailEdit').addEventListener('click', function() { _openEditor(it.id); });
    detail.querySelector('#suitDetailAssemble').addEventListener('click', function() {
        state.workbench.suit_id = it.id;
        state.workbench.suit_config = it.config || {};
        _showToast('套装已载入组装工作台');
        _openWorkbench();
    });
    detail.querySelector('#suitDetailExport').addEventListener('click', async function() {
        try {
            var d = await _api('/api/style-packs/' + it.id + '/export');
            _downloadStyle(d.doc, d.filename);
        } catch(e) { _showToast(e.message, true); }
    });
    detail.querySelector('#suitDetailVersions').addEventListener('click', function() { _showVersions(it.id); });
}

function _downloadStyle(doc, filename) {
    var blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'suit.style';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

function _importSuit() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.style,.json';
    input.addEventListener('change', async function() {
        var file = input.files && input.files[0];
        if (!file) return;
        try {
            var text = await file.text();
            var doc = JSON.parse(text);
            if (doc.format !== 'mikpromptkit.style-pack') throw new Error('不是有效的 .style 套装文件');
            var d = await _api('/api/style-packs/import', { method: 'POST', body: JSON.stringify(doc) });
            _showToast('导入成功：' + (d.item ? d.item.name : ''));
            _loadSuits();
        } catch(e) {
            _showToast('导入失败：' + e.message, true);
        }
    });
    input.click();
}

async function _showVersions(suitId) {
    try {
        var d = await _api('/api/style-packs/' + suitId + '/versions');
        var items = d.items || [];
        var html = '<div class="suit-modal-mask" onclick="if(event.target===this)this.remove()"><div class="suit-modal suit-modal-md">' +
          '<div class="suit-modal-head"><span>📜 版本历史（' + items.length + '）</span><button class="suit-modal-close" onclick="this.closest(\'.suit-modal-mask\').remove()">×</button></div>' +
          '<div class="suit-modal-body">';
        if (!items.length) html += '<div class="suit-empty">暂无版本</div>';
        items.forEach(function(v) {
            html += '<div class="suit-version-row">' +
              '<span class="suit-version-tag">v' + v.version + '</span>' +
              '<span class="suit-version-name">' + _esc(v.name_snapshot || '') + '</span>' +
              '<span class="suit-version-time">' + _esc(v.created_at || '') + '</span>' +
              '<button class="suit-btn suit-btn-sm" data-vid="' + v.id + '">回滚</button>' +
            '</div>';
        });
        html += '</div></div></div>';
        var mask = document.createElement('div');
        mask.innerHTML = html;
        document.body.appendChild(mask.firstChild);
        var modal = document.body.lastElementChild;
        modal.querySelectorAll('[data-vid]').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                if (!_confirm('回滚到该版本？当前配置将生成新快照。')) return;
                try {
                    await _api('/api/style-packs/' + suitId + '/rollback', { method: 'POST', body: JSON.stringify({ version_id: parseInt(btn.getAttribute('data-vid'), 10) }) });
                    _showToast('已回滚');
                    modal.remove();
                    _loadSuits();
                } catch(e) { _showToast(e.message, true); }
            });
        });
    } catch(e) {
        _showToast(e.message, true);
    }
}

// ==================== ② 套装编辑器弹窗（5 Tab） ====================
async function _openEditor(id) {
    state.editorIsNew = !id;
    if (id) {
        try {
            var d = await _api('/api/style-packs/' + id);
            state.editor = d.item;
        } catch(e) { _showToast(e.message, true); return; }
    } else {
        state.editor = {
            id: null, name: '', tags: [], remark: '', cover_image: '',
            config: {
                style_words: { positive: '', negative: '' },
                render_params: { canvas_size: '1:1', denoise: 0.6, cfg: 5.0, sampler: '', steps: 25, layer_render: false, model_version: '5.0', ratio: '1:1', resolution_type: '2k' },
                output_parts: ['main'],
                layout: { template: 'default', color_card: true, title_text: '', bg_color: '#1a1a2e' },
                meta: {}
            }
        };
    }
    _renderEditor();
}

function _editorTab(tabKey) {
    var e = state.editor;
    var cfg = e.config || {};
    var words = cfg.style_words || {};
    var rp = cfg.render_params || {};
    var layout = cfg.layout || {};
    var parts = cfg.output_parts || [];
    if (tabKey === 'words') {
        return '<div class="suit-form">' +
          '<label class="suit-form-label">模板固定正向画风词（加载自动追加）</label>' +
          '<textarea class="suit-input suit-textarea" id="edWordsPos" rows="4" placeholder="例：电影级写实，35mm镜头，浅景深，皮肤细节真实...">' + _esc(words.positive || '') + '</textarea>' +
          '<label class="suit-form-label">模板独立负面词（区别于全局负面）</label>' +
          '<textarea class="suit-input suit-textarea" id="edWordsNeg" rows="3" placeholder="例：卡通，变形，低质量...">' + _esc(words.negative || '') + '</textarea>' +
        '</div>';
    }
    if (tabKey === 'render') {
        return '<div class="suit-form suit-form-grid">' +
          '<label class="suit-form-label">模型版本<input class="suit-input" id="edRpModel" value="' + _esc(rp.model_version || '5.0') + '"></label>' +
          '<label class="suit-form-label">画幅比例<select class="suit-input" id="edRpRatio">' +
            ['21:9','16:9','3:2','4:3','1:1','3:4','2:3','9:16'].map(function(r) { return '<option value="' + r + '"' + (rp.ratio === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="suit-form-label">分辨率<select class="suit-input" id="edRpRes">' +
            ['1k','2k','4k'].map(function(r) { return '<option value="' + r + '"' + (rp.resolution_type === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="suit-form-label">CFG<input type="number" step="0.5" class="suit-input" id="edRpCfg" value="' + _esc(rp.cfg != null ? rp.cfg : 5.0) + '"></label>' +
          '<label class="suit-form-label">采样步数<input type="number" class="suit-input" id="edRpSteps" value="' + _esc(rp.steps != null ? rp.steps : 25) + '"></label>' +
          '<label class="suit-form-label">重绘幅度<input type="number" step="0.05" class="suit-input" id="edRpDenoise" value="' + _esc(rp.denoise != null ? rp.denoise : 0.6) + '"></label>' +
          '<label class="suit-form-label">采样器<input class="suit-input" id="edRpSampler" value="' + _esc(rp.sampler || '') + '" placeholder="dpmpp_2m"></label>' +
        '</div>';
    }
    if (tabKey === 'output') {
        return '<div class="suit-form"><label class="suit-form-label">默认批量生成资产（自由勾选）</label>' +
          '<div class="suit-check-list">' +
          OUTPUT_PARTS.map(function(p) {
            var checked = parts.indexOf(p.key) >= 0 ? ' checked' : '';
            return '<label class="suit-check-item"><input type="checkbox" class="edPartCk" value="' + p.key + '"' + checked + '> ' + p.label + '</label>';
          }).join('') +
          '</div></div>';
    }
    if (tabKey === 'layout') {
        return '<div class="suit-form">' +
          '<label class="suit-form-label">人设总图布局模板<select class="suit-input" id="edLayoutTpl">' +
            ['default','portrait','grid4','wide'].map(function(t) { return '<option value="' + t + '"' + (layout.template === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="suit-form-label">色卡<input type="checkbox" id="edLayoutColor" ' + (layout.color_card ? 'checked' : '') + '> 开启角色色卡</label>' +
          '<label class="suit-form-label">标题文字模板<input class="suit-input" id="edLayoutTitle" value="' + _esc(layout.title_text || '') + '" placeholder="角色设定"></label>' +
          '<label class="suit-form-label">画布底色<input type="color" class="suit-input suit-color" id="edLayoutBg" value="' + _esc(layout.bg_color || '#1a1a2e') + '"></label>' +
        '</div>';
    }
    // base
    var tagsStr = (e.tags || []).join(',');
    return '<div class="suit-form">' +
      '<label class="suit-form-label">模板名称<input class="suit-input" id="edName" value="' + _esc(e.name || '') + '" placeholder="必填"></label>' +
      '<label class="suit-form-label">自定义标签（逗号分隔）<input class="suit-input" id="edTags" value="' + _esc(tagsStr) + '" placeholder="影视写实,二次元,国风"></label>' +
      '<label class="suit-form-label">备注<textarea class="suit-input suit-textarea" id="edRemark" rows="3" placeholder="模板说明...">' + _esc(e.remark || '') + '</textarea></label>' +
      '<label class="suit-form-label">封面图 URL<input class="suit-input" id="edCover" value="' + _esc(e.cover_image || '') + '" placeholder="可选"></label>' +
    '</div>';
}

function _renderEditor() {
    var e = state.editor;
    var cfg = e.config || {};
    var html = '' +
    '<div class="suit-modal-mask" id="suitEditorMask" onclick="if(event.target===this)window.STYLE_SUIT._closeEditor()">' +
      '<div class="suit-modal suit-modal-lg">' +
        '<div class="suit-modal-head"><span>' + (state.editorIsNew ? '🎨 新建角色设定集' : '🎨 编辑角色设定集：' + _esc(e.name)) + '</span>' +
          '<button class="suit-modal-close" onclick="window.STYLE_SUIT._closeEditor()">×</button></div>' +
        '<div class="suit-editor-tabs">' +
          '<button class="suit-editor-tab active" data-tab="words">① 风格词条</button>' +
          '<button class="suit-editor-tab" data-tab="render">② 生成参数</button>' +
          '<button class="suit-editor-tab" data-tab="output">③ 视图资产</button>' +
          '<button class="suit-editor-tab" data-tab="layout">④ 整合排版</button>' +
          '<button class="suit-editor-tab" data-tab="base">⑤ 基础信息</button>' +
        '</div>' +
        '<div class="suit-editor-body" id="suitEditorBody">' + _editorTab('words') + '</div>' +
        '<div class="suit-modal-foot">' +
          '<button class="suit-btn" id="edBtnCancel">取消</button>' +
          '<button class="suit-btn" id="edBtnSaveAs">另存为新模板</button>' +
          '<button class="suit-btn suit-btn-primary" id="edBtnSave">' + (state.editorIsNew ? '创建角色设定集' : '保存') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    var mask = document.createElement('div');
    mask.innerHTML = html;
    document.body.appendChild(mask.firstChild);
    var modal = document.getElementById('suitEditorMask');
    // Tab 切换
    modal.querySelectorAll('.suit-editor-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
            modal.querySelectorAll('.suit-editor-tab').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            document.getElementById('suitEditorBody').innerHTML = _editorTab(btn.getAttribute('data-tab'));
        });
    });
    modal.querySelector('#edBtnCancel').addEventListener('click', function() { _closeEditor(); });
    modal.querySelector('#edBtnSave').addEventListener('click', function() { _saveEditor(false); });
    modal.querySelector('#edBtnSaveAs').addEventListener('click', function() { _saveEditor(true); });
}

function _collectEditorConfig() {
    var cfg = {
        style_words: {
            positive: document.getElementById('edWordsPos') ? document.getElementById('edWordsPos').value : '',
            negative: document.getElementById('edWordsNeg') ? document.getElementById('edWordsNeg').value : ''
        },
        render_params: {
            model_version: document.getElementById('edRpModel') ? document.getElementById('edRpModel').value : '5.0',
            ratio: document.getElementById('edRpRatio') ? document.getElementById('edRpRatio').value : '1:1',
            resolution_type: document.getElementById('edRpRes') ? document.getElementById('edRpRes').value : '2k',
            cfg: parseFloat(document.getElementById('edRpCfg') ? document.getElementById('edRpCfg').value : 5.0),
            steps: parseInt(document.getElementById('edRpSteps') ? document.getElementById('edRpSteps').value : 25, 10),
            denoise: parseFloat(document.getElementById('edRpDenoise') ? document.getElementById('edRpDenoise').value : 0.6),
            sampler: document.getElementById('edRpSampler') ? document.getElementById('edRpSampler').value : '',
            canvas_size: document.getElementById('edRpRatio') ? document.getElementById('edRpRatio').value : '1:1',
            layer_render: false
        },
        output_parts: [],
        layout: {
            template: document.getElementById('edLayoutTpl') ? document.getElementById('edLayoutTpl').value : 'default',
            color_card: document.getElementById('edLayoutColor') ? document.getElementById('edLayoutColor').checked : true,
            title_text: document.getElementById('edLayoutTitle') ? document.getElementById('edLayoutTitle').value : '',
            bg_color: document.getElementById('edLayoutBg') ? document.getElementById('edLayoutBg').value : '#1a1a2e'
        },
        meta: {}
    };
    document.querySelectorAll('#suitEditorMask .edPartCk:checked').forEach(function(c) { cfg.output_parts.push(c.value); });
    if (!cfg.output_parts.length) cfg.output_parts = ['main'];
    return cfg;
}

function _collectEditorBase() {
    var name = document.getElementById('edName') ? document.getElementById('edName').value.trim() : '';
    var tagsStr = document.getElementById('edTags') ? document.getElementById('edTags').value : '';
    var tags = tagsStr.split(/[,，]/).map(function(t) { return t.trim(); }).filter(Boolean);
    return {
        name: name,
        tags: tags,
        remark: document.getElementById('edRemark') ? document.getElementById('edRemark').value : '',
        cover_image: document.getElementById('edCover') ? document.getElementById('edCover').value : ''
    };
}

async function _saveEditor(asNew) {
    var base = _collectEditorBase();
    if (!base.name) { _showToast('模板名称必填', true); return; }
    var cfg = _collectEditorConfig();
    cfg.meta = { name: base.name, tags: base.tags, remark: base.remark, cover: base.cover_image };
    try {
        if (state.editorIsNew || asNew || !state.editor.id) {
            var body = Object.assign({}, base, { config: cfg });
            await _api('/api/style-packs', { method: 'POST', body: JSON.stringify(body) });
            _showToast(asNew ? '已另存为新模板' : '风格模板创建成功');
        } else {
            await _api('/api/style-packs/' + state.editor.id, { method: 'PUT', body: JSON.stringify({ config: cfg, name: base.name, tags: base.tags, remark: base.remark, cover_image: base.cover_image }) });
            _showToast('风格模板已保存（新版本已快照）');
        }
        _closeEditor();
        _loadSuits();
    } catch(e) {
        _showToast('保存失败：' + e.message, true);
    }
}

function _closeEditor() {
    var m = document.getElementById('suitEditorMask');
    if (m) m.remove();
    state.editor = null;
}

window.STYLE_SUIT._closeEditor = _closeEditor;

// ==================== ③ 组装工作台（简化交互版：点击装配） ====================
async function _openWorkbench() {
    _activatePanel('viewAssembleWorkbench');
    // v5.50.3: 进入工作台自动折叠侧边栏
    try { if (App._collapseSidebar) App._collapseSidebar(); } catch(e) {}
    var el = document.getElementById('viewAssembleWorkbench');
    await _renderWorkbench(el);
    // 尝试加载历史装配记录
    _loadDrafts();
}

async function _renderWorkbench(el) {
    var w = state.workbench;
    var suitName = '';
    if (w.suit_id && w.suit_config) suitName = w.suit_config.meta ? (w.suit_config.meta.name || '') : '';
    el.innerHTML = '' +
    '<div class="suit-workbench">' +
      '<div class="suit-wb-header">' +
        '<div class="suit-bag-title"><i class="bi bi-tools"></i> 角色组装工作台</div>' +
        '<div class="suit-wb-header-actions">' +
          '<button class="suit-btn" id="wbBtnDrafts" title="历史装配记录">📋 草稿</button>' +
          '<button class="suit-btn suit-btn-primary" id="wbBtnRender">🚀 提交批量生成</button>' +
        '</div>' +
      '</div>' +
      '<div class="suit-wb-body">' +
        // 左：资源库（简化点击添加）
        '<div class="suit-wb-left">' +
          '<div class="suit-wb-panel-title">🧰 资源库（点击添加）</div>' +
          '<div class="suit-wb-res-tabs">' +
            '<button class="suit-wb-res-tab active" data-res="base">素材</button>' +
            '<button class="suit-wb-res-tab" data-res="cards">词卡</button>' +
            '<button class="suit-wb-res-tab" data-res="suits">套装</button>' +
          '</div>' +
          '<div class="suit-wb-res-list" id="wbResList"><div class="suit-empty">加载中...</div></div>' +
        '</div>' +
        // 中：四层组装结构
        '<div class="suit-wb-mid">' +
          '<div class="suit-slot suit-slot-base" id="slotBase">' +
            '<div class="suit-slot-label">① 角色基底层 <span class="suit-slot-req">必填</span></div>' +
            '<div class="suit-slot-body" id="slotBaseBody"><div class="suit-slot-empty">点击左侧素材添加角色基底参考</div></div>' +
          '</div>' +
          '<div class="suit-slot" id="slotRunes">' +
            '<div class="suit-slot-label">② 风格词条层 <span class="suit-slot-multi">可叠加 · 排序 · 删除</span></div>' +
            '<div class="suit-slot-body" id="slotRunesBody"><div class="suit-slot-empty">点击左侧词条添加（可叠加）</div></div>' +
          '</div>' +
          '<div class="suit-slot suit-slot-suit" id="slotSuit">' +
            '<div class="suit-slot-label">③ 风格模板层 <span class="suit-slot-req">唯一</span></div>' +
            '<div class="suit-slot-body" id="slotSuitBody"><div class="suit-slot-empty">点击左侧模板一键加载全套配置</div></div>' +
          '</div>' +
          '<div class="suit-slot" id="slotAccessory">' +
            '<div class="suit-slot-label">④ 视图资产选配 <span class="suit-slot-multi">临时增减视图资产</span></div>' +
            '<div class="suit-slot-body" id="slotAccessoryBody"></div>' +
          '</div>' +
        '</div>' +
        // 右：实时预览
        '<div class="suit-wb-right">' +
          '<div class="suit-wb-panel-title">👁️ 实时预览</div>' +
          '<div class="suit-preview" id="wbPreview">' +
            '<div class="suit-preview-empty">组装完成后此处显示完整提示词与生成参数</div>' +
          '</div>' +
          '<div class="suit-wb-panel-title" style="margin-top:12px;">🧩 视图资产</div>' +
          '<div class="suit-parts-picker" id="wbParts">' +
            OUTPUT_PARTS.map(function(p) {
              return '<label class="suit-check-item"><input type="checkbox" class="wbPartCk" value="' + p.key + '"> ' + p.label + '</label>';
            }).join('') +
          '</div>' +
          '<div class="suit-wb-channel">' +
            '<span class="suit-wb-panel-title" style="margin:0;">🛡️ 风控通道</span>' +
            '<select class="suit-input" id="wbChannel">' +
              '<option value="virtual"' + (w.channel === 'virtual' ? ' selected' : '') + '>脱敏虚拟通道</option>' +
              '<option value="real"' + (w.channel === 'real' ? ' selected' : '') + '>写实商用通道通道（需授权）</option>' +
            '</select>' +
          '</div>' +
          '<div class="suit-wb-tools">' +
            '<button class="suit-btn" id="wbBtnSaveDraft">💾 保存装配记录</button>' +
            '<button class="suit-btn" id="wbBtnClear">🗑️ 清空组装</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
    _bindWorkbench(el);
    _renderSlots(el);
    _renderPreview(el);
    _renderParts(el);
    _loadRes('base');
}

function _bindWorkbench(el) {
    el.querySelectorAll('.suit-wb-res-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
            el.querySelectorAll('.suit-wb-res-tab').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            _loadRes(btn.getAttribute('data-res'));
        });
    });
    el.querySelector('#wbBtnRender').addEventListener('click', _submitRender);
    el.querySelector('#wbBtnSaveDraft').addEventListener('click', _saveDraft);
    el.querySelector('#wbBtnClear').addEventListener('click', function() {
        if (!_confirm('清空当前组装？')) return;
        state.workbench = {
            name: '默认装配', base_asset_ref: {}, rune_card_ids: [], suit_id: 0,
            suit_config: null, accessory_list: [], channel: 'virtual',
            config_override: {}, draftId: null
        };
        _renderSlots(el); _renderPreview(el); _renderParts(el);
        _showToast('已清空');
    });
    el.querySelector('#wbBtnDrafts').addEventListener('click', _showDraftList);
    el.querySelector('#wbChannel').addEventListener('change', function() {
        state.workbench.channel = this.value;
        _renderPreview(el);
    });
    el.querySelectorAll('.wbPartCk').forEach(function(ck) {
        ck.addEventListener('change', function() { _renderPreview(el); });
    });
}

async function _loadRes(type) {
    var list = document.getElementById('wbResList');
    if (!list) return;
    list.innerHTML = '<div class="suit-empty">加载中...</div>';
    try {
        if (type === 'suits') {
            var d = await _api('/api/style-packs?tab=all');
            var items = (d.items || []).filter(function(x) { return !x.is_deleted; });
            list.innerHTML = items.length ? items.map(function(it) {
                return '<div class="suit-res-item suit-res-suit" data-id="' + it.id + '">' +
                  '<div class="suit-res-name">🎨 ' + _esc(it.name) + '</div>' +
                  '<div class="suit-res-sub">' + (it.tags || []).slice(0, 2).map(function(t) { return '<span class="suit-tag">' + _esc(t) + '</span>'; }).join('') + '</div>' +
                  '<button class="suit-btn suit-btn-sm suit-res-add">载入</button>' +
                '</div>';
            }).join('') : '<div class="suit-empty">暂无套装</div>';
            list.querySelectorAll('.suit-res-suit').forEach(function(item) {
                item.querySelector('.suit-res-add').addEventListener('click', function() {
                    _assembleSuit(parseInt(item.getAttribute('data-id'), 10));
                });
            });
        } else if (type === 'cards') {
            // 词卡：从词库 picker 取（真实接口返回 groups 结构）
            var d = await App.fetchJSON('/api/v4/word-cards/picker?limit=30');
            var groups = (d && d.groups) || [];
            var cards = [];
            groups.forEach(function(g) { (g.cards || []).forEach(function(c) { cards.push(c); }); });
            list.innerHTML = cards.length ? cards.map(function(c, i) {
                var cid = c.id;
                return '<div class="suit-res-item suit-res-card" data-id="' + cid + '">' +
                  '<div class="suit-res-name">📇 ' + _esc(c.name || ('词卡 ' + cid)) + '</div>' +
                  '<div class="suit-res-sub">' + _esc((c.content || '').slice(0, 40)) + '</div>' +
                  '<button class="suit-btn suit-btn-sm suit-res-add">添加</button>' +
                '</div>';
            }).join('') : '<div class="suit-empty">暂无词卡</div>';
            list.querySelectorAll('.suit-res-card').forEach(function(item) {
                item.querySelector('.suit-res-add').addEventListener('click', function() {
                    _addRuneCard(parseInt(item.getAttribute('data-id'), 10));
                });
            });
        } else {
            // 素材：占位 + 手动输入
            list.innerHTML = '<div class="suit-empty">请填写基底素材引用：</div>' +
              '<div class="suit-form" style="padding:8px;">' +
              '<input class="suit-input" id="wbBaseDesc" placeholder="描述（例：青年男性，正脸）">' +
              '<input class="suit-input" id="wbBaseUrl" placeholder="图片 URL（可选）" style="margin-top:6px;">' +
              '<button class="suit-btn suit-btn-primary" id="wbBaseAdd" style="margin-top:6px;width:100%;">+ 设为基底</button>' +
              '</div>';
            document.getElementById('wbBaseAdd').addEventListener('click', function() {
                var desc = document.getElementById('wbBaseDesc').value.trim();
                var url = document.getElementById('wbBaseUrl').value.trim();
                if (!desc && !url) { _showToast('请填写描述或图片 URL', true); return; }
                state.workbench.base_asset_ref = { source: 'manual', id: 0, url: url, desc: desc };
                _renderSlots(document.getElementById('viewAssembleWorkbench'));
                _renderPreview(document.getElementById('viewAssembleWorkbench'));
                _showToast('基底已设置');
            });
        }
    } catch(e) {
        list.innerHTML = '<div class="suit-empty" style="color:#ef4444;">' + _esc(e.message) + '</div>';
    }
}

async function _assembleSuit(suitId) {
    try {
        var d = await _api('/api/style-packs/' + suitId);
        var it = d.item;
        state.workbench.suit_id = suitId;
        state.workbench.suit_config = it.config || {};
        var el = document.getElementById('viewAssembleWorkbench');
        _renderSlots(el); _renderPreview(el); _renderParts(el);
        _showToast('风格模板已载入：' + it.name);
    } catch(e) {
        _showToast(e.message, true);
    }
}

function _addRuneCard(cardId) {
    var w = state.workbench;
    if (w.rune_card_ids.indexOf(cardId) >= 0) { _showToast('该词条已在层中'); return; }
    w.rune_card_ids.push(cardId);
    var el = document.getElementById('viewAssembleWorkbench');
    _renderSlots(el); _renderPreview(el);
    _showToast('词条已添加（可继续叠加）');
}

function _renderSlots(el) {
    var w = state.workbench;
    // 基底
    var baseBody = el.querySelector('#slotBaseBody');
    if (baseBody) {
        var b = w.base_asset_ref || {};
        if (b.desc || b.url) {
            baseBody.innerHTML = '<div class="suit-slot-filled">' +
              '<span class="suit-slot-filled-icon">🧑</span>' +
              '<span>' + _esc(b.desc || b.url) + '</span>' +
              '<button class="suit-card-action" data-act="rmbase" title="移除">×</button></div>';
            baseBody.querySelector('[data-act="rmbase"]').addEventListener('click', function() {
                w.base_asset_ref = {}; _renderSlots(el); _renderPreview(el);
            });
        } else {
            baseBody.innerHTML = '<div class="suit-slot-empty">点击左侧素材添加角色基底参考</div>';
        }
    }
    // 风格词条
    var runesBody = el.querySelector('#slotRunesBody');
    if (runesBody) {
        if (!w.rune_card_ids.length) {
            runesBody.innerHTML = '<div class="suit-slot-empty">点击左侧词条添加（可叠加）</div>';
        } else {
            runesBody.innerHTML = w.rune_card_ids.map(function(cid, idx) {
                return '<div class="suit-rune-chip" data-id="' + cid + '">' +
                  '<span class="suit-rune-idx">' + (idx + 1) + '</span>' +
                  '<span class="suit-rune-name">词卡 #' + cid + '</span>' +
                  '<button class="suit-card-action" data-act="rmrune" data-id="' + cid + '" title="移除">×</button>' +
                '</div>';
            }).join('');
            runesBody.querySelectorAll('[data-act="rmrune"]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    w.rune_card_ids = w.rune_card_ids.filter(function(x) { return x !== parseInt(btn.getAttribute('data-id'), 10); });
                    _renderSlots(el); _renderPreview(el);
                });
            });
        }
    }
    // 风格模板
    var suitBody = el.querySelector('#slotSuitBody');
    if (suitBody) {
        if (w.suit_id && w.suit_config) {
            var nm = (w.suit_config.meta && w.suit_config.meta.name) || ('套装 #' + w.suit_id);
            suitBody.innerHTML = '<div class="suit-slot-filled suit-slot-suit-filled">' +
              '<span class="suit-slot-filled-icon">🎨</span>' +
              '<span>' + _esc(nm) + '</span>' +
              '<button class="suit-card-action" data-act="rmsuit" title="移除">×</button></div>';
            suitBody.querySelector('[data-act="rmsuit"]').addEventListener('click', function() {
                w.suit_id = 0; w.suit_config = null;
                _renderSlots(el); _renderPreview(el); _renderParts(el);
            });
        } else {
            suitBody.innerHTML = '<div class="suit-slot-empty">点击左侧模板一键加载全套配置</div>';
        }
    }
    // 视图资产
    var accBody = el.querySelector('#slotAccessoryBody');
    if (accBody) {
        var parts = _effectiveParts(w);
        accBody.innerHTML = parts.map(function(p) {
            var m = OUTPUT_PARTS.find(function(x) { return x.key === p; });
            return '<span class="suit-tag suit-tag-lg">' + _esc(m ? m.label : p) + '</span>';
        }).join('') || '<div class="suit-slot-empty">勾选右侧视图资产</div>';
    }
}

function _effectiveParts(w) {
    var parts = (w.suit_config && w.suit_config.output_parts) ? w.suit_config.output_parts.slice() : [];
    (w.accessory_list || []).forEach(function(acc) {
        var p = typeof acc === 'string' ? acc : (acc.part || '');
        if (p && parts.indexOf(p) < 0) parts.push(p);
    });
    return parts;
}

function _renderParts(el) {
    var w = state.workbench;
    var base = (w.suit_config && w.suit_config.output_parts) || [];
    el.querySelectorAll('.wbPartCk').forEach(function(ck) {
        ck.checked = base.indexOf(ck.value) >= 0;
    });
}

function _renderPreview(el) {
    var w = state.workbench;
    var pv = el.querySelector('#wbPreview');
    if (!pv) return;
    var cfg = w.suit_config || {};
    var words = cfg.style_words || {};
    var rp = cfg.render_params || {};
    var pos = (words.positive || '').trim();
    var neg = (words.negative || '').trim();
    var parts = _effectiveParts(w);
    var suitName = (cfg.meta && cfg.meta.name) || '';
    var html = '';
    if (!w.base_asset_ref || (!w.base_asset_ref.desc && !w.base_asset_ref.url)) {
        html = '<div class="suit-preview-empty">① 缺少基底素材</div>';
    } else if (!w.suit_id) {
        html = '<div class="suit-preview-empty">③ 缺少风格模板层</div>';
    } else {
        html += '<div class="suit-preview-line"><b>🎨 套装：</b>' + _esc(suitName) + '</div>';
        html += '<div class="suit-preview-line"><b>🧑 基底：</b>' + _esc(w.base_asset_ref.desc || w.base_asset_ref.url || '') + '</div>';
        html += '<div class="suit-preview-line"><b>📇 词卡：</b>' + w.rune_card_ids.length + ' 张</div>';
        html += '<div class="suit-preview-line"><b>📦 产出：</b>' + parts.map(function(p) {
            var m = OUTPUT_PARTS.find(function(x) { return x.key === p; });
            return _esc(m ? m.label : p);
        }).join('、') + '</div>';
        html += '<div class="suit-preview-section"><b>正向词：</b>' + _esc(pos || '（套装未配置，将使用词卡内容）') + '</div>';
        if (neg) html += '<div class="suit-preview-section"><b>负面词：</b>' + _esc(neg) + '</div>';
        html += '<div class="suit-preview-section"><b>参数：</b>模型 ' + _esc(rp.model_version || '5.0') + ' · ' + _esc(rp.ratio || '1:1') + ' · ' + _esc(rp.resolution_type || '2k') +
          ' · CFG ' + _esc(rp.cfg) + ' · 步数 ' + _esc(rp.steps) + '</div>';
        html += '<div class="suit-preview-section"><b>🛡️ 通道：</b>' + (w.channel === 'real' ? '写实商用通道' : '脱敏虚拟通道') + '</div>';
        if (w.channel === 'real') {
            var ratio2 = rp.ratio || '1:1';
            var sizeMap = {'21:9':'1344x576','16:9':'1216x832','3:2':'1216x832','4:3':'896x1152','1:1':'1024x1024','3:4':'896x1152','2:3':'832x1216','9:16':'832x1216'};
            var resMap = {'1k':'1024','2k':'2048','4k':'4096'};
            html += '<div class="suit-preview-warn">🛡️ 写实通道参数映射：比例 ' + _esc(ratio2) + ' → 尺寸 ' + (sizeMap[ratio2] || '1024x1024') +
              ' · 分辨率 ' + _esc(rp.resolution_type || '2k') + ' → 基础边长 ' + (resMap[rp.resolution_type || '2k'] || '2048') + 'px</div>';
            html += '<div class="suit-preview-warn">📌 模型由 ComfyUI 工作流节点决定，套装模型标记仅供参考</div>';
        }
        html += '<div class="suit-preview-warn">⚠️ 生成将真实消耗生成额度，提交前请确认</div>';
    }
    pv.innerHTML = html;
}

async function _saveDraft() {
    var w = state.workbench;
    if (!w.base_asset_ref || (!w.base_asset_ref.desc && !w.base_asset_ref.url)) { _showToast('请先设置基底素材', true); return; }
    try {
        var body = {
            name: '组装工作台草稿 ' + _now(),
            base_asset_ref: w.base_asset_ref,
            rune_card_ids: w.rune_card_ids,
            suit_id: w.suit_id,
            accessory_list: w.accessory_list,
            channel: w.channel,
            config_override: w.config_override
        };
        var d = await _api('/api/assemble/draft', { method: 'POST', body: JSON.stringify(body) });
        state.workbench.draftId = d.item.id;
        _showToast('装配记录已保存 #' + d.item.id);
    } catch(e) {
        _showToast('保存失败：' + e.message, true);
    }
}

async function _showDraftList() {
    try {
        var d = await _api('/api/assemble/draft');
        var items = d.items || [];
        var html = '<div class="suit-modal-mask" onclick="if(event.target===this)this.remove()"><div class="suit-modal suit-modal-md">' +
          '<div class="suit-modal-head"><span>📋 历史装配记录</span><button class="suit-modal-close" onclick="this.closest(\'.suit-modal-mask\').remove()">×</button></div>' +
          '<div class="suit-modal-body">';
        if (!items.length) html += '<div class="suit-empty">暂无草稿</div>';
        items.forEach(function(dr) {
            html += '<div class="suit-version-row">' +
              '<span class="suit-version-tag">#' + dr.id + '</span>' +
              '<span class="suit-version-name">' + _esc(dr.name) + '</span>' +
              '<span class="suit-version-time">' + _esc(dr.updated_at || '') + '</span>' +
              '<button class="suit-btn suit-btn-sm" data-load="' + dr.id + '">加载</button>' +
            '</div>';
        });
        html += '</div></div></div>';
        var mask = document.createElement('div');
        mask.innerHTML = html;
        document.body.appendChild(mask.firstChild);
        mask.firstChild.querySelectorAll('[data-load]').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                try {
                    var d2 = await _api('/api/assemble/draft/' + btn.getAttribute('data-load'));
                    var it = d2.item;
                    state.workbench = {
                        name: it.name, base_asset_ref: it.base_asset_ref || {}, rune_card_ids: it.rune_card_ids || [],
                        suit_id: it.suit_id || 0, suit_config: null, accessory_list: it.accessory_list || [],
                        channel: it.channel || 'virtual', config_override: it.config_override || {}, draftId: it.id
                    };
                    if (state.workbench.suit_id) {
                        try {
                            var sd = await _api('/api/style-packs/' + state.workbench.suit_id);
                            state.workbench.suit_config = sd.item.config || {};
                        } catch(e2) {}
                    }
                    mask.firstChild.remove();
                    var el = document.getElementById('viewAssembleWorkbench');
                    _renderSlots(el); _renderPreview(el); _renderParts(el);
                    _showToast('装配记录已加载');
                } catch(e) { _showToast(e.message, true); }
            });
        });
    } catch(e) {
        _showToast(e.message, true);
    }
}

async function _submitRender() {
    var w = state.workbench;
    if (!w.base_asset_ref || (!w.base_asset_ref.desc && !w.base_asset_ref.url)) { _showToast('请先设置基底素材（①必填）', true); return; }
    if (!w.suit_id) { _showToast('请先载入风格模板（③必填）', true); return; }
    if (w.channel === 'real' && !_confirm('写实商用通道通道需要授权备案，确认继续？')) return;
    if (!_confirm('将真实提交批量生成任务并消耗生成额度，确认继续？')) return;
    try {
        // 先保存装配记录拿 draftId
        var draft = state.workbench.draftId;
        if (!draft) {
            var db = await _api('/api/assemble/draft', { method: 'POST', body: JSON.stringify({
                name: '组装工作台草稿 ' + _now(),
                base_asset_ref: w.base_asset_ref,
                rune_card_ids: w.rune_card_ids,
                suit_id: w.suit_id,
                accessory_list: w.accessory_list,
                channel: w.channel,
                config_override: w.config_override
            }) });
            draft = db.item.id;
            state.workbench.draftId = draft;
        }
        var body = { draft_id: draft, license_info: { authorized: w.channel !== 'real' } };
        var d = await _api('/api/assemble/render', { method: 'POST', body: JSON.stringify(body) });
        _showToast('生成已提交，批次 #' + d.batch.id + '（' + d.batch.total + ' 个产出项）');
        _openResult(d.batch.id);
    } catch(e) {
        _showToast('提交失败：' + e.message, true);
    }
}

// ==================== ④ 结果面板 ====================
async function _openResult(batchId) {
    _activatePanel('viewSuitResult');
    var el = document.getElementById('viewSuitResult');
    el.innerHTML = '<div class="suit-result"><div class="suit-empty">加载批次 #' + batchId + '...</div></div>';
    try {
        var d = await _api('/api/assemble/render/' + batchId);
        _renderResult(el, d.batch);
    } catch(e) {
        el.innerHTML = '<div class="suit-result"><div class="suit-empty" style="color:#ef4444;">' + _esc(e.message) + '</div></div>';
    }
}

function _renderResult(el, batch) {
    var tasks = batch.tasks || [];
    var statusMap = {
        'queued': '<span class="suit-status suit-status-queued">排队中</span>',
        'running': '<span class="suit-status suit-status-running">生成中</span>',
        'done': '<span class="suit-status suit-status-done">已完成</span>',
        'success': '<span class="suit-status suit-status-done">已完成</span>',
        'fail': '<span class="suit-status suit-status-fail">失败</span>',
        'canceled': '<span class="suit-status suit-status-canceled">已取消</span>'
    };
    var progress = batch.total ? Math.round((batch.done + batch.fail) / batch.total * 100) : 0;
    // v5.50.0: 任务级进度（terminal 状态 100% / running 用 progress 字段）
    var doneCnt = 0, failCnt = 0, runCnt = 0;
    tasks.forEach(function(t) {
        if (t.status === 'done' || t.status === 'success') doneCnt++;
        else if (t.status === 'fail') failCnt++;
        else if (t.status === 'queued' || t.status === 'running') runCnt++;
    });
    var html = '' +
    '<div class="suit-result">' +
      '<div class="suit-wb-header">' +
        '<div class="suit-bag-title"><i class="bi bi-images"></i> 生成结果 · 批次 #' + batch.id + '</div>' +
        '<div class="suit-wb-header-actions">' +
          '<button class="suit-btn" id="resBtnRefresh">🔄 刷新</button>' +
          '<button class="suit-btn" id="resBtnBack">⬅️ 返回组装工作台</button>' +
        '</div>' +
      '</div>' +
      '<div class="suit-result-summary">' +
        '<div class="suit-result-bar"><div class="suit-result-bar-inner" style="width:' + progress + '%"></div></div>' +
        '<div class="suit-result-stats">共 ' + batch.total + ' · 完成 ' + batch.done + ' · 失败 ' + batch.fail + ' · ' + progress + '%</div>' +
        '<div class="suit-result-agg">' +
          '<span class="suit-agg-chip">✅ 完成 <b>' + doneCnt + '</b></span>' +
          '<span class="suit-agg-chip">⏳ 进行中 <b>' + runCnt + '</b></span>' +
          '<span class="suit-agg-chip">❌ 失败 <b>' + failCnt + '</b></span>' +
          '<span class="suit-agg-chip">🎯 总进度 <b>' + progress + '%</b></span>' +
        '</div>' +
      '</div>' +
      '<div class="suit-result-grid">' +
        tasks.map(function(t) {
            var label = (OUTPUT_PARTS.find(function(p) { return p.key === t.task_type; }) || {}).label || t.task_type;
            var pct = 0;
            if (t.status === 'done' || t.status === 'success') pct = 100;
            else if (t.status === 'fail' || t.status === 'canceled') pct = 100;
            else pct = Math.min(parseInt(t.progress || 0, 10), 99);
            var pcls = (t.status === 'done' || t.status === 'success') ? 'done' : (t.status === 'fail' ? 'fail' : '');
            return '<div class="suit-task-card">' +
              '<div class="suit-task-name">' + _esc(label) + '</div>' +
              '<div class="suit-task-status">' + (statusMap[t.status] || _esc(t.status)) + '</div>' +
              '<div class="suit-task-progress"><div class="suit-task-progress-inner ' + pcls + '" style="width:' + pct + '%"></div></div>' +
              (t.fail_category ? '<div class="suit-task-err">' + _esc(t.fail_category) + '</div>' : '') +
              (t.error ? '<div class="suit-task-err">' + _esc(String(t.error).slice(0, 80)) + '</div>' : '') +
              (t.result_filename ? '<div class="suit-task-file">📄 ' + _esc(t.result_filename) + '</div>' : '') +
            '</div>';
        }).join('') +
      '</div>' +
      '<div class="suit-result-foot">' +
        '<div class="suit-result-actions">' +
          '<button class="suit-btn" id="resBtnCompose" title="Pillow 合成整合人设拼贴图 + 角色色卡">🖼️ 整合拼贴</button>' +
          '<button class="suit-btn" id="resBtnArchive" title="归档为角色档案（rolecard）">📁 角色归档</button>' +
          '<button class="suit-btn" id="resBtnExport" title="下载全套资产 zip">📦 导出资产包</button>' +
        '</div>' +
        '<div class="suit-hint" id="resHint" style="margin-top:8px;">💡 拼贴图 / 色卡 / 归档 / 导出需批次有已完成资产</div>' +
        '<div id="resComposeResult" style="margin-top:10px;"></div>' +
      '</div>' +
    '</div>';
    el.innerHTML = html;
    el.querySelector('#resBtnRefresh').addEventListener('click', async function() {
        try {
            var d = await _api('/api/assemble/render/' + batch.id + '/refresh', { method: 'POST' });
            _renderResult(el, d.batch);
        } catch(e) { _showToast(e.message, true); }
    });
    el.querySelector('#resBtnBack').addEventListener('click', function() { _openWorkbench(); });
    el.querySelector('#resBtnCompose').addEventListener('click', function() { _composeSheet(batch.id, el); });
    el.querySelector('#resBtnArchive').addEventListener('click', function() { _archiveRole(batch.id, el); });
    el.querySelector('#resBtnExport').addEventListener('click', function() { _exportBatch(batch.id); });
    // 自动轮询（批次未终态）
    if (batch.status === 'queued' || batch.status === 'running') {
        setTimeout(function() {
            var cur = document.getElementById('viewSuitResult');
            if (cur && cur.contains(el)) {
                el.querySelector('#resBtnRefresh') && el.querySelector('#resBtnRefresh').click();
            }
        }, 8000);
    }
}

// ==================== ④-2 结果页动作：拼贴/归档/导出 ====================
async function _composeSheet(batchId, el) {
    var template = 'default', title = '', bg = '#1a1a2e';
    // 简易弹窗让用户选模板
    var html = '<div class="suit-modal-mask" onclick="if(event.target===this)this.remove()"><div class="suit-modal suit-modal-md">' +
      '<div class="suit-modal-head"><span>🖼️ 整合人设拼贴</span><button class="suit-modal-close" onclick="this.closest(\'.suit-modal-mask\').remove()">×</button></div>' +
      '<div class="suit-modal-body suit-form">' +
        '<label>布局模板<select class="suit-input" id="cmTpl">' +
          '<option value="default">默认</option><option value="portrait">竖版</option>' +
          '<option value="grid4">四宫格</option><option value="wide">横排宽幅</option>' +
        '</select></label>' +
        '<label>标题文字<input class="suit-input" id="cmTitle" placeholder="角色设定"></label>' +
        '<label>画布底色<input type="color" class="suit-input suit-color" id="cmBg" value="#1a1a2e"></label>' +
      '</div>' +
      '<div class="suit-modal-foot">' +
        '<button class="suit-btn" onclick="this.closest(\'.suit-modal-mask\').remove()">取消</button>' +
        '<button class="suit-btn suit-btn-primary" id="cmGo">生成拼贴</button>' +
      '</div></div></div>';
    var mask = document.createElement('div');
    mask.innerHTML = html;
    document.body.appendChild(mask.firstChild);
    mask.firstChild.querySelector('#cmGo').addEventListener('click', async function() {
        try {
            var body = {
                template: document.getElementById('cmTpl').value,
                title_text: document.getElementById('cmTitle').value.trim(),
                bg_color: document.getElementById('cmBg').value
            };
            mask.firstChild.remove();
            var d = await _api('/api/assemble/render/' + batchId + '/compose', { method: 'POST', body: JSON.stringify(body) });
            var colorsHtml = (d.colors || []).map(function(c) {
                return '<span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:' + c.hex + ';border:1px solid #64748b;" title="' + c.hex + ' (' + Math.round(c.ratio * 100) + '%)"></span>';
            }).join('');
            var box = document.getElementById('resComposeResult');
            if (box) box.innerHTML = '<div class="suit-compose-box">' +
              '<img src="' + _esc(d.image) + '" class="suit-compose-img" alt="整合人设拼贴">' +
              '<div class="suit-compose-colors">🎨 角色色卡 ' + colorsHtml + '</div>' +
              '<div class="suit-compose-meta">' + d.asset_count + ' 张资产合成</div>' +
            '</div>';
            _showToast('拼贴图已生成');
        } catch(e) { _showToast('拼贴失败：' + e.message, true); }
    });
}

async function _archiveRole(batchId, el) {
    var html = '<div class="suit-modal-mask" onclick="if(event.target===this)this.remove()"><div class="suit-modal suit-modal-md">' +
      '<div class="suit-modal-head"><span>📁 rolecard 角色归档</span><button class="suit-modal-close" onclick="this.closest(\'.suit-modal-mask\').remove()">×</button></div>' +
      '<div class="suit-modal-body suit-form">' +
        '<label>总项目 ID（master_project_id）<input class="suit-input" id="arMid" type="number" value="1"></label>' +
        '<label>角色名称<input class="suit-input" id="arName" placeholder="角色档案名称"></label>' +
        '<div class="suit-hint">归档后将出现在「项目角色档案」中，资产复制到 role_assets/ 目录</div>' +
      '</div>' +
      '<div class="suit-modal-foot">' +
        '<button class="suit-btn" onclick="this.closest(\'.suit-modal-mask\').remove()">取消</button>' +
        '<button class="suit-btn suit-btn-primary" id="arGo">确认归档</button>' +
      '</div></div></div>';
    var mask = document.createElement('div');
    mask.innerHTML = html;
    document.body.appendChild(mask.firstChild);
    mask.firstChild.querySelector('#arGo').addEventListener('click', async function() {
        try {
            var body = {
                master_project_id: parseInt(document.getElementById('arMid').value || '0', 10),
                name: document.getElementById('arName').value.trim()
            };
            if (!body.master_project_id) { _showToast('请填写总项目 ID', true); return; }
            if (!body.name) { _showToast('请填写角色名称', true); return; }
            mask.firstChild.remove();
            var d = await _api('/api/assemble/render/' + batchId + '/archive', { method: 'POST', body: JSON.stringify(body) });
            _showToast('归档成功：' + d.name + '（' + d.archived + ' 项资产）');
        } catch(e) { _showToast('归档失败：' + e.message, true); }
    });
}

async function _exportBatch(batchId) {
    try {
        var blob = await App.fetchJSON('/api/assemble/render/' + batchId + '/export', {});
        if (!blob) { _showToast('导出失败（无已完成资产）', true); return; }
        // fetchJSON 会尝试解析 JSON；改用原生 fetch 拿 blob
        var t = _token();
        var resp = await fetch('/api/assemble/render/' + batchId + '/export', {
            headers: t ? { 'Authorization': 'Bearer ' + t } : {}
        });
        if (!resp.ok) { _showToast('导出失败：' + resp.status, true); return; }
        var b = await resp.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'rolecard_batch' + batchId + '.zip';
        document.body.appendChild(a); a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 200);
        _showToast('资产包已下载');
    } catch(e) {
        _showToast('导出失败：' + e.message, true);
    }
}

// ==================== 导出全局 ====================
window.STYLE_SUIT = Object.assign(window.STYLE_SUIT || {}, {
    open: _openBag,
    openBag: _openBag,
    openEditor: _openEditor,
    openWorkbench: _openWorkbench,
    openResult: _openResult,
    _closeEditor: _closeEditor
});

console.log('[style_suit] v5.48.0 前端已加载');

} // _init
})();
