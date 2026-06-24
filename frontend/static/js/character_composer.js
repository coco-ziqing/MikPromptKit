// v5.1.0: Character Composer — 角色设定提示词组装器
// 从 word_card 词库选取维度词条，装配为完整角色提示词
(function() {
'use strict';

// 轮询等待 App 就绪
(function _wait() {
    try { if (!App || !App.fetchJSON) { setTimeout(_wait, 200); return; } }
    catch(e) { setTimeout(_wait, 200); return; }
    _init();
})();

function _init() {

// ==================== state ====================
App.cc = {
    characters: [],
    currentId: null,
    currentSettings: {},
    dimensions: [],
    _cardCache: {},
    outputText: '',
    activeDim: null,
    activeGroupId: null
};

// ==================== Core: load dimensions ====================
App.cc.loadDimensions = async function() {
    try {
        var d = await App.fetchJSON('/api/character-composer/dimensions');
        if (d && d.dimensions) {
            this.dimensions = d.dimensions;
            this.renderEditor();
        }
    } catch(e) { console.warn('cc loadDimensions:', e); }
};

App.cc.loadCharacters = async function() {
    try {
        var d = await App.fetchJSON('/api/character-composer/characters');
        if (d) this.characters = d.items || [];
        this.renderProjectList();
    } catch(e) {}
};

// ==================== Render: Project List (Left Sidebar) ====================
App.cc.renderProjectList = function() {
    var c = document.getElementById('ccProjectList');
    if (!c) return;
    var h = '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-color);">';
    h += '<strong style="font-size:13px;">🎭 角色列表</strong>';
    h += '<button class="btn btn-sm btn-primary" onclick="App.cc.createCharacter()" style="font-size:11px;padding:2px 8px;">+ 新建</button></div>';
    
    if (!this.characters.length) {
        h += '<div style="padding:20px;text-align:center;color:var(--text-muted);">暂无角色，点击新建开始</div>';
    } else {
        for (var i = 0; i < this.characters.length; i++) {
            var ch = this.characters[i];
            var active = ch.id === this.currentId ? ' s2-project-active' : '';
            var name = ch.name || '未命名';
            var settings = ch.settings || {};
            var dimCount = Object.keys(settings).filter(function(k) { return settings[k]; }).length;
            h += '<div class="s2-project-item' + active + '" style="cursor:pointer;" onclick="App.cc.openCharacter(' + ch.id + ')">';
            h += '<div class="s2-project-info"><div class="s2-project-name">' + App._escape(name) + '</div>';
            h += '<div class="s2-project-meta">' + dimCount + ' 维度设置</div></div>';
            h += '<button class="s2-project-del" onclick="event.stopPropagation();App.cc.deleteCharacter(' + ch.id + ')">✕</button></div>';
        }
    }
    
    // 预设模板
    h += '<div style="padding:8px 12px;border-top:1px solid var(--border-color);margin-top:4px;">';
    h += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">📋 预设模板</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
    h += '<button class="btn btn-xs btn-outline" onclick="App.cc.loadPreset(\'anime_girl\')" style="font-size:10px;">🌸 日系少女</button>';
    h += '<button class="btn btn-xs btn-outline" onclick="App.cc.loadPreset(\'cyberpunk\')" style="font-size:10px;">🤖 赛博朋克</button>';
    h += '<button class="btn btn-xs btn-outline" onclick="App.cc.loadPreset(\'fantasy\')" style="font-size:10px;">⚔ 奇幻冒险</button>';
    h += '</div></div>';
    c.innerHTML = h;
};

App.cc.loadPreset = async function(key) {
    try {
        var d = await App.fetchJSON('/api/character-composer/presets');
        if (!d || !d.presets || !d.presets[key]) return;
        var p = d.presets[key];
        // 创建角色
        var r = await App.fetchJSON('/api/character-composer/characters', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: p.name, settings: p.settings })
        });
        if (r && r.ok) {
            await this.loadCharacters();
            await this.openCharacter(r.id);
            App.toast('已加载预设: ' + p.name, 'success');
        }
    } catch(e) { App.toast('加载预设失败: ' + e.message, 'danger'); }
};

// ==================== Character CRUD ====================
App.cc.createCharacter = async function() {
    var name = prompt('角色名称:', '新角色');
    if (!name) return;
    try {
        var d = await App.fetchJSON('/api/character-composer/characters', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: name, settings: {} })
        });
        if (d && d.ok) {
            await this.loadCharacters();
            await this.openCharacter(d.id);
        }
    } catch(e) { App.toast('创建失败: ' + e.message, 'danger'); }
};

App.cc.openCharacter = async function(id) {
    this.currentId = id;
    try {
        var d = await App.fetchJSON('/api/character-composer/characters/' + id);
        if (!d) return;
        this.currentSettings = d.character.settings || {};
        await this.loadDimensions();
        this.renderProjectList();
    } catch(e) { console.warn('openCharacter:', e); }
};

App.cc.saveCharacter = async function() {
    if (!this.currentId) return;
    try {
        // 读取编辑器中的当前值
        var el = document.getElementById('ccEditor');
        if (!el) return;
        var inputs = el.querySelectorAll('.cc-field-input');
        var settings = {};
        inputs.forEach(function(inp) {
            var dim = inp.dataset.dim;
            if (dim && inp.value.trim()) settings[dim] = inp.value.trim();
        });
        this.currentSettings = settings;
        var d = await App.fetchJSON('/api/character-composer/characters/' + this.currentId, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ settings: settings })
        });
        if (d && d.ok) {
            App.toast('已保存', 'success');
            this.compose();
        }
    } catch(e) { App.toast('保存失败: ' + e.message, 'danger'); }
};

App.cc.deleteCharacter = async function(id) {
    if (!confirm('确定删除此角色？')) return;
    try {
        await App.fetchJSON('/api/character-composer/characters/' + id, { method: 'DELETE' });
        if (this.currentId === id) {
            this.currentId = null;
            this.currentSettings = {};
            this.renderEditor();
        }
        await this.loadCharacters();
        App.toast('已删除', 'info');
    } catch(e) { App.toast('删除失败: ' + e.message, 'danger'); }
};

// ==================== Render: Editor (Center) ====================
App.cc.renderEditor = function() {
    var c = document.getElementById('ccEditor');
    if (!c) return;

    if (!this.currentId) {
        c.innerHTML = '<div class="s2-empty-state"><div class="s2-empty-icon">🎭</div><h4>选择或创建角色开始编辑</h4><p>从左栏选择已有角色，或点击「新建」创建新角色</p></div>';
        return;
    }

    var dims = this.dimensions;
    var sets = this.currentSettings || {};
    var h = '';

    // 标题栏
    h += '<div class="s2-editor-header"><div style="display:flex;align-items:center;gap:12px;">';
    h += '<h4 style="margin:0;">🎭 角色编辑</h4>';
    h += '<span style="font-size:11px;color:var(--text-muted);">' + dims.length + ' 个维度</span>';
    h += '</div><div style="display:flex;gap:6px;">';
    h += '<button class="btn btn-sm btn-success" onclick="App.cc.saveCharacter()">💾 保存</button>';
    h += '<button class="btn btn-sm btn-outline" onclick="App.cc.saveCharacter()">🔄 刷新预览</button></div></div>';

    // 维度字段（网格布局）
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">';

    for (var i = 0; i < dims.length; i++) {
        var dim = dims[i];
        var val = sets[dim.key] || dim.default || '';
        var hasVal = val && val.trim();

        h += '<div style="border:1px solid ' + (hasVal ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:8px;padding:10px;background:' + (hasVal ? 'rgba(79,70,229,0.02)' : 'var(--bg-card)') + ';transition:all 0.15s;">';
        // 标题行
        h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
        h += '<label style="font-size:12px;font-weight:600;color:var(--text-muted);cursor:pointer;" onclick="App.cc._toggleRightPicker(\'' + dim.key + '\')">' + (dim.icon || '') + ' ' + App._escape(dim.label) + '</label>';
        // 词库选择器
        if (dim.groups && dim.groups.length > 0) {
            h += '<select style="font-size:10px;padding:1px 4px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-main);" onchange="App.cc._switchDimGroup(\'' + dim.key + '\', this.value)"><option value="">选词库</option>';
            for (var gi = 0; gi < dim.groups.length; gi++) {
                var grp = dim.groups[gi];
                h += '<option value="' + grp.id + '">' + App._escape(grp.name.replace('[原子] ','').substring(0,12)) + ' (' + grp.card_count + ')</option>';
            }
            h += '</select>';
        }
        h += '</div>';
        // 输入区 + 选取按钮
        h += '<div style="display:flex;gap:6px;">';
        h += '<input class="cc-field-input" data-dim="' + dim.key + '" value="' + App._escape(val) + '" placeholder="输入描述或右侧选取词条..." style="flex:1;font-size:12px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-main);color:var(--text-main);" onchange="App.cc._onFieldChange(this)" oninput="App.cc._debounceSave()">';
        h += '<button class="btn btn-xs btn-outline" onclick="App.cc._toggleRightPicker(\'' + dim.key + '\')" title="浏览词库" style="font-size:10px;padding:2px 8px;">📚</button>';
        h += '</div>';

        // 已选词卡标签
        if (hasVal) {
            h += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px;">';
            h += '<span style="font-size:10px;background:rgba(79,70,229,0.1);color:var(--primary);padding:2px 6px;border-radius:4px;">✦ ' + App._escape(val.substring(0,30)) + '</span>';
            h += '</div>';
        }
        h += '</div>';
    }
    h += '</div>';

    // 输出预览
    h += '<div style="margin-top:16px;border-top:2px solid var(--border-color);padding-top:12px;">';
    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">';
    h += '<strong style="font-size:13px;">📝 输出预览</strong>';
    h += '<select onchange="App.cc._onDensityChange(this.value)" style="font-size:11px;padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-main);">';
    h += '<option value="compact">简洁 (compact)</option>';
    h += '<option value="standard" selected>标准 (standard)</option>';
    h += '<option value="detailed">详细 (detailed)</option></select>';
    h += '<button class="btn btn-sm btn-success" onclick="App.cc.copyOutput()" style="margin-left:auto;font-size:11px;">📋 复制提示词</button>';
    h += '</div>';
    h += '<textarea id="ccOutput" class="s2-output-text" readonly placeholder="填写维度字段后自动生成..." style="min-height:100px;width:100%;font-size:13px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-main);color:var(--text-main);resize:vertical;"></textarea>';
    h += '<div id="ccOutputMeta" style="font-size:10px;color:var(--text-muted);margin-top:4px;"></div>';
    h += '</div>';

    c.innerHTML = h;

    // 初始化 activeDim/activeGroupId 从第一个维度
    if (dims.length > 0) {
        this.activeDim = dims[0].key;
        if (dims[0].groups && dims[0].groups.length > 0) {
            this.activeGroupId = dims[0].groups[0].id;
        }
    }

    // 首次 compose
    this.compose();
};

// ==================== Right Panel: Card Picker ====================
App.cc._toggleRightPicker = function(dimKey) {
    this.activeDim = dimKey;
    var dim = null;
    for (var i = 0; i < this.dimensions.length; i++) {
        if (this.dimensions[i].key === dimKey) { dim = this.dimensions[i]; break; }
    }
    if (!dim) return;

    var panel = document.getElementById('ccRightPanel');
    if (!panel) return;
    panel.style.display = 'block';

    var h = '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-color);">';
    h += '<strong style="font-size:13px;">' + (dim.icon||'') + ' ' + App._escape(dim.label) + ' — 词库</strong>';
    h += '<button onclick="document.getElementById(\'ccRightPanel\').style.display=\'none\'" style="border:none;background:none;cursor:pointer;font-size:18px;">×</button></div>';

    // 分组 tabs
    if (dim.groups && dim.groups.length > 0) {
        if (!this.activeGroupId || !dim.groups.find(function(g) { return g.id === App.cc.activeGroupId; })) {
            this.activeGroupId = dim.groups[0].id;
        }
        h += '<div style="display:flex;flex-wrap:wrap;gap:4px;padding:8px;border-bottom:1px solid var(--border-color);">';
        for (var gi = 0; gi < dim.groups.length; gi++) {
            var grp = dim.groups[gi];
            var active = grp.id === this.activeGroupId ? 'font-weight:700;background:var(--primary);color:#fff;' : '';
            h += '<button onclick="App.cc._switchDimGroup(\'' + dimKey + '\',' + grp.id + ')" style="font-size:10px;padding:3px 8px;border:1px solid var(--border-color);border-radius:4px;cursor:pointer;' + active + '">' + App._escape(grp.name.replace('[原子] ','').substring(0,10)) + '</button>';
        }
        h += '</div>';
    }

    // 卡片列表
    h += '<div id="ccPickerCards" style="padding:8px;overflow-y:auto;max-height:calc(100vh - 200px);">';
    h += '<div style="text-align:center;color:var(--text-muted);padding:20px;">加载中...</div></div>';

    panel.innerHTML = h;

    // load cards
    if (this.activeGroupId) {
        this._loadPickerCards(this.activeGroupId);
    }
};

App.cc._switchDimGroup = function(dimKey, groupId) {
    this.activeDim = dimKey;
    this.activeGroupId = parseInt(groupId);
    this._loadPickerCards(this.activeGroupId);
};

App.cc._loadPickerCards = async function(groupId) {
    var container = document.getElementById('ccPickerCards');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">加载中...</div>';

    try {
        var d = await App.fetchJSON('/api/v4/word-cards?group_id=' + groupId + '&page_size=200');
        if (!d || !d.items) { container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无词条</div>'; return; }

        var cards = d.items;
        var currentVal = (this.currentSettings || {})[this.activeDim] || '';
        var h = '';
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var word = card.content || '';
            var def = card.meaning || '';
            var isSelected = currentVal && word && (currentVal.indexOf(word) >= 0 || word.indexOf(currentVal) >= 0);
            h += '<div class="s2-right-card-item' + (isSelected ? ' selected' : '') + '" onclick="App.cc._pickCard(\'' + App._escape(word) + '\')" style="display:flex;gap:8px;padding:6px 8px;border:1px solid ' + (isSelected ? '#10b981' : 'var(--border-color)') + ';border-radius:6px;margin-bottom:4px;cursor:pointer;transition:0.12s;' + (isSelected ? 'background:rgba(16,185,129,0.08);' : '') + '">';
            h += '<div style="flex:1;min-width:0;">';
            h += '<div style="font-size:12px;font-weight:600;">' + App._escape(word) + '</div>';
            if (def) h += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + App._escape(def.substring(0,60)) + '</div>';
            h += '</div>';
            if (isSelected) h += '<span style="color:#10b981;font-weight:700;">✓</span>';
            h += '</div>';
        }
        container.innerHTML = h || '<div style="text-align:center;padding:20px;color:var(--text-muted);">无匹配词条</div>';
    } catch(e) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--danger);">加载失败</div>';
    }
};

App.cc._pickCard = function(word) {
    if (!this.activeDim) return;
    var input = document.querySelector('.cc-field-input[data-dim="' + this.activeDim + '"]');
    if (input) {
        var cur = input.value.trim();
        if (cur.indexOf(word) >= 0) {
            // toggle off
            input.value = cur.replace(word, '').replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();
        } else if (cur) {
            input.value = cur + ', ' + word;
        } else {
            input.value = word;
        }
        this._onFieldChange(input);
        this._debounceSave();
    }
    // refresh picker cards
    var panel = document.getElementById('ccRightPanel');
    if (panel && panel.style.display !== 'none') {
        this._loadPickerCards(this.activeGroupId);
    }
};

// ==================== Field Changes ====================
App.cc._onFieldChange = function(input) {
    var dim = input.dataset.dim;
    if (dim) {
        this.currentSettings[dim] = input.value;
    }
    this.compose();
};

var _ccSaveTimer = null;
App.cc._debounceSave = function() {
    var self = this;
    if (_ccSaveTimer) clearTimeout(_ccSaveTimer);
    _ccSaveTimer = setTimeout(function() { self.saveCharacter(); }, 3000);
};

// ==================== Compose ====================
App.cc.compose = async function() {
    var el = document.getElementById('ccEditor');
    if (!el || !this.currentId) return;

    // 收集当前所有字段值
    var inputs = el.querySelectorAll('.cc-field-input');
    var settings = {};
    inputs.forEach(function(inp) {
        var dim = inp.dataset.dim;
        if (dim && inp.value.trim()) settings[dim] = inp.value.trim();
    });
    this.currentSettings = settings;

    var densityEl = el.querySelector('select[onchange*="_onDensityChange"]');
    var density = densityEl ? densityEl.value : 'standard';

    try {
        var d = await App.fetchJSON('/api/character-composer/compose', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ settings: settings, density: density })
        });
        if (!d) return;
        this.outputText = d.text || '';
        var outEl = document.getElementById('ccOutput');
        if (outEl) outEl.value = this.outputText;
        var meta = document.getElementById('ccOutputMeta');
        if (meta && d.stats) {
            meta.textContent = d.stats.char_count + ' 字符 · ' + d.stats.dimension_count + '/' + (this.dimensions.length || 13) + ' 维度 · ' + d.stats.density;
        }
    } catch(e) { console.warn('cc compose:', e); }
};

App.cc._onDensityChange = function(val) {
    this.compose();
};

App.cc.copyOutput = function() {
    var el = document.getElementById('ccOutput');
    if (!el || !el.value) { App.toast('无输出可复制', 'warning'); return; }
    navigator.clipboard.writeText(el.value).then(function() {
        App.toast('提示词已复制', 'success');
    });
};

// ==================== Init entry ====================
App.cc.init = async function() {
    await this.loadCharacters();
    // 如果有角色，自动打开第一个
    if (this.characters.length > 0 && !this.currentId) {
        await this.openCharacter(this.characters[0].id);
    } else {
        this.renderEditor();
    }
};

// Hook into switchView
var _origCCSwitchView = App.switchView;
App.switchView = function(view) {
    _origCCSwitchView.call(this, view);
    if (view === 'character_composer') {
        document.querySelectorAll('.view-panel').forEach(function(el) { el.style.display = 'none'; });
        var vp = document.getElementById('viewCharacterComposer');
        if (vp) vp.style.display = 'block';
        if (App.cc && App.cc.init) App.cc.init();
    }
};

console.log('[character_composer] v1.0 ready');
}})();
