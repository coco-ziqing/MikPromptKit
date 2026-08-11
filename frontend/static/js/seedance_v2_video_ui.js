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
        // v5.36.7: 加载即梦有效会话列表（下拉选择，避免无效会话 1001 错误）
        try {
            var sd = await App.fetchJSON('/api/v2/dreamina/status');
            if (sd && sd.ok) this._videoLoginOk = sd.logged_in;
        } catch (e) {}
        try {
            var s2 = await App.fetchJSON('/api/seedance/v2/video/tasks?limit=1');
            // 从最近提交响应缓存会话列表（若无则后端提交时返回）
        } catch (e) {}
        this._videoSessions = null; // 提交时由后端返回后填充
    };

    // 打开提交弹窗（三步引导：①范围 ②参数确认 ③提交）
    App.seedanceV2.openVideoSubmit = async function() {
        if (!this._videoCfg) await this._loadVideoCfg();
        var cfg = this._videoCfg || {model_versions:['seedance2.0fast'], ratios:['16:9'], resolutions:['720p'], cli_available:true,
                                     proj_res_map:{}, model_max_res:{}};
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

        // ===== 参数默认值：优先项目全局参数（v5.36.0 联动） =====
        var defModel = p.video_model || 'seedance2.0fast';
        var defRes = p.video_resolution || '720p';
        var defRatio = p.aspect_ratio || '16:9';
        var defSession = (p.video_session===undefined||p.video_session===null)?0:p.video_session;

        var modelOpts = '';
        for (var i = 0; i < cfg.model_versions.length; i++) {
            var m = cfg.model_versions[i];
            var label = m === 'seedance2.0fast' ? 'seedance2.0fast (默认·均衡)' : m;
            modelOpts += '<option value="'+m+'"'+(m===defModel?' selected':'')+'>'+label+'</option>';
        }
        var ratioOpts = '';
        for (var j = 0; j < cfg.ratios.length; j++) {
            var r = cfg.ratios[j];
            ratioOpts += '<option value="'+r+'"'+(r===defRatio?' selected':'')+'>'+r+'</option>';
        }
        var resOpts = '';
        for (var k = 0; k < cfg.resolutions.length; k++) {
            resOpts += '<option value="'+cfg.resolutions[k]+'"'+(cfg.resolutions[k]===defRes?' selected':'')+'>'+cfg.resolutions[k]+'</option>';
        }

        // ===== 参数映射提示（项目分辨率 → 即梦建议） =====
        var projRes = p.resolution || '4K';
        var mappedRes = (cfg.proj_res_map && cfg.proj_res_map[projRes]) || '720p';
        var maxRes = (cfg.model_max_res && cfg.model_max_res[defModel]) || '720p';
        var resTip = '';
        if (projRes !== mappedRes) {
            resTip = '<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);color:#d97706;border-radius:6px;padding:6px 10px;font-size:11px;margin-top:6px;">⚠️ 项目分辨率 '+projRes+' 超出/不匹配即梦档位，已映射为 <strong>'+mappedRes+'</strong>（模型 '+defModel+' 上限 '+maxRes+'，可选 2.0_vip 升至 4k）。</div>';
        } else {
            resTip = '<div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);color:#10b981;border-radius:6px;padding:6px 10px;font-size:11px;margin-top:6px;">✅ 项目分辨率 '+projRes+' 与即梦参数一致（模型 '+defModel+' 上限 '+maxRes+'）。</div>';
        }

        overlay.innerHTML = '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:540px;">' +
            '<div class="modal-header"><h5>🎬 即梦视频生成</h5><button class="header-btn-sm" onclick="document.getElementById(\'s2VideoSubmit\').remove()">&times;</button></div>' +
            '<div class="modal-body">' + loginWarn +
            '<div style="display:flex;gap:6px;margin-bottom:12px;">' +
            '<span style="flex:1;text-align:center;font-size:11px;padding:4px 0;border-radius:6px;background:rgba(79,70,229,0.1);color:#6366f1;font-weight:600;">① 选择范围</span>' +
            '<span style="flex:1;text-align:center;font-size:11px;padding:4px 0;border-radius:6px;background:rgba(79,70,229,0.1);color:#6366f1;font-weight:600;">② 确认参数</span>' +
            '<span style="flex:1;text-align:center;font-size:11px;padding:4px 0;border-radius:6px;background:var(--hover-bg);color:var(--text-muted);font-weight:600;">③ 提交生成</span>' +
            '</div>' +
            '<div style="margin-bottom:10px;"><label style="font-size:11px;color:var(--text-muted);">生成范围</label>' +
            '<div style="display:flex;gap:8px;margin-top:4px;">' +
            '<label style="flex:1;border:1px solid var(--border-color);border-radius:8px;padding:8px;cursor:pointer;text-align:center;font-size:13px;" class="s2-video-scope-opt">' +
            '<input type="radio" name="s2VideoScope" value="scenes" checked style="margin-right:4px;">逐镜头生成<br><span style="font-size:10px;color:var(--text-muted);">每镜头一段视频（推荐）</span></label>' +
            '<label style="flex:1;border:1px solid var(--border-color);border-radius:8px;padding:8px;cursor:pointer;text-align:center;font-size:13px;" class="s2-video-scope-opt">' +
            '<input type="radio" name="s2VideoScope" value="all" style="margin-right:4px;">整项目生成<br><span style="font-size:10px;color:var(--text-muted);">拼接为一段（≤15s）</span></label>' +
            '</div></div>' +
            '<div style="margin-bottom:10px;"><label style="font-size:11px;color:var(--text-muted);">模型版本</label>' +
            '<select id="s2VideoModel" class="s2-input" style="width:100%;margin-top:2px;" onchange="App.seedanceV2._videoModelChanged(this)">'+modelOpts+'</select></div>' +
            '<div style="display:flex;gap:10px;margin-bottom:4px;">' +
            '<div style="flex:1;"><label style="font-size:11px;color:var(--text-muted);">画幅（来自全局参数）</label>' +
            '<select id="s2VideoRatio" class="s2-input" style="width:100%;margin-top:2px;">'+ratioOpts+'</select></div>' +
            '<div style="flex:1;"><label style="font-size:11px;color:var(--text-muted);">分辨率</label>' +
            '<select id="s2VideoRes" class="s2-input" style="width:100%;margin-top:2px;">'+resOpts+'</select></div>' +
            '<div style="flex:0.9;"><label style="font-size:11px;color:var(--text-muted);">即梦会话</label>' +
            '<select id="s2VideoSession" class="s2-input" style="width:100%;margin-top:2px;" title="即梦 CLI --session">' +
            '<option value="0">0 · 默认对话</option>' +
            (self._videoSessions ? self._videoSessions.map(function(s){ return '<option value="'+s.id+'"'+(String(s.id)===String(defSession)?' selected':'')+'>'+s.id+' · '+App._escape((s.name||'').substring(0,12))+'</option>'; }).join('') : '') +
            '</select></div>' +
            '</div>' +
            '<div id="s2VideoResTip">'+resTip+'</div>' +
            '<div id="s2VideoRefsBox" style="margin-top:8px;"></div>' +
            '<div id="s2VideoPrecheck" style="margin-top:8px;"></div>' +
            '<div style="background:var(--hover-bg);border-radius:6px;padding:8px 10px;font-size:11px;color:var(--text-muted);margin-top:8px;">' +
            '⏱ 预计时长：整项目='+(p.total_duration||15)+'s（上限15s，超长请用逐镜头）；逐镜头=各镜头时长（自动收敛 4-15s，seedance2.5 可达 30s）<br>' +
            '📌 即梦生成异步执行，提交后可到「📺 任务面板」查看进度与结果。</div>' +
            '</div>' +
            '<div class="modal-footer"><button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'s2VideoSubmit\').remove()">取消</button>' +
            '<button class="btn btn-primary btn-sm" id="s2VideoSubmitBtn">③ 提交生成</button></div></div>';
        document.body.appendChild(overlay);
        // v5.36.2: 加载将携带的参考图预览
        this._loadSubmitRefsPreview();
        // v5.36.7: 提交前预检 + 参数变化时重检
        this._runVideoPrecheck();
        var self2 = this;
        document.querySelectorAll('input[name="s2VideoScope"]').forEach(function(el){
            el.addEventListener('change', function(){ self2._runVideoPrecheck(); });
        });
        var vm = document.getElementById('s2VideoModel');
        if (vm) vm.addEventListener('change', function(){ self2._runVideoPrecheck(); });
        var vr = document.getElementById('s2VideoRes');
        if (vr) vr.addEventListener('change', function(){ self2._runVideoPrecheck(); });
        document.getElementById('s2VideoSubmitBtn').onclick = function() {
            var scope = document.querySelector('input[name="s2VideoScope"]:checked');
            var model = document.getElementById('s2VideoModel').value;
            var ratio = document.getElementById('s2VideoRatio').value;
            var res = document.getElementById('s2VideoRes').value;
            var sel = document.getElementById('s2VideoSession');
            var session = parseInt(sel ? sel.value : '0') || 0;
            self._doVideoSubmit(scope ? scope.value : 'scenes', model, ratio, res, session);
        };
    };

    // v5.36.7: 提交前预检（调用后端 /video/precheck，不消耗额度）
    App.seedanceV2._runVideoPrecheck = async function() {
        var box = document.getElementById('s2VideoPrecheck');
        if (!box) return;
        var self = this;
        if (!this.currentProjectId) return;
        box.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">🔍 提交预检中...</div>';
        try {
            var scope = 'scenes';
            var rdo = document.querySelector('input[name="s2VideoScope"]:checked');
            if (rdo) scope = rdo.value;
            var model = document.getElementById('s2VideoModel') ? document.getElementById('s2VideoModel').value : '';
            var res = document.getElementById('s2VideoRes') ? document.getElementById('s2VideoRes').value : '';
            var sel = document.getElementById('s2VideoSession');
            var session = sel ? parseInt(sel.value || '0') : 0;
            var d = await App.fetchJSON('/api/seedance/v2/video/precheck', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ project_id: this.currentProjectId, scope: scope,
                    model_version: model, resolution: res, session: session }),
                _timeoutMs: 20000
            });
            if (!d || !d.ok) { box.innerHTML = ''; return; }
            var h = '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;font-size:11px;">';
            var errs = (d.issues || []).filter(function(i){ return i.level === 'error'; });
            var warns = (d.issues || []).filter(function(i){ return i.level === 'warn'; });
            if (!errs.length && !warns.length && !d.warnings.length) {
                h += '<div style="color:#10b981;">✅ 预检通过：'+d.summary.scene_count+' 个镜头可提交（'+d.summary.warn_count+' 项提示）</div>';
            } else {
                if (errs.length) {
                    h += '<div style="color:#ef4444;font-weight:600;margin-bottom:4px;">❌ 阻止提交（'+errs.length+'）：</div>';
                    for (var i = 0; i < errs.length; i++) {
                        h += '<div style="color:#ef4444;margin-left:8px;">· '+App._escape(errs[i].item)+': '+App._escape(errs[i].detail)+'</div>';
                    }
                }
                if (warns.length) {
                    h += '<div style="color:#f59e0b;font-weight:600;margin-top:4px;">⚠️ 注意（'+warns.length+'）：</div>';
                    for (var j = 0; j < warns.length; j++) {
                        h += '<div style="color:#f59e0b;margin-left:8px;">· '+App._escape(warns[j].item)+': '+App._escape(warns[j].detail)+'</div>';
                    }
                }
                for (var k = 0; k < (d.warnings || []).length; k++) {
                    h += '<div style="color:var(--text-muted);margin-left:8px;">· '+App._escape(d.warnings[k].detail)+'</div>';
                }
            }
            h += '</div>';
            box.innerHTML = h;
        } catch (e) { box.innerHTML = ''; }
    };

    // v5.36.2: 提交弹窗参考图预览（全局+镜头合并，显示生产方式）
    App.seedanceV2._loadSubmitRefsPreview = async function() {
        var box = document.getElementById('s2VideoRefsBox');
        if (!box) return;
        var self = this;
        if (!this.currentProjectId) return;
        try {
            var refs = [];
            var gd = await App.fetchJSON('/api/seedance/v2/refs?project_id='+this.currentProjectId);
            if (gd && gd.items) refs = refs.concat(gd.items);
            // 逐镜头（scope=scenes 时前端先显示总数提示）
            var sceneTotal = 0;
            var scenes = this.scenes || [];
            for (var i = 0; i < scenes.length; i++) {
                var dd = await App.fetchJSON('/api/seedance/v2/refs?project_id='+this.currentProjectId+'&scene_id='+scenes[i].id);
                if (dd && dd.items) sceneTotal += dd.items.length;
            }
            if (!refs.length && !sceneTotal) {
                box.innerHTML = '<div style="font-size:11px;color:var(--text-muted);background:var(--hover-bg);border-radius:6px;padding:6px 10px;">📝 生产方式：纯文本（无图像参考）。可在镜头卡「🖼 参考」或全局参数「🖼 全局图像参考」添加。</div>';
                return;
            }
            var mode = '';
            var total = refs.length + sceneTotal;
            if (total === 0) mode = '📝 纯文本';
            else if (total === 1) mode = '🖼 单图参考 → image2video';
            else mode = '🖼🖼 多图参考('+total+') → multimodal2video';
            var h = '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:#8b5cf6;">'+mode+'</div>';
            if (refs.length) {
                h += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">全局参考 ('+refs.length+'):</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px;align-items:center;">';
                for (var j = 0; j < refs.length; j++) {
                    var rt = refs[j].ref_type === 'scene' ? '🏞场景' : (refs[j].ref_type === 'style' ? '🎨风格' : '🧑角色');
                    var rn = refs[j].ref_name || (refs[j].ref_type === 'character' ? '(未命名⚠️)' : '');
                    h += '<span style="display:inline-flex;flex-direction:column;align-items:center;gap:2px;" title="'+App._escape(rn)+'">' +
                        '<img src="'+App._escape(refs[j].preview_url||refs[j].url||'')+'" style="width:36px;height:36px;object-fit:cover;border-radius:5px;border:1px solid var(--border-color);" onerror="this.style.opacity=0.2">' +
                        '<span style="font-size:8px;color:var(--text-muted);max-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+App._escape(rt+' '+(rn||''))+'</span></span>';
                }
                h += '</div>';
            }
            if (sceneTotal) {
                h += '<div style="font-size:10px;color:var(--text-muted);">+ '+sceneTotal+' 张镜头级参考图（逐镜头模式时随镜头携带）</div>';
            }
            box.innerHTML = h;
        } catch (e) {
            box.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">参考图加载失败</div>';
        }
    };

    // 模型切换时更新分辨率映射提示
    App.seedanceV2._videoModelChanged = function(sel) {
        var model = sel.value;
        var cfg = this._videoCfg || {};
        var maxRes = (cfg.model_max_res && cfg.model_max_res[model]) || '720p';
        var tip = document.getElementById('s2VideoResTip');
        if (!tip) return;
        var resSel = document.getElementById('s2VideoRes');
        if (resSel) {
            var cur = resSel.value;
            var allowed = ['480p','720p','1080p','4k'];
            var valid = ['480p','720p','1080p','4k'].indexOf(cur) >= 0;
            // 按模型过滤可用档位
            if (model === 'seedance2.5') {
                resSel.innerHTML = '<option value="480p">480p</option><option value="720p">720p</option>';
                if (cur !== '480p' && cur !== '720p') cur = '720p';
            } else if (model === 'seedance2.0_vip') {
                resSel.innerHTML = '<option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4k</option>';
                if (cur === '480p') cur = '720p';
            } else {
                resSel.innerHTML = '<option value="720p">720p</option>';
                cur = '720p';
            }
            resSel.value = cur;
        }
        tip.innerHTML = '💡 模型 '+model+' 分辨率上限 <strong>'+maxRes+'</strong>；切换 2.0_vip 可升至 1080p/4k，seedance2.5 仅 480p/720p（支持 30s 长视频）。';
    };

    // 提交视频任务
    App.seedanceV2._doVideoSubmit = async function(scope, model, ratio, res, session) {
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
                    session: session || 0,
                    task_type: 'text2video'
                }),
                _timeoutMs: 30000
            });
            var m = document.getElementById('s2VideoSubmit'); if (m) m.remove();
            if (d && d.ok) {
                App.showToast('✅ 已提交 '+d.count+' 个视频任务', 'success');
                // v5.36.7: 缓存会话列表供下次下拉 + 无效会话回退提示
                if (d.sessions && d.sessions.length) this._videoSessions = d.sessions;
                if (d.session_fallback) App.showToast('⚠️ 所选会话无效，已自动使用默认会话 0', 'warning');
                this.openVideoPanel();
                if (App.seedanceV2._refreshVideoBadges) App.seedanceV2._refreshVideoBadges();
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
            '<div class="modal-body" style="flex:1;overflow-y:auto;">' +
            '<div id="s2VideoSummary" style="margin-bottom:10px;"></div>' +
            '<div id="s2VideoTaskList"><div style="text-align:center;padding:30px;color:var(--text-muted);">加载中...</div></div></div>' +
            '<div class="modal-footer" style="justify-content:space-between;">' +
            '<span style="display:flex;gap:8px;align-items:center;"><span style="font-size:11px;color:var(--text-muted);" id="s2VideoPollHint">每 8 秒自动刷新</span>' +
            '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2.openVideoTemplates()" style="color:#8b5cf6;border-color:#8b5cf6;font-size:11px;padding:2px 10px;">📚 模版库</button></span>' +
            '<button class="btn btn-secondary btn-sm" onclick="App.seedanceV2.closeVideoPanel()">关闭</button></div></div>';
        document.body.appendChild(overlay);
        this._loadVideoTasks();
        this._startVideoPoll();
    };

    // v5.36.8: 视频任务完成通知（新完成探测 → toast + 标题闪烁 + 声音）
    App.seedanceV2._notifyVideoCompletions = async function() {
        if (!this.currentProjectId) return;
        var self = this;
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/tasks?project_id='+this.currentProjectId+'&limit=20');
            if (!d || !d.items) return;
            var items = d.items;
            // 只探测近 90 秒内完成的成功任务（新完成）
            var now = Date.now();
            var newlyDone = [];
            for (var i = 0; i < items.length; i++) {
                var t = items[i];
                if (t.status !== 'success') continue;
                var ft = t.finished_at || '';
                var ts = 0;
                if (ft) {
                    var p = ft.split(/[-: ]/);
                    if (p.length >= 6) ts = new Date(+p[0], +p[1]-1, +p[2], +p[3], +p[4], +p[5]).getTime();
                }
                if (ts && (now - ts) < 90000) newlyDone.push(t);
            }
            if (!newlyDone.length) return;
            // 防重复通知（sessionStorage 记录已通知的 task id）
            var notified = [];
            try { notified = JSON.parse(sessionStorage.getItem('vt_notified') || '[]'); } catch(e) {}
            var fresh = newlyDone.filter(function(t){ return notified.indexOf(t.id) < 0; });
            if (!fresh.length) return;
            notified = notified.concat(fresh.map(function(t){ return t.id; })).slice(-30);
            try { sessionStorage.setItem('vt_notified', JSON.stringify(notified)); } catch(e) {}
            // 通知
            for (var j = 0; j < fresh.length; j++) {
                App.showToast('🎬 视频生成完成：任务 #'+fresh[j].id, 'success');
            }
            // 标题闪烁 + 声音
            self._flashTitleAndBeep(fresh.length);
        } catch (e) { /* 静默 */ }
    };

    // 标题闪烁 + 提示音
    App.seedanceV2._flashTitleAndBeep = function(count) {
        // 声音（Web Audio 短音）
        try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) {
                var ctx = new Ctx();
                var o = ctx.createOscillator();
                var g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.frequency.value = 880;
                g.gain.value = 0.15;
                o.start();
                setTimeout(function(){ o.stop(); ctx.close(); }, 300);
            }
        } catch(e) {}
        // 标题闪烁
        var orig = document.title;
        var flips = 0;
        var timer = setInterval(function() {
            document.title = (flips % 2 === 0) ? '🎬 ' + count + ' 个视频已完成!' : orig;
            flips++;
            if (flips >= 8) { clearInterval(timer); document.title = orig; }
        }, 500);
        // 5s 后强制恢复
        setTimeout(function(){ clearInterval(timer); document.title = orig; }, 6000);
    };

    App.seedanceV2.closeVideoPanel = function() {
        var m = document.getElementById('s2VideoPanel'); if (m) m.remove();
        this._stopVideoPoll();
        if (App.seedanceV2._refreshVideoBadges) App.seedanceV2._refreshVideoBadges();
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
            if (self._loadVideoTaskCache) self._loadVideoTaskCache();
            if (self._notifyVideoCompletions) self._notifyVideoCompletions();
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
                var sum = document.getElementById('s2VideoSummary');
                if (sum) sum.innerHTML = '';
            } else {
                var statusMap = {
                    'queued': ['排队中', '#94a3b8'],
                    'submitting': ['提交中', '#f59e0b'],
                    'querying': ['生成中', '#f59e0b'],
                    'success': ['✅ 成功', '#10b981'],
                    'fail': ['❌ 失败', '#ef4444']
                };
                // ===== 聚合进度统计 =====
                var done = 0, failed = 0, active = 0, totalProg = 0;
                for (var si2 = 0; si2 < items.length; si2++) {
                    var st2 = items[si2].status;
                    if (st2 === 'success') done++;
                    else if (st2 === 'fail') failed++;
                    else active++;
                    totalProg += (items[si2].progress || 0);
                }
                var total = items.length;
                var avgProg = total ? Math.round(totalProg / total) : 0;
                var sumEl = document.getElementById('s2VideoSummary');
                if (sumEl) {
                    var donePct = total ? Math.round(done / total * 100) : 0;
                    sumEl.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:4px;">' +
                        '<span><strong>'+done+'</strong>/'+total+' 完成'+(active?' · <span style="color:#f59e0b;">'+active+' 进行中</span>':'')+(failed?' · <span style="color:#ef4444;">'+failed+' 失败</span>':'')+'</span>' +
                        '<span style="font-weight:700;color:'+(donePct===100?'#10b981':'var(--text-main)')+';">'+donePct+'%</span></div>' +
                        '<div style="height:8px;background:var(--hover-bg);border-radius:4px;overflow:hidden;">' +
                        '<div style="height:100%;width:'+donePct+'%;background:linear-gradient(90deg,#10b981,#22c55e);border-radius:4px;transition:width 0.6s;"></div></div>' +
                        '</div>';
                }
                h = '<div style="display:flex;flex-direction:column;gap:8px;">';
                for (var i = 0; i < items.length; i++) {
                    var t = items[i];
                    var st = statusMap[t.status] || [t.status, '#94a3b8'];
                    var sceneLabel = t.scene_id ? ('镜头 #' + (function(){ for (var si=0; si<App.seedanceV2.scenes.length; si++){ if(App.seedanceV2.scenes[si].id===t.scene_id) return App.seedanceV2.scenes[si].scene_order; } return t.scene_id; })()) : '整项目';
                    var promptShort = (t.prompt || '').substring(0, 60);
                    var prog = t.progress || 0;
                    if (t.status === 'success') prog = 100;
                    if (t.status === 'queued') prog = 5;
                    if (t.status === 'submitting') prog = 10;
                    // 已等待时长（进行中任务）
                    var waitHtml = '';
                    if (t.status === 'querying' || t.status === 'submitting' || t.status === 'queued') {
                        var stTs = t.started_at || t.created_at || '';
                        var waitSec = 0;
                        if (stTs) {
                            var parts = stTs.split(/[-: ]/);
                            if (parts.length >= 6) {
                                var d0 = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]), parseInt(parts[3]), parseInt(parts[4]), parseInt(parts[5]));
                                waitSec = Math.max(0, Math.round((Date.now() - d0.getTime()) / 1000));
                            }
                        }
                        waitHtml = waitSec > 0 ? (' · 已等待 '+Math.floor(waitSec/60)+'分'+ (waitSec%60)+'秒') : '';
                    }
                    var barColor = t.status === 'success' ? 'linear-gradient(90deg,#10b981,#22c55e)' : (t.status === 'fail' ? 'linear-gradient(90deg,#ef4444,#f87171)' : 'linear-gradient(90deg,#f59e0b,#fbbf24)');
                    var barHtml = '<div style="height:6px;background:var(--hover-bg);border-radius:3px;overflow:hidden;margin-top:4px;">' +
                        '<div style="height:100%;width:'+prog+'%;background:'+barColor+';border-radius:3px;transition:width 0.8s;'+(t.status==='querying'?'animation:s2ProgressStripe 1s linear infinite;background-image:linear-gradient(45deg,rgba(255,255,255,0.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,0.15) 50%,rgba(255,255,255,0.15) 75%,transparent 75%);background-size:20px 20px;background-color:#f59e0b;':'')+'"></div></div>';
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
                        // v5.36.4: 存档为分镜视频模版
                        var archiveBtn = '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._archiveTaskAsTemplate('+t.id+')" style="color:#8b5cf6;border-color:#8b5cf6;" title="将本视频与提示词存档为词库模版">📥 存档为模版</button>';
                        actionHtml = '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap;">'+preview+dl+archiveBtn+'</div>';
                    } else if (t.status === 'fail') {
                        // v5.36.7: 分类引导文案
                        var catMap = {
                            'concurrency': '⏳ 即梦并发超限 — 稍后自动重试',
                            'param': '⚠️ 参数错误 — 检查会话/画幅/分辨率后重试',
                            'compliance': '📋 需先在即梦网页端完成模型授权',
                            'upload': '🖼 参考图上传失败 — 已自动压缩重试',
                            'timeout': '⏱ 任务超时 — 重试或减少参考图',
                            'login': '🔑 即梦未登录 — 请到授权中心登录',
                            'unknown': ''
                        };
                        var cat = t.fail_category || '';
                        var catHint = catMap[cat] || '';
                        actionHtml = '<div style="margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                            '<span style="font-size:10px;color:#ef4444;">'+(t.fail_reason||'未知原因').substring(0,80)+'</span>' +
                            (catHint ? '<span style="font-size:10px;color:#f59e0b;">'+catHint+'</span>' : '') +
                            '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._retryVideoTask('+t.id+')" style="color:#10b981;border-color:#10b981;">↩ 重试</button></div>';
                    }
                    h += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;background:var(--bg-card);">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
                        '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
                        '<span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">#'+t.id+'</span>' +
                        '<span style="font-size:12px;font-weight:600;white-space:nowrap;">'+sceneLabel+'</span>' +
                        '<span style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+App._escape(t.prompt||'')+'">'+App._escape(promptShort)+'</span>' +
                        '</div>' +
                        '<span style="font-size:11px;padding:2px 8px;border-radius:10px;white-space:nowrap;background:'+st[1]+'22;color:'+st[1]+';font-weight:600;">'+st[0]+(t.status==='querying'||t.status==='submitting'||t.status==='queued'?' '+prog+'%':'')+'</span>' +
                        '</div>' +
                        '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">'+t.model_version+' · '+t.ratio+' · '+t.video_resolution+' · '+t.duration+'s'+(t.created_at?' · '+t.created_at:'')+waitHtml+'</div>' +
                        barHtml +
                        actionHtml +
                        '</div>';
                }
                h += '</div>';
            }
            c.innerHTML = h;
            // v5.36.7: 自动重试（concurrency/upload 类，每任务最多1次，防抖30s）
            var now = Date.now();
            for (var ai = 0; ai < items.length; ai++) {
                var it = items[ai];
                if (it.status !== 'fail') continue;
                var cat = it.fail_category || '';
                if (cat !== 'concurrency' && cat !== 'upload' && cat !== 'timeout') continue;
                var key = 'vt_retry_' + it.id;
                var last = 0;
                try { last = parseInt(localStorage.getItem(key) || '0'); } catch(e) {}
                if (now - last > 30000) {
                    try { localStorage.setItem(key, String(now)); } catch(e) {}
                    this._retryVideoTask(it.id);
                }
            }
        } catch (e) {
            if (!silent) { c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">加载失败: '+App._escape(e.message)+'</div>'; }
        }
    };

    // v5.36.4: 存档任务为分镜视频模版
    App.seedanceV2._archiveTaskAsTemplate = async function(taskId) {
        var self = this;
        var name = prompt('模版名称（可空，自动生成）', '');
        if (name === null) return;
        App.showToast('正在存档为模版...', 'info');
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/tasks/'+taskId+'/archive-template', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ name: name || '' }), _timeoutMs: 30000
            });
            if (d && d.ok) {
                App.showToast('✅ 已存档为模版「'+d.name+'」', 'success');
            } else {
                App.showToast('存档未完成: ' + (d ? (d.detail||'未知错误') : '无响应'), 'error');
            }
        } catch (e) { App.showToast('存档异常: '+e.message, 'error'); }
    };

    // 打开分镜视频模版管理面板
    App.seedanceV2.openVideoTemplates = async function() {
        var old = document.getElementById('s2VideoTplPanel');
        if (old) old.remove();
        var self = this;
        var overlay = document.createElement('div');
        overlay.id = 's2VideoTplPanel';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:715;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:820px;max-height:82vh;display:flex;flex-direction:column;">' +
            '<div class="modal-header"><h5>🎬 分镜视频模版库</h5><button class="header-btn-sm" onclick="document.getElementById(\'s2VideoTplPanel\').remove()">&times;</button></div>' +
            '<div class="modal-body" style="flex:1;overflow-y:auto;" id="s2VideoTplList"><div style="text-align:center;padding:30px;color:var(--text-muted);">加载中...</div></div>' +
            '<div class="modal-footer"><span style="font-size:11px;color:var(--text-muted);">模版存档于词库「分镜视频模版」分组，可复用提示词重新生成</span>' +
            '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'s2VideoTplPanel\').remove()">关闭</button></div></div>';
        document.body.appendChild(overlay);
        this._loadVideoTemplates();
    };

    // 加载模版列表
    App.seedanceV2._loadVideoTemplates = async function() {
        var c = document.getElementById('s2VideoTplList');
        if (!c) return;
        var self = this;
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/templates');
            if (!d || !d.items) return;
            var items = d.items;
            var h = '';
            if (!items.length) {
                h = '<div style="text-align:center;padding:40px;color:var(--text-muted);">暂无模版<br><span style="font-size:11px;">在任务面板对成功的视频点「📥 存档为模版」即可入库</span></div>';
            } else {
                h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">';
                for (var i = 0; i < items.length; i++) {
                    var t = items[i];
                    var vurl = t.video_url || '';
                    h += '<div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;background:var(--bg-card);">' +
                        (vurl ? '<video src="'+App._escape(vurl)+'" controls preload="metadata" style="width:100%;height:130px;object-fit:cover;background:#000;"></video>'
                              : '<div style="height:130px;background:var(--hover-bg);display:flex;align-items:center;justify-content:center;font-size:32px;">🎬</div>') +
                        '<div style="padding:8px 10px;">' +
                        '<div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+App._escape(t.name||'')+'">'+App._escape(t.name||'未命名')+'</div>' +
                        '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;max-height:32px;overflow:hidden;">'+App._escape((t.meaning||'').substring(0,50))+'</div>' +
                        '<div style="display:flex;gap:6px;margin-top:6px;">' +
                        '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._copyTemplatePrompt('+t.id+')" title="复制提示词">📋 复制提示词</button>' +
                        '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._regenFromTemplate('+t.id+')" title="用此模版重新生成（填充为单镜头模板）" style="color:#10b981;border-color:#10b981;">🎬 重新生成</button>' +
                        '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._deleteVideoTemplate('+t.id+')" style="color:#ef4444;border-color:#ef4444;">🗑</button>' +
                        '</div></div></div>';
                }
                h += '</div>';
            }
            c.innerHTML = h;
        } catch (e) {
            c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">加载失败: '+App._escape(e.message)+'</div>';
        }
    };

    // 复制模版提示词
    App.seedanceV2._copyTemplatePrompt = function(cardId) {
        var self = this;
        App.fetchJSON('/api/seedance/v2/libraries/cards/'+cardId).then(function(d) {
            var content = d && d.card ? (d.card.content || '') : '';
            if (!content) { App.showToast('提示词为空', 'warning'); return; }
            navigator.clipboard.writeText(content).then(function() {
                App.showToast('✅ 提示词已复制', 'success');
            }).catch(function() { App.showToast('复制失败，请手动复制', 'error'); });
        });
    };

    // v5.36.9: 模版一键重新生成（创建新项目 + 填充模版提示词 + 打开组装器）
    App.seedanceV2._regenFromTemplate = async function(cardId) {
        App.showToast('正在创建模版复用项目...', 'info');
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/templates/'+cardId+'/regen', {
                method: 'POST', _timeoutMs: 15000
            });
            if (d && d.ok) {
                App.showToast('✅ 已创建项目「'+d.project_name+'」，正在打开...', 'success');
                // 切到分镜组装器视图并打开新项目
                try { localStorage.setItem('promptkit_seedance_project', String(d.project_id)); } catch(e) {}
                if (App.switchView) App.switchView('seedance');
                var m = document.getElementById('s2VideoTplPanel'); if (m) m.remove();
                if (App.seedanceV2 && App.seedanceV2.openProject) {
                    setTimeout(function(){ App.seedanceV2.openProject(d.project_id); }, 300);
                }
            } else {
                App.showToast('创建未完成: ' + (d ? (d.detail||'未知') : '无响应'), 'error');
            }
        } catch (e) { App.showToast('创建异常: '+e.message, 'error'); }
    };

    // 删除模版
    App.seedanceV2._deleteVideoTemplate = async function(cardId) {
        if (!confirm('确定删除此分镜视频模版？')) return;
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/templates/'+cardId, { method:'DELETE' });
            if (d && d.ok) { App.showToast('模版已删除', 'info'); this._loadVideoTemplates(); }
            else { App.showToast('删除未完成: ' + (d ? (d.detail||'未知') : '无响应'), 'error'); }
        } catch (e) { App.showToast('删除异常: '+e.message, 'error'); }
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
