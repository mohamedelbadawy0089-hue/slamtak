const { Client } = require('pg');

async function run() {
  console.log('Connecting to Supabase pooler with tenant username postgres.iksjhjxwphmvthryfeae...');
  
  const client = new Client({
    host: 'aws-0-eu-central-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.iksjhjxwphmvthryfeae',
    password: 'G8I87Fazezstvl18',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Success! Connected to Supabase pooler.');
    
    // Add sales_discount column to warehouse_custom_products table
    console.log('Altering warehouse_custom_products...');
    await client.query("ALTER TABLE public.warehouse_custom_products ADD COLUMN IF NOT EXISTS sales_discount DECIMAL(5, 2) DEFAULT 0;");
    console.log('✅ Successfully added sales_discount column!');
    
    await client.end();
  } catch (err) {
    console.error('❌ Failed:', err.message);
  }
}

run();
