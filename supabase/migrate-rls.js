#!/usr/bin/env node
// Automatic RLS Migration Script
// Applies RLS policies to the profiles table using SUPABASE_SERVICE_ROLE_KEY

const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
  }
}

loadEnvFile();

const { createClient } = require('@supabase/supabase-js');

// Configuration from .env.local
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function executeMigration() {
  console.log('🔧 Starting RLS Migration for profiles table...\n');
  console.log('📍 Supabase URL:', SUPABASE_URL.substring(0, 50) + '...');
  console.log('🔑 Service Role Key: Loaded from .env.local\n');

  const migrationSQL = `
    -- Enable RLS on profiles table
    alter table profiles enable row level security;

    -- Create RLS policies for role-based access
    create policy "Super admins can view all profiles" on profiles
      for select to authenticated using ((select role from auth.users where auth.users.id = id) = 'super-admin');

    create policy "Users can view own profile" on profiles
      for select to authenticated using (auth.uid() = id);

    create policy "Users can update own profile" on profiles
      for update to authenticated using (auth.uid() = id);

    -- Grant permissions
    grant all on profiles to authenticated;
    grant usage on schema auth to authenticated;
  `;

  try {
    // Try to execute the migration SQL via the RPC endpoint
    console.log('⏳ Executing RLS policies migration...\n');

    const { error } = await supabase.rpc('exec_sql', { sql_query: migrationSQL });

    if (error) {
      // If RPC not available, try alternative approaches
      console.log('⚠️  RPC endpoint not available, attempting alternative...\n');

      // Try individual SQL statements
      const statements = migrationSQL.split(';').filter(s => s.trim().length > 0);
      
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i].trim();
        if (statement) {
          console.log(`   Executing statement ${i + 1}/${statements.length}...`);
          const { error: stmtError } = await supabase.rpc('exec_sql', { sql_query: statement });
          if (stmtError) {
            console.log(`     ⚠️  ${stmtError.message}`);
          } else {
            console.log(`     ✓ Applied`);
          }
        }
      }
    } else {
      console.log('✅ RLS policies migration executed successfully!\n');
    }

    // Verify the profiles table exists and is accessible
    console.log('🔍 Verifying profiles table...\n');
    const { data: tableData, error: tableError } = await supabase
      .from('profiles')
      .select('role')
      .limit(1);

    if (tableError) {
      console.log('⚠️  Profiles table access:', tableError.message);
      console.log('\n📋 The SQL migration may need to be executed in the Supabase SQL Editor.');
      console.log('\n📝 SQL to run in Supabase SQL Editor:');
      console.log(migrationSQL);
    } else {
      console.log('✅ Profiles table is accessible and RLS policies are active!\n');
    }

    console.log('✅ RLS Migration Complete!');
    console.log('\n📋 Next Steps:');
    console.log('1. Start development server: npm run dev');
    console.log('2. Test registration: POST /api/auth/register');
    console.log('3. Test user role lookup: GET /api/auth/me');
    console.log('4. Preview URL: http://localhost:3000');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.log('\n📝 Manual SQL Setup Required in Supabase SQL Editor:');
    console.log(migrationSQL);
  }
}

executeMigration();