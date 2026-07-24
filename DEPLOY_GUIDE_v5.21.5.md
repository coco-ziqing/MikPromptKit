# PromptKit 咪卡提示词助手 — 部署转移手册
## v5.21.5 | 2026-07-23

---

## 一、封装包概览

| 项目 | 说明 |
|------|------|
| 包名 | `PromptKit/`（整个文件夹） |
| 大小 | 约 168MB |
| 主程序 | `PromptKit.exe`（Windows 原生 EXE） |
| 目标系统 | **仅 Windows 10/11（64位）** |
| 默认端口 | **8080** |
| 默认账户 | 用户名 `admin`，密码 `admin` |
| 内网访问 | 启动后自动侦测局域网 IP 并显示 |

### 目录结构

```
PromptKit/                   ← 把整个文件夹复制到目标机
├── PromptKit.exe            ← 双击启动
├── _internal/               ← 运行环境（勿修改）
│   ├── frontend/            ← Web 前端
│   ├── plugins/             ← 插件
│   ├── VERSION              ← 版本标识
│   └── ...                  ← Python 运行时 + 依赖
└── data/                    ← 数据目录（可备份）
    ├── prompts.db           ← SQLite 数据库（核心数据）
    ├── .jwt_secret          ← JWT 签名密钥（勿泄露）
    ├── workspaces/          ← 项目文件存储
    ├── catalog_thumbs/      ← 资产缩略图
    └── ...
```

---

## 二、转移步骤

### 步骤 1：复制到目标机

```
方式一（U盘/移动硬盘）：把整个 PromptKit\ 文件夹复制到目标机任意位置

方式二（局域网共享）：在目标机访问 \\源机IP\共享目录，复制 PromptKit\ 到本地

方式三（打包传输）：把 PromptKit\ 打成 ZIP（约 80-100MB）
              目标机解压到任意目录（建议英文路径，无空格）
```

**推荐放置路径**：`D:\PromptKit\` 或 `C:\Tools\PromptKit\`

### 步骤 2：放行防火墙（首次必做）

以**管理员身份**打开 PowerShell，执行：

```powershell
# 放行 8080 端口的入站 TCP 连接
New-NetFirewallRule -DisplayName "PromptKit-8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Any
```

确认规则已创建：
```powershell
Get-NetFirewallRule -DisplayName "PromptKit-8080" | Select-Object DisplayName, Enabled, Action
```

> ⚠️ 如果端口被占用，EXE 会自动探测 8081、8082... 依次递增。届时需重复放行对应端口。

### 步骤 3：启动服务

```
双击 PromptKit.exe
```

首次启动会弹出一个黑色控制台窗口，显示启动日志。等待约 20-30 秒直到看到：

```
==================================================
  [OK] 咪卡MiK提示词助手 v5.21.5 已启动
  [本机] http://127.0.0.1:8080
  [局域网] http://192.168.0.xxx:8080
  [词库] 169 条 | 卡片 165 | 资产 233
==================================================
```

> 控制台窗口 **不要关闭**，关闭即停止服务。

---

## 三、访问测试

### 本机测试
浏览器打开：`http://127.0.0.1:8080`

应看到 PromptKit 登录界面，用 `admin` / `admin` 登录。

### 局域网设备测试

在手机/平板/其他电脑的浏览器输入控制台显示的局域网地址，如：
```
http://192.168.0.102:8080
```

> 需确保设备连接**同一局域网**（同一个路由器/WiFi）。

---

## 四、验证清单

| # | 检查项 | 预期结果 |
|---|--------|---------|
| 1 | 本机浏览器打开 | 显示登录页面 |
| 2 | admin / admin 登录 | 成功进入主页 |
| 3 | 导航栏 → 词库 | 显示 32 个词卡分组 |
| 4 | 导航栏 → 分镜组装器 | 显示 32 个词库均有卡片 |
| 5 | 导航栏 → 项目资产 | 可创建项目并上传文件 |
| 6 | 手机浏览器访问 | 同局域网内可打开 |
| 7 | 左上角版本号 | 显示 v5.21.5 |

---

## 五、日常运维

### 开机自启（可选）

在 `shell:startup`（Win+R 输入打开）中创建快捷方式：

1. 右键 `PromptKit.exe` → 创建快捷方式
2. Win+R → `shell:startup` → 回车
3. 把快捷方式拖入该文件夹

### 数据备份

定期复制 `data\prompts.db` 到安全位置即可备份全部数据：

```powershell
Copy-Item "D:\PromptKit\data\prompts.db" "D:\Backup\prompts_$(Get-Date -Format 'yyyyMMdd').db"
```

### 关闭服务

直接关闭控制台窗口，或 Ctrl+C。

---

## 六、常见问题

| 症状 | 原因 | 解决 |
|------|------|------|
| 浏览器无法打开 | 防火墙拦截 | 执行步骤 2 放行端口 |
| 局域网设备无法访问 | 不在同一网络 / 防火墙 | 确认同 WiFi；重检防火墙规则 |
| 端口被占用 | 8080 已被其他程序使用 | EXE 自动切换端口，看控制台新地址 |
| admin 登录失败 | JWT 密钥不匹配 | 删除 `data\.jwt_secret` 后重启（密码恢复为 admin） |
| 词库为空 | DB 数据丢失 | 从备份恢复 `data\prompts.db` |
| 杀毒软件拦截 | EXE 未签名 | 在 Windows Defender 中添加排除项 |
| "api-ms-win-*.dll 缺失" | 系统版本过低 | 需要 Windows 10 1809+ 或 Windows 11 |

---

## 七、技术摘要

| 指标 | 值 |
|------|-----|
| 后端框架 | FastAPI + Uvicorn |
| 数据库 | SQLite (WAL 模式) |
| 前端 | 原生 HTML5 + Bootstrap5 + JavaScript |
| Python 运行时 | 3.14.5（内嵌，目标机无需安装 Python） |
| 内存占用 | 约 150-300MB（含语义模型） |
| 磁盘占用 | 约 170MB（不含用户数据增长） |
| 最大并发 | 单机轻量级，推荐 5-20 并发用户 |

---

**部署完成后**，建议立即修改 admin 密码：登录 → 右上角头像 → 个人资料 → 修改密码。
