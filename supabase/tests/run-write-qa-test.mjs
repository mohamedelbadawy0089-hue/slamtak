// Write QA test
import { createClient } from '@supabase/supabase-js';

async function testWriteQA() {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  // Test write operations
}

testWriteQA();