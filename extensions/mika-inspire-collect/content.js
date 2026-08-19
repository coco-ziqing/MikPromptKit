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
    '#pill { display: flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #e5e7eb; border-radius: 999px; padding: 6px 10px; box-shadow: 0 4px 16px rgba(0,0,0,.14); cursor: grab; user-select: none; white-space: nowrap; }',
    '#pill:hover { border-color: #93c5fd; box-shadow: 0 6px 20px rgba(59,130,246,.25); }',
    '#pill:active { cursor: grabbing; }',
    '#pill .btn { cursor: pointer; }',
    '#pill .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; flex: none; }',
    '#pill .dot.ok { background: #10b981; }',
    '#pill .dot.err { background: #ef4444; }',
    '#pill .brand { font-weight: 700; }',
    '#pill .btn { cursor: pointer; border: none; border-radius: 999px; padding: 5px 12px; font-size: 12px; }',
    '#pill .btn.save { background: #3b82f6; color: #fff; }',
    '#pill .btn.save.saved { background: #10b981; }',
    '#pill .btn.save:hover:not(:disabled) { background: #2563eb; }',
    '#pill .btn.save:disabled { background: #cbd5e1; cursor: not-allowed; }',
    '#pill .btn.toggle { background: #f3f4f6; color: #374151; }',
    '#pill .btn.toggle:hover { background: #e5e7eb; }',
    '#pill .btn.hide { background: transparent; color: #9ca3af; padding: 2px 5px; font-size: 11px; }',
    '#pill .btn.hide:hover { color: #ef4444; }',
    /* ---- 展开面板 ---- */
    '#panel { display: none; position: absolute; left: 0; bottom: 0; width: 360px; max-height: 78vh; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,.18); overflow: hidden; flex-direction: column; }',
    '#wrap.right #panel { left: auto; right: 0; }',
    '#wrap.up #panel { top: 0; bottom: auto; }',
    '#wrap.open #panel { display: flex; }',
    '#wrap.open #pill { display: none; }',
    '.p-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #f3f4f6; cursor: grab; user-select: none; }',
    '.p-head:hover { background: #f8fafc; }',
    '.p-head:active { cursor: grabbing; }',
    '.p-head .btn { cursor: pointer; }',
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
    '.cur-reason { font-size: 11px; color: #dc2626; margin: -2px 0 8px; line-height: 1.4; }',
    '.btn { cursor: pointer; border: none; border-radius: 8px; padding: 7px 0; font-size: 13px; width: 100%; }',
    '.btn.primary { background: #3b82f6; color: #fff; }',
    '.btn.primary.saved { background: #10b981; }',
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
    '.no-badge { flex: none; font-size: 10px; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 0 5px; white-space: nowrap; }',
    '.tabitem.no { opacity: .55; }',
    '#pill .btn.save.no { background: #cbd5e1; }',
    '.btn.primary.no { background: #cbd5e1; }',
    '.empty { padding: 14px; text-align: center; color: #9ca3af; font-size: 12px; }',
    '#foot { padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 8px; }',
    '.msg { min-height: 15px; font-size: 12px; }',
    '.msg.ok { color: #059669; }',
    '.msg.err { color: #dc2626; }',
    '.note { font-size: 10px; color: #9ca3af; text-align: center; }',
    /* ---- 服务地址设置（多机部署） ---- */
    '.set-row { display: flex; align-items: center; gap: 8px; }',
    '.link { cursor: pointer; border: none; background: none; color: #6b7280; font-size: 12px; padding: 0; }',
    '.link:hover { color: #3b82f6; }',
    '.api-now { font-size: 10px; color: #9ca3af; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }',
    '.set-box { display: flex; gap: 6px; align-items: center; }',
    '.set-box input { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 12px; }',
    '.set-box .btn { width: auto; padding: 6px 12px; font-size: 12px; background: #3b82f6; color: #fff; border-radius: 8px; }',
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
    '    <button class="btn hide" id="pillHide" title="隐藏悬浮胶囊（点扩展图标可恢复）">✕</button>' +
    '  </div>' +
    '  <div id="toast"></div>' +
    '  <div id="recent"></div>' +
    '  <div id="panel">' +
    '    <div class="p-head" title="按住此处拖动面板">' +
    '      <span class="t">📥 咪卡灵感收藏助手</span>' +
    '      <span class="dot" id="headDot"></span>' +
    '      <button class="btn fold" id="btnFold" title="折叠回胶囊">⏷ 折叠</button>' +
    '    </div>' +
    '    <div class="cur">' +
    '      <div class="cur-title" id="curTitle">读取中…</div>' +
    '      <div class="cur-url" id="curUrl"></div>' +
    '      <div class="cur-reason" id="curReason" style="display:none"></div>' +
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
    '      <div class="set-row"><button class="link" id="btnSetApi">⚙️ 服务地址</button><span class="api-now" id="apiNow"></span></div>' +
    '      <div class="set-row"><button class="link" id="btnHideCapsule">🙈 隐藏悬浮胶囊</button></div>' +
    '      <div class="set-box" id="setBox" style="display:none">' +
    '        <input id="apiInput" placeholder="http://192.168.0.102:8080">' +
    '        <button class="btn" id="btnSaveApi">保存</button>' +
    '      </div>' +
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
  var currentUrl = ''; // v5.46.3: 当前页 URL（收藏按钮状态感知）
  var currentTitle = '';
  var currentCollectable = { ok: true, reason: '' }; // v5.46.4: 当前页可收藏性
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
    function endDrag() {
      if (!drag) return;
      drag = null;
      clampPos();
      chrome.storage.local.set({ mikaCcPos: { x: wrap.offsetLeft, y: wrap.offsetTop } });
    }
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
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);  // 拖拽中断也结束，防粘住
    // 全局兜底：capture 丢失/松开在元素外时也结束拖拽
    document.addEventListener('pointerup', function () { if (drag) endDrag(); });
    document.addEventListener('pointercancel', function () { if (drag) endDrag(); });
  }
  attachDrag(pill, '.btn');
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

  // ---- v5.46.4: 页面可收藏性识别（防呆：主页/列表/搜索页多词卡禁止收藏） ----
  var LIST_HINTS = ['/search', '/explore', '/tags', '/tag/', '/category', '/discover', '/feed',
    '/collection', '/gallery', '/browse', '/list', '/index', '/models', '/posts', '/ideas',
    '/pins', '/artworks', '/works', '/videos', '/page', '/trending', '/popular', '/rank', '/top'];
  // v5.46.5: 详情页白名单段（命中且后跟 ID → 直接放行，防误拦）
  var DETAIL_HINTS = ['imageinfo', 'model', 'detail', 'post', 'artwork', 'pin', 'video', 'photo',
    'note', 'work', 'item', 'story', 'article', 'info', 'design', 'template', 'avatar', 'theme'];

  function isCollectableUrl(url) {
    try {
      var u = new URL(url);
      var segs = u.pathname.split('/').filter(Boolean);
      // 站点主页/根路径：包含大量词卡
      if (segs.length === 0) return { ok: false, reason: '这是站点主页，包含大量词卡，请打开单个作品详情页再收藏' };
      var low = segs.map(function (s) { return s.toLowerCase(); });
      for (var i = 0; i < low.length; i++) {
        // 详情段 + 后跟 ID → 详情页，直接放行（如 /imageinfo/a498...、/model/123、/pin/456）
        if (DETAIL_HINTS.indexOf(low[i]) >= 0 && i < low.length - 1) return { ok: true, reason: '' };
        // 详情段但无内容 ID（如裸 /imageinfo）→ 视为无效/列表，拦截
        if (DETAIL_HINTS.indexOf(low[i]) >= 0) {
          return { ok: false, reason: '详情页缺少内容 ID，请打开单个作品页面再收藏' };
        }
        // search/tag 段后跟任何内容都是搜索/标签聚合页（如 /search/pins、/tag/xx）
        if (low[i] === 'search' || low[i] === 'tag') {
          return { ok: false, reason: '这是搜索/标签聚合页（包含多个词卡），请打开单个作品详情页再收藏' };
        }
        if (LIST_HINTS.indexOf('/' + low[i]) >= 0) {
          // 分页数字段：page/2 仍视为列表
          if (low[i] === 'page' && low[i + 1] && /^\d+$/.test(low[i + 1])) {
            return { ok: false, reason: '这是分页/列表页，不适合收藏，请打开单个作品详情页' };
          }
          // 命中段后还有内容段 → 详情页（如 /explore/abc123、/models/987654、/works/xyz）
          if (i < low.length - 1) return { ok: true, reason: '' };
          return { ok: false, reason: '这是列表/搜索/聚合页（包含多个词卡），请进入单个作品详情页再收藏' };
        }
      }
      // 分页参数且无具体内容路径 → 列表页
      var q = (u.search || '').toLowerCase();
      if (low.length <= 1 && (q.indexOf('page=') >= 0 || q.indexOf('p=') >= 0 || q.indexOf('keyword=') >= 0 || q.indexOf('q=') >= 0)) {
        return { ok: false, reason: '这是分页/搜索列表页，不适合收藏，请打开单个作品详情页' };
      }
      return { ok: true, reason: '' };
    } catch (e) {
      return { ok: true, reason: '' }; // 解析失败保守放行
    }
  }

  // ---- v5.46.3: 当前页收藏状态感知按钮 ----
  function updateSaveBtn() {
    var saved = !!(currentUrl && savedSet[currentUrl]);
    var can = currentUrl && currentCollectable.ok;
    var p = $('pillSave'), b = $('btnSave');
    var r = $('curReason');
    if (r) {
      r.style.display = currentUrl && !currentCollectable.ok ? 'block' : 'none';
      r.textContent = currentUrl && !currentCollectable.ok ? '⛔ ' + currentCollectable.reason : '';
    }
    if (!currentUrl) {
      p.textContent = '📌 收藏本页'; p.className = 'btn save'; p.disabled = true;
      b.textContent = '📌 收藏当前页'; b.className = 'btn primary'; b.disabled = true;
      return;
    }
    if (!can) {
      p.textContent = '⛔ 不适合'; p.className = 'btn save no'; p.disabled = true;
      b.textContent = '⛔ 不适合收藏'; b.className = 'btn primary no'; b.disabled = true;
      return;
    }
    p.textContent = saved ? '✅ 已收藏' : '📌 收藏本页';
    p.className = 'btn save' + (saved ? ' saved' : '');
    p.disabled = false;
    b.textContent = saved ? '✅ 已收藏 · 点击取消' : '📌 收藏当前页';
    b.className = 'btn primary' + (saved ? ' saved' : '');
    b.disabled = false;
  }

  // 轻量刷新当前页状态（页面切换/导航时，不重拉全部标签）
  function refreshCurrent() {
    send({ type: 'getActiveTab' }, function (r) {
      if (r && r.ok && r.url) {
        currentUrl = r.url;
        currentTitle = r.title || '';
        currentCollectable = isCollectableUrl(currentUrl);
        $('curTitle').textContent = currentTitle || '（无标题页面）';
        $('curUrl').textContent = currentUrl;
      } else {
        currentUrl = '';
        currentTitle = '';
        currentCollectable = { ok: true, reason: '' };
        $('curTitle').textContent = '—';
        $('curUrl').textContent = '当前页面不是 http/https 网页';
      }
      updateSaveBtn();
    });
  }

  // 收藏/取消收藏切换（未收藏→收藏；已收藏→取消）
  function toggleSave() {
    if (!currentUrl) { showToast('❌ 当前页面不是可收藏的网页'); return; }
    if (!currentCollectable.ok) { showToast('⛔ ' + currentCollectable.reason); return; }
    if (savedSet[currentUrl]) {
      send({ type: 'deleteByUrl', url: currentUrl }, function (r) {
        if (r && r.ok) {
          delete savedSet[currentUrl];
          recent = recent.filter(function (x) { return x.url !== currentUrl; });
          saveRecent();
          renderRecent();
          renderTabs();
          updateSaveBtn();
          showToast('🗑 已取消收藏');
        } else showToast('❌ 取消失败：' + ((r && r.error) || '服务未连接'));
      });
    } else {
      doSave([currentUrl], $('btnSave'), '✅ 已收藏当前页 → 待处理池（自动抓取元数据）', [currentTitle]);
    }
  }

  // ---- 数据刷新 ----
  function refresh() {
    ping();
    send({ type: 'getSavedUrls' }, function (r) {
      if (r && r.ok && r.urls) { savedSet = r.urls; renderTabs(); updateSaveBtn(); }
    });
    refreshCurrent();
    send({ type: 'getAllTabs' }, function (r) {
      if (r && r.ok) {
        tabs = r.tabs || [];
        checked = {};
        tabs.forEach(function (t) {
          // v5.46.4: 防呆 — 主页/列表/搜索页默认不勾选且不可勾
          if (isCollectableUrl(t.url).ok) checked[t.url] = true;
        });
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
      var cl = isCollectableUrl(t.url);
      var no = !cl.ok ? '<span class="no-badge" title="' + esc(cl.reason) + '">⛔ 列表页</span>' : '';
      var noCls = cl.ok ? '' : ' no';
      return '<label class="tabitem' + (on ? ' on' : '') + noCls + '">' +
        '<input type="checkbox" data-url="' + esc(t.url).replace(/"/g, '&quot;') + '" ' + (on ? 'checked' : '') + (cl.ok ? '' : ' disabled') + '>' +
        '<span class="ti-line"><span class="ti-title">' + esc(t.title || t.url) + '</span>' + saved + no + '</span>' +
        '<span class="ti-url">' + esc(t.url) + '</span></label>';
    }).join('');
  }

  // ---- v5.46.6: 胶囊显示/隐藏全局开关（用户自主控制，跨页面即时生效） ----
  function applyVisibility() {
    try {
      chrome.storage.local.get('mikaCcVisible', function (o) {
        host.style.display = o.mikaCcVisible === false ? 'none' : '';
      });
    } catch (e) {}
  }
  applyVisibility();
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.mikaCcVisible) {
      host.style.display = changes.mikaCcVisible.newValue === false ? 'none' : '';
    }
  });
  $('pillHide').addEventListener('click', function () {
    try { chrome.storage.local.set({ mikaCcVisible: false }); } catch (e) {}
  });
  $('btnHideCapsule').addEventListener('click', function () {
    try { chrome.storage.local.set({ mikaCcVisible: false }); } catch (e) {}
  });

  // ---- 服务地址设置（多机部署：指向主程序局域网 IP） ----
  function showApiNow() {
    send({ type: 'getApi' }, function (r) { if (r && r.ok) $('apiNow').textContent = r.api; });
  }
  $('btnSetApi').addEventListener('click', function () {
    var box = $('setBox');
    var show = box.style.display === 'none';
    box.style.display = show ? 'flex' : 'none';
    if (show) send({ type: 'getApi' }, function (r) { if (r && r.ok) $('apiInput').value = r.api; });
  });
  $('btnSaveApi').addEventListener('click', function () {
    var v = $('apiInput').value.trim();
    if (!v) { showToast('❌ 请输入服务地址'); return; }
    send({ type: 'setApi', api: v }, function (r) {
      if (r && r.ok) {
        showToast('✅ 服务地址已保存');
        $('setBox').style.display = 'none';
        showApiNow();
        refresh();
      } else showToast('❌ ' + ((r && r.error) || '保存失败'));
    });
  });
  showApiNow();

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
        updateSaveBtn();
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

  // 单页收藏/取消（状态感知切换）
  $('btnSave').addEventListener('click', toggleSave);
  $('pillSave').addEventListener('click', toggleSave);

  $('chkAll').addEventListener('change', function (e) {
    if (e.target.checked) tabs.forEach(function (t) { if (isCollectableUrl(t.url).ok) checked[t.url] = true; });
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
  loadRecent(function () { ping(); refreshCurrent(); });

  // v5.46.3: 页面切换/导航完成通知 + SPA 内部路由轮询 → 自动刷新当前页收藏状态
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'tabChanged') refreshCurrent();
  });
  var lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      refreshCurrent();
    }
  }, 1500);
})();
