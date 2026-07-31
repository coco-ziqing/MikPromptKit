// v4.1.0: Word Card Manager — 自包含（无IIFE/路由冲突/异步竞态）
// 面板DOM在index.html中预置，此脚本只负责数据加载和渲染
App.wordCards = App.wordCards || {};
App.wordCards._page = 1;
App.wordCards._pageSize = parseInt(localStorage.getItem('wc_page_size')) || 50;
App.wordCards._search = '';
App.wordCards._groupId = null;
App.wordCards._sort = 'sort_order';
App.wordCards._order = 'asc';
App.wordCards._items = [];
App.wordCards._total = 0;
App.wordCards._groups = [];
App.wordCards._searchMode = localStorage.getItem('wc_search_mode') || 'fts';
App.wordCards._searchTimer = null;
App.wordCards._searchHistory = [];
App.wordCards._showHistory = false;
App.wordCards._loading = false;  // 加载锁，防止并发竞态
App.wordCards._loadSeq = 0;       // 请求序列号，丢弃过期响应

App.wordCards.load = async function() {
    var grid = document.getElementById('wcGrid');
    var stats = document.getElementById('wcStats');
    if (!grid) return;

    // 加载锁：如果已有请求在进行中，标记序列号让旧请求放弃渲染
    this._loadSeq++;
    var mySeq = this._loadSeq;
    this._loading = true;

    grid.innerHTML = '<div style="text-align:center;padding:30px;grid-column:1/-1;color:var(--text-muted);"><div class="spinner-border" style="width:20px;height:20px;"></div></div>';

    // Load groups first
    try {
        var gd = await App.fetchJSON('/api/v4/word-cards/groups');
        this._groups = (gd && gd.groups) || [];
        // Fill group filter
        var sel = document.getElementById('wcGroupFilter');
        if (sel) {
            var h = '<option value="">全部 (' + (gd||{}).total + '组)</option>';
            for (var i = 0; i < this._groups.length; i++) {
                var g = this._groups[i];
                h += '<option value="'+g.id+'">'+(g.icon||'')+' '+App._escape(g.name||'')+' ('+g.card_count+')</option>';
            }
            sel.innerHTML = h;
        }
        // Fill quick chips
        var bar = document.getElementById('wcGroupBar');
        if (bar) {
            var bh = '';
            for (var i = 0; i < Math.min(this._groups.length, 15); i++) {
                var g = this._groups[i];
                bh += '<button onclick="App.wordCards._chip('+g.id+')" style="font-size:10px;padding:3px 8px;border-radius:12px;cursor:pointer;border:1px solid var(--border-color);color:var(--text-muted);background:var(--bg-card);margin:2px;">'+(g.icon||'')+' '+App._escape((g.name||'').substring(0,8))+'<span style="font-size:9px;margin-left:2px;">'+g.card_count+'</span></button>';
            }
            bar.innerHTML = bh;
        }
    } catch(e) {
        console.warn('loadGroups failed:', e);
    }

    // Load cards
    try {
        var d;
        if (this._search && (this._searchMode === 'semantic' || this._searchMode === 'hybrid')) {
            var ep = this._searchMode === 'semantic' ? '/api/v2/search/wc-semantic' : '/api/v2/search/wc-hybrid';
            var topK = this._pageSize || 50;
            try {
                if (this._searchMode === 'semantic') {
                    d = await App.fetchJSON(ep + '?q=' + encodeURIComponent(this._search) + '&top_k=' + topK);
                } else {
                    var body = JSON.stringify({query: this._search, top_k: topK});
                    d = await App.fetchJSON(ep, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: body
                    });
                }
            } catch(e) { d = null; }
            d = d || {};
            d = {items: d.items || [], total: d.total || 0, total_pages: Math.max(1, Math.ceil((d.total||0) / topK))};
        } else {
            var qs = 'page='+this._page+'&page_size='+this._pageSize;
            if (this._search) qs += '&search='+encodeURIComponent(this._search);
            if (this._groupId) qs += '&group_id='+this._groupId;
            qs += '&sort='+this._sort+'&order='+this._order;
            d = await App.fetchJSON('/api/v4/word-cards?'+qs);
        }
        
        // 序列号守卫：丢弃过期响应
        if (mySeq !== this._loadSeq) { this._loading = false; return; }
        
        this._items = (d && d.items) || [];
        this._total = (d && d.total) || 0;
        this._loading = false;

        // 统计栏显示当前上下文
        if (stats) {
            var ctxParts = [];
            if (this._search) ctxParts.push('搜索 <b>'+App._escape(this._search)+'</b>');
            if (this._groupId) {
                var curGroup = this._groups.find(function(g){return g.id===App.wordCards._groupId;});
                ctxParts.push('分组 <b>'+App._escape((curGroup||{}).name||'')+'</b>');
            }
            var ctxText = ctxParts.length ? ' · '+ctxParts.join(' @') : '';
            stats.textContent = '共 '+this._total+' 张'+ctxText+' · 第 '+this._page+'/'+(d.total_pages||1)+' 页';
        }

        if (this._items.length === 0) {
            var noMsg = this._search 
                ? '<p>没有匹配 <b>'+App._escape(this._search)+'</b> 的词卡</p><p style="font-size:12px;">试试换个关键词，或 <a style="color:var(--primary);cursor:pointer;text-decoration:underline;" onclick="App.wordCards.clearSearch()">清空搜索</a></p>'
                : '<p>暂无词卡</p>';
            grid.innerHTML = '<div style="text-align:center;padding:40px;grid-column:1/-1;color:var(--text-muted);"><div style="font-size:40px;">📭</div>'+noMsg+'</div>';
        } else {
            var h = '';
            for (var i = 0; i < this._items.length; i++) {
                var c = this._items[i], tags = c.tags||[], name = c.name||(c.content||'').substring(0,40);
                var usage = c.usage_count>0 ? '<span style="font-size:9px;padding:1px 5px;border-radius:8px;background:var(--hover-bg);color:var(--text-muted);">×'+c.usage_count+'</span>' : '';
                var scoreHtml = (c.score !== undefined && c.score !== null) ? '<span style="font-size:9px;padding:1px 5px;border-radius:8px;background:rgba(139,92,246,0.1);color:#8b5cf6;">'+(c.score*100).toFixed(0)+'%</span>' : '';
                var highlightName = this._search ? App.wordCards._highlight(name, this._search) : App._escape(name);
                var highlightContent = this._search ? App.wordCards._highlight((c.content||'').substring(0,200), this._search) : App._escape(c.content||'');
                var highlightMeaning = this._search && c.meaning ? App.wordCards._highlight(c.meaning, this._search) : App._escape(c.meaning||'');
                h += '<div class="wc-card" style="border:1px solid var(--border-color);border-radius:10px;overflow:hidden;background:var(--bg-card);transition:0.15s;" onmouseenter="this.style.borderColor=\'#3b82f6\';this.style.boxShadow=\'0 4px 16px rgba(0,0,0,0.08)\'" onmouseleave="this.style.borderColor=\'#cbd5e1\';this.style.boxShadow=\'none\'">'
                + '<div style="padding:10px 12px 6px;display:flex;justify-content:space-between;align-items:start;">'
+ '<div data-card-content="' + (c.content||'').replace(/'/g,'\\') + '" onclick="App.copyText(this.dataset.cardContent,\''+App._t('common.copied', '已复制')+'\')" style="display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer;flex:1;">'
                + '<span style="font-size:16px;">'+App._escape(c.icon||'📄')+'</span>'
                + '<div style="min-width:0;"><div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+highlightName+'</div>'
                + (c.group_name ? '<div style="font-size:10px;color:var(--text-muted);margin-top:1px;">'+App._escape(c.group_name)+'</div>' : '')
                + '</div></div>'
                + '<div style="flex-shrink:0;display:flex;gap:2px;align-items:center;">'+scoreHtml+usage
                + '<select onchange="if(this.value){App._wcMoveCard('+c.id+',this.value);this.value=\"\";}" onclick="event.stopPropagation()" title="移动到功能模块" style="font-size:9px;padding:1px 4px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-muted);cursor:pointer;max-width:80px;"><option value="">📦 模块</option></select>'
                + '<span onclick="event.stopPropagation();App.wordEditor.open({cardId:'+c.id+',source:\'cards\',onSaved:function(){App.wordCards.load()}})" title="编辑词卡" style="cursor:pointer;font-size:13px;padding:2px 6px;">✏️</span>'
                + '</div></div>'
                + '<div style="padding:4px 12px 6px;" onclick="if(event.target.tagName!==\'SELECT\')App.copyText(this.querySelector(\'.wc-card-content\').dataset.raw||\'\',App._t(\'common.copied\',\'已复制\'));" style="cursor:pointer;">'
                + '<div class="wc-card-content" data-raw="'+App._escape((c.content||'').replace(/'/g,'\\'))+'" style="font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">'+highlightContent+'</div>'
                + (c.meaning ? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">'+highlightMeaning+'</div>' : '')
                + '</div>'
                + (tags.length ? '<div style="padding:6px 12px;border-top:1px solid var(--border-color);display:flex;gap:4px;flex-wrap:wrap;">'+tags.slice(0,5).map(function(t){return'<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:var(--hover-bg);color:var(--text-muted);">'+App._escape(t)+'</span>';}).join('')+(tags.length>5?'<span style="font-size:9px;color:var(--text-muted);">+'+ (tags.length-5)+'</span>':'')+'</div>' : '')
                + '</div>';
            }
            grid.innerHTML = h;
        }

        // Pagination
        var totalPages = (d && d.total_pages) || 1;
        var pel = document.getElementById('wcPagination');
        if (pel && totalPages > 1) {
            var ph = '', p = this._page;
            ph += '<button '+(p<=1?'disabled':'')+' onclick="App.wordCards._go('+(p-1)+')" style="padding:4px 10px;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;background:var(--bg-card);color:var(--text-main);font-size:11px;">◀</button>';
            for (var j=Math.max(1,p-2); j<=Math.min(totalPages,p+2); j++)
                ph += '<button onclick="App.wordCards._go('+j+')" style="padding:4px 10px;border:1px solid '+(j===p?'var(--primary)':'var(--border-color)')+';border-radius:6px;cursor:pointer;background:'+(j===p?'var(--primary)':'var(--bg-card)')+';color:'+(j===p?'#fff':'var(--text-main)')+';font-size:11px;">'+j+'</button>';
            ph += '<button '+(p>=totalPages?'disabled':'')+' onclick="App.wordCards._go('+(p+1)+')" style="padding:4px 10px;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;background:var(--bg-card);color:var(--text-main);font-size:11px;">▶</button>';
            pel.innerHTML = ph;
        }
    } catch(e) {
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;grid-column:1/-1;">❌ 加载未完成: '+App._escape(e.message||'')+'</div>';
    }
};

App.wordCards.search = function() {
    // 防并发：正在加载中则忽略重复回车
    if (this._loading) return;
    if (this._searchTimer) clearTimeout(this._searchTimer);
    var q = (document.getElementById('wcSearch')||{}).value||'';
    this._search = q;
    this._page = 1;
    // 搜索时保留分组上下文（不清除_groupId），实现分组内搜索范围限定
    // 只有在搜索框清空时才恢复到全量（视同浏览）
    if (q && q.trim().length >= 2) {
        this._addSearchHistory(q.trim());
    }
    this.load();
};

App.wordCards._searchDebounced = function(q) {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    var self = this;
    this._searchTimer = setTimeout(function() {
        if (self._loading) return;  // 跳过并发
        self._search = q || '';
        self._page = 1;
        if (self._search.trim().length >= 2) self._addSearchHistory(self._search.trim());
        self.load();
    }, 350);
};

App.wordCards._toggleSearchMode = function() {
    var modes = ['fts', 'semantic', 'hybrid'];
    var idx = modes.indexOf(this._searchMode);
    this._searchMode = modes[(idx + 1) % modes.length];
    localStorage.setItem('wc_search_mode', this._searchMode);
    var btn = document.getElementById('wcSearchModeBtn');
    if (btn) {
        var labels = {fts:'🔤', semantic:'🧠', hybrid:'🚀'};
        var titles = {fts:'全文搜索(FTS5)', semantic:'语义搜索(向量)', hybrid:'混合搜索(FTS+向量+LLM)'};
        btn.textContent = labels[this._searchMode] || '🔤';
        btn.title = titles[this._searchMode] || '全文搜索';
    }
    if (this._search) { this._page = 1; this.load(); }
};

App.wordCards.clearSearch = function() {
    var inp = document.getElementById('wcSearch');
    if (inp) inp.value = '';
    this._search = '';
    this._page = 1;
    this.load();
};
App.wordCards._fetchSuggestions = async function(q) {
    if (!q || q.trim().length < 2) { var s=document.getElementById('wcSuggestions'); if(s)s.remove(); return; }
    var old = document.getElementById('wcSuggestions');
    if (old) old.remove();
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/suggestions?q=' + encodeURIComponent(q.trim()) + '&limit=6');
        if (!d || !d.suggestions || d.suggestions.length === 0) return;
        var div = document.createElement('div');
        div.id = 'wcSuggestions';
        div.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:49;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:220px;overflow-y:auto;font-size:11px;';
        var h = '<div style="padding:4px 10px;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border-color);">💡 搜索建议</div>';
        for (var i = 0; i < d.suggestions.length; i++) {
            var s = d.suggestions[i];
            h += '<div style="padding:5px 10px;cursor:pointer;border-bottom:1px solid var(--hover-bg);" onmouseover="this.style.background=\'#f1f5f9\'" onmouseout="this.style.background=\'transparent\'" onclick="var inp=document.getElementById(\'wcSearch\');if(inp)inp.value=\'' + App._escape(s.name) + '\';App.wordCards.search();var sd=document.getElementById(\'wcSuggestions\');if(sd)sd.remove();">' +
                '<span style="font-weight:600;">' + App._escape(s.name) + '</span>' +
                (s.usage > 0 ? '<span style="font-size:9px;color:var(--text-muted);margin-left:6px;">×' + s.usage + '</span>' : '') +
                '<div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + App._escape((s.snippet||'').substring(0,60)) + '</div>' +
                '</div>';
        }
        div.innerHTML = h;
        var inp = document.getElementById('wcSearch');
        if (inp && inp.parentNode) { inp.parentNode.style.position = 'relative'; inp.parentNode.appendChild(div); }
    } catch(e) { /* silent */ }
};

// 全局快捷键 Ctrl+K 聚焦搜索
(function() {
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            var inp = document.getElementById('wcSearch');
            if (inp) { inp.focus(); inp.select(); }
        }
    });
})();


// 搜索历史
App.wordCards._loadSearchHistory = function() {
    try { this._searchHistory = JSON.parse(localStorage.getItem('wc_search_history')) || []; }
    catch(e) { this._searchHistory = []; }
};

App.wordCards._addSearchHistory = function(q) {
    if (!q) return;
    this._searchHistory = this._searchHistory.filter(function(x) { return x !== q; });
    this._searchHistory.unshift(q);
    if (this._searchHistory.length > 15) this._searchHistory.pop();
    try { localStorage.setItem('wc_search_history', JSON.stringify(this._searchHistory)); } catch(e) {}
};

App.wordCards._showSearchHistory = function() {
    this._loadSearchHistory();
    var old = document.getElementById('wcSearchHistory');
    if (old) { old.remove(); return; }
    var inp = document.getElementById('wcSearch');
    if (!inp || this._searchHistory.length === 0) return;
    var self = this;
    var div = document.createElement('div');
    div.id = 'wcSearchHistory';
    div.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:50;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:200px;overflow-y:auto;font-size:11px;';
    var h = '<div style="padding:6px 10px;font-size:10px;color:var(--text-muted);border-bottom:1px solid var(--border-color);">🔍 最近搜索</div>';
    for (var i = 0; i < this._searchHistory.length; i++) {
        h += '<div class="wc-hist-row" data-q="' + App._escape(this._searchHistory[i]) + '" style="padding:6px 10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">'
            + '<span>' + App._escape(this._searchHistory[i]) + '</span>'
            + '<span class="wc-hist-del" data-idx="' + i + '" style="font-size:9px;color:var(--text-muted);">✕</span>'
            + '</div>';
    }
    h += '<div id="wcHistClearAll" style="padding:4px 10px;font-size:9px;color:var(--text-muted);border-top:1px solid var(--border-color);cursor:pointer;">清空全部记录</div>';
    div.innerHTML = h;
    // 事件委托：用 addEventListener 替代 inline onclick
    div.addEventListener('click', function(e) {
        var row = e.target.closest('.wc-hist-row');
        var delBtn = e.target.closest('.wc-hist-del');
        var clearBtn = e.target.closest('#wcHistClearAll');
        if (delBtn) {
            e.stopPropagation();
            var idx = parseInt(delBtn.dataset.idx);
            self._searchHistory.splice(idx, 1);
            try { localStorage.setItem('wc_search_history', JSON.stringify(self._searchHistory)); } catch(ex) {}
            var h2 = document.getElementById('wcSearchHistory');
            if (h2) h2.remove();
            self._showSearchHistory();
            return;
        }
        if (clearBtn) {
            self._searchHistory = [];
            try { localStorage.removeItem('wc_search_history'); } catch(ex) {}
            var h2 = document.getElementById('wcSearchHistory');
            if (h2) h2.remove();
            return;
        }
        if (row) {
            var q = row.dataset.q;
            var inp2 = document.getElementById('wcSearch');
            if (inp2) inp2.value = q;
            self.search();
            var h2 = document.getElementById('wcSearchHistory');
            if (h2) h2.remove();
        }
    });
    inp.parentNode.style.position = 'relative';
    inp.parentNode.appendChild(div);
};

App.wordCards._highlight = function(text, query) {
    // 安全高亮：先转义再匹配，防止 XSS + 中文/emoji 兼容
    var escFn = App._escape || function(x) { var d=document.createElement('div'); d.textContent=x||''; return d.innerHTML; };
    if (!query || !text) return escFn(text || '');
    try {
        var escaped = escFn(text);
        // 只对 ASCII 字母数字做高亮匹配（中文不通过regex分割避免unicode边界问题）
        var words = query.split(/[\s,，]+/).filter(function(w) { return w.length >= 1; });
        for (var i = 0; i < words.length; i++) {
            var w = escFn(words[i]);
            if (!w || w.length < 1) continue;
            // 跳过纯中文词的高亮（已被 FTS 命中，避免 regex 边界破坏 HTML）
            if (/^[\u4e00-\u9fff]+$/.test(words[i]) && words[i].length <= 4) {
                w = words[i];  // 直接使用原文做匹配（已通过 escFn 安全）
                try {
                    escaped = escaped.split(w).join('<mark style="background:#fef08a;color:#1e293b;padding:0 1px;border-radius:2px;">' + w + '</mark>');
                } catch(splitErr) { /* ignore */ }
            } else {
                w = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                try {
                    escaped = escaped.replace(new RegExp('(' + w + ')', 'gi'), '<mark style="background:#fef08a;color:#1e293b;padding:0 1px;border-radius:2px;">$1</mark>');
                } catch(regexErr) { /* ignore */ }
            }
        }
        return escaped;
    } catch(e) {
        return escFn(text || '');
    }
};
App.wordCards.filterGroup = function() {
    if (this._loading) return;
    this._groupId = parseInt((document.getElementById('wcGroupFilter')||{}).value) || null;
    this._page=1;
    this.load();
};
App.wordCards._chip = function(gid) {
    if (this._loading) return;
    this._groupId=gid;
    this._page=1;
    var s=document.getElementById('wcGroupFilter'); if(s)s.value=gid||'';
    this.load();
};
App.wordCards._go = function(p) { this._page=p; this.load(); };

// ============ P0-5: AI 批量录入 ============

App.wordCards._showBatchCreate = function() {
    var old = document.getElementById('wcBatchCreateModal');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = 'wcBatchCreateModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML =
        '<div class="modal-content" style="max-width:620px;width:90%;max-height:90vh;overflow-y:auto;background:var(--bg-card);border-radius:12px;padding:20px;" onclick="event.stopPropagation()">' +
        '<h5 style="margin:0 0 4px;">🤖 AI 批量录入</h5>' +
        '<p style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">用自然语言描述要录入的词条，AI 自动拆解+匹配分组+入库</p>' +
        '<textarea id="wcBatchText" class="modal-input" rows="6" placeholder="例如：&#10;录入8个科幻概念：量子纠缠通讯、星际跃迁引擎、暗物质收割者、时间晶体重构器、纳米集群殖民地、戴森球矩阵、反物质催化炉、维度折叠舱" style="font-size:13px;width:100%;margin-bottom:10px;"></textarea>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;">' +
        '<label style="font-size:11px;">目标分组(可选):</label>' +
        '<select id="wcBatchGroup" class="modal-input" style="flex:1;font-size:11px;"><option value="">自动匹配</option></select>' +
        '<label style="font-size:11px;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="wcBatchPreview" checked> 预览</label>' +
        '</div>' +
        '<div id="wcBatchResult" style="display:none;max-height:300px;overflow-y:auto;margin-bottom:12px;border:1px solid var(--border-color);border-radius:8px;padding:10px;"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-sm btn-secondary" onclick="document.getElementById(\'wcBatchCreateModal\').remove()">取消</button>' +
        '<button class="btn btn-sm btn-primary" id="wcBatchBtn" onclick="App.wordCards._doBatchCreate()">🤖 AI 拆解</button>' +
        '</div></div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    
    // 加载分组选项
    var sel = document.getElementById('wcBatchGroup');
    try {
        var groups = App.wordCards._groups || [];
        groups.forEach(function(g) {
            var opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = (g.icon||'') + ' ' + (g.name||'').substring(0,25) + ' (' + (g.card_count||0) + ')';
            sel.appendChild(opt);
        });
    } catch(e) {}
};

App.wordCards._doBatchCreate = async function() {
    var text = document.getElementById('wcBatchText').value.trim();
    if (!text) { App.showToast('请输入文本', 'warning'); return; }
    
    var btn = document.getElementById('wcBatchBtn');
    btn.disabled = true;
    btn.textContent = '⏳ AI 解析中...';
    
    var isPreview = document.getElementById('wcBatchPreview').checked;
    var gid = parseInt(document.getElementById('wcBatchGroup').value) || null;
    
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/batch-create', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ text: text, group_id: gid, auto_archive: !isPreview }),
            _timeoutMs: 120000
        });
        
        var resultEl = document.getElementById('wcBatchResult');
        resultEl.style.display = 'block';
        
        if (isPreview) {
            // 预览模式：显示解析结果
            var items = d.items || [];
            var h = '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">📋 AI 解析结果 (' + items.length + ' 条)</div>';
            h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">';
            items.forEach(function(it, i) {
                h += '<div style="border:1px solid var(--border-color);border-radius:6px;padding:6px 8px;font-size:11px;">' +
                    '<div style="font-weight:600;">' + (i+1) + '. ' + App._escape((it.content||'').substring(0,40)) + '</div>' +
                    '<div style="color:var(--text-muted);font-size:10px;">' + App._escape((it.meaning||'').substring(0,30)) + '</div>' +
                    '<div style="color:var(--primary);font-size:10px;">→ ' + App._escape(it.group_name||'自动') + '</div>' +
                    '</div>';
            });
            h += '</div>';
            h += '<button class="btn btn-sm btn-success" onclick="App.wordCards._confirmBatchCreate()" style="margin-top:10px;">✅ 确认入库 (' + items.length + ' 条)</button>';
            resultEl.innerHTML = h;
            // 缓存解析结果
            App.wordCards._batchParsed = items;
        } else {
            // 直接入库模式
            var created = d.created || [];
            resultEl.innerHTML = '<div style="color:#22c55e;font-size:12px;">✅ 已入库 ' + d.created_count + ' 条词卡</div>' +
                '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">AI模型: ' + (d.ai_model||'') + '</div>';
            App.showToast('已入库 ' + d.created_count + ' 条', 'success');
            await App.wordCards.load();
            try { await App.loadGroupTree(); } catch(e) {}
            setTimeout(function() { var m = document.getElementById('wcBatchCreateModal'); if (m) m.remove(); }, 1500);
        }
    } catch(e) {
        var resultEl = document.getElementById('wcBatchResult');
        resultEl.style.display = 'block';
        resultEl.innerHTML = '<div style="color:#ef4444;">❌ ' + App._escape(e.message) + '</div>';
        App.showToast('AI 未能解析: ' + e.message, 'danger');
    }
    btn.disabled = false;
    btn.textContent = '🤖 AI 拆解';
};

App.wordCards._confirmBatchCreate = async function() {
    if (!this._batchParsed) return;
    var text = document.getElementById('wcBatchText').value.trim();
    var gid = parseInt(document.getElementById('wcBatchGroup').value) || null;
    
    var btn = document.getElementById('wcBatchBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 入库中...';
    
    try {
        var d = await App.fetchJSON('/api/v4/word-cards/batch-create', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ text: text, group_id: gid, auto_archive: true }),
            _timeoutMs: 60000
        });
        if (d && d.ok) {
            App.showToast('已入库 ' + d.created_count + ' 条', 'success');
            await App.wordCards.load();
            try { await App.loadGroupTree(); } catch(e) {}
            var m = document.getElementById('wcBatchCreateModal');
            if (m) m.remove();
        }
    } catch(e) {
        App.showToast('入库未完成: ' + e.message, 'danger');
    }
    btn.disabled = false;
    btn.textContent = '🤖 AI 拆解';
};

console.log('[word_card_manager] ready — App.wordCards.load()');
