/**
 * app_media_viewer.js — 媒体查看器模块（从 app_media.js 拆出）
 * 原图查看器(滚轮缩放+拖拽移动) + 视频查看器(逐帧控制) + 缩略图关联
 * 加载后自动覆盖 app_media.js 中的同名方法
 */
(function() {
'use strict';
// 覆盖 app_media.js 中同名方法

Object.assign(App, {

    // ============ 原图查看器(滚轮缩放 + 拖拽移动) ============

    openImageViewer(filename, promptId) {
        var modal = document.getElementById('modalImageViewer');
        var container = document.getElementById('imageViewerContainer');
        var img = document.getElementById('imageViewerImg');

        if (!filename) { App.showToast('暂无原图', 'warning'); return; }

        modal.style.display = 'flex';

        // 加载新图片
        img.src = '/api/media/original/' + filename + '?t=' + Date.now();
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        img.style.transform = 'scale(1)';
        img.style.cursor = 'grab';

        // 加载右侧提示词详情
        if (promptId && App._renderViewerRight) {
            App._renderViewerRight('imgViewer', promptId);
        }

        // 重置拖拽状态
        img._isDragging = false;
        img._startX = 0; img._startY = 0;
        img._translateX = 0; img._translateY = 0;
        img._scale = 1;

        // 滚轮缩放
        img.onwheel = function(e) {
            e.preventDefault();
            var delta = e.deltaY > 0 ? 0.9 : 1.1;
            img._scale = Math.max(0.15, Math.min(10, (img._scale || 1) * delta));
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            img.style.transform = 'scale(' + img._scale + ') translate(' + (img._translateX || 0) + 'px,' + (img._translateY || 0) + 'px)';
        };

        // 鼠标拖拽 — 使用 addEventListener 避免被覆盖
        var _mmove = function(e) {
            if (!img._isDragging) return;
            img._translateX = e.clientX - img._startX;
            img._translateY = e.clientY - img._startY;
            img.style.transform = 'scale(' + (img._scale || 1) + ') translate(' + img._translateX + 'px,' + img._translateY + 'px)';
        };
        var _mup = function(e) {
            img._isDragging = false;
            img.style.cursor = 'grab';
        };

        // 移除旧监听器防止重复
        document.removeEventListener('mousemove', img._mmove);
        document.removeEventListener('mouseup', img._mup);
        img._mmove = _mmove;
        img._mup = _mup;
        document.addEventListener('mousemove', _mmove);
        document.addEventListener('mouseup', _mup);

        img.onmousedown = function(e) {
            if (e.button !== 0) return;
            img._isDragging = true;
            img._startX = e.clientX - (img._translateX || 0);
            img._startY = e.clientY - (img._translateY || 0);
            img.style.cursor = 'grabbing';
            e.preventDefault();
        };

        // 键盘 ESC 关闭 + 清理
        var _khandler = function(e) {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
                document.removeEventListener('keydown', _khandler);
                document.removeEventListener('mousemove', img._mmove);
                document.removeEventListener('mouseup', img._mup);
            }
        };
        document.addEventListener('keydown', _khandler);
    },

    zoomImageViewer: function(action) {
        var img = document.getElementById('imageViewerImg');
        if (!img) return;

        if (action === 'fit') {
            img._scale = 1;
            img._translateX = 0;
            img._translateY = 0;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.transform = 'scale(1) translate(0,0)';
        } else if (action === '100') {
            img._scale = 1;
            img._translateX = 0;
            img._translateY = 0;
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            img.style.transform = 'scale(1) translate(0,0)';
        } else if (action === 'in') {
            img._scale = Math.min(10, (img._scale || 1) * 1.5);
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            img.style.transform = 'scale(' + img._scale + ') translate(' + (img._translateX || 0) + 'px,' + (img._translateY || 0) + 'px)';
        } else if (action === 'out') {
            img._scale = Math.max(0.15, (img._scale || 1) / 1.5);
            if (img._scale <= 1) {
                img._scale = 1;
                img._translateX = 0;
                img._translateY = 0;
                img.style.maxWidth = '100%';
                img.style.maxHeight = '100%';
                img.style.transform = 'scale(1) translate(0,0)';
            } else {
                img.style.transform = 'scale(' + img._scale + ') translate(' + (img._translateX || 0) + 'px,' + (img._translateY || 0) + 'px)';
            }
        }
    },

    // ============ 视频查看器(逐帧控制) ============

    openVideoViewer(filename, promptId) {
        var modal = document.getElementById('modalVideoViewer');
        if (!filename) { App.showToast('暂无视频', 'warning'); return; }

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

}); // end Object.assign
console.log('[PK] app_media_viewer loaded');
})();
