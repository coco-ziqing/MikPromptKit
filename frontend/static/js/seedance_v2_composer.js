// ================================================================
// Seedance V2 多镜头结构化组装器
// ================================================================

(function() {
    'use strict';

    App.seedanceV2 = {
        _F:{'camera_move':'运镜','subject':'主体','scene_desc':'场景','composition':'构图','lighting':'光影','action':'动作','focal_length':'焦段','texture':'质感','speed':'速率','emotion':'情绪','color_grade':'调色','weather':'天气','particles':'粒子','perspective':'视角','depth_of_field':'景深','filter':'滤镜','natural_force':'外力','environment_detail':'环境','film_flaw':'瑕疵','fantasy_physics':'奇幻'},
        _EF:['action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics'],
        projects: [], currentProjectId: null, currentProject: null,
        scenes: [], libraries: [], cardCache: {}, cardPages: {},
        activeField: null, activeSceneId: null, activePickerLibId: null,
        moreLibsOpen: false, dirty: false, outputText: '', outputJson: null,
        _composeTimer: null, _composeDebounceMs: 300
    };

    App.seedanceV2.init = async function() {
        await this.loadLibraries(); this.preloadAllCardCaches(); await this.loadProjects(); this.renderProjectList();
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
        // 自定义分组: field 是 dimension_key (custom_xxx), 不覆盖 activeField
        var isCustomKey = field && typeof field === 'string' && field.startsWith('custom_');
        if (!isCustomKey) App.seedanceV2.activeField = field;
        var panel = document.getElementById('s2RightPanel');
        var layout = document.querySelector('.s2-layout');
        if (!panel || !layout) return;
        // 找到对应的 lib: 先按 dimKey 映射, 再按原始字段名/dimension_key
        var dimKey = App.seedanceV2._fieldToDim && App.seedanceV2._fieldToDim[field] ? App.seedanceV2._fieldToDim[field] : field;
        var foundLib = null;
        for (var li = 0; li < App.seedanceV2.libraries.length; li++) {
            var lib = App.seedanceV2.libraries[li];
            if (lib.dimension_key === dimKey || lib.dimension_key === field) { foundLib = lib; break; }
        }
        if (!foundLib) { App.showToast('未找到对应词库: '+field, 'warning'); return; }
        var displayName = App.seedanceV2._F[field] || foundLib.dimension_name || '选词';
        layout.classList.add('editor-with-panel');
        panel.classList.add('open');
        panel.innerHTML = '<div class="d-flex justify-content-between align-items-center mb-2"><strong>✏️ 选词 - '+App._escape(displayName)+'</strong><button class="btn btn-sm btn-outline" onclick="App.seedanceV2._closeRightPicker()">&times;</button></div><div class="loading-spinner"><div class="spinner-border spinner-border-sm"></div></div>';
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
        var panelField = self._F[self.activeField]||'';
        var isCustom = lib.category === 'custom';
        var titleName = isCustom ? (lib.dimension_name||'自定义') : (panelField || lib.dimension_name||'选词');
        var targetHint = isCustom && panelField ? ' → '+panelField : '';
        var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div><strong>✏️ '+App._escape(titleName)+'</strong><span style="font-size:10px;color:var(--text-muted);margin-left:4px;">'+App._escape(targetHint)+'</span></div><div style="display:flex;gap:4px;"><button class="btn btn-xs btn-outline" onclick="App.seedanceV2._openGroupCreator()" title="新建自定义分组" style="font-size:10px;padding:2px 6px;">+ 分组</button><button class="btn btn-sm btn-outline" onclick="App.seedanceV2._closeRightPicker()">✕</button></div></div>';
        
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
        h += '<button class="sp-lib-tab" onclick="App.seedanceV2._toggleRightExtLibs()" style="font-size:11px;padding:2px 8px;" title="更多词库"><span id="s2RightExtArrow">▶</span> 更多</button>';
        // 自定义分组 tab + 创建入口
        var customLibs = [];
        for (var cli = 0; cli < self.libraries.length; cli++) { if (self.libraries[cli].category === 'custom') customLibs.push(self.libraries[cli]); }
        for (var ci2 = 0; ci2 < customLibs.length; ci2++) {
            var cl = customLibs[ci2];
            var cac = cl.id === activeLibId ? ' sp-lib-active' : '';
            var ct_name = (cl.dimension_name || '').substring(0,8);
            var cfk = self._dimToFieldKey(cl.dimension_key);
            var cfil = (scene && scene[cfk] && scene[cfk].trim()) ? ' sp-lib-tab-filled' : '';
            h += '<button class="sp-lib-tab sp-lib-tab-custom'+cac+cfil+'" onclick="App.seedanceV2._switchRightLib('+cl.id+','+self.activeSceneId+',\''+cfk+'\')" style="font-size:10px;padding:2px 6px;" title="'+App._escape(cl.dimension_name)+'">📁 '+App._escape(ct_name)+'</button>';
        }
        h += '<button class="sp-lib-tab sp-lib-tab-add" onclick="App.seedanceV2._openGroupCreator()" style="font-size:10px;padding:2px 6px;" title="新建自定义分组">+📁</button></div>';
        
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
                var injectValue = def ? def : word;  // 释义优先: 填入预览用详细内容
                var isSelected = fieldVal && (fieldVal.indexOf(injectValue) >= 0);
                var pt=card.preview_image?'/api/seedance/v2/thumbnails/'+card.preview_image:'';
                var vt=card.preview_video?'/api/seedance/v2/videos/'+card.preview_video:'';
                var hasMedia=pt||vt;
                h += '<div class="s2-right-card-item'+(isSelected?' selected':'')+'" data-word="'+App._escape(injectValue)+'" data-card-id="'+card.id+'" data-video="'+(vt||'')+'" onclick="App.seedanceV2._pickRightWord(this)" style="display:flex;gap:8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;margin-bottom:4px;cursor:pointer;transition:0.12s;'+(isSelected?'background:rgba(16,185,129,0.08);border-color:#10b981;':'')+'" onmouseenter="App.seedanceV2._thumbHoverIn(this)" onmouseleave="App.seedanceV2._thumbHoverOut(this)">';
                h += '<div class="s2-card-thumb-zone" data-card-id="'+card.id+'" onclick="event.stopPropagation();">';
                if(vt){
                    h += '<video src="'+vt+'" muted loop preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;"></video>';
                    h += '<span style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:#fff;font-size:8px;padding:1px 4px;border-radius:2px;pointer-events:none;">VID</span>';
                }else if(pt){
                    h += '<img src="'+pt+'" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
                }else{
                    h += '<span class="s2-thumb-placeholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer;" onclick="event.stopPropagation();App.seedanceV2._pickFileForCard('+card.id+')" title="点击选择 | 拖入 | Ctrl+V">+</span>';
                }
                h += '</div>';
                h += '<div style="flex:1;min-width:0;">';
                h += '<div style="font-size:13px;font-weight:600;">'+App._escape(word)+'</div>';
                if (def) h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+App._escape(def.substring(0,80))+'</div>';
                h += '</div>';
                // 自定义词条显示编辑/删除按钮（非系统词卡）
                if(!card.is_system){
                    h += '<div style="flex-shrink:0;display:flex;gap:2px;margin-left:4px;">';
                    h += '<span onclick="event.stopPropagation();App.seedanceV2._editCustomCard('+card.id+',\''+App._escape(word)+'\',\''+App._escape(def)+'\')" title="编辑词条" style="cursor:pointer;font-size:12px;opacity:0.5;" onmouseover="this.style.opacity=\'1\'" onmouseout="this.style.opacity=\'0.5\'">✏️</span>';
                    h += '<span onclick="event.stopPropagation();App.seedanceV2._deleteCustomCard('+card.id+')" title="删除词条" style="cursor:pointer;font-size:12px;opacity:0.5;" onmouseover="this.style.opacity=\'1\'" onmouseout="this.style.opacity=\'0.5\'">🗑</span>';
                    h += '</div>';
                }
                h += '</div></div>';
            }
        }
        h += '</div>';
        // 自定义分组：添加词条入口
        var curLib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
        if(curLib&&curLib.category==='custom'){
            h += '<div style="margin-top:8px;display:flex;gap:4px;">';
            h += '<input id="s2PanelWordInput" class="s2-input" placeholder="新词条..." style="flex:1;font-size:12px;padding:4px 8px;" onkeydown="if(event.key===\'Enter\')App.seedanceV2._addPanelWord('+curLib.id+')">';
            h += '<input id="s2PanelWordDef" class="s2-input" placeholder="释义(可选)" style="width:80px;font-size:12px;padding:4px 8px;" onkeydown="if(event.key===\'Enter\')App.seedanceV2._addPanelWord('+curLib.id+')">';
            h += '<button class="btn btn-sm btn-primary" onclick="App.seedanceV2._addPanelWord('+curLib.id+')" style="font-size:12px;padding:4px 10px;white-space:nowrap;">+添加</button>';
            h += '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._renameGroup('+curLib.id+')" title="重命名分组" style="font-size:11px;padding:4px 8px;">✏️</button>';
            h += '</div>';
        }
        // 图库选取按钮
        h += '<div style="margin-top:8px;text-align:center;"><button class="btn btn-xs btn-outline" onclick="App.seedanceV2._openMediaLibrary()" style="font-size:11px;padding:3px 10px;">📚 从媒体库选取</button></div>';
        panel.innerHTML = h;
        setTimeout(function(){ App.seedanceV2._setupWordCardDropZones(); }, 120);
    };

    App.seedanceV2._rightExtOpen = false;
    App.seedanceV2._toggleRightExtLibs = function() {
        this._rightExtOpen = !this._rightExtOpen;
        var lib = this.getLibraryById(this.activePickerLibId);
        if (lib) this._renderRightPickerContent(lib);
    };

    App.seedanceV2._switchRightLib = async function(libId, sid, fieldKey) {
        var lib = App.seedanceV2.getLibraryById(libId);
        if (!lib) return;
        App.seedanceV2.activePickerLibId = libId;
        App.seedanceV2.activeSceneId = sid;
        // 自定义分组保留用户当前编辑的镜头字段, 不覆盖 activeField
        if (lib.category !== 'custom') {
            App.seedanceV2.activeField = fieldKey;
        }
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
        if (!word || !App.seedanceV2.activeSceneId) return;
        if (!App.seedanceV2.activeField) { App.showToast('请先在镜头卡片中点击一个字段(如运镜/构图)', 'warning'); return; }
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
        var self = this;
        document.querySelectorAll('.s2-project-name').forEach(function(el) {
            el.addEventListener('dblclick', async function(e) {
                e.stopPropagation();
                var pid = parseInt(this.closest('.s2-project-item').dataset.pid);
                var oldName = this.textContent.trim();
                var newName = prompt('编辑项目名称：', oldName);
                if (newName && newName.trim() && newName.trim() !== oldName) {
                    await self._renameProject(pid, newName.trim());
                }
            });
        });
    };

    // 编辑器
    App.seedanceV2.renderComposerEmpty = function(){var c=document.getElementById('s2Editor');if(c)c.innerHTML='<div class="s2-empty-state"><div class="s2-empty-icon">🎬</div><h4>选择或创建项目开始编辑</h4></div>';};
    App.seedanceV2.setDirty = function(){this.dirty=true;};
    App.seedanceV2.onTotalDurationChange = function(){var el=document.getElementById('s2_total_duration');if(!el)return;var val=parseInt(el.value);if(isNaN(val)||val<2||val>60)return;var self=this;App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({total_duration:val})}).then(function(){self.openProject(self.currentProjectId);self.compose();});};
    App.seedanceV2.renderProjectEditor = function() {
        var c=document.getElementById('s2Editor');if(!c)return;var p=this.currentProject;if(!p){this.renderComposerEmpty();return;}
        function ms(id,l,opts,v){var h='<div class="s2-field"><label>'+l+'</label><select id="'+id+'" class="s2-input" onchange="App.seedanceV2._debouncedCompose()">';for(var i=0;i<opts.length;i++){var s=opts[i][0]===v?' selected':'';h+='<option value="'+opts[i][0]+'"'+s+'>'+opts[i][1]+'</option>';}h+='</select></div>';return h;}
        var h='<div class="s2-editor-header"><div class="s2-editor-title"><input id="s2_name" class="s2-input s2-title-input" value="'+App._escape(p.name)+'" onchange="App.seedanceV2.setDirty();App.seedanceV2._debouncedCompose()"></div><div class="s2-editor-actions"><button class="btn btn-sm btn-success" onclick="App.seedanceV2.saveProject()">💾 保存</button><button class="btn btn-sm btn-danger" onclick="App.seedanceV2.deleteProject('+p.id+')">🗑 删除</button></div></div>';
        // ① 分镜列表（可折叠）
        h+='<div class="s2-section s2-shotlist-section" id="s2ShotListSection"><div class="s2-section-title" onclick="App.seedanceV2._toggleShotList()" title="点击折叠/展开" style="cursor:pointer;">🎬 分镜列表 <span class="s2-badge">'+this.scenes.length+' 镜头</span> <span style="font-size:10px;font-weight:400;color:var(--text-muted);">(点击折叠)</span><button id="s2ToggleAllBtn" class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._toggleAllScenes()" title="折叠/展开全部子镜头" style="margin-left:auto;font-size:10px;padding:2px 8px;">▶ 折叠全部</button></div><div class="s2-shotlist-body"><div class="s2-timeline-wrapper"><div class="s2-timeline-ticks">';var tickSpan=Math.max(1,Math.floor((p.total_duration||15)/6));for(var tk=0;tk<=p.total_duration;tk+=tickSpan){h+='<span>'+tk+'s</span>';}h+='</div><div class="s2-timeline-bar" id="s2TimelineBar">';for(var i=0;i<this.scenes.length;i++){var s=this.scenes[i];var w=Math.max(3,((s.end_time-s.start_time)/(p.total_duration||15))*100);var lb=(s.subject||'镜头'+(i+1)).substring(0,6);var segColor=App.seedanceV2._sceneColor(s.id);h+='<div class="s2-timeline-seg" draggable="true" data-scene-id="'+s.id+'" style="width:'+w+'%;background:'+segColor+';" title="'+s.start_time+'-'+s.end_time+'s: '+App._escape(lb)+' (拖拽排序)" onclick="App.seedanceV2._scrollToScene('+s.id+')"><span>'+lb+'</span></div>';}h+='</div></div><div class="s2-scenes-container" id="s2ScenesContainer"></div></div></div>';
        // ② 全局参数（分镜设完再调全局）
        h+='<div class="s2-section s2-global-params-section" id="s2GlobalParamsSection"><div class="s2-section-title" onclick="App.seedanceV2._toggleGlobalParams()" title="点击折叠/展开" style="cursor:pointer;">📐 全局参数 <span style="font-size:10px;font-weight:400;color:var(--text-muted);">(点击折叠)</span></div><div class="s2-global-body"><div class="s2-global-row">';
        h+=ms('s2_aspect_ratio','画幅',[['16:9','横屏16:9'],['9:16','竖屏9:16'],['1:1','方形1:1'],['21:9','超宽21:9'],['4:3','方屏4:3'],['3:4','竖屏3:4']],p.aspect_ratio||'16:9');
        h+=ms('s2_resolution','分辨率',[['480p','480p'],['720p','720p'],['1080p','1080p'],['2K','2K'],['4K','4K'],['6K','6K'],['8K','8K']],p.resolution||'4K');
        h+='<div class="s2-field"><label>总时长(秒)</label><select id="s2_total_duration" class="s2-input" onchange="App.seedanceV2.onTotalDurationChange()">';for(var td=4;td<=60;td+=2){h+='<option value="'+td+'"'+(td===(p.total_duration||15)?' selected':'')+'>'+td+'秒</option>';}h+='</select></div></div>';
        h+='<div class="s2-global-row"><div class="s2-field" style="flex:2;"><label>全局画风 <span class="s2-style-picker-btn" onclick="App.seedanceV2.openStylePicker()" title="从画风词库选择">📚 选风格</span></label><input id="s2_global_style" class="s2-input" placeholder="..." value="'+App._escape(p.global_style||'')+'" onchange="App.seedanceV2.setDirty();App.seedanceV2._debouncedCompose()"></div><div class="s2-field" style="flex:1;"><label>全局转场</label><input id="s2_global_transition" class="s2-input" placeholder="..." value="'+App._escape(p.global_transition||'')+'" onchange="App.seedanceV2.setDirty();App.seedanceV2._debouncedCompose()"></div></div>';
        h+='<div class="s2-field"><label>负面提示词 <span class="s2-np-picker-btn" onclick="App.seedanceV2.openNegativePicker()" title="从负面词库选择">📖 选负面</span></label><input id="s2_negative_prompt" class="s2-input" placeholder="..." value="'+App._escape(p.negative_prompt||'')+'" onchange="App.seedanceV2.setDirty();App.seedanceV2._debouncedCompose()"></div>';
        var rm=(p.remaining_duration!==undefined)?p.remaining_duration:p.remaining;
        h+='<div style="font-size:12px;color:var(--text-muted);margin-top:4px;"><span>已分配: <strong>'+(p.total_dur_input||0)+'</strong>s / <strong>'+p.total_duration+'</strong>s</span><span style="margin-left:12px;'+(rm<=0?'color:#ef4444;':'')+'">剩余: <strong>'+Math.max(0,rm)+'</strong>s</span></div></div></div>';
        // ③ 输出预览
        h+='<div class="s2-output-section"><div class="s2-section-title" onclick="App.seedanceV2._toggleOutput()" title="点击折叠/展开"> 输出预览 <span style="font-size:10px;font-weight:400;color:var(--text-muted);">(点击折叠)</span></div>';
        // 格式/密度/音频控制行
        h+='<div class="s2-global-row" style="margin-bottom:6px;">';
        h+=ms('s2_format','输出格式',[['seedance','Seedance'],['kling','Kling'],['minimax','MiniMax'],['comfyui','ComfyUI'],['raw','纯镜头Raw']],'seedance');
        h+=ms('s2_density','详细度',[['compact','简洁 compact'],['standard','标准 standard'],['detailed','详细 detailed']],'standard');
        h+='<div class="s2-field"><label>音频 <input type="checkbox" id="s2_audio_enabled" onchange="App.seedanceV2._toggleAudioSection();App.seedanceV2._debouncedCompose()"></label></div>';
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
        h+='<button class="btn btn-sm btn-secondary" onclick="App.seedanceV2.resetProject()"> 重置</button>';
        h+='</div>';
        h+='<textarea id="s2Output" class="s2-output-text" readonly placeholder="切换镜头字段后实时合成…"></textarea>';
        h+='<div id="s2OutputMeta" style="font-size:11px;color:var(--text-muted);margin-top:4px;"></div></div>';
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
        if (btn) btn.textContent = anyExpanded ? '▶ 折叠全部' : '▼ 展开全部';
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
            document.addEventListener('click',function(e){if(!e.target.closest('.s2-del-btn')&&!e.target.closest('.s2-global-del-popover')){var p=document.getElementById('s2GlobalDelPop');if(p)p.style.display='none';}});
            var ct=document.getElementById('s2ScenesContainer');if(ct&&!ct.dataset.dragBound){ct.dataset.dragBound='1';var dt=null;ct.addEventListener('dragover',function(e){e.preventDefault();if(e.dataTransfer.files&&e.dataTransfer.files.length){var card=e.target.closest('.s2-scene-card');if(card){document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over');});card.classList.add('s2-drag-over');card.classList.add('s2-file-over');dt=card;}}else{var card=e.target.closest('.s2-scene-card');if(card){document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over');});card.classList.add('s2-drag-over');dt=card;}}});ct.addEventListener('drop',function(e){e.preventDefault();document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over','s2-dragging','s2-file-over');});var files=e.dataTransfer.files;if(files&&files.length){var tgtCard=e.target.closest('.s2-scene-card');if(!tgtCard)return;var sid=parseInt(tgtCard.dataset.sceneId);if(!sid)return;self._handleFileDrop(files[0],sid);return;}var src=parseInt(e.dataTransfer.getData('text/plain'));if(!dt)return;var tgt=parseInt(dt.dataset.sceneId);if(src===tgt)return;self.reorderScenes(src,tgt);dt=null;});ct.addEventListener('dragleave',function(e){setTimeout(function(){document.querySelectorAll('.s2-scene-card').forEach(function(c){c.classList.remove('s2-drag-over','s2-file-over');});},100);});}
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
        h+='<div class="s2-scene-header"><div class="s2-scene-title"><span class="s2-scene-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+dotColor+';margin-right:6px;vertical-align:middle;flex-shrink:0;" title="镜头'+(idx+1)+'"></span><strong onclick="event.stopPropagation();App.seedanceV2._toggleSceneCard('+s.id+')" style="cursor:pointer;" title="点击折叠/展开"><span class="s2-scene-fold-arrow">▼</span> 镜头 '+(idx+1)+'</strong> <span class="s2-time-badge">'+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span></div><div class="s2-scene-actions">';
        h+='<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.insertScene('+s.id+',&apos;before&apos;)">\u2b06插入</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.insertScene('+s.id+',&apos;after&apos;)">\u2b07插入</button>';
        h+='<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.duplicateScene('+s.id+')">📋复制</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._copyScene('+s.id+')" title="拷贝提示词">📝拷贝</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._pasteScene('+s.id+')" title="粘贴提示词">📄粘贴</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._exportScene('+s.id+')" title="导出镜头">📤导出</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._importScene('+s.id+')" title="导入镜头">📥导入</button><button class="btn btn-xs btn-danger s2-del-btn" data-scene-id="'+s.id+'" title="删除此镜头">🗑</button></div></div>';
        h+='<div class="s2-scene-body"><div class="s2-scene-time"><span class="s2-time-label">\u23f1 '+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span>';
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
        h+='</div></div></div></div>';return h;
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

    // 拖拽 JSON 文件到镜头卡片上导入
    App.seedanceV2._handleFileDrop = function(file, sid) {
        if (!file || !file.name || !file.name.endsWith('.json')) {
            App.showToast('⚠️ 请拖入 PromptKit 导出的 .json 镜头文件', 'warning'); return;
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
                        App.showToast('✅ 拖拽导入成功 → 镜头'+(tgtIdx+1), 'success');
                    });
                };
                if (hasContent) {
                    if (confirm('⚠️ 镜头'+(tgtIdx+1)+'已有内容，拖拽导入将覆盖。继续？')) { doImport(); }
                } else { doImport(); }
            } catch (err) {
                App.showToast('⚠️ 解析失败: '+err.message, 'error');
            }
        };
        reader.readAsText(file);
    };
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
        var parts = [];
        if (scene.duration) parts.push(scene.duration+'s');
        if (scene.camera_move) parts.push(scene.camera_move);
        parts.push((scene.subject||'镜头'+(idx+1)).replace(/[\\/:*?"<>|]/g,'_').substring(0,20).trim()||'scene');
        var ts=new Date();var stamp=ts.getFullYear()+('0'+(ts.getMonth()+1)).slice(-2)+('0'+ts.getDate()).slice(-2)+'_'+('0'+ts.getHours()).slice(-2)+('0'+ts.getMinutes()).slice(-2);var projectName='';try{projectName=(App.seedanceV2.currentProject&&App.seedanceV2.currentProject.name||'').replace(/[\\/:*?"<>|]/g,'_').substring(0,15).trim();}catch(e){}var prefix=projectName?projectName+'_':'';var fn=prefix+stamp+'_'+parts.join('_').replace(/\s+/g,'')+'.json';
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
    App.seedanceV2._renderExtUnitHTML=function(scene,idx){var unit=scene._extUnits[idx];var f=unit.field;var n=this._F[f];if(!n){for(var cli2=0;cli2<this.libraries.length;cli2++){if(this.libraries[cli2].dimension_key===f){n=(this.libraries[cli2].dimension_name||'').substring(0,10);break;}}}if(!n)n=f;var v=scene[f]||'';var h='<div class="s2-ext-unit" data-scene-id="'+scene.id+'" data-ext-idx="'+idx+'">';h+='<div class="s2-ext-unit-header"><span class="s2-ext-unit-name">'+n+'</span><select class="s2-ext-unit-dropdown" >';for(var ei=0;ei<this._EF.length;ei++){var sel=this._EF[ei]===f?' selected':'';h+='<option value="'+this._EF[ei]+'"'+sel+'>'+(this._F[this._EF[ei]]||this._EF[ei])+'</option>';};var cust=[];for(var cli=0;cli<this.libraries.length;cli++){if(this.libraries[cli].category==='custom')cust.push(this.libraries[cli]);}if(cust.length){h+='<optgroup label="📁 自定义分组">';for(var ci3=0;ci3<cust.length;ci3++){var cl=cust[ci3];var cdk=cl.dimension_key;var csel=cdk===f?' selected':'';h+='<option value="'+cdk+'"'+csel+'>'+App._escape((cl.dimension_name||'').substring(0,15))+'</option>';}h+='</optgroup>';}h+='</select><button class="s2-ext-unit-remove" title="移除此单元">✖</button></div>';h+='<div class="s2-ext-unit-body"><button class="s2-ext-unit-addword">+ 选词</button>';if(v&&v.trim()){h+='<span class="s2-ext-unit-tag">'+App._escape(v.length>12?v.substring(0,12)+'..':v)+'</span>';}else if(v===' '){h+='<span class="s2-ext-unit-tag" style="color:#94a3b8;">点击选词</span>';}h+='</div></div>';return h;};
    App.seedanceV2.addExtUnit=function(sid){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){var sc=this.scenes[i];if(!sc._extUnits)sc._extUnits=[];var used={};for(var j=0;j<sc._extUnits.length;j++)used[sc._extUnits[j].field]=true;var next=null;for(var k=0;k<this._EF.length;k++){if(!used[this._EF[k]]){next=this._EF[k];break;}}if(!next){App.showToast('所有拓展字段已添加','info');return;}sc._extUnits.push({field:next});sc[next]=' ';this.updateSceneField(sid,next,' ');this.renderScenes();this._openRightPicker(sid,next);return;}}};
    App.seedanceV2.removeExtUnit=function(sid,idx){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){var unit=this.scenes[i]._extUnits[idx];if(!unit)return;var f=unit.field;this.scenes[i][f]='';this.updateSceneField(sid,f,'');this.scenes[i]._extUnits.splice(idx,1);this.renderScenes();return;}}};
    App.seedanceV2._extUnitChange=function(sid,idx,newField){for(var i=0;i<this.scenes.length;i++){if(this.scenes[i].id===sid){var unit=this.scenes[i]._extUnits[idx];var oldField=unit.field;if(oldField===newField)return;this.scenes[i][oldField]='';this.updateSceneField(sid,oldField,'');unit.field=newField;this.scenes[i][newField]=' ';this.updateSceneField(sid,newField,' ');this.renderScenes();this._openRightPicker(sid,newField);return;}}};
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
        if(custom.length){h+='<div class="sp-lib-custom"><div class="sp-lib-custom-header"><span class="sp-lib-custom-label">\ud83d\udce1 自定义</span><button class="sp-lib-custom-manage" onclick="App.seedanceV2.openGroupManagerFromPicker()" title="管理自定义分组">⚙</button><button class="sp-lib-custom-manage" onclick="App.seedanceV2._openGroupCreator()" title="新建分组" style="margin-left:4px;">+📁</button></div><div class="sp-lib-custom-grid">'+tabHtml(custom,true)+'</div></div>';}c.innerHTML=h;};
    App.seedanceV2.toggleMoreLibs=function(){this.moreLibsOpen=!this.moreLibsOpen;this.renderPickerLibTabs(this.activePickerLibId);};
    App.seedanceV2.switchPickerLib=async function(libId){if(libId===this.activePickerLibId)return;this.activePickerLibId=libId;var lib=this.getLibraryById(libId);if(!lib)return;this.activeField=this._dimToFieldKey(lib.dimension_key);document.getElementById('s2PickerTitle').textContent='✏️ 镜头'+this._getSceneOrder(this.activeSceneId)+' - '+lib.dimension_name;document.getElementById('s2PickerSearch').value='';this.renderPickerLibTabs(libId);await this.loadCards(libId);this.renderCards(libId);};
    App.seedanceV2.loadCards=async function(libId){if(this.cardCache[libId])return;var d=await App.fetchJSON('/api/seedance/v2/libraries/'+libId+'/cards?page_size=200');if(d)this.cardCache[libId]=d.items;};App.seedanceV2.preloadAllCardCaches=async function(){var self=this,libs=this.libraries||[];for(var i=0;i<libs.length;i++){var lid=libs[i].id;if(self.cardCache[lid])continue;try{var d=await App.fetchJSON('/api/seedance/v2/libraries/'+lid+'/cards?page_size=200');if(d&&d.items)self.cardCache[lid]=d.items;}catch(e){}}};

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
    App.seedanceV2.openCardPicker=async function(sid,f){this.activeSceneId=sid;this.activeField=f;var lib=this.getLibraryByKey(f)||this.getLibraryByKey(this._fieldToDim[f]);if(!lib&&f&&f.startsWith&&f.startsWith('custom_')){for(var li=0;li<this.libraries.length;li++){if(this.libraries[li].dimension_key===f){lib=this.libraries[li];break;}}}if(!lib){App.showToast('未找到词库: '+f,'error');return;}// 优先使用右侧面板
        var panel = document.getElementById('s2RightPanel');
        if (panel) { this._openRightPicker(sid, f); return; }
        // 兜底：Modal 方式
        var o=document.getElementById('s2CardPicker');if(!o)return;o.style.display='block';document.getElementById('s2PickerTitle').textContent='✏️ 镜头'+this._getSceneOrder(sid)+' - '+lib.dimension_name;document.getElementById('s2PickerSearch').value='';document.getElementById('s2PickerSearch').focus();this.activePickerLibId=lib.id;this.renderPickerLibTabs(lib.id);await this.loadCards(lib.id);this.renderCards(lib.id);};
    App.seedanceV2.renderCards=function(libId){var c=document.getElementById('s2PickerCards');var cards=this.cardCache[libId]||[];var search=(document.getElementById('s2PickerSearch').value||'').toLowerCase();var lib=this.getLibraryById(libId);var scene=this._getCurrentScene();var currentVal='';if(lib&&scene){var fk=this._dimToFieldKey(lib.dimension_key);currentVal=scene[fk]||'';}var filtered=search?cards.filter(function(card){return card.word_text.toLowerCase().indexOf(search)>=0||(card.definition&&card.definition.toLowerCase().indexOf(search)>=0);}):cards;if(!filtered.length&&!search){c.innerHTML='<div class=\"s2-picker-empty\">暂无词条</div>';}else if(!filtered.length&&search){c.innerHTML='<div class=\"s2-picker-empty\">无匹配词条</div>';}if(filtered.length){var h='';for(var i=0;i<filtered.length;i++){var card=filtered[i];var sel=this._textMatches(currentVal,card.word_text)?' s2-picker-card-selected':'';h+='<div class=\"s2-picker-card'+sel+'\" onclick=\"App.seedanceV2.selectCard('+card.id+')\"><div class=\"s2-picker-word\">'+App._escape(card.word_text)+(sel?' <span class=\"sp-selected-badge\">\u2713 已选</span>':'')+'</div>'+(card.definition?'<div class=\"s2-picker-def\">'+App._escape(card.definition)+'</div>':'')+'<div class=\"s2-picker-usage\">使用 '+(card.usage_count||0)+' 次</div></div>';}c.innerHTML=h;}if(lib&&lib.category==='custom'){var addHtml='<div class=\"s2-picker-custom-add\"><input id=\"s2CustomWordInput_'+libId+'\" class=\"modal-input\" placeholder=\"输入自定义词条...\" style=\"flex:1;margin:0;font-size:13px;\"><input id=\"s2CustomWordDef_'+libId+'\" class=\"modal-input\" placeholder=\"释义(可选)\" style=\"flex:1;margin:0;font-size:13px;\"><button class=\"btn btn-sm btn-primary\" onclick=\"App.seedanceV2.onCustomLibAddWord('+libId+')\" style=\"white-space:nowrap;\">＋ 添加</button></div>';c.insertAdjacentHTML('beforeend',addHtml);}c.insertAdjacentHTML('beforeend','<div class=\"s2-picker-custom\" onclick=\"App.seedanceV2.customInput()\">\u270f\ufe0f 手动输入...</div>');};App.seedanceV2.selectCard=async function(cardId){var d=await App.fetchJSON('/api/seedance/v2/cards/'+cardId);if(!d||!d.card)return;var currentVal='';var scene=this._getCurrentScene();if(scene)currentVal=scene[this.activeField]||'';var cardValue=d.card.definition&&d.card.definition.trim()?d.card.definition:d.card.word_text;var displayName=d.card.word_text;var isSame=this._textMatches(currentVal,cardValue)||(cardValue!==d.card.word_text&&this._textMatches(currentVal,d.card.word_text));if(isSame){await this.updateSceneField(this.activeSceneId,this.activeField,'');await this.openProject(this.currentProjectId);this.renderPickerLibTabs(this.activePickerLibId);this.renderCards(this.activePickerLibId);App.showToast('已取消: '+displayName,'info');}else{await this.updateSceneField(this.activeSceneId,this.activeField,cardValue);await this.openProject(this.currentProjectId);this.renderPickerLibTabs(this.activePickerLibId);this.renderCards(this.activePickerLibId);App.showToast('已选择: '+displayName,'success');}};
    App.seedanceV2.customInput=function(){var f=this.activeField;var lib=this.getLibraryByKey(f);var v=prompt('输入自定义 '+(lib?lib.dimension_name:f)+' 描述:');if(!v||!v.trim())return;var self=this;var fu=function(){if(lib)App.fetchJSON('/api/seedance/v2/custom-words',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({library_id:lib.id,word_text:v.trim()})});self.updateSceneField(self.activeSceneId,f,v.trim()).then(function(){return self.openProject(self.currentProjectId);}).then(function(){self.renderPickerLibTabs(self.activePickerLibId);self.renderCards(self.activePickerLibId);App.showToast('已设定: '+v.trim(),'success');});};fu();};

    // 拼接引擎（含300ms防抖，避免高频输入时重复计算）
    // ============ 词卡缩略图 ============
    App.seedanceV2._uploadWordCardThumb=async function(cardId,file){
        var fd=new FormData();fd.append('file',file);
        try{
            var r=await fetch('/api/seedance/v2/cards/'+cardId+'/thumbnail',{method:'POST',body:fd});
            var d=await r.json();
            if(d&&d.ok){
                var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
                if(lib){delete App.seedanceV2.cardCache[lib.id];await App.seedanceV2.loadCards(lib.id);
                App.seedanceV2._renderRightPickerContent(lib);}
                App.showToast('缩略图已保存','success');
            }else{App.showToast('上传失败','error');}
        }catch(e){App.showToast('上传异常: '+e.message,'error');}
    };
    App.seedanceV2._setupWordCardDropZones=function(){
        var self=this;
        document.querySelectorAll('.s2-card-thumb-zone').forEach(function(z){
            if(z.dataset.dropBound)return;z.dataset.dropBound='1';
            // 拖入上传
            z.addEventListener('dragover',function(e){e.preventDefault();e.stopPropagation();
                this.style.background='rgba(16,185,129,0.12)';this.style.border='1px dashed #10b981';});
            z.addEventListener('dragleave',function(e){this.style.background='';this.style.border='';});
            z.addEventListener('drop',function(e){e.preventDefault();e.stopPropagation();
                this.style.background='';this.style.border='';
                var cid=parseInt(this.dataset.cardId);
                if(!cid||!e.dataTransfer.files||!e.dataTransfer.files.length)return;
                var files=Array.from(e.dataTransfer.files).filter(function(f){return f.type.startsWith('image/')||f.type.startsWith('video/');});
                if(!files.length)return;
                var allCards=document.querySelectorAll('.s2-card-thumb-zone');
                var startIdx=-1;
                for(var ai=0;ai<allCards.length;ai++){if(parseInt(allCards[ai].dataset.cardId)===cid){startIdx=ai;break;}}
                for(var fi=0;fi<files.length;fi++){
                    var targetCard=cid;
                    if(startIdx>=0&&fi>0){
                        var nextCard=allCards[startIdx+fi];
                        if(nextCard)targetCard=parseInt(nextCard.dataset.cardId);
                    }
                    self._dispatchUpload(targetCard,files[fi]);
                }
                if(files.length>1)App.showToast(files.length+' 个文件正在上传','info');
            });
            // 点击上传：由+占位符自身处理，不影响其他元素点击
            // 右键菜单：已有的预览可替换/删除
            var hasMedia=z.querySelector('img, video');
            if(hasMedia){
                z.addEventListener('contextmenu',function(e){
                    e.preventDefault();e.stopPropagation();
                    var cid=parseInt(this.dataset.cardId);
                    self._showThumbContextMenu(cid,e.clientX,e.clientY,this);
                });
            }
        });
        // 全局粘贴监听：在右侧面板打开时Ctrl+V可直接粘贴到当前活跃镜头词库
        if(!document.getElementById('s2RightPanel').dataset.pasteBound){
            document.getElementById('s2RightPanel').dataset.pasteBound='1';
            document.addEventListener('paste',function(e){
                var panel=document.getElementById('s2RightPanel');
                if(!panel||!panel.classList.contains('open'))return;
                var items=e.clipboardData&&e.clipboardData.items;
                if(!items)return;
                for(var i=0;i<items.length;i++){
                    if(items[i].type.startsWith('image/')||items[i].type.startsWith('video/')){
                        e.preventDefault();
                        var f=items[i].getAsFile();
                        if(!f)continue;
                        // 粘贴到当前活跃面板中第一个词卡（用户可通过悬停指示目标）
                        var targetCard=self.activePickerLibId?self._getFirstVisibleWordCard():null;
                        if(targetCard){
                            self._dispatchUpload(targetCard,f);
                            App.showToast('已粘贴到词卡预览','success');
                        }
                        break;
                    }
                }
            });
        }
    };
    // 打开文件选择器为词卡添加预览（由+占位符onclick调用）
    App.seedanceV2._pickFileForCard=function(cardId){
        var inp=document.createElement('input');inp.type='file';
        inp.accept='image/*,video/mp4,video/webm,video/mov';
        inp.onchange=function(ev){
            var f=ev.target.files[0];
            if(!f)return;
            App.seedanceV2._dispatchUpload(cardId,f);
        };
        inp.click();
    };
    // 统一上传分发：根据文件类型路由到图片或视频上传
    App.seedanceV2._dispatchUpload=function(cardId,file){
        if(!file)return;
        if(file.type.startsWith('video/')){this._uploadWordCardVideo(cardId,file);}
        else if(file.type.startsWith('image/')){this._uploadWordCardThumb(cardId,file);}
        else{App.showToast('仅支持图片和视频文件','warning');}
    };
    // 获取面板中第一个可见的词卡ID（用于Ctrl+V粘贴目标）
    App.seedanceV2._getFirstVisibleWordCard=function(){
        var items=document.querySelectorAll('.s2-right-card-item');
        for(var i=0;i<items.length;i++){
            if(items[i].style.display!=='none'&&items[i].dataset.cardId){
                return parseInt(items[i].dataset.cardId);
            }
        }
        // fallback: 第一个缩略图区
        var z=document.querySelector('.s2-card-thumb-zone');
        return z?parseInt(z.dataset.cardId):null;
    };
    // 右键菜单：替换/删除预览
    App.seedanceV2._showThumbContextMenu=function(cardId,x,y,zoneEl){
        var old=document.getElementById('s2ThumbCtxMenu');
        if(old)old.remove();
        var isDark=document.documentElement.classList.contains('dark')||document.body.classList.contains('dark-theme');
        var menu=document.createElement('div');menu.id='s2ThumbCtxMenu';
        menu.style.cssText='position:fixed;z-index:9999;left:'+x+'px;top:'+y+'px;'
            +(isDark?'background:#1e293b;border:1px solid #334155;color:#e2e8f0;':'background:#fff;border:1px solid #e2e8f0;color:#1e293b;')
            +'border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.25);padding:4px;min-width:140px;font-size:13px;';
        menu.innerHTML=
            '<div style="padding:7px 12px;cursor:pointer;border-radius:5px;display:flex;align-items:center;gap:6px;" onmouseover="this.style.background=\''+(isDark?'#334155':'#f1f5f9')+'\'" onmouseout="this.style.background=\'\'" onclick="App.seedanceV2._replaceThumb('+cardId+');document.getElementById(\'s2ThumbCtxMenu\').remove()">📁 替换预览</div>'
            +'<div style="padding:7px 12px;cursor:pointer;border-radius:5px;display:flex;align-items:center;gap:6px;" onmouseover="this.style.background=\''+(isDark?'#334155':'#f1f5f9')+'\'" onmouseout="this.style.background=\'\'" onclick="App.seedanceV2._deleteThumb('+cardId+');document.getElementById(\'s2ThumbCtxMenu\').remove()">🗑 删除预览</div>';
        document.body.appendChild(menu);
        setTimeout(function(){
            document.addEventListener('click',function h(){var m=document.getElementById('s2ThumbCtxMenu');if(m)m.remove();document.removeEventListener('click',h);});
        },50);
    };
    // 替换预览：打开文件选择器
    App.seedanceV2._replaceThumb=function(cardId){
        var inp=document.createElement('input');inp.type='file';inp.accept='image/*,video/mp4,video/webm,video/mov';
        inp.onchange=function(e){var f=e.target.files[0];if(f)App.seedanceV2._dispatchUpload(cardId,f);};
        inp.click();
    };
    // 删除预览：调API删除
    App.seedanceV2._deleteThumb=async function(cardId){
        var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
        try{
            await fetch('/api/seedance/v2/cards/'+cardId+'/thumbnail',{method:'DELETE'});
            await fetch('/api/seedance/v2/cards/'+cardId+'/video',{method:'DELETE'});
        }catch(e){}
        if(lib){delete App.seedanceV2.cardCache[lib.id];await App.seedanceV2.loadCards(lib.id);
        App.seedanceV2._renderRightPickerContent(lib);}
        App.showToast('预览已删除','info');
    };
    // 从媒体资产管理库选取预览
    App.seedanceV2._openMediaLibrary=function(){
        var old=document.getElementById('s2MediaLibModal');
        if(old)old.remove();
        var overlay=document.createElement('div');overlay.id='s2MediaLibModal';
        overlay.className='modal-overlay';
        overlay.style.cssText='display:flex;z-index:900;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick=function(e){if(e.target===this)this.style.display='none';};
        overlay.innerHTML='<div class="modal-content" style="max-width:680px;max-height:85vh;"><div class="modal-header"><h5>📚 从媒体库选取预览</h5><span style="font-size:11px;color:var(--text-muted);margin-left:12px;" id="s2MediaLibTarget">→ 将添加到当前词库</span><button class="header-btn-sm s2-close-modal" data-modal="s2MediaLibModal">✕</button></div><div class="modal-body" style="max-height:60vh;overflow-y:auto;"><div id="s2MediaLibGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;"><div class="loading-spinner"><div class="spinner-border spinner-border-sm"></div></div></div></div><div class="modal-footer"><button class="btn btn-sm btn-secondary" onclick="document.getElementById(\'s2MediaLibModal\').style.display=\'none\'">取消</button></div></div>';
        document.body.appendChild(overlay);
        // 加载图库
        var self=this;
        (async function(){
            var d=await App.fetchJSON('/api/thumbnails/library?page_size=120');
            if(!d||!d.items)return;
            var grid=document.getElementById('s2MediaLibGrid');
            if(!grid)return;
            var h='';
            for(var i=0;i<d.items.length;i++){
                var item=d.items[i];
                h+='<div style="border:1px solid var(--border-color);border-radius:6px;overflow:hidden;cursor:pointer;transition:0.12s;" onclick="App.seedanceV2._pickFromMediaLib(\''+(item.filename||'')+'\')" onmouseover="this.style.borderColor=\''+('var(--primary,#6366f1)')+'\'" onmouseout="this.style.borderColor=\''+('var(--border-color)')+'\'">';
                h+='<div style="width:100%;height:100px;background:var(--bg-muted,#f1f5f9);display:flex;align-items:center;justify-content:center;">';
                if(item.url){
                    h+='<img src="'+item.url+'" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
                }else{
                    h+='<span style="font-size:10px;color:var(--text-muted);">无预览</span>';
                }
                h+='</div>';
                h+='<div style="padding:4px 6px;font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(item.original_name||item.filename||'').substring(0,18)+'</div>';
                h+='</div>';
            }
            grid.innerHTML=h||'<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">暂无媒体资产</div>';
        })();
    };
    // 从媒体库选取后：下载缩略图→上传到词卡（含目标高亮反馈）
    App.seedanceV2._pickFromMediaLib=async function(filename){
        var overlay=document.getElementById('s2MediaLibModal');
        if(overlay)overlay.style.display='none';
        if(!filename)return;
        try{
            var resp=await fetch('/api/thumbnails/file/'+filename);
            if(!resp.ok){App.showToast('获取文件失败','error');return;}
            var blob=await resp.blob();
            var file=new File([blob],filename,{type:blob.type||'image/jpeg'});
            var targetId=App.seedanceV2._getFirstVisibleWordCard();
            if(!targetId){App.showToast('未找到目标词卡','warning');return;}
            // 获取目标词卡名称用于反馈
            var targetWord='';
            var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
            var cards=lib?App.seedanceV2.cardCache[lib.id]:null;
            if(cards){for(var ci=0;ci<cards.length;ci++){if(cards[ci].id===targetId){targetWord=cards[ci].word_text||'';break;}}}
            // 高亮目标词卡缩略图区
            var targetZone=document.querySelector('.s2-card-thumb-zone[data-card-id="'+targetId+'"]');
            if(targetZone){
                targetZone.style.transition='0.15s';
                targetZone.style.boxShadow='0 0 0 3px #10b981';
                targetZone.style.borderColor='#10b981';
                setTimeout(function(){targetZone.style.boxShadow='';targetZone.style.borderColor='';},1500);
            }
            App.seedanceV2._dispatchUpload(targetId,file);
            App.showToast('已添加预览到: '+(targetWord||'词卡#'+targetId),'success');
        }catch(e){App.showToast('选取失败: '+e.message,'error');}
    };
    // ============ 自定义词条增删改 ============
    // 快速创建自定义分组（弹窗输入名称）
    App.seedanceV2._openGroupCreator=function(){
        var name=prompt('新建自定义分组名称:','');
        if(!name||!(name=name.trim()))return;
        var self=this;
        App.fetchJSON('/api/seedance/v2/libraries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})}).then(function(d){
            if(d&&d.ok){
                self.loadLibraries().then(function(){
                    // 自动切换到新建的分组
                    App.seedanceV2._renderRightPickerContent(App.seedanceV2.getLibraryById(d.id));
                });
                App.showToast('分组已创建: '+name,'success');
            }else{App.showToast('创建失败, 名称可能重复','error');}
        });
    };
    // 从面板输入框添加词条到自定义分组
    App.seedanceV2._addPanelWord=async function(libId){
        var wi=document.getElementById('s2PanelWordInput');
        var di=document.getElementById('s2PanelWordDef');
        var w=(wi.value||'').trim();
        if(!w){App.showToast('请输入词条内容','warning');return;}
        var def=di?(di.value||'').trim():'';
        var d=await App.fetchJSON('/api/seedance/v2/libraries/'+libId+'/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word_text:w,definition:def})});
        if(d&&d.ok){wi.value='';if(di)di.value='';
        delete App.seedanceV2.cardCache[libId];await App.seedanceV2.loadCards(libId);
        var lib=App.seedanceV2.getLibraryById(libId);
        if(lib)App.seedanceV2._renderRightPickerContent(lib);
        App.showToast('已添加词条','success');}
        else{App.showToast('添加失败','error');}};
    // 编辑自定义词条（弹窗）
    App.seedanceV2._editCustomCard=function(cardId,oldText,oldDef){
        var w=prompt('编辑词条:',oldText);
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
            }else{App.showToast('更新失败','error');}
        });
    };
    // 删除自定义词条
    App.seedanceV2._deleteCustomCard=async function(cardId){
        if(!confirm('确定删除此词条？'))return;
        var d=await App.fetchJSON('/api/seedance/v2/cards/'+cardId,{method:'DELETE'});
        if(d&&d.ok){
            var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
            if(lib){delete App.seedanceV2.cardCache[lib.id];await App.seedanceV2.loadCards(lib.id);
            App.seedanceV2._renderRightPickerContent(lib);}
            App.showToast('词条已删除','info');
        }else{App.showToast('删除失败','error');}
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
                App.showToast('分组已重命名','success');
            }else{App.showToast('重命名失败','error');}
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
                App.showToast('视频预览已保存','success');
            }else{App.showToast('上传失败','error');}
        }catch(e){App.showToast('上传异常: '+e.message,'error');}
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
    App.seedanceV2._toggleAudioSection = function() {
        var panel = document.getElementById('s2_audio_section');
        var cb = document.getElementById('s2_audio_enabled');
        if (panel && cb) panel.style.display = cb.checked ? 'block' : 'none';
    };
    App.seedanceV2.compose=function(){
        var p=this.currentProject;
        if(!p||!this.scenes.length){var o=document.getElementById('s2Output');if(o)o.value='';return;}
        // 收集当前全局参数
        var fmt=document.getElementById('s2_format')?.value||'seedance';
        var density=document.getElementById('s2_density')?.value||'standard';
        var includeAudio=document.getElementById('s2_audio_enabled')?.checked||false;
        var body={format:fmt,density:density};
        if(includeAudio){
            body.include_audio=true;
            var bgm=document.getElementById('s2_bgm');if(bgm&&bgm.value.trim())body.bgm=bgm.value.trim();
            var sfx=document.getElementById('s2_sfx');if(sfx&&sfx.value.trim())body.sfx=sfx.value.trim();
            var dialogue=document.getElementById('s2_dialogue');if(dialogue&&dialogue.value.trim())body.dialogue=dialogue.value.trim();
        }
        // 调用后端引擎
        var self=this;
        var o=document.getElementById('s2Output');if(o)o.value='正在合成…';
        App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/compose',{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
        }).then(function(r){
            if(!r||!r.text){if(o)o.value='合成失败';return;}
            self.outputText=r.text;
            self.outputJson=r.json||{};
            if(o)o.value=r.text;
            // 显示元信息
            var meta=document.getElementById('s2OutputMeta');
            if(meta)meta.textContent=(r.shot_count||0)+'镜头 · '+(r.pixel_res||'')+' · '+(r.density||'standard');
        }).catch(function(e){
            if(o)o.value='合成失败: '+e.message;
        });
    };
    App.seedanceV2.copyText=function(){var el=document.getElementById('s2Output');if(!el||!el.value){App.showToast('无输出可复制','warning');return;}navigator.clipboard.writeText(el.value).then(function(){App.showToast('提示词已复制','success');});};
    App.seedanceV2.copyJSON=function(){var obj=this.outputJson;if(!obj||!Object.keys(obj).length){App.showToast('无数据可复制','warning');return;}navigator.clipboard.writeText(JSON.stringify(obj,null,2)).then(function(){App.showToast('JSON已复制','success');});};
    App.seedanceV2.copyLibTV=function(){var t=this.outputText||'';if(!t){App.showToast('无输出可复制','warning');return;}window.open('https://libtv.ai/create?prompt='+encodeURIComponent(t),'_blank');};
    App.seedanceV2.resetProject=function(){if(!confirm('确定重置此项目？'))return;var self=this;App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId+'/scenes',{method:'GET'}).then(function(d){if(!d||!d.items)return;var ids=d.items.map(function(s){return s.id;});(async function(){for(var j=0;j<ids.length;j++)await App.fetchJSON('/api/seedance/v2/projects/'+self.currentProjectId+'/scenes/'+ids[j],{method:'DELETE'});self.openProject(self.currentProjectId);App.showToast('项目已重置','info');})();});};
})();
