const db = require('../server/database/db.js');

async function run() {
  const lvl1 = await db.query("SELECT id, code, name, type, level, is_posting FROM accounts WHERE level = 1 ORDER BY code ASC");
  console.log('=== LEVEL 1 ACCOUNTS ===');
  console.log(lvl1);

  const allTypes = await db.query("SELECT DISTINCT type FROM accounts");
  console.log('=== ACCOUNT TYPES ===');
  console.log(allTypes);

  const expenses = await db.query("SELECT id, code, name, type, level, is_posting FROM accounts WHERE type LIKE '%مصروف%' OR type LIKE '%expense%' OR name LIKE '%مصروف%' OR name LIKE '%عمول%' OR name LIKE '%رسوم%' ORDER BY code ASC");
  console.log('=== EXPENSE / FEE ACCOUNTS ===');
  console.log(expenses);

  process.exit(0);
}
run();
