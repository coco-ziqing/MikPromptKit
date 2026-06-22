## 心跳周期
- 每 30 分钟执行一次自检（OpenClaw cron）
- 当前已实现检测项: 10 项

## 自检清单（全部已落地为代码）

| # | 检测项 | 实现函数 | 位置 | 实现时间 |
|---|--------|---------|------|---------|
| 1 | 数据库读写 | `_check_database()` | health.py L324 | Phase11 |
| 2 | WAL 完整性 | `_check_wal_integrity()` | health.py L406 | 2026-06-22 |
| 3 | LAN IP + IP变更检测 | `_check_self_reachable()` | health.py L361 | Phase11 → 2026-06-22 强化 |
| 4 | 防火墙规则检查 | `_check_self_reachable()` | health.py L380 | 2026-06-22 |
| 5 | Pillow 图片处理 | `_check_pillow()` | health.py L310 | Phase11 |
| 6 | ffmpeg 视频处理 | `_check_ffmpeg()` | health.py L293 | Phase11 |
| 7 | Ollama 大模型服务 | `_check_ollama()` | health.py L93 | Phase11 |
| 8 | ComfyUI 自动发现(3级) | `_check_comfyui()` | health.py L203 | Phase11 |
| 9 | LLM Playground 模型 | `_check_playground_llm()` | health.py L394 | Phase11 |
| 10 | 磁盘空间 | `_check_disk()` | health.py L343 | Phase11 |

## 异常处理
- 服务挂掉 → 自动重启（执行 start.bat）
- IP变更 → `_check_self_reachable()` 检测并记录 last_ip → hint 提示
- 端口占用 → 启动时探测 8080→8100 自增端口
- 无法访问 → 前端 healthCheck 弹窗逐项显示结果

## 日常提醒
- 每次会话后自动保存最新代码到工作区
- 每周检查一次依赖更新（requirements.txt）
- 关闭前务必执行：WAL checkpoint → .pkb 完整备份
- 自检 API: GET /api/health/check
- 前端弹窗: 导航栏 → 💊按钮 → "启动自检"

## 后台监听
- `start_watcher()`: 每 30s 后台轮询 Ollama/ComfyUI 状态
- `signal_lights.js`: 前端实时信号灯 (绿/黄/红)
- API: GET /api/health/watcher-status

## 最后检查时间
- IP 变更记录: config 表 `last_lan_ip` / `last_ip_check_at`
