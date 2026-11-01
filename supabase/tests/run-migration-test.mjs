// Migration test
import { createClient } from '@supabase/supabase-js';

async function testMigration() {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  // Test migration
}

testMigration();