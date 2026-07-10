# PromptKit 仓库隔离规范

> 版本: v5.1.0-phase18
> 最后更新: 2026-07-10

---

## 一、仓库架构

```
开源仓库 (GitHub Public)                    私有仓库 (Self-Hosted / Private)
License: MIT                               License: Proprietary
─────────────────────────────────         ─────────────────────────────────
prompt-tool-dev/                          prompt-tool-dev-private/
├── backend/                              ├── private_keys/
│   ├── plugin_manager.py    ✅ MIT       │   ├── private.pem          🔒
│   ├── license_manager.py   ✅ 客户端验证  │   ├── public.pem           📋
│   ├── jwt_auth.py           ✅ 中间件    │   └── license_server.py   🔒 签发
│   ├── ws_collab.py          ✅ WS预埋    │
│   ├── main.py               ✅ 入口      ├── plugins/
│   └── api/                  ✅ API       │   ├── project_mgmt/       💰 Plugin A
├── frontend/                 ✅ UI        │   ├── asset_mgmt/         💰 Plugin B
├── plugins/                                │   └── team_collab/       💰 Plugin C
│   └── example_plugin/       ✅ 开发模板    │
├── docs/                     ✅ 文档       ├── build/                 🔧 打包
├── .gitignore                ✅ 安全规则   │   ├── build_merged.py
├── pre_commit_check.py       ✅ 预提交扫描  │   └── package_release.py
└── .githooks/                ✅ Git钩子     │
                                            └── prompt-tool-dev/      🔗 git submodule
                                                (指向开源仓库)
```

---

## 二、边界规则

### 2.1 开源仓库（绝对禁止）

| 类别 | 禁止内容 | 原因 |
|------|---------|------|
| 🔒 密钥 | `.pem`、`.key`、RSA 私钥 | 可生成任意 License |
| 🔒 签发 | `encode_license_payload`、`_rsa_sign`、`_generate_rsa_keys` | 签名逻辑 = 商业命脉 |
| 💰 插件 | `project_mgmt/`、`asset_mgmt/`、`team_collab/` | 付费商业代码 |
| 🔧 构建 | `build_merged.py`、打包脚本 | 含私有路径/密钥路径 |
| 📦 数据 | `.db`、`.pkb`、备份文件 | 用户数据 |
| 🖼️ 资产 | 缩略图/视频/原始图片 | 用户创作内容 |

### 2.2 开源仓库（允许公开）

| 内容 | 说明 |
|------|------|
| `plugin_manager.py` | 插件框架核心 — MIT |
| `license_manager.py` | 仅客户端验证（decode + verify + store）— MIT |
| `_PUBLIC_KEY_PEM` 常量 | 公钥是公开信息，嵌入代码无风险 |
| `plugin_host.js` | 前端插件宿主 — MIT |
| `plugin_license.js` | License 激活 UI — MIT |
| `pre_commit_check.py` | 预提交检查 — MIT |
| 示例插件 | 仅开发模板，无商业逻辑 |

### 2.3 私有仓库（存放位置）

- 所有商业插件源码 → `prompt-tool-dev-private/plugins/`
- License 签发工具 → `prompt-tool-dev-private/private_keys/`
- 构建脚本 → `prompt-tool-dev-private/build/`

---

## 三、防护措施

### 3.1 `.gitignore`（静态屏障）

```gitignore
# 🔒 密钥
data/licenses/*.pem
data/licenses/license_*

# 💰 商业插件
plugins/project_mgmt/
plugins/asset_mgmt/
plugins/team_collab/

# 🔧 构建工具
tools/license_server.py
scripts/build_merged.py
```

### 3.2 `pre_commit_check.py`（动态屏障）

每次 `git commit` 前自动扫描：
- 正则匹配 RSA 私钥格式（`BEGIN PRIVATE KEY` 头）
- 正则匹配签名函数 (`encode_license_payload`、`_rsa_sign`)
- 路径检测 (`plugins/project_mgmt/`、`data/licenses/`)
- 文件名检测 (`private.pem`、`*.db`)

### 3.3 代码注释标记

所有开源文件头部标注边界：

```python
# @license MIT
# @boundary OPEN-SOURCE — 仅客户端验证逻辑
# 签发工具位于私有仓库 tools/license_server.py
```

---

## 四、构建流程

### 开发模式（走开源仓库）
```bash
cd prompt-tool-dev
python backend/main.py
# 仅开源核心 + example_plugin
```

### 发布模式（走私有仓库）
```bash
cd prompt-tool-dev-private
python build/build_merged.py --release

# build_merged.py 做的事:
# 1. git pull 开源核心
# 2. 复制 plugins/{project_mgmt,asset_mgmt,team_collab} → 开源 plugins/
# 3. 注入 tools/license_server.py
# 4. 安全检查（确认公钥未替换、无敏感文件泄漏）
# 5. 打包 ZIP / EXE
```

---

## 五、应急响应

### 如果怀疑私钥已泄漏到开源仓库：

```bash
# 1. 检查历史
git log --all --oneline -- data/licenses/

# 2. 如果已提交 → 更换密钥对 + 通知用户更新 License
#    参考: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository

# 3. 用 git-filter-repo 从历史彻底移除
git filter-repo --path data/licenses/private.pem --invert-paths
```

### 如果商业插件源码误提交：

```bash
git filter-repo --path plugins/project_mgmt/ --invert-paths
git filter-repo --path plugins/asset_mgmt/ --invert-paths
git filter-repo --path plugins/team_collab/ --invert-paths
```

---

## 六、检查清单

每次 push 到公开仓库前：

- [ ] `python pre_commit_check.py` 通过
- [ ] `git diff --cached --name-only | grep -E "\.pem|private|license_server|project_mgmt|asset_mgmt|team_collab"` 无输出
- [ ] `git grep "BEGIN.*PRIVATE.*KEY" $(git rev-list --all)` 仅命中误报
- [ ] `git check-ignore plugins/project_mgmt/__init__.py` 返回路径（确认被排除）
- [ ] 所有新增 `.py`/`.js` 文件头部有 `@license MIT` + `@boundary` 注释
