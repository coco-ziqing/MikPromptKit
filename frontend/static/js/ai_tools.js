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

// ============ 优化器设置持久化（localStorage） ============

App.aiTools._loadOptSettings = function() {
    try {
        var s = JSON.parse(localStorage.getItem('ai_optimizer_settings') || '{}');
        this._mode = s.mode || 'polish';
        this._targetFormat = s.format || 'sdxl';
        this._model = s.model || '';
        this._maxChars = s.max_chars || 0;
        return s;
    } catch(e) { return {}; }
};

App.aiTools._saveOptSettings = function() {
    try {
        var mc = document.getElementById('aiOptMaxChars');
        var maxChars = this._maxChars || 0;
        if (mc && mc.value) {
            var n = parseInt(mc.value, 10);
            if (!isNaN(n) && n > 0) maxChars = Math.min(Math.max(n, 50), 3000);
        }
        localStorage.setItem('ai_optimizer_settings', JSON.stringify({
            mode: this._mode || 'polish',
            format: this._targetFormat || 'sdxl',
            model: this._model || '',
            max_chars: maxChars
        }));
    } catch(e) {}
};

// ============ AI 工具栏初始化 ============

App.aiTools.renderToolbar = function() {
    // Phase15: 渲染到 page-header 右侧，与标题同行
    var container = document.getElementById('aiToolbar');
    if (container) return container;
    var target = document.getElementById('pageHeaderRight');
    if (!target) return null;
    container = document.createElement('div');
    container.id = 'aiToolbar';
    container.className = 'ai-toolbar';
    container.style.cssText = 'display:none;display:flex;gap:4px;align-items:center;flex-wrap:wrap;';
    container.innerHTML = '' +
    // 编辑模式专属：优化 / 翻译(AI批量生成) / 缩图
    '<button class="ai-btn ai-btn-editonly" onclick="App.aiTools.openOptimizer()" title="AI智能优化提示词"><span>✨</span> 优化</button>' +
    '<button class="ai-btn ai-btn-editonly" onclick="App.aiTools.openTranslate()" title="批量翻译选中提示词"><span>🌐</span> 翻译</button>' +
    // 批量切换：标注档(精简) ↔ 详细档，当前分组全部词卡
    '<button class="ai-btn ai-btn-batch" onclick="App.aiTools.batchToggleTier()" title="批量切换 标注档/详细档（当前分组全部词卡）"><span>📄⇄📚</span> 标注/详细</button>' +
    // 批量切换：中英文翻译显示，当前分组全部词卡
    '<button class="ai-btn ai-btn-batch" onclick="App.aiTools.batchToggleLang()" title="批量切换中英文翻译显示（当前分组全部词卡，无翻译的保持原文）"><span>🆎</span> 中英</button>' +
    '<button class="ai-btn" onclick="App.aiTools.autoTagCurrent()" title="AI自动分析标签和分类"><span>🏷️</span> 标签</button>' +
    '<button class="ai-btn ai-btn-purple" onclick="App.aiTools.openOptimizer(\'adapt\')" title="适配SDXL/Flux/MJ/DALL-E"><span>🎯</span> 适配</button>' +
    '<button class="ai-btn ai-btn-green ai-btn-editonly" onclick="App.aiTools.aiThumbCurrent()" title="AI智能生成缩略图"><span>🎨</span> 缩图</button>' +
    // v5.37.0: 词卡 AI 生成（团队版专属）——顶部入口打开任务面板；批量入口在编辑模式勾选后使用
    '<button class="ai-btn ai-btn-purple" onclick="App.cardGen.openPanel()" title="词卡生成任务队列（高清/图生图/文生图/视频）"><span>🚀</span> 生成</button>' +
    '<button class="ai-btn ai-btn-green ai-btn-editonly" onclick="App.cardGen.openBatch([...App.state.batchSelected])" title="批量 AI 生成（文生图/图生图/视频），需先勾选词卡"><span>📦</span> 批量生成</button>' +
    '';
    target.appendChild(container);
    return container;
};

// ============ 工具栏显示/隐藏 ============

App.aiTools.showToolbar = function() {
    // 陈列架页面（_showShowcase）抑制工具栏
    if (App._aiToolbarSuppressed) return;
    var bar = this.renderToolbar();
    if (!bar) return;
    bar.style.display = 'flex';
    // 分层显示：编辑模式显示全量按钮；非编辑模式仅显示批量类按钮（标注/详细、中英、标签、适配）
    var isEdit = !!App.state.editMode;
    var editOnly = bar.querySelectorAll('.ai-btn-editonly');
    for (var i = 0; i < editOnly.length; i++) {
        editOnly[i].style.display = isEdit ? '' : 'none';
    }
};

// ============ 批量切换：标注档(simple) ↔ 详细档(detailed) ============

App.aiTools.batchToggleTier = function() {
    var prompts = App.state.prompts || [];
    if (prompts.length === 0) { App.showToast('当前分组没有词卡', 'warning'); return; }
    // 统计当前各档数量，切到“另一边”：详细占多数 → 切标注；否则切详细
    var counts = { simple: 0, detailed: 0, normal: 0 };
    for (var i = 0; i < prompts.length; i++) {
        var t = (typeof App._cardTierFor === 'function') ? App._cardTierFor(prompts[i].id) : 'normal';
        counts[t] = (counts[t] || 0) + 1;
    }
    var target = counts.detailed >= counts.simple ? 'simple' : 'detailed';
    // 清空 per-card 覆盖 → 全部走全局档位，统一生效
    App._cardTierState = {};
    try { localStorage.setItem('wc_card_tier', target); } catch(e) {}
    var updated = 0;
    for (var j = 0; j < prompts.length; j++) {
        var p = prompts[j], pid = p.id;
        var el = document.getElementById('cc_' + pid);
        if (el) {
            var tf = (typeof App._tierFields === 'function') ? App._tierFields(p, target) : null;
            var lang = (App.state._cardLang && App.state._cardLang[pid]) || el.getAttribute('data-lang') || 'original';
            var text = tf ? (lang === 'en' && tf.en ? tf.en : (lang === 'zh' && tf.zh ? tf.zh : (tf.main || p.content))) : p.content;
            el.textContent = text;
            updated++;
        }
        if (typeof App._updateCardTierBtns === 'function') App._updateCardTierBtns(pid);
        if (typeof App._updateTranslateBtn === 'function') App._updateTranslateBtn(pid);
    }
    App.showToast('已批量切换到「' + (target === 'simple' ? '标注' : '详细') + '」档：' + updated + '/' + prompts.length + ' 张词卡', 'success');
};

// ============ 批量切换：中英文翻译显示 ============

App.aiTools.batchToggleLang = function() {
    var prompts = App.state.prompts || [];
    if (prompts.length === 0) { App.showToast('当前分组没有词卡', 'warning'); return; }
    var flipped = 0, missing = 0;
    for (var i = 0; i < prompts.length; i++) {
        var p = prompts[i], pid = p.id;
        var el = document.getElementById('cc_' + pid);
        if (!el) continue;
        var tier = (typeof App._cardTierFor === 'function') ? App._cardTierFor(pid) : 'normal';
        var tf = (typeof App._tierFields === 'function') ? App._tierFields(p, tier) : null;
        if (!tf) continue;
        var original = tf.main || p.content;
        var zh = tf.zh, en = tf.en;
        var isCN = /[\u4e00-\u9fff]/.test(original);
        var lang = (App.state._cardLang && App.state._cardLang[pid]) || el.getAttribute('data-lang') || 'original';
        var target = null, text = original;
        if (lang === 'original') {
            if (isCN && en) { target = 'en'; text = en; }
            else if (!isCN && zh) { target = 'zh'; text = zh; }
            else { missing++; continue; }
        } else if (lang === 'zh') {
            target = en ? 'en' : 'original';
            text = en || original;
        } else { // en
            target = zh ? 'zh' : 'original';
            text = zh || original;
        }
        if (typeof App._setCardLang === 'function') {
            App._setCardLang(el, pid, target, text, original);
        } else {
            if (!el.getAttribute('data-original')) el.setAttribute('data-original', original);
            el.setAttribute('data-lang', target);
            el.textContent = text;
        }
        if (typeof App._updateTranslateBtn === 'function') App._updateTranslateBtn(pid);
        flipped++;
    }
    var msg = '批量中英切换完成：' + flipped + ' 张已切换';
    if (missing > 0) msg += '，' + missing + ' 张暂无对应翻译（保持原文）';
    App.showToast(msg, missing > 0 ? 'info' : 'success');
};

App.aiTools.hideToolbar = function() {
    var bar = document.getElementById('aiToolbar');
    if (bar) bar.style.display = 'none';
};

// ============================================================
//  PART 2: AI 优化器弹窗
// ============================================================

App.aiTools.openOptimizer = function(mode) {
    var saved = this._loadOptSettings();
    mode = mode || saved.mode || 'polish';
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
    var fmtSel = document.getElementById('aiOptFormat');
    if (fmtSel && saved.format) fmtSel.value = saved.format;

    // 恢复目标字数
    var mcEl = document.getElementById('aiOptMaxChars');
    if (mcEl && saved.max_chars) mcEl.value = saved.max_chars;
    this._maxChars = saved.max_chars || 0;

    // 清空输出
    var output = document.getElementById('aiOptOutput');
    if (output) output.value = '';
    this._updateCharCount('aiOptOutput', 'aiOptOutputCount', 8000);
    this._updateCharCount('aiOptInput', 'aiOptInputCount', 3000);
    var preview = document.getElementById('aiOptPreview');
    if (preview) preview.innerHTML = '<span style="color:var(--text-muted);">点击"开始优化"查看结果</span>';

    // 重置按钮
    var startBtn = document.getElementById('aiOptStartBtn');
    if (startBtn) { startBtn.disabled = false; startBtn.innerHTML = App._t('auto.str_bce5366e', '<span>✨</span> 开始优化'); }
    var applyBtn = document.getElementById('aiOptApplyBtn');
    if (applyBtn) applyBtn.style.display = 'none';
    var applyMenu = document.getElementById('aiOptApplyMenu');
    if (applyMenu) applyMenu.style.display = 'none';
    var stats = document.getElementById('aiOptStats');
    if (stats) stats.style.display = 'none';
    var cmp = document.getElementById('aiOptCompare');
    if (cmp) cmp.style.display = 'none';
    var chg = document.getElementById('aiOptChanges');
    if (chg) { chg.style.display = 'none'; chg.innerHTML = ''; }

    // Ollama 状态检测（异步不阻塞）
    this._checkOllamaStatus();
    // 模型列表加载
    this._loadModels();

    m.style.display = 'flex';
};

App.aiTools._ensureOptimizerModal = function() {
    var existing = document.getElementById('modalAiOptimizer');
    if (existing) {
        // 版本检测：旧结构缺少字数限制/可编辑输出 → 强制重建
        if (document.getElementById('aiOptMaxChars') && document.getElementById('aiOptOutputCount')) {
            return;
        }
        existing.parentNode.removeChild(existing);
    }

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

    // Ollama 状态条
    '<div id="aiOptOllamaStatus" style="display:flex;align-items:center;gap:6px;font-size:11px;margin-bottom:10px;padding:6px 10px;border-radius:8px;background:var(--hover-bg);color:var(--text-muted);">检测 Ollama 服务...</div>' +

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
    '<select id="aiOptFormat" onchange="App.aiTools._targetFormat=this.value;App.aiTools._saveOptSettings()" style="font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);">' +
    '<option value="sdxl">SDXL</option><option value="flux">Flux</option><option value="midjourney">Midjourney</option><option value="dalle">DALL-E 3</option>' +
    '</select>' +
    '</div>' +

    // 模型选择
    '<div id="aiOptModelRow" style="display:none;margin-bottom:10px;gap:6px;align-items:center;">' +
    '<span style="font-size:11px;color:var(--text-muted);">模型:</span>' +
    '<select id="aiOptModel" onchange="App.aiTools._model=this.value;App.aiTools._saveOptSettings()" style="font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);"></select>' +
    '<span id="aiOptModelHint" style="font-size:10px;color:var(--text-muted);"></span>' +
    '</div>' +

    // 输入区
    '<label style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px;display:block;">输入提示词 <span id="aiOptInputCount" style="float:right;font-weight:400;font-size:10px;color:var(--text-muted);">0 / 3000</span></label>' +
    '<textarea id="aiOptInput" class="modal-input" rows="3" placeholder="在此粘贴或修改提示词..." style="font-size:12px;margin-bottom:6px;" oninput="App.aiTools._updateCharCount(\'aiOptInput\',\'aiOptInputCount\',3000)"></textarea>' +

    // 目标字数
    '<div id="aiOptMaxCharsRow" style="display:flex;gap:6px;align-items:center;margin-bottom:10px;">' +
    '<span style="font-size:11px;color:var(--text-muted);">目标字数:</span>' +
    '<input id="aiOptMaxChars" type="number" min="50" max="3000" step="10" placeholder="不限" onchange="App.aiTools._saveOptSettings()" style="width:90px;font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);">' +
    '<span style="font-size:10px;color:var(--text-muted);">优化时控制输出长度（50-3000，留空不限）</span>' +
    '</div>' +

    // 按钮行
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<button id="aiOptStartBtn" class="btn btn-primary btn-sm" onclick="App.aiTools._runOptimize()" style="flex-shrink:0;"><span>✨</span> 开始优化</button>' +
    '<button id="aiOptStopBtn" class="btn btn-sm btn-outline" onclick="App.aiTools._stopStream()" style="display:none;flex-shrink:0;">⏹ 停止</button>' +
    '<button id="aiOptApplyBtn" class="btn btn-sm" onclick="App.aiTools._toggleApplyMenu()" style="display:none;flex-shrink:0;background:#10b981;color:#fff;border-color:#059669;">✅ 应用结果 ▾</button>' +
    '<span id="aiOptStatus" style="font-size:11px;color:var(--text-muted);align-self:center;"></span>' +
    '</div>' +

    // 应用菜单（三选一）
    '<div id="aiOptApplyMenu" style="display:none;margin-bottom:10px;padding:8px 10px;border:1px dashed var(--border-color);border-radius:8px;gap:6px;flex-wrap:wrap;">' +
    '<span style="font-size:11px;color:var(--text-muted);align-self:center;">应用方式:</span>' +
    '<button class="btn btn-sm" onclick="App.aiTools._applyOptimize(\'edit\')" style="border:1px solid #6366f1;color:#6366f1;">📝 填入编辑框</button>' +
    '<button class="btn btn-sm" onclick="App.aiTools._applyOptimize(\'save\')" style="border:1px solid #10b981;color:#10b981;">💾 保存到当前词条</button>' +
    '<button class="btn btn-sm" onclick="App.aiTools._applyOptimize(\'new\')" style="border:1px solid #f59e0b;color:#f59e0b;">➕ 另存为新词条</button>' +
    '<button class="btn btn-sm" onclick="App.aiTools._toggleApplyMenu()" style="border:1px solid var(--border-color);color:var(--text-muted);">取消</button>' +
    '</div>' +

    // 输出区
    '<div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;">' +
    '<div style="background:var(--hover-bg);padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">' +
    '<span style="font-size:11px;font-weight:600;">📝 优化结果 <span id="aiOptOutputCount" style="font-weight:400;font-size:10px;color:var(--text-muted);margin-left:6px;">0 / 8000</span></span>' +
    '<button class="btn btn-xs" onclick="App.aiTools._copyOutput()" style="font-size:10px;padding:2px 8px;">📋 复制</button>' +
    '</div>' +
    '<textarea id="aiOptOutput" rows="6" spellcheck="false" placeholder="优化结果生成后可在此直接编辑调整，再复制/应用..." style="width:100%;box-sizing:border-box;padding:10px 14px;font-size:12px;line-height:1.6;min-height:120px;max-height:300px;overflow-y:auto;font-family:system-ui;color:var(--text-main);background:var(--bg-card);border:none;outline:none;resize:vertical;" oninput="App.aiTools._updateCharCount(\'aiOptOutput\',\'aiOptOutputCount\',8000)"></textarea>' +
    '</div>' +

    // 结果统计
    '<div id="aiOptStats" style="display:none;margin-top:8px;font-size:11px;color:var(--text-muted);"></div>' +

    // 前后对比面板
    '<div id="aiOptCompare" style="display:none;margin-top:8px;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;">' +
    '<div style="background:var(--hover-bg);padding:6px 12px;font-size:11px;font-weight:600;">📊 前后对比</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">' +
    '<div style="padding:8px 12px;border-right:1px solid var(--border-color);"><div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">原始提示词</div><div id="aiOptOrigText" style="font-size:11px;line-height:1.5;max-height:110px;overflow-y:auto;white-space:pre-wrap;color:var(--text-muted);"></div></div>' +
    '<div style="padding:8px 12px;"><div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">优化后</div><div id="aiOptNewText" style="font-size:11px;line-height:1.5;max-height:110px;overflow-y:auto;white-space:pre-wrap;color:var(--text-main);"></div></div>' +
    '</div>' +
    '</div>' +

    // 改动点
    '<div id="aiOptChanges" style="display:none;margin-top:8px;"></div>' +

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
    this._saveOptSettings();
};

// ============ 执行优化 ============

App.aiTools._runOptimize = async function() {
    var input = document.getElementById('aiOptInput');
    var content = (input ? input.value : '').trim();
    if (!content) { App.showToast(App._t('editor.enter_content', '请输入提示词内容'), 'warning'); return; }
    if (content.length > 3000) { App.showToast('提示词超过 3000 字上限，请精简后再优化', 'warning'); return; }

    var startBtn = document.getElementById('aiOptStartBtn');
    var stopBtn = document.getElementById('aiOptStopBtn');
    var statusEl = document.getElementById('aiOptStatus');
    var outputEl = document.getElementById('aiOptOutput');
    var rawEl = document.getElementById('aiOptRaw');
    var applyBtn = document.getElementById('aiOptApplyBtn');
    var applyMenu = document.getElementById('aiOptApplyMenu');
    var statsEl = document.getElementById('aiOptStats');
    var cmpEl = document.getElementById('aiOptCompare');
    var chgEl = document.getElementById('aiOptChanges');

    if (startBtn) { startBtn.style.display = 'none'; }
    if (stopBtn) { stopBtn.style.display = 'inline-block'; }
    if (applyBtn) applyBtn.style.display = 'none';
    if (applyMenu) applyMenu.style.display = 'none';
    if (statsEl) statsEl.style.display = 'none';
    if (cmpEl) cmpEl.style.display = 'none';
    if (chgEl) { chgEl.style.display = 'none'; chgEl.innerHTML = ''; }
    if (statusEl) statusEl.textContent = App._t('auto.str_c67d8154', '⏳ 优化中...');
    if (outputEl) outputEl.value = '';
    if (rawEl) rawEl.textContent = '';

    // 使用流式输出
    this._isStreaming = true;
    this._abortStream = false;
    this._streamContent = '';
    this._streamRaw = '';
    this._streamError = '';
    this._lastResult = null;

    try {
        var body = JSON.stringify({
            content: content,
            mode: this._mode,
            target_format: this._targetFormat,
            extra_context: '',
            model: this._model || '',
            max_chars: this._getMaxChars()
        });

        var resp = await fetch('/api/ai/optimize/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });

        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var doneMeta = null;

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
                    if (data.done) {
                        // 收尾元数据（结构化/统计/模型名）
                        doneMeta = data;
                        this._lastResult = data;
                        continue;
                    }
                    if (data.error) {
                        this._streamError = data.error;
                        var diag = this._diagnoseError(data.error);
                        if (statusEl) statusEl.textContent = diag;
                        if (outputEl && !this._streamContent) outputEl.value = diag;
                        continue;
                    }
                    if (data.message && data.message.content) {
                        this._streamContent += data.message.content;
                        // 模型被引导输出 JSON：实时提取 content 展示
                        var clean = this._extractContent(this._streamContent);
                        if (outputEl) outputEl.value = clean || this._streamContent;
                        this._updateCharCount('aiOptOutput', 'aiOptOutputCount', 8000);
                    }
                    this._streamRaw += line + '\n';
                } catch(e) {
                    this._streamRaw += line + '\n';
                }
            }

            // 滚动到底部
            if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
        }

        // 收尾：用 done 元数据覆盖展示
        if (doneMeta) {
            var display = doneMeta.display_content || this._streamContent;
            this._streamContent = display;
            if (outputEl) outputEl.value = display;
            this._updateCharCount('aiOptOutput', 'aiOptOutputCount', 8000);
            this._renderResult(doneMeta, content);
        }
    } catch(e) {
        if (statusEl) statusEl.textContent = '❌ 请求未响应: ' + e.message;
        if (outputEl && !this._streamContent) outputEl.value = App._t('auto.str_67411e24', '请求未响应: ') + e.message;
    }

    // 完成
    this._isStreaming = false;
    if (startBtn) { startBtn.style.display = 'inline-block'; startBtn.innerHTML = App._t('auto.str_fd0f4fc1', '<span>🔄</span> 重新优化'); }
    if (stopBtn) stopBtn.style.display = 'none';

    if (this._streamContent && !this._streamError) {
        if (rawEl) rawEl.textContent = this._streamRaw.substring(0, 2000);
        if (applyBtn) applyBtn.style.display = 'inline-block';
    } else if (!this._streamContent && !this._streamError && !doneMeta) {
        if (statusEl) statusEl.textContent = App._t('auto.str_049aada2', '⚠️ 未获得有效输出，请重试');
    }
};

App.aiTools._stopStream = function() {
    this._abortStream = true;
};

// ============ 应用优化结果 ============

App.aiTools._applyOptimize = function(type) {
    var pid = this._currentPromptId;
    // 优先取可编辑输出区（用户可先修改再应用）
    var outEl = document.getElementById('aiOptOutput');
    var optContent = (outEl && outEl.value) ? outEl.value.trim() : (this._streamContent || '');
    if (!optContent) { App.showToast(App._t('auto.str_c76a2753', '没有优化结果可应用'), 'warning'); return; }
    if (optContent.length > 8000) { App.showToast('优化结果超过 8000 字上限，请精简', 'warning'); return; }
    this._streamContent = optContent;

    if (type === 'edit') {
        // 填入编辑框
        var editInput = document.getElementById('editContent');
        if (editInput && pid) {
            editInput.value = optContent;
            App.showToast(App._t('auto.str_a1fa07b2', '已填入编辑框，请保存'), 'success');
        } else {
            App.copyText(optContent, '已复制优化结果 (无关联编辑框)');
        }
        this._toggleApplyMenu();
        return;
    }
    if (type === 'save') {
        this._saveToCurrent(optContent);
        return;
    }
    if (type === 'new') {
        this._saveAsNew(optContent);
        return;
    }
    // 默认展开菜单
    this._toggleApplyMenu();
};

// 字数统计（input 事件回调）
App.aiTools._updateCharCount = function(elId, countId, max) {
    var el = document.getElementById(elId);
    var cnt = document.getElementById(countId);
    if (!el || !cnt) return;
    var n = el.value ? el.value.length : 0;
    cnt.textContent = n + ' / ' + max;
    cnt.style.color = n > max ? '#ef4444' : 'var(--text-muted)';
};

// 读取目标字数（50-3000，空=0 不限）
App.aiTools._getMaxChars = function() {
    var el = document.getElementById('aiOptMaxChars');
    if (!el || !el.value) return 0;
    var n = parseInt(el.value, 10);
    if (isNaN(n) || n <= 0) return 0;
    return Math.min(Math.max(n, 50), 3000);
};

// 展开/收起应用菜单
App.aiTools._toggleApplyMenu = function() {
    var menu = document.getElementById('aiOptApplyMenu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
};

// 保存到当前词条（PUT 更新，系统保留版本快照可回滚）
App.aiTools._saveToCurrent = async function(content) {
    var pid = this._currentPromptId;
    if (!pid) { App.showToast('当前没有关联词条，请用「另存为新词条」', 'warning'); this._toggleApplyMenu(); return; }
    if (!confirm('将优化结果保存到当前词条 #' + pid + '？\n原内容会被替换（系统保留版本快照，可回滚）。')) return;
    try {
        var resp = await fetch('/api/v4/word-cards/' + pid, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content })
        });
        var d = await resp.json();
        if (d && d.ok) {
            App.showToast('已保存到词条 #' + pid, 'success');
            this._toggleApplyMenu();
            if (App.state.currentView === 'home') App.loadPrompts();
            if (typeof App.loadWordCards === 'function') App.loadWordCards();
        } else {
            App.showToast('保存失败: ' + ((d && (d.detail || d.error)) || '未知错误'), 'error');
        }
    } catch(e) {
        App.showToast('保存异常: ' + e.message, 'error');
    }
};

// 另存为新词条（POST 创建，默认当前分组）
App.aiTools._saveAsNew = async function(content) {
    var gid = null;
    try {
        var prompts = App.state.prompts || [];
        var pid = this._currentPromptId;
        for (var i = 0; i < prompts.length; i++) {
            if (prompts[i].id === pid && prompts[i].group_id != null) { gid = prompts[i].group_id; break; }
        }
    } catch(e) {}
    var name = prompt('新词条名称（留空取内容前 60 字）：') || '';
    try {
        var resp = await fetch('/api/v4/word-cards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content, group_id: gid, name: name })
        });
        var d = await resp.json();
        if (d && d.ok) {
            App.showToast('已另存为新词条 #' + d.id, 'success');
            this._toggleApplyMenu();
            if (App.state.currentView === 'home') App.loadPrompts();
            if (typeof App.loadWordCards === 'function') App.loadWordCards();
        } else {
            App.showToast('创建失败: ' + ((d && (d.detail || d.error)) || '未知错误'), 'error');
        }
    } catch(e) {
        App.showToast('创建异常: ' + e.message, 'error');
    }
};

// 加载可用模型列表（/modes 返回 models + default + fast）
App.aiTools._loadModels = async function() {
    var sel = document.getElementById('aiOptModel');
    var row = document.getElementById('aiOptModelRow');
    var hint = document.getElementById('aiOptModelHint');
    if (!sel || !row) return;
    try {
        var resp = await fetch('/api/ai/optimize/modes', { headers: { 'Accept': 'application/json' } });
        var d = await resp.json();
        var models = (d && d.models) || [];
        var def = (d && d.default_model) || '';
        var fast = (d && d.fast_model) || '';
        if (!models.length) { row.style.display = 'none'; return; }
        var html = '<option value="">自动（' + App._escape(def) + '）</option>';
        var seen = {};
        models.forEach(function(m) {
            if (seen[m]) return;
            seen[m] = 1;
            var label = App._escape(m);
            if (m === fast) label += ' ⚡快';
            if (m === def) label += ' (默认)';
            html += '<option value="' + App._escape(m) + '">' + label + '</option>';
        });
        sel.innerHTML = html;
        sel.value = this._model || '';
        row.style.display = 'flex';
        if (hint) {
            var fastNote = fast ? ' · ⚡' + App._escape(fast) + ' 最快' : '';
            hint.textContent = '自动=' + App._escape(def) + '（高质量）' + fastNote;
        }
    } catch(e) {
        row.style.display = 'none';
    }
};

// Ollama 状态检测（复用 /api/health/status watcher 缓存）
App.aiTools._checkOllamaStatus = async function() {
    var el = document.getElementById('aiOptOllamaStatus');
    var startBtn = document.getElementById('aiOptStartBtn');
    if (!el) return;
    try {
        var resp = await fetch('/api/health/status', { headers: { 'Accept': 'application/json' } });
        var d = await resp.json();
        var ol = (d && d.ollama) || {};
        if (ol.ok) {
            el.innerHTML = '<span style="color:#10b981;">●</span> Ollama 可用' + (ol.url ? ' · ' + App._escape(ol.url) : '') + (ol.latency_ms ? ' · ' + ol.latency_ms + 'ms' : '');
            el.style.color = 'var(--text-muted)';
            if (startBtn) { startBtn.disabled = false; startBtn.style.opacity = ''; }
        } else {
            el.innerHTML = '<span style="color:#ef4444;">●</span> Ollama 离线 — 请先启动 Ollama 服务（默认端口 11434）' + (ol.error ? ' · ' + App._escape(ol.error) : '');
            el.style.color = '#ef4444';
            if (startBtn) { startBtn.disabled = true; startBtn.style.opacity = '0.5'; }
        }
    } catch(e) {
        el.innerHTML = '<span style="color:#f59e0b;">?</span> 无法检测 Ollama 状态';
    }
};

// 从流式缓冲中实时提取 JSON content（模型被引导输出 JSON）
App.aiTools._extractContent = function(buf) {
    if (!buf) return null;
    var t = buf.trim();
    if (t.charAt(0) !== '{') return null;
    try {
        var obj = JSON.parse(t);
        if (obj && typeof obj.content === 'string') return obj.content;
    } catch(e) {}
    var m = t.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (m) {
        try {
            var obj2 = JSON.parse(m[1]);
            if (obj2 && typeof obj2.content === 'string') return obj2.content;
        } catch(e2) {}
    }
    var cm = t.match(/"content"\s*:\s*"([^"]*)$/);
    if (cm) return cm[1];
    return null;
};

// 错误诊断分级
App.aiTools._diagnoseError = function(err) {
    var s = String(err || '');
    if (/not found|does not exist|pull|model not found/i.test(s)) return '❌ 模型未安装：请先在终端运行 ollama pull <model> 安装对应模型';
    if (/connect|refused|ECONN|timed? ?out|111/i.test(s)) return '❌ Ollama 服务未启动或无法连接（默认端口 11434）';
    if (/401|403/i.test(s)) return '❌ Ollama 认证失败，请检查服务配置';
    if (/HTTP 5\d\d|500|502|503|internal/i.test(s)) return '❌ Ollama 服务异常: ' + s;
    return '❌ ' + s;
};

// 收尾渲染：统计/对比/改动点/评分
App.aiTools._renderResult = function(meta, original) {
    var statusEl = document.getElementById('aiOptStatus');
    var statsEl = document.getElementById('aiOptStats');
    var cmpEl = document.getElementById('aiOptCompare');
    var chgEl = document.getElementById('aiOptChanges');

    var model = meta.model || '';
    var st = meta.structured || {};
    var before = meta.chars_before != null ? meta.chars_before : (original || '').length;
    var after = meta.chars_after != null ? meta.chars_after : (meta.display_content || '').length;

    // 状态条：模型 + 评分
    var parts = [];
    if (model) parts.push('模型: ' + model);
    if (st.score_before != null && st.score_after != null) parts.push('评分 ' + st.score_before + ' → ' + st.score_after);
    if (statusEl) statusEl.textContent = '✅ 优化完成 (' + after + ' 字符)' + (parts.length ? ' · ' + parts.join(' · ') : '');

    // 统计
    if (statsEl) {
        var pct = before > 0 ? Math.round((after - before) / before * 100) : 0;
        var sign = pct > 0 ? '+' : '';
        var compress = (st.original_length && st.compressed_length) ? ' · 精简率 ' + Math.round((1 - st.compressed_length / st.original_length) * 100) + '%' : '';
        var styleKeep = st.style_preserved ? ' · 风格保持 ✓' : '';
        statsEl.innerHTML = '原 ' + before + ' 字 → 优化后 ' + after + ' 字 (' + sign + pct + '%)' + compress + styleKeep;
        statsEl.style.display = 'block';
    }

    // 对比面板
    if (cmpEl) {
        var origEl = document.getElementById('aiOptOrigText');
        var newEl = document.getElementById('aiOptNewText');
        if (origEl) origEl.textContent = original || '';
        if (newEl) newEl.textContent = meta.display_content || '';
        cmpEl.style.display = 'block';
    }

    // 改动点
    if (chgEl) {
        var changes = st.changes;
        if (Array.isArray(changes) && changes.length) {
            var html = '<div style="background:var(--hover-bg);border-radius:8px;padding:8px 12px;font-size:11px;">' +
                '<div style="font-weight:600;margin-bottom:4px;">✏️ 改动说明</div>' +
                '<ul style="margin:0;padding-left:16px;color:var(--text-muted);">';
            changes.forEach(function(c) { html += '<li style="margin:2px 0;">' + App._escape(String(c)) + '</li>'; });
            html += '</ul></div>';
            chgEl.innerHTML = html;
            chgEl.style.display = 'block';
        } else {
            chgEl.style.display = 'none';
        }
    }
};

App.aiTools._copyOutput = function() {
    var outEl = document.getElementById('aiOptOutput');
    var text = (outEl && outEl.value) ? outEl.value : (this._streamContent || '');
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
    '<option value="auto" selected>自动检测 (中→英 / 英→中)</option>' +
    '<option value="zh">全部翻译成中文</option><option value="en">全部翻译成英文</option></select>' +
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
    var useAutoDetect = (lang === 'auto');  // auto → 不传 target_lang
    document.getElementById('aiTransStartBtn').disabled = true;
    document.getElementById('aiTransProgress').style.display = 'inline';

    var resultEl = document.getElementById('aiTransResult');
    resultEl.innerHTML = '';

    try {
        var body = { prompt_ids: ids.slice(0, 20), quality_check: false };
        if (!useAutoDetect) body.target_lang = lang;

        // 批量翻译耗时可能很长（每条 3-15s Ollama），设置 5 分钟超时
        var data = await App.fetchJSON('/api/translate/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            _timeoutMs: 300000  // 5min
        });

        if (!data) {
            resultEl.innerHTML = '<span style="color:#ef4444;">翻译未完成: 请求超时或 Ollama 未响应<br><small>提示: 检查 Ollama 是否运行 → 终端输入 ollama serve<br>如已运行，刷新页面重试</small></span>';
            App.showToast('翻译响应超时，Ollama 可能正忙', 'error');
            return;
        }

        var s = data.success || 0;
        var f = data.failed || 0;
        var c = data.cached || 0;
        var html = '<div style="margin-bottom:8px;font-weight:600;">' +
            '<span style="color:#10b981;">OK ' + s + '</span> / ' +
            '<span style="color:#ef4444;">未完成 ' + f + '</span> / ' +
            '<span style="color:#6366f1;">缓存 ' + c + '</span>' +
            (data.auto_detect ? ' <span style="font-size:10px;color:var(--text-muted);">(自动检测)</span>' : '') +
            '</div>';
        for (var i = 0; i < (data.results || []).length; i++) {
            var r = data.results[i];
            var style = r.ok ? 'color:#10b981;' : 'color:#ef4444;';
            var dir = r.direction || '';
            html += '<div style="padding:4px 0;border-bottom:1px solid var(--border-color);display:flex;gap:6px;align-items:center;">';
            html += '<span style="' + style + ';min-width:50px;">#' + r.prompt_id + '</span>';
            html += '<span style="font-size:10px;color:var(--text-muted);min-width:50px;">' + dir + '</span>';
            html += '<span style="flex:1;color:var(--text-main);">' + App._escape((r.translated || r.error || '').substring(0, 80)) + '</span>';
            html += '</div>';
        }
        resultEl.innerHTML = html;
        App.showToast('翻译完成: ' + s + '/' + ids.length, 'success');
    } catch(e) {
        resultEl.innerHTML = '<span style="color:#ef4444;">翻译未完成: ' + App._escape(e.message) + '</span>';
        App.showToast('翻译未完成: ' + (e.message || '网络不太稳定，请稍后重试'), 'error');
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
        App.showToast(App._t('auto.str_7ace8112', '标签分析未完成: ') + e.message, 'error');
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
                App.showToast(App._t('auto.str_7b9d7831', 'AI 分析未完成: ') + (data ? data.error : App._t('auto.str_1622dc9b', '未知')), 'warning');
            }
        } catch(e) {
            App.showToast(App._t('auto.str_e82a1516', 'AI 分析遇到问题: ') + e.message, 'error');
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
        App.showToast(App._t('auto.str_6464e87f', 'AI缩略图生成未完成: ') + e.message, 'error');
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
    '<div class="ctx-item" onclick="App.aiTools._ctxOpenWorkflow()"><span>🧩</span> 用工作流生成</div>' +
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

App.aiTools._translateLock = false;

App.aiTools._translateTimer = null;

App.aiTools._showTranslateProgress = function(elapsed) {
    var msg = '正在翻译（Ollama 处理中，已等待 ' + (elapsed|0) + ' 秒）...';
    App.showToast(msg, 'info');
};

App.aiTools._ctxTranslate = async function() {
    this._removeContextMenu();
    var pid = this._contextPromptId;
    if (!pid) return;

    // 防连点：已有翻译进行中则忽略本次点击
    if (App.aiTools._translateLock) {
        App.showToast('已有翻译进行中，请等待完成', 'warning');
        return;
    }
    App.aiTools._translateLock = true;

    App.showToast('正在翻译（Ollama 处理中）...', 'info');

    // 启动等待计时器，每 5 秒更新提示
    var startTime = Date.now();
    App.aiTools._translateTimer = setInterval(function() {
        var elapsed = ((Date.now() - startTime) / 1000);
        App.aiTools._showTranslateProgress(elapsed);
        // 超过 30 秒后缩短更新间隔，让用户知道还在跑
        if (elapsed > 120) {
            App.showToast('翻译处理较慢，仍在等待（' + (elapsed|0) + ' 秒）...', 'warning');
        }
    }, 5000);

    try {
        // 单条翻译耗时 15~40 秒，设置 180 秒超时确保不因排队超时
        var d = await App.fetchJSON('/api/translate/' + pid + '?target_lang=zh', { _timeoutMs: 180000 });
        clearInterval(App.aiTools._translateTimer);
        App.aiTools._translateTimer = null;

        if (d && d.ok && d.translated) {
            App.copyText(d.translated, App._t('common.copied', '已复制中文翻译'));
        } else {
            App.showToast(App._t('auto.str_31ff785e', '翻译未完成: ') + (d ? d.error : App._t('auto.str_1622dc9b', '未知')), 'error');
        }
    } catch(e) {
        clearInterval(App.aiTools._translateTimer);
        App.aiTools._translateTimer = null;
        App.showToast('翻译遇到问题: ' + e.message, 'error');
    } finally {
        App.aiTools._translateLock = false;
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
            App.showToast(App._t('auto.str_6aee2d39', '分析未完成'), 'error');
        }
    } catch(e) {
        App.showToast('分析遇到问题: ' + e.message, 'error');
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
            body: JSON.stringify({ prompt_id: pid, card_type: 'word_card' })
        });
        App.showToast(d.ok ? App._t('auto.str_90ef7b61', 'AI缩略图已生成') : App._t('auto.str_7f7de8a2', '生成未完成'), d.ok ? 'success' : 'error');
        App.loadPrompts();
    } catch(e) {
        App.showToast('生成遇到问题: ' + e.message, 'error');
    }
};

// 用工作流生成：从词卡调取关联工作流（ComfyUI 预览图生成）
App.aiTools._ctxOpenWorkflow = function() {
    this._removeContextMenu();
    var pid = this._contextPromptId;
    if (!pid) return;
    if (window.App && App.comfyLib) {
        App.comfyLib.openFromCard(pid);
    } else {
        App.showToast('工作流库未加载，请刷新页面', 'warning');
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
