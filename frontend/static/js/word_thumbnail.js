/**
 * word_thumbnail.js — 词卡缩略图/视频管理（覆盖 word_editor.js 同名方法）
 * 缩略图上传/预览/清除 + 视频上传/预览/清除
 */
(function() {
'use strict';
if (!App.wordEditor || App.wordEditor._uploadThumb) return;

// 临时缩略图状态
App.wordEditor._pendingThumbFile = null;
App.wordEditor._pendingThumbSource = null;
App.wordEditor._pendingThumbBlobUrl = null;
App.wordEditor._pendingVideoFile = null;
App.wordEditor._pendingVideoSource = null;
App.wordEditor._pendingVideoBlobUrl = null;

App.wordEditor._uploadThumb = async function(event) {
    var file = (event.target.files||[])[0];
    if (!file) { event.target.value = ''; return; }
    if (!this._cardId) {
        this._pendingThumbFile = file;
        this._pendingThumbSource = null;
        this._pendingThumbBlobUrl = URL.createObjectURL(file);
        this._refreshThumbPreview();
        PK.toast('已选择图片，保存词卡后自动上传', 'success');
        event.target.value = '';
        return;
    }
    var formData = new FormData();
    formData.append('file', file);
    try {
        var resp = await fetch('/api/v4/word-cards/' + this._cardId + '/thumbnail', { method: 'POST', body: formData });
        var d = await resp.json();
        if (d.ok) {
            PK.toast('缩略图上传成功', 'success');
            await this._loadCard();
            try { await App.loadPrompts(); } catch(e) {}
        } else {
            PK.toast('上传未完成: ' + (d.detail || d.error || 'unknown'), 'error');
        }
    } catch(e) { PK.toast('上传遇到问题: ' + e.message, 'error'); }
    event.target.value = '';
};

App.wordEditor._uploadVideo = async function(event) {
    var file = (event.target.files||[])[0];
    if (!file) { event.target.value = ''; return; }
    if (file.size > 50 * 1024 * 1024) { PK.toast('视频不能超过 50MB', 'error'); event.target.value = ''; return; }
    PK.toast('正在上传视频...', 'info');
    if (this._cardId) {
        var formData = new FormData();
        formData.append('file', file);
        try {
            var resp = await fetch('/api/v4/word-cards/' + this._cardId + '/video', { method: 'POST', body: formData });
            var d = await resp.json();
            if (d && d.ok) {
                PK.toast('视频已上传并关联到词卡', 'success');
                await this._loadCard();
                try { await App.loadPrompts(); } catch(e) {}
            } else {
                PK.toast('上传未完成: ' + ((d && (d.detail || d.error)) || '服务器错误'), 'error');
            }
        } catch(e) { PK.toast('上传遇到问题: ' + e.message, 'error'); }
        event.target.value = '';
        return;
    }
    // 新建模式暂存
    this._pendingVideoFile = file;
    this._pendingVideoSource = null;
    this._pendingVideoBlobUrl = URL.createObjectURL(file);
    this._refreshThumbPreview();
    PK.toast('已选择视频，保存词卡后自动上传', 'success');
    event.target.value = '';
};

App.wordEditor._chooseFromThumbLib = function() {
    if (!App.showThumbnailPicker) { PK.toast('缩略图选取器不可用', 'error'); return; }
    App.showThumbnailPicker(null, { onSelect: function(filename) {
        this._pendingThumbFile = null;
        this._pendingThumbSource = filename;
        if (this._pendingThumbBlobUrl) { URL.revokeObjectURL(this._pendingThumbBlobUrl); }
        this._pendingThumbBlobUrl = null;
        this._pendingVideoFile = null;
        this._pendingVideoSource = null;
        if (this._pendingVideoBlobUrl) { URL.revokeObjectURL(this._pendingVideoBlobUrl); }
        this._pendingVideoBlobUrl = null;
        this._refreshThumbPreview();
    }.bind(this)});
};

App.wordEditor._chooseFromVideoLib = function() {
    if (!App.selectVideoThumbnail) { PK.toast('视频选取器不可用', 'error'); return; }
    App.selectVideoThumbnail(function(filename) {
        this._pendingVideoFile = null;
        this._pendingVideoSource = filename;
        if (this._pendingVideoBlobUrl) { URL.revokeObjectURL(this._pendingVideoBlobUrl); }
        this._pendingVideoBlobUrl = null;
        this._pendingThumbFile = null;
        this._pendingThumbSource = null;
        if (this._pendingThumbBlobUrl) { URL.revokeObjectURL(this._pendingThumbBlobUrl); }
        this._pendingThumbBlobUrl = null;
        this._refreshThumbPreview();
    }.bind(this));
};

App.wordEditor._clearPendingMedia = function() {
    this._pendingThumbFile = null;
    if (this._pendingThumbBlobUrl) { URL.revokeObjectURL(this._pendingThumbBlobUrl); }
    this._pendingThumbBlobUrl = null;
    this._pendingThumbSource = null;
    this._pendingVideoFile = null;
    if (this._pendingVideoBlobUrl) { URL.revokeObjectURL(this._pendingVideoBlobUrl); }
    this._pendingVideoBlobUrl = null;
    this._pendingVideoSource = null;
    this._refreshThumbPreview();
    PK.toast('已清除媒体', 'info');
};

App.wordEditor._refreshThumbPreview = function() {
    var area = document.getElementById('wcEditThumbArea');
    var thumbName = document.getElementById('wcEditThumbName');
    var clearBtn = document.getElementById('wcEditClearMediaBtn');
    if (this._pendingVideoBlobUrl || this._pendingVideoFile || this._pendingVideoSource) {
        var videoSrc = this._pendingVideoBlobUrl || '/api/thumbnail/' + this._pendingVideoSource;
        if (area) { area.innerHTML = '<video id="wcEditThumbPreview" src="' + videoSrc + '" muted loop playsinline style="max-width:100%;max-height:120px;border-radius:6px;"></video>'; }
        if (thumbName) thumbName.textContent = '\ud83c\udfac ' + (
            this._pendingVideoSource ? this._pendingVideoSource.substring(0, 25) :
            (this._pendingVideoFile ? this._pendingVideoFile.name.substring(0, 25) : '待上传视频'));
        if (clearBtn) clearBtn.style.display = 'inline-block';
    } else if (this._pendingThumbBlobUrl || this._pendingThumbFile || this._pendingThumbSource) {
        if (area) {
            area.innerHTML = '<img id="wcEditThumbPreview" src="' + (this._pendingThumbBlobUrl || '/api/thumbnail/' + this._pendingThumbSource) + '" style="max-width:100%;max-height:120px;border-radius:6px;object-fit:cover;">';
        }
        if (thumbName) thumbName.textContent = this._pendingThumbSource
            ? this._pendingThumbSource.substring(0, 25)
            : (this._pendingThumbFile ? this._pendingThumbFile.name.substring(0, 25) : '待上传');
        if (clearBtn) clearBtn.style.display = 'inline-block';
    } else if (!this._cardId) {
        if (area) area.innerHTML = '<span style="font-size:28px;color:var(--text-muted);">\ud83e\uddea</span>';
        if (thumbName) thumbName.textContent = '\u672a\u8bbe\u7f6e';
        if (clearBtn) clearBtn.style.display = 'none';
    }
};

console.log('[PK] word_thumbnail loaded');
})();
