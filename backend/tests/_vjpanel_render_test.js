/* 光厂队列面板渲染回归测试
   目的：复现「面板一直卡在加载中」——_pollPanel 的 .then 回调里若有异常会被 .catch 吞掉并每 5s 重试，
        表现就是永远停在「加载中...」。这里手动驱动 .then 回调，让异常直接抛出来定位。
   数据：backend/tests/_vjtasks_dump.json（由 _vjtasks_dump.py 从真实库导出）
   用法： node backend/tests/_vjpanel_render_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'static', 'js', 'vjshi_upload_ui.js');
const DAT = path.join(__dirname, '_vjtasks_dump.json');
const src = fs.readFileSync(SRC, 'utf8');
const payload = JSON.parse(fs.readFileSync(DAT, 'utf8'));

const timers = [];
function fakeEl(init) {
  return Object.assign({ value: '', checked: false, innerHTML: '', textContent: '', style: {}, _h: {},
    addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); },
    querySelector() { return null; }, closest() { return null; }, remove() {} }, init || {});
}

let thenCb = null, catchCb = null;
const box = fakeEl();
const loginChip = fakeEl();
const panelOv = fakeEl({ querySelector: (s) => (s === '#vjPanelBody' ? box : null) });

const sandbox = {
  console, Promise, JSON, Date, Math, Object, Array, String, Number, RegExp, parseInt, parseFloat, isNaN,
  setInterval: () => 0, clearInterval: () => {},
  setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; },
  document: {
    body: { appendChild: () => {}, contains: () => true },
    getElementById: (id) => (id === 'vjLoginChip' ? loginChip : null),
    querySelectorAll: () => [],
    createElement: () => fakeEl({ appendChild: () => {} }),
  },
};
sandbox.window = sandbox;
sandbox.App = {
  _activeTiers: { team: true },
  _escape: (s) => String(s || ''),
  showToast: () => {},
  fetchJSON: function (url) {
    if (url.indexOf('/api/vjshi/tasks') === 0) {
      return { then: function (fn) { thenCb = fn; return { catch: function (c) { catchCb = c; return this; } }; } };
    }
    if (url === '/api/team/permissions') return Promise.resolve({ me: { upload: true }, members: [], is_admin: true });
    if (url === '/api/vjshi/settings') return Promise.resolve({ ok: true, headless: false, precheck: false });
    return Promise.resolve({ ok: true });
  },
};

vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const VJ = sandbox.App.vjshi;
VJ._panelOv = panelOv;

let err = null;
VJ._pollPanel();
if (!thenCb) { console.log('FAIL 未触发 /api/vjshi/tasks 请求'); process.exit(1); }
try {
  thenCb(payload);
} catch (e) {
  err = e;
}

console.log('任务数:', (payload.tasks || []).length);
console.log('面板体长度:', box.innerHTML.length);
console.log('面板体开头:', box.innerHTML.slice(0, 80).replace(/\s+/g, ' '));

if (err) {
  console.log('\nFAIL 渲染抛异常（.catch 会吞掉它 → 永远停在「加载中...」）');
  console.log('  ' + err.name + ': ' + err.message);
  console.log((err.stack || '').split('\n').slice(1, 5).join('\n'));
  process.exit(1);
}
if (box.innerHTML === '加载中...' || !box.innerHTML.length) {
  console.log('\nFAIL 面板体未被渲染（仍是加载中）');
  process.exit(1);
}
console.log('\nRESULT: PASS  面板渲染正常');

// ---------- 登录态展示 ----------
console.log('\n[登录态] 列表面板 chip');
function chipOf(d) { loginChip.innerHTML = ''; loginChip.textContent = ''; VJ._renderLogin(d); return loginChip.innerHTML || loginChip.textContent; }
const c1 = chipOf({ ok: true, logged_in: true, cached: true, age_sec: 90 });
console.log('  已登录(缓存90s):', c1);
const c2 = chipOf({ ok: true, logged_in: false });
console.log('  未登录:', c2);
const c3 = chipOf({ ok: false, busy: true });
console.log('  上传中:', c3);
const c4 = chipOf({ ok: false });
console.log('  检测失败:', c4);

let lf = 0;
if (!/已登录/.test(c1) || !/1 \u5206\u949f\u524d/.test(c1)) { lf++; console.log('  FAIL 已登录态渲染不对'); }
if (!/未登录/.test(c2)) { lf++; console.log('  FAIL 未登录态渲染不对'); }
if (!/上传任务进行中/.test(c3)) { lf++; console.log('  FAIL 上传中态渲染不对'); }
if (!/检测失败/.test(c4)) { lf++; console.log('  FAIL 检测失败态渲染不对'); }

// 缓存优先：checkLogin() 不带 force，不应触发真正检测
const urls = [];
sandbox.App.fetchJSON = function (url) { urls.push(url); return Promise.resolve({ ok: true, logged_in: true }); };
VJ.checkLogin(0).then(function () { return VJ.checkLogin(1); }).then(function () {
  console.log('\n[登录态] 请求 URL:', urls.join(' , '));
  if (urls[0] !== '/api/vjshi/login-status') { lf++; console.log('  FAIL 默认应读缓存（不带 force）'); }
  if (urls[1] !== '/api/vjshi/login-status?force=1') { lf++; console.log('  FAIL 强制检测应带 force=1'); }
  if (lf) { console.log('\nRESULT: FAIL (登录态 ' + lf + ' 项)'); process.exit(1); }
  console.log('\nRESULT: PASS  面板渲染 + 登录态展示均正常');
  process.exit(0);
});
