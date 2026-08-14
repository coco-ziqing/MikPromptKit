// ================================================================
// v5.37.0: 词卡 AI 生成（高清/图生图/文生图/视频）+ 生成历史
// - 词卡卡片注入生成按钮（仅团队模式）
// - 生成产物自动归档为词卡生成历史，可切换当前预览
// - 批量生成（文生图/图生图/视频）· 任务面板 · 队列悬浮条
// 依赖：App.fetchJSON / App.showToast / App._escape
// ================================================================
(function () {
    'use strict';
    if (!App) return;
    var CG = {
        _teamActive: function () {
            return !!(App._activeTiers && App._activeTiers.team);
        },
        _vnames: { front: '正面', side: '侧面', back: '背面' },
        _tlabels: { upscale: '高清', image2image: '图生图', text2image: '文生图', text2video: '文生视频', image2video: '图生视频' },
        _icons: { upscale: '🔍', image2image: '🎨', text2image: '🖼', text2video: '🎬', image2video: '🎬' },
        _statusBadge: function (s) {
            var m = { queued: ['⏳ 排队中', '#94a3b8'], submitting: ['📤 提交中', '#f59e0b'],
                querying: ['🎨 生成中', '#3b82f6'], success: ['✅ 完成', '#10b981'], fail: ['❌ 失败', '#ef4444'] };
            var b = m[s] || [s, '#94a3b8'];
            return '<span style="color:' + b[1] + ';font-size:11px;">' + b[0] + '</span>';
        },
        _bar: function (pct) {
            return '<div style="height:3px;background:rgba(127,127,127,.15);border-radius:2px;margin-top:3px;overflow:hidden;"><div style="height:100%;width:' + Math.max(0, Math.min(100, pct || 0)) + '%;background:linear-gradient(90deg,#3b82f6,#10b981);transition:width .5s;"></div></div>';
        },
        _toast: function (msg, type) {
            if (App.showToast) App.showToast(msg, type || 'info');
        },
        // ============ 积分估算（v5.37.2） ============
        _credits: null,
        _loadCredits: function (force) {
            var self = this;
            if (this._credits && !force) return Promise.resolve(this._credits);
            return fetch('/api/card-gen/credits').then(function (r) { return r.json(); }).then(function (d) {
                self._credits = (d && d.ok) ? d : { balance: 0, video_rates: {}, image_cost: {} };
                return self._credits;
            }).catch(function () {
                self._credits = { balance: 0, video_rates: {}, image_cost: {} };
                return self._credits;
            });
        },
        _estCost: function (taskType, model, dur) {
            var c = this._credits || { video_rates: {}, image_cost: {} };
            if (taskType === 'upscale' || taskType === 'image2image' || taskType === 'text2image') {
                return (c.image_cost || {})[taskType] || 8;
            }
            var rate = (c.video_rates || {})[model] || 6;
            return Math.max(1, Math.round(rate * (dur || 5)));
        },
        _updateCost: function () {
            var el = document.getElementById('cgCost') || document.getElementById('cgBCost');
            if (!el) return;
            var m = document.getElementById('cgVModel') || document.getElementById('cgBVModel');
            var d = document.getElementById('cgVDur') || document.getElementById('cgBVDur');
            var isV = !!m;
            var cost = isV
                ? this._estCost('video', m.value, parseInt((d && d.value) || 5, 10))
                : this._estCost((this._curType || 'text2image'), '', 0);
            var bal = (this._credits || {}).balance;
            var warn = (bal > 0 && cost > bal);
            el.innerHTML = (isV ? '🎬 预计消耗 <b style="color:#f59e0b;">' + cost + '</b> 积分（' + m.value + ' × ' + (d ? d.value : '') + 's，本地实测校准）' : '🖼 预计消耗 <b style="color:#f59e0b;">' + cost + '</b> 积分') +
                (bal > 0 ? ' · 当前余额 <b>' + bal + '</b>' : '') +
                (warn ? '<span style="color:#ef4444;margin-left:6px;">⚠️ 余额不足</span>' : '');
        },
        _esc: function (s) {
            return App._escape ? App._escape(s || '') : String(s || '');
        },

        // ============ 卡片注入 ============
        _cardData: function (id) {
            var p = null;
            if (App.state && App.state.prompts) {
                for (var i = 0; i < App.state.prompts.length; i++) {
                    if (String(App.state.prompts[i].id) === String(id)) { p = App.state.prompts[i]; break; }
                }
            }
            if (!p && App.state && App.state.collectionItems) {
                for (var j = 0; j < App.state.collectionItems.length; j++) {
                    if (String(App.state.collectionItems[j].id) === String(id)) { p = App.state.collectionItems[j]; break; }
                }
            }
            return p;
        },
        inject: function () {
            if (!this._teamActive()) return;
            var self = this;
            var cards = document.querySelectorAll('#promptList .prompt-card, #collectionItemList .prompt-card');
            var ids = [];
            cards.forEach(function (c) { ids.push(c.getAttribute('data-id')); });
            var uniq = ids.filter(function (v, i) { return ids.indexOf(v) === i; });
            // 注入生成按钮
            cards.forEach(function (card) {
                if (card.querySelector('.cg-gen-btns')) return;
                var id = card.getAttribute('data-id');
                var p = self._cardData(id);
                var actions = card.querySelector('.card-actions');
                if (!actions || !p) return;
                var hasImg = !!(p.original_ref || p.thumbnail) && (!p.video_filename && p.media_type !== 'video');
                var btns = '';
                if (hasImg) btns += '<button class="btn-copy cg-btn" style="border-color:#f59e0b;color:#f59e0b;font-size:10px;padding:2px 7px;" onclick="event.stopPropagation();App.cardGen.openGen(' + id + ',\'upscale\')" title="AI 高清放大（消耗积分）">🔍 高清</button>';
                if (hasImg) btns += '<button class="btn-copy cg-btn" style="border-color:#8b5cf6;color:#8b5cf6;font-size:10px;padding:2px 7px;" onclick="event.stopPropagation();App.cardGen.openGen(' + id + ',\'image2image\')" title="以词卡原图为底图生成（消耗积分）">🎨 图生图</button>';
                btns += '<button class="btn-copy cg-btn" style="border-color:#10b981;color:#10b981;font-size:10px;padding:2px 7px;" onclick="event.stopPropagation();App.cardGen.openGen(' + id + ',\'text2image\')" title="以词卡提示词文生图（消耗积分）">🖼 文生图</button>';
                btns += '<button class="btn-copy cg-btn" style="border-color:#3b82f6;color:#3b82f6;font-size:10px;padding:2px 7px;" onclick="event.stopPropagation();App.cardGen.openGen(' + id + ',\'' + (hasImg ? 'image2video' : 'text2video') + '\')" title="生成视频（消耗积分）">🎬 视频</button>';
                var wrap = document.createElement('div');
                wrap.className = 'cg-gen-btns';
                wrap.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;';
                wrap.innerHTML = btns;
                actions.appendChild(wrap);
            });
            // 历史切换器（有成功产物时）
            if (uniq.length) this._injectHistorySwitchers(uniq);
        },
        _injectHistorySwitchers: function (ids) {
            var self = this;
            App.fetchJSON('/api/card-gen/history-summary?card_ids=' + ids.join(',')).then(function (d) {
                if (!d || !d.ok) return;
                var summaries = d.summaries || {};
                Object.keys(summaries).forEach(function (cid) {
                    var s = summaries[cid];
                    if (!s || !s.count) return;
                    var card = document.querySelector('#promptList .prompt-card[data-id="' + cid + '"], #collectionItemList .prompt-card[data-id="' + cid + '"]');
                    if (!card || card.querySelector('.cg-history-btn')) return;
                    var current = s.current || {};
                    var icon = current.media_type === 'video' ? '🎬' : '🖼';
                    // v5.37.7: 移到 card-add-row（下载按钮旁），避免与缩略图上的查看原视频按钮重叠
                    var row = card.querySelector('.card-add-row') || card.querySelector('.card-actions');
                    if (!row) return;
                    var btn = document.createElement('span');
                    btn.className = 'cg-history-btn';
                    btn.style.cssText = 'display:inline-flex;gap:3px;align-items:center;font-size:10px;padding:1px 7px;border-radius:9px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.5);color:#818cf8;cursor:pointer;margin-left:2px;user-select:none;';
                    // v5.37.12: 不直接显示数量，悬浮提示里展示（title 已有）
                    btn.innerHTML = icon;
                    btn.title = '生成历史 ' + s.count + ' 条，点击切换显示';
                    btn.onclick = function (e) {
                        e.stopPropagation();
                        self._openHistoryPicker(parseInt(cid, 10), btn);
                    };
                    // v5.37.11: 图片+视频都有时，收藏按钮后插「模式切换」按钮（缩略预览框直接切换）
                    if (s.img_count > 0 && s.vid_count > 0 && !card.querySelector('.cg-mode-btn')) {
                        var curType = (s.current && s.current.media_type) || '';
                        var modeBtn = document.createElement('span');
                        modeBtn.className = 'cg-mode-btn';
                        modeBtn.style.cssText = 'display:inline-flex;gap:3px;align-items:center;font-size:10px;padding:1px 7px;border-radius:9px;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.5);color:#10b981;cursor:pointer;margin-left:2px;user-select:none;';
                        modeBtn.innerHTML = curType === 'video' ? '🖼 图预览' : '🎬 视频预览';
                        modeBtn.title = '切换缩略预览模式（图片↔视频）';
                        modeBtn.onclick = function (e) {
                            e.stopPropagation();
                            self._toggleCardMode(parseInt(cid, 10));
                        };
                        // 收藏按钮（+）之后插入
                        var collectBtn = row.querySelector('.coll-add-btn[title*="收藏"]');
                        if (collectBtn) {
                            row.insertBefore(modeBtn, collectBtn.nextSibling);
                        } else {
                            row.insertBefore(modeBtn, btn);
                        }
                    }
                    // v5.37.9: 插入到「下载 ⬇」与「收藏 +」之间（下载按钮之前）
                    var dlBtn = row.querySelector('.coll-add-btn[title*="下载"]');
                    if (dlBtn) {
                        row.insertBefore(btn, dlBtn);
                    } else {
                        row.appendChild(btn);
                    }
                });
            }).catch(function () {});
        },
        _openHistoryPicker: function (cardId, anchor) {
            var self = this;
            App.fetchJSON('/api/card-gen/tasks?card_id=' + cardId + '&limit=20').then(function (d) {
                var tasks = (d && d.tasks || []).filter(function (t) { return t.status === 'success' && t.result_filename && t.task_type !== 'original'; });
                if (!tasks.length) return;
                var ov = document.createElement('div');
                ov.className = 'modal-overlay';
                ov.style.cssText = 'display:flex;z-index:900;background:rgba(0,0,0,.5);align-items:center;justify-content:center;';
                ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
                var h = '<div class="modal-content" style="max-width:560px;max-height:80vh;overflow-y:auto;border-radius:14px;padding:14px 16px;" onclick="event.stopPropagation()">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">🎬 生成历史（' + cardId + '）</span>' +
                    '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">点击产物切换词卡当前预览（原图文件保留，可随时切回）</div>';
                tasks.forEach(function (t) {
                    var cur = t.is_current ? '<span style="font-size:9px;background:#10b981;color:#fff;border-radius:8px;padding:1px 6px;margin-left:4px;">当前显示</span>' : '';
                    var origTag = t.task_type === 'original' ? '<span style="font-size:9px;color:#94a3b8;margin-left:4px;">（生成前保留的素材）</span>' : '';
                    var prev = t.media_type === 'video'
                        ? '<video src="/api/thumbnails/video/' + t.result_filename + '" style="width:84px;height:56px;object-fit:cover;border-radius:6px;" muted loop preload="metadata"></video>'
                        : '<img src="/api/thumbnails/file/' + t.result_filename + '" style="width:84px;height:56px;object-fit:cover;border-radius:6px;">';
                    var meta = (t.task_type_label || t.task_type) + (t.media_type === 'video' ? ' · ' + (t.duration || 5) + 's' : '') + ' · ' + (t.created_at || '').slice(0, 16);
                    h += '<div style="display:flex;gap:10px;align-items:center;padding:8px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:6px;' + (t.is_current ? 'border-color:#10b981;' : '') + '">' +
                        prev +
                        '<div style="flex:1;min-width:0;"><div style="font-size:12px;font-weight:600;">' + self._icons[t.task_type] + ' ' + meta + origTag + '</div>' +
                        '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + self._esc((t.prompt || '').slice(0, 60)) + '</div></div>' +
                        (t.is_current ? '' : '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#10b981;color:#10b981;" onclick="App.cardGen.activate(' + t.id + ',' + cardId + ',this)">设为当前</button>') +
                        '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;" onclick="App.cardGen.delTask(' + t.id + ',this)">🗑</button></div>';
                });
                h += '</div>';
                ov.innerHTML = h;
                document.body.appendChild(ov);
            }).catch(function () {});
        },
        // v5.37.11: 卡片预览模式切换（当前图片→切视频，当前视频→切图片）
        _toggleCardMode: async function (cardId) {
            var self = this;
            var d = await App.fetchJSON('/api/card-gen/tasks?card_id=' + cardId + '&limit=50');
            var tasks = (d && d.tasks || []).filter(function (t) { return t.status === 'success' && t.result_filename; });
            var cur = tasks.filter(function (t) { return t.is_current; });
            var curType = (cur[0] || {}).media_type;
            var target = curType === 'video' ? 'image' : 'video';
            // v5.38.12: 图片侧优先真实图片产物，无则 fallback 输入原图（恢复原图预览）
            var pick = tasks.filter(function (t) { return t.media_type === target && t.task_type !== 'original'; });
            if (!pick.length && target === 'image') {
                pick = tasks.filter(function (t) { return t.task_type === 'original'; });
            }
            if (!pick.length) { this._toast('无' + (target === 'video' ? '视频' : '图片') + '产物', 'warning'); return; }
            var curPick = pick.filter(function (t) { return t.is_current; });
            var t = (curPick[0] || pick[0]);
            var r = await App.fetchJSON('/api/card-gen/tasks/' + t.id + '/activate', { method: 'POST' });
            if (r && r.ok) {
                this._toast('✅ 已切换为' + (target === 'video' ? '视频' : '图片') + '预览', 'success');
                // v5.37.14: 局部更新缩略预览（不整页刷新）
                this._updateCardThumb(cardId, t);
            } else {
                this._toast((r && r.detail) || '切换未完成', 'error');
            }
        },
        // v5.37.14: 局部更新卡片缩略预览（图片↔视频）+ 查看按钮 + 模式按钮文字
        _updateCardThumb: function (cardId, task) {
            var card = document.querySelector('#promptList .prompt-card[data-id="' + cardId + '"], #collectionItemList .prompt-card[data-id="' + cardId + '"]');
            if (!card) return;
            var inner = card.querySelector('.card-thumb-inner');
            if (inner) {
                if (task.media_type === 'video') {
                    inner.innerHTML = '<div class="thumb-video-wrap-preview">' +
                        (task.poster_filename ? '<img class="thumb-video-poster" src="/api/thumbnails/file/' + task.poster_filename + '" alt="" loading="lazy">' : '<div class="thumb-placeholder thumb-video-placeholder"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21"/></svg></div>') +
                        '<div class="thumb-play-overlay"><svg viewBox="0 0 24 24"><polygon points="8,5 19,12 8,19"/></svg></div>' +
                        '<video class="thumb-video" src="/api/thumbnails/video/' + task.result_filename + '" loop muted playsinline preload="none" onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video></div>';
                } else {
                    inner.innerHTML = '<img src="/api/thumbnails/file/' + task.result_filename + '" alt="缩略图">';
                }
            }
            // 查看按钮（▶/🔍）同步更新
            var zb = card.querySelector('.thumb-zoom-btn');
            if (zb) {
                var openFn = task.media_type === 'video'
                    ? "event.stopPropagation();App.openVideoViewer('" + task.result_filename + "', '" + (task.poster_filename || '') + "', " + cardId + ", '')"
                    : "event.stopPropagation();App.openImageViewer('" + (task.result_original || task.result_filename) + "', " + cardId + ")";
                zb.textContent = task.media_type === 'video' ? '▶' : '🔍';
                zb.title = task.media_type === 'video' ? '查看原视频' : '查看原图';
                zb.setAttribute('onclick', openFn);
            }
            // 模式按钮文字同步
            var mb = card.querySelector('.cg-mode-btn');
            if (mb) mb.innerHTML = task.media_type === 'video' ? '🖼 图预览' : '🎬 视频预览';
            // 历史按钮图标同步
            var hb = card.querySelector('.cg-history-btn');
            if (hb) hb.innerHTML = task.media_type === 'video' ? '🎬' : '🖼';
            // v5.37.17: 局部更新后重新绑定 hover 播放（新 video 元素无事件）
            if (typeof App.bindVideoHover === 'function') {
                setTimeout(function () { App.bindVideoHover(); }, 100);
            }
        },
        activate: async function (taskId, cardId, btn) {
            var d = await App.fetchJSON('/api/card-gen/tasks/' + taskId + '/activate', { method: 'POST' });
            if (d && d.ok) {
                this._toast('✅ 已切换当前预览', 'success');
                if (btn) btn.closest('.modal-overlay').remove();
                if (App.state.currentGroupId || App.state.currentCollection) { App.loadPrompts ? App.loadPrompts() : null; }
                if (typeof App.loadCollectionItems === 'function' && App.state.currentCollection) App.loadCollectionItems();
            } else {
                this._toast((d && d.detail) || '切换未完成', 'error');
            }
        },
        delTask: async function (taskId, btn) {
            if (!confirm('删除此生成记录及其产物文件？')) return;
            var d = await App.fetchJSON('/api/card-gen/tasks/' + taskId, { method: 'DELETE' });
            if (d && d.ok) {
                this._toast('已删除', 'success');
                if (btn) btn.closest('.modal-overlay').remove();
            }
        },

        // ============ 单卡生成弹窗 ============
        _modal: function (html) {
            var ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.cssText = 'display:flex;z-index:900;background:rgba(0,0,0,.55);align-items:center;justify-content:center;';
            ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
            ov.innerHTML = '<div class="modal-content" style="max-width:520px;border-radius:14px;padding:16px;max-height:88vh;overflow-y:auto;" onclick="event.stopPropagation()">' + html + '</div>';
            document.body.appendChild(ov);
            return ov;
        },
        openGen: function (cardId, taskType) {
            var self = this;
            var p = this._cardData(cardId) || {};
            var hasImg = !!(p.original_ref || p.thumbnail) && p.media_type !== 'video';
            if (taskType === 'image2image' && !hasImg) { this._toast('该词卡无原图，请用文生图', 'error'); return; }
            var isV = taskType === 'text2video' || taskType === 'image2video';
            var isU = taskType === 'upscale';
            this._curCard = cardId;
            this._curType = taskType;
            var ov = this._modal('');
            ov.id = 'cgGen_' + taskType + '_' + cardId;
            ov.querySelector('.modal-content').innerHTML =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">' + this._icons[taskType] + ' ' + this._tlabels[taskType] + '生成</span>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>' +
                (hasImg ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">底图：词卡原图 <img src="/api/thumbnails/original/' + self._esc(p.original_ref || p.thumbnail) + '" style="width:44px;height:32px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-left:4px;"></div>' : '') +
                (isV ? this._videoParamsHtml(taskType) : (isU ? this._upscaleParamsHtml() : this._imgParamsHtml(taskType))) +
                '<div id="cgCost" style="font-size:11px;color:var(--text-muted);margin:6px 0;padding:6px 8px;background:rgba(245,158,11,.06);border:1px dashed rgba(245,158,11,.35);border-radius:8px;">计算中...</div>' +
                '<div style="font-size:10px;color:#f59e0b;margin:6px 0;">⚠️ 生成消耗即梦积分，提交后自动归档为词卡生成历史</div>' +
                '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
                '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                '<button class="btn btn-primary btn-sm" id="cgGo" onclick="App.cardGen.submit(\'' + ov.id + '\',' + cardId + ',\'' + taskType + '\')">🚀 提交生成</button></div>';
            ov.id = 'cgGen_' + taskType + '_' + cardId;
            // 加载积分费率并渲染成本行
            this._loadCredits().then(function () {
                self._updateCost();
            });
        },
        _sel: function (id, opts, cur) {
            var h = '<select id="' + id + '" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">';
            opts.forEach(function (o) {
                var v = typeof o === 'object' ? o.v : o;
                var l = typeof o === 'object' ? o.l : o;
                h += '<option value="' + v + '"' + (String(v) === String(cur || '') ? ' selected' : '') + '>' + l + '</option>';
            });
            return h + '</select>';
        },
        _upscaleParamsHtml: function () {
            return '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">参数</div>' +
                '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
                '<label style="font-size:11px;color:var(--text-muted);">分辨率 ' + this._sel('cgRes', ['2k', '4k', '8k'], '4k') + '</label></div>';
        },
        _imgParamsHtml: function (taskType) {
            return '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">参数</div>' +
                '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">' +
                '<label style="font-size:11px;color:var(--text-muted);">模型 ' + this._sel('cgModel', ['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '4.7', '5.0', '5.0Pro'], '5.0') + '</label>' +
                '<label style="font-size:11px;color:var(--text-muted);">比例 ' + this._sel('cgRatio', ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'], '1:1') + '</label>' +
                '<label style="font-size:11px;color:var(--text-muted);">分辨率 ' + this._sel('cgRes', ['1k', '2k', '4k'], '2k') + '</label></div>' +
                '<label style="font-size:11px;color:var(--text-muted);">提示词</label>' +
                '<textarea id="cgPrompt" style="width:100%;min-height:80px;margin-top:4px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;">' + this._esc((this._cardData(this._curCard) || {}).content || '') + '</textarea>';
        },
        // v5.37.0-fix: 视频模型→分辨率/时长联动（seedance2.5→480p/720p·4-30s；2.0_vip→720p/1080p/4k·4-15s；其他→720p·4-15s）
        _videoResOptions: function (model) {
            if (model === 'seedance2.5') return ['480p', '720p'];
            if (model === 'seedance2.0_vip') return ['720p', '1080p', '4k'];
            return ['720p'];
        },
        _videoDurOptions: function (model) {
            var opts = [];
            if (model === 'seedance1.5pro') {
                [5, 8, 10, 12].forEach(function (d) { opts.push({ v: d, l: d + 's' }); });
            } else {
                var max = model === 'seedance2.5' ? 30 : 15;
                [4, 5, 8, 10, 12, 15, 20, 25, 30].forEach(function (d) { if (d <= max) opts.push({ v: d, l: d + 's' }); });
            }
            return opts;
        },
        _videoModelChanged: function (sel) {
            var model = sel.value;
            var resSel = document.getElementById(sel.id.replace('cgVModel', 'cgVRes').replace('cgBVModel', 'cgBVRes'));
            var durSel = document.getElementById(sel.id.replace('cgVModel', 'cgVDur').replace('cgBVModel', 'cgBVDur'));
            if (resSel) {
                var cur = resSel.value;
                var opts = this._videoResOptions(model);
                resSel.innerHTML = '';
                opts.forEach(function (v) {
                    var o = document.createElement('option');
                    o.value = v; o.textContent = v;
                    resSel.appendChild(o);
                });
                if (opts.indexOf(cur) < 0) resSel.value = opts[opts.length - 1];
            }
            if (durSel) {
                var curD = durSel.value;
                var optsD = this._videoDurOptions(model);
                durSel.innerHTML = '';
                optsD.forEach(function (o) {
                    var oo = document.createElement('option');
                    oo.value = o.v; oo.textContent = o.l;
                    durSel.appendChild(oo);
                });
                if (!optsD.some(function (o) { return String(o.v) === String(curD); })) durSel.value = '5';
            }
            this._updateCost();
        },
        _videoDurChanged: function (sel) {
            this._updateCost();
        },
        _videoParamsHtml: function (taskType) {
            return '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">参数</div>' +
                '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">' +
                '<label style="font-size:11px;color:var(--text-muted);">模型 <select id="cgVModel" onchange="App.cardGen._videoModelChanged(this)" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                ['seedance2.0_vip', 'seedance2.0', 'seedance2.0fast', 'seedance2.0fast_vip', 'seedance2.0mini', 'seedance1.5pro', 'seedance2.5'].map(function (m) { return '<option value="' + m + '"' + (m === 'seedance2.0_vip' ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></label>' +
                                '<label style="font-size:11px;color:var(--text-muted);">时长 <select id="cgVDur" onchange="App.cardGen._videoDurChanged(this)" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                this._videoDurOptions('seedance2.0_vip').map(function (o) { return '<option value="' + o.v + '"' + (o.v === 5 ? ' selected' : '') + '>' + o.l + '</option>'; }).join('') + '</select></label>' +
                '<label style="font-size:11px;color:var(--text-muted);">分辨率 <select id="cgVRes" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                this._videoResOptions('seedance2.0_vip').map(function (v) { return '<option value="' + v + '"' + (v === '720p' ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></label>' +
                (taskType === 'text2video' ? '<label style="font-size:11px;color:var(--text-muted);">比例 ' + this._sel('cgVRatio', ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], '16:9') + '</label>' : '') +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:6px;margin-top:8px;">' +
                '<label style="font-size:11px;color:var(--text-muted);">提示词</label>' +
                '<span style="display:flex;gap:2px;border:1px solid var(--border-color);border-radius:8px;padding:1px;margin-left:auto;">' +
                '<button type="button" id="cgTierStd" class="cwl-logview-btn active" onclick="App.cardGen._setPromptTier(\'standard\')" style="font-size:10px;">📄 标准</button>' +
                '<button type="button" id="cgTierDet" class="cwl-logview-btn" onclick="App.cardGen._setPromptTier(\'detailed\')" style="font-size:10px;">📚 详细</button>' +
                '</span></div>' +
                '<textarea id="cgPrompt" style="width:100%;min-height:80px;margin-top:4px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;">' + this._esc((this._cardData(this._curCard) || {}).content || '') + '</textarea>';
        },
        // v5.37.13: 提示词档位切换（标准/详细）
        _setPromptTier: function (tier) {
            var p = this._cardData(this._curCard) || {};
            var val = tier === 'detailed' ? (p.content_detailed || p.content || '') : (p.content || '');
            var ta = document.getElementById('cgPrompt');
            if (ta) ta.value = val;
            var b1 = document.getElementById('cgTierStd');
            var b2 = document.getElementById('cgTierDet');
            if (b1) b1.classList.toggle('active', tier === 'standard');
            if (b2) b2.classList.toggle('active', tier === 'detailed');
        },
        submit: async function (ovId, cardId, taskType) {
            var ov = document.getElementById(ovId) || document.querySelector('.modal-overlay');
            var params = {};
            var isV = taskType === 'text2video' || taskType === 'image2video';
            var isU = taskType === 'upscale';
            var promptEl = ov ? ov.querySelector('#cgPrompt') : null;
            if (promptEl) params.prompt = promptEl.value.trim();
            if (isU) params.resolution_type = ov.querySelector('#cgRes').value;
            else if (isV) {
                params.model_version = ov.querySelector('#cgVModel').value;
                params.duration = parseInt(ov.querySelector('#cgVDur').value, 10);
                params.video_resolution = ov.querySelector('#cgVRes').value;
                if (taskType === 'text2video') params.ratio = ov.querySelector('#cgVRatio').value;
            } else {
                params.model_version = ov.querySelector('#cgModel').value;
                params.ratio = ov.querySelector('#cgRatio').value;
                params.resolution_type = ov.querySelector('#cgRes').value;
            }
            var go = ov.querySelector('#cgGo');
            if (go) { go.disabled = true; go.textContent = '⏳ 提交中...'; }
            // 裸 fetch（auth_client 全局拦截器自动带 token）；fetchJSON 非 2xx 返 null 会丢 detail
            var res = await fetch('/api/card-gen/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ card_id: cardId, task_type: taskType, params: params })
            });
            var d = null;
            try { d = await res.json(); } catch (e) {}
            if (res.ok && d && d.ok) {
                this._toast('🚀 已入队，生成完成自动设为当前预览', 'success');
                if (ov) ov.remove();
                this._ensureQueueBar();
            } else {
                this._toast((d && d.detail) || '提交未完成 (HTTP ' + res.status + ')', 'error');
                if (go) { go.disabled = false; go.textContent = '🚀 提交生成'; }
            }
        },

        // ============ 批量生成弹窗 ============
        openBatch: function (ids) {
            var self = this;
            if (!ids || !ids.length) { this._toast('请先勾选词卡', 'error'); return; }
            var ov = this._modal('');
            ov.querySelector('.modal-content').innerHTML =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">🚀 AI 批量生成 <span style="font-size:11px;color:var(--text-muted);">(' + ids.length + ' 张)</span></span>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>' +
                '<div style="display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;">' +
                '<button class="cwl-logview-btn active" id="cgBMode_t2i" onclick="App.cardGen._batchMode(\'text2image\')">🖼 文生图</button>' +
                '<button class="cwl-logview-btn" id="cgBMode_i2i" onclick="App.cardGen._batchMode(\'image2image\')">🎨 图生图</button>' +
                '<button class="cwl-logview-btn" id="cgBMode_t2v" onclick="App.cardGen._batchMode(\'text2video\')">🎬 视频</button></div>' +
                '<div id="cgBParams"></div>' +
                '<div id="cgBCost" style="font-size:11px;color:var(--text-muted);margin:6px 0;padding:6px 8px;background:rgba(245,158,11,.06);border:1px dashed rgba(245,158,11,.35);border-radius:8px;">计算中...</div>' +
                '<div style="font-size:10px;color:#f59e0b;margin:6px 0;">⚠️ 每张卡一条生成任务，消耗即梦积分；无原图词卡在图生图模式下自动跳过</div>' +
                '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
                '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                '<button class="btn btn-primary btn-sm" onclick="App.cardGen._batchSubmit(' + ids.join(',') + ')">🚀 批量入队</button></div>';
            this._batchIds = ids;
            this._batchMode('text2image');
        },
        _batchMode: function (mode) {
            this._batchModeType = mode;
            ['t2i', 'i2i', 't2v'].forEach(function (k) {
                var el = document.getElementById('cgBMode_' + k);
                if (el) el.classList.toggle('active', (k === 't2i' && mode === 'text2image') || (k === 'i2i' && mode === 'image2image') || (k === 't2v' && mode === 'text2video'));
            });
            var box = document.getElementById('cgBParams');
            if (!box) return;
            var h = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">';            if (mode === 'text2image') {
                h += '<label style="font-size:11px;color:var(--text-muted);">模型 ' + this._sel('cgBModel', ['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '4.7', '5.0', '5.0Pro'], '5.0') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">比例 ' + this._sel('cgBRatio', ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'], '1:1') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">分辨率 ' + this._sel('cgBRes', ['1k', '2k', '4k'], '2k') + '</label>';
            } else if (mode === 'image2image') {
                h += '<label style="font-size:11px;color:var(--text-muted);">模型 ' + this._sel('cgBModel', ['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '4.7', '5.0', '5.0Pro'], '5.0') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">比例 ' + this._sel('cgBRatio', ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'], '1:1') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">分辨率 ' + this._sel('cgBRes', ['1k', '2k', '4k'], '2k') + '</label>' +
                    '<span style="font-size:10px;color:var(--text-muted);">（无原图词卡跳过）</span>';
            } else {
                h += '<label style="font-size:11px;color:var(--text-muted);">模型 <select id="cgBVModel" onchange="App.cardGen._videoModelChanged(this)" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                    ['seedance2.0_vip', 'seedance2.0', 'seedance2.0fast', 'seedance2.0fast_vip', 'seedance2.0mini', 'seedance1.5pro', 'seedance2.5'].map(function (m) { return '<option value="' + m + '"' + (m === 'seedance2.0_vip' ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">时长 <select id="cgBVDur" onchange="App.cardGen._videoDurChanged(this)" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                    this._videoDurOptions('seedance2.0_vip').map(function (o) { return '<option value="' + o.v + '"' + (o.v === 5 ? ' selected' : '') + '>' + o.l + '</option>'; }).join('') + '</select></label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">分辨率 <select id="cgBVRes" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                    this._videoResOptions('seedance2.0_vip').map(function (v) { return '<option value="' + v + '"' + (v === '720p' ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">比例 ' + this._sel('cgBVRatio', ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], '16:9') + '</label>';
            }
            h += '</div>' + (mode === 'text2image' ? '' : '') +
                (mode === 'image2image' || mode === 'text2video' ? '<label style="font-size:11px;color:var(--text-muted);">提示词（留空=用各词卡内容）</label><textarea id="cgBPrompt" style="width:100%;min-height:60px;margin-top:4px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;" placeholder="留空则逐卡使用词卡内容"></textarea>' : '');
            box.innerHTML = h;
            this._loadCredits().then(function () { self._updateCost(); });
        },
        _batchSubmit: async function () {
            var ids = Array.prototype.slice.call(arguments);
            var mode = this._batchModeType || 'text2image';
            var ov = document.querySelector('.modal-overlay');
            var params = {};
            var promptEl = ov ? ov.querySelector('#cgBPrompt') : null;
            if (promptEl && promptEl.value.trim()) params.prompt = promptEl.value.trim();
            if (mode === 'text2image' || mode === 'image2image') {
                params.model_version = ov.querySelector('#cgBModel').value;
                params.ratio = ov.querySelector('#cgBRatio').value;
                params.resolution_type = ov.querySelector('#cgBRes').value;
            } else {
                params.model_version = ov.querySelector('#cgBVModel').value;
                params.duration = parseInt(ov.querySelector('#cgBVDur').value, 10);
                params.video_resolution = ov.querySelector('#cgBVRes').value;
                params.ratio = ov.querySelector('#cgBVRatio').value;
            }
            var d = await App.fetchJSON('/api/card-gen/batch', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ card_ids: ids, task_type: mode, params: params })
            });
            if (d && d.ok) {
                this._toast('🚀 已入队 ' + d.count + ' 条生成任务', 'success');
                if (ov) ov.remove();
                this._ensureQueueBar();
            } else {
                var detail = d && d.detail;
                this._toast(detail || '批量提交未完成', 'error');
            }
        },

        // ============ 详情弹窗生成历史区 ============
        loadDetailHistory: function (cardId) {
            var self = this;
            App.fetchJSON('/api/card-gen/tasks?card_id=' + cardId + '&limit=20').then(function (d) {
                var box = document.getElementById('cgDetailHistory');
                if (!box) return;
                var tasks = (d && d.tasks || []).filter(function (t) { return t.status === 'success' && t.result_filename && t.task_type !== 'original'; });
                if (!tasks.length) { box.innerHTML = '<span style="color:#94a3b8;">暂无 AI 生成记录</span>'; return; }
                var h = '';
                tasks.forEach(function (t) {
                    var prev = t.media_type === 'video'
                        ? '<video src="/api/thumbnails/video/' + t.result_filename + '" style="width:64px;height:44px;object-fit:cover;border-radius:6px;" muted loop preload="metadata"></video>'
                        : '<img src="/api/thumbnails/file/' + t.result_filename + '" style="width:64px;height:44px;object-fit:cover;border-radius:6px;">';
                    var meta = self._icons[t.task_type] + ' ' + (t.task_type_label || t.task_type) + ' · ' + (t.created_at || '').slice(0, 16);
                    h += '<div style="display:flex;gap:8px;align-items:center;padding:6px;border:1px solid ' + (t.is_current ? '#10b981' : 'var(--border-color)') + ';border-radius:8px;margin-bottom:5px;">' +
                        prev + '<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:600;">' + meta + '</div>' +
                        '<div style="font-size:10px;color:#94a3b8;">' + (t.is_current ? '✅ 当前显示' : '') + '</div></div>' +
                        (t.is_current ? '' : '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#10b981;color:#10b981;" onclick="App.cardGen.activate(' + t.id + ',' + cardId + ',null)">设为当前</button>') +
                        '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;" onclick="App.cardGen.delTask(' + t.id + ',null)">🗑</button></div>';
                });
                box.innerHTML = h;
            }).catch(function () {
                var box = document.getElementById('cgDetailHistory');
                if (box) box.innerHTML = '<span style="color:#94a3b8;">加载未完成</span>';
            });
        },

        // 刷新当前词卡列表（任务完成后缩略预览框自动载入新产物）
        _refreshCardList: function () {
            try {
                var st = App.state || {};
                // 仅词库/收藏夹视图刷新（其他视图无害但无意义）
                if (st.currentView !== 'home' && st.currentView !== 'collections') return;
                if (st.currentGroupId && typeof App.loadPrompts === 'function') {
                    App.loadPrompts();
                } else if (st.currentCollection && typeof App.loadCollectionItems === 'function') {
                    App.loadCollectionItems();
                } else if (typeof App.loadPrompts === 'function') {
                    App.loadPrompts();
                }
            } catch (e) {}
        },

        // ============ 任务面板 + 队列悬浮条 ============
        openPanel: function () {
            var self = this;
            var ov = this._modal('');
            ov.querySelector('.modal-content').style.maxWidth = '760px';
            ov.querySelector('.modal-content').innerHTML =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">📊 生成任务队列</span>' +
                '<span style="display:flex;gap:6px;"><button class="btn btn-xs btn-outline" onclick="App.cardGen.openPanel()">🔄 刷新</button>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></span></div>' +
                '<div id="cgPanelBody" style="min-height:120px;">加载中...</div>';
            this._panelOv = ov;
            this._pollPanel();
        },
        _pollPanel: function () {
            var self = this;
            if (!this._panelOv || !document.body.contains(this._panelOv)) return;
            App.fetchJSON('/api/card-gen/tasks?limit=60').then(function (d) {
                var tasks = (d && d.tasks || []).filter(function (t) { return t.task_type !== 'original'; });
                // v5.37.4: 新完成的任务 → 刷新词卡列表（缩略预览框自动载入产物）
                self._seenDone = self._seenDone || {};
                var newDone = tasks.filter(function (t) { return t.status === 'success' && !self._seenDone[t.id]; });
                tasks.forEach(function (t) { if (t.status === 'success') self._seenDone[t.id] = 1; });
                if (newDone.length) self._refreshCardList();
                var box = self._panelOv.querySelector('#cgPanelBody');
                if (!box) return;
                var act = tasks.filter(function (t) { return t.status !== 'success' && t.status !== 'fail'; });
                var okc = tasks.filter(function (t) { return t.status === 'success'; }).length;
                var fai = tasks.filter(function (t) { return t.status === 'fail'; }).length;
                var h = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">进行中 ' + act.length + ' · 成功 ' + okc + ' · 失败 ' + fai +
                    '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;margin-left:8px;" onclick="App.cardGen.clearAll()" title="清空全部生成记录（成功/失败；正在进行的保留）">🧹 清空生成记录</button></div>';
                if (!tasks.length) h += '<div style="color:var(--text-muted);font-size:12px;padding:20px;text-align:center;">暂无任务</div>';
                tasks.forEach(function (t) {
                    var prev = '';
                    if (t.status === 'success' && t.result_filename) {
                        var openFn = t.media_type === 'video'
                            ? 'App.openVideoViewer(\'' + t.result_filename + '\',' + t.card_id + ')'
                            : 'App.openImageViewer(\'' + (t.result_original || t.result_filename) + '\',' + t.card_id + ')';
                        prev = t.media_type === 'video'
                            ? '<video src="/api/thumbnails/video/' + t.result_filename + '" style="width:72px;height:46px;object-fit:cover;border-radius:6px;cursor:pointer;" muted loop preload="metadata" title="点击查看原视频" onclick="' + openFn + '"></video>'
                            : '<img src="/api/thumbnails/file/' + t.result_filename + '" style="width:72px;height:46px;object-fit:cover;border-radius:6px;cursor:pointer;" title="点击查看原图" onclick="' + openFn + '">';
                    }
                    h += '<div style="display:flex;gap:10px;align-items:center;padding:7px 8px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:6px;">' +
                        (prev || '<div style="width:72px;height:46px;display:flex;align-items:center;justify-content:center;font-size:20px;background:rgba(127,127,127,.08);border-radius:6px;">' + (self._icons[t.task_type] || '🎨') + '</div>') +
                        '<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:600;">' + self._esc(t.card_name || '词卡#' + t.card_id) + ' · ' + (t.task_type_label || t.task_type) + '</div>' +
                        '<div style="margin-top:3px;">' + self._statusBadge(t.status) + (t.progress && t.status === 'querying' ? ' ' + t.progress + '%' : '') + self._bar(t.status === 'querying' ? t.progress : (t.status === 'success' ? 100 : 0)) +
                        (t.error ? '<div style="font-size:10px;color:#ef4444;margin-top:2px;">' + self._esc(t.error) + '</div>' : '') + '</div></div>' +
                        (t.status === 'success' ? (t.is_current ? '<span style="font-size:9px;color:#10b981;">当前显示</span>' : '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#10b981;color:#10b981;" onclick="App.cardGen.activate(' + t.id + ',' + t.card_id + ',null)">设为当前</button>') : '') +
                        (App.vjshi && App.vjshi.submitBtnHtml ? App.vjshi.submitBtnHtml(t) : '') +
                        (t.status === 'fail' ? '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;" onclick="App.cardGen.retry(' + t.id + ')">🔄 重试</button>' : '') +
                        (t.status === 'success' || t.status === 'fail' ? '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#8b5cf6;color:#8b5cf6;" onclick="App.cardGen.regen(' + t.id + ')" title="用相同参数再次生成">♻ 重新生成</button>' : '') +
                        '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#3b82f6;color:#3b82f6;" onclick="App.cardGen.locateCard(' + t.card_id + ',' + (t.group_id || 0) + ')" title="在词库中定位到此词卡">📍 词卡</button>' +
                        // v5.38.8: 成功/失败记录均可单独删除
                        (t.status === 'success' || t.status === 'fail' ? '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;" onclick="App.cardGen.delTask(' + t.id + ',null)" title="删除此记录">🗑</button>' : '') +
                        '</div>';
                });
                box.innerHTML = h;
                if (act.length) setTimeout(function () { self._pollPanel(); }, 8000);
            }).catch(function () { setTimeout(function () { self._pollPanel(); }, 8000); });
        },
        retry: async function (tid) {
            var d = await App.fetchJSON('/api/card-gen/tasks/' + tid + '/retry', { method: 'POST' });
            if (d && d.ok) { this._toast('🔄 已重新入队', 'success'); this.openPanel(); }
            else this._toast((d && d.detail) || '重试未完成', 'error');
        },
        // v5.37.5: 重生（同参数再次生成）/ 清空记录 / 词卡定位
        regen: async function (tid) {
            var d = await App.fetchJSON('/api/card-gen/tasks/' + tid + '/regen', { method: 'POST' });
            if (d && d.ok) { this._toast('♻ 已重新入队（同参数）', 'success'); this._ensureQueueBar(); }
            else this._toast((d && d.detail) || '重生未完成', 'error');
        },
        clearAll: async function () {
            if (!confirm('清空全部生成记录？（成功/失败记录及其产物文件将删除，词卡当前预览引用的文件保留；正在进行的任务不受影响）')) return;
            var d = await App.fetchJSON('/api/card-gen/tasks?clear=1', { method: 'DELETE' });
            if (d && d.ok) {
                this._toast('🧹 已清空 ' + (d.cleared || 0) + ' 条记录', 'success');
                this.openPanel();
            } else {
                this._toast((d && d.detail) || '清空未完成', 'error');
            }
        },
        locateCard: async function (cardId, groupId) {
            var self = this;
            try {
                if (App.state && App.state.currentGroupId !== groupId && groupId && typeof App.switchGroup === 'function') {
                    await App.switchGroup(groupId, '');
                } else if (typeof App.loadPrompts === 'function') {
                    await App.loadPrompts();
                }
                var tries = 0;
                var timer = setInterval(function () {
                    tries++;
                    var card = document.querySelector('#promptList .prompt-card[data-id="' + cardId + '"], #collectionItemList .prompt-card[data-id="' + cardId + '"]');
                    if (card) {
                        clearInterval(timer);
                        try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { card.scrollIntoView(); }
                        card.style.boxShadow = '0 0 0 3px #6366f1, 0 0 18px rgba(99,102,241,.6)';
                        card.style.transition = 'box-shadow .8s';
                        setTimeout(function () { card.style.boxShadow = ''; }, 2600);
                        self._toast('📍 已定位到词卡', 'success');
                    } else if (tries > 30) {
                        clearInterval(timer);
                        self._toast('未找到该词卡（可能不在当前视图）', 'warning');
                    }
                }, 300);
            } catch (e) {
                this._toast('定位未完成: ' + e.message, 'error');
            }
        },

        // ============ 队列悬浮条（右下角，3s 轮询） ============
        // v5.37.10: 页面加载时检测活动任务 → 恢复悬浮条轮询（刷新页面后仍能自动刷新词卡）
        _checkActiveTasks: function () {
            var self = this;
            App.fetchJSON('/api/card-gen/tasks?active=1&limit=10').then(function (d) {
                var ts = (d && d.tasks) || [];
                if (ts.length) self._ensureQueueBar();
            }).catch(function () {});
        },
        _ensureQueueBar: function () {
            var self = this;
            if (this._qBar) return;
            var bar = document.createElement('div');
            bar.id = 'cgQueueBar';
            bar.style.cssText = 'position:fixed;right:14px;bottom:44px;z-index:799;display:none;align-items:center;gap:8px;padding:5px 12px;border-radius:20px;background:var(--bg-card,#1e293b);border:1px solid #8b5cf6;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer;font-size:11px;color:var(--text-main);';
            bar.innerHTML = '<span style="font-weight:600;">🎬 生成队列</span><span id="cgQStats"></span>';
            bar.onclick = function () { self.openPanel(); };
            document.body.appendChild(bar);
            this._qBar = bar;
            var tick = function () {
                App.fetchJSON('/api/card-gen/tasks?limit=60').then(function (d) {
                    var ts = (d && d.tasks) || [];
                    // v5.37.10: 面板关闭时也检测新完成任务 → 自动刷新词卡显示
                    self._seenDone = self._seenDone || {};
                    var newDone = ts.filter(function (t) { return t.status === 'success' && !self._seenDone[t.id]; });
                    ts.forEach(function (t) { if (t.status === 'success') self._seenDone[t.id] = 1; });
                    if (newDone.length) self._refreshCardList();
                    var act = ts.filter(function (t) { return t.status === 'queued' || t.status === 'submitting' || t.status === 'querying'; });
                    var st = document.getElementById('cgQStats');
                    if (!act.length) { bar.style.display = 'none'; return; }
                    var run = act.filter(function (t) { return t.status === 'querying' || t.status === 'submitting'; }).length;
                    var que = act.filter(function (t) { return t.status === 'queued'; }).length;
                    bar.style.display = 'flex';
                    if (st) st.textContent = '· 运行 ' + run + ' · 排队 ' + que;
                }).catch(function () {});
            };
            tick();
            this._qTimer = setInterval(tick, 3000);
        }
    };
    App.cardGen = CG;

    // ============ 渲染后注入（hook 主网格 + 收藏夹网格 + 语义搜索） ============
    var hook = function (fn, owner) {
        return function () {
            var r = fn.apply(owner || this, arguments);
            try { if (App.cardGen) App.cardGen.inject(); } catch (e) {}
            return r;
        };
    };
    var tryHook = function (name) {
        if (typeof App[name] === 'function') {
            App[name] = hook(App[name], App);
        }
    };
    // MutationObserver 兜底：覆盖子分组浏览器等直接写 DOM 的渲染路径（300ms 防抖）
    var _injectTimer = null;
    var _observe = function () {
        ['#promptList', '#collectionItemList'].forEach(function (sel) {
            var el = document.querySelector(sel);
            if (!el || el.dataset.cgObserved) return;
            el.dataset.cgObserved = '1';
            new MutationObserver(function () {
                if (_injectTimer) clearTimeout(_injectTimer);
                _injectTimer = setTimeout(function () {
                    try { if (App.cardGen) App.cardGen.inject(); } catch (e) {}
                }, 300);
            }).observe(el, { childList: true, subtree: true });
        });
    };
    // 延迟到 App 就绪（app_core 链在 defer 加载后）
    var _boot = function () {
        tryHook('renderPrompts');
        tryHook('renderCollectionItems');
        tryHook('_renderSemanticResults');
        _observe();
        // 容器可能延迟创建，周期补注册 observer
        setInterval(_observe, 3000);
        // v5.37.10: 页面加载后有活动任务 → 恢复悬浮条轮询（自动刷新依赖它）
        try { if (App.cardGen) App.cardGen._checkActiveTasks(); } catch (e) {}
        setInterval(function () { try { if (App.cardGen) App.cardGen._checkActiveTasks(); } catch (e) {} }, 20000);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(_boot, 600); });
    } else {
        setTimeout(_boot, 600);
    }
})();
