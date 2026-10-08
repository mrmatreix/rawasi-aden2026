/**
 * اختبار قيود المرايا (Suggestion-5: no-voucher-without-JE)
 * ============================================================================
 * - الأجور المدفوعة: مرآة + قيد Dr511/Cr111 + حركة صندوق المشروع (ذرياً).
 * - المشتريات: القيد على الجزء المدفوع فقط (Dr5/Cr111).
 * - غير المدفوع: لا مرآة بل قيد استحقاق (SUGGESTION-8).
 * - حذف الأصل: عكس المرآة (REV + قلب + إعادة النقد) لا حذف فيزيائي.
 * - الفترة المقفلة تمنع المرآة الجديدة.
 * - الباكفيل: ينشئ للمفتوحة ويتخطى المقفلة مع الإبلاغ.
 * التواريخ 2032-xx معزولة تماماً.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');
const ProjectCostService = require('../../server/services/projectCostService');

test('Mirror Journals - Post JE on Paid, Reverse on Delete, Backfill', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'mirror-test-csrf-token-123456789012345678901234567890123';
  const testerId = 7205;
  const PROJECT_NAME = 'TEST-MIR مشروع اختبار قيود المرايا';
  const SUPPLIER_NAME = 'TEST-SUP-MIR مورد اختبار المرايا';

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt.sign(
      { id: testerId, username: 'mirror_tester', role: 'admin', permissions: ['*'] },
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

  // تنظيف معزول: مشاريع الاختبار (كل بياناتها) + 2032 + فترات 2032 + المستخدم
  // (قيود العكس مؤرخة بتاريخ اليوم لذا تُحذف عبر مرجع المرآة لا التاريخ)
  // SUGGESTION-6: الفواتير المحذوفة عبر API تُتتبع لتنظيف عكوس ذممها
  const deadPurchaseIds = [];
  const cleanup = async () => {
    // أولاً: قيود النطاق المؤرخ (سطورها تشير للمشروع وتمنع حذفه FK — قبل حذف المشروع)
    // عكوس الذمم بتاريخ اليوم تُنظف عبر deadPurchaseIds داخل الحلقة (بلا كنس شامل يهدد التوازي)
    await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE date LIKE '2032%')`);
    await db.run(`DELETE FROM journal_entries WHERE date LIKE '2032%'`);
    const projs = await db.query('SELECT id FROM projects WHERE name = ?', [PROJECT_NAME]);
    for (const p of projs) {
      await db.run('DELETE FROM cash_movements WHERE project_id = ?', [p.id]);
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
      // SUGGESTION-6: عكوس الذمم بتاريخ اليوم (خارج نطاق تنظيف 2032)
      const purs = await db.query('SELECT id FROM project_purchases WHERE project_id = ?', [p.id]);
      const purIds = [...purs.map(x => x.id), ...deadPurchaseIds];
      if (purIds.length > 0) {
        const pph = purIds.map(() => '?').join(',');
        const pjes = await db.query(
          `SELECT id FROM journal_entries WHERE reference_id IN (${pph})
           AND (reference_type = 'قيد عكسي' AND description LIKE '%ذمم الموردين%')`,
          purIds
        );
        const pjeIds = pjes.map(j => j.id);
        if (pjeIds.length > 0) {
          const pjph = pjeIds.map(() => '?').join(',');
          await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (${pjph})`, pjeIds);
          await db.run(`DELETE FROM journal_entries WHERE id IN (${pjph})`, pjeIds);
        }
      }
      await db.run('DELETE FROM project_purchases WHERE project_id = ?', [p.id]);
      await db.run('DELETE FROM projects WHERE id = ?', [p.id]);
    }
    await db.run(`DELETE FROM accounting_periods WHERE fiscal_year = 2032`);
    await db.run('DELETE FROM suppliers WHERE name = ?', [SUPPLIER_NAME]);
    await db.run('DELETE FROM users WHERE id = ?', [testerId]);
  };
  t.after(() => cleanup().catch(() => {}));
  await cleanup();

  // إعداد
  const passwordHash = await bcrypt.hash('test123', 4);
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'mirror_tester', ?, 'admin', 'مختبِر المرايا', 'active', '["*"]')`,
    [testerId, passwordHash]
  );
  const acc = async (code) => (await db.get('SELECT id FROM accounts WHERE code = ?', [code])).id;
  const acc511 = await acc('511');
  const acc5 = await acc('5');
  const acc111 = await acc('111');

  let r = await api('POST', '/api/projects', {
    code: 'TEST-MIR-2032', name: PROJECT_NAME, contract_value: 500000,
    status: 'active', start_date: '2032-01-01'
  });
  assert.strictEqual(r.status, 200, 'إنشاء المشروع: ' + JSON.stringify(r.data));
  const projectId = r.data.data.id;

  // SUGGESTION-6: مورد الفواتير الآجلة
  const supRes = await db.run(
    `INSERT INTO suppliers (name, category, balance) VALUES (?, 'مواد بناء', 0)`, [SUPPLIER_NAME]
  );
  const supplierId = supRes.lastInsertRowid || supRes.insertId;

  // 1. أجور مدفوعة 25,000 ← مرآة + قيد + صندوق
  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم المرايا', trade: 'بناء',
    total_amount: 25000, payment_status: 'مدفوع', date: '2032-01-10'
  });
  assert.strictEqual(r.status, 200, 'تسجيل الأجور: ' + JSON.stringify(r.data));
  const laborId = r.data.data.id;

  const mirrorLab = await db.get(`SELECT * FROM expenses WHERE receipt_no = 'EXP-LAB-${laborId}'`);
  assert.ok(mirrorLab, 'المرآة منشأة');
  assert.strictEqual(mirrorLab.status, 'posted', 'المرآة مرحّلة');
  assert.strictEqual(mirrorLab.source_table, 'project_labor_expenses');

  const jeLab = await db.get(
    `SELECT * FROM journal_entries WHERE reference_id = ? AND reference_type = 'مصروف مرآة عمالة'`,
    [mirrorLab.id]
  );
  assert.ok(jeLab, 'قيد المرآة منشأ');
  assert.strictEqual(jeLab.status, 'posted');
  const linesLab = await db.query('SELECT account_id, debit, credit, project_id, cost_center_id FROM journal_entry_lines WHERE entry_id = ?', [jeLab.id]);
  assert.ok(linesLab.find(l => l.account_id === acc511 && Number(l.debit) === 25000), 'مدين 511');
  assert.ok(linesLab.find(l => l.account_id === acc111 && Number(l.credit) === 25000), 'دائن 111');
  assert.strictEqual(Number(linesLab[0].project_id), projectId, 'القيد على المشروع');
  assert.ok(linesLab[0].cost_center_id, 'مركز تكلفة محدد');

  const cashBox = await db.query('SELECT * FROM cash_movements WHERE project_id = ? ORDER BY id ASC', [projectId]);
  assert.strictEqual(cashBox.length, 1, 'حركة صندوق واحدة');
  assert.strictEqual(Number(cashBox[0].previous_balance), 0, 'السلسلة تبدأ من الصفر');
  assert.strictEqual(Number(cashBox[0].cash_out), 25000);
  assert.strictEqual(Number(cashBox[0].current_balance), -25000);

  // 2. مشتريات 20,000 (مدفوع 15,000) ← القيد على المدفوع فقط
  r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
    item_description: 'إسمنت المرايا', total_amount: 20000,
    paid_amount: 15000, supplier_id: supplierId, date: '2032-01-11'
  });
  assert.strictEqual(r.status, 200, 'فاتورة المشتريات: ' + JSON.stringify(r.data));
  const purchaseId = r.data.data.id;

  const mirrorPur = await db.get('SELECT * FROM expenses WHERE source_table = ? AND source_id = ?', ['project_purchases', purchaseId]);
  assert.ok(mirrorPur, 'مرآة المشتريات منشأة');
  assert.strictEqual(Number(mirrorPur.amount), 15000, 'المرآة بالمدفوع فقط');
  const jePur = await db.get(
    `SELECT * FROM journal_entries WHERE reference_id = ? AND reference_type = 'مصروف مرآة مشتريات'`,
    [mirrorPur.id]
  );
  assert.ok(jePur, 'قيد مرآة المشتريات منشأ');
  const linesPur = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [jePur.id]);
  assert.ok(linesPur.find(l => l.account_id === acc5 && Number(l.debit) === 15000), 'مدين 5 بالمدفوع');
  assert.ok(linesPur.find(l => l.account_id === acc111 && Number(l.credit) === 15000), 'دائن 111 بالمدفوع');

  const boxAfter = await db.get('SELECT current_balance FROM cash_movements WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
  assert.strictEqual(Number(boxAfter.current_balance), -40000, 'الصندوق: -25k ثم -15k');

  // 3. أجور غير مدفوعة ← لا مرآة ولا قيد
  const mirCountBefore = (await db.get('SELECT COUNT(*) c FROM expenses WHERE project_id = ?', [projectId])).c;
  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم آجل', trade: 'سباكة',
    total_amount: 9000, payment_status: 'غير مدفوع', date: '2032-01-12'
  });
  assert.strictEqual(r.status, 200, 'أجور آجلة: ' + JSON.stringify(r.data));
  const unpaidLaborId = r.data.data.id;
  const mirCountAfter = (await db.get('SELECT COUNT(*) c FROM expenses WHERE project_id = ?', [projectId])).c;
  assert.strictEqual(mirCountAfter, mirCountBefore, 'لا مرآة لغير المدفوع');

  // 4. حذف الأجور المدفوعة ← عكس المرآة وإعادة النقد
  r = await api('DELETE', `/api/project-hub/${projectId}/labor/${laborId}`);
  assert.strictEqual(r.status, 200, 'حذف الأجور: ' + JSON.stringify(r.data));
  assert.ok(/عكس/.test(r.data.message || ''), 'الرسالة تعلن العكس');

  const goneLab = await db.get('SELECT id FROM project_labor_expenses WHERE id = ?', [laborId]);
  assert.strictEqual(goneLab ?? null, null, 'سجل الأصل محذوف');
  const revMirror = await db.get('SELECT * FROM expenses WHERE id = ?', [mirrorLab.id]);
  assert.strictEqual(revMirror.status, 'reversed', 'المرآة معكوسة لا محذوفة');
  const jeOrigAfter = await db.get('SELECT status FROM journal_entries WHERE id = ?', [jeLab.id]);
  assert.strictEqual(jeOrigAfter.status, 'reversed', 'القيد الأصلي معكوس');
  const revJe = await db.get(
    `SELECT * FROM journal_entries WHERE reference_id = ? AND reference_type = 'قيد عكسي' ORDER BY id DESC LIMIT 1`,
    [mirrorLab.id]
  );
  assert.ok(revJe && revJe.status === 'posted', 'قيد عكسي مرحّل موجود');
  const revLines = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [revJe.id]);
  assert.ok(revLines.find(l => l.account_id === acc111 && Number(l.debit) === 25000), 'العكس: مدين 111');
  assert.ok(revLines.find(l => l.account_id === acc511 && Number(l.credit) === 25000), 'العكس: دائن 511');

  const boxRev = await db.get('SELECT current_balance FROM cash_movements WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
  assert.strictEqual(Number(boxRev.current_balance), -15000, 'النقد عاد: -40k + 25k');

  // 5. حذف المشتريات ← عكس + الصندوق يعود صفراً
  r = await api('DELETE', `/api/project-hub/${projectId}/purchases/${purchaseId}`);
  assert.strictEqual(r.status, 200, 'حذف المشتريات: ' + JSON.stringify(r.data));
  deadPurchaseIds.push(purchaseId);
  const revMirrorPur = await db.get('SELECT status FROM expenses WHERE id = ?', [mirrorPur.id]);
  assert.strictEqual(revMirrorPur.status, 'reversed', 'مرآة المشتريات معكوسة');
  const boxZero = await db.get('SELECT current_balance FROM cash_movements WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
  assert.strictEqual(Number(boxZero.current_balance), 0, 'الصندوق عاد صفراً تماماً');

  // 6. الفترة المقفلة تمنع المرآة الجديدة
  r = await api('POST', '/api/accounting/periods', {
    period_name: 'TEST فبراير 2032', fiscal_year: 2032,
    start_date: '2032-02-01', end_date: '2032-02-29'
  });
  assert.strictEqual(r.status, 200, 'إنشاء الفترة: ' + JSON.stringify(r.data));
  const periodId = r.data.id;
  r = await api('PUT', `/api/accounting/periods/${periodId}/close`, { manager_password: 'test123' });
  assert.strictEqual(r.status, 200, 'قفل الفترة: ' + JSON.stringify(r.data));

  r = await api('POST', `/api/project-hub/${projectId}/labor`, {
    worker_name_or_team: 'طاقم المقفلة', trade: 'بناء',
    total_amount: 5000, payment_status: 'مدفوع', date: '2032-02-05'
  });
  assert.strictEqual(r.status, 403, 'المرآة في المقفلة مرفوضة');
  assert.ok(/مغلق/.test(r.data.message || ''), 'سبب الرفض: فترة مغلقة');
  const blockedSub = await db.get(`SELECT id FROM project_labor_expenses WHERE date = '2032-02-05' AND project_id = ?`, [projectId]);
  assert.strictEqual(blockedSub ?? null, null, 'لا سجل فرعي عند الرفض (ذرية)');

  // 7. الباكفيل: ينشئ للمفتوحة ويتخطى المقفلة
  const legacyOpen = await db.run(
    `INSERT INTO expenses (receipt_no, expense_type, project_id, amount, payment_method, date, notes, source_table, source_id, status)
     VALUES ('EXP-LAB-LEGACY1', 'أجور عمالة', ?, 7000, 'نقدي', '2032-01-20', 'مرآة قديمة بلا قيد', 'project_labor_expenses', 999991, 'posted')`,
    [projectId]
  );
  const legacyOpenId = legacyOpen.lastInsertRowid || legacyOpen.insertId;
  const legacyClosed = await db.run(
    `INSERT INTO expenses (receipt_no, expense_type, project_id, amount, payment_method, date, notes, source_table, source_id, status)
     VALUES ('EXP-PUR-LEGACY2', 'مواد بناء', ?, 9000, 'نقدي', '2032-02-10', 'فاتورة مشتريات: قديمة مقفلة', 'project_purchases', 999992, 'posted')`,
    [projectId]
  );
  const legacyClosedId = legacyClosed.lastInsertRowid || legacyClosed.insertId;

  const cashBeforeBf = (await db.get('SELECT COALESCE(MAX(id), 0) as m FROM cash_movements')).m;
  const bf = await ProjectCostService.backfillMirrorJEs();
  assert.ok(bf.created >= 1, 'الباكفيل أنشأ قيوداً');
  assert.ok(bf.skipped_closed >= 1, 'الباكفيل أبلغ عن متخطاة مقفلة');

  const bfJe = await db.get(
    `SELECT * FROM journal_entries WHERE reference_id = ? AND reference_type = 'مصروف مرآة عمالة'`,
    [legacyOpenId]
  );
  assert.ok(bfJe && bfJe.status === 'posted', 'مرآة المفتوحة حصلت على قيد');
  const bfCash = await db.query(`SELECT cash_out FROM cash_movements WHERE id > ? AND notes LIKE '%EXP-LAB-LEGACY1%'`, [cashBeforeBf]);
  assert.strictEqual(bfCash.length, 1, 'ومعها حركة صندوق');
  assert.strictEqual(Number(bfCash[0].cash_out), 7000);
  const bfJeClosed = await db.get(
    `SELECT id FROM journal_entries WHERE reference_id = ? AND reference_type LIKE 'مصروف مرآة%'`,
    [legacyClosedId]
  );
  assert.strictEqual(bfJeClosed ?? null, null, 'مرآة المقفلة بلا قيد');

  // 8. تنظيف (إعادة فتح الفترة أولاً)
  r = await api('PUT', `/api/accounting/periods/${periodId}/reopen`, { reason: 'تنظيف اختبار قيود المرايا' });
  assert.strictEqual(r.status, 200, 'إعادة الفتح للتنظيف');
  await db.run('DELETE FROM project_labor_expenses WHERE id = ?', [unpaidLaborId]);
  await cleanup();
});
