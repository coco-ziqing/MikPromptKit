// 咪卡灵感收藏助手 — 后台服务（MV3 Service Worker）
// 职责：读取标签 URL → 回传本地应用 API；仅读取 URL，不读取任何隐私数据
// 合规：多标签批量入库必须经 popup 用户勾选确认（应用内 /urls/batch/preview 预展示逻辑由前端复用）
const API = 'http://127.0.0.1:8080/api/card-collect';

function apiFetch(path, body) {
  return fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  }).then(function (r) {
    return r.json().catch(function () { return { ok: false, error: '响应解析失败' }; });
  }).catch(function () {
    return { ok: false, error: '无法连接咪卡服务（127.0.0.1:8080），请确认服务已启动' };
  });
}

function apiGet(path) {
  return fetch(API + path, { method: 'GET' })
    .then(function (r) { return { ok: r.ok || r.status < 500, status: r.status }; })
    .catch(function () { return { ok: false, status: 0 }; });
}

function isValidUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function normalizeTabs(tabs) {
  var out = [];
  (tabs || []).forEach(function (t) {
    if (t && t.url && isValidUrl(t.url)) {
      out.push({ url: t.url, title: t.title || '' });
    }
  });
  return out;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== 'string') return false;

  // 服务可达性探测（悬浮面板连接状态点）
  if (msg.type === 'ping') {
    apiGet('/favorites').then(sendResponse);
    return true;
  }

  // 当前激活标签：content script 场景用 sender.tab（更准确），popup 场景回退 query
  if (msg.type === 'getActiveTab') {
    var done = function (t) {
      sendResponse({
        ok: true,
        url: (t && isValidUrl(t.url)) ? t.url : '',
        title: (t && t.title) || '',
        valid: !!(t && isValidUrl(t.url))
      });
    };
    if (sender && sender.tab && sender.tab.id) { done(sender.tab); return true; }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) { done((tabs || [])[0]); });
    return true;
  }

  // 全部标签（当前窗口，过滤非 http/https）
  if (msg.type === 'getAllTabs') {
    chrome.tabs.query({ currentWindow: true }, function (tabs) {
      var norm = normalizeTabs(tabs);
      sendResponse({ ok: true, tabs: norm, total: (tabs || []).length, skipped: (tabs || []).length - norm.length });
    });
    return true;
  }

  // 预展示（不落库）：带已在库标记，供 popup 勾选确认
  if (msg.type === 'preview') {
    apiFetch('/urls/batch/preview', { urls: msg.urls || [] }).then(sendResponse);
    return true;
  }

  // 入库（仅收用户勾选确认后的 URL）
  if (msg.type === 'save') {
    apiFetch('/urls', { urls: msg.urls || [] }).then(sendResponse);
    return true;
  }

  // 已收藏 URL 集合（展开面板标签列表标记）
  if (msg.type === 'getSavedUrls') {
    fetch(API + '/favorites')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var urls = {};
        ((d && d.items) || []).forEach(function (i) { urls[i.url] = true; });
        sendResponse({ ok: true, urls: urls });
      })
      .catch(function () { sendResponse({ ok: false, error: '获取收藏列表失败' }); });
    return true;
  }

  // 按 URL 快捷删除收藏库条目（悬浮标签 ✕）：先查 id 再删
  if (msg.type === 'deleteByUrl') {
    fetch(API + '/favorites')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var items = (d && d.items) || [];
        var ids = items.filter(function (i) { return i.url === msg.url; }).map(function (i) { return i.id; });
        if (!ids.length) return { ok: true, deleted: 0 };
        return apiFetch('/urls/delete', { ids: ids });
      })
      .then(sendResponse)
      .catch(function () { sendResponse({ ok: false, error: '删除失败' }); });
    return true;
  }

  return false;
});
