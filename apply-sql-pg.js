const { Client } = require('pg');

// ⚠️  NEEDS: Database Password (not JWT!)
// Found in: Supabase Dashboard → Project Settings → Database → Connection String

const DB_PASSWORD = process.env.DB_PASSWORD || 'Hcfs7oNWmlrak6nW';

const client = new Client({
    host: 'aws-0-us-east-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'iksjhjxwphmvthryfeae',
    password: DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

const sql = `
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS quantity_type VARCHAR(20) DEFAULT 'decreasing';

UPDATE products 
SET quantity_type = 'decreasing' 
WHERE quantity_type IS NULL;

SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns 
WHERE table_name = 'products';
`;

async function run() {
    if (DB_PASSWORD === 'YOUR_DB_PASSWORD_HERE') {
        console.log('❌ Error: Need database password!\n');
        console.log('Get it from:');
        console.log('https://supabase.com/dashboard/project/iksjhjxwphmvthryfeae/settings/database');
        console.log('\nThen either:');
        console.log('1. Set env: set DB_PASSWORD=your_password (Windows)');
        console.log('2. Or edit this file and replace YOUR_DB_PASSWORD_HERE\n');
        process.exit(1);
    }
    
    try {
        console.log('Connecting to PostgreSQL...');
        await client.connect();
        console.log('✅ Connected!\n');
        
        console.log('Executing SQL...\n');
        const result = await client.query(sql);
        
        console.log('✅ SUCCESS! Column added.\n');
        console.log('Result:', result.rows);
        
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

run();
