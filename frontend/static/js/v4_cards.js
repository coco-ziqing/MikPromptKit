// ================================================================
// Phase 3: 统一卡片详情弹窗 + 跨表搜索
// 独立模块，在 app.js 后加载
// ================================================================
(function() {
    'use strict';
    if (!App) return;

    // ==================== 卡片详情弹窗 ====================
    App.showCardDetail = async function(cardId) {
        // 移除旧弹窗
        var old = document.getElementById('modalCardDetail');
        if (old) old.remove();

        try {
            var resp = await App.fetchJSON('/api/v4/cards/' + cardId + '/full');
            if (!resp || !resp.card) { App.showToast('加载失败', 'error'); return; }
            var card = resp.card;

            var overlay = document.createElement('div');
            overlay.id = 'modalCardDetail';
            overlay.className = 'modal-overlay';
            overlay.style.cssText = 'display:flex;z-index:600;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;';
            overlay.onclick = function(e) { if (e.target === this) this.remove(); };

            var sf = card.structured_fields || {};
            var sfHtml = '';
            var fieldNames = {
                subject: '主体', scene_desc: '场景', composition: '构图', lighting: '光影',
                camera_move: '运镜', mood: '氛围', style: '画风', texture: '质感',
                motion: '动作', speed: '速率', focal_length: '焦段', perspective: '视角',
                color_grade: '调色', weather: '天气', particles: '粒子', filter: '滤镜'
            };
            for (var k in sf) {
                if (sf[k]) {
                    var label = fieldNames[k] || k;
                    sfHtml += '<div style="margin-bottom:4px;"><span style="font-size:11px;color:#94a3b8;">' + label + ':</span> <span style="font-size:12px;">' + App._escape(sf[k]) + '</span></div>';
                }
            }

            // 媒体预览
            var mediaHtml = '';
            for (var mi = 0; mi < (card.media || []).length; mi++) {
                var m = card.media[mi];
                if (m.media_type === 'image') {
                    mediaHtml += '<img src="/api/thumbnails/file/' + m.filename + '" style="width:80px;height:60px;object-fit:cover;border-radius:4px;cursor:pointer;" onclick="window.open(\'/api/thumbnails/original/' + m.filename + '\')" title="' + App._escape(m.original_filename) + '">';
                } else if (m.media_type === 'video') {
                    mediaHtml += '<video src="/api/thumbnails/video/' + m.filename + '" style="width:80px;height:60px;object-fit:cover;border-radius:4px;" muted loop preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>';
                }
            }

            // 词库引用
            var libHtml = '';
            for (var li = 0; li < (card.library_details || []).length; li++) {
                var ld = card.library_details[li];
                libHtml += '<div style="font-size:11px;padding:2px 6px;border:1px solid var(--border-color);border-radius:4px;display:inline-block;margin:2px;">' +
                    App._escape(ld.name) + ' <span style="color:#94a3b8;">(' + ld.lib_type + ')</span></div>';
            }

            // 收藏信息
            var collHtml = '';
            for (var ci = 0; ci < (card.collections || []).length; ci++) {
                var co = card.collections[ci];
                collHtml += ' <span style="font-size:11px;">' + (co.icon || '⭐') + ' ' + App._escape(co.name) + '</span>';
            }

            var h = '<div class="modal-content" style="max-width:640px;max-height:85vh;overflow-y:auto;" onclick="event.stopPropagation()">';
            h += '<div class="modal-header"><h5>' + App._escape(card.name || card.content.substring(0, 40)) + '</h5>';
            h += '<button class="header-btn-sm" onclick="this.closest(\'#modalCardDetail\').remove()">&times;</button></div>';
            h += '<div class="modal-body">';

            // 基本信息
            h += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">';
            h += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:' + (card.card_type === 'video' ? '#8b5cf6' : '#10b981') + ';color:#fff;">' + (card.card_type === 'video' ? '🎬 视频' : '📷 图片') + '</span>';
            h += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);">' + App._escape(App._moduleDisplayName(card.module)) + '</span>';
            if (card.category) h += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);">' + App._escape(card.category) + '</span>';
            h += '<span style="font-size:11px;color:#94a3b8;">使用 ' + (card.usage_count_total || 0) + ' 次</span>';
            h += '</div>';

            // 内容
            h += '<div style="margin-bottom:12px;">';
            h += '<label style="font-size:11px;color:#94a3b8;font-weight:600;">提示词内容</label>';
            h += '<div style="padding:8px 10px;background:var(--hover-bg,#f1f5f9);border-radius:6px;font-size:13px;line-height:1.5;font-family:monospace;white-space:pre-wrap;">' + App._escape(card.content) + '</div>';
            h += '</div>';

            // 结构化字段
            if (sfHtml) {
                h += '<div style="margin-bottom:12px;">';
                h += '<label style="font-size:11px;color:#94a3b8;font-weight:600;">结构化字段</label>';
                h += '<div style="padding:8px 10px;background:var(--hover-bg,#f1f5f9);border-radius:6px;">' + sfHtml + '</div>';
                h += '</div>';
            }

            // 媒体预览
            if (mediaHtml) {
                h += '<div style="margin-bottom:12px;">';
                h += '<label style="font-size:11px;color:#94a3b8;font-weight:600;">媒体资产 (' + (card.media || []).length + ')</label>';
                h += '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + mediaHtml + '</div></div>';
            }

            // 词库引用
            if (libHtml) {
                h += '<div style="margin-bottom:12px;">';
                h += '<label style="font-size:11px;color:#94a3b8;font-weight:600;">引用词库</label>';
                h += '<div>' + libHtml + '</div></div>';
            }

            // 释义+场景
            if (card.meaning) {
                h += '<div style="margin-bottom:8px;"><label style="font-size:11px;color:#94a3b8;">释义</label><div style="font-size:12px;">' + App._escape(card.meaning) + '</div></div>';
            }
            if (card.scene) {
                h += '<div style="margin-bottom:8px;"><label style="font-size:11px;color:#94a3b8;">使用场景</label><div style="font-size:12px;">' + App._escape(card.scene) + '</div></div>';
            }

            // 收藏信息
            if (collHtml) {
                h += '<div style="margin-bottom:8px;"><label style="font-size:11px;color:#94a3b8;">所属收藏</label><div>' + collHtml + '</div></div>';
            }

            // 标签
            if (card.tags && card.tags.length) {
                h += '<div style="margin-bottom:8px;"><label style="font-size:11px;color:#94a3b8;">标签</label><div>';
                for (var ti = 0; ti < card.tags.length; ti++) {
                    h += '<span style="font-size:11px;padding:1px 6px;border:1px solid var(--border-color);border-radius:3px;margin:1px;display:inline-block;">' + App._escape(card.tags[ti]) + '</span>';
                }
                h += '</div></div>';
            }

            // 版本信息
            h += '<div style="font-size:11px;color:#94a3b8;margin-top:8px;">';
            h += '版本 v' + (card.version || 1) + ' · 创建 ' + (card.created_at || '') + ' · 更新 ' + (card.updated_at || '');
            h += '</div>';

            h += '</div></div>';

            overlay.innerHTML = h;
            document.body.appendChild(overlay);

        } catch (e) {
            App.showToast('加载详情失败: ' + e.message, 'error');
        }
    };

    // ==================== 全局搜索升级 ====================
    App._v4SearchResults = null;
    App.v4GlobalSearch = async function() {
        var q = document.getElementById('searchInput')?.value?.trim();
        if (!q) {
            App._hideV4SearchResults();
            return;
        }
        try {
            var resp = await App.fetchJSON('/api/v4/search?q=' + encodeURIComponent(q) + '&scope=all&page_size=5');
            if (!resp) return;
            App._v4SearchResults = resp;
            App._showV4SearchResults(q);
        } catch (e) {}
    };

    App._showV4SearchResults = function(q) {
        var old = document.getElementById('v4SearchResults');
        if (old) old.remove();

        var data = App._v4SearchResults;
        if (!data || (!data.cards.length && !data.library.length && !data.media.length)) return;

        var div = document.createElement('div');
        div.id = 'v4SearchResults';
        div.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:var(--bg-card,#fff);border:1px solid var(--border-color);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:300;max-height:400px;overflow-y:auto;font-size:13px;';

        var h = '';
        if (data.cards.length) {
            h += '<div style="padding:6px 10px;font-size:11px;color:#94a3b8;font-weight:600;border-bottom:1px solid var(--border-color);">📝 提示词卡 (' + data.cards.length + ')</div>';
            for (var i = 0; i < data.cards.length; i++) {
                var c = data.cards[i];
                h += '<div style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--hover-bg);" onmouseover="this.style.background=\'var(--hover-bg,#f1f5f9)\'" onmouseout="this.style.background=\'transparent\'" onclick="document.getElementById(\'v4SearchResults\').remove();App.showCardDetail(' + c.id + ')">';
                h += '  <div style="font-weight:600;font-size:12px;">' + App._escape(c.name || c.content.substring(0, 30)) + '</div>';
                h += '  <div style="font-size:11px;color:#94a3b8;">' + App._escape((c.content || '').substring(0, 60)) + '</div>';
                h += '</div>';
            }
        }
        if (data.library.length) {
            h += '<div style="padding:6px 10px;font-size:11px;color:#94a3b8;font-weight:600;border-bottom:1px solid var(--border-color);">📚 词库 (' + data.library.length + ')</div>';
            for (var i = 0; i < data.library.length; i++) {
                var l = data.library[i];
                h += '<div style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--hover-bg);" onmouseover="this.style.background=\'var(--hover-bg,#f1f5f9)\'" onmouseout="this.style.background=\'transparent\'" onclick="document.getElementById(\'v4SearchResults\').remove();App.switchView(\'v4library\')">';
                h += '  <div><strong>' + App._escape(l.name) + '</strong> <span style="font-size:11px;color:#94a3b8;">(' + l.lib_type + ')</span></div>';
                h += '</div>';
            }
        }
        if (data.media.length) {
            h += '<div style="padding:6px 10px;font-size:11px;color:#94a3b8;font-weight:600;border-bottom:1px solid var(--border-color);">🖼️ 媒体 (' + data.media.length + ')</div>';
            for (var i = 0; i < data.media.length; i++) {
                var m = data.media[i];
                h += '<div style="padding:8px 10px;cursor:pointer;" onmouseover="this.style.background=\'var(--hover-bg,#f1f5f9)\'" onmouseout="this.style.background=\'transparent\'" onclick="document.getElementById(\'v4SearchResults\').remove();App.switchView(\'v4media\')">';
                h += '  <div>' + App._escape(m.original_filename || m.filename) + '</div>';
                h += '</div>';
            }
        }
        div.innerHTML = h;
        var searchBox = document.getElementById('globalSearchBox');
        if (searchBox) {
            searchBox.style.position = 'relative';
            searchBox.appendChild(div);
        }
    };

    App._hideV4SearchResults = function() {
        var el = document.getElementById('v4SearchResults');
        if (el) el.remove();
    };

    // 拦截搜索输入事件
    var origInit = App.init;
    App.init = function() {
        if (origInit) origInit.call(this);
        // 增强搜索输入框
        var inp = document.getElementById('searchInput');
        if (inp) {
            inp.addEventListener('input', function() {
                if (this.value.length >= 1) {
                    App.v4GlobalSearch();
                } else {
                    App._hideV4SearchResults();
                }
            });
            inp.addEventListener('blur', function() {
                setTimeout(function() { App._hideV4SearchResults(); }, 200);
            });
        }
    };

    console.log('[v4] Phase 3: 卡片详情弹窗 + 跨表搜索已加载');
})();
