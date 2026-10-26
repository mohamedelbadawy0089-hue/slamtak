#!/usr/bin/env node
// ============================================
// سكريبت بسيط لإنشاء عمود user_id
// ============================================

const https = require('https');

const SUPABASE_URL = 'iksjhjxwphmvthryfeae.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q';

// SQL to execute
const SQL_COMMANDS = [
    'ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id UUID;',
    'CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);',
    'CREATE INDEX IF NOT EXISTS idx_products_warehouse ON products(warehouse_id);',
    'ALTER TABLE products ENABLE ROW LEVEL SECURITY;',
    'DROP POLICY IF EXISTS "Users can view own products" ON products;',
    'DROP POLICY IF EXISTS "Users can insert own products" ON products;',
    'DROP POLICY IF EXISTS "Users can update own products" ON products;',
    'DROP POLICY IF EXISTS "Users can delete own products" ON products;',
    'CREATE POLICY "Users can view own products" ON products FOR SELECT USING (user_id = auth.uid()::text OR user_id IS NULL);',
    'CREATE POLICY "Users can insert own products" ON products FOR INSERT WITH CHECK (user_id = auth.uid()::text);',
    'CREATE POLICY "Users can update own products" ON products FOR UPDATE USING (user_id = auth.uid()::text OR user_id IS NULL);',
    'CREATE POLICY "Users can delete own products" ON products FOR DELETE USING (user_id = auth.uid()::text OR user_id IS NULL);'
];

async function makeRequest(path, method, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: SUPABASE_URL,
            port: 443,
            path: path,
            method: method,
            headers: {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            }
        };
        
        if (body) {
            options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
        }
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: data ? JSON.parse(data) : null
                    });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        
        req.on('error', reject);
        
        if (body) {
            req.write(JSON.stringify(body));
        }
        
        req.end();
    });
}

async function main() {
    console.log('========================================');
    console.log('🔧 Creating user_id column');
    console.log('📡 Project:', SUPABASE_URL);
    console.log('========================================\n');
    
    // Try to check current table structure
    console.log('🔍 Checking current table structure...');
    try {
        const result = await makeRequest('/rest/v1/products?select=id,name,user_id&limit=1', 'GET');
        
        if (result.status === 200) {
            console.log('✅ Table exists and is accessible');
            
            // Check if user_id column exists
            if (result.data && result.data.length > 0 && 'user_id' in result.data[0]) {
                console.log('✅ user_id column already exists!');
            } else {
                console.log('⚠️ user_id column not found in response');
                console.log('📋 Response:', JSON.stringify(result.data, null, 2));
            }
        } else if (result.status === 400 && result.data?.message?.includes('user_id')) {
            console.log('❌ user_id column does not exist');
            console.log('📋 Error:', result.data.message);
        } else {
            console.log('⚠️ Unexpected response:', result.status, result.data);
        }
    } catch (e) {
        console.error('❌ Error checking table:', e.message);
    }
    
    console.log('\n========================================');
    console.log('📌 تنفيذ SQL يدوي مطلوب');
    console.log('========================================\n');
    
    console.log('🔧 شغل هذا الكود في Supabase Dashboard SQL Editor:\n');
    console.log('----------------------------------------');
    SQL_COMMANDS.forEach((sql, i) => {
        console.log(`${i + 1}. ${sql}`);
    });
    console.log('----------------------------------------\n');
    
    console.log('📍 الخطوات:');
    console.log('1. افتح https://app.supabase.com');
    console.log('2. اختر مشروعك');
    console.log('3. اذهب إلى SQL Editor');
    console.log('4. الصق الكود أعلاه');
    console.log('5. اضغط Run');
}

main().catch(console.error);
