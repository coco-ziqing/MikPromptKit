/**
 * PromptKit WebSocket 协作客户端 — Phase23.4
 * 看板/任务实时同步 + 在线状态 + 通知推送
 */
(function() {
  'use strict';

  var PK_WS = {
    _conn: null,
    _reconnectTimer: null,
    _masterId: null,
    _handlers: {},

    connect: function(masterId) {
      var self = this;
      if (self._conn && self._conn.readyState <= 1) {
        // Already connected or connecting
        if (self._masterId === masterId) return;
        self._conn.close();
      }

      self._masterId = masterId;
      var token = localStorage.getItem('pk_token') || '';
      if (!token) { console.log('[PK_WS] no auth token, skip WS connect'); return; }
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var url = proto + '//' + location.host + '/ws/collab/' + masterId + '?token=' + token;

      try {
        self._conn = new WebSocket(url);

        self._conn.onopen = function() {
          console.log('[PK_WS] Connected to project ' + masterId);
          // Heartbeat every 30s
          self._heartbeat = setInterval(function() {
            if (self._conn && self._conn.readyState === 1) {
              self._conn.send(JSON.stringify({type:'ping'}));
            }
          }, 30000);
        };

        self._conn.onmessage = function(e) {
          try {
            var msg = JSON.parse(e.data);
            if (msg.type === 'pong') return;
            if (msg.type === 'connected') {
              console.log('[PK_WS] Online users:', msg.online_users);
              self._fire('online', msg);
              return;
            }
            self._fire(msg.type, msg);
          } catch(err) {}
        };

        self._conn.onclose = function(ev) {
          console.log('[PK_WS] Disconnected (code=' + ev.code + ')');
          clearInterval(self._heartbeat);
          self._conn = null;
          self._fire('_closed', {code: ev.code});
          // 4001 = 鉴权失败，不重连以避免风暴
          if (ev.code === 4001) { self._masterId = null; return; }
          // Auto-reconnect after 3s
          if (!self._reconnectTimer) {
            self._reconnectTimer = setTimeout(function() {
              self._reconnectTimer = null;
              if (self._masterId) self.connect(self._masterId);
            }, 3000);
          }
        };

        self._conn.onerror = function() {
          // Will trigger onclose
        };

      } catch(e) {
        console.log('[PK_WS] Connection failed:', e.message);
      }
    },

    disconnect: function() {
      clearInterval(this._heartbeat);
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
      if (this._conn) {
        this._conn.close(1000, 'user_logout');
        this._conn = null;
      }
      this._masterId = null;
    },

    send: function(msgType, data) {
      if (!this._conn || this._conn.readyState !== 1) return;
      var msg = data || {};
      msg.type = msgType;
      this._conn.send(JSON.stringify(msg));
    },

    on: function(eventType, handler) {
      if (!this._handlers[eventType]) this._handlers[eventType] = [];
      this._handlers[eventType].push(handler);
    },

    _fire: function(eventType, data) {
      var hs = this._handlers[eventType] || [];
      hs.forEach(function(h) {
        try { h(data); } catch(e) {}
      });
    },

    // 便捷方法
    notifyTaskUpdate: function(task) {
      this.send('task_update', {task_id: task.id, changes: task});
    },

    notifyTaskMove: function(taskId, fromCol, toCol) {
      this.send('task_move', {task_id: taskId, from_column: fromCol, to_column: toCol});
    },

    notifyCursor: function(x, y) {
      this.send('cursor_move', {x: x, y: y});
    }
  };

  window.PK_WS = PK_WS;

  // 说明: 自动连接由 project_dashboard._selectMaster 直接调用 PK_WS.connect(id) 触发
  // (旧的猴子补丁因脚本加载顺序问题从未生效，已移除)

  // Register WS event handlers for kanban sync
  PK_WS.on('task_update', function(msg) {
    if (window.PK_ProjectDashboard && window.PK_ProjectDashboard._p3ActiveTab === 'kanban') {
      window.PK_ProjectDashboard._renderP3Kanban();
    }
  });
  PK_WS.on('task_move', function(msg) {
    if (window.PK_ProjectDashboard && window.PK_ProjectDashboard._p3ActiveTab === 'kanban') {
      window.PK_ProjectDashboard._renderP3Kanban();
    }
  });
  PK_WS.on('milestone_update', function(msg) {
    if (window.PK_ProjectDashboard && window.PK_ProjectDashboard._p3ActiveTab === 'milestones') {
      window.PK_ProjectDashboard._renderP3Milestones();
    }
  });
  PK_WS.on('user_joined', function(msg) {
    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast('👤 ' + msg.user + ' 已上线', 'info');
    }
  });
  PK_WS.on('user_left', function(msg) {
    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast('👋 ' + msg.user + ' 已离开', 'info');
    }
  });

  console.log('[PK_WS] WebSocket client ready');
})();
