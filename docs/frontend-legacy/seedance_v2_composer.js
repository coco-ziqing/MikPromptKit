// ================================================================
// Seedance V2 多镜头结构化组装器
// ================================================================

(function() {
    'use strict';

    App.seedanceV2 = {
        _F:{'camera_move':App._t('auto.str_4abc8a41', '运镜'),'subject':'主体','scene_desc':App._t('auto.str_c931653c', '场景'),'composition':App._t('auto.str_c38d3f3b', '构图'),'lighting':'光影','action':'动作','focal_length':'焦段','texture':'质感','speed':'速率','emotion':'情绪','color_grade':'调色','weather':'天气','particles':'粒子','perspective':'视角','depth_of_field':'景深','filter':'滤镜','natural_force':'外力','environment_detail':'环境','film_flaw':'瑕疵','fantasy_physics':'奇幻','character_voice':App._t('auto.str_a3ed37f4', '角色旁白'),'bgm':'BGM','sfx':'音效'},
        _EF:['action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics'],
        projects: [], currentProjectId: null, currentProject: null,
        scenes: [], libraries: [], cardCache: {}, cardPages: {},
        activeField: null, activeSceneId: null, activePickerLibId: null,
        moreLibsOpen: false, dirty: false, outputText: '', outputJson: null,
        _composeTimer: null, _composeDebounceMs: 300,
        // Phase13.4: 撤销栈 + 脏标记渲染
        _undoStack: [], _undoMax: 40,
        _dirtySceneIds: null, _renderTimer: null, _bindTimer: null
    };

    App.seedanceV2.init = async function() {
        // 防重入: 多个调用者共享同一个初始化 Promise
        if (this._initPromise) return this._initPromise;
        var self = this;

        // 事件监听器只注册一次（与 Promise 无关，用独立标记防重）
        if (!this._eventsBound) {
            this._eventsBound = true;
            // ESC 键关闭词库弹窗
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    var picker = document.getElementById('s2CardPicker');
                    if (picker && picker.style.display !== 'none') { self.closePicker(); return; }
                    var remaining = document.getElementById('s2RemainingModal');
                    if (remaining && remaining.style.display !== 'none') { remaining.style.display = 'none'; return; }
                    var clearPop = document.getElementById('s2ClearPop');
                    if (clearPop && clearPop.style.display !== 'none') { clearPop.style.display = 'none'; return; }
                    var delPop = document.getElementById('s2GlobalDelPop');
                    if (delPop && delPop.style.display !== 'none') { delPop.style.display = 'none'; return; }
                    var rightPanel = document.getElementById('s2RightPanel');
                    if (rightPanel && !rightPanel.classList.contains('collapsed')) { self.toggleRightPanel(); return; }
                }
                // Ctrl+S 保存项目
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    if (self.currentProjectId) self.saveProject();
                    return;
                }
                // Ctrl+Z 撤销
                if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                    if (self.currentProjectId && self._undoStack && self._undoStack.length > 0) {
                        e.preventDefault();
                        self._undoLastChange();
                    }
                    return;
                }
                // ↑↓ 在镜头间切换
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    var cards = document.querySelectorAll('.s2-scene-card');
                    if (!cards.length || !self.currentProjectId) return;
                    var focused = document.activeElement ? document.activeElement.closest('.s2-scene-card') : null;
                    var idx = focused ? Array.from(cards).indexOf(focused) : -1;
                    var next = e.key === 'ArrowDown' ? Math.min(idx + 1, cards.length - 1) : Math.max(idx - 1, 0);
                    if (next >= 0 && next < cards.length && next !== idx) {
                        e.preventDefault();
                        cards[next].scrollIntoView({behavior:'smooth',block:'center'});
                        cards[next].style.boxShadow = '0 0 0 2px var(--primary)';
                        setTimeout(function(){cards[next].style.boxShadow='';},1500);
                    }
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
                        var action = btn.dataset.action, sid = parseInt(btn.dataset.scene), val = parseFloat(btn.dataset.val), rem = parseFloat(btn.dataset.rem||0);
                        // 关闭选择弹窗
                        var m=document.getElementById('s2RemainingModal');if(m)m.style.display='none';
                        if (action==='addScene') { self._choiceAddScene(sid,val); }
                        else if (action==='changeTotal') { self._choiceChangeTotal(sid,val,rem); }
                        else if (action==='unlockOther') { self._choiceUnlockOther(sid,val,rem); }
                        else if (action==='directLock') { self._doSetDuration(sid,val); }
                    }
                });
            }, 100);
        }

        this._initPromise = (async function() {
            // v4.0.0-phase10.1: 预加载角色列表（供镜头卡角色名显示）
            try { App.characterLib.loadList(); } catch(e) {}
            await self.loadLibraries(); self.preloadAllCardCaches(); await self.loadProjects(); self.renderProjectList();
            try{var savedPid=localStorage.getItem('promptkit_seedance_project');if(savedPid){var found=false;for(var i=0;i<self.projects.length;i++){if(self.projects[i].id==parseInt(savedPid)){found=true;break;}}if(found)self.openProject(parseInt(savedPid));}}catch(e){}
            setTimeout(function() { self._restoreSidebar(); }, 200);
            if (!document.getElementById('s2GlobalDelPop')) {
                var d = document.createElement('div'); d.id = 's2GlobalDelPop'; d.className = 's2-global-del-popover';
                d.style.cssText = 'display:none;position:fixed;z-index:999;';
                d.innerHTML = '<span class="s2-del-popover-text">\u786e\u5b9a\u5220\u9664\u6b64\u955c\u5934\uff1f</span><button class="s2-del-popover-yes" onclick="App.seedanceV2.deleteScene(parseInt(this.parentElement.dataset.sceneId))">\u786e\u8ba4</button><button class="s2-del-popover-no" onclick="this.parentElement.style.display=&apos;none&apos;">\u53d6\u6d88</button>';
                document.body.appendChild(d);
            if (!document.getElementById('s2ClearPop')) {
                var cp = document.createElement('div'); cp.id = 's2ClearPop'; cp.className = 's2-global-del-popover';
                cp.style.cssText = 'display:none;position:fixed;z-index:999;';
                cp.innerHTML = '<span class="s2-del-popover-text">\u786e\u5b9a\u6e05\u9664\u6b64\u955c\u5934\u6240\u6709\u5185\u5bb9\uff1f</span><button class="s2-del-popover-yes" onclick="App.seedanceV2.clearScene(parseInt(this.parentElement.dataset.sceneId))">\u786e\u8ba4</button><button class="s2-del-popover-no" onclick="this.parentElement.style.display=&apos;none&apos;">\u53d6\u6d88</button>';
                document.body.appendChild(cp);
            }
            }
            if (!document.getElementById('s2ProjectDelPop')) {
                var d2 = document.createElement('div'); d2.id = 's2ProjectDelPop'; d2.className = 's2-global-del-popover';
                d2.style.cssText = 'display:none;position:fixed;z-index:999;';
                d2.innerHTML = '<span class="s2-del-popover-text">\u786e\u5b9a\u5220\u9664\u6b64\u9879\u76ee\uff1f</span><button class="s2-del-proj-confirm">\u786e\u8ba4</button><button class="s2-proj-del-cancel">\u53d6\u6d88</button>';
                document.body.appendChild(d2);
            }
            self._initPromise = null;
        })();
        return this._initPromise;
    };

    // 词库
    App.seedanceV2.loadLibraries = async function() { var d = await App.fetchJSON('/api/seedance/v2/libraries'); if(d) this.libraries = d.libraries; };
    App.seedanceV2.getLibraryByKey = function(k) { for(var i=0;i<this.libraries.length;i++){if(this.libraries[i].dimension_key===k)return this.libraries[i];} return null; };
    App.seedanceV2.getLibraryById = function(id) { for(var i=0;i<this.libraries.length;i++){if(this.libraries[i].id===id)return this.libraries[i];} return null; };

    // 项目管理
    App.seedanceV2.loadProjects = async function() { var url=this._standaloneMode?'/api/seedance/v2/projects?orphaned=true&page_size=100':'/api/seedance/v2/projects?page_size=100'; var d=await App.fetchJSON(url); if(d) this.projects = d.items; };
    App.seedanceV2.createProject = async function() { var n=prompt(App._t('auto.str_424063a1', '项目名称:'),'新项目 '+(this.projects.length+1)); if(!n)return; var d=await App.fetchJSON('/api/seedance/v2/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})}); if(d&&d.ok){await this.loadProjects();this._renderList();this.openProject(d.id);App.showToast('项目已创建','success');} };

    // 🚀 独立分镜模板入口：免许可，不关联任何项目
    App.seedanceV2.openStandalone = async function() {
        this._standaloneMode = true;
        // 确保删除弹窗存在（独立模式不走 init 流程）
        if (!document.getElementById('s2ProjectDelPop')) {
            var d2 = document.createElement('div'); d2.id = 's2ProjectDelPop'; d2.className = 's2-global-del-popover';
            d2.style.cssText = 'display:none;position:fixed;z-index:999;';
            d2.innerHTML = '<span class="s2-del-popover-text">确定删除此项目？</span><button class="s2-del-proj-confirm">确认</button><button class="s2-proj-del-cancel">取消</button>';
            document.body.appendChild(d2);
        }
        // 直接进入 seedance 视图，不走 switchView 常规流程
        document.querySelectorAll('.view-panel').forEach(function(el){ el.classList.remove('active-view'); });
        var seedanceEl = document.getElementById('viewSeedance');
        if (seedanceEl) seedanceEl.classList.add('active-view');
        App._hideSearchBox(); App._showSidebar(); App._collapseSidebar();
        // 加载孤立分镜项目
        var d = await App.fetchJSON('/api/seedance/v2/projects?orphaned=true&page_size=100');
        if (d) this.projects = d.items;
        this.renderStandaloneList();
        this.currentProjectId = null; this.currentProject = null; this.scenes = [];
        this.renderComposerEmpty();
        // 设置切换 tab 为 composer
        this.switchSeedanceTab('composer');
    };

    // 独立模板列表渲染（简化版，去除项目关联信息）
    App.seedanceV2.renderStandaloneList = function() {
        var c = document.getElementById('s2ProjectList');
        if (!c) return;
        var h = '<div class="s2-project-header"><h5>📋 独立分镜模板</h5>' +
            '<div class="s2-header-actions">' +
            '<button class="btn btn-sm btn-primary" onclick="App.seedanceV2._standaloneCreate()">+ 新建模板</button>' +
            '</div></div>' +
            '<div style="font-size:11px;color:var(--text-muted);padding:0 0 8px;">自由分镜模板，不归属于任何项目，随时可用</div>';
        if (!this.projects.length) {
            h += '<div class="s2-empty">暂无独立模板<br><span style="font-size:11px;color:var(--text-muted);">创建的分镜模板可在此独立管理</span></div>';
        } else {
            for (var i = 0; i < this.projects.length; i++) {
                var p = this.projects[i];
                var a = p.id === this.currentProjectId ? ' s2-project-active' : '';
                h += '<div class="s2-project-item' + a + '" data-pid="' + p.id + '">' +
                    '<div class="s2-project-info" onclick="App.seedanceV2.openProject(' + p.id + ')">' +
                    '<div class="s2-project-name">' + App._escape(p.name || '未命名') + '</div>' +
                    '<div class="s2-project-meta">' + p.scene_count + ' 镜头 · ' + (p.total_duration || 15) + 's</div>' +
                    '</div>' +
                    '<button class="s2-project-del" onclick="event.stopPropagation();App.seedanceV2.showProjectDelPopover(this,' + p.id + ')">✖</button>' +
                    '</div>';
            }
        }
        c.innerHTML = h;
    };

    // 创建独立模板
    App.seedanceV2._standaloneCreate = async function() {
        var n = prompt('分镜模板名称：', '新模板 ' + (this.projects.length + 1));
        if (!n) return;
        var d = await App.fetchJSON('/api/seedance/v2/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: n })
        });
        if (d && d.ok) {
            await this.loadProjects();
            this.renderStandaloneList();
            this.openProject(d.id);
            App.showToast('独立模板已创建', 'success');
        }
    };

    // 退出独立模板模式
    App.seedanceV2.exitStandalone = function() {
        this._standaloneMode = false;
        this.currentProjectId = null;
        this.currentProject = null;
        this.scenes = [];
        App.switchView('home');
    };
    App.seedanceV2.deleteProject = async function(id){var d=await App.fetchJSON('/api/seedance/v2/projects/'+id,{method:'DELETE'});if(d&&d.ok){if(this.currentProjectId===id){this.currentProjectId=null;this.currentProject=null;this.scenes=[];this.renderComposerEmpty();}await this.loadMasterProjects();await this.loadProjects();this._renderList();App.showToast('分镜组已删除','info');}};
    App.seedanceV2.confirmDeleteProject = function(id){if(!confirm(App._t('common.ok', '确定删除此项目？所有镜头数据将永久丢失。')))return;this.deleteProject(id);};
    App.seedanceV2._renderList = function() { if (this._standaloneMode) this.renderStandaloneList(); else this.renderProjectList(); };
    // 闭环: 组装器 → 回写场景模版
    // 弹出更新模版选择窗口
    App.seedanceV2._showUpdateTemplatePopup = function(projectId, templateId) {
        // 移除已有弹窗
        var old = document.getElementById('s2UpdateTplPopup');
        if (old) old.remove();
        var overlay = document.createElement('div'); overlay.id = 's2UpdateTplPopup';
        overlay.className = 's2-popup-overlay';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = '<div class="s2-popup-card" style="max-width:360px;padding:24px;border-radius:12px;background:var(--bg-card);box-shadow:0 20px 60px rgba(0,0,0,0.25);">'
            + '<h4 style="margin:0 0 6px;">📋 场景模版操作</h4>'
            + '<p style="font-size:12px;color:var(--text-muted);margin:0 0 16px;">请选择如何处理当前组装的提示词：</p>'
            + '<div style="display:flex;flex-direction:column;gap:10px;">'
            + '<button class="btn btn-primary" style="padding:10px 16px;font-size:14px;" onclick="App.seedanceV2._doUpdateTemplate(' + projectId + ',' + templateId + ')">🔄 更新内容 — 覆盖原模版</button>'
            + '<button class="btn btn-outline" style="padding:10px 16px;font-size:14px;color:#7c3aed;border-color:#7c3aed;" onclick="App.seedanceV2._doDuplicateTemplate(' + projectId + ',' + templateId + ')">📄 新建副本 — 另存为新模版</button>'
            + '<button class="btn btn-sm btn-outline" style="margin-top:4px;" onclick="document.getElementById(\'s2UpdateTplPopup\').remove()">取消</button>'
            + '</div></div>';
        document.body.appendChild(overlay);
    };
    // 更新原模版内容
    App.seedanceV2._doUpdateTemplate = async function(projectId, templateId) {
        document.getElementById('s2UpdateTplPopup')?.remove();
        App.showToast('正在更新模版...', 'info');
        var content = document.getElementById('s2Output')?.value?.trim();
        if (!content) {
            await this.saveProject();
            var resp = await App.fetchJSON('/api/seedance/v2/projects/' + projectId + '/compose', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ format: 'seedance', density: 'standard' })
            });
            if (!resp || !resp.text) { App.showToast(App._t('auto.str_b9f0c81b', '组装未完成'), 'error'); return; }
            content = resp.text;
        }
        var scene = (this.currentProject && this.currentProject.global_style) || '';
        var d = await App.fetchJSON('/api/seedance/v2/projects/' + projectId + '/update-template', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content, scene: scene })
        });
        if (d && d.ok) {
            App.showToast(App._t('auto.str_4f328245', '✅ 模版已更新！刷新模版列表即可查看'), 'success');
        } else {
            App.showToast('更新未完成：' + (d ? (d.detail || '无响应') : '无响应'), 'error');
        }
    };
    // 新建模版副本
    App.seedanceV2._doDuplicateTemplate = async function(projectId, templateId) {
        document.getElementById('s2UpdateTplPopup')?.remove();
        App.showToast('正在创建副本...', 'info');
        var content = document.getElementById('s2Output')?.value?.trim();
        if (!content) {
            await this.saveProject();
            var resp = await App.fetchJSON('/api/seedance/v2/projects/' + projectId + '/compose', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ format: 'seedance', density: 'standard' })
            });
            if (!resp || !resp.text) { App.showToast(App._t('auto.str_b9f0c81b', '组装未完成'), 'error'); return; }
            content = resp.text;
        }
        var scene = (this.currentProject && this.currentProject.global_style) || '';
        var d = await App.fetchJSON('/api/seedance/v2/projects/' + projectId + '/update-template', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content, scene: scene, duplicate: true })
        });
        if (d && d.ok) {
            App.showToast('✅ 已创建模版副本 (ID: ' + d.new_template_id + App._t('auto.str_6e05595c', ')，刷新模版列表即可查看'), 'success');
        } else {
            App.showToast('创建副本未完成：' + (d ? (d.detail || '无响应') : '无响应'), 'error');
        }
    };
    // [DEPRECATED] 旧 updateTemplate 已被 _doUpdateTemplate 替代
    App.seedanceV2.updateTemplate = function(projectId, templateId) {
        App.seedanceV2._showUpdateTemplatePopup(projectId, templateId);
    };
    App.seedanceV2.openProject=async function(id){this.currentProjectId=id;try{localStorage.setItem('promptkit_seedance_project',id);localStorage.setItem('promptkit_view','seedance');localStorage.setItem('promptkit_seedance_tab','composer');}catch(e){}try{var d=await App.fetchJSON('/api/seedance/v2/projects/'+id);if(!d){App.showToast('加载项目失败: 无响应','error');return;}this.currentProject=d.project;if(window.PK_PRESENCE)PK_PRESENCE.reportLocation('分镜',d.project.name||'',d.project.id||0);this.scenes=d.scenes;this._restoreExtUnitConfig();var editor=document.getElementById('s2Editor');var savedScroll=editor?editor.scrollTop:0;this._renderList();this.renderProjectEditor();this.renderScenes();this.compose();var self=this;requestAnimationFrame(function(){var e=document.getElementById('s2Editor');if(e&&savedScroll>0)e.scrollTop=savedScroll;});}catch(e){App.showToast('加载项目异常: '+e.message,'error');console.warn('openProject error:',e);}};
    App.seedanceV2.saveProject = async function(){
        if(!this.currentProjectId)return;
        if(this._saving){App.showToast('正在保存，请稍后','warning');return;}
        this._saving=true;
        var d={};
        var fields=['name','total_duration','aspect_ratio','resolution','global_style','global_transition','negative_prompt'];
        for(var i=0;i<fields.length;i++){
            var f=fields[i];
            var e=document.getElementById('s2_'+f);
            if(e&&e.value!==undefined)d[f]=e.value;
        }
        // checkbox: 用 checked 而非 value
        var cb=document.getElementById('s2_audio_enabled');
        if(cb)d['audio_enabled']=cb.checked;
        var self=this;
        try{
            var result=await App.fetchJSON('/api/seedance/v2/projects/'+this.currentProjectId,{
                method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)
            });
            if(result&&result.ok){
                if(this.currentProject&&d.name)this.currentProject.name=d.name;
                await this.loadProjects();
                this.renderProjectList();
                App.showToast(App._t('auto.str_f8dfedcd', '已保存'),'success');
            }else{
                var errMsg=(result&&result.detail)?result.detail:((result&&result.error)?result.error:'无响应');
                App.showToast('保存未完成，稍后再试: '+errMsg,'error');
            }
        }catch(e){
            App.showToast('保存异常: '+e.message,'error');
        }
        this._saving=false;
    };

    App.seedanceV2.showProjectDelPopover = function(btnEl,pid){var pv=document.getElementById('s2ProjectDelPop');if(!pv)return;var r=btnEl.getBoundingClientRect();pv.dataset.projectId=pid;pv.style.position='fixed';pv.style.left=Math.max(4,r.left-140)+'px';pv.style.top=(r.bottom+4)+'px';pv.style.display='flex';var confirm=pv.querySelector('.s2-del-proj-confirm');var cancel=pv.querySelector('.s2-proj-del-cancel');if(confirm)confirm.onclick=function(){App.seedanceV2.confirmDeleteProject(pid);pv.style.display='none';};if(cancel)cancel.onclick=function(){pv.style.display='none';};};
    App.seedanceV2.quickDeleteProject = function(id){this.deleteProject(id);};
    App.seedanceV2.toggleBatchDelete = function(){var c=document.querySelectorAll('.s2-project-check:checked');var b=document.getElementById('s2BatchDelHeader');if(b)b.style.display=c.length>0?'inline-flex':'none';};
    App.seedanceV2.batchDeleteProjects = function(){var c=document.querySelectorAll('.s2-project-check:checked');if(!c.length||!confirm(App._t('common.ok', '确定删除选中的 ')+c.length+' 个项目？'))return;var ids=[];for(var i=0;i<c.length;i++)ids.push(parseInt(c[i].dataset.pid));var self=this;(async function(){for(var j=0;j<ids.length;j++)await App.fetchJSON('/api/seedance/v2/projects/'+ids[j],{method:'DELETE'});await self.loadProjects();self.renderProjectList();if(self.currentProjectId&&ids.indexOf(self.currentProjectId)>=0){self.currentProjectId=null;self.currentProject=null;self.scenes=[];self.renderComposerEmpty();}App.showToast(App._t('auto.str_023f5967', '已删除 ')+ids.length+' 个项目','info');})();};

    App.seedanceV2.toggleSidebar = function() {
        var sb = document.querySelector('.s2-sidebar'); 
        var tg = document.querySelector('.s2-sidebar-toggle');
        if (!sb || !tg) return;
        var collapsed = sb.classList.toggle('collapsed');
        tg.textContent = collapsed ? '▶' : '◀';
        tg.title = collapsed ? App._t('auto.str_e5eaa7d6', '展开项目列表') : App._t('auto.str_b50da652', '折叠项目列表');
        try { localStorage.setItem('promptkit_s2_sidebar', collapsed?'1':'0'); } catch(e) {}
    };
    App.seedanceV2._restoreSidebar = function() {
        try { if (localStorage.getItem('promptkit_s2_sidebar')==='1') { var sb=document.querySelector('.s2-sidebar'); var tg=document.querySelector('.s2-sidebar-toggle'); if(sb){sb.classList.add('collapsed');} if(tg){tg.textContent='▶';tg.title=App._t('auto.str_e5eaa7d6', '展开项目列表');} } } catch(e) {}
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
    // 右侧面板折叠/展开（按钮独立于面板，与左侧sidebar-toggle完全对称）
    App.seedanceV2.toggleRightPanel = function() {
        var panel = document.getElementById('s2RightPanel');
        var btn = document.getElementById('s2RightToggle');
        if (!panel || !btn) return;
        var isCollapsed = panel.classList.toggle('collapsed');
        btn.textContent = isCollapsed ? '◀' : '▶';
        btn.title = isCollapsed ? App._t('auto.str_8148a472', '展开词库面板') : App._t('auto.str_9ba7dc33', '折叠词库面板');
        try { localStorage.setItem('promptkit_s2_right_panel', isCollapsed ? '1' : '0'); } catch(e) {}
    };
    // 恢复右侧面板状态
    App.seedanceV2._restoreRightPanel = function() {
        try {
            var v = localStorage.getItem('promptkit_s2_right_panel');
            // 默认折叠，仅当上次显式展开时才保持展开
            if (v !== '1') {
                var panel = document.getElementById('s2RightPanel');
                var btn = document.getElementById('s2RightToggle');
                if (panel) panel.classList.add('collapsed');
                if (btn) { btn.textContent = '◀'; btn.title = App._t('auto.str_8148a472', '展开词库面板'); }
            }
        } catch(e) {}
    };
    App.seedanceV2._openRightPicker = function(sid, field) {
        App.seedanceV2.activeSceneId = sid;
        App.seedanceV2.activeField = field;
        var panel = document.getElementById('s2RightPanel');
        if (!panel) return;
        // 如果面板折叠，自动展开
        if (panel.classList.contains('collapsed')) {
            App.seedanceV2.toggleRightPanel();
        }
        var dimKey = App.seedanceV2._fieldToDim && App.seedanceV2._fieldToDim[field] ? App.seedanceV2._fieldToDim[field] : field;
        var foundLib = null;
        for (var li = 0; li < App.seedanceV2.libraries.length; li++) {
            var lib = App.seedanceV2.libraries[li];
            if (lib.dimension_key === dimKey || lib.dimension_key === field) { foundLib = lib; break; }
        }
        // 兜底：如果 dimension_key 不匹配，尝试用字段名直接匹配 name
        if (!foundLib) {
            for (var li2 = 0; li2 < App.seedanceV2.libraries.length; li2++) {
                var lib2 = App.seedanceV2.libraries[li2];
                if (lib2.dimension_name === field || lib2.dimension_name.indexOf(field) >= 0) { foundLib = lib2; break; }
            }
        }
        if (!foundLib) { App.showToast('未找到对应词库: '+field, 'warning'); return; }
        App.seedanceV2.activePickerLibId = foundLib.id;
        App.seedanceV2._renderRightPickerContent(foundLib);
    };
    App.seedanceV2._closeRightPicker = function() {
        // 不再关闭面板，只清空当前选中（面板始终存在）
        App.seedanceV2.activePickerLibId = null;
    };
    App.seedanceV2._renderRightPickerContent = async function(lib) {
        var panel = document.getElementById('s2RightPanel');
        if (!panel) return;
        var activeLibId = lib.id;
        await App.seedanceV2.loadCards(activeLibId);
        var cards = App.seedanceV2.cardCache[activeLibId] || [];
        var scene = App.seedanceV2._getCurrentScene();
        var fieldVal = scene ? (scene[App.seedanceV2.activeField] || '').trim() : '';
        var self = App.seedanceV2;

        // 顶部：关闭按钮
        var panelField = self._F[self.activeField]||'';
        var isCustom = lib.category === 'custom';
        var titleName = isCustom ? (lib.dimension_name||App._t('auto.custom_', '自定义')) : (panelField || lib.dimension_name||'选词');
        var targetHint = isCustom && panelField ? ' → '+panelField : '';
        // 工具栏：简洁标题
        var h = '<div class="s2-panel-toolbar"><div><strong>✏️ '+App._escape(titleName)+'</strong><span style="font-size:10px;color:var(--text-muted);margin-left:4px;">'+App._escape(targetHint)+'</span></div><div style="display:flex;gap:4px;">';
        h += '<button class="btn btn-xs btn-outline" onclick="App.seedanceV2._openGroupCreator()" title="新建自定义分组">+分组</button>';
        h += '</div></div>';
        
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
            var sn = (bl.dimension_name || '').replace(App._t('auto.str_dd745fe3', '词库'),'').replace(App._t('auto.str_3bdd08ad', '描述'),'').substring(0,6);
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
                var esn = (elib.dimension_name || '').replace(App._t('auto.str_dd745fe3', '词库'),'').replace(App._t('auto.str_3bdd08ad', '描述'),'').substring(0,6);
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
                var injectValue = word;  // 使用词条名填充，与字段值做精确匹配（定义文本太长会导致 indexOf 误判）
                var isSelected = fieldVal && injectValue && fieldVal.trim() && (fieldVal.indexOf(injectValue) >= 0 || injectValue.indexOf(fieldVal) >= 0);
                var pt=card.preview_image?'/api/seedance/v2/thumbnails/'+card.preview_image:'';
                var vt=card.preview_video?'/api/seedance/v2/videos/'+card.preview_video:'';
                var hasMedia=pt||vt;
                h += '<div class="s2-right-card-item'+(isSelected?' selected':'')+'" data-word="'+App._escape(injectValue)+'" data-card-id="'+card.id+'" data-video="'+(vt||'')+'" onclick="App.seedanceV2._pickRightWord(this)" style="display:flex;gap:8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;margin-bottom:4px;cursor:pointer;transition:0.12s;'+(isSelected?'background:rgba(16,185,129,0.08);border-color:#10b981;':'')+'" onmouseenter="App.seedanceV2._thumbHoverIn(this)" onmouseleave="App.seedanceV2._thumbHoverOut(this)">';
                h += '<div class="s2-card-thumb-zone" data-card-id="'+card.id+'" onclick="event.stopPropagation();App.seedanceV2._pickFileForCard('+card.id+')" style="cursor:pointer;" title="右键: 预览选择 | 替换预览 | 移除预览">';
                if(vt){
                    h += '<video src="'+vt+'" muted loop preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;"></video>';
                    h += '<span style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:#fff;font-size:8px;padding:1px 4px;border-radius:2px;pointer-events:none;">VID</span>';
                }else if(pt){
                    h += '<img src="'+pt+'" style="width:100%;height:100%;object-fit:cover;pointer-events:none;" loading="lazy">';
                }else{
                    h += '<span class="s2-thumb-placeholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;" title="点击/拖入/粘贴上传预览">+</span>';
                }
                h += '</div>';
                h += '<div style="flex:1;min-width:0;">';
                h += '<div style="font-size:13px;font-weight:600;">'+App._escape(word)+'</div>';
                if (def) h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+App._escape(def.substring(0,80))+'</div>';
                h += '</div>';
                // 自定义词条显示编辑/删除按钮（非系统词卡）
                if(!card.is_system){
                    h += '<div style="flex-shrink:0;display:flex;gap:2px;margin-left:4px;">';
                    h += '<span onclick="event.stopPropagation();App.seedanceV2._editCustomCard('+card.id+',\''+App._escape(word)+'&quot;,&quot;'+App._escape(def)+'\')" title="编辑词条" style="cursor:pointer;font-size:12px;opacity:0.5;" onmouseover="this.style.opacity=\'1\'" onmouseout="this.style.opacity=\'0.5\'">✏️</span>';
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
        h += '<div style="margin-top:8px;text-align:center;font-size:11px;color:var(--text-muted);padding:4px 0;">💡 右键词卡缩略图 → 预览选择 / 替换 / 移除<br><button class="btn btn-xs btn-outline" style="font-size:10px;padding:2px 8px;display:none;">📁 从媒体库选取</button></div>';
        // 写入面板内部容器
        var inner = document.getElementById('s2PanelInner');
        if (inner) inner.innerHTML = h;
        else panel.innerHTML = h;
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
        var currentVal = (scene[App.seedanceV2.activeField] || '').trim().trim();
        // 判断当前值是「词卡拼接」（逗号分隔）还是「模板长文本」
        var isComposite = currentVal.indexOf(',') >= 0 || currentVal.length <= 20;
        if (isComposite && currentVal.indexOf(word) >= 0) {
            // 已选则移除
            currentVal = currentVal.replace(word, '').replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();
        } else if (isComposite && currentVal) {
            // 词卡模式下追加
            currentVal = currentVal + ', ' + word;
        } else {
            // 模板长文本或空字段 → 直接替换为词卡值
            currentVal = word;
        }
        scene[App.seedanceV2.activeField] = currentVal;
        App.seedanceV2.updateSceneField(App.seedanceV2.activeSceneId, App.seedanceV2.activeField, currentVal);
        App.seedanceV2._refreshRightSelection();
        App.seedanceV2.compose();
    };
    App.seedanceV2._refreshRightSelection = function() {
        var scene = App.seedanceV2._getCurrentScene();
        var fieldVal = scene ? (scene[App.seedanceV2.activeField] || '').trim() : '';
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
        var h='<div class="s2-project-header"><h5>📋 我的分镜组</h5><div class="s2-header-actions"><button class="btn btn-sm btn-danger s2-batch-del-btn" id="s2BatchDelHeader" onclick="App.seedanceV2.batchDeleteProjects()" style="display:none;">🗑 批量删除</button><button class="btn btn-sm btn-primary" onclick="App.seedanceV2.createProject()">+ 新建</button></div></div>';
        if(!this.projects.length){h+='<div class="s2-empty">暂无项目，点击新建开始</div>';} else{for(var i=0;i<this.projects.length;i++){var p=this.projects[i],a=p.id===this.currentProjectId?' s2-project-active':'';h+='<div class="s2-project-item'+a+'" data-pid="'+p.id+'"><label class="s2-project-check-wrap" onclick="event.stopPropagation()"><input type="checkbox" class="s2-project-check" data-pid="'+p.id+'" onchange="App.seedanceV2.toggleBatchDelete()"></label><div class="s2-project-info" onclick="App.seedanceV2.openProject('+p.id+')"><div class="s2-project-name">'+App._escape(p.name||'未命名')+'</div><div class="s2-project-meta">'+p.scene_count+App._t('auto.str_07b7fbf5', '镜头 \u00b7 ')+(p.total_duration||15)+'s'+(p.master_project_name?' <span style="color:var(--text-muted);font-size:10px;">\u00b7 '+App._escape(p.master_project_name)+'</span>':'')+'</div></div><button class="s2-project-del" onclick="event.stopPropagation();App.seedanceV2.showProjectDelPopover(this,'+p.id+')">\u2716</button></div>';}}
        c.innerHTML=h;
        var self = this;
        document.querySelectorAll('.s2-project-name').forEach(function(el) {
            el.addEventListener('dblclick', async function(e) {
                e.stopPropagation();
                var pid = parseInt(this.closest('.s2-project-item').dataset.pid);
                var oldName = this.textContent.trim();
                var newName = prompt(App._t('common.edit', '编辑项目名称：'), oldName);
                if (newName && newName.trim() && newName.trim() !== oldName) {
                    await self._renameProject(pid, newName.trim());
                }
            });
        });
    };

    // 编辑器
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
        h+='<div style="font-size:12px;color:var(--text-muted);margin-top:4px;"><span>已分配: <strong>'+(p.total_dur_input||0)+'</strong>s / <strong>'+p.total_duration+'</strong>s</span><span style="margin-left:12px;'+(rm<=0?'color:#ef4444;':'')+'">剩余: <strong>'+Math.max(0,rm)+'</strong>s</span></div></div></div>';
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
        h+='<button class="btn btn-sm btn-secondary" onclick="App.seedanceV2.resetProject()"> 重置</button>';
        h+='</div>';
        h+='<textarea id="s2Output" class="s2-output-text" readonly placeholder="切换镜头字段后实时合成…"></textarea>';
        h+='<div id="s2OutputMeta" style="font-size:11px;color:var(--text-muted);margin-top:4px;"></div></div>';
        c.innerHTML=h;
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

        },100);
        // v9.3: 每次渲染镜头卡片后刷新时间轴
        this._refreshTimeline();
    };

    App.seedanceV2.renderSceneCard = function(scene,idx){
        var s=scene; var F={'camera_move':App._t('auto.str_4abc8a41', '运镜'),'subject':'主体','scene_desc':App._t('auto.str_c931653c', '场景'),'composition':App._t('auto.str_c38d3f3b', '构图'),'lighting':'光影','action':'动作','focal_length':'焦段','texture':'质感','speed':'速率','emotion':'情绪','color_grade':'调色','weather':'天气','particles':'粒子','perspective':'视角','depth_of_field':'景深','filter':'滤镜','natural_force':'外力','environment_detail':'环境','film_flaw':'瑕疵','fantasy_physics':'奇幻'};
        var h='<div class="s2-scene-card" data-scene-id="'+s.id+'" data-scene-order="'+(idx+1)+'">';
        var dotColor=App.seedanceV2._sceneColor(s.id);
        h+='<div class="s2-drag-handle" draggable="true" title="拖拽排序" style="border-top:4px solid '+dotColor+';padding-top:2px;"><span class="s2-drag-icon">\u2e3f</span></div>';
        h+='<div class="s2-scene-header"><div class="s2-scene-title"><span class="s2-scene-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+dotColor+App._t('auto.str_6d65e37d', ';margin-right:6px;vertical-align:middle;flex-shrink:0;" title="镜头')+(idx+1)+'"></span><strong onclick="event.stopPropagation();App.seedanceV2._toggleSceneCard('+s.id+')" style="cursor:pointer;" title="点击折叠/展开"><span class="s2-scene-fold-arrow">▼</span> 镜头 '+(idx+1)+'</strong> <span class="s2-time-badge">'+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span></div><div class="s2-scene-actions">';
        h+='<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.insertScene('+s.id+',&apos;before&apos;)">\u2b06插入</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.insertScene('+s.id+',&apos;after&apos;)">\u2b07插入</button>';
        h+='<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2.duplicateScene('+s.id+')">📋复制</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._copyScene('+s.id+')" title="拷贝提示词">📝拷贝</button><button class="btn btn-xs btn-outline s2-clear-btn" data-scene-id="'+s.id+'" title="清除所有字段" style="color:#ef4444;border-color:#ef4444;">🗑清除</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._pasteScene('+s.id+')" title="粘贴提示词">📄粘贴</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._exportScene('+s.id+')" title="导出镜头">📤导出</button><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();App.seedanceV2._importScene('+s.id+')" title="导入镜头">📥导入</button><button class="btn btn-xs btn-outline s2-review-btn" style="color:#8b5cf6;border-color:#8b5cf6;" onclick="event.stopPropagation();App.seedanceV2.openSceneReview('+s.id+')" title="审阅">📖审阅</button><button class="btn btn-xs btn-danger s2-del-btn" data-scene-id="'+s.id+'" title="删除此镜头">🗑</button></div></div>';
        // 折叠后第二行：纯文本单行省略
        var plainText = App.seedanceV2._scenePlainText(s);
        h+='<div class="s2-scene-collapsed-text" title="'+App._escape(plainText)+'">'+App._escape(plainText)+'</div>';
        h+='<div class="s2-scene-body s2-scene-body-compact"><div class="s2-scene-time"><span class="s2-time-label">\u23f1 '+parseInt(s.start_time)+'-'+parseInt(s.end_time)+'s</span>';        h+='<input class="s2-scene-dur s2-time-input'+(s.is_locked?' s2-dur-manual':'')+'" type="number" min="0.5" max="15" step="0.5" onblur="if(parseFloat(this.value)<0.5)this.value=0.5;if(parseFloat(this.value)>15)this.value=15;" value="'+(s.duration||3)+'" data-scene-id="'+s.id+'" title="'+(s.is_locked?'🔒 已锁定':'🔓 未锁定')+'">';
        h+='<select class="s2-dur-preset" data-target-scene="'+s.id+'" onchange="App.seedanceV2.applyDurPreset(this)"><option value="">\u25bc</option>';
        var P=[0.5,1,1.5,2,2.5,3,4,5,6,7,8,9,10,12,15];for(var pi=0;pi<P.length;pi++){var sel=Math.abs(P[pi]-(s.duration||3))<0.01?' selected':'';h+='<option value="'+P[pi]+'"'+sel+'>'+P[pi]+'</option>';}
        h+='</select><span class="s2-dur-label">秒</span><button class="s2-lock-btn'+(s.is_locked?' s2-locked':'')+'" data-scene-id="'+s.id+'" title="'+(s.is_locked?'点击解锁时长':'点击锁定时长')+'"><span class="s2-lock-icon"></span></button></div>';
        h+='<div class="s2-scene-fields s2-scene-fields-compact"><div class="s2-field-group"><span class="s2-field-label">基础</span>';
        ['camera_move','subject','scene_desc','composition','lighting'].forEach(function(f){var v=s[f]||'',n=F[f]||f;h+='<span class="s2-field-chip '+(v?'s2-filled':'s2-empty')+'" data-scene-id="'+s.id+'" data-field="'+f+'"><span class="s2-chip-label">'+n+'</span><span class="s2-chip-val">'+(v.length>10?v.substring(0,10)+'..':(v||'+'))+'</span></span>';});
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
            } else if (card && card.preview_image) {
                html += '<img src="/api/seedance/v2/thumbnails/'+card.preview_image+'" style="width:100%;height:auto;border-radius:6px;">';
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
