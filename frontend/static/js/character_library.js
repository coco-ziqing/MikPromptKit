// ============================================================
// v4.0.0-phase10.1: Character Library JS Module
// v4.0.0-phase10.2: Image crop before upload
// 角色库管理 + 镜头角色选择器
// ============================================================

(function() {
'use strict';

App.characterLib = {
    _cache: [],    // [{character}]
    _listHTML: '',
    _activeCharId: null,
    _modalOpen: false,
};

// ========== 1. 面板入口 ==========

App.characterLib.openManager = async function() {
    await this.loadList();
    this._showModal();
};

App.characterLib.loadList = async function(search) {
    var params = '?page_size=200';
    if (search) params += '&search=' + encodeURIComponent(search);
    var d = await App.fetchJSON('/api/characters' + params);
    if (d && d.items) this._cache = d.items;
};

App.characterLib._showModal = function() {
    var self = this;
    var overlay = document.getElementById('charLibModal');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'charLibModal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:600;';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var h = '<div class="modal-content char-lib-modal" style="max-width:900px;width:95%;max-height:90vh;overflow-y:auto;border-radius:14px;padding:0;">';
    h += '<div class="char-lib-header" style="position:sticky;top:0;z-index:10;background:var(--bg-card);border-bottom:1px solid var(--border-color);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">';
    h += '<h5 style="margin:0;font-size:18px;">🎭 角色库</h5>';
    h += '<div style="display:flex;gap:8px;">';
    h += '<input class="s2-input" id="charLibSearch" placeholder="搜索角色..." style="font-size:12px;padding:4px 10px;width:180px;" oninput="App.characterLib._filterList()">';
    h += '<button class="btn btn-sm btn-primary" onclick="App.characterLib._openEditor()">+ 新建角色</button>';
    h += '<button class="btn btn-sm btn-outline" onclick="document.getElementById(\'charLibModal\').remove()">✕</button>';
    h += '</div></div>';

    h += '<div id="charLibList" style="padding:16px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">';
    h += this._renderList();
    h += '</div>';

    h += '</div>';
    overlay.innerHTML = h;
    document.body.appendChild(overlay);
};

App.characterLib._renderList = function() {
    var chars = this._cache;
    if (!chars.length) return '<div class="s2-empty" style="grid-column:1/-1;padding:30px;">暂无角色，点击「新建角色」创建</div>';
    var h = '';
    for (var i = 0; i < chars.length; i++) {
        var c = chars[i];
        var avatarTag = c.avatar
            ? '<img src="/api/characters/images/' + c.avatar + '" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid var(--border-color);">'
            : '<div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700;">'+App._escape((c.name||'?').charAt(0))+'</div>';
        var tags = '';
        try { var tl = JSON.parse(c.tags||'[]'); if(tl.length) tags = tl.slice(0,3).map(function(t){return '<span class="s2-chip-label" style="background:rgba(139,92,246,0.1);color:#7c3aed;padding:1px 6px;border-radius:3px;font-size:9px;">'+App._escape(t)+'</span>';}).join(' '); } catch(e){}

        h += '<div class="char-card" style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:12px;cursor:pointer;transition:0.12s;display:flex;gap:10px;align-items:flex-start;" onclick="App.characterLib._viewProfile('+c.id+')" onmouseover="this.style.borderColor=\'#8b5cf6\';this.style.boxShadow=\'0 2px 12px rgba(139,92,246,0.12)\';" onmouseout="this.style.borderColor=\'var(--border-color)\';this.style.boxShadow=\'none\';">';
        h += '<div style="flex-shrink:0;">' + avatarTag + '</div>';
        h += '<div style="flex:1;min-width:0;">';
        h += '<div style="font-weight:700;font-size:14px;color:var(--text-main);">'+App._escape(c.name)+'</div>';
        h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">'+(c.gender||'')+' · '+(c.age_range||'')+' · '+(c.occupation||'')+'</div>';
        h += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(c.voice_type||'')+' | '+(c.narration_style||'')+'</div>';
        h += '<div style="margin-top:4px;">'+tags+'</div>';
        if(c.is_builtin) h += '<span style="font-size:9px;color:#8b5cf6;background:rgba(139,92,246,0.08);padding:1px 5px;border-radius:3px;margin-top:3px;display:inline-block;">内置</span>';
        h += '</div></div>';
    }
    return h;
};

App.characterLib._filterList = function() {
    var q = (document.getElementById('charLibSearch')?.value || '').toLowerCase();
    var list = document.getElementById('charLibList');
    if (!list) return;
    var cards = list.querySelectorAll('.char-card');
    for (var i = 0; i < cards.length; i++) {
        var text = (cards[i].textContent || '').toLowerCase();
        cards[i].style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
    }
};

// ========== 2. 角色档案查看器 ==========

App.characterLib._viewProfile = async function(charId) {
    var d = await App.fetchJSON('/api/characters/' + charId);
    if (!d || !d.character) return;
    var c = d.character;
    var images = c.images || [];

    // Build overlay
    var old = document.getElementById('charProfileModal');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'charProfileModal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:650;';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var avatarURL = c.avatar ? '/api/characters/images/' + c.avatar : '';
    var previewURL = c.preview_image ? '/api/characters/images/' + c.preview_image : '';

    var h = '<div class="modal-content char-profile-modal" style="max-width:800px;width:95%;max-height:90vh;overflow-y:auto;border-radius:14px;padding:0;">';

    // Header
    h += '<div style="position:sticky;top:0;z-index:10;background:var(--bg-card);border-bottom:1px solid var(--border-color);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">';
    h += '<h5 style="margin:0;font-size:18px;">📋 ' + App._escape(c.name) + ' 档案</h5>';
    h += '<div style="display:flex;gap:6px;">';
    h += '<button class="btn btn-sm btn-primary" onclick="App.characterLib._openEditor('+c.id+')">✏️ 编辑</button>';
    if (!c.is_builtin) {
        h += '<button class="btn btn-sm btn-outline-danger" onclick="if(confirm(\'删除 ' + App._escape(c.name) + '?\'))App.characterLib._deleteChar('+c.id+')">🗑</button>';
    }
    h += '<button class="btn btn-sm btn-outline" onclick="document.getElementById(\'charProfileModal\').remove()">✕</button>';
    h += '</div></div>';

    // Body: 2-column layout
    h += '<div style="display:flex;gap:20px;padding:16px 20px;flex-wrap:wrap;">';
    // Left: avatar + preview
    h += '<div style="flex-shrink:0;width:200px;">';
    if (previewURL) {
        h += '<div style="margin-bottom:10px;border-radius:8px;overflow:hidden;border:1px solid var(--border-color);">';
        h += '<img src="'+previewURL+'" style="width:100%;display:block;cursor:pointer;" onclick="App.characterLib._openFullImage(\''+previewURL+'\')" title="角色设定预览图（点击放大）">';
        h += '<div style="font-size:9px;color:var(--text-muted);text-align:center;padding:3px;">角色设定预览</div></div>';
    }
    if (avatarURL && avatarURL !== previewURL) {
        h += '<div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;">';
        h += '<img src="'+avatarURL+'" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--border-color);">';
        h += '<span style="font-size:11px;color:var(--text-muted);">角色头像</span></div>';
    }
    // Reference images
    if (images.length) {
        h += '<div style="font-size:11px;font-weight:600;color:var(--text-main);margin-bottom:4px;">参考图 ('+images.length+')</div>';
        h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">';
        for (var ii = 0; ii < images.length; ii++) {
            var img = images[ii];
            h += '<img src="/api/characters/images/'+img.filename+'" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid var(--border-color);" onclick="App.characterLib._openFullImage(\'/api/characters/images/'+img.filename+'\')" title="'+(img.caption||img.image_type)+'">';
        }
        h += '</div>';
    }
    h += '</div>';

    // Right: info fields
    h += '<div style="flex:1;min-width:280px;font-size:13px;">';
    var infoFields = [
        ['性别', c.gender], ['年龄段', c.age_range], ['职业', c.occupation],
        ['角色定位', c.role_position], ['声线类型', c.voice_type],
        ['声音细节', c.voice_detail], ['旁白风格', c.narration_style],
        ['性格', c.personality]
    ];
    for (var fi = 0; fi < infoFields.length; fi++) {
        var label = infoFields[fi][0], val = infoFields[fi][1];
        if (!val) continue;
        h += '<div style="margin-bottom:8px;display:flex;gap:8px;">';
        h += '<span style="font-weight:600;color:var(--text-muted);min-width:60px;">'+label+'</span>';
        h += '<span style="color:var(--text-main);">'+App._escape(val)+'</span></div>';
    }
    // Appearance
    if (c.appearance) {
        h += '<div style="margin-bottom:8px;"><div style="font-weight:600;color:var(--text-muted);margin-bottom:2px;">外貌描述</div>';
        h += '<div style="color:var(--text-main);line-height:1.5;background:var(--hover-bg);padding:8px;border-radius:6px;font-size:12px;">'+App._escape(c.appearance)+'</div></div>';
    }
    // Backstory
    if (c.backstory) {
        h += '<div style="margin-bottom:8px;"><div style="font-weight:600;color:var(--text-muted);margin-bottom:2px;">背景故事</div>';
        h += '<div style="color:var(--text-main);line-height:1.6;background:var(--hover-bg);padding:8px;border-radius:6px;font-size:12px;">'+App._escape(c.backstory)+'</div></div>';
    }
    // Notes
    if (c.notes) {
        h += '<div style="margin-bottom:8px;"><div style="font-weight:600;color:var(--text-muted);margin-bottom:2px;">备注</div>';
        h += '<div style="color:var(--text-main);font-size:12px;">'+App._escape(c.notes)+'</div></div>';
    }
    h += '</div></div>';

    h += '</div>';
    overlay.innerHTML = h;
    document.body.appendChild(overlay);
};

App.characterLib._openFullImage = function(url) {
    var old = document.getElementById('charImgFull');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'charImgFull';
    ov.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    ov.onclick = function() { ov.remove(); };
    ov.innerHTML = '<img src="'+url+'" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;">';
    document.body.appendChild(ov);
};

// ========== 3. 角色编辑弹窗 ==========

App.characterLib._openEditor = async function(charId) {
    var c = null;
    if (charId) {
        var d = await App.fetchJSON('/api/characters/' + charId);
        if (d && d.character) c = d.character;
    }

    var old = document.getElementById('charEditorModal');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'charEditorModal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:670;';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var title = c ? '编辑角色: ' + c.name : '新建角色';
    var h = '<div class="modal-content" style="max-width:700px;width:95%;max-height:90vh;overflow-y:auto;border-radius:14px;padding:24px;">';
    h += '<h5 style="margin:0 0 16px;">'+title+'</h5>';

    // Form fields
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">';
    h += _charField('name','角色名称', c?.name||'', '必填','');
    h += _charField('gender','性别', c?.gender||'', '','男/女/其他');
    h += _charField('age_range','年龄段', c?.age_range||'', '','25-30岁');
    h += _charField('occupation','职业', c?.occupation||'', '','程序员/学生');
    h += _charField('role_position','角色定位', c?.role_position||'', '','主角/反派/配角');
    h += _charField('voice_type','声线类型', c?.voice_type||'', '','年轻男声/低沉磁性');
    h += _charField('voice_detail','声音细节', c?.voice_detail||'', '','语速适中，咬字清楚');
    h += _charField('narration_style','旁白风格', c?.narration_style||'', '','第一人称/纪录片风');
    h += '</div>';

    h += _charField('personality','性格描述', c?.personality||'', '', '多个性格词逗号分隔', 2);
    h += _charTextArea('appearance','外貌描述', c?.appearance||'', '身高体型、发型发色、五官特征、着装风格');
    h += _charTextArea('backstory','背景故事', c?.backstory||'', '角色过去经历、动机、关系网');
    h += _charTextArea('notes','备注', c?.notes||'', '额外注释');

    // Image upload area
    h += '<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">';
    h += '<div>';
    h += '<label style="font-size:11px;color:var(--text-muted);">头像</label>';
    if (c?.avatar) h += '<div style="margin-bottom:4px;"><img src="/api/characters/images/'+c.avatar+'" style="width:48px;height:48px;border-radius:50%;object-fit:cover;"></div>';
    h += '<input type="file" id="charAvatarInput" accept="image/*" style="font-size:11px;max-width:160px;" onchange="App.characterLib._onFileSelect(event,'+(c?.id||0)+',' +"'avatar'"+ ')">';
    h += '</div>';
    h += '<div>';
    h += '<label style="font-size:11px;color:var(--text-muted);">角色设定预览图（多角度图）</label>';
    if (c?.preview_image) h += '<div style="margin-bottom:4px;"><img src="/api/characters/images/'+c.preview_image+'" style="max-width:120px;max-height:80px;border-radius:6px;object-fit:cover;"></div>';
    h += '<input type="file" id="charPreviewInput" accept="image/*" style="font-size:11px;max-width:160px;" onchange="App.characterLib._onFileSelect(event,'+(c?.id||0)+',' +"'preview'"+ ')">';
    h += '</div>';
    h += '</div>';

    // Action buttons
    h += '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">';
    h += '<button class="btn btn-sm btn-outline" onclick="App.characterLib._saveChar('+(c?.id||0)+')">💾 保存</button>';
    h += '<button class="btn btn-sm btn-outline" onclick="document.getElementById(\'charEditorModal\').remove()">取消</button>';
    h += '</div>';

    h += '</div>';
    overlay.innerHTML = h;
    document.body.appendChild(overlay);
};

function _charField(key, label, val, required, placeholder, cols) {
    var w = cols === 2 ? ' style="grid-column:span 2;"' : '';
    return '<div'+w+'><label style="font-size:11px;color:var(--text-muted);margin-bottom:2px;display:block;">'+label+(required?' <span style="color:#ef4444;">*</span>':'')+'</label><input class="s2-input" id="charField_'+key+'" value="'+App._escape(val||'')+'" placeholder="'+placeholder+'" style="font-size:12px;padding:6px 10px;width:100%;box-sizing:border-box;"></div>';
}
function _charTextArea(key, label, val, placeholder) {
    return '<div style="margin-top:8px;"><label style="font-size:11px;color:var(--text-muted);margin-bottom:2px;display:block;">'+label+'</label><textarea class="s2-input" id="charField_'+key+'" placeholder="'+placeholder+'" rows="3" style="font-size:12px;padding:6px 10px;width:100%;box-sizing:border-box;resize:vertical;">'+App._escape(val||'')+'</textarea></div>';
}

App.characterLib._saveChar = async function(charId) {
    var data = {};
    var fields = ['name','gender','age_range','occupation','personality','appearance','voice_type','voice_detail','narration_style','role_position','backstory','notes'];
    for (var i = 0; i < fields.length; i++) {
        var el = document.getElementById('charField_'+fields[i]);
        if (el) data[fields[i]] = el.value.trim();
    }
    if (!data.name) { App.showToast('角色名称必填','warning'); return; }

    var url = '/api/characters';
    var method = 'POST';
    if (charId) { url += '/' + charId; method = 'PUT'; }

    var d = await App.fetchJSON(url, {method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
    if (d && d.ok) {
        document.getElementById('charEditorModal')?.remove();
        App.showToast(charId ? '角色已更新' : '角色已创建', 'success');
        await App.characterLib.loadList();
        App.characterLib._showModal();
    } else {
        App.showToast('保存失败: ' + (d?.detail||'未知错误'), 'error');
    }
};

App.characterLib._deleteChar = async function(charId) {
    var d = await App.fetchJSON('/api/characters/' + charId, {method:'DELETE'});
    if (d && d.ok) {
        document.getElementById('charProfileModal')?.remove();
        App.showToast('角色已删除','info');
        await App.characterLib.loadList();
        App.characterLib._showModal();
    } else {
        App.showToast('删除失败','error');
    }
};

// ========== 3.5 图片裁剪上传 ==========
App.characterLib._cropState = null; // { charId, imageType, file, dataUrl }

App.characterLib._onFileSelect = function(e, charId, imageType) {
    var file = (e.target.files || [])[0];
    if (!file) return;
    e.target.value = ''; // reset so same file re-triggers
    var reader = new FileReader();
    reader.onload = function(ev) {
        App.characterLib._cropState = { charId: charId, imageType: imageType, file: file, dataUrl: ev.target.result };
        App.characterLib._showCropModal();
    };
    reader.readAsDataURL(file);
};

App.characterLib._showCropModal = function() {
    var st = this._cropState;
    if (!st) return;
    var old = document.getElementById('charCropModal');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'charCropModal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:700;';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var label = st.imageType === 'avatar' ? '裁剪头像' : '裁剪预览图';
    var ratioHint = st.imageType === 'avatar' ? '1:1（正方形头像）' : '3:2（横版预览）';
    var arW = st.imageType === 'avatar' ? 1 : 3;
    var arH = st.imageType === 'avatar' ? 1 : 2;

    overlay.innerHTML = '<div class="modal-content" style="max-width:620px;width:95%;border-radius:14px;padding:20px;">'
        + '<h5 style="margin:0 0 4px;">✂️ ' + label + '</h5>'
        + '<p style="font-size:11px;color:var(--text-muted);margin:0 0 12px;">拖动选框调整裁剪区域 · ' + ratioHint + '</p>'
        + '<div id="charCropStage" style="position:relative;overflow:hidden;background:#0f172a;border-radius:8px;width:100%;max-height:420px;user-select:none;">'
        + '<img id="charCropImg" src="' + st.dataUrl + '" style="display:block;max-width:100%;">'
        + '<div id="charCropBox" style="position:absolute;border:2px dashed #fff;box-shadow:0 0 0 9999px rgba(0,0,0,0.55);cursor:move;"></div>'
        + '</div>'
        + '<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">'
        + '<button class="btn btn-sm btn-outline" onclick="document.getElementById(\'charCropModal\').remove()">取消</button>'
        + '<button class="btn btn-sm btn-primary" onclick="App.characterLib._doCropAndUpload()">✂️ 裁剪并上传</button>'
        + '</div></div>';
    document.body.appendChild(overlay);

    var self = this;
    var img = document.getElementById('charCropImg');
    img.onload = function() { self._initCropBox(arW, arH); };
    // already loaded (from dataUrl)
    if (img.complete) self._initCropBox(arW, arH);
};

App.characterLib._initCropBox = function(arW, arH) {
    var img = document.getElementById('charCropImg');
    var box = document.getElementById('charCropBox');
    var stage = document.getElementById('charCropStage');
    if (!img || !box || !stage) return;

    var imgW = img.naturalWidth;
    var imgH = img.naturalHeight;
    var stageW = stage.clientWidth;
    var displayH = stageW * (imgH / imgW);
    stage.style.height = displayH + 'px';

    // initial crop box: 80% of min dimension, centered, maintaining AR
    var boxW, boxH;
    if (stageW / displayH >= arW / arH) {
        // stage is wider → constrain by height
        boxH = displayH * 0.8;
        boxW = boxH * (arW / arH);
    } else {
        // stage is taller → constrain by width
        boxW = stageW * 0.8;
        boxH = boxW * (arH / arW);
    }
    var boxX = (stageW - boxW) / 2;
    var boxY = (displayH - boxH) / 2;

    box.style.left = boxX + 'px';
    box.style.top = boxY + 'px';
    box.style.width = boxW + 'px';
    box.style.height = boxH + 'px';

    this._bindCropDrag(arW, arH);
};

App.characterLib._bindCropDrag = function(arW, arH) {
    var box = document.getElementById('charCropBox');
    var stage = document.getElementById('charCropStage');
    if (!box || !stage) return;

    var dragging = false, startX, startY, startLeft, startTop;
    var self = this;

    var onDown = function(e) {
        e.preventDefault();
        dragging = true;
        var pt = e.touches ? e.touches[0] : e;
        startX = pt.clientX;
        startY = pt.clientY;
        startLeft = parseFloat(box.style.left);
        startTop = parseFloat(box.style.top);
    };

    var onMove = function(e) {
        if (!dragging) return;
        var pt = e.touches ? e.touches[0] : e;
        var dx = pt.clientX - startX;
        var dy = pt.clientY - startY;
        var newLeft = Math.max(0, Math.min(stage.clientWidth - box.offsetWidth, startLeft + dx));
        var newTop = Math.max(0, Math.min(stage.clientHeight - box.offsetHeight, startTop + dy));
        box.style.left = newLeft + 'px';
        box.style.top = newTop + 'px';
    };

    var onUp = function() { dragging = false; };

    box.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    box.addEventListener('touchstart', onDown, {passive:false});
    document.addEventListener('touchmove', onMove, {passive:false});
    document.addEventListener('touchend', onUp);
};

App.characterLib._doCropAndUpload = async function() {
    var st = this._cropState;
    if (!st) return;

    var img = document.getElementById('charCropImg');
    var box = document.getElementById('charCropBox');
    var stage = document.getElementById('charCropStage');
    if (!img || !box || !stage) return;

    // Map display coords → original image coords
    var scaleX = img.naturalWidth / img.clientWidth;
    var scaleY = img.naturalHeight / img.clientHeight;
    var sx = parseFloat(box.style.left) * scaleX;
    var sy = parseFloat(box.style.top) * scaleY;
    var sw = box.offsetWidth * scaleX;
    var sh = box.offsetHeight * scaleY;

    // Canvas crop
    var canvas = document.createElement('canvas');
    // Set output size: avatar=256x256, preview=480x320
    if (st.imageType === 'avatar') {
        canvas.width = 256; canvas.height = 256;
    } else {
        canvas.width = 480; canvas.height = 320;
    }
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    // Convert to blob
    var blob = await new Promise(function(resolve) {
        canvas.toBlob(resolve, 'image/jpeg', 0.85);
    });

    document.getElementById('charCropModal')?.remove();

    // Ensure charId exists
    var charId = st.charId;
    if (!charId) {
        var data = {};
        var fn = document.getElementById('charField_name');
        if (fn && fn.value.trim()) data.name = fn.value.trim();
        else { App.showToast('请先填写角色名称','warning'); return; }
        var d = await App.fetchJSON('/api/characters', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
        if (d && d.ok) {
            charId = d.id;
            document.getElementById('charEditorModal')?.remove();
            App.showToast('角色已创建，正在上传图片...','info');
        } else {
            App.showToast('创建角色失败','error'); return;
        }
    }

    // Upload
    var fd = new FormData();
    fd.append('file', blob, 'crop_' + st.imageType + '.jpg');
    var url = '/api/characters/' + charId + '/images?image_type=' + st.imageType;
    try {
        var r = await fetch(url, {method:'POST', body:fd});
        var d = await r.json();
        if (d && d.ok) {
            App.showToast(st.imageType==='avatar'?'头像已裁剪上传':'预览图已裁剪上传', 'success');
            App.characterLib._openEditor(charId);
        } else {
            App.showToast('上传失败','error');
        }
    } catch(e) {
        App.showToast('上传异常: '+e.message,'error');
    }
    this._cropState = null;
};

// ========== 4. 镜头角色选择器（快捷分配） ==========

App.characterLib.openScenePicker = async function(sceneId) {
    await this.loadList();
    var chars = this._cache;

    var old = document.getElementById('charScenePicker');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'charScenePicker';
    overlay.className = 'modal-overlay s2-popup-overlay';
    overlay.style.cssText = 'display:flex;z-index:600;';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    // Check current scene's character
    var currentCharId = null;
    for (var i = 0; i < App.seedanceV2.scenes.length; i++) {
        if (App.seedanceV2.scenes[i].id === sceneId) {
            currentCharId = App.seedanceV2.scenes[i].character_id || null;
            break;
        }
    }

    var h = '<div class="s2-popup-card" style="max-width:480px;max-height:80vh;overflow-y:auto;padding:20px;border-radius:12px;background:var(--bg-card);">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    h += '<h5 style="margin:0;">🎭 选择出演角色</h5>';
    h += '<div style="display:flex;gap:6px;">';
    h += '<input class="s2-input" id="charPickerSearch" placeholder="搜索..." style="font-size:11px;padding:3px 8px;width:120px;" oninput="App.characterLib._filterSceneList()">';
    h += '<button class="btn btn-xs btn-outline" onclick="App.characterLib.openManager()" title="管理角色库">⚙</button>';
    h += '<button class="btn btn-xs btn-outline" onclick="document.getElementById(\'charScenePicker\').remove()">✕</button>';
    h += '</div></div>';

    // Clear selection option
    if (currentCharId) {
        h += '<div style="margin-bottom:8px;padding:8px;background:var(--danger-bg, rgba(239,68,68,0.06));border:1px solid rgba(239,68,68,0.2);border-radius:6px;cursor:pointer;font-size:13px;color:var(--danger, #ef4444);text-align:center;" onclick="App.characterLib._assignToScene('+sceneId+',null)">✕ 取消角色分配</div>';
    }

    // Character list
    if (!chars.length) {
        h += '<div class="s2-empty" style="padding:20px;">暂无角色，点击 ⚙ 新建</div>';
    } else {
        for (var ci = 0; ci < chars.length; ci++) {
            var c = chars[ci];
            var isAssigned = c.id === currentCharId;
            var selStyle = isAssigned ? 'border-color:#8b5cf6;background:rgba(139,92,246,0.08);' : '';
            var avt = c.avatar
                ? '<img src="/api/characters/images/'+c.avatar+'" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">'
                : '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;">'+App._escape(c.name.charAt(0))+'</div>';
            h += '<div class="char-pick-item" data-char="'+c.id+'" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:6px;cursor:pointer;transition:0.12s;'+selStyle+'" onclick="App.characterLib._assignToScene('+sceneId+','+c.id+')">';
            h += avt;
            h += '<div style="flex:1;min-width:0;">';
            h += '<div style="font-size:13px;font-weight:600;color:var(--text-main);">'+App._escape(c.name)+(isAssigned?' ✅':'')+'</div>';
            h += '<div style="font-size:10px;color:var(--text-muted);">'+(c.voice_type||'')+' · '+(c.narration_style||'')+'</div>';
            h += '</div>';
            h += '</div>';
        }
    }
    h += '</div>';
    overlay.innerHTML = h;
    document.body.appendChild(overlay);

    // Sync shared search input
    setTimeout(function() {
        var s = document.getElementById('charPickerSearch');
        if (s) s.focus();
    }, 100);
};

App.characterLib._filterSceneList = function() {
    var q = (document.getElementById('charPickerSearch')?.value || '').toLowerCase();
    var items = document.querySelectorAll('#charScenePicker .char-pick-item');
    for (var i = 0; i < items.length; i++) {
        var text = (items[i].textContent || '').toLowerCase();
        items[i].style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
    }
};

App.characterLib._assignToScene = async function(sceneId, charId) {
    var pId = App.seedanceV2.currentProjectId;
    if (!pId) { App.showToast('请先打开项目','warning'); return; }

    if (charId === null) {
        // Unassign
        var d = await App.fetchJSON('/api/characters/' + (App.seedanceV2.scenes.find(function(s){return s.id===sceneId;})?.character_id||0) + '/unassign-scene', {
            method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scene_id:sceneId})
        });
    } else {
        var d = await App.fetchJSON('/api/characters/' + charId + '/assign-scene', {
            method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scene_id:sceneId})
        });
        if (d && d.ok) {
            App.showToast('已分配角色: ' + d.character_name, 'success');
            if (d.auto_voice) App.showToast('声线自动注入: ' + d.auto_voice, 'info');
        }
    }

    document.getElementById('charScenePicker')?.remove();
    await App.seedanceV2.openProject(pId);
    App.seedanceV2.compose();
};

})();
