/**
 * PromptKit — app_tools 模块分片 (drop_export)
 * 自 app_tools.js 拆分（Phase 3.5），方法经 this 互访
 */
(function() {
'use strict';
Object.assign(App, {

    _applyImportGroupPriority(items) {
        var origGid = null, origGname = '';
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it && it.group_id) {
                origGid = it.group_id;
                origGname = it.group_name || '';
                break;
            }
        }
        this._diPngGroupId = origGid;
        if (origGid && !origGname && this.state.groupTree) {
            (function findG(nodes) {
                for (var j = 0; j < nodes.length; j++) {
                    if (String(nodes[j].id) === String(origGid)) { origGname = nodes[j].name || ''; return true; }
                    if (nodes[j].children && findG(nodes[j].children)) return true;
                }
                return false;
            })(this.state.groupTree);
        }
        this._diPngGroupName = origGname;
        // 第二顺位: 当前所在分组（●）
        this._diCurrentGroupId = App.state.currentGroupId || null;
    },


    async handleDropPngFile(file) {
        try {
            // 立即读取文件为 ArrayBuffer，避免拖拽 File 流被消耗后无法复用
            this._diPngBuffer = await file.arrayBuffer();
            this._diPngName = file.name;

            var formData = new FormData();
            formData.append('file', new File([this._diPngBuffer], this._diPngName, {type: 'image/png'}));
            var resp = await fetch('/api/export/preview-png', { method: 'POST', body: formData });
            var preview = await resp.json();
            if (!preview.ok || !preview.preview) {
                this.showToast(App._t('auto.str_694bb111', '该 PNG 不包含有效的提示词数据'), 'error');
                return;
            }
            var p = preview.preview;
            var item = {
                content: p.content || '',
                meaning: p.meaning || '',
                scene: p.scene || '',
                module: p.module || 'custom',
                category: p.category || '',
                tags: p.tags || [],
                group_id: p.group_id || null,        // PNG 中存储的原始分组
                group_name: p.group_name || ''        // 分组名称用于显示
            };
            // 记录 PNG 识别的分组信息（供下拉排序用）
            this._applyImportGroupPriority([item]);
            // 记录当前页面所在分组（第二顺位）
            this._diFile = file;
            this._diItems = [item];
            this._diIsPt = false;
            this._diIsPng = true;
            this._diPngFile = file;
            document.getElementById('diFileName').textContent = file.name;
            document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + App._t('auto.str_8311d110', ' KB · 1 条提示词');
            document.getElementById('diCount').textContent = App._t('auto.str_25287afe', '共 1 条提示词');
            this._renderDiItems([item]);
            document.getElementById('diSelectAll').checked = true;
            document.getElementById('diResult').style.display = 'none';
            document.getElementById('btnDiImport').disabled = false;
            document.getElementById('btnDiImport').innerHTML = App._t('auto.str_fc69a499', '<i class="bi bi-check-lg"></i> 确认导入');
            document.getElementById('btnDiImport').onclick = function() { App._confirmDropImport(); };
            document.getElementById('modalDropImport').style.display = 'flex';
        } catch (e) {
            this.showToast('PNG 未能解析: ' + e.message, 'error');
        }
    },


    async _handleDropFile(file) {
        // 读取并解析 JSON
        var text = await file.text();
        var data;
        try {
            data = JSON.parse(text);
        } catch(e) {
            this.showToast('JSON 未能解析：' + e.message, 'error');
            return;
        }
        // 兼容两种格式：{prompts: [...]} 或直接数组
        var items = data.prompts || data;
        if (!Array.isArray(items) || items.length === 0) {
            this.showToast(App._t('auto.str_88178d1c', '未找到有效的提示词数据'), 'error');
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
        // 2026-08-03 统一: 识别 JSON 内 group_id 为第一顺位(★)，当前分组第二顺位(●)
        this._applyImportGroupPriority(items);

        // 填充弹窗信息
        document.getElementById('diFileName').textContent = file.name;
        document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB · ' + items.length + App._t('auto.str_6f2666c1', ' 条提示词');
        document.getElementById('diCount').textContent = '共 ' + items.length + App._t('auto.str_6f2666c1', ' 条提示词');

        // 统一渲染预览列表
        this._renderDiItems(items);

        document.getElementById('diSelectAll').checked = true;
        document.getElementById('diResult').style.display = 'none';
        document.getElementById('btnDiImport').disabled = false;
        document.getElementById('btnDiImport').innerHTML = App._t('auto.str_fc69a499', '<i class="bi bi-check-lg"></i> 确认导入');

        // 显示弹窗
        document.getElementById('modalDropImport').style.display = 'flex';
    },

    // ============ TXT/MD 拖拽导入（2026-08-03 对齐 PNG 链路新增） ============

    async _handleDropTextFile(file) {
        try {
            var formData = new FormData();
            formData.append('file', file);
            var resp = await fetch('/api/export/preview-text', { method: 'POST', body: formData });
            var d = await resp.json();
            if (!d.ok || !d.items || d.items.length === 0) {
                this.showToast('未识别到有效的提示词条目', 'error');
                return;
            }
            var items = d.items.map(function(it) {
                return {
                    content: it.content || '',
                    meaning: it.meaning || '',
                    module: it.module || 'custom',
                    category: it.category || '',
                    tags: []
                };
            });
            this._diFile = file;
            this._diItems = items;
            this._diIsPt = false;
            this._diIsPng = false;
            // 2026-08-03 统一: TXT/MD 无原始分组信息（格式限制），当前分组第二顺位(●) 生效
            this._applyImportGroupPriority(items);
            document.getElementById('diFileName').textContent = file.name;
            document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB · ' + items.length + ' 条提示词';
            document.getElementById('diCount').textContent = '共 ' + items.length + ' 条提示词';
            this._renderDiItems(items);
            document.getElementById('diSelectAll').checked = true;
            document.getElementById('diResult').style.display = 'none';
            document.getElementById('btnDiImport').disabled = false;
            document.getElementById('btnDiImport').innerHTML = '<i class="bi bi-check-lg"></i> 确认导入';
            document.getElementById('btnDiImport').onclick = function() { App._confirmDropImport(); };
            document.getElementById('modalDropImport').style.display = 'flex';
        } catch (e) {
            this.showToast('TXT/MD 未能解析: ' + e.message, 'error');
        }
    },

    // ============ 导入预览渲染（JSON / .pt / PNG 共用） ============


    _renderDiItems(items) {
        var container = document.getElementById('diItemList');
        // 构建分组选项（扁平化，按优先级排序）：
        // Tier 0: PNG识别分组（第一顺位，★）
        // Tier 1: 当前所在分组（第二顺位，●）
        // Tier 2: 其余分组
        var pngGid = this._diPngGroupId;
        var curGid = this._diCurrentGroupId;
        var pngGname = this._diPngGroupName || '';

        function flattenGroups(groups, depth) {
            depth = depth || 0;
            var result = [];
            for (var gi = 0; gi < groups.length; gi++) {
                var g = groups[gi];
                if (g.group_type === 'atom') continue;
                var prefix = '';
                for (var d = 0; d < depth; d++) prefix += '　';
                result.push({ id: g.id, name: prefix + (g.icon||'📁') + ' ' + App._escape(g.name || g.group_key || ''), depth: depth });
                if (g.children && g.children.length > 0) {
                    var children = flattenGroups(g.children, depth + 1);
                    result = result.concat(children);
                }
            }
            return result;
        }

        var allGroups = [];
        var seenIds = {};
        if (this.state.groupTree) allGroups = flattenGroups(this.state.groupTree);
        for (var gi = 0; gi < allGroups.length; gi++) {
            seenIds[allGroups[gi].id] = true;
        }

        // 兜底：PNG分组或当前分组不在tree中时，手动补充（groupTree可能尚未加载或分组已移动）
        function ensureGroup(gid, gname) {
            if (!gid || seenIds[gid]) return;
            allGroups.unshift({ id: gid, name: '📁 ' + App._escape(gname || '分组#' + gid), depth: 0 });
            seenIds[gid] = true;
        }
        ensureGroup(pngGid, pngGname);
        
        // 获取当前分组名称（树中查找）
        var curGname = '';
        if (curGid) {
            for (var gi = 0; gi < allGroups.length; gi++) {
                if (allGroups[gi].id == curGid) { curGname = allGroups[gi].name; break; }
            }
            if (!seenIds[curGid]) {
                allGroups.unshift({ id: curGid, name: '📁 当前分组#' + curGid, depth: 0 });
                seenIds[curGid] = true;
            }
        }

        // 优先级排序（稳定：PNG分组前置，当前分组织前）
        function getPriority(g) {
            if (g.id == pngGid) return 0;
            if (g.id == curGid) return 1;
            return 2;
        }
        allGroups.sort(function(a, b) {
            var pa = getPriority(a), pb = getPriority(b);
            if (pa !== pb) return pa - pb;
            return 0;
        });

        // 拼接下拉选项
        var groupOpts = '<option value="">-- 无分组 --</option>';
        for (var gi = 0; gi < allGroups.length; gi++) {
            var g = allGroups[gi];
            var optText = g.name;
            if (g.id == pngGid) optText += ' ★ (PNG原分组)';
            else if (g.id == curGid && g.id != pngGid) optText += ' ● (当前分组)';
            groupOpts += '<option value="' + g.id + '">' + optText + '</option>';
        }

        // 默认选中：PNG原始分组 > 当前分组
        var defaultGid = pngGid || curGid || '';

        var html = '<table>';
        html += '<thead><tr><th style="width:30px;"></th><th>分组</th><th>分类</th><th>词条内容（点击编辑）</th></tr></thead><tbody>';
        var limit = Math.min(50, items.length);
        for (var i = 0; i < limit; i++) {
            var item = items[i];
            var escContent = this._escape(item.content || '');
            var itemGroupId = item.group_id || '';
            var selGid = itemGroupId || defaultGid || '';
            // 确保选中分组在选项中（包括兜底补充的分组）
            if (selGid && !seenIds[selGid] && this._diPngGroupName) {
                ensureGroup(selGid, this._diPngGroupName);
                // 重建 groupOpts
                groupOpts = '<option value="">-- 无分组 --</option>';
                for (var gi2 = 0; gi2 < allGroups.length; gi2++) {
                    var g2 = allGroups[gi2];
                    var ot = g2.name;
                    if (g2.id == pngGid) ot += ' ★ (PNG原分组)';
                    else if (g2.id == curGid && g2.id != pngGid) ot += ' ● (当前分组)';
                    groupOpts += '<option value="' + g2.id + '">' + ot + '</option>';
                }
            }
            var escCategory = this._escape(item.category || '通用');
            var optHtml = groupOpts.replace('value="' + selGid + '"', 'value="' + selGid + '" selected');
            html += '<tr>';
            html += '<td><input type="checkbox" class="di-item-cb" data-idx="' + i + '" checked onchange="App._updateDiCount()"></td>';
            html += '<td><select class="di-group-select" data-idx="' + i + '">' + optHtml + '</select></td>';
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
        if (cbs.length === 0) { this.showToast(App._t('auto.str_c31cfbc9', '请至少选择一条提示词'), 'error'); return; }
        var btn = document.getElementById('btnDiImport');
        btn.disabled = true;
        btn.innerHTML = App._t('auto.str_8d04383b', '<div class="spinner-border spinner-border-sm" role="status"></div> 正在导入...');

        var data;
        if (this._diIsPng && this._diPngBuffer) {
            // PNG 导入：收集用户编辑覆盖
            var conflict = document.getElementById('diConflictSelect').value;
            var overrides = [];
            for (var cbi = 0; cbi < cbs.length; cbi++) {
                var idx = parseInt(cbs[cbi].getAttribute('data-idx'));
                var contentInput = document.querySelector('.di-content-input[data-idx="' + idx + '"]');
                var groupSelect = document.querySelector('.di-group-select[data-idx="' + idx + '"]');
                var categoryInput = document.querySelector('.di-category-input[data-idx="' + idx + '"]');
                overrides.push({
                    content: contentInput ? contentInput.value.trim() : null,
                    group_id: groupSelect ? parseInt(groupSelect.value) || null : null,
                    category: categoryInput ? categoryInput.value.trim() : null
                });
            }
            var formData = new FormData();
            // 使用缓存的 ArrayBuffer 重建 File，避免拖拽 File 流被消费后失效
            formData.append('file', new File([this._diPngBuffer], this._diPngName, {type: 'image/png'}));
            formData.append('conflict', conflict);
            formData.append('overrides', JSON.stringify(overrides));
            try {
                var resp = await fetch('/api/export/import-png', { method: 'POST', body: formData });
                data = await resp.json();
            } catch (e) {
                this.showToast(App._t('auto.str_faed53ba', 'PNG 导入未完成'), 'error');
                btn.disabled = false; btn.innerHTML = App._t('auto.str_fc69a499', '<i class="bi bi-check-lg"></i> 确认导入');
                return;
            }
            // 标准化返回值（后端 import-png 返回 {ok, result}，统一为 {created, skipped, failed}）
            if (data && data.ok) {
                var r = data.result || {};
                if (r.created === true || r.created === 'true' || r.created > 0) {
                    data.created = 1;
                    data.skipped = 0;
                    data.failed = 0;
                } else if (r.reason === 'skip' || r.created === false) {
                    data.created = 0;
                    data.skipped = 1;
                    data.failed = 0;
                } else {
                    // 检查是否 result 本身就包含 created/skipped
                    if (typeof data.created === 'undefined') data.created = 0;
                    if (typeof data.skipped === 'undefined') data.skipped = 0;
                    if (typeof data.failed === 'undefined') data.failed = 0;
                }
            } else {
                data = { created: 0, skipped: 0, failed: 1 };
            }
        } else if (this._diIsPt) {
            // .pt 包导入：收集用户编辑覆盖 + 上传原文件
            var overrides = [];
            for (var cbi = 0; cbi < cbs.length; cbi++) {
                var idx = parseInt(cbs[cbi].getAttribute('data-idx'));
                var contentInput = document.querySelector('.di-content-input[data-idx="' + idx + '"]');
                var groupSelect = document.querySelector('.di-group-select[data-idx="' + idx + '"]');
                var categoryInput = document.querySelector('.di-category-input[data-idx="' + idx + '"]');
                overrides.push({
                    content: contentInput ? contentInput.value.trim() : null,
                    group_id: groupSelect ? parseInt(groupSelect.value) || null : null,
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
                this.showToast(App._t('common.import', '导入未完成'), 'error');
                btn.disabled = false; btn.innerHTML = App._t('auto.str_fc69a499', '<i class="bi bi-check-lg"></i> 确认导入');
                return;
            }
        } else {
            // JSON 导入：收集编辑后的值
            var items = [];
            for (var i = 0; i < cbs.length; i++) {
                var idx = parseInt(cbs[i].getAttribute('data-idx'));
                var original = this._diItems[idx];
                var contentInput = document.querySelector('.di-content-input[data-idx="' + idx + '"]');
                var groupSelect = document.querySelector('.di-group-select[data-idx="' + idx + '"]');
                var categoryInput = document.querySelector('.di-category-input[data-idx="' + idx + '"]');
                items.push({
                    content: contentInput ? contentInput.value.trim() : (original.content || ''),
                    meaning: original.meaning || '',
                    scene: original.scene || '',
                    group_id: groupSelect ? parseInt(groupSelect.value) || null : null,
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
            btn.disabled = false; btn.innerHTML = App._t('auto.str_fc69a499', '<i class="bi bi-check-lg"></i> 确认导入');
            this.showToast(App._t('common.import', '导入未完成，请重试'), 'error');
            return;
        }

        var resultEl = document.getElementById('diResult');
        resultEl.style.display = 'block';
        if (data.failed > 0) {
            resultEl.style.color = '#ef4444';
            resultEl.innerHTML = App._t('common.import', '导入完成：') + data.created + ' 成功, ' + data.skipped + ' 跳过, ' + data.failed + App._t('auto.str_f73d0c19', ' 未完成');
        } else {
            resultEl.style.color = '#059669';
            resultEl.innerHTML = '✅ 导入成功！' + data.created + ' 条提示词已添加';
        }

        btn.disabled = false; btn.innerHTML = '✅ 已完成';
        btn.onclick = function() { document.getElementById('modalDropImport').style.display = 'none'; };

        if (data.created > 0) {
            this.state.page = 1;
            // 跳转到用户选择的分组（取第一个选中行）
            var targetGroupId = null;
            if (cbs.length > 0) {
                var firstIdx = parseInt(cbs[0].getAttribute('data-idx'));
                var gs = document.querySelector('.di-group-select[data-idx="' + firstIdx + '"]');
                if (gs) targetGroupId = parseInt(gs.value) || this.state.currentGroupId;
            }
            if (targetGroupId) {
                await App.switchGroup(targetGroupId);
            } else {
                App.switchAllGroups();
            }
            // 确保数据加载完成（switchView 内部不 await loadPrompts，手动补偿）
            await App._wcLoadPrompts();
            this.showToast(App._t('common.success', '成功导入 ') + data.created + App._t('auto.str_6f2666c1', ' 条提示词'), 'success');
        }
    },

    // ============ .pt 包拖拽导入 ============


    async _handleDropPtFile(file) {
        var formData = new FormData();
        formData.append('file', file);
        var resp = await fetch('/api/v2/pt/preview', { method: 'POST', body: formData });
        if (!resp.ok) {
            var errText = await resp.text();
            this.showToast(App._t('auto.preview_失败__', '预览未完成: ') + errText, 'error');
            return;
        }
        var data = await resp.json();
        if (!data || !data.items || data.items.length === 0) {
            this.showToast(App._t('auto.str_88178d1c', '未找到有效的提示词数据'), 'error');
            return;
        }
        this._diPtFile = file;
        this._diIsPt = true;
        this._diItems = data.items;
        // 2026-08-03 统一: 识别 .pt 文件原始默认分组(第一顺位 ★) + 当前所在分组(第二顺位 ●)
        this._applyImportGroupPriority(data.items);
        document.getElementById('diFileName').textContent = file.name;
        document.getElementById('diFileSize').textContent = (file.size / 1024).toFixed(1) + ' KB \u00B7 ' + data.count + ' \u6761\u63D0\u793A\u8BCD';
        document.getElementById('diCount').textContent = '共 ' + data.count + App._t('auto.str_6f2666c1', ' 条提示词');
        this._renderDiItems(data.items);
        document.getElementById('diSelectAll').checked = true;
        document.getElementById('diResult').style.display = 'none';
        document.getElementById('btnDiImport').disabled = false;
        document.getElementById('btnDiImport').innerHTML = App._t('auto.str_fc69a499', '<i class="bi bi-check-lg"></i> 确认导入');
        document.getElementById('btnDiImport').onclick = function() { App._confirmDropImport(); };
        document.getElementById('modalDropImport').style.display = 'flex';
    },


    _copyExportPreview() {
        var text = document.getElementById('epContent').value;
        if (!text) { this.showToast(App._t('auto.str_cd2e83b1', '没有内容可复制'), 'error'); return; }
        this.copyText(text, App._t('common.copied', '已复制导出内容'));
    },


    clearEditSelection() {
        this.state.batchSelected.clear();
        this.renderPrompts();
        this.updateBatchCount();
    },


    async batchCopy() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择提示词', '请先选择提示词'), 'error'); return; }
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
        await this.copyText(text, App._t('common.copied', '已复制全部内容'));
    },


    async batchExport(fmt) {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择提示词', '请先选择提示词'), 'error'); return; }
        // 2026-08-03: 全部格式统一走命名弹窗（自定义文件名 + 保存目录），txt/md/json 不再直接下载
        this._exportQueue = { ids: ids, fmt: fmt };
        this._showExportNameDialog(ids, fmt);
    },

    // ============ 导出命名弹窗 ============


    _showExportNameDialog(ids, fmt) {
        var fmtLabels = { pt: '.pt 提示词包', png: 'PNG 卡片', txt: 'TXT 文本', md: 'Markdown', json: 'JSON 数据' };
        // 2026-08-03: png 标题固定为「导出PNG词卡」；txt/md/json 统一「导出X词卡」；pt 保持原样
        var title = fmt === 'png' ? '导出PNG词卡'
            : fmt === 'pt' ? '导出 .pt 提示词包'
            : ('导出' + fmt.toUpperCase() + '词卡');
        document.getElementById('exportNameTitle').textContent = title;
        var defaultName = this._makeExportFilename(ids, fmt).replace('.' + fmt, '');
        document.getElementById('exportNameInput').value = defaultName;
        document.getElementById('exportNameCount').textContent = '共 ' + ids.length + ' 条 · 格式: ' + (fmtLabels[fmt] || fmt.toUpperCase());

        var savedPath = localStorage.getItem('promptkit_export_path') || '';
        var pi = document.getElementById('exportPathInput');
        var se = document.getElementById('exportPathStatus');
        if (savedPath && (savedPath.includes(":\\") || savedPath.includes(":/"))) {
            pi.value = savedPath;
            if (se) { se.innerHTML = '\u2705 目录: <strong>' + savedPath + '</strong>'; se.style.color = '#059669'; }
        } else if (savedPath) {
            pi.value = '📁 ' + savedPath;
            if (se) { se.innerHTML = '\u2705 文件夹: <strong>' + savedPath + '</strong>'; se.style.color = '#059669'; }
        } else {
            // 2026-08-02: 默认缺省路径 = 下载文件夹（后端返回 %USERPROFILE%\Downloads）
            pi.value = '';
            if (se) { se.innerHTML = App._t('auto.str_8b8d2b65', '💡 点击输入框选择文件夹，或直接输入完整磁盘路径'); se.style.color = 'var(--text-muted)'; }
            var self = this;
            fetch('/api/utils/default-download-path', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            }).then(function(r) { return r.json(); }).then(function(d) {
                if (d.ok && d.path && document.getElementById('exportPathInput') === pi) {
                    pi.value = d.path;
                    if (se) { se.innerHTML = '✅ 默认目录: <strong>' + d.path + '</strong>'; se.style.color = '#059669'; }
                    localStorage.setItem('promptkit_export_path', d.path);
                }
            }).catch(function() {});
        }

        pi.oninput = function() {
            var v = this.value.trim();
            var s = document.getElementById('exportPathStatus');
            if (!s) return;
            if (!v) { s.innerHTML = App._t('auto.str_8b8d2b65', '💡 点击输入框选择文件夹，或直接输入完整磁盘路径'); s.style.color = 'var(--text-muted)'; }
            else if (v.includes(":\\") || v.includes(":/")) {
                s.textContent = '\u23f3 验证路径...';
                s.style.color = '#f59e0b';
                clearTimeout(self._pathCheckTimer);
                self._pathCheckTimer = setTimeout(function() {
                    fetch('/api/utils/check-path', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: document.getElementById('exportPathInput').value.trim() })
                    }).then(function(r) { return r.json(); }).then(function(d) {
                        if (d.ok) { s.innerHTML = ''; s.appendChild(document.createTextNode('\u2705 目录存在: ')); var strong3 = document.createElement('strong'); strong3.textContent = d.path; s.appendChild(strong3); s.style.color = '#059669'; localStorage.setItem('promptkit_export_path', d.path); self._toggleExportDirBtn(d.path); }
                        else { s.textContent = '\u26a0\ufe0f ' + d.error; s.style.color = '#ef4444'; self._toggleExportDirBtn(null); }
                    }).catch(function() { s.textContent = ''; self._toggleExportDirBtn(null); });
                }, 500);
            } else {
                s.textContent = '';
            }
        };

        var ext = fmt === 'pt' ? '.pt' : '.png';
        // 2026-08-02 修复: PNG 预览显示「目录」而非文件名；无路径时提示默认下载文件夹
        var savedP = localStorage.getItem('promptkit_export_path') || '';
        var dirLabel = (savedP && (savedP.indexOf(':\\') >= 0 || savedP.indexOf(':/') >= 0))
            ? savedP : '浏览器下载文件夹（默认）';
        // 2026-08-03: txt/md/json 统一命名弹窗后，预览文案按格式适配（不再一律显示 PNG）
        var fmtUnit = { png: '张 PNG', txt: '条 TXT', md: '条 Markdown', json: '条 JSON' }[fmt] || ('条 ' + fmt.toUpperCase());
        var renderPreview = function(val) {
            document.getElementById('exportPathPreview').innerHTML = fmt === 'pt'
                ? '📄 将保存为: <strong>' + val + ext + '</strong>'
                : '📄 将保存 <strong>' + ids.length + '</strong> ' + fmtUnit + ' 到目录: <strong>' + dirLabel + '</strong>';
        };
        renderPreview(defaultName);

        document.getElementById('exportNameInput').oninput = function() {
            var val = this.value.trim() || defaultName;
            renderPreview(val);
        };

        document.getElementById('btnConfirmExportName').onclick = function() { App._confirmBatchExport(); };
        document.getElementById('modalExportName').style.display = 'flex';
    },


    _toggleExportDirBtn(path) {
        var btn = document.getElementById('btnOpenExportDir');
        if (!btn) return;
        if (path && (path.includes(":\\") || path.includes(":/"))) {
            btn.style.display = '';
            btn.setAttribute('data-path', path);
        } else {
            btn.style.display = 'none';
        }
    },


    _closeExportNameDialog() {
        document.getElementById('modalExportName').style.display = 'none';
        this._exportQueue = null;
    },

    // 2026-08-03 起被 L1135 的 _openExportDir 覆盖（导出弹窗「下载目录」按钮），保留为遗留实现

    async _openExportDirLegacy() {
        var btn = document.getElementById('btnOpenExportDir');
        var path = btn ? btn.getAttribute('data-path') : '';
        if (!path) { this.showToast('请先设置导出目录', 'warning'); return; }
        try {
            var r = await fetch('/api/utils/open-explorer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            });
            var d = await r.json();
            if (!d.ok) this.showToast(d.error || '打开失败', 'error');
        } catch (e) {
            this.showToast('打开目录失败: ' + e.message, 'error');
        }
    },


    async _confirmBatchExport() {
        if (!this._exportQueue) return;
        var ids = this._exportQueue.ids;
        var fmt = this._exportQueue.fmt;
        var customName = document.getElementById('exportNameInput').value.trim();

        var saveDir = document.getElementById('exportPathInput').value.trim().replace(/^📁\s*/, '');
        // 2026-08-03 采纳 dev 09daaa1: 文件名校验 — 过滤 Windows 非法字符
        var illegalChars = /[<>:"/\\|?*]/g;
        if (illegalChars.test(customName)) {
            this.showToast('文件名不能包含字符: < > : " / \\ | ? *', 'error');
            return;
        }
        if (!customName) {
            customName = this._makeExportFilename(ids, fmt).replace('.' + fmt, '');
        }
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
                    if (ok) { App.showToast(App._t('common.export', '导出成功 (') + ids.length + ' 条)', 'success'); }
                    else { App._fallbackDownload(b, dn); App.showToast(App._t('auto.str_1680e142', '写入未完成，已改为下载'), 'warning'); }
                } else {
                    App._fallbackDownload(b, dn);
                    App.showToast(App._t('common.export', '导出成功 (') + ids.length + ' 条)', 'success');
                }
            } else if (fmt === 'txt' || fmt === 'md' || fmt === 'json') {
                // 2026-08-03: txt/md/json 统一走命名弹窗 — 自定义文件名 + 保存目录/下载
                var r = await fetch('/api/v2/batch/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt_ids: ids, format: fmt, name: customName })
                });
                if (!r.ok) {
                    var errTxt = '';
                    try { var ed2 = await r.json(); errTxt = ': ' + (ed2.detail || r.statusText); } catch(_) {}
                    App.showToast('导出未完成' + errTxt, 'error');
                    return;
                }
                var b2 = await r.blob();
                var dn = customName + '.' + fmt;
                if (saveDir) {
                    var ok2 = await App._saveBlobToPath(b2, saveDir + '\\' + dn);
                    if (ok2) { App.showToast(App._t('common.export', '导出成功 (') + ids.length + ' 条)', 'success'); }
                    else { App._fallbackDownload(b2, dn); App.showToast(App._t('auto.str_1680e142', '写入未完成，已改为下载'), 'warning'); }
                } else {
                    App._fallbackDownload(b2, dn);
                    App.showToast(App._t('common.export', '导出成功 (') + ids.length + ' 条)', 'success');
                }
            } else if (fmt === 'png') {
                var saved = 0;
                for (var i = 0; i < ids.length; i++) {
                    var p = this.state.prompts ? this.state.prompts.find(function(x) { return x.id === ids[i]; }) : null;
                    var pr = await fetch('/api/export/prompt-to-png/' + ids[i]);
                    // Phase17.6: 检查 HTTP 状态，避免把错误 JSON 当 PNG 下载
                    if (!pr.ok) {
                        var errText = '';
                        try { var ed = await pr.json(); errText = ': ' + (ed.detail || pr.statusText); } catch(_) {}
                        console.warn('PNG export failed for #' + ids[i] + errText);
                        continue;
                    }
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
                App.showToast(App._t('common.export', '导出成功 (') + saved + '/' + ids.length + ' 张 PNG)', 'success');
                // 2026-08-02: 保存到指定目录时提供「打开文件夹」入口
                if (saved > 0 && saveDir && confirm('已保存 ' + saved + ' 张 PNG 到:\n' + saveDir + '\n\n是否打开该文件夹？')) {
                    App._openExportFolder(saveDir);
                }
            }
        } catch (e) {
            App.showToast(App._t('common.export', '导出未完成: ') + e.message, 'error');
        }
        this._exportQueue = null;
    },


    async _pickExportPath() {
        // 2026-08-03 防抖: 多点击只触发一次目录选择器（后端已串行化，前端再挡一层）
        if (this._pickingPath) return;
        this._pickingPath = true;
        try {
            var r = await fetch('/api/utils/pick-folder', { method: 'POST' });
            var d = await r.json();
            if (d.ok && d.path) {
                this._exportPath = d.path;
                localStorage.setItem('promptkit_export_path', d.path);
                document.getElementById('exportPathInput').value = d.path;
                this._toggleExportDirBtn(d.path);
                var s = document.getElementById('exportPathStatus');
                if (s) { s.innerHTML = ''; s.appendChild(document.createTextNode('\u2705 导出目录: ')); var strong = document.createElement('strong'); strong.textContent = d.path; s.appendChild(strong); s.style.color = '#059669'; }
            } else if (d.error && d.error !== '未选择目录') {
                this.showToast('选择目录未完成: ' + d.error, 'error');
            }
        } catch (e) {
            this.showToast(App._t('auto.str_71fa02a5', '目录选择器调用未完成'), 'error');
        } finally {
            this._pickingPath = false;
        }
    },

    // 2026-08-02 补全: 导出后打开系统文件管理器定位目录（缺省=下载文件夹）

    _openExportFolder(path) {
        var self = this;
        fetch('/api/utils/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(path ? { path: path } : {})
        }).then(function(r) { return r.json(); }).then(function(d) {
            if (!d.ok) self.showToast('打开目录未完成: ' + (d.error || ''), 'error');
        }).catch(function(e) {
            self.showToast('打开目录未完成: ' + e.message, 'error');
        });
    },

    // 2026-08-03: 导出弹窗「下载目录」按钮 — 打开当前设定的下载目录（未设定时缺省=下载文件夹）

    _openExportDir() {
        var pi = document.getElementById('exportPathInput');
        var path = '';
        if (pi && pi.value) {
            path = pi.value.trim().replace(/^\uD83D\uDCC1\s*/, '');  // 清理「📁 」前缀
        }
        this._openExportFolder(path || '');
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
            console.warn(App._t('common.save', '保存文件未完成:'), e.message);
            return false;
        }
    },


    async batchAddToWordpack() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择提示词', '请先选择提示词'), 'error'); return; }
        // 加载词包列表
        const data = await this.fetchJSON('/api/v2/wordpacks');
        if (!data || data.items.length === 0) {
            this.showToast(App._t('auto.please_创建词包', '请先创建词包'), 'error');
            return;
        }
        document.getElementById('modalAddToTitle').textContent = App._t('auto.add_到词包', '添加到词包');
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

    // ============ 导入/导出 ============

});
})();
