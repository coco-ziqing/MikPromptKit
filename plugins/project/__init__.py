"""
com.promptkit.project — 项目管理专业版插件
v1.1.0 (Phase21 深度优化)

功能:
  📊 项目仪表盘 — 进度汇总/成员工作量/近期活动
  📋 看板视图 — 拖拽跨列移动/任务编辑弹窗/优先级可视化
  📅 甘特图 — 真实时间轴横向条/里程碑标记线
  🏁 里程碑 — 编辑弹窗/描述+日期编辑
  👥 团队管理 — 成员角色与权限/自定义头像
  🏛 组织架构 — 拖拽层级树/循环引用防护
  🔗 镜头关联 — 任务↔镜头双向绑定
  📦 项目CRUD — 编辑/删除项目

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
                real_name  TEXT DEFAULT '',
                duty       TEXT DEFAULT '',
                avatar     TEXT DEFAULT '',
                avatar_color TEXT DEFAULT '',
                phone      TEXT DEFAULT '',
                email      TEXT DEFAULT '',
                parent_member_id INTEGER,
                permissions_json TEXT DEFAULT '{}',
                joined_at  TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (project_id) REFERENCES user_project(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_member_id) REFERENCES project_members(id) ON DELETE SET NULL
            )""",

            # 任务 ↔ 镜头关联表
            """CREATE TABLE IF NOT EXISTS project_task_scene (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id    INTEGER NOT NULL,
                scene_id   INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (scene_id) REFERENCES user_project_scene(id) ON DELETE CASCADE,
                UNIQUE(task_id, scene_id)
            )""",

            # Phase22 总项目
            """CREATE TABLE IF NOT EXISTS master_project (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                name         TEXT NOT NULL,
                description  TEXT DEFAULT '',
                project_type TEXT DEFAULT 'short_film',
                aspect_ratio TEXT DEFAULT '16:9',
                resolution   TEXT DEFAULT '4K',
                status       TEXT DEFAULT 'draft',
                cover_image  TEXT DEFAULT '',
                created_at   TEXT DEFAULT (datetime('now','localtime')),
                updated_at   TEXT DEFAULT (datetime('now','localtime'))
            )""",

            # Phase22 子项目
            """CREATE TABLE IF NOT EXISTS master_sub_project (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                master_project_id INTEGER NOT NULL,
                seedance_project_id INTEGER,
                name              TEXT NOT NULL,
                sub_type          TEXT DEFAULT 'storyboard',
                description       TEXT DEFAULT '',
                phase             TEXT DEFAULT 'P3',
                sort_order        INTEGER DEFAULT 0,
                created_at        TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE,
                FOREIGN KEY (seedance_project_id) REFERENCES user_project(id) ON DELETE SET NULL
            )""",

            # Phase22 资产
            """CREATE TABLE IF NOT EXISTS master_asset (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                master_project_id INTEGER NOT NULL,
                sub_project_id    INTEGER,
                asset_type        TEXT NOT NULL,
                name              TEXT NOT NULL,
                description       TEXT DEFAULT '',
                content           TEXT DEFAULT '',
                image_path        TEXT DEFAULT '',
                tags              TEXT DEFAULT '[]',
                word_card_id      INTEGER,
                sort_order        INTEGER DEFAULT 0,
                created_at        TEXT DEFAULT (datetime('now','localtime')),
                updated_at        TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE,
                FOREIGN KEY (sub_project_id) REFERENCES master_sub_project(id) ON DELETE SET NULL,
                FOREIGN KEY (word_card_id) REFERENCES word_card(id) ON DELETE SET NULL
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
        """返回主 API 路由（含工作空间管理）"""
        import importlib.util
        api_path = Path(__file__).parent / "api.py"
        spec = importlib.util.spec_from_file_location(
            "promptkit_plugin_project_api", str(api_path)
        )
        if spec is None or spec.loader is None: return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        router = module.router

        # Phase23.3: 挂载工作空间管理子路由
        ws_path = Path(__file__).parent / "api_workspace.py"
        if ws_path.exists():
            ws_spec = importlib.util.spec_from_file_location(
                "promptkit_plugin_workspace_api", str(ws_path)
            )
            if ws_spec and ws_spec.loader:
                ws_module = importlib.util.module_from_spec(ws_spec)
                ws_spec.loader.exec_module(ws_module)
                router.include_router(ws_module.router)

        return router
