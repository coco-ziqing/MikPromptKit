# 咪卡MiK提示词助手 — macOS 构建指南

## 📦 前置条件

| 工具 | 版本要求 | 安装命令 |
|------|---------|---------|
| macOS | 10.10+ (Yosemite ~ Sequoia) | — |
| Python | 3.10+ (64-bit) | `brew install python@3.10` |
| Homebrew | 最新 | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| PyInstaller | 6.0+ | `pip3 install pyinstaller` |

可选工具（增强体验）：
- `librsvg` → `brew install librsvg`（生成高清 app 图标）
- `create-dmg` → `brew install create-dmg`（制作精美 DMG 安装包）

## 🚀 一键构建

```bash
# 1. 进入项目目录
cd /path/to/MikPromptKit

# 2. 执行 DMG 安装包生成器
chmod +x macos/build_dmg.sh
./macos/build_dmg.sh
```

脚本自动完成：环境检查 → 安装依赖 → 生成图标(.icns) → 构建 .app → ad-hoc 签名 → 制作 .dmg

输出：
```
dist_macos/
├── MikPromptKit.app               # macOS 应用（可直接双击运行）
└── MikPromptKit_v4.0.0.dmg         # 安装包（分发给其他 Mac 用户）
```

## 🛠 分步构建

如果只想构建 .app 而不制作 DMG：

```bash
export MACOSX_DEPLOYMENT_TARGET=10.10
python3 -m PyInstaller build_macos.spec --noconfirm --distpath dist_macos
```

## 📱 安装包分发

`MikPromptKit_v4.0.0.dmg` 可以直接分发给其他 macOS 用户：

1. 打开 .dmg
2. 将 `MikPromptKit.app` 拖入 `Applications` 文件夹
3. 首次运行：右键 → 打开（或 系统设置 → 隐私与安全性 → 仍要打开）

## 🔐 代码签名

**无需苹果开发者账号** — ad-hoc 签名脚本自动执行，仅用于移除 Gatekeeper 提示。

如果有 Apple Developer 证书：

```bash
codesign --force --deep --sign "Developer ID Application: 你的公司名 (XXXXXX)" \
  dist_macos/MikPromptKit.app
```

## 🔧 技术细节

| 项目 | 值 |
|------|-----|
| 最低兼容 | macOS 10.10 (Yosemite) |
| 最高兼容 | macOS 15 (Sequoia) |
| 架构 | x86_64 + arm64 (Universal2 需额外 lipo) |
| 运行方式 | 终端窗口模式（可切换 console=False 为后台） |
| 默认端口 | 8080（自兜底至 8089） |
