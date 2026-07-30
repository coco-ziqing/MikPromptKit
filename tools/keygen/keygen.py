# -*- coding: utf-8 -*-
"""
PromptKit 激活码生成器 — 独立工具
===================================
用于为 MikPromptKit 的个人项目版 / 团队项目版生成主机绑定的激活码。

用法（CLI）:
  python tools/keygen/keygen.py --tier personal --fingerprint <指纹> --days 365
  python tools/keygen/keygen.py --tier team    --fingerprint <指纹> --days 90

用法（代码）:
  from tools.keygen.keygen import generate_code, verify_code
  code = generate_code("personal", fingerprint_hex, days=365)
  result = verify_code(code, fingerprint_hex)

激活码格式: PKP-XXXX-XXXX-XXXX (个人版) / PKT-XXXX-XXXX-XXXX (团队版)
种子文件: data/.license_seed（自动生成，需与 MikPromptKit 共用同一 data 目录）
"""

import os
import sys
import hashlib
import hmac
import argparse
from pathlib import Path

# 种子文件路径：与 MikPromptKit 的 data/ 目录对齐
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
SEED_PATH = PROJECT_ROOT / "data" / ".license_seed"


def _load_or_create_seed() -> bytes:
    """加载种子密钥，不存在则生成并持久化"""
    if SEED_PATH.exists():
        return SEED_PATH.read_bytes()
    seed = os.urandom(32)
    SEED_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEED_PATH.write_bytes(seed)
    print(f"[Keygen] 已生成新种子密钥 → {SEED_PATH}")
    return seed


def generate_code(tier: str, fingerprint: str, days: int = 365) -> str:
    """
    生成带 HMAC 签名的激活码。

    Args:
        tier: 'personal' 或 'team'
        fingerprint: 目标主机的机器指纹（32位hex，从 /api/license/info 获取）
        days: 有效天数，0 表示永久

    Returns:
        激活码字符串，格式 PKP-XXXX-XXXX-XXXX 或 PKT-XXXX-XXXX-XXXX
    """
    if tier not in ("personal", "team"):
        raise ValueError(f"无效的 tier: {tier}，仅支持 personal 或 team")
    if len(fingerprint) < 8:
        raise ValueError("fingerprint 长度不足（至少8位hex）")

    seed = _load_or_create_seed()
    prefix = "PKP" if tier == "personal" else "PKT"

    # payload: tier(8) + days(4) + fingerprint(32) = 44 bytes hex
    payload = f"{tier[:8]:<8}{days:04d}{fingerprint[:32]}"

    # HMAC-SHA256 签名
    sig = hmac.new(seed, payload.encode(), hashlib.sha256).hexdigest()[:12]

    # 激活码格式: PKP-XXXX-XXXX-XXXX
    code = f"{prefix}-{sig[0:4]}-{sig[4:8]}-{sig[8:12]}"
    return code.upper()


def verify_code(code: str, fingerprint: str) -> dict:
    """
    校验激活码的有效性。

    Returns:
        {"valid": bool, "tier": str, "days": int, "fingerprint": str, "error": str}
    """
    import re

    seed = _load_or_create_seed()
    code = code.strip().upper()

    m = re.match(r'^(PKP|PKT)-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})$', code)
    if not m:
        return {"valid": False, "error": "激活码格式无效", "tier": "", "days": 0, "fingerprint": ""}

    prefix = m.group(1)
    sig_given = (m.group(2) + m.group(3) + m.group(4)).lower()
    tier = "personal" if prefix == "PKP" else "team"

    # 尝试匹配 payload（覆盖所有常见有效期）
    for days in (0, 30, 90, 180, 365, 730, 1825):
        payload = f"{tier[:8]:<8}{days:04d}{fingerprint[:32]}"
        sig = hmac.new(seed, payload.encode(), hashlib.sha256).hexdigest()[:12]
        if sig == sig_given:
            return {"valid": True, "tier": tier, "days": days, "fingerprint": fingerprint}

    return {"valid": False, "error": "签名不匹配 — 此激活码不适用于本机", "tier": "", "days": 0, "fingerprint": ""}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="MikPromptKit 激活码生成器",
        epilog="指纹获取方式: 在目标主机访问 http://<ip>:8080/api/license/info 查看 fingerprint 字段"
    )
    parser.add_argument("--tier", required=True, choices=["personal", "team"],
                        help="版本: personal=个人项目版, team=团队项目版")
    parser.add_argument("--days", type=int, default=365,
                        help="有效期天数，0=永久 (默认365)")
    parser.add_argument("--fingerprint", required=True,
                        help="目标主机指纹（32位hex）")

    args = parser.parse_args()
    code = generate_code(args.tier, args.fingerprint, args.days)

    label = "个人项目版" if args.tier == "personal" else "团队项目版"
    days_label = "永久" if args.days == 0 else f"{args.days}天"

    print(f"\n{'=' * 52}")
    print(f"  🔐 {label} 激活码")
    print(f"  {'=' * 52}")
    print(f"  指纹    : {args.fingerprint}")
    print(f"  有效期  : {days_label}")
    print(f"  激活码  : {code}")
    print(f"  {'=' * 52}")
    print(f"\n  在目标主机的激活窗口中输入此激活码即可。\n")
