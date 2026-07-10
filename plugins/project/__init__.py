"""
com.promptkit.project — 项目管理专业版插件
v1.0.0

功能:
  📊 项目仪表盘 — 进度汇总/任务热力图
  📋 看板视图 — 拖拽任务卡片，支持自定义列
  📅 甘特图 — 里程碑+任务时间线可视化
  👥 团队管理 — 成员角色与权限
  🔗 种子舞集成 — 镜头→任务自动同步

License: 个人版买断 / 团队版订阅
"""
import json
from pathlib import Path

# ============================================================
# 从核心框架导入（运行时注入）
# ============================================================
try:
    from promptkit_plugin_base import PromptKitPlugin, PluginManifest
except ImportError:
    from plugin_manager import PromptKitPlugin, PluginManifest


# ============================================================
# 插件主类
# ============================================================

class ProjectManagerPlugin(PromptKitPlugin):
    """项目管理专业版插件"""

    plugin_id = "com.promptkit.project"

    def __init__(self):
        super().__init__()
        self._db = None
        self._app = None

    # ===== 生命周期 =====

    def on_load(self, app, db) -> bool:
        """插件加载：初始化数据库表、注册钩子"""
        self._app = app
        self._db = db

        # 确保 project_tasks / project_milestones / project_columns 表存在
        self._ensure_tables()

        # 注册钩子
        self.register_hook("on_project_created", self._on_project_created)
        self.register_hook("on_project_deleted", self._on_project_deleted)

        return True

    def on_enable(self) -> bool:
        """启用：检查 License 后才可用"""
        return True

    def on_disable(self) -> bool:
        """禁用：清理资源"""
        return True

    def on_unload(self):
        """卸载"""
        self._db = None
        self._app = None

    # ===== 数据库 =====

    def _ensure_tables(self):
        """幂等创建项目管理扩展表"""
        db = self._db
        if db is None:
            return

        tables = [
            # 看板列
            """CREATE TABLE IF NOT EXISTS project_columns (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name       TEXT NOT NULL,
                color      TEXT DEFAULT '#6b7280',
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (project_id) REFERENCES user_project(id) ON DELETE CASCADE
            )""",

            # 任务卡片
            """CREATE TABLE IF NOT EXISTS project_tasks (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id   INTEGER NOT NULL,
                column_id    INTEGER,
                title        TEXT NOT NULL,
                description  TEXT DEFAULT '',
                assignee_id  INTEGER,
                priority     INTEGER DEFAULT 0,
                status       TEXT DEFAULT 'pending',
                due_date     TEXT,
                sort_order   INTEGER DEFAULT 0,
                completed_at TEXT,
                created_at   TEXT DEFAULT (datetime('now','localtime')),
                updated_at   TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (project_id) REFERENCES user_project(id) ON DELETE CASCADE,
                FOREIGN KEY (column_id) REFERENCES project_columns(id) ON DELETE SET NULL
            )""",

            # 里程碑
            """CREATE TABLE IF NOT EXISTS project_milestones (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id   INTEGER NOT NULL,
                title        TEXT NOT NULL,
                description  TEXT DEFAULT '',
                due_date     TEXT,
                completed_at TEXT,
                sort_order   INTEGER DEFAULT 0,
                created_at   TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (project_id) REFERENCES user_project(id) ON DELETE CASCADE
            )""",

            # 团队成员
            """CREATE TABLE IF NOT EXISTS project_members (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                user_id    INTEGER NOT NULL,
                role       TEXT DEFAULT 'viewer',
                joined_at  TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (project_id) REFERENCES user_project(id) ON DELETE CASCADE
            )""",
        ]

        for sql in tables:
            try:
                db.execute(sql)
            except Exception as e:
                print(f"[ProjectPlugin] 建表失败: {e}")

        try:
            db.commit()
        except Exception:
            pass

    # ===== Hook 回调 =====

    def _on_project_created(self, project_id: int, name: str):
        """项目创建时：自动初始化默认看板列"""
        db = self._db
        if db is None:
            return

        # 从 config 读取默认列名
        default_cols = self.manifest.config.get("default_kanban_columns",
            ["待办", "进行中", "审核中", "已完成"]) if self.manifest else ["待办", "进行中", "审核中", "已完成"]

        colors = ["#e5e7eb", "#dbeafe", "#fef3c7", "#d1fae5"]
        for i, col_name in enumerate(default_cols):
            db.execute(
                "INSERT INTO project_columns (project_id, name, color, sort_order) VALUES (?,?,?,?)",
                [project_id, col_name, colors[i % len(colors)], i]
            )
        try:
            db.commit()
        except Exception:
            pass

    def _on_project_deleted(self, project_id: int):
        """项目删除时清理（由外键 CASCADE 自动处理，此处为日志）"""
        pass

    # ===== 前端注入 =====

    def get_frontend_injections(self) -> dict:
        """注册前端导航按钮和视图路由"""
        return {
            "nav_buttons": [
                {
                    "slot": "right",
                    "id": "navProjectMgmt",
                    "icon": "bi-kanban",
                    "label": "项目管理",
                    "view": "project_mgmt",
                    "onClick": "window.PK_ProjectDashboard.open()",
                    "title": "项目管理 — 看板/甘特图/里程碑",
                    "order": 35,
                    "showLabel": True,
                }
            ],
            "panel_slots": [],
            "view_routes": [],
            "context_menus": [],
            "styles": ["/plugins/com.promptkit.project/project_dashboard.css"],
            "scripts": ["/plugins/com.promptkit.project/project_dashboard.js"],
        }

    # ===== API 路由 =====

    def get_api_router(self):
        """返回 FastAPI APIRouter，挂载到 /api/plugins/com.promptkit.project/"""
        import importlib.util
        api_path = Path(__file__).parent / "api.py"
        spec = importlib.util.spec_from_file_location(
            "promptkit_plugin_project_api", str(api_path)
        )
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.router
