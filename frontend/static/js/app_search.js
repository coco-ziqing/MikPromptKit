// Phase13.2: 搜索子模块 — 从 app_core.js 拆分
(function() {
    'use strict';

    if (!App._searchBound) {
        App._searchBound = true;

        // 搜索模式: text / semantic
        App._searchMode = localStorage.getItem('promptkit_search_mode') || 'text';

        // 搜索防抖定时器
        App._searchTimer = null;
        App._lastSearchQuery = '';
        App._lastSearchTimestamp = 0;

        // ==================== 搜索核心 ====================

        App.performSearch = function(query, page) {
            if (!query || !query.trim()) {
                App.loadPrompts(page || 1);
                return;
            }
            App.showSkeleton();
            var url = '/api/prompts?search=' + encodeURIComponent(query.trim()) + '&page_size=' + App.pageSize + '&page=' + (page || 1);
            if (App.currentModule) url += '&module=' + encodeURIComponent(App.currentModule);
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (d && d.items) {
                        App.renderPrompts(d);
                        App._lastSearchQuery = query;
                        App._lastSearchTimestamp = Date.now();
                    }
                })
                .catch(function(e) {
                    console.error('[Search] 搜索失败:', e);
                    App.showToast(App._t('common.search', '搜索请求失败'), 'error');
                });
        };

        App.performSemanticSearch = function(query, page) {
            App.showSkeleton();
            var url = '/api/search/semantic?q=' + encodeURIComponent(query.trim()) + '&limit=' + App.pageSize + '&offset=' + ((page - 1) * App.pageSize || 0);
            if (App.currentModule) url += '&module=' + encodeURIComponent(App.currentModule);
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (d && d.results) {
                        // 将语义搜索结果包装为与普通搜索一致的格式
                        App.renderPrompts({
                            items: d.results,
                            total: d.total || d.results.length,
                            page: page || 1,
                            page_size: App.pageSize,
                            total_pages: Math.max(1, Math.ceil((d.total || d.results.length) / App.pageSize))
                        });
                        App._lastSearchQuery = query;
                        App._lastSearchTimestamp = Date.now();
                    }
                })
                .catch(function(e) {
                    console.error('[Semantic Search] 搜索失败:', e);
                    App.showToast(App._t('auto.str_a4b0155e', '语义搜索请求失败'), 'error');
                });
        };

        App.toggleSearchMode = function() {
            App._searchMode = (App._searchMode === 'text') ? 'semantic' : 'text';
            localStorage.setItem('promptkit_search_mode', App._searchMode);
            var btn = document.getElementById('searchModeBtn');
            if (btn) {
                btn.textContent = App._searchMode === 'text' ? '🔤' : '🧠';
                btn.title = '当前: ' + (App._searchMode === 'text' ? App._t('auto.str_430c07cf', '全文搜索') : App._t('auto.str_16d27cb3', '语义搜索'));
            }
        };

        // ==================== 搜索框事件绑定 ====================

        document.addEventListener('DOMContentLoaded', function() {
            var input = document.getElementById('searchInput');
            if (!input) return;

            // 设置搜索模式按钮初始状态
            var modeBtn = document.getElementById('searchModeBtn');
            if (modeBtn) {
                modeBtn.textContent = App._searchMode === 'text' ? '🔤' : '🧠';
                modeBtn.title = '当前: ' + (App._searchMode === 'text' ? App._t('auto.str_430c07cf', '全文搜索') : App._t('auto.str_16d27cb3', '语义搜索'));
            }

            input.addEventListener('input', function() {
                if (App._searchTimer) clearTimeout(App._searchTimer);
                var q = this.value.trim();
                if (!q) {
                    App.loadPrompts(1);
                    return;
                }
                App._searchTimer = setTimeout(function() {
                    if (App._searchMode === 'text') {
                        App.performSearch(q, 1);
                    } else {
                        App.performSemanticSearch(q, 1);
                    }
                }, 350);
            });

            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    if (App._searchTimer) clearTimeout(App._searchTimer);
                    var q = this.value.trim();
                    if (!q) { App.loadPrompts(1); return; }
                    if (App._searchMode === 'text') {
                        App.performSearch(q, 1);
                    } else {
                        App.performSemanticSearch(q, 1);
                    }
                }
                // Ctrl+F 聚焦搜索框
                if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                    e.preventDefault();
                    this.focus();
                    this.select();
                }
            });
        });

        // ==================== 搜索记录 ====================

        App._searchHistory = [];

        App.addSearchHistory = function(query) {
            if (!query) return;
            App._searchHistory = App._searchHistory.filter(function(q) { return q !== query; });
            App._searchHistory.unshift(query);
            if (App._searchHistory.length > 20) App._searchHistory.pop();
            try { localStorage.setItem('promptkit_search_history', JSON.stringify(App._searchHistory)); } catch(e) {}
        };

        App.getSearchHistory = function() {
            if (App._searchHistory.length === 0) {
                try { App._searchHistory = JSON.parse(localStorage.getItem('promptkit_search_history')) || []; } catch(e) {}
            }
            return App._searchHistory;
        };

        // ==================== 高级搜索 (Phase13.4) ====================

        App._advancedSearchVisible = false;

        App.toggleAdvancedSearch = function() {
            var panel = document.getElementById('advancedSearchPanel');
            if (!panel) {
                App._createAdvancedSearchPanel();
                panel = document.getElementById('advancedSearchPanel');
            }
            App._advancedSearchVisible = !App._advancedSearchVisible;
            panel.style.display = App._advancedSearchVisible ? 'block' : 'none';
        };

        App._createAdvancedSearchPanel = function() {
            var panel = document.createElement('div');
            panel.id = 'advancedSearchPanel';
            panel.style.cssText = 'display:none;position:absolute;top:100%;left:0;right:0;z-index:50;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.12);';
            panel.innerHTML = [
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">',
                '<label>搜索模式<select id="advSearchMode" class="modal-input" style="width:100%;font-size:11px;"><option value="and">AND (所有关键词)</option><option value="or">OR (任一关键词)</option></select></label>',
                '<label>搜索字段<select id="advSearchField" class="modal-input" style="width:100%;font-size:11px;"><option value="all">全部字段</option><option value="content">内容</option><option value="meaning">释义</option><option value="tags">标签</option></select></label>',
                '<label>模块<select id="advSearchModule" class="modal-input" style="width:100%;font-size:11px;"><option value="">全部模块</option></select></label>',
                '<label>缩略图<select id="advSearchThumb" class="modal-input" style="width:100%;font-size:11px;"><option value="any">不限</option><option value="yes">有缩略图</option><option value="no">无缩略图</option></select></label>',
                '<label>排除词条<input id="advSearchExclude" class="modal-input" placeholder="ID,ID..." style="width:100%;font-size:11px;"></label>',
                '<label>日期起<input id="advSearchDateFrom" type="date" class="modal-input" style="width:100%;font-size:11px;"></label>',
                '</div>',
                '<div style="display:flex;gap:8px;margin-top:10px;">',
                '<button class="btn btn-sm btn-primary" onclick="App._doAdvancedSearch()" style="flex:1;">🔍 搜索</button>',
                '<button class="btn btn-sm btn-outline" onclick="App.toggleAdvancedSearch()" style="flex:0;">关闭</button>',
                '</div>'
            ].join('');
            var sb = document.querySelector('.search-box');
            if (sb) {
                sb.style.position = 'relative';
                sb.appendChild(panel);
            }
            App._populateAdvSearchModules();
        };

        App._populateAdvSearchModules = function() {
            fetch('/api/modules')
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    var sel = document.getElementById('advSearchModule');
                    if (sel && d && d.modules) {
                        for (var i = 0; i < d.modules.length; i++) {
                            var opt = document.createElement('option');
                            opt.value = d.modules[i].id;
                            opt.textContent = d.modules[i].name;
                            sel.appendChild(opt);
                        }
                    }
                }).catch(function() {});
        };

        App._doAdvancedSearch = function() {
            var params = {
                query: (document.getElementById('searchInput') || {}).value || '',
                mode: (document.getElementById('advSearchMode') || {}).value || 'and',
                field: (document.getElementById('advSearchField') || {}).value || 'all',
                module: (document.getElementById('advSearchModule') || {}).value || '',
                has_thumbnail: (document.getElementById('advSearchThumb') || {}).value || 'any',
                exclude: (document.getElementById('advSearchExclude') || {}).value ? (document.getElementById('advSearchExclude').value.split(',').map(function(x){return parseInt(x.trim());}).filter(function(x){return !isNaN(x);})) : [],
                date_from: (document.getElementById('advSearchDateFrom') || {}).value || ''
            };
            if (!params.query.trim()) { App.showToast(App._t('auto.enter_搜索关键词', '请输入搜索关键词'), 'warning'); return; }
            App.showSkeleton();
            fetch('/api/search/advanced', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(params)
            })
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (d && d.ok && d.items) {
                        App.renderPrompts({
                            items: d.items,
                            total: d.total || d.items.length,
                            page: 1,
                            page_size: App.pageSize,
                            total_pages: 1
                        });
                        App.toggleAdvancedSearch();
                    }
                })
                .catch(function(e) {
                    App.showToast('高级搜索失败: ' + e.message, 'error');
                });
        };

        console.log('[Search Module] loaded, mode=' + App._searchMode);
    }

})();
