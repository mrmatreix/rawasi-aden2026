const db = require('../server/database/db.js');

async function run() {
  console.log('=== ACCOUNTS: CASH, BANK, RECEIVABLE, PAYABLE, FEES ===');
  const accs = await db.query(`
    SELECT id, code, name, type, level, is_posting 
    FROM accounts 
    WHERE code LIKE '121%' -- Cash
       OR code LIKE '122%' -- Banks
       OR code LIKE '113%' -- Receivables / Clients / Advances
       OR code LIKE '211%' -- Payables / Suppliers
       OR code LIKE '524%' -- Bank charges / Gateway fees
       OR code LIKE '4%'   -- Revenues
       OR code LIKE '5%'   -- Expenses
    ORDER BY code ASC
  `);
  console.log(accs.map(a => `[${a.id}] ${a.code} - ${a.name} (Lvl ${a.level}, posting: ${a.is_posting})`).join('\n'));

  console.log('\n=== RECENT PAYMENTS IN DB ===');
  const recentPayments = await db.query('SELECT id, receipt_no, type, amount, payment_method, status, journal_entry_id FROM payments ORDER BY id DESC LIMIT 5');
  console.log(recentPayments);

  console.log('\n=== RECENT EXPENSES IN DB ===');
  const recentExpenses = await db.query('SELECT id, receipt_no, expense_type, amount, payment_method, status, journal_entry_id FROM expenses ORDER BY id DESC LIMIT 5');
  console.log(recentExpenses);

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
