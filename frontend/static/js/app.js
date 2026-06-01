/**
 * WebUI 提示词检索工具 v2.0 - 完整应用逻辑
 * 单页应用,零框架依赖
 */
const App = {
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
        theme: 'light',
        columns: 3,  // 卡片列数
        // Seedance
        seedanceView: 'templates',
        seedanceCategory: null,
        seedanceTemplates: [],
        seedanceTotal: 0,
        seedancePage: 1,
        seedanceTotalPages: 1,
        seedanceCategories: [],
        gallery: []
    },

    // ============ 初始化 ============
    async init() {
        // 恢复主题
        const savedTheme = ((typeof localStorage !== 'undefined' && localStorage.getItem) ? localStorage.getItem('promptkit_theme') : 'light') || 'light';
        this.applyTheme(savedTheme);

        // 恢复列数设置
        var savedCols = localStorage.getItem('promptkit_columns') || '3';
        this.state.columns = parseInt(savedCols);
        var slider = document.getElementById('columnSlider');
        if (slider) {
            slider.value = savedCols;
            document.getElementById('columnLabel').textContent = savedCols + '列';
        }
        this.applyColumns();

        // 恢复编辑模式状态（必须在 switchView 之前恢复，确保初始渲染正确）
        if ((typeof localStorage !== 'undefined' && localStorage.getItem('promptkit_editmode') === '1')) {
            this.state.editMode = true;
        }

        // 提前读取保存的视图状态，避免 switchView('home') 覆写 localStorage
        var savedView = (typeof localStorage !== 'undefined' && localStorage.getItem('promptkit_view')) || null;
        var savedModule = (typeof localStorage !== 'undefined' && localStorage.getItem('promptkit_module')) || null;

        this.bindEvents();
        this._initDropZone();
        
        // 初始默认显示 home 视图（防止 JS 错误时白屏）
        this.switchView('home', true);  // true = 静默模式，不写 localStorage
        
        try {
            await Promise.all([
                this.loadModules(),
                this.loadStats(),
                this.loadCollections(),
                this.loadWordpacks()
            ]);

            // 恢复上次的视图状态（savedView/savedModule 已在 init 顶部读取）
            if (savedView === 'seedance') {
                this.switchView('seedance');
                var savedSeedanceTab = localStorage.getItem('promptkit_seedance_tab') || 'templates';
                setTimeout(function() { App.switchSeedanceTab(savedSeedanceTab); }, 100);
            } else if (savedView === 'collections' || savedView === 'wordpacks' || savedView === 'history' || savedView === 'trash') {
                this.switchView(savedView);
            } else if (savedModule && this.state.modules && this.state.modules.find(function(m) { return m.id === savedModule; })) {
                this.switchModule(savedModule);
            } else if (this.state.modules && this.state.modules.length > 0) {
                this.switchModule(this.state.modules[0].id);
            } else {
                this.loadPrompts();
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
        });

        setInterval(() => this.loadStats(), 30000);
    },

    // ============ 视图切换 ============
    switchView(view) {
        this.state.currentView = view;
        // 保存视图状态到 localStorage
        try { localStorage.setItem('promptkit_view', view); } catch(e) {}

        // 隐藏所有视图
        document.querySelectorAll('.view-panel').forEach(function(el) { el.classList.remove('active-view'); });
        // 导航按钮状态
        document.querySelectorAll('.header-btn[id^="nav"]').forEach(el => el.classList.remove('active'));

        const navMap = {
            home: 'navHome',
            collections: 'navCollections',
            wordpacks: 'navWordpacks',
            history: 'navHistory',
            trash: 'navTrash'
        };

        if (view === 'home') {
            document.getElementById('viewHome').classList.add('active-view');
            document.getElementById(navMap[view]).classList.add('active');
            document.getElementById('globalSearchBox').style.display = 'flex';
            this.renderSidebar();
            this.loadPrompts();
        } else if (view === 'collections') {
            document.getElementById('viewCollections').classList.add('active-view');
            document.getElementById(navMap[view]).classList.add('active');
            document.getElementById('globalSearchBox').style.display = 'none';
            this.renderCollections();
        } else if (view === 'wordpacks') {
            document.getElementById('viewWordpacks').classList.add('active-view');
            document.getElementById(navMap[view]).classList.add('active');
            document.getElementById('globalSearchBox').style.display = 'none';
            this.renderWordpacks();
        } else if (view === 'history') {
            document.getElementById('viewHistory').classList.add('active-view');
            document.getElementById(navMap[view]).classList.add('active');
            document.getElementById('globalSearchBox').style.display = 'none';
            this.loadHistory();
        } else if (view === 'trash') {
            document.getElementById('viewTrash').classList.add('active-view');
            document.getElementById(navMap[view]).classList.add('active');
            document.getElementById('globalSearchBox').style.display = 'none';
            this.loadTrash();
        } else if (view === 'seedance') {
            this.state.currentModule = 'seedance';
            this.renderSidebar();
            document.getElementById('viewSeedance').classList.add('active-view');
            document.getElementById('globalSearchBox').style.display = 'none';
            this.loadSeedanceCategories();
            this.loadSeedanceTemplates();
        }

        // 关闭推荐面板
        this.closeRecommend();
        // 如果切换到非 home 视图才退出编辑模式（home 内的模块/分类切换保持编辑模式）
        if (this.state.editMode && view !== 'home') this.toggleEditMode();
    },

    // ============ 搜索模式 ============

    toggleSearchMode() {
        var modes = { keyword: 'semantic', semantic: 'keyword' };
        this.state._searchMode = modes[this.state._searchMode] || 'keyword';
        var btn = document.getElementById('searchModeBtn');
        if (btn) {
            if (this.state._searchMode === 'semantic') {
                btn.innerHTML = '<span style="font-weight:600;">🧠</span>';
                btn.title = '语义搜索（点击切换回关键词）';
                btn.style.color = '#818cf8';
            } else {
                btn.innerHTML = '🔤';
                btn.title = '关键词搜索（点击切换为语义）';
                btn.style.color = '#94a3b8';
            }
        }
        // 如果当前有搜索词，重新搜索
        if (this.state.searchQuery) {
            this.state.page = 1;
            if (this.state._searchMode === 'semantic') {
                this._semanticSearch(this.state.searchQuery);
            } else {
                this.loadPrompts();
            }
        }
        this.showToast('已切换到' + (this.state._searchMode === 'semantic' ? '🧠 语义搜索' : '🔤 关键词搜索'), 'info');
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
                container.innerHTML = '<div class="empty-state"><p>搜索失败</p></div>';
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
            container.innerHTML = '<div class="empty-state" style="color:#ef4444;">语义搜索失败: ' + e.message + '</div>';
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
        var html = '<div class="prompt-grid">';
        for (var i = 0; i < items.length; i++) {
            var p = items[i];
            var score = (p.semantic_score * 100).toFixed(0);
            html += '<div class="prompt-card" data-id="' + p.id + '">';
            html += '<div class="card-body">';
            html += '<div style="font-size:10px;color:#818cf8;margin-bottom:4px;">🧠 相似度 ' + score + '%</div>';
            html += '<div class="card-content" id="cc_' + p.id + '">' + this._escape(p.content || '') + '</div>';
            if (p.meaning) html += '<div class="card-meaning">' + this._escape(p.meaning) + '</div>';
            html += '<div style="display:flex;gap:4px;">';
            if (p.module) html += '<span class="card-badge">' + this._escape(p.module) + '</span>';
            if (p.category) html += '<span class="card-badge" style="background:#f0fdf4;color:#059669;">' + this._escape(p.category) + '</span>';
            html += '</div>';
            html += '</div>';
            html += '<div class="card-actions">';
            html += '<button class="btn-copy" onclick="App.handleCopy(' + p.id + ', \'' + this._escape(p.content).replace(/'/g, "\\'") + '\')">复制</button>';
            html += '</div>';
            html += '</div>';
        }
        html += '</div>';
        container.innerHTML = html;
    },

    // ============ 数据加载 ============
    async fetchJSON(url, options) {
        try {
            var controller = new AbortController();
            var timer = setTimeout(function() { controller.abort(); }, 30000);
            var res = await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            if (err.name === 'AbortError') {
                console.warn('请求超时:', url);
            } else {
                console.error('请求失败:', url, err.message);
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
        const params = new URLSearchParams();
        if (s.currentModule) params.set('module', s.currentModule);
        if (s.currentCategory) params.set('category', s.currentCategory);
        if (s.searchQuery) params.set('search', s.searchQuery);
        params.set('page', s.page);
        params.set('page_size', s.pageSize);

        s.isLoading = true;
        this.renderPrompts();

        const data = await this.fetchJSON(`/api/prompts?${params}`);
        s.isLoading = false;
        if (!data) { this.renderPrompts(); return; }

        s.prompts = data.items;
        s.totalItems = data.total;
        s.totalPages = data.total_pages;
        this.renderPrompts();
        this.renderPagination();
        document.getElementById('countInfo').textContent = `共 ${data.total} 条提示词`;
    },

    async loadStats() {
        const data = await this.fetchJSON('/api/status');
        if (!data) return;
        this.state.stats = data;
        const el = document.getElementById('headerStats');
        if (el) el.textContent = `词库 ${data.total_prompts} 条 | 使用 ${data.total_usage} 次`;
    },

    // ============ 模块切换 ============
    async switchModule(moduleId) {
        this.state.currentModule = moduleId;
        // 保存模块状态
        try { localStorage.setItem('promptkit_view', 'home'); localStorage.setItem('promptkit_module', moduleId); } catch(e) {}
        this.state.currentCategory = null;
        this.state.searchQuery = '';
        this.state.page = 1;
        document.getElementById('searchInput').value = '';
        this._editFilterQuery = '';
        this._editFilterModule = '';
        this._editFilterCollected = '';
        this.renderSidebar();
        this.switchView('home');
        await this.loadCategories(moduleId);
        await this.loadPrompts();
    },

    /* 全部词库：重置所有筛选 */
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
        this.switchView('home');
        this.renderCategories();
        this.loadPrompts();
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
            prefix += '_等' + items.length + '条';
        }
        return prefix + '.' + fmt;
    },

    async copyText(content, msg) {
        try {
            await navigator.clipboard.writeText(content);
            this.showToast(msg || '已复制到剪贴板', 'success');
        } catch {
            const ta = document.createElement('textarea');
            ta.value = content;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            this.showToast(msg || '已复制到剪贴板', 'success');
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
                    this.showToast('已复制（模板已填充）', 'success');
                }
            }
        } catch (e) {
            this.showToast('模板渲染失败', 'error');
        }
    },

    // ============ 智能推荐 ============
    async showRecommend(promptId) {
        this.state.currentPromptId = promptId;
        const panel = document.getElementById('recommendPanel');
        const list = document.getElementById('recommendList');
        list.innerHTML = '<div class="rec-empty">加载推荐中...</div>';
        panel.classList.add('open');
        document.getElementById('mainContent').classList.add('with-rec');

        const data = await this.fetchJSON(`/api/v2/recommend/${promptId}?limit=6`);
        if (!data || !data.items || data.items.length === 0) {
            list.innerHTML = '<div class="rec-empty">暂无推荐词条</div>';
            return;
        }
        let html = '';
        for (const r of data.items) {
            html += `
                <div class="rec-item">
                    <div class="rec-content">${this._escape(r.content)}</div>
                    <div class="rec-meta">${r.module} › ${r.category} · 使用 ${r.usage_count} 次</div>
                    <span class="rec-copy" onclick="App.handleCopy(${r.id}, '${this._escape(r.content).replace(/'/g, "\\'")}')">📋 复制</span>
                </div>
            `;
        }
        list.innerHTML = html;
    },

    closeRecommend() {
        const panel = document.getElementById('recommendPanel');
        panel.classList.remove('open');
        document.getElementById('mainContent').classList.remove('with-rec');
    },

    toggleEditMode() {
        this.state.editMode = !this.state.editMode;
        
        var eb = document.getElementById('batchBar');
        var fb = document.getElementById('editFilterBar');
        if (this.state.editMode) {
            this.state.batchSelected.clear();
            this._editFilterQuery = '';
            this._editFilterModule = '';
            this._editFilterCollected = '';
            if (eb) { eb.style.display = 'flex'; }
            if (fb) { fb.style.display = 'block'; }
            this._populateEditFilterModules();
            this.updateBatchCount();
            // 持久化编辑模式状态
            try { localStorage.setItem('promptkit_editmode', '1'); } catch(e) {}
        } else {
            this.state.batchSelected.clear();
            if (eb) eb.style.display = 'none';
            if (fb) fb.style.display = 'none';
            try { localStorage.removeItem('promptkit_editmode'); } catch(e) {}
        }
        var btn = document.getElementById('btnEditMode');
        if (this.state.editMode) {
            btn.style.color = '#4f46e5';
            btn.classList.add('active');
        } else {
            btn.style.color = '#94a3b8';
            btn.classList.remove('active');
        }
        this.renderPrompts();
        this.renderSidebar();
    },

    _populateEditFilterModules() {
        var select = document.getElementById('editFilterModule');
        if (!select || !this.state.modules) return;
        var currentVal = select.value || '';
        select.innerHTML = '<option value="">全部模块</option>';
        for (var i = 0; i < this.state.modules.length; i++) {
            var m = this.state.modules[i];
            if (m.id === 'custom' || m.id === 'seedance') continue;
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === currentVal) opt.selected = true;
            select.appendChild(opt);
        }
    },

    // 编辑模式筛选
    _applyEditFilter() {
        this._editFilterQuery = (document.getElementById('editFilterInput').value || '').trim().toLowerCase();
        this._editFilterModule = document.getElementById('editFilterModule').value || '';
        this._editFilterCollected = document.getElementById('editFilterCollected').value || '';
        this._updateFilteredDisplay();
    },

    _resetEditFilter() {
        if (document.getElementById('editFilterInput')) document.getElementById('editFilterInput').value = '';
        if (document.getElementById('editFilterModule')) document.getElementById('editFilterModule').value = '';
        if (document.getElementById('editFilterCollected')) document.getElementById('editFilterCollected').value = '';
        this._editFilterQuery = '';
        this._editFilterModule = '';
        this._editFilterCollected = '';
        this._updateFilteredDisplay();
    },

    _updateFilteredDisplay() {
        // 编辑模式下对渲染的卡片做客户端过滤（只隐藏，不重新请求后端）
        var allCards = document.querySelectorAll('#promptList .prompt-card');
        var visibleCount = 0;
        var self = this;
        allCards.forEach(function(card) {
            var id = parseInt(card.getAttribute('data-id'));
            var promptData = self.state.prompts.find(function(p) { return p.id === id; });
            if (!promptData) { card.style.display = 'none'; return; }
            var show = true;
            // 关键词筛选
            if (self._editFilterQuery) {
                var q = self._editFilterQuery;
                var contentMatch = (promptData.content || '').toLowerCase().indexOf(q) >= 0;
                var meaningMatch = (promptData.meaning || '').toLowerCase().indexOf(q) >= 0;
                var catMatch = (promptData.category || '').toLowerCase().indexOf(q) >= 0;
                if (!contentMatch && !meaningMatch && !catMatch) show = false;
            }
            // 模块筛选
            if (show && self._editFilterModule) {
                if ((promptData.module || '') !== self._editFilterModule) show = false;
            }
            // 收藏筛选
            if (show && self._editFilterCollected) {
                var colls = promptData.collections || [];
                if (self._editFilterCollected === 'collected' && colls.length === 0) show = false;
                if (self._editFilterCollected === 'uncollected' && colls.length > 0) show = false;
            }
            card.style.display = show ? '' : 'none';
            if (show) visibleCount++;
        });
        var countEl = document.getElementById('editFilterCount');
        if (countEl) {
            var total = allCards.length;
            countEl.textContent = visibleCount < total ? (visibleCount + '/' + total + ' 条匹配') : '';
        }
    },

    toggleSelect(promptId) {
        if (this.state.batchSelected.has(promptId)) {
            this.state.batchSelected.delete(promptId);
        } else {
            this.state.batchSelected.add(promptId);
        }
        this.renderPrompts();
        this.updateBatchCount();
    },

    updateBatchCount() {
        document.getElementById('batchCount').textContent = `已选 ${this.state.batchSelected.size} 项`;
        var editBar = document.getElementById('batchBar');
        if (this.state.editMode) {
            editBar.style.display = 'flex';
            document.getElementById('batchCount').textContent = `已选 ${this.state.batchSelected.size} 项`;
        } else if (editBar) {
            editBar.style.display = 'none';
        }
    },

    selectAllPrompts() {
        for (const p of this.state.prompts) {
            this.state.batchSelected.add(p.id);
        }
        this.renderPrompts();
        this.updateBatchCount();
    },

    async exportSelected() {
        // 将 editMode 下的选中项传给导出弹窗的「已选择的词条」模式
        var ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先勾选要导出的词条', 'error'); return; }
        document.getElementById('modalImportExport').style.display = 'flex';
        this.switchIETab('export');
        // 自动选中「已选择的词条」范围
        document.getElementById('ieExportScope').value = 'selected';
        this._updateExportBtn();
    },

    _renderExportPreviewList(items) {
        var container = document.getElementById('epItemList');
        var html = '<table style="width:100%;border-collapse:collapse;">';
        html += '<thead><tr style="background:var(--hover-bg,#f1f5f9);"><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">#</th><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">模块</th><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">分类</th><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">内容预览</th><th style="padding:4px 6px;text-align:left;font-size:11px;border-bottom:1px solid var(--border-color);">使用</th></tr></thead><tbody>';
        for (var i = 0; i < items.length; i++) {
            var p = items[i];
            var preview = (p.content || '').length > 50 ? (p.content || '').slice(0, 50) + '...' : (p.content || '');
            html += '<tr>';
            html += '<td style="padding:4px 6px;font-size:11px;color:var(--text-muted);border-bottom:1px dashed var(--border-color);">' + (i + 1) + '</td>';
            html += '<td style="padding:4px 6px;font-size:11px;border-bottom:1px dashed var(--border-color);">' + this._escape(p.module || '') + '</td>';
            html += '<td style="padding:4px 6px;font-size:11px;border-bottom:1px dashed var(--border-color);">' + this._escape(p.category || '') + '</td>';
            html += '<td style="padding:4px 6px;font-size:11px;border-bottom:1px dashed var(--border-color);color:var(--text-muted);">' + this._escape(preview) + '</td>';
            html += '<td style="padding:4px 6px;font-size:11px;border-bottom:1px dashed var(--border-color);text-align:center;">' + (p.usage_count || 0) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    },

    _refreshExportPreview() {
        var items = this._epItems || [];
        if (items.length === 0) {
            document.getElementById('epContent').value = '';
            return;
        }
        var fmt = document.querySelector('input[name="epFmt"]:checked');
        fmt = fmt ? fmt.value : 'txt';
        var content = '';
        if (fmt === 'json') {
            var exportData = {
                exported_at: new Date().toISOString(),
                count: items.length,
                prompts: items.map(function(p) {
                    return { id: p.id, content: p.content, meaning: p.meaning, module: p.module, category: p.category, tags: p.tags };
                })
            };
            content = JSON.stringify(exportData, null, 2);
        } else {
            var lines = [
                '# 提示词导出 - ' + new Date().toLocaleString('zh-CN'),
                '# 共 ' + items.length + ' 条',
                '', '---', ''
            ];
            for (var i = 0; i < items.length; i++) {
                var p = items[i];
                lines.push('[' + (i + 1) + '] [' + (p.module || '') + '/' + (p.category || '') + '] ' + (p.content || ''));
                if (p.meaning) lines.push('    释义: ' + p.meaning);
                if (p.scene) lines.push('    场景: ' + p.scene);
                lines.push('');
            }
            content = lines.join('\n');
        }
        document.getElementById('epContent').value = content;
        document.getElementById('epCount').textContent = '选中 ' + items.length + ' 条 · ' + (fmt === 'json' ? 'JSON 格式' : 'TXT 格式');
    },

    async _doExportPreview() {
        var ids = this._epItems ? this._epItems.map(function(p) { return p.id; }) : [];
        if (ids.length === 0) { this.showToast('没有可导出的词条', 'error'); return; }
        var fmt = document.querySelector('input[name="epFmt"]:checked');
        fmt = fmt ? fmt.value : 'txt';
        document.getElementById('modalExportPreview').style.display = 'none';

        if (fmt === 'png') {
            this._exportQueue = { ids: ids, fmt: 'png' };
            this._showExportNameDialog(ids, 'png');
            return;
        }

        try {
            var res = await fetch('/api/v2/batch/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_ids: ids, format: fmt })
            });
            var blob = await res.blob();
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = this._makeExportFilename(this._epItems || [], fmt);
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('导出成功 (' + ids.length + ' 条)', 'success');
            document.getElementById('modalExportPreview').style.display = 'none';
        } catch (e) {
            this.showToast('导出失败: ' + e.message, 'error');
        }
    },

    // ============ 拖拽导入 ============

    _initDropZone() {
        var zone = document.getElementById('viewHomeScroll');
        if (!zone) zone = document.getElementById('viewHome');
        if (!zone) return;
        var overlay = document.getElementById('dropOverlay');
        if (!overlay) return;

        zone.addEventListener('dragenter', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // 编辑模式下从不显示全局遮罩，卡片拖拽完全接管
            if (App.state.editMode) return;
            overlay.style.display = 'flex';
        }, false);

        zone.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            overlay.style.display = 'flex';
        }, false);

        zone.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // 只有离开 zone 时才隐藏
            var rect = zone.getBoundingClientRect();
            var x = e.clientX, y = e.clientY;
            if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
                overlay.style.display = 'none';
            }
        }, false);

        zone.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            overlay.style.display = 'none';
            var files = e.dataTransfer.files;
            if (!files || files.length === 0) return;
            // 编辑模式下如果拖到卡片上，跳过全局处理（卡片自己处理）
            if (App.state.editMode && e.target.closest('.prompt-card')) return;
            // 处理 .json 或 .pt 文件
            var dropFile = null;
            var isPt = false;
            for (var i = 0; i < files.length; i++) {
                var name = files[i].name.toLowerCase();
                if (name.endsWith('.json')) {
                    dropFile = files[i];
                    isPt = false;
                    break;
                } else if (name.endsWith('.pt')) {
                    dropFile = files[i];
                    isPt = true;
                    break;
                }
            }
            if (!dropFile) {
                // 没有 JSON/.pt 文件，检查是否有 PNG
                var pngFile = null;
                for (var i = 0; i < files.length; i++) {
                    var name = files[i].name.toLowerCase();
                    if (name.endsWith('.png') || files[i].type === 'image/png') {
                        pngFile = files[i];
                        break;
                    }
                }
                if (pngFile) {
                    App.handleDropPngFile(pngFile);
                } else {
                    App.showToast('请拖入 JSON / .pt / PNG 格式的提示词文件', 'error');
                }
                return;
            }
            if (isPt) {
                App._handleDropPtFile(dropFile);
            } else {
                App._handleDropFile(dropFile);
            }
        }, false);
    },

    async handleDropPngFile(file) {
        try {
            var formData = new FormData();
            formData.append('file', file);
            var resp = await fetch('/api/export/preview-png', { method: 'POST', body: formData });
            var preview = await resp.json();
            if (!preview.ok || !preview.preview) {
                this.showToast('该 PNG 不包含有效的提示词数据', 'error');
                return;
            }
            var p = preview.preview;
            var item = {
                content: p.content || '',
                meaning: p.meaning || '',
                scene: p.scene || '',
                module: p.module || 'custom',
                category: p.category || '',
                tags: p.tags || []
            };
            this._diFile = file;
            this._diItems = [item];
            this._diIsPt = false;
            this._diIsPng = true;
            this._diPngFile = file;
            document.getElementById('diFileName').textContent = file.name;
            document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB · 1 条提示词';
            document.getElementById('diCount').textContent = '共 1 条提示词';
            this._renderDiItems([item]);
            document.getElementById('diSelectAll').checked = true;
            document.getElementById('diResult').style.display = 'none';
            document.getElementById('btnDiImport').disabled = false;
            document.getElementById('btnDiImport').innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
            document.getElementById('modalDropImport').style.display = 'flex';
        } catch (e) {
            this.showToast('PNG 解析失败: ' + e.message, 'error');
        }
    },

    async _handleDropFile(file) {
        // 读取并解析 JSON
        var text = await file.text();
        var data;
        try {
            data = JSON.parse(text);
        } catch(e) {
            this.showToast('JSON 解析失败：' + e.message, 'error');
            return;
        }
        // 兼容两种格式：{prompts: [...]} 或直接数组
        var items = data.prompts || data;
        if (!Array.isArray(items) || items.length === 0) {
            this.showToast('未找到有效的提示词数据', 'error');
            return;
        }
        // 规范化：确保每个 item 有 content
        items = items.filter(function(item) {
            return item.content || item.prompt;
        }).map(function(item) {
            // 兼容 prompt 字段
            if (!item.content && item.prompt) item.content = item.prompt;
            return item;
        });
        if (items.length === 0) {
            this.showToast('未找到有效的提示词条目', 'error');
            return;
        }

        this._diFile = file;
        this._diItems = items;
        this._diIsPt = false;

        // 填充弹窗信息
        document.getElementById('diFileName').textContent = file.name;
        document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB · ' + items.length + ' 条提示词';
        document.getElementById('diCount').textContent = '共 ' + items.length + ' 条提示词';

        // 统一渲染预览列表
        this._renderDiItems(items);

        document.getElementById('diSelectAll').checked = true;
        document.getElementById('diResult').style.display = 'none';
        document.getElementById('btnDiImport').disabled = false;
        document.getElementById('btnDiImport').innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';

        // 显示弹窗
        document.getElementById('modalDropImport').style.display = 'flex';
    },

    // ============ 导入预览渲染（JSON / .pt 共用） ============

    _renderDiItems(items) {
        var container = document.getElementById('diItemList');
        var moduleOpts = '';
        var modList = this.state.modules || [];
        for (var mi = 0; mi < modList.length; mi++) {
            var m = modList[mi];
            if (m.id === 'seedance') continue;
            moduleOpts += '<option value="' + this._escape(m.id) + '">' + this._escape(m.name || m.id) + '</option>';
        }
        var html = '<table>';
        html += '<thead><tr><th style="width:30px;"></th><th>模块</th><th>分类</th><th>词条内容（点击编辑）</th></tr></thead><tbody>';
        var limit = Math.min(50, items.length);
        for (var i = 0; i < limit; i++) {
            var item = items[i];
            var escContent = this._escape(item.content || '');
            var itemModule = item.module || 'custom';
            var escCategory = this._escape(item.category || '通用');
            var optHtml = moduleOpts.replace('value="' + itemModule + '"', 'value="' + itemModule + '" selected');
            var hasModule = modList.some(function(m) { return m.id === itemModule; });
            if (!hasModule) {
                optHtml = '<option value="' + this._escape(itemModule) + '" selected>' + this._escape(itemModule) + '</option>' + optHtml;
            }
            html += '<tr>';
            html += '<td><input type="checkbox" class="di-item-cb" data-idx="' + i + '" checked onchange="App._updateDiCount()"></td>';
            html += '<td><select class="di-module-select" data-idx="' + i + '">' + optHtml + '</select></td>';
            html += '<td><input class="di-category-input" data-idx="' + i + '" value="' + escCategory + '"></td>';
            html += '<td><input class="di-content-input" data-idx="' + i + '" value="' + escContent + '"></td>';
            html += '</tr>';
        }
        if (items.length > 50) {
            html += '<tr><td colspan="4" style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted);">... 还有 ' + (items.length - 50) + ' 条（导入时全部导入）</td></tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    },

    _updateDiCount() {
        var checkboxes = document.querySelectorAll('.di-item-cb:checked');
        document.getElementById('diCount').textContent = '已选 ' + checkboxes.length + ' / ' + this._diItems.length + ' 条';
    },

    _toggleDiSelectAll() {
        var checked = document.getElementById('diSelectAll').checked;
        var cbs = document.querySelectorAll('.di-item-cb');
        for (var i = 0; i < cbs.length; i++) cbs[i].checked = checked;
        this._updateDiCount();
    },

    async _confirmDropImport() {
        var cbs = document.querySelectorAll('.di-item-cb:checked');
        if (cbs.length === 0) { this.showToast('请至少选择一条提示词', 'error'); return; }
        var btn = document.getElementById('btnDiImport');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div> 正在导入...';

        var data;
        if (this._diIsPng && this._diPngFile) {
            // PNG 导入：收集用户编辑覆盖
            var conflict = document.getElementById('diConflictSelect').value;
            var overrides = [];
            for (var cbi = 0; cbi < cbs.length; cbi++) {
                var idx = parseInt(cbs[cbi].getAttribute('data-idx'));
                var contentInput = document.querySelector('.di-content-input[data-idx="' + idx + '"]');
                var moduleSelect = document.querySelector('.di-module-select[data-idx="' + idx + '"]');
                var categoryInput = document.querySelector('.di-category-input[data-idx="' + idx + '"]');
                overrides.push({
                    content: contentInput ? contentInput.value.trim() : null,
                    module: moduleSelect ? moduleSelect.value : null,
                    category: categoryInput ? categoryInput.value.trim() : null
                });
            }
            var formData = new FormData();
            formData.append('file', this._diPngFile);
            formData.append('conflict', conflict);
            formData.append('overrides', JSON.stringify(overrides));
            try {
                var resp = await fetch('/api/export/import-png', { method: 'POST', body: formData });
                data = await resp.json();
            } catch (e) {
                this.showToast('PNG 导入失败', 'error');
                btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
                return;
            }
            // 标准化返回值（后端 import-png 返回 {ok, result}，统一为 {created, skipped}）
            if (data && data.ok) {
                if (data.result && data.result.created) {
                    data.created = 1;
                    data.skipped = 0;
                    data.failed = 0;
                } else if (data.result && data.result.reason === 'skip') {
                    data.created = 0;
                    data.skipped = 1;
                    data.failed = 0;
                } else {
                    data.created = 0;
                    data.skipped = 0;
                    data.failed = 1;
                }
            }
        } else if (this._diIsPt) {
            // .pt 包导入：收集用户编辑覆盖 + 上传原文件
            var overrides = [];
            for (var cbi = 0; cbi < cbs.length; cbi++) {
                var idx = parseInt(cbs[cbi].getAttribute('data-idx'));
                var contentInput = document.querySelector('.di-content-input[data-idx="' + idx + '"]');
                var moduleSelect = document.querySelector('.di-module-select[data-idx="' + idx + '"]');
                var categoryInput = document.querySelector('.di-category-input[data-idx="' + idx + '"]');
                overrides.push({
                    content: contentInput ? contentInput.value.trim() : null,
                    module: moduleSelect ? moduleSelect.value : null,
                    category: categoryInput ? categoryInput.value.trim() : null
                });
            }
            var formData = new FormData();
            formData.append('file', this._diPtFile);
            formData.append('conflict', document.getElementById('diConflictSelect').value);
            formData.append('overrides', JSON.stringify(overrides));
            try {
                var resp = await fetch('/api/v2/pt/import', { method: 'POST', body: formData });
                data = await resp.json();
            } catch (e) {
                this.showToast('导入失败', 'error');
                btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
                return;
            }
        } else {
            // JSON 导入：收集编辑后的值
            var items = [];
            for (var i = 0; i < cbs.length; i++) {
                var idx = parseInt(cbs[i].getAttribute('data-idx'));
                var original = this._diItems[idx];
                var contentInput = document.querySelector('.di-content-input[data-idx="' + idx + '"]');
                var moduleSelect = document.querySelector('.di-module-select[data-idx="' + idx + '"]');
                var categoryInput = document.querySelector('.di-category-input[data-idx="' + idx + '"]');
                items.push({
                    content: contentInput ? contentInput.value.trim() : (original.content || ''),
                    meaning: original.meaning || '',
                    scene: original.scene || '',
                    module: moduleSelect ? moduleSelect.value : (original.module || 'custom'),
                    category: categoryInput ? categoryInput.value.trim() : (original.category || '通用'),
                    tags: original.tags || []
                });
            }
            var conflict = document.getElementById('diConflictSelect').value;
            data = await this.fetchJSON('/api/v2/import/from-json-data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: items, conflict: conflict })
            });
        }

        if (!data) {
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
            this.showToast('导入失败，请重试', 'error');
            return;
        }

        var resultEl = document.getElementById('diResult');
        resultEl.style.display = 'block';
        if (data.failed > 0) {
            resultEl.style.color = '#ef4444';
            resultEl.innerHTML = '导入完成：' + data.created + ' 成功, ' + data.skipped + ' 跳过, ' + data.failed + ' 失败';
        } else {
            resultEl.style.color = '#059669';
            resultEl.innerHTML = '✅ 导入成功！' + data.created + ' 条提示词已添加';
        }

        btn.disabled = false; btn.innerHTML = '✅ 已完成';
        btn.onclick = function() { document.getElementById('modalDropImport').style.display = 'none'; };

        if (data.created > 0) {
            this.state.page = 1;
            await this.loadPrompts();
            this.showToast('成功导入 ' + data.created + ' 条提示词', 'success');
        }
    },

    // ============ .pt 包拖拽导入 ============

    async _handleDropPtFile(file) {
        var formData = new FormData();
        formData.append('file', file);
        var resp = await fetch('/api/v2/pt/preview', { method: 'POST', body: formData });
        if (!resp.ok) {
            var errText = await resp.text();
            this.showToast('预览失败: ' + errText, 'error');
            return;
        }
        var data = await resp.json();
        if (!data || !data.items || data.items.length === 0) {
            this.showToast('未找到有效的提示词数据', 'error');
            return;
        }
        this._diPtFile = file;
        this._diIsPt = true;
        this._diItems = data.items;
        document.getElementById('diFileName').textContent = file.name;
        document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB \u00B7 ' + data.count + ' \u6761\u63D0\u793A\u8BCD';
        document.getElementById('diCount').textContent = '共 ' + data.count + ' 条提示词';
        this._renderDiItems(data.items);
        document.getElementById('diSelectAll').checked = true;
        document.getElementById('diResult').style.display = 'none';
        document.getElementById('btnDiImport').disabled = false;
        document.getElementById('btnDiImport').innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
        document.getElementById('modalDropImport').style.display = 'flex';
    },

    _copyExportPreview() {
        var text = document.getElementById('epContent').value;
        if (!text) { this.showToast('没有内容可复制', 'error'); return; }
        this.copyText(text, '已复制导出内容');
    },

    clearEditSelection() {
        this.state.batchSelected.clear();
        this.renderPrompts();
        this.updateBatchCount();
    },

    async batchCopy() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先选择提示词', 'error'); return; }
        const data = await this.fetchJSON('/api/v2/batch/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        if (!data) return;
        // 显示模态框
        document.getElementById('batchResultText').value = data.text;
        document.getElementById('modalBatchResult').style.display = 'flex';
    },

    async copyBatchResult() {
        const text = document.getElementById('batchResultText').value;
        await this.copyText(text, '已复制全部内容');
    },

    async batchExport(fmt) {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先选择提示词', 'error'); return; }
        if (fmt === 'pt' || fmt === 'png') {
            this._exportQueue = { ids: ids, fmt: fmt };
            this._showExportNameDialog(ids, fmt);
            return;
        }
        try {
            var res = await fetch('/api/v2/batch/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_ids: ids, format: fmt })
            });
            var blob = await res.blob();
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = App._makeExportFilename(ids, fmt);
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('导出成功 (' + ids.length + ' 条)', 'success');
        } catch (e) {
            this.showToast('导出失败', 'error');
        }
    },

    // ============ 导出命名弹窗 ============

    _showExportNameDialog(ids, fmt) {
        var fmtNames = { pt: '.pt 提示词包', png: '导出 PNG 卡片' };
        document.getElementById('exportNameTitle').textContent = '导出 ' + (fmtNames[fmt] || fmt.toUpperCase());
        var defaultName = this._makeExportFilename(ids, fmt).replace('.' + fmt, '');
        document.getElementById('exportNameInput').value = defaultName;
        document.getElementById('exportNameCount').textContent = '共 ' + ids.length + ' 条 · 格式: ' + (fmt === 'pt' ? '.pt 提示词包' : 'PNG 卡片');

        var savedPath = localStorage.getItem('promptkit_export_path') || '';
        var pi = document.getElementById('exportPathInput');
        var se = document.getElementById('exportPathStatus');
        if (savedPath && (savedPath.includes(":\\") || savedPath.includes(":/"))) {
            pi.value = savedPath;
            if (se) { se.innerHTML = '\u2705 目录: <strong>' + savedPath + '</strong>'; se.style.color = '#059669'; }
        } else if (savedPath) {
            pi.value = '\U0001f4c1 ' + savedPath;
            if (se) { se.innerHTML = '\u2705 文件夹: <strong>' + savedPath + '</strong>'; se.style.color = '#059669'; }
        } else {
            pi.value = '';
            if (se) { se.innerHTML = '\U0001f4a1 点击输入框选择文件夹，或直接输入完整磁盘路径'; se.style.color = 'var(--text-muted)'; }
        }

        pi.oninput = function() {
            var v = this.value.trim();
            var s = document.getElementById('exportPathStatus');
            if (!s) return;
            if (!v) { s.innerHTML = '\U0001f4a1 点击输入框选择文件夹，或直接输入完整磁盘路径'; s.style.color = 'var(--text-muted)'; }
            else if (v.includes(":\\") || v.includes(":/")) {
                s.innerHTML = '\u23f3 验证路径...';
                s.style.color = '#f59e0b';
                clearTimeout(this._pathCheckTimer);
                this._pathCheckTimer = setTimeout(function() {
                    fetch('/api/utils/check-path', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: document.getElementById('exportPathInput').value.trim() })
                    }).then(function(r) { return r.json(); }).then(function(d) {
                        if (d.ok) { s.innerHTML = '\u2705 目录存在: <strong>' + d.path + '</strong>'; s.style.color = '#059669'; localStorage.setItem('promptkit_export_path', d.path); }
                        else { s.innerHTML = '\u26a0\ufe0f ' + d.error; s.style.color = '#ef4444'; }
                    }).catch(function() { s.innerHTML = ''; });
                }, 500);
            } else {
                s.innerHTML = '';
            }
        };

        var ext = fmt === 'pt' ? '.pt' : '.png';
        document.getElementById('exportPathPreview').innerHTML = fmt === 'pt'
            ? '\U0001f4c4 将保存为: <strong>' + defaultName + ext + '</strong>'
            : '\U0001f4c4 将保存 <strong>' + ids.length + '</strong> 张 PNG 图片到目录: <strong>' + defaultName + '</strong>';

        document.getElementById('exportNameInput').oninput = function() {
            var val = this.value.trim() || defaultName;
            var ext = fmt === 'pt' ? '.pt' : '.png';
            document.getElementById('exportPathPreview').innerHTML = fmt === 'pt'
                ? '\U0001f4c4 将保存为: <strong>' + val + ext + '</strong>'
                : '\U0001f4c4 将保存 <strong>' + ids.length + '</strong> 张 PNG 图片到目录: <strong>' + val + '</strong>';
        };

        document.getElementById('btnConfirmExportName').onclick = function() { App._confirmBatchExport(); };
        document.getElementById('modalExportName').style.display = 'flex';
    },

    async _confirmBatchExport() {
        if (!this._exportQueue) return;
        var ids = this._exportQueue.ids;
        var fmt = this._exportQueue.fmt;
        var customName = document.getElementById('exportNameInput').value.trim();

        var saveDir = document.getElementById('exportPathInput').value.trim().replace(/^\U0001f4c1\s*/, '');
        if (saveDir.includes(":\\") || saveDir.includes(":/")) {
            localStorage.setItem('promptkit_export_path', saveDir);
        } else {
            saveDir = '';
        }

        document.getElementById('modalExportName').style.display = 'none';

        try {
            if (fmt === 'pt') {
                var r = await fetch('/api/v2/pt/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt_ids: ids })
                });
                var b = await r.blob();
                var cd = r.headers.get('Content-Disposition') || '';
                var m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/);
                var dn = customName ? (customName + '.pt') : (m ? decodeURIComponent(m[1]) : App._makeExportFilename(ids, 'pt'));

                if (saveDir) {
                    var ok = await App._saveBlobToPath(b, saveDir + '\\' + dn);
                    if (ok) { App.showToast('导出成功 (' + ids.length + ' 条)', 'success'); }
                    else { App._fallbackDownload(b, dn); App.showToast('写入失败，已改为下载', 'warning'); }
                } else {
                    App._fallbackDownload(b, dn);
                    App.showToast('导出成功 (' + ids.length + ' 条)', 'success');
                }
            } else if (fmt === 'png') {
                var saved = 0;
                for (var i = 0; i < ids.length; i++) {
                    var p = this.state.prompts ? this.state.prompts.find(function(x) { return x.id === ids[i]; }) : null;
                    var pr = await fetch('/api/export/prompt-to-png/' + ids[i]);
                    var pb = await pr.blob();
                    var pn = App._makeExportFilename(p ? [p] : [{id: ids[i]}], 'png');
                    if (saveDir) {
                        var ok = await App._saveBlobToPath(pb, saveDir + '\\' + pn);
                        if (ok) saved++;
                        else App._fallbackDownload(pb, pn);
                    } else {
                        App._fallbackDownload(pb, pn);
                        saved++;
                    }
                }
                App.showToast('导出成功 (' + saved + '/' + ids.length + ' 张 PNG)', 'success');
            }
        } catch (e) {
            App.showToast('导出失败: ' + e.message, 'error');
        }
        this._exportQueue = null;
    },

    async _pickExportPath() {
        try {
            var r = await fetch('/api/utils/pick-folder', { method: 'POST' });
            var d = await r.json();
            if (d.ok && d.path) {
                this._exportPath = d.path;
                localStorage.setItem('promptkit_export_path', d.path);
                document.getElementById('exportPathInput').value = d.path;
                var s = document.getElementById('exportPathStatus');
                if (s) { s.innerHTML = '\u2705 目录: <strong>' + d.path + '</strong>'; s.style.color = '#059669'; }
            } else if (d.error && d.error !== '未选择目录') {
                this.showToast('选择目录失败: ' + d.error, 'error');
            }
        } catch (e) {
            this.showToast('目录选择器调用失败', 'error');
        }
    },

    _fallbackDownload(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    _blobToBase64(blob) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onloadend = function() { resolve(reader.result.split(',')[1]); };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },

    async _saveBlobToPath(blob, fullPath) {
        try {
            var b64 = await this._blobToBase64(blob);
            var r = await fetch('/api/utils/save-blob', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: fullPath, content: b64 })
            });
            var d = await r.json();
            return d.ok;
        } catch (e) {
            console.warn('保存文件失败:', e.message);
            return false;
        }
    },

    async batchAddToWordpack() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先选择提示词', 'error'); return; }
        // 加载词包列表
        const data = await this.fetchJSON('/api/v2/wordpacks');
        if (!data || data.items.length === 0) {
            this.showToast('请先创建词包', 'error');
            return;
        }
        document.getElementById('modalAddToTitle').textContent = '添加到词包';
        let html = '<p style="margin-bottom:12px;font-size:13px;color:var(--text-muted);">选择要添加到的词包:</p>';
        for (const wp of data.items) {
            html += `<div class="cat-tab" style="display:block;margin-bottom:6px;text-align:left;" onclick="App.doAddToWordpack(${wp.id}, '${this._escape(wp.name)}')">
                📁 ${this._escape(wp.name)} (${wp.item_count} 条)
            </div>`;
        }
        document.getElementById('wordpackSelectList').innerHTML = html;
        document.getElementById('modalAddToWordpack').style.display = 'flex';
    },

    // ============ 弹窗模块下拉填充 ============

    _populateModuleOptions(selectedVal) {
        var select = document.getElementById('editModule');
        var modules = this.state.modules || [];
        select.innerHTML = '';
        for (var i = 0; i < modules.length; i++) {
            var m = modules[i];
            if (m.id === 'custom') continue;
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === selectedVal) opt.selected = true;
            select.appendChild(opt);
        }
    },

    // ============ 回收站相关 ============

    openAddPromptModal() {
        document.getElementById('editPromptTitle').textContent = '新建提示词';
        document.getElementById('editContent').value = '';
        document.getElementById('editMeaning').value = '';
        document.getElementById('editScene').value = '';
        // 记住当前模块，确保新建的词条自动归属到当前浏览的功能模块
        this._newPromptModule = this.state.currentModule || '';
        this._populateModuleOptions(this._newPromptModule);
        document.getElementById('editCategory').value = '';
        document.getElementById('editTags').value = '[]';
        document.getElementById('editDeleteBtn').style.display = 'none';
        // 重置缩略图
        this._editThumbFilename = null;
        this._editVideoFilename = null;
        this._editHadThumbOriginal = false;
        this._editThumbnailCleared = false;
        this._editThumbnailMode = false;
        this.updateEditThumbDisplay();
        this._editingPromptId = null;
        // 替换保存按钮行为
        var saveBtn = document.querySelector('#modalEditPrompt .btn-primary');
        saveBtn.onclick = null;
        saveBtn.onclick = function() { App.createNewPrompt(); };
        document.getElementById('modalEditPrompt').style.display = 'flex';
    },

    async createNewPrompt() {
        // 优先使用打开弹窗时记住的模块，其次取下拉框值，最后兜底 'custom'
        var moduleVal = this._newPromptModule || document.getElementById('editModule').value || 'custom';
        var data = {
            content: document.getElementById('editContent').value.trim(),
            meaning: document.getElementById('editMeaning').value.trim(),
            scene: document.getElementById('editScene').value.trim(),
            module: moduleVal,
            category: document.getElementById('editCategory').value.trim() || '自定义',
            tags: document.getElementById('editTags').value.trim() || '[]'
        };
        if (!data.content) { this.showToast('内容不能为空', 'error'); return; }
        var result = await this.fetchJSON('/api/prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (result) {
            // 新建词条后保存缩略图
            var newId = result.id;
            if (newId && (this._editThumbFilename || this._editVideoFilename)) {
                await this._saveEditThumbnail(newId);
            }
            this.closeEditModal();
            this.showToast('新建成功', 'success');
            this.state.batchSelected.clear();
            var eb = document.getElementById('batchBar');
            if (eb) eb.style.display = 'none';
            // 如果新建的模块和当前浏览模块一致，维持筛选；否则重置到全部
            if (this.state.currentModule && this.state.currentModule !== moduleVal) {
                this.state.currentModule = null;
                this.state.currentCategory = null;
                this.renderSidebar();
                this.renderCategories();
            }
            await this.loadPrompts();
        }
    },

    async trashPrompt(promptId) {
        if (!confirm('确认将此词条移入回收站？')) return;
        try {
            var res = await fetch('/api/prompts/' + promptId, { method: 'DELETE' });
            var data = await res.json();
            if (data.trashed) {
                this.showToast('已移入回收站', 'info');
                this.loadPrompts();
            } else if (data.detail) {
                this.showToast(data.detail, 'error');
            }
        } catch(e) {
            this.showToast('操作失败: ' + e.message, 'error');
        }
    },

    async batchTrash() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先选择词条', 'error'); return; }
        if (!confirm('确认将选中的 ' + ids.length + ' 个词条移入回收站？')) return;
        const data = await this.fetchJSON('/api/v2/trash/batch-trash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        if (data) {
            this.showToast('已移入回收站 ' + data.trashed + ' 条', 'success');
            if (this.state.editMode) {
                this.state.batchSelected.clear();
                var eb = document.getElementById('batchBar');
                if (eb) eb.style.display = 'none';
                this.loadPrompts();
            } else {
                this.toggleEditMode();
                this.loadPrompts();
            }
        }
    },

    // ============ 导入/导出 ============

    showImportModal() {
        document.getElementById('modalImportExport').style.display = 'flex';
        this.switchIETab('import');
    },

    showExportModal() {
        document.getElementById('modalImportExport').style.display = 'flex';
        this.switchIETab('export');
        this._updateExportBtn();
    },

    switchIETab(tab) {
        document.getElementById('ieTabImport').className = tab === 'import' ? 'seedance-tab active' : 'seedance-tab';
        document.getElementById('ieTabExport').className = tab === 'export' ? 'seedance-tab active' : 'seedance-tab';
        document.getElementById('ieImportPanel').style.display = tab === 'import' ? 'block' : 'none';
        document.getElementById('ieExportPanel').style.display = tab === 'export' ? 'block' : 'none';
        document.getElementById('modalIETitle').textContent = tab === 'import' ? '导入提示词' : '导出提示词';
    },

    _updateExportBtn() {
        var scope = document.getElementById('ieExportScope').value;
        var moduleArea = document.getElementById('ieModuleSelectArea');
        if (moduleArea) {
            moduleArea.style.display = scope === 'module' ? 'block' : 'none';
            if (scope === 'module' && this.state.modules) {
                // 渲染模块多选复选框
                var cbContainer = document.getElementById('ieModuleCheckboxes');
                if (cbContainer) {
                    var ch = '';
                    for (var mi = 0; mi < this.state.modules.length; mi++) {
                        var m = this.state.modules[mi];
                        ch += '<label style="font-size:12px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;">' +
                            '<input type="checkbox" value="' + m.id + '" checked> ' + m.name +
                            '</label>';
                    }
                    cbContainer.innerHTML = ch;
                }
            }
        }
    },

    async doImport() {
        var files = document.getElementById('ieFileInput').files;
        if (!files || files.length === 0) { this.showToast('请先选择文件', 'error'); return; }
        var conflict = document.getElementById('ieConflictSelect').value;
        var btn = document.getElementById('btnDoImport');
        btn.disabled = true; btn.textContent = '正在导入...';
        var created = 0, skipped = 0, failed = 0;
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var formData = new FormData();
            formData.append('file', file);
            try {
                var name = file.name.toLowerCase();
                var endpoint;
                if (name.endsWith('.json')) {
                    endpoint = '/api/export/import-json';
                } else if (name.endsWith('.pt')) {
                    endpoint = '/api/v2/pt/import';
                } else {
                    endpoint = '/api/export/import-png';
                }
                formData.append('conflict', conflict);
                var resp = await fetch(endpoint, { method: 'POST', body: formData });
                var data = await resp.json();
                if (data.ok) {
                    if (data.result && data.result.created) created++;
                    else if (data.result && data.result.reason === 'skip') skipped++;
                    else if (data.created) created += data.created;
                    else if (data.skipped) skipped += data.skipped;
                    else if (data.created === 0 && data.total > 0) skipped++;
                    else failed++;
                } else failed++;
            } catch(e) { failed++; }
        }
        btn.disabled = false; btn.textContent = '开始导入';
        var el = document.getElementById('ieImportResult');
        el.style.display = 'block';
        el.style.color = failed > 0 ? '#ef4444' : '#059669';
        el.innerHTML = '导入完成: ' + created + ' 成功, ' + skipped + ' 跳过, ' + failed + ' 失败';
        if (created > 0) await this.loadPrompts();
    },

    async doExport() {
        var fmt = document.querySelector('input[name="exportFmt"]:checked');
        fmt = fmt ? fmt.value : 'png';
        var scope = document.getElementById('ieExportScope').value;
        var btn = document.getElementById('btnDoExport');
        btn.disabled = true; btn.textContent = '正在导出...';
        var ids = [];
        if (scope === 'selected') {
            ids = [...this.state.batchSelected];
            if (ids.length === 0) { this.showToast('请先选择词条', 'error'); btn.disabled = false; btn.textContent = '导出'; return; }
        } else if (scope === 'collection-item' && this.state.currentCollection) {
            ids = (this.state.collectionItems || []).map(function(p) { return p.id; });
        } else if (scope === 'all') {
            var allData = await this.fetchJSON('/api/prompts?page_size=500');
            if (allData && allData.items) ids = allData.items.map(function(p) { return p.id; });
        } else if (scope === 'module') {
            // 按模块导出：收集所有选中模块的 ids
            var modCbs = document.querySelectorAll('#ieModuleCheckboxes input[type="checkbox"]:checked');
            var mods = [];
            for (var mi = 0; mi < modCbs.length; mi++) mods.push(modCbs[mi].value);
            if (mods.length === 0) { this.showToast('请选择至少一个模块', 'error'); btn.disabled = false; btn.textContent = '导出'; return; }
            var allData = await this.fetchJSON('/api/prompts?page_size=500');
            if (allData && allData.items) {
                ids = allData.items.filter(function(p) { return mods.indexOf(p.module) >= 0; }).map(function(p) { return p.id; });
            }
        }
        if (ids.length === 0) { this.showToast('没有可导出的词条', 'error'); btn.disabled = false; btn.textContent = '导出'; return; }
        try {
            if (fmt === 'png') {
                if (ids.length === 1) {
                    var resp = await fetch('/api/export/prompt-to-png/' + ids[0]);
                    var blob = await resp.blob();
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a'); a.href = url; a.download = 'prompt_' + ids[0] + '.png'; a.click();
                    URL.revokeObjectURL(url);
                } else {
                    var resp = await fetch('/api/export/batch-to-png', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt_ids: ids })
                    });
                    var blob = await resp.blob();
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a'); a.href = url; a.download = 'prompt_cards_' + new Date().toISOString().slice(0,10) + '.zip'; a.click();
                    URL.revokeObjectURL(url);
                }
            } else {
                var resp = await fetch('/api/v2/batch/export', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt_ids: ids, format: fmt })
                });
                var blob = await resp.blob();
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a'); a.href = url;
                // 取第一条提示词内容做文件名
                var firstItem = null;
                if (this.state.prompts) firstItem = this.state.prompts.find(function(p) { return p.id === (ids[0] || 0); });
                a.download = this._makeExportFilename(firstItem ? [firstItem] : [], fmt);
                a.click();
                URL.revokeObjectURL(url);
            }
            document.getElementById('ieExportResult').style.display = 'block';
            document.getElementById('ieExportResult').style.color = '#059669';
            document.getElementById('ieExportResult').innerHTML = '导出成功，' + ids.length + ' 条词条已下载';
        } catch(e) {
            document.getElementById('ieExportResult').style.display = 'block';
            document.getElementById('ieExportResult').style.color = '#ef4444';
            document.getElementById('ieExportResult').innerHTML = '导出失败: ' + e.message;
        }
        btn.disabled = false; btn.textContent = '导出';
    },

    async doAddToWordpack(wpId, wpName) {
        const ids = [...this.state.batchSelected];
        const data = await this.fetchJSON(`/api/v2/wordpacks/${wpId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        document.getElementById('modalAddToWordpack').style.display = 'none';
        if (data) {
            this.showToast(`已添加 ${data.added} 条到「${wpName}」`, 'success');
            this.toggleEditMode();
            this.loadWordpacks();
        }
    },

    // ============ 收藏夹 ============
    async loadCollections() {
        const data = await this.fetchJSON('/api/v2/collections');
        if (data) {
            this.state.collections = data.items;
            this.updateCollectionBadge();
        }
    },

    updateCollectionBadge() {
        const total = this.state.collections.reduce((s, c) => s + c.item_count, 0);
        const badge = document.getElementById('collectionBadge');
        if (total > 0) { badge.textContent = total; badge.style.display = 'block'; }
        else { badge.style.display = 'none'; }
    },

    renderCollections() {
        const container = document.getElementById('collectionGroups');
        const itemsView = document.getElementById('collectionItems');
        itemsView.style.display = 'none';
        container.style.display = 'grid';

        if (this.state.collections.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📁</div><p>暂无收藏分组,点击右上角新建</p></div>';
            return;
        }
        var iconOptions = ['⭐','📸','🌄','❤️','🔥','🎯','🌟','💎','🏆','🎨','📷','🎬','📁','🏔️','🎭','🌈','🌸','🍁','🌊','☀️','🌙','✨','💡','🔖','📌','💜','🧡','💚','💙'];

        let html = '';
        for (const c of this.state.collections) {
            var iconOpts = '';
            for (var ii = 0; ii < iconOptions.length; ii++) {
                var sel = iconOptions[ii] === c.icon ? 'selected' : '';
                iconOpts += '<option value="' + iconOptions[ii] + '" ' + sel + '>' + iconOptions[ii] + '</option>';
            }
            var thumbHtml = c.thumbnail
                ? (c.video_filename
                    ? `<div class="coll-thumb coll-thumb-video"><img src="/api/thumbnails/file/${c.thumbnail}"><video class="coll-thumb-vid" src="/api/thumbnails/video/${c.video_filename}" loop muted playsinline preload="none"></video></div>`
                    : `<div class="coll-thumb"><img src="/api/thumbnails/file/${c.thumbnail}"></div>`
                  )
                : `<div class="coll-thumb coll-thumb-empty"></div>`;
            html += `
                <div class="collection-card" onclick="App.openCollection(${c.id})">
                    <div class="coll-left">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div class="card-name">${this._escape(c.name)}</div>
                            <div class="card-count">${c.item_count} 条</div>
                        </div>
                        ${thumbHtml}
                    </div>
                    <div class="card-actions">
                        <button class="card-action-btn" onclick="event.stopPropagation();App.setCollectionThumbnail(${c.id})" title="设置缩略图">🖼</button>
                        <button class="card-action-btn" onclick="event.stopPropagation();App.copyCollection(${c.id})" title="复制分组">📋</button>
                        <button class="card-action-btn" onclick="event.stopPropagation();App.deleteCollection(${c.id})" title="删除分组">🗑</button>
                        <div class="icon-select-wrap"><select class="icon-picker" onchange="App.changeCollectionIcon(${c.id}, this)" onclick="event.stopPropagation()">
                            ${iconOpts}
                        </select></div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
        this._bindCollVideoHover();
    },

    _bindCollVideoHover() {
        var wrappers = document.querySelectorAll('.coll-thumb-video');
        for (var i = 0; i < wrappers.length; i++) {
            var w = wrappers[i];
            var v = w.querySelector('.coll-thumb-vid');
            if (!v) continue;
            w.removeEventListener('mouseenter', App._playCollVideo);
            w.removeEventListener('mouseleave', App._pauseCollVideo);
            w.addEventListener('mouseenter', App._playCollVideo);
            w.addEventListener('mouseleave', App._pauseCollVideo);
        }
    },

    _playCollVideo(e) {
        var w = e.currentTarget;
        var v = w.querySelector('.coll-thumb-vid');
        if (!v) return;
        v.preload = 'auto';
        v.play().catch(function(){});
    },

    _pauseCollVideo(e) {
        var w = e.currentTarget;
        var v = w.querySelector('.coll-thumb-vid');
        if (!v) return;
        v.pause();
        v.currentTime = 0;
    },

    async openCollection(cid) {
        this.state.currentCollection = cid;
        this.state.collectionPage = 1;
        document.getElementById('collectionGroups').style.display = 'none';
        document.getElementById('collectionItems').style.display = 'block';
        await this.loadCollectionItems();
    },

    async loadCollectionItems() {
        const cid = this.state.currentCollection;
        const data = await this.fetchJSON(`/api/v2/collections/${cid}/items?page=${this.state.collectionPage}&page_size=50`);
        if (!data) return;
        this.state.collectionItems = data.items;
        // Pagination
        if (data.total_pages > 1) {
            let phtml = '';
            for (let i = 1; i <= data.total_pages; i++) {
                phtml += `<button class="page-btn ${i === data.collectionPage ? 'active' : ''}" onclick="App.state.collectionPage=${i};App.loadCollectionItems()">${i}</button>`;
            }
            document.getElementById('collectionPagination').innerHTML = phtml;
        } else {
            document.getElementById('collectionPagination').innerHTML = '';
        }
        this.renderCollectionItems();
        // 初始化拖拽排序
        setTimeout(function() { App._initCollectionSort(); }, 100);
    },

    renderCollectionItems() {
        const container = document.getElementById('collectionItemList');
        const items = this.state.collectionItems;
        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>分组为空</p></div>';
            return;
        }
        let html = '<div class="prompt-grid">';
        for (const p of items) {
            const tags = JSON.parse(p.tags || '[]');
            const tagHtml = tags.map(t => `<span class="card-badge">${this._escape(t)}</span>`).join('');
            html += `
                <div class="prompt-card" data-id="${p.id}" draggable="true">
                    <div class="card-body">
                        <div class="card-thumb">
                            <div class="card-thumb-inner" onclick="App.showThumbnailPicker(${p.id})">
                                ${p.thumbnail
                                    ? (p.video_filename
                                        ? `<div class="thumb-video-wrap-preview">`
                                          + `<img class="thumb-video-poster" src="/api/thumbnails/file/${p.thumbnail}" alt="" loading="lazy">`
                                          + `<video class="thumb-video" src="/api/thumbnails/video/${p.video_filename}" loop muted playsinline preload="none"></video>`
                                          + `</div>`
                                        : `<img src="/api/thumbnails/file/${p.thumbnail}" alt="缩略图">`
                                      )
                                    : `<div class="thumb-placeholder">
                                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                                      </div>`
                                }
                            </div>
                            ${p.thumbnail ? '<span class="thumb-zoom-btn" onclick="event.stopPropagation();' + (p.video_filename ? 'App.openVideoViewer(\'' + p.video_filename + '\', \'' + p.thumbnail + '\', \'' + p.id + '\', \'' + (p.video_fps || '') + '\')' : 'App.openImageViewer(\'' + p.thumbnail + '\', \'' + p.id + '\')') + '" title="' + (p.video_filename ? '查看原视频' : '查看原图') + '">' + (p.video_filename ? '▶' : '🔍') + '</span>' : ''}
                        </div>
                        <div class="card-text">
                            <div style="display:flex;align-items:center;margin-bottom:6px;gap:4px;">
                                <span class="card-badge">${this._escape(p.category)}</span>
                                ${p.subcategory ? `<span style="font-size:10px;color:#94a3b8;">${this._escape(p.subcategory)}</span>` : ''}
                            </div>
                            <div class="card-content" id="cc_${p.id}">${this._escape(p.content)}</div>
                            ${p.meaning ? `<div class="card-meaning">${this._escape(p.meaning)}</div>` : ''}
                            ${p.scene ? `<div class="card-scene">🎯 ${this._escape(p.scene)}</div>` : ''}
                            <div style="font-size:10px;color:#cbd5e1;margin-bottom:6px;">${tagHtml}</div>
                            <div class="card-actions">
                                <span style="font-size:11px;color:#94a3b8;margin-right:auto;">使用 ${p.usage_count} 次</span>
                                <button class="btn-copy" onclick="App.trackUsage(${p.id});App.copyText('${this._escape(p.content).replace(/'/g, "\\'")}')">📋 复制</button>
                                <button class="btn-copy" style="border-color:#ef4444;color:#ef4444;" onclick="App.removeFromCollection(${this.state.currentCollection}, ${p.id})">移除</button>
                            </div>
                        </div>
                    </div>
                </div>
            
                        <div class="card-drop-indicator">
                            <span>📁 松开放置</span>
                        </div>
                    `;
        }
        html += '</div>';
        container.innerHTML = html;
        this.bindVideoHover();
    },

    async removeFromCollection(cid, pid) {
        await this.fetchJSON(`/api/v2/collections/${cid}/items/${pid}`, { method: 'DELETE' });
        this.showToast('已移除', 'info');
        await this.loadCollections();
        await this.loadCollectionItems();
    },


    _loadTranslation(promptId) {
        return this.fetchJSON('/api/translate/' + promptId + '?target_lang=' + (this.state._cardTranslations[promptId] ? 'en' : 'zh'));
    },

    async toggleTranslation(promptId) {
        var el = document.getElementById('cc_' + promptId);
        if (!el) return;
        var currentIsTranslated = !!this.state._cardTranslations[promptId];
        if (currentIsTranslated) {
            var promptData = this.state.prompts.find(function(p) { return p.id === promptId; });
            if (promptData) el.textContent = promptData.content;
            delete this.state._cardTranslations[promptId];
            this._updateTranslateBtn(promptId);
            return;
        }
        el.textContent = '翻译中...';
        try {
            var data = await this.fetchJSON('/api/translate/' + promptId + '?target_lang=zh');
            if (data && data.ok && data.translated && data.translated !== data.original) {
                el.textContent = data.translated;
                this.state._cardTranslations[promptId] = data.translated;
            } else if (data && data.note) {
                el.textContent = data.original;
                this.state._cardTranslations[promptId] = data.original;
            } else {
                var promptData = this.state.prompts.find(function(p) { return p.id === promptId; });
                el.textContent = data && data.original ? data.original : (promptData ? promptData.content : '');
                this.showToast('翻译失败: ' + (data ? data.error : '未知错误'), 'error');
            }
        } catch(e) {
            var promptData = this.state.prompts.find(function(p) { return p.id === promptId; });
            el.textContent = promptData ? promptData.content : '';
            this.showToast('翻译失败: ' + e.message, 'error');
        }
        this._updateTranslateBtn(promptId);
    },

    _updateTranslateBtn(promptId) {
        var cards = document.querySelectorAll('#promptList .prompt-card');
        cards.forEach(function(card) {
            if (parseInt(card.getAttribute('data-id')) === promptId) {
                var btn = card.querySelector('.btn-copy[onclick*="toggleTranslation"]');
                if (btn) {
                    btn.textContent = App.state._cardTranslations[promptId] ? '🌐 中文' : '🌐 英文';
                }
            }
        });
    },

    bindCardDragDrop() {
        // 为当前渲染的卡片绑定拖拽上传
        var cards = document.querySelectorAll('#promptList .prompt-card');
        var self = this;
        cards.forEach(function(card) {
            // 避免重复绑定
            if (card.dataset.dragUpload) return;
            card.dataset.dragUpload = '1';

            // 拖拽进入高亮
            card.addEventListener('dragenter', function(e) {
                e.preventDefault();
                e.stopPropagation();
                // 只在编辑模式下响应文件拖拽
                if (self.state.editMode && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                    card.classList.add('drag-over');
                    // 隐藏全局导入遮罩（卡片优先处理）
                    var overlay = document.getElementById('dropOverlay');
                    if (overlay) overlay.style.display = 'none';
                }
            }, false);

            card.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (self.state.editMode && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                    card.classList.add('drag-over');
                    var overlay = document.getElementById('dropOverlay');
                    if (overlay) overlay.style.display = 'none';
                }
            }, false);

            card.addEventListener('dragleave', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!self.state.editMode) { card.classList.remove('drag-over'); return; }
                var rect = card.getBoundingClientRect();
                var x = e.clientX, y = e.clientY;
                if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
                    card.classList.remove('drag-over');
                }
            }, false);

            card.addEventListener('drop', function(e) {
                e.preventDefault();
                e.stopPropagation();
                card.classList.remove('drag-over');
                if (!self.state.editMode) return;
                var files = e.dataTransfer.files;
                if (!files || files.length === 0) return;

                var promptId = parseInt(card.getAttribute('data-id'));
                if (!promptId) return;

                // 判断文件类型
                var file = files[0];
                var name = file.name.toLowerCase();
                var isVideo = name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || name.endsWith('.avi');

                if (isVideo) {
                    self._dropUploadVideo(file, promptId);
                } else {
                    self._dropUploadImage(file, promptId);
                }
            }, false);
        });
    },

    async _dropUploadImage(file, promptId) {
        // 拖拽上传图片并关联到提示词
        var formData = new FormData();
        formData.append('file', file);
        try {
            var res = await fetch('/api/thumbnails/upload', {
                method: 'POST',
                body: formData
            });
            var data = await res.json();
            if (!data || !data.ok) {
                this.showToast('上传失败: ' + (data ? data.error : '未知错误'), 'error');
                return;
            }
            // 关联到提示词
            var assignRes = await this.fetchJSON('/api/thumbnails/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: promptId, filename: data.filename })
            });
            if (assignRes && assignRes.ok) {
                this.showToast('✅ 图片已关联到提示词', 'success');
                await this.loadPrompts();
                await this.loadThumbLibrary();
            } else {
                this.showToast('关联失败', 'error');
            }
        } catch(e) {
            this.showToast('上传失败: ' + e.message, 'error');
        }
    },

    async _dropUploadVideo(file, promptId) {
        // 拖拽上传视频并关联到提示词
        var formData = new FormData();
        formData.append('file', file);
        try {
            var res = await fetch('/api/thumbnails/upload-video', {
                method: 'POST',
                body: formData
            });
            var data = await res.json();
            if (!data || !data.ok) {
                this.showToast('上传失败: ' + (data ? data.error : '未知错误'), 'error');
                return;
            }
            // 关联到提示词
            var assignRes = await this.fetchJSON('/api/thumbnails/assign-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: promptId, video_filename: data.filename })
            });
            if (assignRes && assignRes.ok) {
                this.showToast('✅ 视频已关联到提示词', 'success');
                await this.loadPrompts();
                await this.loadThumbLibrary();
            } else {
                this.showToast('关联失败', 'error');
            }
        } catch(e) {
            this.showToast('上传失败: ' + e.message, 'error');
        }
    },

    backToCollections() {
        this.state.currentCollection = null;
        document.getElementById('collectionGroups').style.display = 'grid';
        document.getElementById('collectionItems').style.display = 'none';
        this.renderCollections();
    },

    async deleteCollection(cid) {
        var c = this.state.collections.find(function(x) { return x.id === cid; });
        var name = c ? c.name : '此收藏分组';
        if (!confirm('确认删除「' + name + '」?分组内的词条不会被删除,仅移除分组关联。')) return;
        await this.fetchJSON(`/api/v2/collections/${cid}`, { method: 'DELETE' });
        this.showToast('已删除', 'info');
        await this.loadCollections();
        this.renderCollections();
    },

    async copyCollection(cid) {
        var data = await this.fetchJSON('/api/v2/collections/' + cid + '/copy', { method: 'POST' });
        if (data) {
            this.showToast('已复制为「' + data.name + '」', 'success');
            await this.loadCollections();
            this.renderCollections();
            // 自动打开编辑弹窗,允许修改名称
            var newColl = this.state.collections.find(function(x) { return x.id === data.id; });
            if (newColl) {
                document.getElementById('inputCollectionName').value = data.name;
                document.getElementById('inputCollectionIcon').value = newColl.icon || '⭐';
                App._pendingEditCollection = data.id;
                App._pendingEditRefresh = function() { App.loadCollections(); App.renderCollections(); };
                document.getElementById('modalCreateCollection').querySelector('h5').textContent = '重命名分组';
                document.getElementById('modalCreateCollection').style.display = 'flex';
            }
        }
    },

    setCollectionThumbnail(cid) {
        // 复用缩略图选取弹窗,关联到分组而非提示词
        this._thumbnailPromptId = null;
        this._thumbnailCollectionId = cid;
        this._thumbnailPage = 1;
        document.getElementById('modalThumbnail').style.display = 'flex';
        this._thumbnailTab = 'images';
        this._thumbnailPage = 1;
        this.loadThumbLibrary();
    },

    async changeCollectionIcon(cid, selectEl) {
        var icon = selectEl.value;
        var data = await this.fetchJSON('/api/v2/collections/' + cid, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icon: icon })
        });
        if (data) {
            await this.loadCollections();
            // 同步更新卡片上的收藏徽标图标
            if (this.state.currentView === 'home') {
                await this.loadPrompts();
            }
            this.showToast('图标已更新', 'success');
        }
    },

    showCreateCollectionModal() {
        document.getElementById('inputCollectionName').value = '';
        document.getElementById('inputCollectionIcon').selectedIndex = 0;
        document.getElementById('modalCreateCollection').style.display = 'flex';
    },

    // createCollection 实现在下方 quickCollect 区域

    // ============ 自定义词包 ============
    async loadWordpacks() {
        const data = await this.fetchJSON('/api/v2/wordpacks');
        if (data) {
            this.state.wordpacks = data.items;
            this.updateWordpackBadge();
        }
    },

    updateWordpackBadge() {
        const total = this.state.wordpacks.reduce((s, c) => s + c.item_count, 0);
        const badge = document.getElementById('wordpackBadge');
        if (total > 0) { badge.textContent = this.state.wordpacks.length; badge.style.display = 'block'; }
        else { badge.style.display = 'none'; }
    },

    renderWordpacks() {
        const container = document.getElementById('wordpackList');
        const detail = document.getElementById('wordpackDetail');
        detail.style.display = 'none';
        container.style.display = 'grid';

        if (this.state.wordpacks.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📂</div><p>暂无词包,点击右上角新建</p></div>';
            return;
        }
        let html = '';
        for (const wp of this.state.wordpacks) {
            html += `
                <div class="collection-card" onclick="App.openWordpack(${wp.id})">
                    <div class="card-icon">📦</div>
                    <div class="card-name">${this._escape(wp.name)}</div>
                    <div class="card-count">${wp.item_count} 条${wp.description ? ' · ' + this._escape(wp.description) : ''}</div>
                    <div class="card-actions">
                        <button class="wp-btn" onclick="event.stopPropagation();App.exportWordpack(${wp.id}, 'txt')">TXT</button>
                        <button class="wp-btn" onclick="event.stopPropagation();App.exportWordpack(${wp.id}, 'json')">JSON</button>
                        <button class="wp-btn" style="color:#ef4444;" onclick="event.stopPropagation();App.deleteWordpack(${wp.id})">删除</button>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    },

    async openWordpack(wid) {
        this.state.currentWordpack = wid;
        document.getElementById('wordpackList').style.display = 'none';
        document.getElementById('wordpackDetail').style.display = 'block';

        const wp = this.state.wordpacks.find(w => w.id === wid);
        const header = document.getElementById('wordpackDetailHeader');
        header.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;">
            <div><strong>${this._escape(wp.name)}</strong> · ${wp.item_count} 条</div>
            <div class="wp-actions">
                <button class="wp-btn" onclick="App.exportWordpack(${wid}, 'txt')">📥 导出TXT</button>
                <button class="wp-btn" onclick="App.exportWordpack(${wid}, 'json')">📥 导出JSON</button>
            </div>
        </div>`;

        const data = await this.fetchJSON(`/api/v2/wordpacks/${wid}/items`);
        if (!data) return;
        this.renderWordpackItems(data.items);
    },

    renderWordpackItems(items) {
        const container = document.getElementById('wordpackItemList');
        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>词包为空</p></div>';
            return;
        }
        let html = '<div class="prompt-grid">';
        for (const p of items) {
            html += `
                <div class="prompt-card" draggable="true" data-id="${p.id}">
                    <span class="card-badge">${this._escape(p.category)}</span>
                    <div class="card-content" id="cc_${p.id}">${this._escape(p.content)}</div>
                    ${p.meaning ? `<div class="card-meaning">${this._escape(p.meaning)}</div>` : ''}
                    <div class="card-actions">
                        <button class="btn-copy" onclick="App.trackUsage(${p.id});App.copyText('${this._escape(p.content).replace(/'/g, "\\'")}')">📋 复制</button>
                        <button class="btn-copy" style="border-color:#ef4444;color:#ef4444;" onclick="App.removeFromWordpack(${this.state.currentWordpack}, ${p.id})">移除</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
    },

    backToWordpacks() {
        this.state.currentWordpack = null;
        document.getElementById('wordpackList').style.display = 'grid';
        document.getElementById('wordpackDetail').style.display = 'none';
        this.renderWordpacks();
    },

    async removeFromWordpack(wid, pid) {
        await this.fetchJSON(`/api/v2/wordpacks/${wid}/items/${pid}`, { method: 'DELETE' });
        this.showToast('已移除', 'info');
        await this.loadWordpacks();
        // 重新打开详情
        const data = await this.fetchJSON(`/api/v2/wordpacks/${wid}/items`);
        if (data) this.renderWordpackItems(data.items);
    },

    async deleteWordpack(wid) {
        if (!confirm('确定删除此词包?')) return;
        await this.fetchJSON(`/api/v2/wordpacks/${wid}`, { method: 'DELETE' });
        this.showToast('已删除', 'info');
        await this.loadWordpacks();
        this.renderWordpacks();
    },

    async exportWordpack(wid, fmt) {
        try {
            const res = await fetch(`/api/v2/wordpacks/${wid}/export?fmt=${fmt}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // Get name from content-disposition or use default
            const cd = res.headers.get('Content-Disposition');
            let filename = `wordpack.${fmt}`;
            if (cd) {
                const match = cd.match(/filename="?(.+?)"?$/);
                if (match) filename = match[1];
            }
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('导出成功', 'success');
        } catch (e) {
            this.showToast('导出失败', 'error');
        }
    },

    showCreateWordpackModal() {
        document.getElementById('inputWordpackName').value = '';
        document.getElementById('inputWordpackDesc').value = '';
        document.getElementById('modalCreateWordpack').style.display = 'flex';
    },

    async createWordpack() {
        const name = document.getElementById('inputWordpackName').value.trim();
        const desc = document.getElementById('inputWordpackDesc').value.trim();
        if (!name) { this.showToast('请输入词包名称', 'error'); return; }
        const data = await this.fetchJSON('/api/v2/wordpacks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: desc })
        });
        if (data) {
            document.getElementById('modalCreateWordpack').style.display = 'none';
            this.showToast('词包已创建', 'success');
            await this.loadWordpacks();
            this.renderWordpacks();
        }
    },

    // ============ 最近使用 ============
    async loadHistory() {
        const container = document.getElementById('historyList');
        container.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">加载中...</span></div></div>';
        const data = await this.fetchJSON('/api/v2/history?limit=50');
        if (!data || data.items.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="icon">⏰</div><p>暂无使用记录</p></div>';
            return;
        }
        let html = '<div class="prompt-grid">';
        for (const p of data.items) {
            html += `
                <div class="prompt-card">
                    <span class="card-badge">${this._escape(p.module)}</span>
                    <div class="card-content" id="cc_${p.id}">${this._escape(p.content)}</div>
                    ${p.meaning ? `<div class="card-meaning">${this._escape(p.meaning)}</div>` : ''}
                    <div class="card-actions">
                        <span style="font-size:11px;color:#94a3b8;margin-right:auto;">${p.used_at ? p.used_at.substring(0, 16) : ''}</span>
                        <button class="btn-copy" onclick="App.trackUsage(${p.id});App.copyText('${this._escape(p.content).replace(/'/g, "\\'")}')">📋 复制</button>
                        <button class="btn-copy" style="border-color:#ef4444;color:#ef4444;padding:3px 8px;" onclick="App.deleteHistoryItem(${p.id})">×</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
    },

    async clearHistory() {
        if (!confirm('确定清空所有使用记录?')) return;
        await this.fetchJSON('/api/v2/history', { method: 'DELETE' });
        this.showToast('已清空', 'info');
        this.loadHistory();
    },

    async deleteHistoryItem(pid) {
        await this.fetchJSON(`/api/v2/history/${pid}`, { method: 'DELETE' });
        this.showToast('已移除', 'info');
        this.loadHistory();
    },

    // ============ 回收站 ============

    _trashPage: 1,

    async loadTrash() {
        var grid = document.getElementById('trashList');
        grid.innerHTML = '<div class="loading-spinner"><p>加载中...</p></div>';
        var data = await this.fetchJSON('/api/v2/trash?page=' + this._trashPage + '&page_size=50');
        if (!data) { grid.innerHTML = '<div class="empty-state"><div class="icon">🗑️</div><p>回收站为空</p></div>'; return; }
        var html = '';
        if (data.items.length === 0) {
            html = '<div class="empty-state"><div class="icon">🗑️</div><p>回收站为空</p></div>';
        } else {
            html = '<div class="prompt-grid">';
            for (var i = 0; i < data.items.length; i++) {
                var p = data.items[i];
                const tags = JSON.parse(p.tags || '[]');
                const tagHtml = tags.map(t => `<span class="card-badge">${this._escape(t)}</span>`).join('');
                html += '<div class="prompt-card" style="opacity:0.85;">' +
                    '<div class="card-body">' +
                    '<div class="card-thumb">' +
                    '<div class="card-thumb-inner">' +
                    (p.thumbnail
                        ? (p.video_filename
                            ? '<div class="thumb-video-wrap-preview"><img class="thumb-video-poster" src="/api/thumbnails/file/' + p.thumbnail + '" alt="" loading="lazy"><video class="thumb-video" src="/api/thumbnails/video/' + p.video_filename + '" loop muted playsinline preload="none"></video></div>'
                            : '<img src="/api/thumbnails/file/' + p.thumbnail + '" alt="缩略图">'
                          )
                        : '<div class="thumb-placeholder"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>'
                    ) +
                    '</div>' +
                    '</div>' +
                    '<div class="card-text">' +
                    '<div style="display:flex;align-items:center;margin-bottom:6px;gap:4px;">' +
                    '<span class="card-badge">' + this._escape(p.category) + '</span>' +
                    (p.subcategory ? '<span style="font-size:10px;color:#94a3b8;">' + this._escape(p.subcategory) + '</span>' : '') +
                    '</div>' +
                    '<div class="card-content">' + this._escape(p.content) + '</div>' +
                    (p.meaning ? '<div class="card-meaning">' + this._escape(p.meaning) + '</div>' : '') +
                    (p.scene ? '<div class="card-scene">🎯 ' + this._escape(p.scene) + '</div>' : '') +
                    '<div style="font-size:10px;color:#cbd5e1;margin-bottom:6px;">' + tagHtml + '</div>' +
                    '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">使用 ' + p.usage_count + ' 次 · 删除于 ' + (p.deleted_at || '') + '</div>' +
                    '<div class="card-actions" style="margin-top:6px;">' +
                    '<button class="btn-copy" onclick="App.restoreFromTrash(' + p.id + ')" style="border-color:#10b981;color:#10b981;">↩ 恢复</button>' +
                    '<button class="btn-copy" onclick="App.permanentDelete(' + p.id + ')" style="border-color:#ef4444;color:#ef4444;">🗑 永久删除</button>' +
                    '</div></div></div></div>';
            }
            html += '</div>';
        }
        grid.innerHTML = html;
        // 绑定视频悬停播放
        this.bindVideoHover();
        // 注册拖拽导入（首页词库视图）
        if (this.state.currentView === 'home' && !this._dropAttached) {
            this._dropAttached = true;
            container.addEventListener('dragover', App._onDragOver);
            container.addEventListener('dragleave', App._onDragLeave);
            container.addEventListener('drop', App._onDropPng);
        }

        var pbar = document.getElementById('trashPagination');
        if (data.total_pages <= 1) { pbar.innerHTML = ''; } else {
            var ph = '';
            for (var pi = 1; pi <= data.total_pages; pi++) {
                ph += '<button class="page-btn ' + (pi === this._trashPage ? 'active' : '') + '" onclick="App._trashPage=' + pi + ';App.loadTrash()">' + pi + '</button>';
            }
            pbar.innerHTML = ph;
        }
        var b1 = document.getElementById('btnRestoreAllTrash');
        var b2 = document.getElementById('btnEmptyTrash');
        if (b1) b1.style.display = data.total > 0 ? 'inline-flex' : 'none';
        if (b2) b2.style.display = data.total > 0 ? 'inline-flex' : 'none';
    },

    async restoreFromTrash(pid) {
        await this.fetchJSON('/api/v2/trash/' + pid + '/restore', { method: 'POST' });
        this.showToast('已恢复', 'success');
        this.loadTrash();
        this.loadPrompts();
    },

    async restoreAllTrash() {
        if (!confirm('确认全部恢复？')) return;
        var data = await this.fetchJSON('/api/v2/trash?page_size=500');
        if (!data || data.items.length === 0) return;
        var ids = data.items.map(function(p) { return p.id; });
        await this.fetchJSON('/api/v2/trash/batch-restore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        this.showToast('已全部恢复', 'success');
        this.loadTrash();
        this.loadPrompts();
    },

    async permanentDelete(pid) {
        if (!confirm('永久删除后无法恢复，确认删除？')) return;
        await this.fetchJSON('/api/v2/trash/' + pid, { method: 'DELETE' });
        this.showToast('已永久删除', 'info');
        this.loadTrash();
    },

    async emptyTrash() {
        if (!confirm('确认清空回收站？所有词条将被永久删除！')) return;
        await this.fetchJSON('/api/v2/trash/empty', { method: 'POST' });
        this.showToast('回收站已清空', 'info');
        this.loadTrash();
    },

    // ============ 主题切换 ============
    async toggleTheme() {
        const newTheme = this.state.theme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        // 持久化到后端
        await this.fetchJSON('/api/v2/config/theme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: newTheme })
        });
        localStorage.setItem('promptkit_theme', newTheme);
    },

    // ============ 数据库备份 ============

    async showBackupInfo() {
        document.getElementById('modalBackup').style.display = 'flex';
        document.getElementById('backupInfoBody').innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">正在获取备份状态...</p></div>';
        document.getElementById('backupStatusText').textContent = '加载中...';
        try {
            var data = await this.fetchJSON('/api/backup/info');
            if (!data) { throw new Error('获取失败'); }
            this._renderBackupInfo(data);
        } catch (e) {
            document.getElementById('backupInfoBody').innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">❌ 获取备份信息失败: ' + e.message + '</div>';
            document.getElementById('backupStatusText').textContent = '加载失败';
        }
    },

    _renderBackupInfo(data) {
        var body = document.getElementById('backupInfoBody');
        var html = '';

        // 当前数据库状态
        var dbSize = data.db_size || 0;
        var dbSizeStr = dbSize > 1048576 ? (dbSize / 1048576).toFixed(1) + ' MB' : (dbSize / 1024).toFixed(1) + ' KB';
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">📊 数据库状态</div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">';
        html += '<div style="padding:8px 12px;background:var(--hover-bg,#f1f5f9);border-radius:6px;"><span style="color:var(--text-muted);">数据库大小</span><br><strong>' + dbSizeStr + '</strong></div>';
        html += '<div style="padding:8px 12px;background:var(--hover-bg,#f1f5f9);border-radius:6px;"><span style="color:var(--text-muted);">备份数量</span><br><strong>' + (data.total_backups || 0) + '</strong></div>';
        html += '<div style="padding:8px 12px;background:var(--hover-bg,#f1f5f9);border-radius:6px;"><span style="color:var(--text-muted);">备份目录大小</span><br><strong>' + (data.backup_dir_size > 1048576 ? (data.backup_dir_size/1048576).toFixed(1)+' MB' : (data.backup_dir_size/1024).toFixed(1)+' KB') + '</strong></div>';
        html += '<div style="padding:8px 12px;background:var(--hover-bg,#f1f5f9);border-radius:6px;"><span style="color:var(--text-muted);">保留策略</span><br><strong>' + (data.keep_days || 7) + ' 天轮换</strong></div>';
        html += '</div></div>';

        // 最近备份时间
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">⏰ 最近备份</div>';
        if (data.last_backup_time_str) {
            html += '<div style="font-size:12px;color:var(--text-muted);">上次备份: <strong>' + data.last_backup_time_str + '</strong></div>';
        } else {
            html += '<div style="font-size:12px;color:var(--text-muted);">尚未备份</div>';
        }
        if (data.last_error) {
            html += '<div style="font-size:12px;color:#ef4444;margin-top:4px;">上次错误: ' + data.last_error + '</div>';
        }
        html += '</div>';

        // 备份文件列表
        var backups = data.recent_backups || [];
        if (backups.length > 0) {
            html += '<div style="margin-bottom:8px;">';
            html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">📁 备份文件（最近 10 个）</div>';
            html += '<div style="max-height:200px;overflow-y:auto;font-size:11px;">';
            for (var i = 0; i < backups.length; i++) {
                var b = backups[i];
                var bSize = b.size > 1048576 ? (b.size / 1048576).toFixed(1) + ' MB' : (b.size / 1024).toFixed(1) + ' KB';
                html += '<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid var(--border-color);">';
                html += '<span>' + this._escape(b.name) + '</span>';
                html += '<span style="color:var(--text-muted);">' + bSize + '</span>';
                html += '</div>';
            }
            html += '</div></div>';
        }

        body.innerHTML = html;

        // 更新状态
        document.getElementById('backupStatusText').textContent = '自动备份每 ' + (data.keep_days*24 || 168) + ' 小时执行一次';
    },

    async doBackupNow() {
        document.getElementById('backupStatusText').textContent = '正在备份...';
        try {
            var data = await this.fetchJSON('/api/backup/now', { method: 'POST' });
            if (data && data.ok) {
                this.showToast('备份成功: ' + data.file + ' (' + (data.size/1024).toFixed(1) + ' KB)', 'success');
                // 刷新信息
                await this.showBackupInfo();
            } else {
                this.showToast('备份失败: ' + (data ? data.error : '未知错误'), 'error');
                document.getElementById('backupStatusText').textContent = '备份失败';
            }
        } catch (e) {
            this.showToast('备份失败: ' + e.message, 'error');
            document.getElementById('backupStatusText').textContent = '备份失败';
        }
    },

        // ============ 统计仪表盘 ============

    async showDashboard() {
        document.getElementById('modalDashboard').style.display = 'flex';
        document.getElementById('dashboardBody').innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">加载统计数据...</p></div>';
        try {
            var data = await this.fetchJSON('/api/v2/stats/dashboard');
            if (!data) throw new Error('获取失败');
            this._renderDashboard(data);
        } catch(e) {
            document.getElementById('dashboardBody').innerHTML = '<div style="padding:30px;text-align:center;color:#ef4444;">❌ ' + e.message + '</div>';
        }
    },

    _renderDashboard(d) {
        var html = '';

        // 概览卡片
        html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">';
        var cards = [
            {label:'总词条', val:d.total_prompts, icon:'📝'},
            {label:'今日使用', val:d.today_usage, icon:'☀️'},
            {label:'收藏', val:d.total_collections, icon:'⭐'},
            {label:'回收站', val:d.trash_count, icon:'🗑️'}
        ];
        for (var i = 0; i < cards.length; i++) {
            html += '<div style="background:var(--hover-bg,#f1f5f9);border-radius:8px;padding:12px;text-align:center;">';
            html += '<div style="font-size:20px;">' + cards[i].icon + '</div>';
            html += '<div style="font-size:20px;font-weight:700;">' + cards[i].val + '</div>';
            html += '<div style="font-size:11px;color:var(--text-muted);">' + cards[i].label + '</div></div>';
        }
        html += '</div>';

        // 模块分布
        if (d.modules && d.modules.length > 0) {
            html += '<div style="margin-bottom:16px;"><div style="font-size:14px;font-weight:600;margin-bottom:8px;">📊 模块分布</div>';
            var maxCount = d.modules[0].count;
            for (var i = 0; i < d.modules.length; i++) {
                var m = d.modules[i];
                var pct = maxCount > 0 ? (m.count / maxCount * 100).toFixed(0) : 0;
                html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px;">';
                html += '<span style="width:80px;flex-shrink:0;">' + this._escape(m.name) + '</span>';
                html += '<div style="flex:1;height:18px;background:var(--border-color);border-radius:4px;overflow:hidden;">';
                html += '<div style="width:' + pct + '%;height:100%;background:#818cf8;border-radius:4px;display:flex;align-items:center;padding-left:6px;color:#fff;font-size:10px;">' + (pct > 15 ? m.count : '') + '</div></div>';
                html += '<span style="width:30px;text-align:right;color:var(--text-muted);">' + m.count + '</span></div>';
            }
            html += '</div>';
        }

        // 使用频率 TOP 10
        if (d.top_used && d.top_used.length > 0) {
            html += '<div style="margin-bottom:16px;"><div style="font-size:14px;font-weight:600;margin-bottom:8px;">🏆 使用频率 TOP 10</div>';
            html += '<div style="font-size:11px;">';
            for (var i = 0; i < d.top_used.length; i++) {
                var t = d.top_used[i];
                html += '<div style="display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-color);gap:8px;">';
                html += '<span style="color:var(--text-muted);width:20px;">#' + (i+1) + '</span>';
                html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + this._escape(t.content) + '</span>';
                html += '<span style="color:var(--text-muted);">' + t.usage_count + ' 次</span>';
                html += '</div>';
            }
            html += '</div></div>';
        }

        // 标签 TOP 20
        if (d.tags && d.tags.length > 0) {
            html += '<div style="margin-bottom:8px;"><div style="font-size:14px;font-weight:600;margin-bottom:8px;">🏷️ 标签分布 TOP 20</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
            for (var i = 0; i < d.tags.length; i++) {
                var tg = d.tags[i];
                var sz = Math.min(16, Math.max(11, 10 + tg.count));
                html += '<span style="font-size:' + sz + 'px;padding:3px 10px;background:var(--hover-bg,#f1f5f9);border-radius:12px;color:var(--text-main);">' + this._escape(tg.name) + '<span style="color:var(--text-muted);margin-left:4px;font-size:10px;">×' + tg.count + '</span></span>';
            }
            html += '</div></div>';
        }

        document.getElementById('dashboardBody').innerHTML = html;
    },


    // ============ ComfyUI 集成 ============

    async openComfyConfig() {
        document.getElementById('modalComfyUI').style.display = 'flex';
        document.getElementById('comfyUIConfigBody').innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">加载配置...</p></div>';
        try {
            var data = await this.fetchJSON('/api/v2/comfyui/config');
            if (!data || !data.config) throw new Error('获取失败');
            this._comfyConfig = data.config;
            this._renderComfyConfig(data.config);
        } catch(e) {
            document.getElementById('comfyUIConfigBody').innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">❌ ' + e.message + '</div>';
        }
    },

    _renderComfyConfig(cfg) {
        var html = '';
        html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">ComfyUI 服务器地址</label>';
        html += '<input type="text" id="comfyServerUrl" class="modal-input" value="' + this._escape(cfg.server_url || 'http://127.0.0.1:8188') + '" placeholder="http://127.0.0.1:8188"></div>';

        html += '<div style="margin-bottom:12px;"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">';
        html += '<input type="checkbox" id="comfyEnabled" ' + (cfg.enabled ? 'checked' : '') + '> 启用 ComfyUI 集成</label></div>';

        // 工作流模板列表
        var wfs = cfg.workflows || [];
        html += '<div style="margin-bottom:8px;"><div style="font-size:13px;font-weight:600;margin-bottom:8px;">工作流模板</div>';
        if (wfs.length === 0) {
            html += '<div style="font-size:12px;color:var(--text-muted);padding:8px;background:var(--hover-bg,#f1f5f9);border-radius:6px;">暂无工作流模板，请先在工作流导入界面导出 API 格式的工作流 JSON</div>';
        }
        for (var i = 0; i < wfs.length; i++) {
            var w = wfs[i];
            html += '<div style="background:var(--hover-bg,#f1f5f9);border-radius:6px;padding:10px;margin-bottom:8px;">';
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">';
            html += '<input type="radio" name="comfyWorkflow" value="' + this._escape(w.id || '') + '" ' + (w.id === cfg.active_workflow ? 'checked' : '') + '>';
            html += '<strong style="font-size:13px;">' + this._escape(w.name || '未命名') + '</strong>';
            html += '<span style="font-size:11px;color:var(--text-muted);">' + this._escape(w.description || '') + '</span>';
            html += '</div>';
            html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">';
            html += '<label>提示词节点 ID: <input type="text" class="wf-param" data-idx="' + i + '" data-field="prompt_node_id" value="' + this._escape(w.prompt_node_id || '6') + '" style="width:50px;padding:2px 4px;border:1px solid var(--border-color);border-radius:4px;"></label>';
            html += '<label>提示词字段: <input type="text" class="wf-param" data-idx="' + i + '" data-field="prompt_field" value="' + this._escape(w.prompt_field || 'text') + '" style="width:80px;padding:2px 4px;border:1px solid var(--border-color);border-radius:4px;"></label>';
            html += '<label>输出图片节点: <input type="text" class="wf-param" data-idx="' + i + '" data-field="image_output_node_id" value="' + this._escape(w.image_output_node_id || '9') + '" style="width:50px;padding:2px 4px;border:1px solid var(--border-color);border-radius:4px;"></label>';
            html += '</div></div>';
        }

        // 导入工作流 JSON
        html += '<div style="margin-top:8px;"><button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;" onclick="document.getElementById(\'comfyWorkflowFile\').click()">📂 导入工作流 JSON</button>';
        html += '<input type="file" id="comfyWorkflowFile" accept=".json" style="display:none;" onchange="App._importComfyWorkflow(this)"></div>';

        html += '<div id="comfyImportStatus" style="margin-top:8px;font-size:11px;color:var(--text-muted);"></div>';

        document.getElementById('comfyUIConfigBody').innerHTML = html;
    },

    _importComfyWorkflow(input) {
        var file = input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var wf = JSON.parse(e.target.result);
                if (!wf || typeof wf !== 'object') throw new Error('无效的工作流 JSON');
                var status = document.getElementById('comfyImportStatus');
                if (!status) return;
                // 提取节点信息
                var textNodes = [];
                for (var key in wf) {
                    var node = wf[key];
                    if (node && node.class_type && (node.class_type === 'CLIPTextEncode' || node.class_type === 'CLIPPromptEncode' || (node.inputs && node.inputs.text))) {
                        textNodes.push(key);
                    }
                }
                var promptNode = textNodes[0] || '6';
                status.innerHTML = '✅ 已导入工作流，检测到 ' + Object.keys(wf).length + ' 个节点。提示词节点: ' + promptNode;
                status.style.color = '#059669';
                // 保存到临时变量
                App._importedWorkflow = wf;
                App._importedPromptNode = promptNode;
            } catch(err) {
                var status = document.getElementById('comfyImportStatus');
                if (status) {
                    status.innerHTML = '❌ ' + err.message;
                    status.style.color = '#ef4444';
                }
            }
        };
        reader.readAsText(file);
    },

    async _saveComfyConfig() {
        var cfg = {
            server_url: document.getElementById('comfyServerUrl').value.trim() || 'http://127.0.0.1:8188',
            enabled: document.getElementById('comfyEnabled').checked,
            workflows: [],
            active_workflow: ''
        };
        // 收集现有工作流参数
        var params = document.querySelectorAll('.wf-param');
        var wfMap = {};
        for (var i = 0; i < params.length; i++) {
            var p = params[i];
            var idx = parseInt(p.getAttribute('data-idx'));
            var field = p.getAttribute('data-field');
            if (!wfMap[idx]) wfMap[idx] = {};
            wfMap[idx][field] = p.value;
        }
        // 读取已有工作流
        var oldCfg = this._comfyConfig || {};
        var oldWfs = oldCfg.workflows || [];
        for (var i = 0; i < oldWfs.length; i++) {
            var w = Object.assign({}, oldWfs[i]);
            if (wfMap[i]) {
                if (wfMap[i].prompt_node_id) w.prompt_node_id = wfMap[i].prompt_node_id;
                if (wfMap[i].prompt_field) w.prompt_field = wfMap[i].prompt_field;
                if (wfMap[i].image_output_node_id) w.image_output_node_id = wfMap[i].image_output_node_id;
            }
            cfg.workflows.push(w);
        }
        // 如果有新导入的工作流
        if (this._importedWorkflow) {
            var name = prompt('命名此工作流模板:', '文生图');
            if (name) {
                var wfId = 'wf_' + Date.now();
                var wfItem = {
                    id: wfId,
                    name: name,
                    description: '从 JSON 导入',
                    prompt_node_id: this._importedPromptNode || '6',
                    prompt_field: 'text',
                    image_output_node_id: '9',
                    workflow_json: this._importedWorkflow
                };
                cfg.workflows.push(wfItem);
                cfg.active_workflow = wfId;
                this._importedWorkflow = null;
            }
        }
        // 选中的工作流
        var radio = document.querySelector('input[name="comfyWorkflow"]:checked');
        if (radio) cfg.active_workflow = radio.value;

        var data = await this.fetchJSON('/api/v2/comfyui/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: cfg })
        });
        if (data && data.ok) {
            this._comfyConfig = cfg;
            this.showToast('ComfyUI 配置已保存', 'success');
        } else {
            this.showToast('保存失败', 'error');
        }
    },

    async generateComfyThumbnail() {
        var pid = this._editingPromptId;
        if (!pid) { this.showToast('请先打开编辑弹窗', 'error'); return; }

        var cfg = await this.fetchJSON('/api/v2/comfyui/config');
        if (!cfg || !cfg.config || !cfg.config.enabled) {
            this.showToast('ComfyUI 未启用，请先配置', 'warning');
            this.openComfyConfig();
            return;
        }
        if (!cfg.config.active_workflow && (!cfg.config.workflows || cfg.config.workflows.length === 0)) {
            this.showToast('请先导入 ComfyUI 工作流模板', 'warning');
            this.openComfyConfig();
            return;
        }

        // 取当前编辑框里的提示词
        var promptText = document.getElementById('editContent').value.trim();
        if (!promptText) { this.showToast('请先输入提示词内容', 'error'); return; }

        this.showToast('⏳ 正在发送到 ComfyUI 生成...', 'info');
        var btn = document.querySelector('[onclick*="generateComfyThumbnail"]');
        if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }

        try {
            var body = {
                prompt_id: pid,
                prompt_text: promptText,
                workflow_id: cfg.config.active_workflow || ''
            };
            var data = await this.fetchJSON('/api/v2/comfyui/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (data && data.ok) {
                this.showToast('✅ 生成完成，缩略图已更新', 'success');
                // 刷新编辑弹窗的缩略图
                if (data.thumbnail) {
                    var preview = document.getElementById('editThumbPreview');
                    if (preview) preview.innerHTML = '<img src="/api/thumbnails/file/' + data.thumbnail + '" style="width:120px;height:80px;object-fit:cover;border-radius:6px;">';
                    var nameEl = document.getElementById('editThumbName');
                    if (nameEl) nameEl.textContent = data.thumbnail;
                }
            } else {
                this.showToast('生成失败: ' + (data ? data.error : '未知错误'), 'error');
            }
        } catch(e) {
            this.showToast('生成失败: ' + e.message, 'error');
        }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-magic"></i> AI 生成'; }
    },


    showWorkflowHelp() {
        document.getElementById('modalWorkflow').style.display = 'flex';
    },

    // ============ 标签自动补全 ============

    _onTagInput() {
        var inp = document.getElementById('editTags');
        var sug = document.getElementById('tagSuggestions');
        if (!inp || !sug || !this._allTags) return;
        var val = inp.value;
        var cp = inp.selectionStart || 0;
        var bef = val.substring(0, cp);
        var lq = bef.lastIndexOf('"');
        var cur = lq >= 0 ? bef.substring(lq + 1) : val;
        cur = cur.replace(/[\[\],\s"]/g, '');
        if (!cur) { sug.style.display = 'none'; return; }
        var ms = this._allTags.filter(function(t) {
            return t.toLowerCase().indexOf(cur.toLowerCase()) >= 0;
        });
        if (ms.length === 0) { sug.style.display = 'none'; return; }
        var h = '';
        for (var i = 0; i < Math.min(ms.length, 8); i++) {
            var tag = ms[i];
            h += '<div class="tag-sug-item" onmousedown="App._pickTag(\'' + tag.replace(/'/g, "\\'") + '\')">' + this._escape(tag) + '</div>';
        }
        sug.innerHTML = h;
        sug.style.display = 'block';
    },

    _pickTag(tag) {
        var inp = document.getElementById('editTags');
        if (!inp) return;
        try {
            var arr = JSON.parse(inp.value || '[]');
            if (!Array.isArray(arr)) arr = [];
            if (arr.indexOf(tag) < 0) arr.push(tag);
            inp.value = JSON.stringify(arr);
        } catch(e) {
            var cur = inp.value.trim();
            inp.value = cur ? cur + ',"' + tag + '"' : '["' + tag + '"]';
        }
        var sug = document.getElementById('tagSuggestions');
        if (sug) sug.style.display = 'none';
        inp.focus();
    },

    async batchTag() {
        var ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast('请先选择词条', 'error'); return; }
        var tags = prompt('输入标签（多个用逗号分隔）:\n例如: 自然,温暖,户外');
        if (!tags) return;
        var list = tags.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; });
        if (list.length === 0) return;
        var mode = confirm('确定添加标签？\n\n取消 = 移除这些标签') ? 'add' : 'remove';
        var data = await this.fetchJSON('/api/v2/tags/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids, tags: list, mode: mode })
        });
        if (data && data.ok) {
            this.showToast('已' + (mode === 'add' ? '添加' : '移除') + ' ' + data.updated + ' 条词条的标签', 'success');
            this.loadPrompts();
        } else {
            this.showToast('操作失败', 'error');
        }
    },


// ============ 版本历史 ============

    async showVersionHistory(promptId) {
        document.getElementById('modalVersions').style.display = 'flex';
        document.getElementById('versionTitle').textContent = '版本历史';
        document.getElementById('versionBody').innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">加载版本历史...</p></div>';
        try {
            var data = await this.fetchJSON('/api/v2/versions/' + promptId);
            if (!data) throw new Error('获取失败');
            this._renderVersionList(promptId, data);
        } catch (e) {
            document.getElementById('versionBody').innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">❌ 获取版本历史失败: ' + e.message + '</div>';
        }
    },

    _renderVersionList(promptId, data) {
        var body = document.getElementById('versionBody');
        var html = '';

        // 当前版本
        var cur = data.current || {};
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:14px;font-weight:600;margin-bottom:8px;">当前版本（最新）</div>';
        html += '<div style="background:var(--hover-bg,#f1f5f9);border-radius:8px;padding:10px 14px;border:1px solid var(--primary);font-size:12px;">';
        html += '<div style="color:var(--text-muted);margin-bottom:4px;">' + this._escape(cur.content || '').substring(0, 80) + (cur.content && cur.content.length > 80 ? '...' : '') + '</div>';
        html += '<div style="display:flex;gap:6px;color:var(--text-muted);font-size:11px;">';
        html += '<span>模块: ' + this._escape(cur.module || '-') + '</span>';
        html += '<span>分类: ' + this._escape(cur.category || '-') + '</span>';
        html += '</div></div></div>';

        // 历史版本列表
        var versions = data.versions || [];
        if (versions.length === 0) {
            html += '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">暂无历史版本</div>';
        } else {
            html += '<div style="font-size:14px;font-weight:600;margin-bottom:8px;">历史版本（共 ' + versions.length + ' 个）</div>';
            for (var i = 0; i < versions.length; i++) {
                var v = versions[i];
                var contentPreview = (v.content || '').substring(0, 60);
                var isCurrent = false; // all historical
                var bg = 'var(--hover-bg,#f1f5f9)';
                html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin-bottom:6px;background:' + bg + ';border-radius:6px;font-size:12px;">';
                html += '<div style="flex:1;min-width:0;">';
                html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
                html += '<strong>v' + v.version + '</strong>';
                html += '<span style="color:var(--text-muted);">' + this._escape(v.created_at || '') + '</span>';
                if (v.change_note) html += '<span style="color:#6366f1;">' + this._escape(v.change_note) + '</span>';
                html += '</div>';
                html += '<div style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + this._escape(contentPreview) + '</div>';
                html += '</div>';
                html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
                html += '<button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;" onclick="App._restoreVersion(' + promptId + ',' + v.id + ',' + v.version + ')">↩ 恢复</button>';
                if (i < versions.length - 1) {
                    html += '<button class="btn btn-sm" style="border:1px solid #22c55e;color:#22c55e;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;" onclick="App._showVersionDiff(' + promptId + ',' + versions[i+1].id + ',' + v.id + ')">⇄ diff</button>';
                } else {
                    // 对比当前 vs 最早版本
                    html += '<button class="btn btn-sm" style="border:1px solid #22c55e;color:#22c55e;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;" onclick="App._showVersionDiff(' + promptId + ',' + promptId + ',' + v.id + ')">⇄ diff</button>';
                }
                html += '</div>';
                html += '</div>';
            }
        }

        body.innerHTML = html;
    },

    async _restoreVersion(promptId, versionId, versionNum) {
        if (!confirm('确认恢复到 v' + versionNum + '？当前版本将自动存档')) return;
        try {
            var data = await this.fetchJSON('/api/v2/versions/' + promptId + '/restore/' + versionId, { method: 'POST' });
            if (data && data.ok) {
                this.showToast('已恢复到 v' + versionNum, 'success');
                document.getElementById('modalVersions').style.display = 'none';
                await this.loadPrompts();
            } else {
                this.showToast('恢复失败: ' + (data ? data.error : '未知'), 'error');
            }
        } catch (e) {
            this.showToast('恢复失败: ' + e.message, 'error');
        }
    },

    async _showVersionDiff(promptId, v1Id, v2Id) {
        document.getElementById('modalVersionDiff').style.display = 'flex';
        document.getElementById('diffTitle').textContent = '版本对比';
        document.getElementById('diffBody').innerHTML = '<div style="text-align:center;padding:20px;font-family:sans-serif;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">正在对比...</p></div>';
        try {
            var data = await this.fetchJSON('/api/v2/versions/' + promptId + '/diff/' + v1Id + '/' + v2Id);
            if (!data || !data.ok) throw new Error(data ? data.error : '获取失败');
            var html = '';
            var diffs = data.diffs || [];
            if (diffs.length === 0) {
                html = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-family:sans-serif;"><span style="font-size:40px;">✅</span><p style="margin-top:8px;">两个版本完全相同</p></div>';
            } else {
                html += '<div style="margin-bottom:12px;font-family:sans-serif;font-size:12px;color:var(--text-muted);">';
                html += '对比: v' + data.v1.version + ' ↔ v' + data.v2.version + ' | 共 ' + data.total_changes + ' 处差异';
                html += '</div>';
                for (var d = 0; d < diffs.length; d++) {
                    var diff = diffs[d];
                    html += '<div style="margin-bottom:12px;border:1px solid var(--border-color);border-radius:6px;overflow:hidden;">';
                    html += '<div style="background:var(--hover-bg,#f1f5f9);padding:6px 10px;font-size:11px;font-weight:600;font-family:sans-serif;">' + diff.field + '</div>';
                    html += '<div style="padding:8px 10px;">';
                    html += '<div style="background:#fef2f2;color:#ef4444;padding:6px 8px;border-radius:4px;margin-bottom:4px;font-size:12px;"><span style="font-weight:600;">旧</span> ' + this._escape(diff.old || '(空)') + '</div>';
                    html += '<div style="background:#f0fdf4;color:#059669;padding:6px 8px;border-radius:4px;font-size:12px;"><span style="font-weight:600;">新</span> ' + this._escape(diff.new || '(空)') + '</div>';
                    html += '</div></div>';
                }
            }
            document.getElementById('diffBody').innerHTML = html;
        } catch (e) {
            document.getElementById('diffBody').innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;font-family:sans-serif;">❌ ' + e.message + '</div>';
        }
    },

    applyTheme(theme) {
        this.state.theme = theme;
        const btn = document.getElementById('btnTheme');
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
            if (btn) btn.innerHTML = '<i class="bi bi-sun"></i>';
        } else {
            document.body.classList.remove('dark-theme');
            if (btn) btn.innerHTML = '<i class="bi bi-moon-stars"></i>';
        }
    },

    // ============ 卡片列数控制 ============

    onColumnSlider(val) {
        this.state.columns = parseInt(val);
        document.getElementById('columnSlider').value = val;
        document.getElementById('columnLabel').textContent = val + '列';
        try { localStorage.setItem('promptkit_columns', val); } catch(e) {}
        this.applyColumns();
    },

    applyColumns() {
        var cols = this.state.columns || 3;
        // 不再更新滑块UI，只更新CSS grid列数
        var grids = document.querySelectorAll('.prompt-grid');
        for (var i = 0; i < grids.length; i++) {
            grids[i].style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
        }

        // 根据列数调整缩略图大小
        var thumbW, thumbH;
        if (cols <= 1)      { thumbW = 485; thumbH = 323; }
        else if (cols <= 2) { thumbW = 340; thumbH = 227; }
        else if (cols <= 3) { thumbW = 140; thumbH = 93; }
        else if (cols <= 4) { thumbW = 110; thumbH = 73; }
        else if (cols <= 5) { thumbW = 95;  thumbH = 63; }
        else                { thumbW = 85;  thumbH = 57; }
        var root = document.documentElement;
        root.style.setProperty('--thumb-w', thumbW + 'px');
        root.style.setProperty('--thumb-h', thumbH + 'px');
    },

    decColumn() {
        var cur = this.state.columns || 3;
        if (cur > 1) this.onColumnSlider(cur - 1);
    },
    incColumn() {
        var cur = this.state.columns || 3;
        if (cur < 6) this.onColumnSlider(cur + 1);
    },


    // ============ 编辑模式 ============

    async openEditModal(promptId) {
        try {
            var td = await this.fetchJSON('/api/v2/tags/list');
            if (td && td.tags) this._allTags = td.tags;
        } catch(e) {}
        var ti = document.getElementById('editTags');
        if (ti && !ti._bound) {
            ti._bound = true;
            var self = this;
            ti.addEventListener('input', function() { self._onTagInput(); });
            ti.addEventListener('blur', function() { setTimeout(function() {
                var el = document.getElementById('tagSuggestions');
                if (el) el.style.display = 'none';
            }, 200); });
            ti.addEventListener('focus', function() { if (this.value) self._onTagInput(); });
        }
        var data = await this.fetchJSON('/api/prompts/' + promptId);
        if (!data) return;
        this._editingPromptId = promptId;
        // 加载当前缩略图/视频
        this._editThumbFilename = data.thumbnail || null;
        this._editVideoFilename = data.video_filename || null;
        this._editHadThumbOriginal = !!(data.thumbnail || data.video_filename);
        this._editThumbnailCleared = false;
        this._editThumbnailMode = false;
        this.updateEditThumbDisplay();
        document.getElementById('editPromptTitle').textContent = promptId > 151 ? '编辑提示词' : '查看提示词';
        document.getElementById('editContent').value = data.content || '';
        document.getElementById('editMeaning').value = data.meaning || '';
        document.getElementById('editScene').value = data.scene || '';
        this._populateModuleOptions(data.module || '');
        document.getElementById('editCategory').value = data.category || '';
        document.getElementById('editTags').value = data.tags || '[]';
        var delBtn = document.getElementById('editDeleteBtn');
        if (data.is_builtin == 1) {
            delBtn.style.display = 'none';
        } else {
            delBtn.style.display = 'inline-block';
        }
        // 恢复保存按钮为编辑保存
        var saveBtn = document.querySelector('#modalEditPrompt .btn-primary');
        saveBtn.onclick = null;
        saveBtn.onclick = function() { App.saveEditPrompt(); };
        document.getElementById('modalEditPrompt').style.display = 'flex';
    },

    async saveEditPrompt() {
        var pid = this._editingPromptId;
        if (!pid) return;
        var data = {
            content: document.getElementById('editContent').value.trim(),
            meaning: document.getElementById('editMeaning').value.trim(),
            scene: document.getElementById('editScene').value.trim(),
            module: document.getElementById('editModule').value,
            category: document.getElementById('editCategory').value.trim(),
            tags: document.getElementById('editTags').value.trim()
        };
        if (!data.content) { this.showToast('内容不能为空', 'error'); return; }
        var result = await this.fetchJSON('/api/prompts/' + pid, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (result) {
            // 保存缩略图变更
            await this._saveEditThumbnail(pid);
            this.closeEditModal();
            this.showToast('保存成功', 'success');
            await this.loadPrompts();
        }
    },

    async _saveEditThumbnail(pid) {
        var setThumb = this._editThumbFilename;
        var setVideo = this._editVideoFilename;
        if (setThumb) {
            await this.fetchJSON('/api/thumbnails/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: pid, filename: setThumb })
            });
        } else if (setVideo) {
            await this.fetchJSON('/api/thumbnails/assign-video-from-library', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: pid, video_filename: setVideo })
            });
        } else if (this._editThumbnailCleared) {
            await this.fetchJSON('/api/thumbnails/assign/' + pid, { method: 'DELETE' });
            await this.fetchJSON('/api/thumbnails/video-assign/' + pid, { method: 'DELETE' });
        }
    },

    async deleteEditPrompt() {
        var pid = this._editingPromptId;
        if (!pid || pid <= 151) { this.showToast('内置词条不可删除', 'error'); return; }
        if (!confirm('确定删除此提示词?')) return;
        var result = await this.fetchJSON('/api/prompts/' + pid, { method: 'DELETE' });
        if (result) {
            this.closeEditModal();
            this.showToast('已删除', 'info');
            await this.loadPrompts();
        }
    },

    closeEditModal() {
        document.getElementById('modalEditPrompt').style.display = 'none';
        this._editingPromptId = null;
    },
    // ============ 渲染:侧边栏 ============
    renderSidebar() {
        var sidebar = document.getElementById('sidebar');
        if (!sidebar || !this.state.modules) return;
        const icons = { emotion: '😊', color: '🎨', tone: '💡', storyboard: '📋', camera_move: '🎥', seedance: '🎬' };
        const names = { emotion: '人物表情', color: '场景色彩', tone: '画面色调', storyboard: '分镜构图', camera_move: '运镜模版', seedance: '视频模版' };
        var editClass = this.state.editMode ? '' : 'style="display:none;"';
        let html = '<div style="padding:8px 20px 10px;color:#64748b;font-size:11px;letter-spacing:1px;display:flex;align-items:center;justify-content:space-between;">' +
            '<span>功能模块</span>' +
            '<div ' + editClass + ' style="display:flex;gap:4px;">' +
            '<button class="header-btn-sm" onclick="App.showCreateModuleModal()" title="新建分组" style="font-size:13px;padding:2px 6px;">➕</button>' +
            '</div></div>';
        // 全部选项
        var allActive = this.state.currentModule === null ? 'active' : '';
        html += '<div class="module-item ' + allActive + '" onclick="App.switchAllModules()">' +
            '<span class="icon">📚</span>' +
            '<span>全部词库</span>' +
            '<span class="count-badge">' + (this.state.stats.total_prompts || '') + '</span>' +
            '</div>';
        for (const m of this.state.modules) {
            const active = m.id === this.state.currentModule ? 'active' : '';
            const clickHandler = m.id === 'seedance'
                ? `App.switchView('seedance')`
                : `App.switchModule('${m.id}')`;
            var deleteBtn = '';
            if (!m.builtin && this.state.editMode) {
                deleteBtn = '<button class="header-btn-sm" onclick="event.stopPropagation();App.deleteCustomModule(\'' + m.id + '\')" title="删除分组" style="font-size:11px;color:#ef4444;padding:0 4px;opacity:0.6;">✕</button>';
            }
            html += `
                <div class="module-item ${active}" onclick="${clickHandler}">
                    <span class="icon">${icons[m.id] || '📋'}</span>
                    <span>${names[m.id] || m.id}</span>
                    <span class="count-badge">${m.count}</span>
                    ${deleteBtn}
                </div>
            `;
        }
        sidebar.innerHTML = html;

        sidebar.innerHTML += `
            <div ${editClass} style="margin-top:auto;padding:12px;border-top:1px solid #334155;display:flex;gap:6px;flex-wrap:wrap;">
                <button onclick="App.showImportModal()" style="flex:1;padding:6px 8px;background:transparent;border:1px solid #475569;border-radius:6px;color:#94a3b8;cursor:pointer;font-size:11px;transition:all 0.15s;" onmouseenter="this.style.borderColor='#6366f1';this.style.color='#a5b4fc'" onmouseleave="this.style.borderColor='#475569';this.style.color='#94a3b8'">
                    <i class="bi bi-upload"></i> 导入
                </button>
                <button onclick="App.showExportModal()" style="flex:1;padding:6px 8px;background:transparent;border:1px solid #475569;border-radius:6px;color:#94a3b8;cursor:pointer;font-size:11px;transition:all 0.15s;" onmouseenter="this.style.borderColor='#6366f1';this.style.color='#a5b4fc'" onmouseleave="this.style.borderColor='#475569';this.style.color='#94a3b8'">
                    <i class="bi bi-download"></i> 导出
                </button>
            </div>
        `;
    },

    // ============ 自定义模块管理 ============

    showCreateModuleModal() {
        document.getElementById('inputModuleName').value = '';
        document.getElementById('modalCreateModule').style.display = 'flex';
    },

    async createCustomModule() {
        var name = document.getElementById('inputModuleName').value.trim();
        if (!name) { this.showToast('请输入分组名称', 'error'); return; }
        var data = await this.fetchJSON('/api/modules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        if (data) {
            document.getElementById('modalCreateModule').style.display = 'none';
            this.showToast('分组「' + name + '」已创建', 'success');
            await this.loadModules();
        }
    },

    async deleteCustomModule(modName) {
        if (!confirm('确认删除分组「' + modName + '」？关联词条将自动移至「自定义」分类')) return;
        var data = await this.fetchJSON('/api/modules/' + encodeURIComponent(modName), { method: 'DELETE' });
        if (data) {
            this.showToast('分组已删除', 'info');
            if (this.state.currentModule === modName) {
                this.state.currentModule = null;
            }
            await this.loadModules();
            await this.loadPrompts();
        }
    },

    // ============ 渲染:分类标签 ============
    renderCategories() {
        const container = document.getElementById('categoryTabs');
        if (!container) return;
        if (!this.state.categories || this.state.categories.length === 0) {
            container.innerHTML = '';
            return;
        }
        let html = '<div class="category-tabs">';
        for (const cat of this.state.categories) {
            html += `<span class="cat-tab ${cat.id === this.state.currentCategory ? 'active' : ''}" onclick="App.switchCategory('${cat.id}')">${this._escape(cat.name)} (${cat.count})</span>`;
        }
        html += '</div>';
        container.innerHTML = html;
    },

    // ============ 渲染:提示词卡片 ============
    renderPrompts() {
        const container = document.getElementById('promptList');
        if (!container) return;

        if (this.state.isLoading) {
            container.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">加载中...</span></div><p style="margin-top:12px;color:#94a3b8;">加载中...</p></div>';
            return;
        }
        if (this.state.prompts.length === 0) {
            container.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>${this.state.searchQuery ? '未找到匹配的提示词' : '该分类暂无提示词'}</p></div>`;
            return;
        }

        let html = '<div class="prompt-grid">';
        for (const p of this.state.prompts) {
            const tags = JSON.parse(p.tags || '[]');
            const tagHtml = tags.map(t => `<span class="card-badge">${this._escape(t)}</span>`).join('');
            const isSelected = this.state.batchSelected.has(p.id);
            const batchClass = this.state.editMode ? 'batch-mode' : '';
            const editClass = this.state.editMode ? 'edit-mode' : '';
            const selectedClass = isSelected ? 'selected' : '';

            var colls = p.collections || [];
            var collHtml = '';
            for (var ci = 0; ci < colls.length; ci++) {
                var cc = colls[ci];
                collHtml += '<span class="coll-badge" ondblclick="App.switchView(\'collections\');App.openCollection(' + cc.id + ')" title="双击进入「' + this._escape(cc.name) + '」收藏分组">' + (cc.icon || '⭐') + '</span>';
            }
            // 添加收藏按钮(竖排末尾)
            collHtml += '<span class="coll-add-btn" onclick="event.stopPropagation();App.quickCollect(' + p.id + ', this)" title="添加到收藏分组">+</span>';

            html += `
                <div class="prompt-card ${batchClass} ${selectedClass} ${editClass}" data-id="${p.id}">
                    <div class="card-body">
                        <div class="card-thumb">
                            <div class="card-thumb-inner" onclick="App.showThumbnailPicker(${p.id})">
                                ${p.thumbnail
                                    ? (p.video_filename
                                        ? `<div class="thumb-video-wrap-preview">`
                                          + `<img class="thumb-video-poster" src="/api/thumbnails/file/${p.thumbnail}" alt="" loading="lazy">`
                                          + `<video class="thumb-video" src="/api/thumbnails/video/${p.video_filename}" loop muted playsinline preload="none"></video>`
                                          + `</div>`
                                        : `<img src="/api/thumbnails/file/${p.thumbnail}" alt="缩略图">`
                                      )
                                    : `<div class="thumb-placeholder">
                                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                                      </div>`
                                }
                            </div>
                            ${p.thumbnail ? '<span class="thumb-zoom-btn" onclick="event.stopPropagation();' + (p.video_filename ? 'App.openVideoViewer(\'' + p.video_filename + '\', \'' + p.thumbnail + '\', \'' + p.id + '\', \'' + (p.video_fps || '') + '\')' : 'App.openImageViewer(\'' + p.thumbnail + '\', \'' + p.id + '\')') + '" title="' + (p.video_filename ? '查看原视频' : '查看原图') + '">' + (p.video_filename ? '▶' : '🔍') + '</span>' : ''}
                        </div>
                        <div class="card-text">
                            <div style="display:flex;align-items:center;margin-bottom:6px;gap:4px;">
                                <span class="card-badge">${this._escape(p.category)}</span>
                                ${p.subcategory ? `<span style="font-size:10px;color:#94a3b8;">${this._escape(p.subcategory)}</span>` : ''}
                            </div>
                            <div class="card-content" id="cc_${p.id}">${this._escape(p.content)}</div>
                            ${p.meaning ? `<div class="card-meaning">${this._escape(p.meaning)}</div>` : ''}
                            ${p.scene ? `<div class="card-scene">🎯 ${this._escape(p.scene)}</div>` : ''}
                            <div style="font-size:10px;color:#cbd5e1;margin-bottom:6px;">${tagHtml}</div>
                            <div class="card-actions">
                                <span style="font-size:11px;color:#94a3b8;margin-right:auto;">使用 ${p.usage_count} 次</span>
                                <button class="btn-copy" onclick="App.toggleTranslation(${p.id})" title="中英文切换" style="border-color:#6366f1;color:#6366f1;">🌐 ${App.state._cardTranslations[p.id] ? '中文' : '英文'}</button>
                                ${App.state.editMode ? '<button class="btn-copy" style="border-color:#eab308;color:#eab308;" onclick="App.openEditModal(' + p.id + ')">\u270f \u7f16\u8f91</button>' : ''}
                                <button class="btn-copy" onclick="App.handleCopy(${p.id}, '${this._escape(p.content).replace(/'/g, "\\'")}')">📋 复制</button>
                                ${App.state.editMode ? '<button class="btn-copy" style="border-color:#ef4444;color:#ef4444;" onclick="App.trashPrompt(' + p.id + ')">🗑 删除</button>' : ''}
                            </div>
                        </div>
                        <div class="card-collections">
                            <div class="card-checkbox">
                                <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="App.toggleSelect(${p.id})">
                            </div>
                            ${collHtml}
                        </div>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
        this.applyColumns();
        // 绑定视频悬停播放
        this.bindVideoHover();
        // 编辑模式下应用客户端筛选
        if (this.state.editMode) {
            this._updateFilteredDisplay();
        }
        this.bindCardDragDrop();
    },

    // ============ 视频悬停播放 ============
    bindVideoHover() {
        var wrappers = document.querySelectorAll('.thumb-video-wrap-preview');
        for (var i = 0; i < wrappers.length; i++) {
            var w = wrappers[i];
            var v = w.querySelector('.thumb-video');
            if (!v) continue;
            w.removeEventListener('mouseenter', App._playVideoWrap);
            w.removeEventListener('mouseleave', App._pauseVideoWrap);
            w.addEventListener('mouseenter', App._playVideoWrap);
            w.addEventListener('mouseleave', App._pauseVideoWrap);
        }
    },

    _playVideoWrap(e) {
        var w = e.currentTarget;
        var v = w.querySelector('.thumb-video');
        if (!v) return;
        v.preload = 'auto';
        v.play().catch(function() {});
    },

    _pauseVideoWrap(e) {
        var w = e.currentTarget;
        var v = w.querySelector('.thumb-video');
        if (!v) return;
        v.pause();
        v.currentTime = 0;
    },

    _playVideo(e) {
        var v = e.currentTarget;
        v.preload = 'auto';
        v.play().catch(function() {});
    },

    _pauseVideo(e) {
        var v = e.currentTarget;
        v.pause();
        v.currentTime = 0;
    },

    // 视频库缩略图悬停播放
    _bindVideoLibHover() {
        var videos = document.querySelectorAll('.thumb-video-preview');
        for (var i = 0; i < videos.length; i++) {
            var v = videos[i];
            v.removeEventListener('mouseenter', App._playVideo);
            v.removeEventListener('mouseleave', App._pauseVideo);
            v.addEventListener('mouseenter', App._playVideo);
            v.addEventListener('mouseleave', App._pauseVideo);
        }
    },

    renderPagination() {
        const bar = document.getElementById('paginationBar');
        if (!bar) return;
        // 语义搜索模式下隐藏翻页
        if (this.state._searchMode === 'semantic' && this.state.searchQuery) {
            bar.innerHTML = '';
            return;
        }
        const { page, totalPages } = this.state;
        if (!bar) return;
        if (totalPages <= 1) { bar.innerHTML = ''; return; }

        let html = `<button class="page-btn" onclick="App.goPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>← 上一页</button>`;
        const start = Math.max(1, page - 2), end = Math.min(totalPages, page + 2);
        if (start > 1) { html += `<button class="page-btn" onclick="App.goPage(1)">1</button>`; if (start > 2) html += '<span style="color:#94a3b8;">...</span>'; }
        for (let i = start; i <= end; i++) html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="App.goPage(${i})">${i}</button>`;
        if (end < totalPages) { if (end < totalPages - 1) html += '<span style="color:#94a3b8;">...</span>'; html += `<button class="page-btn" onclick="App.goPage(${totalPages})">${totalPages}</button>`; }
        html += `<button class="page-btn" onclick="App.goPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>下一页 →</button>`;
        html += `<span class="page-info">第 ${page}/${totalPages} 页</span>`;
        bar.innerHTML = html;
    },

    // ============ 一键收藏(下拉菜单) ============

    async quickCollect(promptId, btnEl) {
        // 移除所有旧弹窗和监听器
        document.querySelectorAll('.collect-popover').forEach(function(el) { el.remove(); });
        document.body.classList.remove('popover-open');
        document.body.style.overflow = '';

        var colls = this.state.collections;
        if (colls.length === 0) {
            // 没有分组时直接弹出新建分组弹窗
            document.getElementById('inputCollectionName').value = '';
            document.getElementById('inputCollectionIcon').selectedIndex = 0;
            this._pendingCollectId = promptId;
            document.body.classList.remove('popover-open');
            document.body.style.overflow = '';
            document.getElementById('modalCreateCollection').style.display = 'flex';
            return;
        }

        if (!btnEl || !btnEl.getBoundingClientRect) { return; }
        var popover = document.createElement('div');
        popover.className = 'collect-popover';
        var html = '<div class="collect-popover-title">添加到收藏</div>';
        for (var i = 0; i < colls.length; i++) {
            var c = colls[i];
            html += '<div class="collect-popover-item" data-cid="' + c.id + '" data-pid="' + promptId + '" onclick="App._doQuickCollect(' + c.id + ',' + promptId + ',\'' + this._escape(c.name).replace(/'/g, "\\'") + '\')">' + (c.icon || '⭐') + ' ' + this._escape(c.name) + '</div>';
        }
        html += '<div class="collect-popover-divider"></div>';
        html += '<div class="collect-popover-item collect-popover-new" onclick="App._showCreateForCollect(' + promptId + ')">➕ 新建分组</div>';
        popover.innerHTML = html;

        // 定位到按钮下方
        var rect = btnEl.getBoundingClientRect();
        popover.style.position = 'fixed';
        popover.style.left = Math.max(10, rect.left - 100) + 'px';
        popover.style.top = (rect.bottom + 4) + 'px';
        popover.style.zIndex = '999';
        document.body.appendChild(popover);

        // 禁用页面滚动
        document.body.classList.add('popover-open');
        document.body.style.overflow = 'hidden';

        // 弹窗内部点击不冒泡,避免触发关闭
        popover.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        // 点击弹窗外部关闭 -- 使用一次性监听,避免累积
        function _closePopHandler(e) {
            var p = document.querySelector('.collect-popover');
            if (!p) return;
            p.remove();
            document.body.classList.remove('popover-open');
            document.body.style.overflow = '';
            document.removeEventListener('click', _closePopHandler);
            // 从跟踪列表移除
            var list = document._collectPopoverListeners || [];
            var idx = list.indexOf(_closePopHandler);
            if (idx >= 0) list.splice(idx, 1);
        }
        // 跟踪此监听器以便清理
        if (!document._collectPopoverListeners) document._collectPopoverListeners = [];
        document._collectPopoverListeners.push(_closePopHandler);
        setTimeout(function() {
            document.addEventListener('click', _closePopHandler);
        }, 30);
    },

    async _doQuickCollect(cid, promptId, cname) {
        document.querySelectorAll('.collect-popover').forEach(function(el) { el.remove(); });
        document.body.classList.remove('popover-open');
        document.body.style.overflow = '';
        // 清理 document 上残留的关闭监听器
        var listeners = document._collectPopoverListeners || [];
        for (var li = 0; li < listeners.length; li++) {
            document.removeEventListener('click', listeners[li]);
        }
        document._collectPopoverListeners = [];
        var data = await this.fetchJSON('/api/v2/collections/' + cid + '/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_id: promptId })
        });
        if (data) {
            this.showToast('已收藏到「' + cname + '」', 'success');
            await this.loadCollections();
            await this.loadPrompts();  // 刷新卡片显示收藏图标
            // 刷新查看器右侧面板
            this._refreshViewerPanels();
        } else {
            this.showToast('该词条已在收藏中', 'info');
        }
    },

    _showCreateForCollect(promptId) {
        document.querySelectorAll('.collect-popover').forEach(function(el) { el.remove(); });
        document.body.classList.remove('popover-open');
        document.body.style.overflow = '';
        var listeners = document._collectPopoverListeners || [];
        for (var li = 0; li < listeners.length; li++) {
            document.removeEventListener('click', listeners[li]);
        }
        document._collectPopoverListeners = [];
        document.getElementById('inputCollectionName').value = '';
        document.getElementById('inputCollectionIcon').selectedIndex = 0;
        this._pendingCollectId = promptId;
        document.body.classList.remove('popover-open');
        document.body.style.overflow = '';
        document.getElementById('modalCreateCollection').style.display = 'flex';
    },

    // 覆盖 createCollection 使其在新建后自动收藏待处理的词条
    async createCollection() {
        const name = document.getElementById('inputCollectionName').value.trim();
        const icon = document.getElementById('inputCollectionIcon').value.trim() || '⭐';
        if (!name) { this.showToast('请输入分组名称', 'error'); return; }

        // 如果有待编辑的分组,执行改名
        if (this._pendingEditCollection) {
            const cid = this._pendingEditCollection;
            this._pendingEditCollection = null;
            const data = await this.fetchJSON('/api/v2/collections/' + cid, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, icon: icon })
            });
            if (data) {
                document.getElementById('modalCreateCollection').style.display = 'none';
                this.showToast('分组已更新', 'success');
                await this.loadCollections();
                if (this.state.currentView === 'collections') this.renderCollections();
            }
            return;
        }
        const data = await this.fetchJSON('/api/v2/collections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, icon })
        });
        if (data) {
            document.getElementById('modalCreateCollection').style.display = 'none';
            await this.loadCollections();
            // 刷新收藏夹视图
            if (this.state.currentView === 'collections') this.renderCollections();
            // 如果查看器开着,刷新右侧勾选列表
            if (document.getElementById('modalImageViewer').style.display !== 'none') {
                var pid = document.getElementById('imgViewerContent').getAttribute('data-prompt-id');
                if (pid) {
                    var self = this;
                    this.fetchJSON('/api/prompts/' + pid).then(function(d) {
                        if (d) self._fillViewerPanel('imgViewer', d);
                    });
                }
            }
            if (document.getElementById('modalVideoViewer').style.display !== 'none') {
                var pid = document.getElementById('vidViewerContent').getAttribute('data-prompt-id');
                if (pid) {
                    var self = this;
                    this.fetchJSON('/api/prompts/' + pid).then(function(d) {
                        if (d) self._fillViewerPanel('vidViewer', d);
                    });
                }
            }
            // 如果有待收藏的词条
            if (this._pendingCollectId) {
                const pid = this._pendingCollectId;
                this._pendingCollectId = null;
                await this.fetchJSON(`/api/v2/collections/${data.id}/items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt_id: pid })
                });
                this.showToast(`已收藏到「${name}」`, 'success');
                if (this.state.currentView === 'home') this.loadPrompts();
            } else {
                this.showToast('收藏分组已创建', 'success');
                if (this.state.currentView === 'home') this.loadPrompts();
            }
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

    // ============ Seedance 视频提示词 ============

    async loadSeedanceCategories() {
        const data = await this.fetchJSON('/api/seedance/categories');
        if (!data) return;
        this.state.seedanceCategories = data.categories;
        this.renderSeedanceCategoryTabs();
    },

    renderSeedanceCategoryTabs() {
        const container = document.getElementById('seedanceCategoryTabs');
        if (!container) return;
        const cats = this.state.seedanceCategories;
        let html = '<button class="cat-tab '+(!this.state.seedanceCategory?'active':'')+'" onclick="App.switchSeedanceCategory(null)">全部</button>';
        for (const c of cats) {
            html += `<button class="cat-tab ${this.state.seedanceCategory === c.id ? 'active' : ''}" onclick="App.switchSeedanceCategory('${c.id}')">${this._escape(c.name)} (${c.count})</button>`;
        }
        container.innerHTML = html;
    },

    switchSeedanceCategory(cat) {
        this.state.seedanceCategory = cat;
        this.state.seedancePage = 1;
        this.renderSeedanceCategoryTabs();
        this.loadSeedanceTemplates();
    },

    async loadSeedanceTemplates() {
        const s = this.state;
        const params = new URLSearchParams();
        if (s.seedanceCategory) params.set('category', s.seedanceCategory);
        params.set('page', s.seedancePage);
        params.set('page_size', 20);
        const data = await this.fetchJSON('/api/seedance/templates?' + params.toString());
        if (!data) return;
        s.seedanceTemplates = data.items;
        s.seedanceTotal = data.total;
        s.seedanceTotalPages = data.total_pages;
        this.renderSeedanceTemplates();
        this.renderSeedancePagination();
    },

    renderSeedanceTemplates() {
        const container = document.getElementById('seedanceTemplateList');
        if (!container) return;
        const items = this.state.seedanceTemplates;
        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="icon">🎬</div><p>暂无模板</p></div>';
            return;
        }
        let html = '<div class="prompt-grid">';
        for (const tpl of items) {
            const preview = tpl.content.length > 150 ? tpl.content.substring(0, 150) + '...' : tpl.content;
            const previewHtml = preview.replace(/\n/g, '<br>');
            let tags = [];
            try { tags = JSON.parse(tpl.tags); } catch(e) {}
            html += `
                <div class="prompt-card">
                    <span class="card-badge">${this._escape(tpl.category)}</span>
                    <div style="font-size:11px;color:#64748b;margin-bottom:6px;">${this._escape(tpl.meaning)}</div>
                    <div class="card-content" style="font-size:12px;line-height:1.4;">${previewHtml}</div>
                    <div style="font-size:10px;color:#94a3b8;margin-bottom:6px;">${tags.map(t=>'#'+this._escape(t)).join(' ')}</div>
                    <div class="card-actions">
                        <button class="btn-copy" onclick="App.handleCopy(${tpl.id}, '${this._escape(tpl.content).replace(/'/g, "\\'")}')">📋 复制模板</button>
                        <button class="btn-copy" onclick="App.openInComposer(${tpl.id})">✏️ 编辑</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
    },

    renderSeedancePagination() {
        const bar = document.getElementById('seedancePagination');
        if (!bar) return;
        const { seedancePage, seedanceTotalPages } = this.state;
        if (seedanceTotalPages <= 1) { bar.innerHTML = ''; return; }
        let html = '<button class="page-btn" onclick="App.state.seedancePage=' + (seedancePage-1) + ';App.loadSeedanceTemplates()" ' + (seedancePage<=1?'disabled':'') + '>← 上一页</button>';
        for (let i = 1; i <= seedanceTotalPages; i++) {
            html += '<button class="page-btn ' + (i===seedancePage?'active':'') + '" onclick="App.state.seedancePage=' + i + ';App.loadSeedanceTemplates()">' + i + '</button>';
        }
        html += '<button class="page-btn" onclick="App.state.seedancePage=' + (seedancePage+1) + ';App.loadSeedanceTemplates()" ' + (seedancePage>=seedanceTotalPages?'disabled':'') + '>下一页 →</button>';
        bar.innerHTML = html;
    },

    switchSeedanceTab(tab) {
        this.state.seedanceView = tab;
        // 保存 Seedance 子标签状态
        try { localStorage.setItem('promptkit_seedance_tab', tab); } catch(e) {}
        document.querySelectorAll('.seedance-tab').forEach(function(el) { el.classList.remove('active'); });
        document.querySelectorAll('.seedance-panel').forEach(function(el) { el.style.display = 'none'; });
        var tabMap = { templates: 'Templates', composer: 'Composer', gallery: 'Gallery', glossary: 'Glossary' };
        var idSuffix = tabMap[tab] || tab;
        var tabEl = document.getElementById('seedanceTab' + idSuffix);
        if (tabEl) tabEl.classList.add('active');
        var panelEl = document.getElementById('seedance' + idSuffix);
        if (panelEl) panelEl.style.display = 'block';
        if (tab === 'gallery') this.loadGallery();
        if (tab === 'glossary') this.loadGlossary();
        if (tab === 'templates') this.loadSeedanceTemplates();
    },

    async openInComposer(tplId) {
        const data = await this.fetchJSON('/api/seedance/templates/' + tplId);
        if (!data || !data.template) return;
        this.switchSeedanceTab('composer');
        const tpl = data.template;
        document.getElementById('composerScenes').value = tpl.content;
        this.showToast('模板已加载到组装器', 'info');
    },

    async composePrompt() {
        const style = document.getElementById('composerStyle').value.trim();
        const duration = parseInt(document.getElementById('composerDuration').value);
        const aspect_ratio = document.getElementById('composerRatio').value;
        const mood = document.getElementById('composerMood').value.trim();
        const sound = document.getElementById('composerSound').value.trim();
        const refText = document.getElementById('composerRefs').value.trim();
        const sceneText = document.getElementById('composerScenes').value.trim();

        var scenes = [];
        var lines = sceneText.split('\n');
        for (var idx = 0; idx < lines.length; idx++) {
            var trimmed = lines[idx].trim();
            if (!trimmed) continue;
            var match = trimmed.match(/^(\d+[\-~]\d+)秒?[::]\s*(.+)/);
            if (match) {
                scenes.push({ time: match[1], description: match[2] });
            } else {
                scenes.push({ time: '', description: trimmed });
            }
        }

        var references = refText ? refText.split('\n').filter(function(l) { return l.trim(); }).map(function(l) { return l.trim(); }) : [];

        const data = await this.fetchJSON('/api/seedance/compose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ style: style, duration: duration, aspect_ratio: aspect_ratio, mood: mood, sound: sound, scenes: scenes, references: references })
        });

        if (!data) return;
        document.getElementById('composerOutput').value = data.text;
        document.getElementById('composerResult').style.display = 'block';
        this.showToast('提示词已生成', 'success');
    },

    async copyComposerResult() {
        const text = document.getElementById('composerOutput').value;
        await this.copyText(text, '提示词已复制到剪贴板');
    },

    async loadGallery() {
        const container = document.getElementById('galleryList');
        container.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">加载中...</span></div></div>';
        const data = await this.fetchJSON('/api/seedance/gallery');
        if (!data || !data.gallery) { container.innerHTML = '<div class="empty-state"><p>暂无数据</p></div>'; return; }
        var html = '';
        for (var gIdx = 0; gIdx < data.gallery.length; gIdx++) {
            var g = data.gallery[gIdx];
            html += '<div class="page-header mt-3 mb-2"><h4 style="font-size:15px;">' + this._escape(g.category) + '</h4></div><div class="prompt-grid">';
            for (var iIdx = 0; iIdx < g.items.length; iIdx++) {
                var item = g.items[iIdx];
                html += '<div class="prompt-card"><span class="card-badge">' + this._escape(g.category) + '</span><div class="card-content" style="font-size:12px;">' + this._escape(item.content_preview) + '</div><div class="card-actions"><button class="btn-copy" onclick="App.openTemplateById(' + item.id + ')">查看</button></div></div>';
            }
            html += '</div>';
        }
        container.innerHTML = html;
    },

    async openTemplateById(id) {
        const data = await this.fetchJSON('/api/seedance/templates/' + id);
        if (!data || !data.template) return;
        this.switchSeedanceTab('templates');
        this.copyText(data.template.content, '模板内容已复制');
    },

    async loadGlossary() {
        const glossaryData = await this.fetchJSON('/api/seedance/camera-glossary');
        const refData = await this.fetchJSON('/api/seedance/reference-syntax');

        const gContainer = document.getElementById('glossaryTable');
        if (glossaryData && glossaryData.items) {
            var ghtml = '<table class="table table-sm" style="font-size:13px;"><thead><tr><th>镜头名称</th><th>写法/关键词</th><th>效果</th><th>适用场景</th></tr></thead><tbody>';
            for (var gi = 0; gi < glossaryData.items.length; gi++) {
                var item = glossaryData.items[gi];
                ghtml += '<tr><td><strong>' + this._escape(item.name) + '</strong></td><td><code>' + this._escape(item.keywords) + '</code></td><td>' + this._escape(item.effect) + '</td><td>' + this._escape(item.use) + '</td></tr>';
            }
            ghtml += '</tbody></table>';
            gContainer.innerHTML = ghtml;
        }

        const rContainer = document.getElementById('refSyntaxTable');
        if (refData && refData.items) {
            var rhtml = '<table class="table table-sm" style="font-size:13px;"><thead><tr><th>语法</th><th>说明</th></tr></thead><tbody>';
            for (var ri = 0; ri < refData.items.length; ri++) {
                var ritem = refData.items[ri];
                rhtml += '<tr><td><code>' + this._escape(ritem.pattern) + '</code></td><td>' + this._escape(ritem.description) + '</td></tr>';
            }
            rhtml += '</tbody></table>';
            rContainer.innerHTML = rhtml;
        }
    },

    // ============ 更新卡片上的收藏徽标 ============
    // 不再需要下拉刷新,因为收藏通过 +popover 操作后调用 loadPrompts 全量刷新

    // ============ 缩略图管理 ============

    _thumbnailPromptId: null,  // 当前正在设置缩略图的提示词ID
    _editThumbFilename: null, // 编辑弹窗中暂存的缩略图文件名
    _editVideoFilename: null, // 编辑弹窗中暂存的视频文件名
    _editHadThumbOriginal: false, // 打开编辑弹窗时是否有原缩略图
    _thumbnailPage: 1,
    _thumbEditMode: false,   // 图库/视频库编辑模式
    _thumbBatchSelected: {}, // 已选中的文件名（编辑模式下）
    _thumbnailCollectionId: null, // 设置收藏夹缩略图时的分组ID

    // ============ 编辑弹窗缩略图管理 ============

    _editThumbnailMode: false,  // 是否在编辑弹窗中选择缩略图

    openEditThumbnailPicker() {
        this._editThumbnailMode = true;
        this._thumbnailPromptId = null;
        this._thumbnailCollectionId = null;
        this._thumbnailPage = 1;
        if (this._thumbEditMode) this.toggleThumbEditMode();
        document.getElementById('modalThumbnail').style.display = 'flex';
        this.switchThumbTab('images');
    },

    openEditVideoPicker() {
        this._editThumbnailMode = true;
        this._thumbnailPromptId = null;
        this._thumbnailCollectionId = null;
        this._thumbnailPage = 1;
        if (this._thumbEditMode) this.toggleThumbEditMode();
        document.getElementById('modalThumbnail').style.display = 'flex';
        this.switchThumbTab('videos');
    },

    updateEditThumbDisplay() {
        var preview = document.getElementById('editThumbPreview');
        var name = document.getElementById('editThumbName');
        if (this._editVideoFilename) {
            preview.innerHTML = '<video src="/api/thumbnails/video/' + this._editVideoFilename + '" style="width:120px;height:80px;object-fit:cover;" muted loop playsinline></video>';
            preview.querySelector('video').play().catch(function(){});
            name.textContent = '视频: ' + this._editVideoFilename;
            document.getElementById('editClearThumbBtn').style.display = 'inline-block';
        } else if (this._editThumbFilename) {
            preview.innerHTML = '<img src="/api/thumbnails/file/' + this._editThumbFilename + '" style="width:120px;height:80px;object-fit:cover;">';
            name.textContent = this._editThumbFilename;
            document.getElementById('editClearThumbBtn').style.display = 'inline-block';
        } else {
            preview.innerHTML = '<span style="font-size:24px;color:#cbd5e1;">🖼</span>';
            name.textContent = '未设置';
            document.getElementById('editClearThumbBtn').style.display = 'none';
        }
    },

    clearEditThumbnail() {
        this._editThumbFilename = null;
        this._editVideoFilename = null;
        this._editThumbnailCleared = this._editHadThumbOriginal;
        this.updateEditThumbDisplay();
    },

    setEditThumbnail() {
        this.openEditThumbnailPicker();
    },

    async showThumbnailPicker(promptId) {
        this._thumbnailPromptId = promptId;
        this._thumbnailCollectionId = null;
        this._thumbnailPage = 1;
        if (this._thumbEditMode) this.toggleThumbEditMode();
        document.getElementById('modalThumbnail').style.display = 'flex';
        this.switchThumbTab('images');
    },

    // ============ 图库/视频库批量操作 ============

    toggleThumbEditMode() {
        this._thumbEditMode = !this._thumbEditMode;
        this._thumbBatchSelected = {};
        var btn = document.getElementById('btnEditMode');
        var delBtn = document.getElementById('btnBatchDelete');
        var sBtn = document.getElementById('btnSelectAll');
        if (this._thumbEditMode) {
            btn.style.borderColor = '#ef4444';
            btn.style.color = '#ef4444';
            btn.style.background = 'rgba(239,68,68,0.08)';
            delBtn.style.display = 'inline-flex';
            if (sBtn) sBtn.style.display = 'inline-flex';
        } else {
            btn.style.borderColor = '#64748b';
            btn.style.color = '#94a3b8';
            btn.style.background = 'transparent';
            delBtn.style.display = 'none';
            if (sBtn) sBtn.style.display = 'none';
        }
        // 刷新当前 tab
        this.switchThumbTab(this._thumbnailTab);
    },

    // ============ 拖拽框选 ============

    _initThumbDragSelect() {
        var grids = ['thumbLibraryGrid', 'videoLibraryGrid'];
        for (var gi = 0; gi < grids.length; gi++) {
            var grid = document.getElementById(grids[gi]);
            if (!grid) continue;
            if (grid.dataset.dragInit) continue;
            grid.dataset.dragInit = '1';
            grid.addEventListener('mousedown', function(e) {
                App._onThumbGridMouseDown(e);
            });
        }
    },

    _onThumbGridMouseDown(e) {
        if (!App._thumbEditMode) return;
        // 忽略 checkbox / delete button 等交互元素
        if (e.target.closest('.thumb-batch-cb') || e.target.closest('.thumb-item-del')) return;
        // 忽略滚动条
        if (e.offsetX > e.currentTarget.clientWidth - 16) return;

        e.preventDefault();
        var grid = e.currentTarget;
        var rect = grid.getBoundingClientRect();
        var startX = e.clientX - rect.left;
        var startY = e.clientY - rect.top;

        // 创建选框
        var box = document.createElement('div');
        box.className = 'drag-select-box';
        box.style.left = startX + 'px';
        box.style.top = startY + 'px';
        box.style.width = '0px';
        box.style.height = '0px';
        grid.appendChild(box);

        var items = grid.querySelectorAll('.thumb-item');

        function onMove(ev) {
            var cr = grid.getBoundingClientRect();
            var cx = ev.clientX - cr.left;
            var cy = ev.clientY - cr.top;
            var l = Math.min(startX, cx);
            var t = Math.min(startY, cy);
            var w = Math.abs(cx - startX);
            var h = Math.abs(cy - startY);
            box.style.left = l + 'px';
            box.style.top = t + 'px';
            box.style.width = w + 'px';
            box.style.height = h + 'px';
            // 实时高亮被框中的项目
            var br = box.getBoundingClientRect();
            for (var i = 0; i < items.length; i++) {
                var ir = items[i].getBoundingClientRect();
                var overlap = !(ir.right < br.left || ir.left > br.right || ir.bottom < br.top || ir.top > br.bottom);
                items[i].classList.toggle('drag-hover', overlap);
            }
        }

        function onUp(ev) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            // 收集被框中的项
            var br = box.getBoundingClientRect();
            // 如果选框太小(<5px),视为点击,不框选
            if (br.width < 5 && br.height < 5) {
                box.remove();
                return;
            }
            for (var i = 0; i < items.length; i++) {
                var ir = items[i].getBoundingClientRect();
                var overlap = !(ir.right < br.left || ir.left > br.right || ir.bottom < br.top || ir.top > br.bottom);
                if (overlap) {
                    var cb = items[i].querySelector('.thumb-batch-cb');
                    if (cb) {
                        cb.checked = true;
                        App._thumbBatchSelected[cb.dataset.filename] = true;
                    }
                }
                items[i].classList.remove('drag-hover');
            }
            box.remove();
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    },

    toggleThumbBatchItem(cb) {
        if (cb.checked) {
            this._thumbBatchSelected[cb.dataset.filename] = true;
        } else {
            delete this._thumbBatchSelected[cb.dataset.filename];
        }
    },

    async deleteSingleThumb(filename) {
        if (!confirm('确认删除缩略图文件「' + filename + '」?')) return;
        var data = await this.fetchJSON('/api/thumbnails/file/' + filename, { method: 'DELETE' });
        if (data) {
            this.showToast('已删除', 'success');
            this.loadThumbLibrary();
        }
    },

    async deleteSingleVideo(filename) {
        if (!confirm('确认删除视频文件「' + filename + '」?')) return;
        var data = await this.fetchJSON('/api/thumbnails/video-file/' + filename, { method: 'DELETE' });
        if (data) {
            this.showToast('已删除', 'success');
            this.loadVideoLibrary();
        }
    },

    async batchDeleteThumbItems() {
        var filenames = Object.keys(this._thumbBatchSelected);
        if (filenames.length === 0) {
            this.showToast('请先选择文件', 'info');
            return;
        }
        if (!confirm('确认删除选中的 ' + filenames.length + ' 个文件?此操作不可恢复!')) return;
        var tab = this._thumbnailTab;
        var ep = tab === 'videos' ? '/api/thumbnails/batch-delete-videos' : '/api/thumbnails/batch-delete-thumbnails';
        var data = await this.fetchJSON(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filenames: filenames })
        });
        if (data) {
            this.showToast('已删除 ' + data.deleted_count + ' 个文件', 'success');
            this._thumbBatchSelected = {};
            this._thumbnailPage = 1;
            if (tab === 'videos') this.loadVideoLibrary(); else this.loadThumbLibrary();
        }
    },

    toggleSelectAllThumb() {
        var gridId = this._thumbnailTab === 'videos' ? 'videoLibraryGrid' : 'thumbLibraryGrid';
        var grid = document.getElementById(gridId);
        if (!grid) return;
        var cbs = grid.querySelectorAll('.thumb-batch-cb');
        var allChecked = true;
        for (var i = 0; i < cbs.length; i++) {
            if (!cbs[i].checked) { allChecked = false; break; }
        }
        var check = !allChecked;
        for (var i = 0; i < cbs.length; i++) {
            cbs[i].checked = check;
            if (check) {
                this._thumbBatchSelected[cbs[i].dataset.filename] = true;
            } else {
                delete this._thumbBatchSelected[cbs[i].dataset.filename];
            }
        }
        var sBtn = document.getElementById('btnSelectAll');
        if (sBtn) {
            sBtn.innerHTML = check ? '<i class="bi bi-x-square"></i> 取消全选' : '<i class="bi bi-check-all"></i> 全选';
        }
    },

    // 切换缩略图 Tab
    switchThumbTab(tab) {
        this._thumbnailTab = tab;
        this._thumbnailPage = 1;
        this._thumbBatchSelected = {};
        var sBtn = document.getElementById('btnSelectAll');
        if (sBtn) sBtn.innerHTML = '<i class="bi bi-check-all"></i> 全选';
        document.getElementById('thumbTabImages').className = tab === 'images' ? 'seedance-tab active' : 'seedance-tab';
        document.getElementById('thumbTabVideos').className = tab === 'videos' ? 'seedance-tab active' : 'seedance-tab';
        document.getElementById('thumbLibraryGrid').style.display = tab === 'images' ? 'grid' : 'none';
        document.getElementById('videoLibraryGrid').style.display = tab === 'videos' ? 'grid' : 'none';
        if (tab === 'images') this.loadThumbLibrary();
        else this.loadVideoLibrary();
    },

    async loadVideoLibrary() {
        var grid = document.getElementById('videoLibraryGrid');
        grid.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:20px;">加载视频库中...</div>';
        var data = await this.fetchJSON('/api/thumbnails/video-library?page=' + this._thumbnailPage + '&page_size=50');
        if (!data) { grid.innerHTML = '<div class="empty-state"><p>视频库为空</p></div>'; return; }
        var bm = this._thumbEditMode;
        var html = '';
        for (var i = 0; i < data.items.length; i++) {
            var item = data.items[i];
            var selectedClass = '';
            if (item.used_by === this._thumbnailPromptId) selectedClass = 'thumb-selected';
            var usedBadge = (item.used_by && item.used_by !== this._thumbnailPromptId) ? '<span class="thumb-used-badge">已使用</span>' : '';
            var cover = item.cover_url || '';
            var info = '<span style="font-size:10px;color:#94a3b8;position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,0.6);padding:1px 4px;border-radius:3px;">' + item.duration + 's</span>';
            var isChecked = this._thumbBatchSelected[item.filename] ? ' checked' : '';
            var clickAttr = bm ? '' : ' onclick="App.selectVideoThumbnail(\'' + item.filename + '\')"';
            html += '<div class="thumb-item ' + selectedClass + '"' + clickAttr + '>' +
                (bm ? '<input type="checkbox" class="thumb-batch-cb" data-filename="' + item.filename + '" onchange="App.toggleThumbBatchItem(this)"' + isChecked + '>' : '') +
                (cover ? '<div class="thumb-video-wrap"><video class="thumb-video-preview" src="/api/thumbnails/video/' + item.filename + '" poster="' + cover + '" loop muted playsinline preload="none"></video></div>' : '<div style="background:#334155;width:100%;aspect-ratio:3/2;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:28px;">&#9654;</div>') +
                usedBadge + info +
                '<div class="thumb-item-footer">' +
                  '<span class="thumb-item-name" title="' + (item.original_name || item.filename) + '">' + (item.original_name || item.filename) + '</span>' +
                  (!bm ? '<span class="thumb-item-del" onclick="event.stopPropagation();App.deleteSingleVideo(\'' + item.filename + '\')" title="删除">&times;</span>' : '') +
                '</div>' +
                '</div>';
        }
        if (data.items.length === 0) html = '<div class="empty-state"><p>视频库为空,请先上传视频</p></div>';
        grid.innerHTML = html;
        this._initThumbDragSelect();
        // 绑定视频悬停播放
        this._bindVideoLibHover();
        // 分页
        var pbar = document.getElementById('thumbPagination');
        if (data.total_pages <= 1) { pbar.innerHTML = ''; return; }
        var ph = '';
        for (var pi = 1; pi <= data.total_pages; pi++) {
            ph += '<button class="page-btn ' + (pi === this._thumbnailPage ? 'active' : '') + '" onclick="App._thumbnailPage=' + pi + ';App.loadVideoLibrary()">' + pi + '</button>';
        }
        pbar.innerHTML = ph;
    },

    async selectVideoThumbnail(videoFilename) {
        // 编辑弹窗缩略图模式：暂存不提交
        if (this._editThumbnailMode) {
            this._editVideoFilename = videoFilename;
            this._editThumbFilename = null;
            this._editThumbnailMode = false;
            document.getElementById('modalThumbnail').style.display = 'none';
            this.updateEditThumbDisplay();
            return;
        }
        // 收藏夹缩略图模式：提取视频封面设为分组缩略图
        if (this._thumbnailCollectionId) {
            this.showToast('正在获取封面...', 'info');
            var info = await this.fetchJSON('/api/thumbnails/video-info/' + videoFilename, { method: 'GET' });
            if (info && info.poster) {
                var data = await this.fetchJSON('/api/v2/collections/' + this._thumbnailCollectionId, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ thumbnail: info.poster, video_filename: videoFilename })
                });
                if (data) {
                    document.getElementById('modalThumbnail').style.display = 'none';
                    this.showToast('收藏夹缩略图已设置', 'success');
                    this._thumbnailCollectionId = null;
                    await this.loadCollections();
                    this.renderCollections();
                }
            } else {
                this.showToast('无法获取视频封面', 'error');
            }
            return;
        }
        var data = await this.fetchJSON('/api/thumbnails/assign-video-from-library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_id: this._thumbnailPromptId, video_filename: videoFilename })
        });
        if (data) {
            document.getElementById('modalThumbnail').style.display = 'none';
            this.showToast('视频已关联', 'success');
            await this.loadPrompts();
        } else {
            this.showToast('关联失败', 'error');
        }
    },

    async loadThumbLibrary() {
        var grid = document.getElementById('thumbLibraryGrid');
        grid.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:20px;">加载图库中...</div>';
        var data = await this.fetchJSON('/api/thumbnails/library?page=' + this._thumbnailPage + '&page_size=50');
        if (!data) { grid.innerHTML = '<div class="empty-state"><p>图库为空,请上传图片</p></div>'; return; }

        var bm = this._thumbEditMode;
        var html = '';
        for (var i = 0; i < data.items.length; i++) {
            var item = data.items[i];
            var selectedClass = '';
            var usedBadge = '';
            if (item.used_by === this._thumbnailPromptId) selectedClass = 'thumb-selected';
            if (item.used_by && item.used_by !== this._thumbnailPromptId) usedBadge = '<span class="thumb-used-badge">已使用</span>';
            var isChecked = this._thumbBatchSelected[item.filename] ? ' checked' : '';
            var clickAttr = bm ? '' : ' onclick="App.selectThumbnail(\'' + item.filename + '\')"';
            html += '<div class="thumb-item ' + selectedClass + '"' + clickAttr + '>' +
                (bm ? '<input type="checkbox" class="thumb-batch-cb" data-filename="' + item.filename + '" onchange="App.toggleThumbBatchItem(this)"' + isChecked + '>' : '') +
                '<img src="/api/thumbnails/file/' + item.filename + '" loading="lazy">' +
                usedBadge +
                '<div class="thumb-item-footer">' +
                  '<span class="thumb-item-name" title="' + (item.original_name || item.filename) + '">' + (item.original_name || item.filename) + '</span>' +
                  (!bm ? '<span class="thumb-item-del" onclick="event.stopPropagation();App.deleteSingleThumb(\'' + item.filename + '\')" title="删除">&times;</span>' : '') +
                '</div>' +
                '</div>';
        }
        if (data.items.length === 0) html = '<div class="empty-state"><p>图库为空</p></div>';
        grid.innerHTML = html;
        this._initThumbDragSelect();
        var pbar = document.getElementById('thumbPagination');
        if (data.total_pages <= 1) { pbar.innerHTML = ''; return; }
        var ph = '';
        for (var pi = 1; pi <= data.total_pages; pi++) {
            ph += '<button class="page-btn ' + (pi === this._thumbnailPage ? 'active' : '') + '" onclick="App._thumbnailPage=' + pi + ';App.loadThumbLibrary()">' + pi + '</button>';
        }
        pbar.innerHTML = ph;
    },

    async uploadThumbnail(event) {
        var files = event.target.files;
        if (!files || files.length === 0) return;
        var first = true;
        for (var fi = 0; fi < files.length; fi++) {
            var file = files[fi];
            var formData = new FormData();
            formData.append('file', file);
            try {
                var resp = await fetch('/api/thumbnails/upload', { method: 'POST', body: formData });
                var data = await resp.json();
                if (data.ok) {
                    if (data.duplicate) {
                        this.showToast('已跳过重复图片', 'info');
                        if (first) {
                            // 重复文件也尝试关联
                            await this.fetchJSON('/api/thumbnails/assign', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ prompt_id: this._thumbnailPromptId, filename: data.filename })
                            });
                            await this.loadPrompts();
                            first = false;
                        }
                    } else {
                        if (first) {
                            this.showToast('上传成功', 'success');
                            await this.fetchJSON('/api/thumbnails/assign', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ prompt_id: this._thumbnailPromptId, filename: data.filename })
                            });
                            await this.loadPrompts();
                            first = false;
                        } else {
                            this.showToast('已上传 ' + (fi + 1) + '/' + files.length, 'info');
                        }
                    }
                }
            } catch(e) {
                this.showToast('上传失败: ' + file.name, 'error');
            }
        }
        if (files.length > 0) {
            await this.loadThumbLibrary();
        }
        event.target.value = '';
    },

    async uploadVideo(event) {
        var files = event.target.files;
        if (!files || files.length === 0) return;
        var first = true;
        for (var fi = 0; fi < files.length; fi++) {
            var file = files[fi];
            var formData = new FormData();
            formData.append('file', file);
            try {
                this.showToast('正在准备 ' + file.name + '...', 'info');
                // 先通过 prepare 判断是否需裁剪
                var resp = await fetch('/api/thumbnails/prepare-upload', { method: 'POST', body: formData });
                var data = await resp.json();
                if (data.ok) {
                    if (data.needs_trim) {
                        // 大视频：prepare 已保存文件，弹出裁剪界面
                        this.showToast(file.name + ' 需要裁剪,暂不支持批量', 'info');
                        this._trimTempFile = data.temp_file;
                        this._trimDuration = data.duration;
                        this._trimOrigSizeMb = data.size_mb;
                        this._trimOrigInfo = file.name + ' (' + data.size_mb + 'MB, ' + data.duration + '秒)';
                        this.showTrimModal(data.temp_file, data.duration);
                    } else {
                        // 小视频：prepare 已保存文件，直接用返回的 filename 提交（不需再传文件）
                        var resp2 = await fetch('/api/thumbnails/finalize-upload', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                temp_filename: data.temp_file,
                                original_name: file.name
                            })
                        });
                        var data2 = await resp2.json();
                        if (data2.ok) {
                            this.showToast('已上传 ' + file.name, 'success');
                            if (first) {
                                await this.fetchJSON('/api/thumbnails/assign-video', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        prompt_id: this._thumbnailPromptId,
                                        video_filename: data2.video_filename,
                                        poster_filename: data2.poster_filename || '',
                                        duration: data2.duration || 0
                                    })
                                });
                                await this.loadPrompts();
                                first = false;
                            }
                        }
                    }
                }
            } catch(e) {
                this.showToast(file.name + ' 上传失败', 'error');
            }
        }
        if (files.length > 0) {
            await this.loadVideoLibrary();
        }
        event.target.value = '';
    },

    // ============ 视频裁剪弹窗（精简版） ============

    showTrimModal(tempFile, duration) {
        document.getElementById('modalThumbnail').style.display = 'none';
        document.getElementById('trimOrigInfo').textContent = this._trimOrigInfo;
        var player = document.getElementById('trimVideoPlayer');
        player.src = '/api/thumbnails/video/' + tempFile;
        player.load();

        // 重置控件
        document.getElementById('trimStartSlider').value = 0;
        document.getElementById('trimEndSlider').value = 100;
        document.getElementById('trimProgress').style.display = 'none';
        document.getElementById('btnTrimProcess').style.display = 'block';
        this._trimMaxDuration = duration;
        this.onTrimSlider('start');
        document.getElementById('modalVideoTrim').style.display = 'flex';

        this._updateTrimPlayIcon(true);
        var overlayInit = document.getElementById('trimPlayOverlay');
        if (overlayInit) { overlayInit.style.backgroundColor = ''; overlayInit.style.pointerEvents = 'auto'; }
        this._updateTrimSizeEstimate();

        player.ontimeupdate = function() {
            if (player.duration > 0) {
                var cur = player.currentTime || 0;
                var dur = player.duration;
                var pct = Math.min(100, (cur / dur) * 100);
                document.getElementById('trimViewerTime').textContent = App._fmtTime(cur);
                document.getElementById('trimViewerDuration').textContent = App._fmtTime(dur);
                var fill = document.getElementById('trimProgressBarFill');
                if (fill) fill.style.width = pct + '%';
            }
        };

        player.onloadedmetadata = function() {
            if (player.duration > 0) {
                document.getElementById('trimViewerDuration').textContent = App._fmtTime(player.duration);
            }
        };

        player.onended = function() {
            App._updateTrimPlayIcon(true);
        };

        function _setupTrimSlider(id) {
            var el = document.getElementById(id);
            el.addEventListener('mousedown', function() {
                var p = document.getElementById('trimVideoPlayer');
                if (p) {
                    p.pause();
                    App._updateTrimPlayIcon(true);
                }
            });
            el.addEventListener('input', function() {
                App.onTrimSlider(id === 'trimEndSlider' ? 'end' : 'start');
                App._trimSeekToSlider(id === 'trimEndSlider' ? 'end' : 'start');
            });
            el.addEventListener('change', function() {
                // 松手：跳到目标位置，稍后暂停锁定帧
                App.onTrimSlider(id === 'trimEndSlider' ? 'end' : 'start');
                App._trimSeekAndStop(id === 'trimEndSlider' ? 'end' : 'start');
            });
        }
        _setupTrimSlider('trimStartSlider');
        _setupTrimSlider('trimEndSlider');
    },

    toggleTrimPlay() {
        var player = document.getElementById('trimVideoPlayer');
        if (!player) return;
        if (player.paused) {
            player.play();
            this._updateTrimPlayIcon(false);
            // 播放时图片按钮隐藏（鼠标移出后不显示）
            var overlay = document.getElementById('trimPlayOverlay');
            if (overlay) overlay.style.backgroundColor = 'transparent';
        } else {
            player.pause();
            this._updateTrimPlayIcon(true);
        }
    },

    _updateTrimPlayIcon(paused) {
        var icon = document.getElementById('trimPlayIcon');
        if (!icon) return;
        icon.innerHTML = paused ? '\u25b6' : '\u23f8';
        icon.style.opacity = paused ? '1' : '0';
        var overlay = document.getElementById('trimPlayOverlay');
        if (overlay) overlay.style.backgroundColor = paused ? '' : 'transparent';
    },

    onTrimQualityChange() {
        this._updateTrimSizeEstimate();
    },

    _updateTrimSizeEstimate() {
        var dur = this._trimMaxDuration || 0;
        var startPct = parseFloat(document.getElementById('trimStartSlider').value);
        var endPct = parseFloat(document.getElementById('trimEndSlider').value);
        var trimSec = (endPct - startPct) * dur / 100;
        var quality = parseInt(document.getElementById('trimQuality').value);
        // 基于原始大小等比估算
        var origSizeMb = this._trimOrigSizeMb || 0;
        var ratio = dur > 0 ? trimSec / dur : 0;
        // 品质系数: 1=0.5, 2=0.7, 3=1.0, 4=1.3, 5=1.6
        var qualityFactor = 0.5 + (quality - 1) * 0.3;
        var estMB = (origSizeMb * ratio * qualityFactor).toFixed(1);
        var label = document.getElementById('trimSizeLabel');
        if (label) {
            label.textContent = estMB + ' MB';
        }
    },

    _trimSeekToSlider(src) {
        var player = document.getElementById('trimVideoPlayer');
        if (!player || player.duration <= 0) return;
        var dur = player.duration;
        var pct = src === 'end'
            ? parseFloat(document.getElementById('trimEndSlider').value)
            : parseFloat(document.getElementById('trimStartSlider').value);
        var jumpSec = pct * dur / 100;
        // seek 到目标（浏览器渲染帧）
        player.currentTime = jumpSec;
        // 进度条 + 时间标签同步
        document.getElementById('trimViewerTime').textContent = App._fmtTime(jumpSec);
        var fill = document.getElementById('trimProgressBarFill');
        if (fill) fill.style.width = pct + '%';
    },

    _trimSeekAndStop(src) {
        var player = document.getElementById('trimVideoPlayer');
        if (!player || player.duration <= 0) return;
        var dur = player.duration;
        var pct = src === 'end'
            ? parseFloat(document.getElementById('trimEndSlider').value)
            : parseFloat(document.getElementById('trimStartSlider').value);
        var jumpSec = pct * dur / 100;

        // 先 seek，暂停态下 play 驱动 seeked 渲染帧后再停
        player.currentTime = jumpSec;
        if (player.paused) {
            var _onSeeked = function() {
                player.removeEventListener('seeked', _onSeeked);
                player.pause();
                App._updateTrimPlayIcon(true);
                // 确保进度条停在最终位置
                var fill = document.getElementById('trimProgressBarFill');
                if (fill) fill.style.width = pct + '%';
            };
            player.addEventListener('seeked', _onSeeked);
            player.play();
        } else {
            player.pause();
            App._updateTrimPlayIcon(true);
            var fill = document.getElementById('trimProgressBarFill');
            if (fill) fill.style.width = pct + '%';
        }
    },

    _showTrimPlayIcon() {
        var player = document.getElementById('trimVideoPlayer');
        if (!player) return;
        var icon = document.getElementById('trimPlayIcon');
        if (!icon) return;
        icon.style.opacity = '1';
        var overlay = document.getElementById('trimPlayOverlay');
        if (overlay) overlay.style.backgroundColor = '';
    },

    _hideTrimPlayIcon() {
        var player = document.getElementById('trimVideoPlayer');
        if (!player) return;
        // 播放中且暂停标记为 false 时，隐藏图标
        if (!player.paused) {
            var icon = document.getElementById('trimPlayIcon');
            if (icon) icon.style.opacity = '0';
            var overlay = document.getElementById('trimPlayOverlay');
            if (overlay) overlay.style.backgroundColor = 'transparent';
        }
    },

    onTrimSlider(source) {
        var dur = this._trimMaxDuration || 0;
        var startPct = parseFloat(document.getElementById('trimStartSlider').value);
        var endPct = parseFloat(document.getElementById('trimEndSlider').value);

        // 确保 start <= end
        if (startPct >= endPct) {
            if (source === 'start') {
                document.getElementById('trimStartSlider').value = Math.max(0, endPct - 2);
                startPct = Math.max(0, endPct - 2);
            } else {
                document.getElementById('trimEndSlider').value = Math.min(100, startPct + 2);
                endPct = Math.min(100, startPct + 2);
            }
        }

        var startSec = dur * startPct / 100;
        var endSec = dur * endPct / 100;
        document.getElementById('trimStartLabel').textContent = this._fmtTime(startSec);
        document.getElementById('trimEndLabel').textContent = this._fmtTime(endSec);
        document.getElementById('trimDurationLabel').textContent = (endSec - startSec).toFixed(1) + '秒';
        this._updateTrimSizeEstimate();
    },

    async processTrimmedVideo() {
        var startPct = parseFloat(document.getElementById('trimStartSlider').value);
        var endPct = parseFloat(document.getElementById('trimEndSlider').value);
        var dur = this._trimMaxDuration || 0;
        var startSec = dur * startPct / 100;
        var endSec = dur * endPct / 100;
        var quality = parseInt(document.getElementById('trimQuality').value);

        document.getElementById('trimProgress').style.display = 'block';
        document.getElementById('btnTrimProcess').style.display = 'none';

        var data = await this.fetchJSON('/api/thumbnails/trim-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                temp_file: this._trimTempFile,
                start_time: startSec,
                end_time: endSec,
                quality: quality,
                prompt_id: this._thumbnailPromptId
            })
        });

        document.getElementById('trimProgress').style.display = 'none';
        document.getElementById('btnTrimProcess').style.display = 'block';

        if (data && data.ok) {
            document.getElementById('modalVideoTrim').style.display = 'none';
            // 重新打开缩略图模态框,刷新图库
            document.getElementById('modalThumbnail').style.display = 'flex';
            this._thumbnailPage = 1;
            await this.loadThumbLibrary();
            await this.loadPrompts();
            this.showToast('视频处理完成,已关联到提示词', 'success');
        } else {
            this.showToast('处理失败', 'error');
        }
    },

    _fmtTime(sec) {
        var m = Math.floor(sec / 60);
        var s = (sec % 60).toFixed(1);
        return String(m).padStart(2, '0') + ':' + String(s).padStart(4, '0');
    },

    async selectThumbnail(filename) {
        // 编辑弹窗缩略图模式：暂存不提交
        if (this._editThumbnailMode) {
            this._editThumbFilename = filename;
            this._editVideoFilename = null;
            this._editThumbnailMode = false;
            document.getElementById('modalThumbnail').style.display = 'none';
            this.updateEditThumbDisplay();
            return;
        }
        // 如果是在设置收藏夹缩略图
        if (this._thumbnailCollectionId) {
            var data = await this.fetchJSON('/api/v2/collections/' + this._thumbnailCollectionId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thumbnail: filename, video_filename: '' })
            });
            if (data) {
                document.getElementById('modalThumbnail').style.display = 'none';
                this.showToast('收藏夹缩略图已设置', 'success');
                this._thumbnailCollectionId = null;
                await this.loadCollections();
                this.renderCollections();
            }
            return;
        }
        var data = await this.fetchJSON('/api/thumbnails/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_id: this._thumbnailPromptId, filename: filename })
        });
        if (data) {
            document.getElementById('modalThumbnail').style.display = 'none';
            this.showToast('缩略图已设置', 'success');
            await this.loadPrompts();
        }
    },


    // ============ 原图查看器(滚轮缩放 + 拖拽移动) ============

openImageViewer(filename, promptId) {
        var modal = document.getElementById('modalImageViewer');
        var img = document.getElementById('imageViewerImg');

        img.src = '/api/thumbnails/original/' + filename;
        modal.style.display = 'flex';

        var scale = 1, transX = 0, transY = 0;
        var isDrag = false, startX = 0, startY = 0;

        // 适配屏幕尺寸
        img.onload = function() {
            var vw = window.innerWidth * 0.85;
            var vh = window.innerHeight * 0.85;
            var iw = img.naturalWidth;
            var ih = img.naturalHeight;
            var fit = Math.min(vw / iw, vh / ih, 1);
            if (fit >= 1) {
                img.style.maxWidth = '90vw';
                img.style.maxHeight = '90vh';
            } else {
                img.style.maxWidth = 'none';
                img.style.maxHeight = 'none';
                img.width = Math.round(iw * fit);
                img.height = Math.round(ih * fit);
            }
            // 加载后重置变换
            applyTransform();
        };

        // 渲染右侧详情面板
        this._renderViewerRight('imgViewer', promptId);

        // 禁止浏览器原生图片拖拽
        img.setAttribute('draggable', 'false');
        img.style.transformOrigin = '0 0';
        img.style.cursor = 'grab';
        applyTransform();

        function applyTransform() {
            img.style.transform = 'translate(' + transX + 'px, ' + transY + 'px) scale(' + scale + ')';
        }

        var closeFn = function() {
            modal.style.display = 'none';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('keydown', escHandler);
            img.onwheel = null;
            img.onmousedown = null;
            img.ondblclick = null;
            img.onload = null;
            modal.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
        };

        var escHandler = function(e) {
            if (e.key === 'Escape') closeFn();
        };
        document.addEventListener('keydown', escHandler);

        function onMove(e) {
            if (!isDrag) return;
            e.preventDefault();
            transX = e.clientX - startX;
            transY = e.clientY - startY;
            applyTransform();
        }

        function onUp(e) {
            isDrag = false;
            img.style.cursor = 'grab';
        }

        img.onmousedown = function(e) {
            e.preventDefault();  // 阻止浏览器原生图片拖拽/保存
            startX = e.clientX - transX;
            startY = e.clientY - transY;
            isDrag = true;
            img.style.cursor = 'grabbing';
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);

        // 滚轮缩放:以鼠标位置为中心
        img.onwheel = function(e) {
            e.preventDefault();
            var rect = img.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;
            var delta = e.deltaY > 0 ? -0.1 : 0.1;
            var ns = Math.max(0.2, Math.min(10, scale + delta));
            var r = ns / scale;
            transX = transX + mx * (1 - r);
            transY = transY + my * (1 - r);
            scale = ns;
            applyTransform();
        };

        img.ondblclick = closeFn;

        // 触摸
        var lastDist = 0, lastTX = 0, lastTY = 0;
        img.ontouchstart = function(e) {
            if (e.touches.length === 1) {
                lastTX = e.touches[0].clientX - transX;
                lastTY = e.touches[0].clientY - transY;
            } else if (e.touches.length === 2) {
                var dx = e.touches[0].clientX - e.touches[1].clientX;
                var dy = e.touches[0].clientY - e.touches[1].clientY;
                lastDist = Math.sqrt(dx * dx + dy * dy);
            }
        };
        img.ontouchmove = function(e) {
            e.preventDefault();
            if (e.touches.length === 1) {
                transX = e.touches[0].clientX - lastTX;
                transY = e.touches[0].clientY - lastTY;
                applyTransform();
            } else if (e.touches.length === 2) {
                var dx = e.touches[0].clientX - e.touches[1].clientX;
                var dy = e.touches[0].clientY - e.touches[1].clientY;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (lastDist > 0) {
                    scale = Math.max(0.2, Math.min(10, scale * (dist / lastDist)));
                    applyTransform();
                }
                lastDist = dist;
            }
        };
        img.ontouchend = function() { lastDist = 0; };

        var closeBtn = document.getElementById('imgViewerClose');
        if (closeBtn) closeBtn.onclick = closeFn;
        modal.onclick = function(e) {
            if (e.target === modal) closeFn();
        };
    },

    closeImageViewer() {
        var m = document.getElementById('modalImageViewer');
        m.style.display = 'none';
    },



    // ============ 视频查看器(逐帧控制) ============

    openVideoViewer(videoFilename, posterFilename, promptId, videoFps) {
        var fps = parseFloat(videoFps) > 0 ? parseFloat(videoFps) : 30;

        this._videoFps = fps;

        var modal = document.getElementById('modalVideoViewer');
        var player = document.getElementById('vidViewerPlayer');
        var seek = document.getElementById('vidViewerSeek');
        var timeLabel = document.getElementById('vidViewerTime');
        var durLabel = document.getElementById('vidViewerDuration');
        var fpsLabel = document.getElementById('vidViewerFps');
        var playBtn = document.getElementById('vidPlayBtn');

        player.src = '/api/thumbnails/video/' + videoFilename;
        player.poster = '/api/thumbnails/file/' + posterFilename;
        player.load();
        modal.style.display = 'flex';

        this._renderViewerRight('vidViewer', promptId);

        // Reset
        seek.value = 0;
        var durStr = '00:00.0';
        timeLabel.textContent = durStr;
        if (durLabel) durLabel.textContent = durStr;
        if (fpsLabel) fpsLabel.textContent = fps > 0 ? fps + 'fps' : '';
        playBtn.innerHTML = '▶';

        function fmt(sec) {
            if (!sec || sec <= 0) return '00:00.0';
            var m = Math.floor(sec / 60);
            var s = (sec % 60).toFixed(1);
            return String(m).padStart(2, '0') + ':' + String(s).padStart(4, '0');
        }

        function closeVid() {
            player.pause();
            player.currentTime = 0;
            player.src = '';
            modal.style.display = 'none';
            player.ontimeupdate = null;
            player.onseeked = null;
            seek.oninput = null;
            seek.onchange = null;
            document.onkeydown = null;
            _seekTarget = -1;
            _seekBusy = false;
            window._vidSeekReset = null;
        }

        // Close buttons
        modal.onclick = function(e) { if (e.target === modal) closeVid(); };
        document.onkeydown = function(e) { if (e.key === 'Escape') closeVid(); };

        player.preload = 'auto';

        // --- 时间轴滑块 & 逐帧控制(惰性 seek,防堆积) ---
        // 快速拖拽时最多允许 1 个 seek 在途,保证画面紧追最新位置
        var _seekTarget = -1;       // 目标时间(用户期望的位置)
        var _seekBusy = false;      // 是否有 seek 正在处理中

        // 执行 seek 到目标(仅当无在途 seek 时)
        function _doSeek() {
            if (_seekTarget < 0 || _seekBusy || player.duration <= 0) return;
            _seekBusy = true;
            player.pause();
            player.currentTime = _seekTarget;
        }
        // 暴露给全局 seekFrame/seekVideo 使用
        window._vidSeekReset = function() { _seekTarget = -1; _seekBusy = false; };

        // 滑块拖拽中:只存目标时间+更新标签,不立刻 seek(由 RAF 驱动)
        seek.oninput = function(e) {
            if (player.duration <= 0) return;
            var t = (parseFloat(this.value) / 1000) * player.duration;
            _seekTarget = t;
            timeLabel.textContent = fmt(t);
            if (durLabel && player.duration > 0) durLabel.textContent = fmt(player.duration);
            // 如果空闲则启动 seek
            _doSeek();
        };

        // seek 完成:帧已渲染,同步 UI + 检查是否有更新的目标
        player.onseeked = function() {
            _seekBusy = false;
            if (player.duration > 0) {
                var cur = player.currentTime || 0;
                var tar = _seekTarget;
                // 如果最新目标与当前帧差距 > 1帧(≈0.03s),立即再次 seek
                if (tar >= 0 && Math.abs(cur - tar) > 0.03) {
                    _doSeek();
                } else {
                    // 到位了,同步 UI
                    seqSync(player, seek, timeLabel, durLabel);
                }
            }
        };

        // 拖拽结束:精确同步 + 确保最终帧到位
        seek.onchange = function() {
            if (player.duration > 0) {
                var cur = player.currentTime || 0;
                var tar = _seekTarget;
                if (tar >= 0 && Math.abs(cur - tar) > 0.03) {
                    _seekBusy = false; // 允许重试
                    _doSeek();
                } else {
                    seqSync(player, seek, timeLabel, durLabel);
                }
            }
        };

        // 播放中持续同步
        player.ontimeupdate = function() {
            if (player.duration > 0 && !_seekBusy) {
                seqSync(player, seek, timeLabel, durLabel);
            }
        };

        // 时长加载
        player.onloadedmetadata = function() {
            if (durLabel && player.duration > 0) durLabel.textContent = fmt(player.duration);
        };

        // 播放/暂停按钮
        player.onplay = function() { playBtn.innerHTML = '⏸'; };
        player.onpause = function() { playBtn.innerHTML = '▶'; };

        // 共用同步函数
        function seqSync(p, s, tl, dl) {
            var cur = p.currentTime || 0;
            var dur = p.duration || 0;
            var pct = dur > 0 ? Math.round((cur / dur) * 1000) : 0;
            s.value = pct;
            tl.textContent = fmt(cur);
            if (dl && dur > 0) dl.textContent = fmt(dur);
            document.getElementById('vidSeekRow').style.setProperty('--vid-progress', pct + '%');
        }
    },

    closeVideoViewer() {
        var m = document.getElementById('modalVideoViewer');
        m.style.display = 'none';
        var p = document.getElementById('vidViewerPlayer');
        if (p) { p.pause(); p.currentTime = 0; p.src = ''; }
    },

    _updateVidTime(player, seek, label) {
        var dur = player.duration || 0;
        var cur = (parseFloat(seek.value) / 1000) * dur;
        if (dur <= 0) cur = player.currentTime || 0;
        label.textContent = App._fmtTime(cur) + ' / ' + App._fmtTime(dur);
    },

    toggleVideoPlay() {
        var player = document.getElementById('vidViewerPlayer');
        if (player.paused) { player.play(); } else { player.pause(); }
    },

    // 视频 UI 同步(供 seekFrame / seekVideo / closeVid 调用)
    _syncVidUI(player, seek, timeLabel, durLabel) {
        if (!player || player.duration <= 0) return;
        var cur = player.currentTime || 0;
        var dur = player.duration;
        var pct = Math.round((cur / dur) * 1000);
        if (seek) seek.value = pct;
        if (timeLabel) timeLabel.textContent = App._fmtTime(cur);
        if (durLabel && dur > 0) durLabel.textContent = App._fmtTime(dur);
        document.getElementById('vidSeekRow').style.setProperty('--vid-progress', pct + '%');
    },

    // 帧跳转(使用自动探测的 fps)
    seekFrame(frames) {
        var player = document.getElementById('vidViewerPlayer');
        var seek = document.getElementById('vidViewerSeek');
        var timeLabel = document.getElementById('vidViewerTime');
        var durLabel = document.getElementById('vidViewerDuration');
        if (player.duration <= 0) return;
        var fps = this._videoFps || 30;
        var seconds = frames / fps;
        var newTime = Math.max(0, Math.min(player.duration, (player.currentTime || 0) + seconds));
        player.pause();
        // 清除惰性 seek 目标,防止 onseeked 回跳
        if (window._vidSeekReset) window._vidSeekReset();
        player.currentTime = newTime;
        // 即时更新界面
        this._syncVidUI(player, seek, timeLabel, durLabel);
    },

    seekVideo(seconds) {
        var player = document.getElementById('vidViewerPlayer');
        var seek = document.getElementById('vidViewerSeek');
        var timeLabel = document.getElementById('vidViewerTime');
        var durLabel = document.getElementById('vidViewerDuration');
        if (player.duration <= 0) return;
        player.pause();
        if (window._vidSeekReset) window._vidSeekReset();
        var newTime = Math.max(0, Math.min(player.duration, (player.currentTime || 0) + seconds));
        player.currentTime = newTime;
        this._syncVidUI(player, seek, timeLabel, durLabel);
    },    // 查看器收藏徽标:双击跳转到收藏分组
    async _toggleViewerCollect(cid, pid, checkbox) {
        if (checkbox.checked) {
            // 添加到收藏
            await this.fetchJSON('/api/v2/collections/' + cid + '/items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: pid })
            });
            this.showToast('已添加到收藏', 'success');
        } else {
            // 从收藏移除
            await this.fetchJSON('/api/v2/collections/' + cid + '/items/' + pid, { method: 'DELETE' });
            this.showToast('已从收藏移除', 'info');
        }
        // 刷新查看器右侧面板 + 首页卡片收藏徽标
        await this.loadCollections();
        this._refreshViewerPanels();
        if (this.state.currentView === 'home') await this.loadPrompts();
    },

    _setupViewerCollBadges() {
        setTimeout(function() {
            var badges = document.querySelectorAll('.viewer-coll-badge');
            for (var i = 0; i < badges.length; i++) {
                (function(el) {
                    el.removeEventListener('dblclick', el._vdbl);
                    el._vdbl = function() {
                        var cid = parseInt(el.getAttribute('data-cid'));
                        if (cid) {
                            var m = document.getElementById('modalImageViewer');
                            if (m) m.style.display = 'none';
                            var m2 = document.getElementById('modalVideoViewer');
                            if (m2) m2.style.display = 'none';
                            App.switchView('collections');
                            App.openCollection(cid);
                        }
                    };
                    el.addEventListener('dblclick', el._vdbl);
                })(badges[i]);
            }
        }, 100);
    },

    // 刷新查看器右侧收藏勾选面板
    _refreshViewerPanels() {
        var self = this;
        ['imgViewer', 'vidViewer'].forEach(function(prefix) {
            var modalId = (prefix === 'imgViewer') ? 'modalImageViewer' : 'modalVideoViewer';
            var modal = document.getElementById(modalId);
            if (modal && modal.style.display !== 'none') {
                var el = document.getElementById(prefix + 'Content');
                if (el) {
                    var pid = parseInt(el.getAttribute('data-prompt-id'));
                    if (pid) {
                        self.fetchJSON('/api/prompts/' + pid).then(function(d) {
                            if (d) self._fillViewerPanel(prefix, d);
                        });
                    }
                }
            }
        });
    },

    _renderViewerRight(prefix, promptId) {
        var p = null;
        for (var i = 0; i < this.state.prompts.length; i++) {
            if (this.state.prompts[i].id === promptId) {
                p = this.state.prompts[i];
                break;
            }
        }
        if (!p) {
            var self = this;
            this.fetchJSON('/api/prompts/' + promptId).then(function(data) {
                if (data) self._fillViewerPanel(prefix, data);
            });
            return;
        }
        this._fillViewerPanel(prefix, p);
    },

    _fillViewerPanel(prefix, p) {
        var moduleNames = {emotion:'人物表情',color:'场景色彩',tone:'画面色调',composition:'构图运镜',seedance:'Seedance'};
        var mEl = document.getElementById(prefix + 'Module');
        var cEl = document.getElementById(prefix + 'Content');
        var mnEl = document.getElementById(prefix + 'Meaning');
        var tEl = document.getElementById(prefix + 'Tags');
        if (mEl) mEl.textContent = moduleNames[p.module] || p.module;
        if (cEl) {
            cEl.textContent = p.content || '';
            cEl.setAttribute('data-prompt-id', p.id || '');
            cEl.setAttribute('data-content', p.content || '');
        }
        if (mnEl) mnEl.textContent = p.meaning || '';
        if (tEl) {
            try { var tags = JSON.parse(p.tags || '[]');
                tEl.textContent = tags.map(function(t){return '#'+t;}).join(' ');
            } catch(e) { tEl.textContent = ''; }
        }
        var collDiv = document.getElementById(prefix + 'Collections');
        if (collDiv) {
            var allC = this.state.collections;
            var pColls = p.collections || [];
            var checked = {};
            for (var ci = 0; ci < pColls.length; ci++) {
                checked[pColls[ci].id] = true;
            }
            var ch = '<div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">收藏分组:</div>';
            if (allC && allC.length > 0) {
                for (var ci2 = 0; ci2 < allC.length; ci2++) {
                    var cc = allC[ci2];
                    var isChk = checked[cc.id] ? 'checked' : '';
                    ch += '<label class="viewer-coll-check"><input type="checkbox" ' + isChk + ' data-cid="' + cc.id + '" data-pid="' + p.id + '" onchange="App._toggleViewerCollect(' + cc.id + ', ' + p.id + ', this)"> ' + (cc.icon || '⭐') + ' ' + (cc.name || '') + '</label>';
                }
            } else {
                ch += '<div style="font-size:12px;color:#64748b;">暂无收藏分组</div>';
            }
            collDiv.innerHTML = ch;
        }
    },

    copyImgViewerContent() {
        var el = document.getElementById('imgViewerContent');
        if (!el) return;
        var c = el.getAttribute('data-content') || el.textContent;
        if (c && c !== '-') { App.copyText(c,'提示词已复制');
            var pid = parseInt(el.getAttribute('data-prompt-id'));
            if (pid) App.trackUsage(pid); }
    },

    copyVidViewerContent() {
        var el = document.getElementById('vidViewerContent');
        if (!el) return;
        var c = el.getAttribute('data-content') || el.textContent;
        if (c && c !== '-') { App.copyText(c,'提示词已复制');
            var pid = parseInt(el.getAttribute('data-prompt-id'));
            if (pid) App.trackUsage(pid); }
    },

    collectImgViewerPrompt() {
        var el = document.getElementById('imgViewerContent');
        if (!el) return;
        var pid = parseInt(el.getAttribute('data-prompt-id'));
        if (!pid) return;
        var btnEl = document.getElementById('imgViewerCollectBtn');
        if (!btnEl) return;
        App.quickCollect(pid, btnEl);
    },

    collectVidViewerPrompt() {
        var el = document.getElementById('vidViewerContent');
        if (!el) return;
        var pid = parseInt(el.getAttribute('data-prompt-id'));
        if (!pid) return;
        var btnEl = document.getElementById('vidViewerCollectBtn');
        if (!btnEl) return;
        App.quickCollect(pid, btnEl);
    },

        // ============ 工具 ============

    // --- PNG 拖拽导入处理器 ---
    _dropAttached: false,

    _onDragOver: function(e) {
        e.preventDefault();
        e.currentTarget.style.outline = '2px dashed #6366f1';
        e.currentTarget.style.outlineOffset = '-2px';
        e.currentTarget.style.borderRadius = '8px';
    },

    _onDragLeave: function(e) {
        e.currentTarget.style.outline = '';
        e.currentTarget.style.outlineOffset = '';
    },

    _onDropPng: async function(e) {
        e.preventDefault();
        e.currentTarget.style.outline = '';
        var files = e.dataTransfer.files;
        if (!files || files.length === 0) return;
        var pngFiles = [];
        for (var fi = 0; fi < files.length; fi++) {
            if (files[fi].type === 'image/png' || files[fi].name.toLowerCase().endsWith('.png')) {
                pngFiles.push(files[fi]);
            }
        }
        if (pngFiles.length === 0) {
            App.showToast('请拖拽 PNG 文件', 'error');
            return;
        }
        // 对每个 PNG 文件预览并确认
        var created = 0;
        for (var fi2 = 0; fi2 < pngFiles.length; fi2++) {
            var file = pngFiles[fi2];
            var formData = new FormData();
            formData.append('file', file);
            try {
                var resp = await fetch('/api/export/preview-png', { method: 'POST', body: formData });
                var preview = await resp.json();
                if (preview.ok && preview.preview) {
                    var p = preview.preview;
                    if (!confirm('拖入提示词卡片: \n内容: ' + (p.content || '').substring(0, 60) + '\n模块: ' + (p.module || '') + '\n分类: ' + (p.category || '') + '\n\n确认导入？')) continue;
                    var resp2 = await fetch('/api/export/import-png?conflict=rename', { method: 'POST', body: formData });
                    var result = await resp2.json();
                    if (result.ok && result.result.created) created++;
                } else {
                    App.showToast('无法识别文件: ' + file.name, 'error');
                }
            } catch(err) {
                App.showToast('导入失败: ' + file.name, 'error');
            }
        }
        if (created > 0) {
            App.showToast('成功导入 ' + created + ' 条词条', 'success');
            await App.loadPrompts();
        }
    },

    _escape(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
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

