// v5.1.0: Scene Composer — 场景设定提示词组装器
// 从 word_card 词库选取维度词条，装配为完整场景提示词
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
    _saveTimer: null
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

    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">';

    for (var i = 0; i < dims.length; i++) {
        var dim = dims[i];
        var val = sets[dim.key] || dim.default || '';
        var hasVal = val && val.trim();

        h += '<div style="border:1px solid ' + (hasVal ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:7px;padding:8px;background:' + (hasVal ? 'rgba(79,70,229,0.02)' : 'var(--bg-card)') + ';transition:all 0.15s;">';
        h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">';
        h += '<label style="font-size:11px;font-weight:600;color:var(--text-muted);cursor:pointer;" onclick="App.sc._toggleRightPicker(\'' + dim.key + '\')">' + (dim.icon||'') + ' ' + App._escape(dim.label) + '</label>';
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
            h += '<div style="margin-top:4px;"><span style="font-size:9px;background:rgba(79,70,229,0.1);color:var(--primary);padding:1px 5px;border-radius:3px;">✦ ' + App._escape(val.substring(0,28)) + '</span></div>';
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

// ==================== Right Panel ====================
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

    var h = '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-color);">';
    h += '<strong style="font-size:13px;">' + (dim.icon||'') + ' ' + App._escape(dim.label) + ' — 词库</strong>';
    h += '<button onclick="document.getElementById(\'scRightPanel\').style.display=\'none\'" style="border:none;background:none;cursor:pointer;font-size:18px;">×</button></div>';

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

    h += '<div id="scPickerCards" style="padding:6px 8px;overflow-y:auto;max-height:calc(100vh - 190px);">';
    h += '<div style="text-align:center;color:var(--text-muted);padding:20px;">加载中...</div></div>';
    panel.innerHTML = h;

    if (this.activeGroupId) this._loadPickerCards(this.activeGroupId);
};

App.sc._switchDimGroup = function(dimKey, groupId) {
    this.activeDim = dimKey;
    this.activeGroupId = parseInt(groupId);
    this._loadPickerCards(this.activeGroupId);
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
            var sel = currentVal && word && (currentVal.indexOf(word)>=0||word.indexOf(currentVal)>=0);
            h += '<div class="s2-right-card-item'+(sel?' selected':'')+'" onclick="App.sc._pickCard(\''+App._escape(word)+'\')" style="display:flex;gap:6px;padding:5px 7px;border:1px solid '+(sel?'#10b981':'var(--border-color)')+';border-radius:5px;margin-bottom:3px;cursor:pointer;'+(sel?'background:rgba(16,185,129,0.08);':'')+'">';
            h += '<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:600;">'+App._escape(word)+'</div>';
            if (def) h += '<div style="font-size:9px;color:var(--text-muted);margin-top:1px;">'+App._escape(def.substring(0,50))+'</div></div>';
            if (sel) h += '<span style="color:#10b981;font-weight:700;">✓</span>';
            h += '</div>';
        }
        container.innerHTML = h||'<div style="text-align:center;padding:20px;color:var(--text-muted);">无匹配词条</div>';
    } catch(e) { container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--danger);">加载失败</div>'; }
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
    _origSCSwitchView.call(this, view);
    if (view === 'scene_composer') {
        document.querySelectorAll('.view-panel').forEach(function(el){el.style.display='none';});
        var vp = document.getElementById('viewSceneComposer');
        if (vp) vp.style.display='block';
        if (App.sc && App.sc.init) App.sc.init();
    }
};

console.log('[scene_composer] v1.0 ready');
}})();
