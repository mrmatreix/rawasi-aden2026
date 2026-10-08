const db = require('../server/database/db.js');

async function run() {
  const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('=== ALL TABLES IN DB ===');
  console.log(tables.map(t => t.name).join(', '));

  const targetTables = [
    'payments', 'receipt_vouchers', 'expenses', 'payment_vouchers',
    'payment_methods', 'financial_accounts', 'bank_accounts', 'cash_accounts',
    'accounts', 'journal_entries', 'journal_entry_details',
    'clients', 'suppliers', 'bills', 'project_contracts', 'projects',
    'cost_centers', 'audit_logs', 'currencies'
  ];

  console.log('\n=== TARGET TABLES SCHEMA DETAILS ===');
  for (const t of targetTables) {
    const exists = tables.some(x => x.name === t);
    if (!exists) {
      console.log(`❌ Table '${t}' does NOT exist.`);
      continue;
    }
    const cols = await db.query(`PRAGMA table_info(${t})`);
    console.log(`\n📌 Table: ${t}`);
    console.log(cols.map(c => `  - ${c.name} (${c.type}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value ? ' DEFAULT ' + c.dflt_value : ''}${c.pk ? ' PK' : ''})`).join('\n'));
    
    // Check foreign keys
    const fks = await db.query(`PRAGMA foreign_key_list(${t})`);
    if (fks && fks.length > 0) {
      console.log('  FKs:', fks.map(f => `${f.from} -> ${f.table}(${f.to})`).join(', '));
    }
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
