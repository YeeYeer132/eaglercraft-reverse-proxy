@echo off
title Eaglercraft Reverse Proxy - Build and Run
echo ==================================================
echo   Eaglercraft Reverse Proxy
echo   Build and Run
echo ==================================================
echo.
echo [1/2] Compiling TypeScript...
echo.
call npx tsc
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [Success] Build complete!
    echo.
    echo [2/2] Starting reverse proxy...
    echo.
    node build\reverse_proxy\index.js
) else (
    echo.
    echo [Error] Build failed! Please check the code.
    echo.
    pause
)