// ================================================================
// Seedance V2 多镜头结构化组装器
// ================================================================

(function() {
    'use strict';

    App.seedanceV2 = {
        _F:{'camera_move':'运镜','subject':'主体','scene_desc':'场景','composition':'构图','lighting':'光影','action':'动作','focal_length':'焦段','texture':'质感','speed':'速率','emotion':'情绪','color_grade':'调色','weather':'天气','particles':'粒子','perspective':'视角','depth_of_field':'景深','filter':'滤镜','natural_force':'外力','environment_detail':'环境','film_flaw':'瑕疵','fantasy_physics':'奇幻'},
        _EF:['action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics'],
        projects: [], currentProjectId: null, currentProject: null,
        scenes: [], libraries: [], cardCache: {},
        activeField: null, activeSceneId: null, activePickerLibId: null,
        moreLibsOpen: false, dirty: false, outputText: '', outputJson: null
    };

    App.seedanceV2.init = async function() {
        await this.loadLibraries(); await this.loadProjects(); this.renderProjectList();
        // 恢复上次编辑的项目
        try{var savedPid=localStorage.getItem('promptkit_seedance_project');if(savedPid){var found=false;for(var i=0;i<this.projects.length;i++){if(this.projects[i].id==parseInt(savedPid)){found=true;break;}}if(found)this.openProject(parseInt(savedPid));}}catch(e){}
        // 恢复侧栏状态
        setTimeout(function() { App.seedanceV2._restoreSidebar(); }, 200);
        if (!document.getElementById('s2GlobalDelPop')) {
            var d = document.createElement('div'); d.id = 's2GlobalDelPop'; d.className = 's2-global-del-popover';
            d.style.cssText = 'display:none;position:fixed;z-index:999;';
            d.innerHTML = '<span class="s2-del-popover-text">\u786e\u5b9a\u5220\u9664\u6b64\u955c\u5934\uff1f</span><button class="s2-del-popover-yes" onclick="App.seedanceV2.deleteScene(parseInt(this.parentElement.dataset.sceneId))">\u786e\u8ba4</button><button class="s2-del-popover-no" onclick="this.parentElement.style.display=\x27none\x27">\u53d6\u6d88</button>';
            document.body.appendChild(d);
        }
        if (!document.getElementById('s2ProjectDelPop')) {
            var d2 = document.createElement('div'); d2.id = 's2ProjectDelPop'; d2.className = 's2-global-del-popover';
            d2.style.cssText = 'display:none;position:fixed;z-index:999;';
            d2.innerHTML = '<span class="s2-del-popover-text">\u786e\u5b9a\u5220\u9664\u6b64\u9879\u76ee\uff1f</span><button class="s2-del-proj-confirm">\u786e\u8ba4</button><button class="s2-proj-del-cancel">\u53d6\u6d88</button>';
            document.body.appendChild(d2);
        }
        var self = this;
        // ESC 键关闭词库弹窗
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.getElementById('s2CardPicker').style.display !== 'none') {
                self.closePicker();
            }
        });
        setTimeout(function() {
            document.addEventListener('click', function(e) {
                var btn = e.target.closest('.s2-unlock-item');
                if (btn) { self._doUnlockAndSet(parseInt(btn.dataset.scene), parseFloat(btn.dataset.val), parseInt(btn.dataset.unlock)); }
            });
            document.addEventListener('click', function(e) {
                var b = e.target.closest('.s2-close-modal'); if(b) { var m = document.getElementById(b.dataset.modal); if(m)m.style.display='none'; }
                var pb = e.target.closest('.s2-del-proj-confirm'); if(pb) { var pop = document.getElementById('s2ProjectDelPop'); if(pop){pop.style.display='none';App.seedanceV2.deleteProject(parseInt(pop.dataset.projectId));} }
                var cb = e.target.closest('.s2-proj-del-cancel'); if(cb) { var pop = document.getElementById('s2ProjectDelPop'); if(pop)pop.style.display='none'; }
                // 选择弹窗按钮分发
                var btn = e.target.closest('.s2-choice-btn');
                if (btn) {
                    var action = btn.dataset.action;
                    var sid = parseInt(btn.dataset.scene);
                    var val = parseFloat(btn.dataset.val);
                    var rem = parseFloat(btn.dataset.rem || 0);
                    if (action === 'addScene') { self._choiceAddScene(sid, val); }
                    else if (action === 'changeTotal') { self._choiceChangeTotal(sid, val, rem); }
                    else if (action === 'unlockOther') { self._choiceUnlockOther(sid, val, rem); }
                    else if (action === 'directLock') { self._doSetDuration(sid, val); }
                }
            });
        }, 100);
    };

    // 词库
    App.seedanceV2.loadLibraries = async function() { var d = await App.fetchJSON('/api/seedance/v2/libraries'); if(d) this.libraries = d.libraries; };
    App.seedanceV2.getLibraryByKey = function(k) { for(var i=0;i<this.libraries.length;i++){if(this.libraries[i].dimension_key===k)return this.libraries[i];} return null; };
    App.seedanceV2.getLibraryById = function(id) { for(var i=0;i<this.libraries.length;i++){if(this.libraries[i].id===id)return this.libraries[i];} return null; };

    // 项目管理
    App.seedanceV2.loadProjects = async function() { var d=await App.fetchJSON('/api/seedance/v2/projects?page_size=100'); if(d) this.projects = d.items; };
    App.seedanceV2.createProject = async function() { var n=prompt('项目名称:','新项目 '+(this.projects.length+1)); if(!n)return; var d=await App.fetchJSON('/api/seedance/v2/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})}); if(d&&d.ok){await this.loadProjects();this.renderProjectList();this.openProject(d.id);App.showToast('项目已创建','success');} };
    App.seedanceV2.deleteProject = async function(id){var d=await App.fetchJSON('/api/seedance/v2/projects/'+id,{method:'DELETE'});if(d&&d.ok){if(this.currentProjectId===id){this.currentProjectId=null;this.currentProject=null;this.scenes=[];this.renderComposerEmpty();}await this.loadProjects();this.renderProjectList();App.showToast('项目已删除','info');}};
    App.seedanceV2.openProject = async function(id) { this.currentProjectId=id; try{localStorage.setItem('promptkit_seedance_project',id);localStorage.setItem('promptkit_view','seedance');localStorage.setItem('promptkit_seedance_tab','composer');}catch(e){} var d=await App.fetchJSON('/api/seedance/v2/projects/'+id); if(!d) return; this.currentProject=d.project; this.scenes=d.scenes; var editor=document.getElementById('s2Editor'); var savedScroll=editor?editor.scrollTop:0; this.renderProjectList(); this.renderProjectEditor(); this.renderScenes(); this.compose(); var self=this; requestAnimationFrame(function(){var e=document.getElementById('s2Editor');if(e&&savedScroll>0)e.scrollTop=savedScroll;}); };
    App.seedanceV2.saveProject = async function(){if(!this.currentProjectId)return;var d={};['name','total_duration','aspect_ratio','resolution','global_style','global_transition','negative_prompt'].forEach(function(f){var e=document.getElementById('s2_'+f);if(e)d[f]=e.value;});await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});App.showToast('项目已保存','success');};

    App.seedanceV2.showProjectDelPopover = function(btnEl,pid){var pv=document.getElementById('s2ProjectDelPop');if(!pv)return;var r=btnEl.getBoundingClientRect();pv.dataset.projectId=pid;pv.style.position='fixed';pv.style.left=Math.max(4,r.left-140)+'px';pv.style.top=(r.bottom+4)+'px';pv.style.display='flex';};
    App.seedanceV2.quickDeleteProject = function(id){this.deleteProject(id);};
    App.seedanceV2.toggleBatchDelete = function(){var c=document.querySelectorAll('.s2-project-check:checked');var b=document.getElementById('s2BatchDelHeader');if(b)b.style.display=c.length>0?'inline-flex':'none';};
    App.seedanceV2.batchDeleteProjects = function(){var c=document.querySelectorAll('.s2-project-check:checked');if(!c.length||!confirm('确定删除选中的 '+c.length+' 个项目？'))return;var ids=[];for(var i=0;i<c.length;i++)ids.push(parseInt(c[i].dataset.pid));var self=this;(async function(){for(var j=0;j<ids.length;j++)await App.fetchJSON('/api/seedance/v2/projects/'+ids[j],{method:'DELETE'});await self.loadProjects();self.renderProjectList();if(self.currentProjectId&&ids.indexOf(self.currentProjectId)>=0){self.currentProjectId=null;self.currentProject=null;self.scenes=[];self.renderComposerEmpty();}App.showToast('已删除 '+ids.length+' 个项目','info');})();};

    App.seedanceV2.toggleSidebar = function() {
        var sb = document.querySelector('.s2-sidebar'); 
        var tg = document.querySelector('.s2-sidebar-toggle');
        if (!sb || !tg) return;
        var collapsed = sb.classList.toggle('collapsed');
        tg.textContent = collapsed ? '▶' : '◀';
        tg.title = collapsed ? '展开项目列表' : '折叠项目列表';
        try { localStorage.setItem('promptkit_s2_sidebar', collapsed?'1':'0'); } catch(e) {}
    };
    App.seedanceV2._restoreSidebar = function() {
        try { if (localStorage.getItem('promptkit_s2_sidebar')==='1') { var sb=document.querySelector('.s2-sidebar'); var tg=document.querySelector('.s2-sidebar-toggle'); if(sb){sb.classList.add('collapsed');} if(tg){tg.textContent='▶';tg.title='展开项目列表';} } } catch(e) {}
    };
    App.seedanceV2._scrollToScene = function(sceneId) {
        var card = document.querySelector('.s2-scene-card[data-scene-id="'+sceneId+'"]');
        if (card) { card.scrollIntoView({behavior:'smooth',block:'center'}); card.style.boxShadow='0 0 0 3px var(--primary)'; setTimeout(function(){card.style.boxShadow='';},1200); }
        // 高亮时间轴段
        document.querySelectorAll('.s2-timeline-seg').forEach(function(s){s.classList.remove('active');});
        var seg = document.querySelector('.s2-timeline-seg[data-scene-id="'+sceneId+'"]');
        if (seg) seg.classList.add('active');
    };
    App.seedanceV2._toggleOutput = function() {
        var sec = document.querySelector('.s2-output-section');
        if (sec) sec.classList.toggle('collapsed');
    };
    App.seedanceV2._toggleGlobalParams = function() {
        var sec = document.getElementById('s2GlobalParamsSection');
        if (sec) sec.classList.toggle('collapsed');
    };
    App.seedanceV2._toggleShotList = function() {
        var sec = document.getElementById('s2ShotListSection');
        if (sec) sec.classList.toggle('collapsed');
    };
    App.seedanceV2._openRightPicker = function(sid, field) {
        // 右侧面板选词代替 modal
        App.seedanceV2.activeSceneId = sid;
        App.seedanceV2.activeField = field;
        var panel = document.getElementById('s2RightPanel');
        var layout = document.querySelector('.s2-layout');
        if (!panel || !layout) return;
        
        // 找到对应的 lib
        var dimKey = App.seedanceV2._fieldToDim && App.seedanceV2._fieldToDim[field] ? App.seedanceV2._fieldToDim[field] : field;
        var foundLib = null;
        for (var li = 0; li < App.seedanceV2.libraries.length; li++) {
            var lib = App.seedanceV2.libraries[li];
            if (lib.dimension_key === dimKey) { foundLib = lib; break; }
        }
        if (!foundLib) { App.showToast('未找到对应词库: '+field, 'warning'); return; }
        
        layout.classList.add('editor-with-panel');
        panel.classList.add('open');
        panel.innerHTML = '<div class="d-flex justify-content-between align-items-center mb-2"><strong>✏️ 选词 - '+App.seedanceV2._F[field]+'</strong><button class="btn btn-sm btn-outline" onclick="App.seedanceV2._closeRightPicker()">&times;</button></div><div class="loading-spinner"><div class="spinner-border spinner-border-sm"></div></div>';
        App.seedanceV2.activePickerLibId = foundLib.id;
        App.seedanceV2._renderRightPickerContent(foundLib);
    };
    App.seedanceV2._closeRightPicker = function() {
        var panel = document.getElementById('s2RightPanel');
        var layout = document.querySelector('.s2-layout');
        if (panel) panel.classList.remove('open');
        if (layout) layout.classList.remove('editor-with-panel');
        App.seedanceV2.activePickerLibId = null;
    };
    App.seedanceV2._renderRightPickerContent = async function(lib) {
        var panel = document.getElementById('s2RightPanel');
        if (!panel) return;
        var activeLibId = lib.id;
        await App.seedanceV2.loadCards(activeLibId);
        var cards = App.seedanceV2.cardCache[activeLibId] || [];
        var scene = App.seedanceV2._getCurrentScene();
        var fieldVal = scene ? (scene[App.seedanceV2.activeField] || '') : '';
        var self = App.seedanceV2;

        // 顶部：关闭按钮
        var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><strong>✏️ 选词 - '+App._escape(self._F[self.activeField]||lib.dimension_name)+'</strong><button class="btn btn-sm btn-outline" onclick="App.seedanceV2._closeRightPicker()">✕</button></div>';
        
        // 词库切换 tabs（仅显示 basic 和 extended，排除 global/custom）
        var basicLibs = [], extLibs = [];
        for (var li = 0; li < self.libraries.length; li++) {
            var l = self.libraries[li];
            if (l.category === 'basic') basicLibs.push(l);
            else if (l.category === 'extended') extLibs.push(l);
        }
        h += '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border-color);">';
        for (var bi = 0; bi < basicLibs.length; bi++) {
            var bl = basicLibs[bi];
            var fk = self._dimToFieldKey(bl.dimension_key);
            var sn = (bl.dimension_name || '').replace('词库','').replace('描述','').substring(0,6);
            var ac = bl.id === activeLibId ? ' sp-lib-active' : '';
            var fil = (scene && scene[fk] && scene[fk].trim()) ? ' sp-lib-tab-filled' : '';
            h += '<button class="sp-lib-tab'+ac+fil+'" onclick="App.seedanceV2._switchRightLib('+bl.id+','+self.activeSceneId+',\''+fk+'\')" style="font-size:11px;padding:2px 8px;" title="'+App._escape(bl.dimension_name)+'">'+App._escape(sn)+'</button>';
        }
        h += '<button class="sp-lib-tab" onclick="App.seedanceV2._toggleRightExtLibs()" style="font-size:11px;padding:2px 8px;" title="更多词库"><span id="s2RightExtArrow">▶</span> 更多</button></div>';
        
        // 扩展词库（折叠）
        if (self._rightExtOpen) {
            h += '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border-color);">';
            for (var ei = 0; ei < extLibs.length; ei++) {
                var elib = extLibs[ei];
                var efk = self._dimToFieldKey(elib.dimension_key);
                var esn = (elib.dimension_name || '').replace('词库','').replace('描述','').substring(0,6);
                var eac = elib.id === activeLibId ? ' sp-lib-active' : '';
                var efil = (scene && scene[efk] && scene[efk].trim()) ? ' sp-lib-tab-filled' : '';
                h += '<button class="sp-lib-tab sp-lib-tab-sm'+eac+efil+'" onclick="App.seedanceV2._switchRightLib('+elib.id+','+self.activeSceneId+',\''+efk+'\')" style="font-size:10px;padding:2px 6px;" title="'+App._escape(elib.dimension_name)+'">'+App._escape(esn)+'</button>';
            }
            h += '</div>';
        }
        
        // 搜索 + 卡片列表
        h += '<input class="s2-input mb-2" placeholder="搜索..." oninput="App.seedanceV2._filterRightCards(this.value)">';
        h += '<div class="s2-right-card-list" style="max-height:calc(100vh - 320px);overflow-y:auto;">';
        if (!cards.length) {
            h += '<div class="s2-empty" style="padding:20px;">暂无词条</div>';
        } else {
            for (var ci = 0; ci < cards.length; ci++) {
                var card = cards[ci];
                var word = card.word_text || card.content || '';
                var def = card.definition || card.meaning || '';
                var isSelected = fieldVal && word && fieldVal.indexOf(word) >= 0;
                h += '<div class="s2-right-card-item'+(isSelected?' selected':'')+'" data-word="'+App._escape(word)+'" onclick="App.seedanceV2._pickRightWord(this)" style="padding:8px 10px;border:1px solid var(--border-color);border-radius:6px;margin-bottom:4px;cursor:pointer;transition:0.12s;'+(isSelected?'background:rgba(16,185,129,0.08);border-color:#10b981;':'')+'">';
                h += '<div style="font-size:13px;font-weight:600;">'+App._escape(word)+'</div>';
                if (def) h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">'+App._escape(def.substring(0,80))+'</div>';
                h += '</div>';
            }
        }
        h += '</div>';
        panel.innerHTML = h;
    };

    App.seedanceV2._rightExtOpen = false;
    App.seedanceV2._toggleRightExtLibs = function() {
        this._rightExtOpen = !this._rightExtOpen;
        var lib = this.getLibraryById(this.activePickerLibId);
        if (lib) this._renderRightPickerContent(lib);
    };

    App.seedanceV2._switchRightLib = async function(libId, sid, fieldKey) {
        App.seedanceV2.activePickerLibId = libId;
        App.seedanceV2.activeSceneId = sid;
        App.seedanceV2.activeField = fieldKey;
        var lib = App.seedanceV2.getLibraryById(libId);
        if (!lib) return;
        await App.seedanceV2.loadCards(libId);
        App.seedanceV2._renderRightPickerContent(lib);
    };
    App.seedanceV2._filterRightCards = function(query) {
        var items = document.querySelectorAll('.s2-right-card-item');
        var q = (query || '').toLowerCase();
        for (var i = 0; i < items.length; i++) {
            var word = (items[i].dataset.word || '').toLowerCase();
            items[i].style.display = (!q || word.indexOf(q) >= 0) ? '' : 'none';
        }
    };
    App.seedanceV2._pickRightWord = function(el) {
        var word = el.dataset.word;
        if (!word || !App.seedanceV2.activeSceneId || !App.seedanceV2.activeField) return;
        var scene = App.seedanceV2._getCurrentScene();
        if (!scene) return;
        var currentVal = scene[App.seedanceV2.activeField] || '';
        // 点击切换：已选则移除，未选则添加
        if (currentVal.indexOf(word) >= 0) {
            currentVal = currentVal.replace(word, '').replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();
        } else {
            currentVal = currentVal ? currentVal + ', ' + word : word;
        }
        // 立即更新本地 scene 对象，消除异步滞后
        scene[App.seedanceV2.activeField] = currentVal;
        App.seedanceV2.updateSceneField(App.seedanceV2.activeSceneId, App.seedanceV2.activeField, currentVal);
        App.seedanceV2._refreshRightSelection();
        App.seedanceV2.compose();
    };
    App.seedanceV2._refreshRightSelection = function() {
        var scene = App.seedanceV2._getCurrentScene();
        var fieldVal = scene ? (scene[App.seedanceV2.activeField] || '') : '';
        document.querySelectorAll('.s2-right-card-item').forEach(function(el) {
            var word = el.dataset.word || '';
            var isSel = fieldVal && word && fieldVal.indexOf(word) >= 0;
            el.classList.toggle('selected', isSel);
            el.style.background = isSel ? 'rgba(16,185,129,0.08)' : '';
            el.style.borderColor = isSel ? '#10b981' : 'var(--border-color)';
        });
        // 刷新卡片字段显示
        App.seedanceV2.renderScenes();
    };
    App.seedanceV2.renderProjectList = function() {
        var c=document.getElementById('s2ProjectList');if(!c)return;
        var h='<div class="s2-project-header"><h5>📋 我的项目</h5><div class="s2-header-actions"><button class="btn btn-sm btn-danger s2-batch-del-btn" id="s2BatchDelHeader" onclick="App.seedanceV2.batchDeleteProjects()" style="display:none;">🗑 批量删除</button><button class="btn btn-sm btn-primary" onclick="App.seedanceV2.createProject()">+ 新建</button></div></div>';
        if(!this.projects.length){h+='<div class="s2-empty">暂无项目，点击新建开始</div>';} else{for(var i=0;i<this.projects.length;i++){var p=this.projects[i],a=p.id===this.currentProjectId?' s2-project-active':'';h+='<div class="s2-project-item'+a+'" data-pid="'+p.id+'"><label class="s2-project-check-wrap" onclick="event.stopPropagation()"><input type="checkbox" class="s2-project-check" data-pid="'+p.id+'" onchange="App.seedanceV2.toggleBatchDelete()"></label><div class="s2-project-info" onclick="App.seedanceV2.openProject('+p.id+')"><div class="s2-project-name">'+App._escape(p.name||'未命名')+'</div><div class="s2-project-meta">'+p.scene_count+'镜头 \u00b7 '+(p.total_duration||15)+'s</div></div><button class="s2-project-del" onclick="event.stopPropagation();App.seedanceV2.showProjectDelPopover(this,'+p.id+')">\u2716</button></div>';}}
        c.innerHTML=h;
    };

    // 编辑器
    App.seedanceV2.renderComposerEmpty = function(){var c=document.getElementById('s2Editor');if(c)c.innerHTML='<div class="s2-empty-state"><div class="s2-empty-icon">🎬</div><h4>选择或创建项目开始编辑</h4></div>';};
    App.seedanceV2.setDirty = function(){this.dirty=true;};
    App.seedanceV2.onTotalDurationChange = function(){var el=document.getElementById('s2_total_duration');if(!el)return;var val=parseInt(el.value);if(isNaN(val)||val<4||val>15)return;var self=this;App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({total_duration:val})}).then(function(){self.openProject(self.currentProjectId);self.compose();});};
    App.seedanceV2.renderProjectEditor = function() {
        var c=document.getElementById('s2Editor');if(!c)return;var p=this.currentProject;if(!p){this.renderComposerEmpty();return;}
        function ms(id,l,opts,v){var h='<div class="s2-field"><label>'+l+'</label><select id="'+id+'" class="s2-input" onchange="App.seedanceV2.compose()">';for(var i=0;i<opts.length;i++){var s=opts[i][0]===v?' selected':'';h+='<option value="'+opts[i][0]+'"'+s+'>'+opts[i][1]+'</option>';}h+='</select></div>';return h;}
        var h='<div class="s2-editor-header"><div class="s2-editor-title"><input id="s2_name" class="s2-input s2-title-input" value="'+App._escape(p.name)+'" onchange="App.seedanceV2.setDirty();App.seedanceV2.compose()"></div><div class="s2-editor-actions"><button class="btn btn-sm btn-success" onclick="App.seedanceV2.saveProject()">💾 保存</button><button class="btn btn-sm btn-danger" onclick="App.seedanceV2.deleteProject('+p.id+')">🗑 删除</button></div></div>';
        // ① 分镜列表（可折叠）
        h+='<div class="s2-section s2-shotlist-section" id="s2ShotListSection"><div class="s2-section-title" onclick="App.seedanceV2._toggleShotList()" title="点击折叠/展开" style="cursor:pointer;">🎬 分镜列表 <span class="s2-badge">'+this.scenes.length+' 镜头</span> <span style="font-size:10px;font-weight:400;color:var(--text-muted);">(点击折叠)</span></div><div class="s2-shotlist-body"><div class="s2-timeline-wrapper"><div class="s2-timeline-ticks">';var tickSpan=Math.max(1,Math.floor((p.total_duration||15)/6));for(var tk=0;tk<=p.total_duration;tk+=tickSpan){h+='<span>'+tk+'s</span>';}h+='</div><div class="s2-timeline-bar" id="s2TimelineBar">';for(var i=0;i<this.scenes.length;i++){var s=this.scenes[i];var w=Math.max(3,((s.end_time-s.start_time)/(p.total_duration||15))*100);var lb=(s.subject||'镜头'+(i+1)).substring(0,6);var segColor=App.seedanceV2._sceneColor(s.id);h+='<div class="s2-timeline-seg" draggable="true" data-scene-id="'+s.id+'" style="width:'+w+'%;background:'+segColor+';" title="'+s.start_time+'-'+s.end_time+'s: '+App._escape(lb)+' (拖拽排序)" onclick="App.seedanceV2._scrollToScene('+s.id+')"><span>'+lb+'</span></div>';}h+='</div></div><div class="s2-scenes-container" id="s2ScenesContainer"></div></div></div>';
        // ② 全局参数（分镜设完再调全局）
        h+='<div class="s2-section s2-global-params-section" id="s2GlobalParamsSection"><div class="s2-section-title" onclick="App.seedanceV2._toggleGlobalParams()" title="点击折叠/展开" style="cursor:pointer;">📐 全局参数 <span style="font-size:10px;font-weight:400;color:var(--text-muted);">(点击折叠)</span></div><div class="s2-global-body"><div class="s2-global-row">';
        h+=ms('s2_aspect_ratio','画幅',[['16:9','横屏16:9'],['9:16','竖屏9:16'],['1:1','方形1:1'],['21:9','超宽21:9'],['4:3','方屏4:3'],['3:4','竖屏3:4']],p.aspect_ratio||'16:9');
        h+=ms('s2_resolution','分辨率',[['480p','480p'],['720p','720p'],['1080p','1080p'],['2K','2K']],p.resolution||'1080p');
        h+='<div class="s2-field"><label>总时长(秒)</label><select id="s2_total_duration" class="s2-input" onchange="App.seedanceV2.onTotalDurationChange()">';for(var td=4;td<=15;td++){h+='<option value="'+td+'"'+(td===(p.total_duration||15)?' selected':'')+'>'+td+'秒</option>';}h+='</select></div></div>';
        h+='<div class="s2-global-row"><div class="s2-field" style="flex:2;"><label>全局画风 <span class="s2-style-picker-btn" onclick="App.seedanceV2.openStylePicker()" title="从画风词库选择">📚 选风格</span></label><input id="s2_global_style" class="s2-input" placeholder="..." value="'+App._escape(p.global_style||'')+'" onchange="App.seedanceV2.setDirty();App.seedanceV2.compose()"></div><div class="s2-field" style="flex:1;"><label>全局转场</label><input id="s2_global_transition" class="s2-input" placeholder="..." value="'+App._escape(p.global_transition||'')+'" onchange="App.seedanceV2.setDirty();App.seedanceV2.compose()"></div></div>';
        h+='<div class="s2-field"><label>负面提示词 <span class="s2-np-picker-btn" onclick="App.seedanceV2.openNegativePicker()" title="从负面词库选择">📖 选负面</span></label><input id="s2_negative_prompt" class="s2-input" placeholder="..." value="'+App._escape(p.negative_prompt||'')+'" onchange="App.seedanceV2.setDirty();App.seedanceV2.compose()"></div>';
        var rm=(p.remaining_duration!==undefined)?p.remaining_duration:p.remaining;
        h+='<div style="font-size:12px;color:var(--text-muted);margin-top:4px;"><span>已分配: <strong>'+(p.total_dur_input||0)+'</strong>s / <strong>'+p.total_duration+'</strong>s</span><span style="margin-left:12px;'+(rm<=0?'color:#ef4444;':'')+'">剩余: <strong>'+Math.max(0,rm)+'</strong>s</span></div></div></div>';
        // ③ 输出预览
        h+='<div class="s2-output-section"><div class="s2-section-title" onclick="App.seedanceV2._toggleOutput()" title="点击折叠/展开">📤 输出预览 <span style="font-size:10px;font-weight:400;color:var(--text-muted);">(点击折叠)</span></div><div class="s2-output-actions"><button class="btn btn-sm btn-success" onclick="App.seedanceV2.copyText()">📋 复制提示词</button><button class="btn btn-sm btn-info" onclick="App.seedanceV2.copyJSON()">📋 复制JSON</button><button class="btn btn-sm btn-warning" onclick="App.seedanceV2.copyLibTV()">🚀 填入LibTV</button><button class="btn btn-sm btn-secondary" onclick="App.seedanceV2.resetProject()">↺ 重置</button></div><textarea id="s2Output" class="s2-output-text" readonly></textarea></div>';
        c.innerHTML=h;
        // 创建右侧面板
        var layout = document.querySelector('.s2-layout');
        if (layout && !document.getElementById('s2RightPanel')) {
            var rp = document.createElement('div'); rp.id = 's2RightPanel'; rp.className = 's2-right-panel';
            layout.appendChild(rp);
        }
        // 创建折叠按钮
        if (layout && !document.querySelector('.s2-sidebar-toggle')) {
            var tgl = document.createElement('div'); tgl.className = 's2-sidebar-toggle'; tgl.textContent = '◀'; tgl.title = '折叠项目列表'; tgl.onclick = function() { App.seedanceV2.toggleSidebar(); };
            layout.appendChild(tgl);
        }
        this.renderScenes();
        // 恢复侧栏状态
        setTimeout(function() { App.seedanceV2._restoreSidebar(); }, 50);
    };

    // 镜头颜色（基于ID稳定不变）
    App.seedanceV2._sceneColor=function(id){var TC=['#6366f1','#8b5cf6','#d946ef','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#14b8a6','#06b6d4'];return TC[(id||0)%10];};

    // 镜头拷贝粘贴剪贴板
    App.seedanceV2._sceneClipboard = null;
    App.seedanceV2._copyScene = function(sid) {
        for (var i = 0; i < this.scenes.length; i++) {
            if (this.scenes[i].id === sid) {
                var src = this.scenes[i];
                var fields = ['camera_move','subject','scene_desc','composition','lighting',
                    'action','focal_length','texture','speed','emotion','color_grade',
                    'weather','particles','perspective','depth_of_field','filter',
                    'natural_force','environment_detail','film_flaw','fantasy_physics'];
                var clip = {};
                for (var fi = 0; fi < fields.length; fi++) {
                    if (src[fields[fi]]) clip[fields[fi]] = src[fields[fi]];
                }
                this._sceneClipboard = clip;
                App.showToast('✅ 已复制镜头'+(i+1)+'的提示词内容', 'success');
                return;
            }
        }
    };
    App.seedanceV2._pasteScene = function(tgtSid) {
        if (!this._sceneClipboard || !Object.keys(this._sceneClipboard).length) {
            App.showToast('📋 剪贴板为空，请先复制一个镜头', 'warning'); return;
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
                App.showToast('✅ 已粘贴到镜头'+(tgtIdx+1), 'success');
            });
        };
        if (hasContent) {
            if (confirm('⚠️ 镜头'+(tgtIdx+1)+'已有提示词内容，粘贴将覆盖现有内容。继续？')) {
                doPaste();
            }
        } else {
            doPaste();
        }
    };
    App.seedanceV2.renderScenes=function(){
        var c=document.getElementById('s2ScenesContainer');if(!c)return;
        var h='';for(var i=0;i<this.scenes.length;i++)h+=this.renderSceneCard(this.scenes[i],i);
        h+='<div class="s2-add-scene" onclick="App.seedanceV2.addScene()">+ 添加镜头</div>';
        c.innerHTML=h;var self=this;
        this.compose();
        setTimeout(function(){
            document.querySelectorAll('.s2-field-chip').forEach(function(el){el.addEventListener('click',function(e){var sid=parseInt(this.dataset.sceneId),f=this.dataset.field;if(!f)return;self.openCardPicker(sid,f);});});
            document.querySelectorAll('.s2-scene-input').forEach(function(el){el.addEventListener('change',function(){var sid=parseInt(this.dataset.sceneId),f=this.dataset.field,v=this.value;self.updateSceneField(sid,f,v);self.compose();});});
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
            document.addEventListener('click',function(e){if(!e.target.closest('.s2-del-btn')&&!e.target.closest('.s2-global-del-popover')){var p=document.getElementById('s2GlobalDelPop');if(p)p.style.display='none';}});
            var ct=document.getElementById('s2ScenesContainer');if(ct&&!ct.dataset.dragBound){ct.dataset.dragBound='1';var dt=null;ct.addEventListener('dragover',function(e){e.preventDefault();var card=e.target.closest('.s2-scene-card');if(card){document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over');});card.classList.add('s2-drag-over');dt=card;}});ct.addEventListener('drop',function(e){e.preventDefault();document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over','s2-dragging');});var src=parseInt(e.dataTransfer.getData('text/plain'));if(!dt)return;var tgt=parseInt(dt.dataset.sceneId);if(src===tgt)return;self.reorderScenes(src,tgt);dt=null;});ct.addEventListener('dragleave',function(e){setTimeout(function(){document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over');});},100);});}
            // 时间轴段拖拽排序
            var tb=document.getElementById('s2TimelineBar');if(tb&&!tb.dataset.dragBound){tb.dataset.dragBound='1';var tSeg=null;document.querySelectorAll('.s2-timeline-seg').forEach(function(seg){seg.addEventListener('dragstart',function(e){e.dataTransfer.setData('text/plain',this.dataset.sceneId);this.style.opacity='0.4';seg.source=this;});seg.addEventListener('dragend',function(e){this.style.opacity='1';document.querySelectorAll('.s2-timeline-seg').forEach(function(s){s.classList.remove('s2-seg-over');});});});tb.addEventListener('dragover',function(e){e.preventDefault();var seg=e.target.closest('.s2-timeline-seg');if(seg){document.querySelectorAll('.s2-timeline-seg').forEach(function(s){s.classList.remove('s2-seg-over');});seg.classList.add('s2-seg-over');tSeg=seg;}});tb.addEventListener('drop',function(e){e.preventDefault();document.querySelectorAll('.s2-timeline-seg').forEach(function(s){s.classList.remove('s2-seg-over');s.style.opacity='1';});var srcId=parseInt(e.dataTransfer.getData('text/plain'));if(!tSeg||!srcId)return;var tgtId=parseInt(tSeg.dataset.sceneId);if(srcId===tgtId)return;self.reorderScenes(srcId,tgtId);tSeg=null;});tb.addEventListener('dragleave',function(e){setTimeout(function(){if(!tb.contains(document.querySelector(':hover'))){document.querySelectorAll('.s2-timeline-seg').forEach(function(s){s.classList.remove('s2-seg-over');});tSeg=null;}},100);});}            // 拓展unit事件绑定
            document.querySelectorAll('.s2-ext-unit-addword').forEach(function(el){el.addEventListener('click',function(e){var p=this.closest('.s2-ext-unit');var sid=parseInt(p.dataset.sceneId);var f=p.querySelector('.s2-ext-unit-dropdown').value;if(!f)return;self.openCardPicker(sid,f);});});
            document.querySelectorAll('.s2-ext-unit-dropdown').forEach(function(el){el.addEventListener('change',function(){var p=this.closest('.s2-ext-unit');var sid=parseInt(p.dataset.sceneId);var idx=parseInt(p.dataset.extIdx);self._extUnitChange(sid,idx,this.value);});});
            document.querySelectorAll('.s2-ext-unit-remove').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();var p=this.closest('.s2-ext-unit');var sid=parseInt(p.dataset.sceneId);var idx=parseInt(p.dataset.extIdx);self.removeExtUnit(sid,idx);});});
            document.querySelectorAll('.s2-ext-unit-add-btn').forEach(function(el){el.addEventListener('click',function(){var p=this.closest('.s2-ext-unit-list');var sid=parseInt(p.dataset.sceneId);if(!sid)return;self.addExtUnit(sid);});});

        },100);
    };

    App.seedanceV2.renderSceneCard = function(scene,idx){
        var s=scene; var F={'camera_move':'运镜','subject':'主体','scene_desc':'场景','composition':'构图','lighting':'光影','action':'动作','focal_length':'焦段','texture':'质感','speed':'速率','emotion':'情绪','color_grade':'调色','weather':'天气','particles':'粒子','perspective':'视角','depth_of_field':'景深','filter':'滤镜','natural_force':'外力','environment_detail':'环境','film_flaw':'瑕疵','fantasy_physics':'奇幻'};
        var h='<div class="s2-scene-card" data-scene-id="'+s.id+'" data-scene-order="'+(idx+1)+'">';
        var dotColor=App.seedanceV2._sceneColor(s.id);
        h+='<div class="s2-drag-handle" draggable="true" title="拖拽排序" style="border-top:4px solid '+dotColor+';padding-top:2px;"><span class="s2-drag-icon">\u2e3f</span></div>';
        h+='<div class="s2-scene-header"><div class="s2-scene-title"><span class="s2-scene-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+dotColor+';margin-right:6px;vertical-align:middle;flex-shrink:0;" title="镜头'+(idx+1)+'"></span><strong>镜头 '+(idx+1)+'</strong> <span class="s2-time-badge">'+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span></div><div class="s2-scene-actions">';
        h+='<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.insertScene('+s.id+',&apos;before&apos;)">\u2b06插入</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.insertScene('+s.id+',&apos;after&apos;)">\u2b07插入</button>';
        h+='<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.duplicateScene('+s.id+')">📋复制</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._copyScene('+s.id+')" title="拷贝提示词">📝拷贝</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._pasteScene('+s.id+')" title="粘贴提示词">📄粘贴</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._exportScene('+s.id+')" title="导出镜头">📤导出</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._importScene('+s.id+')" title="导入镜头">📥导入</button><button class="btn btn-xs btn-danger s2-del-btn" data-scene-id="'+s.id+'" title="删除此镜头">🗑</button></div></div>';
        h+='<div class="s2-scene-time"><span class="s2-time-label">\u23f1 '+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span>';
        h+='<input class="s2-scene-dur s2-time-input'+(s.is_locked?' s2-dur-manual':'')+'" type="number" min="0.5" max="15" step="0.5" onblur="if(parseFloat(this.value)<0.5)this.value=0.5;if(parseFloat(this.value)>15)this.value=15;" value="'+(s.duration||3)+'" data-scene-id="'+s.id+'" title="'+(s.is_locked?'🔒 已锁定':'🔓 未锁定')+'">';
        h+='<select class="s2-dur-preset" data-target-scene="'+s.id+'" onchange="App.seedanceV2.applyDurPreset(this)"><option value="">\u25bc</option>';
        var P=[0.5,1,1.5,2,2.5,3,4,5,6,7,8,9,10,12,15];for(var pi=0;pi<P.length;pi++){var sel=Math.abs(P[pi]-(s.duration||3))<0.01?' selected':'';h+='<option value="'+P[pi]+'"'+sel+'>'+P[pi]+'</option>';}
        h+='</select><span class="s2-dur-label">秒</span><button class="s2-lock-btn'+(s.is_locked?' s2-locked':'')+'" data-scene-id="'+s.id+'" title="'+(s.is_locked?'点击解锁时长':'点击锁定时长')+'"><span class="s2-lock-icon"></span></button></div>';
        h+='<div class="s2-scene-fields"><div class="s2-field-group"><span class="s2-field-label">基础</span>';
        ['camera_move','subject','scene_desc','composition','lighting'].forEach(function(f){var v=s[f]||'',n=F[f]||f;h+='<span class="s2-field-chip '+(v?'s2-filled':'s2-empty')+'" data-scene-id="'+s.id+'" data-field="'+f+'"><span class="s2-chip-label">'+n+'</span><span class="s2-chip-val">'+(v.length>10?v.substring(0,10)+'..':(v||'+'))+'</span></span>';});
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
        h+='</div></div></div>';return h;
    };

    // 镜头操作
    
    
    
    App.seedanceV2.openGroupManagerFromPicker=function(){var m=document.getElementById('s2GroupManager');if(m){m.style.display='flex';this._refreshCustomLibs();}};
    App.seedanceV2.openGroupManager=function(){var m=document.getElementById('s2GroupManager');if(m){m.style.display='flex';this._refreshCustomLibs();}};
    App.seedanceV2._refreshCustomLibs=async function(){var d=await App.fetchJSON('/api/seedance/v2/libraries?category=custom');if(d){this._customLibs=d.libraries;}var c=document.getElementById('s2GroupList');if(!c)return;if(!this._customLibs||!this._customLibs.length){c.innerHTML='<div class="s2-empty" style="padding:12px;font-size:12px;">暂无自定义分组</div>';}else{var h='';for(var i=0;i<this._customLibs.length;i++){var lib=this._customLibs[i];h+='<div class="s2-group-item"><span class="s2-group-item-name">'+App._escape(lib.dimension_name)+'</span><span class="s2-group-item-count">'+lib.card_count+' 词</span><button class="btn btn-xs btn-danger" onclick="App.seedanceV2.deleteCustomLib('+lib.id+')">\u2716</button></div>';}c.innerHTML=h;}};
    App.seedanceV2.deleteCustomLib=async function(libId){if(!confirm('确定删除此自定义分组及其所有词条？'))return;var d=await App.fetchJSON('/api/seedance/v2/libraries/'+libId,{method:'DELETE'});if(d&&d.ok){this._refreshCustomLibs();this.loadLibraries();App.showToast('分组已删除','info');}};
    App.seedanceV2.createCustomLib=async function(){var inp=document.getElementById('s2NewGroupName');var name=(inp.value||'').trim();if(!name){App.showToast('请输入分组名称','warning');return;}var d=await App.fetchJSON('/api/seedance/v2/libraries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})});if(d&&d.ok){inp.value='';this._refreshCustomLibs();this.loadLibraries();App.showToast('分组已创建','success');}else{App.showToast('创建失败，可能名称重复','error');}};
    App.seedanceV2.onCustomLibAddWord=async function(libId){var inp=document.getElementById('s2CustomWordInput_'+libId);var wordText=(inp.value||'').trim();if(!wordText){App.showToast('请输入词条内容','warning');return;}var defInp=document.getElementById('s2CustomWordDef_'+libId);var def=defInp?(defInp.value||'').trim():'';var d=await App.fetchJSON('/api/seedance/v2/libraries/'+libId+'/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word_text:wordText,definition:def})});if(d&&d.ok){inp.value='';if(defInp)defInp.value='';// 清除缓存强制刷新
        if(this.cardCache[libId])delete this.cardCache[libId];App.showToast('已添加: '+wordText,'success');if(this.activePickerLibId==libId){this.renderCards(libId);}}else{App.showToast('添加失败','error');}};
    App.seedanceV2.addScene=async function(){if(!this.currentProjectId)return;var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_order:this.scenes.length+1})});if(d&&d.ok)await this.openProject(this.currentProjectId);else console.warn("deleteScene failed");};
    App.seedanceV2._isLastUnlocked=function(sid){var uc=0;for(var ci=0;ci<this.scenes.length;ci++){var sc=this.scenes[ci];if(sc.id!==sid&&!sc.is_locked)uc++;}return uc===0;};
    App.seedanceV2.deleteScene=async function(sid){var p=document.getElementById('s2GlobalDelPop');if(p)p.style.display='none';var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+sid,{method:'DELETE'});if(d&&d.ok)await this.openProject(this.currentProjectId);else console.warn("deleteScene failed");};

    // 单镜头导出
    App.seedanceV2._exportScene = function(sid) {
        var scene = null, idx = -1;
        for (var i = 0; i < this.scenes.length; i++) {
            if (this.scenes[i].id === sid) { scene = this.scenes[i]; idx = i; break; }
        }
        if (!scene) { App.showToast('镜头未找到', 'error'); return; }
        var fields = ['camera_move','subject','scene_desc','composition','lighting','action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics'];
        var data = { version: '1.0', type: 'promptkit_scene', exported_at: new Date().toISOString(), scene_name: '镜头'+(idx+1), duration: scene.duration, fields: {} };
        for (var fi = 0; fi < fields.length; fi++) {
            if (scene[fields[fi]]) data.fields[fields[fi]] = scene[fields[fi]];
        }
        var blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
        var url = URL.createObjectURL(blob);
        var fn = (scene.subject||'镜头'+(idx+1)).replace(/[\\/:*?"<>|]/g,'_').substring(0,30).trim()||'scene';
        var a = document.createElement('a'); a.href = url; a.download = fn;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        App.showToast('✅ 镜头'+(idx+1)+'已导出', 'success');
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
                        App.showToast('⚠️ 文件格式不正确，请选择 PromptKit 导出的镜头文件', 'warning'); return;
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
                        var updates = {};
                        for (var fi = 0; fi < fks.length; fi++) {
                            updates[fks[fi]] = data.fields[fks[fi]];
                            tgt[fks[fi]] = data.fields[fks[fi]];
                        }
                        App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid, {
                            method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(updates)
                        }).then(function() {
                            self.renderScenes(); self.compose();
                            App.showToast('✅ 已导入到镜头'+(tgtIdx+1)+' (来自: '+App._escape(data.scene_name||'文件')+')', 'success');
                        });
                    };
                    if (hasContent) {
                        if (confirm('⚠️ 镜头'+(tgtIdx+1)+'已有提示词内容，导入将覆盖现有内容。继续？')) { doImport(); }
                    } else { doImport(); }
                } catch (err) {
                    App.showToast('⚠️ 文件解析失败: '+err.message, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };
    App.seedanceV2.duplicateScene=async function(sid){var src=null;for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){src=this.scenes[i];break;}}if(!src)return;var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_order:this.scenes.length+1,duration:src.duration||3,camera_move:src.camera_move,subject:src.subject,scene_desc:src.scene_desc,composition:src.composition,lighting:src.lighting,action:src.action,focal_length:src.focal_length,texture:src.texture,speed:src.speed,emotion:src.emotion,color_grade:src.color_grade,weather:src.weather,particles:src.particles,perspective:src.perspective,depth_of_field:src.depth_of_field,filter:src.filter,natural_force:src.natural_force,environment_detail:src.environment_detail,film_flaw:src.film_flaw,fantasy_physics:src.fantasy_physics})});if(d&&d.ok)await this.openProject(this.currentProjectId);else console.warn("deleteScene failed");};
    App.seedanceV2.insertScene=async function(sid,pos){if(!this.currentProjectId)return;var ref=null;for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){ref=this.scenes[i];break;}}if(!ref)return;var o=(pos==='before')?ref.scene_order:ref.scene_order+1;var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_order:o})});if(d&&d.ok){await this.openProject(this.currentProjectId);App.showToast('已插入新镜头','success');}};
    App.seedanceV2.reorderScenes=async function(src,tgt){if(!this.currentProjectId)return;var ids=[];for(var i=0;i<this.scenes.length;i++)ids.push(this.scenes[i].id);var si=ids.indexOf(src),ti=ids.indexOf(tgt);if(si<0||ti<0)return;ids.splice(si,1);var newTi=ids.indexOf(tgt);if(si<ti)ids.splice(newTi+1,0,src);else ids.splice(newTi,0,src);var d=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_ids:ids})});if(d&&d.ok){await this.openProject(this.currentProjectId);App.showToast('镜头已重新排序','success');}};
    App.seedanceV2.updateSceneField=async function(sid,f,v){var d={};d[f]=v;await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+sid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});};

    // 时长设定
    App.seedanceV2.applyDurPreset=function(el){var v=parseFloat(el.value);if(isNaN(v))return;var inp=document.querySelector('.s2-scene-dur[data-scene-id="'+el.dataset.targetScene+'"]');if(inp){inp.value=v;inp.dispatchEvent(new Event('change',{bubbles:true}));}el.value='';};
    
    // ============================================================
    // 拓展功能单元(Ext-Unit)系统
    // ============================================================
    App.seedanceV2._initExtUnits=function(scene){var units=[];for(var i=0;i<this._EF.length;i++){var v=scene[this._EF[i]];if(v!==undefined&&v!==null&&v!=='')units.push({field:this._EF[i]});}return units;};
    App.seedanceV2._renderExtUnitHTML=function(scene,idx){var unit=scene._extUnits[idx];var f=unit.field;var n=this._F[f]||f;var v=scene[f]||'';var h='<div class="s2-ext-unit" data-scene-id="'+scene.id+'" data-ext-idx="'+idx+'">';h+='<div class="s2-ext-unit-header"><span class="s2-ext-unit-name">'+n+'</span><select class="s2-ext-unit-dropdown" >';for(var ei=0;ei<this._EF.length;ei++){var sel=this._EF[ei]===f?' selected':'';h+='<option value="'+this._EF[ei]+'"'+sel+'>'+(this._F[this._EF[ei]]||this._EF[ei])+'</option>';}h+='</select><button class="s2-ext-unit-remove" title="移除此单元">✖</button></div>';h+='<div class="s2-ext-unit-body"><button class="s2-ext-unit-addword">+ 选词</button>';if(v&&v.trim()){h+='<span class="s2-ext-unit-tag">'+App._escape(v.length>12?v.substring(0,12)+'..':v)+'</span>';}else if(v===' '){h+='<span class="s2-ext-unit-tag" style="color:#94a3b8;">点击选词</span>';}h+='</div></div>';return h;};
    App.seedanceV2.addExtUnit=function(sid){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){var sc=this.scenes[i];if(!sc._extUnits)sc._extUnits=[];var used={};for(var j=0;j<sc._extUnits.length;j++)used[sc._extUnits[j].field]=true;var next=null;for(var k=0;k<this._EF.length;k++){if(!used[this._EF[k]]){next=this._EF[k];break;}}if(!next){App.showToast('所有拓展字段已添加','info');return;}sc._extUnits.push({field:next});sc[next]=' ';this.updateSceneField(sid,next,' ');this.renderScenes();return;}}};
    App.seedanceV2.removeExtUnit=function(sid,idx){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){var unit=this.scenes[i]._extUnits[idx];if(!unit)return;var f=unit.field;this.scenes[i][f]='';this.updateSceneField(sid,f,'');this.scenes[i]._extUnits.splice(idx,1);this.renderScenes();return;}}};
    App.seedanceV2._extUnitChange=function(sid,idx,newField){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){var unit=this.scenes[i]._extUnits[idx];var oldField=unit.field;if(oldField===newField)return;this.scenes[i][oldField]='';this.updateSceneField(sid,oldField,'');unit.field=newField;this.scenes[i][newField]=' ';this.updateSceneField(sid,newField,' ');this.renderScenes();return;}}};
App.seedanceV2._doSetDuration=function(sid,v){var self=this;if(this._isLastUnlocked(sid)){App.showToast('最后一个未锁定镜头不可手动锁定时长','warning');return;}App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+sid+'/lock',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked:true})}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:v})});}).then(function(){self.openProject(self.currentProjectId);}).catch(function(e){console.warn("_doSetDuration error",e);});};
    App.seedanceV2.showRemainingChoice=function(sid,v,rem,hideDirectLock){
        var o=document.getElementById('s2RemainingModal');if(o)o.remove();
        var overlay=document.createElement('div');overlay.id='s2RemainingModal';overlay.className='modal-overlay';
        overlay.style.cssText='display:flex;z-index:700;background:rgba(0,0,0,0.4);align-items:center;justify-content:center;';
        overlay.onclick=function(e){if(e.target===this)this.style.display='none';};
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
    App.seedanceV2._choiceChangeTotal=function(sid,v,rem){var self=this;App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({total_duration:rem})}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid+'/lock',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked:true})});}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:v})});}).then(function(){self.openProject(self.currentProjectId);App.showToast('总时长已改为 '+rem+' 秒','success');});};
    App.seedanceV2._choiceUnlockOther=function(sid,v,rem){var locked=[];for(var ci=0;ci<this.scenes.length;ci++){if(this.scenes[ci].is_locked&&this.scenes[ci].id!==sid)locked.push(this.scenes[ci]);}if(!locked.length){App.showToast('没有其他已锁定镜头可解锁','warning');return;}var o=document.getElementById('s2UnlockModal');if(o)o.remove();var overlay=document.createElement('div');overlay.id='s2UnlockModal';overlay.className='modal-overlay';overlay.style.cssText='display:flex;z-index:701;background:rgba(0,0,0,0.4);align-items:center;justify-content:center;';overlay.onclick=function(e){if(e.target===this)this.style.display='none';};var html='<div class="modal-content" style="max-width:400px;"><div class="modal-header"><h5>🔓 选择解锁镜头</h5><button class="header-btn-sm s2-close-modal" data-modal="s2UnlockModal">&times;</button></div><div class="modal-body"><p style="font-size:12px;color:var(--text-muted);">选择一个已锁定镜头解锁</p>';for(var ci=0;ci<locked.length;ci++){var sc=locked[ci];html+='<button class="s2-choice-btn s2-unlock-item" data-scene="'+sid+'" data-val="'+v+'" data-unlock="'+sc.id+'"><span class="s2-choice-text"><strong>镜头 '+sc.scene_order+'</strong><small>当前 '+sc.duration+'s</small></span></button>';}html+='</div></div>';overlay.innerHTML=html;document.body.appendChild(overlay);};
    App.seedanceV2._doUnlockAndSet=function(sid,v,uid){var self=this;App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes/'+uid+'/lock',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked:false})}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid+'/lock',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked:true})});}).then(function(){return App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+sid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:v})});}).then(function(){self.openProject(self.currentProjectId);App.showToast('已解锁镜头，剩余时长均分','success');});};

    // 词卡选择
    App.seedanceV2._getSceneOrder=function(sid){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid)return this.scenes[i].scene_order;}return'?';};
    App.seedanceV2._getCurrentScene=function(){if(!this.activeSceneId)return null;for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===this.activeSceneId)return this.scenes[i];}return null;};
    App.seedanceV2._textMatches=function(fieldVal,cardText){var fv=(fieldVal||'').toLowerCase(),ct=(cardText||'').toLowerCase();return fv.length>0&&(fv.indexOf(ct)>=0||ct.indexOf(fv)>=0);};
    App.seedanceV2._sceneFieldKeys=['camera_move','subject','scene_desc','composition','lighting','focal_length','texture','speed','perspective','particles','weather','color_grade','emotion','natural_force','depth_of_field','filter','film_flaw','fantasy_physics','environment_detail','action'];
    // 词库dimension_key → 镜头表字段名 映射（不一致的需在此声明）
    App.seedanceV2._dimToField={'scene':'scene_desc','env_detail':'environment_detail'};App.seedanceV2._fieldToDim={'scene_desc':'scene','environment_detail':'env_detail'};
    App.seedanceV2._dimToFieldKey=function(dimKey){return this._dimToField[dimKey]||dimKey;};
    App.seedanceV2.renderPickerLibTabs=function(libId){var c=document.getElementById('s2PickerLibTabs');if(!c)return;var scene=this._getCurrentScene();var basic=[],more=[],custom=[];var self=this;for(var i=0;i<this.libraries.length;i++){var lib=this.libraries[i];lib._sn=lib.dimension_name.replace('词库','').replace('描述','').substring(0,6);var fk=self._dimToFieldKey(lib.dimension_key);lib._filled=scene&&scene[fk]&&scene[fk].trim().length>0;if(lib.category==='basic')basic.push(lib);else if(lib.category==='custom'){lib._sn_custom=lib.dimension_name.substring(0,6);custom.push(lib);}else more.push(lib);}var tabHtml=function(libs,isSm){var h='';for(var j=0;j<libs.length;j++){var lib=libs[j];var a=lib.id===libId?' sp-lib-active':'';var dot=lib._filled?'<span class="sp-lib-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;margin-left:3px;vertical-align:middle;" title="已填充"></span>':'';var cls='sp-lib-tab'+(isSm?' sp-lib-tab-sm':'')+a+(lib._filled?' sp-lib-tab-filled':'');h+='<button class="'+cls+'" onclick="App.seedanceV2.switchPickerLib('+lib.id+')" title="'+App._escape(lib.dimension_name)+(lib._filled?' (已填充)':'')+'">'+App._escape(lib._sn)+dot+'</button>';}return h;};var h='<div class="sp-lib-primary">'+tabHtml(basic,false)+'</div><div class="sp-lib-secondary"><button class="sp-lib-more-btn" onclick="App.seedanceV2.toggleMoreLibs()"><span class="sp-more-icon">'+(this.moreLibsOpen?'\u25BC':'\u25B6')+'</span> '+(this.moreLibsOpen?'收起扩展词库':'更多词库')+'</button>';if(this.moreLibsOpen){h+='<div class="sp-lib-more-grid">'+tabHtml(more,true)+'</div>';}h+='</div>';// 自定义分组
        if(custom.length){h+='<div class="sp-lib-custom"><div class="sp-lib-custom-header"><span class="sp-lib-custom-label">\ud83d\udce1 自定义</span><button class="sp-lib-custom-manage" onclick="App.seedanceV2.openGroupManagerFromPicker()" title="管理自定义分组">⚙</button></div><div class="sp-lib-custom-grid">'+tabHtml(custom,true)+'</div></div>';}c.innerHTML=h;};
    App.seedanceV2.toggleMoreLibs=function(){this.moreLibsOpen=!this.moreLibsOpen;this.renderPickerLibTabs(this.activePickerLibId);};
    App.seedanceV2.switchPickerLib=async function(libId){if(libId===this.activePickerLibId)return;this.activePickerLibId=libId;var lib=this.getLibraryById(libId);if(!lib)return;this.activeField=this._dimToFieldKey(lib.dimension_key);document.getElementById('s2PickerTitle').textContent='✏️ 镜头'+this._getSceneOrder(this.activeSceneId)+' - '+lib.dimension_name;document.getElementById('s2PickerSearch').value='';this.renderPickerLibTabs(libId);await this.loadCards(libId);this.renderCards(libId);};
    App.seedanceV2.loadCards=async function(libId){if(this.cardCache[libId])return;var d=await App.fetchJSON('/api/seedance/v2/libraries/'+libId+'/cards?page_size=200');if(d)this.cardCache[libId]=d.items;};

    // ============ 画风词库选取器 ============
    App.seedanceV2._stylesData = null;
    App.seedanceV2.openStylePicker = async function() {
        if (!this._stylesData) {
            var d = await App.fetchJSON('/api/seedance/styles');
            if (d && d.categories) this._stylesData = d.categories;
        }
        var categories = this._stylesData || [];
        var overlay = document.createElement('div');
        overlay.id = 's2StylePicker';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:800;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === this) this.remove(); };
        var h = '<div class="modal-content" style="max-width:700px;max-height:80vh;overflow-y:auto;">';
        h += '<div class="modal-header"><h5>📚 画风词库</h5><button class="header-btn-sm" onclick="this.closest(\'#s2StylePicker\').remove()">&times;</button></div>';
        h += '<div class="modal-body">';
        for (var ci = 0; ci < categories.length; ci++) {
            var cat = categories[ci];
            h += '<div class="s2-style-category" style="margin-bottom:16px;">';
            h += '<div class="s2-style-cat-title" style="font-weight:600;font-size:14px;margin-bottom:8px;">' + cat.icon + ' ' + cat.name + '</div>';
            h += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
            for (var si = 0; si < cat.styles.length; si++) {
                var st = cat.styles[si];
                h += '<span class="s2-style-chip" data-prompt="' + App._escape(st.prompt) + '" onclick="App.seedanceV2._selectStyle(\'' + App._escape(st.prompt) + '\',\'' + App._escape(st.name) + '\')" style="cursor:pointer;padding:4px 10px;border-radius:12px;border:1px solid var(--border-color,#d1d5db);font-size:12px;background:var(--bg-card,#fff);">' + st.name + '</span>';
            }
            h += '</div></div>';
        }
        h += '</div></div>';
        overlay.innerHTML = h;
        document.body.appendChild(overlay);
    };

    App.seedanceV2._selectStyle = function(prompt, name) {
        var inp = document.getElementById('s2_global_style');
        if (inp) {
            inp.value = prompt;
            App.seedanceV2.setDirty();
            App.seedanceV2.compose();
        }
        var picker = document.getElementById('s2StylePicker');
        if (picker) picker.remove();
        App.showToast('已选择画风: ' + name, 'success');
    };

    // ============ 负面提示词选取器 ============
    App.seedanceV2._negativeData = null;
    App.seedanceV2.openNegativePicker = async function() {
        if (!this._negativeData) {
            var d = await App.fetchJSON('/api/seedance/negative-prompts');
            if (d && d.categories) this._negativeData = d.categories;
        }
        var categories = this._negativeData || [];
        var overlay = document.createElement('div');
        overlay.id = 's2NegativePicker';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:800;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === this) this.remove(); };
        var h = '<div class="modal-content" style="max-width:700px;max-height:80vh;overflow-y:auto;">';
        h += '<div class="modal-header"><h5>🚫 负面提示词词库</h5><button class="header-btn-sm" onclick="this.closest(\'#s2NegativePicker\').remove()">&times;</button></div>';
        h += '<div class="modal-body">';
        h += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">点击条目将完整提示词追加到负面提示词输入框中</p>';
        for (var ci = 0; ci < categories.length; ci++) {
            var cat = categories[ci];
            h += '<div class="s2-style-category" style="margin-bottom:16px;">';
            h += '<div class="s2-style-cat-title" style="font-weight:600;font-size:14px;margin-bottom:8px;">' + cat.icon + ' ' + cat.name + '</div>';
            h += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
            for (var si = 0; si < cat.items.length; si++) {
                var it = cat.items[si];
                h += '<span class="s2-style-chip" onclick="App.seedanceV2._selectNegative(\'' + App._escape(it.prompt) + '\',\'' + App._escape(it.name) + '\')" style="cursor:pointer;padding:4px 10px;border-radius:12px;border:1px solid var(--border-color,#d1d5db);font-size:12px;background:var(--bg-card,#fff);">' + it.name + '</span>';
            }
            h += '</div></div>';
        }
        h += '</div></div>';
        overlay.innerHTML = h;
        document.body.appendChild(overlay);
    };

    App.seedanceV2._selectNegative = function(prompt, name) {
        var inp = document.getElementById('s2_negative_prompt');
        if (inp) {
            if (inp.value.trim()) {
                inp.value = inp.value.trim() + ', ' + prompt;
            } else {
                inp.value = prompt;
            }
            App.seedanceV2.setDirty();
            App.seedanceV2.compose();
        }
        var picker = document.getElementById('s2NegativePicker');
        if (picker) picker.remove();
        App.showToast('已添加负面词: ' + name, 'success');
    };
    App.seedanceV2.closePicker=async function(){var p=document.getElementById('s2CardPicker');if(p)p.style.display='none';if(this.currentProjectId){await this.openProject(this.currentProjectId);this.compose();}};
    App.seedanceV2.openCardPicker=async function(sid,f){this.activeSceneId=sid;this.activeField=f;var lib=this.getLibraryByKey(f)||this.getLibraryByKey(this._fieldToDim[f]);if(!lib){App.showToast('未找到词库: '+f,'error');return;}// 优先使用右侧面板
        var panel = document.getElementById('s2RightPanel');
        if (panel) { this._openRightPicker(sid, f); return; }
        // 兜底：Modal 方式
        var o=document.getElementById('s2CardPicker');if(!o)return;o.style.display='block';document.getElementById('s2PickerTitle').textContent='✏️ 镜头'+this._getSceneOrder(sid)+' - '+lib.dimension_name;document.getElementById('s2PickerSearch').value='';document.getElementById('s2PickerSearch').focus();this.activePickerLibId=lib.id;this.renderPickerLibTabs(lib.id);await this.loadCards(lib.id);this.renderCards(lib.id);};
    App.seedanceV2.renderCards=function(libId){var c=document.getElementById('s2PickerCards');var cards=this.cardCache[libId]||[];var search=(document.getElementById('s2PickerSearch').value||'').toLowerCase();var lib=this.getLibraryById(libId);var scene=this._getCurrentScene();var currentVal='';if(lib&&scene){var fk=this._dimToFieldKey(lib.dimension_key);currentVal=scene[fk]||'';}var filtered=search?cards.filter(function(card){return card.word_text.toLowerCase().indexOf(search)>=0||(card.definition&&card.definition.toLowerCase().indexOf(search)>=0);}):cards;if(!filtered.length&&!search){c.innerHTML='<div class=\"s2-picker-empty\">暂无词条</div>';}else if(!filtered.length&&search){c.innerHTML='<div class=\"s2-picker-empty\">无匹配词条</div>';}if(filtered.length){var h='';for(var i=0;i<filtered.length;i++){var card=filtered[i];var sel=this._textMatches(currentVal,card.word_text)?' s2-picker-card-selected':'';h+='<div class=\"s2-picker-card'+sel+'\" onclick=\"App.seedanceV2.selectCard('+card.id+')\"><div class=\"s2-picker-word\">'+App._escape(card.word_text)+(sel?' <span class=\"sp-selected-badge\">\u2713 已选</span>':'')+'</div>'+(card.definition?'<div class=\"s2-picker-def\">'+App._escape(card.definition)+'</div>':'')+'<div class=\"s2-picker-usage\">使用 '+(card.usage_count||0)+' 次</div></div>';}c.innerHTML=h;}if(lib&&lib.category==='custom'){var addHtml='<div class=\"s2-picker-custom-add\"><input id=\"s2CustomWordInput_'+libId+'\" class=\"modal-input\" placeholder=\"输入自定义词条...\" style=\"flex:1;margin:0;font-size:13px;\"><input id=\"s2CustomWordDef_'+libId+'\" class=\"modal-input\" placeholder=\"释义(可选)\" style=\"flex:1;margin:0;font-size:13px;\"><button class=\"btn btn-sm btn-primary\" onclick=\"App.seedanceV2.onCustomLibAddWord('+libId+')\" style=\"white-space:nowrap;\">＋ 添加</button></div>';c.insertAdjacentHTML('beforeend',addHtml);}c.insertAdjacentHTML('beforeend','<div class=\"s2-picker-custom\" onclick=\"App.seedanceV2.customInput()\">\u270f\ufe0f 手动输入...</div>');};App.seedanceV2.selectCard=async function(cardId){var d=await App.fetchJSON('/api/seedance/v2/cards/'+cardId);if(!d||!d.card)return;var currentVal='';var scene=this._getCurrentScene();if(scene)currentVal=scene[this.activeField]||'';var cardValue=d.card.definition&&d.card.definition.trim()?d.card.definition:d.card.word_text;var displayName=d.card.word_text;var isSame=this._textMatches(currentVal,cardValue)||(cardValue!==d.card.word_text&&this._textMatches(currentVal,d.card.word_text));if(isSame){await this.updateSceneField(this.activeSceneId,this.activeField,'');await this.openProject(this.currentProjectId);this.renderPickerLibTabs(this.activePickerLibId);this.renderCards(this.activePickerLibId);App.showToast('已取消: '+displayName,'info');}else{await this.updateSceneField(this.activeSceneId,this.activeField,cardValue);await this.openProject(this.currentProjectId);this.renderPickerLibTabs(this.activePickerLibId);this.renderCards(this.activePickerLibId);App.showToast('已选择: '+displayName,'success');}};
    App.seedanceV2.customInput=function(){var f=this.activeField;var lib=this.getLibraryByKey(f);var v=prompt('输入自定义 '+(lib?lib.dimension_name:f)+' 描述:');if(!v||!v.trim())return;var self=this;var fu=function(){if(lib)App.fetchJSON('/api/seedance/v2/custom-words',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({library_id:lib.id,word_text:v.trim()})});self.updateSceneField(self.activeSceneId,f,v.trim()).then(function(){return self.openProject(self.currentProjectId);}).then(function(){self.renderPickerLibTabs(self.activePickerLibId);self.renderCards(self.activePickerLibId);App.showToast('已设定: '+v.trim(),'success');});};fu();};

    // 拼接引擎
    App.seedanceV2.compose=function(){var p=this.currentProject;if(!p||!this.scenes.length){var o=document.getElementById('s2Output');if(o)o.value='';return;}var lines=[],hd=[];var arEl=document.getElementById('s2_aspect_ratio');var ar=arEl&&arEl.value?arEl.value:(p.aspect_ratio||'16:9');var resEl=document.getElementById('s2_resolution');var res=resEl&&resEl.value?resEl.value:(p.resolution||'1080p');if(ar==='16:9')hd.push('横屏16:9 '+res);else if(ar==='9:16')hd.push('竖屏9:16 '+res);else if(ar==='1:1')hd.push('方形1:1 '+res);else if(ar==='21:9')hd.push('超宽21:9 '+res);else if(ar==='4:3')hd.push('方屏4:3 '+res);else if(ar==='3:4')hd.push('竖屏3:4 '+res);else if(ar==='2.35:1')hd.push('超宽2.35:1 '+res);else hd.push(ar+' '+res);try{var gsEl=document.getElementById('s2_global_style');if(gsEl&&gsEl.value.trim())hd.push(gsEl.value.trim());else if(p.global_style)hd.push(p.global_style);}catch(e){}hd.push(p.total_duration+'s');try{var gtEl=document.getElementById('s2_global_transition');if(gtEl&&gtEl.value.trim())hd.push(gtEl.value.trim());else if(p.global_transition)hd.push(p.global_transition);}catch(e){}try{var npEl=document.getElementById('s2_negative_prompt');if(npEl&&npEl.value.trim())lines.push('[NEGATIVE] '+npEl.value.trim());else if(p.negative_prompt)lines.push('[NEGATIVE] '+p.negative_prompt);}catch(e){}this.outputJson={header:hd.join(','),scenes:[]};for(var i=0;i<this.scenes.length;i++){var sc=this.scenes[i];var st=parseInt(sc.start_time),et=parseInt(sc.end_time);var sl=st+'-'+et+'s';var parts=[];if(sc.camera_move)parts.push(sc.camera_move);if(sc.subject)parts.push(sc.subject);if(sc.scene_desc)parts.push(sc.scene_desc);if(sc.composition)parts.push(sc.composition);if(sc.lighting)parts.push(sc.lighting);if(sc.action)parts.push(sc.action);if(sc.focal_length)parts.push(sc.focal_length);if(sc.texture)parts.push(sc.texture);if(sc.speed)parts.push(sc.speed);if(sc.emotion)parts.push(sc.emotion);if(sc.perspective)parts.push(sc.perspective);if(sc.color_grade)parts.push(sc.color_grade);if(sc.particles)parts.push(sc.particles);if(sc.weather)parts.push(sc.weather);if(sc.natural_force)parts.push(sc.natural_force);if(sc.environment_detail)parts.push(sc.environment_detail);if(sc.depth_of_field)parts.push(sc.depth_of_field);if(sc.filter)parts.push(sc.filter);if(sc.film_flaw)parts.push(sc.film_flaw);if(sc.fantasy_physics)parts.push(sc.fantasy_physics);if(parts.length)sl+=': '+parts.join(',');lines.push(sl);this.outputJson.scenes.push({time:st+'-'+et+'s',fields:parts});}var output='['+hd.join(',')+']\n'+lines.join('\n');this.outputText=output;var o=document.getElementById('s2Output');if(o)o.value=output;};
    App.seedanceV2.copyText=function(){var el=document.getElementById('s2Output');if(!el||!el.value){App.showToast('无输出可复制','warning');return;}navigator.clipboard.writeText(el.value).then(function(){App.showToast('提示词已复制','success');});};
    App.seedanceV2.copyJSON=function(){if(!this.outputJson){App.showToast('无数据可复制','warning');return;}navigator.clipboard.writeText(JSON.stringify(this.outputJson,null,2)).then(function(){App.showToast('JSON已复制','success');});};
    App.seedanceV2.copyLibTV=function(){var t=this.outputText||'';if(!t){App.showToast('无输出可复制','warning');return;}window.open('https://libtv.ai/create?prompt='+encodeURIComponent(t),'_blank');};
    App.seedanceV2.resetProject=function(){if(!confirm('确定重置此项目？'))return;var self=this;App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes',{method:'GET'}).then(function(d){if(!d||!d.items)return;var ids=d.items.map(function(s){return s.id;});(async function(){for(var j=0;j<ids.length;j++)await App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+ids[j],{method:'DELETE'});self.openProject(self.currentProjectId);App.showToast('项目已重置','info');})();});};
})();
