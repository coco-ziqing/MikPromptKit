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
    if (title) title.textContent = this._cardId ? '✏️ 编辑词卡' : '➕ 新建词卡';

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
    '<select id="wcEditGroup" class="modal-input" style="font-size:12px;margin-bottom:10px;"></select>' +

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

    // 缩略图预览 (Phase13.5)
    '<div id="wcEditThumbRow" style="display:none;margin-bottom:10px;gap:8px;align-items:center;">' +
    '<label style="font-size:11px;font-weight:600;color:var(--text-muted);">缩略图</label>' +
    '<div style="display:flex;gap:8px;align-items:center;">' +
    '<img id="wcEditThumbPreview" src="" style="width:60px;height:40px;border-radius:6px;object-fit:cover;border:1px solid var(--border-color);display:none;">' +
    '<span id="wcEditThumbName" style="font-size:10px;color:var(--text-muted);"></span>' +
    '</div></div>' +

    // 内置/自定义标记 (Phase13.5)
    '<div id="wcEditBuiltinRow" style="display:none;margin-bottom:10px;">' +
    '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--tag-bg);color:var(--primary);">🔒 内置词条 (部分字段不可编辑)</span>' +
    '</div>' +

    '</div>' +
    // Footer
    '<div style="padding:10px 18px;border-top:1px solid var(--border-color);display:flex;gap:6px;justify-content:flex-end;">' +
    '<button class="btn btn-danger btn-sm" id="wcEditDeleteBtn" onclick="App.wordEditor._delete()" style="margin-right:auto;display:none;">删除</button>' +
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
    var presetNames = {emotion:'人物表情',color:'场景色彩',tone:'画面色调',composition:'分镜构图',seedance:'视频模版'};
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
        var typeLabel = m.type === 'builtin' ? '内置' : '自定义';
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
    if (!name) { App.showToast('请输入模块名称', 'warning'); return; }

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
                description: '自定义模块: ' + name
            })
        });

        if (d && d.ok) {
            // 重新加载分组和模块列表
            await this._loadGroups();

            // 自动选中新模块
            var modSel = document.getElementById('wcEditModule');
            if (modSel) {
                modSel.value = key;
                // 触发同步
                this._onModuleChange();
            }

            // 关闭新模块输入框
            this._hideNewModule();
            App.showToast('模块 \'' + name + '\' 已创建并选中', 'success');
        } else {
            App.showToast('创建失败: ' + (d ? d.error || d.detail || '名称可能重复' : ''), 'error');
        }
    } catch(e) {
        App.showToast('创建出错: ' + e.message, 'error');
    }
};

App.wordEditor._loadCard = async function() {
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/' + this._cardId);
        if (!d || !d.card) { App.showToast('加载词卡失败', 'error'); return; }
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

        // 缩略图预览
        var thumbRow = document.getElementById('wcEditThumbRow');
        var thumbImg = document.getElementById('wcEditThumbPreview');
        var thumbName = document.getElementById('wcEditThumbName');
        if (c.thumbnail && thumbRow && thumbImg && thumbName) {
            thumbRow.style.display = 'flex';
            thumbImg.src = '/api/seedance/v2/thumbnails/' + c.thumbnail;
            thumbImg.style.display = 'inline-block';
            thumbName.textContent = c.thumbnail;
        } else if (c.preview_media && thumbRow && thumbImg && thumbName) {
            thumbRow.style.display = 'flex';
            thumbImg.style.display = 'none';
            thumbName.textContent = '🎬 ' + c.preview_media;
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
        App.showToast('加载失败: ' + e.message, 'error');
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
    var thumbRow = document.getElementById('wcEditThumbRow');
    if (thumbRow) thumbRow.style.display = 'none';
    var builtinRow = document.getElementById('wcEditBuiltinRow');
    if (builtinRow) builtinRow.style.display = 'none';
    document.getElementById('wcEditTags').value = '';
    var delBtn = document.getElementById('wcEditDeleteBtn');
    if (delBtn) delBtn.style.display = 'none';
    var src = document.getElementById('wcEditSource');
    if (src) src.textContent = '新建';
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
            this._cardId = newId;
            App.showToast(this._cardId ? '词卡已保存' : '词卡已创建', 'success');

            // 回调通知调用方刷新
            if (this._onSaved) {
                this._onSaved({ id: newId, ...data });
            }

            // 通知选取器刷新
            if (App.wordPicker && App.wordPicker._load) App.wordPicker._load();

            // 如果是从主界面编辑，刷新列表
            if (this._source === 'cards' && App.loadPrompts) {
                App.loadPrompts();
            }
        } else {
            App.showToast('保存失败: ' + (result ? result.error || '未知错误' : '网络错误'), 'error');
        }
    } catch(e) {
        App.showToast('保存出错: ' + e.message, 'error');
    }
};

App.wordEditor._delete = async function() {
    if (!this._cardId) return;
    if (!confirm('确认删除此词卡？内置词卡将软删除，自定义词卡将永久删除。')) return;

    try {
        var result = App.cardModel
            ? await App.cardModel.delete(this._cardId)
            : await App.fetchJSON('/api/v4/word-cards/' + this._cardId, { method: 'DELETE' });
        if (result && result.ok) {
            App.showToast('词卡已删除', 'success');
            this.close();

            if (this._onSaved) this._onSaved({ id: this._cardId, _deleted: true });
            if (App.wordPicker && App.wordPicker._load) App.wordPicker._load();
            if (this._source === 'cards' && App.loadPrompts) App.loadPrompts();
        }
    } catch(e) {
        App.showToast('删除失败: ' + e.message, 'error');
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
            App.showToast('AI 分析完成', 'success');
        } else {
            App.showToast('AI 分析失败: ' + (d ? d.error : ''), 'warning');
        }
    } catch(e) {
        App.showToast('AI 分析出错: ' + e.message, 'error');
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
        cards[i].title = (cards[i].title || '') + ' | 双击编辑';
    }
};

})();
