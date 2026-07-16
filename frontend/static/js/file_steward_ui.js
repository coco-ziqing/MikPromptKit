/* -*- js -*-
 * Phase35.3-DAM — 资产管家 UI（自包含，强化版）
 * 入口：顶部「项目」下拉 → 「📁 资产管家」
 * 新增 DAM 能力：归档/代理预览/存储统计/完整性/通知
 * 版本 ?v=3，强刷生效
 */
var PK_FILESTEWARD = PK_FILESTEWARD || {};

// ─── 打开主面板 ───
PK_FILESTEWARD.open = function() {
  if (document.getElementById('fsOverlay')) { document.getElementById('fsOverlay').remove(); return; }
  var ov = document.createElement('div');
  ov.className = 'pk-auth-modal-overlay'; ov.id = 'fsOverlay';
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div class="pk-auth-modal" style="max-width:1100px;width:96vw;" onclick="event.stopPropagation()">' +
      '<div class="fs-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">' +
        '<h4 style="margin:0;display:flex;align-items:center;gap:8px;"><span>📁 资产管家</span>' +
          '<span id="fsNotifBadge" style="display:none;background:#ef4444;color:#fff;font-size:11px;padding:1px 6px;border-radius:10px;"></span>' +
        '</h4>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          '<button class="btn btn-sm btn-outline-secondary" onclick="PK_FILESTEWARD._showStorage()" style="font-size:12px;">📊 存储</button>' +
          '<button class="btn btn-sm btn-outline-secondary" onclick="PK_FILESTEWARD._showIntegrity()" style="font-size:12px;">🔍 自检</button>' +
          '<button class="btn btn-sm btn-outline-secondary" onclick="PK_FILESTEWARD.openPairCode()" style="font-size:12px;">🔗 连接电脑</button>' +
          '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'fsOverlay\').remove()" style="font-size:12px;">✕ 关闭</button>' +
        '</div>' +
      '</div>' +
      '<!-- 设备列表 -->' +
      '<div id="fsDeviceList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;max-height:60vh;overflow:auto;padding:2px;"></div>' +
      '<!-- 文件浏览面板（点进设备后） -->' +
      '<div id="fsFileBrowser" style="display:none;margin-top:12px;"></div>' +
      '<!-- 配对码弹窗 -->' +
      '<div id="fsPairPanel" style="display:none;margin-top:12px;"></div>' +
      '<!-- 存储统计弹窗 -->' +
      '<div id="fsStoragePanel" style="display:none;margin-top:12px;"></div>' +
      '<!-- 资产详情弹窗（内部） -->' +
      '<div id="fsAssetDetail" style="display:none;margin-top:12px;"></div>' +
    '</div>';
  document.body.appendChild(ov);
  PK_FILESTEWARD._loadDevices();
  PK_FILESTEWARD._loadUnreadCount();
};

// ─── 设备列表 ───
PK_FILESTEWARD._loadDevices = async function() {
  var el = document.getElementById('fsDeviceList'); if (!el) return;
  try {
    var r = await fetch('/api/devices'); var d = await r.json();
    if (!d.ok) { el.innerHTML = '<p style="color:var(--text-muted);">加载失败，请登录后重试</p>'; return; }

    // 同时加载告警
    var alerts = {};
    try {
      var ar = await fetch('/api/devices/alerts'); var ad = await ar.json();
      if (ad.ok) alerts = ad.summary || {};
    } catch(e) {}

    // 告警chips
    var alertHtml = '';
    if (alerts.new > 0) alertHtml += '<span class="fs-chip fs-chip-blue">🆕 新发现 ' + alerts.new + ' 个文件</span>';
    if (alerts.missing > 0) alertHtml += '<span class="fs-chip fs-chip-red">⚠ 缺失 ' + alerts.missing + '</span>';
    if (alerts.changed > 0) alertHtml += '<span class="fs-chip fs-chip-yellow">✏ 变更 ' + alerts.changed + '</span>';
    if (alerts.high_risk > 0) alertHtml += '<span class="fs-chip fs-chip-red" style="font-weight:600;">🔥 高危 ' + alerts.high_risk + '</span>';

    if (!d.devices || !d.devices.length) {
      var html = alertHtml + '<div class="fs-empty"><p>暂无连接的设备</p><p style="font-size:12px;color:var(--text-muted);">点击「🔗 连接电脑」在你的其他电脑上安装资产管家助手</p></div>';
      el.innerHTML = html;
      return;
    }

    var cards = '';
    for (var i = 0; i < d.devices.length; i++) {
      var dev = d.devices[i];
      var onlineDot = dev.online ? '<span class="fs-dot fs-dot-green"></span> 在线' : '<span class="fs-dot fs-dot-gray"></span> 离线';
      var timeAgo = PK_FILESTEWARD._timeAgo(dev.last_seen_at);
      var backupBar = '';
      if (dev.archived_count > 0) {
        var pct = Math.round((dev.backup_ratio || 0) * 100);
        backupBar = '<div class="fs-backup-bar"><div class="fs-backup-fill" style="width:'+pct+'%"></div></div>' +
                    '<span style="font-size:10px;color:var(--text-muted);">备份: '+dev.backed_up_count+'/'+dev.archived_count+' ('+pct+'%)</span>';
      }

      cards +=
        '<div class="fs-device-card" onclick="PK_FILESTEWARD._openDevice(' + dev.id + ',\'' + (dev.name || '未命名').replace(/'/g,'\\\'') + '\')">' +
          '<div class="fs-card-header">' +
            '<span class="fs-device-name">' + (dev.platform==='win'?'💻':dev.platform==='mac'?'🍎':'🐧') + ' ' + (dev.name||'未命名') + '</span>' +
            '<span style="font-size:11px;">' + onlineDot + ' · ' + timeAgo + '</span>' +
          '</div>' +
          '<div class="fs-card-body">' +
            '<div class="fs-stat-row"><span>📁 关注文件夹</span><span>' + (dev.path_count||0) + '</span></div>' +
            '<div class="fs-stat-row"><span>📄 文件</span><span>' + (dev.file_count||0) + '</span></div>' +
            (dev.new_count ? '<div class="fs-stat-row" style="color:#2563eb;"><span>🆕 新文件</span><span>' + dev.new_count + '</span></div>' : '') +
            (dev.missing_count ? '<div class="fs-stat-row" style="color:#dc2626;"><span>⚠ 找不到了</span><span>' + dev.missing_count + '</span></div>' : '') +
            '</div>' +
          (backupBar ? '<div class="fs-card-footer">' + backupBar + '</div>' : '') +
          '<div class="fs-card-action">查看文件 →</div>' +
        '</div>';
    }
    el.innerHTML = alertHtml + cards;
  } catch(e) { el.innerHTML = '<p style="color:var(--text-muted);">加载失败: ' + e.message + '</p>'; }
};

// ─── 打开设备 → 浏览文件 ───
PK_FILESTEWARD._openDevice = function(deviceId, deviceName) {
  var fb = document.getElementById('fsFileBrowser');
  fb.style.display = 'block';
  fb.innerHTML =
    '<div style="border-bottom:1px solid var(--border-color);padding-bottom:8px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'fsFileBrowser\').style.display=\'none\';PK_FILESTEWARD._loadDevices();">← 返回</button>' +
        '<strong>' + deviceName + '</strong>' +
      '</div>' +
      '<div style="display:flex;gap:6px;">' +
        '<input type="text" id="fsFileSearch" placeholder="搜索文件名..." oninput="PK_FILESTEWARD._loadFiles('+deviceId+')" style="font-size:12px;padding:3px 8px;border:1px solid var(--border-color);border-radius:4px;width:180px;">' +
        '<select id="fsStateFilter" onchange="PK_FILESTEWARD._loadFiles('+deviceId+')" style="font-size:12px;padding:3px 6px;">' +
          '<option value="">全部</option><option value="new">🆕 新文件</option><option value="changed">✏ 已修改</option><option value="missing">⚠ 找不到</option><option value="archived">📦 已加入项目</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div id="fsFileList" style="max-height:45vh;overflow:auto;"><div class="fs-spinner"></div></div>' +
    '<div id="fsBatchBar" style="display:none;margin-top:8px;padding:8px;border-top:1px solid var(--border-color);text-align:right;"></div>';
  PK_FILESTEWARD._loadFiles(deviceId);
  fb.scrollIntoView({behavior:'smooth'});
};

PK_FILESTEWARD._loadFiles = async function(deviceId) {
  var el = document.getElementById('fsFileList'); if (!el) return;
  var search = document.getElementById('fsFileSearch')?.value || '';
  var state = document.getElementById('fsStateFilter')?.value || '';
  try {
    var url = '/api/devices/' + deviceId + '/files?limit=200&offset=0';
    if (state) url += '&state=' + state;
    if (search) url += '&search=' + encodeURIComponent(search);
    var r = await fetch(url); var d = await r.json();
    if (!d.ok) { el.innerHTML = '<p style="color:var(--text-muted);">加载失败</p>'; return; }
    if (!d.items.length) { el.innerHTML = '<div class="fs-empty"><p>没有找到文件</p></div>'; return; }

    var rows = '';
    for (var i = 0; i < d.items.length; i++) {
      var f = d.items[i];
      var stateTag = '';
      if (f.state === 'new') stateTag = '<span class="fs-tag fs-tag-new">🆕 新文件</span>';
      else if (f.state === 'changed') stateTag = '<span class="fs-tag fs-tag-changed">✏ 已修改</span>';
      else if (f.state === 'missing') stateTag = '<span class="fs-tag fs-tag-missing">⚠ 找不到了</span>';
      else if (f.state === 'archived') stateTag = '<span class="fs-tag fs-tag-archived">📦 已加入项目</span>';

      var sizeStr = f.size ? (f.size > 1024*1024 ? (f.size/1024/1024).toFixed(1)+' MB' : (f.size/1024).toFixed(1)+' KB') : '';

      rows +=
        '<div class="fs-file-row" style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border-color);gap:12px;">' +
          '<span style="font-size:20px;">' + PK_FILESTEWARD._fileIcon(f.ext||f.filename) + '</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (f.filename||f.rel_path) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">' + sizeStr + (stateTag ? ' · ' : '') + stateTag + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:4px;flex-shrink:0;">' +
            (f.state !== 'archived' ? '<button class="btn btn-sm btn-outline-success" onclick="PK_FILESTEWARD._promptArchive('+f.id+',\''+(f.filename||'').replace(/'/g,'\\\'')+'\')" style="font-size:11px;" title="存入资料库">＋ 加入项目</button>' : '') +
            '<button class="btn btn-sm btn-outline-secondary" onclick="PK_FILESTEWARD._removeFile('+f.id+','+deviceId+')" style="font-size:11px;" title="从列表移除（不删除文件）">✕</button>' +
          '</div>' +
        '</div>';
    }
    el.innerHTML = rows;

    // 批量操作栏
    var batchEl = document.getElementById('fsBatchBar');
    if (batchEl) {
      batchEl.style.display = 'block';
      batchEl.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">共 ' + d.total + ' 个文件</span>';
    }
  } catch(e) { el.innerHTML = '<p style="color:var(--text-muted);">加载失败: ' + e.message + '</p>'; }
};

// ─── 归档向导 ───
PK_FILESTEWARD._promptArchive = async function(fileIndexId, filename) {
  // 获取项目列表
  var projects = [];
  try {
    var r = await fetch('/api/projects'); var d = await r.json();
    if (d.ok) projects = d.projects || [];
  } catch(e) {}

  var opts = '';
  for (var i = 0; i < projects.length; i++) {
    opts += '<option value="' + projects[i].id + '">' + (projects[i].name||'项目#'+projects[i].id) + '</option>';
  }

  var adPanel = document.createElement('div');
  adPanel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-width:400px;width:90vw;';
  adPanel.innerHTML =
    '<h5 style="margin-top:0;">📦 将文件存入资料库</h5>' +
    '<p style="font-size:13px;color:var(--text-muted);">' + filename + '</p>' +
    '<p style="font-size:12px;color:var(--text-muted);">存入后，文件将被拷贝压缩存档到服务器，原工作文件不受影响。</p>' +
    '<div style="margin-bottom:8px;"><label style="font-size:12px;">目标项目</label><select id="fsArchProject" style="width:100%;padding:6px;border:1px solid var(--border-color);border-radius:4px;">' + opts + '</select></div>' +
    '<div style="margin-bottom:8px;"><label style="font-size:12px;">模块分类</label><select id="fsArchModule" style="width:100%;padding:6px;border:1px solid var(--border-color);border-radius:4px;">' +
      '<option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option>' +
      '<option value="project_c4d">C4D 工程</option><option value="project_ps">PS 工程</option>' +
      '<option value="project_ae">AE 工程</option><option value="other">其他</option></select></div>' +
    '<div style="margin-bottom:12px;"><label style="font-size:12px;"><input type="checkbox" id="fsArchCritical"> 标记为重要资产（开启自动备份）</label></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button class="btn btn-sm btn-secondary" onclick="this.parentElement.parentElement.remove()">取消</button>' +
      '<button class="btn btn-sm btn-primary" onclick="PK_FILESTEWARD._doArchive('+fileIndexId+',this)">存入资料库</button>' +
    '</div>';
  adPanel.id = 'fsArchPanel';
  document.body.appendChild(adPanel);
};

PK_FILESTEWARD._doArchive = async function(fileIndexId, btnEl) {
  var psid = document.getElementById('fsArchProject')?.value;
  var mod = document.getElementById('fsArchModule')?.value || 'other';
  var crit = document.getElementById('fsArchCritical')?.checked ? 1 : 0;
  if (!psid) { alert('请选择目标项目'); return; }

  btnEl.disabled = true; btnEl.textContent = '处理中...';
  try {
    var r = await fetch('/api/devices/files/' + fileIndexId + '/archive', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({project_space_id: parseInt(psid), module_key: mod, is_critical: crit})
    });
    var d = await r.json();
    if (d.ok) {
      var panel = document.getElementById('fsArchPanel');
      if (panel) panel.innerHTML =
        '<h5 style="margin-top:0;">✅ 已登记</h5>' +
        '<p style="font-size:13px;">文件已标记为待归档，设备助手将在下次心跳时自动上传文件字节。</p>' +
        '<p style="font-size:12px;color:var(--text-muted);">' + (d.message||'') + '</p>' +
        '<button class="btn btn-sm btn-secondary" onclick="this.parentElement.remove()">关闭</button>';
    } else {
      alert('归档失败: ' + (d.detail || d.error || ''));
    }
  } catch(e) { alert('请求失败: ' + e.message); }
};

// ─── 移除文件索引 ───
PK_FILESTEWARD._removeFile = async function(fid, deviceId) {
  if (!confirm('确定将此文件从列表中移除？不会删除原文件。')) return;
  try {
    await fetch('/api/devices/' + deviceId + '/files/' + fid, {method:'DELETE'});
    PK_FILESTEWARD._loadFiles(deviceId);
  } catch(e) {}
};

// ─── 配对码 ───
PK_FILESTEWARD.openPairCode = async function() {
  var panel = document.getElementById('fsPairPanel');
  panel.style.display = 'block';
  panel.innerHTML = '<div class="fs-spinner"></div>';
  try {
    var r = await fetch('/api/devices/pair-code', {method:'POST'});
    var d = await r.json();
    if (!d.ok) { panel.innerHTML = '<p style="color:red;">生成失败</p>'; return; }
    panel.innerHTML =
      '<div style="border:1px solid var(--border-color);border-radius:8px;padding:16px;text-align:center;">' +
        '<h5>🔗 连接新电脑</h5>' +
        '<p style="font-size:12px;color:var(--text-muted);">在新电脑上打开「资产管家助手」输入以下配对码</p>' +
        '<div style="font-size:36px;font-weight:700;letter-spacing:8px;font-family:monospace;margin:12px 0;">' + d.code + '</div>' +
        '<div id="fsPairCountdown" style="font-size:12px;color:var(--text-muted);">有效期 5:00</div>' +
        '<p style="font-size:11px;color:var(--text-muted);margin-top:8px;">配对码 5 分钟后失效，需在同网络下使用</p>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="PK_FILESTEWARD._copyCode(\''+d.code+'\')">📋 复制</button>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'fsPairPanel\').style.display=\'none\'" style="margin-left:6px;">关闭</button>' +
      '</div>';
    // 倒计时
    var remain = 300, cdEl = document.getElementById('fsPairCountdown');
    var timer = setInterval(function() {
      remain--; if (remain <= 0 || !cdEl) { clearInterval(timer); return; }
      cdEl.textContent = '有效期 ' + Math.floor(remain/60) + ':' + ('0'+(remain%60)).slice(-2);
    }, 1000);
  } catch(e) { panel.innerHTML = '<p style="color:red;">请求失败: ' + e.message + '</p>'; }
};

PK_FILESTEWARD._copyCode = function(code) {
  navigator.clipboard.writeText(code).then(function() {
    alert('配对码已复制: ' + code);
  });
};

// ─── 存储统计 ───
PK_FILESTEWARD._showStorage = async function() {
  var panel = document.getElementById('fsStoragePanel');
  panel.style.display = 'block';
  panel.innerHTML = '<div class="fs-spinner"></div>';
  try {
    var r = await fetch('/api/dam/storage'); var d = await r.json();
    if (!d.ok) { panel.innerHTML = '<p style="color:red;">加载失败</p>'; return; }
    var s = d.stats;
    panel.innerHTML =
      '<div style="border:1px solid var(--border-color);border-radius:8px;padding:16px;">' +
        '<h5 style="margin-top:0;">📊 存储空间</h5>' +
        '<div class="fs-stat-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">' +
          '<div><strong>资料库资产</strong></div><div style="text-align:right;">' + (s.catalog_count||0) + ' 个</div>' +
          '<div>原始大小</div><div style="text-align:right;">' + PK_FILESTEWARD._fmtSize(s.original_size) + '</div>' +
          '<div>压缩后</div><div style="text-align:right;color:#059669;">' + PK_FILESTEWARD._fmtSize(s.compressed_size) + '</div>' +
          '<div>节省空间</div><div style="text-align:right;color:#059669;font-weight:600;">' + PK_FILESTEWARD._fmtSize(s.space_saved) + ' (' + (s.space_saved_pct||0) + '%)</div>' +
          '<div>去重文件</div><div style="text-align:right;">' + (s.blob_unique||0) + ' 个实体 / ' + (s.blob_count||0) + ' 引用</div>' +
          '<div>代理文件</div><div style="text-align:right;">' + (s.proxy_count||0) + ' 个 · ' + PK_FILESTEWARD._fmtSize(s.proxy_size) + '</div>' +
          '<div style="grid-column:1/-1;font-weight:600;margin-top:4px;">总计占用</div>' +
          '<div style="grid-column:1/-1;text-align:right;font-size:16px;font-weight:700;">' + PK_FILESTEWARD._fmtSize(s.total_archive_size) + '</div>' +
        '</div>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'fsStoragePanel\').style.display=\'none\'" style="margin-top:8px;">关闭</button>' +
      '</div>';
  } catch(e) { panel.innerHTML = '<p style="color:red;">加载失败: ' + e.message + '</p>'; }
};

// ─── 完整性自检 ───
PK_FILESTEWARD._showIntegrity = async function() {
  var panel = document.getElementById('fsStoragePanel');
  panel.style.display = 'block';
  panel.innerHTML = '<div class="fs-spinner"></div>';
  try {
    var r = await fetch('/api/dam/integrity-check'); var d = await r.json();
    if (!d.ok) { panel.innerHTML = '<p style="color:red;">需要管理员权限</p>'; return; }
    var icon = d.healthy ? '✅' : '⚠️';
    var color = d.healthy ? '#059669' : '#dc2626';
    var text = d.healthy ? '所有存档完好' : '发现 ' + d.issues.length + ' 类问题';
    var issuesHtml = '';
    for (var i = 0; i < (d.issues||[]).length; i++) {
      var iss = d.issues[i];
      issuesHtml += '<div style="padding:6px;border:1px solid var(--border-color);border-radius:4px;margin:4px 0;font-size:12px;">' +
        '<strong>' + iss.type + '</strong>: ' + iss.count + ' 项' +
        (iss.samples ? '<br>示例: ' + iss.samples.join(', ') : '') +
      '</div>';
    }
    panel.innerHTML =
      '<div style="border:1px solid var(--border-color);border-radius:8px;padding:16px;">' +
        '<h5 style="margin-top:0;">🔍 完整性自检</h5>' +
        '<div style="text-align:center;font-size:24px;margin:12px 0;color:'+color+';">' + icon + ' ' + text + '</div>' +
        issuesHtml +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'fsStoragePanel\').style.display=\'none\'" style="margin-top:8px;">关闭</button>' +
      '</div>';
  } catch(e) {
    panel.innerHTML = '<p style="color:red;">' + (e.status === 403 ? '需要管理员权限查看' : '请求失败: ' + e.message) + '</p>';
  }
};

// ─── 未读通知数 ───
PK_FILESTEWARD._loadUnreadCount = async function() {
  try {
    var r = await fetch('/api/dam/notifications?is_read=0&limit=1'); var d = await r.json();
    if (d.ok && d.unread > 0) {
      var badge = document.getElementById('fsNotifBadge');
      if (badge) { badge.style.display = 'inline'; badge.textContent = d.unread; }
    }
  } catch(e) {}
};

// ─── 辅助函数 ───
PK_FILESTEWARD._timeAgo = function(dt) {
  if (!dt) return '从未';
  try {
    var ts = Date.parse(dt.replace(' ','T') + (dt.includes('Z')?'':'+08:00'));
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff/60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff/3600) + ' 小时前';
    return Math.floor(diff/86400) + ' 天前';
  } catch(e) { return dt.slice(0,10); }
};

PK_FILESTEWARD._fmtSize = function(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes > 1024*1024*1024) return (bytes/1024/1024/1024).toFixed(1) + ' GB';
  if (bytes > 1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
  return (bytes/1024).toFixed(1) + ' KB';
};

PK_FILESTEWARD._fileIcon = function(ext) {
  e = (ext||'').toLowerCase();
  if ('.jpg.png.webp.gif.bmp'.indexOf(e) >= 0) return '🖼';
  if ('.mp4.mov.avi.mkv'.indexOf(e) >= 0) return '🎬';
  if ('.wav.mp3.flac'.indexOf(e) >= 0) return '🎵';
  if ('.c4d.blend.max.fbx.obj'.indexOf(e) >= 0) return '🎨';
  if ('.psd.ai'.indexOf(e) >= 0) return '🖌';
  if ('.ae.prproj'.indexOf(e) >= 0) return '🎞';
  return '📄';
};

console.log('📁 资产管家 UI 已加载 (DAM enhanced v3)');
