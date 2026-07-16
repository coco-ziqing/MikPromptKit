/**
 * app_trash_bin.js — 回收站模块（覆盖 app_collections.js 同名方法）
 */
(function() {
'use strict';
if (!App || App.batchRestore) return;
Object.assign(App, {

// ============ 回收站相关 ============
_trashFilterData: { action: null, module: null, search: '' },
_trashSelected: new Set(),

async batchDeleteAll() {
    var ids = [...this.state.batchSelected];
    if (ids.length === 0) { PK.toast('请先选择词条', 'error'); return; }
    try {
        var d = await PK.api('/api/v2/batch/delete/permanent', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ids: ids }) });
        if (d && d.ok) { PK.toast('已永久删除 ' + d.deleted + ' 条', 'success'); this.state.batchSelected.clear(); this.loadPrompts(); }
    } catch(e) { PK.toast('删除失败: ' + (e.detail || e.message), 'error'); }
},

async batchRestore() {
    var ids = [...this.state.batchSelected];
    if (ids.length === 0) { PK.toast('请先选择词条', 'error'); return; }
    try {
        var d = await PK.api('/api/v2/batch/restore', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ids: ids }) });
        if (d && d.ok) { PK.toast('已恢复 ' + d.restored + ' 条', 'success'); this.state.batchSelected.clear(); this.loadPrompts(); }
    } catch(e) { PK.toast('恢复失败: ' + (e.detail || e.message), 'error'); }
},

async batchGenIds() {
    var ids = [...this.state.batchSelected];
    if (ids.length === 0) { PK.toast('请先选择词条', 'error'); return; }
    try {
        var d = await PK.api('/api/v2/batch/generate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ids: ids }) });
        if (d && d.ok) {
            if (d.created > 0) PK.toast('生成完成: ' + d.created + ' 个新词条', 'success');
            this.state.batchSelected.clear();
            this.loadPrompts();
        }
    } catch(e) { PK.toast('生成失败: ' + (e.detail || e.message), 'error'); }
},

});
console.log('[PK] app_trash_bin loaded');
})();
