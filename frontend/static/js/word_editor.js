// ============================================================
// v4.3.1: Unified Word Card Editor (多端编辑) — Phase19: 弹窗拓宽 900px + 左栏加宽
// 统一词卡编辑弹窗 — 从任意端(主界面/选取器/组装器/词库浏览器)打开
// 实时同步: 编辑后所有视图自动刷新
// ============================================================

(function() {
'use strict';

App.wordEditor = {
    _cardId: null,
    _source: '',   // 'cards' | 'picker' | 'composer' | 'browser'
    _onSaved: null,
    _groups: [],
};

// ============ 打开编辑器 ============

App.wordEditor.open = async function(options) {
    options = options || {};
    this._cardId = options.cardId || null;
    this._source = options.source || 'cards';
    this._onSaved = options.onSaved || null;

    this._ensureModal();

    var m = document.getElementById('modalWordEdit');
    if (!m) return;

    // 更新标题 + 按钮文字（编辑=保存，新建=添加）
    var title = document.getElementById('wcEditTitle');
    var saveBtn = document.getElementById('wcEditSaveBtn');
    var isEdit = !!this._cardId;
    if (title) title.textContent = isEdit ? App._t('auto.str_78033f01', '✏️ 编辑词卡') : App._t('auto.str_3f8ea773', '➕ 新建词卡');
    if (saveBtn) saveBtn.innerHTML = isEdit ? '💾 保存' : '➕ 添加';

    // 加载分组列表
    await this._loadGroups();

    if (this._cardId) {
        await this._loadCard();
    } else {
        this._resetForm();
        // Phase17.3: 新建词卡时预选当前分组（_resetForm 后再设置）
        if (this._prefillGroupId) {
            var gSel = document.getElementById('wcEditGroup');
            if (gSel) { gSel.value = this._prefillGroupId; this._updateGroupPickerBtn(); }
        }
    }

    m.style.display = 'flex';

    // Phase17: ESC 关闭弹窗
    this._escHandler = function(e) { if (e.key === 'Escape') { e.stopPropagation(); App.wordEditor.close(); } };
    document.addEventListener('keydown', this._escHandler);
};

App.wordEditor.close = function() {
    var m = document.getElementById('modalWordEdit');
    if (m) m.style.display = 'none';
    this._cardId = null;
    // Phase17: 移除 ESC 监听
    if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
    // Phase17: 清理暂存缩略图
    if (this._pendingThumbBlobUrl && this._pendingThumbBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this._pendingThumbBlobUrl);
    }
    this._pendingThumbFile = null;
    this._pendingThumbSource = null;
    this._pendingThumbBlobUrl = null;
    // Phase16.3: 清理视频暂存
    if (this._pendingVideoBlobUrl && this._pendingVideoBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this._pendingVideoBlobUrl);
    }
    this._pendingVideoFile = null;
    this._pendingVideoSource = null;
    this._pendingVideoBlobUrl = null;
};

// ============ 构建弹窗 ============

App.wordEditor._ensureModal = function() {
    if (document.getElementById('modalWordEdit')) return;

    var overlay = document.createElement('div');
    overlay.id = 'modalWordEdit';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:none;z-index:550;';

    overlay.innerHTML = '' +
    // Phase19: 双栏布局 — 左栏主填写流 + 右栏元数据/媒体，sticky footer 始终可见
    '<div class="wc-edit-modal">' +
    // Header — 紧凑标题栏
    '<div class="wc-edit-header">' +
    '<h5 id="wcEditTitle">✏️ 编辑词卡</h5>' +
    '<button class="wc-edit-close" onclick="App.wordEditor.close()">&times;</button>' +
    '</div>' +
    // Body — 双栏网格 + 内部滚动
    '<div class="wc-edit-body">' +
    // === 左栏：主填写流（词卡名称 → 核心内容 → 释义 → 场景 → 标签）===
    '<div class="wc-edit-left">' +
    '<label>词卡名称</label>' +
    '<input id="wcEditName" class="modal-input" placeholder="简短名称(选填,留空取内容前60字)">' +
    '<label>核心内容 <span style="color:#ef4444;">*</span></label>' +
    '<div style="display:flex;gap:4px;margin-bottom:4px;flex-wrap:wrap;align-items:center;">' +
    '<button type="button" id="wcTierSimple" class="wc-tier-btn" onclick="App.wordEditor._switchTier(\'simple\')" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-muted);">📄 简易</button>' +
    '<button type="button" id="wcTierNormal" class="wc-tier-btn" onclick="App.wordEditor._switchTier(\'normal\')" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid var(--primary);background:var(--primary);color:#fff;">📋 普通</button>' +
    '<button type="button" id="wcTierDetailed" class="wc-tier-btn" onclick="App.wordEditor._switchTier(\'detailed\')" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-muted);">📚 详细</button>' +
    '<span id="wcTierHint" style="font-size:9px;color:var(--text-muted);"></span>' +
    '</div>' +
    '<textarea id="wcEditContent" class="modal-input" rows="4" placeholder="提示词片段 / 关键词 / 描述文本..."></textarea>' +
    '<label>中文提示词 <span style="font-size:9px;color:var(--text-muted);">(可选，卡片中文显示用)</span></label>' +
    '<textarea id="wcEditContentZh" class="modal-input" rows="2" placeholder="中文提示词翻译/对照（可选）"></textarea>' +
    '<label>释义/说明</label>' +
    '<input id="wcEditMeaning" class="modal-input" placeholder="中文释义或补充说明">' +
    '<label>适用场景</label>' +
    '<input id="wcEditScene" class="modal-input" placeholder="如: 特写镜头 / 广角风光 / 室内人像">' +
    '<label>标签</label>' +
    '<div class="wc-edit-tags-row">' +
    '<input id="wcEditTags" class="modal-input" placeholder="用逗号或空格分隔, 如: 自然 温暖 电影感">' +
    '<button class="btn btn-xs ai-inline-btn" onclick="App.wordEditor._aiAnalyze()">🤖 AI分析</button>' +
    '</div>' +
    '</div>' +
    // === 右栏：元数据 + 缩略图 + 排序/图标/热度 ===
    '<div class="wc-edit-right">' +
    // 分组选择下拉（隐藏，实际仍由它取值）
    '<select id="wcEditGroup" style="display:none;"></select>' +
    '<label>所属分组</label>' +
    '<div class="wc-edit-group-row">' +
    '<button id="wcEditGroupBtn" class="wc-edit-group-btn" onclick="App.wordEditor._showGroupPicker()">📁 选择分组...</button>' +
    '<span id="wcEditGroupBadge" style="display:none;font-size:10px;padding:2px 8px;border-radius:10px;background:#10b981;color:#fff;white-space:nowrap;flex-shrink:0;"></span>' +
    '<button class="btn btn-xs ai-inline-btn" onclick="App.wordEditor._suggestGroup()" title="AI 智能推荐分组">🤖</button>' +
    '</div>' +
    '<label>分类</label>' +
    '<input id="wcEditCategory" class="modal-input" placeholder="二级分类">' +
    // 缩略图预览区
    '<div id="wcEditThumbRow" class="wc-edit-thumb-row">' +
    '<label>缩略图</label>' +
    '<div id="wcEditThumbPreviewArea" class="wc-edit-thumb-preview"><span>🖼</span></div>' +
    '<span id="wcEditThumbName">未设置</span>' +
    '<div class="wc-edit-thumb-actions">' +
    '<input type="file" id="wcEditThumbInput" accept="image/*" style="display:none;" onchange="App.wordEditor._uploadThumb(event)">' +
    '<button type="button" class="wc-edit-thumb-btn wc-edit-thumb-upload" onclick="document.getElementById(\'wcEditThumbInput\').click()">📤 图片</button>' +
    '<button type="button" class="wc-edit-thumb-btn wc-edit-thumb-lib" onclick="App.wordEditor._openThumbLibrary()">🖼 图库</button>' +
    '<input type="file" id="wcEditVideoInput" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo" style="display:none;" onchange="App.wordEditor._uploadVideo(event)">' +
    '<button type="button" class="wc-edit-thumb-btn wc-edit-thumb-video" onclick="document.getElementById(\'wcEditVideoInput\').click()">🎬 视频</button>' +
    '<button type="button" class="wc-edit-thumb-btn wc-edit-thumb-vlib" onclick="App.wordEditor._openVideoLibrary()">📁 视频库</button>' +
    '<button type="button" id="wcEditThumbClearBtn" class="wc-edit-thumb-btn wc-edit-thumb-clear" onclick="App.wordEditor._clearThumb()" style="display:none;">✕</button>' +
    '</div></div>' +
    // 排序/图标/热度
    '<div class="wc-edit-meta-row">' +
    '<div class="wc-edit-meta-item"><label>排序</label><input id="wcEditSort" type="number" class="modal-input" value="0"></div>' +
    '<div class="wc-edit-meta-item"><label>图标</label><input id="wcEditIcon" class="modal-input" placeholder="emoji"></div>' +
    '<div class="wc-edit-meta-item wc-edit-meta-heat"><label>热度</label><div class="wc-edit-heat-row"><input id="wcEditHeat" type="range" min="0" max="1" step="0.1" value="0.5" oninput="document.getElementById(\'wcEditHeatLabel\').textContent=this.value"><span id="wcEditHeatLabel">0.5</span></div></div>' +
    '</div>' +
    // 隐藏模块选择器（兼容）+ 内置标记
    '<select id="wcEditModule" style="display:none;"></select>' +
    '<div id="wcEditBuiltinRow" style="display:none;margin-top:8px;">' +
    '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--tag-bg);color:var(--primary);">🔒 内置词条 (部分字段不可编辑)</span>' +
    '</div>' +
    '</div>' +
    // 分组选择弹窗（层级独立，放在 body 末尾）
    '<div id="wcGroupPickerModal" class="modal-overlay" style="display:none;z-index:600;">' +
    '<div class="modal-content" style="max-width:420px;width:92%;max-height:70vh;overflow-y:auto;border-radius:12px;padding:0;">' +
    '<div style="padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">' +
    '<h6 style="margin:0;font-size:14px;">📁 选择分组</h6>' +
    '<button style="background:none;border:none;font-size:18px;color:var(--text-muted);cursor:pointer;" onclick="App.wordEditor._hideGroupPicker()">&times;</button>' +
    '</div>' +
    '<div id="wcGroupPickerTree" style="padding:8px 12px 12px;"></div>' +
    '</div></div>' +
    '</div>' +
    // Footer — sticky 固定底部
    '<div class="wc-edit-footer">' +
    '<button class="btn btn-danger btn-sm" id="wcEditDeleteBtn" onclick="App.wordEditor._delete()" style="margin-right:auto;display:none;">删除</button>' +
    '<button class="btn btn-outline btn-sm" onclick="App.wordEditor._showVersions()" style="font-size:11px;">📜 历史版本</button>' +
    '<button class="btn btn-secondary btn-sm" onclick="App.wordEditor.close()">取消</button>' +
    '<button class="btn btn-primary btn-sm" id="wcEditSaveBtn" onclick="App.wordEditor._save()">➕ 添加</button>' +
    '</div></div>';

    document.body.appendChild(overlay);
};

// ============ 数据加载 ============

App.wordEditor._loadGroups = async function() {
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/groups?include_empty=true');
        this._groups = d.groups || [];

        // 填充分组下拉（隐藏的旧控件，_save 仍从它取值）
        var sel = document.getElementById('wcEditGroup');
        if (sel) {
            sel.innerHTML = '<option value="">-- 无分组 --</option>';
            for (var i = 0; i < this._groups.length; i++) {
                var g = this._groups[i];
                sel.innerHTML += '<option value="' + g.id + '">' + (g.icon||'📄') + ' ' + App._escape(g.name) + ' [' + g.group_type + ']</option>';
            }
        }

        // 填充隐藏的模块下拉（兼容旧逻辑）
        this._buildModuleOptions();

        // Phase17.3: 更新分组选择按钮文字（如果已预设 group_id）
        this._updateGroupPickerBtn();

    } catch(e) { /* silent */ }
};

// Phase17.3: 根据隐藏控件更新分组选择按钮
App.wordEditor._updateGroupPickerBtn = function() {
    var sel = document.getElementById('wcEditGroup');
    var btn = document.getElementById('wcEditGroupBtn');
    var badge = document.getElementById('wcEditGroupBadge');
    if (!sel || !btn) return;
    
    if (sel.value) {
        var opt = sel.options[sel.selectedIndex];
        var name = opt ? opt.text.replace(/\[.*\]$/, '').trim() : '已选择';
        btn.innerHTML = '<span style="font-size:13px;">📁</span> ' + App._escape(name);
        btn.style.borderColor = '#10b981';
        if (badge) badge.style.display = 'inline-block';
    } else {
        btn.innerHTML = '📁 选择分组...';
        btn.style.borderColor = 'var(--border-color)';
        if (badge) badge.style.display = 'none';
    }
};

// Phase17.3: 弹出分组选择弹窗
App.wordEditor._showGroupPicker = async function() {
    var modal = document.getElementById('wcGroupPickerModal');
    if (!modal) return;
    
    // 构建分组树
    var tree = document.getElementById('wcGroupPickerTree');
    if (!tree) return;
    
    if (!this._groups || this._groups.length === 0) {
        try {
            var d = await App.fetchJSON('/api/v4/word-cards/groups?include_empty=true');
            this._groups = d.groups || [];
        } catch(e) {}
    }
    
    var currentVal = document.getElementById('wcEditGroup').value || '';
    var html = '<div style="display:flex;flex-direction:column;gap:2px;">';
    
    // "无分组" 选项
    var noGroupActive = !currentVal ? 'border:2px solid #10b981;background:#ecfdf5;' : 'border:1px solid transparent;';
    html += '<div onclick="App.wordEditor._selectGroupFromPicker(\'\')" style="padding:8px 10px;border-radius:8px;cursor:pointer;' + noGroupActive + 'transition:0.15s;margin-bottom:4px;font-size:13px;" onmouseenter="this.style.background=\'#f1f5f9\'" onmouseleave="this.style.background=\'\'">📭 无分组</div>';
    html += '<div style="border-top:1px solid var(--border-color);margin:4px 0 8px;"></div>';
    
    // 构建分组树（扁平展示带缩进）
    html += this._buildGroupPickerTree(this._groups, currentVal);
    html += '</div>';
    
    tree.innerHTML = html;
    modal.style.display = 'flex';
    
    // ESC 关闭
    var self = this;
    this._groupPickerEscHandler = function(e) {
        if (e.key === 'Escape') { self._hideGroupPicker(); }
    };
    document.addEventListener('keydown', this._groupPickerEscHandler);
};

// Phase17.3: 构建分组选择树（扁平+缩进）
App.wordEditor._buildGroupPickerTree = function(groups, currentVal) {
    // 构建父子映射
    var childrenMap = {};
    for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        var pid = g.parent_group_id || 'root';
        if (!childrenMap[pid]) childrenMap[pid] = [];
        childrenMap[pid].push(g);
    }
    
    var html = '';
    function renderNodes(parentId, depth) {
        var kids = childrenMap[parentId] || [];
        for (var i = 0; i < kids.length; i++) {
            var g = kids[i];
            var indent = depth * 20;
            var isActive = String(currentVal) === String(g.id);
            var activeStyle = isActive ? 'border:2px solid #10b981;background:#ecfdf5;font-weight:700;' : 'border:1px solid transparent;';
            var typeBadge = g.group_type === 'builtin' ? '<span style="font-size:9px;padding:1px 5px;border-radius:8px;background:var(--tag-bg);color:var(--primary);margin-left:4px;">内置</span>' : '';
            var cardCount = g.card_count ? ' <span style="font-size:10px;color:var(--text-muted);">(' + g.card_count + ')</span>' : '';
            html += '<div onclick="App.wordEditor._selectGroupFromPicker(\'' + g.id + '\')" data-group="' + g.id + '" style="padding:7px 10px 7px ' + (12 + indent) + 'px;border-radius:8px;cursor:pointer;' + activeStyle + 'transition:0.15s;font-size:13px;display:flex;align-items:center;gap:6px;" onmouseenter="if(!this.style.border.includes(\'#10b981\')){this.style.background=\'#f1f5f9\';}" onmouseleave="if(!this.style.border.includes(\'#10b981\')){this.style.background=\'\';}">';
            html += '<span>' + (g.icon||'📁') + '</span>';
            html += '<span>' + App._escape(g.name) + '</span>';
            html += typeBadge + cardCount;
            html += '</div>';
            // 递归子节点
            if (g.id && childrenMap[g.id]) {
                html += renderNodes(g.id, depth + 1);
            }
        }
        return html;
    }
    
    html += renderNodes('root', 0);
    return html;
};

// Phase17.3: 选中分组
App.wordEditor._selectGroupFromPicker = function(groupId) {
    var sel = document.getElementById('wcEditGroup');
    if (!sel) return;
    sel.value = groupId;
    this._updateGroupPickerBtn();
    this._hideGroupPicker();
};

// Phase17.3: 关闭分组选择弹窗
App.wordEditor._hideGroupPicker = function() {
    var modal = document.getElementById('wcGroupPickerModal');
    if (modal) modal.style.display = 'none';
    if (this._groupPickerEscHandler) {
        document.removeEventListener('keydown', this._groupPickerEscHandler);
        this._groupPickerEscHandler = null;
    }
};

// ============ 模块选择器 ============

App.wordEditor._MODULE_ICONS = {emotion:'😊',color:'🎨',tone:'🌅',composition:'📐',seedance:'🎬',custom:'📝'};

App.wordEditor._buildModuleOptions = function() {
    var sel = document.getElementById('wcEditModule');
    if (!sel) return;

    // 收集所有模块(从groups的builtin/custom类型 + 预设5个)
    var modules = [];
    var seen = {};

    // 从groups提取builtin/custom模块
    for (var i = 0; i < this._groups.length; i++) {
        var g = this._groups[i];
        if (g.group_type === 'builtin' || g.group_type === 'custom') {
            var modName = g.name;
            var modKey = g.group_key || modName;
            if (!seen[modKey]) {
                seen[modKey] = true;
                modules.push({ key: modKey, name: modName, type: g.group_type, icon: g.icon || this._MODULE_ICONS[modKey] || '📂', groupId: g.id });
            }
        }
    }

    // 确保预设5模块都在列表中
    var presetKeys = ['emotion','color','tone','composition','seedance'];
    var presetNames = {emotion:'人物表情',color:App._t('auto.str_67a7c94b', '场景色彩'),tone:'画面色调',composition:App._t('auto.str_ebe1d3eb', '分镜构图'),seedance:App._t('auto.str_94df12b2', '视频模版')};
    for (var i = 0; i < presetKeys.length; i++) {
        var pk = presetKeys[i];
        if (!seen[pk]) {
            var gid = null;
            for (var j = 0; j < this._groups.length; j++) {
                if (this._groups[j].group_key === pk) { gid = this._groups[j].id; break; }
            }
            modules.push({ key: pk, name: presetNames[pk]||pk, type: 'builtin', icon: this._MODULE_ICONS[pk]||'📄', groupId: gid });
            seen[pk] = true;
        }
    }

    // 添加"不归属模块"选项
    var h = '<option value="">-- 不归属任何模块 --</option>';
    for (var i = 0; i < modules.length; i++) {
        var m = modules[i];
        var typeLabel = m.type === 'builtin' ? '内置' : App._t('auto.custom_', '自定义');
        h += '<option value="' + App._escape(m.key) + '" data-group-id="' + (m.groupId||'') + '">'
            + (m.icon||'📄') + ' ' + App._escape(m.name) + ' <span style="color:var(--text-muted);font-size:10px;">(' + typeLabel + ')</span>'
            + '</option>';
    }
    sel.innerHTML = h;

    // 存储模块映射供后续使用
    this._moduleMap = {};
    for (var i = 0; i < modules.length; i++) {
        var m = modules[i];
        this._moduleMap[m.key] = m;
    }
};

// 模块改变 → 自动同步分组
App.wordEditor._onModuleChange = function() {
    var modSel = document.getElementById('wcEditModule');
    if (!modSel) return;

    var moduleKey = modSel.value;
    var selectedOpt = modSel.options[modSel.selectedIndex];
    var groupId = selectedOpt ? selectedOpt.getAttribute('data-group-id') : '';

    var groupSel = document.getElementById('wcEditGroup');
    if (groupSel && groupId) {
        groupSel.value = groupId;
        // 视觉提示
        groupSel.style.borderColor = '#10b981';
        setTimeout(function() { groupSel.style.borderColor = 'var(--border-color)'; }, 2000);
    } else if (groupSel && !moduleKey) {
        groupSel.value = '';
    }

    // 更新新模块输入框的提示
    if (!moduleKey) {
        this._hideNewModule();
    }
};

// 新建自定义模块
App.wordEditor._showNewModuleInput = function() {
    var row = document.getElementById('wcNewModuleRow');
    if (row) { row.style.display = 'flex'; }
    var inp = document.getElementById('wcNewModuleName');
    if (inp) { inp.value = ''; inp.focus(); }
};

App.wordEditor._hideNewModule = function() {
    var row = document.getElementById('wcNewModuleRow');
    if (row) { row.style.display = 'none'; }
};

App.wordEditor._createModule = async function() {
    var inp = document.getElementById('wcNewModuleName');
    var name = (inp ? inp.value : '').trim();
    if (!name) { App.showToast(App._t('auto.enter_模块名称', '请输入模块名称'), 'warning'); return; }

    var key = 'custom_' + name.replace(/[^a-z0-9_\u4e00-\u9fff]/gi, '_').substring(0, 30);

    try {
        // 创建模块 → 实际是创建 word_card_group
        var d = await App.fetchJSON('/api/v4/word-cards/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                group_key: key,
                icon: '📂',
                description: App._t('auto.custom_模块__', '自定义模块: ') + name
            })
        });

        if (d && d.ok) {
            // 重新加载分组和模块列表
            await this._loadGroups();
            // 同步刷新功能模块侧边栏
            await App.loadModules();

            // 自动选中新模块
            var modSel = document.getElementById('wcEditModule');
            if (modSel) {
                modSel.value = key;
                // 触发同步
                this._onModuleChange();
            }

            // 关闭新模块输入框
            this._hideNewModule();
            App.showToast('模块 \'' + App._t('auto.str_2c7f8c16','模块 \'') + name + '\' 已创建并选中', 'success');
        } else {
            App.showToast('创建未完成: ' + (d ? d.error || d.detail || App._t('auto.str_4cd13eba', '名称可能重复') : ''), 'error');
        }
    } catch(e) {
        App.showToast('创建遇到问题: ' + e.message, 'error');
    }
};

App.wordEditor._loadCard = async function() {
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/' + this._cardId);
        if (!d || !d.card) { App.showToast(App._t('auto.load_词卡失败', '加载词卡未完成'), 'error'); return; }
        var c = d.card;

        document.getElementById('wcEditGroup').value = c.group_id || '';
        this._updateGroupPickerBtn();  // Phase17.3: 同步分组选择按钮
        document.getElementById('wcEditName').value = c.name || '';
        // 三档内容：简易/普通/详细（content 为普通档），默认显示上次编辑档位
        this._tiers = { simple: c.content_simple || '', normal: c.content || '', detailed: c.content_detailed || '' };
        var lastTier = 'normal';
        try { lastTier = localStorage.getItem('wc_edit_tier') || 'normal'; } catch(e) {}
        if (lastTier !== 'simple' && lastTier !== 'detailed') lastTier = 'normal';
        this._tier = lastTier;
        document.getElementById('wcEditContent').value = this._tiers[this._tier] || '';
        this._updateTierUI();
        document.getElementById('wcEditContentZh').value = c.content_zh || '';
        document.getElementById('wcEditMeaning').value = c.meaning || '';
        document.getElementById('wcEditModule').value = c.module || 'custom';
        document.getElementById('wcEditCategory').value = c.category || '';
        document.getElementById('wcEditScene').value = c.scene || '';
        document.getElementById('wcEditSort').value = c.sort_order || 0;
        document.getElementById('wcEditIcon').value = c.icon || '';
        var heat = c.heat_weight || 0.5;
        var heatEl = document.getElementById('wcEditHeat');
        if (heatEl) { heatEl.value = heat; }
        var heatLabel = document.getElementById('wcEditHeatLabel');
        if (heatLabel) heatLabel.textContent = heat;

        // 缩略图/视频预览 (Phase17: 图片+视频双模式，用 innerHTML 容器)
        var thumbRow = document.getElementById('wcEditThumbRow');
        var thumbPreview = document.getElementById('wcEditThumbPreviewArea');
        var thumbName = document.getElementById('wcEditThumbName');
        var clearBtn = document.getElementById('wcEditThumbClearBtn');
        if (thumbRow) thumbRow.style.display = 'block';
        // 视频优先：有视频则显示视频预览
        if (c.preview_media && thumbPreview && thumbName) {
            var posterFromThumb = c.thumbnail ? ('/api/v4/word-cards/thumbnails/' + c.thumbnail) : ('');
            thumbPreview.innerHTML = '<video id="wcEditThumbPreview" src="/api/v4/word-cards/videos/' + c.preview_media + '" muted preload="metadata" poster="' + posterFromThumb + '" style="width:100%;max-height:160px;border-radius:6px;object-fit:contain;" onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>';
            thumbName.textContent = '🎬 ' + c.preview_media.substring(0, 25);
            if (clearBtn) clearBtn.style.display = 'inline-block';
        } else if (c.thumbnail && thumbPreview && thumbName) {
            thumbPreview.innerHTML = '<img id="wcEditThumbPreview" src="/api/v4/word-cards/thumbnails/' + c.thumbnail + '" style="width:100%;max-height:160px;border-radius:6px;object-fit:contain;">';
            thumbName.textContent = c.thumbnail.substring(0, 20) + (c.thumbnail.length > 20 ? '...' : '');
            if (clearBtn) clearBtn.style.display = 'inline-block';
        } else {
            if (thumbPreview) thumbPreview.innerHTML = '<span style="font-size:28px;color:var(--text-muted);">🖼</span>';
            if (thumbName) thumbName.textContent = '未设置';
            if (clearBtn) clearBtn.style.display = 'none';
        }

        // 内置标记
        var builtinRow = document.getElementById('wcEditBuiltinRow');
        if (builtinRow) builtinRow.style.display = c.is_builtin ? 'block' : 'none';

        // 标签
        var tags = c.tags || [];
        if (typeof tags === 'string') {
            try { tags = JSON.parse(tags); } catch(e) { tags = []; }
        }
        document.getElementById('wcEditTags').value = tags.join(', ');

        // 删除按钮显示
        var delBtn = document.getElementById('wcEditDeleteBtn');
        if (delBtn) delBtn.style.display = c.is_builtin ? 'none' : 'inline-block';

    } catch(e) {
        App.showToast(App._t('common.load_failed', '加载未完成: ') + e.message, 'error');
    }
};

App.wordEditor._resetForm = function() {
    document.getElementById('wcEditGroup').value = '';
    document.getElementById('wcEditName').value = '';
    document.getElementById('wcEditContent').value = '';
    document.getElementById('wcEditMeaning').value = '';
    document.getElementById('wcEditModule').value = 'custom';
    document.getElementById('wcEditCategory').value = '';
    document.getElementById('wcEditScene').value = '';
    document.getElementById('wcEditSort').value = '0';
    document.getElementById('wcEditIcon').value = '';
    var heatEl = document.getElementById('wcEditHeat');
    if (heatEl) heatEl.value = '0.5';
    var heatLabel = document.getElementById('wcEditHeatLabel');
    if (heatLabel) heatLabel.textContent = '0.5';
    // Phase17.3: 重置分组选择按钮
    var btn = document.getElementById('wcEditGroupBtn');
    if (btn) { btn.innerHTML = '📁 选择分组...'; btn.style.borderColor = 'var(--border-color)'; }
    var badge = document.getElementById('wcEditGroupBadge');
    if (badge) badge.style.display = 'none';
    // Phase17: 清理暂存缩略图
    if (this._pendingThumbBlobUrl && this._pendingThumbBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this._pendingThumbBlobUrl);
    }
    this._pendingThumbFile = null;
    this._pendingThumbSource = null;
    this._pendingThumbBlobUrl = null;
    // Phase16.3: 清理视频暂存
    if (this._pendingVideoBlobUrl && this._pendingVideoBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this._pendingVideoBlobUrl);
    }
    this._pendingVideoFile = null;
    this._pendingVideoSource = null;
    this._pendingVideoBlobUrl = null;
    var thumbRow = document.getElementById('wcEditThumbRow');
    if (thumbRow) {
        thumbRow.style.display = 'block';
        var thumbImg = document.getElementById('wcEditThumbPreview');
        var thumbName = document.getElementById('wcEditThumbName');
        var clearBtn = document.getElementById('wcEditThumbClearBtn');
        if (thumbImg) thumbImg.style.display = 'none';
        if (thumbName) thumbName.textContent = '未设置';
        if (clearBtn) clearBtn.style.display = 'none';
    }
    var builtinRow = document.getElementById('wcEditBuiltinRow');
    if (builtinRow) builtinRow.style.display = 'none';
    document.getElementById('wcEditTags').value = '';
    var delBtn = document.getElementById('wcEditDeleteBtn');
    if (delBtn) delBtn.style.display = 'none';
};

// Phase18: 连续添加模式 — 只清空内容字段，保留模块/分组/标签/排序
App.wordEditor._resetContentForBatchAdd = function() {
    // 清空内容字段
    document.getElementById('wcEditName').value = '';
    document.getElementById('wcEditContent').value = '';
    document.getElementById('wcEditMeaning').value = '';
    document.getElementById('wcEditScene').value = '';
    // 保留: module, category, group_id, sort_order, icon, heat, tags
    // 清空缩略图/视频预览（每次新词卡不继承）
    if (this._pendingThumbBlobUrl && this._pendingThumbBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this._pendingThumbBlobUrl);
    }
    this._pendingThumbFile = null;
    this._pendingThumbSource = null;
    this._pendingThumbBlobUrl = null;
    var thumbRow = document.getElementById('wcEditThumbRow');
    if (thumbRow) {
        thumbRow.style.display = 'block';
        var thumbImg = document.getElementById('wcEditThumbPreview');
        var thumbName = document.getElementById('wcEditThumbName');
        var clearBtn = document.getElementById('wcEditThumbClearBtn');
        if (thumbImg) thumbImg.style.display = 'none';
        if (thumbName) thumbName.textContent = '未设置';
        if (clearBtn) clearBtn.style.display = 'none';
    }
    // 清空视频暂存
    if (this._pendingVideoBlobUrl && this._pendingVideoBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this._pendingVideoBlobUrl);
    }
    this._pendingVideoFile = null;
    this._pendingVideoSource = null;
    this._pendingVideoBlobUrl = null;
    // 隐藏删除按钮
    var delBtn = document.getElementById('wcEditDeleteBtn');
    if (delBtn) delBtn.style.display = 'none';
    // 标记为新建（button 保持为「➕ 添加」）
    this._cardId = null;
    var title = document.getElementById('wcEditTitle');
    if (title) title.textContent = '➕ 新建词卡';
    var saveBtn = document.getElementById('wcEditSaveBtn');
    if (saveBtn) saveBtn.innerHTML = '➕ 添加';
    // 重置三档
    this._tiers = { simple: '', normal: '', detailed: '' };
    this._tier = 'normal';
    this._updateTierUI();
    // 聚焦到内容输入框，方便继续输入
    var contentEl = document.getElementById('wcEditContent');
    if (contentEl) setTimeout(function() { contentEl.focus(); }, 100);
};

// ============ 三档切换 ============

App.wordEditor._switchTier = function(tier) {
    var ta = document.getElementById('wcEditContent');
    if (ta && this._tiers) this._tiers[this._tier] = ta.value;
    this._tier = tier;
    if (ta) ta.value = (this._tiers && this._tiers[tier]) || '';
    this._updateTierUI();
    // 记住档位（再次打开词卡保持上次档位）
    try { localStorage.setItem('wc_edit_tier', tier); } catch(e) {}
};

App.wordEditor._updateTierUI = function() {
    var hint = document.getElementById('wcTierHint');
    if (hint) hint.textContent = this._tier === 'simple' ? '精简短版' : (this._tier === 'detailed' ? '丰富详细版' : '标准版');
    var map = { simple: 'wcTierSimple', normal: 'wcTierNormal', detailed: 'wcTierDetailed' };
    for (var k in map) {
        var b = document.getElementById(map[k]);
        if (!b) continue;
        var active = k === this._tier;
        b.style.background = active ? 'var(--primary)' : 'var(--bg-card)';
        b.style.color = active ? '#fff' : 'var(--text-muted)';
        b.style.borderColor = active ? 'var(--primary)' : 'var(--border-color)';
    }
};

// ============ 保存/删除 ============

App.wordEditor._save = async function() {
    var ta = document.getElementById('wcEditContent');
    var content = ta.value.trim();
    if (!content) { App.showToast('核心内容不能为空', 'warning'); return; }
    // 保存当前档位值，三档全部提交（未编辑档保留原值）
    if (this._tiers) this._tiers[this._tier] = ta.value;
    var tiers = this._tiers || { simple: '', normal: content, detailed: '' };

    var data = {
        name: document.getElementById('wcEditName').value.trim(),
        content: content,
        content_zh: document.getElementById('wcEditContentZh').value.trim(),
        content_simple: (tiers.simple || '').trim(),
        content_detailed: (tiers.detailed || '').trim(),
        meaning: document.getElementById('wcEditMeaning').value.trim(),
        scene: document.getElementById('wcEditScene').value.trim(),
        module: document.getElementById('wcEditModule').value,
        category: document.getElementById('wcEditCategory').value.trim(),
        sort_order: parseInt(document.getElementById('wcEditSort').value) || 0,
        icon: document.getElementById('wcEditIcon').value.trim(),
        group_id: parseInt(document.getElementById('wcEditGroup').value) || null,
        heat_weight: parseFloat(document.getElementById('wcEditHeat').value) || 0.5,
    };

    // 自动同步: 选择了模块 → 映射到对应的group_id
    if (data.module && !data.group_id) {
        var modOpt = document.querySelector('#wcEditModule option:checked');
        if (modOpt) {
            var gid = modOpt.getAttribute('data-group-id');
            if (gid) data.group_id = parseInt(gid);
        }
    }
    // 反向: 没选模块但选了分组 → 从分组名反推模块
    if (!data.module && data.group_id && this._groups) {
        for (var i = 0; i < this._groups.length; i++) {
            var g = this._groups[i];
            if (g.id === data.group_id && (g.group_type === 'builtin' || g.group_type === 'custom')) {
                data.module = g.group_key;
                break;
            }
        }
    }

    // 解析标签
    var tagsRaw = document.getElementById('wcEditTags').value.trim();
    if (tagsRaw) {
        var tags = tagsRaw.split(/[,，\s]+/).filter(function(t) { return t.trim(); });
        data.tags = tags;
    } else {
        data.tags = [];
    }

    var url, method;
    if (this._cardId) {
        url = '/api/v4/word-cards/' + this._cardId;
        method = 'PUT';
    } else {
        url = '/api/v4/word-cards';
        method = 'POST';
    }

    try {
        var result;
        if (App.cardModel) {
            result = this._cardId
                ? await App.cardModel.update(this._cardId, data)
                : await App.cardModel.create(data);
        } else {
            result = await App.fetchJSON(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        if (result && result.ok) {
            var newId = result.id || this._cardId;
            var wasNew = !this._cardId;  // 记录是否新建

            // Phase18: 连续添加模式 — 新建词卡后不关闭弹窗、保留模块/分组/标签、清空内容字段
            if (wasNew) {
                // Phase17: 新建词卡保存后，自动上传暂存的缩略图
                if (this._pendingThumbFile || this._pendingThumbSource) {
                    try {
                        if (this._pendingThumbFile) {
                            var fd = new FormData();
                            fd.append('file', this._pendingThumbFile);
                            await fetch('/api/v4/word-cards/' + newId + '/thumbnail', { method: 'POST', body: fd });
                        } else if (this._pendingThumbSource) {
                            await App.fetchJSON('/api/v4/word-cards/' + newId + '/thumbnail-from-library', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ source_filename: this._pendingThumbSource })
                            });
                        }
                        // 清理暂存
                        if (this._pendingThumbBlobUrl && this._pendingThumbBlobUrl.startsWith('blob:')) {
                            URL.revokeObjectURL(this._pendingThumbBlobUrl);
                        }
                        this._pendingThumbFile = null;
                        this._pendingThumbSource = null;
                        this._pendingThumbBlobUrl = null;
                    } catch(e) { console.warn('[wordEditor] pending thumb upload failed:', e); }
                }

                // Phase16.3: 新建词卡保存后，自动关联视频库视频
                if (this._pendingVideoSource) {
                    try {
                        await App.fetchJSON('/api/v4/word-cards/' + newId + '/video-from-library', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ source_filename: this._pendingVideoSource })
                        });
                        if (this._pendingVideoBlobUrl && this._pendingVideoBlobUrl.startsWith('blob:')) {
                            URL.revokeObjectURL(this._pendingVideoBlobUrl);
                        }
                        this._pendingVideoFile = null;
                        this._pendingVideoSource = null;
                        this._pendingVideoBlobUrl = null;
                    } catch(e) { console.warn('[wordEditor] pending video associate failed:', e); }
                }

                // 回调通知调用方刷新
                if (this._onSaved) {
                    this._onSaved({ id: newId, ...data });
                }

                // 通知选取器刷新
                if (App.wordPicker && App.wordPicker._load) App.wordPicker._load();

                // 刷新侧边栏模块计数
                await App.loadModules();

                // 刷新列表
                if (this._source === 'cards' && App.loadPrompts) {
                    App.loadPrompts();
                } else if (App.wordCards && App.wordCards.load) {
                    App.wordCards.load();
                }

                App.showToast('✅ 词卡已添加，可继续添加', 'success');

                // 连续添加：重置内容字段，保留模块/分组/标签
                this._resetContentForBatchAdd();

            } else {
                // 编辑模式 — 保存后自动关闭弹窗
                this._cardId = newId;
                App.showToast(App._t('auto.str_03f4d8a4', '词卡已保存'), 'success');

                // 回调通知调用方刷新
                if (this._onSaved) {
                    this._onSaved({ id: newId, ...data });
                }

                if (App.wordPicker && App.wordPicker._load) App.wordPicker._load();
                await App.loadModules();
                if (this._source === 'cards' && App.loadPrompts) {
                    App.loadPrompts();
                } else if (App.wordCards && App.wordCards.load) {
                    App.wordCards.load();
                }
                
                // 保存后关闭弹窗
                this.close();
            }
        } else {
            App.showToast(App._t('common.save', '保存未完成，稍后再试: ') + (result ? result.error || App._t('common.unknown_error', '遇到意外情况，请稍后再试') : App._t('common.net_error', '网络不太稳定，请稍后重试')), 'error');
        }
    } catch(e) {
        App.showToast(App._t('common.save', '保存遇到问题: ') + e.message, 'error');
    }
};

App.wordEditor._delete = async function() {
    if (!this._cardId) return;
    if (!confirm(App._t('common.confirm', '确认删除此词卡？内置词卡将软删除，自定义词卡将永久删除。'))) return;

    try {
        var result = App.cardModel
            ? await App.cardModel.delete(this._cardId)
            : await App.fetchJSON('/api/v4/word-cards/' + this._cardId, { method: 'DELETE' });
        if (result && result.ok) {
            App.showToast(App._t('auto.str_086098f3', '词卡已删除'), 'success');
            this.close();

            if (this._onSaved) this._onSaved({ id: this._cardId, _deleted: true });
            if (App.wordPicker && App.wordPicker._load) App.wordPicker._load();
            if (this._source === 'cards' && App.loadPrompts) App.loadPrompts();
        }
    } catch(e) {
        App.showToast(App._t('common.delete', '未能删除: ') + e.message, 'error');
    }
};

// ============ AI 分析 ============

App.wordEditor._aiAnalyze = async function() {
    var content = document.getElementById('wcEditContent').value.trim();
    if (!content) { App.showToast('请先输入词卡内容', 'warning'); return; }

    // Phase19: 选择器适配双栏布局 — AI分析按钮在 .wc-edit-tags-row 内
    var btn = document.querySelector('.wc-edit-tags-row .ai-inline-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }

    try {
        var d = await App.fetchJSON('/api/ai/auto-tag/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content })
        });

        if (d && d.ok) {
            if (d.module) document.getElementById('wcEditModule').value = d.module;
            if (d.category) document.getElementById('wcEditCategory').value = d.category;
            if (d.tags && d.tags.length > 0) document.getElementById('wcEditTags').value = d.tags.join(', ');
            if (d.meaning) document.getElementById('wcEditMeaning').value = d.meaning;
            App.showToast(App._t('auto.str_2af074b6', 'AI 分析完成'), 'success');
        } else {
            App.showToast(App._t('auto.str_7b9d7831', 'AI 分析未完成: ') + (d ? d.error : ''), 'warning');
        }
    } catch(e) {
        App.showToast(App._t('auto.str_e82a1516', 'AI 分析遇到问题: ') + e.message, 'error');
    }

    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI分析'; }
};

// ============ 多端快捷入口 ============

// 入口1: 主界面卡片 → 编辑按钮
App.wordEditor.openFromCard = function(cardId) {
    this.open({ cardId: cardId, source: 'cards' });
};

// 入口2: 选取器 → 右键编辑
App.wordEditor.openFromPicker = function(cardId) {
    this.open({
        cardId: cardId,
        source: 'picker',
        onSaved: function() {
            if (App.wordPicker && App.wordPicker._load) App.wordPicker._load();
        }
    });
};

// 入口3: 组装器 → 词卡快速编辑
App.wordEditor.openFromComposer = function(cardId) {
    this.open({
        cardId: cardId,
        source: 'composer',
        onSaved: function() {
            // 通知 Seedance 刷新选取面板
            if (App.seedanceV2 && App.seedanceV2._renderRightPickerContent) {
                var lib = App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
                if (lib) App.seedanceV2._renderRightPickerContent(lib);
            }
        }
    });
};

// 入口4: 新建词卡（快捷）
// Phase17.4: 修复预选分组竞态 — 必须 await open() 完成后再清除 _prefillGroupId
// 未传 groupId 时自动继承当前分组
App.wordEditor.openCreate = async function(groupId, source) {
    source = source || 'cards';
    // 未传 groupId → 自动使用当前选中的分组
    if (!groupId && App.state && App.state.currentGroupId) {
        groupId = App.state.currentGroupId;
    }
    this._prefillGroupId = groupId || null;
    await this.open({ cardId: null, source: source });
    // 预设分组已在 open → _resetForm 后应用，此处清理
    this._prefillGroupId = null;
};

// ============ Hook: 主界面编辑按钮路由到 word_card ============

// 重载 openEditModal → 优先查 word_card，回退旧 API
var _origOpenEdit = App.openEditModal;
App.openEditModal = function(promptId) {
    // 先尝试 word_card API
    var self = this;
    App.fetchJSON('/api/v4/word-cards/' + promptId).then(function(d) {
        if (d && d.card) {
            // 打开统一编辑器
            App.wordEditor.open({ cardId: promptId, source: 'cards' });
        } else {
            // 回退旧的 prompts API
            if (_origOpenEdit) _origOpenEdit.call(self, promptId);
        }
    }).catch(function() {
        if (_origOpenEdit) _origOpenEdit.call(self, promptId);
    });
};

// ============ Hook: 选取器卡片右键 → 编辑/删除 ============

// 在 word_picker 渲染卡片时注入编辑按钮
var _origRenderCards = App.wordPicker._renderCards;
App.wordPicker._renderCards = function(group) {
    _origRenderCards.call(this, group);

    // 为每张卡片注入编辑入口（双击编辑）
    var cards = document.querySelectorAll('.wc-picker-card');
    for (var i = 0; i < cards.length; i++) {
        if (cards[i]._editBound) continue;
        cards[i]._editBound = true;

        cards[i].addEventListener('dblclick', function(e) {
            var cid = parseInt(this.getAttribute('data-card-id'));
            if (cid) App.wordEditor.openFromPicker(cid);
        });
        cards[i].title = (cards[i].title || '') + App._t('auto.str_74d4e1a2', ' | 双击编辑');
    }
};

// ============ P0-2: AI 智能分组建议 ============

App.wordEditor._suggestGroup = async function() {
    var content = document.getElementById('wcEditContent').value.trim();
    var name = document.getElementById('wcEditName').value.trim();
    var meaning = document.getElementById('wcEditMeaning').value.trim();
    if (!content && !name) { App.showToast('请先输入词卡内容或名称', 'warning'); return; }
    
    // Phase19: 选择器适配双栏布局 — suggest 按钮在 .wc-edit-group-row 内
    var btn = document.querySelector('.wc-edit-group-row .ai-inline-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
    
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/suggest-group', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ content: content, name: name, meaning: meaning })
        });
        if (!d || !d.ok) { App.showToast('建议未完成', 'warning'); return; }
        
        var suggestions = d.suggestions || [];
        if (!suggestions.length) {
            App.showToast('未找到匹配分组，请手动选择', 'info');
            return;
        }
        
        // 自动选首推
        var top = suggestions[0];
        var sel = document.getElementById('wcEditGroup');
        if (sel) sel.value = top.group_id;
        
        // 显示所有建议
        var tip = '✅ 已选: ' + top.group_name + ' (' + (top.score*100).toFixed(0) + '% 匹配)';
        if (suggestions.length > 1) {
            tip += '\n其他建议: ' + suggestions.slice(1, 4).map(function(s) {
                return s.group_name + ' (' + (s.score*100).toFixed(0) + '%)';
            }).join(', ');
        }
        App.showToast(tip, top.confidence === 'high' ? 'success' : 'info');
    } catch(e) {
        App.showToast('建议未完成: ' + e.message, 'danger');
    }
    if (btn) { btn.disabled = false; btn.textContent = '🤖 建议分组'; }
};

// ============ P0-3: 版本历史 ============

App.wordEditor._cardId = null;

App.wordEditor._showVersions = async function() {
    var cid = this._cardId;
    if (!cid) { App.showToast('请先保存词卡', 'warning'); return; }
    
    var old = document.getElementById('wcVersionModal');
    if (old) old.remove();
    
    var overlay = document.createElement('div');
    overlay.id = 'wcVersionModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div class="modal-content" style="max-width:700px;width:90%;max-height:80vh;overflow-y:auto;background:var(--bg-card);border-radius:12px;padding:20px;" onclick="event.stopPropagation()">' +
        '<h5 style="margin:0 0 4px;">📜 版本历史</h5>' +
        '<p style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">词卡 #' + cid + ' | 加载中...</p>' +
        '<div id="wcVersionList" style="max-height:55vh;overflow-y:auto;"></div>' +
        '<div style="text-align:right;margin-top:12px;"><button class="btn btn-sm btn-secondary" onclick="document.getElementById(\'wcVersionModal\').remove()">关闭</button></div>' +
        '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    
    // 加载版本列表
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/' + cid + '/versions', { _timeoutMs: 8000 });
        if (!d || !d.versions) throw new Error('无版本数据');
        var list = document.getElementById('wcVersionList');
        var h = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">当前版本: v' + d.current_version + ' | 共 ' + d.total + ' 个快照</div>';
        h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
        h += '<tr style="border-bottom:1px solid var(--border-color);text-align:left;"><th style="padding:6px;">版本</th><th>编辑者</th><th>时间</th><th>操作</th></tr>';
        (d.versions || []).forEach(function(v) {
            var badge = v.is_current ? ' <span style="color:#22c55e;font-size:10px;">当前</span>' : '';
            h += '<tr style="border-bottom:1px solid var(--border-color);' + (v.is_current ? 'background:rgba(34,197,94,0.05);' : '') + '">';
            h += '<td style="padding:6px;">v' + v.version + badge + '</td>';
            h += '<td style="padding:6px;">' + (v.editor || 'manual') + '</td>';
            h += '<td style="padding:6px;font-size:10px;color:var(--text-muted);">' + ((v.created_at||'').substring(0,16)) + '</td>';
            h += '<td style="padding:6px;">';
            h += '<button class="btn btn-xs btn-outline" onclick="App.wordEditor._viewVersion(' + cid + ',' + v.id + ')" style="font-size:10px;">查看</button> ';
            h += '<button class="btn btn-xs btn-outline" onclick="App.wordEditor._rollback(' + cid + ',' + v.id + ')" style="font-size:10px;' + (v.is_current ? 'opacity:0.3;pointer-events:none;' : '') + '">回滚</button>';
            h += '</td></tr>';
        });
        h += '</table>';
        list.innerHTML = h;
    } catch(e) {
        var list = document.getElementById('wcVersionList');
        if (list) list.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center;">暂无版本历史<br><small>每次保存词卡后自动生成版本快照</small></div>';
    }
};

App.wordEditor._viewVersion = async function(cid, vid) {
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/' + cid + '/versions/' + vid, { _timeoutMs: 5000 });
        if (!d || !d.snapshot) { App.showToast('版本加载未完成', 'warning'); return; }
        var s = d.snapshot;
        var h = '<div style="font-size:12px;font-weight:600;margin-bottom:10px;">📋 版本 v' + s.version + '</div>';
        h += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">内容:</div>';
        h += '<textarea readonly style="width:100%;height:100px;font-size:12px;padding:8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-main);color:var(--text-main);resize:none;">' + App._escape(s.content || '') + '</textarea>';
        if (s.meaning) h += '<div style="margin-top:8px;font-size:11px;"><span style="color:var(--text-muted);">释义:</span> ' + App._escape(s.meaning) + '</div>';
        if (s.name) h += '<div style="font-size:11px;"><span style="color:var(--text-muted);">名称:</span> ' + App._escape(s.name) + '</div>';
        if (s.tags) {
            var tags = typeof s.tags === 'string' ? s.tags : (Array.isArray(s.tags) ? s.tags.join(', ') : '');
            if (tags) h += '<div style="font-size:11px;"><span style="color:var(--text-muted);">标签:</span> ' + App._escape(tags) + '</div>';
        }
        h += '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">分组: ' + App._escape(s.group_name || '未分类') + ' | 模块: ' + App._escape(s.module || '') + '</div>';
        h += '<div style="text-align:right;margin-top:10px;"><button class="btn btn-sm btn-primary" onclick="App.wordEditor._rollback(' + cid + ',' + vid + ')">↩ 回滚到此版本</button></div>';
        var list = document.getElementById('wcVersionList');
        if (list) list.innerHTML = h;
    } catch(e) { App.showToast('加载版本未完成: ' + e.message, 'danger'); }
};

App.wordEditor._rollback = async function(cid, vid) {
    if (!confirm('确定回滚到此版本？当前修改将被保存为历史版本。')) return;
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/' + cid + '/rollback', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ version_id: vid }),
            _timeoutMs: 8000
        });
        if (d && d.ok) {
            App.showToast('已回滚到 v' + d.rolled_to_version, 'success');
            this.close();
            // 通知刷新
            if (this._onSaved) this._onSaved();
            if (App.wordCards && App.wordCards.load) App.wordCards.load();
        }
    } catch(e) { App.showToast('回滚未完成: ' + e.message, 'danger'); }
};

// ============ 缩略图管理 (Phase17: 新建+编辑双模式) ============

// 临时缩略图状态（新建词卡尚未入库时暂存）
App.wordEditor._pendingThumbFile = null;   // File 对象（上传模式）
App.wordEditor._pendingThumbSource = null; // 图库源文件名（从图库选模式）
App.wordEditor._pendingThumbBlobUrl = null; // blob: URL 用于预览
// Phase16.3: 视频暂存状态
App.wordEditor._pendingVideoFile = null;   // File 对象（上传模式）
App.wordEditor._pendingVideoSource = null; // 视频库源文件名
App.wordEditor._pendingVideoBlobUrl = null; // blob: URL 用于预览

App.wordEditor._uploadThumb = async function(event) {
    var file = (event.target.files||[])[0];
    if (!file) { event.target.value = ''; return; }

    // 新建模式：暂存文件，用 blob URL 预览
    if (!this._cardId) {
        this._pendingThumbFile = file;
        this._pendingThumbSource = null;
        this._pendingThumbBlobUrl = URL.createObjectURL(file);
        this._refreshThumbPreview();
        App.showToast('已选择图片，保存词卡后自动上传', 'success');
        event.target.value = '';
        return;
    }

    // 编辑模式：直接上传
    var formData = new FormData();
    formData.append('file', file);
    try {
        var resp = await fetch('/api/v4/word-cards/' + this._cardId + '/thumbnail', { method: 'POST', body: formData });
        var d = await resp.json();
        if (d.ok) {
            App.showToast('缩略图上传成功', 'success');
            await this._loadCard();
            try { await App.loadPrompts(); } catch(e) {}
        } else {
            App.showToast('上传未完成: ' + (d.detail || d.error || 'unknown'), 'error');
        }
    } catch(e) { App.showToast('上传遇到问题: ' + e.message, 'error'); }
    event.target.value = '';
};

// Phase16.3: 视频上传 — 先传共享库再关联词卡
App.wordEditor._uploadVideo = async function(event) {
    var file = (event.target.files||[])[0];
    if (!file) { event.target.value = ''; return; }

    // 限制 50MB
    if (file.size > 50 * 1024 * 1024) {
        App.showToast('视频不能超过 50MB', 'error');
        event.target.value = '';
        return;
    }

    App.showToast('正在上传视频...', 'info');

    // 编辑模式（已有 cardId）：直接 POST /{card_id}/video 一步到位（含ffmpeg封面提取）
    if (this._cardId) {
        var formData2 = new FormData();
        formData2.append('file', file);
        try {
            var resp2 = await fetch('/api/v4/word-cards/' + this._cardId + '/video', { method: 'POST', body: formData2 });
            var d2 = await resp2.json();
            if (d2 && d2.ok) {
                App.showToast('视频已上传并关联到词卡', 'success');
                await this._loadCard();
                try { await App.loadPrompts(); } catch(e) {}
            } else {
                App.showToast('上传未完成: ' + ((d2 && (d2.detail || d2.error)) || '服务器错误'), 'error');
            }
        } catch(e) {
            App.showToast('上传遇到问题: ' + e.message, 'error');
        }
        event.target.value = '';
        return;
    }

    // 新建模式（无 cardId）：先上传到共享视频库暂存，保存后自动关联
    var formData = new FormData();
    formData.append('file', file);
    var videoFilename = null;
    try {
        var resp = await fetch('/api/thumbnails/upload-video', { method: 'POST', body: formData });
        var d = await resp.json();
        if (!d.ok) { throw new Error(d.detail || '上传到视频库未完成'); }
        videoFilename = d.video_filename;
    } catch(e) {
        App.showToast('上传到视频库未完成: ' + e.message, 'error');
        event.target.value = '';
        return;
    }

    // 新建模式：暂存 videoFilename，保存后自动关联
    if (this._pendingThumbBlobUrl && this._pendingThumbBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this._pendingThumbBlobUrl);
    }
    this._pendingThumbFile = null;
    this._pendingThumbSource = null;
    this._pendingThumbBlobUrl = null;

    this._pendingVideoFile = null;
    this._pendingVideoSource = videoFilename;
    this._pendingVideoBlobUrl = '/api/thumbnails/video/' + videoFilename;
    this._refreshThumbPreview();
    App.showToast('已选择视频，保存词卡后自动关联', 'success');
    event.target.value = '';
};

// Phase16.3: 打开视频库选取器
App.wordEditor._openVideoLibrary = function() {
    var self = this;
    App._onVideoSelected = async function(videoFilename) {
        App.showToast('正在设置预览视频...', 'info');

        // 新建模式：暂存源文件名，从视频库预览
        if (!self._cardId) {
            // 清除已有图片临时状态
            if (self._pendingThumbBlobUrl && self._pendingThumbBlobUrl.startsWith('blob:')) {
                URL.revokeObjectURL(self._pendingThumbBlobUrl);
            }
            self._pendingThumbFile = null;
            self._pendingThumbSource = null;
            self._pendingThumbBlobUrl = null;

            self._pendingVideoFile = null;
            self._pendingVideoSource = videoFilename;
            self._pendingVideoBlobUrl = '/api/thumbnails/video/' + videoFilename;
            self._refreshThumbPreview();
            App.showToast('已选择视频，保存词卡后自动关联', 'success');
            return;
        }

        // 编辑模式：直接调用 API
        var d = await App.fetchJSON('/api/v4/word-cards/' + self._cardId + '/video-from-library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_filename: videoFilename })
        });
        if (d && d.ok) {
            App.showToast('视频已设置', 'success');
            await self._loadCard();
            try { await App.loadPrompts(); } catch(e) {}
        } else {
            App.showToast('设置未完成: ' + ((d && d.detail) || '服务器错误'), 'error');
        }
    };
    App._openThumbnailModal('videos');
};

App.wordEditor._openThumbLibrary = function() {
    var self = this;
    // 图库选中后的回调
    App._onThumbnailSelected = async function(filename) {
        App.showToast('正在设置缩略图...', 'info');

        // 新建模式：暂存源文件名，从共享图库预览
        if (!self._cardId) {
            self._pendingThumbSource = filename;
            self._pendingThumbFile = null;
            // 用统一缩略图端点预览
            self._pendingThumbBlobUrl = '/api/thumbnails/file/' + filename;
            self._refreshThumbPreview();
            App.showToast('已选择缩略图，保存词卡后自动关联', 'success');
            return;
        }

        // 编辑模式：直接调用 API
        var d = await App.fetchJSON('/api/v4/word-cards/' + self._cardId + '/thumbnail-from-library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_filename: filename })
        });
        if (d && d.ok) {
            App.showToast('缩略图已设置', 'success');
            await self._loadCard();
            try { await App.loadPrompts(); } catch(e) {}
        } else {
            App.showToast('设置未完成: ' + ((d && d.detail) || '服务器错误'), 'error');
        }
    };
    // Phase16.3: 视频选择已迁移到 _openVideoLibrary，此处只保留图片选择
    App._onVideoSelected = null;
    App._openThumbnailModal('images');
};

App.wordEditor._clearThumb = async function() {
    // 新建模式：清除暂存（图片+视频）
    if (!this._cardId) {
        if (this._pendingThumbBlobUrl && this._pendingThumbBlobUrl.startsWith('blob:')) {
            URL.revokeObjectURL(this._pendingThumbBlobUrl);
        }
        if (this._pendingVideoBlobUrl && this._pendingVideoBlobUrl.startsWith('blob:')) {
            URL.revokeObjectURL(this._pendingVideoBlobUrl);
        }
        this._pendingThumbFile = null;
        this._pendingThumbSource = null;
        this._pendingThumbBlobUrl = null;
        this._pendingVideoFile = null;
        this._pendingVideoSource = null;
        this._pendingVideoBlobUrl = null;
        this._refreshThumbPreview();
        App.showToast('已清除待上传媒体', 'info');
        return;
    }

    // Phase17.4: 编辑模式 — 同时清除缩略图和视频（封面图+视频一起移除）
    if (!confirm(App._t('common.confirm', '确认清除此词卡的所有媒体（缩略图+视频）？'))) return;
    try {
        // 先获取当前卡片状态
        var cardResp = await App.fetchJSON('/api/v4/word-cards/' + this._cardId);
        var cardData = cardResp && cardResp.card;
        var hasThumb = cardData && cardData.thumbnail;
        var hasVideo = cardData && cardData.preview_media;

        // 并发清除缩略图 + 视频
        var results = await Promise.all([
            hasThumb ? App.fetchJSON('/api/v4/word-cards/' + this._cardId + '/thumbnail', { method: 'DELETE' }) : Promise.resolve({ok:true}),
            hasVideo  ? App.fetchJSON('/api/v4/word-cards/' + this._cardId + '/video', { method: 'DELETE' }) : Promise.resolve({ok:true})
        ]);

        if (results[0].ok || results[1].ok) {
            var msg = [];
            if (hasThumb) msg.push('缩略图');
            if (hasVideo) msg.push('视频');
            App.showToast((msg.join('+') || '媒体') + '已清除', 'info');
            await this._loadCard();
            try { await App.loadPrompts(); } catch(e) {}
        }
    } catch(e) { App.showToast('清除未完成: ' + e.message, 'error'); }
};

// 刷新缩略图预览区域（统一入口，兼容新建/编辑模式 + 图片/视频双模式）
App.wordEditor._refreshThumbPreview = function() {
    var area = document.getElementById('wcEditThumbPreviewArea');
    var thumbName = document.getElementById('wcEditThumbName');
    var clearBtn = document.getElementById('wcEditThumbClearBtn');

    // Phase16.3: 视频暂存优先（视频盖过图片）
    if (this._pendingVideoBlobUrl || this._pendingVideoFile || this._pendingVideoSource) {
        var videoSrc = this._pendingVideoBlobUrl
            ? this._pendingVideoBlobUrl
            : '/api/thumbnails/video/' + this._pendingVideoSource;
        var posterUrl = '';
        if (this._pendingVideoSource && (!this._pendingVideoBlobUrl || !this._pendingVideoBlobUrl.startsWith('blob:'))) {
            // 从视频库选择：封面路径为 /api/thumbnails/file/{base}.jpg
            var baseName = this._pendingVideoSource.replace(/\.[^.]+$/, '.jpg');
            posterUrl = '/api/thumbnails/file/' + baseName;
        }
        if (area) {
            area.innerHTML = '<video id="wcEditThumbPreview" src="' + videoSrc + '" muted loop playsinline preload="metadata" poster="' + posterUrl + '" style="width:100%;max-height:160px;border-radius:6px;object-fit:contain;" onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>';
        }
        if (thumbName) thumbName.textContent = '🎬 ' + (
            this._pendingVideoSource
                ? this._pendingVideoSource.substring(0, 25)
                : (this._pendingVideoFile ? this._pendingVideoFile.name.substring(0, 25) : '待上传视频')
        );
        if (clearBtn) clearBtn.style.display = 'inline-block';
    } else if (this._pendingThumbBlobUrl || this._pendingThumbFile || this._pendingThumbSource) {
        if (area) {
            area.innerHTML = '<img id="wcEditThumbPreview" src="' + (this._pendingThumbBlobUrl || '/api/thumbnails/file/' + this._pendingThumbSource) + '" style="width:100%;max-height:160px;border-radius:6px;object-fit:contain;">';
        }
        if (thumbName) thumbName.textContent = this._pendingThumbSource
            ? this._pendingThumbSource.substring(0, 25)
            : (this._pendingThumbFile ? this._pendingThumbFile.name.substring(0, 25) : '待上传');
        if (clearBtn) clearBtn.style.display = 'inline-block';
    } else if (!this._cardId) {
        if (area) area.innerHTML = '<span style="font-size:28px;color:var(--text-muted);">🖼</span>';
        if (thumbName) thumbName.textContent = '未设置';
        if (clearBtn) clearBtn.style.display = 'none';
    }
};

})();
