const { createClient } = require('@supabase/supabase-js')
const sb = createClient('https://iksjhjxwphmvthryfeae.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function rest(path) {
  const r = await sb.restore('raw', { method: 'GET', url: `https://iksjhjxwphmvthryfeae.supabase.co${path}` })
  return r
}

async function main() {
  // tables
  const tr = await rest('/rest/v1/information_schema.tables?select=table_name,table_type&table_schema=eq.public&table_type=eq.BASE+TABLE&order=table_name.asc')
  const tables = tr.data || []
  console.log('=== TABLES (', tables.length, ') ===')
  for (const t of tables) console.log('-', t.table_name)

  // لكل جدول: columns + indexes + policies
  for (const t of tables) {
    const name = t.table_name
    const cols = (await rest(`/rest/v1/information_schema.columns?select=column_name,data_type,is_nullable&table_schema=eq.public&table_name=eq.${encodeURIComponent(name)}&order=ordinal_position.asc`)).data || []
    const idx = (await rest(`/rest/v1/pg_indexes?select=indexname&schemaname=eq.public&tablename=eq.${encodeURIComponent(name)}`)).data || []
    const pol = (await rest(`/rest/v1/pg_policies?select=policyname,cmd&schemaname=eq.public&tablename=eq.${encodeURIComponent(name)}`)).data || []
    console.log(`\n##### ${name} #####`)
    for (const c of cols) console.log(`  col: ${c.column_name} (${c.data_type}) nullable=${c.is_nullable}`)
    for (const i of idx) console.log(`  idx: ${i.indexname}`)
    for (const p of pol) console.log(`  policy: ${p.policyname} cmd=${p.cmd}`)
  }

  // الدوال الكلّية
  const fns = (await rest('/rest/v1/pg_proc?select=proname,prorettype::text,proargnames&pronamespace=eq.2200&order=proname.asc&limit=300')).data || []
  console.log('\n=== ALL FUNCTIONS (', fns.length, ') ===')
  for (const f of fns) console.log(`- ${f.proname} -> ${f.prorettype} args=[${f.proargnames?.join(',')||''}]`)
}

main().catch(e => { console.error(e); process.exit(1) })
