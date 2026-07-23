/**
 * PromptKit — 核心框架模块 (app_core.js)
 * 状态/初始化/事件/视图/搜索/数据/模块/复制/模板变量/Toast
 * 自动生成 — 勿手动编辑
 */

// P0-3 XSS 防护：全局 HTML 转义函数（所有 innerHTML 赋值前调用）
function _escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// var 而非 const — 必须设置 window.App 供其他 script 标签通过 window.App 访问
var App = window.App || {

    // ============ 状态 ============
    state: {
        currentView: 'home',
        currentModule: null,
        currentCategory: null,
        searchQuery: '',
        modules: [],
        categories: [],
        prompts: [],
        totalItems: 0, totalPages: 1, page: 1, pageSize: 50,
        isLoading: false,
        stats: { total_prompts: 0, total_usage: 0 },
        batchSelected: new Set(),
        _batchSelections: {},   // { groupId_or_"__all__": Set(id1,id2,...) } 分组选择态持久化
        _cardLang: {},          // { promptId: 'original'|'zh'|'en' } 卡片当前显示语言
        editMode: false,
        _searchMode: 'keyword',  // 'keyword' | 'semantic'
        _editFilterQuery: '',
        _editFilterModule: '',
        _editFilterCollected: '',
        _cardTranslations: {},
        _epItems: [],
        _newPromptModule: '',
        _diIsPt: false,
        _diPtFile: null,
        _exportQueue: null,
        _diIsPng: false,
        _diPngFile: null,
        _diPngBuffer: null,
        _diPngName: '',
        // 收藏夹
        collections: [],
        currentCollection: null,
        collectionItems: [],
        collectionPage: 1,
        // 词包
        wordpacks: [],
        currentWordpack: null,
        // 推荐
        currentPromptId: null,
        theme: 'dark',
        columns: 3,  // 卡片列数
        _orientationLock: null,  // 移动端方向锁定: null=自动, 'portrait', 'landscape'
        // Seedance
        seedanceView: 'composer',
        seedanceCategory: null,
        seedanceTemplates: [],
        seedanceTotal: 0,
        seedancePage: 1,
        seedanceTotalPages: 1,
        seedanceCategories: [],
        gallery: []
    },

    // ============ Phase13.2: 骨架屏 + 安全请求 ============

    showSkeleton(count) {
        var n = count || 6;
        var html = '<div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">';
        for (var i = 0; i < n; i++) {
            html += '<div class="skeleton-card"><div class="skeleton-line skeleton-title"></div><div class="skeleton-line skeleton-text"></div><div class="skeleton-line skeleton-text"></div><div class="skeleton-line skeleton-text-short"></div></div>';
        }
        html += '</div>';
        var pl = document.getElementById('promptList');
        if (pl) pl.innerHTML = html;
    },

    // ============ 分组批量选择持久化 ============
    // 获取当前分组的 batchSelected Set（自动创建）
    _getBatchKey: function() { return this.state.currentGroupId || '__all__'; },

    // 保存当前分组的选中态 → 切换到目标分组
    _swapBatchSet: function(targetGroupId) {
        var oldKey = this.state.currentGroupId || '__all__';
        var newKey = targetGroupId || '__all__';
        // 保存当前选中态
        if (this.state.batchSelected.size > 0) {
            this.state._batchSelections[oldKey] = new Set(this.state.batchSelected);
        } else {
            delete this.state._batchSelections[oldKey];
        }
        // 恢复目标分组选中态
        var saved = this.state._batchSelections[newKey];
        this.state.batchSelected = saved ? new Set(saved) : new Set();
    },

    // 翻译按钮渲染辅助：按钮显示「点击后切换到的目标语言」（对立面）
    // 卡片显示中文 → 按钮="🌐 英文"；显示英文 → 按钮="🌐 中文"
    _transBtnLabel: function(p) {
        var lang = (this.state._cardLang || {})[p.id] || 'original';
        var isCN = /[\u4e00-\u9fff]/.test(p.content || '');
        // 当前实际显示的语言
        var current = lang === 'zh' ? 'zh' : (lang === 'en' ? 'en' : (isCN ? 'zh' : 'en'));
        // 按钮显示对立面
        return current === 'zh' ? '🌐 英文' : '🌐 中文';
    },

    _transBtnStyle: function(pid, prop) {
        var lang = (this.state._cardLang || {})[pid] || 'original';
        return lang !== 'original' ? '#22c55e' : '#6366f1';
    },

    // 卡片内容：根据当前语言返回原文/中文/英文
    _transContent: function(p) {
        var lang = (this.state._cardLang || {})[p.id] || 'original';
        if (lang === 'zh' && p.content_zh) return p.content_zh;
        if (lang === 'en' && p.content_en) return p.content_en;
        return p.content || '';
    },

    _safeFetch: async function(url, options) {
        try {
            var resp = await fetch(url, options);
            if (!resp.ok) {
                var text = '';
                try { text = await resp.text(); } catch(e) {}
                var errMsg = App._t('auto.str_67411e24', '请求未响应: ') + resp.status;
                try { var j = JSON.parse(text); if (j.detail) errMsg = j.detail; } catch(e) {}
                this.showToast(errMsg, 'error');
                return null;
            }
            if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      if (!resp.ok) throw new Error('HTTP '+resp.status); return await resp.json();
        } catch (e) {
            this.showToast(App._t('auto.str_57c2b634', '网络不太稳定，请稍后重试: ') + e.message, 'error');
            return null;
        }
    },

    // ============ 初始化 ============
    // ============ 版本号同步(单一声源: 后端 /api/status) ============
    _syncVersion() {
        var self = this;
        this.fetchJSON('/api/status').then(function(d) {
            if (d && d.version) {
                var v = d.version;
                // 美化显示
                var displayVersion = v.replace(/^v+/i, '').replace('-phase', '.');
                document.title = App._t('auto.str_c5da0d84', '咪卡Mik词库');
                var bv = document.getElementById('brandVersion');
                if (bv) bv.textContent = v.replace(/^v+/i, '');  // 去除所有前导v前缀，只显示数字
                // 同时更新 headerStats
                var hs = document.getElementById('headerStats');
                if (hs) hs.textContent = v.replace(/^v+/i, '') + ' | 词库 ' + (d.total_prompts||0) + ' 条 | 使用 ' + (d.total_usage||0) + ' 次';
            }
        }).catch(function(){});
    },

    // 语言切换按钮初始化
    _initLangBtn() {
        var btn = document.getElementById('btnLang');
        if (!btn) return;
        var self = this;
        btn.onclick = function() {
            var nextLang = App._i18nCurrent === 'zh-CN' ? 'en' : 'zh-CN';
            App.switchLang(nextLang);
        };
    },

    async init() {
        // 恢复主题
        const savedTheme = ((typeof localStorage !== 'undefined' && localStorage.getItem) ? localStorage.getItem('promptkit_theme') : 'dark') || 'dark';
        this.applyTheme(savedTheme);

        // 恢复列数设置
        var savedCols = localStorage.getItem('promptkit_columns') || '3';
        this.state.columns = parseInt(savedCols);
        var label = document.getElementById('columnLabel');
        if (label) label.textContent = savedCols;
        this.applyColumns();
        this._initOrientation();  // 移动端横竖屏检测+锁定

        // 恢复编辑模式状态（必须在 switchView 之前恢复，确保初始渲染正确）
        if ((typeof localStorage !== 'undefined' && localStorage.getItem('promptkit_editmode') === '1')) {
            this.state.editMode = true;
        }

        // 提前读取保存的视图状态，避免 switchView('home') 覆写 localStorage
        var savedView = (typeof localStorage !== 'undefined' && localStorage.getItem('promptkit_view')) || null;
        var savedModule = (typeof localStorage !== 'undefined' && localStorage.getItem('promptkit_module')) || null;

        this.bindEvents();
        this._initDropZone();
        this._syncVersion();
        // 语言切换按钮事件绑定
        this._initLangBtn();
        
        // 初始默认显示 home 视图（延迟到树加载完成后渲染）
        // 先不调用 switchView，等 tree 加载完再渲染
        document.getElementById('viewHome').classList.add('active-view');
        // 搜索框已迁至词库页 header 行内，导航栏不再显示
        
        try {
            // Phase38: 并行加载：树 + 统计 + 收藏 + 词包 + 模型配置
            await Promise.all([
                this.loadGroupTree().then(function() {
                    var savedGroupId = null;
                    try { savedGroupId = localStorage.getItem('promptkit_group_id'); } catch(e) {}
                    if (savedGroupId && parseInt(savedGroupId)) {
                        App.state.currentGroupId = parseInt(savedGroupId);
                        App.state.currentGroupName = '';
                    }
                }),
                this.loadStats(),
                this.loadCollections(),
                this.loadWordpacks(),
                this._loadAIModelConfig()
            ]);

            // 恢复上次的视图状态（savedView/savedModule 已在 init 顶部读取）

            // v4.0.0-phase11: 启动自检（延迟给UI先渲染）
            // v4.1.0-hotfix: 仅服务重启后首次加载执行自检，普通刷新跳过（sessionStorage 标记）
            try {
                if (!sessionStorage.getItem('_pk_health_checked')) {
                    sessionStorage.setItem('_pk_health_checked', '1');
                    setTimeout(function() {
                        if (App.healthCheck && typeof App.healthCheck.autoCheck === 'function') {
                            App.healthCheck.autoCheck();
                        }
                    }, 1200);
                }
            } catch(e) {}
            // 自检之后始终启动信号灯
            setTimeout(function() {
                if (App.signalLights && typeof App.signalLights.init === 'function') {
                    App.signalLights.init();
                }
            }, 1500);

            if (savedView === 'seedance') {
                this.switchView('seedance');
                var savedSeedanceTab = localStorage.getItem('promptkit_seedance_tab');
                var hash = window.location.hash;
                if (!savedSeedanceTab && hash.indexOf('/composer') > 0) {
                    savedSeedanceTab = 'composer';
                }
                if (!savedSeedanceTab) savedSeedanceTab = 'composer';
                setTimeout(function() { App.switchSeedanceTab(savedSeedanceTab); }, 100);
            } else if (savedView === 'collections' || savedView === 'wordpacks' || savedView === 'history' || savedView === 'trash') {
                this.switchView(savedView);
            } else if (savedModule && this.state.modules && this.state.modules.find(function(m) { return m.id === savedModule; })) {
                this.switchModule(savedModule);
            } else if (this.state.currentGroupId) {
                // Phase14: 有保存的分组 → 加载该分组词卡
                this.switchGroup(this.state.currentGroupId, this.state.currentGroupName || '');
            } else {
                // Phase14: 无分组 → 显示陈列架
                this._showShowcase();
            }

            // 编辑模式恢复后同步 UI（需在数据加载完成后）
            if (this.state.editMode) {
                var eb = document.getElementById('batchBar');
                var fb = document.getElementById('editFilterBar');
                var btn = document.getElementById('btnEditMode');
                if (eb) eb.style.display = 'flex';
                if (fb) fb.style.display = 'block';
                if (btn) { btn.style.color = '#4f46e5'; btn.classList.add('active'); }
            }
        } catch (e) {
            console.warn('Init error, fallback to home:', e.message);
            this.switchView('home');
            this.loadPrompts();
        }

        // Phase17.1: 自动修复缺失视频首帧封面（每个会话只执行一次）
        this._repairMissingPosters();
    },

    // Phase17.1: 每会话一次，自动修复缺失视频首帧封面
    _repairMissingPosters() {
        try {
            if ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('_pk_poster_repaired'))) return;
            sessionStorage.setItem('_pk_poster_repaired', '1');
            var self = this;
            this.fetchJSON('/api/thumbnails/repair-missing-posters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }).then(function(r) {
                if (r && r.total_fixed > 0) {
                    console.log('[repair] 视频首帧修复完成：' + r.total_fixed + ' 条');
                    // 修复后刷新当前视图，让新 thumbnail 即刻显示
                    if (self.state.currentView === 'home') {
                        self.loadPrompts();
                    }
                }
            }).catch(function(e) {
                // 静默未完成，不影响正常使用
            });
        } catch(e) {}
    },

    // ============ 事件绑定 ============
    bindEvents() {
        const searchInput = document.getElementById('searchInput');
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                this.state.searchQuery = searchInput.value.trim();
                this.state.page = 1;
                if (this.state._searchMode === 'semantic' && this.state.searchQuery) {
                    this._semanticSearch(this.state.searchQuery);
                } else {
                    this.loadPrompts();
                }
            }, 300);
        });

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
            // Ctrl+Z 撤销缩略图替换
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                var keys = Object.keys(this._undoThumbnailState);
                if (keys.length > 0) {
                    e.preventDefault();
                    // 撤销最后被替换的卡片
                    var lastId = parseInt(keys[keys.length - 1]);
                    this._undoThumbnailReplace(lastId);
                }
            }
        });

        // 全局点击关闭下拉菜单 + 菜单项点击自动收起
        document.addEventListener('click', function(e) {
            // 点击菜单项 → 自动关闭所有下拉
            if (e.target.closest('.nav-dropdown-item')) {
                document.querySelectorAll('.nav-dropdown.open').forEach(function(dd) {
                    dd.classList.remove('open');
                });
                return;
            }
            // 点击下拉菜单外部 → 关闭
            if (!e.target.closest('.nav-dropdown')) {
                document.querySelectorAll('.nav-dropdown.open').forEach(function(dd) {
                    dd.classList.remove('open');
                });
            }
        });

        setInterval(() => this.loadStats(), 30000);
    },

    // ============ 导航栏下拉菜单 ============
    _toggleDropdown(dropdownId) {
        var dd = document.getElementById(dropdownId);
        if (!dd) return;
        var isOpen = dd.classList.contains('open');
        // 关闭所有
        document.querySelectorAll('.nav-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
        // 切换当前
        if (!isOpen) dd.classList.add('open');
    },

    // ============ 视图切换 ============
    switchView(view) {
        this.state.currentView = view;
        // 保存视图状态到 localStorage
        try { localStorage.setItem('promptkit_view', view); } catch(e) {}
        // PhaseB: 上报所在页面
        if (window.PK_PRESENCE) {
            var pageMap = {'home':'词库','collections':'词卡收藏','seedance':'分镜','v4media':'媒体资产','composer':'组装器'};
            PK_PRESENCE.reportLocation(pageMap[view] || view, '', 0);
        }

        // 隐藏所有视图
        document.querySelectorAll('.view-panel').forEach(function(el) { el.classList.remove('active-view'); });
        // 导航按钮状态（下拉菜单模式下，仅保留有独立按钮的）
        document.querySelectorAll('.header-btn.nav-active').forEach(function(el) { el.classList.remove('nav-active'); });

        // Phase18-fix: 所有 getElementById 加空检查，防止分组切换竞态 classList null 崩溃
        var _safeShow = function(elId) { var e = document.getElementById(elId); if (e) e.classList.add('active-view'); };
        var _sbox = function(v) { var e = document.getElementById('globalSearchBox'); if (e) e.style.display = (v==='visible')?'none':'none'; };
        if (view === 'home') {
            _safeShow('viewHome');
            _sbox('visible');
            this._showSidebar();
            this._expandSidebar();
            this.renderSidebar();
            this.loadPrompts();
            // 标题由 loadPrompts → _wcLoadPrompts 在数据加载后设定，此处不覆盖
        } else if (view === 'collections') {
            _safeShow('viewCollections');
            this._hideSearchBox();
            this.renderCollections();
        } else if (view === 'wordpacks') {
            _safeShow('viewWordpacks');
            this._hideSearchBox();
            this.renderWordpacks();
        } else if (view === 'history') {
            _safeShow('viewHistory');
            this._hideSearchBox();
            this.loadHistory();
        } else if (view === 'trash') {
            _safeShow('viewTrash');
            this._hideSearchBox();
            this.loadTrash();
        } else if (view === 'v4media') {
            _safeShow('viewV4media');
            this._hideSearchBox();
            this._showSidebar();
            this._collapseSidebar();
            this.loadV4Media();
        } else if (view === 'seedance') {
            this.state.currentModule = 'seedance';
            this.renderSidebar();
            this._closeMobileMenu();
            _safeShow('viewSeedance');
            this._hideSearchBox();
            this._showSidebar();
            this._collapseSidebar();  // 组装器不需要功能模块侧边栏，自动折叠
            this.loadSeedanceCategories();
            this.loadSeedanceTemplates();
            // 默认切到组装器（index.html 已将 composer 面板设为可见）
            var activeTab = localStorage.getItem('promptkit_seedance_tab') || 'composer';
            this.switchSeedanceTab(activeTab);
        } else if (view === 'wcmanager') {
            // v4.1.0: 词卡管理面板
            var wp = document.getElementById('viewWCManager');
            if (!wp) {
                wp = document.createElement('div');
                wp.id = 'viewWCManager';
                wp.className = 'view-panel';
                document.getElementById('mainContent').appendChild(wp);
            }
            wp.classList.add('active-view');
            var nw = document.getElementById('navWCManager');
            if (nw) nw.classList.add('active');
            this._hideSearchBox();
            this._showSidebar();
            this._collapseSidebar();
            if (App.wordCards && App.wordCards.load) App.wordCards.load();
        } else if (view === 'atom_editor' || view === 'character_composer' || view === 'scene_composer' || view === 'unified_composer') {
            // Phase16+: 猴补丁安全网 — 通用视图切换清理 + 导航高亮
            var _navMap2 = {
                'atom_editor': 'navAtomEditor',
                'character_composer': 'navCharacterComposer',
                'scene_composer': 'navSceneComposer',
                'unified_composer': 'navUnifiedComposer'
            };
            var _navId2 = _navMap2[view];
            var _navEl2 = document.getElementById(_navId2);
            if (_navEl2) _navEl2.classList.add('active');
            this._hideSearchBox();
            this._showSidebar();
            this._collapseSidebar();
            // 猴补丁负责具体面板渲染；这里仅做通用清理 + 导航高亮
        } else if (view === 'project_mgmt') {
            // Phase18+: 项目管理插件视图 (com.promptkit.project)
            var pmEl = document.getElementById('viewProjectMgmt');
            if (pmEl) pmEl.classList.add('active-view');
            this._hideSearchBox();
            this._showSidebar();
            this._collapseSidebar();
        } else if (view === 'generator_character') {
            // 角色肖像生成
            var gcEl = document.getElementById('viewGeneratorCharacter');
            if (gcEl) gcEl.classList.add('active-view');
            this._hideSearchBox();
            if (window.PK_GENERATOR && PK_GENERATOR.viewCharacter) PK_GENERATOR.viewCharacter();
        }

        // 关闭推荐面板
        this.closeRecommend();
        // 切换到非 home 视图时强制退出编辑模式
        if (this.state.editMode && view !== 'home') {
            this.state.editMode = false;
            try { localStorage.removeItem('promptkit_editmode'); } catch(e) {}
        }

        // v4.2.0-phase14.2: 视图切换后重新应用国际化
        // JS 动态渲染的 DOM 需要在渲染完成后翻译
        if (App._i18nCurrent !== 'zh-CN') {
            var _applyI18n = App._applyI18n;
            setTimeout(function() { if (_applyI18n) _applyI18n(); }, 80);
        }
    },

    // 辅助：隐藏搜索框但保留占位空间（避免顶部按钮位移）
    _hideSearchBox() {
        var sb = document.getElementById('globalSearchBox');
        if (sb) sb.style.visibility = 'hidden';
    },

    // 辅助：自动折叠侧边栏（切换到无关视图时调用）
    _collapseSidebar() {
        var sidebar = document.getElementById('sidebar');
        var btn = document.getElementById('sidebarToggleBtn');
        if (sidebar && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            if (btn) { btn.innerHTML = '\u25B6'; btn.title = App._t('auto.str_854e6c55', '展开模块列表'); }
        }
    },

    // 辅助：完全隐藏侧边栏+按钮（词卡管理等独立视图用）
    // 辅助：完全隐藏侧边栏+按钮（词卡管理等独立视图用）
    _hideSidebar() {
        var sidebar = document.getElementById('sidebar');
        var btn = document.getElementById('sidebarToggleBtn');
        var mc = document.querySelector('.main-content');
        if (sidebar) { sidebar.style.display = 'none'; }
        if (btn) { btn.style.display = 'none'; }
        if (mc) { mc.style.marginLeft = '0'; }
        document.body.classList.remove('sidebar-collapsed');
    },

    // 辅助：恢复侧边栏显示
    _showSidebar() {
        var sidebar = document.getElementById('sidebar');
        var btn = document.getElementById('sidebarToggleBtn');
        var mc = document.querySelector('.main-content');
        if (sidebar) { sidebar.style.display = ''; }
        if (btn) { btn.style.display = ''; }
        if (mc) { mc.style.marginLeft = ''; }
        // 恢复折叠状态
        this._restoreSidebarState();
    },

    // 辅助：自动展开侧边栏（回到首页时调用）
    _expandSidebar() {
        var sidebar = document.getElementById('sidebar');
        var btn = document.getElementById('sidebarToggleBtn');
        if (sidebar && sidebar.classList.contains('collapsed')) {
            sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
            if (btn) { btn.innerHTML = '\u25C0'; btn.title = App._t('auto.str_b79711fb', '折叠模块列表'); }
        }
    },

    // ============ 搜索模式 ============

    toggleSearchMode() {
        var modes = { keyword: 'semantic', semantic: 'keyword' };
        this.state._searchMode = modes[this.state._searchMode] || 'keyword';
        var btn = document.getElementById('searchModeBtn');
        var inlineBtn = document.getElementById('inlineSearchModeBtn');
        var self = this;
        var update = function(el) {
            if (!el) return;
            if (self.state._searchMode === 'semantic') {
                el.innerHTML = '<span style="font-weight:600;">\uD83E\uDDE0</span>';
                el.title = '语义搜索（点击切换回关键词）';
                el.style.color = '#818cf8';
            } else {
                el.innerHTML = '\uD83D\uDD24';
                el.title = '关键词搜索（点击切换为语义）';
                el.style.color = '#94a3b8';
            }
        };
        update(btn);
        update(inlineBtn);
        // 如果当前有搜索词，重新搜索
        if (this.state.searchQuery) {
            this.state.page = 1;
            if (this.state._searchMode === 'semantic') {
                this._semanticSearch(this.state.searchQuery);
            } else {
                this.loadPrompts();
            }
        }
        this.showToast('已切换到' + (this.state._searchMode === 'semantic' ? App._t('auto.str_05e6be83', '🧠 语义搜索') : App._t('auto.str_f0288e24', '🔤 关键词搜索')), 'info');
    },

    async _semanticSearch(query) {
        var container = document.getElementById('promptList');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">语义搜索中...</span></div></div>';
        try {
            var data = await this.fetchJSON('/api/v2/search/semantic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query, top_k: 50 })
            });
            if (!data || !data.items) {
                container.innerHTML = '<div class="empty-state"><p>搜索未完成</p></div>';
                return;
            }
            this.state.prompts = data.items.map(function(item) {
                return {
                    id: item.id,
                    content: item.content,
                    meaning: item.meaning || '',
                    module: item.module || '',
                    category: item.category || '',
                    tags: JSON.stringify(item.tags || []),
                    semantic_score: item.score || 0,
                    collections: [],
                    usage_count: 0
                };
            });
            this.state.totalItems = data.total;
            this.state.totalPages = 1;
            this.state.page = 1;
            this._renderSemanticResults();
            document.getElementById('countInfo').textContent = '🧠 语义搜索: ' + data.total + ' 条结果';
        } catch (e) {
            container.innerHTML = '<div class="empty-state" style="color:#ef4444;">语义搜索未完成: ' + e.message + '</div>';
        }
    },

    _renderSemanticResults() {
        var container = document.getElementById('promptList');
        if (!container) return;
        var items = this.state.prompts;
        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>未找到语义相似的提示词</p></div>';
            return;
        }
        var self = this;
        var html = '<div class="prompt-grid">';
        for (var i = 0; i < items.length; i++) {
            var p = items[i];
            var score = (p.semantic_score * 100).toFixed(0);
            html += '<div class="prompt-card" data-id="' + p.id + '" onclick="App.showCardDetail(' + p.id + ')">';
            html += '<div class="card-body">';
            html += '<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">';
            html += '<span style="font-size:10px;color:#818cf8;">🧠 相似度 ' + score + '%</span>';
            html += '</div>';
            html += '<div class="card-content" id="cc_' + p.id + '">' + self._escape(p.content || '') + '</div>';
            if (p.meaning) html += '<div class="card-meaning">' + self._escape(p.meaning) + '</div>';
            html += '<div style="display:flex;gap:4px;">';
            if (p.module) html += '<span class="card-badge">' + self._escape(self._moduleDisplayName(p.module)) + '</span>';
            if (p.category) html += '<span class="card-badge" style="background:#f0fdf4;color:#059669;">' + self._escape(p.category) + '</span>';
            html += '</div>';
            html += '</div>';
            html += '<div class="card-actions">';
            html += '<button class="btn-copy" onclick="App.handleCopy(' + p.id + ', \'' + self._escape(p.content).replace(/'/g, "\\'") + '\')">复制</button>';
            html += '</div>';
            html += '</div>';
        }
        html += '</div>';
        container.innerHTML = html;
    },

    // ============ 模块名中文化 ============
    _moduleDisplayName(id) {
        var map = {
            emotion: '人物表情', color: App._t('auto.str_67a7c94b', '场景色彩'), tone: '画面色调',
            composition: App._t('auto.str_ebe1d3eb', '分镜构图'), storyboard: App._t('auto.str_ebe1d3eb', '分镜构图'),
            camera_move: App._t('auto.str_6885459d', '运镜模版'), seedance: App._t('auto.str_94df12b2', '视频模版'),
            // 原子类型模块名映射
            subject: '主体描述', style: '风格表现', lighting: '光影效果',
            quality: '画质参数', camera: '镜头语言', atmosphere: '色调氛围',
            negative: '负面词', constraint: '限制条件', creative: '创意元素', action: '动态动作'
        };
        return map[id] || id;
    },

    // ============ 数据加载 ============

    // Phase14: loadGroupTree 空安全桩（wc_bridge.js 会覆盖为真实实现）
    // 如果 wc_bridge.js 尚未就绪，init 调用此桩时会轮询等待直到真实函数出现
    // 注意：用命名函数 _loadGroupTreeStub 捕获自身引用（self===App会导致!==永远false）
    loadGroupTree: function _loadGroupTreeStub() {
        var stubFn = _loadGroupTreeStub;  // 直接捕获函数引用，避免 self.App 同引用问题
        return new Promise(function(resolve) {
            var tries = 0;
            var retry = setInterval(function() {
                tries++;
                // 用直接函数引用比对，而非对象属性（self===App导致永远相等）
                if (App.loadGroupTree !== stubFn) {
                    clearInterval(retry);
                    console.log('[app_core] wc_bridge 已就绪, 转发 loadGroupTree');
                    resolve(App.loadGroupTree());
                } else if (tries > 50) {
                    clearInterval(retry);
                    console.error('[app_core] loadGroupTree 等待超时 (10s), 降级为空白侧边栏');
                    resolve();
                }
            }, 200);
        });
    },

    async fetchJSON(url, options) {
        try {
            var timeoutMs = (options && options._timeoutMs) || 30000;
            var controller = new AbortController();
            var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
            var res = await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            if (err.name === 'AbortError') {
                console.warn('请求超时:', url);
            } else {
                console.error('请求未响应:', url, err.message);
            }
            return null;
        }
    },

    async loadModules() {
        const data = await this.fetchJSON('/api/modules');
        if (data) { this.state.modules = data.modules; this.renderSidebar(); }
    },

    async loadCategories(module) {
        const data = await this.fetchJSON(`/api/categories${module ? `?module=${module}` : ''}`);
        if (data) { this.state.categories = data.categories; this.renderCategories(); }
    },

    async loadPrompts() {
        const s = this.state;
        var savedScrollY = window.scrollY;
        const params = new URLSearchParams();
        if (s.currentModule) params.set('module', s.currentModule);
        if (s.currentCategory) params.set('category', s.currentCategory);
        if (s.searchQuery) params.set('search', s.searchQuery);
        params.set('page', s.page);
        params.set('page_size', s.pageSize);

        s.isLoading = true;
        // 已有卡片时不渲染 loading spinner（避免闪到顶部）
        if (this.state.prompts.length === 0) {
            this.renderPrompts();
        }

        const data = await this.fetchJSON(`/api/v4/cards?${params}`);
        s.isLoading = false;
        if (!data) { this.renderPrompts(); this._restoreScroll(savedScrollY); return; }

        s.prompts = data.items;
        s.totalItems = data.total;
        s.totalPages = Math.ceil(data.total / s.pageSize) || 1;
        this.renderPrompts();
        this.renderPagination();
        document.getElementById('countInfo').textContent = App._t('auto.str_6de9513c', '共 ' + data.total + ' 条提示词');
        // 同步恢复滚动位置（0 delay 确保布局已更新但同一帧内）
        if (savedScrollY > 0 && this.state.currentView === 'home') {
            var maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo(0, Math.min(savedScrollY, maxY));
        }
    },

    _restoreScroll(savedY) {
        if (savedY > 0 && this.state.currentView === 'home') {
            var self = this;
            setTimeout(function() {
                var maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
                window.scrollTo(0, Math.min(savedY, maxY));
            }, 0);
        }
    },

    async loadStats() {
        const data = await this.fetchJSON('/api/status');
        if (!data) return;
        this.state.stats = data;
        const el = document.getElementById('headerStats');
        if (el) el.textContent = '词库 ' + (data.total_prompts||0) + ' 条 | 使用 ' + (data.total_usage||0) + ' 次';
    },

    // ============ 模块切换 ============
    async switchModule(moduleId) {
        this.state.currentModule = moduleId;
        try { localStorage.setItem('promptkit_view', 'home'); localStorage.setItem('promptkit_module', moduleId); } catch(e) {}
        this.state.currentCategory = null;
        this.state.searchQuery = '';
        this.state.page = 1;
        document.getElementById('searchInput').value = '';
        this._editFilterQuery = '';
        this._editFilterModule = '';
        this._editFilterCollected = '';
        this.renderSidebar();
        this._closeMobileMenu();
        this.switchView('home');
        await this.loadCategories(moduleId);
        await this.loadPrompts();
        this._updatePageTitle();
    },

    switchAllModules() {
        this.state.currentModule = null;
        this.state.currentCategory = null;
        this.state.searchQuery = '';
        this.state.page = 1;
        document.getElementById('searchInput').value = '';
        this._editFilterQuery = '';
        this._editFilterModule = '';
        this._editFilterCollected = '';
        try { localStorage.setItem('promptkit_view', 'home'); localStorage.removeItem('promptkit_module'); } catch(e) {}
        this.renderSidebar();
        this._closeMobileMenu();
        this.switchView('home');
        this.renderCategories();
        this.loadPrompts();
        this._updatePageTitle();
    },

    // 更新页面标题
    _updatePageTitle() {
        // v5.22.1: 词库首页标题由 _wcLoadPrompts / _showShowcase 设置,
        // 此函数现在仅为 legacy home 视图设置通用标题"提示词列表"
        var el = document.getElementById('pageTitle');
        if (!el) return;
        var m = this.state.currentModule;
        if (!m) {
            el.textContent = App._t('common.all', '查找词组');
        } else {
            var modules = this.state.modules || [];
            var found = modules.find(function(x) { return x.id === m; });
            el.textContent = (found ? found.name : m) + App._t('auto.str_7fc0a1cc', ' 提示词列表');
        }
    },

    async switchCategory(category) {
        this.state.currentCategory = category === this.state.currentCategory ? null : category;
        this.state.page = 1;
        this.renderCategories();
        await this.loadPrompts();
    },

    goPage(page) {
        if (page < 1 || page > this.state.totalPages) return;
        this.state.page = page;
        this.loadPrompts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // ============ 复制 ============
    // 生成导出文件名：取第一条提示词内容前12字 + 条数
    // 若已有自定义名则优先使用
    _makeExportFilename(items, fmt, customName) {
        if (customName) {
            return customName + '.' + fmt;
        }
        var prefix = 'prompts';
        if (items && items.length > 0) {
            var firstItem = items[0];
            var text = '';
            if (typeof firstItem === 'object' && firstItem !== null) {
                text = firstItem.content || '';
            } else if (typeof firstItem === 'number') {
                // 从当前词库找内容
                var found = this.state.prompts.find(function(p) { return p.id === firstItem; });
                if (found) text = found.content || '';
            }
            var clean = ('' + text).replace(/[\\/:*?"<>|\n\r]/g, '').trim();
            prefix = clean.slice(0, 12) || 'prompts';
        }
        if (items && items.length > 1) {
            prefix += '_等' + items.length + App._t('common.items', '条');
        }
        return prefix + '.' + fmt;
    },

    async copyText(content, msg) {
        try {
            await navigator.clipboard.writeText(content);
            this.showToast(msg || App._t('common.copied', '已复制到剪贴板'), 'success');
        } catch {
            const ta = document.createElement('textarea');
            ta.value = content;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            this.showToast(msg || App._t('common.copied', '已复制到剪贴板'), 'success');
        }
    },

    async trackUsage(promptId) {
        await this.fetchJSON(`/api/prompts/${promptId}/usage`, { method: 'POST' });
    },

    handleCopy(id, content) {
        // 检查是否包含模板变量 {{...}}
        var varMatch = content.match(/\{\{\w+\}\}/g);
        if (varMatch && varMatch.length > 0) {
            this._showTemplateFillModal(id, content);
            return;
        }
        this.copyText(content);
        this.trackUsage(id);
        const card = document.querySelector(`.prompt-card[data-id="${id}"]`);
        if (card) {
            card.classList.add('copy-flash');
            setTimeout(() => card.classList.remove('copy-flash'), 300);
        }
        // 打开推荐
        this.showRecommend(id);
    },

    // ============ 模板变量 ============

    async _showTemplateFillModal(id, content) {
        try {
            var data = await this.fetchJSON('/api/v2/templates/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
            });
            if (!data || !data.variables || data.variables.length === 0) {
                this.copyText(content);
                this.trackUsage(id);
                return;
            }
            this._tmplPromptId = id;
            this._tmplOriginal = content;
            this._tmplVars = data.variables;
            document.getElementById('tmplPreview').textContent = data.preview;
            var fieldsHtml = '';
            for (var i = 0; i < data.variables.length; i++) {
                var v = data.variables[i];
                fieldsHtml += '<div style="margin-bottom:8px;">';
                fieldsHtml += '<label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px;">' + this._escape(v.name) + '</label>';
                fieldsHtml += '<input type="text" class="modal-input tmpl-var-input" data-var="' + v.name + '" placeholder="输入 ' + v.name + '" style="font-size:13px;">';
                fieldsHtml += '</div>';
            }
            document.getElementById('tmplFields').innerHTML = fieldsHtml;
            document.getElementById('modalTemplateVars').style.display = 'flex';
            setTimeout(function() {
                var first = document.querySelector('.tmpl-var-input');
                if (first) first.focus();
            }, 100);
        } catch (e) {
            this.copyText(content);
            this.trackUsage(id);
        }
    },

    async _tmplCopy() {
        var values = {};
        var inputs = document.querySelectorAll('.tmpl-var-input');
        for (var i = 0; i < inputs.length; i++) {
            values[inputs[i].getAttribute('data-var')] = inputs[i].value.trim() || ('{{' + inputs[i].getAttribute('data-var') + '}}');
        }
        try {
            var data = await this.fetchJSON('/api/v2/templates/render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: this._tmplOriginal, values: values })
            });
            if (data && data.ok && data.rendered) {
                this.copyText(data.rendered);
                if (this._tmplPromptId) this.trackUsage(this._tmplPromptId);
                document.getElementById('modalTemplateVars').style.display = 'none';
                if (data.has_unfilled) {
                    this.showToast('部分变量未填充: ' + data.unfilled.join(', '), 'warning');
                } else {
                    this.showToast(App._t('common.copied', '已复制（模板已填充）'), 'success');
                }
            }
        } catch (e) {
            this.showToast(App._t('auto.str_dfcf8c14', '模板渲染未完成'), 'error');
        }
    },

    // ============ Toast ============
    showToast(msg, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const div = document.createElement('div');
        div.className = `toast-msg toast-${type}`;
        div.textContent = msg;
        container.appendChild(div);
        setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 2500);
    },

    // 移动端识别（触屏 + 窄屏 ≤1024px）
    _isMobileDevice() {
        return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 1024;
    },

    // ============ 移动端横竖屏检测+锁定 ============
    _initOrientation() {
        var self = this;
        try { self.state._orientationLock = localStorage.getItem('promptkit_orientation_lock') || null; } catch(e) {}
        if (self.state._orientationLock === 'null' || self.state._orientationLock === '') self.state._orientationLock = null;
        // matchMedia 更可靠，无需等 resize
        self._landscapeMql = window.matchMedia('(orientation: landscape)');
        var _onChange = function() {
            if (!self.state._orientationLock) self._applyOrientation();
        };
        if (self._landscapeMql.addEventListener) {
            self._landscapeMql.addEventListener('change', _onChange);
        } else {
            self._landscapeMql.addListener(_onChange);
        }
        var _roTimer = null;
        window.addEventListener('resize', function() {
            clearTimeout(_roTimer);
            _roTimer = setTimeout(function() {
                if (!self.state._orientationLock) self._applyOrientation();
            }, 200);
        });
        self._applyOrientation();
    },

    _applyOrientation() {
        var isMobile = this._isMobileDevice();
        var isLandscape = this._landscapeMql ? this._landscapeMql.matches : (window.innerWidth > window.innerHeight);
        if (isMobile) {
            document.body.classList.toggle('mobile-landscape', isLandscape);
        } else {
            document.body.classList.remove('mobile-landscape');
        }
        this.applyColumns();
        this._updateOrientationBtn();
    },

    toggleOrientationLock() {
        var lock = this.state._orientationLock;
        if (!lock) {
            var isLandscape = this._landscapeMql ? this._landscapeMql.matches : (window.innerWidth > window.innerHeight);
            this.state._orientationLock = isLandscape ? 'landscape' : 'portrait';
        } else if (lock === 'landscape') {
            this.state._orientationLock = 'portrait';
        } else {
            this.state._orientationLock = null;
        }
        try { localStorage.setItem('promptkit_orientation_lock', this.state._orientationLock); } catch(e) {}
        this.applyColumns();
        this._updateOrientationBtn();
    },

    _updateOrientationBtn() {
        var btn = document.getElementById('btnOrientationLock');
        if (!btn) return;
        var lock = this.state._orientationLock;
        var isMobile = this._isMobileDevice();
        if (!isMobile) { btn.style.display = 'none'; return; }
        btn.style.display = 'inline-flex';
        var isLandscape = (lock === 'landscape') || (!lock && this._landscapeMql && this._landscapeMql.matches) || (!lock && !this._landscapeMql && window.innerWidth > window.innerHeight);
        if (lock === 'landscape') {
            btn.innerHTML = '<i class="bi bi-lock-fill"></i>';
            btn.title = '已锁定横屏 — 点按切换竖屏 / 再按解除锁定';
            btn.style.color = 'var(--primary)';
        } else if (lock === 'portrait') {
            btn.innerHTML = '<i class="bi bi-lock-fill"></i>';
            btn.title = '已锁定竖屏 — 点按解除锁定 / 再按切换横屏';
            btn.style.color = '#f59e0b';
        } else {
            btn.innerHTML = isLandscape ? '<i class="bi bi-phone-landscape"></i>' : '<i class="bi bi-phone"></i>';
            btn.title = isLandscape ? '横屏模式 · 点击锁定' : '竖屏模式 · 点击锁定';
            btn.style.color = '';
        }
    },

    // ===== Phase38: 主模型切换 =====
    _aiModelState: { provider: 'ollama', kimi_model: 'kimi-k2.6', ollama_model: 'qwen3.5:9b' },

    _loadAIModelConfig: async function() {
        try {
            var d = await this.fetchJSON('/api/playground/ai-config');
            if (d && d.ok) {
                this._aiModelState.provider = d.provider || 'ollama';
                this._aiModelState.kimi_model = d.kimi_model || 'kimi-k2.6';
                this._aiModelState.ollama_model = d.ollama_model || 'qwen3.5:9b';
                this._updateModelIndicator();
            }
        } catch(e) {}
    },

    _switchAIModel: async function(provider) {
        try {
            var d = await this.fetchJSON('/api/playground/ai-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: provider })
            });
            if (d && d.ok) {
                this._aiModelState.provider = provider;
                this._updateModelIndicator();
                var name = provider === 'kimi' ? 'Kimi kimi-k2.6' : 'Ollama qwen3.5:9b';
                this.showToast('已切换至 ' + name, 'success');
            }
        } catch(e) {
            this.showToast('切换失败', 'error');
        }
    },

    _updateModelIndicator: function() {
        var icon = document.getElementById('modelProviderIcon');
        var label = document.getElementById('modelProviderLabel');
        var ollamaEl = document.getElementById('navModelOllama');
        var kimiEl = document.getElementById('navModelKimi');
        if (!icon || !label) return;
        if (this._aiModelState.provider === 'kimi') {
            icon.textContent = '☁️';
            label.textContent = 'Kimi';
            if (ollamaEl) ollamaEl.style.fontWeight = 'normal';
            if (kimiEl) kimiEl.style.fontWeight = 'bold';
        } else {
            icon.textContent = '🧠';
            label.textContent = 'Ollama';
            if (ollamaEl) ollamaEl.style.fontWeight = 'bold';
            if (kimiEl) kimiEl.style.fontWeight = 'normal';
        }
    },

    // ===== Phase38-security: API 密钥保管 =====
    _kvOpen: async function() {
        var m = document.getElementById('modalKeyVault');
        if (!m) return;
        m.style.display = 'flex';
        // 加载现有状态
        this._kvRefreshStatus();
    },

    _kvClose: function() {
        var m = document.getElementById('modalKeyVault');
        if (m) m.style.display = 'none';
        // 清空输入框
        var e1 = document.getElementById('kvKimiKey');
        var e2 = document.getElementById('kvOpenaiKey');
        if (e1) { e1.value = ''; e1.type = 'password'; }
        if (e2) { e2.value = ''; e2.type = 'password'; }
    },

    _kvRefreshStatus: async function() {
        try {
            var d = await this.fetchJSON('/api/playground/ai-config');
            if (!d || !d.ok) return;
            var ks = document.getElementById('kvKimiStatus');
            var os = document.getElementById('kvOpenaiStatus');
            if (ks) {
                if (d.kimi_ready) {
                    ks.textContent = d.kimi_key_masked || '已配置';
                    ks.style.background = 'rgba(5,150,105,0.15)';
                    ks.style.color = '#059669';
                } else {
                    ks.textContent = '未配置';
                    ks.style.background = 'rgba(239,68,68,0.15)';
                    ks.style.color = '#ef4444';
                }
            }
            if (os) {
                os.textContent = '未配置'; // OpenAI 暂不存储
            }
        } catch(e) {}
    },

    _kvSave: async function(provider) {
        var input = document.getElementById(provider === 'kimi' ? 'kvKimiKey' : 'kvOpenaiKey');
        if (!input || !input.value.trim()) {
            this.showToast('请先输入 API Key', 'warning');
            return;
        }
        try {
            var d = await this.fetchJSON('/api/playground/api-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: provider, key: input.value.trim() })
            });
            if (d && d.ok) {
                this.showToast(provider + ' 密钥已加密保存', 'success');
                input.value = '';
                input.type = 'password';
                this._kvRefreshStatus();
                if (provider === 'kimi') {
                    this._aiModelState.provider = 'kimi';
                    this._updateModelIndicator();
                }
            } else {
                this.showToast((d && d.error) || '保存失败', 'error');
            }
        } catch(e) {
            this.showToast('网络错误', 'error');
        }
    },

    _kvDelete: async function(provider) {
        if (!confirm('确认清除 ' + provider + ' 的 API Key？')) return;
        try {
            var d = await this.fetchJSON('/api/playground/api-key/' + provider, { method: 'DELETE' });
            if (d && d.ok) {
                this.showToast(provider + ' 密钥已清除', 'info');
                this._kvRefreshStatus();
            }
        } catch(e) {
            this.showToast('网络错误', 'error');
        }
    },

};


// ============ 启动 ============
document.addEventListener('DOMContentLoaded', () => App.init());

// ============ Global unhandled rejection guard ============
window.addEventListener('unhandledrejection', function(e) {
    console.warn('[Global] Unhandled Promise rejection:', (e.reason && e.reason.message) || e.reason);
    e.preventDefault();
});
// ============ Global runtime error guard ============
window.addEventListener('error', function(e) {
    console.warn('[Global] Runtime error:', e.message);
});

