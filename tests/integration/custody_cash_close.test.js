/**
 * اختبار العهد والصناديق والإقفال (Suggestion-4)
 * ============================================================================
 * - صرف العهدة: قيد Dr114/Cr111 + حركة بصندوق المشروع + لا شيء للتصفية نقداً.
 * - التصفية: قيد Dr5/Cr114 + وراثة الصندوق + رفض حساب وهمي.
 * - السلف: إصلاح الأعمدة + قيد + صندوق رئيسي.
 * - الصناديق: سلاسل مستقلة تبدأ من الصفر + اللوحة = مجموع الصناديق.
 * - الاسترداد: ترحيل الرواتب يطبق الأقساط فعلياً (لا تكرار) + حركة بالصافي.
 * - الإقفال السنوي: قيد متزن + تصفير النتيجة + قفل + رفض التكرار.
 * التواريخ 2031-01/02 و2031-06 معزولة تماماً.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('Custody Cash Close - JE Links, Cash Boxes, Year Close', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'custody-test-csrf-token-12345678901234567890123456789012';
  const testerId = 7204;
  const PROJ_A = 'TEST-BOX-A مشروع صندوق أ';
  const PROJ_B = 'TEST-BOX-B مشروع صندوق ب';

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt.sign(
      { id: testerId, username: 'custody_tester', role: 'admin', permissions: ['*'] },
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

  // تنظيف معزول (2031 + أسماء الاختبار) — استباقي + تلقائي عند الخروج
  // ترتيب FK آمن: السطور ← الأبناء (عهد/سلف/مصروف/قبض/مسير) ← الموظف ← القيود ← الصندوق ← المشاريع ← المستخدم
  // (صفوف الصندوق المعزولة بالتاريخ/المشروع تُحذف — ذيل معزول زمنياً، لا يكسر سلاسل حقيقية)
  const cleanup = async () => {
    await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE date LIKE '2031%' OR description LIKE '%2031-02%')`);
    await db.run(`DELETE FROM custodies WHERE date LIKE '2031%'`);
    await db.run(`DELETE FROM employee_advances WHERE date LIKE '2031%'`);
    await db.run(`DELETE FROM expenses WHERE date LIKE '2031%'`);
    await db.run(`DELETE FROM payments WHERE date LIKE '2031%'`);
    await db.run(`DELETE FROM payroll WHERE payroll_month LIKE '2031%'`);
    await db.run(`DELETE FROM employees WHERE employee_no = 'TEST-CUST-001'`);
    await db.run(`DELETE FROM journal_entries WHERE date LIKE '2031%' OR description LIKE '%2031-02%'`);
    await db.run(`DELETE FROM cash_movements WHERE date LIKE '2031%' OR notes LIKE '%2031-02%' OR project_id IN (SELECT id FROM projects WHERE name IN (?, ?))`, [PROJ_A, PROJ_B]);
    await db.run(`DELETE FROM accounting_periods WHERE fiscal_year = 2031`);
    await db.run('DELETE FROM projects WHERE name IN (?, ?)', [PROJ_A, PROJ_B]);
    await db.run('DELETE FROM users WHERE id = ?', [testerId]);
  };
  t.after(() => cleanup().catch(() => {}));
  await cleanup();

  // إعداد
  const passwordHash = await bcrypt.hash('test123', 4);
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'custody_tester', ?, 'admin', 'مختبِر العهد', 'active', '["*"]')`,
    [testerId, passwordHash]
  );
  await db.run(`INSERT OR IGNORE INTO employees (employee_no, full_name, job_title, department, basic_salary, status)
    VALUES ('TEST-CUST-001', 'موظف اختبار العهد', 'مهندس موقع', 'المشاريع', 150000, 'active')`);
  const emp = await db.get(`SELECT id FROM employees WHERE employee_no = 'TEST-CUST-001'`);

  const acc = async (code) => (await db.get('SELECT id FROM accounts WHERE code = ?', [code])).id;
  const acc111 = await acc('111');
  const acc114 = await acc('114');
  const acc5 = await acc('5');
  const acc4101 = await acc('4101');
  const acc511 = await acc('511');

  let r = await api('POST', '/api/projects', {
    code: 'TEST-BOX-A', name: PROJ_A, contract_value: 500000, status: 'active', start_date: '2031-01-01'
  });
  assert.strictEqual(r.status, 200, 'مشروع أ: ' + JSON.stringify(r.data));
  const projA = r.data.data.id;
  r = await api('POST', '/api/projects', {
    code: 'TEST-BOX-B', name: PROJ_B, contract_value: 500000, status: 'active', start_date: '2031-01-01'
  });
  assert.strictEqual(r.status, 200, 'مشروع ب: ' + JSON.stringify(r.data));
  const projB = r.data.data.id;

  // أعلى معرف نقدي قبل كل عملية (صفوف الصندوق لا تُحذف — النطاق يمنع التقاط البقايا)
  const maxCashId = async () => (await db.get('SELECT COALESCE(MAX(id), 0) as m FROM cash_movements')).m;

  // 1. صرف عهدة على المشروع أ ← قيد + صندوق المشروع
  const cashBeforeDisb = await maxCashId();
  r = await api('POST', '/api/accounting/custodies', {
    operation_type: 'صرف عهدة', employee_id: emp.id, project_id: projA,
    total_amount: 30000, date: '2031-01-10', notes: 'TEST عهدة صندوق أ'
  });
  assert.strictEqual(r.status, 200, 'صرف العهدة: ' + JSON.stringify(r.data));
  assert.ok(r.data.journal_entry_id, 'الصرف يرجع قيداً');
  const custodyId = r.data.id;
  const custodyNo = r.data.custody_no;

  const jeDisb = await db.get('SELECT * FROM journal_entries WHERE id = ?', [r.data.journal_entry_id]);
  assert.strictEqual(jeDisb.status, 'posted', 'قيد الصرف مرحّل');
  const linesDisb = await db.query('SELECT account_id, debit, credit, project_id FROM journal_entry_lines WHERE entry_id = ?', [jeDisb.id]);
  const dr114 = linesDisb.find(l => l.account_id === acc114);
  const cr111 = linesDisb.find(l => l.account_id === acc111);
  assert.ok(dr114 && Number(dr114.debit) === 30000, 'مدين 114 بالمبلغ');
  assert.ok(cr111 && Number(cr111.credit) === 30000, 'دائن 111 بالمبلغ');
  assert.strictEqual(Number(dr114.project_id), projA, 'القيد على المشروع أ');

  const cashA = await db.query('SELECT * FROM cash_movements WHERE id > ? AND notes LIKE ?', [cashBeforeDisb, `%${custodyNo}%`]);
  assert.strictEqual(cashA.length, 1, 'حركة صندوق واحدة للصرف');
  assert.strictEqual(Number(cashA[0].project_id), projA, 'الحركة في صندوق المشروع أ');
  assert.strictEqual(Number(cashA[0].previous_balance), 0, 'الصندوق الجديد يبدأ من الصفر');
  assert.strictEqual(Number(cashA[0].current_balance), -30000, 'رصيد الصندوق أ = -30k');

  // 2. تصفية جزئية ← قيد مصروف + لا حركة صندوق + وراثة المشروع
  r = await api('POST', '/api/accounting/custodies', {
    operation_type: 'تصفية عهدة', related_custody_id: custodyId, employee_id: emp.id,
    expense_account_id: 999999, spent_amount: 12000, date: '2031-01-15'
  });
  assert.strictEqual(r.status, 400, 'حساب المصروف الوهمي مرفوض');

  r = await api('POST', '/api/accounting/custodies', {
    operation_type: 'تصفية عهدة', related_custody_id: custodyId, employee_id: emp.id,
    expense_account_id: acc5, spent_amount: 12000, date: '2031-01-15'
  });
  assert.strictEqual(r.status, 200, 'التصفية: ' + JSON.stringify(r.data));
  assert.ok(r.data.journal_entry_id, 'التصفية ترجع قيداً');
  const settleNo = r.data.custody_no;

  const linesStl = await db.query('SELECT account_id, debit, credit, project_id FROM journal_entry_lines WHERE entry_id = ?', [r.data.journal_entry_id]);
  assert.ok(linesStl.find(l => l.account_id === acc5 && Number(l.debit) === 12000), 'مدين المصروف 5');
  assert.ok(linesStl.find(l => l.account_id === acc114 && Number(l.credit) === 12000), 'دائن العهد 114');
  assert.strictEqual(Number(linesStl[0].project_id), projA, 'التصفية ورثت المشروع أ');

  const cashStl = await db.query('SELECT id FROM cash_movements WHERE notes LIKE ?', [`%${settleNo}%`]);
  assert.strictEqual(cashStl.length, 0, 'التصفية بلا حركة صندوق (النقد خرج عند الصرف)');
  const origAfter = await db.get('SELECT remaining_amount, status FROM custodies WHERE id = ?', [custodyId]);
  assert.strictEqual(Number(origAfter.remaining_amount), 18000, 'المتبقي 18k');

  // 3. سلفة موظف ← إصلاح الأعمدة + قيد + الصندوق الرئيسي
  const cashBeforeAdv = await maxCashId();
  r = await api('POST', '/api/hr/advances', {
    employee_id: emp.id, amount: 50000, installment_amount: 10000,
    request_date: '2031-01-12', reason: 'TEST سلفة استرداد'
  });
  assert.strictEqual(r.status, 200, 'السلفة: ' + JSON.stringify(r.data));
  assert.ok(r.data.journal_entry_id, 'السلفة ترجع قيداً');
  const advanceId = r.data.id;

  const linesAdv = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [r.data.journal_entry_id]);
  assert.ok(linesAdv.find(l => l.account_id === acc114 && Number(l.debit) === 50000), 'مدين 114');
  assert.ok(linesAdv.find(l => l.account_id === acc111 && Number(l.credit) === 50000), 'دائن 111');
  const cashAdv = await db.query(`SELECT * FROM cash_movements WHERE id > ? AND notes LIKE '%سلفة موظف%' AND date = '2031-01-12'`, [cashBeforeAdv]);
  assert.strictEqual(cashAdv.length, 1, 'حركة صندوق للسلفة');
  assert.strictEqual(cashAdv[0].project_id, null, 'السلفة في الصندوق الرئيسي');

  // 4. الصناديق: مصروف على ب + قبض رئيسي ← سلاسل مستقلة
  r = await api('POST', '/api/expenses', {
    expense_type: 'مواد بناء', project_id: projB, amount: 5000,
    payment_method: 'نقدي', date: '2031-01-13'
  });
  assert.strictEqual(r.status, 200, 'مصروف ب: ' + JSON.stringify(r.data));
  r = await api('POST', '/api/payments', {
    type: 'قبض', amount: 20000, payment_method: 'نقدي', date: '2031-01-14', notes: 'TEST قبض رئيسي'
  });
  assert.strictEqual(r.status, 200, 'قبض رئيسي: ' + JSON.stringify(r.data));

  r = await api('GET', '/api/accounting/cash-movements');
  assert.strictEqual(r.status, 200);
  const boxes = r.data.summary.boxes;
  const boxA = boxes.find(b => Number(b.project_id) === projA);
  const boxB = boxes.find(b => Number(b.project_id) === projB);
  assert.ok(boxA && boxB, 'الصندوقان ظاهران في الملخص');
  assert.strictEqual(Number(boxA.current_balance), -30000, 'صندوق أ مستقل (-30k)');
  assert.strictEqual(Number(boxB.current_balance), -5000, 'صندوق ب مستقل (-5k)');
  const boxesSum = boxes.reduce((s, b) => s + Number(b.current_balance), 0);
  assert.ok(Math.abs(boxesSum - Number(r.data.summary.current_balance)) < 0.01, 'الإجمالي = مجموع الصناديق');

  r = await api('GET', '/api/reports/dashboard');
  assert.strictEqual(r.status, 200);
  const r2 = await api('GET', '/api/accounting/cash-movements');
  assert.ok(
    Math.abs(Number(r.data.data.kpis.cash_balance) - Number(r2.data.summary.current_balance)) < 0.01,
    'اللوحة تعرض إجمالي الصناديق'
  );

  // 5. دورة الاسترداد: توليد ← ترحيل ← القسط مطبق فعلياً
  r = await api('POST', '/api/hr/payroll/generate', { payroll_month: '2031-02' });
  assert.strictEqual(r.status, 200, 'توليد المسير: ' + JSON.stringify(r.data));
  const payRow = await db.get('SELECT deductions, net_salary FROM payroll WHERE employee_id = ? AND payroll_month = ?', [emp.id, '2031-02']);
  assert.ok(payRow, 'صف مسير للموظف');
  assert.strictEqual(Number(payRow.deductions), 10000, 'القسط 10k في الاستقطاعات');

  const cashBeforePay = await maxCashId();
  r = await api('POST', '/api/hr/payroll/2031-02/post-to-journal');
  assert.strictEqual(r.status, 200, 'ترحيل المسير: ' + JSON.stringify(r.data));
  const advAfter = await db.get('SELECT recovered_amount, status FROM employee_advances WHERE id = ?', [advanceId]);
  assert.strictEqual(Number(advAfter.recovered_amount), 10000, 'القسط طُبق على السلفة');
  assert.strictEqual(advAfter.status, 'active', 'السلفة نشطة (متبقي 40k)');

  const jePay = await db.get('SELECT id FROM journal_entries WHERE entry_no = ?', [r.data.entry_no]);
  const recLeg = await db.get(
    'SELECT COALESCE(SUM(credit), 0) as c FROM journal_entry_lines WHERE entry_id = ? AND account_id = ?',
    [jePay.id, acc114]
  );
  assert.strictEqual(Number(recLeg.c), 10000, 'طرف الاسترداد الدائن 10k');
  const cashPay = await db.query(`SELECT cash_out FROM cash_movements WHERE id > ? AND notes LIKE '%2031-02%'`, [cashBeforePay]);
  assert.strictEqual(cashPay.length, 1, 'حركة صندوق واحدة بالصافي');
  // القيد المركب يرحّل حركة واحدة بإجمالي الصافي (كل الموظفين النشطين — يشمل بيانات الترحيل اليدوية إن وُجدت)
  const totalNetRow = await db.get(`SELECT COALESCE(SUM(total_net_salary), 0) as t FROM payroll WHERE payroll_month = '2031-02'`);
  assert.strictEqual(Number(cashPay[0].cash_out), Number(totalNetRow.t), 'الحركة = إجمالي صافي المسير');

  // 6. الإقفال السنوي: إيراد + مصروف ثم إقفال 2031
  const acc33 = await acc('33');
  assert.ok(acc33, 'حساب الأرباح المحتجزة 33 موجود');
  const ccId = (await db.get('SELECT id FROM cost_centers LIMIT 1')).id;

  r = await api('POST', '/api/accounting/journal-entries', {
    date: '2031-06-01', description: 'TEST إيراد للإقفال', status: 'posted',
    lines: [
      { account_id: acc111, debit: 100000, credit: 0 },
      { account_id: acc4101, debit: 0, credit: 100000, cost_center_id: ccId }
    ]
  });
  assert.strictEqual(r.status, 200, 'قيد الإيراد: ' + JSON.stringify(r.data));
  r = await api('POST', '/api/accounting/journal-entries', {
    date: '2031-06-02', description: 'TEST مصروف للإقفال', status: 'posted',
    lines: [
      { account_id: acc511, debit: 40000, credit: 0, cost_center_id: ccId },
      { account_id: acc111, debit: 0, credit: 40000 }
    ]
  });
  assert.strictEqual(r.status, 200, 'قيد المصروف: ' + JSON.stringify(r.data));

  r = await api('POST', '/api/accounting/periods', {
    period_name: 'TEST سنة 2031', fiscal_year: 2031,
    start_date: '2031-01-01', end_date: '2031-12-31'
  });
  assert.strictEqual(r.status, 200, 'إنشاء الفترة: ' + JSON.stringify(r.data));
  const periodId = r.data.id;

  r = await api('POST', `/api/accounting/periods/${periodId}/year-close`, {
    manager_password: 'test123', notes: 'TEST إقفال سنوي'
  });
  assert.strictEqual(r.status, 200, 'الإقفال السنوي: ' + JSON.stringify(r.data));
  assert.ok(r.data.data.entry_no, 'قيد إقفال مولّد');
  assert.strictEqual(r.data.data.locked, true, 'الفترة مقفلة');

  const jeClose = await db.get('SELECT * FROM journal_entries WHERE id = ?', [r.data.data.journal_entry_id]);
  assert.strictEqual(Number(jeClose.total_debit), Number(jeClose.total_credit), 'قيد الإقفال متزن');
  assert.ok(Number(jeClose.total_debit) > 0, 'قيد الإقفال غير صفري');
  const retainedLine = await db.get(
    'SELECT debit, credit FROM journal_entry_lines WHERE entry_id = ? AND account_id = ?',
    [jeClose.id, acc33]
  );
  assert.ok(retainedLine, 'سطر الأرباح المحتجزة موجود');
  const plugAmt = Math.abs(Number(retainedLine.debit) - Number(retainedLine.credit));
  assert.ok(plugAmt > 0, 'فرق النتيجة مرحّل للأرباح المحتجزة');
  assert.ok(
    Math.abs(plugAmt - Math.abs(Number(r.data.data.net))) < 0.01,
    'الفرق يساوي صافي النتيجة المعلن'
  );

  const rev4101 = await db.get(`
    SELECT COALESCE(SUM(l.debit), 0) d, COALESCE(SUM(l.credit), 0) c
    FROM journal_entry_lines l JOIN journal_entries je ON l.entry_id = je.id
    WHERE l.account_id = ? AND je.status = 'posted' AND je.date <= '2031-12-31'
  `, [acc4101]);
  assert.strictEqual(Number(rev4101.d), Number(rev4101.c), 'حساب الإيراد 4101 مصفّر بعد الإقفال');

  const periodAfter = await db.get('SELECT status, close_entry_id FROM accounting_periods WHERE id = ?', [periodId]);
  assert.strictEqual(periodAfter.status, 'closed', 'الفترة مغلقة');
  assert.strictEqual(Number(periodAfter.close_entry_id), jeClose.id, 'الفترة مربوطة بقيد الإقفال');

  // القفل مطبق + التكرار مرفوض
  r = await api('POST', '/api/expenses', {
    expense_type: 'اختبار القفل', amount: 1000, payment_method: 'نقدي', date: '2031-07-01'
  });
  assert.notStrictEqual(r.status, 200, 'الترحيل داخل المقفلة مرفوض');
  assert.ok(/مغلق/.test(r.data.message || ''), 'سبب الرفض: فترة مغلقة');

  r = await api('POST', `/api/accounting/periods/${periodId}/year-close`, { manager_password: 'test123' });
  assert.strictEqual(r.status, 400, 'تكرار الإقفال مرفوض');
  assert.ok(/مسبقاً/.test(r.data.message || ''), 'سبب الرفض: إقفال مسبق');

  // 7. تنظيف (إعادة فتح الفترة أولاً حتى لا يبقى قفل يتيم)
  r = await api('PUT', `/api/accounting/periods/${periodId}/reopen`, { reason: 'تنظيف اختبار الإقفال السنوي' });
  assert.strictEqual(r.status, 200, 'إعادة الفتح للتنظيف');
  await cleanup();
});
