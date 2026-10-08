/**
 * tests/integration/client_lifecycle_chain.test.js
 * 
 * فحص تكاملي شامل لدورة حياة العميل المالية والربط الهرمي المتكامل:
 * عميل → عقد → مشاريع → مستخلصات → مطالبات → دفعات مقدمة → مبالغ محصلة → محتجزات → رصيد مستحق
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { query, get, run, transaction } = require('../../server/database/db');
const clientChainService = require('../../server/services/clientChainService');
const FinancialControlService = require('../../server/services/financialControlService');

describe('🏢 Client Lifecycle & Financial Hierarchy Chain Suite', async () => {
  let testClientId;
  let testProjectId;
  let testContractId;
  let testBillId;
  let testAdvancePaymentId;
  let testBillPaymentId;

  const runId = Date.now();
  const adminUser = { id: 1, username: 'admin', role: 'admin' };

  before(async () => {
    // 1. إنشاء عميل تجريبي
    const clientRes = await run(`
      INSERT INTO clients (name, company, phone, email, address, previous_balance, current_balance, currency)
      VALUES (?, 'مجموعة الخليج', '770001122', 'gulf@example.com', 'عدن - المعلا', 50000, 50000, 'ر.ي')
    `, [`شركة الخليج للتطوير العقاري ${runId}`]);
    testClientId = clientRes.lastInsertRowid || clientRes.insertId;

    // 2. إنشاء مشروع مرتبط بالعميل
    const projRes = await run(`
      INSERT INTO projects (code, name, client_id, contract_value, status)
      VALUES (?, 'أبراج الخليج السكنية والتجارية', ?, 500000, 'active')
    `, [`PRJ-CHAIN-${runId}`, testClientId]);
    testProjectId = projRes.lastInsertRowid || projRes.insertId;

    // 3. إنشاء عقد رسمي للمشروع مع شروط الدفعة المقدمة والمحتجزات
    const contractRes = await run(`
      INSERT INTO project_contracts (
        project_id, client_id, contract_no, title, first_party, second_party,
        contract_value, advance_payment_pct, advance_payment_amount, retention_pct, status
      ) VALUES (?, ?, ?, 'عقد تنفيذ المرحلة الأولى - أبراج الخليج', 'شركة الخليج', 'رواسي عدن', 500000, 20, 100000, 10, 'ساري')
    `, [testProjectId, testClientId, `CNT-CHAIN-${runId}`]);
    testContractId = contractRes.lastInsertRowid || contractRes.insertId;
  });

  test('1. التحقق من السلسلة الابتدائية للعميل والرصيد الافتتاحي', async () => {
    const chainData = await clientChainService.getClientLifecycleChain(testClientId);

    assert.ok(chainData.client);
    assert.ok(chainData.client.name.includes('شركة الخليج للتطوير العقاري'));
    assert.strictEqual(chainData.client.previous_balance, 50000);
    assert.strictEqual(chainData.client.current_balance, 50000);
    assert.strictEqual(chainData.financial_summary.total_contracts_value, 500000);
    assert.strictEqual(chainData.financial_summary.total_gross_billed, 0);
    assert.strictEqual(chainData.financial_summary.total_collected, 0);
    assert.strictEqual(chainData.financial_summary.outstanding_due_balance, 50000);

    assert.strictEqual(chainData.chain.contracts.length, 1);
    assert.strictEqual(chainData.chain.contracts[0].projects.length, 1);
  });

  test('2. تسجيل دفعة مقدمة على العقد وربطها التلقائي بالعميل والمشروع', async () => {
    // تسجيل سند قبض لدفعة مقدمة قدرها 100,000 ر.ي (20% من قيمة العقد)
    const payRes = await run(`
      INSERT INTO payments (
        receipt_no, type, client_id, project_id, contract_id,
        amount, local_amount, currency, payment_method, date,
        receipt_category, status, created_by, created_by_name
      ) VALUES (?, 'قبض', ?, ?, ?, 100000, 100000, 'ر.ي', 'تحويل بنكي', date('now'), 'advance_payment', 'posted', 1, 'admin')
    `, [`RC-CHAIN-ADV-${runId}`, testClientId, testProjectId, testContractId]);
    testAdvancePaymentId = payRes.lastInsertRowid || payRes.insertId;

    // مزامنة رصيد العميل
    await clientChainService.syncClientBalances(testClientId);

    const chainData = await clientChainService.getClientLifecycleChain(testClientId);
    assert.strictEqual(chainData.financial_summary.total_advance_received, 100000);
    assert.strictEqual(chainData.financial_summary.remaining_advance_balance, 100000);
    assert.strictEqual(chainData.financial_summary.total_collected, 100000);
    // الرصيد المستحق = (50,000 رصيد أول المدة + 0 مستخلصات) - 100,000 محصل = -50,000 (دائن لصالح العميل)
    assert.strictEqual(chainData.financial_summary.outstanding_due_balance, -50000);
  });

  test('3. إصدار مستخلص أعمال مع استقطاع الدفعة المقدمة والضمان آلياً من شروط العقد', async () => {
    // إجمالي الأعمال المنجزة = 200,000 ر.ي
    // سيتم استنتاج العقد واستقطاع 20% دفعة مقدمة = 40,000
    // واستقطاع 10% ضمان = 20,000
    // صافي المستخلص المطلوب = 140,000
    const resolved = await clientChainService.resolveBillContractAndClient({
      project_id: testProjectId,
      amount: 200000
    });

    assert.strictEqual(resolved.client_id, testClientId);
    assert.strictEqual(resolved.contract_id, testContractId);
    assert.strictEqual(resolved.advance_deduction, 40000);
    assert.strictEqual(resolved.retention_deduction, 20000);
    assert.strictEqual(resolved.net_amount, 140000);

    const billRes = await run(`
      INSERT INTO bills (
        bill_no, bill_type, project_id, client_id, contract_id,
        amount, gross_amount, advance_deduction, retention_deduction,
        net_amount, paid_amount, remaining_amount, payment_status, status, date
      ) VALUES (?, 'مستخلص جاري رقم 1', ?, ?, ?, 200000, 200000, 40000, 20000, 140000, 0, 140000, 'unpaid', 'معتمد', date('now'))
    `, [`INV-CHAIN-${runId}`, testProjectId, testClientId, testContractId]);
    testBillId = billRes.lastInsertRowid || billRes.insertId;

    // مزامنة رصيد العميل
    await clientChainService.syncClientBalances(testClientId);

    const chainData = await clientChainService.getClientLifecycleChain(testClientId);

    assert.strictEqual(chainData.financial_summary.total_gross_billed, 200000);
    assert.strictEqual(chainData.financial_summary.total_advance_deductions, 40000);
    assert.strictEqual(chainData.financial_summary.total_retention_deductions, 20000);
    assert.strictEqual(chainData.financial_summary.total_net_billed, 140000);

    // رصيد الدفعة المقدمة المتبقي بعد الاستقطاع = 100,000 - 40,000 = 60,000
    assert.strictEqual(chainData.financial_summary.remaining_advance_balance, 60000);

    // محتجز الضمان النشط = 20,000
    assert.strictEqual(chainData.financial_summary.active_retention_balance, 20000);

    // الرصيد المستحق = (50,000 رصيد سابق + 140,000 صافي المستخلص) - 100,000 محصل = 90,000 ر.ي
    assert.strictEqual(chainData.financial_summary.outstanding_due_balance, 90000);
  });

  test('4. سداد جزئي للمستخلص وتأثر حالة المستخلص ورصيد العميل آلياً', async () => {
    // سداد 80,000 ر.ي من صافي المستخلص (140,000)
    await clientChainService.applyPaymentToBill(testBillId, 80000);

    const bill = await get('SELECT paid_amount, remaining_amount, payment_status, status FROM bills WHERE id = ?', [testBillId]);
    assert.strictEqual(bill.paid_amount, 80000);
    assert.strictEqual(bill.remaining_amount, 60000);
    assert.strictEqual(bill.payment_status, 'partially_paid');
    assert.strictEqual(bill.status, 'محصل جزئي');

    // تسجيل سند القبض
    const payRes = await run(`
      INSERT INTO payments (
        receipt_no, type, client_id, project_id, contract_id, bill_id,
        amount, local_amount, currency, payment_method, date,
        receipt_category, status, created_by, created_by_name
      ) VALUES (?, 'قبض', ?, ?, ?, ?, 80000, 80000, 'ر.ي', 'شيك', date('now'), 'bill_collection', 'posted', 1, 'admin')
    `, [`RC-CHAIN-PARTIAL-${runId}`, testClientId, testProjectId, testContractId, testBillId]);
    testBillPaymentId = payRes.lastInsertRowid || payRes.insertId;

    await clientChainService.syncClientBalances(testClientId);

    const chainData = await clientChainService.getClientLifecycleChain(testClientId);
    // إجمالي المقبوضات = 100,000 (دفعة مقدمة) + 80,000 (تحصيل مستخلص) = 180,000
    assert.strictEqual(chainData.financial_summary.total_collected, 180000);
    // الرصيد المستحق = (50,000 + 140,000) - 180,000 = 10,000 ر.ي
    assert.strictEqual(chainData.financial_summary.outstanding_due_balance, 10000);
  });

  test('5. إكمال سداد المستخلص وتحديث حالته إلى "محصل كامل"', async () => {
    // سداد الـ 60,000 المتبقية
    await clientChainService.applyPaymentToBill(testBillId, 60000);

    const bill = await get('SELECT paid_amount, remaining_amount, payment_status, status FROM bills WHERE id = ?', [testBillId]);
    assert.strictEqual(bill.paid_amount, 140000);
    assert.strictEqual(bill.remaining_amount, 0);
    assert.strictEqual(bill.payment_status, 'paid');
    assert.strictEqual(bill.status, 'محصل كامل');

    // تسجيل سند القبض
    await run(`
      INSERT INTO payments (
        receipt_no, type, client_id, project_id, contract_id, bill_id,
        amount, local_amount, currency, payment_method, date,
        receipt_category, status, created_by, created_by_name
      ) VALUES (?, 'قبض', ?, ?, ?, ?, 60000, 60000, 'ر.ي', 'نقدي', date('now'), 'bill_collection', 'posted', 1, 'admin')
    `, [`RC-CHAIN-FULL-${runId}`, testClientId, testProjectId, testContractId, testBillId]);

    await clientChainService.syncClientBalances(testClientId);

    const chainData = await clientChainService.getClientLifecycleChain(testClientId);
    assert.strictEqual(chainData.financial_summary.total_collected, 240000);
    // المستخلص مسدد بالكامل، يتبقى فقط الرصيد السابق 50,000
    // الرصيد المستحق = (50,000 + 140,000) - 240,000 = -50,000 (لأن الـ 100,000 دفعة مقدمة كانت لجميع الأعمال ومستمرة)
    assert.strictEqual(chainData.financial_summary.outstanding_due_balance, -50000);
  });

  test('6. الإفراج عن جزء من محتجز الضمان (Retention Release)', async () => {
    // إفراج عن 15,000 من أصل 20,000 محتجزات ضمان
    await run(`
      INSERT INTO payments (
        receipt_no, type, client_id, project_id, contract_id,
        amount, local_amount, currency, payment_method, date,
        receipt_category, status, created_by, created_by_name
      ) VALUES (?, 'قبض', ?, ?, ?, 15000, 15000, 'ر.ي', 'تحويل بنكي', date('now'), 'retention_release', 'posted', 1, 'admin')
    `, [`RC-CHAIN-RET-${runId}`, testClientId, testProjectId, testContractId]);

    const chainData = await clientChainService.getClientLifecycleChain(testClientId);
    assert.strictEqual(chainData.financial_summary.total_retention_released, 15000);
    // محتجز الضمان النشط القائم = 20,000 - 15,000 = 5,000 ر.ي
    assert.strictEqual(chainData.financial_summary.active_retention_balance, 5000);
  });

  test('7. عكس سند قبض ملغي وإرجاع حالة المستخلص بدقة تامة', async () => {
    // إلغاء وعكس سداد الـ 60,000
    await clientChainService.reversePaymentFromBill(testBillId, 60000);

    const bill = await get('SELECT paid_amount, remaining_amount, payment_status, status FROM bills WHERE id = ?', [testBillId]);
    assert.strictEqual(bill.paid_amount, 80000);
    assert.strictEqual(bill.remaining_amount, 60000);
    assert.strictEqual(bill.payment_status, 'partially_paid');
    assert.strictEqual(bill.status, 'محصل جزئي');
  });

  test('8. فحص أداء استعلام العرض المجمع الحقيقي view_client_financial_profiles', async () => {
    const profile = await get('SELECT * FROM view_client_financial_profiles WHERE id = ?', [testClientId]);
    assert.ok(profile);
    assert.strictEqual(profile.client_id, testClientId);
    assert.strictEqual(profile.total_contracts_count, 1);
    assert.strictEqual(profile.total_contracts_value, 500000);
    assert.strictEqual(profile.total_projects_count, 1);
    assert.strictEqual(profile.total_bills_count, 1);
    assert.strictEqual(profile.total_gross_billed, 200000);
    assert.strictEqual(profile.total_net_billed, 140000);
    assert.strictEqual(profile.total_advance_deductions, 40000);
    assert.strictEqual(profile.total_retention_deductions, 20000);
    assert.strictEqual(profile.total_advance_received, 100000);
    assert.strictEqual(profile.remaining_advance_balance, 60000);
    assert.strictEqual(profile.total_retention_released, 15000);
    assert.strictEqual(profile.active_retention_balance, 5000);
  });
});
