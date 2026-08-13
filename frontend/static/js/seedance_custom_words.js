/**
 * seedance_custom_words.js - 自定义词条增删改（从 seedance_v2_composer.js 拆出）
 */
(function() {
'use strict';
if (!App.seedanceV2 || App.seedanceV2._openGroupCreator) return;
    // ============ 自定义词条增删改 ============
    // 快速创建自定义分组（弹窗输入名称）
    App.seedanceV2._openGroupCreator=function(){
        var name=prompt(App._t('common.new', '新建自定义分组名称:'),'');
        if(!name||!(name=name.trim()))return;
        var self=this;
        App.fetchJSON('/api/seedance/v2/libraries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})}).then(function(d){
            if(d&&d.ok){
                self.loadLibraries().then(function(){
                    // 自动切换到新建的分组
                    App.seedanceV2._renderRightPickerContent(App.seedanceV2.getLibraryById(d.id));
                });
                App.showToast(App._t('auto.str_87c99bd8', '分组已创建: ')+name,'success');
            }else{App.showToast('创建未完成, 名称可能重复','error');}
        });
    };
    // 从面板输入框添加词条到自定义分组
    App.seedanceV2._addPanelWord=async function(libId){
        var wi=document.getElementById('s2PanelWordInput');
        var di=document.getElementById('s2PanelWordDef');
        var w=(wi.value||'').trim();
        if(!w){App.showToast(App._t('auto.enter_词条内容', '请输入词条内容'),'warning');return;}
        var def=di?(di.value||'').trim():'';
        var d=await App.fetchJSON('/api/seedance/v2/libraries/'+libId+'/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word_text:w,definition:def})});
        if(d&&d.ok){wi.value='';if(di)di.value='';
        delete App.seedanceV2.cardCache[libId];await App.seedanceV2.loadCards(libId);
        var lib=App.seedanceV2.getLibraryById(libId);
        if(lib)App.seedanceV2._renderRightPickerContent(lib);
        App.showToast('已添加词条','success');}
        else{App.showToast(App._t('auto.add_失败', '添加未完成'),'error');}};
    // 编辑自定义词条（弹窗）
    App.seedanceV2._editCustomCard=function(cardId,oldText,oldDef){
        var w=prompt(App._t('common.edit', '编辑词条:'),oldText);
        if(w===null)return;w=(w||'').trim();
        if(!w){App.showToast('词条内容不能为空','warning');return;}
        var def=prompt('释义(可留空):',oldDef||'');
        if(def===null)return;
        var self=this;
        App.fetchJSON('/api/seedance/v2/cards/'+cardId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({word_text:w,definition:def||''})}).then(function(d){
            if(d&&d.ok){
                var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
                if(lib){delete App.seedanceV2.cardCache[lib.id];App.seedanceV2.loadCards(lib.id).then(function(){
                    App.seedanceV2._renderRightPickerContent(lib);});}
                App.showToast('词条已更新','success');
            }else{App.showToast(App._t('auto.str_930442e2', '更新未完成'),'error');}
        });
    };
    // 删除自定义词条
    App.seedanceV2._deleteCustomCard=async function(cardId){
        if(!confirm(App._t('common.ok', '确定删除此词条？')))return;
        var d=await App.fetchJSON('/api/seedance/v2/cards/'+cardId,{method:'DELETE'});
        if(d&&d.ok){
            var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
            if(lib){delete App.seedanceV2.cardCache[lib.id];await App.seedanceV2.loadCards(lib.id);
            App.seedanceV2._renderRightPickerContent(lib);}
            App.showToast(App._t('auto.str_ecb51c53', '词条已删除'),'info');
        }else{App.showToast(App._t('common.delete', '未能删除'),'error');}
    };
    // 重命名自定义分组
    App.seedanceV2._renameGroup=function(libId){
        var lib=App.seedanceV2.getLibraryById(libId);
        if(!lib)return;
        var name=prompt('重命名分组:',lib.dimension_name||'');
        if(name===null||!(name||'').trim())return;
        name=name.trim();
        var self=this;
        App.fetchJSON('/api/seedance/v2/libraries/'+libId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})}).then(function(d){
            if(d&&d.ok){
                self.loadLibraries().then(function(){
                    var nl=App.seedanceV2.getLibraryById(libId);
                    if(nl)App.seedanceV2._renderRightPickerContent(nl);
                });
                App.showToast(App._t('auto.str_b4aa4e29', '分组已重命名'),'success');
            }else{App.showToast(App._t('auto.str_37ba51a4', '重命名未完成'),'error');}
        });
    };
    // 词卡视频上传
    App.seedanceV2._uploadWordCardVideo=async function(cardId,file){
        var fd=new FormData();fd.append('file',file);
        try{
            var r=await fetch('/api/seedance/v2/cards/'+cardId+'/video',{method:'POST',body:fd});
            var d=await r.json();
            if(d&&d.ok){
                var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
                if(lib){delete App.seedanceV2.cardCache[lib.id];await App.seedanceV2.loadCards(lib.id);
                App.seedanceV2._renderRightPickerContent(lib);}
                App.showToast(App._t('auto.str_8cdbb58b', '视频预览已保存'),'success');
            }else{App.showToast(App._t('auto.upload_失败', '上传未完成'),'error');}
        }catch(e){App.showToast(App._t('auto.upload_异常__', '上传异常: ')+e.message,'error');}
    };
    // 悬停视频预览
    App.seedanceV2._thumbHoverIn=function(el){
        var vt=el.dataset.video;
        if(!vt)return;
        var zone=el.querySelector('.s2-card-thumb-zone video');
        if(zone&&zone.paused){zone.play().catch(function(){})}
    };
    App.seedanceV2._thumbHoverOut=function(el){
        var zone=el.querySelector('.s2-card-thumb-zone video');
        if(zone&&!zone.paused){zone.pause()}
    };
    App.seedanceV2._debouncedCompose = function() {
        var self = this;
        if (self._composeTimer) clearTimeout(self._composeTimer);
        self._composeTimer = setTimeout(function() { self.compose(); }, self._composeDebounceMs);
    };
    // ============ 镜头文本审阅 v2 — 多镜头+时间线+拖拽排序 ============
    App.seedanceV2._srStartIdx = 0;
    App.seedanceV2._srShowCount = 1;
    App.seedanceV2._srDragData = null;  // { sceneId, startIdx, offsetX }

    App.seedanceV2.openSceneReview = function(sceneId) {
        var idx = -1;
        for (var i = 0; i < this.scenes.length; i++) {
            if (this.scenes[i].id === sceneId) { idx = i; break; }
        }
        if (idx < 0) idx = 0;
        this._srStartIdx = idx;
        this._srShowCount = parseInt(document.getElementById('srShowCount')?.value || '1');
        if (!this._srShowCount || this._srShowCount < 1) this._srShowCount = 0;
        this._renderSrTimeline();
        this._renderSrShots();
        document.getElementById('sceneReviewTitle').textContent = App._t('auto.str_f8a466c3', '镜头审阅 (')+this.scenes.length+'镜)';
        document.getElementById('sceneReviewModal').style.display = 'flex';
    };
    App.seedanceV2._renderSrTimeline = function() {
        var bar = document.getElementById('srTimelineBar');
        if (!bar) return;
        var p = this.currentProject;
        var total = p ? (p.total_duration || 15) : 15;
        // 刻度行HTML
        var tkHTML = '<div class="sr-timeline-ticks" id="srTimelineTicks">';
        for (var i = 0; i < this.scenes.length; i++) {
            var s = this.scenes[i];
            var dur = (s.duration && s.duration > 0 ? s.duration : (s.end_time - s.start_time)) || 0.5;
            tkHTML += '<span class="sr-tick-cell" style="flex-grow:' + dur + ';"></span>';
        }
        tkHTML += '</div>';
        // 分段HTML
        var segHTML = '';
        for (var i = 0; i < this.scenes.length; i++) {
            var s = this.scenes[i];
            var w = ((s.end_time - s.start_time) / total) * 100;
            var dur = (s.duration && s.duration > 0 ? s.duration : (s.end_time - s.start_time)) || 0.5;
            var segColor = App.seedanceV2._sceneColor(s.id);
            var isActive = (i >= this._srStartIdx && i < this._srStartIdx + (this._srShowCount || this.scenes.length));
            var label = (s.subject || App._t('auto.str_45cf25c9', '镜头')+(i+1)).substring(0, 5);
            segHTML += '<div class="sr-timeline-seg' + (isActive ? ' sr-timeline-active' : '') + '" draggable="true" data-scene-id="'+s.id+'" data-scene-idx="'+i+'" style="flex-grow:' + dur + ';background:'+segColor+';" title="'+App._escape(s.start_time+'-'+s.end_time+'s: '+label)+' (点击查看，拖拽排序)" onclick="App.seedanceV2._srJumpTo('+i+')"><span>'+label+'</span></div>';
        }
        bar.innerHTML = '<div class="sr-timeline-inner">' + tkHTML + '<div class="sr-timeline-segs">' + segHTML + '</div></div>';
        // v9.3.9: JS测量分段实际像素后精确定位刻度
        var self = this;
        requestAnimationFrame(function() { self._syncSrTicks(); });
        // 拖拽排序绑定
        var segs = bar.querySelectorAll('.sr-timeline-seg');
        segs.forEach(function(el) {
            el.addEventListener('dragstart', function(e) {
                self._srDragData = { sceneId: parseInt(this.dataset.sceneId), startIdx: parseInt(this.dataset.sceneIdx), offsetX: e.clientX - this.getBoundingClientRect().left };
                this.style.opacity = '0.5';
            });
            el.addEventListener('dragend', function(e) { this.style.opacity = '1'; self._srDragData = null; });
            el.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('sr-drag-over'); });
            el.addEventListener('dragleave', function(e) { this.classList.remove('sr-drag-over'); });
            el.addEventListener('drop', function(e) {
                e.preventDefault(); this.classList.remove('sr-drag-over');
                if (!self._srDragData) return;
                var fromId = self._srDragData.sceneId;
                var toIdx = parseInt(this.dataset.sceneIdx);
                if (fromId === parseInt(this.dataset.sceneId)) return;
                var fromIdx = -1;
                for (var j = 0; j < self.scenes.length; j++) { if (self.scenes[j].id === fromId) { fromIdx = j; break; } }
                if (fromIdx < 0) return;
                // 移动scene对象
                var moved = self.scenes.splice(fromIdx, 1)[0];
                self.scenes.splice(toIdx, 0, moved);
                // 更新后端排序
                var ids = self.scenes.map(function(s) { return s.id; });
                App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/reorder', {
                    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scene_ids:ids})
                }).then(function() {
                    self._renderSrTimeline();
                    self._renderSrShots();
                    self.renderScenes();
                    self.compose();
                });
            });
        });
    };
    // v9.3.9: 审阅弹窗刻度同步——测量sr分段真实像素
    App.seedanceV2._syncSrTicks = function() {
        var bar = document.getElementById('srTimelineBar');
        var ticksRow = document.getElementById('srTimelineTicks');
        if (!bar || !ticksRow) return;
        var scenes = this.scenes.slice().sort(function(a, b) { return (a.start_time||0) - (b.start_time||0); });
        if (!scenes.length) return;
        var barR = bar.getBoundingClientRect();
        var tkR = ticksRow.getBoundingClientRect();
        var xOff = barR.left - tkR.left;
        var pts = [{t:0, px:xOff, label:'0s'}];
        for (var i = 0; i < scenes.length; i++) {
            var seg = bar.querySelector('.sr-timeline-seg[data-scene-id="' + scenes[i].id + '"]');
            if (!seg) continue;
            var sr = seg.getBoundingClientRect();
            var rightPx = sr.right - barR.left + xOff;
            var endLabel = Number.isInteger(scenes[i].end_time) ? scenes[i].end_time + 's' : scenes[i].end_time.toFixed(1) + 's';
            pts.push({t:scenes[i].end_time, px:rightPx, label:endLabel});
        }
        var f = [pts[0]];
        for (var pi = 1; pi < pts.length; pi++) {
            if (pts[pi].t - f[f.length-1].t > 0.3) f.push(pts[pi]);
            else f[f.length-1] = pts[pi];
        }
        var oldTicks = ticksRow.querySelectorAll('.sr-tick');
        for (var et = 0; et < oldTicks.length; et++) oldTicks[et].remove();
        for (var fi = 0; fi < f.length; fi++) {
            var span = document.createElement('span');
            span.className = 'sr-tick';
            span.style.left = f[fi].px + 'px';
            span.textContent = f[fi].label;
            ticksRow.appendChild(span);
        }
    };
    App.seedanceV2._srJumpTo = function(idx) {
        this._srStartIdx = idx;
        this._renderSrTimeline();
        this._renderSrShots();
    };
    App.seedanceV2._onSrShowCountChange = function() {
        var v = parseInt(document.getElementById('srShowCount')?.value);
        this._srShowCount = (v && v > 0) ? v : 0;
        if (this._srStartIdx >= this.scenes.length) this._srStartIdx = 0;
        this._renderSrTimeline();
        this._renderSrShots();
    };
    // 向前/后翻页
    App.seedanceV2._srPrevPage = function() {
        var cnt = this._srShowCount || this.scenes.length;
        this._srStartIdx = Math.max(0, this._srStartIdx - cnt);
        this._renderSrTimeline();
        this._renderSrShots();
    };
    App.seedanceV2._srNextPage = function() {
        var cnt = this._srShowCount || this.scenes.length;
        this._srStartIdx = Math.min(this.scenes.length - cnt, this._srStartIdx + cnt);
        if (this._srStartIdx < 0) this._srStartIdx = 0;
        this._renderSrTimeline();
        this._renderSrShots();
    };
    App.seedanceV2._renderSrShots = function() {
        var body = document.getElementById('sceneReviewBody');
        if (!body) return;
        var F = {camera_move:App._t('auto.str_4abc8a41', '运镜'),subject:'主体',scene_desc:App._t('auto.str_c931653c', '场景'),composition:App._t('auto.str_c38d3f3b', '构图'),lighting:'光影',action:'动作',focal_length:'焦段',texture:'质感',speed:'速率',emotion:'情绪',color_grade:'调色',weather:'天气',particles:'粒子',perspective:'视角',depth_of_field:'景深',filter:'滤镜',natural_force:'外力',environment_detail:'环境',film_flaw:'瑕疵',fantasy_physics:'奇幻'};
        var fields = ['camera_move','subject','scene_desc','composition','lighting','action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics'];
        var count = this._srShowCount || this.scenes.length;
        var end = Math.min(this._srStartIdx + count, this.scenes.length);
        var html = '';
        // 导航条
        html += '<div class="sr-nav-row">';
        html += '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._srPrevPage()" '+(this._srStartIdx<=0?'disabled':'')+'>◀ 上一组</button>';
        html += '<span class="sr-nav-info">镜头 '+(this._srStartIdx+1)+'-'+end+' / 共'+this.scenes.length+'镜</span>';
        html += '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._srNextPage()" '+(end>=this.scenes.length?'disabled':'')+'>下一组 ▶</button>';
        html += '</div>';
        for (var si = this._srStartIdx; si < end; si++) {
            var s = this.scenes[si];
            var dotColor = App.seedanceV2._sceneColor(s.id);
            var meta = parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s · '+Math.round((s.end_time-s.start_time)*10)/10+'s';
            html += '<div class="sr-shot-block" style="border-left:3px solid '+dotColor+';">';
            html += '<div class="sr-shot-header"><span class="sr-shot-num">镜头 '+(si+1)+'</span><span class="sr-shot-time">'+App._escape(meta)+'</span><span class="sr-shot-subject">'+(s.subject ? App._escape(s.subject.substring(0,20)) : '')+'</span></div>';
            for (var fi = 0; fi < fields.length; fi++) {
                var f = fields[fi], v = (s[f] || '').trim();
                if (!v) continue;
                html += '<span class="sr-field-name">'+(F[f]||f)+'</span>'+App._escape(v)+'<span class="sr-separator"></span>';
            }
            html += '</div>';
        }
        body.innerHTML = html;
    };
    App.seedanceV2.closeSceneReview = function() { document.getElementById('sceneReviewModal').style.display = 'none'; };
    // ESC 快捷关闭审阅弹窗
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            var m = document.getElementById('sceneReviewModal');
            if (m && m.style.display === 'flex') App.seedanceV2.closeSceneReview();
        }
    });
    App.seedanceV2.copySceneReview = function() {
        var b = document.getElementById('sceneReviewBody');
        if (!b || !b.textContent) { App.showToast(App._t('auto.str_d75c5260', '无可复制'), 'warning'); return; }
        var blocks = b.querySelectorAll('.sr-shot-block');
        var texts = [];
        for (var i = 0; i < blocks.length; i++) {
            texts.push(blocks[i].textContent.replace(/\s+/g, ' ').trim());
        }
        navigator.clipboard.writeText(texts.join('\n\n---\n\n')).then(function() { App.showToast(App._t('common.copied', '已复制 ')+texts.length+App._t('auto.str_8d42c778', ' 个镜头'), 'success'); });
    };

    App.seedanceV2._toggleAudioSection = function() {
        var panel = document.getElementById('s2_audio_section');
        var cb = document.getElementById('s2_audio_enabled');
        if (panel && cb) panel.style.display = cb.checked ? 'block' : 'none';
    };
    App.seedanceV2.compose=function(){
        var p=this.currentProject;
        if(!p||!this.scenes.length){var o=document.getElementById('s2Output');if(o)o.value='';return;}
        // 收集当前全局参数（先从DOM实时读取，确保未保存的修改也生效）
        var fmt=document.getElementById('s2_format')?.value||'seedance';
        var density=document.getElementById('s2_density')?.value||'standard';
        var includeAudio=document.getElementById('s2_audio_enabled')?.checked||false;
        var globalStyle=document.getElementById('s2_global_style')?.value||'';
        var globalTransition=document.getElementById('s2_global_transition')?.value||'';
        var negativePrompt=document.getElementById('s2_negative_prompt')?.value||'';
        var aspectRatio=document.getElementById('s2_aspect_ratio')?.value||'16:9';
        var resolution=document.getElementById('s2_resolution')?.value||'4K';
        var totalDuration=parseInt(document.getElementById('s2_total_duration')?.value)||15;
        // v5.36.11: 音频三要素也随全局参数传递（后端 compose 读取）
        var bgm=document.getElementById('s2_bgm')?.value||'';
        var sfx=document.getElementById('s2_sfx')?.value||'';
        var dialogue=document.getElementById('s2_dialogue')?.value||'';
        var body={
            format:fmt,density:density,include_audio:includeAudio,
            global_style:globalStyle,global_transition:globalTransition,negative_prompt:negativePrompt,
            aspect_ratio:aspectRatio,resolution:resolution,total_duration:totalDuration,
            bgm:bgm,sfx:sfx,dialogue:dialogue,
            // v5.36.26: seedance 模式预览输出与真实提交一致（参考图完整文本）
            include_refs: (fmt==='seedance')
        };
        // 调用后端引擎
        var self=this;
        var o=document.getElementById('s2Output');if(o)o.value='正在合成…';
        App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/compose',{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
        }).then(function(r){
            if(!r||!r.text){if(o)o.value=App._t('auto.str_b34d99a9', '合成未完成');return;}
            self.outputText=r.text;
            self.outputJson=r.json||{};
            if(o)o.value=r.text;
            // 显示元信息
            var meta=document.getElementById('s2OutputMeta');
            if(meta)meta.textContent=(r.shot_count||0)+App._t('auto.str_5a8391a9', '镜头 · ')+(r.pixel_res||'')+' · '+(r.density||'standard')+(r.ref_mode?(' · 🖼 参考图 '+r.ref_count+' 张'):'');
        }).catch(function(e){
            if(o)o.value='合成未完成: '+e.message;
        });
    };
    App.seedanceV2.copyText=function(){var el=document.getElementById('s2Output');if(!el||!el.value){App.showToast(App._t('auto.str_6e1aa7df', '无输出可复制'),'warning');return;}navigator.clipboard.writeText(el.value).then(function(){App.showToast(App._t('common.notice', '提示词已复制'),'success');});};
    App.seedanceV2.copyJSON=function(){var obj=this.outputJson;if(!obj||!Object.keys(obj).length){App.showToast(App._t('auto.str_2df89e22', '无数据可复制'),'warning');return;}navigator.clipboard.writeText(JSON.stringify(obj,null,2)).then(function(){App.showToast(App._t('auto.str_aac758c6', 'JSON已复制'),'success');});};
    App.seedanceV2.copyLibTV=function(){var t=this.outputText||'';if(!t){App.showToast('无输出可复制','warning');return;}window.open('https://libtv.ai/create?prompt='+encodeURIComponent(t),'_blank');};
console.log('[PK] seedance_custom_words loaded');
})();
