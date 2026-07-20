@echo off
chcp 65001 >nul
title 公园环境监测系统 — 公网版

echo.
echo ╔══════════════════════════════════════════════╗
echo ║  城市公园环境监测系统                      ║
echo ║  后端 + ngrok → 任何人任何网络都能打开     ║
echo ╚══════════════════════════════════════════════╝
echo.

:: ============ 第一步：启动后端 ============
echo [1/2] 启动后端服务器...
cd /d "C:\final_work\backend"
start "Backend" cmd /k "node server.js --sim"

:: 等后端启动
timeout /t 4 /nobreak >nul

:: ============ 第二步：启动 ngrok ============
echo.
echo [2/2] 启动 ngrok 内网穿透...
echo.
echo   ████████████████████████████████████████
echo   ██  看下面的 Forwarding 那一行      ██
echo   ██  https://xxxx.ngrok-free.app    ██
echo   ██  这个就是公网地址，发给任何人    ██
echo   ████████████████████████████████████████
echo.
echo   按 Ctrl+C 停止所有服务
echo.

ngrok http 3000

pause
