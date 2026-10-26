// ============================================
// سكريبت لإنشاء عمود user_id باستخدام Service Role Key
// ============================================

const SUPABASE_URL = 'https://iksjhjxwphmvthryfeae.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q';

async function executeSQL(sql, description) {
    console.log(`\n🔧 ${description}...`);
    
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
            method: 'POST',
            headers: {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'tx=rollback' // Transaction mode
            },
            body: JSON.stringify({
                query: sql
            })
        });
        
        if (response.ok) {
            console.log(`✅ ${description} - Success`);
            return true;
        }
        
        const error = await response.json();
        
        // Check if error is "column already exists" (which is fine)
        if (error.message && error.message.includes('already exists')) {
            console.log(`ℹ️ ${description} - Already exists (OK)`);
            return true;
        }
        
        console.error(`❌ ${description} - Failed:`, error);
        return false;
        
    } catch (e) {
        console.error(`❌ ${description} - Error:`, e.message);
        return false;
    }
}

async function createUserIdColumn() {
    console.log('========================================');
    console.log('🔧 Creating user_id column in products table');
    console.log('📡 URL:', SUPABASE_URL);
    console.log('🔑 Key:', SERVICE_ROLE_KEY.substring(0, 30) + '...');
    console.log('========================================\n');
    
    // Method 1: Try using Supabase REST API with pgexec
    try {
        console.log('📝 Method 1: Using REST API...');
        
        // Try to execute SQL via the REST API
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sql: 'ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id UUID;'
            })
        });
        
        if (response.ok) {
            console.log('✅ Column created via RPC!');
        } else {
            console.log('⚠️ RPC method not available, trying alternative...');
        }
    } catch (e) {
        console.log('⚠️ RPC method failed:', e.message);
    }
    
    // Method 2: Try direct PostgreSQL connection (if possible)
    console.log('\n📝 Method 2: Direct API call...');
    
    // Try using the query endpoint
    const sqlCommands = [
        {
            sql: 'ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id UUID;',
            desc: 'Adding user_id column'
        },
        {
            sql: 'CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);',
            desc: 'Creating user_id index'
        },
        {
            sql: 'CREATE INDEX IF NOT EXISTS idx_products_warehouse ON products(warehouse_id);',
            desc: 'Creating warehouse_id index'
        }
    ];
    
    let successCount = 0;
    
    for (const cmd of sqlCommands) {
        try {
            // Use the query parameter approach
            const response = await fetch(`${SUPABASE_URL}/rest/v1/products?select=id&limit=0`, {
                method: 'HEAD',
                headers: {
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
                }
            });
            
            if (response.ok) {
                console.log(`✅ API connection successful`);
                successCount++;
            }
        } catch (e) {
            console.error('❌ API error:', e.message);
        }
    }
    
    console.log('\n========================================');
    console.log('📋 Summary:');
    console.log('========================================');
    console.log('');
    console.log('⚠️ لم نتمكن من تنفيذ SQL برمجياً (API limitation)');
    console.log('');
    console.log('📌 يجب تشغيل SQL يدوياً في Supabase Dashboard:');
    console.log('');
    console.log('1. افتح: https://app.supabase.com');
    console.log('2. اختر مشروعك: iksjhjxwphmvthryfeae');
    console.log('3. اذهب إلى: SQL Editor');
    console.log('4. الصق هذا الكود:');
    console.log('');
    console.log('----------------------------------------');
    console.log(`
ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_warehouse ON products(warehouse_id);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own products" ON products;
DROP POLICY IF EXISTS "Users can insert own products" ON products;
DROP POLICY IF EXISTS "Users can update own products" ON products;
DROP POLICY IF EXISTS "Users can delete own products" ON products;

CREATE POLICY "Users can view own products" ON products
    FOR SELECT USING (user_id = auth.uid()::text OR user_id IS NULL);

CREATE POLICY "Users can insert own products" ON products
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users can update own products" ON products
    FOR UPDATE USING (user_id = auth.uid()::text OR user_id IS NULL);

CREATE POLICY "Users can delete own products" ON products
    FOR DELETE USING (user_id = auth.uid()::text OR user_id IS NULL);
    `);
    console.log('----------------------------------------');
    console.log('');
    console.log('5. اضغط Run');
    console.log('');
}

// Run the script
createUserIdColumn().catch(console.error);
