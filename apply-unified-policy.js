const { Client } = require('pg');

const DB_PASSWORD = process.env.DB_PASSWORD || 'Hcfs7oNWmlrak6nW';

const client = new Client({
    connectionString: 'postgresql://postgres:G8I87Fazezstvl18@db.iksjhjxwphmvthryfeae.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

const sql = `
DROP POLICY IF EXISTS "Unified flexible warehouse products policy" ON warehouse_products_flexible;

CREATE POLICY "Unified flexible warehouse products policy"
ON warehouse_products_flexible
FOR ALL
USING (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
)
WITH CHECK (
    warehouse_id IN (
        SELECT id FROM warehouses WHERE user_id = auth.uid()
    )
);

-- Ensure RLS is enabled on the table
ALTER TABLE warehouse_products_flexible ENABLE ROW LEVEL SECURITY;
`;

async function run() {
    try {
        console.log('Connecting to PostgreSQL...');
        // Note: Supabase pooler requires the username in format `user.pooler` sometimes, 
        // but looking at apply-sql-pg.js it just used `iksjhjxwphmvthryfeae`. 
        // Let's use the one from apply-sql-pg.js
        await client.connect();
        console.log('✅ Connected!\n');
        
        console.log('Executing SQL for Unified flexible warehouse products policy...\n');
        const result = await client.query(sql);
        
        console.log('✅ SUCCESS! Unified Policy created.\n');
        
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

run();
