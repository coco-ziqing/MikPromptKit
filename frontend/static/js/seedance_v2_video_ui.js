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
        // v5.36.27: 按模型过滤分辨率档位（与 _videoModelChanged 一致，避免选了模型不支持的值）
        var _allowedRes = ['480p','720p','1080p','4k'];
        if (defModel === 'seedance2.5') _allowedRes = ['480p','720p'];
        else if (defModel === 'seedance2.0_vip') _allowedRes = ['720p','1080p','4k'];
        else _allowedRes = ['720p'];
        var _resValid = false;
        function _resLabel2(v){ return v==='4k' ? '4K' : v; }
        for (var k = 0; k < _allowedRes.length; k++) {
            if (_allowedRes[k] === defRes) _resValid = true;
            resOpts += '<option value="'+_allowedRes[k]+'"'+(_allowedRes[k]===defRes?' selected':'')+'>'+_resLabel2(_allowedRes[k])+'</option>';
        }
        // 项目保存的分辨率不被当前模型支持 → 自动回退到模型允许的最高档
        if (!_resValid) {
            defRes = _allowedRes[_allowedRes.length - 1];
            resOpts = '';
            for (var k2 = 0; k2 < _allowedRes.length; k2++) {
                resOpts += '<option value="'+_allowedRes[k2]+'"'+(_allowedRes[k2]===defRes?' selected':'')+'>'+_resLabel2(_allowedRes[k2])+'</option>';
            }
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
            '<div style="flex:1.1;"><label style="font-size:11px;color:var(--text-muted);">即梦会话 <span style="font-weight:400;">(对话上下文)</span></label>' +
            '<div style="display:flex;gap:4px;">' +
            '<select id="s2VideoSession" class="s2-input" style="flex:1;margin-top:2px;" title="即梦 App 内的对话上下文：同一会话内生成记录/参考素材连贯，不同会话互相独立">' +
            '<option value="0">0 · 默认对话（通用）</option>' +
            (self._videoSessions ? self._videoSessions.map(function(s){ return '<option value="'+s.id+'"'+(String(s.id)===String(defSession)?' selected':'')+'>'+s.id+' · '+App._escape((s.name||'').substring(0,14))+'</option>'; }).join('') : '') +
            '</select>' +
            '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._createVideoSession()" title="新建会话" style="color:#10b981;border-color:#10b981;margin-top:2px;padding:2px 7px;">＋</button>' +
            '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._renameVideoSession()" title="重命名当前会话" style="color:#f59e0b;border-color:#f59e0b;margin-top:2px;padding:2px 7px;">✏️</button>' +
            '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._refreshSubmitSessions()" title="刷新会话列表" style="color:#10b981;border-color:#10b981;margin-top:2px;padding:2px 7px;">🔄</button>' +
            '</div></div>' +
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
        // v5.36.33: 打开弹窗时主动拉取会话列表（显示名称而非裸 ID）
        this._refreshSubmitSessions && this._refreshSubmitSessions();
        // v5.36.7: 提交前预检 + 参数变化时重检
        this._runVideoPrecheck();
        var self2 = this;
        document.querySelectorAll('input[name="s2VideoScope"]').forEach(function(el){
            el.addEventListener('change', function(){ self2._runVideoPrecheck(); });
        });
        // v5.36.12: 弹窗参数变更 ↔ 项目全局参数 双向联动（弹窗修改即保存回全局参数区）
        var vm = document.getElementById('s2VideoModel');
        if (vm) vm.addEventListener('change', function(){ self2._syncVideoParamsFromModal(); self2._runVideoPrecheck(); });
        var vr = document.getElementById('s2VideoRes');
        if (vr) vr.addEventListener('change', function(){ self2._syncVideoParamsFromModal(); self2._runVideoPrecheck(); });
        var vratio = document.getElementById('s2VideoRatio');
        if (vratio) vratio.addEventListener('change', function(){ self2._syncVideoParamsFromModal(); });
        var vsess = document.getElementById('s2VideoSession');
        if (vsess) vsess.addEventListener('change', function(){ self2._syncVideoParamsFromModal(); self2._runVideoPrecheck(); });
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
            // v5.36.35: 收集全局音频（BGM/解说）
            var audios = [];
            try { var ag = await App.fetchJSON('/api/seedance/v2/audio-refs?project_id='+this.currentProjectId); if (ag && ag.items) audios = audios.concat(ag.items); } catch(e) {}
            // 逐镜头（scope=scenes 时前端先显示总数提示）
            var sceneTotal = 0;
            var audioTotal = audios.length;
            var scenes = this.scenes || [];
            for (var i = 0; i < scenes.length; i++) {
                var dd = await App.fetchJSON('/api/seedance/v2/refs?project_id='+this.currentProjectId+'&scene_id='+scenes[i].id);
                if (dd && dd.items) sceneTotal += dd.items.length;
                try { var da = await App.fetchJSON('/api/seedance/v2/audio-refs?project_id='+this.currentProjectId+'&scene_id='+scenes[i].id); if (da && da.items) audioTotal += da.items.length; } catch(e) {}
            }
            if (!refs.length && !sceneTotal && !audioTotal) {
                box.innerHTML = '<div style="font-size:11px;color:var(--text-muted);background:var(--hover-bg);border-radius:6px;padding:6px 10px;">📝 生产方式：纯文本（无图像/音频参考）。可在镜头卡「🖼 参考」「🎵 对白」或全局参数区添加。</div>';
                return;
            }
            var mode = '';
            var total = refs.length + sceneTotal;
            var hasAudio = audioTotal > 0;
            if (total === 0 && !hasAudio) mode = '📝 纯文本';
            else if (total === 1 && !hasAudio) mode = '🖼 单图参考 → image2video';
            else if (hasAudio) mode = '🎬 图文音参考('+total+'图/'+audioTotal+'音) → multimodal2video';
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
            // v5.36.35: 音频预览
            if (audioTotal) {
                var aType = {bgm:'🎵BGM', voice:'🗣对白', narration:'🎙解说'};
                h += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">🎵 音频参考 ('+audioTotal+'): ';
                var names = [];
                var allAud = audios.slice();
                for (var ai2 = 0; ai2 < scenes.length; ai2++) {
                    try { var da2 = await App.fetchJSON('/api/seedance/v2/audio-refs?project_id='+this.currentProjectId+'&scene_id='+scenes[ai2].id); if (da2 && da2.items) allAud = allAud.concat(da2.items); } catch(e) {}
                }
                for (var aj = 0; aj < allAud.length; aj++) {
                    names.push((aType[allAud[aj].audio_type]||'🎵') + (allAud[aj].ref_name ? ' '+App._escape(allAud[aj].ref_name) : ''));
                }
                h += names.join(' · ') + '</div>';
            }
            box.innerHTML = h;
        } catch (e) {
            box.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">参考图加载失败</div>';
        }
    };

    // 模型切换时更新分辨率映射提示
    // v5.36.12: 提交弹窗参数 ↔ 项目全局参数 双向联动 — 弹窗里修改即保存回项目（刷新/重开不丢失）
    // v5.36.33: 提交弹窗刷新会话列表
    App.seedanceV2._refreshSubmitSessions = async function() {
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/sessions?force=1');
            var sessions = (d && d.sessions) ? d.sessions : [];
            this._videoSessions = sessions;
            var sel = document.getElementById('s2VideoSession');
            if (!sel) return;
            var cur = sel.value || '0';
            var opts = '<option value="0">0 · 默认对话（通用）</option>';
            for (var i = 0; i < sessions.length; i++) {
                var s = sessions[i];
                if (String(s.id) === '0') continue;
                opts += '<option value="'+s.id+'"'+(String(s.id)===String(cur)?' selected':'')+'>'+s.id+' · '+App._escape(String(s.name||'').substring(0,14))+'</option>';
            }
            sel.innerHTML = opts;
            App.showToast('✅ 会话列表已刷新', 'success');
        } catch (e) {
            App.showToast('会话刷新失败: ' + e.message, 'error');
        }
    };

    App.seedanceV2._syncVideoParamsFromModal = function() {
        if (!this.currentProjectId) return;
        var self = this;
        var d = {};
        var vm = document.getElementById('s2VideoModel'); if (vm && vm.value) d['video_model'] = vm.value;
        var vr = document.getElementById('s2VideoRes'); if (vr && vr.value) d['video_resolution'] = vr.value;
        var vs = document.getElementById('s2VideoSession'); if (vs && vs.value !== undefined && vs.value !== '') d['video_session'] = parseInt(vs.value || '0') || 0;
        var vr2 = document.getElementById('s2VideoRatio'); if (vr2 && vr2.value) d['aspect_ratio'] = vr2.value;
        if (!Object.keys(d).length) return;
        // 同步内存对象，避免重渲染/重开弹窗读到旧值
        for (var k in d) { if (this.currentProject) this.currentProject[k] = d[k]; }
        if (this._vpSyncTimer) clearTimeout(this._vpSyncTimer);
        this._vpSyncTimer = setTimeout(function(){
            App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId, {
                method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(d)
            }).then(function(r){
                if (r && r.ok) App.showToast('✅ 已同步到项目全局参数','success');
                else console.warn('sync video params fail', r);
            }).catch(function(e){ console.warn('sync video params error', e); });
        }, 400);
    };

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
            '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2.openVideoTemplates()" style="color:#8b5cf6;border-color:#8b5cf6;font-size:11px;padding:2px 10px;">📚 模版库</button>' +
            '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._archiveBatchTasks()" style="color:#8b5cf6;border-color:#8b5cf6;font-size:11px;padding:2px 10px;" title="将全部成功任务批量存档为词库模版（同名自动加序号）">📥 批量存档</button>' +
            '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._clearVideoHistory()" style="color:#ef4444;border-color:#ef4444;font-size:11px;padding:2px 10px;" title="清空已完成/失败的生成历史（含本地视频文件）">🗑 清空历史</button>' +
            '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2.openDreaminaAssets()" style="color:#10b981;border-color:#10b981;font-size:11px;padding:2px 10px;">📥 即梦资产</button></span>' +
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
            // v5.36.16: 缓存全量任务（批量存档/清空用）
            this._videoTasks = items;
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
                        '<span style="display:flex;align-items:center;gap:8px;">' +
                        (done + failed > 0 ? '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._clearVideoHistory()" style="color:#ef4444;border-color:#ef4444;font-size:10px;padding:1px 8px;" title="清空已完成/失败的生成记录（含本地视频文件），进行中任务保留">🧹 清空生成记录</button>' : '') +
                        '<span style="font-weight:700;color:'+(donePct===100?'#10b981':'var(--text-main)')+';">'+donePct+'%</span></span></div>' +
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
                            'gen_failed': '🎬 即梦生成失败 — 重试或减少参考图/缩短时长',
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

    // v5.36.16: 批量存档全部成功任务为分镜视频模版
    App.seedanceV2._archiveBatchTasks = async function() {
        var tasks = this._videoTasks || [];
        var ok = tasks.filter(function(t) { return t.status === 'success' && t.result_local; });
        if (!ok.length) { App.showToast('没有可存档的成功任务（需已下载到本地）', 'info'); return; }
        if (!confirm('将批量存档 ' + ok.length + ' 个成功任务为分镜视频模版词卡？\n\n同名模版自动加序号，视频复制到词库模版目录。')) return;
        App.showToast('正在批量存档...', 'info');
        var ids = ok.map(function(t) { return t.id; });
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/tasks/archive-batch', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_ids: ids }), _timeoutMs: 600000
            });
            if (d && d.ok) {
                App.showToast('批量存档完成：成功 ' + (d.success || 0) + ' / ' + ids.length, (d.success || 0) ? 'success' : 'warning');
                this._loadVideoTasks(true);
            } else {
                App.showToast('批量存档未完成: ' + (d ? (d.detail || '未知') : '无响应'), 'error');
            }
        } catch (e) { App.showToast('批量存档异常: ' + e.message, 'error'); }
    };

    // v5.36.16: 清空生成历史（已完成/失败记录 + 本地视频文件），进行中任务保留
    App.seedanceV2._clearVideoHistory = async function() {
        var tasks = this._videoTasks || [];
        var done = tasks.filter(function(t) { return t.status === 'success' || t.status === 'fail'; }).length;
        var active = tasks.length - done;
        if (!done) { App.showToast('没有可清空的历史记录', 'info'); return; }
        if (!confirm('清空生成历史？\n\n· 删除 ' + done + ' 条已完成/失败记录' + (active ? '（保留 ' + active + ' 条进行中）' : '') + '\n· 同时删除本地已下载的视频文件\n· 已存档的模版词卡不受影响\n\n此操作不可恢复！')) return;
        App.showToast('正在清空...', 'info');
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/tasks/clear', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delete_files: true, keep_active: true }), _timeoutMs: 120000
            });
            if (d && d.ok) {
                App.showToast('已清空 ' + d.deleted + ' 条历史记录' + (d.delete_files ? '（含本地视频）' : ''), 'success');
                this._videoTasks = [];
                this._loadVideoTasks(true);
            } else {
                App.showToast('清空未完成: ' + (d ? (d.detail || '未知') : '无响应'), 'error');
            }
        } catch (e) { App.showToast('清空异常: ' + e.message, 'error'); }
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

    // ============ v5.36.13: 即梦历史资产导入 ============
    // 从即梦 CLI 任务库拉取账号历史生成数据 → 下载本地 + 词卡模版式归档

    App.seedanceV2._assetFilter = { type: 'all', status: 'success', imported: '0', page: 1 };

    App.seedanceV2.openDreaminaAssets = function() {
        var old = document.getElementById('s2DreaminaAssets');
        if (old) old.remove();
        var self = this;
        var overlay = document.createElement('div');
        overlay.id = 's2DreaminaAssets';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:716;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:920px;max-height:86vh;display:flex;flex-direction:column;">' +
            '<div class="modal-header"><h5>📥 即梦历史资产 <span style="font-size:10px;color:var(--text-muted);font-weight:400;">从即梦账号拉取生成数据 → 本地词卡归档</span></h5>' +
            '<button class="header-btn-sm" onclick="document.getElementById(\'s2DreaminaAssets\').remove()">&times;</button></div>' +
            '<div style="display:flex;gap:6px;padding:8px 14px 0;">' +
            '<button class="btn btn-sm s2-asset-tab-btn" id="s2AssetTabBtnCli" onclick="App.seedanceV2._switchAssetTab(\'cli\')" style="color:#6366f1;border-color:#6366f1;">🗂 CLI 历史</button>' +
            '<button class="btn btn-sm btn-outline s2-asset-tab-btn" id="s2AssetTabBtnWeb" onclick="App.seedanceV2._switchAssetTab(\'web\')" style="color:#10b981;border-color:#10b981;">🌐 网页历史</button></div>' +
            '<div class="modal-body" style="flex:1;overflow-y:auto;">' +
            '<div id="s2AssetTabCli">' +
            '<div id="s2AssetStats"></div>' +
            '<div id="s2AssetFilters" style="display:flex;gap:6px;margin:8px 0;align-items:center;flex-wrap:wrap;"></div>' +
            '<div id="s2AssetProgress" style="display:none;margin-bottom:8px;"></div>' +
            '<div id="s2AssetList"><div style="text-align:center;padding:30px;color:var(--text-muted);">加载中...</div></div>' +
            '</div>' +
            '<div id="s2AssetTabWeb" style="display:none;">' +
            '<div id="s2WebStatus"></div>' +
            '<div id="s2WebControls" style="display:flex;gap:6px;margin:8px 0;align-items:center;flex-wrap:wrap;"></div>' +
            '<div id="s2WebProgress" style="display:none;margin-bottom:8px;"></div>' +
            '<div id="s2WebFilters" style="display:flex;gap:6px;margin:8px 0;align-items:center;flex-wrap:wrap;"></div>' +
            '<div id="s2WebList"><div style="text-align:center;padding:30px;color:var(--text-muted);">加载中...</div></div>' +
            '</div>' +
            '</div>' +
            '<div class="modal-footer" style="justify-content:space-between;">' +
            '<span style="font-size:11px;color:var(--text-muted);">数据源：即梦 CLI 任务库 + 网页资产页（仅本机 · 数据不上云）</span>' +
            '<span style="display:flex;gap:6px;"><button class="btn btn-sm btn-outline" onclick="App.seedanceV2._loadImportedAssets()">🗂 已导入资产</button> ' +
            '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._reloadDreaminaAssets()">🔄 刷新</button> ' +
            '<button class="btn btn-sm btn-success" onclick="App.seedanceV2._importAllDreaminaAssets()">📥 导入全部成功</button></span></div></div>';
        document.body.appendChild(overlay);
        this._assetFilter = { type: 'all', status: 'success', imported: '0', page: 1 };
        this._webAutoSyncDone = false;
        this._loadDreaminaAssets();
    };

    // 标签页切换
    App.seedanceV2._switchAssetTab = function(tab) {
        var cli = document.getElementById('s2AssetTabCli');
        var web = document.getElementById('s2AssetTabWeb');
        var b1 = document.getElementById('s2AssetTabBtnCli');
        var b2 = document.getElementById('s2AssetTabBtnWeb');
        if (tab === 'web') {
            if (cli) cli.style.display = 'none';
            if (web) web.style.display = 'block';
            if (b1) b1.className = 'btn btn-sm btn-outline s2-asset-tab-btn';
            if (b2) b2.className = 'btn btn-sm s2-asset-tab-btn';
            this._webRefresh();
        } else {
            if (web) web.style.display = 'none';
            if (cli) cli.style.display = 'block';
            if (b2) b2.className = 'btn btn-sm btn-outline s2-asset-tab-btn';
            if (b1) b1.className = 'btn btn-sm s2-asset-tab-btn';
            this._reloadDreaminaAssets();
        }
    };

    // ============ 🌐 网页历史（v5.36.14） ============

    // 打开面板时自动静默同步（已连接 && 未在跑）
    App.seedanceV2._webAutoSync = function() {
        if (this._webAutoSyncDone) return;
        var self = this;
        this._webAutoSyncDone = true;
        App.fetchJSON('/api/seedance/v2/web-assets/status').then(function(st) {
            if (st && st.ok && st.connected && !(st.progress && st.progress.running)) {
                App.fetchJSON('/api/seedance/v2/web-assets/pull', { method: 'POST' });
            }
        }).catch(function() {});
    };

    App.seedanceV2._webRefresh = function() {
        var self = this;
        this._webLoadStatus();
        this._webLoadAssets();
        // 自动静默同步（仅首次激活 tab 时）
        this._webAutoSync();
        // 进度轮询
        if (this._webPollTimer) clearInterval(this._webPollTimer);
        this._webPollTimer = setInterval(function() { self._webPoll(); }, 3000);
    };

    App.seedanceV2._webPoll = function() {
        var self = this;
        App.fetchJSON('/api/seedance/v2/web-assets/status').then(function(st) {
            if (!st || !st.ok) return;
            var p = st.progress || {};
            if (p.running) {
                self._webRenderProgress(p);
            } else {
                var bar = document.getElementById('s2WebProgress');
                if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
                // 结束后刷新一次状态与列表
                if (self._webLastRunning) {
                    self._webLoadStatus(); self._webLoadAssets();
                }
                self._webLastRunning = false;
            }
            if (p.running) self._webLastRunning = true;
        }).catch(function() {});
    };

    App.seedanceV2._webLoadStatus = function() {
        var c = document.getElementById('s2WebStatus');
        if (!c) return;
        var self = this;
        App.fetchJSON('/api/seedance/v2/web-assets/status').then(function(st) {
            if (!st || !st.ok) { c.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">状态获取失败</div>'; return; }
            var p = st.progress || {};
            var h = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11px;">';
            if (st.connected) {
                h += '<span style="padding:3px 10px;border-radius:12px;background:rgba(16,185,129,0.12);color:#10b981;">🟢 Chrome 已连接（独立实例）</span>';
            } else {
                h += '<span style="padding:3px 10px;border-radius:12px;background:rgba(239,68,68,0.1);color:#ef4444;">🔴 Chrome 未连接</span>';
            }
            h += '<span style="padding:3px 10px;border-radius:12px;background:var(--hover-bg);">🌐 已导入网页资产 <strong>' + (st.imported_web_total || 0) + '</strong></span>';
            if (p.message) h += '<span style="color:var(--text-muted);">' + App._escape(p.message) + '</span>';
            h += '</div>';
            c.innerHTML = h;
            // 控制按钮
            var ctrl = document.getElementById('s2WebControls');
            if (ctrl) {
                var run = p.running;
                ctrl.innerHTML = run
                    ? '<button class="btn btn-sm btn-danger" onclick="App.seedanceV2._webStop()">⏹ 停止拉取</button>' +
                      '<span style="font-size:11px;color:var(--text-muted);">' + App._escape(p.stage || '') + ' 进行中...</span>'
                    : '<button class="btn btn-sm btn-success" onclick="App.seedanceV2._webPullStart()">🔄 开始拉取</button>' +
                      '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._webCheckLogin()">🔍 检测登录</button>' +
                      '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._webRetryFail()" title="重试上次失败的条目">🔁 重试失败' + (p.failed ? ' (' + p.failed + ')' : '') + '</button>' +
                      '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._webGenThumbs()" title="为词库中缺少缩略图的资产词卡生成预览图">🖼 补缩略图</button>' +
                      '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._webDiagnose()" title="查看采集诊断与接口命中">🧰 采集诊断</button>' +
                      (st.connected ? '<button class="btn btn-sm btn-outline" style="color:#ef4444;border-color:#ef4444;" onclick="App.seedanceV2._webStop()">⛔ 关闭实例</button>' : '<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._webConnect()">🔌 连接 Chrome</button>');
            }
            // 登录提示（最近一次拉取失败为未登录时）
            if (!run && p.stage === 'error' && p.message && p.message.indexOf('未登录') >= 0) {
                var box = document.getElementById('s2WebProgress');
                if (box) { box.style.display = 'block'; box.innerHTML = '<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);color:#d97706;border-radius:6px;padding:8px 12px;font-size:12px;">⚠️ 尚未登录即梦。请在刚打开的独立 Chrome 窗口中完成登录（手机扫码），然后点「🔄 开始拉取」。</div>'; }
            }
        }).catch(function() {});
    };

    App.seedanceV2._webRenderProgress = function(p) {
        var bar = document.getElementById('s2WebProgress');
        if (!bar) return;
        var total = p.found || 0;
        var done = (p.imported || 0) + (p.skipped || 0) + (p.failed || 0);
        var pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
        bar.style.display = 'block';
        bar.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:8px 12px;font-size:11px;">' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="flex:1;height:8px;background:var(--hover-bg);border-radius:4px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#10b981,#8b5cf6);transition:width .5s;"></div></div>' +
            '<span>' + App._escape(p.stage || '') + ' · ' + pct + '%</span></div>' +
            '<div style="margin-top:4px;color:var(--text-muted);">发现 <strong>' + (p.found || 0) + '</strong> · 下载 <strong>' + (p.downloaded || 0) + '</strong> · 新增 <strong>' + (p.imported || 0) + '</strong> · 跳过(重复) <strong>' + (p.skipped || 0) + '</strong> · 失败 <strong style="color:#ef4444;">' + (p.failed || 0) + '</strong></div></div>';
    };

    // 为资产词卡生成缩略图（后台线程 + 进度轮询）
    App.seedanceV2._webGenThumbs = function() {
        var self = this;
        App.fetchJSON('/api/seedance/v2/web-assets/gen-thumbs', { method: 'POST' }).then(function(d) {
            if (d && d.ok) {
                App.showToast('开始生成缩略图（后台）', 'info');
                self._thumbPollTimer = setInterval(function() { self._thumbPoll(); }, 2000);
            } else { App.showToast('启动失败', 'error'); }
        }).catch(function(e) { App.showToast('启动异常: ' + e.message, 'error'); });
    };

    App.seedanceV2._thumbPoll = function() {
        var self = this;
        App.fetchJSON('/api/seedance/v2/web-assets/gen-thumbs/status').then(function(d) {
            if (!d || !d.ok) return;
            var st = d.state || {};
            var bar = document.getElementById('s2WebProgress');
            if (bar && st.running) {
                var pct = st.total ? Math.round(st.done / st.total * 100) : 0;
                bar.style.display = 'block';
                bar.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:11px;">' +
                    '<div style="flex:1;height:8px;background:var(--hover-bg);border-radius:4px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#8b5cf6,#10b981);"></div></div>' +
                    '<span>🖼 生成缩略图 ' + (st.done || 0) + '/' + (st.total || 0) + (st.failed ? '（失败 ' + st.failed + '）' : '') + '</span></div>';
            } else if (!st.running && st.total) {
                if (self._thumbPollTimer) { clearInterval(self._thumbPollTimer); self._thumbPollTimer = null; }
                if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
                App.showToast('缩略图生成完成：成功 ' + (st.done || 0) + '，失败 ' + (st.failed || 0), (st.failed || 0) ? 'warning' : 'success');
                self._webLoadAssets();
            }
        }).catch(function() {});
    };

    App.seedanceV2._webConnect = function() {
        App.showToast('正在启动独立 Chrome 实例...', 'info');
        App.fetchJSON('/api/seedance/v2/web-assets/connect', { method: 'POST' }).then(function(d) {
            if (d && d.ok) { App.showToast('✅ Chrome 已连接', 'success'); App.seedanceV2._webLoadStatus(); }
            else { App.showToast('连接失败: ' + ((d && d.error) || '未知'), 'error'); }
        }).catch(function(e) { App.showToast('连接异常: ' + e.message, 'error'); });
    };

    App.seedanceV2._webCheckLogin = function() {
        App.showToast('检测登录态中...', 'info');
        App.fetchJSON('/api/seedance/v2/web-assets/check-login', { method: 'POST', _timeoutMs: 30000 }).then(function(d) {
            if (d && d.logged_in) { App.showToast('✅ 已登录即梦', 'success'); App.seedanceV2._webLoadStatus(); }
            else { App.showToast('未登录：请在独立 Chrome 窗口扫码登录即梦后重试', 'warning'); App.seedanceV2._webLoadStatus(); }
        }).catch(function(e) { App.showToast('检测异常: ' + e.message, 'error'); });
    };

    App.seedanceV2._webPullStart = function() {
        var self = this;
        App.fetchJSON('/api/seedance/v2/web-assets/pull', { method: 'POST' }).then(function(d) {
            if (d && d.ok) {
                App.showToast(d.running ? '开始拉取（后台）' : '已在进行中', 'success');
                setTimeout(function() { self._webLoadStatus(); }, 1500);
            } else { App.showToast('启动失败', 'error'); }
        }).catch(function(e) { App.showToast('启动异常: ' + e.message, 'error'); });
    };

    App.seedanceV2._webStop = function() {
        if (!confirm('确定停止拉取并关闭独立 Chrome 实例？')) return;
        App.fetchJSON('/api/seedance/v2/web-assets/stop', { method: 'POST' }).then(function(d) {
            if (d && d.ok) { App.showToast('已停止', 'info'); App.seedanceV2._webLoadStatus(); }
        }).catch(function() {});
    };

    App.seedanceV2._webRetryFail = function() {
        var self = this;
        App.fetchJSON('/api/seedance/v2/web-assets/retry-fail', { method: 'POST', _timeoutMs: 300000 }).then(function(d) {
            if (d && d.ok) {
                App.showToast('重试完成：成功 ' + (d.imported || 0) + '，失败 ' + (d.failed || 0), (d.imported || 0) ? 'success' : 'warning');
                self._webLoadStatus(); self._webLoadAssets();
            }
        }).catch(function(e) { App.showToast('重试异常: ' + e.message, 'error'); });
    };

    App.seedanceV2._webDiagnose = function() {
        var self = this;
        App.fetchJSON('/api/seedance/v2/web-assets/diagnose').then(function(d) {
            if (!d || !d.ok) return;
            var items = d.diagnose || [];
            var prof = d.capture_profile || {};
            var lines = items.length ? items.map(function(x) {
                return '<div style="font-size:11px;margin:4px 0;">📡 <code>' + App._escape(x.url) + '</code><br><span style="color:var(--text-muted);">字段: ' + App._escape((x.sample_fields || []).join('、')) + ' · ' + x.count + ' 条</span></div>';
            }).join('') : '<div style="font-size:11px;color:var(--text-muted);">暂无接口命中记录（尚未成功采集过）</div>';
            var overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.cssText = 'display:flex;z-index:800;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
            overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
            overlay.innerHTML = '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:640px;">' +
                '<div class="modal-header"><h5>🧰 采集诊断</h5><button class="header-btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">&times;</button></div>' +
                '<div class="modal-body"><div style="font-size:12px;font-weight:600;margin-bottom:6px;">命中的列表接口</div>' + lines +
                '<div style="font-size:12px;font-weight:600;margin:10px 0 6px;">采集配置（data/capture_profile.json）</div>' +
                '<pre style="font-size:10px;background:var(--hover-bg);padding:8px;border-radius:6px;overflow:auto;max-height:200px;">' + App._escape(JSON.stringify(prof, null, 2)) + '</pre></div></div>';
            document.body.appendChild(overlay);
        }).catch(function() {});
    };

    App.seedanceV2._webFilter = { type: 'all', time_from: '', time_to: '', page: 1 };

    App.seedanceV2._webLoadAssets = function() {
        var c = document.getElementById('s2WebList');
        if (!c) return;
        var self = this;
        var f = this._webFilter;
        var q = '?page=' + f.page + '&page_size=60&asset_type=' + f.type + '&time_from=' + encodeURIComponent(f.time_from) + '&time_to=' + encodeURIComponent(f.time_to);
        var fEl = document.getElementById('s2WebFilters');
        if (fEl) fEl.innerHTML =
            '<label style="font-size:11px;color:var(--text-muted);">类型</label><select class="s2-input" style="width:auto;font-size:11px;padding:2px 6px;" onchange="App.seedanceV2._setWebFilter(\'type\',this.value)">' +
            '<option value="all"' + (f.type === 'all' ? ' selected' : '') + '>全部</option>' +
            '<option value="image"' + (f.type === 'image' ? ' selected' : '') + '>图片</option>' +
            '<option value="video"' + (f.type === 'video' ? ' selected' : '') + '>视频</option></select>' +
            '<label style="font-size:11px;color:var(--text-muted);">时间从</label><input type="date" class="s2-input" style="width:auto;font-size:11px;padding:2px 6px;" value="' + App._escape(f.time_from) + '" onchange="App.seedanceV2._setWebFilter(\'time_from\',this.value)">' +
            '<label style="font-size:11px;color:var(--text-muted);">至</label><input type="date" class="s2-input" style="width:auto;font-size:11px;padding:2px 6px;" value="' + App._escape(f.time_to) + '" onchange="App.seedanceV2._setWebFilter(\'time_to\',this.value)">';
        App.fetchJSON('/api/seedance/v2/web-assets/assets' + q).then(function(d) {
            if (!d || !d.ok) { c.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">加载失败</div>'; return; }
            var items = d.items || [];
            // v5.36.19: 缓存当前列表数据（复制提示词直接取缓存，不查 API）
            this._webAssetsCache = items;
            if (!items.length) {
                c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">还没有网页历史资产<br><span style="font-size:11px;">点「🔄 开始拉取」同步即梦网页端作品（含 App/官网直接生成的历史）</span></div>';
                return;
            }
            var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">';
            for (var i = 0; i < items.length; i++) {
                var a = items[i];
                var media = '';
                if (a.asset_type === 'image') {
                    media = '<img src="' + App._escape(a.file_url) + '" onclick="window.open(this.src,\'_blank\')" style="width:100%;height:120px;object-fit:cover;cursor:pointer;" title="点击放大">';
                } else {
                    media = '<video src="' + App._escape(a.file_url) + '" controls preload="metadata" style="width:100%;height:120px;object-fit:cover;background:#000;"></video>';
                }
                h += '<div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;background:var(--bg-card);">' +
                    '<div style="height:120px;background:#000;position:relative;">' + media +
                    '<span style="position:absolute;top:4px;left:4px;font-size:9px;padding:1px 6px;border-radius:10px;background:rgba(139,92,246,0.85);color:#fff;">🌐 网页</span></div>' +
                    '<div style="padding:8px 10px;">' +
                    (a.prompt ?
                        '<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + App._escape(a.prompt) + '">' + App._escape(a.prompt.substring(0, 42)) + '</div>'
                        :
                        '<div style="font-size:11px;color:#d97706;font-style:italic;">⚠️ 该资产未保存提示词（即梦旧记录），可手动补全</div>') +
                    '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + App._escape([a.task_time, a.gen_task_type].filter(Boolean).join(' · ')) + '</div>' +
                    '<div style="display:flex;gap:6px;margin-top:6px;">' +
                    '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._copyWebPrompt(' + a.id + ')">📋 提示词</button>' +
                    '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._editWebPrompt(' + a.id + ')" title="补充/修改提示词" style="color:#d97706;border-color:#d97706;">✏️ ' + (a.prompt ? '编辑' : '补全') + '</button>' +
                    '<button class="btn btn-xs btn-outline" style="color:#ef4444;border-color:#ef4444;" onclick="App.seedanceV2._deleteImportedAsset(' + a.id + ')">🗑 删除</button></div></div></div>';
            }
            h += '</div>';
            if (d.total > d.page_size) {
                h += '<div style="text-align:center;margin-top:12px;">' +
                    (f.page > 1 ? '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._webPage(' + (f.page - 1) + ')">← 上一页</button> ' : '') +
                    '<span style="font-size:11px;color:var(--text-muted);margin:0 8px;">第 ' + f.page + ' / ' + Math.ceil(d.total / d.page_size) + ' 页</span>' +
                    (f.page * d.page_size < d.total ? '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._webPage(' + (f.page + 1) + ')">下一页 →</button>' : '') +
                    '</div>';
            }
            c.innerHTML = h;
        }).catch(function(e) { c.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">加载失败: ' + App._escape(e.message) + '</div>'; });
    };

    App.seedanceV2._setWebFilter = function(k, v) {
        this._webFilter[k] = v;
        this._webFilter.page = 1;
        this._webLoadAssets();
    };

    App.seedanceV2._webPage = function(p) {
        this._webFilter.page = p;
        this._webLoadAssets();
    };

    App.seedanceV2._reloadDreaminaAssets = function() {
        this._assetFilter.page = 1;
        this._loadDreaminaAssets();
    };

    App.seedanceV2._loadDreaminaAssets = async function() {
        var c = document.getElementById('s2AssetList');
        if (!c) return;
        var self = this;
        try {
            // v5.36.18: 预取已导入资产映射（submit_id → 本地文件 URL），CLI 列表已导入项显示缩略图
            var importedMap = {};
            try {
                var _pg = 1;
                while (_pg < 12) {
                    var _ad = await App.fetchJSON('/api/seedance/v2/assets?page=' + _pg + '&page_size=200&source=cli');
                    if (!_ad || !_ad.ok || !_ad.items || !_ad.items.length) break;
                    for (var _i2 = 0; _i2 < _ad.items.length; _i2++) {
                        var _x = _ad.items[_i2];
                        if (_x.submit_id && _x.file_url) importedMap[_x.submit_id] = _x;
                    }
                    if (_ad.items.length < 200) break;
                    _pg++;
                }
            } catch (e) {}
            var f = this._assetFilter;
            var q = '?page=' + f.page + '&page_size=60&asset_type=' + f.type + '&gen_status=' + f.status + '&imported=' + f.imported;
            var d = await App.fetchJSON('/api/seedance/v2/assets/scan' + q);
            if (!d || !d.ok) { c.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">扫描失败，请确认即梦 CLI 已登录</div>'; return; }
            this._scanData = d;
            var st = d.stats || {};
            var statsEl = document.getElementById('s2AssetStats');
            if (statsEl) statsEl.innerHTML =
                '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;">' +
                '<span style="padding:3px 10px;border-radius:12px;background:var(--hover-bg);">🗂 总任务 <strong>' + st.total + '</strong></span>' +
                '<span style="padding:3px 10px;border-radius:12px;background:var(--hover-bg);">🖼 图片 <strong>' + st.image_total + '</strong></span>' +
                '<span style="padding:3px 10px;border-radius:12px;background:var(--hover-bg);">🎬 视频 <strong>' + st.video_total + '</strong></span>' +
                '<span style="padding:3px 10px;border-radius:12px;background:var(--hover-bg);">✅ 成功 <strong>' + st.success_total + '</strong></span>' +
                '<span style="padding:3px 10px;border-radius:12px;background:rgba(16,185,129,0.12);color:#10b981;">📥 已导入 <strong>' + st.imported_total + '</strong></span></div>';
            var fh = '<label style="font-size:11px;color:var(--text-muted);">类型</label><select class="s2-input" style="width:auto;font-size:11px;padding:2px 6px;" onchange="App.seedanceV2._setAssetFilter(\'type\',this.value)">' +
                '<option value="all"' + (f.type === 'all' ? ' selected' : '') + '>全部</option>' +
                '<option value="image"' + (f.type === 'image' ? ' selected' : '') + '>图片</option>' +
                '<option value="video"' + (f.type === 'video' ? ' selected' : '') + '>视频</option></select>' +
                '<label style="font-size:11px;color:var(--text-muted);">状态</label><select class="s2-input" style="width:auto;font-size:11px;padding:2px 6px;" onchange="App.seedanceV2._setAssetFilter(\'status\',this.value)">' +
                '<option value="success"' + (f.status === 'success' ? ' selected' : '') + '>成功</option>' +
                '<option value="all"' + (f.status === 'all' ? ' selected' : '') + '>全部</option>' +
                '<option value="fail"' + (f.status === 'fail' ? ' selected' : '') + '>失败</option>' +
                '<option value="querying"' + (f.status === 'querying' ? ' selected' : '') + '>生成中</option></select>' +
                '<label style="font-size:11px;color:var(--text-muted);">导入</label><select class="s2-input" style="width:auto;font-size:11px;padding:2px 6px;" onchange="App.seedanceV2._setAssetFilter(\'imported\',this.value)">' +
                '<option value="0"' + (f.imported === '0' ? ' selected' : '') + '>未导入</option>' +
                '<option value="1"' + (f.imported === '1' ? ' selected' : '') + '>已导入</option>' +
                '<option value="all"' + (f.imported === 'all' ? ' selected' : '') + '>全部</option></select>' +
                '<span style="flex:1;"></span><span style="font-size:11px;color:var(--text-muted);">共 ' + d.total + ' 条</span>';
            var fEl = document.getElementById('s2AssetFilters');
            if (fEl) fEl.innerHTML = fh;
            var items = d.items || [];
            if (!items.length) {
                c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">没有符合条件的任务<br><span style="font-size:11px;">' + (st.imported_total ? '当前筛选下已全部导入 ✅ 或切换筛选条件' : '请确认即梦 CLI 已登录且产生过生成任务') + '</span></div>';
                return;
            }
            var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">';
            for (var i = 0; i < items.length; i++) {
                var t = items[i];
                var stBg = t.gen_status === 'success' ? 'rgba(16,185,129,0.85)' : (t.gen_status === 'fail' ? 'rgba(239,68,68,0.85)' : 'rgba(245,158,11,0.85)');
                // v5.36.18: 已导入项显示本地缩略图
                var im = importedMap[t.submit_id];
                var thumbHtml = '';
                if (im && im.file_url) {
                    if (im.asset_type === 'video') {
                        thumbHtml = '<video src="' + App._escape(im.file_url) + '" muted preload="metadata" style="width:100%;height:100%;object-fit:cover;"></video>';
                    } else {
                        thumbHtml = '<img src="' + App._escape(im.file_url) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.opacity=0.2">';
                    }
                } else {
                    thumbHtml = '<span style="font-size:34px;">' + (t.asset_type === 'video' ? '🎬' : '🖼') + '</span>';
                }
                h += '<div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;background:var(--bg-card);">' +
                    '<div style="height:110px;background:var(--hover-bg);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">' + thumbHtml +
                    '<span style="position:absolute;top:4px;left:4px;font-size:9px;padding:1px 6px;border-radius:10px;background:rgba(0,0,0,0.55);color:#fff;">' + App._escape(t.gen_task_type || '') + '</span>' +
                    '<span style="position:absolute;top:4px;right:4px;font-size:9px;padding:1px 6px;border-radius:10px;background:' + stBg + ';color:#fff;">' + App._escape(t.gen_status) + '</span></div>' +
                    '<div style="padding:8px 10px;">' +
                    '<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + App._escape(t.prompt || '') + '">' + App._escape((t.prompt || '(无提示词)').substring(0, 42)) + '</div>' +
                    '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + App._escape([t.model_version, t.ratio, t.resolution, t.duration ? t.duration + 's' : '', t.task_time].filter(Boolean).join(' · ')) + '</div>' +
                    '<div style="display:flex;gap:6px;margin-top:6px;align-items:center;">' +
                    (t.imported ?
                        '<span style="font-size:10px;color:#10b981;">已导入 ✅</span><button class="btn btn-xs btn-outline" onclick="App.seedanceV2._copyAssetPrompt(\'' + t.submit_id + '\')">📋 提示词</button>' :
                        (t.web_imported ?
                            '<span style="font-size:10px;color:#8b5cf6;" title="该任务已通过网页历史导入，无需重复拉取">已在网页历史 ✅</span><button class="btn btn-xs btn-outline" onclick="App.seedanceV2._copyAssetPrompt(\'' + t.submit_id + '\')">📋 提示词</button>' :
                            '<button class="btn btn-xs btn-success" onclick="App.seedanceV2._importOneAsset(\'' + t.submit_id + '\')">📥 导入</button>')) +
                    '</div></div></div>';
            }
            h += '</div>';
            if (d.total > d.page_size) {
                h += '<div style="text-align:center;margin-top:12px;">' +
                    (f.page > 1 ? '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._assetPage(' + (f.page - 1) + ')">← 上一页</button> ' : '') +
                    '<span style="font-size:11px;color:var(--text-muted);margin:0 8px;">第 ' + f.page + ' / ' + Math.ceil(d.total / d.page_size) + ' 页</span>' +
                    (f.page * d.page_size < d.total ? '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._assetPage(' + (f.page + 1) + ')">下一页 →</button>' : '') +
                    '</div>';
            }
            c.innerHTML = h;
        } catch (e) {
            c.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">加载失败: ' + App._escape(e.message) + '</div>';
        }
    };

    App.seedanceV2._setAssetFilter = function(k, v) {
        this._assetFilter[k] = v;
        this._assetFilter.page = 1;
        this._loadDreaminaAssets();
    };

    App.seedanceV2._assetPage = function(p) {
        this._assetFilter.page = p;
        this._loadDreaminaAssets();
    };

    // 导入单条
    App.seedanceV2._importOneAsset = async function(submitId) {
        App.showToast('正在导入...', 'info');
        try {
            var d = await App.fetchJSON('/api/seedance/v2/assets/import', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submit_ids: [submitId] }), _timeoutMs: 300000
            });
            if (d && d.ok && d.imported && d.imported.length) {
                App.showToast('✅ 已导入（' + (d.imported[0].files || []).length + ' 个文件）', 'success');
            } else if (d && d.ok && d.results && d.results[0] && d.results[0].status === 'skipped') {
                App.showToast('该任务已在本地库中', 'info');
            } else {
                App.showToast('导入未完成: ' + ((d && d.results && d.results[0] && d.results[0].error) || '未知错误'), 'error');
            }
            this._reloadDreaminaAssets();
        } catch (e) { App.showToast('导入异常: ' + e.message, 'error'); }
    };

    // 批量导入全部成功任务（分批 5 条，串行下载）
    App.seedanceV2._importAllDreaminaAssets = async function() {
        var self = this;
        if (this._assetImporting) { App.showToast('正在导入中，请稍候', 'warning'); return; }
        // 收集全部未导入成功任务
        var allIds = [], page = 1;
        try {
            while (true) {
                var dd = await App.fetchJSON('/api/seedance/v2/assets/scan?page=' + page + '&page_size=200&asset_type=all&gen_status=success&imported=0');
                if (!dd || !dd.ok) { App.showToast('扫描失败', 'error'); return; }
                allIds = allIds.concat((dd.items || []).map(function(t) { return t.submit_id; }));
                if (!dd.items || dd.items.length < 200 || page * 200 >= dd.total) break;
                page++;
            }
        } catch (e) { App.showToast('扫描异常: ' + e.message, 'error'); return; }
        if (!allIds.length) { App.showToast('没有待导入的成功任务', 'info'); return; }
        if (!confirm('将导入 ' + allIds.length + ' 条成功任务（下载媒体 + 词卡归档），预计耗时较长，继续？')) return;
        this._assetImporting = true;
        var bar = document.getElementById('s2AssetProgress');
        if (bar) bar.style.display = 'block';
        var done = 0, failed = 0;
        for (var i = 0; i < allIds.length; i += 5) {
            var batch = allIds.slice(i, i + 5);
            try {
                var r = await App.fetchJSON('/api/seedance/v2/assets/import', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ submit_ids: batch }), _timeoutMs: 600000
                });
                if (r && r.ok) {
                    (r.results || []).forEach(function(x) { if (x.status === 'imported') done++; else if (x.status === 'failed') failed++; });
                } else { failed += batch.length; }
            } catch (e) { failed += batch.length; }
            var pct = Math.min(100, Math.round((i + batch.length) / allIds.length * 100));
            if (bar) bar.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:11px;">' +
                '<div style="flex:1;height:8px;background:var(--hover-bg);border-radius:4px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#10b981,#8b5cf6);"></div></div>' +
                '<span>导入中 ' + (i + batch.length) + '/' + allIds.length + '（成功 ' + done + '，失败 ' + failed + '）</span></div>';
        }
        if (bar) { bar.innerHTML = ''; bar.style.display = 'none'; }
        this._assetImporting = false;
        App.showToast('导入完成：成功 ' + done + '，失败 ' + failed, done ? 'success' : 'warning');
        this._reloadDreaminaAssets();
    };

    // 已导入资产列表（本地文件预览 / 复制提示词 / 删除）
    App.seedanceV2._loadImportedAssets = async function() {
        var c = document.getElementById('s2AssetList');
        if (!c) return;
        var self = this;
        var fEl = document.getElementById('s2AssetFilters');
        if (fEl) fEl.innerHTML = '<span style="font-size:11px;color:#10b981;">🗂 已导入本地资产（媒体 + 提示词）</span><span style="flex:1;"></span>' +
            '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._reloadDreaminaAssets()">← 返回任务列表</button>';
        c.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">加载中...</div>';
        try {
            var d = await App.fetchJSON('/api/seedance/v2/assets?page=1&page_size=500');
            if (!d || !d.ok) { c.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">加载失败</div>'; return; }
            var items = d.items || [];
            if (!items.length) { c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">还没有导入任何资产<br><span style="font-size:11px;">回到列表点击「📥 导入」即可下载并归档</span></div>'; return; }
            var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">';
            for (var i = 0; i < items.length; i++) {
                var a = items[i];
                var media = '';
                if (a.asset_type === 'image') {
                    media = '<img src="' + App._escape(a.file_url) + '" onclick="window.open(this.src,\'_blank\')" style="width:100%;height:120px;object-fit:cover;cursor:pointer;" title="点击放大">';
                } else {
                    media = '<video src="' + App._escape(a.file_url) + '" controls preload="metadata" style="width:100%;height:120px;object-fit:cover;background:#000;"></video>';
                }
                h += '<div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;background:var(--bg-card);">' +
                    '<div style="height:120px;background:#000;">' + media + '</div>' +
                    '<div style="padding:8px 10px;">' +
                    '<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + App._escape(a.prompt || '') + '">' + App._escape((a.prompt || '(无提示词)').substring(0, 42)) + '</div>' +
                    '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + App._escape([a.gen_task_type, a.model_version, a.ratio, a.resolution, a.task_time].filter(Boolean).join(' · ')) + '</div>' +
                    '<div style="display:flex;gap:6px;margin-top:6px;">' +
                    '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._copyImportedPrompt(' + a.id + ')">📋 提示词</button>' +
                    '<button class="btn btn-xs btn-outline" style="color:#ef4444;border-color:#ef4444;" onclick="App.seedanceV2._deleteImportedAsset(' + a.id + ')">🗑 删除</button></div></div></div>';
            }
            h += '</div>';
            c.innerHTML = h;
        } catch (e) { c.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">加载失败: ' + App._escape(e.message) + '</div>'; }
    };

    // 从网页历史列表缓存直接复制提示词（避免 API 分页查询）
    App.seedanceV2._copyWebPrompt = function(assetId) {
        var items = this._webAssetsCache || [];
        var a = null;
        for (var i = 0; i < items.length; i++) { if (items[i].id === assetId) { a = items[i]; break; } }
        var p = a ? (a.prompt || '') : '';
        if (!p) { App.showToast('提示词为空（该资产未保存提示词）', 'warning'); return; }
        navigator.clipboard.writeText(p).then(function() { App.showToast('✅ 提示词已复制', 'success'); }).catch(function() { App.showToast('复制失败，请手动复制', 'error'); });
    };

    // 编辑/补全网页资产提示词
    App.seedanceV2._editWebPrompt = async function(assetId) {
        var self = this;
        var np = prompt('补充/修改该资产的提示词（保存后同步到词卡）：', '');
        if (np === null) return;
        try {
            var d = await App.fetchJSON('/api/seedance/v2/web-assets/assets/' + assetId, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: np.trim() })
            });
            if (d && d.ok) { App.showToast('✅ 提示词已更新', 'success'); self._webLoadAssets(); }
            else { App.showToast('更新未完成: ' + (d ? (d.detail || '未知') : '无响应'), 'error'); }
        } catch (e) { App.showToast('更新异常: ' + e.message, 'error'); }
    };

    // 复制已导入资产提示词（分页查 /assets，page_size 上限 200）
    App.seedanceV2._copyImportedPrompt = async function(assetId) {
        try {
            var found = null;
            for (var _p = 1; _p <= 10; _p++) {
                var d = await App.fetchJSON('/api/seedance/v2/assets?page=' + _p + '&page_size=200');
                if (!d || !d.items) break;
                var hit = null;
                for (var i = 0; i < d.items.length; i++) { if (d.items[i].id === assetId) { hit = d.items[i]; break; } }
                if (hit) { found = hit; break; }
                if (d.items.length < 200) break;
            }
            var p = found ? (found.prompt || '') : '';
            if (!p) { App.showToast('提示词为空（该资产未保存提示词）', 'warning'); return; }
            navigator.clipboard.writeText(p).then(function() { App.showToast('✅ 提示词已复制', 'success'); }).catch(function() { App.showToast('复制失败，请手动复制', 'error'); });
        } catch (e) { App.showToast('复制异常: ' + e.message, 'error'); }
    };

    App.seedanceV2._deleteImportedAsset = async function(assetId) {
        if (!confirm('确定删除此本地资产？（媒体文件 + 词卡一并移除，不影响即梦云端）')) return;
        try {
            var d = await App.fetchJSON('/api/seedance/v2/assets/' + assetId, { method: 'DELETE' });
            if (d && d.ok) { App.showToast('已删除', 'info'); this._loadImportedAssets(); }
            else { App.showToast('删除未完成: ' + (d ? (d.detail || '未知') : '无响应'), 'error'); }
        } catch (e) { App.showToast('删除异常: ' + e.message, 'error'); }
    };

    // 复制未导入任务提示词（scan 数据）
    App.seedanceV2._copyAssetPrompt = function(submitId) {
        var d = this._scanData;
        var t = null;
        if (d && d.items) for (var i = 0; i < d.items.length; i++) { if (d.items[i].submit_id === submitId) { t = d.items[i]; break; } }
        var p = t ? (t.prompt || '') : '';
        if (!p) { App.showToast('提示词为空', 'warning'); return; }
        navigator.clipboard.writeText(p).then(function() { App.showToast('✅ 提示词已复制', 'success'); }).catch(function() { App.showToast('复制失败，请手动复制', 'error'); });
    };

})();
