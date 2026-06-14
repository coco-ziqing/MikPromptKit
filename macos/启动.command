#!/bin/bash
# ============================================================
# 咪卡MiK提示词助手 — macOS 启动脚本
# ============================================================

# 获取脚本所在目录
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/MikPromptKit.app"

if [ -d "$APP" ]; then
    echo "启动 咪卡MiK提示词助手..."
    open "$APP"
else
    # 尝试直接找 .app
    ALTERNATE=$(find "$DIR" -name "*.app" -maxdepth 2 | head -1)
    if [ -n "$ALTERNATE" ]; then
        echo "启动 咪卡MiK提示词助手..."
        open "$ALTERNATE"
    else
        echo "错误: 未找到 MikPromptKit.app"
        echo "请确保本脚本与 .app 在同一目录"
        echo ""
        read -p "按 Enter 退出..."
    fi
fi
