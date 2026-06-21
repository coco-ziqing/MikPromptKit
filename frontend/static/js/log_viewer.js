// ============================================================
// v4.3.0-phase16: Runtime Log Viewer — 实时日志监测面板
// SSE 实时流 + 级别筛选 + 关键词搜索 + 前端错误自动上报
// ============================================================
(function initLogViewer(){
'use strict';
try { if (!App || !App.fetchJSON) { setTimeout(initLogViewer, 200); return; } } catch(e) { setTimeout(initLogViewer, 200); return; }

App.logs = {
    _panel: null,
    _list: null,
    _status: null,
    _es: null,
    _filter: { level: '', search: '' },
    _maxLines: 300,
    _lines: [],
    _connected: false,

    // ===== 打开面板 =====
    open: function() {
        var panel = document.getElementById('modalLogViewer');
        if (!panel) { App.showToast('日志面板未加载', 'error'); return; }
        panel.style.display = 'flex';
        this._panel = panel;
        this._list = document.getElementById('logList');
        this._status = document.getElementById('logStatus');
        if (!this._connected) this._connect();
        this._renderToolbar();
    },

    // ===== 关闭 =====
    close: function() {
        var panel = document.getElementById('modalLogViewer');
        if (panel) panel.style.display = 'none';
    },

    // ===== SSE 连接 =====
    _connect: function() {
        var self = this;
        if (self._es) { self._es.close(); }
        self._es = new EventSource('/api/logs/stream');
        self._es.onopen = function() {
            self._connected = true;
            if (self._status) self._status.innerHTML = '<span style="color:#10b981;">● 实时监控中</span>';
        };
        self._es.onmessage = function(e) {
            try {
                var entry = JSON.parse(e.data);
                self._push(entry);
            } catch(err) {}
        };
        self._es.onerror = function() {
            self._connected = false;
            if (self._status) self._status.innerHTML = '<span style="color:#ef4444;">● 连接断开 (5s后重连)</span>';
            setTimeout(function() { self._connect(); }, 5000);
        };
    },

    // ===== 推送日志 =====
    _push: function(entry) {
        if (this._list) {
            var match = this._matchFilter(entry);
            var div = document.createElement('div');
            div.className = 'log-line log-' + entry.level;
            div.style.cssText = 'padding:2px 8px;font-size:11px;font-family:Consolas,monospace;border-bottom:1px solid rgba(255,255,255,0.05);' +
                (match ? '' : 'display:none;');
            var icon = {debug:'·',info:'✓',warn:'⚠',error:'✗',fatal:'☠'}[entry.level] || '·';
            var color = {debug:'#94a3b8',info:'#e2e8f0',warn:'#fbbf24',error:'#ef4444',fatal:'#ef4444'}[entry.level] || '#e2e8f0';
            div.innerHTML = '<span style="color:#64748b;margin-right:6px;">' + (entry.created_at || '') + '</span>' +
                '<span style="color:' + color + ';font-weight:600;margin-right:6px;">' + icon + '</span>' +
                '<span style="color:#94a3b8;margin-right:6px;">[' + (entry.source || '') + ']</span>' +
                '<span style="color:' + color + ';">' + (entry.message || '').replace(/</g,'&lt;') + '</span>';
            if (entry.detail) {
                div.title = entry.detail + (entry.stack ? '\n\n' + entry.stack : '');
            }
            div.setAttribute('data-level', entry.level);
            div.setAttribute('data-source', entry.source || '');
            div.setAttribute('data-text', (entry.message || '').toLowerCase());
            this._list.appendChild(div);
            this._lines.push(div);
            // 限行
            while (this._lines.length > this._maxLines) {
                var old = this._lines.shift();
                if (old && old.parentNode) old.parentNode.removeChild(old);
            }
            // 自动滚动
            this._list.scrollTop = this._list.scrollHeight;
        }
    },

    // ===== 过滤匹配 =====
    _matchFilter: function(entry) {
        var f = this._filter;
        if (f.level && entry.level !== f.level) return false;
        if (f.search) {
            var txt = (entry.message + ' ' + (entry.source || '') + ' ' + (entry.detail || '')).toLowerCase();
            if (txt.indexOf(f.search.toLowerCase()) === -1) return false;
        }
        return true;
    },

    // ===== 渲染过滤工具栏 =====
    _renderToolbar: function() {
        var bar = document.getElementById('logToolbar');
        if (!bar) return;
        var self = this;
        bar.innerHTML = '' +
            '<select id="logFilterLevel" onchange="App.logs._applyFilter()" style="font-size:11px;padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-main);">' +
                '<option value="">全部级别</option>' +
                '<option value="debug">DEBUG</option>' +
                '<option value="info">INFO</option>' +
                '<option value="warn">WARN</option>' +
                '<option value="error">ERROR</option>' +
                '<option value="fatal">FATAL</option>' +
            '</select>' +
            '<input type="text" id="logFilterSearch" placeholder="搜索..." oninput="App.logs._applyFilter()" style="font-size:11px;padding:2px 8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-main);width:120px;">' +
            '<button onclick="App.logs.clear()" style="font-size:10px;padding:2px 8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-muted);cursor:pointer;">清空面板</button>' +
            '<button onclick="App.logs._loadHistory()" style="font-size:10px;padding:2px 8px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-muted);cursor:pointer;">加载历史</button>' +
            '<span id="logStats" style="font-size:10px;color:var(--text-muted);margin-left:auto;"></span>';
    },

    // ===== 应用过滤 =====
    _applyFilter: function() {
        var levelEl = document.getElementById('logFilterLevel');
        var searchEl = document.getElementById('logFilterSearch');
        this._filter.level = levelEl ? levelEl.value : '';
        this._filter.search = searchEl ? searchEl.value.trim() : '';
        for (var i = 0; i < this._lines.length; i++) {
            var div = this._lines[i];
            var entry = { level: div.getAttribute('data-level') };
            div.style.display = this._matchFilter(entry) ? '' : 'none';
        }
    },

    // ===== 清空面板 =====
    clear: function() {
        if (this._list) this._list.innerHTML = '';
        this._lines = [];
    },

    // ===== 加载历史 =====
    _loadHistory: async function() {
        try {
            var d = await App.fetchJSON('/api/logs/query?limit=200');
            if (!d || !d.items) return;
            if (this._list) this._list.innerHTML = '';
            this._lines = [];
            // 倒序插入
            for (var i = d.items.length - 1; i >= 0; i--) {
                this._push(d.items[i]);
            }
            // 更新统计
            var statsEl = document.getElementById('logStats');
            if (statsEl) {
                var s = await App.fetchJSON('/api/logs/stats');
                if (s && s.stats) {
                    var parts = [];
                    for (var k in s.stats) parts.push(k + ':' + s.stats[k]);
                    statsEl.textContent = '📊 ' + parts.join(' | ');
                }
            }
        } catch(e) {}
    }
};

// ===== 全局 JS 错误捕获 → 上报后端 =====
window.addEventListener('error', function(e) {
    var msg = e.message || 'Unknown runtime error';
    if (msg.indexOf('Script error') === 0) return; // 跨域忽略
    try {
        fetch('/api/logs/report', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                message: msg,
                source: 'frontend',
                stack: (e.error && e.error.stack) || '',
                url: e.filename || location.href,
                line: e.lineno || 0,
                col: e.colno || 0
            })
        }).catch(function(){});
    } catch(ignore) {}
});

// Promise rejection
window.addEventListener('unhandledrejection', function(e) {
    var msg = (e.reason && e.reason.message) || String(e.reason);
    try {
        fetch('/api/logs/report', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                message: 'Unhandled Rejection: ' + msg,
                source: 'frontend',
                stack: (e.reason && e.reason.stack) || '',
                url: location.href
            })
        }).catch(function(){});
    } catch(ignore) {}
    e.preventDefault();
});

console.log('[Log Viewer v16] ready — SSE实时日志 + 前端错误上报已激活');
})();
