# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec — PromptKit v4.0.0-phase9.3 (macOS)
onedir → .app bundle | 目标 macOS 10.10+
用法: MACOSX_DEPLOYMENT_TARGET=10.10 python3 -m PyInstaller build_macos.spec --noconfirm
"""
import os, sys, platform
from pathlib import Path

# 自动获取项目根目录（支持从任意位置运行）
ROOT = Path(__file__).parent.resolve()
block_cipher = None

# 前端静态文件
frontend_files = []
for item in (ROOT / 'frontend').rglob('*'):
    if item.is_file() and '__pycache__' not in str(item):
        rel = item.relative_to(ROOT)
        frontend_files.append((str(item), str(rel.parent)))

a = Analysis(
    [str(ROOT / 'backend' / 'main.py')],
    pathex=[str(ROOT), str(ROOT / 'backend')],
    binaries=[],
    datas=frontend_files,
    hiddenimports=[
        'fastapi', 'fastapi.staticfiles',
        'uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto',
        'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto',
        'uvicorn.lifespan', 'uvicorn.lifespan.on',
        'starlette', 'starlette.routing', 'starlette.middleware',
        'pydantic', 'anyio', 'anyio._backends', 'anyio._backends._asyncio',
        'multipart', 'multipart.multipart',
        'PIL', 'PIL.Image',
        'paths',
        # macOS 平台额外修正
        'uvicorn.loops.asyncio',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets.wsproto_impl',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'torch', 'torch.*', 'torchvision', 'torchaudio',
        'transformers', 'transformers.*',
        'sentence_transformers', 'sentence_transformers.*',
        'tokenizers', 'huggingface_hub',
        'scipy', 'scikit-learn', 'sklearn',
        'matplotlib', 'pandas',
        'sympy', 'mpmath',
        'tqdm', 'tqdm.*',
        'regex', 'filelock', 'fsspec', 'pyyaml',
        'accelerate', 'safetensors',
        'datasets',
        # macOS 不需要的 Windows 依赖
        'win32api', 'win32con', 'win32file', 'pywin32',
        'msvcrt',
    ],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# macOS 平台设置
_console = True      # True=终端窗口(推荐调试), False=后台运行
_app_name = '咪卡MiK提示词助手'

# 如果安装了 UPX 则使用
_upx_available = os.environ.get('UPX_AVAILABLE', 'false').lower() == 'true'

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name=_app_name,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=_upx_available,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=_console,
)

# ========== APP Bundle ==========
app = BUNDLE(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name=_app_name,
    icon=str(ROOT / 'macos' / 'resources' / 'app.icns') if (ROOT / 'macos' / 'resources' / 'app.icns').exists() else None,
    bundle_identifier='com.mika.promptkit',
    info_plist={
        'CFBundleName': '咪卡MiK提示词助手',
        'CFBundleDisplayName': '咪卡MiK提示词助手',
        'CFBundleShortVersionString': '4.0.0',
        'CFBundleVersion': '4.0.0-phase9.3',
        'CFBundleIdentifier': 'com.mika.promptkit',
        'CFBundleExecutable': _app_name,
        'CFBundlePackageType': 'APPL',
        'CFBundleInfoDictionaryVersion': '6.0',
        'NSHighResolutionCapable': True,
        'NSHumanReadableCopyright': 'Copyright 2026 咪卡MiK All Rights Reserved',
        'LSMinimumSystemVersion': '10.10.0',
        'NSAppTransportSecurity': {
            'NSAllowsArbitraryLoads': True,
        },
    },
    strip=False,
    upx=_upx_available,
    upx_exclude=[],
)
