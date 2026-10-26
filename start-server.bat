@echo off
chcp 65001 >nul
echo ==========================================
echo    تشغيل خادم محلي لـ slamtak
echo ==========================================
echo.

cd /d "%~dp0"

echo جاري تشغيل الخادم على http://localhost:8080
echo اضغط Ctrl+C للإيقاف
echo.

python -m http.server 8080
if errorlevel 1 (
    echo Python غير متاح، جاري المحاولة بـ Node.js...
    npx http-server -p 8080
)

pause
