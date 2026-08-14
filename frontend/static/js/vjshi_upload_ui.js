// ================================================================
// v5.38.0: 光厂（vjshi.com）素材上传
// - 词卡生成视频产物 → 投稿光厂（标题/关键词/简介自动生成可编辑）
// - 上传任务面板（串行/防风控/登录引导）
// 依赖：App.fetchJSON / App.showToast / App._escape / App.cardGen
// ================================================================
(function () {
    'use strict';
    if (!App) return;
    var VJ = {
        _teamActive: function () {
            return !!(App._activeTiers && App._activeTiers.team);
        },
        _toast: function (msg, type) {
            if (App.showToast) App.showToast(msg, type || 'info');
        },
        _esc: function (s) {
            return App._escape ? App._escape(s || '') : String(s || '');
        },
        _statusBadge: function (s) {
            var m = { queued: ['⏳ 排队中', '#94a3b8'], uploading: ['📤 上传中', '#f59e0b'],
                filling: ['📝 填表中', '#3b82f6'], submitted: ['✅ 已提交', '#10b981'],
                fail: ['❌ 失败', '#ef4444'] };
            var b = m[s] || [s, '#94a3b8'];
            return '<span style="color:' + b[1] + ';font-size:11px;">' + b[0] + '</span>';
        },

        // ============ 投稿弹窗 ============
        openSubmit: function (genTaskId, cardId, videoFile, meta) {
            var self = this;
            if (!this._teamActive()) { this._toast('光厂投稿为团队版功能', 'error'); return; }
            // meta 为空时自动拉取后端生成字段
            if (!meta || !meta.title) {
                App.fetchJSON('/api/vjshi/meta?gen_task_id=' + (genTaskId || 0) + '&card_id=' + (cardId || 0) + '&video_file=' + encodeURIComponent(videoFile || '')).then(function (d) {
                    var m = (d && d.meta) || {};
                    self._openSubmitModal(genTaskId, cardId, videoFile, m);
                }).catch(function () {
                    self._openSubmitModal(genTaskId, cardId, videoFile, {});
                });
                return;
            }
            this._openSubmitModal(genTaskId, cardId, videoFile, meta);
        },
        _openSubmitModal: function (genTaskId, cardId, videoFile, meta) {
            var self = this;
            meta = meta || {};
            var ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.cssText = 'display:flex;z-index:900;background:rgba(0,0,0,.55);align-items:center;justify-content:center;';
            ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
            ov.innerHTML = '<div class="modal-content" style="max-width:540px;border-radius:14px;padding:16px;max-height:88vh;overflow-y:auto;" onclick="event.stopPropagation()">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">📤 投稿光厂</span>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>' +
                (videoFile ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">视频: ' + self._esc(videoFile) +
                    ' <video src="/api/thumbnails/video/' + self._esc(videoFile) + '" style="width:120px;height:68px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-left:4px;" muted loop preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause()"></video></div>' : '') +
                '<label style="font-size:11px;color:var(--text-muted);">标题</label>' +
                '<input id="vjTitle" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(meta.title || '') + '">' +
                '<label style="font-size:11px;color:var(--text-muted);">关键词（逗号分隔）</label>' +
                '<input id="vjKeywords" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(meta.keywords || '') + '">' +
                '<label style="font-size:11px;color:var(--text-muted);">简介 <button type="button" class="btn btn-xs btn-outline" style="font-size:10px;border-color:#8b5cf6;color:#8b5cf6;margin-left:6px;" onclick="App.vjshi.llmDesc(this)">✨ AI 优化简介</button></label>' +
                '<textarea id="vjDesc" style="width:100%;min-height:70px;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;">' + self._esc(meta.description || '') + '</textarea>' +
                '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">' +
                '<label style="font-size:11px;color:var(--text-muted);">分类 <input id="vjCategory" style="width:110px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(meta.category || '创意') + '"></label>' +
                '<label style="font-size:11px;color:var(--text-muted);">价格(元) <input id="vjPrice" type="number" min="1" style="width:70px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="10"></label>' +
                '<label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;"><input id="vjIsAi" type="checkbox" checked style="accent-color:#6366f1;"> AI生成标注</label>' +
                '</div>' +
                '<div style="font-size:10px;color:#f59e0b;margin:6px 0;">⚠️ 提交后由光厂审核（约1个工作日）；标题/关键词不规范可能被拒。串行上传防风控（45s/条）。</div>' +
                '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
                '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                '<button class="btn btn-primary btn-sm" onclick="App.vjshi.submit(' + (genTaskId || 0) + ',' + (cardId || 0) + ',\'' + self._esc(videoFile || '') + '\',this)">📤 确认投稿</button></div></div>';
            document.body.appendChild(ov);
        },
        // v5.38.2: Ollama 生成 300 字内 SEO 简介
        llmDesc: async function (btn) {
            var self = this;
            var ov = btn.closest('.modal-overlay');
            var prompt = (ov.querySelector('#vjTitle') || {}).value || '';
            var ta = ov.querySelector('#vjDesc');
            if (!ta) return;
            btn.disabled = true; btn.textContent = '⏳ 生成中...';
            var d = await App.fetchJSON('/api/vjshi/llm-description', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: prompt, title: prompt })
            });
            btn.disabled = false; btn.textContent = '✨ AI 优化简介';
            if (d && d.ok && d.description) {
                ta.value = d.description;
                this._toast('✅ 简介已优化', 'success');
            } else {
                this._toast((d && d.error) || '简介生成未完成（Ollama 可能未启动）', 'error');
            }
        },
        submit: async function (genTaskId, cardId, videoFile, btn) {
            var ov = btn.closest('.modal-overlay');
            var body = {
                card_id: cardId, gen_task_id: genTaskId, video_file: videoFile,
                title: ov.querySelector('#vjTitle').value.trim(),
                keywords: ov.querySelector('#vjKeywords').value.trim(),
                description: ov.querySelector('#vjDesc').value.trim(),
                category: ov.querySelector('#vjCategory').value.trim(),
                price: parseInt(ov.querySelector('#vjPrice').value, 10) || 10,
                is_ai: ov.querySelector('#vjIsAi').checked ? 1 : 0
            };
            if (!body.title) { this._toast('标题必填', 'error'); return; }
            btn.disabled = true; btn.textContent = '⏳ 入队中...';
            var d = await App.fetchJSON('/api/vjshi/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            if (d && d.ok) {
                this._toast('📤 已入队，串行上传中', 'success');
                if (ov) ov.remove();
                this.openPanel();
            } else {
                this._toast((d && d.detail) || '入队未完成', 'error');
                btn.disabled = false; btn.textContent = '📤 确认投稿';
            }
        },

        // ============ 上传任务面板 ============
        openPanel: function () {
            var self = this;
            var ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.cssText = 'display:flex;z-index:900;background:rgba(0,0,0,.55);align-items:center;justify-content:center;';
            ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
            ov.innerHTML = '<div class="modal-content" style="max-width:760px;border-radius:14px;padding:16px;max-height:88vh;overflow-y:auto;" onclick="event.stopPropagation()">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">📤 光厂上传队列</span>' +
                '<span style="display:flex;gap:6px;">' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.openLogin()" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;">🔑 登录光厂</button>' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.openPanel()" style="font-size:10px;">🔄 刷新</button>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></span></div>' +
                '<div id="vjPanelBody" style="min-height:100px;">加载中...</div></div>';
            document.body.appendChild(ov);
            this._panelOv = ov;
            this._pollPanel();
        },
        _pollPanel: function () {
            var self = this;
            if (!this._panelOv || !document.body.contains(this._panelOv)) return;
            App.fetchJSON('/api/vjshi/tasks?limit=50').then(function (d) {
                var box = self._panelOv.querySelector('#vjPanelBody');
                if (!box) return;
                if (!d || !d.ok) { box.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:20px;text-align:center;">加载未完成</div>'; return; }
                var tasks = d.tasks || [];
                var st = d.state || {};
                var act = tasks.filter(function (t) { return t.status === 'queued' || t.status === 'uploading' || t.status === 'filling'; });
                var okc = tasks.filter(function (t) { return t.status === 'submitted'; }).length;
                var fai = tasks.filter(function (t) { return t.status === 'fail'; }).length;
                var h = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">进行中 ' + act.length + ' · 已提交 ' + okc + ' · 失败 ' + fai +
                    (st.paused_reason ? ' <span style="color:#ef4444;">⏸ ' + self._esc(st.paused_reason) + ' <a href="javascript:void(0)" onclick="App.vjshi.resume()" style="color:#10b981;">恢复</a></span>' : '') +
                    (st.today_count ? ' · 今日 ' + st.today_count + '/' + (st.daily_limit || 30) : '') +
                    '</div>';
                if (!tasks.length) h += '<div style="color:var(--text-muted);font-size:12px;padding:20px;text-align:center;">暂无上传任务</div>';
                tasks.forEach(function (t) {
                    h += '<div style="display:flex;gap:10px;align-items:center;padding:7px 8px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:6px;">' +
                        '<div style="width:72px;height:46px;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.08);border-radius:6px;overflow:hidden;">' +
                        (t.video_url ? '<video src="' + t.video_url + '" style="width:72px;height:46px;object-fit:cover;" muted loop preload="metadata"></video>' : '🎬') + '</div>' +
                        '<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:600;">' + self._esc(t.title || t.video_file) + '</div>' +
                        '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + self._esc(t.keywords || '') + '</div>' +
                        (t.error ? '<div style="font-size:10px;color:#ef4444;margin-top:2px;">' + self._esc(t.error) + '</div>' : '') +
                        (t.submit_ref ? '<div style="font-size:10px;color:#10b981;margin-top:2px;">已提交: ' + self._esc(t.submit_ref.slice(0, 50)) + '</div>' : '') +
                        '</div>' +
                        self._statusBadge(t.status) +
                        (t.status === 'fail' ? '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;" onclick="App.vjshi.retry(' + t.id + ')">🔄 重试</button>' : '') +
                        '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;" onclick="App.vjshi.delTask(' + t.id + ')">🗑</button></div>';
                });
                box.innerHTML = h;
                if (act.length) setTimeout(function () { self._pollPanel(); }, 5000);
            }).catch(function () { setTimeout(function () { self._pollPanel(); }, 5000); });
        },
        retry: async function (tid) {
            var d = await App.fetchJSON('/api/vjshi/tasks/' + tid + '/retry', { method: 'POST' });
            if (d && d.ok) this._toast('🔄 已重新入队', 'success'); else this._toast((d && d.detail) || '重试未完成', 'error');
        },
        delTask: async function (tid) {
            if (!confirm('删除此上传任务？')) return;
            var d = await App.fetchJSON('/api/vjshi/tasks/' + tid, { method: 'DELETE' });
            if (d && d.ok) { this._toast('已删除', 'success'); this.openPanel(); }
        },
        resume: async function () {
            var d = await App.fetchJSON('/api/vjshi/resume', { method: 'POST' });
            if (d && d.ok) { this._toast('✅ 队列已恢复', 'success'); this.openPanel(); }
        },
        openLogin: async function () {
            var d = await App.fetchJSON('/api/vjshi/open-login', { method: 'POST' });
            if (d && d.ok) {
                this._toast('🔑 请在打开的浏览器窗口完成光厂登录（手机验证码），登录后返回刷新', 'info');
            } else {
                this._toast((d && d.error) || '打开登录窗口未完成', 'error');
            }
        }
    };
    App.vjshi = VJ;

    // 投稿按钮注入：任务面板/历史弹窗的视频产物行（由 card_gen_ui 调用）
    VJ.submitBtnHtml = function (t) {
        if (!VJ._teamActive()) return '';
        if (t.media_type !== 'video' || !t.result_filename) return '';
        return '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;" onclick="App.vjshi.openSubmit(' + t.id + ',' + t.card_id + ',\'' + (t.result_filename || '') + '\',{title:\'\',keywords:\'\',description:\'\',category:\'\'})" title="投稿光厂（AI视频素材）">📤 光厂</button>';
    };
})();
