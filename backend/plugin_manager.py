"""
PromptKit 插件管理器 — 插件发现、加载、注册、生命周期、Hook 系统
Phase18: 插件框架核心 v5.1.0

@license MIT — 此文件属于开源核心，可自由使用和修改。
@boundary OPEN-SOURCE — 商业插件通过 PromptKitPlugin 基类实现，
        插件源码位于私有仓库 prompt-tool-dev-private/plugins/。
        详见 docs/REPO_ISOLATION.md
"""

import os
import sys
import json
import hashlib
import importlib
import importlib.util
import traceback
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable, Any
from enum import Enum

# 日志：优先用项目 logger，不可用时回退 print
try:
    from logger import info as log_info, warn as log_warn, error as log_error
except ImportError:
    import builtins
    log_info = lambda msg: builtins.print(f"[INFO] {msg}")
    log_warn = lambda msg: builtins.print(f"[WARN] {msg}")
    log_error = lambda msg: builtins.print(f"[ERROR] {msg}")


# ============================================================
# 数据模型
# ============================================================

class PluginStatus(Enum):
    """插件状态"""
    DISCOVERED = "discovered"      # 已发现，未加载
    LOADED = "loaded"              # 已加载
    ENABLED = "enabled"            # 已启用
    DISABLED = "disabled"          # 已禁用
    ERROR = "error"                # 加载失败


class LicenseTier(Enum):
    """插件许可级别"""
    FREE = "free"                  # 免费（内置/开源）
    PERSONAL = "personal"          # 个人版（买断）
    TEAM = "team"                  # 团队版（订阅）


@dataclass
class PluginManifest:
    """插件元数据 — 从 plugin.json 解析"""
    plugin_id: str                 # 唯一ID，如 "com.promptkit.project"
    name: str                      # 显示名
    version: str                   # 语义版本号
    min_core_version: str          # 最低核心版本
    author: str = ""
    description: str = ""
    license_tier: str = "free"     # free / personal / team
    dependencies: List[str] = field(default_factory=list)
    
    # 后端注入
    api_router_module: str = ""    # 相对路径，如 "api"
    db_migrations: List[str] = field(default_factory=list)  # SQL文件列表
    
    # 前端注入
    frontend_modules: List[dict] = field(default_factory=list)
    # [{name, url, nav_button: {slot, icon, label, view}, panel_slot: {id}}]
    
    # 钩子注册
    hooks: Dict[str, str] = field(default_factory=dict)
    # {"on_db_init": "hooks.on_db_init", "on_startup": "hooks.on_startup"}

    def to_dict(self) -> dict:
        return {
            "plugin_id": self.plugin_id,
            "name": self.name,
            "version": self.version,
            "min_core_version": self.min_core_version,
            "author": self.author,
            "description": self.description,
            "license_tier": self.license_tier,
            "dependencies": self.dependencies,
            "frontend_modules": self.frontend_modules,
        }


@dataclass
class PluginInstance:
    """已加载的插件实例"""
    manifest: PluginManifest
    status: PluginStatus = PluginStatus.DISCOVERED
    module: Any = None             # 插件 Python 模块
    instance: Any = None           # 插件类实例
    dir_name: str = ""             # 插件目录名（可能与 plugin_id 不同）
    error_message: str = ""
    license_active: bool = False
    config: dict = field(default_factory=dict)
    
    # 前端注入数据（插件提供的）
    nav_buttons: List[dict] = field(default_factory=list)
    panel_slots: List[dict] = field(default_factory=list)
    view_routes: List[dict] = field(default_factory=list)
    context_menus: List[dict] = field(default_factory=list)


# ============================================================
# 插件基类
# ============================================================

class PromptKitPlugin:
    """所有插件必须继承此基类"""
    
    plugin_id: str = ""
    manifest: Optional[PluginManifest] = None
    
    def __init__(self):
        self._hooks: Dict[str, Callable] = {}
    
    # ----- 生命周期 -----
    
    def on_load(self, app, db) -> bool:
        """
        插件加载时调用。返回 True 表示加载成功。
        此时数据库已就绪、FastAPI app 已创建但未启动。
        """
        return True
    
    def on_enable(self) -> bool:
        """插件启用时调用。返回 True 表示启用成功。"""
        return True
    
    def on_disable(self) -> bool:
        """插件禁用时调用。返回 True 表示禁用成功。"""
        return True
    
    def on_unload(self):
        """插件卸载时调用。清理资源。"""
        pass
    
    # ----- Hook 注册 -----
    
    def register_hook(self, name: str, callback: Callable):
        """注册一个钩子回调"""
        self._hooks[name] = callback
    
    def get_hook(self, name: str) -> Optional[Callable]:
        """获取钩子回调"""
        return self._hooks.get(name)
    
    # ----- API 路由 -----
    
    def get_api_router(self):
        """
        返回 FastAPI APIRouter 实例，或 None。
        路由会自动挂载到 /api/plugins/{plugin_id}/ 前缀。
        """
        return None
    
    # ----- 前端资源 -----
    
    def get_frontend_injections(self) -> dict:
        """
        返回前端注入描述:
        {
            "nav_buttons": [{slot: "right"|"left", icon: "bi-xxx", label: "...", view: "...", order: 0}],
            "panel_slots": [{id: "xxx", title: "...", position: "sidebar"|"panel"}],
            "view_routes": [{path: "xxx", title: "...", component: "..."}],
            "context_menus": [{target: "prompt_card", label: "...", action: "..."}],
            "styles": ["/plugins/{plugin_id}/style.css"],
            "scripts": ["/plugins/{plugin_id}/main.js"],
        }
        """
        return {}
    
    # ----- 数据库迁移 -----
    
    def get_migrations(self) -> List[dict]:
        """
        返回迁移列表:
        [{"name": "001_init", "sql": "CREATE TABLE ...", "rollback_sql": "DROP TABLE ..."}]
        """
        return []
    
    # ----- 配置 -----
    
    def get_default_config(self) -> dict:
        """返回默认配置"""
        return {}


# ============================================================
# 插件管理器
# ============================================================

class PluginManager:
    """插件管理器单例"""
    
    _instance: Optional["PluginManager"] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self.plugins: Dict[str, PluginInstance] = {}   # plugin_id → PluginInstance
        self.hook_registry: Dict[str, List[Callable]] = {}  # hook_name → [callback, ...]
        self.plugins_dir: Path = Path("plugins")
        self.disabled_dir: Path = Path("plugins/_disabled")
        self._initialized = True
        
        # 确保目录存在
        self.plugins_dir.mkdir(parents=True, exist_ok=True)
        self.disabled_dir.mkdir(parents=True, exist_ok=True)
    
    # ================================================================
    # 插件发现
    # ================================================================
    
    def discover(self) -> List[str]:
        """
        扫描 plugins/ 目录，发现所有有效插件。
        返回发现的 plugin_id 列表。
        """
        discovered = []
        
        if not self.plugins_dir.exists():
            log_warn(f"[PluginManager] 插件目录不存在: {self.plugins_dir}")
            return discovered
        
        for entry in self.plugins_dir.iterdir():
            if not entry.is_dir():
                continue
            if entry.name.startswith("_") or entry.name.startswith("."):
                continue
            
            manifest_path = entry / "plugin.json"
            if not manifest_path.exists():
                log_warn(f"[PluginManager] 跳过 {entry.name}: 缺少 plugin.json")
                continue
            
            try:
                manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest = self._parse_manifest(manifest_data)
                
                if manifest.plugin_id in self.plugins:
                    log_warn(f"[PluginManager] 插件 {manifest.plugin_id} 已存在，跳过重复发现")
                    continue
                
                # 检查依赖
                missing = self._check_dependencies(manifest)
                if missing:
                    log_warn(f"[PluginManager] {manifest.plugin_id} 缺少依赖: {missing}")
                    continue
                
                plugin = PluginInstance(
                    manifest=manifest,
                    status=PluginStatus.DISCOVERED,
                    dir_name=entry.name,
                    config=manifest_data.get("config", {}),
                )
                self.plugins[manifest.plugin_id] = plugin
                discovered.append(manifest.plugin_id)
                
                log_info(f"[PluginManager] 发现插件: {manifest.name} v{manifest.version}")
                
            except Exception as e:
                log_error(f"[PluginManager] 解析 {entry.name}/plugin.json 失败: {e}")
                continue
        
        return discovered
    
    # ================================================================
    # 插件加载
    # ================================================================
    
    def load(self, plugin_id: str, app=None, db=None) -> bool:
        """
        加载指定插件。
        返回 True 表示加载成功。
        """
        plugin = self.plugins.get(plugin_id)
        if not plugin:
            log_error(f"[PluginManager] 插件不存在: {plugin_id}")
            return False
        
        if plugin.status in (PluginStatus.ENABLED, PluginStatus.LOADED):
            log_info(f"[PluginManager] 插件 {plugin_id} 已加载，跳过")
            return True
        
        try:
            plugin_dir = self.plugins_dir / plugin.dir_name
            
            # 1. 动态导入插件模块
            # 确保插件能 import PromptKitPlugin：将当前模块注入为 'promptkit_plugin_base'
            sys.modules.setdefault('promptkit_plugin_base', sys.modules[__name__])
            
            module_path = str(plugin_dir / "__init__.py")
            spec = importlib.util.spec_from_file_location(
                f"promptkit_plugin_{plugin_id}",
                module_path
            )
            if spec is None or spec.loader is None:
                raise ImportError(f"无法加载模块: {module_path}")
            
            module = importlib.util.module_from_spec(spec)
            sys.modules[f"promptkit_plugin_{plugin_id}"] = module
            spec.loader.exec_module(module)
            plugin.module = module
            
            # 2. 查找插件类（继承 PromptKitPlugin）
            plugin_cls = self._find_plugin_class(module)
            if plugin_cls is None:
                raise ValueError(f"插件 {plugin_id} 未找到继承 PromptKitPlugin 的类")
            
            # 3. 实例化
            instance = plugin_cls()
            instance.plugin_id = plugin_id
            instance.manifest = plugin.manifest
            plugin.instance = instance
            
            # 4. 调用 on_load
            if app is not None and db is not None:
                if not instance.on_load(app, db):
                    plugin.status = PluginStatus.ERROR
                    plugin.error_message = "on_load() 返回 False"
                    return False
            
            plugin.status = PluginStatus.LOADED
            log_info(f"[PluginManager] 插件已加载: {plugin.manifest.name} v{plugin.manifest.version}")
            return True
            
        except Exception as e:
            plugin.status = PluginStatus.ERROR
            plugin.error_message = str(e)
            log_error(f"[PluginManager] 加载插件 {plugin_id} 失败: {e}")
            traceback.print_exc()
            return False
    
    def load_all(self, app=None, db=None) -> Dict[str, bool]:
        """
        加载所有发现的插件。
        返回 {plugin_id: success} 字典。
        """
        results = {}
        for plugin_id in list(self.plugins.keys()):
            results[plugin_id] = self.load(plugin_id, app, db)
        return results
    
    # ================================================================
    # 插件启用/禁用
    # ================================================================
    
    def enable(self, plugin_id: str) -> bool:
        """启用插件"""
        plugin = self.plugins.get(plugin_id)
        if not plugin:
            return False
        
        if plugin.status == PluginStatus.ERROR:
            log_error(f"[PluginManager] 无法启用错误状态的插件: {plugin_id}")
            return False
        
        if plugin.instance and hasattr(plugin.instance, 'on_enable'):
            if not plugin.instance.on_enable():
                return False
        
        plugin.status = PluginStatus.ENABLED
        log_info(f"[PluginManager] 插件已启用: {plugin_id}")
        return True
    
    def disable(self, plugin_id: str) -> bool:
        """禁用插件"""
        plugin = self.plugins.get(plugin_id)
        if not plugin:
            return False
        
        if plugin.instance and hasattr(plugin.instance, 'on_disable'):
            plugin.instance.on_disable()
        
        plugin.status = PluginStatus.DISABLED
        log_info(f"[PluginManager] 插件已禁用: {plugin_id}")
        return True
    
    def unload(self, plugin_id: str) -> bool:
        """卸载插件并清理资源"""
        plugin = self.plugins.get(plugin_id)
        if not plugin:
            return False
        
        # 先禁用
        if plugin.status == PluginStatus.ENABLED:
            self.disable(plugin_id)
        
        # 调用卸载
        if plugin.instance and hasattr(plugin.instance, 'on_unload'):
            plugin.instance.on_unload()
        
        # 从 sys.modules 移除
        module_name = f"promptkit_plugin_{plugin.dir_name}"
        if module_name in sys.modules:
            del sys.modules[module_name]
        
        plugin.instance = None
        plugin.module = None
        plugin.status = PluginStatus.DISCOVERED
        log_info(f"[PluginManager] 插件已卸载: {plugin_id}")
        return True
    
    def reload(self, plugin_id: str, app=None, db=None) -> bool:
        """重载插件（开发用）"""
        self.unload(plugin_id)
        return self.load(plugin_id, app, db)
    
    # ================================================================
    # Hook 系统
    # ================================================================
    
    def register_hook(self, hook_name: str, callback: Callable):
        """注册全局钩子"""
        if hook_name not in self.hook_registry:
            self.hook_registry[hook_name] = []
        self.hook_registry[hook_name].append(callback)
    
    def trigger_hook(self, hook_name: str, *args, **kwargs) -> List[Any]:
        """
        触发全局钩子，返回所有回调结果。
        仅触发已启用的插件。
        """
        results = []
        callbacks = self.hook_registry.get(hook_name, [])
        for cb in callbacks:
            try:
                results.append(cb(*args, **kwargs))
            except Exception as e:
                log_error(f"[PluginManager] Hook '{hook_name}' 回调异常: {e}")
        return results
    
    def collect_injections(self) -> dict:
        """
        收集所有已启用插件的前端注入数据。
        返回:
        {
            "nav_buttons": [...],
            "panel_slots": [...],
            "view_routes": [...],
            "context_menus": [...],
            "styles": [...],
            "scripts": [...],
        }
        """
        result = {
            "nav_buttons": [],
            "panel_slots": [],
            "view_routes": [],
            "context_menus": [],
            "styles": [],
            "scripts": [],
        }
        
        for plugin_id, plugin in self.plugins.items():
            if plugin.status != PluginStatus.ENABLED:
                continue
            if not plugin.instance:
                continue
            
            try:
                injections = plugin.instance.get_frontend_injections()
                for key in result:
                    if key in injections:
                        result[key].extend(injections[key])
            except Exception as e:
                log_error(f"[PluginManager] 收集 {plugin_id} 前端注入失败: {e}")
        
        return result
    
    def get_api_routers(self):
        """
        收集所有已启用插件的 API 路由器。
        返回 {plugin_id: APIRouter} 字典。
        """
        routers = {}
        for plugin_id, plugin in self.plugins.items():
            if plugin.status != PluginStatus.ENABLED:
                continue
            if not plugin.instance:
                continue
            
            try:
                router = plugin.instance.get_api_router()
                if router is not None:
                    routers[plugin_id] = router
            except Exception as e:
                log_error(f"[PluginManager] 获取 {plugin_id} API路由失败: {e}")
        
        return routers
    
    # ================================================================
    # 查询
    # ================================================================
    
    def get_plugin(self, plugin_id: str) -> Optional[PluginInstance]:
        """获取插件实例"""
        return self.plugins.get(plugin_id)
    
    def list_plugins(self) -> List[dict]:
        """列出所有插件（简要信息）"""
        result = []
        for pid, p in self.plugins.items():
            result.append({
                "plugin_id": pid,
                "name": p.manifest.name,
                "version": p.manifest.version,
                "status": p.status.value,
                "license_tier": p.manifest.license_tier,
                "license_active": p.license_active,
                "description": p.manifest.description,
                "author": p.manifest.author,
                "error": p.error_message if p.status == PluginStatus.ERROR else "",
            })
        return result
    
    def get_frontend_manifest(self) -> dict:
        """返回前端需要的插件清单（供 plugin_host.js 消费）"""
        plugins_info = []
        for pid, p in self.plugins.items():
            if p.status != PluginStatus.ENABLED:
                continue
            plugins_info.append(p.manifest.to_dict())
        
        injections = self.collect_injections()
        
        return {
            "core_version": "5.1.0",
            "plugins": plugins_info,
            "injections": injections,
        }
    
    # ================================================================
    # 内部工具方法
    # ================================================================
    
    def _parse_manifest(self, data: dict) -> PluginManifest:
        """从 JSON 数据解析清单"""
        required = ["plugin_id", "name", "version", "min_core_version"]
        for key in required:
            if key not in data:
                raise ValueError(f"plugin.json 缺少必需字段: {key}")
        
        return PluginManifest(
            plugin_id=data["plugin_id"],
            name=data["name"],
            version=data["version"],
            min_core_version=data["min_core_version"],
            author=data.get("author", ""),
            description=data.get("description", ""),
            license_tier=data.get("license_tier", "free"),
            dependencies=data.get("dependencies", []),
            api_router_module=data.get("api_router_module", ""),
            db_migrations=data.get("db_migrations", []),
            frontend_modules=data.get("frontend_modules", []),
            hooks=data.get("hooks", {}),
        )
    
    def _find_plugin_class(self, module) -> Optional[type]:
        """在模块中查找 PromptKitPlugin 子类"""
        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            if (
                isinstance(attr, type)
                and issubclass(attr, PromptKitPlugin)
                and attr is not PromptKitPlugin
            ):
                return attr
        return None
    
    def _check_dependencies(self, manifest: PluginManifest) -> List[str]:
        """检查依赖是否满足。返回缺少的依赖列表。"""
        missing = []
        for dep_id in manifest.dependencies:
            dep = self.plugins.get(dep_id)
            if not dep or dep.status != PluginStatus.ENABLED:
                missing.append(dep_id)
        return missing
    
    def _get_db(self) -> Optional[Any]:
        """获取数据库连接（延迟导入避免循环依赖）"""
        try:
            from database import get_db
            return get_db()
        except Exception:
            return None


# ============================================================
# 便捷函数
# ============================================================

def get_plugin_manager() -> PluginManager:
    """获取插件管理器单例"""
    return PluginManager()


def init_plugin_system(app=None, db=None) -> PluginManager:
    """
    初始化插件系统：发现 → 加载 → 启用 → 挂载路由。
    在 main.py lifespan 中调用。
    """
    pm = get_plugin_manager()
    
    log_info("[PluginManager] 开始初始化插件系统...")
    
    # 1. 发现
    discovered = pm.discover()
    log_info(f"[PluginManager] 发现 {len(discovered)} 个插件: {discovered}")
    
    if not discovered:
        log_info("[PluginManager] 无插件发现")
        return pm
    
    # 2. 加载
    results = pm.load_all(app, db)
    for pid, ok in results.items():
        if not ok:
            log_warn(f"[PluginManager] 插件 {pid} 加载失败")
    
    # 3. 启用所有已加载插件（付费插件前端License门控，后端API始终可用）
    for pid, plugin in pm.plugins.items():
        if plugin.status == PluginStatus.LOADED:
            pm.enable(pid)
    
    # 4. 挂载 API 路由到 app
    if app is not None:
        for plugin_id, router in pm.get_api_routers().items():
            prefix = f"/api/plugins/{plugin_id}"
            app.include_router(router, prefix=prefix)
            log_info(f"[PluginManager] 挂载路由: {prefix}")
        
        # 挂载插件静态文件（JS/CSS）
        _mount_plugin_statics(app, pm)
        
        # 注册插件管理 API
        _register_plugin_api(app, pm)
    
    enabled_count = sum(1 for p in pm.plugins.values() if p.status == PluginStatus.ENABLED)
    log_info(f"[PluginManager] 初始化完成: {len(discovered)} 发现, {enabled_count} 已启用")
    
    return pm


def _mount_plugin_statics(app, pm: PluginManager):
    """挂载插件静态文件目录"""
    from fastapi.staticfiles import StaticFiles
    
    for plugin_id, plugin in pm.plugins.items():
        if plugin.status != PluginStatus.ENABLED:
            continue
        
        static_dir = pm.plugins_dir / plugin.dir_name / "static"
        if static_dir.exists():
            mount_path = f"/plugins/{plugin_id}"
            try:
                app.mount(mount_path, StaticFiles(directory=str(static_dir)), name=f"plugin_static_{plugin_id}")
                log_info(f"[PluginManager] 静态文件挂载: {mount_path} → {static_dir}")
            except Exception as e:
                log_error(f"[PluginManager] 静态文件挂载失败 {plugin_id}: {e}")


def _register_plugin_api(app, pm: PluginManager):
    """注册插件管理 API 端点"""
    from fastapi import APIRouter, Request
    from fastapi.responses import JSONResponse
    
    router = APIRouter(prefix="/api/plugin-system", tags=["插件系统"])
    
    @router.get("/manifest")
    async def get_plugin_manifest():
        """返回前端插件清单"""
        return pm.get_frontend_manifest()
    
    @router.get("/list")
    async def list_plugins():
        """列出所有插件"""
        return {"plugins": pm.list_plugins()}
    
    @router.get("/status")
    async def plugin_status():
        """插件系统状态"""
        return {
            "initialized": pm._initialized,
            "total": len(pm.plugins),
            "enabled": sum(1 for p in pm.plugins.values() if p.status == PluginStatus.ENABLED),
            "loaded": sum(1 for p in pm.plugins.values() if p.status == PluginStatus.LOADED),
            "disabled": sum(1 for p in pm.plugins.values() if p.status == PluginStatus.DISABLED),
            "errors": sum(1 for p in pm.plugins.values() if p.status == PluginStatus.ERROR),
        }
    
    app.include_router(router)
    log_info("[PluginManager] 插件管理 API 已注册: /api/plugin-system/*")


# ============================================================
# 版本兼容性
# ============================================================

def check_core_compatibility(manifest: PluginManifest, core_version: str) -> bool:
    """
    检查插件与核心版本的兼容性。
    简单比较: 插件的 min_core_version <= core_version
    """
    from packaging.version import Version, InvalidVersion
    
    try:
        min_ver = Version(manifest.min_core_version.lstrip("v"))
        core_ver = Version(core_version.lstrip("v"))
        return core_ver >= min_ver
    except (InvalidVersion, ImportError):
        # 如果没有 packaging 库，做简单字符串比较
        return manifest.min_core_version <= core_version
