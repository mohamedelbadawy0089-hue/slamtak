const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:G8I87Fazezstvl18@db.mvthryfeae.supabase.co:5432/postgres'
});
async function run() {
  try {
    await client.connect();
    console.log('جاري الاتصال بقاعدة البيانات...');
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity_type TEXT DEFAULT 'decreasing';");
    await client.query("UPDATE products SET quantity_type = 'decreasing' WHERE quantity_type IS NULL;");
    console.log('✅ تم بنجاح: العمود أضيف والبيانات تم تحديثها!');
  } catch (err) {
    console.error('❌ خطأ:', err.message);
  } finally {
    await client.end();
  }
}
run();
