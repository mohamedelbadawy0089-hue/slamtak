const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\My PC\\Desktop\\slamtak';
const files = [
    'A.html',
    'add-product-compact.html',
    'add-product-complete.html',
    'add-product-v10.html',
    'dashboard-main.html',
    'employees.html',
    'general-directory.html',
    'index.html',
    'orders.html',
    'purchase-invoice-enhanced.html',
    'purchase-invoice-final.html',
    'register-warehouse-performance.html',
    'register-warehouse-ultra.html',
    'register-warehouse.html',
    'sales.html',
    'store.html',
    'voice-review-before-commit.html',
    'warehouse.html'
];

files.forEach(f => {
    const full = path.join(dir, f);
    if (fs.existsSync(full)) {
        const c = fs.readFileSync(full, 'utf8');
        const m = c.match(/https?:\/\/(?:cdn\.|unpkg\.|cdnjs\.cloudflare\.|fonts\.googleapis\.|fonts\.gstatic\.|cdn\.jsdelivr\.)[^\s"'<>]+/g);
        if (m) {
            console.log('\n' + f + ':');
            m.forEach(url => console.log('  ' + url));
        }
    }
});
