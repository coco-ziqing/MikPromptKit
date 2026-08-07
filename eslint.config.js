// ESLint flat config — MikPromptKit 前端（无模块化 ES5 代码）
// Phase 2.2 引入：语法错误兜底 + 高危规则，避免误报（跨文件全局模式）
"use strict";

module.exports = [
  {
    files: ["frontend/static/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        // 浏览器环境
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        location: "readonly",
        history: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        EventSource: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        console: "readonly",
        alert: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        // 跨文件全局（App/PK 体系）
        App: "writable",
        PK: "writable",
        // 第三方
        bootstrap: "readonly",
      },
    },
    rules: {
      // 语法级（绝对安全）
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-duplicate-case": "error",
      "no-constant-condition": "warn",
      "no-func-assign": "error",
      "no-unreachable": "warn",
      "no-extra-semi": "warn",
      "no-extra-boolean-cast": "warn",
      "no-redeclare": "warn",
      // 高危问题（Phase 3 逐步收紧）
      "no-undef": "off", // 跨文件全局模式，误报多，Phase 3 引入 globals 清单后开启
      "no-unused-vars": "off", // 同上
      eqeqeq: "off",
    },
  },
];
