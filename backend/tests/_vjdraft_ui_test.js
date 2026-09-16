/* v5.50.60 投稿弹窗草稿保留 — 前端逻辑验证（Node + vm，无浏览器）
   覆盖：草稿写入 / 重开恢复 / 丢弃 / 提交成功后清草稿。
   用法： node backend/tests/_vjdraft_ui_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'static', 'js', 'vjshi_upload_ui.js');
const src = fs.readFileSync(SRC, 'utf8');

const store = {};
const calls = [];
const toasts = [];

function fakeEl(init) {
  const o = Object.assign({
    value: '', checked: false, innerHTML: '', textContent: '', style: {}, _h: {},
    addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); },
    fire(t) { (this._h[t] || []).forEach((f) => f()); },
    querySelector() { return null; }, closest() { return null; }, remove() {},
  }, init || {});
  return o;
}

const SEL = ['#vjTitle', '#vjKeywords', '#vjDesc', '#vjCategory', '#vjPrice', '#vjIsAi', '#vjDraftHint'];
function makeOv(vals) {
  const nodes = {};
  SEL.forEach((s) => { nodes[s] = fakeEl(); });
  Object.keys(vals || {}).forEach((k) => { nodes[k].value = vals[k]; });
  return {
    _vjDraftKey: undefined, _vjQaPass: null, rule: '',
    querySelector: (s) => nodes[s] || null,
    remove() {},
  };
}

const sandbox = {
  console, Promise, JSON, Date,
  setInterval: () => 0, clearInterval: () => {}, setTimeout: (fn) => { fn(); return 0; },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  document: {
    body: { appendChild: () => {}, contains: () => true },
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeEl({ appendChild: () => {} }),
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
    if (url === '/api/vjshi/settings') return Promise.resolve({ ok: true, headless: false, precheck: true });
    if (url === '/api/vjshi/tasks') return Promise.resolve({ ok: true });
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
const KEY = 'vjDraft:7:42:demo.mp4';

(async function () {
  console.log('[1] 草稿 key 规则');
  ok('key 含 genTaskId/cardId/videoFile', VJ._draftKey(7, 42, 'demo.mp4') === KEY);

  console.log('[2] 编辑后失焦(change) → 立即落盘');
  const ov1 = makeOv({ '#vjDesc': '原简介', '#vjCategory': '创意', '#vjPrice': '10' });
  VJ._bindDraftAutosave(ov1, 7, 42, 'demo.mp4');
  ov1.querySelector('#vjDesc').value = '我改过的简介';
  ov1.querySelector('#vjCategory').value = '自然风光';
  ov1.querySelector('#vjDesc').fire('change');
  ok('localStorage 已写入草稿', !!store[KEY]);
  const saved = JSON.parse(store[KEY] || '{}');
  ok('草稿内容 = 编辑后的值', saved.description === '我改过的简介' && saved.category === '自然风光');
  ok('草稿带时间戳', typeof saved.ts === 'number' && saved.ts > 0);
  ok('标题/关键词已不入草稿（改由平台 AI 推荐）', !('title' in saved) && !('keywords' in saved));

  console.log('[3] 误触关闭后重开 → 恢复编辑内容');
  const ov2 = makeOv({ '#vjDesc': '后端 meta 默认简介', '#vjCategory': '创意' });
  VJ._applyDraft(ov2, 7, 42, 'demo.mp4');
  ok('简介被草稿覆盖', ov2.querySelector('#vjDesc').value === '我改过的简介');
  ok('分类被草稿覆盖', ov2.querySelector('#vjCategory').value === '自然风光');
  const hint = ov2.querySelector('#vjDraftHint');
  ok('显示「已恢复」提示条', hint.style.display === 'block' && hint.innerHTML.indexOf('已恢复') >= 0);
  ok('提示条内带丢弃按钮', hint.innerHTML.indexOf('dropDraft') >= 0);

  console.log('[4] 无草稿时不影响 meta 默认值');
  const ov3 = makeOv({});
  VJ._applyDraft(ov3, 999, 999, 'none.mp4');
  ok('无草稿 → 提示条保持隐藏', ov3.querySelector('#vjDraftHint').style.display !== 'block');
  ok('无草稿 → 不写入新 key', !store['vjDraft:999:999:none.mp4']);

  console.log('[5] 丢弃草稿');
  VJ.dropDraft({ closest: () => ov2 });
  ok('localStorage 草稿已删', !store[KEY]);
  ok('提示条已隐藏', ov2.querySelector('#vjDraftHint').style.display === 'none');

  console.log('[6] 提交成功后自动清草稿');
  VJ._writeDraft(KEY, { title: 'x' });
  ok('前置：草稿已存在', !!store[KEY]);
  VJ.openPanel = () => {};
  const ovSubmit = makeOv({
    '#vjDesc': '说明', '#vjCategory': '创意', '#vjPrice': '10',
  });
  ovSubmit._vjQaPass = true;
  ovSubmit.querySelector('#vjIsAi').checked = true;
  await VJ.submit(7, 42, 'demo.mp4', { closest: () => ovSubmit, disabled: false, textContent: '' });
  ok('提交成功 → 草稿被清除', !store[KEY]);

  console.log('[7] AI 优化简介后草稿立即更新（v5.50.65）');
  const ovAI = makeOv({ '#vjDesc': '旧简介', '#vjCategory': '创意', '#vjPrice': '10' });
  VJ._bindDraftAutosave(ovAI, 7, 42, 'demo.mp4');
  const _origFetch = sandbox.App.fetchJSON;
  sandbox.App.fetchJSON = function (url) {
    if (url === '/api/vjshi/llm-description') return Promise.resolve({ ok: true, description: 'AI 优化后的简介内容' });
    return _origFetch.apply(this, arguments);
  };
  await VJ.llmDesc({ closest: () => ovAI, disabled: false, textContent: '' });
  const savedAI = JSON.parse(store[KEY] || '{}');
  ok('AI 结果已写入草稿', savedAI.description === 'AI 优化后的简介内容', JSON.stringify(savedAI));
  const ovRe = makeOv({ '#vjDesc': '后端 meta 默认简介' });
  VJ._applyDraft(ovRe, 7, 42, 'demo.mp4');
  ok('关窗重开后恢复 AI 优化结果', ovRe.querySelector('#vjDesc').value === 'AI 优化后的简介内容');
  sandbox.App.fetchJSON = _origFetch;

  console.log('\nRESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '  (pass=' + pass + ' fail=' + fail + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
