/**
 * material_management_ddd.test.js
 * 
 * فحص وتكامل نظام إدارة المواد للمشاريع والمستودعات (DDD & Event-Driven Architecture)
 * يختبر:
 *  1. الجرد الدوري (Periodic Auditing) ولقطات تجميد الرصيد الدفتري.
 *  2. الجرد المفاجئ (Spot / Surprise Auditing) الفوري بدون إشعار مسبق.
 *  3. رصد الفروقات وحساب الفائض (Overage) والعجز (Shortage).
 *  4. ختم محضر الجرد بالتوقيع الرقمي وتشفير HMAC والتأكد من عدم التلاعب.
 *  5. تسوية المخزون الذرية (ACID) وتوليد القيود المتزنة في دفتر الأستاذ.
 *  6. عزل المواد التالفة في حجر التوالف (Damaged Materials / Quarantine).
 *  7. مرتجعات الموقع للمخزن مع فحص الجودة (QC Inspection).
 *  8. التحويل بين المشاريع مع قواعد التوجيه والرقابة الثنائية (Maker-Checker).
 *  9. سلامة سلسلة أحداث المجال المشفرة (Hash-Chain Integrity).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const MaterialManagementService = require('../../server/services/materialManagementService');
const materialDomainEventBus = require('../../server/services/materialDomainEventBus');
const { get, query, run } = require('../../server/database/db');

test('🏛️ Enterprise Material Management Suite (DDD, EDA, ACID, & Cryptographic Auditing)', async (t) => {
  let testWarehouseId = 1;
  let testProjectId1 = 1;
  let testProjectId2 = 2;
  let testItemId1 = null;
  let testItemId2 = null;

  // إعداد بيانات الاختبار
  await t.test('0. Setup test warehouses, items, and projects', async () => {
    // التأكد من وجود مستودع
    let wh = await get('SELECT id FROM warehouses LIMIT 1');
    if (!wh) {
      const whRes = await run(`
        INSERT INTO warehouses (code, name, type, location, status)
        VALUES ('WH-TEST-01', 'مستودع الاختبار المركزي', 'central', 'عدن', 'active')
      `);
      testWarehouseId = whRes.lastInsertRowid || whRes.insertId;
    } else {
      testWarehouseId = wh.id;
    }

    // إنشاء مستودع ثانٍ للتحويلات
    let wh2 = await get('SELECT id FROM warehouses WHERE id != ? LIMIT 1', [testWarehouseId]);
    if (!wh2) {
      const whRes2 = await run(`
        INSERT INTO warehouses (code, name, type, location, status)
        VALUES ('WH-TEST-02', 'مستودع المشروع الفرعي', 'site', 'المكلا', 'active')
      `);
    }

    // إنشاء صنفين للاختبار برصيد كافٍ (مع تجنب أخطاء التكرار)
    let itm1 = await get("SELECT id FROM items WHERE code = 'ITM-T1'");
    if (!itm1) {
      const itm1Res = await run(`
        INSERT INTO items (code, name, category, unit, min_quantity, current_quantity, unit_price, currency)
        VALUES ('ITM-T1', 'أسمنت بورتلاندي مقاوم', 'مواد بناء', 'كيس', 50, 200, 5000, 'ر.ي')
      `);
      testItemId1 = itm1Res.lastInsertRowid || itm1Res.insertId;
    } else {
      testItemId1 = itm1.id;
      await run('UPDATE items SET current_quantity = 200, unit_price = 5000 WHERE id = ?', [testItemId1]);
    }

    let itm2 = await get("SELECT id FROM items WHERE code = 'ITM-T2'");
    if (!itm2) {
      const itm2Res = await run(`
        INSERT INTO items (code, name, category, unit, min_quantity, current_quantity, unit_price, currency)
        VALUES ('ITM-T2', 'حديد تسليح 16 ملم', 'حديد وصلب', 'طن', 10, 50, 450000, 'ر.ي')
      `);
      testItemId2 = itm2Res.lastInsertRowid || itm2Res.insertId;
    } else {
      testItemId2 = itm2.id;
      await run('UPDATE items SET current_quantity = 50, unit_price = 450000 WHERE id = ?', [testItemId2]);
    }

    // تغذية أرصدة المستودع
    await run(`
      INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
      VALUES (?, ?, 200, 5000, 5000)
      ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = 200, average_cost = 5000
    `, [testWarehouseId, testItemId1]);

    await run(`
      INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
      VALUES (?, ?, 50, 450000, 450000)
      ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = 50, average_cost = 450000
    `, [testWarehouseId, testItemId2]);

    // التأكد من وجود مشروعين للاختبار مع رصيد تكلفة فعلي
    const p1 = await get('SELECT id FROM projects WHERE id = 1');
    if (!p1) {
      await run(`
        INSERT INTO projects (id, code, name, status, budget, actual_cost)
        VALUES (1, 'PRJ-01', 'مشروع برج رواسي عدن', 'active', 50000000, 2000000)
      `);
    } else {
      await run('UPDATE projects SET actual_cost = 2000000 WHERE id = 1');
    }
    const p2 = await get('SELECT id FROM projects WHERE id = 2');
    if (!p2) {
      await run(`
        INSERT INTO projects (id, code, name, status, budget, actual_cost)
        VALUES (2, 'PRJ-02', 'مشروع مجمع خور مكسر السكني', 'active', 80000000, 1000000)
      `);
    } else {
      await run('UPDATE projects SET actual_cost = 1000000 WHERE id = 2');
    }

    assert.ok(testWarehouseId, 'المستودع جاهز');
    assert.ok(testItemId1 && testItemId2, 'الأصناف جاهزة');
  });

  let createdAuditId = null;

  // 1. فحص الجرد الدوري وأخذ لقطة التجميد
  await t.test('1. Periodic Auditing - Takes frozen snapshot of inventory', async () => {
    const audit = await MaterialManagementService.createPeriodicAudit({
      warehouse_id: testWarehouseId,
      auditor_name: 'أ. صالح العمري (مدقق خارجي)',
      notes: 'جرد دوري للربع الأخير'
    }, { id: 1, username: 'admin' });

    assert.ok(audit.id, 'تم توليد معرف الجرد');
    assert.match(audit.audit_no, /^AUD-PER-/);
    assert.equal(audit.status, 'in_progress');
    createdAuditId = audit.id;

    // التحقق من بنود الجرد المجمدة
    const auditItems = await query('SELECT * FROM inventory_audit_items WHERE audit_id = ?', [createdAuditId]);
    assert.ok(auditItems.length >= 2, 'تم تسجيل كافة أصناف المستودع في لقطة الجرد');

    const itm1Snap = auditItems.find(i => i.item_id === testItemId1);
    assert.equal(Number(itm1Snap.system_qty), 200, 'تم تجميد رصيد الصنف الأول بدقة (200)');
  });

  // 2. فحص الجرد المفاجئ (Spot / Surprise Audit)
  await t.test('2. Spot / Surprise Auditing - On-demand unannounced audit', async () => {
    const spotAudit = await MaterialManagementService.triggerSpotAudit({
      warehouse_id: testWarehouseId,
      auditor_name: 'د. نبيل الشرجبي (مدير التدقيق الداخلي)',
      category_filter: 'حديد وصلب',
      notes: 'فحص فوري مفاجئ لمخزون الحديد'
    }, { id: 1, username: 'auditor' });

    assert.ok(spotAudit.id);
    assert.match(spotAudit.audit_no, /^AUD-SPT-/);
    assert.equal(spotAudit.category_filter, 'حديد وصلب');

    const spotItems = await query(`
      SELECT ai.*, i.category 
      FROM inventory_audit_items ai
      JOIN items i ON ai.item_id = i.id
      WHERE ai.audit_id = ?
    `, [spotAudit.id]);

    assert.ok(spotItems.every(i => i.category === 'حديد وصلب'), 'تم تطبيق فلترة التصنيف في الجرد المفاجئ بدقة');
  });

  // 3. فحص رصد كميات العد الفعلي وحساب الفروقات (الفائض والعجز)
  await t.test('3. Discrepancy Handling - Computes Overage & Shortage accurately', async () => {
    // الصنف الأول: العد الفعلي 210 (فائض 10 أكياس = 10 * 5000 = 50,000)
    // الصنف الثاني: العد الفعلي 48 (عجز 2 طن = 2 * 450,000 = 900,000)
    const result = await MaterialManagementService.recordPhysicalCounts(createdAuditId, [
      { item_id: testItemId1, physical_qty: 210, condition_status: 'good', auditor_notes: 'فائض توريد سابق' },
      { item_id: testItemId2, physical_qty: 48, condition_status: 'good', auditor_notes: 'عجز تشغيلي' }
    ], { id: 1, username: 'auditor' });

    assert.equal(result.total_overage_qty, 10, 'حساب كمية الفائض صحيح (10)');
    assert.equal(result.total_shortage_qty, 2, 'حساب كمية العجز صحيح (2)');
    assert.equal(result.total_overage_amount, 50000, 'قيمة الفائض صحيحة (50,000)');
    assert.equal(result.total_shortage_amount, 900000, 'قيمة العجز صحيحة (900,000)');
    assert.equal(result.net_variance_amount, 50000 - 900000, 'صافي انحراف الجرد دقيق (-850,000)');
  });

  // 4. فحص ختم محضر الجرد بالتوقيع الرقمي وتشفير HMAC
  let sealedHash = null;
  await t.test('4. Audit Minutes Sealing & HMAC Digital Verification', async () => {
    const sealRes = await MaterialManagementService.sealAuditMinutes(createdAuditId, {
      auditor_name: 'أ. صالح العمري (مدقق خارجي)',
      witness_name: 'م. سالم (أمين المستودع)',
      digital_signature: 'SIG-RSA-SHA256-RAWASI-VALID-TOKEN',
      notes: 'تم إنهاء أعمال الجرد وتوقيع المحضر رسمياً'
    }, { id: 1, username: 'auditor' });

    assert.equal(sealRes.status, 'minutes_sealed');
    assert.ok(sealRes.hash_signature, 'تم توليد الختم المشفر HMAC');
    sealedHash = sealRes.hash_signature;

    // التحقق من صحة الوثيقة المشفرة
    const verification = await MaterialManagementService.verifyAuditMinutesIntegrity(createdAuditId);
    assert.equal(verification.isValid, true, 'تم التحقق بنجاح من سلامة محضر الجرد');
    assert.equal(verification.stored_hash, sealedHash);
  });

  // 5. فحص تسوية المخزون بامتثال ACID وتوليد قيود دفتر الأستاذ المتزنة
  await t.test('5. Stock Reconciliation - ACID updates and balanced GL journal posting', async () => {
    const recRes = await MaterialManagementService.reconcileStockAudit(createdAuditId, {
      id: 1,
      username: 'financial_controller'
    });

    assert.equal(recRes.success, true);
    assert.equal(recRes.status, 'reconciled');
    assert.ok(recRes.journal_entry_no, 'تم توليد رقم قيد اليومية');

    // 1. التحقق من تحديث أرصدة المستودع لتطابق العد الفعلي بدقة
    const whStock1 = await get('SELECT quantity FROM warehouse_stocks WHERE warehouse_id = ? AND item_id = ?', [testWarehouseId, testItemId1]);
    const whStock2 = await get('SELECT quantity FROM warehouse_stocks WHERE warehouse_id = ? AND item_id = ?', [testWarehouseId, testItemId2]);
    assert.equal(Number(whStock1.quantity), 210, 'تمت تسوية رصيد الصنف الأول إلى 210');
    assert.equal(Number(whStock2.quantity), 48, 'تمت تسوية رصيد الصنف الثاني إلى 48');

    // 2. التحقق من اتزان القيد المحاسبي (Debit == Credit)
    const jv = await get('SELECT * FROM journal_entries WHERE id = ?', [recRes.journal_entry_id]);
    assert.ok(jv);
    assert.equal(Number(jv.total_debit), Number(jv.total_credit), 'القيد المحاسبي متزن تماماً (Debit == Credit)');

    // 3. التحقق من أسطر القيد المحاسبي للعجز والفائض
    const lines = await query('SELECT * FROM journal_entry_lines WHERE entry_id = ?', [recRes.journal_entry_id]);
    assert.ok(lines.length >= 4, 'يتضمن القيد أسطر إثبات العجز وأسطر إثبات الفائض');
  });

  // 6. فحص المواد التالفة وعزلها في صندوق خردة/حجر صحي
  let quarantineId = null;
  await t.test('6. Damaged Materials - Quarantine Bin and loss write-off', async () => {
    const qrt = await MaterialManagementService.quarantineDamagedMaterial({
      warehouse_id: testWarehouseId,
      item_id: testItemId1,
      quantity: 5,
      reason: 'تلف بسبب تسرب مياه الأمطار إلى المستودع',
      inspection_notes: 'تم فحص الشكائر وثبوت تحجر الأسمنت بالكامل',
      bin_location: 'SCRAP_BIN_C',
      project_id: 1
    }, { id: 1, username: 'storekeeper' });

    assert.ok(qrt.id);
    assert.match(qrt.quarantine_no, /^QRT-/);
    assert.equal(qrt.status, 'quarantined');
    assert.equal(qrt.total_loss_amount, 5 * 5000);
    quarantineId = qrt.id;

    // التأكد من خصم الكمية من الرصيد الصالح للاستخدام بالمستودع (210 - 5 = 205)
    const whStock = await get('SELECT quantity FROM warehouse_stocks WHERE warehouse_id = ? AND item_id = ?', [testWarehouseId, testItemId1]);
    assert.equal(Number(whStock.quantity), 205, 'تم خصم الكمية التالفة من رصيد المستودع الصالح');

    // فحص معالجة حجر التوالف (إتلاف نهائي)
    const resolveRes = await MaterialManagementService.resolveQuarantinedMaterial(quarantineId, {
      action: 'scrapped',
      resolution_notes: 'تم اعتماد محضر الإتلاف الرسمي بحضور لجنة السلامة'
    }, { id: 1, username: 'general_manager' });

    assert.equal(resolveRes.status, 'scrapped');
  });

  // 7. فحص إرجاع المواد من الموقع للمخزن وفحص الجودة (QC Inspection)
  await t.test('7. Site-to-Warehouse Return with QC Inspection', async () => {
    const initialPrj = await get('SELECT actual_cost FROM projects WHERE id = 1');
    const initialCost = Number(initialPrj.actual_cost);

    const returnRes = await MaterialManagementService.processSiteMaterialReturnWithQC({
      project_id: 1,
      warehouse_id: testWarehouseId,
      item_id: testItemId1,
      quantity: 10,
      condition_status: 'good',
      qc_inspector_name: 'م. أحمد باعبيد (مدير الجودة)',
      qc_notes: 'المواد بحالة ممتازة صالحة للاستخدام المباشر'
    }, { id: 1, username: 'qc_engineer' });

    assert.equal(returnRes.status, 'reconciled');
    assert.equal(returnRes.credited_amount, 10 * 5000);

    // التحقق من استعادة المخزون بالمستودع (205 + 10 = 215)
    const updatedStock = await get('SELECT quantity FROM warehouse_stocks WHERE warehouse_id = ? AND item_id = ?', [testWarehouseId, testItemId1]);
    assert.equal(Number(updatedStock.quantity), 215, 'تمت استعادة المواد المرتجعة للمستودع');

    // التحقق من تخفيض التكلفة الفعلية للمشروع
    const updatedPrj = await get('SELECT actual_cost FROM projects WHERE id = 1');
    assert.equal(Number(updatedPrj.actual_cost), initialCost - (10 * 5000), 'تم تخفيض تكلفة المشروع بالقيمة المعادة');
  });

  // 8. فحص التحويل بين المشاريع والرقابة الثنائية Maker-Checker
  await t.test('8. Inter-Project Transfers - Strict Routing Rules & Maker-Checker', async () => {
    const trfReq = await MaterialManagementService.requestInterProjectTransfer({
      from_project_id: 1,
      to_project_id: 2,
      from_warehouse_id: testWarehouseId,
      to_warehouse_id: 2,
      item_id: testItemId1,
      quantity: 15,
      notes: 'تحويل مواد فائضة لتغطية مرحلة الصب بالمجمع السكني'
    }, { id: 1, username: 'site_eng_1' });

    assert.ok(trfReq.id);
    assert.equal(trfReq.status, 'requested');

    // 🔒 صمام الأمان: منع نفس المستخدم من اعتماد التحويل (Maker-Checker Violation)
    await assert.rejects(
      async () => {
        await MaterialManagementService.approveInterProjectTransfer(trfReq.id, { approved: true }, { id: 1, username: 'site_eng_1' });
      },
      /انتهاك لمبدأ الرقابة الثنائية/
    );

    // اعتماد التحويل بمستخدم مختلف (Checker)
    const p1Before = await get('SELECT actual_cost FROM projects WHERE id = 1');
    const p2Before = await get('SELECT actual_cost FROM projects WHERE id = 2');

    const approveRes = await MaterialManagementService.approveInterProjectTransfer(trfReq.id, { approved: true }, { id: 2, username: 'financial_manager' });
    assert.equal(approveRes.status, 'approved');

    // التحقق من نقل التكلفة بين المشروعين
    const p1After = await get('SELECT actual_cost FROM projects WHERE id = 1');
    const p2After = await get('SELECT actual_cost FROM projects WHERE id = 2');
    const transferValue = 15 * 5000;

    assert.equal(Number(p1After.actual_cost), Number(p1Before.actual_cost) - transferValue, 'تم خصم التكلفة من المشروع المصدر');
    assert.equal(Number(p2After.actual_cost), Number(p2Before.actual_cost) + transferValue, 'تمت إضافة التكلفة للمشروع المستلم');
  });

  // 9. فحص سلامة سلسلة أحداث المجال المشفرة (Cryptographic Hash-Chain)
  await t.test('9. Cryptographic Domain Event Hash-Chain Integrity', async () => {
    const chainCheck = await materialDomainEventBus.verifyChainIntegrity();
    assert.equal(chainCheck.isValid, true, 'سلسلة أحداث المجال المشفرة متصلة وسليمة 100%');
    assert.ok(chainCheck.verifiedCount > 0, 'تم توثيق كافة الأحداث بنجاح');
  });
});
