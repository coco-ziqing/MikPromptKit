/**
 * pk_common.js — PromptKit 前端公共底座 v1.0
 *
 * 目标：消除 15+ 前端模块重复的 fetch/toast/modal/auth/error 实现。
 * 用法：在 index.html 中作为第 2 个脚本加载（auth_client.js 的全局 fetch 拦截之后）
 *
 * 全局暴露 window.PK = {...}
 * - PK.toast(msg, type, duration)    统一 toast（DOM 驱动，不依赖 Bootstrap）
 * - PK.confirm(msg)                   异步确认对话框（基于 Bootstrap modal / 原生 confirm）
 * - PK.modal(html, opts)              通用 Modal 面板
 * - PK.user()                         当前用户对象（同步返回，从 PK_AUTH_CLIENT 读取）
 * - PK.requireAuth()                  未登录抛错误
 * - PK.api(url, opts)                 带 JSON 解析 + 统一错误处理的 fetch 包装
 * - PK.json(url, data, method)       POST/PUT JSON 快捷
 * - PK._esc(str)                      HTML 转义
 *
 * © 2026-07-16 T5 Phase1 — 不删除任何旧代码，纯新增
 */
(function() {
  'use strict';

  var PK = {};

  /* ── Toast 系统 ─────────────────────────── */
  var _toastContainer = null;
  function _ensureToastContainer() {
    if (!_toastContainer) {
      _toastContainer = document.getElementById('pkToastContainer');
      if (!_toastContainer) {
        _toastContainer = document.createElement('div');
        _toastContainer.id = 'pkToastContainer';
        _toastContainer.className = 'toast-container';
        document.body.appendChild(_toastContainer);
      }
    }
    return _toastContainer;
  }

  /**
   * PK.toast(msg, type, duration)
   * type: 'success'|'error'|'info'|'warning'  默认 'info'
   * duration: 毫秒，默认 3000，<=0 不自动关闭
   */
  PK.toast = function(msg, type, duration) {
    type = type || 'info';
    if (duration === undefined) duration = 3000;
    var c = _ensureToastContainer();
    var el = document.createElement('div');
    el.className = 'toast-msg toast-' + type;
    // 图标
    var icons = { success: '\u2705', error: '\u274c', info: '\u2139\ufe0f', warning: '\u26a0\ufe0f' };
    el.innerHTML = '<span style="margin-right:8px;">' + (icons[type] || icons.info) + '</span>' +
      PK._esc(msg) +
      '<span class="toast-close" style="margin-left:12px;cursor:pointer;opacity:.6;">&times;</span>';
    c.appendChild(el);
    // 关闭事件
    el.querySelector('.toast-close').onclick = function() { if (el.parentNode) el.parentNode.removeChild(el); };
    // 自动消失
    if (duration > 0) {
      setTimeout(function() {
        if (el.parentNode) {
          el.style.opacity = '0';
          el.style.transition = 'opacity .3s';
          setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
        }
      }, duration);
    }
    return el;
  };

  /* ── Confirm 对话框 ────────────────────── */
  /**
   * PK.confirm(msg) -> Promise<boolean>
   * 使用 Bootstrap Modal（已有），回退原生 confirm
   */
  PK.confirm = function(msg) {
    return new Promise(function(resolve) {
      // 优先使用 Bootstrap Modal 风格
      var backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop fade show';
      backdrop.style.zIndex = 1055;
      var box = document.createElement('div');
      box.className = 'modal d-block';
      box.style.zIndex = 1056;
      box.innerHTML =
        '<div class="modal-dialog modal-dialog-centered modal-sm"><div class="modal-content">' +
        '<div class="modal-body" style="font-size:15px;padding:28px 24px;">' + PK._esc(msg) + '</div>' +
        '<div class="modal-footer border-0 pt-0">' +
        '<button class="btn btn-secondary btn-sm pk-confirm-no">取消</button>' +
        '<button class="btn btn-primary btn-sm pk-confirm-yes">确定</button>' +
        '</div></div></div>';
      document.body.appendChild(backdrop);
      document.body.appendChild(box);
      function cleanup(result) {
        if (box.parentNode) box.parentNode.removeChild(box);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        resolve(result);
      }
      box.querySelector('.pk-confirm-yes').onclick = function() { cleanup(true); };
      box.querySelector('.pk-confirm-no').onclick = function() { cleanup(false); };
    });
  };

  /* ── User / Auth ───────────────────────── */
  PK.user = function() {
    var ac = window.PK_AUTH_CLIENT;
    return (ac && ac._user) || { role: 'anonymous' };
  };

  PK.requireAuth = function() {
    if (!PK.user().authenticated) {
      throw new Error('请先登录');
    }
  };

  /* ── API 快捷 ───────────────────────────── */
  /**
   * PK.api(url, opts) — 带统一 JSON 解析 + 错误 toast 的 fetch
   * 自动注入 auth token（依赖 PK_AUTH_CLIENT 的全局 fetch 拦截）
   * 返回解析后的 JSON 对象
   * opts.silent = true 时静默（不 toast 错误）
   */
  PK.api = function(url, opts) {
    opts = opts || {};
    return fetch(url, opts).then(function(r) {
      if (r.status === 204) return {};
      return r.json().then(function(d) {
        if (!r.ok) {
          var detail = d.detail || d.error || '请求失败 (' + r.status + ')';
          if (!opts.silent) PK.toast(detail, 'error');
          return Promise.reject({ status: r.status, detail: detail, data: d });
        }
        return d;
      });
    }).catch(function(e) {
      if (e && e.status) throw e;  // 已经是格式化的错误，透传
      var msg = e.message || '网络异常';
      if (!opts.silent) PK.toast(msg, 'error');
      return Promise.reject({ status: 0, detail: msg });
    });
  };

  /**
   * PK.json(url, data, method) — POST/PUT/PATCH JSON 快捷
   */
  PK.json = function(url, data, method) {
    if (!method) method = data !== undefined ? 'POST' : 'GET';
    return PK.api(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: data !== undefined ? JSON.stringify(data) : undefined
    });
  };

  /* ── HTML 转义 ──────────────────────────── */
  PK._esc = function(str) {
    if (str == null) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(''));
    d.textContent = str;
    return d.innerHTML;
  };

  /* ── 模态面板快捷（占位，各模块已有 self-consistent panel，暂不统一）─ */
  PK.modal = function(html, opts) {
    opts = opts || {};
    var m = document.createElement('div');
    m.className = 'modal d-block';
    m.style.zIndex = 1056;
    m.innerHTML = '<div class="modal-dialog modal-dialog-centered"' +
      (opts.width ? ' style="max-width:' + opts.width + 'px;"' : '') + '>' +
      '<div class="modal-content">' +
      (opts.noClose ? '' : '<div style="text-align:right;padding:8px 12px 0;">' +
        '<button class="btn-close btn-sm" onclick="this.closest(\'.modal\').remove();' +
        (document.querySelectorAll('.modal-backdrop.show').length > 0 ? '' : ' document.querySelector(\'.modal-backdrop\')?.remove();') +
        '" style="font-size:18px;cursor:pointer;"></button></div>') +
      '<div class="modal-body">' + html + '</div></div></div>';
    // backdrop
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade show';
    document.body.appendChild(backdrop);
    document.body.appendChild(m);
    return { el: m, backdrop: backdrop, close: function() {
      if (m.parentNode) m.parentNode.removeChild(m);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }};
  };

  /* ── 发布 ──────────────────────────────── */
  window.PK = PK;
  console.log('[PK.Common] v1 loaded');
})();
