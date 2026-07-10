"""
JWT 认证中间件 — Phase18 预埋
当前阶段: 解析 token 但不强制验证（向后兼容单用户模式）
Phase21 团队版: 启用强制验证

用法: 在 main.py 中 app.add_middleware(...)
"""

import time
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

# 服务端密钥（生产环境应从配置文件读取）
_JWT_SECRET = "promptkit-jwt-secret-change-in-production"
_JWT_ALGORITHM = "HS256"
# Team 模式是否强制验证（Phase21 启用）
_ENFORCE_AUTH = False

# 公开路径白名单（无需认证）
_PUBLIC_PATHS = {
    "/", "/index.html", "/favicon.ico",
    "/static", "/api/health", "/api/plugin-system/manifest",
    "/api/plugins",  # License 激活不需要登录
}


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
        is_public = any(path.startswith(p) for p in _PUBLIC_PATHS)
        
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
# 辅助函数
# ============================================================

def get_current_user(request: Request) -> dict:
    """在 API 处理函数中获取当前用户"""
    if hasattr(request.state, 'user'):
        return request.state.user
    return {"id": 1, "username": "admin", "role": "admin", "authenticated": False}


def login_user(db, username: str, password: str) -> Optional[str]:
    """
    用户登录验证（Phase21 实现完整逻辑）。
    Phase18: 仅 admin/admin 登录。
    返回 JWT token 或 None。
    """
    # Phase18 简化：admin 无密码登录
    if username == "admin" and password in ("admin", ""):
        payload = {
            "user_id": 1,
            "username": "admin",
            "role": "admin",
            "iat": int(time.time()),
            "exp": int(time.time()) + 86400 * 7,  # 7天
        }
        return create_jwt(payload)
    
    # Phase21: 查 users 表验证 bcrypt 密码
    return None


# ============================================================
# 开发工具
# ============================================================

def generate_test_token(user_id=1, username="admin", role="admin"):
    """生成测试 JWT token"""
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
