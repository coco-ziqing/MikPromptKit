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

      // 注入用户按钮到导航栏
      this._injectNavButton();
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
          imgHTML += '<div class="pk-cover-gallery-item"><div class="pk-cover-gallery-img">'+(img.src?'<img src="'+img.src+'" alt="'+(img.alt||'')+'" onerror="this.parentElement.innerHTML=\'<div class=pk-cover-fallback>🎬</div>\'">':'<div class="pk-cover-fallback">🎬</div>')+'</div><div class="pk-cover-gallery-label">'+(img.label||'')+'</div></div>';
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

    // ---- 登录/注册弹窗 ----
    _showLoginModal: function() {
      var self = this;
      // 移除已有弹窗
      var old = document.getElementById('pkAuthModal');
      if (old) old.remove();

      var modal = document.createElement('div');
      modal.id = 'pkAuthModal';
      modal.className = 'pk-auth-modal-overlay';
      modal.onclick = function(e) { if (e.target===modal) modal.remove(); };
      modal.innerHTML =
        '<div class="pk-auth-modal" onclick="event.stopPropagation()">'+
          '<div class="pk-auth-header">'+
            '<span class="pk-auth-brand">🔍 咪卡Mik词库</span>'+
          '</div>'+
          '<div class="pk-auth-tabs">'+
            '<button class="pk-auth-tab active" data-tab="login" onclick="PK_AUTH_CLIENT._switchAuthTab(\'login\')">登录</button>'+
            '<button class="pk-auth-tab" data-tab="register" onclick="PK_AUTH_CLIENT._switchAuthTab(\'register\')">注册</button>'+
          '</div>'+
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
          var m = document.getElementById('pkAuthModal'); if (m) m.remove();
          this._hideCover();
          this._injectNavButton();
          // 刷新页面以加载完整功能
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

    // ---- 导航栏用户按钮 ----
    _injectNavButton: function() {
      if (!this._loggedIn) return;
      var navRight = document.getElementById('pluginNavRight');
      if (!navRight) { setTimeout(this._injectNavButton.bind(this), 300); return; }
      // 已有按钮则跳过
      if (document.getElementById('btnAuthUser')) return;

      var self = this;
      var btn = document.createElement('button');
      btn.id = 'btnAuthUser';
      btn.className = 'header-btn';
      btn.style.cssText = 'border-radius:20px;font-size:12px;padding:4px 12px;';
      btn.style.background = 'var(--primary-light,#1e3a5f)';
      btn.style.color = 'var(--primary,#3b82f6)';
      btn.textContent = '👤 ' + (this._user.display_name || this._user.username || 'User');
      btn.title = '点击查看选项';
      btn.onclick = function(e) { e.stopPropagation(); self._showUserMenu(e); };
      navRight.appendChild(btn);
    },

    _showUserMenu: function(e) {
      var menu = document.getElementById('pkUserMenu');
      if (menu) { menu.remove(); return; }
      var user = this._user || {};
      menu = document.createElement('div');
      menu.id = 'pkUserMenu';
      menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.2);min-width:180px;padding:8px 0;';
      menu.style.top = (e.target.getBoundingClientRect().bottom+4)+'px';
      menu.style.right = (window.innerWidth-e.target.getBoundingClientRect().right)+'px';
      var h = '<div style="padding:8px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border-color);">👤 '+(user.display_name||user.username)+'<br><span style="font-size:10px;">'+user.role+'</span></div>';
      if (user.role==='admin') h+='<button class="pk-menu-item" onclick="window.location.href=\'/admin_users.html\'">👥 用户管理</button>';
      h+='<button class="pk-menu-item" onclick="PK_AUTH_CLIENT._doLogout()">🔓 退出登录</button>';
      menu.innerHTML = h;
      document.body.appendChild(menu);
      var cls = function(ev){if(!menu.contains(ev.target)){menu.remove();document.removeEventListener('click',cls);}};
      setTimeout(function(){document.addEventListener('click',cls);},10);
    },

    _doLogout: function() {
      if (this._token) {
        fetch('/api/auth/logout',{method:'POST',headers:{'Authorization':'***'+this._token}}).catch(function(){});
      }
      localStorage.removeItem('pk_token'); localStorage.removeItem('pk_user');
      this._token = null; this._user = null; this._loggedIn = false;
      // 移除用户按钮
      var b = document.getElementById('btnAuthUser'); if (b) b.remove();
      // 显示封面
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
