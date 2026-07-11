/**
 * PromptKit Auth Client — Phase23.1
 * 轻量认证客户端：fetch 拦截器 + 自动 Token 注入
 * 在 index.html 中最后加载（在 app_core.js 之后）
 */
(function() {
  'use strict';

  var PK_AUTH = {
    _token: null,
    _user: null,
    _enforce: false, // 是否强制认证模式

    init: function() {
      this._token = localStorage.getItem('pk_token');
      try { this._user = JSON.parse(localStorage.getItem('pk_user')); } catch(e) { this._user = null; }
      this._enforce = false; // 默认非强制模式（兼容局部部署）

      // 导航栏注入登录/用户按钮
      this._injectNavButton();
    },

    isLoggedIn: function() {
      return !!this._token;
    },

    getUser: function() {
      return this._user;
    },

    getToken: function() {
      return this._token;
    },

    logout: function() {
      if (this._token) {
        fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + this._token } })
          .catch(function(){});
      }
      localStorage.removeItem('pk_token');
      localStorage.removeItem('pk_user');
      this._token = null;
      this._user = null;
      window.location.href = '/login.html';
    },

    _injectNavButton: function() {
      // 在导航栏右侧添加登录/用户按钮
      var navRight = document.getElementById('pageHeaderRight');
      if (!navRight) {
        // 等 DOM 加载完再试
        setTimeout(this._injectNavButton.bind(this), 500);
        return;
      }

      var self = this;
      var btn = document.createElement('button');
      btn.id = 'btnAuthUser';
      btn.className = 'btn btn-sm';
      btn.style.cssText = 'border-radius:20px;font-size:12px;margin-left:8px;';

      if (this._token && this._user) {
        // 已登录：显示用户名 + 下拉菜单
        btn.style.background = 'var(--primary-light,#eff6ff)';
        btn.style.color = 'var(--primary,#3b82f6)';
        btn.textContent = '👤 ' + (this._user.display_name || this._user.username);
        btn.title = '点击查看选项';
        btn.onclick = function(e) {
          e.stopPropagation();
          self._showUserMenu(e);
        };
      } else {
        // 未登录：显示登录按钮
        btn.style.background = 'var(--bg-card)';
        btn.style.color = 'var(--text-muted)';
        btn.style.border = '1px solid var(--border-color)';
        btn.textContent = '🔐 登录';
        btn.onclick = function() { window.location.href = '/login.html'; };
      }

      // 插入到右侧第一个位置
      navRight.insertBefore(btn, navRight.firstChild);
    },

    _showUserMenu: function(e) {
      var self = this;
      var menu = document.getElementById('pkUserMenu');
      if (menu) { menu.remove(); return; }

      menu = document.createElement('div');
      menu.id = 'pkUserMenu';
      menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card,#fff);border:1px solid var(--border-color);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:180px;padding:8px 0;';
      menu.style.top = (e.target.getBoundingClientRect().bottom + 4) + 'px';
      menu.style.right = (window.innerWidth - e.target.getBoundingClientRect().right) + 'px';

      var user = this._user || {};
      var menuHTML = '<div style="padding:8px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border-color);">👤 ' + (user.display_name||user.username||'User') + '<br><span style="font-size:10px;">' + (user.role||'—') + '</span></div>';
      if (user.role === 'admin') {
        menuHTML += '<button class="pk-menu-item" onclick="window.location.href=\'/admin_users.html\'">👥 用户管理</button>';
      }
      menuHTML += '<button class="pk-menu-item" onclick="PK_AUTH_CLIENT.logout()">🔓 退出登录</button>';
      menu.innerHTML = menuHTML;

      document.body.appendChild(menu);

      var closeMenu = function(ev) {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
      };
      setTimeout(function() { document.addEventListener('click', closeMenu); }, 10);
    },

    // 响应 401 自动跳转登录
    handle401: function() {
      if (this._token) {
        // Token 过期，清除并跳转
        localStorage.removeItem('pk_token');
        localStorage.removeItem('pk_user');
        this._token = null;
        this._user = null;
      }
      window.location.href = '/login.html';
    }
  };

  // 全局暴露
  window.PK_AUTH_CLIENT = PK_AUTH;

  // —— fetch 拦截：自动注入 Authorization header ——
  var _origFetch = window.fetch;
  window.fetch = function(url, options) {
    options = options || {};
    var headers = options.headers || {};

    // 如果有 token，自动注入
    if (PK_AUTH._token && typeof url === 'string' && !headers.hasOwnProperty('Authorization')) {
      if (url.startsWith('/api/') && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/register')) {
        if (headers instanceof Headers) {
          headers.set('Authorization', 'Bearer ' + PK_AUTH._token);
        } else {
          headers['Authorization'] = 'Bearer ' + PK_AUTH._token;
        }
        options.headers = headers;
      }
    }

    return _origFetch.call(window, url, options).then(function(resp) {
      // 如果返回 401，触发登录跳转
      if (resp.status === 401) {
        setTimeout(function() { PK_AUTH.handle401(); }, 100);
      }
      return resp;
    });
  };

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { PK_AUTH.init(); });
  } else {
    PK_AUTH.init();
  }

  console.log('[PK_Auth] Phase23.1 auth client loaded');
})();
