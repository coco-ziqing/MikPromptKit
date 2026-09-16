/* v5.50.59 投稿前质检开关 — 前端逻辑验证（Node + vm，无浏览器、无凭据）
   做法：在沙箱里加载真实的 vjshi_upload_ui.js，用桩件替代 App/DOM，
        断言「开关关闭后不再质检、不再拦截提交」。
   用法： node backend/tests/_vjqa_ui_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'static', 'js', 'vjshi_upload_ui.js');
const src = fs.readFileSync(SRC, 'utf8');

const calls = [];
const toasts = [];

function fakeNode(extra) {
  return Object.assign({ style: {}, innerHTML: '', textContent: '', value: '', checked: false }, extra || {});
}

const sandbox = {
  console,
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  Promise,
  JSON,
  document: {
    body: { appendChild: () => {} },
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeNode({ querySelector: () => null, appendChild: () => {}, remove: () => {} }),
  },
};
sandbox.window = sandbox;
sandbox.App = {
  _activeTiers: { team: true },
  _escape: (s) => String(s || ''),
  showToast: (m, t) => toasts.push([m, t]),
  fetchJSON: function (url, opts) {
    calls.push([url, opts && opts.body ? JSON.parse(opts.body) : null, opts && opts.method]);
    if (url === '/api/team/permissions') return Promise.resolve({ me: { upload: true }, members: [], is_admin: true });
    if (url === '/api/vjshi/settings') return Promise.resolve({ ok: true, headless: false, precheck: false });
    if (url === '/api/vjshi/precheck-video') return Promise.resolve({ ok: true, metrics: { duration: 5, width: 1280, height: 720, codec: 'h264', size_mb: 1 }, issues: [] });
    if (url === '/api/vjshi/tasks') return Promise.resolve({ ok: true });
    if (url === '/api/vjshi/batch') return Promise.resolve({ ok: true, count: 2 });
    return Promise.resolve({ ok: true });
  },
};

vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const VJ = sandbox.App.vjshi;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}
const countOf = (u) => calls.filter((c) => c[0] === u).length;

(async function () {
  console.log('[1] 默认状态');
  ok('默认关闭质检（未读到开启时不拦截）', VJ.precheckOn() === false);
  await new Promise((r) => setTimeout(r, 10));
  ok('后端返回 precheck=false 时，加载完仍为关', VJ.precheckOn() === false);

  console.log('[2] 关闭开关会落库 + 刷新 UI');
  calls.length = 0;
  VJ.setPrecheck(false);
  await new Promise((r) => setTimeout(r, 10));
  const put = calls.filter((c) => c[0] === '/api/vjshi/settings' && c[2] === 'PUT');
  ok('发出 PUT /api/vjshi/settings', put.length === 1);
  ok('PUT body 为 {precheck:false}', !!put[0] && put[0][1] && put[0][1].precheck === false);
  ok('precheckOn() 变为 false', VJ.precheckOn() === false);

  console.log('[3] 关闭后：单条投稿弹窗不再自动质检、不再拦截');
  calls.length = 0;
  const box = fakeNode();
  const ov = { _vjQaPass: true, querySelector: (s) => (s === '#vjQaBox' ? box : null) };
  await VJ._runQa(ov, 'demo.mp4');
  ok('未调用 /api/vjshi/precheck-video', countOf('/api/vjshi/precheck-video') === 0);
  ok('弹窗显示「质检已关闭」', box.innerHTML.indexOf('质检已关闭') >= 0);
  ok('_vjQaPass 被清空（不拦截）', ov._vjQaPass === null);

  toasts.length = 0;
  VJ.openPanel = () => {};
  const ovSubmit = {
    _vjQaPass: false,
    remove: () => {},
    querySelector: (s) => ({
      '#vjTitle': fakeNode({ value: '光厂投稿测试标题文案' }),
      '#vjKeywords': fakeNode({ value: 'a b c d e' }),
      '#vjDesc': fakeNode({ value: '说明' }),
      '#vjCategory': fakeNode({ value: '创意' }),
      '#vjPrice': fakeNode({ value: '10' }),
      '#vjIsAi': fakeNode({ checked: true }),
    }[s] || null),
  };
  const btn = { closest: () => ovSubmit, disabled: false, textContent: '' };
  calls.length = 0;
  await VJ.submit(1, 1, 'demo.mp4', btn);
  ok('质检关闭时即使 _vjQaPass=false 也放行入队', countOf('/api/vjshi/tasks') === 1);
  ok('未弹出拦截 toast', toasts.filter((t) => String(t[0]).indexOf('质检不通过') >= 0).length === 0);

  console.log('[4] 重新开启：恢复自动质检');
  calls.length = 0;
  VJ.setPrecheck(true);
  await new Promise((r) => setTimeout(r, 10));
  ok('precheckOn() 恢复 true', VJ.precheckOn() === true);
  const box2 = fakeNode();
  const ov2 = { _vjQaPass: null, querySelector: (s) => (s === '#vjQaBox' ? box2 : null) };
  await VJ._runQa(ov2, 'demo.mp4');
  ok('重新调用 /api/vjshi/precheck-video', countOf('/api/vjshi/precheck-video') === 1);
  ok('质检通过 → _vjQaPass=true', ov2._vjQaPass === true);

  calls.length = 0;
  toasts.length = 0;
  await VJ.submit(1, 1, 'demo.mp4', { closest: () => ({ _vjQaPass: false, querySelector: () => null }), disabled: false, textContent: '' });
  ok('质检开启 + 不通过 → 拦截入队', countOf('/api/vjshi/tasks') === 0);
  ok('拦截 toast 已提示', toasts.filter((t) => String(t[0]).indexOf('质检不通过') >= 0).length === 1);

  console.log('[5] 批量入队：关闭时跳过逐条预检');
  VJ._batchItems = [
    { video_file: 'a.mp4', card_id: 1, gen_task_id: 1, card_name: 'A' },
    { video_file: 'b.mp4', card_id: 2, gen_task_id: 2, card_name: 'B' },
  ];
  VJ._batchOv = {
    querySelectorAll: (s) => (s === '.vjBChk' ? [{ checked: true, getAttribute: () => '0' }, { checked: true, getAttribute: () => '1' }] : []),
    querySelector: (s) => (s === '#vjBPrice' ? fakeNode({ value: '10' }) : (s === '.btn-primary' ? fakeNode() : null)),
    remove: () => {},
  };
  VJ.setPrecheck(false);
  calls.length = 0;
  await VJ.batchSubmit();
  ok('关闭时 0 次 precheck-video', countOf('/api/vjshi/precheck-video') === 0);
  ok('关闭时仍成功调用 /api/vjshi/batch', countOf('/api/vjshi/batch') === 1);

  calls.length = 0;
  VJ.setPrecheck(true);
  await VJ.batchSubmit();
  ok('开启时恢复逐条预检（2 条）', countOf('/api/vjshi/precheck-video') === 2);
  ok('开启时同样调用 /api/vjshi/batch', countOf('/api/vjshi/batch') === 1);

  console.log('\nRESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '  (pass=' + pass + ' fail=' + fail + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
