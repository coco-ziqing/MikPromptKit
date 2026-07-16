/**
 * app_media_viewer.js — 媒体查看器模块（从 app_media.js 拆出）
 * 原图查看器(滚轮缩放+拖拽移动) + 视频查看器(逐帧控制) + 缩略图关联
 * 加载后自动覆盖 app_media.js 中的同名方法
 */
(function() {
'use strict';
if (!App || App.openImageViewer) return;

Object.assign(App, {

    // ============ 原图查看器(滚轮缩放 + 拖拽移动) ============

    openImageViewer(filename, promptId) {
        var modal = document.getElementById('modalImageViewer');
        var container = document.getElementById('imageViewerContainer');
        var img = document.getElementById('imageViewerImg');

        if (!filename) { PK.toast('暂无原图', 'warning'); return; }

        modal.style.display = 'flex';

        modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };

        // 加载新图片
        img.src = '/api/media/image/' + filename + '?t=' + Date.now();
        img.style.transform = 'scale(1) translate(0,0)';
        img.style.cursor = 'grab';

        // 重置拖拽状态
        img._isDragging = false;
        img._startX = 0;
        img._startY = 0;
        img._translateX = 0;
        img._translateY = 0;
        img._scale = 1;

        // 滚轮缩放
        img.onwheel = function(e) {
            e.preventDefault();
            var delta = e.deltaY > 0 ? 0.9 : 1.1;
            img._scale = Math.max(0.2, Math.min(10, (img._scale || 1) * delta));
            img.style.transform = 'scale(' + img._scale + ') translate(' + (img._translateX || 0) + 'px,' + (img._translateY || 0) + 'px)';
        };

        // 鼠标拖拽
        img.onmousedown = function(e) {
            if (e.button !== 0) return;
            img._isDragging = true;
            img._startX = e.clientX - (img._translateX || 0);
            img._startY = e.clientY - (img._translateY || 0);
            img.style.cursor = 'grabbing';
        };

        document.onmousemove = function(e) {
            if (!img._isDragging) return;
            img._translateX = e.clientX - img._startX;
            img._translateY = e.clientY - img._startY;
            img.style.transform = 'scale(' + (img._scale || 1) + ') translate(' + img._translateX + 'px,' + img._translateY + 'px)';
        };

        document.onmouseup = function() {
            img._isDragging = false;
            img.style.cursor = 'grab';
        };

        // 键盘 ESC 关闭
        document.onkeydown = function(e) {
            if (e.key === 'Escape') { modal.style.display = 'none'; document.onkeydown = null; }
        };
    },

    // ============ 视频查看器(逐帧控制) ============

    openVideoViewer(filename, promptId) {
        var modal = document.getElementById('modalVideoViewer');
        if (!filename) { PK.toast('暂无视频', 'warning'); return; }

        var container = document.getElementById('videoViewerContainer');
        var video = document.getElementById('videoViewerVideo');
        if (!video) return;

        modal.style.display = 'flex';
        modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };

        video.src = '/api/media/video/' + filename + '?t=' + Date.now();
        video.load();

        // 初始化帧控制
        var frameInfo = document.getElementById('videoFrameInfo');
        var frameSlider = document.getElementById('videoFrameSlider');
        if (frameSlider) {
            frameSlider.value = 0;
            frameSlider.oninput = function() {
                if (video.duration) {
                    var t = parseFloat(this.value) / 100 * video.duration;
                    video.currentTime = t;
                    if (frameInfo) frameInfo.textContent = '帧 ' + Math.round(t * video.duration) + '/' + Math.round(video.duration);
                }
            };
        }

        // 键盘：空格切换播放，左右方向逐帧
        var kHandler = function(e) {
            if (e.key === 'Escape') { modal.style.display = 'none'; document.removeEventListener('keydown', kHandler); }
            if (e.key === ' ') { e.preventDefault(); if (video.paused) video.play(); else video.pause(); }
            if (e.key === 'ArrowRight' && video.duration) {
                video.currentTime = Math.min(video.duration, video.currentTime + 1/24);
            }
            if (e.key === 'ArrowLeft' && video.duration) {
                video.currentTime = Math.max(0, video.currentTime - 1/24);
            }
        };
        document.addEventListener('keydown', kHandler);
    },

    // ============ 缩略图关联（从查看器中勾选收藏/关联）============

    async _toggleViewerCollect(cid, pid, checkbox) {
        try {
            var d = await PK.json('/api/v2/collections/toggle', { card_id: cid, prompt_id: pid });
            if (d && d.ok) {
                checkbox.checked = d.collected;
                checkbox.nextElementSibling.textContent = d.collected ? '\u2b50' : '\u2606';
            }
        } catch (e) {
            PK.toast('操作失败', 'error');
        }
    },

    async _loadViewerCollections(prefix, pid, collDiv) {
        try {
            var d = await PK.json('/api/v2/collections/list', { prompt_id: pid });
            if (d && d.collections) {
                collDiv.innerHTML = '';
                for (var c of d.collections) {
                    var cb = document.createElement('input');
                    cb.type = 'checkbox'; cb.id = prefix + c.id;
                    cb.checked = c.collected;
                    cb.onchange = this._toggleViewerCollect.bind(this, c.id, pid, cb);
                    var lb = document.createElement('label');
                    lb.htmlFor = prefix + c.id;
                    lb.textContent = c.name + ' ' + (c.collected ? '\u2b50' : '\u2606');
                    collDiv.appendChild(cb); collDiv.appendChild(lb);
                    collDiv.appendChild(document.createElement('br'));
                }
            }
        } catch (e) {
            collDiv.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">加载失败</span>';
        }
    },

}); // end Object.assign
console.log('[PK] app_media_viewer loaded');
})();
