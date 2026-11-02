import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || 'https://iksjhjxwphmvthryfeae.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const tablesRes = await supabase.from('information_schema.tables')
    .select("table_name, table_type")
    .eq('table_schema', 'public')
    .eq('table_type', 'BASE TABLE')
    .order('table_name')
  const tables = tablesRes.data || []
  console.log('=== TABLES (', tables.length, ') ===')
  for (const t of tables) console.log(`- ${t.table_name}`)

  for (const t of tables) {
    const name = t.table_name
    const colsRes = await supabase.from('information_schema.columns')
      .select("column_name, data_type, is_nullable, column_default")
      .eq('table_schema', 'public')
      .eq('table_name', name)
      .order('ordinal_position')
    const idxRes = await supabase.from('pg_indexes')
      .select('indexname, indexdef')
      .eq('schemaname', 'public')
      .eq('tablename', name)
      .order('indexname')
    const polRes = await supabase.from('pg_policies')
      .select("policyname, cmd")
      .eq('schemaname', 'public')
      .eq('tablename', name)
      .order('policyname')
    console.log(`\n##### ${name} #####`)
    for (const c of colsRes.data || []) console.log(`  col: ${c.column_name} (${c.data_type}) nullable=${c.is_nullable}`)
    for (const ix of idxRes.data || []) console.log(`  idx: ${ix.indexname}`)
    for (const p of polRes.data || []) console.log(`  policy: ${p.policyname} cmd=${p.cmd}`)
  }

  // الدوال: اسأل عن كل اسم معروف
  const fns = ['p_proc_receive_goods','p_create_purchase_gl_entries','p_sale_approve_invoice',
               'p_sale_record_payment','p_sale_create_return','register_independent_warehouse',
               'wms_gr_create','wms_gr_apply_items','wms_gr_set_items','wms_context',
               'wms_ctx_warehouse_id','wms_ctx_tenant_id','wms_ctx_role',
               'wms_assert_user_warehouse','wms_current_user','wms_is_member_warehouse',
               'wms_same_warehouse_user']
  console.log('\n=== FUNCTIONS ===')
  for (const fn of fns) {
    const res = await supabase.from('pg_proc')
      .select("proname, prorettype::regtype, proargnames, prosrc")
      .eq('pronamespace', 2200)
      .eq('proname', fn)
      .limit(1)
    const row = res.data?.[0]
    if (row) console.log(`fn: ${row.proname} -> ${row.prorettype} args=[${row.proargnames?.join(',')||''}] src=http://... (${row.prosrc?.length||0} bytes)`)
  }
  // كل الدوال
  const allFns = await supabase.from('pg_proc')
    .select("proname, prorettype::regtype, proargnames")
    .eq('pronamespace', 2200)
    .order('proname')
  console.log('\n=== ALL FUNCTIONS (', allFns.data?.length||0, ') ===')
  for (const f of allFns.data || []) console.log(`- ${f.proname} -> ${f.prorettype} args=[${f.proargnames?.join(',')||''}]`)
}

main().catch(e => { console.error(e); process.exit(1) })
