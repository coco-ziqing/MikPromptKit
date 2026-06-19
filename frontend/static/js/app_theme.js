// Phase13.2: 主题子模块 — 深色/浅色切换
(function() {
    'use strict';

    if (!App._themeBound) {
        App._themeBound = true;

        var THEME_KEY = 'promptkit_theme';

        App.getTheme = function() {
            try { return localStorage.getItem(THEME_KEY); } catch(e) { return null; }
        };

        App.setTheme = function(dark) {
            try { 
                if (dark) localStorage.setItem(THEME_KEY, '1');
                else localStorage.removeItem(THEME_KEY);
            } catch(e) {}
        };

        App.isDarkTheme = function() {
            return document.body.classList.contains('dark-theme');
        };

        // applyTheme: 被 app_core.js init() 调用（同步直接切换）
        App.applyTheme = function(dark) {
            var isDark = dark === true || dark === '1' || dark === 'dark';
            document.body.classList.toggle('dark-theme', isDark);
            App.setTheme(isDark);
            var btn = document.getElementById('btnTheme');
            if (btn) {
                btn.innerHTML = isDark ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';
                btn.title = isDark ? '切换为浅色模式' : '切换为深色模式';
            }
        };

        App.toggleTheme = function() {
            var dark = !document.body.classList.contains('dark-theme');
            document.body.classList.toggle('dark-theme', dark);
            App.setTheme(dark);
            var btn = document.getElementById('btnTheme');
            if (btn) {
                btn.innerHTML = dark ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';
                btn.title = dark ? '切换为浅色模式' : '切换为深色模式';
            }
            // 同步后端配置
            fetch('/api/v2/config/theme', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({dark: dark ? 1 : 0})
            }).catch(function() {});
            // 触发主题变更事件（供其他模块监听）
            document.dispatchEvent(new CustomEvent('theme-changed', {detail: {dark: dark}}));
        };

        App.initTheme = function() {
            // 从后端加载主题配置
            fetch('/api/v2/config/theme')
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    var dark = false;
                    if (d && d.value !== undefined) {
                        dark = d.value == 1;
                    } else {
                        // fallback 到 localStorage
                        dark = App.getTheme() === '1';
                    }
                    document.body.classList.toggle('dark-theme', dark);
                    var btn = document.getElementById('btnTheme');
                    if (btn) {
                        btn.innerHTML = dark ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';
                        btn.title = dark ? '切换为浅色模式' : '切换为深色模式';
                    }
                })
                .catch(function() {
                    // 离线 fallback: 只用 localStorage
                    var dark = App.getTheme() === '1';
                    document.body.classList.toggle('dark-theme', dark);
                });
        };

        // 不自初始化（由 app_core.js init() 调用 applyTheme 完成）
        // initTheme 保留为公共方法供手动调用

        console.log('[Theme Module] loaded');
    }

})();
