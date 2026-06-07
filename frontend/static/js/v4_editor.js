// ================================================================
// Phase 4: 结构化字段编辑器 + 版本管理 + 卡片编辑面板
// 独立模块，在 app.js + v4_cards.js 后加载
// ================================================================
(function() {
    'use strict';
    if (!App) return;

    // ==================== 结构化字段编辑面板 ====================
    // 在现有编辑弹窗中增强结构化字段

    App._origEditPrompt = App.editPrompt || null;

    // 增强编辑弹窗：添加结构化字段 tab
    App.editPromptV4 = async function(promptId) {
        // 使用现有编辑弹窗逻辑，但增加结构化字段编辑
        if (App._origEditPrompt) {
            // 先调原编辑逻辑弹出弹窗
            await App._origEditPrompt(promptId);
        }

        // 获取卡片完整数据
        try {
            var resp = await App.fetchJSON('/api/v4/cards/' + promptId + '/full');
            if (!resp || !resp.card) return;
            var card = resp.card;

            // 在弹窗中添加结构化字段编辑区
            var modal = document.getElementById('modalEditPrompt');
            if (!modal || modal.style.display !== 'flex') return;

            var body = modal.querySelector('.modal-body');
            if (!body) return;

            // 查找现有的内容/释义等编辑区域，在其后插入结构化字段
            var sf = card.structured_fields || {};
            var fieldDefs = [
                { key: 'subject', label: '主体' },
                { key: 'scene_desc', label: '场景' },
                { key: 'composition', label: '构图' },
                { key: 'lighting', label: '光影' },
                { key: 'camera_move', label: '运镜' },
                { key: 'color_grade', label: '调色' },
                { key: 'mood', label: '氛围' },
                { key: 'style', label: '画风' },
                { key: 'texture', label: '质感' },
                { key: 'motion', label: '动作' },
                { key: 'focal_length', label: '焦段' },
                { key: 'perspective', label: '视角' },
                { key: 'weather', label: '天气' },
                { key: 'particles', label: '粒子' },
                { key: 'filter', label: '滤镜' },
            ];

            var sfHtml = '<div style="margin-top:12px;border-top:1px solid var(--border-color);padding-top:10px;">';
            sfHtml += '<label style="font-size:12px;font-weight:600;margin-bottom:6px;display:block;">🎯 结构化字段</label>';
            sfHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">';
            for (var i = 0; i < fieldDefs.length; i++) {
                var fd = fieldDefs[i];
                var val = sf[fd.key] || '';
                sfHtml += '<div style="display:flex;flex-direction:column;">';
                sfHtml += '<span style="font-size:10px;color:#94a3b8;">' + fd.label + '</span>';
                sfHtml += '<input class="modal-input s2-field-input" data-field="' + fd.key + '" value="' + App._escape(val) + '" style="font-size:12px;padding:4px 6px;">';
                sfHtml += '</div>';
            }
            sfHtml += '</div></div>';

            // 在 modal-footer 前插入
            var footer = modal.querySelector('.modal-footer');
            if (footer) {
                footer.insertAdjacentHTML('beforebegin', sfHtml);
            }

            // 拦截保存按钮
            var saveBtn = modal.querySelector('.btn-primary');
            if (saveBtn) {
                var origClick = saveBtn.onclick;
                saveBtn.onclick = async function(e) {
                    // 收集结构化字段
                    var fields = {};
                    var inputs = modal.querySelectorAll('.s2-field-input');
                    for (var j = 0; j < inputs.length; j++) {
                        var inp = inputs[j];
                        var key = inp.getAttribute('data-field');
                        var val = inp.value.trim();
                        if (val) fields[key] = val;
                    }
                    // 保存到 prompt_cards
                    await App.fetchJSON('/api/v4/cards/' + promptId, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ structured_fields: fields })
                    });
                    // 执行原保存逻辑
                    if (origClick) await origClick(e);
                };
            }

        } catch (e) {
            console.warn('[v4] 结构化字段编辑加载失败:', e.message);
        }
    };

    // ==================== 版本管理面板 ====================
    App.showVersionHistory = async function(cardId) {
        try {
            var resp = await App.fetchJSON('/api/v4/cards/' + cardId + '/full');
            if (!resp || !resp.card) { App.showToast('加载失败', 'error'); return; }
            var card = resp.card;

            var overlay = document.createElement('div');
            overlay.id = 'modalVersionHistory';
            overlay.className = 'modal-overlay';
            overlay.style.cssText = 'display:flex;z-index:700;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
            overlay.onclick = function(e) { if (e.target === this) this.remove(); };

            var h = '<div class="modal-content" style="max-width:500px;max-height:70vh;overflow-y:auto;" onclick="event.stopPropagation()">';
            h += '<div class="modal-header"><h5>📋 版本历史</h5><button class="header-btn-sm" onclick="this.closest(\'#modalVersionHistory\').remove()">&times;</button></div>';
            h += '<div class="modal-body">';
            h += '<p style="font-size:12px;color:#94a3b8;margin-bottom:8px;">当前版本: <strong>v' + (card.version || 1) + '</strong></p>';

            // 分享版本信息
            var versions = card.versions || [];
            if (versions.length === 0) {
                h += '<div class="empty-state"><p>暂无版本历史</p></div>';
            } else {
                for (var i = 0; i < versions.length; i++) {
                    var v = versions[i];
                    var isCurrent = (v.version === card.version);
                    h += '<div style="padding:10px;border:1px solid ' + (isCurrent ? '#10b981' : 'var(--border-color)') + ';border-radius:8px;margin-bottom:8px;background:' + (isCurrent ? 'rgba(16,185,129,0.05)' : 'var(--bg-card,#fff)') + ';">';
                    h += '  <div style="display:flex;justify-content:space-between;">';
                    h += '    <div><strong>v' + v.version + '</strong> ' + (isCurrent ? '<span style="color:#10b981;font-size:11px;">✓ 当前版本</span>' : '');
                    h += '      <span style="font-size:11px;color:#94a3b8;margin-left:8px;">' + (v.created_at || '') + '</span>';
                    h += '    </div>';
                    h += '    <div style="display:flex;gap:4px;">';
                    if (!isCurrent) {
                        h += '      <button class="btn btn-xs btn-outline" onclick="App.rollbackVersion(' + card.id + ',' + v.version + ')">↩ 回滚</button>';
                    } else {
                        h += '      <span style="font-size:11px;color:#10b981;">✓</span>';
                    }
                    h += '    </div></div>';
                    if (v.change_note) h += '  <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">' + App._escape(v.change_note) + '</div>';
                    h += '  <div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + App._escape((v.content || '').substring(0, 60)) + '</div>';
                    h += '</div>';
                }
            }
            h += '</div></div>';
            overlay.innerHTML = h;
            document.body.appendChild(overlay);
        } catch (e) {
            App.showToast('加载失败: ' + e.message, 'error');
        }
    };

    App.rollbackVersion = async function(cardId, version) {
        if (!confirm('确定回滚到 v' + version + '？当前内容将被替换')) return;
        try {
            var resp = await App.fetchJSON('/api/v4/cards/ + cardId + /rollback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: cardId, version: version })
            });
            if (resp && resp.ok) {
                App.showToast('已回滚到 v' + version, 'success');
                document.getElementById('modalVersionHistory')?.remove();
                App.loadPrompts();
            } else {
                App.showToast('回滚失败', 'error');
            }
        } catch (e) {
            App.showToast('回滚失败: ' + e.message, 'error');
        }
    };

    // ==================== 保存时自动创建版本 ====================
    App._origSavePrompt = App.savePrompt || null;

    App.savePromptV4 = async function() {
        // 获取当前编辑的 ID
        var pid = document.getElementById('editPromptId')?.value;
        if (!pid) {
            if (App._origSavePrompt) return await App._origSavePrompt();
            return;
        }

        // 收集结构化字段
        var fields = {};
        var inputs = document.querySelectorAll('.s2-field-input');
        for (var j = 0; j < inputs.length; j++) {
            var inp = inputs[j];
            var key = inp.getAttribute('data-field');
            var val = inp.value.trim();
            if (val) fields[key] = val;
        }

        // 同时更新结构化字段到 prompt_cards
        await App.fetchJSON('/api/v4/cards/' + pid, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ structured_fields: fields })
        });

        // 调用原保存逻辑
        if (App._origSavePrompt) return await App._origSavePrompt();
    };

    // ==================== 初始化注入 ====================
    // 拦截编辑按钮
    if (!App._v4Phase4Inited) {
        App._v4Phase4Inited = true;
        // 如果原 editPrompt 存在，包装它
        if (typeof App.editPrompt === 'function') {
            App._origEditPrompt = App.editPrompt;
            App.editPrompt = function(promptId) {
                return App.editPromptV4(promptId);
            };
        }
        if (typeof App.savePrompt === 'function') {
            App._origSavePrompt = App.savePrompt;
            App.savePrompt = function() {
                return App.savePromptV4();
            };
        }

        // 添加「版本历史」按钮到详情弹窗
        var origDetail = App.showCardDetail;
        if (origDetail) {
            App.showCardDetail = async function(cardId) {
                await origDetail.call(this, cardId);
                // 在弹窗中添加版本历史按钮
                setTimeout(function() {
                    var modal = document.getElementById('modalCardDetail');
                    if (!modal) return;
                    var footer = modal.querySelector('.modal-footer');
                    if (!footer) {
                        // 如果没有 footer，在 body 末尾添加
                        var body = modal.querySelector('.modal-body');
                        if (body) {
                            var btn = document.createElement('div');
                            btn.style.cssText = 'padding:8px 16px;border-top:1px solid var(--border-color);display:flex;gap:8px;';
                            btn.innerHTML = '<button class="btn btn-sm btn-outline" onclick="App.showVersionHistory(' + cardId + ')">📋 版本历史</button>' +
                                '<button class="btn btn-sm btn-outline" onclick="App.editPrompt(' + cardId + ')">✏️ 编辑卡片</button>';
                            body.parentNode.insertBefore(btn, body.nextSibling);
                        }
                    }
                }, 100);
            };
        }
    }

    console.log('[v4] Phase 4: 结构化字段编辑 + 版本管理已加载');
})();
