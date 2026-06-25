#!/usr/bin/env python3
"""
PromptKit i18n 批量迁移工具
扫描所有 JS 前端文件中的硬编码中文字符串 → 替换为 App._t(key, fallback)
生成合并后的 en.json 翻译字典
"""
import re, json, os, sys
from pathlib import Path
from collections import OrderedDict

WORKSPACE = Path(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev")
JS_DIR = WORKSPACE / "frontend" / "static" / "js"
I18N_DIR = WORKSPACE / "frontend" / "static" / "i18n"
EN_JSON = I18N_DIR / "en.json"

# ── 英文翻译映射表（手工维护） ──
TRANSLATIONS = {
    # === 通用 ===
    "确定": "OK", "取消": "Cancel", "保存": "Save", "删除": "Delete",
    "编辑": "Edit", "复制": "Copy", "关闭": "Close", "确认": "Confirm",
    "搜索": "Search", "导入": "Import", "导出": "Export", "新建": "New",
    "刷新": "Refresh", "重置": "Reset", "返回": "Back", "加载中...": "Loading...",
    "保存成功": "Saved successfully", "保存失败": "Save failed",
    "删除成功": "Deleted successfully", "删除失败": "Delete failed",
    "操作成功": "Operation successful", "操作失败": "Operation failed",
    "复制成功": "Copied successfully", "已复制": "Copied",
    "暂无数据": "No data", "暂无内容": "No content",
    "加载失败": "Load failed", "网络错误": "Network error",
    "请求超时": "Request timeout", "未知错误": "Unknown error",
    "全部": "All", "更多": "More", "其他": "Other",
    "是": "Yes", "否": "No", "开": "On", "关": "Off",
    "成功": "Success", "失败": "Failed",
    "已保存": "Saved", "已删除": "Deleted",
    "请输入": "Please enter", "请选择": "Please select",
    "提示": "Notice", "警告": "Warning", "错误": "Error",
    "秒": "s", "分钟": "min", "小时": "h", "条": "items", "个": "",

    # === 导航 ===
    "首页": "Home", "词库": "Library", "收藏夹": "Collections",
    "词包": "Word Packs", "最近使用": "Recent", "回收站": "Trash",
    "组装器": "Composer", "词卡管理": "Card Manager", "媒体资产": "Media Assets",
    "编辑模式": "Edit Mode", "退出编辑": "Exit Edit",
    "切换语言": "Switch Language", "切换深色模式": "Toggle Dark Mode",
    "切换浅色模式": "Toggle Light Mode",
    "切换搜索模式": "Toggle Search Mode",
    "数据库备份": "DB Backup", "数据同步": "Data Sync",
    "服务监测": "Monitor", "统计仪表盘": "Dashboard",
    "截图导入": "Screenshot Import",
    "调整卡片列数": "Adjust Columns", "列": "cols",

    # === 提示词相关 ===
    "提示词": "prompt", "提示词列表": "Prompt List",
    "全部词库": "All Library", "全部模块": "All Modules",
    "新建提示词": "New Prompt", "编辑提示词": "Edit Prompt",
    "删除提示词": "Delete Prompt", "导入提示词": "Import Prompts",
    "导出提示词": "Export Prompts", "复制内容": "Copy Content",
    "搜索提示词": "Search prompts", "搜索中...": "Searching...",
    "没有匹配的提示词": "No matching prompts",
    "请输入提示词内容": "Please enter prompt content",
    "请先输入提示词内容": "Enter prompt content first",
    "正在加载提示词...": "Loading prompts...",

    # === 卡片 ===
    "卡片": "card", "创建卡片": "Create Card",
    "编辑卡片": "Edit Card", "删除卡片": "Delete Card",
    "卡片内容": "Card Content", "卡片标题": "Card Title",
    "卡片类型": "Card Type", "卡片分组": "Card Group",
    "卡片标签": "Card Tags", "卡片备注": "Card Notes",

    # === 分组 ===
    "分组": "group", "新建分组": "New Group",
    "编辑分组": "Edit Group", "删除分组": "Delete Group",
    "分组名称": "Group Name", "父级分组": "Parent Group",
    "移动到分组": "Move to group", "选择分组": "Select Group",
    "全部分组": "All Groups", "未分组": "Uncategorized",

    # === 模块 ===
    "图像描述词库": "Image Prompt Library",
    "视频描述词库": "Video Prompt Library",
    "人物表现": "Character Expression",
    "画面调性": "Visual Tone",
    "构图与画质": "Composition & Quality",
    "时空风格": "Time & Style",
    "负面提示词": "Negative Prompts",
    "自定义收纳": "Custom Collection",

    # === 编辑器 ===
    "提示词内容": "Prompt Content", "标签": "Tags",
    "来源": "Source", "备注": "Notes",
    "分类": "Category", "模块": "Module",
    "请输入内容": "Please enter content",

    # === 收藏 ===
    "添加到收藏夹": "Add to Collection", "移出收藏夹": "Remove from Collection",
    "创建收藏夹": "Create Collection", "删除收藏夹": "Delete Collection",
    "收藏夹名称": "Collection Name",
    "暂无收藏": "No collections yet",
    "已收藏": "Collected",

    # === 词包 ===
    "自定义词包": "Custom Word Pack",
    "创建词包": "Create Word Pack", "删除词包": "Delete Word Pack",
    "词包名称": "Pack Name",
    "暂无词包": "No word packs",
    "添加到词包": "Add to Pack",

    # === 历史 ===
    "最近使用记录": "Recent Usage", "清空历史": "Clear History",
    "暂无使用记录": "No usage history",

    # === 回收站 ===
    "恢复": "Restore", "清空回收站": "Empty Trash",
    "回收站为空": "Trash is empty",
    "永久删除": "Permanently Delete",

    # === 种子舞/组装器 ===
    "提示词组装器": "Prompt Composer", "镜头审阅": "Scene Review",
    "新建项目": "New Project", "保存项目": "Save Project",
    "添加镜头": "Add Shot", "删除镜头": "Delete Shot",
    "导出项目": "Export Project", "导入项目": "Import Project",
    "模板库": "Templates", "分类筛选": "Filter by Category",
    "选择模板": "Select Template",
    "镜头": "Shot", "场景": "Scene",
    "风格": "Style", "时间轴": "Timeline",
    "声音": "Audio", "特效": "Effects",
    "运镜": "Camera Movement", "构图": "Composition",
    "格式": "Format", "密度": "Density",
    "总时长": "Total Duration", "宽高比": "Aspect Ratio",
    "分辨率": "Resolution",
    "低": "Low", "中": "Medium", "高": "High",
    "序号": "No.", "标题": "Title",
    "引用": "Reference", "描述": "Description",
    "镜头语言": "Shot Language", "模板分类": "Template Category",
    "项目名称": "Project Name", "镜头名称": "Shot Name",

    # === AI 工具 ===
    "AI 工具": "AI Tools", "AI优化器": "AI Optimizer",
    "优化提示词": "Optimize Prompt", "批量翻译": "Batch Translate",
    "智能标签": "Auto Tag", "格式适配": "Format Adapt",
    "AI缩略图": "AI Thumbnail",
    "优化中...": "Optimizing...", "翻译中...": "Translating...",
    "分析中...": "Analyzing...",
    "优化完成": "Optimization Complete",
    "翻译完成": "Translation Complete",
    "分析完成": "Analysis Complete",
    "润色增强": "Polish & Enhance", "精简压缩": "Compress",
    "反向解析": "Reverse Analyze",
    "开始优化": "Start Optimize", "停止": "Stop",
    "应用": "Apply", "重新优化": "Re-optimize",
    "优化结果": "Optimization Result",
    "目标格式": "Target Format",
    "批量翻译选中提示词": "Batch translate selected prompts",
    "AI自动分析当前模块词条的标签和分类": "Auto-analyze tags & categories",
    "将提示词适配到SDXL/Flux/MJ/DALL-E格式": "Adapt to SDXL/Flux/MJ/DALL-E formats",
    "AI智能生成缩略图封面": "AI smart thumbnail generation",
    "已填入编辑框，请保存": "Filled into editor, please save",
    "请通过编辑弹窗保存": "Save through edit dialog",
    "没有优化结果可应用": "No optimization result to apply",
    "没有内容可复制": "No content to copy",
    "已复制优化结果": "Copied optimization result",
    "未获得有效输出，请重试": "No valid output, please retry",
    "请求失败": "Request failed",
    "正在分析标签... (最多20条)": "Analyzing tags... (max 20)",
    "正在生成AI缩略图": "Generating AI thumbnails",
    "请先选择要翻译的提示词（编辑模式 + 勾选）": "Select prompts first (edit mode + check)",
    "请先选择词条": "Select items first",
    "标签分析完成": "Tag analysis complete",
    "标签分析失败": "Tag analysis failed",
    "AI缩略图生成": "AI thumbnail generated",
    "AI缩略图生成失败": "AI thumbnail generation failed",
    "AI 分析标签": "AI Analyze Tags",
    "AI 分析完成": "AI Analysis Complete",
    "AI 分析失败": "AI Analysis Failed",
    "AI 分析出错": "AI Analysis Error",
    "翻译失败": "Translation Failed",
    "翻译缓存命中": "Translation cache hit",
    "当前模块没有词条": "No items in current module",
    "查看模型原始响应": "View model raw response",
    "在此粘贴或修改提示词...": "Paste or edit prompt here...",

    # === 同步/备份 ===
    "导出成功": "Export successful", "导出失败": "Export failed",
    "导入成功": "Import successful", "导入失败": "Import failed",
    "恢复成功": "Restore successful", "恢复失败": "Restore failed",
    "备份成功": "Backup successful", "备份失败": "Backup failed",
    "数据导出": "Data Export", "数据导入": "Data Import",
    "数据恢复": "Data Restore",
    "正在导出...": "Exporting...", "正在导入...": "Importing...",
    "导出格式": "Export Format", "选择文件": "Choose File",
    "确认导入": "Confirm Import", "确认删除": "Confirm Delete",
    "确认清空": "Confirm Clear",
    "此操作不可撤销，确定继续？": "This cannot be undone. Continue?",
    "确定要删除吗？": "Are you sure you want to delete?",

    # === 媒体 ===
    "上传": "Upload", "上传中...": "Uploading...",
    "上传成功": "Upload successful", "上传失败": "Upload failed",
    "图片": "Image", "视频": "Video",
    "缩略图": "Thumbnail", "原图": "Original",
    "查看": "View", "预览": "Preview",
    "下载": "Download", "拖拽上传": "Drag to upload",

    # === 角色 ===
    "角色": "Character", "创建角色": "Create Character",
    "编辑角色": "Edit Character", "删除角色": "Delete Character",
    "角色名称": "Character Name", "角色头像": "Character Avatar",
    "角色描述": "Character Description",
    "上传头像": "Upload Avatar", "裁剪头像": "Crop Avatar",

    # === Playground ===
    "发送": "Send", "清空对话": "Clear Chat",
    "对话历史": "Chat History", "模型选择": "Model Select",
    "系统提示": "System Prompt",
    "温度": "Temperature",

    # === 监测 ===
    "服务状态": "Service Status",
    "运行中": "Running", "已停止": "Stopped",
    "未连接": "Not Connected", "在线": "Online",
    "离线": "Offline", "连接中": "Connecting",
    "启动自检": "Run Health Check", "自检结果": "Health Results",
    "自检中...": "Checking...",

    # === v4词库 ===
    "词库资产": "Library Assets",
    "新建资产": "New Asset", "编辑资产": "Edit Asset",
    "删除资产": "Delete Asset", "导入资产": "Import Asset",
    "导出资产": "Export Asset",
    "资产名称": "Asset Name", "资产类型": "Asset Type",
    "资产内容": "Asset Content",

    # === 词卡 ===
    "词卡": "Word Card",
    "新建词卡": "New Card", "编辑词卡": "Edit Card",
    "删除词卡": "Delete Card",
    "导入词卡": "Import Cards", "导出词卡": "Export Cards",
    "搜索词卡...": "Search cards...",

    # === Toast / MessageBox ===
    "正在保存...": "Saving...",
    "网络连接失败": "Network connection failed",
    "已复制到剪贴板": "Copied to clipboard",
    "已复制提示词": "Prompt copied",
    "确认操作": "Confirm action",
    "所有更改已放弃": "All changes discarded",

    # === 其它 ===
    "页": "Page", "共": "of",
    "深色模式": "Dark Mode", "浅色模式": "Light Mode",
    "语言": "Language", "中文": "Chinese", "英文": "English",
    "品牌": "Brand", "版本": "Version",
    "确认替换": "Confirm Replace", "取消替换": "Cancel Replace",
    "已取消": "Canceled",
    "查看原图": "View Original", "查看原视频": "View Original Video",
    "无": "None",
    "输入": "Input", "输出": "Output",
    "配置": "Configuration", "设置": "Settings",
    "详情": "Details", "摘要": "Summary",
    "数据": "Data", "统计": "Statistics",
    "操作": "Actions", "状态": "Status",
    "类型": "Type", "名称": "Name", "时间": "Time",
    "创建时间": "Created", "更新时间": "Updated",
    "大小": "Size", "数量": "Count",
    "文件": "File", "路径": "Path",
    "未知": "Unknown", "自定义": "Custom",
    "默认": "Default", "启用": "Enabled", "禁用": "Disabled",
    "显示": "Show", "隐藏": "Hide",
    "展开": "Expand", "折叠": "Collapse",
    "上一页": "Prev Page", "下一页": "Next Page",
    "首页": "Home Page", "末页": "Last Page",
    "最多": "max", "最少": "min",
    "升序": "Ascending", "降序": "Descending",
    "关键字": "Keyword", "语义": "Semantic",
    "建议": "Suggestion", "推荐": "Recommended",
}

# ── 从中文生成 key ──
def chinese_to_key(text):
    """将中文文本转换为 i18n key"""
    # 预定义映射
    key_map = OrderedDict({
        # === 通用 ===
        "确定": "common.ok", "取消": "common.cancel", "保存": "common.save",
        "删除": "common.delete", "编辑": "common.edit", "复制": "common.copy",
        "关闭": "common.close", "确认": "common.confirm", "搜索": "common.search",
        "导入": "common.import", "导出": "common.export", "新建": "common.new",
        "刷新": "common.refresh", "重置": "common.reset", "返回": "common.back",
        "加载中...": "common.loading", "保存成功": "common.saved",
        "保存失败": "common.save_failed", "删除成功": "common.deleted",
        "删除失败": "common.delete_failed", "操作成功": "common.op_ok",
        "操作失败": "common.op_failed", "复制成功": "common.copied",
        "已复制": "common.copied", "暂无数据": "common.no_data",
        "暂无内容": "common.no_content",
        "加载失败": "common.load_failed", "网络错误": "common.net_error",
        "请求超时": "common.timeout", "未知错误": "common.unknown_error",
        "全部": "common.all", "更多": "common.more", "其他": "common.other",
        "成功": "common.success", "失败": "common.failed",
        "提示": "common.notice", "警告": "common.warning",
        "错误": "common.error", "条": "common.items", "个": "common.count",
        "列": "layout.cols",

        # === 导航 ===
        "首页": "nav.home", "收藏夹": "nav.collections",
        "词包": "nav.wordpacks", "最近使用": "nav.history",
        "回收站": "nav.trash", "组装器": "nav.composer",
        "词卡管理": "nav.wordcards", "媒体资产": "nav.media",
        "编辑模式": "nav.editmode", "切换语言": "lang.switch",
        "切换深色模式": "theme.toggle",

        # === 提示词 ===
        "新建提示词": "editor.new_prompt", "编辑提示词": "editor.edit_prompt",
        "删除提示词": "editor.delete_prompt", "复制内容": "card.copy_content",
        "导入提示词": "editor.import", "导出提示词": "editor.export",
        "搜索中...": "search.searching", "没有匹配的提示词": "search.no_results",
        "提示词列表": "prompt.list_title", "全部词库": "prompt.all",
        "请输入提示词内容": "editor.enter_content",

        # === 分组 ===
        "新建分组": "group.new", "编辑分组": "group.edit",
        "删除分组": "group.delete", "分组名称": "group.name",
        "移动到分组": "group.move_to",
        "全部分组": "group.all",

        # === 收藏 ===
        "添加到收藏夹": "collection.add_to",
        "创建收藏夹": "collection.create",
        "删除收藏夹": "collection.delete",
        "暂无收藏": "collection.empty",

        # === 回收站 ===
        "恢复": "trash.restore", "清空回收站": "trash.empty_all",
        "回收站为空": "trash.empty",
    })

    for cn, key in key_map.items():
        if text == cn or text.startswith(cn):
            return key
    return None


def find_chinese_strings_in_file(filepath):
    """从 JS 文件中提取所有含中文的字符串字面量，返回 {line_number: [(original, quote_char), ...]}"""
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    results = {}  # line_idx -> [(full_match, quote_char, col_start, col_end), ...]
    
    for idx, line in enumerate(lines):
        stripped = line.strip()
        # 跳过纯注释行
        if stripped.startswith('//'):
            continue
        if stripped.startswith('/*') and stripped.endswith('*/'):
            continue
        
        # 先移除行内注释和已有 App._t() 调用区域
        # 找一个简单方法：查找所有引号包裹的中文字符串
        
        # 匹配三种引号：双引号、单引号、反引号
        # 策略：逐字符扫描，记录所有字符串字面量
        matches = []
        i = 0
        while i < len(line):
            ch = line[i]
            if ch in ('"', "'", '`'):
                quote = ch
                # 查找字符串结束位置
                j = i + 1
                escaped = False
                while j < len(line):
                    if escaped:
                        escaped = False
                        j += 1
                        continue
                    if line[j] == '\\':
                        escaped = True
                        j += 1
                        continue
                    if line[j] == quote:
                        break
                    j += 1
                
                if j < len(line) and line[j] == quote:
                    content = line[i+1:j]
                    # 检查是否包含中文
                    if re.search(r'[\u4e00-\u9fff]', content):
                        # 检查是否已经在 App._t() 调用中
                        # 向前查找最近的非空白字符
                        before = line[max(0, i-30):i].rstrip()
                        if not re.search(r'App\._t\s*\(\s*$', before) and not re.search(r'App\._tF\s*\(\s*$', before):
                            # 还要检查是否在 App._t() 的第二个参数位置
                            # 这里简化处理：只要前面没有 App._t/App._tF 就行
                            matches.append((content, quote, i, j))
                    i = j
                else:
                    i = j  # 未闭合的字符串，跳过
            i += 1
        
        if matches:
            results[idx] = matches
    
    return results, lines


def extract_unique_strings(js_dir):
    """扫描所有 JS 文件，提取唯一的含中文字符串"""
    all_strings = OrderedDict()  # text -> list of (file, line_idx, quote)
    
    for js_file in sorted(js_dir.glob("*.js")):
        # 跳过 i18n 文件本身
        if 'i18n' in js_file.name:
            continue
        try:
            matches, lines = find_chinese_strings_in_file(js_file)
            for line_idx, mlist in matches.items():
                for content, quote, col_start, col_end in mlist:
                    if content not in all_strings:
                        all_strings[content] = []
                    all_strings[content].append((str(js_file), line_idx, quote, col_start, col_end))
        except Exception as e:
            print(f"  ⚠️ 无法读取 {js_file.name}: {e}")
    
    return all_strings


def generate_en_translation(chinese):
    """为中文文本生成英文翻译"""
    # 先查预定义映射
    if chinese in TRANSLATIONS:
        return TRANSLATIONS[chinese]
    
    # 模糊匹配（前缀/后缀）
    for cn, en in TRANSLATIONS.items():
        if chinese.startswith(cn) or chinese.endswith(cn):
            if len(cn) > 1:
                return en
    
    # 无法翻译的返回空，后续手动处理
    return None


def generate_key(chinese_text):
    """为中文文本生成 i18n key"""
    # 先查预定义映射
    predefined = chinese_to_key(chinese_text)
    if predefined:
        return predefined
    
    # 通用前缀策略
    prefixes = [
        ("新建", "new_"), ("编辑", "edit_"), ("删除", "delete_"),
        ("创建", "create_"), ("导入", "import_"), ("导出", "export_"),
        ("添加", "add_"), ("移除", "remove_"), ("选择", "select_"),
        ("搜索", "search_"), ("上传", "upload_"), ("下载", "download_"),
        ("复制", "copy_"), ("粘贴", "paste_"), ("保存", "save_"),
        ("取消", "cancel_"), ("确认", "confirm_"), ("关闭", "close_"),
        ("打开", "open_"), ("切换", "toggle_"), ("刷新", "refresh_"),
        ("加载", "load_"), ("清空", "clear_"), ("恢复", "restore_"),
        ("查看", "view_"), ("预览", "preview_"), ("设置", "settings_"),
        ("配置", "config_"), ("统计", "stats_"), ("监测", "monitor_"),
        ("管理", "manage_"), ("当前", "current_"), ("默认", "default_"),
        ("自定义", "custom_"), ("正在", "ing_"), ("暂无", "no_"),
        ("已选", "selected_"), ("请先", "please_"), ("请输入", "enter_"),
        ("请选择", "select_"),
    ]
    
    for prefix, en_prefix in prefixes:
        if chinese_text.startswith(prefix):
            suffix = chinese_text[len(prefix):]
            # 用拼音简化
            suffix_en = suffix.replace(" ", "_").lower()
            # 简单处理：去除标点
            result = en_prefix + "".join(c if c.isalpha() else '_' for c in suffix_en)[:20]
            return f"custom.{result}" if not result else f"auto.{result}"
    
    # 兜底：用文本长度+hash
    import hashlib
    h = hashlib.md5(chinese_text.encode()).hexdigest()[:8]
    return f"auto.str_{h}"


def replace_in_file(filepath, replacements):
    """在 JS 文件中执行替换，每个 replacement 是 (line_idx, col_start, col_end, quote, old_str, new_str)"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        lines = content.split('\n')
    
    # 按位置从后往前替换，避免偏移问题
    replacements.sort(key=lambda x: (x[0], x[1]), reverse=True)
    
    for line_idx, col_start, col_end, quote, old_str, new_str in replacements:
        line = lines[line_idx]
        # 验证原始内容
        before = line[col_start:col_end+1]
        expected = quote + old_str + quote
        if before != expected:
            print(f"  ⚠️ 位置不匹配行{line_idx+1}: expected={repr(expected)} got={repr(before)}")
            continue
        # 替换
        lines[line_idx] = line[:col_start] + new_str + line[col_end+1:]
    
    # 写回
    new_content = '\n'.join(lines)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)


def main():
    print("=" * 60)
    print("PromptKit i18n 批量迁移工具")
    print("=" * 60)
    
    # 第1步：扫描所有中文字符串
    print("\n[1/4] 扫描 JS 文件中的中文字符串...")
    all_strings = extract_unique_strings(JS_DIR)
    print(f"  找到 {len(all_strings)} 个唯一中文字符串")
    
    # 打印统计
    file_counts = {}
    for text, occurrences in all_strings.items():
        for occ in occurrences:
            fname = os.path.basename(occ[0])
            file_counts[fname] = file_counts.get(fname, 0) + 1
    
    print(f"  涉及文件: {len(file_counts)} 个")
    for fname, cnt in sorted(file_counts.items(), key=lambda x: -x[1])[:15]:
        print(f"    {fname}: {cnt} 处")
    
    # 第2步：生成 key 和翻译
    print("\n[2/4] 生成 i18n key 和英文翻译...")
    i18n_map = OrderedDict()
    untranslated = []
    
    for text in all_strings:
        key = generate_key(text)
        en = generate_en_translation(text)
        if en:
            i18n_map[key] = (text, en)
        else:
            untranslated.append((key, text))
    
    print(f"  已翻译: {len(i18n_map)} 条")
    print(f"  未翻译: {len(untranslated)} 条")
    if untranslated:
        print("  未翻译的字符串（需手动处理，详见 untranslated.json）:")
        for key, text in untranslated[:5]:
            try:
                print(f"    [{key}] {text}")
            except UnicodeEncodeError:
                print(f"    [{key}] <emoji in text>")
        if len(untranslated) > 5:
            print(f"    ... 还有 {len(untranslated)-5} 条")
    
    # 第3步：执行替换
    print("\n[3/4] 执行源码替换...")
    total_replaced = 0
    
    # 构建 per-file 替换列表
    file_replacements = {}
    for text, occurrences in all_strings.items():
        key = generate_key(text)
        if key not in i18n_map:
            continue  # 跳过未翻译的
        
        # 构建替换表达式
        new_expr = f"App._t('{key}','{text}')"
        
        for filepath, line_idx, quote, col_start, col_end in occurrences:
            if filepath not in file_replacements:
                file_replacements[filepath] = []
            file_replacements[filepath].append((line_idx, col_start, col_end, quote, text, new_expr))
    
    for filepath, replacements in file_replacements.items():
        fname = os.path.basename(filepath)
        # 去重：同一行的相同位置只替换一次
        seen = set()
        unique_repl = []
        for r in replacements:
            key = (r[0], r[1], r[4])
            if key not in seen:
                seen.add(key)
                unique_repl.append(r)
        
        replace_in_file(filepath, unique_repl)
        print(f"  {fname}: {len(unique_repl)} 处替换")
        total_replaced += len(unique_repl)
    
    print(f"\n  总计替换: {total_replaced} 处")
    
    # 第4步：合并 en.json
    print("\n[4/4] 合并生成 en.json...")
    
    # 读取原有 en.json
    if EN_JSON.exists():
        with open(EN_JSON, 'r', encoding='utf-8') as f:
            existing = json.load(f, object_pairs_hook=OrderedDict)
    else:
        existing = OrderedDict()
    
    # 合并新翻译
    new_entries = OrderedDict()
    for key, (cn, en) in i18n_map.items():
        if key not in existing:
            new_entries[key] = en
    
    # 合并
    merged = OrderedDict()
    merged.update(existing)
    merged.update(new_entries)
    
    # 写入
    with open(EN_JSON, 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    
    print(f"  原有条目: {len(existing)}")
    print(f"  新增条目: {len(new_entries)}")
    print(f"  合并后: {len(merged)} 条")
    
    # 写出未翻译列表供人工处理
    untranslated_file = I18N_DIR / "untranslated.json"
    with open(untranslated_file, 'w', encoding='utf-8') as f:
        unt_list = [{"key": k, "chinese": t} for k, t in untranslated]
        json.dump(unt_list, f, ensure_ascii=False, indent=2)
    print(f"\n  未翻译列表已写入: {untranslated_file}")
    
    print("\n✅ 完成！")


if __name__ == '__main__':
    main()
