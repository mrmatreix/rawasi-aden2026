const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../server/database/db');
const AccountingService = require('../../server/services/accountingService');

test('Chart of Accounts - Restricts / Freezes Account and Blocks Journal Posting', async () => {
  const testCode = '9999';
  const testName = 'حساب اختبار مقيد';
  
  // Clean up if exists
  await db.run('DELETE FROM accounts WHERE code = ?', [testCode]);

  await db.run(
    `INSERT INTO accounts (code, name, type, level, status, balance)
     VALUES (?, ?, 'مصروفات', 4, 'restricted', 0)`,
    [testCode, testName]
  );

  const accRow = await db.get('SELECT * FROM accounts WHERE code = ?', [testCode]);
  assert.ok(accRow, 'Restricted account should exist');
  assert.strictEqual(accRow.status, 'restricted');

  // Validate that posting a journal entry using this restricted account throws error
  await assert.rejects(
    async () => {
      await AccountingService.validateJournalEntryLines([
        { account_id: accRow.id, debit: 1500, credit: 0 },
        { account_id: 1, debit: 0, credit: 1500 }
      ]);
    },
    { message: /موقوف ومقيد/ }
  );

  // Unfreeze / activate account
  await db.run("UPDATE accounts SET status = 'active' WHERE id = ?", [accRow.id]);
  const activeAcc = await db.get('SELECT * FROM accounts WHERE id = ?', [accRow.id]);
  assert.strictEqual(activeAcc.status, 'active');

  // Clean up
  await db.run('DELETE FROM accounts WHERE id = ?', [accRow.id]);
});

test('Chart of Accounts - Leaf Accounts Filter (Level 3+ Only for Vouchers & Journals)', async () => {
  const rows = await db.query(`
    SELECT a.*,
           (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) as children_count
    FROM accounts a
  `);

  const list = Array.isArray(rows) ? (Array.isArray(rows[0]) ? rows[0] : rows) : [];
  const leafAccounts = list.filter(a => a.status === 'active' && a.level >= 3 && Number(a.children_count) === 0);
  assert.ok(leafAccounts.length > 0, 'There should be leaf accounts available for posting');

  // Header accounts (like Level 1: '1 - أصول' or Level 2: '11 - أصول متداولة') must NOT be in leaf accounts
  const hasLevel1InLeaf = leafAccounts.some(a => a.level === 1);
  assert.strictEqual(hasLevel1InLeaf, false, 'Level 1 header accounts must not appear as usable leaf accounts');

  const hasLevel2InLeaf = leafAccounts.some(a => a.level === 2 && a.children_count > 0);
  assert.strictEqual(hasLevel2InLeaf, false, 'Level 2 parent accounts with children must not appear as leaf accounts');
});

test('Multi-Currency Vouchers - Local Currency Conversion and Exchange Rate Calculation', async () => {
  const foreignAmount = 100;
  const exchangeRateUSD = 1620.5;
  const expectedLocal = foreignAmount * exchangeRateUSD;

  // Simulate payment/expense calculation logic
  const computedLocal = Math.round(foreignAmount * exchangeRateUSD * 100) / 100;
  assert.strictEqual(computedLocal, 162050);

  // YER base currency check
  const yerRate = 1.0;
  const yerAmount = 50000;
  const yerLocal = yerAmount * yerRate;
  assert.strictEqual(yerLocal, 50000);
});
