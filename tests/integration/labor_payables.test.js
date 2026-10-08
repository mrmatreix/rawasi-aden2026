/**
 * اختبار ذمم الأجور الموقعية (Suggestion-8: no-wages-without-liability)
 * ============================================================================
 * - الآجل: قيد Dr511/Cr215 بالمشروع ومركز التكلفة (ذرياً) — الدائن اسم الطاقم.
 * - النقدي الكامل: مرآة فقط بلا استحقاق.
 * - المدفوع فوق الإجمالي / الحالة الجزئية بلا مبلغ: 400 بلا سجل (ذرية).
 * - السداد: قيد Dr215/Cr111 + صندوق + تحديث المسدد؛ فوق المتبقي: 400؛ المقفلة: 403.
 * - الحذف: عكس الاستحقاق والتسويات + إعادة النقد.
 * - سند التسوية المرتبط: Dr215 لا ازدواج؛ مع مورد: 400؛ عكسه يستعيد المسدد.
 * - التقرير: التعرض غير المثبت فقط (قديم بلا قيد).
 * التواريخ 2034-xx معزولة تماماً.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');
const ProjectCostService = require('../../server/services/projectCostService');

test('Labor Payables - Accrual on Credit, Settlement, Settle-Voucher, Unwind, Exposure Report', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'wages-test-csrf-token-1234567890123456789012345678901234';
  const testerId = 7207;
  const PROJECT_NAME = 'TEST-WG مشروع اختبار ذمم الأجور';
  const SUPPLIER_NAME = 'مورد اختبار رفض الأجور 2034';

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt.sign(
      { id: testerId, username: 'wages_tester', role: 'admin', permissions: ['*'] },
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

  // تنظيف معزول: مشروع الاختبار + قيود 2034 + عكوس الأجور + فترة 2034 + المستخدم
  // سجلات الأجور المحذوفة عبر API تُتتبع (صفوفها تزول فتفوت الاستعلام)
  const deadLaborIds = [];
  const cleanup = async () => {
    // أولاً: قيود النطاق المؤرخ (سطورها تشير للمشروع وتمنع حذفه FK — قبل حذف المشروع)
    // عكوس الأجور بتاريخ اليوم تُنظف عبر deadLaborIds داخل الحلقة (بلا كنس شامل يهدد التوازي)
    await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE date LIKE '2034%')`);
    await db.run(`DELETE FROM journal_entries WHERE date LIKE '2034%'`);
    const projs = await db.query('SELECT id FROM projects WHERE name = ?', [PROJECT_NAME]);
    for (const p of projs) {
      await db.run('DELETE FROM cash_movements WHERE project_id = ?', [p.id]);
      const labs = await db.query('SELECT id FROM project_labor_expenses WHERE project_id = ?', [p.id]);
      const labIds = [...labs.map(x => x.id), ...deadLaborIds];
      if (labIds.length > 0) {
        const ph = labIds.map(() => '?').join(',');
        const jes = await db.query(
          `SELECT id FROM journal_entries WHERE reference_id IN (${ph})
           AND (reference_type IN ('${ProjectCostService.WAGE_JE_TYPES.accrual}', '${ProjectCostService.WAGE_JE_TYPES.settlement}')
                OR (reference_type = 'قيد عكسي' AND description LIKE '%لمستحقات الأجور%'))`,
          labIds
        );
        const jeIds = jes.map(j => j.id);
        if (jeIds.length > 0) {
          const jph = jeIds.map(() => '?').join(',');
          await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (${jph})`, jeIds);
          await db.run(`DELETE FROM journal_entries WHERE id IN (${jph})`, jeIds);
        }
      }
      const exps = await db.query('SELECT id FROM expenses WHERE project_id = ?', [p.id]);
      const expIds = exps.map(e => e.id);
      if (expIds.length > 0) {
        const ph = expIds.map(() => '?').join(',');
        const jes = await db.query(`SELECT id FROM journal_entries WHERE reference_id IN (${ph})`, expIds);
        const jeIds = jes.map(j => j.id);
        if (jeIds.length > 0) {
          const jph = jeIds.map(() => '?').join(',');
          await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (${jph})`, jeIds);
          await db.run(`DELETE FROM journal_entries WHERE id IN (${jph})`, jeIds);
        }
        await db.run(`DELETE FROM expenses WHERE id IN (${ph})`, expIds);
      }
      await db.run('DELETE FROM project_labor_expenses WHERE project_id = ?', [p.id]);
      await db.run('DELETE FROM projects WHERE id = ?', [p.id]);
    }
    await db.run(`DELETE FROM accounting_periods WHERE fiscal_year = 2034`);
    await db.run('DELETE FROM suppliers WHERE name = ?', [SUPPLIER_NAME]);
    await db.run('DELETE FROM users WHERE id = ?', [testerId]);
  };
  t.after(() => cleanup().catch(() => {}));
  await cleanup();

  // إعداد
  const passwordHash = await bcrypt.hash('test123', 4);
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'wages_tester', ?, 'admin', 'مختبِر الأجور', 'active', '["*"]')`,
    [testerId, passwordHash]
  );
  const acc = async (code) => (await db.get('SELECT id FROM accounts WHERE code = ?', [code])).id;
  // مصروف الأجور: 511 فإن غاب 5 (مطابق لمنطق resolveWageAccounts)
  let wageExpAcc;
  try { wageExpAcc = await acc('511'); } catch { wageExpAcc = await acc('5'); }
  const acc215 = await acc('215');
  const acc111 = await acc('111');

  let r = await api('POST', '/api/projects', {
    code: 'TEST-WG-2034', name: PROJECT_NAME, contract_value: 500000,
    status: 'active', start_date: '2034-01-01'
  });
  assert.strictEqual(r.status, 200, 'إنشاء المشروع: ' + JSON.stringify(r.data));
  const projectId = r.data.data.id;

  r = await api('POST', '/api/suppliers', { name: SUPPLIER_NAME });
  assert.strictEqual(r.status, 200, 'إنشاء المورد: ' + JSON.stringify(r.data));
  const supplierId = r.data.id;

  // 1. أجور آجلة 100,000 (مدفوع 40,000) ← استحقاق 60,000
  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم الذمم', trade: 'نجارة',
    total_amount: 100000, paid_amount: 40000, date: '2034-01-10'
  });
  assert.strictEqual(r.status, 200, 'الأجور الآجلة: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data.data.payment_status, 'جزئي', 'الحالة مشتقة من المبالغ');
  assert.strictEqual(Number(r.data.payable.amount), 60000, 'الاستجابة تعلن المثبت');
  assert.ok(/طاقم الذمم/.test(r.data.payable.worker || ''), 'الدائن اسم الطاقم');
  const laborId = r.data.data.id;

  const accJe = await db.get(
    `SELECT * FROM journal_entries WHERE reference_id = ? AND reference_type = ?`,
    [laborId, ProjectCostService.WAGE_JE_TYPES.accrual]
  );
  assert.ok(accJe, 'قيد الاستحقاق منشأ');
  assert.strictEqual(accJe.status, 'posted');
  assert.ok(/^JE-WP-/.test(accJe.entry_no || ''), 'ترقيم الاستحقاق JE-WP');
  const accLines = await db.query(
    'SELECT account_id, debit, credit, project_id, cost_center_id FROM journal_entry_lines WHERE entry_id = ?', [accJe.id]
  );
  assert.ok(accLines.find(l => l.account_id === wageExpAcc && Number(l.debit) === 60000), 'مدين الأجور بالمتبقي');
  assert.ok(accLines.find(l => l.account_id === acc215 && Number(l.credit) === 60000), 'دائن 215 بالمتبقي');
  assert.strictEqual(Number(accLines[0].project_id), projectId, 'الاستحقاق على المشروع');
  assert.ok(accLines[0].cost_center_id, 'مركز تكلفة محدد');

  const boxAfterAccrual = await db.query('SELECT cash_in, cash_out FROM cash_movements WHERE project_id = ? ORDER BY id ASC', [projectId]);
  assert.strictEqual(boxAfterAccrual.length, 1, 'الاستحقاق الدفتري بلا حركة نقدية (المرآة فقط)');
  assert.strictEqual(Number(boxAfterAccrual[0].cash_out), 40000);

  const costAfter = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
  assert.strictEqual(Number(costAfter.actual_cost), 100000, 'التكلفة بإجمالي الأجور (استحقاق)');

  // 2. نقدي كامل ← مرآة فقط بلا استحقاق
  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم نقدي', trade: 'حدادة',
    total_amount: 10000, paid_amount: 10000, date: '2034-01-11'
  });
  assert.strictEqual(r.status, 200, 'النقدي الكامل: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data.data.payment_status, 'مدفوع');
  assert.strictEqual(r.data.payable, null, 'لا التزام للنقدي');
  const cashLaborId = r.data.data.id;
  const noAcc = await db.get(
    `SELECT id FROM journal_entries WHERE reference_id = ? AND reference_type = ?`,
    [cashLaborId, ProjectCostService.WAGE_JE_TYPES.accrual]
  );
  assert.strictEqual(noAcc ?? null, null, 'النقدي الكامل بلا قيد استحقاق');

  // 3. مدفوع فوق الإجمالي ← 400 بلا سجل (ذرية)
  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم خطأ', trade: 'بناء',
    total_amount: 5000, paid_amount: 6000, date: '2034-01-12'
  });
  assert.strictEqual(r.status, 400, 'المدفوع فوق الإجمالي مرفوض');
  assert.ok(/يتجاوز/.test(r.data.message || ''), 'سبب الرفض: التجاوز');
  const blockedSub = await db.get(
    `SELECT id FROM project_labor_expenses WHERE project_id = ? AND worker_name_or_team = 'طاقم خطأ'`, [projectId]
  );
  assert.strictEqual(blockedSub ?? null, null, 'لا سجل فرعي عند الرفض (ذرية)');

  // 4. حالة جزئية بلا مبلغ صريح ← 400 (التوافق الخلفي لا يخمّن الجزئي)
  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم غامض', trade: 'لياسة',
    total_amount: 5000, payment_status: 'جزئي', date: '2034-01-12'
  });
  assert.strictEqual(r.status, 400, 'الجزئي بلا مبلغ مرفوض');
  assert.ok(/paid_amount/.test(r.data.message || ''), 'الرسالة تطلب المبلغ صراحةً');

  // 5. سداد جزئي 25,000 ← قيد تسوية + صندوق + تحديث المسدد
  r = await api('POST', `/api/project-hub/${projectId}/labor/${laborId}/pay`, {
    amount: 25000, payment_method: 'نقدي', date: '2034-01-15', notes: 'دفعة أولى'
  });
  assert.strictEqual(r.status, 200, 'السداد الجزئي: ' + JSON.stringify(r.data));
  assert.strictEqual(Number(r.data.data.paid_amount), 65000, 'المسدد تراكمي');
  assert.strictEqual(r.data.data.payment_status, 'جزئي');
  assert.strictEqual(Number(r.data.outstanding), 35000);

  const setJe = await db.get(
    `SELECT * FROM journal_entries WHERE reference_id = ? AND reference_type = ?`,
    [laborId, ProjectCostService.WAGE_JE_TYPES.settlement]
  );
  assert.ok(setJe, 'قيد التسوية منشأ');
  assert.ok(/^JE-WS-/.test(setJe.entry_no || ''), 'ترقيم التسوية JE-WS');
  const setLines = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [setJe.id]);
  assert.ok(setLines.find(l => l.account_id === acc215 && Number(l.debit) === 25000), 'مدين 215 بالسداد');
  assert.ok(setLines.find(l => l.account_id === acc111 && Number(l.credit) === 25000), 'دائن 111 بالسداد');

  const chain = await db.query('SELECT previous_balance, cash_out, current_balance FROM cash_movements WHERE project_id = ? ORDER BY id ASC', [projectId]);
  assert.strictEqual(chain.length, 3, 'المرآتان + السداد');
  assert.strictEqual(Number(chain[2].previous_balance), Number(chain[1].current_balance), 'السلسلة متصلة');
  assert.strictEqual(Number(chain[2].cash_out), 25000);
  assert.strictEqual(Number(chain[2].current_balance), -75000, 'الصندوق: -40k-10k-25k');

  // 6. سداد فوق المتبقي ← 400 بلا أثر
  r = await api('POST', `/api/project-hub/${projectId}/labor/${laborId}/pay`, {
    amount: 40000, date: '2034-01-16'
  });
  assert.strictEqual(r.status, 400, 'السداد فوق المتبقي مرفوض');
  const laborAfterReject = await db.get('SELECT paid_amount FROM project_labor_expenses WHERE id = ?', [laborId]);
  assert.strictEqual(Number(laborAfterReject.paid_amount), 65000, 'المسدد ثابت بعد الرفض');

  // 7. الفترة المقفلة تمنع السداد
  r = await api('POST', '/api/accounting/periods', {
    period_name: 'TEST فبراير 2034', fiscal_year: 2034,
    start_date: '2034-02-01', end_date: '2034-02-28'
  });
  assert.strictEqual(r.status, 200, 'إنشاء الفترة: ' + JSON.stringify(r.data));
  const periodId = r.data.id;
  r = await api('PUT', `/api/accounting/periods/${periodId}/close`, { manager_password: 'test123' });
  assert.strictEqual(r.status, 200, 'قفل الفترة: ' + JSON.stringify(r.data));
  r = await api('POST', `/api/project-hub/${projectId}/labor/${laborId}/pay`, {
    amount: 1000, date: '2034-02-05'
  });
  assert.strictEqual(r.status, 403, 'السداد في المقفلة مرفوض');
  const laborAfterClose = await db.get('SELECT paid_amount FROM project_labor_expenses WHERE id = ?', [laborId]);
  assert.strictEqual(Number(laborAfterClose.paid_amount), 65000, 'المسدد ثابت بعد رفض المقفلة');

  // 8. حذف السجل ← عكس الاستحقاق والتسوية + عودة الصندوق
  r = await api('DELETE', `/api/project-hub/${projectId}/labor/${laborId}`);
  assert.strictEqual(r.status, 200, 'حذف السجل: ' + JSON.stringify(r.data));
  deadLaborIds.push(laborId);
  assert.ok(/استحقاق/.test(r.data.message || ''), 'الرسالة تعلن فك الاستحقاق');
  const accRev = await db.get('SELECT status FROM journal_entries WHERE id = ?', [accJe.id]);
  assert.strictEqual(accRev.status, 'reversed', 'قيد الاستحقاق معكوس');
  const setRev = await db.get('SELECT status FROM journal_entries WHERE id = ?', [setJe.id]);
  assert.strictEqual(setRev.status, 'reversed', 'قيد التسوية معكوس');
  const revCount = await db.get(
    `SELECT COUNT(*) c FROM journal_entries WHERE reference_id = ? AND reference_type = 'قيد عكسي' AND description LIKE '%لمستحقات الأجور%'`,
    [laborId]
  );
  assert.strictEqual(Number(revCount.c), 2, 'قيدا عكس للأجور (استحقاق + تسوية)');
  const boxZero = await db.get('SELECT current_balance FROM cash_movements WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
  assert.strictEqual(Number(boxZero.current_balance), -10000, 'الصندوق: بقيت مرآة النقدي فقط (-10k)');
  const costDel = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
  assert.strictEqual(Number(costDel.actual_cost), 10000, 'التكلفة بعد الحذف: النقدي فقط');

  // 9. سند التسوية: أجور 50,000 غير مدفوعة + سند مرتبط ← Dr215 بلا ازدواج
  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم التسوية', trade: 'كهرباء',
    total_amount: 50000, payment_status: 'غير مدفوع', date: '2034-03-01'
  });
  assert.strictEqual(r.status, 200, 'سجل التسوية: ' + JSON.stringify(r.data));
  const settleLaborId = r.data.data.id;
  r = await api('POST', '/api/expenses', {
    expense_type: 'أجور عمالة', project_id: projectId, amount: 50000,
    payment_method: 'نقدي', date: '2034-03-02', link_labor_id: settleLaborId
  });
  assert.strictEqual(r.status, 200, 'سند التسوية: ' + JSON.stringify(r.data));
  assert.ok(r.data.link_note, 'يجب إرجاع ملاحظة الربط');
  const settleExpenseId = r.data.id;
  const labAfterSettle = await db.get('SELECT paid_amount, payment_status FROM project_labor_expenses WHERE id = ?', [settleLaborId]);
  assert.strictEqual(Number(labAfterSettle.paid_amount), 50000, 'مسدد الأجور تراكمي');
  assert.strictEqual(labAfterSettle.payment_status, 'مدفوع');
  const settleVJe = await db.get(
    `SELECT * FROM journal_entries WHERE reference_type = 'سند صرف' AND reference_id = ?`, [settleExpenseId]
  );
  assert.ok(settleVJe, 'قيد السند المرتبط موجود');
  const settleVLines = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [settleVJe.id]);
  assert.ok(settleVLines.find(l => l.account_id === acc215 && Number(l.debit) === 50000), 'مدين 215 بالتسوية');
  assert.ok(settleVLines.find(l => l.account_id === acc111 && Number(l.credit) === 50000), 'دائن 111 بالتسوية');
  assert.ok(!settleVLines.find(l => l.account_id === wageExpAcc && Number(l.debit) > 0), 'لا مدين أجور ثانيةً (لا ازدواج GL)');
  const accStill = await db.get(
    `SELECT status FROM journal_entries WHERE reference_id = ? AND reference_type = ?`,
    [settleLaborId, ProjectCostService.WAGE_JE_TYPES.accrual]
  );
  assert.strictEqual(accStill.status, 'posted', 'قيد الاستحقاق الأصلي قائم');

  // 10. سند مرتبط بمورد ← 400 (التسوية للطاقم مباشرة) — بسجل مستقل غير مربوط
  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم التعارض', trade: 'تكييف',
    total_amount: 20000, payment_status: 'غير مدفوع', date: '2034-03-03'
  });
  assert.strictEqual(r.status, 200, 'سجل التعارض: ' + JSON.stringify(r.data));
  const clashLaborId = r.data.data.id;
  r = await api('POST', '/api/expenses', {
    expense_type: 'أجور عمالة', project_id: projectId, amount: 5000, supplier_id: supplierId,
    payment_method: 'نقدي', date: '2034-03-03', link_labor_id: clashLaborId
  });
  assert.strictEqual(r.status, 400, 'المورد مع التسوية مرفوض');
  assert.ok(/مورد/.test(r.data.message || ''), 'سبب الرفض: المورد');
  const clashLink = await db.get('SELECT linked_expense_id FROM project_labor_expenses WHERE id = ?', [clashLaborId]);
  assert.strictEqual(clashLink.linked_expense_id, null, 'الرفض ذري: لا رابط معلق');

  // 11. عكس سند التسوية ← المسدد يُستعاد والحالة تعود
  r = await api('POST', `/api/expenses/${settleExpenseId}/reverse`, {
    reason: 'اختبار استعادة تسوية الأجور', reversal_date: '2034-03-04'
  });
  assert.strictEqual(r.status, 200, 'عكس سند التسوية: ' + JSON.stringify(r.data));
  const labRev = await db.get('SELECT paid_amount, payment_status FROM project_labor_expenses WHERE id = ?', [settleLaborId]);
  assert.strictEqual(Number(labRev.paid_amount), 0, 'العكس يستعيد المسدد');
  assert.strictEqual(labRev.payment_status, 'غير مدفوع');
  const vRevJe = await db.get(
    `SELECT * FROM journal_entries WHERE reference_type = 'قيد عكسي سند صرف' AND reference_id = ?`, [settleExpenseId]
  );
  assert.ok(vRevJe, 'القيد العكسي للسند موجود');
  const vRevLines = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [vRevJe.id]);
  assert.ok(vRevLines.find(l => l.account_id === acc215 && Number(l.credit) === 50000), 'العكسي يعيد الالتزام 215 دائناً');

  // 12. التقرير: قديم بلا قيد يظهر، المثبت عبر API لا يظهر
  const legacy = await db.run(
    `INSERT INTO project_labor_expenses (project_id, date, worker_name_or_team, trade, workers_count, daily_rate, days_or_hours, total_amount, paid_amount, payment_status)
     VALUES (?, '2034-04-01', 'طاقم قديم', 'سباكة', 1, 9000, 1, 9000, 0, 'غير مدفوع')`,
    [projectId]
  );
  const legacyId = legacy.lastInsertRowid || legacy.insertId;
  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم مثبت', trade: 'دهان',
    total_amount: 30000, paid_amount: 10000, date: '2034-04-02'
  });
  assert.strictEqual(r.status, 200, 'سجل مثبت للمقارنة: ' + JSON.stringify(r.data));
  const bookedId = r.data.data.id;
  const exposure = await ProjectCostService.reportUnbookedWages();
  assert.ok(exposure.rows.find(x => Number(x.id) === Number(legacyId)), 'القديم بلا قيد في التقرير');
  assert.strictEqual(Number(exposure.rows.find(x => Number(x.id) === Number(legacyId)).outstanding), 9000);
  assert.ok(!exposure.rows.find(x => Number(x.id) === Number(bookedId)), 'المثبت عبر API خارج التقرير');

  // 13. سداد القديم بلا استحقاق ← يوثق الدفع ويكتمل السجل
  r = await api('POST', `/api/project-hub/${projectId}/labor/${legacyId}/pay`, {
    amount: 9000, date: '2034-04-05'
  });
  assert.strictEqual(r.status, 200, 'سداد القديم: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data.data.payment_status, 'مدفوع');
  const legRow = await db.get('SELECT paid_amount FROM project_labor_expenses WHERE id = ?', [legacyId]);
  assert.strictEqual(Number(legRow.paid_amount), 9000);

  console.log('✅ ذمم الأجور: جميع الفحوصات (13) ناجحة');
});
