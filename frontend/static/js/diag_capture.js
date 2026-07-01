/**
 * Phase17: Global Error Capture + User Action Tracker
 * 前端全局错误捕获 + 用户行为埋点 + 操作控制台
 * 注入到 app_core.js 初始化流程中
 */

// ============ 1. 全局 JS 错误捕获 ============
(function() {
    'use strict';
    var _origOnError = window.onerror;

    window.onerror = function(message, source, lineno, colno, error) {
        // 收集调用栈
        var stack = '';
        if (error && error.stack) {
            stack = error.stack;
        } else {
            try { throw new Error(); } catch(e) { stack = e.stack || ''; }
        }

        // 上报到后端
        var payload = {
            message: String(message).substring(0, 500),
            source: 'frontend',
            stack: stack.substring(0, 3000),
            url: (source || location.href).substring(0, 500),
            line: lineno || 0,
            col: colno || 0
        };

        try {
            fetch('/api/logs/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(function(){});
        } catch(e) {}

        console.error('[Phase17] Unhandled Error:', payload);

        // 调用原有处理器
        if (_origOnError) {
            return _origOnError.apply(this, arguments);
        }
        return false;
    };

    // 捕获未处理的 Promise rejection
    window.addEventListener('unhandledrejection', function(event) {
        var message = 'Unhandled Rejection: ' + String(event.reason || 'unknown');
        var stack = '';
        if (event.reason && event.reason.stack) {
            stack = event.reason.stack;
        }
        try {
            fetch('/api/logs/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message.substring(0, 500),
                    source: 'frontend',
                    stack: stack.substring(0, 3000),
                    url: location.href.substring(0, 500),
                    line: 0,
                    col: 0
                })
            }).catch(function(){});
        } catch(e) {}
        console.error('[Phase17]', message);
    });

    console.log('[Phase17] Global error capture active');
})();


// ============ 2. 用户行为埋点引擎 ============
(function() {
    'use strict';
    window._ActionTracker = {
        _queue: [],
        _flushTimer: null,
        _maxBatch: 20,
        _flushMs: 3000,

        /**
         * 记录用户操作
         * @param {string} action - 操作名 (如 'click_collect_btn', 'save_word_card')
         * @param {string} category - 分类 (click/nav/edit/upload/delete/search/modal)
         * @param {string} target - 目标对象描述
         * @param {string} detail - 补充信息
         */
        track: function(action, category, target, detail) {
            this._queue.push({
                action: action || 'unknown',
                category: category || 'click',
                target: target || '',
                detail: detail || '',
                url: location.href,
                user_agent: navigator.userAgent || '',
                _time: Date.now()
            });

            // 立即上报 error 级别
            if (category === 'error') {
                this._flush();
                return;
            }

            // 达到批次阈值或启动定时器
            if (this._queue.length >= this._maxBatch) {
                this._flush();
            } else if (!this._flushTimer) {
                var self = this;
                this._flushTimer = setTimeout(function() {
                    self._flush();
                }, this._flushMs);
            }
        },

        _flush: function() {
            var self = this;
            if (this._flushTimer) {
                clearTimeout(this._flushTimer);
                this._flushTimer = null;
            }
            var batch = this._queue.splice(0, this._maxBatch);
            if (batch.length === 0) return;

            // 发送批量
            fetch('/api/logs/actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actions: batch })
            }).catch(function() {});

            // 继续处理剩余
            if (this._queue.length > 0) {
                this._flushTimer = setTimeout(function() {
                    self._flush();
                }, 500);
            }
        }
    };

    // 页面卸载时刷盘
    window.addEventListener('beforeunload', function() {
        _ActionTracker._flush();
    });
    window.addEventListener('pagehide', function() {
        _ActionTracker._flush();
    });

    console.log('[Phase17] Action tracker active');
})();


// ============ 3. 导航栏快捷入口：🩺 诊断控制台 ============
(function() {
    'use strict';
    // 等 App 就绪后注入按钮
    function injectDiagBtn() {
        try { if (!App || !App.fetchJSON) { setTimeout(injectDiagBtn, 300); return; } } catch(e) { setTimeout(injectDiagBtn, 300); return; }

        var actions = document.querySelector('.header-actions');
        if (!actions || document.getElementById('btnDiagConsole')) return;

        var btn = document.createElement('button');
        btn.id = 'btnDiagConsole';
        btn.className = 'header-btn';
        btn.title = '诊断控制台';
        btn.innerHTML = '🩺';
        btn.onclick = function() {
            App.logs.open();
        };
        // 插入到操作区开头
        var firstChild = actions.firstChild;
        if (firstChild) {
            actions.insertBefore(btn, firstChild);
        } else {
            actions.appendChild(btn);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(injectDiagBtn, 500); });
    } else {
        injectDiagBtn();
    }
})();
