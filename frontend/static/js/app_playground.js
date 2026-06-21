// ============================================================
// Phase15: Playground 深度升级 — 模型预设 × 优化方向
// 目标模型选择 + 优化方向面板 + 一键保存到词卡库
// ============================================================
(function initPlayground(){
'use strict';
try { if (!App || !App.fetchJSON) { setTimeout(initPlayground, 200); return; } } catch(e) { setTimeout(initPlayground, 200); return; }

// 状态
App._pgState = {
    presets: [],
    directions: [],
    selectedModel: 'flux',
    selectedDirection: 'convert',
    lastResult: ''
};

// ===== 打开 =====
var _origOpenPG = App.openPlayground;
App.openPlayground = function() {
    var modal = document.getElementById('modalPlayground');
    if (!modal) { this.showToast('Playground 未加载', 'error'); return; }
    modal.style.display = 'flex';
    this._pgLoadPresets();  // 加载预设（首次打开时）
    this._pgLoadConfig();
};

// ===== 关闭 =====
App._pgClose = function() {
    var m = document.getElementById('modalPlayground');
    if (m) m.style.display = 'none';
};

// ===== 加载预设 =====
App._pgLoadPresets = async function() {
    if (this._pgState.presets.length > 0) return;  // 已加载
    try {
        var d = await this.fetchJSON('/api/playground/presets');
        if (d && d.models) this._pgState.presets = d.models;
        if (d && d.directions) this._pgState.directions = d.directions;
    } catch(e) {
        console.warn('[PG] 预设加载失败:', e.message);
        this._pgState.presets = []; this._pgState.directions = [];
    }
    this._pgRenderPresets();
    this._pgRenderDirections();
};

// ===== 渲染目标模型预设 =====
App._pgRenderPresets = function() {
    var el = document.getElementById('pgModelPresets');
    if (!el) return;
    var presets = this._pgState.presets;
    if (!presets.length) { el.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">无可用预设</span>'; return; }
    var sel = this._pgState.selectedModel;
    var html = '';
    for (var i = 0; i < presets.length; i++) {
        var p = presets[i];
        var active = p.key === sel;
        html += '<button onclick="App._pgSelectModel(\'' + p.key + '\')" ' +
            'title="' + this._escape(p.name) + ': ' + this._escape(p.format) + '" ' +
            'style="font-size:11px;padding:5px 10px;border-radius:6px;cursor:pointer;border:1px solid ' + (active ? 'var(--primary)' : 'var(--border-color)') + ';' +
            'background:' + (active ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)') + ';' +
            'color:' + (active ? 'var(--primary)' : 'var(--text-muted)') + ';' +
            'white-space:nowrap;transition:all 0.15s;">' +
            p.icon + ' ' + this._escape(p.name) + '</button>';
    }
    el.innerHTML = html;
};

// ===== 选择目标模型 =====
App._pgSelectModel = function(key) {
    this._pgState.selectedModel = key;
    this._pgRenderPresets();
};

// ===== 渲染优化方向 =====
App._pgRenderDirections = function() {
    var el = document.getElementById('pgDirections');
    if (!el) return;
    var dirs = this._pgState.directions;
    if (!dirs.length) { el.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">无可用方向</span>'; return; }
    var sel = this._pgState.selectedDirection;
    var html = '';
    for (var i = 0; i < dirs.length; i++) {
        var d = dirs[i];
        var active = d.key === sel;
        html += '<button onclick="App._pgSelectDirection(\'' + d.key + '\')" ' +
            'title="' + this._escape(d.desc) + '" ' +
            'style="font-size:11px;padding:5px 10px;border-radius:6px;cursor:pointer;border:1px solid ' + (active ? 'var(--primary)' : 'var(--border-color)') + ';' +
            'background:' + (active ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)') + ';' +
            'color:' + (active ? 'var(--primary)' : 'var(--text-muted)') + ';' +
            'white-space:nowrap;transition:all 0.15s;">' +
            d.icon + ' ' + this._escape(d.name) + '</button>';
    }
    el.innerHTML = html;
};

// ===== 选择优化方向 =====
App._pgSelectDirection = function(key) {
    this._pgState.selectedDirection = key;
    this._pgRenderDirections();
};

// ===== 加载配置 =====
App._pgLoadConfig = async function() {
    try {
        var d = await this.fetchJSON('/api/playground/config');
        if (!d || !d.config) return;
        var c = d.config;
        var providerEl = document.getElementById('pgProvider');
        var modelEl = document.getElementById('pgModel');
        var tempEl = document.getElementById('pgTemp');
        if (providerEl) providerEl.value = c.provider || 'ollama';
        if (modelEl) modelEl.value = c.ollama_model || 'qwen3.5:9b';
        if (tempEl) tempEl.value = c.temperature || 0.7;
    } catch(e) {}
};

// ===== Provider 切换 =====
App._pgToggleProvider = function() {
    // OpenAI 模式下可扩展
};

// ===== 核心: 优化提示词 =====
App._pgOptimize = async function() {
    var promptEl = document.getElementById('pgPrompt');
    var prompt = (promptEl ? promptEl.value.trim() : '');
    if (!prompt) { this.showToast('请先输入提示词', 'warning'); return; }

    var resultEl = document.getElementById('pgResult');
    var statusEl = document.getElementById('pgStatus');
    var btn = document.getElementById('btnPgRun');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:12px;height:12px;"></span> 优化中...'; }
    if (resultEl) { resultEl.style.display = 'block'; resultEl.textContent = '⏳ 正在调用 LLM 优化...'; }
    if (statusEl) statusEl.textContent = '';

    var providerEl = document.getElementById('pgProvider');
    var modelEl = document.getElementById('pgModel');
    var tempEl = document.getElementById('pgTemp');
    var customEl = document.getElementById('pgCustom');

    var body = {
        prompt: prompt,
        target_model: this._pgState.selectedModel,
        direction: this._pgState.selectedDirection,
        custom_instruction: customEl ? customEl.value.trim() : '',
        provider: providerEl ? providerEl.value : 'ollama',
        model: modelEl ? modelEl.value.trim() : '',
        temperature: tempEl ? parseFloat(tempEl.value) : 0.7
    };

    try {
        var d = await this.fetchJSON('/api/playground/optimize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (d && d.ok) {
            this._pgState.lastResult = d.optimized;
            if (resultEl) resultEl.textContent = d.optimized;
            if (statusEl) statusEl.innerHTML = '<span style="color:#10b981;">✅ 优化完成 — ' + d.target_model + ' × ' + d.direction + ' (' + d.llm_model + ')</span>';
            if (d.saved_card && d.saved_card.id) {
                if (statusEl) statusEl.innerHTML += ' | <span style="color:#8b5cf6;">📦 #' + d.saved_card.id + ' 已保存</span>';
            }
        } else {
            if (resultEl) resultEl.textContent = '❌ 优化失败: ' + (d ? d.error : '未知错误');
            if (statusEl) statusEl.textContent = '请检查 LLM 模型是否可用';
        }
    } catch(e) {
        if (resultEl) resultEl.textContent = '❌ 请求异常: ' + e.message;
        if (statusEl) statusEl.textContent = '网络错误或服务未启动';
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-magic"></i> 优化提示词'; }
};

// ===== 复制结果 =====
App._pgCopyResult = function() {
    var r = this._pgState.lastResult;
    if (!r) { this.showToast('请先运行优化', 'warning'); return; }
    this.copyText(r);
    this.showToast('已复制优化结果', 'success');
};

// ===== 保存到词卡库 =====
App._pgSave = async function() {
    var promptEl = document.getElementById('pgPrompt');
    var prompt = (promptEl ? promptEl.value.trim() : '');
    if (!prompt) { this.showToast('请先输入提示词', 'warning'); return; }

    var body = {
        prompt: prompt,
        target_model: this._pgState.selectedModel,
        direction: this._pgState.selectedDirection,
        save_to_library: true,
        custom_instruction: (document.getElementById('pgCustom') ? document.getElementById('pgCustom').value.trim() : '')
    };
    var providerEl = document.getElementById('pgProvider');
    var modelEl = document.getElementById('pgModel');
    var tempEl = document.getElementById('pgTemp');
    if (providerEl) body.provider = providerEl.value;
    if (modelEl) body.model = modelEl.value.trim();
    if (tempEl) body.temperature = parseFloat(tempEl.value);

    var statusEl = document.getElementById('pgStatus');
    if (statusEl) statusEl.textContent = '⏳ 优化并保存中...';

    try {
        var d = await this.fetchJSON('/api/playground/optimize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (d && d.ok) {
            this._pgState.lastResult = d.optimized;
            var resultEl = document.getElementById('pgResult');
            if (resultEl) { resultEl.style.display = 'block'; resultEl.textContent = d.optimized; }
            if (statusEl) statusEl.innerHTML = '<span style="color:#10b981;">✅ 已优化并保存到词卡库</span>';
            if (d.saved_card && d.saved_card.id) {
                if (statusEl) statusEl.innerHTML += ' <span style="color:#8b5cf6;">(#' + d.saved_card.id + ')</span>';
                // 刷新侧边栏
                this.loadGroupTree().catch(function(){});
            }
        } else {
            if (statusEl) statusEl.textContent = '❌ ' + (d && d.error ? d.error : '保存失败');
        }
    } catch(e) {
        if (statusEl) statusEl.textContent = '❌ ' + e.message;
    }
};

// ===== 清空 =====
App._pgClear = function() {
    var promptEl = document.getElementById('pgPrompt');
    var resultEl = document.getElementById('pgResult');
    var statusEl = document.getElementById('pgStatus');
    var customEl = document.getElementById('pgCustom');
    if (promptEl) promptEl.value = '';
    if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }
    if (statusEl) statusEl.textContent = '';
    if (customEl) customEl.value = '';
    this._pgState.lastResult = '';
};

// ===== 设置（打开配置页） =====
App._pgSettings = function() {
    App.showToast('配置已集成到弹窗面板中', 'info');
};

console.log('[Playground v15] ready — ' +
    (App._pgState.presets.length || 'pending') + ' presets, ' +
    (App._pgState.directions.length || 'pending') + ' directions');

})();
