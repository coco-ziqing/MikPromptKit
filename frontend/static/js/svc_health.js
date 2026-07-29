// ============================================================
// v5.24.1: 服务健康自检 — 前端轮询 /api/ping 检测本地后端存活
// 
// 方案 C：浏览器侧 fetch 同源端点，完全不依赖 Agent 的 shell/web_fetch
// Agent 零参与 — 页面自己检测，自己展示。
// ============================================================

(function initServiceHealth() {
'use strict';

// 等待 App 就绪（如果 App 还没初始化，延迟重试）
if (!window.App || !App.fetchJSON) { setTimeout(initServiceHealth, 300); return; }

App.serviceHealth = {
    _dot: null,
    _timer: null,
    _intervalMs: 15000,   // 15s 轮询
    _retryMs: 5000,        // 故障后快速重试间隔
    _consecutiveFails: 0,
    _maxFailsBeforeOff: 2, // 连续失败 N 次后显示红色
};

App.serviceHealth.init = function() {
    var dot = document.getElementById('svcIndicator');
    if (!dot) { setTimeout(this.init.bind(this), 500); return; }
    this._dot = dot;

    // 首次检测
    this._check(true);

    var self = this;
    this._timer = setInterval(function() { self._check(false); }, this._intervalMs);
};

// 自动启动
App.serviceHealth.init();

App.serviceHealth._check = async function(isInitial) {
    var self = this;
    try {
        var resp = await fetch('/api/ping', {
            method: 'GET',
            cache: 'no-store',
            signal: AbortSignal.timeout(3000)
        });
        if (resp.ok) {
            var data = await resp.json();
            if (data && data.ok) {
                self._setState('on', data.version || '', data.ts || '');
                self._consecutiveFails = 0;
                return;
            }
        }
        // HTTP 200 但 data.ok !== true（不应该发生）
        self._handleFail(isInitial);
    } catch(e) {
        self._handleFail(isInitial);
    }
};

App.serviceHealth._handleFail = function(isInitial) {
    this._consecutiveFails++;
    if (this._consecutiveFails >= this._maxFailsBeforeOff) {
        this._setState('off', '', '服务无响应');
    }
};

App.serviceHealth._setState = function(state, version, detail) {
    var dot = this._dot;
    if (!dot) return;

    // 移除所有状态 class
    dot.classList.remove('svc-on', 'svc-off', 'svc-unknown');

    if (state === 'on') {
        dot.classList.add('svc-on');
        dot.title = '服务正常 · ' + version + (detail ? ' · ' + detail : '');
    } else if (state === 'off') {
        dot.classList.add('svc-off');
        dot.title = '⚠️ 服务离线 · ' + (detail || '后端无响应');
    } else {
        dot.classList.add('svc-unknown');
        dot.title = '检测中…';
    }
};

App.serviceHealth.forceRefresh = function() {
    this._setState('unknown', '', '手动刷新中…');
    this._consecutiveFails = 0;
    this._check(true);
};

})();
