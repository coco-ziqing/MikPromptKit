/**
 * PromptKit Admin User Manager — embedded SPA in main page
 * No separate page, no browser cache issues.
 * Accessed from user dropdown → AUM.open()
 */
(function() {
  'use strict';

  var AUM = {
    _users: [], _filter: '', _colors: ['#7c3aed','#dc2626','#2563eb','#059669','#d97706','#db2777','#4f46e5','#0891b2','#ea580c','#65a30d'],

    open: function() {
      var user = window.PK_AUTH_CLIENT && PK_AUTH_CLIENT._user;
      if (!user || user.role !== 'admin') {
        if (typeof App !== 'undefined' && App.showToast) App.showToast('仅管理员可访问', 'error');
        return;
      }

      // Switch main content area to admin view
      document.querySelectorAll('#mainContent > .view-panel').forEach(function(p){p.style.display='none';});
      var vp = document.getElementById('viewAdminUsers');
      if (vp) vp.style.display = 'block';
      this._render();
    },

    close: function() {
      var vp = document.getElementById('viewAdminUsers');
      if (vp) vp.style.display = 'none';
      if (typeof App !== 'undefined' && App.switchView) App.switchView('home');
    },

    _render: function() {
      var vp = document.getElementById('viewAdminUsers');
      if (!vp) return;
      vp.innerHTML = '<div class="aum-container" style="height:100%;overflow-y:auto;padding:20px;">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'+
        '<h4 style="margin:0;font-size:15px;font-weight:700;color:var(--text-main);">👥 用户管理</h4>'+
        '<button class="btn btn-sm btn-outline-secondary" onclick="AUM.close()" style="font-size:12px;">← 返回</button></div>'+
        '<div class="toolbar"><div style="display:flex;gap:8px;flex:1;align-items:center;flex-wrap:wrap;">'+
        '<input type="text" class="search-box" id="aum_search" placeholder="搜索用户..." oninput="AUM.load()">'+
        '<button class="filter-btn active" id="aum_f_all" onclick="AUM.setFilter(\'\',this)">全部</button>'+
        '<button class="filter-btn" id="aum_f_admin" onclick="AUM.setFilter(\'admin\',this)">管理员</button>'+
        '<button class="filter-btn" id="aum_f_editor" onclick="AUM.setFilter(\'editor\',this)">编辑员</button>'+
        '<button class="filter-btn" id="aum_f_viewer" onclick="AUM.setFilter(\'viewer\',this)">观察者</button>'+
        '</div><button class="btn btn-sm btn-primary" onclick="AUM.showForm()">+ 添加用户</button></div>'+
        '<div id="aum_stats" class="stat-bar"></div><div id="aum_grid" class="user-grid"></div></div>';
      this.load();
    },

    async load() {
      var q = (document.getElementById('aum_search')||{}).value || '';
      var url = '/api/auth/users' + (this._filter?'?role='+this._filter:'') + (q?(this._filter?'&':'?')+'q='+encodeURIComponent(q):'');
      try { var r = await fetch(url); var d = await r.json(); this._users = d.users||[]; } catch(e) { this._users = []; }
      
      var stats = {admin:0, editor:0, viewer:0, active:0};
      this._users.forEach(function(u){stats[u.role]=(stats[u.role]||0)+1;if(u.is_active)stats.active++;});
      var el = document.getElementById('aum_stats');
      if (el) el.innerHTML = '<div class="stat-chip">📊 总计 <span class="num">'+this._users.length+'</span></div>'+
        '<div class="stat-chip">✅ 启用 <span class="num">'+stats.active+'</span></div>'+
        '<div class="stat-chip">🔵 管理员 <span class="num">'+stats.admin+'</span></div>'+
        '<div class="stat-chip">🟢 编辑员 <span class="num">'+stats.editor+'</span></div>'+
        '<div class="stat-chip">⚪ 观察者 <span class="num">'+stats.viewer+'</span></div>';

      var grid = document.getElementById('aum_grid');
      if (!grid) return;
      if (!this._users.length) { grid.innerHTML = '<div class="empty"><div class="icon">👤</div><h4>暂无用户</h4></div>'; return; }

      var self = this;
      grid.innerHTML = this._users.map(function(u){
        var ac = u.avatar_color || self._colors[Math.abs(_h(u.username))%self._colors.length];
        var av = (u.display_name||u.username).charAt(0).toUpperCase();
        var roles = {admin:'管理员',editor:'编辑员',viewer:'观察者'};
        return '<div class="user-card" onclick="AUM.showForm('+u.id+')"><div class="user-card-header">'+
          '<div class="user-avatar" style="background:'+ac+';">'+av+'</div>'+
          '<div class="user-info"><div class="user-name">'+_e(u.display_name||u.username)+'</div>'+
          '<div class="user-username">@'+u.username+'</div></div></div>'+
          '<div class="user-meta"><span class="badge badge-'+u.role+'">'+(roles[u.role]||u.role)+'</span>'+
          '<span><span class="status-dot '+(u.is_active?'status-active':'status-inactive')+'"></span>'+(u.is_active?'正常':'已禁用')+'</span></div>'+
          '<div class="user-footer">'+(u.last_login_at?'最后登录: '+u.last_login_at.substring(0,10):'从未登录')+'</div>'+
          '<div class="user-card-actions"><button class="btn-outline" onclick="event.stopPropagation();AUM.showForm('+u.id+')">✏ 编辑</button>'+
          '<button class="btn-outline" onclick="event.stopPropagation();AUM.toggle('+u.id+','+(u.is_active?0:1)+')" style="color:'+(u.is_active?'var(--danger)':'var(--success)')+';">'+(u.is_active?'⏸ 停用':'▶ 启用')+'</button>'+
          '<button class="btn-outline btn-outline-danger" onclick="event.stopPropagation();AUM.deleteUser('+u.id+',\''+_e(u.display_name||u.username)+'\')">🗑</button></div></div>';
      }).join('');
    },

    setFilter: function(f, el) {
      this._filter = f;
      document.querySelectorAll('#viewAdminUsers .filter-btn').forEach(function(b){b.classList.toggle('active', b===el);});
      this.load();
    },

    showForm: function(uid) {
      var isNew = !uid, u = uid ? this._users.find(function(x){return x.id===uid;})||{}:{};
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay';
      ov.onclick = function(e) { if (e.target===ov) ov.remove(); };
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:480px;" onclick="event.stopPropagation()"><h4>'+
        (isNew?'➕ 添加用户':'✏ 编辑 '+_e(u.display_name||u.username))+'</h4>'+
        (isNew?'<div class="form-group"><label>用户名</label><input type="text" id="uf_username" placeholder="字母/数字/下划线" autofocus></div>'+
        '<div class="form-group"><label>密码</label><input type="password" id="uf_password" placeholder="至少4个字符"></div>':'')+
        '<div class="form-group"><label>显示名称</label><input type="text" id="uf_display" value="'+_e(u.display_name||'')+'"></div>'+
        '<div class="form-group"><label>角色</label><select id="uf_role"><option value="admin"'+(u.role==='admin'?' selected':'')+'>管理员</option><option value="editor"'+(u.role==='editor'?' selected':'')+'>编辑员</option><option value="viewer"'+(u.role==='viewer'?' selected':'')+'>观察者</option></select></div>'+
        (!isNew?'<div class="form-group"><label>密码重置（留空不修改）</label><input type="password" id="uf_pw_reset" placeholder="至少4个字符"></div>':'')+
        '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-auth-modal-overlay\').remove()">取消</button>'+
        '<button class="btn btn-primary" id="uf_save">保存</button></div></div>';
      document.body.appendChild(ov);
      var self = this;
      document.getElementById('uf_save').onclick = async function() {
        var data = { display_name: document.getElementById('uf_display').value.trim(), role: document.getElementById('uf_role').value };
        try {
          if (isNew) {
            data.username = document.getElementById('uf_username').value.trim().toLowerCase();
            data.password = document.getElementById('uf_password').value;
            if (!data.username||data.username.length<2){alert('用户名至少2个字符');return;}
            if (!data.password||data.password.length<4){alert('密码至少4个字符');return;}
            await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
          } else {
            var pw = document.getElementById('uf_pw_reset').value; if (pw) data.new_password = pw;
            await fetch('/api/auth/users/'+uid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
          }
          ov.remove(); self.load();
        } catch(e) { alert('操作失败'); }
      };
    },

    toggle: async function(uid, active) {
      if (!confirm(active?'确定启用此用户？':'确定停用此用户？')) return;
      try { await fetch('/api/auth/users/'+uid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:active})}); this.load(); } catch(e) {}
    },

    deleteUser: async function(uid, name) {
      if (!confirm('确定永久删除用户「'+name+'」？')) return;
      try { await fetch('/api/auth/users/'+uid,{method:'DELETE'}); this.load(); } catch(e) {}
    },
  };

  function _e(s){if(!s)return'';var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
  function _h(s){var h=0;for(var i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i);return Math.abs(h);}

  window.AUM = AUM;
  console.log('[AUM] Admin User Manager embedded SPA loaded');
})();
