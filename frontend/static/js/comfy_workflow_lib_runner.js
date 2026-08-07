// ComfyUI 工作流存储调用空间 — 分片 runner（Phase 3.5 拆分，常量副本随片携带）
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

// 暴露尺寸/比例/排序常量，供批量生成弹窗等外部模块复用
App.CWL_SIZE_PRESETS = CWL_SIZE_PRESETS;
App.CWL_RATIOS = CWL_RATIOS;
App.CWL_cmpParams = CWL_cmpParams;
})();
