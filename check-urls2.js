const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\My PC\\Desktop\\slamtak';
const files = [
    'A.html',
    'add-product-compact.html',
    'add-product-complete.html',
    'add-product-v10.html',
    'register-warehouse-performance.html',
    'register-warehouse-ultra.html',
    'register-warehouse.html',
    'voice-review-before-commit.html'
];

files.forEach(f => {
    const c = fs.readFileSync(path.join(dir, f), 'utf8');
    const matches = c.match(/https?:\/\/[^\s"'<>]+/g);
    if (matches) {
        console.log('\n' + f + ':');
        matches.forEach(url => {
            if (url.includes('cdn') || url.includes('fonts')) {
                console.log('  ' + url);
            }
        });
    }
});
