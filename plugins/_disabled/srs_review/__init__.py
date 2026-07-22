# -*- coding: utf-8 -*-
"""
com.promptkit.srs-review 插件入口
=================================
基于 FSRS-5 的间隔重复复习系统插件。

加载时机: PluginManager.load("com.promptkit.srs-review")
生命周期: on_load → (自动 on_enable) → on_disable → on_unload

@license MIT
"""

import sys
import os
import sqlite3
from pathlib import Path

# 导入插件基类
PromptKitPlugin = None
for mod_name in list(sys.modules):
    if 'plugin_manager' in mod_name:
        mod = sys.modules[mod_name]
        if hasattr(mod, 'PromptKitPlugin'):
            PromptKitPlugin = mod.PromptKitPlugin
            break

if PromptKitPlugin is None:
    try:
        from backend.plugin_manager import PromptKitPlugin
    except ImportError:
        # 最后尝试：从 sys.path 查找
        _project_root = Path(__file__).resolve().parents[2]
        sys.path.insert(0, str(_project_root / "backend"))
        from plugin_manager import PromptKitPlugin


class SRSReviewPlugin(PromptKitPlugin):
    """FSRS-5 间隔复习系统插件"""
    
    plugin_id = "com.promptkit.srs-review"
    _plugin_dir = Path(__file__).resolve().parent
    
    def __init__(self):
        super().__init__()
        self._db_path = None
    
    def _get_db_path(self) -> str:
        """获取数据库路径"""
        if self._db_path:
            return self._db_path
        # 从环境变量或默认路径
        project_root = self._plugin_dir.parents[1]
        self._db_path = str(project_root / "data" / "prompts.db")
        return self._db_path
    
    # ================================================================
    # 生命周期
    # ================================================================
    
    def on_load(self, app, db) -> bool:
        """
        插件加载: 执行数据库迁移，确保表结构就绪。
        使用独立连接避免与核心连接池冲突。
        """
        try:
            self._run_migrations()
            print(f"[SRSReview] 插件已加载")
            return True
        except Exception as e:
            print(f"[SRSReview] 加载失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def on_enable(self) -> bool:
        print(f"[SRSReview] 插件已启用")
        return True
    
    def on_disable(self) -> bool:
        print(f"[SRSReview] 插件已禁用")
        return True
    
    def on_unload(self):
        print(f"[SRSReview] 插件已卸载")
    
    # ================================================================
    # 数据库迁移
    # ================================================================
    
    def _run_migrations(self):
        """执行 SQL 迁移（幂等，独立连接）"""
        migration_path = self._plugin_dir / "migrations" / "001_review_tables.sql"
        if not migration_path.exists():
            print(f"[SRSReview] 迁移文件不存在: {migration_path}")
            return
        
        sql = migration_path.read_text(encoding="utf-8")
        
        db_path = self._get_db_path()
        conn = sqlite3.connect(db_path, timeout=2)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=3000")
        
        try:
            # 使用 executescript 一次性执行，避免分号分割问题
            conn.executescript(sql)
            conn.commit()
            print(f"[SRSReview] 数据库迁移完成")
        except Exception as e:
            print(f"[SRSReview] 迁移失败: {e}")
        finally:
            conn.close()
    
    # ================================================================
    # API 路由
    # ================================================================
    
    def get_api_router(self):
        """返回 FastAPI APIRouter，挂载到 /api/plugins/com.promptkit.srs-review/"""
        import importlib.util
        
        # 确保插件目录在 sys.path 中
        plugin_dir_str = str(self._plugin_dir)
        if plugin_dir_str not in sys.path:
            sys.path.insert(0, plugin_dir_str)
        
        # 动态加载 api 模块
        api_path = self._plugin_dir / "api.py"
        spec = importlib.util.spec_from_file_location(
            "srs_review_api",
            str(api_path)
        )
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        
        # 注入数据库路径
        api.DB_PATH = self._get_db_path()
        return api.router
    
    # ================================================================
    # 前端注入
    # ================================================================
    
    def get_frontend_injections(self) -> dict:
        return {
            "nav_buttons": [
                {
                    "slot": "right",
                    "icon": "bi-brain",
                    "label": "间隔复习",
                    "onClick": "window.__PK_PLUGINS__._views.srs_review()",
                    "title": "间隔复习 — 基于FSRS-5算法的智能记忆系统",
                    "order": 40,
                }
            ],
            "context_menus": [
                {
                    "target": "prompt_card",
                    "label": "🧠 加入复习计划",
                    "action": "srs_enroll",
                    "icon": "bi-brain",
                },
                {
                    "target": "collection_page",
                    "label": "🧠 全部加入复习",
                    "action": "srs_enroll_collection",
                    "icon": "bi-collection",
                },
            ],
            "scripts": [
                f"/plugins/com.promptkit.srs-review/srs-main.js"
            ],
            "styles": [
                f"/plugins/com.promptkit.srs-review/srs-style.css"
            ],
        }
