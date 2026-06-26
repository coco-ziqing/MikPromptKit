// v5.2.0: Character Composer — 角色设定分镜组装器（媒体预览增强版）
// 从 word_card 词库选取维度词条，装配为完整角色提示词
// 新增：词卡缩略图/视频预览 + 拖放上传 + Ctrl+V粘贴 + 悬停预览
(function() {
'use strict';

(function _wait() {
    try { if (!App || !App.fetchJSON) { setTimeout(_wait, 200); return; } }
    catch(e) { setTimeout(_wait, 200); return; }
    _init();
})();

function _init() {

App.cc = {
    characters: [],
    currentId: null,
    currentSettings: {},
    dimensions: [],
    _cardCache: {},
    outputText: '',
    activeDim: null,
    activeGroupId: null,
    _hoverTimer: null,
    _hoverPreview: null
};

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

App.cc.createCharacter = async function() {
    var name = prompt('角色名称:', '新角色');
    if (!name) return;
    try {
        var d = await App.fetchJSON('/api/character-composer/characters', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: name, settings: {} })
        });
        if (d && d.ok) { await this.loadCharacters(); await this.openCharacter(d.id); }
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
    var el = document.getElementById('ccEditor');
    if (!el) return;
    var inputs = el.querySelectorAll('.cc-field-input');
    var settings = {};
    inputs.forEach(function(inp) {
        var dim = inp.dataset.dim;
        if (dim && inp.value.trim()) settings[dim] = inp.value.trim();
    });
    this.currentSettings = settings;
    try {
        var d = await App.fetchJSON('/api/character-composer/characters/' + this.currentId, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ settings: settings })
        });
        if (d && d.ok) { App.toast('已保存', 'success'); this.compose(); }
    } catch(e) { App.toast('保存失败: ' + e.message, 'danger'); }
};

App.cc.deleteCharacter = async function(id) {
    if (!confirm('确定删除此角色？')) return;
    try {
        await App.fetchJSON('/api/character-composer/characters/' + id, { method: 'DELETE' });
        if (this.currentId === id) { this.currentId = null; this.currentSettings = {}; this.renderEditor(); }
        await this.loadCharacters();
        App.toast('已删除', 'info');
    } catch(e) { App.toast('删除失败: ' + e.message, 'danger'); }
};

// ==================== Render: Editor ====================
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

    h += '<div class="s2-editor-header"><div style="display:flex;align-items:center;gap:12px;">';
    h += '<h4 style="margin:0;">🎭 角色编辑</h4>';
    h += '<span style="font-size:11px;color:var(--text-muted);">' + dims.length + ' 个维度</span>';
    h += '</div><div style="display:flex;gap:6px;">';
    h += '<button class="btn btn-sm btn-success" onclick="App.cc.saveCharacter()">💾 保存</button>';
    h += '<button class="btn btn-sm btn-outline" onclick="App.cc.saveCharacter()">🔄 刷新预览</button></div></div>';

    // 搜索栏
    h += '<div class="s2-search-box" style="margin-bottom:8px;">';
    h += '<input class="s2-input" placeholder="🔍 搜索角色维度..." oninput="App.cc._filterFields(this.value)" style="width:100%;">';
    h += '</div>';

    h += '<div id="ccFieldsGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    for (var i = 0; i < dims.length; i++) {
        var dim = dims[i];
        var val = sets[dim.key] || dim.default || '';
        var hasVal = val && val.trim();

        h += '<div class="cc-field-card" data-dim-key="' + dim.key + '" style="border:1px solid ' + (hasVal ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:8px;padding:10px;background:' + (hasVal ? 'rgba(79,70,229,0.02)' : 'var(--bg-card)') + ';transition:all 0.15s;">';
        h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
        h += '<label style="font-size:12px;font-weight:600;color:var(--text-muted);cursor:pointer;" onclick="App.cc._toggleRightPicker(\'' + dim.key + '\')" onmouseenter="App.cc._showDimPreview(\'' + dim.key + '\')" onmouseleave="App.cc._hideDimPreview()">' + (dim.icon || '') + ' ' + App._escape(dim.label) + '</label>';
        if (dim.groups && dim.groups.length > 0) {
            h += '<select style="font-size:10px;padding:1px 4px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-main);" onchange="App.cc._switchDimGroup(\'' + dim.key + '\', this.value)"><option value="">选词库</option>';
            for (var gi = 0; gi < dim.groups.length; gi++) {
                var grp = dim.groups[gi];
                h += '<option value="' + grp.id + '">' + App._escape(grp.name.replace('[原子] ','').substring(0,12)) + ' (' + grp.card_count + ')</option>';
            }
            h += '</select>';
        }
        h += '</div>';
        h += '<div style="display:flex;gap:6px;">';
        h += '<input class="cc-field-input" data-dim="' + dim.key + '" value="' + App._escape(val) + '" placeholder="输入描述或右侧选取词条..." style="flex:1;font-size:12px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-main);color:var(--text-main);" onchange="App.cc._onFieldChange(this)" oninput="App.cc._debounceSave()">';
        h += '<button class="btn btn-xs btn-outline" onclick="App.cc._toggleRightPicker(\'' + dim.key + '\')" title="浏览词库" style="font-size:10px;padding:2px 8px;">📚</button>';
        h += '</div>';

        if (hasVal) {
            var tokens = val.split(',').filter(function(t){return t.trim();});
            h += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px;">';
            for (var ti = 0; ti < Math.min(tokens.length, 6); ti++) {
                var tok = tokens[ti].trim();
                h += '<span class="cc-field-chip" data-dim="' + dim.key + '" data-word="' + App._escape(tok) + '" style="font-size:10px;background:rgba(79,70,229,0.1);color:var(--primary);padding:2px 6px;border-radius:4px;cursor:pointer;" onclick="App.cc._removeChip(\'' + dim.key + '\',\'' + App._escape(tok) + '\')" onmouseenter="App.cc._chipHoverIn(\'' + dim.key + '\',\'' + App._escape(tok) + '\', this)" onmouseleave="App.cc._chipHoverOut()">✕ ' + App._escape(tok.substring(0,25)) + '</span>';
            }
            if (tokens.length > 6) h += '<span style="font-size:10px;color:var(--text-muted);">+' + (tokens.length-6) + '</span>';
            h += '</div>';
        }
        h += '</div>';
    }
    h += '</div>';

    h += '<div style="margin-top:16px;border-top:2px solid var(--border-color);padding-top:12px;">';
    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">';
    h += '<strong style="font-size:13px;">📝 输出预览</strong>';
    h += '<select onchange="App.cc._onDensityChange(this.value)" style="font-size:11px;padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-main);">';
    h += '<option value="compact">简洁</option>';
    h += '<option value="standard" selected>标准</option>';
    h += '<option value="detailed">详细</option></select>';
    h += '<button class="btn btn-sm btn-success" onclick="App.cc.copyOutput()" style="margin-left:auto;font-size:11px;">📋 复制提示词</button>';
    h += '</div>';
    h += '<textarea id="ccOutput" class="s2-output-text" readonly placeholder="填写维度字段后自动生成..." style="min-height:100px;width:100%;font-size:13px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-main);color:var(--text-main);resize:vertical;"></textarea>';
    h += '<div id="ccOutputMeta" style="font-size:10px;color:var(--text-muted);margin-top:4px;"></div>';
    h += '</div>';

    c.innerHTML = h;

    if (dims.length > 0) {
        this.activeDim = dims[0].key;
        if (dims[0].groups && dims[0].groups.length > 0) this.activeGroupId = dims[0].groups[0].id;
    }
    this.compose();
};

// 维度字段搜索过滤
App.cc._filterFields = function(query) {
    var q = (query||'').toLowerCase();
    var cards = document.querySelectorAll('.cc-field-card');
    cards.forEach(function(card){
        var dimKey = card.dataset.dimKey || '';
        var dimLabel = (card.querySelector('label')||{}).textContent || '';
        if (!q || dimKey.toLowerCase().indexOf(q)>=0 || dimLabel.toLowerCase().indexOf(q)>=0) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
};

App.cc._removeChip = function(dimKey, word) {
    var input = document.querySelector('.cc-field-input[data-dim="' + dimKey + '"]');
    if (!input) return;
    var cur = input.value;
    input.value = cur.replace(word, '').replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();
    this._onFieldChange(input);
    this._debounceSave();
    this.renderEditor();
};

// ==================== Right Panel ====================
App.cc._closeRightPicker = function() {
    var panel = document.getElementById('ccRightPanel');
    if (panel) panel.style.display = 'none';
    var view = document.getElementById('viewCharacterComposer');
    if (view) { view.style.marginRight = ''; view.style.paddingRight = ''; }
};

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
    var view = document.getElementById('viewCharacterComposer');
    if (view) { view.style.marginRight = '320px'; }

    var h = '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-color);">';
    h += '<strong style="font-size:13px;">' + (dim.icon||'') + ' ' + App._escape(dim.label) + ' — 词库</strong>';
    h += '<button onclick="App.cc._closeRightPicker()" style="border:none;background:none;cursor:pointer;font-size:18px;">×</button></div>';

    // 搜索
    h += '<div style="padding:6px 8px;">';
    h += '<input class="s2-input" id="ccPickerSearch" placeholder="🔍 搜索词条..." oninput="App.cc._filterRightCards(this.value)" style="width:100%;font-size:12px;padding:5px 8px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-main);color:var(--text-main);">';
    h += '</div>';

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

    h += '<div id="ccPickerCards" style="padding:8px;overflow-y:auto;max-height:calc(100vh - 260px);">';
    h += '<div style="text-align:center;color:var(--text-muted);padding:20px;">加载中...</div></div>';

    // 媒体库选取按钮
    h += '<div style="padding:6px 8px;border-top:1px solid var(--border-color);text-align:center;">';
    h += '<button class="btn btn-xs btn-outline" onclick="App.cc._openMediaLibrary()" style="font-size:11px;padding:3px 10px;">📁 从媒体库选取</button>';
    h += '</div>';

    panel.innerHTML = h;

    if (this.activeGroupId) this._loadPickerCards(this.activeGroupId);
};

App.cc._switchDimGroup = function(dimKey, groupId) {
    this.activeDim = dimKey;
    this.activeGroupId = parseInt(groupId);
    this._loadPickerCards(this.activeGroupId);
};

App.cc._filterRightCards = function(query) {
    var q = (query||'').toLowerCase();
    var items = document.querySelectorAll('#ccPickerCards .s2-right-card-item');
    items.forEach(function(item){
        var word = (item.dataset.word || '').toLowerCase();
        if (!q || word.indexOf(q) >= 0) item.style.display = '';
        else item.style.display = 'none';
    });
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
            var pt = card.thumbnail ? '/api/v4/word-cards/thumbnails/' + card.thumbnail : '';
            var vt = card.preview_media ? '/api/v4/word-cards/videos/' + card.preview_media : '';
            var isSelected = currentVal && word && (currentVal.indexOf(word) >= 0 || word.indexOf(currentVal) >= 0);
            h += '<div class="s2-right-card-item' + (isSelected ? ' selected' : '') + '" data-word="'+App._escape(word)+'" data-card-id="'+card.id+'" data-video="'+(vt||'')+'" data-thumb="'+(pt||'')+'" onclick="App.cc._pickCard(\'' + App._escape(word) + '\')" style="display:flex;gap:8px;padding:6px 8px;border:1px solid ' + (isSelected ? '#10b981' : 'var(--border-color)') + ';border-radius:6px;margin-bottom:4px;cursor:pointer;transition:0.12s;' + (isSelected ? 'background:rgba(16,185,129,0.08);' : '') + '" onmouseenter="App.cc._thumbHoverIn(this)" onmouseleave="App.cc._thumbHoverOut(this)">';
            // 缩略图/视频预览区
            h += '<div class="wc-card-thumb-zone" data-card-id="'+card.id+'" onclick="event.stopPropagation();" style="width:44px;height:30px;min-width:44px;border-radius:3px;overflow:hidden;position:relative;background:var(--hover-bg);">';
            if (vt) {
                h += '<video src="'+vt+'" muted loop preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;"></video>';
                h += '<span style="position:absolute;top:1px;right:1px;background:rgba(0,0,0,0.7);color:#fff;font-size:7px;padding:0 2px;border-radius:2px;pointer-events:none;">V</span>';
            } else if (pt) {
                h += '<img src="'+pt+'" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
            } else {
                h += '<span onclick="event.stopPropagation();App.cc._pickFileForCard('+card.id+')" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:var(--text-muted);" title="点击/拖入/粘贴上传预览">+</span>';
            }
            h += '</div>';
            h += '<div style="flex:1;min-width:0;">';
            h += '<div style="font-size:12px;font-weight:600;">' + App._escape(word) + '</div>';
            if (def) h += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + App._escape(def.substring(0,60)) + '</div>';
            h += '</div>';
            if (isSelected) h += '<span style="color:#10b981;font-weight:700;font-size:12px;">&#10003;</span>';
            h += '</div>';
        }
        container.innerHTML = h || '<div style="text-align:center;padding:20px;color:var(--text-muted);">无匹配词条</div>';
        setTimeout(function(){ App.cc._setupWCUploadZones(); }, 100);
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
            input.value = cur.replace(word, '').replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();
        } else if (cur) {
            input.value = cur + ', ' + word;
        } else {
            input.value = word;
        }
        this._onFieldChange(input);
        this._debounceSave();
    }
    var panel = document.getElementById('ccRightPanel');
    if (panel && panel.style.display !== 'none') this._loadPickerCards(this.activeGroupId);
    this.renderEditor();
};

// ==================== 词卡媒体上传 ====================
App.cc._pickFileForCard = function(cardId) {
    var inp = document.createElement('input'); inp.type = 'file';
    inp.accept = 'image/*,video/mp4,video/webm,video/mov';
    inp.onchange = function(ev) {
        var f = ev.target.files[0];
        if (!f) return;
        App.cc._dispatchUpload(cardId, f);
    };
    inp.click();
};

App.cc._dispatchUpload = function(cardId, file) {
    if (!file) return;
    if (file.type.startsWith('video/')) this._uploadWCVideo(cardId, file);
    else this._uploadWCThumb(cardId, file);
};

App.cc._uploadWCThumb = async function(cardId, file) {
    var fd = new FormData(); fd.append('file', file);
    try {
        var r = await fetch('/api/v4/word-cards/' + cardId + '/thumbnail', {method:'POST', body:fd});
        var d = await r.json();
        if (d && d.ok) {
            this._loadPickerCards(this.activeGroupId);
            App.toast('预览图已上传', 'success');
        } else { App.toast('上传失败', 'error'); }
    } catch(e) { App.toast('上传异常: ' + e.message, 'error'); }
};

App.cc._uploadWCVideo = async function(cardId, file) {
    var fd = new FormData(); fd.append('file', file);
    try {
        var r = await fetch('/api/v4/word-cards/' + cardId + '/video', {method:'POST', body:fd});
        var d = await r.json();
        if (d && d.ok) {
            this._loadPickerCards(this.activeGroupId);
            App.toast('视频预览已上传', 'success');
        } else { App.toast('上传失败', 'error'); }
    } catch(e) { App.toast('上传异常: ' + e.message, 'error'); }
};

App.cc._setupWCUploadZones = function() {
    var self = this;
    document.querySelectorAll('#ccPickerCards .wc-card-thumb-zone').forEach(function(z) {
        if (z.dataset.dropBound) return; z.dataset.dropBound = '1';
        z.addEventListener('dragover', function(e) {
            e.preventDefault(); e.stopPropagation();
            this.style.background = 'rgba(16,185,129,0.15)'; this.style.border = '1px dashed #10b981';
        });
        z.addEventListener('dragleave', function(e) {
            this.style.background = ''; this.style.border = '';
        });
        z.addEventListener('drop', function(e) {
            e.preventDefault(); e.stopPropagation();
            this.style.background = ''; this.style.border = '';
            var cid = parseInt(this.dataset.cardId);
            if (!cid || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
            var file = e.dataTransfer.files[0];
            if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;
            self._dispatchUpload(cid, file);
        });
        var hasMedia = z.querySelector('img, video');
        if (hasMedia) {
            z.addEventListener('contextmenu', function(e) {
                e.preventDefault(); e.stopPropagation();
                var cid = parseInt(this.dataset.cardId);
                self._showThumbContextMenu(cid, e.clientX, e.clientY);
            });
        }
    });

    var panel = document.getElementById('ccRightPanel');
    if (panel && !panel.dataset.pasteBound) {
        panel.dataset.pasteBound = '1';
        panel.addEventListener('paste', function(e) {
            if (panel.style.display === 'none') return;
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            for (var i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/') || items[i].type.startsWith('video/')) {
                    e.preventDefault();
                    var f = items[i].getAsFile();
                    if (!f) continue;
                    var firstZone = panel.querySelector('.wc-card-thumb-zone');
                    if (firstZone) {
                        var cid = parseInt(firstZone.dataset.cardId);
                        if (cid) {
                            self._dispatchUpload(cid, f);
                            App.toast('已粘贴预览', 'success');
                        }
                    }
                    break;
                }
            }
        });
    }
};

App.cc._showThumbContextMenu = function(cardId, x, y) {
    var old = document.getElementById('_ccContextMenu');
    if (old) old.remove();
    var menu = document.createElement('div');
    menu.id = '_ccContextMenu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);min-width:120px;left:'+x+'px;top:'+y+'px;padding:4px;';
    menu.innerHTML = '<div style="padding:6px 10px;cursor:pointer;font-size:12px;border-radius:4px;" onmouseover="this.style.background=\'var(--hover-bg)\'" onmouseout="this.style.background=\'\'" onclick="App.cc._replaceThumb('+cardId+')">🖼 替换预览</div>' +
        '<div style="padding:6px 10px;cursor:pointer;font-size:12px;color:var(--danger);border-radius:4px;" onmouseover="this.style.background=\'var(--hover-bg)\'" onmouseout="this.style.background=\'\'" onclick="App.cc._deleteThumb('+cardId+')">🗑 删除预览</div>';
    document.body.appendChild(menu);
    setTimeout(function() {
        var fn = function(e) { menu.remove(); document.removeEventListener('click', fn); };
        document.addEventListener('click', fn);
    }, 50);
};

App.cc._replaceThumb = function(cardId) {
    this._pickFileForCard(cardId);
    var m = document.getElementById('_ccContextMenu'); if (m) m.remove();
};

App.cc._deleteThumb = async function(cardId) {
    var m = document.getElementById('_ccContextMenu'); if (m) m.remove();
    try {
        await App.fetchJSON('/api/v4/word-cards/' + cardId + '/thumbnail', {method:'DELETE'});
        this._loadPickerCards(this.activeGroupId);
        App.toast('预览已删除', 'info');
    } catch(e) { App.toast('删除失败: ' + e.message, 'error'); }
};

// ==================== 悬停预览 ====================
App.cc._thumbHoverIn = function(el) {
    var vt = el.dataset.video;
    var pt = el.dataset.thumb;
    if (!vt && !pt) return;
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(function() {
        if (!App.cc._hoverPreview) {
            App.cc._hoverPreview = document.createElement('div');
            App.cc._hoverPreview.id = '_ccHoverPreview';
            App.cc._hoverPreview.style.cssText = 'position:fixed;z-index:9998;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.2);padding:4px;display:none;max-width:260px;';
            document.body.appendChild(App.cc._hoverPreview);
        }
        var rect = el.getBoundingClientRect();
        var html = '';
        if (vt) {
            html += '<video src="'+vt+'" style="width:252px;height:auto;border-radius:6px;" autoplay muted loop></video>';
        } else if (pt) {
            html += '<img src="'+pt+'" style="width:252px;height:auto;border-radius:6px;">';
        }
        html += '<div style="padding:4px 6px;font-size:11px;font-weight:600;color:var(--text-main);">'+App._escape(el.dataset.word||'')+'</div>';
        App.cc._hoverPreview.innerHTML = html;
        App.cc._hoverPreview.style.left = Math.min(rect.left, window.innerWidth-270)+'px';
        App.cc._hoverPreview.style.top = Math.min(rect.bottom+4, window.innerHeight-180)+'px';
        App.cc._hoverPreview.style.display = 'block';
    }, 400);
};

App.cc._thumbHoverOut = function(el) {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    if (this._hoverPreview) this._hoverPreview.style.display = 'none';
};

App.cc._chipHoverIn = function(dimKey, word, el) {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(async function() {
        try {
            var d = await App.fetchJSON('/api/v4/word-cards?search=' + encodeURIComponent(word) + '&page_size=3');
            if (!d || !d.items || !d.items.length) return;
            var card = d.items[0];
            var pt = card.thumbnail ? '/api/v4/word-cards/thumbnails/' + card.thumbnail : '';
            var vt = card.preview_media ? '/api/v4/word-cards/videos/' + card.preview_media : '';
            if (!pt && !vt) return;
            if (!App.cc._hoverPreview) {
                App.cc._hoverPreview = document.createElement('div');
                App.cc._hoverPreview.id = '_ccHoverPreview';
                App.cc._hoverPreview.style.cssText = 'position:fixed;z-index:9998;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.2);padding:4px;display:none;max-width:260px;';
                document.body.appendChild(App.cc._hoverPreview);
            }
            var rect = el.getBoundingClientRect();
            var html = '';
            if (vt) html += '<video src="'+vt+'" style="width:252px;height:auto;border-radius:6px;" autoplay muted loop></video>';
            else if (pt) html += '<img src="'+pt+'" style="width:252px;height:auto;border-radius:6px;">';
            html += '<div style="padding:4px 6px;font-size:11px;font-weight:600;color:var(--text-main);">'+App._escape(word.substring(0,40))+'</div>';
            App.cc._hoverPreview.innerHTML = html;
            App.cc._hoverPreview.style.left = Math.min(rect.left, window.innerWidth-270)+'px';
            App.cc._hoverPreview.style.top = Math.min(rect.bottom+4, window.innerHeight-180)+'px';
            App.cc._hoverPreview.style.display = 'block';
        } catch(e) {}
    }, 500);
};

App.cc._chipHoverOut = function() {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    if (this._hoverPreview) this._hoverPreview.style.display = 'none';
};

App.cc._showDimPreview = function(dimKey) {};
App.cc._hideDimPreview = function() {};

// ==================== 媒体库选取 ====================
App.cc._openMediaLibrary = function() {
    var old = document.getElementById('_ccMediaLibModal');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = '_ccMediaLibModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div class="modal-content" style="max-width:680px;max-height:85vh;background:var(--bg-card);border-radius:12px;overflow:hidden;" onclick="event.stopPropagation()">' +
        '<div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-color);">' +
        '<h5 style="margin:0;">📁 媒体库 — 选择预览图/视频</h5>' +
        '<button onclick="document.getElementById(\'_ccMediaLibModal\').remove()" style="border:none;background:none;cursor:pointer;font-size:20px;">×</button></div>' +
        '<div class="modal-body" style="max-height:60vh;overflow-y:auto;padding:12px;" id="_ccMediaLibGrid">' +
        '<div style="text-align:center;padding:30px;color:var(--text-muted);">加载中...</div></div>' +
        '<div class="modal-footer" style="padding:10px 16px;border-top:1px solid var(--border-color);text-align:right;">' +
        '<button class="btn btn-sm btn-secondary" onclick="document.getElementById(\'_ccMediaLibModal\').remove()">取消</button></div></div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    this._loadMediaLib();
};

App.cc._loadMediaLib = async function() {
    var grid = document.getElementById('_ccMediaLibGrid');
    if (!grid) return;
    try {
        var d = await App.fetchJSON('/api/thumbnails/library?page_size=120');
        if (!d || !d.items || !d.items.length) {
            grid.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">媒体库为空</div>';
            return;
        }
        var h = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">';
        for (var i = 0; i < d.items.length; i++) {
            var item = d.items[i];
            h += '<div style="border:1px solid var(--border-color);border-radius:6px;overflow:hidden;cursor:pointer;transition:0.12s;" onclick="App.cc._pickFromMediaLib(\''+App._escape(item.filename||'')+'\')" onmouseover="this.style.borderColor=\'var(--primary)\'" onmouseout="this.style.borderColor=\'var(--border-color)\'">';
            h += '<img src="/api/thumbnails/file/' + App._escape(item.filename) + '" style="width:100%;height:100px;object-fit:cover;" loading="lazy">';
            h += '</div>';
        }
        h += '</div>';
        grid.innerHTML = h;
    } catch(e) { grid.innerHTML = '<div style="text-align:center;padding:30px;color:var(--danger);">加载失败</div>'; }
};

App.cc._pickFromMediaLib = async function(filename) {
    var overlay = document.getElementById('_ccMediaLibModal');
    if (overlay) overlay.remove();
    try {
        var resp = await fetch('/api/thumbnails/file/' + filename);
        var blob = await resp.blob();
        var file = new File([blob], filename, {type: blob.type || 'image/jpeg'});
        var firstZone = document.querySelector('#ccPickerCards .wc-card-thumb-zone');
        if (firstZone) {
            var cid = parseInt(firstZone.dataset.cardId);
            if (cid) {
                this._dispatchUpload(cid, file);
                App.toast('媒体已关联到词卡预览', 'success');
            }
        }
    } catch(e) { App.toast('选取失败: ' + e.message, 'error'); }
};

// ==================== Field Changes ====================
App.cc._onFieldChange = function(input) {
    var dim = input.dataset.dim;
    if (dim) this.currentSettings[dim] = input.value;
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

App.cc._onDensityChange = function(val) { this.compose(); };

App.cc.copyOutput = function() {
    var el = document.getElementById('ccOutput');
    if (!el || !el.value) { App.toast('无输出可复制', 'warning'); return; }
    navigator.clipboard.writeText(el.value).then(function() { App.toast('提示词已复制', 'success'); });
};

// ==================== Init ====================
App.cc.init = async function() {
    await this.loadCharacters();
    if (this.characters.length > 0 && !this.currentId) await this.openCharacter(this.characters[0].id);
    else this.renderEditor();
};

// Hook into switchView
var _origCCSwitchView = App.switchView;
App.switchView = function(view) {
    // 清除所有面板 inline display，让 CSS 类控制
    document.querySelectorAll('.view-panel').forEach(function(el) { el.style.display = ''; });
    // 关闭词卡面板
    if (view !== 'character_composer') {
        var panel = document.getElementById('ccRightPanel');
        if (panel) panel.style.display = 'none';
        var vp = document.getElementById('viewCharacterComposer');
        if (vp) { vp.style.marginRight = ''; vp.style.paddingRight = ''; }
    }
    _origCCSwitchView.call(this, view);
    if (view === 'character_composer') {
        var vp = document.getElementById('viewCharacterComposer');
        if (vp) vp.style.display = 'block';
        if (App.cc && App.cc.init) App.cc.init();
    }
};

console.log('[character_composer] v5.2.0-media ready');
}})();
