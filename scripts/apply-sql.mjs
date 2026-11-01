// Apply SQL migrations
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

async function applySQL() {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const migrationsDir = './supabase/migrations';
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await client.sql.execute(sql);
    console.log(`Applied: ${file}`);
  }
}

applySQL();