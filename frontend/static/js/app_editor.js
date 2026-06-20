/**
 * PromptKit — app_editor 模块
 * 编辑模式, 渲染:侧边栏, 自定义模块管理
 * 自动生成 — 勿手动编辑
 */
(function() {
'use strict';
Object.assign(App, {
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
        // 编辑弹窗内删除: 使用停靠式确认框（停靠在编辑弹窗的删除按钮旁）
        var delBtn = document.getElementById('editDeleteBtn');
        if (delBtn) {
            this._pendingDeleteId = pid;
            this._pendingDeleteCallback = this._doDeleteFromEditor.bind(this);
            this._showDeleteConfirm('确定删除此提示词？', delBtn);
        } else {
            if (!confirm('确定删除此提示词?')) return;
            await this._doDeleteFromEditor(pid);
        }
    },

    async _doDeleteFromEditor(pid) {
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
        if (!sidebar) return;
        var modules = this.state.modules || [];
        if (modules.length === 0) return;
        var editClass = this.state.editMode ? '' : 'style="display:none;"';
        var html = '<div style="padding:8px 20px 10px;color:#64748b;font-size:11px;letter-spacing:1px;display:flex;align-items:center;justify-content:space-between;">' +
            '<span>功能模块</span>' +
            '<div ' + editClass + ' style="display:flex;gap:4px;">' +
            '<button class="header-btn-sm" onclick="App.showCreateModuleModal()" title="新建分组" style="font-size:13px;padding:2px 6px;">+</button>' +
            '</div></div>';
        var allActive = this.state.currentModule === null ? 'active' : '';
        html += '<div class="module-item ' + allActive + '" onclick="App.switchAllModules()">' +
            '<span class="icon">📚</span>' +
            '<span>全部词库</span>' +
            '<span class="count-badge">' + (this.state.stats.total_prompts || '') + '</span>' +
            '</div>';
        var icons = { emotion: '😊', color: '🎨', tone: '💡', storyboard: '📋', camera_move: '🎥', seedance: '🎬' };
        var names = { emotion: '人物表情', color: '场景色彩', tone: '画面色调', storyboard: '分镜构图', composition: '分镜构图', camera_move: '运镜模版', seedance: '视频模版' };
        for (var i = 0; i < modules.length; i++) {
            var m = modules[i];
            if (m.id === 'seedance') continue;
            var active = m.id === this.state.currentModule ? 'active' : '';
            var clickHandler = "App.switchModule('" + m.id + "')";
            var deleteBtn = '';
            if (!m.builtin && this.state.editMode) {
                deleteBtn = '<button class="header-btn-sm" onclick="event.stopPropagation();App.deleteCustomModule(\'' + m.id + '\')" title="删除分组" style="font-size:11px;color:#ef4444;padding:0 4px;opacity:0.6;">x</button>';
            }
            html += '<div class="module-item ' + active + '" onclick="' + clickHandler + '">' +
                '<span class="icon">' + (icons[m.id] || '📄') + '</span>' +
                '<span>' + (names[m.id] || m.id) + '</span>' +
                '<span class="count-badge">' + (m.count || 0) + '</span>' +
                deleteBtn +
                '</div>';
        }
        sidebar.innerHTML = html;
        App._injectSidebarToggle(sidebar);
        if (this.state.editMode) {
            sidebar.innerHTML += '<div style="margin-top:auto;padding:12px;border-top:1px solid #334155;display:flex;gap:6px;flex-wrap:wrap;">' +
                '<button onclick="App.showImportModal()" style="flex:1;padding:6px 8px;background:transparent;border:1px solid #475569;border-radius:6px;color:#94a3b8;cursor:pointer;font-size:11px;"><i class="bi bi-upload"></i> 导入</button>' +
                '<button onclick="App.showExportModal()" style="flex:1;padding:6px 8px;background:transparent;border:1px solid #475569;border-radius:6px;color:#94a3b8;cursor:pointer;font-size:11px;"><i class="bi bi-download"></i> 导出</button></div>';
        }
    },

    // ============ 自定义模块管理 ============

    showCreateModuleModal() {
        document.getElementById('inputModuleName').value = '';
        document.getElementById('modalCreateModule').style.display = 'flex';
    },

    async createCustomModule() {
        var name = document.getElementById('inputModuleName').value.trim();
        if (!name) { App.showToast('请输入分组名称', 'error'); return; }
        var key = 'custom_' + name.replace(/[^a-z0-9_一-鿿]/gi, '_').substring(0, 30);
        try {
            var resp = await fetch('/api/v4/word-cards/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, group_key: key, icon: '📂', description: '自定义模块: ' + name })
            });
            if (resp.ok) {
                document.getElementById('modalCreateModule').style.display = 'none';
                App.showToast('分组\u300C' + name + '\u300D已创建', 'success');
                App.loadModules();
            } else {
                var detail = '';
                try { var ej = await resp.json(); detail = ej.detail || ej.error || JSON.stringify(ej); } catch(e) {}
                if (resp.status === 409) {
                    App.showToast('分组名称已存在，请换一个', 'warning');
                } else {
                    App.showToast('创建失败: ' + (detail || 'HTTP ' + resp.status), 'error');
                }
            }
        } catch(e) {
            console.error('[createCustomModule]', e);
            App.showToast('创建出错: ' + e.message, 'error');
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
            // coll-add-btn 已移动到 card-thumb 底部右下角

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
                            ${p.thumbnail && App.state.editMode ? '<span class="thumb-clear-btn" onclick="event.stopPropagation();App.clearCardThumbnail(' + p.id + ')" title="清除缩略图">✕</span>' : ''}
                            ${p.thumbnail ? '<span class="thumb-zoom-btn" onclick="event.stopPropagation();' + (p.video_filename ? 'App.openVideoViewer(\'' + p.video_filename + '\', \'' + p.thumbnail + '\', \'' + p.id + '\', \'' + (p.video_fps || '') + '\')' : 'App.openImageViewer(\'' + p.thumbnail + '\', \'' + p.id + '\')') + '" title="' + (p.video_filename ? '查看原视频' : '查看原图') + '">' + (p.video_filename ? '▶' : '🔍') + '</span>' : ''}
                        </div>
                        <div class="card-add-row">
                            <span class="coll-add-btn" onclick="event.stopPropagation();App.quickCollect(${p.id}, this)" title="添加到收藏分组">+</span>
                            ${App.state.editMode ? `
                            <select class="card-module-move" onchange="App.movePromptToModule(${p.id}, this.value)" title="移动到其他模块" style="font-size:10px;padding:1px 4px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-muted);cursor:pointer;max-width:76px;">
                                <option value="">📦 移动</option>
                                ${App.state.modules.filter(function(m) { return m.id !== p.module; }).map(function(m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('')}
                            </select>
                            ` : ''}
                            <div class="card-collections">
                                <div class="card-checkbox">
                                    <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="App.toggleSelect(${p.id})">
                                </div>
                                ${collHtml}
                            </div>
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
                                ${App.state.editMode ? '<button class="btn-copy" style="border-color:#ef4444;color:#ef4444;" onclick="App.trashPrompt(' + p.id + ', this)">🗑 删除</button>' : ''}
                            </div>
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
        // 活跃项目编辑高亮
        var editingTplIds = {};
        if (App.seedanceV2 && App.seedanceV2.projects) {
            for (var pi = 0; pi < App.seedanceV2.projects.length; pi++) {
                var proj = App.seedanceV2.projects[pi];
                if (proj.template_id) editingTplIds[proj.template_id] = proj;
            }
        }
        let html = '<div class="prompt-grid">';
        for (const tpl of items) {
            const preview = tpl.content.length > 150 ? tpl.content.substring(0, 150) + '...' : tpl.content;
            const previewHtml = preview.replace(/\n/g, '<br>');
            let tags = [];
            try { tags = JSON.parse(tpl.tags); } catch(e) {}
            var isEditing = editingTplIds[tpl.id];
            var extraStyle = isEditing ? 'border-left: 3px solid #7c3aed;' : '';
            var editBadge = isEditing ? '<span style="color:#7c3aed;font-size:10px;">✏️ 编辑中</span>' : '';
            html += `
                <div class="prompt-card" style="${extraStyle}">
                    <span class="card-badge">${this._escape(tpl.category)}</span>
                    <div style="font-size:11px;color:#64748b;margin-bottom:6px;">${this._escape(tpl.meaning)}</div>
                    <div class="card-content" style="font-size:12px;line-height:1.4;">${previewHtml}</div>
                    <div style="font-size:10px;color:#94a3b8;margin-bottom:6px;">${tags.map(t=>'#'+this._escape(t)).join(' ')} ${editBadge}</div>
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
        if (tab === 'composer' && App.seedanceV2 && !App.seedanceV2._skipSwitchInit) {
            App.seedanceV2.init();
        }
    },

    async openInComposer(tplId) {
        var d = await this.fetchJSON('/api/seedance/templates/' + tplId);
        if (!d || !d.template) { this.showToast('模板数据加载失败', 'error'); return; }
        var tpl = d.template;
        var tplCategory = tpl.category || 'Seedance';
        var tplMeaning = tpl.meaning || '';

        // 禁止 switchSeedanceTab 触发额外 init
        if (App.seedanceV2) App.seedanceV2._skipSwitchInit = true;
        this.switchSeedanceTab('composer');
        if (App.seedanceV2) App.seedanceV2._skipSwitchInit = false;

        if (!App.seedanceV2) { this.showToast('组装器未加载', 'warning'); return; }

        await App.seedanceV2.init();

        // 调用智能导入端点
        var importResp = await this.fetchJSON('/api/seedance/v2/import-from-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: tplId })
        });

        if (!importResp || !importResp.ok) {
            this.showToast('智能导入失败: ' + (importResp ? importResp.detail : '无响应'), 'error');
            return;
        }

        await App.seedanceV2.loadProjects();
        App.seedanceV2.renderProjectList();
        await App.seedanceV2.openProject(importResp.project_id);

        var shotCount = importResp.scene_count || 0;
        var populated = importResp.fields_populated || 0;
        var msg = '模板「' + (tplMeaning.substring(0, 15) || tplCategory) + '」已智能导入';
        if (shotCount > 1) msg += '，拆分为 ' + shotCount + ' 个镜头';
        if (populated > 0) msg += '，' + populated + ' 个镜头已自动填充词卡';
        App.showToast(msg, 'success');
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
        try { if (e.currentTarget) e.currentTarget.style.outline = ''; } catch(ee) {}
        var files = e.dataTransfer.files;
        if (!files || files.length === 0) return;
        // 取第一个 PNG 文件走 handleDropPngFile（统一使用 modalDropImport 确认弹窗）
        for (var fi = 0; fi < files.length; fi++) {
            if (files[fi].type === 'image/png' || files[fi].name.toLowerCase().endsWith('.png')) {
                App.handleDropPngFile(files[fi]);
                return;
            }
        }
        App.showToast('请拖拽 PNG 文件', 'error');
    },

    // --- 全局拖拽导入（编辑模式显示PNG覆盖层，非编辑模式支持JSON/.pt/PNG） ---
    // 缩略图替换撤销状态 {promptId: oldFilename}
    _undoThumbnailState: {},

    async _replaceAndSaveUndo(file, promptId) {
        // 1. 保存当前缩略图以便 Ctrl+Z 恢复
        var p = this.state.prompts.find(function(x) { return x.id === promptId; });
        if (p && p.thumbnail) {
            this._undoThumbnailState[promptId] = p.thumbnail;
        } else {
            // 无旧缩略图则存空标记
            this._undoThumbnailState[promptId] = null;
        }

        // 2. 上传新图片
        var formData = new FormData();
        formData.append('file', file);
        try {
            var res = await fetch('/api/thumbnails/upload', { method: 'POST', body: formData });
            var data = await res.json();
            if (!data || !data.ok) {
                this.showToast('上传失败: ' + (data ? data.error : '未知错误'), 'error');
                return;
            }
            // 3. 关联到提示词
            var assignRes = await this.fetchJSON('/api/thumbnails/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: promptId, filename: data.filename })
            });
            if (assignRes && assignRes.ok) {
                this.showToast('✅ 缩略图已替换 (Ctrl+Z 可撤销)', 'success');
                await this.loadPrompts();
                await this.loadThumbLibrary();
            } else {
                this.showToast('关联失败', 'error');
            }
        } catch(e) {
            this.showToast('上传失败: ' + e.message, 'error');
        }
    },

    async _undoThumbnailReplace(promptId) {
        var oldFilename = this._undoThumbnailState[promptId];
        if (oldFilename === undefined) return;

        if (oldFilename === null) {
            // 原本无缩略图 → 清除
            await this.fetchJSON('/api/thumbnails/assign/' + promptId, { method: 'DELETE' });
        } else {
            // 恢复旧缩略图
            var assignRes = await this.fetchJSON('/api/thumbnails/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: promptId, filename: oldFilename })
            });
            if (!assignRes || !assignRes.ok) {
                this.showToast('撤销失败', 'error');
                return;
            }
        }
        delete this._undoThumbnailState[promptId];
        this.showToast('↩ 缩略图已恢复', 'success');
        await this.loadPrompts();
        await this.loadThumbLibrary();
    },

    _initDropZone: function() {
        // document 级 dragover + drop 是唯一入口，避免多级监听冲突
        document.addEventListener('dragover', function(e) { e.preventDefault(); });

        document.addEventListener('drop', function(e) {
            e.preventDefault();
            var files = e.dataTransfer.files;
            if (!files || files.length === 0) return;

            var ssModal = document.getElementById('modalScreenshotImport');

            // 截图导入弹窗打开时 → 转发图片
            if (ssModal && ssModal.style.display !== 'none') {
                for (var fi = 0; fi < files.length; fi++) {
                    if (files[fi].type.startsWith('image/')) {
                        App._processSSFile(files[fi]); return;
                    }
                }
                return;
            }

            // 编辑模式下拖到缩略图区域 → 替换缩略图（可 Ctrl+Z 撤销）
            if (App.state.editMode && e.target.closest && e.target.closest('.card-thumb-inner')) {
                var card = e.target.closest('.prompt-card');
                var promptId = card ? parseInt(card.getAttribute('data-id')) : 0;
                if (promptId && files[0]) {
                    var name = files[0].name.toLowerCase();
                    if (name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || name.endsWith('.avi')) {
                        App._dropUploadVideo(files[0], promptId);
                    } else {
                        App._replaceAndSaveUndo(files[0], promptId);
                    }
                }
                return;
            }

            // 页面空白区域拖入导入（编辑/非编辑模式均支持）
            for (var fi = 0; fi < files.length; fi++) {
                var name = files[fi].name.toLowerCase();
                if (name.endsWith('.json')) { App._handleDropFile(files[fi]); return; }
                if (name.endsWith('.pt')) { App._handleDropPtFile(files[fi]); return; }
                if (name.endsWith('.png') || files[fi].type === 'image/png') { App.handleDropPngFile(files[fi]); return; }
            }
        });
        this._dropAttached = true;
    },

    // --- 卡片拖拽防护 ---// --- 卡片拖拽防护 ---// --- 卡片拖拽防护 ---


    _escape(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    },
    // ============ 侧边栏折叠 ============
    _injectSidebarToggle(sidebar) {
        // Remove existing toggle from both sidebar and body
        var old = document.querySelector('.sidebar-toggle-btn');
        if (old) old.remove();
        // Create toggle button as body child (independent of sidebar)
        var btn = document.createElement('div');
        btn.className = 'sidebar-toggle-btn';
        btn.id = 'sidebarToggleBtn';
        btn.title = '折叠/展开模块列表';
        btn.innerHTML = '\u25C0';
        btn.addEventListener('click', function(e) { e.stopPropagation(); App.toggleSidebarCollapse(); });
        document.body.appendChild(btn);
        // Restore state
        App._restoreSidebarState();
    },

    toggleSidebarCollapse() {
        var sidebar = document.getElementById('sidebar');
        var btn = document.getElementById('sidebarToggleBtn');
        if (!sidebar || !btn) return;
        var collapsed = !sidebar.classList.contains('collapsed');
        if (collapsed) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            btn.innerHTML = '\u25B6';
            btn.title = '展开模块列表';
        } else {
            sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
            btn.innerHTML = '\u25C0';
            btn.title = '折叠模块列表';
        }
        try { localStorage.setItem('promptkit_sidebar_collapsed', collapsed ? '1' : '0'); } catch(e) {}
    },

    _restoreSidebarState() {
        var sidebar = document.getElementById('sidebar');
        var btn = document.getElementById('sidebarToggleBtn');
        if (!sidebar || !btn) return;
        try {
            var saved = localStorage.getItem('promptkit_sidebar_collapsed');
            if (saved === '1') {
                sidebar.classList.add('collapsed');
                document.body.classList.add('sidebar-collapsed');
                btn.innerHTML = '\u25B6';
                btn.title = '展开模块列表';
            }
        } catch(e) {}
    },

    // 从后端 /api/status 同步版本号到页面标题
    _syncVersion() {
        var self = this;
        fetch('/api/status').then(function(r){return r.json();}).then(function(d){
            var v = d.version || '4.0.0';
            // 仅保留主版本号 (如 v4.0.0-phase9.3 → v4.0.0)
            v = v.split('-')[0];
            var brand = document.querySelector('.brand small');
            if (brand) brand.textContent = v;
        }).catch(function(){});
    }
});
})();
