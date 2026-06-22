// ============================================================
// v4.0.0-phase12: AI Tools Frontend Module
// AI优化器 + 自动标签 + 批量翻译 + 卡片右键菜单 + Playground升级
// ============================================================

(function() {
'use strict';

// ============================================================
//  PART 1: AI 工具栏按钮组 + AI 顶栏
// ============================================================

App.aiTools = {
    // 当前模式
    _mode: 'polish',
    _targetFormat: 'sdxl',
    _isStreaming: false,
    _abortStream: false,
    _streamContent: '',
};

// ============ AI 工具栏初始化 ============

App.aiTools.renderToolbar = function() {
    var container = document.getElementById('aiToolbar');
    if (container) return container;

    // 在 batchBar 上方插入 AI 工具栏
    var batchBar = document.getElementById('batchBar');
    container = document.createElement('div');
    container.id = 'aiToolbar';
    container.className = 'ai-toolbar';
    container.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;padding:8px 0;align-items:center;';

    // ===== AI 操作按钮组 =====
    container.innerHTML = '' +
    '<span class="ai-toolbar-label">🤖 AI 工具</span>' +
    '<button class="ai-btn" onclick="App.aiTools.openOptimizer()" title="AI智能优化提示词 — 支持润色/精简/格式适配/反向解析"><span>✨</span> 优化提示词</button>' +
    '<button class="ai-btn" onclick="App.aiTools.openTranslate()" title="批量翻译选中提示词"><span>🌐</span> 批量翻译</button>' +
    '<button class="ai-btn" onclick="App.aiTools.autoTagCurrent()" title="AI自动分析当前模块词条的标签和分类"><span>🏷️</span> 智能标签</button>' +
    '<button class="ai-btn ai-btn-purple" onclick="App.aiTools.openOptimizer(\'adapt\')" title="将提示词适配到SDXL/Flux/MJ/DALL-E格式"><span>🎯</span> 格式适配</button>' +
    '<button class="ai-btn ai-btn-green" onclick="App.aiTools.aiThumbCurrent()" title="AI智能生成缩略图封面"><span>🎨</span> AI缩略图</button>' +
    '';

    batchBar.parentNode.insertBefore(container, batchBar);
    return container;
};

// ============ 工具栏显示/隐藏 ============

App.aiTools.showToolbar = function() {
    // 分组总目录页面不显示 AI 工具栏
    if (App._aiToolbarSuppressed) return;
    var bar = this.renderToolbar();
    bar.style.display = 'flex';
};

App.aiTools.hideToolbar = function() {
    var bar = document.getElementById('aiToolbar');
    if (bar) bar.style.display = 'none';
};

// ============================================================
//  PART 2: AI 优化器弹窗
// ============================================================

App.aiTools.openOptimizer = function(mode) {
    mode = mode || 'polish';
    this._mode = mode;

    // 获取选中词条的内容
    var content = this._getSelectedContent();

    this._ensureOptimizerModal();
    var m = document.getElementById('modalAiOptimizer');
    if (!m) return;

    // 设置模式按钮
    var modes = ['polish', 'compress', 'adapt', 'reverse'];
    for (var i = 0; i < modes.length; i++) {
        var btn = document.getElementById('aiOptMode_' + modes[i]);
        if (btn) {
            btn.style.background = modes[i] === mode ? 'var(--primary)' : 'var(--hover-bg)';
            btn.style.color = modes[i] === mode ? '#fff' : 'var(--text-main)';
        }
    }
    this._mode = mode;

    // 填入内容
    var textarea = document.getElementById('aiOptInput');
    if (textarea && content) textarea.value = content;

    // 显示/隐藏格式选择
    var fmtRow = document.getElementById('aiOptFormatRow');
    if (fmtRow) fmtRow.style.display = mode === 'adapt' ? 'flex' : 'none';

    // 清空输出
    var output = document.getElementById('aiOptOutput');
    if (output) output.textContent = '';
    var preview = document.getElementById('aiOptPreview');
    if (preview) preview.innerHTML = '<span style="color:var(--text-muted);">点击"开始优化"查看结果</span>';

    // 重置按钮
    var startBtn = document.getElementById('aiOptStartBtn');
    if (startBtn) { startBtn.disabled = false; startBtn.innerHTML = App._t('auto.str_bce5366e', '<span>✨</span> 开始优化'); }
    var applyBtn = document.getElementById('aiOptApplyBtn');
    if (applyBtn) applyBtn.style.display = 'none';

    m.style.display = 'flex';
};

App.aiTools._ensureOptimizerModal = function() {
    if (document.getElementById('modalAiOptimizer')) return;

    var overlay = document.createElement('div');
    overlay.id = 'modalAiOptimizer';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:none;z-index:600;';
    overlay.onclick = function(e) { if (e.target === overlay) App.aiTools.closeOptimizer(); };

    overlay.innerHTML = '' +
    '<div class="modal-content ai-opt-modal" style="max-width:800px;width:95%;max-height:90vh;overflow-y:auto;border-radius:14px;padding:0;">' +

    // Header
    '<div class="ai-opt-header" style="position:sticky;top:0;z-index:2;background:var(--bg-card);border-bottom:1px solid var(--border-color);padding:14px 18px;display:flex;justify-content:space-between;align-items:center;">' +
    '<h5 style="margin:0;font-size:16px;">✨ AI 提示词优化器</h5>' +
    '<button style="background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer;" onclick="App.aiTools.closeOptimizer()">&times;</button>' +
    '</div>' +

    // Body
    '<div style="padding:14px 18px;">' +

    // 模式选择
    '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;" id="aiOptModes">' +
    '<button id="aiOptMode_polish" class="ai-mode-btn" onclick="App.aiTools._switchMode(\'polish\')">✨ 润色增强</button>' +
    '<button id="aiOptMode_compress" class="ai-mode-btn" onclick="App.aiTools._switchMode(\'compress\')">📏 精简压缩</button>' +
    '<button id="aiOptMode_adapt" class="ai-mode-btn" onclick="App.aiTools._switchMode(\'adapt\')">🎯 格式适配</button>' +
    '<button id="aiOptMode_reverse" class="ai-mode-btn" onclick="App.aiTools._switchMode(\'reverse\')">🔄 反向解析</button>' +
    '</div>' +

    // 格式选择（adapt模式下显示）
    '<div id="aiOptFormatRow" style="display:none;margin-bottom:10px;gap:6px;align-items:center;">' +
    '<span style="font-size:11px;color:var(--text-muted);">目标格式:</span>' +
    '<select id="aiOptFormat" onchange="App.aiTools._targetFormat=this.value" style="font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);">' +
    '<option value="sdxl">SDXL</option><option value="flux">Flux</option><option value="midjourney">Midjourney</option><option value="dalle">DALL-E 3</option>' +
    '</select>' +
    '</div>' +

    // 输入区
    '<label style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px;display:block;">输入提示词</label>' +
    '<textarea id="aiOptInput" class="modal-input" rows="3" placeholder="在此粘贴或修改提示词..." style="font-size:12px;margin-bottom:10px;"></textarea>' +

    // 按钮行
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<button id="aiOptStartBtn" class="btn btn-primary btn-sm" onclick="App.aiTools._runOptimize()" style="flex-shrink:0;"><span>✨</span> 开始优化</button>' +
    '<button id="aiOptStopBtn" class="btn btn-sm btn-outline" onclick="App.aiTools._stopStream()" style="display:none;flex-shrink:0;">⏹ 停止</button>' +
    '<button id="aiOptApplyBtn" class="btn btn-sm" onclick="App.aiTools._applyOptimize()" style="display:none;flex-shrink:0;background:#10b981;color:#fff;border-color:#059669;">✅ 应用到词条</button>' +
    '<span id="aiOptStatus" style="font-size:11px;color:var(--text-muted);align-self:center;"></span>' +
    '</div>' +

    // 输出区
    '<div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;">' +
    '<div style="background:var(--hover-bg);padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">' +
    '<span style="font-size:11px;font-weight:600;">📝 优化结果</span>' +
    '<button class="btn btn-xs" onclick="App.aiTools._copyOutput()" style="font-size:10px;padding:2px 8px;">📋 复制</button>' +
    '</div>' +
    '<div id="aiOptOutput" style="padding:10px 14px;font-size:12px;line-height:1.6;min-height:80px;max-height:200px;overflow-y:auto;white-space:pre-wrap;font-family:system-ui;color:var(--text-main);"></div>' +
    '</div>' +

    // 原始响应区
    '<details style="margin-top:8px;font-size:11px;">' +
    '<summary style="color:var(--text-muted);cursor:pointer;">查看模型原始响应</summary>' +
    '<pre id="aiOptRaw" style="margin-top:4px;padding:8px;background:var(--hover-bg);border-radius:6px;font-size:10px;max-height:120px;overflow-y:auto;color:var(--text-muted);"></pre>' +
    '</details>' +

    '</div></div>';

    document.body.appendChild(overlay);
};

// ============ 模式切换 ============

App.aiTools._switchMode = function(mode) {
    this._mode = mode;
    var modes = ['polish', 'compress', 'adapt', 'reverse'];
    for (var i = 0; i < modes.length; i++) {
        var btn = document.getElementById('aiOptMode_' + modes[i]);
        if (btn) {
            btn.style.background = modes[i] === mode ? 'var(--primary)' : 'var(--hover-bg)';
            btn.style.color = modes[i] === mode ? '#fff' : 'var(--text-main)';
        }
    }
    var fmtRow = document.getElementById('aiOptFormatRow');
    if (fmtRow) fmtRow.style.display = mode === 'adapt' ? 'flex' : 'none';
};

// ============ 执行优化 ============

App.aiTools._runOptimize = async function() {
    var input = document.getElementById('aiOptInput');
    var content = (input ? input.value : '').trim();
    if (!content) { App.showToast(App._t('editor.enter_content', '请输入提示词内容'), 'warning'); return; }

    var startBtn = document.getElementById('aiOptStartBtn');
    var stopBtn = document.getElementById('aiOptStopBtn');
    var statusEl = document.getElementById('aiOptStatus');
    var outputEl = document.getElementById('aiOptOutput');
    var rawEl = document.getElementById('aiOptRaw');
    var applyBtn = document.getElementById('aiOptApplyBtn');

    if (startBtn) { startBtn.style.display = 'none'; }
    if (stopBtn) { stopBtn.style.display = 'inline-block'; }
    if (applyBtn) applyBtn.style.display = 'none';
    if (statusEl) statusEl.textContent = App._t('auto.str_c67d8154', '⏳ 优化中...');
    if (outputEl) outputEl.textContent = '';
    if (rawEl) rawEl.textContent = '';

    // 使用流式输出
    this._isStreaming = true;
    this._abortStream = false;
    this._streamContent = '';
    this._streamRaw = '';

    try {
        var body = JSON.stringify({
            content: content,
            mode: this._mode,
            target_format: this._targetFormat,
            extra_context: ''
        });

        var resp = await fetch('/api/ai/optimize/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });

        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        while (true) {
            if (this._abortStream) break;

            var chunk = await reader.read();
            if (chunk.done) break;

            buffer += decoder.decode(chunk.value, {stream: true});
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line) continue;
                try {
                    var data = JSON.parse(line);
                    if (data.message && data.message.content) {
                        this._streamContent += data.message.content;
                        if (outputEl) outputEl.textContent = this._streamContent;
                    }
                    this._streamRaw += line + '\n';
                } catch(e) {
                    this._streamRaw += line + '\n';
                }
            }

            if (outputEl) outputEl.textContent = this._streamContent;

            // 滚动到底部
            if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
        }
    } catch(e) {
        if (statusEl) statusEl.textContent = '❌ 请求失败: ' + e.message;
        if (outputEl && !this._streamContent) outputEl.textContent = App._t('auto.str_67411e24', '请求失败: ') + e.message;
    }

    // 完成
    this._isStreaming = false;
    if (startBtn) { startBtn.style.display = 'inline-block'; startBtn.innerHTML = App._t('auto.str_fd0f4fc1', '<span>🔄</span> 重新优化'); }
    if (stopBtn) stopBtn.style.display = 'none';

    if (this._streamContent) {
        if (statusEl) statusEl.textContent = '✅ 优化完成 (' + this._streamContent.length + ' 字符)';
        if (rawEl) rawEl.textContent = this._streamRaw.substring(0, 2000);
        if (applyBtn) applyBtn.style.display = 'inline-block';
    } else {
        if (statusEl) statusEl.textContent = App._t('auto.str_049aada2', '⚠️ 未获得有效输出，请重试');
    }
};

App.aiTools._stopStream = function() {
    this._abortStream = true;
};

// ============ 应用优化结果 ============

App.aiTools._applyOptimize = function() {
    var pid = this._currentPromptId;
    var optContent = this._streamContent;
    if (!optContent) { App.showToast(App._t('auto.str_c76a2753', '没有优化结果可应用'), 'warning'); return; }

    // 如果有编辑中的提示词ID，更新编辑弹窗内容
    var editInput = document.getElementById('editContent');
    if (editInput && pid) {
        editInput.value = optContent;
        App.showToast(App._t('auto.str_a1fa07b2', '已填入编辑框，请保存'), 'success');
        return;
    }

    // 否则直接更新到词条
    if (!pid) {
        // 仅复制到剪贴板
        App.copyText(optContent, App._t('common.copied', '已复制优化结果 (无关联词条)'));
        return;
    }

    App.showToast(App._t('auto.str_c9de9d53', '请通过编辑弹窗保存'), 'info');
};

App.aiTools._copyOutput = function() {
    var text = this._streamContent || '';
    if (!text) { App.showToast(App._t('auto.str_cd2e83b1', '没有内容可复制'), 'warning'); return; }
    App.copyText(text, App._t('common.copied', '已复制优化结果'));
};

App.aiTools.closeOptimizer = function() {
    this._abortStream = true;
    var m = document.getElementById('modalAiOptimizer');
    if (m) m.style.display = 'none';
};

// ============================================================
//  PART 3: 批量翻译弹窗
// ============================================================

App.aiTools.openTranslate = function() {
    var ids = [];
    if (App.state.batchSelected && App.state.batchSelected.size > 0) {
        ids = Array.from(App.state.batchSelected);
    } else {
        App.showToast(App._t('auto.please_选择要翻译的提示词_编辑模式___勾选_', '请先选择要翻译的提示词（编辑模式 + 勾选）'), 'warning');
        return;
    }

    this._ensureTranslateModal();
    var m = document.getElementById('modalAiTranslate');
    if (!m) return;

    document.getElementById('aiTransCount').textContent = '已选 ' + ids.length + ' 条';
    document.getElementById('aiTransProgress').style.display = 'none';
    document.getElementById('aiTransResult').innerHTML = '';
    document.getElementById('aiTransStartBtn').disabled = false;

    m.style.display = 'flex';
};

App.aiTools._ensureTranslateModal = function() {
    if (document.getElementById('modalAiTranslate')) return;

    var overlay = document.createElement('div');
    overlay.id = 'modalAiTranslate';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:none;z-index:600;';
    overlay.onclick = function(e) { if (e.target === overlay) App.aiTools._closeTranslate(); };

    overlay.innerHTML = '' +
    '<div class="modal-content" style="max-width:550px;width:95%;border-radius:14px;padding:0;">' +
    '<div style="padding:14px 18px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">' +
    '<h5 style="margin:0;">🌐 批量翻译</h5>' +
    '<button style="background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer;" onclick="App.aiTools._closeTranslate()">&times;</button>' +
    '</div>' +
    '<div style="padding:14px 18px;">' +
    '<div style="margin-bottom:10px;display:flex;gap:10px;align-items:center;">' +
    '<span id="aiTransCount" style="font-size:13px;"></span>' +
    '<select id="aiTransLang" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);">' +
    '<option value="zh">翻译成中文</option><option value="en">翻译成英文</option></select>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
    '<button id="aiTransStartBtn" class="btn btn-primary btn-sm" onclick="App.aiTools._runTranslate()">🚀 开始翻译</button>' +
    '<span id="aiTransProgress" style="display:none;font-size:12px;color:var(--text-muted);">⏳ 翻译中...</span>' +
    '</div>' +
    '<div id="aiTransResult" style="max-height:300px;overflow-y:auto;font-size:11px;"></div>' +
    '</div></div>';

    document.body.appendChild(overlay);
};

App.aiTools._runTranslate = async function() {
    var ids = Array.from(App.state.batchSelected);
    if (ids.length === 0) return;

    var lang = document.getElementById('aiTransLang').value;
    document.getElementById('aiTransStartBtn').disabled = true;
    document.getElementById('aiTransProgress').style.display = 'inline';

    var resultEl = document.getElementById('aiTransResult');
    resultEl.innerHTML = '';

    try {
        var data = await App.fetchJSON('/api/translate/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids.slice(0, 20), target_lang: lang, quality_check: false })
        });

        var html = '<div style="margin-bottom:8px;font-weight:600;">✅ ' + data.success + App._t('common.success', '成功 / ') + data.failed + App._t('common.failed', '失败 / ') + (data.cached || 0) + '缓存命中</div>';
        for (var i = 0; i < (data.results || []).length; i++) {
            var r = data.results[i];
            var style = r.ok ? 'color:#10b981;' : 'color:#ef4444;';
            html += '<div style="padding:4px 0;border-bottom:1px solid var(--border-color);">';
            html += '<span style="' + style + '">#' + r.prompt_id + '</span> ';
            html += '<span style="color:var(--text-muted);">' + App._escape((r.translated || r.error || '').substring(0, 80)) + '</span>';
            html += '</div>';
        }
        resultEl.innerHTML = html;
        App.showToast(App._t('auto.str_6578de1a', '翻译完成: ') + data.success + '/' + ids.length, 'success');
    } catch(e) {
        resultEl.innerHTML = '<span style="color:#ef4444;">翻译失败: ' + e.message + '</span>';
    }

    document.getElementById('aiTransStartBtn').disabled = false;
    document.getElementById('aiTransProgress').style.display = 'none';
};

App.aiTools._closeTranslate = function() {
    var m = document.getElementById('modalAiTranslate');
    if (m) m.style.display = 'none';
};

// ============================================================
//  PART 4: 自动标签
// ============================================================

App.aiTools.autoTagCurrent = async function() {
    // 获取当前模块词条
    var prompts = App.state.prompts || [];
    if (prompts.length === 0) { App.showToast(App._t('auto.current_模块没有词条', '当前模块没有词条'), 'warning'); return; }

    App.showToast(App._t('auto.ing_分析标签_____最多__条_', '正在分析标签... (最多20条)'), 'info');

    var items = [];
    for (var i = 0; i < Math.min(prompts.length, 20); i++) {
        items.push({ id: prompts[i].id, content: prompts[i].content || '' });
    }

    try {
        var data = await App.fetchJSON('/api/ai/auto-tag/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items })
        });
        App.showToast(App._t('auto.str_bf72a052', '标签分析完成: ') + data.success + '/' + data.total + ' 条', data.failed > 0 ? 'warning' : 'success');
        // 刷新列表
        App.loadPrompts();
    } catch(e) {
        App.showToast(App._t('auto.str_7ace8112', '标签分析失败: ') + e.message, 'error');
    }
};

// 在编辑弹窗中加入 AI 分析按钮
App.aiTools.injectEditAiButton = function() {
    var modal = document.getElementById('modalEditPrompt');
    if (!modal) return;

    // 检查是否已注入
    if (document.getElementById('aiEditTagBtn')) return;

    var tagsRow = modal.querySelector('#editTags');
    if (!tagsRow) return;

    var btn = document.createElement('button');
    btn.id = 'aiEditTagBtn';
    btn.className = 'btn btn-sm ai-inline-btn';
    btn.style.cssText = 'font-size:11px;padding:3px 10px;margin-top:4px;background:var(--hover-bg);color:var(--primary);border:1px solid var(--border-color);border-radius:6px;cursor:pointer;';
    btn.innerHTML = App._t('auto.str_bef794c6', '🤖 AI 分析标签');
    btn.onclick = async function() {
        var content = document.getElementById('editContent').value;
        if (!content || !content.trim()) { App.showToast(App._t('auto.please_输入提示词内容', '请先输入提示词内容'), 'warning'); return; }

        btn.disabled = true;
        btn.textContent = App._t('auto.str_85a406c8', '⏳ 分析中...');

        try {
            var data = await App.fetchJSON('/api/ai/auto-tag/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
            });

            if (data && data.ok) {
                if (data.module && data.module !== 'custom') {
                    var ms = document.getElementById('editModule');
                    if (ms) ms.value = data.module;
                }
                if (data.category) document.getElementById('editCategory').value = data.category;
                if (data.tags && data.tags.length > 0) {
                    document.getElementById('editTags').value = JSON.stringify(data.tags);
                }
                if (data.meaning) document.getElementById('editMeaning').value = data.meaning;
                if (data.scene) document.getElementById('editScene').value = data.scene;
                App.showToast(App._t('auto.str_844c894c', 'AI 分析完成 (置信度: ') + Math.round((data.confidence || 0.5) * 100) + '%)', 'success');
            } else {
                App.showToast(App._t('auto.str_7b9d7831', 'AI 分析失败: ') + (data ? data.error : App._t('auto.str_1622dc9b', '未知')), 'warning');
            }
        } catch(e) {
            App.showToast(App._t('auto.str_e82a1516', 'AI 分析出错: ') + e.message, 'error');
        }
        btn.disabled = false;
        btn.textContent = App._t('auto.str_bef794c6', '🤖 AI 分析标签');
    };

    tagsRow.parentNode.appendChild(btn);
};

// ============================================================
//  PART 5: AI 缩略图
// ============================================================

App.aiTools.aiThumbCurrent = async function() {
    var ids = [];
    if (App.state.batchSelected && App.state.batchSelected.size > 0) {
        ids = Array.from(App.state.batchSelected);
    } else {
        // 单条：取当前页第一条
        var prompts = App.state.prompts || [];
        if (prompts.length > 0) ids = [prompts[0].id];
    }
    if (ids.length === 0) { App.showToast(App._t('auto.please_选择词条', '请先选择词条'), 'warning'); return; }

    App.showToast(App._t('auto.ing_生成ai缩略图__', '正在生成AI缩略图 (') + ids.length + App._t('common.items', '条)...'), 'info');

    try {
        var data = await App.fetchJSON('/api/ai/thumbnail/batch-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids.slice(0, 10) })
        });
        App.showToast(App._t('auto.str_d7f024cd', 'AI缩略图生成: ') + data.success + '/' + data.total + App._t('auto.str_f28e75cf', ' 成功'), 'success');
        App.loadPrompts();
    } catch(e) {
        App.showToast(App._t('auto.str_6464e87f', 'AI缩略图生成失败: ') + e.message, 'error');
    }
};

// ============================================================
//  PART 6: 卡片右键菜单
// ============================================================

App.aiTools._contextMenu = null;
App.aiTools._contextPromptId = null;

App.aiTools.showContextMenu = function(e, promptId, content, module) {
    e.preventDefault();
    e.stopPropagation();

    this._contextPromptId = promptId;
    this._currentContextContent = content;
    this._currentContextModule = module;

    this._removeContextMenu();

    var menu = document.createElement('div');
    menu.className = 'ai-context-menu';
    menu.style.cssText = 'position:fixed;z-index:900;min-width:180px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,0.25);padding:6px;font-size:12px;';

    menu.innerHTML = '' +
    '<div class="ctx-item" onclick="App.aiTools._ctxOptimize(\'polish\')"><span>✨</span> AI 润色增强</div>' +
    '<div class="ctx-item" onclick="App.aiTools._ctxOptimize(\'compress\')"><span>📏</span> AI 精简压缩</div>' +
    '<div class="ctx-item" onclick="App.aiTools._ctxAdapt()"><span>🎯</span> 格式适配</div>' +
    '<div class="ctx-sep"></div>' +
    '<div class="ctx-item" onclick="App.aiTools._ctxTranslate()"><span>🌐</span> 翻译 (中英互译)</div>' +
    '<div class="ctx-item" onclick="App.aiTools._ctxAutoTag()"><span>🏷️</span> AI 分析标签</div>' +
    '<div class="ctx-item" onclick="App.aiTools._ctxAiThumb()"><span>🎨</span> AI 生成缩略图</div>' +
    '<div class="ctx-sep"></div>' +
    '<div class="ctx-item ctx-copy" onclick="App.aiTools._ctxCopyPrompt()"><span>📋</span> 复制提示词</div>';

    menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 280) + 'px';
    document.body.appendChild(menu);

    this._contextMenu = menu;

    // 点击外部关闭
    var self = this;
    setTimeout(function() {
        document.addEventListener('click', self._removeContextMenu, {once: true});
    }, 50);
};

App.aiTools._removeContextMenu = function() {
    if (App.aiTools._contextMenu) {
        App.aiTools._contextMenu.remove();
        App.aiTools._contextMenu = null;
    }
};

// Context menu actions
App.aiTools._ctxOptimize = function(mode) {
    this._removeContextMenu();
    // 设置optimizer的输入
    this._ensureOptimizerModal();
    document.getElementById('aiOptInput').value = this._currentContextContent || '';
    this.openOptimizer(mode);
};

App.aiTools._ctxAdapt = function() {
    this._removeContextMenu();
    this._ensureOptimizerModal();
    document.getElementById('aiOptInput').value = this._currentContextContent || '';
    this.openOptimizer('adapt');
};

App.aiTools._ctxTranslate = async function() {
    this._removeContextMenu();
    var pid = this._contextPromptId;
    if (!pid) return;

    App.showToast('正在翻译...', 'info');
    try {
        var d = await App.fetchJSON('/api/translate/' + pid + '?target_lang=zh');
        if (d && d.ok && d.translated) {
            App.copyText(d.translated, App._t('common.copied', '已复制中文翻译'));
        } else {
            App.showToast(App._t('auto.str_31ff785e', '翻译失败: ') + (d ? d.error : App._t('auto.str_1622dc9b', '未知')), 'error');
        }
    } catch(e) {
        App.showToast('翻译出错: ' + e.message, 'error');
    }
};

App.aiTools._ctxAutoTag = async function() {
    this._removeContextMenu();
    var content = this._currentContextContent;
    var pid = this._contextPromptId;
    if (!content) return;

    App.showToast('正在分析...', 'info');
    try {
        var d = await App.fetchJSON('/api/ai/auto-tag/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content })
        });
        if (d && d.ok && pid) {
            // 应用
            await App.fetchJSON('/api/ai/auto-tag/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt_id: pid, module: d.module, category: d.category,
                    tags: d.tags, meaning: d.meaning, scene: d.scene
                })
            });
            App.showToast(App._t('auto.str_8526cf2c', '标签已更新: ') + (d.module || '') + ' / ' + (d.tags || []).join(', '), 'success');
            App.loadPrompts();
        } else {
            App.showToast(App._t('auto.str_6aee2d39', '分析失败'), 'error');
        }
    } catch(e) {
        App.showToast('分析出错: ' + e.message, 'error');
    }
};

App.aiTools._ctxAiThumb = async function() {
    this._removeContextMenu();
    var pid = this._contextPromptId;
    if (!pid) return;
    App.showToast(App._t('auto.ing_生成ai缩略图___', '正在生成AI缩略图...'), 'info');
    try {
        var d = await App.fetchJSON('/api/ai/thumbnail/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_id: pid })
        });
        App.showToast(d.ok ? App._t('auto.str_90ef7b61', 'AI缩略图已生成') : App._t('auto.str_7f7de8a2', '生成失败'), d.ok ? 'success' : 'error');
        App.loadPrompts();
    } catch(e) {
        App.showToast('生成出错: ' + e.message, 'error');
    }
};

App.aiTools._ctxCopyPrompt = function() {
    this._removeContextMenu();
    App.copyText(this._currentContextContent || '', App._t('common.copied', '已复制提示词'));
};

// ============ 辅助: 获取选中/当前内容 ============

App.aiTools._getSelectedContent = function() {
    // 优先取批量选中
    var ids = App.state.batchSelected;
    if (ids && ids.size > 0) {
        var firstId = Array.from(ids)[0];
        var prompts = App.state.prompts || [];
        for (var i = 0; i < prompts.length; i++) {
            if (prompts[i].id === firstId) {
                this._currentPromptId = firstId;
                return prompts[i].content || '';
            }
        }
    }
    // 取第一个卡片
    var prompts = App.state.prompts || [];
    if (prompts.length > 0) {
        this._currentPromptId = prompts[0].id;
        return prompts[0].content || '';
    }
    this._currentPromptId = null;
    return '';
};

// ============================================================
//  PART 7: 编辑模式弹出时注入 AI 按钮
// ============================================================

// Hook: 在 openEditModal 后自动注入
var _origOpenEdit = App.openEditModal;
App.openEditModal = function() {
    var result = _origOpenEdit.apply(this, arguments);
    // 等待 DOM 渲染后注入
    var self = this;
    Promise.resolve().then(function() {
        App.aiTools.injectEditAiButton();
    });
    return result;
};

// ============================================================
//  PART 8: 加载时初始化 AI 工具栏
// ============================================================

// Hook 初始化
var _origInit = App.init;
App.init = function() {
    if (_origInit) _origInit.apply(this);
    // 渲染 AI 工具栏（延迟等 batchBar 就绪）
    var self = this;
    setTimeout(function() {
        App.aiTools.showToolbar();
        // 为所有卡片注册右键菜单
        App.aiTools._bindCardContextMenus();
    }, 1500);
};

// 绑定卡片右键
App.aiTools._bindCardContextMenus = function() {
    // 委托方式监听
    var list = document.getElementById('promptList');
    if (!list || list._aiBound) return;
    list._aiBound = true;

    list.addEventListener('contextmenu', function(e) {
        var card = e.target.closest('.prompt-card');
        if (!card) return;

        var pid = parseInt(card.getAttribute('data-id'));
        if (!pid) return;

        // 找内容
        var contentEl = card.querySelector('.card-content');
        var moduleEl = card.querySelector('.card-badge');
        var content = contentEl ? contentEl.textContent : '';
        var module = moduleEl ? moduleEl.textContent : '';

        App.aiTools.showContextMenu(e, pid, content, module);
    });
};

})();
