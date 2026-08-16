# -*- coding: utf-8 -*-
"""一键启动（自动探测 Python 路径，PowerShell 版本）"""
$ErrorActionPreference = "Stop"
$py = "C:\Users\admin\AppData\Local\Python\bin\python.exe"
if (-not (Test-Path $py)) {
    $cand = Get-Command python -ErrorAction SilentlyContinue
    if ($cand) { $py = $cand.Source } else { Write-Error "未找到 Python"; exit 1 }
}
Write-Host "[需求分析] 启动需求分析 → http://127.0.0.1:8085 （独立服务，零外网/零抓取/零定时）"
& $py "$PSScriptRoot\main.py"
