const db = require('../server/database/db.js');

async function run() {
  const expensesAccs = await db.query("SELECT id, code, name, level, is_posting FROM accounts WHERE code LIKE '5%' ORDER BY code ASC");
  console.log('=== EXPENSE ACCOUNTS (5%) ===');
  console.log(expensesAccs.map(a => `[${a.id}] ${a.code} - ${a.name} (Lvl ${a.level}, posting: ${a.is_posting})`).join('\n'));
  process.exit(0);
}
run();
