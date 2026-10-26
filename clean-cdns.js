const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\My PC\\Desktop\\slamtak';

function walk(d) {
    const results = [];
    const items = fs.readdirSync(d);
    for (const item of items) {
        const full = path.join(d, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory() && item !== 'libs' && !item.startsWith('.kilo')) {
            results.push(...walk(full));
        } else if (stat.isFile() && item.endsWith('.html')) {
            results.push(full);
        }
    }
    return results;
}

const files = walk(dir);
let updated = 0;

files.forEach(filePath => {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let changed = false;

        // Remove preconnect links to external CDNs
        content = content.replace(/<link rel="preconnect" href="https?:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.sheetjs\.com)[^"]*"[^>]*>\s*/gi, '');
        content = content.replace(/<link rel="preconnect" href="https?:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.sheetjs\.com)[^"]*" crossorigin[^>]*>\s*/gi, '');

        // Remove dns-prefetch links to external CDNs
        content = content.replace(/<link rel="dns-prefetch" href="https?:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.sheetjs\.com)[^"]*"[^>]*>\s*/gi, '');

        // Remove preload links to non-existent local files
        content = content.replace(/<link rel="preload" href="(?:non-critical\.css|voice-input\.js|bundle\.js|supabase-singleton\.js)"[^>]*>\s*/gi, '');

        // Update CSP to allow local fonts instead of CDN fonts
        content = content.replace(/font-src https?:\/\/cdnjs\.cloudflare\.com;?/g, "font-src 'self' data:");
        content = content.replace(/style-src https?:\/\/cdnjs\.cloudflare\.com;?/g, "style-src 'self' 'unsafe-inline'");

        if (content !== fs.readFileSync(filePath, 'utf8')) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Cleaned:', path.relative(dir, filePath));
            updated++;
        }
    } catch (e) {
        console.error('Error cleaning', filePath, e.message);
    }
});

console.log(`\nDone. Cleaned ${updated} files.`);
