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
    if (document.getElementById('slNav')) return;

    var slot = document.getElementById('slNavSlot');
    var bar = document.createElement('span');
    bar.id = 'slNav';
    bar.className = 'sl-nav';
    bar.title = App._t('auto.str_85cfe79e', '外部依赖连接状态 · 点击刷新');
    bar.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:10px;padding:2px 7px;'
        + 'border-radius:12px;color:var(--text-muted);cursor:pointer;white-space:nowrap;user-select:none;'
        + 'transition:background 0.15s;';
    bar.onmouseenter = function() { bar.style.background = 'var(--hover-bg)'; };
    bar.onmouseleave = function() { bar.style.background = 'transparent'; };
    bar.onclick = function() { App.signalLights.refresh(true); };

    // Ollama
    bar.innerHTML += '<span id="slOllama" class="sl-item" style="display:inline-flex;align-items:center;gap:3px;"><span class="sl-dot sl-dot-unknown"></span><span class="sl-name">Ollama</span> <span class="sl-ms" id="slOllamaMs"></span></span>';

    // ComfyUI
    bar.innerHTML += '<span id="slComfyui" class="sl-item" style="display:inline-flex;align-items:center;gap:3px;"><span class="sl-dot sl-dot-unknown"></span><span class="sl-name">ComfyUI</span> <span class="sl-ms" id="slComfyuiMs"></span></span>';

    // 横向折叠按钮
    bar.innerHTML += '<span id="slToggle" title="折叠/展开" style="font-size:10px;opacity:0.65;padding:0 1px;cursor:pointer;margin-left:2px;">▾</span>';

    if (slot) {
        slot.appendChild(bar);
    } else {
        document.body.appendChild(bar);
        bar.style.cssText += 'position:fixed;bottom:12px;right:14px;z-index:500;box-shadow:0 2px 10px rgba(0,0,0,0.15);';
    }
    this._bar = bar;
    this._bindToggle();
    this._applyCollapseState();
};

App.signalLights._bindToggle = function() {
    var bar = document.getElementById('slNav');
    var tg = document.getElementById('slToggle');
    if (!bar || !tg) return;
    tg.onclick = function(e) {
        e.stopPropagation();
        App.signalLights.toggleCollapse();
    };
};

// 折叠状态：▾=展开(横向显示文字+延迟)，▸=折叠(仅两圆点)
App.signalLights._applyCollapseState = function() {
    var bar = document.getElementById('slNav');
    if (!bar) return;
    var collapsed = localStorage.getItem('pk_sl_collapsed') === '1';
    bar.setAttribute('data-collapsed', collapsed ? '1' : '0');
    var o = document.getElementById('slOllama');
    var c = document.getElementById('slComfyui');
    var t = document.getElementById('slToggle');
    if (collapsed) {
        if (o) { o.querySelector('.sl-name').style.display = 'none'; o.querySelector('.sl-ms').style.display = 'none'; }
        if (c) { c.querySelector('.sl-name').style.display = 'none'; c.querySelector('.sl-ms').style.display = 'none'; }
        if (t) t.textContent = '▸';
    } else {
        if (o) { o.querySelector('.sl-name').style.display = ''; o.querySelector('.sl-ms').style.display = ''; }
        if (c) { c.querySelector('.sl-name').style.display = ''; c.querySelector('.sl-ms').style.display = ''; }
        if (t) t.textContent = '▾';
    }
};

App.signalLights.toggleCollapse = function() {
    var bar = document.getElementById('slNav');
    if (!bar) return;
    var collapsed = bar.getAttribute('data-collapsed') === '1';
    localStorage.setItem('pk_sl_collapsed', collapsed ? '0' : '1');
    this._applyCollapseState();
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
            if (!document.getElementById('slNav') && !document.getElementById('slBar')) {
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
