# -*- coding: utf-8 -*-
"""
com.promptkit.asset — 资产管理专业版插件
v1.0.0 (Phase25 Track A)

功能:
  🖼️ 资产画廊 — 图片/视频统一网格展示 + 类型/标签/评分/关键词筛选
  ⬆️ 上传入库 — 多文件上传 + file_hash SHA256 去重 + 尺寸/时长探测
  🔁 版本链 — 同一资产多版本迭代（asset_versions + version_chain）
  🏷️ 标签系统 — 多标签打标 + 标签筛选
  ⭐ 评分系统 — 1-5 星评分（asset_ratings 多用户 + project_assets.rating 汇总）
  🔗 溯源关联 — 资产 ↔ 提示词/词卡/镜头双向绑定（asset_prompt_ref）
  🧬 生成参数 — gen_prompt / gen_model / gen_params_json 完整溯源
  🕵️ 去重检测 — 全库 file_hash 扫描重复（asset_duplicates）

License: 个人版买断 / 团队版订阅
数据表: project_assets(主) + asset_versions/asset_tags/asset_ratings/asset_prompt_ref/asset_duplicates
"""
import os
from pathlib import Path

try:
    from promptkit_plugin_base import PromptKitPlugin, PluginManifest
except ImportError:
    from plugin_manager import PromptKitPlugin, PluginManifest


class AssetManagerPlugin(PromptKitPlugin):
    """资产管理专业版插件"""

    plugin_id = "com.promptkit.asset"

    def __init__(self):
        super().__init__()
        self._db = None
        self._app = None

    # ===== 生命周期 =====

    def on_load(self, app, db) -> bool:
        self._app = app
        self._db = db
        self._ensure_tables()
        self._ensure_storage()
        return True

    def on_enable(self) -> bool:
        return True

    def on_disable(self) -> bool:
        return True

    def on_unload(self):
        self._db = None
        self._app = None

    # ===== 存储目录 =====

    def _ensure_storage(self):
        try:
            base = Path(__file__).parent.parent.parent / "data" / "project_assets"
            base.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"[AssetPlugin] 存储目录创建失败: {e}")

    # ===== 数据库（幂等，与 Phase18 迁移表结构一致）=====

    def _ensure_tables(self):
        db = self._db
        if db is None:
            return

        tables = [
            # 资产主表（图片/视频等产出文件）
            """CREATE TABLE IF NOT EXISTS project_assets (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                filename       TEXT NOT NULL,
                original_filename TEXT DEFAULT '',
                file_path      TEXT NOT NULL,
                file_size      INTEGER DEFAULT 0,
                media_type     TEXT DEFAULT 'image',
                mime_type      TEXT DEFAULT '',
                width          INTEGER DEFAULT 0,
                height         INTEGER DEFAULT 0,
                duration       REAL DEFAULT 0,
                file_hash      TEXT DEFAULT '',
                project_id     INTEGER,
                owner_user_id  INTEGER,
                rating         REAL DEFAULT 0,
                notes          TEXT DEFAULT '',
                gen_prompt     TEXT DEFAULT '',
                gen_model      TEXT DEFAULT '',
                gen_params_json TEXT DEFAULT '{}',
                version_chain  TEXT DEFAULT '',
                is_deleted     INTEGER DEFAULT 0,
                created_at     TEXT DEFAULT (datetime('now','localtime')),
                updated_at     TEXT DEFAULT (datetime('now','localtime'))
            )""",
            # 版本链
            """CREATE TABLE IF NOT EXISTS asset_versions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id   INTEGER NOT NULL,
                version    INTEGER DEFAULT 1,
                file_path  TEXT NOT NULL,
                file_hash  TEXT DEFAULT '',
                notes      TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (asset_id) REFERENCES project_assets(id) ON DELETE CASCADE
            )""",
            # 标签
            """CREATE TABLE IF NOT EXISTS asset_tags (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id   INTEGER NOT NULL,
                tag        TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (asset_id) REFERENCES project_assets(id) ON DELETE CASCADE,
                UNIQUE(asset_id, tag)
            )""",
            # 评分（多用户）
            """CREATE TABLE IF NOT EXISTS asset_ratings (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id   INTEGER NOT NULL,
                user_id    INTEGER DEFAULT 0,
                rating     INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (asset_id) REFERENCES project_assets(id) ON DELETE CASCADE,
                UNIQUE(asset_id, user_id)
            )""",
            # 提示词/词卡/镜头关联溯源
            """CREATE TABLE IF NOT EXISTS asset_prompt_ref (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id   INTEGER NOT NULL,
                ref_type   TEXT NOT NULL,
                ref_id     INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (asset_id) REFERENCES project_assets(id) ON DELETE CASCADE,
                UNIQUE(asset_id, ref_type, ref_id)
            )""",
            # 重复检测记录
            """CREATE TABLE IF NOT EXISTS asset_duplicates (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id     INTEGER NOT NULL,
                duplicate_of INTEGER NOT NULL,
                detected_at  TEXT DEFAULT (datetime('now','localtime'))
            )""",
        ]
        for sql in tables:
            try:
                db.execute(sql)
            except Exception as e:
                print(f"[AssetPlugin] 建表失败: {e}")

        # 索引
        idx = [
            "CREATE INDEX IF NOT EXISTS idx_pa_hash ON project_assets(file_hash)",
            "CREATE INDEX IF NOT EXISTS idx_pa_project ON project_assets(project_id)",
            "CREATE INDEX IF NOT EXISTS idx_pa_type ON project_assets(media_type)",
            "CREATE INDEX IF NOT EXISTS idx_pa_deleted ON project_assets(is_deleted)",
            "CREATE INDEX IF NOT EXISTS idx_at_asset ON asset_tags(asset_id)",
            "CREATE INDEX IF NOT EXISTS idx_at_tag ON asset_tags(tag)",
            "CREATE INDEX IF NOT EXISTS idx_apr_asset ON asset_prompt_ref(asset_id)",
            "CREATE INDEX IF NOT EXISTS idx_apr_ref ON asset_prompt_ref(ref_type, ref_id)",
        ]
        for sql in idx:
            try:
                db.execute(sql)
            except Exception:
                pass

        try:
            db.commit()
        except Exception:
            pass

    # ===== 前端注入 =====

    def get_frontend_injections(self) -> dict:
        return {
            "nav_buttons": [
                {
                    "slot": "right",
                    "id": "navAssetMgmt",
                    "icon": "bi-images",
                    "label": "资产管理",
                    "view": "asset_mgmt",
                    "onClick": "window.PK_AssetManager && window.PK_AssetManager.open()",
                    "title": "资产管理 — 画廊/上传/版本/评分/溯源",
                    "order": 36,
                    "showLabel": True,
                }
            ],
            "panel_slots": [],
            "view_routes": [],
            "context_menus": [],
            "styles": ["/plugins/com.promptkit.asset/asset_manager.css"],
            "scripts": ["/plugins/com.promptkit.asset/asset_manager.js"],
        }

    # ===== API 路由 =====

    def get_api_router(self):
        import importlib.util
        api_path = Path(__file__).parent / "api.py"
        spec = importlib.util.spec_from_file_location(
            "promptkit_plugin_asset_api", str(api_path)
        )
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.router
