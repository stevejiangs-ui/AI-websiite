@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==== 个人APP（WorkBuddy 版）：构建并同步 ====
bash sync.sh
echo.
pause
