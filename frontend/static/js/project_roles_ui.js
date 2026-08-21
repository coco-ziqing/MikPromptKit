/**
 * PromptKit 项目设定/场景库 UI — Phase36.2-d（自包含面板）
 * 流程：选总项目 → 角色库/场景库 → 从公共库继承/新建 → 实例详情(设定编辑+自动版本+回滚+档案三视图)
 */
(function () {
  'use strict';

  var LABELS = {
    gender: '性别', age: '年龄', hairstyle: '发型发色', facial: '脸型五官', expression: '表情神态',
    body: '体型身材', clothing: '服装服饰', accessory: '配饰道具', pose: '姿态动作', occupation: '职业身份',
    temperament: '气质性格', style: '画风风格', background: '背景场景', lighting: '光照氛围',
    color_scheme: '色调质感', quality: '画质参数', negative: '负面提示词',
    location: '场景类型', architecture: '建筑风格', time: '时间时刻', season: '季节气候',
    weather: '天气现象', atmosphere: '氛围情绪', perspective: '视角取景', composition: '构图布局', details: '细节元素'
  };
  var ST = { draft: { t: '创作中', c: '#94a3b8' }, in_review: { t: '共审中', c: '#f59e0b' }, approved: { t: '已定稿', c: '#10b981' } };
  var KIND = { ref_image: '参考图', three_view: '三视图', turnaround: '转身多角度', material: '资料', other: '其他' };

  var RL = {
    _mid: null, _mname: '', _rt: 'character', _projects: [],

    open: async function () {
      var user = window.PK_AUTH_CLIENT && PK_AUTH_CLIENT._user;
      if (!user) { this._toast('请先登录', 'error'); return; }
      document.querySelectorAll('#mainContent > .view-panel').forEach(function (p) { p.style.display = 'none'; });
      var vp = document.getElementById('viewProjectRoles');
      if (vp) vp.style.display = 'block';
      try { if (window.App && App._collapseSidebar) App._collapseSidebar(); } catch (e) {}
      this._mid = null;
      this.renderPicker();
    },
    close: function () {
      var vp = document.getElementById('viewProjectRoles');
      if (vp) vp.style.display = 'none';
      if (typeof App !== 'undefined' && App.switchView) App.switchView('home');
    },

    // ---------- 总项目选择 ----------
    renderPicker: async function () {
      var vp = document.getElementById('viewProjectRoles');
      vp.innerHTML = '<div style="height:100%;overflow-y:auto;padding:20px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
        '<h4 style="margin:0;font-size:16px;font-weight:700;color:var(--text-main);">🎭 项目设定/场景库</h4>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ROLES.close()">← 返回</button></div>' +
        '<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">选择一个总项目，管理其角色库与场景库（可从公共库继承复用、独立版本管理、上传三视图档案）</div>' +
        '<div id="rl_projgrid" class="user-grid"></div></div>';
      var g = document.getElementById('rl_projgrid');
      try {
        var d = await (await fetch('/api/master-projects')).json();
        this._projects = d.projects || [];
        if (!this._projects.length) { g.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted);">暂无总项目（请先在「项目看板」创建总项目）</div>'; return; }
        var self = this;
        g.innerHTML = this._projects.map(function (p) {
          return '<div class="user-card" style="cursor:pointer;" onclick="PK_ROLES.openProject(' + p.id + ',\'' + self._esc(p.name) + '\')">' +
            '<div class="user-card-header"><div class="user-avatar" style="background:#334155;">' + self._esc((p.name || '?').charAt(0)) + '</div>' +
            '<div class="user-info"><div class="user-name">' + self._esc(p.name) + '</div>' +
            '<div class="user-username">🎭 ' + (p.char_count || 0) + ' 角色 · 🏞 ' + (p.scene_count || 0) + ' 场景</div></div></div>' +
            '<div class="user-card-actions"><button class="btn-outline" onclick="event.stopPropagation();PK_ROLES.openProject(' + p.id + ',\'' + self._esc(p.name) + '\')">📂 进入</button></div></div>';
        }).join('');
      } catch (e) { g.innerHTML = '<div style="padding:20px;color:var(--danger);">加载未完成</div>'; }
    },

    // ---------- 项目设定/场景库 ----------
    openProject: function (mid, name) {
      this._mid = mid; this._mname = name || ''; this._rt = 'character';
      this.renderLib();
    },
    setType: function (rt) { this._rt = rt; this.renderLib(); },

    renderLib: function () {
      var vp = document.getElementById('viewProjectRoles');
      var self = this;
      var tab = function (rt, label) {
        var on = self._rt === rt;
        return '<button onclick="PK_ROLES.setType(\'' + rt + '\')" style="padding:6px 14px;border:none;background:none;cursor:pointer;font-size:14px;font-weight:600;color:' + (on ? 'var(--primary,#3b82f6)' : 'var(--text-muted)') + ';border-bottom:2px solid ' + (on ? 'var(--primary,#3b82f6)' : 'transparent') + ';">' + label + '</button>';
      };
      vp.innerHTML = '<div style="height:100%;overflow-y:auto;padding:20px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px;">' +
        '<div><button class="btn btn-sm btn-outline-secondary" onclick="PK_ROLES.renderPicker()">← 项目列表</button> ' +
        '<span style="font-size:16px;font-weight:700;color:var(--text-main);margin-left:8px;">' + this._esc(this._mname) + '</span></div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-sm btn-primary" onclick="PK_ROLES.adopt()">⬇ 从公共库继承</button>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ROLES.newInstance()">＋ 新建</button></div></div>' +
        '<div style="display:flex;border-bottom:1px solid var(--border-color);margin-bottom:12px;">' + tab('character', '🎭 角色库') + tab('scene', '🏞 场景库') + '</div>' +
        '<div id="rl_grid" class="user-grid"></div></div>';
      this.loadRoles();
    },

    loadRoles: async function () {
      var g = document.getElementById('rl_grid'); if (!g) return;
      g.innerHTML = '<div style="padding:20px;color:var(--text-muted);">加载中...</div>';
      var self = this;
      try {
        var d = await (await fetch('/api/master/' + this._mid + '/roles?role_type=' + this._rt)).json();
        var roles = d.roles || [];
        if (!roles.length) { g.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted);">暂无' + (this._rt === 'character' ? '角色' : '场景') + '实例 · 点「⬇ 从公共库继承」或「＋ 新建」</div>'; return; }
        g.innerHTML = roles.map(function (r) {
          var st = ST[r.review_status] || ST.draft;
          var cover = r.asset_count > 0 ? '<img src="' + r.cover_url + '" style="width:100%;height:110px;object-fit:cover;background:#0b1220;" onerror="this.style.display=\'none\'">'
            : '<div style="height:110px;display:flex;align-items:center;justify-content:center;font-size:34px;background:var(--bg-input,#0b1220);">' + (self._rt === 'character' ? '🎭' : '🏞') + '</div>';
          return '<div class="user-card" style="cursor:pointer;overflow:hidden;" onclick="PK_ROLES.openInstance(' + r.id + ')">' +
            '<div style="position:relative;">' + cover +
            '<span style="position:absolute;top:4px;left:6px;background:' + st.c + ';color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;">' + st.t + '</span>' +
            '<span style="position:absolute;bottom:4px;right:6px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;padding:1px 5px;border-radius:6px;">v' + (r.version_count || 1) + ' · ' + (r.asset_count || 0) + '档</span></div>' +
            '<div style="padding:6px 8px;"><div style="font-size:13px;font-weight:600;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._esc(r.name) + '</div>' +
            (r.source_profile_id ? '<div style="font-size:10px;color:var(--text-muted);">继承自公共库</div>' : '<div style="font-size:10px;color:var(--text-muted);">项目自建</div>') + '</div></div>';
        }).join('');
      } catch (e) { g.innerHTML = '<div style="padding:20px;color:var(--danger);">加载未完成</div>'; }
    },

    // ---------- 继承 / 新建 ----------
    adopt: async function () {
      var self = this;
      var api = this._rt === 'character' ? '/api/character-composer/characters' : '/api/scene-composer/scenes';
      var d = await (await fetch(api + '?page_size=100')).json();
      var items = d.items || [];
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'rlAdopt';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      var list = items.length ? items.map(function (it) {
        return '<div style="padding:8px 10px;border-bottom:1px solid var(--border-color);cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="PK_ROLES.doAdopt(' + it.id + ')">' +
          '<span style="font-size:13px;color:var(--text-main);">' + self._esc(it.name || ('#' + it.id)) + '</span><span style="font-size:11px;color:var(--primary);">继承 →</span></div>';
      }).join('') : '<div style="padding:20px;text-align:center;color:var(--text-muted);">公共库暂无' + (this._rt === 'character' ? '角色' : '场景') + '，请先在组装器创建</div>';
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:460px;width:92vw;" onclick="event.stopPropagation()">' +
        '<h4>⬇ 从公共' + (this._rt === 'character' ? '角色' : '场景') + '库继承</h4>' +
        '<div style="max-height:56vh;overflow:auto;">' + list + '</div>' +
        '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-auth-modal-overlay\').remove()">取消</button></div></div>';
      document.body.appendChild(ov);
    },
    doAdopt: async function (srcId) {
      try {
        var d = await (await fetch('/api/master/' + this._mid + '/roles/adopt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role_type: this._rt, source_profile_id: srcId }) })).json();
        var ov = document.getElementById('rlAdopt'); if (ov) ov.remove();
        if (d.ok) { this._toast('已继承', 'success'); this.loadRoles(); this.openInstance(d.id); } else this._toast(d.detail || '继承未完成', 'error');
      } catch (e) { this._toast('网络不太稳定，请稍后重试', 'error'); }
    },
    // v5.36.38: 新建实例弹窗（手动 / 预设模板 / 人设文档识别）
    newInstance: async function () {
      var self = this;
      var rt = this._rt;
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'rlNew';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      var tabs = ['manual', 'template', 'doc'];
      var tabNames = { manual: '📝 手动填写', template: '📚 预设模板', doc: '🤖 人设文档识别' };
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:640px;width:94vw;" onclick="event.stopPropagation()">' +
        '<h4 style="display:flex;align-items:center;justify-content:space-between;"><span>＋ 新建' + (rt === 'character' ? '角色' : '场景') + '实例</span>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'rlNew\').remove()">✕</button></h4>' +
        '<div style="display:flex;gap:4px;margin-bottom:10px;border-bottom:1px solid var(--border-color);">' +
        tabs.map(function (t) {
          return '<button class="rl-new-tab" data-tab="' + t + '" style="padding:6px 12px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-muted);border-bottom:2px solid transparent;">' + tabNames[t] + '</button>';
        }).join('') + '</div>' +
        '<div id="rlNewBody"></div>' +
        '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="document.getElementById(\'rlNew\').remove()">取消</button>' +
        '<button class="btn btn-primary" id="rlNewGo" style="display:none;">创建</button></div></div>';
      document.body.appendChild(ov);
      var curTab = 'manual';
      function switchTab(t) {
        curTab = t;
        ov.querySelectorAll('.rl-new-tab').forEach(function (b) {
          var on = b.dataset.tab === t;
          b.style.color = on ? 'var(--primary,#3b82f6)' : 'var(--text-muted)';
          b.style.borderBottomColor = on ? 'var(--primary,#3b82f6)' : 'transparent';
        });
        var go = document.getElementById('rlNewGo');
        if (t === 'manual') {
          go.style.display = 'inline-block'; go.textContent = '创建';
          document.getElementById('rlNewBody').innerHTML =
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">填写名称，创建后可在详情中继续添加设定字段</div>' +
            '<label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">名称</label>' +
            '<input id="rl_new_name" class="s2-input" style="width:100%;padding:7px 10px;" placeholder="' + (rt === 'character' ? '如：林晚晴' : '如：雨夜小巷') + '" value="' + (rt === 'character' ? '新角色' : '新场景') + '">';
        } else if (t === 'template') {
          go.style.display = 'none';
          document.getElementById('rlNewBody').innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:10px 0;">加载预设模板...</div>';
          self._loadTemplatePicker(rt);
        } else {
          go.style.display = 'none';
          document.getElementById('rlNewBody').innerHTML =
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">粘贴' + (rt === 'character' ? '人设' : '场景设定') + '文档，自动拆分字段填入（可用 Ollama 识别，也可手动修正）</div>' +
            '<textarea id="rl_new_doc" class="s2-input" style="width:100%;min-height:160px;padding:8px;" placeholder="如：\n姓名：林晚晴\n年龄：28岁\n职业：广告公司创意总监\n性格：干练果敢、外冷内热\n发型：及肩短发\n服装：剪裁利落的深色西装\n..."></textarea>' +
            '<div style="margin-top:8px;"><button class="btn btn-sm btn-primary" onclick="PK_ROLES._parseDoc()">🤖 识别并拆分为字段</button> ' +
            '<span style="font-size:11px;color:var(--text-muted);">识别结果将填入下方字段，可编辑后创建</span></div>' +
            '<div id="rl_parse_result" style="margin-top:8px;"></div>';
        }
      }
      ov.querySelectorAll('.rl-new-tab').forEach(function (b) { b.onclick = function () { switchTab(b.dataset.tab); }; });
      document.getElementById('rlNewGo').onclick = function () {
        var name = (document.getElementById('rl_new_name') || {}).value || '';
        if (!name.trim()) { self._toast('名称必填', 'error'); return; }
        self._createInstance(name, {});
      };
      switchTab('manual');
    },

    // 创建实例（手动/文档共用）
    _createInstance: async function (name, settings) {
      var self = this;
      try {
        var d = await (await fetch('/api/master/' + this._mid + '/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role_type: this._rt, name: name, settings: settings || {} }) })).json();
        if (d.ok) {
          var ov = document.getElementById('rlNew'); if (ov) ov.remove();
          this._toast('✅ 已创建', 'success'); this.loadRoles(); this.openInstance(d.id);
        } else { this._toast(d.detail || '创建未完成', 'error'); }
      } catch (e) { this._toast('创建未完成', 'error'); }
    },

    // 预设模板列表（公共库）
    _loadTemplatePicker: async function (rt) {
      var self = this;
      var api = rt === 'character' ? '/api/character-composer/characters' : '/api/scene-composer/scenes';
      try {
        var d = await (await fetch(api + '?page_size=100')).json();
        var items = d.items || [];
        var box = document.getElementById('rlNewBody');
        if (!box) return;
        if (!items.length) {
          box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">公共库暂无' + (rt === 'character' ? '角色' : '场景') + '模板，可切到「📝 手动填写」创建</div>';
          return;
        }
        var h = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">从公共库选择预设' + (rt === 'character' ? '角色' : '场景') + '模板（点击预览，选中即继承创建）：</div>' +
          '<div style="max-height:340px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;">';
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var prev = (function () { try { var s = it.settings || (it.settings_json ? JSON.parse(it.settings_json) : {}); return Object.keys(s).slice(0, 3).map(function (k) { return (LABELS[k] || k) + ':' + s[k]; }).join(' · '); } catch (e) { return ''; } })();
          h += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:8px;cursor:pointer;" onclick="PK_ROLES._adoptTemplate(' + it.id + ')" title="点击创建：' + self._esc(prev || '') + '">' +
            '<div style="font-size:13px;font-weight:600;">' + self._esc(it.name || ('#' + it.id)) + '</div>' +
            (prev ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self._esc(prev) + '</div>' : '') +
            '<div style="font-size:10px;color:var(--primary);margin-top:4px;">点击创建 →</div></div>';
        }
        h += '</div>';
        box.innerHTML = h;
      } catch (e) { box.innerHTML = '<div style="padding:16px;color:var(--danger);">加载模板失败</div>'; }
    },

    // 从预设模板继承创建
    _adoptTemplate: async function (srcId) {
      var self = this;
      try {
        var d = await (await fetch('/api/master/' + this._mid + '/roles/adopt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role_type: this._rt, source_profile_id: srcId }) })).json();
        var ov = document.getElementById('rlNew'); if (ov) ov.remove();
        if (d.ok) { this._toast('✅ 已从模板创建', 'success'); this.loadRoles(); this.openInstance(d.id); }
        else { this._toast(d.detail || '创建未完成', 'error'); }
      } catch (e) { this._toast('创建未完成', 'error'); }
    },

    // 人设文档识别 → 拆字段
    _parseDoc: async function () {
      var self = this;
      var text = (document.getElementById('rl_new_doc') || {}).value || '';
      if (!text.trim()) { this._toast('请先粘贴人设文档', 'error'); return; }
      var btn = document.querySelector('#rlNewBody button');
      var box = document.getElementById('rl_parse_result');
      if (box) box.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">🤖 正在识别拆分中...</div>';
      try {
        var d = await (await fetch('/api/master/' + this._mid + '/roles/parse-doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role_type: this._rt, text: text }) })).json();
        if (!d.ok) { if (box) box.innerHTML = '<div style="font-size:12px;color:var(--danger);">识别失败: ' + self._esc(d.detail || '') + '</div>'; return; }
        // 渲染可编辑字段
        var html = '<div style="font-size:12px;font-weight:600;margin-bottom:4px;">✅ 识别结果（可修改）：</div>' +
          '<label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px;">名称</label>' +
          '<input id="rl_pn" class="s2-input" style="width:100%;padding:5px 8px;margin-bottom:6px;" value="' + self._esc(d.name || '未命名') + '">' +
          '<div style="max-height:200px;overflow:auto;">';
        var keys = Object.keys(d.settings || {});
        if (!keys.length) {
          html += '<div style="font-size:11px;color:var(--text-muted);">未识别到字段，可手动添加</div>';
        }
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          html += '<div style="margin-bottom:4px;"><label style="font-size:10px;color:var(--text-muted);">' + self._esc(LABELS[k] || k) + '</label>' +
            '<input class="rl-pf" data-k="' + self._esc(k) + '" value="' + self._esc(d.settings[k]) + '" style="width:100%;padding:4px 8px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;"></div>';
        }
        html += '</div><div style="margin-top:6px;display:flex;gap:6px;">' +
          '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ROLES._addParseField()">＋字段</button>' +
          '<button class="btn btn-sm btn-success" onclick="PK_ROLES._createFromParse()">✅ 创建' + (this._rt === 'character' ? '角色' : '场景') + '</button></div>';
        box.innerHTML = html;
      } catch (e) { if (box) box.innerHTML = '<div style="font-size:12px;color:var(--danger);">识别异常: ' + self._esc(e.message) + '</div>'; }
    },

    // 识别结果添加字段
    _addParseField: function () {
      var k = prompt('字段名（如 gender / 自定义中文）:', ''); if (!k) return;
      var box = document.getElementById('rl_parse_result');
      if (!box) return;
      var div = document.createElement('div'); div.style.marginBottom = '4px';
      div.innerHTML = '<label style="font-size:10px;color:var(--text-muted);">' + this._esc(LABELS[k] || k) + '</label>' +
        '<input class="rl-pf" data-k="' + this._esc(k) + '" value="" style="width:100%;padding:4px 8px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;">';
      box.appendChild(div);
    },

    // 从识别结果创建实例
    _createFromParse: function () {
      var self = this;
      var name = (document.getElementById('rl_pn') || {}).value || '未命名';
      var settings = {};
      document.querySelectorAll('.rl-pf').forEach(function (i) { var k = i.getAttribute('data-k'); if (k) settings[k] = i.value; });
      var ov = document.getElementById('rlNew'); if (ov) ov.remove();
      this._createInstance(name, settings);
    },

    // ---------- 实例详情 ----------
    openInstance: async function (rid) {
      var self = this;
      try {
        var d = await (await fetch('/api/roles/' + rid)).json();
        if (!d.ok) { this._toast('无法打开', 'error'); return; }
        this._renderInstance(d.role);
      } catch (e) { this._toast('加载未完成', 'error'); }
    },
    _renderInstance: function (r) {
      var self = this;
      var st = ST[r.review_status] || ST.draft;
      // 设定字段编辑
      var keys = Object.keys(r.settings || {});
      var fields = keys.length ? keys.map(function (k) {
        return '<div style="margin-bottom:6px;"><label style="font-size:11px;color:var(--text-muted);">' + self._esc(LABELS[k] || k) + '</label>' +
          '<input class="rl-set" data-k="' + self._esc(k) + '" value="' + self._esc(r.settings[k]) + '" style="width:100%;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;"></div>';
      }).join('') : '<div style="color:var(--text-muted);font-size:12px;">暂无设定字段，点下方「＋字段」添加</div>';
      // 版本
      var vlist = (r.versions || []).map(function (v) {
        var cur = v.id === r.current_version_id;
        return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-color);font-size:12px;">' +
          '<span style="flex:1;">v' + v.version_no + (cur ? ' <span style="color:#10b981;">(当前)</span>' : '') + ' <span style="color:var(--text-muted);">' + self._esc(v.note || '') + ' · ' + (v.created_at || '').substring(5, 16) + '</span></span>' +
          (cur ? '' : '<button class="btn btn-sm btn-outline-secondary" onclick="PK_ROLES.rollback(' + r.id + ',' + v.id + ')">回滚</button>') + '</div>';
      }).join('');
      // 档案（按 kind 分组）
      var byk = {}; (r.assets || []).forEach(function (a) { (byk[a.asset_kind] = byk[a.asset_kind] || []).push(a); });
      var dossier = Object.keys(KIND).map(function (kind) {
        var arr = byk[kind] || [];
        var thumbs = arr.map(function (a) {
          var t = a.thumb_url ? '<img src="' + a.thumb_url + '" style="width:70px;height:70px;object-fit:cover;border-radius:6px;">' : '<div style="width:70px;height:70px;border-radius:6px;background:var(--bg-input,#0b1220);display:flex;align-items:center;justify-content:center;">📄</div>';
          return '<div style="position:relative;display:inline-block;margin:2px;" title="' + self._esc(a.caption || a.filename) + '"><a href="' + a.file_url + '" target="_blank">' + t + '</a>' +
            '<span onclick="PK_ROLES.delAsset(' + a.id + ',' + r.id + ')" style="position:absolute;top:-4px;right:-4px;background:var(--danger,#ef4444);color:#fff;border-radius:50%;width:16px;height:16px;line-height:16px;text-align:center;font-size:10px;cursor:pointer;">✕</span></div>';
        }).join('');
        return '<div style="margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text-main);margin-bottom:2px;">' + KIND[kind] + ' ' +
          '<button class="btn btn-xs btn-outline" style="font-size:10px;" onclick="PK_ROLES.uploadDossier(' + r.id + ',\'' + kind + '\')">＋上传</button> ' +
          '<button class="btn btn-xs btn-outline" style="font-size:10px;color:#8b5cf6;border-color:#8b5cf6;" onclick="PK_ROLES.pickCardAsset(' + r.id + ',\'' + kind + '\')" title="从角色模库词卡选择图片">📚 词卡</button>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;">' + (thumbs || '<span style="font-size:11px;color:var(--text-muted);">—</span>') + '</div></div>';
      }).join('');
      var threeViewBar = (r.role_type === 'character')
        ? '<div style="font-size:12px;font-weight:600;color:var(--text-main);margin:8px 0 4px;">🤖 AI 三视图 <button class="btn btn-xs btn-outline" style="font-size:10px;color:#10b981;border-color:#10b981;" onclick="PK_ROLES.openThreeViewGen(' + r.id + ')">⚙️ 提示词组装生成</button></div>' +
          '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">基于角色设定字段自动组装三视图提示词，调用 ComfyUI / 即梦 / LibTV 生成</div>'
        : '';

      var rs = r.review_status;
      var rbtns = '';
      if (rs === 'draft' || rs === 'rejected') rbtns += '<button class="btn btn-sm btn-primary" onclick="PK_ROLES.roleReview(' + r.id + ',\'submit\')">📤 提交审核</button> ';
      if (rs === 'in_review') rbtns += '<button class="btn btn-sm" style="background:#10b981;color:#fff;" onclick="PK_ROLES.roleReview(' + r.id + ',\'approve\')">✔ 批准</button> <button class="btn btn-sm" style="background:#ef4444;color:#fff;" onclick="PK_ROLES.roleReview(' + r.id + ',\'reject\')">✖ 驳回</button>';
      var actName = { submit: '📤邀请反馈', approve: '✔采纳', reject: '✖建议打磨', comment: '💬留言' };
      var rlist = (r.reviews || []).map(function (rv) { return '<div style="font-size:11px;padding:3px 0;border-bottom:1px solid var(--border-color);"><b>' + self._esc(rv.reviewer_name || '?') + '</b> ' + (actName[rv.action] || rv.action) + (rv.comment ? ' · ' + self._esc(rv.comment) : '') + ' <span style="color:var(--text-muted);">' + (rv.created_at || '').substring(5, 16) + '</span></div>'; }).join('') || '<span style="font-size:11px;color:var(--text-muted);">暂无共创记录</span>';
      var reviewHtml = '<div style="font-size:13px;font-weight:700;color:var(--text-main);margin:10px 0 4px;">🛡 审核</div><div style="margin-bottom:6px;">' + (rbtns || '<span style="font-size:11px;color:' + (ST[rs] || ST.draft).c + ';">当前：' + (ST[rs] || ST.draft).t + '</span>') + '</div><div style="max-height:100px;overflow:auto;">' + rlist + '</div>';

      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'rlInst';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:760px;width:94vw;" onclick="event.stopPropagation()">' +
        '<h4 style="display:flex;align-items:center;justify-content:space-between;"><span><input id="rl_name" value="' + self._esc(r.name) + '" style="font-size:15px;font-weight:700;border:none;background:none;color:var(--text-main);border-bottom:1px dashed var(--border-color);"> <span style="font-size:12px;color:' + st.c + ';">' + st.t + '</span>' + (r.source_name ? ' <span style="font-size:11px;color:var(--text-muted);">继承自「' + self._esc(r.source_name) + '」</span>' : '') + '</span>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'rlInst\').remove()">✕</button></h4>' +
        '<div style="display:flex;gap:16px;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:260px;">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;"><span style="font-size:13px;font-weight:700;color:var(--text-main);">🧩 设定字段</span>' +
        '<button class="btn btn-xs btn-outline-secondary" style="font-size:10px;" onclick="PK_ROLES.importTemplateFields(' + r.id + ')" title="从公共库角色模板导入字段">📚 从模板导入</button>' +
        '<button class="btn btn-xs btn-outline-secondary" style="font-size:10px;" onclick="PK_ROLES.docToFields(' + r.id + ')" title="粘贴角色设定长文，自动分析提取关键信息并结构化">🤖 文档识别</button></div>' +
        '<div id="rl_fields" style="max-height:300px;overflow:auto;">' + fields + '</div>' +
        '<div style="margin-top:8px;display:flex;gap:6px;"><button class="btn btn-sm btn-outline-secondary" onclick="PK_ROLES.addField()">＋字段</button>' +
        '<button class="btn btn-sm btn-success" onclick="PK_ROLES.saveInstance(' + r.id + ')">💾 保存(生成新版本)</button></div></div>' +
        '<div style="flex:1;min-width:240px;">' +
        '<div style="font-size:13px;font-weight:700;color:var(--text-main);margin-bottom:4px;">📦 档案（参考图/三视图）</div>' +
        '<div style="max-height:180px;overflow:auto;">' + dossier + '</div>' +
        threeViewBar +
        '<div style="font-size:13px;font-weight:700;color:var(--text-main);margin:10px 0 4px;">🕘 版本历史 (' + (r.versions || []).length + ')</div>' +
        '<div style="max-height:130px;overflow:auto;">' + vlist + '</div>' + reviewHtml + '</div>' +
        '</div>' +
        '<div class="pk-modal-actions"><button class="btn btn-outline-danger" style="margin-right:auto;" onclick="PK_ROLES.deleteInstance(' + r.id + ')">🗑 删除实例</button>' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'rlInst\').remove()">关闭</button></div></div>';
      document.body.appendChild(ov);
    },
    // v5.36.40: 编辑界面 — 从公共库模板导入字段（弹窗选择 → 填充 #rl_fields）
    importTemplateFields: async function (rid) {
      var self = this;
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'rlTplImport';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:560px;width:94vw;" onclick="event.stopPropagation()">' +
        '<h4 style="display:flex;align-items:center;justify-content:space-between;"><span>📚 从公共库模板导入字段</span>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'rlTplImport\').remove()">✕</button></h4>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">选择模板后，其设定字段将填入当前角色的「设定字段」（同名覆盖，可编辑后保存）</div>' +
        '<div id="rlTplImportBody" style="max-height:50vh;overflow:auto;">加载中...</div>' +
        '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="document.getElementById(\'rlTplImport\').remove()">取消</button></div></div>';
      document.body.appendChild(ov);
      try {
        var d = await (await fetch('/api/character-composer/characters?page_size=100')).json();
        var items = d.items || [];
        var box = document.getElementById('rlTplImportBody');
        if (!items.length) { box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">公共库暂无角色模板</div>'; return; }
        var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">';
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var prev = (function () { try { var s = it.settings || (it.settings_json ? JSON.parse(it.settings_json) : {}); return Object.keys(s).slice(0, 3).map(function (k) { return (LABELS[k] || k) + ':' + s[k]; }).join(' · '); } catch (e) { return ''; } })();
          h += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:8px;cursor:pointer;" onclick="PK_ROLES.applyTemplateFields(' + it.id + ',' + rid + ')" title="点击导入：' + self._esc(prev || '') + '">' +
            '<div style="font-size:13px;font-weight:600;">' + self._esc(it.name || ('#' + it.id)) + '</div>' +
            (prev ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self._esc(prev) + '</div>' : '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">（无字段）</div>') +
            '<div style="font-size:10px;color:var(--primary);margin-top:4px;">点击导入 →</div></div>';
        }
        h += '</div>';
        box.innerHTML = h;
      } catch (e) { document.getElementById('rlTplImportBody').innerHTML = '<div style="padding:16px;color:var(--danger);">加载失败</div>'; }
    },

    // 应用模板字段到编辑界面
    applyTemplateFields: async function (tplId, rid) {
      var self = this;
      try {
        var d = await (await fetch('/api/character-composer/characters/' + tplId)).json();
        var card = (d && d.character) ? d.character : (d && d.card ? d.card : d);
        var settings = card.settings || {};
        var ov = document.getElementById('rlTplImport'); if (ov) ov.remove();
        if (!Object.keys(settings).length) { this._toast('该模板无字段可导入', 'info'); return; }
        this._fillFields(settings);
        this._toast('✅ 已导入 ' + Object.keys(settings).length + ' 个字段（可编辑后保存）', 'success');
      } catch (e) { this._toast('导入未完成', 'error'); }
    },

    // v5.36.40: 编辑界面 — 角色设定长文识别（弹窗输入 → 分析提取 → 填充字段）
    docToFields: function (rid) {
      var self = this;
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'rlDocParse';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:560px;width:94vw;" onclick="event.stopPropagation()">' +
        '<h4 style="display:flex;align-items:center;justify-content:space-between;"><span>🤖 角色设定长文识别</span>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'rlDocParse\').remove()">✕</button></h4>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">粘贴角色设定长文（如人物小传、人设卡），AI 自动分析提取关键信息并结构化为字段，填入当前角色的「设定字段」</div>' +
        '<textarea id="rl_doc_text" class="s2-input" style="width:100%;min-height:180px;padding:8px;" placeholder="例如：\n林晚晴，28岁，广告公司创意总监，性格干练果敢、外冷内热。及肩短发，剪裁利落的深色西装，银色耳环。\n童年在小镇长大，大学毕业后进入广告行业……"></textarea>' +
        '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;">' +
        '<button class="btn btn-sm btn-primary" onclick="PK_ROLES.runDocParse(' + rid + ')">🤖 分析提取 → 填入字段</button>' +
        '<span style="font-size:11px;color:var(--text-muted);">识别结果会覆盖同名字段，可编辑后保存</span></div>' +
        '<div id="rl_doc_result" style="margin-top:10px;"></div>' +
        '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="document.getElementById(\'rlDocParse\').remove()">关闭</button></div></div>';
      document.body.appendChild(ov);
    },

    // 执行文档识别并填充字段
    runDocParse: async function (rid) {
      var self = this;
      var text = (document.getElementById('rl_doc_text') || {}).value || '';
      if (!text.trim()) { this._toast('请先粘贴角色设定长文', 'error'); return; }
      var box = document.getElementById('rl_doc_result');
      if (box) box.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">🤖 正在分析提取中...</div>';
      try {
        var mid = this._mid;
        var d = await (await fetch('/api/master/' + mid + '/roles/parse-doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role_type: 'character', text: text }) })).json();
        if (!d.ok) { if (box) box.innerHTML = '<div style="font-size:12px;color:var(--danger);">识别失败: ' + self._esc(d.detail || '') + '</div>'; return; }
        if (box) box.innerHTML = '<div style="font-size:12px;color:#10b981;">✅ 已提取 ' + Object.keys(d.settings || {}).length + ' 个字段' + (d.name ? '，识别名称：' + self._esc(d.name) : '') + '</div>';
        // 填充到当前编辑界面的设定字段
        var ov = document.getElementById('rlDocParse'); if (ov) ov.remove();
        self._fillFields(d.settings || {});
        self._toast('✅ 已填入字段（可编辑后保存）', 'success');
      } catch (e) { if (box) box.innerHTML = '<div style="font-size:12px;color:var(--danger);">识别异常: ' + self._esc(e.message) + '</div>'; }
    },

    // 填充字段到编辑界面（#rl_fields：已有同名覆盖，无则追加）
    _fillFields: function (settings) {
      var box = document.getElementById('rl_fields');
      if (!box) return;
      var keys = Object.keys(settings || {});
      var self = this;
      keys.forEach(function (k) {
        var v = settings[k];
        var ex = box.querySelector('.rl-set[data-k="' + k + '"]');
        if (ex) { ex.value = v; return; }
        var div = document.createElement('div'); div.style.marginBottom = '6px';
        div.innerHTML = '<label style="font-size:11px;color:var(--text-muted);">' + self._esc(LABELS[k] || k) + '</label>' +
          '<input class="rl-set" data-k="' + self._esc(k) + '" value="' + self._esc(v) + '" style="width:100%;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;">';
        box.appendChild(div);
      });
    },

    addField: function () {
      var k = prompt('字段名（如 gender / location 或自定义）:', ''); if (!k) return;
      var box = document.getElementById('rl_fields'); if (!box) return;
      if (box.querySelector('.rl-set[data-k="' + k + '"]')) { this._toast('字段已存在', 'error'); return; }
      var div = document.createElement('div'); div.style.marginBottom = '6px';
      div.innerHTML = '<label style="font-size:11px;color:var(--text-muted);">' + this._esc(LABELS[k] || k) + '</label><input class="rl-set" data-k="' + this._esc(k) + '" value="" style="width:100%;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:12px;">';
      if (box.firstChild && box.firstChild.style) box.appendChild(div); else box.innerHTML = ''; box.appendChild(div);
    },
    saveInstance: async function (rid) {
      var settings = {};
      document.querySelectorAll('#rl_fields .rl-set').forEach(function (i) { var k = i.getAttribute('data-k'); if (k) settings[k] = i.value; });
      var name = (document.getElementById('rl_name') || {}).value || undefined;
      try {
        var d = await (await fetch('/api/roles/' + rid, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, settings: settings }) })).json();
        if (d.ok) { this._toast(d.changed ? '已保存(新版本)' : '已保存', 'success'); this.openInstance(rid); this.loadRoles(); } else this._toast('保存未完成，稍后再试', 'error');
      } catch (e) { this._toast('网络不太稳定，请稍后重试', 'error'); }
    },
    rollback: async function (rid, vid) {
      try { var d = await (await fetch('/api/roles/' + rid + '/rollback/' + vid, { method: 'POST' })).json();
        if (d.ok) { this._toast('已回滚', 'success'); this.openInstance(rid); } } catch (e) { this._toast('未完成，稍后再试', 'error'); }
    },
    uploadDossier: function (rid, kind) {
      var self = this; var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async function () {
        if (!inp.files.length) return;
        var fd = new FormData(); fd.append('file', inp.files[0]); fd.append('asset_kind', kind); fd.append('caption', '');
        self._toast('上传中...', 'info', 20000);
        try { var d = await (await fetch('/api/roles/' + rid + '/assets', { method: 'POST', body: fd })).json();
          if (d.ok) { self._toast('已上传', 'success'); self.openInstance(rid); self.loadRoles(); } else self._toast('上传未完成', 'error');
        } catch (e) { self._toast('网络不太稳定，请稍后重试', 'error'); }
      };
      inp.click();
    },
    // v5.36.41: 从角色模库词卡选择图片归档
    pickCardAsset: function (rid, kind) {
      var self = this;
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'rlCardPick';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:680px;width:94vw;" onclick="event.stopPropagation()">' +
        '<h4 style="display:flex;align-items:center;justify-content:space-between;"><span>📚 从角色模库词卡选择 — ' + KIND[kind] + '</span>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'rlCardPick\').remove()">✕</button></h4>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">选择图片词卡，其图片将归档到当前角色的档案（可选词库分类）</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;" id="rlCardLibs"></div>' +
        '<div id="rlCardGrid" style="max-height:48vh;overflow:auto;">加载中...</div>' +
        '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="document.getElementById(\'rlCardPick\').remove()">取消</button></div></div>';
      document.body.appendChild(ov);
      this._cardKind = kind; this._cardRid = rid;
      this._loadCardLibs();
    },
    _loadCardLibs: async function () {
      var self = this;
      try {
        var d = await (await fetch('/api/seedance/v2/libraries')).json();
        var libs = (d && d.libraries) || [];
        var box = document.getElementById('rlCardLibs');
        if (!box) return;
        var html = '<button class="btn btn-xs btn-outline-secondary" style="font-size:10px;" onclick="PK_ROLES._loadCards(null)">全部</button>';
        for (var i = 0; i < libs.length; i++) {
          var l = libs[i];
          html += '<button class="btn btn-xs btn-outline-secondary" style="font-size:10px;" onclick="PK_ROLES._loadCards(' + l.id + ')">' + self._esc(l.dimension_name) + '</button>';
        }
        box.innerHTML = html;
      } catch (e) {}
    },
    _loadCards: async function (libId) {
      var self = this;
      var grid = document.getElementById('rlCardGrid');
      if (!grid) return;
      grid.innerHTML = '加载中...';
      try {
        var url = '/api/seedance/v2/libraries/cards?page_size=200' + (libId ? '&library_id=' + libId : '');
        // 尝试带 library_id；若无则拉全部词卡
        var d = await (await fetch(url)).json();
        var items = (d && (d.items || d.cards)) || [];
        if (!items.length) { grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">无图片词卡（可先在其他模块生成/上传图片词卡）</div>'; return; }
        var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;">';
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it.media_type === 'video') continue;
          var img = it.wc_thumbnail || it.preview_image || it.thumbnail || '';
          var imgUrl = img ? ('/api/seedance/v2/thumbnails/' + img) : '';
          h += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:6px;cursor:pointer;text-align:center;" onclick="PK_ROLES.confirmCardAsset(' + it.id + ')" title="' + self._esc(it.word_text || it.name || '') + '">' +
            (imgUrl ? '<img src="' + imgUrl + '" style="width:100%;height:90px;object-fit:cover;border-radius:5px;" loading="lazy" onerror="this.style.opacity=0.2">' : '<div style="height:90px;display:flex;align-items:center;justify-content:center;background:var(--bg-input,#0b1220);border-radius:5px;">🖼</div>') +
            '<div style="font-size:10px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self._esc(it.word_text || it.name || ('#' + it.id)) + '</div></div>';
        }
        h += '</div>';
        grid.innerHTML = h;
      } catch (e) { grid.innerHTML = '<div style="padding:16px;color:var(--danger);">加载词卡失败</div>'; }
    },
    confirmCardAsset: async function (cardId) {
      var self = this;
      try {
        var d = await (await fetch('/api/roles/' + this._cardRid + '/assets/from-card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card_id: cardId, asset_kind: this._cardKind }) })).json();
        var ov = document.getElementById('rlCardPick'); if (ov) ov.remove();
        if (d.ok) { this._toast('✅ 已归档到档案', 'success'); this.openInstance(this._cardRid); }
        else { this._toast(d.detail || '归档未完成', 'error'); }
      } catch (e) { this._toast('归档异常', 'error'); }
    },

    // v5.36.41: 三视图提示词组装器弹窗
    openThreeViewGen: function (rid) {
      var self = this;
      var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'rlTVGen';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      ov.innerHTML = '<div class="pk-auth-modal" style="max-width:720px;width:94vw;" onclick="event.stopPropagation()">' +
        '<h4 style="display:flex;align-items:center;justify-content:space-between;"><span>🤖 角色三视图生成组装器</span>' +
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'rlTVGen\').remove()">✕</button></h4>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">基于角色设定字段自动组装三视图提示词，调用图片生成引擎产出设定图，结果归档到角色档案</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:150px;"><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px;">生成引擎</label>' +
        '<select id="rlTVEngine" class="s2-input" style="width:100%;padding:5px 8px;">' +
        '<option value="dreamina">即梦 (在线，消耗积分)</option>' +
        '<option value="comfyui">ComfyUI (本地工作流)</option>' +
        '<option value="libtv">LibTV (在线画布)</option></select></div>' +
        '<div style="flex:0.8;min-width:100px;"><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px;">画幅</label>' +
        '<select id="rlTVRatio" class="s2-input" style="width:100%;padding:5px 8px;">' +
        '<option value="1:1">1:1 方形</option><option value="16:9">16:9 横版</option><option value="4:3">4:3 横版</option><option value="3:4">3:4 竖版</option><option value="2:3">2:3 竖版</option><option value="9:16">9:16 长竖</option></select></div>' +
        '<div style="flex:0.8;min-width:100px;"><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px;">LibTV UUID</label>' +
        '<input id="rlTVUUID" class="s2-input" style="width:100%;padding:5px 8px;" placeholder="选LibTV时填"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">' +
        '<div style="flex:0.8;min-width:140px;"><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px;">布局模式</label>' +
        '<select id="rlTVLayout" class="s2-input" style="width:100%;padding:5px 8px;" onchange="PK_ROLES._onTVLayoutChange(' + rid + ')">' +
        '<option value="single">逐视角三张（正/侧/背）</option>' +
        '<option value="sheet">单图设定表（正面+侧面+背面+脸部特写）</option></select></div>' +
        '<div style="flex:2;min-width:200px;"><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px;">风格前缀（可选，如 3D写实国漫风格，UE5渲染，细节超高清）</label>' +
        '<input id="rlTVStylePrefix" class="s2-input" style="width:100%;padding:5px 8px;" placeholder="留空=不注入风格段" onchange="PK_ROLES._onTVLayoutChange(' + rid + ')"></div>' +
        '</div>' +
        '<div style="font-size:12px;font-weight:600;margin-bottom:4px;">📝 组装提示词预览（可编辑）：</div>' +
        '<div id="rlTVPrompts"></div>' +
        '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="document.getElementById(\'rlTVGen\').remove()">取消</button>' +
        '<button class="btn btn-primary" id="rlTVGo" onclick="PK_ROLES.runThreeViewGen(' + rid + ')">🚀 生成三视图</button></div></div>';
      document.body.appendChild(ov);
      this._loadThreeViewPrompts(rid);
    },
    _onTVLayoutChange: function (rid) { this._loadThreeViewPrompts(rid); },
    _loadThreeViewPrompts: async function (rid) {
      var self = this;
      // v5.50.27: 防异步竞态——已提交任务卡时禁止重载；并发重载只允许最新一次渲染
      self._tvReloadSeq = (self._tvReloadSeq || 0) + 1;
      var seq = self._tvReloadSeq;
      if (document.getElementById('rlTVTaskList')) return;
      try {
        var d = await (await fetch('/api/roles/' + rid)).json();
        // 渲染前复查：期间有新重载或已提交任务卡 → 放弃本次（避免迟到重载覆盖任务卡）
        if (seq !== self._tvReloadSeq || document.getElementById('rlTVTaskList')) return;
        var role = (d && d.role) || {};
        var settings = role.settings || {};
        var layout = (document.getElementById('rlTVLayout') || {}).value || 'single';
        var stylePrefix = ((document.getElementById('rlTVStylePrefix') || {}).value || '').trim();
        var subj = [];
        ['occupation', 'gender', 'age', 'body', 'hairstyle', 'facial', 'clothing', 'accessory', 'temperament', 'style'].forEach(function (k) {
          var v = (settings[k] || '').trim(); if (v) subj.push(v);
        });
        var subjFull = (role.name || '角色') + (subj.length ? '（' + subj.join('，') + '）' : '');
        var stylePart = stylePrefix ? stylePrefix + '，' : '';
        var box = document.getElementById('rlTVPrompts');
        var h = '';
        if (layout === 'sheet') {
          // v5.50.26: 单图四宫格设定表（与后端 _build_three_view_prompts 一致）
          var sheetPrompt = stylePart + '角色三视图加脸部特写设定表，纯白背景，无阴影，清晰展示正面、侧面、背面标准正交视图，依次并排展示：正面全身站立像、90度侧面全身像、背面全身像、脸部特写，角色：' + subjFull + '，服装、发型、配饰等所有细节在三个视角中完全一致，人物比例协调，构图完整，专业角色设定图风格，高清细节，服装剪裁合身';
          h += '<div style="margin-bottom:6px;"><label style="font-size:10px;color:var(--text-muted);">🖼 设定表（四格并排）</label>' +
            '<textarea class="rl-tv-prompt" data-view="sheet" style="width:100%;min-height:88px;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;">' + self._esc(sheetPrompt) + '</textarea></div>';
        } else {
          var base = stylePart + subjFull + '，角色三视图设定图，纯白背景，全身立绘，统一角色外观与服装细节，人物比例协调，专业角色设定图风格，高清细节';
          var views = {
            front: base + '，正面视角，正面站姿，双手自然下垂，面部与服装正面完整展示',
            side: base + '，正侧面视角，侧身站姿，展示侧面轮廓与服装侧面细节',
            back: base + '，背面视角，背身站姿，展示背面服装与发型背面细节'
          };
          var vnames = { front: '正面', side: '侧面', back: '背面' };
          ['front', 'side', 'back'].forEach(function (v) {
            h += '<div style="margin-bottom:6px;"><label style="font-size:10px;color:var(--text-muted);">' + vnames[v] + '</label>' +
              '<textarea class="rl-tv-prompt" data-view="' + v + '" style="width:100%;min-height:52px;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input,transparent);color:var(--text-main);font-size:11px;">' + self._esc(views[v]) + '</textarea></div>';
          });
        }
        box.innerHTML = h;
      } catch (e) { document.getElementById('rlTVPrompts').innerHTML = '<div style="color:var(--danger);">加载设定失败</div>'; }
    },
    runThreeViewGen: async function (rid) {
      var self = this;
      var engine = document.getElementById('rlTVEngine').value;
      var ratio = document.getElementById('rlTVRatio').value;
      var uuid = document.getElementById('rlTVUUID').value;
      var layout = document.getElementById('rlTVLayout').value;
      var stylePrefix = (document.getElementById('rlTVStylePrefix').value || '').trim();
      var prompts = {};
      document.querySelectorAll('.rl-tv-prompt').forEach(function (t) { prompts[t.getAttribute('data-view')] = t.value; });
      var go = document.getElementById('rlTVGo');
      go.disabled = true; go.textContent = '⏳ 提交中...';
      try {
        var d = await (await fetch('/api/roles/' + rid + '/three-view/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: engine, ratio: ratio, project_uuid: uuid, caption: 'AI三视图', prompts: prompts, layout: layout, style_prefix: stylePrefix }) })).json();
        if (!d.ok) { this._toast(d.detail || '生成未完成', 'error'); go.disabled = false; go.textContent = '🚀 生成三视图'; return; }
        // v5.36.46: 任务卡 + 轮询回写（生成完成自动归档到档案区）
        var tasks = d.tasks || [];
        self._tvTasks = {};
        (tasks || []).forEach(function (t) { self._tvTasks[t.view] = t.task_id; });
        var box = document.getElementById('rlTVPrompts');
        box.innerHTML = '<div style="font-size:12px;color:#10b981;margin-bottom:6px;">✅ 已提交 ' + tasks.length + ' 个视图生成任务（' + engine + '），完成后自动归档到角色档案：</div>' +
          '<div id="rlTVTaskList">' + self._tvTaskCards(tasks, {}) + '</div>';
        this._toast('🚀 三视图任务已提交', 'success');
        go.disabled = false; go.textContent = '🚀 生成三视图';
        this._pollThreeViewTasks(rid);
      } catch (e) { this._toast('生成异常: ' + e.message, 'error'); go.disabled = false; go.textContent = '🚀 生成三视图'; }
    },
    _tvTaskCards: function (tasks, states) {
      // 任务卡渲染：视图名 + 状态徽章 + 进度条
      var self = this;
      var vnames = { front: '🖼 正面', side: '🖼 侧面', back: '🖼 背面', sheet: '🖼 设定表' };
      return (tasks || []).map(function (t) {
        var s = states[t.task_id] || { status: 'queued', progress: 0, error: '' };
        var badge = '', bar = '';
        if (s.status === 'queued') { badge = '<span style="color:#94a3b8;">⏳ 排队中</span>'; }
        else if (s.status === 'submitting') { badge = '<span style="color:#f59e0b;">📤 提交中</span>'; bar = self._tvBar(10); }
        else if (s.status === 'querying') { badge = '<span style="color:#3b82f6;">🎨 生成中 ' + (s.progress || 0) + '%</span>'; bar = self._tvBar(s.progress || 15); }
        else if (s.status === 'success') { badge = '<span style="color:#10b981;">✅ 已归档</span>'; bar = self._tvBar(100); }
        else { badge = '<span style="color:#ef4444;">❌ 失败</span>' + (s.error ? '<div style="font-size:10px;color:#ef4444;margin-top:2px;">' + self._esc(s.error) + '</div>' : ''); }
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:6px;background:var(--bg-input,rgba(127,127,127,.08));border-radius:6px;">' +
          '<span style="font-size:12px;min-width:72px;color:var(--text-main);">' + (vnames[t.view] || t.view) + '</span>' +
          '<div style="flex:1;">' + badge + bar + '</div></div>';
      }).join('');
    },
    _tvBar: function (pct) {
      return '<div style="height:4px;background:rgba(127,127,127,.15);border-radius:2px;margin-top:4px;overflow:hidden;">' +
        '<div style="height:100%;width:' + Math.max(0, Math.min(100, pct || 0)) + '%;background:linear-gradient(90deg,#3b82f6,#10b981);transition:width .5s;"></div></div>';
    },
    _pollThreeViewTasks: async function (rid) {
      var self = this;
      if (self._tvPolling) return;
      self._tvPolling = true;
      var tries = 0;
      var stop = function () { self._tvPolling = false; };
      try {
        var d = await (await fetch('/api/roles/' + rid + '/three-view/tasks')).json();
        var all = d.tasks || [];
        var mine = all.filter(function (t) { return Object.values(self._tvTasks || {}).indexOf(t.id) >= 0; });
        var states = {};
        mine.forEach(function (t) { states[t.id] = t; });
        var listBox = document.getElementById('rlTVTaskList');
        if (listBox) listBox.innerHTML = self._tvTaskCards(mine, states);
        var done = mine.length && mine.every(function (t) { return t.status === 'success' || t.status === 'fail'; });
        if (done || !mine.length) {
          stop();
          if (mine.some(function (t) { return t.status === 'success'; })) {
            this._toast('✅ 三视图生成完成，已归档到档案', 'success');
            this.openInstance(rid);  // 刷新档案区
          } else if (mine.length) {
            this._toast('三视图生成失败，详情见任务卡', 'error');
          }
          return;
        }
        if (tries++ > 150) { stop(); return; }  // 20 分钟兜底
        setTimeout(function () { self._pollThreeViewTasks(rid); }, 8000);
      } catch (e) {
        stop();
        setTimeout(function () { self._pollThreeViewTasks(rid); }, 8000);
      }
    },
    delAsset: async function (aid, rid) {
      if (!confirm('删除此档案？')) return;
      try { await fetch('/api/roles/assets/' + aid, { method: 'DELETE' }); this.openInstance(rid); this.loadRoles(); } catch (e) {}
    },
    deleteInstance: async function (rid) {
      if (!confirm('确定删除此实例？含其版本与档案，不可恢复！')) return;
      try { var d = await (await fetch('/api/roles/' + rid, { method: 'DELETE' })).json();
        if (d.ok) { var ov = document.getElementById('rlInst'); if (ov) ov.remove(); this._toast('已删除', 'success'); this.loadRoles(); } } catch (e) {}
    },

    // ---------- 分镜镜头应用本项目实例 ----------
    shotApply: async function (shotId, roleType) {
      var self = this;
      var spid = (window.App && App.seedanceV2 && App.seedanceV2.currentProjectId) || null;
      if (!spid) { this._toast('无法确定分镜项目', 'error'); return; }
      try {
        var d = await (await fetch('/api/seedance/' + spid + '/roles?role_type=' + roleType)).json();
        if (!d.master_project_id) { this._toast('该分镜项目未关联总项目', 'error'); return; }
        var roles = d.roles || [];
        var masterId = d.master_project_id;
        var ov = document.createElement('div'); ov.className = 'pk-auth-modal-overlay'; ov.id = 'rlShot';
        ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
        var emptyHtml = '<div style="padding:18px;text-align:center;color:var(--text-muted);">本总项目暂无' + (roleType === 'character' ? '角色' : '场景') + '实例，请先在「项目设定」创建</div>' +
          (masterId ? '<div style="text-align:center;padding:0 18px 14px;"><button class="btn btn-sm btn-primary" onclick="PK_ROLES.gotoProjectSettings(' + masterId + ')" style="padding:6px 16px;">⚙️ 前往项目设定 → 创建' + (roleType === 'character' ? '角色' : '场景') + '</button></div>' : '');
        var list = roles.length ? roles.map(function (r) {
          return '<div style="padding:8px 10px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="flex:1;cursor:pointer;font-size:13px;color:var(--text-main);" onclick="PK_ROLES.doShotApply(' + r.id + ',' + shotId + ')">' + (roleType === 'character' ? '🎭' : '🏞') + ' ' + self._esc(r.name) + ' <span style="font-size:10px;color:var(--text-muted);">v' + (r.version_count || 1) + '</span></span>' +
            '<span style="display:flex;gap:6px;align-items:center;">' +
            '<button class="btn btn-xs btn-outline" style="font-size:10px;padding:1px 8px;" onclick="event.stopPropagation();PK_ROLES.shotEditRole(' + r.id + ',' + masterId + ')" title="编辑此角色">✏️ 编辑</button>' +
            '<span style="font-size:11px;color:var(--primary);cursor:pointer;" onclick="PK_ROLES.doShotApply(' + r.id + ',' + shotId + ')">应用→</span>' +
            '</span></div>';
        }).join('') : emptyHtml;
        ov.innerHTML = '<div class="pk-auth-modal" style="max-width:420px;width:92vw;" onclick="event.stopPropagation()"><h4>🎬 为镜头选' + (roleType === 'character' ? '角色' : '场景') + '</h4>' +
          '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">本总项目实例（点击应用到镜头）：</div>' +
          '<div style="max-height:46vh;overflow:auto;">' + list + '</div>' +
          '<div class="pk-modal-actions">' +
          '<button class="btn btn-sm btn-outline-secondary" style="margin-right:auto;" onclick="PK_ROLES._browsePublic(' + shotId + ',\'' + roleType + '\')">📚 浏览公共库</button>' +
          '<button class="btn btn-sm btn-outline-secondary" style="color:#10b981;border-color:#10b981;" onclick="PK_ROLES.shotNewRole(' + masterId + ',\'' + roleType + '\')" title="新建' + (roleType === 'character' ? '角色' : '场景') + '">＋ 新建</button>' +
          '<button class="btn btn-sm btn-outline-secondary" style="color:#f59e0b;border-color:#f59e0b;" onclick="PK_ROLES.gotoProjectSettings(' + masterId + ')" title="跳转到项目设定面板">⚙️ 项目设定</button>' +
          '<button class="btn btn-secondary" onclick="this.closest(\'.pk-auth-modal-overlay\').remove()">关闭</button></div></div>';
        document.body.appendChild(ov);
      } catch (e) { this._toast('加载未完成', 'error'); }
    },
    // v5.36.37: 快捷跳转 → 项目设定（打开该总项目的角色库）
    gotoProjectSettings: function (masterId) {
      var ov = document.getElementById('rlShot'); if (ov) ov.remove();
      try { this.open(); } catch (e) {}
      var self = this;
      setTimeout(function () {
        try {
          var proj = null;
          var arr = self._projects || [];
          for (var i = 0; i < arr.length; i++) { if (arr[i].id === masterId) { proj = arr[i]; break; } }
          var pname = proj ? proj.name : '';
          self.openProject(masterId, pname);
          self._toast('已打开项目设定，可创建/选择角色实例', 'info');
        } catch (e) { self._toast('跳转未完成', 'error'); }
      }, 150);
    },
    // v5.36.39: 选角色弹窗 → 编辑指定角色（跳转面板 + 打开角色编辑）
    shotEditRole: function (rid, masterId) {
      var self = this;
      this.gotoProjectSettings(masterId);
      setTimeout(function () {
        try { self.openInstance(rid); } catch (e) { self._toast('打开角色编辑未完成', 'error'); }
      }, 400);
    },
    // v5.36.39: 选角色弹窗 → 新建角色（跳转面板 + 打开新建弹窗）
    shotNewRole: function (masterId, roleType) {
      var self = this;
      this.gotoProjectSettings(masterId);
      setTimeout(function () {
        try { self._rt = roleType; self.newInstance(); } catch (e) { self._toast('打开新建未完成', 'error'); }
      }, 400);
    },
    _browsePublic: function (shotId, roleType) {
      var ov = document.getElementById('rlShot'); if (ov) ov.remove();
      try {
        if (roleType === 'character') { if (window.App && App.characterLib && App.characterLib.openScenePicker) App.characterLib.openScenePicker(shotId); }
        else { if (window.App && App.seedanceV2 && App.seedanceV2._openSceneProfilePicker) App.seedanceV2._openSceneProfilePicker(shotId); }
      } catch (e) { this._toast('打开公共库未完成', 'error'); }
    },
    roleReview: async function (rid, action) {
      var comment = '';
      if (action === 'reject') { comment = prompt('打磨建议（可选）:', '') || ''; }
      try {
        var d = await (await fetch('/api/roles/' + rid + '/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action, comment: comment }) })).json();
        if (d.ok) { this._toast({ submit: '已邀请反馈', approve: '已采纳', reject: '已发送打磨建议' }[action] || '完成', 'success'); this.openInstance(rid); this.loadRoles(); }
        else this._toast(d.detail || '未完成', 'error');
      } catch (e) { this._toast('网络不太稳定，请稍后重试', 'error'); }
    },
    doShotApply: async function (rid, shotId) {
      try {
        var d = await (await fetch('/api/roles/' + rid + '/apply-to-shot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shot_id: shotId }) })).json();
        var ov = document.getElementById('rlShot'); if (ov) ov.remove();
        if (d.ok) {
          this._toast('已应用到镜头', 'success');
          try { if (window.App && App.seedanceV2) { App.seedanceV2.openProject(App.seedanceV2.currentProjectId); App.seedanceV2.compose(); } } catch (e) {}
        } else this._toast(d.detail || '应用未完成', 'error');
      } catch (e) { this._toast('网络不太稳定，请稍后重试', 'error'); }
    },

    _esc: function (s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; },
    _toast: function (m, t, ms) {
      // T5: 统一走 PK.toast
      if (window.PK && PK.toast) { PK.toast(m, t, ms); return; }
      if (typeof App !== 'undefined' && App.showToast) { App.showToast(m, t || 'info'); return; }
      var e = document.getElementById('rl_toast');
      if (!e) { e = document.createElement('div'); e.id = 'rl_toast'; e.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 18px;border-radius:10px;color:#fff;font-size:13px;'; document.body.appendChild(e); }
      e.style.background = t === 'error' ? '#ef4444' : (t === 'success' ? '#10b981' : '#334155'); e.textContent = m; e.style.display = 'block';
      clearTimeout(this._tt); this._tt = setTimeout(function () { e.style.display = 'none'; }, ms || 2400);
    }
  };
  window.PK_ROLES = RL;
  console.log('[PK_ROLES] project roles UI ready');
})();
