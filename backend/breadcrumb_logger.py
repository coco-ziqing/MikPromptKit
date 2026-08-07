"""
Phase17: Breadcrumb Logger — 错误发生前的事件追溯
Phase 2.2 起实现已并入 logger.py，本文件为兼容转发层（旧 import 不破坏）。
"""
from logger import clear_breadcrumbs_before, flush_breadcrumbs, get_breadcrumbs, record_breadcrumb  # noqa: F401
