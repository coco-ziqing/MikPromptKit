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
            var isCollView = this.state.currentView === 'collections' && !!this.state.currentCollection;
            this._afterBatchOp();
            if (isCollView) {
                this.loadCollections();
                this.loadCollectionItems();
            } else {
                this.loadPrompts();
            }
        }
    },

    async batchGenerateThumbnails() {
        var ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择词条', '请先选择词条'), 'error'); return; }
        this._batchIds = ids;
        this._openBatchGenDialog();
    },

    // ============ AI 批量生成配置弹窗 ============

    _openBatchGenDialog() {
        var self = this;
        var overlay = document.getElementById('batchGenDialog');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'batchGenDialog';
            overlay.className = 'modal-overlay';
            overlay.style.cssText = 'display:none;z-index:760;';
            overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };
            overlay.innerHTML =
            '<style>' +
              '.bgen-btn{font-size:11px;padding:4px 10px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-muted);cursor:pointer;}' +
              '.bgen-btn:hover{border-color:var(--primary);color:var(--primary);}' +
              '.bgen-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;font-size:11px;border:1px solid var(--border-color);}' +
            '</style>' +
            '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:720px;max-height:88vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
              '<div class="modal-header" style="padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
                '<h5 style="margin:0;font-size:14px;"><i class="bi bi-magic"></i> AI 批量生成缩略图 <span id="bgenCount" style="font-size:11px;color:var(--text-muted);"></span></h5>' +
                '<button class="header-btn-sm" onclick="document.getElementById(\'batchGenDialog\').style.display=\'none\'">&times;</button>' +
              '</div>' +
              '<div class="modal-body" style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:12px;">' +
                // 选中卡预览
                '<div id="bgenPreview" style="border:1px solid var(--border-color);border-radius:10px;padding:8px 10px;max-height:96px;overflow-y:auto;"></div>' +
                // 生成引擎切换
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
                  '<span style="font-size:12px;font-weight:600;">生成引擎</span>' +
                  '<span style="display:flex;gap:2px;border:1px solid var(--border-color);border-radius:8px;padding:2px;">' +
                    '<button id="bgenEngineComfy" class="cwl-logview-btn active" onclick="App._batchEngine(\'comfyui\')" title="本地 ComfyUI 工作流生成"><i class="bi bi-cpu"></i> ComfyUI</button>' +
                    '<button id="bgenEngineDreamina" class="cwl-logview-btn" onclick="App._batchEngine(\'dreamina\')" title="即梦 AI 在线生成"><i class="bi bi-stars"></i> 即梦</button>' +
                    '<button id="bgenEngineLibtv" class="cwl-logview-btn" onclick="App._batchEngine(\'libtv\')" title="LibTV 在线生成"><i class="bi bi-collection"></i> LibTV</button>' +
                  '</span>' +
                  '<span id="bgenDreaminaStatus" style="font-size:10px;color:var(--text-muted);"></span>' +
                  '<button class="bgen-btn" onclick="App.openEngineAuth()" title="管理即梦/LibTV 授权账号" style="margin-left:auto;border-color:var(--primary);color:var(--primary);"><i class="bi bi-key"></i> 授权中心</button>' +
                '</div>' +
                // 即梦参数区
                '<div id="bgenDreaminaArea" style="display:none;border:1px solid #6366f1;border-radius:10px;padding:8px 10px;margin-bottom:10px;">' +
                  '<div style="font-size:12px;font-weight:600;margin-bottom:6px;"><i class="bi bi-stars"></i> 即梦参数 <span style="font-size:10px;color:var(--text-muted);font-weight:400;">在线生成，秒级出图</span></div>' +
                  '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
                    '<label style="font-size:10px;color:var(--text-muted);">模型版本 <select id="bgenDreaminaModel" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="3.0">3.0</option><option value="3.1">3.1</option><option value="4.0">4.0</option><option value="4.1">4.1</option><option value="4.5">4.5</option><option value="4.6">4.6</option><option value="4.7">4.7</option><option value="5.0" selected>5.0</option><option value="5.0Pro">5.0Pro</option>' +
                    '</select></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);">比例 <select id="bgenDreaminaRatio" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="21:9">21:9</option><option value="16:9">16:9</option><option value="3:2">3:2</option><option value="4:3">4:3</option><option value="1:1" selected>1:1</option><option value="3:4">3:4</option><option value="2:3">2:3</option><option value="9:16">9:16</option>' +
                    '</select></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);">分辨率 <select id="bgenDreaminaRes" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="1k">1k</option><option value="2k" selected>2k</option><option value="4k">4k</option>' +
                    '</select></label>' +
                  '</div>' +
                '</div>' +
                // LibTV 参数区
                '<div id="bgenLibtvArea" style="display:none;border:1px solid #8b5cf6;border-radius:10px;padding:8px 10px;margin-bottom:10px;">' +
                  '<div style="font-size:12px;font-weight:600;margin-bottom:6px;"><i class="bi bi-collection"></i> LibTV 参数 <span style="font-size:10px;color:var(--text-muted);font-weight:400;">在线生成，免费模型免积分</span></div>' +
                  '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
                    '<label style="font-size:10px;color:var(--text-muted);">画布 <select id="bgenLibtvProject" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);min-width:140px;"><option value="">加载中...</option></select></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);">模型 <select id="bgenLibtvModel" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);min-width:160px;"><option value="">加载中...</option></select></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);">比例 <select id="bgenLibtvRatio" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="1:1" selected>1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="21:9">21:9</option>' +
                    '</select></label>' +
                  '</div>' +
                  '<div id="bgenLibtvStatus" style="font-size:10px;color:var(--text-muted);margin-top:6px;"></div>' +
                '</div>' +
                // ComfyUI 模式区域（工作流选择 + 参数预设）
                '<div id="bgenComfyArea">' +
                // 工作流选择（可视化双视图：缩略图卡片 / 详细信息）
                '<div style="font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;"><i class="bi bi-diagram-3"></i> 生成工作流 <span id="bgenWfHint" style="font-size:10px;color:var(--text-muted);font-weight:400;"></span>' +
                  '<span style="margin-left:auto;display:flex;gap:2px;border:1px solid var(--border-color);border-radius:8px;padding:2px;">' +
                    '<button id="bgenWfViewGrid" class="cwl-logview-btn" onclick="App._batchWfView(\'grid\')" title="缩略图卡片模式"><i class="bi bi-grid-3x3-gap"></i> 卡片</button>' +
                    '<button id="bgenWfViewList" class="cwl-logview-btn" onclick="App._batchWfView(\'list\')" title="详细信息模式"><i class="bi bi-list-ul"></i> 详情</button>' +
                  '</span>' +
                '</div>' +
                '<div id="bgenWfGrid" style="display:none;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px;"></div>' +
                '<div id="bgenWfList" style="display:none;flex-direction:column;gap:5px;"></div>' +
                // 工作流信息卡
                '<div id="bgenWfInfo" style="border:1px dashed var(--border-color);border-radius:10px;padding:8px 10px;display:none;font-size:10px;color:var(--text-muted);line-height:1.7;"></div>' +
                // 参数预设
                '<div id="bgenPresetArea" style="display:none;">' +
                  '<div style="font-size:12px;font-weight:600;margin-bottom:4px;"><i class="bi bi-sliders"></i> 参数预设</div>' +
                  '<div id="bgenPresetBar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"></div>' +
                  '<div id="bgenSizeQuick" style="display:none;border:1px dashed #6366f1;border-radius:8px;padding:8px 10px;margin-bottom:8px;"></div>' +
                  '<div id="bgenPresetForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;"></div>' +
                '</div>' +
                '</div>' +   // bgenComfyArea 结束

                // 提示词组合
                '<div id="bgenCompose" style="border:1px solid var(--border-color);border-radius:10px;padding:8px 10px;">' +
                  '<div style="font-size:12px;font-weight:600;margin-bottom:6px;"><i class="bi bi-fonts"></i> 提示词组合 <span style="font-size:10px;color:var(--text-muted);font-weight:400;">词卡内容 + 模块预设 + 品质后缀 → 注入工作流正面提示词</span></div>' +
                  // Ollama 优化工具条
                  '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;padding:6px 8px;border:1px dashed #10b981;border-radius:8px;background:rgba(16,185,129,0.04);">' +
                    '<span style="font-size:11px;font-weight:600;">✨ Ollama 优化</span>' +
                    '<span id="bgenOllamaStatus" style="font-size:10px;color:var(--text-muted);">检测中...</span>' +
                    '<select id="bgenOllamaModel" onchange="App._saveOllamaBar()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);min-width:120px;"><option value="">选择模型</option></select>' +
                    '<select id="bgenOllamaLang" onchange="App._saveOllamaBar()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="en">English</option>' +
                      '<option value="zh">中文</option>' +
                    '</select>' +
                    '<button type="button" class="bgen-btn" id="bgenOllamaBtn" onclick="App._enhanceBatchPrompts()" style="border-color:#10b981;color:#10b981;"><i class="bi bi-magic"></i> 优化选中卡提示词</button>' +
                    '<span id="bgenOllamaHint" style="font-size:10px;color:var(--text-muted);"></span>' +
                  '</div>' +
                  '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">' +
                    '<label style="font-size:10px;color:var(--text-muted);">品质后缀 <input id="bgenSuffix" value="cinematic lighting, high quality, 4k, detailed" oninput="App._renderBatchComposePreview()" style="width:220px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);" title="留空则不添加后缀"></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:4px;"><input type="checkbox" id="bgenUsePreset" checked onchange="App._renderBatchComposePreview()" style="width:14px;height:14px;"> 叠加模块主体预设</label>' +
                  '</div>' +
                  '<div style="margin-bottom:6px;">' +
                    '<label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px;">手动附加文本 <span style="color:#94a3b8;">（追加到每条组合提示词末尾，如风格/视角/负面词）</span></label>' +
                    '<textarea id="bgenManualText" rows="2" placeholder="例如：low-angle upward view, volumetric lighting, masterpiece" oninput="App._renderBatchComposePreview()" style="width:100%;font-size:11px;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);resize:vertical;"></textarea>' +
                  '</div>' +
                  '<div id="bgenComposePreview" style="font-size:10px;color:var(--text-muted);background:var(--bg-card);border:1px dashed var(--border-color);border-radius:6px;padding:6px 8px;max-height:64px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;"></div>' +
                '</div>' +
                // 进度与明细
                '<div id="bgenProgressArea" style="display:none;">' +
                  '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
                    '<span style="font-size:11px;color:var(--text-muted);" id="bgenProgressText">准备中...</span>' +
                    '<span style="margin-left:auto;display:flex;gap:6px;">' +
                      '<button class="bgen-btn" id="bgenRetryBtn" onclick="App._retryBatchFailed()" style="border-color:#f59e0b;color:#f59e0b;display:none;"><i class="bi bi-arrow-repeat"></i> 重试失败</button>' +
                      '<button class="bgen-btn" id="bgenCancelBtn" onclick="App._cancelBatchGen()" style="border-color:#ef4444;color:#ef4444;"><i class="bi bi-x-circle"></i> 取消</button>' +
                    '</span>' +
                  '</div>' +
                  '<div style="height:8px;background:var(--border-color);border-radius:4px;overflow:hidden;margin-bottom:8px;">' +
                    '<div id="bgenProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#6366f1,#8b5cf6);transition:width .3s;"></div>' +
                  '</div>' +
                  '<div id="bgenDetail" style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;"></div>' +
                  // 完成缩略图网格
                  '<div id="bgenGrid" style="display:none;margin-top:8px;">' +
                    '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">生成结果（点击放大）：</div>' +
                    '<div id="bgenGridItems" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px;"></div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="modal-footer" style="padding:10px 16px;border-top:1px solid var(--border-color);display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-shrink:0;">' +
                '<span id="bgenFooterHint" style="margin-right:auto;font-size:10px;color:var(--text-muted);"></span>' +
                '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'batchGenDialog\').style.display=\'none\'">关闭</button>' +
                '<button class="btn btn-primary btn-sm" id="bgenStartBtn" onclick="App._startBatchGen()"><i class="bi bi-play-fill"></i> 开始生成</button>' +
              '</div>' +
            '</div>';
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
        // 重置任务状态（新打开弹窗；旧轮询检测到 _batchTaskId 置空后自动退出）
        this._batchGenRunning = false;
        this._batchTaskId = null;
        // 选中卡预览
        var cnt = document.getElementById('bgenCount');
        if (cnt) cnt.textContent = '（' + (this._batchIds || []).length + ' 张）';
        var pv = document.getElementById('bgenPreview');
        if (pv) {
            var cards = [];
            (this.state.prompts || []).forEach(function(p) {
                if (self._batchIds.indexOf(p.id) > -1 && cards.length < 8) cards.push(p);
            });
            var html = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">选中词条提示词预览：</div>';
            if (cards.length === 0) {
                html += '<div style="font-size:11px;color:var(--text-muted);">已选 ' + self._batchIds.length + ' 条</div>';
            }
            cards.forEach(function(p) {
                html += '<div style="font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-main);">· ' + App._escape((p.content || p.name || '').slice(0, 60)) + '</div>';
            });
            if (self._batchIds.length > 8) html += '<div style="font-size:10px;color:var(--text-muted);">…等共 ' + self._batchIds.length + ' 条</div>';
            pv.innerHTML = html;
        }
        // 加载工作流库（先恢复上次参数设置）
        this._restoreBatchSettings();
        this._loadBatchWorkflows();
        // 加载模块主体预设（供提示词组合预览）
        var self = this;
        this.fetchJSON('/api/v2/comfyui/module-presets').then(function(d) {
            if (d && d.ok) self._modulePresets = d.presets || {};
            self._renderBatchComposePreview();
        }).catch(function() { self._modulePresets = {}; self._renderBatchComposePreview(); });
        // Ollama 状态检测（模型列表/语言恢复）
        this._initOllamaBar();
        this._batchPromptOverrides = this._batchPromptOverrides || {};
    },

    // 提示词组合预览：模块预设 + 词卡 + 品质后缀 + 手动附加文本（复刻后端组合规则）
    _renderBatchComposePreview() {
        var el = document.getElementById('bgenComposePreview');
        if (!el) return;
        var self = this;
        var suffix = ((document.getElementById('bgenSuffix') || {}).value || '').trim();
        var manual = ((document.getElementById('bgenManualText') || {}).value || '').trim();
        var usePreset = !!(document.getElementById('bgenUsePreset') || {}).checked;
        var cards = [];
        (this.state.prompts || []).forEach(function(p) {
            if (self._batchIds.indexOf(p.id) > -1 && cards.length < 3) cards.push(p);
        });
        var lines = cards.map(function(p) {
            var preset = '';
            if (usePreset && self._modulePresets) {
                var pm = self._modulePresets[p.module] || {};
                if (pm.enabled && pm.preset) preset = pm.preset;
            }
            var cardText = p.content || '';
            var isOpt = false;
            if (self._batchPromptOverrides && self._batchPromptOverrides[p.id]) {
                cardText = self._batchPromptOverrides[p.id];
                isOpt = true;
            }
            var composed = App._composePromptPreview(preset, cardText, suffix);
            if (manual) composed = (composed ? composed.replace(/,\s*$/, '') + ', ' + manual : manual);
            return (isOpt ? '✨ ' : '') + composed;
        });
        if (lines.length === 0) {
            el.innerHTML = '<span style="color:var(--text-muted);">（无法预览，请确认已选中词条）</span>';
            return;
        }
        var html = lines.map(function(l) { return '· ' + App._escape(l); }).join('<br>');
        if ((self._batchIds || []).length > 3) html += '<br><span style="color:var(--text-muted);">…等共 ' + self._batchIds.length + ' 条（每条按各自模块预设组合）</span>';
        el.innerHTML = html;
    },

    // 生成引擎切换（ComfyUI / 即梦 / LibTV）
    _batchEngine(mode) {
        this._batchEngineMode = mode;
        var cb = document.getElementById('bgenEngineComfy');
        var db2 = document.getElementById('bgenEngineDreamina');
        var lb = document.getElementById('bgenEngineLibtv');
        if (cb) cb.className = 'cwl-logview-btn' + (mode === 'comfyui' ? ' active' : '');
        if (db2) db2.className = 'cwl-logview-btn' + (mode === 'dreamina' ? ' active' : '');
        if (lb) lb.className = 'cwl-logview-btn' + (mode === 'libtv' ? ' active' : '');
        var comfyArea = document.getElementById('bgenComfyArea');
        var dreaminaArea = document.getElementById('bgenDreaminaArea');
        var libtvArea = document.getElementById('bgenLibtvArea');
        if (comfyArea) comfyArea.style.display = mode === 'comfyui' ? 'block' : 'none';
        if (dreaminaArea) dreaminaArea.style.display = mode === 'dreamina' ? 'block' : 'none';
        if (libtvArea) libtvArea.style.display = mode === 'libtv' ? 'block' : 'none';
        if (mode === 'dreamina') this._initDreaminaStatus();
        if (mode === 'libtv') this._initLibtv();
        // 保存设置
        this._saveBatchSettings();
    },

    // LibTV 状态检测 + 画布/模型列表加载
    async _initLibtv() {
        var st = document.getElementById('bgenLibtvStatus');
        var projSel = document.getElementById('bgenLibtvProject');
        var modelSel = document.getElementById('bgenLibtvModel');
        if (!st) return;
        try {
            var d = await this.fetchJSON('/api/v2/libtv/status');
            if (!d || !d.ok) throw new Error('查询失败');
            if (!d.cli_available) {
                st.textContent = '○ CLI 未安装（点右上「授权中心」查看）';
                st.style.color = '#ef4444';
                st.style.cursor = 'pointer';
                st.onclick = function() { App.openEngineAuth(); };
                return;
            }
            if (!d.logged_in) {
                st.textContent = '○ 未授权（点右上「授权中心」一键登录）';
                st.style.color = '#f59e0b';
                st.style.cursor = 'pointer';
                st.onclick = function() { App.openEngineAuth(); };
                return;
            }
            st.textContent = '● 已登录';
            st.style.color = '#10b981';
            // 画布下拉
            if (projSel) {
                var ph = '';
                (d.projects || []).forEach(function(p) {
                    ph += '<option value="' + App._escape(p.uuid) + '">' + App._escape(p.name || '未命名') + '</option>';
                });
                projSel.innerHTML = ph || '<option value="">无可用画布</option>';
                // 恢复上次选择
                if (this._batchSavedSettings && this._batchSavedSettings() && this._batchSavedSettings().libtv_project) {
                    projSel.value = this._batchSavedSettings().libtv_project;
                }
                if (!projSel.value && d.projects && d.projects.length > 0) projSel.value = d.projects[0].uuid;
            }
            // 模型下拉（免费优先，付费标注）
            if (modelSel) {
                var mh = '';
                var models = d.models || [];
                var free = models.filter(function(m) { return m.free; });
                var paid = models.filter(function(m) { return !m.free; });
                free.concat(paid).forEach(function(m) {
                    mh += '<option value="' + App._escape(m.modelName) + '">' + App._escape(m.modelName) + (m.free ? ' 🆓' : ' 💎') + (m.estimatedTime ? ' · ' + m.estimatedTime : '') + '</option>';
                });
                modelSel.innerHTML = mh || '<option value="">无可用模型</option>';
                // 恢复上次选择
                if (this._batchSavedSettings && this._batchSavedSettings() && this._batchSavedSettings().libtv_model) {
                    modelSel.value = this._batchSavedSettings().libtv_model;
                }
                if (!modelSel.value) modelSel.value = d.default_model || '';
            }
        } catch(e) {
            st.textContent = '○ 状态检测失败';
            st.style.color = '#94a3b8';
        }
    },

    // 即梦状态检测（CLI 可用 + 登录）
    async _initDreaminaStatus() {
        var st = document.getElementById('bgenDreaminaStatus');
        if (!st) return;
        try {
            var d = await this.fetchJSON('/api/v2/dreamina/status');
            if (!d || !d.ok) throw new Error('查询失败');
            if (d.logged_in) {
                st.textContent = '● 已登录' + (d.vip_level ? ' · ' + d.vip_level : '');
                st.style.color = '#10b981';
            } else if (d.cli_available) {
                st.textContent = '○ 未授权（点右上「授权中心」一键登录）';
                st.style.color = '#f59e0b';
                st.style.cursor = 'pointer';
                st.onclick = function() { App.openEngineAuth(); };
            } else {
                st.textContent = '○ CLI 未安装（点右上「授权中心」查看）';
                st.style.color = '#ef4444';
                st.style.cursor = 'pointer';
                st.onclick = function() { App.openEngineAuth(); };
            }
        } catch(e) {
            st.textContent = '○ 状态检测失败';
            st.style.color = '#94a3b8';
        }
    },

    // Ollama 状态检测 + 模型列表 + 恢复配置
    async _initOllamaBar() {
        var statusEl = document.getElementById('bgenOllamaStatus');
        var modelSel = document.getElementById('bgenOllamaModel');
        if (!statusEl || !modelSel) return;
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/ollama/status');
            if (!d || !d.ok) throw new Error('查询失败');
            if (d.connected && d.models && d.models.length) {
                statusEl.textContent = '● 已连接';
                statusEl.style.color = '#10b981';
                var html = '<option value="">选择模型</option>';
                d.models.forEach(function(m) { html += '<option value="' + App._escape(m) + '">' + App._escape(m) + '</option>'; });
                modelSel.innerHTML = html;
                if (d.config && d.config.model) modelSel.value = d.config.model;
                var langSel = document.getElementById('bgenOllamaLang');
                if (langSel && d.config && d.config.language) langSel.value = d.config.language === 'zh' ? 'zh' : 'en';
                var btn = document.getElementById('bgenOllamaBtn');
                if (btn) btn.disabled = false;
            } else {
                statusEl.textContent = '○ 未连接（Ollama 未运行？）';
                statusEl.style.color = '#94a3b8';
                modelSel.innerHTML = '<option value="">Ollama 不可用</option>';
                var btn = document.getElementById('bgenOllamaBtn');
                if (btn) btn.disabled = true;
            }
        } catch(e) {
            statusEl.textContent = '○ 检测失败';
            statusEl.style.color = '#94a3b8';
        }
    },

    // 保存 Ollama 模型/语言选择
    async _saveOllamaBar() {
        var model = (document.getElementById('bgenOllamaModel') || {}).value || '';
        var lang = (document.getElementById('bgenOllamaLang') || {}).value || 'en';
        try {
            await this.fetchJSON('/api/v2/comfyui/ollama/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: model, language: lang })
            });
        } catch(e) {}
    },

    // 逐条通过 Ollama 优化选中卡提示词（中英文切换）
    async _enhanceBatchPrompts() {
        var model = (document.getElementById('bgenOllamaModel') || {}).value;
        if (!model) { this.showToast('请先选择 Ollama 模型', 'warning'); return; }
        var lang = (document.getElementById('bgenOllamaLang') || {}).value || 'en';
        var hint = document.getElementById('bgenOllamaHint');
        var btn = document.getElementById('bgenOllamaBtn');
        if (btn) btn.disabled = true;
        var ids = this._batchIds || [];
        var total = ids.length;
        var self = this;
        this._batchPromptOverrides = this._batchPromptOverrides || {};
        var done = 0, err = 0;
        for (var i = 0; i < ids.length; i++) {
            var pid = ids[i];
            var card = null;
            (this.state.prompts || []).forEach(function(p) { if (p.id === pid && !card) card = p; });
            var text = card ? (card.content || '') : '';
            if (!text) { done++; continue; }
            if (hint) hint.textContent = '优化中 ' + (done + err + 1) + '/' + total + '...';
            try {
                var d = await this.fetchJSON('/api/v2/comfyui/ollama/enhance', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: text, model: model, language: lang })
                });
                if (d && d.ok && d.text) {
                    this._batchPromptOverrides[pid] = d.text;
                    done++;
                } else {
                    err++;
                }
            } catch(e) {
                err++;
            }
        }
        if (btn) btn.disabled = false;
        if (hint) hint.textContent = '';
        // 更新组合预览 + 保存设置
        this._renderBatchComposePreview();
        this._saveBatchSettings();
        this.showToast('Ollama 优化完成：' + done + ' 条成功 / ' + err + ' 条失败' + (err ? '（生成将使用优化后提示词）' : ''), err > 0 ? 'warning' : 'success');
    },

    // 组合规则（简化复刻后端 _compose_prompt）：预设 + 卡片，尾部加后缀，逗号拼接
    _composePromptPreview(preset, card, suffix) {
        preset = (preset || '').trim().replace(/,\s*$/, '');
        card = (card || '').trim().replace(/,\s*$/, '');
        suffix = (suffix || '').trim().replace(/,\s*$/, '');
        var parts = [];
        if (preset) { parts.push(preset); if (card) parts.push(card); }
        else if (card) parts.push(card);
        if (suffix) parts.push(suffix);
        return parts.join(', ');
    },

    async _loadBatchWorkflows() {
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/workflows?sort=recent');
            this._batchWorkflows = (d && d.items) || [];
            if (this._batchWorkflows.length === 0) {
                var grid = document.getElementById('bgenWfGrid');
                if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:11px;">工作流库为空，请先在「工作流库」导入或同步</div>';
                return;
            }
            this._renderBatchWfViews();
            // 恢复上次选择的工作流（记住参数设置）
            var saved = this._batchSavedSettings();
            var targetId = saved && saved.workflow_id;
            var found = false;
            (this._batchWorkflows || []).forEach(function(w) { if (w.id === targetId) found = true; });
            if (!found && this._batchWorkflows.length > 0) targetId = this._batchWorkflows[0].id;
            this._batchWfId = targetId;
            this._renderBatchWfViews();
            this._batchWfSelected(targetId);
        } catch(e) {
            var grid = document.getElementById('bgenWfGrid');
            if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:#ef4444;font-size:11px;">加载失败: ' + App._escape(e.message) + '</div>';
        }
    },

    // 工作流双视图渲染（卡片/详情）
    _renderBatchWfViews() {
        var self = this;
        var grid = document.getElementById('bgenWfGrid');
        var list = document.getElementById('bgenWfList');
        if (!grid || !list) return;
        var wfs = this._batchWorkflows || [];
        var srcMap = { png_import: 'PNG导入', comfyui_sync: 'Comfy同步', manual: '手动', generate: '生成' };
        // 卡片视图
        var gh = '';
        wfs.forEach(function(w) {
            var isSel = self._batchWfId === w.id;
            var cover = w.thumbnail ? '/api/thumbnails/file/' + w.thumbnail : '';
            var src = srcMap[w.source] || w.source || '';
            gh += '<div onclick="App._batchPickWf(\'' + App._escape(w.id) + '\')" title="' + App._escape((w.name || '') + (w.prompt_text ? '\n📝 ' + w.prompt_text : '')) + '" style="border:1px solid ' + (isSel ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:10px;overflow:hidden;cursor:pointer;background:var(--bg-card);transition:border-color .12s;">' +
              '<div style="height:64px;background:linear-gradient(135deg,#1e293b,#334155);display:flex;align-items:center;justify-content:center;position:relative;">' +
                (cover ? '<img src="' + cover + '" style="width:100%;height:100%;object-fit:cover;">' : '<span style="font-size:22px;opacity:0.5;">🎨</span>') +
                (src ? '<span style="position:absolute;top:4px;right:4px;font-size:8px;padding:1px 6px;border-radius:8px;background:rgba(0,0,0,0.55);color:#e2e8f0;">' + App._escape(src) + '</span>' : '') +
              '</div>' +
              '<div style="padding:5px 7px;">' +
                '<div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + App._escape(w.name || '未命名') + '</div>' +
                '<div style="font-size:9px;color:var(--text-muted);">' + (w.node_count || 0) + ' 节点 · 使用 ' + (w.usage_count || 0) + ' 次</div>' +
              '</div>' +
            '</div>';
        });
        grid.innerHTML = gh;
        // 详情视图
        var lh = '';
        wfs.forEach(function(w) {
            var isSel = self._batchWfId === w.id;
            var cover = w.thumbnail ? '/api/thumbnails/file/' + w.thumbnail : '';
            var src = srcMap[w.source] || w.source || '';
            lh += '<div onclick="App._batchPickWf(\'' + App._escape(w.id) + '\')" style="display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid ' + (isSel ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:8px;cursor:pointer;background:' + (isSel ? 'rgba(99,102,241,0.06)' : 'var(--bg-card)') + ';">' +
              (cover ? '<img src="' + cover + '" style="width:44px;height:30px;object-fit:cover;border-radius:5px;flex-shrink:0;">' : '<span style="width:44px;height:30px;display:flex;align-items:center;justify-content:center;font-size:16px;background:#1e293b;border-radius:5px;flex-shrink:0;">🎨</span>') +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + App._escape(w.name || '未命名') + '</div>' +
                '<div style="font-size:9px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (w.node_count || 0) + ' 节点 · 使用 ' + (w.usage_count || 0) + ' 次' + (src ? ' · ' + src : '') + (w.last_used_at ? ' · ' + App._escape(String(w.last_used_at).slice(5, 16)) : '') + '</div>' +
              '</div>' +
              (isSel ? '<span style="color:var(--primary);font-size:13px;">✓</span>' : '') +
            '</div>';
        });
        list.innerHTML = lh;
        // 应用视图模式
        this._batchWfView(this._batchViewMode || 'grid');
    },

    // 视图模式切换（卡片/详情），记住选择
    _batchWfView(mode) {
        this._batchViewMode = mode;
        try { localStorage.setItem('cwl_batch_wf_view', mode); } catch(e) {}
        var grid = document.getElementById('bgenWfGrid');
        var list = document.getElementById('bgenWfList');
        if (grid) { grid.style.display = mode === 'grid' ? 'grid' : 'none'; }
        if (list) { list.style.display = mode === 'list' ? 'flex' : 'none'; }
        var gb = document.getElementById('bgenWfViewGrid');
        var lb = document.getElementById('bgenWfViewList');
        if (gb) gb.className = 'cwl-logview-btn' + (mode === 'grid' ? ' active' : '');
        if (lb) lb.className = 'cwl-logview-btn' + (mode === 'list' ? ' active' : '');
    },

    // 选择工作流（卡片/列表项点击）
    async _batchPickWf(wfId) {
        this._batchWfId = wfId;
        this._renderBatchWfViews();
        await this._batchWfSelected(wfId);
        this._saveBatchSettings();
    },

    // 读取上次批量设置
    _batchSavedSettings() {
        try { return JSON.parse(localStorage.getItem('cwl_batch_settings') || 'null') || null; } catch(e) { return null; }
    },

    // 保存批量设置（引擎/工作流/参数预设/后缀/开关/参数值/即梦参数）
    _saveBatchSettings() {
        try {
            var s = {
                engine: this._batchEngineMode || 'comfyui',
                workflow_id: this._batchWfId || '',
                preset_id: this._batchPresetId || 0,
                suffix: (document.getElementById('bgenSuffix') || {}).value || '',
                manual_text: (document.getElementById('bgenManualText') || {}).value || '',
                use_module_preset: (document.getElementById('bgenUsePreset') || {}).checked ? 1 : 0,
                param_values: this._collectBatchParams(),
                dreamina_model: (document.getElementById('bgenDreaminaModel') || {}).value || '5.0',
                dreamina_ratio: (document.getElementById('bgenDreaminaRatio') || {}).value || '1:1',
                dreamina_res: (document.getElementById('bgenDreaminaRes') || {}).value || '2k',
                libtv_project: (document.getElementById('bgenLibtvProject') || {}).value || '',
                libtv_model: (document.getElementById('bgenLibtvModel') || {}).value || 'Z-image Turbo',
                libtv_ratio: (document.getElementById('bgenLibtvRatio') || {}).value || '1:1'
            };
            localStorage.setItem('cwl_batch_settings', JSON.stringify(s));
        } catch(e) {}
    },

    // 恢复上次批量设置
    _restoreBatchSettings() {
        var s = this._batchSavedSettings();
        if (!s) return;
        var suffixEl = document.getElementById('bgenSuffix');
        if (suffixEl && s.suffix !== undefined) suffixEl.value = s.suffix;
        var mtEl = document.getElementById('bgenManualText');
        if (mtEl && s.manual_text !== undefined) mtEl.value = s.manual_text;
        var upEl = document.getElementById('bgenUsePreset');
        if (upEl && s.use_module_preset !== undefined) upEl.checked = !!s.use_module_preset;
        if (s.workflow_id) this._batchWfId = s.workflow_id;
        this._batchSavedParams = s.param_values || null;
        if (s.preset_id) this._batchRestorePresetId = s.preset_id;
        if (s.dreamina_model) document.getElementById('bgenDreaminaModel').value = s.dreamina_model;
        if (s.dreamina_ratio) document.getElementById('bgenDreaminaRatio').value = s.dreamina_ratio;
        if (s.dreamina_res) document.getElementById('bgenDreaminaRes').value = s.dreamina_res;
        if (s.libtv_project) document.getElementById('bgenLibtvProject').value = s.libtv_project;
        if (s.libtv_model) document.getElementById('bgenLibtvModel').value = s.libtv_model;
        if (s.libtv_ratio) document.getElementById('bgenLibtvRatio').value = s.libtv_ratio;
        var vm = null;
        try { vm = localStorage.getItem('cwl_batch_wf_view'); } catch(e) {}
        this._batchViewMode = vm === 'list' ? 'list' : 'grid';
        // 恢复引擎选择
        if (s.engine === 'dreamina') {
            this._batchEngineMode = 'dreamina';
            setTimeout(function() { App._batchEngine('dreamina'); }, 50);
        } else if (s.engine === 'libtv') {
            this._batchEngineMode = 'libtv';
            setTimeout(function() { App._batchEngine('libtv'); }, 50);
        } else {
            this._batchEngineMode = 'comfyui';
        }
    },

    async _batchWfSelected(wfId) {
        if (!wfId) return;
        var badge = document.getElementById('bgenModelBadge');
        var presetArea = document.getElementById('bgenPresetArea');
        var hint = document.getElementById('bgenWfHint');
        var infoEl = document.getElementById('bgenWfInfo');
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId) + '/params/analyze');
            if (!d || !d.ok) throw new Error(d && d.error || '分析失败');
            var mtMap = { flux: 'FLUX', sdxl: 'SDXL', sd15: 'SD1.5', unknown: '通用' };
            var mtLabel = mtMap[d.model_type] || d.model_type || '通用';
            this._batchModelType = d.model_type || 'unknown';
            if (badge) {
                badge.textContent = mtLabel;
                badge.style.display = 'inline-block';
            }
            if (hint) hint.textContent = d.model_type === 'sd15' ? '（SD1.5 默认 512×512）' : '';
            // 工作流信息卡
            var wfItem = null;
            (this._batchWorkflows || []).forEach(function(w) { if (w.id === wfId) wfItem = w; });
            if (infoEl) {
                var parts = ['<b style="color:var(--text-main);">' + App._escape((wfItem && wfItem.name) || '') + '</b>'];
                parts.push('模型: <b style="color:var(--primary);">' + App._escape(mtLabel) + '</b>');
                if (wfItem) {
                    parts.push('节点: ' + (wfItem.node_count || 0));
                    if (wfItem.usage_count) parts.push('使用: ' + wfItem.usage_count + ' 次');
                    if (wfItem.last_used_at) parts.push('上次使用: ' + App._escape(String(wfItem.last_used_at).slice(5, 16)));
                }
                if (d.candidates && d.candidates.length) parts.push('可调参数: ' + d.candidates.length + ' 项');
                infoEl.innerHTML = parts.join(' · ');
                infoEl.style.display = 'block';
            }
            // 参数预设：支持多配置切换
            this._batchPresets = d.presets || [];
            var userPreset = null;
            this._batchPresets.forEach(function(p) { if (p.mode === 'user' && !userPreset) userPreset = p; });
            // 恢复上次选择的参数预设
            if (this._batchRestorePresetId) {
                var foundP = null;
                this._batchPresets.forEach(function(p) { if (p.id === this._batchRestorePresetId) foundP = p; }, this);
                if (foundP) userPreset = foundP;
                this._batchRestorePresetId = null;
            }
            this._batchPreset = userPreset || null;
            this._batchPresetId = userPreset ? userPreset.id : 0;
            if (presetArea) {
                presetArea.style.display = 'block';
                this._renderBatchPresetBar();
            }
        } catch(e) {
            if (badge) badge.style.display = 'none';
            if (infoEl) infoEl.style.display = 'none';
            if (presetArea) presetArea.style.display = 'none';
        }
    },

    // 参数预设切换条（多配置）
    _renderBatchPresetBar() {
        var bar = document.getElementById('bgenPresetBar');
        if (!bar) return;
        var presets = this._batchPresets || [];
        var self = this;
        if (presets.length === 0) {
            bar.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">该工作流无已存参数配置，将使用模板默认值（可在「工作流库 → 参数配置」中预设）</span>';
            this._renderBatchParamsForm(null);
            return;
        }
        var html = '';
        presets.forEach(function(p) {
            var isAct = self._batchPreset && self._batchPreset.id === p.id;
            html += '<span onclick="App._batchActivatePreset(' + p.id + ')" style="cursor:pointer;font-size:10px;padding:3px 10px;border-radius:14px;border:1px solid ' + (isAct ? 'var(--primary)' : 'var(--border-color)') + ';color:' + (isAct ? 'var(--primary)' : 'var(--text-muted)') + ';background:' + (isAct ? 'rgba(99,102,241,0.08)' : 'transparent') + ';">' +
              App._escape(p.name || '参数配置') + (p.mode === 'user' ? ' 🔒' : ' (编辑中)') +
            '</span>';
        });
        bar.innerHTML = html;
        this._renderBatchParamsForm(this._batchPreset);
    },

    _batchActivatePreset(pid) {
        (this._batchPresets || []).forEach(function(p) { if (p.id === pid) { this._batchPreset = p; this._batchPresetId = p.id; } }, this);
        this._renderBatchPresetBar();
    },

    // 简化参数表单（滑块+数字/下拉/开关/文本），用于批量预设；preset 为空时用模板默认
    _renderBatchParamsForm(preset) {
        var form = document.getElementById('bgenPresetForm');
        if (!form) return;
        var params = [];
        if (preset) {
            try { params = JSON.parse(preset.params_json || '[]'); } catch(e) {}
        }
        if (!preset || params.length === 0) {
            form.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">使用模板默认值生成（未应用参数配置）</div>';
            var sq = document.getElementById('bgenSizeQuick');
            if (sq) sq.style.display = 'none';
            return;
        }
        var FILE_FIELDS = ['ckpt_name', 'lora_name', 'unet_name', 'vae_name', 'clip_name1', 'clip_name2'];
        params.forEach(function(p) {
            if (!p) return;
            if ((p.options || []).length > 0) p.type = (FILE_FIELDS.indexOf(p.field) > -1) ? 'select_file' : 'select';
        });
        // 尺寸快捷：含 width+height 时显示横竖/比例/分辨率
        var self = this;
        var wP = null, hP = null;
        params.forEach(function(p) { if (p.field === 'width') wP = p; if (p.field === 'height') hP = p; });
        this._renderBatchSizeQuick(wP, hP);
        var html = '';
        params.forEach(function(p) {
            var val = p.default;
            html += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:7px 9px;">' +
              '<div style="font-size:10px;font-weight:600;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape((p.label || p.key) + ' (' + p.key + ')') + '">' + App._escape(p.label || p.key) + '</div>';
            if (p.type === 'slider') {
                var min = p.min === undefined ? 0 : p.min, max = p.max === undefined ? 100 : p.max, step = p.step === undefined ? 1 : p.step;
                html += '<div style="display:flex;align-items:center;gap:5px;">' +
                  '<input type="range" class="bgen-pv" data-key="' + App._escape(p.key) + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" style="flex:1;" oninput="App._bgenSliderSync(this)">' +
                  '<input type="number" class="bgen-pv-num" data-key="' + App._escape(p.key) + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" onchange="App._bgenNumSync(this)" style="width:56px;font-size:10px;padding:2px 4px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-main);" title="可手动输入">' +
                '</div>';
            } else if (p.type === 'number') {
                html += '<input type="number" class="bgen-pv" data-key="' + App._escape(p.key) + '" value="' + App._escape(String(val === undefined ? '' : val)) + '" step="any" style="width:100%;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);">';
            } else if (p.type === 'checkbox') {
                html += '<input type="checkbox" class="bgen-pv" data-key="' + App._escape(p.key) + '" ' + (val ? 'checked' : '') + ' style="width:16px;height:16px;">';
            } else if (p.type === 'select' || p.type === 'select_file' || (p.options || []).length > 0) {
                var opts = p.options || [];
                if (opts.length === 0) opts = [String(val === undefined ? '' : val)];
                html += '<select class="bgen-pv" data-key="' + App._escape(p.key) + '" style="width:100%;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);">';
                opts.forEach(function(o) {
                    html += '<option value="' + App._escape(o) + '"' + (String(val) === String(o) ? ' selected' : '') + '>' + App._escape(o) + '</option>';
                });
                html += '</select>';
            } else {
                html += '<textarea class="bgen-pv" data-key="' + App._escape(p.key) + '" rows="' + (p.key.indexOf('.text') > -1 ? 2 : 1) + '" style="width:100%;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape(String(val === undefined ? '' : val)) + '</textarea>';
            }
            html += '</div>';
        });
        form.innerHTML = html;
        // 恢复上次保存的参数值（记住参数设置）
        if (this._batchSavedParams) {
            var self = this;
            Object.keys(this._batchSavedParams).forEach(function(k) {
                var el = document.querySelector('#bgenPresetForm .bgen-pv[data-key="' + k + '"]');
                if (!el) return;
                var v = self._batchSavedParams[k];
                if (el.type === 'checkbox') el.checked = !!v;
                else el.value = (v === undefined || v === null) ? '' : v;
                var num = document.querySelector('#bgenPresetForm .bgen-pv-num[data-key="' + k + '"]');
                if (num && num.type !== 'checkbox') num.value = (v === undefined || v === null) ? '' : v;
            });
            this._batchSavedParams = null; // 仅恢复一次
        }
    },

    // 批量弹窗尺寸快捷条（复用工作流库尺寸预设）
    _renderBatchSizeQuick(wP, hP) {
        var sq = document.getElementById('bgenSizeQuick');
        if (!sq) return;
        if (!wP || !hP || !App.CWL_SIZE_PRESETS) { sq.style.display = 'none'; return; }
        var mt = App.CWL_SIZE_PRESETS[this._batchModelType || 'unknown'] || App.CWL_SIZE_PRESETS.unknown;
        var base = mt.base;
        var html = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;"><b style="color:var(--text-main);">📐 尺寸快捷</b>（' + App._escape(mt.label) + ' · 长边 ' + base + 'px）</div>' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:5px;">' +
            '<button type="button" class="bgen-btn" style="border-color:#6366f1;color:var(--primary);" onclick="App._batchSetSize(1,1)">□ 方形</button>' +
            '<button type="button" class="bgen-btn" style="border-color:#6366f1;color:var(--primary);" onclick="App._batchSetSize(4,3)">▭ 横屏</button>' +
            '<button type="button" class="bgen-btn" style="border-color:#6366f1;color:var(--primary);" onclick="App._batchSetSize(3,4)">▯ 竖屏</button>' +
          '</div>';
        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:5px;">';
        (App.CWL_RATIOS || []).forEach(function(r) {
            html += '<button type="button" class="bgen-btn" onclick="App._batchSetSize(' + r.w + ',' + r.h + ')">' + r.label + '</button>';
        });
        html += '</div><div style="display:flex;gap:4px;flex-wrap:wrap;">';
        mt.presets.forEach(function(sz) {
            html += '<button type="button" class="bgen-btn" onclick="App._batchSetSize(' + sz[0] + ',' + sz[1] + ',true)">' + sz[0] + '×' + sz[1] + '</button>';
        });
        html += '</div>';
        sq.innerHTML = html;
        sq.style.display = 'block';
    },

    // 应用尺寸到批量表单的 width/height 参数
    _batchSetSize(rw, rh, absolute) {
        var w, h;
        if (absolute) { w = rw; h = rh; }
        else {
            var mt = (App.CWL_SIZE_PRESETS && (App.CWL_SIZE_PRESETS[this._batchModelType] || App.CWL_SIZE_PRESETS.unknown)) || { base: 768 };
            var base = mt.base;
            if (rw >= rh) { w = base; h = Math.round(base * rh / rw); }
            else { h = base; w = Math.round(base * rw / rh); }
            var snap = function(n) { return Math.max(64, Math.round(n / 8) * 8); };
            w = snap(w); h = snap(h);
        }
        ['width', 'height'].forEach(function(f) {
            var rng = document.querySelector('#bgenPresetForm .bgen-pv[data-key$=".' + f + '"]');
            var num = document.querySelector('#bgenPresetForm .bgen-pv-num[data-key$=".' + f + '"]');
            if (rng) rng.value = (f === 'width' ? w : h);
            if (num) num.value = (f === 'width' ? w : h);
        });
        App.showToast('已设置尺寸 ' + w + '×' + h, 'success');
    },

    // 滑块 → 数字框同步
    _bgenSliderSync(input) {
        var key = input.getAttribute('data-key');
        var num = document.querySelector('.bgen-pv-num[data-key="' + key + '"]');
        if (num) num.value = input.value;
    },

    // 数字框 → 滑块同步
    _bgenNumSync(input) {
        var key = input.getAttribute('data-key');
        var rng = document.querySelector('.bgen-pv[data-key="' + key + '"]');
        if (rng) {
            var v = parseFloat(input.value);
            if (isNaN(v)) { input.value = rng.value; return; }
            var mn = parseFloat(rng.min), mx = parseFloat(rng.max);
            if (!isNaN(mn) && !isNaN(mx)) v = Math.max(mn, Math.min(mx, v));
            input.value = v;
            rng.value = v;
        }
    },

    _collectBatchParams() {
        var values = {};
        document.querySelectorAll('#bgenPresetForm .bgen-pv').forEach(function(el) {
            var key = el.getAttribute('data-key');
            var v = el.value;
            if (el.type === 'checkbox') v = el.checked;
            else if (el.type === 'range' || el.type === 'number') v = parseFloat(v);
            values[key] = v;
        });
        return values;
    },

    async _startBatchGen() {
        var self = this;
        var startBtn = document.getElementById('bgenStartBtn');
        if (!startBtn) return;
        var engine = this._batchEngineMode || 'comfyui';
        var wfId = this._batchWfId || '';
        if (this._batchGenRunning) { this.showToast('正在生成中，请稍候', 'warning'); return; }
        if (engine === 'comfyui') {
            if (!wfId) { this.showToast('请先选择生成工作流', 'warning'); return; }
            var cfg = await this.fetchJSON('/api/v2/comfyui/config');
            if (!cfg || !cfg.config || !cfg.config.enabled) {
                this.showToast('ComfyUI 未启用，请先在「工作流库」中启用', 'warning');
                return;
            }
        }
        if (engine === 'dreamina') {
            // 懒授权：未授权时引导去授权中心，不阻塞其他功能
            var dStatus = document.getElementById('bgenDreaminaStatus');
            var needAuth = !dStatus || dStatus.textContent.indexOf('已登录') === -1;
            if (needAuth) {
                if (confirm('即梦引擎未授权。\n点击「确定」打开授权中心完成登录，或「取消」返回。')) {
                    this.openEngineAuth();
                }
                return;
            }
        }
        if (engine === 'libtv') {
            // 懒授权：未授权时引导去授权中心，不阻塞其他功能
            var ltStatus = document.getElementById('bgenLibtvStatus');
            var ltNeedAuth = !ltStatus || ltStatus.textContent.indexOf('已登录') === -1;
            if (ltNeedAuth) {
                if (confirm('LibTV 引擎未授权。\n点击「确定」打开授权中心完成登录，或「取消」返回。')) {
                    this.openEngineAuth();
                }
                return;
            }
            var ltProj = (document.getElementById('bgenLibtvProject') || {}).value || '';
            if (!ltProj) { this.showToast('请先选择 LibTV 画布', 'warning'); return; }
            var ltModel = (document.getElementById('bgenLibtvModel') || {}).value || '';
            if (!ltModel) { this.showToast('请先选择 LibTV 模型', 'warning'); return; }
            // 积分保护：付费模型提示（免费模型跳过）
            var ltOpt = document.querySelector('#bgenLibtvModel option:checked');
            var isPaid = ltOpt && /💎/.test(ltOpt.textContent);
            if (isPaid && !confirm('「' + ltModel + '」为付费模型（消耗积分）。\n当前账号基础 VIP 未生效，可能报「算力不足」导致整批失败。\n\n确认继续？')) {
                return;
            }
        }
        // 展示进度区
        var pa = document.getElementById('bgenProgressArea');
        if (pa) pa.style.display = 'block';
        var det = document.getElementById('bgenDetail');
        if (det) det.innerHTML = '';
        var grid = document.getElementById('bgenGrid');
        if (grid) grid.style.display = 'none';
        var retryBtn = document.getElementById('bgenRetryBtn');
        if (retryBtn) retryBtn.style.display = 'none';
        var bar = document.getElementById('bgenProgressBar');
        var txt = document.getElementById('bgenProgressText');
        if (bar) bar.style.width = '0%';
        if (txt) txt.textContent = '正在创建生成任务...';
        startBtn.disabled = true;
        this._batchGenRunning = true;
        var paramValues = this._collectBatchParams();
        // 构建卡片类型映射（{prompt_id: 'word_card'|'prompts'}）
        // 2026-08-06 修复：id 在 prompts/word_card 两表可能重叠（旧数据），
        // 必须按当前列表数据源显式标注，避免后端猜表把词卡图写进 prompts 链路
        var cardTypeMap = {};
        var typeSrc = this.state.prompts || [];
        if ((this.state.currentView === 'collections' || this.state.currentCollection) && (this.state.collectionItems || []).length > 0) {
            typeSrc = this.state.collectionItems;
        }
        for (var _ti = 0; _ti < typeSrc.length; _ti++) {
            var _it = typeSrc[_ti];
            if (this._batchIds.indexOf(_it.id) > -1) {
                cardTypeMap[_it.id] = (_it._source === 'word_card') ? 'word_card' : 'prompts';
            }
        }
        var body = {
            prompt_ids: this._batchIds,
            workflow_id: wfId,
            preset_id: this._batchPresetId || 0,
            param_values: paramValues,
            style_suffix: (document.getElementById('bgenSuffix') || {}).value,
            use_module_preset: (document.getElementById('bgenUsePreset') || {}).checked ? 1 : 0,
            prompt_overrides: this._batchPromptOverrides || {},
            card_type_map: cardTypeMap,
            engine: engine,
            manual_text: (document.getElementById('bgenManualText') || {}).value || '',
            model_version: (document.getElementById('bgenDreaminaModel') || {}).value || '5.0',
            ratio: (document.getElementById('bgenDreaminaRatio') || {}).value || '1:1',
            resolution_type: (document.getElementById('bgenDreaminaRes') || {}).value || '2k',
            project_uuid: (document.getElementById('bgenLibtvProject') || {}).value || '',
            libtv_model: (document.getElementById('bgenLibtvModel') || {}).value || 'Z-image Turbo',
            libtv_ratio: (document.getElementById('bgenLibtvRatio') || {}).value || '1:1'
        };
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/batch-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!d || !d.ok) {
                this.showToast('任务创建失败: ' + (d && d.error || ''), 'error');
                if (txt) txt.textContent = '❌ ' + (d && d.error || '创建失败');
                return;
            }
            this._batchTaskId = d.task_id;
            this._batchTaskTotal = d.total || this._batchIds.length;
            // 记住本次参数设置（下次打开恢复）
            this._saveBatchSettings();
            if (txt) txt.textContent = '任务 #' + d.task_id + ' 已创建（' + (d.workflow_name || '') + '），等待执行...';
            this.showToast('生成任务 #' + d.task_id + ' 已入队（' + this._batchTaskTotal + ' 张）', 'info');
            // 轮询监督进度（任务持久化，断线/刷新后可恢复）
            this._pollBatchTask();
        } catch(e) {
            this.showToast('任务创建异常: ' + e.message, 'error');
            if (txt) txt.textContent = '❌ ' + e.message;
            startBtn.disabled = false;
            this._batchGenRunning = false;
        }
    },

    // 轮询任务进度（2s 间隔；任务在后台线程执行，前端刷新/断线不影响）
    _pollBatchTask() {
        var self = this;
        if (this._batchPolling) return;
        this._batchPolling = true;
        var bar = document.getElementById('bgenProgressBar');
        var txt = document.getElementById('bgenProgressText');
        var interval = setInterval(async function() {
            if (!self._batchTaskId) { clearInterval(interval); self._batchPolling = false; return; }
            try {
                var d = await self.fetchJSON('/api/v2/comfyui/batch-tasks/' + self._batchTaskId);
                if (!d || !d.ok || !d.task) { clearInterval(interval); self._batchPolling = false; return; }
                var t = d.task;
                var pct = t.total > 0 ? Math.round(t.current_index / t.total * 100) : 0;
                if (bar) bar.style.width = pct + '%';
                var stMap = { queued: '排队中', running: '生成中', done: '已完成', cancelled: '已取消', error: '失败' };
                if (txt) {
                    var eta = '';
                    if (t.status === 'running') eta = self._batchEtaText(t);
                    txt.textContent = (stMap[t.status] || t.status) + '：' + t.current_index + '/' + t.total + '（成功 ' + t.success + ' / 失败 ' + t.failed + '）' + eta;
                }
                // 明细（全量渲染，最后一项高亮为当前项）
                self._renderBatchResults(t.results || [], t.status);
                if (t.status === 'done' || t.status === 'cancelled' || t.status === 'error') {
                    clearInterval(interval);
                    self._batchPolling = false;
                    self._batchGenRunning = false;
                    var startBtn = document.getElementById('bgenStartBtn');
                    if (startBtn) startBtn.disabled = false;
                    self._batchTaskTotal = t.total;
                    if (t.status === 'done') {
                        self.showToast('任务 #' + self._batchTaskId + ' 完成：' + t.success + ' 成功 / ' + t.failed + ' 失败', t.failed > 0 ? 'warning' : 'success');
                        self._batchFailedIds = (t.results || []).filter(function(r) { return !r.ok; }).map(function(r) { return r.prompt_id; });
                        self._batchSuccess = (t.results || []).filter(function(r) { return r.ok && r.thumbnail_url; }).map(function(r) { return { thumb: r.thumbnail_url, text: r.prompt_text || '' }; });
                        self._renderBatchGrid();
                        if (t.failed > 0 && retryBtn) {
                            var retryBtn2 = document.getElementById('bgenRetryBtn');
                            if (retryBtn2) retryBtn2.style.display = 'inline-flex';
                        }
                        self.loadPrompts();
                    } else if (t.status === 'cancelled') {
                        self.showToast('任务已取消（已完成 ' + t.current_index + '/' + t.total + '）', 'info');
                    } else {
                        self.showToast('任务异常: ' + (t.error || ''), 'error');
                    }
                }
            } catch(e) { /* 网络抖动忽略，下轮重试 */ }
        }, 2000);
    },

    // ETA 估算文本（基于任务进度与已耗时）
    _batchEtaText(t) {
        try {
            var elapsed = (Date.now() - new Date((t.started_at || '').replace(' ', 'T')).getTime()) / 1000;
            if (elapsed < 5 || t.current_index <= 0) return '';
            var avg = elapsed / t.current_index;
            var remain = Math.max(0, t.total - t.current_index);
            var eta = Math.round(avg * remain);
            if (eta <= 0) return '';
            return ' · 预计剩余 ' + (eta < 60 ? eta + 's' : Math.floor(eta / 60) + '分' + (eta % 60) + 's');
        } catch(e) { return ''; }
    },

    // 从任务结果渲染明细列表
    _renderBatchResults(results, status) {
        var det = document.getElementById('bgenDetail');
        if (!det) return;
        if (!results || results.length === 0) {
            if (status === 'queued') det.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">任务排队中，等待执行...</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var isCur = (status === 'running') && (i === results.length - 1);
            var color = r.ok ? '#10b981' : '#ef4444';
            html += '<div class="bgen-item' + (isCur ? ' bgen-active" style="border-left:3px solid ' + color + ';"' : '"') + ' style="border-color:' + color + '33;">' +
              (r.thumbnail_url ? '<img src="' + r.thumbnail_url + '" style="width:42px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0;" loading="lazy">' : '<span style="width:42px;text-align:center;flex-shrink:0;">' + (r.ok ? '✅' : '❌') + '</span>') +
              '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(r.prompt_text || '') + '">' + App._escape((r.prompt_text || '').slice(0, 40)) + '</span>' +
              '<span style="font-size:10px;color:' + color + ';flex-shrink:0;">' + (r.ok ? '成功' : (r.error || '失败')) + '</span>' +
            '</div>';
        }
        det.innerHTML = html;
        det.scrollTop = det.scrollHeight;
    },

    _appendBatchDetail(ev) {
        var det = document.getElementById('bgenDetail');
        if (!det) return;
        // 移除上一项高亮
        var prev = det.querySelector('.bgen-item.bgen-active');
        if (prev) prev.classList.remove('bgen-active');
        var st = ev.ok ? '✅' : '❌';
        var color = ev.ok ? '#10b981' : '#ef4444';
        var html = '<div class="bgen-item bgen-active" style="border-color:' + color + '33;border-left:3px solid ' + color + ';">' +
          (ev.thumbnail_url ? '<img src="' + ev.thumbnail_url + '" style="width:42px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0;" loading="lazy">' : '<span style="width:42px;text-align:center;flex-shrink:0;">' + st + '</span>') +
          '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(ev.prompt_text || '') + '">' + App._escape((ev.prompt_text || '').slice(0, 40)) + '</span>' +
          '<span style="font-size:10px;color:' + color + ';flex-shrink:0;">' + (ev.ok ? '成功' : (ev.error || '失败')) + '</span>' +
        '</div>';
        det.insertAdjacentHTML('beforeend', html);
        det.scrollTop = det.scrollHeight;
    },

    // 成功后缩略图网格总览（点击放大）
    _renderBatchGrid() {
        var grid = document.getElementById('bgenGrid');
        var items = document.getElementById('bgenGridItems');
        if (!grid || !items) return;
        var success = this._batchSuccess || [];
        if (success.length === 0) { grid.style.display = 'none'; return; }
        var html = '';
        success.forEach(function(s) {
            var fname = s.thumb.split('/').pop();
            html += '<img src="' + s.thumb + '" style="width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:6px;cursor:zoom-in;border:1px solid var(--border-color);" title="' + App._escape(s.text || '') + '" '
              + 'onmouseenter="App._bgenHoverShow(this,\'' + fname + '\')" onmousemove="App._bgenHoverMove(event)" onmouseleave="App._bgenHoverHide()" '
              + 'onclick="App.openImageViewer(\'' + fname + '\')" loading="lazy">';
        });
        items.innerHTML = html;
        grid.style.display = 'block';
    },

    // 悬停大图预览：跟随鼠标显示原图（不阻塞点击）
    _bgenHoverShow(el, fname) {
        var hp = document.getElementById('bgenHoverImg');
        if (!hp) {
            hp = document.createElement('img');
            hp.id = 'bgenHoverImg';
            hp.style.cssText = 'position:fixed;z-index:2000;pointer-events:none;max-width:360px;max-height:280px;object-fit:contain;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.45);border:2px solid rgba(99,102,241,0.6);background:#0f172a;display:none;';
            document.body.appendChild(hp);
        }
        if (!fname) { hp.style.display = 'none'; return; }
        if (hp.dataset.fname !== fname) {
            hp.dataset.fname = fname;
            hp.src = '/api/media/original/' + fname;
        }
        hp.style.display = 'block';
    },

    // 悬停跟随：原图左上角偏移鼠标 14px，越界时翻转到另一侧
    _bgenHoverMove(e) {
        var hp = document.getElementById('bgenHoverImg');
        if (!hp || hp.style.display === 'none') return;
        var off = 14;
        var x = e.clientX + off;
        var y = e.clientY + off;
        if (x + 360 > window.innerWidth - 8) x = e.clientX - 360 - off;
        if (y + 280 > window.innerHeight - 8) y = e.clientY - 280 - off;
        hp.style.left = Math.max(4, x) + 'px';
        hp.style.top = Math.max(4, y) + 'px';
    },

    // 隐藏悬停大图
    _bgenHoverHide() {
        var hp = document.getElementById('bgenHoverImg');
        if (hp) hp.style.display = 'none';
    },

    // 重试失败项：创建新任务（仅失败词条）
    async _retryBatchFailed() {
        if (!this._batchTaskId) return;
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/batch-tasks/' + this._batchTaskId + '/retry-failed', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            if (!d || !d.ok) { this.showToast('重试失败: ' + (d && d.error || ''), 'error'); return; }
            var retryBtn = document.getElementById('bgenRetryBtn');
            if (retryBtn) retryBtn.style.display = 'none';
            var det = document.getElementById('bgenDetail');
            if (det) det.innerHTML = '';
            this._batchTaskId = d.task_id;
            this._batchTaskTotal = d.total;
            this._batchGenRunning = true;
            var startBtn = document.getElementById('bgenStartBtn');
            if (startBtn) startBtn.disabled = true;
            var txt = document.getElementById('bgenProgressText');
            if (txt) txt.textContent = '重试任务 #' + d.task_id + '（' + d.total + ' 张）...';
            this._pollBatchTask();
        } catch(e) {
            this.showToast('重试异常: ' + e.message, 'error');
        }
    },

    async _cancelBatchGen() {
        if (!this._batchTaskId) { this.showToast('无进行中的任务', 'info'); return; }
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/batch-tasks/' + this._batchTaskId + '/cancel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this.showToast('已请求取消任务 #' + this._batchTaskId, 'info');
        } catch(e) {
            this.showToast('取消失败: ' + e.message, 'error');
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
                            ${(p.thumbnail || videoFile2) ? '<span class="thumb-zoom-btn" onclick="event.stopPropagation();' + (videoFile2 ? 'App.openVideoViewer(\'' + videoFile2 + '\', \'' + (p.thumbnail || '') + '\', \'' + p.id + '\', \'' + (p.video_fps || '') + '\')' : 'App.openImageViewer(\'' + (p.original_ref || p.thumbnail) + '\', \'' + p.id + '\')') + '" title="' + (videoFile2 ? '查看原视频' : '查看原图') + '">' + (videoFile2 ? '▶' : '🔍') + '</span>' : ''}
                        </div>
                        <div class="card-add-row">
                            <span class="coll-add-btn" onclick="event.stopPropagation();App.quickCollect(${p.id}, this)" title="添加到收藏分组">+</span>
                            ${(p.thumbnail || videoFile2) ? '<span class="coll-add-btn" onclick="event.stopPropagation();App._downloadPreview(\'' + (videoFile2 ? 'video' : 'image') + '\', \'' + (p.original_ref || p.thumbnail || '') + '\', \'' + (videoFile2 || '') + '\', \'' + (p.content || '').replace(/'/g,"\\'").substring(0,12) + '\')" title="下载' + (videoFile2 ? '视频' : '原图') + '到本地" style="background:rgba(34,197,94,0.1);color:#22c55e;">⬇</span>' : ''}
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
                            <div class="card-content" id="cc_${p.id}">${this._escape(App._transContent ? App._transContent(p) : p.content)}</div>
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

    async batchRemoveFromCollection() {
        var ids = [...this.state.batchSelected];
        var cid = this.state.currentCollection;
        if (ids.length === 0) { this.showToast('请先选择词条', 'error'); return; }
        if (!confirm('确认将选中的 ' + ids.length + ' 条移出本收藏分组？')) return;
        var data = await this.fetchJSON('/api/v2/collections/' + cid + '/items/batch-remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        if (data && data.ok) {
            this.showToast('已移出 ' + data.removed + ' 条', 'success');
            this._afterBatchOp();
            await this.loadCollections();
            await this.loadCollectionItems();
        } else {
            this.showToast('操作未完成，稍后再试: ' + (data ? data.error : '遇到意外情况，请稍后再试'), 'error');
        }
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
                el.innerHTML = App._escape(original); this.showToast('翻译未完成: ' + (data ? (data.error || '未知') : '服务未响应'), 'error');
            }
        } catch(e) { el.innerHTML = App._escape(original); this.showToast('翻译未完成: ' + e.message, 'error'); }
    },

    _findCardData(pid) {
        var ps = this.state.prompts || [];
        for (var i = 0; i < ps.length; i++) { if (ps[i].id === pid) return ps[i]; }
        // Phase16.3: 收藏视图下数据在 collectionItems 中
        var cs = this.state.collectionItems || [];
        for (var i2 = 0; i2 < cs.length; i2++) { if (cs[i2].id === pid) return cs[i2]; }
        return null;
    },

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
                this.showToast(App._t('auto.upload_失败__', '上传未完成: ') + (data ? data.error : App._t('common.unknown_error', '遇到意外情况，请稍后再试')), 'error');
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
                this.showToast(App._t('auto.str_6d973dbe', '暂未关联成功'), 'error');
            }
        } catch(e) {
            this.showToast(App._t('auto.upload_失败__', '上传未完成: ') + e.message, 'error');
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
                this.showToast(App._t('auto.upload_失败__', '上传未完成: ') + (data ? data.error : App._t('common.unknown_error', '遇到意外情况，请稍后再试')), 'error');
                return;
            }
            // 关联到提示词
            var assignRes = await this.fetchJSON('/api/thumbnails/assign-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: promptId, video_filename: data.video_filename, poster_filename: data.poster_filename || '', duration: data.duration || 0 })
            });
            if (assignRes && assignRes.ok) {
                this.showToast(App._t('auto.str_ec86f555', '✅ 视频已关联到提示词'), 'success');
                await this.loadPrompts();
                await this.loadThumbLibrary();
            } else {
                this.showToast(App._t('auto.str_6d973dbe', '暂未关联成功'), 'error');
            }
        } catch(e) {
            this.showToast(App._t('auto.upload_失败__', '上传未完成: ') + e.message, 'error');
        }
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
        App.applyColumns();
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
            this.showToast(App._t('common.export', '导出未完成'), 'error');
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
                    <span class="card-badge">${this._escape(card.module)}</span>
                    <div class="card-content" id="cc_${card.id}">${this._escape(card.content)}</div>
                    ${card.meaning ? `<div class="card-meaning">${this._escape(card.meaning)}</div>` : ''}
                    <div class="card-actions">
                        <span style="font-size:11px;color:#94a3b8;margin-right:auto;">${card.used_at ? card.used_at.substring(0, 16) : ''}</span>
                        <button class="btn-copy" onclick="App.trackUsage(${card.id});App.copyText('${this._escape(card.content).replace(/'/g, "\\'")}')">📋 复制</button>
                        <button class="btn-copy" style="border-color:#ef4444;color:#ef4444;padding:3px 8px;" onclick="App.deleteHistoryItem(${card.id})">×</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
        App.applyColumns();
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
        App.applyColumns();
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
            grid.innerHTML = '<div class="empty-state"><div class="icon">🗑️</div><p>加载回收站未完成: ' + (e.message || App._t('common.unknown_error', '遇到意外情况，请稍后再试')) + '</p></div>';
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
                var errMsg = (errData && errData.detail) || '未能删除（HTTP ' + res.status + '）';
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
            this.showToast('未能删除: ' + (e.message || '网络不太稳定，请稍后重试'), 'danger');
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
            self.showToast('移动未完成: ' + (result ? result.error : App._t('common.unknown_error', '遇到意外情况，请稍后再试')), 'error');
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
    openEngineAuth() {
        var m = document.getElementById('modalEngineAuth');
        if (m) m.style.display = 'flex';
        // 重置流程区，避免上次残留
        ['engineAuthDreaminaFlow', 'engineAuthLibtvFlow'].forEach(function(id) {
            var f = document.getElementById(id);
            if (f) { f.style.display = 'none'; f.innerHTML = ''; }
        });
        this._engineAuthRefresh();
    },

    // 关闭授权中心（清理轮询，防泄漏）
    closeEngineAuth() {
        this._engineAuthClearTimers();
        var m = document.getElementById('modalEngineAuth');
        if (m) m.style.display = 'none';
    },

    // 注册轮询定时器（统一管理）
    _engineAuthTrackTimer(timer) {
        if (!this._engineAuthTimers) this._engineAuthTimers = [];
        this._engineAuthTimers.push(timer);
    },

    // 清理所有授权轮询
    _engineAuthClearTimers() {
        (this._engineAuthTimers || []).forEach(function(t) { clearInterval(t); });
        this._engineAuthTimers = [];
    },

    // 取消当前等待（engine: dreamina | libtv）
    _engineAuthCancelWait(engine) {
        this._engineAuthClearTimers();
        var flow = document.getElementById(engine === 'dreamina' ? 'engineAuthDreaminaFlow' : 'engineAuthLibtvFlow');
        if (flow) flow.innerHTML = '<span style="color:var(--text-muted);">已取消等待，可重新发起</span>';
        if (engine === 'dreamina') this._engineAuthDreamina(); else this._engineAuthLibtv();
    },

    // 复制文本（clipboard API，HTTP 环境降级 execCommand）
    _engineAuthCopy(text) {
        var done = function() { App.showToast('已复制', 'success'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function() { App._engineAuthCopyFallback(text); done(); });
        } else { this._engineAuthCopyFallback(text); done(); }
    },

    _engineAuthCopyFallback(text) {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
    },

    // 刷新授权中心状态
    async _engineAuthRefresh() {
        this._engineAuthDreamina();
        this._engineAuthLibtv();
    },

    // 按钮 loading 辅助
    _engineAuthBtnBusy(btn, busy, busyText) {
        if (!btn) return;
        if (busy) {
            btn._origHtml = btn.innerHTML;
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:10px;height:10px;"></span> ' + (busyText || '处理中...');
        } else {
            btn.disabled = false;
            btn.style.opacity = '';
            if (btn._origHtml) btn.innerHTML = btn._origHtml;
        }
    },

    // ---- 即梦 ----
    async _engineAuthDreamina() {
        var st = document.getElementById('engineAuthDreaminaStatus');
        var body = document.getElementById('engineAuthDreaminaBody');
        var btns = document.getElementById('engineAuthDreaminaBtns');
        if (!st) return;
        if (btns) btns.innerHTML = '';
        try {
            var d = await this.fetchJSON('/api/v2/dreamina/status');
            if (!d || !d.ok) throw new Error('查询失败');
            if (!d.cli_available) {
                st.textContent = '○ CLI 未安装';
                st.style.color = '#ef4444';
                if (body) body.innerHTML = '未找到即梦 CLI：<code>' + App._escape(d.bin || '~/bin/dreamina.exe') + '</code><br><span style="font-size:11px;color:var(--text-muted);">请将 dreamina.exe 放入应用目录 bin/ 后点「重新检测」</span>';
                if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;" onclick="App._engineAuthDreamina()"><i class="bi bi-arrow-clockwise"></i> 重新检测</button>';
                return;
            }
            if (d.logged_in) {
                st.textContent = '● 已登录' + (d.vip_level ? ' · ' + d.vip_level : '');
                st.style.color = '#10b981';
                if (body) body.innerHTML = '即梦 CLI 可用，可直接生成图片';
                if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #ef4444;color:#ef4444;" onclick="App._engineAuthDreaminaLogout(this)">退出登录</button>';
            } else {
                st.textContent = '○ 未登录';
                st.style.color = '#f59e0b';
                if (body) body.innerHTML = '点击「授权登录」完成 OAuth 授权（浏览器打开链接 + 输入验证码）';
                if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;" onclick="App._engineAuthDreaminaLogin(this)">授权登录</button>';
            }
        } catch(e) {
            st.textContent = '○ 检测失败';
            st.style.color = '#94a3b8';
            if (body) body.innerHTML = '无法连接即梦 CLI，请确认服务与网络正常';
            if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;" onclick="App._engineAuthDreamina()">重新检测</button>';
        }
    },

    // 即梦授权登录：Device Flow，展示链接+验证码+复制，自动轮询可取消
    async _engineAuthDreaminaLogin(btn) {
        var flow = document.getElementById('engineAuthDreaminaFlow');
        if (!flow) return;
        this._engineAuthClearTimers();
        this._engineAuthBtnBusy(btn, true, '获取中...');
        flow.style.display = 'block';
        flow.innerHTML = '<span style="color:var(--text-muted);">正在获取授权材料...</span>';
        try {
            var d = await this.fetchJSON('/api/v2/dreamina/auth/login-start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this._engineAuthBtnBusy(btn, false);
            if (!d || !d.ok) {
                flow.innerHTML = '<span style="color:#ef4444;">' + App._escape(d && d.error || '发起失败') + '</span>';
                return;
            }
            if (d.already_logged_in) {
                flow.innerHTML = '<span style="color:#10b981;">已登录，无需重复授权</span>';
                this._engineAuthDreamina();
                return;
            }
            flow.innerHTML =
                '<div style="margin-bottom:6px;"><b>步骤 1/2</b> 打开链接并输入验证码：</div>' +
                '<div style="word-break:break-all;margin-bottom:6px;"><a href="' + App._escape(d.verification_uri) + '" target="_blank" rel="noopener" style="color:#6366f1;">' + App._escape(d.verification_uri) + '</a></div>' +
                '<div style="margin-bottom:6px;"><b>步骤 2/2</b> 验证码：<b style="font-family:monospace;font-size:16px;color:#6366f1;letter-spacing:2px;">' + App._escape(d.user_code) + '</b> <button class="btn btn-sm" style="margin-left:4px;border:1px solid #6366f1;color:#6366f1;" onclick="App._engineAuthCopy(\'' + d.user_code + '\')">复制</button></div>' +
                '<div style="font-size:11px;color:var(--text-muted);">有效期至 ' + App._escape(d.expires_at || '') + ' · 完成授权后自动检测</div>' +
                '<div id="engineAuthDreaminaPolling" style="margin-top:8px;font-size:11px;color:var(--text-muted);"></div>' +
                '<div style="margin-top:8px;"><button class="btn btn-sm btn-secondary" onclick="App._engineAuthCancelWait(\'dreamina\')">取消等待</button></div>';
            var self = this;
            var dev = d.device_code;
            var pollTxt = document.getElementById('engineAuthDreaminaPolling');
            var tries = 0;
            var timer = setInterval(async function() {
                tries++;
                try {
                    var r = await self.fetchJSON('/api/v2/dreamina/auth/login-poll', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ device_code: dev, poll: 5 })
                    });
                    if (r && r.ok && r.logged_in) {
                        clearInterval(timer);
                        self._engineAuthClearTimers();
                        if (pollTxt) pollTxt.innerHTML = '<span style="color:#10b981;">✓ 授权成功！</span>';
                        self._engineAuthDreamina();
                        self.showToast('即梦授权成功', 'success');
                    } else if (tries > 60) {
                        clearInterval(timer);
                        if (pollTxt) pollTxt.innerHTML = '<span style="color:#f59e0b;">授权超时（5 分钟），请重新发起</span>';
                    } else if (pollTxt) {
                        pollTxt.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:10px;height:10px;"></span> 等待授权完成...（' + (tries * 5) + 's）' + (r && r.error ? ' ' + App._escape(r.error) : '');
                    }
                } catch(e) {
                    if (pollTxt) pollTxt.innerHTML = '<span style="color:#ef4444;">轮询异常: ' + App._escape(e.message) + '</span>';
                }
            }, 5000);
            this._engineAuthTrackTimer(timer);
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            flow.innerHTML = '<span style="color:#ef4444;">发起失败: ' + App._escape(e.message) + '</span>';
        }
    },

    // 即梦退出登录
    async _engineAuthDreaminaLogout(btn) {
        if (!confirm('确认退出即梦登录？')) return;
        this._engineAuthBtnBusy(btn, true, '退出中...');
        try {
            await this.fetchJSON('/api/v2/dreamina/auth/logout', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this._engineAuthBtnBusy(btn, false);
            this.showToast('已退出即梦登录', 'success');
            this._engineAuthDreamina();
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            this.showToast('退出失败: ' + e.message, 'error');
        }
    },

    // ---- LibTV ----
    async _engineAuthLibtv() {
        var st = document.getElementById('engineAuthLibtvStatus');
        var body = document.getElementById('engineAuthLibtvBody');
        var btns = document.getElementById('engineAuthLibtvBtns');
        if (!st) return;
        if (btns) btns.innerHTML = '';
        try {
            var d = await this.fetchJSON('/api/v2/libtv/status');
            if (!d || !d.ok) throw new Error('查询失败');
            if (!d.cli_available) {
                st.textContent = '○ CLI 未安装';
                st.style.color = '#ef4444';
                if (body) body.innerHTML = '未找到 libtv CLI：<code>' + App._escape(d.bin || '~/.libtv/libtv.exe') + '</code><br><span style="font-size:11px;color:var(--text-muted);">请将 libtv.exe 放入应用目录 bin/ 后点「重新检测」</span>';
                if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtv()"><i class="bi bi-arrow-clockwise"></i> 重新检测</button>';
                return;
            }
            if (d.logged_in) {
                st.textContent = '● 已登录';
                st.style.color = '#10b981';
                if (body) body.innerHTML = 'LibTV CLI 可用 · ' + (d.projects || []).length + ' 张画布可用';
                if (btns) btns.innerHTML =
                    '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtvLogin(this)">切换账号</button>' +
                    '<button class="btn btn-sm" style="border:1px solid #ef4444;color:#ef4444;" onclick="App._engineAuthLibtvLogout(this)">退出登录</button>';
                // 账号列表
                var acc = await this.fetchJSON('/api/v2/libtv/auth/account-list', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                });
                var accBox = document.getElementById('engineAuthLibtvAccounts');
                if (accBox && acc && acc.accounts && acc.accounts.length > 1) {
                    var html = '<div style="margin-bottom:4px;color:var(--text-muted);">账号列表：</div>';
                    acc.accounts.forEach(function(a) {
                        html += '<button class="bgen-btn" style="margin:2px;' + (a.isActive ? 'border-color:#8b5cf6;color:#8b5cf6;' : '') + '" onclick="App._engineAuthLibtvUse(' + (a.accountId || 0) + ')">' + App._escape(a.accountName || ('#' + a.accountId)) + (a.isActive ? ' ✓' : '') + '</button>';
                    });
                    accBox.innerHTML = html;
                    accBox.style.display = 'block';
                } else if (accBox) {
                    accBox.style.display = 'none';
                }
            } else {
                st.textContent = '○ 未登录';
                st.style.color = '#f59e0b';
                if (body) body.innerHTML = '选择一种方式登录：';
                if (btns) btns.innerHTML =
                    '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtvLogin(this)">浏览器授权</button>' +
                    '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtvPhone()">手机验证码</button>';
                var accBox2 = document.getElementById('engineAuthLibtvAccounts');
                if (accBox2) accBox2.style.display = 'none';
            }
        } catch(e) {
            st.textContent = '○ 检测失败';
            st.style.color = '#94a3b8';
            if (body) body.innerHTML = '无法连接 libtv CLI，请确认服务与网络正常';
            if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtv()">重新检测</button>';
        }
    },

    // LibTV 浏览器授权
    async _engineAuthLibtvLogin(btn) {
        var flow = document.getElementById('engineAuthLibtvFlow');
        if (!flow) return;
        this._engineAuthClearTimers();
        this._engineAuthBtnBusy(btn, true, '启动中...');
        flow.style.display = 'block';
        flow.innerHTML = '<span style="color:var(--text-muted);">正在启动浏览器授权...</span>';
        try {
            var d = await this.fetchJSON('/api/v2/libtv/auth/login-web-start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this._engineAuthBtnBusy(btn, false);
            if (!d || !d.ok) {
                flow.innerHTML = '<span style="color:#ef4444;">' + App._escape(d && d.error || '发起失败') + '</span>';
                return;
            }
            var urlHtml = d.url
                ? '<div style="word-break:break-all;margin:6px 0;"><a href="' + App._escape(d.url) + '" target="_blank" rel="noopener" style="color:#8b5cf6;">' + App._escape(d.url) + '</a> <button class="btn btn-sm" style="margin-left:4px;border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthCopy(\'' + d.url + '\')">复制</button></div>'
                : '<div style="color:#f59e0b;margin:6px 0;">未能获取授权链接，请关闭后重试</div>';
            flow.innerHTML =
                '<div style="margin-bottom:6px;"><b>请在浏览器中打开以下链接完成 LibTV 登录</b>（建议用运行本服务的电脑浏览器）：</div>' +
                urlHtml +
                '<div style="font-size:11px;color:var(--text-muted);">完成登录后本页会自动检测，无需手动操作</div>' +
                '<div id="engineAuthLibtvPolling" style="margin-top:4px;font-size:11px;color:var(--text-muted);"></div>' +
                '<div style="margin-top:8px;"><button class="btn btn-sm btn-secondary" onclick="App._engineAuthCancelWait(\'libtv\')">取消等待</button></div>';
            var self = this;
            var tries = 0;
            var timer = setInterval(async function() {
                tries++;
                try {
                    var r = await self.fetchJSON('/api/v2/libtv/auth/login-web-status', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                    });
                    if (r && r.ok && r.logged_in) {
                        clearInterval(timer);
                        self._engineAuthClearTimers();
                        flow.innerHTML = '<span style="color:#10b981;">✓ 授权成功！</span>';
                        self._engineAuthLibtv();
                        self.showToast('LibTV 授权成功', 'success');
                    } else if (tries > 60) {
                        clearInterval(timer);
                        flow.innerHTML = '<span style="color:#f59e0b;">授权超时（5 分钟），请重新发起</span>';
                    } else {
                        var pt = document.getElementById('engineAuthLibtvPolling');
                        if (pt) pt.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:10px;height:10px;"></span> 等待浏览器授权...（' + (tries * 5) + 's）';
                    }
                } catch(e) {
                    if (tries > 60) { clearInterval(timer); flow.innerHTML = '<span style="color:#ef4444;">检测异常</span>'; }
                }
            }, 5000);
            this._engineAuthTrackTimer(timer);
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            flow.innerHTML = '<span style="color:#ef4444;">发起失败: ' + App._escape(e.message) + '</span>';
        }
    },

    // LibTV 手机验证码：内嵌表单（手机号 → 验证码），替代原生 prompt
    _engineAuthLibtvPhone() {
        var flow = document.getElementById('engineAuthLibtvFlow');
        if (!flow) return;
        this._engineAuthClearTimers();
        flow.style.display = 'block';
        flow.innerHTML =
            '<div style="margin-bottom:6px;"><b>手机验证码登录</b></div>' +
            '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
            '<input id="ltvPhoneInput" type="tel" maxlength="11" placeholder="11 位手机号" class="modal-input" style="flex:1;min-width:0;" value="' + App._escape(this._ltvPhone || '') + '">' +
            '<button class="btn btn-sm" id="ltvSendBtn" style="border:1px solid #8b5cf6;color:#8b5cf6;white-space:nowrap;" onclick="App._engineAuthLibtvSendCode(this)">发送验证码</button>' +
            '</div>' +
            '<div id="ltvPhoneMsg" style="font-size:11px;color:var(--text-muted);"></div>';
        var input = document.getElementById('ltvPhoneInput');
        if (input) { input.focus(); input.select(); }
    },

    // 发送验证码
    async _engineAuthLibtvSendCode(btn) {
        var input = document.getElementById('ltvPhoneInput');
        var msg = document.getElementById('ltvPhoneMsg');
        var phone = input ? input.value.trim() : '';
        if (!/^\d{11}$/.test(phone)) { if (msg) msg.innerHTML = '<span style="color:#ef4444;">请输入 11 位手机号</span>'; return; }
        this._ltvPhone = phone;
        this._engineAuthBtnBusy(btn, true, '发送中...');
        if (msg) msg.innerHTML = '<span style="color:var(--text-muted);">正在发送验证码...</span>';
        try {
            var d = await this.fetchJSON('/api/v2/libtv/auth/login-phone', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phone })
            });
            this._engineAuthBtnBusy(btn, false);
            if (d && d.ok && d.logged_in) {
                if (msg) msg.innerHTML = '<span style="color:#10b981;">✓ 登录成功！</span>';
                this._engineAuthLibtv();
                this.showToast('LibTV 登录成功', 'success');
                return;
            }
            if (d && d.need_captcha) {
                if (msg) msg.innerHTML = '<span style="color:#f59e0b;">需要人机验证，请在浏览器弹出页完成验证后重试</span>';
                return;
            }
            if (!d || !d.ok) {
                // send 步骤：CLI 提示"已发送"视为成功，否则报错
                var sendErr = (d && d.error) || '';
                if (!/已发送|发送成功|验证码已|sent|success/i.test(sendErr)) {
                    if (msg) msg.innerHTML = '<span style="color:#ef4444;">' + App._escape(sendErr || '发送失败') + '</span>';
                    return;
                }
            }
            if (msg) msg.innerHTML = '<span style="color:#10b981;">验证码已发送，请输入：</span>';
            var flow = document.getElementById('engineAuthLibtvFlow');
            if (flow) flow.innerHTML +=
                '<div style="display:flex;gap:6px;margin-top:6px;">' +
                '<input id="ltvCodeInput" type="text" maxlength="6" inputmode="numeric" placeholder="6 位验证码" class="modal-input" style="flex:1;min-width:0;">' +
                '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;white-space:nowrap;" onclick="App._engineAuthLibtvVerifyCode(this)">完成登录</button>' +
                '</div>';
            var ci = document.getElementById('ltvCodeInput');
            if (ci) ci.focus();
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            if (msg) msg.innerHTML = '<span style="color:#ef4444;">发送失败: ' + App._escape(e.message) + '</span>';
        }
    },

    // 验证验证码
    async _engineAuthLibtvVerifyCode(btn) {
        var ci = document.getElementById('ltvCodeInput');
        var msg = document.getElementById('ltvPhoneMsg');
        var code = ci ? ci.value.trim() : '';
        if (!code) { if (msg) msg.innerHTML = '<span style="color:#ef4444;">请输入验证码</span>'; return; }
        this._engineAuthBtnBusy(btn, true, '验证中...');
        if (msg) msg.innerHTML = '<span style="color:var(--text-muted);">正在验证...</span>';
        try {
            var d = await this.fetchJSON('/api/v2/libtv/auth/login-phone', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: this._ltvPhone || '', code: code })
            });
            this._engineAuthBtnBusy(btn, false);
            if (d && d.ok && d.logged_in) {
                if (msg) msg.innerHTML = '<span style="color:#10b981;">✓ 登录成功！</span>';
                this._engineAuthLibtv();
                this.showToast('LibTV 登录成功', 'success');
            } else {
                if (msg) msg.innerHTML = '<span style="color:#ef4444;">登录失败: ' + App._escape(d && d.error || '未知错误') + '</span>';
            }
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            if (msg) msg.innerHTML = '<span style="color:#ef4444;">验证失败: ' + App._escape(e.message) + '</span>';
        }
    },

    // LibTV 切换账号
    async _engineAuthLibtvUse(accountId) {
        try {
            var d = await this.fetchJSON('/api/v2/libtv/auth/account-use', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_id: accountId })
            });
            if (d && d.ok) {
                this.showToast('已切换账号: ' + (d.accountName || accountId), 'success');
                this._engineAuthLibtv();
            } else {
                this.showToast('切换失败: ' + (d && d.error || ''), 'error');
            }
        } catch(e) {
            this.showToast('切换异常: ' + e.message, 'error');
        }
    },

    // LibTV 退出登录
    async _engineAuthLibtvLogout(btn) {
        if (!confirm('确认退出 LibTV 登录？')) return;
        this._engineAuthBtnBusy(btn, true, '退出中...');
        try {
            await this.fetchJSON('/api/v2/libtv/auth/logout', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this._engineAuthBtnBusy(btn, false);
            this.showToast('已退出 LibTV 登录', 'success');
            this._engineAuthLibtv();
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            this.showToast('退出失败: ' + e.message, 'error');
        }
    },
});
})();
