/**
 * PromptKit 插件宿主 — 前端插件注入框架
 * Phase18 v5.1.1 — 修复按钮重复注入
 *
 * @license MIT — 开源核心
 * @boundary OPEN-SOURCE
 */

(function () {
  'use strict';

  window.__PK_PLUGINS__ = {
    _registry: {},
    _navButtons: [],
    _sidebarItems: [],
    _viewRoutes: {},
    _contextMenus: {},
    _styles: [],
    _scripts: [],
    _loaded: false,

    register(manifest) {
      if (!manifest.id) { console.warn('[PK_PLUGINS] missing id', manifest); return false; }
      this._registry[manifest.id] = manifest;
      // Nav buttons — only add if not already registered (dedup by id)
      if (manifest.navButtons && Array.isArray(manifest.navButtons)) {
        manifest.navButtons.forEach(b => {
          if (!this._navButtons.find(existing => existing.id === b.id)) {
            this._navButtons.push({ ...b, _plugin: manifest.id });
          }
        });
      }
      // Sidebar
      if (manifest.sidebarItems && Array.isArray(manifest.sidebarItems)) {
        this._sidebarItems.push(...manifest.sidebarItems.map(s => ({ ...s, _plugin: manifest.id })));
      }
      // View routes
      if (manifest.viewRoutes) {
        for (const [name, fn] of Object.entries(manifest.viewRoutes)) { this._viewRoutes[name] = fn; }
      }
      // Context menus
      if (manifest.contextMenus) {
        for (const [target, items] of Object.entries(manifest.contextMenus)) {
          if (!this._contextMenus[target]) this._contextMenus[target] = [];
          this._contextMenus[target].push(...items.map(i => ({ ...i, _plugin: manifest.id })));
        }
      }
      // Styles
      if (manifest.styles) { this._styles.push(...manifest.styles); this._injectStyles(manifest.styles); }
      // Scripts
      if (manifest.scripts) { this._scripts.push(...manifest.scripts); }
      console.log(`[PK_PLUGINS] registered: ${manifest.name} v${manifest.version} (${manifest.id})`);
      return true;
    },

    list() { return Object.values(this._registry); },
    get(id) { return this._registry[id] || null; },

    _injectStyles(urls) {
      urls.forEach(url => {
        if (document.querySelector(`link[href="${url}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = url;
        document.head.appendChild(link);
      });
    },

    async _loadScripts(urls) {
      for (const url of urls) {
        if (document.querySelector(`script[src="${url}"]`)) continue;
        await new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = url; script.async = false;
          script.onload = resolve;
          script.onerror = () => { console.warn('[PK_PLUGINS] script load fail:', url); resolve(); };
          document.head.appendChild(script);
        });
      }
    },

    async syncFromServer() {
      try {
        const resp = await fetch('/api/plugin-system/manifest');
        const data = await resp.json();
        if (data.plugins && Array.isArray(data.plugins)) {
          const cssList = data.injections?.styles || [];
          this._injectStyles(cssList);

          const jsList = data.injections?.scripts || [];
          await this._loadScripts(jsList);

          const allNavButtons = data.injections?.nav_buttons || [];
          const allSidebarItems = data.injections?.panel_slots || [];
          this._navButtons = allNavButtons.map(b => ({ ...b, _plugin: 'server' }));

          data.plugins.forEach(p => {
            this.register({
              id: p.plugin_id, name: p.name, version: p.version,
              license_tier: p.license_tier,
              navButtons: [],
              sidebarItems: allSidebarItems,
              styles: (data.injections?.styles || []).filter(s => s.includes(p.plugin_id)),
              scripts: (data.injections?.scripts || []).filter(s => s.includes(p.plugin_id)),
            });
          });
          this._loaded = true;
          console.log(`[PK_PLUGINS] server sync: ${data.plugins.length} plugins`);
        }
      } catch (e) {
        console.warn('[PK_PLUGINS] server sync fail:', e.message);
      }
    },
  };

  window.__PK_VIEW_REGISTRY__ = {
    _routes: {},
    register(name, renderFn) { this._routes[name] = renderFn; console.log(`[PK_VIEW] registered: ${name}`); },
    unregister(name) { delete this._routes[name]; },
    get(name) { return this._routes[name] || null; },
    list() { return Object.keys(this._routes); },
    render(name, container) {
      const fn = this._routes[name];
      if (!fn) { console.warn(`[PK_VIEW] view not found: ${name}`); return false; }
      try { fn(container); return true; }
      catch (e) { console.error(`[PK_VIEW] render fail "${name}":`, e); return false; }
    },
  };

  window.__PK_SLOTS__ = {
    injectNavButton(position, btn) {
      const containerId = position === 'left' ? 'pluginNavLeft' : 'pluginNavRight';
      const container = document.getElementById(containerId);
      if (!container) return false;
      const el = document.createElement('span');
      el.className = 'pk-nav-btn-wrap'; el.style.order = btn.order || 0;
      el.setAttribute('data-plugin-btn', btn.id || '');
      el.innerHTML = btn.html || `<button class="header-btn plugin-nav-btn" onclick="${btn.onClick||'void(0)'}" title="${btn.title||''}" data-plugin="${btn._plugin||''}"><i class="bi ${btn.icon||'bi-puzzle'}"></i> <span>${btn.label||''}</span></button>`;
      container.appendChild(el);
      return true;
    },

    clearPlugin(pluginId) {
      document.querySelectorAll(`[data-plugin="${pluginId}"]`).forEach(el => el.remove());
      document.querySelectorAll(`[data-plugin-btn]`).forEach(el => {
        if (el.getAttribute('data-plugin-btn').startsWith(pluginId + ':')) el.remove();
      });
    },

    renderNavButtons() {
      const container = document.getElementById('pluginNavRight');
      if (!container) return;
      container.innerHTML = '';
      const buttons = window.__PK_PLUGINS__._navButtons;
      buttons.forEach(btn => {
        this.injectNavButton(btn.slot === 'left' ? 'left' : 'right', {
          id: btn.id || btn.label || '',
          html: `<button class="header-btn plugin-nav-btn" onclick="${btn.onClick||'void(0)'}" title="${btn.title||''}"><i class="bi ${btn.icon||'bi-puzzle'}"></i></button>`,
          order: btn.order || 0,
        });
      });
    },
  };

  async function initPluginHost() {
    await window.__PK_PLUGINS__.syncFromServer();
    window.__PK_SLOTS__.renderNavButtons();
    console.log(`[PK_HOST] ready: ${window.__PK_PLUGINS__.list().length} plugins`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPluginHost);
  } else {
    initPluginHost();
  }
})();
