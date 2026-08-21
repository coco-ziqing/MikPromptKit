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
        rune_card_ids: [], rune_texts: [],
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
    // v5.50.4: 统一走 App.switchView 机制（与 character_composer hook 兼容）
    try { App.switchView('style_suit'); } catch(e) { _activatePanel('viewStyleSuit'); }
}

// 供 App.switchView('style_suit') 分支调用的渲染函数（面板已激活）
async function _renderBag() {
    var el = document.getElementById('viewStyleSuit');
    if (!el) return;
    // v5.50.3: 进入页面自动折叠侧边栏，最大化内容区
    try { if (App._collapseSidebar) App._collapseSidebar(); } catch(e) {}
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

// v5.50.7: 词卡预览框（点击词卡项显示内容/缩略图）
function _showCardPreview(item) {
    var id = item.getAttribute('data-id');
    var name = item.getAttribute('data-name') || ('词卡 ' + id);
    var content = item.getAttribute('data-content') || '';
    var thumb = item.getAttribute('data-thumb') || '';
    var html = '<div class="suit-modal-mask" onclick="if(event.target===this)this.remove()"><div class="suit-modal suit-modal-md">' +
      '<div class="suit-modal-head"><span>📇 词卡预览</span><button class="suit-modal-close" onclick="this.closest(\'.suit-modal-mask\').remove()">×</button></div>' +
      '<div class="suit-modal-body">' +
        (thumb ? '<img src="' + _esc(thumb) + '" class="suit-card-preview-img" onerror="this.style.display=\'none\'">' : '') +
        '<div class="suit-card-preview-name">' + _esc(name) + ' <span class="suit-tag">#' + id + '</span></div>' +
        '<div class="suit-card-preview-content">' + _esc(content) + '</div>' +
      '</div>' +
      '<div class="suit-modal-foot">' +
        '<button class="suit-btn" onclick="this.closest(\'.suit-modal-mask\').remove()">关闭</button>' +
        '<button class="suit-btn suit-btn-primary" id="cardPrevAdd">+ 添加到词条层</button>' +
      '</div></div></div>';
    var mask = document.createElement('div');
    mask.innerHTML = html;
    var modal = mask.firstChild;
    document.body.appendChild(modal);
    modal.querySelector('#cardPrevAdd').addEventListener('click', function() {
        _addRuneCard(parseInt(id, 10));
        modal.remove();
    });
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
          '<div class="suit-platform-select">' +
            '<span class="suit-platform-label">⚙️ 平台</span>' +
            '<select class="suit-input" id="wbPlatform" style="width:auto;margin:0;">' +
              '<option value="dreamina">即梦 Dreamina</option>' +
              '<option value="comfyui">ComfyUI（本机）</option>' +
            '</select>' +
          '</div>' +
          '<button class="suit-btn" id="wbBtnDrafts" title="历史装配记录">📋 草稿</button>' +
          '<button class="suit-btn suit-btn-primary" id="wbBtnRender">🚀 角色生成</button>' +
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
        // 中：四层组装结构（v5.50.9: 点击层自动切换左侧资源面板）
        '<div class="suit-wb-mid">' +
          '<div class="suit-slot suit-slot-base" id="slotBase" data-slot="base">' +
            '<div class="suit-slot-label">① 角色基底层 <span class="suit-slot-req">必填</span></div>' +
            '<div class="suit-slot-body" id="slotBaseBody"><div class="suit-slot-empty">点击左侧素材添加角色基底参考</div></div>' +
          '</div>' +
          '<div class="suit-slot" id="slotRunes" data-slot="cards">' +
            '<div class="suit-slot-label">② 风格词条层 <span class="suit-slot-multi">可叠加 · 排序 · 删除</span></div>' +
            '<div class="suit-slot-body" id="slotRunesBody"><div class="suit-slot-empty">点击左侧词条添加（可叠加）</div></div>' +
          '</div>' +
          '<div class="suit-slot suit-slot-suit" id="slotSuit" data-slot="suits">' +
            '<div class="suit-slot-label">③ 风格模板层 <span class="suit-slot-req">唯一</span></div>' +
            '<div class="suit-slot-body" id="slotSuitBody"><div class="suit-slot-empty">点击左侧模板一键加载全套配置</div></div>' +
          '</div>' +
          '<div class="suit-slot" id="slotAccessory" data-slot="accessory">' +
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
      // v5.50.22: 最下层最终提示词实时预览（参照分镜组装器）
      '<div class="suit-final-prompt">' +
        '<div class="suit-final-prompt-head">📝 最终提示词 <span class="suit-final-prompt-tag" id="finalPromptTag">参考@图像1 + 风格词条 + 词卡</span></div>' +
        '<div class="suit-final-prompt-body" id="finalPromptBody"><div class="suit-slot-empty">装配完成后此处实时显示最终提示词（seeDream @图像N 规范）</div></div>' +
      '</div>' +
    '</div>';
    _bindWorkbench(el);
    _renderSlots(el);
    _renderPreview(el);
    _renderParts(el);
    _renderFinalPrompt(el);
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
    // v5.50.9: 点击四层卡槽 → 左侧自动切换到对应资源面板 + 高亮选中（v5.50.11: 去掉 toast 保持流畅）
    el.querySelectorAll('.suit-slot[data-slot]').forEach(function(slot) {
        slot.addEventListener('click', function(ev) {
            // 点击卡槽内按钮（移除×等）不触发
            if (ev.target.closest('.suit-card-action')) return;
            var key = slot.getAttribute('data-slot');
            state.selectedSlot = key;
            el.querySelectorAll('.suit-slot').forEach(function(s) { s.classList.remove('slot-selected'); });
            slot.classList.add('slot-selected');
            var resMap = { base: 'base', cards: 'cards', suits: 'suits' };
            var res = resMap[key];
            if (res) {
                el.querySelectorAll('.suit-wb-res-tab').forEach(function(b) {
                    b.classList.toggle('active', b.getAttribute('data-res') === res);
                });
                _loadRes(res);
            }
        });
    });
    el.querySelector('#wbBtnRender').addEventListener('click', _submitRender);
    el.querySelector('#wbBtnSaveDraft').addEventListener('click', _saveDraft);
    el.querySelector('#wbBtnClear').addEventListener('click', function() {
        if (!_confirm('清空当前组装？')) return;
        state.workbench = {
            name: '默认装配', base_asset_ref: {}, rune_card_ids: [], rune_texts: [], suit_id: 0,
            suit_config: null, accessory_list: [], channel: 'virtual',
            config_override: {}, draftId: null
        };
        _renderSlots(el); _renderPreview(el); _renderParts(el); _renderFinalPrompt(el);
        _showToast('已清空');
    });
    el.querySelector('#wbBtnDrafts').addEventListener('click', _showDraftList);
    el.querySelector('#wbChannel').addEventListener('change', function() {
        state.workbench.channel = this.value;
        _renderPreview(el);
    });
    // v5.50.7: 生成平台切换
    var wbPlat = el.querySelector('#wbPlatform');
    if (wbPlat) {
        wbPlat.addEventListener('change', function() {
            state.workbench.platform = this.value;
            _renderPreview(el);
            // v5.50.22: 平台切换联动按钮文案（即梦=角色生成）
            var btn = el.querySelector('#wbBtnRender');
            if (btn) {
                btn.innerHTML = this.value === 'comfyui' ? '🚀 提交批量生成' : '🚀 角色生成';
            }
        });
    }
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
                var thumb = c.thumbnail ? '/api/thumbnails/file/' + c.thumbnail : '';
                return '<div class="suit-res-item suit-res-card" data-id="' + cid + '" data-name="' + _esc(c.name || ('词卡 ' + cid)) + '" data-content="' + _esc((c.content || '').slice(0, 200)) + '" data-thumb="' + _esc(thumb) + '">' +
                  (thumb ? '<img src="' + _esc(thumb) + '" class="suit-card-thumb" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
                  '<div class="suit-res-name">📇 ' + _esc(c.name || ('词卡 ' + cid)) + '</div>' +
                  '<div class="suit-res-sub">' + _esc((c.content || '').slice(0, 40)) + '</div>' +
                  '<button class="suit-btn suit-btn-sm suit-res-add">添加</button>' +
                '</div>';
            }).join('') : '<div class="suit-empty">暂无词卡</div>';
            list.querySelectorAll('.suit-res-card').forEach(function(item) {
                // v5.50.7: 点击卡片显示预览框
                item.addEventListener('click', function() {
                    _showCardPreview(item);
                });
                item.querySelector('.suit-res-add').addEventListener('click', function(ev) {
                    ev.stopPropagation();
                    _addRuneCard(parseInt(item.getAttribute('data-id'), 10));
                });
            });
        } else {
            // 素材：四种方式（本地文件/粘贴/媒体库/URL+描述）v5.50.5
            list.innerHTML = '' +
              '<div class="suit-base-tabs">' +
                '<button class="suit-base-tab active" data-btab="upload">📁 上传</button>' +
                '<button class="suit-base-tab" data-btab="paste">📋 粘贴</button>' +
                '<button class="suit-base-tab" data-btab="lib">🖼️ 媒体库</button>' +
                '<button class="suit-base-tab" data-btab="url">🔗 URL</button>' +
              '</div>' +
              '<div class="suit-base-pane" id="basePane"></div>';
            // v5.50.12: 已有基底且保留原始引用时，恢复预览面板（可继续调整/还原原始）
            var b = state.workbench.base_asset_ref || {};
            if (b.url && b.original_url && !state._baseProcessed) {
                state._baseOriginal = { url: b.original_url, file_path: b.original_file_path };
                _processBase('', '', 'original');
            } else if (b.url && b.original_url) {
                state._baseOriginal = { url: b.original_url, file_path: b.original_file_path };
                _renderBasePreviewPanel({
                    preview_url: b.preview_url || b.url, width: b.width || 0, height: b.height || 0,
                    url: b.url, file_path: b.file_path, ratio: b.ratio || 'original'
                });
            } else {
                _renderBasePane('upload');
            }
            list.querySelectorAll('.suit-base-tab').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    list.querySelectorAll('.suit-base-tab').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    _renderBasePane(btn.getAttribute('data-btab'));
                });
            });
        }
    } catch(e) {
        list.innerHTML = '<div class="suit-empty" style="color:#ef4444;">' + _esc(e.message) + '</div>';
    }
}

// ============ 基底素材四种上传方式（v5.50.5） ============
function _renderBasePane(mode) {
    var pane = document.getElementById('basePane');
    if (!pane) return;
    var html = '';
    if (mode === 'upload') {
        html = '' +
          '<div class="suit-dropzone" id="baseDropzone">' +
            '<div class="suit-dropzone-icon">📁</div>' +
            '<div class="suit-dropzone-text">点击选择或拖放真人参考图片</div>' +
            '<div class="suit-dropzone-sub">支持 JPG / PNG / WEBP，≤15MB</div>' +
          '</div>' +
          '<input type="file" id="baseFileInput" accept="image/*" style="display:none;">' +
          '<input class="suit-input" id="wbBaseDesc2" placeholder="描述（例：青年男性，正脸）" style="margin-top:8px;">' +
          '<button class="suit-btn suit-btn-primary" id="wbBaseUploadBtn" style="margin-top:6px;width:100%;">⬆️ 上传并设为参考</button>';
    } else if (mode === 'paste') {
        html = '' +
          '<div class="suit-dropzone" id="basePasteZone">' +
            '<div class="suit-dropzone-icon">📋</div>' +
            '<div class="suit-dropzone-text">Ctrl+V 粘贴剪贴板图片</div>' +
            '<div class="suit-dropzone-sub">复制图片后点击此处再粘贴</div>' +
          '</div>' +
          '<img id="basePastePreview" class="suit-base-preview" style="display:none;">' +
          '<input class="suit-input" id="wbBaseDesc3" placeholder="描述（可选）" style="margin-top:8px;">' +
          '<button class="suit-btn suit-btn-primary" id="wbBasePasteBtn" style="margin-top:6px;width:100%;" disabled>⬆️ 粘贴并设为参考</button>';
    } else if (mode === 'lib') {
        html = '<div class="suit-empty" id="baseLibLoading">加载媒体库...</div><div id="baseLibGrid" class="suit-base-lib"></div>' +
          '<input class="suit-input" id="wbBaseDesc4" placeholder="描述（可选）" style="margin-top:8px;">';
    } else {
        html = '' +
          '<div class="suit-form" style="padding:4px;">' +
            '<label>图片 URL<input class="suit-input" id="wbBaseUrl" placeholder="https://..."></label>' +
            '<label>描述<input class="suit-input" id="wbBaseDesc5" placeholder="例：青年男性，正脸"></label>' +
            '<button class="suit-btn suit-btn-primary" id="wbBaseUrlBtn" style="width:100%;">+ 设为参考</button>' +
          '</div>';
    }
    pane.innerHTML = html;
    _bindBasePane(mode);
    if (mode === 'lib') _loadMediaLib();
}

function _bindBasePane(mode) {
    if (mode === 'upload') {
        var dz = document.getElementById('baseDropzone');
        var fi = document.getElementById('baseFileInput');
        if (!dz || !fi) return;
        dz.addEventListener('click', function() { fi.click(); });
        // 拖放
        dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag'); });
        dz.addEventListener('dragleave', function() { dz.classList.remove('drag'); });
        dz.addEventListener('drop', function(e) {
            e.preventDefault(); dz.classList.remove('drag');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) _uploadBaseFile(e.dataTransfer.files[0]);
        });
        fi.addEventListener('change', function() {
            if (fi.files && fi.files[0]) _uploadBaseFile(fi.files[0]);
        });
        document.getElementById('wbBaseUploadBtn').addEventListener('click', function() {
            var desc = document.getElementById('wbBaseDesc2').value.trim();
            if (!desc) { _showToast('请填写基底描述', true); return; }
            if (!state.workbench.base_asset_ref || !state.workbench.base_asset_ref.url) { _showToast('请先选择或拖入图片', true); return; }
            state.workbench.base_asset_ref.desc = desc;
            _finishBaseSet();
        });
    } else if (mode === 'paste') {
        var zone = document.getElementById('basePasteZone');
        var prev = document.getElementById('basePastePreview');
        var btn = document.getElementById('wbBasePasteBtn');
        if (!zone || !prev || !btn) return;
        zone.addEventListener('click', function() {
            // 聚焦后监听 paste
            zone.focus();
        });
        zone.setAttribute('tabindex', '0');
        zone.addEventListener('paste', function(e) {
            var items = (e.clipboardData || {}).items || [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].type && items[i].type.indexOf('image') === 0) {
                    var file = items[i].getAsFile();
                    if (file) {
                        _handlePastedFile(file, prev, btn);
                        return;
                    }
                }
            }
            _showToast('剪贴板中没有图片', true);
        });
        btn.addEventListener('click', function() {
            var desc = document.getElementById('wbBaseDesc3').value.trim();
            if (!state.workbench.base_asset_ref || !state.workbench.base_asset_ref.url) { _showToast('请先粘贴图片', true); return; }
            state.workbench.base_asset_ref.desc = desc || '粘贴图片参考';
            _finishBaseSet();
        });
    } else if (mode === 'url') {
        document.getElementById('wbBaseUrlBtn').addEventListener('click', function() {
            var url = document.getElementById('wbBaseUrl').value.trim();
            var desc = document.getElementById('wbBaseDesc5').value.trim();
            if (!url) { _showToast('请填写图片 URL', true); return; }
            state.workbench.base_asset_ref = { source: 'manual', id: 0, url: url, desc: desc || 'URL 参考图' };
            _finishBaseSet();
        });
    }
}

async function _uploadBaseFile(file) {
    if (!file.type || file.type.indexOf('image') !== 0) { _showToast('仅支持图片文件', true); return; }
    var dz = document.getElementById('baseDropzone');
    if (dz) dz.classList.add('uploading');
    try {
        var fd = new FormData();
        fd.append('file', file);
        var t = _token();
        var resp = await fetch('/api/seedance/v2/refs/upload', {
            method: 'POST', body: fd,
            headers: t ? { 'Authorization': '***' + t } : {}
        });
        var d = await resp.json();
        if (!resp.ok || !d.ok) { throw new Error((d.detail || '上传失败')); }
        // v5.50.8: 保存原始上传图（比例切换始终基于原始图，避免叠加裁切）
        state._baseOriginal = { url: d.url, file_path: d.file_path };
        state.workbench.base_asset_ref = { source: 'upload', id: 0, url: d.url, file_path: d.file_path, desc: '' };
        if (dz) {
            dz.innerHTML = '<div class="suit-dropzone-icon">✅</div>' +
              '<div class="suit-dropzone-text">' + _esc(file.name) + ' 已上传</div>' +
              '<img src="' + _esc(d.url) + '" class="suit-base-preview" style="display:block;">';
            dz.classList.remove('uploading');
        }
        // v5.50.7: 上传后自动预处理（默认原始比例，不裁切仅缩放）
        await _processBase(d.url, d.file_path, 'original');
        // v5.50.11: 不弹 toast，预览面板即反馈
    } catch(e) {
        if (dz) { dz.classList.remove('uploading'); dz.innerHTML = '<div class="suit-dropzone-icon">⚠️</div><div class="suit-dropzone-text">上传失败：' + _esc(e.message) + '</div>'; }
        _showToast('上传失败：' + e.message, true);
    }
}

function _handlePastedFile(file, prev, btn) {
    // 本地预览
    var reader = new FileReader();
    reader.onload = function(e) {
        if (prev) { prev.src = e.target.result; prev.style.display = 'block'; }
        if (btn) btn.disabled = false;
    };
    reader.readAsDataURL(file);
    // 上传到服务器（等待完成）
    _uploadBaseFile(file).then(function() {
        // _uploadBaseFile 已设置 state.workbench.base_asset_ref
    });
}

async function _loadMediaLib() {
    var grid = document.getElementById('baseLibGrid');
    var loading = document.getElementById('baseLibLoading');
    if (!grid) return;
    try {
        var d = await _api('/api/media/library?page_size=60');
        var items = (d.items || []).filter(function(x) { return x.media_type === 'image'; });
        if (loading) loading.style.display = 'none';
        if (!items.length) { grid.innerHTML = '<div class="suit-empty">媒体库暂无图片</div>'; return; }
        grid.innerHTML = items.map(function(it) {
            return '<div class="suit-lib-item" data-url="' + _esc(it.original_url || it.thumbnail_url || '') + '" data-name="' + _esc(it.original_filename || it.filename || '') + '">' +
              '<img src="' + _esc(it.thumbnail_url || '') + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
            '</div>';
        }).join('');
        grid.querySelectorAll('.suit-lib-item').forEach(function(item) {
            item.addEventListener('click', function() {
                grid.querySelectorAll('.suit-lib-item').forEach(function(x) { x.classList.remove('selected'); });
                item.classList.add('selected');
                var desc = document.getElementById('wbBaseDesc4').value.trim();
                state.workbench.base_asset_ref = {
                    source: 'media_lib', id: 0,
                    url: item.getAttribute('data-url'),
                    desc: desc || item.getAttribute('data-name') || '媒体库参考图'
                };
                _finishBaseSet();
            });
        });
    } catch(e) {
        if (loading) loading.style.display = 'none';
        grid.innerHTML = '<div class="suit-empty" style="color:#ef4444;">' + _esc(e.message) + '</div>';
    }
}

function _finishBaseSet() {
    var el = document.getElementById('viewAssembleWorkbench');
    _renderSlots(el); _renderPreview(el); _renderFinalPrompt(el);
    // v5.50.11: 不弹 toast，基底槽显示缩略图即反馈
}

// ============ 基底预处理：比例裁剪 + 尺寸限制 + 预览（v5.50.7） ============
async function _processBase(url, filePath, ratio, crop, align64) {
    try {
        // v5.50.8: 始终基于原始上传图处理（避免叠加裁切）
        var src = state._baseOriginal || {};
        var useUrl = src.url || url || '';
        var usePath = src.file_path || filePath || '';
        var body = { url: useUrl, file_path: usePath, ratio: ratio || '1:1', crop: crop || {}, align64: !!align64 };
        var d = await _api('/api/assemble/base-process', { method: 'POST', body: JSON.stringify(body) });
        if (!d.ok) throw new Error(d.detail || '预处理失败');
        // 保存处理结果到工作台（临时，等用户确认比例）
        state._baseProcessed = d;
        // v5.50.19: 上传后首次处理渲染预览面板（无 crop 且无显式比例选择时）
        if (!crop && !state._basePanelRendered) {
            state._basePanelRendered = true;
            _renderBasePreviewPanel(d);
        }
        return d;
    } catch(e) {
        _showToast('预处理失败：' + e.message, true);
        return null;
    }
}

function _renderBasePreviewPanel(d) {
    var pane = document.getElementById('basePane');
    if (!pane) return;
    var ratios = ['原始', '1:1', '3:4', '4:3', '9:16', '16:9'];
    pane.innerHTML = '' +
      '<div class="suit-base-preview-box">' +
        '<div class="suit-base-preview-title">👁️ 基底预览（' + d.width + '×' + d.height + '）</div>' +
        // v5.50.13: 预览图（只读展示，自由裁切进大图弹窗）
        '<div class="suit-crop-wrap-static">' +
          '<img src="' + _esc(d.preview_url) + '" class="suit-base-preview-main" id="basePrevImg">' +
        '</div>' +
        '<div class="suit-base-ratio-row">' +
          '<span class="suit-base-ratio-label">画幅比例：</span>' +
          ratios.map(function(r) {
            var isActive = (r === '原始' ? ' data-active="1"' : '');
            return '<button class="suit-ratio-btn" data-ratio="' + (r === '原始' ? 'original' : r) + '"' + isActive + '>' + r + '</button>';
          }).join('') +
        '</div>' +
        '<button class="suit-btn suit-btn-primary" id="wbBaseFreeCrop" style="width:100%;margin-bottom:10px;">✂️ 自由裁切（大图框选）</button>' +
        '<input class="suit-input" id="wbBaseDesc6" placeholder="描述（例：青年男性，正脸）" value="' + _esc(state.workbench.base_asset_ref.desc || '') + '">' +
        '<div class="suit-base-actions">' +
          '<button class="suit-btn suit-btn-primary" id="wbBaseConfirm" style="flex:1;">✅ 确认参考</button>' +
          '<button class="suit-btn" id="wbBaseCancel" style="flex:1;">↩️ 重新选择</button>' +
        '</div>' +
        '<div class="suit-base-hint">💡 选比例快速裁切，或「自由裁切」在大图弹窗拖拽框选区域</div>' +
      '</div>';
    pane.querySelectorAll('.suit-ratio-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
            pane.querySelectorAll('.suit-ratio-btn').forEach(function(b) { b.removeAttribute('data-active'); });
            btn.setAttribute('data-active', '1');
            // v5.50.8: 始终基于原始图重裁（_processBase 内部回退原始图）
            var d2 = await _processBase('', '', btn.getAttribute('data-ratio'));
            if (d2) {
                var img = document.getElementById('basePrevImg');
                if (img) {
                    img.src = d2.preview_url;
                    var t = document.querySelector('.suit-base-preview-title');
                    if (t) t.textContent = '👁️ 基底预览（' + d2.width + '×' + d2.height + '）';
                }
            }
        });
    });
    // v5.50.13: 自由裁切 → 大图弹窗
    var freeBtn = pane.querySelector('#wbBaseFreeCrop');
    if (freeBtn) {
        freeBtn.addEventListener('click', function() { _openFreeCropModal(); });
    }
    pane.querySelector('#wbBaseConfirm').addEventListener('click', function() {
        var desc = document.getElementById('wbBaseDesc6').value.trim();
        var d2 = state._baseProcessed;
        if (!d2) { _showToast('请先上传图片', true); return; }
        var orig = state._baseOriginal || {};
        state.workbench.base_asset_ref = {
            source: 'upload', id: 0,
            url: d2.url, file_path: d2.file_path,
            preview_url: d2.preview_url, width: d2.width, height: d2.height,
            ratio: d2.ratio, desc: desc || '上传参考图',
            // v5.50.12: 保留原始图引用，可随时还原
            original_url: orig.url || '', original_file_path: orig.file_path || ''
        };
        _finishBaseSet();
        // v5.50.12: 确认后保留预览面板，可继续调整比例/还原原始
        _showToast('已设为参考，可继续调整或点「原始」还原');
    });
    pane.querySelector('#wbBaseCancel').addEventListener('click', function() {
        state._basePanelRendered = false;
        _renderBasePane('upload');
    });
}

// ============ 自由裁切：大图弹窗框选（v5.50.13） ============
// 弹窗显示原始图（等比缩放），框选坐标直接对应原始图，避免预览图与原始图比例不一致导致的错位
function _openFreeCropModal() {
    var orig = state._baseOriginal || {};
    var origUrl = orig.url || '';
    if (!origUrl) { _showToast('请先上传图片', true); return; }
    var html = '<div class="suit-modal-mask" id="freeCropMask" onclick="if(event.target===this)window.STYLE_SUIT._closeFreeCrop()">' +
      '<div class="suit-modal suit-modal-lg">' +
        '<div class="suit-modal-head"><span>✂️ 自由裁切（原始图框选）</span>' +
          '<button class="suit-modal-close" onclick="window.STYLE_SUIT._closeFreeCrop()">×</button></div>' +
        '<div class="suit-modal-body">' +
          '<div class="suit-freecrop-wrap" id="freeCropWrap">' +
            '<img src="' + _esc(origUrl) + '" id="freeCropImg" class="suit-freecrop-img">' +
            '<div class="suit-crop-mask" id="freeCropMaskLayer"></div>' +
            '<div class="suit-crop-box" id="freeCropBox"></div>' +
          '</div>' +
          '<div class="suit-crop-tip">🖱️ 拖拽框选 · 框内拖动可移动 · 双击取消 · 框选后可选择固定比例规范化（64 对齐）</div>' +
          '<div class="suit-freecrop-size" id="freeCropSize">未框选</div>' +
          // v5.50.14: 固定比例规范化选项（框选后显示）
          '<div class="suit-freecrop-ratios" id="freeCropRatios" style="display:none;">' +
            '<span class="suit-base-ratio-label">规范化比例：</span>' +
            ['原始', '1:1', '3:4', '4:3', '9:16', '16:9'].map(function(r) {
              return '<button class="suit-ratio-btn" data-fr="' + (r === '原始' ? 'original' : r) + '">' + r + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="suit-modal-foot">' +
          '<button class="suit-btn" onclick="window.STYLE_SUIT._closeFreeCrop()">取消</button>' +
          '<button class="suit-btn suit-btn-primary" id="freeCropApply">✂️ 应用裁剪</button>' +
        '</div>' +
      '</div></div>';
    var mask = document.createElement('div');
    mask.innerHTML = html;
    document.body.appendChild(mask.firstChild);
    _bindFreeCrop();
}

function _bindFreeCrop() {
    var wrap = document.getElementById('freeCropWrap');
    var img = document.getElementById('freeCropImg');
    var box = document.getElementById('freeCropBox');
    var layer = document.getElementById('freeCropMaskLayer');
    var sizeEl = document.getElementById('freeCropSize');
    if (!wrap || !img || !box || !layer) return;
    var dragging = false, moving = false, sx = 0, sy = 0;
    var moveStart = null;
    var resizing = false, resizeHandle = '', resizeStart = null;  // v5.50.18: 手柄调整
    // 挂到 window 供 _applyResizeHandle 访问（该函数在闭包外）
    window.__freeCropResize = null;
    // v5.50.18: 注入 8 个调整手柄（角=等比，边=单边）
    if (!box.querySelector('.suit-crop-handle')) {
        var handles = ['nw','n','ne','e','se','s','sw','w'];
        handles.forEach(function(hp) {
            var hd = document.createElement('div');
            hd.className = 'suit-crop-handle ' + hp;
            hd.setAttribute('data-handle', hp);
            box.appendChild(hd);
        });
    }
    // v5.50.15: 命名函数，避免重复绑定（每次打开弹窗先清理旧监听）
    if (window.__freeCropBound) {
        var w2 = window.__freeCropBound;
        w2.wrap.removeEventListener('mousedown', w2.onDown);
        w2.wrap.removeEventListener('dblclick', w2.onDbl);
        window.removeEventListener('mousemove', w2.onMove);
        window.removeEventListener('mouseup', w2.onUp);
        window.__freeCropBound = null;
    }
    function nw() { return img.naturalWidth || 1000; }
    function nh() { return img.naturalHeight || 1000; }
    function setBoxPx(x, y, w, h) {
        // 防御：clamp 到 0-1，防异常污染
        x = Math.max(0, Math.min(1, x));
        y = Math.max(0, Math.min(1, y));
        w = Math.max(0.02, Math.min(1, w));
        h = Math.max(0.02, Math.min(1, h));
        if (x + w > 1) x = 1 - w;
        if (y + h > 1) y = 1 - h;
        box.style.left = (x * 100) + '%';
        box.style.top = (y * 100) + '%';
        box.style.width = (w * 100) + '%';
        box.style.height = (h * 100) + '%';
        box.style.display = 'block';
        layer.style.display = 'block';
        if (sizeEl) sizeEl.textContent = '选中区域：' + Math.round(w * nw()) + '×' + Math.round(h * nh()) + 'px';
    }
    function setBoxFromCrop(c) {
        setBoxPx(c.x, c.y, c.w, c.h);
    }
    function hideBox() {
        box.style.display = 'none';
        layer.style.display = 'none';
        if (sizeEl) sizeEl.textContent = '未框选';
        var ratiosEl = document.getElementById('freeCropRatios');
        if (ratiosEl) ratiosEl.style.display = 'none';
        state._freeCrop = null;
    }
    function isInsideCrop(px, py) {
        var c = state._freeCrop;
        if (!c) return false;
        return px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h;
    }
    // v5.50.18: 裁切框手柄调整（角=等比缩放，边=单边拉伸）— 闭包内访问 setBoxFromCrop
    function applyResizeHandle(cx, cy) {
        var rs = window.__freeCropResize;
        if (!rs || !rs.start) return;
        var c = rs.start;
        var ratio = c.w / c.h;
        var minW = 0.04, minH = 0.04;
        var h = rs.handle;
        var nx = c.x, ny = c.y, nw = c.w, nh = c.h;
        if (h === 'e') {
            nw = Math.max(minW, Math.min(1 - c.x, cx - c.x));
        } else if (h === 'w') {
            nw = Math.max(minW, Math.min(c.x + c.w - minW, c.x + c.w - cx));
            nx = c.x + c.w - nw;
        } else if (h === 's') {
            nh = Math.max(minH, Math.min(1 - c.y, cy - c.y));
        } else if (h === 'n') {
            nh = Math.max(minH, Math.min(c.y + c.h - minH, c.y + c.h - cy));
            ny = c.y + c.h - nh;
        } else if (h === 'se') {  // 锚点=左上，等比
            nw = Math.max(minW, Math.min(1 - c.x, cx - c.x));
            nh = nw / ratio;
            if (nh > 1 - c.y) { nh = 1 - c.y; nw = nh * ratio; }
            if (nh < minH) { nh = minH; nw = nh * ratio; }
        } else if (h === 'sw') {  // 锚点=右上，等比
            nw = Math.max(minW, Math.min(c.x + c.w - minW, c.x + c.w - cx));
            nh = nw / ratio;
            nx = c.x + c.w - nw;
            if (nh > 1 - c.y) { nh = 1 - c.y; nw = nh * ratio; nx = c.x + c.w - nw; }
            if (nh < minH) { nh = minH; nw = nh * ratio; nx = c.x + c.w - nw; }
        } else if (h === 'ne') {  // 锚点=左下，等比
            nw = Math.max(minW, Math.min(1 - c.x, cx - c.x));
            nh = nw / ratio;
            ny = c.y + c.h - nh;
            if (ny < 0) { ny = 0; nh = c.y + c.h; nw = nh * ratio; }
            if (nh < minH) { nh = minH; nw = nh * ratio; ny = c.y + c.h - nh; }
        } else if (h === 'nw') {  // 锚点=右下，等比
            nw = Math.max(minW, Math.min(c.x + c.w - minW, c.x + c.w - cx));
            nh = nw / ratio;
            nx = c.x + c.w - nw;
            ny = c.y + c.h - nh;
            if (ny < 0) { ny = 0; nh = c.y + c.h; nw = nh * ratio; nx = c.x + c.w - nw; }
            if (nh < minH) { nh = minH; nw = nh * ratio; nx = c.x + c.w - nw; ny = c.y + c.h - nh; }
        }
        // 最终 clamp
        nx = Math.max(0, Math.min(1 - nw, nx));
        ny = Math.max(0, Math.min(1 - nh, ny));
        var c2 = { x: nx, y: ny, w: nw, h: nh };
        state._freeCrop = c2;
        setBoxFromCrop(c2);
    }
    function onDown(e) {
        var rect = wrap.getBoundingClientRect();
        sx = (e.clientX - rect.left) / rect.width;
        sy = (e.clientY - rect.top) / rect.height;
        // v5.50.18: 手柄按下 → 等比/单边调整尺寸；框内 → 移动；框外 → 新画框
        var handleEl = e.target && e.target.closest ? e.target.closest('[data-handle]') : null;
        if (handleEl && state._freeCrop) {
            resizing = true;
            resizeHandle = handleEl.getAttribute('data-handle');
            resizeStart = { x: state._freeCrop.x, y: state._freeCrop.y, w: state._freeCrop.w, h: state._freeCrop.h };
            window.__freeCropResize = { handle: resizeHandle, start: resizeStart };
            box.style.cursor = handleEl.style.cursor || 'crosshair';
            e.preventDefault();
            return;
        }
        if (isInsideCrop(sx, sy)) {
            moving = true;
            moveStart = { x: sx - state._freeCrop.x, y: sy - state._freeCrop.y };
            box.style.cursor = 'move';
        } else {
            dragging = true;
            box.style.display = 'block';
        }
        e.preventDefault();
    }
    function onMove(e) {
        var rect = wrap.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var cx = (e.clientX - rect.left) / rect.width;
        var cy = (e.clientY - rect.top) / rect.height;
        cx = Math.max(0, Math.min(1, cx));
        cy = Math.max(0, Math.min(1, cy));
        if (resizing && state._freeCrop) {
            applyResizeHandle(cx, cy);
            return;
        }
        if (moving && state._freeCrop) {
            // 移动裁剪框（clamp 画布内）
            var nx = cx - moveStart.x;
            var ny = cy - moveStart.y;
            nx = Math.max(0, Math.min(1 - state._freeCrop.w, nx));
            ny = Math.max(0, Math.min(1 - state._freeCrop.h, ny));
            state._freeCrop.x = nx;
            state._freeCrop.y = ny;
            setBoxFromCrop(state._freeCrop);
            return;
        }
        if (!dragging) return;
        var lx = Math.min(sx, cx), ty = Math.min(sy, cy);
        var w = Math.abs(cx - sx), h = Math.abs(cy - sy);
        setBoxPx(lx, ty, w, h);
    }
    function onUp() {
        if (resizing) {
            resizing = false;
            box.style.cursor = 'crosshair';
            return;
        }
        if (moving) {
            moving = false;
            box.style.cursor = 'crosshair';
            return;
        }
        if (!dragging) return;
        dragging = false;
        var left = parseFloat(box.style.left) || 0, top = parseFloat(box.style.top) || 0;
        var w = parseFloat(box.style.width) || 0, h = parseFloat(box.style.height) || 0;
        if (w < 0.03 || h < 0.03) { hideBox(); return; }
        state._freeCrop = { x: left / 100, y: top / 100, w: w / 100, h: h / 100 };
        // v5.50.14: 框选后显示固定比例规范化选项
        var ratiosEl = document.getElementById('freeCropRatios');
        if (ratiosEl) ratiosEl.style.display = 'flex';
    }
    function onDbl() { hideBox(); }
    wrap.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    wrap.addEventListener('dblclick', onDbl);
    window.__freeCropBound = { wrap: wrap, onDown: onDown, onMove: onMove, onUp: onUp, onDbl: onDbl };
    // v5.50.14/15: 固定比例规范化（收拢接近用户尺寸 + 64 对齐 + 中心锚定）
    var ratiosEl = document.getElementById('freeCropRatios');
    if (ratiosEl) {
        ratiosEl.querySelectorAll('[data-fr]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (!state._freeCrop) { _showToast('请先拖拽框选区域', true); return; }
                var key = btn.getAttribute('data-fr');
                ratiosEl.querySelectorAll('[data-fr]').forEach(function(b) { b.removeAttribute('data-active'); });
                btn.setAttribute('data-active', '1');
                var c = _normalizeCrop(state._freeCrop, key);
                state._freeCrop = c;
                setBoxFromCrop(c);
            });
        });
    }
    document.getElementById('freeCropApply').addEventListener('click', async function() {
        if (!state._freeCrop) { _showToast('请先在图上拖拽框选区域', true); return; }
        // v5.50.16: 应用裁剪时 64 对齐（生成规范）
        var d2 = await _processBase('', '', 'original', state._freeCrop, true);
        if (d2) {
            _closeFreeCrop();
            var img2 = document.getElementById('basePrevImg');
            if (img2) img2.src = d2.preview_url;
            var t = document.querySelector('.suit-base-preview-title');
            if (t) t.textContent = '👁️ 基底预览（' + d2.width + '×' + d2.height + '）';
            document.querySelectorAll('.suit-ratio-btn').forEach(function(b) { b.removeAttribute('data-active'); });
        }
    });
}

// v5.50.16: 框选比例规范化 — 纯比例公式，精确对应目标比例，不依赖原始图尺寸参与搜索
// 显示比例 = (w*nw)/(h*nh) = target → w/h = target*nh/nw；保持框选面积，中心锚定
function _normalizeCrop(crop, ratioKey) {
    var RATIOS = { '1:1': 1, '3:4': 3/4, '4:3': 4/3, '9:16': 9/16, '16:9': 16/9 };
    if (ratioKey === 'original' || !RATIOS[ratioKey]) return crop;
    var target = RATIOS[ratioKey];
    var img = document.getElementById('freeCropImg');
    var nw = (img && img.naturalWidth) || 1;
    var nh = (img && img.naturalHeight) || 1;
    // 选框显示宽高比 = (w_rel*nw)/(h_rel*nh) = target → w_rel/h_rel = target*nh/nw
    var relTarget = target * nh / nw;
    // 保持框选面积（相对空间）
    var area = crop.w * crop.h;
    var w = Math.sqrt(area * relTarget);
    var h = w / relTarget;
    // 中心锚定 + clamp 画布（0-1）
    var cx = crop.x + crop.w / 2;
    var cy = crop.y + crop.h / 2;
    var x = cx - w / 2, y = cy - h / 2;
    if (w > 1 || h > 1) {
        var s = Math.min(1 / w, 1 / h);
        w *= s; h *= s;
        x = cx - w / 2; y = cy - h / 2;
    }
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));
    return { x: x, y: y, w: w, h: h };
}

function _closeFreeCrop() {
    var m = document.getElementById('freeCropMask');
    if (m) m.remove();
    // 清理事件监听，防重复绑定
    if (window.__freeCropBound) {
        var w2 = window.__freeCropBound;
        try {
            w2.wrap.removeEventListener('mousedown', w2.onDown);
            w2.wrap.removeEventListener('dblclick', w2.onDbl);
            window.removeEventListener('mousemove', w2.onMove);
            window.removeEventListener('mouseup', w2.onUp);
        } catch(e) {}
        window.__freeCropBound = null;
    }
    state._freeCrop = null;
}

window.STYLE_SUIT._closeFreeCrop = _closeFreeCrop;

async function _assembleSuit(suitId) {
    try {
        var d = await _api('/api/style-packs/' + suitId);
        var it = d.item;
        state.workbench.suit_id = suitId;
        state.workbench.suit_config = it.config || {};
        var el = document.getElementById('viewAssembleWorkbench');
        _renderSlots(el); _renderPreview(el); _renderParts(el); _renderFinalPrompt(el);
        // v5.50.11: 不弹 toast，模板层填充即反馈
    } catch(e) {
        _showToast(e.message, true);
    }
}

function _addRuneCard(cardId) {
    var w = state.workbench;
    if (w.rune_card_ids.indexOf(cardId) >= 0) { _showToast('该词条已在层中'); return; }
    w.rune_card_ids.push(cardId);
    var el = document.getElementById('viewAssembleWorkbench');
    _renderSlots(el); _renderPreview(el); _renderFinalPrompt(el);
}

function _renderSlots(el) {
    var w = state.workbench;
    // 基底
    var baseBody = el.querySelector('#slotBaseBody');
    if (baseBody) {
        var b = w.base_asset_ref || {};
        if (b.desc || b.url) {
            // v5.50.8: 基底槽显示已上传参考图缩略图
            var imgUrl = b.preview_url || b.url || '';
            var imgHtml = imgUrl ? '<img src="' + _esc(imgUrl) + '" class="suit-slot-base-img" onerror="this.style.display=\'none\'">' : '';
            var ratioTag = b.ratio && b.ratio !== 'original' ? '<span class="suit-tag">' + _esc(b.ratio) + ' 裁剪</span>' : (b.ratio === 'original' ? '<span class="suit-tag">原图</span>' : '');
            baseBody.innerHTML = '<div class="suit-slot-filled suit-slot-base-filled">' +
              imgHtml +
              '<div class="suit-slot-base-info">' +
                '<div class="suit-slot-base-name">' + _esc(b.desc || '基底参考图') + '</div>' +
                (b.width ? '<div class="suit-slot-base-meta">' + b.width + '×' + b.height + ratioTag + '</div>' : '') +
              '</div>' +
              '<div class="suit-slot-base-btns">' +
                '<button class="suit-card-action" data-act="adjust" title="重新调整裁剪/比例">🖼️</button>' +
                '<button class="suit-card-action" data-act="rmbase" title="移除">×</button>' +
              '</div></div>';
            baseBody.querySelector('[data-act="rmbase"]').addEventListener('click', function() {
                w.base_asset_ref = {}; state._baseProcessed = null; state._baseOriginal = null;
                _renderSlots(el); _renderPreview(el); _renderFinalPrompt(el);
            });
            // v5.50.12: 重新调整 → 恢复预览面板（基于原始图）
            var adjBtn = baseBody.querySelector('[data-act="adjust"]');
            if (adjBtn) {
                adjBtn.addEventListener('click', function() {
                    var ob = w.base_asset_ref || {};
                    if (ob.original_url) state._baseOriginal = { url: ob.original_url, file_path: ob.original_file_path };
                    // 切到素材 tab 并恢复预览面板
                    var el2 = document.getElementById('viewAssembleWorkbench');
                    if (el2) {
                        el2.querySelectorAll('.suit-wb-res-tab').forEach(function(t2) {
                            t2.classList.toggle('active', t2.getAttribute('data-res') === 'base');
                        });
                        _loadRes('base');
                    }
                });
            }
        } else {
            baseBody.innerHTML = '<div class="suit-slot-empty">点击左侧素材添加角色基底参考</div>';
        }
    }
    // 风格词条（v5.50.22: 支持手动文本词条 + 词卡）
    var runesBody = el.querySelector('#slotRunesBody');
    if (runesBody) {
        var texts = w.rune_texts || [];
        var chipsHtml = '';
        var idx = 0;
        w.rune_card_ids.forEach(function(cid) {
            idx++;
            chipsHtml += '<div class="suit-rune-chip" data-id="' + cid + '">' +
              '<span class="suit-rune-idx">' + idx + '</span>' +
              '<span class="suit-rune-name">词卡 #' + cid + '</span>' +
              '<button class="suit-card-action" data-act="rmrune" data-id="' + cid + '" title="移除">×</button></div>';
        });
        texts.forEach(function(txt, ti) {
            idx++;
            chipsHtml += '<div class="suit-rune-chip suit-rune-text" data-ti="' + ti + '">' +
              '<span class="suit-rune-idx">' + idx + '</span>' +
              '<span class="suit-rune-name">' + _esc(txt.length > 20 ? txt.slice(0, 20) + '…' : txt) + '</span>' +
              '<button class="suit-card-action" data-act="rmtext" data-ti="' + ti + '" title="移除">×</button></div>';
        });
        runesBody.innerHTML = chipsHtml +
          '<div class="suit-rune-input-row">' +
            '<input class="suit-input" id="runeTextInput" placeholder="手动输入风格词条，回车添加..." style="margin:0;">' +
            '<button class="suit-btn suit-btn-sm" id="runeTextAdd" style="flex-shrink:0;">+ 添加</button>' +
          '</div>';
        if (!idx) {
            runesBody.innerHTML = '<div class="suit-slot-empty">点击左侧词条添加，或手动输入风格词条（可叠加）</div>' + runesBody.innerHTML;
        }
        // 词卡移除
        runesBody.querySelectorAll('[data-act="rmrune"]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                w.rune_card_ids = w.rune_card_ids.filter(function(x) { return x !== parseInt(btn.getAttribute('data-id'), 10); });
                _renderSlots(el); _renderPreview(el); _renderFinalPrompt(el);
            });
        });
        // 文本词条移除
        runesBody.querySelectorAll('[data-act="rmtext"]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var ti = parseInt(btn.getAttribute('data-ti'), 10);
                w.rune_texts = (w.rune_texts || []).filter(function(_, i) { return i !== ti; });
                _renderSlots(el); _renderPreview(el); _renderFinalPrompt(el);
            });
        });
        // 手动文本添加（回车/按钮）
        function addRuneText() {
            var inp = document.getElementById('runeTextInput');
            if (!inp) return;
            var v = inp.value.trim();
            if (!v) { _showToast('请输入词条文本', true); return; }
            w.rune_texts = w.rune_texts || [];
            w.rune_texts.push(v);
            _renderSlots(el); _renderPreview(el); _renderFinalPrompt(el);
        }
        var inp = runesBody.querySelector('#runeTextInput');
        var addBtn = runesBody.querySelector('#runeTextAdd');
        if (inp) inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addRuneText(); } });
        if (addBtn) addBtn.addEventListener('click', addRuneText);
    }
    // 风格模板（v5.50.22: 支持编辑 + 新建）
    var suitBody = el.querySelector('#slotSuitBody');
    if (suitBody) {
        if (w.suit_id && w.suit_config) {
            var nm = (w.suit_config.meta && w.suit_config.meta.name) || ('套装 #' + w.suit_id);
            suitBody.innerHTML = '<div class="suit-slot-filled suit-slot-suit-filled">' +
              '<span class="suit-slot-filled-icon">🎨</span>' +
              '<span>' + _esc(nm) + '</span>' +
              '<div class="suit-slot-base-btns">' +
                '<button class="suit-card-action" data-act="editsuit" title="编辑模板">✏️</button>' +
                '<button class="suit-card-action" data-act="newsuit" title="新建模板">＋</button>' +
                '<button class="suit-card-action" data-act="rmsuit" title="移除">×</button>' +
              '</div></div>';
            suitBody.querySelector('[data-act="rmsuit"]').addEventListener('click', function() {
                w.suit_id = 0; w.suit_config = null;
                _renderSlots(el); _renderPreview(el); _renderParts(el); _renderFinalPrompt(el);
            });
            suitBody.querySelector('[data-act="editsuit"]').addEventListener('click', function() {
                _openEditor(w.suit_id);
            });
            suitBody.querySelector('[data-act="newsuit"]').addEventListener('click', function() {
                _openEditor(null);
            });
        } else {
            suitBody.innerHTML = '<div class="suit-slot-filled suit-slot-suit-filled" style="border-style:dashed;">' +
              '<span class="suit-slot-filled-icon">🎨</span>' +
              '<span>点击左侧模板加载，或新建</span>' +
              '<div class="suit-slot-base-btns">' +
                '<button class="suit-card-action" data-act="newsuit" title="新建模板">＋ 新建模板</button>' +
              '</div></div>';
            var nb = suitBody.querySelector('[data-act="newsuit"]');
            if (nb) nb.addEventListener('click', function() { _openEditor(null); });
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

// v5.50.22: 最终提示词实时预览（seeDream @图像N 规范，与后端 _build_prompt 一致）
function _renderFinalPrompt(el) {
    var w = state.workbench;
    var body = document.getElementById('finalPromptBody');
    if (!body) return;
    var cfg = w.suit_config || {};
    var words = cfg.style_words || {};
    var parts = [];
    // ① 参考引用段
    var base = w.base_asset_ref || {};
    if (base.url || base.file_path) {
        var ru = '参考@图像1作为角色外观参考';
        if (base.desc) ru += '（' + base.desc + '）';
        ru += '，严格保持角色外貌、服装、发型一致';
        parts.push(ru);
    }
    // ② 风格词条段
    if ((words.positive || '').trim()) parts.push((words.positive || '').trim());
    // ③ 符文词条段（词卡 + 手动文本）
    if (w.rune_card_ids.length) {
        parts.push('词卡×' + w.rune_card_ids.length + '（' + w.rune_card_ids.join('、') + '）');
    }
    (w.rune_texts || []).forEach(function(txt) {
        if (String(txt || '').trim()) parts.push(String(txt).trim());
    });
    // ④ 约束段
    parts.push('人物比例符合现实世界物理规律，构图完整，细节清晰');
    var tag = document.getElementById('finalPromptTag');
    if (tag) {
        var bits = [];
        if (base.url || base.file_path) bits.push('@图像1 参考');
        if ((words.positive || '').trim()) bits.push('风格词条');
        if (w.rune_card_ids.length) bits.push('词卡×' + w.rune_card_ids.length);
        if ((w.rune_texts || []).length) bits.push('手动词条×' + w.rune_texts.length);
        tag.textContent = bits.join(' + ') || '空装配';
    }
    if (!base.url && !base.file_path && !(words.positive || '').trim() && !w.rune_card_ids.length && !(w.rune_texts || []).length) {
        body.innerHTML = '<div class="suit-slot-empty">装配完成后此处实时显示最终提示词（seeDream @图像N 规范）</div>';
        return;
    }
    body.innerHTML = parts.map(function(p, i) {
        return '<div class="suit-final-prompt-line"><span class="suit-final-prompt-idx">' + (i + 1) + '</span>' + _esc(p) + '</div>';
    }).join('');
    // 负面词行
    if ((words.negative || '').trim()) {
        body.innerHTML += '<div class="suit-final-prompt-line suit-final-prompt-neg"><span class="suit-final-prompt-idx">−</span>负面：' + _esc((words.negative || '').trim()) + '</div>';
    }
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
        var modal = mask.firstChild;
        document.body.appendChild(modal);
        modal.querySelectorAll('[data-load]').forEach(function(btn) {
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
                    modal.remove();
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
        var body = { draft_id: draft, license_info: { authorized: w.channel !== 'real' }, engine: w.platform || 'dreamina', rune_texts: w.rune_texts || [] };
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
    var modal = mask.firstChild;
    document.body.appendChild(modal);
    modal.querySelector('#cmGo').addEventListener('click', async function() {
        try {
            var body = {
                template: document.getElementById('cmTpl').value,
                title_text: document.getElementById('cmTitle').value.trim(),
                bg_color: document.getElementById('cmBg').value
            };
            modal.remove();
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
    var modal = mask.firstChild;
    document.body.appendChild(modal);
    modal.querySelector('#arGo').addEventListener('click', async function() {
        try {
            var body = {
                master_project_id: parseInt(document.getElementById('arMid').value || '0', 10),
                name: document.getElementById('arName').value.trim()
            };
            if (!body.master_project_id) { _showToast('请填写总项目 ID', true); return; }
            if (!body.name) { _showToast('请填写角色名称', true); return; }
            modal.remove();
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
    _renderBag: _renderBag,
    openEditor: _openEditor,
    openWorkbench: _openWorkbench,
    openResult: _openResult,
    _closeEditor: _closeEditor
});

console.log('[style_suit] v5.48.0 前端已加载');

} // _init
})();
