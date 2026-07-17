/**
 * seedance_output.js — Seedance V2 输出/审阅/模型匹配（从 seedance_v2_composer.js 拆出）
 * 职责：镜头文本审阅 v2 + AI 模型匹配 + 输出复制
 */
(function() {
'use strict';
if (!App.seedanceV2 || App.seedanceV2.openSceneReview) return;

var S = App.seedanceV2;

// ============ 镜头文本审阅 v2 — 多镜头+时间线+拖拽排序 ============
S._srStartIdx = 0;
S._srShowCount = 1;
S._srDragData = null;

S.openSceneReview = function(sceneId) {
    var idx = -1;
    for (var i = 0; i < this.scenes.length; i++) {
        if (this.scenes[i].id === sceneId) { idx = i; break; }
    }
    if (idx < 0) { App.showToast('未找到该镜头', 'error'); return; }
    this._srStartIdx = Math.max(0, idx - Math.floor(this._srShowCount / 2));
    var modal = document.getElementById('sceneReviewModal');
    if (modal) modal.style.display = 'block';
    this._renderSrTimeline();
    this._renderSrShots();
};

S._renderSrTimeline = function() {
    var c = document.getElementById('srTimeline');
    if (!c) return;
    var start = this._srStartIdx;
    var end = Math.min(start + this._srShowCount, this.scenes.length);
    var html = '';
    for (var i = start; i < end; i++) {
        var sc = this.scenes[i];
        var idx = document.getElementById('srShotIdx') ? parseInt(document.getElementById('srShotIdx').value) : 0;
        var isActive = sc.id === (this.scenes[i] && this.scenes[i].id || 0);
        html += '<div class="sr-tick" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid ' + (isActive ? '#6366f1' : 'var(--border-color)') + ';border-radius:6px;cursor:pointer;" onclick="App.seedanceV2._srJumpTo(' + i + ')">';
        html += '<span style="font-size:11px;">#' + (i + 1) + '</span>';
        html += '<span style="font-size:9px;color:var(--text-muted);">' + App._escape(sc.scene_desc || sc.subject || '...').substring(0,15) + '</span>';
        html += '</div>';
    }
    c.innerHTML = html;
};

S._syncSrTicks = function() { this._renderSrTimeline(); };

S._srJumpTo = function(idx) {
    this._srStartIdx = Math.max(0, idx - Math.floor(this._srShowCount / 2));
    this._renderSrTimeline();
    this._renderSrShots();
};

S._onSrShowCountChange = function() {
    var inp = document.getElementById('srShowCount');
    if (inp) this._srShowCount = parseInt(inp.value) || 1;
    this._renderSrTimeline();
    this._renderSrShots();
};

S._srPrevPage = function() {
    this._srStartIdx = Math.max(0, this._srStartIdx - this._srShowCount);
    this._renderSrTimeline();
    this._renderSrShots();
};

S._srNextPage = function() {
    this._srStartIdx = Math.min(this.scenes.length - 1, this._srStartIdx + this._srShowCount);
    this._renderSrTimeline();
    this._renderSrShots();
};

S._renderSrShots = function() {
    var c = document.getElementById('srShots');
    if (!c) return;
    var sc = this.scenes[this._srStartIdx] || this.scenes[0];
    if (!sc) { c.innerHTML = '<div>暂无镜头</div>'; return; }
    var html = '';
    var fields = ['scene_desc', 'subject', 'composition', 'lighting', 'action', 'focal_length', 'texture', 'emotion', 'color_grade', 'weather', 'particles', 'filter', 'environment_detail'];
    for (var f = 0; f < fields.length; f++) {
        var k = fields[f];
        var v = sc[k] || '';
        if (!v) continue;
        var label = (this._F && this._F[k]) || k;
        html += '<div style="margin-bottom:6px;"><span style="font-size:11px;color:var(--text-muted);font-weight:600;">' + label + ':</span> ';
        html += '<span style="font-size:12px;">' + App._escape(v.substring(0,500)) + '</span></div>';
    }
    c.innerHTML = html;
};

S.closeSceneReview = function() {
    var modal = document.getElementById('sceneReviewModal');
    if (modal) modal.style.display = 'none';
};

S.copySceneReview = function() {
    var sc = this.scenes[this._srStartIdx] || this.scenes[0];
    if (!sc) { App.showToast('无镜头数据', 'warning'); return; }
    var lines = [];
    var fields = ['scene_desc', 'subject', 'composition', 'lighting', 'action', 'focal_length', 'texture', 'emotion', 'color_grade', 'weather', 'particles', 'filter', 'environment_detail'];
    for (var f = 0; f < fields.length; f++) {
        var k = fields[f];
        var v = sc[k] || '';
        if (!v) continue;
        var label = (this._F && this._F[k]) || k;
        lines.push(label + ': ' + v);
    }
    var text = lines.join('\n');
    navigator.clipboard.writeText(text).then(function() {
        App.showToast('已复制当前镜头文本', 'success');
    }).catch(function() {
        App.showToast('复制未完成', 'error');
    });
};

S._toggleAudioSection = function() {
    var el = document.getElementById('srAudioSection');
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

// ============ 输出复制 ============
S.copyText = function() {
    var el = document.getElementById('s2Output');
    if (!el || !el.value) { App.showToast('无输出可复制', 'warning'); return; }
    navigator.clipboard.writeText(el.value).then(function() { App.showToast('提示词已复制', 'success'); });
};

S.copyJSON = function() {
    var obj = this.outputJson;
    if (!obj || !Object.keys(obj).length) { App.showToast('无数据可复制', 'warning'); return; }
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).then(function() { App.showToast('JSON已复制', 'success'); });
};

S.copyLibTV = function() {
    var t = this.outputText || '';
    if (!t) { App.showToast('无输出可复制', 'warning'); return; }
    window.open('https://libtv.ai/create?prompt=' + encodeURIComponent(t), '_blank');
};

// ============ 清除镜头所有字段 ============
S.clearScene = function(sceneId) {
    var sc = null;
    for (var i = 0; i < this.scenes.length; i++) {
        if (this.scenes[i].id === sceneId) { sc = this.scenes[i]; break; }
    }
    if (!sc) { App.showToast('未找到镜头', 'error'); return; }
    var p = document.getElementById('s2ClearPop'); if (p) p.style.display = 'none';
    // 恢复初始空镜头：保留 id/start_time/end_time/duration/is_locked/is_manual/audio_enabled
    var keep = ['id','project_id','scene_order','start_time','end_time','duration','is_manual','is_locked','audio_enabled','character_id','scene_profile_id'];
    for (var k in sc) {
        if (sc.hasOwnProperty(k) && keep.indexOf(k) < 0) {
            sc[k] = '';
        }
    }
    App.showToast('镜头已恢复初始状态', 'success');
    this.setDirty();
    this.compose();
};

// ============ 智能模型匹配 ============
S.matchModel = async function() {
    var t = this.outputText || '';
    if (!t) { App.showToast('请先组装提示词，输出预览非空后即可匹配', 'warning'); return; }
    var p = this.currentProject || {};
    var ar = p.aspect_ratio || '16:9';
    var res = p.resolution || '4K';
    var dur = p.total_duration || 15;
    App.showToast('AI 正在分析提示词结构...', 'info');
    try {
        var d = await App.fetchJSON('/api/v4/atoms/match-model', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ prompt: t, aspect_ratio: ar, resolution: res, duration: Number(dur), shot_count: this.scenes.length })
        });
        if (d && d.ok) {
            var html = '<div class="s2-match-result">';
            html += '<div style="font-weight:600;margin-bottom:8px;">推荐模型: ' + App._escape(d.model || '未识别') + '</div>';
            if (d.confidence) html += '<div style="font-size:12px;color:var(--text-muted);">置信度: ' + d.confidence + '%</div>';
            if (d.suggestions && d.suggestions.length) {
                html += '<div style="margin-top:8px;font-size:12px;">优化建议:</div><ul>';
                for (var i = 0; i < d.suggestions.length; i++) {
                    html += '<li style="font-size:11px;">' + App._escape(d.suggestions[i]) + '</li>';
                }
                html += '</ul>';
            }
            html += '</div>';
            var me = document.getElementById('s2MatchResult');
            if (me) { me.innerHTML = html; me.style.display = 'block'; }
            App.showToast('匹配完成', 'success');
        } else {
            App.showToast('匹配未完成: ' + (d.error || '未能解析'), 'error');
        }
    } catch (e) {
        App.showToast('匹配异常: ' + (e.detail || e.message), 'error');
    }
};

console.log('[PK] seedance_output loaded');
})();
