// v4.1.0-phase7-9: 词卡模块桥接
// 将侧边栏模块列表、首页卡片、组装器选取全部接入 word_card 统一数据源
(function() {
'use strict';
if (!window.App || !App.fetchJSON) { setTimeout(arguments.callee, 200); return; }

// ============================================================
// 1. loadModules: 从 word_card_group 加载模块列表
// ============================================================
var _origLoadModules = App.loadModules;
App.loadModules = async function() {
    // 优先从 word_card_group 加载
    try {
        var d = await this.fetchJSON('/api/v4/word-cards/groups?include_empty=true');
        if (d && d.groups) {
            var modules = [];
            var seen = {};
            for (var i = 0; i < d.groups.length; i++) {
                var g = d.groups[i];
                if (g.group_type !== 'builtin' && g.group_type !== 'custom') continue;
                var key = g.group_key || g.name;
                if (seen[key]) continue;
                seen[key] = true;
                modules.push({
                    id: g.group_key,
                    name: g.name,
                    count: g.card_count,
                    builtin: g.group_type === 'builtin',
                    _group_id: g.id
                });
            }
            this.state.modules = modules;
            this.renderSidebar();
            return;
        }
    } catch(e) { console.warn('[wc-bridge] loadModules fallback:', e.message); }
    return _origLoadModules.call(this);
};

// ============================================================
// 2. switchModule: 切换模块时用 word_card API 加载卡片
// ============================================================
var _origSwitchModule = App.switchModule;
App.switchModule = async function(moduleId) {
    this.state.currentModule = moduleId;
    try { localStorage.setItem('promptkit_view','home'); localStorage.setItem('promptkit_module',moduleId); } catch(e) {}
    this.state.currentCategory = null;
    this.state.searchQuery = '';
    this.state.page = 1;
    var si = document.getElementById('searchInput');
    if (si) si.value = '';
    this.renderSidebar();
    this._closeMobileMenu();
    this.switchView('home', true);
    await this._wcLoadCategories(moduleId);
    await this._wcLoadPrompts();
    this._updatePageTitle();
};

// 分类加载（word_card 的 category 分组）
App._wcLoadCategories = async function(module) {
    this.state.categories = [];
    this.renderCategories();
};

// 卡片加载（word_card API）
App._wcLoadPrompts = async function() {
    var s = this.state;
    s.isLoading = true;
    if (!s.prompts.length) this.renderPrompts();

    var qs = 'page=' + s.page + '&page_size=' + s.pageSize;
    if (s.currentModule) qs += '&module=' + encodeURIComponent(s.currentModule);
    if (s.searchQuery) qs += '&search=' + encodeURIComponent(s.searchQuery);

    try {
        var d = await this.fetchJSON('/api/v4/word-cards?' + qs);
        s.isLoading = false;
        if (!d || !d.items) { this.renderPrompts(); return; }

        s.prompts = d.items.map(function(item) {
            var tags = item.tags || [];
            if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch(e) { tags = []; } }
            return {
                id: item.id,
                content: item.content,
                meaning: item.meaning || '',
                module: item.module || '',
                category: item.category || '',
                tags: JSON.stringify(tags),
                thumbnail: item.thumbnail || '',
                media_type: item.media_type || 'image',
                usage_count: item.usage_count || 0,
                is_builtin: item.is_builtin || false,
                collections: [],
                group_name: item.group_name || '',
                _source: 'word_card'
            };
        });
        s.totalItems = d.total;
        s.totalPages = d.total_pages || 1;
        this.renderPrompts();
        document.getElementById('countInfo').textContent = '共 ' + d.total + ' 条词卡';
    } catch(e) {
        s.isLoading = false;
        this.renderPrompts();
    }
};

// 重设 loadPrompts 为 word_card 源（首页初始加载）
var _origLoadPrompts = App.loadPrompts;
App.loadPrompts = function() {
    if (this.state.currentModule || this.state._searchMode === 'semantic') {
        return this._wcLoadPrompts();
    }
    // 无模块选中时用旧 API（保兼容）
    return _origLoadPrompts.call(this);
};

// 搜索也走 word_card
var _origSearch = App.search || function(){};
App._wcDoSearch = function() {
    this.state.page = 1;
    this.state.searchQuery = document.getElementById('searchInput').value.trim();
    this._wcLoadPrompts();
};

// Hook 全局搜索
if (typeof App.init === 'function') {
    var _origInit = App.init;
    App.init = function() {
        var origSearchInput = document.getElementById('searchInput');
        if (origSearchInput) {
            origSearchInput.setAttribute('onkeydown', "if(event.key==='Enter')App._wcDoSearch()");
        }
        return _origInit.apply(this, arguments);
    };
}

// ============================================================
// 3. 卡片右键菜单增加 "加入模块" 选项
// ============================================================

// Hook switchAllModules 也用 word_card
var _origSwitchAll = App.switchAllModules;
App.switchAllModules = function() {
    this.state.currentModule = null;
    this.state.currentCategory = null;
    this.state.searchQuery = '';
    this.state.page = 1;
    var si = document.getElementById('searchInput');
    if (si) si.value = '';
    try { localStorage.setItem('promptkit_view','home'); localStorage.removeItem('promptkit_module'); } catch(e) {}
    this.renderSidebar();
    this._closeMobileMenu();
    this.switchView('home', true);
    this.renderCategories();
    return this._wcLoadPrompts();
};

console.log('[wc-bridge] 侧边栏+首页接入 word_card 完成');
})();
