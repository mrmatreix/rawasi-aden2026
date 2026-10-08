/**
 * اختبار توحيد التكلفة الفعلية للمشاريع (Unified Project Cost)
 * ============================================================================
 * يتحقق من أن actual_cost تُشتق من مصدر موحد واحد:
 *   مصروفات مباشرة (مرحلة/معتمدة) + صافي الصرف المخزني + أجور + مشتريات فرعية
 * وأن المصروفات المرآة لا تُحتسب مرتين، وأن الإدخال اليدوي مرفوض.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('Project Cost Unification - Single Source of Truth', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'cost-unify-test-csrf-token-12345678901234567890123456789012';
  const testerId = 7201;
  const today = new Date().toISOString().split('T')[0];
  const PROJECT_NAME = 'TEST-UNIFIED-COST مشروع اختبار توحيد التكلفة';
  const ITEM_NAME = 'TEST-ITEM-UNIFIED-COST';
  const SUPPLIER_NAME = 'TEST-SUP-UNIFIED-COST مورد اختبار التوحيد';

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt.sign(
      { id: testerId, username: 'cost_unify_tester', role: 'admin', permissions: ['*'] },
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
        await db.run('DELETE FROM project_labor_expenses WHERE project_id = ?', [p.id]);
        // SUGGESTION-6: قيود الذمم (استحقاق/تسوية/عكوسها) المرتبطة بفواتير المشروع
        const purs = await db.query('SELECT id FROM project_purchases WHERE project_id = ?', [p.id]);
        const purIds = purs.map(x => x.id);
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
      await db.run('DELETE FROM items WHERE name = ?', [ITEM_NAME]);
      await db.run('DELETE FROM suppliers WHERE name = ?', [SUPPLIER_NAME]);
      await db.run('DELETE FROM users WHERE id = ?', [testerId]);
    } catch {}
  };

  await cleanup();
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'cost_unify_tester', ?, 'admin', 'مختبر توحيد التكلفة', 'active', '["*"]')`,
    [testerId, bcrypt.hashSync('Pass@123456', 10)]
  );

  try {
    // 1. إنشاء مشروع مع محاولة حقن تكلفة يدوية — يجب أن تُتجاهل وتبدأ صفراً
    let r = await api('POST', '/api/projects', {
      name: PROJECT_NAME,
      contract_value: 1200000,
      estimated_cost: 800000,
      actual_cost: 999999
    });
    assert.strictEqual(r.status, 200, 'إنشاء المشروع: ' + JSON.stringify(r.data));
    const projectId = r.data.id;
    assert.ok(projectId, 'يجب أن يرجع معرف المشروع');

    // SUGGESTION-6: مورد الفواتير الآجلة
    const supRes = await db.run(
      `INSERT INTO suppliers (name, category, balance) VALUES (?, 'مواد بناء', 0)`, [SUPPLIER_NAME]
    );
    const supplierId = supRes.lastInsertRowid || supRes.insertId;

    let proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 0, 'التكلفة اليدوية يجب أن تُتجاهل وتبدأ صفراً');

    // 2. محاولة تعديل التكلفة يدوياً عبر PUT — يجب أن تُتجاهل
    r = await api('PUT', `/api/projects/${projectId}`, { actual_cost: 555555 });
    assert.strictEqual(r.status, 200, 'تعديل المشروع يجب أن ينجح (مع تجاهل التكلفة)');
    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 0, 'التعديل اليدوي للتكلفة يجب أن يُتجاهل');

    // 3. سند مصروف مرحل 100,000 ← التكلفة = 100,000
    r = await api('POST', '/api/expenses', {
      expense_type: 'مواد بناء',
      project_id: projectId,
      amount: 100000,
      payment_method: 'نقدي',
      date: today,
      notes: 'اختبار توحيد التكلفة'
    });
    assert.strictEqual(r.status, 200, 'إنشاء المصروف: ' + JSON.stringify(r.data));
    assert.strictEqual(r.data.status, 'posted');
    const expenseId = r.data.id;

    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 100000, 'التكلفة بعد المصروف المرحل');

    // 4. أجور ميدانية مدفوعة 50,000 ← التكلفة = 150,000 (مرة واحدة لا مرتين)
    r = await api('POST', `/api/project-hub/${projectId}/labor`, {
      worker_name_or_team: 'طاقم الاختبار',
      trade: 'بناء',
      total_amount: 50000,
      payment_status: 'مدفوع',
      date: today
    });
    assert.strictEqual(r.status, 200, 'تسجيل الأجور: ' + JSON.stringify(r.data));
    const laborId = r.data.data.id;

    // المصروف المرآة يجب أن يكون مربوطاً بالمصدر
    const mirror = await db.get(
      "SELECT * FROM expenses WHERE receipt_no = 'EXP-LAB-" + laborId + "'"
    );
    assert.ok(mirror, 'يجب إنشاء مصروف مرآة للأجور المدفوعة');
    assert.strictEqual(mirror.source_table, 'project_labor_expenses', 'المرآة مربوطة بجدول الأجور');
    assert.strictEqual(Number(mirror.source_id), Number(laborId), 'المرآة مربوطة بسجل الأجور');

    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 150000, 'الأجور تُحتسب مرة واحدة (150k لا 200k)');

    // 5. فاتورة مشتريات فرعية إجمالي 80,000 (مدفوع 30,000) ← التكلفة = 230,000
    r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
      item_description: 'إسمنت للاختبار',
      quantity: 100,
      unit_price: 800,
      total_amount: 80000,
      paid_amount: 30000,
      supplier_id: supplierId,
      date: today
    });
    assert.strictEqual(r.status, 200, 'فاتورة المشتريات: ' + JSON.stringify(r.data));

    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 230000, 'المشتريات تُحتسب بإجماليها مرة واحدة');

    // 6. صرف مخزني 10 × 1,000 ← التكلفة = 240,000
    r = await api('POST', '/api/inventory/items', {
      name: ITEM_NAME,
      category: 'اختبار',
      unit: 'كيس',
      current_quantity: 100,
      unit_price: 1000
    });
    assert.strictEqual(r.status, 200, 'إنشاء الصنف: ' + JSON.stringify(r.data));
    const item = await db.get('SELECT id FROM items WHERE name = ?', [ITEM_NAME]);

    r = await api('POST', '/api/inventory/transactions', {
      item_id: item.id,
      project_id: projectId,
      type: 'out',
      quantity: 10,
      date: today,
      recipient: 'مهندس الاختبار'
    });
    assert.strictEqual(r.status, 200, 'الصرف المخزني: ' + JSON.stringify(r.data));

    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 240000, 'التكلفة بعد الصرف المخزني');

    // 7. تفصيل التكلفة يطابق المجموع والحقل المخزن (لا انحراف)
    r = await api('GET', `/api/projects/${projectId}/cost-breakdown`);
    assert.strictEqual(r.status, 200, 'تفصيل التكلفة: ' + JSON.stringify(r.data));
    const bd = r.data.data;
    assert.strictEqual(bd.breakdown.expenses, 100000, 'بند المصروفات المباشرة');
    assert.strictEqual(bd.breakdown.labor, 50000, 'بند الأجور');
    assert.strictEqual(bd.breakdown.purchases, 80000, 'بند المشتريات');
    assert.strictEqual(bd.breakdown.inventory_net, 10000, 'بند صافي المخزون');
    assert.strictEqual(bd.unified_total, 240000, 'الإجمالي الموحد');
    assert.strictEqual(bd.is_consistent, true, 'لا انحراف بين المحتسب والمخزن');

    // 8. عكس سند المصروف ← التكلفة = 140,000
    r = await api('POST', `/api/expenses/${expenseId}/reverse`, {
      reason: 'اختبار عكس توحيد التكلفة',
      reversal_date: today
    });
    assert.strictEqual(r.status, 200, 'عكس المصروف: ' + JSON.stringify(r.data));

    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 140000, 'التكلفة بعد العكس');

    // 9. حذف الأجور ← عكس المرآة ذات القيد (لا حذف فيزيائي) والتكلفة = 90,000
    r = await api('DELETE', `/api/project-hub/${projectId}/labor/${laborId}`);
    assert.strictEqual(r.status, 200, 'حذف الأجور: ' + JSON.stringify(r.data));

    const orphan = await db.get("SELECT id, status FROM expenses WHERE receipt_no = 'EXP-LAB-" + laborId + "'");
    assert.ok(orphan, 'المرآة ذات القيد تُعكس ولا تُحذف فيزيائياً');
    assert.strictEqual(orphan.status, 'reversed', 'حالة المرآة بعد حذف الأصل: معكوسة');

    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 90000, 'التكلفة بعد حذف الأجور والمرآة');

    // 10. تفاصيل المشروع تتضمن التفصيل الموحد
    r = await api('GET', `/api/projects/${projectId}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.data.cost_breakdown, 'تفاصيل المشروع تتضمن cost_breakdown');
    assert.strictEqual(r.data.data.cost_breakdown.total, 90000);

    console.log('✅ توحيد التكلفة: جميع الفحوصات (10) ناجحة');
  } finally {
    await cleanup();
  }
});
