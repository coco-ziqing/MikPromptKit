// v4.1.0: Word Card Manager — 自包含（无IIFE/路由冲突/异步竞态）
// 面板DOM在index.html中预置，此脚本只负责数据加载和渲染
App.wordCards = App.wordCards || {};
App.wordCards._page = 1;
App.wordCards._pageSize = 50;
App.wordCards._search = '';
App.wordCards._groupId = null;
App.wordCards._sort = 'sort_order';
App.wordCards._order = 'asc';
App.wordCards._items = [];
App.wordCards._total = 0;
App.wordCards._groups = [];

App.wordCards.load = async function() {
    var grid = document.getElementById('wcGrid');
    var stats = document.getElementById('wcStats');
    if (!grid) return;

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
        var qs = 'page='+this._page+'&page_size='+this._pageSize;
        if (this._search) qs += '&search='+encodeURIComponent(this._search);
        if (this._groupId) qs += '&group_id='+this._groupId;
        qs += '&sort='+this._sort+'&order='+this._order;

        var d = await App.fetchJSON('/api/v4/word-cards?'+qs);
        this._items = (d && d.items) || [];
        this._total = (d && d.total) || 0;

        if (stats) stats.textContent = '共 '+this._total+' 张 · 第 '+this._page+'/'+(d.total_pages||1)+' 页';

        if (this._items.length === 0) {
            grid.innerHTML = '<div style="text-align:center;padding:40px;grid-column:1/-1;color:var(--text-muted);"><div style="font-size:40px;">📭</div><p>暂无词卡</p></div>';
        } else {
            var h = '';
            for (var i = 0; i < this._items.length; i++) {
                var c = this._items[i], tags = c.tags||[], name = c.name||(c.content||'').substring(0,40);
                var usage = c.usage_count>0 ? '<span style="font-size:9px;padding:1px 5px;border-radius:8px;background:var(--hover-bg);color:var(--text-muted);">×'+c.usage_count+'</span>' : '';
                h += '<div class="wc-card" style="border:1px solid var(--border-color);border-radius:10px;overflow:hidden;background:var(--bg-card);transition:0.15s;" onmouseenter="this.style.borderColor=\'var(--primary)\';this.style.boxShadow=\'0 4px 16px rgba(0,0,0,0.08)\'" onmouseleave="this.style.borderColor=\'var(--border-color)\';this.style.boxShadow=\'none\'">'
                + '<div style="padding:10px 12px 6px;display:flex;justify-content:space-between;align-items:start;">'
+ '<div data-card-content="' + (c.content||'').replace(/'/g,'\\') + '" onclick="App.copyText(this.dataset.cardContent,\'已复制\')" style="display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer;flex:1;">'
                + '<span style="font-size:16px;">'+App._escape(c.icon||'📄')+'</span>'
                + '<div style="min-width:0;"><div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+App._escape(name)+'</div>'
                + (c.group_name ? '<div style="font-size:10px;color:var(--text-muted);margin-top:1px;">'+App._escape(c.group_name)+'</div>' : '')
                + '</div></div>'
                + '<div style="flex-shrink:0;display:flex;gap:2px;align-items:center;">'+usage
                + '<select onchange="if(this.value){App._wcMoveCard('+c.id+',this.value);this.value=\"\";}" onclick="event.stopPropagation()" title="移动到功能模块" style="font-size:9px;padding:1px 4px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-muted);cursor:pointer;max-width:80px;"><option value="">📦 模块</option></select>'
                + '<span onclick="event.stopPropagation();App.wordEditor.open({cardId:'+c.id+',source:\'cards\',onSaved:function(){App.wordCards.load()}})" title="编辑词卡" style="cursor:pointer;font-size:13px;padding:2px 6px;">✏️</span>'
                + '</div></div>'
                + '<div style="padding:4px 12px 6px;" data-card-content="'+App._escape((c.content||'').replace(/'/g,'\\'))+'\',\'已复制\')" style="cursor:pointer;">'
                + '<div style="font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">'+App._escape(c.content||'')+'</div>'
                + (c.meaning ? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">'+App._escape(c.meaning||'')+'</div>' : '')
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
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;grid-column:1/-1;">❌ 加载失败: '+App._escape(e.message||'')+'</div>';
    }
};

App.wordCards.search = function() { this._search = (document.getElementById('wcSearch')||{}).value||''; this._page=1; this.load(); };
App.wordCards.filterGroup = function() { this._groupId = parseInt((document.getElementById('wcGroupFilter')||{}).value) || null; this._page=1; this.load(); };
App.wordCards._chip = function(gid) { this._groupId=gid; this._page=1; var s=document.getElementById('wcGroupFilter'); if(s)s.value=gid||''; this.load(); };
App.wordCards._go = function(p) { this._page=p; this.load(); };

console.log('[word_card_manager] ready — App.wordCards.load()');
