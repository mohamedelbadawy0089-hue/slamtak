// Database gateway test
import { createClient } from '@supabase/supabase-js';

async function testGateway() {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data, error } = await client.from('test_table').select('*');
  console.log('Test result:', data, error);
}

testGateway();