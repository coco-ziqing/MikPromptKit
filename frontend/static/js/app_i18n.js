/**
 * PromptKit — 国际化 i18n 模块 (v2)
 * 策略：HTML 静态元素使用 data-i18n 属性，动态渲染后调用 App._applyI18n()
 * 语言切换：sessionStorage 标记 + 刷新当前视图 + DOM 文本替换
 */
(function() {
    'use strict';
    if (App._i18nReady) return;

    // ============ 初始化语言 ============
    var LANG = 'zh-CN';
    try { LANG = localStorage.getItem('promptkit_lang') || 'zh-CN'; } catch(e) {}

    App._i18nDicts = {};
    App._i18nCurrent = LANG;

    // ============ 加载字典 ============
    App.i18nLoad = async function(lang) {
        if (App._i18nDicts[lang]) return;
        if (lang === 'zh-CN') {
            App._i18nDicts['zh-CN'] = {};
            return;
        }
        try {
            var resp = await fetch('/static/i18n/' + lang + '.json?v=' + Date.now());
            if (resp.ok) {
                App._i18nDicts[lang] = await resp.json();
            }
        } catch(e) {
            console.warn('[i18n] Failed to load:', lang, e);
            App._i18nDicts[lang] = {};
        }
    };

    // ============ 翻译函数 ============
    App._t = function(key, fallback) {
        var lang = App._i18nCurrent;
        if (lang === 'zh-CN') return fallback || key;
        var dict = App._i18nDicts[lang];
        if (dict && dict[key] !== undefined) return dict[key];
        var enDict = App._i18nDicts['en'];
        if (enDict && enDict[key] !== undefined) return enDict[key];
        return fallback || key;
    };

    App._tF = function(key, fallback, params) {
        var msg = App._t(key, fallback);
        if (params) {
            for (var k in params) {
                msg = msg.replace('{' + k + '}', params[k]);
            }
        }
        return msg;
    };

    // ============ 应用国际化到 DOM（核心函数）============
    App._applyI18n = function() {
        var lang = App._i18nCurrent;
        if (lang === 'zh-CN') {
            // 中文模式：恢复 data-i18n-zh 原始文本
            document.querySelectorAll('[data-i18n]').forEach(function(el) {
                var zh = el.getAttribute('data-i18n-zh');
                if (zh) el.textContent = zh;
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
                var zh = el.getAttribute('data-i18n-placeholder-zh');
                if (zh) el.placeholder = zh;
            });
            document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
                var zh = el.getAttribute('data-i18n-title-zh');
                if (zh) el.title = zh;
            });
        } else {
            // 英文模式：从字典查找翻译
            document.querySelectorAll('[data-i18n]').forEach(function(el) {
                var key = el.getAttribute('data-i18n');
                var translated = App._t(key, '');
                if (translated) el.textContent = translated;
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
                var key = el.getAttribute('data-i18n-placeholder');
                var translated = App._t(key, '');
                if (translated) el.placeholder = translated;
            });
            document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
                var key = el.getAttribute('data-i18n-title');
                var translated = App._t(key, '');
                if (translated) el.title = translated;
            });
        }

        // 品牌名称由 <span data-i18n="nav.brand"> 统一管理
        // 更新语言按钮显示

        // 更新语言按钮显示
        var langBtn = document.getElementById('btnLang');
        if (langBtn) {
            langBtn.innerHTML = lang === 'zh-CN' ? '中' : 'EN';
            langBtn.title = App._t('lang.switch', 'Switch Language');
        }

        // 更新搜索框占位符
        var searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.placeholder = App._t('search.placeholder', '搜索提示词，Ctrl+F 快速定位');
        }

        // 更新主题按钮 title
        var themeBtn = document.getElementById('btnTheme');
        if (themeBtn) {
            themeBtn.title = App._t('theme.toggle', '切换深色模式');
        }

        // 更新 headerStats（由 loadStats 管理，不重复覆盖）
    };

    // ============ 切换语言 ============
    App.switchLang = async function(lang) {
        if (lang === App._i18nCurrent) return;
        await App.i18nLoad(lang);
        App._i18nCurrent = lang;
        try { localStorage.setItem('promptkit_lang', lang); } catch(e) {}
        // 应用 i18n DOM 更新
        App._applyI18n();
        // 刷新当前视图
        var activeView = localStorage.getItem('promptkit_view') || 'home';
        App.switchView(activeView);
        App.showToast(App._t('lang.switched', 'Language: ' + (lang === 'en' ? 'English' : '中文')), 'info');
    };

    // ============ 预加载字典 ============
    (async function() {
        await App.i18nLoad('en');
        App._i18nReady = true;
        console.log('[i18n] ready, lang=' + App._i18nCurrent);
    })();

})();
