"""
CLI 路径探测 — 封装版位置无关（2026-08-06）

探测顺序（便携优先）：
1. 环境变量（DREAMINA_BIN / LIBTV_BIN 显式指定）
2. 应用目录 bin/（<项目根>/bin/dreamina.exe）—— 封装版把 exe 放这里，随文件夹走
3. 用户目录（~/.libtv/libtv.exe 等默认安装位置）

任何位置放置项目文件夹均可运行；exe 未找到时返回 None，调用方懒提示。
"""
import os


def _app_bin_dir() -> str:
    """应用根目录下的 bin/（位置无关，随项目文件夹移动）
    cli_paths.py 位于 <根>/backend/api/，上三级即项目根"""
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(root, "bin")


def find_dreamina_bin() -> str:
    """探测 dreamina CLI 路径"""
    env = os.environ.get("DREAMINA_BIN")
    if env and os.path.exists(env):
        return env
    local = os.path.join(_app_bin_dir(), "dreamina.exe")
    if os.path.exists(local):
        return local
    user = os.path.join(os.path.expanduser("~"), "bin", "dreamina.exe")
    if os.path.exists(user):
        return user
    return ""


def find_libtv_bin() -> str:
    """探测 libtv CLI 路径"""
    env = os.environ.get("LIBTV_BIN")
    if env and os.path.exists(env):
        return env
    local = os.path.join(_app_bin_dir(), "libtv.exe")
    if os.path.exists(local):
        return local
    user = os.path.join(os.path.expanduser("~"), ".libtv", "libtv.exe")
    if os.path.exists(user):
        return user
    return ""
