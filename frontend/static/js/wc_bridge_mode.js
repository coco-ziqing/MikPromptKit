(function boot() {
'use strict';
try { if (!App || (!App.fetchJSON && !window.PK)) { setTimeout(boot, 200); return; } }
catch(e) { setTimeout(boot, 200); return; }

App._wcSetupCardDrag = function() {
    var self = this;
    // 为所有 prompt-card 添加 draggable
    var cards = document.querySelectorAll('.prompt-card');
    cards.forEach(function(card) {
        if (card.dataset.dragBound) return;
        card.dataset.dragBound = '1';
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', function(e) {
            var cid = parseInt(card.dataset.promptId || card.dataset.cardId || this.getAttribute('data-id'));
            if (!cid) return;
            e.dataTransfer.setData('text/plain', String(cid));
            e.dataTransfer.effectAllowed = 'move';
            this.style.opacity = '0.4';
        });
        card.addEventListener('dragend', function(e) {
            this.style.opacity = '';
        });
    });
    
    // 侧边栏分组节点作为 drop target
    var sideNodes = document.querySelectorAll('#sidebar [data-gid], #sidebar .tree-node');
    sideNodes.forEach(function(node) {
        if (node.dataset.dropBound) return;
        node.dataset.dropBound = '1';
        node.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.style.background = 'rgba(79,70,229,0.08)';
            this.style.outline = '2px dashed var(--primary)';
        });
        node.addEventListener('dragleave', function(e) {
            this.style.background = '';
            this.style.outline = '';
        });
        node.addEventListener('drop', async function(e) {
            e.preventDefault();
            this.style.background = '';
            this.style.outline = '';
            var cid = parseInt(e.dataTransfer.getData('text/plain'));
            var gid = parseInt(this.dataset.gid);
            if (!cid || !gid) return;
            try {
                await self.fetchJSON('/api/v4/word-cards/' + cid, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ group_id: gid })
                });
                self.showToast('已移动词卡到分组', 'success');
                await self._wcLoadPrompts();
                await self.loadGroupTree();
            } catch(e) {
                self.showToast('移动未完成: ' + e.message, 'danger');
            }
        });
    });
};

// 全局辅助：复制本机指纹（激活弹窗内按钮调用）
window._licCopyFp = function() {
    var fpEl = document.getElementById('licFpDisplay');
    var fp = (fpEl && fpEl.textContent !== '⏳ 获取中...') ? fpEl.textContent : (App._licenseFingerprint || '');
    var btn = document.getElementById('licFpCopy');
    var msg = document.getElementById('licFpMsg');
    var done = function() {
        if (btn) { btn.textContent = '\u2705 已复制'; btn.style.background = '#059669'; btn.style.color = '#fff'; btn.style.borderColor = '#059669'; }
        if (msg) { msg.style.display = 'block'; msg.style.background = 'rgba(16,185,129,.1)'; msg.style.color = '#10b981'; msg.textContent = '\u2705 指纹已复制到剪贴板'; }
        setTimeout(function() {
            if (btn) { btn.textContent = '\uD83D\uDCCB 复制指纹'; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
            if (msg) { msg.style.display = 'none'; }
        }, 1800);
    };
    if (!fp) return;
    try {
        navigator.clipboard.writeText(fp).then(done).catch(function() {
            var ta = document.createElement('textarea');
            ta.value = fp; ta.style.position = 'fixed'; ta.style.left = '-9999px';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
            done();
        });
    } catch(e) {
        var ta = document.createElement('textarea');
        ta.value = fp; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch(e2) {}
        document.body.removeChild(ta);
        done();
    }
};

// 全局辅助：复制服务器地址+指纹（激活弹窗内按钮调用，发给管理员生成激活码）
window._licCopyInfo = function() {
    var fpEl = document.getElementById('licFpDisplay');
    var fp = (fpEl && fpEl.textContent !== '⏳ 获取中...') ? fpEl.textContent : (App._licenseFingerprint || '');
    var serverUrl = window.location.origin;
    var info = '服务器: ' + serverUrl + '\n指纹: ' + fp + '\n\n请在激活码生成器中输入服务器地址连接后生成激活码。';
    var btn = document.getElementById('licCopyInfo');
    var done = function() {
        if (btn) { btn.textContent = '✅ 已复制'; btn.style.background = '#059669'; btn.style.color = '#fff'; btn.style.borderColor = '#059669'; }
        setTimeout(function() {
            if (btn) { btn.textContent = '📋 复制服务器地址 + 指纹'; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
        }, 1800);
    };
    if (!fp) return;
    try {
        navigator.clipboard.writeText(info).then(done).catch(function() {
            var ta = document.createElement('textarea');
            ta.value = info; ta.style.position = 'fixed'; ta.style.left = '-9999px';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
            done();
        });
    } catch(e) {
        var ta = document.createElement('textarea');
        ta.value = info; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch(e2) {}
        document.body.removeChild(ta);
        done();
    }
};

// 全局辅助：下载激活数据包（异地离线场景用）
window._licDownloadPkg = async function() {
    var btn = document.getElementById('licDownloadPkg');
    if (!btn) return;
    btn.textContent = '⏳ 打包中...';
    btn.disabled = true;
    try {
        var r = await fetch('/api/license/export-package');
        var d = await r.json();
        if (!d.ok) throw new Error(d.detail || '导出失败');
        var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mik-activation-package.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        btn.textContent = '✅ 已下载';
        btn.style.background = '#059669'; btn.style.color = '#fff'; btn.style.borderColor = '#059669';
        setTimeout(function() {
            btn.textContent = '📥 下载激活数据包（异地离线用）';
            btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = '';
        }, 2000);
    } catch(e) {
        btn.textContent = '❌ 失败';
        setTimeout(function() {
            btn.textContent = '📥 下载激活数据包（异地离线用）';
        }, 2000);
    }
    btn.disabled = false;
};

// 确认解除激活弹窗
App._confirmDeactivate = function(mode) {
    var tier = mode === 'project' ? 'personal' : 'team';
    var label = mode === 'project' ? '个人项目版' : '团队项目版';
    if (!confirm('确认退出' + label + '？\n\n将解除本机激活绑定，返回个人词库版。\n如需再次使用需重新激活。')) return;
    var self = this;
    fetch('/api/license/deactivate', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: tier })
    }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
            // 切换回词库版
            document.querySelectorAll('.pk-mode-btn').forEach(function(b){ b.classList.remove('active'); });
            var libBtn = document.querySelector('.pk-mode-btn[data-mode="library"]');
            if (libBtn) libBtn.classList.add('active');
            self.state._currentMode = 'library';
            try { localStorage.setItem('promptkit_mode', 'library'); } catch(e) {}
            self._enterLibraryMode();
            if (typeof PK !== 'undefined' && PK.toast) PK.toast('\u2705 ' + label + '已解除激活，已返回词库版', 'success');
        } else {
            alert(d.detail || '解除失败');
        }
    }).catch(function() { alert('网络错误'); });
};

// ============================================================
// 三模式版本切换 + 许可激活
// ============================================================
App._switchMode = async function(mode, btn) {
    // 已激活模式再次点击 → 不重复
    if (App.state._currentMode === mode) return;

    // ── 版本切换状态限制 ──
    var tiers = App._activeTiers || {};
    // 团队版激活时：锁定在团队模式，不允许降级切换
    if (tiers.team && mode !== 'team') {
        if (typeof PK !== 'undefined' && PK.toast) {
            PK.toast('当前为团队项目版，已包含全部功能。\n如需切换请先在账户菜单中退出团队版激活', 'info');
        }
        return;
    }
    // 仅个人版激活时：不允许降到个人工具版（功能已解锁，切换无意义）
    if (tiers.personal && !tiers.team && mode === 'library') {
        if (typeof PK !== 'undefined' && PK.toast) {
            PK.toast('当前为个人项目版，组装器和生成功能已激活。\n如需限制功能请先在账户菜单中退出个人版激活', 'info');
        }
        return;
    }
    // 仅个人版激活时点击团队版 → 引导升级
    if (tiers.personal && !tiers.team && mode === 'team') {
        App._showActivationDialog('team', 'team');
        return;
    }

    // 目标版本非词库时，检查许可状态
    if (mode !== 'library') {
        var tier = mode === 'project' ? 'personal' : 'team';
        try {
            var r = await fetch('/api/license/info');
            var d = await r.json();
            if (d.ok && d.tiers) {
                // 层级包含：团队激活→个人也激活
                var teamActive = d.tiers.team && d.tiers.team.active;
                var personalActive = d.tiers.personal && d.tiers.personal.active;
                App._activeTiers = {personal: personalActive || teamActive, team: teamActive};
                var targetActive = (tier === 'team') ? teamActive : (personalActive || teamActive);
                if (!targetActive) {
                    // 未激活 → 弹激活窗口
                    App._showActivationDialog(mode, tier);
                    return;  // 不切换
                }
                // ✅ 激活通过 → 刷新按钮锁态
                App._refreshModeBtnLocks();
            }
        } catch(e) {}
    }

    document.querySelectorAll('.pk-mode-btn').forEach(function(b){ b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    App.state._currentMode = mode;
    try { localStorage.setItem('promptkit_mode', mode); } catch(e) {}

    var brand = document.querySelector('.brand span');
    var names = {library:'Mik词库·个人工具版', project:'Mik词库·个人项目版', team:'Mik词库·团队项目版'};
    if (brand) brand.textContent = names[mode] || 'Mik词库·个人工具版';

    if (mode === 'library') App._enterLibraryMode();
    else if (mode === 'project') App._enterProjectMode();
    else App._enterTeamMode();
};

App._enterLibraryMode = function() {
    var brand = document.querySelector('.brand span');
    if (brand) brand.textContent = 'Mik词库·个人工具版';
};

App._enterProjectMode = function() {
    var brand = document.querySelector('.brand span');
    if (brand) brand.textContent = 'Mik词库·个人项目版';
};

App._enterTeamMode = function() {
    var brand = document.querySelector('.brand span');
    if (brand) brand.textContent = 'Mik词库·团队项目版';
};

// ---- 版本锁定机制 ----

// 加载时预检许可状态，设置按钮锁态
App._initLicenseLocks = async function() {
    // 保存按钮原始 title
    document.querySelectorAll('.pk-mode-btn').forEach(function(b) {
        if (!b.dataset.originalTitle) b.dataset.originalTitle = b.title;
    });
    try {
        var r = await fetch('/api/license/info');
        var d = await r.json();
        if (d.ok && d.tiers) {
            var teamActive = d.tiers.team && d.tiers.team.active;
            var personalActive = d.tiers.personal && d.tiers.personal.active;
            App._activeTiers = {personal: personalActive || teamActive, team: teamActive};
        }
    } catch(e) {}
    var tiers = App._activeTiers || {};
    // 强制当前模式对齐最高激活版本
    var targetMode = tiers.team ? 'team' : (tiers.personal ? 'project' : 'library');
    App.state._currentMode = targetMode;
    try { localStorage.setItem('promptkit_mode', targetMode); } catch(e) {}
    App._refreshModeBtnLocks();
    // 更新品牌标题
    var brand = document.querySelector('.brand span');
    var names = {library:'Mik词库·个人工具版', project:'Mik词库·个人项目版', team:'Mik词库·团队项目版'};
    if (brand) brand.textContent = names[targetMode] || 'Mik词库·个人工具版';
    App._installProjectGate();
};

// 刷新模式按钮锁态
App._refreshModeBtnLocks = function() {
    var tiers = App._activeTiers || {};
    var btns = document.querySelectorAll('.pk-mode-btn');
    // 确定当前应高亮的按钮
    var activeMode = tiers.team ? 'team' : (tiers.personal ? 'project' : 'library');
    btns.forEach(function(b) {
        var mode = b.dataset.mode;
        // 清除所有状态类
        b.classList.remove('pk-mode-locked', 'pk-mode-included', 'active');
        b.title = b.dataset.originalTitle || b.title;

        // 最高激活版本高亮
        if (mode === activeMode) {
            b.classList.add('active');
        }

        if (mode === 'library') {
            if (tiers.team) {
                b.classList.add('pk-mode-included');
                b.title = '个人工具版（已被团队版包含）';
            } else if (tiers.personal) {
                b.classList.add('pk-mode-included');
                b.title = '个人工具版（已被个人版包含）';
            }
            return;
        }
        if (mode === 'project') {
            if (tiers.team) {
                b.classList.add('pk-mode-included');
                b.title = '个人项目版（已被团队版包含）';
            } else if (!tiers.personal) {
                b.classList.add('pk-mode-locked');
                b.title = '个人项目版（需激活）';
            }
            return;
        }
        if (mode === 'team') {
            if (!tiers.team) {
                b.classList.add('pk-mode-locked');
                b.title = tiers.personal ? '团队项目版（点击升级）' : '团队项目版（需先激活个人版）';
            }
            return;
        }
    });
    // 同步刷新导航锁态
    App._refreshNavLocks();
};

// 刷新所有需许可的导航项锁态
App._refreshNavLocks = function() {
    var tiers = App._activeTiers || {};
    var projUnlocked = !!(tiers.personal || tiers.team);
    var teamUnlocked = !!tiers.team;
    // pk-need-pro：个人项目版及以上解锁（组装器 + 生成 + 分镜模板）
    document.querySelectorAll('.pk-need-pro').forEach(function(el) {
        if (projUnlocked) { el.classList.remove('pk-nav-locked'); }
        else { el.classList.add('pk-nav-locked'); }
    });
    // pk-need-project：兼容旧类名（个人项目版及以上解锁）
    document.querySelectorAll('.pk-need-project').forEach(function(el) {
        if (projUnlocked) { el.classList.remove('pk-nav-locked'); }
        else { el.classList.add('pk-nav-locked'); }
    });
    // pk-need-team：仅团队版解锁（项目管理）
    document.querySelectorAll('.pk-need-team').forEach(function(el) {
        if (teamUnlocked) { el.classList.remove('pk-nav-locked'); }
        else { el.classList.add('pk-nav-locked'); }
    });
};

// 全局拦截：点击锁定的功能时弹出对应激活窗口（捕获阶段，早于 onclick）
App._installProjectGate = function() {
    if (App._projectGateInstalled) return;
    App._projectGateInstalled = true;
    document.addEventListener('click', function(e) {
        var locked = e.target.closest('.pk-nav-locked');
        if (!locked) return;
        e.stopPropagation();
        e.preventDefault();
        // 团队锁定项：如果个人版已激活则弹团队激活，否则先引导激活个人版
        if (locked.classList.contains('pk-need-team')) {
            var tiers = App._activeTiers || {};
            if (tiers.personal) {
                App._showActivationDialog('team', 'team');
            } else {
                App._showActivationDialog('project', 'personal');
            }
        } else {
            // pk-need-pro / pk-need-project 锁定项 → 引导激活个人项目版
            App._showActivationDialog('project', 'personal');
        }
    }, true);
};

// 项目版守卫：检查个人项目版或以上是否激活，未激活弹激活窗口
// 所有项目相关功能入口前调用此方法
App._checkProjectGate = function(reason) {
    var tiers = App._activeTiers || {};
    if (tiers.personal || tiers.team) return true;  // 个人项目版或团队版已激活，放行
    // 未激活 → 弹激活窗口引导激活个人项目版
    App._showActivationDialog('project', 'personal');
    return false;
};

// 团队版守卫：未激活时弹提醒并引导激活；已激活返回 true
App._checkTeamGate = function(reason) {
    var tiers = App._activeTiers || {};
    if (tiers.team) return true;  // 已激活，放行
    // 未激活 → 检查是否已激活个人版
    if (tiers.personal) {
        // 有个人版，引导升级团队版
        App._showActivationDialog('team', 'team');
    } else {
        // 先引导激活个人项目版
        var msg = reason || '此功能需要先激活个人项目版，再升级团队项目版';
        alert(msg + '\n\n将引导您先激活个人项目版。');
        App._showActivationDialog('project', 'personal');
    }
    return false;
};

App._showActivationDialog = function(mode, tier) {
    var label = mode === 'project' ? '个人项目版' : '团队项目版';
    var fmt = mode === 'project' ? 'PKP' : 'PKT';
    var ov = document.createElement('div');
    ov.className = 'modal-overlay'; ov.style.zIndex = '99999';
    ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div class="modal-box" style="max-width:440px;background:var(--bg-card);border-radius:12px;padding:24px;" onclick="event.stopPropagation()">' +
        '<h4 style="margin:0 0 4px;">🔐 激活 ' + label + '</h4>' +
        '<p style="font-size:12px;color:var(--text-muted);margin:0 0 16px;">' +
        '🎉 个人词库版完全免费开源。<br>' + label + '需主机绑定+激活码解锁。</p>' +
        '<div style="margin-bottom:10px;"><label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">🔍 本机指纹</label>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
        '<code id="licFpDisplay" style="flex:1;padding:8px 10px;background:var(--bg);border:1px solid var(--border-color);border-radius:6px;font-size:12px;word-break:break-all;color:var(--text);">⏳ 获取中...</code>' +
        '<button id="licFpCopy" onclick="window._licCopyFp()" style="padding:8px 14px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg);color:var(--text);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .15s;" onmouseenter="this.style.borderColor=\'#3b82f6\';this.style.color=\'#3b82f6\'" onmouseleave="this.style.borderColor=\'#cbd5e1\';this.style.color=\'#1e293b\'">📋 复制指纹</button>' +
        '</div>' +
        '<div id="licFpMsg" style="font-size:11px;margin-top:6px;padding:6px 10px;border-radius:4px;display:none;"></div>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;">' +
        '<a href="/tools/keygen/keygen.html?tier=' + tier + '" target="_blank" style="color:var(--primary);">🔌 打开激活码生成器 →</a></div>' +
        '<div style="margin-top:14px;padding:12px;background:var(--bg);border:1px solid var(--border-color);border-radius:8px;">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">📤 如何获取激活码</div>' +
        '<ol style="font-size:11px;color:var(--text-muted);margin:0;padding-left:18px;line-height:1.8;">' +
        '<li>点击下方按钮复制服务器信息</li>' +
        '<li>发送给持有本服务器 <code style="font-size:10px;">.license_seed</code> 的管理员</li>' +
        '<li>管理员在 <b>激活码生成器</b> 中连接服务器即可生成激活码</li>' +
        '</ol>' +
        '<button id="licCopyInfo" onclick="window._licCopyInfo()" style="margin-top:10px;width:100%;padding:8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg);color:var(--text);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;" onmouseenter="this.style.borderColor=\'#3b82f6\';this.style.color=\'#3b82f6\'" onmouseleave="this.style.borderColor=\'#cbd5e1\';this.style.color=\'#1e293b\'">📋 复制服务器地址 + 指纹</button>' +
        '<button id="licDownloadPkg" onclick="window._licDownloadPkg()" style="margin-top:6px;width:100%;padding:8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg);color:var(--text);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;" onmouseenter="this.style.borderColor=\'#3b82f6\';this.style.color=\'#3b82f6\'" onmouseleave="this.style.borderColor=\'#cbd5e1\';this.style.color=\'#1e293b\'">📥 下载激活数据包（异地离线用）</button>' +
        '</div>' +
        '<div id="licMsg" style="font-size:12px;margin-bottom:10px;padding:8px 12px;border-radius:6px;display:none;"></div>' +
        '<div class="form-group"><label style="font-size:12px;">激活码</label>' +
        '<input type="text" id="licCode" placeholder="' + fmt + '-XXXX-XXXX-XXXX" style="width:100%;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-main);font-size:14px;text-transform:uppercase;letter-spacing:1px;" maxlength="19" autofocus>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
        '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').remove()" style="flex:1;">取消</button>' +
        '<button class="btn btn-primary" id="licActivate" style="flex:1;">🔓 激活</button>' +
        '</div>' +
        '</div>';
    document.body.appendChild(ov);

    // 实时获取本机指纹
    fetch('/api/license/info').then(function(r){return r.json();}).then(function(d){
        var fpEl = document.getElementById('licFpDisplay');
        if (fpEl && d.ok) {
            fpEl.textContent = d.fingerprint;
            App._licenseFingerprint = d.fingerprint;
        }
    }).catch(function(){
        var fpEl = document.getElementById('licFpDisplay');
        if (fpEl) fpEl.textContent = '获取失败，请刷新重试';
    });
    var self = this;
    document.getElementById('licActivate').onclick = async function() {
        var code = document.getElementById('licCode').value.trim();
        if (!code) return;
        var btn2 = document.getElementById('licActivate');
        btn2.disabled = true; btn2.textContent = '激活中...';
        try {
            var r2 = await fetch('/api/license/activate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code, tier: tier })
            });
            var d2 = await r2.json();
            var msg = document.getElementById('licMsg');
            if (d2.ok) {
                msg.style.display = 'block';
                msg.style.background = 'var(--primary-light,rgba(16,185,129,.1))';
                msg.style.color = '#10b981';
                msg.textContent = '\u2705 ' + d2.message + '！正在进入...';
                if (window.PK_AUTH_CLIENT) PK_AUTH_CLIENT._refreshTiers();
                // 刷新许可状态，解锁导航锁定
                if (tier === 'team') {
                    App._activeTiers = {personal: true, team: true};
                } else {
                    App._activeTiers = {personal: true, team: App._activeTiers ? App._activeTiers.team : false};
                }
                App._refreshModeBtnLocks();
                setTimeout(function() {
                    ov.remove();
                    document.querySelectorAll('.pk-mode-btn').forEach(function(b){ b.classList.remove('active'); });
                    var targetBtn = document.querySelector('.pk-mode-btn[data-mode="' + mode + '"]');
                    if (targetBtn) targetBtn.classList.add('active');
                    App.state._currentMode = mode;
                    if (mode === 'project') App._enterProjectMode();
                    else App._enterTeamMode();
                }, 1000);
            } else {
                msg.style.display = 'block';
                msg.style.background = '#fef2f2'; msg.style.color = '#ef4444';
                msg.textContent = '\u274C ' + (d2.detail || '激活失败');
                btn2.disabled = false; btn2.textContent = '\uD83D\uDD13 激活';
            }
        } catch(e2) { btn2.disabled = false; btn2.textContent = '\uD83D\uDD13 激活'; }
    };
};
})();
