/**
 * PromptKit 通知中心客户端 — PhaseE
 * 连接 /ws/notifications/{user_id} 接收服务端实时推送，驱动铃铛图标+徽章。
 *
 * 推送消息格式：{type:"notification", payload:{id,event,title,body,category,created_at}}
 * 界面：Header 铃铛图标 + 未读徽章计数 + 下拉通知列表
 */
(function () {
  'use strict';
  var PK_NOTIF = {
    _ws: null,
    _hb: null,
    _reTimer: null,
    _reAttempt: 0,
    _unread: 0,
    _notifications: [],  // 最近 50 条
    _maxItems: 50,

    connect: function () {
      var token = localStorage.getItem('pk_token');
      if (!token) return;
      if (this._ws && this._ws.readyState <= 1) return;
      // 从 token 解析 user_id（JWT payload base64 decode）
      var uid = '';
      try {
        var parts = token.split('.');
        if (parts.length === 3) {
          uid = JSON.parse(atob(parts[1])).user_id;
        }
      } catch (e) { uid = '0'; }
      if (!uid) return;

      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var url = proto + '//' + location.host + '/ws/notifications/' + uid + '?token=' + token;
      var self = this;
      try { this._ws = new WebSocket(url); } catch (e) { this._scheduleReconnect(); return; }

      this._ws.onopen = function () {
        self._reAttempt = 0;
        clearInterval(self._hb);
        self._hb = setInterval(function () {
          if (self._ws && self._ws.readyState === 1) self._ws.send(JSON.stringify({ type: 'ping' }));
        }, 25000);
      };

      this._ws.onmessage = function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (msg.type === 'pong' || msg.type === 'connected') return;
        if (msg.type === 'notification') {
          self._add(msg.payload);
        }
      };

      this._ws.onclose = function (ev) {
        clearInterval(self._hb); self._ws = null;
        if (ev && ev.code === 4001) return;
        self._scheduleReconnect();
      };
      this._ws.onerror = function () {};
    },

    _scheduleReconnect: function () {
      var self = this;
      if (!localStorage.getItem('pk_token')) return;
      clearTimeout(this._reTimer);
      this._reAttempt++;
      var d = Math.min(3000 * this._reAttempt, 20000);
      this._reTimer = setTimeout(function () { self.connect(); }, d);
    },

    _add: function (payload) {
      if (!payload) return;
      // 去重
      if (this._notifications.length > 0 && this._notifications[0].id === payload.id) return;
      this._notifications.unshift(payload);
      if (this._notifications.length > this._maxItems) this._notifications.pop();
      this._unread++;
      this._render();
    },

    getNotifications: function () { return this._notifications; },
    clearUnread: function () { this._unread = 0; this._render(); },

    _injectBell: function (attempt) {
      attempt = attempt || 0;
      if (!localStorage.getItem('pk_token')) { if (attempt < 40) setTimeout(this._injectBell.bind(this, attempt + 1), 300); return; }
      var actions = document.querySelector('.header-actions');
      if (!actions) { if (attempt < 40) setTimeout(this._injectBell.bind(this, attempt + 1), 300); return; }
      if (document.getElementById('pkNotifBell')) return;

      var ref = document.getElementById('headerStats');
      if (!ref && attempt < 40) { setTimeout(this._injectBell.bind(this, attempt + 1), 300); return; }

      var self = this;
      var bell = document.createElement('button');
      bell.id = 'pkNotifBell';
      bell.className = 'header-btn';
      bell.title = '通知中心';
      bell.style.cssText = 'position:relative;';
      bell.innerHTML = '<i class="bi bi-bell" style="font-size:16px;color:#94a3b8;"></i>'
        + '<span id="pkNotifBadge" style="display:none;position:absolute;top:-3px;right:-6px;min-width:16px;height:16px;line-height:16px;padding:0 4px;border-radius:8px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;text-align:center;">0</span>';
      bell.onclick = function (e) { e.stopPropagation(); self._togglePop(); };

      // 插到 headerStats 前面
      if (ref && ref.parentNode === actions) {
        actions.insertBefore(bell, ref);
      } else {
        var pres = document.getElementById('pkPresenceWrap');
        if (pres && pres.parentNode === actions) actions.insertBefore(bell, pres);
        else actions.appendChild(bell);
      }
    },

    _render: function () {
      var badge = document.getElementById('pkNotifBadge');
      if (badge) {
        badge.textContent = this._unread > 99 ? '99+' : this._unread;
        badge.style.display = this._unread > 0 ? 'block' : 'none';
      }
      if (document.getElementById('pkNotifPop')) this._renderPop();
    },

    _togglePop: function () {
      var ex = document.getElementById('pkNotifPop');
      if (ex) { ex.remove(); return; }
      this.clearUnread();
      var pop = document.createElement('div');
      pop.id = 'pkNotifPop';
      pop.style.cssText = 'position:fixed;z-index:10001;background:var(--bg-card,#1e293b);border:1px solid var(--border-color);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.28);min-width:320px;max-width:380px;max-height:60vh;overflow:auto;padding:0;';
      var bell = document.getElementById('pkNotifBell');
      var r = bell.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.right = (window.innerWidth - r.right) + 'px';
      document.body.appendChild(pop);
      this._renderPop();
      var self = this;
      var closer = function (ev) {
        if (!pop.contains(ev.target) && ev.target !== bell && !bell.contains(ev.target)) {
          pop.remove(); document.removeEventListener('click', closer);
        }
      };
      setTimeout(function () { document.addEventListener('click', closer); }, 10);
    },

    _renderPop: function () {
      var pop = document.getElementById('pkNotifPop');
      if (!pop) return;
      var h = '<div style="padding:12px 14px;border-bottom:1px solid var(--border-color);font-size:13px;font-weight:700;color:var(--text-main);">🔔 通知中心</div>';
      if (!this._notifications.length) {
        h += '<div style="padding:30px 14px;text-align:center;color:var(--text-muted);font-size:12px;">暂无通知</div>';
      } else {
        h += '<div style="padding:4px 0;">';
        var self = this;
        this._notifications.forEach(function (n) {
          var ts = n.created_at ? n.created_at.substring(0, 16) : '';
          var icons = { 'asset_approve': '✅', 'asset_reject': '❌', 'member_add': '👤', 'member_remove': '👋',
                        'project_create': '📦', 'backup_done': '💾', 'user_kick': '🔌', 'alert': '⚠' };
          var icon = icons[n.category] || '📌';
          h += '<div style="padding:10px 14px;border-bottom:1px solid var(--border-color);cursor:default;">'
            + '<div style="display:flex;align-items:flex-start;gap:8px;">'
            + '<span style="font-size:16px;flex-shrink:0;">' + icon + '</span>'
            + '<div style="flex:1;min-width:0;">'
            + '<div style="font-size:12px;font-weight:600;color:var(--text-main);">' + _esc(n.title || n.event || '通知') + '</div>'
            + '<div style="font-size:11px;color:var(--text-muted);">' + _esc(n.body || '') + '</div>'
            + '</div>'
            + (ts ? '<div style="font-size:10px;color:var(--text-muted);flex-shrink:0;white-space:nowrap;">' + ts + '</div>' : '')
            + '</div></div>';
        });
        h += '</div>';
      }
      pop.innerHTML = h;
    },

    init: function () {
      this.connect();
      this._injectBell();
    }
  };

  function _esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  window.PK_NOTIF = PK_NOTIF;

  function boot() {
    if (localStorage.getItem('pk_token')) PK_NOTIF.init();
    else setTimeout(boot, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
