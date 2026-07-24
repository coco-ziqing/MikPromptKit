/**
 * PromptKit Auth + Cover — Phase23.7
 * 首页封面 + 登录弹窗 + fetch 拦截器 + 用户菜单
 */
(function() {
  'use strict';


  // 密码眼睛开关（全局工具，所有密码框复用）
  window._togglePw = function(inputId, btn) {
    var inp = document.getElementById(inputId);
    if (!inp) return;
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; /* 🙈 */ }
    else { inp.type = 'password'; btn.textContent = '👁'; /* 👁 */ }
  };


  // 密码眼睛开关（全局工具）
  window._togglePw = function(inputId, btn) {
    var inp = document.getElementById(inputId);
    if (!inp) return;
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
    else { inp.type = 'password'; btn.textContent = '👁'; }
  };
  var PK_AC = {
    _token: null,
    _user: null,
    _coverData: null,
    _loggedIn: false,
    _checkDone: false,

    // P0-5: Token XOR 混淆存储（局域网防窥探，非加密仅混淆）
    _setToken: function(t) { try { var obf = ''; for (var i=0; i<t.length; i++) obf += String.fromCharCode(t.charCodeAt(i) ^ 0x5A); localStorage.setItem('pk_token_v1', btoa(obf)); } catch(e) {} },
    _getToken: function() { try { var d = localStorage.getItem('pk_token_v1'); if (!d) return null; var obf = atob(d); var t = ''; for (var i=0; i<obf.length; i++) t += String.fromCharCode(obf.charCodeAt(i) ^ 0x5A); return t; } catch(e) { return null; } },

    _applyThemeEarly: function() {
      try {
        var t = localStorage.getItem('promptkit_theme');
        if (t === 'dark') document.body.classList.add('dark-theme');
        else if (t === 'light') document.body.classList.remove('dark-theme');
      } catch(e) {}
    },

    init: async function() {
      this._applyThemeEarly();
      // P0-5: 从混淆存储中恢复 token
      this._token = this._getToken();
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
            document.querySelectorAll('.admin-only').forEach(function(el){ el.classList.remove('admin-only'); el.classList.add('admin-shown'); });
          }
          // 显示模式切换条
          var ms = document.getElementById('pkModeSwitcher');
          if (ms) ms.style.display = 'flex';
          // 加载许可锁态（wc_bridge 可能仍在轮询中，延迟尝试）
          var tryLockInit = function(n) {
            if (typeof App !== 'undefined' && App._initLicenseLocks) { App._initLicenseLocks(); return; }
            if (n < 20) setTimeout(function(){ tryLockInit(n+1); }, 150);
          };
          tryLockInit(0);
          this._checkDone = true;
          return;
        }
      } catch(e) {}
      // 未验证通过
      localStorage.removeItem('pk_token_v1');
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

      var features = Array.isArray(cd.features) ? cd.features : [];
      var featHTML = '';
      if (features.length) {
        featHTML = '<div class="pk-cover-features">' + features.map(function(f){
          return '<div class="pk-cover-feature"><span class="pk-cover-feature-icon">'+(f.icon||'✨')+'</span><div class="pk-cover-feature-text"><div class="pk-cover-feature-title">'+self._esc(f.title||'')+'</div><div class="pk-cover-feature-desc">'+self._esc(f.desc||'')+'</div></div></div>';
        }).join('') + '</div>';
      }

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
            imgHTML += '<div class="pk-cover-gallery-item"><div class="pk-cover-gallery-img">'+(img.src?'<img loading="lazy" src="'+img.src+'" alt="'+(img.alt||'')+'" onerror="this.parentElement.innerHTML=\'<div class=pk-cover-fallback>🎬</div>\'">':'<div class="pk-cover-fallback">🎬</div>')+'</div><div class="pk-cover-gallery-label">'+(img.label||'')+'</div></div>';
          }
        });
        imgHTML += '</div>';
      }

      var cover = document.createElement('div');
      cover.id = 'pkCoverOverlay';
      cover.className = 'pk-cover-overlay';
      cover.innerHTML =
        '<div class="pk-cover-page">'+
          '<div class="pk-cover-head">'+
            '<span class="pk-cover-logo-icon">🔍</span>'+
            '<h1 class="pk-cover-title">'+self._esc(title)+(version?' <span class="pk-cover-ver">'+self._esc(version)+'</span>':'')+'</h1>'+
          '</div>'+
          (subtitle?'<p class="pk-cover-subtitle">'+self._esc(subtitle)+'</p>':'')+
          (desc?'<div class="pk-cover-desc">'+desc+'</div>':'')+
          imgHTML+
          featHTML+
          '<div class="pk-cover-actions">'+
            '<button class="pk-cover-btn pk-cover-btn-primary" onclick="PK_AUTH_CLIENT._showLoginModal()">'+self._esc(hint)+'</button>'+
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

      // 挂载弹窗激活状态：底层封面视觉整体隐藏 + 锁定滚动
      document.body.classList.add('pk-auth-active');

      var modal = document.createElement('div');
      modal.id = 'pkAuthModal';
      modal.className = 'pk-auth-modal-overlay';
      // 屏蔽背景点击 / 选中：点击遮罩不关闭，仅右上角 X 可关闭
      modal.addEventListener('mousedown', function(e){ if (e.target===modal) e.preventDefault(); });
      modal.addEventListener('click', function(e){ if (e.target===modal) { e.preventDefault(); e.stopPropagation(); } });
      modal.innerHTML =
        '<div class="pk-auth-modal" onclick="event.stopPropagation()">'+
          '<button class="pk-auth-close" title="关闭" onclick="PK_AUTH_CLIENT._closeLoginModal()">✕</button>'+
          '<div class="pk-auth-header">'+
            '<span class="pk-auth-brand">🔍 咪卡Mik词库</span>'+
          '</div>'+
          '<div class="pk-auth-tabs">'+
            '<button class="pk-auth-tab active" data-tab="login" onclick="PK_AUTH_CLIENT._switchAuthTab(\'login\')">登录</button>'+
            '<button class="pk-auth-tab" data-tab="register" onclick="PK_AUTH_CLIENT._switchAuthTab(\'register\')">注册</button>'+
          '</div>'+
          '<div id="pkAuthTabContent"></div>'+
          '<div class="pk-auth-pair-hint">🔗 本地设备配对：同一局域网内，任意设备浏览器访问本机地址即可登录协同</div>'+
        '</div>';
      document.body.appendChild(modal);
      this._renderAuthTab('login');
    },

    _closeLoginModal: function() {
      var m = document.getElementById('pkAuthModal');
      if (m) m.remove();
      document.body.classList.remove('pk-auth-active');
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
          '<div class="form-group"><label>密码</label><div style="position:relative;"><input type="password" id="al_password" placeholder="输入密码" style="width:100%;padding-right:36px;"><button type="button" onclick="window._togglePw(\'al_password\',this)" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 6px;line-height:1;" tabindex="-1" title="显示/隐藏密码">👁</button></div></div>'+
          '<div class="remember-row"><input type="checkbox" id="al_remember"><label>记住用户名</label></div>'+
          '<button class="pk-auth-submit" id="btnLogin" onclick="PK_AUTH_CLIENT._doLogin()">登 录</button>'+
          '<div class="pk-auth-error" id="al_error"></div></div>';
        document.getElementById('al_password').addEventListener('keydown', function(e){if(e.key==='Enter')self._doLogin();});
      } else {
        c.innerHTML =
          '<div class="pk-auth-form"><div class="pk-auth-hint">💡 注册默认为「编辑员」角色</div>'+
          '<div class="form-group"><label>用户名</label><input type="text" id="ar_username" placeholder="字母/数字/下划线"></div>'+
          '<div class="form-group"><label>显示名称</label><input type="text" id="ar_display" placeholder="你的昵称"></div>'+
          '<div class="form-group"><label>密码</label><div style="position:relative;"><input type="password" id="ar_password" placeholder="至少4个字符" style="width:100%;padding-right:36px;"><button type="button" onclick="window._togglePw(\'ar_password\',this)" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 6px;line-height:1;" tabindex="-1" title="显示/隐藏密码">👁</button></div></div>'+
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
          // P0-5: Token 不再明文存储，改用 XOR 混淆（局域网工具防窥探）
          this._setToken(d.token);
          localStorage.setItem('pk_user', JSON.stringify(d.user));
          this._token = d.token; this._user = d.user; this._loggedIn = true;
          if (d.user.role === 'admin') {
            document.querySelectorAll('.admin-only').forEach(function(el){ el.classList.remove('admin-only'); el.classList.add('admin-shown'); });
          }
          var m = document.getElementById('pkAuthModal'); if (m) m.remove();
          this._hideCover();
          setTimeout(function(){ var pj=localStorage.getItem('pk_pending_join'); if(pj){ localStorage.removeItem('pk_pending_join'); location.href='/join'+pj; } else { location.reload(); } }, 300);
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

      // 按钮 — 固定显示「账户」
      var btn = document.createElement('button');
      btn.id = 'btnAuthUser';
      btn.className = 'header-btn nav-dropdown-btn nav-dd-label';
      btn.title = (user.display_name||user.username||'账户');
      var av = user.avatar_url || '';
      var btnIcon = av
        ? '<img src="'+av+'" crossorigin="anonymous" class="pk-nav-avatar" style="width:18px;height:18px;border-radius:6px;object-fit:cover;vertical-align:middle;" onerror="this.style.display=\'none\'">'
        : '';
      btn.innerHTML = btnIcon + '<span class="nav-dd-text pk-no-i18n">账户</span><i class="bi bi-chevron-down nav-dd-arrow"></i>';
      btn.onclick = function(e) { e.stopPropagation(); self._showUserMenu(e); };
      wrap.appendChild(btn);

      // 预加载许可状态（避免菜单打开时的 async 时序问题）
      fetch('/api/license/info').then(function(r){return r.json();}).then(function(d){
        if (d.ok && d.tiers) {
          self._cachedTiers = {
            personal: d.tiers.personal && d.tiers.personal.active,
            team: d.tiers.team && d.tiers.team.active
          };
        }
      }).catch(function(){});

      // 下拉菜单（按需创建，点击时生成到 body）
      wrap._userMenuHandler = function(e) { self._showUserMenu(e); };

      // 插入到 🩺 诊断按钮左边
      var ref = document.getElementById('btnDiagConsole');
      if (ref) ref.parentNode.insertBefore(wrap, ref);
      else actions.appendChild(wrap);
    },

    _showUserMenu: function(e) {
      var menu = document.getElementById('pkUserMenu');
      if (menu) { menu.remove(); return; }
      var user = this._user || {};
      var isAdmin = user.role === 'admin';
      var roleName = {admin:'主理人',editor:'共创者',viewer:'鉴赏者'}[user.role]||user.role;
      // 先渲染菜单骨架，同时异步刷新许可状态
      var ct = this._cachedTiers || {};
      var personalActive = ct.personal || false;
      var teamActive = ct.team || false;
      var self = this;
      this._refreshTiers();  // 后台刷新，下次打开菜单即生效

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
      var currentMode = App.state._currentMode || 'library';

      var items = [
        {id:'menuTeamSpace', icon:'👥', label:'团队空间', action:function(){if(window.AUM)AUM.open()}, show:isAdmin},
        {divider:true, show:isAdmin},
        {id:'menuProfile', icon:'👤', label:'个人详情', action:function(){PK_AUTH_CLIENT._showProfile()}, show:true},
        {id:'menuSwitchAcct', icon:'🔄', label:'切换账户', action:function(){PK_AUTH_CLIENT._switchAccount()}, show:true},
        {divider:true, show:personalActive || teamActive},
        {id:'menuDeact', icon:'🔒', label:'退出激活', action:function(){PK_AUTH_CLIENT._deactivateMode()}, show:personalActive || teamActive},
        {divider:true, show:personalActive || teamActive},
        {id:'menuLogout', icon:'🔓', label:'退出登录', action:function(){PK_AUTH_CLIENT._doLogout()}, show:true, danger:true},
      ];

      items.forEach(function(item){
        if (!item.show) return;
        if (item.divider) { h += '<div style="height:1px;background:var(--border-color);margin:4px 0;"></div>'; return; }
        h += '<button class="pk-menu-item'+(item.danger?' pk-menu-danger':'')+'" data-action-id="'+item.id+'">'+item.icon+' '+item.label+'</button>';
      });

      menu.innerHTML = h;
      // 事件委托
      menu.addEventListener('click', function(ev) {
        var btn = ev.target.closest('.pk-menu-item');
        if (!btn) return;
        var aid = btn.dataset.actionId;
        for (var i = 0; i < items.length; i++) {
          if (items[i].id === aid && items[i].action) { items[i].action(); return; }
        }
      });
      document.body.appendChild(menu);
      var cls = function(ev){if(!menu.contains(ev.target)){menu.remove();document.removeEventListener('click',cls);}};
      setTimeout(function(){document.addEventListener('click',cls);},10);
    },

    // 个人详情弹窗（可编辑版）
    _showProfile: function() {
      var user = this._user || {};
      var self = this;
      Promise.all([
        fetch('/api/auth/me',{headers:{'Authorization':'***'+this._token}}).then(function(r){return r.json();}),
        fetch('/api/auth/me/stats',{headers:{'Authorization':'***'+this._token}}).then(function(r){return r.json();}).catch(function(){return {stats:{}};})
      ]).then(function(results){
        var u = (results[0].user||user);
        var stats = (results[1].stats||{});
        var roleName = {admin:'主理人',editor:'共创者',viewer:'鉴赏者'}[u.role]||u.role;
        var av = u.avatar_url || '';
        var ov = document.createElement('div');
        ov.className = 'pk-auth-modal-overlay';
        ov.id = 'pkProfileOverlay';
        ov.onclick = function(e){if(e.target===ov)ov.remove();};
        var avH = av
          ? '<img src="'+av+'" crossorigin="anonymous" style="width:80px;height:80px;border-radius:12px;object-fit:cover;" onerror="var f=this.nextElementSibling;this.style.display=\'none\';if(f)f.style.display=\'flex\';">'
            +'<div style="display:none;align-items:center;justify-content:center;width:80px;height:80px;border-radius:12px;background:linear-gradient(135deg,'+(u.avatar_color||'#6366f1')+',var(--primary,#3b82f6));color:#fff;font-size:32px;font-weight:700;">'+(u.display_name||u.username||'?').charAt(0).toUpperCase()+'</div>'
          : '<div style="display:flex;align-items:center;justify-content:center;width:80px;height:80px;border-radius:12px;background:linear-gradient(135deg,'+(u.avatar_color||'#6366f1')+',var(--primary,#3b82f6));color:#fff;font-size:32px;font-weight:700;">'+(u.display_name||u.username||'?').charAt(0).toUpperCase()+'</div>';
        var statCards = [
          {icon:'📝',label:'我的词卡',v:stats.word_cards||0},
          {icon:'🖼',label:'作品',v:stats.assets||0},
          {icon:'📁',label:'项目',v:stats.projects||0},
          {icon:'✔',label:'已定稿',v:stats.approved_works||0},
          {icon:'🎭',label:'角色',v:stats.characters||0},
          {icon:'🏞',label:'场景',v:stats.scenes||0}
        ].map(function(s){return '<div style="flex:1;min-width:70px;padding:8px 4px;background:var(--bg-main,#0f172a);border-radius:8px;text-align:center;"><div style="font-size:16px;">'+s.icon+'</div><div style="font-size:16px;font-weight:700;color:var(--text-main);">'+s.v+'</div><div style="font-size:10px;color:var(--text-muted);">'+s.label+'</div></div>';}).join('');
        ov.innerHTML = '<div class="pk-auth-modal" style="max-width:540px;width:94vw;max-height:92vh;overflow-y:auto;" onclick="event.stopPropagation()">'
          +'<div style="display:flex;justify-content:flex-end;margin-bottom:6px;"><button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'pkProfileOverlay\').remove()" style="font-size:18px;line-height:1;padding:2px 8px;">✕</button></div>'
          +'<div style="text-align:center;margin-bottom:12px;">'
            +'<div id="pkProfAvatarWrap" style="display:inline-block;position:relative;">'
              +'<div id="pkProfAvatarImg">'+avH+'</div>'
            +'</div>'
            +'<input type="file" id="pkAvatarInput" accept="image/*" style="display:none;" onchange="PK_AUTH_CLIENT._doUploadAvatar()">'
            +'<div style="margin-top:10px;display:flex;gap:6px;justify-content:center;">'
              +(av?'<button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation();PK_AUTH_CLIENT._pickAvatar()" style="font-size:11px;padding:5px 12px;">📷 替换</button>':'<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();PK_AUTH_CLIENT._pickAvatar()" style="font-size:11px;padding:5px 12px;">📷 上传头像</button>')
              +(av?'<button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation();PK_AUTH_CLIENT._clearAvatar()" style="font-size:11px;padding:5px 12px;">🗑 清除</button>':'')
            +'</div>'
            +'<h4 style="margin:8px 0 2px;font-size:17px;color:var(--text-main);">'+self._esc(u.display_name||u.username||'')+'</h4>'
            +'<div style="font-size:12px;color:var(--text-muted);">@'+self._esc(u.username||'')+' · '+roleName+'</div>'
          +'</div>'
          +'<div style="margin-bottom:12px;padding:12px;background:var(--bg-main,#0f172a);border-radius:10px;display:flex;flex-wrap:wrap;gap:4px;">'+statCards+'</div>'
          +'<div style="margin-bottom:14px;padding:12px;background:var(--bg-main,#0f172a);border-radius:10px;">'
            +'<div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;color:var(--text-muted);">显示名称</label><input type="text" id="pf_name" value="'+self._esc(u.display_name||'')+'" placeholder="给伙伴们看的名字" style="width:100%;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:13px;"></div>'
            +'<div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;color:var(--text-muted);">一句话简介</label><textarea id="pf_bio" placeholder="介绍一下你自己..." style="width:100%;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:13px;resize:vertical;min-height:56px;">'+self._esc(u.bio||'')+'</textarea></div>'
            +'<div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;color:var(--text-muted);">个人站点 / 社交媒体</label><input type="text" id="pf_website" value="'+self._esc(u.website||'')+'" placeholder="如 https://your.portfolio" style="width:100%;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:13px;"></div>'
            +'<details style="margin-bottom:10px;"><summary style="font-size:12px;font-weight:600;color:var(--text-muted);cursor:pointer;padding:4px 0;">🔒 修改密码（选填）</summary>'
              +'<div class="form-group" style="margin-top:6px;"><label style="font-size:12px;font-weight:600;color:var(--text-muted);">当前密码</label><div style="position:relative;"><input type="password" id="pf_oldpw" placeholder="确认当前密码" style="width:100%;padding:8px 36px 8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:13px;"><button type="button" onclick="window._togglePw(\'pf_oldpw\',this)" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 6px;line-height:1;" tabindex="-1" title="显示/隐藏密码">👁</button></div></div>'
              +'<div class="form-group" style="margin-top:6px;"><label style="font-size:12px;font-weight:600;color:var(--text-muted);">新密码</label><div style="position:relative;"><input type="password" id="pf_newpw" placeholder="至少4个字符" style="width:100%;padding:8px 36px 8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:13px;"><button type="button" onclick="window._togglePw(\'pf_newpw\',this)" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 6px;line-height:1;" tabindex="-1" title="显示/隐藏密码">👁</button></div></div>'
            +'</details>'
            +'<div class="form-group" style="margin-bottom:4px;"><label style="font-size:12px;font-weight:600;color:var(--text-muted);">头像主色调</label><div style="display:flex;gap:6px;flex-wrap:wrap;">'
              +['#6366f1','#7c3aed','#ec4899','#ef4444','#f59e0b','#10b981','#0891b2','#2563eb','#d97706','#db2777'].map(function(c){return '<span onclick="PK_AUTH_CLIENT._setAvatarColor(\''+c+'\')" style="width:24px;height:24px;border-radius:12px;background:'+c+';cursor:pointer;display:inline-block;border:2px solid '+(u.avatar_color===c?'var(--text-main,#fff)':'transparent')+';transition:all .15s;" title="'+c+'"></span>';}).join('')
            +'</div></div>'
            +'<button class="btn btn-primary" onclick="PK_AUTH_CLIENT._saveProfile()" style="width:100%;padding:10px;font-size:14px;font-weight:600;">💾 保存资料</button>'
          +'</div>'
        +'</div>';
        document.body.appendChild(ov);
        var escH = function(ev){if(ev.key==='Escape'){ov.remove();document.removeEventListener('keydown',escH);}};
        document.addEventListener('keydown',escH);
      }).catch(function(){});
    },

    _pickAvatar: function() {
      var inp = document.getElementById('pkAvatarInput'); if (inp) inp.click();
    },

    _clearAvatar: async function() {
      if (!confirm('确认清除头像？将恢复为系统默认首字母头像。')) return;
      var self = this;
      try {
        var r = await fetch('/api/auth/me/avatar', { method: 'DELETE', headers: { 'Authorization': '***' + self._token } });
        var d = await r.json();
        if (d.ok) {
          // 刷新个人详情弹窗
          var ov = document.getElementById('pkProfileOverlay');
          if (ov) ov.remove();
          // 更新缓存的用户数据
          if (self._user) self._user.avatar_url = '';
          // 刷新头像显示
          self._injectNavButton(0);
          // 重新打开个人详情
          setTimeout(function() { self._showProfile(); }, 200);
        } else {
          alert(d.detail || '清除未完成');
        }
      } catch(e) { alert('网络错误'); }
    },

    _doUploadAvatar: function() {
      var inp = document.getElementById('pkAvatarInput'); if (!inp||!inp.files.length) return;
      var file = inp.files[0];
      if (file.size > 5*1024*1024) { if (typeof PK!=='undefined'&&PK.toast) PK.toast('图片不能超过 5MB', 'error'); return; }
      inp.value = '';
      this._openCropModal(file);
    },

    _cropData: null,

    _openCropModal: function(file) {
      var self = this;
      this._cropData = { file: file, scale: 1, offsetX: 0, offsetY: 0, img: null, dragging: false };
      var reader = new FileReader();
      reader.onload = function(ev) {
        var img = new Image();
        img.onload = function() { self._cropData.img = img; self._initCropUI(); };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    },

    _initCropUI: function() {
      var self = this, SIZE = 280;
      var ov = document.createElement('div');
      ov.className = 'pk-auth-modal-overlay'; ov.id = 'pkCropOverlay';
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:440px;width:96vw;" onclick="event.stopPropagation()"><h4 style="margin:0 0 4px;font-size:15px;">✂ 调整头像</h4><div style="color:var(--text-muted);font-size:11px;margin-bottom:10px;">拖拽移动 · 滚轮缩放</div><div style="position:relative;width:'+SIZE+'px;height:'+SIZE+'px;margin:0 auto;overflow:hidden;border-radius:50%;cursor:grab;" id="pkCropStage"><img id="pkCropImg" style="position:absolute;transform-origin:0 0;" draggable="false"></div><div style="display:flex;gap:10px;margin-top:14px;justify-content:center;"><button class="btn btn-outline-secondary" onclick="PK_AUTH_CLIENT._cancelCrop()" style="flex:1;padding:10px;">取消</button><button class="btn btn-primary" onclick="PK_AUTH_CLIENT._confirmCrop()" style="flex:1;padding:10px;">✓ 确认</button></div></div>';
      document.body.appendChild(ov);
      var d = this._cropData;
      var imgEl = document.getElementById('pkCropImg');
      imgEl.src = d.img.src;
      var initScale = Math.max(SIZE / d.img.width, SIZE / d.img.height, 1);
      d.scale = initScale;
      d.offsetX = (SIZE - d.img.width * initScale) / 2;
      d.offsetY = (SIZE - d.img.height * initScale) / 2;
      this._renderCropImg(SIZE);
      var stage = document.getElementById('pkCropStage');
      stage.addEventListener('wheel', function(e) { e.preventDefault(); d.scale = Math.max(0.1, Math.min(5, d.scale + (e.deltaY < 0 ? 0.1 : -0.1))); self._renderCropImg(SIZE); });
      stage.addEventListener('mousedown', function(e) { d.dragging = true; d.lastX = e.clientX; d.lastY = e.clientY; });
      document.addEventListener('mousemove', function(e) { if (!d.dragging) return; d.offsetX += e.clientX - d.lastX; d.offsetY += e.clientY - d.lastY; d.lastX = e.clientX; d.lastY = e.clientY; self._renderCropImg(SIZE); });
      document.addEventListener('mouseup', function() { d.dragging = false; });
      var escH = function(ev){ if(ev.key==='Escape'){ self._cancelCrop(); document.removeEventListener('keydown',escH); } };
      document.addEventListener('keydown', escH);
    },

    _renderCropImg: function(SIZE) {
      var d = this._cropData; if (!d) return;
      var el = document.getElementById('pkCropImg'); if (!el) return;
      el.style.width = (d.img.width * d.scale) + 'px';
      el.style.height = (d.img.height * d.scale) + 'px';
      el.style.left = d.offsetX + 'px';
      el.style.top = d.offsetY + 'px';
    },

    _cancelCrop: function() {
      var ov = document.getElementById('pkCropOverlay'); if (ov) ov.remove();
      this._cropData = null;
    },

    _confirmCrop: function() {
      var self = this, d = this._cropData; if (!d) return;
      var SIZE = 200, canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      var ctx = canvas.getContext('2d');
      ctx.beginPath(); ctx.arc(SIZE/2, SIZE/2, SIZE/2, 0, Math.PI*2); ctx.clip();
      ctx.drawImage(d.img, d.offsetX * (SIZE/280), d.offsetY * (SIZE/280), d.img.width * d.scale * (SIZE/280), d.img.height * d.scale * (SIZE/280));
      canvas.toBlob(function(blob) {
        var fd = new FormData(); fd.append('file', blob, 'avatar_square.png');
        var wrap = document.getElementById('pkProfAvatarImg');
        if (wrap) wrap.innerHTML = '<div style="width:80px;height:80px;border-radius:12px;background:var(--bg-input);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted);">⏳</div>';
        fetch('/api/auth/me/avatar', {method:'POST', body:fd}).then(function(r){return r.json();}).then(function(resp){
          if (resp.ok) { self._onAvatarUpdated(resp.avatar_url); }
        }).catch(function(){});
      }, 'image/png');
      this._cancelCrop();
    },

    _onAvatarUpdated: function(url) {
      var u = this._user; if (!u) return;
      u.avatar_url = url;
      var btn = document.getElementById('btnAuthUser');
      if (btn) {
        var existingImg = btn.querySelector('img'); if (existingImg) existingImg.remove();
        var icon = btn.querySelector('.bi-person-circle');
        var img = document.createElement('img');
        img.src = url + '?t=' + Date.now();
        img.style.cssText = 'width:20px;height:20px;border-radius:6px;object-fit:cover;vertical-align:middle;';
        img.onerror = function(){ this.remove(); if (icon) icon.style.display = ''; };
        if (icon) icon.style.display = 'none';
        btn.insertBefore(img, btn.firstChild);
      }
      localStorage.setItem('pk_user', JSON.stringify(u));
    },

    _setAvatarColor: function(color) {
      this._user.avatar_color = color;
      document.querySelectorAll('#pkProfileOverlay span[onclick^="PK_AUTH_CLIENT._setAvatarColor"]').forEach(function(s){s.style.borderColor='transparent';});
      var target = document.querySelector('#pkProfileOverlay span[onclick="PK_AUTH_CLIENT._setAvatarColor(\''+color+'\')"]');
      if (target) target.style.borderColor = 'var(--text-main,#fff)';
    },

    _saveProfile: function() {
      var name = (document.getElementById('pf_name')||{}).value||'';
      var bio = (document.getElementById('pf_bio')||{}).value||'';
      var website = (document.getElementById('pf_website')||{}).value||'';
      var oldpw = (document.getElementById('pf_oldpw')||{}).value||'';
      var newpw = (document.getElementById('pf_newpw')||{}).value||'';
      var avatar_color = this._user.avatar_color || '#6366f1';
      var body = {display_name:name, bio:bio, website:website, avatar_color:avatar_color};
      if (oldpw && newpw) { body.old_password = oldpw; body.new_password = newpw; }
      else if (oldpw && !newpw) { if (typeof PK!=='undefined'&&PK.toast) PK.toast('新密码不能为空', 'error'); return; }
      var self = this;
      fetch('/api/auth/me', {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
      .then(function(r){return r.json();})
      .then(function(d){
        if (d.ok) {
          self._user = d.user;
          localStorage.setItem('pk_user', JSON.stringify(d.user));
          var btn = document.getElementById('btnAuthUser');
          if (btn) {
            // 更新显示名
            var t = btn.querySelector('.nav-dd-text'); if (t) t.textContent = (d.user.display_name || d.user.username || '?').substring(0, 4);
            // 更新头像
            var av = d.user.avatar_url || '';
            var oldImg = btn.querySelector('.pk-nav-avatar');
            if (av) {
              if (oldImg) oldImg.src = av + '?t=' + Date.now();
              else { var img = document.createElement('img'); img.className = 'pk-nav-avatar'; img.src = av + '?t=' + Date.now(); img.style.cssText = 'width:18px;height:18px;border-radius:6px;object-fit:cover;vertical-align:middle;'; img.onerror = function(){ this.remove(); }; btn.insertBefore(img, btn.firstChild); }
            }
          }
          if (typeof PK!=='undefined'&&PK.toast) PK.toast('资料已保存 ✨', 'success');
          document.getElementById('pkProfileOverlay').remove();
        } else {
          if (typeof PK!=='undefined'&&PK.toast) PK.toast('保存未完成，稍后再试', 'error');
        }
      }).catch(function(){ if (typeof PK!=='undefined'&&PK.toast) PK.toast('网络不太稳定，请稍后重试', 'error'); });
    },

    // 刷新许可缓存（激活/退出后调用，使菜单按钮立即可见）
    _refreshTiers: function() {
      var self = this;
      fetch('/api/license/info').then(function(r){return r.json();}).then(function(d){
        if (d.ok && d.tiers) {
          self._cachedTiers = {
            personal: d.tiers.personal && d.tiers.personal.active,
            team: d.tiers.team && d.tiers.team.active
          };
        }
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
      try { if (window.PK_PRESENCE) PK_PRESENCE.disconnect(); } catch(e){}
      var pw = document.getElementById('pkPresenceWrap'); if (pw) pw.remove();
      localStorage.removeItem('pk_token_v1'); localStorage.removeItem('pk_user');
      try { localStorage.removeItem('promptkit_group_id'); localStorage.removeItem('promptkit_view'); localStorage.removeItem('promptkit_module'); } catch(e) {}
      this._token = null; this._user = null; this._loggedIn = false;
      var w = document.getElementById('navDropdownUser'); if (w) w.remove();
      document.querySelectorAll('.nav-dropdown-item.admin-only').forEach(function(el){ el.classList.add('admin-only'); });
      this._showCover();
    },

    _deactivateMode: async function(tier) {
      var self = this;
      // 自动判定退出哪个版本：团队优先
      var ct = this._cachedTiers || {};
      tier = tier || (ct.team ? 'team' : 'personal');
      var label = tier === 'team' ? '团队项目版' : '个人项目版';
      if (!confirm('确认退出 ' + label + ' 激活？\n退出后对应功能将被锁定。')) return;
      try {
        var r = await fetch('/api/license/deactivate', {
          method: 'DELETE',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({tier: tier})
        });
        var d = await r.json();
        if (d.ok) {
          if (tier === 'team') {
            self._cachedTiers.team = false;
            // 退出团队版 → 自动回退到个人项目版（如果个人版仍激活）
            if (self._cachedTiers.personal) {
              App._activeTiers = {personal: true, team: false};
              App._refreshModeBtnLocks();
              App._switchMode('project', document.querySelector('.pk-mode-btn[data-mode="project"]'));
            } else {
              App._activeTiers = {personal: false, team: false};
              App._refreshModeBtnLocks();
              App._switchMode('library', document.querySelector('.pk-mode-btn[data-mode="library"]'));
            }
          } else {
            self._cachedTiers.personal = false;
            App._activeTiers = {personal: false, team: self._cachedTiers.team || false};
            App._refreshModeBtnLocks();
            App._switchMode('library', document.querySelector('.pk-mode-btn[data-mode="library"]'));
          }
          if (typeof PK !== 'undefined' && PK.toast) PK.toast('已退出' + label, 'info');
        } else {
          alert(d.detail || '操作失败');
        }
      } catch(e) { alert('网络错误: ' + e.message); }
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
