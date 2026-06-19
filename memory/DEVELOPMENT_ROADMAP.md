# PromptKit 开发路线图 & 竞品分析记忆

> 最后更新: 2026-06-19 v4.0.0-phase12 已打标
> 说明: 此文件作为长期记忆存储，供每次会话自动注入参考


## 一、项目当前状态

- **当前版本**: v4.0.0-phase12 (已打标)
- **最新变更**: AI功能全栈升级 — 翻译引擎(qwen3.5:9b)/优化器(4模式+流式)/自动标签/流式Playground/混合搜索/AI缩略图 + 监测仪表盘 + 前端6大AI交互模块
- **代码规模**: 后端 ~11,000行 | 前端JS ~12,000行 | CSS ~2,500行 | API: 200+ | 表: 30+
- **服务地址**: http://192.168.0.101:8080
- **AI能力**: Ollama 16模型池(ultra/high/medium/fast四级路由)


## 二、Phase 12 新增能力矩阵

| 能力 | Phase12实现 | 评分 |
|------|-----------|------|
| AI翻译 | qwen3.5:9b替代phi3:mini + 批量(5并发) + 质量评估 | ⭐⭐⭐⭐⭐ |
| AI优化器 | 4模式(润色/精简/适配/反向) + 4格式(SDXL/Flux/MJ/DALL-E) + 流式 | ⭐⭐⭐⭐⭐ |
| AI标签 | LLM自动分析→填充metadata + 批量 | ⭐⭐⭐⭐⭐ |
| Playground | SSE流式 + 多轮对话历史 + 多模型对比 | ⭐⭐⭐⭐ |
| 语义搜索 | FTS5+embedding+LLM Rerank三阶段 | ⭐⭐⭐⭐⭐ |
| AI缩略图 | LLM配色分析→Pillow渐变渲染 | ⭐⭐⭐⭐ |
| 监测仪表盘 | CPU/内存/网络/uptime/请求统计 | ⭐⭐⭐⭐ |
| 前端AI交互 | 工具栏/优化器弹窗/右键菜单/编辑AI按钮 | ⭐⭐⭐⭐ |


## 三、竞品调研总结 (2026-06-02 数据，部分已Phase12补全)

### 对标工具分类

| 类别 | 工具 | 核心能力 |
|------|------|---------|
| 企业Prompt管理 | Braintrust / PromptLayer / LangSmith | 版本管理、环境部署、A/B测试、Eval体系 |
| 开源LLMOps | Agenta(MIT) / Langfuse(MIT) / Arize Phoenix | Git式版本管理、可观测性、评估流水线 |
| 轻量Prompt工具 | AI Gist / PromptPal / Instruere | 本地优先、模板变量、Docker部署 |
| 单词卡/SRS | Anki / RemNote / Brainscape / Quizlet | 间隔重复算法、学习模式多样化、卡片模板 |
| 媒体资产DAM | Adobe AEM / Brandfolder / Veritone | 元数据框架、AI自动标签、受控词表 |

### PromptKit 差异化优势（护城河）

1. 🔥 **媒体+提示词+AI一体化** — 竞品均不具备
2. 🔥 **完全离线 + 局域网部署** — Windows原生一键启动
3. 🔥 **16个Ollama模型全栈AI** — 翻译/优化/标签/搜索/缩略图/OCR全部本地化
4. 🔥 **200+ REST API** — 可被外部系统集成
5. 🔥 **PNG含元数据导出 / .pt包系统** — 业界独创


## 四、能力评分矩阵（Phase12后更新）

| 维度 | 评分 | 说明 |
|------|------|------|
| 提示词CRUD | ⭐⭐⭐⭐⭐ | 全覆盖 |
| 分类/标签 | ⭐⭐⭐⭐⭐ | Phase12: AI自动标签+层级 |
| 全文搜索 | ⭐⭐⭐⭐⭐ | FTS5 + LIKE回退 |
| 语义搜索 | ⭐⭐⭐⭐⭐ | embedding + LLM Rerank |
| AI翻译 | ⭐⭐⭐⭐⭐ | qwen3.5:9b + 批量 + 质量评估 |
| AI优化器 | ⭐⭐⭐⭐⭐ | 润色/精简/适配/反向 + 流式 |
| AI缩略图 | ⭐⭐⭐⭐ | LLM配色+Pillow渲染 |
| 媒体管理 | ⭐⭐⭐⭐⭐ | 提示词工具中唯一 |
| 收藏夹/词包 | ⭐⭐⭐⭐ | 多分组+图标 |
| 批量操作 | ⭐⭐⭐⭐⭐ | 批量复制/导出/翻译/优化/标签/缩略图 |
| 数据同步 | ⭐⭐⭐⭐ | .pkb包系统 |
| Playground | ⭐⭐⭐⭐ | SSE流式+多轮+多模型对比 |
| 监测仪表盘 | ⭐⭐⭐⭐ | CPU/内存/网络/健康/请求 |
| 统计仪表盘 | ⭐⭐⭐ | 基础 |
| UI/UX | ⭐⭐⭐⭐⭐ | 深色模式、列数调节、右键菜单、AI工具栏 |
| 移动适配 | ⭐⭐⭐ | 基础可用 |
| 局域网部署 | ⭐⭐⭐⭐⭐ | 原生支持 |
| 一键启动 | ⭐⭐⭐⭐⭐ | 零配置 |

### 仍待补齐（按价值排序）

| 功能 | 重要性 | 说明 |
|------|--------|------|
| **前端Playground流式面板** | P0 | 后端SSE已就绪，前端仍是旧版 |
| **质量评分系统** | P0 | 用户反馈+LLM评估+综合分徽章 |
| **模板变量** | P1 | {{variable}}解析 |
| **SRS间隔复习** | P1 | FSRS-5算法 |
| **A/B测试** | P2 | 多提示词效果对比 |


## 五、推荐版本路线图

```
v4.0.0-phase12 — ✅ 已完成：AI全栈升级 + 监测仪表盘
                     │
                     ▼
v4.1.0-phase13 — 推荐：体验闭环 + 质量系统
   P0: 前端Playground流式面板（SSE接入+多模型切换UI）
   P0: 提示词质量评分（用户👍👎反馈 + LLM评估 + 徽章）
   P1: 前端AI工具栏点击反馈优化（loading态+批量进度条）
                     │
                     ▼
v4.2.0-phase14 — 模板变量 + 学习系统
   P0: 模板变量系统（{{variable}}解析+编辑UI）
   P1: SRS间隔复习（FSRS-5算法+复习队列）
   P2: 复习卡片模式（正面提示词/背面翻译/评分）
                     │
                     ▼
v4.3.0-phase15 — 协作 + 导出扩展
   P1: 局域网分享链接（只读/可编辑）
   P2: 导出PDF报告
   P3: 浏览器扩展增强
```


## 六、产品定位（未变）

**"AI创作者的本地媒体+提示词+AI一体化工作站"**

核心定义：个人/小团队的AI提示词创作、管理、测试、媒体关联的一站式本地工具。


## 七、快速参考命令

```powershell
# 启动服务
cd C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev
python backend/main.py

# 打标
git tag -a v4.x.x-phaseXX -m "description"
git push origin v4.x.x-phaseXX

# 查看版本历史
git log --oneline --decorate -10
git tag -l --sort=-creatordate
```
