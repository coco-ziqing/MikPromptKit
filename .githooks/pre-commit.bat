@echo off
REM PromptKit 预提交钩子 — Windows 版本
REM 安装: git config core.hooksPath .githooks
python "%~dp0..\pre_commit_check.py"
exit /b %ERRORLEVEL%
