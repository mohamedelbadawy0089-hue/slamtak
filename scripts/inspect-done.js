const { rawGet } = require('../scripts/raw-get.js')

async function main() {
  const tables = ['products','inventory','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','suppliers','customers','chart_of_accounts','general_ledger','payments','warehouses','inventory_movements','profiles','audit_logs','user_warehouses']
  for (const t of tables) {
    try {
      const r = await rawGet('/rest/v1/' + t + '?limit=1')
      if (Array.isArray(r) && r.length) {
        console.log('TABLE', t, ':', Object.keys(r[0]).join(', '))
      } else if (Array.isArray(r)) {
        console.log('TABLE', t, ': EMPTY (no rows)')
      } else {
        console.log('TABLE', t, ': error', JSON.stringify(r).substring(0, 120))
      }
    } catch (e) {
      console.log('TABLE', t, ': threw', e.message.substring(0, 80))
    }
  }

  console.log('\n=== SAMPLES ===')
  const samples = [
    { t:'products', sel:'id,name,name_ar,sku,barcode,price,cost_price,warehouse_id' },
    { t:'inventory', sel:'id,product_id,batch_number,expiry_date,quantity,available_quantity,unit_cost,cost_price,warehouse_id' },
    { t:'purchase_orders', sel:'id,order_number,supplier_id,warehouse_id,status,total_amount,order_date,created_at' },
    { t:'purchase_order_items', sel:'id,purchase_order_id,product_id,product_name,quantity,unit_price,received_quantity,subtotal' },
    { t:'goods_receipts', sel:'id,receipt_number,purchase_order_id,supplier_id,warehouse_id,status,receipt_date,created_by' },
    { t:'goods_receipt_items', sel:'id,goods_receipt_id,product_id,batch_number,expiry_date,quantity,quantity_received,quantity_damaged,unit_cost,cost_price' },
    { t:'suppliers', sel:'id,name,name_ar,code,contact_person,phone,email,address,payment_terms,credit_limit,is_active,current_balance' },
    { t:'customers', sel:'id,name,name_ar,code,contact_person,phone,email,address,credit_limit,payment_terms,current_balance' },
    { t:'chart_of_accounts', sel:'id,tenant_id,parent_id,code,account_type,account_name,debit,natural_balance' },
    { t:'general_ledger', sel:'id,tenant_id,account_id,reference_type,reference_id,debit,credit,description,warehouse_id,supplier_id,created_by,posted' },
    { t:'payments', sel:'id,tenant_id,type,reference_type,reference_id,supplier_id,warehouse_id,amount,payment_date,payment_method,payment_number,status,created_by' },
    { t:'warehouses', sel:'id,name,code,is_main,tenant_id,manager_id,address,phone,created_at' },
    { t:'inventory_movements', sel:'id,tenant_id,warehouse_id,product_id,movement_type,quantity,cost_price,notes,created_by,created_at' },
    { t:'profiles', sel:'id,role,full_name,phone,governorate,warehouse_id' },
    { t:'audit_logs', sel:'id,tenant_id,user_id,warehouse_id,action,entity_type,entity_id,new_values,created_at' },
    { t:'user_warehouses', sel:'id,user_id,warehouse_id,is_default,created_at' }
  ]
  for (const s of samples) {
    const r = await rawGet('/rest/v1/' + s.t + '?select=' + s.sel + '&limit=2')
    if (Array.isArray(r) && r.length) {
      console.log('\n---', s.t, '---')
      for (const row of r) console.log('  ', JSON.stringify(row))
    } else {
      console.log('\n---', s.t, ': empty or error', JSON.stringify(r).substring(0, 100))
    }
  }

  console.log('\n=== FUNCTIONS ===')
  const fns = await rawGet('/rest/v1/pg_proc?select=proname,prorettype::text,proargnames&pronamespace=eq.2200&order=proname.asc&limit=300')
  for (const f of fns) console.log('-', f.proname, '->', f.prorettype, 'args=[', f.proargnames?.join(',')||'', ']')
}

main().catch(e => { console.error(e); process.exit(1) })
