# backend/tests — 回归测试脚本

## 运行方式
所有测试脚本从 **工作区根目录** 运行（依赖 `sys.path.insert(0, "backend")` 相对路径 + 本机 8080 服务在线）：

```powershell
cd C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev
python backend\tests\_test_asset_review.py      # Phase35.2 版本/审核/成员 (21项)
python backend\tests\_test_asset_library.py     # Phase35.1 项目资产库 (20项)
python backend\tests\_test_audit.py             # 审计日志 (18项)
python backend\tests\_test_presence.py          # 在线状态 (11项)
python backend\tests\_test_phase36.py           # Phase36 组合回归 (18项)
python backend\tests\_test_phase35_3.py         # Phase35.3 设备索引/DAM
python backend\tests\_test_composer_cards.py    # 组装器词卡入口
python backend\tests\_test_backup_e2e.py        # 备份端到端
python backend\tests\_test_legacy_0715.py       # 旧媒体迁移回归
python backend\tests\_test_agent_int.py         # 文件管家 Agent 集成
```

## 前置条件
1. 服务已启动：`http://127.0.0.1:8080` 可达
2. 测试 token 由 `jwt_auth.generate_test_token()` 生成，无需真实登录
3. 注意：脚本内参数名用 `tk` 而非 `token`（token 会被日志密钥掩码干扰）

> 2026-07-16 从 backend/ 根目录归档至此。调试一次性脚本在 `backend/_scratch/`，历史启动日志在 `backend/logs/`。

python backend\tests\_test_dam_archive.py    # T4 DAM 归档端到端 (17项，引擎级，无需登录)
