# 🍎 PromptKit v4.0 — macOS 安装使用教程

> **适用系统**: macOS Catalina (10.15) ~ Sequoia (15)  
> **支持架构**: Intel x86_64 / Apple Silicon (M1/M2/M3)  
> **运行方式**: 双击 `.command` 启动，浏览器操作  
> **无需开发环境、无需终端命令（首次安装除外）**

---

## 📦 方案选择

| 方案 | 适合人群 | 大小 |
|------|---------|------|
| **方案 A：双击启动器** | 普通用户，已有 Python 3.10+ | ~2MB（项目源码） |
| **方案 B：.app 封装包** | 完全不懂技术，要拖进应用程序 | ~80MB（含 Python 运行时） |

> 推荐先用方案 A 快速验证，满意后再用方案 B 封装为独立 `.app`。

---

## 方案 A：双击启动器（推荐）

### 1. 获取项目文件

解压 `PromptKit_v4.0.0_mac_v2.zip` 到桌面，自动生成文件夹 `PromptKit_v4.0.0_mac`。

> ⚠️ 必须用 **v2 版本 ZIP**（正斜杠路径），旧版 Windows 反斜杠 ZIP 解压后文件夹结构会损坏。

### 2. 安装 Python 3.10+（仅首次）

访问 https://www.python.org/downloads/ 下载 **macOS 64-bit universal2 installer**。

安装后打开终端验证（`⌘+Space` → 输入 `终端`）：

```bash
python3 --version
# 输出: Python 3.12.x ✓
```

### 3. 安装 ffmpeg（可选，视频上传需用）

```bash
# 先装 Homebrew（如果没有）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 再装 ffmpeg
brew install ffmpeg
ffmpeg -version
```

> 不装 ffmpeg 不影响核心检索功能，仅视频上传模块不可用。

### 4. 运行

在 Finder 中找到 `start.command` 文件，双击启动。

```
🎯 可能出现的问题：
→ "无法打开，因为无法验证开发者"
   解决：右键点击 → 打开 → 仍要打开

→ 终端窗口一闪就关
   解决：终端拖入 start.command → 回车 → 查看报错日志
```

### 5. 使用

浏览器自动打开 **http://localhost:8080**。  
同一局域网的其他设备（手机/平板/其他电脑）访问 **http://[iMac IP]:8080**。

查看 IP：终端输入 `ifconfig | grep "inet " | grep -v 127.0.0.1`

---

## 方案 B：封装 .app 应用程序

### 前提
- Python 3.10+ 已安装
- `pip3 install pyinstaller` 已执行

### 步骤

```bash
# 在 prompt-tool-dev 目录下执行
cd ~/prompt-tool-dev
chmod +x build_mac.sh
./build_mac.sh
```

等待 2-5 分钟构建完成。输出在 `dist/PromptKit.app`。

### 安装
将 `dist/PromptKit.app` 拖入 `/Applications` 文件夹即可。
首次启动：右键点击 → 打开（绕过 Gatekeeper）。

---

## 🛠 常见问题

### Q1: "无法打开 start.command，因为无法验证开发者"
```
解决：系统偏好设置 → 安全性与隐私 → 通用 → 仍要打开
或右键点击文件 → 打开 → 仍要打开
```

### Q2: "import _sqlite3" 报错
```
Mac 自带 SQLite 版本过旧。解决：
brew install sqlite3
然后在终端设置路径：
export DYLD_LIBRARY_PATH="/usr/local/opt/sqlite/lib:$DYLD_LIBRARY_PATH"
```

### Q3: "sentence_transformers 下载失败"
```
首次启动会自动下载 all-MiniLM-L6-v2 模型（~90MB）。
若网络慢，手动下载后放入 ~/.cache/torch/sentence_transformers/
```

### Q4: 端口 8080 被占用
```
程序会自动尝试 8080→8089 端口，无需手动处理。
如需指定：export PORT=9090 && start.command
```

### Q5: "ffmpeg not found"
```
视频上传功能不可用，提示词检索功能正常。
安装: brew install ffmpeg
```

### Q6: 局域网设备无法访问
```
① 确认 iMac 和手机在同一 Wi-Fi
② 检查 macOS 防火墙：系统偏好设置 → 安全性与隐私 → 防火墙 → 关闭（或添加 Python 例外）
③ 确认监听地址为 0.0.0.0（程序已默认设置）
```

---

## 📂 目录结构

```
prompt-tool-dev/
├── start.command         ← 双击启动 [方案A]
├── build_mac.sh          ← .app 构建脚本 [方案B]
├── requirements.txt      ← Python 依赖
├── backend/              ← 后端源码
│   ├── main.py          ← 服务入口
│   └── ...
├── frontend/             ← WebUI 前端
└── data/                 ← 数据目录（自动创建）
    ├── prompts.db        ← SQLite 数据库
    ├── thumbnails/       ← 缩略图
    ├── originals/        ← 原图
    └── videos/           ← 视频
```

---

## ✅ 验证清单

- [ ] 双击 `start.command` 后终端显示 "服务启动中 (端口: 8080)..."
- [ ] 浏览器能打开 http://localhost:8080
- [ ] WebUI 显示 5 个模块（表情/色彩/色调/构图/Seedance）
- [ ] 搜索框输入关键词可检索提示词
- [ ] 局域网手机浏览器访问 http://[iMac IP]:8080 可打开
- [ ] 可选：上传图片后缩略图正常显示（需 Pillow）
- [ ] 可选：上传视频后封面正常提取（需 ffmpeg）

---

> 版本: v4.0.0-phase9.3.1 | 适配日期: 2026-06-15 | 目标: macOS Catalina+ Intel/Apple Silicon
