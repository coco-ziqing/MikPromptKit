# PromptKit 插件开发指南

Phase18 v5.1.0

---

## 快速开始

1. 复制 `plugins/example_plugin/` 到 `plugins/your_plugin/`
2. 修改 `plugin.json` 中的元数据
3. 修改 `__init__.py` 中的插件类
4. 重启 PromptKit → 自动发现并加载

---

## plugin.json 规范

```json
{
  "plugin_id": "com.your.domain.pluginname",  // 唯一ID，反向域名
  "name": "插件显示名",
  "version": "1.0.0",                          // 语义版本
  "min_core_version": "5.1.0",
  "author": "Your Name",
  "description": "简短描述",
  "license_tier": "free",                      // free | personal | team
  "dependencies": [],                          // 依赖的其他插件ID
  "api_router_module": "",
  "db_migrations": [],
  "hooks": {},
  "config": {}
}
```

## 插件类规范

```python
# plugins/your_plugin/__init__.py
import sys

PromptKitPlugin = None
try:
    from backend.plugin_manager import PromptKitPlugin
except ImportError:
    for mod_name in list(sys.modules):
        if 'plugin_manager' in mod_name:
            mod = sys.modules[mod_name]
            if hasattr(mod, 'PromptKitPlugin'):
                PromptKitPlugin = mod.PromptKitPlugin
                break

class YourPlugin(PromptKitPlugin):
    
    def on_load(self, app, db) -> bool:
        # 初始化数据库、注册 API 路由等
        return True
    
    def on_enable(self) -> bool:
        return True
    
    def on_disable(self) -> bool:
        return True
    
    def get_api_router(self):
        # 返回 FastAPI APIRouter
        from fastapi import APIRouter
        router = APIRouter()
        
        @router.get("/hello")
        async def hello():
            return {"message": "Hello from plugin!"}
        
        return router
    
    def get_frontend_injections(self) -> dict:
        return {
            "nav_buttons": [
                {"slot": "right", "icon": "bi-puzzle", "label": "My Plugin",
                 "onClick": "App.switchView('myplugin')", "order": 100}
            ],
            "scripts": ["/plugins/com.your.plugin/main.js"],
            "styles": ["/plugins/com.your.plugin/style.css"],
        }
```

## License 类型

| license_tier | 含义 | 激活方式 |
|-------------|------|---------|
| free | 免费（随核心一起启用） | 自动 |
| personal | 个人版买断 | 输入 License Key 激活 |
| team | 团队版订阅 | 输入 License Key + 定期联网校验 |

## 前端插件

插件 JS 通过 `<script>` 动态加载，使用 `__PK_PLUGINS__` API：

```javascript
// plugins/your_plugin/static/main.js
(function() {
  // 注册视图
  window.__PK_VIEW_REGISTRY__.register('myplugin', function(container) {
    container.innerHTML = '<h2>My Plugin View</h2>';
  });
  
  // 或直接注册插件
  window.__PK_PLUGINS__.register({
    id: 'com.your.plugin',
    name: 'My Plugin',
    navButtons: [{
      slot: 'right', icon: 'bi-puzzle', label: 'My Plugin',
      onClick: "window.__PK_VIEW_REGISTRY__.render('myplugin', document.getElementById('mainContent'))",
      order: 100
    }],
  });
})();
```

## 目录结构

```
plugins/your_plugin/
├── plugin.json          # 元数据（必需）
├── __init__.py          # 插件类（必需）
├── api.py               # API 路由（可选）
├── models.py            # 数据模型（可选）
├── migrations/          # SQL 迁移文件（可选）
│   └── 001_init.sql
└── static/              # 前端资源（可选）
    ├── main.js
    └── style.css
```
