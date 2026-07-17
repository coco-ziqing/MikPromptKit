/**
 * app_custom_wordpacks.js - 自定义词包模块（从 app_collections.js 拆出）
 */
(function() {
'use strict';
if (!App || App.showWordpackEditModal) return;
Object.assign(App, {
    // ============ 自定义词包 ============
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

});
console.log('[PK] app_custom_wordpacks loaded');
})();
