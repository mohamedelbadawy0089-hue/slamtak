// ============================================
// سكريبت لإضافة عمود user_id لجدول products
// ============================================

const SUPABASE_URL = 'https://iksjhjxwphmvthryfeae.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ2NjE5NjEsImV4cCI6MjA1MDIzNzk2MX0.3b7wQ8v7hXkL5yF6Z7mN8pQ9rR0sT1uV2wX3yZ4a5b';

async function addUserIdColumn() {
    console.log('🔧 Adding user_id column to products table...');
    console.log('📡 URL:', SUPABASE_URL);
    
    try {
        // محاولة استدعاء RPC function (إذا كانت موجودة)
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_column`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                table_name: 'products',
                column_name: 'user_id',
                data_type: 'uuid'
            })
        });
        
        if (response.ok) {
            console.log('✅ Column added successfully via RPC');
            return;
        }
        
        const error = await response.json();
        console.log('⚠️ RPC method failed:', error);
        console.log('\n📋 يجب إضافة العمود يدوياً:');
        console.log('1. افتح Supabase Dashboard: https://app.supabase.com');
        console.log('2. اختر مشروعك: iksjhjxwphmvthryfeae');
        console.log('3. اذهب إلى SQL Editor');
        console.log('4. شغل الملف: add-user-id-column.sql');
        
    } catch (e) {
        console.error('❌ Error:', e.message);
        console.log('\n📋 الطريقة اليدوية:');
        console.log('1. افتح Supabase Dashboard: https://app.supabase.com');
        console.log('2. اختر مشروعك');
        console.log('3. اذهب إلى SQL Editor');
        console.log('4. شغل الملف: add-user-id-column.sql');
    }
}

addUserIdColumn();
