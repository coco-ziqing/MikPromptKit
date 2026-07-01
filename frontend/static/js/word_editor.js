// ============================================================
// v4.1.0: Unified Word Card Editor (多端编辑)
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

    // 更新标题
    var title = document.getElementById('wcEditTitle');
    if (title) title.textContent = this._cardId ? App._t('auto.str_78033f01', '✏️ 编辑词卡') : App._t('auto.str_3f8ea773', '➕ 新建词卡');

    // 加载分组列表
    await this._loadGroups();

    if (this._cardId) {
        await this._loadCard();
    } else {
        this._resetForm();
    }

    m.style.display = 'flex';
};

App.wordEditor.close = function() {
    var m = document.getElementById('modalWordEdit');
    if (m) m.style.display = 'none';
    this._cardId = null;
    // Phase17: 清理暂存缩略图
    if (this._pendingThumbBlobUrl && this._pendingThumbBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this._pendingThumbBlobUrl);
    }
    this._pendingThumbFile = null;
    this._pendingThumbSource = null;
    this._pendingThumbBlobUrl = null;
};

// ============ 构建弹窗 ============

App.wordEditor._ensureModal = function() {
    if (document.getElementById('modalWordEdit')) return;

    var overlay = document.createElement('div');
    overlay.id = 'modalWordEdit';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:none;z-index:550;';
    overlay.onclick = function(e) { if (e.target === overlay) App.wordEditor.close(); };

    overlay.innerHTML = '' +
    '<div class="modal-content" style="max-width:560px;width:95%;max-height:88vh;overflow-y:auto;border-radius:14px;padding:0;">' +
    // Header
    '<div style="padding:14px 18px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">' +
    '<h5 id="wcEditTitle" style="margin:0;font-size:15px;">✏️ 编辑词卡</h5>' +
    '<div style="display:flex;gap:6px;align-items:center;">' +
    '<span id="wcEditSource" style="font-size:10px;color:var(--text-muted);"></span>' +
    '<button style="background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer;" onclick="App.wordEditor.close()">&times;</button>' +
    '</div></div>' +
    // Body
    '<div style="padding:12px 18px;">' +
    // 分组选择
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">所属分组</label>' +
    '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
    '<select id="wcEditGroup" class="modal-input" style="font-size:12px;flex:1;"></select>' +
    '<button class="btn btn-xs ai-inline-btn" onclick="App.wordEditor._suggestGroup()" title="AI 智能推荐分组" style="flex-shrink:0;font-size:10px;padding:4px 8px;">🤖 建议分组</button>' +
    '</div>' +

    // 名称
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">词卡名称</label>' +
    '<input id="wcEditName" class="modal-input" placeholder="简短名称(选填,留空取内容前60字)" style="font-size:12px;margin-bottom:10px;">' +

    // 内容
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">核心内容 <span style="color:#ef4444;">*</span></label>' +
    '<textarea id="wcEditContent" class="modal-input" rows="3" placeholder="提示词片段 / 关键词 / 描述文本..." style="font-size:12px;margin-bottom:10px;"></textarea>' +

    // 释义
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">释义/说明</label>' +
    '<input id="wcEditMeaning" class="modal-input" placeholder="中文释义或补充说明" style="font-size:12px;margin-bottom:10px;">' +

    // 模块 + 分类 (一行)
    '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
    '<div style="flex:1;">' +
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">功能模块 <span style="font-size:9px;color:var(--primary);">(自动同步分组)</span></label>' +
    '<div style="display:flex;gap:4px;">' +
    '<select id="wcEditModule" class="modal-input" style="flex:1;font-size:12px;" onchange="App.wordEditor._onModuleChange()"></select>' +
    '<button class="btn btn-xs" onclick="App.wordEditor._showNewModuleInput()" title="新建自定义模块" style="font-size:11px;padding:4px 8px;border:1px dashed var(--border-color);border-radius:6px;background:transparent;color:var(--text-muted);cursor:pointer;white-space:nowrap;">+ 新模块</button>' +
    '</div>' +
    '<div id="wcNewModuleRow" style="display:none;margin-top:4px;display:none;gap:4px;">' +
    '<input id="wcNewModuleName" class="modal-input" placeholder="输入模块名称..." style="flex:1;font-size:11px;padding:4px 6px;">' +
    '<button class="btn btn-xs btn-primary" onclick="App.wordEditor._createModule()" style="font-size:10px;padding:3px 8px;">创建</button>' +
    '<button class="btn btn-xs" onclick="App.wordEditor._hideNewModule()" style="font-size:10px;padding:3px 8px;color:var(--text-muted);">取消</button>' +
    '</div></div>' +
    '<div style="flex:1;">' +
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">分类</label>' +
    '<input id="wcEditCategory" class="modal-input" placeholder="二级分类" style="font-size:12px;">' +
    '</div></div>' +

    // 标签 + AI按钮
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">标签</label>' +
    '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
    '<input id="wcEditTags" class="modal-input" placeholder="用逗号或空格分隔, 如: 自然 温暖 电影感" style="flex:1;font-size:12px;">' +
    '<button class="btn btn-xs ai-inline-btn" onclick="App.wordEditor._aiAnalyze()" style="flex-shrink:0;font-size:10px;padding:4px 8px;">🤖 AI分析</button>' +
    '</div>' +

    // 场景 (Phase13.5: 统一词卡要素)
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">适用场景</label>' +
    '<input id="wcEditScene" class="modal-input" placeholder="如: 特写镜头 / 广角风光 / 室内人像" style="font-size:12px;margin-bottom:10px;">' +

    // 排序 + 图标 + 热度
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<div style="flex:1;">' +
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">排序权重</label>' +
    '<input id="wcEditSort" type="number" class="modal-input" value="0" style="font-size:12px;width:80px;">' +
    '</div>' +
    '<div style="flex:1;">' +
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">图标</label>' +
    '<input id="wcEditIcon" class="modal-input" placeholder="emoji 图标" style="font-size:12px;max-width:80px;">' +
    '</div>' +
    '<div style="flex:1;">' +
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">热度 <span style="font-size:9px;">(0~1)</span></label>' +
    '<input id="wcEditHeat" type="range" min="0" max="1" step="0.1" value="0.5" style="width:100%;vertical-align:middle;" oninput="document.getElementById(\'wcEditHeatLabel\').textContent=this.value">' +
    '<span id="wcEditHeatLabel" style="font-size:10px;color:var(--text-muted);margin-left:4px;">0.5</span>' +
    '</div></div>' +

    // 缩略图上传/选择 (Phase16.2: 始终可见 + 按钮修复)
    '<div id="wcEditThumbRow" style="margin-bottom:10px;padding:8px;border-radius:8px;background:var(--hover-bg);">' +
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">缩略图预览</label>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
    '<img id="wcEditThumbPreview" src="" style="width:80px;height:53px;border-radius:6px;object-fit:cover;border:1px solid var(--border-color);display:none;background:var(--bg-card);">' +
    '<span id="wcEditThumbName" style="font-size:11px;color:var(--text-muted);min-width:60px;">未设置</span>' +
    '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
    '<input type="file" id="wcEditThumbInput" accept="image/*" style="display:none;" onchange="App.wordEditor._uploadThumb(event)">' +
    '<button type="button" class="btn btn-xs" onclick="document.getElementById(\'wcEditThumbInput\').click()" style="font-size:11px;padding:4px 10px;border:1px solid #6366f1;color:#6366f1;border-radius:6px;background:transparent;cursor:pointer;">📤 上传图片</button>' +
    '<button type="button" class="btn btn-xs" onclick="App.wordEditor._openThumbLibrary()" style="font-size:11px;padding:4px 10px;border:1px solid var(--border-color);color:var(--text-muted);border-radius:6px;background:transparent;cursor:pointer;">🖼 从图库选</button>' +
    '<button type="button" class="btn btn-xs" id="wcEditThumbClearBtn" onclick="App.wordEditor._clearThumb()" style="display:none;font-size:11px;padding:4px 10px;border:1px solid #ef4444;color:#ef4444;border-radius:6px;background:transparent;cursor:pointer;">✕ 清除</button>' +
    '</div></div></div>' +

    // 内置/自定义标记 (Phase13.5)
    '<div id="wcEditBuiltinRow" style="display:none;margin-bottom:10px;">' +
    '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--tag-bg);color:var(--primary);">🔒 内置词条 (部分字段不可编辑)</span>' +
    '</div>' +

    '</div>' +
    // Footer
    '<div style="padding:10px 18px;border-top:1px solid var(--border-color);display:flex;gap:6px;justify-content:flex-end;">' +
    '<button class="btn btn-danger btn-sm" id="wcEditDeleteBtn" onclick="App.wordEditor._delete()" style="margin-right:auto;display:none;">删除</button>' +
    '<button class="btn btn-outline btn-sm" onclick="App.wordEditor._showVersions()" style="font-size:11px;">📜 历史版本</button>' +
    '<button class="btn btn-secondary btn-sm" onclick="App.wordEditor.close()">取消</button>' +
    '<button class="btn btn-primary btn-sm" id="wcEditSaveBtn" onclick="App.wordEditor._save()">💾 保存</button>' +
    '</div></div>';

    document.body.appendChild(overlay);
};

// ============ 数据加载 ============

App.wordEditor._loadGroups = async function() {
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/groups?include_empty=true');
        this._groups = d.groups || [];

        // 填充分组下拉
        var sel = document.getElementById('wcEditGroup');
        if (sel) {
            sel.innerHTML = '<option value="">-- 无分组 --</option>';
            for (var i = 0; i < this._groups.length; i++) {
                var g = this._groups[i];
                sel.innerHTML += '<option value="' + g.id + '">' + (g.icon||'📄') + ' ' + App._escape(g.name) + ' [' + g.group_type + ']</option>';
            }
        }

        // 填充模块下拉（从groups提取builtin+custom类型 → 模块列表）
        this._buildModuleOptions();

    } catch(e) { /* silent */ }
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
            App.showToast('创建失败: ' + (d ? d.error || d.detail || App._t('auto.str_4cd13eba', '名称可能重复') : ''), 'error');
        }
    } catch(e) {
        App.showToast('创建出错: ' + e.message, 'error');
    }
};

App.wordEditor._loadCard = async function() {
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/' + this._cardId);
        if (!d || !d.card) { App.showToast(App._t('auto.load_词卡失败', '加载词卡失败'), 'error'); return; }
        var c = d.card;

        document.getElementById('wcEditGroup').value = c.group_id || '';
        document.getElementById('wcEditName').value = c.name || '';
        document.getElementById('wcEditContent').value = c.content || '';
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

        // 缩略图预览 (Phase16.1: 修复显示)
        var thumbRow = document.getElementById('wcEditThumbRow');
        var thumbImg = document.getElementById('wcEditThumbPreview');
        var thumbName = document.getElementById('wcEditThumbName');
        var clearBtn = document.getElementById('wcEditThumbClearBtn');
        if (c.thumbnail && thumbRow && thumbImg && thumbName) {
            thumbRow.style.display = 'block';
            thumbImg.src = '/api/v4/word-cards/thumbnails/' + c.thumbnail;
            thumbImg.style.display = 'inline-block';
            thumbName.textContent = c.thumbnail.substring(0, 20) + (c.thumbnail.length > 20 ? '...' : '');
            if (clearBtn) clearBtn.style.display = 'inline-block';
        } else if (c.preview_media && thumbRow && thumbImg && thumbName) {
            thumbRow.style.display = 'block';
            thumbImg.style.display = 'none';
            thumbName.textContent = '🎬 ' + c.preview_media.substring(0, 30);
            if (clearBtn) clearBtn.style.display = 'inline-block';
        } else if (thumbRow) {
            thumbRow.style.display = 'block';
            if (thumbImg) thumbImg.style.display = 'none';
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

        // 来源标记
        var src = document.getElementById('wcEditSource');
        if (src) {
            var gName = c.group_name || '';
            var info = [];
            if (gName) info.push(gName);
            if (c.source) info.push(c.source);
            if (c.usage_count > 0) info.push('×' + c.usage_count);
            src.textContent = info.join(' · ');
        }

    } catch(e) {
        App.showToast(App._t('common.load_failed', '加载失败: ') + e.message, 'error');
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
    // Phase17: 清理暂存缩略图
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
    var builtinRow = document.getElementById('wcEditBuiltinRow');
    if (builtinRow) builtinRow.style.display = 'none';
    document.getElementById('wcEditTags').value = '';
    var delBtn = document.getElementById('wcEditDeleteBtn');
    if (delBtn) delBtn.style.display = 'none';
    var src = document.getElementById('wcEditSource');
    if (src) src.textContent = App._t('common.new', '新建');
};

// ============ 保存/删除 ============

App.wordEditor._save = async function() {
    var content = document.getElementById('wcEditContent').value.trim();
    if (!content) { App.showToast('核心内容不能为空', 'warning'); return; }

    var data = {
        name: document.getElementById('wcEditName').value.trim(),
        content: content,
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
            this._cardId = newId;
            App.showToast(this._cardId ? App._t('auto.str_03f4d8a4', '词卡已保存') : App._t('auto.str_d2b555ae', '词卡已创建'), 'success');

            // Phase17: 新建词卡保存后，自动上传暂存的缩略图
            if (wasNew && (this._pendingThumbFile || this._pendingThumbSource)) {
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
                    await this._loadCard();  // 刷新预览为已上传状态
                } catch(e) { console.warn('[wordEditor] pending thumb upload failed:', e); }
            }

            // 回调通知调用方刷新
            if (this._onSaved) {
                this._onSaved({ id: newId, ...data });
            }

            // 通知选取器刷新
            if (App.wordPicker && App.wordPicker._load) App.wordPicker._load();

            // 刷新侧边栏模块计数（新建的模块从0→1）
            await App.loadModules();

            // 如果是从主界面编辑，刷新列表
            if (this._source === 'cards' && App.loadPrompts) {
                App.loadPrompts();
            } else if (App.wordCards && App.wordCards.load) {
                App.wordCards.load();
            }
        } else {
            App.showToast(App._t('common.save', '保存失败: ') + (result ? result.error || App._t('common.unknown_error', '未知错误') : App._t('common.net_error', '网络错误')), 'error');
        }
    } catch(e) {
        App.showToast(App._t('common.save', '保存出错: ') + e.message, 'error');
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
        App.showToast(App._t('common.delete', '删除失败: ') + e.message, 'error');
    }
};

// ============ AI 分析 ============

App.wordEditor._aiAnalyze = async function() {
    var content = document.getElementById('wcEditContent').value.trim();
    if (!content) { App.showToast('请先输入词卡内容', 'warning'); return; }

    var btn = document.querySelector('#wcEditTags + .ai-inline-btn');
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
            App.showToast(App._t('auto.str_7b9d7831', 'AI 分析失败: ') + (d ? d.error : ''), 'warning');
        }
    } catch(e) {
        App.showToast(App._t('auto.str_e82a1516', 'AI 分析出错: ') + e.message, 'error');
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
App.wordEditor.openCreate = function(groupId, source) {
    source = source || 'cards';
    this.open({ cardId: null, source: source });
    // 预设分组
    if (groupId) {
        setTimeout(function() {
            var el = document.getElementById('wcEditGroup');
            if (el) el.value = groupId;
        }, 100);
    }
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
    
    var btn = document.querySelector('#wcEditGroup + .ai-inline-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
    
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/suggest-group', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ content: content, name: name, meaning: meaning })
        });
        if (!d || !d.ok) { App.showToast('建议失败', 'warning'); return; }
        
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
        App.showToast('建议失败: ' + e.message, 'danger');
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
        if (!d || !d.snapshot) { App.showToast('版本加载失败', 'warning'); return; }
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
    } catch(e) { App.showToast('加载版本失败: ' + e.message, 'danger'); }
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
    } catch(e) { App.showToast('回滚失败: ' + e.message, 'danger'); }
};

// ============ 缩略图管理 (Phase17: 新建+编辑双模式) ============

// 临时缩略图状态（新建词卡尚未入库时暂存）
App.wordEditor._pendingThumbFile = null;   // File 对象（上传模式）
App.wordEditor._pendingThumbSource = null; // 图库源文件名（从图库选模式）
App.wordEditor._pendingThumbBlobUrl = null; // blob: URL 用于预览

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
            App.showToast('上传失败: ' + (d.detail || d.error || 'unknown'), 'error');
        }
    } catch(e) { App.showToast('上传出错: ' + e.message, 'error'); }
    event.target.value = '';
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
            App.showToast('设置失败: ' + ((d && d.detail) || '服务器错误'), 'error');
        }
    };
    App._onVideoSelected = async function(videoFilename) {
        App.showToast('正在设置视频...', 'info');
        if (!self._cardId) {
            App.showToast('新建词卡暂不支持视频，请先保存', 'warning');
            return;
        }
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
            App.showToast('设置失败: ' + ((d && d.detail) || '服务器错误'), 'error');
        }
    };
    App._openThumbnailModal('images');
};

App.wordEditor._clearThumb = async function() {
    // 新建模式：清除暂存
    if (!this._cardId) {
        this._pendingThumbFile = null;
        this._pendingThumbSource = null;
        if (this._pendingThumbBlobUrl && this._pendingThumbBlobUrl.startsWith('blob:')) {
            URL.revokeObjectURL(this._pendingThumbBlobUrl);
        }
        this._pendingThumbBlobUrl = null;
        this._refreshThumbPreview();
        App.showToast('已清除待上传缩略图', 'info');
        return;
    }

    // 编辑模式：调用 API
    if (!confirm(App._t('common.confirm', '确认清除此词卡的缩略图？'))) return;
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/' + this._cardId + '/thumbnail', { method: 'DELETE' });
        if (d && d.ok) {
            App.showToast('缩略图已清除', 'info');
            await this._loadCard();
            try { await App.loadPrompts(); } catch(e) {}
        }
    } catch(e) { App.showToast('清除失败: ' + e.message, 'error'); }
};

// 刷新缩略图预览区域（统一入口，兼容新建/编辑模式）
App.wordEditor._refreshThumbPreview = function() {
    var thumbImg = document.getElementById('wcEditThumbPreview');
    var thumbName = document.getElementById('wcEditThumbName');
    var clearBtn = document.getElementById('wcEditThumbClearBtn');

    if (this._pendingThumbBlobUrl || this._pendingThumbFile || this._pendingThumbSource) {
        if (thumbImg) {
            thumbImg.src = this._pendingThumbBlobUrl || '/api/thumbnails/file/' + this._pendingThumbSource;
            thumbImg.style.display = 'inline-block';
        }
        if (thumbName) thumbName.textContent = this._pendingThumbSource
            ? this._pendingThumbSource.substring(0, 25)
            : (this._pendingThumbFile ? this._pendingThumbFile.name.substring(0, 25) : '待上传');
        if (clearBtn) clearBtn.style.display = 'inline-block';
    } else if (!this._cardId) {
        // 新建模式无待上传 → 空状态
        if (thumbImg) thumbImg.style.display = 'none';
        if (thumbName) thumbName.textContent = '未设置';
        if (clearBtn) clearBtn.style.display = 'none';
    }
    // 编辑模式由 _loadCard 接管（不在此处处理）
};

})();
