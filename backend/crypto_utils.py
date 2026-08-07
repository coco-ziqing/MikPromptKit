"""
Phase38-security: 加密工具 — AES-256-GCM 加解密
与 license_manager.py 一致，供密钥管理模块复用。
密钥派生: PBKDF2(机器指纹 + 固定盐) → 32 字节
"""
import base64
import os

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# 固定盐（不构成安全漏洞——此盐仅防止彩虹表，真正机密性靠派生密钥不可预测性）
_SALT = b"promptkit-api-keys-2026-v1"
_ITERATIONS = 200_000  # PBKDF2 迭代次数


def _derive_secret() -> bytes:
    """
    派生主密钥：PBKDF2(机器标识 + PID 空间标识, 盐, 200k 迭代) → 32 字节
    使用机器指纹 + 固定种子，确保：
    - 同机器同项目 → 相同密钥（可解密自身数据）
    - 不同机器 → 不同密钥（复制 DB 无法解密）
    - 开源 / Git 共享代码 → 密钥不在代码中
    """
    import platform
    import uuid
    # 机器指纹（与 license_manager 一致）
    fp_parts = [str(uuid.getnode()), platform.node()]
    try:
        import subprocess as sp
        r = sp.run(["wmic", "diskdrive", "get", "serialnumber"],
                   capture_output=True, text=True, timeout=5)
        serials = [s.strip() for s in r.stdout.splitlines() if s.strip() and "SerialNumber" not in s]
        fp_parts.append(serials[0] if serials else "unknown-disk")
    except Exception:
        fp_parts.append("unknown-disk")
    material = "pk-secrets|" + "|".join(fp_parts)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_SALT,
        iterations=_ITERATIONS,
        backend=default_backend()
    )
    return kdf.derive(material.encode("utf-8"))


def encrypt_api_key(plaintext: str) -> str:
    """加密 API Key → base64 字符串"""
    if not plaintext:
        return ""
    key = _derive_secret()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("ascii")


def decrypt_api_key(encrypted_b64: str) -> str:
    """解密 base64 字符串 → 明文 API Key，失败返回空字符串"""
    if not encrypted_b64:
        return ""
    key = _derive_secret()
    try:
        raw = base64.b64decode(encrypted_b64)
        nonce, ct = raw[:12], raw[12:]
        aesgcm = AESGCM(key)
        return aesgcm.decrypt(nonce, ct, None).decode("utf-8")
    except Exception:
        return ""


def mask_key(key: str, keep_prefix: int = 3, keep_suffix: int = 3) -> str:
    """脱敏显示: sk-aBc...XyZ"""
    if not key or len(key) <= keep_prefix + keep_suffix + 3:
        return "***"
    return key[:keep_prefix] + "…" + key[-keep_suffix:] if len(key) > 10 else key[:3] + "…"
