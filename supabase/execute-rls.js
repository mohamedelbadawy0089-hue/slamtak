// Execute RLS queries
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

async function executeRLS(query) {
  const client = createClient(config.url, config.anonKey);
  const { data, error } = await client.rpc('exec_rls', { query_json: query });
  return { data, error };
}

module.exports = { executeRLS };