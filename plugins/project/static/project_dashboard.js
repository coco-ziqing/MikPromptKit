// PromptKit Project Manager v1.0.5 — minimal working version
(function(){'use strict';

var PK = {
VERSION: '1.0.5',
_activeProjectId: null,
_activeTab: 'dashboard',
_projects: [],
_projectCache: {},

_avatarEmojis: '🦊🐱🐶🐼🐨🐯🦁🐸🐵🐰🐻🐧🦄🐙🦉🐳🐬🦋🐞🐝🎨🎬🎧🎮💎🔥⭐🌈🎯'.split(''),
_avatarColors: '#7c3aed,#dc2626,#2563eb,#059669,#d97706,#db2777,#4f46e5,#0891b2,#ea580c,#65a30d,#6d28d9,#be123c'.split(','),

_apiBase: '/api/plugins/com.promptkit.project',

open: function() {
  var vp = document.getElementById('viewProjectMgmt');
  if (!vp) {
    vp = document.createElement('div');
    vp.id = 'viewProjectMgmt';
    vp.className = 'view-panel active-view';
    vp.style.display = 'flex';
    var mc = document.getElementById('mainContent');
    if (mc) mc.appendChild(vp);
  }
  document.querySelectorAll('#mainContent > .view-panel').forEach(function(p) { p.style.display = 'none'; });
  vp.style.display = 'flex';
  this._init();
},

close: function() {
  var vp = document.getElementById('viewProjectMgmt');
  if (vp) vp.style.display = 'none';
  if (typeof App !== 'undefined' && App.switchView) App.switchView('home');
},

_init: async function() {
  var self = this;
  var vp = document.getElementById('viewProjectMgmt');
  if (!vp) return;
  vp.innerHTML = '<div class="pk-proj-sidebar" id="pkProjSidebar"><div class="pk-proj-sidebar-header"><h5>Projects</h5><button class="btn btn-sm btn-primary" onclick="PK_ProjectDashboard._createProject()">+ New</button></div><div class="pk-proj-list" id="pkProjList"><div class="pk-empty-state"><p>Loading...</p></div></div></div><div class="pk-proj-main" id="pkProjMain"><div class="pk-empty-state" style="flex:1;display:flex;align-items:center;justify-content:center;"><div><h4>Select a Project</h4><p>Click a project from the sidebar</p></div></div></div>';
  await this._loadProjects();
  this._renderProjectList();
  if (this._activeProjectId) this._selectProject(this._activeProjectId);
  else if (this._projects.length > 0) this._selectProject(this._projects[0].id);
},

_api: async function(path) {
  try { var r = await fetch(this._apiBase + path); return await r.json(); } catch(e) { return {ok:false}; }
},
_apiPost: async function(path, data) {
  try { var r = await fetch(this._apiBase + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}); return await r.json(); } catch(e) { return {ok:false}; }
},
_apiPut: async function(path, data) {
  try { var r = await fetch(this._apiBase + path, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}); return await r.json(); } catch(e) { return {ok:false}; }
},
_apiDelete: async function(path) {
  try { var r = await fetch(this._apiBase + path, {method:'DELETE'}); return await r.json(); } catch(e) { return {ok:false}; }
},
_toast: function(msg, type) {
  if (typeof App !== 'undefined' && App.showToast) App.showToast(msg, type);
  else console.log('[PK]', type, msg);
},
_esc: function(s) {
  if (!s) return '';
  var div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
},

// Project list
_loadProjects: async function() {
  try { var r = await fetch('/api/seedance/v2/projects?page_size=100'); var d = await r.json(); this._projects = d.items || []; } catch(e) { this._projects = []; }
},
_renderProjectList: function() {
  var c = document.getElementById('pkProjList');
  if (!c) return;
  if (this._projects.length === 0) {
    c.innerHTML = '<div class="pk-empty-state"><p>No projects</p><button class="btn btn-sm btn-primary mt-2" onclick="PK_ProjectDashboard._createProject()">Create first project</button></div>';
    return;
  }
  var self = this, h = '';
  this._projects.forEach(function(p) {
    var act = p.id === self._activeProjectId ? ' active' : '';
    h += '<div class="pk-proj-item' + act + '" data-pid="' + p.id + '"><div class="pk-proj-item-info" onclick="PK_ProjectDashboard._selectProject(' + p.id + ')"><div class="pk-proj-item-icon">🎬</div><div class="pk-proj-item-name">' + self._esc(p.name || 'Unnamed') + '</div><div class="pk-proj-item-meta">' + (p.scene_count || 0) + ' scenes</div><div class="pk-proj-progress"><div class="pk-proj-progress-bar" style="width:' + (p.progress_pct || 0) + '%"></div></div></div></div>';
  });
  c.innerHTML = h;
},
_createProject: async function() {
  var name = prompt('Project name:', 'New Project ' + (this._projects.length + 1));
  if (!name) return;
  try {
    var r = await fetch('/api/seedance/v2/projects', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:name})});
    var d = await r.json();
    if (d && d.ok) { this._toast('Project created', 'success'); await this._loadProjects(); this._renderProjectList(); this._selectProject(d.id); }
  } catch(e) { this._toast('Create failed', 'error'); }
},
_selectProject: async function(projectId) {
  this._activeProjectId = projectId;
  this._renderProjectList();
  if (!this._projectCache[projectId]) {
    try {
      var pr = await fetch('/api/seedance/v2/projects/' + projectId);
      var projResp = await pr.json();
      var dashResp = await this._api('/dashboard?project_id=' + projectId);
      this._projectCache[projectId] = { project: projResp.project || projResp, scenes: projResp.scenes || [], dashboard: dashResp.ok ? dashResp : null };
    } catch(e) { this._projectCache[projectId] = { project: null, scenes: [], dashboard: null }; }
  }
  this._renderMain();
},

// Main panel with tabs
_renderMain: function() {
  var main = document.getElementById('pkProjMain');
  if (!main) return;
  var proj = this._projectCache[this._activeProjectId] ? this._projectCache[this._activeProjectId].project : null;
  if (!proj) { main.innerHTML = '<div class="pk-empty-state"><p>Load failed</p></div>'; return; }
  var tabs = [
    {id:'dashboard', label:'📊 Dashboard'},
    {id:'kanban', label:'📋 Kanban'},
    {id:'gantt', label:'📅 Gantt'},
    {id:'milestones', label:'🏁 Milestones'},
    {id:'team', label:'👥 Team'},
    {id:'orgchart', label:'🏛 Org Chart'}
  ];
  var self = this;
  var tH = tabs.map(function(t) {
    var act = t.id === self._activeTab ? ' active' : '';
    return '<button class="pk-proj-tab' + act + '" onclick="PK_ProjectDashboard._switchTab(\'' + t.id + '\')">' + t.label + '</button>';
  }).join('');
  main.innerHTML = '<div class="pk-proj-tabs">' + tH + '</div><div class="pk-proj-content" id="pkProjContent"></div>';
  this._renderActiveTab();
},
_switchTab: function(tabId) { this._activeTab = tabId; this._renderMain(); },
_renderActiveTab: function() {
  switch (this._activeTab) {
    case 'dashboard': this._renderDashboard(); break;
    case 'kanban': this._renderKanban(); break;
    case 'gantt': this._renderGantt(); break;
    case 'milestones': this._renderMilestones(); break;
    case 'team': this._renderTeam(); break;
    case 'orgchart': this._renderOrgChart(); break;
  }
},

// Dashboard
_renderDashboard: function() {
  var cache = this._projectCache[this._activeProjectId];
  var proj = cache ? cache.project : null;
  var dash = cache ? cache.dashboard : null;
  var c = document.getElementById('pkProjContent');
  if (!c) return;
  var stats = dash ? (dash.stats || {}) : {};
  var pct = stats.progress_pct || 0;
  var circ = 2 * Math.PI * 32;
  var off = circ - (pct / 100) * circ;
  c.innerHTML = '<div class="pk-dashboard-grid"><div class="pk-stat-card"><div class="pk-stat-icon blue">🎬</div><div class="pk-stat-body"><h3>' + (stats.scene_count || 0) + '</h3><p>Scenes</p></div></div><div class="pk-stat-card"><div class="pk-stat-icon green">✅</div><div class="pk-stat-body"><h3>' + (stats.done_tasks || 0) + '</h3><p>Done</p></div></div><div class="pk-stat-card"><div class="pk-stat-icon amber">⏳</div><div class="pk-stat-body"><h3>' + (stats.pending_tasks || 0) + '</h3><p>Pending</p></div></div><div class="pk-stat-card"><div class="pk-stat-icon purple">🚩</div><div class="pk-stat-body"><h3>' + (stats.completed_milestones || 0) + '/' + (stats.total_milestones || 0) + '</h3><p>Milestones</p></div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;"><div class="pk-stat-card" style="flex-direction:column;align-items:center;"><p style="font-size:12px;color:var(--text-muted);margin:0 0 8px;">Progress</p><svg class="pk-ring-svg" viewBox="0 0 80 80"><circle class="pk-ring-bg" cx="40" cy="40" r="32"/><circle class="pk-ring-fill" cx="40" cy="40" r="32" stroke-dasharray="' + circ + '" stroke-dashoffset="' + off + '" transform="rotate(-90 40 40)"/><text class="pk-ring-text" x="40" y="40">' + pct + '%</text></svg><p style="font-size:11px;color:var(--text-muted);margin-top:8px;">' + (stats.done_tasks || 0) + ' / ' + (stats.total_tasks || 0) + ' tasks</p></div><div class="pk-stat-card" style="flex-direction:column;"><p style="font-size:12px;font-weight:600;color:var(--text-primary);margin:0 0 12px;">📋 ' + this._esc(proj ? proj.name : '') + '</p><div style="display:flex;gap:24px;font-size:12px;color:var(--text-muted);"><span>Ratio: ' + (proj ? proj.aspect_ratio : '16:9') + '</span><span>Resolution: ' + (proj ? proj.resolution : '4K') + '</span><span>Duration: ' + (proj ? proj.total_duration : 15) + 's</span></div></div></div>';
},

// Team
_roleColor: function(role) {
  var c = {executive_producer:'#7c3aed',director:'#dc2626',screenwriter:'#2563eb',prompt_engineer:'#059669',storyboard_artist:'#d97706',visual_designer:'#db2777',animator:'#4f46e5',sound_designer:'#0891b2',editor:'#ea580c',qa_reviewer:'#65a30d',coordinator:'#6b7280',viewer:'#94a3b8'};
  return c[role] || '#94a3b8';
},
_renderTeam: async function() {
  var c = document.getElementById('pkProjContent');
  if (!c) return;
  var mr = await this._api('/members?project_id=' + this._activeProjectId);
  var membs = mr.members || [];
  var self = this;
  var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h5 style="margin:0;">👥 Team Members</h5><button class="btn btn-sm btn-primary" onclick="PK_ProjectDashboard._addMember()">+ Add Member</button></div>';
  if (membs.length === 0) {
    c.innerHTML = h + '<div class="pk-empty-state"><p style="font-size:48px;display:block;margin-bottom:12px;">👥</p><h4>No team members</h4><p>AIGC Production Team Roles</p><button class="btn btn-primary mt-3" onclick="PK_ProjectDashboard._addMember()">+ Add First Member</button></div>';
    return;
  }
  membs.sort(function(a, b) { return (b.role_level || 0) - (a.role_level || 0); });
  h += '<div class="pk-team-grid">';
  membs.forEach(function(m) {
    var av = m.avatar || m.role_icon || '👤';
    var ac = m.avatar_color || self._roleColor(m.role);
    h += '<div class="pk-member-card-v2" onclick="PK_ProjectDashboard._showProfile(' + m.id + ')"><div class="pk-member-header"><div class="pk-member-avatar-v2" style="background:' + ac + ';">' + av + '</div><div class="pk-member-name-v2"><div class="pk-member-realname">' + self._esc(m.real_name || ('User#' + m.user_id)) + '</div><div class="pk-member-badge-v2" style="background:' + ac + '20;color:' + ac + ';">' + (m.role_icon || '') + ' ' + (m.role_name || m.role) + '</div></div><button class="pk-member-action" onclick="event.stopPropagation();PK_ProjectDashboard._editMember(' + m.id + ')" title="Edit">✏️</button><button class="pk-member-action" onclick="event.stopPropagation();PK_ProjectDashboard._removeMember(' + m.id + ')" title="Remove">🗑</button></div></div>';
  });
  h += '</div>';
  c.innerHTML = h;
},
_showProfile: function(id) {
  var self = this;
  this._api('/members/' + id).then(function(r) {
    if (!r.ok) return;
    var m = r.member;
    var a = m.avatar || m.role_icon || '👤';
    var ac = m.avatar_color || self._roleColor(m.role);
    var perms = m.permissions || {};
    var pl = ['can_manage_members','can_edit_project','can_delete_tasks','can_approve','can_export'];
    var pln = ['Manage Members','Edit Project','Delete Tasks','Approve','Export'];
    var ph = '';
    for (var i = 0; i < pl.length; i++) {
      var v = perms[pl[i]] === true;
      ph += '<div class="pk-perm-i"><span>' + pln[i] + '</span><span class="pk-perm-b ' + (v ? 'g' : 'd') + '">' + (v ? '✅ Allowed' : '🚫 Denied') + '</span></div>';
    }
    var ov = document.createElement('div');
    ov.className = 'pk-modal-overlay';
    ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div class="pk-modal pk-modal-2col" onclick="event.stopPropagation()"><h4 style="margin:0 0 14px;display:flex;align-items:center;gap:10px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:' + ac + ';font-size:20px;flex-shrink:0;">' + a + '</span><span>' + self._esc(m.real_name || ('User#' + m.user_id)) + ' - ' + (m.role_icon || '') + ' ' + (m.role_name || m.role) + '</span></h4><div class="pk-edit-2col"><div class="pk-edit-left"><div class="pk-info-grid"><div class="pk-info-item"><span>User ID</span><strong>' + self._esc(m.user_id) + '</strong></div><div class="pk-info-item"><span>Joined</span><strong>' + (m.joined_at ? m.joined_at.substring(0,10) : '-') + '</strong></div><div class="pk-info-item"><span>Phone</span><strong>' + self._esc(m.phone || '-') + '</strong></div><div class="pk-info-item"><span>Email</span><strong>' + self._esc(m.email || '-') + '</strong></div></div></div><div class="pk-edit-right"><div class="form-group" style="margin-bottom:10px;"><label>Duty</label><div class="pk-duty-box" style="font-size:12px;padding:10px;">' + self._esc(m.duty || m.role_duty || 'Not set') + '</div></div><div class="pk-perm-wrap"><label>Permissions</label><div class="pk-perm-list">' + ph + '</div></div></div></div><div class="pk-modal-actions"><button class="btn btn-outline-primary" onclick="PK_ProjectDashboard._editMember(' + m.id + ');this.closest(\'.pk-modal-overlay\').remove();">✏️ Edit</button><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">Close</button></div></div>';
    document.body.appendChild(ov);
  });
},
_overlay: function() {
  var ov = document.createElement('div');
  ov.className = 'pk-modal-overlay';
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  return ov;
},
_editMember: function(id) {
  var self = this;
  this._api('/members/' + id).then(function(r) {
    if (!r.ok) return;
    var m = r.member;
    var a = m.avatar || m.role_icon || '👤';
    var ac = m.avatar_color || self._roleColor(m.role);
    var eg = '', cg = '';
    self._avatarEmojis.forEach(function(em) { eg += '<span class="pk-emoji-opt' + (em === a ? ' pk-emoji-selected' : '') + '" data-e="' + em + '">' + em + '</span>'; });
    self._avatarColors.forEach(function(cl) { cg += '<span class="pk-color-opt' + (cl === ac ? ' pk-color-selected' : '') + '" data-c="' + cl + '" style="background:' + cl + ';"></span>'; });
    var perms = m.permissions || {};
    var pk = {can_manage_members:'Manage Members',can_edit_project:'Edit Project',can_delete_tasks:'Delete Tasks',can_approve:'Approve',can_export:'Export'};
    var pc = '';
    for (var k in pk) pc += '<label class="pk-perm-check"><input type="checkbox" id="chk_' + k + '" ' + (perms[k] ? 'checked' : '') + '> ' + pk[k] + '</label>';
    var ov = self._overlay();
    ov.innerHTML = '<div class="pk-modal pk-modal-2col" onclick="event.stopPropagation()"><h4 style="margin:0 0 14px;">✏️ Edit Member</h4><div class="pk-edit-2col"><div class="pk-edit-left"><div id="av_preview" style="background:' + ac + ';font-size:36px;width:72px;height:72px;border-radius:16px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;">' + a + '</div><label style="font-size:10px;font-weight:700;color:var(--text-muted);display:block;">Avatar</label><div class="pk-emoji-grid">' + eg + '</div><label style="font-size:10px;font-weight:700;color:var(--text-muted);margin-top:8px;display:block;">Color</label><div class="pk-color-grid">' + cg + '</div><div class="form-group" style="margin-top:12px;"><label>Name</label><input type="text" id="fi_name" value="' + self._esc(m.real_name || '') + '"></div><div class="form-group"><label>User ID</label><input type="number" id="fi_uid" value="' + m.user_id + '" readonly></div></div><div class="pk-edit-right"><div class="form-group"><label>Phone</label><input type="text" id="fi_phone" value="' + self._esc(m.phone || '') + '" placeholder="Phone"></div><div class="form-group"><label>Email</label><input type="email" id="fi_email" value="' + self._esc(m.email || '') + '" placeholder="email@example.com"></div><div class="form-group"><label>Duty</label><textarea id="fi_duty" rows="3" style="resize:vertical;">' + self._esc(m.duty || '') + '</textarea></div><div class="pk-perm-wrap"><label>Permissions</label><div class="pk-perm-checks">' + pc + '</div></div></div></div><input type="hidden" id="fi_av" value="' + a + '"><input type="hidden" id="fi_ac" value="' + ac + '"><div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">Cancel</button><button class="btn btn-primary" id="fi_save">💾 Save</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelectorAll('.pk-emoji-opt').forEach(function(el) {
      el.onclick = function() {
        ov.querySelectorAll('.pk-emoji-opt').forEach(function(e) { e.classList.remove('pk-emoji-selected'); });
        this.classList.add('pk-emoji-selected');
        document.getElementById('fi_av').value = this.dataset.e;
        document.getElementById('av_preview').textContent = this.dataset.e;
      };
    });
    ov.querySelectorAll('.pk-color-opt').forEach(function(el) {
      el.onclick = function() {
        ov.querySelectorAll('.pk-color-opt').forEach(function(e) { e.classList.remove('pk-color-selected'); });
        this.classList.add('pk-color-selected');
        document.getElementById('fi_ac').value = this.dataset.c;
        document.getElementById('av_preview').style.background = this.dataset.c;
      };
    });
    document.getElementById('fi_save').onclick = async function() {
      var data = {
        real_name: document.getElementById('fi_name').value.trim(),
        avatar: document.getElementById('fi_av').value,
        avatar_color: document.getElementById('fi_ac').value,
        phone: document.getElementById('fi_phone').value.trim(),
        email: document.getElementById('fi_email').value.trim(),
        duty: document.getElementById('fi_duty').value.trim(),
        permissions: {}
      };
      for (var k2 in pk) data.permissions[k2] = document.getElementById('chk_' + k2).checked;
      var r2 = await self._apiPut('/members/' + id, data);
      if (r2.ok) { ov.remove(); self._toast('Saved', 'success'); self._renderTeam(); }
      else self._toast('Save failed', 'error');
    };
  });
},
_addMember: function() {
  var self = this;
  this._api('/roles').then(function(rr) {
    var roles = rr.roles || [];
    var ro = roles.map(function(r) { return '<option value="' + r.key + '">' + r.icon + ' ' + r.name + '</option>'; }).join('');
    var ov = self._overlay();
    ov.innerHTML = '<div class="pk-modal pk-modal-2col" onclick="event.stopPropagation()"><h4 style="margin:0 0 14px;">👥 Add Team Member</h4><div class="pk-edit-2col"><div class="pk-edit-left"><div class="form-group"><label>Name (required)</label><input type="text" id="am_name" placeholder="Member name" autofocus></div><div class="form-group"><label>User ID (required)</label><input type="number" id="am_uid" placeholder="Unique ID"></div></div><div class="pk-edit-right"><div class="form-group"><label>Role</label><select id="am_role" style="font-size:13px;">' + ro + '</select></div><div class="form-group"><label>Duty (optional)</label><textarea id="am_duty" rows="3" placeholder="e.g. Storyboarding episodes 1-3..." style="resize:vertical;"></textarea></div></div></div><div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">Cancel</button><button class="btn btn-primary" id="am_submit">Add Member</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById('am_submit').onclick = async function() {
      var name = document.getElementById('am_name').value.trim();
      var uid = parseInt(document.getElementById('am_uid').value);
      var role = document.getElementById('am_role').value;
      var duty = document.getElementById('am_duty').value.trim();
      if (!name) { self._toast('Name required', 'warning'); return; }
      if (!uid) { self._toast('User ID required', 'warning'); return; }
      var r2 = await self._apiPost('/members', {project_id:self._activeProjectId, user_id:uid, role:role, real_name:name, duty:duty});
      if (r2.ok) { ov.remove(); self._toast('Member added', 'success'); self._renderTeam(); }
      else self._toast('Failed: ' + (r2.detail || ''), 'error');
    };
  });
},
_removeMember: async function(id) {
  if (!confirm('Remove this member?')) return;
  await this._apiDelete('/members/' + id);
  this._renderTeam();
  this._toast('Removed', 'info');
},

// Kanban
_renderKanban: async function() {
  var c = document.getElementById('pkProjContent');
  if (!c) return;
  var pid = this._activeProjectId;
  var cols = await this._api('/columns?project_id=' + pid);
  var tasks = await this._api('/tasks?project_id=' + pid);
  var self = this;
  var tbc = {};
  (tasks.tasks || []).forEach(function(t) { var cid = t.column_id || 'none'; if (!tbc[cid]) tbc[cid] = []; tbc[cid].push(t); });
  var h = '<div class="pk-kanban-board">';
  (cols.columns || []).forEach(function(col) {
    var ct = tbc[col.id] || [];
    h += '<div class="pk-kanban-column"><div class="pk-kanban-col-header"><div class="pk-kanban-col-title"><span class="pk-kanban-col-dot" style="background:' + (col.color || '#6b7280') + ';"></span>' + self._esc(col.name) + '</div><span class="pk-kanban-col-count">' + ct.length + '</span></div><div class="pk-kanban-col-tasks">';
    ct.forEach(function(tk) { h += '<div class="pk-task-card"><div class="task-title">' + self._esc(tk.title) + '</div></div>'; });
    h += '</div><div class="pk-kanban-add-task"><button class="pk-kanban-add-btn" onclick="PK_ProjectDashboard._showTaskForm(' + col.id + ')">+ Add task</button></div></div>';
  });
  h += '<div class="pk-kanban-column pk-kanban-add-col" style="background:transparent;border:2px dashed var(--border-color);"><div class="pk-empty-state" style="padding:40px 20px;"><button class="btn btn-sm btn-outline-secondary" onclick="PK_ProjectDashboard._showColumnForm()">+ Add column</button></div></div></div>';
  c.innerHTML = h;
},
_showTaskForm: function(columnId) {
  var title = prompt('Task title:');
  if (!title) return;
  var self = this;
  this._apiPost('/tasks', {project_id:this._activeProjectId, column_id:columnId, title:title, priority:0}).then(function(r) {
    if (r.ok) { self._toast('Task created', 'success'); self._renderKanban(); }
    else self._toast('Failed', 'error');
  });
},
_showColumnForm: function() {
  var name = prompt('Column name:');
  if (!name) return;
  var self = this;
  this._apiPost('/columns', {project_id:this._activeProjectId, name:name, color:'#6b7280'}).then(function(r) {
    if (r.ok) { self._toast('Column added', 'success'); self._renderKanban(); }
    else self._toast('Failed', 'error');
  });
},

// Gantt
_renderGantt: async function() {
  var c = document.getElementById('pkProjContent');
  if (!c) return;
  var resp = await this._api('/gantt?project_id=' + this._activeProjectId);
  if (!resp.ok) { c.innerHTML = '<div class="pk-empty-state"><p>Load failed</p></div>'; return; }
  var self = this;
  var mil = resp.milestones || [], tsks = resp.tasks || [];
  var h = '<div class="pk-gantt-container"><div class="pk-gantt-header"><h5 style="margin:0">📅 Gantt Chart</h5></div><div class="pk-gantt-body">';
  if (mil.length > 0) {
    h += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;">🏁 Milestones</div>';
    mil.forEach(function(m) { h += '<div class="pk-gantt-row"><div class="pk-gantt-label milestone">🏁 ' + self._esc(m.title) + (m.completed_at ? ' ✅' : '') + '</div><div class="pk-gantt-timeline"><span style="font-size:10px;color:var(--text-muted);">' + (m.due_date || '-') + '</span></div></div>'; });
  }
  if (tsks.length > 0) {
    h += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);margin:12px 0 8px;">📋 Tasks</div>';
    tsks.forEach(function(t) { h += '<div class="pk-gantt-row"><div class="pk-gantt-label">' + self._esc(t.title) + '</div><div class="pk-gantt-timeline"><span style="font-size:10px;color:var(--text-muted);">' + (t.due_date || '-') + '</span></div></div>'; });
  }
  if (!mil.length && !tsks.length) h += '<div class="pk-empty-state"><p>No data - add tasks and milestones in Kanban first</p></div>';
  h += '</div></div>';
  c.innerHTML = h;
},

// Milestones
_renderMilestones: async function() {
  var c = document.getElementById('pkProjContent');
  if (!c) return;
  var resp = await this._api('/milestones?project_id=' + this._activeProjectId);
  var mil = resp.milestones || [];
  var self = this;
  var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h5 style="margin:0;">🏁 Milestones</h5><button class="btn btn-sm btn-primary" onclick="PK_ProjectDashboard._showMilestoneForm()">+ Add</button></div>';
  if (!mil.length) { c.innerHTML = h + '<div class="pk-empty-state"><p>No milestones yet</p></div>'; return; }
  h += '<div class="pk-milestone-list">';
  mil.forEach(function(m) {
    var done = m.completed_at ? ' completed' : '';
    h += '<div class="pk-milestone-item' + done + '"><div class="pk-milestone-check" onclick="PK_ProjectDashboard._toggleMilestone(' + m.id + ',' + (m.completed_at ? 'false' : 'true') + ')">' + (done ? '✓' : '') + '</div><div class="pk-milestone-info"><div class="pk-milestone-title">' + self._esc(m.title) + '</div><div class="pk-milestone-meta">' + (m.due_date ? '📅 ' + m.due_date : '') + (m.completed_at ? ' · ✅ ' + m.completed_at : '') + '</div></div><button class="pk-task-action-btn" onclick="PK_ProjectDashboard._deleteMilestone(' + m.id + ')" title="Delete">🗑</button></div>';
  });
  h += '</div>';
  c.innerHTML = h;
},
_showMilestoneForm: function() {
  var title = prompt('Milestone:');
  if (!title) return;
  var due = prompt('Due date (optional):');
  var self = this;
  this._apiPost('/milestones', {project_id:this._activeProjectId, title:title, due_date:due || null}).then(function(r) {
    if (r.ok) { self._toast('Milestone created', 'success'); self._renderMilestones(); }
    else self._toast('Failed', 'error');
  });
},
_toggleMilestone: async function(id, complete) { await this._apiPut('/milestones/' + id, {completed:complete}); this._renderMilestones(); },
_deleteMilestone: async function(id) { if (!confirm('Delete this milestone?')) return; await this._apiDelete('/milestones/' + id); this._renderMilestones(); this._toast('Deleted', 'info'); },

// Organization Chart
_renderOrgChart: function() {
  var c = document.getElementById('pkProjContent');
  if (!c) return;
  c.innerHTML = '<div class="pk-empty-state"><p>Loading org chart...</p></div>';
  var self = this;
  Promise.all([
    this._api('/members/org-tree?project_id=' + this._activeProjectId),
    this._api('/members?project_id=' + this._activeProjectId)
  ]).then(function(res) {
    var treeData = res[0], allData = res[1];
    var allMembers = allData.members || [];
    if (!allMembers.length) {
      c.innerHTML = '<div class="pk-org-header"><h5>🏛 Organization Chart</h5></div><div class="pk-empty-state"><p style="font-size:48px;display:block;margin-bottom:12px;">🏛</p><h4>No team members</h4><p>Add members in the Team tab first</p><button class="btn btn-primary mt-3" onclick="PK_ProjectDashboard._switchTab(\'team\')">👥 Go to Team</button></div>';
      return;
    }
    var tree = treeData.tree || [];
    var treeIds = new Set();
    function walkNodes(nodes) { nodes.forEach(function(n) { treeIds.add(n.id); if (n.children && n.children.length) walkNodes(n.children); }); }
    walkNodes(tree);
    var ungrouped = allMembers.filter(function(m) { return !treeIds.has(m.id); });

    function makeNode(node, level) {
      var ac = node.avatar_color || self._roleColor(node.role);
      var av = node.avatar || node.role_icon || '👤';
      var cls = (node.role_level >= 10) ? ' pk-org-node-exec' : (node.role_level >= 6) ? ' pk-org-node-lead' : '';
      var s = '<div class="pk-org-branch"><div class="pk-org-node' + cls + '" draggable="true" data-mid="' + node.id + '" onclick="PK_ProjectDashboard._showProfile(' + node.id + ')" ondragstart="PK_ProjectDashboard._orgDragStart(event)" ondragend="PK_ProjectDashboard._orgDragEnd(event)" ondragover="PK_ProjectDashboard._orgDragOver(event)" ondragleave="PK_ProjectDashboard._orgDragLeave(event)" ondrop="PK_ProjectDashboard._orgDrop(event,' + node.id + ')"><div style="background:' + ac + ';width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">' + av + '</div><div style="min-width:0;"><div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;">' + self._esc(node.real_name || ('User#' + node.user_id)) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:1px;">' + (node.role_icon || '') + ' ' + (node.role_name || node.role) + '</div></div><div class="pk-org-node-actions"><button class="pk-org-action-btn" onclick="event.stopPropagation();PK_ProjectDashboard._orgPromote(' + node.id + ')" title="Promote to top">⬆</button><button class="pk-org-action-btn" onclick="event.stopPropagation();PK_ProjectDashboard._orgReassign(' + node.id + ')" title="Change parent">🔗</button></div></div>';
      if (node.children && node.children.length) {
        s += '<div class="pk-org-children">';
        node.children.forEach(function(kid) { s += makeNode(kid, level + 1); });
        s += '</div>';
      }
      return s + '</div>';
    }

    var h = '<div class="pk-org-header"><h5>🏛 Organization Chart</h5><div style="display:flex;align-items:center;gap:10px;"><span style="font-size:11px;color:var(--text-muted);">Drag cards to reassign | Click for details</span><button class="btn btn-sm btn-outline-secondary" onclick="PK_ProjectDashboard._renderOrgChart()" title="Refresh">🔄</button></div></div><div class="pk-org-scroll"><div class="pk-org-tree">';
    if (tree.length) {
      h += '<div class="pk-org-level-label">📌 Organized</div>';
      tree.forEach(function(n) { h += makeNode(n, 0); });
    }
    if (ungrouped.length) {
      h += '<div class="pk-org-level-label" style="margin-top:24px;">📋 Unassigned (' + ungrouped.length + ')</div>';
      h += '<div class="pk-org-ungrouped" id="pkOrgUngrouped" ondragover="PK_ProjectDashboard._orgDragOverUngrouped(event)" ondragleave="PK_ProjectDashboard._orgDragLeaveUngrouped(event)" ondrop="PK_ProjectDashboard._orgDropUngrouped(event)">';
      ungrouped.forEach(function(m) {
        var ac = m.avatar_color || self._roleColor(m.role);
        var av = m.avatar || m.role_icon || '👤';
        h += '<div class="pk-org-node pk-org-node-sm" draggable="true" data-mid="' + m.id + '" ondragstart="PK_ProjectDashboard._orgDragStart(event)" onclick="PK_ProjectDashboard._showProfile(' + m.id + ')"><div style="background:' + ac + ';width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">' + av + '</div><div style="min-width:0;"><div style="font-size:12px;font-weight:600;color:var(--text-primary);white-space:nowrap;">' + self._esc(m.real_name || ('User#' + m.user_id)) + '</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px;">' + (m.role_icon || '') + ' ' + (m.role_name || m.role) + '</div></div></div>';
      });
      h += '</div>';
    }
    h += '</div></div><div class="pk-org-legend"><span>💡 Drag card onto another to assign reporting | Drag to Unassigned to remove parent | Click for details</span></div>';
    c.innerHTML = h;
  });
},

// Drag & Drop handlers
_orgDragStart: function(e) {
  var node = e.target.closest('.pk-org-node');
  if (!node) return;
  e.dataTransfer.setData('text/plain', node.dataset.mid);
  e.dataTransfer.effectAllowed = 'move';
  node.classList.add('pk-org-dragging');
},
_orgDragEnd: function(e) {
  var node = e.target.closest('.pk-org-node');
  if (node) node.classList.remove('pk-org-dragging');
  document.querySelectorAll('.pk-org-drop-target').forEach(function(el) { el.classList.remove('pk-org-drop-target'); });
},
_orgDragOver: function(e) {
  e.preventDefault();
  if (e.dataTransfer.types.indexOf('text/plain') < 0) return;
  var node = e.target.closest('.pk-org-node');
  if (node) node.classList.add('pk-org-drop-target');
},
_orgDragLeave: function(e) {
  var node = e.target.closest('.pk-org-node');
  if (node) node.classList.remove('pk-org-drop-target');
},
_orgDragOverUngrouped: function(e) {
  e.preventDefault();
  var el = document.getElementById('pkOrgUngrouped');
  if (el) el.classList.add('pk-org-drop-target');
},
_orgDragLeaveUngrouped: function(e) {
  var el = document.getElementById('pkOrgUngrouped');
  if (el) el.classList.remove('pk-org-drop-target');
},
_orgDrop: function(e, parentId) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.pk-org-drop-target').forEach(function(el) { el.classList.remove('pk-org-drop-target'); });
  var childId = parseInt(e.dataTransfer.getData('text/plain'));
  if (!childId || childId === parentId) return;
  var self = this;
  this._apiPut('/members/' + childId + '/parent', {parent_member_id: parentId}).then(function(r) {
    if (r.ok) { self._toast('Hierarchy updated', 'success'); self._renderOrgChart(); }
    else self._toast('Failed', 'error');
  });
},
_orgDropUngrouped: function(e) {
  e.preventDefault();
  e.stopPropagation();
  var el = document.getElementById('pkOrgUngrouped');
  if (el) el.classList.remove('pk-org-drop-target');
  var childId = parseInt(e.dataTransfer.getData('text/plain'));
  if (!childId) return;
  var self = this;
  this._apiPut('/members/' + childId + '/parent', {parent_member_id: null}).then(function(r) {
    if (r.ok) { self._toast('Unlinked from parent', 'success'); self._renderOrgChart(); }
    else self._toast('Failed', 'error');
  });
},
_orgPromote: function(memberId) {
  var self = this;
  this._apiPut('/members/' + memberId + '/parent', {parent_member_id: null}).then(function(r) {
    if (r.ok) { self._toast('Promoted to top', 'success'); self._renderOrgChart(); }
    else self._toast('Failed', 'error');
  });
},
_orgReassign: function(memberId) {
  var self = this;
  this._api('/members?project_id=' + this._activeProjectId).then(function(r) {
    if (!r.ok || !r.members) return;
    var others = r.members.filter(function(m) { return m.id !== memberId; });
    if (!others.length) { self._toast('No other members', 'warning'); return; }
    var opts = others.map(function(m) { return '<option value="' + m.id + '">' + (m.role_icon || '') + ' ' + self._esc(m.real_name || ('User#' + m.user_id)) + ' (' + (m.role_name || m.role) + ')</option>'; }).join('');
    var ov = self._overlay();
    ov.innerHTML = '<div class="pk-modal" onclick="event.stopPropagation()" style="max-width:400px;"><h4>Change Parent</h4><div class="form-group"><label>New parent</label><select id="ra_parent" style="width:100%;">' + opts + '</select></div><div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">Cancel</button><button class="btn btn-primary" id="ra_save">Save</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById('ra_save').onclick = async function() {
      var pid = parseInt(document.getElementById('ra_parent').value);
      if (!pid) { ov.remove(); return; }
      var r2 = await self._apiPut('/members/' + memberId + '/parent', {parent_member_id: pid});
      if (r2.ok) { ov.remove(); self._toast('Parent updated', 'success'); self._renderOrgChart(); }
      else self._toast('Failed', 'error');
    };
  });
}
};

// Expose globally
window.PK_ProjectDashboard = PK;

// Register views
if (window.__PK_PLUGINS__) {
  window.__PK_PLUGINS__._views = window.__PK_PLUGINS__._views || {};
  window.__PK_PLUGINS__._views.project_mgmt = function() { PK.open(); };
}
if (window.__PK_VIEW_REGISTRY__) {
  window.__PK_VIEW_REGISTRY__.register('project_mgmt', function() { PK.open(); });
}

console.log('[PK_ProjectDashboard] v' + PK.VERSION + ' loaded');
})();
