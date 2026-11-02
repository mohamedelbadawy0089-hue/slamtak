const { rawGet } = require('./raw-get.js')
async function main() {
  const tables = await rawGet('/rest/v1/information_schema.tables?select=table_name,table_type&table_schema=eq.public&table_type=eq.BASE+TABLE&order=table_name.asc')
  console.log('=== TABLES (', tables.length, ') ===')
  for (const t of tables) console.log('-', t.table_name)
  for (const t of tables) {
    const name = t.table_name
    const cols = await rawGet(`/rest/v1/information_schema.columns?select=column_name,data_type,is_nullable&table_schema=eq.public&table_name=eq.${encodeURIComponent(name)}&order=ordinal_position.asc`)
    const idx = await rawGet(`/rest/v1/pg_indexes?select=indexname&schemaname=eq.public&tablename=eq.${encodeURIComponent(name)}`)
    const pol = await rawGet(`/rest/v1/pg_policies?select=policyname,cmd&schemaname=eq.public&tablename=eq.${encodeURIComponent(name)}`)
    console.log(`\n##### ${name} #####`)
    for (const c of cols) console.log(`  col: ${c.column_name} (${c.data_type}) nullable=${c.is_nullable}`)
    for (const i of idx) console.log(`  idx: ${i.indexname}`)
    for (const p of pol) console.log(`  policy: ${p.policyname} cmd=${p.cmd}`)
  }
  const fns = await rawGet('/rest/v1/pg_proc?select=proname,prorettype::text,proargnames&pronamespace=eq.2200&order=proname.asc&limit=300')
  console.log('\n=== ALL FUNCTIONS (', fns.length, ') ===')
  for (const f of fns) console.log(`- ${f.proname} -> ${f.prorettype} args=[${f.proargnames?.join(',')||''}]`)
}
main().catch(e => { console.error(e); process.exit(1) })
