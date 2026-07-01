// ============================================================
// Phase13.5: 统一词卡数据模型 V2 (Unified Card Model)
// 每个独立词卡作为数据存储的基本单元，统一内含要素和功能
// 设计目标：
//   1. 一层模型 = 所有场景复用的基础单元
//   2. card_role 区分用途：prompt/component/asset/template
//   3. 可扩展：通过 structured(json) + card_role 支撑后续需求
//   4. 事件驱动：所有视图自动感知数据变更
//   5. 提供高级查询接口，供组装器/翻译器/导出器等模块调用
// ============================================================
(function() {
    'use strict';

    if (App.cardModel) return;

    App.cardModel = {
        _cache: {
            groups: null,
            cards: {},         // id → card
            groupCards: {},    // group_id → [card]
            byRole: {}         // role → [card]
        },
        _listeners: []
    };

    // ==================== 角色类型常量 ====================
    // card_role 是词卡的功能类型标记，直接影响使用方式
    // prompt:     完整提示词（可直接用于 AI 生成）
    // component:  镜头构成要素（供组装器拼接，含 field 映射）
    // asset:      词库资产（供参考/学习，不直接拼入）
    // template:   模板变量（含占位符 {{var}}，供模板引擎）
    // reference:  引用条目（外部来源，链接到源）
    // custom:     自定义（未分类，默认）
    App.cardModel.ROLES = {
        PROMPT: 'prompt',
        COMPONENT: 'component',
        ASSET: 'asset',
        TEMPLATE: 'template',
        REFERENCE: 'reference',
        CUSTOM: 'custom'
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
                this._cache.groups = null;
                this._notify('group-created', d);
            }
            return d;
        } catch(e) {
            return {ok: false, error: e.message};
        }
    };

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
     * 获取词卡列表
     * @param {Object} params - { group_id, group_type, search, module, category,
     *                           card_role, page, page_size, sort, order, is_builtin }
     */
    App.cardModel.list = async function(params) {
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
     * 创建词卡
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
                body: JSON.stringify({action: action, ids: ids, ...(extra || {})})
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

    // ==================== 高级查询（供组装器/翻译器/导出器使用） ====================

    /**
     * 按 field_key 查询词卡（组装器场景：根据字段名获取对应词库）
     * 映射规则：field_key → group_key → group → cards
     */
    App.cardModel.getCardsByField = async function(fieldKey) {
        if (!fieldKey) return [];
        // 直接从缓存查
        if (this._cache.groupCards[fieldKey]) return this._cache.groupCards[fieldKey];
        // 通过 API 查
        var groups = await this.getGroups();
        var group = null;
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].group_key === fieldKey) { group = groups[i]; break; }
        }
        if (!group) return [];
        var result = await this.list({group_id: group.id, page_size: 200});
        var cards = result.items || [];
        this._cache.groupCards[fieldKey] = cards;
        return cards;
    };

    /**
     * 按 card_role 查询词卡
     */
    App.cardModel.getCardsByRole = async function(role, params) {
        params = params || {};
        params.card_role = role;
        var result = await this.list(params);
        return result.items || [];
    };

    /**
     * 按标签查询词卡（支持 AND/OR）
     */
    App.cardModel.getCardsByTags = async function(tags, mode) {
        mode = mode || 'or';
        if (!tags || !tags.length) return [];
        var result = await this.list({search: tags.join(' '), page_size: 200});
        var items = result.items || [];
        // 后端按全文搜索，前端再做标签精确过滤
        return items.filter(function(card) {
            var cardTags = [];
            if (typeof card.tags === 'string') {
                try { cardTags = JSON.parse(card.tags); } catch(e) { cardTags = []; }
            } else if (Array.isArray(card.tags)) {
                cardTags = card.tags;
            }
            if (mode === 'and') {
                return tags.every(function(t) { return cardTags.indexOf(t) >= 0; });
            } else {
                return tags.some(function(t) { return cardTags.indexOf(t) >= 0; });
            }
        });
    };

    /**
     * 获取同组相邻词卡（用于"上一条/下一条"导航）
     */
    App.cardModel.getSiblings = async function(cardId, groupId) {
        var cards = [];
        if (groupId) {
            if (this._cache.groupCards[groupId]) {
                cards = this._cache.groupCards[groupId];
            } else {
                var result = await this.list({group_id: groupId, page_size: 200});
                cards = result.items || [];
                this._cache.groupCards[groupId] = cards;
            }
        }
        var idx = -1;
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].id === cardId) { idx = i; break; }
        }
        return {
            cards: cards,
            index: idx,
            prev: idx > 0 ? cards[idx - 1] : null,
            next: idx < cards.length - 1 ? cards[idx + 1] : null
        };
    };

    // ==================== 词卡快照（用于版本对比/撤销） ====================

    App.cardModel.snapshot = function(card) {
        return JSON.parse(JSON.stringify(card));
    };

    App.cardModel.diff = function(oldCard, newCard) {
        var changes = [];
        var fields = ['name', 'content', 'meaning', 'scene', 'module', 'category', 'tags', 'icon', 'sort_order'];
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var oldVal = oldCard ? JSON.stringify(oldCard[f]) : 'undefined';
            var newVal = JSON.stringify(newCard[f]);
            if (oldVal !== newVal) {
                changes.push({field: f, old: oldCard ? oldCard[f] : null, new: newCard[f]});
            }
        }
        return changes;
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

    // ==================== 数据标准化 V2 ====================

    /**
     * 统一词卡基础单元 —— 完整字段定义
     * 每个词卡独立包含所有要素，按职能分层：
     *
     *  ┌── 标识层 ──────────────────────────────────┐
     *  │  id, group_id, uuid, name, card_role       │
     *  ├── 内容层 ──────────────────────────────────┤
     *  │  content(主文本), meaning(释义),            │
     *  │  scene(场景说明), tags(标签数组)            │
     *  ├── 分类层 ──────────────────────────────────┤
     *  │  module(所属模块), category(二级分类)       │
     *  ├── 视觉层 ──────────────────────────────────┤
     *  │  icon(Emoji), thumbnail(缩略图),           │
     *  │  preview_media(视频预览), media_type       │
     *  ├── 运营层 ──────────────────────────────────┤
     *  │  usage_count, heat_weight, sort_order,     │
     *  │  version, source(来源标记)                 │
     *  ├── 拓展层 ──────────────────────────────────┤
     *  │  structured(JSON, 任意结构化数据)           │
     *  │  source_id(关联外链), is_builtin            │
     *  └── 元数据 ──────────────────────────────────┘
     *        created_at, updated_at, is_deleted
     *
     *  扩展方式：新增功能只需结构化字段 + card_role 组合
     *  示例：
     *  - 组装器镜头要素：card_role=component, structured={field_map:{...}}
     *  - 翻译源词卡：card_role=prompt, structured={source_lang:'zh', target_lang:'en'}
     *  - 模板变量：card_role=template, structured={variables:['{{name}}','{{scene}}']}
     */
    App.cardModel._normalize = function(data) {
        // card_role 自动推断
        var role = data.card_role || App.cardModel.ROLES.CUSTOM;
        // 如果 group_key 属于组装器维度字段，自动标记为 component
        if (role === App.cardModel.ROLES.CUSTOM && data.group_key) {
            var composerFields = ['camera_move', 'subject', 'scene_desc', 'composition', 'lighting',
                'action', 'focal_length', 'texture', 'speed', 'emotion', 'color_grade', 'weather',
                'particles', 'perspective', 'depth_of_field', 'filter', 'natural_force',
                'environment_detail', 'film_flaw', 'fantasy_physics', 'character_voice', 'bgm', 'sfx'];
            for (var i = 0; i < composerFields.length; i++) {
                if (data.group_key === composerFields[i]) {
                    role = App.cardModel.ROLES.COMPONENT;
                    break;
                }
            }
        }

        return {
            // 标识层
            name: data.name || '',
            card_role: role,

            // 内容层
            content: data.content || '',
            meaning: data.meaning || '',
            scene: data.scene || '',
            tags: data.tags || [],

            // 分类层
            module: data.module || 'custom',
            category: data.category || '',
            group_id: data.group_id || null,

            // 视觉层 — 仅在显式传入时包含（避免保存时覆盖已上传的缩略图/视频）
            icon: data.icon || '',
            ...(('thumbnail' in data) ? { thumbnail: data.thumbnail || '' } : {}),
            ...(('preview_media' in data) ? { preview_media: data.preview_media || '' } : {}),
            ...(('media_type' in data) ? { media_type: data.media_type || 'image' } : {}),

            // 运营层
            sort_order: typeof data.sort_order === 'number' ? data.sort_order : 0,
            heat_weight: typeof data.heat_weight === 'number' ? data.heat_weight : 0.5,
            usage_count: data.usage_count || 0,
            source: data.source || 'manual',

            // 拓展层（万能扩展点）
            structured: data.structured || {},
            source_id: data.source_id || null,
            is_builtin: data.is_builtin || 0
        };
    };

    // ==================== 工具方法 ====================

    /**
     * 获取卡片的显示名称
     */
    App.cardModel.displayName = function(card) {
        if (card.name) return card.name;
        if (card.content) {
            return card.content.length > 40 ? card.content.substring(0, 40) + '...' : card.content;
        }
        return '(未命名)';
    };

    /**
     * 获取卡片的图标（带默认回退）
     */
    App.cardModel.displayIcon = function(card) {
        if (card.icon) return card.icon;
        var roleIcons = {
            prompt: '✨',
            component: '🧩',
            asset: '📚',
            template: '📋',
            reference: '🔗',
            custom: '📄'
        };
        return roleIcons[card.card_role] || '📄';
    };

    console.log('[CardModel V2] ready — 统一词卡数据模型已加载, card_role 系统就绪');
})();
