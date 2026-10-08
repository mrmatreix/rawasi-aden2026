/**
 * اختبار إصلاح التقارير المالية (Suggestion-3)
 * ============================================================================
 * - ميزان المراجعة: القيود المرحّلة فقط (المسودة مستبعدة حتى ترحيلها).
 * - الميزانية: أرصدة محسوبة حيّة (as_of) + معادلة تربيع بفارق ثابت أمام القيود المتزنة.
 * - قائمة الدخل: فلاتر الحالات والفترة + مجمل حقيقي + صفر وهميات (مساواة تامة).
 * الفترة 2030-06 معزولة تماماً (لا بيانات فيها قبل الاختبار).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('Financial Reports - Posted-only TB, Live BS, Honest IS', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'fin-reports-test-csrf-token-1234567890123456789012345678901';
  const testerId = 7203;
  const PROJECT_NAME = 'TEST-FINREP مشروع اختبار التقارير المالية';
  const P_FROM = '2030-06-01';
  const P_TO = '2030-06-30';
  const JE_DATE = '2030-06-15';
  const JE_AMOUNT = 50000;

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt.sign(
      { id: testerId, username: 'fin_reports_tester', role: 'admin', permissions: ['*'] },
      JWT_SECRET,
      { expiresIn: '1h' }
    ),
    'X-CSRF-Token': csrfToken,
    'X-Requested-With': 'XMLHttpRequest',
    'Connection': 'close'
  };

  const api = async (method, path, body = null) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: adminHeaders,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };

  // تنظيف معزول (2030 + أسماء الاختبار فقط) — استباقي + تلقائي عند الخروج
  const cleanup = async () => {
    await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE date LIKE '2030%')`);
    await db.run(`DELETE FROM journal_entries WHERE date LIKE '2030%'`);
    await db.run(`DELETE FROM expenses WHERE date LIKE '2030%'`);
    await db.run(`DELETE FROM payments WHERE date LIKE '2030%'`);
    await db.run(`DELETE FROM payroll WHERE paid_date LIKE '2030%' OR payroll_month LIKE '2030%'`);
    await db.run(`DELETE FROM cash_movements WHERE date LIKE '2030%' OR project_id IN (SELECT id FROM projects WHERE name = ?)`, [PROJECT_NAME]);
    await db.run('DELETE FROM projects WHERE name = ?', [PROJECT_NAME]);
    await db.run('DELETE FROM users WHERE id = ?', [testerId]);
    await db.run(`DELETE FROM employees WHERE employee_no = 'TEST-FINREP-001'`);
  };
  t.after(() => cleanup().catch(() => {}));
  await cleanup();

  // إعداد: مستخدم الاختبار + معرفات الحسابات + مشروع الاختبار
  const passwordHash = await bcrypt.hash('test123', 4);
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'fin_reports_tester', ?, 'admin', 'مختبِر التقارير', 'active', '["*"]')`,
    [testerId, passwordHash]
  );
  const accCash = await db.get("SELECT id FROM accounts WHERE code = '111'");
  const accCustody = await db.get("SELECT id FROM accounts WHERE code = '114'");
  assert.ok(accCash && accCustody, 'حسابات الاختبار موجودة');

  let r = await api('POST', '/api/projects', {
    code: 'TEST-FINREP-2030', name: PROJECT_NAME, contract_value: 1000000,
    status: 'active', start_date: P_FROM
  });
  assert.strictEqual(r.status, 200, 'إنشاء المشروع: ' + JSON.stringify(r.data));
  const projectId = r.data.data.id;

  // 1. خط أساس لميزان المراجعة الكامل
  r = await api('GET', '/api/reports/trial-balance');
  assert.strictEqual(r.status, 200);
  const tbBase = r.data.data.totals;
  assert.strictEqual(r.data.data.filters.posted_only, true, 'التقرير يعلن المرحّلة فقط');

  // خط أساس لافتتاحي يوليو (للحساب 114 حركة قديمة مرحّلة)
  r = await api('GET', '/api/reports/trial-balance?from_date=2030-07-01&to_date=2030-07-31');
  assert.strictEqual(r.status, 200);
  const julyBase114 = Number(r.data.data.accounts.find(a => a.code === '114').opening_debit);

  // 2. قيد مسودة ← لا يظهر في الميزان
  r = await api('POST', '/api/accounting/journal-entries', {
    date: JE_DATE, description: 'TEST-FINREP قيد مسودة مستبعد', status: 'draft',
    lines: [
      { account_id: accCustody.id, debit: JE_AMOUNT, credit: 0 },
      { account_id: accCash.id, debit: 0, credit: JE_AMOUNT }
    ]
  });
  assert.strictEqual(r.status, 200, 'إنشاء المسودة: ' + JSON.stringify(r.data));
  const jeId = r.data.id;
  assert.strictEqual(r.data.status, 'draft');

  r = await api('GET', '/api/reports/trial-balance');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.data.totals.total_debit, tbBase.total_debit, 'المسودة لا ترفع المدين');
  assert.strictEqual(r.data.data.totals.total_credit, tbBase.total_credit, 'المسودة لا ترفع الدائن');

  // 3. ترحيل القيد ← يظهر بدلتا مطابقة تماماً
  r = await api('POST', `/api/accounting/journal-entries/${jeId}/post`);
  assert.strictEqual(r.status, 200, 'الترحيل: ' + JSON.stringify(r.data));

  r = await api('GET', '/api/reports/trial-balance');
  assert.strictEqual(r.data.data.totals.total_debit, tbBase.total_debit + JE_AMOUNT, 'دلتا المدين = 50k');
  assert.strictEqual(r.data.data.totals.total_credit, tbBase.total_credit + JE_AMOUNT, 'دلتا الدائن = 50k');

  // 4. افتتاحية ما قبل الفترة: من 2030-07 لا حركة في الفترة لكن الافتتاحي يحمل الـ50k
  r = await api('GET', '/api/reports/trial-balance?from_date=2030-07-01&to_date=2030-07-31');
  assert.strictEqual(r.status, 200);
  const custodyRow = r.data.data.accounts.find(a => a.code === '114');
  assert.ok(custodyRow, 'صف حساب 114 موجود');
  assert.strictEqual(
    Number(custodyRow.opening_debit), julyBase114 + JE_AMOUNT,
    'افتتاحي 114 يحمل حركة ما قبل الفترة بدلتا مطابقة'
  );

  // 5. الميزانية: فارق التربيع ثابت أمام قيد متزن + حيّة بتاريخ as_of
  r = await api('GET', '/api/reports/balance-sheet?as_of=2030-06-14');
  assert.strictEqual(r.status, 200);
  const bsBefore = r.data.data;
  r = await api('GET', '/api/reports/balance-sheet?as_of=2030-06-30');
  assert.strictEqual(r.status, 200);
  const bsAfter = r.data.data;
  assert.strictEqual(
    bsAfter.totals.difference, bsBefore.totals.difference,
    'قيد متزن لا يغيّر فارق التربيع'
  );
  const cashBefore = bsBefore.assets.find(a => a.code === '111');
  const cashAfter = bsAfter.assets.find(a => a.code === '111');
  assert.strictEqual(
    Number(cashBefore.balance) - Number(cashAfter.balance), JE_AMOUNT,
    'رصيد الصندوق حي ويستجيب لتاريخ as_of (دائن 50k)'
  );

  // 6. قائمة الدخل في الفترة المعزولة: مساواة تامة (لا بدائل وهمية)
  r = await api('POST', '/api/expenses', {
    expense_type: 'مواد بناء', project_id: projectId, amount: 20000,
    payment_method: 'نقدي', date: '2030-06-10'
  });
  assert.strictEqual(r.status, 200, 'مصروف مباشر: ' + JSON.stringify(r.data));

  r = await api('POST', '/api/expenses', {
    expense_type: 'مصروفات إدارية', amount: 5000,
    payment_method: 'نقدي', date: '2030-06-11'
  });
  assert.strictEqual(r.status, 200, 'مصروف عام: ' + JSON.stringify(r.data));

  r = await api('POST', '/api/expenses', {
    expense_type: 'مسودة مستبعدة', amount: 999999,
    payment_method: 'نقدي', date: '2030-06-12', status: 'draft'
  });
  assert.strictEqual(r.status, 200, 'مسودة مصروف: ' + JSON.stringify(r.data));

  r = await api('POST', '/api/payments', {
    type: 'قبض', project_id: projectId, amount: 100000,
    payment_method: 'نقدي', date: '2030-06-12', notes: 'TEST-FINREP قبض'
  });
  assert.strictEqual(r.status, 200, 'سند قبض: ' + JSON.stringify(r.data));

  await db.run(`INSERT OR IGNORE INTO employees (employee_no, full_name, job_title, basic_salary, status)
    VALUES ('TEST-FINREP-001', 'موظف اختبار التقارير', 'محاسب', 30000, 'active')`);
  const emp = await db.get(`SELECT id FROM employees WHERE employee_no = 'TEST-FINREP-001'`);
  await db.run(
    `INSERT INTO payroll (employee_id, payroll_month, basic_salary, net_salary, status, paid_date)
     VALUES (?, '2030-06', 30000, 30000, 'paid', '2030-06-20')`,
    [emp.id]
  );

  r = await api('GET', `/api/reports/income-statement?from_date=${P_FROM}&to_date=${P_TO}`);
  assert.strictEqual(r.status, 200);
  const is = r.data.data;
  assert.strictEqual(is.total_revenues, 100000, 'الإيراد = القبض المرحّل فقط');
  assert.strictEqual(is.direct_costs, 20000, 'المباشر = مصروف المشروع فقط');
  assert.strictEqual(is.gross_profit, 80000, 'المجمل الحقيقي 100k−20k');
  assert.strictEqual(is.total_expenses, 55000, 'الإجمالي = 20k+5k+رواتب 30k (المسودة مستبعدة)');
  assert.strictEqual(is.net_profit, 45000, 'الصافي 100k−55k');

  // 7. تنظيف نهائي (التلقائي عند الخروج يغطي حالات الفشل أيضاً)
  await cleanup();
});
