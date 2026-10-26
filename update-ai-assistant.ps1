# سكريبت إضافة المساعد الذكي لجميع الصفحات

$aiScripts = @"
    <!-- المساعد الذكي المتكامل -->
    <script src="ai-core.js"></script>
    <script src="ai-validation.js"></script>
    <script src="ai-speech.js"></script>
    <script src="ai-database.js"></script>
    <script src="ai-ui.js"></script>
    <script src="ai-assistant.js"></script>
"@

$files = @(
    "register.html",
    "products.html",
    "pharmacies.html",
    "analytics.html",
    "delivery.html",
    "add-product.html",
    "bulk-add.html",
    "create-order.html",
    "admin-dashboard.html",
    "telesales.html",
    "warehouse.html",
    "telesales-file.html",
    "pharmacy-profile.html",
    "limited-products.html",
    "expiring-products.html",
    "admin-profile.html",
    "employees.html"
)

foreach ($file in $files) {
    $path = "c:\Users\My PC\Documents\slamtak\$file"
    
    if (Test-Path $path) {
        $content = Get-Content $path -Raw -Encoding UTF8
        
        # إزالة ai-assistant.js القديم إن وجد
        $content = $content -replace '<script src="ai-assistant\.js"></script>', ''
        $content = $content -replace '<script src="ai-assistant\.js></script>', ''
        
        # إزالة voice-search.js إن وجد (سيتم دمجه لاحقاً)
        # $content = $content -replace '<script src="voice-search\.js"></script>', ''
        
        # إضافة السكريبتات الجديدة قبل </body>
        if ($content -match '</body>') {
            $content = $content -replace '</body>', "$aiScripts`n</body>"
            
            # حفظ الملف
            [System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::UTF8)
            Write-Host "✅ تم تحديث: $file" -ForegroundColor Green
        } else {
            Write-Host "⚠️ لم يتم العثور على </body> في: $file" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ الملف غير موجود: $file" -ForegroundColor Red
    }
}

Write-Host "`n✅ اكتمل التحديث!" -ForegroundColor Green
