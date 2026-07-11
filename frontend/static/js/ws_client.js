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

  // Auto-connect when PM dashboard opens master project
  var _origSelectMaster = window.PK_ProjectDashboard && window.PK_ProjectDashboard._selectMaster;
  if (_origSelectMaster) {
    var orig = _origSelectMaster.bind(window.PK_ProjectDashboard);
    window.PK_ProjectDashboard._selectMaster = function(id) {
      PK_WS.connect(String(id));
      return orig(id);
    };
  }

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
