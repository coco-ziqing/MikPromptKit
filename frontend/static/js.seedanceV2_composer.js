// ================================================================
// Seedance V2 多镜头结构化组装器（修复版 v1.0）
// Bugfix: 点击「+」按钮重复创建两个拓展单元 →已过滤空字段数据
// ================================================================

(function() {
    'use strict';

    App.seedanceV2 = {
        _F:{'camera_move':'运镜','subject':'主体','scene_desc':'场景','composition':'构图','lighting':'光影','action':'动作','focal_length':'焦段','texture':'质感','speed':'速率','emotion':'情绪','color_grade':'调色','weather':'天气','particles':'粒子','perspective':'视角','depth_of_field':'景深','filter':'滤镜','natural_force':'外力','environment_detail':'环境','film_flaw':'瑕疵','fantasy_physics':'奇幻'},
        _EF:['action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics'],
        projects: [], currentProjectId: null, currentProject: null,
        scenes: [], libraries: [], cardCache: {},
        activeField: null, activeSceneId: null, activePickerLibId: null,
        moreLibsOpen: false, dirty: false, outputText: '', outputJson: null
