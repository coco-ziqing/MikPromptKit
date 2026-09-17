/* 词卡编辑弹窗「视频提示词保存无效」回归测试（v5.50.68）

根因：App.cardModel._normalize() 的字段白名单漏了 content_video / _simple / _detailed，
     而 wordEditor._save() 优先走 App.cardModel.update() → 三个字段在发请求前就被丢掉。

用法： node backend/tests/_wcedit_video_test.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'static', 'js', 'app_card_model.js');
const src = fs.readFileSync(SRC, 'utf8');

const sandbox = {
  console, Promise, JSON, Object, Array, String, Number, RegExp, String,
  setTimeout, clearTimeout,
};
sandbox.window = sandbox;
sandbox.App = {
  fetchJSON: () => Promise.resolve({ ok: true }),
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const CM = sandbox.App.cardModel;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}

console.log('[1] 传入视频提示词三档 → 必须保留');
const p1 = CM._normalize({
  name: '测试卡', content: '图片提示词',
  content_video: '视频普通档', content_video_simple: '视频简易档', content_video_detailed: '视频详细档',
});
console.log('   payload keys(内容层):', Object.keys(p1).filter(k => k.indexOf('content') === 0).join(', '));
ok('content_video 未被丢弃', p1.content_video === '视频普通档');
ok('content_video_simple 未被丢弃', p1.content_video_simple === '视频简易档');
ok('content_video_detailed 未被丢弃', p1.content_video_detailed === '视频详细档');

console.log('[2] 清空视频提示词 → 必须传空串（允许用户删除）');
const p2 = CM._normalize({ name: 'x', content: 'c', content_video: '', content_video_simple: '', content_video_detailed: '' });
ok('空串被保留为 ""', p2.content_video === '' && p2.content_video_simple === '' && p2.content_video_detailed === '');

console.log('[3] 未传视频字段 → 不应出现在 payload（避免覆盖已有值）');
const p3 = CM._normalize({ name: 'x', content: 'c' });
ok('未传则不包含 content_video', !('content_video' in p3));
ok('未传则不包含 content_video_simple', !('content_video_simple' in p3));
ok('未传则不包含 content_video_detailed', !('content_video_detailed' in p3));

console.log('[4] 图片三档未受影响（回归）');
const p4 = CM._normalize({ name: 'x', content: 'c', content_simple: 's', content_detailed: 'd' });
ok('content_simple 正常', p4.content_simple === 's');
ok('content_detailed 正常', p4.content_detailed === 'd');
ok('content 正常', p4.content === 'c');

console.log('\nRESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '  (pass=' + pass + ' fail=' + fail + ')');
process.exit(fail === 0 ? 0 : 1);
