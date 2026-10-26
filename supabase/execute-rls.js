// Execute RLS Policies via Supabase REST API
// Using Service Role Key to bypass RLS

const fetch = require('node-fetch');

// Configuration
const SUPABASE_URL = 'https://iksjhjxwphmvthryfeae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Headers for Supabase API - service role key bypasses RLS
const headers = {
  'apikey': SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json'
};

async function executeSQL(sql) {
  try {
    const url = SUPABASE_URL + '/rest/v1/rpc/exec_sql';
    const body = JSON.stringify({ sql_query: sql });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body
    });
    
    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function setupRLSPolicies() {
  console.log('🔧 Executing RLS Policies via Supabase REST API...\n');
  
  const policies = [
    `create table if not exists profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      name text not null,
      role text not null default 'viewer' check (role in ('viewer', 'admin', 'super_admin', 'manager', 'warehouse_manager', 'owner')),
      created_at timestamp with time zone default now(),
      updated_at timestamp with time zone default now()
    );`,
    
    `alter table profiles enable row level security;`,
    
    `create policy "Super admins can view all profiles" on profiles
      for select to authenticated using ((select role from auth.users where auth.users.id = id) = 'super-admin');`,
    
    `create policy "Users can view own profile" on profiles
      for select to authenticated using (auth.uid() = id);`,
    
    `create policy "Users can update own profile" on profiles
      for update to authenticated using (auth.uid() = id);`,
    
    `grant all on profiles to authenticated;`,
    `grant usage on schema auth to authenticated;`
  ];

  for (let i = 0; i < policies.length; i++) {
    const policy = policies[i];
    console.log(`   Executing policy ${i + 1}/${policies.length}...`);
    
    const result = await executeSQL(policy);
    if (result.success) {
      console.log(`   ✓ Policy ${i + 1} executed (HTTP ${result.status})`);
    } else {
      console.log(`   ⚠️  Policy ${i + 1} - HTTP ${result.status} ${result.statusText}`);
    }
  }

  console.log('\n✅ RLS Policies Execution Complete!');
  console.log('The profiles table RLS policies have been processed.');
  console.log('\n📋 Next Steps:');
  console.log('1. Restart your development server: npm run dev');
  console.log('2. Test authentication: POST /api/auth/register');
  console.log('3. Test user role lookup: GET /api/auth/me');
}

setupRLSPolicies();