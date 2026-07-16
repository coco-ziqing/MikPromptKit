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
        var h = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">当前版本: v' + d.current_version + '</div>';
        h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
        h += '<tr><th style="border-bottom:1px solid var(--border-color);padding:6px 8px;text-align:left;">版本</th><th style="border-bottom:1px solid var(--border-color);padding:6px 8px;text-align:left;">时间</th><th style="border-bottom:1px solid var(--border-color);padding:6px 8px;text-align:left;">备注</th><th style="border-bottom:1px solid var(--border-color);padding:6px 8px;">操作</th></tr>';
        for (var i = 0; i < d.versions.length; i++) {
            var v = d.versions[i];
            var isCurrent = v.version === d.current_version;
            h += '<tr style="' + (isCurrent ? 'background:rgba(79,70,229,0.04);' : '') + '">';
            h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border-color);">' + (isCurrent ? '\u27a1 ' : '') + 'v' + v.version + '</td>';
            h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border-color);">' + PK._esc(v.created_at || '') + '</td>';
            h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border-color);">' + PK._esc(v.change_note || '-') + '</td>';
            h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border-color);text-align:center;">';
            if (!isCurrent) {
                h += '<button class="btn btn-xs btn-outline" onclick="App.wordEditor._rollbackTo(' + cid + ',' + v.version + ')">恢复</button>';
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
        if (list) list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">\u26a0\ufe0f ' + PK._esc(e.message || '加载失败') + '</div>';
    }
};

App.wordEditor._rollbackTo = async function(cid, version) {
    try {
        var d = await PK.api('/api/v4/word-cards/' + cid + '/versions/rollback', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ version: version })
        });
        if (d && d.ok) {
            PK.toast('已回滚到 v' + d.rolled_to_version, 'success');
            this.close();
            if (this._onSaved) this._onSaved();
            if (App.wordCards && App.wordCards.load) App.wordCards.load();
        }
    } catch(e) {
        PK.toast('回滚失败: ' + (e.detail || e.message), 'error');
    }
};

console.log('[PK] word_version_history loaded');
})();
