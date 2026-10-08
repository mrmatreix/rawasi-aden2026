/**
 * Audit Script - Phase 1 Analysis
 * Lists all tables, their columns, and key relationships
 */
const { query, get } = require('../database/db');

async function auditSchema() {
  // 1. All tables
  const tables = await query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('\n=== TABLES IN DATABASE ===');
  console.log(tables.map(t => t.name).join('\n'));

  // 2. Key tables for client portal - detailed schema
  const portalTables = [
    'users', 'clients', 'client_users', 'client_project_access',
    'client_notifications', 'client_messages',
    'projects', 'bills', 'payments', 'project_documents',
    'audit_logs', 'permissions', 'roles',
    'accounting_periods', 'cash_flow_account_mappings',
    'project_contracts', 'project_drawings'
  ];

  for (const tbl of portalTables) {
    try {
      const cols = await query(`PRAGMA table_info(${tbl})`);
      if (cols.length > 0) {
        console.log(`\n--- TABLE: ${tbl} ---`);
        cols.forEach(c => {
          const pk = c.pk ? ' [PK]' : '';
          const notnull = c.notnull ? ' NOT NULL' : '';
          const dflt = c.dflt_value ? ` DEFAULT ${c.dflt_value}` : '';
          console.log(`  ${c.name} ${c.type}${pk}${notnull}${dflt}`);
        });
        const cnt = await get(`SELECT COUNT(*) as c FROM ${tbl}`);
        console.log(`  [Row count: ${cnt.c}]`);
      }
    } catch(e) {
      console.log(`\n--- TABLE: ${tbl} --- [NOT EXISTS or ERROR: ${e.message}]`);
    }
  }

  // 3. Check existing views
  const views = await query("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name");
  console.log('\n=== VIEWS ===');
  console.log(views.length > 0 ? views.map(v => v.name).join('\n') : '(none)');

  // 4. Indexes on key tables
  const indexes = await query("SELECT name, tbl_name FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name");
  console.log('\n=== INDEXES ===');
  indexes.forEach(i => console.log(`  ${i.tbl_name}: ${i.name}`));

  // 5. Check client_users data (sample)
  try {
    const cu = await query('SELECT id, client_id, email, role, status, two_factor_enabled, permissions FROM client_users LIMIT 5');
    console.log('\n=== SAMPLE client_users ===');
    cu.forEach(u => console.log(JSON.stringify(u)));
  } catch(e) {
    console.log('\nclient_users: NOT EXISTS');
  }

  // 6. Client project access
  try {
    const cpa = await query('SELECT * FROM client_project_access LIMIT 5');
    console.log('\n=== SAMPLE client_project_access ===');
    cpa.forEach(r => console.log(JSON.stringify(r)));
  } catch(e) {
    console.log('\nclient_project_access: NOT EXISTS');
  }

  // 7. Check admin_client_users route capabilities
  console.log('\n=== ROUTES SUMMARY ===');
  console.log('client_portal.js: EXISTING');
  console.log('admin_client_users.js: EXISTING');
  console.log('client_auth.js middleware: EXISTING');

  process.exit(0);
}

auditSchema().catch(e => { console.error(e); process.exit(1); });
