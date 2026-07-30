/**
 * PromptKit 实时在线状态客户端 — Phase34
 * 登录即连 /ws/presence，常驻；维护全体在线用户表并驱动 UI 实时刷新。
 *
 * 暴露：
 *   PK_PRESENCE.list()              -> 在线用户数组
 *   PK_PRESENCE.get(userId)         -> 单用户在线态 | null
 *   PK_PRESENCE.statusOf(userId)    -> 'online'|'idle'|'away'|'busy'|'offline'
 *   PK_PRESENCE.on(fn)              -> 订阅变化（返回取消函数）
 *   PK_PRESENCE.setStatus(s)        -> 手动设置自身状态 online/away/busy
 * 事件：window 派发 CustomEvent('pk:presence', {detail:{users}})
 */
(function () {
  'use strict';

  var META = {
    online: { label: '在线', color: '#10b981', dot: '🟢' },
    idle:   { label: '小憩', color: '#f59e0b', dot: '🟡' },
    away:   { label: '暂离', color: '#94a3b8', dot: '⚪' },
    busy:   { label: '专注中', color: '#6366f1', dot: '🔵' },
    offline:{ label: '离线', color: '#64748b', dot: '⚫' }
  };

  var PK_PRESENCE = {
    _ws: null,
    _users: {},          // {uid: snapshot}
    _selfId: null,
    _handlers: [],
    _hb: null,           // heartbeat timer
    _reTimer: null,
    _reAttempt: 0,
    _lastActiveSent: 0,
    _serverSkew: 0,      // server_time - Date.now()/1000

    META: META,

    // ---------- 连接 ----------
    connect: function () {
      // 兼容两种 token 存储键名：pk_token_v1（混淆版）/ pk_token（明文版）
      var token = '';
      try {
        // 优先从 PK_AUTH_CLIENT 获取明文 token
        if (window.PK_AUTH_CLIENT && PK_AUTH_CLIENT._token) {
          token = PK_AUTH_CLIENT._token;
        } else {
          // 尝试从 localStorage 获取（兼容旧版和新版混淆存储）
          var t1 = localStorage.getItem('pk_token_v1');
          if (t1) {
            var obf = atob(t1);
            token = '';
            for (var i = 0; i < obf.length; i++) token += String.fromCharCode(obf.charCodeAt(i) ^ 0x5A);
          } else {
            token = localStorage.getItem('pk_token') || '';
          }
        }
      } catch(e) { token = ''; }
      if (!token) return;
      if (this._ws && this._ws.readyState <= 1) return;
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var url = proto + '//' + location.host + '/ws/presence?token=' + token;
      var self = this;
      try {
        this._ws = new WebSocket(url);
      } catch (e) { this._scheduleReconnect(); return; }

      this._ws.onopen = function () {
        self._reAttempt = 0;
        // 心跳保活
        clearInterval(self._hb);
        self._hb = setInterval(function () {
          if (self._ws && self._ws.readyState === 1) {
            self._ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
        self._sendActive(true);
      };

      this._ws.onmessage = function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (msg.type === 'pong') return;
        if (msg.type === 'error') { return; }
        if (msg.type === 'kick') {
          // PhaseB: 管理员结束会话
          clearInterval(self._hb);
          self._ws = null;
          self._users = {};
          self._emit();
          self._reAttempt = 99; // 阻止重连
          alert((msg.reason || '已被主理人结束会话'));
          return;
        }
        if (typeof msg.server_time === 'number') {
          self._serverSkew = msg.server_time - Date.now() / 1000;
        }
        if (msg.type === 'snapshot') {
          if (msg.self_id) self._selfId = msg.self_id;
          self._users = {};
          (msg.users || []).forEach(function (u) { self._users[u.user_id] = u; });
          self._emit();
        } else if (msg.type === 'presence_update' && msg.user) {
          self._users[msg.user.user_id] = msg.user;
          self._emit();
        } else if (msg.type === 'presence_offline') {
          delete self._users[msg.user_id];
          self._emit();
        }
      };

      this._ws.onclose = function (ev) {
        clearInterval(self._hb);
        self._ws = null;
        if (ev && ev.code === 4001) return; // 鉴权失败不重连
        self._scheduleReconnect();
      };
      this._ws.onerror = function () { /* 触发 onclose */ };
    },

    _scheduleReconnect: function () {
      var self = this;
      if (this._reTimer) return;
      if (!localStorage.getItem('pk_token')) return;
      this._reAttempt++;
      var delay = Math.min(3000 * this._reAttempt, 20000);
      this._reTimer = setTimeout(function () {
        self._reTimer = null;
        self.connect();
      }, delay);
    },

    disconnect: function () {
      clearInterval(this._hb);
      clearTimeout(this._reTimer);
      this._reTimer = null;
      this._reAttempt = 99; // 阻止自动重连
      if (this._ws) { try { this._ws.close(1000, 'logout'); } catch (_) {} this._ws = null; }
      this._users = {};
      this._emit();
    },

    // ---------- 活动信号 ----------
    _sendActive: function (force) {
      var now = Date.now();
      if (!force && now - this._lastActiveSent < 20000) return;
      this._lastActiveSent = now;
      if (this._ws && this._ws.readyState === 1) {
        this._ws.send(JSON.stringify({ type: 'active' }));
      }
    },

    setStatus: function (status) {
      if (this._ws && this._ws.readyState === 1) {
        this._ws.send(JSON.stringify({ type: 'status', status: status }));
      } else {
        fetch('/api/presence/status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: status })
        }).catch(function () {});
      }
    },

    // PhaseB: 上报所在页面/项目
    reportLocation: function (page, project, projectId) {
      if (this._ws && this._ws.readyState === 1) {
        this._ws.send(JSON.stringify({ type: 'location', page: page || '', project: project || '', project_id: projectId || 0 }));
      }
    },

    // PhaseB: 主理人 结束会话
    kickUser: function (uid) {
      return fetch('/api/presence/disconnect/' + uid, { method: 'POST' })
        .then(function (r) { return r.json(); })
        .catch(function () { return { ok: false }; });
    },

    // ---------- 查询 ----------
    list: function () {
      var arr = [];
      for (var k in this._users) arr.push(this._users[k]);
      // 在线 > 空闲 > 忙碌 > 离开，同级按显示名
      var order = { online: 0, busy: 1, idle: 2, away: 3, offline: 4 };
      arr.sort(function (a, b) {
        var d = (order[a.status] || 9) - (order[b.status] || 9);
        if (d) return d;
        return (a.display_name || '').localeCompare(b.display_name || '');
      });
      return arr;
    },
    get: function (uid) { return this._users[uid] || null; },
    statusOf: function (uid) { var u = this._users[uid]; return u ? u.status : 'offline'; },
    onlineCount: function () { return Object.keys(this._users).length; },

    on: function (fn) {
      this._handlers.push(fn);
      var self = this;
      return function () { self._handlers = self._handlers.filter(function (h) { return h !== fn; }); };
    },
    _emit: function () {
      var users = this.list();
      this._handlers.forEach(function (h) { try { h(users); } catch (_) {} });
      try { window.dispatchEvent(new CustomEvent('pk:presence', { detail: { users: users } })); } catch (_) {}
      this._renderIndicator();
    },

    // ---------- Header 在线指示器 ----------
    _injectIndicator: function (attempt) {
      attempt = attempt || 0;
      if (!localStorage.getItem('pk_token')) return;
      var actions = document.querySelector('.header-actions');
      if (!actions) { if (attempt < 40) setTimeout(this._injectIndicator.bind(this, attempt + 1), 250); return; }
      if (document.getElementById('pkPresenceWrap')) return;

      // 等用户按钮先就位，以便插到其后面
      var userBtn = document.getElementById('navDropdownUser');
      if (!userBtn && attempt < 40) { setTimeout(this._injectIndicator.bind(this, attempt + 1), 250); return; }

      var self = this;
      var wrap = document.createElement('div');
      wrap.id = 'pkPresenceWrap';
      wrap.className = 'nav-dropdown';
      wrap.style.cssText = 'position:relative;';
      var btn = document.createElement('button');
      btn.id = 'pkPresenceBtn';
      btn.className = 'header-btn';
      btn.title = '创作现场';
      btn.style.cssText = 'position:relative;';
      // 统一图标指示：图标颜色=聚合在线态，右上角人数徽标（无文字）
      btn.innerHTML = '<i class="bi bi-people-fill pkp-icon" style="font-size:16px;color:#64748b;"></i>'
        + '<span class="pkp-count" style="position:absolute;top:-2px;right:-4px;min-width:15px;height:15px;line-height:15px;padding:0 3px;border-radius:8px;background:#64748b;color:#fff;font-size:10px;font-weight:700;text-align:center;">0</span>';
      btn.onclick = function (e) { e.stopPropagation(); self._togglePop(); };
      wrap.appendChild(btn);

      // 插到用户按钮后面
      if (userBtn && userBtn.parentNode === actions) {
        if (userBtn.nextSibling) actions.insertBefore(wrap, userBtn.nextSibling);
        else actions.appendChild(wrap);
      } else {
        var ref = document.getElementById('pluginNavRight');
        if (ref && ref.parentNode === actions) actions.insertBefore(wrap, ref);
        else actions.appendChild(wrap);
      }

      this._renderIndicator();
    },

    _renderIndicator: function () {
      var btn = document.getElementById('pkPresenceBtn');
      if (!btn) return;
      var users = this.list();
      var activeN = users.filter(function (u) { return u.status === 'online' || u.status === 'busy'; }).length;
      var cnt = btn.querySelector('.pkp-count');
      var icon = btn.querySelector('.pkp-icon');
      var c = activeN > 0 ? '#10b981' : (users.length ? '#f59e0b' : '#64748b');
      if (icon) icon.style.color = c;
      if (cnt) { cnt.textContent = users.length; cnt.style.background = c; }
      // 若弹层开着，实时刷新
      if (document.getElementById('pkPresencePop')) this._renderPop();
    },

    _togglePop: function () {
      var ex = document.getElementById('pkPresencePop');
      if (ex) { ex.remove(); return; }
      var pop = document.createElement('div');
      pop.id = 'pkPresencePop';
      pop.style.cssText = 'position:fixed;z-index:10000;background:var(--bg-card,#1e293b);border:1px solid var(--border-color,#334155);'
        + 'border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.28);min-width:280px;max-width:340px;max-height:70vh;overflow:auto;padding:0;';
      var btn = document.getElementById('pkPresenceBtn');
      var r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.right = (window.innerWidth - r.right) + 'px';
      document.body.appendChild(pop);
      this._renderPop();
      var self = this;
      var closer = function (ev) {
        if (!pop.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) {
          pop.remove(); document.removeEventListener('click', closer);
        }
      };
      setTimeout(function () { document.addEventListener('click', closer); }, 10);
    },

    _renderPop: function () {
      var pop = document.getElementById('pkPresencePop');
      if (!pop) return;
      var users = this.list();
      var self = this;
      var h = '<div style="padding:12px 14px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between;">'
        + '<span style="font-size:13px;font-weight:700;color:var(--text-main,#f1f5f9);">🌐 局域网在线</span>'
        + '<span style="font-size:12px;color:var(--text-muted);">' + users.length + ' 人</span></div>';
      if (!users.length) {
        h += '<div style="padding:22px 14px;text-align:center;color:var(--text-muted);font-size:12px;">暂无其他创作者在线</div>';
      } else {
        h += '<div style="padding:6px 0;">';
        users.forEach(function (u) {
          var m = META[u.status] || META.offline;
          var ac = u.avatar_color || '#7c3aed';
          var av = (u.display_name || u.username || '?').charAt(0).toUpperCase();
          var isSelf = u.user_id === self._selfId;
          var roleName = { admin: '主理人', editor: '共创者', viewer: '鉴赏者' }[u.role] || u.role || '';
          var dev = (u.devices && u.devices[0]) ? u.devices[0].device : '';
          var multi = (u.connection_count > 1) ? (' ·+' + (u.connection_count - 1) + '设备') : '';
          var since = self._sinceText(u.connected_since);
          var loc = '';
          if (u.current_page) { loc += '📄 ' + _esc(u.current_page); }
          if (u.current_project) { loc += (loc ? ' · ' : '') + '🎬 ' + _esc(u.current_project); }
          var isAdmin = (self._users[self._selfId] || {}).role === 'admin';
          h += '<div style="padding:8px 14px;display:flex;align-items:center;gap:10px;">'
            + '<div style="position:relative;flex-shrink:0;"><div style="width:34px;height:34px;border-radius:10px;background:' + ac + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">' + av + '</div>'
            + '<span style="position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;background:' + m.color + ';border:2px solid var(--bg-card,#1e293b);"></span></div>'
            + '<div style="min-width:0;flex:1;">'
            + '<div style="font-size:13px;font-weight:600;color:var(--text-main,#f1f5f9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(u.display_name || u.username) + (isSelf ? ' <span style="font-size:10px;color:var(--text-muted);">(我)</span>' : '') + '</div>'
            + '<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
            + '<span style="color:' + m.color + ';font-weight:600;">' + m.label + '</span>'
            + (roleName ? ' · ' + roleName : '') + (dev ? ' · ' + _esc(dev) + multi : '') + '</div>'
            + (loc ? '<div style="font-size:10px;color:var(--text-muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + loc + '</div>' : '')
            + '</div>'
            + (since ? '<div style="font-size:10px;color:var(--text-muted);flex-shrink:0;">' + since + '</div>' : '')
            + (isAdmin && !isSelf ? '<button title="结束会话" onclick="event.stopPropagation();var ok=confirm(\'确定结束会话「'+_esc(u.display_name||u.username)+'」？\');if(ok)PK_PRESENCE.kickUser('+u.user_id+').then(function(d){if(d.ok){document.getElementById(\'pkPresencePop\').remove();}else{alert(\'操作未完成，稍后再试\')}});" style="flex-shrink:0;background:none;border:none;cursor:pointer;font-size:14px;padding:2px;opacity:0.6;" title="结束会话">🔌</button>' : '')
            + '</div>';
        });
        h += '</div>';
      }
      pop.innerHTML = h;
    },

    _sinceText: function (ts) {
      if (!ts) return '';
      var now = Date.now() / 1000 + (this._serverSkew || 0);
      var s = Math.max(0, now - ts);
      if (s < 60) return '刚上线';
      if (s < 3600) return Math.floor(s / 60) + '分钟';
      if (s < 86400) return Math.floor(s / 3600) + '小时';
      return Math.floor(s / 86400) + '天';
    },

    // ---------- 活动监听 ----------
    _bindActivity: function () {
      var self = this;
      ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) {
        window.addEventListener(ev, function () { self._sendActive(false); }, { passive: true });
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) self._sendActive(true);
      });
    },

    init: function () {
      this._bindActivity();
      this.connect();
      this._injectIndicator();
    }
  };

  function _esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  window.PK_PRESENCE = PK_PRESENCE;

  // 登录态就绪后启动
  function boot() {
    if (localStorage.getItem('pk_token')) PK_PRESENCE.init();
    else setTimeout(boot, 1500); // 未登录：等待登录后重试
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[PK_PRESENCE] presence client ready');
})();
