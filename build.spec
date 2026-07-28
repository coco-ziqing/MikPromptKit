# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec — PromptKit v4.0.0-phase9.3
onedir 模式 | 前端打包 | 数据目录外部 | ML依赖排除
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent  # 自动解析当前目录，不依赖固定路径
block_cipher = None

# ---------- 前端 + 插件 datas ----------
all_datas = []

# 前端静态文件
for item in (ROOT / 'frontend').rglob('*'):
    if item.is_file() and '__pycache__' not in str(item):
        rel = item.relative_to(ROOT)
        all_datas.append((str(item), str(rel.parent)))

# 开源插件（打包到 _internal/plugins/，供 plugin_manager 从 get_resource_dir() 发现）
for item in (ROOT / 'plugins').rglob('*'):
    if item.is_file() and '__pycache__' not in str(item):
        rel = item.relative_to(ROOT)
        # 排除禁用/商业插件
        if len(rel.parts) >= 2 and rel.parts[1] in ('_disabled',):
            continue
        all_datas.append((str(item), str(rel.parent)))

# VERSION 文件（放在 _internal 根目录，不是子目录 VERSION/）
all_datas.append((str(ROOT / 'VERSION'), '.'))

a = Analysis(
    [str(ROOT / 'backend' / 'main.py')],
    pathex=[str(ROOT), str(ROOT / 'backend')],
    binaries=[],
    datas=all_datas,
    hiddenimports=[
        'fastapi', 'fastapi.staticfiles',
        'uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto',
        'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto',
        'uvicorn.lifespan', 'uvicorn.lifespan.on',
        'starlette', 'starlette.routing', 'starlette.middleware',
        'pydantic', 'anyio', 'anyio._backends', 'anyio._backends._asyncio',
        'multipart', 'multipart.multipart',
        'PIL', 'PIL.Image',
        'seed_migrate', 'paths',
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
        'numpy', 'numpy.*',  # 仅在ML路径需要，排除减体积
        'matplotlib', 'pandas',
        'sympy', 'mpmath',
        'tqdm', 'tqdm.*',
        'regex', 'filelock', 'fsspec', 'pyyaml',
        'accelerate', 'safetensors',
        'datasets',
    ],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='PromptKit',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
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

# 清理 COLLECT 外的冗余 EXE 文件（dist/PromptKit.exe 无 _internal/ 无法独立运行）
import os as _os
_redundant = Path(ROOT) / 'dist' / 'PromptKit.exe'
if _redundant.exists():
    _os.remove(str(_redundant))
