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

  // 当前激活标签
  if (msg.type === 'getActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var t = (tabs || [])[0];
      sendResponse({
        ok: true,
        url: (t && isValidUrl(t.url)) ? t.url : '',
        title: (t && t.title) || '',
        valid: !!(t && isValidUrl(t.url))
      });
    });
    return true;
  }

  // 全部标签（过滤非 http/https）
  if (msg.type === 'getAllTabs') {
    chrome.tabs.query({}, function (tabs) {
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

  return false;
});
