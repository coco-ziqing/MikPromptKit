# PromptKit v5.0 — 原子化提示词工业化平台 升级规划
# 创建时间: 2026-06-24 11:07 UTC+8
# 基线版本: v4.2.0-phase14-arch → 目标: v5.0.0-phase16-atom

## 版本号路线
# v4.2.0-phase14-arch (当前) → v5.0.0-phase16-atom (3跳版本)
# 阶段: Phase15 原子集成 → Phase16 前端编辑器 → Phase17 资产溯源

## Phase15: 后端原子引擎加固 + 词卡分组归档 (2026-06-24 本周)
### P15.1 — AI提取器升级 (优先级 P0)
  - [ ] atoms.py 补充 OCR 图片文字提取端点 POST /api/v4/atoms/extract-from-image
  - [ ] atoms.py 补充文本自动拆解端点 POST /api/v4/atoms/decompose/text
  - [ ] atoms.py 补充归档分组端点 POST /api/v4/atoms/archive-to-group (原子→词卡分组)
  - [ ] 新增 api/atoms_import.py — 批量导入中间件 (CSV/JSON/TXT)
  - [ ] API 测试脚本 tools/test_atoms_api.py

### P15.2 — 原子→词卡双向桥接 (优先级 P0)
  - [ ] atom_decompose → word_card 自动转换 (create_card_from_atom)
  - [ ] 原子类型 → 词卡模块映射表 (creative→style, constraint→negative 等)
  - [ ] word_card_group 支持 atom 原子分组 (group_type='atom')
  - [ ] 幂等迁移: atom_decompose.parent_group_id → word_card_group 关联

### P15.3 — 资产溯源统计 (优先级 P1)
  - [ ] atom_stats 使用频率更新触发器 (复制/导出/组装时 +1)
  - [ ] GET /api/v4/atoms/stats 统计 API (热门Top10/跨模型通用/死码清理)
  - [ ] migrate_atom_tables.py 补 stats 索引优化

## Phase16: WC24 前端编辑器 (2026-06-25~26)
### P16.1 — 原子编辑器基础 (优先级 P0)
  - [ ] 新建 atom_editor.js 模块 — 原子列表+CRUD+筛选
  - [ ] 集成到 app_core.js 侧边栏 (新增 "⚛ 原子引擎" 入口)
  - [ ] index.html 添加 atom_editor.js 加载

### P16.2 — AI拆解面板 (优先级 P0)
  - [ ] 文本输入框 + 媒体类型选择 + "AI拆解"按钮
  - [ ] SSE 进度条 (批量拆解实时进度)
  - [ ] 结果原子卡片 → 拖拽归档到分组

### P16.3 — 组合模板编辑器 (优先级 P1)
  - [ ] 从原子库拖拽到组装器 (复用种子舞 composer 引擎)
  - [ ] 锁定原子 + AI变异生成多版本

## Phase17: 全链路贯通 + 资产溯源看板 (2026-06-27)
### P17.1 — 资产统计可视化 (优先级 P1)
  - [ ] 使用统计面板 (Top10热度榜/死码检测/通用性矩阵)
  - [ ] 依赖链图谱 (被哪些模板引用)
  - [ ] 版本历史时间轴

### P17.2 — 跨模型适配增强 (优先级 P2)
  - [ ] atom_decompose 支持模型 engine 参数
  - [ ] atom_variation → 多模型语法转换预览
  - [ ] 模型适配规则配置界面

## 打包与部署
### P15 close — Git tag + 版本号升级
  - [ ] MEMORY.md 更新
  - [ ] index.html 版本号升级
  - [ ] Git tag v5.0.0-phase15-atom-engine
