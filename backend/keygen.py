# -*- coding: utf-8 -*-
"""
PromptKit 激活码生成器
用法:
  python backend/keygen.py --tier personal --days 365 --fingerprint <机器指纹>
  python backend/keygen.py --tier team    --days 90  --fingerprint <机器指纹>

生成的是带 HMAC 签名的激活码，格式: PKP-XXXX-XXXX-XXXX (personal) / PKT-XXXX-XXXX-XXXX (team)
只有对应指纹的主机能激活。
"""

import os
import sys
import hashlib
import hmac
import base64
import argparse
from pathlib import Path

SEED_PATH = Path(__file__).resolve().parent.parent / "data" / ".license_seed"


def _load_or_create_seed() -> bytes:
    """加载种子密钥，不存在则生成并持久化"""
    if SEED_PATH.exists():
        return SEED_PATH.read_bytes()
    seed = os.urandom(32)
    SEED_PATH.write_bytes(seed)
    print(f"[Keygen] 已生成新种子密钥 → {SEED_PATH}")
    return seed


def generate_code(tier: str, fingerprint: str, days: int = 365) -> str:
    """
    生成带签名的激活码。
    
    Args:
        tier: 'personal' 或 'team'
        fingerprint: 目标主机的 _machine_fingerprint() 返回值（32位hex）
        days: 有效天数，0 表示永久

    Returns:
        格式为 PKP-XXXX-XXXX-XXXX 或 PKT-XXXX-XXXX-XXXX 的激活码
    """
    if tier not in ("personal", "team"):
        raise ValueError(f"无效的 tier: {tier}")
    if len(fingerprint) < 8:
        raise ValueError("fingerprint 长度不足（至少8位hex）")

    seed = _load_or_create_seed()
    prefix = "PKP" if tier == "personal" else "PKT"

    # payload: tier(8) + days(4) + fingerprint(32) = 44 bytes hex
    payload = f"{tier[:8]:<8}{days:04d}{fingerprint[:32]}"
    
    # HMAC-SHA256 签名
    sig = hmac.new(seed, payload.encode(), hashlib.sha256).hexdigest()[:12]
    
    # 激活码: prefix(3) + sig(12) → 分4段
    code = f"{prefix}-{sig[0:4]}-{sig[4:8]}-{sig[8:12]}"
    return code.upper()


def verify_code(code: str, fingerprint: str) -> dict:
    """
    校验激活码的有效性。
    
    Returns:
        {"valid": bool, "tier": str, "days": int, "fingerprint": str, "error": str}
    """
    seed = _load_or_create_seed()
    code = code.strip().upper()

    import re
    m = re.match(r'^(PKP|PKT)-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})$', code)
    if not m:
        return {"valid": False, "error": "激活码格式无效", "tier": "", "days": 0, "fingerprint": ""}

    prefix = m.group(1)
    sig_given = (m.group(2) + m.group(3) + m.group(4)).lower()
    tier = "personal" if prefix == "PKP" else "team"

    # 尝试匹配 payload（tier+days — 覆盖所有可选有效期）
    for days in (0, 30, 90, 180, 365, 730, 1825):
        payload = f"{tier[:8]:<8}{days:04d}{fingerprint[:32]}"
        sig = hmac.new(seed, payload.encode(), hashlib.sha256).hexdigest()[:12]
        if sig == sig_given:
            return {"valid": True, "tier": tier, "days": days, "fingerprint": fingerprint}

    return {"valid": False, "error": "签名不匹配 — 此激活码不适用于本机", "tier": "", "days": 0, "fingerprint": ""}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PromptKit 激活码生成器")
    parser.add_argument("--tier", required=True, choices=["personal", "team"])
    parser.add_argument("--days", type=int, default=365, help="有效期天数，0=永久")
    parser.add_argument("--fingerprint", required=True, help="目标主机指纹 (/api/license/info 获取)")
    args = parser.parse_args()

    code = generate_code(args.tier, args.fingerprint, args.days)
    label = "个人版" if args.tier == "personal" else "团队版"
    print(f"\n{'='*50}")
    print(f"  {label}激活码")
    print(f"  指纹: {args.fingerprint}")
    print(f"  有效期: {'永久' if args.days==0 else f'{args.days}天'}")
    print(f"  激活码: {code}")
    print(f"{'='*50}\n")
