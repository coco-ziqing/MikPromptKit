// ============================================================
// 2026-08-04: ComfyUI 工作流存储调用空间 — 前端面板 v2
// 工作流库 + 参数化前端（编辑模式选参 / 用户模式锁定表单）+ 运行状态
// ============================================================

(function() {
'use strict';

if (!window.App || !App.fetchJSON) { setTimeout(arguments.callee, 200); return; }

// 模型类型 → 常用分辨率预设（按长边基准）
var CWL_SIZE_PRESETS = {
    sd15:    { label: 'SD1.5', base: 512,  presets: [[512, 512], [768, 512], [512, 768], [640, 384], [384, 640], [832, 576], [576, 832]] },
    sdxl:    { label: 'SDXL',  base: 1024, presets: [[1024, 1024], [1152, 896], [896, 1152], [1216, 832], [832, 1216], [1344, 768], [768, 1344]] },
    flux:    { label: 'FLUX',  base: 1024, presets: [[1024, 1024], [1152, 896], [896, 1152], [1216, 832], [832, 1216], [1344, 768], [768, 1344], [1536, 640], [640, 1536]] },
    unknown: { label: '通用',  base: 768,  presets: [[512, 512], [768, 768], [1024, 1024], [1280, 720], [720, 1280], [1920, 1080], [1080, 1920]] }
};
var CWL_RATIOS = [
    { label: '1:1', w: 1, h: 1 }, { label: '4:3', w: 4, h: 3 }, { label: '3:2', w: 3, h: 2 },
    { label: '16:9', w: 16, h: 9 }, { label: '3:4', w: 3, h: 4 }, { label: '2:3', w: 2, h: 3 }, { label: '9:16', w: 9, h: 16 }
];

// 参数排序：角色优先（正面提示词 → 负面提示词 → 其他），再按使用习惯字段顺序
var CWL_PARAM_SORT = {
    width: 10, height: 11, batch_size: 12,
    seed: 20, noise_seed: 21,
    steps: 30, cfg: 31, guidance: 32, denoise: 33,
    sampler_name: 40, scheduler: 41,
    lora_name: 50, ckpt_name: 51, unet_name: 52, vae_name: 53, clip_name1: 54, clip_name2: 55,
    strength: 60, strength_model: 61,
    text: 70, prompt_text: 71
};
function CWL_cmpParams(a, b) {
    var ra = a.role === 'positive' ? 0 : (a.role === 'negative' ? 1 : 2);
    var rb = b.role === 'positive' ? 0 : (b.role === 'negative' ? 1 : 2);
    if (ra !== rb) return ra - rb;
    var oa = CWL_PARAM_SORT[a.field] !== undefined ? CWL_PARAM_SORT[a.field] : 100;
    var ob = CWL_PARAM_SORT[b.field] !== undefined ? CWL_PARAM_SORT[b.field] : 100;
    if (oa !== ob) return oa - ob;
    return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
}

App.comfyLib = {
    _wfList: [],
    _selectedWf: null,
    _candidates: [],
    _presets: [],
    _activePreset: null,
    _logs: [],
    _generating: false,
    _runtimeTimer: null,
    _selectedGroupId: 0,
    _collapsedGroups: {},
    _allGroups: [],
    _logs: [],
    _logViewMode: null,
};

// ============ 打开/关闭 ============

App.comfyLib.open = function() {
    var m = document.getElementById('modalComfyLib');
    if (!m) m = this._ensureModal();
    m.style.display = 'flex';
    this.loadList();
    this.loadLogs();
    this.loadTasks();
    this.refreshRuntime();
    if (this._runtimeTimer) clearInterval(this._runtimeTimer);
    var self = this;
    this._runtimeTimer = setInterval(function() {
        self.refreshRuntime();
        self.loadTasks();
    }, 5000);
};

App.comfyLib.close = function() {
    if (this._runtimeTimer) { clearInterval(this._runtimeTimer); this._runtimeTimer = null; }
    var m = document.getElementById('modalComfyLib');
    if (m) m.style.display = 'none';
};

// 从词卡调取工作流（右键菜单入口）
App.comfyLib.openFromCard = async function(cardId) {
    App.showToast('正在从词卡调取工作流...', 'info');
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/by-card/' + cardId);
        if (d && d.ok) {
            this.open();
            await this.loadList();
            this.selectWf(d.workflow_id);
            App.showToast('已调取工作流「' + (d.name || '') + '」', 'success');
        } else {
            App.showToast('词卡未关联工作流: ' + (d && d.error ? d.error : ''), 'warning');
        }
    } catch(e) {
        App.showToast('调取失败: ' + e.message, 'error');
    }
};

App.comfyLib._ensureModal = function() {
    var overlay = document.createElement('div');
    overlay.id = 'modalComfyLib';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:none;z-index:720;';
    overlay.onclick = function(e) { if (e.target === overlay) App.comfyLib.close(); };

    overlay.innerHTML =
    '<div class="modal-content modal-wide" onclick="event.stopPropagation()" style="max-width:1360px;width:96%;max-height:92vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
      '<div class="modal-header" style="padding:12px 18px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
        '<h5 style="margin:0;font-size:15px;"><i class="bi bi-magic"></i> 工作流库 <span style="font-size:11px;color:var(--text-muted);">ComfyUI 存储调用空间</span></h5>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<button class="header-btn-sm" onclick="App.comfyLib.close()">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="modal-body" style="flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:14px;">' +

        // ===== 运行状态 =====
        '<div id="cwlRuntime" style="border:1px solid var(--border-color);border-radius:10px;padding:10px 14px;font-size:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--hover-bg,#f8fafc);">' +
          '<span style="font-weight:600;"><i class="bi bi-activity"></i> ComfyUI 运行状态</span>' +
          '<span id="cwlRtRunning" style="color:#10b981;">● 执行中: <b>0</b></span>' +
          '<span id="cwlRtPending" style="color:#f59e0b;">◌ 排队中: <b>0</b></span>' +
          '<span id="cwlRtDetail" style="color:var(--text-muted);font-size:11px;"></span>' +
          '<span style="margin-left:auto;display:flex;gap:8px;align-items:center;">' +
            '<button class="btn btn-sm" onclick="App.comfyLib.syncFromComfy()" title="从 ComfyUI 队列/历史同步最新工作流" style="font-size:11px;padding:4px 12px;border:1px solid var(--primary);color:var(--primary);border-radius:8px;"><i class="bi bi-arrow-repeat"></i> 从 ComfyUI 同步</button>' +
            '<span style="font-size:11px;color:var(--text-muted);">5s 自动刷新</span>' +
          '</span>' +
        '</div>' +

        // ===== 工作流列表 =====
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
          '<div style="font-size:13px;font-weight:600;"><i class="bi bi-collection"></i> 工作流模板 <span id="cwlCount" style="font-size:11px;color:var(--text-muted);"></span></div>' +
          '<div style="display:flex;gap:6px;align-items:center;">' +
            '<select id="cwlSort" onchange="App.comfyLib.loadList()" title="排序方式" style="font-size:11px;padding:5px 6px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);outline:none;">' +
              '<option value="recent">最近使用</option>' +
              '<option value="usage">使用最多</option>' +
              '<option value="newest">最新导入</option>' +
              '<option value="name">名称排序</option>' +
              '<option value="nodes">节点最多</option>' +
            '</select>' +
            '<span style="position:relative;display:inline-flex;align-items:center;">' +
              '<i class="bi bi-search" style="position:absolute;left:9px;font-size:12px;color:var(--text-muted);pointer-events:none;"></i>' +
              '<input id="cwlSearch" placeholder="搜索工作流名称 / 提示词..." style="font-size:12px;padding:6px 10px 6px 27px;width:230px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);outline:none;transition:border-color .15s,box-shadow .15s;" onfocus="this.style.borderColor=\'#6366f1\';this.style.boxShadow=\'0 0 0 2px rgba(99,102,241,0.18)\'" onblur="this.style.borderColor=\'#94a3b8\';this.style.boxShadow=\'none\'" oninput="App.comfyLib.loadList()">' +
            '</span>' +
            '<button class="btn btn-sm" onclick="document.getElementById(\'cwlPngFile\').click()" title="导入 ComfyUI 生成的 PNG（自动提取自带工作流）" style="font-size:11px;padding:5px 12px;border:1px solid #6366f1;color:#6366f1;border-radius:8px;"><i class="bi bi-upload"></i> 导入 PNG</button>' +
            '<button class="btn btn-sm" onclick="document.getElementById(\'cwlJsonFile\').click()" title="导入工作流 JSON 文件（API/UI 格式均可）" style="font-size:11px;padding:5px 12px;border:1px solid #0ea5e9;color:#0ea5e9;border-radius:8px;"><i class="bi bi-file-code"></i> 导入 JSON</button>' +
            '<input type="file" id="cwlPngFile" accept=".png,image/png" style="display:none;" onchange="App.comfyLib.importPng(this)">' +
            '<input type="file" id="cwlJsonFile" accept=".json,application/json" style="display:none;" onchange="App.comfyLib.importJson(this)">' +
          '</div>' +
        '</div>' +
        '<div id="cwlGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">' +
          '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted);font-size:12px;">加载中...</div>' +
        '</div>' +

        // ===== 生成区（含参数配置） =====
        '<div id="cwlGenPanel" style="border:1px solid var(--border-color);border-radius:10px;padding:12px 14px;display:none;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">' +
            '<span style="font-size:13px;font-weight:600;"><i class="bi bi-stars"></i> 生成</span>' +
            '<span id="cwlGenWfName" style="font-size:12px;color:var(--primary);"></span>' +
            '<span style="margin-left:auto;display:flex;gap:6px;">' +
              '<button class="btn btn-sm" onclick="App.comfyLib.openRewrite()" title="重写模板的提示词与参数（保存到库中）" style="font-size:11px;padding:3px 10px;border:1px solid #10b981;color:#10b981;"><i class="bi bi-pencil-square"></i> 重写</button>' +
              '<button class="btn btn-sm" onclick="App.comfyLib.resetWorkflow()" title="清零：清空提示词与种子，保留模板结构" style="font-size:11px;padding:3px 10px;border:1px solid #f59e0b;color:#f59e0b;"><i class="bi bi-eraser"></i> 清零</button>' +
              '<button class="btn btn-sm" id="cwlBtnEditParams" onclick="App.comfyLib.openParamEditor()" title="编辑模式：自主选择暴露哪些参数、命名、设置组件类型" style="font-size:11px;padding:3px 10px;border:1px solid #8b5cf6;color:#8b5cf6;"><i class="bi bi-sliders"></i> 参数配置</button>' +
            '</span>' +
          '</div>' +
          '<div id="cwlPresetBar" style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;"></div>' +
          '<div id="cwlParamForm"></div>' +
          '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-primary btn-sm" id="cwlBtnGen" onclick="App.comfyLib.generate()"><i class="bi bi-magic"></i> 生成图片</button>' +
            '<span id="cwlGenStatus" style="font-size:11px;color:var(--text-muted);"></span>' +
          '</div>' +
          '<div id="cwlGenResult" style="margin-top:10px;display:none;">' +
            '<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;">' +
              '<div style="flex-shrink:0;"><img id="cwlResultImg" style="max-width:280px;border-radius:10px;border:1px solid var(--border-color);display:block;background:#0f172a;"></div>' +
              '<div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px;">' +
                '<div style="font-size:11px;color:var(--text-muted);">结果已存 <code>data/comfyui_outputs/</code>（PNG 自带工作流元数据，可再次导入复用）</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                  '<button class="btn btn-sm" style="font-size:11px;padding:4px 12px;border:1px solid var(--primary);color:var(--primary);" onclick="App.comfyLib.saveAsCard()"><i class="bi bi-bookmark-plus"></i> 存为词卡</button>' +
                  '<a id="cwlDownload" class="btn btn-sm" style="font-size:11px;padding:4px 12px;border:1px solid var(--border-color);text-decoration:none;color:var(--text-main);" download><i class="bi bi-download"></i> 下载原图</a>' +
                  '<button class="btn btn-sm" style="font-size:11px;padding:4px 12px;" onclick="App.comfyLib.importResultAsWf()"><i class="bi bi-collection-plus"></i> 存为模板</button>' +
                '</div>' +
                '<div id="cwlSaveCardResult" style="font-size:11px;color:var(--text-muted);"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ===== 生成任务（队列监督） =====
        '<div style="border-top:1px solid var(--border-color);padding-top:10px;margin-bottom:12px;">' +
          '<div style="font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px;"><i class="bi bi-list-task"></i> 生成任务 <span style="font-size:11px;color:var(--text-muted);">队列自动串行 · 防大批量卡死</span>' +
            '<span style="margin-left:auto;"><button class="cwl-tree-btn" onclick="App.comfyLib.loadTasks()" title="刷新任务列表"><i class="bi bi-arrow-repeat"></i> 刷新</button></span>' +
          '</div>' +
          '<div id="cwlTasks" style="font-size:11px;color:var(--text-muted);">加载中...</div>' +
        '</div>' +

        // ===== 生成历史 =====
        '<div style="border-top:1px solid var(--border-color);padding-top:10px;">' +
          '<div style="font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px;"><i class="bi bi-clock-history"></i> 生成历史 <span style="font-size:11px;color:var(--text-muted);">最近 20 条</span>' +
            '<span style="margin-left:auto;display:flex;gap:2px;border:1px solid var(--border-color);border-radius:8px;padding:2px;">' +
              '<button id="cwlLogViewGrid" class="cwl-logview-btn" onclick="App.comfyLib.setLogView(\'grid\')" title="网格预览模式（图片优先）"><i class="bi bi-grid-3x3-gap"></i> 预览</button>' +
              '<button id="cwlLogViewList" class="cwl-logview-btn" onclick="App.comfyLib.setLogView(\'list\')" title="详情列表模式（信息优先）"><i class="bi bi-list-ul"></i> 详情</button>' +
            '</span>' +
          '</div>' +
          '<div id="cwlLogs" style="font-size:11px;color:var(--text-muted);">加载中...</div>' +
        '</div>' +

      '</div>' +
    '</div>';

    document.body.appendChild(overlay);
    return overlay;
};

// ============ 运行状态 ============

App.comfyLib.refreshRuntime = async function() {
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/runtime');
        if (!d || !d.ok) {
            var el = document.getElementById('cwlRtDetail');
            if (el) el.textContent = d && d.error ? ('⚠ ' + d.error) : '';
            return;
        }
        var r = document.getElementById('cwlRtRunning');
        var p = document.getElementById('cwlRtPending');
        var det = document.getElementById('cwlRtDetail');
        if (r) r.innerHTML = '● 执行中: <b>' + d.running_count + '</b>';
        if (p) p.innerHTML = '◌ 排队中: <b>' + d.pending_count + '</b>';
        if (det) {
            var parts = [];
            d.running.forEach(function(x) { parts.push('执行 ' + x.prompt_id.slice(0, 8) + '…'); });
            d.pending.forEach(function(x) { parts.push('排队 ' + x.prompt_id.slice(0, 8) + '…'); });
            det.textContent = parts.join('  ') || '';
        }
    } catch(e) { /* 忽略 */ }
};

// ============ 工作流列表 ============

App.comfyLib.loadList = async function() {
    var grid = document.getElementById('cwlGrid');
    if (!grid) return;
    var search = (document.getElementById('cwlSearch') || {}).value || '';
    var sort = (document.getElementById('cwlSort') || {}).value || 'recent';
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows?search=' + encodeURIComponent(search) + '&sort=' + encodeURIComponent(sort));
        if (!d || !d.items) throw new Error('获取失败');
        this._wfList = d.items;
        var cnt = document.getElementById('cwlCount');
        if (cnt) cnt.textContent = '(' + d.items.length + ')';
        this._renderList();
    } catch(e) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#ef4444;font-size:12px;">❌ ' + App._escape(e.message) + '</div>';
    }
};

App.comfyLib._renderList = function() {
    var grid = document.getElementById('cwlGrid');
    if (!grid) return;
    if (this._wfList.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted);font-size:12px;">' +
          '暂无工作流。<br>① 点击「导入 PNG」上传 ComfyUI 生成的图片（自动提取自带工作流）<br>② 或「从 ComfyUI 同步」获取当前运行的工作流</div>';
        return;
    }
    var html = '';
    var self = this;
    this._wfList.forEach(function(w) {
        var srcMap = { png_import: 'PNG导入', comfyui_sync: 'Comfy同步', manual: '手动', generate: '生成' };
        var src = srcMap[w.source] || w.source || '手动';
        var cover = w.thumbnail ? '/api/thumbnails/file/' + w.thumbnail
                  : (w.source === 'png_import' && w.source_file ? '/api/v2/comfyui/outputs/' + w.source_file : '');
        var isSel = self._selectedWf && self._selectedWf.id === w.id;
        var tip = (w.name || '') + (w.description ? '\n' + w.description : '') + (w.prompt_text ? '\n\n📝 ' + w.prompt_text : '');
        html += '<div class="cwl-card" onclick="App.comfyLib.selectWf(\'' + App._escape(w.id) + '\')" title="' + App._escape(tip) + '" ' +
          'style="border:1px solid ' + (isSel ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:10px;overflow:hidden;cursor:pointer;background:var(--bg-card);position:relative;">' +
          '<div style="height:84px;background:linear-gradient(135deg,#1e293b,#334155);display:flex;align-items:center;justify-content:center;position:relative;">' +
            (cover ? '<img src="' + cover + '" style="width:100%;height:100%;object-fit:cover;">' : '<span style="font-size:26px;opacity:0.5;">🎨</span>') +
            '<span style="position:absolute;top:6px;right:6px;font-size:9px;padding:2px 7px;border-radius:8px;background:rgba(0,0,0,0.55);color:#e2e8f0;">' + src + '</span>' +
            (w.is_favorite ? '<span style="position:absolute;top:6px;left:6px;font-size:11px;">⭐</span>' : '') +
          '</div>' +
          '<div style="padding:8px 10px;">' +
            '<div style="display:flex;align-items:center;gap:4px;">' +
              '<div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;" title="' + App._escape(w.name || '') + '">' + App._escape(w.name || '未命名') + '</div>' +
              '<span onclick="event.stopPropagation();App.comfyLib.renameWorkflow(\'' + App._escape(w.id) + '\')" title="重命名" style="font-size:12px;cursor:pointer;opacity:0.65;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.65">✎</span>' +
              '<span onclick="event.stopPropagation();App.comfyLib.duplicateWorkflow(\'' + App._escape(w.id) + '\')" title="复制模板" style="font-size:12px;cursor:pointer;opacity:0.65;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.65">⧉</span>' +
              '<span onclick="event.stopPropagation();App.comfyLib.toggleFavorite(\'' + App._escape(w.id) + '\')" title="' + (w.is_favorite ? '取消收藏' : '收藏') + '" style="font-size:13px;cursor:pointer;opacity:0.75;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.75">' + (w.is_favorite ? '⭐' : '☆') + '</span>' +
              '<span onclick="event.stopPropagation();App.comfyLib.deleteWorkflow(\'' + App._escape(w.id) + '\')" title="删除模板" style="font-size:12px;cursor:pointer;opacity:0.65;color:#ef4444;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.65">🗑</span>' +
            '</div>' +
            '<div style="font-size:10px;color:var(--text-muted);margin-top:3px;display:flex;justify-content:space-between;">' +
              '<span>' + (w.node_count || 0) + ' 节点</span><span>使用 ' + (w.usage_count || 0) + ' 次</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    grid.innerHTML = html;
};

// 重命名模板
App.comfyLib.renameWorkflow = async function(wfId) {
    var wf = null;
    for (var i = 0; i < this._wfList.length; i++) {
        if (this._wfList[i].id === wfId) { wf = this._wfList[i]; break; }
    }
    if (!wf) return;
    var name = prompt('重命名工作流模板：', wf.name || '');
    if (name === null) return;
    name = name.trim();
    if (!name) { App.showToast('名称不能为空', 'warning'); return; }
    try {
        await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        App.showToast('已重命名为「' + name + '」', 'success');
        this.loadList();
    } catch(e) {
        App.showToast('重命名失败: ' + e.message, 'error');
    }
};

// 复制模板
App.comfyLib.duplicateWorkflow = async function(wfId) {
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId) + '/duplicate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (d && d.ok) {
            App.showToast('已复制为「' + (d.workflow_id || '') + '」', 'success');
            this.loadList();
        } else {
            App.showToast('复制失败: ' + (d && d.error ? d.error : '未知'), 'error');
        }
    } catch(e) {
        App.showToast('复制失败: ' + e.message, 'error');
    }
};

// JSON 文件导入（ComfyUI 导出的 API 格式或 UI 格式）
App.comfyLib.importJson = async function(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    var self = this;
    reader.onload = async function(e) {
        try {
            var wf = JSON.parse(e.target.result);
            if (!wf || typeof wf !== 'object') throw new Error('无效的 JSON');
            var isApi = Object.keys(wf).some(function(k) { return wf[k] && wf[k].class_type; });
            var name = prompt('命名此工作流模板：', file.name.replace(/\.json$/i, ''));
            if (name === null) { input.value = ''; return; }
            name = (name || '').trim() || '导入模板';
            var body = { name: name, description: (isApi ? 'API 格式 JSON 导入' : 'UI 格式 JSON 导入（自动转换）') };
            if (isApi) {
                body.workflow_json = wf;
            } else {
                // UI 格式：先取 object_info 转换（复用后端转换器）
                body.workflow_json = wf;
                body.ui_json = JSON.stringify(wf);
                body.prompt_text = '';
            }
            var d = await App.fetchJSON('/api/v2/comfyui/workflows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (d && d.ok) {
                App.showToast('✅ 已导入「' + name + '」', 'success');
                input.value = '';
                self.loadList();
                self.selectWf(d.workflow_id);
            } else {
                App.showToast('导入失败: ' + (d && d.error ? d.error : '未知'), 'error');
                input.value = '';
            }
        } catch(err) {
            App.showToast('JSON 解析失败: ' + err.message, 'error');
            input.value = '';
        }
    };
    reader.readAsText(file);
};

// 收藏/取消收藏
App.comfyLib.toggleFavorite = async function(wfId) {
    var wf = null;
    for (var i = 0; i < this._wfList.length; i++) {
        if (this._wfList[i].id === wfId) { wf = this._wfList[i]; break; }
    }
    var next = wf && wf.is_favorite ? 0 : 1;
    try {
        await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_favorite: next })
        });
        App.showToast(next ? '⭐ 已收藏' : '已取消收藏', 'success');
        this.loadList();
    } catch(e) {
        App.showToast('操作失败: ' + e.message, 'error');
    }
};

// 删除工作流模板（二次确认）
App.comfyLib.deleteWorkflow = async function(wfId) {
    var wf = null;
    for (var i = 0; i < this._wfList.length; i++) {
        if (this._wfList[i].id === wfId) { wf = this._wfList[i]; break; }
    }
    var name = (wf && wf.name) || '该模板';
    if (!confirm('确定删除工作流模板「' + name + '」？\n删除后不可恢复（关联的生成记录与词卡不受影响）。')) return;
    try {
        await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId), { method: 'DELETE' });
        App.showToast('已删除「' + name + '」', 'success');
        if (this._selectedWf && this._selectedWf.id === wfId) {
            this._selectedWf = null;
            this._activePreset = null;
            var panel = document.getElementById('cwlGenPanel');
            if (panel) panel.style.display = 'none';
            var form = document.getElementById('cwlParamForm');
            if (form) form.innerHTML = '';
        }
        this.loadList();
    } catch(e) {
        App.showToast('删除失败: ' + e.message, 'error');
    }
};

App.comfyLib.selectWf = async function(id) {
    var wf = null;
    for (var i = 0; i < this._wfList.length; i++) {
        if (this._wfList[i].id === id) { wf = this._wfList[i]; break; }
    }
    if (!wf) {
        try {
            var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(id));
            wf = d.workflow;
        } catch(e) { return; }
    }
    this._selectedWf = wf;
    this._renderList();
    var panel = document.getElementById('cwlGenPanel');
    if (panel) panel.style.display = 'block';
    var nameEl = document.getElementById('cwlGenWfName');
    if (nameEl) nameEl.textContent = '「' + (wf.name || '未命名') + '」' + (wf.node_count ? ' · ' + wf.node_count + ' 节点' : '');
    var result = document.getElementById('cwlGenResult');
    if (result) result.style.display = 'none';
    // 加载参数分析 + 配置
    await this._loadParams(id);
};

// ============ 清零 / 重写工作流 ============

App.comfyLib.resetWorkflow = async function() {
    if (!this._selectedWf) { App.showToast('请先选择工作流模板', 'warning'); return; }
    if (!confirm('清零模板「' + (this._selectedWf.name || '') + '」？\n将清空所有提示词并把种子归零（模板结构与节点连接保留）。')) return;
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(this._selectedWf.id) + '/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (d && d.ok) {
            App.showToast('✅ 已清零：' + d.cleared_text + ' 处提示词、' + d.cleared_seed + ' 处种子', 'success');
            await this.loadList();
            var promptEl = document.getElementById('cwlPrompt');
            if (promptEl) promptEl.value = '';
        } else {
            App.showToast('清零失败: ' + (d && d.error ? d.error : ''), 'error');
        }
    } catch(e) {
        App.showToast('清零失败: ' + e.message, 'error');
    }
};

// 重写弹窗：编辑模板的提示词与参数，保存到库
App.comfyLib.openRewrite = async function() {
    if (!this._selectedWf) { App.showToast('请先选择工作流模板', 'warning'); return; }
    var overlay = document.getElementById('cwlRewrite');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cwlRewrite';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:none;z-index:740;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };
        overlay.innerHTML =
        '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:680px;max-height:86vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
          '<div class="modal-header" style="padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
            '<h5 style="margin:0;font-size:14px;"><i class="bi bi-pencil-square"></i> 重写工作流 <span id="cwlRwName" style="font-size:11px;color:var(--text-muted);"></span></h5>' +
            '<button class="header-btn-sm" onclick="document.getElementById(\'cwlRewrite\').style.display=\'none\'">&times;</button>' +
          '</div>' +
          '<div class="modal-body" id="cwlRwBody" style="flex:1;overflow-y:auto;padding:12px 16px;">加载中...</div>' +
          '<div class="modal-footer" style="padding:10px 16px;border-top:1px solid var(--border-color);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;">' +
            '<span style="margin-right:auto;font-size:11px;color:var(--text-muted);">保存后更新库中模板默认值</span>' +
            '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'cwlRewrite\').style.display=\'none\'">取消</button>' +
            '<button class="btn btn-primary btn-sm" onclick="App.comfyLib.saveRewrite()"><i class="bi bi-check"></i> 保存重写</button>' +
          '</div>' +
        '</div>';
        document.body.appendChild(overlay);
    }
    document.getElementById('cwlRwName').textContent = '「' + (this._selectedWf.name || '') + '」';
    overlay.style.display = 'flex';
    var bodyEl = document.getElementById('cwlRwBody');
    bodyEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">分析工作流参数...</div>';
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(this._selectedWf.id) + '/params/analyze');
        if (!d || !d.ok) throw new Error(d && d.error || '分析失败');
        this._candidates = d.candidates || [];
        this._renderRewriteForm();
    } catch(e) {
        bodyEl.innerHTML = '<div style="color:#ef4444;font-size:12px;">' + App._escape(e.message) + '</div>';
    }
};

App.comfyLib._renderRewriteForm = function() {
    var bodyEl = document.getElementById('cwlRwBody');
    if (!bodyEl) return;
    var self = this;
    var pos = null, neg = null;
    var params = [];
    this._candidates.forEach(function(c) {
        if (c.role === 'positive') { pos = c; return; }
        if (c.role === 'negative') { neg = c; return; }
        if (c.class_type === 'CLIPTextEncode' && c.field === 'text') {
            if (!pos) { pos = c; return; }
            if (!neg) { neg = c; return; }
        }
        params.push(c);
    });
    var html = '';
    // 提示词区
    html += '<div style="margin-bottom:10px;"><label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">📝 正面提示词 (positive)</label>' +
      '<textarea id="cwlRwPos" rows="3" style="width:100%;font-size:12px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape(pos ? String(pos.value) : '') + '</textarea></div>';
    if (neg) {
        html += '<div style="margin-bottom:10px;"><label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">🚫 负面提示词 (negative)</label>' +
          '<textarea id="cwlRwNeg" rows="2" style="width:100%;font-size:12px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape(String(neg.value || '')) + '</textarea></div>';
    }
    // 参数区
    html += '<div style="margin:12px 0 6px;font-size:12px;font-weight:600;">⚙️ 模板参数</div>';
    if (params.length === 0) {
        html += '<div style="font-size:11px;color:var(--text-muted);">无其他可调参数</div>';
    } else {
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;">';
        params.forEach(function(c) {
            var key = c.key;
            var val = c.value;
            html += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:7px 9px;">' +
              '<div style="font-size:11px;font-weight:600;margin-bottom:3px;">' + App._escape(c.label) + ' <code style="font-size:9px;color:var(--text-muted);font-weight:400;">' + App._escape(key) + '</code></div>';
            if (c.type === 'slider') {
                html += '<input type="number" class="cwl-rw-p" data-key="' + App._escape(key) + '" value="' + App._escape(String(val)) + '" style="width:100%;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);">';
            } else if (c.type === 'checkbox') {
                html += '<input type="checkbox" class="cwl-rw-p" data-key="' + App._escape(key) + '" ' + (val ? 'checked' : '') + ' style="width:16px;height:16px;">';
            } else {
                html += '<input type="text" class="cwl-rw-p" data-key="' + App._escape(key) + '" value="' + App._escape(String(val === undefined ? '' : val)) + '" style="width:100%;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);">';
            }
            html += '</div>';
        });
        html += '</div>';
    }
    bodyEl.innerHTML = html;
};

App.comfyLib.saveRewrite = async function() {
    if (!this._selectedWf) return;
    var promptText = (document.getElementById('cwlRwPos') || {}).value || '';
    var negEl = document.getElementById('cwlRwNeg');
    var negativeText = negEl ? negEl.value : '';
    var params = {};
    var els = document.querySelectorAll('.cwl-rw-p');
    for (var i = 0; i < els.length; i++) {
        var key = els[i].getAttribute('data-key');
        var v = els[i].value;
        if (els[i].type === 'checkbox') v = els[i].checked;
        else if (els[i].type === 'number') v = parseFloat(v);
        params[key] = v;
    }
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(this._selectedWf.id) + '/rewrite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_text: promptText, negative_text: negativeText, params: params })
        });
        if (d && d.ok) {
            App.showToast('✅ 已重写模板（' + d.applied + ' 项参数 + 提示词）', 'success');
            document.getElementById('cwlRewrite').style.display = 'none';
            await this.loadList();
            this.selectWf(this._selectedWf.id);
        } else {
            App.showToast('重写失败: ' + (d && d.error ? d.error : ''), 'error');
        }
    } catch(e) {
        App.showToast('重写失败: ' + e.message, 'error');
    }
};

// ============ 参数系统 ============

App.comfyLib._loadParams = async function(wfId) {
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId) + '/params/analyze');
        if (!d || !d.ok) throw new Error(d && d.error || '分析失败');
        this._candidates = d.candidates || [];
        this._presets = d.presets || [];
        this._modelType = d.model_type || 'unknown';
        this._renderPresetBar();
        // 默认选中第一个 user 模式配置
        var userPreset = null;
        for (var i = 0; i < this._presets.length; i++) {
            if (this._presets[i].mode === 'user') { userPreset = this._presets[i]; break; }
        }
        this._activePreset = userPreset || null;
        this._renderParamForm();
    } catch(e) {
        var form = document.getElementById('cwlParamForm');
        if (form) form.innerHTML = '<div style="font-size:11px;color:#ef4444;">参数分析失败: ' + App._escape(e.message) + '</div>';
    }
};

App.comfyLib._renderPresetBar = function() {
    var bar = document.getElementById('cwlPresetBar');
    if (!bar) return;
    if (this._presets.length === 0) {
        bar.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">尚未配置参数模块 — 点击「参数配置」在编辑模式中自主选择要暴露的调节参数</span>';
        return;
    }
    var html = '<span style="font-size:11px;color:var(--text-muted);">参数模块:</span>';
    var self = this;
    this._presets.forEach(function(p) {
        var isAct = self._activePreset && self._activePreset.id === p.id;
        var isEdit = p.mode === 'editor';
        html += '<span onclick="App.comfyLib.activatePreset(' + p.id + ')" style="cursor:pointer;font-size:11px;padding:3px 10px;border-radius:14px;border:1px solid ' + (isAct ? 'var(--primary)' : 'var(--border-color)') + ';color:' + (isAct ? 'var(--primary)' : 'var(--text-main)') + ';background:' + (isAct ? 'rgba(99,102,241,0.08)' : 'transparent') + ';">' +
          App._escape(p.name || '参数配置') + (isEdit ? ' <span style="color:#8b5cf6;">(编辑中)</span>' : ' <span style="color:#10b981;">🔒</span>') +
          (isAct ? ' <span onclick="event.stopPropagation();App.comfyLib.deletePreset(' + p.id + ')" title="删除" style="color:#ef4444;">✕</span>' : '') +
        '</span>';
    });
    bar.innerHTML = html;
};

App.comfyLib.activatePreset = function(pid) {
    for (var i = 0; i < this._presets.length; i++) {
        if (this._presets[i].id === pid) { this._activePreset = this._presets[i]; break; }
    }
    this._renderPresetBar();
    this._renderParamForm();
};

App.comfyLib.deletePreset = async function(pid) {
    if (!confirm('删除该参数配置？')) return;
    try {
        await App.fetchJSON('/api/v2/comfyui/presets/' + pid, { method: 'DELETE' });
        this._activePreset = null;
        this._loadParams(this._selectedWf.id);
    } catch(e) { App.showToast('删除失败: ' + e.message, 'error'); }
};

// 渲染用户模式参数表单
App.comfyLib._renderParamForm = function() {
    var form = document.getElementById('cwlParamForm');
    if (!form) return;
    var preset = this._activePreset;
    if (!preset) {
        // 无配置：简单提示词框
        form.innerHTML =
          '<label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">提示词</label>' +
          '<textarea id="cwlPrompt" rows="2" placeholder="输入提示词..." style="width:100%;font-size:12px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape((this._selectedWf && this._selectedWf.prompt_text) || '') + '</textarea>';
        return;
    }
    var params = [];
    try { params = JSON.parse(preset.params_json || '[]'); } catch(e) {}
    if (params.length === 0) {
        form.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">该配置未包含任何参数</div>';
        return;
    }
    var html = '';
    // 模型文件参数存在时：顶部显示「刷新模型列表」工具条
    var hasFileParam = false;
    params.forEach(function(p) {
        if (p && p.type === 'select_file' && (p.options || []).length > 0) hasFileParam = true;
    });
    if (hasFileParam) {
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<span style="font-size:10px;color:var(--text-muted);"><i class="bi bi-box-seam"></i> 模型文件自动同步 ComfyUI</span>' +
          '<span style="margin-left:auto;"><button type="button" class="cwl-tree-btn" onclick="App.comfyLib._refreshModelOptions()" title="强制从 ComfyUI 拉取最新模型列表（新上传模型后点击）"><i class="bi bi-arrow-repeat"></i> 刷新模型列表</button></span>' +
        '</div>';
    }
    // 尺寸快捷：表单含 width + height 滑块时提供横竖/比例/分辨率一键设置
    var self = this;
    var FILE_FIELDS = ['ckpt_name', 'lora_name', 'unet_name', 'vae_name', 'clip_name1', 'clip_name2'];
    // 旧数据兜底：带 options 的参数按字段语义修正为下拉/文件下拉（不受旧 type 影响）
    params.forEach(function(p) {
        if (!p || typeof p !== 'object') return;
        if ((p.options || []).length > 0) {
            p.type = (FILE_FIELDS.indexOf(p.field) > -1) ? 'select_file' : 'select';
        }
    });
    // 参数排序：正面提示词 → 负面提示词 → 常用参数（尺寸/种子/步数/CFG/采样器/调度器/模型/强度）
    params.sort(CWL_cmpParams);
    var wP = null, hP = null;
    params.forEach(function(p) {
        if (p.field === 'width' && p.type === 'slider') wP = p;
        if (p.field === 'height' && p.type === 'slider') hP = p;
    });
    if (wP && hP) {
        var mt = CWL_SIZE_PRESETS[this._modelType] || CWL_SIZE_PRESETS.unknown;
        var base = mt.base;
        var sb = '<div style="border:1px dashed var(--border-color);border-radius:8px;padding:8px 10px;margin-bottom:10px;">' +
          '<div style="font-size:11px;font-weight:600;margin-bottom:6px;">📐 尺寸快捷 <span style="font-weight:400;color:var(--text-muted);font-size:10px;">' + App._escape(mt.label) + ' · 长边 ' + base + 'px</span></div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
            '<button type="button" class="cwl-tree-btn" onclick="App.comfyLib._formSetSize(1,1)" style="border-color:#6366f1;color:var(--primary);">□ 方形</button>' +
            '<button type="button" class="cwl-tree-btn" onclick="App.comfyLib._formSetSize(4,3)" style="border-color:#6366f1;color:var(--primary);">▭ 横屏</button>' +
            '<button type="button" class="cwl-tree-btn" onclick="App.comfyLib._formSetSize(3,4)" style="border-color:#6366f1;color:var(--primary);">▯ 竖屏</button>' +
          '</div>' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">';
        CWL_RATIOS.forEach(function(r) {
            sb += '<button type="button" class="cwl-tree-btn" onclick="App.comfyLib._formSetSize(' + r.w + ',' + r.h + ')">' + r.label + '</button>';
        });
        sb += '</div><div style="display:flex;gap:4px;flex-wrap:wrap;">';
        mt.presets.forEach(function(sz) {
            sb += '<button type="button" class="cwl-tree-btn" onclick="App.comfyLib._formSetSize(' + sz[0] + ',' + sz[1] + ',true)">' + sz[0] + '×' + sz[1] + '</button>';
        });
        sb += '</div></div>';
        html += sb;
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:10px;">';
    params.forEach(function(p) {
        html += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px;">' +
                '<label style="font-size:11px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape((p.label || p.key) + ' (' + p.key + ')') + '">' + App._escape(p.label || p.key) +
                  ' <span style="font-size:9px;color:var(--text-muted);font-weight:400;">(' + App._escape(p.key) + ')</span>' +
                '</label>' +
                '<span id="pv_' + App._escape(p.key) + '" style="font-size:11px;color:var(--primary);font-family:monospace;flex-shrink:0;">' + App._escape(String(p.default === undefined ? '' : p.default)) + '</span>' +
                '</div>';
        var val = p.default;
        if (p.type === 'slider') {
            var min = (p.min === undefined ? 0 : p.min), max = (p.max === undefined ? 100 : p.max), step = (p.step === undefined ? 1 : p.step);
            html += '<div style="display:flex;align-items:center;gap:6px;">' +
              '<input type="range" class="cwl-pv" data-key="' + App._escape(p.key) + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" style="flex:1;" oninput="App.comfyLib._pvSliderSync(this)">' +
              '<input type="number" class="cwl-pv-num" data-key="' + App._escape(p.key) + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" style="width:64px;font-size:11px;padding:3px 5px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);" onchange="App.comfyLib._pvNumSync(this)" title="可手动输入数值">' +
            '</div>';
        } else if (p.type === 'checkbox') {
            html += '<input type="checkbox" class="cwl-pv" data-key="' + App._escape(p.key) + '" ' + (val ? 'checked' : '') + ' style="width:18px;height:18px;">';
        } else if (p.type === 'number') {
            // 数字输入（大整数 seed 等，不适合滑块）
            html += '<input type="number" class="cwl-pv" data-key="' + App._escape(p.key) + '" value="' + App._escape(String(val === undefined ? '' : val)) + '" step="any" style="width:100%;font-size:12px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">';
        } else if (p.type === 'select' || (p.options || []).length > 0) {
            // 枚举下拉（采样器/调度器等；带 options 的参数一律下拉，即使旧数据 type 为 text/number）
            var opts = p.options || [];
            if (opts.length === 0) opts = [String(val === undefined ? '' : val)];
            html += '<select class="cwl-pv" data-key="' + App._escape(p.key) + '" data-field="' + App._escape(p.field || '') + '" style="width:100%;font-size:12px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">';
            opts.forEach(function(o) {
                html += '<option value="' + App._escape(o) + '"' + (String(val) === String(o) ? ' selected' : '') + '>' + App._escape(o) + '</option>';
            });
            html += '</select>';
        } else if (p.type === 'select_file') {
            // 模型文件：有可用选项时渲染下拉，无选项（ComfyUI 不可达）时回退文本框手输
            var fopts = p.options || [];
            if (fopts.length > 0) {
                html += '<select class="cwl-pv" data-key="' + App._escape(p.key) + '" data-field="' + App._escape(p.field || '') + '" style="width:100%;font-size:12px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">';
                fopts.forEach(function(o) {
                    html += '<option value="' + App._escape(o) + '"' + (String(val) === String(o) ? ' selected' : '') + '>' + App._escape(o) + '</option>';
                });
                html += '</select>';
            } else {
                html += '<input type="text" class="cwl-pv" data-key="' + App._escape(p.key) + '" value="' + App._escape(String(val)) + '" style="width:100%;font-size:11px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);" title="模型文件名">';
            }
        } else {
            html += '<textarea class="cwl-pv" data-key="' + App._escape(p.key) + '" rows="' + (p.key.indexOf('.text') > -1 ? 2 : 1) + '" style="width:100%;font-size:11px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape(String(val === undefined ? '' : val)) + '</textarea>';
        }
        html += '</div>';
    });
    html += '</div>';
    form.innerHTML = html;
    // 自动同步模型列表（用缓存，不强制；新模型通过手动刷新按钮获取）
    if (hasFileParam) this._applyModelOptions(false);
};

// 应用模型选项到表单下拉（force=true 强制刷新 ComfyUI object_info 缓存）
App.comfyLib._applyModelOptions = async function(force) {
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/model-options?refresh=' + (force ? 1 : 0));
        if (!d || !d.ok || !d.models) return false;
        var models = d.models;
        document.querySelectorAll('#cwlParamForm select.cwl-pv[data-field]').forEach(function(sel) {
            var field = sel.getAttribute('data-field');
            var opts = models[field] || [];
            if (!opts.length) return;
            var cur = sel.value;
            var h = '';
            opts.forEach(function(o) {
                h += '<option value="' + App._escape(o) + '"' + (String(cur) === String(o) ? ' selected' : '') + '>' + App._escape(o) + '</option>';
            });
            // 当前选中值不在新列表时追加保留（避免切换丢失）
            if (cur && opts.indexOf(cur) === -1) {
                h += '<option value="' + App._escape(cur) + '" selected>' + App._escape(cur) + '</option>';
            }
            sel.innerHTML = h;
        });
        return true;
    } catch(e) {
        return false;
    }
};

// 手动刷新模型列表（强制从 ComfyUI 拉取）
App.comfyLib._refreshModelOptions = async function() {
    App.showToast('正在从 ComfyUI 刷新模型列表...', 'info');
    var ok = await this._applyModelOptions(true);
    App.showToast(ok ? '✅ 模型列表已刷新' : '刷新失败（ComfyUI 不可达？）', ok ? 'success' : 'error');
};

// 滑块 → 数字输入框 + 显示值同步
App.comfyLib._pvSliderSync = function(input) {
    var key = input.getAttribute('data-key');
    var num = document.querySelector('.cwl-pv-num[data-key="' + key + '"]');
    if (num) num.value = input.value;
    var span = document.getElementById('pv_' + key);
    if (span) span.textContent = input.value;
};

// 数字输入框 → 滑块同步（手动输入，自动收敛到 min/max）
App.comfyLib._pvNumSync = function(input) {
    var key = input.getAttribute('data-key');
    var rng = document.querySelector('.cwl-pv[data-key="' + key + '"]');
    if (rng) {
        var v = parseFloat(input.value);
        if (isNaN(v)) { input.value = rng.value; return; }
        var mn = parseFloat(rng.min), mx = parseFloat(rng.max);
        if (!isNaN(mn) && !isNaN(mx)) v = Math.max(mn, Math.min(mx, v));
        input.value = v;
        rng.value = v;
    }
    var span = document.getElementById('pv_' + key);
    if (span) span.textContent = input.value;
};

// 表单尺寸快捷：设置 width/height 参数（absolute=true 直接使用该分辨率，否则按比例换算长边）
App.comfyLib._formSetSize = function(rw, rh, absolute) {
    var w, h;
    if (absolute) { w = rw; h = rh; }
    else {
        var mt = CWL_SIZE_PRESETS[this._modelType] || CWL_SIZE_PRESETS.unknown;
        var base = mt.base;
        if (rw >= rh) { w = base; h = Math.round(base * rh / rw); }
        else { h = base; w = Math.round(base * rw / rh); }
        var snap = function(n) { return Math.max(64, Math.round(n / 8) * 8); };
        w = snap(w); h = snap(h);
    }
    var keys = [];
    var params = [];
    try { params = JSON.parse((this._activePreset || {}).params_json || '[]'); } catch(e) {}
    params.forEach(function(p) {
        if (p.field === 'width') keys.push(['width', w]);
        if (p.field === 'height') keys.push(['height', h]);
    });
    keys.forEach(function(k) {
        var rng = document.querySelector('.cwl-pv[data-key$=".' + k[0] + '"]');
        var num = document.querySelector('.cwl-pv-num[data-key$=".' + k[0] + '"]');
        if (rng) rng.value = k[1];
        if (num) num.value = k[1];
        var span = document.getElementById('pv_' + rng.getAttribute('data-key'));
        if (span) span.textContent = k[1];
    });
    App.showToast('已设置尺寸 ' + w + '×' + h, 'success');
};

// ============ 参数配置编辑器（编辑模式） ============

App.comfyLib.openParamEditor = function() {
    var self = this;
    var overlay = document.getElementById('cwlParamEditor');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cwlParamEditor';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:none;z-index:740;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };
        overlay.innerHTML =
        '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:920px;max-height:86vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
          '<div class="modal-header" style="padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
            '<h5 style="margin:0;font-size:14px;"><i class="bi bi-sliders"></i> 参数配置 <span style="font-size:11px;color:var(--text-muted);">编辑模式 — 自主选择暴露参数</span></h5>' +
            '<button class="header-btn-sm" onclick="document.getElementById(\'cwlParamEditor\').style.display=\'none\'">&times;</button>' +
          '</div>' +
          '<div class="modal-body" style="flex:1;overflow-y:auto;padding:12px 16px;">' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">系统已自动分析当前工作流的可调参数（' + '，勾选要暴露的项，自定义名称与组件类型，保存后切换为锁定用户模式</div>' +
            '<div style="margin-bottom:10px;"><label style="font-size:11px;color:var(--text-muted);">配置名称</label><input id="cpeName" placeholder="如：基础出图参数" style="width:100%;font-size:12px;padding:6px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-main);margin-top:4px;"></div>' +
            '<div id="cpeSizeHelper"></div>' +
            '<div id="cpeList" style="display:flex;flex-direction:column;gap:8px;">加载中...</div>' +
          '</div>' +
          '<div class="modal-footer" style="padding:10px 16px;border-top:1px solid var(--border-color);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;">' +
            '<span style="margin-right:auto;font-size:11px;color:var(--text-muted);" id="cpeHint">🔒 保存后锁定为用户模式，仅显示所选参数</span>' +
            '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'cwlParamEditor\').style.display=\'none\'">取消</button>' +
            '<button class="btn btn-primary btn-sm" onclick="App.comfyLib.savePreset()"><i class="bi bi-lock"></i> 保存并锁定</button>' +
          '</div>' +
        '</div>';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    var nameInput = document.getElementById('cpeName');
    if (nameInput) nameInput.value = this._activePreset ? this._activePreset.name : ('「' + (this._selectedWf && this._selectedWf.name || '') + '」参数');
    var listEl = document.getElementById('cpeList');
    if (!listEl) return;
    if (this._candidates.length === 0) {
        listEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">未分析到可调参数（工作流可能没有数值/文本输入节点）</div>';
        return;
    }
    // 编辑已有配置时回填选中
    var selected = {};
    if (this._activePreset) {
        try { JSON.parse(this._activePreset.params_json || '[]').forEach(function(p) { selected[p.key] = p; }); } catch(e) {}
    }
    // 尺寸助手：按模型类型智能匹配宽高（横竖/比例/分辨率预设）
    this._cpeRenderSizeHelper();
    // 候选参数按使用习惯排序（正面→负面→常用参数），不改变原数组引用
    var cands = this._candidates.slice().sort(CWL_cmpParams);
    var html = '';
    cands.forEach(function(c) {
        var isSel = !!selected[c.key];
        var sp = selected[c.key] || {};
        var label = sp.label || c.label || c.key;
        var type = sp.type || c.type;
        var min = sp.min === undefined ? (typeof c.value === 'number' && c.value >= 0 && c.value <= 100 ? (c.value <= 2 ? 0 : Math.max(0, Math.floor(c.value / 2))) : 0) : sp.min;
        var max = sp.max === undefined ? (typeof c.value === 'number' ? Math.max(100, Math.ceil(c.value * 2)) : 100) : sp.max;
        var step = sp.step === undefined ? (typeof c.value === 'number' && !Number.isInteger(c.value) ? 0.1 : 1) : sp.step;
        html += '<div class="cpe-row" style="border:1px solid ' + (isSel ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:8px;padding:8px 10px;">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<input type="checkbox" class="cpe-sel" data-key="' + App._escape(c.key) + '" ' + (isSel ? 'checked' : '') + ' onchange="App.comfyLib._toggleCandidate(this)" style="width:16px;height:16px;">' +
            '<span style="font-size:12px;font-weight:600;flex:1;display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;">' +
              '<span class="cpe-title" data-key="' + App._escape(c.key) + '">' + App._escape(label) + '</span>' +
              '<span style="font-size:9px;color:var(--text-muted);font-weight:400;border:1px solid var(--border-color);border-radius:4px;padding:0 5px;white-space:nowrap;" title="原始节点字段名（节点.字段）">原始 ' + App._escape(c.key) + '</span>' +
            '</span>' +
            '<span onclick="App.comfyLib.renameCandidate(\'' + App._escape(c.key) + '\')" title="重命名此参数（勾选并编辑名称）" style="font-size:13px;cursor:pointer;opacity:0.7;color:#8b5cf6;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.7">✎</span>' +
            '<code style="font-size:10px;color:var(--text-muted);">' + App._escape(c.key) + ' = ' + App._escape(String(c.value)) + '</code>' +
          '</div>' +
          '<div class="cpe-detail" style="display:' + (isSel ? 'flex' : 'none') + ';gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">' +
            '<label style="font-size:10px;color:var(--text-muted);">名称 <input type="text" class="cpe-label" data-key="' + App._escape(c.key) + '" value="' + App._escape(label) + '" oninput="App.comfyLib._cpeLabelSync(this)" style="width:120px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);" title="自定义名称，保存后参数模块以此显示"></label>' +
            '<label style="font-size:10px;color:var(--text-muted);">组件 <select class="cpe-type" data-key="' + App._escape(c.key) + '" style="font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);">' +
              '<option value="slider" ' + (type === 'slider' ? 'selected' : '') + '>滑块</option>' +
              '<option value="text" ' + (type === 'text' ? 'selected' : '') + '>文本框</option>' +
              '<option value="checkbox" ' + (type === 'checkbox' ? 'selected' : '') + '>开关</option>' +
              '<option value="number" ' + (type === 'number' ? 'selected' : '') + '>数字输入</option>' +
              '<option value="select" ' + (type === 'select' ? 'selected' : '') + '>下拉选择</option>' +
              '<option value="select_file" ' + (type === 'select_file' ? 'selected' : '') + '>文件选择</option>' +
            '</select></label>' +
            '<label style="font-size:10px;color:var(--text-muted);">范围 <input type="number" class="cpe-min" data-key="' + App._escape(c.key) + '" value="' + min + '" style="width:56px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);"> ~ <input type="number" class="cpe-max" data-key="' + App._escape(c.key) + '" value="' + max + '" style="width:56px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);"> 步长 <input type="number" class="cpe-step" data-key="' + App._escape(c.key) + '" value="' + step + '" style="width:56px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);"></label>' +
          '</div>' +
        '</div>';
    });
    listEl.innerHTML = html;
};

// 编辑器尺寸助手：模型类型徽标 + 横竖切换 + 常用比例 + 分辨率预设
App.comfyLib._cpeRenderSizeHelper = function() {
    var helper = document.getElementById('cpeSizeHelper');
    if (!helper) return;
    var wC = null, hC = null;
    this._candidates.forEach(function(c) { if (c.field === 'width') wC = c; if (c.field === 'height') hC = c; });
    if (!wC || !hC) { helper.style.display = 'none'; return; }
    var mt = CWL_SIZE_PRESETS[this._modelType] || CWL_SIZE_PRESETS.unknown;
    var html = '<div style="border:1px dashed #6366f1;border-radius:8px;padding:8px 10px;margin-bottom:10px;">' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">📐 尺寸助手 <span style="font-weight:400;font-size:10px;color:var(--text-muted);">按模型智能匹配</span>' +
        '<span id="cpeModelBadge" style="font-size:9px;padding:2px 7px;border-radius:8px;background:rgba(99,102,241,0.12);color:var(--primary);font-weight:600;">' + App._escape(mt.label) + '</span>' +
        '<span id="cpeSizeVal" style="font-size:10px;color:var(--text-muted);font-weight:400;">当前 ' + (wC.value || '?') + '×' + (hC.value || '?') + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
        '<button type="button" class="cwl-tree-btn" style="border-color:#6366f1;color:var(--primary);" onclick="App.comfyLib._cpeSetSize(1,1)">□ 方形</button>' +
        '<button type="button" class="cwl-tree-btn" style="border-color:#6366f1;color:var(--primary);" onclick="App.comfyLib._cpeSetSize(4,3)">▭ 横屏</button>' +
        '<button type="button" class="cwl-tree-btn" style="border-color:#6366f1;color:var(--primary);" onclick="App.comfyLib._cpeSetSize(3,4)">▯ 竖屏</button>' +
      '</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">';
    CWL_RATIOS.forEach(function(r) {
        html += '<button type="button" class="cwl-tree-btn" onclick="App.comfyLib._cpeSetSize(' + r.w + ',' + r.h + ')">' + r.label + '</button>';
    });
    html += '</div><div style="display:flex;gap:4px;flex-wrap:wrap;">';
    mt.presets.forEach(function(sz) {
        html += '<button type="button" class="cwl-tree-btn" onclick="App.comfyLib._cpeSetSize(' + sz[0] + ',' + sz[1] + ',true)">' + sz[0] + '×' + sz[1] + '</button>';
    });
    html += '</div></div>';
    helper.innerHTML = html;
    helper.style.display = 'block';
};

// 编辑器尺寸助手：应用尺寸（absolute=true 直接使用；否则按比例以模型长边为基准换算，8 对齐）
App.comfyLib._cpeSetSize = function(rw, rh, absolute) {
    var w, h;
    if (absolute) { w = rw; h = rh; }
    else {
        var mt = CWL_SIZE_PRESETS[this._modelType] || CWL_SIZE_PRESETS.unknown;
        var base = mt.base;
        if (rw >= rh) { w = base; h = Math.round(base * rh / rw); }
        else { h = base; w = Math.round(base * rw / rh); }
        var snap = function(n) { return Math.max(64, Math.round(n / 8) * 8); };
        w = snap(w); h = snap(h);
    }
    var self = this;
    // 更新候选 value（保存时作为默认值）
    this._candidates.forEach(function(c) {
        if (c.field === 'width') c.value = w;
        if (c.field === 'height') c.value = h;
    });
    // 自动勾选 width/height
    ['width', 'height'].forEach(function(f) {
        var key = null;
        self._candidates.forEach(function(c) { if (c.field === f) key = c.key; });
        if (!key) return;
        var cb = document.querySelector('.cpe-sel[data-key="' + key + '"]');
        if (cb && !cb.checked) { cb.checked = true; self._toggleCandidate(cb); }
    });
    // 更新候选行 code 显示
    this._candidates.forEach(function(c) {
        if (c.field !== 'width' && c.field !== 'height') return;
        var cb = document.querySelector('.cpe-sel[data-key="' + c.key + '"]');
        var row = cb ? cb.closest('.cpe-row') : null;
        if (row) {
            var codeEl = row.querySelector('code');
            if (codeEl) codeEl.textContent = c.key + ' = ' + c.value;
        }
    });
    var valEl = document.getElementById('cpeSizeVal');
    if (valEl) valEl.textContent = '当前 ' + w + '×' + h;
};

App.comfyLib._toggleCandidate = function(cb) {
    // 用 .cpe-row 定位候选行（closest('div') 会命中标题行，找不到详情区）
    var row = cb.closest('.cpe-row');
    var detail = row ? row.querySelector('.cpe-detail') : null;
    if (detail) detail.style.display = cb.checked ? 'flex' : 'none';
    if (cb.checked) {
        // 勾选后自动聚焦名称输入框，方便直接重命名
        var key = cb.getAttribute('data-key');
        var labelInput = document.querySelector('.cpe-label[data-key="' + key + '"]');
        if (labelInput) {
            setTimeout(function() { labelInput.focus(); labelInput.select(); }, 50);
        }
    }
};

// 名称输入实时同步候选行标题（自定义名 ↔ 原始名对照）
App.comfyLib._cpeLabelSync = function(input) {
    var key = input.getAttribute('data-key');
    var title = document.querySelector('.cpe-title[data-key="' + key + '"]');
    if (title) title.textContent = input.value || '(未命名)';
};

// 参数重命名入口：一键勾选 + 展开 + 聚焦名称输入框
App.comfyLib.renameCandidate = function(key) {
    var cb = document.querySelector('.cpe-sel[data-key="' + key + '"]');
    if (cb) {
        if (!cb.checked) {
            cb.checked = true;
            this._toggleCandidate(cb);
        }
        var labelInput = document.querySelector('.cpe-label[data-key="' + key + '"]');
        if (labelInput) {
            labelInput.focus();
            labelInput.select();
        }
        var row = cb.closest('.cpe-row');
        var detail = row ? row.querySelector('.cpe-detail') : null;
        if (detail) {
            detail.style.borderColor = '#8b5cf6';
            setTimeout(function() { detail.style.borderColor = ''; }, 1200);
        }
    }
};

App.comfyLib.savePreset = async function() {
    if (!this._selectedWf) return;
    var params = [];
    var cbs = document.querySelectorAll('.cpe-sel');
    var self = this;
    cbs.forEach(function(cb) {
        if (!cb.checked) return;
        var key = cb.getAttribute('data-key');
        var cand = null;
        for (var i = 0; i < self._candidates.length; i++) {
            if (self._candidates[i].key === key) { cand = self._candidates[i]; break; }
        }
        if (!cand) return;
        var p = {
            key: key, node_id: cand.node_id, field: cand.field,
            label: (document.querySelector('.cpe-label[data-key="' + key + '"]') || {}).value || cand.label,
            // 枚举字段（带 options）强制下拉/文件下拉，避免旧配置回填 text/number/slider
            type: (((cand.options || []).length > 0) && cand.type !== 'select_file') ? 'select' : ((document.querySelector('.cpe-type[data-key="' + key + '"]') || {}).value || cand.type || 'text'),
            default: cand.value,
            min: parseFloat((document.querySelector('.cpe-min[data-key="' + key + '"]') || {}).value) || 0,
            max: parseFloat((document.querySelector('.cpe-max[data-key="' + key + '"]') || {}).value) || 100,
            step: parseFloat((document.querySelector('.cpe-step[data-key="' + key + '"]') || {}).value) || 1,
            options: cand.options || [],
        };
        params.push(p);
    });
    if (params.length === 0) { App.showToast('请至少勾选一个参数', 'warning'); return; }
    var name = (document.getElementById('cpeName') || {}).value || '参数配置';
    var body = { name: name, params: params, mode: 'user' };
    try {
        if (this._activePreset) {
            await App.fetchJSON('/api/v2/comfyui/presets/' + this._activePreset.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        } else {
            var d = await App.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(this._selectedWf.id) + '/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (d && d.ok) this._activePreset = { id: d.preset_id, name: name, params_json: JSON.stringify(params), mode: 'user' };
        }
        document.getElementById('cwlParamEditor').style.display = 'none';
        App.showToast('✅ 已保存并锁定为用户模式', 'success');
        this._loadParams(this._selectedWf.id);
    } catch(e) {
        App.showToast('保存失败: ' + e.message, 'error');
    }
};

// ============ 生成 ============

App.comfyLib._collectParamValues = function() {
    var values = {};
    var els = document.querySelectorAll('.cwl-pv');
    for (var i = 0; i < els.length; i++) {
        var key = els[i].getAttribute('data-key');
        var v = els[i].value;
        if (els[i].type === 'checkbox') v = els[i].checked;
        else if (els[i].type === 'range' || els[i].type === 'number') v = parseFloat(v);
        values[key] = v;
    }
    return values;
};

App.comfyLib.generate = async function() {
    if (this._generating) return;
    if (!this._selectedWf) { App.showToast('请先选择一个工作流模板', 'warning'); return; }
    var promptText = '';
    var promptEl = document.getElementById('cwlPrompt');
    if (promptEl) promptText = promptEl.value;
    var paramValues = this._collectParamValues();
    var presetId = this._activePreset ? this._activePreset.id : 0;
    await this._doGenerate(promptText, paramValues, presetId);
};

// 以指定提示词直接生成（重新生成入口；绕过表单收集，兼容参数配置模式）
App.comfyLib.generateWithText = async function(promptText) {
    if (this._generating) return;
    if (!this._selectedWf) { App.showToast('请先选择一个工作流模板', 'warning'); return; }
    await this._doGenerate(promptText || '', {}, 0);
};

App.comfyLib._doGenerate = async function(promptText, paramValues, presetId) {
    var status = document.getElementById('cwlGenStatus');
    var btn = document.getElementById('cwlBtnGen');
    if (status) status.textContent = '⏳ 正在生成（约 15-60s，请勿关闭面板）...';
    if (btn) btn.disabled = true;
    this._generating = true;
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt_id: 0,
                prompt_text: promptText,
                workflow_id: this._selectedWf.id,
                preset_id: presetId || 0,
                param_values: paramValues || {}
            })
        });
        if (!d || !d.ok) {
            if (status) status.textContent = '❌ ' + (d && d.error ? d.error : '生成失败');
            App.showToast('生成失败: ' + (d && d.error ? d.error : ''), 'error');
            if (btn) btn.disabled = false;
            this._generating = false;
            this.loadLogs();
            this.refreshRuntime();
            return;
        }
        if (status) status.textContent = '✅ 生成完成';
        this._lastResult = d;
        var result = document.getElementById('cwlGenResult');
        if (result) result.style.display = 'block';
        var img = document.getElementById('cwlResultImg');
        if (img) img.src = d.thumbnail_url || ('/api/thumbnails/file/' + d.thumbnail);
        var dl = document.getElementById('cwlDownload');
        if (dl && d.output_file) dl.href = '/api/v2/comfyui/outputs/' + encodeURIComponent(d.output_file);
        var sc = document.getElementById('cwlSaveCardResult');
        if (sc) sc.textContent = '';
        this.loadList();
        this.loadLogs();
        this.refreshRuntime();
    } catch(e) {
        if (status) status.textContent = '❌ ' + e.message;
        App.showToast('生成异常: ' + e.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
        this._generating = false;
    }
};

// ============ 存为词卡 / 存为模板 ============

App.comfyLib.saveAsCard = async function() {
    if (!this._lastResult || !this._lastResult.output_file) return;
    // 弹分组选择框，由用户指定存到词库哪个分组
    this._openCardGroupPicker();
};

// 存为词卡 · 分组选择弹窗
App.comfyLib._openCardGroupPicker = function() {
    var self = this;
    var overlay = document.getElementById('cwlGroupPicker');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cwlGroupPicker';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:none;z-index:760;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };
        overlay.innerHTML =
        '<style>' +
          '.cwl-grp{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;border:1px solid transparent;transition:background .12s,border-color .12s;}' +
          '.cwl-grp:hover{background:var(--hover-bg,#f1f5f9);}' +
          '.cwl-grp-sel{background:rgba(99,102,241,0.10)!important;border-color:var(--primary)!important;color:var(--primary);font-weight:600;}' +
          '.cwl-arrow{width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-muted);cursor:pointer;border-radius:4px;flex-shrink:0;}' +
          '.cwl-arrow:hover{background:rgba(99,102,241,0.15);color:var(--primary);}' +
          '.cwl-tree-btn{font-size:10px;padding:3px 9px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-muted);cursor:pointer;}' +
          '.cwl-tree-btn:hover{border-color:var(--primary);color:var(--primary);}' +
          '.cwl-rgrp{transition:background .12s,border-color .12s,color .12s;}' +
          '.cwl-rgrp:hover{border-color:var(--primary)!important;color:var(--primary);}' +
          '.cwl-logview-btn{font-size:10px;padding:3px 9px;border:none;background:transparent;color:var(--text-muted);cursor:pointer;border-radius:6px;}' +
          '.cwl-logview-btn.active{background:rgba(99,102,241,0.12);color:var(--primary);font-weight:600;}' +
          '.cwl-rerun-btn{font-size:10px;padding:3px 9px;border:1px solid var(--primary);color:var(--primary);background:transparent;border-radius:6px;cursor:pointer;white-space:nowrap;}' +
          '.cwl-rerun-btn:hover{background:rgba(99,102,241,0.10);}' +
          '.cwl-log-card{transition:border-color .12s;}' +
          '.cwl-log-card:hover{border-color:var(--primary)!important;}' +
        '</style>' +
        '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:560px;max-height:84vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
          '<div class="modal-header" style="padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
            '<h5 style="margin:0;font-size:14px;"><i class="bi bi-bookmark-plus"></i> 存为词卡 — 选择分组</h5>' +
            '<button class="header-btn-sm" onclick="document.getElementById(\'cwlGroupPicker\').style.display=\'none\'">&times;</button>' +
          '</div>' +
          '<div class="modal-body" style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:12px;">' +
            '<div style="display:flex;gap:14px;align-items:flex-start;">' +
              '<img id="cwlGroupImg" style="width:150px;height:100px;object-fit:cover;border-radius:10px;border:1px solid var(--border-color);background:#0f172a;flex-shrink:0;">' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">将保存为词卡，提示词：</div>' +
                '<div id="cwlGroupPrompt" style="font-size:12px;color:var(--text-main);background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;max-height:64px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;"></div>' +
              '</div>' +
            '</div>' +
            '<div style="font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;"><i class="bi bi-folder2-open"></i> 目标分组 <span id="cwlGroupSel" style="font-size:11px;color:var(--primary);font-weight:600;"></span></div>' +
            '<div id="cwlRecommendedGroups" style="display:none;"></div>' +
            '<div id="cwlRecentGroups" style="border:1px solid var(--border-color);border-radius:10px;padding:8px;display:none;"></div>' +
            '<div id="cwlGroupList" style="border:1px solid var(--border-color);border-radius:10px;padding:6px;display:flex;flex-direction:column;gap:2px;">' +
              '<div id="cwlTreeBar" style="display:flex;align-items:center;gap:6px;padding:2px 4px 6px;border-bottom:1px dashed var(--border-color);margin-bottom:4px;flex-shrink:0;">' +
                '<span style="font-size:11px;color:var(--text-muted);"><i class="bi bi-diagram-3"></i> 全部分组 <span id="cwlTreeCount"></span></span>' +
                '<span style="margin-left:auto;display:flex;gap:6px;">' +
                  '<button class="cwl-tree-btn" onclick="App.comfyLib._collapseAllGroups()" title="折叠所有子分组"><i class="bi bi-arrows-collapse"></i> 全部折叠</button>' +
                  '<button class="cwl-tree-btn" onclick="App.comfyLib._expandAllGroups()" title="展开所有子分组"><i class="bi bi-arrows-expand"></i> 全部展开</button>' +
                '</span>' +
              '</div>' +
              '<div id="cwlTreeBody" style="display:flex;flex-direction:column;gap:2px;max-height:270px;overflow-y:auto;">加载分组...</div>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer" style="padding:10px 16px;border-top:1px solid var(--border-color);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;">' +
            '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'cwlGroupPicker\').style.display=\'none\'">取消</button>' +
            '<button class="btn btn-primary btn-sm" onclick="App.comfyLib._confirmSaveAsCard()"><i class="bi bi-check"></i> 存入该分组</button>' +
          '</div>' +
        '</div>';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    // 预览与提示词
    var img = document.getElementById('cwlGroupImg');
    if (img && this._lastResult) img.src = this._lastResult.thumbnail_url || ('/api/thumbnails/file/' + this._lastResult.thumbnail);
    var pt = document.getElementById('cwlGroupPrompt');
    if (pt) pt.textContent = (document.getElementById('cwlPrompt') || {}).value || '';
    var selHint = document.getElementById('cwlGroupSel');
    this._selectedGroupId = 0;
    if (selHint) selHint.textContent = '';
    var list = document.getElementById('cwlGroupList');
    if (!list) return;
    // 推荐分组：基于提示词内容自动识别
    var ptText = pt ? pt.textContent : '';
    var recEl = document.getElementById('cwlRecommendedGroups');
    if (recEl) {
        if (ptText && ptText.trim()) {
            recEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:6px;">💡 正在识别推荐分组...</div>';
            recEl.style.display = 'block';
            App.fetchJSON('/api/v4/word-cards/groups/recommend?text=' + encodeURIComponent(ptText) + '&limit=5').then(function(d) {
                if (!recEl) return;
                if (!d || !d.ok || !d.items || d.items.length === 0) { recEl.style.display = 'none'; return; }
                var rh = '<div style="font-size:10px;color:var(--text-muted);font-weight:600;margin-bottom:6px;"><i class="bi bi-magic"></i> 推荐分组 <span style="font-weight:400;">根据提示词自动识别</span></div><div style="display:flex;flex-wrap:wrap;gap:6px;">';
                d.items.forEach(function(g) {
                    rh += '<span class="cwl-rgrp cwl-rec" data-id="' + g.id + '" data-name="' + App._escape(g.name || '') + '" onclick="App.comfyLib._pickGroup(' + g.id + ', this)" title="命中：' + App._escape((g.matched || []).join('、') || '内容匹配') + '" style="cursor:pointer;font-size:11px;padding:4px 10px;border-radius:14px;border:1px solid #6366f1;color:var(--primary);background:rgba(99,102,241,0.08);display:inline-flex;align-items:center;gap:4px;">' +
                      '<span style="font-size:12px;">💡</span>' + App._escape(g.name || '未命名') +
                    '</span>';
                });
                rh += '</div>';
                recEl.innerHTML = rh;
                recEl.style.display = 'block';
            }).catch(function() { if (recEl) recEl.style.display = 'none'; });
        } else {
            recEl.style.display = 'none';
        }
    }
    // 优先复用词卡模型缓存接口，缺失时直接拉取
    var groupsP = (typeof App.cardModel !== 'undefined' && App.cardModel.getGroups)
        ? App.cardModel.getGroups(true)
        : App.fetchJSON('/api/v4/word-cards/groups?include_empty=true').then(function(d) { return (d && d.groups) || []; });
    groupsP.then(function(groups) {
        if (!groups || groups.length === 0) {
            var tb = document.getElementById('cwlTreeBody');
            if (tb) tb.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">词库暂无分组</div>';
            return;
        }
        var last = parseInt(localStorage.getItem('cwl_last_group') || '0', 10) || 0;
        var lastId = 0;
        // 最近分组：按创建时间倒序前 5 个（独立区块，不影响树状结构）
        var recentEl = document.getElementById('cwlRecentGroups');
        var recent = groups.filter(function(g) { return g.created_at; })
            .sort(function(a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })
            .slice(0, 5);
        if (recent.length > 0 && recentEl) {
            var rh = '<div style="font-size:10px;color:var(--text-muted);font-weight:600;margin-bottom:6px;"><i class="bi bi-clock-history"></i> 最近分组</div><div style="display:flex;flex-wrap:wrap;gap:6px;">';
            recent.forEach(function(g) {
                var isLast = (last && g.id === last);
                rh += '<span class="cwl-rgrp' + (isLast ? ' cwl-grp-sel' : '') + '" data-id="' + g.id + '" data-name="' + App._escape(g.name || '') + '" onclick="App.comfyLib._pickGroup(' + g.id + ', this)" style="cursor:pointer;font-size:11px;padding:4px 10px;border-radius:14px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);display:inline-flex;align-items:center;gap:4px;">' +
                  '<span style="font-size:12px;">📌</span>' + App._escape(g.name || '未命名') +
                '</span>';
                if (isLast) lastId = g.id;
            });
            rh += '</div>';
            recentEl.innerHTML = rh;
            recentEl.style.display = 'block';
        }
        // 保存全部分组供树折叠/展开重渲染
        self._allGroups = groups;
        self._renderGroupTree(groups);
        // 自动定位到上次选择的分组：展开祖先链 + 高亮 + 滚动到可视区
        if (lastId) {
            var gmap = {};
            groups.forEach(function(g) { gmap[g.id] = g; });
            var pid = gmap[lastId] ? gmap[lastId].parent_group_id : null;
            while (pid && gmap[pid]) { delete self._collapsedGroups[pid]; pid = gmap[pid].parent_group_id; }
            self._renderGroupTree(groups);
            var treeEl = document.querySelector('#cwlTreeBody .cwl-grp[data-id="' + lastId + '"]');
            var rEl2 = recentEl ? recentEl.querySelector('.cwl-rgrp[data-id="' + lastId + '"]') : null;
            var recEl2 = recEl ? recEl.querySelector('.cwl-rgrp[data-id="' + lastId + '"]') : null;
            self._pickGroup(lastId, treeEl || rEl2 || recEl2);
            if (treeEl) setTimeout(function() { try { treeEl.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch(e) {} }, 80);
        }
    });
};

// ============ 分组树：折叠 / 展开 ============

App.comfyLib._groupIcon = function(g, depth) {
    if (g.group_type === 'atom') return '🧩';
    if (g.group_type === 'builtin') return '📦';
    if (g.group_type === 'seedance') return '🎬';
    if (g.group_type === 'custom') return '🗂️';
    if (depth === 0) return '📂';
    return '📁';
};

// 渲染可折叠分组树（不改变分组层级结构）
App.comfyLib._renderGroupTree = function(groups) {
    var body = document.getElementById('cwlTreeBody');
    if (!body) return;
    var self = this;
    var gmap = {};
    groups.forEach(function(g) { gmap[g.id] = g; });
    var childrenMap = {};
    groups.forEach(function(g) {
        var pid = (g.parent_group_id && gmap[g.parent_group_id]) ? g.parent_group_id : 0;
        (childrenMap[pid] = childrenMap[pid] || []).push(g);
    });
    var roots = childrenMap[0] || [];
    // 孤立根（父级不在列表中）也纳入，保持原排序
    groups.forEach(function(g) {
        if (!g.parent_group_id || !gmap[g.parent_group_id]) roots.push(g);
    });
    var seen = {};
    roots = roots.filter(function(g) { if (seen[g.id]) return false; seen[g.id] = 1; return true; });
    var count = document.getElementById('cwlTreeCount');
    if (count) count.textContent = '(' + groups.length + ')';
    var html = '';
    var renderNode = function(g, depth) {
        var kids = childrenMap[g.id] || [];
        var hasKids = kids.length > 0;
        var collapsed = !!self._collapsedGroups[g.id];
        var isSel = self._selectedGroupId === g.id;
        html += '<div class="cwl-grp' + (isSel ? ' cwl-grp-sel' : '') + '" data-id="' + g.id + '" data-name="' + App._escape(g.name || '') + '" onclick="App.comfyLib._pickGroup(' + g.id + ', this)" style="padding-left:' + (6 + depth * 16) + 'px;">' +
          (hasKids
            ? '<span class="cwl-arrow" onclick="event.stopPropagation();App.comfyLib._toggleGroup(' + g.id + ')" title="' + (collapsed ? '展开' : '折叠') + '">' + (collapsed ? '▶' : '▼') + '</span>'
            : '<span style="width:16px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;"></span>') +
          '<span style="font-size:13px;">' + self._groupIcon(g, depth) + '</span>' +
          '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + App._escape(g.name || '未命名') + '</span>' +
          '<span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">' + (g.card_count || 0) + ' 张</span>' +
        '</div>';
        if (hasKids && !collapsed) {
            kids.forEach(function(k) { renderNode(k, depth + 1); });
        }
    };
    roots.forEach(function(g) { renderNode(g, 0); });
    body.innerHTML = html;
};

// 折叠 / 展开单个分组
App.comfyLib._toggleGroup = function(id) {
    if (this._collapsedGroups[id]) delete this._collapsedGroups[id];
    else this._collapsedGroups[id] = true;
    if (this._allGroups) this._renderGroupTree(this._allGroups);
};

// 全部折叠（只折叠有子分组的分组）
App.comfyLib._collapseAllGroups = function() {
    if (!this._allGroups) return;
    var gmap = {};
    this._allGroups.forEach(function(g) { gmap[g.id] = g; });
    var childrenMap = {};
    this._allGroups.forEach(function(g) {
        var pid = (g.parent_group_id && gmap[g.parent_group_id]) ? g.parent_group_id : 0;
        (childrenMap[pid] = childrenMap[pid] || []).push(g);
    });
    var self = this;
    this._allGroups.forEach(function(g) {
        if ((childrenMap[g.id] || []).length > 0) self._collapsedGroups[g.id] = true;
    });
    this._renderGroupTree(this._allGroups);
};

// 全部展开
App.comfyLib._expandAllGroups = function() {
    this._collapsedGroups = {};
    if (this._allGroups) this._renderGroupTree(this._allGroups);
};

// 选择分组（单选高亮，推荐/最近/树三区同步）
App.comfyLib._pickGroup = function(id, el) {
    var all = document.querySelectorAll('#cwlGroupList .cwl-grp, #cwlRecentGroups .cwl-rgrp, #cwlRecommendedGroups .cwl-rgrp');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('cwl-grp-sel');
    if (el) el.classList.add('cwl-grp-sel');
    // 从推荐/最近分组选择时，同步高亮树中对应项（反之亦然）
    if (el && (el.classList.contains('cwl-rgrp') || el.classList.contains('cwl-rec'))) {
        var treeEl = document.querySelector('#cwlTreeBody .cwl-grp[data-id="' + id + '"]');
        if (treeEl) treeEl.classList.add('cwl-grp-sel');
    } else if (el) {
        var rEl = document.querySelector('#cwlRecentGroups .cwl-rgrp[data-id="' + id + '"], #cwlRecommendedGroups .cwl-rgrp[data-id="' + id + '"]');
        if (rEl) rEl.classList.add('cwl-grp-sel');
    }
    this._selectedGroupId = id;
    var selHint = document.getElementById('cwlGroupSel');
    if (selHint && el) selHint.textContent = '「' + (el.getAttribute('data-name') || '') + '」';
};

// 确认存入所选分组
App.comfyLib._confirmSaveAsCard = async function() {
    var gid = this._selectedGroupId;
    if (!gid) { App.showToast('请先选择目标分组', 'warning'); return; }
    localStorage.setItem('cwl_last_group', String(gid));
    var picker = document.getElementById('cwlGroupPicker');
    if (picker) picker.style.display = 'none';
    var promptText = (document.getElementById('cwlPrompt') || {}).value || '';
    var paramValues = this._collectParamValues();
    if (!promptText) {
        for (var k in paramValues) {
            if (k.indexOf('.text') > -1 && paramValues[k]) { promptText = String(paramValues[k]); break; }
        }
    }
    var sc = document.getElementById('cwlSaveCardResult');
    if (sc) sc.textContent = '正在创建词卡...';
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/generate/save-card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                output_file: this._lastResult.output_file,
                workflow_id: this._selectedWf ? this._selectedWf.id : '',
                prompt_text: promptText,
                group_id: gid,
                module: 'custom'
            })
        });
        if (d && d.ok) {
            if (sc) sc.innerHTML = '✅ 已存为词卡 #' + d.card_id + '（缩略图已生成，可从词卡右键「用工作流生成」再次调用）';
            this.loadLogs();
        } else {
            if (sc) sc.textContent = '❌ ' + (d && d.error ? d.error : '保存失败');
        }
    } catch(e) {
        if (sc) sc.textContent = '❌ ' + e.message;
    }
};

App.comfyLib.importResultAsWf = async function() {
    if (!this._lastResult || !this._lastResult.output_file) return;
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/import-from-output', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ output_file: this._lastResult.output_file })
        });
        if (d && d.ok) {
            App.showToast('已存为模板: ' + (d.name || ''), 'success');
            this.loadList();
        } else {
            App.showToast(d && d.error ? d.error : '保存模板失败', 'error');
        }
    } catch(e) {
        App.showToast(e.message, 'error');
    }
};

// ============ PNG 导入 ============

App.comfyLib.importPng = async function(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    App.showToast('正在解析 PNG 工作流元数据...', 'info');
    var fd = new FormData();
    fd.append('file', file);
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/workflows/import-png', { method: 'POST', body: fd });
        if (d && d.ok) {
            App.showToast('✅ 已导入工作流「' + (d.name || '') + '」 ' + d.node_count + ' 节点', 'success');
            input.value = '';
            this.loadList();
            this.selectWf(d.workflow_id);
        } else {
            App.showToast('导入失败: ' + (d && d.error ? d.error : '未知'), 'error');
            input.value = '';
        }
    } catch(e) {
        App.showToast('导入失败: ' + e.message, 'error');
        input.value = '';
    }
};

// ============ 从 ComfyUI 同步 ============

App.comfyLib.syncFromComfy = async function() {
    App.showToast('正在获取 ComfyUI 工作流来源...', 'info');
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/available');
        if (!d || !d.ok) {
            App.showToast('获取失败: ' + (d && d.error ? d.error : '未知'), 'error');
            return;
        }
        this._showSourcePicker(d);
    } catch(e) {
        App.showToast('获取失败: ' + e.message, 'error');
    }
};

// 来源选择弹窗：已保存模板 / 最近运行 / 执行中排队中
App.comfyLib._showSourcePicker = function(d) {
    var overlay = document.getElementById('cwlSrcPicker');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cwlSrcPicker';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:none;z-index:760;';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };
        overlay.innerHTML =
        '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:640px;max-height:82vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
          '<div class="modal-header" style="padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
            '<h5 style="margin:0;font-size:14px;"><i class="bi bi-diagram-3"></i> 从 ComfyUI 获取工作流</h5>' +
            '<button class="header-btn-sm" onclick="document.getElementById(\'cwlSrcPicker\').style.display=\'none\'">&times;</button>' +
          '</div>' +
          '<div class="modal-body" id="cwlSrcList" style="flex:1;overflow-y:auto;padding:10px 16px;"></div>' +
          '<div class="modal-footer" style="padding:8px 16px;border-top:1px solid var(--border-color);font-size:11px;color:var(--text-muted);flex-shrink:0;">点击任一来源即导入；已在库中匹配的会自动定位</div>' +
        '</div>';
        document.body.appendChild(overlay);
    }
    var html = '';
    // 已保存模板
    html += '<div style="font-size:12px;font-weight:600;margin:10px 0 6px;">📁 已保存模板 (' + (d.templates || []).length + ')</div>';
    if (!d.templates || d.templates.length === 0) {
        html += '<div style="font-size:11px;color:var(--text-muted);padding:4px 0 8px;">无（在 ComfyUI 中打开工作流后按 Ctrl+S 保存，即可出现在此）</div>';
    } else {
        d.templates.forEach(function(t) {
            html += '<div class="cwl-src-item" onclick="App.comfyLib._importSource(\'file=' + t.file + '\',\'' + App._escape(t.name) + '\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;" onmouseenter="this.style.borderColor=\'var(--primary)\';this.style.background=\'rgba(99,102,241,0.05)\';" onmouseleave="this.style.borderColor=\'var(--border-color)\';this.style.background=\'transparent\';">' +
              '<span>📄</span><span style="flex:1;">' + App._escape(t.name) + '</span>' +
              '<span style="color:var(--text-muted);font-size:10px;">' + t.node_count + ' 节点 · ' + App._escape(t.mtime) + '</span>' +
            '</div>';
        });
    }
    // 最近运行
    html += '<div style="font-size:12px;font-weight:600;margin:14px 0 6px;">🕘 最近运行 (' + (d.recent || []).length + ')</div>';
    (d.recent || []).forEach(function(r) {
        html += '<div class="cwl-src-item" onclick="App.comfyLib._importSource(\'history=' + r.prompt_id + '\',\'' + App._escape((r.prompt_text || r.prompt_id).slice(0, 18)) + '\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;" onmouseenter="this.style.borderColor=\'var(--primary)\';this.style.background=\'rgba(99,102,241,0.05)\';" onmouseleave="this.style.borderColor=\'var(--border-color)\';this.style.background=\'transparent\';">' +
          '<span>🕘</span><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(r.prompt_id) + '">' + App._escape((r.prompt_text || ('任务 ' + r.prompt_id.slice(0, 8))) + (r.status ? ' (' + r.status + ')' : '')) + '</span>' +
          '<span style="color:var(--text-muted);font-size:10px;">' + r.node_count + ' 节点</span>' +
        '</div>';
    });
    // 执行中/排队中
    if ((d.running || []).length + (d.pending || []).length > 0) {
        html += '<div style="font-size:12px;font-weight:600;margin:14px 0 6px;">▶ 执行中 / 排队中</div>';
        d.running.forEach(function(r) {
            html += '<div class="cwl-src-item" onclick="App.comfyLib._importSource(\'queue=' + r.prompt_id + '\',\'执行中任务\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #10b981;border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;color:#10b981;">' +
              '<span>▶</span><span style="flex:1;">执行中 ' + r.prompt_id.slice(0, 8) + '…</span><span style="font-size:10px;">' + r.node_count + ' 节点</span></div>';
        });
        d.pending.forEach(function(r) {
            html += '<div class="cwl-src-item" onclick="App.comfyLib._importSource(\'queue=' + r.prompt_id + '\',\'排队任务\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #f59e0b;border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;color:#f59e0b;">' +
              '<span>◌</span><span style="flex:1;">排队中 ' + r.prompt_id.slice(0, 8) + '…</span><span style="font-size:10px;">' + r.node_count + ' 节点</span></div>';
        });
    }
    document.getElementById('cwlSrcList').innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">无可获取的工作流来源</div>';
    overlay.style.display = 'flex';
};

App.comfyLib._importSource = async function(source, label) {
    var picker = document.getElementById('cwlSrcPicker');
    if (picker) picker.style.display = 'none';
    App.showToast('正在导入「' + label + '」...', 'info');
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: source })
        });
        if (d && d.ok) {
            App.showToast((d.matched ? '✅ 已匹配现有模板「' : '✅ 已导入新模板「') + (d.workflow_name || label) + '」', 'success');
            await this.loadList();
            if (d.workflow_id) this.selectWf(d.workflow_id);
        } else {
            App.showToast('导入失败: ' + (d && d.error ? d.error : '未知'), 'error');
        }
    } catch(e) {
        App.showToast('导入失败: ' + e.message, 'error');
    }
};

// ============ 生成任务（队列监督） ============

App.comfyLib.loadTasks = async function() {
    var el = document.getElementById('cwlTasks');
    if (!el) return;
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/batch-tasks?limit=15');
        if (!d || !d.items) throw new Error('获取失败');
        if (d.items.length === 0) {
            el.innerHTML = '<span style="color:var(--text-muted);">暂无批量生成任务</span>';
            return;
        }
        var stMap = { queued: ['排队中', '#f59e0b'], running: ['生成中', '#6366f1'], done: ['已完成', '#10b981'], cancelled: ['已取消', '#94a3b8'], error: ['失败', '#ef4444'] };
        var html = '<div style="display:flex;flex-direction:column;gap:6px;">';
        d.items.forEach(function(t) {
            var st = stMap[t.status] || [t.status, '#94a3b8'];
            var pct = t.total > 0 ? Math.round(t.current_index / t.total * 100) : 0;
            var mt = { flux: 'FLUX', sdxl: 'SDXL', sd15: 'SD1.5' }[t.model_type] || '';
            html += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:7px 9px;">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<b style="font-size:11px;">#' + t.id + '</b>' +
                '<span style="font-size:11px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(t.workflow_name || '') + '">' + App._escape((t.workflow_name || '未命名') + (mt ? ' · ' + mt : '')) + '</span>' +
                '<span style="font-size:9px;padding:1px 7px;border-radius:8px;color:#fff;background:' + st[1] + ';">' + st[0] + '</span>' +
                '<span style="font-size:10px;color:var(--text-muted);">' + (t.success || 0) + '✓/' + (t.failed || 0) + '✗</span>' +
                '<span style="font-size:10px;color:var(--text-muted);">' + App._escape(String(t.created_at || '').slice(5, 16)) + '</span>' +
                '<span style="display:flex;gap:4px;">' +
                  ((t.status === 'queued' || t.status === 'running') ? '<button class="cwl-tree-btn" style="border-color:#ef4444;color:#ef4444;" onclick="App.comfyLib.cancelTask(' + t.id + ')">取消</button>' : '') +
                  ((t.status === 'done' && t.failed > 0) ? '<button class="cwl-tree-btn" style="border-color:#f59e0b;color:#f59e0b;" onclick="App.comfyLib.retryTask(' + t.id + ')">重试失败</button>' : '') +
                '</span>' +
              '</div>' +
              '<div style="height:5px;background:var(--border-color);border-radius:3px;overflow:hidden;margin-top:5px;">' +
                '<div style="height:100%;width:' + pct + '%;background:' + st[1] + ';transition:width .3s;"></div>' +
              '</div>' +
            '</div>';
        });
        html += '</div>';
        el.innerHTML = html;
    } catch(e) {
        el.innerHTML = '<span style="color:#ef4444;">' + App._escape(e.message) + '</span>';
    }
};

App.comfyLib.cancelTask = async function(taskId) {
    if (!confirm('取消任务 #' + taskId + '？已完成的结果保留。')) return;
    try {
        await App.fetchJSON('/api/v2/comfyui/batch-tasks/' + taskId + '/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        App.showToast('已请求取消任务 #' + taskId, 'info');
        this.loadTasks();
    } catch(e) { App.showToast('取消失败: ' + e.message, 'error'); }
};

App.comfyLib.retryTask = async function(taskId) {
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/batch-tasks/' + taskId + '/retry-failed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (d && d.ok) {
            App.showToast('已创建重试任务 #' + d.task_id + '（' + d.total + ' 张）', 'success');
            this.loadTasks();
        } else {
            App.showToast('重试失败: ' + (d && d.error || ''), 'error');
        }
    } catch(e) { App.showToast('重试异常: ' + e.message, 'error'); }
};

// ============ 生成历史 ============

App.comfyLib.setLogView = function(mode) {
    this._logViewMode = mode;
    try { localStorage.setItem('cwl_log_view', mode); } catch(e) {}
    var g = document.getElementById('cwlLogViewGrid');
    var l = document.getElementById('cwlLogViewList');
    if (g) g.className = 'cwl-logview-btn' + (mode === 'grid' ? ' active' : '');
    if (l) l.className = 'cwl-logview-btn' + (mode === 'list' ? ' active' : '');
    this._renderLogs();
};

App.comfyLib.loadLogs = async function() {
    var el = document.getElementById('cwlLogs');
    if (!el) return;
    try {
        var d = await App.fetchJSON('/api/v2/comfyui/generation-logs?limit=20');
        if (!d || !d.items) throw new Error('获取失败');
        this._logs = d.items;
        if (!this._logViewMode) {
            this._logViewMode = (function() { try { return localStorage.getItem('cwl_log_view') === 'list' ? 'list' : 'grid'; } catch(e) { return 'grid'; } })();
        }
        var g = document.getElementById('cwlLogViewGrid');
        var l = document.getElementById('cwlLogViewList');
        if (g) g.className = 'cwl-logview-btn' + (this._logViewMode === 'grid' ? ' active' : '');
        if (l) l.className = 'cwl-logview-btn' + (this._logViewMode === 'list' ? ' active' : '');
        this._renderLogs();
    } catch(e) {
        el.innerHTML = '<span style="color:#ef4444;">' + App._escape(e.message) + '</span>';
    }
};

App.comfyLib._renderLogs = function() {
    var el = document.getElementById('cwlLogs');
    if (!el) return;
    var logs = this._logs || [];
    if (logs.length === 0) {
        el.innerHTML = '<span style="color:var(--text-muted);">暂无生成记录</span>';
        return;
    }
    if (this._logViewMode === 'list') this._renderLogsTable(el, logs);
    else this._renderLogsGrid(el, logs);
};

// 预览模式：图片卡片网格（点击载入生成区，↻ 直接重新生成）
App.comfyLib._renderLogsGrid = function(el, logs) {
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;">';
    logs.forEach(function(lg) {
        var stColor = lg.status === 'success' ? '#10b981' : (lg.status === 'failed' ? '#ef4444' : '#f59e0b');
        var stLabel = lg.status === 'success' ? '✓ 成功' : (lg.status === 'failed' ? '✗ 失败' : '… ' + (lg.status || '?'));
        var thumb = lg.thumb_url || '';
        html += '<div class="cwl-log-card" onclick="App.comfyLib._loadLog(' + lg.id + ')" title="点击载入生成区，可调整后重新生成" style="border:1px solid var(--border-color);border-radius:10px;overflow:hidden;cursor:pointer;background:var(--bg-card);">' +
          '<div style="height:94px;background:#1e293b;position:relative;">' +
            (thumb ? '<img src="' + thumb + '" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy">' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px;opacity:0.5;">🎨</div>') +
            '<span style="position:absolute;top:5px;right:5px;font-size:9px;padding:1px 6px;border-radius:8px;color:#fff;background:' + stColor + ';">' + stLabel + '</span>' +
          '</div>' +
          '<div style="padding:6px 8px;">' +
            '<div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">' + App._escape((lg.created_at || '').slice(5, 16)) + (lg.duration_sec ? ' · ' + Math.round(lg.duration_sec) + 's' : '') + (lg.card_id ? ' · 词卡#' + lg.card_id : '') + '</div>' +
            '<div style="font-size:11px;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(lg.prompt_text || '') + '">' + App._escape((lg.prompt_text || '(空提示词)').slice(0, 30)) + '</div>' +
            '<div style="margin-top:5px;">' +
              '<button class="cwl-rerun-btn" onclick="event.stopPropagation();App.comfyLib._rerunLog(' + lg.id + ')" title="用相同提示词重新生成"><i class="bi bi-arrow-repeat"></i> 重新生成</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
};

// 详情模式：表格（缩略图 + 完整字段 + 操作）
App.comfyLib._renderLogsTable = function(el, logs) {
    var html = '<table style="width:100%;border-collapse:collapse;">' +
      '<tr style="color:var(--text-muted);text-align:left;"><th style="padding:4px 6px;font-weight:500;">图</th><th style="padding:4px 6px;font-weight:500;">时间</th><th style="padding:4px 6px;font-weight:500;">状态</th><th style="padding:4px 6px;font-weight:500;">耗时</th><th style="padding:4px 6px;font-weight:500;">词卡</th><th style="padding:4px 6px;font-weight:500;">提示词</th><th style="padding:4px 6px;font-weight:500;">操作</th></tr>';
    logs.forEach(function(lg) {
        var stColor = lg.status === 'success' ? '#10b981' : (lg.status === 'failed' ? '#ef4444' : '#f59e0b');
        var thumb = lg.thumb_url || '';
        html += '<tr style="border-top:1px solid var(--border-color);cursor:pointer;" onclick="App.comfyLib._loadLog(' + lg.id + ')" title="点击载入生成区，可调整后重新生成">' +
          '<td style="padding:4px 6px;">' + (thumb ? '<img src="' + thumb + '" style="width:52px;height:36px;object-fit:cover;border-radius:6px;display:block;" loading="lazy">' : '<span style="color:var(--text-muted);">-</span>') + '</td>' +
          '<td style="padding:4px 6px;">' + App._escape((lg.created_at || '').slice(5, 16)) + '</td>' +
          '<td style="padding:4px 6px;color:' + stColor + ';">' + App._escape(lg.status) + '</td>' +
          '<td style="padding:4px 6px;">' + (lg.duration_sec ? Math.round(lg.duration_sec) + 's' : '-') + '</td>' +
          '<td style="padding:4px 6px;">' + (lg.card_id ? '#' + lg.card_id : '-') + '</td>' +
          '<td style="padding:4px 6px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(lg.prompt_text || '') + '">' + App._escape((lg.prompt_text || '').slice(0, 40)) + '</td>' +
          '<td style="padding:4px 6px;"><button class="cwl-rerun-btn" onclick="event.stopPropagation();App.comfyLib._rerunLog(' + lg.id + ')" title="用相同提示词重新生成"><i class="bi bi-arrow-repeat"></i> 重新生成</button></td>' +
        '</tr>';
    });
    html += '</table>';
    el.innerHTML = html;
};

// 载入历史记录到生成区（可再次调整后生成）
App.comfyLib._loadLog = async function(id) {
    var lg = null;
    for (var i = 0; i < (this._logs || []).length; i++) { if (this._logs[i].id === id) { lg = this._logs[i]; break; } }
    if (!lg) return;
    if (!lg.workflow_id) { App.showToast('该记录无关联工作流，无法载入', 'warning'); return; }
    App.showToast('正在载入生成记录...', 'info');
    await this.loadList();
    await this.selectWf(lg.workflow_id);
    if (!this._selectedWf) { App.showToast('关联工作流已被删除，无法载入', 'error'); return; }
    var promptEl = document.getElementById('cwlPrompt');
    if (promptEl) promptEl.value = lg.prompt_text || '';
    var panel = document.getElementById('cwlGenPanel');
    if (panel) panel.scrollIntoView({ block: 'nearest' });
    App.showToast('已载入记录，可调整提示词后点击「生成图片」', 'success');
};

// 重新生成：载入记录并用相同提示词立即生成
App.comfyLib._rerunLog = async function(id) {
    var lg = null;
    for (var i = 0; i < (this._logs || []).length; i++) { if (this._logs[i].id === id) { lg = this._logs[i]; break; } }
    if (!lg) return;
    if (!lg.workflow_id) { App.showToast('该记录无关联工作流，无法重新生成', 'warning'); return; }
    if (this._generating) { App.showToast('正在生成中，请稍候', 'warning'); return; }
    await this.loadList();
    await this.selectWf(lg.workflow_id);
    if (!this._selectedWf) { App.showToast('关联工作流已被删除，无法重新生成', 'error'); return; }
    var promptEl = document.getElementById('cwlPrompt');
    if (promptEl) promptEl.value = lg.prompt_text || '';
    await this.generateWithText(lg.prompt_text || '');
};

// 暴露尺寸/比例/排序常量，供批量生成弹窗等外部模块复用
App.CWL_SIZE_PRESETS = CWL_SIZE_PRESETS;
App.CWL_RATIOS = CWL_RATIOS;
App.CWL_cmpParams = CWL_cmpParams;

})();
