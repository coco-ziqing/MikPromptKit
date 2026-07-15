/**
 * PromptKit 项目资产库 UI — Phase35.1-UI
 * 自包含模块：项目列表 + 新建项目(选模块)向导 + 项目详情(按模块分组资产网格) + 上传/查重/关键标记/删除。
 * 依赖后端 api/asset_library.py；走全局 fetch 拦截器自动带 token。
 */
(function () {
  'use strict';

  var AL = {
    _modules: [],           // 系统模块字典
    _scope: 'all',
    _cur: null,             // 当前打开的项目 detail

    // ---------- 入口 ----------
    open: async function () {
      var user = window.PK_AUTH_CLIENT && PK_AUTH_CLIENT._user;
      if (!user) { this._toast('请先登录', 'error'); return; }
      document.querySelectorAll('#mainContent > .view-panel').forEach(function (p) { p.style.display = 'none'; });
      var vp = document.getElementById('viewProjectAssets');
      if (vp) vp.style.display = 'block';
      try { if (window.App && App._collapseSidebar) App._collapseSidebar(); } catch (e) {}
      if (!this._modules.length) await this._loadModules();
      this._cur = null;
      this.renderList();
    },
    close: function () {
      var vp = document.getElementById('viewProjectAssets');
      if (vp) vp.style.display = 'none';
      if (typeof App !== 'undefined' && App.switchView) App.switchView('home');
    },

    _loadModules: async function () {
      try { var r = await fetch('/api/asset-modules'); var d = await r.json(); this._modules = d.modules || []; }
      catch (e) { this._modules = []; }
    },
    _mod: function (key) { return this._modules.find(function (m) { return m.key === key; }) || { key: key, name: key, icon: '📁', media_kind: 'other', accept_ext: '' }; },

    // ---------- 项目列表 ----------
    renderList: async function () {
      var vp = document.getElementById('viewProjectAssets');
      if (!vp) return;
      vp.innerHTML =
        '<div style="height:100%;overflow-y:auto;padding:20px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">' +
        '<h4 style="margin:0;font-size:16px;font-weight:700;color:var(--text-main);">📦 项目资产</h4>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
        '<button class="btn btn-sm btn-primary" onclick="PK_ASSETLIB.newProject()">＋ 新建项目</button>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.close()">← 返回</button>' +
        '</div></div>' +
        '<div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:700;color:var(--text-main);">🌐 共享公资产库</span><span id="al_cnt_shared" style="font-size:12px;color:var(--text-muted);"></span></div>' +
        '<div id="al_grid_shared" class="user-grid"></div>' +
        '<div style="height:18px;"></div>' +
        '<div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:700;color:var(--text-main);">🔒 用户私人资产库</span><span id="al_cnt_private" style="font-size:12px;color:var(--text-muted);"></span></div>' +
        '<div id="al_grid_private" class="user-grid"></div>' +
        '</div>';
      this.loadProjects();
    },

    _projCard: function (p, me) {
      var self = this;
      var icons = (p.module_info || []).map(function (m) { return '<span title="' + self._esc(m.name) + '">' + (m.icon || '📁') + '</span>'; }).join(' ');
      var vis = (p.visibility === 'shared' || p.visibility === 'public') ? '<span class="badge" style="background:#0891b2;color:#fff;">共享</span>' : '<span class="badge" style="background:#7c3aed;color:#fff;">私有</span>';
      var mine = p.owner_user_id === me.id;
      return '<div class="user-card" style="cursor:pointer;" onclick="PK_ASSETLIB.openProject(' + p.id + ')">' +
        '<div class="user-card-header"><div class="user-avatar" style="background:#334155;">' + self._esc((p.name || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div class="user-info"><div class="user-name">' + self._esc(p.name) + '</div>' +
        '<div class="user-username">' + (p.asset_count || 0) + ' 个资产</div></div></div>' +
        '<div class="user-meta" style="gap:6px;flex-wrap:wrap;">' + vis + '<span style="font-size:16px;">' + icons + '</span></div>' +
        '<div class="user-card-actions"><button class="btn-outline" onclick="event.stopPropagation();PK_ASSETLIB.openProject(' + p.id + ')">📂 打开</button>' +
        (mine || me.role === 'admin' ? '<button class="btn-outline btn-outline-danger" onclick="event.stopPropagation();PK_ASSETLIB.deleteProject(' + p.id + ',\'' + self._esc(p.name) + '\')">🗑</button>' : '') +
        '</div></div>';
    },

    loadProjects: async function () {
      var self = this;
      var gs = document.getElementById('al_grid_shared');
      var gp = document.getElementById('al_grid_private');
      if (gs) gs.innerHTML = '<div style="padding:16px;color:var(--text-muted);">加载中...</div>';
      if (gp) gp.innerHTML = '';
      try {
        var d = await (await fetch('/api/projects?scope=all')).json();
        var ps = d.projects || [];
        var me = (window.PK_AUTH_CLIENT && PK_AUTH_CLIENT._user) || {};
        var shared = [], priv = [];
        ps.forEach(function (p) {
          if (p.owner_user_id === me.id && p.visibility === 'private') priv.push(p);
          else shared.push(p);
        });
        var emptyBox = function (txt) { return '<div style="padding:22px;text-align:center;color:var(--text-muted);font-size:13px;border:1px dashed var(--border-color);border-radius:10px;">' + txt + '</div>'; };
        if (gs) gs.innerHTML = shared.length ? shared.map(function (p) { return self._projCard(p, me); }).join('') : emptyBox('暂无共享资产库');
        if (gp) gp.innerHTML = priv.length ? priv.map(function (p) { return self._projCard(p, me); }).join('') : emptyBox('暂无私人资产库 · 点「＋ 新建项目」并选「私有」创建');
        var cs = document.getElementById('al_cnt_shared'); if (cs) cs.textContent = shared.length + ' 个';
        var cp = document.getElementById('al_cnt_private'); if (cp) cp.textContent = priv.length + ' 个';
      } catch (e) {
        if (gs) gs.innerHTML = '<div style="padding:16px;color:var(--danger);">加载失败</div>';
      }
    },

    // ---------- 新建项目向导 ----------
    newProject: function () {
      var self = this;
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'alNewOverlay';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      var modChecks = this._modules.map(function (m) {
        var def = ['image', 'video', 'audio'].indexOf(m.key) >= 0;
        return '<label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:13px;">' +
          '<input type="checkbox" class="al_mod" value="' + m.key + '"' + (def ? ' checked' : '') + '> ' + (m.icon || '📁') + ' ' + self._esc(m.name) + '</label>';
      }).join('');
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:560px;width:94vw;" onclick="event.stopPropagation()">' +
        '<h4>➕ 新建项目</h4>' +
        '<div class="form-group"><label>项目名称</label><input type="text" id="al_name" placeholder="如：夏日短片 / 品牌广告" autofocus></div>' +
        '<div class="form-group"><label>描述（可选）</label><input type="text" id="al_desc" placeholder="项目简介"></div>' +
        '<div class="form-group"><label>可见性</label><select id="al_vis"><option value="private">私有（仅自己）</option><option value="shared">共享（团队可见）</option></select></div>' +
        '<div class="form-group"><label>备份策略</label><select id="al_backup"><option value="critical">关键资产备份（工程文件默认，推荐）</option><option value="all">全部备份</option><option value="none">不备份</option></select></div>' +
        '<div class="form-group"><label>包含资产模块（可随时增减）</label><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">' + modChecks + '</div></div>' +
        '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-auth-modal-overlay\').remove()">取消</button>' +
        '<button class="btn btn-primary" id="al_create">创建</button></div></div>';
      document.body.appendChild(ov);
      document.getElementById('al_create').onclick = async function () {
        var name = document.getElementById('al_name').value.trim();
        if (!name) { alert('请输入项目名称'); return; }
        var mods = Array.prototype.map.call(document.querySelectorAll('.al_mod:checked'), function (c) { return c.value; });
        if (!mods.length) { alert('至少选择一个资产模块'); return; }
        this.disabled = true; this.textContent = '创建中...';
        try {
          var r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, description: document.getElementById('al_desc').value.trim(),
              visibility: document.getElementById('al_vis').value, backup_policy: document.getElementById('al_backup').value, modules: mods }) });
          var d = await r.json();
          if (d.ok) { ov.remove(); self._toast('项目已创建', 'success'); self.openProject(d.project.id); }
          else { alert(d.detail || '创建失败'); this.disabled = false; this.textContent = '创建'; }
        } catch (e) { alert('网络错误'); this.disabled = false; this.textContent = '创建'; }
      };
    },

    // ---------- 项目详情 ----------
    openProject: async function (pid) {
      var vp = document.getElementById('viewProjectAssets');
      if (vp) vp.style.display = 'block';
      document.querySelectorAll('#mainContent > .view-panel').forEach(function (p) { if (p.id !== 'viewProjectAssets') p.style.display = 'none'; });
      if (!this._modules.length) await this._loadModules();
      try {
        var r = await fetch('/api/projects/' + pid); var d = await r.json();
        if (!d.ok) { this._toast('无法打开项目', 'error'); return; }
        this._cur = d.project;
        this.renderProject();
      } catch (e) { this._toast('加载失败', 'error'); }
    },

    renderProject: async function () {
      var p = this._cur; if (!p) return;
      var vp = document.getElementById('viewProjectAssets');
      var self = this;
      var me = (window.PK_AUTH_CLIENT && PK_AUTH_CLIENT._user) || {};
      var canEdit = p.owner_user_id === me.id || me.role === 'admin' || p.visibility === 'shared';
      vp.innerHTML =
        '<div style="height:100%;overflow-y:auto;padding:20px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:10px;">' +
        '<div><button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.renderList()">← 项目列表</button> ' +
        '<span style="font-size:17px;font-weight:700;color:var(--text-main);margin-left:8px;">' + this._esc(p.name) + '</span> ' +
        (p.visibility === 'shared' ? '<span class="badge" style="background:#0891b2;color:#fff;">共享</span>' : '<span class="badge" style="background:#7c3aed;color:#fff;">私有</span>') +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.dedup()">🔍 查重</button>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.openMembers()">👥 成员</button>' +
        (canEdit ? '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.editModules()">⚙ 模块</button>' : '') +
        '</div></div>' +
        (p.description ? '<div style="color:var(--text-muted);font-size:13px;margin-bottom:14px;">' + this._esc(p.description) + '</div>' : '<div style="margin-bottom:14px;"></div>') +
        '<div id="al_modsec"></div></div>';
      // 拉资产
      var assets = [], counts = {};
      try { var r = await fetch('/api/projects/' + p.id + '/assets'); var d = await r.json(); assets = d.assets || []; counts = d.counts || {}; } catch (e) {}
      var byMod = {};
      assets.forEach(function (a) { (byMod[a.module_key] = byMod[a.module_key] || []).push(a); });
      var sec = document.getElementById('al_modsec');
      sec.innerHTML = (p.modules || []).map(function (mk) {
        var m = self._mod(mk);
        var list = byMod[mk] || [];
        return '<div style="margin-bottom:22px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-color);padding-bottom:6px;margin-bottom:10px;">' +
          '<div style="font-size:14px;font-weight:700;color:var(--text-main);">' + (m.icon || '📁') + ' ' + self._esc(m.name) + ' <span style="color:var(--text-muted);font-weight:400;">(' + (counts[mk] || 0) + ')</span></div>' +
          (canEdit ? '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.pickUpload(' + p.id + ',\'' + mk + '\')">⬆ 上传</button>' : '') +
          '</div>' +
          '<div id="al_grid_' + mk + '" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">' +
          (list.length ? list.map(function (a) { return self._assetCard(a, m, canEdit); }).join('') : '<div style="color:var(--text-muted);font-size:12px;padding:8px;">暂无，点击「上传」添加</div>') +
          '</div></div>';
      }).join('');
    },

    _st: { draft: { t: '草稿', c: '#94a3b8' }, in_review: { t: '审核中', c: '#f59e0b' }, approved: { t: '已通过', c: '#10b981' }, rejected: { t: '已驳回', c: '#ef4444' } },

    _assetCard: function (a, m, canEdit) {
      var self = this;
      var thumb = a.thumb_url
        ? '<img src="' + a.thumb_url + '" style="width:100%;height:100px;object-fit:cover;background:#0b1220;">'
        : '<div style="width:100%;height:100px;display:flex;align-items:center;justify-content:center;font-size:34px;background:var(--bg-input,#0b1220);">' + (m.icon || '📁') + '</div>';
      var star = a.is_critical ? '★' : '☆';
      var st = this._st[a.review_status] || this._st.draft;
      var vtag = (a.version_count > 1) ? '<span style="position:absolute;bottom:4px;left:6px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;padding:1px 5px;border-radius:6px;">v' + a.version_count + '</span>' : '';
      return '<div style="border:1px solid var(--border-color);border-radius:10px;overflow:hidden;background:var(--bg-card);">' +
        '<div style="position:relative;cursor:pointer;" onclick="PK_ASSETLIB.openAsset(' + a.id + ')">' + thumb +
        '<span style="position:absolute;top:4px;left:6px;background:' + st.c + ';color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;">' + st.t + '</span>' + vtag +
        '<span title="' + (a.is_critical ? '关键资产(已备份)' : '标记为关键(备份)') + '" onclick="event.stopPropagation();PK_ASSETLIB.toggleCritical(' + a.id + ')" style="position:absolute;top:4px;right:6px;cursor:pointer;color:' + (a.is_critical ? '#f59e0b' : '#e5e7eb') + ';font-size:16px;text-shadow:0 1px 2px rgba(0,0,0,.6);">' + star + '</span></div>' +
        '<div style="padding:6px 8px;">' +
        '<div style="font-size:12px;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;" title="' + self._esc(a.filename) + '" onclick="PK_ASSETLIB.openAsset(' + a.id + ')">' + self._esc(a.filename) + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center;margin-top:3px;">' +
        '<span>' + self._fmtSize(a.size) + '</span>' +
        '<span><a href="' + a.file_url + '" target="_blank" title="下载/查看" style="text-decoration:none;" onclick="event.stopPropagation();">⬇</a>' +
        (canEdit ? ' <span onclick="event.stopPropagation();PK_ASSETLIB.deleteAsset(' + a.id + ')" title="删除" style="cursor:pointer;color:var(--danger,#ef4444);">🗑</span>' : '') + '</span>' +
        '</div></div></div>';
    },

    pickUpload: function (pid, mk) {
      var self = this;
      var m = this._mod(mk);
      var inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true;
      if (m.accept_ext) inp.accept = m.accept_ext.split(',').map(function (e) { return '.' + e; }).join(',');
      inp.onchange = function () { self._doUpload(pid, mk, Array.prototype.slice.call(inp.files)); };
      inp.click();
    },

    _doUpload: async function (pid, mk, files) {
      if (!files.length) return;
      var self = this;
      var okN = 0, dupN = 0, failN = 0;
      this._toast('上传中 (0/' + files.length + ')...', 'info', 60000);
      for (var i = 0; i < files.length; i++) {
        var fd = new FormData();
        fd.append('file', files[i]); fd.append('module', mk); fd.append('note', '');
        try {
          var r = await fetch('/api/projects/' + pid + '/assets', { method: 'POST', body: fd });
          var d = await r.json();
          if (d.ok) { okN++; if (d.duplicate) dupN++; } else { failN++; }
        } catch (e) { failN++; }
        this._toast('上传中 (' + (i + 1) + '/' + files.length + ')...', 'info', 60000);
      }
      var msg = '完成：成功 ' + okN + (dupN ? '（含 ' + dupN + ' 个重复）' : '') + (failN ? '，失败 ' + failN : '');
      this._toast(msg, failN ? 'error' : 'success');
      // 刷新当前项目
      if (this._cur && this._cur.id === pid) this.openProject(pid);
    },

    toggleCritical: async function (cid) {
      // 读当前星标状态从 DOM 不可靠，直接切换：先查？简单做——PATCH 翻转由后端难知，前端记录
      var el = event && event.target;
      var cur = el && el.textContent === '★';
      try { await fetch('/api/assets/' + cid, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_critical: cur ? 0 : 1 }) });
        if (el) { el.textContent = cur ? '☆' : '★'; el.style.color = cur ? '#e5e7eb' : '#f59e0b'; }
      } catch (e) { this._toast('操作失败', 'error'); }
    },

    deleteAsset: async function (cid) {
      if (!confirm('确定删除此资产？（同时删除服务器上的文件）')) return;
      try { var r = await fetch('/api/assets/' + cid, { method: 'DELETE' }); var d = await r.json();
        if (d.ok) { this._toast('已删除', 'success'); if (this._cur) this.openProject(this._cur.id); } else this._toast(d.detail || '删除失败', 'error');
      } catch (e) { this._toast('网络错误', 'error'); }
    },

    deleteProject: async function (pid, name) {
      if (!confirm('确定删除项目「' + name + '」？将删除其全部资产与目录，不可恢复！')) return;
      try { var r = await fetch('/api/projects/' + pid, { method: 'DELETE' }); var d = await r.json();
        if (d.ok) { this._toast('项目已删除', 'success'); this.renderList(); } else this._toast(d.detail || '删除失败', 'error');
      } catch (e) { this._toast('网络错误', 'error'); }
    },

    editModules: function () {
      var p = this._cur; if (!p) return;
      var self = this;
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      var checks = this._modules.map(function (m) {
        var on = (p.modules || []).indexOf(m.key) >= 0;
        return '<label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:13px;">' +
          '<input type="checkbox" class="al_em" value="' + m.key + '"' + (on ? ' checked' : '') + '> ' + (m.icon || '📁') + ' ' + self._esc(m.name) + '</label>';
      }).join('');
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:560px;width:94vw;" onclick="event.stopPropagation()">' +
        '<h4>⚙ 编辑资产模块</h4><div style="color:var(--text-muted);font-size:12px;margin-bottom:10px;">勾选启用的模块（增加会新建目录；取消勾选不会删除已上传的资产）</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + checks + '</div>' +
        '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-auth-modal-overlay\').remove()">取消</button>' +
        '<button class="btn btn-primary" id="al_savemod">保存</button></div></div>';
      document.body.appendChild(ov);
      document.getElementById('al_savemod').onclick = async function () {
        var mods = Array.prototype.map.call(document.querySelectorAll('.al_em:checked'), function (c) { return c.value; });
        if (!mods.length) { alert('至少保留一个模块'); return; }
        try { var r = await fetch('/api/projects/' + p.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modules: mods }) });
          var d = await r.json(); if (d.ok) { ov.remove(); self._cur = d.project; self.renderProject(); } else alert(d.detail || '保存失败');
        } catch (e) { alert('网络错误'); }
      };
    },

    dedup: async function () {
      var p = this._cur; if (!p) return;
      try {
        var r = await fetch('/api/projects/' + p.id + '/dedup'); var d = await r.json();
        var groups = d.duplicate_groups || [];
        var self = this;
        var body = groups.length
          ? groups.map(function (g) { return '<div style="border:1px solid var(--border-color);border-radius:8px;padding:8px;margin-bottom:8px;">' +
              '<div style="font-size:12px;color:var(--text-muted);">指纹 ' + g.fingerprint + '… · ' + g.count + ' 份重复</div>' +
              g.items.map(function (it) { return '<div style="font-size:13px;">• ' + self._esc(it.filename) + ' <span style="color:var(--text-muted);">[' + it.module_key + ']</span></div>'; }).join('') +
              '</div>'; }).join('')
          : '<div style="padding:16px;text-align:center;color:#10b981;">✓ 未发现重复资产</div>';
        var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay';
        ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
        ov.innerHTML = '<div class="pk-auth-modal" style="max-width:520px;width:92vw;" onclick="event.stopPropagation()"><h4>🔍 重复资产检测</h4>' +
          '<div style="max-height:50vh;overflow:auto;">' + body + '</div>' +
          '<div class="pk-modal-actions"><button class="btn btn-primary" onclick="this.closest(\'.pk-auth-modal-overlay\').remove()">关闭</button></div></div>';
        document.body.appendChild(ov);
      } catch (e) { this._toast('查重失败', 'error'); }
    },

    // ---------- 资产详情 / 版本 / 审核 ----------
    openAsset: async function (cid) {
      var self = this;
      try {
        var da = await (await fetch('/api/assets/' + cid)).json();
        if (!da.ok) { this._toast('无法打开资产', 'error'); return; }
        var dv = await (await fetch('/api/assets/' + cid + '/versions')).json();
        var dr = await (await fetch('/api/assets/' + cid + '/reviews')).json();
        this._renderAssetModal(da.asset, dv.versions || [], dr.reviews || []);
      } catch (e) { this._toast('加载失败', 'error'); }
    },

    _renderAssetModal: function (a, versions, reviews) {
      var self = this;
      var role = a.role || 'viewer';
      var canEdit = role === 'owner' || role === 'editor';
      var canReview = role === 'owner' || role === 'reviewer';
      var stt = this._st[a.review_status] || this._st.draft;
      var mt = (a.media_type || '');
      var preview;
      if (mt === 'image') preview = '<img src="' + a.file_url + '" style="max-width:100%;max-height:320px;border-radius:8px;">';
      else if (mt === 'video') preview = '<video src="' + a.file_url + '" controls style="max-width:100%;max-height:320px;border-radius:8px;background:#000;"></video>';
      else if (mt === 'audio') preview = '<audio src="' + a.file_url + '" controls style="width:100%;"></audio>';
      else preview = '<div style="padding:30px;text-align:center;font-size:40px;">📄<div style="font-size:13px;color:var(--text-muted);margin-top:8px;">' + self._esc(a.filename) + '</div></div>';

      var acts = '';
      if ((a.review_status === 'draft' || a.review_status === 'rejected') && canEdit)
        acts += '<button class="btn btn-sm btn-primary" onclick="PK_ASSETLIB.submitReview(' + a.id + ')">📤 提交审核</button> ';
      if (a.review_status === 'in_review' && canReview)
        acts += '<button class="btn btn-sm" style="background:#10b981;color:#fff;" onclick="PK_ASSETLIB.doReview(' + a.id + ',\'approve\')">✔ 批准</button> ' +
                '<button class="btn btn-sm" style="background:#ef4444;color:#fff;" onclick="PK_ASSETLIB.doReview(' + a.id + ',\'reject\')">✖ 驳回</button> ';
      if (canEdit) acts += '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.uploadVersion(' + a.id + ')">⬆ 上传新版本</button>';

      var vlist = versions.map(function (v) {
        var vs = self._st[v.status] || self._st.draft;
        var th = v.thumb_url ? '<img src="' + v.thumb_url + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px;">' : '<div style="width:40px;height:40px;border-radius:6px;background:var(--bg-input,#0b1220);"></div>';
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-color);">' + th +
          '<div style="flex:1;min-width:0;"><div style="font-size:12px;color:var(--text-main);">v' + v.version_no + (v.is_current ? ' <span style="color:#10b981;">(当前)</span>' : '') + ' <span style="color:' + vs.c + ';">' + vs.t + '</span></div>' +
          '<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._esc(v.filename) + (v.note ? ' · ' + self._esc(v.note) : '') + ' · ' + self._fmtSize(v.size) + '</div></div>' +
          (canEdit && !v.is_current ? '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.rollbackVersion(' + a.id + ',' + v.id + ')">回滚</button>' : '') +
          '</div>';
      }).join('');

      var actionName = { submit: '📤 提交审核', approve: '✔ 批准', reject: '✖ 驳回', comment: '💬 评论' };
      var rlist = reviews.length ? reviews.map(function (r) {
        return '<div style="padding:6px 0;border-bottom:1px solid var(--border-color);font-size:12px;">' +
          '<span style="font-weight:600;color:var(--text-main);">' + self._esc(r.reviewer_name || '?') + '</span> ' +
          '<span style="color:var(--text-muted);">' + (actionName[r.action] || r.action) + '</span>' +
          (r.comment ? '<div style="color:var(--text-main);margin-top:2px;">' + self._esc(r.comment) + '</div>' : '') +
          '<div style="color:var(--text-muted);font-size:10px;">' + (r.created_at || '').substring(0, 19) + '</div></div>';
      }).join('') : '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">暂无审核记录</div>';

      var gpObj = a.gen_params || {};
      var gpStr = '';
      try { gpStr = (gpObj && Object.keys(gpObj).length) ? JSON.stringify(gpObj) : ''; } catch (e) { gpStr = ''; }
      var ro = canEdit ? '' : ' disabled';
      var starHtml = '';
      for (var si = 1; si <= 5; si++) {
        starHtml += '<span onclick="' + (canEdit ? 'PK_ASSETLIB.setRating(' + a.id + ',' + si + ')' : '') + '" style="cursor:' + (canEdit ? 'pointer' : 'default') + ';color:' + (si <= (a.rating || 0) ? '#f59e0b' : '#cbd5e1') + ';font-size:18px;">★</span>';
      }
      var provHtml =
        '<div style="border-top:1px solid var(--border-color);margin-top:14px;padding-top:12px;">' +
        '<div style="font-size:13px;font-weight:700;color:var(--text-main);margin-bottom:8px;">🧬 生成溯源 &nbsp;<span id="al_rate_' + a.id + '">' + starHtml + '</span></div>' +
        '<input id="al_gm" placeholder="生成模型（如 SDXL / MJ v6 / Seedance）" value="' + self._esc(a.gen_model || '') + '"' + ro + ' style="width:100%;padding:6px 8px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;">' +
        '<textarea id="al_gp" placeholder="生成提示词 Prompt"' + ro + ' style="width:100%;margin-top:6px;min-height:46px;padding:6px 8px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;">' + self._esc(a.gen_prompt || '') + '</textarea>' +
        '<textarea id="al_gpar" placeholder="参数 JSON（seed/steps/cfg/sampler/negative...）"' + ro + ' style="width:100%;margin-top:6px;min-height:38px;padding:6px 8px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;font-family:monospace;">' + self._esc(gpStr) + '</textarea>' +
        (canEdit ? '<div style="margin-top:6px;"><button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.saveProvenance(' + a.id + ')">💾 保存溯源</button></div>' : '') +
        '</div>';
      var refs = a.refs || [];
      var refChips = refs.length ? refs.map(function (rf) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg-input,#1e293b);border:1px solid var(--border-color);border-radius:12px;padding:2px 8px;margin:2px;font-size:12px;">🔗 ' + self._esc(rf.name || ('#' + rf.ref_id)) + (canEdit ? ' <span onclick="PK_ASSETLIB.unlinkRef(' + a.id + ',\'' + rf.ref_type + '\',' + rf.ref_id + ')" style="cursor:pointer;color:var(--danger,#ef4444);">✕</span>' : '') + '</span>';
      }).join('') : '<span style="color:var(--text-muted);font-size:12px;">暂无关联</span>';
      var refsHtml =
        '<div style="border-top:1px solid var(--border-color);margin-top:12px;padding-top:12px;">' +
        '<div style="font-size:13px;font-weight:700;color:var(--text-main);margin-bottom:6px;">🔗 关联词卡</div>' +
        '<div id="al_refchips">' + refChips + '</div>' +
        (canEdit ? '<input id="al_refq" placeholder="搜索词卡名称进行关联..." oninput="PK_ASSETLIB.searchCards(' + a.id + ')" style="width:100%;margin-top:8px;padding:6px 8px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;"><div id="al_refresults" style="max-height:120px;overflow:auto;margin-top:4px;"></div>' : '') +
        '</div>';

      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'alAssetOverlay';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:720px;width:94vw;" onclick="event.stopPropagation()">' +
        '<h4 style="display:flex;align-items:center;justify-content:space-between;"><span>' + self._esc(a.filename) + ' <span style="font-size:12px;color:' + stt.c + ';">' + stt.t + '</span></span>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'alAssetOverlay\').remove()">✕</button></h4>' +
        '<div style="display:flex;gap:16px;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:260px;text-align:center;">' + preview +
        '<div style="margin-top:10px;">' + acts + '</div></div>' +
        '<div style="flex:1;min-width:240px;">' +
        '<div style="font-size:13px;font-weight:700;color:var(--text-main);margin-bottom:4px;">🔖 版本历史 (' + versions.length + ')</div>' +
        '<div style="max-height:160px;overflow:auto;">' + vlist + '</div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--text-main);margin:12px 0 4px;">💬 审核/评论</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:8px;"><input id="al_cmt" placeholder="写下评论..." style="flex:1;padding:6px 8px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;"><button class="btn btn-sm btn-outline-secondary" onclick="PK_ASSETLIB.addComment(' + a.id + ')">发送</button></div>' +
        '<div style="max-height:180px;overflow:auto;">' + rlist + '</div>' +
        '</div></div>' + provHtml + refsHtml + '</div>';
      document.body.appendChild(ov);
    },

    uploadVersion: function (cid) {
      var self = this;
      var inp = document.createElement('input'); inp.type = 'file';
      inp.onchange = async function () {
        if (!inp.files.length) return;
        var note = prompt('版本说明（可选）:', '') || '';
        var fd = new FormData(); fd.append('file', inp.files[0]); fd.append('note', note);
        self._toast('上传中...', 'info', 30000);
        try {
          var d = await (await fetch('/api/assets/' + cid + '/versions', { method: 'POST', body: fd })).json();
          if (d.ok) { self._toast('新版本 v' + d.version_no + ' 已上传', 'success'); self.openAsset(cid); if (self._cur) self.openProject(self._cur.id); }
          else self._toast(d.detail || '上传失败', 'error');
        } catch (e) { self._toast('网络错误', 'error'); }
      };
      inp.click();
    },

    rollbackVersion: async function (cid, vid) {
      try { var d = await (await fetch('/api/assets/' + cid + '/rollback/' + vid, { method: 'POST' })).json();
        if (d.ok) { this._toast('已回滚', 'success'); this.openAsset(cid); if (this._cur) this.openProject(this._cur.id); } else this._toast(d.detail || '失败', 'error');
      } catch (e) { this._toast('网络错误', 'error'); }
    },

    submitReview: async function (cid) {
      try { var d = await (await fetch('/api/assets/' + cid + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
        if (d.ok) { this._toast('已提交审核', 'success'); this.openAsset(cid); if (this._cur) this.openProject(this._cur.id); } else this._toast(d.detail || '失败', 'error');
      } catch (e) { this._toast('网络错误', 'error'); }
    },

    doReview: async function (cid, action) {
      var comment = prompt(action === 'approve' ? '批准意见（可选）:' : '驳回原因（可选）:', '') || '';
      try { var d = await (await fetch('/api/assets/' + cid + '/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action, comment: comment }) })).json();
        if (d.ok) { this._toast(action === 'approve' ? '已批准' : '已驳回', 'success'); this.openAsset(cid); if (this._cur) this.openProject(this._cur.id); } else this._toast(d.detail || '失败', 'error');
      } catch (e) { this._toast('网络错误', 'error'); }
    },

    addComment: async function (cid) {
      var el = document.getElementById('al_cmt'); var text = el ? el.value.trim() : '';
      if (!text) return;
      try { var d = await (await fetch('/api/assets/' + cid + '/comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: text }) })).json();
        if (d.ok) this.openAsset(cid); else this._toast(d.detail || '失败', 'error');
      } catch (e) { this._toast('网络错误', 'error'); }
    },

    // ---------- 生成溯源 + 关联词卡 ----------
    setRating: async function (cid, n) {
      try {
        await fetch('/api/assets/' + cid, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: n }) });
        var box = document.getElementById('al_rate_' + cid);
        if (box) { var sp = box.querySelectorAll('span'); for (var i = 0; i < sp.length; i++) sp[i].style.color = (i < n) ? '#f59e0b' : '#cbd5e1'; }
        this._toast('评分已保存', 'success');
      } catch (e) { this._toast('保存失败', 'error'); }
    },

    saveProvenance: async function (cid) {
      var gm = (document.getElementById('al_gm') || {}).value || '';
      var gpv = (document.getElementById('al_gp') || {}).value || '';
      var raw = (document.getElementById('al_gpar') || {}).value || '';
      var pars = {};
      if (raw.trim()) { try { pars = JSON.parse(raw); } catch (e) { this._toast('参数 JSON 格式错误', 'error'); return; } }
      try {
        await fetch('/api/assets/' + cid, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gen_model: gm, gen_prompt: gpv, gen_params: pars }) });
        this._toast('溯源信息已保存', 'success');
      } catch (e) { this._toast('保存失败', 'error'); }
    },

    searchCards: function (cid) {
      var self = this; clearTimeout(this._cardT);
      this._cardT = setTimeout(async function () {
        var q = (document.getElementById('al_refq') || {}).value || '';
        var box = document.getElementById('al_refresults'); if (!box) return;
        if (!q.trim()) { box.innerHTML = ''; return; }
        try {
          var d = await (await fetch('/api/v4/cards?page_size=8&search=' + encodeURIComponent(q))).json();
          var list = d.items || d.cards || [];
          box.innerHTML = list.length ? list.map(function (cd) {
            return '<div style="padding:5px 8px;border-bottom:1px solid var(--border-color);cursor:pointer;font-size:12px;" onclick="PK_ASSETLIB.linkRef(' + cid + ',' + cd.id + ')">➕ ' + self._esc(cd.name || ('#' + cd.id)) + '</div>';
          }).join('') : '<div style="color:var(--text-muted);font-size:12px;padding:6px;">无匹配词卡</div>';
        } catch (e) { box.innerHTML = ''; }
      }, 300);
    },

    linkRef: async function (cid, refId) {
      try {
        var d = await (await fetch('/api/assets/' + cid + '/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref_type: 'word_card', ref_id: refId }) })).json();
        if (d.ok) { this._renderRefChips(cid, d.refs); var q = document.getElementById('al_refq'); if (q) q.value = ''; var rr = document.getElementById('al_refresults'); if (rr) rr.innerHTML = ''; this._toast('已关联', 'success'); }
        else this._toast(d.detail || '关联失败', 'error');
      } catch (e) { this._toast('网络错误', 'error'); }
    },

    unlinkRef: async function (cid, refType, refId) {
      try {
        var d = await (await fetch('/api/assets/' + cid + '/link/' + refType + '/' + refId, { method: 'DELETE' })).json();
        if (d.ok) this._renderRefChips(cid, d.refs);
      } catch (e) {}
    },

    _renderRefChips: function (cid, refs) {
      var self = this; var box = document.getElementById('al_refchips'); if (!box) return;
      refs = refs || [];
      box.innerHTML = refs.length ? refs.map(function (rf) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg-input,#1e293b);border:1px solid var(--border-color);border-radius:12px;padding:2px 8px;margin:2px;font-size:12px;">🔗 ' + self._esc(rf.name || ('#' + rf.ref_id)) + ' <span onclick="PK_ASSETLIB.unlinkRef(' + cid + ',\'' + rf.ref_type + '\',' + rf.ref_id + ')" style="cursor:pointer;color:var(--danger,#ef4444);">✕</span></span>';
      }).join('') : '<span style="color:var(--text-muted);font-size:12px;">暂无关联</span>';
    },

    // ---------- 团队成员 ----------
    openMembers: async function () {
      var p = this._cur; if (!p) return;
      var self = this;
      try {
        var d = await (await fetch('/api/projects/' + p.id + '/members')).json();
        var myRole = d.my_role;
        var canManage = myRole === 'owner';
        var roleName = { owner: '所有者', reviewer: '审核员', editor: '编辑', viewer: '查看' };
        var rows = (d.members || []).map(function (m) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);">' +
            '<div style="width:32px;height:32px;border-radius:8px;background:' + (m.avatar_color || '#334155') + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">' + ((m.display_name || m.username || '?').charAt(0).toUpperCase()) + '</div>' +
            '<div style="flex:1;min-width:0;"><div style="font-size:13px;color:var(--text-main);">' + self._esc(m.display_name || m.username) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">@' + self._esc(m.username || '') + ' · ' + (roleName[m.role] || m.role) + '</div></div>' +
            (canManage && m.role !== 'owner' ? '<button class="btn btn-sm btn-outline-danger" onclick="PK_ASSETLIB.removeMember(' + m.user_id + ')">移除</button>' : '') +
            '</div>';
        }).join('');
        var addBox = canManage ? '<div style="margin-top:12px;display:flex;gap:6px;">' +
          '<input id="al_muser" placeholder="用户名" style="flex:1;padding:6px 8px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;">' +
          '<select id="al_mrole" style="padding:6px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;"><option value="viewer">查看</option><option value="editor">编辑</option><option value="reviewer">审核员</option></select>' +
          '<button class="btn btn-sm btn-primary" onclick="PK_ASSETLIB.addMember()">添加</button></div>' : '';
        var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'alMemOverlay';
        ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
        ov.innerHTML = '<div class="pk-auth-modal" style="max-width:440px;width:92vw;" onclick="event.stopPropagation()">' +
          '<h4>👥 项目成员 · ' + self._esc(p.name) + '</h4>' +
          '<div style="max-height:50vh;overflow:auto;">' + rows + '</div>' + addBox +
          (canManage ? '' : '<div style="color:var(--text-muted);font-size:11px;margin-top:8px;">仅项目所有者可管理成员</div>') +
          '<div class="pk-modal-actions"><button class="btn btn-primary" onclick="document.getElementById(\'alMemOverlay\').remove()">关闭</button></div></div>';
        document.body.appendChild(ov);
      } catch (e) { this._toast('加载成员失败', 'error'); }
    },

    addMember: async function () {
      var p = this._cur; if (!p) return;
      var uname = (document.getElementById('al_muser') || {}).value;
      var role = (document.getElementById('al_mrole') || {}).value || 'viewer';
      if (!uname || !uname.trim()) { this._toast('请输入用户名', 'error'); return; }
      try { var d = await (await fetch('/api/projects/' + p.id + '/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname.trim(), role: role }) })).json();
        if (d.ok) { this._toast('已添加', 'success'); this.openMembers(); } else this._toast(d.detail || '添加失败', 'error');
      } catch (e) { this._toast('网络错误', 'error'); }
    },

    removeMember: async function (uid) {
      var p = this._cur; if (!p) return;
      if (!confirm('确定移除该成员？')) return;
      try { var d = await (await fetch('/api/projects/' + p.id + '/members/' + uid, { method: 'DELETE' })).json();
        if (d.ok) { this._toast('已移除', 'success'); this.openMembers(); } else this._toast(d.detail || '失败', 'error');
      } catch (e) { this._toast('网络错误', 'error'); }
    },

    // ---------- 导航按钮 ----------
    _injectNav: function (attempt) {
      attempt = attempt || 0;
      if (!localStorage.getItem('pk_token')) return;
      var actions = document.querySelector('.header-actions');
      if (!actions) { if (attempt < 30) setTimeout(this._injectNav.bind(this, attempt + 1), 200); return; }
      if (document.getElementById('alNavBtn')) return;
      var btn = document.createElement('button');
      btn.id = 'alNavBtn'; btn.className = 'header-btn'; btn.title = '项目资产库';
      btn.innerHTML = '<span style="font-size:14px;">📦</span><span style="margin-left:4px;font-size:12px;">项目资产</span>';
      btn.onclick = function () { PK_ASSETLIB.open(); };
      var ref = document.getElementById('pkPresenceWrap') || document.getElementById('navDropdownUser') || document.getElementById('pluginNavRight');
      if (ref && ref.parentNode === actions) actions.insertBefore(btn, ref);
      else actions.insertBefore(btn, actions.firstChild);
    },

    // ---------- 工具 ----------
    _esc: function (s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; },
    _fmtSize: function (n) { n = n || 0; if (n < 1024) return n + 'B'; if (n < 1048576) return (n / 1024).toFixed(1) + 'KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + 'MB'; return (n / 1073741824).toFixed(2) + 'GB'; },
    _toast: function (msg, type, ms) {
      if (typeof App !== 'undefined' && App.showToast) { App.showToast(msg, type || 'info'); return; }
      var t = document.getElementById('al_toast');
      if (!t) { t = document.createElement('div'); t.id = 'al_toast'; t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 18px;border-radius:10px;font-size:13px;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.3);'; document.body.appendChild(t); }
      t.style.background = type === 'error' ? '#ef4444' : (type === 'success' ? '#10b981' : '#334155');
      t.textContent = msg; t.style.display = 'block';
      clearTimeout(this._toastT); this._toastT = setTimeout(function () { t.style.display = 'none'; }, ms || 2600);
    },

    init: function () { this._navFix(0); },

    _navFix: function (attempt) {
      attempt = attempt || 0;
      // 隐藏插件重复的“项目管理”右侧按钮（已并入顶部“项目”下拉）
      try {
        var pnr = document.getElementById('pluginNavRight');
        if (pnr) {
          var ic = pnr.querySelector('.bi-kanban');
          if (ic) { var w = ic.closest('.pk-nav-btn-wrap') || ic.parentElement; if (w) w.style.display = 'none'; }
        }
        // 清理旧版可能遗留的独立 📦 按钮
        var old = document.getElementById('alNavBtn');
        if (old) old.remove();
      } catch (e) {}
      if (attempt < 15) setTimeout(this._navFix.bind(this, attempt + 1), 500);
    }
  };

  window.PK_ASSETLIB = AL;
  function boot() { if (localStorage.getItem('pk_token')) AL.init(); else setTimeout(boot, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  console.log('[PK_ASSETLIB] project asset library UI ready');
})();
