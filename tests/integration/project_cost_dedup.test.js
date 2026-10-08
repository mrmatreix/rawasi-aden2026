/**
 * اختبار منع الازدواج عند الإدخال (Cost Dedup)
 * ============================================================================
 * - ربط بند فرعي بسند رسمي يمتصه (يُحتسب السند فقط عند الترحيل).
 * - الربط الجزئي: السند + متبقي البند.
 * - العكس يعيد البند للاحتساب تلقائياً.
 * - رفض الربط المزدوج، وتحذيرات الاشتباه غير الحاجبة.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('Project Cost Dedup - Link Absorption & Duplicate Warnings', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'cost-dedup-test-csrf-token-1234567890123456789012345678901';
  const testerId = 7202;
  const today = new Date().toISOString().split('T')[0];
  const PROJECT_NAME = 'TEST-DEDUP مشروع اختبار منع الازدواج';
  const SUPPLIER_NAME = 'TEST-SUP-DEDUP مورد اختبار الازدواج';
  const SUPPLIER2_NAME = 'TEST-SUP-DEDUP-2 مورد التعارض';

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt.sign(
      { id: testerId, username: 'cost_dedup_tester', role: 'admin', permissions: ['*'] },
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

  // SUGGESTION-7: الفواتير المحذوفة عبر API تُتتبع لتنظيف قيود ذممها (صفوفها تزول)
  const deadPurchaseIds = [];
  const cleanup = async () => {
    try {
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
        await db.run('DELETE FROM inventory_transactions WHERE project_id = ?', [p.id]);
        // SUGGESTION-8: قيود الأجور (استحقاق/تسوية/عكوسها) المرتبطة بسجلات أجور المشروع
        const labs = await db.query('SELECT id FROM project_labor_expenses WHERE project_id = ?', [p.id]);
        const labIds = labs.map(x => x.id);
        if (labIds.length > 0) {
          const lph = labIds.map(() => '?').join(',');
          const ljes = await db.query(
            `SELECT id FROM journal_entries WHERE reference_id IN (${lph})
             AND (reference_type IN ('مستحق أجور — عمالة موقعية', 'سداد مستحق أجور')
                  OR (reference_type = 'قيد عكسي' AND description LIKE '%لمستحقات الأجور%'))`,
            labIds
          );
          const ljeIds = ljes.map(j => j.id);
          if (ljeIds.length > 0) {
            const ljph = ljeIds.map(() => '?').join(',');
            await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (${ljph})`, ljeIds);
            await db.run(`DELETE FROM journal_entries WHERE id IN (${ljph})`, ljeIds);
          }
        }
        await db.run('DELETE FROM project_labor_expenses WHERE project_id = ?', [p.id]);
        // SUGGESTION-6: قيود الذمم (استحقاق/تسوية/عكوسها) المرتبطة بفواتير المشروع
        const purs = await db.query('SELECT id FROM project_purchases WHERE project_id = ?', [p.id]);
        const purIds = [...purs.map(x => x.id), ...deadPurchaseIds];
        if (purIds.length > 0) {
          const pph = purIds.map(() => '?').join(',');
          const pjes = await db.query(
            `SELECT id FROM journal_entries WHERE reference_id IN (${pph})
             AND (reference_type IN ('مستحق مورد — مشتريات موقعية', 'سداد مستحق موقعية')
                  OR (reference_type = 'قيد عكسي' AND description LIKE '%ذمم الموردين%'))`,
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
      await db.run('DELETE FROM suppliers WHERE name = ?', [SUPPLIER_NAME]);
      await db.run('DELETE FROM suppliers WHERE name = ?', [SUPPLIER2_NAME]);
      await db.run('DELETE FROM users WHERE id = ?', [testerId]);
    } catch {}
  };

  await cleanup();
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'cost_dedup_tester', ?, 'admin', 'مختبر منع الازدواج', 'active', '["*"]')`,
    [testerId, bcrypt.hashSync('Pass@123456', 10)]
  );

  try {
    // 1. مشروع اختبار
    let r = await api('POST', '/api/projects', {
      name: PROJECT_NAME, contract_value: 500000, estimated_cost: 300000
    });
    assert.strictEqual(r.status, 200, 'إنشاء المشروع: ' + JSON.stringify(r.data));
    const projectId = r.data.id;

    // SUGGESTION-6: مورد الفواتير الآجلة
    const supRes = await db.run(
      `INSERT INTO suppliers (name, category, balance) VALUES (?, 'مواد بناء', 0)`, [SUPPLIER_NAME]
    );
    const supplierId = supRes.lastInsertRowid || supRes.insertId;
    const supRes2 = await db.run(
      `INSERT INTO suppliers (name, category, balance) VALUES (?, 'مواد بناء', 0)`, [SUPPLIER2_NAME]
    );
    const supplier2Id = supRes2.lastInsertRowid || supRes2.insertId;

    // 2. أجور غير مدفوعة 60,000 (بلا مرآة) ← التكلفة = 60,000
    r = await api('POST', `/api/project-hub/${projectId}/labor`, {
      worker_name_or_team: 'طاقم الازدواج', trade: 'نجارة',
      total_amount: 60000, payment_status: 'غير مدفوع', date: today
    });
    assert.strictEqual(r.status, 200, 'تسجيل الأجور: ' + JSON.stringify(r.data));
    const laborId = r.data.data.id;

    let proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 60000, 'التكلفة بعد الأجور');

    // 3. سند مرحل 60,000 مربوط بالأجور ← التكلفة تبقى 60,000 (لا 120,000)
    r = await api('POST', '/api/expenses', {
      expense_type: 'أجور عمالة', project_id: projectId, amount: 60000,
      payment_method: 'نقدي', date: today, link_labor_id: laborId
    });
    assert.strictEqual(r.status, 200, 'سند مرتبط: ' + JSON.stringify(r.data));
    assert.ok(r.data.link_note, 'يجب إرجاع ملاحظة الربط');
    const linkedExpenseId = r.data.id;

    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 60000, 'البند الممتص لا يُحتسب مرتين');

    // 4. التفصيل يكشف الامتصاص
    r = await api('GET', `/api/projects/${projectId}/cost-breakdown`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.data.breakdown.expenses, 60000, 'السند محتسب');
    assert.strictEqual(r.data.data.breakdown.labor, 0, 'الأجور الممتصة صفر');
    assert.strictEqual(r.data.data.breakdown.labor_absorbed, 60000, 'الممتص 60k');
    assert.strictEqual(r.data.data.linked_items.length, 1, 'بند مربوط واحد ظاهر');

    // 5. عكس السند ← الأجور تعود للاحتساب تلقائياً (60,000)
    r = await api('POST', `/api/expenses/${linkedExpenseId}/reverse`, {
      reason: 'اختبار فك الامتصاص بالعكس', reversal_date: today
    });
    assert.strictEqual(r.status, 200, 'العكس: ' + JSON.stringify(r.data));
    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 60000, 'بعد العكس تعود الأجور للاحتساب');

    // 6. ربط نفس البند بسند آخر ← مرفوض (مربوط مسبقاً)
    r = await api('POST', '/api/expenses', {
      expense_type: 'أجور عمالة', project_id: projectId, amount: 60000,
      payment_method: 'نقدي', date: today, link_labor_id: laborId
    });
    assert.strictEqual(r.status, 500, 'الربط المزدوج يجب أن يُرفض');
    assert.match(r.data.message, /مربوط مسبقاً/, 'رسالة الربط المسبق');

    // 7. ربط مزدوج (أجور + مشتريات معاً) ← مرفوض
    r = await api('POST', '/api/expenses', {
      expense_type: 'مواد بناء', project_id: projectId, amount: 10000,
      payment_method: 'نقدي', date: today, link_labor_id: laborId, link_purchase_id: 1
    });
    assert.strictEqual(r.status, 400, 'ربط بندين معاً مرفوض');

    // 8. ربط جزئي: فاتورة 80,000 + سند 30,000 ← 30k سند + 50k متبقي
    r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
      item_description: 'حديد للازدواج', total_amount: 80000,
      paid_amount: 0, supplier_id: supplierId, date: today
    });
    assert.strictEqual(r.status, 200, 'الفاتورة: ' + JSON.stringify(r.data));
    const purchaseId = r.data.data.id;

    r = await api('POST', '/api/expenses', {
      expense_type: 'مواد بناء', project_id: projectId, amount: 30000,
      payment_method: 'نقدي', date: today, link_purchase_id: purchaseId
    });
    assert.strictEqual(r.status, 200, 'سند جزئي: ' + JSON.stringify(r.data));
    assert.match(r.data.link_note || '', /جزئي/, 'ملاحظة الربط الجزئي');
    const linkedPurExpenseId = r.data.id;

    r = await api('GET', `/api/projects/${projectId}/cost-breakdown`);
    const bd = r.data.data.breakdown;
    assert.strictEqual(bd.purchases, 50000, 'متبقي الفاتورة 50k');
    assert.strictEqual(bd.purchases_absorbed, 30000, 'الممتص 30k');
    // الإجمالي: 60 أجور + 30 سند مواد + 50 متبقي فاتورة = 140
    assert.strictEqual(bd.total, 140000, 'الإجمالي بعد الربط الجزئي');

    // 9. ربط مسودة عبر PUT ثم حذفها ← يُفك الربط تلقائياً
    r = await api('POST', `/api/project-hub/${projectId}/labor`, {
      worker_name_or_team: 'طاقم المسودة', total_amount: 20000,
      payment_status: 'غير مدفوع', date: today
    });
    const labor2Id = r.data.data.id;

    r = await api('POST', '/api/expenses', {
      expense_type: 'أجور عمالة', project_id: projectId, amount: 20000,
      payment_method: 'نقدي', date: today, status: 'draft'
    });
    const draftId = r.data.id;

    r = await api('PUT', `/api/expenses/${draftId}`, { link_labor_id: labor2Id });
    assert.strictEqual(r.status, 200, 'ربط المسودة: ' + JSON.stringify(r.data));
    let link = await db.get('SELECT linked_expense_id FROM project_labor_expenses WHERE id = ?', [labor2Id]);
    assert.strictEqual(Number(link.linked_expense_id), Number(draftId), 'الربط محفوظ');

    r = await api('DELETE', `/api/expenses/${draftId}`);
    assert.strictEqual(r.status, 200, 'حذف المسودة');
    link = await db.get('SELECT linked_expense_id FROM project_labor_expenses WHERE id = ?', [labor2Id]);
    assert.strictEqual(link.linked_expense_id, null, 'حذف المسودة يفك الربط');

    // 10. تحذيرات الاشتباه: مصروف مباشر ثم بند بنفس المبلغ
    r = await api('POST', '/api/expenses', {
      expense_type: 'نقل ومواصلات', project_id: projectId, amount: 25000,
      payment_method: 'نقدي', date: today
    });
    assert.strictEqual(r.status, 200);

    r = await api('POST', `/api/project-hub/${projectId}/labor`, {
      worker_name_or_team: 'طاقم مشتبه', total_amount: 25000,
      payment_status: 'غير مدفوع', date: today
    });
    assert.strictEqual(r.status, 200, 'البند المشتبه يُحفظ (التحذير غير حاجب)');
    assert.ok(Array.isArray(r.data.warnings), 'الاستجابة تتضمن warnings');
    assert.ok(r.data.warnings.length > 0, 'يجب وجود تحذير اشتباه');
    assert.ok(r.data.warnings.some(w => w.kind === 'expense'), 'التحذير يشير للمصروف المشابه');

    // 11. السند المرتبط سدادٌ: الذمة تنخفض والمسدد يتراكم والقيد مدين 21 (SUGGESTION-7)
    const acc21 = (await db.get("SELECT id FROM accounts WHERE code = '21'")).id;
    const acc111 = (await db.get("SELECT id FROM accounts WHERE code = '111'")).id;
    const acc5 = (await db.get("SELECT id FROM accounts WHERE code = '5'")).id;
    const suppAfter = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.strictEqual(Number(suppAfter.balance), 50000, 'الذمة = 80k استحقاق − 30k تسوية');
    const purAfter = await db.get('SELECT paid_amount, payment_status FROM project_purchases WHERE id = ?', [purchaseId]);
    assert.strictEqual(Number(purAfter.paid_amount), 30000, 'مسدد الفاتورة تراكمي');
    assert.strictEqual(purAfter.payment_status, 'جزئي');
    const settleJe = await db.get(
      `SELECT * FROM journal_entries WHERE reference_type = 'سند صرف' AND reference_id = ?`, [linkedPurExpenseId]
    );
    assert.ok(settleJe, 'قيد السند المرتبط موجود');
    const settleLines = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [settleJe.id]);
    assert.ok(settleLines.find(l => l.account_id === acc21 && Number(l.debit) === 30000), 'مدين 21 بالتسوية');
    assert.ok(settleLines.find(l => l.account_id === acc111 && Number(l.credit) === 30000), 'دائن 111 بالتسوية');
    assert.ok(!settleLines.find(l => l.account_id === acc5 && Number(l.debit) > 0), 'لا مدين 5 ثانيةً (لا ازدواج GL)');
    const apStill = await db.get(
      `SELECT status FROM journal_entries WHERE reference_type = 'مستحق مورد — مشتريات موقعية' AND reference_id = ?`, [purchaseId]
    );
    assert.strictEqual(apStill.status, 'posted', 'قيد الاستحقاق الأصلي قائم');

    // 12. ربط فوق المتبقي ← 400 (فاتورة نقدية مكتملة: المتبقي صفر)
    r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
      item_description: 'رمل الازدواج', total_amount: 20000,
      paid_amount: 20000, date: today
    });
    assert.strictEqual(r.status, 200, 'فاتورة خطوة 12: ' + JSON.stringify(r.data));
    const fullCashPurId = r.data.data.id;
    r = await api('POST', '/api/expenses', {
      expense_type: 'مواد بناء', project_id: projectId, amount: 5000,
      payment_method: 'نقدي', date: today, link_purchase_id: fullCashPurId
    });
    assert.strictEqual(r.status, 400, 'الربط فوق المتبقي مرفوض');
    assert.match(r.data.message || '', /يتجاوز المتبقي/, 'سبب الرفض: تجاوز المتبقي');

    // 13. مورد السند يخالف مورد الفاتورة ← 400 (فاتورة مستقلة ثم حذفها لفك أثرها)
    r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
      item_description: 'حديد التعارض', total_amount: 80000,
      paid_amount: 0, supplier_id: supplierId, date: today
    });
    assert.strictEqual(r.status, 200, 'فاتورة خطوة 13: ' + JSON.stringify(r.data));
    const clashPurId = r.data.data.id;
    r = await api('POST', '/api/expenses', {
      expense_type: 'مواد بناء', project_id: projectId, amount: 10000, supplier_id: supplier2Id,
      payment_method: 'نقدي', date: today, link_purchase_id: clashPurId
    });
    assert.strictEqual(r.status, 400, 'تعارض المورد مرفوض');
    assert.match(r.data.message || '', /لا يطابق/, 'سبب الرفض: عدم التطابق');
    r = await api('DELETE', `/api/project-hub/${projectId}/purchases/${clashPurId}`);
    assert.strictEqual(r.status, 200, 'حذف فاتورة التعارض يفك استحقاقها');
    deadPurchaseIds.push(clashPurId);
    const suppClash = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.strictEqual(Number(suppClash.balance), 50000, 'الذمة عادت لوضعها بعد فك الاستحقاق');

    // 14. حذف الممتص محظور حتى العكس ← ثم الفك الكامل
    r = await api('DELETE', `/api/project-hub/${projectId}/purchases/${purchaseId}`);
    assert.strictEqual(r.status, 400, 'حذف الفاتورة المرتبطة بسند مرحل مرفوض');
    assert.match(r.data.message || '', /مرتبطة بسند مرحل/, 'سبب الرفض: سند مرحل');
    r = await api('POST', `/api/expenses/${linkedPurExpenseId}/reverse`, {
      reason: 'اختبار استعادة التسوية بالعكس', reversal_date: today
    });
    assert.strictEqual(r.status, 200, 'عكس سند التسوية: ' + JSON.stringify(r.data));
    const suppRev = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.strictEqual(Number(suppRev.balance), 80000, 'العكس يستعيد الذمة كاملة');
    const purRev = await db.get('SELECT paid_amount, payment_status FROM project_purchases WHERE id = ?', [purchaseId]);
    assert.strictEqual(Number(purRev.paid_amount), 0, 'العكس يستعيد المسدد');
    assert.strictEqual(purRev.payment_status, 'غير مدفوع');
    const revJe = await db.get(
      `SELECT * FROM journal_entries WHERE reference_type = 'قيد عكسي سند صرف' AND reference_id = ?`, [linkedPurExpenseId]
    );
    assert.ok(revJe, 'القيد العكسي موجود');
    const revLines = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [revJe.id]);
    assert.ok(revLines.find(l => l.account_id === acc111 && Number(l.debit) === 30000), 'العكس مدين 111');
    assert.ok(revLines.find(l => l.account_id === acc21 && Number(l.credit) === 30000), 'العكس دائن 21');
    r = await api('DELETE', `/api/project-hub/${projectId}/purchases/${purchaseId}`);
    assert.strictEqual(r.status, 200, 'الحذف بعد العكس مسموح: ' + JSON.stringify(r.data));
    deadPurchaseIds.push(purchaseId);
    const suppDel = await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.strictEqual(Number(suppDel.balance), 0, 'حذف الفاتورة يصفّر ذمتها');

    console.log('✅ منع الازدواج: جميع الفحوصات (14) ناجحة');
  } finally {
    await cleanup();
  }
});
