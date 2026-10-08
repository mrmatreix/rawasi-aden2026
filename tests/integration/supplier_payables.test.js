/**
 * اختبار ذمم الموردين لمشتريات المواقع (Suggestion-6: no-purchase-without-liability)
 * ============================================================================
 * - الآجل: رصيد مورد + قيد Dr5/Cr21 بالمشروع ومركز التكلفة (ذرياً).
 * - النقدي الكامل: بلا استحقاق ولا رصيد.
 * - الآجل بلا مورد / المدفوع فوق الإجمالي: 400 بلا سجل (ذرية).
 * - السداد: قيد Dr21/Cr111 + صندوق + تحديث المسدد؛ فوق المتبقي: 400؛ المقفلة: 403.
 * - الحذف: عكس الاستحقاق والتسويات + إعادة النقد + عودة الرصيد.
 * - التقرير: التعرض غير المثبت فقط (قديم بلا قيد).
 * التواريخ 2033-xx معزولة تماماً.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');
const ProjectCostService = require('../../server/services/projectCostService');

test('Supplier Payables - Accrual on Credit, Settlement, Unwind on Delete, Exposure Report', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'payables-test-csrf-token-12345678901234567890123456789012';
  const testerId = 7206;
  const PROJECT_NAME = 'TEST-PAY مشروع اختبار ذمم الموردين';
  const SUPPLIER_NAME = 'مورد اختبار الذمم 2033';

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt.sign(
      { id: testerId, username: 'payables_tester', role: 'admin', permissions: ['*'] },
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

  // تنظيف معزول: مشروع الاختبار + مورده + قيود 2033 + عكوس الذمم + فترة 2033 + المستخدم
  // الفواتير المحذوفة عبر API تُتتبع (صفوفها تزول فتفوت الاستعلام)
  const deadPurchaseIds = [];
  const cleanup = async () => {
    // أولاً: قيود النطاق المؤرخ (سطورها تشير للمشروع وتمنع حذفه FK — قبل حذف المشروع)
    // عكوس الذمم بتاريخ اليوم تُنظف عبر deadPurchaseIds داخل الحلقة (بلا كنس شامل يهدد التوازي)
    await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE date LIKE '2033%')`);
    await db.run(`DELETE FROM journal_entries WHERE date LIKE '2033%'`);
    const projs = await db.query('SELECT id FROM projects WHERE name = ?', [PROJECT_NAME]);
    for (const p of projs) {
      await db.run('DELETE FROM cash_movements WHERE project_id = ?', [p.id]);
      const purs = await db.query('SELECT id FROM project_purchases WHERE project_id = ?', [p.id]);
      const purIds = [...purs.map(x => x.id), ...deadPurchaseIds];
      if (purIds.length > 0) {
        const ph = purIds.map(() => '?').join(',');
        const jes = await db.query(
          `SELECT id FROM journal_entries WHERE reference_id IN (${ph})
           AND (reference_type IN ('${ProjectCostService.AP_JE_TYPES.accrual}', '${ProjectCostService.AP_JE_TYPES.settlement}')
                OR (reference_type = 'قيد عكسي' AND description LIKE '%ذمم الموردين%'))`,
          purIds
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
      await db.run('DELETE FROM project_purchases WHERE project_id = ?', [p.id]);
      await db.run('DELETE FROM projects WHERE id = ?', [p.id]);
    }
    await db.run(`DELETE FROM accounting_periods WHERE fiscal_year = 2033`);
    await db.run('DELETE FROM suppliers WHERE name = ?', [SUPPLIER_NAME]);
    await db.run('DELETE FROM users WHERE id = ?', [testerId]);
  };
  t.after(() => cleanup().catch(() => {}));
  await cleanup();

  // إعداد
  const passwordHash = await bcrypt.hash('test123', 4);
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'payables_tester', ?, 'admin', 'مختبِر الذمم', 'active', '["*"]')`,
    [testerId, passwordHash]
  );
  const acc = async (code) => (await db.get('SELECT id FROM accounts WHERE code = ?', [code])).id;
  const acc5 = await acc('5');
  const acc21 = await acc('21');
  const acc111 = await acc('111');

  let r = await api('POST', '/api/projects', {
    code: 'TEST-PAY-2033', name: PROJECT_NAME, contract_value: 500000,
    status: 'active', start_date: '2033-01-01'
  });
  assert.strictEqual(r.status, 200, 'إنشاء المشروع: ' + JSON.stringify(r.data));
  const projectId = r.data.data.id;

  r = await api('POST', '/api/suppliers', { name: SUPPLIER_NAME });
  assert.strictEqual(r.status, 200, 'إنشاء المورد: ' + JSON.stringify(r.data));
  const supplierId = r.data.id;

  // 1. فاتورة آجلة 100,000 (مدفوع 40,000) ← استحقاق 60,000
  r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
    item_description: 'إسمنت الذمم', invoice_no: 'PAY-2033-1', supplier_id: supplierId,
    total_amount: 100000, paid_amount: 40000, payment_method: 'نقدي', date: '2033-01-10'
  });
  assert.strictEqual(r.status, 200, 'الفاتورة الآجلة: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data.data.payment_status, 'جزئي', 'الحالة مشتقة من المبالغ');
  assert.strictEqual(Number(r.data.payable.amount), 60000, 'الاستجابة تعلن المثبت');
  const purchaseId = r.data.data.id;

  const supp = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
  assert.strictEqual(Number(supp.balance), 60000, 'رصيد المورد زاد بالمتبقي');

  const apJe = await db.get(
    `SELECT * FROM journal_entries WHERE reference_id = ? AND reference_type = ?`,
    [purchaseId, ProjectCostService.AP_JE_TYPES.accrual]
  );
  assert.ok(apJe, 'قيد الاستحقاق منشأ');
  assert.strictEqual(apJe.status, 'posted');
  const apLines = await db.query(
    'SELECT account_id, debit, credit, project_id, cost_center_id FROM journal_entry_lines WHERE entry_id = ?', [apJe.id]
  );
  assert.ok(apLines.find(l => l.account_id === acc5 && Number(l.debit) === 60000), 'مدين 5 بالمتبقي');
  assert.ok(apLines.find(l => l.account_id === acc21 && Number(l.credit) === 60000), 'دائن 21 بالمتبقي');
  assert.strictEqual(Number(apLines[0].project_id), projectId, 'الاستحقاق على المشروع');
  assert.ok(apLines[0].cost_center_id, 'مركز تكلفة محدد');

  const boxAfterAccrual = await db.query('SELECT cash_in, cash_out FROM cash_movements WHERE project_id = ? ORDER BY id ASC', [projectId]);
  assert.strictEqual(boxAfterAccrual.length, 1, 'الاستحقاق الدفتري بلا حركة نقدية (المرآة فقط)');
  assert.strictEqual(Number(boxAfterAccrual[0].cash_out), 40000);

  const costAfter = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
  assert.strictEqual(Number(costAfter.actual_cost), 100000, 'التكلفة بإجمالي الفاتورة (استحقاق)');

  // 2. نقدي كامل بلا مورد ← بلا استحقاق ولا رصيد
  r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
    item_description: 'رمل نقدي', total_amount: 10000,
    paid_amount: 10000, payment_method: 'نقدي', date: '2033-01-11'
  });
  assert.strictEqual(r.status, 200, 'النقدي الكامل: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data.data.payment_status, 'مدفوع');
  assert.strictEqual(r.data.payable, null, 'لا التزام للنقدي');
  const cashPurId = r.data.data.id;
  const noAp = await db.get(
    `SELECT id FROM journal_entries WHERE reference_id = ? AND reference_type = ?`,
    [cashPurId, ProjectCostService.AP_JE_TYPES.accrual]
  );
  assert.strictEqual(noAp ?? null, null, 'النقدي الكامل بلا قيد استحقاق');
  const supp2 = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
  assert.strictEqual(Number(supp2.balance), 60000, 'الرصيد لم يتأثر بالنقدي');

  // 3. آجل بلا مورد ← 400 بلا سجل فرعي (ذرية)
  r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
    item_description: 'حديد مجهول الدائن', total_amount: 5000,
    paid_amount: 0, date: '2033-01-12'
  });
  assert.strictEqual(r.status, 400, 'الآجل بلا مورد مرفوض');
  assert.ok(/المورد/.test(r.data.message || ''), 'سبب الرفض: المورد');
  const blockedSub = await db.get(
    `SELECT id FROM project_purchases WHERE project_id = ? AND item_description = 'حديد مجهول الدائن'`, [projectId]
  );
  assert.strictEqual(blockedSub ?? null, null, 'لا سجل فرعي عند الرفض (ذرية)');

  // 4. مدفوع فوق الإجمالي ← 400
  r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
    item_description: 'خطأ مدفوع', supplier_id: supplierId,
    total_amount: 5000, paid_amount: 6000, date: '2033-01-12'
  });
  assert.strictEqual(r.status, 400, 'المدفوع فوق الإجمالي مرفوض');

  // 5. سداد جزئي 25,000 ← قيد تسوية + صندوق + تحديث المسدد
  r = await api('POST', `/api/project-hub/${projectId}/purchases/${purchaseId}/pay`, {
    amount: 25000, payment_method: 'نقدي', date: '2033-01-15', notes: 'دفعة أولى'
  });
  assert.strictEqual(r.status, 200, 'السداد الجزئي: ' + JSON.stringify(r.data));
  assert.strictEqual(Number(r.data.data.paid_amount), 65000, 'المسدد تراكمي');
  assert.strictEqual(r.data.data.payment_status, 'جزئي');
  assert.strictEqual(Number(r.data.outstanding), 35000);

  const supp3 = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
  assert.strictEqual(Number(supp3.balance), 35000, 'الرصيد انخفض بالسداد');

  const setJe = await db.get(
    `SELECT * FROM journal_entries WHERE reference_id = ? AND reference_type = ?`,
    [purchaseId, ProjectCostService.AP_JE_TYPES.settlement]
  );
  assert.ok(setJe, 'قيد التسوية منشأ');
  const setLines = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [setJe.id]);
  assert.ok(setLines.find(l => l.account_id === acc21 && Number(l.debit) === 25000), 'مدين 21 بالسداد');
  assert.ok(setLines.find(l => l.account_id === acc111 && Number(l.credit) === 25000), 'دائن 111 بالسداد');

  const chain = await db.query('SELECT previous_balance, cash_out, current_balance FROM cash_movements WHERE project_id = ? ORDER BY id ASC', [projectId]);
  assert.strictEqual(chain.length, 3, 'المرآتان + السداد');
  assert.strictEqual(Number(chain[2].previous_balance), Number(chain[1].current_balance), 'السلسلة متصلة');
  assert.strictEqual(Number(chain[2].cash_out), 25000);
  assert.strictEqual(Number(chain[2].current_balance), -75000, 'الصندوق: -40k-10k-25k');

  // 6. سداد فوق المتبقي ← 400 بلا أثر
  r = await api('POST', `/api/project-hub/${projectId}/purchases/${purchaseId}/pay`, {
    amount: 40000, date: '2033-01-16'
  });
  assert.strictEqual(r.status, 400, 'السداد فوق المتبقي مرفوض');
  const supp4 = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
  assert.strictEqual(Number(supp4.balance), 35000, 'الرصيد ثابت بعد الرفض');

  // 7. الفترة المقفلة تمنع السداد
  r = await api('POST', '/api/accounting/periods', {
    period_name: 'TEST فبراير 2033', fiscal_year: 2033,
    start_date: '2033-02-01', end_date: '2033-02-28'
  });
  assert.strictEqual(r.status, 200, 'إنشاء الفترة: ' + JSON.stringify(r.data));
  const periodId = r.data.id;
  r = await api('PUT', `/api/accounting/periods/${periodId}/close`, { manager_password: 'test123' });
  assert.strictEqual(r.status, 200, 'قفل الفترة: ' + JSON.stringify(r.data));
  r = await api('POST', `/api/project-hub/${projectId}/purchases/${purchaseId}/pay`, {
    amount: 1000, date: '2033-02-05'
  });
  assert.strictEqual(r.status, 403, 'السداد في المقفلة مرفوض');
  const supp5 = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
  assert.strictEqual(Number(supp5.balance), 35000, 'الرصيد ثابت بعد رفض المقفلة');

  // 8. حذف الفاتورة ← عكس الاستحقاق والتسوية + عودة الرصيد والصندوق
  r = await api('DELETE', `/api/project-hub/${projectId}/purchases/${purchaseId}`);
  assert.strictEqual(r.status, 200, 'حذف الفاتورة: ' + JSON.stringify(r.data));
  deadPurchaseIds.push(purchaseId);
  assert.ok(/استحقاق/.test(r.data.message || ''), 'الرسالة تعلن فك الاستحقاق');
  const apRev = await db.get('SELECT status FROM journal_entries WHERE id = ?', [apJe.id]);
  assert.strictEqual(apRev.status, 'reversed', 'قيد الاستحقاق معكوس');
  const setRev = await db.get('SELECT status FROM journal_entries WHERE id = ?', [setJe.id]);
  assert.strictEqual(setRev.status, 'reversed', 'قيد التسوية معكوس');
  const revCount = await db.get(
    `SELECT COUNT(*) c FROM journal_entries WHERE reference_id = ? AND reference_type = 'قيد عكسي' AND description LIKE '%ذمم الموردين%'`,
    [purchaseId]
  );
  assert.strictEqual(Number(revCount.c), 2, 'قيدا عكس للذمم (استحقاق + تسوية)');
  const supp6 = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
  assert.strictEqual(Number(supp6.balance), 0, 'رصيد المورد عاد صفراً');
  const boxZero = await db.get('SELECT current_balance FROM cash_movements WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
  assert.strictEqual(Number(boxZero.current_balance), -10000, 'الصندوق: بقيت مرآة النقدي فقط (-10k)');
  const costDel = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
  assert.strictEqual(Number(costDel.balance ?? costDel.actual_cost), 10000, 'التكلفة بعد الحذف: النقدي فقط');

  // 9. التقرير: قديم بلا قيد يظهر، المثبت عبر API لا يظهر
  const legacy = await db.run(
    `INSERT INTO project_purchases (project_id, invoice_no, item_description, quantity, unit_price, total_amount, paid_amount, payment_status, payment_method, date)
     VALUES (?, 'LEGACY-PAY-1', 'فاتورة قديمة بلا مورد', 1, 9000, 9000, 0, 'غير مدفوع', 'آجل', '2033-03-01')`,
    [projectId]
  );
  const legacyId = legacy.lastInsertRowid || legacy.insertId;
  r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
    item_description: 'إسمنت مثبت', invoice_no: 'PAY-2033-2', supplier_id: supplierId,
    total_amount: 30000, paid_amount: 10000, date: '2033-03-02'
  });
  assert.strictEqual(r.status, 200, 'فاتورة مثبتة للمقارنة: ' + JSON.stringify(r.data));
  const bookedId = r.data.data.id;
  const exposure = await ProjectCostService.reportUnbookedPayables();
  assert.ok(exposure.rows.find(x => Number(x.id) === Number(legacyId)), 'القديم بلا قيد في التقرير');
  assert.strictEqual(Number(exposure.rows.find(x => Number(x.id) === Number(legacyId)).outstanding), 9000);
  assert.ok(!exposure.rows.find(x => Number(x.id) === Number(bookedId)), 'المثبت عبر API خارج التقرير');

  // 10. سداد القديم بلا مورد ← توثيق المورد من الطلب
  r = await api('POST', `/api/project-hub/${projectId}/purchases/${legacyId}/pay`, {
    amount: 9000, supplier_id: supplierId, date: '2033-03-05'
  });
  assert.strictEqual(r.status, 200, 'سداد القديم: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data.data.payment_status, 'مدفوع');
  const legRow = await db.get('SELECT supplier_id, paid_amount FROM project_purchases WHERE id = ?', [legacyId]);
  assert.strictEqual(Number(legRow.supplier_id), supplierId, 'المورد وُثق على الصف القديم');
  assert.strictEqual(Number(legRow.paid_amount), 9000);

  console.log('✅ ذمم الموردين: جميع الفحوصات (10) ناجحة');
});
