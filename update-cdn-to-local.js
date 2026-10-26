const fs = require('fs');
const path = require('path');

const projectDir = 'C:\\Users\\My PC\\Desktop\\slamtak';
const libsDir = path.join(projectDir, 'libs');

const replacements = [
    { from: /https?:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\/?/g, to: 'libs/supabase.min.js' },
    { from: /https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.4\.0\/css\/all\.min\.css/g, to: 'libs/font-awesome.min.css' },
    { from: /https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/inputmask\/5\.0\.8\/inputmask\.min\.js/g, to: 'libs/inputmask.min.js' },
    { from: /https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pako\/2\.1\.0\/pako\.min\.js/g, to: 'libs/pako.min.js' },
    { from: /https?:\/\/unpkg\.com\/dexie@3\.2\.4\/dist\/dexie\.js/g, to: 'libs/dexie.js' },
    { from: /https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/0\.18\.5\/xlsx\.full\.min\.js/g, to: 'libs/xlsx.full.min.js' },
    { from: /https?:\/\/cdn\.sheetjs\.com\/xlsx-0\.20\.0\/package\/dist\/xlsx\.full\.min\.js/g, to: 'libs/xlsx.full.min.js' },
    { from: /https?:\/\/cdn\.jsdelivr\.net\/npm\/ag-grid-community@31\.0\.0\/dist\/ag-grid-community\.min\.js/g, to: 'libs/ag-grid-community.min.js' },
    { from: /https?:\/\/cdn\.jsdelivr\.net\/npm\/ag-grid-community@31\.0\.0\/styles\/ag-grid\.css/g, to: 'libs/ag-grid.css' },
    { from: /https?:\/\/cdn\.jsdelivr\.net\/npm\/ag-grid-community@31\.0\.0\/styles\/ag-theme-alpine\.css/g, to: 'libs/ag-theme-alpine.css' },
    { from: /https?:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js\/?/g, to: 'libs/chart.min.js' },
    { from: /https?:\/\/cdn\.jsdelivr\.net\/npm\/fuse\.js@7\.0\.0\/dist\/fuse\.min\.js/g, to: 'libs/fuse.min.js' },
    { from: /https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/html2pdf\.js\/0\.10\.1\/html2pdf\.bundle\.min\.js/g, to: 'libs/html2pdf.bundle.min.js' },
    { from: /https?:\/\/cdn\.jsdelivr\.net\/npm\/clusterize\.js@0\.3\.1\/clusterize\.min\.js/g, to: 'libs/clusterize.min.js' },
    { from: /https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.0\.0\/css\/all\.min\.css/g, to: 'libs/font-awesome-6.0.0.min.css' },
    { from: /https?:\/\/cdn\.jsdelivr\.net\/npm\/clusterize\.js@[^"']+\/clusterize\.min\.js/g, to: 'libs/clusterize.min.js' },
    { from: /https?:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\/?/g, to: 'libs/supabase.min.js' },
    { from: /https?:\/\/unpkg\.com\/@supabase\/supabase-js@2\/?/g, to: 'libs/supabase.min.js' },
    { from: /https?:\/\/fonts\.googleapis\.com\/css2\?family=Cairo:[^"']*/g, to: 'libs/cairo.css' },
    { from: /https?:\/\/fonts\.googleapis\.com\/css2\?family=Tajawal:[^"']*/g, to: 'libs/tajawal.css' },
    { from: /https?:\/\/fonts\.gstatic\.com\/css\?family=Cairo:[^"']*/g, to: 'libs/cairo.css' },
    { from: /https?:\/\/fonts\.gstatic\.com\/css\?family=Tajawal:[^"']*/g, to: 'libs/tajawal.css' },
];

function updateFile(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let changed = false;

        replacements.forEach(r => {
            const newContent = content.replace(r.from, r.to);
            if (newContent !== content) {
                content = newContent;
                changed = true;
            }
        });

        if (changed) {
            fs.writeFileSync(filePath, content, 'utf8');
            return true;
        }
        return false;
    } catch (e) {
        console.error('Error updating', filePath, e.message);
        return false;
    }
}

function walk(dir) {
    let results = [];
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory() && item !== 'libs') {
            results = results.concat(walk(full));
        } else if (stat.isFile() && item.endsWith('.html')) {
            results.push(full);
        }
    }
    return results;
}

const files = walk(projectDir);
let updated = 0;
files.forEach(f => {
    if (updateFile(f)) {
        console.log('Updated:', path.relative(projectDir, f));
        updated++;
    }
});
console.log(`\nDone. Updated ${updated} files.`);
