/**
 * PromptKit 插件 License 激活面板
 * Phase18 v5.1.0
 *
 * @license MIT — 开源核心
 * @boundary OPEN-SOURCE — License 输入/激活/状态展示 UI
 *
 * 功能: License Key 输入 → 验证 → 激活 → 状态展示
 * 支持个人版买断和团队版订阅两种模式
 */

(function () {
  'use strict';

  const LM = (window.LicenseManager = {
    // 当前操作的插件ID
    _currentPluginId: '',
    
    /**
     * 打开 License 激活面板
     * @param {string} pluginId  插件ID
     * @param {string} pluginName 插件显示名
     */
    open(pluginId, pluginName) {
      this._currentPluginId = pluginId;
      this._renderModal(pluginName);
      this._loadStatus(pluginId);
    },

    /** 打开 License 管理面板（系统级） */
    openSystem() {
      this._currentPluginId = '';
      this._renderSystemModal();
      this._loadAllStatus();
    },

    // ========= 渲染 =========

    _renderModal(pluginName) {
      const existing = document.getElementById('license-modal');
      if (existing) existing.remove();

      const html = /*html*/`
        <div class="modal-overlay" id="license-modal">
          <div class="modal-content license-panel" onclick="event.stopPropagation()" style="max-width:480px;">
            <div class="modal-header">
              <h5><i class="bi bi-key"></i> License 激活 — ${this._escHtml(pluginName)}</h5>
              <button class="modal-close-btn" onclick="LicenseManager._close()">&times;</button>
            </div>
            <div class="modal-body">
              <!-- 状态 -->
              <div id="license-status-area" class="license-status loading">
                <i class="bi bi-hourglass-split"></i> 查询状态中...
              </div>

              <!-- 激活表单 -->
              <div class="license-form">
                <label class="form-label">License Key</label>
                <div class="input-group">
                  <input type="text" id="license-key-input" class="form-control"
                         placeholder="PK-PERS-XXXXX-... 或 PK-TEAM-XXXXX-..."
                         style="font-family:monospace;font-size:13px;">
                  <button class="btn btn-primary" onclick="LicenseManager._activate()">
                    <i class="bi bi-check-circle"></i> 激活
                  </button>
                </div>
                <small class="text-muted mt-1 d-block">支持个人版买断和团队版订阅 Key</small>
              </div>

              <!-- 高级选项（团队版） -->
              <div class="mt-3" id="license-advanced" style="display:none;">
                <label class="form-label">授权服务器地址（可选）</label>
                <input type="text" id="license-auth-server" class="form-control form-control-sm"
                       placeholder="https://license.promptkit.cn" style="font-size:12px;">
                <small class="text-muted">团队版订阅需要定期联网校验，留空使用离线模式</small>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-sm btn-outline-secondary" onclick="LicenseManager._deactivate()">
                <i class="bi bi-unlock"></i> 解除激活
              </button>
              <button class="btn btn-sm btn-secondary" onclick="LicenseManager._close()">关闭</button>
            </div>
          </div>
        </div>`;

      document.body.insertAdjacentHTML('beforeend', html);
      
      // 监听团队版输入切换高级选项
      const input = document.getElementById('license-key-input');
      if (input) {
        input.addEventListener('input', () => {
          const adv = document.getElementById('license-advanced');
          if (adv) {
            adv.style.display = input.value.toUpperCase().includes('PK-TEAM') ? 'block' : 'none';
          }
        });
      }
    },

    _renderSystemModal() {
      const existing = document.getElementById('license-modal');
      if (existing) existing.remove();

      const html = /*html*/`
        <div class="modal-overlay" id="license-modal">
          <div class="modal-content license-panel" onclick="event.stopPropagation()" style="max-width:600px;">
            <div class="modal-header">
              <h5><i class="bi bi-shield-lock"></i> License 管理</h5>
              <button class="modal-close-btn" onclick="LicenseManager._close()">&times;</button>
            </div>
            <div class="modal-body">
              <div id="license-system-status">加载中...</div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-sm btn-secondary" onclick="LicenseManager._close()">关闭</button>
            </div>
          </div>
        </div>`;

      document.body.insertAdjacentHTML('beforeend', html);
    },

    // ========= API 调用 =========

    async _loadStatus(pluginId) {
      try {
        const resp = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/status`);
        const data = await resp.json();
        if (data.success) {
          this._renderStatus(data.data);
        } else {
          this._renderStatus({status: 'error', message: '查询未完成'});
        }
      } catch (e) {
        this._renderStatus({status: 'error', message: '网络不太稳定，请稍后重试'});
      }
    },

    async _loadAllStatus() {
      try {
        const resp = await fetch('/api/plugin-system/licenses');
        const data = await resp.json();
        if (data.success) {
          this._renderSystemStatus(data.data);
        }
      } catch (e) {
        document.getElementById('license-system-status').innerHTML = 
          '<div class="alert alert-danger">无法获取 License 状态</div>';
      }
    },

    async _activate() {
      const input = document.getElementById('license-key-input');
      const key = (input?.value || '').trim();
      
      if (!key) {
        this._showToast('请输入 License Key', 'warning');
        return;
      }

      const tierHint = key.toUpperCase().includes('PK-TEAM') ? 'team' : 'personal';
      const authServer = document.getElementById('license-auth-server')?.value?.trim() || '';

      const statusEl = document.getElementById('license-status-area');
      if (statusEl) {
        statusEl.className = 'license-status loading';
        statusEl.innerHTML = '<i class="bi bi-hourglass-split"></i> 正在激活...';
      }

      try {
        const resp = await fetch(`/api/plugins/${encodeURIComponent(this._currentPluginId)}/activate`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            license_key: key,
            tier: tierHint,
            auth_server_url: authServer,
          }),
        });
        
        const data = await resp.json();
        
        if (data.success) {
          this._showToast(data.message, 'success');
          this._loadStatus(this._currentPluginId);
        } else {
          if (statusEl) {
            statusEl.className = 'license-status error';
            statusEl.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${this._escHtml(data.message)}`;
          }
        }
      } catch (e) {
        if (statusEl) {
          statusEl.className = 'license-status error';
          statusEl.innerHTML = '<i class="bi bi-exclamation-triangle"></i> 网络不太稳定，激活未完成';
        }
      }
    },

    async _deactivate() {
      if (!confirm('确定要解除激活吗？解除后相关功能将不可用。')) return;

      try {
        const resp = await fetch(`/api/plugins/${encodeURIComponent(this._currentPluginId)}/deactivate`, {
          method: 'POST',
        });
        const data = await resp.json();
        
        if (data.success) {
          this._showToast('已解除激活', 'info');
          if (data.deactivate_code) {
            alert('解除激活成功！\n\n注销码（换机时使用）：\n' + data.deactivate_code);
          }
          this._loadStatus(this._currentPluginId);
        } else {
          this._showToast(data.message, 'warning');
        }
      } catch (e) {
        this._showToast('解除激活未完成', 'error');
      }
    },

    // ========= UI 渲染 =========

    _renderStatus(data) {
      let statusClass, statusIcon, statusText;
      
      switch (data.status) {
        case 'active':
          statusClass = 'success'; statusIcon = 'bi-check-circle-fill'; statusText = '已激活';
          break;
        case 'unactivated':
          statusClass = 'inactive'; statusIcon = 'bi-circle'; statusText = '未激活';
          break;
        case 'grace_period':
          statusClass = 'warning'; statusIcon = 'bi-clock-history'; statusText = '宽限期';
          break;
        case 'expired':
        case 'readonly':
          statusClass = 'error'; statusIcon = 'bi-x-circle-fill'; statusText = '已过期/只读';
          break;
        case 'tampered':
          statusClass = 'error'; statusIcon = 'bi-shield-exclamation'; statusText = '异常';
          break;
        default:
          statusClass = 'inactive'; statusIcon = 'bi-question-circle'; statusText = data.status || '未知';
      }

      const tierName = {personal: '个人版(买断)', team: '团队版(订阅)', free: '免费版'}[data.tier] || data.tier;

      const el = document.getElementById('license-status-area');
      if (!el) return;

      el.className = `license-status ${statusClass}`;
      el.innerHTML = /*html*/`
        <div class="d-flex align-items-center gap-2">
          <i class="bi ${statusIcon} fs-5"></i>
          <div>
            <strong>${statusText}</strong>
            <small class="d-block text-muted">${tierName} · ${this._escHtml(data.message || '')}</small>
          </div>
        </div>
        ${data.expires_at ? `<small class="text-muted d-block mt-1 ml-4">到期: ${data.expires_at}</small>` : ''}
        ${data.activated_at ? `<small class="text-muted d-block">激活时间: ${data.activated_at}</small>` : ''}
        ${data.seat_count > 1 ? `<small class="text-muted d-block">席位: ${data.seat_count}</small>` : ''}
      `;
    },

    _renderSystemStatus(dataMap) {
      const container = document.getElementById('license-system-status');
      if (!container) return;

      if (!dataMap || Object.keys(dataMap).length === 0) {
        container.innerHTML = '<div class="text-muted text-center py-3">暂无可管理的 License</div>';
        return;
      }

      let html = '<div class="table-responsive"><table class="table table-sm"><thead><tr>'
        + '<th>插件</th><th>类型</th><th>状态</th><th>到期</th><th>操作</th></tr></thead><tbody>';

      const statusBadge = {
        active: '<span class="badge bg-success">已激活</span>',
        unactivated: '<span class="badge bg-secondary">未激活</span>',
        grace_period: '<span class="badge bg-warning">宽限期</span>',
        expired: '<span class="badge bg-danger">已过期</span>',
        readonly: '<span class="badge bg-dark">只读</span>',
      };

      for (const [pid, info] of Object.entries(dataMap)) {
        const nameMap = {
          'com.promptkit.project': '项目管理',
          'com.promptkit.asset': '资产管理',
          'com.promptkit.team': '团队协作',
        };
        html += `<tr>`
          + `<td>${this._escHtml(nameMap[pid] || pid)}</td>`
          + `<td>${info.tier === 'personal' ? '个人版' : info.tier === 'team' ? '团队版' : info.tier}</td>`
          + `<td>${statusBadge[info.status] || info.status}</td>`
          + `<td>${info.expires_at || '永久'}</td>`
          + `<td><button class="btn btn-sm btn-outline-primary" onclick="LicenseManager.open('${this._escHtml(pid)}','${this._escHtml(nameMap[pid]||pid)}')">管理</button></td>`
          + `</tr>`;
      }

      html += '</tbody></table></div>';
      container.innerHTML = html;
    },

    // ========= 工具方法 =========

    _escHtml(s) {
      if (!s) return '';
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    },

    _showToast(msg, type) {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast(msg, type);
      } else {
        console.log(`[LicenseManager] ${type}: ${msg}`);
      }
    },

    _close() {
      const el = document.getElementById('license-modal');
      if (el) el.remove();
    },
  });

  console.log('[LicenseManager] v1.0 已加载');
})();
