"""
主入口 — FastAPI 应用 + Uvicorn 启动（加固版）
"""
import sys, os, socket, traceback, subprocess
from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# 先把 backend 目录加入 sys.path，确保 paths 模块可导入（PowerShell 5.1 快捷方式可能不含工作目录）
_dev_backend = os.path.dirname(os.path.abspath(__file__))
if _dev_backend not in sys.path:
    sys.path.insert(0, _dev_backend)

from paths import get_base_dir, get_frontend_dir, get_resource_dir

# 实际端口（__main__ 探测后设置，lifespan 读取）
ACTUAL_PORT = 8080

BASE_DIR = get_base_dir()
sys.path.insert(0, os.path.join(BASE_DIR, 'backend'))

from database import init_db, rebuild_fts, get_db, safe_commit
from seed_data import SEED_PROMPTS, get_builtin_count
from backup import start_auto_backup, stop_auto_backup, do_backup, get_backup_info
from logger import info as log_info, warn as log_warn, error as log_error, debug as log_debug
from database import safe_fetch_one, safe_count, safe_count_dict
from logger import api_log, capture_exception

# 启动时读取版本号（单一来源：根目录 VERSION 文件）
def _read_app_version() -> str:
    """从根目录 VERSION 文件读取版本号，读取失败时回退默认值"""
    try:
        # 优先 EXE 同级（开发环境）
        ver_path = os.path.join(BASE_DIR, 'VERSION')
        if not os.path.exists(ver_path):
            ver_path = os.path.join(get_resource_dir(), 'VERSION')
        with open(ver_path, 'r', encoding='utf-8-sig') as f:
            v = f.read().strip()
            if v:
                return v
    except Exception:
        pass
    return 'v5.18.0-phase36'

APP_VERSION = _read_app_version()
from api.prompts import router as prompts_router
from api.v2 import router as v2_router
from api.seedance import router as seedance_router
from api.thumbnails import router as thumbnails_router
from api.exporter import router as exporter_router
from api.versions import router as versions_router
from api.search import router as search_router
from api.playground import router as playground_router
from api.tags import router as tags_router
from api.stats import router as stats_router
from api.templates import router as templates_router
from api.workflow import router as workflow_router
from api.comfyui import router as comfyui_router
from api.dreamina import router as dreamina_router
from api.ocr import router as ocr_router
from api.cards import router as cards_v4_router
from api.composer_v3 import router as composer_v3_router
from api.translate import router as translate_router
from api.media import router as media_router
from api.seedance_v2 import router as seedance_v2_router
from api.characters import router as characters_router
from api.monitor import router as monitor_router
from api.optimizer import router as optimizer_router
from api.auto_tag import router as auto_tag_router
from api.ai_thumbnail import router as ai_thumbnail_router
from api.word_cards import router as word_card_router
from health import router as health_router
from api.logs import router as log_router
from api.atoms import router as atoms_router
from api.atoms_import import router as atoms_import_router
from api.character_composer import router as character_composer_router
from api.scene_composer import router as scene_composer_router
from api.atom_filler import router as atom_filler_router
from api.plugins_api import router as plugins_api_router
from plugin_manager import get_plugin_manager, init_plugin_system
from ws_collab import router as ws_collab_router
from presence import router as presence_router, presence_sweep_loop  # Phase34 实时在线状态
from sync import (
    export_package, restore_package, import_package,
    list_packages, delete_package, get_package_info,
    verify_package
)


def _migrate_v4(db):
    """幂等迁移: prompts→prompt_cards, prompt_library+word_card→library_assets, 表结构补列"""
    # === 第〇步：确保 user_project 有完整列（bgm/sfx/dialogue/template_id）===
    cols = [c[1] for c in db.execute("PRAGMA table_info(user_project)").fetchall()]
    for name, typ in [
        ("bgm", "TEXT DEFAULT ''"),
        ("sfx", "TEXT DEFAULT ''"),
        ("dialogue", "TEXT DEFAULT ''"),
        ("template_id", "INTEGER DEFAULT NULL"),
    ]:
        if name not in cols:
            db.execute(f"ALTER TABLE user_project ADD COLUMN {name} {typ}")
            print("[迁移] user_project 补列: %s" % name)
    # === 同样确保 user_project_scene 有完整列 ===
    scols = [c[1] for c in db.execute("PRAGMA table_info(user_project_scene)").fetchall()]
    for name, typ in [
        ("duration", "REAL DEFAULT 3"),
        ("is_manual", "INTEGER DEFAULT 0"),
        ("is_locked", "INTEGER DEFAULT 0"),
    ]:
        if name not in scols:
            db.execute(f"ALTER TABLE user_project_scene ADD COLUMN {name} {typ}")
            print("[迁移] user_project_scene 补列: %s" % name)
    # === [T2] 数据拷贝块已冻结 — prompts->word_card / prompt_library->library_assets 均已收敛 ===
    # 如需重新迁移执行 backend/migrate_unify_cards.py (2026-07-16)


def _seed_char_and_scene_groups(db):
    """Phase20: 角色/场景分组种子（幂等，兼容 frozen 环境）"""
    import hashlib
    char_root = ("char_root", "🎭 角色设定", "🎭")
    scene_root = ("scene_root", "🏞 场景设定", "🏞")
    char_subs = [
        ("char_gender_age","性别年龄","👥"),("char_hair","发型发色","💇"),("char_face","脸型五官","👁"),
        ("char_expression","表情神态","😊"),("char_body","体型身材","🧍"),("char_clothing","服装服饰","👗"),
        ("char_accessory","配饰道具","💍"),("char_pose","姿态动作","🤸"),("char_style","画风风格","🎨"),
        ("char_lighting","光照氛围","💡"),("char_color","色调质感","🎞"),("char_occupation","职业身份","🪪"),
        ("char_temperament","气质性格","✨"),("char_background","背景场景","🏞"),
    ]
    scene_subs = [
        ("scene_location","场景类型","🏠"),("scene_architecture","建筑风格","🏛"),("scene_time","时间时刻","🕐"),
        ("scene_season","季节气候","🍂"),("scene_weather","天气现象","🌦"),("scene_atmosphere","氛围情绪","🎭"),
        ("scene_lighting","光影效果","💡"),("scene_color","色彩搭配","🎨"),("scene_perspective","视角取景","📐"),
        ("scene_composition","构图布局","🖼"),("scene_details","细节元素","✨"),("scene_style","画风风格","🎨"),
        ("scene_quality","画质参数","📐"),
    ]
    for root_key, root_name, root_icon in [char_root, scene_root]:
        existing = db.execute("SELECT id FROM word_card_group WHERE group_key=?", [root_key]).fetchone()
        if not existing:
            sort_base = 6 if root_key == "char_root" else 7
            db.execute("""INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,sort_order,is_active,created_at,updated_at)
                         VALUES (?,?,?,'custom',NULL,?,1,datetime('now','localtime'),datetime('now','localtime'))""",
                      [root_name, root_key, root_icon, sort_base])
            root_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            print(f"[Seed] 根组 {root_key} id={root_id}")
        else:
            root_id = existing[0]
        subs = char_subs if root_key == "char_root" else scene_subs
        for idx, (key, name, icon) in enumerate(subs):
            existing_sub = db.execute("SELECT id FROM word_card_group WHERE group_key=?", [key]).fetchone()
            if not existing_sub:
                db.execute("""INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,sort_order,is_active,created_at,updated_at)
                             VALUES (?,?,?,'sub',?,?,1,datetime('now','localtime'),datetime('now','localtime'))""",
                          [name, key, icon, root_id, idx + 1])
    try:
        db.execute("COMMIT")
    except Exception:
        pass
    print(f"[Seed] 角色/场景分组: {len(char_subs)}+{len(scene_subs)} 子组完成")


def _seed_phase20_style_neg_subgroups(db):
    """Phase20: 全局画风/全局负面二级子分组（幂等）"""
    style_root_id = db.execute("SELECT id FROM word_card_group WHERE group_key='style_root'").fetchone()
    neg_root_id = db.execute("SELECT id FROM word_card_group WHERE group_key='negative'").fetchone()
    if not style_root_id:
        sid = db.execute("SELECT id FROM word_card_group WHERE name LIKE '%画风%' AND group_type='seedance'").fetchone()
        style_root_id = [sid[0]] if sid else None
    if not neg_root_id:
        nid = db.execute("SELECT id FROM word_card_group WHERE name LIKE '%负面%' AND group_type='seedance'").fetchone()
        neg_root_id = [nid[0]] if nid else None
    style_subs = [("🎨 写实风格","global_style_realistic","🖼️"),("🎨 动漫卡通","global_style_anime","✨"),("🎨 艺术风格","global_style_artistic","🎨")]
    neg_subs = [("⚠️ 人物形态","global_neg_body","👤"),("⚠️ 画面质量","global_neg_quality","🔍"),("⚠️ 技术渲染","global_neg_render","⚙️")]
    for root_id, subs, table_name in [(style_root_id, style_subs, "全局画风"), (neg_root_id, neg_subs, "全局负面")]:
        if not root_id:
            print(f"[Seed] Phase20 {table_name}: 未找到父组，跳过")
            continue
        rid = root_id if isinstance(root_id, int) else root_id[0]
        existing = db.execute("SELECT COUNT(*) as c FROM word_card_group WHERE parent_group_id=? AND is_active=1", [rid]).fetchone()[0]
        if existing > 0:
            print(f"[Seed] Phase20 {table_name}: 已有 {existing} 个子组，跳过")
            continue
        for idx, (name, key, icon) in enumerate(subs):
            db.execute("""INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,sort_order,is_active,created_at,updated_at)
                         VALUES (?,?,?,'sub',?,?,1,datetime('now','localtime'),datetime('now','localtime'))""",
                      [name, key, icon, rid, idx + 1])
        print(f"[Seed] Phase20 {table_name}: {len(subs)} 个子组完成")
    try:
        db.execute("COMMIT")
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
        db = get_db()

        # 2026-08-02 修复: atoms 原子化表迁移接入启动（独立脚本此前未被调用，恢复的旧库缺 atom_* 表）
        try:
            from migrate_atom_tables import migrate as migrate_atom
            migrate_atom()
        except Exception as e:
            log_warn(f"[main] atoms 表迁移跳过: {e}")
        
        # Phase18: 插件框架数据库迁移（幂等）
        try:
            from db_migrate_phase18 import run_migration as run_p18_migration
            run_p18_migration(db)
            log_info("[main] Phase18 迁移完成")
        except Exception as e:
            log_warn(f"[main] Phase18 迁移跳过: {e}")
        
        existing = safe_count_dict("SELECT COUNT(*) as cnt FROM prompts")
        if existing == 0:
            print("[初始化] 导入 %d 条内置提示词..." % get_builtin_count())
            for p in SEED_PROMPTS:
                db.execute(
                    "INSERT INTO prompts (module, category, subcategory, content, meaning, scene, tags) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (p[0], p[1], p[2], p[3], p[4], p[5], p[6])
                )
            safe_commit()
            rebuild_fts()
            print("[初始化] 数据导入完成。")
    except Exception as e:
        print("[初始化] 错误:", e)
        traceback.print_exc()

    host_ip = _get_local_ip()

    # 启动自动备份
    start_auto_backup()

    # 异步重建语义搜索索引
    try:
        from semantic import _ML_OK
        if _ML_OK:
            from semantic import rebuild_all_embeddings, rebuild_wc_embeddings
            import threading
            t = threading.Thread(target=rebuild_all_embeddings, daemon=True)
            t.start()
            t2 = threading.Thread(target=rebuild_wc_embeddings, daemon=True)
            t2.start()
            print("[语义搜索] 索引重建已启动（旧表 + 词卡双通道）")
        else:
            print("[语义搜索] ML 依赖不可用，跳过")
    except Exception as e:
        print("[语义搜索] 初始化失败:", e)

    # 初始化 Seedance V2 种子数据
    try:
        from seedance_v2_seed import init_seedance_v2_seed
        init_seedance_v2_seed(db)
        safe_commit()
    except Exception as e:
        print("[Seedance V2] 种子初始化失败:", e)

    # Phase20: 角色/场景分组种子（首次启动幂等建组，EXE 环境必需）
    # 注意：种子脚本内部 __file__ 路径在 frozen 环境失效，
    # 改为内联种子逻辑，直接使用 lifespan 传入的 db 连接
    try:
        _seed_char_and_scene_groups(db)
        print("[Seed] 角色/场景分组种子完成")
    except Exception as e:
        print(f"[Seed] 角色/场景种子跳过: {e}")

    # Phase20: 全局画风/负面二级子分组迁移
    try:
        _seed_phase20_style_neg_subgroups(db)
        print("[Seed] Phase20 二级子分组迁移完成")
    except Exception as e:
        print(f"[Seed] Phase20 迁移跳过: {e}")

    # v4 数据迁移: prompts→prompt_cards, prompt_library→library_assets
    _migrate_v4(db)

    # Phase18: 初始化插件系统（发现+加载+启用 free 插件+注册API）
    try:
        pm = init_plugin_system(app, db)
        log_info(f"[main] 插件系统就绪: {len(pm.plugins)} 个插件")
    except Exception as e:
        log_warn(f"[main] 插件系统初始化异常: {e}")

    try:
        total = safe_count_dict("SELECT COUNT(*) as cnt FROM prompts")
        cards = safe_count_dict("SELECT COUNT(*) as cnt FROM prompt_cards WHERE is_deleted=0")
        libs = safe_count_dict("SELECT COUNT(*) as cnt FROM library_assets")
    except Exception:
        total = cards = libs = 0
    print()
    print("=" * 50)
    print("  [OK] 咪卡MiK提示词助手 %s 已启动" % APP_VERSION)
    print("  [本机] http://127.0.0.1:%s" % ACTUAL_PORT)
    print("  [局域网] http://%s:%s" % (host_ip, ACTUAL_PORT))
    print("  [词库] %d 条 | 卡片 %d | 资产 %d" % (total, cards, libs))
    print("=" * 50)
    print()

    # v4.0.0-phase11: 启动后台自检（不阻塞启动）
    try:
        import asyncio as _asyncio
        async def _do_startup_check():
            import health as _h
            print("[自检] 启动健康检查...")
            # 同步检测 (直接引用模块函数, 无闭包隐患)
            sync_checks = [
                ("DB",        _h._check_database),
                ("Pillow",    _h._check_pillow),
                ("Port",      _h._check_self_reachable),
                ("Disk",      _h._check_disk),
                ("WAL",       _h._check_wal_integrity),
                ("FFmpeg",    _h._check_ffmpeg),
                ("Semantic",  _h._check_semantic),
            ]
            for name, fn in sync_checks:
                try:
                    r = fn()
                    st = "OK" if r.get("ok") else ("SKIP" if r.get("skipped") else "WARN")
                    print(f"  [{st}] {name}: {r.get('hint') or r.get('error') or '通过'}")
                except Exception as e:
                    print(f"  [ERR] {name}: {e}")
            # 异步检测
            try:
                r = await _h._check_ollama(3.0)
                st = "OK" if r.get("ok") else "WARN"
                print(f"  [{st}] Ollama: {r.get('hint') or r.get('error') or f'{r.get("model_count",0)} models'}")
            except Exception as e:
                print(f"  [WARN] Ollama: {e}")
            try:
                r = await _h._check_comfyui(3.0)
                st = "OK" if r.get("ok") else ("SKIP" if r.get("skipped") else "WARN")
                print(f"  [{st}] ComfyUI: {r.get('hint') or r.get('error') or '通过'}")
            except Exception as e:
                print(f"  [SKIP] ComfyUI: {e}")
            try:
                r = _h._check_playground_llm()
                st = "OK" if r.get("ok") else ("SKIP" if r.get("skipped") else "WARN")
                print(f"  [{st}] Playground: {r.get('hint') or r.get('error') or '通过'}")
            except Exception as e:
                print(f"  [SKIP] Playground: {e}")
            print("[自检] 完成 — 浏览器访问 /api/health/check 查看详情\n")
            # 2026-07-15: 审计日志保留期清理（config.audit_retention_days，0=不清理）
            try:
                from audit import apply_retention as _ar
                _ar()
            except Exception as _e:
                print(f"  [SKIP] 审计保留期清理: {_e}")
            # 2026-07-16 T6: 运行日志+面包屑保留期清理（config: log_retention_days 默认30 / breadcrumb_retention_days 默认14，0=不清理）
            try:
                from database import get_db as _gdb
                _cx = _gdb()
                def _cfg_int(k, dv):
                    try:
                        r = _cx.execute("SELECT value FROM config WHERE key=?", [k]).fetchone()
                        return int(str(r[0]).strip()) if r and str(r[0]).strip() else dv
                    except Exception:
                        return dv
                import logger as _lg
                import breadcrumb_logger as _bc
                _ld = _cfg_int('log_retention_days', 30)
                _bd = _cfg_int('breadcrumb_retention_days', 14)
                _n1 = _lg.clear_before(_ld) if _ld > 0 else 0
                _n2 = _bc.clear_breadcrumbs_before(_bd) if _bd > 0 else 0
                print(f"  [OK] 日志保留期清理: runtime_log 清{_n1}条(>{_ld}d), breadcrumb 清{_n2}条(>{_bd}d)")
            except Exception as _e:
                print(f"  [SKIP] 日志保留期清理: {_e}")
        # 使用当前运行中的 event loop
        loop = _asyncio.get_running_loop()
        loop.create_task(_do_startup_check())
        # Phase34: 启动在线状态后台巡检（idle/away 推导广播）
        try:
            loop.create_task(presence_sweep_loop())
            print("[在线状态] 巡检任务已启动")
        except Exception as e:
            print("[在线状态] 巡检启动失败:", e)
        # v4.0.0-phase11.1: 启动后台持续监听（信号灯）
        try:
            from health import start_watcher
            start_watcher()
        except Exception as e:
            print("[监听] 启动失败:", e)
    except Exception as e:
        print("[自检] 启动检查失败:", e)
    yield
    print("[关闭] 服务停止")
    # 停止监听器
    try:
        from health import stop_watcher
        stop_watcher()
    except Exception:
        pass
    stop_auto_backup()


app = FastAPI(
    title="咪卡MiK提示词助手",
    description="AI创作提示词管理与组装 WebUI",
    version=APP_VERSION,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",   # T9: 反射请求 Origin（等效放行任意来源，但与 allow_credentials 合法共存，修正 *+credentials 非法组合）
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phase18: JWT 认证中间件（仅解析，不强制验证）
try:
    from jwt_auth import JWTAuthMiddleware
    app.add_middleware(JWTAuthMiddleware)
    log_info("[main] JWT 中间件已注册（Phase18: 不强制验证）")
except Exception as e:
    log_warn(f"[main] JWT 中间件注册失败: {e}")

# ============ 静态资源缓存控制中间件（防浏览器顽固缓存） ============
@app.middleware("http")
async def cache_control_middleware(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    # HTML 和 JS/CSS 静态资源禁止缓存（开发阶段频繁更新）
    if path == "/" or path.endswith((".html", ".js", ".css", ".json")):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# ============ HTTP 请求记录中间件（v17: request_id + breadcrumb + body capture）============
@app.middleware("http")
async def record_request_middleware(request: Request, call_next):
    import time as _time, uuid
    t0 = _time.time()
    # Phase17: 生成请求ID — 关联前端行为 + 后端日志 + 错误面包屑
    request_id = request.headers.get("X-Request-ID", "") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    try:
        response = await call_next(request)
        duration = (_time.time() - t0) * 1000
        from api.monitor import record_request
        record_request(request.method, request.url.path, response.status_code, duration)
        if response.status_code >= 400 or duration > 500:
            body = ""
            try:
                if request.method in ("POST", "PUT", "PATCH") and hasattr(request, '_body'):
                    body = request._body.decode("utf-8", errors="replace")[:2000]
            except: pass
            api_log(request.method, request.url.path, response.status_code, duration, request_body=body, request_id=request_id)
        response.headers["X-Request-ID"] = request_id
        return response
    except Exception as exc:
        duration = (_time.time() - t0) * 1000
        from api.monitor import record_request
        record_request(request.method, request.url.path, 500, duration)
        from logger import capture_exception
        # 2026-08-02 加固: 请求异常后回滚当前线程事务，释放写锁
        try:
            from database import rollback_current
            rollback_current()
        except Exception:
            pass
        body = ""
        try:
            if request.method in ("POST", "PUT", "PATCH"):
                raw = await request.body()
                body = raw.decode("utf-8", errors="replace")[:2000]
        except: pass
        capture_exception(exc, source="api", path=request.url.path, status_code=500, request_body=body, request_id=request.state.request_id if hasattr(request.state,'request_id') else "")
        raise

app.include_router(prompts_router)
app.include_router(v2_router)
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
app.include_router(comfyui_router)
app.include_router(dreamina_router)
app.include_router(ocr_router)
app.include_router(cards_v4_router)
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
app.include_router(presence_router)  # Phase34 实时在线状态

# Phase23: 团队协作 — 用户认证
from auth import router as auth_router
app.include_router(auth_router)
from api.users import router as users_router
app.include_router(users_router)
from audit import router as audit_router  # Phase35 用户活动审计日志
app.include_router(audit_router)
from api.asset_library import router as asset_library_router  # Phase35.1 项目资产库
app.include_router(asset_library_router)
from api.asset_review import router as asset_review_router  # Phase35.2 版本/审核/成员
app.include_router(asset_review_router)
from api.project_roles import router as project_roles_router  # Phase36.2 项目角色/场景实例
app.include_router(project_roles_router)
# Phase35.3 设备盘索引（Agent通道 + 管理通道）
from api.device_index import agent_router, mgmt_router
app.include_router(agent_router)
app.include_router(mgmt_router)
from api.cover_api import router as cover_router
app.include_router(cover_router)
# Phase35.3-DAM 归档管理
from api.dam_archive import router as dam_router
app.include_router(dam_router)
# Phase35.3-DAM 检索增强
from api.dam_search import router as dam_search_router
app.include_router(dam_search_router)
# Phase35.3c 版本/分层/自检/备份
from api.dam_vault import router as dam_vault_router
app.include_router(dam_vault_router)
# v5.22.1: 许可激活（主机绑定+秘钥）
from api.license import router as license_router
app.include_router(license_router)

# Phase18: 插件系统由 lifespan 初始化（db/app 就绪后）


# ============ 数据同步 API (.pkb 包系统) ============

@app.get("/api/sync/packages")
async def sync_list_packages():
    """列出所有 .pkb 包"""
    packages = list_packages()
    return {"ok": True, "packages": packages, "count": len(packages)}


@app.get("/api/sync/packages/{pkg_name}")
async def sync_get_package(pkg_name: str):
    """获取单个包详细信息"""
    return get_package_info(pkg_name)


@app.get("/api/sync/download/{pkg_name}")
async def sync_download(pkg_name: str):
    """直接下载 .pkb 包文件"""
    from paths import get_data_dir
    pkg_path = os.path.join(get_data_dir(), "packages", pkg_name)
    if not os.path.isfile(pkg_path):
        return JSONResponse({"ok": False, "error": "包不存在"}, 404)
    return FileResponse(pkg_path, filename=pkg_name, media_type="application/zip")


@app.post("/api/sync/export")
async def sync_export():
    """导出完整 .pkb 包（含 DB + 媒体）"""
    result = export_package(include_media=True)
    if result.get("ok"):
        return {
            "ok": True,
            "file": result["file"],
            "size": result["size"],
            "size_str": result.get("stats", {}).get("total_size", 0),
            "stats": result["stats"]
        }
    return result


@app.post("/api/sync/export-no-media")
async def sync_export_no_media():
    """导出纯 DB 包（不含媒体）"""
    result = export_package(include_media=False)
    if result.get("ok"):
        return {
            "ok": True,
            "file": result["file"],
            "size": result["size"],
            "stats": result["stats"]
        }
    return result


@app.post("/api/sync/restore/{pkg_name}")
async def sync_restore(pkg_name: str, backup_first: bool = True):
    """从 .pkb 包恢复数据"""
    result = restore_package(pkg_name, backup_first=backup_first)
    return result


@app.post("/api/sync/upload")
async def sync_upload(file: UploadFile = File(...)):
    """上传 .pkb 包导入"""
    body = await file.read()
    filename = file.filename or "imported.pkb"
    result = import_package(body, filename)
    return result


@app.delete("/api/sync/packages/{pkg_name}")
async def sync_delete(pkg_name: str):
    """删除一个 .pkb 包"""
    result = delete_package(pkg_name)
    return result


@app.get("/api/sync/verify/{pkg_name}")
async def sync_verify(pkg_name: str):
    """验证包完整性（CRC 校验所有文件）"""
    result = verify_package(pkg_name)
    return result


# ============ 备份管理 API ============
@app.get("/api/backup/info")
async def backup_info():
    """获取备份状态"""
    return get_backup_info()


@app.post("/api/backup/now")
async def backup_now():
    """手动触发一次备份"""
    result = do_backup()
    return result


# ============ HTTPException 业务错误日志 (2026-08-02: detail 入日志，辅助排查) ============
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """业务错误（4xx/5xx 显式抛出）→ 记录详情到日志，保持原响应格式兼容前端"""
    try:
        from logger import warn
        request_id = getattr(request.state, "request_id", "")
        warn(
            f"HTTP {exc.status_code}: {exc.detail}",
            source="api",
            path=request.url.path,
            status_code=exc.status_code,
            request_id=request_id,
        )
    except Exception:
        pass  # 日志失败不影响业务响应
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=exc.headers or None,
    )


# ============ 全局异常处理器 (v16: 接入日志引擎) ============
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Phase17: 捕获请求体 + session_id + request_id + 刷面包屑
    # 2026-08-02 加固: 异常后回滚当前线程事务，释放写锁
    try:
        from database import rollback_current
        rollback_current()
    except Exception:
        pass
    body = ""
    request_id = getattr(request.state, "request_id", "unknown")
    session_id = getattr(request.state, "session_id", "")
    try:
        if request.method in ("POST", "PUT", "PATCH"):
            raw = await request.body()
            body = raw.decode("utf-8", errors="replace")[:2000]
    except Exception:
        body = "[unreadable]"
    # 刷入面包屑
    if session_id:
        try:
            from breadcrumb_logger import flush_breadcrumbs
            flush_breadcrumbs(session_id)
        except: pass
    capture_exception(exc, source="api", path=request.url.path, status_code=500, request_body=body)
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": "服务器内部错误", "detail": str(exc)[:200], "request_id": request_id}
    )


@app.get("/api/ping")
def ping():
    """极轻量心跳 — 零数据库调用，仅返回服务存活信号"""
    from datetime import datetime, timezone
    return {
        "ok": True,
        "ts": datetime.now(timezone.utc).isoformat(),
        "version": APP_VERSION
    }


@app.get("/api/status")
def get_status():
    try:
        db = get_db()
        total = safe_count_dict("SELECT COUNT(*) as cnt FROM prompts")
        usage = safe_count_dict("SELECT SUM(usage_count) as cnt FROM prompts") or 0
        cards = safe_count_dict("SELECT COUNT(*) as cnt FROM prompt_cards WHERE is_deleted=0")
        libs = safe_count_dict("SELECT COUNT(*) as cnt FROM library_assets")
        return {
            "status": "running",
            "total_prompts": total,
            "total_usage": usage,
            "total_cards": cards,
            "total_library_assets": libs,
            "version": APP_VERSION
        }
    except Exception as e:
        print("[状态] 查询失败:", e)
        return {"status": "degraded", "error": str(e), "version": "3.0.0"}


FRONTEND_DIR = get_frontend_dir()
STATIC_DIR = os.path.join(FRONTEND_DIR, "static")
TOOLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR, html=True), name="static")
if os.path.exists(TOOLS_DIR):
    app.mount("/tools", StaticFiles(directory=TOOLS_DIR, html=True), name="tools")

# 确保静态 JS/CSS 文件以 UTF-8 编码提供（修复中文乱码）
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
class _UTF8StaticMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        ct = response.headers.get("content-type", "")
        if "text/" in ct or "javascript" in ct or "css" in ct:
            if "charset" not in ct:
                response.headers["content-type"] = ct + "; charset=utf-8"
        return response
app.add_middleware(_UTF8StaticMiddleware)


@app.get("/")
def serve_index():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        resp = FileResponse(index_path)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
    return JSONResponse(status_code=404, content={"error": "前端页面未找到"})


@app.get("/cover_editor.html")
def serve_cover_editor():
    editor_path = os.path.join(FRONTEND_DIR, "cover_editor.html")
    if os.path.exists(editor_path):
        resp = FileResponse(editor_path)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
    return JSONResponse(status_code=404, content={"error": "编辑器页面未找到"})


@app.get("/login.html")
def serve_login():
    login_path = os.path.join(FRONTEND_DIR, "login.html")
    if os.path.exists(login_path):
        resp = FileResponse(login_path)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
    return JSONResponse(status_code=404, content={"error": "登录页面未找到"})


@app.get("/admin_users.html")
def serve_admin_users():
    admin_path = os.path.join(FRONTEND_DIR, "admin_users.html")
    if os.path.exists(admin_path):
        resp = FileResponse(admin_path)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
    return JSONResponse(status_code=404, content={"error": "管理页面未找到"})


@app.get("/join")
def serve_join():
    """邀请加入页面"""
    join_path = os.path.join(FRONTEND_DIR, "join.html")
    if os.path.exists(join_path):
        return FileResponse(join_path)
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content='''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>加入工作空间 — 咪卡Mik词库</title>
<style>
:root{--bg:#f8fafc;--card-bg:#fff;--text:#1e293b;--text-muted:#94a3b8;--border:#e5e7eb;--primary:#3b82f6}
@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--card-bg:#1e293b;--text:#f1f5f9;--text-muted:#64748b;--border:#334155}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:var(--card-bg);border:1px solid var(--border);border-radius:16px;padding:40px 32px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.06)}
h2{font-size:20px;font-weight:800;color:var(--text);margin:0 0 8px}
p{font-size:13px;color:var(--text-muted);margin:0 0 24px}
input{padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;width:100%;background:var(--bg);color:var(--text);text-align:center;letter-spacing:4px;font-weight:700;outline:none}
input:focus{border-color:var(--primary)}
button{width:100%;padding:12px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin-top:12px}
button:hover{background:#2563eb}
#msg{margin-top:12px;font-size:12px;min-height:20px}
</style></head><body>
<div class="card">
<h2>🔗 加入工作空间</h2>
<p>输入邀请码加入团队，开始 AIGC 协作</p>
<input type="text" id="code" placeholder="输入6位邀请码" maxlength="6" autofocus>
<button onclick="doJoin()">加 入</button>
<div id="msg"></div>
</div>
<script>
var params=new URLSearchParams(location.search);var c=params.get('code');if(c)document.getElementById('code').value=c.toUpperCase();
var token=localStorage.getItem('pk_token');
if(!token){var m0=document.getElementById('msg');m0.textContent='请先登录后再加入团队';m0.style.color='var(--text-muted)';localStorage.setItem('pk_pending_join',location.search);var b0=document.querySelector('button');b0.textContent='去登录';b0.onclick=function(){location.href='/login.html';};}
async function doJoin(){
var code=document.getElementById('code').value.trim().toUpperCase();var ws=params.get('ws')||'1';var m=document.getElementById('msg');
if(!token){localStorage.setItem('pk_pending_join',location.search);location.href='/login.html';return;}
if(!code||code.length<4){m.textContent='请输入有效邀请码';m.style.color='var(--text-muted)';return;}
try{var r=await fetch('/api/plugins/com.promptkit.project/master/'+ws+'/join',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({code:code})});var d=await r.json();
if(d.ok){m.textContent='✅ 已加入! 跳转回主页...';m.style.color='#10b981';setTimeout(function(){location.href='/';},1500);}
else{m.textContent=d.detail||'加入失败';m.style.color='#ef4444';}
}catch(e){m.textContent='网络错误';m.style.color='#ef4444';}
}
document.getElementById('code').addEventListener('keydown',function(e){if(e.key==='Enter')doJoin();});
</script></body></html>''')


@app.post("/api/utils/check-path")
def check_path(data: dict = None):
    """验证本地路径是否存在且为目录"""
    if not data or "path" not in data:
        return {"ok": False, "error": "缺少路径参数"}
    p = data["path"].strip()
    if not p:
        return {"ok": False, "error": "路径为空"}
    p = os.path.abspath(p)
    if os.path.isdir(p):
        return {"ok": True, "path": p, "name": os.path.basename(p)}
    elif os.path.exists(p):
        return {"ok": False, "error": "路径已存在但不是一个目录"}
    else:
        return {"ok": False, "error": "目录不存在，请先创建"}


@app.post("/api/utils/pick-folder")
def pick_folder():
    """弹出 Windows 原生文件夹选择对话框，返回真实完整路径

    2026-08-03 修复: ① 串行化 — tkinter 非线程安全，多点击并发创建多个
    Tk() 会互相卡死（曾导致 15:43 服务全端点超时）；
    ② 守护线程 + 120s 超时 — 对话框挂起不再占用线程池线程。
    """
    import threading
    if not hasattr(pick_folder, '_lock'):
        pick_folder._lock = threading.Lock()
    if not pick_folder._lock.acquire(blocking=False):
        return {"ok": False, "error": "目录选择器已在运行，请先完成当前选择"}
    try:
        import tkinter
        from tkinter import filedialog
        result = {}
        def _do():
            try:
                root = tkinter.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                folder = filedialog.askdirectory(title="选择导出文件夹")
                root.destroy()
                result['folder'] = folder
            except Exception as e:
                result['error'] = str(e)
        t = threading.Thread(target=_do, daemon=True)
        t.start()
        t.join(timeout=120)  # 超时保护，防止线程被对话框永久占用
        if 'error' in result:
            return {"ok": False, "error": f"打开目录选择器失败: {result['error']}"}
        if t.is_alive():
            return {"ok": False, "error": "目录选择超时，请重试"}
        folder = result.get('folder')
        if folder:
            folder = os.path.abspath(folder)
            return {"ok": True, "path": folder, "name": os.path.basename(folder)}
        return {"ok": False, "error": "未选择目录"}
    except Exception as e:
        return {"ok": False, "error": f"打开目录选择器失败: {e}"}
    finally:
        pick_folder._lock.release()


@app.post("/api/utils/default-download-path")
def default_download_path():
    """返回默认下载文件夹路径（%USERPROFILE%\\Downloads），供导出弹窗缺省填充"""
    try:
        downloads = os.path.join(os.path.expanduser("~"), "Downloads")
        path = downloads if os.path.isdir(downloads) else os.path.expanduser("~")
        return {"ok": True, "path": path}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/utils/open-folder")
def open_folder(data: dict = None):
    """在系统文件管理器中打开指定目录（缺省为下载文件夹）

    2026-08-02 补全: PNG 导出后「打开文件夹」按钮的后端支撑。
    默认打开 %USERPROFILE%\\Downloads（浏览器默认下载目录）。
    """
    try:
        path = ""
        if data and data.get("path"):
            path = os.path.abspath(str(data["path"]).strip())
            if not os.path.isdir(path):
                return {"ok": False, "error": f"目录不存在: {path}"}
        else:
            downloads = os.path.join(os.path.expanduser("~"), "Downloads")
            path = downloads if os.path.isdir(downloads) else os.path.expanduser("~")
        if sys.platform == "win32":
            os.startfile(path)  # type: ignore
        else:
            subprocess.Popen(["xdg-open", path])
        return {"ok": True, "path": path}
    except Exception as e:
        return {"ok": False, "error": f"打开目录失败: {e}"}


@app.post("/api/utils/save-blob")
def save_blob(data: dict = None):
    """将 base64 数据写入指定路径，文件已存在时自动新建副本不覆盖
    沙箱: 禁止写入 data/ 等受保护目录内的文件（防覆盖 DB/密钥/源码）
    """
    import base64
    if not data:
        return {"ok": False, "error": "缺少数据"}
    path = data.get("path", "")
    content_b64 = data.get("content", "")
    if not path or not content_b64:
        return {"ok": False, "error": "缺少路径或内容"}
    try:
        path = os.path.abspath(path)
        # ---- 沙箱守卫：禁止覆写受保护目录（data/, backend/, agent/, plugins/, .git/） ----
        _protect_prefixes = [
            os.path.abspath(os.path.join(BASE_DIR, "data")),
            os.path.abspath(os.path.join(BASE_DIR, "backend")),
            os.path.abspath(os.path.join(BASE_DIR, "agent")),
            os.path.abspath(os.path.join(BASE_DIR, "plugins")),
            os.path.abspath(os.path.join(BASE_DIR, ".git")),
        ]
        _real = os.path.realpath(path)
        for prefix in _protect_prefixes:
            if _real.startswith(prefix + os.sep) or _real == prefix:
                return {"ok": False, "error": f"禁止写入受保护目录: {os.path.basename(prefix)}"}
        # ---- 大小限制：max 50MB base64（约 37MB 实际数据） ----
        if len(content_b64) > 50 * 1024 * 1024:
            return {"ok": False, "error": "数据过大，最大支持 50MB"}
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # 如果文件已存在，自动新建副本（不覆盖）
        if os.path.exists(path):
            base, ext = os.path.splitext(path)
            counter = 1
            while os.path.exists(f"{base} ({counter}){ext}"):
                counter += 1
            path = f"{base} ({counter}){ext}"
        raw = base64.b64decode(content_b64)
        with open(path, "wb") as f:
            f.write(raw)
        return {"ok": True, "path": path}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(3)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    import sys as _sys
    base_port = int(os.environ.get("PORT", 8080))
    # 预探测可用端口（自兜底 0..19）
    port = base_port
    for offset in range(20):
        candidate = base_port + offset
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        try:
            sock.bind(("0.0.0.0", candidate))
            sock.close()
            port = candidate
            break
        except Exception:
            sock.close()
            if offset < 9:
                print("[start] port %d busy, trying %d..." % (candidate, candidate + 1))
            else:
                print("[start] FAIL: all ports %d~%d busy" % (base_port, base_port + 9))
                _sys.exit(1)
    print("[start] server starting on port %d..." % port)
    # 更新全局端口号（lifespan 中打印用）
    globals()['ACTUAL_PORT'] = port
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False, log_level="info")
