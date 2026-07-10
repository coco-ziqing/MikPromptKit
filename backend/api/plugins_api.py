"""
插件 License 管理 API
Phase18 v5.1.0

端点:
  POST /api/plugins/{plugin_id}/activate  激活 License
  GET  /api/plugins/{plugin_id}/status    查询状态
  POST /api/plugins/{plugin_id}/deactivate 解除激活
  GET  /api/plugin-system/licenses         所有插件 License 状态
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from license_manager import get_license_manager

router = APIRouter(prefix="/api/plugins", tags=["插件License"])


@router.post("/{plugin_id}/activate")
async def activate_license(plugin_id: str, request: Request):
    """
    激活插件 License。
    请求体: {license_key, tier, auth_server_url}
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "message": "请求体格式错误"}, status_code=400)
    
    license_key = body.get("license_key", "").strip()
    tier = body.get("tier", "")
    auth_server_url = body.get("auth_server_url", "")
    
    if not license_key:
        return JSONResponse({"success": False, "message": "请输入 License Key"}, status_code=400)
    
    lm = get_license_manager()
    ok, msg = lm.activate(plugin_id, license_key, tier, auth_server_url)
    
    if ok:
        return {"success": True, "message": msg, "plugin_id": plugin_id}
    else:
        return JSONResponse({"success": False, "message": msg, "plugin_id": plugin_id}, status_code=400)


@router.get("/{plugin_id}/status")
async def get_license_status(plugin_id: str):
    """查询插件 License 状态"""
    lm = get_license_manager()
    status = lm.get_status(plugin_id)
    return {"success": True, "data": status}


@router.post("/{plugin_id}/deactivate")
async def deactivate_license(plugin_id: str):
    """解除激活（生成注销码）"""
    lm = get_license_manager()
    ok, msg = lm.deactivate(plugin_id)
    
    if ok:
        return {
            "success": True,
            "message": "已解除激活",
            "deactivate_code": msg,
        }
    else:
        return JSONResponse({"success": False, "message": msg}, status_code=400)


@router.get("/system/licenses")
async def list_all_licenses():
    """列出所有插件 License 状态"""
    lm = get_license_manager()
    results = lm.check_all_plugins()
    
    data = {}
    for pid, info in results.items():
        data[pid] = lm.get_status(pid)
    
    return {"success": True, "data": data}


# 全局授权服务器配置 API
@router.get("/system/auth-server")
async def get_auth_server_config():
    """获取授权服务器配置"""
    try:
        from database import get_db
        db = get_db()
        row = db.execute(
            "SELECT config_value FROM plugin_configs WHERE plugin_id='com.promptkit.core' AND config_key='auth_server_url'"
        ).fetchone()
        url = row[0] if row else ""
        return {"success": True, "data": {"auth_server_url": url}}
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@router.post("/system/auth-server")
async def set_auth_server_config(request: Request):
    """设置授权服务器配置"""
    try:
        body = await request.json()
        url = body.get("auth_server_url", "").strip()
        
        from database import get_db, safe_commit
        db = get_db()
        db.execute(
            "INSERT OR REPLACE INTO plugin_configs (plugin_id, config_key, config_value, updated_at) VALUES ('com.promptkit.core', 'auth_server_url', ?, datetime('now'))",
            (url,)
        )
        safe_commit()
        return {"success": True, "message": "授权服务器配置已更新"}
    except Exception as e:
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)
