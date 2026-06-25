# PromptKit v4.4.0 工程全量快照 (2026-06-24 02:57)
## 技术栈
- 后端: Python FastAPI + Uvicorn + SQLite WAL/FTS5
- 前端: Vue 3 + Bootstrap 5 + Vanilla JS SPA (22模块 ~15,000行)
- AI: Ollama 16模型池 + sentence-transformers + LLM Rerank
- 版本: v4.4.0-phase17-skills-hexa

## 规模
- 总文件: 1,368
- 后端: 25 API模块 / 200+ 端点
- 前端: 22 JS模块 / CSS 2,600+行
- 数据库: 30+表 / 694词卡 / 151旧卡 / 233词库资产
- 技能: 6/6 ready (workspace)

## 分层
- 后端 API 110文件 + 数据库 105文件 + 前端 48文件 + 公共 18 + 基础设施 17

## 审查修复记录
- database.py: safe_fetch_one/safe_count/safe_count_dict 安全取数
- main.py: 6处 fetchone→safe_count 替换
- word_cards.py: 8处 fetchone→safe_fetch_one 替换
- app_core.js: resp.json() 加 ok 守卫
