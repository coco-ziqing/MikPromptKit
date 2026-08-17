// ================================================================
// v5.41.0: 光厂（vjshi.com）素材上传 — 全链路体验优化版
// - 词卡生成视频产物 → 投稿光厂（标题/关键词/简介自动生成可编辑）
// - 上传任务面板（串行/防风控/登录引导/状态筛选/批量审核/批量投稿）
// - v5.41.0 新增：登录提示区修复 / 弹窗计数校验 / 重新质检 / 任务编辑 /
//   批量审核(多选) / 批量投稿候选 / 失败分类徽章 / ETA / 台账增强 / 后台完成提醒
// 依赖：App.fetchJSON / App.showToast / App._escape / App.cardGen
// ================================================================
(function () {
    'use strict';
    if (!App) return;
    var VJ = {
        _teamActive: function () {
            return !!(App._activeTiers && App._activeTiers.team);
        },
        // v5.38.3: 当前用户上传权限（团队开启后按成员开关）
        _uploadPerm: null,
        _loadPerm: function (force) {
            var self = this;
            if (this._uploadPerm !== null && !force) return Promise.resolve(this._uploadPerm);
            return App.fetchJSON('/api/team/permissions').then(function (d) {
                self._uploadPerm = (d && d.me && d.me.upload) ? true : false;
                self._permMembers = (d && d.members) || [];
                self._isAdmin = !!(d && d.is_admin);
                return self._uploadPerm;
            }).catch(function () {
                self._uploadPerm = null;  // 失败保持 null，由周期重试继续拉取
                return false;
            });
        },
        // 按钮显示条件：团队版 + 上传权限
        canUpload: function () {
            return this._teamActive() && this._uploadPerm === true;
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
        // v5.41.0: 失败分类徽章（fail_category → 中文；兜底 fail_label）
        _failBadge: function (t) {
            var lab = t.fail_label || '';
            if (!lab) return '';
            return '<span style="display:inline-block;font-size:10px;color:#ef4444;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:0 6px;margin-top:2px;">' + this._esc(lab) + '</span>';
        },
        // v5.41.0: 已提交任务审核流程指示（待审核 → 审核中 → 已上架/被拒）
        _reviewFlow: function (t) {
            if (t.status !== 'submitted') return '';
            var rs = t.review_status || '';
            var seg = function (label, active, done, color) {
                return '<span style="font-size:10px;padding:1px 5px;border-radius:8px;margin-right:2px;' +
                    (done ? 'background:' + color + ';color:#fff;' :
                        (active ? 'background:rgba(37,99,235,.12);color:#2563eb;border:1px solid rgba(37,99,235,.4);' :
                            'color:#94a3b8;background:rgba(127,127,127,.08);')) + '">' + label + '</span>';
            };
            var h = '<div style="margin-top:3px;">' +
                seg('已提交', !rs && rs !== 'reviewing', false, '#10b981') +
                '<span style="color:#cbd5e1;font-size:9px;">→</span>' +
                seg('审核中', rs === 'reviewing', false, '#2563eb') +
                '<span style="color:#cbd5e1;font-size:9px;">→</span>' +
                (rs === 'online' ? seg('已上架', false, true, '#10b981') :
                    rs === 'rejected' ? seg('被拒', false, true, '#ef4444') : seg('待定', false, false, '')) +
                '</div>';
            if (rs === 'rejected' && t.reject_reason) h += '<div style="font-size:10px;color:#ef4444;margin-top:1px;">原因：' + this._esc(t.reject_reason) + '</div>';
            return h;
        },

        // ============ 投稿弹窗（v5.41.0：登录提示修复 + 计数校验 + 重新质检） ============
        openSubmit: function (genTaskId, cardId, videoFile, meta) {
            var self = this;
            if (!this.canUpload()) { this._toast('未开通上传权限，请联系主理人开启', 'error'); return; }
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
                // v5.41.0: 登录状态区（此前 #vjLoginHint 未渲染导致登录引导永远不显示 — 修复）
                '<div id="vjLoginHint" style="font-size:11px;padding:6px 8px;border-radius:6px;margin-bottom:8px;border:1px dashed var(--border-color);color:var(--text-muted);">检查登录状态中...</div>' +
                (videoFile ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">视频: ' + self._esc(videoFile) +
                    ' <video id="vjPrevVideo" src="/api/thumbnails/video/' + self._esc(videoFile) + '" style="width:150px;height:84px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-left:4px;cursor:pointer;background:#000;" muted loop preload="metadata" title="点击播放/暂停"></video></div>' : '') +
                (videoFile ? '<div id="vjQaBox" style="font-size:11px;margin:4px 0 8px;padding:6px 8px;border-radius:6px;background:rgba(127,127,127,.06);">🔍 视频质检中... <button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#3b82f6;color:#3b82f6;margin-left:6px;" onclick="App.vjshi.recheckQa(this)">🔄 重新质检</button></div>' : '') +
                '<label style="font-size:11px;color:var(--text-muted);">标题（10-30 字）<span id="vjTitleCnt" style="float:right;font-size:10px;color:#94a3b8;">0/30</span></label>' +
                '<input id="vjTitle" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(meta.title || '') + '" oninput="App.vjshi.cntTitle(this)">' +
                '<label style="font-size:11px;color:var(--text-muted);">关键词（空格分隔，≥5 个）<span id="vjKwCnt" style="float:right;font-size:10px;color:#94a3b8;">0 词</span></label>' +
                '<input id="vjKeywords" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(meta.keywords || '') + '" oninput="App.vjshi.cntKeywords(this)">' +
                '<label style="font-size:11px;color:var(--text-muted);">简介（300 字内）<span id="vjDescCnt" style="float:right;font-size:10px;color:#94a3b8;">0/300</span> <button type="button" class="btn btn-xs btn-outline" style="font-size:10px;border-color:#8b5cf6;color:#8b5cf6;margin-left:6px;" onclick="App.vjshi.llmDesc(this)">✨ AI 优化简介</button></label>' +
                '<textarea id="vjDesc" style="width:100%;min-height:70px;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;" oninput="App.vjshi.cntDesc(this)">' + self._esc(meta.description || '') + '</textarea>' +
                '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">' +
                '<label style="font-size:11px;color:var(--text-muted);">分类 <input id="vjCategory" style="width:110px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(meta.category || '创意') + '"></label>' +
                '<label style="font-size:11px;color:var(--text-muted);">价格(元) <input id="vjPrice" type="number" min="1" style="width:70px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="10"></label>' +
                '<label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;"><input id="vjIsAi" type="checkbox" checked style="accent-color:#6366f1;"> AI生成标注</label>' +
                '</div>' +
                '<div style="font-size:10px;color:#f59e0b;margin:6px 0;">⚠️ 提交后由光厂审核（约1个工作日）；标题/关键词不规范可能被拒。逐条上传（每条间隔约半分钟，降低风险）。</div>' +
                '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
                '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                '<button class="btn btn-primary btn-sm" onclick="App.vjshi.submit(' + (genTaskId || 0) + ',' + (cardId || 0) + ',\'' + self._esc(videoFile || '') + '\',this)">📤 确认投稿</button></div></div>';
            document.body.appendChild(ov);
            // v5.41.0: 视频预览点击播放/暂停（替代 hover 播放，可控性更好）
            var pv = ov.querySelector('#vjPrevVideo');
            if (pv) {
                pv.onclick = function () {
                    if (pv.paused) { pv.play(); pv.style.outline = '2px solid rgba(99,102,241,.6)'; }
                    else { pv.pause(); pv.style.outline = 'none'; }
                };
            }
            // v5.41.0: 初始计数
            this.cntTitle(ov.querySelector('#vjTitle'));
            this.cntKeywords(ov.querySelector('#vjKeywords'));
            this.cntDesc(ov.querySelector('#vjDesc'));
            // v5.40.0 P1: 投稿前视频质检（ffprobe 本地解析）
            if (videoFile) this._runQa(ov, videoFile);
            // v5.38.6: 检测登录状态（v5.41.0 修复：此前 hint 区未渲染）
            App.fetchJSON('/api/vjshi/login-status').then(function (d) {
                var hint = ov.querySelector('#vjLoginHint');
                if (!hint) return;
                if (d && d.logged_in) {
                    hint.innerHTML = '✅ 光厂账户已登录，可继续上传';
                    hint.style.background = 'rgba(16,185,129,.08)';
                    hint.style.borderColor = 'rgba(16,185,129,.4)';
                    hint.style.color = '#10b981';
                } else {
                    hint.innerHTML = '⚠️ 第一步：请先登录光厂账户 <button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;margin-left:6px;" onclick="App.vjshi.openLogin()">🔑 打开登录窗口</button>';
                    hint.style.background = 'rgba(245,158,11,.08)';
                    hint.style.borderColor = 'rgba(245,158,11,.4)';
                    hint.style.color = '#f59e0b';
                }
            }).catch(function () {});
        },
        // v5.41.0: 重新质检（弹窗内按钮触发）
        recheckQa: function (btn) {
            var ov = btn.closest('.modal-overlay');
            var vf = null;
            var pv = ov.querySelector('#vjPrevVideo');
            if (pv && pv.src) vf = decodeURIComponent(pv.src.split('/').pop());
            if (!vf) return;
            var box = ov.querySelector('#vjQaBox');
            if (box) box.innerHTML = '🔍 视频质检中... <button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#3b82f6;color:#3b82f6;margin-left:6px;" onclick="App.vjshi.recheckQa(this)">🔄 重新质检</button>';
            this._runQa(ov, vf);
        },
        _runQa: function (ov, videoFile) {
            var self = this;
            App.fetchJSON('/api/vjshi/precheck-video', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_file: videoFile }), _timeoutMs: 30000
            }).then(function (d) {
                var box = ov.querySelector('#vjQaBox');
                if (!box) return;
                // v5.41.2: 区分「服务不可用」与「质检不通过」——质检不通过要显示具体问题并拦截
                if (!d || d.service_error || !(d.metrics || {}).duration) {
                    box.innerHTML = '⚠️ 质检服务暂不可用（不影响提交）';
                    return;
                }
                var m = d.metrics || {};
                var issues = d.issues || [];
                var errs = issues.filter(function (i) { return i.level === 'error'; });
                var warns = issues.filter(function (i) { return i.level === 'warning'; });
                ov._vjQaPass = !errs.length;  // 挂弹窗 DOM，避免多弹窗串扰
                var h = '🔍 视频质检：' + (errs.length ? '<b style="color:#ef4444;">不通过（' + errs.length + ' 项）</b>' : (d.ok ? '<b style="color:#10b981;">通过</b>' : '<b style="color:#f59e0b;">警告</b>')) +
                    ' <span style="color:var(--text-muted);">' + (m.duration || '-') + 's · ' + (m.width || '?') + 'x' + (m.height || '?') + ' · ' + (m.codec || '-') + ' · ' + (m.size_mb || '-') + 'MB</span>' +
                    ' <button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#3b82f6;color:#3b82f6;margin-left:4px;" onclick="App.vjshi.recheckQa(this)">🔄 重新质检</button>';
                (errs.concat(warns)).forEach(function (i) { h += '<div style="color:' + (i.level === 'error' ? '#ef4444' : '#f59e0b') + ';">· ' + self._esc(i.msg) + '</div>'; });
                if (!errs.length && !warns.length) h += '<div style="color:#10b981;">✅ 时长/分辨率/编码/大小均达标</div>';
                box.innerHTML = h;
                box.style.background = errs.length ? 'rgba(239,68,68,.08)' : (warns.length ? 'rgba(245,158,11,.08)' : 'rgba(16,185,129,.08)');
            }).catch(function () {});
        },
        // v5.41.0: 字数/词数计数
        cntTitle: function (el) {
            if (!el) return;
            var n = (el.value || '').length;
            var c = document.getElementById('vjTitleCnt');
            if (c) { c.textContent = n + '/30'; c.style.color = n > 30 || (n > 0 && n < 10) ? '#ef4444' : '#94a3b8'; }
        },
        cntKeywords: function (el) {
            if (!el) return;
            var n = (el.value || '').trim() ? (el.value || '').trim().split(/\s+/).length : 0;
            var c = document.getElementById('vjKwCnt');
            if (c) { c.textContent = n + ' 词'; c.style.color = n > 0 && n < 5 ? '#ef4444' : '#94a3b8'; }
        },
        cntDesc: function (el) {
            if (!el) return;
            var n = (el.value || '').length;
            var c = document.getElementById('vjDescCnt');
            if (c) { c.textContent = n + '/300'; c.style.color = n > 300 ? '#ef4444' : '#94a3b8'; }
        },
        // v5.38.2: Ollama 生成 300 字内 SEO 简介
        llmDesc: async function (btn) {
            var self = this;
            var ov = btn.closest('.modal-overlay');
            var prompt = (ov.querySelector('#vjTitle') || {}).value || '';
            var ta = ov.querySelector('#vjDesc');
            if (!ta) return;
            btn.disabled = true; btn.textContent = '⏳ 生成中...';
            try {
                var d = await App.fetchJSON('/api/vjshi/llm-description', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: prompt, title: prompt }),
                    _timeoutMs: 60000
                });
                btn.disabled = false; btn.textContent = '✨ AI 优化简介';
                if (d && d.ok && d.description) {
                    ta.value = d.description;
                    this.cntDesc(ta);
                    this._toast('✅ 简介已优化', 'success');
                } else {
                    this._toast((d && d.error) || '简介生成未完成（Ollama 未启动或超时）', 'error');
                }
            } catch (e) {
                btn.disabled = false; btn.textContent = '✨ AI 优化简介';
                this._toast('简介生成超时（' + (e.message || '网络错误') + '）', 'error');
            }
        },
        submit: async function (genTaskId, cardId, videoFile, btn) {
            // v5.40.0 P1: 视频质检不通过拦截（v5.41.0: 状态挂弹窗 DOM）
            var ov0 = btn.closest('.modal-overlay');
            if (ov0 && ov0._vjQaPass === false) { this._toast('视频质检不通过（时长/分辨率等），请先处理视频', 'error'); return; }
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
            // v5.41.0: 标题长度校验（光厂规范 10-30 字）
            if (!body.title) { this._toast('标题必填', 'error'); return; }
            if (body.title.length < 10) { this._toast('标题建议 ≥10 字（光厂规范），当前 ' + body.title.length + ' 字', 'error'); return; }
            if (body.title.length > 30) { this._toast('标题超 30 字（光厂规范），请精简', 'error'); return; }
            // v5.41.0: 关键词校验（空格分隔 ≥5）
            var kwN = body.keywords ? body.keywords.split(/\s+/).filter(Boolean).length : 0;
            if (kwN < 5) { this._toast('关键词需 ≥5 个（空格分隔），当前 ' + kwN + ' 个', 'error'); return; }
            if ((body.description || '').length > 300) { this._toast('简介超 300 字，请精简', 'error'); return; }
            btn.disabled = true; btn.textContent = '⏳ 入队中...';
            var d = await App.fetchJSON('/api/vjshi/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            if (d && d.ok) {
                this._toast('📤 已入队，将逐条上传', 'success');
                if (ov) ov.remove();
                this.openPanel();
            } else {
                this._toast((d && d.detail) || '入队未完成', 'error');
                btn.disabled = false; btn.textContent = '📤 确认投稿';
            }
        },

        // ============ 上传任务面板（v5.41.0：状态筛选/批量审核/ETA/编辑） ============
        openPanel: function () {
            var self = this;
            // v5.41.0: 已打开则原位重绘（避免刷新/操作后叠层）
            if (this._panelOv && document.body.contains(this._panelOv)) { this._pollPanel(); return; }
            var ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.cssText = 'display:flex;z-index:900;background:rgba(0,0,0,.55);align-items:center;justify-content:center;';
            ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
            ov.innerHTML = '<div class="modal-content" style="max-width:860px;border-radius:14px;padding:16px;max-height:88vh;overflow-y:auto;" onclick="event.stopPropagation()">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">📤 光厂上传队列</span>' +
                '<span style="display:flex;gap:6px;">' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.openLogin()" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;">🔑 登录光厂</button>' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.openBatchSubmit()" style="font-size:10px;border-color:#8b5cf6;color:#8b5cf6;">📦 批量投稿</button>' +
                '<button class="btn btn-xs btn-outline" id="vjModeBtn" onclick="App.vjshi.toggleMode()" style="font-size:10px;border-color:#3b82f6;color:#3b82f6;">⚙️ 执行方式</button>' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.openCatalog()" style="font-size:10px;border-color:#10b981;color:#10b981;">📒 上架台账</button>' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.openPanel()" style="font-size:10px;">🔄 刷新</button>' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.clearTasks()" style="font-size:10px;border-color:#ef4444;color:#ef4444;">🗑 清除全部</button>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></span></div>' +
                '<div id="vjPanelBody" style="min-height:100px;">加载中...</div></div>';
            document.body.appendChild(ov);
            this._panelOv = ov;
            this._showMode();
            this._pollPanel();
        },
        // v5.41.0: 批量审核操作条（多选后显示）
        _batchBar: function (n) {
            return '<div id="vjBatchBar" style="display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid #6366f1;border-radius:8px;background:rgba(99,102,241,.06);margin-bottom:6px;">' +
                '<span style="font-size:11px;color:#6366f1;">已选 <b>' + n + '</b> 条</span>' +
                '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#2563eb;color:#2563eb;" onclick="App.vjshi.batchReview(\'reviewing\')">⏳ 批量:审核中</button>' +
                '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#10b981;color:#10b981;" onclick="App.vjshi.batchReview(\'online\')">✅ 批量:已上架</button>' +
                '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;" onclick="App.vjshi.batchReview(\'rejected\')">❌ 批量:被拒</button>' +
                '<button class="btn btn-xs btn-outline" style="font-size:10px;" onclick="App.vjshi.batchClearSel()">取消选择</button></div>';
        },
        _pollPanel: function () {
            var self = this;
            if (!this._panelOv || !document.body.contains(this._panelOv)) return;
            App.fetchJSON('/api/vjshi/tasks?limit=200').then(function (d) {
                var box = self._panelOv.querySelector('#vjPanelBody');
                if (!box) return;
                if (!d || !d.ok) { box.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:20px;text-align:center;">加载未完成</div>'; return; }
                var tasks = d.tasks || [];
                var st = d.state || {};
                var stats = d.stats || {};
                // v5.41.0: 状态筛选 tabs（内存态，原位重绘避免叠层）
                var tab = this._tab || '';
                var reviewFilter = this._reviewFilter || '';
                if (tab === 'queued') tasks = tasks.filter(function (t) { return t.status === 'queued'; });
                else if (tab === 'active') tasks = tasks.filter(function (t) { return t.status === 'uploading' || t.status === 'filling'; });
                else if (tab === 'submitted') tasks = tasks.filter(function (t) { return t.status === 'submitted'; });
                else if (tab === 'fail') tasks = tasks.filter(function (t) { return t.status === 'fail'; });
                else if (tab === 'pending_review') tasks = tasks.filter(function (t) { return t.status === 'submitted' && !(t.review_status || ''); });
                if (reviewFilter) tasks = tasks.filter(function (t) { return (t.review_status || '') === reviewFilter; });
                var act = tasks.filter(function (t) { return t.status === 'queued' || t.status === 'uploading' || t.status === 'filling'; });
                var okc = tasks.filter(function (t) { return t.status === 'submitted'; }).length;
                var fai = tasks.filter(function (t) { return t.status === 'fail'; }).length;
                // v5.41.0: ETA 估算（排队数 × 45s 平均间隔）
                var queuedN = tasks.filter(function (t) { return t.status === 'queued'; }).length;
                var eta = queuedN ? ' · 排队预计 ~' + Math.max(1, Math.ceil(queuedN * 45 / 60)) + ' 分钟' : '';
                var pendingN = stats.review_pending || 0;
                // v5.41.0: 多选状态
                self._selIds = self._selIds || {};
                var selN = Object.keys(self._selIds).filter(function (k) { return self._selIds[k]; }).length;
                var tabBtn = function (val, label, extra) {
                    var on = tab === val;
                    return '<button class="btn btn-xs ' + (on ? 'btn-primary' : 'btn-outline') + '" style="font-size:10px;margin-right:4px;' + (extra ? 'border-color:#8b5cf6;color:#8b5cf6;' : '') + '" onclick="App.vjshi.setTab(\'' + val + '\')">' + label + '</button>';
                };
                var h = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">' +
                    tabBtn('', '全部 ' + (((stats.queued || 0) + (stats.uploading || 0) + (stats.filling || 0) + (stats.submitted || 0) + (stats.fail || 0)) || tasks.length), false) +
                    tabBtn('queued', '⏳ 排队', false) +
                    tabBtn('active', '📤 执行中', false) +
                    tabBtn('submitted', '✅ 已提交', false) +
                    tabBtn('fail', '❌ 失败', false) +
                    tabBtn('pending_review', '🕐 待审核 ' + pendingN, true) +
                    '<select id="vjReviewFilter" onchange="App.vjshi.setReviewFilter(this.value)" style="font-size:11px;padding:2px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);margin-left:6px;">' +
                    '<option value=""' + (!reviewFilter ? ' selected' : '') + '>审核: 全部</option><option value="reviewing"' + (reviewFilter === 'reviewing' ? ' selected' : '') + '>⏳ 审核中</option><option value="online"' + (reviewFilter === 'online' ? ' selected' : '') + '>✅ 已上架</option><option value="rejected"' + (reviewFilter === 'rejected' ? ' selected' : '') + '>❌ 被拒</option></select></div>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">执行中 ' + act.length + ' · 已提交 ' + okc + ' · 失败 ' + fai + eta +
                    (st.paused_reason ? ' <span style="color:#ef4444;">⏸ ' + self._esc(st.paused_reason) + ' <a href="javascript:void(0)" onclick="App.vjshi.resume()" style="color:#10b981;">恢复</a></span>' : '') +
                    (st.today_count ? ' · 今日 ' + st.today_count + '/' + (st.daily_limit || 30) : '') +
                    (st.hour_count ? ' · 本时 ' + st.hour_count + '/' + (st.hourly_limit || 6) : '') +
                    '</div>' +
                    (selN ? self._batchBar(selN) : '');
                if (!tasks.length) h += '<div style="color:var(--text-muted);font-size:12px;padding:20px;text-align:center;">暂无上传任务</div>';
                tasks.forEach(function (t) {
                    var canEdit = t.status === 'queued' || t.status === 'fail';
                    var chk = t.status === 'submitted' ? '<input type="checkbox" style="accent-color:#6366f1;" ' + (self._selIds[t.id] ? 'checked' : '') + ' onchange="App.vjshi.toggleSel(' + t.id + ',this.checked)">' : '';
                    h += '<div style="display:flex;gap:10px;align-items:center;padding:7px 8px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:6px;">' +
                        chk +
                        '<div style="width:72px;height:46px;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.08);border-radius:6px;overflow:hidden;">' +
                        (t.video_url ? '<video src="' + t.video_url + '" style="width:72px;height:46px;object-fit:cover;cursor:pointer;" muted loop preload="metadata" title="点击播放/暂停" onclick="this.paused?this.play():this.pause()"></video>' : '🎬') + '</div>' +
                        '<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:600;">' + self._esc(t.title || t.video_file) + '</div>' +
                        '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + self._esc(t.keywords || '') + '</div>' +
                        // v5.41.0: 执行中进度提示
                        ((t.status === 'uploading' || t.status === 'filling') && t.progress_note ? '<div style="font-size:10px;color:#3b82f6;margin-top:2px;">' + self._esc(t.progress_note) + '</div>' : '') +
                        (t.error ? '<div style="font-size:10px;color:#ef4444;margin-top:2px;">' + self._esc(t.error) + '</div>' : '') +
                        self._failBadge(t) +
                        self._reviewFlow(t) +
                        (t.submit_ref ? '<div style="font-size:10px;color:#10b981;margin-top:2px;">已提交: ' + self._esc(t.submit_ref.slice(0, 50)) + '</div>' : '') +
                        '</div>' +
                        self._statusBadge(t.status) +
                        (t.review_status === 'online' ? '<span class="badge" style="background:#10b981;">✅ 已上架</span>' : (t.review_status === 'reviewing' ? '<span class="badge" style="background:#2563eb;">⏳ 审核中</span>' : (t.review_status === 'rejected' ? '<span class="badge" style="background:#ef4444;" title="' + self._esc(t.reject_reason || '') + '">❌ 被拒</span>' : ''))) +
                        (t.status === 'submitted' ? '<span style="display:flex;gap:3px;">' +
                            '<button class="btn btn-xs btn-outline" style="font-size:9px;padding:1px 6px;border-color:#2563eb;color:#2563eb;" onclick="App.vjshi.markReview(' + t.id + ',\'reviewing\')">⏳审核中</button>' +
                            '<button class="btn btn-xs btn-outline" style="font-size:9px;padding:1px 6px;border-color:#10b981;color:#10b981;" onclick="App.vjshi.markReview(' + t.id + ',\'online\')">✅上架</button>' +
                            '<button class="btn btn-xs btn-outline" style="font-size:9px;padding:1px 6px;border-color:#ef4444;color:#ef4444;" onclick="App.vjshi.markReview(' + t.id + ',\'rejected\')">❌被拒</button></span>' : '') +
                        // v5.41.0: 编辑（queued/fail）
                        (canEdit ? '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#3b82f6;color:#3b82f6;" onclick="App.vjshi.editTask(' + t.id + ')">✏️</button>' : '') +
                        (t.status === 'fail' ? '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;" onclick="App.vjshi.retry(' + t.id + ')">🔄 重试</button>' : '') +
                        '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;" onclick="App.vjshi.delTask(' + t.id + ')">🗑</button></div>';
                });
                box.innerHTML = h;
                // v5.41.0: 后台完成提醒（有活跃任务时启动轻轮询）
                self._bgWatch(tasks);
                if (act.length) setTimeout(function () { self._pollPanel(); }, 5000);
            }).catch(function () { setTimeout(function () { self._pollPanel(); }, 5000); });
        },
        // v5.41.0: 后台完成提醒 — 活跃任务提交成功/失败 → toast（对齐 card_gen 通知模式）
        _bgWatch: function (tasks) {
            var self = this;
            var active = {};
            tasks.forEach(function (t) { if (t.status === 'queued' || t.status === 'uploading' || t.status === 'filling') active[t.id] = 1; });
            var prev = this._bgActive || {};
            // 状态迁移检测（仅提示一次，_bgNotified 去重）
            this._bgNotified = this._bgNotified || {};
            tasks.forEach(function (t) {
                if (prev[t.id] && (t.status === 'submitted' || t.status === 'fail') && !self._bgNotified[t.id]) {
                    self._bgNotified[t.id] = 1;
                    if (t.status === 'submitted') self._toast('📤 光厂投稿成功：' + (t.title || '').slice(0, 20), 'success');
                    else self._toast('❌ 光厂投稿失败：' + ((t.fail_label || t.error || '').slice(0, 30)), 'error');
                }
            });
            this._bgActive = active;
            var anyActive = Object.keys(active).length > 0;
            if (anyActive && !this._bgTimer) {
                this._bgTimer = setInterval(function () {
                    App.fetchJSON('/api/vjshi/tasks?limit=200').then(function (d) {
                        var ts = (d && d.tasks) || [];
                        self._bgWatch(ts);
                        var still = ts.filter(function (t) { return t.status === 'queued' || t.status === 'uploading' || t.status === 'filling'; });
                        if (!still.length && self._bgTimer) { clearInterval(self._bgTimer); self._bgTimer = null; }
                    }).catch(function () {});
                }, 30000);
            } else if (!anyActive && this._bgTimer) {
                clearInterval(this._bgTimer);
                this._bgTimer = null;
            }
        },
        // v5.41.0: 筛选 tab（原位重绘）
        setTab: function (val) {
            this._tab = val;
            this._pollPanel();
        },
        setReviewFilter: function (val) {
            this._reviewFilter = val;
            this._pollPanel();
        },
        // v5.41.0: 多选
        toggleSel: function (tid, on) {
            var s = this;
            this._selIds = this._selIds || {};
            this._selIds[tid] = on ? 1 : 0;
            var bar = document.getElementById('vjBatchBar');
            var n = Object.keys(this._selIds).filter(function (k) { return s._selIds[k]; }).length;
            if (bar) bar.outerHTML = this._batchBar(n);
            else this._pollPanel();
        },
        batchClearSel: function () {
            this._selIds = {};
            this._pollPanel();
        },
        // v5.41.0: 批量审核标记（调用已有 /api/vjshi/review-batch）
        batchReview: async function (status) {
            var s = this;
            var ids = Object.keys(this._selIds || {}).filter(function (k) { return s._selIds[k]; }).map(Number);
            if (!ids.length) { this._toast('请先勾选任务', 'warning'); return; }
            var reason = '';
            if (status === 'rejected') {
                reason = prompt('录入被拒原因（可预置：标题不规范/关键词违规/版权存疑/画面质量差/其他）：', '') || '';
            }
            var d = await App.fetchJSON('/api/vjshi/review-batch', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids, status: status, reject_reason: reason })
            });
            if (d && d.ok) {
                this._toast('已批量标记 ' + (d.updated || ids.length) + ' 条：' + (status === 'online' ? '已上架' : status === 'reviewing' ? '审核中' : '被拒'), 'success');
                this._selIds = {};
                this.openPanel();
            } else this._toast((d && d.detail) || '批量标记失败', 'error');
        },
        // v5.41.0: 任务编辑（queued/fail）
        editTask: function (tid) {
            var self = this;
            App.fetchJSON('/api/vjshi/tasks?limit=500').then(function (d) {
                var t = null;
                (d.tasks || []).forEach(function (x) { if (x.id === tid) t = x; });
                if (!t) { self._toast('任务不存在', 'error'); return; }
                var ov = document.createElement('div');
                ov.className = 'modal-overlay';
                ov.style.cssText = 'display:flex;z-index:910;background:rgba(0,0,0,.55);align-items:center;justify-content:center;';
                ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
                ov.innerHTML = '<div class="modal-content" style="max-width:520px;border-radius:14px;padding:16px;max-height:88vh;overflow-y:auto;" onclick="event.stopPropagation()">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">✏️ 编辑投稿任务 #' + tid + '</span>' +
                    '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>' +
                    '<label style="font-size:11px;color:var(--text-muted);">标题（10-30 字）</label>' +
                    '<input id="etTitle" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(t.title || '') + '">' +
                    '<label style="font-size:11px;color:var(--text-muted);">关键词（空格分隔，≥5 个）</label>' +
                    '<input id="etKeywords" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(t.keywords || '') + '">' +
                    '<label style="font-size:11px;color:var(--text-muted);">简介（300 字内）</label>' +
                    '<textarea id="etDesc" style="width:100%;min-height:70px;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;">' + self._esc(t.description || '') + '</textarea>' +
                    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">' +
                    '<label style="font-size:11px;color:var(--text-muted);">分类 <input id="etCategory" style="width:110px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(t.category || '创意') + '"></label>' +
                    '<label style="font-size:11px;color:var(--text-muted);">价格(元) <input id="etPrice" type="number" min="1" style="width:70px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + (t.price || 10) + '"></label>' +
                    '<label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;"><input id="etIsAi" type="checkbox" ' + (t.is_ai ? 'checked' : '') + ' style="accent-color:#6366f1;"> AI生成标注</label>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
                    '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                    '<button class="btn btn-primary btn-sm" onclick="App.vjshi.saveEdit(' + tid + ',this)">💾 保存</button></div></div>';
                document.body.appendChild(ov);
            });
        },
        saveEdit: async function (tid, btn) {
            var ov = btn.closest('.modal-overlay');
            var title = ov.querySelector('#etTitle').value.trim();
            var kw = ov.querySelector('#etKeywords').value.trim();
            var desc = ov.querySelector('#etDesc').value.trim();
            if (!title) { this._toast('标题必填', 'error'); return; }
            if (title.length < 10 || title.length > 30) { this._toast('标题需 10-30 字，当前 ' + title.length + ' 字', 'error'); return; }
            var kwN = kw ? kw.split(/\s+/).filter(Boolean).length : 0;
            if (kwN < 5) { this._toast('关键词需 ≥5 个（空格分隔），当前 ' + kwN + ' 个', 'error'); return; }
            if (desc.length > 300) { this._toast('简介超 300 字', 'error'); return; }
            btn.disabled = true; btn.textContent = '⏳ 保存中...';
            var d = await App.fetchJSON('/api/vjshi/tasks/' + tid, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title, keywords: kw, description: desc, category: ov.querySelector('#etCategory').value.trim(), price: parseInt(ov.querySelector('#etPrice').value, 10) || 10, is_ai: ov.querySelector('#etIsAi').checked ? 1 : 0 })
            });
            if (d && d.ok) {
                this._toast('✅ 已保存', 'success');
                ov.remove();
                this.openPanel();
            } else { this._toast((d && d.detail) || '保存失败', 'error'); btn.disabled = false; btn.textContent = '💾 保存'; }
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
        // v5.38.64: 清除全部队列记录
        clearTasks: async function () {
            if (!confirm('确定清除全部上传队列记录？（含已完成/失败/进行中，进行中任务将被取消）')) return;
            var d = await App.fetchJSON('/api/vjshi/tasks', { method: 'DELETE' });
            if (d && d.ok) { this._toast('已清除 ' + d.deleted + ' 条记录', 'success'); this.openPanel(); }
            else this._toast((d && d.detail) || '清除失败', 'error');
        },
        resume: async function () {
            var d = await App.fetchJSON('/api/vjshi/resume', { method: 'POST' });
            if (d && d.ok) { this._toast('✅ 队列已恢复', 'success'); this.openPanel(); }
        },
        // v5.39.0: 人工录入审核状态（reviewing/online/rejected）
        markReview: async function (tid, status) {
            var reason = '';
            if (status === 'rejected') {
                reason = prompt('录入被拒原因（如：标题不规范/关键词违规）：', '') || '';
            }
            var d = await App.fetchJSON('/api/vjshi/tasks/' + tid + '/review', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: status, reject_reason: reason })
            });
            if (d && d.ok) { this._toast('已标记：' + (status === 'online' ? '已上架' : status === 'reviewing' ? '审核中' : '被拒'), 'success'); this.openPanel(); }
            else this._toast((d && d.detail) || '标记失败', 'error');
        },

        // ============ 批量投稿（v5.41.0：候选视频列表 → 勾选 → 批量入队） ============
        openBatchSubmit: function () {
            var self = this;
            if (!this.canUpload()) { this._toast('未开通上传权限，请联系主理人开启', 'error'); return; }
            var ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.cssText = 'display:flex;z-index:915;background:rgba(0,0,0,.55);align-items:center;justify-content:center;';
            ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
            ov.innerHTML = '<div class="modal-content" style="max-width:820px;border-radius:14px;padding:16px;max-height:88vh;overflow-y:auto;" onclick="event.stopPropagation()">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">📦 批量投稿光厂</span>' +
                '<span style="display:flex;gap:6px;">' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.refreshBatch()" style="font-size:10px;">🔄 刷新</button>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></span></div>' +
                '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">' +
                '<input id="vjBKw" placeholder="按关键词/词卡名过滤（可选）" value="' + self._esc(this._batchKw || '') + '" style="flex:1;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;" onkeydown="if(event.key===\'Enter\')App.vjshi.applyBatchKw(this.value)">' +
                '<label style="font-size:11px;color:var(--text-muted);">价格 <input id="vjBPrice" type="number" min="1" value="10" style="width:64px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;"></label>' +
                '<button class="btn btn-primary btn-sm" onclick="App.vjshi.batchSubmit()">📤 批量入队</button></div>' +
                '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">候选 = 生成完成且未投过的视频。入队前自动逐条本地质检（不通过自动跳过）；批量 ≤20 条。</div>' +
                '<div id="vjBatchBody" style="min-height:80px;">加载中...</div></div>';
            document.body.appendChild(ov);
            this._batchOv = ov;
            this._loadBatchCandidates();
        },
        // v5.41.0: 批量候选加载（内存关键词过滤，原位重绘）
        _loadBatchCandidates: function () {
            var self = this;
            var ov = this._batchOv;
            if (!ov || !document.body.contains(ov)) return;
            var kw = encodeURIComponent(this._batchKw || '');
            App.fetchJSON('/api/vjshi/candidates?keyword=' + kw).then(function (d) {
                var box = ov.querySelector('#vjBatchBody');
                if (!box) return;
                var items = (d && d.items) || [];
                if (!items.length) { box.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:20px;text-align:center;">暂无候选视频（生成完成且未投过）</p>'; return; }
                self._batchItems = items;
                var h = '<div style="font-size:11px;margin-bottom:6px;"><label style="color:var(--text-muted);"><input type="checkbox" id="vjBAll" checked onchange="App.vjshi.batchAll(this.checked)" style="accent-color:#6366f1;"> 全选</label> <span style="color:var(--text-muted);">共 ' + items.length + ' 条</span></div>';
                items.forEach(function (it, i) {
                    h += '<div style="display:flex;gap:10px;align-items:center;padding:6px 8px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:5px;">' +
                        '<input type="checkbox" class="vjBChk" data-i="' + i + '" checked onchange="App.vjshi.batchAllSync()" style="accent-color:#6366f1;">' +
                        '<video src="/api/thumbnails/video/' + self._esc(it.video_file) + '" style="width:64px;height:40px;object-fit:cover;border-radius:6px;cursor:pointer;" muted loop preload="metadata" title="点击播放/暂停" onclick="this.paused?this.play():this.pause()"></video>' +
                        '<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:600;">' + self._esc(it.card_name || '') + '</div>' +
                        '<div style="font-size:10px;color:var(--text-muted);">' + self._esc(it.video_file) + '</div></div>' +
                        '<div style="font-size:10px;color:var(--text-muted);white-space:nowrap;">' + (it.duration ? it.duration + 's' : '') + (it.resolution ? ' · ' + self._esc(it.resolution) : '') + (it.model ? ' · ' + self._esc(it.model) : '') + '</div>' +
                        '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;" onclick="App.vjshi.openSubmit(' + it.gen_task_id + ',' + (it.card_id || 0) + ',\'' + self._esc(it.video_file) + '\')">📤 单条</button></div>';
                });
                box.innerHTML = h;
            }).catch(function () {
                var box = ov.querySelector('#vjBatchBody');
                if (box) box.innerHTML = '<p style="font-size:12px;color:#ef4444;">候选加载失败</p>';
            });
        },
        refreshBatch: function () {
            this._batchKw = ((this._batchOv && this._batchOv.querySelector('#vjBKw')) || {}).value || this._batchKw || '';
            this._loadBatchCandidates();
        },
        applyBatchKw: function (v) {
            this._batchKw = v || '';
            this._loadBatchCandidates();
        },
        batchAll: function (on) {
            var ov = this._batchOv;
            if (!ov) return;
            ov.querySelectorAll('.vjBChk').forEach(function (c) { c.checked = on; });
        },
        batchAllSync: function () {
            var ov = this._batchOv;
            if (!ov) return;
            var all = ov.querySelectorAll('.vjBChk');
            var any = Array.prototype.some.call(all, function (c) { return c.checked; });
            var box = ov.querySelector('#vjBAll');
            if (box) box.checked = any && Array.prototype.every.call(all, function (c) { return c.checked; });
        },
        // v5.41.0: 批量入队（先逐条本地质检，不通过跳过）
        batchSubmit: async function () {
            var self = this;
            var ov = this._batchOv;
            if (!ov) return;
            var items = this._batchItems || [];
            var picked = [];
            ov.querySelectorAll('.vjBChk').forEach(function (c) { if (c.checked) picked.push(items[parseInt(c.getAttribute('data-i'), 10)]); });
            if (!picked.length) { this._toast('请至少勾选 1 条视频', 'warning'); return; }
            if (picked.length > 20) { this._toast('单批最多 20 条，请分批', 'error'); return; }
            var btn = ov.querySelector('.btn-primary');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ 质检入队中...'; }
            // 逐条预检
            var pass = [], fail = [];
            for (var i = 0; i < picked.length; i++) {
                try {
                    var q = await App.fetchJSON('/api/vjshi/precheck-video', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ video_file: picked[i].video_file }), _timeoutMs: 30000
                    });
                    var errs = (q && q.issues || []).filter(function (x) { return x.level === 'error'; });
                    if (q && q.ok && !errs.length) pass.push(picked[i]);
                    else fail.push({ item: picked[i], msg: errs.length ? errs[0].msg : '质检失败' });
                } catch (e) { fail.push({ item: picked[i], msg: '质检异常' }); }
            }
            if (fail.length) {
                var okGo = confirm('有 ' + fail.length + ' 条质检不通过将跳过：\n' + fail.slice(0, 5).map(function (f) { return '· ' + f.item.card_name + '：' + f.msg; }).join('\n') + (fail.length > 5 ? '\n…等' : '') + '\n\n继续提交通过的 ' + pass.length + ' 条？');
                if (!okGo) { if (btn) { btn.disabled = false; btn.textContent = '📤 批量入队'; } return; }
            }
            if (!pass.length) { this._toast('没有质检通过的视频', 'error'); if (btn) { btn.disabled = false; btn.textContent = '📤 批量入队'; } return; }
            var price = parseInt((ov.querySelector('#vjBPrice') || {}).value, 10) || 10;
            var d = await App.fetchJSON('/api/vjshi/batch', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: pass.map(function (p) { return { card_id: p.card_id || 0, gen_task_id: p.gen_task_id, video_file: p.video_file }; }), price: price, is_ai: 1 })
            });
            if (d && d.ok) {
                this._toast('📤 已批量入队 ' + d.count + ' 条（跳过 ' + fail.length + ' 条）', 'success');
                ov.remove();
                this.openPanel();
            } else {
                this._toast((d && d.detail) || '批量入队未完成', 'error');
                if (btn) { btn.disabled = false; btn.textContent = '📤 批量入队'; }
            }
        },

        // ============ 上架作品台账（v5.41.0：筛选/汇总/内联编辑） ============
        openCatalog: function () {
            var self = this;
            // v5.41.0: 已打开则原位重绘（避免叠层）
            if (this._catalogOv && document.body.contains(this._catalogOv)) { this._loadCatalog(); return; }
            var ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.cssText = 'display:flex;z-index:905;background:rgba(0,0,0,.55);align-items:center;justify-content:center;';
            ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
            ov.innerHTML = '<div class="modal-content" style="max-width:920px;border-radius:14px;padding:16px;max-height:88vh;overflow-y:auto;" onclick="event.stopPropagation()">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">📒 上架作品台账</span>' +
                '<span style="display:flex;gap:6px;">' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.catalogAddFromOnline()" style="font-size:10px;border-color:#10b981;color:#10b981;" title="把已标记上架的任务一键加入台账">➕ 从已上架任务加入</button>' +
                '<button class="btn btn-xs btn-outline" onclick="App.vjshi.openCatalog()" style="font-size:10px;">🔄 刷新</button>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></span></div>' +
                '<div id="vjCatalogBody" style="min-height:100px;">加载中...</div></div>';
            document.body.appendChild(ov);
            this._catalogOv = ov;
            this._loadCatalog();
        },
        _loadCatalog: function () {
            var self = this;
            if (!this._catalogOv || !document.body.contains(this._catalogOv)) return;
            // v5.41.0: 状态筛选（内存态，原位重绘避免叠层）
            var filter = this._catFilter || '';
            var url = '/api/vjshi/catalog?limit=200' + (filter ? '&status=' + filter : '');
            App.fetchJSON(url).then(function (d) {
                var box = self._catalogOv.querySelector('#vjCatalogBody');
                if (!box) return;
                var items = (d && d.items) || [];
                if (!items.length) { box.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:20px;text-align:center;">暂无台账条目（投稿上架后点「从已上架任务加入」或手动录入）</p>'; return; }
                // v5.41.0: 汇总行
                var onlineN = items.filter(function (x) { return x.status !== 'removed'; }).length;
                var totQty = items.reduce(function (s, x) { return s + (parseFloat(x.sales_qty) || 0); }, 0);
                var totRev = items.reduce(function (s, x) { return s + (parseFloat(x.revenue) || 0); }, 0);
                var h = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;color:var(--text-muted);">' +
                    '<select id="vjCatFilter" onchange="App.vjshi.setCatFilter(this.value)" style="font-size:11px;padding:2px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                    '<option value="">状态: 全部</option><option value="online"' + (filter === 'online' ? ' selected' : '') + '>✅ 在架</option><option value="removed"' + (filter === 'removed' ? ' selected' : '') + '>❌ 已剔除</option></select>' +
                    '<span>在架 ' + onlineN + ' · 累计销量 ' + totQty + ' · 累计收益 <b style="color:#10b981;">¥' + totRev.toFixed(2) + '</b></span></div>';
                h += '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tr><th style="padding:6px;border:1px solid var(--border-color);">标题</th><th style="padding:6px;border:1px solid var(--border-color);">题材</th><th style="padding:6px;border:1px solid var(--border-color);">链接</th><th style="padding:6px;border:1px solid var(--border-color);">上架</th><th style="padding:6px;border:1px solid var(--border-color);">销量</th><th style="padding:6px;border:1px solid var(--border-color);">收益</th><th style="padding:6px;border:1px solid var(--border-color);">状态</th><th style="padding:6px;border:1px solid var(--border-color);">操作</th></tr>';
                items.forEach(function (it) {
                    var removed = it.status === 'removed';
                    h += '<tr><td style="padding:6px;border:1px solid var(--border-color);">' + self._esc(it.title || it.video_file) + '</td>' +
                        '<td style="padding:6px;border:1px solid var(--border-color);">' + self._esc(it.theme || '-') + '</td>' +
                        '<td style="padding:6px;border:1px solid var(--border-color);">' + (it.online_url ? '<a href="' + self._esc(it.online_url) + '" target="_blank" style="color:#6366f1;font-size:11px;">链接 ↗</a>' : '-') + '</td>' +
                        '<td style="padding:6px;border:1px solid var(--border-color);">' + self._esc(it.review_date || '-') + '</td>' +
                        '<td style="padding:6px;border:1px solid var(--border-color);text-align:center;">' + (it.sales_qty || 0) + '</td>' +
                        '<td style="padding:6px;border:1px solid var(--border-color);text-align:center;">' + (it.revenue || 0) + '</td>' +
                        '<td style="padding:6px;border:1px solid var(--border-color);">' + (removed ? '<span style="color:#ef4444;">❌ 已剔除</span>' : '<span style="color:#10b981;">✅ 在架</span>') + (removed && it.remove_reason ? '<div style="font-size:10px;color:var(--text-muted);">' + self._esc(it.remove_reason) + '</div>' : '') + '</td>' +
                        '<td style="padding:6px;border:1px solid var(--border-color);white-space:nowrap;">' +
                        // v5.41.0: 表现/链接内联编辑（替代双 prompt 弹窗）
                        '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#8b5cf6;color:#8b5cf6;" onclick="App.vjshi.catalogEdit(' + it.id + ')">📊 表现/编辑</button> ' +
                        (removed ? '' : '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#ef4444;color:#ef4444;" onclick="App.vjshi.catalogRemove(' + it.id + ')">🗑 剔除</button>') +
                        '</td></tr>';
                });
                h += '</table>';
                box.innerHTML = h;
            });
        },
        // 从已标记上架(submitted+review_status=online)的任务加入台账
        catalogAddFromOnline: function () {
            var self = this;
            App.fetchJSON('/api/vjshi/tasks?limit=200').then(function (d) {
                var tasks = (d && d.tasks || []).filter(function (t) { return t.review_status === 'online'; });
                if (!tasks.length) { self._toast('暂无已标记上架的任务（先在队列中标记 ✅上架）', 'warning'); return; }
                if (!confirm('将 ' + tasks.length + ' 条已上架任务加入台账？（已在台账中的自动跳过）')) return;
                var added = 0;
                (function next(i) {
                    if (i >= tasks.length) {
                        self._toast('已加入 ' + added + ' 条台账' + (tasks.length - added ? '（' + (tasks.length - added) + ' 条已存在跳过）' : ''), 'success');
                        self.openCatalog();
                        return;
                    }
                    App.fetchJSON('/api/vjshi/catalog', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ task_id: tasks[i].id })
                    }).then(function (r) { if (r && r.ok) added++; next(i + 1); }).catch(function () { next(i + 1); });
                })(0);
            });
        },
        // v5.41.0: 内联编辑弹窗（销量/收益/链接 一次保存）
        catalogEdit: function (cid) {
            var self = this;
            App.fetchJSON('/api/vjshi/catalog?limit=200').then(function (d) {
                var it = null;
                (d.items || []).forEach(function (x) { if (x.id === cid) it = x; });
                if (!it) { self._toast('条目不存在', 'error'); return; }
                var ov = document.createElement('div');
                ov.className = 'modal-overlay';
                ov.style.cssText = 'display:flex;z-index:920;background:rgba(0,0,0,.55);align-items:center;justify-content:center;';
                ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
                ov.innerHTML = '<div class="modal-content" style="max-width:440px;border-radius:14px;padding:16px;" onclick="event.stopPropagation()">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">📊 台账表现 / 编辑</span>' +
                    '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">' + self._esc(it.title || it.video_file) + '</div>' +
                    '<label style="font-size:11px;color:var(--text-muted);">作品链接（光厂）</label>' +
                    '<input id="ctUrl" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + self._esc(it.online_url || '') + '" placeholder="https://www.vjshi.com/...">' +
                    '<div style="display:flex;gap:10px;">' +
                    '<label style="flex:1;font-size:11px;color:var(--text-muted);">销量（件）<input id="ctQty" type="number" min="0" step="0.1" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + (it.sales_qty || 0) + '"></label>' +
                    '<label style="flex:1;font-size:11px;color:var(--text-muted);">收益（元）<input id="ctRev" type="number" min="0" step="0.01" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;" value="' + (it.revenue || 0) + '"></label></div>' +
                    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
                    '<button class="btn btn-secondary btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
                    '<button class="btn btn-primary btn-sm" onclick="App.vjshi.catalogSave(' + cid + ',this)">💾 保存</button></div></div>';
                document.body.appendChild(ov);
            });
        },
        catalogSave: async function (cid, btn) {
            var ov = btn.closest('.modal-overlay');
            var body = {
                online_url: ov.querySelector('#ctUrl').value.trim(),
                sales_qty: parseFloat(ov.querySelector('#ctQty').value) || 0,
                revenue: parseFloat(ov.querySelector('#ctRev').value) || 0
            };
            btn.disabled = true; btn.textContent = '⏳ 保存中...';
            var d = await App.fetchJSON('/api/vjshi/catalog/' + cid, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            if (d && d.ok) { this._toast('✅ 已更新', 'success'); ov.remove(); this.openCatalog(); }
            else { this._toast((d && d.detail) || '保存失败', 'error'); btn.disabled = false; btn.textContent = '💾 保存'; }
        },
        setCatFilter: function (val) {
            this._catFilter = val;
            this._loadCatalog();
        },
        catalogRemove: function (cid) {
            var self = this;
            var reason = prompt('剔除原因（如：质量差/无人购买）：', '') || '';
            App.fetchJSON('/api/vjshi/catalog/' + cid, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'removed', remove_reason: reason })
            }).then(function (d) { if (d && d.ok) { self._toast('已标记剔除', 'success'); self.openCatalog(); } });
        },
        // v5.38.6: 浏览器模式切换（有头=可见窗口 / 无头=后台）
        toggleMode: async function () {
            var d = await App.fetchJSON('/api/vjshi/settings');
            var cur = !!(d && d.headless);
            var next = !cur;
            var r = await App.fetchJSON('/api/vjshi/settings', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ headless: next })
            });
            if (r && r.ok) {
                this._toast(next ? '已切换：后台执行（不显示窗口）' : '已切换：可视执行（窗口可见操作）', 'success');
                var b = document.getElementById('vjModeBtn');
                if (b) b.textContent = next ? '⚙️ 执行方式: 后台执行' : '⚙️ 执行方式: 可视执行';
            }
        },
        // 面板打开时显示当前模式
        _showMode: function () {
            App.fetchJSON('/api/vjshi/settings').then(function (d) {
                var b = document.getElementById('vjModeBtn');
                if (b) b.textContent = (d && d.headless) ? '⚙️ 执行方式: 后台执行' : '⚙️ 执行方式: 可视执行';
            }).catch(function () {});
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
    // v5.38.3: 页面加载拉取上传权限（不依赖 _activeTiers 时序；非团队会 403 → false）
    VJ._loadPerm();
    setInterval(function () { if (VJ._uploadPerm === null) VJ._loadPerm(); }, 5000);

    // 投稿按钮注入：任务面板/历史弹窗的视频产物行（由 card_gen_ui 调用）
    VJ.submitBtnHtml = function (t) {
        if (!VJ.canUpload()) return '';
        if (t.media_type !== 'video' || !t.result_filename) return '';
        return '<button class="btn btn-xs btn-outline" style="font-size:10px;border-color:#f59e0b;color:#f59e0b;" onclick="App.vjshi.openSubmit(' + t.id + ',' + t.card_id + ',\'' + (t.result_filename || '') + '\',{title:\'\',keywords:\'\',description:\'\',category:\'\'})" title="上传视频素材到光厂（需团队开启上传权限）">📤 上传</button>';
    };

    // ============ 团队上传权限设置（v5.38.3，仅主理人） ============
    VJ.openPermPanel = function () {
        var self = this;
        this._loadPerm(true).then(function () {
            var ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.cssText = 'display:flex;z-index:910;background:rgba(0,0,0,.55);align-items:center;justify-content:center;';
            ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
            var members = self._permMembers || [];
            var rows = members.map(function (m) {
                var isAdmin = m.role === 'admin' || m.id === 1;
                // v5.38.4: 一律勾选才授权（admin 也需手动开启）
                var chk = '<label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" ' + (m.upload ? 'checked' : '') + ' onchange="App.vjshi.setPerm(' + m.id + ', this.checked)" style="accent-color:#f59e0b;"></label>';
                return '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:5px;">' +
                    '<span style="flex:1;font-size:12px;">' + self._esc(m.display_name || m.username || ('用户#' + m.id)) + (isAdmin ? ' <span style="font-size:9px;color:#8b5cf6;">主理人</span>' : '') + '</span>' +
                    '<span style="font-size:10px;color:#94a3b8;">' + (m.role === 'admin' ? '主理人' : '成员') + '</span>' + chk + '</div>';
            }).join('');
            ov.innerHTML = '<div class="modal-content" style="max-width:460px;border-radius:14px;padding:16px;" onclick="event.stopPropagation()">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:600;">🔑 团队上传权限</span>' +
                '<button style="border:none;background:none;font-size:16px;color:var(--text-muted);cursor:pointer;" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>' +
                '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">开启后账号在任务队列中可见「📤 上传」按钮（上传到光厂）；仅主理人可设置，主理人也需勾选。</div>' +
                (self._isAdmin ? rows : '<div style="font-size:12px;color:#94a3b8;padding:12px;text-align:center;">仅主理人可管理成员权限</div>') +
                '</div>';
            document.body.appendChild(ov);
        });
    },
    VJ.setPerm = async function (userId, on) {
        var d = await App.fetchJSON('/api/team/permissions/' + userId, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload: on })
        });
        if (d && d.ok) this._toast('✅ 已' + (on ? '开启' : '关闭') + '上传权限', 'success');
        else this._toast((d && d.detail) || '设置未完成', 'error');
    },
    // 页面加载时拉取权限（控制按钮显示）
    VJ.initPerm = function () {
        if (VJ._teamActive()) VJ._loadPerm();
    };
})();
