/**
 * PromptKit 插件宿主 — 前端插件注入框架
 * Phase18 v5.1.0
 *
 * @license MIT — 开源核心
 * @boundary OPEN-SOURCE
 *
 * 提供:
 *  - window.__PK_PLUGINS__: 插件注册 API
 *  - ViewRegistry: 视图动态路由
 *  - SlotManager:   导航栏/侧边栏/上下文菜单注入点
 *  - PluginStyleInjector: 动态加载插件 CSS
 *
 * 加载时机: 在 app_core.js 之后、其他模块之前
 */

(function () {
  'use strict';

  // ================================================================
  // 全局宿主对象
  // ================================================================

  window.__PK_PLUGINS__ = {
    _registry: {},           // {plugin_id: pluginManifest}
    _navButtons: [],         // 导航栏按钮
    _sidebarItems: [],       // 侧边栏项目
    _viewRoutes: {},         // {viewName: renderFunction}
    _contextMenus: {},       // {targetType: [menuItem]}
    _styles: [],             // CSS URLs
    _scripts: [],            // JS URLs
    _loaded: false,

    /** 注册插件 */
    register(manifest) {
      if (!manifest.id) {
        console.warn('[PK_PLUGINS] 注册失败: 缺少 id', manifest);
        return false;
      }
      this._registry[manifest.id] = manifest;

      // 导航按钮
      if (manifest.navButtons && Array.isArray(manifest.navButtons)) {
        this._navButtons.push(...manifest.navButtons.map(b => ({ ...b, _plugin: manifest.id })));
      }

      // 侧边栏
      if (manifest.sidebarItems && Array.isArray(manifest.sidebarItems)) {
        this._sidebarItems.push(...manifest.sidebarItems.map(s => ({ ...s, _plugin: manifest.id })));
      }

      // 视图路由
      if (manifest.viewRoutes) {
        for (const [name, fn] of Object.entries(manifest.viewRoutes)) {
          this._viewRoutes[name] = fn;
        }
      }

      // 上下文菜单
      if (manifest.contextMenus) {
        for (const [target, items] of Object.entries(manifest.contextMenus)) {
          if (!this._contextMenus[target]) this._contextMenus[target] = [];
          this._contextMenus[target].push(...items.map(i => ({ ...i, _plugin: manifest.id })));
        }
      }

      // 样式
      if (manifest.styles) {
        this._styles.push(...manifest.styles);
        this._injectStyles(manifest.styles);
      }

      // 脚本
      if (manifest.scripts) {
        this._scripts.push(...manifest.scripts);
      }

      console.log(`[PK_PLUGINS] 插件已注册: ${manifest.name} v${manifest.version} (${manifest.id})`);
      return true;
    },

    /** 获取所有已注册插件 */
    list() {
      return Object.values(this._registry);
    },

    /** 按 ID 获取插件 */
    get(id) {
      return this._registry[id] || null;
    },

    /** 注入样式 */
    _injectStyles(urls) {
      urls.forEach(url => {
        if (document.querySelector(`link[href="${url}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
      });
    },

    /** 从服务端同步插件清单 */
    async syncFromServer() {
      try {
        const resp = await fetch('/api/plugin-system/manifest');
        const data = await resp.json();
        if (data.plugins && Array.isArray(data.plugins)) {
          data.plugins.forEach(p => {
            this.register({
              id: p.plugin_id,
              name: p.name,
              version: p.version,
              navButtons: (data.injections?.nav_buttons || []).filter(b => true),
              sidebarItems: (data.injections?.panel_slots || []).filter(s => true),
            });
          });
          this._loaded = true;
          console.log(`[PK_PLUGINS] 服务端同步: ${data.plugins.length} 个插件`);
        }
      } catch (e) {
        console.warn('[PK_PLUGINS] 服务端同步失败:', e.message);
      }
    },
  };

  // ================================================================
  // 视图注册表
  // ================================================================

  window.__PK_VIEW_REGISTRY__ = {
    _routes: {},

    register(name, renderFn) {
      this._routes[name] = renderFn;
      console.log(`[PK_VIEW] 视图已注册: ${name}`);
    },

    unregister(name) {
      delete this._routes[name];
    },

    get(name) {
      return this._routes[name] || null;
    },

    list() {
      return Object.keys(this._routes);
    },

    /** 渲染视图 */
    render(name, container) {
      const fn = this._routes[name];
      if (!fn) {
        console.warn(`[PK_VIEW] 视图不存在: ${name}`);
        return false;
      }
      try {
        fn(container);
        return true;
      } catch (e) {
        console.error(`[PK_VIEW] 视图渲染失败 "${name}":`, e);
        return false;
      }
    },
  };

  // ================================================================
  // Slot 管理器 — UI 注入点
  // ================================================================

  window.__PK_SLOTS__ = {
    /**
     * 注入导航按钮
     * @param {string} position  'left' | 'right'
     * @param {object} btn       {id, html, title, order, onClick}
     */
    injectNavButton(position, btn) {
      const containerId = position === 'left' ? 'pluginNavLeft' : 'pluginNavRight';
      const container = document.getElementById(containerId);
      if (!container) return false;

      const el = document.createElement('span');
      el.className = 'pk-nav-btn-wrap';
      el.setAttribute('data-plugin-btn', btn.id || '');
      el.style.order = btn.order || 0;
      el.innerHTML = btn.html || `<button class="header-btn" onclick="${btn.onClick||''}" title="${btn.title||''}">${btn.label||''}</button>`;
      container.appendChild(el);
      return true;
    },

    /** 清除指定插件的所有注入 */
    clearPlugin(pluginId) {
      document.querySelectorAll(`[data-plugin="${pluginId}"]`).forEach(el => el.remove());
      document.querySelectorAll(`[data-plugin-btn]`).forEach(el => {
        if (el.getAttribute('data-plugin-btn').startsWith(pluginId + ':')) {
          el.remove();
        }
      });
    },

    /** 注入侧边栏项 */
    injectSidebarItem(item) {
      const container = document.getElementById('pluginSidebarItems');
      if (!container) return false;

      const el = document.createElement('div');
      el.className = 'pk-sidebar-item';
      el.setAttribute('data-plugin', item._plugin || '');
      el.innerHTML = item.html || /*html*/`
        <div class="sidebar-item" onclick="${item.onClick||''}">
          <i class="bi ${item.icon||'bi-puzzle'}"></i>
          <span>${item.label||''}</span>
        </div>`;
      container.appendChild(el);
      return true;
    },

    /** 渲染侧边栏所有已注册项目 */
    renderSidebar() {
      const container = document.getElementById('pluginSidebarItems');
      if (!container) return;
      container.innerHTML = '';

      const items = window.__PK_PLUGINS__._sidebarItems;
      items.forEach(item => this.injectSidebarItem(item));
    },

    /** 渲染导航栏所有已注册按钮 */
    renderNavButtons() {
      const buttons = window.__PK_PLUGINS__._navButtons;
      buttons.forEach(btn => {
        const position = btn.slot === 'left' ? 'left' : 'right';
        this.injectNavButton(position, {
          id: `${btn._plugin}:${btn.id||'nav'}`,
          html: `<button class="header-btn plugin-nav-btn" onclick="${btn.onClick||'void(0)'}" title="${btn.title||btn.label||''}" data-plugin="${btn._plugin}"><i class="bi ${btn.icon||'bi-puzzle'}"></i>${btn.showLabel!==false?' <span>'+btn.label+'</span>':''}</button>`,
          order: btn.order || 0,
        });
      });
    },
  };

  // ================================================================
  // 初始化 — 从服务端拉取插件清单并渲染 UI
  // ================================================================

  async function initPluginHost() {
    // 从服务端获取清单
    await window.__PK_PLUGINS__.syncFromServer();

    // 渲染注入点
    window.__PK_SLOTS__.renderNavButtons();
    window.__PK_SLOTS__.renderSidebar();

    console.log(`[PK_HOST] 就绪: ${window.__PK_PLUGINS__.list().length} 个插件`);
  }

  // 在 DOM ready 后自动初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPluginHost);
  } else {
    initPluginHost();
  }

})();
