/**
 * PromptKit — app_collections 模块分片 (cards)
 * 自 app_collections.js 拆分（Phase 3.5-P2），方法经 this 互访，片间共享 App 状态
 */
(function() {
'use strict';
Object.assign(App, {

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
                var mcEl = document.getElementById('bgenOllamaMaxChars');
                if (mcEl && d.config && d.config.max_chars) mcEl.value = d.config.max_chars;
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

    // 保存 Ollama 模型/语言/目标字数选择
    async _saveOllamaBar() {
        var model = (document.getElementById('bgenOllamaModel') || {}).value || '';
        var lang = (document.getElementById('bgenOllamaLang') || {}).value || 'en';
        var mcEl = document.getElementById('bgenOllamaMaxChars');
        var maxChars = 0;
        if (mcEl && mcEl.value) {
            var n = parseInt(mcEl.value, 10);
            if (!isNaN(n) && n > 0) maxChars = Math.min(Math.max(n, 50), 3000);
        }
        try {
            await this.fetchJSON('/api/v2/comfyui/ollama/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: model, language: lang, max_chars: maxChars })
            });
        } catch(e) {}
    },

    // 逐条通过 Ollama 优化选中卡提示词（中英文切换）
    _renderOllamaResults() {
        var box = document.getElementById('bgenOllamaResults');
        if (!box) return;
        var overrides = this._batchPromptOverrides || {};
        var keys = Object.keys(overrides);
        if (!keys.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
        var self = this;
        var saved = this._ollamaSaved || {};
        var savedCount = keys.filter(function(k) { return saved[k] === true; }).length;
        var html = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">' +
            '<span style="font-size:10px;color:var(--text-muted);">✨ 优化结果（可直接编辑后存词卡 · 带 ✨ 为已优化）</span>' +
            '<span style="margin-left:auto;display:flex;gap:4px;">' +
            '<button type="button" class="bgen-btn" id="bgenReoptAllBtn" onclick="App._ollamaReoptimizeAll()" style="padding:1px 8px;font-size:10px;border-color:#8b5cf6;color:#8b5cf6;" title="重新优化勾选的词条（未勾选则全部）">🔄 全部重新优化</button>' +
            '<button type="button" class="bgen-btn" id="bgenSaveAllBtn" onclick="App._ollamaSaveAll()" style="padding:1px 8px;font-size:10px;border-color:#10b981;color:#10b981;" title="所有优化结果一键存入对应词卡详细档">💾 全部存词卡</button>' +
            '<button type="button" class="bgen-btn" onclick="App._ollamaRevertAll()" style="padding:1px 8px;font-size:10px;border-color:var(--border-color);color:var(--text-muted);" title="丢弃全部优化结果，恢复原始提示词">↩ 全部恢复</button>' +
            '</span></div>' +
            '<div id="bgenOllamaBatchHint" style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">' + (savedCount ? '已存 ' + savedCount + ' / ' + keys.length + ' 条' : '共 ' + keys.length + ' 条待保存') + '</div>';
        keys.forEach(function(pid) {
            var card = null;
            (self.state.prompts || []).forEach(function(p) { if (String(p.id) === String(pid) && !card) card = p; });
            var name = card ? ((card.name || card.content || '').slice(0, 24)) : ('#' + pid);
            var st = saved[pid];
            var stHtml = st === true ? '<span style="font-size:9px;color:#10b981;">✓ 已存</span>'
                : (st === false ? '<span style="font-size:9px;color:#ef4444;">✗ 失败</span>' : '');
            var btnHtml = st === true
                ? '<button type="button" class="bgen-btn" disabled style="padding:1px 6px;font-size:10px;border-color:#10b981;color:#10b981;opacity:0.7;" title="已存入词卡详细档">✓ 已存</button>'
                : '<button type="button" class="bgen-btn" style="padding:1px 6px;font-size:10px;border-color:#10b981;color:#10b981;" onclick="App._ollamaSaveToCard(' + pid + ')" title="优化结果存入词卡详细档">💾 存词卡</button>';
            html += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:6px 8px;background:var(--bg-card);">' +
                '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
                '<input type="checkbox" class="ollama-reopt-check" data-pid="' + pid + '" title="勾选参与「全部重新优化」" style="width:13px;height:13px;flex-shrink:0;">' +
                '<span style="font-size:10px;font-weight:600;color:var(--text-main);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + App._escape(name) + '</span>' +
                stHtml +
                btnHtml +
                '<button type="button" class="bgen-btn" style="padding:1px 6px;font-size:10px;border-color:#8b5cf6;color:#8b5cf6;" onclick="App._ollamaReoptimize(' + pid + ', this)" title="用当前模型/语言/字数重新优化本条">🔄 重新优化</button>' +
                '<button type="button" class="bgen-btn" style="padding:1px 6px;font-size:10px;border-color:var(--border-color);color:var(--text-muted);" onclick="App._ollamaRevert(' + pid + ')">↩ 恢复原词</button>' +
                '</div>' +
                '<textarea data-pid="' + pid + '" rows="2" oninput="App._ollamaEdit(this)" placeholder="优化结果..." style="width:100%;box-sizing:border-box;font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape(overrides[pid] || '') + '</textarea>' +
                '</div>';
        });
        box.innerHTML = html;
        box.style.display = 'flex';
    },

    // 编辑优化结果：实时同步到 overrides + 刷新组合预览 + 临时存储
    _saveOllamaOverrides() {
        try {
            localStorage.setItem('cwl_ollama_overrides', JSON.stringify({
                overrides: this._batchPromptOverrides || {},
                saved: this._ollamaSaved || {}
            }));
        } catch(e) {}
    },

    // 恢复临时存储的优化结果（自动识别已有优化结果的词条）
    _loadOllamaOverrides() {
        try {
            var s = JSON.parse(localStorage.getItem('cwl_ollama_overrides') || '{}');
            if (s.overrides && Object.keys(s.overrides).length) {
                this._batchPromptOverrides = s.overrides;
                this._ollamaSaved = s.saved || {};
                this._renderOllamaResults();
                this._renderBatchComposePreview();
                return true;
            }
        } catch(e) {}
        return false;
    },

    // 勾选的重新优化目标 pid
    _loadTranslation(promptId) {
        return this.fetchJSON('/api/translate/' + promptId + '?target_lang=' + (this.state._cardTranslations[promptId] ? 'en' : 'zh'));
    },

    // ============ 三档切换（简易/普通/详细，卡片上下载按钮右侧） ============

    _cardTierFor(pid) {
        var s = this._cardTierState || {};
        if (s[pid]) return s[pid];
        try { var t = localStorage.getItem('wc_card_tier'); if (t === 'simple' || t === 'detailed') return t; } catch(e) {}
        return 'normal';
    },

    // 按档位取内容字段（空档回退普通档）
    _tierFields(card, tier) {
        if (!card) return { main: '', en: '', zh: '' };
        if (tier === 'simple') return { main: card.content_simple || card.content, en: card.content_simple_en || '', zh: card.content_simple_zh || '' };
        if (tier === 'detailed') return { main: card.content_detailed || card.content, en: card.content_detailed_en || '', zh: card.content_detailed_zh || '' };
        return { main: card.content, en: card.content_en || '', zh: card.content_zh || '' };
    },

    // 卡片内容展示（档位 + 语言感知）
    _cardDisplayContent(p) {
        var tier = this._cardTierFor(p.id);
        var tf = this._tierFields(p, tier);
        var lang = (this.state._cardLang && this.state._cardLang[p.id]) || 'original';
        if (lang === 'en' && tf.en) return tf.en;
        if (lang === 'zh' && tf.zh) return tf.zh;
        return tf.main || p.content;
    },

    // 切换卡片档位（下载按钮右侧 📄/📋/📚）
    _switchCardTier(pid, tier, btn) {
        this._cardTierState = this._cardTierState || {};
        this._cardTierState[pid] = tier;
        try { localStorage.setItem('wc_card_tier', tier); } catch(e) {}
        var card = this._findCardData(pid);
        var el = document.getElementById('cc_' + pid);
        if (card && el) {
            var lang = (this.state._cardLang && this.state._cardLang[pid]) || 'original';
            var tf = this._tierFields(card, tier);
            var text = lang === 'en' && tf.en ? tf.en : (lang === 'zh' && tf.zh ? tf.zh : (tf.main || card.content));
            el.textContent = text;
        }
        this._updateCardTierBtns(pid);
        if (this._updateTranslateBtn) this._updateTranslateBtn(pid);
    },

    // 更新某卡三档按钮激活态
    _updateCardTierBtns(pid) {
        var tier = this._cardTierFor(pid);
        document.querySelectorAll('.card-tier-btn[data-pid="' + pid + '"]').forEach(function(b) {
            var active = b.getAttribute('data-tier') === tier;
            b.style.background = active ? 'var(--primary)' : 'var(--bg-card)';
            b.style.color = active ? '#fff' : 'var(--text-muted)';
            b.style.borderColor = active ? 'var(--primary)' : 'var(--border-color)';
        });
    },

    // 渲染后初始化所有三档按钮态
    _initCardTierBtns() {
        var self = this;
        document.querySelectorAll('.card-tier-btn').forEach(function(b) {
            var pid = b.getAttribute('data-pid');
            var tier = self._cardTierFor(pid);
            var active = b.getAttribute('data-tier') === tier;
            b.style.background = active ? 'var(--primary)' : 'var(--bg-card)';
            b.style.color = active ? '#fff' : 'var(--text-muted)';
            b.style.borderColor = active ? 'var(--primary)' : 'var(--border-color)';
        });
    },

    // ============ 语言切换（双向中英 + 手动切换显示，按档位分别对应） ============
    async toggleTranslation(promptId) {
        var el = document.getElementById('cc_' + promptId);
        if (!el) { this.showToast('卡片元素未找到，请刷新', 'error'); return; }
        var tier = this._cardTierFor(promptId);
        // 优先读 _cardLang（切换分组后 DOM 丢失，_cardLang 存活）
        var currentLang = (this.state._cardLang && this.state._cardLang[promptId]) || el.getAttribute('data-lang') || 'original';
        var cardData = this._findCardData(promptId);
        var tf = this._tierFields(cardData, tier);
        var original = tf.main || (cardData ? cardData.content : (el.getAttribute('data-original') || el.textContent));
        var zh = tf.zh, en = tf.en;
        var isCN = /[\u4e00-\u9fff]/.test(original);

        if (currentLang === 'original') {
            // 原文→翻译：如果原文中文且有英文翻译 → 显示英文；原文英文且有中文翻译 → 显示中文
            if (isCN && en) { this._setCardLang(el, promptId, 'en', en, original); }
            else if (!isCN && zh) { this._setCardLang(el, promptId, 'zh', zh, original); }
            else { await this._doTranslateCard(el, promptId, original, isCN ? 'en' : 'zh', tier); }
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

    async _doTranslateCard(el, promptId, original, targetLang, tier) {
        el.innerHTML = original + '<div class="card-translation" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-color);color:#6366f1;font-size:13px;">翻译中...</div>';
        try {
            var url = '/api/translate/' + promptId + '?target_lang=' + targetLang;
            if (tier && tier !== 'normal') url += '&tier=' + tier;
            var data = await this.fetchJSON(url);
            if (data && data.ok && data.translated && data.translated !== data.original) {
                var card = this._findCardData(promptId);
                if (card) {
                    // 写回对应档位翻译字段
                    if (tier === 'simple') { if (targetLang === 'zh') card.content_simple_zh = data.translated; else card.content_simple_en = data.translated; }
                    else if (tier === 'detailed') { if (targetLang === 'zh') card.content_detailed_zh = data.translated; else card.content_detailed_en = data.translated; }
                    else { if (targetLang === 'zh') card.content_zh = data.translated; else card.content_en = data.translated; }
                }
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
        var tier = this._cardTierFor(promptId);
        var tf = this._tierFields(card, tier);
        var lang = (this.state._cardLang && this.state._cardLang[promptId]) || 'original';
        if (lang === 'zh' && tf.zh) return { text: tf.zh, lang: 'zh' };
        if (lang === 'en' && tf.en) return { text: tf.en, lang: 'en' };
        return { text: tf.main || card.content, lang: 'original' };
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
});
})();
