/**
 * PromptKit — app_tools 模块分片 (modal_exec)
 * 自 app_tools.js 拆分（Phase 3.5），方法经 this 互访
 */
(function() {
'use strict';
Object.assign(App, {

    showImportModal() {
        document.getElementById('modalImportExport').style.display = 'flex';
        this.switchIETab('import');
    },


    showExportModal() {
        document.getElementById('modalImportExport').style.display = 'flex';
        this.switchIETab('export');
        this._updateExportBtn();
    },

    // ============ 截图导入 ============


    async openScreenshotImport() {
        // 重置状态
        this._ssTempImage = '';
        this._ssHasImage = false;
        this._ssContinueMode = false;
        document.getElementById('ssUploadArea').style.display = 'block';
        document.getElementById('ssLoading').style.display = 'none';
        document.getElementById('ssPreviewArea').style.display = 'none';
        document.getElementById('ssError').style.display = 'none';
        document.getElementById('ssBtnImport').style.display = 'none';
        document.getElementById('ssBtnContinue').style.display = 'none';
        document.getElementById('ssBtnRetry').style.display = 'none';
        document.getElementById('ssFileInput').value = '';
        document.getElementById('ssPastePreview').style.display = 'none';
        this._ssPasteFile = null;
        this._populateSSModule();
        document.getElementById('modalScreenshotImport').style.display = 'flex';
        // 弹窗打开时自动激活粘贴监听，Ctrl+V 直接进入分析
        this._activatePasteListener();
    },


    _populateSSModule() {
        var select = document.getElementById('ssModule');
        if (!select) return;
        var modules = this.state.modules || [];
        // 默认选中当前所在模块（侧边栏选中的模块），无选中时回退到现有值或 custom
        var currentVal = this.state.currentModule || select.value || 'custom';
        select.innerHTML = '';
        var hasOptions = false;
        for (var i = 0; i < modules.length; i++) {
            var m = modules[i];
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === currentVal) opt.selected = true;
            select.appendChild(opt);
            hasOptions = true;
        }
        if (!hasOptions) {
            var fb = { emotion: '人物表情', color: App._t('auto.str_67a7c94b', '场景色彩'), tone: '画面色调', composition: App._t('auto.str_bec46210', '构图运镜'), seedance: App._t('auto.str_b19db4a1', '视频模板'), custom: App._t('auto.custom_', '自定义') };
            for (var k in fb) {
                var opt2 = document.createElement('option');
                opt2.value = k;
                opt2.textContent = fb[k];
                if (k === currentVal) opt2.selected = true;
                select.appendChild(opt2);
            }
        }
    },


    async _onSSFileSelect(event) {
        var file = event.target.files[0];
        if (!file) return;
        this._processSSFile(file);
    },


    async _processSSFile(file) {
        var self = this;
        document.getElementById('ssUploadArea').style.display = 'none';
        document.getElementById('ssLoading').style.display = 'block';
        document.getElementById('ssPreviewArea').style.display = 'none';
        document.getElementById('ssError').style.display = 'none';
        document.getElementById('ssBtnImport').style.display = 'none';
        document.getElementById('ssBtnContinue').style.display = 'none';
        document.getElementById('ssBtnRetry').style.display = 'none';

        var formData = new FormData();
        formData.append('file', file);

        try {
            var resp = await fetch('/api/v2/ocr/preview', { method: 'POST', body: formData, signal: controller.signal });
            var data = await resp.json();

            document.getElementById('ssLoading').style.display = 'none';

            if (!data.ok) {
                var errEl = document.getElementById('ssError');
                errEl.innerHTML = '<strong>\u274c ' + (data.error || App._t('auto.str_80ce4593', '识别未完成')) + '</strong><br><span style="font-size:12px;margin-top:8px;display:block;">\u8bf7\u786e\u8ba4 Ollama \u6b63\u5728\u8fd0\u884c\u4e14\u6709\u89c6\u89c9\u6a21\u578b\u53ef\u7528\u3002</span>';
                errEl.style.display = 'block';
                document.getElementById('ssBtnRetry').style.display = 'inline-block';
                return;
            }

            var preview = data.preview || {};
            self._ssTempImage = (data.temp_files && data.temp_files.image) || '';
            self._ssHasImage = data.layout && data.layout.has_image_region;

            var content = preview.content || '';
            document.getElementById('ssContent').value = content;
            document.getElementById('ssMeaning').value = preview.meaning || '';
            document.getElementById('ssScene').value = preview.scene || '';
            document.getElementById('ssCategory').value = preview.category || App._t('auto.str_351d7032', 'OCR导入');
            document.getElementById('ssTags').value = JSON.stringify(preview.tags || []);
            document.getElementById('ssTips').value = preview.tips || '';

            this._populateSSModule();
            var groupSelect = document.getElementById('ssModule');
            if (preview.module && preview.module !== 'custom') {
                for (var i = 0; i < groupSelect.options.length; i++) {
                    if (groupSelect.options[i].value === preview.module) {
                        groupSelect.value = preview.module;
                        break;
                    }
                }
            }

            if (self._ssHasImage && self._ssTempImage) {
                document.getElementById('ssThumbPreview').innerHTML = '<img src="/api/v2/ocr/temp-file/' + self._ssTempImage + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">';
            } else {
                document.getElementById('ssThumbPreview').textContent = '无效果图';
            }

            var rawText = content;
            if (preview.meaning) rawText += '\n' + preview.meaning;
            if (preview.tips) rawText += '\n\u2728 ' + preview.tips;
            document.getElementById('ssRawText').textContent = rawText.substring(0, 300) + (rawText.length > 300 ? '...' : '');

            document.getElementById('ssPreviewArea').style.display = 'block';
            document.getElementById('ssBtnImport').style.display = 'inline-block';
            document.getElementById('ssBtnContinue').style.display = 'inline-block';
            if (data.error) {
                document.getElementById('ssBtnRetry').style.display = 'inline-block';
            }

            // 去重检查
            if (content) {
                try {
                    var dupResp = await fetch('/api/v2/ocr/check-duplicate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: content })
                    });
                    var dupData = await dupResp.json();
                    if (dupData && dupData.ok && dupData.duplicate) {
                        self.showToast('\u26a0\ufe0f 已存在相同内容的词条 (模块: ' + (dupData.exists[0]?.module || '?') + App._t('auto.str_846a227a', ')，请确认'), 'warning', 6000);
                        document.getElementById('ssContent').style.borderColor = '#f59e0b';
                    } else {
                        document.getElementById('ssContent').style.borderColor = '';
                    }
                } catch(e) {}
            }

            setTimeout(function() { var c = document.getElementById('ssContent'); if (c) { c.focus(); c.select(); } }, 50);
        } catch(e) {
            document.getElementById('ssLoading').style.display = 'none';
            var errEl = document.getElementById('ssError');
            errEl.innerHTML = '<strong>\u274c 请求未响应: ' + this._escape(e.message) + '</strong><br><span style="font-size:12px;margin-top:8px;display:block;">\u8bf7\u68c0\u67e5\u540e\u7aef\u670d\u52a1\u548c Ollama \u662f\u5426\u8fd0\u884c</span>';
            errEl.style.display = 'block';
            document.getElementById('ssBtnRetry').style.display = 'inline-block';
        }
    },


    async _confirmSSImport(continueMode) {
        var content = document.getElementById('ssContent').value.trim();
        if (!content) { this.showToast(App._t('editor.enter_content', '请输入提示词内容'), 'error'); return; }

        var tags = document.getElementById('ssTags').value.trim();
        try { tags = JSON.parse(tags || '[]'); } catch(e) { tags = []; }
        if (!Array.isArray(tags)) tags = [];

        var data = {
            content: content,
            meaning: document.getElementById('ssMeaning').value.trim(),
            scene: document.getElementById('ssScene').value.trim(),
            module: document.getElementById('ssModule').value,
            category: document.getElementById('ssCategory').value.trim() || App._t('auto.str_351d7032', 'OCR导入'),
            tags: tags,
            tips: document.getElementById('ssTips').value.trim(),
            temp_image: this._ssTempImage || '',
            has_image: this._ssHasImage
        };

        this.showToast(App._t('auto.str_e42eb5eb', '\u23f3 正在导入...'), 'info');
        var result = await this.fetchJSON('/api/v2/ocr/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (result && result.ok) {
            this.showToast(result.message || App._t('auto.str_878c8448', '\u2714 已导入'), 'success');
            // 先关弹窗，再刷新数据（防止 loadPrompts 异常阻塞关闭）
            if (continueMode) {
                this._ssTempImage = '';
                this._ssHasImage = false;
                document.getElementById('ssUploadArea').style.display = 'block';
                document.getElementById('ssPreviewArea').style.display = 'none';
                document.getElementById('ssBtnImport').style.display = 'none';
                document.getElementById('ssBtnContinue').style.display = 'none';
                document.getElementById('ssFileInput').value = '';
            } else {
                document.getElementById('modalScreenshotImport').style.display = 'none';
            }
            await this.loadPrompts();
            this.loadStats();
        } else {
            this.showToast(App._t('common.import', '导入未完成: ') + (result ? result.error : App._t('common.unknown_error', '遇到意外情况，请稍后再试')), 'error');
        }
    },


    _retrySSUpload() {
        document.getElementById('ssFileInput').click();
    },

        // 从剪贴板粘贴截图图片
    // navigator.clipboard.read() 只在 HTTPS/localhost 工作，
    // 激活粘贴监听器（弹窗打开时自动激活，Ctrl+V 直接走分析流程）
    // 局域网 HTTP 下 navigator.clipboard.read() 不可用，必须用 paste 事件

    _activatePasteListener() {
        var self = this;

        // 清理旧监听器
        var old = document.getElementById('ssPasteHelper');
        if (old) old.remove();
        if (this._ssPasteHandler) {
            document.removeEventListener('keydown', this._ssPasteHandler);
            this._ssPasteHandler = null;
        }

        // 创建隐藏 textarea 用于捕获 paste 事件
        var ta = document.createElement('textarea');
        ta.id = 'ssPasteHelper';
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();

        function cleanup() {
            var el = document.getElementById('ssPasteHelper');
            if (el) el.remove();
        }

        // 监听 paste 事件
        ta.addEventListener('paste', function(e) {
            e.preventDefault();
            self._handleClipboardPaste(e);
        });

        // 全局键盘监听：Ctrl+V 时截取剪贴板数据
        this._ssPasteHandler = function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                var modal = document.getElementById('modalScreenshotImport');
                if (!modal || modal.style.display === 'none') return;
                // 截取 clipboardData 传入处理函数
                var cd = e.clipboardData || window.clipboardData;
                setTimeout(function() {
                    self._handleClipboardPaste({clipboardData: cd});
                }, 10);
            }
        };
        document.addEventListener('keydown', this._ssPasteHandler);

        // 弹窗关闭时自动清理监听器
        var modal = document.getElementById('modalScreenshotImport');
        var observer = new MutationObserver(function() {
            if (modal.style.display === 'none') {
                cleanup();
                if (self._ssPasteHandler) {
                    document.removeEventListener('keydown', self._ssPasteHandler);
                    self._ssPasteHandler = null;
                }
                observer.disconnect();
            }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
    },

    // 处理剪贴板粘贴：提取图片 -> 显示预览 -> 确认后再分析

    _handleClipboardPaste(e) {
        var self = this;
        var items = e.clipboardData && e.clipboardData.items;
        if (!items || items.length === 0) {
            self.showToast(App._t('auto.str_14f1f992', '剪贴板中未找到图片'), 'warning');
            return;
        }

        // 提取图片 blob 的函数
        function showPastePreview(blob) {
            var file = new File([blob], 'clipboard_' + Date.now() + '.png', { type: blob.type });
            // 存为临时文件，等确认后再分析
            self._ssPasteFile = file;
            // 显示预览
            document.getElementById('ssUploadArea').style.display = 'none';
            var thumb = document.getElementById('ssPasteThumb');
            var url = URL.createObjectURL(blob);
            thumb.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:200px;object-fit:contain;border-radius:8px;">';
            document.getElementById('ssPastePreview').style.display = 'block';
            self.showToast('已粘贴截图，点击确认后开始分析', 'info', 2000);
        }

        // 尝试提取图片
        for (var i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.startsWith('image/')) {
                var blob = items[i].getAsFile ? items[i].getAsFile() : null;
                if (blob) { showPastePreview(blob); return; }
            }
        }

        // 没有直接图片，检查 text/html 中是否有 base64 图片（微信截图）
        for (var i = 0; i < items.length; i++) {
            if (items[i].type === 'text/html') {
                items[i].getAsString(function(html) {
                    var m = html.match(/<img[^>]+src=["']?(data:image\/[^"'>]+)["']?/i);
                    if (m) {
                        fetch(m[1]).then(function(r) { return r.blob(); }).then(function(blob) {
                            showPastePreview(blob);
                        }).catch(function() {
                            self.showToast(App._t('auto.str_7bd0314c', '解析剪贴板图片未完成'), 'error');
                        });
                    } else {
                        self.showToast('剪贴板中未找到图片，请先截图再按 Ctrl+V', 'warning', 3000);
                    }
                });
                return;
            }
        }

        self.showToast('剪贴板中未找到图片，请先截图再按 Ctrl+V', 'warning', 3000);
    },

    // 确认粘贴图片：开始分析

    _confirmSSPaste() {
        if (this._ssPasteFile) {
            document.getElementById('ssPastePreview').style.display = 'none';
            this._processSSFile(this._ssPasteFile);
        }
    },

    // 取消粘贴图片：返回上传区

    _cancelSSPaste() {
        this._ssPasteFile = null;
        document.getElementById('ssPastePreview').style.display = 'none';
        document.getElementById('ssUploadArea').style.display = 'block';
    },

    // 粘贴按钮点击：重新聚焦 + 提示用户按 Ctrl+V

    async _onSSPaste() {
        var self = this;
        var ta = document.getElementById('ssPasteHelper');
        if (!ta) {
            this._activatePasteListener();
            ta = document.getElementById('ssPasteHelper');
        }
        if (ta) {
            ta.focus();
            ta.select();
        }
        self.showToast('请按 Ctrl+V 粘贴截图', 'info', 3000);
    },switchIETab(tab) {
        document.getElementById('ieTabImport').className = tab === 'import' ? 'seedance-tab active' : 'seedance-tab';
        document.getElementById('ieTabExport').className = tab === 'export' ? 'seedance-tab active' : 'seedance-tab';
        document.getElementById('ieImportPanel').style.display = tab === 'import' ? 'block' : 'none';
        document.getElementById('ieExportPanel').style.display = tab === 'export' ? 'block' : 'none';
        document.getElementById('modalIETitle').textContent = tab === 'import' ? App._t('common.import', '导入提示词') : App._t('common.export', '导出提示词');
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
        if (!files || files.length === 0) { this.showToast(App._t('auto.please_选择文件', '请先选择文件'), 'error'); return; }
        var conflict = document.getElementById('ieConflictSelect').value;
        var btn = document.getElementById('btnDoImport');
        btn.disabled = true; btn.textContent = App._t('auto.ing_导入___', '正在导入...');
        var created = 0, skipped = 0, failed = 0;
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var formData = new FormData();
            formData.append('file', file);
            try {
                var name = file.name.toLowerCase();
                var endpoint;
                if (name.endsWith('.json')) {
                    // 2026-08-03 对齐: JSON 弹窗导入改走 from-json-data（写 word_card 词库，
                    // 原 import-json 写 prompts 旧表导致词库看不到导入结果）
                    var txt = await file.text();
                    var parsed = JSON.parse(txt);
                    var jitems = parsed.prompts || parsed;
                    if (!Array.isArray(jitems)) jitems = [jitems];
                    jitems = jitems.filter(function(it) { return it && (it.content || it.prompt); })
                        .map(function(it) {
                            if (!it.content && it.prompt) it.content = it.prompt;
                            return it;
                        });
                    var rj = await this.fetchJSON('/api/v2/import/from-json-data', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ items: jitems, conflict: conflict })
                    });
                    if (rj && rj.ok) { created += rj.created || 0; skipped += rj.skipped || 0; failed += rj.failed || 0; }
                    else failed++;
                    continue;
                } else if (name.endsWith('.txt') || name.endsWith('.md')) {
                    // 2026-08-03 新增: TXT/MD 弹窗导入 — 解析后写 word_card
                    var pt = await fetch('/api/export/preview-text', { method: 'POST', body: formData });
                    var pd = await pt.json();
                    if (pd.ok && pd.items && pd.items.length > 0) {
                        var rj2 = await this.fetchJSON('/api/v2/import/from-json-data', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ items: pd.items, conflict: conflict })
                        });
                        if (rj2 && rj2.ok) { created += rj2.created || 0; skipped += rj2.skipped || 0; failed += rj2.failed || 0; }
                        else failed++;
                    } else {
                        failed++;
                    }
                    continue;
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
        btn.disabled = false; btn.textContent = App._t('auto.str_7d2ff42c', '开始导入');
        var el = document.getElementById('ieImportResult');
        el.style.display = 'block';
        el.style.color = failed > 0 ? '#ef4444' : '#059669';
        el.innerHTML = App._t('common.import', '导入完成: ') + created + ' 成功, ' + skipped + ' 跳过, ' + failed + App._t('auto.str_f73d0c19', ' 未完成');
        if (created > 0) await this.loadPrompts();
    },


    async doExport() {
        var fmt = document.querySelector('input[name="exportFmt"]:checked');
        fmt = fmt ? fmt.value : 'png';
        var scope = document.getElementById('ieExportScope').value;
        var btn = document.getElementById('btnDoExport');
        btn.disabled = true; btn.textContent = App._t('auto.ing_导出___', '正在导出...');
        var ids = [];
        if (scope === 'selected') {
            ids = [...this.state.batchSelected];
            if (ids.length === 0) { this.showToast(App._t('auto.please_选择词条', '请先选择词条'), 'error'); btn.disabled = false; btn.textContent = App._t('common.export', '导出'); return; }
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
            if (mods.length === 0) { this.showToast(App._t('auto.select_至少一个模块', '请选择至少一个模块'), 'error'); btn.disabled = false; btn.textContent = App._t('common.export', '导出'); return; }
            var allData = await this.fetchJSON('/api/prompts?page_size=500');
            if (allData && allData.items) {
                ids = allData.items.filter(function(p) { return mods.indexOf(p.module) >= 0; }).map(function(p) { return p.id; });
            }
        }
        if (ids.length === 0) { this.showToast('没有可导出的词条', 'error'); btn.disabled = false; btn.textContent = App._t('common.export', '导出'); return; }
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
            document.getElementById('ieExportResult').innerHTML = App._t('common.export', '导出成功，') + ids.length + App._t('auto.str_0759f025', ' 条词条已下载') + ' <button class="btn btn-sm" style="margin-left:8px;background:rgba(34,197,94,0.12);border:1px solid #22c55e;color:#22c55e;padding:3px 10px;border-radius:6px;cursor:pointer;" onclick="App._openExportFolder()">📂 打开下载文件夹</button>';
        } catch(e) {
            document.getElementById('ieExportResult').style.display = 'block';
            document.getElementById('ieExportResult').style.color = '#ef4444';
            document.getElementById('ieExportResult').innerHTML = App._t('common.export', '导出未完成: ') + e.message;
        }
        btn.disabled = false; btn.textContent = App._t('common.export', '导出');
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


    async batchAddToCollection() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择提示词', '请先选择提示词'), 'error'); return; }
        const data = await this.fetchJSON('/api/v2/collections');
        const list = (data && data.items) || [];
        if (!list.length) { this.showToast('请先在「词卡收藏」新建一个分组', 'error'); return; }
        document.getElementById('modalAddToTitle').textContent = '添加到收藏';
        let html = '<p style="margin-bottom:12px;font-size:13px;color:var(--text-muted);">选择要添加到的收藏分组:</p>';
        for (const c of list) {
            html += '<div class="cat-tab" style="display:block;margin-bottom:6px;text-align:left;" data-cid="' + c.id + '" data-cname="' + App._escape(c.name) + '" onclick="App._onAddToCollClick(this)">' + (c.icon || '⭐') + ' ' + App._escape(c.name) + ' (' + (c.item_count || 0) + ' 条)</div>';
        }
        document.getElementById('wordpackSelectList').innerHTML = html;
        document.getElementById('modalAddToWordpack').style.display = 'flex';
    },


    _onAddToCollClick(el) {
        var cid = parseInt(el.getAttribute('data-cid'));
        var cname = el.getAttribute('data-cname') || '';
        this.doAddToCollection(cid, cname);
    },


    async doAddToCollection(cid, cname) {
        const ids = [...this.state.batchSelected];
        const data = await this.fetchJSON('/api/v2/collections/' + cid + '/items/batch-add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        document.getElementById('modalAddToWordpack').style.display = 'none';
        if (data) {
            this.showToast('已添加 ' + data.added + ' 条到「' + cname + '」', 'success');
            this._afterBatchOp();
            if (this.loadCollections) this.loadCollections();
        }
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
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择词条', '请先选择词条'), 'error'); return; }
        var tags = prompt(App._t('auto.str_5bb0d666', '输入标签（多个用逗号分隔）:\n例如: 自然,温暖,户外'));
        if (!tags) return;
        var list = tags.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; });
        if (list.length === 0) return;
        var mode = confirm(App._t('common.ok', '确定添加标签？\n\n取消 = 移除这些标签')) ? 'add' : 'remove';
        var data = await this.fetchJSON('/api/v2/tags/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids, tags: list, mode: mode })
        });
        if (data && data.ok) {
            this.showToast('已' + (mode === 'add' ? '添加' : '移除') + ' ' + data.updated + App._t('auto.str_2892f5d4', ' 条词条的标签'), 'success');
            this.loadPrompts();
        } else {
            this.showToast(App._t('common.op_failed', '操作未完成，稍后再试'), 'error');
        }
    },
});
})();
