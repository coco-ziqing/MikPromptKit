// ComfyUI 工作流存储调用空间 — 分片 core（Phase 3.5 拆分，常量副本随片携带）
(function() {
'use strict';
if (!window.App || !App.fetchJSON) { setTimeout(arguments.callee, 200); return; }

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
    _logViewMode: null,
};

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
})();
