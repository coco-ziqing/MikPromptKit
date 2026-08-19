// 咪卡灵感收藏助手 — 公共逻辑（popup + 悬浮面板共用，保持双端一致）
// 页面可收藏性识别（防呆：主页/列表/搜索页多词卡禁止收藏）

var MIKA_LIST_HINTS = ['/search', '/explore', '/tags', '/tag/', '/category', '/discover', '/feed',
  '/collection', '/gallery', '/browse', '/list', '/index', '/models', '/posts', '/ideas',
  '/pins', '/artworks', '/works', '/videos', '/page', '/trending', '/popular', '/rank', '/top'];

var MIKA_DETAIL_HINTS = ['imageinfo', 'model', 'detail', 'post', 'artwork', 'pin', 'video', 'photo',
  'note', 'work', 'item', 'story', 'article', 'info', 'design', 'template', 'avatar', 'theme'];

function isCollectableUrl(url) {
  try {
    var u = new URL(url);
    var segs = u.pathname.split('/').filter(Boolean);
    // 站点主页/根路径：包含大量词卡
    if (segs.length === 0) return { ok: false, reason: '这是站点主页，包含大量词卡，请打开单个作品详情页再收藏' };
    var low = segs.map(function (s) { return s.toLowerCase(); });
    for (var i = 0; i < low.length; i++) {
      // 详情段 + 后跟 ID → 详情页，直接放行（如 /imageinfo/a498...、/model/123、/pin/456）
      if (MIKA_DETAIL_HINTS.indexOf(low[i]) >= 0 && i < low.length - 1) return { ok: true, reason: '' };
      // 详情段但无内容 ID（如裸 /imageinfo）→ 视为无效/列表，拦截
      if (MIKA_DETAIL_HINTS.indexOf(low[i]) >= 0) {
        return { ok: false, reason: '详情页缺少内容 ID，请打开单个作品页面再收藏' };
      }
      // search/tag 段后跟任何内容都是搜索/标签聚合页（如 /search/pins、/tag/xx）
      if (low[i] === 'search' || low[i] === 'tag') {
        return { ok: false, reason: '这是搜索/标签聚合页（包含多个词卡），请打开单个作品详情页再收藏' };
      }
      if (MIKA_LIST_HINTS.indexOf('/' + low[i]) >= 0) {
        // 分页数字段：page/2 仍视为列表
        if (low[i] === 'page' && low[i + 1] && /^\d+$/.test(low[i + 1])) {
          return { ok: false, reason: '这是分页/列表页，不适合收藏，请打开单个作品详情页' };
        }
        // 命中段后还有内容段 → 详情页（如 /explore/abc123、/models/987654、/works/xyz）
        if (i < low.length - 1) return { ok: true, reason: '' };
        return { ok: false, reason: '这是列表/搜索/聚合页（包含多个词卡），请进入单个作品详情页再收藏' };
      }
    }
    // 分页参数且无具体内容路径 → 列表页
    var q = (u.search || '').toLowerCase();
    if (low.length <= 1 && (q.indexOf('page=') >= 0 || q.indexOf('p=') >= 0 || q.indexOf('keyword=') >= 0 || q.indexOf('q=') >= 0)) {
      return { ok: false, reason: '这是分页/搜索列表页，不适合收藏，请打开单个作品详情页' };
    }
    return { ok: true, reason: '' };
  } catch (e) {
    return { ok: true, reason: '' }; // 解析失败保守放行
  }
}
