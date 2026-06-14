# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec — PromptKit v4.0.0-phase9.3
onedir 模式 | 前端打包 | 数据目录外部 | ML依赖排除
"""
import os
from pathlib import Path

ROOT = Path(r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev')
block_cipher = None

# ---------- 前端静态文件 datas ----------
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
