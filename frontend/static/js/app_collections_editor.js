/**
 * PromptKit — app_collections 模块分片 (editor)
 * 自 app_collections.js 拆分（Phase 3.5-P2），方法经 this 互访，片间共享 App 状态
 */
(function() {
'use strict';
Object.assign(App, {

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
        // Phase17.4: 统一走 batch-trash API（兼容 word_card + prompt_cards + prompts 三表）
        try {
            var res = await fetch('/api/v2/trash/batch-trash', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_ids: [pid] })
            });
            var data = await res.json();
            if (data.ok && data.trashed > 0) {
                this.showToast(App._t('auto.str_8d6e3b74', '已移入回收站'), 'info');
                this.loadPrompts();
            } else if (data.detail) {
                this.showToast(data.detail, 'error');
            } else {
                this.showToast('提示词不存在', 'error');
            }
        } catch(e) {
            this.showToast(App._t('common.op_failed', '操作未完成，稍后再试: ') + e.message, 'error');
        }
    },

    // Phase17.3: 批量操作后统一清理编辑模式状态
    _afterBatchOp() {
        this.state.batchSelected.clear();
        var eb = document.getElementById('batchBar');
        if (eb) eb.style.display = 'none';
        this.state.editMode = false;
        var btn = document.getElementById('btnEditMode');
        if (btn) { btn.style.color = '#94a3b8'; btn.classList.remove('active'); }
        try { localStorage.removeItem('promptkit_editmode'); } catch(e) {}
    },

});
})();
