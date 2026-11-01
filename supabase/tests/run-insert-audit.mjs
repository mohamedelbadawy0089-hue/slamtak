// Insert audit test
import { createClient } from '@supabase/supabase-js';

async function testInsertAudit() {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  // Test audit logging
}

testInsertAudit();