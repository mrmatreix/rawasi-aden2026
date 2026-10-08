const { query, get } = require('../database/db');

async function auditColumns() {
  const keytables = ['users', 'clients', 'client_users', 'client_project_access', 'projects', 'bills', 'payments', 'client_notifications', 'client_messages'];
  for (const t of keytables) {
    const cols = await query(`PRAGMA table_info(${t})`);
    console.log(`\n=== ${t} ===`);
    cols.forEach(c => console.log(`  ${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value ? ' DEFAULT ' + c.dflt_value : ''}`));
    const cnt = await get(`SELECT COUNT(*) as c FROM ${t}`);
    console.log(`  -> ${cnt.c} rows`);
  }

  // Check users table roles
  const sampleUsers = await query('SELECT id, username, email, role, is_active FROM users LIMIT 10');
  console.log('\n=== SAMPLE users ===');
  sampleUsers.forEach(u => console.log(JSON.stringify(u)));

  // Check clients table
  const sampleClients = await query('SELECT id, name, company, email, phone FROM clients LIMIT 10');
  console.log('\n=== SAMPLE clients ===');
  sampleClients.forEach(c => console.log(JSON.stringify(c)));

  // Check roles
  const roles = await query('SELECT id, name, display_name FROM roles');
  console.log('\n=== roles ===');
  roles.forEach(r => console.log(JSON.stringify(r)));

  process.exit(0);
}
auditColumns().catch(e => { console.error(e); process.exit(1); });
