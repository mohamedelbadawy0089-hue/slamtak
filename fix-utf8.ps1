# Fix UTF-8 Encoding for all files
# This script converts all JS and HTML files to UTF-8

Write-Host "Starting UTF-8 conversion..." -ForegroundColor Green

# AI JavaScript files
$aiFiles = @(
    "ai-core.js",
    "ai-validation.js",
    "ai-speech.js",
    "ai-database.js",
    "ai-ui.js",
    "ai-assistant.js"
)

Write-Host "`nConverting AI JavaScript files..." -ForegroundColor Yellow
foreach ($file in $aiFiles) {
    if (Test-Path $file) {
        try {
            $content = Get-Content $file -Raw -Encoding UTF8
            $utf8 = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText((Resolve-Path $file), $content, $utf8)
            Write-Host "  OK: $file" -ForegroundColor Green
        } catch {
            Write-Host "  ERROR: $file - $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

# HTML files
$htmlFiles = @(
    "login.html",
    "register.html",
    "warehouse.html",
    "home.html",
    "products.html",
    "add-product.html",
    "bulk-add.html",
    "limited-products.html",
    "expiring-products.html",
    "pharmacies.html",
    "pharmacy-profile.html",
    "orders.html",
    "create-order.html",
    "admin-dashboard.html",
    "admin-profile.html",
    "employees.html",
    "delivery.html",
    "telesales.html",
    "telesales-file.html"
)

Write-Host "`nConverting HTML files..." -ForegroundColor Yellow
foreach ($file in $htmlFiles) {
    if (Test-Path $file) {
        try {
            $content = Get-Content $file -Raw -Encoding UTF8
            $utf8 = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText((Resolve-Path $file), $content, $utf8)
            Write-Host "  OK: $file" -ForegroundColor Green
        } catch {
            Write-Host "  ERROR: $file - $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

Write-Host "`nConversion completed!" -ForegroundColor Green
Write-Host "Please test the files in your browser." -ForegroundColor Cyan
