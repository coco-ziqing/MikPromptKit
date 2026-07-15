/* -*- js -*-
 * Phase35.3c — 设备盘索引管理器 UI（自包含，不侵入现有模块）
 * 入口：顶部「项目」下拉 → 「💻 设备盘索引」
 * 版本 ?v=1，强刷生效
 */
var PK_DEVICES = PK_DEVICES || {};

PK_DEVICES.open = function() {
  var ov = document.createElement('div');
  ov.className = 'pk-auth-modal-overlay'; ov.id = 'pkDevOverlay';
  ov.onclick = function(e){ if(e.target===ov) ov.remove(); };
  ov.innerHTML =
    '<div class="pk-auth-modal" style="max-width:960px;width:96vw;" onclick="event.stopPropagation()">'+
      '<h4 style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'+
        '<span>💻 设备盘索引</span>'+
        '<span style="display:flex;gap:6px;">'+
          '<button class="btn btn-sm btn-outline-secondary" onclick="PK_DEVICES.openPairCode()" style="font-size:12px;">🔗 配对设备</button>'+
          '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'pkDevOverlay\').remove()" style="font-size:12px;">✕ 关闭</button>'+
        '</span>'+
      '</h4>'+
      '<div id="pkDevAlerts" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;"></div>'+
      '<div id="pkDevList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;max-height:55vh;overflow:auto;"></div>'+
      '<div id="pkDevDetail" style="margin-top:12px;"></div>'+
    '</div>';
  document.body.appendChild(ov);
  PK_DEVICES.load();
};

PK_DEVICES.load = async function() {
  try {
    var r = await fetch('/api/devices'); var d = await r.json();
    if (!d.ok) { alert('加载失败'); return; }
    PK_DEVICES._renderAlerts();
    PK_DEVICES._renderList(d.devices);
  } catch(e) { console.error(e); }
};

PK_DEVICES._renderAlerts = async function() {
  var el = document.getElementById('pkDevAlerts'); if (!el) return;
  try {
    var r = await fetch('/api/devices/alerts'); var d = await r.json();
    if (!d.ok) return;
    var s = d.summary;
    var chips = [];
    if (s.new>0) chips.push('<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:12px;font-size:12px;">🆕 新文件 '+s.new+'</span>');
    if (s.missing>0) chips.push('<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:12px;">⚠ 缺失 '+s.missing+'</span>');
    if (s.changed>0) chips.push('<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;font-size:12px;">🔄 变更 '+s.changed+'</span>');
    if (s.high_risk>0) chips.push('<span style="background:#fecaca;color:#7f1d1d;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;">🔥 高危 '+s.high_risk+'</span>');
    if (s.failed_backups>0) chips.push('<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:12px;">❌ 备份失败 '+s.failed_backups+'</span>');
    if (!chips.length) chips.push('<span style="color:var(--text-muted);font-size:12px;">✅ 无告警</span>');
    el.innerHTML = chips.join('');
  } catch(e){}
};

PK_DEVICES._renderList = function(devices) {
  var el = document.getElementById('pkDevList'); if (!el) return;
  if (!devices.length) {
    el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">暂无设备，点击「🔗 配对设备」开始</div>';
    return;
  }
  var cards = devices.map(function(d){ return PK_DEVICES._card(d); }).join('');
  el.innerHTML = cards;
};

PK_DEVICES._card = function(d) {
  var icon = d.platform==='mac'?'🍎':(d.platform==='linux'?'🐧':'🪟');
  var online = d.online? '🟢 在线' : '⚫ 离线';
  var last = d.last_seen_at ? d.last_seen_at.substring(0,16) : '—';
  var pct = Math.round((d.backup_ratio||0)*100);
  var badge = d.new_count>0 ? '<span style="background:#3b82f6;color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;">+'+d.new_count+'</span>' : '';
  var warn = d.missing_count>0 ? '<span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;">!'+d.missing_count+'</span>' : '';

  return '<div class="pk-dev-card" style="background:var(--bg-card,#fff);border:1px solid var(--border-color);border-radius:12px;padding:14px;cursor:pointer;"'+
    ' onclick="PK_DEVICES.openDetail('+d.id+',\''+PK_DEVICES._e(d.name)+'\')">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'+
      '<strong style="font-size:15px;">'+icon+' '+PK_DEVICES._e(d.name)+'</strong>'+badge+warn+
    '</div>'+
    '<div style="display:flex;gap:12px;font-size:12px;color:var(--text-muted);margin-bottom:6px;">'+
      '<span>'+online+'</span><span>⏱ '+last+'</span>'+
    '</div>'+
    '<div style="display:flex;gap:8px;font-size:12px;flex-wrap:wrap;">'+
      '<span>📁 文件 '+d.file_count+'</span><span>📌 路径 '+d.path_count+'</span><span>🗄 归档 '+d.archived_count+'</span><span>💾 备份 '+d.backed_up_count+'</span>'+
    '</div>'+
    '<div style="margin-top:8px;height:6px;background:var(--border-color);border-radius:3px;">'+
      '<div style="height:6px;border-radius:3px;background:'+(pct<50?'#ef4444':pct<100?'#f59e0b':'#22c55e')+';width:'+pct+'%;"></div>'+
    '</div>'+
    '<div style="font-size:10px;color:var(--text-muted);text-align:right;">备份覆盖率 '+pct+'%</div>'+
  '</div>';
};

PK_DEVICES.openDetail = function(did, name) {
  var el = document.getElementById('pkDevDetail'); if (!el) return;
  el.innerHTML = '<div id="pkDevTabs" style="display:flex;border-bottom:1px solid var(--border-color);margin-bottom:10px;">'+
    '<button class="pk-dev-tab active" data-tab="files" onclick="PK_DEVICES._switchDetail('+did+',\'files\')" style="flex:1;padding:8px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--primary);border-bottom:2px solid var(--primary);">📄 文件索引</button>'+
    '<button class="pk-dev-tab" data-tab="paths" onclick="PK_DEVICES._switchDetail('+did+',\'paths\')" style="flex:1;padding:8px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-muted);border-bottom:2px solid transparent;">📂 监控路径</button>'+
    '</div>'+
    '<div id="pkDevDetailBody" style="max-height:40vh;overflow:auto;"></div>'+
    '<div style="display:flex;gap:6px;margin-top:8px;">'+
      '<button class="btn btn-sm btn-outline-secondary" onclick="PK_DEVICES.rename('+did+')" style="font-size:12px;">✏ 改名</button>'+
      '<button class="btn btn-sm btn-outline-danger" onclick="PK_DEVICES.revoke('+did+',\''+PK_DEVICES._e(name)+'\')" style="font-size:12px;">🗑 吊销</button>'+
    '</div>';
  PK_DEVICES._loadFiles(did, '');
};

PK_DEVICES._switchDetail = function(did, tab) {
  document.querySelectorAll('#pkDevTabs .pk-dev-tab').forEach(function(b){
    var on = b.getAttribute('data-tab')===tab;
    b.style.color = on ? 'var(--primary)' : 'var(--text-muted)';
    b.style.borderBottomColor = on ? 'var(--primary)' : 'transparent';
  });
  if (tab==='files') PK_DEVICES._loadFiles(did, document.getElementById('pkDevFileState')? document.getElementById('pkDevFileState').value : '');
  else PK_DEVICES._loadPaths(did);
};

PK_DEVICES._loadFiles = async function(did, state) {
  var url = '/api/devices/'+did+'/files?limit=200';
  if (state) url += '&state='+state;
  try {
    var r = await fetch(url); var d = await r.json();
    var htm = '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">'+
      '<select id="pkDevFileState" onchange="PK_DEVICES._loadFiles('+did+',this.value)" style="padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;">'+
        '<option value="">全部 ('+d.total+')</option>'+
        '<option value="new"'+(state==='new'?' selected':'')+'>🆕 新文件</option>'+
        '<option value="indexed"'+(state==='indexed'?' selected':'')+'>📋 已索引</option>'+
        '<option value="changed"'+(state==='changed'?' selected':'')+'>🔄 已变更</option>'+
        '<option value="missing"'+(state==='missing'?' selected':'')+'>⚠ 缺失</option>'+
        '<option value="archived"'+(state==='archived'?' selected':'')+'>🗄 已归档</option>'+
      '</select>'+
      '<span style="font-size:12px;color:var(--text-muted);">共 '+d.total+' 文件</span>'+
    '</div>';
    if (!d.items.length) { htm += '<div style="text-align:center;padding:20px;color:var(--text-muted);">无文件</div>'; }
    else {
      htm += '<table style="width:100%;font-size:12px;border-collapse:collapse;">'+
        '<tr style="color:var(--text-muted);border-bottom:1px solid var(--border-color);">'+
          '<th style="text-align:left;padding:4px;">文件名</th><th style="text-align:left;">路径</th><th style="text-align:right;">大小</th><th>状态</th><th>操作</th></tr>';
      d.items.forEach(function(it){
        var st = {'new':'🆕','indexed':'📋','changed':'🔄','missing':'⚠','archived':'🗄'}[it.state]||it.state;
        var sz = it.size ? (it.size>1048576?(it.size/1048576).toFixed(1)+'MB':(it.size/1024).toFixed(0)+'KB') : '—';
        var btn = '';
        if (it.state==='new') btn = '<button class="btn btn-sm btn-outline-secondary" onclick="PK_DEVICES.archiveFile('+it.id+')" style="font-size:10px;">归档</button>';
        else if (it.state==='missing') btn = '<button class="btn btn-sm btn-outline-secondary" onclick="PK_DEVICES.unlinkFile('+it.id+')" style="font-size:10px;">解除</button>';
        htm += '<tr style="border-bottom:1px solid var(--border-color);">'+
          '<td style="padding:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+PK_DEVICES._e(it.filename)+'</td>'+
          '<td style="padding:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);">'+PK_DEVICES._e(it.rel_path)+'</td>'+
          '<td style="padding:4px;text-align:right;">'+sz+'</td>'+
          '<td style="padding:4px;text-align:center;">'+st+'</td>'+
          '<td style="padding:4px;">'+btn+'</td></tr>';
      });
      htm += '</table>';
    }
    document.getElementById('pkDevDetailBody').innerHTML = htm;
  } catch(e) { console.error(e); }
};

PK_DEVICES._loadPaths = async function(did) {
  try {
    var r = await fetch('/api/devices/'+did+'/paths'); var d = await r.json();
    var htm = '<div style="margin-bottom:8px;"><button class="btn btn-sm btn-outline-secondary" onclick="PK_DEVICES.addPath('+did+')" style="font-size:12px;">➕ 添加路径</button></div>';
    htm += '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
    (d.paths||[]).forEach(function(p){
      htm += '<tr style="border-bottom:1px solid var(--border-color);">'+
        '<td style="padding:6px;">'+PK_DEVICES._e(p.abs_path)+'</td>'+
        '<td style="padding:6px;color:var(--text-muted);">'+(p.module_hint||'—')+'</td>'+
        '<td style="padding:6px;"><button class="btn btn-sm btn-outline-danger" onclick="PK_DEVICES.delPath('+did+','+p.id+')" style="font-size:10px;">移除</button></td></tr>';
    });
    htm += '</table>';
    document.getElementById('pkDevDetailBody').innerHTML = htm;
  } catch(e) { console.error(e); }
};

PK_DEVICES.addPath = function(did) {
  var path = prompt('输入监控目录绝对路径（如 D:\\ProjectA）：');
  if (!path) return;
  fetch('/api/devices/'+did+'/paths', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({abs_path:path})})
  .then(function(r){ if(r.ok){ PK_DEVICES._loadPaths(did); } else alert('添加失败'); });
};

PK_DEVICES.delPath = function(did, pid) {
  if (!confirm('确定移除该监控路径？')) return;
  fetch('/api/devices/'+did+'/paths/'+pid, {method:'DELETE'})
  .then(function(r){ if(r.ok) PK_DEVICES._loadPaths(did); });
};

PK_DEVICES.archiveFile = function(fid) {
  var mod = prompt('归入模块（image/video/audio/project_c4d/project_ps/project_ae/project_pr/doc/other 等）：','other');
  if (!mod) return;
  Promise.all([
    fetch('/api/projects?scope=all').then(function(r){ return r.json(); })
  ]).then(function(res){
    var projs = res[0].projects||[];
    var pname = projs.map(function(p,i){ return i+': '+p.name; }).join('\n');
    var pid = prompt('项目列表（输序号）：\n'+pname, '0');
    if (pid===null) return;
    var psid = (projs[parseInt(pid)]||projs[0]||{id:1}).id;
    fetch('/api/devices/files/'+fid+'/archive', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project_space_id:psid, module_key:mod})})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.ok) { alert('归档成功'); PK_DEVICES.load(); }
      else alert('归档失败');
    });
  });
};

PK_DEVICES.unlinkFile = function(fid) {
  if (!confirm('解除链接后将从设备文件索引中移除该条目')) return;
  fetch('/api/devices/files/'+fid+'/archive', {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({project_space_id:1, module_key:'other'})})
  .then(function(r){ return r.json(); });
};

PK_DEVICES.rename = function(did) {
  var name = prompt('新名称：'); if (!name) return;
  fetch('/api/devices/'+did, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:name})})
  .then(function(r){ if(r.ok) PK_DEVICES.load(); });
};

PK_DEVICES.revoke = function(did, name) {
  if (!confirm('确定吊销设备「'+name+'」？对端将失去连接。')) return;
  fetch('/api/devices/'+did, {method:'DELETE'})
  .then(function(r){ if(r.ok) PK_DEVICES.load(); });
};

PK_DEVICES.openPairCode = function() {
  var ov = document.createElement('div');
  ov.className = 'pk-auth-modal-overlay'; ov.id = 'pkPairOverlay';
  ov.onclick = function(e){ if(e.target===ov) ov.remove(); };
  ov.innerHTML = '<div class="pk-auth-modal" style="max-width:480px;" onclick="event.stopPropagation()">'+
    '<h4>🔗 设备配对</h4>'+
    '<div id="pkPairBody" style="text-align:center;padding:20px;">加载中...</div>'+
    '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'pkPairOverlay\').remove()" style="margin-top:10px;">关闭</button>'+
  '</div>';
  document.body.appendChild(ov);
  fetch('/api/devices/pair-code', {method:'POST'})
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (!d.ok) { document.getElementById('pkPairBody').innerHTML = '生成失败'; return; }
    document.getElementById('pkPairBody').innerHTML =
      '<div style="font-size:48px;font-weight:900;letter-spacing:12px;font-family:monospace;margin:16px 0;">'+d.code+'</div>'+
      '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">有效期 5 分钟</div>'+
      '<div style="background:var(--bg-card,#f8f9fa);border-radius:8px;padding:12px;text-align:left;font-size:12px;line-height:1.6;">'+
        '<strong>Agent 端操作：</strong><br>'+
        '1. 在目标设备上启动 <code>pk_agent.py</code><br>'+
        '2. 输入服务器地址：<code id="pkPairAddr">http://'+window.location.hostname+':8080'+'</code><br>'+
        '3. 输入配对码：<strong style="font-size:16px;">'+d.code+'</strong><br>'+
        '4. 完成配对后自动开始扫描<br>'+
        '<span style="color:var(--text-muted);">Windows/macOS/Linux 均支持，仅需 Python 3.8+</span>'+
      '</div>'+
      '<div id="pkPairTimer" style="margin-top:10px;font-size:12px;color:var(--text-muted);"></div>';
    var sec = 300;
    var el = document.getElementById('pkPairTimer');
    if (el) {
      var iv = setInterval(function(){
        sec -= 1;
        el.innerHTML = '剩余 ' + Math.floor(sec/60) + ':' + ('0'+(sec%60)).slice(-2);
        if (sec <= 0) clearInterval(iv);
      }, 1000);
    }
  });
};

PK_DEVICES._e = function(s) {
  var d = document.createElement('div'); d.textContent = (s||''); return d.innerHTML;
};

/* 挂载到项目下拉导航 */
PK_DEVICES._navInit = function() {
  var dd = document.querySelector('#navDropdownProject .nav-dropdown-menu');
  if (!dd) return;
  if (dd.querySelector('[data-action="pk_devices"]')) return; // already added
  var item = document.createElement('div');
  item.className = 'nav-dropdown-item';
  item.setAttribute('data-action', 'pk_devices');
  item.onclick = function(){ PK_DEVICES.open(); };
  item.innerHTML = '<i class="bi bi-hdd-stack" style="color:#06b6d4;"></i> 设备盘索引';
  dd.appendChild(item);
};

// 重试注入（DOM 可能还未就绪 / 其他模块也往这里插元素）
(function _tryInject() {
  var el = document.querySelector('#navDropdownProject .nav-dropdown-menu');
  if (el && !el.querySelector('[data-action="pk_devices"]')) {
    PK_DEVICES._navInit(); return;
  }
  setTimeout(_tryInject, 300);
})();
