// Run SQL test
import { createClient } from '@supabase/supabase-js';

async function runSQLTest() {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
runSQLTest();