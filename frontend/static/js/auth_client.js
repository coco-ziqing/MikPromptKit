/**
 * PromptKit Auth + Cover — Phase23.7
 * 首页封面 + 登录弹窗 + fetch 拦截器 + 用户菜单
 */
(function() {
  'use strict';

  var PK_AC = {
    _token: null,
    _user: null,
    _coverData: null,
    _loggedIn: false,
    _checkDone: false,

    init: async function() {
      this._token = localStorage.getItem('pk_token');
      try { this._user = JSON.parse(localStorage.getItem('pk_user')); } catch(e) { this._user = null; }

      // 加载封面数据
      try {
        var r = await fetch('/api/cover');
        var d = await r.json();
        if (d.ok) this._coverData = d.cover;
      } catch(e) {}

      // 验证登录态
      await this._checkLogin();

      // 登录后延迟注入导航按钮，确保 DOM 已渲染
      if (this._loggedIn) {
        this._injectNavButton(0);
      }
    },

    _checkLogin: async function() {
      var self = this;
      if (!this._token) { this._showCover(); this._checkDone = true; return; }

      try {
        var r = await fetch('/api/auth/me', { headers: { 'Authorization': '***' + this._token } });
        var d = await r.json();
        if (d.authenticated) {
          this._user = d.user;
          this._loggedIn = true;
          localStorage.setItem('pk_user', JSON.stringify(d.user));
          // 管理员可见元素
          if (d.user.role === 'admin') {
            document.querySelectorAll('.admin-only').forEach(function(el){ el.classList.remove('admin-only'); });
          }
          this._checkDone = true;
          return;
        }
      } catch(e) {}
      // 未验证通过
      localStorage.removeItem('pk_token');
      localStorage.removeItem('pk_user');
      this._token = null; this._user = null;
      this._showCover();
      this._checkDone = true;
    },

    // ---- 封面页 ----
    _showCover: function() {
      var self = this;
      var cd = this._coverData || {};
      var title = cd.title || '咪卡Mik词库';
      var subtitle = cd.subtitle || 'AIGC 提示词全流程管理平台';
      var desc = (cd.description || '').replace(/\n/g,'<br>');
      var images = cd.cover_images || [];
      var version = cd.version || '';
      var hint = cd.login_hint || '登录以使用全部功能';

      var imgHTML = '';
      if (images.length) {
        imgHTML = '<div class="pk-cover-gallery">';
        images.forEach(function(img, i){
          var isVideo = img.src && (/\.mp4|\.webm|video\//i).test(img.src);
          if (isVideo) {
            imgHTML += '<div class="pk-cover-gallery-item"><div class="pk-cover-gallery-img pk-cover-video-wrapper" onmouseenter="PK_AUTH_CLIENT._coverPlayVideo(this)" onmouseleave="PK_AUTH_CLIENT._coverPauseVideo(this)">'+
              '<img src="'+((img.poster||img.thumb_url)||'')+'" alt="'+(img.alt||'')+'" class="pk-cover-poster" onerror="this.style.display=\'none\'">'+
              '<video src="'+img.src+'" muted loop preload="metadata" class="pk-cover-video"></video>'+
              '<div class="pk-cover-play-overlay"><span>▶</span></div>'+
            '</div><div class="pk-cover-gallery-label">'+(img.label||'')+'</div></div>';
          } else {
            imgHTML += '<div class="pk-cover-gallery-item"><div class="pk-cover-gallery-img">'+(img.src?'<img src="'+img.src+'" alt="'+(img.alt||'')+'" onerror="this.parentElement.innerHTML=\'<div class=pk-cover-fallback>🎬</div>\'">':'<div class="pk-cover-fallback">🎬</div>')+'</div><div class="pk-cover-gallery-label">'+(img.label||'')+'</div></div>';
          }
        });
        imgHTML += '</div>';
      }

      var cover = document.createElement('div');
      cover.id = 'pkCoverOverlay';
      cover.className = 'pk-cover-overlay';
      cover.innerHTML =
        '<div class="pk-cover-page">'+
          '<div class="pk-cover-top">'+
            '<div class="pk-cover-logo"><span class="pk-cover-logo-icon">🔍</span></div>'+
            '<h1 class="pk-cover-title">'+self._esc(title)+'</h1>'+
            (subtitle?'<p class="pk-cover-subtitle">'+self._esc(subtitle)+'</p>':'')+
            (version?'<div class="pk-cover-version">'+self._esc(version)+'</div>':'')+
          '</div>'+
          '<div class="pk-cover-bottom">'+
            '<div class="pk-cover-desc">'+(desc||'')+'</div>'+
            imgHTML+
            '<div class="pk-cover-actions">'+
              '<button class="pk-cover-btn pk-cover-btn-primary" onclick="PK_AUTH_CLIENT._showLoginModal()">'+self._esc(hint)+'</button>'+
            '</div>'+
          '</div>'+
        '</div>';
      document.body.appendChild(cover);
    },

    _hideCover: function() {
      var el = document.getElementById('pkCoverOverlay');
      if (el) { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(function(){ el.remove(); }, 300); }
    },

    // 封面视频悬停播放
    _coverPlayVideo: function(wrapper) {
      var video = wrapper.querySelector('video');
      var poster = wrapper.querySelector('.pk-cover-poster');
      var overlay = wrapper.querySelector('.pk-cover-play-overlay');
      if (video) { video.play().catch(function(){}); }
      if (poster) poster.style.opacity = '0';
      if (overlay) overlay.style.opacity = '0';
    },
    _coverPauseVideo: function(wrapper) {
      var video = wrapper.querySelector('video');
      var poster = wrapper.querySelector('.pk-cover-poster');
      var overlay = wrapper.querySelector('.pk-cover-play-overlay');
      if (video) { video.pause(); video.currentTime = 0; }
      if (poster) poster.style.opacity = '1';
      if (overlay) overlay.style.opacity = '1';
    },

    // ---- 登录/注册弹窗 ----
    _showLoginModal: function() {
      var self = this;
      var old = document.getElementById('pkAuthModal');
      if (old) old.remove();

      // 隐藏封面层，只留登录弹窗
      var cover = document.getElementById('pkCoverOverlay');
      if (cover) cover.style.display = 'none';

      var modal = document.createElement('div');
      modal.id = 'pkAuthModal';
      modal.className = 'pk-auth-modal-overlay';
      modal.onclick = function(e) {
        if (e.target===modal) { modal.remove(); if (cover) cover.style.display = ''; }
      };

      // ESC 关闭弹窗
      var escHandler = function(e) {
        if (e.key === 'Escape') {
          var m = document.getElementById('pkAuthModal');
          if (m) { m.remove(); if (cover) cover.style.display = ''; }
          document.removeEventListener('keydown', escHandler);
        }
      };
      document.addEventListener('keydown', escHandler);
      modal.innerHTML =
        '<div class="pk-auth-modal" onclick="event.stopPropagation()">'+
          '<div class="pk-auth-header">'+
            '<span class="pk-auth-brand">🔍 咪卡Mik词库</span>'+
          '</div>'+
          '<div class="pk-auth-tabs">'+
            '<button class="pk-auth-tab active" data-tab="login" onclick="PK_AUTH_CLIENT._switchAuthTab(\'login\')">登录</button>'+
            '<button class="pk-auth-tab" data-tab="register" onclick="PK_AUTH_CLIENT._switchAuthTab(\'register\')">注册</button>'+
          '</div>'+
          '<div style="text-align:right;margin-bottom:8px;"><span style="font-size:11px;color:var(--text-muted);cursor:pointer;" onclick="var m=document.getElementById(\'pkAuthModal\');var c=document.getElementById(\'pkCoverOverlay\');if(m)m.remove();if(c)c.style.display=\'\';">✕ 关闭</span></div>'+
          '<div id="pkAuthTabContent"></div>'+
        '</div>';
      document.body.appendChild(modal);
      this._renderAuthTab('login');
    },

    _switchAuthTab: function(tab) {
      document.querySelectorAll('.pk-auth-tab').forEach(function(b){b.classList.toggle('active',b.dataset.tab===tab);});
      this._renderAuthTab(tab);
    },

    _renderAuthTab: function(tab) {
      var self = this, c = document.getElementById('pkAuthTabContent');
      if (tab === 'login') {
        c.innerHTML =
          '<div class="pk-auth-form"><div class="form-group"><label>用户名</label><input type="text" id="al_username" placeholder="输入用户名" autofocus></div>'+
          '<div class="form-group"><label>密码</label><input type="password" id="al_password" placeholder="输入密码"></div>'+
          '<div class="remember-row"><input type="checkbox" id="al_remember"><label>记住用户名</label></div>'+
          '<button class="pk-auth-submit" id="btnLogin" onclick="PK_AUTH_CLIENT._doLogin()">登 录</button>'+
          '<div class="pk-auth-error" id="al_error"></div></div>';
        document.getElementById('al_password').addEventListener('keydown', function(e){if(e.key==='Enter')self._doLogin();});
      } else {
        c.innerHTML =
          '<div class="pk-auth-form"><div class="pk-auth-hint">💡 注册默认为「编辑员」角色</div>'+
          '<div class="form-group"><label>用户名</label><input type="text" id="ar_username" placeholder="字母/数字/下划线"></div>'+
          '<div class="form-group"><label>显示名称</label><input type="text" id="ar_display" placeholder="你的昵称"></div>'+
          '<div class="form-group"><label>密码</label><input type="password" id="ar_password" placeholder="至少4个字符"></div>'+
          '<button class="pk-auth-submit" id="btnRegister" onclick="PK_AUTH_CLIENT._doRegister()">注 册</button>'+
          '<div class="pk-auth-error" id="ar_error"></div></div>';
        document.getElementById('ar_password').addEventListener('keydown', function(e){if(e.key==='Enter')self._doRegister();});
      }
    },

    _setAuthError: function(id, msg) {
      var el = document.getElementById(id); if (el) el.textContent = msg;
    },

    _doLogin: async function() {
      var u = document.getElementById('al_username').value.trim();
      var p = document.getElementById('al_password').value;
      if (!u || !p) { this._setAuthError('al_error','请输入用户名和密码'); return; }
      var btn = document.getElementById('btnLogin'); btn.disabled=true; btn.textContent='登录中...';
      try {
        var r = await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
        var d = await r.json();
        if (d.ok) {
          localStorage.setItem('pk_token', d.token);
          localStorage.setItem('pk_user', JSON.stringify(d.user));
          this._token = d.token; this._user = d.user; this._loggedIn = true;
          if (d.user.role === 'admin') {
            document.querySelectorAll('.admin-only').forEach(function(el){ el.classList.remove('admin-only'); });
          }
          var m = document.getElementById('pkAuthModal'); if (m) m.remove();
          this._hideCover();
          setTimeout(function(){ location.reload(); }, 300);
        } else {
          this._setAuthError('al_error', d.detail||'用户名或密码错误');
        }
      } catch(e) { this._setAuthError('al_error','网络错误'); }
      finally { btn.disabled=false; btn.textContent='登 录'; }
    },

    _doRegister: async function() {
      var u = document.getElementById('ar_username').value.trim().toLowerCase();
      var d = document.getElementById('ar_display').value.trim();
      var p = document.getElementById('ar_password').value;
      if (!u||u.length<2){this._setAuthError('ar_error','用户名至少2个字符');return;}
      if (!/^[a-z0-9_]{2,20}$/.test(u)){this._setAuthError('ar_error','格式: 字母/数字/下划线 2-20位');return;}
      if (!p||p.length<4){this._setAuthError('ar_error','密码至少4个字符');return;}
      var btn = document.getElementById('btnRegister'); btn.disabled=true; btn.textContent='注册中...';
      try {
        var r = await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,display_name:d||u})});
        var rd = await r.json();
        if (rd.ok) {
          this._switchAuthTab('login');
          document.getElementById('al_username').value = u;
          document.getElementById('al_password').value = '';
          this._setAuthError('al_error','');
          // 绿色提示
          var err = document.getElementById('al_error'); err.style.color='#10b981'; err.textContent='注册成功! 请登录';
        } else {
          this._setAuthError('ar_error', rd.detail||'注册失败');
        }
      } catch(e) { this._setAuthError('ar_error','网络错误'); }
      finally { btn.disabled=false; btn.textContent='注 册'; }
    },

    // ---- 工具 JS ----
    _esc: function(s){if(!s)return'';var d=document.createElement('div');d.textContent=s;return d.innerHTML;},

    // ---- 导航栏用户按钮（风格匹配词库/组装/工具） ----
    _injectNavButton: function(attempt) {
      if (!this._loggedIn) return;
      attempt = attempt || 0;

      // 直接找 header-actions 作为插入锚点
      var actions = document.querySelector('.header-actions');
      var existing = document.getElementById('navDropdownUser');
      if (!actions) {
        if (attempt < 30) setTimeout(this._injectNavButton.bind(this, attempt + 1), 200);
        return;
      }
      if (existing) return;

      var self = this;
      var user = this._user || {};
      var isAdmin = user.role === 'admin';

      // 下拉组容器 — 匹配词库/组装/工具的 .nav-dropdown 结构
      var wrap = document.createElement('div');
      wrap.id = 'navDropdownUser';
      wrap.className = 'nav-dropdown';

      // 按钮 — 匹配 header-btn nav-dropdown-btn nav-dd-label 样式
      var btn = document.createElement('button');
      btn.id = 'btnAuthUser';
      btn.className = 'header-btn nav-dropdown-btn nav-dd-label';
      btn.title = '用户选项';
      btn.innerHTML = '<i class="bi bi-person-circle"></i><span class="nav-dd-text">用户</span><i class="bi bi-chevron-down nav-dd-arrow"></i>';
      btn.onclick = function(e) { e.stopPropagation(); self._showUserMenu(e); };
      wrap.appendChild(btn);

      // 下拉菜单（按需创建，点击时生成到 body）
      wrap._userMenuHandler = function(e) { self._showUserMenu(e); };

      // 插入 pluginNavRight 前面
      var ref = document.getElementById('pluginNavRight');
      if (ref) ref.parentNode.insertBefore(wrap, ref);
      else actions.appendChild(wrap);
    },

    _showUserMenu: function(e) {
      var menu = document.getElementById('pkUserMenu');
      if (menu) { menu.remove(); return; }
      var user = this._user || {};
      var isAdmin = user.role === 'admin';
      var roleName = {admin:'管理员',editor:'编辑员',viewer:'观察者'}[user.role]||user.role;

      menu = document.createElement('div');
      menu.id = 'pkUserMenu';
      menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.24);min-width:220px;padding:6px 0;overflow:hidden;';
      menu.style.top = (e.target.getBoundingClientRect().bottom+6)+'px';
      menu.style.right = (window.innerWidth-e.target.getBoundingClientRect().right)+'px';

      // 用户信息顶部
      var h = '<div style="padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border-color);">';
      h += '<div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:var(--primary-light,#1e3a5f);color:var(--primary,#3b82f6);font-size:20px;font-weight:700;flex-shrink:0;">'+(user.display_name||user.username||'?').charAt(0).toUpperCase()+'</div>';
      h += '<div style="min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--text-main,#f1f5f9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+(user.display_name||user.username||'User')+'</div>';
      h += '<div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-top:2px;"><span>'+(isAdmin?'🔷':'🟢')+' '+roleName+'</span><span style="width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;"></span> 在线</div></div></div>';

      // 菜单项
      var items = [
        {icon:'🔑', label:'用户管理', action:"if(window.AUM)AUM.open()", show:isAdmin},
        {divider:true, show:isAdmin},
        {icon:'👤', label:'个人详情', action:'PK_AUTH_CLIENT._showProfile()', show:true},
        {icon:'🔄', label:'切换账户', action:'PK_AUTH_CLIENT._switchAccount()', show:true},
        {icon:'🔓', label:'退出登录', action:'PK_AUTH_CLIENT._doLogout()', show:true, danger:true},
      ];

      items.forEach(function(item){
        if (!item.show) return;
        if (item.divider) { h += '<div style="height:1px;background:var(--border-color);margin:4px 0;"></div>'; return; }
        h += '<button class="pk-menu-item'+(item.danger?' pk-menu-danger':'')+'" onclick="'+item.action+'">'+item.icon+' '+item.label+'</button>';
      });

      menu.innerHTML = h;
      document.body.appendChild(menu);
      var cls = function(ev){if(!menu.contains(ev.target)){menu.remove();document.removeEventListener('click',cls);}};
      setTimeout(function(){document.addEventListener('click',cls);},10);
    },

    // 个人详情弹窗
    _showProfile: function() {
      var user = this._user || {};
      var roleName = {admin:'管理员',editor:'编辑员',viewer:'观察者'}[user.role]||user.role;
      var init = (user.display_name||user.username||'?').charAt(0).toUpperCase();

      // Fetch full user info
      var self = this;
      fetch('/api/auth/me',{headers:{'Authorization':'***'+this._token}}).then(function(r){return r.json();}).then(function(d){
        var u = (d.user||user);
        var ov = document.createElement('div');
        ov.className = 'pk-auth-modal-overlay';
        ov.onclick = function(e){if(e.target===ov)ov.remove();};
        ov.innerHTML = '<div class="pk-auth-modal" style="max-width:420px;" onclick="event.stopPropagation()"><div style="text-align:center;margin-bottom:16px;"><div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:16px;background:var(--primary-light,#1e3a5f);color:var(--primary,#3b82f6);font-size:28px;font-weight:700;margin-bottom:8px;">'+init+'</div><h4 style="margin:0 0 2px;font-size:16px;">'+self._esc(u.display_name||u.username||'')+'</h4><div style="font-size:12px;color:var(--text-muted);">@'+self._esc(u.username||'')+' · '+roleName+'</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;"><div style="padding:10px;background:var(--bg-main,#0f172a);border-radius:8px;"><div style="color:var(--text-muted);">账户ID</div><div style="font-weight:600;color:var(--text-main);">'+u.id+'</div></div><div style="padding:10px;background:var(--bg-main,#0f172a);border-radius:8px;"><div style="color:var(--text-muted);">状态</div><div style="font-weight:600;color:#10b981;">🟢 在线</div></div><div style="padding:10px;background:var(--bg-main,#0f172a);border-radius:8px;"><div style="color:var(--text-muted);">注册时间</div><div style="font-weight:600;">'+(u.created_at||'—').substring(0,10)+'</div></div><div style="padding:10px;background:var(--bg-main,#0f172a);border-radius:8px;"><div style="color:var(--text-muted);">最后登录</div><div style="font-weight:600;">'+(u.last_login_at||'—').substring(0,10)+'</div></div></div><div style="margin-top:12px;text-align:right;"><button class="pk-auth-submit" style="width:auto;padding:8px 24px;" onclick="this.closest(\'.pk-auth-modal-overlay\').remove()">关闭</button></div></div>';
        document.body.appendChild(ov);

        // ESC close
        var escH = function(ev){if(ev.key==='Escape'){ov.remove();document.removeEventListener('keydown',escH);}};
        document.addEventListener('keydown',escH);
      }).catch(function(){});
    },

    // 切换账户
    _switchAccount: function() {
      if (confirm('确定要切换账户？当前账户将登出。')) {
        this._doLogout();
        setTimeout(function(){ PK_AUTH_CLIENT._showLoginModal(); }, 500);
      }
    },

    _doLogout: function() {
      if (this._token) {
        fetch('/api/auth/logout',{method:'POST',headers:{'Authorization':'***'+this._token}}).catch(function(){});
      }
      localStorage.removeItem('pk_token'); localStorage.removeItem('pk_user');
      this._token = null; this._user = null; this._loggedIn = false;
      var w = document.getElementById('navDropdownUser'); if (w) w.remove();
      // 隐藏管理员专属入口（退出登录后）
      document.querySelectorAll('.nav-dropdown-item.admin-only').forEach(function(el){ el.classList.add('admin-only'); });
      this._showCover();
    },

    // ---- Fetch 拦截 ----
    _patchFetch: function() {
      var self = this;
      var orig = window.fetch;
      window.fetch = function(url, opts) {
        opts = opts || {};
        var headers = opts.headers || {};
        if (self._token && typeof url==='string' && url.startsWith('/api/') && !url.includes('/auth/login') && !url.includes('/auth/register') && !url.includes('/cover')) {
          if (headers instanceof Headers) headers.set('Authorization','Bearer '+self._token);
          else headers.Authorization = 'Bearer '+self._token;
          opts.headers = headers;
        }
        return orig.call(window, url, opts).then(function(r){
          if (r.status===401) { setTimeout(function(){self._doLogout();},100); }
          return r;
        });
      };
    }
  };

  // 暴露全局
  window.PK_AUTH_CLIENT = PK_AC;
  PK_AC._patchFetch();

  // 启动
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){PK_AC.init();});
  else PK_AC.init();

  console.log('[PK_Auth/Cover] loaded');
})();
