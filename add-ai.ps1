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

$newScripts = @'
    <script src="ai-core.js"></script>
    <script src="ai-validation.js"></script>
    <script src="ai-speech.js"></script>
    <script src="ai-database.js"></script>
    <script src="ai-ui.js"></script>
    <script src="ai-assistant.js"></script>
'@

foreach ($file in $files) {
    $path = "c:\Users\My PC\Documents\slamtak\$file"
    
    if (Test-Path $path) {
        $content = Get-Content $path -Raw -Encoding UTF8
        
        $content = $content -replace '<script src="ai-assistant\.js"></script>', ''
        $content = $content -replace '<script src="ai-assistant\.js></script>', ''
        
        if ($content -match '</body>') {
            $content = $content -replace '</body>', "$newScripts`n</body>"
            [System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::UTF8)
            Write-Host "OK: $file"
        }
    }
}

Write-Host "Done!"
