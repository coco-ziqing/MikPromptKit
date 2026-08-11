/**
 * MikPromptKit 维护工具（2026-08-11 关机准备方案优化）
 * - 邮件推送设置（QQ 邮箱 SMTP 授权码）
 * - 关机准备检查 + 日志邮件推送
 */
(function () {
    'use strict';
    if (!App) return;
    App.maintenance = App.maintenance || {};

    // ==================== 邮件推送设置弹窗 ====================
    App.maintenance.openMail = function () {
        var self = this;
        var overlay = document.getElementById('mtMailModal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'mtMailModal';
            overlay.className = 'modal-overlay';
            overlay.style.cssText = 'display:flex;z-index:780;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;';
            overlay.innerHTML =
                '<div class="modal-content" style="max-width:520px;width:94%;border-radius:14px;padding:0;overflow:hidden;" onclick="event.stopPropagation()">' +
                '<div class="modal-header"><h5><i class="bi bi-envelope"></i> 邮件推送设置</h5>' +
                '<button class="header-btn-sm" onclick="document.getElementById(\'mtMailModal\').style.display=\'none\'">&times;</button></div>' +
                '<div class="modal-body" style="padding:14px 16px;">' +
                '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.6;">用于关机准备 / 日志推送：把日志包发送到你的邮箱。<br>QQ 邮箱需在 <b>设置 → 账户 → 开启 SMTP</b> 生成「授权码」（不是登录密码）。</div>' +
                '<label style="font-size:11px;color:var(--text-muted);">发件邮箱（SMTP 账号）</label>' +
                '<input id="mtMailUser" class="s2-input" style="width:100%;margin-bottom:8px;" placeholder="2547159966@qq.com">' +
                '<label style="font-size:11px;color:var(--text-muted);">授权码</label>' +
                '<input id="mtMailPass" type="password" class="s2-input" style="width:100%;margin-bottom:8px;" placeholder="QQ 邮箱 SMTP 授权码">' +
                '<label style="font-size:11px;color:var(--text-muted);">收件邮箱</label>' +
                '<input id="mtMailTo" class="s2-input" style="width:100%;margin-bottom:8px;" placeholder="2547159966@qq.com">' +
                '<div style="display:flex;gap:8px;margin-bottom:4px;">' +
                '<div style="flex:1;"><label style="font-size:11px;color:var(--text-muted);">SMTP 主机</label>' +
                '<input id="mtMailHost" class="s2-input" style="width:100%;" placeholder="smtp.qq.com"></div>' +
                '<div style="width:90px;"><label style="font-size:11px;color:var(--text-muted);">端口</label>' +
                '<input id="mtMailPort" class="s2-input" style="width:100%;" placeholder="465"></div>' +
                '</div>' +
                '<div id="mtMailStatus" style="font-size:11px;margin-top:8px;min-height:16px;"></div>' +
                '</div>' +
                '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--border-color);">' +
                '<button class="btn btn-sm btn-outline" onclick="App.maintenance.mailTest()"><i class="bi bi-send"></i> 测试发送</button>' +
                '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'mtMailModal\').style.display=\'none\'">关闭</button>' +
                '<button class="btn btn-primary btn-sm" onclick="App.maintenance.mailSave()"><i class="bi bi-check-lg"></i> 保存</button>' +
                '</div></div>';
            overlay.onclick = function (e) { if (e.target === overlay) overlay.style.display = 'none'; };
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
        var status = document.getElementById('mtMailStatus');
        if (status) status.textContent = '加载配置...';
        App.fetchJSON('/api/maintenance/mail/config').then(function (d) {
            if (!d || !d.ok) return;
            var c = d.config || {};
            var v = function (el, val) { if (el) el.value = val || ''; };
            v(document.getElementById('mtMailUser'), c.mail_smtp_user);
            v(document.getElementById('mtMailPass'), c.mail_smtp_pass && c.mail_smtp_pass !== '******' ? c.mail_smtp_pass : '');
            v(document.getElementById('mtMailTo'), c.mail_to);
            v(document.getElementById('mtMailHost'), c.mail_smtp_host);
            v(document.getElementById('mtMailPort'), c.mail_smtp_port);
            if (status) status.innerHTML = c.configured
                ? '<span style="color:#10b981;">✓ 已配置（收件人 ' + App._escape(c.mail_to || '') + '）</span>'
                : '<span style="color:#f59e0b;">未配置完整，填写后保存</span>';
        }).catch(function () { if (status) status.textContent = '加载失败'; });
    };

    App.maintenance._collectMailForm = function () {
        var g = function (id) { return (document.getElementById(id) || {}).value || ''; };
        return {
            'mail.smtp_user': g('mtMailUser').trim(),
            'mail.smtp_pass': g('mtMailPass').trim(),
            'mail.to': g('mtMailTo').trim(),
            'mail.smtp_host': g('mtMailHost').trim() || 'smtp.qq.com',
            'mail.smtp_port': g('mtMailPort').trim() || '465'
        };
    };

    App.maintenance.mailSave = function () {
        var status = document.getElementById('mtMailStatus');
        var cfg = this._collectMailForm();
        if (!cfg['mail.smtp_user'] || !cfg['mail.to']) {
            if (status) status.innerHTML = '<span style="color:#ef4444;">请填写发件邮箱与收件人</span>';
            return;
        }
        if (status) status.textContent = '保存中...';
        App.fetchJSON('/api/maintenance/mail/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: cfg })
        }).then(function (d) {
            if (status) status.innerHTML = d && d.ok
                ? '<span style="color:#10b981;">✓ 配置已保存</span>'
                : '<span style="color:#ef4444;">保存失败</span>';
        }).catch(function () { if (status) status.textContent = '保存失败'; });
    };

    App.maintenance.mailTest = function () {
        var status = document.getElementById('mtMailStatus');
        var cfg = this._collectMailForm();
        if (status) status.textContent = '发送测试邮件...（约 5-15 秒）';
        App.fetchJSON('/api/maintenance/mail/test', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: cfg })
        }).then(function (d) {
            if (status) {
                if (d && d.ok) status.innerHTML = '<span style="color:#10b981;">✓ 测试邮件已发送，请查收邮箱</span>';
                else status.innerHTML = '<span style="color:#ef4444;">✗ ' + App._escape((d && d.error) || '发送失败') + '</span>';
            }
        }).catch(function (e) { if (status) status.textContent = '异常: ' + e.message; });
    };

    // ==================== 关机准备弹窗 ====================
    App.maintenance.shutdownPrepare = function () {
        var self = this;
        var overlay = document.getElementById('mtShutdownModal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'mtShutdownModal';
            overlay.className = 'modal-overlay';
            overlay.style.cssText = 'display:flex;z-index:780;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;';
            overlay.innerHTML =
                '<div class="modal-content" style="max-width:620px;width:94%;border-radius:14px;padding:0;overflow:hidden;" onclick="event.stopPropagation()">' +
                '<div class="modal-header"><h5><i class="bi bi-power"></i> 关机准备检查</h5>' +
                '<button class="header-btn-sm" onclick="document.getElementById(\'mtShutdownModal\').style.display=\'none\'">&times;</button></div>' +
                '<div class="modal-body" style="padding:12px 16px;max-height:55vh;overflow-y:auto;">' +
                '<div id="mtShutdownReport" style="font-size:12px;">检查中...</div>' +
                '</div>' +
                '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:10px 16px;border-top:1px solid var(--border-color);">' +
                '<span id="mtShutdownMailHint" style="margin-right:auto;font-size:10px;color:var(--text-muted);"></span>' +
                '<button class="btn btn-sm btn-outline" onclick="App.maintenance.shutdownPrepare()"><i class="bi bi-arrow-repeat"></i> 重新检查</button>' +
                '<button class="btn btn-sm btn-primary" id="mtShutdownMailBtn" onclick="App.maintenance.mailSendLog()"><i class="bi bi-envelope"></i> 📧 推送日志到邮箱</button>' +
                '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'mtShutdownModal\').style.display=\'none\'">关闭</button>' +
                '</div></div>';
            overlay.onclick = function (e) { if (e.target === overlay) overlay.style.display = 'none'; };
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
        var report = document.getElementById('mtShutdownReport');
        if (report) report.textContent = '检查中...';
        App.fetchJSON('/api/maintenance/shutdown-prepare').then(function (d) {
            if (!d || !d.ok || !d.report) { if (report) report.textContent = '检查失败'; return; }
            var r = d.report;
            var h = '';
            h += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">检查时间：' + App._escape(r.checked_at || '') + '</div>';
            h += '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:start;">';
            h += '<span style="color:var(--text-muted);">Git 版本</span><span>' + App._escape(r.current_tag || '') + ' · ' + App._escape(r.head || '') + '</span>';
            h += '<span style="color:var(--text-muted);">工作区</span><span style="' + (r.git_status !== '(clean)' ? 'color:#f59e0b;' : 'color:#10b981;') + '">' + App._escape(String(r.git_status).substring(0, 120)) + '</span>';
            h += '<span style="color:var(--text-muted);">未推送</span><span style="' + (r.unpushed !== '(无未推送提交)' ? 'color:#f59e0b;' : 'color:#10b981;') + '">' + App._escape(String(r.unpushed).substring(0, 80)) + '</span>';
            h += '<span style="color:var(--text-muted);">生成队列</span><span>' + App._escape(JSON.stringify(r.queue || [])) + '</span>';
            h += '<span style="color:var(--text-muted);">数据库</span><span style="' + (r.db_integrity === 'ok' ? 'color:#10b981;' : 'color:#ef4444;') + '">' + App._escape(r.db_integrity || '') + '</span>';
            h += '</div>';
            if (r.hints && r.hints.length) {
                h += '<div style="margin-top:10px;">';
                r.hints.forEach(function (hi) {
                    if (hi) h += '<div style="font-size:11px;padding:4px 8px;margin-bottom:4px;border-radius:6px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);">' + App._escape(hi) + '</div>';
                });
                h += '</div>';
            }
            report.innerHTML = h;
            var hint = document.getElementById('mtShutdownMailHint');
            var btn = document.getElementById('mtShutdownMailBtn');
            if (r.mail_configured) {
                if (hint) hint.textContent = '推送目标：' + App._escape(r.mail_to || '');
                if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
            } else {
                if (hint) hint.innerHTML = '<span style="color:#f59e0b;">邮件未配置 → <a href="#" onclick="App.maintenance.openMail();return false;">去设置</a></span>';
                if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
            }
        }).catch(function () { if (report) report.textContent = '检查失败'; });
    };

    App.maintenance.mailSendLog = function () {
        var btn = document.getElementById('mtShutdownMailBtn');
        var hint = document.getElementById('mtShutdownMailHint');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> 发送中...'; }
        if (hint) hint.textContent = '正在构建日志包并发送（约 10-20 秒）...';
        App.fetchJSON('/api/maintenance/mail/send-log', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        }).then(function (d) {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-envelope"></i> 📧 推送日志到邮箱'; }
            if (d && d.ok) {
                if (hint) hint.innerHTML = '<span style="color:#10b981;">✓ 日志包已发送到邮箱（' + App._escape(d.generated_at || '') + '）</span>';
                App.showToast('日志包已发送到邮箱', 'success');
            } else {
                if (hint) hint.innerHTML = '<span style="color:#ef4444;">✗ ' + App._escape((d && d.error) || '发送失败') + '</span>';
                App.showToast('日志发送失败: ' + ((d && d.error) || ''), 'error');
            }
        }).catch(function (e) {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-envelope"></i> 📧 推送日志到邮箱'; }
            if (hint) hint.textContent = '异常: ' + e.message;
        });
    };
})();
