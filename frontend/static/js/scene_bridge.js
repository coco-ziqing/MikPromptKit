// ============================================================
// Phase17: 场景模板融合器 — 场景设定组装器 ↔ 提示词组装器
// 从 scene_profiles 加载场景模板，应用到 user_project_scene 镜头
// ============================================================
(function() {
'use strict';

App.seedanceV2._sceneProfileCache = [];

// 预加载场景模板列表
App.seedanceV2._loadSceneProfiles = async function() {
    try {
        var d = await App.fetchJSON('/api/scene-composer/scenes?page_size=200');
        this._sceneProfileCache = d.items || [];
    } catch(e) { console.warn('_loadSceneProfiles:', e); }
};

// 打开场景模板选取弹窗
App.seedanceV2._openSceneProfilePicker = async function(shotId) {
    await this._loadSceneProfiles();
    var scenes = this._sceneProfileCache;

    var old = document.getElementById('sceneProfilePicker');
    if (old) old.remove();

    var currentSid = null;
    for (var i = 0; i < this.scenes.length; i++) {
        if (this.scenes[i].id === shotId) { currentSid = this.scenes[i].scene_profile_id; break; }
    }

    var overlay = document.createElement('div');
    overlay.id = 'sceneProfilePicker';
    overlay.className = 'modal-overlay s2-popup-overlay';
    overlay.style.cssText = 'display:flex;z-index:600;';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var h = '<div class="s2-popup-card" style="max-width:500px;max-height:80vh;overflow-y:auto;padding:20px;border-radius:12px;background:var(--bg-card);">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    h += '<h5 style="margin:0;">🏞 选择场景模板</h5>';
    h += '<button class="btn btn-xs btn-outline" onclick="document.getElementById(\'sceneProfilePicker\').remove()">✕</button>';
    h += '</div>';

    if (currentSid) {
        h += '<div style="margin-bottom:8px;padding:8px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:6px;cursor:pointer;font-size:13px;color:#ef4444;text-align:center;" onclick="App.seedanceV2._applySceneToShot('+shotId+',null)">🗑 取消场景模板</div>';
    }

    if (!scenes.length) {
        h += '<div class="s2-empty" style="padding:20px;">暂无场景模板<br><small>请先在「场景组装器」中创建</small></div>';
    } else {
        for (var si = 0; si < scenes.length; si++) {
            var sc = scenes[si];
            var s = sc.settings || {};
            var isActive = sc.id === currentSid;
            var loc = s.location || sc.location_desc || '';
            var atm = s.atmosphere || sc.atmosphere || '';
            var style = (isActive ? 'border-color:#10b981;background:rgba(16,185,129,0.06);' : '');

            h += '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid ' + (isActive?'#10b981':'var(--border-color)') + ';border-radius:8px;margin-bottom:6px;cursor:pointer;transition:0.12s;' + style + '" onclick="App.seedanceV2._applySceneToShot('+shotId+','+sc.id+')">';
            h += '<div style="font-size:24px;flex-shrink:0;">🏞</div>';
            h += '<div style="flex:1;min-width:0;">';
            h += '<div style="font-size:13px;font-weight:600;color:var(--text-main);">'+App._escape(sc.name)+(isActive?' ✅':'')+'</div>';
            if (loc) h += '<div style="font-size:10px;color:var(--text-muted);">📍 '+App._escape(loc.substring(0,40))+'</div>';
            if (atm) h += '<div style="font-size:10px;color:var(--text-muted);">🌫 '+App._escape(atm.substring(0,40))+'</div>';
            h += '</div>';
            h += '</div>';
        }
    }
    h += '</div>';
    overlay.innerHTML = h;
    document.body.appendChild(overlay);
};

// 应用/取消场景模板
App.seedanceV2._applySceneToShot = async function(shotId, sceneId) {
    var pId = this.currentProjectId;
    if (!pId) { App.showToast('请先打开项目','warning'); return; }

    if (sceneId === null) {
        // 取消绑定：清空 scene_profile_id + 字段
        var d = await App.fetchJSON('/api/seedance/v2/projects/' + pId + '/scenes/' + shotId, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({scene_profile_id: null})
        });
    }

    if (sceneId !== null) {
        var d = await App.fetchJSON('/api/scene-composer/scenes/' + sceneId + '/apply-to-shot', {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({shot_id: shotId})
        });
        if (d && d.ok) {
            App.showToast('已加载场景模板: ' + (d.scene_name||'') + ' (' + (d.field_count||0) + ' 字段)', 'success');
        }
    }

    document.getElementById('sceneProfilePicker')?.remove();
    await this.openProject(pId);
    this.compose();
};

})();
