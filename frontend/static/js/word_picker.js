// ============================================================
// v4.1.0: Universal Word Card Picker (多端调用选取器)
// 统一词卡数据源 → 任何模块可调用选取
// 使用端: Seedance组装器 / 主界面词库 / 新建词条 / 场景填充
// ============================================================

(function() {
'use strict';

App.wordPicker = {
    // 状态
    _panel: null,
    _isOpen: false,
    _groups: [],
    _activeGroupId: null,
    _searchQuery: '',
    _onSelect: null,       // 选中回调 (card, group) => void
    _onClose: null,
    _mode: 'picker',        // 'picker' | 'browser' | 'embed'
    _sceneId: null,
    _fieldName: '',

    // 渲染目标
    _containerId: '',       // 嵌入模式的目标 DOM ID
    _position: 'right',     // 'right' | 'modal' | 'embed'
};

// ============ 打开选取器 ============

App.wordPicker.open = function(options) {
    options = options || {};
    this._mode = options.mode || 'picker';
    this._onSelect = options.onSelect || null;
    this._onClose = options.onClose || null;
    this._sceneId = options.sceneId || null;
    this._fieldName = options.fieldName || '';
    this._position = options.position || 'right';
    this._containerId = options.containerId || '';
    this._isOpen = true;

    // 根据位置模式渲染
    if (this._position === 'embed' && this._containerId) {
        this._renderEmbedded();
    } else if (this._position === 'modal') {
        this._renderModal();
    } else {
        this._renderPanel();
    }

    // 加载数据
    this._load();
};

App.wordPicker.close = function() {
    this._isOpen = false;
    this._activeGroupId = null;

    if (this._position === 'embed') {
        var el = document.getElementById('wcPickerContent');
        if (el) el.innerHTML = '';
        return;
    }
    if (this._position === 'modal') {
        var m = document.getElementById('wcPickerModal');
        if (m) { m.style.display = 'none'; m.remove(); }
        return;
    }
    // right panel
    var p = document.getElementById('wcPickerPanel');
    if (p) { p.style.display = 'none'; p.remove(); }

    if (this._onClose) this._onClose();
};

App.wordPicker.toggle = function(options) {
    if (this._isOpen) this.close();
    else this.open(options);
};

// ============ 渲染面板 ============

App.wordPicker._renderPanel = function() {
    this._removePanel();

    var panel = document.createElement('div');
    panel.id = 'wcPickerPanel';
    panel.className = 'wc-picker-panel';
    panel.style.cssText = 'position:fixed;right:0;top:60px;bottom:22px;width:340px;z-index:450;'
        + 'background:var(--bg-card);border-left:1px solid var(--border-color);'
        + 'display:flex;flex-direction:column;overflow:hidden;box-shadow:-4px 0 20px rgba(0,0,0,0.1);';

    panel.innerHTML = this._buildPanelHTML();
    document.body.appendChild(panel);
    this._panel = panel;
};

App.wordPicker._renderModal = function() {
    var overlay = document.createElement('div');
    overlay.id = 'wcPickerModal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:600;';
    overlay.onclick = function(e) { if (e.target === overlay) App.wordPicker.close(); };

    overlay.innerHTML = '<div class="modal-content" style="max-width:500px;width:95%;max-height:80vh;overflow-y:auto;border-radius:14px;padding:0;">'
        + this._buildPanelHTML()
        + '</div>';
    document.body.appendChild(overlay);
    this._panel = overlay;
};

App.wordPicker._renderEmbedded = function() {
    var el = document.getElementById(this._containerId);
    if (!el) return;
    el.innerHTML = this._buildPanelHTML();
    this._panel = el;
};

App.wordPicker._buildPanelHTML = function() {
    return ''
    // 顶部
    + '<div class="wc-picker-header" style="padding:10px 12px;border-bottom:1px solid var(--border-color);display:flex;gap:6px;align-items:center;">'
    + '<input id="wcPickerSearch" class="wc-picker-search" placeholder="🔍 搜索词卡..." oninput="App.wordPicker._onSearch(this.value)" style="flex:1;font-size:11px;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">'
    + '<button class="btn btn-xs btn-outline" onclick="App.wordPicker._load()" title="刷新" style="font-size:11px;padding:4px 6px;">🔄</button>'
    + '<button style="background:none;border:none;font-size:18px;color:var(--text-muted);cursor:pointer;line-height:1;" onclick="App.wordPicker.close()">&times;</button>'
    + '</div>'

    // 分组 tabs
    + '<div id="wcPickerGroups" class="wc-picker-groups" style="padding:6px 8px;display:flex;gap:3px;flex-wrap:wrap;border-bottom:1px solid var(--border-color);max-height:80px;overflow-y:auto;">'
    + '<span style="font-size:11px;color:var(--text-muted);padding:4px;">加载中...</span>'
    + '</div>'

    // 词卡列表
    + '<div id="wcPickerCards" class="wc-picker-cards" style="flex:1;overflow-y:auto;padding:6px 8px;">'
    + '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">选择上方分组浏览词卡</div>'
    + '</div>'

    // 底部: 功能栏
    + '<div id="wcPickerFooter" class="wc-picker-footer" style="padding:6px 10px;border-top:1px solid var(--border-color);display:flex;gap:6px;align-items:center;font-size:10px;color:var(--text-muted);">'
    + '<span>共 <b id="wcPickerTotal" style="color:var(--text-main);">0</b> 张词卡</span>'
    + '<span style="flex:1;"></span>'
    + (this._mode === 'browser' ? '<button class="btn btn-xs btn-outline" onclick="App.wordPicker._openCreateCard()">+ 新建词卡</button>' : '')
    + '</div>';
};

App.wordPicker._removePanel = function() {
    var p = document.getElementById('wcPickerPanel');
    if (p) p.remove();
    var m = document.getElementById('wcPickerModal');
    if (m) m.remove();
};

// ============ 数据加载 ============

App.wordPicker._load = async function() {
    var groupEl = document.getElementById('wcPickerGroups');
    var cardsEl = document.getElementById('wcPickerCards');
    if (!groupEl) return;

    groupEl.innerHTML = '<span style="font-size:11px;color:var(--text-muted);padding:4px;">⏳ 加载中...</span>';

    try {
        var url = '/api/v4/word-cards/picker?group_type=all';
        if (this._searchQuery) url += '&search=' + encodeURIComponent(this._searchQuery);

        var data = await App.fetchJSON(url);
        if (!data || !data.groups) throw new Error('加载失败');

        this._groups = data.groups;

        // 更新总数
        var totalEl = document.getElementById('wcPickerTotal');
        if (totalEl) totalEl.textContent = data.card_count || 0;

        // 渲染分组 tabs
        this._renderGroups();

        // 自动激活第一个分组
        if (data.groups.length > 0 && !this._activeGroupId) {
            this._activeGroupId = data.groups[0].id;
            this._renderCards(data.groups[0]);
        } else if (this._activeGroupId) {
            var active = data.groups.find(function(g) { return g.id === App.wordPicker._activeGroupId; });
            this._renderCards(active || data.groups[0] || { cards: [] });
        }

    } catch(e) {
        groupEl.innerHTML = '<span style="color:#ef4444;font-size:11px;">❌ 加载失败: ' + App._escape(e.message) + '</span>';
    }
};

App.wordPicker._renderGroups = function() {
    var el = document.getElementById('wcPickerGroups');
    if (!el) return;

    var h = '';
    for (var i = 0; i < this._groups.length; i++) {
        var g = this._groups[i];
        var icon = g.icon || '📄';
        var name = (g.name || '').replace('词库', '').substring(0, 8);
        var isActive = g.id === this._activeGroupId;
        var typeColor = g.type === 'seedance' ? '#8b5cf6' : (g.type === 'builtin' ? '#10b981' : '#f59e0b');
        h += '<button class="wc-group-tab' + (isActive ? ' active' : '') + '" '
            + 'onclick="App.wordPicker._selectGroup(' + g.id + ')" '
            + 'title="' + App._escape(g.name) + ' (' + g.card_count + '张)" '
            + 'style="font-size:10px;padding:3px 8px;border:1px solid ' + (isActive ? typeColor : 'var(--border-color)') + ';'
            + 'border-radius:12px;cursor:pointer;white-space:nowrap;'
            + 'background:' + (isActive ? 'rgba(139,92,246,0.08)' : 'var(--hover-bg)') + ';'
            + 'color:' + (isActive ? typeColor : 'var(--text-muted)') + ';">'
            + icon + ' ' + App._escape(name)
            + '<span style="margin-left:2px;font-size:9px;opacity:0.6;">' + g.card_count + '</span>'
            + '</button>';
    }
    el.innerHTML = h;
};

App.wordPicker._selectGroup = function(groupId) {
    this._activeGroupId = groupId;
    this._renderGroups();

    var group = this._groups.find(function(g) { return g.id === groupId; });
    this._renderCards(group || { cards: [] });
};

App.wordPicker._renderCards = function(group) {
    var el = document.getElementById('wcPickerCards');
    if (!el) return;

    var cards = group.cards || [];
    if (cards.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">暂无词卡</div>';
        return;
    }

    var h = '';
    for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var name = c.name || c.content || '';
        var content = c.content || '';
        var meaning = c.meaning || '';
        var thumb = c.thumbnail || '';
        var tags = c.tags || [];
        var icon = c.icon || '';

        h += '<div class="wc-picker-card" data-card-id="' + c.id + '" '
            + 'onclick="App.wordPicker._pickCard(' + c.id + ')" '
            + 'style="display:flex;align-items:center;gap:8px;padding:7px 8px;margin-bottom:4px;'
            + 'border:1px solid var(--border-color);border-radius:8px;cursor:pointer;transition:0.12s;'
            + 'background:var(--bg-card);"'
            + 'onmouseenter="this.style.borderColor=\'var(--primary)\'" '
            + 'onmouseleave="this.style.borderColor=\'var(--border-color)\'">';

        // 缩略图/图标
        if (thumb) {
            h += '<div style="width:36px;height:36px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--hover-bg);">'
                + '<img src="/api/thumbnails/' + thumb + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">'
                + '</div>';
        } else if (icon) {
            h += '<span style="font-size:22px;width:36px;text-align:center;flex-shrink:0;">' + App._escape(icon) + '</span>';
        } else {
            h += '<span style="font-size:16px;width:36px;text-align:center;flex-shrink:0;color:var(--text-muted);">📄</span>';
        }

        // 内容
        h += '<div style="flex:1;min-width:0;">';
        h += '<div style="font-size:12px;font-weight:600;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
            + App._escape(name || content.substring(0, 40))
            + '</div>';
        if (meaning) {
            h += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
                + App._escape(meaning.substring(0, 50))
                + '</div>';
        }
        if (tags.length > 0) {
            h += '<div style="display:flex;gap:3px;margin-top:3px;">';
            for (var t = 0; t < Math.min(tags.length, 3); t++) {
                h += '<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:var(--hover-bg);color:var(--text-muted);">'
                    + App._escape(tags[t]) + '</span>';
            }
            h += '</div>';
        }
        h += '</div>';

        // 使用次数
        if (c.usage_count > 0) {
            h += '<span style="font-size:9px;color:var(--text-muted);flex-shrink:0;">×' + c.usage_count + '</span>';
        }

        // 选取按钮
        h += '<span style="font-size:14px;color:var(--primary);flex-shrink:0;opacity:0;transition:0.12s;" '
            + 'class="wc-pick-arrow">→</span>';

        h += '</div>';
    }
    el.innerHTML = h;
};

// ============ 选取词卡 ============

App.wordPicker._pickCard = async function(cardId) {
    // 调用后端关联 API
    if (this._sceneId) {
        try {
            await App.fetchJSON('/api/v4/word-cards/picker/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scene_id: this._sceneId, card_id: cardId })
            });
        } catch(e) {
            // silent
        }
    }

    // 从缓存中查找卡片数据
    var card = null;
    for (var i = 0; i < this._groups.length; i++) {
        var g = this._groups[i];
        for (var j = 0; j < (g.cards || []).length; j++) {
            if (g.cards[j].id === cardId) { card = g.cards[j]; break; }
        }
        if (card) break;
    }

    // 回调
    if (this._onSelect && card) {
        this._onSelect(card, this._groups.find(function(g) { return g.id === App.wordPicker._activeGroupId; }));
    }

    // 视觉反馈
    var el = document.querySelector('.wc-picker-card[data-card-id="' + cardId + '"]');
    if (el) {
        el.style.borderColor = '#10b981';
        el.style.background = 'rgba(16,185,129,0.08)';
        var arrow = el.querySelector('.wc-pick-arrow');
        if (arrow) arrow.style.opacity = '1';

        setTimeout(function() {
            el.style.borderColor = 'var(--border-color)';
            el.style.background = 'var(--bg-card)';
            if (arrow) arrow.style.opacity = '0';
        }, 1500);
    }

    App.showToast('已选取: ' + (card ? (card.name || card.content || '').substring(0, 30) : ''), 'success');
};

// ============ 搜索 ============

App.wordPicker._onSearch = function(query) {
    this._searchQuery = query;
    this._load();
};

// ============ 嵌入模式快捷方法 — Seedance专用 ============

App.wordPicker.openForScene = function(sceneId, fieldName, containerId) {
    this.open({
        mode: 'picker',
        position: 'embed',
        sceneId: sceneId,
        fieldName: fieldName,
        containerId: containerId,
        onSelect: function(card, group) {
            // 通知 Seedance 组装器填充字段
            if (App.seedanceV2 && App.seedanceV2._onPickerSelect) {
                App.seedanceV2._onPickerSelect(sceneId, fieldName, card);
            }
        }
    });
};

// ============ 浏览器模式 — 主页词库全屏浏览 ============

App.wordPicker.openBrowser = function() {
    this.open({
        mode: 'browser',
        position: 'modal',
        onSelect: function(card) {
            // 点击卡片：复制内容
            App.copyText(card.content, '已复制: ' + (card.name || card.content).substring(0, 30));
        }
    });
};

})();
