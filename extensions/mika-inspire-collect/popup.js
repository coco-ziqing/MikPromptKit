// 咪卡灵感收藏助手 — 弹窗逻辑
// 合规：批量回传必须经用户勾选确认（全选默认勾选，确认后统一入库）

var tabs = [];
var checked = {};
var savedSet = {};   // v5.46.7: 已收藏 URL 集合（与悬浮面板一致）
var _msgTimer = null;

function $(id) { return document.getElementById(id); }

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function setMsg(text, ok) {
  var m = $('msg');
  m.textContent = text || '';
  m.className = 'msg ' + (ok ? 'ok' : 'err');
  if (_msgTimer) clearTimeout(_msgTimer);
  if (text) _msgTimer = setTimeout(function () { m.textContent = ''; }, 5000);
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

document.addEventListener('DOMContentLoaded', function () {
  var btnSave = $('btnSave');
  var btnBatch = $('btnBatch');
  var apiMsg = $('apiMsg');

  function checkConn() {
    // 当前页 + 连接检测
    chrome.runtime.sendMessage({ type: 'getActiveTab' }, function (res) {
      if (res && res.ok) {
        $('conn').textContent = '✅ 咪卡服务已连接';
        $('conn').className = 'conn ok';
        $('curTitle').textContent = res.title || '（无标题页面）';
        $('curUrl').textContent = res.url || '当前页面不是 http/https 网页';
        btnSave.disabled = !res.valid;
      } else {
        $('conn').textContent = '❌ 咪卡服务未连接';
        $('conn').className = 'conn err';
        $('curTitle').textContent = '—';
      }
    });
  }

  // 服务地址设置（多机部署指向主程序局域网 IP）
  checkConn();
  // 胶囊显示开关（v5.46.6）：全局生效，跨页面即时
  chrome.storage.local.get('mikaCcVisible', function (o) {
    $('chkCapsule').checked = o.mikaCcVisible !== false;
  });
  $('chkCapsule').addEventListener('change', function (e) {
    chrome.storage.local.set({ mikaCcVisible: e.target.checked }, function () {
      setMsg(e.target.checked ? '✅ 悬浮胶囊已显示' : '✅ 悬浮胶囊已隐藏（可随时重新开启）', true);
    });
  });
  $('btnSet').addEventListener('click', function () {
    var box = $('setBox');
    var show = box.style.display === 'none';
    box.style.display = show ? 'flex' : 'none';
    if (show) {
      chrome.runtime.sendMessage({ type: 'getApi' }, function (r) {
        if (r && r.ok) $('apiInput').value = r.api;
      });
    }
  });
  $('btnSaveApi').addEventListener('click', function () {
    var v = $('apiInput').value.trim();
    if (!v) { apiMsg.textContent = '请输入服务地址'; apiMsg.className = 'set-msg err'; return; }
    chrome.runtime.sendMessage({ type: 'setApi', api: v }, function (r) {
      if (r && r.ok) {
        apiMsg.textContent = '✅ 已保存，正在重新检测连接…';
        apiMsg.className = 'set-msg ok';
        $('setBox').style.display = 'none';
        checkConn();
      } else {
        apiMsg.textContent = '❌ ' + ((r && r.error) || '保存失败');
        apiMsg.className = 'set-msg err';
      }
    });
  });

  // 全部标签
  chrome.runtime.sendMessage({ type: 'getAllTabs' }, function (res) {
    if (res && res.ok) {
      tabs = res.tabs || [];
      checked = {};
      tabs.forEach(function (t) { if (isCollectableUrl(t.url).ok) checked[t.url] = true; });
      renderTabs();
      if (res.skipped > 0) setMsg('已跳过 ' + res.skipped + ' 个非网页标签（chrome://、扩展页等）', true);
    } else {
      $('tabList').innerHTML = '<div class="empty">读取标签失败</div>';
    }
  });
  // 已收藏 URL 集合（列表徽章）
  chrome.runtime.sendMessage({ type: 'getSavedUrls' }, function (r) {
    if (r && r.ok && r.urls) savedSet = r.urls;
  });

  // 收藏当前页
  btnSave.addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'getActiveTab' }, function (res) {
      if (!res || !res.valid) { setMsg('当前页面不是可收藏的网页', false); return; }
      btnSave.disabled = true;
      chrome.runtime.sendMessage({ type: 'save', urls: [res.url] }, function (r) {
        if (r && r.ok) setMsg('✅ 已收藏当前页 → 待处理池（自动抓取元数据）', true);
        else setMsg('❌ ' + ((r && r.error) || '收藏失败'), false);
        btnSave.disabled = false;
      });
    });
  });

  // 全选
  $('chkAll').addEventListener('change', function (e) {
    if (e.target.checked) tabs.forEach(function (t) { if (isCollectableUrl(t.url).ok) checked[t.url] = true; });
    else checked = {};
    renderTabs();
  });

  // 单个勾选
  $('tabList').addEventListener('change', function (e) {
    if (e.target.type !== 'checkbox') return;
    var url = e.target.getAttribute('data-url');
    if (e.target.checked) checked[url] = true; else delete checked[url];
    renderTabs();
  });

  // 批量收藏
  btnBatch.addEventListener('click', function () {
    var urls = tabs.filter(function (t) { return checked[t.url]; }).map(function (t) { return t.url; });
    if (!urls.length) { setMsg('请先勾选要收藏的标签', false); return; }
    if (!confirm('将 ' + urls.length + ' 个标签回传至咪卡收藏库（待处理池）？')) return;
    btnBatch.disabled = true;
    chrome.runtime.sendMessage({ type: 'save', urls: urls }, function (r) {
      if (r && r.ok) setMsg('✅ 已入库 ' + r.count + ' 条 → 待处理池', true);
      else setMsg('❌ ' + ((r && r.error) || '入库失败'), false);
      btnBatch.disabled = false;
    });
  });
});
