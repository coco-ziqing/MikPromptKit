/**
 * PromptKit — app_collections 模块分片 (collections)
 * 自 app_collections.js 拆分（Phase 3.5-P2），方法经 this 互访，片间共享 App 状态
 */
(function() {
'use strict';
Object.assign(App, {

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
        if (!badge) return;
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
        // 编辑模式下：确保 batchBar 按钮按收藏夹规则更新
        if (this.state.editMode) this.updateBatchCount();
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
        if (typeof App._initCollectionSort === 'function') {
            setTimeout(function() { App._initCollectionSort(); }, 100);
        }
    },

    renderCollectionItems() {
        const container = document.getElementById('collectionItemList');
        const items = this.state.collectionItems;
        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>分组为空</p></div>';
            return;
        }
        var isEdit = this.state.editMode;
        var batchClass = isEdit ? 'batch-mode' : '';
        var editClass = isEdit ? 'edit-mode' : '';
        let html = '<div class="prompt-grid">';
        for (const p of items) {
            const tags = JSON.parse(p.tags || '[]');
            const tagHtml = tags.map(t => `<span class="card-badge">${this._escape(t)}</span>`).join('');
            var colls = p.collections || [];
            var collHtml = '';
            for (var ci = 0; ci < colls.length; ci++) {
                var cc = colls[ci];
                collHtml += '<span class="coll-badge" ondblclick="App.switchView(\'collections\');App.openCollection(' + cc.id + ')" oncontextmenu="event.preventDefault();event.stopPropagation();App._showCollBadgeMenu(event,' + cc.id + ',' + p.id + ')" title="双击进入「' + this._escape(cc.name) + '」收藏分组 | 右键移除">' + (cc.icon || '⭐') + '</span>';
            }
            const isSelected = this.state.batchSelected.has(p.id);
            const selectedClass = isSelected ? 'selected' : '';
            // 统一视频字段 + word_card 检测
            var videoFile2 = p.video_filename || (/^(mp4|webm|mov|avi|mkv|m4v|ogv|mts|m2ts)$/i.test((p.preview_media || '').split('.').pop()) ? p.preview_media : '') || '';
            var isWordCard = p._source === 'word_card';
            html += `
                <div class="prompt-card ${batchClass} ${selectedClass} ${editClass}" data-id="${p.id}" draggable="true">
                    <div class="card-body">
                        <div class="card-thumb">
                            <div class="card-thumb-inner" onclick="${isEdit ? 'event.stopPropagation();App.toggleSelect(' + p.id + ')' : ''}">
                                ${videoFile2
                                    ? `<div class="thumb-video-wrap-preview">`
                                      + (p.thumbnail
                                          ? `<img class="thumb-video-poster" src="/api/thumbnails/file/${p.thumbnail}" alt="" loading="lazy">`
                                          : `<div class="thumb-placeholder thumb-video-placeholder"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21"/></svg></div>`)
                                      + `<div class="thumb-play-overlay"><svg viewBox="0 0 24 24"><polygon points="8,5 19,12 8,19"/></svg></div>`
                                      + `<video class="thumb-video" src="/api/thumbnails/video/${videoFile2}" loop muted playsinline preload="none"></video>`
                                      + `</div>`
                                    : (p.thumbnail
                                        ? `<img src="/api/thumbnails/file/${p.thumbnail}" alt="缩略图">`
                                        : `<div class="thumb-placeholder">
                                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                                          </div>`
                                      )
                                }
                            </div>
                            ${(p.thumbnail || videoFile2) && isEdit ? '<span class="thumb-clear-btn" onclick="event.stopPropagation();App.clearCardThumbnail(' + p.id + ')" title="清除缩略图">✕</span>' : ''}
                            ${(p.thumbnail || videoFile2) ? '<span class="thumb-zoom-btn" onclick="event.stopPropagation();' + (videoFile2 ? 'App.openCardVideoViewer(\'' + p.id + '\', \'' + videoFile2 + '\', \'' + (p.thumbnail || '') + '\', \'' + (p.video_fps || '') + '\')' : 'App.openCardImageViewer(\'' + p.id + '\', \'' + (p.original_ref || p.thumbnail) + '\')') + '" title="' + (videoFile2 ? '查看原视频' : '查看原图') + '">' + (videoFile2 ? '▶' : '🔍') + '</span>' : ''}
                        </div>
                        <div class="card-add-row">
                            <span class="coll-add-btn" onclick="event.stopPropagation();App.quickCollect(${p.id}, this)" title="添加到收藏分组">+</span>
                            ${(p.thumbnail || videoFile2) ? '<span class="coll-add-btn" onclick="event.stopPropagation();App._downloadPreview(\'' + (videoFile2 ? 'video' : 'image') + '\', \'' + (p.original_ref || p.thumbnail || '') + '\', \'' + (videoFile2 || '') + '\', \'' + (p.content || '').replace(/'/g,"\\'").substring(0,12) + '\')" title="下载' + (videoFile2 ? '视频' : '原图') + '到本地" style="background:rgba(34,197,94,0.1);color:#22c55e;">⬇</span>' : ''}
                            <span class="card-tier-group" style="display:inline-flex;gap:2px;align-items:center;margin-left:2px;" onclick="event.stopPropagation()">
                                <span class="coll-add-btn card-tier-btn" data-tier="simple" data-pid="${p.id}" onclick="App._switchCardTier(${p.id},'simple',this)" title="精简档" style="font-size:9px;padding:0 4px;">📄</span>
                                <span class="coll-add-btn card-tier-btn" data-tier="detailed" data-pid="${p.id}" onclick="App._switchCardTier(${p.id},'detailed',this)" title="详细档" style="font-size:9px;padding:0 4px;">📚</span>
                            </span>
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
                            <div class="card-content" id="cc_${p.id}">${this._escape(App._cardDisplayContent ? App._cardDisplayContent(p) : p.content)}</div>
                            ${p.meaning ? `<div class="card-meaning">${this._escape(p.meaning)}</div>` : ''}
                            ${p.scene ? `<div class="card-scene">🎯 ${this._escape(p.scene)}</div>` : ''}
                            <div style="font-size:10px;color:#cbd5e1;margin-bottom:6px;">${tagHtml}</div>
                            <div class="card-actions">
                                <span style="font-size:11px;color:#94a3b8;">使用 ${p.usage_count} 次</span>
                                <div style="display:flex;gap:4px;align-items:center;margin-left:auto;">
                                <button class="btn-copy" onclick="App.toggleTranslation(${p.id})" title="中英文翻译" style="border-color:${App._transBtnStyle ? App._transBtnStyle(p.id,'color') : 'var(--primary)'};color:${App._transBtnStyle ? App._transBtnStyle(p.id,'color') : 'var(--primary)'};">${App._transBtnLabel ? App._transBtnLabel(p) : '🌐'}</button>
                                ${isEdit ? '<button class="btn-copy" style="border-color:#8b5cf6;color:#8b5cf6;" onclick="event.stopPropagation();App._wcShowMovePicker(' + p.id + ')" title="移动到其他分组">📦</button>' : ''}
                                ${isEdit ? '<button class="btn-copy" style="border-color:#eab308;color:#eab308;" onclick="App.openEditModal(' + p.id + ')" title="编辑词卡内容">✏</button>' : ''}
                                <button class="btn-copy" onclick="App.handleCopyLang(${p.id})" title="复制当前语言提示词">📋</button>
                                ${isEdit ? '<button class="btn-copy" style="border-color:#ef4444;color:#ef4444;" onclick="App.removeFromCollection(' + this.state.currentCollection + ', ' + p.id + ')" title="移出收藏分组">🗑</button>' : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                    `;
        }
        html += '</div>';
        container.innerHTML = html;
        App.applyColumns();
        if (typeof this._initCardTierBtns === 'function') this._initCardTierBtns();
        if (typeof this.bindVideoHover === 'function') this.bindVideoHover();
    },

    async removeFromCollection(cid, pid) {
        await this.fetchJSON(`/api/v2/collections/${cid}/items/${pid}`, { method: 'DELETE' });
        this.showToast('已移除', 'info');
        await this.loadCollections();
        await this.loadCollectionItems();
    },

    _showCollBadgeMenu(e, cid, pid) {
        this._closeCollBadgeMenu();
        var menu = document.createElement('div');
        menu.id = 'collBadgeCtxMenu';
        menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:4px 0;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.2);';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.innerHTML = '<div class="coll-ctx-item" onclick="App.removeFromCollection(' + cid + ',' + pid + ');App._closeCollBadgeMenu()" style="padding:8px 16px;cursor:pointer;font-size:13px;color:var(--danger,#ef4444);">🗑 移除此收藏分组</div>';
        document.body.appendChild(menu);
        setTimeout(function(){ document.addEventListener('click', App._closeCollBadgeMenu, { once: true }); }, 0);
    },

    _closeCollBadgeMenu() {
        var m = document.getElementById('collBadgeCtxMenu');
        if (m) m.remove();
    },

    backToCollections() {
        // 退出编辑模式
        if (this.state.editMode) {
            this.state.editMode = false;
            this.state.batchSelected.clear();
            var eb = document.getElementById('batchBar');
            var fb = document.getElementById('editFilterBar');
            if (eb) eb.style.display = 'none';
            if (fb) fb.style.display = 'none';
            var btn = document.getElementById('btnEditMode');
            if (btn) { btn.style.color = '#94a3b8'; btn.classList.remove('active'); }
            try { localStorage.removeItem('promptkit_editmode'); } catch(e) {}
        }
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
            // 刷新查看器右侧收藏勾选列表（使用 _refreshViewerPanels 兼容 prompts/word_card 双源）
            if (typeof this._refreshViewerPanels === 'function') this._refreshViewerPanels();
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

    // ============ 生成引擎授权中心（即梦/LibTV 登录·切换·退出） ============

    // 打开授权中心
});
})();
