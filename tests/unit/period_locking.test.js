const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../server/database/db');
const { checkPeriodOpen } = require('../../server/services/periodService');

test('Period Locking - Allows Open Future Dates', async () => {
  const res = await checkPeriodOpen('2029-01-01');
  assert.strictEqual(res.isOpen, true, 'Future open date should be permitted');
});

test('Period Locking - Blocks Closed Historical Period', async () => {
  // إنشاء فترة اختبارية مغلقة
  await db.run(
    `INSERT INTO accounting_periods (period_name, fiscal_year, start_date, end_date, status, notes)
     VALUES (?, ?, ?, ?, 'closed', ?)`,
    ['فترة اختبارية للاختبار', 2022, '2022-01-01', '2022-12-31', 'Test Closed Period']
  );

  const res = await checkPeriodOpen('2022-06-15');
  assert.strictEqual(res.isOpen, false, 'Date within closed period must be blocked');
  assert.ok(res.message.includes('مغلقة رسمياً'), 'Message should state period is closed');

  // تنظيف السجل الاختباري
  await db.run(`DELETE FROM accounting_periods WHERE period_name = 'فترة اختبارية للاختبار'`);
});
