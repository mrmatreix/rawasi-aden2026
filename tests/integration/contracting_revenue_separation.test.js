const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const app = require('../../server/server');
const { db, query, run } = require('../../server/database/db');
const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';

test('Contracting Accounting Engine - IFRS 15 Revenue Recognition & 8-Pillars Separation Matrix', async (t) => {
  let server;
  let baseUrl;
  let adminToken;
  let adminHeaders;
  let testProjectId;
  let testClientId;

  // 1. تشغيل خادم الاختبار
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  t.after(async () => {
    if (server) await new Promise((res) => server.close(res));
    // تنظيف بيانات الاختبار المعزولة
    if (testProjectId) {
      try {
        await run('DELETE FROM journal_entry_lines WHERE project_id = ?', [testProjectId]);
        await run('DELETE FROM contract_revenue_recognitions WHERE project_id = ?', [testProjectId]);
        await run('DELETE FROM project_change_orders WHERE project_id = ?', [testProjectId]);
        await run('DELETE FROM project_contracts WHERE project_id = ?', [testProjectId]);
        await run('DELETE FROM bills WHERE project_id = ?', [testProjectId]);
        await run('DELETE FROM payments WHERE project_id = ?', [testProjectId]);
        await run('DELETE FROM expenses WHERE project_id = ?', [testProjectId]);
        await run('DELETE FROM cost_centers WHERE project_id = ?', [testProjectId]);
        await run('DELETE FROM projects WHERE id = ?', [testProjectId]);
      } catch (e) {
        console.warn('Cleanup warning:', e.message);
      }
    }
    if (testClientId) {
      try {
        await run('DELETE FROM clients WHERE id = ?', [testClientId]);
      } catch (e) {
        console.warn('Cleanup warning:', e.message);
      }
    }
  });

  // الحصول على توكن CSRF رسمي
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf-token`);
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken || 'test-csrf-token-12345678901234567890123456789012';

  // إعداد مستخدم مدير الحسابات والتوكن
  const adminUser = await query("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
  const authUser = adminUser[0] || { id: 1, username: 'admin', role: 'admin' };
  adminToken = jwt.sign(
    { id: authUser.id, username: authUser.username, role: authUser.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`,
    'X-CSRF-Token': csrfToken,
    'X-Requested-With': 'XMLHttpRequest'
  };

  // تنظيف أي مشاريع سابقة متبقية
  const existingOldProjects = await query("SELECT id FROM projects WHERE code LIKE 'PRJ-IFRS%'");
  for (const op of existingOldProjects) {
    try {
      await run('DELETE FROM journal_entry_lines WHERE project_id = ?', [op.id]);
      await run('DELETE FROM contract_revenue_recognitions WHERE project_id = ?', [op.id]);
      await run('DELETE FROM project_change_orders WHERE project_id = ?', [op.id]);
      await run('DELETE FROM project_contracts WHERE project_id = ?', [op.id]);
      await run('DELETE FROM bills WHERE project_id = ?', [op.id]);
      await run('DELETE FROM payments WHERE project_id = ?', [op.id]);
      await run('DELETE FROM expenses WHERE project_id = ?', [op.id]);
      await run('DELETE FROM cost_centers WHERE project_id = ?', [op.id]);
      await run('DELETE FROM projects WHERE id = ?', [op.id]);
    } catch {}
  }

  // تهيئة عميل ومشروع اختباري معزول
  const clientRes = await run(`
    INSERT INTO clients (name, company, phone, current_balance)
    VALUES ('شركة الأفق الإنشائية - عميل اختباري', 'مجموعة الأفق', '770000001', 0)
  `);
  testClientId = clientRes.lastInsertRowid || clientRes.insertId;

  const uniqueCode = `PRJ-IFRS-${Date.now()}`;
  const projRes = await run(`
    INSERT INTO projects (code, name, client_id, contract_value, estimated_cost, actual_cost, progress_percentage, status)
    VALUES (?, 'مشروع مجمع الأفق التجاري (IFRS 15)', ?, 400000, 200000, 0, 0, 'active')
  `, [uniqueCode, testClientId]);
  testProjectId = projRes.lastInsertRowid || projRes.insertId;

  // عقد المشروع مع شرط دفعة مقدمة 25% (100,000) ومحتجز ضمان 10%
  await run(`
    INSERT INTO project_contracts (
      project_id, contract_no, title, contract_value, 
      advance_payment_pct, advance_payment_amount, retention_pct, status
    ) VALUES (?, 'CNT-IFRS-001', 'عقد تنفيذ مجمع الأفق التجاري', 400000, 25, 100000, 10, 'ساري')
  `, [testProjectId]);

  // =========================================================================
  // الاختبار 1: استلام دفعة مقدمة من العميل وتأكيد أنها التزام تعاقدي وليست إيراداً
  // =========================================================================
  await t.test('1. Advance Payment is Contract Liability, NOT Revenue', async () => {
    const resAdvance = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        type: 'قبض',
        client_id: testClientId,
        project_id: testProjectId,
        amount: 100000,
        receipt_category: 'advance_payment',
        payment_method: 'تحويل بنكي',
        date: '2026-09-01',
        notes: 'استلام دفعة مقدمة تعاقدية 25% لبدء تجهيزات الموقع'
      })
    });

    assert.strictEqual(resAdvance.status, 200);
    const advJson = await resAdvance.json();
    assert.strictEqual(advJson.success, true);

    // فحص القيد المحاسبي المتولد
    const je = await query(`
      SELECT je.*, jel.account_id, jel.debit, jel.credit 
      FROM journal_entries je
      JOIN journal_entry_lines jel ON je.id = jel.entry_id
      WHERE je.reference_type = 'سند قبض' AND je.reference_id = ?
    `, [advJson.id]);

    assert.ok(je.length >= 2, 'Should create balanced entry with debit and credit lines');
    const creditLine = je.find(l => Number(l.credit) > 0);
    assert.strictEqual(Number(creditLine.account_id), 18, 'Must credit Account 18 (2105 - Customer Advances Liability)');

    // التحقق عبر مصفوفة الفصل المالي
    const resMatrix = await fetch(`${baseUrl}/api/billing/contracting-matrix/${testProjectId}`, {
      headers: adminHeaders
    });
    const matrix = (await resMatrix.json()).data;

    assert.strictEqual(matrix.cash_receipts.total, 100000, 'Cash receipts must be 100,000');
    assert.strictEqual(matrix.cash_receipts.advance_received, 100000, 'Advance received must be 100,000');
    assert.strictEqual(matrix.advance_payments.unamortized_liability, 100000, 'Unamortized liability must be 100,000');
    assert.strictEqual(matrix.recognized_revenue.cumulative, 0, 'CRITICAL: Recognized Revenue MUST BE ZERO despite having 100,000 in cash!');
  });

  // =========================================================================
  // الاختبار 2: أوامر التغيير (Approved Changes affect Revenue, Pending Isolated)
  // =========================================================================
  await t.test('2. Approved Change Orders Increase Contract Value, Pending Isolated', async () => {
    // أمر تغيير معتمد بقيمة 50,000 (يعدل قيمة العقد لتصبح 450,000)
    await run(`
      INSERT INTO project_change_orders (project_id, change_no, title, amount, status, request_date, approval_date)
      VALUES (?, 'CO-01', 'إضافة مصاعد بانورامية وتوسعة المدخل الرئيسي', 50000, 'معتمد', '2026-09-02', '2026-09-05')
    `, [testProjectId]);

    // أمر تغيير معلق بقيمة 30,000 (لا يؤثر في الإيراد)
    await run(`
      INSERT INTO project_change_orders (project_id, change_no, title, amount, status, request_date)
      VALUES (?, 'CO-02', 'طلب تعديل واجهات زجاجية قيد الدراسة', 30000, 'قيد المراجعة', '2026-09-06')
    `, [testProjectId]);

    const resMatrix = await fetch(`${baseUrl}/api/billing/contracting-matrix/${testProjectId}`, {
      headers: adminHeaders
    });
    const matrix = (await resMatrix.json()).data;

    assert.strictEqual(matrix.base_contract_value, 400000);
    assert.strictEqual(matrix.variation_orders.approved_amount, 50000);
    assert.strictEqual(matrix.variation_orders.pending_amount, 30000);
    assert.strictEqual(matrix.revised_contract_value, 450000, 'Revised contract value must be 400,000 + 50,000 approved = 450,000');
  });

  // =========================================================================
  // الاختبار 3: تنفيذ تكاليف واحتساب نسبة الإنجاز POC والإيراد المعترف به (IFRS 15)
  // =========================================================================
  await t.test('3. Cost-to-Cost POC and Revenue Recognition Entry', async () => {
    // صرف تكاليف موقع بقيمة 47,500 (خرسانة وحديد)
    const resExp = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        project_id: testProjectId,
        amount: 47500,
        expense_type: 'مواد بناء',
        recipient: 'مصنع الخرسانة الجاهزة',
        payment_method: 'نقدي',
        date: '2026-09-10',
        status: 'posted',
        notes: 'صب قواعد مجمع الأفق التجاري'
      })
    });
    assert.strictEqual(resExp.status, 200);

    // فحص المقاييس المحاسبية
    // Revised Estimated Cost = 200,000 + (50,000 * 0.75) = 237,500
    // POC = 47,500 / 237,500 = 20%
    // Recognized Revenue = 450,000 * 20% = 90,000 YER
    // True Net Profit = 90,000 - 47,500 = 42,500 YER
    const resMatrix = await fetch(`${baseUrl}/api/billing/contracting-matrix/${testProjectId}`, {
      headers: adminHeaders
    });
    const matrix = (await resMatrix.json()).data;

    assert.strictEqual(matrix.cumulative_actual_cost, 47500);
    assert.strictEqual(matrix.cost_to_cost_poc_pct, 20, 'POC % must be 20%');
    assert.strictEqual(matrix.recognized_revenue.cumulative, 90000, 'Recognized Revenue must be 90,000');
    assert.strictEqual(matrix.financial_analysis.true_recognized_profit, 42500, 'True Net Profit must be 42,500');

    // إثبات الإيراد دورياً بقيد يومية رسمي (POST /api/billing/recognize-revenue)
    const resRec = await fetch(`${baseUrl}/api/billing/recognize-revenue`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        project_id: testProjectId,
        period_date: '2026-09-10',
        notes: 'إثبات إيراد إنجاز أعمال القواعد الخرسانية (20%) وفق IFRS 15'
      })
    });
    assert.strictEqual(resRec.status, 200);
    const recJson = await resRec.json();
    assert.strictEqual(recJson.success, true);
    assert.strictEqual(recJson.period_recognized_revenue, 90000);
    assert.ok(recJson.journal_entry_no, 'Must return generated journal entry number');

    // التحقق من اتزان قيد إثبات الإيراد
    const je = await query('SELECT * FROM journal_entries WHERE id = ?', [recJson.journal_entry_id]);
    assert.strictEqual(Number(je[0].total_debit), Number(je[0].total_credit), 'JE must be balanced');
    assert.strictEqual(Number(je[0].total_debit), 90000);
  });

  // =========================================================================
  // الاختبار 4: اعتماد مستخلص أعمال مع استقطاع الدفعة والضمان (IPC Compound Entry)
  // =========================================================================
  await t.test('4. Progress Billing with Advance Amortization & Retention Deduction', async () => {
    // إصدار مستخلص جاري رقم 1:
    // إجمالي الأعمال المنجزة = 70,000
    // استقطاع استهلاك دفعة مقدمة = 17,500 (25%)
    // استقطاع محتجز ضمان = 7,000 (10%)
    // صافي المستخلص المطلوب سداده = 45,500
    const resBill = await fetch(`${baseUrl}/api/billing`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        bill_type: 'مستخلص جاري رقم 1',
        project_id: testProjectId,
        client_id: testClientId,
        amount: 70000,
        advance_deduction: 17500,
        retention_deduction: 7000,
        status: 'معتمد',
        date: '2026-09-15',
        notes: 'مستخلص أعمال الحفر والقواعد الخرسانية'
      })
    });

    assert.strictEqual(resBill.status, 200);
    const billJson = await resBill.json();
    assert.strictEqual(billJson.success, true);
    assert.strictEqual(billJson.gross_amount, 70000);
    assert.strictEqual(billJson.net_amount, 45500);

    // فحص القيد المركب المتزن
    const je = await query(`
      SELECT je.*, jel.account_id, jel.debit, jel.credit 
      FROM journal_entries je
      JOIN journal_entry_lines jel ON je.id = jel.entry_id
      WHERE je.entry_no = ?
    `, [billJson.journal_entry_no]);

    assert.ok(je.length >= 4, 'Must have at least 4 lines for compound IPC entry');
    const totalDebit = je.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = je.reduce((sum, l) => sum + Number(l.credit), 0);
    assert.strictEqual(totalDebit, totalCredit, 'IPC Compound Entry must be perfectly balanced');
    assert.strictEqual(totalDebit, 70000, 'Total debit must match gross bill amount');

    // التحقق من أسطر القيد الفردية:
    const arLine = je.find(l => Number(l.account_id) === 4);
    assert.strictEqual(Number(arLine.debit), 45500, 'Accounts Receivable must be debited by net amount');

    const retLine = je.find(l => Number(l.account_id) === 16);
    assert.strictEqual(Number(retLine.debit), 7000, 'Retention Receivable must be debited by retention amount');

    const advLine = je.find(l => Number(l.account_id) === 18);
    assert.strictEqual(Number(advLine.debit), 17500, 'Customer Advances Liability must be debited by advance amortized');

    const billCreditLine = je.find(l => Number(l.account_id) === 17);
    assert.strictEqual(Number(billCreditLine.credit), 70000, 'Contract Billings/WIP must be credited by gross bill');
  });

  // =========================================================================
  // الاختبار 5: فحص ركائز WIP والأصول والالتزامات التعاقدية (IFRS 15 Pillars)
  // =========================================================================
  await t.test('5. Verification of WIP (Contract Assets) and Remaining Liabilities', async () => {
    const resMatrix = await fetch(`${baseUrl}/api/billing/contracting-matrix/${testProjectId}`, {
      headers: adminHeaders
    });
    const matrix = (await resMatrix.json()).data;

    // 1. الإيراد المعترف به (90,000) > الأعمال المفوترة (70,000)
    // أعمال تحت التنفيذ / إيراد مستحق غير مفوتر = 20,000 YER (Contract Asset / WIP)
    assert.strictEqual(
      matrix.contract_assets_and_liabilities.contract_asset_wip,
      20000,
      'Unbilled WIP / Contract Asset must be 90,000 - 70,000 = 20,000'
    );

    // 2. الدفعة المقدمة غير المستهلكة = 100,000 مستلمة - 17,500 مستهلكة = 82,500 YER (Contract Liability)
    assert.strictEqual(
      matrix.advance_payments.unamortized_liability,
      82500,
      'Remaining Advance Liability must be 82,500'
    );

    // 3. محتجز الضمان القائم = 7,000 YER (Active Contract Asset)
    assert.strictEqual(
      matrix.retention_money.active_retention_asset,
      7000,
      'Active retention asset must be 7,000'
    );

    // 4. المقارنة الصارمة: السيولة النقدية مقابل الربح المحاسبي
    // Cash Receipts = 100,000
    // Actual Cost = 47,500
    // Net Cash Flow = 100,000 - 47,500 = 52,500
    // Recognized Profit = 90,000 - 47,500 = 42,500
    assert.strictEqual(matrix.financial_analysis.net_cash_flow, 52500);
    assert.strictEqual(matrix.financial_analysis.true_recognized_profit, 42500);
    assert.strictEqual(matrix.financial_analysis.liquidity_vs_profit_gap, 10000, 'Gap = 100,000 Cash - 90,000 Revenue = +10,000');
  });

  // =========================================================================
  // الاختبار 6: فحص تقرير لوحة التحكم ومصفوفة الشركة ككل
  // =========================================================================
  await t.test('6. Company-Wide Dashboard & Financial Separation Report', async () => {
    const resDash = await fetch(`${baseUrl}/api/reports/dashboard`, {
      headers: adminHeaders
    });
    assert.strictEqual(resDash.status, 200);
    const dashJson = await resDash.json();

    assert.ok(dashJson.data.kpis.recognized_revenue > 0, 'Dashboard must expose recognized_revenue');
    assert.ok(dashJson.data.kpis.cash_receipts > 0, 'Dashboard must expose cash_receipts');
    assert.ok(dashJson.data.kpis.true_net_profit !== undefined, 'Dashboard must expose true_net_profit');
    assert.ok(dashJson.data.kpis.net_cash_flow !== undefined, 'Dashboard must expose net_cash_flow');
    assert.ok(dashJson.data.contracting_summary, 'Dashboard must include contracting_summary');

    const resSeparation = await fetch(`${baseUrl}/api/reports/contracting-financial-separation`, {
      headers: adminHeaders
    });
    assert.strictEqual(resSeparation.status, 200);
    const sepJson = await resSeparation.json();
    assert.strictEqual(sepJson.success, true);
    assert.ok(sepJson.summary.total_recognized_revenue > 0);
    assert.ok(sepJson.projects.length > 0);
  });
});
