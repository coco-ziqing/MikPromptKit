// 咪卡灵感收藏助手 — 后台服务（MV3 Service Worker）
// 职责：读取标签 URL → 回传本地/局域网应用 API；仅读取 URL，不读取任何隐私数据
// 合规：多标签批量入库必须经 popup/面板用户勾选确认
const API_DEFAULT = 'http://127.0.0.1:8080';

// v5.46.0: API 地址可配置（默认本机；局域网多机部署时指向主程序 IP，如 http://192.168.0.102:8080）
function getApi() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.local.get('mikaCcApi', function (o) {
        resolve(((o && o.mikaCcApi) || API_DEFAULT).replace(/\/+$/, ''));
      });
    } catch (e) { resolve(API_DEFAULT); }
  });
}

function apiFetch(path, body) {
  return getApi().then(function (api) {
    return fetch(api + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '响应解析失败' }; });
    }).catch(function () {
      return { ok: false, error: '无法连接咪卡服务（' + api + '），请检查服务地址设置' };
    });
  });
}

function apiGet(path) {
  return getApi().then(function (api) {
    return fetch(api + path, { method: 'GET' })
      .then(function (r) { return { ok: r.ok || r.status < 500, status: r.status }; })
      .catch(function () { return { ok: false, status: 0 }; });
  });
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

  // 服务地址 读取/设置（多机部署指向主程序局域网 IP）
  if (msg.type === 'getApi') {
    getApi().then(function (api) { sendResponse({ ok: true, api: api }); });
    return true;
  }
  if (msg.type === 'setApi') {
    var v = String(msg.api || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[\w.\-]+(:\d+)?$/.test(v)) { sendResponse({ ok: false, error: '地址格式非法，示例：http://192.168.0.102:8080' }); return true; }
    chrome.storage.local.set({ mikaCcApi: v }, function () { sendResponse({ ok: true }); });
    return true;
  }

  // 服务可达性探测（悬浮面板连接状态点）
  if (msg.type === 'ping') {
    apiGet('/api/card-collect/favorites').then(sendResponse);
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
    getApi().then(function (api) {
      return fetch(api + '/api/card-collect/favorites')
        .then(function (r) { return r.json(); });
    }).then(function (d) {
      var urls = {};
      ((d && d.items) || []).forEach(function (i) { urls[i.url] = true; });
      sendResponse({ ok: true, urls: urls });
    }).catch(function () { sendResponse({ ok: false, error: '获取收藏列表失败' }); });
    return true;
  }

  // 按 URL 快捷删除收藏库条目（悬浮标签 ✕）：先查 id 再删
  if (msg.type === 'deleteByUrl') {
    getApi().then(function (api) {
      return fetch(api + '/api/card-collect/favorites')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var items = (d && d.items) || [];
          var ids = items.filter(function (i) { return i.url === msg.url; }).map(function (i) { return i.id; });
          if (!ids.length) return { ok: true, deleted: 0 };
          return apiFetch('/urls/delete', { ids: ids });
        });
    }).then(sendResponse).catch(function () { sendResponse({ ok: false, error: '删除失败' }); });
    return true;
  }

  return false;
});
