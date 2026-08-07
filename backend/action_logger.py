"""
Phase17: User Action Logger — 前端用户行为追踪 + 全局错误捕获
Phase 2.2 起实现已并入 logger.py，本文件为兼容转发层（旧 import 不破坏）。
"""
from logger import action_stream_generator, query_actions, record_action  # noqa: F401
