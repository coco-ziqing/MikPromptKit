// Seedance V2 多镜头结构化组装器 — 分片 picker
(function() {
    'use strict';
    App.seedanceV2 = App.seedanceV2 || {};

    App.seedanceV2.renderComposerEmpty = function(){var c=document.getElementById('s2Editor');if(c)c.innerHTML='<div class="s2-empty-state"><div class="s2-empty-icon">🎬</div><h4>选择或创建项目开始编辑</h4></div>';};

    App.seedanceV2.setDirty = function(){this.dirty=true;};

    App.seedanceV2.onTotalDurationChange = function(){
        var el=document.getElementById('s2_total_duration');if(!el)return;
        var val=parseInt(el.value);if(isNaN(val)||val<2||val>60)return;
        var self=this;
        // 立即更新内存中的 project 对象（避免 reopen 前显示不一致）
        if(self.currentProject) self.currentProject.total_duration = val;
        // 保存当前未持久化的 DOM 编辑值（re-render 会清空）
        var savedStyle = document.getElementById('s2_global_style')?.value || '';
        var savedTransition = document.getElementById('s2_global_transition')?.value || '';
        var savedNegative = document.getElementById('s2_negative_prompt')?.value || '';
        // 写入后端 → 后端 _recalculate_scene_times 重算镜头时长
        App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId,{
            method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({total_duration:val})
        }).then(function(resp){
            if(!resp){ App.showToast(App._t('auto.str_2c00cbcc', '时长更新未完成'),'error'); return; }
            // 重新加载镜头数据（含后端重算后的 start_time/end_time/duration）
            return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId);
        }).then(function(d){
            if(!d) return;
            self.currentProject = d.project;
            self.scenes = d.scenes;
            self.renderProjectEditor();
            self.renderScenes();
            // 恢复 re-render 前未保存的全局参数编辑值
            var si = document.getElementById('s2_global_style'); if(si) si.value = savedStyle;
            var ti = document.getElementById('s2_global_transition'); if(ti) ti.value = savedTransition;
            var ni = document.getElementById('s2_negative_prompt'); if(ni) ni.value = savedNegative;
            self.compose();
        });
    };

    App.seedanceV2.renderProjectEditor = function() {
        var c=document.getElementById('s2Editor');if(!c)return;var p=this.currentProject;if(!p){this.renderComposerEmpty();return;}
        function ms(id,l,opts,v){var h='<div class="s2-field"><label>'+l+'</label><select id="'+id+'" class="s2-input" onchange="App.seedanceV2._debouncedCompose()">';for(var i=0;i<opts.length;i++){var s=opts[i][0]===v?' selected':'';h+='<option value="'+opts[i][0]+'"'+s+'>'+opts[i][1]+'</option>';}h+='</select></div>';return h;}
        var h='<div class="s2-editor-header"><div class="s2-editor-title"><input id="s2_name" class="s2-input s2-title-input" value="'+App._escape(p.name)+'" onchange="App.seedanceV2.setDirty();App.seedanceV2._debouncedCompose()">';
        // 模板来源标签
        if (p.template_id) {
            h+='<span class="s2-tpl-badge" title="来源模版ID: '+p.template_id+'" style="display:inline-block;font-size:10px;padding:2px 8px;border-radius:12px;background:#ede9fe;color:#7c3aed;margin-left:8px;white-space:nowrap;">📋 场景模版</span>';
        }
        h+='</div><div class="s2-editor-actions">';
        if (p.template_id) {
            h+='<button class="btn btn-sm btn-outline" onclick="App.seedanceV2._showUpdateTemplatePopup('+p.id+','+p.template_id+')" style="color:#7c3aed;border-color:#7c3aed;margin-right:6px;" title="当前组装的提示词操作">📤 更新模版</button>';
        }
        h+='<button class="btn btn-sm btn-success" onclick="App.seedanceV2.saveProject()">💾 保存</button><button class="btn btn-sm btn-danger" onclick="App.seedanceV2.confirmDeleteProject('+(p.id||this.currentProjectId)+')">🗑 删除</button></div></div>';
        // ① 分镜列表（可折叠）
        h+='<div class="s2-section s2-shotlist-section" id="s2ShotListSection"><div class="s2-section-title" onclick="App.seedanceV2._toggleShotList()" title="点击折叠/展开" style="cursor:pointer;">🎬 分镜列表 <span class="s2-badge">'+this.scenes.length+' 镜头</span> <span style="font-size:10px;font-weight:400;color:var(--text-muted);">(点击折叠)</span><button id="s2ToggleAllBtn" class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._toggleAllScenes()" title="折叠/展开全部子镜头" style="margin-left:auto;font-size:10px;padding:2px 8px;color:#6366f1;border-color:#6366f1;">▶ 折叠全部</button></div><div class="s2-shotlist-body">'+this._buildTimelineHTML()+'<div class="s2-scenes-container" id="s2ScenesContainer"></div></div></div>';
        // ② 全局参数（分镜设完再调全局）
        h+='<div class="s2-section s2-global-params-section" id="s2GlobalParamsSection"><div class="s2-section-title" onclick="App.seedanceV2._toggleGlobalParams()" title="点击折叠/展开" style="cursor:pointer;">📐 全局参数 <span style="font-size:10px;font-weight:400;color:var(--text-muted);">(点击折叠)</span></div><div class="s2-global-body"><div class="s2-global-row">';
        h+=ms('s2_aspect_ratio','画幅',[['16:9','横屏16:9'],['9:16','竖屏9:16'],['1:1','方形1:1'],['21:9','超宽21:9'],['4:3','方屏4:3'],['3:4','竖屏3:4']],p.aspect_ratio||'16:9');
        h+=ms('s2_resolution',App._t('auto.str_874a5816', '分辨率'),[['480p','480p'],['720p','720p'],['1080p','1080p'],['2K','2K'],['4K','4K'],['6K','6K'],['8K','8K']],p.resolution||'4K');
        h+='<div class="s2-field"><label>总时长(秒)</label><select id="s2_total_duration" class="s2-input" onchange="App.seedanceV2.onTotalDurationChange()">';for(var td=4;td<=15;td+=1){h+='<option value="'+td+'"'+(td===(p.total_duration||15)?' selected':'')+'>'+td+'秒</option>';}h+='</select></div></div>';
        h+='<div class="s2-global-row"><div class="s2-field" style="flex:2;"><label>全局画风 <span class="s2-style-picker-btn" onclick="App.seedanceV2._openGlobalGroupPicker(88)" title="从词库选择画风">📚 选风格</span></label><input id="s2_global_style" class="s2-input" placeholder="..." value="'+App._escape(p.global_style||'')+'" onchange="App.seedanceV2.setDirty();App.seedanceV2._debouncedCompose()"></div><div class="s2-field" style="flex:1;"><label>全局转场</label><input id="s2_global_transition" class="s2-input" placeholder="..." value="'+App._escape(p.global_transition||'')+'" onchange="App.seedanceV2.setDirty();App.seedanceV2._debouncedCompose()"></div></div>';
        var rm=(p.remaining_duration!==undefined)?p.remaining_duration:p.remaining;
        h+='<div style="font-size:12px;color:var(--text-muted);margin-top:4px;"><span>已分配: <strong>'+(p.total_dur_input||0)+'</strong>s / <strong>'+p.total_duration+'</strong>s</span><span style="margin-left:12px;'+(rm<=0?'color:#ef4444;':'')+'">剩余: <strong>'+Math.max(0,rm)+'</strong>s</span></div>';
        // v5.36.0: 即梦视频参数组（与提交弹窗联动，保存到项目）
        var vm = p.video_model || 'seedance2.0fast';
        var vses = (p.video_session===undefined||p.video_session===null)?0:p.video_session;
        var vres = p.video_resolution || '720p';
        var VMODELS = ['seedance2.0fast','seedance2.0','seedance2.0_vip','seedance2.0fast_vip','seedance2.0mini','seedance2.5'];
        var vmOpts = '';
        for (var vi = 0; vi < VMODELS.length; vi++) {
            vmOpts += '<option value="'+VMODELS[vi]+'"'+(VMODELS[vi]===vm?' selected':'')+'>'+VMODELS[vi]+'</option>';
        }
        var VRESS = ['480p','720p','1080p','4k'];
        // v5.36.27: 按当前模型过滤分辨率档位（与提交弹窗/CLI 支持一致）
        if (vm === 'seedance2.5') VRESS = ['480p','720p'];
        else if (vm === 'seedance2.0_vip') VRESS = ['720p','1080p','4k'];
        else VRESS = ['720p'];
        if (VRESS.indexOf(vres) < 0) vres = VRESS[VRESS.length - 1];
        var vrOpts = '';
        function _resLabel(v){ return v==='4k' ? '4K' : v; }
        for (var vj = 0; vj < VRESS.length; vj++) {
            vrOpts += '<option value="'+VRESS[vj]+'"'+(VRESS[vj]===vres?' selected':'')+'>'+_resLabel(VRESS[vj])+'</option>';
        }
        h+='<div class="s2-sub-panel s2-video-params">';
        h+='<div class="s2-sub-panel-title"><span>🎬 即梦视频参数</span><span class="s2-sub-note">生成视频时的默认参数，提交弹窗可改</span></div>';
        h+='<div class="s2-global-row">';
        h+='<div class="s2-field" style="flex:1.4;"><label>模型版本</label><select id="s2_video_model" class="s2-input" onchange="App.seedanceV2._saveVideoParam(&apos;video_model&apos;,this.value)">'+vmOpts+'</select></div>';
        h+='<div class="s2-field" style="flex:1;"><label>视频分辨率</label><select id="s2_video_resolution" class="s2-input" onchange="App.seedanceV2._saveVideoParam(&apos;video_resolution&apos;,this.value)">'+vrOpts+'</select></div>';
        h+='<div class="s2-field" style="flex:1.1;"><label>即梦会话 <span style="font-weight:400;color:var(--text-muted);font-size:10px;">(对话上下文)</span></label><div style="display:flex;gap:4px;"><select id="s2_video_session" class="s2-input" onchange="App.seedanceV2._saveVideoParam(&apos;video_session&apos;,this.value)" title="即梦 App 内的对话上下文：同一会话内的生成记录/参考素材连贯，不同会话互相独立"><option value="'+vses+'">'+vses+' · 加载中…</option></select><button class="s2-ref-add-btn" onclick="App.seedanceV2._refreshVideoSessions()" title="刷新会话列表" style="padding:2px 7px;border:1px solid #10b981;color:#10b981;">🔄</button></div></div>';
        h+='</div>';
        h+='<div style="width:100%;font-size:10px;color:var(--text-muted);margin-top:2px;" id="s2VideoParamHint">💡 即梦画幅取上方「画幅」设置；分辨率超出模型上限将自动降级。<br>💬 会话=即梦 App 的对话上下文：同一会话内素材/历史连贯，不同会话互相独立；默认 0 为通用对话。</div>';
        h+='</div>';
        // v5.36.2: 全局图像参考（所有镜头共享，上限9张）
        h+='<div class="s2-sub-panel s2-global-refs">';
        h+='<div class="s2-sub-panel-title"><span>🖼 全局图像参考</span><span class="s2-sub-note">所有镜头共享，生成视频时携带</span><span class="s2-sub-actions"><button class="s2-ref-add-btn s2-ref-add-global" data-scene-id="global" title="添加全局参考图（上限9张）">+ 添加</button></span></div>';
        h+='<div class="s2-ref-thumbs" id="s2RefThumbs_global"></div>';
        h+='</div></div></div>';
        // ③ 输出预览
        h+='<div class="s2-output-section"><div class="s2-section-title" onclick="App.seedanceV2._toggleOutput()" title="点击折叠/展开"> 输出预览 <span style="font-size:10px;font-weight:400;color:var(--text-muted);">(点击折叠)</span></div>';
        // 格式/密度/音频控制行
        h+='<div class="s2-global-row" style="margin-bottom:6px;">';
        h+=ms('s2_format',App._t('auto.str_e5593680', '输出格式'),[['seedance','Seedance'],['kling','Kling'],['minimax','MiniMax'],['comfyui','ComfyUI'],['raw','纯镜头Raw']],'seedance');
        h+=ms('s2_density','详细度',[['compact','简洁 compact'],['standard','标准 standard'],['detailed','详细 detailed']],'standard');
        h+='<div class="s2-field"><label>音频 <input type="checkbox" id="s2_audio_enabled" '+(p.audio_enabled?'checked':'')+' onchange="App.seedanceV2._toggleAudioSection();App.seedanceV2._debouncedCompose()"></label></div>';
        h+='</div>';
        // 音频子面板（默认隐藏）
        h+='<div id="s2_audio_section" style="display:none;margin-bottom:6px;padding:8px;background:var(--hover-bg);border-radius:6px;">';
        h+='<div class="s2-global-row">';
        h+='<div class="s2-field" style="flex:1;"><label>BGM背景音乐</label><input id="s2_bgm" class="s2-input" placeholder="史诗管弦乐…" onchange="App.seedanceV2._debouncedCompose()"></div>';
        h+='<div class="s2-field" style="flex:1;"><label>音效SFX</label><input id="s2_sfx" class="s2-input" placeholder="风声、雷鸣…" onchange="App.seedanceV2._debouncedCompose()"></div>';
        h+='<div class="s2-field" style="flex:2;"><label>对白/旁白</label><input id="s2_dialogue" class="s2-input" placeholder="准备好了吗?" onchange="App.seedanceV2._debouncedCompose()"></div>';
        h+='</div></div>';
        h+='<div class="s2-output-actions">';
        h+='<button class="btn btn-sm btn-success" onclick="App.seedanceV2.copyText()"> 复制提示词</button>';
        h+='<button class="btn btn-sm btn-info" onclick="App.seedanceV2.copyJSON()"> 复制JSON</button>';
        h+='<button class="btn btn-sm btn-outline" onclick="App.seedanceV2.copyLibTV()"> 填入LibTV</button>';
        h+='<button class="btn btn-sm btn-warning" style="background:#8b5cf6;color:#fff;border:1px solid #7c3aed;" onclick="App.seedanceV2.matchModel()" title="AI 智能分析提示词并推荐最佳视频生成模型">🧠 智能匹配</button>';
        // v5.36.0: 即梦视频生成任务提交
        h+='<button class="btn btn-sm btn-success" onclick="App.seedanceV2.openVideoSubmit()" title="将组装结果提交到即梦生成视频">🎬 生成视频</button>';
        h+='<button class="btn btn-sm btn-outline" onclick="App.seedanceV2.openVideoPanel()" title="查看视频生成任务进度与结果" style="color:#10b981;border-color:#10b981;">📺 任务面板</button>';
        h+='<button class="btn btn-sm btn-secondary" onclick="App.seedanceV2.resetProject()"> 重置</button>';
        h+='</div>';
        h+='<textarea id="s2Output" class="s2-output-text" readonly placeholder="切换镜头字段后实时合成…"></textarea>';
        h+='<div id="s2OutputMeta" style="font-size:11px;color:var(--text-muted);margin-top:4px;"></div></div>';
        c.innerHTML=h;
        // v5.36.11: 全局参数变更实时保存（防刷新/重渲染丢失；即梦视频参数另有 _saveVideoParam 独立保存）
        if (!c.dataset.gpBound) {
            c.dataset.gpBound = '1';
            var _gpSelIds = ['s2_name','s2_aspect_ratio','s2_resolution','s2_global_style','s2_global_transition','s2_negative_prompt','s2_bgm','s2_sfx','s2_dialogue','s2_audio_enabled'];
            var _gpInputIds = ['s2_name','s2_global_style','s2_global_transition','s2_negative_prompt','s2_bgm','s2_sfx','s2_dialogue'];
            c.addEventListener('change', function(e) {
                var t = e.target;
                if (t && t.id && _gpSelIds.indexOf(t.id) >= 0) App.seedanceV2._saveGlobalParams();
            });
            c.addEventListener('input', function(e) {
                var t = e.target;
                if (t && t.id && _gpInputIds.indexOf(t.id) >= 0) App.seedanceV2._saveGlobalParams();
            });
        }
        // 创建右侧面板（始终存在于布局中，类似左栏项目列表）
        var layout = document.querySelector('.s2-layout');
        if (layout && !document.getElementById('s2RightPanel')) {
            var rp = document.createElement('div'); rp.id = 's2RightPanel'; rp.className = 's2-right-panel collapsed';
            // 内容容器
            var inner = document.createElement('div'); inner.className = 's2-panel-inner'; inner.id = 's2PanelInner';
            inner.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">📚 点击镜头卡片上的字段标签<br>开始选择词卡</div>';
            rp.appendChild(inner);
            layout.appendChild(rp);
            // 折叠按钮 — 独立于面板挂在 layout 上（与左栏 toggle 完全对称）
            var tb = document.createElement('div'); tb.className = 's2-right-toggle'; tb.id = 's2RightToggle';
            tb.textContent = '▶';
            tb.title = App._t('auto.str_477e7a94', '折叠/展开 词库面板');
            tb.onclick = function() { App.seedanceV2.toggleRightPanel(); };
            layout.appendChild(tb);
        }
        // 删除旧浮动手柄
        var oldHandle = document.getElementById('s2RightHandle');
        if (oldHandle) oldHandle.remove();
        // 创建折叠按钮（左栏折叠）
        if (layout && !document.querySelector('.s2-sidebar-toggle')) {
            var tgl = document.createElement('div'); tgl.className = 's2-sidebar-toggle'; tgl.textContent = '◀'; tgl.title = App._t('auto.str_b50da652', '折叠项目列表'); tgl.onclick = function() { App.seedanceV2.toggleSidebar(); };
            layout.appendChild(tgl);
        }
        this.renderScenes();
        // 恢复侧栏+右侧面板状态
        setTimeout(function() { App.seedanceV2._restoreSidebar(); App.seedanceV2._restoreRightPanel(); }, 50);
    };

    // 镜头颜色（基于ID稳定不变）

    App.seedanceV2._sceneColor=function(id){var TC=['#6366f1','#8b5cf6','#d946ef','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#14b8a6','#06b6d4'];return TC[(id||0)%10];};

    // 单个镜头卡片折叠

    App.seedanceV2._toggleSceneCard = function(sid) {
        var card = document.querySelector('.s2-scene-card[data-scene-id="'+sid+'"]');
        if (!card) return;
        card.classList.toggle('s2-scene-collapsed');
    };
    // 一键折叠/展开全部镜头

    App.seedanceV2._toggleAllScenes = function() {
        var cards = document.querySelectorAll('.s2-scene-card');
        if (!cards.length) return;
        var anyExpanded = false;
        for (var i = 0; i < cards.length; i++) {
            if (!cards[i].classList.contains('s2-scene-collapsed')) { anyExpanded = true; break; }
        }
        var action = anyExpanded ? 'collapse' : 'expand';
        for (var i = 0; i < cards.length; i++) {
            if (action === 'collapse') cards[i].classList.add('s2-scene-collapsed');
            else cards[i].classList.remove('s2-scene-collapsed');
        }
        var btn = document.getElementById('s2ToggleAllBtn');
        if (btn) btn.textContent = anyExpanded ? App._t('auto.str_709ff59d', '▶ 折叠全部') : App._t('auto.str_cea6c5c8', '▼ 展开全部');
    };

    // 镜头拷贝粘贴剪贴板
    App.seedanceV2._sceneClipboard = null;

    App.seedanceV2._copyScene = function(sid) {
        for (var i = 0; i < this.scenes.length; i++) {
            if (this.scenes[i].id === sid) {
                var src = this.scenes[i];
                var fields = ['camera_move','subject','scene_desc','composition','lighting',
                    'action','focal_length','texture','speed','emotion','color_grade',
                    'weather','particles','perspective','depth_of_field','filter',
                    'natural_force','environment_detail','film_flaw','fantasy_physics',
                    'character_voice','bgm','sfx'];
                var clip = {};
                for (var fi = 0; fi < fields.length; fi++) {
                    if (src[fields[fi]]) clip[fields[fi]] = src[fields[fi]];
                }
                this._sceneClipboard = clip;
                App.showToast(App._t('auto.str_748d7aee', '✅ 已复制镜头')+(i+1)+App._t('auto.str_2192d983', '的提示词内容'), 'success');
                return;
            }
        }
    };

    App.seedanceV2._pasteScene = function(tgtSid) {
        if (!this._sceneClipboard || !Object.keys(this._sceneClipboard).length) {
            App.showToast(App._t('auto.str_7a404492', '📋 剪贴板为空，请先复制一个镜头'), 'warning'); return;
        }
        // 检测目标镜头是否有内容
        var tgt = null, tgtIdx = -1;
        for (var i = 0; i < this.scenes.length; i++) {
            if (this.scenes[i].id === tgtSid) { tgt = this.scenes[i]; tgtIdx = i; break; }
        }
        if (!tgt) { App.showToast('目标镜头未找到', 'error'); return; }
        var hasContent = false;
        var fields = Object.keys(this._sceneClipboard);
        for (var fi = 0; fi < fields.length; fi++) {
            if (tgt[fields[fi]] && tgt[fields[fi]].trim()) { hasContent = true; break; }
        }
        var self = this;
        var doPaste = function() {
            self._pushUndoBefore();
            var clip = self._sceneClipboard;
            var fks = Object.keys(clip);
            var updates = {};
            for (var fi = 0; fi < fks.length; fi++) {
                updates[fks[fi]] = clip[fks[fi]];
                tgt[fks[fi]] = clip[fks[fi]];
            }
            // 批量发送更新
            App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+tgtSid, {
                method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(updates)
            }).then(function() {
                self.renderScenes(); self.compose();
                App.showToast(App._t('auto.str_c39dbe4b', '✅ 已粘贴到镜头')+(tgtIdx+1), 'success');
            });
        };
        if (hasContent) {
            if (confirm(App._t('auto.str_9cee9d6f', '⚠️ 镜头')+(tgtIdx+1)+'已有提示词内容，粘贴将覆盖现有内容。继续？')) {
                doPaste();
            }
        } else {
            doPaste();
        }
    };
    // ============================================================
    // v9.3.9: 上下两行独立flex——渲染后JS测量分段真实像素，精确放置刻度

    App.seedanceV2._buildTimelineHTML = function() {
        var td = (this.currentProject && this.currentProject.total_duration) || 15;
        var scenes = this.scenes.slice().sort(function(a, b) { return (a.start_time||0) - (b.start_time||0); });
        // ====== 刻度行(上): flex占位，内容由_syncTicks填充 ======
        var tkHTML = '<div class="s2-timeline-ticks" id="s2TimelineTicks">';
        // 与分段相同flex-grow的占位cell
        for (var i = 0; i < scenes.length; i++) {
            var s = scenes[i];
            var dur = (s.duration && s.duration > 0 ? s.duration : (s.end_time - s.start_time)) || 0.5;
            tkHTML += '<span class="s2-tick-cell" style="flex-grow:' + dur + ';"></span>';
        }
        tkHTML += '</div>';
        // ====== 分段行(下) ======
        var segHTML = '';
        for (var i = 0; i < scenes.length; i++) {
            var s = scenes[i];
            var dur = (s.duration && s.duration > 0 ? s.duration : (s.end_time - s.start_time)) || 0.5;
            var lb = (s.subject || App._t('auto.str_45cf25c9', '镜头') + (i + 1)).substring(0, 6);
            var segColor = this._sceneColor(s.id);
            segHTML += '<div class="s2-timeline-seg" draggable="true" data-scene-id="' + s.id + '" style="flex-grow:' + dur + ';background:' + segColor + ';" title="' + s.start_time + '-' + s.end_time + 's: ' + App._escape(lb) + ' (拖拽排序)" onclick="App.seedanceV2._scrollToScene(' + s.id + ')"><span>' + lb + '</span></div>';
        }
        return '<div class="s2-timeline-wrapper">' + tkHTML + '<div class="s2-timeline-bar" id="s2TimelineBar">' + segHTML + '</div></div>';
    };
    // v9.3.9: JS测量bar中分段真实像素，刻度用absolute px定位

    App.seedanceV2._syncTicks = function() {
        var bar = document.getElementById('s2TimelineBar');
        var ticksRow = document.getElementById('s2TimelineTicks');
        if (!bar || !ticksRow) return;
        var scenes = this.scenes.slice().sort(function(a, b) { return (a.start_time||0) - (b.start_time||0); });
        if (!scenes.length) return;
        var barR = bar.getBoundingClientRect();
        var tkR = ticksRow.getBoundingClientRect();
        // bar与ticksRow的x偏移差（border导致）
        var xOff = barR.left - tkR.left;
        // 收集每个分段结束时间的实际像素（相对于ticksRow左缘）
        var pts = [{t:0, px:xOff, label:'0s'}];
        for (var i = 0; i < scenes.length; i++) {
            var seg = bar.querySelector('.s2-timeline-seg[data-scene-id="' + scenes[i].id + '"]');
            if (!seg) continue;
            var sr = seg.getBoundingClientRect();
            var rightPx = sr.right - barR.left + xOff;
            var endLabel = Number.isInteger(scenes[i].end_time) ? scenes[i].end_time + 's' : scenes[i].end_time.toFixed(1) + 's';
            pts.push({t:scenes[i].end_time, px:rightPx, label:endLabel});
        }
        // 去重
        var f = [pts[0]];
        for (var pi = 1; pi < pts.length; pi++) {
            if (pts[pi].t - f[f.length-1].t > 0.3) f.push(pts[pi]);
            else f[f.length-1] = pts[pi];
        }
        // 不替换innerHTML（会清空flex-cell导致行高塌陷），改为追加span
        var oldTicks = ticksRow.querySelectorAll('.s2-tick');
        for (var et = 0; et < oldTicks.length; et++) oldTicks[et].remove();
        for (var fi = 0; fi < f.length; fi++) {
            var span = document.createElement('span');
            span.className = 's2-tick';
            span.style.left = f[fi].px + 'px';
            span.textContent = f[fi].label;
            ticksRow.appendChild(span);
        }
    };

    App.seedanceV2._refreshTimeline = function() {
        var wrapper = document.querySelector('.s2-timeline-wrapper');
        if (!wrapper) return;
        var parent = wrapper.parentNode;
        if (!parent) return;
        // 保存当前active状态
        var activeId = null;
        var activeSeg = wrapper.querySelector('.s2-timeline-seg.active');
        if (activeSeg) activeId = activeSeg.dataset.sceneId;
        wrapper.outerHTML = this._buildTimelineHTML();
        // 恢复active状态
        if (activeId) {
            var seg = document.querySelector('.s2-timeline-seg[data-scene-id="' + activeId + '"]');
            if (seg) seg.classList.add('active');
        }
        // 重新绑定拖拽事件
        this._rebindTimelineDrag();
        // v9.3.9: 测量分段像素 → 同步刻度位置
        var self = this;
        requestAnimationFrame(function() { self._syncTicks(); });
    };
    // 时间轴拖拽事件（每次build后重新绑定）

    App.seedanceV2._rebindTimelineDrag = function() {
        var self = this;
        var tb = document.getElementById('s2TimelineBar');
        if (!tb || tb.dataset.dragBound) return;
        tb.dataset.dragBound = '1';
        var tSeg = null;
        document.querySelectorAll('.s2-timeline-seg').forEach(function(seg) {
            seg.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', this.dataset.sceneId);
                this.style.opacity = '0.4';
            });
            seg.addEventListener('dragend', function(e) {
                this.style.opacity = '1';
                document.querySelectorAll('.s2-timeline-seg').forEach(function(s) { s.classList.remove('s2-seg-over'); });
            });
        });
        tb.addEventListener('dragover', function(e) {
            e.preventDefault();
            var seg = e.target.closest('.s2-timeline-seg');
            if (seg) {
                document.querySelectorAll('.s2-timeline-seg').forEach(function(s) { s.classList.remove('s2-seg-over'); });
                seg.classList.add('s2-seg-over');
                tSeg = seg;
            }
        });
        tb.addEventListener('drop', function(e) {
            e.preventDefault();
            document.querySelectorAll('.s2-timeline-seg').forEach(function(s) { s.classList.remove('s2-seg-over'); s.style.opacity = '1'; });
            var srcId = parseInt(e.dataTransfer.getData('text/plain'));
            if (!tSeg || !srcId) return;
            var tgtId = parseInt(tSeg.dataset.sceneId);
            if (srcId === tgtId) return;
            self.reorderScenes(srcId, tgtId);
            tSeg = null;
        });
        tb.addEventListener('dragleave', function(e) {
            setTimeout(function() {
                if (!tb.contains(document.querySelector(':hover'))) {
                    document.querySelectorAll('.s2-timeline-seg').forEach(function(s) { s.classList.remove('s2-seg-over'); });
                    tSeg = null;
                }
            }, 100);
        });
    };

    App.seedanceV2.renderScenes=function(){
        var c=document.getElementById('s2ScenesContainer');if(!c)return;
        var h='';for(var i=0;i<this.scenes.length;i++)h+=this.renderSceneCard(this.scenes[i],i);
        h+='<div class="s2-add-scene" onclick="App.seedanceV2.addScene()">+ 添加镜头</div>';
        c.innerHTML=h;var self=this;
        this.compose();
        if(this._bindTimer)clearTimeout(this._bindTimer);
        this._bindTimer=setTimeout(function(){
            document.querySelectorAll('.s2-field-chip').forEach(function(el){el.addEventListener('click',function(e){var sid=parseInt(this.dataset.sceneId),f=this.dataset.field;if(!f)return;self.openCardPicker(sid,f);});el.addEventListener('mouseenter',function(e){var sid=parseInt(this.dataset.sceneId),f=this.dataset.field;if(!f||!sid)return;App.seedanceV2._showChipPreview(sid,f,this,e);});el.addEventListener('mouseleave',function(){App.seedanceV2._hideChipPreview();});});
            document.querySelectorAll('.s2-scene-input').forEach(function(el){el.addEventListener('change',function(){var sid=parseInt(this.dataset.sceneId),f=this.dataset.field,v=this.value;self.updateSceneField(sid,f,v);self._debouncedCompose();});});
            document.querySelectorAll('.s2-scene-dur').forEach(function(el){
                el.addEventListener('change',function(){
                    var sid=parseInt(this.dataset.sceneId),val=parseFloat(this.value);
                    if(isNaN(val)){val=0.5;this.value=0.5;}
                    val=Math.max(0.5,Math.min(15,val));
                    var td=self.currentProject?self.currentProject.total_duration:15,ls=0,uc=0;
                    for(var ci=0;ci<self.scenes.length;ci++){var sc=self.scenes[ci];if(sc.id===sid)continue;if(sc.is_locked)ls+=sc.duration;else uc++;}
                    if(uc===0){
                        var rem=td-ls;
                        // 最后一个未锁定镜头：任何修改都弹出选择弹窗
                        this.value=rem;
                        self.showRemainingChoice(sid,val,rem,true);
                        return;
                    }
                    self._doSetDuration(sid,val);
                });
            });
            document.querySelectorAll('.s2-lock-btn').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var sid=parseInt(this.dataset.sceneId),cl=this.classList.contains('s2-locked');if(!cl&&self._isLastUnlocked(sid)){var td=self.currentProject?self.currentProject.total_duration:15,ls=0;for(var ci3=0;ci3<self.scenes.length;ci3++){var sc3=self.scenes[ci3];if(sc3.id!==sid&&sc3.is_locked)ls+=sc3.duration;}
                        var rem=td-ls;
                        var inp=document.querySelector('.s2-scene-dur[data-scene-id="'+sid+'"]');var curV=inp?parseFloat(inp.value):rem;
                        self.showRemainingChoice(sid,curV,rem,true);
                        return;}App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid+'/lock',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked:!cl})}).then(function(){self.openProject(self.currentProjectId);}).catch(function(e){console.warn("_doSetDuration error",e);});});});
            document.querySelectorAll('.s2-drag-handle').forEach(function(el){el.addEventListener('dragstart',function(e){var card=this.closest('.s2-scene-card');if(!card)return;e.dataTransfer.setData('text/plain',card.dataset.sceneId);card.classList.add('s2-dragging');});el.addEventListener('dragend',function(e){var card=this.closest('.s2-scene-card');if(card)card.classList.remove('s2-dragging');});});
            document.querySelectorAll('.s2-del-btn').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var pv=document.getElementById('s2GlobalDelPop');if(!pv)return;var sid=this.dataset.sceneId,r=this.getBoundingClientRect();pv.dataset.sceneId=sid;pv.style.position='fixed';pv.style.left=Math.max(4,r.left-140)+'px';pv.style.top=(r.bottom+4)+'px';pv.style.display='flex';});});
            document.addEventListener('click',function(e){if(!e.target.closest('.s2-clear-btn')&&!e.target.closest('#s2ClearPop')&&!e.target.closest('.s2-del-btn')&&!e.target.closest('.s2-global-del-popover')){var p=document.getElementById('s2GlobalDelPop');if(p)p.style.display='none';var cp=document.getElementById('s2ClearPop');if(cp)cp.style.display='none';}});
            var ct=document.getElementById('s2ScenesContainer');if(ct&&!ct.dataset.dragBound){ct.dataset.dragBound='1';var dt=null;ct.addEventListener('dragover',function(e){e.preventDefault();if(e.dataTransfer.files&&e.dataTransfer.files.length){var card=e.target.closest('.s2-scene-card');if(card){document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over');});card.classList.add('s2-drag-over');card.classList.add('s2-file-over');dt=card;}}else{var card=e.target.closest('.s2-scene-card');if(card){document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over');});card.classList.add('s2-drag-over');dt=card;}}});ct.addEventListener('drop',function(e){e.preventDefault();document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over','s2-dragging','s2-file-over');});var files=e.dataTransfer.files;if(files&&files.length){var tgtCard=e.target.closest('.s2-scene-card');if(!tgtCard)return;var sid=parseInt(tgtCard.dataset.sceneId);if(!sid)return;self._handleFileDrop(files[0],sid);return;}var src=parseInt(e.dataTransfer.getData('text/plain'));if(!dt)return;var tgt=parseInt(dt.dataset.sceneId);if(src===tgt)return;self.reorderScenes(src,tgt);dt=null;});ct.addEventListener('dragleave',function(e){setTimeout(function(){document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over','s2-file-over');});},100);});}
            // 拓展unit事件绑定
            document.querySelectorAll('.s2-ext-unit-addword').forEach(function(el){el.addEventListener('click',function(e){var p=this.closest('.s2-ext-unit');var sid=parseInt(p.dataset.sceneId);var f=p.querySelector('.s2-ext-unit-dropdown').value;if(!f)return;self.openCardPicker(sid,f);});});
            document.querySelectorAll('.s2-clear-btn').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var pv=document.getElementById('s2ClearPop');if(!pv)return;var sid=this.dataset.sceneId,r=this.getBoundingClientRect();pv.dataset.sceneId=sid;pv.style.position='fixed';pv.style.left=Math.max(4,r.left-140)+'px';pv.style.top=(r.bottom+4)+'px';pv.style.display='flex';});});
            document.querySelectorAll('.s2-ext-unit-tag').forEach(function(el){el.addEventListener('mouseenter',function(e){var p=this.closest('.s2-ext-unit');var sid=parseInt(p.dataset.sceneId);var f=p.querySelector('.s2-ext-unit-dropdown').value;if(!f||!sid)return;App.seedanceV2._showChipPreview(sid,f,this,e);});el.addEventListener('mouseleave',function(){App.seedanceV2._hideChipPreview();});});
            document.querySelectorAll('.s2-ext-unit-dropdown').forEach(function(el){el.addEventListener('change',function(){var p=this.closest('.s2-ext-unit');var sid=parseInt(p.dataset.sceneId);var idx=parseInt(p.dataset.extIdx);self._extUnitChange(sid,idx,this.value);});});
            document.querySelectorAll('.s2-ext-unit-remove').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var p=this.closest('.s2-ext-unit');var sid=parseInt(p.dataset.sceneId);var idx=parseInt(p.dataset.extIdx);self.removeExtUnit(sid,idx);});});
            document.querySelectorAll('.s2-ext-unit-add-btn').forEach(function(el){el.addEventListener('click',function(){var p=this.closest('.s2-ext-unit-list');var sid=parseInt(p.dataset.sceneId);if(!sid)return;self.addExtUnit(sid);});});
            // ===== v5.36.0: 编辑模式事件绑定 =====
            document.querySelectorAll('.s2-editmode-toggle').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var sid=parseInt(this.dataset.sceneId);if(!sid)return;self.toggleSceneEditMode(sid);});});
            document.querySelectorAll('.s2-edit-input').forEach(function(el){el.addEventListener('input',function(){var sid=parseInt(this.dataset.sceneId),f=this.dataset.field;if(!sid||!f)return;self._onEditInput(sid,f,this);});});
            document.querySelectorAll('.s2-edit-archive').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var sid=parseInt(this.dataset.sceneId),f=this.dataset.field;if(!sid||!f)return;self._archiveField(sid,f);});});
            document.querySelectorAll('.s2-edit-all-archive').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var sid=parseInt(this.dataset.sceneId);if(!sid)return;self._archiveAllFields(sid);});});
            // ===== v5.36.2: 参考图事件 =====
            document.querySelectorAll('.s2-ref-add-btn').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var sid=this.dataset.sceneId;if(sid==='global'){self._openRefPicker(null);}else if(sid){self._openRefPicker(parseInt(sid));}else{var p=this.closest('.s2-ref-group');var pid2=p?p.dataset.sceneId:null;if(pid2==='global')self._openRefPicker(null);else if(pid2)self._openRefPicker(parseInt(pid2));}});});
            document.querySelectorAll('.s2-ref-del').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var id=parseInt(this.dataset.refId);if(!id)return;self._deleteRef(id);});});
            document.querySelectorAll('.s2-ref-edit').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var id=parseInt(this.dataset.refId);if(!id)return;self._editRefName(id);});});
            self._loadAllRefThumbs();
            // v5.36.33: 填充即梦会话下拉（异步拉取名称）
            self._refreshVideoSessions && self._refreshVideoSessions();

        },100);
        // v9.3: 每次渲染镜头卡片后刷新时间轴
        this._refreshTimeline();
    };


    App.seedanceV2.renderSceneCard = function(scene,idx){
        var s=scene; var F={'camera_move':App._t('auto.str_4abc8a41', '运镜'),'subject':'主体','scene_desc':App._t('auto.str_c931653c', '场景'),'composition':App._t('auto.str_c38d3f3b', '构图'),'lighting':'光影','action':'动作','focal_length':'焦段','texture':'质感','speed':'速率','emotion':'情绪','color_grade':'调色','weather':'天气','particles':'粒子','perspective':'视角','depth_of_field':'景深','filter':'滤镜','natural_force':'外力','environment_detail':'环境','film_flaw':'瑕疵','fantasy_physics':'奇幻'};
        // v5.36.0: 编辑模式独立渲染（不干扰选择模式逻辑）
        if (s._editMode) { return this._renderEditModeCard(s, idx); }
        var h='<div class="s2-scene-card" data-scene-id="'+s.id+'" data-scene-order="'+(idx+1)+'">';
        var dotColor=App.seedanceV2._sceneColor(s.id);
        // v5.36.2: 镜头视频任务状态徽章（若该镜头有进行中/成功任务）
        var vtBadge = App.seedanceV2._sceneVideoBadge(s.id);
        h+='<div class="s2-drag-handle" draggable="true" title="拖拽排序" style="border-top:4px solid '+dotColor+';padding-top:2px;"><span class="s2-drag-icon">\u2e3f</span></div>';
        h+='<div class="s2-scene-header"><div class="s2-scene-title"><span class="s2-scene-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+dotColor+App._t('auto.str_6d65e37d', ';margin-right:6px;vertical-align:middle;flex-shrink:0;" title="镜头')+(idx+1)+'"></span><strong onclick="event.stopPropagation();App.seedanceV2._toggleSceneCard('+s.id+')" style="cursor:pointer;" title="点击折叠/展开"><span class="s2-scene-fold-arrow">▼</span> 镜头 '+(idx+1)+'</strong> <span class="s2-time-badge">'+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span>'+vtBadge+'</div><div class="s2-scene-actions">';
        h+='<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.insertScene('+s.id+',&apos;before&apos;)">\u2b06插入</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.insertScene('+s.id+',&apos;after&apos;)">\u2b07插入</button>';
        h+='<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.duplicateScene('+s.id+')">📋复制</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._copyScene('+s.id+')" title="拷贝提示词">📝拷贝</button><button class="btn btn-xs btn-outline s2-clear-btn" data-scene-id="'+s.id+'" title="清除所有字段" style="color:#ef4444;border-color:#ef4444;">🗑清除</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._pasteScene('+s.id+')" title="粘贴提示词">📄粘贴</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._exportScene('+s.id+')" title="导出镜头">📤导出</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._importScene('+s.id+')" title="导入镜头">📥导入</button><button class="btn btn-xs btn-outline s2-review-btn" style="color:#8b5cf6;border-color:#8b5cf6;" onclick="event.stopPropagation();App.seedanceV2.openSceneReview('+s.id+')" title="审阅">📖审阅</button><button class="btn btn-xs btn-outline s2-editmode-toggle" data-scene-id="'+s.id+'" title="切换到文本编辑模式，自由修改字段内容" style="color:#10b981;border-color:#10b981;">✏️ 编辑</button><button class="btn btn-xs btn-danger s2-del-btn" data-scene-id="'+s.id+'" title="删除此镜头">🗑</button></div></div>';
        // 折叠后第二行：纯文本单行省略
        var plainText = App.seedanceV2._scenePlainText(s);
        h+='<div class="s2-scene-collapsed-text" title="'+App._escape(plainText)+'">'+App._escape(plainText)+'</div>';
        h+='<div class="s2-scene-body s2-scene-body-compact"><div class="s2-scene-time"><span class="s2-time-label">\u23f1 '+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span>';        h+='<input class="s2-scene-dur s2-time-input'+(s.is_locked?' s2-dur-manual':'')+'" type="number" min="0.5" max="15" step="0.5" onblur="if(parseFloat(this.value)<0.5)this.value=0.5;if(parseFloat(this.value)>15)this.value=15;" value="'+(s.duration||3)+'" data-scene-id="'+s.id+'" title="'+(s.is_locked?'🔒 已锁定':'🔓 未锁定')+'">';
        h+='<select class="s2-dur-preset" data-target-scene="'+s.id+'" onchange="App.seedanceV2.applyDurPreset(this)"><option value="">\u25bc</option>';
        var P=[0.5,1,1.5,2,2.5,3,4,5,6,7,8,9,10,12,15];for(var pi=0;pi<P.length;pi++){var sel=Math.abs(P[pi]-(s.duration||3))<0.01?' selected':'';h+='<option value="'+P[pi]+'"'+sel+'>'+P[pi]+'</option>';}
        h+='</select><span class="s2-dur-label">秒</span><button class="s2-lock-btn'+(s.is_locked?' s2-locked':'')+'" data-scene-id="'+s.id+'" title="'+(s.is_locked?'点击解锁时长':'点击锁定时长')+'"><span class="s2-lock-icon"></span></button></div>';
        h+='<div class="s2-scene-fields s2-scene-fields-compact"><div class="s2-field-group"><span class="s2-field-label">基础</span>';
        ['camera_move','subject','scene_desc','composition','lighting'].forEach(function(f){var v=s[f]||'',n=F[f]||f;var cz=(s._customized&&s._customized[f])?' s2-customized':'';h+='<span class="s2-field-chip '+(v?'s2-filled':'s2-empty')+cz+'" data-scene-id="'+s.id+'" data-field="'+f+'"><span class="s2-chip-label">'+(cz?'✏️':'')+n+'</span><span class="s2-chip-val">'+(v.length>10?v.substring(0,10)+'..':(v||'+'))+'</span></span>';});
        h+='</div>';
        // == v4.0.0-phase10.1: 出演角色 + 场景模板（合并到同一行）
        // 获取已分配的 character_id，查找角色名称
        var charName = '';
        if (s.character_id && App.characterLib) {
            for (var ci = 0; ci < (App.characterLib._cache||[]).length; ci++) {
                if (App.characterLib._cache[ci].id == s.character_id) { charName = App.characterLib._cache[ci].name; break; }
            }
        }
        // == Phase17: 场景模板选择器预计算 ==
        var sceneProfileName = '';
        if (s.scene_profile_id && App.seedanceV2._sceneProfileCache) {
            for (var spi = 0; spi < (App.seedanceV2._sceneProfileCache||[]).length; spi++) {
                if (App.seedanceV2._sceneProfileCache[spi].id == s.scene_profile_id) { sceneProfileName = App.seedanceV2._sceneProfileCache[spi].name; break; }
            }
        }
        // 角色 + 场景模板合并为紧凑一行
        h+='<div class="s2-field-group s2-char-scene-row">';
        h+='<span class="s2-field-label" style="color:#8b5cf6;min-width:28px;">角色</span>';
        h+='<span class="s2-char-selector s2-inline-picker" onclick="if(window.PK_ROLES)PK_ROLES.shotApply('+s.id+',\'character\');else App.characterLib.openScenePicker('+s.id+')" onmouseenter="App.seedanceV2._showCharPreview('+(s.character_id||0)+',this)" onmouseleave="App.seedanceV2._hideCharPreview()" title="选择角色（本项目实例/公共库）">';
        h+='<span>'+(charName?'🎭 '+App._escape(charName.substring(0,12)):App._t('auto.str_82a32516', '🎭 选择角色'))+'</span>';
        h+='<span style="font-size:9px;">▾</span></span>';
        h+='<span class="s2-field-label" style="color:#10b981;min-width:28px;margin-left:8px;">场景</span>';
        h+='<span class="s2-char-selector s2-inline-picker" onclick="if(window.PK_ROLES)PK_ROLES.shotApply('+s.id+',\'scene\');else App.seedanceV2._openSceneProfilePicker('+s.id+')" title="选择场景（本项目实例/公共模板）">';
        h+='<span>'+(sceneProfileName?'🏞 '+App._escape(sceneProfileName.substring(0,12)):'🏞 加载场景模板')+'</span>';
        h+='<span style="font-size:9px;">▾</span></span>';
        h+='</div>';
// == 音频四要素（紧凑） ==
        h+='<div class="s2-field-group s2-audio-group s2-audio-compact">';
        h+='<span class="s2-field-label">音频</span>';
        h+='<label class="s2-audio-switch" title="启用此镜头音频描述"><input type="checkbox" '+(s.audio_enabled?'checked':'')+' data-scene-id="'+s.id+'" onchange="App.seedanceV2._toggleSceneAudio('+s.id+',this.checked)"><span>音频</span></label>';
        h+='<div class="s2-audio-fields">';
        var audioFields = [
            {f:'character_voice',n:App._t('auto.str_a3ed37f4', '角色旁白'),icon:'🎤'},
            {f:'bgm',n:'BGM',icon:'🎵'},
            {f:'sfx',n:'音效',icon:'🔊'}
        ];
        for (var ai = 0; ai < audioFields.length; ai++) {
            var af = audioFields[ai];
            var av = s[af.f] || '';
            var filled = av && av.trim();
            h+='<span class="s2-field-chip s2-chip-audio '+(filled?'s2-filled':'s2-empty')+'" data-scene-id="'+s.id+'" data-field="'+af.f+'" style="opacity:'+(s.audio_enabled?'1':'0.4')+';"><span class="s2-chip-label">'+af.icon+' '+af.n+'</span><span class="s2-chip-val">'+(filled?(av.length>12?av.substring(0,12)+'..':av):'+')+'</span></span>';
        }
        h+='</div></div>';
                // == v5.36.2: 图像参考区（角色图/场景图） ==
        h+='<div class="s2-field-group s2-ref-group" data-scene-id="'+s.id+'">';
        h+='<span class="s2-field-label">🖼 参考</span>';
        h+='<span class="s2-ref-add-btn" data-scene-id="'+s.id+'" title="添加角色参考图/场景参考图（上限9张）">+ 添加</span>';
        h+='<div class="s2-ref-thumbs" id="s2RefThumbs_'+s.id+'"></div>';
        h+='</div>';
                // == 拓展区：功能单元(Ext-Unit)系统 ==
        h+='<div class="s2-field-group s2-ext-group">';
        h+='<span class="s2-field-label">拓展</span>';
        h+='<span class="s2-ext-manage-link" onclick="App.seedanceV2.openGroupManager()" title="管理自定义分组">⚙</span>';
        h+='<div class="s2-ext-unit-list" data-scene-id="'+s.id+'">';
        if(!s._extUnits)s._extUnits=App.seedanceV2._initExtUnits(s);
        for(var ui=0;ui<s._extUnits.length;ui++){h+=App.seedanceV2._renderExtUnitHTML(s,ui);}
        h+='<div class="s2-ext-unit-add-btn">+</div>';
        h+='</div>';
        h+='</div></div></div></div>';return h;
    };

    // ========== v5.36.0: 镜头编辑模式（选择模式 ↔ 文本编辑模式自由切换） ==========

    // 编辑模式字段分组（基础/扩展/音频）
    App.seedanceV2._editFieldGroups = [
        {label:'基础', fields:['camera_move','subject','scene_desc','composition','lighting']},
        {label:'扩展', fields:['action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics']},
        {label:'音频', fields:['character_voice','bgm','sfx']}
    ];

    // 切换镜头的编辑模式
    App.seedanceV2.toggleSceneEditMode = function(sid, force) {
        for (var i = 0; i < this.scenes.length; i++) {
            if (this.scenes[i].id === sid) {
                var s = this.scenes[i];
                var target = (force === undefined) ? !s._editMode : !!force;
                if (target) { this._pushUndoBefore(); }  // 进入编辑模式前压栈（返回可撤销）
                s._editMode = target;
                if (!target) {
                    // 退出编辑模式：确认所有输入已落库
                    var inputs = document.querySelectorAll('.s2-edit-input[data-scene-id="'+sid+'"]');
                    for (var j = 0; j < inputs.length; j++) {
                        var inp = inputs[j];
                        var f = inp.dataset.field;
                        if (f && inp.value !== (s[f]||'')) this._saveEditField(sid, f, inp.value, true);
                    }
                }
                this.renderScenes();
                return;
            }
        }
    };

    // 渲染编辑模式镜头卡（全字段自由文本编辑 + 存词归档入口）
    App.seedanceV2._renderEditModeCard = function(s, idx) {
        var F = this._F || {};
        var h = '<div class="s2-scene-card s2-edit-card" data-scene-id="'+s.id+'" data-scene-order="'+(idx+1)+'">';
        var dotColor = this._sceneColor(s.id);
        // header
        h += '<div class="s2-scene-header"><div class="s2-scene-title"><span class="s2-scene-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+dotColor+';margin-right:6px;vertical-align:middle;"></span><strong>镜头 '+(idx+1)+'</strong> <span class="s2-time-badge">'+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span> <span class="s2-edit-badge">✏️ 编辑中</span></div><div class="s2-scene-actions">';
        h += '<button class="btn btn-xs btn-outline s2-editmode-toggle" data-scene-id="'+s.id+'" title="返回选择模式">🔀 选择模式</button>';
        h += '<button class="btn btn-xs btn-danger s2-del-btn" data-scene-id="'+s.id+'" title="删除此镜头">🗑</button></div></div>';
        // 时间行（保留时长/锁定）
        h += '<div class="s2-scene-time"><span class="s2-time-label">⏱ '+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span>';
        h += '<input class="s2-scene-dur s2-time-input'+(s.is_locked?' s2-dur-manual':'')+'" type="number" min="0.5" max="15" step="0.5" onblur="if(parseFloat(this.value)<0.5)this.value=0.5;if(parseFloat(this.value)>15)this.value=15;" value="'+(s.duration||3)+'" data-scene-id="'+s.id+'" title="'+(s.is_locked?'🔒 已锁定':'🔓 未锁定')+'">';
        h += '<button class="s2-lock-btn'+(s.is_locked?' s2-locked':'')+'" data-scene-id="'+s.id+'" title="'+(s.is_locked?'点击解锁时长':'点击锁定时长')+'"><span class="s2-lock-icon"></span></button></div>';
        // 字段编辑表单
        h += '<div class="s2-edit-fields">';
        for (var g = 0; g < this._editFieldGroups.length; g++) {
            var grp = this._editFieldGroups[g];
            h += '<div class="s2-field-group s2-edit-group"><span class="s2-field-label">'+grp.label+'</span>';
            for (var fi = 0; fi < grp.fields.length; fi++) {
                var f = grp.fields[fi];
                var v = s[f] || '';
                var nm = F[f] || f;
                h += '<div class="s2-edit-row"><span class="s2-edit-label" title="'+App._escape(nm)+'">'+App._escape(nm)+'</span>';
                h += '<input class="s2-edit-input" data-scene-id="'+s.id+'" data-field="'+f+'" value="'+App._escape(v)+'" placeholder="选择或输入" spellcheck="false">';
                h += '<button class="s2-edit-archive" data-scene-id="'+s.id+'" data-field="'+f+'" title="将当前内容存为词卡">📥</button>';
                h += '</div>';
            }
            h += '</div>';
        }
        // 拓展单元字段（编辑模式下同样可编辑）
        if (!s._extUnits) s._extUnits = this._initExtUnits(s);
        if (s._extUnits.length) {
            h += '<div class="s2-field-group s2-edit-group"><span class="s2-field-label">拓展</span>';
            for (var ui = 0; ui < s._extUnits.length; ui++) {
                var uf = s._extUnits[ui].field;
                var uv = s[uf] || '';
                var unm = F[uf] || uf;
                h += '<div class="s2-edit-row"><span class="s2-edit-label" title="'+App._escape(unm)+'">'+App._escape(unm)+'</span>';
                h += '<input class="s2-edit-input" data-scene-id="'+s.id+'" data-field="'+uf+'" value="'+App._escape(uv)+'" placeholder="选择或输入" spellcheck="false">';
                h += '<button class="s2-edit-archive" data-scene-id="'+s.id+'" data-field="'+uf+'" title="将当前内容存为词卡">📥</button>';
                h += '</div>';
            }
            h += '</div>';
        }
        h += '</div>';
        // v5.36.2: 编辑模式参考图区
        h += '<div class="s2-field-group s2-ref-group" data-scene-id="'+s.id+'">';
        h += '<span class="s2-field-label">🖼 参考</span>';
        h += '<span class="s2-ref-add-btn" data-scene-id="'+s.id+'" title="添加角色参考图/场景参考图（上限9张）">+ 添加</span>';
        h += '<div class="s2-ref-thumbs" id="s2RefThumbs_'+s.id+'"></div>';
        h += '</div>';
        // 底部操作区
        h += '<div class="s2-edit-actions">';
        h += '<button class="btn btn-xs btn-primary s2-edit-all-archive" data-scene-id="'+s.id+'" title="将本镜头所有已填字段存为词卡">📥 全部存为词卡</button>';
        h += '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._openGroupCreator()" title="新建自定义词库分组（同步到词库）">➕ 新建分组</button>';
        h += '<button class="btn btn-xs btn-outline s2-editmode-toggle" data-scene-id="'+s.id+'" title="返回选择模式">↩ 返回选择</button>';
        h += '</div></div>';
        return h;
    };

    // 编辑模式输入防抖保存（600ms）
    App.seedanceV2._editSaveTimers = {};
    App.seedanceV2._onEditInput = function(sid, field, el) {
        // 本地先行更新 scene 数据（体验层）
        for (var i = 0; i < this.scenes.length; i++) {
            if (this.scenes[i].id === sid) {
                var s = this.scenes[i];
                s[field] = el.value;
                if (!s._customized) s._customized = {};
                s._customized[field] = true;  // 改造标记
                break;
            }
        }
        var key = sid + '_' + field;
        if (this._editSaveTimers[key]) clearTimeout(this._editSaveTimers[key]);
        var self = this;
        this._editSaveTimers[key] = setTimeout(function() {
            self._saveEditField(sid, field, el.value, false);
        }, 600);
    };

    // 编辑字段落库（编辑模式不压撤销栈，高频输入用防抖）
    App.seedanceV2._saveEditField = function(sid, field, value, immediate) {
        var key = sid + '_' + field;
        if (this._editSaveTimers[key]) { clearTimeout(this._editSaveTimers[key]); delete this._editSaveTimers[key]; }
        var d = {}; d[field] = value;
        var self = this;
        App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+sid, {
            method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(d)
        }).then(function(res) {
            if (res && res.ok) { if (immediate) self._debouncedCompose(); }
        }).catch(function(e) { console.warn('edit save fail', e); });
    };

    // 存词卡归档弹窗（字段级）
    App.seedanceV2._archiveField = function(sid, field) {
        var s = null;
        for (var i = 0; i < this.scenes.length; i++) { if (this.scenes[i].id === sid) { s = this.scenes[i]; break; } }
        if (!s) return;
        var v = s[field] || '';
        if (!v.trim()) { App.showToast('字段内容为空，无需归档', 'warning'); return; }
        this._openArchiveModal([{field: field, value: v}]);
    };

    // 全部存为词卡（收集所有已填字段）
    App.seedanceV2._archiveAllFields = function(sid) {
        var s = null;
        for (var i = 0; i < this.scenes.length; i++) { if (this.scenes[i].id === sid) { s = this.scenes[i]; break; } }
        if (!s) return;
        var items = [];
        var keys = ['camera_move','subject','scene_desc','composition','lighting','action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics','character_voice','bgm','sfx'];
        for (var i = 0; i < keys.length; i++) {
            var v = s[keys[i]] || '';
            if (v.trim()) items.push({field: keys[i], value: v});
        }
        if (s._extUnits) {
            for (var j = 0; j < s._extUnits.length; j++) {
                var uf = s._extUnits[j].field;
                var uv = s[uf] || '';
                if (uv.trim()) items.push({field: uf, value: uv});
            }
        }
        if (!items.length) { App.showToast('本镜头暂无已填字段', 'warning'); return; }
        this._openArchiveModal(items);
    };

    // 归档弹窗：选择目标词库/新建分组 + 释义
    App.seedanceV2._openArchiveModal = function(items) {
        var old = document.getElementById('s2ArchiveModal');
        if (old) old.remove();
        var self = this;
        // 字段 → 默认维度词库映射
        var libs = this.libraries || [];
        var optHtml = '';
        var fieldToDim = this._fieldToDim || {};
        var firstField = items[0] ? items[0].field : '';
        var defaultDim = fieldToDim[firstField] || firstField;
        var hasDim = false;
        for (var i = 0; i < libs.length; i++) {
            var lib = libs[i];
            var isDefault = (lib.dimension_key === defaultDim);
            if (isDefault) hasDim = true;
            optHtml += '<option value="'+lib.id+'"'+(isDefault?' selected':'')+'>'+(lib.category==='custom'?'📦 ':'📚 ')+App._escape(lib.dimension_name)+(isDefault?' (默认)':'')+'</option>';
        }
        // 条目预览
        var itemHtml = '';
        for (var j = 0; j < items.length; j++) {
            var it = items[j];
            var nm = (this._F && this._F[it.field]) || it.field;
            itemHtml += '<div class="s2-archive-item"><span class="s2-archive-item-field">'+App._escape(nm)+'</span><span class="s2-archive-item-val">'+App._escape(it.value.length>40?it.value.substring(0,40)+'…':it.value)+'</span></div>';
        }
        var overlay = document.createElement('div');
        overlay.id = 's2ArchiveModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:680;background:rgba(0,0,0,0.45);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:480px;">' +
            '<div class="modal-header"><h5>📥 存为词卡</h5><button class="header-btn-sm" onclick="document.getElementById(\'s2ArchiveModal\').remove()">&times;</button></div>' +
            '<div class="modal-body">' +
            '<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">将改造后的内容归档到词库，之后可在选择器中复用：</p>' +
            '<div class="s2-archive-items">'+itemHtml+'</div>' +
            '<div style="margin-top:10px;"><label style="font-size:11px;color:var(--text-muted);">目标词库</label>' +
            '<select id="s2ArchiveLib" class="s2-input" style="width:100%;margin-top:2px;">'+optHtml+'</select></div>' +
            '<div style="margin-top:8px;"><label style="font-size:11px;color:var(--text-muted);">或新建分组（输入名称将创建自定义分组）</label>' +
            '<input id="s2ArchiveNewGroup" class="modal-input" placeholder="新分组名称（可选）" style="margin-top:2px;"></div>' +
            '<div style="margin-top:8px;"><label style="font-size:11px;color:var(--text-muted);">释义 / 备注（可选）</label>' +
            '<input id="s2ArchiveDef" class="modal-input" placeholder="该词条的用途说明" style="margin-top:2px;"></div>' +
            '</div>' +
            '<div class="modal-footer"><button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'s2ArchiveModal\').remove()">取消</button>' +
            '<button class="btn btn-primary btn-sm" id="s2ArchiveConfirm">确认归档 ('+items.length+' 条)</button></div></div>';
        document.body.appendChild(overlay);
        document.getElementById('s2ArchiveConfirm').onclick = function() {
            var libId = parseInt(document.getElementById('s2ArchiveLib').value || '0');
            var newGroup = (document.getElementById('s2ArchiveNewGroup').value || '').trim();
            var def = (document.getElementById('s2ArchiveDef').value || '').trim();
            if (!libId && !newGroup) { App.showToast('请选择词库或填写新分组名称', 'warning'); return; }
            self._doArchive(items, libId, newGroup, def);
        };
    };

    // 执行归档（调用后端）
    App.seedanceV2._doArchive = async function(items, libId, newGroup, def) {
        App.showToast('正在归档...', 'info');
        var payload = {
            items: items,
            target_lib_id: libId || null,
            new_group_name: newGroup || null,
            definition: def || ''
        };
        try {
            var d = await App.fetchJSON('/api/seedance/v2/scenes/archive', {
                method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
            });
            var m = document.getElementById('s2ArchiveModal'); if (m) m.remove();
            if (d && d.ok) {
                App.showToast('✅ 已归档 '+d.saved+' 条'+(d.skipped?'，跳过重复 '+d.skipped+' 条':'')+(d.new_lib_id?'，新分组已创建':'')+'', 'success');
                // 刷新词库缓存，让新词卡立即可选
                var libsToClear = d.lib_ids || [];
                for (var i = 0; i < libsToClear.length; i++) { if (this.cardCache[libsToClear[i]]) delete this.cardCache[libsToClear[i]]; }
                if (newGroup) { await this.loadLibraries(); this.renderPickerLibTabs(this.activePickerLibId); }
            } else {
                App.showToast('归档未完成: ' + (d ? (d.detail || d.error || '未知错误') : '无响应'), 'error');
            }
        } catch (e) {
            App.showToast('归档异常: ' + e.message, 'error');
        }
    };

    // 折叠后纯文本行（无分组标签，仅字段值拼接）

    App.seedanceV2._scenePlainText = function(s) {
        var fields = ['camera_move','subject','action','scene_desc','composition','lighting','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics','character_voice','bgm','sfx'];
        var parts = [];
        for (var i = 0; i < fields.length; i++) {
            var v = s[fields[i]];
            if (v && v.trim()) parts.push(v.trim());
        }
        return parts.join('\uff0c') || '(\u7a7a)';
    };

    // 镜头操作

    App.seedanceV2._toggleSceneAudio = function(sid, enabled) {
        this._pushUndoBefore();
        var s = null;
        for (var i = 0; i < this.scenes.length; i++) {
            if (this.scenes[i].id === sid) { s = this.scenes[i]; break; }
        }
        if (!s) return;
        s.audio_enabled = enabled ? 1 : 0;
        App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+sid, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({audio_enabled: enabled ? 1 : 0})
        }).then(function() { App.seedanceV2.compose(); });
        this.renderScenes();
    };
    
    
    

    App.seedanceV2.openGroupManager=function(){var m=document.getElementById('s2GroupManager');if(m){m.style.display='flex';this._refreshCustomLibs();}};

    App.seedanceV2._refreshCustomLibs=async function(){var d=await App.fetchJSON('/api/seedance/v2/libraries?category=custom');if(d){this._customLibs=d.libraries;}var c=document.getElementById('s2GroupList');if(!c)return;if(!this._customLibs||!this._customLibs.length){c.innerHTML='<div class="s2-empty" style="padding:12px;font-size:12px;">暂无自定义分组</div>';}else{var h='';for(var i=0;i<this._customLibs.length;i++){var lib=this._customLibs[i];h+='<div class="s2-group-item"><span class="s2-group-item-name">'+App._escape(lib.dimension_name)+'</span><span class="s2-group-item-count">'+lib.card_count+' 词</span><button class="btn btn-xs btn-danger" onclick="App.seedanceV2.deleteCustomLib('+lib.id+')">\u2716</button></div>';}c.innerHTML=h;}};

    App.seedanceV2.deleteCustomLib=async function(libId){if(!confirm(App._t('common.ok', '确定删除此自定义分组及其所有词条？')))return;var d=await App.fetchJSON('/api/seedance/v2/libraries/'+libId,{method:'DELETE'});if(d&&d.ok){this._refreshCustomLibs();this.loadLibraries();App.showToast(App._t('auto.str_0196e406', '分组已删除'),'info');}};

    App.seedanceV2.createCustomLib=async function(){var inp=document.getElementById('s2NewGroupName');var name=(inp.value||'').trim();if(!name){App.showToast(App._t('auto.enter_分组名称', '请输入分组名称'),'warning');return;}var d=await App.fetchJSON('/api/seedance/v2/libraries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})});if(d&&d.ok){inp.value='';this._refreshCustomLibs();this.loadLibraries();App.showToast(App._t('auto.str_892b242f', '分组已创建'),'success');}else{App.showToast('创建未完成，可能名称重复','error');}};

    App.seedanceV2.onCustomLibAddWord=async function(libId){var inp=document.getElementById('s2CustomWordInput_'+libId);var wordText=(inp.value||'').trim();if(!wordText){App.showToast(App._t('auto.enter_词条内容', '请输入词条内容'),'warning');return;}var defInp=document.getElementById('s2CustomWordDef_'+libId);var def=defInp?(defInp.value||'').trim():'';var d=await App.fetchJSON('/api/seedance/v2/libraries/'+libId+'/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word_text:wordText,definition:def})});if(d&&d.ok){inp.value='';if(defInp)defInp.value='';// 清除缓存强制刷新
        if(this.cardCache[libId])delete this.cardCache[libId];App.showToast('已添加: '+wordText,'success');if(this.activePickerLibId==libId){this.renderCards(libId);}}else{App.showToast(App._t('auto.add_失败', '添加未完成'),'error');}};

    App.seedanceV2.addScene=async function(){if(!this.currentProjectId)return;this._pushUndoBefore();var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_order:this.scenes.length+1})});if(d&&d.ok)await this.openProject(this.currentProjectId);else console.warn("addScene failed", d);};

    // 拖拽 JSON 文件到镜头卡片上导入

    App.seedanceV2._handleFileDrop = function(file, sid) {
        if (!file || !file.name || !file.name.endsWith('.json')) {
            App.showToast(App._t('auto.str_aeaeae25', '⚠️ 请拖入 PromptKit 导出的 .json 镜头文件'), 'warning'); return;
        }
        var self = this;
        var reader = new FileReader();
        reader.onload = function(ev) {
            try {
                var data = JSON.parse(ev.target.result);
                if (!data.fields || data.type !== 'promptkit_scene') {
                    App.showToast('⚠️ 文件格式不正确', 'warning'); return;
                }
                var tgt = null, tgtIdx = -1;
                for (var i = 0; i < self.scenes.length; i++) {
                    if (self.scenes[i].id === sid) { tgt = self.scenes[i]; tgtIdx = i; break; }
                }
                if (!tgt) { App.showToast('目标镜头未找到', 'error'); return; }
                var fks = Object.keys(data.fields);
                var hasContent = false;
                for (var fi = 0; fi < fks.length; fi++) {
                    if (tgt[fks[fi]] && tgt[fks[fi]].trim()) { hasContent = true; break; }
                }
                var doImport = function() {
                    var updates = {};
                    for (var fi = 0; fi < fks.length; fi++) {
                        updates[fks[fi]] = data.fields[fks[fi]];
                        tgt[fks[fi]] = data.fields[fks[fi]];
                    }
                    App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid, {
                        method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(updates)
                    }).then(function() {
                        self.renderScenes(); self.compose();
                        App.showToast(App._t('auto.str_519effc5', '✅ 拖拽导入成功 → 镜头')+(tgtIdx+1), 'success');
                    });
                };
                if (hasContent) {
                    if (confirm(App._t('auto.str_9cee9d6f', '⚠️ 镜头')+(tgtIdx+1)+'已有内容，拖拽导入将覆盖。继续？')) { doImport(); }
                } else { doImport(); }
            } catch (err) {
                App.showToast('⚠️ 未能解析: '+err.message, 'error');
            }
        };
        reader.readAsText(file);
    };

    App.seedanceV2._isLastUnlocked=function(sid){var uc=0;for(var ci=0;ci<this.scenes.length;ci++){var sc=this.scenes[ci];if(sc.id!==sid&&!sc.is_locked)uc++;}return uc===0;};

    App.seedanceV2.deleteScene=async function(sid){this._pushUndoBefore();var p=document.getElementById('s2GlobalDelPop');if(p)p.style.display='none';var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+sid,{method:'DELETE'});if(d&&d.ok)await this.openProject(this.currentProjectId);else console.warn("deleteScene failed");};

    // 单镜头导出

    App.seedanceV2._exportScene = function(sid) {
        var scene = null, idx = -1;
        for (var i = 0; i < this.scenes.length; i++) {
            if (this.scenes[i].id === sid) { scene = this.scenes[i]; idx = i; break; }
        }
        if (!scene) { App.showToast(App._t('auto.str_67c3d5e5', '镜头未找到'), 'error'); return; }
        var fields = ['camera_move','subject','scene_desc','composition','lighting','action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics','character_voice','bgm','sfx'];
        var data = { version: '1.0', type: 'promptkit_scene', exported_at: new Date().toISOString(), scene_name: App._t('auto.str_45cf25c9', '镜头')+(idx+1), duration: scene.duration, fields: {} };
        for (var fi = 0; fi < fields.length; fi++) {
            if (scene[fields[fi]]) data.fields[fields[fi]] = scene[fields[fi]];
        }
        var blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
        var url = URL.createObjectURL(blob);
        var parts = [];
        if (scene.duration) parts.push(scene.duration+'s');
        if (scene.camera_move) parts.push(scene.camera_move);
        parts.push((scene.subject||App._t('auto.str_45cf25c9', '镜头')+(idx+1)).replace(/[\\/:*?"<>|]/g,'_').substring(0,20).trim()||'scene');
        var ts=new Date();var stamp=ts.getFullYear()+('0'+(ts.getMonth()+1)).slice(-2)+('0'+ts.getDate()).slice(-2)+'_'+('0'+ts.getHours()).slice(-2)+('0'+ts.getMinutes()).slice(-2);var projectName='';try{projectName=(App.seedanceV2.currentProject&&App.seedanceV2.currentProject.name||'').replace(/[\\/:*?"<>|]/g,'_').substring(0,15).trim();}catch(e){}var prefix=projectName?projectName+'_':'';var fn=prefix+stamp+'_'+parts.join('_').replace(/\s+/g,'')+'.json';
        var a = document.createElement('a'); a.href = url; a.download = fn;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        App.showToast(App._t('auto.str_bd474fee', '✅ 镜头')+(idx+1)+App._t('auto.str_5c51c3b8', '已导出'), 'success');
    };

    // 单镜头导入

    App.seedanceV2._importScene = function(sid) {
        var self = this;
        var input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
                try {
                    var data = JSON.parse(ev.target.result);
                    if (!data.fields || data.type !== 'promptkit_scene') {
                        App.showToast(App._t('auto.str_1d88d681', '⚠️ 文件格式不正确，请选择 PromptKit 导出的镜头文件'), 'warning'); return;
                    }
                    // 检测目标镜头是否有内容
                    var tgt = null, tgtIdx = -1;
                    for (var i = 0; i < self.scenes.length; i++) {
                        if (self.scenes[i].id === sid) { tgt = self.scenes[i]; tgtIdx = i; break; }
                    }
                    if (!tgt) { App.showToast('目标镜头未找到', 'error'); return; }
                    var fks = Object.keys(data.fields);
                    var hasContent = false;
                    for (var fi = 0; fi < fks.length; fi++) {
                        if (tgt[fks[fi]] && tgt[fks[fi]].trim()) { hasContent = true; break; }
                    }
                    var doImport = function() {
                        self._pushUndoBefore();
                        var updates = {};
                        for (var fi = 0; fi < fks.length; fi++) {
                            updates[fks[fi]] = data.fields[fks[fi]];
                            tgt[fks[fi]] = data.fields[fks[fi]];
                        }
                        App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid, {
                            method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(updates)
                        }).then(function() {
                            self.renderScenes(); self.compose();
                            App.showToast(App._t('auto.str_722f2318', '✅ 已导入到镜头')+(tgtIdx+1)+' (来自: '+App._escape(data.scene_name||App._t('auto.str_2a0c4740', '文件'))+')', 'success');
                        });
                    };
                    if (hasContent) {
                        if (confirm(App._t('auto.str_9cee9d6f', '⚠️ 镜头')+(tgtIdx+1)+'已有提示词内容，导入将覆盖现有内容。继续？')) { doImport(); }
                    } else { doImport(); }
                } catch (err) {
                    App.showToast('⚠️ 文件未能解析: '+err.message, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    App.seedanceV2.duplicateScene=async function(sid){this._pushUndoBefore();var src=null;for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){src=this.scenes[i];break;}}if(!src)return;var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_order:this.scenes.length+1,duration:src.duration||3,camera_move:src.camera_move,subject:src.subject,scene_desc:src.scene_desc,composition:src.composition,lighting:src.lighting,action:src.action,focal_length:src.focal_length,texture:src.texture,speed:src.speed,emotion:src.emotion,color_grade:src.color_grade,weather:src.weather,particles:src.particles,perspective:src.perspective,depth_of_field:src.depth_of_field,filter:src.filter,natural_force:src.natural_force,environment_detail:src.environment_detail,film_flaw:src.film_flaw,fantasy_physics:src.fantasy_physics,character_voice:src.character_voice,bgm:src.bgm,sfx:src.sfx,audio_enabled:src.audio_enabled})});if(d&&d.ok)await this.openProject(this.currentProjectId);else console.warn("duplicateScene failed", d);};

    App.seedanceV2.insertScene=async function(sid,pos){if(!this.currentProjectId)return;this._pushUndoBefore();var ref=null;for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){ref=this.scenes[i];break;}}if(!ref)return;var o=(pos==='before')?ref.scene_order:ref.scene_order+1;var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_order:o})});if(d&&d.ok){await this.openProject(this.currentProjectId);App.showToast(App._t('auto.str_6e62bf07', '已插入新镜头'),'success');}};

    App.seedanceV2.reorderScenes=async function(src,tgt){if(!this.currentProjectId)return;this._pushUndoBefore();var ids=[];for(var i=0;i<this.scenes.length;i++)ids.push(this.scenes[i].id);var si=ids.indexOf(src),ti=ids.indexOf(tgt);if(si<0||ti<0)return;ids.splice(si,1);var newTi=ids.indexOf(tgt);if(si<ti)ids.splice(newTi+1,0,src);else ids.splice(newTi,0,src);var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_ids:ids})});if(d&&d.ok){await this.openProject(this.currentProjectId);App.showToast(App._t('auto.str_7d7594cf', '镜头已重新排序'),'success');}};

    App.seedanceV2.updateSceneField=async function(sid,f,v){this._pushUndoBefore();var d={};d[f]=v;await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+sid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});};

    // ========== v5.36.2: 镜头视频任务状态徽章 ==========
    App.seedanceV2._sceneVideoBadge = function(sceneId) {
        if (!this._videoTaskCache) return '';
        var tasks = this._videoTaskCache[sceneId];
        if (!tasks || !tasks.length) return '';
        var active = null, done = null;
        for (var i = 0; i < tasks.length; i++) {
            var t = tasks[i];
            if (t.status === 'querying' || t.status === 'submitting' || t.status === 'queued') {
                if (!active || (t.progress||0) > (active.progress||0)) active = t;
            } else if (t.status === 'success') {
                done = t;
            }
        }
        if (active) {
            var prog = active.progress || 5;
            return '<span class="s2-vt-badge s2-vt-active" title="视频生成中 '+prog+'% — 点击查看任务面板" onclick="event.stopPropagation();App.seedanceV2.openVideoPanel()">🎬 '+prog+'%</span>';
        }
        if (done) {
            return '<span class="s2-vt-badge s2-vt-done" title="视频已生成 — 点击查看" onclick="event.stopPropagation();App.seedanceV2.openVideoPanel()">🎬 ✅</span>';
        }
        return '';
    };

    // 加载所有镜头视频任务状态缓存（渲染卡片时用）
    App.seedanceV2._loadVideoTaskCache = async function() {
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/tasks?limit=100');
            if (!d || !d.items) return;
            var cache = {};
            for (var i = 0; i < d.items.length; i++) {
                var t = d.items[i];
                if (!t.scene_id) continue;
                if (!cache[t.scene_id]) cache[t.scene_id] = [];
                cache[t.scene_id].push(t);
            }
            this._videoTaskCache = cache;
        } catch (e) { console.warn('video task cache fail', e); }
    };

    // 刷新徽章（提交后/面板关闭时调用）
    App.seedanceV2._refreshVideoBadges = async function() {
        await this._loadVideoTaskCache();
        this.renderScenes();
    };

    // v5.36.8: 后台完成通知定时器（30s，仅当有进行中任务；幂等启动）
    App.seedanceV2._startVideoNotifyTimer = function() {
        if (this._videoNotifyTimer) return;
        var self = this;
        this._videoNotifyTimer = setInterval(function() {
            if (!self.currentProjectId) return;
            if (self._notifyVideoCompletions) self._notifyVideoCompletions();
            if (self._loadVideoTaskCache) self._loadVideoTaskCache();
        }, 30000);
    };

    // ========== v5.36.2: 图像参考 ==========

    // 加载镜头/全局参考图缩略图
    App.seedanceV2._loadAllRefThumbs = async function() {
        if (!this.currentProjectId) return;
        var self = this;
        try {
            // 全局
            var gd = await App.fetchJSON('/api/seedance/v2/refs?project_id='+this.currentProjectId);
            if (gd) self._renderRefThumbs(gd.items || [], 'global');
            // 各镜头
            var scenes = this.scenes || [];
            for (var i = 0; i < scenes.length; i++) {
                var sid = scenes[i].id;
                var dd = await App.fetchJSON('/api/seedance/v2/refs?project_id='+this.currentProjectId+'&scene_id='+sid);
                if (dd) self._renderRefThumbs(dd.items || [], sid);
            }
        } catch (e) { console.warn('refs load fail', e); }
    };

    // 渲染参考图缩略图区
    App.seedanceV2._renderRefThumbs = function(items, scopeKey) {
        var c = document.getElementById('s2RefThumbs_'+scopeKey);
        if (!c) return;
        if (!items.length) { c.innerHTML = '<span style="font-size:10px;color:var(--text-muted);">暂无参考图</span>'; return; }
        var h = '';
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var label = (it.ref_type === 'scene' ? '🏞' : (it.ref_type === 'style' ? '🎨' : '🧑')) + (it.ref_name ? ' '+App._escape(it.ref_name) : '');
            h += '<span class="s2-ref-thumb" title="'+App._escape(it.file_path||'')+'">' +
                '<img src="'+App._escape(it.preview_url || '')+'" onerror="this.style.opacity=0.3" loading="lazy" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border-color);">' +
                '<span class="s2-ref-thumb-label">'+label+'</span>' +
                '<button class="s2-ref-del" data-ref-id="'+it.id+'" title="删除">✕</button>' +
                '<button class="s2-ref-edit" data-ref-id="'+it.id+'" title="编辑名称/类型">✏️</button>' +
                '</span>';
        }
        h += '<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">'+items.length+'/9</span>';
        c.innerHTML = h;
        // 重新绑定删除（renderScenes 绑定的是渲染时的，这里动态补绑）
        var self = this;
        c.querySelectorAll('.s2-ref-del').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.dataset.refId);
                if (id) self._deleteRef(id);
            });
        });
        c.querySelectorAll('.s2-ref-edit').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.dataset.refId);
                if (id) self._editRefName(id);
            });
        });
    };

    // 编辑参考图名称/类型
    App.seedanceV2._editRefName = async function(refId) {
        var self = this;
        try {
            var list = await App.fetchJSON('/api/seedance/v2/refs?project_id='+this.currentProjectId);
            var gd = list ? (list.items||[]) : [];
            var scenes = this.scenes || [];
            var all = gd.slice();
            for (var i = 0; i < scenes.length; i++) {
                var dd = await App.fetchJSON('/api/seedance/v2/refs?project_id='+this.currentProjectId+'&scene_id='+scenes[i].id);
                if (dd && dd.items) all = all.concat(dd.items);
            }
            var it = null;
            for (var j = 0; j < all.length; j++) { if (all[j].id === refId) { it = all[j]; break; } }
            if (!it) { App.showToast('参考图不存在', 'error'); return; }
            var newName = prompt('参考图名称（角色名用于提示词声明）：', it.ref_name || '');
            if (newName === null) return;
            var newType = prompt('类型：character=角色 / scene=场景 / style=风格', it.ref_type || 'character');
            if (!newType || !['character','scene','style'].includes(newType)) { App.showToast('已取消', 'info'); return; }
            if (newType === 'character' && !(newName||'').trim()) { App.showToast('角色参考图必须填写角色名', 'warning'); return; }
            var d = await App.fetchJSON('/api/seedance/v2/refs/'+refId, {
                method:'PUT', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ ref_name: (newName||'').trim(), ref_type: newType })
            });
            if (d && d.ok) { App.showToast('✅ 参考图已更新', 'success'); await this._loadAllRefThumbs(); }
            else { App.showToast('更新未完成: ' + (d ? (d.detail||'未知') : '无响应'), 'error'); }
        } catch (e) { App.showToast('更新异常: '+e.message, 'error'); }
    };

    // 删除参考图
    App.seedanceV2._deleteRef = async function(refId) {
        var self = this;
        try {
            var d = await App.fetchJSON('/api/seedance/v2/refs/'+refId, { method:'DELETE' });
            if (d && d.ok) {
                App.showToast('已删除参考图', 'info');
                await this._loadAllRefThumbs();
            } else {
                App.showToast('删除未完成: ' + (d ? (d.detail||'未知') : '无响应'), 'error');
            }
        } catch (e) { App.showToast('删除异常: '+e.message, 'error'); }
    };

    // 打开参考图添加弹窗（三来源：上传/媒体库/角色库）
    App.seedanceV2._openRefPicker = async function(sceneId) {
        var old = document.getElementById('s2RefPicker');
        if (old) old.remove();
        var self = this;
        var scopeLabel = sceneId ? ('镜头 #' + (function(){ for (var i=0;i<self.scenes.length;i++){ if(self.scenes[i].id===sceneId) return self.scenes[i].scene_order; } return sceneId; })()) : '全局';
        var overlay = document.createElement('div');
        overlay.id = 's2RefPicker';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:720;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:640px;">' +
            '<div class="modal-header"><h5>🖼 添加图像参考 — '+scopeLabel+'</h5><button class="header-btn-sm" onclick="document.getElementById(\'s2RefPicker\').remove()">&times;</button></div>' +
            '<div class="modal-body">' +
            '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
            '<button class="btn btn-sm btn-primary s2-ref-tab" data-tab="upload">📤 上传图片</button>' +
            '<button class="btn btn-sm btn-outline s2-ref-tab" data-tab="media">📚 媒体库</button>' +
            '<button class="btn btn-sm btn-outline s2-ref-tab" data-tab="character">🧑 角色库</button>' +
            '</div>' +
            '<div id="s2RefTabBody"></div>' +
            '</div>' +
            '<div class="modal-footer"><span style="font-size:10px;color:var(--text-muted);">上限 9 张（角色+场景合计）</span><button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'s2RefPicker\').remove()">关闭</button></div></div>';
        document.body.appendChild(overlay);
        var renderTab = function(tab) {
            var body = document.getElementById('s2RefTabBody');
            document.querySelectorAll('.s2-ref-tab').forEach(function(b){ b.classList.remove('btn-primary'); b.classList.add('btn-outline'); });
            var btn = document.querySelector('.s2-ref-tab[data-tab="'+tab+'"]');
            if (btn) { btn.classList.remove('btn-outline'); btn.classList.add('btn-primary'); }
            if (tab === 'upload') {
                body.innerHTML = '<div style="padding:10px;">' +
                    '<label style="font-size:11px;color:var(--text-muted);">参考类型</label>' +
                    '<select id="s2RefType" class="s2-input" style="width:100%;margin:4px 0 8px;" onchange="App.seedanceV2._refTypeChanged(this)"><option value="character">🧑 角色参考图</option><option value="scene">🏞 场景参考图</option><option value="style">🎨 风格参考图</option></select>' +
                    '<label style="font-size:11px;color:var(--text-muted);" id="s2RefNameLabel">角色名（角色类型必填）</label>' +
                    '<input id="s2RefName" class="modal-input" placeholder="如：主角·李明" style="margin:4px 0 10px;">' +
                    '<input id="s2RefFile" type="file" accept="image/*" style="margin-bottom:10px;">' +
                    '<button class="btn btn-primary btn-sm" id="s2RefUploadBtn">上传并添加</button></div>';
                document.getElementById('s2RefUploadBtn').onclick = function() {
                    var f = document.getElementById('s2RefFile').files[0];
                    if (!f) { App.showToast('请选择图片', 'warning'); return; }
                    self._uploadRef(sceneId, f);
                };
            } else if (tab === 'media') {
                body.innerHTML = '<div style="padding:6px;font-size:12px;color:var(--text-muted);">加载媒体库...</div>';
                self._loadMediaRefs(sceneId, body);
            } else {
                body.innerHTML = '<div style="padding:6px;font-size:12px;color:var(--text-muted);">加载角色库...</div>';
                self._loadCharacterRefs(sceneId, body);
            }
        };
        overlay.querySelectorAll('.s2-ref-tab').forEach(function(b){
            b.addEventListener('click', function(){ renderTab(this.dataset.tab); });
        });
        renderTab('upload');
    };

    // 上传参考图类型切换：更新名称标签提示
    App.seedanceV2._refTypeChanged = function(sel) {
        var lbl = document.getElementById('s2RefNameLabel');
        if (!lbl) return;
        var v = sel.value;
        lbl.textContent = v === 'character' ? '角色名（必填，用于提示词角色对应）' : (v === 'scene' ? '场景名（可选）' : '风格名（可选）');
        var inp = document.getElementById('s2RefName');
        if (inp) inp.placeholder = v === 'character' ? '如：主角·李明' : (v === 'scene' ? '如：雪山之巅' : '如：赛博朋克');
    };

    // 上传参考图并添加
    App.seedanceV2._uploadRef = async function(sceneId, file) {
        App.showToast('上传中...', 'info');
        var self = this;
        try {
            var fd = new FormData();
            fd.append('file', file);
            var up = await App.fetchJSON('/api/seedance/v2/refs/upload', { method:'POST', body: fd, _noJson: true });
            // fetchJSON 需要检查返回格式
            var upData = null;
            if (up && typeof up === 'string') { try { upData = JSON.parse(up); } catch(e){} }
            else if (up && up.ok !== undefined) upData = up;
            if (!upData || !upData.ok) {
                App.showToast('上传未完成: ' + (upData ? (upData.detail||'未知') : '无响应'), 'error');
                return;
            }
            var refType = document.getElementById('s2RefType') ? document.getElementById('s2RefType').value : 'character';
            var refName = document.getElementById('s2RefName') ? (document.getElementById('s2RefName').value || '') : '';
            // v5.36.5: 角色参考必须命名
            if (refType === 'character' && !refName.trim()) {
                App.showToast('角色参考图必须填写角色名（如：主角·李明）', 'warning');
                return;
            }
            var payload = {
                project_id: this.currentProjectId,
                scene_id: sceneId || null,
                ref_type: refType,
                ref_name: refName,
                source_kind: 'upload',
                file_path: upData.file_path,
                url: upData.url
            };
            var d = await App.fetchJSON('/api/seedance/v2/refs', {
                method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
            });
            var m = document.getElementById('s2RefPicker'); if (m) m.remove();
            if (d && d.ok) {
                App.showToast('✅ 参考图已添加', 'success');
                await this._loadAllRefThumbs();
            } else {
                App.showToast('添加未完成: ' + (d ? (d.detail||'未知') : '无响应'), 'error');
                this._loadAllRefThumbs();
            }
        } catch (e) {
            App.showToast('上传异常: '+e.message, 'error');
        }
    };

    // 从媒体库选择
    App.seedanceV2._loadMediaRefs = async function(sceneId, bodyEl) {
        var self = this;
        try {
            var d = await App.fetchJSON('/api/media/library?page_size=30');
            var items = (d && d.items) ? d.items : [];
            if (!items.length) { bodyEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">媒体库暂无图片</div>'; return; }
            var h = '<div style="display:flex;flex-wrap:wrap;gap:8px;max-height:300px;overflow-y:auto;padding:4px;">';
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                var fname = it.filename || '';
                var url = '/api/media/original/' + encodeURIComponent(fname);
                h += '<div class="s2-media-pick" data-fname="'+App._escape(fname)+'" data-url="'+url+'" title="'+App._escape(fname)+'" style="cursor:pointer;width:70px;text-align:center;">' +
                    '<img src="'+url+'" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--border-color);" loading="lazy" onerror="this.style.opacity=0.2">' +
                    '<div style="font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+App._escape((it.original_filename||fname).substring(0,10))+'</div></div>';
            }
            h += '</div>';
            bodyEl.innerHTML = h;
            bodyEl.querySelectorAll('.s2-media-pick').forEach(function(el){
                el.addEventListener('click', async function() {
                    var fname = this.dataset.fname, url = this.dataset.url;
                    var refType = prompt('参考类型？(character=角色 / scene=场景 / style=风格)', 'character');
                    if (!refType || !['character','scene','style'].includes(refType)) { App.showToast('已取消', 'info'); return; }
                    // v5.36.5: 角色参考必须命名（提示词声明需要角色名对应，模型才知道图是谁）
                    var refName = prompt(refType==='character' ? '角色名（必填，如：主角·李明）：' : '备注名（可空，如：雪山场景）：', '');
                    if (refType==='character' && !(refName||'').trim()) { App.showToast('角色参考图必须填写角色名', 'warning'); return; }
                    var d = await App.fetchJSON('/api/seedance/v2/refs', {
                        method:'POST', headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({ project_id: self.currentProjectId, scene_id: sceneId||null,
                            ref_type: refType, ref_name: (refName||'').trim(), source_kind:'media_lib', filename: fname, url: url })
                    });
                    var m = document.getElementById('s2RefPicker'); if (m) m.remove();
                    if (d && d.ok) { App.showToast('✅ 已添加媒体库参考图', 'success'); await self._loadAllRefThumbs(); }
                    else { App.showToast('添加未完成: ' + (d ? (d.detail||'未知') : '无响应'), 'error'); }
                });
            });
        } catch (e) {
            bodyEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">媒体库加载失败: '+App._escape(e.message)+'</div>';
        }
    };

    // 从角色库选择
    App.seedanceV2._loadCharacterRefs = async function(sceneId, bodyEl) {
        var self = this;
        try {
            var d = await App.fetchJSON('/api/characters?page_size=50');
            var items = (d && d.items) ? d.items : [];
            if (!items.length) { bodyEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">角色库暂无角色</div>'; return; }
            var h = '<div style="display:flex;flex-wrap:wrap;gap:8px;max-height:300px;overflow-y:auto;padding:4px;">';
            for (var i = 0; i < items.length; i++) {
                var ch = items[i];
                var av = ch.avatar || ch.preview_image || '';
                var imgUrl = av ? '/api/characters/images/' + encodeURIComponent(av) : '';
                h += '<div class="s2-char-pick" data-cid="'+ch.id+'" data-name="'+App._escape(ch.name||'')+'" title="'+App._escape(ch.name||'')+'" style="cursor:pointer;width:80px;text-align:center;">' +
                    (imgUrl ? '<img src="'+imgUrl+'" style="width:64px;height:64px;object-fit:cover;border-radius:50%;border:1px solid var(--border-color);" loading="lazy" onerror="this.style.opacity=0.2">' : '<div style="width:64px;height:64px;border-radius:50%;background:var(--hover-bg);display:flex;align-items:center;justify-content:center;font-size:24px;">🧑</div>') +
                    '<div style="font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+App._escape(ch.name||'').substring(0,8)+'</div></div>';
            }
            h += '</div>';
            bodyEl.innerHTML = h;
            bodyEl.querySelectorAll('.s2-char-pick').forEach(function(el){
                el.addEventListener('click', async function() {
                    var cid = this.dataset.cid, name = this.dataset.name;
                    // v5.36.5: 角色名可改（默认取角色档案名）
                    var refName = prompt('角色参考名（用于提示词声明）：', name||'');
                    if (refName === null) return;
                    if (!(refName||'').trim()) { App.showToast('角色参考图必须填写角色名', 'warning'); return; }
                    var d = await App.fetchJSON('/api/seedance/v2/refs', {
                        method:'POST', headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({ project_id: self.currentProjectId, scene_id: sceneId||null,
                            ref_type:'character', ref_name: (refName||'').trim(), source_kind:'character', character_id: parseInt(cid) })
                    });
                    var m = document.getElementById('s2RefPicker'); if (m) m.remove();
                    if (d && d.ok) { App.showToast('✅ 已添加角色参考图', 'success'); await self._loadAllRefThumbs(); }
                    else { App.showToast('添加未完成: ' + (d ? (d.detail||'未知') : '无响应'), 'error'); }
                });
            });
        } catch (e) {
            bodyEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">角色库加载失败: '+App._escape(e.message)+'</div>';
        }
    };

    // v5.36.33: 刷新即梦会话列表（组装器全局参数区下拉）
    App.seedanceV2._refreshVideoSessions = async function(selectEl) {
        var sel = selectEl || document.getElementById('s2_video_session');
        var self = this;
        var curVal = sel ? sel.value : '';
        try {
            var d = await App.fetchJSON('/api/seedance/v2/video/sessions?force=1');
            var sessions = (d && d.sessions) ? d.sessions : [];
            if (self._videoSessions) self._videoSessions = sessions;
            if (!sel) sel = document.getElementById('s2_video_session');
            if (!sel) return;
            var cur = sel.value || curVal || '0';
            var opts = '';
            if (!sessions.length) sessions = [{id: 0, name: 'default'}];
            for (var i = 0; i < sessions.length; i++) {
                var s = sessions[i];
                var label = (String(s.id) === '0') ? '0 · 默认对话（通用）' : (s.id + ' · ' + App._escape(String(s.name || '').substring(0, 14)));
                opts += '<option value="'+s.id+'"'+(String(s.id)===String(cur)?' selected':'')+'>'+label+'</option>';
            }
            sel.innerHTML = opts;
            if (String(cur) !== '0' && !sessions.some(function(s){ return String(s.id) === String(cur); })) {
                sel.value = '0';
                this._saveVideoParam('video_session', 0);
            }
        } catch (e) {
            console.warn('refresh sessions fail', e);
        }
    };

    // v5.36.0: 即梦视频参数实时保存（全局参数区联动）
    App.seedanceV2._saveVideoParam=async function(key,val){
        if(!this.currentProjectId)return;
        if(key==='video_session'){val=parseInt(val||0);if(isNaN(val))val=0;}
        if(this.currentProject)this.currentProject[key]=val;
        var d={};d[key]=val;
        try{
            var r=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId,{
                method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)
            });
            if(r&&r.ok){App.showToast('已保存','success');}
            // v5.36.27: 模型切换后同步过滤分辨率下拉（避免保存模型不支持的分辨率）
            if(key==='video_model') this._syncVideoResOptions(val);
        }catch(e){console.warn('save video param fail',e);}
    };

    // v5.36.27: 模型切换 → 分辨率下拉按模型支持档位重渲染
    App.seedanceV2._syncVideoResOptions=function(model){
        var sel=document.getElementById('s2_video_resolution');
        if(!sel)return;
        var allowed=['480p','720p','1080p','4k'];
        if(model==='seedance2.5')allowed=['480p','720p'];
        else if(model==='seedance2.0_vip')allowed=['720p','1080p','4k'];
        else allowed=['720p'];
        var cur=sel.value||'';
        var opts='';
        for(var i=0;i<allowed.length;i++){
            opts+='<option value="'+allowed[i]+'"'+(allowed[i]===cur?' selected':'')+'>'+allowed[i]+'</option>';
        }
        sel.innerHTML=opts;
        if(allowed.indexOf(cur)<0){sel.value=allowed[allowed.length-1];this._saveVideoParam('video_resolution',sel.value);}
    };

    // v5.36.11: 全局参数实时保存（画幅/分辨率/全局画风/全局转场/音频等，防刷新丢失）
    App.seedanceV2._saveGlobalParams=function(){
        if(!this.currentProjectId)return;
        var self=this;
        var d={};
        var map={'s2_name':'name','s2_aspect_ratio':'aspect_ratio','s2_resolution':'resolution','s2_global_style':'global_style','s2_global_transition':'global_transition','s2_negative_prompt':'negative_prompt','s2_bgm':'bgm','s2_sfx':'sfx','s2_dialogue':'dialogue'};
        var any=false;
        for(var id in map){
            var el=document.getElementById(id);
            if(!el)continue;
            var v=el.value;
            if(map[id]==='name'&&!String(v||'').trim())continue;
            if(this.currentProject)this.currentProject[map[id]]=v;
            d[map[id]]=v;
            any=true;
        }
        var cb=document.getElementById('s2_audio_enabled');
        if(cb){
            d['audio_enabled']=cb.checked?1:0;
            if(this.currentProject)this.currentProject['audio_enabled']=cb.checked;
            any=true;
        }
        if(!any)return;
        if(this._gpSaveTimer)clearTimeout(this._gpSaveTimer);
        this._gpSaveTimer=setTimeout(function(){
            App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId,{
                method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)
            }).then(function(r){if(!r||!r.ok)console.warn('global params save fail',r);})
            .catch(function(e){console.warn('global params save error',e);});
        },500);
    };

    // ========== Phase13.4: 撤销栈 ==========

    App.seedanceV2._pushUndo = function() {
        var snapshot = JSON.parse(JSON.stringify(this.scenes));
        this._undoStack.push(snapshot);
        if (this._undoStack.length > this._undoMax) this._undoStack.shift();
    };

    App.seedanceV2._undoLastChange = function() {
        if (this._undoStack.length === 0) return;
        var prev = this._undoStack.pop();
        this.scenes = prev;
        this.renderScenes();
        this.compose();
        App.showToast('已撤销', 'info');
    };
    // 在关键修改前自动压栈

    App.seedanceV2._pushUndoBefore = function() {
        if (this.scenes && this.scenes.length > 0) this._pushUndo();
    };

    // ========== Phase13.4: 脏标记渲染优化 ==========
    App.seedanceV2._dirtySceneIds = new Set();
    App.seedanceV2._renderTimer = null;

    App.seedanceV2._markSceneDirty = function(sceneId) {
        if (!sceneId) return;
        this._dirtySceneIds.add(sceneId);
        if (!this._renderTimer) {
            var self = this;
            this._renderTimer = setTimeout(function() {
                self._flushDirtyRender();
            }, 80);
        }
    };

    App.seedanceV2._flushDirtyRender = function() {
        this._renderTimer = null;
        if (this._dirtySceneIds.size === 0) return;
        var ids = Array.from(this._dirtySceneIds);
        this._dirtySceneIds.clear();
        for (var i = 0; i < ids.length; i++) {
            var sid = ids[i];
            var scene = null;
            for (var j = 0; j < this.scenes.length; j++) {
                if (this.scenes[j].id === sid) { scene = this.scenes[j]; break; }
            }
            if (!scene) continue;
            var card = document.querySelector('.s2-scene-card[data-scene-id="' + sid + '"]');
            if (card) {
                var idx = scene.scene_order - 1;
                var newHTML = this.renderSceneCard(scene, idx);
                card.outerHTML = newHTML;
            }
        }
        this._refreshTimeline();
    };

    // 时长设定

    App.seedanceV2.applyDurPreset=function(el){var v=parseFloat(el.value);if(isNaN(v))return;var inp=document.querySelector('.s2-scene-dur[data-scene-id="'+el.dataset.targetScene+'"]');if(inp){inp.value=v;inp.dispatchEvent(new Event('change',{bubbles:true}));}el.value='';};
    
    // ============================================================
    // 拓展功能单元(Ext-Unit)系统
    // ============================================================
    // 拓展单元仅由用户显式添加，不自动从已有字段值发现（避免与基础字段组重叠导致 phantom 单元）
    // extUnit 持久化：存 localStorage（project+scene 级别）

    App.seedanceV2._saveExtUnitConfig=function(sid){var sc=null;for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){sc=this.scenes[i];break;}}if(!sc)return;var units=(sc._extUnits||[]).map(function(u){return u.field;});var key='pk_extcfg_'+this.currentProjectId;var all={};try{all=JSON.parse(localStorage.getItem(key)||'{}');}catch(e){}all[sid]=units;try{localStorage.setItem(key,JSON.stringify(all));}catch(e){}};

    App.seedanceV2._restoreExtUnitConfig=function(){var key='pk_extcfg_'+this.currentProjectId;var all={};try{all=JSON.parse(localStorage.getItem(key)||'{}');}catch(e){}for(var i=0;i<this.scenes.length;i++){var sid=this.scenes[i].id;var fields=all[sid]||[];this.scenes[i]._extUnits=fields.map(function(f){return{field:f};});}};
})();
