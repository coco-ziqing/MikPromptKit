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
        modal.setAttribute('data-filename', filename);

        // 竞态保护序号：快速切换时旧请求的 onload 不再覆盖新图（防卡死/错图）
        var seq = (this._viewerLoadSeq = (this._viewerLoadSeq || 0) + 1);
        var self = this;

        // 构建可切换导航列表 + 更新箭头/计数
        this._buildViewerNav(promptId);
        this._updateViewerNavUI();

        // 加载指示（大图切换时反馈）
        var loading = document.getElementById('imgViewerLoading');
        if (loading) loading.style.display = 'flex';

        // 加载图片：去时间戳，利用 HTTP 缓存（原图 UUID 内容寻址，缓存 1 天）
        img.src = '/api/media/original/' + filename;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        img.style.transform = 'scale(1)';
        img.style.cursor = 'grab';
        // 缩放基准：_viewScale = 相对「适应容器」的倍数（1 = 适配显示）；_fitScale = 适配比例
        img._viewScale = 1;
        img._fitScale = 1;
        img._fitReady = false;
        img._scale = 1;
        // 图片加载完成后计算适配比例，首次缩放以当前显示为基准（避免跳到原始尺寸）
        img.onload = function() {
            if (self._viewerLoadSeq !== seq) return;  // 已被更新的切换取代，丢弃
            if (loading) loading.style.display = 'none';
            if (img.naturalWidth > 0 && img.clientWidth > 0) {
                img._fitScale = img.clientWidth / img.naturalWidth;
            } else {
                img._fitScale = 1;
            }
            img._fitReady = true;
        };
        img.onerror = function() {
            if (self._viewerLoadSeq !== seq) return;
            if (loading) loading.style.display = 'none';
            img._fitReady = true; img._fitScale = 1;
        };
        // 统一应用当前缩放（maxWidth 解除后按 适配比例×视图倍数 连续缩放）
        img._applyViewScale = function() {
            var s = (img._fitScale || 1) * (img._viewScale || 1);
            img._scale = s;
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            img.style.transform = 'scale(' + s + ') translate(' + (img._translateX || 0) + 'px,' + (img._translateY || 0) + 'px)';
        };

        // 加载右侧提示词详情
        if (promptId && App._renderViewerRight) {
            App._renderViewerRight('imgViewer', promptId);
        }

        // 重置拖拽状态
        img._isDragging = false;
        img._startX = 0; img._startY = 0;
        img._translateX = 0; img._translateY = 0;
        img._scale = 1;

        // 滚轮缩放（以当前显示比例为基础，首次缩放不跳变）
        img.onwheel = function(e) {
            e.preventDefault();
            if (!img._fitReady) return;
            var delta = e.deltaY > 0 ? 0.9 : 1.1;
            img._viewScale = Math.max(0.08, Math.min(20, (img._viewScale || 1) * delta));
            img._applyViewScale();
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

        // 键盘单例（左右箭头/ESC 只注册一次，避免快速切换累积监听器导致卡死）
        if (!this._viewerKeysBound) {
            this._viewerKeysBound = true;
            document.addEventListener('keydown', function(e) {
                var m = document.getElementById('modalImageViewer');
                if (!m || m.style.display !== 'flex') return;
                if (e.key === 'Escape') {
                    App.closeImageViewer();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    App._viewerNavGo(-1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    App._viewerNavGo(1);
                }
            });
        }

        // 预加载相邻两张（切到下一张时已缓存，秒开）
        this._preloadAdjacent();
    },

    // 预加载相邻两张原图
    _preloadAdjacent() {
        var nav = this._viewerNav;
        if (!nav || !nav.list || nav.list.length <= 1) return;
        var n = nav.list.length;
        var self = this;
        [nav.list[(nav.idx - 1 + n) % n], nav.list[(nav.idx + 1) % n]].forEach(function(en) {
            if (!en.file) return;
            if (self._imgPrefetched && self._imgPrefetched[en.file]) return;
            var im = new Image();
            im.src = '/api/media/original/' + en.file;
            if (!self._imgPrefetched) self._imgPrefetched = {};
            self._imgPrefetched[en.file] = true;
        });
    },

    // ============ 查看器左右切换（上一张/下一张原图） ============

    // 构建可导航列表：当前 state.prompts 中有原图的词卡（word_card 用 original_ref）
    _buildViewerNav(promptId) {
        var list = [];
        var idx = 0;
        var ps = this.state.prompts || [];
        for (var i = 0; i < ps.length; i++) {
            var p = ps[i];
            var isWordCard = p._source === 'word_card';
            var file = (isWordCard && p.original_ref) ? p.original_ref : (p.thumbnail || '');
            if (!file) continue;
            if (p.id === promptId) idx = list.length;
            list.push({ id: p.id, file: file });
        }
        this._viewerNav = { list: list, idx: idx };
    },

    // 上一张/下一张（dir: -1 上一张，1 下一张）— 节流防快速连按风暴
    _viewerNavGo(dir) {
        var now = Date.now();
        if (this._viewerNavThrottle && now - this._viewerNavThrottle < 120) return;
        this._viewerNavThrottle = now;
        var nav = this._viewerNav;
        if (!nav || !nav.list || nav.list.length <= 1) return;
        nav.idx = (nav.idx + dir + nav.list.length) % nav.list.length;
        var entry = nav.list[nav.idx];
        // 重新打开该卡原图（openImageViewer 会重建导航并按 entry.id 定位）
        this.openImageViewer(entry.file, entry.id);
    },

    // 更新箭头/计数器显隐与状态
    _updateViewerNavUI() {
        var nav = this._viewerNav;
        var prev = document.getElementById('imgViewerNavPrev');
        var next = document.getElementById('imgViewerNavNext');
        var cnt = document.getElementById('imgViewerNavCount');
        if (!nav || !nav.list || nav.list.length <= 1) {
            if (prev) prev.style.display = 'none';
            if (next) next.style.display = 'none';
            if (cnt) cnt.style.display = 'none';
            return;
        }
        if (prev) prev.style.display = 'flex';
        if (next) next.style.display = 'flex';
        if (cnt) { cnt.style.display = 'block'; cnt.textContent = (nav.idx + 1) + ' / ' + nav.list.length; }
    },

    zoomImageViewer: function(action) {
        var img = document.getElementById('imageViewerImg');
        if (!img) return;

        if (action === 'fit') {
            img._viewScale = 1;
            img._translateX = 0;
            img._translateY = 0;
            img._scale = 1;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.transform = 'scale(1) translate(0,0)';
        } else if (action === '100') {
            // 原始尺寸：视图倍数 = 1/适配比例，之后滚轮从此基准继续缩放
            img._viewScale = img._fitScale ? (1 / img._fitScale) : 1;
            img._translateX = 0;
            img._translateY = 0;
            img._scale = 1;
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            img.style.transform = 'scale(1) translate(0,0)';
        } else if (action === 'in') {
            if (!img._fitReady) return;
            img._viewScale = Math.min(20, (img._viewScale || 1) * 1.5);
            img._applyViewScale();
        } else if (action === 'out') {
            if (!img._fitReady) return;
            img._viewScale = Math.max(0.08, (img._viewScale || 1) / 1.5);
            img._applyViewScale();
        }
    },

    // ============ 视频查看器(逐帧控制) ============

    openVideoViewer(filename, promptId) {
        var modal = document.getElementById('modalVideoViewer');
        if (!filename) { App.showToast('暂无视频', 'warning'); return; }

        var video = document.getElementById('vidViewerPlayer');
        if (!video) return;

        modal.style.display = 'flex';
        modal.setAttribute('data-filename', filename);

        video.src = '/api/thumbnails/video/' + filename + '?t=' + Date.now();
        video.load();

        // 加载右侧提示词详情
        if (promptId && App._renderViewerRight) {
            App._renderViewerRight('vidViewer', promptId);
        }

        // 初始化进度条
        var seek = document.getElementById('vidViewerSeek');
        var timeLabel = document.getElementById('vidViewerTime');
        var durLabel = document.getElementById('vidViewerDuration');
        var playBtn = document.getElementById('vidPlayBtn');
        if (seek) seek.value = 0;

        function fmt(sec) {
            if (!sec || sec <= 0) return '00:00.0';
            var m = Math.floor(sec / 60);
            var s = (sec % 60).toFixed(1);
            return String(m).padStart(2, '0') + ':' + String(s).padStart(4, '0');
        }

        video.ontimeupdate = function() {
            if (video.duration && seek) seek.value = (video.currentTime / video.duration * 1000) || 0;
            if (timeLabel) timeLabel.textContent = fmt(video.currentTime);
        };
        video.onloadedmetadata = function() {
            if (durLabel) durLabel.textContent = fmt(video.duration);
        };

        if (seek) {
            seek.oninput = function() {
                if (video.duration) video.currentTime = parseFloat(this.value) / 1000 * video.duration;
            };
        }

        // 播放按钮
        var _togglePlay = function() {
            if (video.paused) { video.play(); if (playBtn) playBtn.innerHTML = '⏸'; }
            else { video.pause(); if (playBtn) playBtn.innerHTML = '▶'; }
        };
        if (playBtn) { playBtn.onclick = _togglePlay; playBtn.innerHTML = '▶'; }

        // 键盘：ESC关闭，空格切换播放，左右逐帧
        var kHandler = function(e) {
            if (e.key === 'Escape') { modal.style.display = 'none'; video.pause(); document.removeEventListener('keydown', kHandler); }
            if (e.key === ' ') { e.preventDefault(); _togglePlay(); }
            if (e.key === 'ArrowRight' && video.duration) {
                video.currentTime = Math.min(video.duration, video.currentTime + 1/24);
            }
            if (e.key === 'ArrowLeft' && video.duration) {
                video.currentTime = Math.max(0, video.currentTime - 1/24);
            }
        };
        document.addEventListener('keydown', kHandler);

        // 点击遮罩关闭
        modal.onclick = function(e) { if (e.target === modal) { modal.style.display = 'none'; video.pause(); } };
    },

    // ============ 查看器下载按钮 ============
    _downloadViewerFile: function(type) {
        var url, downloadName;
        var ext = '';
        if (type === 'video') {
            var videoEl = document.getElementById('vidViewerPlayer');
            if (!videoEl || !videoEl.src) { App.showToast('暂无视频可下载', 'warning'); return; }
            url = videoEl.src.replace(/\?.*$/, '');
            downloadName = url.split('/').pop() || 'video.mp4';
            var vp = downloadName.split('.');
            ext = vp.length > 1 ? '.' + vp.pop() : '.mp4';
        } else {
            // Fallback: 先尝试 modal data-filename, 再读 img src
            var modal = document.getElementById('modalImageViewer');
            var filename = modal ? modal.getAttribute('data-filename') : '';
            if (filename) {
                url = '/api/media/original/' + filename;
                downloadName = filename;
                var ip = downloadName.split('.');
                ext = ip.length > 1 ? '.' + ip.pop() : '.jpg';
            } else {
                var imgEl = document.getElementById('imageViewerImg');
                if (!imgEl || !imgEl.src) { App.showToast('暂无图片可下载', 'warning'); return; }
                url = imgEl.src.replace(/\?.*$/, '');
                downloadName = url.split('/').pop() || 'image.jpg';
                var ip2 = downloadName.split('.');
                ext = ip2.length > 1 ? '.' + ip2.pop() : '.jpg';
            }
        }
        // 以词卡名称前12字 + 扩展名作为文件名
        var contentEl = document.getElementById(type === 'video' ? 'vidViewerContent' : 'imgViewerContent');
        var cardName = contentEl ? (contentEl.textContent || '').trim() : '';
        var finalName;
        if (cardName) {
            var safeName = cardName.replace(/[\/\\:*?"<>|\r\n\t]/g, '').trim();
            safeName = safeName.substring(0, 12);
            finalName = safeName ? safeName + ext : downloadName.split('/').pop();
        } else {
            finalName = downloadName.split('/').pop();
        }
        fetch(url)
            .then(function(r) {
                if (!r.ok) throw new Error('下载未完成: ' + r.status);
                return r.blob();
            })
            .then(function(blob) {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = finalName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
            })
            .catch(function(e) {
                App.showToast(e.message, 'danger');
            });
    },

    // ============ 缩略图关联（从查看器中勾选收藏/关联）============

}); // end Object.assign
console.log('[PK] app_media_viewer loaded');
})();
