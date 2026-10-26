[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   تشغيل خادم محلي لـ slamtak" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

Write-Host "جاري تشغيل الخادم على http://localhost:8080" -ForegroundColor Green
Write-Host "اضغط Ctrl+C للإيقاف" -ForegroundColor Yellow
Write-Host ""

try {
    python -m http.server 8080
} catch {
    Write-Host "Python غير متاح، جاري المحاولة بـ Node.js..." -ForegroundColor Yellow
    npx http-server -p 8080
}

Read-Host "اضغط Enter للخروج"
