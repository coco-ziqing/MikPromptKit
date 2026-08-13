// Seedance V2 多镜头结构化组装器 — 分片 core（状态字段 + 核心方法）
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
        // v5.36.27: 刷新后自动恢复上次打开的分镜项目（全局参数/视频参数不丢）
        try {
            var lastPid = localStorage.getItem('promptkit_seedance_project');
            if (lastPid) {
                var found = false;
                for (var li = 0; li < this.projects.length; li++) {
                    if (String(this.projects[li].id) === String(lastPid)) { found = true; break; }
                }
                if (found) this.openProject(parseInt(lastPid));
            }
        } catch (e) { console.warn('restore last project fail', e); }
        // 设置切换 tab 为 composer（v5.36.29 修复：switchSeedanceTab 定义在 App 上，this 是 seedanceV2）
        if (typeof App.switchSeedanceTab === 'function') App.switchSeedanceTab('composer');
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

    App.seedanceV2.openProject=async function(id){this.currentProjectId=id;this._loadVideoTaskCache();this._startVideoNotifyTimer();try{localStorage.setItem('promptkit_seedance_project',id);localStorage.setItem('promptkit_view','seedance');localStorage.setItem('promptkit_seedance_tab','composer');}catch(e){}try{var d=await App.fetchJSON('/api/seedance/v2/projects/'+id);if(!d){App.showToast('加载项目失败: 无响应','error');return;}this.currentProject=d.project;if(window.PK_PRESENCE)PK_PRESENCE.reportLocation('分镜',d.project.name||'',d.project.id||0);this.scenes=d.scenes;this._restoreExtUnitConfig();var editor=document.getElementById('s2Editor');var savedScroll=editor?editor.scrollTop:0;this._renderList();this.renderProjectEditor();this.renderScenes();this.compose();var self=this;requestAnimationFrame(function(){var e=document.getElementById('s2Editor');if(e&&savedScroll>0)e.scrollTop=savedScroll;});}catch(e){App.showToast('加载项目异常: '+e.message,'error');console.warn('openProject error:',e);}};

    App.seedanceV2.saveProject = async function(){
        if(!this.currentProjectId)return;
        if(this._saving){App.showToast('正在保存，请稍后','warning');return;}
        this._saving=true;
        var d={};
        var fields=['name','total_duration','aspect_ratio','resolution','global_style','global_transition','negative_prompt','video_model','video_resolution','video_session'];
        for(var i=0;i<fields.length;i++){
            var f=fields[i];
            var e=document.getElementById('s2_'+f);
            if(e&&e.value!==undefined)d[f]=e.value;
        }
        // checkbox: 用 checked 而非 value
        var cb=document.getElementById('s2_audio_enabled');
        if(cb)d['audio_enabled']=cb.checked;
        // v5.36.0: 即梦视频参数数值化
        if(d['video_session']!==undefined)d['video_session']=parseInt(d['video_session']||0);
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
                // 2026-08-11: 词库缩略图优先（wc_thumbnail，与词库预览图一致）；无则用旧 preview_image
                var pt = card.wc_thumbnail
                    ? '/api/thumbnails/file/' + card.wc_thumbnail
                    : (card.preview_image ? '/api/seedance/v2/thumbnails/' + card.preview_image : '');
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
})();
