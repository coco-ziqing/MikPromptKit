// v5.3.0: Unified Composer — 三合一工作台 (场景 + 角色 + 镜头 联合作画布)
// P0-4: 打破三个孤立组装器，在同一界面串联录入→组合→输出
(function() {
'use strict';
(function _wait() {
    try { if (!App || !App.fetchJSON) { setTimeout(_wait, 200); return; } }
    catch(e) { setTimeout(_wait, 200); return; }
    _init();
})();

function _init() {

App.uc = {
    // 三个面板各自的 profile ID
    sceneId: null,
    characterId: null,
    // camera/composer profiles
    sceneProfiles: [],
    characterProfiles: [],
    // 当前选中的维度 settings
    sceneSettings: {},
    characterSettings: {},
    // 左侧选中面板
    activePanel: 'scene', // 'scene' | 'character' | 'prompt'
    // 右下输出
    promptText: '',
    // 输出设置
    density: 'standard',
    outputFormat: 'seedance',
    // 媒体类型
    mediaType: 'image'
};

// ==================== 视图入口 ====================
var _origUCSwitchView = App.switchView;
App.switchView = function(view) {
    // 统一清除所有面板的 inline display，恢复 CSS 类控制
    document.querySelectorAll('.view-panel').forEach(function(el) { el.style.display = ''; });
    _origUCSwitchView.call(this, view);
    if (view === 'unified_composer') {
        App.uc._ensureView();
        var vp = document.getElementById('viewUnifiedComposer');
        if (vp) vp.style.display = 'block';
        App.uc.init();
    }
};

App.uc._ensureView = function() {
    if (document.getElementById('viewUnifiedComposer')) return;
    var mc = document.getElementById('mainContent');
    if (!mc) return;
    var vp = document.createElement('div');
    vp.id = 'viewUnifiedComposer';
    vp.className = 'view-panel';
    vp.style.display = 'block';
    mc.appendChild(vp);
};

App.uc.init = async function() {
    var vp = document.getElementById('viewUnifiedComposer');
    if (!vp) return;
    vp.style.display = 'block';
    this._render();
    await Promise.all([
        this._loadSceneProfiles(),
        this._loadCharacterProfiles()
    ]);
    // 默认加载第一个场景和角色
    if (this.sceneProfiles.length > 0 && !this.sceneId) {
        await this._openScene(this.sceneProfiles[0].id);
    }
    if (this.characterProfiles.length > 0 && !this.characterId) {
        await this._openCharacter(this.characterProfiles[0].id);
    }
};

// ==================== 渲染 ====================
App.uc._render = function() {
    var vp = document.getElementById('viewUnifiedComposer');
    if (!vp) return;

    var h = '';
    h += '<div class="page-header"><h2>🎯 图片提示词组装器</h2><span class="count-info">场景 + 角色 + 提示词 三合一画布</span></div>';

    // 三栏主布局
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:10px;height:calc(100vh - 220px);min-height:500px;margin-top:8px;">';

    // ===== 左栏：场景维度 =====
    h += '<div style="border:1px solid var(--border-color);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;background:var(--bg-card);">';
    h += '<div class="uc-panel-hd" style="padding:8px 12px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:8px;background:rgba(16,185,129,0.06);">';
    h += '<span style="font-size:16px;">🏞</span>';
    h += '<select id="ucSceneSel" class="modal-input" style="flex:1;font-size:12px;padding:4px;" onchange="App.uc._selectScene(this.value)"><option value="">选择场景...</option></select>';
    h += '<button class="btn btn-xs btn-outline" onclick="App.uc._createScene()" style="font-size:10px;">+</button>';
    h += '</div>';
    h += '<div id="ucSceneFields" style="flex:1;overflow-y:auto;padding:8px;">';
    h += '<div style="text-align:center;color:var(--text-muted);padding:30px;">选择或创建场景</div>';
    h += '</div>';
    h += '</div>';

    // ===== 中栏：角色维度 =====
    h += '<div style="border:1px solid var(--border-color);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;background:var(--bg-card);">';
    h += '<div class="uc-panel-hd" style="padding:8px 12px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:8px;background:rgba(236,72,153,0.06);">';
    h += '<span style="font-size:16px;">🎭</span>';
    h += '<select id="ucCharSel" class="modal-input" style="flex:1;font-size:12px;padding:4px;" onchange="App.uc._selectCharacter(this.value)"><option value="">选择角色...</option></select>';
    h += '<button class="btn btn-xs btn-outline" onclick="App.uc._createCharacter()" style="font-size:10px;">+</button>';
    h += '</div>';
    h += '<div id="ucCharFields" style="flex:1;overflow-y:auto;padding:8px;">';
    h += '<div style="text-align:center;color:var(--text-muted);padding:30px;">选择或创建角色</div>';
    h += '</div>';
    h += '</div>';

    // ===== 右栏：输出预览 + 控制 =====
    h += '<div style="border:1px solid var(--border-color);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;background:var(--bg-card);">';
    h += '<div class="uc-panel-hd" style="padding:8px 12px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:8px;">';
    h += '<span style="font-size:16px;">📝</span>';
    h += '<strong style="font-size:13px;">输出预览</strong>';
    h += '<div style="margin-left:auto;display:flex;gap:4px;">';
    h += '<select onchange="App.uc.density=this.value;App.uc._compose()" style="font-size:10px;padding:2px 4px;border:1px solid var(--border-color);border-radius:3px;background:var(--bg-main);">';
    h += '<option value="compact">简洁</option><option value="standard" selected>标准</option><option value="detailed">详细</option></select>';
    h += '<select onchange="App.uc.outputFormat=this.value;App.uc._compose()" style="font-size:10px;padding:2px 4px;border:1px solid var(--border-color);border-radius:3px;background:var(--bg-main);">';
    h += '<option value="seedance">Seedance</option><option value="kling">Kling</option><option value="comfyui">ComfyUI</option><option value="sd">Stable Diffusion</option><option value="raw">Raw Text</option></select>';
    h += '</div>';
    h += '</div>';
    h += '<div id="ucOutput" style="flex:1;padding:10px;">';
    h += '<textarea id="ucOutputText" readonly style="width:100%;height:100%;min-height:250px;font-size:12px;padding:10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-main);color:var(--text-main);resize:none;font-family:monospace;"></textarea>';
    h += '</div>';
    h += '<div style="padding:8px 12px;border-top:1px solid var(--border-color);display:flex;gap:6px;">';
    h += '<button class="btn btn-sm btn-success" onclick="App.uc._copyOutput()" style="flex:1;">📋 复制</button>';
    h += '<button class="btn btn-sm btn-outline" onclick="App.uc._saveProfile()" style="flex:1;">💾 保存设置</button>';
    h += '<label style="font-size:10px;display:flex;align-items:center;gap:3px;color:var(--text-muted);">';
    h += '<input type="checkbox" id="ucMediaType" onchange="App.uc.mediaType=this.checked?\'video\':\'image\';App.uc._compose()"> 视频';
    h += '</label>';
    h += '</div>';
    h += '</div>';

    h += '</div>'; // end grid

    vp.innerHTML = h;
};

// ==================== 场景维度 ====================
App.uc._loadSceneProfiles = async function() {
    try {
        var d = await App.fetchJSON('/api/scene-composer/scenes');
        this.sceneProfiles = d.items || [];
        var sel = document.getElementById('ucSceneSel');
        if (sel) {
            sel.innerHTML = '<option value="">选择场景...</option>' +
                this.sceneProfiles.map(function(s) { return '<option value="' + s.id + '">' + (s.name||'未命名') + '</option>'; }).join('');
        }
    } catch(e) {}
};

App.uc._selectScene = function(id) {
    if (!id) return;
    this._openScene(parseInt(id));
};

App.uc._openScene = async function(id) {
    this.sceneId = id;
    try {
        var d = await App.fetchJSON('/api/scene-composer/scenes/' + id);
        if (!d) return;
        this.sceneSettings = d.scene.settings || {};
        // 加载维度定义
        var dims = await App.fetchJSON('/api/scene-composer/dimensions');
        if (dims && dims.dimensions) {
            this._renderSceneFields(dims.dimensions);
        }
        this._compose();
    } catch(e) { console.warn('uc scene:', e); }
};

App.uc._renderSceneFields = function(dims) {
    var el = document.getElementById('ucSceneFields');
    if (!el) return;
    var h = '';
    dims.forEach(function(dim) {
        var val = (App.uc.sceneSettings || {})[dim.key] || '';
        h += '<div style="margin-bottom:6px;">';
        h += '<label style="font-size:10px;font-weight:600;color:var(--text-muted);">' + (dim.icon||'') + ' ' + (dim.label||dim.key) + '</label>';
        h += '<input class="uc-field-input" data-dim="' + dim.key + '" data-source="scene" value="' + App._escape(val) + '" placeholder="输入... ' + ((dim.groups||[]).length > 0 ? '或点击📚选取' : '') + '" style="width:100%;font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-main);color:var(--text-main);" oninput="App.uc._onFieldChange(this)">';
        h += '</div>';
    });
    el.innerHTML = h;
};

App.uc._createScene = async function() {
    var name = prompt('场景名称:', '新场景');
    if (!name) return;
    try {
        var d = await App.fetchJSON('/api/scene-composer/scenes', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name, settings: {}})
        });
        if (d && d.ok) {
            await this._loadSceneProfiles();
            await this._openScene(d.id);
        }
    } catch(e) { App.showToast('创建失败: ' + e.message, 'danger'); }
};

// ==================== 角色维度 ====================
App.uc._loadCharacterProfiles = async function() {
    try {
        var d = await App.fetchJSON('/api/character-composer/characters');
        this.characterProfiles = d.items || [];
        var sel = document.getElementById('ucCharSel');
        if (sel) {
            sel.innerHTML = '<option value="">选择角色...</option>' +
                this.characterProfiles.map(function(c) { return '<option value="' + c.id + '">' + (c.name||'未命名') + '</option>'; }).join('');
        }
    } catch(e) {}
};

App.uc._selectCharacter = function(id) {
    if (!id) return;
    this._openCharacter(parseInt(id));
};

App.uc._openCharacter = async function(id) {
    this.characterId = id;
    try {
        var d = await App.fetchJSON('/api/character-composer/characters/' + id);
        if (!d) return;
        this.characterSettings = d.character.settings || {};
        var dims = await App.fetchJSON('/api/character-composer/dimensions');
        if (dims && dims.dimensions) {
            this._renderCharFields(dims.dimensions);
        }
        this._compose();
    } catch(e) { console.warn('uc character:', e); }
};

App.uc._renderCharFields = function(dims) {
    var el = document.getElementById('ucCharFields');
    if (!el) return;
    var h = '';
    dims.forEach(function(dim) {
        var val = (App.uc.characterSettings || {})[dim.key] || '';
        h += '<div style="margin-bottom:6px;">';
        h += '<label style="font-size:10px;font-weight:600;color:var(--text-muted);">' + (dim.icon||'') + ' ' + (dim.label||dim.key) + '</label>';
        h += '<input class="uc-field-input" data-dim="' + dim.key + '" data-source="character" value="' + App._escape(val) + '" placeholder="输入..." style="width:100%;font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-main);color:var(--text-main);" oninput="App.uc._onFieldChange(this)">';
        h += '</div>';
    });
    el.innerHTML = h;
};

App.uc._createCharacter = async function() {
    var name = prompt('角色名称:', '新角色');
    if (!name) return;
    try {
        var d = await App.fetchJSON('/api/character-composer/characters', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name, settings: {}})
        });
        if (d && d.ok) {
            await this._loadCharacterProfiles();
            await this._openCharacter(d.id);
        }
    } catch(e) { App.showToast('创建失败: ' + e.message, 'danger'); }
};

// ==================== 字段变更 ====================
var _ucSaveTimer;
App.uc._onFieldChange = function(input) {
    var dim = input.dataset.dim;
    var source = input.dataset.source;
    if (source === 'scene') {
        this.sceneSettings[dim] = input.value;
    } else if (source === 'character') {
        this.characterSettings[dim] = input.value;
    }
    if (_ucSaveTimer) clearTimeout(_ucSaveTimer);
    var self = this;
    _ucSaveTimer = setTimeout(function() { self._compose(); }, 500);
};

// ==================== 组合输出 ====================
App.uc._compose = async function() {
    var out = document.getElementById('ucOutputText');
    if (!out) return;
    
    var parts = [];
    
    // 场景部分
    var hasScene = this.sceneId && this.sceneSettings && Object.values(this.sceneSettings).some(function(v) { return v && v.trim(); });
    if (hasScene) {
        try {
            var sd = await App.fetchJSON('/api/scene-composer/compose', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({settings: this.sceneSettings, density: this.density})
            });
            if (sd && sd.text) parts.push('【场景】\\n' + sd.text);
        } catch(e) {}
    }
    
    // 角色部分
    var hasChar = this.characterId && this.characterSettings && Object.values(this.characterSettings).some(function(v) { return v && v.trim(); });
    if (hasChar) {
        try {
            var cd = await App.fetchJSON('/api/character-composer/compose', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({settings: this.characterSettings, density: this.density})
            });
            if (cd && cd.text) parts.push('【角色】\n' + cd.text);
        } catch(e) {}
    }

    // Phase16: 原子化词卡智能填充
    var atomSug = document.getElementById('ucAtomSuggestions');
    if (atomSug && (this.sceneId || this.characterId)) {
        try {
            var af = await App.fetchJSON('/api/composer/fill/assemble', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    character_id: this.characterId || null,
                    scene_id: this.sceneId || null,
                    camera_fields: {},
                    media_category: this.mediaType || 'image',
                    limit_per_domain: 5
                })
            });
            if (af && af.ok) {
                App.uc._renderAtomSuggestions(af);
                if (af.merged_atoms && af.merged_atoms.length > 0) {
                    var atomsText = af.merged_atoms.slice(0, 8).map(function(a) { return a.atom_text; }).join('，');
                    if (atomsText) parts.push('【原子推荐】\n' + atomsText);
                }
            }
        } catch(e) {}
    }
    
    var fullPrompt = parts.join('\n\n');
    
    // 格式转换
    var fmt = this.outputFormat;
    if (fmt === 'kling') {
        fullPrompt = '相机: [场景镜头]\\n场景: ' + fullPrompt.replace(/\n/g, ', ');
    } else if (fmt === 'comfyui') {
        fullPrompt = '{ "positive": "' + fullPrompt.replace(/"/g, '\\"').replace(/\n/g, ', ') + '", "negative": "" }';
    } else if (fmt === 'sd') {
        fullPrompt = fullPrompt.replace(/\n\n/g, ', ') + ', 8k, masterpiece, best quality';
    }
    
    out.value = fullPrompt || '填写场景和角色维度后自动生成...';
    this.promptText = fullPrompt;
};


// Phase16: 原子推荐面板渲染
App.uc._renderAtomSuggestions = function(af) {
    var el = document.getElementById('ucAtomSuggestions');
    if (!el) return;
    if (!af || !af.merged_atoms || af.merged_atoms.length === 0) {
        el.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0;">暂无匹配原子词卡</div>';
        return;
    }
    var h = '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--accent);">' +
        '\u269B 智能推荐原子词卡 (' + af.total_atoms + '条)</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
    af.merged_atoms.slice(0, 10).forEach(function(a) {
        var typeLabel = a.atom_type || 'general';
        h += '<span class="uc-atom-tag" data-text="' + App._escape(a.atom_text) +
            '" onclick="App.uc._injectAtom(this)" style="cursor:pointer;font-size:10px;padding:2px 6px;' +
            'background:var(--tag-bg);color:var(--text-main);border-radius:10px;' +
            'border:1px solid var(--border-color);white-space:nowrap;' +
            'transition:all .15s;" ' +
            'onmouseover="this.style.background=\'var(--accent)\';this.style.color=\'#fff\'" ' +
            'onmouseout="this.style.background=\'var(--tag-bg)\';this.style.color=\'var(--text-main)\'">' +
            App._escape(a.atom_text.substring(0, 20)) + '</span>';
    });
    h += '</div>';
    el.innerHTML = h;
};

// Phase16: 点击原子标签注入到输出
App.uc._injectAtom = function(tag) {
    var text = tag.dataset.text;
    if (!text) return;
    var out = document.getElementById('ucOutputText');
    if (!out) return;
    if (out.value && out.value !== '填写场景和角色维度后自动生成...') {
        out.value = out.value + '，' + text;
    } else {
        out.value = text;
    }
    this.promptText = out.value;
    App.showToast('\u2713 已注入: ' + text.substring(0, 15), 'success');
};

App.uc._copyOutput = function() {
    var el = document.getElementById('ucOutputText');
    if (!el || !el.value) { App.showToast('无输出可复制', 'warning'); return; }
    navigator.clipboard.writeText(el.value).then(function() { App.showToast('已复制', 'success'); });
};

App.uc._saveProfile = async function() {
    var promises = [];
    if (this.sceneId) {
        promises.push(App.fetchJSON('/api/scene-composer/scenes/' + this.sceneId, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({settings: this.sceneSettings})
        }));
    }
    if (this.characterId) {
        promises.push(App.fetchJSON('/api/character-composer/characters/' + this.characterId, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({settings: this.characterSettings})
        }));
    }
    if (promises.length === 0) { App.showToast('无内容可保存', 'warning'); return; }
    try {
        await Promise.all(promises);
        App.showToast('已保存', 'success');
    } catch(e) { App.showToast('保存失败', 'danger'); }
};

console.log('[unified_composer] v5.3.0 ready');
}})();
