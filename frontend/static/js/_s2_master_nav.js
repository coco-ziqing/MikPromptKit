// _s2_master_nav.js — Phase37 分镜组装器树状结构：总项目→分镜组两级导航
// 零删除覆盖模式，20KB 轻量注入
(function(){'use strict';if(!App.seedanceV2||App.seedanceV2._s2MasterNavDone)return;
var S=App.seedanceV2;
S._currentMasterId=null;S._masterProjects=[];S._masterOrphans=[];

// ── loadMasterProjects ──
S.loadMasterProjects=async function(){
var d=await App.fetchJSON('/api/seedance/v2/master-projects');
if(d){this._masterProjects=d.masters||[];this._masterOrphans=d.orphans||[];}
};

// ── navigateToMaster ──
S.navigateToMaster=async function(mid){
this._currentMasterId=mid;
try{localStorage.setItem('promptkit_seedance_master',mid);}catch(e){}
await this.loadProjects(mid);
this.renderProjectList(mid);
if(this.currentProjectId){
var found=false;
for(var i=0;i<this.projects.length;i++){if(this.projects[i].id===this.currentProjectId){found=true;break;}}
if(!found){this.currentProjectId=null;this.currentProject=null;this.scenes=[];this.renderComposerEmpty();}
}
};

// ── goBackToMasters ──
S.goBackToMasters=async function(){
this._currentMasterId=null;
try{localStorage.removeItem('promptkit_seedance_master');}catch(e){}
this.currentProjectId=null;this.currentProject=null;this.scenes=[];
this.renderComposerEmpty();
await this.loadMasterProjects();
await this.loadProjects(null);
this.renderProjectList();
};

// ── 覆盖 loadProjects ──
S._loadProjectsV36=S.loadProjects;
S.loadProjects=async function(masterId){
if(masterId===undefined)masterId=this._currentMasterId;
var url='/api/seedance/v2/projects?page_size=100';
if(masterId){url+='&master_project_id='+masterId;}
else if(masterId===null){url+='&orphaned=true';}
var d=await App.fetchJSON(url);
if(d)this.projects=d.items||[];
};

// ── 覆盖 createProject ──
S._createProjectV36=S.createProject;
S.createProject=async function(){
var n=prompt('分镜组名称:','新分镜组 '+(this.projects.length+1));
if(!n)return;
var body={name:n};
if(this._currentMasterId){body.master_project_id=this._currentMasterId;}
var d=await App.fetchJSON('/api/seedance/v2/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
if(d&&d.ok){
await this.loadMasterProjects();
await this.loadProjects();
this.renderProjectList();
this.openProject(d.id);
App.showToast('分镜组已创建','success');
}
};

// ── 覆盖 openProject ──
S._openProjectV36=S.openProject;
S.openProject=async function(id){
this.currentProjectId=id;
try{localStorage.setItem('promptkit_seedance_project',id);
if(this._currentMasterId)localStorage.setItem('promptkit_seedance_master',this._currentMasterId);
else localStorage.removeItem('promptkit_seedance_master');}catch(e){}
var d=await App.fetchJSON('/api/seedance/v2/projects/'+id);
if(d){this.currentProject=d;this.scenes=d.scenes||[];this.renderProjectEditor();}
};

// ── 覆盖 renderProjectList: 两级导航 ──
S._renderProjectListV36=S.renderProjectList;
S.renderProjectList=function(mid){
var c=document.getElementById('s2ProjectList');if(!c)return;
if(mid!==undefined)this._currentMasterId=mid||null;

if(this._currentMasterId){
// Level 1: 每次渲染前重新拉树（删除后自动刷新）
var c2=c,mid2=this._currentMasterId,pid2=this.currentProjectId;
(async function(){
await S.loadMasterProjects();
var mp=null;
for(var i=0;i<S._masterProjects.length;i++){if(S._masterProjects[i].id===mid2){mp=S._masterProjects[i];break;}}
var mpName=mp?mp.name:'总项目';
var subs=mp?(mp.sub_projects||[]):[];
var h='<div class="s2-project-header">';
h+='<button class="btn btn-xs btn-outline" onclick="App.seedanceV2.goBackToMasters()" style="margin-right:8px;">← 返回</button>';
h+='<h5 style="display:inline;">📁 '+App._escape(mpName)+'</h5>';
h+='<span style="font-size:11px;color:var(--text-muted);margin-left:8px;">'+subs.length+'个分镜组</span>';
h+='<button class="btn btn-sm btn-primary" style="float:right;" onclick="App.seedanceV2.createProject()">+ 新建</button>';
h+='</div>';
if(!subs.length){h+='<div class="s2-empty">暂无分镜组，点击新建开始</div>';}
else{for(var i=0;i<subs.length;i++){var p=subs[i],a=p.id===pid2?' s2-project-active':'';h+='<div class="s2-project-item'+a+'" data-pid="'+p.id+'"><label class="s2-project-check-wrap" onclick="event.stopPropagation()"><input type="checkbox" class="s2-project-check" data-pid="'+p.id+'" onchange="App.seedanceV2.toggleBatchDelete()"></label><div class="s2-project-info" onclick="App.seedanceV2.openProject('+p.id+')"><div class="s2-project-name">'+App._escape(p.name||'未命名')+'</div><div class="s2-project-meta">'+p.scene_count+'镜头 · '+(p.total_duration||15)+'s</div></div><button class="s2-project-del" onclick="event.stopPropagation();App.seedanceV2.showProjectDelPopover(this,'+p.id+')">✖</button></div>';}}c2.innerHTML=h;
})();
return;
}

// Level 0: 每次渲染前拉最新树数据（项目看板新建总项目后自动同步）
var self=this;
(async function(){
await self.loadMasterProjects();
var masters=self._masterProjects||[],orphans=self._masterOrphans||[];
var h='<div class="s2-project-header"><h5>📁 总项目</h5><span style="font-size:11px;color:var(--text-muted);">'+masters.length+'个</span></div>';
if(!masters.length&&!orphans.length){h+='<div class="s2-empty">暂无总项目，先在「项目」面板创建</div>';}
else{var colors=['#6366f1','#8b5cf6','#d946ef','#ec4899','#f97316','#eab308','#22c55e','#14b8a6'];
for(var i=0;i<masters.length;i++){var mp=masters[i],mc=colors[i%colors.length];h+='<div class="s2-project-item" data-master-id="'+mp.id+'"><div class="s2-project-info" onclick="App.seedanceV2.navigateToMaster('+mp.id+')"><span style="color:'+mc+';font-size:18px;margin-right:8px;">📁</span><div><div class="s2-project-name" style="font-weight:600;">'+App._escape(mp.name||'未命名')+'</div><div class="s2-project-meta">'+(mp.sub_count||0)+'分镜组 · '+(mp.total_scene_count||0)+'镜头</div></div></div></div>';}
if(orphans.length){h+='<div style="margin-top:16px;padding-top:12px;border-top:1px dashed var(--border-color);"><div class="s2-project-header"><h5 style="font-size:12px;color:var(--text-muted);">📋 未归类的分镜组</h5><span style="font-size:11px;color:var(--text-muted);">'+orphans.length+'个</span><button class="btn btn-sm btn-primary" style="float:right;margin-left:6px;" onclick="App.seedanceV2.createProject()">+ 新建</button></div>';
for(var j=0;j<orphans.length;j++){var p=orphans[j],a=p.id===self.currentProjectId?' s2-project-active':'';h+='<div class="s2-project-item'+a+'" data-pid="'+p.id+'"><label class="s2-project-check-wrap" onclick="event.stopPropagation()"><input type="checkbox" class="s2-project-check" data-pid="'+p.id+'" onchange="App.seedanceV2.toggleBatchDelete()"></label><div class="s2-project-info" onclick="App.seedanceV2.openProject('+p.id+')"><div class="s2-project-name">'+App._escape(p.name||'未命名')+'</div><div class="s2-project-meta">'+p.scene_count+'镜头 · '+(p.total_duration||15)+'s</div></div><button class="s2-project-del" onclick="event.stopPropagation();App.seedanceV2.showProjectDelPopover(this,'+p.id+')">✖</button></div>';}h+='</div>';}}c.innerHTML=h;
})();
};

// ── 装饰 renderProjectEditor: 面包屑 ──
S._renderProjectEditorV36=S.renderProjectEditor;
S.renderProjectEditor=function(){
this._renderProjectEditorV36();
var titleEl=document.querySelector('#s2Editor .s2-editor-title');
if(titleEl&&this._currentMasterId&&this._masterProjects){
var masterName='';
for(var i=0;i<this._masterProjects.length;i++){if(this._masterProjects[i].id===this._currentMasterId){masterName=this._masterProjects[i].name;break;}}
if(masterName&&!titleEl.querySelector('.s2-master-breadcrumb')){
var crumb=document.createElement('span');
crumb.className='s2-master-breadcrumb';
crumb.style.cssText='font-size:10px;color:var(--text-muted);display:block;margin-bottom:2px;';
crumb.textContent='📁 '+masterName;
titleEl.insertBefore(crumb,titleEl.firstChild);
}
}
};

// ── 初始化后首次加载树数据 ──
// 等待 init 的 _initPromise 完成后再补充加载
var _waitInterval=setInterval(function(){
if(S._initPromise){return;} // init 还在跑
if(App.fetchJSON===undefined){return;} // 还未完全初始化
clearInterval(_waitInterval);
// 现在 init 已跑完，补充加载树数据
var self=S;
async function _bootstrapTree(){
await self.loadMasterProjects();
var savedMid=null;try{savedMid=localStorage.getItem('promptkit_seedance_master');if(savedMid)savedMid=parseInt(savedMid);}catch(e){}
if(savedMid&&self._masterProjects.length){
// 恢复上次的 tree 上下文
self._currentMasterId=savedMid;
await self.loadProjects(savedMid);
self.renderProjectList(savedMid);
var savedPid=null;try{savedPid=localStorage.getItem('promptkit_seedance_project');if(savedPid)savedPid=parseInt(savedPid);}catch(e){}
if(savedPid){
var found=false;for(var i=0;i<self.projects.length;i++){if(self.projects[i].id===savedPid){found=true;break;}}if(found)self.openProject(savedPid);
}
}else{
// 进入总项目视图
self._currentMasterId=null;
await self.loadProjects();
self.renderProjectList();
}
}
setTimeout(_bootstrapTree, 300);
},100);

S._s2MasterNavDone=true;
console.log('[PK] Phase37 master navigation loaded');
})();
