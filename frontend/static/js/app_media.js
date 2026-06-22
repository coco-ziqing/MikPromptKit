/**
 * PromptKit — app_media 模块
 * 缩略图管理, 编辑弹窗缩略图管理, 图库/视频库批量操作
 * 自动生成 — 勿手动编辑
 */
(function() {
'use strict';
Object.assign(App, {
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
            name.textContent = App._t('auto.str_f2fb3010', '视频: ') + this._editVideoFilename;
            document.getElementById('editClearThumbBtn').style.display = 'inline-block';
        } else if (this._editThumbFilename) {
            preview.innerHTML = '<img src="/api/thumbnails/file/' + this._editThumbFilename + '" style="width:120px;height:80px;object-fit:cover;">';
            name.textContent = this._editThumbFilename;
            document.getElementById('editClearThumbBtn').style.display = 'inline-block';
        } else {
            preview.innerHTML = '<span style="font-size:24px;color:#cbd5e1;">🖼</span>';
            name.textContent = App._t('auto.str_fe2d26a2', '未设置');
            document.getElementById('editClearThumbBtn').style.display = 'none';
        }
    },

    clearEditThumbnail() {
        this._editThumbFilename = null;
        this._editVideoFilename = null;
        this._editThumbnailCleared = this._editHadThumbOriginal;
        this.updateEditThumbDisplay();
    },

    async clearCardThumbnail(promptId) {
        if (!confirm(App._t('common.confirm', '确认清除此提示词的缩略图？'))) return;
        var data = await this.fetchJSON('/api/thumbnails/assign/' + promptId, { method: 'DELETE' });
        if (data && data.ok) {
            this.showToast(App._t('auto.str_00cadfcb', '缩略图已清除'), 'info');
            await this.loadPrompts();
        } else {
            this.showToast(App._t('auto.str_cd6849ea', '清除失败'), 'error');
        }
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
        if (!confirm(App._t('common.confirm', '确认删除缩略图文件「') + filename + '」?')) return;
        var data = await this.fetchJSON('/api/thumbnails/file/' + filename, { method: 'DELETE' });
        if (data) {
            this.showToast(App._t('auto.str_5cc23262', '已删除'), 'success');
            this.loadThumbLibrary();
        }
    },

    async deleteSingleVideo(filename) {
        if (!confirm(App._t('common.confirm', '确认删除视频文件「') + filename + '」?')) return;
        var data = await this.fetchJSON('/api/thumbnails/video-file/' + filename, { method: 'DELETE' });
        if (data) {
            this.showToast(App._t('auto.str_5cc23262', '已删除'), 'success');
            this.loadVideoLibrary();
        }
    },

    async batchDeleteThumbItems() {
        var filenames = Object.keys(this._thumbBatchSelected);
        if (filenames.length === 0) {
            this.showToast(App._t('auto.please_选择文件', '请先选择文件'), 'info');
            return;
        }
        if (!confirm(App._t('common.confirm', '确认删除选中的 ') + filenames.length + ' 个文件?此操作不可恢复!')) return;
        var tab = this._thumbnailTab;
        var ep = tab === 'videos' ? '/api/thumbnails/batch-delete-videos' : '/api/thumbnails/batch-delete-thumbnails';
        var data = await this.fetchJSON(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filenames: filenames })
        });
        if (data) {
            this.showToast(App._t('auto.str_023f5967', '已删除 ') + data.deleted_count + App._t('auto.str_7c645c81', ' 个文件'), 'success');
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
                    this.showToast(App._t('nav.collections', '收藏夹缩略图已设置'), 'success');
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
            this.showToast(App._t('auto.str_7a1f2937', '视频已关联'), 'success');
            await this.loadPrompts();
        } else {
            this.showToast(App._t('auto.str_6d973dbe', '关联失败'), 'error');
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
                        this.showToast(App._t('auto.str_412d7881', '已跳过重复图片'), 'info');
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
                            this.showToast(App._t('auto.upload_成功', '上传成功'), 'success');
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
                this.showToast(App._t('auto.upload_失败__', '上传失败: ') + file.name, 'error');
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
                this.showToast(file.name + App._t('auto.str_0619e1fc', ' 上传失败'), 'error');
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
        document.getElementById('trimDurationLabel').textContent = (endSec - startSec).toFixed(1) + App._t('auto.str_0c1fec65', '秒');
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
            this.showToast(App._t('auto.str_e23ed266', '视频处理完成,已关联到提示词'), 'success');
        } else {
            this.showToast(App._t('auto.str_1012e098', '处理失败'), 'error');
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
                this.showToast(App._t('nav.collections', '收藏夹缩略图已设置'), 'success');
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
            this.showToast(App._t('auto.str_b519a039', '缩略图已设置'), 'success');
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
        var moduleNames = {emotion:'人物表情',color:App._t('auto.str_67a7c94b', '场景色彩'),tone:'画面色调',composition:App._t('auto.str_bec46210', '构图运镜'),seedance:'Seedance'};
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
        if (c && c !== '-') { App.copyText(c,App._t('common.notice', '提示词已复制'));
            var pid = parseInt(el.getAttribute('data-prompt-id'));
            if (pid) App.trackUsage(pid); }
    },

    copyVidViewerContent() {
        var el = document.getElementById('vidViewerContent');
        if (!el) return;
        var c = el.getAttribute('data-content') || el.textContent;
        if (c && c !== '-') { App.copyText(c,App._t('common.notice', '提示词已复制'));
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

});
})();
