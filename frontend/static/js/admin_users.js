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
        if (typeof App !== 'undefined' && App.showToast) App.showToast('这一区由主理人打理，如需访问可请主理人开通', 'error');
        return;
      }

      // Switch main content area to admin view
      document.querySelectorAll('#mainContent > .view-panel').forEach(function(p){p.style.display='none';});
      var vp = document.getElementById('viewAdminUsers');
      if (vp) vp.style.display = 'block';
      try { if (window.App && App._collapseSidebar) App._collapseSidebar(); } catch(e) {}
      this._render();
      // Phase34: 订阅实时在线状态，无刷新更新状态点
      var self = this;
      if (window.PK_PRESENCE && !this._presenceUnsub) {
        this._presenceUnsub = PK_PRESENCE.on(function(){ self._updateLive(); });
        // 立即应用当前已知状态
        self._updateLive();
      }
    },

    close: function() {
      var vp = document.getElementById('viewAdminUsers');
      if (vp) vp.style.display = 'none';
      if (this._presenceUnsub) { try { this._presenceUnsub(); } catch(e){} this._presenceUnsub = null; }
      if (typeof App !== 'undefined' && App.switchView) App.switchView('home');
    },

    _render: function() {
      var vp = document.getElementById('viewAdminUsers');
      if (!vp) return;
      vp.innerHTML = '<div class="aum-container" style="height:100%;overflow-y:auto;padding:20px;">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'+
        '<h4 style="margin:0;font-size:15px;font-weight:700;color:var(--text-main);">👥 团队空间</h4>'+
        '<button class="btn btn-sm btn-outline-secondary" onclick="AUM.close()" style="font-size:12px;">← 返回</button></div>'+
        '<div class="toolbar"><div style="display:flex;gap:8px;flex:1;align-items:center;flex-wrap:wrap;">'+
        '<input type="text" class="search-box" id="aum_search" placeholder="搜索伙伴..." oninput="AUM.load()">'+
        '<button class="filter-btn active" id="aum_f_all" onclick="AUM.setFilter(\'\',this)">全部</button>'+
        '<button class="filter-btn" id="aum_f_admin" onclick="AUM.setFilter(\'admin\',this)">主理人</button>'+
        '<button class="filter-btn" id="aum_f_editor" onclick="AUM.setFilter(\'editor\',this)">共创者</button>'+
        '<button class="filter-btn" id="aum_f_viewer" onclick="AUM.setFilter(\'viewer\',this)">鉴赏者</button>'+
        '</div><button class="btn btn-sm btn-primary" onclick="AUM.showForm()">+ 邀请伙伴</button></div>'+
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
      var liveN = (window.PK_PRESENCE ? PK_PRESENCE.onlineCount() : 0);
      if (el) el.innerHTML = '<div class="stat-chip">📊 总计 <span class="num">'+this._users.length+'</span></div>'+
        '<div class="stat-chip">🌐 在线 <span class="num" id="aum_online_n">'+liveN+'</span></div>'+
        '<div class="stat-chip">✅ 启用 <span class="num">'+stats.active+'</span></div>'+
        '<div class="stat-chip">🔵 管理员 <span class="num">'+stats.admin+'</span></div>'+
        '<div class="stat-chip">🟢 共创者 <span class="num">'+stats.editor+'</span></div>'+
        '<div class="stat-chip">⚪ 鉴赏者 <span class="num">'+stats.viewer+'</span></div>';

      var grid = document.getElementById('aum_grid');
      if (!grid) return;
      if (!this._users.length) { grid.innerHTML = '<div class="empty"><div class="icon">👤</div><h4>暂无伙伴</h4><p style="color:var(--text-muted);font-size:12px;">点击邀请伙伴开始共创</p></div>'; return; }

      var self = this;
      grid.innerHTML = this._users.map(function(u){
        var ac = u.avatar_color || self._colors[Math.abs(_h(u.username))%self._colors.length];
        var init = (u.display_name||u.username).charAt(0).toUpperCase();
        var avUrl = u.avatar_url || '';
        var roles = {admin:'主理人',editor:'共创者',viewer:'鉴赏者'};
        var avatarHTML = avUrl
          ? '<img src="'+avUrl+'" style="position:absolute;top:0;left:0;width:44px;height:44px;border-radius:12px;object-fit:cover;" onerror="this.style.display=\'none\'"><span style="color:#fff;font-weight:700;font-size:17px;">'+init+'</span>'
          : '<span style="color:#fff;font-weight:700;font-size:17px;">'+init+'</span>';
        return '<div class="user-card" onclick="AUM.showForm('+u.id+')"><div class="user-card-header">'+
          '<div class="user-avatar" style="background:'+ac+';position:relative;overflow:hidden;">'+avatarHTML+
          '<span class="aum-live-dot" data-uid="'+u.id+'" style="position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border-radius:50%;background:#64748b;border:2px solid var(--bg-card,#1e293b);"></span></div>'+
          '<div class="user-info"><div class="user-name">'+_e(u.display_name||u.username)+'</div>'+
          '<div class="user-username">@'+u.username+'</div></div></div>'+
          '<div class="user-meta"><span class="badge badge-'+u.role+'">'+(roles[u.role]||u.role)+'</span>'+
          '<span class="aum-live-badge" data-uid="'+u.id+'" style="font-weight:600;color:#64748b;">⚫ 离线</span>'+
          '<span><span class="status-dot '+(u.is_active?'status-active':'status-inactive')+'"></span>'+(u.is_active?'可协作':'已暂停')+'</span></div>'+
          '<div class="user-footer">'+(u.last_login_at?'最后活跃: '+u.last_login_at.substring(0,10):'从未登录')+'</div>'+
          '<div class="user-card-actions"><button class="btn-outline" onclick="event.stopPropagation();AUM.showForm('+u.id+')">✏ 编辑</button>'+
          '<button class="btn-outline" onclick="event.stopPropagation();AUM.openLog('+u.id+',\''+_e(u.display_name||u.username)+'\')">📜 足迹回放</button>'+
          '<button class="btn-outline" onclick="event.stopPropagation();AUM.toggle('+u.id+','+(u.is_active?0:1)+')" style="color:'+(u.is_active?'var(--danger)':'var(--success)')+';">'+(u.is_active?'⏸ 暂停协作':'▶ 恢复协作')+'</button>'+
          '<button class="btn-outline btn-outline-danger" onclick="event.stopPropagation();AUM.deleteUser('+u.id+',\''+_e(u.display_name||u.username)+'\')">🗑</button></div></div>';
      }).join('');
      this._updateLive();
    },

    setFilter: function(f, el) {
      this._filter = f;
      document.querySelectorAll('#viewAdminUsers .filter-btn').forEach(function(b){b.classList.toggle('active', b===el);});
      this.load();
    },

    // Phase34: 依据 PK_PRESENCE 实时刷新各用户卡片在线状态（无需重拉列表）
    _updateLive: function() {
      if (!window.PK_PRESENCE) return;
      var META = PK_PRESENCE.META || {};
      document.querySelectorAll('#viewAdminUsers .aum-live-dot').forEach(function(dot){
        var uid = parseInt(dot.getAttribute('data-uid'), 10);
        var st = PK_PRESENCE.statusOf(uid);
        var m = META[st] || META.offline || {color:'#64748b', label:'离线'};
        dot.style.background = m.color;
        var badge = document.querySelector('#viewAdminUsers .aum-live-badge[data-uid="'+uid+'"]');
        if (badge) {
          badge.style.color = m.color;
          var snap = PK_PRESENCE.get(uid);
          var dev = (snap && snap.devices && snap.devices[0]) ? (' · '+snap.devices[0].device) : '';
          badge.textContent = (m.dot||'⚫') + ' ' + (m.label||'离线') + (st!=='offline' ? dev : '');
        }
      });
      var n = document.getElementById('aum_online_n');
      if (n) n.textContent = PK_PRESENCE.onlineCount();
    },

    showForm: function(uid) {
      var isNew = !uid, u = uid ? this._users.find(function(x){return x.id===uid;})||{}:{};
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay';
      ov.onclick = function(e) { if (e.target===ov) ov.remove(); };
      // 编辑现有用户时：双区布局（管理员操作 + 个人资料只读）
      var profileHTML = '';
      if (!isNew) {
        var av = u.avatar_url || '';
        var bio = u.bio || '';
        var website = u.website || '';
        var phone = u.phone || '';
        var email = u.email || '';
        var wechat = u.wechat || '';
        var hasProfile = av || bio || phone || email || wechat || website;
        profileHTML = '<div style="margin-top:14px;padding:12px;background:var(--bg-main,#0f172a);border-radius:10px;border-left:3px solid var(--border-color);">' +
          '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:10px;">📋 个人资料（伙伴自维护）</div>';
        if (hasProfile) {
          if (av) profileHTML += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;"><img src="'+_e(av)+'" style="width:36px;height:36px;border-radius:8px;object-fit:cover;" onerror="this.style.display=\'none\'"><span style="font-size:11px;color:var(--text-muted);">头像</span></div>';
          if (bio) profileHTML += '<div style="font-size:12px;color:var(--text-main);margin-bottom:6px;">'+_e(bio)+'</div>';
          var contacts = [];
          if (email) contacts.push('📧 '+_e(email));
          if (phone) contacts.push('📱 '+_e(phone));
          if (wechat) contacts.push('💬 '+_e(wechat));
          if (contacts.length) profileHTML += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px;">'+contacts.map(function(c){return '<span style="font-size:11px;color:var(--text-muted);background:var(--bg);padding:3px 8px;border-radius:4px;">'+c+'</span>';}).join('')+'</div>';
          if (website) profileHTML += '<div style="font-size:11px;color:var(--primary);word-break:break-all;">🔗 '+_e(website)+'</div>';
        } else {
          profileHTML += '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px;">伙伴尚未填写个人资料</div>';
        }
        profileHTML += '</div>';
      }
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:480px;" onclick="event.stopPropagation()">' +
        '<h4 style="margin-bottom:12px;">'+ (isNew?'➕ 邀请伙伴':'✏ 编辑信息 · '+_e(u.display_name||u.username)) +'</h4>'+
        (isNew?'<div class="form-group"><label>用户名</label><input type="text" id="uf_username" placeholder="字母/数字/下划线" autofocus></div>'+
        '<div class="form-group"><label>密码</label><input type="password" id="uf_password" placeholder="至少4个字符"></div>':'')+
        '<div style="padding:10px 12px;background:var(--bg-main,#0f172a);border-radius:8px;margin-bottom:10px;"><div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">🔧 管理员操作</div>'+
        '<div class="form-group"><label>显示名称</label><input type="text" id="uf_display" value="'+_e(u.display_name||'')+'"></div>'+
        '<div class="form-group"><label>角色</label><select id="uf_role"><option value="admin"'+(u.role==='admin'?' selected':'')+'>主理人</option><option value="editor"'+(u.role==='editor'?' selected':'')+'>共创者</option><option value="viewer"'+(u.role==='viewer'?' selected':'')+'>鉴赏者</option></select></div>'+
        (!isNew?'<div class="form-group"><label>密码重置（留空不修改）</label><input type="password" id="uf_pw_reset" placeholder="至少4个字符"></div>':'')+'</div>'+
        profileHTML +
        '<div class="pk-modal-actions" style="margin-top:14px;"><button class="btn btn-secondary" onclick="this.closest(\'.pk-auth-modal-overlay\').remove()">取消</button>'+
        '<button class="btn btn-primary" id="uf_save">保存</button></div></div>';
      document.body.appendChild(ov);
      var self = this;
      document.getElementById('uf_save').onclick = async function() {
        var data = { display_name: document.getElementById('uf_display').value.trim(), role: document.getElementById('uf_role').value };
        try {
          if (isNew) {
            data.username = document.getElementById('uf_username').value.trim().toLowerCase();
            data.password = document.getElementById('uf_password').value;
            if (!data.username||data.username.length<2){App.showToast('用户名至少2个字符','error');return;}
            if (!data.password||data.password.length<4){App.showToast('密码至少4个字符','error');return;}
            await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
          } else {
            var pw = document.getElementById('uf_pw_reset').value; if (pw) data.new_password = pw;
            await fetch('/api/auth/users/'+uid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
          }
          ov.remove(); self.load();
        } catch(e) { this._toast?this._toast('操作未完成，稍后再试','error'):(typeof PK!=='undefined'&&PK.toast?PK.toast('操作未完成，稍后再试','error'):alert('操作未完成，稍后再试')); }
      };
    },

    toggle: async function(uid, active) {
      if (!confirm(active?'确定恢复与这位伙伴的协作？':'确定暂停与这位伙伴的协作？')) return;
      try { await fetch('/api/auth/users/'+uid,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:active})}); this.load(); } catch(e) {}
    },

    deleteUser: async function(uid, name) {
      if (!confirm('将注销「'+name+'」？')) return;
      try { await fetch('/api/auth/users/'+uid,{method:'DELETE'}); this.load(); } catch(e) {}
    },

    // ============ Phase35: 账户活动日志查看器（管理员） ============
    _logCats: {
      audit:   [['','全部'],['auth','登录认证'],['user_admin','团队空间'],['project','项目'],['asset','素材']],
      actions: [['','全部'],['nav','导航'],['edit','编辑'],['click','点击'],['modal','弹窗'],['delete','删除'],['upload','上传'],['error','错误']],
      sessions:[]
    },
    _logMeta: {
      auth:'🔑', user_admin:'👤', project:'📁', asset:'🖼', prompt:'📝', system:'⚙️',
      nav:'🧭', edit:'✏️', click:'👆', modal:'🗔', delete:'🗑', upload:'⬆️', error:'⚠️'
    },

    openLog: function(uid, name) {
      this._log = { uid: uid, name: name, tab: 'audit', cat: '', q: '', offset: 0, limit: 50, total: 0 };
      var ov = document.createElement('div');
      ov.className = 'pk-auth-modal-overlay'; ov.id = 'aumLogOverlay';
      ov.onclick = function(e){ if(e.target===ov) ov.remove(); };
      var tabBtn = function(k,label){ return '<button class="aum-log-tab" data-tab="'+k+'" onclick="AUM._switchLogTab(\''+k+'\')" style="flex:1;padding:8px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-muted);border-bottom:2px solid transparent;">'+label+'</button>'; };
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:780px;width:94vw;" onclick="event.stopPropagation()">'+
        '<h4 style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><span>📜 '+_e(name)+' · 活动日志</span>'+
        '<span style="display:flex;gap:6px;">'+
        '<button class="btn btn-sm btn-outline-secondary" onclick="AUM.exportLog()" style="font-size:12px;" title="导出该账户审计日志 CSV">⬇ 导出CSV</button>'+
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'aumLogOverlay\').remove()" style="font-size:12px;">✕ 关闭</button></span></h4>'+
        '<div id="aumLogSummary" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>'+
        '<div class="aum-log-tabs" style="display:flex;border-bottom:1px solid var(--border-color);">'+
          tabBtn('audit','🛡 审计事件')+tabBtn('actions','🖱 操作行为')+tabBtn('sessions','🔌 登录会话')+'</div>'+
        '<div style="display:flex;gap:8px;margin:10px 0;">'+
          '<input id="aumLogSearch" placeholder="搜索关键词..." oninput="AUM._onLogSearch()" style="flex:1;padding:6px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:13px;">'+
          '<select id="aumLogCat" onchange="AUM._onLogCat()" style="padding:6px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:13px;"></select>'+
        '</div>'+
        '<div id="aumLogList" style="max-height:46vh;overflow:auto;font-size:13px;"></div>'+
        '<div style="text-align:center;margin-top:10px;"><button id="aumLogMore" class="btn btn-sm btn-outline-secondary" onclick="AUM._loadLogList(true)" style="display:none;font-size:12px;">加载更多</button></div>'+
      '</div>';
      document.body.appendChild(ov);
      this._loadLogSummary();
      this._switchLogTab('audit');
    },

    _fmtTime: function(t){ return t ? String(t).substring(0,19) : '—'; },

    // 2026-07-15: 导出当前账户审计日志 CSV（经全局 fetch 拦截器自动带 token，blob 下载）
    exportLog: async function() {
      var L = this._log; if (!L) return;
      try {
        var url = '/api/audit/export?uid='+L.uid+(L.cat?'&category='+L.cat:'')+(L.q?'&search='+encodeURIComponent(L.q):'');
        var r = await fetch(url);
        if (!r.ok) { App.showToast('导出未完成，请稍后重试','error'); return; }
        var blob = await r.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'audit_user'+L.uid+'_'+new Date().toISOString().substring(0,10)+'.csv';
        document.body.appendChild(a); a.click();
        setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            } catch(e) { App.showToast('导出未完成，请稍后重试','error'); }
    },

    _loadLogSummary: async function() {
      var L = this._log; if (!L) return;
      try {
        var r = await fetch('/api/audit/user/'+L.uid+'/summary'); var d = await r.json();
        var s = d.summary || {};
        var box = document.getElementById('aumLogSummary'); if (!box) return;
        var chip = function(label,val){ return '<span class="stat-chip" style="font-size:11px;">'+label+' <span class="num">'+val+'</span></span>'; };
        var pMeta = (window.PK_PRESENCE && PK_PRESENCE.META[s.presence]) || null;
        var pTxt = pMeta ? ('<span style="color:'+pMeta.color+';font-weight:700;">'+pMeta.label+'</span>') : (s.presence||'—');
        box.innerHTML = chip('当前', pTxt)+chip('最后登录', this._fmtTime(s.last_login_at))+
          chip('登录次数', s.login_count||0)+chip('登录未完成', s.login_failed_count||0)+
          chip('最近活动', this._fmtTime(s.last_activity_at))+chip('审计', s.audit_total||0)+chip('行为', s.actions_total||0);
      } catch(e) {}
    },

    _switchLogTab: function(tab) {
      var L = this._log; if (!L) return;
      L.tab = tab; L.offset = 0; L.q = ''; L.cat = '';
      document.querySelectorAll('#aumLogOverlay .aum-log-tab').forEach(function(b){
        var on = b.getAttribute('data-tab')===tab;
        b.style.color = on ? 'var(--primary,#3b82f6)' : 'var(--text-muted)';
        b.style.borderBottomColor = on ? 'var(--primary,#3b82f6)' : 'transparent';
      });
      var srch = document.getElementById('aumLogSearch'); if (srch) { srch.value=''; srch.style.display = (tab==='sessions')?'none':''; }
      var sel = document.getElementById('aumLogCat');
      if (sel) {
        var cats = this._logCats[tab]||[];
        sel.style.display = cats.length ? '' : 'none';
        sel.innerHTML = cats.map(function(c){ return '<option value="'+c[0]+'">'+c[1]+'</option>'; }).join('');
      }
      this._loadLogList(false);
    },

    _onLogSearch: function(){ var L=this._log; if(!L)return; L.q=(document.getElementById('aumLogSearch')||{}).value||''; clearTimeout(this._logT); var self=this; this._logT=setTimeout(function(){L.offset=0;self._loadLogList(false);},350); },
    _onLogCat: function(){ var L=this._log; if(!L)return; L.cat=(document.getElementById('aumLogCat')||{}).value||''; L.offset=0; this._loadLogList(false); },

    _loadLogList: async function(append) {
      var L = this._log; if (!L) return;
      if (!append) L.offset = 0;
      var base = '/api/audit/user/'+L.uid;
      var url;
      if (L.tab==='audit') url = base+'?limit='+L.limit+'&offset='+L.offset+(L.cat?'&category='+L.cat:'')+(L.q?'&search='+encodeURIComponent(L.q):'');
      else if (L.tab==='actions') url = base+'/actions?limit='+L.limit+'&offset='+L.offset+(L.cat?'&category='+L.cat:'')+(L.q?'&search='+encodeURIComponent(L.q):'');
      else url = base+'/sessions?limit=100';
      var listEl = document.getElementById('aumLogList'); if (!listEl) return;
      if (!append) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">加载中...</div>';
      try {
        var r = await fetch(url); var d = await r.json();
        var items = d.items||[]; L.total = d.total||items.length;
        var self = this;
        var html = items.map(function(it){ return self._renderLogRow(L.tab, it); }).join('');
        if (!append) listEl.innerHTML = items.length ? html : '<div style="padding:24px;text-align:center;color:var(--text-muted);">暂无记录</div>';
        else listEl.insertAdjacentHTML('beforeend', html);
        L.offset += items.length;
        var more = document.getElementById('aumLogMore');
        if (more) more.style.display = (L.tab!=='sessions' && L.offset < L.total) ? 'inline-block' : 'none';
      } catch(e) {
        if (!append) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--danger);">加载未完成</div>';
      }
    },

    _renderLogRow: function(tab, it) {
      var meta = this._logMeta;
      var row = function(icon, title, sub, right, danger){
        return '<div style="display:flex;gap:10px;padding:9px 6px;border-bottom:1px solid var(--border-color);align-items:flex-start;">'+
          '<span style="font-size:16px;flex-shrink:0;">'+icon+'</span>'+
          '<div style="flex:1;min-width:0;"><div style="font-weight:600;color:'+(danger?'var(--danger,#ef4444)':'var(--text-main)')+';">'+title+'</div>'+
          (sub?'<div style="font-size:12px;color:var(--text-muted);word-break:break-all;">'+sub+'</div>':'')+'</div>'+
          '<div style="font-size:11px;color:var(--text-muted);flex-shrink:0;text-align:right;white-space:nowrap;">'+right+'</div></div>';
      };
      if (tab==='audit') {
        var ic = meta[it.category]||'•';
        var isFail = it.status==='fail';
        var sub = (it.detail?_e(it.detail):'')+(it.client_ip?'  ·  '+it.client_ip:'')+(it.device?'  ·  '+_e(it.device):'');
        return row(isFail?'⛔':ic, _e(it.event_name||it.event_type)+(isFail?' <span style="color:var(--danger);font-size:11px;">未完成</span>':''), sub, this._fmtTime(it.created_at), isFail);
      } else if (tab==='actions') {
        var ic2 = meta[it.category]||'•';
        var sub2 = (it.target?_e(it.target):'')+(it.detail?'  '+_e(it.detail):'')+(it.client_ip?'  ·  '+it.client_ip:'');
        return row(ic2, _e(it.action||it.category)+' <span style="font-size:11px;color:var(--text-muted);">['+_e(it.category)+']</span>', sub2, this._fmtTime(it.created_at), it.category==='error');
      } else {
        var online = it.is_active==1;
        var sub3 = (it.device?_e(it.device):'')+(it.client_ip?'  ·  '+it.client_ip:'')+(it.expires_at?'  ·  失效 '+this._fmtTime(it.expires_at):'');
        var right = '<span style="color:'+(online?'#10b981':'#94a3b8')+';font-weight:700;">'+(online?'● 活跃连接':'○ 已断开')+'</span>';
        return row('🔌', '登录 '+this._fmtTime(it.created_at), sub3, right, false);
      }
    },
  };

  function _e(s){if(!s)return'';var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
  function _h(s){var h=0;for(var i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i);return Math.abs(h);}

  window.AUM = AUM;
  console.log('[AUM] Admin User Manager embedded SPA loaded');
})();
