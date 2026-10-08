const test = require('node:test');
const assert = require('node:assert/strict');
const AccountingService = require('../../server/services/accountingService');

test('Accounting Rules - Rejects Empty or Single-Line Entries', async () => {
  await assert.rejects(
    async () => {
      await AccountingService.validateJournalEntryLines([]);
    },
    { message: /يجب أن يحتوي القيد على سطرين/ }
  );

  await assert.rejects(
    async () => {
      await AccountingService.validateJournalEntryLines([{ account_id: 1, debit: 500, credit: 0 }]);
    },
    { message: /يجب أن يحتوي القيد على سطرين/ }
  );
});

test('Accounting Rules - Rejects Negative Amounts & Same-Line Dual Entry', async () => {
  await assert.rejects(
    async () => {
      await AccountingService.validateJournalEntryLines([
        { account_id: 1, debit: -500, credit: 0 },
        { account_id: 2, debit: 0, credit: 500 }
      ]);
    },
    { message: /لا يمكن إدخال مبالغ سالبة/ }
  );

  await assert.rejects(
    async () => {
      await AccountingService.validateJournalEntryLines([
        { account_id: 1, debit: 500, credit: 200 },
        { account_id: 2, debit: 0, credit: 300 }
      ]);
    },
    { message: /لا يمكن تحديد مبلغ مدين ودائن معاً/ }
  );
});

test('Accounting Rules - Rejects Unbalanced Entries', async () => {
  await assert.rejects(
    async () => {
      await AccountingService.validateJournalEntryLines([
        { account_id: 1, debit: 1000, credit: 0 },
        { account_id: 2, debit: 0, credit: 800 }
      ]);
    },
    { message: /القيد غير متزن محاسبياً/ }
  );
});
