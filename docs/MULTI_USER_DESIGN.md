# PromptKit 多用户架构设计文档

Phase18 预埋 · Phase21 实现
版本: v5.1.0 / 文档版本: 1.0

---

## 1. 设计目标

以一台 Windows 主机为核心，支持：
- **本地模式**（Phase21基础）：单主机多账户，局域网浏览器登录
- **远程模式**（Phase21扩展）：通过组网工具实现异地协作
- **联邦模式**（远期）：多实例互联

---

## 2. 用户模型

### 2.1 角色定义

| 角色 | 权限 | 适用场景 |
|------|------|---------|
| admin | 全部操作 + 用户管理 + 系统配置 | 团队管理员 |
| editor | CRUD 词卡/项目/资产 | 日常创作成员 |
| viewer | 只读 + 复制 | 甲方/外部查看 |

### 2.2 数据隔离

```
Level 1: 私有 (owner_user_id = 具体用户)
  → 个人收藏、个人词包、个人设置

Level 2: 项目共享 (project_id 关联)
  → 项目内词卡、资产、任务
  → 按 project_members 表控制访问

Level 3: 全局共享 (owner_user_id = NULL)
  → 内置提示词库、公共分类、公共资产
  → 所有用户可见
```

### 2.3 登录流程（Phase21）

```
1. 用户访问 http://192.168.x.x:8080
2. → 未登录 → 显示登录页面
3. → 输入 用户名+密码
4. → POST /api/auth/login
5. → 验证密码 (bcrypt)
6. → 返回 JWT token
7. → 前端存储 token (localStorage)
8. → 后续请求: Authorization: Bearer <token>
```

---

## 3. 远程协作方案

### 3.1 推荐路径（按复杂度）

| 方案 | 难度 | 延迟 | 安全性 | 推荐度 |
|------|------|------|--------|--------|
| Tailscale/ZeroTier | 用户自建 | 低 | 高 (WireGuard) | ⭐⭐⭐⭐⭐ |
| PromptKit Relay | 开发3周 | 中 | 中 | ⭐⭐⭐ |
| frp/nps 端口转发 | 用户自建 | 低 | 中 | ⭐⭐⭐⭐ |

### 3.2 Tailscale 集成（推荐）

```
用户操作:
1. 主机安装 Tailscale → 获得 100.x.x.x IP
2. 远程用户安装 Tailscale → 加入同一网络
3. 远程用户访问 http://100.x.x.x:8080

PromptKit 适配:
- 显示 Tailscale IP（如已安装）
- 提供 Tailscale 安装引导链接
- 无需额外代码
```

### 3.3 PromptKit Relay（自建，团队版功能）

```
架构:
┌──────────┐         ┌──────────────┐         ┌──────────┐
│ 主机A     │ ←TCP→  │ PK Relay     │ ←TCP→  │ 远程用户B  │
│ (局域网)  │ 隧道    │ (VPS中转)     │ 隧道    │ (任何网络) │
└──────────┘         └──────────────┘         └──────────┘

Relay 功能:
- 主机注册: POST /relay/register → 获得访问码
- 用户连接: 浏览器 → Relay → WebSocket 转发 → 主机
- 端到端加密: NaCl box (Curve25519 + XSalsa20-Poly1305)
- 数据不落地: Relay 仅转发加密流

实现: Python asyncio + WebSocket + 最小 VPS (1C2G ¥50/月)
```

---

## 4. 数据库设计（已预埋）

### 4.1 users 表
```sql
CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,          -- bcrypt/argon2
    display_name    TEXT DEFAULT '',
    role            TEXT DEFAULT 'editor',   -- admin/editor/viewer
    avatar_color    TEXT DEFAULT '#6366f1',
    is_active       INTEGER DEFAULT 1,
    settings_json   TEXT DEFAULT '{}',       -- {theme, language, ...}
    created_at      TEXT,
    last_login_at   TEXT
);
```

### 4.2 user_sessions 表
```sql
CREATE TABLE user_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    token       TEXT UNIQUE NOT NULL,
    client_ip   TEXT,
    user_agent  TEXT,
    created_at  TEXT,
    expires_at  TEXT,
    is_active   INTEGER DEFAULT 1
);
```

### 4.3 旧表扩展
所有核心表已添加 `owner_user_id INTEGER DEFAULT NULL`:
- word_card, prompt_cards, collections, wordpacks
- user_project, library_assets
- character_profiles, scene_profiles
- atom_decompose, media_assets

---

## 5. 安全考虑

- JWT token 有效期: 7天（可配置）
- 密码哈希: bcrypt (cost=12) 或 argon2id
- 登录限流: 5次失败/15分钟 → 锁定30分钟
- XSS 防护: CSP header + 输入转义
- CSRF 防护: SameSite Cookie + Origin 验证
- SQL 注入: 参数化查询（现有代码已遵守）
