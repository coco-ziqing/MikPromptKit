/**
 * PromptKit 术语字典 — 协作共创理念统一映射表
 *
 * 设计哲学：应用 = 朋友 + 得力助手，服务于用户、服务于创作
 * 创作者是主体，术语绝不能让用户感到被支配/管理/监视/评判
 *
 * 使用规范：
 *   - 所有 JS 模块的显示文案从这里取，禁止自建角色/状态字典
 *   - key 一律用 API/DB 枚举原值（admin/owner/editor/draft/in_review…）
 *   - 查不到时 fallback 原值，永不白屏
 *   - 新词首次出现处附带 hover tooltip 职责说明
 */
(function () {
  'use strict';

  // ============ 角色映射（role → label, tip, color） ============
  var ROLE = {
    admin:       { label: '主理人', tip: '打理团队空间秩序，邀请伙伴、调整分工',              color: '#7c3aed' },
    owner:       { label: '发起人', tip: '项目的创建者，发起共创并提供大方向',                color: '#6366f1' },
    editor:      { label: '共创者', tip: '参与创作与协作，为作品出力',                        color: '#10b981' },
    reviewer:    { label: '把关人', tip: '为作品质量把关，给出采纳与打磨建议',                color: '#f59e0b' },
    viewer:      { label: '鉴赏者', tip: '浏览作品、感受与发现灵感',                          color: '#94a3b8' }
  };

  // ============ 审核/反馈流映射（review_status → label, tip, color） ============
  var REVIEW = {
    draft:       { label: '创作中',   tip: '正在精雕细琢，可邀请伙伴反馈',                     color: '#94a3b8' },
    in_review:   { label: '共审中',   tip: '伙伴们在帮你审视，期待反馈',                       color: '#f59e0b' },
    approved:    { label: '已定稿',   tip: '已被采纳，可作为最终版本使用',                     color: '#10b981' },
    rejected:    { label: '待打磨',   tip: '收到了打磨建议，按思路优化后再次提交',             color: '#ef4444' }
  };

  // ============ 审核动作映射（action → label） ============
  var REVIEW_ACTION = {
    submit:      { label: '邀请反馈', tip: '将作品发送给把关人，邀请伙伴给打磨建议' },
    approve:     { label: '采纳',     tip: '这个版本很好，可以作为定稿版本了' },
    reject:      { label: '建议打磨', tip: '给一些改进思路，完善后再看看' },
    comment:     { label: '留言',     tip: '' }
  };

  // ============ 在线状态映射（presence → label, color, dot） ============
  var PRESENCE = {
    online:  { label: '在线',           color: '#10b981', dot: '🟢' },
    idle:    { label: '小憩',           color: '#f59e0b', dot: '🟡' },
    away:    { label: '暂离',           color: '#94a3b8', dot: '⚪' },
    busy:    { label: '专注中',         color: '#6366f1', dot: '🔵' },
    offline: { label: '离线',           color: '#64748b', dot: '⚫' }
  };

  // ============ 导航/页面级术语 ============
  var NAV_TERMS = {
    userMgmtTitle:      { label: '团队空间', tip: '一同创作的个人与伙伴们' },
    addUserBtn:         { label: '＋ 邀请伙伴', tip: '邀请新的创作者加入这个空间' },
    searchPlaceholder:  { label: '搜索伙伴...', tip: '' },
    roleFilter_admin:   { label: '主理人', tip: ROLE.admin.tip },
    roleFilter_editor:  { label: '共创者', tip: ROLE.editor.tip },
    roleFilter_viewer:  { label: '鉴赏者', tip: ROLE.viewer.tip },
    resumeCollabBtn:    { label: '恢复协作', tip: '' },
    pauseCollabBtn:     { label: '暂停协作', tip: '暂时中止与该伙伴的协作关系' },
    activityLog:        { label: '足迹回放', tip: '你的创作足迹，透明呈现一切活动' },
    exportLog:          { label: '⬇ 导出足迹归档', tip: '将活动记录导出为 CSV 文件' },
    auditTab:           { label: '🛡 审计事件', tip: '关键安全事件记录（仅主理人可见）' },
    actionsTab:         { label: '活动记录', tip: '' },
    sessionsTab:        { label: '设备连接', tip: '当前登录的设备与时段' },
    myFootprint:        { label: '我的足迹', tip: '一览自己的创作与交互足迹' },
    workspaceHome:      { label: '我的工作台', tip: '' },
    membersTitle:       { label: '共创团队', tip: '与伙伴们一同创作' },
    collabRecord:       { label: '共创记录', tip: '采纳与打磨记录的完整回顾' },
    inviteFeedbackBtn:  { label: '邀请反馈', tip: REVIEW_ACTION.submit.tip },
    adoptBtn:           { label: '采纳',     tip: REVIEW_ACTION.approve.tip },
    polishBtn:          { label: '建议打磨', tip: REVIEW_ACTION.reject.tip },
    projectAssetTitle:  { label: '作品资产', tip: '所有项目的美术与创作素材' },
    wordCardTitle:      { label: '我的词库', tip: '个人提示词词卡收藏与创作' },
    projectWorkshop:    { label: '项目工坊', tip: 'AIGC 影片从构思到成片的创作空间' },
    settingsTab_manual: { label: '整理分组', tip: '自由归类和排列你的分组' },
    notifCenter:       { label: '动态', tip: '与你相关的更新与提醒' },
    cardLibrary:       { label: '词库', tip: '' },
    assetModuleEdit:   { label: '模块配置', tip: '增减此项目的资产工作区' },
  };

  // ============ 用户状态 ============
  var USER_STATUS = {
    active:    { label: '可协作', tip: '' },
    inactive:  { label: '已暂停', tip: '' }
  };

  // ============ 管理端 breadcrumb（仅主理人视图） ============
  var ADMIN_BREADCRUMB = {
    loginAuth:      { label: '登录认证', icon: '🔑' },
    userAdmin:      { label: '团队空间', icon: '👥' },   // 审计日志目录里原"用户管理"→团队空间
    project:        { label: '项目工坊', icon: '📁' },
    asset:          { label: '作品资产', icon: '🖼' },
    prompt:         { label: '词卡',     icon: '📝' },
    system:         { label: '系统',     icon: '⚙️' }
  };

  // ============ 全局 toast 文案映射 ============
  var TOAST = {
    submitOk:     '已邀请反馈 ✨',
    approveOk:    '已采纳 ✨',
    rejectOk:     '已发送打磨建议',
    memberAdded:  '已邀请伙伴加入',
    memberRemoved:'已移出协作',
    collabPaused: '协作已暂停',
    collabResumed:'协作已恢复',
    onlyAdmin:    '这一区由主理人打理，如需访问可请主理人开通',
    saveOk:       '保存完成',
    deleteOk:     '已删除',
    uploadOk:     '上传完成',
    updateOk:     '更新完成',
    createOk:     '创建完成'
  };

  // ============ toast 去负向化映射（catch/then 块统一调用） ============
  // 用法: showToast(PK_TERMS.toastText('save','文件过大'), 'error')
  // 核心原则: "失败"→"未完成"，给出口不指责
  function toastText(action, detail) {
    var map = {
      create:   '创建未完成',
      save:     '保存未完成，稍后再试',
      delete:   '未能删除，请稍后再试',
      load:     '加载未完成，点击重试',
      upload:   '上传未完成',
      download: '下载未完成',
      export:   '导出未完成',
      import:   '导入未完成',
      network:  '网络不太稳定，请稍后重试',
      unknown:  '遇到意外情况，请稍后再试',
      rollback: '回滚未完成',
      restore:  '还原未完成',
      generate: '生成未完成',
      link:     '暂未关联成功',
      update:   '更新未完成',
      timeout:  '响应超时，正在重试...',
      request:  '请求未响应，请稍后重试',
      remove:   '暂未移除',
      translate:'翻译未完成',
      ai:       'AI 暂未完成分析',
      parse:    '未能解析，请检查格式',
      copy:     '复制未完成',
      search:   '搜索暂未完成',
      general:  '遇到问题，请稍后再试'
    };
    var base = map[action] || (action + '未完成');
    return detail ? (base + '：' + detail) : base;
  }

  // ============ prompt / confirm 文案 ============
  var CONFIRM = {
    pauseCollab:  '确定暂停与这位伙伴的协作？暂停后 TA 仍可在团队空间中看到大家的作品，但无法新建或修改。',
    resumeCollab: '确定恢复与这位伙伴的协作？',
    deleteAccount:'将注销「{name}」的账户并保留其创作归档，确认？',
    deleteMember: '确定将这位伙伴移出共创团队？'
  };

  // ============ 角色选择器 options（用于表单下拉） ============
  function roleOptions(selected) {
    var keys = ['admin', 'editor', 'viewer'];
    return keys.map(function (k) {
      return '<option value="' + k + '"' + (selected === k ? ' selected' : '') + '>' + ROLE[k].label + '</option>';
    }).join('');
  }

  // 导出（大写 key 主 + 小写别名兼容各模块 _t() 直接取；函数名不冲突的才加别名）
  window.PK_TERMS = {
    ROLE: ROLE,
    REVIEW: REVIEW,
    REVIEW_ACTION: REVIEW_ACTION,
    PRESENCE: PRESENCE,
    NAV: NAV_TERMS, nav: NAV_TERMS,
    USER_STATUS: USER_STATUS,
    ADMIN_CAT: ADMIN_BREADCRUMB,
    TOAST: TOAST, toast: TOAST,
    CONFIRM: CONFIRM, confirm: CONFIRM,
    roleOptions: roleOptions,
    toastText: toastText,

    // fallback 安全方法：取不到时返回原值
    role: function (key) { var r = ROLE[key]; return r ? r.label : (key || ''); },
    reviewStatus: function (key) { var r = REVIEW[key]; return r ? r : (REVIEW.draft || { label: key, tip: '', color: '#94a3b8' }); },
    reviewAction: function (key) { var r = REVIEW_ACTION[key]; return r ? r.label : (key || ''); },
    presence: function (key) {
      var p = PRESENCE[key];
      return p || PRESENCE.offline || { label: key || '离线', color: '#64748b', dot: '⚫' };
    },
    userStatus: function (active) { return active ? USER_STATUS.active.label : USER_STATUS.inactive.label; },
    roleColor: function (key) { var r = ROLE[key]; return r ? r.color : '#64748b'; },

    // tooltip 生成
    tip: function (text, explain) {
      if (!explain) return text;
      return '<span title="' + explain + '" style="cursor:help;border-bottom:1px dotted var(--text-muted);">' + text + '</span>';
    }
  };

  console.log('[PK_TERMS] 协作共创术语字典已加载');
})();
