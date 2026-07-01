/**
 * PromptKit — app_collections 模块
 * 收藏夹, 自定义词包, 最近使用
 * 自动生成 — 勿手动编辑
 */
(function() {
'use strict';
Object.assign(App, {
    // ============ 回收站相关 ============

    openAddPromptModal() {
        document.getElementById('editPromptTitle').textContent = App._t('common.new', '新建提示词');
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
            category: document.getElementById('editCategory').value.trim() || App._t('auto.custom_', '自定义'),
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
            this.showToast(App._t('common.new', '新建成功'), 'success');
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

    _showDeleteConfirm(message, deleteBtn) {
        // 移除已有确认框避免重复
        document.querySelectorAll('.confirm-modal').forEach(function(el){el.remove()});

        // 计算停靠位置
        var modal = document.createElement('div');
        modal.className = 'confirm-modal';
        this._pendingDeleteId = this._pendingDeleteId;  // 保留已有ID

        if (deleteBtn && typeof deleteBtn.getBoundingClientRect === 'function') {
            var rect = deleteBtn.getBoundingClientRect();
            var left;
            // 优先停靠在按钮右侧，空间不足则左侧
            if (rect.right + 310 < window.innerWidth) {
                left = rect.right + 6;
            } else {
                left = Math.max(6, rect.left - 266);
            }
            modal.style.left = left + 'px';
            modal.style.top = (rect.bottom + 4) + 'px';
        }

        modal.innerHTML = '<div class="confirm-content">' +
            '<p class="confirm-msg">' + this._escape(message) + '</p>' +
            '<div class="confirm-btns">' +
            '<button class="btn-cancel">取消</button>' +
            '<button class="btn-confirm">删除</button>' +
            '</div></div>';

        document.body.appendChild(modal);

        // 绑定事件
        var self = this;
        modal.querySelector('.btn-cancel').onclick = function(e) {
            e.stopPropagation();
            self._closeDeleteConfirm();
        };
        modal.querySelector('.btn-confirm').onclick = function(e) {
            e.stopPropagation();
            self._processDeleteConfirm();
        };

        // ESC 关闭
        this._confirmKeyHandler = function(e) {
            if (e.key === 'Escape') { self._closeDeleteConfirm(); }
        };
        document.addEventListener('keydown', this._confirmKeyHandler);

        // 点击外部关闭（延迟绑定避免立即触发）
        var self2 = this;
        setTimeout(function() {
            self2._confirmClickHandler = function(e) {
                var m = document.querySelector('.confirm-modal');
                if (m && !m.contains(e.target)) { self2._closeDeleteConfirm(); }
            };
            document.addEventListener('click', self2._confirmClickHandler);
        }, 50);
    },

    _closeDeleteConfirm() {
        document.querySelectorAll('.confirm-modal').forEach(function(el){el.remove()});
        if (this._confirmKeyHandler) {
            document.removeEventListener('keydown', this._confirmKeyHandler);
            this._confirmKeyHandler = null;
        }
        if (this._confirmClickHandler) {
            document.removeEventListener('click', this._confirmClickHandler);
            this._confirmClickHandler = null;
        }
        this._pendingDeleteId = null;
        this._pendingDeleteCallback = null;
    },

    async trashPrompt(promptId, deleteBtn) {
        this._pendingDeleteId = promptId;
        this._pendingDeleteCallback = null;  // 清除编辑弹窗残留回调
        if (!deleteBtn && window.matchMedia('(max-width: 768px)').matches) {
            // 移动端: 原生 confirm
            if (!confirm(App._t('common.confirm', '确认将此词条移入回收站？'))) return;
            await this._doTrashDelete(promptId);
            return;
        }
        if (!deleteBtn) {
            // 无按钮引用: 降级到原生 confirm
            if (!confirm(App._t('common.confirm', '确认将此词条移入回收站？'))) return;
            await this._doTrashDelete(promptId);
            return;
        }
        this._showDeleteConfirm(App._t('common.confirm', '确认将此词条移入回收站？'), deleteBtn);
    },

    async _processDeleteConfirm() {
        var pid = this._pendingDeleteId;
        var cb = this._pendingDeleteCallback;
        this._closeDeleteConfirm();
        if (!pid) return;
        if (cb) {
            // 编辑弹窗等定制删除回调
            await cb(pid);
            return;
        }
        await this._doTrashDelete(pid);
    },

    async _doTrashDelete(pid) {
        try {
            var res = await fetch('/api/prompts/' + pid, { method: 'DELETE' });
            var data = await res.json();
            if (data.trashed) {
                this.showToast(App._t('auto.str_8d6e3b74', '已移入回收站'), 'info');
                this.loadPrompts();
            } else if (data.detail) {
                this.showToast(data.detail, 'error');
            }
        } catch(e) {
            this.showToast(App._t('common.op_failed', '操作失败: ') + e.message, 'error');
        }
    },

    async batchTrash() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择词条', '请先选择词条'), 'error'); return; }
        if (!confirm(App._t('common.confirm', '确认将选中的 ') + ids.length + ' 个词条移入回收站？')) return;
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

    async batchGenerateThumbnails() {
        var ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择词条', '请先选择词条'), 'error'); return; }
        if (!confirm(App._t('common.confirm', '确认对 ') + ids.length + ' 条词条批量生成缩略图？\n注意：每张图需等待 ComfyUI 生成完成，耗时较长。')) return;

        var cfg = await this.fetchJSON('/api/v2/comfyui/config');
        if (!cfg || !cfg.config || !cfg.config.enabled) {
            this.showToast(App._t('auto.str_5f57664b', 'ComfyUI 未启用，请先配置'), 'warning');
            this.openComfyConfig();
            return;
        }

        this.showToast('⏳ 正在批量生成 ' + ids.length + ' 张缩略图...', 'info');
        var bar = document.getElementById('batchBar');
        if (bar) bar.style.opacity = '0.5';

        var success = 0, errors = 0;
        try {
            var resp = await fetch('/api/v2/comfyui/batch-generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt_ids: ids,
                    workflow_id: cfg.config.active_workflow || ''
                })
            });
            if (!resp.ok) { this.showToast(App._t('auto.str_01b40748', '批处理请求失败'), 'error'); return; }

            var reader = resp.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';
            while (true) {
                var chunk = await reader.read();
                if (chunk.done) break;
                buffer += decoder.decode(chunk.value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (var li = 0; li < lines.length; li++) {
                    var line = lines[li].trim();
                    if (!line || !line.startsWith('data: ')) continue;
                    try {
                        var ev = JSON.parse(line.substring(6));
                        if (ev.complete) {
                            success = ev.success || 0;
                            errors = ev.errors || 0;
                        } else if (ev.done) {
                            this.showToast('(' + ev.done + '/' + ev.total + ') ' + (ev.ok ? '✅ 完成' : '❌ ' + (ev.error || App._t('common.failed', '失败'))), ev.ok ? 'success' : 'error');
                        }
                    } catch(e) {}
                }
            }
            this.showToast('✅ 批量生成完成: ' + success + ' 成功, ' + errors + App._t('auto.str_f73d0c19', ' 失败'), errors > 0 ? 'warning' : 'success');
            await this.loadPrompts();
        } catch(e) {
            this.showToast('批量生成异常: ' + e.message, 'error');
        }
        if (bar) bar.style.opacity = '1';
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
                            <span style="font-size:22px;flex-shrink:0;">${c.icon || '⭐'}</span>
                            <div class="card-name">${this._escape(c.name)}</div>
                            <div class="card-count">${c.item_count} 条</div>
                        </div>
                        ${thumbHtml}
                    </div>
                    <div class="card-actions">
                        <button class="card-action-btn" onclick="event.stopPropagation();App.setCollectionThumbnail(${c.id})" title=App._t('auto.settings_缩略图', '设置缩略图')>🖼</button>
                        <button class="card-action-btn" onclick="event.stopPropagation();App.copyCollection(${c.id})" title=App._t('common.copy', '复制分组')>📋</button>
                        <button class="card-action-btn" onclick="event.stopPropagation();App.deleteCollection(${c.id})" title=App._t('common.delete', '删除分组')>🗑</button>
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
            var colls = p.collections || [];
            var collHtml = '';
            for (var ci = 0; ci < colls.length; ci++) {
                var cc = colls[ci];
                collHtml += '<span class="coll-badge" ondblclick="App.switchView(\'collections\');App.openCollection(' + cc.id + ')" title="双击进入「' + this._escape(cc.name) + '」收藏分组">' + (cc.icon || '⭐') + '</span>';
            }
            const isSelected = this.state.batchSelected.has(p.id);
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
                            ${p.thumbnail ? '<span class="thumb-zoom-btn" onclick="event.stopPropagation();' + (p.video_filename ? 'App.openVideoViewer(\'' + p.video_filename + '\', \'' + p.thumbnail + '\', \'' + p.id + '\', \'' + (p.video_fps || '') + '\')' : 'App.openImageViewer(\'' + (p.original_ref || p.thumbnail) + '\', \'' + p.id + '\')') + '" title="' + (p.video_filename ? '查看原视频' : '查看原图') + '">' + (p.video_filename ? '▶' : '🔍') + '</span>' : ''}
                        </div>
                        <div class="card-add-row">
                            <span class="coll-add-btn" onclick="event.stopPropagation();App.quickCollect(${p.id}, this)" title="添加到收藏分组">+</span>
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
                                <button class="btn-copy" onclick="App.trackUsage(${p.id});App.copyText('${this._escape(p.content).replace(/'/g, "\\'")}')">📋 复制</button>
                                <button class="btn-copy" style="border-color:#ef4444;color:#ef4444;" onclick="App.removeFromCollection(${this.state.currentCollection}, ${p.id})">移除</button>
                            </div>
                        </div>
                    </div>
                </div>
                    `;
        }
        html += '</div>';
        container.innerHTML = html;
        if (typeof this.bindVideoHover === 'function') this.bindVideoHover();
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

    // ============ 语言切换（双向中英 + 手动切换显示）============
    async toggleTranslation(promptId) {
        var el = document.getElementById('cc_' + promptId);
        if (!el) { this.showToast('卡片元素未找到，请刷新', 'error'); return; }
        // 优先读 _cardLang（切换分组后 DOM 丢失，_cardLang 存活）
        var currentLang = (this.state._cardLang && this.state._cardLang[promptId]) || el.getAttribute('data-lang') || 'original';
        var cardData = this._findCardData(promptId);
        var original = cardData ? cardData.content : (el.getAttribute('data-original') || el.textContent);
        var zh = cardData ? (cardData.content_zh || '') : '';
        var en = cardData ? (cardData.content_en || '') : '';
        var isCN = /[\u4e00-\u9fff]/.test(original);

        if (currentLang === 'original') {
            // 原文→翻译：如果原文中文且有英文翻译 → 显示英文；原文英文且有中文翻译 → 显示中文
            if (isCN && en) { this._setCardLang(el, promptId, 'en', en, original); }
            else if (!isCN && zh) { this._setCardLang(el, promptId, 'zh', zh, original); }
            else { await this._doTranslateCard(el, promptId, original, isCN ? 'en' : 'zh'); }
        } else if (currentLang === 'zh') {
            // 当前显示中文翻译 → 切到英文或原文
            if (en) { this._setCardLang(el, promptId, 'en', en, original); }
            else { this._setCardLang(el, promptId, 'original', original, original); }
        } else if (currentLang === 'en') {
            // 当前显示英文翻译 → 切到中文或原文
            if (zh) { this._setCardLang(el, promptId, 'zh', zh, original); }
            else { this._setCardLang(el, promptId, 'original', original, original); }
        }
        this._updateTranslateBtn(promptId);
    },

    _setCardLang(el, promptId, lang, text, original) {
        if (!el.getAttribute('data-original')) el.setAttribute('data-original', original);
        el.setAttribute('data-lang', lang);
        el.textContent = text;
        if (!this.state._cardLang) this.state._cardLang = {};
        this.state._cardLang[promptId] = lang;
    },

    async _doTranslateCard(el, promptId, original, targetLang) {
        el.innerHTML = original + '<div class="card-translation" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-color);color:#6366f1;font-size:13px;">翻译中...</div>';
        try {
            var data = await this.fetchJSON('/api/translate/' + promptId + '?target_lang=' + targetLang);
            if (data && data.ok && data.translated && data.translated !== data.original) {
                var card = this._findCardData(promptId);
                if (card) { if (targetLang === 'zh') card.content_zh = data.translated; else card.content_en = data.translated; }
                this._setCardLang(el, promptId, targetLang, data.translated, original);
                this.showToast('翻译完成(' + (targetLang === 'zh' ? '英→中' : '中→英') + ')', 'success');
            } else if (data && data.note) {
                el.innerHTML = App._escape(original); this.showToast(data.note, 'info');
            } else {
                el.innerHTML = App._escape(original); this.showToast('翻译失败: ' + (data ? (data.error || '未知') : '服务未响应'), 'error');
            }
        } catch(e) { el.innerHTML = App._escape(original); this.showToast('翻译失败: ' + e.message, 'error'); }
    },

    _findCardData(pid) { var ps = this.state.prompts || []; for (var i = 0; i < ps.length; i++) { if (ps[i].id === pid) return ps[i]; } return null; },

    getCardDisplayContent(promptId) {
        var card = this._findCardData(promptId); if (!card) return null;
        var lang = (this.state._cardLang && this.state._cardLang[promptId]) || 'original';
        if (lang === 'zh' && card.content_zh) return { text: card.content_zh, lang: 'zh' };
        if (lang === 'en' && card.content_en) return { text: card.content_en, lang: 'en' };
        return { text: card.content, lang: 'original' };
    },

    // 复制当前语言版本（语言感知复制）
    handleCopyLang(promptId) {
        var card = this._findCardData(promptId);
        if (!card) { this.showToast('卡片数据未加载', 'error'); return; }
        var result = this.getCardDisplayContent(promptId);
        var content = result ? result.text : card.content;
        this.copyText(content);
        this.trackUsage(promptId);
        var langLabel = result && result.lang !== 'original' ? (' (' + result.lang + ')') : '';
        this.showToast('已复制' + langLabel, 'success');
        // 推荐面板
        this.showRecommend(promptId);
    },

    _updateTranslateBtn(promptId) {
        var cards = document.querySelectorAll('#promptList .prompt-card');
        cards.forEach(function(card) {
            if (parseInt(card.getAttribute('data-id')) !== promptId) return;
            var btn = card.querySelector('.btn-copy[onclick*="toggleTranslation"]');
            if (!btn) return;
            var contentEl = card.querySelector('.card-content');
            var rawText = contentEl ? (contentEl.getAttribute('data-original') || contentEl.textContent) : '';
            var isCN = /[\u4e00-\u9fff]/.test(rawText);
            var lang = (App.state._cardLang && App.state._cardLang[promptId]) || 'original';
            // 辨当前实际显示语言 → 按钮显示对立面（点击后切到哪个语言）
            var currentDisplay = lang === 'zh' ? 'zh' : (lang === 'en' ? 'en' : (isCN ? 'zh' : 'en'));
            btn.textContent = currentDisplay === 'zh' ? '🌐 英文' : '🌐 中文';
            btn.style.color = lang !== 'original' ? '#22c55e' : '#6366f1';
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
                if (self.state.editMode && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                    card.classList.add('drag-over');
                    var overlay = document.getElementById('dropOverlay');
                    if (overlay) overlay.style.display = 'none';
                }
            }, false);

            card.addEventListener('dragleave', function(e) {
                if (!self.state.editMode)
                if (!self.state.editMode) { card.classList.remove('drag-over'); return; }
                var rect = card.getBoundingClientRect();
                var x = e.clientX, y = e.clientY;
                if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
                    card.classList.remove('drag-over');
                }
            }, false);

            // drop 由 document 级监听器统一处理（_initDropZone），卡片不单独拦截
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
                this.showToast(App._t('auto.upload_失败__', '上传失败: ') + (data ? data.error : App._t('common.unknown_error', '未知错误')), 'error');
                return;
            }
            // 关联到提示词
            var assignRes = await this.fetchJSON('/api/thumbnails/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: promptId, filename: data.filename })
            });
            if (assignRes && assignRes.ok) {
                this.showToast(App._t('auto.str_30f20f2d', '✅ 图片已关联到提示词'), 'success');
                await this.loadPrompts();
                await this.loadThumbLibrary();
            } else {
                this.showToast(App._t('auto.str_6d973dbe', '关联失败'), 'error');
            }
        } catch(e) {
            this.showToast(App._t('auto.upload_失败__', '上传失败: ') + e.message, 'error');
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
                this.showToast(App._t('auto.upload_失败__', '上传失败: ') + (data ? data.error : App._t('common.unknown_error', '未知错误')), 'error');
                return;
            }
            // 关联到提示词
            var assignRes = await this.fetchJSON('/api/thumbnails/assign-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: promptId, video_filename: data.filename })
            });
            if (assignRes && assignRes.ok) {
                this.showToast(App._t('auto.str_ec86f555', '✅ 视频已关联到提示词'), 'success');
                await this.loadPrompts();
                await this.loadThumbLibrary();
            } else {
                this.showToast(App._t('auto.str_6d973dbe', '关联失败'), 'error');
            }
        } catch(e) {
            this.showToast(App._t('auto.upload_失败__', '上传失败: ') + e.message, 'error');
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
        var name = c ? c.name : App._t('auto.str_c392d4c7', '此收藏分组');
        if (!confirm(App._t('common.confirm', '确认删除「') + name + '」?分组内的词条不会被删除,仅移除分组关联。')) return;
        await this.fetchJSON(`/api/v2/collections/${cid}`, { method: 'DELETE' });
        this.showToast(App._t('auto.str_5cc23262', '已删除'), 'info');
        await this.loadCollections();
        this.renderCollections();
    },

    async copyCollection(cid) {
        var data = await this.fetchJSON('/api/v2/collections/' + cid + '/copy', { method: 'POST' });
        if (data) {
            this.showToast(App._t('common.copied', '已复制为「') + data.name + '」', 'success');
            await this.loadCollections();
            this.renderCollections();
            // 自动打开编辑弹窗,允许修改名称
            var newColl = this.state.collections.find(function(x) { return x.id === data.id; });
            if (newColl) {
                document.getElementById('inputCollectionName').value = data.name;
                document.getElementById('inputCollectionIcon').value = newColl.icon || '⭐';
                App._pendingEditCollection = data.id;
                App._pendingEditRefresh = function() { App.loadCollections(); App.renderCollections(); };
                document.getElementById('modalCreateCollection').querySelector('h5').textContent = App._t('auto.str_f67e2dbb', '重命名分组');
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
        if (!confirm(App._t('common.ok', '确定删除此词包?'))) return;
        await this.fetchJSON(`/api/v2/wordpacks/${wid}`, { method: 'DELETE' });
        this.showToast(App._t('auto.str_5cc23262', '已删除'), 'info');
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
            this.showToast(App._t('common.export', '导出成功'), 'success');
        } catch (e) {
            this.showToast(App._t('common.export', '导出失败'), 'error');
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
        if (!name) { this.showToast(App._t('auto.enter_词包名称', '请输入词包名称'), 'error'); return; }
        const data = await this.fetchJSON('/api/v2/wordpacks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: desc })
        });
        if (data) {
            document.getElementById('modalCreateWordpack').style.display = 'none';
            this.showToast(App._t('nav.wordpacks', '词包已创建'), 'success');
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
        for (const card of data.items) {
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
        if (!confirm(App._t('common.ok', '确定清空所有使用记录?'))) return;
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
        try {
            var data = await this.fetchJSON('/api/v2/trash?page=' + this._trashPage + '&page_size=50');
            if (!data) { grid.innerHTML = '<div class="empty-state"><div class="icon">🗑️</div><p>回收站为空</p></div>'; return; }
            var html = '';
            if (data.items.length === 0) {
                html = '<div class="empty-state"><div class="icon">🗑️</div><p>回收站为空</p></div>';
            } else {
                html = '<div class="prompt-grid">';
                for (var i = 0; i < data.items.length; i++) {
                    var p = data.items[i];
                    var tags = [];
                    try { var parsed = JSON.parse(p.tags || '[]'); if (Array.isArray(parsed)) tags = parsed; } catch(e2) { tags = []; }
                    var tagHtml = tags.length ? tags.map(function(t) { return '<span class="card-badge">' + App._escape(typeof t === 'string' ? t : '') + '</span>'; }).join('') : '';
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
                    (p.is_builtin ? '<span style="font-size:11px;color:var(--text-muted);padding:4px 8px;">🔒 内置词条</span>' : '<button class="btn-copy" onclick="App.permanentDelete(' + p.id + ')" style="border-color:#ef4444;color:#ef4444;">🗑 永久删除</button>') +
                    '</div></div></div></div>';
            }
            html += '</div>';
        }
        grid.innerHTML = html;
        // 绑定视频悬停播放
        if (typeof this.bindVideoHover === 'function') this.bindVideoHover();
        // _onDropPng 已由 _initDropZone 统一管理（viewHomeScroll 容器），此处不再重复绑定

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
        } catch(e) {
            console.warn('loadTrash error:', e);
            grid.innerHTML = '<div class="empty-state"><div class="icon">🗑️</div><p>加载回收站失败: ' + (e.message || App._t('common.unknown_error', '未知错误')) + '</p></div>';
        }
    },

    async restoreFromTrash(pid) {
        await this.fetchJSON('/api/v2/trash/' + pid + '/restore', { method: 'POST' });
        this.showToast(App._t('auto.str_b70e8e43', '已恢复'), 'success');
        this.loadTrash();
        this.loadPrompts();
    },

    async restoreAllTrash() {
        if (!confirm(App._t('common.confirm', '确认全部恢复？'))) return;
        var data = await this.fetchJSON('/api/v2/trash?page_size=500');
        if (!data || data.items.length === 0) return;
        var ids = data.items.map(function(p) { return p.id; });
        await this.fetchJSON('/api/v2/trash/batch-restore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        this.showToast(App._t('auto.str_0d88a16f', '已全部恢复'), 'success');
        this.loadTrash();
        this.loadPrompts();
    },

    async permanentDelete(pid) {
        if (!confirm(App._t('auto.str_3e79ede2', '永久删除后无法恢复，确认删除？'))) return;
        try {
            this.showToast('删除中...', 'info');
            var res = await fetch('/api/v2/trash/' + pid, { method: 'DELETE' });
            if (!res.ok) {
                var errData = null;
                try { errData = await res.json(); } catch(_) {}
                var errMsg = (errData && errData.detail) || '删除失败（HTTP ' + res.status + '）';
                // 内置词条不可永久删除，提示恢复
                if (res.status === 403) {
                    errMsg = '内置词条不可永久删除，请使用「恢复」按钮还原';
                }
                this.showToast(errMsg, 'danger');
                return;
            }
            this.showToast(App._t('auto.str_968c6dbf', '已永久删除'), 'info');
            this.loadTrash();
        } catch(e) {
            this.showToast('删除失败: ' + (e.message || '网络错误'), 'danger');
        }
    },

    async emptyTrash() {
        if (!confirm(App._t('common.confirm', '确认清空回收站？所有词条将被永久删除！'))) return;
        await this.fetchJSON('/api/v2/trash/empty', { method: 'POST' });
        this.showToast(App._t('nav.trash', '回收站已清空'), 'info');
        this.loadTrash();
    },

    // ============ 一键收藏(下拉菜单) ============

    // 将提示词移动到其他功能模块
    async movePromptToModule(promptId, newModule) {
        if (!newModule) return;
        var self = this;
        var p = this.state.prompts.find(function(x) { return x.id === promptId; });
        if (!p) { self.showToast(App._t('common.notice', '提示词不存在'), 'error'); return; }
        if (p.module === newModule) { return; }

        // 发送 PUT 请求更新模块（v4 API: prompt_cards 表，仅传 module 避免触发版本存档）
        var result = await this.fetchJSON('/api/v4/cards/' + promptId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                module: newModule
            })
        });

        if (result && result.ok) {
            p.module = newModule;
            self.showToast('已移动到 ' + (this.state.modules.find(function(m) { return m.id === newModule; })?.name || newModule), 'success');
            // 如果当前模块视图过滤中，移出显示
            if (this.state.currentModule && this.state.currentModule !== newModule) {
                var idx = self.state.prompts.indexOf(p);
                if (idx >= 0) self.state.prompts.splice(idx, 1);
                self.renderPrompts();
            } else {
                self.renderPrompts();
            }
            // 刷新侧边栏统计
            this.loadModules();
            this.loadStats();
        } else {
            self.showToast('移动失败: ' + (result ? result.error : App._t('common.unknown_error', '未知错误')), 'error');
        }
    },

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
            this.showToast(App._t('auto.str_718b33fc', '已收藏到「') + cname + '」', 'success');
            await this.loadCollections();
            await this.loadPrompts();  // 刷新卡片显示收藏图标
            // 如果当前在收藏夹内，刷新收藏夹词条列表
            if (this.state.currentView === 'collections' && this.state.currentCollection) {
                await this.loadCollectionItems();
            }
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
        if (!name) { this.showToast(App._t('auto.enter_分组名称', '请输入分组名称'), 'error'); return; }

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
                this.showToast(App._t('auto.str_8b8d4db3', '分组已更新'), 'success');
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
                this.showToast(App._t('auto.str_cae20b1f', '已收藏到「${name}」'), 'success');
                if (this.state.currentView === 'home') this.loadPrompts();
                if (this.state.currentView === 'collections' && this.state.currentCollection) this.loadCollectionItems();
            } else {
                this.showToast('收藏分组已创建', 'success');
                if (this.state.currentView === 'home') this.loadPrompts();
            }
        }
    },

    // ============ 更新卡片上的收藏徽标 ============
    // 不再需要下拉刷新,因为收藏通过 +popover 操作后调用 loadPrompts 全量刷新

});
})();
