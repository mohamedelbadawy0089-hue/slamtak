const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const fs = require('fs');
const readline = require('readline');

const SUPABASE_URL = 'https://iksjhjxwphmvthryfeae.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q';

const sql = `
ALTER TABLE public.warehouse_custom_products ADD COLUMN IF NOT EXISTS supplier_invoice_ref VARCHAR(100);
`;

console.log('=== Supabase SQL Runner ===\n');
console.log('⚠️  IMPORTANT: Supabase REST API does NOT support ALTER TABLE via HTTP.');
console.log('    The REST API only supports SELECT/INSERT/UPDATE/DELETE on tables.\n');

// Method 1: Try using Supabase CLI if available
async function tryCLI() {
    console.log('🔍 Checking for Supabase CLI...\n');
    
    try {
        execSync('supabase --version', { stdio: 'ignore' });
        console.log('✅ Supabase CLI found!');
        console.log('\n📋 To run the SQL using CLI, execute this command:\n');
        console.log('supabase sql --project-ref iksjhjxwphmvthryfeae -f run-this.sql\n');
        
        // Create the SQL file
        fs.writeFileSync('run-this.sql', sql);
        console.log('✅ Created: run-this.sql');
        console.log('\n🚀 Run it with: supabase sql --project-ref iksjhjxwphmvthryfeae -f run-this.sql');
        return true;
    } catch (e) {
        console.log('❌ Supabase CLI not found.\n');
        return false;
    }
}

// Method 2: Create a stored procedure via REST (if pg_execute available)
async function tryCreateFunction() {
    console.log('🔍 Trying to create a stored procedure...\n');
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    try {
        // Try to call exec_sql if it exists (custom function)
        const { data, error } = await supabase.rpc('exec_sql', { sql: sql });
        
        if (error) {
            console.log('❌ exec_sql function not found or error:', error.message);
            console.log('\n💡 You need to create this function in SQL Editor first:\n');
            console.log(`
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
            `);
            return false;
        }
        
        console.log('✅ SQL executed successfully!');
        console.log('Result:', data);
        return true;
    } catch (e) {
        console.log('❌ Error:', e.message);
        return false;
    }
}

// Method 3: Try direct pg connection (if we had the DB password)
async function tryDirectConnection() {
    console.log('\n🔍 Checking for direct PostgreSQL access...\n');
    
    console.log('❌ Direct connection requires database password (not the JWT).');
    console.log('   The connection string format is:');
    console.log('   postgresql://postgres:[PASSWORD]@db.iksjhjxwphmvthryfeae.supabase.co:5432/postgres');
    console.log('\n   You can find this in: Supabase Dashboard → Project Settings → Database');
    
    return false;
}

// Method 4: Generate curl command for Management API
function generateManagementAPICurl() {
    console.log('\n📡 Management API (requires extra setup):\n');
    console.log('The Supabase Management API can run SQL but requires a separate token.\n');
}

// Main
async function main() {
    let success = false;
    
    // Try CLI first
    success = await tryCLI();
    
    if (!success) {
        success = await tryCreateFunction();
    }
    
    if (!success) {
        await tryDirectConnection();
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📋 SUMMARY:\n');
    
    if (!success) {
        console.log('❌ Could not execute SQL automatically.');
        console.log('\n✅ EASIEST SOLUTION:\n');
        console.log('1. Open: https://supabase.com/dashboard/project/iksjhjxwphmvthryfeae/sql-editor');
        console.log('2. Click: New Query');
        console.log('3. Paste this SQL:\n');
        console.log(sql);
        console.log('4. Click: Run (green button)\n');
        console.log('⏱️  Takes 30 seconds max!\n');
        
        // Save SQL to file
        fs.writeFileSync('add-quantity-type.sql', sql);
        console.log('💾 SQL saved to: add-quantity-type.sql\n');
    }
    
    // Interactive mode
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    console.log('Options:');
    console.log('1. Open Dashboard in browser (recommended)');
    console.log('2. Install Supabase CLI and retry');
    console.log('3. Exit\n');
    
    rl.question('Choose (1/2/3): ', (answer) => {
        if (answer === '1') {
            console.log('\n🌐 Opening browser...');
            try {
                const url = 'https://supabase.com/dashboard/project/iksjhjxwphmvthryfeae/sql-editor';
                const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
                execSync(`${start} ${url}`);
            } catch (e) {
                console.log('Could not open browser. Please manually visit:');
                console.log('https://supabase.com/dashboard/project/iksjhjxwphmvthryfeae/sql-editor');
            }
        } else if (answer === '2') {
            console.log('\n📦 Install Supabase CLI:');
            console.log('npm install -g supabase');
            console.log('\nThen login:');
            console.log('supabase login');
            console.log('\nThen run:');
            console.log('supabase sql --project-ref iksjhjxwphmvthryfeae -f add-quantity-type.sql');
        }
        rl.close();
    });
}

main();
