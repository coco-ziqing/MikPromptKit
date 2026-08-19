// 咪卡灵感收藏助手 — 页面悬浮面板 v2
// Shadow DOM 隔离样式；可折叠/展开/拖动；折叠时保留「收藏本页」必要按钮
// 合规：仅回传标签 URL；多标签批量必须用户勾选确认；不读取页面内容/隐私数据
(function () {
  if (window.__MIKA_CC_EXT__) return;
  window.__MIKA_CC_EXT__ = true;

  var STYLE = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; margin: 0; padding: 0; font-family: "Microsoft YaHei", system-ui, sans-serif; }',
    '#wrap { position: fixed; z-index: 2147483647; font-size: 13px; color: #1f2937; }',
    /* ---- 折叠胶囊 ---- */
    '#pill { display: flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #e5e7eb; border-radius: 999px; padding: 6px 10px; box-shadow: 0 4px 16px rgba(0,0,0,.14); cursor: move; user-select: none; white-space: nowrap; }',
    '#pill .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; flex: none; }',
    '#pill .dot.ok { background: #10b981; }',
    '#pill .dot.err { background: #ef4444; }',
    '#pill .brand { font-weight: 700; }',
    '#pill .btn { cursor: pointer; border: none; border-radius: 999px; padding: 5px 12px; font-size: 12px; }',
    '#pill .btn.save { background: #3b82f6; color: #fff; }',
    '#pill .btn.save:hover:not(:disabled) { background: #2563eb; }',
    '#pill .btn.save:disabled { background: #cbd5e1; cursor: not-allowed; }',
    '#pill .btn.toggle { background: #f3f4f6; color: #374151; }',
    '#pill .btn.toggle:hover { background: #e5e7eb; }',
    /* ---- 展开面板 ---- */
    '#panel { display: none; position: absolute; left: 0; bottom: 0; width: 360px; max-height: 78vh; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,.18); overflow: hidden; flex-direction: column; }',
    '#wrap.right #panel { left: auto; right: 0; }',
    '#wrap.up #panel { top: 0; bottom: auto; }',
    '#wrap.open #panel { display: flex; }',
    '#wrap.open #pill { display: none; }',
    '.p-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #f3f4f6; }',
    '.p-head .t { font-weight: 700; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.p-head .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; }',
    '.p-head .dot.ok { background: #10b981; }',
    '.p-head .dot.err { background: #ef4444; }',
    '.p-head .btn { cursor: pointer; border: none; background: #f3f4f6; color: #374151; border-radius: 8px; padding: 4px 9px; font-size: 12px; }',
    '.p-head .btn.fold { border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; font-weight: 600; padding: 4px 11px; }',
    '.p-head .btn.fold:hover { background: #dbeafe; }',
    '.cur { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; }',
    '.cur-title { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }',
    '.cur-url { font-size: 11px; color: #6b7280; margin: 4px 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }',
    '.btn { cursor: pointer; border: none; border-radius: 8px; padding: 7px 0; font-size: 13px; width: 100%; }',
    '.btn.primary { background: #3b82f6; color: #fff; }',
    '.btn.primary:hover:not(:disabled) { background: #2563eb; }',
    '.btn.primary:disabled { background: #cbd5e1; cursor: not-allowed; }',
    '.tabs-wrap { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; flex: 1; min-height: 0; display: flex; flex-direction: column; }',
    '.tabs-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 6px; }',
    '.tabs-head label { font-weight: 400; font-size: 12px; display: flex; align-items: center; gap: 4px; cursor: pointer; }',
    '.tabs-list { overflow-y: auto; max-height: 240px; display: flex; flex-direction: column; gap: 4px; }',
    '.tabitem { display: flex; flex-direction: column; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; }',
    '.tabitem:hover { border-color: #bfdbfe; }',
    '.tabitem:last-child { border-bottom: none; }',
    '.tabitem.on { background: #eff6ff; border-color: #93c5fd; }',
    '.ti-line { display: flex; align-items: center; gap: 4px; min-width: 0; }',
    '.ti-title { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }',
    '.ti-url { font-size: 10px; color: #9ca3af; word-break: break-all; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.saved-badge { flex: none; font-size: 10px; color: #059669; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 0 5px; white-space: nowrap; }',
    '.empty { padding: 14px; text-align: center; color: #9ca3af; font-size: 12px; }',
    '#foot { padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 8px; }',
    '.msg { min-height: 15px; font-size: 12px; }',
    '.msg.ok { color: #059669; }',
    '.msg.err { color: #dc2626; }',
    '.note { font-size: 10px; color: #9ca3af; text-align: center; }',
    /* ---- 折叠态：已收藏便携标签条 + toast ---- */
    '#recent { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; max-width: 340px; }',
    '#wrap.open #recent { display: none; }',
    '.chip { display: inline-flex; align-items: center; gap: 4px; background: #fff; border: 1px solid #dbeafe; border-radius: 999px; padding: 3px 9px; font-size: 11px; color: #1e40af; box-shadow: 0 2px 6px rgba(0,0,0,.08); max-width: 190px; cursor: pointer; }',
    '.chip:hover { border-color: #93c5fd; }',
    '.chip .kw { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.chip .x { cursor: pointer; border: none; background: none; color: #94a3b8; font-size: 12px; line-height: 1; padding: 0 0 0 2px; flex: none; }',
    '.chip .x:hover { color: #ef4444; }',
    '#toast { position: absolute; left: 0; bottom: calc(100% + 8px); background: rgba(16,185,129,.95); color: #fff; font-size: 12px; padding: 5px 12px; border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,.18); white-space: nowrap; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 1; }',
    '#toast.show { opacity: 1; }',
    '#wrap.open #toast { display: none; }'
  ].join('\n');

  var host = document.createElement('div');
  document.documentElement.appendChild(host);
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML =
    '<style>' + STYLE + '</style>' +
    '<div id="wrap" class="right">' +
    '  <div id="pill" title="咪卡灵感收藏助手（按住可拖动）">' +
    '    <span class="dot" id="pillDot"></span>' +
    '    <span class="brand">📥 咪卡</span>' +
    '    <button class="btn save" id="pillSave" title="收藏当前页到收藏库">📌 收藏本页</button>' +
    '    <button class="btn toggle" id="pillOpen">⚡</button>' +
    '  </div>' +
    '  <div id="toast"></div>' +
    '  <div id="recent"></div>' +
    '  <div id="panel">' +
    '    <div class="p-head">' +
    '      <span class="t">📥 咪卡灵感收藏助手</span>' +
    '      <span class="dot" id="headDot"></span>' +
    '      <button class="btn fold" id="btnFold" title="折叠回胶囊">⏷ 折叠</button>' +
    '    </div>' +
    '    <div class="cur">' +
    '      <div class="cur-title" id="curTitle">读取中…</div>' +
    '      <div class="cur-url" id="curUrl"></div>' +
    '      <button class="btn primary" id="btnSave">📌 收藏当前页</button>' +
    '    </div>' +
    '    <div class="tabs-wrap">' +
    '      <div class="tabs-head"><span>📚 全部标签（<span id="tabCount">0</span> 个有效）</span>' +
    '      <label><input type="checkbox" id="chkAll" checked> 全选</label></div>' +
    '      <div class="tabs-list" id="tabList"><div class="empty">读取中…</div></div>' +
    '    </div>' +
    '    <div class="foot">' +
    '      <button class="btn primary" id="btnBatch" disabled>📥 批量收藏选中</button>' +
    '      <div class="msg" id="msg"></div>' +
    '      <div class="note">仅读取标签页地址 · 不读取任何隐私数据 · 批量需勾选确认</div>' +
    '    </div>' +
    '  </div>' +
    '</div>';

  var wrap = shadow.getElementById('wrap');
  var pill = shadow.getElementById('pill');
  var panel = shadow.getElementById('panel');
  var tabs = [];
  var checked = {};
  var savedSet = {};   // 已在收藏库的 URL 集合（展开面板标记）
  var connOk = false;
  var msgTimer = null;
  var recent = [];
  var toastTimer = null;

  function $(id) { return shadow.getElementById(id); }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function send(msg, cb) {
    try {
      chrome.runtime.sendMessage(msg, function (r) {
        if (chrome.runtime.lastError) { cb && cb({ ok: false, error: chrome.runtime.lastError.message }); return; }
        cb && cb(r);
      });
    } catch (e) { cb && cb({ ok: false, error: '扩展消息发送失败' }); }
  }
  function setMsg(text, ok) {
    var m = $('msg');
    m.textContent = text || '';
    m.className = 'msg ' + (ok ? 'ok' : 'err');
    if (msgTimer) clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { m.textContent = ''; }, 5000);
  }
  function setDots(ok) {
    connOk = !!ok;
    $('pillDot').className = 'dot ' + (ok ? 'ok' : 'err');
    $('headDot').className = 'dot ' + (ok ? 'ok' : 'err');
  }
  function ping() {
    send({ type: 'ping' }, function (r) { setDots(r && r.ok); });
  }

  // ---- 已收藏便携标签条（折叠态胶囊下方） ----
  // 智能关键词提取：去站点名/通用噪声 → 分隔符切分 → 信息量评分选最优片段
  var SITE_WORDS = ['liblib', '哩布哩布', 'jimeng', '即梦', 'midjourney', 'mj', '小红书', 'xiaohongshu',
    'pinterest', 'artstation', '可灵', 'kling', '海螺', 'hailuo', 'civitai', 'b站', 'bilibili', '哔哩哔哩',
    '微博', 'weibo', '知乎', 'zhihu', '抖音', 'douyin', '快手', 'kuaishou', '花瓣', 'huaban', '站酷', 'zcool',
    'pixiv', 'behance', 'dribbble', 'instagram', 'youtube', 'google', 'baidu', '百度', '淘宝', 'taobao',
    '京东', 'jd', 'amazon', '首页', 'home', 'untitled', '无标题', '登录', '注册', '错误', '404',
    'not found', 'page not found'];

  function isNoise(s) {
    var low = s.toLowerCase();
    if (SITE_WORDS.indexOf(low) >= 0) return true;
    // 片段完全由站点词组成（如 "liblib 哩布哩布" "即梦 AI 官网"）→ 逐词检查
    var tokens = low.split(/[\s\-]+/).filter(Boolean);
    if (tokens.length >= 1 && tokens.every(function (tk) {
      return SITE_WORDS.indexOf(tk) >= 0 ||
        ['ai', '官网', 'art', 'official', '官方', 'app', 'web'].indexOf(tk) >= 0;
    })) return true;
    // 站点词开头 + 极短尾巴（≤4 字符，如 "liblibai" "mj官网"）
    if (SITE_WORDS.some(function (w) { return w.length >= 3 && low.indexOf(w) === 0 && low.length <= w.length + 4; })) return true;
    return ['404', 'not found', 'page not found', 'untitled', '无标题', '首页', 'home', 'official'].indexOf(low) >= 0;
  }

  function scorePart(s) {
    var len = s.length;
    if (len >= 4 && len <= 18) return 100 - Math.abs(len - 10);
    return Math.min(len, 30);
  }

  function extractKeyword(title) {
    if (!title) return '';
    var parts = String(title).split(/[-–—|_·:：,，。()（）【】\[\]\/\\]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) parts = [String(title).trim()];
    var kept = parts.filter(function (p) { return !isNoise(p); });
    if (!kept.length) return '';
    kept.sort(function (a, b) { return scorePart(b) - scorePart(a); });
    return kept[0].slice(0, 14);
  }

  function kwOf(title, url) {
    var kw = extractKeyword(title);
    if (!kw) {
      try { kw = url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '').slice(0, 14); } catch (e) { kw = url.slice(0, 14); }
    }
    return kw;
  }
  function saveRecent() {
    try { chrome.storage.local.set({ mikaCcRecent: recent }); } catch (e) {}
  }
  function renderRecent() {
    var box = $('recent');
    if (!box) return;
    if (!recent.length) { box.innerHTML = ''; return; }
    box.innerHTML = recent.map(function (r) {
      var tip = r.title ? (r.kw + ' · ' + r.title) : r.url;
      return '<span class="chip" title="' + esc(tip) + '">' +
        '<span class="kw">' + esc(r.kw) + '</span>' +
        '<button class="x" data-url="' + esc(r.url).replace(/"/g, '&quot;') + '" title="从收藏库移除">✕</button></span>';
    }).join('');
  }
  function loadRecent(cb) {
    try {
      chrome.storage.local.get('mikaCcRecent', function (o) {
        recent = (o && o.mikaCcRecent) || [];
        renderRecent();
        cb && cb();
      });
    } catch (e) { cb && cb(); }
  }
  function addRecent(urls, titleMap) {
    if (!urls || !urls.length) return;
    var now = Date.now();
    urls.forEach(function (u, i) {
      var t = (titleMap ? titleMap[u] : '') || '';
      var item = { url: u, kw: kwOf(t, u), title: t, ts: now + i };
      var idx = recent.findIndex(function (r) { return r.url === u; });
      if (idx >= 0) recent[idx] = item; else recent.push(item);
    });
    recent.sort(function (a, b) { return b.ts - a.ts; });
    recent = recent.slice(0, 20);
    saveRecent();
    renderRecent();
  }
  function removeRecent(url, ev) {
    if (ev) { ev.stopPropagation(); ev.preventDefault(); }
    send({ type: 'deleteByUrl', url: url }, function (r) {
      if (r && r.ok) {
        recent = recent.filter(function (x) { return x.url !== url; });
        delete savedSet[url];
        saveRecent();
        renderRecent();
        renderTabs();
        showToast('🗑 已从收藏库移除');
      } else {
        showToast('❌ 移除失败：' + ((r && r.error) || '服务未连接'));
      }
    });
  }
  function showToast(text) {
    var t = $('toast');
    if (!t) return;
    t.textContent = text || '';
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ---- 位置恢复/越界修正 ----
  function clampPos() {
    var x = wrap.offsetLeft, y = wrap.offsetTop;
    x = Math.max(4, Math.min(window.innerWidth - 80, x));
    y = Math.max(4, Math.min(window.innerHeight - 40, y));
    wrap.style.left = x + 'px';
    wrap.style.top = y + 'px';
    // 面板向右溢出时贴右
    wrap.classList.toggle('right', x + 370 > window.innerWidth);
  }
  chrome.storage.local.get('mikaCcPos', function (o) {
    var p = o && o.mikaCcPos;
    wrap.style.left = (p ? p.x : window.innerWidth - 190) + 'px';
    wrap.style.top = (p ? p.y : window.innerHeight - 80) + 'px';
    clampPos();
  });
  window.addEventListener('resize', clampPos);

  // ---- 拖拽（胶囊 + 展开面板头部均可拖） ----
  function attachDrag(el, excludeSel) {
    var drag = null;
    el.addEventListener('pointerdown', function (e) {
      if (excludeSel && e.target.closest(excludeSel)) return;
      drag = { sx: e.clientX, sy: e.clientY, ox: wrap.offsetLeft, oy: wrap.offsetTop };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag) return;
      wrap.style.left = Math.max(0, Math.min(window.innerWidth - 60, drag.ox + e.clientX - drag.sx)) + 'px';
      wrap.style.top = Math.max(0, Math.min(window.innerHeight - 40, drag.oy + e.clientY - drag.sy)) + 'px';
    });
    el.addEventListener('pointerup', function () {
      if (!drag) return;
      clampPos();
      chrome.storage.local.set({ mikaCcPos: { x: wrap.offsetLeft, y: wrap.offsetTop } });
      drag = null;
    });
  }
  attachDrag(pill);
  var pHead = shadow.querySelector('.p-head');
  if (pHead) attachDrag(pHead, '.btn');

  // ---- 折叠/展开 ----
  function openPanel() {
    wrap.classList.add('open');
    clampPos();
    // 方向自适应：胶囊靠顶（上方放不下面板）时改为向下展开，防超出视口被遮挡
    var estH = Math.min(0.78 * window.innerHeight, 560);
    if (wrap.offsetTop - estH < 8) wrap.classList.add('up');
    else wrap.classList.remove('up');
    refresh();
  }
  function foldPanel() { wrap.classList.remove('open'); }
  $('pillOpen').addEventListener('click', openPanel);
  $('btnFold').addEventListener('click', foldPanel);

  // ---- 数据刷新 ----
  function refresh() {
    ping();
    send({ type: 'getSavedUrls' }, function (r) {
      if (r && r.ok && r.urls) { savedSet = r.urls; renderTabs(); }
    });
    send({ type: 'getActiveTab' }, function (r) {
      if (r && r.ok) {
        $('curTitle').textContent = r.title || '（无标题页面）';
        $('curUrl').textContent = r.url || '当前页面不是 http/https 网页';
        $('btnSave').disabled = !r.valid;
        $('pillSave').disabled = !r.valid;
      } else {
        $('curTitle').textContent = '—';
        $('curUrl').textContent = '无法读取当前页';
        $('btnSave').disabled = true;
        $('pillSave').disabled = true;
      }
    });
    send({ type: 'getAllTabs' }, function (r) {
      if (r && r.ok) {
        tabs = r.tabs || [];
        checked = {};
        tabs.forEach(function (t) { checked[t.url] = true; });
        renderTabs();
        if (r.skipped > 0) setMsg('已跳过 ' + r.skipped + ' 个非网页标签（chrome:// 等）', true);
      } else {
        $('tabList').innerHTML = '<div class="empty">读取标签失败</div>';
      }
    });
  }

  function renderTabs() {
    var list = $('tabList');
    var count = 0;
    tabs.forEach(function (t) { if (checked[t.url]) count++; });
    $('tabCount').textContent = tabs.length;
    $('btnBatch').disabled = tabs.length === 0 || count === 0;
    $('chkAll').checked = tabs.length > 0 && count === tabs.length;
    if (!tabs.length) {
      list.innerHTML = '<div class="empty">无有效标签（http/https 页面）</div>';
      return;
    }
    list.innerHTML = tabs.map(function (t) {
      var on = !!checked[t.url];
      var saved = savedSet[t.url] ? '<span class="saved-badge">📌 已收藏</span>' : '';
      return '<label class="tabitem' + (on ? ' on' : '') + '">' +
        '<input type="checkbox" data-url="' + esc(t.url).replace(/"/g, '&quot;') + '" ' + (on ? 'checked' : '') + '>' +
        '<span class="ti-line"><span class="ti-title">' + esc(t.title || t.url) + '</span>' + saved + '</span>' +
        '<span class="ti-url">' + esc(t.url) + '</span></label>';
    }).join('');
  }

  // ---- 收藏 ----
  function doSave(urls, btn, okMsg, titles) {
    btn.disabled = true;
    send({ type: 'save', urls: urls }, function (r) {
      if (r && r.ok) {
        // 便携标签 + 成功提示
        var map = {};
        (titles || []).forEach(function (t, i) { if (t) map[urls[i]] = t; });
        addRecent(urls, map);
        urls.forEach(function (u) { savedSet[u] = true; });
        renderTabs();
        showToast('✅ 已收藏 ' + urls.length + ' 条');
        setMsg(okMsg || ('✅ 已入库 ' + r.count + ' 条 → 待处理池'), true);
        refresh();
      } else {
        setMsg('❌ ' + ((r && r.error) || '入库失败'), false);
        showToast('❌ 收藏失败');
      }
      btn.disabled = false;
    });
  }

  function saveCurrent() {
    send({ type: 'getActiveTab' }, function (r) {
      if (!r || !r.valid) { setMsg('当前页面不是可收藏的网页', false); return; }
      doSave([r.url], $('btnSave'), '✅ 已收藏当前页 → 待处理池（自动抓取元数据）', [r.title]);
    });
  }
  $('btnSave').addEventListener('click', saveCurrent);
  $('pillSave').addEventListener('click', saveCurrent);

  $('chkAll').addEventListener('change', function (e) {
    if (e.target.checked) tabs.forEach(function (t) { checked[t.url] = true; });
    else checked = {};
    renderTabs();
  });
  $('tabList').addEventListener('change', function (e) {
    if (e.target.type !== 'checkbox') return;
    var url = e.target.getAttribute('data-url');
    if (e.target.checked) checked[url] = true; else delete checked[url];
    renderTabs();
  });
  $('btnBatch').addEventListener('click', function () {
    var urls = tabs.filter(function (t) { return checked[t.url]; }).map(function (t) { return t.url; });
    if (!urls.length) { setMsg('请先勾选要收藏的标签', false); return; }
    if (!confirm('将 ' + urls.length + ' 个标签回传至咪卡收藏库（待处理池）？')) return;
    var titles = {};
    tabs.forEach(function (t) { if (checked[t.url]) titles[t.url] = t.title; });
    var titleList = urls.map(function (u) { return titles[u]; });
    doSave(urls, $('btnBatch'), '✅ 已入库 ' + urls.length + ' 条 → 待处理池', titleList);
  });

  // 标签条事件（点击打开 / ✕ 删除）
  $('recent').addEventListener('click', function (e) {
    var x = e.target.closest('.x');
    if (x) { removeRecent(x.getAttribute('data-url'), e); return; }
    var chip = e.target.closest('.chip');
    if (chip && !e.target.closest('.x')) {
      var u = chip.querySelector('.x').getAttribute('data-url');
      if (u) window.open(u, '_blank');
    }
  });

  // 初始连接检测（不打扰用户，仅更新状态点）
  loadRecent(function () { ping(); });
})();
