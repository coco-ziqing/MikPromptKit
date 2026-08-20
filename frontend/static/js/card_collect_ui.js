// ================================================================
// v5.42.0: 词卡采集（收藏 → 浏览器自动化采集 → 预采集库 → 归档建词卡 → 来源溯源）
// - 词库导航菜单入口：App.openCardCollect()
// - Tab1 收藏夹：URL+备注 前置收藏，随时发起采集
// - Tab2 预采集库：识别结果预览/修正/批量归档（自动建议分组 + 手动分组）
// - Tab3 采集任务：进度/停止（合规：人工可中断）
// 依赖：App.fetchJSON / App.showToast / App._escape / App._modal
// ================================================================
(function () {
    'use strict';
    if (!App) return;

    var CC = {
        _tab: 'fav',
        _sel: {},            // 预采集库勾选 {id:true}
        _filter: { status: '', media: '' },
        _timer: null,
        _favPool: 'pending', // v5.43.0 URL 收藏库当前池
        _favSel: {},         // v5.43.0 URL 收藏库勾选 {id:true}
        _favAll: [],         // v5.43.0 收藏库全量缓存

        _esc: function (s) { return App._escape ? App._escape(s || '') : String(s || ''); },
        _toast: function (m, t) { if (App.showToast) App.showToast(m, t || 'info'); },

        _modal: function (html) {
            var ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.zIndex = 950;
            ov.innerHTML = '<div class="modal-content" style="max-width:520px;border-radius:14px;padding:16px;">' + (html || '') + '</div>';
            document.body.appendChild(ov);
            return ov;
        },

        _statusBadge: function (s) {
            var m = {
                pending: ['📌 待归档', '#f59e0b'],
                archived: ['🗂 已归档', '#10b981'],
                queued: ['⏳ 排队中', '#94a3b8'],
                running: ['🔄 采集中', '#3b82f6'],
                success: ['✅ 完成', '#10b981'],
                fail: ['❌ 失败', '#ef4444']
            };
            var b = m[s] || [s, '#94a3b8'];
            return '<span style="color:' + b[1] + ';font-size:11px;">' + b[0] + '</span>';
        },
        _favBadge: function (s) {
            // v5.43.0 四池：pending 待处理 / ready 待采集 / hold 备用 / discard 废弃（存量 collected/archived 兼容）
            var m = {
                pending: ['📌 待处理', '#f59e0b'],
                ready: ['✅ 待采集', '#10b981'],
                hold: ['🗄 备用', '#94a3b8'],
                discard: ['🚮 废弃', '#6b7280'],
                collected: ['🕷 已采集', '#3b82f6'],
                archived: ['🗂 已归档', '#10b981']
            };
            var b = m[s] || [s, '#94a3b8'];
            return '<span style="color:' + b[1] + ';font-size:11px;">' + b[0] + '</span>';
        },

        // v5.43.1: 元数据抓取状态徽章（失败可点击重试）
        _fetchBadge: function (f) {
            var s = f.fetch_status;
            if (s === 'success') return '<span style="color:#10b981;font-size:10px;">✅ 已抓取</span>';
            if (s === 'running') return '<span style="color:#3b82f6;font-size:10px;">⏳ 抓取中</span>';
            if (s === 'fail') return '<span style="color:#ef4444;font-size:10px;cursor:pointer;text-decoration:underline;" onclick="App._ccFavRefetch(' + f.id + ')" title="点击重试">❌ 抓取失败·重试</span>';
            return '<span style="color:#94a3b8;font-size:10px;">⏳ 待抓取</span>';
        },
        _bar: function (pct) {
            return '<div style="height:3px;background:rgba(127,127,127,.15);border-radius:2px;margin-top:3px;overflow:hidden;"><div style="height:100%;width:' + Math.max(0, Math.min(100, pct || 0)) + '%;background:linear-gradient(90deg,#3b82f6,#10b981);transition:width .5s;"></div></div>';
        },
        _thumb: function (it) {
            if (it.media_type === 'video') {
                return '<video src="/api/card-collect/file/' + this._esc(it.media_url) + '" style="width:88px;height:66px;object-fit:cover;border-radius:6px;background:#000;" muted playsinline preload="metadata"></video>';
            }
            return '<img src="/api/card-collect/file/' + this._esc(it.media_url) + '" style="width:88px;height:66px;object-fit:cover;border-radius:6px;background:#f1f5f9;" loading="lazy">';
        },

        // ============ 面板 ============
        open: function () {
            var self = this;
            var ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.id = 'ccOverlay';
            ov.style.zIndex = 900;
            ov.innerHTML =
                '<div class="modal-content" style="max-width:920px;width:92vw;height:min(86vh,720px);max-height:86vh;display:flex;flex-direction:column;border-radius:14px;">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(127,127,127,.15);">' +
                '<div style="font-size:15px;font-weight:600;">🕷 词卡采集 <span style="font-size:11px;color:var(--text-muted);font-weight:400;">公开内容采集 · 不登录 · 可中断 · 来源可溯源</span></div>' +
                '<button onclick="this.closest(\'.modal-overlay\').remove();App._stopCCPoll&&App._stopCCPoll();" style="border:none;background:none;font-size:18px;color:var(--text-muted);cursor:pointer;" title="关闭">✕</button>' +
                '</div>' +
                '<div style="display:flex;gap:6px;padding:10px 16px 0;border-bottom:1px solid rgba(127,127,127,.12);">' +
                '<button id="ccTabFav" class="btn btn-sm" onclick="App._ccSwitchTab(\'fav\')">📥 URL收藏库</button>' +
                '<button id="ccTabItems" class="btn btn-sm" onclick="App._ccSwitchTab(\'items\')">🗂 预采集库</button>' +
                '<button id="ccTabTasks" class="btn btn-sm" onclick="App._ccSwitchTab(\'tasks\')">⚙️ 采集任务</button>' +
                '<button id="ccTabSites" class="btn btn-sm" onclick="App._ccSwitchTab(\'sites\')">🌐 灵感图库</button>' +
                '</div>' +
                '<div id="ccBody" style="flex:1;overflow-y:auto;padding:14px 16px;"></div>' +
                '</div>';
            document.body.appendChild(ov);
            this._tab = 'fav';
            this._render();
            this._poll();
        },

        _switchTab: function (tab) {
            this._tab = tab;
            this._sel = {};
            this._render();
            this._poll();
        },

        _render: function () {
            var btns = { fav: 'ccTabFav', items: 'ccTabItems', tasks: 'ccTabTasks', sites: 'ccTabSites' };
            for (var k in btns) {
                var b = document.getElementById(btns[k]);
                if (b) b.className = 'btn btn-sm ' + (k === this._tab ? 'btn-primary' : 'btn-secondary');
            }
            var body = document.getElementById('ccBody');
            if (!body) return;
            if (this._tab === 'fav') this._renderFav(body);
            else if (this._tab === 'items') this._renderItems(body);
            else if (this._tab === 'sites') this._renderSites(body);
            else this._renderTasks(body);
        },

        // ============ Tab1 URL收藏库（v5.43.0 四池工作台） ============
        _renderFav: function (body) {
            var self = this;
            body.innerHTML =
                '<div style="margin-bottom:10px;">' +
                '<div style="display:flex;gap:8px;">' +
                '<textarea id="ccFavUrls" placeholder="粘贴灵感页面地址（支持多行批量，一行一个；仅 http/https）" ' +
                'style="flex:1;height:54px;padding:8px 10px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;resize:vertical;font-size:12px;"></textarea>' +
                '<button class="btn btn-primary btn-sm" style="align-self:flex-end;" onclick="App._ccFavAddUrls()">📥 入库</button>' +
                '</div>' +
                '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">自动存入「待处理」池 · 入库自动抓取标题/摘要/首图 · 原始链接保留，去重/清洗后置到收藏库操作</div>' +
                '</div>' +
                '<div id="ccFavPoolBar" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;"></div>' +
                '<div id="ccFavBatchBar" style="display:none;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap;padding:6px 8px;border:1px solid rgba(59,130,246,.35);border-radius:8px;background:rgba(59,130,246,.06);"></div>' +
                '<div id="ccFavList" style="display:flex;flex-direction:column;gap:8px;">加载中…</div>';
            App.fetchJSON('/api/card-collect/favorites').then(function (d) {
                self._favAll = (d && d.items) || [];
                self._renderFavPools(self._favAll);
                self._renderFavList(self._favAll);
            }).catch(function () { var l = document.getElementById('ccFavList'); if (l) l.innerHTML = '<div style="color:#ef4444;">加载失败</div>'; });
        },

        _renderFavPools: function (items) {
            var self = this;
            var bar = document.getElementById('ccFavPoolBar');
            if (!bar) return;
            var pools = [
                ['pending', '📌 待处理'], ['ready', '✅ 待采集'], ['hold', '🗄 备用'],
                ['discard', '🚮 废弃'], ['all', '🌐 全部']
            ];
            var counts = {};
            items.forEach(function (f) { counts[f.status] = (counts[f.status] || 0) + 1; });
            bar.innerHTML = pools.map(function (p) {
                var k = p[0];
                var cnt = k === 'all' ? items.length : (counts[k] || 0);
                var act = self._favPool === k;
                return '<button class="btn btn-sm ' + (act ? 'btn-primary' : 'btn-secondary') + '" onclick="App._ccFavPool(\'' + k + '\')">' + p[1] + ' <span style="opacity:.7;">' + cnt + '</span></button>';
            }).join('');
        },

        _renderFavList: function (items) {
            var self = this;
            var list = document.getElementById('ccFavList');
            if (!list) return;
            var pool = this._favPool;
            var rows = pool === 'all' ? items : items.filter(function (f) { return f.status === pool; });
            if (!rows.length) {
                list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:22px;">该池暂无条目 · 粘贴地址或从浏览器扩展回传入库</div>';
            } else {
                var allOn = rows.every(function (f) { return self._favSel[f.id]; });
                list.innerHTML =
                    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">' +
                    '<label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" ' + (allOn ? 'checked' : '') + ' onchange="App._ccFavSelAll(this.checked)"> 全选本池</label>' +
                    '</div>' +
                    rows.map(function (f) {
                        var chk = self._favSel[f.id] ? 'checked' : '';
                        var dom = (f.domain || f.site_name) ?
                            '<span style="font-size:10px;color:var(--text-muted);background:rgba(127,127,127,.14);padding:1px 7px;border-radius:6px;margin-left:6px;">' + self._esc(f.site_name || f.domain) + '</span>' : '';
                        var title = (f.fetch_title || f.title || '').trim();
                        var thumbHtml = f.thumb ?
                            '<img src="/api/card-collect/urls/thumb/' + self._esc(f.thumb) + '" style="width:42px;height:42px;object-fit:cover;border-radius:8px;background:rgba(127,127,127,.1);" onerror="this.style.display=\'none\'">' : '';
                        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid rgba(127,127,127,.15);border-radius:10px;">' +
                            '<input type="checkbox" ' + chk + ' onchange="App._ccFavSel(' + f.id + ', this.checked)">' +
                            thumbHtml +
                            '<div style="flex:1;min-width:0;">' +
                            (title ? '<div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self._esc(title) + dom + '</div>' :
                                '<div style="font-size:13px;word-break:break-all;color:var(--text-muted);">🔗 ' + self._esc(f.url) + dom + '</div>') +
                            '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;word-break:break-all;">' + self._esc(f.url) + '</div>' +
                            '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;">' + self._favBadge(f.status) + ' · ' + self._fetchBadge(f) + ' · ' + self._esc(f.created_at) + '</div>' +
                            '</div>' +
                            '<button class="btn btn-sm btn-secondary" title="打开原网页" onclick="App._ccFavOpen(\'' + f.url.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">↗</button>' +
                            '<button class="btn btn-sm btn-secondary" title="复制 URL" onclick="App._ccFavCopy(\'' + f.url.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">⧉</button>' +
                            '<button class="btn btn-sm btn-primary" onclick="App._ccCollectFav(' + f.id + ')" title="单条发起采集">🕷</button>' +
                            '<button class="btn btn-sm btn-secondary" onclick="App._ccDelFav(' + f.id + ')" title="删除">🗑</button>' +
                            '</div>';
                    }).join('');
            }
            this._renderFavBatchBar();
        },

        _renderFavBatchBar: function () {
            var bar = document.getElementById('ccFavBatchBar');
            if (!bar) return;
            var ids = this._ccFavSelIds();
            if (!ids.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
            bar.style.display = 'flex';
            bar.innerHTML =
                '<span style="font-size:12px;">已选 <b style="color:#3b82f6;">' + ids.length + '</b> 条</span>' +
                '<button class="btn btn-sm btn-secondary" onclick="App._ccFavBatchStatus(\'ready\')">✅ 设为待采集</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="App._ccFavBatchStatus(\'hold\')">🗄 设为备用</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="App._ccFavBatchStatus(\'discard\')">🚮 设为废弃</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="App._ccFavBatchStatus(\'pending\')">📌 回待处理</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="App._ccFavBatchClean()">🧹 清洗选中</button>' +
                '<button class="btn btn-sm btn-primary" onclick="App._ccFavBatchCollect()">🕷 生成采集任务</button>' +
                '<button class="btn btn-sm btn-danger" onclick="App._ccFavBatchDel()">🗑 删除选中</button>';
        },

        _ccFavSelIds: function () { return Object.keys(this._favSel).map(Number); },

        _ccFavPool: function (k) {
            this._favPool = k;
            this._renderFavPools(this._favAll);
            this._renderFavList(this._favAll);
        },

        _ccFavSel: function (id, on) {
            if (on) this._favSel[id] = true; else delete this._favSel[id];
            this._renderFavBatchBar();
        },

        _ccFavSelAll: function (on) {
            var pool = this._favPool;
            (this._favAll || []).forEach(function (f) {
                if (pool === 'all' || f.status === pool) {
                    if (on) this._favSel[f.id] = true; else delete this._favSel[f.id];
                }
            }, this);
            this._renderFavList(this._favAll);
        },

        _ccFavAddUrls: function () {
            // v5.43.2: 入库前先预展示确认（与浏览器扩展批量回传同一人工确认流程）
            var t = (document.getElementById('ccFavUrls') || {}).value || '';
            var urls = t.split(/[\r\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
            if (!urls.length) { this._toast('请粘贴至少一个地址', 'error'); return; }
            var self = this;
            App.fetchJSON('/api/card-collect/urls/batch/preview', { method: 'POST', body: JSON.stringify({ urls: urls }) })
                .then(function (d) {
                    if (d && d.ok) self._ccFavConfirmModal(d.items || []);
                    else self._toast((d && d.detail) || '预览失败', 'error');
                }).catch(function () { self._toast('预览失败', 'error'); });
        },

        _ccFavConfirmModal: function (items) {
            var self = this;
            var invalid = items.filter(function (i) { return !i.valid; }).length;
            var inLib = items.filter(function (i) { return i.in_lib; }).length;
            var html =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><b>📥 入库确认</b>' +
                '<button onclick="this.closest(\'.modal-overlay\').remove()" style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;">✕</button></div>' +
                '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">共 ' + items.length + ' 条：已在库 <b style="color:#f59e0b;">' + inLib + '</b> · 非法 <b style="color:#ef4444;">' + invalid + '</b>（重复允许入库，统一后置清洗去重）</div>' +
                '<div style="max-height:40vh;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">' +
                items.map(function (it, idx) {
                    var tag = '';
                    if (!it.valid) tag = '<span style="color:#ef4444;font-size:10px;">⛔ 非法地址</span>';
                    else if (it.in_lib) tag = '<span style="color:#f59e0b;font-size:10px;">📌 已在库</span>';
                    var site = it.site_name ? '<span style="color:var(--text-muted);font-size:10px;margin-left:4px;">' + self._esc(it.site_name) + '</span>' : '';
                    return '<label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;cursor:pointer;padding:6px 8px;border:1px solid rgba(127,127,127,.12);border-radius:8px;">' +
                        '<input type="checkbox" data-u="' + idx + '" ' + (it.valid ? 'checked' : 'disabled') + ' style="margin-top:2px;">' +
                        '<span style="flex:1;min-width:0;word-break:break-all;">' + self._esc(it.url) + site + '<br>' + tag + '</span></label>';
                }).join('') + '</div>' +
                '<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">' +
                '<button class="btn btn-sm btn-secondary" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                '<button class="btn btn-sm btn-primary" onclick="App._ccFavConfirmIn()">确认入库</button></div>';
            this._favConfirmItems = items;
            this._favConfirmOv = this._modal(html);
        },

        _ccFavConfirmIn: function () {
            var items = this._favConfirmItems || [];
            var ov = this._favConfirmOv;
            var sel = [];
            if (ov) {
                var checks = ov.querySelectorAll('input[data-u]:checked');
                for (var i = 0; i < checks.length; i++) sel.push(items[parseInt(checks[i].getAttribute('data-u'), 10)].url);
            }
            if (!sel.length) { this._toast('未勾选任何条目', 'error'); return; }
            var self = this;
            App.fetchJSON('/api/card-collect/urls', { method: 'POST', body: JSON.stringify({ urls: sel }) })
                .then(function (d) {
                    if (d && d.ok) {
                        self._toast('已入库 ' + d.count + ' 条 → 待处理池', 'success');
                        if (ov) ov.remove();
                        var ta = document.getElementById('ccFavUrls'); if (ta) ta.value = '';
                        self._favPool = 'pending';
                        self._favSel = {};
                        self._renderFav(document.getElementById('ccBody'));
                    } else self._toast((d && d.detail) || '入库失败', 'error');
                }).catch(function () { self._toast('入库失败', 'error'); });
        },

        _ccFavBatchStatus: function (status) {
            var ids = this._ccFavSelIds();
            if (!ids.length) return;
            var self = this;
            App.fetchJSON('/api/card-collect/urls/status', { method: 'POST', body: JSON.stringify({ ids: ids, status: status }) })
                .then(function (d) {
                    if (d && d.ok) {
                        self._toast('已更新 ' + d.updated + ' 条', 'success');
                        self._favSel = {};
                        self._renderFav(document.getElementById('ccBody'));
                    } else self._toast((d && d.detail) || '更新失败', 'error');
                }).catch(function () { self._toast('更新失败', 'error'); });
        },

        _ccFavBatchDel: function () {
            var ids = this._ccFavSelIds();
            if (!ids.length) return;
            if (!confirm('确认删除选中的 ' + ids.length + ' 条收藏？该操作不可恢复。')) return;
            var self = this;
            App.fetchJSON('/api/card-collect/urls/delete', { method: 'POST', body: JSON.stringify({ ids: ids }) })
                .then(function (d) {
                    if (d && d.ok) {
                        self._toast('已删除 ' + d.deleted + ' 条', 'success');
                        self._favSel = {};
                        self._renderFav(document.getElementById('ccBody'));
                    } else self._toast((d && d.detail) || '删除失败', 'error');
                }).catch(function () { self._toast('删除失败', 'error'); });
        },

        _ccFavBatchCollect: function () {
            var ids = this._ccFavSelIds();
            if (!ids.length) return;
            if (ids.length > 20) { this._toast('单批最多 20 条（合规限额），请分批', 'error'); return; }
            if (!confirm('确认将选中的 ' + ids.length + ' 条生成采集任务？将串行依次采集（人工确认制，可随时停止）。')) return;
            var self = this;
            App.fetchJSON('/api/card-collect/urls/collect', { method: 'POST', body: JSON.stringify({ ids: ids }) })
                .then(function (d) {
                    if (d && d.ok) {
                        self._toast('已入队 ' + d.count + ' 个采集任务', 'success');
                        self._favSel = {};
                        self._switchTab('tasks');
                    } else self._toast((d && d.detail) || '启动失败', 'error');
                }).catch(function () { self._toast('启动失败', 'error'); });
        },

        _ccFavBatchClean: function () {
            var ids = this._ccFavSelIds();
            if (!ids.length) return;
            var self = this;
            this._toast('清洗中…（清追踪参数/短链还原/存活探测/去重）', 'info');
            App.fetchJSON('/api/card-collect/urls/clean', { method: 'POST', body: JSON.stringify({ ids: ids }) })
                .then(function (d) {
                    if (d && d.ok) {
                        self._favSel = {};
                        self._renderFav(document.getElementById('ccBody'));
                        self._ccFavCleanModal(d.results || []);
                    } else self._toast((d && d.detail) || '清洗失败', 'error');
                }).catch(function () { self._toast('清洗失败', 'error'); });
        },

        _ccFavCleanModal: function (results) {
            var self = this;
            var changed = results.filter(function (r) { return r.changed; }).length;
            var dead = results.filter(function (r) { return r.dead; }).length;
            var dup = results.filter(function (r) { return r.duplicate; }).length;
            var html =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><b>🧹 清洗结果</b>' +
                '<button onclick="this.closest(\'.modal-overlay\').remove()" style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;">✕</button></div>' +
                '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">共 ' + results.length + ' 条：清洗变更 <b style="color:#3b82f6;">' + changed + '</b> · 失效 <b style="color:#ef4444;">' + dead + '</b> · 重复 <b style="color:#f59e0b;">' + dup + '</b>（原始链接均未改动，仅标记）</div>' +
                '<div style="max-height:44vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">' +
                results.map(function (r) {
                    var tags = '';
                    if (r.dead) tags += '<span style="color:#ef4444;font-size:10px;border:1px solid rgba(239,68,68,.4);border-radius:6px;padding:0 5px;">💀 失效</span> ';
                    if (r.duplicate) tags += '<span style="color:#f59e0b;font-size:10px;border:1px solid rgba(245,158,11,.4);border-radius:6px;padding:0 5px;">🔁 重复(同#' + r.duplicate_of + ')</span> ';
                    if (!r.changed && !r.dead && !r.duplicate) tags = '<span style="color:#10b981;font-size:10px;">✅ 无需处理</span>';
                    return '<div style="border:1px solid rgba(127,127,127,.15);border-radius:8px;padding:8px 10px;font-size:11px;">' +
                        '<div style="word-break:break-all;color:var(--text-muted);">原始：' + self._esc(r.url) + '</div>' +
                        (r.clean_url ? '<div style="word-break:break-all;color:#3b82f6;margin-top:2px;">清洗：' + self._esc(r.clean_url) + '</div>' : '') +
                        '<div style="margin-top:4px;">' + tags + '</div>' +
                        '</div>';
                }).join('') + '</div>' +
                '<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' +
                '<button class="btn btn-sm btn-secondary" onclick="App._ccFavCleanMark(true)">🚮 失效+重复标废弃</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="App._ccFavCleanMark(false)">🔁 仅重复标废弃</button>' +
                '<button class="btn btn-sm btn-primary" onclick="this.closest(\'.modal-overlay\').remove()">知道了</button></div>';
            this._cleanResults = results;
            this._cleanOv = this._modal(html);
        },

        _ccFavCleanMark: function (withDead) {
            var results = this._cleanResults || [];
            var ids = results.filter(function (r) { return (withDead && r.dead) || r.duplicate; }).map(function (r) { return r.id; });
            if (!ids.length) { this._toast('无可标记条目', 'info'); return; }
            var self = this;
            App.fetchJSON('/api/card-collect/urls/status', { method: 'POST', body: JSON.stringify({ ids: ids, status: 'discard' }) })
                .then(function (d) {
                    if (d && d.ok) {
                        self._toast('已标记 ' + d.updated + ' 条为废弃（可复盘）', 'success');
                        if (self._cleanOv) self._cleanOv.remove();
                        self._renderFav(document.getElementById('ccBody'));
                    } else self._toast((d && d.detail) || '标记失败', 'error');
                }).catch(function () { self._toast('标记失败', 'error'); });
        },

        _ccFavRefetch: function (id) {
            var self = this;
            App.fetchJSON('/api/card-collect/urls/' + id + '/refetch', { method: 'POST' })
                .then(function (d) {
                    if (d && d.ok) { self._toast('已开始重抓', 'success'); self._renderFavList(self._favAll); }
                    else self._toast((d && d.detail) || '重抓失败', 'error');
                }).catch(function () { self._toast('重抓失败', 'error'); });
        },

        _ccFavOpen: function (url) { window.open(url, '_blank'); },

        _ccFavCopy: function (url) {
            var self = this;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(function () { self._toast('已复制', 'success'); })
                    .catch(function () { self._toast('复制失败', 'error'); });
            } else {
                var ta = document.createElement('textarea');
                ta.value = url; document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); self._toast('已复制', 'success'); } catch (e) { self._toast('复制失败', 'error'); }
                document.body.removeChild(ta);
            }
        },

        _addFav: function () {
            // 兼容：单条收藏（旧入口保留）
            var url = (document.getElementById('ccFavUrl') || {}).value || '';
            var note = (document.getElementById('ccFavNote') || {}).value || '';
            if (!/^https?:\/\//.test(url.trim())) { this._toast('请输入合法的 http/https 地址', 'error'); return; }
            var self = this;
            App.fetchJSON('/api/card-collect/favorites', { method: 'POST', body: JSON.stringify({ url: url.trim(), note: note.trim() }) })
                .then(function (d) {
                    if (d && d.ok) {
                        self._toast(d.duplicated ? '已存在，备注已更新' : '收藏成功', 'success');
                        self._renderFav(document.getElementById('ccBody'));
                    } else { self._toast((d && d.error) || '收藏失败', 'error'); }
                }).catch(function () { self._toast('收藏失败', 'error'); });
        },

        _delFav: function (id) {
            var self = this;
            if (!confirm('删除该收藏？')) return;
            App.fetchJSON('/api/card-collect/favorites/' + id, { method: 'DELETE' }).then(function (d) {
                if (d && d.ok) { self._toast('已删除', 'success'); self._renderFav(document.getElementById('ccBody')); }
            }).catch(function () { self._toast('删除失败', 'error'); });
        },

        _collectFav: function (id) {
            var self = this;
            App.fetchJSON('/api/card-collect/favorites/' + id + '/collect', { method: 'POST' }).then(function (d) {
                if (d && d.ok) { self._toast('采集任务 #' + d.task_id + ' 已启动', 'success'); self._switchTab('tasks'); }
                else self._toast((d && d.error) || '启动失败', 'error');
            }).catch(function (e) { self._toast('启动失败: ' + (e && e.message ? e.message : ''), 'error'); });
        },

        // ============ Tab2 预采集库 ============
        _renderItems: function (body) {
            var self = this;
            body.innerHTML =
                '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">' +
                '<button class="btn btn-sm ' + (!this._filter.status ? 'btn-primary' : 'btn-secondary') + '" onclick="App._ccSetFilter(\'status\',\'\')">全部</button>' +
                '<button class="btn btn-sm ' + (this._filter.status === 'pending' ? 'btn-primary' : 'btn-secondary') + '" onclick="App._ccSetFilter(\'status\',\'pending\')">📌 待归档</button>' +
                '<button class="btn btn-sm ' + (this._filter.status === 'archived' ? 'btn-primary' : 'btn-secondary') + '" onclick="App._ccSetFilter(\'status\',\'archived\')">🗂 已归档</button>' +
                '<span style="width:1px;height:20px;background:rgba(127,127,127,.2);"></span>' +
                '<button class="btn btn-sm ' + (this._filter.media === 'image' ? 'btn-primary' : 'btn-secondary') + '" onclick="App._ccSetFilter(\'media\',\'image\')">🖼 图片</button>' +
                '<button class="btn btn-sm ' + (this._filter.media === 'video' ? 'btn-primary' : 'btn-secondary') + '" onclick="App._ccSetFilter(\'media\',\'video\')">🎬 视频</button>' +
                '<span style="flex:1;"></span>' +
                '<button class="btn btn-sm btn-success" onclick="App._ccBatchArchive()">📥 批量归档选中</button>' +
                '</div>' +
                '<div id="ccItemList" style="display:flex;flex-direction:column;gap:8px;">加载中…</div>';
            var qs = '?status=' + encodeURIComponent(this._filter.status || '') + '&media_type=' + encodeURIComponent(this._filter.media || '');
            App.fetchJSON('/api/card-collect/items' + qs).then(function (d) {
                var list = document.getElementById('ccItemList');
                if (!list) return;
                var items = (d && d.items) || [];
                if (!items.length) { list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">预采集库为空 · 先去收藏夹发起采集</div>'; return; }
                list.innerHTML = items.map(function (it) {
                    var chk = self._sel[it.id] ? 'checked' : '';
                    var traceBtn = (it.status === 'archived' && it.word_card_id) ?
                        '<button class="btn btn-sm btn-secondary" title="来源溯源" onclick="App._ccTrace(' + it.word_card_id + ')">🔗 溯源</button>' : '';
                    var actBtn = it.status === 'pending' ?
                        '<button class="btn btn-sm btn-primary" onclick="App._ccArchiveOne(' + it.id + ')">📥 归档</button>' : '';
                    return '<div style="display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(127,127,127,.15);border-radius:10px;">' +
                        '<input type="checkbox" ' + chk + ' onchange="App._ccToggleSel(' + it.id + ',this.checked)" ' + (it.status === 'archived' ? 'disabled' : '') + '>' +
                        self._thumb(it) +
                        '<div style="flex:1;min-width:0;">' +
                        '<div style="font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + (it.prompt ? self._esc(it.prompt) : '<span style="color:var(--text-muted);">（未识别到提示词，可点击编辑补全）</span>') + '</div>' +
                        '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;">' +
                        '<span>🧠 ' + self._esc(it.model || '未识别') + '</span>' +
                        '<span>⚙️ ' + self._esc(it.params || '—') + '</span>' +
                        '<span>🏷 ' + self._esc(it.suggest_group || '未分组') + '</span>' +
                        '<span>' + self._statusBadge(it.status) + '</span>' +
                        '</div>' +
                        '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;word-break:break-all;">🔗 ' + self._esc(it.source_url) + '</div>' +
                        '</div>' +
                        (actBtn) + (traceBtn) +
                        '<button class="btn btn-sm btn-secondary" title="编辑识别结果" onclick="App._ccEditItem(' + it.id + ')">✏️</button>' +
                        '<button class="btn btn-sm btn-secondary" onclick="App._ccDelItem(' + it.id + ')">🗑</button>' +
                        '</div>';
                }).join('');
            }).catch(function () { var l = document.getElementById('ccItemList'); if (l) l.innerHTML = '<div style="color:#ef4444;">加载失败</div>'; });
        },

        _setFilter: function (k, v) {
            this._filter[k] = v;
            this._sel = {};
            this._renderItems(document.getElementById('ccBody'));
        },

        _toggleSel: function (id, on) {
            if (on) this._sel[id] = true; else delete this._sel[id];
        },

        _editItem: function (id) {
            var self = this;
            App.fetchJSON('/api/card-collect/items?status=&media_type=').then(function (d) {
                var items = (d && d.items) || [];
                var it = null;
                for (var i = 0; i < items.length; i++) { if (items[i].id === id) { it = items[i]; break; } }
                if (!it) { self._toast('未找到该预采集项', 'error'); return; }
                var ov = self._modal('');
                if (!ov) return;
                ov.querySelector('.modal-content').innerHTML =
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><b>✏️ 修正识别结果 #' + id + '</b>' +
                    '<button onclick="this.closest(\'.modal-overlay\').remove()" style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;">✕</button></div>' +
                    '<label style="font-size:12px;color:var(--text-muted);">提示词</label>' +
                    '<textarea id="ccEditPrompt" rows="4" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:8px;">' + self._esc(it.prompt) + '</textarea>' +
                    '<label style="font-size:12px;color:var(--text-muted);">生成模型</label>' +
                    '<input id="ccEditModel" value="' + self._esc(it.model) + '" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:8px;">' +
                    '<label style="font-size:12px;color:var(--text-muted);">参数</label>' +
                    '<input id="ccEditParams" value="' + self._esc(it.params) + '" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:8px;">' +
                    '<label style="font-size:12px;color:var(--text-muted);">归档分组（建议）</label>' +
                    '<input id="ccEditGroup" value="' + self._esc(it.suggest_group) + '" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:12px;">' +
                    '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
                    '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                    '<button class="btn btn-primary btn-sm" onclick="App._ccSaveEdit(' + id + ')">保存</button></div>';
            });
        },

        _saveEdit: function (id) {
            var self = this;
            var body = {
                prompt: (document.getElementById('ccEditPrompt') || {}).value || '',
                model: (document.getElementById('ccEditModel') || {}).value || '',
                params: (document.getElementById('ccEditParams') || {}).value || '',
                suggest_group: (document.getElementById('ccEditGroup') || {}).value || ''
            };
            App.fetchJSON('/api/card-collect/items/' + id, { method: 'PUT', body: JSON.stringify(body) }).then(function (d) {
                if (d && d.ok) {
                    self._toast('已保存', 'success');
                    var ov = document.querySelector('.modal-overlay');
                    if (ov && ov.querySelector('#ccEditPrompt')) ov.remove();
                    self._renderItems(document.getElementById('ccBody'));
                } else self._toast((d && d.error) || '保存失败', 'error');
            }).catch(function () { self._toast('保存失败', 'error'); });
        },

        _delItem: function (id) {
            var self = this;
            if (!confirm('删除该预采集项（含本地媒体文件）？')) return;
            App.fetchJSON('/api/card-collect/items/' + id, { method: 'DELETE' }).then(function (d) {
                if (d && d.ok) { self._toast('已删除', 'success'); self._renderItems(document.getElementById('ccBody')); }
            }).catch(function () { self._toast('删除失败', 'error'); });
        },

        // ============ 归档 ============
        _loadGroups: function (cb) {
            App.fetchJSON('/api/card-collect/groups').then(function (d) {
                cb((d && d.groups) || [], (d && d.suggest_groups) || []);
            }).catch(function () { cb([], []); });
        },

        _archiveOne: function (id) { this._archiveIds([id]); },

        _batchArchive: function () {
            var ids = Object.keys(this._sel).map(Number);
            if (!ids.length) { this._toast('请先勾选要归档的项', 'error'); return; }
            this._archiveIds(ids);
        },

        _archiveIds: function (ids) {
            var self = this;
            this._loadGroups(function (groups, suggests) {
                var ov = self._modal('');
                if (!ov) return;
                var opts = groups.map(function (g) { return '<option value="' + g.id + '">' + self._esc(g.name) + '</option>'; }).join('');
                var sugOpts = suggests.map(function (s) { return '<option value="__' + self._esc(s) + '">（建议）' + self._esc(s) + '</option>'; }).join('');
                ov.querySelector('.modal-content').innerHTML =
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><b>📥 归档建词卡（' + ids.length + ' 项）</b>' +
                    '<button onclick="this.closest(\'.modal-overlay\').remove()" style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;">✕</button></div>' +
                    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">选择归档分组：未选择时使用各项的自动识别建议分组（不存在则自动创建）</div>' +
                    '<select id="ccArcGroup" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:12px;">' +
                    '<option value="">（按各项自动建议分组）</option>' + sugOpts + opts + '</select>' +
                    '<div style="font-size:12px;color:#f59e0b;margin-bottom:12px;">归档后词卡将写入来源 URL，可随时「🔗 溯源」回溯到原始页面</div>' +
                    '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
                    '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                    '<button class="btn btn-primary btn-sm" onclick="App._ccDoArchive(' + JSON.stringify(ids) + ')">确认归档</button></div>';
            });
        },

        _doArchive: function (ids) {
            var self = this;
            var sel = document.getElementById('ccArcGroup');
            var payload = { ids: ids };
            if (sel && sel.value) {
                if (String(sel.value).indexOf('__') === 0) payload.group_name = String(sel.value).slice(2);
                else payload.group_id = parseInt(sel.value, 10);
            }
            App.fetchJSON('/api/card-collect/archive', { method: 'POST', body: JSON.stringify(payload) }).then(function (d) {
                if (d && d.ok) {
                    var n = (d.archived || []).length;
                    self._toast('归档成功 ' + n + ' 条' + ((d.errors || []).length ? '，失败 ' + d.errors.length + ' 条' : ''), n ? 'success' : 'error');
                    var ov = document.querySelector('.modal-overlay');
                    if (ov && ov.querySelector('#ccArcGroup')) ov.remove();
                    self._sel = {};
                    self._renderItems(document.getElementById('ccBody'));
                } else self._toast((d && d.error) || '归档失败', 'error');
            }).catch(function () { self._toast('归档失败', 'error'); });
        },

        // ============ 来源溯源 ============
        _trace: function (cardId) {
            var self = this;
            App.fetchJSON('/api/card-collect/trace/' + cardId).then(function (d) {
                if (!d || !d.ok) { self._toast('溯源失败', 'error'); return; }
                var ch = d.chain || {};
                var card = ch.card || {};
                var item = ch.item;
                var fav = ch.favorite;
                var ov = self._modal('');
                if (!ov) return;
                var rows = [
                    '<div><span style="color:#10b981;">🎴 词卡</span> #' + card.id + ' · ' + self._esc(card.name) + '</div>',
                    item ? '<div style="margin-top:6px;"><span style="color:#3b82f6;">🗂 预采集项</span> #' + item.id + ' · ' + self._esc(item.media_type === 'video' ? '视频' : '图片') + (item.prompt ? ' · ' + self._esc(String(item.prompt).slice(0, 60)) : '') + '</div>' : '',
                    fav ? '<div style="margin-top:6px;"><span style="color:#f59e0b;">📌 收藏记录</span> #' + fav.id + (fav.note ? ' · ' + self._esc(fav.note) : '') + ' · ' + self._esc(fav.created_at) + '</div>' : '',
                    '<div style="margin-top:6px;word-break:break-all;"><span style="color:#8b5cf6;">🔗 原始来源</span> <a href="' + self._esc(card.source || '') + '" target="_blank" rel="noopener">' + self._esc(card.source || '') + '</a></div>'
                ];
                ov.querySelector('.modal-content').innerHTML =
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><b>🔗 来源溯源</b>' +
                    '<button onclick="this.closest(\'.modal-overlay\').remove()" style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;">✕</button></div>' +
                    '<div style="font-size:13px;line-height:1.8;padding:10px;border:1px solid rgba(127,127,127,.15);border-radius:10px;">' + rows.join('') + '</div>';
            }).catch(function () { self._toast('溯源失败', 'error'); });
        },

        // ============ Tab3 采集任务 ============
        _renderTasks: function (body) {
            var self = this;
            body.innerHTML =
                '<div style="display:flex;align-items:center;margin-bottom:12px;gap:8px;">' +
                '<input id="ccDirectUrl" placeholder="直接输入地址发起采集（不走收藏）" style="flex:1;padding:8px 10px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;">' +
                '<button class="btn btn-sm btn-primary" onclick="App._ccDirectCollect()">🕷 采集</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="App._ccStopAll()">⏹ 停止全部</button>' +
                '</div>' +
                '<div id="ccTaskList" style="display:flex;flex-direction:column;gap:8px;">加载中…</div>';
            App.fetchJSON('/api/card-collect/tasks?limit=30').then(function (d) {
                var list = document.getElementById('ccTaskList');
                if (!list) return;
                var tasks = (d && d.items) || [];
                if (!tasks.length) { list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">暂无采集任务</div>'; return; }
                list.innerHTML = tasks.map(function (t) {
                    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(127,127,127,.15);border-radius:10px;">' +
                        '<div style="flex:1;min-width:0;">' +
                        '<div style="font-size:12px;color:var(--text-muted);word-break:break-all;">#' + t.id + ' · 🔗 ' + self._esc(t.url) + '</div>' +
                        '<div style="font-size:12px;margin-top:3px;">' + self._statusBadge(t.status) + ' · ' + self._esc(t.message || '') + (t.page_title ? ' · ' + self._esc(t.page_title) : '') + '</div>' +
                        (t.status === 'running' || t.status === 'queued' ? self._bar(t.progress) : '') +
                        '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + self._esc(t.created_at) + (t.finished_at ? ' → ' + self._esc(t.finished_at) : '') + (t.found_count ? ' · 入库 ' + t.found_count + ' 项' : '') + '</div>' +
                        '</div>' +
                        (t.status === 'running' || t.status === 'queued' ? '<button class="btn btn-sm btn-secondary" onclick="App._ccStopTask(' + t.id + ')">⏹ 停止</button>' : '') +
                        '</div>';
                }).join('');
            }).catch(function () { var l = document.getElementById('ccTaskList'); if (l) l.innerHTML = '<div style="color:#ef4444;">加载失败</div>'; });
        },

        _directCollect: function () {
            var url = (document.getElementById('ccDirectUrl') || {}).value || '';
            this._collectUrl(url);
        },

        _collectUrl: function (url) {
            var self = this;
            if (!/^https?:\/\//.test(url.trim())) { this._toast('请输入合法的 http/https 地址', 'error'); return; }
            App.fetchJSON('/api/card-collect/collect', { method: 'POST', body: JSON.stringify({ url: url.trim() }) }).then(function (d) {
                if (d && d.ok) { self._toast('采集任务 #' + d.task_id + ' 已启动', 'success'); self._renderTasks(document.getElementById('ccBody')); }
                else self._toast((d && d.error) || '启动失败', 'error');
            }).catch(function (e) { self._toast('启动失败: ' + (e && e.message ? e.message : ''), 'error'); });
        },

        _stopTask: function (id) {
            var self = this;
            App.fetchJSON('/api/card-collect/tasks/' + id + '/stop', { method: 'POST' }).then(function (d) {
                if (d && d.ok) self._toast('停止请求已发出', 'success');
            }).catch(function () {});
        },

        _stopAll: function () {
            var self = this;
            App.fetchJSON('/api/card-collect/stop', { method: 'POST' }).then(function (d) {
                self._toast('已停止 ' + ((d && d.stopped) || 0) + ' 个任务', 'success');
                self._renderTasks(document.getElementById('ccBody'));
            }).catch(function () {});
        },

        // ============ Tab4 灵感图库 ============
        _renderSites: function (body) {
            var self = this;
            body.innerHTML =
                '<div style="margin-bottom:10px;">' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<span style="font-size:12px;color:var(--text-muted);">灵感站点导航：点击「🔍 打开检索」在浏览器中浏览灵感页面</span>' +
                '<span style="flex:1;"></span>' +
                '<button class="btn btn-sm btn-primary" onclick="App._ccAddSite()">➕ 添加图库</button>' +
                '</div>' +
                '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">💡 已装浏览器扩展？直接一键回传；未装可按 README 加载：Chrome/Edge 开发者模式 → 加载已解压 → 选择项目 <code>extensions/mika-inspire-collect</code> 目录；或直接复制地址到「📥 URL收藏库」粘贴入库</div>' +
                '</div>' +
                '<div id="ccSiteGroupBar" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;"></div>' +
                '<div id="ccSiteList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">加载中…</div>';
            App.fetchJSON('/api/card-collect/sites').then(function (d) {
                var list = document.getElementById('ccSiteList');
                if (!list) return;
                var sites = (d && d.items) || [];
                self._siteAll = sites;
                self._siteGroupsCache = d.groups || [];
                self._renderSiteGroups(self._siteGroupsCache);
                self._renderSiteList(sites);
            }).catch(function () { var l = document.getElementById('ccSiteList'); if (l) l.innerHTML = '<div style="color:#ef4444;grid-column:1/-1;">加载失败</div>'; });
        },

        _renderSiteGroups: function (groups) {
            var self = this;
            var bar = document.getElementById('ccSiteGroupBar');
            if (!bar) return;
            var tabs = [['', '🌐 全部']].concat(groups.map(function (g) { return [g, g]; }));
            bar.innerHTML = tabs.map(function (t) {
                var act = self._siteGroup === t[0];
                return '<button class="btn btn-sm ' + (act ? 'btn-primary' : 'btn-secondary') + '" onclick="App._ccSiteGroup(\'' + self._esc(t[0]).replace(/'/g, "\\'") + '\')">' + self._esc(t[1]) + '</button>';
            }).join('');
        },

        _renderSiteList: function (sites) {
            var self = this;
            var list = document.getElementById('ccSiteList');
            if (!list) return;
            var g = this._siteGroup || '';
            var rows = g ? sites.filter(function (s) { return s.group_name === g; }) : sites;
            if (!rows.length) { list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;grid-column:1/-1;">该分组暂无站点 · 点击「➕ 添加图库」添加</div>'; return; }
            list.innerHTML = rows.map(function (s) {
                var logoHtml = s.logo
                    ? '<img src="/api/card-collect/sites/logo/' + self._esc(s.logo) + '" style="width:46px;height:46px;object-fit:cover;border-radius:10px;background:#f1f5f9;" alt="logo">'
                    : '<div style="width:46px;height:46px;border-radius:10px;background:rgba(127,127,127,.12);display:flex;align-items:center;justify-content:center;font-size:22px;">' + self._esc(s.icon_emoji || '🌐') + '</div>';
                var loginBadge = s.login_required ? '<span style="color:#f59e0b;font-size:10px;border:1px solid rgba(245,158,11,.4);border-radius:6px;padding:1px 5px;margin-left:6px;">🔒 需登录</span>' : '';
                var builtinBadge = s.is_builtin ? '<span style="color:#10b981;font-size:10px;border:1px solid rgba(16,185,129,.4);border-radius:6px;padding:1px 5px;margin-left:6px;">⭐ 内置</span>' : '';
                return '<div style="border:1px solid rgba(127,127,127,.15);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;">' +
                    '<div style="display:flex;gap:10px;align-items:center;">' + logoHtml +
                    '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:600;">' + self._esc(s.name) + loginBadge + builtinBadge + '</div>' +
                    '<div style="font-size:11px;color:var(--text-muted);word-break:break-all;">' + self._esc(s.url) + '</div></div>' +
                    '</div>' +
                    (s.description ? '<div style="font-size:12px;color:var(--text-muted);line-height:1.5;">' + self._esc(s.description) + '</div>' : '') +
                    (s.login_required ? '<div style="font-size:11px;color:#f59e0b;">⚠️ 该站点需登录，未登录状态下可能无法采集内容</div>' : '') +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                    '<button class="btn btn-sm btn-primary" onclick="App._ccOpenSite(' + s.id + ')">🔍 打开检索</button>' +
                    '<button class="btn btn-sm btn-secondary" title="替换品牌 logo" onclick="App._ccUploadLogo(' + s.id + ')">🖼 Logo</button>' +
                    '<button class="btn btn-sm btn-secondary" title="编辑" onclick="App._ccEditSite(' + s.id + ')">✏️</button>' +
                    (s.is_builtin ? '' : '<button class="btn btn-sm btn-secondary" onclick="App._ccDelSite(' + s.id + ')">🗑</button>') +
                    '</div></div>';
            }).join('');
        },

        _ccSiteGroup: function (g) { this._siteGroup = g; this._renderSiteGroups(this._siteGroupsCache || []); this._renderSiteList(this._siteAll || []); },

        _openSite: function (id) {
            var self = this;
            App.fetchJSON('/api/card-collect/sites').then(function (d) {
                var sites = (d && d.items) || [];
                for (var i = 0; i < sites.length; i++) {
                    if (sites[i].id === id) {
                        window.open(sites[i].url, '_blank', 'noopener');
                        if (sites[i].login_required) self._toast('已打开 ' + sites[i].name + '（需登录，未登录可能看不到内容，找到目标后复制地址回来采集）', 'info');
                        else self._toast('已打开 ' + sites[i].name + '，找到目标内容后复制地址回采集面板收藏/采集', 'info');
                        return;
                    }
                }
                self._toast('图库不存在', 'error');
            }).catch(function () { self._toast('打开失败', 'error'); });
        },

        _siteForm: function (site) {
            var self = this;
            var ov = this._modal('');
            var s = site || {};
            ov.querySelector('.modal-content').innerHTML =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><b>' + (site ? '✏️ 编辑图库' : '➕ 添加图库') + '</b>' +
                '<button onclick="this.closest(\'.modal-overlay\').remove()" style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;">✕</button></div>' +
                '<label style="font-size:12px;color:var(--text-muted);">名称 *</label>' +
                '<input id="ccSiteName" value="' + self._esc(s.name || '') + '" placeholder="如：LibLib 哩布哩布" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:8px;">' +
                '<label style="font-size:12px;color:var(--text-muted);">地址 *</label>' +
                '<input id="ccSiteUrl" value="' + self._esc(s.url || '') + '" placeholder="https://..." style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:8px;">' +
                '<label style="font-size:12px;color:var(--text-muted);">简介</label>' +
                '<textarea id="ccSiteDesc" rows="2" placeholder="简短介绍该图库的定位与内容" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:8px;">' + self._esc(s.description || '') + '</textarea>' +
                '<label style="font-size:12px;color:var(--text-muted);">图标（无 logo 时显示的 emoji）</label>' +
                '<input id="ccSiteEmoji" value="' + self._esc(s.icon_emoji || '🌐') + '" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:8px;">' +
                '<label style="font-size:12px;color:var(--text-muted);">分组</label>' +
                '<input id="ccSiteGroup" value="' + self._esc(s.group_name || '灵感图库') + '" placeholder="如：提示词站点 / 灵感图库 / 设计参考 / 素材榜单" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:8px;">' +
                '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted);margin-bottom:12px;cursor:pointer;">' +
                '<input type="checkbox" id="ccSiteLogin" ' + (s.login_required ? 'checked' : '') + '> 🔒 需登录（未登录状态下采集可能失败）</label>' +
                '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
                '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                '<button class="btn btn-primary btn-sm" onclick="App._ccSaveSite(' + (s.id || 0) + ')">保存</button></div>';
        },

        _addSite: function () { this._siteForm(null); },

        _editSite: function (id) {
            var self = this;
            App.fetchJSON('/api/card-collect/sites').then(function (d) {
                var sites = (d && d.items) || [];
                for (var i = 0; i < sites.length; i++) {
                    if (sites[i].id === id) { self._siteForm(sites[i]); return; }
                }
                self._toast('图库不存在', 'error');
            }).catch(function () { self._toast('加载失败', 'error'); });
        },

        _saveSite: function (id) {
            var self = this;
            var name = (document.getElementById('ccSiteName') || {}).value || '';
            var url = (document.getElementById('ccSiteUrl') || {}).value || '';
            var desc = (document.getElementById('ccSiteDesc') || {}).value || '';
            var emoji = (document.getElementById('ccSiteEmoji') || {}).value || '🌐';
            var groupName = (document.getElementById('ccSiteGroup') || {}).value || '灵感图库';
            var loginReq = !!(document.getElementById('ccSiteLogin') || {}).checked;
            if (!name.trim()) { this._toast('请输入图库名称', 'error'); return; }
            if (!/^https?:\/\//.test(url.trim())) { this._toast('请输入合法的 http/https 地址', 'error'); return; }
            var payload = { name: name.trim(), url: url.trim(), description: desc.trim(), icon_emoji: emoji.trim(), login_required: loginReq, group_name: groupName.trim() };
            var req = id
                ? App.fetchJSON('/api/card-collect/sites/' + id, { method: 'PUT', body: JSON.stringify(payload) })
                : App.fetchJSON('/api/card-collect/sites', { method: 'POST', body: JSON.stringify(payload) });
            req.then(function (d) {
                if (d && d.ok) {
                    self._toast('已保存', 'success');
                    var ov = document.querySelector('.modal-overlay');
                    if (ov && ov.querySelector('#ccSiteName')) ov.remove();
                    self._renderSites(document.getElementById('ccBody'));
                } else self._toast((d && d.error) || '保存失败', 'error');
            }).catch(function () { self._toast('保存失败', 'error'); });
        },

        _delSite: function (id) {
            var self = this;
            if (!confirm('删除该图库？')) return;
            App.fetchJSON('/api/card-collect/sites/' + id, { method: 'DELETE' }).then(function (d) {
                if (d && d.ok) { self._toast('已删除', 'success'); self._renderSites(document.getElementById('ccBody')); }
            }).catch(function () { self._toast('删除失败', 'error'); });
        },

        _uploadLogo: function (id) {
            var self = this;
            var inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
            inp.onchange = function () {
                var f = inp.files && inp.files[0];
                if (!f) return;
                if (f.size > 2 * 1024 * 1024) { self._toast('图片不能超过 2MB', 'error'); return; }
                var fd = new FormData();
                fd.append('file', f);
                fetch('/api/card-collect/sites/' + id + '/logo', { method: 'POST', body: fd })
                    .then(function (r) { return r.json(); })
                    .then(function (d) {
                        if (d && d.ok) { self._toast('Logo 已替换', 'success'); self._renderSites(document.getElementById('ccBody')); }
                        else self._toast((d && d.detail) || '上传失败', 'error');
                    })
                    .catch(function () { self._toast('上传失败', 'error'); });
            };
            inp.click();
        },

        // ============ 轮询 ============
        _poll: function () {
            var self = this;
            if (this._timer) clearInterval(this._timer);
            this._timer = setInterval(function () {
                var ov = document.getElementById('ccOverlay');
                if (!ov) { clearInterval(self._timer); self._timer = null; return; }
                if (self._tab === 'tasks') self._renderTasks(document.getElementById('ccBody'));
            }, 4000);
        }
    };

    // ============ 挂载到 App ============
    App.openCardCollect = function () { CC.open(); };

    // v5.42.19/22: 词库查看原图 → 取通用词卡媒体池（当前原图+生成历史+采集原图），查看器内自由切换
    App.openCardImageViewer = function (cardId, fallbackFile) {
        App.fetchJSON('/api/v4/word-cards/' + cardId + '/media-pool').then(function (d) {
            var imgs = (d && d.ok && d.images) || [];
            if (imgs.length >= 2) {
                App.openImageViewer(fallbackFile || imgs[0].url.split('/').pop(), cardId, imgs);
            } else {
                App.openImageViewer(fallbackFile, cardId);
            }
        }).catch(function () {
            App.openImageViewer(fallbackFile, cardId);
        });
    };

    // v5.42.22: 词库查看原视频 → 取通用词卡媒体池（当前预览+生成视频历史），查看器内自由切换
    App.openCardVideoViewer = function (cardId, fallbackFile, posterFile, fps) {
        App.fetchJSON('/api/v4/word-cards/' + cardId + '/media-pool').then(function (d) {
            var vids = (d && d.ok && d.videos) || [];
            if (vids.length >= 2) {
                App.openVideoViewer(fallbackFile, posterFile || '', cardId, fps || '', vids);
            } else {
                App.openVideoViewer(fallbackFile, posterFile || '', cardId, fps || '');
            }
        }).catch(function () {
            App.openVideoViewer(fallbackFile, cardId, posterFile || '', fps || '');
        });
    };


    // ============ v5.42.16: 词库卡片溯源按钮注入 ============
    // 包装 App.renderPrompts：渲染完成后，为采集录入的词卡（module=card_collect）
    // 在卡片操作区注入「🔗 溯源」按钮，点击调 trace API 打开来源网页
    (function _ccHookRender() {
        var boot = function () {
            if (!App || typeof App.renderPrompts !== 'function') { setTimeout(boot, 300); return; }
            var _orig = App.renderPrompts;
            App.renderPrompts = function () {
                var r = _orig.apply(this, arguments);
                setTimeout(function () { CC._injectTraceBtns(); }, 80);
                return r;
            };
        };
        boot();
    })();

    CC._injectTraceBtns = function () {
        var cards = document.querySelectorAll('#promptList .prompt-card[data-id]');
        cards.forEach(function (card) {
            if (card.querySelector('.cc-trace-btn')) return;
            var cid = parseInt(card.getAttribute('data-id'), 10);
            if (!cid) return;
            App.fetchJSON('/api/card-collect/trace/' + cid).then(function (d) {
                if (!d || !d.ok) return;
                var ch = d.chain || {};
                var cardData = ch.card || {};
                if (cardData.module !== 'card_collect' || !cardData.source) return;
                var actions = card.querySelector('.card-actions');
                if (!actions) return;
                var btn = document.createElement('button');
                btn.className = 'btn-copy cc-trace-btn';
                btn.style.cssText = 'border-color:#8b5cf6;color:#8b5cf6;';
                btn.innerHTML = '🔗 溯源';
                btn.onclick = function (e) {
                    e.stopPropagation();
                    window.open(cardData.source, '_blank', 'noopener');
                };
                actions.insertBefore(btn, actions.firstChild);
            }).catch(function () {});
        });
    };

    App._ccSwitchTab = function (t) { CC._switchTab(t); };
    App._ccAddFav = function () { CC._addFav(); };
    App._ccDelFav = function (id) { CC._delFav(id); };
    App._ccCollectFav = function (id) { CC._collectFav(id); };
App._ccFavPool = function (k) { CC._ccFavPool(k); };
App._ccFavSel = function (id, on) { CC._ccFavSel(id, on); };
App._ccFavSelAll = function (on) { CC._ccFavSelAll(on); };
App._ccFavAddUrls = function () { CC._ccFavAddUrls(); };
App._ccFavBatchStatus = function (s) { CC._ccFavBatchStatus(s); };
App._ccFavBatchDel = function () { CC._ccFavBatchDel(); };
App._ccFavBatchCollect = function () { CC._ccFavBatchCollect(); };
App._ccFavOpen = function (u) { CC._ccFavOpen(u); };
App._ccFavCopy = function (u) { CC._ccFavCopy(u); };
App._ccFavBatchClean = function () { CC._ccFavBatchClean(); };
App._ccFavCleanMark = function (w) { CC._ccFavCleanMark(w); };
App._ccFavRefetch = function (id) { CC._ccFavRefetch(id); };
App._ccFavConfirmIn = function () { CC._ccFavConfirmIn(); };
App._ccSiteGroup = function (g) { CC._ccSiteGroup(g); };
    App._ccSetFilter = function (k, v) { CC._setFilter(k, v); };
    App._ccToggleSel = function (id, on) { CC._toggleSel(id, on); };
    App._ccEditItem = function (id) { CC._editItem(id); };
    App._ccSaveEdit = function (id) { CC._saveEdit(id); };
    App._ccDelItem = function (id) { CC._delItem(id); };
    App._ccArchiveOne = function (id) { CC._archiveOne(id); };
    App._ccBatchArchive = function () { CC._batchArchive(); };
    App._ccDoArchive = function (ids) { CC._doArchive(ids); };
    App._ccTrace = function (cardId) { CC._trace(cardId); };
    App._ccDirectCollect = function () { CC._directCollect(); };
    App._ccStopTask = function (id) { CC._stopTask(id); };
    App._ccStopAll = function () { CC._stopAll(); };
    App._ccAddSite = function () { CC._addSite(); };
    App._ccEditSite = function (id) { CC._editSite(id); };
    App._ccSaveSite = function (id) { CC._saveSite(id); };
    App._ccDelSite = function (id) { CC._delSite(id); };
    App._ccOpenSite = function (id) { CC._openSite(id); };
    App._ccUploadLogo = function (id) { CC._uploadLogo(id); };
    App._stopCCPoll = function () { if (CC._timer) { clearInterval(CC._timer); CC._timer = null; } };
})();
