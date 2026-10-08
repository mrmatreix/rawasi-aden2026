const { query } = require('../server/database/db');

async function inspect() {
  const tables = await query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('=== All Database Tables ===');
  console.log(tables.map(t => t.name).join(', '));

  const targetTables = ['accounts', 'journal_entries', 'journal_entry_lines', 'payments', 'expenses', 'payment_vouchers', 'receipt_vouchers', 'bank_accounts', 'cost_centers'];
  
  for (const t of targetTables) {
    const exists = tables.some(x => x.name === t);
    if (exists) {
      console.log(`\n--- Schema of [${t}] ---`);
      const cols = await query(`PRAGMA table_info("${t}")`);
      console.table(cols.map(c => ({ name: c.name, type: c.type, notnull: c.notnull, dflt_value: c.dflt_value, pk: c.pk })));
      const fks = await query(`PRAGMA foreign_key_list("${t}")`);
      if (fks.length > 0) {
        console.log(`Foreign keys for [${t}]:`, fks.map(f => `${f.from} -> ${f.table}(${f.to})`));
      }
    } else {
      console.log(`\n--- Table [${t}] DOES NOT EXIST ---`);
    }
  }
}

inspect().then(() => process.exit(0)).catch(console.error);
