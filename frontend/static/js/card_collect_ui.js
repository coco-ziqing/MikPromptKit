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
            var m = { pending: ['📌 待采集', '#f59e0b'], collected: ['🕷 已采集', '#3b82f6'], archived: ['🗂 已归档', '#10b981'] };
            var b = m[s] || [s, '#94a3b8'];
            return '<span style="color:' + b[1] + ';font-size:11px;">' + b[0] + '</span>';
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
                '<div class="modal-content" style="max-width:920px;width:92vw;max-height:86vh;display:flex;flex-direction:column;border-radius:14px;">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(127,127,127,.15);">' +
                '<div style="font-size:15px;font-weight:600;">🕷 词卡采集 <span style="font-size:11px;color:var(--text-muted);font-weight:400;">公开内容采集 · 不登录 · 可中断 · 来源可溯源</span></div>' +
                '<button onclick="this.closest(\'.modal-overlay\').remove();App._stopCCPoll&&App._stopCCPoll();" style="border:none;background:none;font-size:18px;color:var(--text-muted);cursor:pointer;" title="关闭">✕</button>' +
                '</div>' +
                '<div style="display:flex;gap:6px;padding:10px 16px 0;border-bottom:1px solid rgba(127,127,127,.12);">' +
                '<button id="ccTabFav" class="btn btn-sm" onclick="App._ccSwitchTab(\'fav\')">📌 收藏夹</button>' +
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

        // ============ Tab1 收藏夹 ============
        _renderFav: function (body) {
            var self = this;
            body.innerHTML =
                '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
                '<input id="ccFavUrl" placeholder="粘贴灵感页面地址（AI 平台/公开图库/视频库）" style="flex:1;padding:8px 10px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;">' +
                '<input id="ccFavNote" placeholder="备注（可选）" style="width:180px;padding:8px 10px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;">' +
                '<button class="btn btn-primary btn-sm" onclick="App._ccAddFav()">📌 收藏</button>' +
                '</div>' +
                '<div id="ccFavList" style="display:flex;flex-direction:column;gap:8px;">加载中…</div>';
            App.fetchJSON('/api/card-collect/favorites').then(function (d) {
                var list = document.getElementById('ccFavList');
                if (!list) return;
                var items = (d && d.items) || [];
                if (!items.length) { list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">暂无收藏 · 粘贴地址收藏后即可发起采集</div>'; return; }
                list.innerHTML = items.map(function (f) {
                    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(127,127,127,.15);border-radius:10px;">' +
                        '<div style="flex:1;min-width:0;">' +
                        '<div style="font-size:13px;word-break:break-all;color:var(--text-muted);">🔗 ' + self._esc(f.url) + '</div>' +
                        (f.note ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">📝 ' + self._esc(f.note) + '</div>' : '') +
                        '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + self._favBadge(f.status) + ' · ' + self._esc(f.created_at) + '</div>' +
                        '</div>' +
                        '<button class="btn btn-sm btn-primary" onclick="App._ccCollectFav(' + f.id + ')" ' + (f.status === 'archived' ? 'disabled' : '') + '>🕷 采集</button>' +
                        '<button class="btn btn-sm btn-secondary" onclick="App._ccDelFav(' + f.id + ')">🗑</button>' +
                        '</div>';
                }).join('');
            }).catch(function () { var l = document.getElementById('ccFavList'); if (l) l.innerHTML = '<div style="color:#ef4444;">加载失败</div>'; });
        },

        _addFav: function () {
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
                var ov = this._modal('');
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
                var ov = this._modal('');
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
                var ov = this._modal('');
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
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
                '<span style="font-size:12px;color:var(--text-muted);">常用灵感图库快捷入口：点击「打开检索」在浏览器中手动查看，找到目标内容后复制地址回采集面板收藏/采集</span>' +
                '<span style="flex:1;"></span>' +
                '<button class="btn btn-sm btn-primary" onclick="App._ccAddSite()">➕ 添加图库</button>' +
                '</div>' +
                '<div id="ccSiteList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">加载中…</div>';
            App.fetchJSON('/api/card-collect/sites').then(function (d) {
                var list = document.getElementById('ccSiteList');
                if (!list) return;
                var sites = (d && d.items) || [];
                if (!sites.length) { list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;grid-column:1/-1;">暂无图库 · 点击「➕ 添加图库」添加常用灵感站点</div>'; return; }
                list.innerHTML = sites.map(function (s) {
                    var logoHtml = s.logo
                        ? '<img src="/api/card-collect/sites/logo/' + self._esc(s.logo) + '" style="width:46px;height:46px;object-fit:cover;border-radius:10px;background:#f1f5f9;" alt="logo">'
                        : '<div style="width:46px;height:46px;border-radius:10px;background:rgba(127,127,127,.12);display:flex;align-items:center;justify-content:center;font-size:22px;">' + self._esc(s.icon_emoji || '🌐') + '</div>';
                    return '<div style="border:1px solid rgba(127,127,127,.15);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;">' +
                        '<div style="display:flex;gap:10px;align-items:center;">' + logoHtml +
                        '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:600;">' + self._esc(s.name) + '</div>' +
                        '<div style="font-size:11px;color:var(--text-muted);word-break:break-all;">' + self._esc(s.url) + '</div></div>' +
                        '</div>' +
                        (s.description ? '<div style="font-size:12px;color:var(--text-muted);line-height:1.5;">' + self._esc(s.description) + '</div>' : '') +
                        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                        '<button class="btn btn-sm btn-primary" onclick="App._ccOpenSite(' + s.id + ')">🔍 打开检索</button>' +
                        '<button class="btn btn-sm btn-secondary" title="替换品牌 logo" onclick="App._ccUploadLogo(' + s.id + ')">🖼 Logo</button>' +
                        '<button class="btn btn-sm btn-secondary" title="编辑" onclick="App._ccEditSite(' + s.id + ')">✏️</button>' +
                        '<button class="btn btn-sm btn-secondary" onclick="App._ccDelSite(' + s.id + ')">🗑</button>' +
                        '</div></div>';
                }).join('');
            }).catch(function () { var l = document.getElementById('ccSiteList'); if (l) l.innerHTML = '<div style="color:#ef4444;grid-column:1/-1;">加载失败</div>'; });
        },

        _openSite: function (id) {
            var self = this;
            App.fetchJSON('/api/card-collect/sites').then(function (d) {
                var sites = (d && d.items) || [];
                for (var i = 0; i < sites.length; i++) {
                    if (sites[i].id === id) {
                        window.open(sites[i].url, '_blank', 'noopener');
                        self._toast('已打开 ' + sites[i].name + '，找到目标内容后复制地址回采集面板收藏/采集', 'info');
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
                '<input id="ccSiteEmoji" value="' + self._esc(s.icon_emoji || '🌐') + '" style="width:100%;padding:8px;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:transparent;color:inherit;margin-bottom:12px;">' +
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
            if (!name.trim()) { this._toast('请输入图库名称', 'error'); return; }
            if (!/^https?:\/\//.test(url.trim())) { this._toast('请输入合法的 http/https 地址', 'error'); return; }
            var payload = { name: name.trim(), url: url.trim(), description: desc.trim(), icon_emoji: emoji.trim() };
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
    App._ccSwitchTab = function (t) { CC._switchTab(t); };
    App._ccAddFav = function () { CC._addFav(); };
    App._ccDelFav = function (id) { CC._delFav(id); };
    App._ccCollectFav = function (id) { CC._collectFav(id); };
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
