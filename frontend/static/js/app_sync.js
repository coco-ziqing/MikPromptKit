/**
 * PromptKit — app_sync 模块
 * 主题切换, 数据库备份, 数据同步 .pkb 包
 * 自动生成 — 勿手动编辑
 */
(function() {
'use strict';
Object.assign(App, {
    // ============ 主题切换 ============
    async toggleTheme() {
        const newTheme = this.state.theme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        // 持久化到后端
        await this.fetchJSON('/api/v2/config/theme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: newTheme })
        });
        localStorage.setItem('promptkit_theme', newTheme);
    },

    // ============ 数据库备份 ============

    async showBackupInfo() {
        document.getElementById('modalBackup').style.display = 'flex';
        document.getElementById('backupInfoBody').innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">正在获取备份状态...</p></div>';
        document.getElementById('backupStatusText').textContent = '加载中...';
        try {
            var data = await this.fetchJSON('/api/backup/info');
            if (!data) { throw new Error('获取失败'); }
            this._renderBackupInfo(data);
        } catch (e) {
            document.getElementById('backupInfoBody').innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">❌ 获取备份信息失败: ' + e.message + '</div>';
            document.getElementById('backupStatusText').textContent = '加载失败';
        }
    },

    _renderBackupInfo(data) {
        var body = document.getElementById('backupInfoBody');
        var html = '';

        // 当前数据库状态
        var dbSize = data.db_size || 0;
        var dbSizeStr = dbSize > 1048576 ? (dbSize / 1048576).toFixed(1) + ' MB' : (dbSize / 1024).toFixed(1) + ' KB';
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">📊 数据库状态</div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">';
        html += '<div style="padding:8px 12px;background:var(--hover-bg,#f1f5f9);border-radius:6px;"><span style="color:var(--text-muted);">数据库大小</span><br><strong>' + dbSizeStr + '</strong></div>';
        html += '<div style="padding:8px 12px;background:var(--hover-bg,#f1f5f9);border-radius:6px;"><span style="color:var(--text-muted);">备份数量</span><br><strong>' + (data.total_backups || 0) + '</strong></div>';
        html += '<div style="padding:8px 12px;background:var(--hover-bg,#f1f5f9);border-radius:6px;"><span style="color:var(--text-muted);">备份目录大小</span><br><strong>' + (data.backup_dir_size > 1048576 ? (data.backup_dir_size/1048576).toFixed(1)+' MB' : (data.backup_dir_size/1024).toFixed(1)+' KB') + '</strong></div>';
        html += '<div style="padding:8px 12px;background:var(--hover-bg,#f1f5f9);border-radius:6px;"><span style="color:var(--text-muted);">保留策略</span><br><strong>' + (data.keep_days || 7) + ' 天轮换</strong></div>';
        html += '</div></div>';

        // 最近备份时间
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">⏰ 最近备份</div>';
        if (data.last_backup_time_str) {
            html += '<div style="font-size:12px;color:var(--text-muted);">上次备份: <strong>' + data.last_backup_time_str + '</strong></div>';
        } else {
            html += '<div style="font-size:12px;color:var(--text-muted);">尚未备份</div>';
        }
        if (data.last_error) {
            html += '<div style="font-size:12px;color:#ef4444;margin-top:4px;">上次错误: ' + data.last_error + '</div>';
        }
        html += '</div>';

        // 备份文件列表
        var backups = data.recent_backups || [];
        if (backups.length > 0) {
            html += '<div style="margin-bottom:8px;">';
            html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">📁 备份文件（最近 10 个）</div>';
            html += '<div style="max-height:200px;overflow-y:auto;font-size:11px;">';
            for (var i = 0; i < backups.length; i++) {
                var b = backups[i];
                var bSize = b.size > 1048576 ? (b.size / 1048576).toFixed(1) + ' MB' : (b.size / 1024).toFixed(1) + ' KB';
                html += '<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid var(--border-color);">';
                html += '<span>' + this._escape(b.name) + '</span>';
                html += '<span style="color:var(--text-muted);">' + bSize + '</span>';
                html += '</div>';
            }
            html += '</div></div>';
        }

        body.innerHTML = html;

        // 更新状态
        document.getElementById('backupStatusText').textContent = '自动备份每 ' + (data.keep_days*24 || 168) + ' 小时执行一次';
    },

    async doBackupNow() {
        document.getElementById('backupStatusText').textContent = '正在备份...';
        try {
            var data = await this.fetchJSON('/api/backup/now', { method: 'POST' });
            if (data && data.ok) {
                this.showToast('备份成功: ' + data.file + ' (' + (data.size/1024).toFixed(1) + ' KB)', 'success');
                // 刷新信息
                await this.showBackupInfo();
            } else {
                this.showToast('备份失败: ' + (data ? data.error : '未知错误'), 'error');
                document.getElementById('backupStatusText').textContent = '备份失败';
            }
        } catch (e) {
            this.showToast('备份失败: ' + e.message, 'error');
            document.getElementById('backupStatusText').textContent = '备份失败';
        }
    },

    // ============ 数据同步 .pkb 包 ============

    async showSyncPanel() {
        // 打开同步面板并刷新
        var modal = document.getElementById('modalSync');
        modal.style.display = 'flex';
        await this.syncRefreshList();
    },

    async syncRefreshList() {
        var body = document.getElementById('syncBody');
        body.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">正在加载...</p></div>';
        try {
            var res = await this.fetchJSON('/api/sync/packages');
            if (!res || !res.ok) throw new Error((res && res.error) || '获取失败');
            this._renderSyncPackages(res.packages, res.count);
        } catch(e) {
            body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-danger);">&#10060; 加载失败: ' + e.message + '</div>';
        }
    },

    _renderSyncPackages(packages, count) {
        var body = document.getElementById('syncBody');
        var html = '';

        // 包列表
        if (!packages || packages.length === 0) {
            html += '<div style="text-align:center;padding:40px 20px;color:var(--text-muted);"><i class="bi bi-box" style="font-size:48px;display:block;margin-bottom:12px;"></i><p>暂无 .pkb 包</p><p style="font-size:12px;">点击「导出完整包」创建第一个备份</p></div>';
        } else {
            html += '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:600;font-size:13px;">&#128193; 已有 ' + count + ' 个包</span><span style="font-size:11px;color:var(--text-muted);">点击行展开详情</span></div>';
            packages.forEach(function(pkg, idx) {
                var m = pkg.manifest || {};
                var created = m.created_at ? m.created_at.replace('T', ' ').substring(0, 19) : (pkg.mtime ? pkg.mtime.replace('T', ' ').substring(0, 19) : '未知');
                var prompts = m.prompts || 0;
                var mediaBadge = m.media_included ? '<span class="badge bg-success" style="font-size:10px;">含媒体</span>' : '<span class="badge bg-secondary" style="font-size:10px;">仅数据库</span>';
                var expanded = 'pkgDetail_' + idx;
                html += '<div style="border:1px solid var(--border-color);border-radius:8px;margin-bottom:6px;overflow:hidden;">';
                html += '  <div onclick="App.syncToggleDetail(\'' + expanded + '\')" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;background:var(--card-bg);font-size:13px;user-select:none;">';
                html += '    <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">';
                html += '      <i class="bi bi-file-archive"></i>';
                html += '      <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + pkg.name + '</span>';
                html += '      ' + mediaBadge;
                html += '    </div>';
                html += '    <div style="display:flex;align-items:center;gap:12px;font-size:11px;color:var(--text-muted);">';
                html += '      <span>' + pkg.size_str + '</span>';
                html += '      <span>' + created + '</span>';
                html += '      <i class="bi bi-chevron-down" id="' + expanded + '_icon" style="transition:transform 0.2s;"></i>';
                html += '    </div>';
                html += '  </div>';
                html += '  <div id="' + expanded + '" style="display:none;padding:8px 12px 12px;border-top:1px solid var(--border-color);background:var(--bg-color);">';
                html += '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:8px;">';
                html += '      <div><span style="color:var(--text-muted);">提示词:</span> ' + prompts + ' 条</div>';
                html += '      <div><span style="color:var(--text-muted);">文件大小:</span> ' + pkg.size_str + '</div>';
                html += '      <div><span style="color:var(--text-muted);">创建时间:</span> ' + created + '</div>';
                html += '      <div><span style="color:var(--text-muted);">含媒体:</span> ' + (m.media_included ? '&#10003;' : '&#10007;') + '</div>';
                if (m.media_files) {
                    html += '      <div><span style="color:var(--text-muted);">缩略图:</span> ' + (m.media_files.thumbnails || 0) + '</div>';
                    html += '      <div><span style="color:var(--text-muted);">原图:</span> ' + (m.media_files.originals || 0) + '</div>';
                    html += '      <div><span style="color:var(--text-muted);">视频:</span> ' + (m.media_files.videos || 0) + '</div>';
                }
                html += '    </div>';
                html += '    <div style="display:flex;gap:6px;flex-wrap:wrap;">';
                html += '      <button class="btn btn-sm btn-outline-success" onclick="event.stopPropagation();App.syncRestorePkg(\'' + pkg.name + '\')"><i class="bi bi-arrow-counterclockwise"></i> 恢复</button>';
                html += '      <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation();App.syncDeletePkg(\'' + pkg.name + '\')"><i class="bi bi-trash"></i> 删除</button>';
                html += '    </div>';
                html += '  </div>';
                html += '</div>';
            });
        }

        body.innerHTML = html;
    },

    syncToggleDetail(id) {
        var el = document.getElementById(id);
        var icon = document.getElementById(id + '_icon');
        if (el) {
            var show = el.style.display !== 'block';
            el.style.display = show ? 'block' : 'none';
            if (icon) icon.style.transform = show ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    },

    async syncExportPkg() {
        try {
            var res = await this.fetchJSON('/api/sync/export', { method: 'POST' });
            if (res && res.ok) {
                this.showToast('导出成功: ' + res.file + ' (' + (res.size/1024/1024).toFixed(2) + ' MB)', 'success');
                await this.syncRefreshList();
            } else {
                this.showToast('导出失败: ' + (res ? res.error : '未知错误'), 'error');
            }
        } catch(e) {
            this.showToast('导出失败: ' + e.message, 'error');
        }
    },

    async syncRestorePkg(name) {
        if (!confirm('确定从 ' + name + ' 恢复数据？\n\n当前数据将自动备份，不会丢失。')) return;
        try {
            var res = await this.fetchJSON('/api/sync/restore/' + encodeURIComponent(name), { method: 'POST' });
            if (res && res.ok) {
                this.showToast('恢复成功！已还原 ' + (res.count || res.restored.length) + ' 个文件', 'success');
                // 刷新当前视图
                if (this.currentView === 'home') this.loadPrompts();
                await this.syncRefreshList();
            } else {
                this.showToast('恢复失败: ' + (res ? res.error : '未知错误'), 'error');
            }
        } catch(e) {
            this.showToast('恢复失败: ' + e.message, 'error');
        }
    },

    async syncDeletePkg(name) {
        if (!confirm('确定删除包 ' + name + '？')) return;
        try {
            var res = await this.fetchJSON('/api/sync/packages/' + encodeURIComponent(name), { method: 'DELETE' });
            if (res && res.ok) {
                this.showToast('已删除: ' + name, 'success');
                await this.syncRefreshList();
            } else {
                this.showToast('删除失败: ' + (res ? res.error : '未知错误'), 'error');
            }
        } catch(e) {
            this.showToast('删除失败: ' + e.message, 'error');
        }
    },

    async syncUploadPkg() {
        // 创建隐藏 file input
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pkb';
        input.onchange = async function(e) {
            var file = e.target.files[0];
            if (!file) return;
            if (!file.name.endsWith('.pkb')) {
                App.showToast('请选择 .pkb 文件', 'error');
                return;
            }
            try {
                var formData = new FormData();
                formData.append('file', file);
                var res = await fetch('/api/sync/upload', { method: 'POST', body: formData });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var data = await res.json();
                if (data && data.ok) {
                    App.showToast('导入成功: ' + data.saved_as, 'success');
                    await App.syncRefreshList();
                } else {
                    App.showToast('导入失败: ' + (data ? data.error : '未知错误'), 'error');
                }
            } catch(err) {
                App.showToast('导入失败: ' + err.message, 'error');
            }
        };
        input.click();
    },

    // ============ 统计仪表盘 ============

    async showDashboard() {
        document.getElementById('modalDashboard').style.display = 'flex';
        document.getElementById('dashboardBody').innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">加载统计数据...</p></div>';
        try {
            var data = await this.fetchJSON('/api/v2/stats/dashboard');
            if (!data) throw new Error('获取失败');
            this._renderDashboard(data);
        } catch(e) {
            document.getElementById('dashboardBody').innerHTML = '<div style="padding:30px;text-align:center;color:#ef4444;">❌ ' + e.message + '</div>';
        }
    },

    _renderDashboard(d) {
        var html = '';

        // 概览卡片
        html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">';
        var cards = [
            {label:'总词条', val:d.total_prompts, icon:'📝'},
            {label:'今日使用', val:d.today_usage, icon:'☀️'},
            {label:'收藏', val:d.total_collections, icon:'⭐'},
            {label:'回收站', val:d.trash_count, icon:'🗑️'}
        ];
        for (var i = 0; i < cards.length; i++) {
            html += '<div style="background:var(--hover-bg,#f1f5f9);border-radius:8px;padding:12px;text-align:center;">';
            html += '<div style="font-size:20px;">' + cards[i].icon + '</div>';
            html += '<div style="font-size:20px;font-weight:700;">' + cards[i].val + '</div>';
            html += '<div style="font-size:11px;color:var(--text-muted);">' + cards[i].label + '</div></div>';
        }
        html += '</div>';

        // 模块分布
        if (d.modules && d.modules.length > 0) {
            html += '<div style="margin-bottom:16px;"><div style="font-size:14px;font-weight:600;margin-bottom:8px;">📊 模块分布</div>';
            var maxCount = d.modules[0].count;
            for (var i = 0; i < d.modules.length; i++) {
                var m = d.modules[i];
                var pct = maxCount > 0 ? (m.count / maxCount * 100).toFixed(0) : 0;
                html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px;">';
                html += '<span style="width:80px;flex-shrink:0;">' + this._escape(m.name) + '</span>';
                html += '<div style="flex:1;height:18px;background:var(--border-color);border-radius:4px;overflow:hidden;">';
                html += '<div style="width:' + pct + '%;height:100%;background:#818cf8;border-radius:4px;display:flex;align-items:center;padding-left:6px;color:#fff;font-size:10px;">' + (pct > 15 ? m.count : '') + '</div></div>';
                html += '<span style="width:30px;text-align:right;color:var(--text-muted);">' + m.count + '</span></div>';
            }
            html += '</div>';
        }

        // 使用频率 TOP 10
        if (d.top_used && d.top_used.length > 0) {
            html += '<div style="margin-bottom:16px;"><div style="font-size:14px;font-weight:600;margin-bottom:8px;">🏆 使用频率 TOP 10</div>';
            html += '<div style="font-size:11px;">';
            for (var i = 0; i < d.top_used.length; i++) {
                var t = d.top_used[i];
                html += '<div style="display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-color);gap:8px;">';
                html += '<span style="color:var(--text-muted);width:20px;">#' + (i+1) + '</span>';
                html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + this._escape(t.content) + '</span>';
                html += '<span style="color:var(--text-muted);">' + t.usage_count + ' 次</span>';
                html += '</div>';
            }
            html += '</div></div>';
        }

        // 标签 TOP 20
        if (d.tags && d.tags.length > 0) {
            html += '<div style="margin-bottom:8px;"><div style="font-size:14px;font-weight:600;margin-bottom:8px;">🏷️ 标签分布 TOP 20</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
            for (var i = 0; i < d.tags.length; i++) {
                var tg = d.tags[i];
                var sz = Math.min(16, Math.max(11, 10 + tg.count));
                html += '<span style="font-size:' + sz + 'px;padding:3px 10px;background:var(--hover-bg,#f1f5f9);border-radius:12px;color:var(--text-main);">' + this._escape(tg.name) + '<span style="color:var(--text-muted);margin-left:4px;font-size:10px;">×' + tg.count + '</span></span>';
            }
            html += '</div></div>';
        }

        document.getElementById('dashboardBody').innerHTML = html;
    },


    // ============ ComfyUI 集成 ============

    async openComfyConfig() {
        document.getElementById('modalComfyUI').style.display = 'flex';
        document.getElementById('comfyUIConfigBody').innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">加载配置...</p></div>';
        try {
            var data = await this.fetchJSON('/api/v2/comfyui/config');
            if (!data || !data.config) throw new Error('获取失败');
            this._comfyConfig = data.config;
            this._renderComfyConfig(data.config);
        } catch(e) {
            document.getElementById('comfyUIConfigBody').innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">❌ ' + e.message + '</div>';
        }
    },

    _renderComfyConfig(cfg) {
        var html = '';
        html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">ComfyUI 服务器地址</label>';
        html += '<input type="text" id="comfyServerUrl" class="modal-input" value="' + this._escape(cfg.server_url || 'http://127.0.0.1:8188') + '" placeholder="http://127.0.0.1:8188"></div>';

        html += '<div style="margin-bottom:12px;"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">';
        html += '<input type="checkbox" id="comfyEnabled" ' + (cfg.enabled ? 'checked' : '') + '> 启用 ComfyUI 集成</label></div>';

        // 工作流模板列表
        var wfs = cfg.workflows || [];
        html += '<div style="margin-bottom:8px;"><div style="font-size:13px;font-weight:600;margin-bottom:8px;">工作流模板</div>';
        if (wfs.length === 0) {
            html += '<div style="font-size:12px;color:var(--text-muted);padding:8px;background:var(--hover-bg,#f1f5f9);border-radius:6px;">暂无工作流模板，请先在工作流导入界面导出 API 格式的工作流 JSON</div>';
        }
        for (var i = 0; i < wfs.length; i++) {
            var w = wfs[i];
            html += '<div style="background:var(--hover-bg,#f1f5f9);border-radius:6px;padding:10px;margin-bottom:8px;">';
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">';
            html += '<input type="radio" name="comfyWorkflow" value="' + this._escape(w.id || '') + '" ' + (w.id === cfg.active_workflow ? 'checked' : '') + '>';
            html += '<strong style="font-size:13px;">' + this._escape(w.name || '未命名') + '</strong>';
            html += '<span style="font-size:11px;color:var(--text-muted);">' + this._escape(w.description || '') + '</span>';
            html += '</div>';
            html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">';
            html += '<label>提示词节点 ID: <input type="text" class="wf-param" data-idx="' + i + '" data-field="prompt_node_id" value="' + this._escape(w.prompt_node_id || '6') + '" style="width:50px;padding:2px 4px;border:1px solid var(--border-color);border-radius:4px;"></label>';
            html += '<label>提示词字段: <input type="text" class="wf-param" data-idx="' + i + '" data-field="prompt_field" value="' + this._escape(w.prompt_field || 'text') + '" style="width:80px;padding:2px 4px;border:1px solid var(--border-color);border-radius:4px;"></label>';
            html += '<label>输出图片节点: <input type="text" class="wf-param" data-idx="' + i + '" data-field="image_output_node_id" value="' + this._escape(w.image_output_node_id || '9') + '" style="width:50px;padding:2px 4px;border:1px solid var(--border-color);border-radius:4px;"></label>';
            html += '</div></div>';
        }

        // 导入工作流 JSON
        html += '<div style="margin-top:8px;"><button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;" onclick="document.getElementById(\'comfyWorkflowFile\').click()">📂 导入工作流 JSON</button>';
        html += '<input type="file" id="comfyWorkflowFile" accept=".json" style="display:none;" onchange="App._importComfyWorkflow(this)"></div>';

        html += '<div id="comfyImportStatus" style="margin-top:8px;font-size:11px;color:var(--text-muted);"></div>';

        // 模块主体预设
        html += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-color,#e2e8f0);">';
        html += '<div style="font-size:13px;font-weight:600;margin-bottom:6px;">📝 模块主体预设</div>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">各模块公共主体描述，将与提示词卡片内容自动组合后发送 ComfyUI。留空则仅使用卡片内容。</div>';
        html += '<div id="comfyPresetsArea" style="max-height:300px;overflow-y:auto;">加载预设中...</div></div>';

        document.getElementById('comfyUIConfigBody').innerHTML = html;

        // 异步加载模块预设
        var self = this;
        this.fetchJSON('/api/v2/comfyui/module-presets').then(function(ps) {
            if (!ps || !ps.presets) return;
            var modules = ps.modules || Object.keys(ps.presets);
            self._comfyPresetsData = ps.presets;
            var ph = '';
            for (var mi = 0; mi < modules.length; mi++) {
                var m = modules[mi];
                if (m === 'custom' || m === 'seedance') continue;
                var mp = ps.presets[m] || { preset: '', enabled: false };
                ph += '<div style="padding:8px 0;border-bottom:1px solid var(--border-color,#e2e8f0);">';
                ph += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">';
                ph += '<input type="checkbox" class="preset-enable" data-module="' + m + '" ' + (mp.enabled ? 'checked' : '') + ' id="pe_' + m + '">';
                ph += '<label for="pe_' + m + '" style="font-size:12px;font-weight:500;">' + self._escape(m) + '</label>';
                ph += '</div>';
                ph += '<textarea class="preset-text preset-text-' + m + '" data-module="' + m + '" rows="2" style="width:100%;font-size:11px;padding:4px 6px;border:1px solid var(--border-color,#e2e8f0);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-main);resize:vertical;" placeholder="模块主体预设描述（如：a person with clear facial expression, portrait close-up）">' + self._escape(mp.preset || '') + '</textarea>';
                ph += '</div>';
            }
            var area = document.getElementById('comfyPresetsArea');
            if (area) area.innerHTML = ph;
        }).catch(function(e) {
            var area = document.getElementById('comfyPresetsArea');
            if (area) area.innerHTML = '<div style="font-size:11px;color:#ef4444;">加载预设失败: ' + e.message + '</div>';
        });
    },

    _importComfyWorkflow(input) {
        var file = input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var wf = JSON.parse(e.target.result);
                if (!wf || typeof wf !== 'object') throw new Error('无效的工作流 JSON');
                var status = document.getElementById('comfyImportStatus');
                if (!status) return;
                // 提取节点信息
                var textNodes = [];
                for (var key in wf) {
                    var node = wf[key];
                    if (node && node.class_type && (node.class_type === 'CLIPTextEncode' || node.class_type === 'CLIPPromptEncode' || (node.inputs && node.inputs.text))) {
                        textNodes.push(key);
                    }
                }
                var promptNode = textNodes[0] || '6';
                status.innerHTML = '✅ 已导入工作流，检测到 ' + Object.keys(wf).length + ' 个节点。提示词节点: ' + promptNode;
                status.style.color = '#059669';
                // 保存到临时变量
                App._importedWorkflow = wf;
                App._importedPromptNode = promptNode;
            } catch(err) {
                var status = document.getElementById('comfyImportStatus');
                if (status) {
                    status.innerHTML = '❌ ' + err.message;
                    status.style.color = '#ef4444';
                }
            }
        };
        reader.readAsText(file);
    },

    async _saveComfyConfig() {
        var cfg = {
            server_url: document.getElementById('comfyServerUrl').value.trim() || 'http://127.0.0.1:8188',
            enabled: document.getElementById('comfyEnabled').checked,
            workflows: [],
            active_workflow: ''
        };
        // 收集现有工作流参数
        var params = document.querySelectorAll('.wf-param');
        var wfMap = {};
        for (var i = 0; i < params.length; i++) {
            var p = params[i];
            var idx = parseInt(p.getAttribute('data-idx'));
            var field = p.getAttribute('data-field');
            if (!wfMap[idx]) wfMap[idx] = {};
            wfMap[idx][field] = p.value;
        }
        // 读取已有工作流
        var oldCfg = this._comfyConfig || {};
        var oldWfs = oldCfg.workflows || [];
        for (var i = 0; i < oldWfs.length; i++) {
            var w = Object.assign({}, oldWfs[i]);
            if (wfMap[i]) {
                if (wfMap[i].prompt_node_id) w.prompt_node_id = wfMap[i].prompt_node_id;
                if (wfMap[i].prompt_field) w.prompt_field = wfMap[i].prompt_field;
                if (wfMap[i].image_output_node_id) w.image_output_node_id = wfMap[i].image_output_node_id;
            }
            cfg.workflows.push(w);
        }
        // 如果有新导入的工作流
        if (this._importedWorkflow) {
            var name = prompt('命名此工作流模板:', '文生图');
            if (name) {
                var wfId = 'wf_' + Date.now();
                var wfItem = {
                    id: wfId,
                    name: name,
                    description: '从 JSON 导入',
                    prompt_node_id: this._importedPromptNode || '6',
                    prompt_field: 'text',
                    image_output_node_id: '9',
                    workflow_json: this._importedWorkflow
                };
                cfg.workflows.push(wfItem);
                cfg.active_workflow = wfId;
                this._importedWorkflow = null;
            }
        }
        // 选中的工作流
        var radio = document.querySelector('input[name="comfyWorkflow"]:checked');
        if (radio) cfg.active_workflow = radio.value;

        var data = await this.fetchJSON('/api/v2/comfyui/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: cfg })
        });
        if (data && data.ok) {
            this._comfyConfig = cfg;
            // 同时保存模块预设
            var presets = {};
            var enableEls = document.querySelectorAll('.preset-enable');
            for (var pi = 0; pi < enableEls.length; pi++) {
                var mname = enableEls[pi].getAttribute('data-module');
                var textarea = document.querySelector('.preset-text-' + mname);
                presets[mname] = {
                    enabled: enableEls[pi].checked,
                    preset: textarea ? textarea.value.trim() : ''
                };
            }
            await this.fetchJSON('/api/v2/comfyui/module-presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ presets: presets })
            });
            this.showToast('ComfyUI 配置已保存', 'success');
        } else {
            this.showToast('保存失败', 'error');
        }
    },

    async generateComfyThumbnail() {
        var pid = this._editingPromptId;
        if (!pid) { this.showToast('请先打开编辑弹窗', 'error'); return; }

        // 检查是否已有缩略图，询问是否替换
        if (this._editThumbFilename || this._editVideoFilename) {
            if (!confirm('当前提示词已有缩略图，是否重新生成并替换？')) return;
        } else if (this._editThumbnailCleared) {
            if (!confirm('当前缩略图已清除，重新生成？')) return;
        }

        // 提前拿到按钮引用，所有出口都要恢复
        var btn = document.querySelector('[onclick*="generateComfyThumbnail"]');
        function _resetBtn() {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-magic"></i> AI 生成'; }
        }

        var cfg = await this.fetchJSON('/api/v2/comfyui/config');
        if (!cfg || !cfg.config || !cfg.config.enabled) {
            _resetBtn();
            this.showToast('ComfyUI 未启用，请先配置', 'warning');
            this.openComfyConfig();
            return;
        }
        if (!cfg.config.active_workflow && (!cfg.config.workflows || cfg.config.workflows.length === 0)) {
            _resetBtn();
            this.showToast('请先导入 ComfyUI 工作流模板', 'warning');
            this.openComfyConfig();
            return;
        }

        // 取当前编辑框里的提示词
        var promptText = document.getElementById('editContent').value.trim();
        if (!promptText) { _resetBtn(); this.showToast('请先输入提示词内容', 'error'); return; }

        this.showToast('⏳ 正在发送到 ComfyUI 生成...', 'info');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-magic"></i> 生成中...'; }

        try {
            var body = {
                prompt_id: pid,
                prompt_text: promptText,
                workflow_id: cfg.config.active_workflow || '',
                module_name: document.getElementById('editModule').value || ''
            };
            // ComfyUI 生成耗时较长（1-5分钟），单独使用 600 秒超时
            var controller = new AbortController();
            var timer = setTimeout(function() { controller.abort(); }, 600000);
            var data = null;
            try {
                var res = await fetch('/api/v2/comfyui/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(timer);
                if (res.ok) data = await res.json();
            } catch(e) {
                clearTimeout(timer);
                if (e.name === 'AbortError') {
                    this.showToast('生成超时（600秒），请检查 ComfyUI 状态', 'error');
                    _resetBtn();
                    return;
                }
                throw e;
            }
            if (data && data.ok) {
                this.showToast('✅ 生成完成，缩略图已更新', 'success');
                // 刷新编辑弹窗的缩略图预览
                if (data.thumbnail) {
                    var preview = document.getElementById('editThumbPreview');
                    if (preview) preview.innerHTML = '<img src="/api/thumbnails/file/' + data.thumbnail + '" style="width:120px;height:80px;object-fit:cover;border-radius:6px;">';
                    var nameEl = document.getElementById('editThumbName');
                    if (nameEl) nameEl.textContent = data.thumbnail;
                }
                // 刷新卡片网格，缩略图自动显示
                await this.loadPrompts();
                // 刷新查看器弹窗（如果打开）
                this._refreshViewerPanels();
            } else {
                this.showToast('生成失败: ' + (data ? data.error : '未知错误'), 'error');
            }
        } catch(e) {
            this.showToast('生成失败: ' + e.message, 'error');
        }
        _resetBtn();
    },


    showWorkflowHelp() {
        document.getElementById('modalWorkflow').style.display = 'flex';
    },

// ============ 版本历史 ============

    async showVersionHistory(promptId) {
        document.getElementById('modalVersions').style.display = 'flex';
        document.getElementById('versionTitle').textContent = '版本历史';
        document.getElementById('versionBody').innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">加载版本历史...</p></div>';
        try {
            var data = await this.fetchJSON('/api/v2/versions/' + promptId);
            if (!data) throw new Error('获取失败');
            this._renderVersionList(promptId, data);
        } catch (e) {
            document.getElementById('versionBody').innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">❌ 获取版本历史失败: ' + e.message + '</div>';
        }
    },

    _renderVersionList(promptId, data) {
        var body = document.getElementById('versionBody');
        var html = '';

        // 当前版本
        var cur = data.current || {};
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:14px;font-weight:600;margin-bottom:8px;">当前版本（最新）</div>';
        html += '<div style="background:var(--hover-bg,#f1f5f9);border-radius:8px;padding:10px 14px;border:1px solid var(--primary);font-size:12px;">';
        html += '<div style="color:var(--text-muted);margin-bottom:4px;">' + this._escape(cur.content || '').substring(0, 80) + (cur.content && cur.content.length > 80 ? '...' : '') + '</div>';
        html += '<div style="display:flex;gap:6px;color:var(--text-muted);font-size:11px;">';
        html += '<span>模块: ' + this._escape(cur.module || '-') + '</span>';
        html += '<span>分类: ' + this._escape(cur.category || '-') + '</span>';
        html += '</div></div></div>';

        // 历史版本列表
        var versions = data.versions || [];
        if (versions.length === 0) {
            html += '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">暂无历史版本</div>';
        } else {
            html += '<div style="font-size:14px;font-weight:600;margin-bottom:8px;">历史版本（共 ' + versions.length + ' 个）</div>';
            for (var i = 0; i < versions.length; i++) {
                var v = versions[i];
                var contentPreview = (v.content || '').substring(0, 60);
                var isCurrent = false; // all historical
                var bg = 'var(--hover-bg,#f1f5f9)';
                html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin-bottom:6px;background:' + bg + ';border-radius:6px;font-size:12px;">';
                html += '<div style="flex:1;min-width:0;">';
                html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
                html += '<strong>v' + v.version + '</strong>';
                html += '<span style="color:var(--text-muted);">' + this._escape(v.created_at || '') + '</span>';
                if (v.change_note) html += '<span style="color:#6366f1;">' + this._escape(v.change_note) + '</span>';
                html += '</div>';
                html += '<div style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + this._escape(contentPreview) + '</div>';
                html += '</div>';
                html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
                html += '<button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;" onclick="App._restoreVersion(' + promptId + ',' + v.id + ',' + v.version + ')">↩ 恢复</button>';
                if (i < versions.length - 1) {
                    html += '<button class="btn btn-sm" style="border:1px solid #22c55e;color:#22c55e;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;" onclick="App._showVersionDiff(' + promptId + ',' + versions[i+1].id + ',' + v.id + ')">⇄ diff</button>';
                } else {
                    // 对比当前 vs 最早版本
                    html += '<button class="btn btn-sm" style="border:1px solid #22c55e;color:#22c55e;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;" onclick="App._showVersionDiff(' + promptId + ',' + promptId + ',' + v.id + ')">⇄ diff</button>';
                }
                html += '</div>';
                html += '</div>';
            }
        }

        body.innerHTML = html;
    },

    async _restoreVersion(promptId, versionId, versionNum) {
        if (!confirm('确认恢复到 v' + versionNum + '？当前版本将自动存档')) return;
        try {
            var data = await this.fetchJSON('/api/v2/versions/' + promptId + '/restore/' + versionId, { method: 'POST' });
            if (data && data.ok) {
                this.showToast('已恢复到 v' + versionNum, 'success');
                document.getElementById('modalVersions').style.display = 'none';
                await this.loadPrompts();
            } else {
                this.showToast('恢复失败: ' + (data ? data.error : '未知'), 'error');
            }
        } catch (e) {
            this.showToast('恢复失败: ' + e.message, 'error');
        }
    },

    async _showVersionDiff(promptId, v1Id, v2Id) {
        document.getElementById('modalVersionDiff').style.display = 'flex';
        document.getElementById('diffTitle').textContent = '版本对比';
        document.getElementById('diffBody').innerHTML = '<div style="text-align:center;padding:20px;font-family:sans-serif;"><div class="spinner-border text-primary" role="status"></div><p style="margin-top:12px;color:var(--text-muted);">正在对比...</p></div>';
        try {
            var data = await this.fetchJSON('/api/v2/versions/' + promptId + '/diff/' + v1Id + '/' + v2Id);
            if (!data || !data.ok) throw new Error(data ? data.error : '获取失败');
            var html = '';
            var diffs = data.diffs || [];
            if (diffs.length === 0) {
                html = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-family:sans-serif;"><span style="font-size:40px;">✅</span><p style="margin-top:8px;">两个版本完全相同</p></div>';
            } else {
                html += '<div style="margin-bottom:12px;font-family:sans-serif;font-size:12px;color:var(--text-muted);">';
                html += '对比: v' + data.v1.version + ' ↔ v' + data.v2.version + ' | 共 ' + data.total_changes + ' 处差异';
                html += '</div>';
                for (var d = 0; d < diffs.length; d++) {
                    var diff = diffs[d];
                    html += '<div style="margin-bottom:12px;border:1px solid var(--border-color);border-radius:6px;overflow:hidden;">';
                    html += '<div style="background:var(--hover-bg,#f1f5f9);padding:6px 10px;font-size:11px;font-weight:600;font-family:sans-serif;">' + diff.field + '</div>';
                    html += '<div style="padding:8px 10px;">';
                    html += '<div style="background:#fef2f2;color:#ef4444;padding:6px 8px;border-radius:4px;margin-bottom:4px;font-size:12px;"><span style="font-weight:600;">旧</span> ' + this._escape(diff.old || '(空)') + '</div>';
                    html += '<div style="background:#f0fdf4;color:#059669;padding:6px 8px;border-radius:4px;font-size:12px;"><span style="font-weight:600;">新</span> ' + this._escape(diff.new || '(空)') + '</div>';
                    html += '</div></div>';
                }
            }
            document.getElementById('diffBody').innerHTML = html;
        } catch (e) {
            document.getElementById('diffBody').innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;font-family:sans-serif;">❌ ' + e.message + '</div>';
        }
    },

    applyTheme(theme) {
        this.state.theme = theme;
        const btn = document.getElementById('btnTheme');
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
            if (btn) btn.innerHTML = '<i class="bi bi-sun"></i>';
        } else {
            document.body.classList.remove('dark-theme');
            if (btn) btn.innerHTML = '<i class="bi bi-moon-stars"></i>';
        }
    },

    // ============ 卡片列数控制 ============

    onColumnSlider(val) {
        this.state.columns = parseInt(val);
        document.getElementById('columnSlider').value = val;
        document.getElementById('columnLabel').textContent = val + '列';
        try { localStorage.setItem('promptkit_columns', val); } catch(e) {}
        this.applyColumns();
    },

    applyColumns() {
        var cols = this.state.columns || 3;
        // 不再更新滑块UI，只更新CSS grid列数
        var grids = document.querySelectorAll('.prompt-grid');
        for (var i = 0; i < grids.length; i++) {
            grids[i].style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
        }

        // 根据列数调整缩略图大小
        // 1-2列时缩略图尺寸与文字区域比例协调，防止缩略图撑满卡片
        var thumbW, thumbH;
        if (cols <= 1)      { thumbW = 480; thumbH = 320; }
        else if (cols <= 2) { thumbW = 190; thumbH = 127; }
        else if (cols <= 3) { thumbW = 140; thumbH = 93; }
        else if (cols <= 4) { thumbW = 110; thumbH = 73; }
        else if (cols <= 5) { thumbW = 95;  thumbH = 63; }
        else                { thumbW = 85;  thumbH = 57; }
        var root = document.documentElement;
        root.style.setProperty('--thumb-w', thumbW + 'px');
        root.style.setProperty('--thumb-h', thumbH + 'px');
    },

    decColumn() {
        var cur = this.state.columns || 3;
        if (cur > 1) this.onColumnSlider(cur - 1);
    },
    incColumn() {
        var cur = this.state.columns || 3;
        if (cur < 6) this.onColumnSlider(cur + 1);
    },


});
})();
