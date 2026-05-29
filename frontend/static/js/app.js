/**
 * WebUI 提示词检索工具 v2.0 — 完整应用逻辑
 * 单页应用，零框架依赖
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
        batchMode: false,
        batchSelected: new Set(),
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
        const savedTheme = localStorage.getItem('promptkit_theme') || 'light';
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

        this.bindEvents();
        await Promise.all([
            this.loadModules(),
            this.loadStats(),
            this.loadCollections(),
            this.loadWordpacks()
        ]);

        // 恢复上次的视图状态
        var savedView = localStorage.getItem('promptkit_view');
        var savedModule = localStorage.getItem('promptkit_module');

        if (savedView === 'seedance') {
            this.switchView('seedance');
            var savedSeedanceTab = localStorage.getItem('promptkit_seedance_tab') || 'templates';
            setTimeout(function() { App.switchSeedanceTab(savedSeedanceTab); }, 100);
        } else if (savedView === 'collections' || savedView === 'wordpacks' || savedView === 'history') {
            this.switchView(savedView);
        } else if (savedModule && this.state.modules.find(function(m) { return m.id === savedModule; })) {
            this.switchModule(savedModule);
        } else if (this.state.modules.length > 0) {
            this.switchModule(this.state.modules[0].id);
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
                this.loadPrompts();
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
        document.querySelectorAll('.view-panel').forEach(el => el.style.display = 'none');
        // 导航按钮状态
        document.querySelectorAll('.header-btn[id^="nav"]').forEach(el => el.classList.remove('active'));

        const navMap = {
            home: 'navHome',
            collections: 'navCollections',
            wordpacks: 'navWordpacks',
            history: 'navHistory'
        };

        if (view === 'home') {
            document.getElementById('viewHome').style.display = 'block';
            document.getElementById(navMap[view]).classList.add('active');
            document.getElementById('globalSearchBox').style.display = 'flex';
            this.renderSidebar();
        } else if (view === 'collections') {
            document.getElementById('viewCollections').style.display = 'block';
            document.getElementById(navMap[view]).classList.add('active');
            document.getElementById('globalSearchBox').style.display = 'none';
            this.renderCollections();
        } else if (view === 'wordpacks') {
            document.getElementById('viewWordpacks').style.display = 'block';
            document.getElementById(navMap[view]).classList.add('active');
            document.getElementById('globalSearchBox').style.display = 'none';
            this.renderWordpacks();
        } else if (view === 'history') {
            document.getElementById('viewHistory').style.display = 'block';
            document.getElementById(navMap[view]).classList.add('active');
            document.getElementById('globalSearchBox').style.display = 'none';
            this.loadHistory();
        } else if (view === 'seedance') {
            this.state.currentModule = 'seedance';
            this.renderSidebar();
            document.getElementById('viewSeedance').style.display = 'block';
            document.getElementById('globalSearchBox').style.display = 'none';
            this.loadSeedanceCategories();
            this.loadSeedanceTemplates();
        }

        // 关闭推荐面板
        this.closeRecommend();
        // 退出批量模式
        if (this.state.batchMode) this.toggleBatchMode();
    },

    // ============ 数据加载 ============
    async fetchJSON(url, options) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            console.error('请求失败:', url, err);
            this.showToast('网络请求失败，请检查服务是否运行', 'error');
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
        this.renderSidebar();
        this.switchView('home');
        await this.loadCategories(moduleId);
        await this.loadPrompts();
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

    // ============ 批量操作 ============
    toggleBatchMode() {
        this.state.batchMode = !this.state.batchMode;
        this.state.batchSelected.clear();
        if (this.state.editMode && this.state.batchMode) {
            this.state.editMode = false;
            var eb = document.getElementById('btnEditMode');
            if (eb) { eb.style.color = '#94a3b8'; eb.classList.remove('active'); }
        }
        var bar = document.getElementById('batchBar');
        var btn = document.getElementById('btnBatch');
        if (this.state.batchMode) {
            bar.style.display = 'flex';
            btn.classList.add('active');
        } else {
            bar.style.display = 'none';
            btn.classList.remove('active');
        }
        this.renderPrompts();
        this.updateBatchCount();
    },

    toggleEditMode() {
        this.state.editMode = !this.state.editMode;
        if (this.state.editMode && this.state.batchMode) {
            this.state.batchMode = false;
            if (document.getElementById('batchBar')) document.getElementById('batchBar').style.display = 'none';
            if (document.getElementById('btnBatch')) document.getElementById('btnBatch').classList.remove('active');
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
        // 通过隐藏下载触发
        try {
            const res = await fetch('/api/v2/batch/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_ids: ids, format: fmt })
            });
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `prompts_export.${fmt}`;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast(`导出成功 (${ids.length} 条)`, 'success');
        } catch (e) {
            this.showToast('导出失败', 'error');
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
        let html = '<p style="margin-bottom:12px;font-size:13px;color:var(--text-muted);">选择要添加到的词包：</p>';
        for (const wp of data.items) {
            html += `<div class="cat-tab" style="display:block;margin-bottom:6px;text-align:left;" onclick="App.doAddToWordpack(${wp.id}, '${this._escape(wp.name)}')">
                📁 ${this._escape(wp.name)} (${wp.item_count} 条)
            </div>`;
        }
        document.getElementById('wordpackSelectList').innerHTML = html;
        document.getElementById('modalAddToWordpack').style.display = 'flex';
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
            this.toggleBatchMode();
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
            container.innerHTML = '<div class="empty-state"><div class="icon">📁</div><p>暂无收藏分组，点击右上角新建</p></div>';
            return;
        }
        // 图标候选列表
        var iconOptions = ['⭐','📸','🌄','❤️','🔥','🎯','🌟','💎','🏆','🎨','📷','🎬','📁','🏔️','🎭','🌈','🌸','🍁','🌊','☀️','🌙','✨','💡','🔖','📌','💜','🧡','💚','💙'];
        var iconSelectHtml = '<select class="icon-picker" onchange="App.changeCollectionIcon(';

        let html = '';
        for (const c of this.state.collections) {
            var iconOpts = '';
            for (var ii = 0; ii < iconOptions.length; ii++) {
                var sel = iconOptions[ii] === c.icon ? 'selected' : '';
                iconOpts += '<option value="' + iconOptions[ii] + '" ' + sel + '>' + iconOptions[ii] + '</option>';
            }
            html += `
                <div class="collection-card" onclick="App.openCollection(${c.id})">
                    <div class="card-icon">
                        <select class="icon-picker" onchange="App.changeCollectionIcon(${c.id}, this)" onclick="event.stopPropagation()">
                            ${iconOpts}
                        </select>
                    </div>
                    <div class="card-name">${this._escape(c.name)}</div>
                    <div class="card-count">${c.item_count} 条</div>
                    <div class="card-actions">
                        <button class="wp-btn" onclick="event.stopPropagation();App.deleteCollection(${c.id})">删除</button>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
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
            html += `
                <div class="prompt-card" data-id="${p.id}">
                    <div style="display:flex;align-items:center;margin-bottom:6px;">
                        <span class="card-badge">${this._escape(p.category)}</span>
                    </div>
                    <div class="card-content">${this._escape(p.content)}</div>
                    ${p.meaning ? `<div class="card-meaning">${this._escape(p.meaning)}</div>` : ''}
                    <div class="card-actions">
                        <button class="btn-copy" onclick="App.trackUsage(${p.id});App.copyText('${this._escape(p.content).replace(/'/g, "\\'")}')">📋 复制</button>
                        <button class="btn-copy" style="border-color:#ef4444;color:#ef4444;" onclick="App.removeFromCollection(${this.state.currentCollection}, ${p.id})">移除</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
    },

    async removeFromCollection(cid, pid) {
        await this.fetchJSON(`/api/v2/collections/${cid}/items/${pid}`, { method: 'DELETE' });
        this.showToast('已移除', 'info');
        await this.loadCollections();
        await this.loadCollectionItems();
    },

    backToCollections() {
        this.state.currentCollection = null;
        document.getElementById('collectionGroups').style.display = 'grid';
        document.getElementById('collectionItems').style.display = 'none';
        this.renderCollections();
    },

    async deleteCollection(cid) {
        if (!confirm('确定删除此收藏分组？')) return;
        await this.fetchJSON(`/api/v2/collections/${cid}`, { method: 'DELETE' });
        this.showToast('已删除', 'info');
        await this.loadCollections();
        this.renderCollections();
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
            container.innerHTML = '<div class="empty-state"><div class="icon">📂</div><p>暂无词包，点击右上角新建</p></div>';
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
                <div class="prompt-card">
                    <span class="card-badge">${this._escape(p.category)}</span>
                    <div class="card-content">${this._escape(p.content)}</div>
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
        if (!confirm('确定删除此词包？')) return;
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
                    <div class="card-content">${this._escape(p.content)}</div>
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
        if (!confirm('确定清空所有使用记录？')) return;
        await this.fetchJSON('/api/v2/history', { method: 'DELETE' });
        this.showToast('已清空', 'info');
        this.loadHistory();
    },

    async deleteHistoryItem(pid) {
        await this.fetchJSON(`/api/v2/history/${pid}`, { method: 'DELETE' });
        this.showToast('已移除', 'info');
        this.loadHistory();
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
        document.getElementById('columnSlider').value = cols;
        document.getElementById('columnLabel').textContent = cols + '列';

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
        var data = await this.fetchJSON('/api/prompts/' + promptId);
        if (!data) return;
        this._editingPromptId = promptId;
        document.getElementById('editPromptTitle').textContent = promptId > 151 ? '编辑提示词' : '查看提示词';
        document.getElementById('editContent').value = data.content || '';
        document.getElementById('editMeaning').value = data.meaning || '';
        document.getElementById('editScene').value = data.scene || '';
        document.getElementById('editModule').value = data.module || '';
        document.getElementById('editCategory').value = data.category || '';
        document.getElementById('editTags').value = data.tags || '[]';
        var delBtn = document.getElementById('editDeleteBtn');
        if (data.is_builtin == 1) {
            delBtn.style.display = 'none';
        } else {
            delBtn.style.display = 'inline-block';
        }
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
            this.closeEditModal();
            this.showToast('保存成功', 'success');
            await this.loadPrompts();
        }
    },

    async deleteEditPrompt() {
        var pid = this._editingPromptId;
        if (!pid || pid <= 151) { this.showToast('内置词条不可删除', 'error'); return; }
        if (!confirm('确定删除此提示词？')) return;
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
    // ============ 渲染：侧边栏 ============
    renderSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        const icons = { emotion: '😊', color: '🎨', tone: '💡', composition: '📐', seedance: '🎬' };
        const names = { emotion: '人物表情', color: '场景色彩', tone: '画面色调', composition: '构图运镜', seedance: 'Seedance视频' };
        let html = '<div style="padding:8px 20px 10px;color:#64748b;font-size:11px;letter-spacing:1px;">功能模块</div>';
        for (const m of this.state.modules) {
            const active = m.id === this.state.currentModule ? 'active' : '';
            // Seedance 不通过 switchModule，直接跳转 Seedance 视图
            const clickHandler = m.id === 'seedance'
                ? `App.switchView('seedance')`
                : `App.switchModule('${m.id}')`;
            html += `
                <div class="module-item ${active}" onclick="${clickHandler}">
                    <span class="icon">${icons[m.id] || '📋'}</span>
                    <span>${names[m.id] || m.id}</span>
                    <span class="count-badge">${m.count}</span>
                </div>
            `;
        }
        sidebar.innerHTML = html;
    },

    // ============ 渲染：分类标签 ============
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

    // ============ 渲染：提示词卡片 ============
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
            const batchClass = this.state.batchMode ? 'batch-mode' : '';
            const selectedClass = isSelected ? 'selected' : '';

            var colls = p.collections || [];
            var collHtml = '';
            for (var ci = 0; ci < colls.length; ci++) {
                var cc = colls[ci];
                collHtml += '<span class="coll-badge" ondblclick="App.switchView(\'collections\');App.openCollection(' + cc.id + ')" title="双击进入「' + this._escape(cc.name) + '」收藏分组">' + (cc.icon || '⭐') + '</span>';
            }
            // 添加收藏按钮（竖排末尾）
            collHtml += '<span class="coll-add-btn" onclick="event.stopPropagation();App.quickCollect(' + p.id + ', this)" title="添加到收藏分组">+</span>';

            html += `
                <div class="prompt-card ${batchClass} ${selectedClass}" data-id="${p.id}">
                    <div class="card-checkbox">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="App.toggleSelect(${p.id})">
                    </div>
                    <div class="card-body">
                        <div class="card-thumb">
                            <div class="card-thumb-inner" onclick="App.showThumbnailPicker(${p.id})">
                                ${p.thumbnail
                                    ? (p.video_filename
                                        ? `<video class="thumb-video" src="/api/thumbnails/video/${p.video_filename}" poster="/api/thumbnails/file/${p.thumbnail}" loop muted playsinline preload="none"></video>`
                                        : `<img src="/api/thumbnails/file/${p.thumbnail}" alt="缩略图">`
                                      )
                                    : `<div class="thumb-placeholder">
                                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                                      </div>`
                                }
                            </div>
                            ${p.thumbnail ? '<span class="thumb-zoom-btn" onclick="event.stopPropagation();' + (p.video_filename ? 'App.openVideoViewer(\'' + p.video_filename + '\', \'' + p.thumbnail + '\', \'' + p.id + '\')' : 'App.openImageViewer(\'' + p.thumbnail + '\', \'' + p.id + '\')') + '" title="' + (p.video_filename ? '查看原视频' : '查看原图') + '">' + (p.video_filename ? '▶' : '🔍') + '</span>' : ''}
                        </div>
                        <div class="card-text">
                            <div style="display:flex;align-items:center;margin-bottom:6px;gap:4px;">
                                <span class="card-badge">${this._escape(p.category)}</span>
                                ${p.subcategory ? `<span style="font-size:10px;color:#94a3b8;">${this._escape(p.subcategory)}</span>` : ''}
                            </div>
                            <div class="card-content">${this._escape(p.content)}</div>
                            ${p.meaning ? `<div class="card-meaning">${this._escape(p.meaning)}</div>` : ''}
                            ${p.scene ? `<div class="card-scene">🎯 ${this._escape(p.scene)}</div>` : ''}
                            <div style="font-size:10px;color:#cbd5e1;margin-bottom:6px;">${tagHtml}</div>
                            <div class="card-actions">
                                <span style="font-size:11px;color:#94a3b8;margin-right:auto;">使用 ${p.usage_count} 次</span>
                                ${App.state.editMode ? '<button class="btn-copy" style="border-color:#eab308;color:#eab308;padding:3px 10px;" onclick="App.openEditModal(' + p.id + ')">\u270f \u7f16\u8f91</button>' : ''}
                                <button class="btn-copy" onclick="App.handleCopy(${p.id}, '${this._escape(p.content).replace(/'/g, "\\'")}')">📋 复制</button>
                            </div>
                        </div>
                        <div class="card-collections">${collHtml}</div>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
        this.applyColumns();
        // 绑定视频悬停播放
        this.bindVideoHover();
    },

    // ============ 视频悬停播放 ============
    bindVideoHover() {
        var videos = document.querySelectorAll('.thumb-video');
        for (var i = 0; i < videos.length; i++) {
            var v = videos[i];
            v.removeEventListener('mouseenter', App._playVideo);
            v.removeEventListener('mouseleave', App._pauseVideo);
            v.addEventListener('mouseenter', App._playVideo);
            v.addEventListener('mouseleave', App._pauseVideo);
        }
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
    renderPagination() {
        const bar = document.getElementById('paginationBar');
        if (!bar) return;
        const { page, totalPages } = this.state;
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

    // ============ 一键收藏（下拉菜单） ============

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

        // 弹窗内部点击不冒泡，避免触发关闭
        popover.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        // 点击弹窗外部关闭 —— 使用一次性监听，避免累积
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
            // 如果查看器开着，刷新右侧勾选列表
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
            var match = trimmed.match(/^(\d+[\-~]\d+)秒?[：:]\s*(.+)/);
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
    // 不再需要下拉刷新，因为收藏通过 +popover 操作后调用 loadPrompts 全量刷新

    // ============ 缩略图管理 ============

    _thumbnailPromptId: null,  // 当前正在设置缩略图的提示词ID
    _thumbnailPage: 1,

    async showThumbnailPicker(promptId) {
        this._thumbnailPromptId = promptId;
        this._thumbnailPage = 1;
        // 检查是否已有缩略图
        try {
            var p = this.state.prompts.find(function(x) { return x.id === promptId; });
            if (p && p.thumbnail) {
                document.getElementById('btnRemoveThumb').style.display = 'inline-block';
            } else {
                document.getElementById('btnRemoveThumb').style.display = 'none';
            }
        } catch(e) {
            document.getElementById('btnRemoveThumb').style.display = 'none';
        }
        document.getElementById('modalThumbnail').style.display = 'flex';
        await this.loadThumbLibrary();
    },

    async loadThumbLibrary() {
        var grid = document.getElementById('thumbLibraryGrid');
        grid.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:20px;">加载图库中...</div>';
        var data = await this.fetchJSON('/api/thumbnails/library?page=' + this._thumbnailPage + '&page_size=50');
        if (!data) { grid.innerHTML = '<div class="empty-state"><p>图库为空，请上传图片</p></div>'; return; }

        var html = '';
        for (var i = 0; i < data.items.length; i++) {
            var item = data.items[i];
            var selectedClass = '';
            var usedBadge = '';
            if (item.used_by === this._thumbnailPromptId) selectedClass = 'thumb-selected';
            if (item.used_by && item.used_by !== this._thumbnailPromptId) usedBadge = '<span class="thumb-used-badge">已使用</span>';
            html += '<div class="thumb-item ' + selectedClass + '" onclick="App.selectThumbnail(\'' + item.filename + '\')">' +
                '<img src="/api/thumbnails/file/' + item.filename + '" loading="lazy">' +
                usedBadge +
                '</div>';
        }
        if (data.items.length === 0) html = '<div class="empty-state"><p>图库为空</p></div>';
        grid.innerHTML = html;

        // 分页
        var pbar = document.getElementById('thumbPagination');
        if (data.total_pages <= 1) { pbar.innerHTML = ''; return; }
        var ph = '';
        for (var pi = 1; pi <= data.total_pages; pi++) {
            ph += '<button class="page-btn ' + (pi === this._thumbnailPage ? 'active' : '') + '" onclick="App._thumbnailPage=' + pi + ';App.loadThumbLibrary()">' + pi + '</button>';
        }
        pbar.innerHTML = ph;
    },

    async uploadThumbnail(event) {
        var file = event.target.files[0];
        if (!file) return;
        var formData = new FormData();
        formData.append('file', file);
        try {
            var resp = await fetch('/api/thumbnails/upload', { method: 'POST', body: formData });
            var data = await resp.json();
            if (data.ok) {
                this.showToast('上传成功', 'success');
                // 自动关联到当前提示词
                await this.fetchJSON('/api/thumbnails/assign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt_id: this._thumbnailPromptId, filename: data.filename })
                });
                document.getElementById('modalThumbnail').style.display = 'none';
                // 刷新当前页
                await this.loadPrompts();
            }
        } catch(e) {
            this.showToast('上传失败', 'error');
        }
        event.target.value = '';
    },

    async uploadVideo(event) {
        var file = event.target.files[0];
        if (!file) return;
        var formData = new FormData();
        formData.append('file', file);
        try {
            this.showToast('正在准备视频...', 'info');
            var resp = await fetch('/api/thumbnails/prepare-upload', { method: 'POST', body: formData });
            var data = await resp.json();
            if (data.ok) {
                if (data.needs_trim) {
                    // 大视频，弹出裁剪界面
                    this._trimTempFile = data.temp_file;
                    this._trimDuration = data.duration;
                    this._trimOrigInfo = data.original_name + ' (' + data.size_mb + 'MB, ' + data.duration + '秒)';
                    this.showTrimModal(data.temp_file, data.duration);
                } else {
                    // 小视频，直接上传
                    var resp2 = await fetch('/api/thumbnails/upload-video', { method: 'POST', body: formData });
                    var data2 = await resp2.json();
                    if (data2.ok) {
                        this.showToast('视频上传成功', 'success');
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
                        document.getElementById('modalThumbnail').style.display = 'none';
                        await this.loadPrompts();
                    }
                }
            }
        } catch(e) {
            this.showToast('视频上传失败: ' + (e.message || e), 'error');
        }
        event.target.value = '';
    },

    // ============ 视频裁剪弹窗 ============

    showTrimModal(tempFile, duration) {
        document.getElementById('modalThumbnail').style.display = 'none';
        document.getElementById('trimOrigInfo').textContent = this._trimOrigInfo;
        var player = document.getElementById('trimVideoPlayer');
        player.src = '/api/thumbnails/video/' + tempFile;
        player.load();

        // 重置滑块
        document.getElementById('trimStartSlider').value = 0;
        document.getElementById('trimEndSlider').value = 100;
        document.getElementById('trimProgress').style.display = 'none';
        document.getElementById('btnTrimProcess').style.display = 'block';
        this._trimMaxDuration = duration;
        this.onTrimSlider();
        document.getElementById('modalVideoTrim').style.display = 'flex';
    },

    onTrimSlider() {
        var dur = this._trimMaxDuration || 0;
        var startPct = parseFloat(document.getElementById('trimStartSlider').value);
        var endPct = parseFloat(document.getElementById('trimEndSlider').value);

        // 确保 start <= end
        if (startPct >= endPct) {
            document.getElementById('trimStartSlider').value = Math.max(0, endPct - 5);
            startPct = Math.max(0, endPct - 5);
        }

        var startSec = dur * startPct / 100;
        var endSec = dur * endPct / 100;
        var trimDur = Math.max(0, endSec - startSec);

        document.getElementById('trimStartLabel').textContent = this._fmtTime(startSec);
        document.getElementById('trimEndLabel').textContent = this._fmtTime(endSec);
        document.getElementById('trimDurationLabel').textContent = trimDur.toFixed(1) + '秒';

        // 预览跳转到起始位置
        var player = document.getElementById('trimVideoPlayer');
        if (player.readyState >= 1) {
            player.currentTime = startSec;
        }
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
            this.showToast('视频处理完成，已关联到提示词', 'success');
            await this.loadPrompts();
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

    async removeThumbnail() {
        if (!this._thumbnailPromptId) return;
        var data = await this.fetchJSON('/api/thumbnails/assign/' + this._thumbnailPromptId, { method: 'DELETE' });
        if (data) {
            document.getElementById('modalThumbnail').style.display = 'none';
            this.showToast('缩略图已移除', 'info');
            await this.loadPrompts();
        }
    },

    // ============ 原图查看器（滚轮缩放 + 拖拽移动） ============

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

        // 滚轮缩放：以鼠标位置为中心
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



    // ============ 视频查看器（逐帧控制） ============

    openVideoViewer(videoFilename, posterFilename, promptId) {
        var modal = document.getElementById('modalVideoViewer');
        var player = document.getElementById('vidViewerPlayer');
        var seek = document.getElementById('vidViewerSeek');
        var timeLabel = document.getElementById('vidViewerTime');
        var playBtn = document.getElementById('vidPlayBtn');

        player.src = '/api/thumbnails/video/' + videoFilename;
        player.poster = '/api/thumbnails/file/' + posterFilename;
        player.load();
        modal.style.display = 'flex';

        // 渲染右侧详情面板
        this._renderViewerRight('vidViewer', promptId);

        // 重置
        seek.value = 0;
        timeLabel.textContent = '00:00.0 / 00:00.0';
        playBtn.innerHTML = '▶';

        function closeVid() {
            player.pause();
            player.currentTime = 0;
            player.src = '';
            modal.style.display = 'none';
            player.ontimeupdate = null;
            // 移除事件监听器（避免叠加）
            seek.removeEventListener('input', seekHandler);
            seek.removeEventListener('change', seekHandler);
            document.onkeydown = null;
        }

        document.getElementById('vidViewerClose').onclick = closeVid;
        modal.onclick = function(e) {
            if (e.target === modal) closeVid();
        };

        // 预加载全部数据以便快速定位
        player.preload = 'auto';
        player.onclick = function(e) { e.preventDefault(); };
        var seekThrottle = null;

        function seekHandler(e) {
            if (player.duration <= 0) return;
            App._updateVidTime(player, seek, timeLabel);
            if (e.type === 'input') {
                player.pause();
                if (!seekThrottle) {
                    seekThrottle = setTimeout(function() {
                        seekThrottle = null;
                        var t = (parseFloat(seek.value) / 1000) * player.duration;
                        player.currentTime = t;
                    }, 120);
                }
            } else {
                if (seekThrottle) { clearTimeout(seekThrottle); seekThrottle = null; }
                var t = (parseFloat(seek.value) / 1000) * player.duration;
                player.currentTime = t;
            }
        }

        seek.addEventListener('input', seekHandler);
        seek.addEventListener('change', seekHandler);

        // 播放中同步更新时

        // 播放中同步更新时间轴
        player.ontimeupdate = function() {
            if (player.duration > 0 && player.seeking) return;
            if (player.duration > 0) {
                var pct = (player.currentTime / player.duration) * 1000;
                seek.value = Math.round(pct);
                App._updateVidTime(player, seek, timeLabel);
            }
        };

        // 播放/暂停按钮更新
        player.onplay = function() { playBtn.innerHTML = '⏸'; };
        player.onpause = function() { playBtn.innerHTML = '▶'; };

        // Esc 关闭
        document.onkeydown = function(e) {
            if (e.key === 'Escape') closeVid();
        };
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

    seekVideo(seconds) {
        var player = document.getElementById('vidViewerPlayer');
        var seek = document.getElementById('vidViewerSeek');
        var timeLabel = document.getElementById('vidViewerTime');
        if (player.duration <= 0) return;
        var newTime = Math.max(0, Math.min(player.duration, (player.currentTime || 0) + seconds));
        player.currentTime = newTime;
        var pct = (newTime / player.duration) * 1000;
        seek.value = Math.round(pct);
        this._updateVidTime(player, seek, timeLabel);
    },    // 查看器收藏徽标：双击跳转到收藏分组
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
            var ch = '<div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">收藏分组：</div>';
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
    _escape(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
};

// ============ 启动 ============
document.addEventListener('DOMContentLoaded', () => App.init());
