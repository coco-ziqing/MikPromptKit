// ============================================================
// v4.3.0-phase17: Runtime Log Viewer — 右侧面板 + 全屏弹窗 双模式
// SSE 实时流 + 级别筛选 + 关键词搜索 + 一键复制错误
// ============================================================
(function initLogViewer(){
'use strict';
try { if (!App || !App.fetchJSON) { setTimeout(initLogViewer, 200); return; } } catch(e) { setTimeout(initLogViewer, 200); return; }

App.logs = {
    _panel: null,
    _list: null,
    _status: null,
    _toolbar: null,
    _es: null,
    _filter: { level: '', search: '' },
    _maxLines: 300,
    _lines: [],
    _connected: false,
    _mode: 'panel', // 'panel' | 'modal'

    // ===== 打开右侧面板（默认） =====
    open: function() {
        // 优先打开右侧面板
        var panel = document.getElementById('diagPanel');
        if (panel) {
            panel.style.display = 'flex';
            this._panel = panel;
            this._list = document.getElementById('diagList');
            this._status = document.getElementById('diagStatus');
            this._toolbar = document.getElementById('diagToolbar');
            this._mode = 'panel';
            if (!this._connected) this._connect();
            this._renderToolbar();
            // ESC 关闭
            this._escHandler = function(e) { if (e.key === 'Escape') { App.logs.closeAny(); } };
            document.addEventListener('keydown', this._escHandler);
            var self = this;
            App.fetchJSON('/api/logs/stats').then(function(s) {
                if (s && s.stats) self._updateStats(s.stats);
            });
        }
    },

    // ===== 打开全屏弹窗 =====
    openModal: function() {
        var panel = document.getElementById('modalLogViewer');
        if (!panel) { App.showToast('日志面板未加载', 'error'); return; }
        // 关闭右侧面板
        var diag = document.getElementById('diagPanel');
        if (diag) diag.style.display = 'none';
        panel.style.display = 'flex';
        this._panel = panel;
        this._list = document.getElementById('logList');
        this._status = document.getElementById('logStatus');
        this._toolbar = document.getElementById('logToolbar');
        this._mode = 'modal';
        if (!this._connected) this._connect();
        this._renderToolbar();
        // ESC 关闭
        this._escHandler = function(e) { if (e.key === 'Escape') { App.logs.closeAny(); } };
        document.addEventListener('keydown', this._escHandler);
        var self = this;
        App.fetchJSON('/api/logs/stats').then(function(s) {
            if (s && s.stats) self._updateStats(s.stats);
        });
    },

    // ===== 关闭右侧面板 =====
    closeDiag: function() {
        var panel = document.getElementById('diagPanel');
        if (panel) panel.style.display = 'none';
        if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
    },

    // ===== 关闭全屏弹窗 =====
    close: function() {
        var panel = document.getElementById('modalLogViewer');
        if (panel) panel.style.display = 'none';
        if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
    },

    // ===== 关闭当前打开的面板（面板或弹窗）—— 只关最顶层 =====
    closeAny: function() {
        // Phase17: 按 z-index 优先级 — 先关最高层的弹窗
        var modalImage = document.getElementById('modalImageViewer');
        if (modalImage && modalImage.style.display === 'flex') { modalImage.style.display = 'none'; return; }
        var modalVideo = document.getElementById('modalVideoViewer');
        if (modalVideo && modalVideo.style.display === 'flex') { modalVideo.style.display = 'none'; return; }
        var modalEdit = document.getElementById('modalEditPrompt');
        if (modalEdit && modalEdit.style.display === 'flex') { modalEdit.style.display = 'none'; return; }
        var modalWord = document.getElementById('modalWordEdit');
        if (modalWord && modalWord.style.display === 'flex') { App.wordEditor.close(); return; }
        var modalThumb = document.getElementById('modalThumbnail');
        if (modalThumb && modalThumb.style.display === 'flex') { modalThumb.style.display = 'none'; return; }
        var modalGroup = document.getElementById('modalGroupManager');
        if (modalGroup && modalGroup.style.display === 'flex') { modalGroup.style.display = 'none'; return; }
        var modalCreate = document.getElementById('modalCreateCollection');
        if (modalCreate && modalCreate.style.display === 'flex') { modalCreate.style.display = 'none'; return; }
        var modalLog = document.getElementById('modalLogViewer');
        if (modalLog && modalLog.style.display === 'flex') { this.close(); return; }
        var diag = document.getElementById('diagPanel');
        if (diag && diag.style.display === 'flex') { this.closeDiag(); return; }
    },

    // ===== 切换模式 =====
    toggleMode: function() {
        if (this._mode === 'panel') {
            this.closeDiag();
            this.openModal();
        } else {
            this.close();
            this.open();
        }
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
            while (this._lines.length > this._maxLines) {
                var old = this._lines.shift();
                if (old && old.parentNode) old.parentNode.removeChild(old);
            }
            this._list.scrollTop = this._list.scrollHeight;
        }
    },

    _matchFilter: function(entry) {
        var f = this._filter;
        if (f.level && entry.level !== f.level) return false;
        if (f.search) {
            var txt = (entry.message + ' ' + (entry.source || '') + ' ' + (entry.detail || '')).toLowerCase();
            if (txt.indexOf(f.search.toLowerCase()) === -1) return false;
        }
        return true;
    },

    _renderToolbar: function() {
        var bar = this._toolbar;
        if (!bar) return;
        var self = this;
        bar.innerHTML = '' +
            '<select onchange="App.logs._applyFilter()" style="font-size:10px;padding:2px 4px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-main);">' +
                '<option value="">全部</option>' +
                '<option value="debug">DEBUG</option>' +
                '<option value="info">INFO</option>' +
                '<option value="warn">WARN</option>' +
                '<option value="error">ERROR</option>' +
                '<option value="fatal">FATAL</option>' +
            '</select>' +
            '<input type="text" placeholder="搜索..." oninput="App.logs._applyFilter()" style="font-size:10px;padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-main);width:80px;">' +
            '<button onclick="App.logs._loadHistory()" style="font-size:10px;padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-muted);cursor:pointer;">历史</button>' +
            '<button onclick="App.logs._copyErrors()" style="font-size:10px;padding:2px 6px;border:1px solid #ef4444;border-radius:4px;background:rgba(239,68,68,0.1);color:#ef4444;cursor:pointer;" title="复制所有错误">📋</button>' +
            '<button onclick="App.logs.toggleMode()" style="font-size:10px;padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-muted);cursor:pointer;" title="切换全屏/侧边">🔲</button>' +
            '<button onclick="App.logs.clear()" style="font-size:10px;padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-muted);cursor:pointer;">✕</button>';
    },

    _applyFilter: function() {
        var bar = this._toolbar;
        if (!bar) return;
        var sel = bar.querySelector('select');
        var inp = bar.querySelector('input');
        this._filter.level = sel ? sel.value : '';
        this._filter.search = inp ? inp.value.trim() : '';
        for (var i = 0; i < this._lines.length; i++) {
            var div = this._lines[i];
            var entry = { level: div.getAttribute('data-level') };
            div.style.display = this._matchFilter(entry) ? '' : 'none';
        }
    },

    clear: function() {
        if (this._list) this._list.innerHTML = '';
        this._lines = [];
    },

    _updateStats: function(stats) {
        var toolbar = this._toolbar;
        if (!toolbar) return;
        var existing = toolbar.querySelector('.log-stats');
        if (existing) existing.remove();
        var span = document.createElement('span');
        span.className = 'log-stats';
        span.style.cssText = 'font-size:9px;color:#94a3b8;margin-left:auto;white-space:nowrap;';
        span.textContent = 'E' + (stats.error || 0) + '/W' + (stats.warn || 0) + '/I' + (stats.info || 0);
        toolbar.appendChild(span);
    },

    _copyErrors: async function() {
        try {
            App.showToast('正在获取错误日志...', 'info');
            var d = await App.fetchJSON('/api/logs/query?level=error&limit=50');
            if (!d || !d.items || d.items.length === 0) {
                App.showToast('暂无错误日志', 'info'); return;
            }
            var lines = ['=== PromptKit Error Report ===', 'Time: ' + new Date().toISOString(), 'Total errors: ' + d.total, ''];
            for (var i = 0; i < d.items.length; i++) {
                var e = d.items[i];
                lines.push('--- #' + (i+1) + ' [' + (e.source || '?') + '] ' + (e.level || 'ERROR') + ' ---');
                lines.push('ID: ' + (e.request_id || e.seq || '?'));
                lines.push('Time: ' + (e.created_at || '?'));
                lines.push('Path: ' + (e.path || '?'));
                lines.push('Message: ' + (e.message || '?'));
                if (e.detail) lines.push('Detail: ' + e.detail);
                if (e.stack) lines.push('Stack: ' + e.stack.substring(0, 3000));
                lines.push('');
            }
            App.copyText(lines.join('\n'), '已复制 ' + d.items.length + ' 条错误');
        } catch(e) {
            App.showToast('复制失败: ' + e.message, 'error');
        }
    },

    _loadHistory: async function() {
        try {
            var d = await App.fetchJSON('/api/logs/query?limit=200');
            if (!d || !d.items) return;
            if (this._list) this._list.innerHTML = '';
            this._lines = [];
            for (var i = d.items.length - 1; i >= 0; i--) {
                this._push(d.items[i]);
            }
            var s = await App.fetchJSON('/api/logs/stats');
            if (s && s.stats) this._updateStats(s.stats);
        } catch(e) {}
    }
};

console.log('[Log Viewer v18] ready — SSE实时日志 + 右侧面板 + 全屏弹窗双模式');
})();
