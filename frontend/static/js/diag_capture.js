/**
 * Phase17 v2: Complete Tracking Engine
 * — Session ID gen, breadcrumb trail, XMLHttpRequest hook, full action injection
 */
(function() {
    'use strict';

    // ============ Session ID ============
    var SESSION_ID = (function() {
        var stored = sessionStorage.getItem('_pk_session_id');
        if (!stored) {
            stored = 's' + Date.now().toString(36) + Math.random().toString(36).substring(2,8);
            sessionStorage.setItem('_pk_session_id', stored);
        }
        return stored;
    })();

    // ============ Breadcrumb Trail ============
    var _breadcrumbs = [];
    var MAX_CRUMBS = 40;

    function _addBreadcrumb(event, data) {
        _breadcrumbs.push({
            event: event || 'unknown',
            data: (data || '').toString().substring(0, 200),
            time: Date.now()
        });
        while (_breadcrumbs.length > MAX_CRUMBS) { _breadcrumbs.shift(); }
    }

    function _getBreadcrumbs() {
        return _breadcrumbs.slice(-20);
    }

    // ============ XMLHttpRequest Hook — 自动注入 X-Request-ID + X-Session-ID ============
    (function() {
        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;
        var _requestId = 0;

        XMLHttpRequest.prototype.open = function(method, url) {
            this._pk_method = method;
            this._pk_url = url;
            this._pk_start = Date.now();
            this._pk_rid = ++_requestId + '-' + SESSION_ID.substring(0,8);
            return origOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function(body) {
            var self = this;
            this.setRequestHeader('X-Request-ID', this._pk_rid);
            this.setRequestHeader('X-Session-ID', SESSION_ID);
            _addBreadcrumb('xhr_' + this._pk_method.toLowerCase(), this._pk_url);

            this.addEventListener('loadend', function() {
                var elapsed = Date.now() - self._pk_start;
                if (self.status >= 400) {
                    var detail = '';
                    try { detail = self.responseText.substring(0, 300); } catch(e) {}
                    _addBreadcrumb('xhr_error', self._pk_method + ' ' + self._pk_url + ' → ' + self.status + ' (' + elapsed + 'ms) ' + detail);
                    // 错误时上报面包屑
                    _flushBreadcrumbs();
                }
            });

            return origSend.apply(this, arguments);
        };
    })();

    // ============ fetch Hook — 同样注入 headers ============
    (function() {
        var origFetch = window.fetch;
        var _fid = 0;
        window.fetch = function(url, options) {
            options = options || {};
            options.headers = options.headers || {};
            var rid = (++_fid) + '-' + SESSION_ID.substring(0,8);
            // Headers object or plain object
            if (options.headers instanceof Headers) {
                options.headers.set('X-Request-ID', rid);
                options.headers.set('X-Session-ID', SESSION_ID);
            } else {
                options.headers['X-Request-ID'] = rid;
                options.headers['X-Session-ID'] = SESSION_ID;
            }
            var urlStr = typeof url === 'string' ? url : (url.url || 'unknown');
            _addBreadcrumb('fetch', (options.method || 'GET') + ' ' + urlStr);
            var start = Date.now();
            return origFetch.call(this, url, options).then(function(resp) {
                var elapsed = Date.now() - start;
                if (resp.status >= 400) {
                    _addBreadcrumb('fetch_error', urlStr + ' → ' + resp.status + ' (' + elapsed + 'ms)');
                    _flushBreadcrumbs();
                }
                return resp;
            });
        };
    })();

    // ============ Action Tracking — full injection ============
    var _ActionTracker = {
        _queue: [],
        _flushTimer: null,

        track: function(action, category, target, detail, elapsedMs) {
            this._queue.push({
                action: action || 'unknown',
                category: category || 'click',
                target: target || '',
                detail: detail || '',
                url: location.href,
                session_id: SESSION_ID,
                elapsed_ms: elapsedMs || 0,
                _time: Date.now()
            });
            _addBreadcrumb(category + '_' + action, target + ' ' + detail);

            if (category === 'error') { this._flush(); return; }
            if (this._queue.length >= 20) { this._flush(); }
            else if (!this._flushTimer) {
                var self = this;
                this._flushTimer = setTimeout(function() { self._flush(); }, 3000);
            }
        },

        _flush: function() {
            var self = this;
            if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
            var batch = this._queue.splice(0, 20);
            if (batch.length === 0) return;
            fetch('/api/logs/actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actions: batch })
            }).catch(function() {});
            if (this._queue.length > 0) {
                this._flushTimer = setTimeout(function() { self._flush(); }, 500);
            }
        }
    };

    // ============ Breadcrumb flush (on error) ============
    function _flushBreadcrumbs() {
        var crumbs = _getBreadcrumbs();
        if (crumbs.length === 0) return;
        try {
            navigator.sendBeacon('/api/logs/breadcrumbs', JSON.stringify({
                session_id: SESSION_ID,
                crumbs: crumbs
            }));
        } catch(e) {}
    }

    // ============ Global Error Capture (enhanced) ============
    var _origOnError = window.onerror;
    window.onerror = function(message, source, lineno, colno, error) {
        var stack = '';
        if (error && error.stack) stack = error.stack;
        else { try { throw new Error(); } catch(e) { stack = e.stack || ''; } }

        // 上报错误 + 面包屑
        var payload = {
            message: String(message).substring(0, 500),
            source: 'frontend',
            stack: stack.substring(0, 8000),
            url: (source || location.href).substring(0, 500),
            line: lineno || 0,
            col: colno || 0,
            session_id: SESSION_ID,
            breadcrumbs: _getBreadcrumbs()
        };

        try {
            fetch('/api/logs/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(function(){});
        } catch(e) {}

        _ActionTracker.track('unhandled_error', 'error', (source || '?') + ':' + lineno, String(message).substring(0, 200));

        console.error('[Phase17] Error:', message, stack.substring(0, 200));
        if (_origOnError) return _origOnError.apply(this, arguments);
        return false;
    };

    window.addEventListener('unhandledrejection', function(event) {
        var message = 'Unhandled Rejection: ' + String(event.reason || 'unknown');
        var stack = '';
        if (event.reason && event.reason.stack) stack = event.reason.stack;

        try {
            fetch('/api/logs/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message.substring(0, 500),
                    source: 'frontend',
                    stack: stack.substring(0, 8000),
                    url: location.href.substring(0, 500),
                    line: 0, col: 0,
                    session_id: SESSION_ID,
                    breadcrumbs: _getBreadcrumbs()
                })
            }).catch(function(){});
        } catch(e) {}
        _addBreadcrumb('rejection', message.substring(0, 200));
        _ActionTracker.track('promise_rejection', 'error', 'unhandled', message.substring(0, 200));
        console.error('[Phase17]', message);
    });

    // ============ Page lifecycle ============
    _addBreadcrumb('page_load', location.pathname);
    window.addEventListener('beforeunload', function() {
        _addBreadcrumb('page_unload', location.pathname);
        _ActionTracker._flush();
        _flushBreadcrumbs();
    });
    window.addEventListener('pagehide', function() {
        _ActionTracker._flush();
    });

    // ============ Inject tracking into App methods ============
    function injectTracking() {
        try { if (!App || !App.switchGroup) { setTimeout(injectTracking, 500); return; } } catch(e) { setTimeout(injectTracking, 500); return; }

        var T = _ActionTracker, A = App;

        function _wrap(fn, action, category, getTarget) {
            if (!fn) return fn;
            var wrapped = function() {
                var start = Date.now();
                var target = getTarget ? getTarget.apply(this, arguments) : '';
                var result = fn.apply(this, arguments);
                var elapsed = Date.now() - start;
                try { T.track(action, category, target, '', elapsed); } catch(e) {}
                return result;
            };
            return wrapped;
        }

        function _wrapAsync(fn, action, category, getTarget) {
            if (!fn) return fn;
            var wrapped = function() {
                var start = Date.now();
                var target = getTarget ? getTarget.apply(this, arguments) : '';
                try { T.track(action, category, target, '', 0); } catch(e) {}
                var result = fn.apply(this, arguments);
                // Chain .then to track elapsed
                if (result && result.then) {
                    result.then(function() {
                        var elapsed = Date.now() - start;
                        try { T.track(action + '_done', category, target, 'ok', elapsed); } catch(e) {}
                    }).catch(function(err) {
                        T.track(action + '_fail', 'error', target, String(err).substring(0, 150));
                    });
                }
                return result;
            };
            return wrapped;
        }

        // --- Nav ---
        if (A.switchGroup) A.switchGroup = _wrapAsync(A.switchGroup, 'switch_group', 'nav', function(gid) { return '分组#' + gid; });
        if (A.switchAllGroups) A.switchAllGroups = _wrap(A.switchAllGroups, 'switch_all', 'nav', function() { return '全部词组'; });

        // --- Card ops ---
        if (A.toggleSelect) A.toggleSelect = _wrap(A.toggleSelect, 'toggle_card', 'click', function(cid) { return '词卡#' + cid; });
        if (A.handleCopyLang) A.handleCopyLang = _wrap(A.handleCopyLang, 'copy_card', 'click', function(cid) { return '词卡#' + cid; });
        if (A.trashPrompt) A.trashPrompt = _wrapAsync(A.trashPrompt, 'trash_card', 'delete', function(cid) { return '词卡#' + cid; });

        // --- Edit mode ---
        var origTE = A.toggleEditMode;
        if (origTE) {
            A.toggleEditMode = function() {
                T.track('toggle_edit', 'edit', '编辑模式', this.state.editMode ? '关' : '开');
                return origTE.apply(this, arguments);
            };
        }

        // --- Search ---
        if (A._wcDoSearch) {
            var origS = A._wcDoSearch;
            A._wcDoSearch = function() {
                var q = (document.getElementById('searchInput') || {}).value || '';
                T.track('search', 'search', q.substring(0, 50), '');
                return origS.apply(this, arguments);
            };
        }

        // --- Word Editor ---
        if (A.wordEditor) {
            var WE = A.wordEditor;
            if (WE.open) WE.open = _wrapAsync(WE.open, 'open_editor', 'modal', function(o) { return o && o.cardId ? '编辑词卡#' + o.cardId : '新建词卡'; });
            if (WE._save) WE._save = _wrapAsync(WE._save, 'save_card', 'edit', function() { return '词卡#' + (this._cardId || 'new'); });
            if (WE._delete) WE._delete = _wrapAsync(WE._delete, 'delete_card', 'delete', function() { return '词卡#' + this._cardId; });
            if (WE._uploadThumb) WE._uploadThumb = _wrapAsync(WE._uploadThumb, 'upload_thumb', 'upload', function() { return '词卡#' + this._cardId; });
        }

        // --- Collections ---
        if (A.quickCollect) A.quickCollect = _wrap(A.quickCollect, 'click_collect_btn', 'click', function(cid) { return '词卡#' + cid; });
        if (A._doQuickCollect) A._doQuickCollect = _wrapAsync(A._doQuickCollect, 'add_to_collection', 'modal', function(cid) { return '分组#' + cid; });
        if (A.createCollection) A.createCollection = _wrapAsync(A.createCollection, 'create_collection', 'modal', function() { return document.getElementById('inputCollectionName') ? document.getElementById('inputCollectionName').value : ''; });
        if (A.removeFromCollection) A.removeFromCollection = _wrapAsync(A.removeFromCollection, 'remove_from_collection', 'delete', function(cid) { return '分组#' + cid; });

        // --- Group manage ---
        if (A.gmCreate) A.gmCreate = _wrapAsync(A.gmCreate, 'create_group', 'modal', function() { return document.getElementById('gmNewName') ? document.getElementById('gmNewName').value : ''; });
        if (A.gmDelete) A.gmDelete = _wrapAsync(A.gmDelete, 'delete_group', 'delete', function(gid) { return '分组#' + gid; });
        if (A._treeQuickAdd) A._treeQuickAdd = _wrapAsync(A._treeQuickAdd, 'quick_add_group', 'click', function(pid) { return '父分组#' + pid; });

        console.log('[Phase17] Tracking hooks: switchGroup/switchAll/toggleSelect/handleCopyLang/trashPrompt/toggleEdit/search/wordEditor(lifecycle)/collections(CRUD)/groups(CRUD)');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(injectTracking, 500); });
    } else {
        injectTracking();
    }

    // ============ Nav button ============
    function injectDiagBtn() {
        try { if (!App || !App.fetchJSON) { setTimeout(injectDiagBtn, 300); return; } } catch(e) { setTimeout(injectDiagBtn, 300); return; }
        var actions = document.querySelector('.header-actions');
        if (!actions || document.getElementById('btnDiagConsole')) return;
        var btn = document.createElement('button');
        btn.id = 'btnDiagConsole';
        btn.className = 'header-btn';
        btn.title = '诊断控制台 (实时日志+错误追踪+用户行为)';
        btn.innerHTML = '🩺';
        btn.style.cssText = 'position:relative;';
        // 错误计数红点
        var badge = document.createElement('span');
        badge.id = 'diagErrorBadge';
        badge.style.cssText = 'position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:#ef4444;display:none;';
        btn.appendChild(badge);
        btn.onclick = function() {
            App.logs.open();
            badge.style.display = 'none';
        };
        var fc = actions.firstChild;
        if (fc) actions.insertBefore(btn, fc);
        else actions.appendChild(btn);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(injectDiagBtn, 500); });
    } else {
        injectDiagBtn();
    }

    // ============ Error badge updater ============
    setInterval(function() {
        try {
            var badge = document.getElementById('diagErrorBadge');
            if (!badge) return;
            fetch('/api/logs/stats').then(function(r) { return r.json(); }).then(function(s) {
                if (s && s.stats && s.stats.error > 0) {
                    badge.style.display = 'block';
                    badge.title = s.stats.error + ' 错误已记录';
                }
            }).catch(function() {});
        } catch(e) {}
    }, 60000);

    console.log('[Phase17] Session=' + SESSION_ID + ' | Breadcrumbs=' + MAX_CRUMBS + ' | XHR/Fetch hooks active');
})();
