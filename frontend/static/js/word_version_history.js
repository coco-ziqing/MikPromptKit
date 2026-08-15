/**
 * word_version_history.js — 词卡版本历史（从 word_editor.js 拆出）
 * 职责：版本历史弹窗 + 回滚操作
 */
(function() {
'use strict';
if (!App.wordEditor || App.wordEditor._showVersions) return;

App.wordEditor._cardId = null;

App.wordEditor._showVersions = async function() {
    var cid = this._cardId;
    if (!cid) { PK.toast('请先保存词卡', 'warning'); return; }

    var old = document.getElementById('wcVersionModal');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'wcVersionModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div class="modal-content" style="max-width:700px;width:90%;max-height:80vh;overflow-y:auto;background:var(--bg-card);padding:24px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.2);">' +
        '<h5 style="margin:0 0 4px;">\ud83d\udcdc 版本历史</h5>' +
        '<p style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">词卡 #' + cid + ' | 加载中...</p>' +
        '<div id="wcVersionList" style="max-height:55vh;overflow-y:auto;"></div>' +
        '<div style="text-align:right;margin-top:12px;"><button class="btn btn-sm btn-secondary" onclick="document.getElementById(\'wcVersionModal\').remove()">关闭</button></div>' +
        '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    try {
        var d = await PK.api('/api/v4/word-cards/' + cid + '/versions');
        if (!d || !d.versions) throw new Error('无版本数据');
        var list = document.getElementById('wcVersionList');
        var h = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">当前版本: v' + d.current_version + ' · 每版本独立图池/视频池（互不影响）</div>';
        h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
        h += '<tr><th style="border-bottom:1px solid var(--border-color);padding:6px 8px;text-align:left;">版本</th><th style="border-bottom:1px solid var(--border-color);padding:6px 8px;text-align:left;">生成池</th><th style="border-bottom:1px solid var(--border-color);padding:6px 8px;text-align:left;">时间</th><th style="border-bottom:1px solid var(--border-color);padding:6px 8px;text-align:left;">备注</th><th style="border-bottom:1px solid var(--border-color);padding:6px 8px;">操作</th></tr>';
        for (var i = 0; i < d.versions.length; i++) {
            var v = d.versions[i];
            var isCurrent = v.version === d.current_version;
            // v5.38.61: 生成池统计 + 当前产物缩略图
            var poolTxt = (v.pool_count)
                ? '<span>🖼 ' + (v.pool_img || 0) + ' · 🎬 ' + (v.pool_vid || 0) + '</span>'
                : '<span style="color:var(--text-muted);">—</span>';
            var thumbHtml = '';
            if (v.pool_current) {
                if (v.pool_current.media_type === 'video') {
                    thumbHtml = '<span style="font-size:16px;" title="当前视频">🎬</span>';
                } else {
                    thumbHtml = '<img src="' + PK._esc(v.pool_current.url) + '" style="width:40px;height:30px;object-fit:cover;border-radius:4px;border:1px solid var(--border-color);" onerror="this.style.opacity=0.2">';
                }
            }
            h += '<tr style="' + (isCurrent ? 'background:rgba(79,70,229,0.04);' : '') + '">';
            h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border-color);">' + (isCurrent ? '\u27a1 ' : '') + 'v' + v.version + '<br>' + thumbHtml + '</td>';
            h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border-color);">' + poolTxt + '</td>';
            h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border-color);">' + PK._esc(v.created_at || '') + '</td>';
            h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border-color);">' + PK._esc(v.change_note || '-') + '</td>';
            h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border-color);text-align:center;">';
            if (!isCurrent) {
                h += '<button class="btn btn-xs btn-outline" onclick="App.wordEditor._rollbackTo(' + cid + ',' + v.id + ')" title="切换到该版本（提示词+预览图联动）">切换到该版本</button>';
            }
            h += '</td></tr>';
        }
        h += '</table>';
        list.innerHTML = h;
        // 更新标题
        var p = overlay.querySelector('p');
        if (p) p.textContent = '词卡 #' + cid + ' | ' + d.versions.length + ' 个版本';
    } catch (e) {
        var list = document.getElementById('wcVersionList');
        if (list) list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">\u26a0\ufe0f ' + PK._esc(e.message || '加载未完成') + '</div>';
    }
};

App.wordEditor._rollbackTo = async function(cid, verId) {
    try {
        // v5.38.61: 修正路径/参数（原调 /versions/rollback+version 与后端 /{card_id}/rollback+version_id 不匹配，回滚一直 404）
        var d = await PK.api('/api/v4/word-cards/' + cid + '/rollback', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ version_id: verId })
        });
        if (d && d.ok) {
            PK.toast('已切换到 v' + d.rolled_to_version + '（提示词与预览图已联动）', 'success');
            this.close();
            if (this._onSaved) this._onSaved();
            if (App.wordCards && App.wordCards.load) App.wordCards.load();
            if (App.loadPrompts) { try { App.loadPrompts(); } catch (e) {} }
        }
    } catch(e) {
        PK.toast('切换未完成: ' + (e.detail || e.message), 'error');
    }
};

console.log('[PK] word_version_history loaded');
})();
