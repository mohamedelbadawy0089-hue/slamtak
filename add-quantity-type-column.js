const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://iksjhjxwphmvthryfeae.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDA3NTUzNiwiZXhwIjoyMDg1NjUxNTM2fQ.IQ4KfNGAa8mLk_SYRv5nqXaquUtsxCiYdm2WClH4A0Q';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function addColumn() {
    console.log('Adding quantity_type column to products table...');
    
    // Method 1: Using Supabase REST API
    try {
        const { data, error } = await supabase.rpc('add_quantity_type_column');
        
        if (error) {
            console.error('RPC Error:', error);
            // Fall back to direct table update
            await fallbackMethod();
        } else {
            console.log('✅ Column added successfully via RPC');
            console.log('Data:', data);
        }
    } catch (e) {
        console.error('Error:', e);
        await fallbackMethod();
    }
}

async function fallbackMethod() {
    console.log('Trying fallback method...');
    
    // Try to insert a test product with quantity_type to verify column exists
    try {
        const { error } = await supabase
            .from('products')
            .update({ quantity_type: 'decreasing' })
            .eq('id', 999999); // Non-existent ID, will fail but tells us if column exists
        
        if (error && error.message.includes('column "quantity_type" does not exist')) {
            console.error('❌ Column does not exist yet');
            console.log('\n🔧 Manual action required:');
            console.log('Go to https://supabase.com/dashboard/project/iksjhjxwphmvthryfeae');
            console.log('Table Editor → products → Edit Table');
            console.log('Add column: quantity_type (varchar, default: decreasing)');
        } else if (error && error.code === 'PGRST116') {
            // No rows match, but column exists
            console.log('✅ Column exists! (no matching rows)');
        } else {
            console.log('✅ Column likely exists or different error');
            console.log('Error details:', error);
        }
    } catch (e) {
        console.error('Fallback error:', e);
    }
}

// Alternative: Try using pg_execute if available
async function tryDirectSQL() {
    console.log('\nTrying direct SQL...');
    
    try {
        // Try to use exec_sql or similar if available
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .limit(1);
        
        if (error) {
            console.error('Query error:', error);
        } else {
            console.log('✅ Connection works');
            console.log('Sample product:', data);
            
            // Check if quantity_type exists
            if (data && data.length > 0 && 'quantity_type' in data[0]) {
                console.log('✅ quantity_type column already exists!');
            } else {
                console.log('⚠️ quantity_type column may not exist');
                console.log('Product fields:', data[0] ? Object.keys(data[0]) : 'none');
            }
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

async function updateExistingProducts() {
    console.log('\nUpdating existing products...');
    
    try {
        const { data, error } = await supabase
            .from('products')
            .update({ quantity_type: 'decreasing' })
            .is('quantity_type', null);
        
        if (error) {
            console.error('Update error:', error);
        } else {
            console.log('✅ Updated products:', data);
        }
    } catch (e) {
        console.error('Error updating:', e);
    }
}

// Main execution
async function main() {
    console.log('=== Supabase quantity_type Setup ===\n');
    
    await tryDirectSQL();
    await addColumn();
    await updateExistingProducts();
    
    console.log('\n=== Done ===');
    console.log('\n⚠️ NOTE: The anon key may not have permission to alter schema.');
    console.log('If column does not exist, add it manually in Supabase Dashboard:');
    console.log('https://supabase.com/dashboard/project/iksjhjxwphmvthryfeae');
}

main();
