// ============================================================
// v4.0.0-phase11.1: External Dependency Signal Lights
// 页面固定信号灯 — 每10s轮询 Ollama / ComfyUI 状态
// ============================================================

(function() {
'use strict';

App.signalLights = {
    _bar: null,
    _timer: null,
    _intervalMs: 10000,
    _data: { ollama: {}, comfyui: {} },
};

App.signalLights.init = function() {
    this._buildBar();
    this.refresh();
    var self = this;
    this._timer = setInterval(function() { self.refresh(); }, this._intervalMs);
};

App.signalLights._buildBar = function() {
    if (document.getElementById('slBar')) return;

    var bar = document.createElement('div');
    bar.id = 'slBar';
    bar.className = 'sl-bar';
    bar.title = '外部依赖连接状态 · 点击刷新';
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:500;height:22px;display:flex;align-items:center;justify-content:center;gap:16px;'
        + 'font-size:10px;background:var(--bg-card);border-top:1px solid var(--border-color);color:var(--text-muted);opacity:0.92;'
        + 'font-family:system-ui,monospace;cursor:pointer;';
    bar.onclick = function() { App.signalLights.refresh(true); };

    // Ollama
    bar.innerHTML += '<span id="slOllama" class="sl-item"><span class="sl-dot sl-dot-unknown"></span> Ollama <span class="sl-ms" id="slOllamaMs"></span></span>';

    // separator
    bar.innerHTML += '<span style="color:var(--border-color);">|</span>';

    // ComfyUI
    bar.innerHTML += '<span id="slComfyui" class="sl-item"><span class="sl-dot sl-dot-unknown"></span> ComfyUI <span class="sl-ms" id="slComfyuiMs"></span></span>';

    // separator
    bar.innerHTML += '<span style="color:var(--border-color);">|</span>';

    // Auto-refresh indicator
    bar.innerHTML += '<span id="slTimer" style="font-size:9px;opacity:0.5;"></span>';

    document.body.appendChild(bar);
    this._bar = bar;
};

App.signalLights.refresh = async function(force) {
    var self = this;
    try {
        var url = '/api/health/status';
        if (force) url += '?force=1';
        var d = await App.fetchJSON(url);
        if (d) this._updateUI(d);
    } catch(e) {
        // silently ignore network errors during refresh
    }
    this._updateTimer();
};

App.signalLights._updateUI = function(data) {
    this._data = data;
    this._setLight('slOllama', 'slOllamaMs', data.ollama);
    this._setLight('slComfyui', 'slComfyuiMs', data.comfyui);
};

App.signalLights._setLight = function(id, msId, status) {
    var el = document.getElementById(id);
    var msEl = document.getElementById(msId);
    if (!el || !msEl) return;

    var dot = el.querySelector('.sl-dot');
    if (!dot) return;

    // Remove all dot states
    dot.className = 'sl-dot';

    if (status.ok === null || status.ok === undefined) {
        dot.classList.add('sl-dot-unknown');
        msEl.textContent = '';
        el.title = '未检测';
    } else if (status.skipped) {
        dot.classList.add('sl-dot-off');
        msEl.textContent = '';
        el.title = '已禁用';
    } else if (status.ok) {
        dot.classList.add('sl-dot-on');
        msEl.textContent = (status.latency_ms || '') + 'ms';
        el.title = (status.url||'') + ' · 延迟 ' + (status.latency_ms||'?') + 'ms';
    } else {
        dot.classList.add('sl-dot-err');
        msEl.textContent = '';
        el.title = status.error || '连接失败';
    }
};

App.signalLights._updateTimer = function() {
    var el = document.getElementById('slTimer');
    if (!el) return;
    var now = new Date();
    el.textContent = now.toLocaleTimeString();
};

})();
