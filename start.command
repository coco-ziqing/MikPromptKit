#!/bin/bash
# ================================================================
# PromptKit v4.0 — macOS 封装应用启动器 (.command)
# 用法：Finder 中双击此文件即可启动
# 支持：macOS Catalina+ / Intel x86_64
# ================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ---------- 环境检测 ----------
PYTHON=""
for py in python3.12 python3 python; do
    if command -v "$py" &>/dev/null; then
        PYTHON="$py"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "❌ 未找到 Python，请安装 Python 3.10+"
    echo "   下载: https://www.python.org/downloads/"
    read -p "按回车键退出..."
    exit 1
fi

echo "✅ 使用 Python: $($PYTHON --version)"

# ---------- 首次运行：自动安装依赖 ----------
VENV_DIR="$SCRIPT_DIR/venv"
if [ ! -f "$VENV_DIR/bin/activate" ]; then
    echo "📦 首次运行，正在创建虚拟环境..."
    $PYTHON -m venv "$VENV_DIR"
    source "$VENV_DIR/bin/activate"
    echo "📦 安装依赖包（约 60 秒）..."
    pip install --upgrade pip -q
    pip install -r "$SCRIPT_DIR/requirements.txt" -q
    echo "📦 预下载语义搜索模型（首次约 200MB）..."
    python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" 2>/dev/null
else
    source "$VENV_DIR/bin/activate"
fi

# ---------- 检查 ffmpeg ----------
if ! command -v ffmpeg &>/dev/null; then
    echo "⚠️  ffmpeg 未安装（视频上传功能不可用）"
    echo "   安装: brew install ffmpeg"
fi

# ---------- 确保 data 目录存在 ----------
mkdir -p "$SCRIPT_DIR/data/thumbnails"
mkdir -p "$SCRIPT_DIR/data/originals"
mkdir -p "$SCRIPT_DIR/data/videos"
mkdir -p "$SCRIPT_DIR/data/backups"
mkdir -p "$SCRIPT_DIR/data/packages"

# ---------- 启动服务 ----------
echo "🚀 正在启动 PromptKit..."
echo "   本机访问: http://localhost:8080"
echo "   按 Ctrl+C 停止服务"
echo ""

# 尝试自动打开浏览器
sleep 1
open "http://localhost:8080" 2>/dev/null || true

# 启动后端
python "$SCRIPT_DIR/backend/main.py"

# 退出时暂停
echo ""
echo "服务已停止。按回车键关闭窗口..."
read
