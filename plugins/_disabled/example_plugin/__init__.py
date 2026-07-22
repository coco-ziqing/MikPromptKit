# PromptKit 插件 — 示例插件
# 从 promptkit_plugin_base 获取基类（plugin_manager 自动注入）

try:
    from promptkit_plugin_base import PromptKitPlugin
except ImportError:
    # fallback for testing
    import sys as _sys
    PromptKitPlugin = None
    for _mn in list(_sys.modules):
        if 'plugin_manager' in _mn and hasattr(_sys.modules[_mn], 'PromptKitPlugin'):
            PromptKitPlugin = _sys.modules[_mn].PromptKitPlugin
            break
    if PromptKitPlugin is None:
        raise ImportError("Cannot find PromptKitPlugin")


class ExamplePlugin(PromptKitPlugin):
    """示例插件: 展示完整的插件开发模板"""
    
    def on_load(self, app, db) -> bool:
        print(f"[ExamplePlugin] 加载成功! plugin_id={self.plugin_id}")
        return True
    
    def on_enable(self) -> bool:
        print("[ExamplePlugin] 已启用")
        return True
    
    def on_disable(self) -> bool:
        print("[ExamplePlugin] 已禁用")
        return True
    
    def on_unload(self):
        print("[ExamplePlugin] 已卸载")
    
    def get_frontend_injections(self) -> dict:
        return {
            "nav_buttons": [{
                "slot": "right",
                "icon": "bi-puzzle-fill",
                "label": "示例",
                "title": "示例插件",
                "onClick": "alert('Hello from Example Plugin!')",
                "order": 999,
            }],
            "panel_slots": [],
            "view_routes": [],
            "context_menus": [],
            "styles": [],
            "scripts": [],
        }
