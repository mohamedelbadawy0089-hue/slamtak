const { Client } = require('pg');

const hosts = [
  'db.iksjhjxwphmvthryfeae.supabase.co',
  'db.mvthryfeae.supabase.co',
  'aws-0-eu-central-1.pooler.supabase.com', // common Supabase pooler host
];

const ports = [5432, 6543];

async function tryConnect(host, port) {
  console.log(`Trying ${host}:${port}...`);
  const client = new Client({
    host: host,
    port: port,
    user: 'postgres',
    password: 'G8I87Fazezstvl18',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log(`✅ Success! Connected to ${host}:${port}`);
    await client.query("ALTER TABLE public.warehouse_custom_products ADD COLUMN IF NOT EXISTS supplier_invoice_ref VARCHAR(100);");
    console.log('✅ ALTER TABLE executed successfully!');
    await client.end();
    return true;
  } catch (err) {
    console.log(`❌ Failed ${host}:${port} - ${err.message}`);
    try { await client.end(); } catch(e) {}
    return false;
  }
}

async function run() {
  for (const host of hosts) {
    for (const port of ports) {
      const ok = await tryConnect(host, port);
      if (ok) {
        console.log('Migration successful!');
        process.exit(0);
      }
    }
  }
  console.log('All connection attempts failed.');
  process.exit(1);
}

run();
