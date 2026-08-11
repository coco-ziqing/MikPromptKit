// Seedance V2 多镜头结构化组装器 — 分片 scenes
(function() {
    'use strict';
    App.seedanceV2 = App.seedanceV2 || {};

    App.seedanceV2._initExtUnits=function(scene){return scene._extUnits||[];};

    App.seedanceV2._renderExtUnitHTML=function(scene,idx){var unit=scene._extUnits[idx];var f=unit.field;var n=this._F[f];if(!n){for(var cli2=0;cli2<this.libraries.length;cli2++){if(this.libraries[cli2].dimension_key===f){n=(this.libraries[cli2].dimension_name||'').substring(0,10);break;}}}if(!n)n=f;var v=scene[f]||'';var h='<div class="s2-ext-unit" data-scene-id="'+scene.id+'" data-ext-idx="'+idx+'">';h+='<div class="s2-ext-unit-header"><span class="s2-ext-unit-name">'+n+'</span><select class="s2-ext-unit-dropdown" >';for(var ei=0;ei<this._EF.length;ei++){var sel=this._EF[ei]===f?' selected':'';h+='<option value="'+this._EF[ei]+'"'+sel+'>'+(this._F[this._EF[ei]]||this._EF[ei])+'</option>';};var cust=[];for(var cli=0;cli<this.libraries.length;cli++){if(this.libraries[cli].category==='custom')cust.push(this.libraries[cli]);}if(cust.length){h+='<optgroup label="📁 自定义分组">';for(var ci3=0;ci3<cust.length;ci3++){var cl=cust[ci3];var cdk=cl.dimension_key;var csel=cdk===f?' selected':'';h+='<option value="'+cdk+'"'+csel+'>'+App._escape((cl.dimension_name||'').substring(0,15))+'</option>';}h+='</optgroup>';}h+='</select><button class="s2-ext-unit-remove" title="移除此单元">✖</button></div>';h+='<div class="s2-ext-unit-body"><button class="s2-ext-unit-addword">+ 选词</button>';if(v&&v.trim()){h+='<span class="s2-ext-unit-tag">'+App._escape(v.length>12?v.substring(0,12)+'..':v)+'</span>';}else if(v===' '){h+='<span class="s2-ext-unit-tag" style="color:#94a3b8;">点击选词</span>';}h+='</div></div>';return h;};
    // Bug-2: custom_* 字段也需要设 activeField，且清除旧值重写

    App.seedanceV2.addExtUnit=function(sid){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){var sc=this.scenes[i];if(!sc._extUnits)sc._extUnits=[];var used={};for(var j=0;j<sc._extUnits.length;j++)used[sc._extUnits[j].field]=true;var next=null;for(var k=0;k<this._EF.length;k++){if(!used[this._EF[k]]){next=this._EF[k];break;}}if(!next){App.showToast('所有拓展字段已添加','info');return;}sc._extUnits.push({field:next});sc[next]=null;this.updateSceneField(sid,next,'');this._saveExtUnitConfig(sid);this.renderScenes();this._openRightPicker(sid,next);return;}}};

    App.seedanceV2.removeExtUnit=function(sid,idx){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){var unit=this.scenes[i]._extUnits[idx];if(!unit)return;var f=unit.field;this.scenes[i][f]='';this.updateSceneField(sid,f,'');this.scenes[i]._extUnits.splice(idx,1);this._saveExtUnitConfig(sid);this.renderScenes();return;}}};
    // Bug-2: custom_* 字段切换后也正确更新 activeField + 词库面板

    App.seedanceV2._extUnitChange=function(sid,idx,newField){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){var unit=this.scenes[i]._extUnits[idx];var oldField=unit.field;if(oldField===newField)return;this.scenes[i][oldField]=null;this.updateSceneField(sid,oldField,'');unit.field=newField;this.scenes[i][newField]=null;this.updateSceneField(sid,newField,'');this.renderScenes();this._openRightPicker(sid,newField);return;}}};

App.seedanceV2._doSetDuration=function(sid,v){var self=this;this._pushUndoBefore();if(this._isLastUnlocked(sid)){App.showToast('最后一个未锁定镜头不可手动锁定时长','warning');return;}App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+sid+'/lock',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked:true})}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:v})});}).then(function(){self.openProject(self.currentProjectId);}).catch(function(e){console.warn("_doSetDuration error",e);});};

    App.seedanceV2.showRemainingChoice=function(sid,v,rem,hideDirectLock){
        var o=document.getElementById('s2RemainingModal');if(o)o.remove();
        var overlay=document.createElement('div');overlay.id='s2RemainingModal';overlay.className='modal-overlay';
        overlay.style.cssText='display:flex;z-index:700;background:rgba(0,0,0,0.4);align-items:center;justify-content:center;';
        overlay.onclick=function(e){};  // 2026-08-03: 禁止点击遮罩关闭（易误操作）
        var gap=(rem-v).toFixed(1);
        var h='<div class="modal-content" style="max-width:460px;"><div class="modal-header"><h5><span style="color:#f59e0b">\u26a0\ufe0f</span> 时长不足</h5><button class="header-btn-sm s2-close-modal" data-modal="s2RemainingModal">&times;</button></div><div class="modal-body"><p style="margin-bottom:12px;font-size:13px;color:var(--text-muted);">设置此镜头 <strong>'+v+'</strong> 秒后，剩余 <strong>'+gap+'</strong> 秒时长未分配。</p><div style="display:flex;flex-direction:column;gap:8px;">';

        h+='<button class="s2-choice-btn" data-action="changeTotal" data-scene="'+sid+'" data-val="'+v+'" data-rem="'+rem+'"><span class="s2-choice-icon">\u23f1</span><span class="s2-choice-text"><strong>修改总时长</strong><small>缩减总时长匹配</small></span></button>';
        h+='<button class="s2-choice-btn" data-action="unlockOther" data-scene="'+sid+'" data-val="'+v+'" data-rem="'+rem+'"><span class="s2-choice-icon">🔓</span><span class="s2-choice-text"><strong>解锁其他镜头</strong><small>选择已锁定镜头释放时长</small></span></button>';
        if(!hideDirectLock){h+='<button class="s2-choice-btn s2-choice-cancel" data-action="directLock" data-scene="'+sid+'" data-val="'+v+'"><span class="s2-choice-icon">\u2716</span><span class="s2-choice-text"><strong>直接锁定</strong><small>忽略剩余时长</small></span></button>';}
        h+='</div></div></div>';overlay.innerHTML=h;document.body.appendChild(overlay);
    };

    App.seedanceV2._choiceAddScene=function(sid,v){
        var self=this;var td=self.currentProject?self.currentProject.total_duration:15;var ls=v;
        for(var ci=0;ci<self.scenes.length;ci++){var sc=self.scenes[ci];if(sc.id!==sid&&sc.is_locked)ls+=sc.duration;}
        var remain=Math.max(0.5,Math.round((td-ls)*10)/10);var refOrder=1;
        for(var ci=0;ci<self.scenes.length;ci++){if(self.scenes[ci].id===sid){refOrder=self.scenes[ci].scene_order;break;}}
        App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+sid+'/lock',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked:true})}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:v})});}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_order:self.scenes.length+1,duration:remain,is_locked:true})});}).then(function(){self.openProject(self.currentProjectId);App.showToast('已自动新建镜头填补剩余 '+remain+' 秒','success');});
    };

    App.seedanceV2._choiceChangeTotal=function(sid,v,rem){
        var self=this;
        var ls=0, uc=0;
        for(var ci=0;ci<self.scenes.length;ci++){
            var sc=self.scenes[ci];
            if(sc.id===sid) continue;
            if(sc.is_locked) ls+=sc.duration;
            else uc++;
        }
        var newTotal=Math.round(ls+v+uc*0.5);
        if(newTotal<2) newTotal=2;
        // ① 先改总时长为新值（让后端 max_allowed 校验通过）
        App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId,{
            method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({total_duration:newTotal})
        }).then(function(){
            // ② 同时设置 duration + 锁定（一次 PUT 完成，避免两次 recalculate 互相覆盖）
            return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid,{
                method:'PUT',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({duration:v, is_locked:true})
            });
        }).then(function(){
            self.openProject(self.currentProjectId);
            App.showToast(App._t('auto.str_2f0ea579', '总时长已改为 ')+newTotal+' 秒','success');
        });
    };

    App.seedanceV2._choiceUnlockOther=function(sid,v,rem){var locked=[];for(var ci=0;ci<this.scenes.length;ci++){if(this.scenes[ci].is_locked&&this.scenes[ci].id!==sid)locked.push(this.scenes[ci]);}if(!locked.length){App.showToast('没有其他已锁定镜头可解锁','warning');return;}var o=document.getElementById('s2UnlockModal');if(o)o.remove();var overlay=document.createElement('div');overlay.id='s2UnlockModal';overlay.className='modal-overlay';overlay.style.cssText='display:flex;z-index:701;background:rgba(0,0,0,0.4);align-items:center;justify-content:center;';overlay.onclick=function(e){};var html='<div class="modal-content" style="max-width:400px;"><div class="modal-header"><h5>🔓 选择解锁镜头</h5><button class="header-btn-sm s2-close-modal" data-modal="s2UnlockModal">&times;</button></div><div class="modal-body"><p style="font-size:12px;color:var(--text-muted);">选择一个已锁定镜头解锁</p>';for(var ci=0;ci<locked.length;ci++){var sc=locked[ci];html+='<button class="s2-choice-btn s2-unlock-item" data-scene="'+sid+'" data-val="'+v+'" data-unlock="'+sc.id+'"><span class="s2-choice-text"><strong>镜头 '+sc.scene_order+'</strong><small>当前 '+sc.duration+'s</small></span></button>';}html+='</div></div>';overlay.innerHTML=html;document.body.appendChild(overlay);};

    App.seedanceV2._doUnlockAndSet=function(sid,v,uid){var self=this;this._pushUndoBefore();App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+uid+'/lock',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked:false})}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid+'/lock',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked:true})});}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:v})});}).then(function(){self.openProject(self.currentProjectId);App.showToast('已解锁镜头，剩余时长均分','success');});};

    // 词卡选择

    App.seedanceV2._getSceneOrder=function(sid){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid)return this.scenes[i].scene_order;}return'?';};

    App.seedanceV2._getCurrentScene=function(){if(!this.activeSceneId)return null;for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===this.activeSceneId)return this.scenes[i];}return null;};

    App.seedanceV2._textMatches=function(fieldVal,cardText){var fv=(fieldVal||'').trim().toLowerCase(),ct=(cardText||'').toLowerCase();return fv.length>0&&(fv.indexOf(ct)>=0||ct.indexOf(fv)>=0);};
    App.seedanceV2._sceneFieldKeys=['camera_move','subject','scene_desc','composition','lighting','focal_length','texture','speed','perspective','particles','weather','color_grade','emotion','natural_force','depth_of_field','filter','film_flaw','fantasy_physics','environment_detail','action','character_voice','bgm','sfx'];
    // 词库dimension_key → 镜头表字段名 映射（不一致的需在此声明）
    App.seedanceV2._dimToField={'scene':'scene_desc','env_detail':'environment_detail','audio_char_narr':'character_voice','audio_bgm':'bgm','audio_sfx':'sfx'};App.seedanceV2._fieldToDim={'scene_desc':'scene','environment_detail':'env_detail','character_voice':'audio_char_narr','bgm':'audio_bgm','sfx':'audio_sfx'};

    App.seedanceV2._dimToFieldKey=function(dimKey){return this._dimToField[dimKey]||dimKey;};

    App.seedanceV2.renderPickerLibTabs=function(libId){var c=document.getElementById('s2PickerLibTabs');if(!c)return;var scene=this._getCurrentScene();var basic=[],more=[],custom=[];var self=this;for(var i=0;i<this.libraries.length;i++){var lib=this.libraries[i];lib._sn=lib.dimension_name.replace(App._t('auto.str_dd745fe3', '词库'),'').replace(App._t('auto.str_3bdd08ad', '描述'),'').substring(0,6);var fk=self._dimToFieldKey(lib.dimension_key);lib._filled=scene&&scene[fk]&&scene[fk].trim().length>0;if(lib.category==='basic')basic.push(lib);else if(lib.category==='custom'){lib._sn_custom=lib.dimension_name.substring(0,6);custom.push(lib);}else more.push(lib);}var tabHtml=function(libs,isSm){var h='';for(var j=0;j<libs.length;j++){var lib=libs[j];var a=lib.id===libId?' sp-lib-active':'';var dot=lib._filled?'<span class="sp-lib-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;margin-left:3px;vertical-align:middle;" title="已填充"></span>':'';var cls='sp-lib-tab'+(isSm?' sp-lib-tab-sm':'')+a+(lib._filled?' sp-lib-tab-filled':'');h+='<button class="'+cls+'" onclick="App.seedanceV2.switchPickerLib('+lib.id+')" title="'+App._escape(lib.dimension_name)+(lib._filled?' (已填充)':'')+'">'+App._escape(lib._sn)+dot+'</button>';}return h;};var h='<div class="sp-lib-primary">'+tabHtml(basic,false)+'</div><div class="sp-lib-secondary"><button class="sp-lib-more-btn" onclick="App.seedanceV2.toggleMoreLibs()"><span class="sp-more-icon">'+(this.moreLibsOpen?'\u25BC':'\u25B6')+'</span> '+(this.moreLibsOpen?App._t('auto.str_f483fbe4', '收起扩展词库'):App._t('common.more', '更多词库'))+'</button>';if(this.moreLibsOpen){h+='<div class="sp-lib-more-grid">'+tabHtml(more,true)+'</div>';}h+='</div>';// 自定义分组
        if(custom.length){h+='<div class="sp-lib-custom"><div class="sp-lib-custom-header"><span class="sp-lib-custom-label">\ud83d\udce1 自定义</span><button class="sp-lib-custom-manage" onclick="App.seedanceV2.openGroupManager()" title="管理自定义分组">⚙</button><button class="sp-lib-custom-manage" onclick="App.seedanceV2._openGroupCreator()" title="新建分组" style="margin-left:4px;">+📁</button></div><div class="sp-lib-custom-grid">'+tabHtml(custom,true)+'</div></div>';}c.innerHTML=h;};

    App.seedanceV2.toggleMoreLibs=function(){this.moreLibsOpen=!this.moreLibsOpen;this.renderPickerLibTabs(this.activePickerLibId);};

    App.seedanceV2.switchPickerLib=async function(libId){if(libId===this.activePickerLibId)return;this.activePickerLibId=libId;var lib=this.getLibraryById(libId);if(!lib)return;this.activeField=this._dimToFieldKey(lib.dimension_key);document.getElementById('s2PickerTitle').textContent=App._t('auto.str_59ebdb8c', '✏️ 镜头')+this._getSceneOrder(this.activeSceneId)+' - '+lib.dimension_name;document.getElementById('s2PickerSearch').value='';this.renderPickerLibTabs(libId);await this.loadCards(libId);this.renderCards(libId);};

    App.seedanceV2.loadCards=async function(libId){if(this.cardCache[libId])return;var d=await App.fetchJSON('/api/seedance/v2/libraries/'+libId+'/cards?page_size=200');if(d)this.cardCache[libId]=d.items;};App.seedanceV2.preloadAllCardCaches=async function(){var self=this,libs=this.libraries||[];for(var i=0;i<libs.length;i++){var lid=libs[i].id;if(self.cardCache[lid])continue;try{var d=await App.fetchJSON('/api/seedance/v2/libraries/'+lid+'/cards?page_size=200');if(d&&d.items)self.cardCache[lid]=d.items;}catch(e){}}};

    // ============ 智能模型匹配 ============

    App.seedanceV2.matchModel=async function(){
        var t=this.outputText||'';
        if(!t){App.showToast('请先组装提示词，输出预览非空后即可匹配','warning');return;}
        var p=this.currentProject||{};
        var ar=p.aspect_ratio||'16:9';var res=p.resolution||'4K';var dur=p.total_duration||15;
        App.showToast('AI 正在分析提示词结构...','info');
        try{
            var d=await App.fetchJSON('/api/v4/atoms/match-model',{
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    prompt:t, aspect_ratio:ar, resolution:res, duration:Number(dur),
                    shot_count:this.scenes.length
                }),
                _timeoutMs:60000
            });
            if(!d||!d.ok){App.showToast('匹配未完成: '+(d?d.error:'网络不太稳定，请稍后重试'),'danger');return;}
            // 弹出结果面板
            var old=document.getElementById('s2MatchResult');
            if(old)old.remove();
            var ov=document.createElement('div');ov.id='s2MatchResult';
            ov.className='modal-overlay';
            ov.style.cssText='display:flex;z-index:750;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
            ov.onclick=function(e){};  // 2026-08-03: 禁止点击遮罩关闭（易误操作）
            var items='';
            var recs=d.recommendations||[];
            for(var i=0;i<recs.length;i++){
                var r=recs[i];
                var star=r.rank===1?'⭐':'';
                items+='<tr style="'+(r.rank===1?'background:rgba(139,92,246,0.06);font-weight:700;':'')+'">';
                items+='<td style="padding:6px 8px;font-size:14px;">'+star+(r.rank||(i+1))+'</td>';
                items+='<td style="padding:6px 8px;"><strong>'+App._escape(r.model||'')+'</strong><br><span style="font-size:11px;color:var(--text-muted);">'+App._escape(r.platform||'')+'</span></td>';
                items+='<td style="padding:6px 8px;text-align:center;"><span style="display:inline-block;width:50px;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;"><span style="display:block;height:100%;width:'+(r.score*100||0)+'%;background:#8b5cf6;border-radius:3px;"></span></span><br><span style="font-size:10px;color:var(--text-muted);">'+(r.score*100).toFixed(0)+'%</span></td>';
                items+='<td style="padding:6px 8px;font-size:11px;color:var(--text-muted);">'+App._escape(r.reason||'')+'</td>';
                items+='<td style="padding:6px 8px;font-size:11px;color:var(--text-muted);">'+(r.estimated_time||'N/A')+' / '+(r.estimated_cost||'N/A')+'</td>';
                items+='</tr>';
            }
            ov.innerHTML='<div class="modal-content" style="max-width:800px;max-height:80vh;overflow-y:auto;" onclick="event.stopPropagation()">'+
                '<div class="modal-header"><h5>🧠 智能模型匹配</h5><button class="header-btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">&times;</button></div>'+
                '<div class="modal-body">'+
                '<p style="font-size:12px;color:var(--text-muted);">基于提示词复杂度、画质参数、时长、镜头数综合分析</p>'+
                '<div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;">'+
                '<table style="width:100%;font-size:13px;border-collapse:collapse;">'+
                '<thead><tr style="background:var(--hover-bg);text-align:left;">'+
                '<th style="padding:8px;width:40px;">#</th><th style="padding:8px;">推荐模型</th><th style="padding:8px;width:80px;text-align:center;">评分</th><th style="padding:8px;width:200px;">理由</th><th style="padding:8px;width:120px;">预估</th>'+
                '</tr></thead><tbody>'+items+'</tbody></table></div>'+
                '<p style="margin-top:8px;font-size:11px;color:var(--text-muted);">⚡ '+(d.summary||'')+'</p>'+
                '</div></div>';
            document.body.appendChild(ov);
        }catch(e){App.showToast('匹配未完成: '+e.message,'danger');}
    };

    App.seedanceV2.resetProject=function(){if(!confirm(App._t('common.ok', '确定重置此项目？')))return;var self=this;App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes',{method:'GET'}).then(function(d){if(!d||!d.items)return;var ids=d.items.map(function(s){return s.id;});(async function(){for(var j=0;j<ids.length;j++)await App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+ids[j],{method:'DELETE'});self.openProject(self.currentProjectId);App.showToast(App._t('auto.str_44b0f6c8', '项目已重置'),'info');})();});};

    // ============ Chip hover preview ============
    var _hoverTimer = null;
    var _hoverPreview = null;
    function _makePreviewEl() {
        var el = document.createElement('div');
        el.id = 's2ChipPreview';
        el.style.cssText = 'display:none;position:fixed;z-index:999;min-width:160px;max-width:280px;background:var(--bg-card,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.25);padding:8px;pointer-events:none;';
        document.body.appendChild(el);
        return el;
    }

    App.seedanceV2._showChipPreview = function(sceneId, field, chipEl, e) {
        // Map dimension_key → scene field name
        var sceneField = (App.seedanceV2._dimToField || {})[field] || field;
        if (_hoverTimer) clearTimeout(_hoverTimer);
        _hoverTimer = setTimeout(function() {
            var s = null;
            for (var i = 0; i < App.seedanceV2.scenes.length; i++) {
                if (App.seedanceV2.scenes[i].id === sceneId) { s = App.seedanceV2.scenes[i]; break; }
            }
            if (!s) return;
            var fv = (s[sceneField] || '').trim();
            // Also grab visible text from the tag element itself as fallback
            var tagText = (chipEl && chipEl.textContent) ? chipEl.textContent.trim() : '';
            if (!fv && !tagText) return;
            var searchText = fv || tagText;
            // Normalize: lowercase, trim
            var nv = searchText.toLowerCase().replace(/\s+/g,' ');
            // Find matching word card across ALL loaded caches
            var card = null;
            var libId = App.seedanceV2._fieldToLibId(field) || App.seedanceV2._fieldToLibId(sceneField);
            var allKeys = Object.keys(App.seedanceV2.cardCache || {});
            // Try all caches (field-matched lib first)
            var keys = [];
            if (libId) keys.push(String(libId));
            for (var ki = 0; ki < allKeys.length; ki++) { if (String(allKeys[ki]) !== String(libId)) keys.push(String(allKeys[ki])); }
            for (var ki = 0; ki < keys.length && !card; ki++) {
                var cards = App.seedanceV2.cardCache[keys[ki]] || [];
                for (var ci = 0; ci < cards.length; ci++) {
                    var wt = (cards[ci].word_text||'').toLowerCase().replace(/\s+/g,' ');
                    var df = (cards[ci].definition||'').toLowerCase().replace(/\s+/g,' ');
                    if (wt === nv || df === nv || wt.indexOf(nv) >= 0 || nv.indexOf(wt) >= 0 || df.indexOf(nv) >= 0 || nv.indexOf(df) >= 0) {
                        card = cards[ci]; break;
                    }
                }
            }
            if (!_hoverPreview) _hoverPreview = _makePreviewEl();
            var html = '';
            if (card && card.preview_video) {
                html += '<video src="/api/seedance/v2/videos/'+card.preview_video+'" style="width:100%;height:auto;border-radius:6px;" autoplay muted loop></video>';
            } else if (card && (card.wc_thumbnail || card.preview_image)) {
                // 2026-08-11: 词库缩略图优先（与词库预览图一致）；旧 preview 走 seedance 接口
                var _purl = card.wc_thumbnail
                    ? '/api/thumbnails/file/' + card.wc_thumbnail
                    : '/api/seedance/v2/thumbnails/' + card.preview_image;
                var _fb = card.wc_thumbnail
                    ? ('/api/seedance/v2/thumbnails/' + (card.preview_image || ''))
                    : '';
                html += '<img src="' + _purl + '" style="width:100%;height:auto;border-radius:6px;"' + (_fb ? ' onerror="if(this.src.indexOf(\'/api/thumbnails/file/\')===0){this.src=\'' + _fb + '\';}"' : '') + '>';
            } else {
                html += '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px;">'+(card?App._t('auto.str_c54d754f', '无媒体预览'):App._t('auto.str_b31f0889', '无匹配词卡'))+'</div>';
            }
            html += '<div style="font-size:11px;margin-top:6px;color:var(--text-main);line-height:1.4;max-width:260px;word-break:break-word;"><strong>'+App._escape(card?card.word_text:searchText)+'</strong></div>';
            if (card && card.definition && card.definition !== card.word_text) {
                html += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">'+App._escape(card.definition.substring(0,80))+'</div>';
            }
            _hoverPreview.innerHTML = html;
            var rect = chipEl.getBoundingClientRect();
            _hoverPreview.style.left = Math.min(rect.left, window.innerWidth-290)+'px';
            _hoverPreview.style.top = (rect.bottom+4)+'px';
            _hoverPreview.style.display = 'block';
        }, 400);
    };

    App.seedanceV2._hideChipPreview = function() {
        if (_hoverTimer) clearTimeout(_hoverTimer);
        if (_hoverPreview) _hoverPreview.style.display = 'none';
    };

    App.seedanceV2._fieldToLibId = function(field) {
        // Map dimension_key ↔ scene field name both ways
        var dimToField = App.seedanceV2._dimToField || {};
        var fieldToDim = App.seedanceV2._fieldToDim || {};
        // Try: field as sceneField → dimKey, and field as dimKey → dimKey
        var dimKey = fieldToDim[field] || dimToField[field] || field;
        // Also try the reverse: if field is actually the dim_key, return directly
        var libs = App.seedanceV2.libraries || [];
        // Exact match on dimension_key
        for (var i = 0; i < libs.length; i++) {
            if (libs[i].dimension_key === dimKey) return libs[i].id;
        }
        // If field is the dimKey itself, try direct match
        for (var j = 0; j < libs.length; j++) {
            if (libs[j].dimension_key === field) return libs[j].id;
        }
        // For custom libraries, match by category
        for (var k = 0; k < libs.length; k++) {
            if (libs[k].category === 'custom' && libs[k].dimension_key === field) return libs[k].id;
        }
        return null;
    };

    // ============ 角色头像悬停预览 ============
    var _charHoverTimer = null;
    var _charHoverPreview = null;

    function _makeCharPreviewEl() {
        var el = document.createElement('div');
        el.id = 's2CharPreview';
        el.style.cssText = 'display:none;position:fixed;z-index:1000;width:180px;background:var(--bg-card,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.25);padding:10px;pointer-events:none;';
        document.body.appendChild(el);
        return el;
    }


    App.seedanceV2._showCharPreview = function(charId, btnEl) {
        if (!charId) return;
        if (_charHoverTimer) clearTimeout(_charHoverTimer);
        var self = this;
        _charHoverTimer = setTimeout(function() {
            // 从 characterLib._cache 中查找角色
            var ch = null;
            var cache = (App.characterLib && App.characterLib._cache) || [];
            for (var i = 0; i < cache.length; i++) {
                if (cache[i].id == charId) { ch = cache[i]; break; }
            }
            if (!ch) return;

            if (!_charHoverPreview) _charHoverPreview = _makeCharPreviewEl();
            var html = '';
            // 头像或预览图
            var imgUrl = ch.avatar ? ('/api/characters/images/' + ch.avatar) : (ch.preview_image ? ('/api/characters/images/' + ch.preview_image) : '');
            if (imgUrl) {
                html += '<img src="' + imgUrl + '" style="width:100%;height:auto;max-height:160px;border-radius:8px;object-fit:cover;margin-bottom:6px;" onerror="this.style.display=\'none\'">';
            } else {
                html += '<div style="width:100%;height:80px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px;font-weight:700;margin-bottom:6px;">' + App._escape((ch.name || '?').charAt(0)) + '</div>';
            }
            // 信息行
            html += '<div style="font-size:13px;font-weight:700;color:var(--text-main);">' + App._escape(ch.name || '??') + '</div>';
            var meta = [];
            if (ch.gender) meta.push(ch.gender);
            if (ch.age_range) meta.push(ch.age_range);
            if (ch.occupation) meta.push(ch.occupation);
            if (meta.length) html += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + meta.join(' ?? ') + '</div>';
            if (ch.personality) html += '<div style="font-size:10px;color:var(--text-muted);margin-top:3px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">' + App._escape(ch.personality.substring(0,60)) + '</div>';

            var rect = btnEl.getBoundingClientRect();
            _charHoverPreview.innerHTML = html;
            // 定位在按钮右侧或下方
            var left = Math.min(rect.right + 6, window.innerWidth - 190);
            var top = Math.min(rect.top, window.innerHeight - 260);
            _charHoverPreview.style.left = left + 'px';
            _charHoverPreview.style.top = top + 'px';
            _charHoverPreview.style.display = 'block';
        }, 500);
    };

    // 缺失的 openCardPicker 路由到 _openRightPicker

    App.seedanceV2.openCardPicker = function(sid, field) {
        this._openRightPicker(sid, field);
    };


    App.seedanceV2._hideCharPreview = function() {
        if (_charHoverTimer) clearTimeout(_charHoverTimer);
        if (_charHoverPreview) _charHoverPreview.style.display = 'none';
    };
})();
