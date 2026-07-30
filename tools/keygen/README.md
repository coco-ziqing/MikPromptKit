# 🔐 MikPromptKit 激活码生成器

独立封装的激活码生成工具。**完全离线可用**，不依赖 MikPromptKit 服务端。

## 文件

| 文件 | 说明 |
|------|------|
| `keygen.py` | Python CLI / 库，核心签名逻辑 |
| `keygen.html` | Web 图形界面（纯离线，不依赖后端 API） |
| `README.md` | 本文件 |

## 用法

### Web 界面（推荐 — 纯离线）

1. 直接双击打开 `keygen.html`（无需启动任何服务）
2. 点击「📂 加载 .license_seed 文件」→ 选择 MikPromptKit 服务器上的 `data/.license_seed`
3. 输入目标主机指纹 → 选择版本和有效期 → 点击生成

> 也可以从 MikPromptKit 主界面激活弹窗中链入（此时由服务端托管访问）

### CLI

```bash
python tools/keygen/keygen.py --tier personal --fingerprint <32位指纹> --days 365
python tools/keygen/keygen.py --tier team    --fingerprint <32位指纹> --days 90
```

### Python 库

```python
import sys; sys.path.insert(0, 'tools/keygen')
from keygen import generate_code, verify_code

code = generate_code("personal", fingerprint_hex, days=365)
```

## 前置条件

- 需要从 MikPromptKit 服务器获取 `data/.license_seed` 文件（32字节二进制）
- 目标主机指纹从 `GET /api/license/info` 的 `fingerprint` 字段获取
