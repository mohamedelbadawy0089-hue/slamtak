const fs = require('fs');
const path = require('path');

const rawPath = path.join(__dirname, '..', 'data', 'raw-drugs.json');
const targetPath = path.join(__dirname, '..', 'data', 'egyptian-master-database-massive.json');
const sqlPath = path.join(__dirname, '..', 'data', 'import_master_products.sql');

try {
    const rawData = fs.readFileSync(rawPath, 'utf8');
    const drugs = JSON.parse(rawData);

    // Filter and map to our internal format
    const cleanedDrugs = drugs.map(d => ({
        tradeName: d.commercial_name_en,
        scientificName: d.scientific_name,
        company: d.manufacturer,
        price: d.price_egp,
        category: d.drug_class || 'General'
    })).filter(d => d.tradeName && d.tradeName.trim().length > 0);

    // Remove duplicates based on name
    const uniqueMap = new Map();
    cleanedDrugs.forEach(d => {
        if (!uniqueMap.has(d.tradeName)) {
            uniqueMap.set(d.tradeName, d);
        }
    });

    const finalDrugs = Array.from(uniqueMap.values());

    fs.writeFileSync(targetPath, JSON.stringify({ drugs: finalDrugs }, null, 2));
    console.log(`Success! Processed ${finalDrugs.length} unique drugs.`);

    // Also generate a SQL file for Supabase
    let sql = 'DELETE FROM master_products;\n';
    
    // Batch inserts to avoid large single statements
    const batchSize = 500;
    for (let i = 0; i < finalDrugs.length; i += batchSize) {
        const batch = finalDrugs.slice(i, i + batchSize);
        sql += 'INSERT INTO master_products (name_en, active_ingredient, manufacturer, base_price_egp) VALUES\n';
        sql += batch.map(d => `('${d.tradeName.replace(/'/g, "''")}', '${(d.scientificName || '').replace(/'/g, "''")}', '${(d.company || '').replace(/'/g, "''")}', ${d.price || 0})`).join(',\n') + ';\n\n';
    }

    fs.writeFileSync(sqlPath, sql);
    console.log(`SQL import script generated at: ${sqlPath}`);

} catch (e) {
    console.error('Error processing JSON:', e.message);
}
