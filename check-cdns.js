const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\My PC\\Desktop\\slamtak';
const matches = [];

function walk(d) {
    for (const f of fs.readdirSync(d)) {
        const full = path.join(d, f);
        if (fs.statSync(full).isDirectory() && f !== 'libs') {
            walk(full);
        } else if (f.endsWith('.html')) {
            const c = fs.readFileSync(full, 'utf8');
            const m = c.match(/https?:\/\/(?:cdn\.|unpkg\.|cdnjs\.cloudflare\.|fonts\.googleapis\.|fonts\.gstatic\.|cdn\.jsdelivr\.)[^\s"'<>]+/g);
            if (m) {
                matches.push({ file: path.relative(dir, full), count: m.length, matches: m.slice(0, 5) });
            }
        }
    }
}

walk(dir);
console.log('Files with CDN refs:', matches.length);
matches.slice(0, 20).forEach(x => {
    console.log('\n' + x.file + ' (' + x.count + ' matches)');
    x.matches.forEach(m => console.log('  ' + m));
});
