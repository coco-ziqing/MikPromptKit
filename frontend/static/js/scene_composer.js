// v5.2.0: Scene Composer — 场景设定分镜组装器（媒体预览增强版）
// 从 word_card 词库选取维度词条，装配为完整场景提示词
// 新增：词卡缩略图/视频预览 + 拖放上传 + Ctrl+V粘贴 + 悬停预览
(function() {
'use strict';
(function _wait() {
    try { if (!App || !App.fetchJSON) { setTimeout(_wait, 200); return; } }
    catch(e) { setTimeout(_wait, 200); return; }
    _init();
})();

function _init() {

App.sc = {
    scenes: [],
    currentId: null,
    currentSettings: {},
    dimensions: [],
    outputText: '',
    activeDim: null,
    activeGroupId: null,
    _saveTimer: null,
    _hoverTimer: null,
    _hoverPreview: null
};

App.sc.loadDimensions = async function() {
    try {
        var d = await App.fetchJSON('/api/scene-composer/dimensions');
        if (d && d.dimensions) {
            this.dimensions = d.dimensions;
            this.renderEditor();
        }
    } catch(e) { console.warn('sc loadDimensions:', e); }
};

App.sc.loadScenes = async function() {
    try {
        var d = await App.fetchJSON('/api/scene-composer/scenes');
        if (d) this.scenes = d.items || [];
        this.renderProjectList();
    } catch(e) {}
};

// ==================== Render: Project List ====================
App.sc.renderProjectList = function() {
    var c = document.getElementById('scProjectList');
    if (!c) return;
    var h = '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-color);">';
    h += '<strong style="font-size:13px;">🏞 场景列表</strong>';
    h += '<button class="btn btn-sm btn-primary" onclick="App.sc.createScene()" style="font-size:11px;padding:2px 8px;">+ 新建</button></div>';

    if (!this.scenes.length) {
        h += '<div style="padding:20px;text-align:center;color:var(--text-muted);">暂无场景，点击新建开始</div>';
    } else {
        for (var i = 0; i < this.scenes.length; i++) {
            var sc = this.scenes[i];
            var active = sc.id === this.currentId ? ' s2-project-active' : '';
            var name = sc.name || '未命名';
            var settings = sc.settings || {};
            var dimCount = Object.keys(settings).filter(function(k){return settings[k];}).length;
            h += '<div class="s2-project-item' + active + '" style="cursor:pointer;" onclick="App.sc.openScene(' + sc.id + ')">';
            h += '<div class="s2-project-info"><div class="s2-project-name">' + App._escape(name) + '</div>';
            h += '<div class="s2-project-meta">' + dimCount + ' 维度设置</div></div>';
            h += '<button class="s2-project-del" onclick="event.stopPropagation();App.sc.deleteScene(' + sc.id + ')">✕</button></div>';
        }
    }

    h += '<div style="padding:8px 12px;border-top:1px solid var(--border-color);margin-top:4px;">';
    h += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">📋 预设模板</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
    h += '<button class="btn btn-xs btn-outline" onclick="App.sc.loadPreset(\'cyberpunk_city\')" style="font-size:10px;">🌃 赛博都市</button>';
    h += '<button class="btn btn-xs btn-outline" onclick="App.sc.loadPreset(\'fantasy_forest\')" style="font-size:10px;">🌲 魔法森林</button>';
    h += '<button class="btn btn-xs btn-outline" onclick="App.sc.loadPreset(\'ancient_temple\')" style="font-size:10px;">🏛 远古神殿</button>';
    h += '<button class="btn btn-xs btn-outline" onclick="App.sc.loadPreset(\'coastal_sunset\')" style="font-size:10px;">🌅 海滨日落</button>';
    h += '<button class="btn btn-xs btn-outline" onclick="App.sc.loadPreset(\'winter_village\')" style="font-size:10px;">❄ 冬日雪村</button>';
    h += '</div></div>';
    c.innerHTML = h;
};

App.sc.loadPreset = async function(key) {
    try {
        var d = await App.fetchJSON('/api/scene-composer/presets');
        if (!d || !d.presets || !d.presets[key]) return;
        var p = d.presets[key];
        var r = await App.fetchJSON('/api/scene-composer/scenes', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:p.name,settings:p.settings})
        });
        if (r && r.ok) {
            await this.loadScenes();
            await this.openScene(r.id);
            App.toast('已加载预设: ' + p.name, 'success');
        }
    } catch(e) { App.toast('加载预设失败: ' + e.message, 'danger'); }
};

// ==================== CRUD ====================
App.sc.createScene = async function() {
    var name = prompt('场景名称:', '新场景');
    if (!name) return;
    try {
        var d = await App.fetchJSON('/api/scene-composer/scenes', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:name,settings:{}})
        });
        if (d && d.ok) { await this.loadScenes(); await this.openScene(d.id); }
    } catch(e) { App.toast('创建失败: ' + e.message, 'danger'); }
};

App.sc.openScene = async function(id) {
    this.currentId = id;
    try {
        var d = await App.fetchJSON('/api/scene-composer/scenes/' + id);
        if (!d) return;
        this.currentSettings = d.scene.settings || {};
        await this.loadDimensions();
        this.renderProjectList();
    } catch(e) { console.warn('openScene:', e); }
};

App.sc.saveScene = async function() {
    if (!this.currentId) return;
    var el = document.getElementById('scEditor');
    if (!el) return;
    var inputs = el.querySelectorAll('.sc-field-input');
    var settings = {};
    inputs.forEach(function(inp) {
        var dim = inp.dataset.dim;
        if (dim && inp.value.trim()) settings[dim] = inp.value.trim();
    });
    this.currentSettings = settings;
    try {
        var d = await App.fetchJSON('/api/scene-composer/scenes/' + this.currentId, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({settings:settings})
        });
        if (d && d.ok) { App.toast('已保存', 'success'); this.compose(); }
    } catch(e) { App.toast('保存失败: ' + e.message, 'danger'); }
};

App.sc.deleteScene = async function(id) {
    if (!confirm('确定删除此场景？')) return;
    try {
        await App.fetchJSON('/api/scene-composer/scenes/' + id, {method:'DELETE'});
        if (this.currentId === id) { this.currentId = null; this.currentSettings = {}; this.renderEditor(); }
        await this.loadScenes();
        App.toast('已删除', 'info');
    } catch(e) { App.toast('删除失败: ' + e.message, 'danger'); }
};

// ==================== Render: Editor ====================
App.sc.renderEditor = function() {
    var c = document.getElementById('scEditor');
    if (!c) return;

    if (!this.currentId) {
        c.innerHTML = '<div class="s2-empty-state"><div class="s2-empty-icon">🏞</div><h4>选择或创建场景开始编辑</h4><p>从左栏选择已有场景，或点击「新建」创建新场景</p></div>';
        return;
    }

    var dims = this.dimensions;
    var sets = this.currentSettings || {};
    var h = '';

    h += '<div class="s2-editor-header"><div style="display:flex;align-items:center;gap:12px;">';
    h += '<h4 style="margin:0;">🏞 场景编辑</h4>';
    h += '<span style="font-size:11px;color:var(--text-muted);">' + dims.length + ' 个维度</span>';
    h += '</div><div style="display:flex;gap:6px;">';
    h += '<button class="btn btn-sm btn-success" onclick="App.sc.saveScene()">💾 保存</button>';
    h += '<button class="btn btn-sm btn-outline" onclick="App.sc.saveScene()">🔄 刷新预览</button></div></div>';

    // 搜索栏（过滤维度字段）
    h += '<div class="s2-search-box" style="margin-bottom:8px;">';
    h += '<input class="s2-input" placeholder="🔍 搜索场景维度..." oninput="App.sc._filterFields(this.value)" style="width:100%;">';
    h += '</div>';

    h += '<div id="scFieldsGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';

    for (var i = 0; i < dims.length; i++) {
        var dim = dims[i];
        var val = sets[dim.key] || dim.default || '';
        var hasVal = val && val.trim();

        h += '<div class="sc-field-card" data-dim-key="' + dim.key + '" style="border:1px solid ' + (hasVal ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:7px;padding:8px;background:' + (hasVal ? 'rgba(79,70,229,0.02)' : 'var(--bg-card)') + ';transition:all 0.15s;position:relative;">';
        h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">';
        h += '<label style="font-size:11px;font-weight:600;color:var(--text-muted);cursor:pointer;" onclick="App.sc._toggleRightPicker(\'' + dim.key + '\')" onmouseenter="App.sc._showDimPreview(\'' + dim.key + '\', this)" onmouseleave="App.sc._hideDimPreview()">' + (dim.icon||'') + ' ' + App._escape(dim.label) + '</label>';
        if (dim.groups && dim.groups.length > 0) {
            h += '<select style="font-size:10px;padding:1px 3px;border:1px solid var(--border-color);border-radius:3px;background:var(--bg-main);max-width:120px;" onchange="App.sc._switchDimGroup(\'' + dim.key + '\', this.value)"><option value="">选词库</option>';
            for (var gi = 0; gi < Math.min(dim.groups.length, 4); gi++) {
                var grp = dim.groups[gi];
                h += '<option value="' + grp.id + '">' + App._escape(grp.name.replace('[原子] ','').substring(0,10)) + '(' + grp.card_count + ')</option>';
            }
            h += '</select>';
        }
        h += '</div>';
        h += '<div style="display:flex;gap:4px;">';
        h += '<input class="sc-field-input" data-dim="' + dim.key + '" value="' + App._escape(val) + '" placeholder="输入或选取词条..." style="flex:1;font-size:11px;padding:5px 7px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-main);color:var(--text-main);" onchange="App.sc._onFieldChange(this)" oninput="App.sc._debounceSave()">';
        h += '<button class="btn btn-xs btn-outline" onclick="App.sc._toggleRightPicker(\'' + dim.key + '\')" title="浏览词库" style="font-size:10px;padding:2px 6px;">📚</button>';
        h += '</div>';
        if (hasVal) {
            // 预览芯片（可悬停查看预览图/视频）
            var tokens = val.split(',').filter(function(t){return t.trim();});
            h += '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px;">';
            for (var ti = 0; ti < Math.min(tokens.length, 5); ti++) {
                var tok = tokens[ti].trim();
                h += '<span class="sc-field-chip" data-dim="' + dim.key + '" data-word="' + App._escape(tok) + '" style="font-size:9px;background:rgba(79,70,229,0.1);color:var(--primary);padding:1px 5px;border-radius:3px;cursor:pointer;" onclick="App.sc._removeChip(\'' + dim.key + '\',\'' + App._escape(tok) + '\')" onmouseenter="App.sc._chipHoverIn(\'' + dim.key + '\',\'' + App._escape(tok) + '\', this)" onmouseleave="App.sc._chipHoverOut()">✕ ' + App._escape(tok.substring(0,25)) + '</span>';
            }
            if (tokens.length > 5) h += '<span style="font-size:9px;color:var(--text-muted);">+' + (tokens.length-5) + '</span>';
            h += '</div>';
        }
        h += '</div>';
    }
    h += '</div>';

    // output
    h += '<div style="margin-top:14px;border-top:2px solid var(--border-color);padding-top:10px;">';
    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">';
    h += '<strong style="font-size:13px;">📝 输出预览</strong>';
    h += '<select onchange="App.sc._onDensityChange(this.value)" style="font-size:10px;padding:2px 5px;border:1px solid var(--border-color);border-radius:3px;background:var(--bg-main);">';
    h += '<option value="compact">简洁</option>';
    h += '<option value="standard" selected>标准</option>';
    h += '<option value="detailed">详细</option></select>';
    h += '<button class="btn btn-sm btn-success" onclick="App.sc.copyOutput()" style="margin-left:auto;font-size:10px;">📋 复制</button>';
    h += '</div>';
    h += '<textarea id="scOutput" class="s2-output-text" readonly placeholder="填写维度字段后自动生成..." style="min-height:90px;width:100%;font-size:12px;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-main);color:var(--text-main);resize:vertical;"></textarea>';
    h += '<div id="scOutputMeta" style="font-size:9px;color:var(--text-muted);margin-top:3px;"></div></div>';

    c.innerHTML = h;

    if (dims.length > 0) {
        this.activeDim = dims[0].key;
        if (dims[0].groups && dims[0].groups.length > 0) this.activeGroupId = dims[0].groups[0].id;
    }
    this.compose();
};

// 维度字段搜索过滤
App.sc._filterFields = function(query) {
    var q = (query||'').toLowerCase();
    var cards = document.querySelectorAll('.sc-field-card');
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

// 移除芯片（从字段值中删除该词）
App.sc._removeChip = function(dimKey, word) {
    var input = document.querySelector('.sc-field-input[data-dim="' + dimKey + '"]');
    if (!input) return;
    var cur = input.value;
    input.value = cur.replace(word, '').replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();
    this._onFieldChange(input);
    this._debounceSave();
    // 刷新编辑器（重绘芯片）
    this.renderEditor();
};

// ==================== Right Panel ====================
App.sc._closeRightPicker = function() {
    var panel = document.getElementById('scRightPanel');
    if (panel) panel.style.display = 'none';
    var view = document.getElementById('viewSceneComposer');
    if (view) { view.style.marginRight = ''; view.style.paddingRight = ''; }
};

App.sc._toggleRightPicker = function(dimKey) {
    this.activeDim = dimKey;
    var dim = null;
    for (var i = 0; i < this.dimensions.length; i++) {
        if (this.dimensions[i].key === dimKey) { dim = this.dimensions[i]; break; }
    }
    if (!dim) return;

    var panel = document.getElementById('scRightPanel');
    if (!panel) return;
    panel.style.display = 'block';
    var view = document.getElementById('viewSceneComposer');
    if (view) { view.style.marginRight = '320px'; }

    var h = '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-color);">';
    h += '<strong style="font-size:13px;">' + (dim.icon||'') + ' ' + App._escape(dim.label) + ' — 词库</strong>';
    h += '<button onclick="App.sc._closeRightPicker()" style="border:none;background:none;cursor:pointer;font-size:18px;">×</button></div>';

    // 搜索
    h += '<div style="padding:6px 8px;">';
    h += '<input class="s2-input" id="scPickerSearch" placeholder="🔍 搜索词条..." oninput="App.sc._filterRightCards(this.value)" style="width:100%;font-size:12px;padding:5px 8px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-main);color:var(--text-main);">';
    h += '</div>';

    if (dim.groups && dim.groups.length > 0) {
        if (!this.activeGroupId || !dim.groups.find(function(g){return g.id===App.sc.activeGroupId;})) {
            this.activeGroupId = dim.groups[0].id;
        }
        h += '<div style="display:flex;flex-wrap:wrap;gap:3px;padding:6px 8px;border-bottom:1px solid var(--border-color);">';
        for (var gi = 0; gi < dim.groups.length; gi++) {
            var grp = dim.groups[gi];
            var active = grp.id === this.activeGroupId ? 'font-weight:700;background:var(--primary);color:#fff;' : '';
            h += '<button onclick="App.sc._switchDimGroup(\'' + dimKey + '\',' + grp.id + ')" style="font-size:10px;padding:2px 6px;border:1px solid var(--border-color);border-radius:3px;cursor:pointer;' + active + '">' + App._escape(grp.name.replace('[原子] ','').substring(0,10)) + '</button>';
        }
        h += '</div>';
    }

    h += '<div id="scPickerCards" style="padding:6px 8px;overflow-y:auto;max-height:calc(100vh - 250px);">';
    h += '<div style="text-align:center;color:var(--text-muted);padding:20px;">加载中...</div></div>';

    // 媒体库选取按钮
    h += '<div style="padding:6px 8px;border-top:1px solid var(--border-color);text-align:center;">';
    h += '<button class="btn btn-xs btn-outline" onclick="App.sc._openMediaLibrary()" style="font-size:11px;padding:3px 10px;">📁 从媒体库选取</button>';
    h += '</div>';

    panel.innerHTML = h;

    if (this.activeGroupId) this._loadPickerCards(this.activeGroupId);
};

App.sc._switchDimGroup = function(dimKey, groupId) {
    this.activeDim = dimKey;
    this.activeGroupId = parseInt(groupId);
    this._loadPickerCards(this.activeGroupId);
};

// 右侧面板搜索过滤
App.sc._filterRightCards = function(query) {
    var q = (query||'').toLowerCase();
    var items = document.querySelectorAll('#scPickerCards .s2-right-card-item');
    items.forEach(function(item){
        var word = (item.dataset.word || '').toLowerCase();
        var def = (item.querySelector('[style*=\"font-size:9px\"]')||{}).textContent || '';
        if (!q || word.indexOf(q) >= 0 || def.toLowerCase().indexOf(q) >= 0) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
};

App.sc._loadPickerCards = async function(groupId) {
    var container = document.getElementById('scPickerCards');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">加载中...</div>';
    try {
        var d = await App.fetchJSON('/api/v4/word-cards?group_id=' + groupId + '&page_size=200');
        if (!d || !d.items) { container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无词条</div>'; return; }
        var cards = d.items;
        var currentVal = (this.currentSettings||{})[this.activeDim]||'';
        var h = '';
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var word = card.content||'';
            var def = card.meaning||'';
            var pt = card.thumbnail ? '/api/v4/word-cards/thumbnails/' + card.thumbnail : '';
            var vt = card.preview_media ? '/api/v4/word-cards/videos/' + card.preview_media : '';
            var sel = currentVal && word && (currentVal.indexOf(word)>=0||word.indexOf(currentVal)>=0);
            h += '<div class="s2-right-card-item'+(sel?' selected':'')+'" data-word="'+App._escape(word)+'" data-card-id="'+card.id+'" data-video="'+(vt||'')+'" data-thumb="'+(pt||'')+'" onclick="App.sc._pickCardWord(\''+App._escape(word)+'\')" style="display:flex;gap:6px;padding:5px 7px;border:1px solid '+(sel?'#10b981':'var(--border-color)')+';border-radius:5px;margin-bottom:3px;cursor:pointer;'+(sel?'background:rgba(16,185,129,0.08);':'')+'" onmouseenter="App.sc._thumbHoverIn(this)" onmouseleave="App.sc._thumbHoverOut(this)">';
            // 缩略图/视频预览区
            h += '<div class="wc-card-thumb-zone" data-card-id="'+card.id+'" onclick="event.stopPropagation();" style="width:44px;height:30px;min-width:44px;border-radius:3px;overflow:hidden;position:relative;background:var(--hover-bg);">';
            if (vt) {
                h += '<video src="'+vt+'" muted loop preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;"></video>';
                h += '<span style="position:absolute;top:1px;right:1px;background:rgba(0,0,0,0.7);color:#fff;font-size:7px;padding:0 2px;border-radius:2px;pointer-events:none;">V</span>';
            } else if (pt) {
                h += '<img src="'+pt+'" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
            } else {
                h += '<span onclick="event.stopPropagation();App.sc._pickFileForCard('+card.id+')" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:var(--text-muted);" title="点击/拖入/粘贴上传预览">+</span>';
            }
            h += '</div>';
            h += '<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:600;">'+App._escape(word)+'</div>';
            if (def) h += '<div style="font-size:9px;color:var(--text-muted);margin-top:1px;">'+App._escape(def.substring(0,50))+'</div></div>';
            if (sel) h += '<span style="color:#10b981;font-weight:700;font-size:12px;">&#10003;</span>';
            h += '</div>';
        }
        container.innerHTML = h||'<div style="text-align:center;padding:20px;color:var(--text-muted);">无匹配词条</div>';
        // 绑定拖放+粘贴事件
        setTimeout(function(){ App.sc._setupWCUploadZones(); }, 100);
    } catch(e) { container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--danger);">加载失败: '+App._escape(e.message)+'</div>'; }
};

App.sc._pickCardWord = function(word) {
    // 委托到原_pickCard
    this._pickCard(word);
};

App.sc._pickCard = function(word) {
    if (!this.activeDim) return;
    var input = document.querySelector('.sc-field-input[data-dim="'+this.activeDim+'"]');
    if (input) {
        var cur = input.value.trim();
        if (cur.indexOf(word)>=0) input.value = cur.replace(word,'').replace(/,\s*,/g,',').replace(/^,|,$/g,'').trim();
        else if (cur) input.value = cur+', '+word;
        else input.value = word;
        this._onFieldChange(input);
        this._debounceSave();
    }
    var panel = document.getElementById('scRightPanel');
    if (panel && panel.style.display!=='none') this._loadPickerCards(this.activeGroupId);
    // 刷新编辑器（重绘芯片）
    this.renderEditor();
};

App.sc._onFieldChange = function(input) {
    var dim = input.dataset.dim;
    if (dim) { this.currentSettings[dim] = input.value; }
    this.compose();
};

App.sc._debounceSave = function() {
    var self = this;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(function(){self.saveScene();},3000);
};

// ==================== 词卡媒体上传 ====================
App.sc._pickFileForCard = function(cardId) {
    var inp = document.createElement('input'); inp.type = 'file';
    inp.accept = 'image/*,video/mp4,video/webm,video/mov';
    inp.onchange = function(ev) {
        var f = ev.target.files[0];
        if (!f) return;
        App.sc._dispatchUpload(cardId, f);
    };
    inp.click();
};

App.sc._dispatchUpload = function(cardId, file) {
    if (!file) return;
    if (file.type.startsWith('video/')) this._uploadWCVideo(cardId, file);
    else this._uploadWCThumb(cardId, file);
};

App.sc._uploadWCThumb = async function(cardId, file) {
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

App.sc._uploadWCVideo = async function(cardId, file) {
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

// 拖放上传区域绑定
App.sc._setupWCUploadZones = function() {
    var self = this;
    document.querySelectorAll('#scPickerCards .wc-card-thumb-zone').forEach(function(z) {
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
        // 右键菜单
        var hasMedia = z.querySelector('img, video');
        if (hasMedia) {
            z.addEventListener('contextmenu', function(e) {
                e.preventDefault(); e.stopPropagation();
                var cid = parseInt(this.dataset.cardId);
                self._showThumbContextMenu(cid, e.clientX, e.clientY);
            });
        }
    });

    // 全局粘贴: 右侧面板打开时 Ctrl+V 粘贴图片/视频到第一个可见词卡
    var panel = document.getElementById('scRightPanel');
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

// 右键菜单: 删除/替换缩略图
App.sc._showThumbContextMenu = function(cardId, x, y) {
    var old = document.getElementById('_scContextMenu');
    if (old) old.remove();
    var menu = document.createElement('div');
    menu.id = '_scContextMenu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);min-width:120px;left:'+x+'px;top:'+y+'px;padding:4px;';
    menu.innerHTML = '<div style="padding:6px 10px;cursor:pointer;font-size:12px;border-radius:4px;" onmouseover="this.style.background=\'var(--hover-bg)\'" onmouseout="this.style.background=\'\'" onclick="App.sc._replaceThumb('+cardId+')">🖼 替换预览</div>' +
        '<div style="padding:6px 10px;cursor:pointer;font-size:12px;color:var(--danger);border-radius:4px;" onmouseover="this.style.background=\'var(--hover-bg)\'" onmouseout="this.style.background=\'\'" onclick="App.sc._deleteThumb('+cardId+')">🗑 删除预览</div>';
    document.body.appendChild(menu);
    setTimeout(function() {
        var fn = function(e) { menu.remove(); document.removeEventListener('click', fn); };
        document.addEventListener('click', fn);
    }, 50);
};

App.sc._replaceThumb = function(cardId) {
    this._pickFileForCard(cardId);
    var m = document.getElementById('_scContextMenu'); if (m) m.remove();
};

App.sc._deleteThumb = async function(cardId) {
    var m = document.getElementById('_scContextMenu'); if (m) m.remove();
    try {
        await App.fetchJSON('/api/v4/word-cards/' + cardId + '/thumbnail', {method:'DELETE'});
        this._loadPickerCards(this.activeGroupId);
        App.toast('预览已删除', 'info');
    } catch(e) { App.toast('删除失败: ' + e.message, 'error'); }
};

// ==================== 悬停预览（芯片/词卡） ====================
App.sc._thumbHoverIn = function(el) {
    var vt = el.dataset.video;
    var pt = el.dataset.thumb;
    if (!vt && !pt) return;
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(function() {
        if (!App.sc._hoverPreview) {
            App.sc._hoverPreview = document.createElement('div');
            App.sc._hoverPreview.id = '_scHoverPreview';
            App.sc._hoverPreview.style.cssText = 'position:fixed;z-index:9998;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.2);padding:4px;display:none;max-width:260px;';
            document.body.appendChild(App.sc._hoverPreview);
        }
        var rect = el.getBoundingClientRect();
        var html = '';
        if (vt) {
            html += '<video src="'+vt+'" style="width:252px;height:auto;border-radius:6px;" autoplay muted loop></video>';
        } else if (pt) {
            html += '<img src="'+pt+'" style="width:252px;height:auto;border-radius:6px;">';
        }
        html += '<div style="padding:4px 6px;font-size:11px;font-weight:600;color:var(--text-main);">'+App._escape(el.dataset.word||'')+'</div>';
        App.sc._hoverPreview.innerHTML = html;
        App.sc._hoverPreview.style.left = Math.min(rect.left, window.innerWidth-270)+'px';
        App.sc._hoverPreview.style.top = Math.min(rect.bottom+4, window.innerHeight-180)+'px';
        App.sc._hoverPreview.style.display = 'block';
    }, 400);
};

App.sc._thumbHoverOut = function(el) {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    if (this._hoverPreview) this._hoverPreview.style.display = 'none';
};

// 芯片悬停预览（编辑器内）
App.sc._chipHoverIn = function(dimKey, word, el) {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(async function() {
        try {
            // 搜索匹配的词卡
            var d = await App.fetchJSON('/api/v4/word-cards?search=' + encodeURIComponent(word) + '&page_size=3');
            if (!d || !d.items || !d.items.length) return;
            var card = d.items[0];
            var pt = card.thumbnail ? '/api/v4/word-cards/thumbnails/' + card.thumbnail : '';
            var vt = card.preview_media ? '/api/v4/word-cards/videos/' + card.preview_media : '';
            if (!pt && !vt) return;
            if (!App.sc._hoverPreview) {
                App.sc._hoverPreview = document.createElement('div');
                App.sc._hoverPreview.id = '_scHoverPreview';
                App.sc._hoverPreview.style.cssText = 'position:fixed;z-index:9998;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.2);padding:4px;display:none;max-width:260px;';
                document.body.appendChild(App.sc._hoverPreview);
            }
            var rect = el.getBoundingClientRect();
            var html = '';
            if (vt) {
                html += '<video src="'+vt+'" style="width:252px;height:auto;border-radius:6px;" autoplay muted loop></video>';
            } else if (pt) {
                html += '<img src="'+pt+'" style="width:252px;height:auto;border-radius:6px;">';
            }
            html += '<div style="padding:4px 6px;font-size:11px;font-weight:600;color:var(--text-main);">'+App._escape(word.substring(0,40))+'</div>';
            App.sc._hoverPreview.innerHTML = html;
            App.sc._hoverPreview.style.left = Math.min(rect.left, window.innerWidth-270)+'px';
            App.sc._hoverPreview.style.top = Math.min(rect.bottom+4, window.innerHeight-180)+'px';
            App.sc._hoverPreview.style.display = 'block';
        } catch(e) {}
    }, 500);
};

App.sc._chipHoverOut = function() {
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    if (this._hoverPreview) this._hoverPreview.style.display = 'none';
};

// 维度标签悬停预览
App.sc._showDimPreview = function(dimKey, el) {
    // 暂不需要，维度本身无预览；但预留接口
};
App.sc._hideDimPreview = function() {};

// ==================== 媒体库选取 ====================
App.sc._openMediaLibrary = function() {
    var old = document.getElementById('_scMediaLibModal');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = '_scMediaLibModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div class="modal-content" style="max-width:680px;max-height:85vh;background:var(--bg-card);border-radius:12px;overflow:hidden;" onclick="event.stopPropagation()">' +
        '<div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-color);">' +
        '<h5 style="margin:0;">📁 媒体库 — 选择预览图/视频</h5>' +
        '<button onclick="document.getElementById(\'_scMediaLibModal\').remove()" style="border:none;background:none;cursor:pointer;font-size:20px;">×</button></div>' +
        '<div class="modal-body" style="max-height:60vh;overflow-y:auto;padding:12px;" id="_scMediaLibGrid">' +
        '<div style="text-align:center;padding:30px;color:var(--text-muted);">加载中...</div></div>' +
        '<div class="modal-footer" style="padding:10px 16px;border-top:1px solid var(--border-color);text-align:right;">' +
        '<button class="btn btn-sm btn-secondary" onclick="document.getElementById(\'_scMediaLibModal\').remove()">取消</button></div></div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    this._loadMediaLib();
};

App.sc._loadMediaLib = async function() {
    var grid = document.getElementById('_scMediaLibGrid');
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
            h += '<div style="border:1px solid var(--border-color);border-radius:6px;overflow:hidden;cursor:pointer;transition:0.12s;" onclick="App.sc._pickFromMediaLib(\''+App._escape(item.filename||'')+'\')" onmouseover="this.style.borderColor=\'var(--primary)\'" onmouseout="this.style.borderColor=\'var(--border-color)\'">';
            h += '<img src="/api/thumbnails/file/' + App._escape(item.filename) + '" style="width:100%;height:100px;object-fit:cover;" loading="lazy">';
            h += '</div>';
        }
        h += '</div>';
        grid.innerHTML = h;
    } catch(e) { grid.innerHTML = '<div style="text-align:center;padding:30px;color:var(--danger);">加载失败</div>'; }
};

App.sc._pickFromMediaLib = async function(filename) {
    var overlay = document.getElementById('_scMediaLibModal');
    if (overlay) overlay.remove();
    try {
        // 下载缩略图并上传到当前第一个词卡
        var resp = await fetch('/api/thumbnails/file/' + filename);
        var blob = await resp.blob();
        var file = new File([blob], filename, {type: blob.type || 'image/jpeg'});
        // 找第一个可见词卡
        var firstZone = document.querySelector('#scPickerCards .wc-card-thumb-zone');
        if (firstZone) {
            var cid = parseInt(firstZone.dataset.cardId);
            if (cid) {
                this._dispatchUpload(cid, file);
                App.toast('媒体已关联到词卡预览', 'success');
            }
        }
    } catch(e) { App.toast('选取失败: ' + e.message, 'error'); }
};

// ==================== Compose ====================
App.sc.compose = async function() {
    var el = document.getElementById('scEditor');
    if (!el || !this.currentId) return;
    var inputs = el.querySelectorAll('.sc-field-input');
    var settings = {};
    inputs.forEach(function(inp){var dim=inp.dataset.dim;if(dim&&inp.value.trim())settings[dim]=inp.value.trim();});
    this.currentSettings = settings;

    var densityEl = el.querySelector('select[onchange*="_onDensityChange"]');
    var density = densityEl ? densityEl.value : 'standard';

    try {
        var d = await App.fetchJSON('/api/scene-composer/compose', {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({settings:settings,density:density})
        });
        if (!d) return;
        this.outputText = d.text||'';
        var outEl = document.getElementById('scOutput');
        if (outEl) outEl.value = this.outputText;
        var meta = document.getElementById('scOutputMeta');
        if (meta && d.stats) {
            meta.textContent = d.stats.char_count+' 字符 · '+d.stats.dimension_count+'/'+(this.dimensions.length||14)+' 维度 · '+d.stats.density;
        }
    } catch(e){console.warn('sc compose:',e);}
};

App.sc._onDensityChange = function(val) { this.compose(); };

App.sc.copyOutput = function() {
    var el = document.getElementById('scOutput');
    if (!el||!el.value) { App.toast('无输出可复制','warning');return; }
    navigator.clipboard.writeText(el.value).then(function(){App.toast('提示词已复制','success');});
};

// ==================== Init ====================
App.sc.init = async function() {
    await this.loadScenes();
    if (this.scenes.length>0 && !this.currentId) await this.openScene(this.scenes[0].id);
    else this.renderEditor();
};

// Hook switchView
var _origSCSwitchView = App.switchView;
App.switchView = function(view) {
    // 清除所有面板 inline display，让 CSS 类控制
    document.querySelectorAll('.view-panel').forEach(function(el) { el.style.display = ''; });
    // 关闭词卡面板
    if (view !== 'scene_composer') {
        var panel = document.getElementById('scRightPanel');
        if (panel) panel.style.display = 'none';
        var vp = document.getElementById('viewSceneComposer');
        if (vp) { vp.style.marginRight = ''; vp.style.paddingRight = ''; }
    }
    _origSCSwitchView.call(this, view);
    if (view === 'scene_composer') {
        var vp = document.getElementById('viewSceneComposer');
        if (vp) vp.style.display='block';
        if (App.sc && App.sc.init) App.sc.init();
    }
};

console.log('[scene_composer] v5.2.0-media ready');
}})();
