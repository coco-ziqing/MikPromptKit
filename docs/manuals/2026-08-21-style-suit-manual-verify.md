# 角色风格包系统 v5.47.0 · 手动验证手册

> 版本：v5.47.0（链路验证版）｜commit 67025c9｜tag v5.47.0
> 范围：后端链路（数据模型 / 套装 CRUD / 配置 / 版本 / .style 导入导出 / 装配草稿 / 预检 / 批量渲染编排）
> 前端：尚未实现（背包页/编辑器/操作台/结果页在 v5.48.0），本手册以 API 验证为主
> 日期：2026-08-21

---

## 0. 前置准备

### 0.1 启动服务
```powershell
cd C:\Users\admin\prompt-tool-dev\MikPromptKit
# 方式 A：一键启动脚本（推荐）
.\start.bat
# 方式 B：直接启动
C:\Users\admin\AppData\Local\Python\bin\python.exe -u backend\main.py
```

### 0.2 健康检查
浏览器打开 `http://127.0.0.1:8080/health`，应返回 200 + `{"status":"ok"}` 之类。
或 PowerShell：
```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:8080/health" -UseBasicParsing
```

### 0.3 确认迁移生效
启动日志（data/start_dev_stdout.log 或启动窗口）应出现：
```
[Phase19] 角色风格包系统迁移开始...
[OK] 建表 style_suit
[OK] 建表 style_suit_version
[OK] 建表 assemble_draft
[OK] 建表 render_batch
[Phase19] 迁移完成! {'tables_created': 0 或 4, ...}
```
> 全新库 tables_created=4；已迁移过的库为 0（幂等，正常）。

### 0.4 登录获取 Token
所有写操作需要登录。登录接口：`POST /api/auth/login`
```powershell
$body = '{"username":"admin","password":"admin"}'
$r = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/auth/login" -Method Post -ContentType "application/json" -Body $body
$token = $r.token   # 若字段不同，看返回的 key（可能为 access_token）
$headers = @{ Authorization = "Bearer $token" }
echo "Token: $($token.Substring(0,20))..."
```
> ⚠️ 管理员默认 admin/admin（首次登录后可改，TOOLS.md 有记录）。

---

## 1. 套装 CRUD 验证

### 1.1 新建套装
```powershell
$body = '{"name":"验证-影视写实","tags":["影视写实"],"remark":"手动验证"}'
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs" -Method Post -Headers $headers -ContentType "application/json" -Body $body
```
**预期**：`ok=true`，返回 `item.id`（记下，后续用 `$suitId` 替代）、`config` 为五 Tab 默认骨架（style_words/render_params/output_parts/layout/meta）、`source=user`、`version_count=1`、`current_version_id=1`。

### 1.2 查询列表
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs" -Headers $headers
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs?tab=favorite" -Headers $headers
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs?q=影视" -Headers $headers
```
**预期**：all tab 含刚建的套装；favorite 为空；搜索命中 1 条。

### 1.3 查看详情
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/$suitId" -Headers $headers
```
**预期**：返回完整配置对象。

### 1.4 更新配置（五 Tab 全量写入）
```powershell
$cfg = @{
  style_words = @{ positive = "电影级写实，35mm镜头，浅景深"; negative = "卡通，变形" }
  render_params = @{ canvas_size = "1:1"; denoise = 0.65; cfg = 5.5; sampler = "dpmpp_2m"; steps = 28; layer_render = $false; model_version = "5.0"; ratio = "1:1"; resolution_type = "2k" }
  output_parts = @("main","three_view","face")
  layout = @{ template = "default"; color_card = $true; title_text = "角色设定"; bg_color = "#1a1a2e" }
  meta = @{ name = "验证-影视写实"; tags = @("影视写实"); remark = "手动验证"; cover = "" }
} | ConvertTo-Json -Depth 5
$body = @{ config = ($cfg | ConvertFrom-Json) } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/$suitId" -Method Put -Headers $headers -ContentType "application/json" -Body $body
```
**预期**：`version_count=2`、`current_version_id=2`、config 完整回显。

### 1.5 版本列表 + 回滚
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/$suitId/versions" -Headers $headers
# 取第一条版本的 id，执行回滚
$body = '{"version_id":1}'
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/$suitId/rollback" -Method Post -Headers $headers -ContentType "application/json" -Body $body
```
**预期**：版本列表 ≥2 条；回滚后 config 恢复为 v1 内容，version_count+1（回滚也留痕）。

---

## 2. 复制 / 收藏 / 回收站

```powershell
# 复制
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/$suitId/duplicate" -Method Post -Headers $headers
# 收藏
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/$suitId/favorite" -Method Put -Headers $headers -ContentType "application/json" -Body '{"fav":true}'
# 列表应置顶
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs?tab=favorite" -Headers $headers
# 软删除（进回收站）
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/$dupId" -Method Delete -Headers $headers
# 回收站可见
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs?tab=trash" -Headers $headers
# 恢复
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/$dupId/restore" -Method Post -Headers $headers
```
**预期**：复制生成独立新套装（名称带「副本」）；收藏后 favorite tab 出现且列表置顶；软删除后 all tab 消失、trash tab 出现；恢复后回 all tab。

---

## 3. .style 导入导出

### 3.1 导出
```powershell
$exp = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/$suitId/export" -Headers $headers
$exp.doc | ConvertTo-Json -Depth 8 | Out-File -FilePath "$env:TEMP\test_suit.style" -Encoding utf8
```
**预期**：`format=mikpromptkit.style-pack`、`schema_version=1`、`name/config` 完整。

### 3.2 导入
```powershell
$doc = Get-Content "$env:TEMP\test_suit.style" -Raw | ConvertFrom-Json
$body = $doc | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/style-packs/import" -Method Post -Headers $headers -ContentType "application/json" -Body $body
```
**预期**：生成新套装，config 与导出前完全一致（output_parts 等字段保留）。

### 3.3 非法文件拦截（可选）
```powershell
$body = '{"format":"xxx","name":"bad"}'
# 应返回 400 非法的 .style 文件格式
```

---

## 4. 装配草稿 + 预检

### 4.1 保存草稿
```powershell
$body = @{
  name = "手动验证草稿"
  base_asset_ref = @{ source = "media"; id = 1; url = "/media/1"; desc = "青年男性，正脸" }
  rune_card_ids = @(1,2)          # 取词库里任意真实词卡 id
  suit_id = $suitId
  accessory_list = @(@{ part = "expressions" })
  channel = "virtual"
  config_override = @{ render_params = @{ cfg = 6.0 } }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/assemble/draft" -Method Post -Headers $headers -ContentType "application/json" -Body $body
```
**预期**：返回 `item.id`（记作 `$draftId`），字段完整回显；同名草稿重复提交会更新而非新建（`updated=true`）。

### 4.2 预检（正常路径）
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/assemble/precheck" -Method Post -Headers $headers -ContentType "application/json" -Body '{"draft_id":'$draftId'}'
```
**预期**：`passed=true`、`issues=[]`、summary 显示 base=true、output_parts 含套装默认产出 + 配件追加项。

### 4.3 预检（拦截路径：无基底）
```powershell
$body = '{"name":"无基底","base_asset_ref":{},"rune_card_ids":[],"suit_id":0,"accessory_list":[],"channel":"virtual","config_override":{}}'
$r = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/assemble/draft" -Method Post -Headers $headers -ContentType "application/json" -Body $body
$badDraftId = $r.item.id
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/assemble/precheck" -Method Post -Headers $headers -ContentType "application/json" -Body ('{"draft_id":' + $badDraftId + '}')
```
**预期**：`passed=false`，issues 含 `no_base`（基底必填）。

---

## 5. 批量渲染入队（⚠️ 额度敏感，谨慎执行）

> ⚠️ **重要警告**：`/api/assemble/render` 会把任务写入 card_gen_tasks，worker 会自动真实提交到即梦 **消耗额度**。验证编排链路时请按下面流程操作，验证后**必须清理**（见第 7 节）。

```powershell
# 提交渲染（仅验证编排，产出配件会真实入队）
$body = '{"draft_id":'$draftId',"license_info":{}}'
$r = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/assemble/render" -Method Post -Headers $headers -ContentType "application/json" -Body $body
$batchId = $r.batch.id
```
**预期**：`batch.status=running`、`total` = 产出配件数（如套装 main/three_view/face + 配件 expressions = 4）、`task_ids` 为数组。

```powershell
# 批次查询
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/assemble/render/$batchId" -Headers $headers
# 刷新统计（从 card_gen_tasks 实时聚合）
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/assemble/render/$batchId/refresh" -Method Post -Headers $headers
# 批次列表
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/assemble/render" -Headers $headers
```
**预期**：tasks 数组含每个任务（task_type=text2image、status=queued/running）；refresh 返回 done/fail 计数。

> 想确认编排不炸但**不消耗额度**：可直接用 `scripts/test_style_suit_link.py` 自动回归（它验证后自动取消任务 + 清理临时卡）。

---

## 6. 自动回归（推荐，替代大部分手动步骤）

```powershell
cd C:\Users\admin\prompt-tool-dev\MikPromptKit
C:\Users\admin\AppData\Local\Python\bin\python.exe scripts\test_style_suit_link.py
```
**预期**：输出 `========== 结果: PASS=20 FAIL=0 ==========`，且脚本内部自动清理测试任务与临时词卡（结尾可再确认活跃任务为 0）。

---

## 7. 测试数据清理（手动执行渲染后必做）

若手动跑了第 5 节（真实入队），必须清理，否则 worker 会真实提交消耗额度：

```powershell
# 用 Python 精确清理（PS 管道改文件/中文有坑，一律 Python 处理）
C:\Users\admin\AppData\Local\Python\bin\python.exe -c "
import sqlite3, time
c = sqlite3.connect(r'C:\Users\admin\prompt-tool-dev\MikPromptKit\data\prompts.db')
c.row_factory = sqlite3.Row
now = time.strftime('%Y-%m-%d %H:%M:%S')
# 1. 取消 queued/running 任务（阻止 worker 真实提交）
rows = c.execute(\"SELECT id FROM card_gen_tasks WHERE status IN ('queued','running')\").fetchall()
for r in rows:
    c.execute(\"UPDATE card_gen_tasks SET status='canceled', fail_category='manual_cleanup', finished_at=?, progress=100 WHERE id=?\", [now, r['id']])
print('已取消任务:', len(rows))
# 2. 软删装配临时词卡（保持任务引用完整）
tmp = c.execute(\"SELECT id FROM word_card WHERE name LIKE '装配-%' AND is_deleted=0\").fetchall()
for r in tmp:
    c.execute('UPDATE word_card SET is_deleted=1, deleted_at=? WHERE id=?', [now, r['id']])
print('已软删临时词卡:', len(tmp))
c.commit(); c.close()
"
```

清理后确认：
```powershell
# 活跃任务应为 0
C:\Users\admin\AppData\Local\Python\bin\python.exe -c "import sqlite3; c=sqlite3.connect(r'C:\Users\admin\prompt-tool-dev\MikPromptKit\data\prompts.db'); print('活跃任务:', c.execute(\"SELECT COUNT(*) FROM card_gen_tasks WHERE status IN ('queued','running')\").fetchone()[0])"
```

---

## 8. 数据库直接核查（可选）

```powershell
C:\Users\admin\AppData\Local\Python\bin\python.exe -c "
import sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
c = sqlite3.connect(r'C:\Users\admin\prompt-tool-dev\MikPromptKit\data\prompts.db'); c.row_factory = sqlite3.Row
for t in ['style_suit','style_suit_version','assemble_draft','render_batch']:
    n = c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
    print(f'{t}: {n} 条')
# 词库视图污染检查（应为 0）
v = c.execute(\"SELECT COUNT(*) FROM prompt_word_card WHERE word_text LIKE '装配-%'\").fetchone()[0]
print(f'词库视图可见装配临时卡: {v}（应为 0）')
"
```

---

## 9. 常见问题排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 登录 404 | 路径写错 | 必须 `/api/auth/login`（prefix=/api/auth） |
| 401 请先登录 | Token 缺失/过期 | 重新登录，确认请求头 `Authorization: Bearer <token>` |
| 500 lastrowid 错误 | 旧代码未重启 | 重启服务（本次已修复，旧进程需重启生效） |
| 健康检查连不上 | 服务未启动/启动中 | 等 20-30s 再试；看 data/suit_test_stderr.log |
| 临时词卡出现在词库 | 用了旧版 assemble | 确认服务运行的是 commit 67025c9 之后的代码 |
| 任务一直 queued 后消失 | 被清理脚本取消 | 正常，验证数据不落地 |
| 更新套装后版本不涨 | 快照失败 | 查 data/suit_test_stdout.log 的 Phase19/错误日志 |

---

## 10. 验证通过标准（勾选清单）

- [ ] 健康检查 200
- [ ] Phase19 迁移日志出现且幂等
- [ ] 新建套装返回默认五 Tab 配置
- [ ] 更新配置后 version_count 递增、版本列表可查
- [ ] 回滚恢复旧配置
- [ ] 复制生成独立副本
- [ ] 收藏置顶、软删进回收站、恢复成功
- [ ] .style 导出→导入配置一致
- [ ] 装配草稿保存/更新/查询正常
- [ ] 预检正常路径 passed=true
- [ ] 预检无基底 passed=false 且含 no_base
- [ ] 批量渲染入队 batch.total 正确、task_ids 生成
- [ ] 批次查询/刷新正常
- [ ] 测试数据清理后活跃任务 = 0、词库视图无污染
- [ ] 自动回归脚本 PASS=20 FAIL=0
