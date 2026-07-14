@echo off
chcp 65001 >nul
title Eaglercraft Reverse Proxy - 编译并启动
echo ==================================================
echo   Eaglercraft Reverse Proxy
echo   编译并启动
echo ==================================================
echo.
echo [1/2] 正在编译 TypeScript...
echo.
call npx tsc
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [成功] 编译完成！
    echo.
    echo [2/2] 正在启动反向代理...
    echo.
    node build\reverse_proxy\index.js
) else (
    echo.
    echo [错误] 编译失败！请检查代码。
    echo.
    pause
)