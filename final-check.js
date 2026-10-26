const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\My PC\\Desktop\\slamtak';
const matches = [];

function walk(d) {
    for (const f of fs.readdirSync(d)) {
        const full = path.join(d, f);
        if (fs.statSync(full).isDirectory() && f !== 'libs' && !f.startsWith('.kilo')) {
            walk(full);
        } else if (f.endsWith('.html')) {
            const c = fs.readFileSync(full, 'utf8');
            const m = c.match(/https?:\/\/(?:cdn\.|unpkg\.|cdnjs\.cloudflare\.|fonts\.googleapis\.|fonts\.gstatic\.|cdn\.jsdelivr\.)[^\s"'<>]+/g);
            if (m) {
                matches.push({ file: path.relative(dir, full), count: m.length });
            }
        }
    }
}

walk(dir);
console.log('Files with CDN refs in main project:', matches.length);
if (matches.length > 0) {
    console.log('Remaining files:');
    matches.forEach(x => console.log('  ' + x.file + ' (' + x.count + ' refs)'));
} else {
    console.log('All CDN references removed from main project!');
}
