/**
 * tests/integration/project_closeout_cqrs.test.js
 * 
 * فحص تكاملي شامل لوحدة إغلاق المشروع وتقارير التحليلات بنمط CQRS
 * 1. التحقق من أمر الإغلاق (CloseProjectCommand) ومادية نماذج القراءة
 * 2. التحقق من الحسابات الدقيقة لمؤشرات دورة حياة المواد (المستخلص الداخلي)
 *    - BaselineQuantity, PurchasedQuantity, ReceivedQuantity, IssuedQuantity, ConsumedQuantity, SiteStockBalance, RemainingBaseline
 * 3. التحقق الصارم من حدود الأمان والسرية لمستخلص العميل (Client BoQ DTO):
 *    - التأكد التام من عدم تسريب التكاليف الفعلية أو أسعار الشراء أو نسب الهدر أو هوامش الربح
 * 4. التحقق من أمر إعادة فتح المشروع (ReopenProjectCommand)
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { query, get, run, transaction } = require('../../server/database/db');
const ProjectCloseoutService = require('../../server/services/projectCloseoutService');

describe('🏗️ CQRS Project Closeout & BoQ Analytics Suite', async () => {
  let testProjectId;
  let testBoqItem1Id;
  let testBoqItem2Id;
  let adminUser = { id: 1, username: 'admin_audit', role: 'admin' };

  before(async () => {
    // إنشاء مشروع تجريبي مخصص للاختبار برمز فريد
    const uniqueCode = 'PRJ-CQRS-' + Date.now();
    const pRes = await run(`
      INSERT INTO projects (
        code, name, client_id, contract_value, estimated_cost,
        actual_cost, status, currency
      ) VALUES (?, 'مشروع برج الأفق السكني والتجاري (اختبار CQRS)', 1, 15000000, 10500000, 8200000, 'active', 'ر.ي')
    `, [uniqueCode]);
    testProjectId = pRes.lastInsertRowid;

    // إنشاء بندين في جدول الكميات BOQ
    // البند 1: أعمال حفر وتربة (Baseline: 500 م3، بسعر 4,000 ر.ي)
    const boq1Res = await run(`
      INSERT INTO project_boq (
        project_id, item_no, description, category, unit,
        contract_qty, executed_qty, unit_rate, total_amount, status
      ) VALUES (?, '1.01', 'حفر في تربة صخرية متماسكة وتجهيز المنسوب', 'أعمال ترابية', 'م3', 500, 420, 4000, 2000000, 'جاري التنفيذ')
    `, [testProjectId]);
    testBoqItem1Id = boq1Res.lastInsertRowid;

    // البند 2: أعمال خرسانة مسلحة (Baseline: 200 م3، بسعر 50,000 ر.ي)
    const boq2Res = await run(`
      INSERT INTO project_boq (
        project_id, item_no, description, category, unit,
        contract_qty, executed_qty, unit_rate, total_amount, status
      ) VALUES (?, '2.01', 'خرسانة مسلحة عيار 350 كجم للقواعد والميدات', 'أعمال خرسانية', 'م3', 200, 180, 50000, 10000000, 'جاري التنفيذ')
    `, [testProjectId]);
    testBoqItem2Id = boq2Res.lastInsertRowid;

    // محاكاة دورة حياة المواد للبند 2 (الخرسانة):
    // تم صرف 210 م3 للموقع، بينما المنفذ هندسياً 180 م3
    await run(`
      INSERT INTO inventory_transactions (
        item_id, project_id, boq_item_id, type, quantity,
        unit_price, total_amount, reference_no, date, notes
      ) VALUES (1, ?, ?, 'out', 210, 36000, 7560000, 'TX-OUT-CQRS-01', date('now'), 'صرف خرسانة لموقع المشروع 2.01')
    `, [testProjectId, testBoqItem2Id]);

    // محاكاة مواد مرتجعة من الموقع للمستودع: 10 م3
    await run(`
      INSERT INTO site_material_returns (
        return_no, project_id, warehouse_id, item_id, boq_item_id,
        quantity, unit_price, total_amount, condition_status, qc_inspector_name, credited_amount, return_date, status
      ) VALUES ('RET-CQRS-' || ?, ?, 1, 1, ?, 10, 36000, 360000, 'good', 'م. فاحص الجودة', 360000, date('now'), 'posted')
    `, [Date.now(), testProjectId, testBoqItem2Id]);

    // محاكاة حجر مواد تالفة: 5 م3
    await run(`
      INSERT INTO material_quarantine_items (
        quarantine_no, warehouse_id, item_id, project_id, quantity,
        unit_cost, total_loss_amount, reason, quarantined_by, status
      ) VALUES ('QRN-CQRS-' || ?, 1, 1, ?, 5, 36000, 180000, 'تشققات وسوء توريد', 1, 'quarantined')
    `, [Date.now(), testProjectId]);
  });

  test('1. Live Preview Query before closeout generates both read views', async () => {
    const summary = await ProjectCloseoutService.getCloseoutSummary(testProjectId);
    assert.equal(summary.is_closed, false);
    assert.ok(summary.financials.total_billed_amount > 0);

    const clientPreview = await ProjectCloseoutService.getClientBoQReport(testProjectId);
    assert.equal(clientPreview.totals.is_materialized, false);
    assert.equal(clientPreview.items.length, 2);

    const auditPreview = await ProjectCloseoutService.getInternalAuditBoQReport(testProjectId);
    assert.equal(auditPreview.summary.is_materialized, false);
    assert.equal(auditPreview.items.length, 2);
  });

  test('2. CloseProjectCommand closes project and materializes CQRS views atomically', async () => {
    const command = {
      projectId: testProjectId,
      closeoutDate: '2026-10-04',
      notes: 'إغلاق وتسليم المشروع النهائي مع اعتماد المستخلصات',
      closedByName: 'م. رئيس قسم المشاريع'
    };

    const res = await ProjectCloseoutService.closeProject(command, adminUser);
    assert.equal(res.success, true);
    assert.ok(res.data.closeoutNo.startsWith('CLOSEOUT-PRJ-'));
    assert.ok(res.data.hashSignature.length > 20);

    // التحقق من تحديث حالة المشروع في قاعدة البيانات
    const updatedProject = await get('SELECT status FROM projects WHERE id = ?', [testProjectId]);
    assert.equal(updatedProject.status, 'completed');

    // التحقق من وجود السجل الرئيسي في project_closeouts
    const closeoutRow = await get('SELECT * FROM project_closeouts WHERE id = ?', [res.data.closeoutId]);
    assert.equal(closeoutRow.status, 'closed');
    assert.equal(closeoutRow.project_id, testProjectId);
  });

  test('3. Client BoQ Read Model (مستخلص العميل) - Strict Security & Zero Internal Cost Leakage', async () => {
    const clientReport = await ProjectCloseoutService.getClientBoQReport(testProjectId);
    
    assert.equal(clientReport.report_type, 'CLIENT_FINAL_BILLING_BOQ');
    assert.equal(clientReport.totals.is_materialized, true);
    assert.equal(clientReport.items.length, 2);

    // فحص البند الأول
    const b1 = clientReport.items.find(i => i.item_no === '1.01');
    assert.equal(b1.contract_qty, 500);
    assert.equal(b1.billed_qty, 420);
    assert.equal(b1.contract_unit_rate, 4000);
    assert.equal(b1.billable_amount, 420 * 4000); // 1,680,000
    assert.equal(b1.retention_amount, (1680000 * 5.0) / 100); // 84,000
    assert.equal(b1.net_payable, 1680000 - 84000); // 1,596,000

    // 🛡️ فحص حظر تسريب التكاليف الداخلية: التأكد من عدم وجود أي مؤشر تكلفة داخلية
    clientReport.items.forEach(item => {
      assert.equal(item.actual_unit_cost, undefined, 'Actual unit cost must NOT exist in Client DTO');
      assert.equal(item.total_actual_cost, undefined, 'Total actual cost must NOT exist in Client DTO');
      assert.equal(item.gross_profit, undefined, 'Gross profit must NOT exist in Client DTO');
      assert.equal(item.profit_margin_percent, undefined, 'Profit margin must NOT exist in Client DTO');
      assert.equal(item.cost_variance, undefined, 'Cost variance must NOT exist in Client DTO');
      assert.equal(item.purchased_qty, undefined, 'Purchased quantity must NOT exist in Client DTO');
      assert.equal(item.wastage_qty, undefined, 'Wastage quantity must NOT exist in Client DTO');
      assert.equal(item.wastage_percent, undefined, 'Wastage percentage must NOT exist in Client DTO');
      assert.equal(item.budgeted_cost, undefined, 'Budgeted cost must NOT exist in Client DTO');
      assert.equal(item.supplier_id, undefined, 'Supplier info must NOT exist in Client DTO');
    });
  });

  test('4. Internal Audit BoQ Read Model (مستخلص الرقابة والتدقيق) - Exact 7 Lifecycle Metrics', async () => {
    const auditReport = await ProjectCloseoutService.getInternalAuditBoQReport(testProjectId);

    assert.equal(auditReport.report_type, 'INTERNAL_AUDIT_CONTROL_BOQ');
    assert.equal(auditReport.summary.is_materialized, true);
    assert.equal(auditReport.items.length, 2);

    // فحص البند الثاني (الخرسانة 2.01):
    // Baseline: 200, Issued: 210, Consumed: 180, Returned: 10
    const b2 = auditReport.items.find(i => i.item_no === '2.01');
    assert.ok(b2, 'BoQ item 2.01 must be present');

    // 1. BaselineQuantity (الكمية المقدرة/الأساسية)
    assert.equal(b2.BaselineQuantity, 200);

    // 2. IssuedQuantity (الكمية المصروفة للموقع)
    assert.equal(b2.IssuedQuantity, 210);

    // 3. ConsumedQuantity (الكمية المستهلكة فعلياً في التنفيذ)
    assert.equal(b2.ConsumedQuantity, 180);

    // 4. SiteStockBalance (الرصيد المتبقي بموقع المشروع) = (IssuedQuantity - ConsumedQuantity - Returned)
    // 210 - 180 - 10 = 20
    assert.equal(b2.SiteStockBalance, 20);

    // 5. RemainingBaseline (المتبقي من الأساسي) = (BaselineQuantity - ConsumedQuantity)
    // 200 - 180 = 20
    assert.equal(b2.RemainingBaseline, 20);

    // 6. ReturnedQuantity & DamagedQuantity
    assert.equal(b2.ReturnedQuantity, 10);
    assert.equal(b2.DamagedQuantity, 5);

    // 7. مؤشرات التباين المالي والربحية
    assert.ok(b2.ContractRevenue > 0);
    assert.ok(b2.TotalActualCost > 0);
    assert.ok(b2.GrossProfit !== undefined);
    assert.ok(b2.ProfitMarginPercent > 0);
  });

  test('5. Cannot double-close without forceClose flag', async () => {
    await assert.rejects(
      async () => {
        await ProjectCloseoutService.closeProject({ projectId: testProjectId }, adminUser);
      },
      /المشروع مغلق مسبقاً/
    );
  });

  test('6. ReopenProjectCommand reopens project and updates closeout status', async () => {
    const res = await ProjectCloseoutService.reopenProject({
      projectId: testProjectId,
      reason: 'استدراك محضر تسليم ملحق للأعمال الترابية'
    }, adminUser);

    assert.equal(res.success, true);

    const prj = await get('SELECT status FROM projects WHERE id = ?', [testProjectId]);
    assert.equal(prj.status, 'active');

    const closeoutRow = await get('SELECT status FROM project_closeouts WHERE project_id = ? ORDER BY id DESC LIMIT 1', [testProjectId]);
    assert.equal(closeoutRow.status, 'reopened');
  });
});
