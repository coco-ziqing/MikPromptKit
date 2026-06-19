// Phase13.3: 国际化 i18n 模块
(function() {
    'use strict';

    if (App._i18nReady) return;

    var LANG = 'zh-CN';
    try { LANG = localStorage.getItem('promptkit_lang') || 'zh-CN'; } catch(e) {}

    App._i18nDicts = {};
    App._i18nCurrent = LANG;

    // 加载语言字典
    App.i18nLoad = async function(lang) {
        if (App._i18nDicts[lang]) return;
        if (lang === 'zh-CN') {
            // 中文直接使用源码中的字符串，不需要字典
            App._i18nDicts['zh-CN'] = {};
            return;
        }
        try {
            var resp = await fetch('/static/i18n/' + lang + '.json');
            if (resp.ok) {
                App._i18nDicts[lang] = await resp.json();
            }
        } catch(e) {
            console.warn('[i18n] Failed to load:', lang, e);
            App._i18nDicts[lang] = {};
        }
    };

    // 翻译
    App._t = function(key, fallback) {
        var lang = App._i18nCurrent;
        // 中文直接返回 fallback
        if (lang === 'zh-CN') return fallback || key;
        var dict = App._i18nDicts[lang];
        if (dict && dict[key] !== undefined) return dict[key];
        // fallback 英文
        var enDict = App._i18nDicts['en'];
        if (enDict && enDict[key] !== undefined) return enDict[key];
        return fallback || key;
    };

    // 翻译带参数 (替换 {placeholder})
    App._tF = function(key, fallback, params) {
        var msg = App._t(key, fallback);
        if (params) {
            for (var k in params) {
                msg = msg.replace('{' + k + '}', params[k]);
            }
        }
        return msg;
    };

    // 切换语言
    App.switchLang = async function(lang) {
        if (lang === App._i18nCurrent) return;
        await App.i18nLoad(lang);
        App._i18nCurrent = lang;
        try { localStorage.setItem('promptkit_lang', lang); } catch(e) {}
        document.dispatchEvent(new CustomEvent('i18n-changed', {detail: {lang: lang}}));
        App.showToast('Language: ' + (lang === 'en' ? 'English' : '中文'), 'info');
        // 刷新当前视图
        var activeView = localStorage.getItem('promptkit_view') || 'home';
        App.switchView(activeView);
    };

    // 初始化：预加载英文
    (async function() {
        await App.i18nLoad('en');
        App._i18nReady = true;
        console.log('[i18n] ready, lang=' + App._i18nCurrent);
    })();

    // 在页面中添加语言切换按钮
    document.addEventListener('DOMContentLoaded', function() {
        var headerActions = document.querySelector('.header-actions');
        if (headerActions) {
            var btn = document.createElement('button');
            btn.className = 'header-btn';
            btn.id = 'btnLang';
            btn.innerHTML = '<i class="bi bi-translate"></i>';
            btn.title = '切换语言 / Switch Language';
            btn.style.fontSize = '16px';
            btn.onclick = function() {
                var nextLang = App._i18nCurrent === 'zh-CN' ? 'en' : 'zh-CN';
                App.switchLang(nextLang);
                btn.innerHTML = nextLang === 'zh-CN' ? '中' : 'EN';
                btn.style.fontSize = '13px';
                btn.style.fontWeight = 'bold';
            };
            // 初始显示
            btn.innerHTML = App._i18nCurrent === 'zh-CN' ? '中' : 'EN';
            btn.style.fontSize = '13px';
            btn.style.fontWeight = 'bold';
            // 插入到合适位置（在主题按钮前）
            var themeBtn = document.getElementById('btnTheme');
            if (themeBtn) {
                headerActions.insertBefore(btn, themeBtn);
            } else {
                headerActions.appendChild(btn);
            }
        }
    });

})();
