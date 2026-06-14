"""
共享路径模块 — 开发/打包兼容
"""
import os
import sys


def get_base_dir() -> str:
    """
    返回应用根目录。
    开发环境: prompt-tool-dev/
    打包环境: PromptKit.exe 所在目录（data/ 放这里）
    """
    if getattr(sys, 'frozen', False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_resource_dir() -> str:
    """
    返回打包资源目录。
    开发环境: 同 get_base_dir()
    打包环境: sys._MEIPASS（_internal/ 目录，含前端等内嵌资源）
    """
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return get_base_dir()


def get_frontend_dir() -> str:
    """前端静态文件目录"""
    # 开发环境: prompt-tool-dev/frontend/
    # 打包环境: _internal/frontend/
    return os.path.join(get_resource_dir(), 'frontend')


def get_data_dir() -> str:
    """data/ 目录：始终在 EXE 旁边，用户可管理"""
    return os.path.join(get_base_dir(), 'data')


def get_db_path() -> str:
    return os.path.join(get_data_dir(), 'prompts.db')
