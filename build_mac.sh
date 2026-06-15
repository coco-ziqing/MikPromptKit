#!/bin/bash
# ================================================================
# PromptKit v4.0 — macOS .app 封装构建脚本 (PyInstaller)
# 运行后生成 dist/PromptKit.app（双击启动，菜单栏托盘）
# ================================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "📦 PromptKit macOS 应用封装构建"
echo "========================================="

# 确认 Python 版本
PYTHON="${1:-python3}"
PY_VER=$($PYTHON --version 2>&1)
echo "Python: $PY_VER"

# 确认 PyInstaller
if ! $PYTHON -c "import PyInstaller" 2>/dev/null; then
    echo "📥 安装 PyInstaller..."
    pip3 install pyinstaller
fi

# 清理旧构建
rm -rf build dist *.spec

# ---------- 生成 spec 配置 ----------
cat > promptkit_mac.spec << 'SPECEOF'
# -*- mode: python ; coding: utf-8 -*-
import sys, os
from pathlib import Path

block_cipher = None

# 项目根目录
PROJ_DIR = Path(os.path.abspath('.'))

# 收集所有 backend 模块
backend_files = []
backend_dir = PROJ_DIR / 'backend'
for f in backend_dir.glob('**/*.py'):
    rel = f.relative_to(PROJ_DIR)
    backend_files.append((str(f), str(rel.parent)))

# 收集前端文件
frontend_files = []
frontend_dir = PROJ_DIR / 'frontend'
for f in frontend_dir.glob('**/*'):
    if f.is_file():
        rel = f.relative_to(PROJ_DIR)
        frontend_files.append((str(f), str(rel.parent)))

a = Analysis(
    ['backend/main.py'],
    pathex=[],
    binaries=[],
    datas=[
        (str(PROJ_DIR / 'requirements.txt'), './'),
        *frontend_files,
    ],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'fastapi',
        'aiohttp',
        'PIL._imaging',
        'sentence_transformers',
        'numpy',
        'aiofiles',
        'sqlite3',
        'asyncio',
        'email.mime.text',
        'email.mime.multipart',
        'multiprocessing',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'PyQt5',
        'PySide6',
        'wx',
        'matplotlib',
        'scipy',
        'pandas',
        'torch',
        'tensorflow',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='PromptKit',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,       # macOS 不显示终端窗口
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='PromptKit',
)

app = BUNDLE(
    coll,
    name='PromptKit.app',
    icon=None,             # 可替换为 .icns 图标
    bundle_identifier='ai.promptkit.app',
    info_plist={
        'NSHighResolutionCapable': True,
        'LSBackgroundOnly': False,
        'CFBundleName': 'PromptKit',
        'CFBundleDisplayName': 'PromptKit - 提示词检索工具',
        'CFBundleVersion': '4.0.0',
        'CFBundleShortVersionString': '4.0.0',
        'CFBundleInfoDictionaryVersion': '6.0',
    },
)
SPECEOF

echo "🔨 开始 PyInstaller 构建（约 2-5 分钟）..."
$PYTHON -m PyInstaller promptkit_mac.spec --clean --noconfirm

echo ""
echo "✅ 构建完成！"
echo "   输出: dist/PromptKit.app"
echo ""
echo "📋 后续步骤:"
echo "   1. 双击 dist/PromptKit.app 启动"
echo "   2. 或拖入 /Applications 安装"
echo "   3. 数据目录自动创建在 .app 同级 data/ 文件夹"
echo ""
echo "⚠️  首次启动可能需右键→打开（绕过 Gatekeeper）"
