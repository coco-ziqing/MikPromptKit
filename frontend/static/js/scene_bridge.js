// ============================================================
// Phase17: 场景模板融合器 — 场景设定组装器 ↔ 分镜组装器
// T5: 改用 PK 底座（PK.api / PK.toast / PK._esc），保留 App.seedanceV2._* 外部 API
// ============================================================
(function() {
'use strict';

var S = App.seedanceV2;
S._sceneProfileCache = [];

// 预加载场景模板列表
S._loadSceneProfiles = async function() {
    try {
        var d = await PK.api('/api/scene-composer/scenes?page_size=200');
        this._sceneProfileCache = d.items || [];
    } catch(e) { console.warn('_loadSceneProfiles:', e); }
};

// 打开场景模板选取弹窗
S._openSceneProfilePicker = async function(shotId) {
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
    h += '<h5 style="margin:0;">\ud83c\udfdf\ufe0f 选择场景模板</h5>';
    h += '<button class="btn btn-xs btn-outline" onclick="document.getElementById(\'sceneProfilePicker\').remove()">\u2715</button>';
    h += '</div>';

    if (currentSid) {
        h += '<div style="margin-bottom:8px;padding:8px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:6px;cursor:pointer;font-size:13px;color:#ef4444;text-align:center;" onclick="App.seedanceV2._applySceneToShot('+shotId+',null)">\ud83d\uddd1 取消场景模板</div>';
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
            h += '<div style="font-size:24px;flex-shrink:0;">\ud83c\udfdf\ufe0f</div>';
            h += '<div style="flex:1;min-width:0;">';
            h += '<div style="font-size:13px;font-weight:600;color:var(--text-main);">'+PK._esc(sc.name)+(isActive?' \u2705':'')+'</div>';
            if (loc) h += '<div style="font-size:10px;color:var(--text-muted);">\ud83d\udccd '+PK._esc(loc.substring(0,40))+'</div>';
            if (atm) h += '<div style="font-size:10px;color:var(--text-muted);">\ud83c\udf2b '+PK._esc(atm.substring(0,40))+'</div>';
            h += '</div>';
            h += '</div>';
        }
    }
    h += '</div>';
    overlay.innerHTML = h;
    document.body.appendChild(overlay);
};

// 应用/取消场景模板
S._applySceneToShot = async function(shotId, sceneId) {
    var pId = this.currentProjectId;
    if (!pId) { PK.toast('请先打开项目','warning'); return; }

    if (sceneId === null) {
        // 取消绑定：清空 scene_profile_id + 场景相关字段
        try {
            var clearFields = {
                scene_profile_id: null,
                scene_desc: '', emotion: '', lighting: '', weather: '',
                color_grade: '', perspective: '', composition: '',
                environment_detail: '', filter: ''
            };
            var d = await PK.api('/api/seedance/v2/projects/' + pId + '/scenes/' + shotId, {
                method:'PUT', headers:{'Content-Type':'application/json'},
                body: JSON.stringify(clearFields)
            });
            if (d && d.ok) {
                PK.toast('已取消场景模板绑定，字段已清空', 'info');
            }
        } catch(e) {
            PK.toast('暂未取消: ' + (e.detail || e.message), 'error');
        }
    }

    if (sceneId !== null) {
        try {
            var d = await PK.api('/api/scene-composer/scenes/' + sceneId + '/apply-to-shot', {
                method:'PUT', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({shot_id: shotId})
            });
            if (d && d.ok) {
                PK.toast('已加载场景模板: ' + (d.scene_name||'') + ' (' + (d.field_count||0) + ' 字段)', 'success');
            } else {
                PK.toast('加载模板未完成', 'error');
            }
        } catch(e) {
            PK.toast('加载模板异常: ' + (e.detail || e.message), 'error');
        }
    }

    var picker = document.getElementById('sceneProfilePicker');
    if (picker) picker.remove();
    await this.openProject(pId);
    this.compose();
};

})();
