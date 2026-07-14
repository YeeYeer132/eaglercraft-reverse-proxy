@echo off
chcp 65001 >nul
echo 正在编译 TypeScript...
echo.
call npx tsc
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [成功] 编译完成！
    echo.
) else (
    echo.
    echo [错误] 编译失败！
    echo.
)
pause