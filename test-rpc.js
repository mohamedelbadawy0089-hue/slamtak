const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://iksjhjxwphmvthryfeae.supabase.co';
const supabaseKey = 'sb_publishable_0DUy2mtXS6m5S8PwTDAANQ_XWlzbu0G';
const supabaseClient = createClient(supabaseUrl, supabaseKey);

const sampleProduct = {
  "tradeName": "كوديلار 1",
  "trade_name": "كوديلار 1",
  "batchNumber": "B204",
  "batch_number": "B204",
  "quantity": 22,
  "public_price": 560.04,
  "purchase_discount": 9.2,
  "sales_discount": 6.1,
  "net_price": 525.88,
  "expiry_date": "2028-12-01",
  "category": "مسكن وخافض حرارة"
};

async function testRPC() {
  const { data, error } = await supabaseClient.rpc(
      'bulk_upsert_warehouse_products_flexible',
      {
          p_warehouse_id : "61d42e38-0668-4fbe-b68e-8920bf0e1de4",
          p_products     : JSON.stringify([sampleProduct])
      }
  );
  console.log("DATA:", data);
  console.log("ERROR:", error);
}

testRPC();
