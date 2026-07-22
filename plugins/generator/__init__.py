"""
com.promptkit.generator — AI 生成中心插件 v1.0.0

功能:
  🎭 角色生成 — 捏脸参数滑块 → ComfyUI 生成肖像
  🌄 场景生成 — (预埋)
  🎬 分镜生成 — (预埋)

License: 个人版买断 / 团队版订阅
"""
from pathlib import Path

try:
    from promptkit_plugin_base import PromptKitPlugin, PluginManifest
except ImportError:
    from plugin_manager import PromptKitPlugin, PluginManifest


class GeneratorPlugin(PromptKitPlugin):
    """AI 生成中心插件"""

    plugin_id = "com.promptkit.generator"

    def __init__(self):
        super().__init__()
        self._app = None
        self._db = None

    # ===== 生命周期 =====

    def on_load(self, app, db) -> bool:
        self._app = app
        self._db = db
        self._ensure_tables()
        return True

    def on_enable(self) -> bool:
        return True

    def on_disable(self) -> bool:
        return True

    def on_unload(self):
        self._app = None
        self._db = None

    # ===== 数据库 =====

    def _ensure_tables(self):
        db = self._db
        if db is None:
            return

        tables = [
            # 参数预设表
            """CREATE TABLE IF NOT EXISTS generator_character_presets (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id        INTEGER,
                name           TEXT NOT NULL,
                description    TEXT DEFAULT '',
                params_json    TEXT NOT NULL DEFAULT '{}',
                aspect_ratio   TEXT DEFAULT '1:1',
                character_id   INTEGER,
                template_id    INTEGER,
                is_public      INTEGER DEFAULT 0,
                created_at     TEXT DEFAULT (datetime('now','localtime')),
                updated_at     TEXT DEFAULT (datetime('now','localtime'))
            )""",

            # 生成历史表
            """CREATE TABLE IF NOT EXISTS generator_jobs (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         INTEGER,
                preset_id       INTEGER,
                character_id    INTEGER,
                prompt_text     TEXT NOT NULL,
                params_json     TEXT NOT NULL DEFAULT '{}',
                workflow_id     TEXT,
                comfyui_job_id  TEXT,
                aspect_ratio    TEXT DEFAULT '1:1',
                status          TEXT DEFAULT 'pending',
                result_path     TEXT,
                thumb_path      TEXT,
                duration_ms     INTEGER,
                rating          INTEGER DEFAULT 0,
                tags            TEXT DEFAULT '[]',
                note            TEXT DEFAULT '',
                is_archived     INTEGER DEFAULT 0,
                archived_asset_id INTEGER,
                error_message   TEXT,
                created_at      TEXT DEFAULT (datetime('now','localtime'))
            )""",

            # 参数映射配置表（预留 Phase 5）
            """CREATE TABLE IF NOT EXISTS generator_param_mapping (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                workflow_id     TEXT NOT NULL,
                param_key       TEXT NOT NULL,
                node_id         TEXT NOT NULL,
                input_field     TEXT NOT NULL,
                value_type      TEXT DEFAULT 'float',
                value_min       REAL DEFAULT 0.0,
                value_max       REAL DEFAULT 1.0,
                created_at      TEXT DEFAULT (datetime('now','localtime')),
                UNIQUE(workflow_id, param_key)
            )""",
        ]

        for sql in tables:
            try:
                db.execute(sql)
            except Exception as e:
                print(f"[GeneratorPlugin] 建表失败: {e}")

        try:
            db.commit()
        except Exception:
            pass

    # ===== 前端注入 =====

    def get_frontend_injections(self) -> dict:
        return {
            "scripts": ["/plugins/com.promptkit.generator/generator_ui.js"],
            "styles": [],
            "nav_buttons": [],
            "panel_slots": [],
            "view_routes": [
                {
                    "path": "generator_character",
                    "title": "角色生成",
                    "component": "PK_GENERATOR.viewCharacter"
                },
                {
                    "path": "generator_scene",
                    "title": "场景生成",
                    "component": "PK_GENERATOR.viewScene"
                },
                {
                    "path": "generator_storyboard",
                    "title": "分镜生成",
                    "component": "PK_GENERATOR.viewStoryboard"
                },
            ],
            "context_menus": [],
        }

    # ===== API 路由 =====

    def get_api_router(self):
        import importlib.util, sys
        api_path = Path(__file__).parent / "api.py"
        spec = importlib.util.spec_from_file_location(
            "promptkit_plugin_generator_api", str(api_path)
        )
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        # 确保插件目录在 sys.path 中，让 api.py 能 import param_engine
        plugin_dir = str(Path(__file__).parent)
        if plugin_dir not in sys.path:
            sys.path.insert(0, plugin_dir)
        spec.loader.exec_module(module)
        return module.router
