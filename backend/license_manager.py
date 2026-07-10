"""
PromptKit License 管理器 — 客户端验证（开源版）
Phase18 v5.1.0

@license MIT
@boundary OPEN-SOURCE — 仅包含客户端验证逻辑（decode + verify + store）。
        License 签发/签名/生成工具位于私有仓库 tools/license_server.py。
        公钥 _PUBLIC_KEY_PEM 为公开信息，不构成泄密。
        详见 docs/REPO_ISOLATION.md

个人版 (Personal): 格式校验 + 机器指纹绑定 + 加密存储 → 买断制
团队版 (Team):   格式校验 + 定期联网 + 宽限期 + 降级策略 → 订阅制
"""

import json
import time
import hashlib
import base64
import platform
import uuid
import subprocess
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, Tuple, Dict
from enum import Enum

# ============================================================
# 嵌入的公钥（验证用 — 与 tools/license_server.py 私钥配对）
# ⚠️ 生产部署前替换为正式公钥
# ============================================================

_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxWtx7tZmR9xv3UOtFjue
UqovR0YfI0EPcGDFRj5OHInqEGUWUJVkDQqS3silwqRWS/gLJT1AxxbN8zEFCIWJ
yizRA6I3sFhpjYS24LVuxSXPbiTTN3oM8jiCp/4FmuJU9/neFDd+63HRwl+ktMk3
qMaOnJgjxT2Fhg9sKEYQNeHLf4SaeM2ST3REjvTZ4eN3V+HFKI7+TGncz4ZIRfwr
HawKoWOLbomc2k+nv9XcyIyHYQ6kQjmQFBrhTy4B4NpSQ757pa8SnTdeNTEJA+xp
Lwovz76KY1BunVg4PHBmLMgQFri8FAqel5GhQrxiU3D5yh70lnSBbUSnVnfyXb+5
nQIDAQAB
-----END PUBLIC KEY-----"""

# 日志（兼容独立使用）
try:
    from logger import info as log_info, warn as log_warn, error as log_error
except ImportError:
    log_info = lambda m: print(f"[INFO] {m}")
    log_warn = lambda m: print(f"[WARN] {m}")
    log_error = lambda m: print(f"[ERROR] {m}")


# ============================================================
# 常量
# ============================================================

class LicenseTier(Enum):
    FREE = "free"
    PERSONAL = "personal"
    TEAM = "team"


class LicenseStatus(Enum):
    UNACTIVATED = "unactivated"
    ACTIVE = "active"
    GRACE_PERIOD = "grace_period"
    EXPIRED = "expired"
    READONLY = "readonly"
    TAMPERED = "tampered"
    ERROR = "error"


@dataclass
class LicenseInfo:
    plugin_id: str = ""
    tier: LicenseTier = LicenseTier.FREE
    status: LicenseStatus = LicenseStatus.UNACTIVATED
    expires_at: Optional[str] = None
    activated_at: Optional[str] = None
    seat_count: int = 1
    order_id: str = ""
    last_verify_at: Optional[str] = None
    verify_fail_count: int = 0
    message: str = ""


GRACE_PERIOD_DAYS = 14
VERIFY_INTERVAL_DAYS = 7
MAX_BIND_CHANGE_PER_YEAR = 2


# ============================================================
# 密码学工具（仅客户端验证用）
# ============================================================

def _rsa_verify(data: str, signature_b64: str, public_pem: str = None) -> bool:
    """RSA-SHA256 验签"""
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        pem = public_pem or _PUBLIC_KEY_PEM
        public_key = serialization.load_pem_public_key(pem.encode())
        signature = base64.b64decode(signature_b64)
        public_key.verify(signature, data.encode(), padding.PKCS1v15(), hashes.SHA256())
        return True
    except Exception:
        return False


def _aes_encrypt(data: str, key: bytes) -> str:
    """AES-256-GCM 加密 → base64"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)  # noqa (builtin)
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(nonce, data.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def _aes_decrypt(encrypted_b64: str, key: bytes) -> Optional[str]:
    """AES-256-GCM 解密"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    try:
        raw = base64.b64decode(encrypted_b64)
        nonce, ct = raw[:12], raw[12:]
        aesgcm = AESGCM(key)
        return aesgcm.decrypt(nonce, ct, None).decode()
    except Exception:
        return None


def _derive_aes_key() -> bytes:
    """从机器指纹派生 AES 密钥"""
    return hashlib.sha256(f"pk-aes-{get_machine_fingerprint()}".encode()).digest()


# ============================================================
# 机器指纹
# ============================================================

def get_machine_fingerprint() -> str:
    """生成机器指纹（MAC + 主机名 + 磁盘序列号）"""
    parts = [str(uuid.getnode()), platform.node()]
    if sys.platform == "win32":
        try:
            import subprocess as _sp
            r = _sp.run(["wmic", "diskdrive", "get", "serialnumber"],
                       capture_output=True, text=True, timeout=5)
            serials = [s.strip() for s in r.stdout.splitlines() if s.strip() and "SerialNumber" not in s]
            parts.append(serials[0] if serials else "unknown-disk")
        except Exception:
            parts.append("unknown-disk")
    else:
        parts.append("non-win")
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


# ============================================================
# License Key 解码（公开算法）
# ============================================================

def decode_license_key(license_key: str) -> Optional[dict]:
    """
    解码 License Key — 格式校验 + 载荷提取。
    完整的 RSA 签名验证由工具链或授权服务器执行。
    返回载荷字典 或 None。
    """
    try:
        key = license_key.strip()
        if key.upper().startswith("PK-"):
            key = key[3:]

        parts = key.split("-", 1)
        if len(parts) != 2:
            return None

        key_body = parts[1].replace("-", "").replace(" ", "")

        dot_idx = key_body.rfind(".")
        if dot_idx == -1:
            return None

        payload_b64 = key_body[:dot_idx]

        padding = 4 - (len(payload_b64) % 4)
        if padding != 4:
            payload_b64 += "=" * padding

        raw = base64.b64decode(payload_b64)
        return json.loads(raw)
    except Exception as e:
        log_error(f"[License] Key 解码失败: {e}")
        return None


# ============================================================
# 时间安全
# ============================================================

def _get_safe_time(db=None) -> float:
    """防时钟回退的安全时间"""
    now = time.time()
    if db is not None:
        try:
            row = db.execute(
                "SELECT config_value FROM plugin_configs WHERE plugin_id='com.promptkit.core' AND config_key='last_known_time'"
            ).fetchone()
            if row and row[0]:
                last_time = float(row[0])
                if last_time > now:
                    log_warn(f"[License] 检测到时钟回退: sys={now}, rec={last_time}")
                    return last_time
        except Exception:
            pass
        try:
            db.execute(
                "INSERT OR REPLACE INTO plugin_configs (plugin_id, config_key, config_value, updated_at) VALUES ('com.promptkit.core', 'last_known_time', ?, datetime('now'))",
                (str(now),))
        except Exception:
            pass
    return now


def _get_db():
    try:
        from database import get_db as _get
        return _get()
    except Exception:
        return None


# ============================================================
# License Manager
# ============================================================

class LicenseManager:
    _instance: Optional["LicenseManager"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._license_dir = Path("data") / "licenses"
        self._license_dir.mkdir(parents=True, exist_ok=True)
        self._initialized = True

    # --- 个人版 ---

    def activate_personal(self, plugin_id: str, license_key: str) -> Tuple[bool, str]:
        db = _get_db()
        if db is None:
            return False, "数据库不可用"

        payload = decode_license_key(license_key)
        if payload is None:
            return False, "License Key 格式无效"
        if payload.get("tier") != "personal":
            return False, "此 Key 不是个人版 License"

        current_fp = get_machine_fingerprint()
        bound_fp = payload.get("machine_hash", "")
        if bound_fp and bound_fp != current_fp:
            change_count = self._get_bind_change_count(db, plugin_id, payload.get("order_id", ""))
            if change_count >= MAX_BIND_CHANGE_PER_YEAR:
                return False, f"已达到年度换机次数上限 ({MAX_BIND_CHANGE_PER_YEAR}次/年)"
            self._incr_bind_change_count(db, plugin_id, payload.get("order_id", ""))

        aes_key = _derive_aes_key()
        encrypted = _aes_encrypt(license_key, aes_key)
        try:
            db.execute(
                "INSERT OR REPLACE INTO plugin_licenses (plugin_id, license_key_enc, activated_at, expires_at, machine_hash, signature, license_tier, seat_count, last_verify_at) VALUES (?, ?, datetime('now'), NULL, ?, ?, 'personal', 1, datetime('now'))",
                (plugin_id, encrypted, current_fp, license_key[:64]))
            db.execute(
                "INSERT OR REPLACE INTO plugin_registry (plugin_id, name, version, enabled, license_tier, updated_at) VALUES (?, 'Personal Plugin', '1.0.0', 1, 'personal', datetime('now'))",
                (plugin_id,))
            from database import safe_commit
            safe_commit()
            log_info(f"[License] 个人版激活成功: {plugin_id}")
            return True, "个人版 License 激活成功！永久有效。"
        except Exception as e:
            log_error(f"[License] 激活存储失败: {e}")
            return False, f"激活失败: {e}"

    def verify_personal(self, plugin_id: str) -> LicenseInfo:
        info = LicenseInfo(plugin_id=plugin_id, tier=LicenseTier.PERSONAL)
        db = _get_db()
        if db is None:
            info.status = LicenseStatus.ERROR; info.message = "数据库不可用"; return info
        try:
            row = db.execute(
                "SELECT license_key_enc, machine_hash, activated_at FROM plugin_licenses WHERE plugin_id=? AND license_tier='personal'",
                (plugin_id,)).fetchone()
            if not row:
                info.status = LicenseStatus.UNACTIVATED; info.message = "未激活"; return info
            encrypted_key, stored_fp, info.activated_at = row
            license_key = _aes_decrypt(encrypted_key, _derive_aes_key())
            if license_key is None:
                info.status = LicenseStatus.TAMPERED; info.message = "License 解密失败"; return info
            current_fp = get_machine_fingerprint()
            if stored_fp and stored_fp != current_fp:
                info.status = LicenseStatus.TAMPERED; info.message = "机器指纹不匹配"; return info
            info.status = LicenseStatus.ACTIVE; info.message = "已激活（个人版永久有效）"
            return info
        except Exception as e:
            info.status = LicenseStatus.ERROR; info.message = str(e); return info

    # --- 团队版 ---

    def activate_team(self, plugin_id: str, license_key: str,
                      auth_server_url: str = "") -> Tuple[bool, str]:
        db = _get_db()
        if db is None:
            return False, "数据库不可用"

        payload = decode_license_key(license_key)
        if payload is None:
            return False, "License Key 格式无效"
        if payload.get("tier") != "team":
            return False, "此 Key 不是团队版 License"

        expires_str = payload.get("expires_at", "")
        if expires_str:
            try:
                if _get_safe_time(db) > datetime.fromisoformat(expires_str).timestamp():
                    return False, f"License 已于 {expires_str} 过期"
            except ValueError:
                pass

        seat_count = int(payload.get("seat_count", 5))

        if auth_server_url:
            ok, msg = self._verify_online(license_key, auth_server_url)
            if not ok:
                return False, f"在线验证失败: {msg}"

        aes_key = _derive_aes_key()
        encrypted = _aes_encrypt(license_key, aes_key)
        try:
            db.execute(
                "INSERT OR REPLACE INTO plugin_licenses (plugin_id, license_key_enc, activated_at, expires_at, machine_hash, signature, license_tier, seat_count, last_verify_at) VALUES (?, ?, datetime('now'), ?, ?, ?, 'team', ?, datetime('now'))",
                (plugin_id, encrypted, expires_str, get_machine_fingerprint(), license_key[:64], seat_count))
            db.execute(
                "INSERT OR REPLACE INTO plugin_registry (plugin_id, name, version, enabled, license_tier, updated_at) VALUES (?, 'Team Plugin', '1.0.0', 1, 'team', datetime('now'))",
                (plugin_id,))
            from database import safe_commit
            safe_commit()
            log_info(f"[License] 团队版激活成功: {plugin_id} ({seat_count}席)")
            return True, f"团队版 License 激活成功！{seat_count}席位，有效期至 {expires_str}"
        except Exception as e:
            log_error(f"[License] 激活存储失败: {e}")
            return False, f"激活失败: {e}"

    def verify_team(self, plugin_id: str, auth_server_url: str = "") -> LicenseInfo:
        info = LicenseInfo(plugin_id=plugin_id, tier=LicenseTier.TEAM)
        db = _get_db()
        if db is None:
            info.status = LicenseStatus.ERROR; info.message = "数据库不可用"; return info
        try:
            row = db.execute(
                "SELECT license_key_enc, expires_at, activated_at, seat_count, last_verify_at, verify_fail_count FROM plugin_licenses WHERE plugin_id=? AND license_tier='team'",
                (plugin_id,)).fetchone()
            if not row:
                info.status = LicenseStatus.UNACTIVATED; info.message = "未激活"; return info

            encrypted_key, expires_str, activated_at, seat_count, last_verify, fail_count = row
            info.activated_at = activated_at
            info.seat_count = seat_count or 5
            info.last_verify_at = last_verify
            info.verify_fail_count = fail_count or 0

            now = _get_safe_time(db)
            now_dt = datetime.fromtimestamp(now)

            if expires_str:
                try:
                    if now_dt > datetime.fromisoformat(expires_str):
                        info.status = LicenseStatus.EXPIRED; info.expires_at = expires_str
                        info.message = f"订阅已于 {expires_str} 到期，已降级为只读"; return info
                except ValueError:
                    pass

            if last_verify:
                try:
                    days_offline = (now_dt - datetime.fromisoformat(last_verify)).days
                    if days_offline > GRACE_PERIOD_DAYS * 2:
                        info.status = LicenseStatus.READONLY
                        info.message = f"离线超{days_offline}天，已冻结。请联网校验。"; return info
                    elif days_offline > GRACE_PERIOD_DAYS:
                        info.status = LicenseStatus.READONLY
                        info.message = f"离线{days_offline}天，已降级只读"; return info
                    elif days_offline > VERIFY_INTERVAL_DAYS:
                        info.status = LicenseStatus.GRACE_PERIOD
                        info.message = f"离线{days_offline}天，请尽快联网"; return info
                except ValueError:
                    pass

            if auth_server_url:
                self._verify_online_heartbeat(plugin_id, auth_server_url, db)

            info.status = LicenseStatus.ACTIVE; info.expires_at = expires_str; info.message = "已激活"
            return info
        except Exception as e:
            info.status = LicenseStatus.ERROR; info.message = str(e); return info

    # --- 通用 ---

    def activate(self, plugin_id: str, license_key: str,
                 tier: str = "", auth_server_url: str = "") -> Tuple[bool, str]:
        key_upper = license_key.strip().upper()
        if "PK-PERS" in key_upper or tier == "personal":
            return self.activate_personal(plugin_id, license_key)
        elif "PK-TEAM" in key_upper or tier == "team":
            return self.activate_team(plugin_id, license_key, auth_server_url)
        return False, f"不支持的 License 类型"

    def verify(self, plugin_id: str, auth_server_url: str = "") -> LicenseInfo:
        db = _get_db()
        if db is None:
            return LicenseInfo(plugin_id=plugin_id, status=LicenseStatus.ERROR, message="数据库不可用")
        try:
            row = db.execute("SELECT license_tier FROM plugin_licenses WHERE plugin_id=?", (plugin_id,)).fetchone()
            if not row:
                return LicenseInfo(plugin_id=plugin_id, status=LicenseStatus.UNACTIVATED, message="未激活")
            tier = row[0]
            if tier == "personal":
                return self.verify_personal(plugin_id)
            elif tier == "team":
                return self.verify_team(plugin_id, auth_server_url)
            return LicenseInfo(plugin_id=plugin_id, tier=LicenseTier.FREE, status=LicenseStatus.ACTIVE)
        except Exception as e:
            return LicenseInfo(plugin_id=plugin_id, status=LicenseStatus.ERROR, message=str(e))

    def deactivate(self, plugin_id: str) -> Tuple[bool, str]:
        db = _get_db()
        if db is None:
            return False, "数据库不可用"
        try:
            row = db.execute("SELECT license_key_enc, license_tier FROM plugin_licenses WHERE plugin_id=?", (plugin_id,)).fetchone()
            if not row:
                return False, "未找到 License"
            encrypted_key, tier = row
            license_key = _aes_decrypt(encrypted_key, _derive_aes_key())
            deactivate_code = base64.urlsafe_b64encode(
                f"{license_key}:deactivate:{int(time.time())}".encode()).decode().rstrip("=")
            db.execute("DELETE FROM plugin_licenses WHERE plugin_id=?", (plugin_id,))
            db.execute("DELETE FROM plugin_registry WHERE plugin_id=?", (plugin_id,))
            from database import safe_commit
            safe_commit()
            log_info(f"[License] 已解除激活: {plugin_id}")
            return True, deactivate_code
        except Exception as e:
            log_error(f"[License] 解除激活失败: {e}")
            return False, str(e)

    def get_status(self, plugin_id: str) -> dict:
        info = self.verify(plugin_id)
        return {
            "plugin_id": info.plugin_id, "tier": info.tier.value, "status": info.status.value,
            "activated_at": info.activated_at, "expires_at": info.expires_at,
            "seat_count": info.seat_count, "message": info.message,
        }

    def check_all_plugins(self) -> Dict[str, LicenseInfo]:
        db = _get_db()
        if db is None:
            return {}
        results = {}
        try:
            for row in db.execute("SELECT plugin_id, license_tier FROM plugin_licenses").fetchall():
                results[row[0]] = self.verify(row[0])
        except Exception as e:
            log_error(f"[License] 批量检查失败: {e}")
        return results

    # --- 内部辅助 ---

    def _verify_online(self, license_key: str, server_url: str) -> Tuple[bool, str]:
        try:
            import urllib.request
            url = f"{server_url.rstrip('/')}/api/license/activate"
            data = json.dumps({"license_key": license_key, "machine_fingerprint": get_machine_fingerprint(), "timestamp": int(time.time())}).encode()
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read())
                return result.get("success", False), result.get("message", "")
        except Exception as e:
            log_warn(f"[License] 在线验证无法连接: {e}")
            return True, "offline_fallback"

    def _verify_online_heartbeat(self, plugin_id: str, server_url: str, db) -> bool:
        try:
            import urllib.request
            url = f"{server_url.rstrip('/')}/api/license/heartbeat"
            data = json.dumps({"plugin_id": plugin_id, "machine_fingerprint": get_machine_fingerprint(), "timestamp": int(time.time())}).encode()
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read())
                db.execute("UPDATE plugin_licenses SET last_verify_at=datetime('now'), verify_fail_count=0 WHERE plugin_id=?", (plugin_id,))
                from database import safe_commit; safe_commit()
                return result.get("success", False)
        except Exception:
            try:
                db.execute("UPDATE plugin_licenses SET verify_fail_count=verify_fail_count+1 WHERE plugin_id=?", (plugin_id,))
                from database import safe_commit; safe_commit()
            except Exception:
                pass
            return False

    def _get_bind_change_count(self, db, plugin_id: str, order_id: str) -> int:
        try:
            row = db.execute("SELECT config_value FROM plugin_configs WHERE plugin_id=? AND config_key=?", (plugin_id, f"bind_change_{order_id}")).fetchone()
            if row:
                data = json.loads(row[0])
                if data.get("year") == datetime.now().year:
                    return data.get("count", 0)
        except Exception:
            pass
        return 0

    def _incr_bind_change_count(self, db, plugin_id: str, order_id: str):
        current = self._get_bind_change_count(db, plugin_id, order_id)
        db.execute("INSERT OR REPLACE INTO plugin_configs (plugin_id, config_key, config_value, updated_at) VALUES (?, ?, ?, datetime('now'))",
                   (plugin_id, f"bind_change_{order_id}", json.dumps({"year": datetime.now().year, "count": current + 1})))


def get_license_manager() -> LicenseManager:
    return LicenseManager()
