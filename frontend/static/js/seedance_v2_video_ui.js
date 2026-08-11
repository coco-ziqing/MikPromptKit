// Seedance V2 即梦视频生成任务面板 (v5.36.0)
// 提交弹窗 + 任务列表 + 状态轮询 + 预览下载
(function() {
    'use strict';

    App.seedanceV2._videoCfg = null;
    App.seedanceV2._videoPollTimer = null;

    // 加载视频配置（模型/比例/分辨率）
    App.seedanceV2._loadVideoCfg = async function() {
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/config');
            if (d && d.ok) this._videoCfg = d;
        } catch (e) { console.warn('video cfg fail', e); }
    };

    // 打开提交弹窗
    App.seedanceV2.openVideoSubmit = async function() {
        if (!this._videoCfg) await this._loadVideoCfg();
        var cfg = this._videoCfg || {model_versions:['seedance2.0fast'], ratios:['16:9'], resolutions:['720p'], cli_available:true};
        var p = this.currentProject || {};
        var old = document.getElementById('s2VideoSubmit');
        if (old) old.remove();
        var self = this;

        // 登录检查
        var loginStatus = null;
        try {
            var st = await App.fetchJSON('/api/v2/dreamina/status');
            if (st) loginStatus = st;
        } catch (e) {}

        var overlay = document.createElement('div');
        overlay.id = 's2VideoSubmit';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:700;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

        var loginWarn = '';
        if (loginStatus && !loginStatus.logged_in) {
            loginWarn = '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);color:#ef4444;border-radius:6px;padding:8px 10px;font-size:12px;margin-bottom:10px;">⚠️ 即梦未登录，提交将失败。请先在 工具 → 生成引擎授权中心 完成即梦登录。</div>';
        }

        var modelOpts = '';
        for (var i = 0; i < cfg.model_versions.length; i++) {
            var m = cfg.model_versions[i];
            var label = m === 'seedance2.0fast' ? 'seedance2.0fast (默认·均衡)' : m;
            modelOpts += '<option value="'+m+'"'+(m==='seedance2.0fast'?' selected':'')+'>'+label+'</option>';
        }
        var ratioOpts = '';
        for (var j = 0; j < cfg.ratios.length; j++) {
            var r = cfg.ratios[j];
            ratioOpts += '<option value="'+r+'"'+(r===(p.aspect_ratio||'16:9')?' selected':'')+'>'+r+'</option>';
        }
        var resOpts = '';
        for (var k = 0; k < cfg.resolutions.length; k++) {
            resOpts += '<option value="'+cfg.resolutions[k]+'"'+(cfg.resolutions[k]==='720p'?' selected':'')+'>'+cfg.resolutions[k]+'</option>';
        }

        overlay.innerHTML = '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:520px;">' +
            '<div class="modal-header"><h5>🎬 即梦视频生成</h5><button class="header-btn-sm" onclick="document.getElementById(\'s2VideoSubmit\').remove()">&times;</button></div>' +
            '<div class="modal-body">' + loginWarn +
            '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">将分镜组装结果提交到即梦生成视频。镜头内容将按标准公式拼接为提示词。</p>' +
            '<div style="margin-bottom:10px;"><label style="font-size:11px;color:var(--text-muted);">生成范围</label>' +
            '<div style="display:flex;gap:8px;margin-top:4px;">' +
            '<label style="flex:1;border:1px solid var(--border-color);border-radius:8px;padding:8px;cursor:pointer;text-align:center;font-size:13px;" class="s2-video-scope-opt">' +
            '<input type="radio" name="s2VideoScope" value="scenes" checked style="margin-right:4px;">逐镜头生成<br><span style="font-size:10px;color:var(--text-muted);">每镜头一段视频</span></label>' +
            '<label style="flex:1;border:1px solid var(--border-color);border-radius:8px;padding:8px;cursor:pointer;text-align:center;font-size:13px;" class="s2-video-scope-opt">' +
            '<input type="radio" name="s2VideoScope" value="all" style="margin-right:4px;">整项目生成<br><span style="font-size:10px;color:var(--text-muted);">拼接为一段（≤15s）</span></label>' +
            '</div></div>' +
            '<div style="margin-bottom:10px;"><label style="font-size:11px;color:var(--text-muted);">模型版本</label>' +
            '<select id="s2VideoModel" class="s2-input" style="width:100%;margin-top:2px;">'+modelOpts+'</select></div>' +
            '<div style="display:flex;gap:10px;margin-bottom:10px;">' +
            '<div style="flex:1;"><label style="font-size:11px;color:var(--text-muted);">画幅</label>' +
            '<select id="s2VideoRatio" class="s2-input" style="width:100%;margin-top:2px;">'+ratioOpts+'</select></div>' +
            '<div style="flex:1;"><label style="font-size:11px;color:var(--text-muted);">分辨率</label>' +
            '<select id="s2VideoRes" class="s2-input" style="width:100%;margin-top:2px;">'+resOpts+'</select></div>' +
            '</div>' +
            '<div style="background:var(--hover-bg);border-radius:6px;padding:8px 10px;font-size:11px;color:var(--text-muted);">' +
            '⏱ 预计时长：整项目='+(p.total_duration||15)+'s（上限15s，超长请用逐镜头）；逐镜头=各镜头时长（自动收敛到 4-15s）<br>' +
            '📌 提示：即梦生成异步执行，提交后可在任务面板查看进度与结果。</div>' +
            '</div>' +
            '<div class="modal-footer"><button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'s2VideoSubmit\').remove()">取消</button>' +
            '<button class="btn btn-primary btn-sm" id="s2VideoSubmitBtn">提交生成</button></div></div>';
        document.body.appendChild(overlay);
        document.getElementById('s2VideoSubmitBtn').onclick = function() {
            var scope = document.querySelector('input[name="s2VideoScope"]:checked');
            var model = document.getElementById('s2VideoModel').value;
            var ratio = document.getElementById('s2VideoRatio').value;
            var res = document.getElementById('s2VideoRes').value;
            self._doVideoSubmit(scope ? scope.value : 'scenes', model, ratio, res);
        };
    };

    // 提交视频任务
    App.seedanceV2._doVideoSubmit = async function(scope, model, ratio, res) {
        if (!this.currentProjectId) { App.showToast('请先选择项目', 'warning'); return; }
        App.showToast('正在提交视频任务...', 'info');
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/tasks', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({
                    project_id: this.currentProjectId,
                    scope: scope,
                    model_version: model,
                    ratio: ratio,
                    resolution: res,
                    task_type: 'text2video'
                }),
                _timeoutMs: 30000
            });
            var m = document.getElementById('s2VideoSubmit'); if (m) m.remove();
            if (d && d.ok) {
                App.showToast('✅ 已提交 '+d.count+' 个视频任务', 'success');
                this.openVideoPanel();
            } else {
                App.showToast('提交未完成: ' + (d ? (d.detail || d.error || '未知错误') : '无响应'), 'error');
            }
        } catch (e) {
            App.showToast('提交异常: ' + e.message, 'error');
        }
    };

    // 打开任务面板
    App.seedanceV2.openVideoPanel = function() {
        var old = document.getElementById('s2VideoPanel');
        if (old) old.remove();
        var self = this;
        var overlay = document.createElement('div');
        overlay.id = 's2VideoPanel';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:710;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === overlay) { overlay.remove(); self._stopVideoPoll(); } };
        overlay.innerHTML = '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:760px;max-height:80vh;display:flex;flex-direction:column;">' +
            '<div class="modal-header"><h5>🎬 视频生成任务</h5><button class="header-btn-sm" onclick="App.seedanceV2.closeVideoPanel()">&times;</button></div>' +
            '<div class="modal-body" style="flex:1;overflow-y:auto;" id="s2VideoTaskList"><div style="text-align:center;padding:30px;color:var(--text-muted);">加载中...</div></div>' +
            '<div class="modal-footer" style="justify-content:space-between;">' +
            '<span style="font-size:11px;color:var(--text-muted);" id="s2VideoPollHint">每 8 秒自动刷新</span>' +
            '<button class="btn btn-secondary btn-sm" onclick="App.seedanceV2.closeVideoPanel()">关闭</button></div></div>';
        document.body.appendChild(overlay);
        this._loadVideoTasks();
        this._startVideoPoll();
    };

    App.seedanceV2.closeVideoPanel = function() {
        var m = document.getElementById('s2VideoPanel'); if (m) m.remove();
        this._stopVideoPoll();
    };

    App.seedanceV2._stopVideoPoll = function() {
        if (this._videoPollTimer) { clearInterval(this._videoPollTimer); this._videoPollTimer = null; }
    };

    App.seedanceV2._startVideoPoll = function() {
        this._stopVideoPoll();
        var self = this;
        this._videoPollTimer = setInterval(function() {
            if (!document.getElementById('s2VideoPanel')) { self._stopVideoPoll(); return; }
            self._loadVideoTasks(true);
        }, 8000);
    };

    // 加载任务列表
    App.seedanceV2._loadVideoTasks = async function(silent) {
        var c = document.getElementById('s2VideoTaskList');
        if (!c) return;
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/tasks?limit=50');
            if (!d || !d.items) return;
            var items = d.items;
            // 只显示当前项目相关（若无项目则全部）
            var pid = this.currentProjectId;
            if (pid) items = items.filter(function(t) { return t.project_id === pid; });
            var h = '';
            if (!items.length) {
                h = '<div style="text-align:center;padding:30px;color:var(--text-muted);">暂无任务，点击「🎬 生成视频」提交</div>';
            } else {
                var statusMap = {
                    'queued': ['排队中', '#94a3b8'],
                    'submitting': ['提交中', '#f59e0b'],
                    'querying': ['生成中', '#f59e0b'],
                    'success': ['✅ 成功', '#10b981'],
                    'fail': ['❌ 失败', '#ef4444']
                };
                h = '<div style="display:flex;flex-direction:column;gap:8px;">';
                for (var i = 0; i < items.length; i++) {
                    var t = items[i];
                    var st = statusMap[t.status] || [t.status, '#94a3b8'];
                    var sceneLabel = t.scene_id ? ('镜头 #' + (function(){ for (var si=0; si<App.seedanceV2.scenes.length; si++){ if(App.seedanceV2.scenes[si].id===t.scene_id) return App.seedanceV2.scenes[si].scene_order; } return t.scene_id; })()) : '整项目';
                    var promptShort = (t.prompt || '').substring(0, 60);
                    var actionHtml = '';
                    if (t.status === 'success') {
                        var preview = '';
                        var dl = '';
                        if (t.result_local) {
                            var vurl = '/api/seedance/v2/video/files/' + encodeURIComponent(t.result_local);
                            preview = '<video src="'+vurl+'" controls style="max-width:200px;max-height:110px;border-radius:6px;background:#000;margin-right:8px;"></video>';
                            dl = '<a class="btn btn-xs btn-outline" href="'+vurl+'" download style="text-decoration:none;">💾 下载</a>';
                        } else if (t.result_url) {
                            preview = '<a href="'+t.result_url+'" target="_blank" class="btn btn-xs btn-outline">🔗 打开原链接</a>';
                        }
                        actionHtml = '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">'+preview+dl+'</div>';
                    } else if (t.status === 'fail') {
                        actionHtml = '<div style="margin-top:4px;display:flex;align-items:center;gap:8px;">' +
                            '<span style="font-size:10px;color:#ef4444;">'+(t.fail_reason||'未知原因').substring(0,80)+'</span>' +
                            '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._retryVideoTask('+t.id+')" style="color:#10b981;border-color:#10b981;">↩ 重试</button></div>';
                    }
                    h += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;background:var(--bg-card);">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
                        '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
                        '<span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">#'+t.id+'</span>' +
                        '<span style="font-size:12px;font-weight:600;white-space:nowrap;">'+sceneLabel+'</span>' +
                        '<span style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+App._escape(t.prompt||'')+'">'+App._escape(promptShort)+'</span>' +
                        '</div>' +
                        '<span style="font-size:11px;padding:2px 8px;border-radius:10px;white-space:nowrap;background:'+st[1]+'22;color:'+st[1]+';font-weight:600;">'+st[0]+'</span>' +
                        '</div>' +
                        '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">'+t.model_version+' · '+t.ratio+' · '+t.video_resolution+' · '+t.duration+'s'+(t.created_at?' · '+t.created_at:'')+'</div>' +
                        actionHtml +
                        '</div>';
                }
                h += '</div>';
            }
            c.innerHTML = h;
        } catch (e) {
            if (!silent) { c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">加载失败: '+App._escape(e.message)+'</div>'; }
        }
    };

    // 重试任务
    App.seedanceV2._retryVideoTask = async function(taskId) {
        App.showToast('正在重试任务 #'+taskId+'...', 'info');
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/tasks/'+taskId+'/retry', {
                method: 'POST', _timeoutMs: 15000
            });
            if (d && d.ok) {
                App.showToast('已重新入队', 'success');
                this._loadVideoTasks(true);
            } else {
                App.showToast('重试未完成: ' + (d ? (d.detail || '未知') : '无响应'), 'error');
            }
        } catch (e) {
            App.showToast('重试异常: ' + e.message, 'error');
        }
    };

})();
