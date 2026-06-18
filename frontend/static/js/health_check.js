// ============================================================
// v4.0.0-phase11: Startup Health Check Frontend
// 启动自检弹窗 — 自动运行 + 逐项结果 + 重试单条 + 跳过
// ============================================================

(function() {
'use strict';

App.healthCheck = {
    _results: null,
    _modal: null,
    _autoShown: false,
};

App.healthCheck.run = async function(options) {
    options = options || {};
    var skip = options.skip || '';
    var timeout = options.timeout || 5;

    // Show modal if not already
    this._ensureModal();
    this._setStatus('checking');

    try {
        var url = '/api/health/check?timeout=' + timeout;
        if (skip) url += '&skip=' + encodeURIComponent(skip);
        this._results = await App.fetchJSON(url);
        this._renderResults();
    } catch (e) {
        this._setStatus('error', '连接失败: ' + e.message);
    }
};

App.healthCheck._ensureModal = function() {
    if (document.getElementById('healthCheckModal')) return;

    var overlay = document.createElement('div');
    overlay.id = 'healthCheckModal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:none;z-index:700;';

    overlay.innerHTML = '<div class="modal-content hc-modal" style="max-width:560px;width:95%;max-height:85vh;overflow-y:auto;border-radius:14px;padding:0;">'
        + '<div class="hc-header" style="position:sticky;top:0;z-index:1;background:var(--bg-card);border-bottom:1px solid var(--border-color);padding:14px 18px;display:flex;justify-content:space-between;align-items:center;">'
        + '<h5 style="margin:0;font-size:16px;">🩺 启动自检</h5>'
        + '<span id="hcTimestamp" style="font-size:11px;color:var(--text-muted);"></span>'
        + '</div>'
        + '<div id="hcBody" style="padding:12px 18px;">'
        + '<div id="hcSummary" style="margin-bottom:10px;display:none;"></div>'
        + '<div id="hcCheckList" style="display:flex;flex-direction:column;gap:6px;">'
        + '<div style="text-align:center;padding:20px;color:var(--text-muted);">'
        + '<div class="spinner-border" style="width:24px;height:24px;color:var(--primary);"></div>'
        + '<p style="margin-top:8px;font-size:13px;">正在检测外部依赖...</p>'
        + '</div></div></div>'
        + '<div id="hcFooter" style="padding:10px 18px;border-top:1px solid var(--border-color);display:flex;gap:8px;justify-content:flex-end;display:none;">'
        + '<button class="btn btn-sm btn-outline" id="hcBtnRetryAll" onclick="App.healthCheck.run({})">🔄 全部重检</button>'
        + '<button class="btn btn-sm btn-primary" id="hcBtnClose" onclick="App.healthCheck.close()">关闭</button>'
        + '</div></div>';

    overlay.onclick = function(e) { if (e.target === overlay) App.healthCheck.close(); };
    document.body.appendChild(overlay);
    this._modal = overlay;
};

App.healthCheck._setStatus = function(state, msg) {
    var m = this._modal || document.getElementById('healthCheckModal');
    if (!m) return;
    m.style.display = 'flex';
    if (state === 'error') {
        var body = document.getElementById('hcBody');
        if (body) body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--danger,#ef4444);">❌ ' + (msg||'连接失败') + '</div>';
    }
};

App.healthCheck._renderResults = function() {
    var r = this._results;
    if (!r) return;

    var body = document.getElementById('hcBody');
    var footer = document.getElementById('hcFooter');
    if (!body) return;

    var ts = document.getElementById('hcTimestamp');
    if (ts) ts.textContent = new Date().toLocaleTimeString();

    // Summary
    var summary = document.getElementById('hcSummary');
    if (summary) {
        summary.style.display = 'block';
        var errCnt = r.error_count || 0;
        var warnCnt = r.warning_count || 0;
        var okCnt = r.checked - errCnt - warnCnt;
        var parts = [];
        if (okCnt > 0) parts.push('<span style="color:#10b981;">✅ ' + okCnt + ' 通过</span>');
        if (warnCnt > 0) parts.push('<span style="color:#f59e0b;">⚠️ ' + warnCnt + ' 警告</span>');
        if (errCnt > 0) parts.push('<span style="color:#ef4444;">❌ ' + errCnt + ' 错误</span>');
        if (r.skipped > 0) parts.push('<span style="color:var(--text-muted);">⏭️ ' + r.skipped + ' 跳过</span>');
        summary.innerHTML = '<div style="font-size:12px;display:flex;gap:12px;flex-wrap:wrap;">' + parts.join(' ') + '</div>';
    }

    // Results list
    var list = document.getElementById('hcCheckList');
    if (!list) return;

    var ICONS = {
        'ollama': '🦙', 'comfyui': '🖼️', 'semantic': '🔍', 'ffmpeg': '🎬',
        'pillow': '🖌️', 'db': '🗄️', 'disk': '💾', 'port': '🌐', 'llm': '🤖'
    };

    var checkOrder = ['db','pillow','port','disk','semantic','ffmpeg','ollama','comfyui','llm'];
    var h = '';
    for (var i = 0; i < checkOrder.length; i++) {
        var key = checkOrder[i];
        var item = r.results[key];
        if (!item) continue;

        var icon = ICONS[key] || '⚙️';
        var label = item.label || key;
        var skipped = item.skipped;

        var statusColor, statusIcon;
        if (skipped) { statusColor = 'var(--text-muted)'; statusIcon = '⏭️'; }
        else if (item.ok) { statusColor = '#10b981'; statusIcon = '✅'; }
        else { statusColor = '#ef4444'; statusIcon = '❌'; }

        var detail = '';
        if (skipped && item.reason) {
            detail = '<span style="color:var(--text-muted);font-size:10px;">跳过: ' + App._escape(item.reason) + '</span>';
        } else if (item.ok) {
            // successful details
            if (item.model_count !== undefined) detail = '<span style="color:var(--text-muted);font-size:10px;">' + item.model_count + ' 个模型 · ' + (item.latency_ms||'?') + 'ms</span>';
            else if (item.version) detail = '<span style="color:var(--text-muted);font-size:10px;">v' + item.version + '</span>';
            else if (item.latency_ms !== undefined) detail = '<span style="color:var(--text-muted);font-size:10px;">' + item.latency_ms + 'ms</span>';
            else if (item.free_gb !== undefined) detail = '<span style="color:var(--text-muted);font-size:10px;">' + item.free_gb + ' GB 可用</span>';
            else if (item.access_url) detail = '<span style="color:var(--text-muted);font-size:10px;">' + App._escape(item.access_url) + '</span>';
            else if (item.provider) detail = '<span style="color:var(--text-muted);font-size:10px;">' + item.provider + ' · ' + App._escape(item.model||'') + '</span>';
            else if (item.prompt_count !== undefined) detail = '<span style="color:var(--text-muted);font-size:10px;">' + item.prompt_count + ' 条数据</span>';
        } else {
            detail = '<span style="color:var(--danger,#ef4444);font-size:10px;">' + App._escape(item.hint || item.error || '检测失败') + '</span>';
        }

        h += '<div class="hc-item" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid ' + (skipped?'transparent':'var(--border-color)') + ';border-radius:8px;background:' + (skipped?'var(--hover-bg,transparent)':'') + ';">';
        h += '<span style="font-size:20px;">' + statusIcon + '</span>';
        h += '<span style="font-size:18px;">' + icon + '</span>';
        h += '<div style="flex:1;min-width:0;">';
        h += '<div style="font-size:13px;font-weight:600;color:var(--text-main);">' + App._escape(label) + '</div>';
        h += detail;
        h += '</div>';
        if (!skipped && !item.ok) {
            h += '<button class="btn btn-xs btn-outline" style="font-size:10px;padding:2px 8px;white-space:nowrap;" onclick="App.healthCheck.retryOne(\'' + key + '\')">🔄 重试</button>';
        }
        h += '</div>';
    }
    list.innerHTML = h;

    if (footer) footer.style.display = 'flex';
};

App.healthCheck.retryOne = async function(key) {
    var list = document.getElementById('hcCheckList');
    if (!list) return;
    // Show spinner on that row
    var items = list.querySelectorAll('.hc-item');
    var order = ['db','pillow','port','disk','semantic','ffmpeg','ollama','comfyui','llm'];
    for (var i = 0; i < order.length; i++) {
        if (order[i] !== key) continue;
        if (items[i]) items[i].style.opacity = '0.5';
    }
    try {
        var d = await App.fetchJSON('/api/health/check/' + key);
        // Update result in local cache
        if (d && d.result && this._results && this._results.results) {
            this._results.results[key] = d.result;
            this._results.results[key].label = this._results.results[key].label || key;
            // Re-count
            var ok = true, errs = 0, warns = 0;
            for (var k in this._results.results) {
                var v = this._results.results[k];
                if (!v.ok && !v.skipped) {
                    ok = false;
                    if (k === 'db' || k === 'port') errs++; else warns++;
                }
            }
            this._results.ok = ok;
            this._results.error_count = errs;
            this._results.warning_count = warns;
        }
    } catch(e) {}
    this._renderResults();
};

App.healthCheck.close = function() {
    var m = document.getElementById('healthCheckModal');
    if (m) m.remove();
    this._modal = null;
};

App.healthCheck.show = function() {
    this._ensureModal();
    var m = this._modal || document.getElementById('healthCheckModal');
    if (m) {
        m.style.display = 'flex';
        this.run({});
    }
};

// Auto-run on page load (once per session)
App.healthCheck.autoCheck = function() {
    if (this._autoShown) return;
    this._autoShown = true;
    // Delay slightly so the main UI renders first
    var self = this;
    setTimeout(function() { self.show(); }, 800);
};

})();
