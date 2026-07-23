# -*- coding: utf-8 -*-
"""
PromptKit 许可激活 API — 个人项目版 / 团队项目版 主机绑定+秘钥激活

端点:
  GET  /api/license/info         — 获取本机许可状态（含指纹）
  POST /api/license/activate     — 激活许可（输入激活码）
  DELETE /api/license/deactivate — 解除激活

数据存放: data/licenses/<tier>.json（per-tier 一个许可文件）
"""

import os
import sys
import json
import uuid
import hashlib
import subprocess
import platform
import time
import sqlite3
from pathlib import Path
from fastapi import APIRouter, Request, HTTPException, Body
from typing import Optional

router = APIRouter(tags=["许可管理"], prefix="/api/license")

# 路径
HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from paths import get_data_dir
    DATA_DIR = get_data_dir()
except Exception:
    DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "data"))
LICENSE_DIR = os.path.join(DATA_DIR, "licenses")
os.makedirs(LICENSE_DIR, exist_ok=True)

# ── 主机指纹 ──
def _machine_fingerprint() -> str:
    """生成主机唯一指纹：基于磁盘序列号 + 主板UUID"""
    parts = []
    try:
        if sys.platform == 'win32':
            # 系统盘序列号
            r = subprocess.run(["wmic", "diskdrive", "get", "serialnumber"],
                               capture_output=True, text=True, timeout=5)
            sn = r.stdout.strip().split("\n")[-1].strip()
            if sn and sn != "SerialNumber":
                parts.append(sn)
    except Exception:
        pass
    try:
        # 主板 UUID
        if sys.platform == 'win32':
            r = subprocess.run(["wmic", "csproduct", "get", "UUID"],
                               capture_output=True, text=True, timeout=5)
            mb = r.stdout.strip().split("\n")[-1].strip()
            if mb and mb != "UUID":
                parts.append(mb)
    except Exception:
        pass
    # 兜底：Mac地址 + 主机名
    if not parts:
        parts.append(platform.node())
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _tier_path(tier: str) -> str:
    return os.path.join(LICENSE_DIR, f"{tier}.json")


def _read_license(tier: str) -> Optional[dict]:
    p = _tier_path(tier)
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_license(tier: str, data: dict):
    with open(_tier_path(tier), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── API ──

@router.get("/info")
def license_info():
    """获取当前所有许可状态 + 本机指纹"""
    fp = _machine_fingerprint()
    result = {
        "fingerprint": fp,
        "tiers": {},
        "library_free": True,
    }
    for tier in ("personal", "team"):
        lic = _read_license(tier)
        if lic:
            result["tiers"][tier] = {
                "active": True,
                "bound": lic.get("fingerprint") == fp,
                "activated_at": lic.get("activated_at", ""),
                "expires": lic.get("expires", ""),
            }
        else:
            result["tiers"][tier] = {
                "active": False,
                "bound": False,
            }
    return {"ok": True, **result}


@router.post("/activate")
def activate_license(data: dict = Body(...)):
    """激活许可 — HMAC签名验证 + 主机绑定"""
    code = (data.get("code") or "").strip()
    tier = (data.get("tier") or "").strip()
    if not code or tier not in ("personal", "team"):
        raise HTTPException(400, "参数错误：code + tier(personal|team) 必填")

    # HMAC 签名验证（使用 keygen.py 的种子密钥）
    try:
        from keygen import verify_code
    except ImportError:
        verify_code = None

    fp = _machine_fingerprint()
    licensed_to = ""
    expires = ""
    days = 0

    if verify_code:
        result = verify_code(code, fp)
        if not result["valid"]:
            raise HTTPException(400, result.get("error", "激活码无效"))
        tier_check = result.get("tier", "")
        if tier_check and tier_check != tier:
            raise HTTPException(400, f"这是{tier_check}版的激活码，不能用于{tier}版")
        licensed_to = "个人版许可" if tier == "personal" else "团队版许可"
        days = result.get("days", 0)
        if days > 0:
            expires = time.strftime("%Y-%m-%d", time.localtime(time.time() + days * 86400))
    else:
        # 降级模式：仅格式校验（首次运行 keygen.py 生成 seed 后自动启用签名验证）
        import re
        pattern = r'^PK[PT]-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$'
        if not re.match(pattern, code, re.IGNORECASE):
            raise HTTPException(400, "激活码格式无效。请先运行 python backend/keygen.py --help 生成激活码")
        licensed_to = "个人版许可" if tier == "personal" else "团队版许可"

    # 检查是否已绑定其他主机
    existing = _read_license(tier)
    if existing and existing.get("fingerprint") and existing["fingerprint"] != fp:
        raise HTTPException(403, f"该许可已绑定到另一台主机（指纹 {existing['fingerprint'][:8]}...），请先在原主机解除激活")

    license_data = {
        "tier": tier,
        "code": code[:8] + "***",
        "fingerprint": fp,
        "licensed_to": licensed_to,
        "activated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "expires": expires,
        "days": days,
        "machine_name": platform.node(),
    }
    _write_license(tier, license_data)
    return {"ok": True, "message": f"{'个人项目版' if tier == 'personal' else '团队项目版'}已激活", "fingerprint": fp, "expires": expires}


@router.delete("/deactivate")
def deactivate_license(data: dict = Body(...)):
    """解除激活 — 仅管理员"""
    tier = (data.get("tier") or "").strip()
    if tier not in ("personal", "team"):
        raise HTTPException(400, "参数错误：tier(personal|team) 必填")
    p = _tier_path(tier)
    if os.path.exists(p):
        os.remove(p)
    return {"ok": True, "message": f"{'个人项目版' if tier == 'personal' else '团队项目版'}已解除激活"}


@router.post("/generate")
def generate_activation_code(data: dict = Body(...)):
    """生成激活码 — 管理员工具，需提供目标主机指纹"""
    tier = (data.get("tier") or "").strip()
    fingerprint = (data.get("fingerprint") or "").strip()
    days = int(data.get("days", 365))
    if tier not in ("personal", "team"):
        raise HTTPException(400, "参数错误：tier 必须为 personal 或 team")
    if len(fingerprint) < 8:
        raise HTTPException(400, "fingerprint 长度不足")
    try:
        from keygen import generate_code
        code = generate_code(tier, fingerprint, days)
        return {"ok": True, "code": code, "tier": tier, "days": days, "fingerprint": fingerprint[:8] + "..."}
    except Exception as e:
        raise HTTPException(500, f"生成失败: {str(e)}")
