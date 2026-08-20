// ================================================================
// v5.46.30: 缩略图重设 — 查看原图窗口手动定位关键部分，裁切替换词卡缩略图
// 解决自动填充中心裁切把关键部分裁出画外的问题
// 交互：拖动图片移动 / 滚轮缩放 → 3:2 取景框 → canvas 裁切 → 上传替换
// ================================================================
(function () {
    'use strict';
    if (!App) return;

    var S = null; // 状态

    App.openThumbCrop = function () {
        var cardId = App._viewerCardId || 0;
        var imgEl = document.getElementById('imageViewerImg');
        var srcUrl = (imgEl && imgEl.src && imgEl.src.indexOf('http') === 0) ? imgEl.src : '';
        if (!cardId) { App.showToast('无法获取当前词卡', 'error'); return; }
        if (!srcUrl) { App.showToast('当前无原图可裁切', 'error'); return; }
        if (document.getElementById('thumbCropOverlay')) { App.showToast('裁切窗口已打开', 'info'); return; }
        _open(cardId, srcUrl);
    };

    App.closeThumbCrop = function () {
        var ov = document.getElementById('thumbCropOverlay');
        if (ov) ov.remove();
        S = null;
    };

    App.thumbCropZoom = function (d) {
        if (!S) return;
        if (d === 0) { _fit(); return; }
        S.scale *= d > 0 ? 1.2 : 1 / 1.2;
        _clamp();
        _apply();
    };

    App.thumbCropReset = function () {
        if (!S) return;
        S.scale = S.fitScale;
        S.ox = S.boxX;
        S.oy = S.boxY;
        _clamp();
        _apply();
    };

    App.thumbCropSave = function () {
        if (!S) return;
        var btn = document.getElementById('thumbCropSave');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中…'; }
        var sx = (S.boxX - S.ox) / S.scale;
        var sy = (S.boxY - S.oy) / S.scale;
        var sw = S.boxW / S.scale;
        var sh = S.boxH / S.scale;
        var cv = document.createElement('canvas');
        cv.width = 320; cv.height = 213;
        var ctx = cv.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        try {
            ctx.drawImage(S.img, sx, sy, sw, sh, 0, 0, 320, 213);
        } catch (e) {
            if (btn) { btn.disabled = false; btn.textContent = '✅ 生成新缩略图'; }
            App.showToast('裁切失败: ' + e.message, 'error');
            return;
        }
        cv.toBlob(function (blob) {
            if (!blob) {
                if (btn) { btn.disabled = false; btn.textContent = '✅ 生成新缩略图'; }
                App.showToast('图片生成失败', 'error');
                return;
            }
            var fd = new FormData();
            fd.append('file', blob, 'crop.jpg');
            fd.append('keep_original', '1');  // v5.46.33: 仅替换缩略图，保留原始原图（查看原图不受影响）
            fetch('/api/v4/word-cards/' + S.cardId + '/thumbnail', { method: 'POST', body: fd })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d && d.ok) {
                        var cid = S.cardId;          // 先取再关（closeThumbCrop 会置空 S）
                        App.closeThumbCrop();
                        App.showToast('✅ 缩略图已更新', 'success');
                        _refreshView(cid);
                    } else {
                        if (btn) { btn.disabled = false; btn.textContent = '✅ 生成新缩略图'; }
                        App.showToast((d && d.detail) || '更新失败', 'error');
                    }
                })
                .catch(function () {
                    if (btn) { btn.disabled = false; btn.textContent = '✅ 生成新缩略图'; }
                    App.showToast('更新失败', 'error');
                });
        }, 'image/jpeg', 0.9);
    };

    function _refreshView(cardId) {
        // 延迟执行：等后端落盘后再重拉列表，避免读到旧缩略图
        setTimeout(function () {
            try { if (typeof App.loadPrompts === 'function') App.loadPrompts(); } catch (e) {}
            try {
                if (App.collections && typeof App.collections.loadCollectionItems === 'function') App.collections.loadCollectionItems();
            } catch (e) {}
            try { if (typeof App.refreshPrompts === 'function') App.refreshPrompts(); } catch (e) {}
        }, 300);
    }

    function _open(cardId, srcUrl) {
        var ov = document.createElement('div');
        ov.className = 'modal-overlay';
        ov.id = 'thumbCropOverlay';
        ov.style.zIndex = 3500;
        ov.innerHTML =
            '<div style="background:var(--bg-card);color:var(--text);border-radius:14px;width:min(880px,92vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border-color);">' +
            '<b>🖼 重设缩略图</b>' +
            '<span style="font-size:11px;color:var(--text-muted);">拖动图片移动 · 滚轮缩放 · 让关键部分进入蓝色取景框（3:2）</span>' +
            '<button onclick="App.closeThumbCrop()" style="border:none;background:none;font-size:18px;color:var(--text-muted);cursor:pointer;">✕</button>' +
            '</div>' +
            '<div id="thumbCropStage" style="position:relative;flex:1;min-height:400px;background:#0f172a;overflow:hidden;cursor:grab;user-select:none;touch-action:none;">' +
            '<img id="thumbCropImg" src="" style="position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;pointer-events:none;">' +
            '<div id="thumbCropBox" style="position:absolute;border:2px solid #6366f1;box-shadow:0 0 0 9999px rgba(0,0,0,.55);pointer-events:none;"></div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--border-color);flex-wrap:wrap;">' +
            '<button class="btn btn-sm btn-secondary" onclick="App.thumbCropZoom(0)">🔍 适应</button>' +
            '<button class="btn btn-sm btn-secondary" onclick="App.thumbCropZoom(1)">＋ 放大</button>' +
            '<button class="btn btn-sm btn-secondary" onclick="App.thumbCropZoom(-1)">－ 缩小</button>' +
            '<button class="btn btn-sm btn-secondary" onclick="App.thumbCropReset()">↺ 重置</button>' +
            '<span style="font-size:11px;color:var(--text-muted);">目标 320×213</span>' +
            '<span style="flex:1;"></span>' +
            '<button class="btn btn-sm btn-secondary" onclick="App.closeThumbCrop()">取消</button>' +
            '<button class="btn btn-sm btn-primary" id="thumbCropSave" onclick="App.thumbCropSave()">✅ 生成新缩略图</button>' +
            '</div></div>';
        document.body.appendChild(ov);

        var stage = document.getElementById('thumbCropStage');
        var box = document.getElementById('thumbCropBox');
        var img = document.getElementById('thumbCropImg');
        var sw = stage.clientWidth, sh = stage.clientHeight;
        // 3:2 取景框（约 90% 画布，适配比例）
        var boxW, boxH;
        if (sw * 2 / 3 <= sh * 0.9) { boxW = sw * 0.9; boxH = boxW * 2 / 3; }
        else { boxH = sh * 0.9; boxW = boxH * 3 / 2; }
        box.style.left = ((sw - boxW) / 2) + 'px';
        box.style.top = ((sh - boxH) / 2) + 'px';
        box.style.width = boxW + 'px';
        box.style.height = boxH + 'px';

        S = {
            cardId: cardId, srcUrl: srcUrl, img: img, stage: stage, box: box,
            scale: 1, ox: 0, oy: 0, iw: 0, ih: 0,
            boxX: (sw - boxW) / 2, boxY: (sh - boxH) / 2, boxW: boxW, boxH: boxH,
            fitScale: 1
        };

        img.onload = function () {
            S.iw = img.naturalWidth || img.width;
            S.ih = img.naturalHeight || img.height;
            _fit();
        };
        img.src = srcUrl;

        // 拖拽移动图片
        var drag = null;
        stage.addEventListener('pointerdown', function (e) {
            drag = { sx: e.clientX, sy: e.clientY, ox: S.ox, oy: S.oy };
            stage.style.cursor = 'grabbing';
            try { stage.setPointerCapture(e.pointerId); } catch (err) {}
        });
        stage.addEventListener('pointermove', function (e) {
            if (!drag) return;
            S.ox = drag.ox + (e.clientX - drag.sx);
            S.oy = drag.oy + (e.clientY - drag.sy);
            _clamp();
            _apply();
        });
        var endDrag = function () { drag = null; stage.style.cursor = 'grab'; };
        stage.addEventListener('pointerup', endDrag);
        stage.addEventListener('pointercancel', endDrag);
        // 滚轮缩放（以取景框中心为锚）
        stage.addEventListener('wheel', function (e) {
            e.preventDefault();
            var cx = S.boxX + S.boxW / 2, cy = S.boxY + S.boxH / 2;
            var px = (cx - S.ox) / S.scale, py = (cy - S.oy) / S.scale;
            S.scale *= (e.deltaY < 0 ? 1.15 : 1 / 1.15);
            S.ox = cx - px * S.scale;
            S.oy = cy - py * S.scale;
            _clamp();
            _apply();
        }, { passive: false });
    }

    function _fit() {
        if (!S || !S.iw) return;
        var sw = S.stage.clientWidth, sh = S.stage.clientHeight;
        var s = Math.min(sw / S.iw, sh / S.ih) * 0.98;
        S.fitScale = s;
        S.scale = s;
        S.ox = (sw - S.iw * s) / 2;
        S.oy = (sh - S.ih * s) / 2;
        _clamp();
        _apply();
    }

    function _clamp() {
        if (!S || !S.iw) return;
        // 图片必须覆盖取景框
        var minS = Math.max(S.boxW / S.iw, S.boxH / S.ih);
        if (S.scale < minS) S.scale = minS;
        var rw = S.iw * S.scale, rh = S.ih * S.scale;
        S.ox = Math.min(S.boxX, Math.max(S.boxX + S.boxW - rw, S.ox));
        S.oy = Math.min(S.boxY, Math.max(S.boxY + S.boxH - rh, S.oy));
    }

    function _apply() {
        if (!S) return;
        S.img.style.transform = 'translate(' + S.ox + 'px,' + S.oy + 'px) scale(' + S.scale + ')';
    }
})();
