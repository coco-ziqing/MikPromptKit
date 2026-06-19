// ============================================================
// Phase13.5: 统一词卡数据模型 (Unified Card Model)
// 所有词卡操作的统一入口，封装 CRUD + 分组 + 搜索
// 替代零散的 fetchJSON 调用，确保所有视图数据一致
// ============================================================
(function() {
    'use strict';

    if (App.cardModel) return;

    App.cardModel = {
        _cache: {
            groups: null,
            cards: {},
            groupCards: {}
        },
        _listeners: []
    };

    // ==================== 分组操作 ====================

    /**
     * 获取所有分组列表（带缓存）
     */
    App.cardModel.getGroups = async function(force) {
        if (this._cache.groups && !force) return this._cache.groups;
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/groups?include_empty=true');
            this._cache.groups = (d && d.groups) || [];
            return this._cache.groups;
        } catch(e) {
            console.warn('[CardModel] getGroups failed:', e);
            return this._cache.groups || [];
        }
    };

    /**
     * 创建分组
     */
    App.cardModel.createGroup = async function(data) {
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/groups', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
            if (d && d.ok) {
                this._cache.groups = null; // 清缓存
                this._notify('group-created', d);
            }
            return d;
        } catch(e) {
            return {ok: false, error: e.message};
        }
    };

    /**
     * 更新分组
     */
    App.cardModel.updateGroup = async function(groupId, data) {
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/groups/' + groupId, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
            if (d && d.ok) this._cache.groups = null;
            return d;
        } catch(e) {
            return {ok: false, error: e.message};
        }
    };

    /**
     * 删除分组
     */
    App.cardModel.deleteGroup = async function(groupId) {
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/groups/' + groupId, {
                method: 'DELETE'
            });
            if (d && d.ok) this._cache.groups = null;
            return d;
        } catch(e) {
            return {ok: false, error: e.message};
        }
    };

    // ==================== 词卡 CRUD ====================

    /**
     * 获取词卡列表（支持筛选/搜索/分页）
     */
    App.cardModel.list = async function(params) {
        // params: { group_id, group_type, search, module, category, page, page_size, sort, order, is_builtin }
        var qs = [];
        if (params) {
            for (var k in params) {
                if (params[k] !== null && params[k] !== undefined && params[k] !== '') {
                    qs.push(k + '=' + encodeURIComponent(params[k]));
                }
            }
        }
        var url = '/api/v4/word-cards?' + qs.join('&');
        try {
            var d = await App.fetchJSON(url);
            return d || {ok: false, items: [], total: 0};
        } catch(e) {
            return {ok: false, items: [], total: 0, error: e.message};
        }
    };

    /**
     * 获取单张词卡
     */
    App.cardModel.get = async function(cardId) {
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/' + cardId);
            return d && d.card ? d.card : null;
        } catch(e) {
            return null;
        }
    };

    /**
     * 创建词卡（统一数据字段）
     */
    App.cardModel.create = async function(data) {
        var payload = this._normalize(data);
        try {
            var d = await App.fetchJSON('/api/v4/word-cards', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            if (d && d.ok) {
                this._cache.cards[d.id] = payload;
                this._notify('card-created', {id: d.id, ...payload});
            }
            return d;
        } catch(e) {
            return {ok: false, error: e.message};
        }
    };

    /**
     * 更新词卡
     */
    App.cardModel.update = async function(cardId, data) {
        var payload = this._normalize(data);
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/' + cardId, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            if (d && d.ok) {
                this._cache.cards[cardId] = {...this._cache.cards[cardId], ...payload};
                this._notify('card-updated', {id: cardId, ...payload});
            }
            return d;
        } catch(e) {
            return {ok: false, error: e.message};
        }
    };

    /**
     * 删除词卡
     */
    App.cardModel.delete = async function(cardId) {
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/' + cardId, {
                method: 'DELETE'
            });
            if (d && d.ok) {
                delete this._cache.cards[cardId];
                this._notify('card-deleted', {id: cardId});
            }
            return d;
        } catch(e) {
            return {ok: false, error: e.message};
        }
    };

    // ==================== 批量操作 ====================

    App.cardModel.batch = async function(action, ids, extra) {
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/batch', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: action,
                    ids: ids,
                    ...(extra || {})
                })
            });
            if (d && d.ok) {
                this._cache.cards = {};
                this._notify('batch-' + action, {ids: ids});
            }
            return d;
        } catch(e) {
            return {ok: false, error: e.message};
        }
    };

    // ==================== 导出/导入 ====================

    App.cardModel.exportCards = async function(params) {
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/export', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(params)
            });
            return d || {ok: false};
        } catch(e) {
            return {ok: false, error: e.message};
        }
    };

    // ==================== 事件监听 ====================

    App.cardModel.on = function(event, fn) {
        this._listeners.push({event: event, fn: fn});
    };

    App.cardModel.off = function(event, fn) {
        this._listeners = this._listeners.filter(function(l) {
            return !(l.event === event && l.fn === fn);
        });
    };

    App.cardModel._notify = function(event, data) {
        for (var i = 0; i < this._listeners.length; i++) {
            var l = this._listeners[i];
            if (l.event === event || l.event === '*') {
                try { l.fn(data); } catch(e) {}
            }
        }
    };

    // ==================== 数据标准化 ====================

    /**
     * 确保所有字段都有默认值
     */
    App.cardModel._normalize = function(data) {
        return {
            name: data.name || '',
            content: data.content || '',
            meaning: data.meaning || '',
            scene: data.scene || '',
            module: data.module || 'custom',
            category: data.category || '',
            tags: data.tags || [],
            icon: data.icon || '',
            thumbnail: data.thumbnail || '',
            preview_media: data.preview_media || '',
            media_type: data.media_type || 'image',
            group_id: data.group_id || null,
            sort_order: typeof data.sort_order === 'number' ? data.sort_order : 0,
            is_builtin: data.is_builtin || 0
        };
    };

    console.log('[CardModel] ready — 统一词卡数据模型已加载');
})();
