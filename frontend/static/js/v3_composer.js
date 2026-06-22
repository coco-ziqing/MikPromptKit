// ================================================================
// Phase 6: 组装器 v3 — 基于 prompt_cards 的智能编排
// Seedance V2 Composer 增强模块
// Phase 14.1 优化: _v3ToggleCard 不再全量重渲染，改为 CSS class 切换
// ================================================================
(function() {
    'use strict';
    if (!App || !App.seedanceV2) return;
    var V2 = App.seedanceV2;

    // 在组装器添加「卡片编排」面板
    V2._v3ProjectCards = [];
    V2._v3ProjectName = '';

    V2.showCardComposer = function() {
        var editor = document.getElementById('s2Editor');
        if (!editor) return;

        var h = '<div class="s2-section">';
        h += '<div class="s2-section-title" style="display:flex;justify-content:space-between;align-items:center;">';
        h += '  <span>📇 从提示词卡创建项目</span>';
        h += '  <div style="display:flex;gap:8px;align-items:center;">';
        h += '    <input id="v3ProjectName" class="s2-input" placeholder="项目名称..." value="' + App._escape(V2._v3ProjectName || '') + '" style="width:180px;font-size:12px;padding:4px 8px;" onchange="App.seedanceV2._v3ProjectName=this.value">';
        h += '    <input id="v3Search" class="s2-input" placeholder="搜索提示词卡..." style="width:160px;font-size:12px;padding:4px 8px;" onkeydown="if(event.key===\'Enter\')App.seedanceV2._v3LoadCards()">';
        h += '    <button class="btn btn-sm btn-primary" onclick="App.seedanceV2._v3LoadCards()">🔍 搜索</button>';
        h += '    <button class="btn btn-sm btn-success" onclick="App.seedanceV2._v3CreateProject()" id="btnV3Create">🚀 创建项目</button>';
        h += '  </div></div>';
        h += '<div id="v3CardGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:8px;">';
        h += '  <div class="loading-spinner"><div class="spinner-border text-primary" role="status"></div></div>';
        h += '</div></div>';

        editor.innerHTML = h;
        V2._v3LoadCards();
    };

    V2._v3LoadCards = async function() {
        var grid = document.getElementById('v3CardGrid');
        if (!grid) return;
        var search = document.getElementById('v3Search')?.value?.trim() || '';

        grid.innerHTML = '<div class="loading-spinner"><div class="spinner-border text-primary" role="status"></div></div>';

        try {
            var url = '/api/v4/composer/cards-available?page_size=100';
            if (search) url += '&search=' + encodeURIComponent(search);
            var resp = await App.fetchJSON(url);
            if (!resp || !resp.items) { grid.innerHTML = '<div class="empty-state"><p>加载失败</p></div>'; return; }

            if (!resp.items.length) {
                grid.innerHTML = '<div class="empty-state"><p>暂无可用提示词卡</p></div>';
                return;
            }

            var h = '';
            var selectedIds = V2._v3ProjectCards || [];

            for (var i = 0; i < resp.items.length; i++) {
                var card = resp.items[i];
                var sf = card.structured_fields || {};
                var isSelected = selectedIds.indexOf(card.id) >= 0;
                var sfSummary = Object.keys(sf).filter(function(k) { return sf[k]; }).map(function(k) { return k; }).join(', ');

                h += '<div class="v3-card' + (isSelected ? ' v3-selected' : '') + '" data-id="' + card.id + '" onclick="App.seedanceV2._v3ToggleCard(' + card.id + ')">';
                h += '  <div class="v3-card-header">';
                h += '    <div><span class="card-type-badge card-type-' + (card.card_type || 'image') + '">' + ((card.card_type || 'image') === 'video' ? '🎬' : '📷') + ' ' + (card.card_type || App._t('auto.str_20def794', '图片')) + '</span>';
                h += '      <span class="v3-card-module">' + App._escape(App._moduleDisplayName(card.module || '')) + '</span>';
                h += '    </div>';
                h += '    <input type="checkbox" ' + (isSelected ? 'checked' : '') + ' style="pointer-events:none;">';
                h += '  </div>';
                h += '  <div class="v3-card-content">' + App._escape((card.content || '').substring(0, 100)) + '</div>';
                if (sfSummary) {
                    h += '  <div class="v3-card-fields">🔧 ' + App._escape(sfSummary.substring(0, 60)) + '</div>';
                }
                h += '  <div class="v3-card-usage">使用 ' + (card.usage_count || 0) + ' 次</div>';
                h += '</div>';
            }
            grid.innerHTML = h;
        } catch (e) {
            grid.innerHTML = '<div class="empty-state"><p>加载失败: ' + App._escape(e.message) + '</p></div>';
        }
    };

    // ✅ Phase 14.1: 不再全量重渲染，只切换 CSS class + DOM 属性
    V2._v3ToggleCard = function(cardId) {
        var idx = V2._v3ProjectCards.indexOf(cardId);
        if (idx >= 0) {
            V2._v3ProjectCards.splice(idx, 1);
        } else {
            V2._v3ProjectCards.push(cardId);
        }

        // 只更新对应 DOM 节点的样式，不重新请求 API
        var cardEl = document.querySelector('.v3-card[data-id="' + cardId + '"]');
        if (cardEl) {
            var isNowSelected = idx < 0; // pushed → now selected
            cardEl.classList.toggle('v3-selected', isNowSelected);
            var cb = cardEl.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = isNowSelected;
        }
    };

    V2._v3CreateProject = async function() {
        var cardIds = V2._v3ProjectCards;
        if (!cardIds.length) {
            App.showToast(App._t('auto.str_f5823279', '请至少选择一张提示词卡'), 'warning');
            return;
        }

        var name = document.getElementById('v3ProjectName')?.value?.trim() || ('项目 ' + new Date().toLocaleTimeString());
        V2._v3ProjectName = name;

        try {
            var resp = await App.fetchJSON('/api/v4/composer/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    card_ids: cardIds,
                    aspect_ratio: '16:9',
                    resolution: '1080p',
                    total_duration: Math.max(4, Math.min(15, cardIds.length * 4))
                })
            });

            if (resp && resp.ok) {
                App.showToast('项目已创建: ' + name, 'success');
                V2._v3ProjectCards = [];
                App.switchSeedanceTab('composer');
                setTimeout(function() {
                    App.seedanceV2.openProject(resp.project_id);
                }, 300);
            } else {
                App.showToast('创建失败: ' + (resp?.error || App._t('common.unknown_error', '未知错误')), 'error');
            }
        } catch (e) {
            App.showToast('创建失败: ' + e.message, 'error');
        }
    };

    // 在种子 V2 的标签页中添加「卡片编排」按钮
    var origTabRender = App.switchSeedanceTab;
    App.switchSeedanceTab = function(tab) {
        if (origTabRender) origTabRender.call(this, tab);
    };

    // 在 composer 空状态中添加入口
    var origComposerEmpty = V2.renderComposerEmpty;
    V2.renderComposerEmpty = function() {
        if (origComposerEmpty) origComposerEmpty.call(this);
        var editor = document.getElementById('s2Editor');
        if (!editor) return;
        var emptyState = editor.querySelector('.s2-empty-state');
        if (emptyState) {
            var btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-primary';
            btn.style.cssText = 'margin-top:12px;';
            btn.onclick = function() { V2.showCardComposer(); };
            btn.innerHTML = '📇 从提示词卡创建';
            emptyState.appendChild(btn);
        }
    };

    // 添加「卡片编排」按钮到 composer tab 的工具栏
    var origRenderEditor = V2.renderProjectEditor;
    V2.renderProjectEditor = function() {
        if (origRenderEditor) origRenderEditor.call(this);
        var header = document.querySelector('.s2-editor-header');
        if (header) {
            var existing = document.getElementById('btnV3CardComposer');
            if (!existing) {
                var btn = document.createElement('button');
                btn.id = 'btnV3CardComposer';
                btn.className = 'btn btn-sm btn-outline';
                btn.style.cssText = 'margin-left:8px;color:#6366f1;border-color:#6366f1;';
                btn.onclick = function() { V2.showCardComposer(); };
                btn.innerHTML = '📇 卡片编排';
                header.querySelector('.s2-editor-actions')?.prepend(btn);
            }
        }
    };

    console.log('[Phase 6] 组装器 v3 卡片编排模块已加载 (v14.1-optimized)');
})();
