/**
 * pk_common.js — PromptKit 前端公共底座 v1.0 (继续)
 * 接续上方 PK 命名空间，扩充 PK.cards 卡片数据层
 *
 * ── PK.cards 统一卡片数据契约 ──
 * 目的：wc_bridge/composer_wc_bridge/scene_bridge 不再各自探测 word_card 表结构，
 *       统一通过此层获取标准化的卡片数据。
 *
 * 使用：
 *   PK.cards.get(id)          单张卡片
 *   PK.cards.groupTree()      嵌套分组树
 *   PK.cards.byGroup(gid)     分组下卡片列表
 *   PK.cards.search(q)        搜索
 *   PK.cards.groups()         所有分组
 *
 * 后端 API 版本匹配 word_cards.py 路由。
 */
(function() {
  'use strict';
  var PK = window.PK;
  if (!PK || PK.cards) return;  // 已有

  PK.cards = {};

  /* ── 分组树 ─ */
  var _groupTreeCache = null;
  var _groupsFlat = null;

  PK.cards.groupTree = function(force) {
    if (!force && _groupTreeCache) return Promise.resolve(_groupTreeCache);
    return PK.api('/api/v4/word-cards/groups?nested=1').then(function(d) {
      _groupTreeCache = d.tree || [];
      _groupsFlat = d.groups || [];
      return _groupTreeCache;
    });
  };

  PK.cards.groups = function(force) {
    if (!force && _groupsFlat) return Promise.resolve(_groupsFlat);
    return PK.cards.groupTree(force).then(function() { return _groupsFlat; });
  };

  /* ── 单张卡片 ─ */
  var _cardCache = {};

  PK.cards.get = function(id, force) {
    if (!force && _cardCache[id]) return Promise.resolve(_cardCache[id]);
    return PK.api('/api/v4/word-cards/' + id).then(function(d) {
      _cardCache[id] = d.card || d;
      return _cardCache[id];
    }).catch(function(e) {
      if (e.status === 404) return null;
      throw e;
    });
  };

  /* ── 分组下卡片列表 ─ */
  PK.cards.byGroup = function(gid, params) {
    params = params || {};
    var q = '/api/v4/word-cards?group_id=' + gid +
      (params.page_size ? '&page_size=' + params.page_size : '&page_size=100') +
      (params.offset ? '&offset=' + params.offset : '&offset=0') +
      (params.sort ? '&sort=' + params.sort : '');
    return PK.api(q);
  };

  /* ── 搜索 ─ */
  PK.cards.search = function(q, opts) {
    opts = opts || {};
    return PK.api('/api/v4/word-cards/search?q=' + encodeURIComponent(q) +
      (opts.group_id ? '&group_id=' + opts.group_id : '') +
      (opts.limit ? '&page_size=' + opts.limit : ''));
  };

  /* ── 刷新缓存 ─ */
  PK.cards.invalidateCache = function(cardId) {
    _groupTreeCache = null;
    _groupsFlat = null;
    if (cardId) delete _cardCache[cardId];
    else _cardCache = {};
  };

  console.log('[PK.Cards] v1 loaded');
})();
