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
                    var thumb = card.querySelector('.card-thumb');
                    if (!thumb) return;
                    var current = s.current || {};
                    var icon = current.media_type === 'video' ? '🎬' : '🖼';
                    var btn = document.createElement('span');
                    btn.className = 'cg-history-btn';
                    btn.style.cssText = 'position:absolute;right:4px;bottom:4px;z-index:5;background:rgba(0,0,0,.6);color:#fff;font-size:9px;padding:1px 6px;border-radius:8px;cursor:pointer;display:flex;gap:3px;align-items:center;';
                    btn.innerHTML = icon + ' ' + s.count;
                    btn.title = '生成历史 ' + s.count + ' 条，点击切换显示';
                    btn.onclick = function (e) {
                        e.stopPropagation();
                        self._openHistoryPicker(parseInt(cid, 10), btn);
                    };
                    thumb.style.position = thumb.style.position || 'relative';
                    thumb.appendChild(btn);
                });
            }).catch(function () {});
        },
        _openHistoryPicker: function (cardId, anchor) {
            var self = this;
            App.fetchJSON('/api/card-gen/tasks?card_id=' + cardId + '&limit=20').then(function (d) {
                var tasks = (d && d.tasks || []).filter(function (t) { return t.status === 'success' && t.result_filename; });
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
                    var prev = t.media_type === 'video'
                        ? '<video src="/api/thumbnails/video/' + t.result_filename + '" style="width:84px;height:56px;object-fit:cover;border-radius:6px;" muted loop preload="metadata"></video>'
                        : '<img src="/api/thumbnails/file/' + t.result_filename + '" style="width:84px;height:56px;object-fit:cover;border-radius:6px;">';
                    var meta = (t.task_type_label || t.task_type) + (t.media_type === 'video' ? ' · ' + (t.duration || 5) + 's' : '') + ' · ' + (t.created_at || '').slice(0, 16);
                    h += '<div style="display:flex;gap:10px;align-items:center;padding:8px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:6px;' + (t.is_current ? 'border-color:#10b981;' : '') + '">' +
                        prev +
                        '<div style="flex:1;min-width:0;"><div style="font-size:12px;font-weight:600;">' + self._icons[t.task_type] + ' ' + meta + '</div>' +
                        '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + self._esc((t.prompt || '').slice(0, 60)) + '</div></div>' +
                        (t.is_current ? '' : '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#10b981;color:#10b981;" onclick="App.cardGen.activate(' + t.id + ',' + cardId + ',this)">设为当前</button>') +
                        '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;" onclick="App.cardGen.delTask(' + t.id + ',this)">🗑</button></div>';
                });
                h += '</div>';
                ov.innerHTML = h;
                document.body.appendChild(ov);
            }).catch(function () {});
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
            var ov = this._modal('');
            ov.id = 'cgGen_' + taskType + '_' + cardId;
            ov.querySelector('.modal-content').innerHTML =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">' + this._icons[taskType] + ' ' + this._tlabels[taskType] + '生成</span>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>' +
                (hasImg ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">底图：词卡原图 <img src="/api/thumbnails/original/' + self._esc(p.original_ref || p.thumbnail) + '" style="width:44px;height:32px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-left:4px;"></div>' : '') +
                (isV ? this._videoParamsHtml(taskType) : (isU ? this._upscaleParamsHtml() : this._imgParamsHtml(taskType))) +
                '<div style="font-size:10px;color:#f59e0b;margin:6px 0;">⚠️ 生成消耗即梦积分，提交后自动归档为词卡生成历史</div>' +
                '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
                '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                '<button class="btn btn-primary btn-sm" id="cgGo" onclick="App.cardGen.submit(\'' + ov.id + '\',' + cardId + ',\'' + taskType + '\')">🚀 提交生成</button></div>';
            ov.id = 'cgGen_' + taskType + '_' + cardId;
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
        _videoParamsHtml: function (taskType) {
            return '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">参数</div>' +
                '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">' +
                '<label style="font-size:11px;color:var(--text-muted);">模型 ' + this._sel('cgVModel', ['seedance2.0_vip', 'seedance2.0', 'seedance2.0fast', 'seedance2.0fast_vip', 'seedance2.0mini', 'seedance1.5pro', 'seedance2.5'], 'seedance2.0_vip') + '</label>' +
                '<label style="font-size:11px;color:var(--text-muted);">时长 ' + this._sel('cgVDur', [{ v: 4, l: '4s' }, { v: 5, l: '5s' }, { v: 8, l: '8s' }, { v: 10, l: '10s' }, { v: 12, l: '12s' }, { v: 15, l: '15s' }], 5) + '</label>' +
                '<label style="font-size:11px;color:var(--text-muted);">分辨率 ' + this._sel('cgVRes', ['720p', '1080p', '4k', '480p'], '720p') + '</label>' +
                (taskType === 'text2video' ? '<label style="font-size:11px;color:var(--text-muted);">比例 ' + this._sel('cgVRatio', ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], '16:9') + '</label>' : '') +
                '</div>' +
                '<label style="font-size:11px;color:var(--text-muted);">提示词</label>' +
                '<textarea id="cgPrompt" style="width:100%;min-height:80px;margin-top:4px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;">' + this._esc((this._cardData(this._curCard) || {}).content || '') + '</textarea>';
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
            var d = await App.fetchJSON('/api/card-gen/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ card_id: cardId, task_type: taskType, params: params })
            });
            if (d && d.ok) {
                this._toast('🚀 已入队，生成完成自动设为当前预览', 'success');
                if (ov) ov.remove();
                this._ensureQueueBar();
            } else {
                this._toast((d && d.detail) || '提交未完成', 'error');
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
            var h = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">';
            if (mode === 'text2image') {
                h += '<label style="font-size:11px;color:var(--text-muted);">模型 ' + this._sel('cgBModel', ['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '4.7', '5.0', '5.0Pro'], '5.0') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">比例 ' + this._sel('cgBRatio', ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'], '1:1') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">分辨率 ' + this._sel('cgBRes', ['1k', '2k', '4k'], '2k') + '</label>';
            } else if (mode === 'image2image') {
                h += '<label style="font-size:11px;color:var(--text-muted);">模型 ' + this._sel('cgBModel', ['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '4.7', '5.0', '5.0Pro'], '5.0') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">比例 ' + this._sel('cgBRatio', ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'], '1:1') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">分辨率 ' + this._sel('cgBRes', ['1k', '2k', '4k'], '2k') + '</label>' +
                    '<span style="font-size:10px;color:var(--text-muted);">（无原图词卡跳过）</span>';
            } else {
                h += '<label style="font-size:11px;color:var(--text-muted);">模型 ' + this._sel('cgBVModel', ['seedance2.0_vip', 'seedance2.0', 'seedance2.0fast', 'seedance2.0fast_vip', 'seedance2.0mini', 'seedance1.5pro', 'seedance2.5'], 'seedance2.0_vip') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">时长 ' + this._sel('cgBVDur', [{ v: 4, l: '4s' }, { v: 5, l: '5s' }, { v: 8, l: '8s' }, { v: 10, l: '10s' }, { v: 12, l: '12s' }, { v: 15, l: '15s' }], 5) + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">分辨率 ' + this._sel('cgBVRes', ['720p', '1080p', '4k', '480p'], '720p') + '</label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">比例 ' + this._sel('cgBVRatio', ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], '16:9') + '</label>';
            }
            h += '</div>' + (mode === 'text2image' ? '' : '') +
                (mode === 'image2image' || mode === 'text2video' ? '<label style="font-size:11px;color:var(--text-muted);">提示词（留空=用各词卡内容）</label><textarea id="cgBPrompt" style="width:100%;min-height:60px;margin-top:4px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;" placeholder="留空则逐卡使用词卡内容"></textarea>' : '');
            box.innerHTML = h;
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
                this._toast((d && d.detail) || '批量提交未完成', 'error');
            }
        },

        // ============ 详情弹窗生成历史区 ============
        loadDetailHistory: function (cardId) {
            var self = this;
            App.fetchJSON('/api/card-gen/tasks?card_id=' + cardId + '&limit=20').then(function (d) {
                var box = document.getElementById('cgDetailHistory');
                if (!box) return;
                var tasks = (d && d.tasks || []).filter(function (t) { return t.status === 'success' && t.result_filename; });
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
                var tasks = (d && d.tasks) || [];
                var box = self._panelOv.querySelector('#cgPanelBody');
                if (!box) return;
                var act = tasks.filter(function (t) { return t.status !== 'success' && t.status !== 'fail'; });
                var okc = tasks.filter(function (t) { return t.status === 'success'; }).length;
                var fai = tasks.filter(function (t) { return t.status === 'fail'; }).length;
                var h = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">进行中 ' + act.length + ' · 成功 ' + okc + ' · 失败 ' + fai + '</div>';
                if (!tasks.length) h += '<div style="color:var(--text-muted);font-size:12px;padding:20px;text-align:center;">暂无任务</div>';
                tasks.forEach(function (t) {
                    var prev = '';
                    if (t.status === 'success' && t.result_filename) {
                        prev = t.media_type === 'video'
                            ? '<video src="/api/thumbnails/video/' + t.result_filename + '" style="width:72px;height:46px;object-fit:cover;border-radius:6px;" muted loop preload="metadata"></video>'
                            : '<img src="/api/thumbnails/file/' + t.result_filename + '" style="width:72px;height:46px;object-fit:cover;border-radius:6px;">';
                    }
                    h += '<div style="display:flex;gap:10px;align-items:center;padding:7px 8px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:6px;">' +
                        (prev || '<div style="width:72px;height:46px;display:flex;align-items:center;justify-content:center;font-size:20px;background:rgba(127,127,127,.08);border-radius:6px;">' + (self._icons[t.task_type] || '🎨') + '</div>') +
                        '<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:600;">' + self._esc(t.card_name || '词卡#' + t.card_id) + ' · ' + (t.task_type_label || t.task_type) + '</div>' +
                        '<div style="margin-top:3px;">' + self._statusBadge(t.status) + (t.progress && t.status === 'querying' ? ' ' + t.progress + '%' : '') + self._bar(t.status === 'querying' ? t.progress : (t.status === 'success' ? 100 : 0)) +
                        (t.error ? '<div style="font-size:10px;color:#ef4444;margin-top:2px;">' + self._esc(t.error) + '</div>' : '') + '</div></div>' +
                        (t.status === 'success' ? (t.is_current ? '<span style="font-size:9px;color:#10b981;">当前显示</span>' : '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#10b981;color:#10b981;" onclick="App.cardGen.activate(' + t.id + ',' + t.card_id + ',null)">设为当前</button>') : '') +
                        (t.status === 'fail' ? '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;" onclick="App.cardGen.retry(' + t.id + ')">🔄 重试</button>' : '') +
                        (t.status === 'success' ? '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;" onclick="App.cardGen.delTask(' + t.id + ',null)">🗑</button>' : '') +
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

        // ============ 队列悬浮条（右下角，3s 轮询） ============
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
                App.fetchJSON('/api/card-gen/tasks?active=1&limit=50').then(function (d) {
                    var ts = (d && d.tasks) || [];
                    var st = document.getElementById('cgQStats');
                    if (!ts.length) { bar.style.display = 'none'; return; }
                    var run = ts.filter(function (t) { return t.status === 'querying' || t.status === 'submitting'; }).length;
                    var que = ts.filter(function (t) { return t.status === 'queued'; }).length;
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
    // 延迟到 App 就绪（app_core 链在 defer 加载后）
    var _boot = function () {
        tryHook('renderPrompts');
        tryHook('renderCollectionItems');
        tryHook('_renderSemanticResults');
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(_boot, 600); });
    } else {
        setTimeout(_boot, 600);
    }
})();
