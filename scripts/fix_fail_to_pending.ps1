# PromptKit 前端 JS 批量修复：'失败' → '未完成'

$jsDir = "C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\static\js"
$logFile = "C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\logs\_fail_fix_report.txt"

# 映射表：'失败' → '未完成（具体上下文）'
$replacements = @{
    # UI Toast/提示信息中的用户可见文案全部替换为 '未完成，稍后再试'等对应短语
    "操作失败","创建失败","保存失败","删除失败","加载失败"        @{"prefix": "' 未完成，稍后再试"} 
    "上传失败","下载失败","导出失败","导入失败"                    @{"suffix": "", "msg_prefix": 'upload_'} # 已在代码中处理
    "网络连接失败","网络错误",                                      @{"message_suffix": ": ", "network_msg": ''}
    "未知错误","回滚失败","还原失败","生成失败","关联失败"        @{"fallback_msg": ""} 
    "移除失败","更新失败","请求失败","翻译失败","匹配失败"        @{"error_prefix":"未能"}
    "解析失败","预览失败","渲染失败","获取失败",                   # 特殊处理（见注释）
    "添加收藏失败","移除收藏失败","查询失败","注册失败",          @{"msg_suffix": ",请稍后再试"} 
    "激活失败","认证失败","连接失败"                               # L102 signal_lights.js
    "获取备份失败","获取文件失败","写入失败",                      # 已有部分处理
    "选择目录失败","取消失败",                                      @{"suffix":"暂未"}  
    "审核失败","合成失败","名失败（如重命名失败->）"               @{msg_suffix=",请稍后再试"}, 
    "归档失败","拆解失败","建议失败","应用失败",                   # 特殊规则
    "开公共库失败","继承失败","查重失败","获取数据",               @{"data_msg": "", fallback: "未完成"}  
    "模板渲染失败","优化失败","组装失败","取失败（如加位置）"      # 兜底替换    
}

# 遍历所有 JS 文件
$files = Get-ChildItem -Path $jsDir -Filter "*.js" | Where-Object { $_.Length -gt 0 }

$reportHeader = @"  
===================================================================================  
PromptKit 前端 JS 负向化文案批量修复报告：'失败' → '未完成'  
工作目录：`$jsDir  
开始时间：$(Get-Date)  
===================================================================================  
"@
Set-Content $logFile -Value $reportHeader

$totalChangedFiles = @() 
$totalReplacementsCount = 0 

foreach ($file in $files) {
    try {
        # 读取文件内容（分块避免内存问题）
        $contentParts, totalChars = Get-Content (Get-Item $file).FullName -Encoding UTF8
        
        $originalContent = [string]::Join('', $contentParts) 
        if ($null -eq $totalReplacementsCount) {
            # 初始化计数器
            Write-Host "正在处理:`$($file.Name)" -ForegroundColor Green 
        }

        # PowerShell 正则替换核心：查找所有"失败"出现的位置（排除变量名）  
        
        # === 特殊规则 1: alert(...)或 toast/toast() 中用户可见的提示信息 ===
        $content = [regex]::Replace($originalContent, '`n', '') -replace "\'\s*操作 (?:失败|成功)", "''" 
        Write-Host "$("$file.Name") : $(Select-String -Input \$contentPattern '"\S+ 未完成，稍后再试'`",count)处替换
        
    } catch {
        