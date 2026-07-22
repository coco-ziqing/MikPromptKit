/**
 * PK_GENERATOR — AI 生成中心 v2.0.0
 * 角色肖像生成 — 捏脸参数面板 + ComfyUI 桥接 + 历史画廊
 * 
 * License: 个人版买断 / 团队版订阅 (com.promptkit.generator)
 */
(function () {
    'use strict';

    // ============================================================
    // 样式注入
    // ============================================================
    var style = document.createElement('style');
    style.textContent = `
        .gen-container { display:flex; height:calc(100vh - 60px); overflow:hidden; }
        .gen-container * { box-sizing:border-box; }
        
        /* 左侧参数面板 */
        .gen-params-panel {
            width:340px; min-width:340px; overflow-y:auto; overflow-x:hidden;
            border-right:1px solid var(--border-color,#e2e8f0); padding:12px;
            background:var(--bg-main,#fafafa); height:100%;
            scrollbar-width:thin;
        }
        .gen-params-panel::-webkit-scrollbar { width:5px; }
        .gen-params-panel::-webkit-scrollbar-thumb { background:var(--border-color); border-radius:3px; }
        
        .gen-param-group { margin-bottom:14px; }
        .gen-param-group-header {
            display:flex; align-items:center; gap:6px;
            font-size:13px; font-weight:600; padding:6px 8px;
            background:var(--bg-card,#fff); border-radius:8px;
            cursor:pointer; user-select:none;
            border:1px solid var(--border-color,#e2e8f0);
            margin-bottom:6px;
        }
        .gen-param-group-header:hover { border-color:var(--primary,#4f46e5); }
        .gen-param-group-body { padding:0 4px; transition:all 0.2s; }
        .gen-param-group-body.collapsed { display:none; }
        
        .gen-param-row { margin-bottom:10px; }
        .gen-param-label { font-size:11px; color:var(--text-muted,#888); margin-bottom:3px; display:block; }
        .gen-param-slider-wrap { display:flex; align-items:center; gap:8px; }
        .gen-param-slider {
            flex:1; height:4px; -webkit-appearance:none; appearance:none;
            background:var(--border-color,#ddd); border-radius:2px; outline:none;
        }
        .gen-param-slider::-webkit-slider-thumb {
            -webkit-appearance:none; width:16px; height:16px; border-radius:50%;
            background:var(--primary,#4f46e5); cursor:pointer; border:2px solid #fff;
            box-shadow:0 1px 3px rgba(0,0,0,.2);
        }
        .gen-param-slider-val {
            font-size:11px; color:var(--primary,#4f46e5); min-width:36px;
            text-align:right; font-weight:600;
        }
        .gen-param-select {
            width:100%; padding:5px 8px; font-size:12px;
            border:1px solid var(--border-color,#ddd); border-radius:6px;
            background:var(--bg-card,#fff); color:var(--text-main,#333);
            cursor:pointer;
        }
        .gen-param-color {
            width:36px; height:28px; padding:0; border:1px solid var(--border-color,#ddd);
            border-radius:6px; cursor:pointer; vertical-align:middle;
        }
        .gen-param-color-label { font-size:11px; color:var(--text-muted); margin-left:6px; vertical-align:middle; }
        
        .gen-ratio-btns { display:flex; flex-wrap:wrap; gap:4px; margin:8px 0; }
        .gen-ratio-btn {
            padding:4px 8px; font-size:10px; border:1px solid var(--border-color,#ddd);
            border-radius:4px; cursor:pointer; background:var(--bg-card,#fff);
            color:var(--text-main,#333); transition:all .15s;
        }
        .gen-ratio-btn.active { border-color:var(--primary,#4f46e5); color:var(--primary,#4f46e5); background:rgba(79,70,229,.05); }
        
        /* 右侧预览区 */
        .gen-preview-panel {
            flex:1; display:flex; flex-direction:column; overflow:hidden;
        }
        .gen-preview-toolbar {
            display:flex; align-items:center; gap:8px; padding:10px 14px;
            border-bottom:1px solid var(--border-color,#e2e8f0);
            background:var(--bg-card,#fff); flex-shrink:0;
        }
        .gen-preview-area {
            flex:1; overflow-y:auto; padding:16px;
            display:flex; flex-direction:column; align-items:center;
            background:var(--bg-main,#fafafa);
            scrollbar-width:thin;
        }
        
        .gen-result-card {
            width:100%; max-width:512px; margin-bottom:20px;
            border:1px solid var(--border-color,#e2e8f0); border-radius:12px;
            overflow:hidden; background:var(--bg-card,#fff);
            box-shadow:0 2px 8px rgba(0,0,0,.04);
        }
        .gen-result-card img { width:100%; display:block; }
        .gen-result-info {
            padding:10px 14px; display:flex; justify-content:space-between;
            align-items:center; font-size:11px; color:var(--text-muted,#888);
        }
        .gen-result-actions { display:flex; gap:6px; }
        .gen-history-grid {
            display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr));
            gap:10px; width:100%; max-width:768px;
        }
        .gen-history-item {
            border:1px solid var(--border-color,#e2e8f0); border-radius:8px;
            overflow:hidden; cursor:pointer; transition:all .15s;
            background:var(--bg-card,#fff);
        }
        .gen-history-item:hover { border-color:var(--primary,#4f46e5); box-shadow:0 2px 8px rgba(0,0,0,.08); }
        .gen-history-item img { width:100%; aspect-ratio:1; object-fit:cover; display:block; }
        .gen-history-item-info { padding:4px 8px; font-size:10px; color:var(--text-muted,#888); }
        .gen-history-item-status {
            display:inline-block; padding:1px 5px; border-radius:3px; font-size:9px;
            font-weight:600; margin-top:2px;
        }
        .gen-status-done { background:#dcfce7; color:#166534; }
        .gen-status-failed { background:#fee2e2; color:#991b1b; }
        .gen-status-generating { background:#dbeafe; color:#1e40af; }
        
        .gen-section-title {
            font-size:13px; font-weight:600; margin:16px 0 10px 0;
            display:flex; align-items:center; gap:6px;
        }
        
        .gen-btn {
            padding:6px 14px; font-size:12px; border-radius:6px; cursor:pointer;
            border:1px solid var(--border-color,#ddd); background:var(--bg-card,#fff);
            color:var(--text-main,#333); display:inline-flex; align-items:center; gap:5px;
            transition:all .15s;
        }
        .gen-btn:hover { border-color:var(--primary,#4f46e5); }
        .gen-btn-primary {
            background:var(--primary,#4f46e5); color:#fff; border-color:var(--primary,#4f46e5);
        }
        .gen-btn-primary:hover { opacity:0.9; }
        .gen-btn-xs { padding:2px 6px; font-size:10px; border-radius:3px; }
        .gen-btn-sm { padding:4px 10px; font-size:11px; border-radius:4px; }
        .gen-btn-danger { border-color:#ef4444; color:#ef4444; }
        .gen-btn-danger:hover { background:#fef2f2; }
        
        .gen-empty-state {
            text-align:center; padding:60px 20px; color:var(--text-muted,#888);
        }
        .gen-empty-state .gen-icon { font-size:48px; margin-bottom:12px; opacity:0.3; }
        
        .gen-source-dropdown {
            position:relative; display:inline-block;
        }
        .gen-source-menu {
            position:absolute; top:100%; left:0; z-index:100;
            background:var(--bg-card,#fff); border:1px solid var(--border-color,#ddd);
            border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.1);
            min-width:200px; padding:4px; display:none;
        }
        .gen-source-menu.show { display:block; }
        .gen-source-item {
            padding:6px 10px; font-size:12px; cursor:pointer; border-radius:4px;
            color:var(--text-main,#333);
        }
        .gen-source-item:hover { background:var(--hover-bg,#f1f5f9); }
        
        .gen-loading-spinner {
            display:inline-block; width:20px; height:20px;
            border:2px solid var(--border-color,#ddd);
            border-top-color:var(--primary,#4f46e5);
            border-radius:50%; animation:gen-spin .8s linear infinite;
        }
        @keyframes gen-spin { to { transform:rotate(360deg); } }
        
        @media (max-width:768px) {
            .gen-container { flex-direction:column; }
            .gen-params-panel { width:100%; min-width:unset; max-height:40vh; border-right:none; border-bottom:1px solid var(--border-color); }
        }
    `;
    document.head.appendChild(style);

    // ============================================================
    // 状态管理
    // ============================================================
    var GEN = {
        schema: null,
        currentParams: {},
        aspectRatio: '1:1',
        history: [],
        currentJobId: null,
        isGenerating: false,
        presets: [],
        characters: [],
        collapsedGroups: {},
        wfConfig: null,
    };

    function apiUrl(path) {
        return '/api/plugins/com.promptkit.generator' + path;
    }

    async function apiFetch(path, opts) {
        try {
            var resp = await fetch(apiUrl(path), opts);
            if (!resp.ok) throw new Error(resp.status + ' ' + resp.statusText);
            var ct = resp.headers.get('content-type') || '';
            if (ct.indexOf('json') >= 0) return await resp.json();
            return resp;
        } catch (e) {
            console.warn('[GEN] API error:', path, e.message);
            throw e;
        }
    }

    // ============================================================
    // 占位视图（场景/分镜）
    // ============================================================
    function placeholderView(icon, title, desc) {
        var genRoot = document.getElementById('genRoot');
        if (!genRoot) return;
        genRoot.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:40px;text-align:center;color:var(--text-muted);">' +
            '<div style="font-size:64px;margin-bottom:20px;opacity:0.4;">' + icon + '</div>' +
            '<h2>' + title + '</h2><p style="max-width:400px;">' + desc + '</p>' +
            '<span style="padding:4px 14px;border-radius:20px;background:var(--bg-card);font-size:11px;border:1px solid var(--border-color);">预埋阶段 · 即将开放</span>' +
            '</div>';
    }

    // ============================================================
    // 主视图 — 角色生成
    // ============================================================
    function renderCharacterView() {
        var genRoot = document.getElementById('genRoot');
        if (!genRoot) return;
        // genRoot 容器由 index.html 提供，直接加载
        loadSchema();
    }

    async function loadSchema() {
        try {
            var data = await apiFetch('/schema');
            GEN.schema = data.schema;
            GEN.aspectRatios = data.aspect_ratios || [];
            GEN.currentParams = await loadDefaultParams();
            loadPresets();
            loadCharacters();
            _loadWfConfig();
            renderAll();
        } catch (e) {
            var root = document.getElementById('genRoot');
            if (root) root.innerHTML = '<div class="gen-empty-state"><div class="gen-icon">⚠</div><p>加载参数配置失败: ' + e.message + '</p></div>';
        }
    }

    async function loadDefaultParams() {
        try {
            var data = await apiFetch('/defaults');
            return data.params || {};
        } catch (e) { return {}; }
    }

    async function loadPresets() {
        try {
            var data = await apiFetch('/presets');
            GEN.presets = data.presets || [];
            renderPresetList();
        } catch (e) { GEN.presets = []; }
    }

    async function loadCharacters() {
        try {
            var data = await apiFetch('/characters');
            GEN.characters = data.characters || [];
            renderCharacterList();
        } catch (e) { GEN.characters = []; }
    }

    async function loadHistory(page) {
        page = page || 1;
        try {
            var data = await apiFetch('/history?page=' + page + '&limit=32');
            GEN.history = data.jobs || [];
            renderHistory();
        } catch (e) { GEN.history = []; }
    }

    // ============================================================
    // 渲染
    // ============================================================
    function renderAll() {
        var root = document.getElementById('genRoot');
        if (!root) return;
        root.innerHTML =
            '<div class="gen-params-panel" id="genParamsPanel">' +
                buildParamsPanel() +
            '</div>' +
            '<div class="gen-preview-panel" id="genPreviewPanel">' +
                '<div class="gen-preview-toolbar" id="genToolbar">' +
                    buildToolbar() +
                '</div>' +
                '<div class="gen-preview-area" id="genPreviewArea">' +
                    '<div class="gen-empty-state"><div class="gen-icon">🎭</div><p>调整左侧参数后点击「生成」</p></div>' +
                '</div>' +
            '</div>';
        loadHistory(1);
    }

    function buildToolbar() {
        var h = '';
        h += '<div class="gen-source-dropdown">';
        h += '<button class="gen-btn gen-btn-sm" onclick="PK_GENERATOR._toggleSourceMenu()">📥 数据来源</button>';
        h += '<div class="gen-source-menu" id="genSourceMenu">';
        h += '<div class="gen-source-item" onclick="PK_GENERATOR._sourceCharList()">🎭 从角色组装器加载</div>';
        h += '<div class="gen-source-item" onclick="PK_GENERATOR._sourceWordCards()">📚 从角色词卡选取</div>';
        h += '<div class="gen-source-item" onclick="PK_GENERATOR._loadPresetList()">💾 从预设加载</div>';
        h += '</div></div>';

        h += '<div id="genCharBadge" style="font-size:11px;color:var(--text-muted);"></div>';

        h += '<div style="flex:1;"></div>';
        h += '<button class="gen-btn gen-btn-sm" onclick="PK_GENERATOR._openWorkflowConfig()" title="配置生成专用 ComfyUI 工作流" style="border-color:#6366f1;color:#6366f1;" id="genWfStatus">⚙ 工作流</button>';
        h += '<button class="gen-btn gen-btn-primary" onclick="PK_GENERATOR.generate()" id="genSubmitBtn">🔮 生成 (1张)</button>';
        h += '<button class="gen-btn gen-btn-sm" onclick="PK_GENERATOR._randomParams()">🎲 随机</button>';
        h += '<button class="gen-btn gen-btn-sm" onclick="PK_GENERATOR._savePreset()">💾 保存</button>';
        return h;
    }

    function buildParamsPanel() {
        var h = '';
        if (!GEN.schema) return '<div class="gen-empty-state"><p>加载中...</p></div>';

        // 提示词来源信息
        h += '<div style="margin-bottom:12px;padding:8px 10px;background:var(--bg-card,#fff);border-radius:8px;border:1px solid var(--border-color);">';
        h += '<span style="font-size:11px;color:var(--text-muted);">🎯 当前参数</span>';
        h += '</div>';

        // 作品比例
        h += '<div class="gen-param-row"><span class="gen-param-label">📐 作品比例</span>';
        h += '<div class="gen-ratio-btns" id="genRatioBtns">';
        (GEN.aspectRatios || []).forEach(function (ar) {
            var active = GEN.aspectRatio === ar.value ? ' active' : '';
            h += '<button class="gen-ratio-btn' + active + '" data-ratio="' + ar.value + '" title="' + ar.label + '" onclick="PK_GENERATOR._setAspectRatio(\'' + ar.value + '\')">' + ar.value + '</button>';
        });
        h += '</div></div>';

        // 参数分组
        var groups = GEN.schema;
        var groupKeys = Object.keys(groups).sort(function (a, b) { return (groups[a].order || 99) - (groups[b].order || 99); });
        groupKeys.forEach(function (gk) {
            var grp = groups[gk];
            var collapsed = GEN.collapsedGroups[gk];
            h += '<div class="gen-param-group">';
            h += '<div class="gen-param-group-header" onclick="PK_GENERATOR._toggleGroup(\'' + gk + '\')">';
            h += '<span style="font-size:10px;">' + (collapsed ? '▶' : '▼') + '</span>';
            h += '<i class="bi ' + (grp.icon || 'bi-sliders') + '" style="font-size:13px;color:var(--primary);"></i>';
            h += grp.label;
            h += '</div>';
            h += '<div class="gen-param-group-body' + (collapsed ? ' collapsed' : '') + '" id="genGroup_' + gk + '">';
            var pkeys = Object.keys(grp.params);
            pkeys.forEach(function (pk) {
                var param = grp.params[pk];
                var val = (GEN.currentParams[gk] && GEN.currentParams[gk][pk] !== undefined) ? GEN.currentParams[gk][pk] : param.default;
                h += buildParamRow(gk, pk, param, val);
            });
            h += '</div></div>';
        });
        return h;
    }

    function buildParamRow(groupKey, paramKey, param, currentVal) {
        var h = '<div class="gen-param-row">';
        var name = groupKey + '.' + paramKey;

        if (param.type === 'select') {
            h += '<label class="gen-param-label">' + param.label + '</label>';
            h += '<select class="gen-param-select" data-param="' + name + '" onchange="PK_GENERATOR._onParamChange(event)">';
            (param.options || []).forEach(function (opt) {
                var sel = opt.value === currentVal ? ' selected' : '';
                h += '<option value="' + opt.value + '"' + sel + '>' + opt.label + '</option>';
            });
            h += '</select>';

        } else if (param.type === 'slider') {
            var pct = Math.round((currentVal - param.min) / (param.max - param.min) * 100);
            h += '<label class="gen-param-label">' + param.label + '</label>';
            h += '<div class="gen-param-slider-wrap">';
            h += '<input type="range" class="gen-param-slider" data-param="' + name + '" min="' + param.min + '" max="' + param.max + '" step="' + (param.step || 0.05) + '" value="' + currentVal + '" oninput="PK_GENERATOR._onSliderInput(event)" onchange="PK_GENERATOR._onParamChange(event)">';
            h += '<span class="gen-param-slider-val">' + currentVal.toFixed(2) + '</span>';
            h += '</div>';

        } else if (param.type === 'color') {
            h += '<label class="gen-param-label">' + param.label + '</label>';
            h += '<input type="color" class="gen-param-color" data-param="' + name + '" value="' + (currentVal || param.default) + '" onchange="PK_GENERATOR._onParamChange(event)">';
            var colorLabel = '';
            if (param.prompt_choices) {
                for (var hexKey in param.prompt_choices) {
                    if (hexKey === currentVal) {
                        colorLabel = ' · ' + param.prompt_choices[hexKey];
                        break;
                    }
                }
            }
            h += '<span class="gen-param-color-label" id="colorLabel_' + name + '">' + colorLabel + '</span>';
        }

        h += '</div>';
        return h;
    }

    function renderPresetList() {
        var area = document.getElementById('genPresetArea');
        if (!area) return;
        if (GEN.presets.length === 0) {
            area.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px;">暂无已保存的预设</div>';
            return;
        }
        var h = '';
        GEN.presets.forEach(function (p) {
            h += '<div class="gen-source-item" onclick="PK_GENERATOR._applyPreset(' + p.id + ')" title="' + (p.description || '') + '">💾 ' + esc(p.name) + ' <span style="font-size:10px;color:var(--text-muted);">' + (p.aspect_ratio || '1:1') + '</span></div>';
        });
        area.innerHTML = h;
    }

    function renderCharacterList() {
        var area = document.getElementById('genCharsArea');
        if (!area) return;
        if (GEN.characters.length === 0) {
            area.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px;">暂无角色（请先在角色组装器创建）</div>';
            return;
        }
        var h = '';
        GEN.characters.forEach(function (c) {
            h += '<div class="gen-source-item" onclick="PK_GENERATOR._applyCharacter(' + c.id + ')" style="display:flex;align-items:center;gap:6px;">🎭 ' + esc(c.name) + '</div>';
        });
        area.innerHTML = h;
    }

    function renderHistory() {
        var area = document.getElementById('genPreviewArea');
        if (!area) return;

        if (GEN.history.length === 0) {
            if (GEN.currentJobId) return; // 正在生成中
            area.innerHTML = '<div class="gen-empty-state"><div class="gen-icon">🎭</div><p>调整左侧参数后点击「生成」</p></div>';
            return;
        }

        var h = '';
        h += '<div class="gen-section-title">📋 生成历史 (' + GEN.history.length + ')</div>';
        h += '<div class="gen-history-grid">';
        GEN.history.forEach(function (job) {
            var statusClass = '';
            if (job.status === 'done') statusClass = 'gen-status-done';
            else if (job.status === 'failed') statusClass = 'gen-status-failed';
            else statusClass = 'gen-status-generating';

            h += '<div class="gen-history-item" onclick="PK_GENERATOR._previewJob(' + job.id + ')" id="genHist_' + job.id + '">';
            if (job.thumb_path) {
                h += '<img src="' + apiUrl('/generate/' + job.id + '/thumb') + '?t=' + Date.now() + '" loading="lazy" alt="生成结果">';
            } else if (job.status === 'failed') {
                h += '<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:#fef2f2;color:#ef4444;">❌</div>';
            } else {
                h += '<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:#f8fafc;">';
                h += '<div class="gen-loading-spinner"></div></div>';
            }
            h += '<div class="gen-history-item-info">';
            h += '<span style="font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(job.aspect_ratio || '1:1') + '</span>';
            h += '<span class="gen-history-item-status ' + statusClass + '">' + statusLabel(job.status) + '</span>';
            if (job.rating) h += '⭐'.repeat(job.rating);
            h += '</div></div>';
        });
        h += '</div>';
        area.innerHTML = h;
    }

    function statusLabel(s) {
        var map = { 'done': '完成', 'failed': '失败', 'generating': '生成中', 'queued': '排队中', 'pending': '等待中' };
        return map[s] || s;
    }

    function esc(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ============================================================
    // 参数操作
    // ============================================================
    function _toggleGroup(gk) {
        GEN.collapsedGroups[gk] = !GEN.collapsedGroups[gk];
        var body = document.getElementById('genGroup_' + gk);
        if (body) body.classList.toggle('collapsed');
        // 更新箭头
        var panel = document.getElementById('genParamsPanel');
        if (panel) {
            var headers = panel.querySelectorAll('.gen-param-group-header');
            headers.forEach(function (h) {
                var arrow = h.querySelector('span');
                if (h.onclick && h.onclick.toString().indexOf("'" + gk + "'") >= 0 && arrow) {
                    arrow.textContent = GEN.collapsedGroups[gk] ? '▶' : '▼';
                }
            });
        }
    }

    function _onParamChange(event) {
        var el = event.target;
        var name = el.getAttribute('data-param');
        var parts = name.split('.');
        var gk = parts[0], pk = parts[1];
        if (!GEN.currentParams[gk]) GEN.currentParams[gk] = {};
        GEN.currentParams[gk][pk] = el.type === 'number' ? parseFloat(el.value) : el.value;
    }

    function _onSliderInput(event) {
        _onParamChange(event);
        var val = parseFloat(event.target.value);
        var row = event.target.closest('.gen-param-slider-wrap');
        if (row) {
            var valSpan = row.querySelector('.gen-param-slider-val');
            if (valSpan) valSpan.textContent = val.toFixed(2);
        }
    }

    function _setAspectRatio(ratio) {
        GEN.aspectRatio = ratio;
        var btns = document.querySelectorAll('.gen-ratio-btn');
        btns.forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-ratio') === ratio);
        });
    }

    function _randomParams() {
        if (!GEN.schema) return;
        var groups = GEN.schema;
        Object.keys(groups).forEach(function (gk) {
            if (!GEN.currentParams[gk]) GEN.currentParams[gk] = {};
            var grp = groups[gk];
            Object.keys(grp.params).forEach(function (pk) {
                var param = grp.params[pk];
                if (param.type === 'slider') {
                    GEN.currentParams[gk][pk] = param.min + Math.random() * (param.max - param.min);
                } else if (param.type === 'select' && param.options && param.options.length > 0) {
                    var r = Math.floor(Math.random() * param.options.length);
                    GEN.currentParams[gk][pk] = param.options[r].value;
                } else if (param.type === 'color' && param.prompt_choices) {
                    var keys = Object.keys(param.prompt_choices);
                    GEN.currentParams[gk][pk] = keys[Math.floor(Math.random() * keys.length)];
                }
            });
        });
        refreshParamsPanel();
    }

    function refreshParamsPanel() {
        var panel = document.getElementById('genParamsPanel');
        if (!panel) return;
        panel.innerHTML = buildParamsPanel();
    }

    // ============================================================
    // 预设管理
    // ============================================================
    async function _savePreset() {
        var name = prompt('预设名称:', '我的预设 ' + new Date().toLocaleTimeString());
        if (!name) return;
        try {
            var data = await apiFetch('/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    params_json: GEN.currentParams,
                    aspect_ratio: GEN.aspectRatio,
                    description: ''
                })
            });
            if (data.ok) {
                alert('预设已保存: ' + name);
                loadPresets();
            }
        } catch (e) {
            alert('保存失败: ' + e.message);
        }
    }

    async function _applyPreset(pid) {
        try {
            var data = await apiFetch('/presets/' + pid);
            if (data.ok && data.preset) {
                try {
                    GEN.currentParams = JSON.parse(data.preset.params_json || '{}');
                } catch (e) { GEN.currentParams = {}; }
                GEN.aspectRatio = data.preset.aspect_ratio || '1:1';
                if (data.preset.character_id) {
                    document.getElementById('genCharBadge').textContent = '角色ID:' + data.preset.character_id;
                }
                refreshParamsPanel();
            }
        } catch (e) {
            console.warn('应用预设失败:', e);
        }
        closeAllMenus();
    }

    function _loadPresetList() {
        var menu = document.getElementById('genPresetArea');
        if (!menu) return;
        if (!document.getElementById('genPresetSubMenu')) {
            var h = '<div id="genPresetSubMenu" style="padding:4px;">';
            h += '<div style="font-size:10px;color:var(--text-muted);padding:4px 10px;">已保存的预设</div>';
            h += '<div id="genPresetArea">加载中...</div>';
            h += '</div>';
            menu.innerHTML = h;
        }
        renderPresetList();
        var m = document.getElementById('genSourceMenu');
        if (m) m.classList.add('show');
    }

    // ============================================================
    // 角色组装器关联
    // ============================================================
    function _sourceCharList() {
        var menu = document.getElementById('genSourceMenu');
        if (!menu) return;
        menu.innerHTML = '';
        var h = '<div style="font-size:10px;color:var(--text-muted);padding:4px 10px;">从角色组装器加载</div>';
        h += '<div id="genCharsArea">加载中...</div>';
        menu.innerHTML = h;
        menu.classList.add('show');
        renderCharacterList();
    }

    async function _applyCharacter(cid) {
        try {
            var data = await apiFetch('/characters/load', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ character_id: cid })
            });
            if (data.ok) {
                GEN.currentParams = data.params || {};
                document.getElementById('genCharBadge').textContent = '🎭 ' + (data.character_name || '');
                refreshParamsPanel();
            }
        } catch (e) {
            console.warn('加载角色失败:', e);
        }
        closeAllMenus();
    }

    // ============================================================
    // 词卡关联
    // ============================================================
    async function _sourceWordCards() {
        var menu = document.getElementById('genSourceMenu');
        if (!menu) return;
        menu.innerHTML = '<div style="padding:4px;"><div style="font-size:10px;color:var(--text-muted);padding:4px 10px;">从角色词卡选取</div><div id="genWCList" style="max-height:300px;overflow-y:auto;">加载中...</div></div>';
        menu.classList.add('show');

        try {
            var data = await apiFetch('/wordcards');
            var groups = data.groups || [];
            var h = '';
            if (groups.length === 0) {
                h = '<div style="font-size:11px;color:var(--text-muted);padding:8px;">暂无角色相关词卡分组</div>';
            }
            groups.forEach(function (g) {
                h += '<div style="padding:2px 10px;font-size:10px;color:var(--text-muted);font-weight:600;">' + esc(g.name) + ' (' + (g.cards ? g.cards.length : 0) + ')</div>';
                (g.cards || []).forEach(function (card) {
                    h += '<div class="gen-source-item" style="display:flex;align-items:center;gap:6px;padding:3px 14px;" onclick="PK_GENERATOR._injectWordCards([' + card.card_id + '])">📄 ' + esc(card.title || card.content || '无标题') + '</div>';
                });
            });
            var area = document.getElementById('genWCList');
            if (area) area.innerHTML = h;
        } catch (e) {
            var area = document.getElementById('genWCList');
            if (area) area.innerHTML = '<div style="color:#ef4444;font-size:11px;padding:8px;">加载失败: ' + e.message + '</div>';
        }
    }

    async function _injectWordCards(cardIds) {
        try {
            var data = await apiFetch('/wordcards/inject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    card_ids: cardIds,
                    current_params: GEN.currentParams
                })
            });
            if (data.ok) {
                GEN.currentParams = data.params || GEN.currentParams;
                refreshParamsPanel();
            }
        } catch (e) { console.warn('注入词卡失败:', e); }
        closeAllMenus();
    }

    // ============================================================
    // 菜单管理
    // ============================================================
    function _toggleSourceMenu() {
        var menu = document.getElementById('genSourceMenu');
        if (!menu) return;
        if (menu.classList.contains('show')) {
            closeAllMenus();
        } else {
            // reset to default
            menu.innerHTML =
                '<div class="gen-source-item" onclick="PK_GENERATOR._sourceCharList()">🎭 从角色组装器加载</div>' +
                '<div class="gen-source-item" onclick="PK_GENERATOR._sourceWordCards()">📚 从角色词卡选取</div>' +
                '<div class="gen-source-item" onclick="PK_GENERATOR._loadPresetList()">💾 从预设加载</div>';
            menu.classList.add('show');
        }
    }

    function closeAllMenus() {
        var menus = document.querySelectorAll('.gen-source-menu');
        menus.forEach(function (m) { m.classList.remove('show'); });
    }

    // 点击其他地方关闭菜单
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.gen-source-dropdown')) {
            closeAllMenus();
        }
        if (!e.target.closest('#genWfModal') && !e.target.closest('.gen-btn') || (e.target.closest('#genWfModal'))) {
            // keep modal open
        }
    });

    // ============================================================
    // 工作流配置弹窗（生成器专属，与词卡预览工作流完全独立）
    // ============================================================

    // 注入工作流配置弹窗 HTML
    var wfModalHTML = document.createElement('div');
    wfModalHTML.innerHTML = 
        '<div class="modal-overlay" id="genWfModal" style="display:none;z-index:600;" onclick="if(event.target===this)this.style.display=\'none\'">' +
        '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:540px;max-height:80vh;display:flex;flex-direction:column;">' +
        '<div class="modal-header">' +
        '<h5>⚙ 角色肖像生成 · 工作流配置</h5>' +
        '<button class="header-btn-sm" onclick="document.getElementById(\'genWfModal\').style.display=\'none\'">&times;</button>' +
        '</div>' +
        '<div class="modal-body" style="flex:1;overflow-y:auto;" id="genWfModalBody">加载中...</div>' +
        '<div class="modal-footer">' +
        '<button class="btn btn-primary btn-sm" onclick="PK_GENERATOR._saveWfConfig()">💾 保存配置</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'genWfModal\').style.display=\'none\'">关闭</button>' +
        '</div></div></div>';
    document.body.appendChild(wfModalHTML.firstElementChild);

    async function _loadWfConfig() {
        try {
            var data = await apiFetch('/workflow-config');
            GEN.wfConfig = data.config || {};
            _updateWfStatusBtn();
        } catch (e) {
            GEN.wfConfig = { enabled: false, server_url: 'http://127.0.0.1:8188', workflows: [], active_workflow: '' };
        }
    }

    function _updateWfStatusBtn() {
        var btn = document.getElementById('genWfStatus');
        if (!btn) return;
        var cfg = GEN.wfConfig || {};
        if (cfg.enabled && cfg.workflows && cfg.workflows.length > 0) {
            btn.style.color = '#059669';
            btn.style.borderColor = '#059669';
            btn.title = '已配置: ' + (cfg.workflows[0].name || '角色肖像工作流');
        } else {
            btn.style.color = '#f59e0b';
            btn.style.borderColor = '#f59e0b';
            btn.title = '未配置工作流 — 点击配置';
        }
    }

    function _openWorkflowConfig() {
        var modal = document.getElementById('genWfModal');
        if (!modal) return;
        modal.style.display = 'flex';
        _renderWfConfig();
    }

    function _renderWfConfig() {
        var body = document.getElementById('genWfModalBody');
        if (!body) return;
        var cfg = GEN.wfConfig || { enabled: false, server_url: 'http://127.0.0.1:8188', workflows: [], active_workflow: '' };

        var h = '';
        h += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;padding:8px 10px;background:#fefce8;border-radius:6px;border:1px solid #fde68a;">';
        h += '⚠ <strong>独立配置</strong>：此工作流仅供角色肖像生成使用，不会影响词库提示词预览的 ComfyUI 工作流。';
        h += '</div>';

        // 服务器地址
        h += '<div style="margin-bottom:10px;"><label style="font-size:12px;color:var(--text-muted);">ComfyUI 服务器地址</label>';
        h += '<input type="text" id="genWfServerUrl" class="modal-input" value="' + esc(cfg.server_url || 'http://127.0.0.1:8188') + '" placeholder="http://127.0.0.1:8188"></div>';

        // 启用开关
        h += '<div style="margin-bottom:10px;"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">';
        h += '<input type="checkbox" id="genWfEnabled" ' + (cfg.enabled ? 'checked' : '') + '> 启用角色肖像生成工作流</label></div>';

        // 已有工作流
        var wfs = cfg.workflows || [];
        h += '<div style="margin-bottom:8px;"><div style="font-size:13px;font-weight:600;margin-bottom:8px;">已导入的工作流 (' + wfs.length + ')</div>';
        if (wfs.length === 0) {
            h += '<div style="font-size:12px;color:var(--text-muted);padding:8px;background:var(--hover-bg,#f1f5f9);border-radius:6px;">暂无工作流 — 请在 ComfyUI 开发者模式导出 API 格式工作流 JSON，然后导入</div>';
        }
        for (var i = 0; i < wfs.length; i++) {
            var w = wfs[i];
            var active = w.id === cfg.active_workflow;
            h += '<div style="background:var(--hover-bg,#f1f5f9);border-radius:6px;padding:8px 10px;margin-bottom:6px;border:1px solid ' + (active ? 'var(--primary,#4f46e5)' : 'transparent') + ';">';
            h += '<div style="display:flex;align-items:center;justify-content:space-between;">';
            h += '<div>';
            h += '<strong style="font-size:12px;">' + esc(w.name || '未命名') + '</strong>';
            h += '<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">' + esc(w.description || '') + '</span>';
            h += '</div>';
            h += '<div style="display:flex;gap:4px;">';
            h += '<button class="gen-btn gen-btn-xs" onclick="PK_GENERATOR._activateWf(\'' + w.id + '\')" style="border-color:' + (active ? 'var(--primary,#4f46e5)' : 'var(--border-color)') + ';">' + (active ? '✓ 当前' : '激活') + '</button>';
            h += '<button class="gen-btn gen-btn-xs gen-btn-danger" onclick="PK_GENERATOR._deleteWf(\'' + w.id + '\')">删除</button>';
            h += '</div></div></div>';
        }
        h += '</div>';

        // 导入按钮
        h += '<div style="margin-top:8px;display:flex;gap:6px;">';
        h += '<button class="gen-btn gen-btn-sm" onclick="document.getElementById(\'genWfFileInput\').click()" style="border-color:#6366f1;color:#6366f1;">📂 导入工作流 JSON</button>';
        h += '<input type="file" id="genWfFileInput" accept=".json" style="display:none;" onchange="PK_GENERATOR._importWf(this)">';
        h += '</div>';
        h += '<div id="genWfImportStatus" style="margin-top:8px;font-size:11px;"></div>';

        body.innerHTML = h;
    }

    function _importWf(input) {
        var file = input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = async function (e) {
            try {
                var wf = JSON.parse(e.target.result);
                var statusEl = document.getElementById('genWfImportStatus');
                if (statusEl) { statusEl.textContent = '正在导入...'; statusEl.style.color = 'var(--text-muted)'; }

                var name = prompt('工作流名称:', '角色肖像工作流');
                if (!name) { if (statusEl) statusEl.textContent = ''; return; }

                var data = await apiFetch('/workflow-config/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workflow_json: wf, name: name })
                });

                if (data.ok) {
                    GEN.wfConfig.workflows = GEN.wfConfig.workflows || [];
                    GEN.wfConfig.workflows.push(data.workflow);
                    GEN.wfConfig.active_workflow = data.workflow.id;
                    if (statusEl) { statusEl.textContent = '✅ 导入成功: ' + name; statusEl.style.color = '#059669'; }
                    _renderWfConfig();
                    _updateWfStatusBtn();
                }
            } catch (err) {
                var statusEl = document.getElementById('genWfImportStatus');
                if (statusEl) { statusEl.textContent = '❌ ' + err.message; statusEl.style.color = '#ef4444'; }
            }
        };
        reader.readAsText(file);
    }

    async function _activateWf(wfId) {
        GEN.wfConfig.active_workflow = wfId;
        await _saveWfConfigToServer();
        _renderWfConfig();
        _updateWfStatusBtn();
    }

    async function _deleteWf(wfId) {
        if (!confirm('确认删除此工作流？')) return;
        GEN.wfConfig.workflows = (GEN.wfConfig.workflows || []).filter(function (w) { return w.id !== wfId; });
        if (GEN.wfConfig.active_workflow === wfId) {
            GEN.wfConfig.active_workflow = GEN.wfConfig.workflows.length > 0 ? GEN.wfConfig.workflows[0].id : '';
        }
        await _saveWfConfigToServer();
        _renderWfConfig();
        _updateWfStatusBtn();
    }

    async function _saveWfConfig() {
        GEN.wfConfig.server_url = document.getElementById('genWfServerUrl').value.trim() || 'http://127.0.0.1:8188';
        GEN.wfConfig.enabled = document.getElementById('genWfEnabled').checked;
        await _saveWfConfigToServer();
        _updateWfStatusBtn();
        document.getElementById('genWfModal').style.display = 'none';
    }

    async function _saveWfConfigToServer() {
        try {
            await apiFetch('/workflow-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: GEN.wfConfig })
            });
        } catch (e) { console.warn('保存工作流配置失败:', e); }
    }

    // ============================================================
    // 生成提交
    // ============================================================
    async function generate() {
        if (GEN.isGenerating) { alert('生成中，请等待...'); return; }
        var btn = document.getElementById('genSubmitBtn');
        GEN.isGenerating = true;
        if (btn) { btn.disabled = true; btn.innerHTML = '<div class="gen-loading-spinner"></div> 提交中...'; }

        // 显示等待状态
        var area = document.getElementById('genPreviewArea');
        if (area) {
            area.innerHTML = '<div style="text-align:center;padding:40px;">' +
                '<div class="gen-loading-spinner" style="width:40px;height:40px;"></div>' +
                '<p style="margin-top:16px;color:var(--text-muted);">正在提交生成任务...</p>' +
                '<p style="font-size:12px;color:var(--text-muted);" id="genProgress">连接 ComfyUI...</p>' +
                '</div>';
        }

        try {
            var resp = await fetch(apiUrl('/generate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    params_json: GEN.currentParams,
                    aspect_ratio: GEN.aspectRatio
                })
            });

            if (!resp.ok) {
                var errData = await resp.json().catch(function () { return {}; });
                throw new Error(errData.error || 'HTTP ' + resp.status);
            }

            if (resp.headers.get('content-type') && resp.headers.get('content-type').indexOf('text/event-stream') >= 0) {
                // SSE 流式响应
                await handleSSE(resp);
            } else {
                // 普通 JSON（错误）
                var data = await resp.json();
                throw new Error(data.error || '提交失败');
            }
        } catch (e) {
            if (area) area.innerHTML = '<div class="gen-empty-state"><div class="gen-icon">❌</div><p>生成失败: ' + esc(e.message) + '</p>' +
                '<p style="font-size:11px;">请确认 ComfyUI 已启动，并点击右上角「⚙ 工作流」配置生成专用工作流</p>' +
                '<button class="gen-btn gen-btn-sm" onclick="PK_GENERATOR.viewCharacter()" style="margin-top:12px;">重新加载</button></div>';
        }

        GEN.isGenerating = false;
        if (btn) { btn.disabled = false; btn.innerHTML = '🔮 生成 (1张)'; }
    }

    async function handleSSE(resp) {
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        var area = document.getElementById('genPreviewArea');
        var progressEl = document.getElementById('genProgress');

        while (true) {
            var result = await reader.read();
            if (result.done) break;

            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留未完成的最后一行

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line.startsWith('data: ')) continue;
                var jsonStr = line.substring(6);
                try {
                    var evt = JSON.parse(jsonStr);
                    if (evt.type === 'status') {
                        var statusText = { 'generating': '正在生成...', 'queued': '排队等待 ComfyUI...', 'done': '生成完成！' };
                        if (progressEl) progressEl.textContent = statusText[evt.status] || evt.status;
                        if (evt.prompt && progressEl) {
                            progressEl.title = evt.prompt;
                        }
                        GEN.currentJobId = evt.job_id;
                    } else if (evt.type === 'done') {
                        if (progressEl) progressEl.textContent = '✅ 生成完成！刷新历史...';
                        GEN.currentJobId = null;
                        loadHistory(1);
                    } else if (evt.type === 'error') {
                        if (progressEl) progressEl.textContent = '❌ ' + evt.error;
                        GEN.currentJobId = null;
                        loadHistory(1);
                    }
                } catch (parseErr) {
                    console.warn('[GEN] SSE parse:', parseErr);
                }
            }
        }
    }

    function _previewJob(jobId) {
        var area = document.getElementById('genPreviewArea');
        if (!area) return;

        var job = null;
        for (var i = 0; i < GEN.history.length; i++) {
            if (GEN.history[i].id === jobId) { job = GEN.history[i]; break; }
        }
        if (!job) return;

        if (job.status === 'done') {
            area.innerHTML =
                '<div class="gen-result-card">' +
                '<img src="' + apiUrl('/generate/' + jobId + '/image') + '" alt="生成结果">' +
                '<div class="gen-result-info">' +
                '<div>' + esc(job.aspect_ratio || '1:1') + ' · ' + esc(job.created_at || '') + '</div>' +
                '<div class="gen-result-actions">' +
                '<button class="gen-btn gen-btn-sm" onclick="PK_GENERATOR._downloadImage(' + jobId + ')">📥 下载</button>' +
                '<button class="gen-btn gen-btn-sm gen-btn-danger" onclick="PK_GENERATOR._deleteJob(' + jobId + ')">🗑</button>' +
                '</div></div></div>' +
                '<button class="gen-btn gen-btn-sm" onclick="PK_GENERATOR.viewCharacter()" style="margin-top:8px;">← 返回画廊</button>';
        } else if (job.status === 'failed') {
            area.innerHTML =
                '<div class="gen-empty-state"><div class="gen-icon">❌</div>' +
                '<p>生成失败</p><p style="font-size:11px;">' + esc(job.error_message || '未知错误') + '</p>' +
                '<button class="gen-btn gen-btn-sm" onclick="PK_GENERATOR.viewCharacter()" style="margin-top:12px;">返回</button></div>';
        }
    }

    function _downloadImage(jobId) {
        window.open(apiUrl('/generate/' + jobId + '/image'), '_blank');
    }

    async function _deleteJob(jobId) {
        if (!confirm('确认删除此生成记录？图片也将被删除。')) return;
        try {
            await apiFetch('/history/' + jobId, { method: 'DELETE' });
            loadHistory(1);
        } catch (e) { alert('删除失败: ' + e.message); }
    }

    // ============================================================
    // PK_GENERATOR 命名空间
    // ============================================================
    window.PK_GENERATOR = {
        version: '2.0.0',
        plugin_id: 'com.promptkit.generator',

        viewCharacter: renderCharacterView,
        viewScene: function () { placeholderView('🌄', '场景生成', '基于场景描述词卡，调用 ComfyUI 生成场景背景、氛围图、光影预览。'); },
        viewStoryboard: function () { placeholderView('🎬', '分镜生成', '从分镜脚本一键生成序列帧预览，衔接 Seedance 分镜项目的工作流管线。'); },
        openConfig: function () { if (window.App && App.openComfyConfig) App.openComfyConfig(); },

        // 内部方法暴露
        _toggleGroup: _toggleGroup,
        _onParamChange: _onParamChange,
        _onSliderInput: _onSliderInput,
        _setAspectRatio: _setAspectRatio,
        _randomParams: _randomParams,
        _savePreset: _savePreset,
        _applyPreset: _applyPreset,
        _loadPresetList: _loadPresetList,
        _sourceCharList: _sourceCharList,
        _sourceWordCards: _sourceWordCards,
        _applyCharacter: _applyCharacter,
        _injectWordCards: _injectWordCards,
        _toggleSourceMenu: _toggleSourceMenu,
        _previewJob: _previewJob,
        _deleteJob: _deleteJob,
        _downloadImage: _downloadImage,
        generate: generate,
        _openWorkflowConfig: _openWorkflowConfig,
        _saveWfConfig: _saveWfConfig,
        _importWf: _importWf,
        _activateWf: _activateWf,
        _deleteWf: _deleteWf,
    };

    console.log('[PK_GENERATOR] AI 生成中心 v2.0.0 已加载 — 角色肖像生成就绪');
})();
