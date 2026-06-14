#!/bin/bash
# ============================================================
# 咪卡MiK提示词助手 — macOS 安装包生成器
# 生成: MikPromptKit.dmg (拖拽安装)
# 目标: macOS 10.10 (Yosemite) ~ macOS 15 (Sequoia)
# 用法: chmod +x build_dmg.sh && ./build_dmg.sh
# ============================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/dist_macos"
APP_NAME="咪卡MiK提示词助手"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
DMG_NAME="MikPromptKit_v4.0.0.dmg"
DMG_PATH="$BUILD_DIR/$DMG_NAME"

echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║    咪卡MiK提示词助手 · macOS 安装包生成器    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ==================== [1/6] 系统检查 ====================
echo -e "${YELLOW}[1/6] 检查系统环境...${NC}"

OS_VER=$(sw_vers -productVersion 2>/dev/null || echo "unknown")
echo -e "  macOS: ${GREEN}$OS_VER${NC}"

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}  ❌ 需要 Python 3.10+${NC}"
    echo "     安装: brew install python@3.10"
    exit 1
fi
PY_VER=$(python3 --version 2>&1)
echo -e "  Python: ${GREEN}$PY_VER${NC}"

if ! python3 -c "import struct; assert struct.calcsize('P')*8==64" 2>/dev/null; then
    echo -e "${RED}  ❌ 需要 64-bit Python${NC}"; exit 1
fi

# ==================== [2/6] 安装依赖 ====================
echo ""
echo -e "${YELLOW}[2/6] 安装 Python 依赖...${NC}"

pip3 install --quiet --upgrade pip
pip3 install --quiet -r "$PROJECT_DIR/requirements_macos.txt"
echo -e "  ${GREEN}✅ 依赖安装完成${NC}"

# 检查 create-dmg
if ! command -v create-dmg &> /dev/null; then
    echo -e "  ${YELLOW}安装 create-dmg (DMG 制作工具)...${NC}"
    if command -v brew &> /dev/null; then
        brew install create-dmg
    else
        echo -e "  ${YELLOW}⚠️ 未安装 Homebrew，跳过 create-dmg，使用 hdiutil 替代${NC}"
    fi
fi

# ==================== [3/6] 生成 App 图标 ====================
echo ""
echo -e "${YELLOW}[3/6] 生成 .icns 应用图标...${NC}"

ICON_DIR="$PROJECT_DIR/macos/resources"
ICON_SVG="$ICON_DIR/app_icon.svg"
ICONSET_DIR="$ICON_DIR/app_icon.iconset"
ICNS_FILE="$ICON_DIR/app.icns"

if [ ! -f "$ICON_SVG" ]; then
    echo -e "${RED}  ❌ 找不到图标源文件: $ICON_SVG${NC}"; exit 1
fi

# 如果 img2icns 不可用，仅准备 PNG 备选
if command -v rsvg-convert &> /dev/null; then
    rm -rf "$ICONSET_DIR"; mkdir -p "$ICONSET_DIR"
    for SIZE in 16 32 64 128 256 512 1024; do
        rsvg-convert -w $SIZE -h $SIZE "$ICON_SVG" -o "$ICONSET_DIR/icon_${SIZE}x${SIZE}.png" 2>/dev/null || true
        HALF=$((SIZE/2))
        [ "$HALF" -gt 0 ] && rsvg-convert -w $SIZE -h $SIZE "$ICON_SVG" -o "$ICONSET_DIR/icon_${HALF}x${HALF}@2x.png" 2>/dev/null || true
    done
    iconutil -c icns "$ICONSET_DIR" -o "$ICNS_FILE" 2>/dev/null && echo -e "  ${GREEN}✅ 图标已生成: $ICNS_FILE${NC}" || echo -e "  ${YELLOW}⚠️ iconutil 失败，使用无图标构建${NC}"
else
    echo -e "  ${YELLOW}⚠️ 未安装 rsvg-convert，跳过图标生成${NC}"
    echo -e "     安装: brew install librsvg"
    echo -e "     使用默认图标继续..."
fi

# ==================== [4/6] 构建 .app ====================
echo ""
echo -e "${YELLOW}[4/6] 构建 .app (目标 macOS 10.10+)...${NC}"

rm -rf "$BUILD_DIR"

export MACOSX_DEPLOYMENT_TARGET=10.10

python3 -m PyInstaller "$PROJECT_DIR/build_macos.spec" --noconfirm --distpath "$BUILD_DIR"
echo -e "  ${GREEN}✅ .app 构建完成${NC}"

# 检查 .app 是否存在（可能在临时目录）
if [ -d "$BUILD_DIR/$APP_NAME.app" ]; then
    mv "$BUILD_DIR/$APP_NAME.app" "$APP_BUNDLE" 2>/dev/null || true
fi

if [ ! -d "$APP_BUNDLE" ]; then
    # 搜索实际生成的 .app
    FOUND_APP=$(find "$BUILD_DIR" -name "*.app" -maxdepth 2 | head -1)
    if [ -n "$FOUND_APP" ]; then
        mv "$FOUND_APP" "$APP_BUNDLE"
    fi
fi

if [ ! -d "$APP_BUNDLE" ]; then
    echo -e "${RED}  ❌ 找不到生成的 .app${NC}"; exit 1
fi

APP_SIZE=$(du -sh "$APP_BUNDLE" | cut -f1)
echo -e "  ${GREEN}  📱 $APP_BUNDLE ($APP_SIZE)${NC}"

# ==================== [5/6] 代码签名（可选） ====================
echo ""
echo -e "${YELLOW}[5/6] 代码签名检查 (可选)...${NC}"

# 尝试 ad-hoc 签名（无需苹果开发者账号）
if codesign --force --deep --sign - "$APP_BUNDLE" 2>/dev/null; then
    echo -e "  ${GREEN}✅ ad-hoc 签名完成 (仅用于移除 Gatekeeper 警告)${NC}"
else
    echo -e "  ${YELLOW}⚠️ 签名跳过 (不影响运行，仅在首次启动需要右键→打开)${NC}"
fi

# 如果配置了开发者证书，提示正式签名命令
DEV_CERT=$(security find-identity -v -p basic 2>/dev/null | grep "Developer ID Application" | head -1 | awk '{print $2}')
if [ -n "$DEV_CERT" ]; then
    echo -e "  ${GREEN}  检测到开发者证书: $DEV_CERT${NC}"
    echo -e "  ${GREEN}  正式签名: codesign --force --deep --sign \"$DEV_CERT\" \"$APP_BUNDLE\"${NC}"
fi

# ==================== [6/6] 制作 .dmg 安装包 ====================
echo ""
echo -e "${YELLOW}[6/6] 制作 .dmg 安装包...${NC}"

if command -v create-dmg &> /dev/null; then
    echo -e "  使用 create-dmg (高级 DMG)..."
    BG_IMG="$PROJECT_DIR/macos/resources/dmg_background.svg"
    BG_FLAG=""
    [ -f "$BG_IMG" ] && BG_FLAG="--background $BG_IMG"
    
    create-dmg \
        --volname "MikPromptKit" \
        --volicon "$ICNS_FILE" \
        $BG_FLAG \
        --window-pos 200 120 \
        --window-size 660 480 \
        --icon-size 80 \
        --icon "$APP_NAME.app" 230 280 \
        --app-drop-link 400 280 \
        --hide-extension "$APP_NAME.app" \
        --no-internet-enable \
        "$DMG_PATH" \
        "$APP_BUNDLE" 2>&1
    
    echo -e "  ${GREEN}✅ DMG 安装包已生成: $DMG_PATH${NC}"
else
    echo -e "  使用 hdiutil (标准 DMG)..."
    
    # 创建临时目录
    TMP_DMG_DIR="/tmp/mikpromptkit_dmg"
    rm -rf "$TMP_DMG_DIR"
    mkdir -p "$TMP_DMG_DIR"
    cp -R "$APP_BUNDLE" "$TMP_DMG_DIR/"
    ln -s /Applications "$TMP_DMG_DIR/Applications"
    
    # 生成 DMG
    TMP_DMG="/tmp/MikPromptKit_tmp.dmg"
    rm -f "$TMP_DMG"
    hdiutil create -srcfolder "$TMP_DMG_DIR" -volname "MikPromptKit" \
        -fs HFS+ -format UDZO -imagekey zlib-level=9 \
        "$TMP_DMG" -quiet
    mv "$TMP_DMG" "$DMG_PATH"
    rm -rf "$TMP_DMG_DIR"
    echo -e "  ${GREEN}✅ DMG 安装包已生成: $DMG_PATH${NC}"
fi

# 检查最终输出
DMG_SIZE=$(du -sh "$DMG_PATH" | cut -f1)
echo -e "  ${GREEN}  🗜️ $DMG_PATH ($DMG_SIZE)${NC}"

# ==================== 完成 ====================
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ 安装包生成完成！${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  📦 安装包:    ${GREEN}$DMG_PATH${NC} ($DMG_SIZE)"
echo -e "  📱 应用:      ${GREEN}$APP_BUNDLE${NC}"
echo -e ""
echo -e "  🚀 安装方式:"
echo -e "     1. 打开 $DMG_NAME"
echo -e "     2. 将 MikPromptKit.app 拖入 Applications 文件夹"
echo -e "     3. 首次运行: 右键 → 打开 (或前往 系统设置 → 隐私与安全性 → 仍要打开)"
echo -e ""
echo -e "  💡 局域网访问: 启动后浏览器打开 http://\`ipconfig getifaddr en0\`:8080"
echo ""

# ==================== 清理 ====================
rm -rf "$PROJECT_DIR/build" "$PROJECT_DIR/*.spec" "$PROJECT_DIR/__pycache__" 2>/dev/null || true
echo -e "${YELLOW}  临时文件已清理${NC}"
echo ""
