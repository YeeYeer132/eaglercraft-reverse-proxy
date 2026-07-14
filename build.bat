@echo off
echo Compiling TypeScript...
echo.
call npx tsc
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [Success] Build complete!
    echo.
) else (
    echo.
    echo [Error] Build failed!
    echo.
)
pause