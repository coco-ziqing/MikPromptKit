"""
JWT 认证中间件 — Phase18 预埋
当前阶段: 解析 token 但不强制验证（向后兼容单用户模式）
Phase21 团队版: 启用强制验证

用法: 在 main.py 中 app.add_middleware(...)
"""

import time
import os
import hashlib
import hmac
import base64
import json
from typing import Optional, Dict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# 日志
try:
    from logger import info as log_info, debug as log_debug
except ImportError:
    log_info = lambda m: print(f"[JWT] {m}")
    log_debug = lambda m: None


# ============================================================
# 简易 JWT 实现（无外部依赖）
# ============================================================

# 服务端密钥 — 优先级: 环境变量 > 持久化文件(data/.jwt_secret) > 首次生成并落盘
# (零配置体验不变, 且重启不会使已签发 token 失效)
import secrets as _secrets

def _load_or_create_secret() -> str:
    """环境变量优先; 其次 data/.jwt_secret; 都没有则生成并持久化"""
    env = os.environ.get("PK_JWT_SECRET", "").strip()
    if env:
        return env
    try:
        from paths import get_data_dir
        data_dir = get_data_dir()
    except Exception:
        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    secret_path = os.path.join(data_dir, ".jwt_secret")
    try:
        if os.path.exists(secret_path):
            with open(secret_path, "r", encoding="utf-8") as f:
                v = f.read().strip()
            if v:
                return v
    except Exception:
        pass
    new_secret = _secrets.token_hex(32)
    try:
        os.makedirs(data_dir, exist_ok=True)
        with open(secret_path, "w", encoding="utf-8") as f:
            f.write(new_secret)
        try:
            os.chmod(secret_path, 0o600)
        except Exception:
            pass
        print("[SECURITY] 已生成并持久化 JWT 密钥 -> data/.jwt_secret（重启不失效）")
    except Exception as _e:
        print(f"[SECURITY] 密钥持久化失败，本次使用临时密钥（重启失效）: {_e}")
    return new_secret

_JWT_SECRET = _load_or_create_secret()
_JWT_ALGORITHM = "HS256"
# Team 模式是否强制验证（Phase21 启用）
_ENFORCE_AUTH = os.environ.get("PK_ENFORCE_AUTH", "0") == "1"

# 公开路径白名单（无需认证）
# 注意: 路径匹配使用 startswith，目录类路径需加尾部斜杠避免前级歧义
_PUBLIC_PATHS = [
    "/index.html", "/favicon.ico", "/login.html", "/admin_users.html", "/join",
    "/static/", "/api/health", "/api/plugin-system/manifest",
    "/api/auth/login", "/api/auth/register",
    "/api/plugins",  # License 激活不需要登录
    "/api/status",   # 公开状态端点
]
# 精确匹配路径（避免 startswith 误匹配，如 / 会匹配一切）
_PUBLIC_EXACT = {"/"}


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _base64url_decode(s: str) -> bytes:
    padding = 4 - (len(s) % 4)
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def create_jwt(payload: dict, secret: str = None) -> str:
    """
    创建 JWT token。
    payload: {user_id, username, role, exp, iat}
    """
    if secret is None:
        secret = _JWT_SECRET
    
    header = {"alg": _JWT_ALGORITHM, "typ": "JWT"}
    header_b64 = _base64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _base64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    
    signing_input = f"{header_b64}.{payload_b64}"
    signature = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    sig_b64 = _base64url_encode(signature)
    
    return f"{signing_input}.{sig_b64}"


def verify_jwt(token: str, secret: str = None) -> Optional[dict]:
    """
    验证 JWT token，返回 payload 或 None。
    """
    if secret is None:
        secret = _JWT_SECRET
    
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        
        header_b64, payload_b64, sig_b64 = parts
        
        # 验证签名
        signing_input = f"{header_b64}.{payload_b64}"
        expected_sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
        actual_sig = _base64url_decode(sig_b64)
        
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        
        # 解码 payload
        payload_json = _base64url_decode(payload_b64)
        payload = json.loads(payload_json)
        
        # 验证过期
        exp = payload.get("exp", 0)
        if exp and exp < time.time():
            return None
        
        return payload
    
    except Exception:
        return None


# ============================================================
# FastAPI 中间件
# ============================================================

class JWTAuthMiddleware(BaseHTTPMiddleware):
    """
    JWT 认证中间件（Phase18: 仅解析，不强制）。
    
    1. 从 Authorization header 或 cookie 提取 token
    2. 验证 token → 解析 user_id, role
    3. 注入到 request.state.user
    4. Phase18: 验证失败不拒绝请求（用户保持匿名）
    5. Phase21: _ENFORCE_AUTH=True → 验证失败返回 401
    """
    
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        
        # 检查是否为公开路径
        is_public = path in _PUBLIC_EXACT or any(path.startswith(p) for p in _PUBLIC_PATHS)
        
        # 初始化 user 状态
        user = {
            "id": 1,      # 默认管理员
            "username": "admin",
            "role": "admin",
            "authenticated": False,
        }
        
        # 提取 token
        token = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        else:
            token = request.cookies.get("pk_token", "")
        
        # 验证 token
        if token:
            payload = verify_jwt(token)
            if payload:
                user = {
                    "id": payload.get("user_id", 1),
                    "username": payload.get("username", "admin"),
                    "role": payload.get("role", "admin"),
                    "authenticated": True,
                }
                log_debug(f"[JWT] 已验证: {user['username']} (role={user['role']})")
            else:
                if _ENFORCE_AUTH and not is_public:
                    return JSONResponse(
                        {"detail": "登录已过期，请重新登录"},
                        status_code=401
                    )
        
        # 注入到 request.state
        request.state.user = user
        request.state.user_id = user["id"]
        
        response = await call_next(request)
        return response


# ============================================================
# FastAPI 依赖注入
# ============================================================

from fastapi import Depends, HTTPException

def require_role(*roles: str):
    """
    FastAPI 依赖注入 — 要求当前用户拥有指定角色之一。
    用法：
        @router.get("/api/admin/secret")
        def secret(user: dict = Depends(require_role("admin"))): ...
    
    与 JWTAuthMiddleware 配合：中间件将解析后的用户注入 request.state.user，
    此依赖从中读取并检查角色。
    """
    def _check(request: Request):
        u = get_current_user(request)
        if not u.get("authenticated"):
            raise HTTPException(status_code=401, detail="请先登录")
        if roles and u.get("role") not in roles:
            raise HTTPException(status_code=403, detail="权限不足")
        return u
    return _check


def require_auth(request: Request):
    """轻量守卫：只要求已登录，不限制角色"""
    u = get_current_user(request)
    if not u.get("authenticated"):
        raise HTTPException(status_code=401, detail="请先登录")
    return u


# ============================================================
# 辅助函数
# ============================================================

def get_current_user(request: Request) -> dict:
    """在 API 处理函数中获取当前用户"""
    if hasattr(request.state, 'user'):
        return request.state.user
    return {"id": 1, "username": "admin", "role": "admin", "authenticated": False}


def login_user(db, username: str, password: str) -> Optional[str]:
    """
    用户登录验证 — 通过 users 表校验密码，返回 JWT token 或 None。
    db: sqlite3 连接（需已设置 row_factory）
    """
    try:
        from password import check_pw
    except ImportError:
        return None
    row = db.execute(
        "SELECT id, username, password_hash, role, is_active FROM users WHERE username=?",
        [username]
    ).fetchone()
    if not row or not row["is_active"]:
        return None
    if not check_pw(password, row["password_hash"]):
        return None
    return create_jwt({
        "user_id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "iat": int(time.time()),
        "exp": int(time.time()) + 86400 * 7,
    })


# ============================================================
# 开发工具
# ============================================================

def generate_test_token(user_id=1, username="admin", role="admin"):
    """⚠ 仅开发环境使用，生成测试 JWT token"""
    if os.environ.get("PK_ENV", "dev") != "dev":
        raise RuntimeError("generate_test_token 仅在开发环境可用")
    payload = {
        "user_id": user_id,
        "username": username,
        "role": role,
        "iat": int(time.time()),
        "exp": int(time.time()) + 86400 * 365,  # 1年
    }
    return create_jwt(payload)


if __name__ == "__main__":
    # 测试
    token = generate_test_token()
    print(f"JWT Token: {token}")
    payload = verify_jwt(token)
    print(f"Valid: {payload is not None}")
    print(f"Payload: {payload}")
