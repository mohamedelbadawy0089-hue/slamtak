const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://raw.githubusercontent.com/karem505/egyptian-drug-database/main/data/egyptian-drugs.json';
const targetPath = path.join(__dirname, 'data', 'egyptian-master-database-massive.json');

console.log('Downloading massive drug database...');

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        try {
            const drugs = JSON.parse(data);
            // Clean data: keep only real ones, format fields
            const cleanedDrugs = drugs.map(d => ({
                tradeName: d.commercial_name_en,
                scientificName: d.scientific_name,
                company: d.manufacturer,
                price: d.price_egp,
                type: 'master'
            })).filter(d => d.tradeName && d.scientificName);

            fs.writeFileSync(targetPath, JSON.stringify({ drugs: cleanedDrugs }, null, 2));
            console.log(`Success! Saved ${cleanedDrugs.length} drugs to ${targetPath}`);
        } catch (e) {
            console.error('Error parsing JSON:', e.message);
        }
    });
}).on('error', (err) => {
    console.error('Error downloading:', err.message);
});
