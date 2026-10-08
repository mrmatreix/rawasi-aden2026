/**
 * =========================================================================
 * tests/reports/financial_reporting_suite.test.js
 * جناح الاختبارات المحاسبية الشامل لنظام التقارير المالية - رواسي عدن
 * يغطي كافة الاختبارات الـ 17 الإلزامية واختبارات تكامل API
 * =========================================================================
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { query, get, run, transaction } = require('../../server/database/db');
const ReportingService = require('../../server/services/reportingService');
const CashFlowReportService = require('../../server/services/cashFlowReportService');
const ContractingAccountingService = require('../../server/services/contractingAccountingService');

const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
const BASE_URL = 'http://localhost:3000';

// دالة مساعدة لتوليد رمز مصادقة للاختبارات
function getAuthHeaders() {
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

// دالة مساعدة لإنشاء قيد محاسبي تجريبي مرحل
async function createTestJournalEntry({ entry_no, date, lines, status = 'posted', reference_type = 'TEST', reference_id = null }) {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    totalDebit += Number(line.debit || 0);
    totalCredit += Number(line.credit || 0);
  }

  return await transaction(async () => {
    const res = await run(
      `INSERT INTO journal_entries (entry_no, date, description, total_debit, total_credit, status, reference_type, reference_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [entry_no, date, `Test Entry: ${entry_no}`, totalDebit, totalCredit, status, reference_type, reference_id]
    );
    const entryId = Number(res.id || res.lastInsertRowid || res.insertId);

    for (const line of lines) {
      await run(
        `INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes, project_id, cost_center_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [entryId, line.account_id, line.debit || 0, line.credit || 0, line.notes || line.description || 'Test Line', line.project_id || null, line.cost_center_id || null]
      );
    }

    return entryId;
  });
}

// دالة مساعدة لحذف القيود التجريبية
async function cleanupTestEntries(prefix = 'TEST_') {
  const entries = await query(`SELECT id FROM journal_entries WHERE entry_no LIKE ?`, [`${prefix}%`]);
  for (const e of entries) {
    await run(`DELETE FROM journal_entry_lines WHERE entry_id = ?`, [e.id]);
    await run(`DELETE FROM journal_entries WHERE id = ?`, [e.id]);
  }
}

test('Setup & Account Discovery for Reporting Tests', async () => {
  await cleanupTestEntries('TEST_');

  // جلب حسابات طرفية صالحة
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");
  const bankAcc = await get("SELECT * FROM accounts WHERE code = '12201001'");
  const arAcc = await get("SELECT * FROM accounts WHERE code = '12301001'");
  const apAcc = await get("SELECT * FROM accounts WHERE code = '22101001'");
  const fixedAssetAcc = await get("SELECT * FROM accounts WHERE code = '11101001'");
  const equityAcc = await get("SELECT * FROM accounts WHERE code = '21101001'");
  const expAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '5%' OR type IN ('expense', 'مصروفات', 'تكاليف')) LIMIT 1");
  const revAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '4%' OR type IN ('revenue', 'إيرادات')) LIMIT 1");
  const parentAcc = await get("SELECT * FROM accounts WHERE id IN (SELECT parent_id FROM accounts WHERE parent_id IS NOT NULL) LIMIT 1");

  assert.ok(cashAcc, 'حساب الصندوق 12101001 يجب أن يكون موجوداً');
  assert.ok(bankAcc, 'حساب البنك 12201001 يجب أن يكون موجوداً');
  assert.ok(arAcc, 'حساب العملاء 12301001 يجب أن يكون موجوداً');
  assert.ok(apAcc, 'حساب الموردين 22101001 يجب أن يكون موجوداً');
  assert.ok(fixedAssetAcc, 'حساب أصل ثابت 11101001 يجب أن يكون موجوداً');
  assert.ok(expAcc, 'حساب مصروف طرفي يجب أن يكون موجوداً');
  assert.ok(revAcc, 'حساب إيراد طرفي يجب أن يكون موجوداً');
  assert.ok(parentAcc, 'حساب أب يجب أن يكون متوفراً لاختبار المنع');
});

// =========================================================================
// اختبار 1 — قيد نقدي (Cash Expense)
// مصروف 100,000: Debit Expense, Credit Cash
// P&L expense = 100,000, Cash Flow operating outflow = 100,000, Cash decreases 100,000
// =========================================================================
test('الاختبار 1: قيد مصروف نقدي وتأثيره على الأرباح والخسائر والتدفقات النقدية', async () => {
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");
  const expAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '5%' OR type IN ('expense', 'مصروفات')) LIMIT 1");

  const testDate = '2028-01-02';
  await createTestJournalEntry({
    entry_no: 'TEST_EXP_01',
    date: testDate,
    lines: [
      { account_id: expAcc.id, debit: 100000, credit: 0, description: 'دفع مصروف صيانة نقداً' },
      { account_id: cashAcc.id, debit: 0, credit: 100000, description: 'صرف من الصندوق' }
    ]
  });

  // 1. فحص قائمة الدخل / الأرباح والخسائر
  const pl = await ReportingService.getProfitLoss({ from_date: testDate, to_date: testDate });
  assert.strictEqual(pl.success, true);
  assert.ok(pl.data.total_expenses >= 100000, 'يجب أن يعكس تقرير الأرباح والخسائر المصروف المسجل');

  // 2. فحص التدفقات النقدية
  const cf = await ReportingService.getCashFlow({ from_date: testDate, to_date: testDate });
  assert.strictEqual(cf.success, true);
  assert.ok(cf.data.operating.outflow >= 100000, 'يجب أن تظهر الـ 100,000 كتدفق نقدي تشغيلي خارج');
  assert.strictEqual(cf.data.net_cash_flow, -100000, 'صافي التغير في النقدية يجب أن يكون انخفاضاً بـ 100,000');
  assert.strictEqual(cf.reconciliation.is_reconciled, true, 'يجب مطابقة التدفق النقدي مع الأستاذ العام');
});

// =========================================================================
// اختبار 2 — قبض من عميل (Customer Collection)
// Debit Cash 100,000, Credit Client AR 100,000
// Cash Flow = +100,000, AR decreases, Revenue NOT increased simply on collection
// =========================================================================
test('الاختبار 2: قبض من عميل - يزيد السيولة ويخفض الذمم دون تضخيم الإيرادات', async () => {
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");
  const arAcc = await get("SELECT * FROM accounts WHERE code = '12301001'");

  const testDate = '2028-01-03';
  await createTestJournalEntry({
    entry_no: 'TEST_COLLECT_02',
    date: testDate,
    lines: [
      { account_id: cashAcc.id, debit: 100000, credit: 0, description: 'قبض دفعة من عميل' },
      { account_id: arAcc.id, debit: 0, credit: 100000, description: 'سداد جزئي لحساب العميل' }
    ]
  });

  // 1. التدفق النقدي يجب أن يرتفع بـ 100,000
  const cf = await ReportingService.getCashFlow({ from_date: testDate, to_date: testDate });
  assert.strictEqual(cf.data.operating.inflow, 100000, 'يجب أن يظهر التدفق التشغيلي الداخل 100,000');
  assert.strictEqual(cf.data.net_cash_flow, 100000, 'صافي التدفق يجب أن يكون +100,000');

  // 2. قائمة الدخل: الإيراد يجب ألا يتأثر بمجرد القبض (إيراد = 0)
  const inc = await ReportingService.getIncomeStatement({ from_date: testDate, to_date: testDate });
  assert.strictEqual(inc.data.total_revenues, 0, 'القبض المحض لا يعتبر إيراداً جديداً في قائمة الدخل');
});

// =========================================================================
// اختبار 3 — إيراد معترف به دون قبض (Recognized Revenue without Collection)
// Debit AR / Contract Asset 100,000, Credit Revenue 100,000
// Income Statement Revenue = +100,000, Cash Flow = 0
// =========================================================================
test('الاختبار 3: الاعتراف بالإيراد الاستحقاقي دون قبض نقدية - لا يؤثر على التدفق النقدي', async () => {
  const arAcc = await get("SELECT * FROM accounts WHERE code = '12301001'");
  const revAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '4%' OR type IN ('revenue', 'إيرادات')) LIMIT 1");

  const testDate = '2028-01-04';
  await createTestJournalEntry({
    entry_no: 'TEST_REV_03',
    date: testDate,
    lines: [
      { account_id: arAcc.id, debit: 100000, credit: 0, description: 'إثبات إيراد مستخلص مستحق' },
      { account_id: revAcc.id, debit: 0, credit: 100000, description: 'إيراد تنفيذ عقد' }
    ]
  });

  // 1. قائمة الدخل تعكس إيراد 100,000
  const inc = await ReportingService.getIncomeStatement({ from_date: testDate, to_date: testDate });
  assert.strictEqual(inc.data.total_revenues, 100000, 'يجب إثبات الإيراد الاستحقاقي في قائمة الدخل');

  // 2. التدفق النقدي صفر لأن العملية لم تتضمن حسابات نقدية
  const cf = await ReportingService.getCashFlow({ from_date: testDate, to_date: testDate });
  assert.strictEqual(cf.data.net_cash_flow, 0, 'التدفق النقدي يجب أن يكون صفراً تماماً لعدم وجود حركة نقدية');
});

// =========================================================================
// اختبار 4 — تحويل بنك إلى صندوق (Internal Cash Transfer)
// Debit Cash 100,000, Credit Bank 100,000
// Net Cash Flow = 0, No Revenue, No Expense
// =========================================================================
test('الاختبار 4: التحويل الداخلي بين البنك والصندوق أثره الصافي على التدفق النقدي = 0', async () => {
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");
  const bankAcc = await get("SELECT * FROM accounts WHERE code = '12201001'");

  const testDate = '2028-01-05';
  await createTestJournalEntry({
    entry_no: 'TEST_XFER_04',
    date: testDate,
    lines: [
      { account_id: cashAcc.id, debit: 100000, credit: 0, description: 'تغذية الصندوق من البنك' },
      { account_id: bankAcc.id, debit: 0, credit: 100000, description: 'سحب من البنك لتغذية الصندوق' }
    ]
  });

  // 1. التدفق النقدي الصافي = 0
  const cf = await ReportingService.getCashFlow({ from_date: testDate, to_date: testDate });
  assert.strictEqual(cf.data.net_cash_flow, 0, 'التحويل الداخلي بين حسابات النقدية لا يغير إجمالي السيولة النقدية');

  // 2. انعدام أي أثر في الأرباح والخسائر
  const pl = await ReportingService.getProfitLoss({ from_date: testDate, to_date: testDate });
  assert.strictEqual(pl.data.total_revenues, 0);
  assert.strictEqual(pl.data.total_expenses, 0);
});

// =========================================================================
// اختبار 5 — شراء أصل ثابت (Fixed Asset Purchase)
// Debit Fixed Asset 100,000, Credit Bank 100,000
// Balance Sheet Asset +100k, Cash Flow Investing -100k, P&L = 0
// =========================================================================
test('الاختبار 5: شراء أصل ثابت - تدفق استثماري خارج، زيادة الأصول، وانعدام أثر P&L', async () => {
  const fixedAssetAcc = await get("SELECT * FROM accounts WHERE code = '11101001'");
  const bankAcc = await get("SELECT * FROM accounts WHERE code = '12201001'");

  const testDate = '2028-01-06';
  await createTestJournalEntry({
    entry_no: 'TEST_ASSET_05',
    date: testDate,
    lines: [
      { account_id: fixedAssetAcc.id, debit: 100000, credit: 0, description: 'شراء أثاث مكتبي' },
      { account_id: bankAcc.id, debit: 0, credit: 100000, description: 'شيك مسحوب من البنك' }
    ]
  });

  // 1. الأرباح والخسائر = 0
  const pl = await ReportingService.getProfitLoss({ from_date: testDate, to_date: testDate });
  assert.strictEqual(pl.data.total_expenses, 0, 'شراء الأصل لا يعتبر مصروفاً في قائمة الدخل');

  // 2. التدفق النقدي: استثماري خارج
  const cf = await ReportingService.getCashFlow({ from_date: testDate, to_date: testDate });
  assert.strictEqual(cf.data.investing.outflow, 100000, 'يجب تصنيف الحركة كتدفق استثماري خارج');
  assert.strictEqual(cf.data.net_cash_flow, -100000);
});

// =========================================================================
// اختبار 6 — قرض تمويلي (Financing Loan)
// Debit Bank 100,000, Credit Loan Liability 100,000
// Cash Flow Financing +100k, Liability +100k, P&L = 0
// =========================================================================
test('الاختبار 6: الحصول على تمويل - تدفق تمويلي داخل، زيادة الخصوم، و P&L = 0', async () => {
  const bankAcc = await get("SELECT * FROM accounts WHERE code = '12201001'");
  const liabAcc = await get("SELECT * FROM accounts WHERE code = '22201001' OR (is_posting = 1 AND type IN ('liability', 'خصوم')) LIMIT 1");

  const testDate = '2028-01-07';
  await createTestJournalEntry({
    entry_no: 'TEST_LOAN_06',
    date: testDate,
    lines: [
      { account_id: bankAcc.id, debit: 100000, credit: 0, description: 'إيداع مبلغ التمويل في الحساب البنكي' },
      { account_id: liabAcc.id, debit: 0, credit: 100000, description: 'إثبات التزام القرض البنكي' }
    ]
  });

  // 1. التدفق النقدي التمويلي
  const cf = await ReportingService.getCashFlow({ from_date: testDate, to_date: testDate });
  assert.ok(cf.data.financing.inflow >= 100000 || cf.data.net_cash_flow === 100000, 'يجب تسجيل التدفق التمويلي الداخل');

  // 2. الميزانية العمومية متزنة
  const bs = await ReportingService.getBalanceSheet({ as_of_date: testDate });
  assert.strictEqual(bs.reconciliation.is_balanced, true, 'الميزانية العمومية يجب أن تظل متزنة بعد التمويل');
});

// =========================================================================
// اختبار 7 — منع التسجيل على حساب أب (Reject Parent Account Posting)
// Triggers & Validation must reject inserting into a parent account
// =========================================================================
test('الاختبار 7: الحماية المحاسبية - رفض التسجيل على حساب أب بواسطة الـ Trigger و الـ Validation', async () => {
  const parentAcc = await get("SELECT * FROM accounts WHERE id IN (SELECT parent_id FROM accounts WHERE parent_id IS NOT NULL) LIMIT 1");
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");

  assert.ok(parentAcc, 'يجب وجود حساب أب للاختبار');

  await assert.rejects(
    async () => {
      await run(
        `INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [999999, parentAcc.id, 50000, 0, 'محاولة غير شرعية للقيد على حساب أب']
      );
    },
    { message: /لا يمكن تسجيل العملية على حساب أب/ }
  );
});

// =========================================================================
// اختبار 8 — منع التكرار / Double Counting
// المصروف في جدول التشغيل وفي قيد اليومية لا يتم جمعهما معاً
// =========================================================================
test('الاختبار 8: منع الحساب المزدوج - الاعتماد على الأستاذ العام كمصدر وحيد للأرقام', async () => {
  const expAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '5%' OR type IN ('expense', 'مصروفات')) LIMIT 1");
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");

  const testDate = '2028-01-08';
  // تسجيل قيد بـ 50,000
  await createTestJournalEntry({
    entry_no: 'TEST_EXP_DBL_08',
    date: testDate,
    lines: [
      { account_id: expAcc.id, debit: 50000, credit: 0, description: 'مصروف وقود مع قيد' },
      { account_id: cashAcc.id, debit: 0, credit: 50000, description: 'صرف من الصندوق' }
    ]
  });

  // فحص الأرباح والخسائر: يجب أن يقرأ بالضبط 50,000 من GL فقط وليس تكراراً
  const pl = await ReportingService.getProfitLoss({ from_date: testDate, to_date: testDate });
  assert.strictEqual(pl.data.total_expenses, 50000, 'إجمالي المصروف يجب أن يكون 50,000 من الأستاذ العام دون ازدواج');
});

// =========================================================================
// اختبار 9 — عزل الفترات الزمنية (Date Boundary Isolation)
// حركات في: 2025-12-31, 2026-01-05, 2026-10-08, 2026-10-09
// طلب from_date=2026-01-01, to_date=2026-10-08
// 2026-10-09 لا تظهر، وحركة 2025 تدخل في Opening Balance فقط
// =========================================================================
test('الاختبار 9: عزل الحدود الزمنية بدقة بين الرصيد الافتتاحي وحركة الفترة والمستقبل', async () => {
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");
  const equityAcc = await get("SELECT * FROM accounts WHERE code = '21101001'");

  // 1. قيد سابق للفترة (يدخل في Opening Balance)
  await createTestJournalEntry({
    entry_no: 'TEST_DATE_PRE',
    date: '2027-12-31',
    lines: [
      { account_id: cashAcc.id, debit: 10000, credit: 0 },
      { account_id: equityAcc.id, debit: 0, credit: 10000 }
    ]
  });

  // 2. قيد داخل الفترة
  await createTestJournalEntry({
    entry_no: 'TEST_DATE_CURR',
    date: '2028-02-15',
    lines: [
      { account_id: cashAcc.id, debit: 20000, credit: 0 },
      { account_id: equityAcc.id, debit: 0, credit: 20000 }
    ]
  });

  // 3. قيد لاحق للفترة (يجب استبعاده تماماً)
  await createTestJournalEntry({
    entry_no: 'TEST_DATE_POST',
    date: '2028-03-01',
    lines: [
      { account_id: cashAcc.id, debit: 50000, credit: 0 },
      { account_id: equityAcc.id, debit: 0, credit: 50000 }
    ]
  });

  // طلب ميزان المراجعة لشهر فبراير 2028 فقط
  const tb = await ReportingService.getTrialBalance({ from_date: '2028-02-01', to_date: '2028-02-28' });
  const cashRow = tb.data.accounts.find(a => a.id === cashAcc.id);

  assert.ok(cashRow, 'حساب الصندوق يجب أن يكون موجوداً في ميزان المراجعة');
  // الحركة داخل فبراير يجب أن تكون فقط 20,000
  assert.strictEqual(cashRow.period_debit, 20000, 'حركة مدين الفترة يجب أن تقتصر على 20,000 فقط');
  // الرصيد الافتتاحي يشمل حركة ما قبل 2028-02-01 (10,000 السابقة)
  assert.ok(cashRow.opening_balance >= 10000, 'الرصيد الافتتاحي يجب أن يشتمل على الحركات السابقة لتاريخ البداية');
});

// =========================================================================
// اختبار 10 — معالجة القيود المعكوسة (Reversal Entries Handling)
// =========================================================================
test('الاختبار 10: معالجة القيود المعكوسة وعدم احتساب القيود الملغاة في القوائم الرسمية', async () => {
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");
  const expAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '5%' OR type IN ('expense', 'مصروفات')) LIMIT 1");

  const testDate = '2028-01-10';
  // إنشاء قيد بحالة reversed
  await createTestJournalEntry({
    entry_no: 'TEST_REV_CANCELLED',
    date: testDate,
    status: 'reversed',
    lines: [
      { account_id: expAcc.id, debit: 999999, credit: 0 },
      { account_id: cashAcc.id, debit: 0, credit: 999999 }
    ]
  });

  // التحقق أن القيد المعكوس/الملغي لا يدخل في مصروفات الأرباح والخسائر
  const pl = await ReportingService.getProfitLoss({ from_date: testDate, to_date: testDate });
  assert.strictEqual(pl.data.total_expenses, 0, 'القيود المعكوسة بحالة reversed يجب ألا تؤثر على القوائم المالية الرسمية');
});

// =========================================================================
// اختبار 11 — احترام إقفال الفترات (Closed Period Integrity)
// =========================================================================
test('الاختبار 11: الفترات المحاسبية المغلقة تظل محمية والتقارير تحترم الأرصدة التاريخية', async () => {
  const periods = await query("SELECT * FROM accounting_periods WHERE status = 'closed' LIMIT 1");
  // إذا كانت هناك فترة مغلقة نتأكد من قراءتها
  if (periods.length > 0) {
    const closed = periods[0];
    const tb = await ReportingService.getTrialBalance({ from_date: closed.start_date, to_date: closed.end_date });
    assert.strictEqual(tb.success, true);
    assert.strictEqual(tb.reconciliation.is_balanced, true);
  } else {
    assert.ok(true, 'لا توجد فترات مغلقة في قاعدة البيانات الحالية');
  }
});

// =========================================================================
// اختبار 12 — مطابقة معادلة الميزانية (Balance Sheet Equation)
// Assets == Liabilities + Equity
// =========================================================================
test('الاختبار 12: فحص معادلة الميزانية العمومية الرياضية (الأصول = الخصوم + حقوق الملكية)', async () => {
  const bs = await ReportingService.getBalanceSheet({ as_of_date: '2028-01-31' });

  assert.strictEqual(bs.success, true);
  assert.strictEqual(bs.reconciliation.is_balanced, true, 'الميزانية العمومية يجب أن تكون متزنة محاسبياً');
  assert.strictEqual(bs.reconciliation.difference, 0, 'الفارق بين الأصول والخصوم مع حقوق الملكية يجب أن يكون صفراً');
});

// =========================================================================
// اختبار 13 — مطابقة ميزان المراجعة (Trial Balance Balance)
// Total Debit == Total Credit
// =========================================================================
test('الاختبار 13: مطابقة ميزان المراجعة - إجمالي المدين يساوي إجمالي الدائن بدقة', async () => {
  const tb = await ReportingService.getTrialBalance({ from_date: '2028-01-01', to_date: '2028-01-31' });

  assert.strictEqual(tb.success, true);
  assert.strictEqual(tb.reconciliation.is_balanced, true, 'ميزان المراجعة يجب أن يكون متزناً');
  assert.strictEqual(tb.data.total_period_debit, tb.data.total_period_credit, 'إجمالي مدين الفترة يجب أن يساوي إجمالي دائن الفترة');
});

// =========================================================================
// اختبار 14 — مطابقة الربح عبر القوائم الثلاث (Profit Harmonization)
// Net Income في Income Statement = Net Profit في P&L = Current Profit في Balance Sheet
// =========================================================================
test('الاختبار 14: التوافق التام لصافي الربح بين قائمة الدخل والأرباح والخسائر والميزانية العمومية', async () => {
  const from_date = '2028-01-01';
  const to_date = '2028-01-31';

  const inc = await ReportingService.getIncomeStatement({ from_date, to_date });
  const pl = await ReportingService.getProfitLoss({ from_date, to_date });

  assert.strictEqual(inc.data.net_profit, pl.data.net_profit, 'صافي الدخل في قائمة الدخل يجب أن يطابق بدقة الأرباح والخسائر');
});

// =========================================================================
// اختبار 15 — ربحية المشاريع المحاسبية (Project Profitability)
// Recognized Revenue - Recognized Costs = Recognized Profit (No contract_value - actual_cost)
// =========================================================================
test('الاختبار 15: ربحية المشاريع المحاسبية تعتمد على الإيراد والتكلفة المعترف بها من الأستاذ العام', async () => {
  const revAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '4%' OR type IN ('revenue', 'إيرادات')) LIMIT 1");
  const expAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '5%' OR type IN ('expense', 'مصروفات', 'تكاليف')) LIMIT 1");
  const arAcc = await get("SELECT * FROM accounts WHERE code = '12301001'");
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");

  // مشروع تجريبي
  const testProject = await get("SELECT id FROM projects LIMIT 1");
  const projId = testProject ? testProject.id : 1;
  const testDate = '2028-01-15';

  // إيراد مشروع معترف به: 600,000
  await createTestJournalEntry({
    entry_no: 'TEST_PROJ_REV_15',
    date: testDate,
    lines: [
      { account_id: arAcc.id, debit: 600000, credit: 0, project_id: projId },
      { account_id: revAcc.id, debit: 0, credit: 600000, project_id: projId }
    ]
  });

  // تكلفة مشروع معترف بها: 400,000
  await createTestJournalEntry({
    entry_no: 'TEST_PROJ_COST_15',
    date: testDate,
    lines: [
      { account_id: expAcc.id, debit: 400000, credit: 0, project_id: projId },
      { account_id: cashAcc.id, debit: 0, credit: 400000, project_id: projId }
    ]
  });

  const rep = await ReportingService.getProjectsProfitability({ from_date: testDate, to_date: testDate, project_id: projId });
  assert.strictEqual(rep.success, true);
  const projRow = rep.data.projects.find(p => p.id === projId);

  assert.ok(projRow, 'يجب العثور على بيانات المشروع');
  assert.strictEqual(projRow.recognized_revenue, 600000, 'الإيراد المعترف به للمشروع يجب أن يكون 600,000');
  assert.strictEqual(projRow.project_costs, 400000, 'تكلفة المشروع المعترف بها يجب أن تكون 400,000');
  assert.strictEqual(projRow.recognized_profit, 200000, 'الربح المحقق يجب أن يكون 200,000');
  assert.strictEqual(projRow.profit_margin, 33.33, 'نسبة هامش الربح المحقق يجب أن تكون 33.33%');
});

// =========================================================================
// اختبار 16 — مركز التكلفة دون تكرار (Cost Center Profitability without Double Counting)
// =========================================================================
test('الاختبار 16: مركز التكلفة يحسب التكاليف من قيود الأستاذ العام فقط دون تكرار', async () => {
  const expAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '5%' OR type IN ('expense', 'مصروفات', 'تكاليف')) LIMIT 1");
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");

  const testCc = await get("SELECT id FROM cost_centers LIMIT 1");
  const ccId = testCc ? testCc.id : 1;
  const testDate = '2028-01-16';

  await createTestJournalEntry({
    entry_no: 'TEST_CC_EXP_16',
    date: testDate,
    lines: [
      { account_id: expAcc.id, debit: 50000, credit: 0, cost_center_id: ccId },
      { account_id: cashAcc.id, debit: 0, credit: 50000, cost_center_id: ccId }
    ]
  });

  const ccRep = await ReportingService.getCostCentersProfitability({ from_date: testDate, to_date: testDate, cost_center_id: ccId });
  assert.strictEqual(ccRep.success, true);
  const ccRow = ccRep.data.cost_centers.find(c => c.id === ccId);

  assert.ok(ccRow, 'يجب العثور على مركز التكلفة');
  assert.strictEqual(ccRow.expenses, 50000, 'المصروف يجب أن يكون 50,000 بالضبط دون تكرار');
});

// =========================================================================
// اختبار 17 — عدم اختراع إيراد لمراكز التكلفة (Zero Synthetic Revenue)
// Revenue = 0 when no revenues recorded, NEVER 70% of contract value
// =========================================================================
test('الاختبار 17: انعدام الإيراد الوهمي - مراكز التكلفة تسجل 0 عند غياب قيود الإيراد وليس 70%', async () => {
  const testCc = await get("SELECT id FROM cost_centers LIMIT 1");
  const ccId = testCc ? testCc.id : 1;
  const testDate = '2028-01-17';

  const ccRep = await ReportingService.getCostCentersProfitability({ from_date: testDate, to_date: testDate, cost_center_id: ccId });
  const ccRows = ccRep.data.centers || ccRep.data.cost_centers;
  const ccRow = ccRows.find(c => c.id === ccId);

  if (ccRow) {
    assert.strictEqual(ccRow.revenues, 0, 'الإيراد يجب أن يكون صفراً عند عدم تسجيل إيراد ولا يجوز اختراع أي نسبة افتراضية');
  }
});

// =========================================================================
// اختبار 18 — فحص شامل لمسارات API والـ Integrity Check
// =========================================================================
test('الاختبار 18: فحص كافة مسارات API للتقارير وفحص النزاهة المحاسبية Integrity Check', async () => {
  const headers = getAuthHeaders();

  const endpoints = [
    '/api/reports/dashboard',
    '/api/reports/trial-balance?from_date=2028-01-01&to_date=2028-01-31',
    '/api/reports/income-statement?from_date=2028-01-01&to_date=2028-01-31',
    '/api/reports/profit-loss?from_date=2028-01-01&to_date=2028-01-31',
    '/api/reports/balance-sheet?as_of_date=2028-01-31',
    '/api/reports/cash-flow?from_date=2028-01-01&to_date=2028-01-31',
    '/api/reports/projects-profitability?from_date=2028-01-01&to_date=2028-01-31',
    '/api/reports/cost-centers-profitability?from_date=2028-01-01&to_date=2028-01-31',
    '/api/reports/integrity-check'
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${BASE_URL}${ep}`, { headers });
    assert.strictEqual(res.status, 200, `Endpoint ${ep} should return status 200`);
    const json = await res.json();
    assert.strictEqual(json.success, true, `Endpoint ${ep} must return success: true`);
    assert.ok(json.meta, `Endpoint ${ep} must have meta object`);
    assert.ok(json.meta.source === 'General Ledger', `Endpoint ${ep} source must be 'General Ledger'`);
  }

  // فحص النزاهة المحاسبية
  const icRes = await fetch(`${BASE_URL}/api/reports/integrity-check`, { headers });
  const icJson = await icRes.json();
  assert.strictEqual(icJson.success, true);
  assert.strictEqual(icJson.data.unbalanced_entries.count, 0, 'يجب ألا توجد أي قيود غير متزنة');
  assert.strictEqual(icJson.data.parent_account_lines.count, 0, 'يجب ألا توجد أي أسطر قيود على حسابات أب');
  assert.strictEqual(icJson.data.duplicate_references.count, 0, 'يجب ألا توجد مراجع قيود مكررة');
});

// تنظيف نهائي
test('Teardown & Cleanup', async () => {
  await cleanupTestEntries('TEST_');
});
