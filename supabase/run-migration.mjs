// Run migration
import { createClient } from '@supabase/supabase-js';
import config from './config.js';

async function runMigration() {
  const client = createClient(config.url, config.serviceRoleKey);
  // Migration logic
}

runMigration();