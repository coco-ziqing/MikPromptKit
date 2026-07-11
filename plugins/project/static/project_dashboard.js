// PromptKit Project Manager v2.0.0 — Phase22 Master Project Architecture
// 三栏布局：总项目列表(左) + 7阶段面板(主) + 子项目/资产(右)
(function(){'use strict';

var PK = {
VERSION: '2.0.0',
_masterId: null,
_masterList: [],
_masterCache: {},
_activePhase: 'P0',
_selectedSubId: null,
_activeAssetTab: 'script',

_avatarEmojis: '🦊🐱🐶🐼🐨🐯🦁🐸🐵🐰🐻🐧🦄🐙🦉🐳🐬🦋🐞🐝🎨🎬🎧🎮💎🔥⭐🌈🎯'.split(''),
_avatarColors: '#7c3aed,#dc2626,#2563eb,#059669,#d97706,#db2777,#4f46e5,#0891b2,#ea580c,#65a30d,#6d28d9,#be123c'.split(','),

_apiBase: '/api/plugins/com.promptkit.project',

_isEN: function() { try { return (localStorage.getItem('promptkit_lang')||'zh-CN')==='en'; } catch(e) { return false; } },
_L: function(zh, en) { return this._isEN() ? (en||zh) : zh; },

open: function() {
  var vp = document.getElementById('viewProjectMgmt');
  if (!vp) {
    vp = document.createElement('div'); vp.id = 'viewProjectMgmt';
    vp.className = 'view-panel active-view'; vp.style.display = 'flex';
    var mc = document.getElementById('mainContent'); if (mc) mc.appendChild(vp);
  }
  document.querySelectorAll('#mainContent > .view-panel').forEach(function(p){p.style.display='none';});
  vp.style.display = 'flex';
  this._init();
},
close: function() {
  var vp = document.getElementById('viewProjectMgmt');
  if (vp) vp.style.display = 'none';
},

_init: async function() {
  var L = this._L.bind(this), self = this;
  var vp = document.getElementById('viewProjectMgmt'); if (!vp) return;
  vp.innerHTML = '<div class="pk-proj-sidebar" id="pkMasterList"><div class="pk-proj-sidebar-header"><h5>📦 '+L('总项目','Projects')+'</h5><button class="btn btn-sm btn-primary" onclick="PK_ProjectDashboard._showMasterForm()">+ '+L('新建','New')+'</button></div><div class="pk-proj-list" id="pkMasterListInner"><p style="padding:20px;color:var(--text-muted);">'+L('加载中...','Loading...')+'</p></div></div><div class="pk-proj-main" id="pkMasterMain"><div class="pk-master-welcome"><h4>📦 '+L('选择一个总项目开始','Select a Project')+'</h4><p>'+L('或创建新项目','or create new')+'</p></div></div>';
  await this._loadMasters();
},

// ============================================================
// API helpers
// ============================================================
_api: async function(path) { try { var r=await fetch(this._apiBase+path); return await r.json(); } catch(e) { return {ok:false}; } },
_apiPost: async function(path, data) { try { var r=await fetch(this._apiBase+path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}); return await r.json(); } catch(e) { return {ok:false}; } },
_apiPut: async function(path, data) { try { var r=await fetch(this._apiBase+path, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}); return await r.json(); } catch(e) { return {ok:false}; } },
_apiDelete: async function(path) { try { var r=await fetch(this._apiBase+path, {method:'DELETE'}); return await r.json(); } catch(e) { return {ok:false}; } },
_toast: function(msg, type) { if (typeof App!=='undefined' && App.showToast) App.showToast(msg, type); },
_esc: function(s) { if (!s) return ''; var d=document.createElement('div'); d.textContent=s; return d.innerHTML; },
_overlay: function() { var o=document.createElement('div'); o.className='pk-modal-overlay'; o.onclick=function(e){if(e.target===o)o.remove();}; return o; },

// ============================================================
// Master list
// ============================================================
_loadMasters: async function() {
  var r = await this._api('/master/list');
  this._masterList = r.projects||[];
  this._renderMasterList();
  if (this._masterId) this._selectMaster(this._masterId);
  else if (this._masterList.length>0) this._selectMaster(this._masterList[0].id);
},
_renderMasterList: function() {
  var c = document.getElementById('pkMasterListInner'), L = this._L.bind(this), self = this;
  if (!c) return;
  if (!this._masterList.length) { c.innerHTML='<div class="pk-empty-state" style="padding:40px 20px;"><p>'+L('暂无总项目','No projects')+'</p><button class="btn btn-sm btn-primary mt-2" onclick="PK_ProjectDashboard._showMasterForm()">'+L('创建第一个项目','Create')+'</button></div>'; return; }
  var h = '';
  this._masterList.forEach(function(p) {
    var act = p.id===self._masterId?' active':'';
    var typeIcon = {short_film:'🎬',ad:'📢',mv:'🎵',tutorial:'📚',other:'📁'}[p.project_type]||'📁';
    var stIcon = {draft:'📝',in_progress:'⚙',review:'🔍',completed:'✅'}[p.status]||'📝';
    h += '<div class="pk-proj-item'+act+'" data-pid="'+p.id+'"><div class="pk-proj-item-info" onclick="PK_ProjectDashboard._selectMaster('+p.id+')"><div class="pk-proj-item-icon">'+typeIcon+'</div><div class="pk-proj-item-name">'+self._esc(p.name||L('未命名','Unnamed'))+'</div><div class="pk-proj-item-meta">'+(p.sub_count||0)+' '+L('分段','seg')+' · '+(p.asset_count||0)+' '+L('资产','assets')+'</div></div><div class="pk-proj-item-actions"><button class="pk-proj-action-btn" onclick="event.stopPropagation();PK_ProjectDashboard._showMasterForm('+p.id+')" title="'+L('编辑','Edit')+'">✏️</button><button class="pk-proj-action-btn pk-proj-action-del" onclick="event.stopPropagation();PK_ProjectDashboard._deleteMaster('+p.id+')" title="'+L('删除','Delete')+'">🗑</button></div></div>';
  });
  c.innerHTML = h;
},

_showMasterForm: function(id) {
  var L = this._L.bind(this), self = this, isNew = !id;
  var p = id ? this._masterList.find(function(x){return x.id===id;})||{} : {};
  var types = [{v:'short_film',zh:'🎬 短片',en:'🎬 Short Film'},{v:'ad',zh:'📢 广告',en:'📢 Ad'},{v:'mv',zh:'🎵 MV',en:'🎵 MV'},{v:'tutorial',zh:'📚 教程',en:'📚 Tutorial'},{v:'other',zh:'📁 其他',en:'📁 Other'}];
  var tOpts = types.map(function(t){ return '<option value="'+t.v+'"'+((p.project_type||'short_film')===t.v?' selected':'')+'>'+L(t.zh,t.en)+'</option>'; }).join('');
  var ov = self._overlay();
  ov.innerHTML = '<div class="pk-modal" onclick="event.stopPropagation()"><h4>'+(isNew?L('📦 创建总项目','Create Project'):L('📦 编辑项目','Edit Project'))+'</h4><div class="form-group"><label>✏ '+L('项目名称','Name')+'</label><input type="text" id="mf_name" value="'+self._esc(p.name||'')+'" autofocus></div><div class="form-group"><label>📄 '+L('描述','Description')+'</label><textarea id="mf_desc" rows="2" style="resize:vertical;">'+self._esc(p.description||'')+'</textarea></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;"><div class="form-group"><label>🏷 '+L('类型','Type')+'</label><select id="mf_type" style="width:100%;">'+tOpts+'</select></div><div class="form-group"><label>📐 '+L('画幅','Ratio')+'</label><select id="mf_ratio" style="width:100%;"><option value="16:9"'+(p.aspect_ratio!=='9:16'&&p.aspect_ratio!=='1:1'?' selected':'')+'>16:9</option><option value="9:16"'+(p.aspect_ratio==='9:16'?' selected':'')+'>9:16</option><option value="1:1"'+(p.aspect_ratio==='1:1'?' selected':'')+'>1:1</option></select></div><div class="form-group"><label>🖥 '+L('分辨率','Resolution')+'</label><select id="mf_res" style="width:100%;"><option value="4K"'+(p.resolution!=='1080p'?' selected':'')+'>4K</option><option value="1080p"'+(p.resolution==='1080p'?' selected':'')+'>1080p</option></select></div></div><div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">'+L('取消','Cancel')+'</button><button class="btn btn-primary" id="mf_save">'+L('保存','Save')+'</button></div></div>';
  document.body.appendChild(ov);
  document.getElementById('mf_save').onclick = async function() {
    var data = { name: document.getElementById('mf_name').value.trim(), description: document.getElementById('mf_desc').value.trim(), project_type: document.getElementById('mf_type').value, aspect_ratio: document.getElementById('mf_ratio').value, resolution: document.getElementById('mf_res').value };
    if (!data.name) { self._toast(L('请输入名称','Name required'),'warning'); return; }
    var r2;
    if (isNew) r2 = await self._apiPost('/master', data);
    else r2 = await self._apiPut('/master/'+id, data);
    if (r2.ok) { ov.remove(); self._toast(L('已保存','Saved'),'success'); await self._loadMasters(); if (isNew) self._selectMaster(r2.id||self._masterId); }
    else self._toast(L('保存失败','Failed'),'error');
  };
},

_deleteMaster: async function(id) {
  var L = this._L.bind(this);
  if (!confirm(L('确定删除此总项目？所有子项目和资产将被永久删除。','Delete this project? All sub-projects and assets will be permanently deleted.'))) return;
  var r = await this._apiDelete('/master/'+id);
  if (r.ok) { this._toast(L('已删除','Deleted'),'info'); this._masterId=null; this._masterCache={}; await this._loadMasters(); document.getElementById('pkMasterMain').innerHTML='<div class="pk-master-welcome"><h4>📦 '+L('选择一个总项目开始','Select a Project')+'</h4></div>'; }
},

_selectMaster: async function(id) {
  this._masterId = id; this._renderMasterList();
  var main = document.getElementById('pkMasterMain'); if (!main) return;
  var L = this._L.bind(this);
  main.innerHTML = '<div style="padding:40px;text-align:center;"><p>'+L('加载中...','Loading...')+'</p></div>';
  if (!this._masterCache[id]) {
    var r = await this._api('/master/'+id);
    this._masterCache[id] = r;
  }
  this._activePhase = 'P0';
  this._renderPhaseView();
},

// ============================================================
// 7-Phase tab navigation
// ============================================================
_renderPhaseView: function() {
  var main = document.getElementById('pkMasterMain'), L = this._L.bind(this), self = this;
  if (!main) return;
  var data = this._masterCache[this._masterId];
  if (!data||!data.project) { main.innerHTML = '<div class="pk-master-welcome"><p>'+L('加载失败','Load failed')+'</p></div>'; return; }
  var proj = data.project, stats = data.phase_stats||{};
  var phases = [
    {id:'P0',zh:'🧠 策划',en:'🧠 Plan'},
    {id:'P1',zh:'📝 预生产',en:'📝 Pre-prod'},
    {id:'P2',zh:'🎨 资产',en:'🎨 Assets'},
    {id:'P3',zh:'🎬 生产',en:'🎬 Production'},
    {id:'P4',zh:'✂ 后期',en:'✂ Post'},
    {id:'P5',zh:'✅ 交付',en:'✅ Delivery'},
    {id:'P6',zh:'📊 归档',en:'📊 Archive'}
  ];

  // Phase tab bar with progress
  var tabHTML = '';
  phases.forEach(function(ph) {
    var act = ph.id===self._activePhase?' active':'';
    var st = stats[ph.id]||{total:0,done:0};
    var pct = st.total>0 ? Math.round(st.done/st.total*100) : 0;
    var barColor = pct===100?'#10b981':pct>0?'#3b82f6':'transparent';
    tabHTML += '<button class="pk-phase-tab'+act+'" onclick="PK_ProjectDashboard._switchPhase(\''+ph.id+'\')"><span>'+L(ph.zh,ph.en)+'</span><div class="pk-phase-dot" style="background:'+barColor+';border:2px solid '+(barColor==='transparent'?'var(--border-color)':barColor)+';" title="'+st.done+'/'+st.total+'"></div></button>';
  });

  main.innerHTML = '<div class="pk-master-header"><div class="pk-master-title"><h4>'+self._esc(proj.name)+'</h4><span class="pk-master-meta">'+(proj.aspect_ratio||'16:9')+' · '+(proj.resolution||'4K')+' · '+(proj.project_type||'short_film')+'</span></div><div style="display:flex;gap:8px;"><button class="btn btn-sm btn-outline-secondary" onclick="PK_ProjectDashboard._showMasterForm('+self._masterId+')" title="'+L('编辑项目','Edit Project')+'">✏</button><button class="btn btn-sm btn-outline-secondary" onclick="PK_ProjectDashboard._refreshMaster()" title="'+L('刷新','Refresh')+'">🔄</button></div></div><div class="pk-phase-tabs">'+tabHTML+'</div><div class="pk-phase-content" id="pkPhaseContent"></div>';
  this._renderPhaseContent();
},
_switchPhase: function(ph) { this._activePhase=ph; this._renderPhaseView(); },
_refreshMaster: async function() {
  this._masterCache[this._masterId] = await this._api('/master/'+this._masterId);
  this._renderPhaseView();
},

_renderPhaseContent: function() {
  switch (this._activePhase) {
    case 'P0': this._renderP0_Plan(); break;
    case 'P1': this._renderP1_PreProd(); break;
    case 'P2': this._renderP2_Assets(); break;
    case 'P3': this._renderP3_Production(); break;
    case 'P4': this._renderP4_Post(); break;
    case 'P5': this._renderP5_Delivery(); break;
    case 'P6': this._renderP6_Archive(); break;
  }
},

// ============================================================
// P0 — 项目策划
// ============================================================
_renderP0_Plan: function() {
  var L = this._L.bind(this), self = this;
  var data = this._masterCache[this._masterId];
  var proj = data.project||{}, subs = data.sub_projects||[], assets = data.assets||[];
  var stats = data.phase_stats||{};

  // Advance stats
  var totalTasks = 0, doneTasks = 0;
  for (var k in stats) { totalTasks += stats[k].total; doneTasks += stats[k].done; }
  var pct = totalTasks>0 ? Math.round(doneTasks/totalTasks*100) : 0;
  var circ = 2*Math.PI*44, off = circ-(pct/100)*circ;

  var content = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;"><div class="pk-stat-card" style="grid-column:1/-1;"><div class="pk-stat-icon blue">📊</div><div class="pk-stat-body"><h3>'+proj.name+'</h3><p>'+(proj.description||L('暂无描述','No description'))+'</p></div></div>';

  // Progress ring
  content += '<div class="pk-stat-card" style="flex-direction:column;align-items:center;"><p style="font-size:12px;color:var(--text-muted);margin:0 0 8px;">'+L('总进度','Total Progress')+'</p><svg viewBox="0 0 100 100" style="width:100px;height:100px;"><circle cx="50" cy="50" r="44" fill="none" stroke="var(--border-color)" stroke-width="8"/><circle cx="50" cy="50" r="44" fill="none" stroke="#3b82f6" stroke-width="8" stroke-linecap="round" stroke-dasharray="'+circ+'" stroke-dashoffset="'+off+'" transform="rotate(-90 50 50)"/><text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="800" fill="var(--text-primary)">'+pct+'%</text></svg><p style="font-size:11px;color:var(--text-muted);margin-top:8px;">'+doneTasks+'/'+totalTasks+' '+L('任务','tasks')+'</p></div>';

  // Quick stats
  var stItems = [
    {label:L('分镜段落','Segments'), val:subs.length, icon:'🎬', color:'blue'},
    {label:L('资产总数','Assets'), val:assets.length, icon:'📚', color:'purple'},
    {label:L('项目类型','Type'), val:L({short_film:'短片',ad:'广告',mv:'MV',tutorial:'教程',other:'其他'}[proj.project_type]||proj.project_type, proj.project_type||'—'), icon:'🏷', color:'amber'},
    {label:L('状态','Status'), val:L({draft:'草稿',in_progress:'进行中',review:'审核中',completed:'已完成'}[proj.status]||proj.status, proj.status||'—'), icon:'📌', color:'green'}
  ];
  stItems.forEach(function(s){
    content += '<div class="pk-stat-card"><div class="pk-stat-icon '+s.color+'">'+s.icon+'</div><div class="pk-stat-body"><h3>'+s.val+'</h3><p>'+s.label+'</p></div></div>';
  });

  // Phase breakdown
  content += '<div class="pk-stat-card" style="grid-column:1/-1;flex-direction:column;"><p style="font-size:12px;font-weight:600;color:var(--text-primary);margin:0 0 12px;">📊 '+L('各阶段进度','Phase Progress')+'</p>';
  var phaseNames = {P0:L('前期策划','Ideation'),P1:L('预生产','Pre-prod'),P2:L('资产准备','Assets'),P3:L('分镜生产','Production'),P4:L('后期合成','Post'),P5:L('审核交付','Review'),P6:L('复盘归档','Archive')};
  for (var k in stats) {
    var s = stats[k];
    var phasePct = s.total>0?Math.round(s.done/s.total*100):0;
    content += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:12px;"><span style="width:80px;color:var(--text-primary);">'+phaseNames[k]+'</span><div style="flex:1;height:6px;border-radius:3px;background:var(--border-color);overflow:hidden;"><div style="height:100%;border-radius:3px;background:'+(phasePct===100?'#10b981':'#3b82f6')+';width:'+phasePct+'%;transition:width .4s;"></div></div><span style="width:32px;text-align:right;color:var(--text-muted);">'+phasePct+'%</span></div>';
  }
  content += '</div></div>';

  document.getElementById('pkPhaseContent').innerHTML = content;
},

// ============================================================
// P1 — 预生产（剧本编辑器）
// ============================================================
_renderP1_PreProd: async function() {
  var c = document.getElementById('pkPhaseContent'), L = this._L.bind(this), self = this;
  if (!c) return;
  var assets = await this._api('/master/'+this._masterId+'/assets?asset_type=script');
  var scripts = assets.assets||[];

  var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h5 style="margin:0;">📝 '+L('剧本编辑器','Script Editor')+'</h5><div style="display:flex;gap:8px;"><button class="btn btn-sm btn-primary" onclick="PK_ProjectDashboard._showAssetForm(\'script\')">+ '+L('新建剧本','New Script')+'</button></div></div>';

  if (!scripts.length) {
    c.innerHTML = h+'<div class="pk-empty-state"><p style="font-size:48px;display:block;margin-bottom:12px;">📝</p><h4>'+L('暂无剧本','No scripts')+'</h4><p>'+L('在此创建剧本、大纲、旁白文本','Create scripts, outlines, or narration')+'</p><button class="btn btn-primary mt-3" onclick="PK_ProjectDashboard._showAssetForm(\'script\')">+ '+L('创建第一个剧本','Create First Script')+'</button></div>';
    return;
  }

  // Script list with preview
  scripts.forEach(function(s, i) {
    h += '<div class="pk-asset-card" onclick="PK_ProjectDashboard._editAsset('+s.id+')"><div class="pk-asset-header"><span class="pk-asset-icon">📄</span><div class="pk-asset-info"><div class="pk-asset-name">'+self._esc(s.name)+'</div><div class="pk-asset-meta">'+(s.description||L('无描述','No description'))+'</div></div><div class="pk-asset-actions"><button class="pk-task-action-btn" onclick="event.stopPropagation();PK_ProjectDashboard._deleteAsset('+s.id+')" title="'+L('删除','Delete')+'">🗑</button></div></div>'+(s.content?'<div class="pk-asset-content">'+self._esc(s.content.substring(0,200))+(s.content.length>200?'...':'')+'</div>':'')+'</div>';
  });
  c.innerHTML = h;
},

// ============================================================
// P2 — 资产准备（角色/场景/词卡模板/参考图）
// ============================================================
_renderP2_Assets: async function() {
  var c = document.getElementById('pkPhaseContent'), L = this._L.bind(this), self = this;
  if (!c) return;
  var tabs = [
    {type:'character', zh:'👤 '+L('角色','Characters'), en:'👤 Characters'},
    {type:'scene', zh:'🌍 '+L('场景','Scenes'), en:'🌍 Scenes'},
    {type:'prompt_template', zh:'📋 '+L('词卡模板','Templates'), en:'📋 Templates'},
    {type:'ref_image', zh:'🖼 '+L('参考图','References'), en:'🖼 References'}
  ];
  var tabHTML = tabs.map(function(t){ var act=t.type===self._activeAssetTab?' active':''; return '<button class="pk-sub-tab'+act+'" onclick="PK_ProjectDashboard._switchAssetTab(\''+t.type+'\')">'+L(t.zh,t.en)+'</button>'; }).join('');
  var h = '<div class="pk-sub-tabs">'+tabHTML+'</div><div id="pkAssetContent" style="margin-top:16px;"></div>';
  c.innerHTML = h;
  this._renderAssetTab();
},
_switchAssetTab: function(type) { this._activeAssetTab=type; this._renderP2_Assets(); },
_renderAssetTab: async function() {
  var c = document.getElementById('pkAssetContent'), L = this._L.bind(this), self = this;
  if (!c) return;
  c.innerHTML = '<p style="color:var(--text-muted);">'+L('加载中...','Loading...')+'</p>';
  var r = await this._api('/master/'+this._masterId+'/assets?asset_type='+this._activeAssetTab);
  var assets = r.assets||[];
  var typeName = {character:L('角色','Character'),scene:L('场景','Scene'),prompt_template:L('词卡模板','Prompt Template'),ref_image:L('参考图','Reference Image')}[this._activeAssetTab]||'';
  var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h5 style="margin:0;">'+typeName+' <span style="font-size:12px;color:var(--text-muted);font-weight:400;">('+assets.length+')</span></h5><button class="btn btn-sm btn-primary" onclick="PK_ProjectDashboard._showAssetForm(\''+self._activeAssetTab+'\')">+ '+L('新建','New')+'</button></div>';
  if (!assets.length) {
    h += '<div class="pk-empty-state"><p>'+L('暂无资产','No assets')+'</p><button class="btn btn-sm btn-primary mt-2" onclick="PK_ProjectDashboard._showAssetForm(\''+self._activeAssetTab+'\')">'+L('创建','Create')+'</button></div>';
  } else {
    h += '<div class="pk-asset-grid">';
    assets.forEach(function(a){
      var icon = {character:'👤',scene:'🌍',prompt_template:'📋',ref_image:'🖼'}[a.asset_type]||'📄';
      h += '<div class="pk-asset-card" onclick="PK_ProjectDashboard._editAsset('+a.id+')"><div class="pk-asset-header"><span class="pk-asset-icon">'+icon+'</span><div class="pk-asset-info"><div class="pk-asset-name">'+self._esc(a.name)+'</div>'+(a.description?'<div class="pk-asset-meta">'+self._esc(a.description.substring(0,50))+'</div>':'')+'</div><div class="pk-asset-actions"><button class="pk-task-action-btn" onclick="event.stopPropagation();PK_ProjectDashboard._deleteAsset('+a.id+')" title="'+L('删除','Delete')+'">🗑</button></div></div>'+(a.image_path?'<div class="pk-asset-thumb"><img src="'+a.image_path+'" style="width:100%;border-radius:6px;max-height:120px;object-fit:cover;" onerror="this.style.display=\'none\'"></div>':'')+'</div>';
    });
    h += '</div>';
  }
  c.innerHTML = h;
},

// Asset form (shared for all types)
_showAssetForm: function(assetType) {
  var L = this._L.bind(this), self = this;
  var typeLabels = {script:L('文稿','Script'),character:L('角色','Character'),scene:L('场景','Scene'),prompt_template:L('词卡模板','Prompt Template'),ref_image:L('参考图','Reference Image'),bgm:L('背景音乐','BGM'),sfx:L('音效','SFX')};
  var typeName = typeLabels[assetType]||assetType;
  var ov = this._overlay();
  ov.innerHTML = '<div class="pk-modal pk-modal-2col" onclick="event.stopPropagation()"><h4>➕ '+L('新建资产','New Asset')+' — '+typeName+'</h4><div class="pk-edit-2col"><div class="pk-edit-left"><div class="form-group"><label>✏ '+L('名称','Name')+'</label><input type="text" id="af_name" autofocus></div><div class="form-group"><label>📄 '+L('描述','Description')+'</label><textarea id="af_desc" rows="2" style="resize:vertical;"></textarea></div><div class="form-group"><label>📝 '+L('内容','Content')+'</label><textarea id="af_content" rows="6" style="resize:vertical;" placeholder="'+L('剧本/提示词/描述文本...','Script/prompt/description text...')+'"></textarea></div></div><div class="pk-edit-right"><div class="form-group"><label>🖼 '+L('图片路径','Image path')+'</label><input type="text" id="af_image" placeholder="'+L('可选','Optional')+'"></div><div class="form-group"><label>🔗 '+L('关联子项目','Linked to sub')+'</label><select id="af_sub"><option value="">'+L('全局（不关联）','Global (none)')+'</option></select></div><div class="form-group"><label>🏷 '+L('标签（逗号分隔）','Tags (comma sep)')+'</label><input type="text" id="af_tags" placeholder="'+L('例：主角,日系,高细节','e.g. hero,japanese,detailed')+'"></div></div></div><div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">'+L('取消','Cancel')+'</button><button class="btn btn-primary" id="af_save">'+L('创建','Create')+'</button></div></div>';
  document.body.appendChild(ov);

  // Populate sub project selector
  this._api('/master/'+this._masterId+'/subs').then(function(r){
    var sel = document.getElementById('af_sub');
    (r.subs||[]).forEach(function(sp){ var o=document.createElement('option'); o.value=sp.id; o.textContent='🎬 '+sp.name; sel.appendChild(o); });
  });

  document.getElementById('af_save').onclick = async function() {
    var data = {
      asset_type: assetType,
      name: document.getElementById('af_name').value.trim(),
      description: document.getElementById('af_desc').value.trim(),
      content: document.getElementById('af_content').value.trim(),
      image_path: document.getElementById('af_image').value.trim(),
      sub_project_id: document.getElementById('af_sub').value ? parseInt(document.getElementById('af_sub').value) : null,
      tags: (document.getElementById('af_tags').value||'').split(',').map(function(x){return x.trim();}).filter(Boolean)
    };
    if (!data.name) { self._toast(L('请输入名称','Name required'),'warning'); return; }
    var r2 = await self._apiPost('/master/'+self._masterId+'/assets', data);
    if (r2.ok) { ov.remove(); self._toast(L('已创建','Created'),'success'); self._renderPhaseContent(); self._refreshMaster(); }
    else self._toast(L('创建失败','Failed'),'error');
  };
},

// Edit asset
_editAsset: function(assetId) {
  var self = this, L = this._L.bind(this);
  this._api('/master/assets/'+assetId).then(function(r){
    if (!r.ok) return;
    var a = r.asset;
    var typeName = {script:L('文稿','Script'),character:L('角色','Character'),scene:L('场景','Scene'),prompt_template:L('词卡模板','Prompt Template'),ref_image:L('参考图','Ref'),other:L('其他','Other')}[a.asset_type]||a.asset_type;
    var ov = self._overlay();
    ov.innerHTML = '<div class="pk-modal pk-modal-2col" onclick="event.stopPropagation()"><h4>✏ '+L('编辑资产','Edit Asset')+' — '+typeName+'</h4><div class="pk-edit-2col"><div class="pk-edit-left"><div class="form-group"><label>✏ '+L('名称','Name')+'</label><input type="text" id="ea_name" value="'+self._esc(a.name||'')+'"></div><div class="form-group"><label>📄 '+L('描述','Description')+'</label><textarea id="ea_desc" rows="2" style="resize:vertical;">'+self._esc(a.description||'')+'</textarea></div><div class="form-group"><label>📝 '+L('内容','Content')+'</label><textarea id="ea_content" rows="8" style="resize:vertical;">'+self._esc(a.content||'')+'</textarea></div></div><div class="pk-edit-right"><div class="form-group"><label>🖼 '+L('图片路径','Image')+'</label><input type="text" id="ea_image" value="'+self._esc(a.image_path||'')+'">'+(a.image_path?'<img src="'+a.image_path+'" style="max-width:100%;border-radius:8px;margin-top:8px;max-height:150px;object-fit:cover;" onerror="this.style.display=\'none\'">':'')+'</div><div class="form-group"><label>🏷 '+L('标签','Tags')+'</label><input type="text" id="ea_tags" value="'+(JSON.parse(a.tags||'[]')||[]).join(',')+'"></div></div></div><div class="pk-modal-actions"><button class="btn btn-danger btn-sm" style="margin-right:auto;" onclick="PK_ProjectDashboard._deleteAsset('+assetId+');this.closest(\'.pk-modal-overlay\').remove();">🗑 '+L('删除','Delete')+'</button><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">'+L('取消','Cancel')+'</button><button class="btn btn-primary" id="ea_save">'+L('保存','Save')+'</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById('ea_save').onclick = async function() {
      var data = { name: document.getElementById('ea_name').value.trim(), description: document.getElementById('ea_desc').value.trim(), content: document.getElementById('ea_content').value.trim(), image_path: document.getElementById('ea_image').value.trim(), tags: (document.getElementById('ea_tags').value||'').split(',').map(function(x){return x.trim();}).filter(Boolean) };
      var r2 = await self._apiPut('/master/assets/'+assetId, data);
      if (r2.ok) { ov.remove(); self._toast(L('已保存','Saved'),'success'); self._renderPhaseView(); }
      else self._toast(L('保存失败','Failed'),'error');
    };
  });
},
_deleteAsset: async function(id) {
  if (!confirm(this._L('确定删除此资产？','Delete this asset?'))) return;
  await this._apiDelete('/master/assets/'+id);
  this._toast(this._L('已删除','Deleted'),'info');
  this._renderPhaseView();
},

// ============================================================
// P3 — 分镜生产（子项目 + 批量生成）
// ============================================================
_renderP3_Production: async function() {
  var c = document.getElementById('pkPhaseContent'), L = this._L.bind(this), self = this;
  if (!c) return;
  var r = await this._api('/master/'+this._masterId+'/subs');
  var subs = r.subs||[];
  var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h5 style="margin:0;">🎬 '+L('分镜段落','Storyboard Segments')+' <span style="font-size:12px;color:var(--text-muted);font-weight:400;">('+subs.length+')</span></h5><div style="display:flex;gap:8px;"><button class="btn btn-sm btn-primary" onclick="PK_ProjectDashboard._showSubForm()">+ '+L('新建段落','New Segment')+'</button>'+(subs.length>0?'<button class="btn btn-sm btn-outline-secondary" onclick="PK_ProjectDashboard._showBatchGenerate()">⚡ '+L('批量生成','Batch Generate')+'</button>':'')+'</div></div>';

  if (!subs.length) {
    c.innerHTML = h+'<div class="pk-empty-state"><p style="font-size:48px;display:block;margin-bottom:12px;">🎬</p><h4>'+L('暂无分镜段落','No storyboard segments')+'</h4><p>'+L('每个段落对应一个 seedance 分镜项目','Each segment = one seedance storyboard project')+'</p><button class="btn btn-primary mt-3" onclick="PK_ProjectDashboard._showSubForm()">+ '+L('创建第一个段落','Create First Segment')+'</button></div>';
    return;
  }

  // Prompt chain
  h += '<div class="pk-prompt-chain" style="margin-bottom:16px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><span style="font-size:12px;font-weight:600;color:var(--text-primary);">🔗 '+L('提示词继承链','Prompt Chain')+'</span><span style="font-size:10px;color:var(--text-muted);">'+L('全局 → 段落 → 镜头','Global → Segment → Shot')+'</span></div><div style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--text-muted);"><span style="background:var(--primary-light,#eff6ff);padding:3px 10px;border-radius:6px;">'+L('全局风格','Global')+'</span><span>→</span><span style="background:#fef3c7;padding:3px 10px;border-radius:6px;">'+L('段落词卡','Segment')+'</span><span>→</span><span style="background:#ecfdf5;padding:3px 10px;border-radius:6px;">'+L('镜头词卡','Shot')+'</span></div></div>';

  // Sub project grid
  h += '<div class="pk-asset-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr));">';
  subs.forEach(function(sp){
    var pct = sp.progress_pct||0;
    var phases = {P0:L('策划','Plan'),P1:L('预生产','Pre'),P2:L('资产','Assets'),P3:L('生产','Prod'),P4:L('后期','Post'),P5:L('交付','Delivery'),P6:L('归档','Archive')};
    h += '<div class="pk-asset-card" style="cursor:pointer;" onclick="PK_ProjectDashboard._openSubProject('+sp.id+')"><div class="pk-asset-header"><span class="pk-asset-icon" style="font-size:28px;">🎬</span><div class="pk-asset-info"><div class="pk-asset-name">'+self._esc(sp.name)+'</div><div class="pk-asset-meta">'+(sp.description||'')+' · '+(sp.seedance_name||L('分镜项目','Storyboard'))+'</div></div><div class="pk-asset-actions"><button class="pk-task-action-btn" onclick="event.stopPropagation();PK_ProjectDashboard._editSub('+sp.id+')" title="'+L('编辑','Edit')+'">✏</button><button class="pk-task-action-btn" onclick="event.stopPropagation();PK_ProjectDashboard._deleteSub('+sp.id+')" title="'+L('删除','Delete')+'">🗑</button></div></div><div style="width:100%;height:4px;border-radius:2px;background:var(--border-color);overflow:hidden;margin-top:4px;"><div style="height:100%;border-radius:2px;background:linear-gradient(90deg,#3b82f6,#6366f1);width:'+pct+'%;"></div></div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);padding:4px 8px;"><span>'+L('进度','Progress')+': '+pct+'%</span></div></div>';
  });
  h += '</div>';
  c.innerHTML = h;
},

_showSubForm: function(subId) {
  var L = this._L.bind(this), self = this, isNew = !subId;
  // Simple form — reuse asset form pattern
  var name = prompt(L('段落名称：','Segment name:'), L('第二幕·高潮','Act 2 Climax'));
  if (!name) return;
  (isNew
    ? self._apiPost('/master/'+self._masterId+'/subs', {name:name, sub_type:'storyboard', phase:'P3'})
    : self._apiPut('/master/subs/'+subId, {name:name})
  ).then(function(r){
    if (r.ok) { self._toast(L('已保存','Saved'),'success'); self._refreshMaster(); }
    else self._toast(L('操作失败','Failed'),'error');
  });
},
_editSub: function(subId) {
  var L = this._L.bind(this);
  var name = prompt(L('段落名称：','Segment name:'));
  if (!name) return;
  var self = this;
  this._apiPut('/master/subs/'+subId, {name:name}).then(function(r){
    if (r.ok) { self._toast(L('已更新','Updated'),'success'); self._refreshMaster(); }
  });
},
_deleteSub: async function(subId) {
  if (!confirm(this._L('确定删除此段落？','Delete this segment?'))) return;
  await this._apiDelete('/master/subs/'+subId);
  this._toast(this._L('已删除','Deleted'),'info');
  this._refreshMaster();
},

// Open seedance project for sub
_openSubProject: function(subId) {
  // Navigate to existing kanban view for this sub-project
  var L = this._L.bind(this);
  this._toast(L('进入分镜项目编辑器...','Opening storyboard editor...'),'info');
  // This would navigate to seedance project view — placeholder for now
},

// Batch generate
_showBatchGenerate: function() {
  var self = this, L = this._L.bind(this);
  this._api('/master/'+this._masterId+'/subs').then(function(r){
    var subs = r.subs||[];
    if (!subs.length) { self._toast(L('无子项目可生成','No sub-projects'),'warning'); return; }
    var spOpts = subs.map(function(sp){ return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px;"><input type="checkbox" value="'+sp.id+'" checked> 🎬 '+self._esc(sp.name)+' ('+(sp.seedance_name||'—')+')</label>'; }).join('');
    var ov = self._overlay();
    ov.innerHTML = '<div class="pk-modal" onclick="event.stopPropagation()"><h4>⚡ '+L('批量生成','Batch Generate')+'</h4><p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">'+L('选择要批量生成的子项目，每个镜头发起一个生成任务','Select segments to generate. Each scene = 1 job.')+'</p><div class="form-group"><label>🎬 '+L('选择段落','Select Segments')+'</label><div style="max-height:200px;overflow-y:auto;padding:8px;border:1px solid var(--border-color);border-radius:8px;">'+spOpts+'</div></div><div class="form-group"><label>🖥 '+L('生成引擎','Engine')+'</label><select id="bg_engine" style="width:100%;"><option value="comfyui">ComfyUI</option><option value="seedance">Seedance</option></select></div><div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">'+L('取消','Cancel')+'</button><button class="btn btn-primary" id="bg_go">'+L('开始生成','Generate')+'</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById('bg_go').onclick = async function() {
      var checked = [];
      ov.querySelectorAll('input[type=checkbox]:checked').forEach(function(cb){checked.push(parseInt(cb.value));});
      if (!checked.length) { self._toast(L('请选择段落','Select a segment'),'warning'); return; }
      var mode = document.getElementById('bg_engine').value;
      var r2 = await self._apiPost('/master/'+self._masterId+'/batch-generate', {sub_project_ids:checked, mode:mode});
      if (r2.ok) { ov.remove(); self._toast(L('已提交','Submitted')+': '+r2.total+' '+L('个任务','jobs'),'success'); }
      else self._toast(L('提交失败','Failed'),'error');
    };
  });
},

// ============================================================
// P4 — 后期合成
// ============================================================
_renderP4_Post: function() {
  var c = document.getElementById('pkPhaseContent'), L = this._L.bind(this);
  if (!c) return;
  c.innerHTML = '<div class="pk-phase-placeholder"><h4>✂ '+L('后期合成','Post-production')+'</h4><p>'+L('时间轴组装 / 音频配乐 / 色彩统一 / 字幕叠加 / 成片渲染','Timeline assembly / Audio scoring / Color grading / Subtitles / Final render')+'</p><div class="pk-phase-coming">'+L('Phase23 规划中...','Coming in Phase23...')+'</div></div>';
},

// ============================================================
// P5 — 审核交付
// ============================================================
_renderP5_Delivery: function() {
  var c = document.getElementById('pkPhaseContent'), L = this._L.bind(this);
  if (!c) return;
  c.innerHTML = '<div class="pk-phase-placeholder"><h4>✅ '+L('审核交付','Review & Delivery')+'</h4><p>'+L('逐级审核 / 标注反馈 / 交付包导出 / 局域网审阅链接','Multi-level review / Annotations / Delivery package / LAN review link')+'</p><div class="pk-phase-coming">'+L('Phase23 规划中...','Coming in Phase23...')+'</div></div>';
},

// ============================================================
// P6 — 复盘归档
// ============================================================
_renderP6_Archive: function() {
  var c = document.getElementById('pkPhaseContent'), L = this._L.bind(this);
  if (!c) return;
  c.innerHTML = '<div class="pk-phase-placeholder"><h4>📊 '+L('复盘归档','Retrospective & Archive')+'</h4><p>'+L('数据统计 / 提示词复盘 / 项目归档 / 经验库 / 克隆项目','Analytics / Prompt review / Archive / Knowledge base / Clone project')+'</p><div class="pk-phase-coming">'+L('Phase23 规划中...','Coming in Phase23...')+'</div></div>';
}
};

window.PK_ProjectDashboard = PK;
if (window.__PK_PLUGINS__) { window.__PK_PLUGINS__._views = window.__PK_PLUGINS__._views||{}; window.__PK_PLUGINS__._views.project_mgmt = function() { PK.open(); }; }
if (window.__PK_VIEW_REGISTRY__) { window.__PK_VIEW_REGISTRY__.register('project_mgmt', function() { PK.open(); }); }
console.log('[PK_ProjectDashboard] v'+PK.VERSION+' loaded (Phase22)');
})();
