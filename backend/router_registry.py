"""
API 路由注册表 — 集中管理全部 APIRouter 的导入与注册（Phase 2.2 自 main.py 拆分）

职责边界：
- main.py        : app 装配（中间件/异常处理/静态文件/lifespan/启动迁移）
- router_registry: 业务路由收敛（导入 + 挂载），新增 API 模块只需在此登记

用法（main.py）：
    from router_registry import register_routers
    register_routers(app)
"""
from fastapi import FastAPI

from api.ai_thumbnail import router as ai_thumbnail_router
from api.asset_library import router as asset_library_router  # Phase35.1 项目资产库
from api.asset_review import router as asset_review_router  # Phase35.2 版本/审核/成员
from api.atom_filler import router as atom_filler_router
from api.atoms import router as atoms_router
from api.atoms_import import router as atoms_import_router
from api.auto_tag import router as auto_tag_router
from api.cards import router as cards_v4_router
from api.card_collect import router as card_collect_router  # v5.42.0 词卡采集（收藏→采集→归档→溯源）
from api.card_gen import router as card_gen_router  # v5.37.0 词卡 AI 生成队列
from api.character_composer import router as character_composer_router
from api.characters import router as characters_router
from api.comfyui import router as comfyui_router
from api.composer_v3 import router as composer_v3_router
from api.cover_api import router as cover_router
from api.dam_archive import router as dam_router
from api.dam_search import router as dam_search_router
from api.dam_vault import router as dam_vault_router
from api.device_index import agent_router, mgmt_router
from api.dreamina import router as dreamina_router
from api.dreamina_inspiration import router as dreamina_inspiration_router
from api.exporter import router as exporter_router
from api.libtv import router as libtv_router
from api.license import router as license_router
from api.logs import router as log_router
from api.maintenance import router as maintenance_router
from api.media import router as media_router
from api.monitor import router as monitor_router
from api.ocr import router as ocr_router
from api.optimizer import router as optimizer_router
from api.playground import router as playground_router
from api.plugins_api import router as plugins_api_router
from api.project_roles import router as project_roles_router  # Phase36.2 项目角色/场景实例
from api.prompts import router as prompts_router
from api.scene_composer import router as scene_composer_router
from api.search import router as search_router
from api.seedance import router as seedance_router
from api.seedance_v2 import router as seedance_v2_router
from api.style_suits import router as style_suits_router  # v5.47.0 风格套装
from api.assemble import router as assemble_router  # v5.47.0 装备装配
from api.stats import router as stats_router
from api.tags import router as tags_router
from api.templates import router as templates_router
from api.thumbnails import router as thumbnails_router
from api.translate import router as translate_router
from api.users import router as users_router
from api.v2 import router as v2_router
from api.vjshi_upload import router as vjshi_router  # v5.38.0 光厂素材上传
from api.versions import router as versions_router
from api.word_cards import router as word_card_router
from api.workflow import router as workflow_router
from api.production_funnel import router as production_funnel_router  # v5.40.1 生产漏斗
from audit import router as audit_router  # Phase35 用户活动审计日志
from auth import router as auth_router
from health import router as health_router
from presence import router as presence_router  # Phase34 实时在线状态
from ws_collab import router as ws_collab_router


def register_routers(app: FastAPI) -> None:
    """将全部业务路由挂载到 app（保持 main.py 原始注册顺序）"""
    app.include_router(prompts_router)
    app.include_router(v2_router)
    app.include_router(vjshi_router)  # v5.38.0 光厂素材上传
    app.include_router(seedance_router)
    app.include_router(thumbnails_router)
    app.include_router(exporter_router)
    app.include_router(versions_router)
    app.include_router(search_router)
    app.include_router(playground_router)
    app.include_router(tags_router)
    app.include_router(stats_router)
    app.include_router(templates_router)
    app.include_router(workflow_router)
    app.include_router(production_funnel_router)  # v5.40.1 生产链路漏斗
    app.include_router(comfyui_router)
    app.include_router(dreamina_router)
    app.include_router(dreamina_inspiration_router)  # v5.38.32 即梦灵感导入
    app.include_router(libtv_router)
    app.include_router(ocr_router)
    app.include_router(cards_v4_router)
    app.include_router(card_gen_router)  # v5.37.0 词卡 AI 生成队列
    app.include_router(card_collect_router)  # v5.42.0 词卡采集
    app.include_router(composer_v3_router)
    app.include_router(translate_router)
    app.include_router(media_router)
    app.include_router(seedance_v2_router)
    app.include_router(characters_router)
    app.include_router(monitor_router)
    app.include_router(optimizer_router)
    app.include_router(auto_tag_router)
    app.include_router(ai_thumbnail_router)
    app.include_router(word_card_router)
    app.include_router(health_router)
    app.include_router(log_router)
    app.include_router(atoms_router)
    app.include_router(atoms_import_router)
    app.include_router(character_composer_router)
    app.include_router(scene_composer_router)
    app.include_router(atom_filler_router)
    app.include_router(plugins_api_router)
    app.include_router(ws_collab_router)
    app.include_router(presence_router)
    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(audit_router)
    app.include_router(asset_library_router)
    app.include_router(asset_review_router)
    app.include_router(project_roles_router)
    app.include_router(style_suits_router)  # v5.47.0 风格套装
    app.include_router(assemble_router)  # v5.47.0 装备装配
    app.include_router(agent_router)
    app.include_router(mgmt_router)
    app.include_router(cover_router)
    app.include_router(dam_router)
    app.include_router(dam_search_router)
    app.include_router(dam_vault_router)
    app.include_router(license_router)
    app.include_router(maintenance_router)
