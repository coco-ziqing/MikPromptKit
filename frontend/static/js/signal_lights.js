// ============================================================
// v4.0.0-phase11.1: External Dependency Signal Lights
// 页面固定信号灯 — 每10s轮询 Ollama / ComfyUI 状态
// v4.2.0-phase14-hotfix: 延迟加载，等待 App 就绪
// ============================================================

(function initSignalLights() {
'use strict';

if (!window.App || !App.fetchJSON) { setTimeout(initSignalLights, 200); return; }

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
    bar.title = App._t('auto.str_85cfe79e', '外部依赖连接状态 · 点击刷新');
    bar.style.cssText = 'position:fixed;bottom:12px;right:14px;z-index:500;height:26px;display:flex;align-items:center;gap:10px;'
        + 'padding:0 10px;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,0.15);'
        + 'font-size:10px;background:var(--bg-card);border:1px solid var(--border-color);color:var(--text-muted);opacity:0.95;'
        + 'font-family:system-ui,monospace;cursor:pointer;user-select:none;';
    bar.onclick = function() { App.signalLights.refresh(true); };

    // Ollama
    bar.innerHTML += '<span id="slOllama" class="sl-item"><span class="sl-dot sl-dot-unknown"></span> Ollama <span class="sl-ms" id="slOllamaMs"></span></span>';

    // ComfyUI
    bar.innerHTML += '<span id="slComfyui" class="sl-item"><span class="sl-dot sl-dot-unknown"></span> ComfyUI <span class="sl-ms" id="slComfyuiMs"></span></span>';

    // 折叠按钮
    bar.innerHTML += '<span id="slToggle" title="折叠" style="font-size:11px;opacity:0.7;padding:0 2px;cursor:pointer;">✕</span>';

    document.body.appendChild(bar);
    this._bar = bar;
    this._bindToggle();
};

App.signalLights._bindToggle = function() {
    var bar = document.getElementById('slBar');
    var tg = document.getElementById('slToggle');
    if (!bar || !tg) return;
    tg.onclick = function(e) {
        e.stopPropagation();
        App.signalLights.toggleCollapse();
    };
};

App.signalLights.toggleCollapse = function() {
    var bar = document.getElementById('slBar');
    if (!bar) return;
    var collapsed = bar.getAttribute('data-collapsed') === '1';
    if (collapsed) {
        // 展开
        bar.setAttribute('data-collapsed', '0');
        bar.style.width = 'auto';
        bar.style.padding = '0 10px';
        var o = document.getElementById('slOllama');
        var c = document.getElementById('slComfyui');
        var t = document.getElementById('slToggle');
        if (o) o.style.display = '';
        if (c) c.style.display = '';
        if (t) t.textContent = '✕';
    } else {
        // 折叠成小圆点
        bar.setAttribute('data-collapsed', '1');
        bar.style.width = 'auto';
        bar.style.padding = '0 6px';
        var o = document.getElementById('slOllama');
        var c = document.getElementById('slComfyui');
        var t = document.getElementById('slToggle');
        if (o) { o.style.display = 'none'; }
        if (c) { c.style.display = 'none'; }
        if (t) t.textContent = '●';
    }
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
        el.title = App._t('auto.str_1c1ed981', '已禁用');
    } else if (status.ok) {
        dot.classList.add('sl-dot-on');
        msEl.textContent = (status.latency_ms || '') + 'ms';
        el.title = (status.url||'') + ' · 延迟 ' + (status.latency_ms||'?') + 'ms';
    } else {
        dot.classList.add('sl-dot-err');
        msEl.textContent = '';
        el.title = status.error || App._t('auto.str_0745fc09', '连接未完成');
    }
};

App.signalLights._updateTimer = function() {
    var el = document.getElementById('slTimer');
    if (!el) return;
    var now = new Date();
    el.textContent = now.toLocaleTimeString();
};

// ============ 兜底启动（2026-08-04 加固） ============
// 原启动链依赖 App.init() 内 try 块成功执行到末尾；若并行加载抛错
// （catch 分支只 switchView），信号灯永不出现。此处独立兜底，幂等。
function _ensureSignalLights() {
    try {
        if (window.App && App.signalLights && typeof App.signalLights.init === 'function') {
            if (!document.getElementById('slBar')) {
                App.signalLights.init();
            }
        }
    } catch(e) { /* 静默 */ }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_ensureSignalLights, 1500);
    setTimeout(_ensureSignalLights, 5000);
} else {
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(_ensureSignalLights, 1500);
        setTimeout(_ensureSignalLights, 5000);
    });
}
window.addEventListener('load', function() {
    setTimeout(_ensureSignalLights, 1200);
});

})();
