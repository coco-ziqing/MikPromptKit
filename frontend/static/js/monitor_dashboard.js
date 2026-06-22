// ============================================================
// v4.0.0-phase12: Service Monitor Dashboard
// 启动监测仪表盘 — 运行时指标 + 健康快照 + 请求统计 + 自动刷新
// ============================================================

(function() {
'use strict';

App.monitor = {
    _timer: null,
    _intervalSec: 10,
    _isOpen: false,
    _data: null,
};

// ============ 打开/关闭 ============

App.monitor.open = function() {
    if (this._isOpen) return;
    this._isOpen = true;
    this._ensureModal();
    this.show();
    this.startAutoRefresh();
};

App.monitor.close = function() {
    this._isOpen = false;
    this.stopAutoRefresh();
    var m = document.getElementById('monitorModal');
    if (m) m.style.display = 'none';
};

App.monitor.toggle = function() {
    if (this._isOpen) this.close();
    else this.open();
};

// ============ 构建弹窗 ============

App.monitor._ensureModal = function() {
    if (document.getElementById('monitorModal')) return;

    var overlay = document.createElement('div');
    overlay.id = 'monitorModal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:none;z-index:700;';
    overlay.onclick = function(e) {
        if (e.target === overlay) App.monitor.close();
    };

    overlay.innerHTML = '' +
    '<div class="modal-content mon-dashboard" style="max-width:900px;width:95%;max-height:88vh;overflow-y:auto;border-radius:14px;padding:0;">' +

    // ---- 头部栏 ----
    '<div class="mon-header" style="position:sticky;top:0;z-index:2;background:var(--bg-card);border-bottom:1px solid var(--border-color);padding:12px 18px;display:flex;justify-content:space-between;align-items:center;">' +
    '<div style="display:flex;align-items:center;gap:10px;">' +
    '<h5 style="margin:0;font-size:16px;">🖥️ 服务监测仪表盘</h5>' +
    '<span id="monStatusBadge" style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--hover-bg);color:var(--text-muted);">连接中...</span>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;">' +
    '<select id="monRefreshInterval" onchange="App.monitor.setInterval(this.value)" style="font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
    '<option value="5">5s 刷新</option><option value="10" selected>10s 刷新</option><option value="30">30s 刷新</option><option value="0">手动刷新</option>' +
    '</select>' +
    '<button class="btn btn-sm btn-outline" onclick="App.monitor.refresh()" title="手动刷新" style="font-size:11px;padding:3px 8px;">🔄</button>' +
    '<button class="btn btn-sm btn-outline" onclick="App.monitor.openHealthCheck()" title="完整自检" style="font-size:11px;padding:3px 8px;">🩺 自检</button>' +
    '<button style="background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer;line-height:1;" onclick="App.monitor.close()">&times;</button>' +
    '</div></div>' +

    // ---- 内容区 ----
    '<div id="monBody" style="padding:14px 18px;">' +
    '<div style="text-align:center;padding:40px;color:var(--text-muted);">' +
    '<div class="spinner-border" style="width:28px;height:28px;color:var(--primary);"></div>' +
    '<p style="margin-top:10px;">正在加载监测数据...</p>' +
    '</div></div>' +

    '</div>';

    document.body.appendChild(overlay);
};

// ============ 刷新逻辑 ============

App.monitor.show = async function() {
    var m = document.getElementById('monitorModal');
    if (m) m.style.display = 'flex';
    await this.refresh();
};

App.monitor.refresh = async function() {
    var badge = document.getElementById('monStatusBadge');
    var body = document.getElementById('monBody');
    if (!body) return;

    if (badge) {
        badge.textContent = App._t('common.refresh', '刷新中...');
        badge.style.color = '#f59e0b';
    }

    try {
        this._data = await App.fetchJSON('/api/monitor/dashboard?timeout=5');
        this._render();
        if (badge) {
            badge.textContent = '已连接 · ' + new Date().toLocaleTimeString();
            badge.style.color = '#10b981';
        }
    } catch (e) {
        if (badge) {
            badge.textContent = App._t('auto.str_0745fc09', '连接失败');
            badge.style.color = '#ef4444';
        }
        if (body && !this._data) {
            body.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">❌ 获取监测数据失败: ' + App._escape(e.message) + '</div>';
        }
    }
};

// ============ 渲染 ============

App.monitor._render = function() {
    var d = this._data;
    if (!d) return;

    var body = document.getElementById('monBody');
    if (!body) return;

    var html = '';

    // ========== 第1行：概览卡片（运行时 + 数据库） ==========
    var rt = d.runtime || {};
    var db = d.database || {};
    var uptime = rt.uptime || {};
    var cpu = rt.cpu || {};
    var mem = rt.memory || {};
    var net = rt.network || {};
    var proc = rt.process || {};
    var reqs = rt.requests || {};

    html += '<div class="mon-section-title">📡 运行时状态</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">';

    html += this._card('⏱️ 运行时长',
        '<span style="font-size:20px;font-weight:700;">' + App._escape(uptime.readable||'--') + '</span>',
        '启动: ' + App._escape(uptime.start_time||'--'), '#4f46e5');

    html += this._card('⚡ CPU',
        '<span style="font-size:20px;font-weight:700;">' + (cpu.process_pct||0) + '%</span>' +
        '<span style="font-size:10px;color:var(--text-muted);"> 进程</span>',
        '系统: ' + (cpu.system_pct||'?') + '% | ' + (cpu.cpu_count||'?') + '核', '#f59e0b');

    html += this._card('🧠 内存',
        '<span style="font-size:20px;font-weight:700;">' + (mem.process_rss_mb||0) + '</span>' +
        '<span style="font-size:11px;"> MB</span>',
        '系统: ' + (mem.system_available_gb||'?') + 'GB 可用 / ' + (mem.system_total_gb||'?') + 'GB', '#10b981');

    html += this._card('🌐 网络',
        '<span style="font-size:14px;font-weight:700;">' + App._escape(net.lan_ip||'127.0.0.1') + '</span>',
        '↓' + (net.bytes_recv_mb||0).toFixed(0) + 'MB ↑' + (net.bytes_sent_mb||0).toFixed(0) + 'MB', '#06b6d4');

    html += '</div>';

    // ========== 第2行：数据库概览 ==========
    html += '<div class="mon-section-title">🗄️ 数据存储</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:16px;">';
    var dbItems = [
        {label:App._t('common.notice', '提示词'), val: db.prompts, icon:'📝'},
        {label:App._t('auto.str_d87f215d', '卡片'), val: db.cards, icon:'🃏'},
        {label:App._t('auto.str_5cc23262', '已删除'), val: db.cards_deleted, icon:'🗑️'},
        {label:App._t('auto.str_441926a2', '词库资产'), val: db.library_assets, icon:'📚'},
        {label:App._t('auto.str_ccbb2ef4', '收藏分组'), val: db.collections, icon:'⭐'},
        {label:App._t('nav.wordpacks', '词包'), val: db.wordpacks, icon:'📦'},
        {label:App._t('auto.str_2e7aa31a', 'DB大小'), val: (db.db_size_mb||0) + 'MB', icon:'💾'},
        {label:'WAL', val: (db.wal_size_mb||0) + 'MB', icon:'📋'},
    ];
    for (var i = 0; i < dbItems.length; i++) {
        var it = dbItems[i];
        html += '<div style="background:var(--hover-bg);border-radius:8px;padding:8px 10px;text-align:center;">';
        html += '<div style="font-size:14px;">' + it.icon + '</div>';
        html += '<div style="font-size:15px;font-weight:700;">' + App._escape(String(it.val)) + '</div>';
        html += '<div style="font-size:10px;color:var(--text-muted);">' + it.label + '</div>';
        html += '</div>';
    }
    html += '</div>';

    // ========== 第3行：健康状态灯 ==========
    html += '<div class="mon-section-title">🔍 依赖健康状态</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;margin-bottom:16px;">';
    var health = d.health || {};
    var healthOrder = [
        {key:'db', name:App._t('auto.str_68051bf4', '数据库'), icon:'🗄️', critical:true},
        {key:'wal', name:'WAL 完整性', icon:'📋', critical:true},
        {key:'pillow', name:'Pillow', icon:'🖌️', critical:true},
        {key:'port', name:'端口/防火墙/IP', icon:'🌐', critical:true},
        {key:'disk', name:'磁盘空间', icon:'💾', critical:true},
        {key:'ffmpeg', name:'FFmpeg', icon:'🎬', critical:false},
        {key:'ollama', name:'Ollama', icon:'🦙', critical:false},
        {key:'comfyui', name:'ComfyUI', icon:'🖼️', critical:false},
    ];

    for (var i = 0; i < healthOrder.length; i++) {
        var hk = healthOrder[i];
        var item = health[hk.key];
        if (!item) {
            html += this._healthItem(hk.name, hk.icon, 'unknown', '未检测', hk.critical);
            continue;
        }
        var status = item.ok ? (item.skipped ? 'skipped' : 'ok') : 'error';
        var msg = '';
        if (item.ok && !item.skipped) {
            if (item.version) msg = 'v' + item.version;
            else if (item.latency_ms !== undefined) msg = item.latency_ms + 'ms';
            else if (item.access_url) msg = item.access_url;
            else if (item.models) msg = item.model_count + ' 模型';
            else if (item.free_gb !== undefined) msg = item.free_gb + 'GB 可用';
            else if (item.prompt_count !== undefined) msg = item.prompt_count + ' 条';
            else msg = '通过';
        } else if (item.skipped) {
            msg = item.reason || '已跳过';
        } else {
            msg = item.hint || item.error || '异常';
        }
        html += this._healthItem(hk.name, hk.icon, status, msg, hk.critical);
    }
    html += '</div>';

    // ========== 第4行：请求统计 ==========
    html += '<div class="mon-section-title">📊 请求统计</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;margin-bottom:12px;">';
    html += this._card_sm('请求总数', reqs.total||0, '#4f46e5');
    html += this._card_sm(App._t('common.error', '错误'), reqs.errors||0, (reqs.errors||0) > 0 ? '#ef4444' : '#10b981');
    var methodHtml = '';
    var methods = reqs.by_method || {};
    for (var m in methods) {
        methodHtml += '<span style="font-size:10px;padding:1px 5px;border-radius:4px;background:var(--hover-bg);margin-right:4px;">' + m + ':' + methods[m] + '</span>';
    }
    html += this._card_sm('方法', methodHtml || '--', 'var(--text-muted)');
    html += '</div>';

    // Top paths
    if (reqs.top_paths && reqs.top_paths.length > 0) {
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:12px;font-weight:600;margin-bottom:4px;">热门路径 TOP 10</div>';
        html += '<div style="max-height:150px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px;">';
        for (var i = 0; i < reqs.top_paths.length; i++) {
            var tp = reqs.top_paths[i];
            var barW = reqs.top_paths[0].count > 0 ? Math.round(tp.count / reqs.top_paths[0].count * 100) : 0;
            html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 10px;font-size:11px;border-bottom:1px solid var(--border-color);">';
            html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;">' + App._escape(tp.path) + '</span>';
            html += '<span style="flex-shrink:0;width:80px;">';
            html += '<span style="display:inline-block;height:14px;border-radius:3px;background:#818cf8;width:' + barW + '%;vertical-align:middle;"></span>';
            html += '</span>';
            html += '<span style="flex-shrink:0;width:30px;text-align:right;color:var(--text-muted);">' + tp.count + '</span>';
            html += '</div>';
        }
        html += '</div></div>';
    }

    // 最近请求（最后 10 条）
    if (reqs.recent && reqs.recent.length > 0) {
        html += '<div style="margin-bottom:8px;">';
        html += '<div style="font-size:12px;font-weight:600;margin-bottom:4px;">最近请求 (' + reqs.recent.length + ')</div>';
        html += '<div style="font-size:10px;font-family:monospace;max-height:120px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px;padding:4px 8px;">';
        var recentItems = reqs.recent.slice(-10);
        for (var i = 0; i < recentItems.length; i++) {
            var rq = recentItems[i];
            var sc = rq.status >= 400 ? '#ef4444' : (rq.status >= 300 ? '#f59e0b' : '#10b981');
            html += '<div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid var(--border-color);">';
            html += '<span style="color:var(--text-muted);width:50px;">' + App._escape(rq.time) + '</span>';
            html += '<span style="width:36px;color:' + sc + ';">' + rq.status + '</span>';
            html += '<span style="width:32px;color:var(--text-muted);">' + App._escape(rq.method) + '</span>';
            html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + App._escape(rq.path) + '</span>';
            html += '<span style="width:50px;text-align:right;color:var(--text-muted);">' + rq.duration_ms + 'ms</span>';
            html += '</div>';
        }
        html += '</div></div>';
    }

    // ========== 底部：进程信息 ==========
    html += '<div style="margin-top:12px;padding:10px 14px;background:var(--hover-bg);border-radius:10px;font-size:11px;color:var(--text-muted);display:flex;gap:20px;flex-wrap:wrap;">';
    html += '<span>PID: <b style="color:var(--text-main);">' + (proc.pid || '--') + '</b></span>';
    html += '<span>Python: <b style="color:var(--text-main);">' + App._escape(proc.python || '--') + '</b></span>';
    html += '<span>平台: <b style="color:var(--text-main);">' + App._escape(proc.platform || '--') + '</b></span>';
    html += '<span>工作目录: <b style="color:var(--text-main);">' + App._escape(proc.cwd || '--') + '</b></span>';
    html += '<span>数据时间: <b style="color:var(--text-main);">' + App._escape(d.timestamp || '--') + '</b></span>';
    html += '</div>';

    body.innerHTML = html;
};

// ============ 辅助渲染 ============

App.monitor._card = function(title, value, sub, accentColor) {
    return '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-top:3px solid ' + accentColor + ';border-radius:10px;padding:12px 14px;">' +
        '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">' + title + '</div>' +
        '<div style="margin-bottom:2px;">' + value + '</div>' +
        '<div style="font-size:10px;color:var(--text-muted);">' + sub + '</div>' +
        '</div>';
};

App.monitor._card_sm = function(label, val, color) {
    return '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;text-align:center;">' +
        '<div style="font-size:10px;color:var(--text-muted);">' + label + '</div>' +
        '<div style="font-size:16px;font-weight:700;color:' + (color||'var(--text-main)') + ';">' + val + '</div>' +
        '</div>';
};

App.monitor._healthItem = function(name, icon, status, msg, critical) {
    var dotColor = status === 'ok' ? '#10b981' : (status === 'error' ? '#ef4444' : (status === 'skipped' ? '#94a3b8' : '#64748b'));
    var bg = status === 'error' ? 'var(--danger-bg)' : 'var(--bg-card)';
    var borderColor = status === 'error' ? '#ef4444' : 'var(--border-color)';
    if (critical && status === 'error') borderColor = '#ef4444';

    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:' + bg + ';border:1px solid ' + borderColor + ';border-radius:8px;">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;' + (status==='ok'?'box-shadow:0 0 4px '+dotColor+';':'') + '"></span>' +
        '<span style="font-size:15px;">' + icon + '</span>' +
        '<span style="font-size:12px;font-weight:600;color:var(--text-main);flex:1;">' + App._escape(name) + '</span>' +
        '<span style="font-size:10px;color:' + (status==='error'?'#ef4444':'var(--text-muted)') + ';max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + App._escape(msg) + '</span>' +
        '</div>';
};

// ============ 自动刷新 ============

App.monitor.startAutoRefresh = function() {
    this.stopAutoRefresh();
    var self = this;
    this._timer = setInterval(function() {
        if (!self._isOpen) { self.stopAutoRefresh(); return; }
        self.refresh();
    }, this._intervalSec * 1000);
};

App.monitor.stopAutoRefresh = function() {
    if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
    }
};

App.monitor.setInterval = function(sec) {
    this._intervalSec = parseInt(sec) || 10;
    if (this._isOpen) {
        if (this._intervalSec <= 0) {
            this.stopAutoRefresh();
        } else {
            this.startAutoRefresh();
        }
    }
};

// ============ 快速跳转 ============

App.monitor.openHealthCheck = function() {
    // 如果 healthCheck 模块已加载，直接调用
    if (App.healthCheck && App.healthCheck.show) {
        App.healthCheck.show();
    } else {
        // 降级：新窗口
        window.open('/api/health/check', '_blank');
    }
};

})();
