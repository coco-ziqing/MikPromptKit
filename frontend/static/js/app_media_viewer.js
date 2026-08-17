/**
 * app_media_viewer.js — 媒体查看器模块（从 app_media.js 拆出）
 * 原图查看器(滚轮缩放+拖拽移动) + 视频查看器(逐帧控制) + 缩略图关联
 * 加载后自动覆盖 app_media.js 中的同名方法
 */
(function() {
'use strict';
// 覆盖 app_media.js 中同名方法

Object.assign(App, {

    // ============ v5.37.4: 预览模式切换（图片↔视频，词卡生成历史） ============
    // 拉取词卡生成历史，注入切换栏；图片产物用原图(result_original)，视频用 result_filename
    _loadViewerSwitch(promptId, currentType) {
        var self = this;
        if (!promptId) return;
        App.fetchJSON('/api/card-gen/tasks?card_id=' + promptId + '&limit=50').then(function (d) {
            var tasks = (d && d.tasks || []).filter(function (t) { return (t.status === 'success' || t.status === 'done') && t.result_filename; });
            var images = tasks.filter(function (t) { return t.media_type === 'image'; });
            var videos = tasks.filter(function (t) { return t.media_type === 'video'; });
            // 仅两类产物都有时才显示切换栏（否则无意义）
            if (!images.length || !videos.length) return;
            var box = document.getElementById(currentType === 'video' ? 'vidViewerSwitch' : 'imgViewerSwitch');
            if (!box) return;
            var btn = function (label, type, active) {
                return '<button type="button" onclick="App._switchViewerMode(' + promptId + ',\'' + type + '\')" style="font-size:11px;padding:3px 12px;border-radius:14px;border:1px solid ' + (active ? '#6366f1' : 'rgba(255,255,255,0.3)') + ';background:' + (active ? 'rgba(99,102,241,0.35)' : 'transparent') + ';color:#fff;cursor:pointer;">' + label + (active ? ' ✓' : '') + '</button>';
            };
            box.style.display = 'flex';
            box.innerHTML = '<span style="font-size:10px;color:#94a3b8;margin-right:2px;">预览:</span>' +
                btn('🖼 图片 (' + images.length + ')', 'image', currentType !== 'video') +
                btn('🎬 视频 (' + videos.length + ')', 'video', currentType === 'video');
        }).catch(function () {});
    },
    // 切换查看器模式：image → openImageViewer(原图)；video → openVideoViewer(视频)
    _switchViewerMode: function (promptId, type) {
        App.fetchJSON('/api/card-gen/tasks?card_id=' + promptId + '&limit=50').then(function (d) {
            var tasks = (d && d.tasks || []).filter(function (t) { return (t.status === 'success' || t.status === 'done') && t.result_filename; });
            var pick = tasks.filter(function (t) { return t.media_type === type; });
            if (!pick.length) { App.showToast('无' + (type === 'video' ? '视频' : '图片') + '产物', 'warning'); return; }
            // 优先当前显示(is_current)，否则最新
            var cur = pick.filter(function (t) { return t.is_current; });
            var t = (cur[0] || pick[0]);
            if (type === 'video') {
                App.closeImageViewer();
                App.openVideoViewer(t.result_filename, promptId);
            } else {
                App.closeVideoViewer();
                App.openImageViewer(t.result_original || t.result_filename, promptId);
            }
        }).catch(function () {});
    },

    // ============ v5.41.4: 本词卡生成视频历史条 ============
    // 同词卡重复生成的多条视频：缩略图横向列表，点击切换播放 / ✓设为当前 / 🗑删除
    _loadVidGenHistory(cardId, curFilename) {
        var box = document.getElementById('vidGenHistory');
        if (!box) return;
        var self = this;
        box.style.display = 'none';
        box.innerHTML = '';
        if (!cardId) return;
        App.fetchJSON('/api/card-gen/tasks?card_id=' + cardId + '&limit=50').then(function (d) {
            var tasks = (d && d.tasks || []).filter(function (t) {
                return (t.status === 'success' || t.status === 'done') && t.media_type === 'video' && t.result_filename;
            });
            if (!tasks.length) {
                // 全部删光 → 停止播放
                var v = document.getElementById('vidViewerPlayer');
                if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
                return;
            }
            // 当前播放文件已不存在（被删除）→ 自动切到「当前显示」或最新一条
            var exists = tasks.some(function (t) { return t.result_filename === curFilename; });
            var target = curFilename;
            if (!exists) {
                var cur = tasks.filter(function (t) { return t.is_current; });
                target = (cur[0] || tasks[0]).result_filename;
                self._applyVidFile(target);
            }
            var h = '<span style="color:#cbd5e1;font-size:11px;margin-right:6px;white-space:nowrap;">📼 生成视频 ' + tasks.length + '</span>';
            tasks.forEach(function (t) {
                var active = t.result_filename === target;
                var isCur = !!t.is_current;
                h += '<span class="vid-gen-item" data-file="' + t.result_filename + '" data-id="' + t.id + '" title="' + App._escape((t.created_at || '').slice(0, 16)) + '" style="position:relative;cursor:pointer;display:inline-block;margin-right:5px;border-radius:6px;overflow:hidden;background:#0f172a;' + (active ? 'border:2px solid #6366f1;' : (isCur ? 'border:2px solid #10b981;' : 'border:2px solid transparent;opacity:0.75;')) + '">' +
                    '<video src="/api/thumbnails/video/' + t.result_filename + '" style="width:72px;height:46px;object-fit:cover;display:block;" muted loop preload="metadata"></video>' +
                    (isCur ? '<span style="position:absolute;top:0;left:0;font-size:8px;background:rgba(16,185,129,.92);color:#fff;padding:0 3px;border-radius:0 0 3px 0;">当前</span>' : '') +
                    '<button class="vid-gen-act" data-act="activate" title="设为词卡当前视频" style="position:absolute;top:0;right:0;font-size:8px;background:rgba(99,102,241,.92);color:#fff;border:none;border-radius:0 0 0 3px;padding:1px 4px;cursor:pointer;">' + (isCur ? '✓' : '设当前') + '</button>' +
                    '<button class="vid-gen-act" data-act="del" title="删除此生成记录" style="position:absolute;bottom:0;right:0;font-size:9px;background:rgba(239,68,68,.92);color:#fff;border:none;border-radius:3px 0 0 0;padding:1px 5px;cursor:pointer;">🗑</button>' +
                    '</span>';
            });
            box.innerHTML = h;
            box.style.display = 'flex';
            // 点击缩略图 → 切换播放
            box.querySelectorAll('.vid-gen-item').forEach(function (el) {
                el.addEventListener('click', function (e) {
                    if (e.target.classList.contains('vid-gen-act')) return;
                    self._applyVidFile(this.dataset.file);
                    self._loadVidGenHistory(cardId, this.dataset.file);  // 刷新高亮
                });
            });
            // 设为当前 / 删除
            box.querySelectorAll('.vid-gen-act').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var item = btn.closest('.vid-gen-item');
                    if (!item) return;
                    var id = item.dataset.id;
                    var file = item.dataset.file;
                    if (btn.dataset.act === 'activate') self._activateVidGen(id, cardId, file);
                    else self._delVidGen(id, cardId, file);
                });
            });
        }).catch(function () {});
    },
    // 切换播放器到指定视频文件（更新 modal data-filename 供下载/关闭用）
    _applyVidFile(filename) {
        var modal = document.getElementById('modalVideoViewer');
        if (modal) modal.setAttribute('data-filename', filename);
        var video = document.getElementById('vidViewerPlayer');
        if (!video) return;
        video.src = '/api/thumbnails/video/' + filename + '?t=' + Date.now();
        video.load();
        video.play();
        var playBtn = document.getElementById('vidPlayBtn');
        if (playBtn) playBtn.innerHTML = '⏸';
    },
    // 将某条生成视频设为词卡当前预览（词卡预览框/网格联动）
    _activateVidGen(taskId, cardId, file) {
        var self = this;
        App.fetchJSON('/api/card-gen/tasks/' + taskId + '/activate', { method: 'POST' }).then(function (d) {
            if (d && d.ok) {
                App.showToast('✅ 已设为词卡当前视频', 'success');
                self._loadVidGenHistory(cardId, file);
                if (App.loadPrompts) { try { App.loadPrompts(); } catch (e) {} }
            } else {
                App.showToast('设置未完成: ' + (d ? (d.detail || '未知') : '无响应'), 'error');
            }
        }).catch(function () {});
    },
    // 删除某条生成记录（产物文件被词卡当前预览引用时保留）
    _delVidGen(taskId, cardId) {
        if (!confirm('删除此生成记录及其视频文件？\n（若为词卡当前预览，文件将保留；正在进行的任务不受影响）')) return;
        var self = this;
        App.fetchJSON('/api/card-gen/tasks/' + taskId, { method: 'DELETE' }).then(function (d) {
            if (d && d.ok) {
                App.showToast('🗑 已删除', 'success');
                self._loadVidGenHistory(cardId, '');  // 传空 → 自动切到剩余最新/当前
                if (App.loadPrompts) { try { App.loadPrompts(); } catch (e) {} }
            } else {
                App.showToast('删除未完成: ' + (d ? (d.detail || '未知') : '无响应'), 'error');
            }
        }).catch(function () {});
    },

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

        // v5.36.22: 同卡多版本列表（词卡多版本查看/切换/设为主预览）
        this._loadCardVersions(promptId);

        // v5.37.4: 预览模式切换（图片↔视频）
        this._loadViewerSwitch(promptId, 'image');

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

    // v5.36.22: 加载同卡多版本列表（词卡多版本查看/切换/设为主预览）
    _loadCardVersions(promptId) {
        var box = document.getElementById('imgViewerVersions');
        if (!box) return;
        var self = this;
        box.style.display = 'none';
        box.innerHTML = '';
        if (!promptId) return;
        App.fetchJSON('/api/seedance/v2/assets/cards/' + promptId + '/versions').then(function(d) {
            if (!d || !d.ok) return;
            var all = [];
            if (d.main) all.push(d.main);
            all = all.concat(d.versions || []);
            if (all.length <= 1) return;  // 单版本不显示版本条
            var h = '<span style="color:#cbd5e1;font-size:11px;margin-right:4px;white-space:nowrap;">多版本</span>';
            for (var i = 0; i < all.length; i++) {
                var v = all[i];
                var isActive = v.is_active ? '1' : '0';
                var border = isActive === '1' ? 'border:2px solid #10b981;' : 'border:2px solid transparent;opacity:0.72;';
                var thumb = v.media_type === 'video'
                    ? '<span style="display:inline-flex;width:56px;height:40px;align-items:center;justify-content:center;background:#1e293b;color:#fff;font-size:16px;">🎬</span>'
                    : '<img src="' + App._escape(v.file_url || '') + '" style="width:56px;height:40px;object-fit:cover;display:block;" onerror="this.style.opacity=0.2">';
                h += '<span class="img-ver-item" data-ver="' + v.id + '" data-url="' + App._escape(v.file_url || '') + '" data-media="' + (v.media_type || 'image') + '" title="版本 ' + (i + 1) + (v.prompt ? ' · ' + App._escape(v.prompt.substring(0, 40)) : '') + '" style="position:relative;cursor:pointer;display:inline-block;margin-right:5px;border-radius:6px;overflow:hidden;background:#0f172a;' + border + '">' + thumb +
                    '<button class="img-ver-activate" data-ver="' + v.id + '" title="设为此版本为词卡主预览（填入预览框）" style="position:absolute;bottom:0;right:0;font-size:9px;background:rgba(16,185,129,0.92);color:#fff;border:none;border-radius:3px 0 0 0;padding:1px 5px;cursor:pointer;">✓ 主预览</button></span>';
            }
            box.innerHTML = h;
            box.style.display = 'flex';
            // 点击版本切换大图
            box.querySelectorAll('.img-ver-item').forEach(function(el) {
                el.addEventListener('click', function(e) {
                    if (e.target.classList.contains('img-ver-activate')) return;
                    var url = this.dataset.url;
                    if (!url) return;
                    var imgEl = document.getElementById('imageViewerImg');
                    var ld = document.getElementById('imgViewerLoading');
                    var seq2 = (self._viewerLoadSeq = (self._viewerLoadSeq || 0) + 1);
                    imgEl.src = url;
                    imgEl.style.transform = 'scale(1)';
                    imgEl._viewScale = 1;
                    if (ld) ld.style.display = 'flex';
                    imgEl.onload = function() {
                        if (self._viewerLoadSeq !== seq2) return;
                        if (ld) ld.style.display = 'none';
                        imgEl._fitReady = true;
                        imgEl._fitScale = imgEl.clientWidth / (imgEl.naturalWidth || 1);
                    };
                    box.querySelectorAll('.img-ver-item').forEach(function(x) { x.style.borderColor = 'transparent'; x.style.opacity = '0.72'; });
                    this.style.borderColor = '#10b981'; this.style.opacity = '1';
                });
            });
            // 设为词卡主预览
            box.querySelectorAll('.img-ver-activate').forEach(function(el) {
                el.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var verId = parseInt(this.dataset.ver);
                    if (!verId && verId !== 0) return;
                    self._activateCardVersion(promptId, verId);
                });
            });
        }).catch(function() {});
    },

    // 将某版本设为词卡主预览（更新 preview_media/缩略图，填入预览框）
    _activateCardVersion(cardId, verId) {
        var self = this;
        App.showToast('正在设置主预览...', 'info');
        App.fetchJSON('/api/seedance/v2/assets/cards/' + cardId + '/versions/' + verId + '/activate', {
            method: 'POST', _timeoutMs: 30000
        }).then(function(d) {
            if (d && d.ok) {
                App.showToast('✅ 已设为此版本主预览（词卡预览框已更新）', 'success');
                self._loadCardVersions(cardId);
                // 刷新词卡网格（若当前列表可见）
                if (App.loadPrompts) { try { App.loadPrompts(); } catch (e) {} }
            } else {
                App.showToast('设置未完成: ' + (d ? (d.detail || '未知') : '无响应'), 'error');
            }
        }).catch(function(e) { App.showToast('设置异常: ' + e.message, 'error'); });
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

    openVideoViewer(filename, promptId, maybePromptId, fps) {
        // v5.37.8: 参数兼容 — 卡片调用传 (filename, thumbnail, promptId, fps)；
        // 直接调用传 (filename, promptId)。第二参为非数字字符串（缩略图）时取第三参为 promptId
        if (typeof promptId === 'string' && !/^\d+$/.test(promptId)) {
            fps = maybePromptId === undefined ? '' : fps;
            promptId = maybePromptId || 0;
        }
        var modal = document.getElementById('modalVideoViewer');
        if (!filename) { App.showToast('暂无视频', 'warning'); return; }

        var video = document.getElementById('vidViewerPlayer');
        if (!video) return;

        modal.style.display = 'flex';
        modal.setAttribute('data-filename', filename);

        video.src = '/api/thumbnails/video/' + filename + '?t=' + Date.now();
        video.load();

        // v5.37.8: fps 显示（卡片传入）
        var fpsEl = document.getElementById('vidViewerFps');
        if (fpsEl) fpsEl.textContent = fps ? (fps + ' fps') : '';

        // v5.37.4: 预览模式切换（图片↔视频）
        this._loadViewerSwitch(promptId, 'video');

        // v5.41.4: 本词卡生成视频历史条（多条视频快捷切换/设为当前/删除）
        this._loadVidGenHistory(promptId, filename);

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
