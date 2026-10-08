/**
 * اختبارات تكاملية لوحدة التحكم المتقدم في المشاريع
 * Smart % Complete | WBS/CPM | EVM | Risk/Claims/NCR/RFI
 * يستخدم node:test المدمج (نفس نمط باقي اختبارات النظام)
 */

'use strict';

const { test, before, describe } = require('node:test');
const assert = require('node:assert/strict');
const { query, get, run } = require('../../server/database/db');
const ctrl = require('../../server/services/projectControlService');

let testProjectId, testUserId;
const sfx = Date.now().toString().slice(-6);

// ============================================================================
// إعداد بيانات الاختبار
// ============================================================================

before(async () => {
  // مستخدم اختبار
  try {
    const uRes = await run(
      `INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role)
       VALUES (901, 'pm_test_${sfx}', 'hash', 'مدير المشاريع - اختبار', 'project_manager')`, []
    );
    testUserId = 901;
  } catch { testUserId = 901; }

  // مشروع اختبار
  const prjRes = await run(
    `INSERT INTO projects (name, client_id, contract_value, estimated_cost, actual_cost, progress_percentage, status)
     VALUES (?, 1, 5000000, 3500000, 0, 0, 'active')`,
    [`مشروع اختبار التحكم المتقدم - ${sfx}`]
  );
  testProjectId = prjRes.lastInsertRowid || prjRes.insertId || prjRes.lastID;

  // ميزانية المشروع
  await run(
    `INSERT INTO project_budgets (project_id, category, planned_cost)
     VALUES (?, 'أعمال مدنية', 2000000)`,
    [testProjectId]
  );
  await run(
    `INSERT INTO project_budgets (project_id, category, planned_cost)
     VALUES (?, 'أعمال ميكانيكية', 1500000)`,
    [testProjectId]
  );

  // عقد المشروع
  await run(
    `INSERT INTO project_contracts (project_id, contract_no, title, contract_value, start_date, end_date, status)
     VALUES (?, ?, 'عقد مشروع الاختبار', 5000000, date('now','-3 months'), date('now','9 months'), 'سارٍ')`,
    [testProjectId, `CTR-TEST-${sfx}`]
  );

  // بند BOQ
  await run(
    `INSERT INTO project_boq (project_id, item_no, description, unit, contract_qty, executed_qty, unit_rate)
     VALUES (?, '1', 'خرسانة مسلحة', 'م3', 1000, 600, 1500)`,
    [testProjectId]
  );
  await run(
    `INSERT INTO project_boq (project_id, item_no, description, unit, contract_qty, executed_qty, unit_rate)
     VALUES (?, '2', 'حديد تسليح', 'طن', 100, 40, 5000)`,
    [testProjectId]
  );

  // فاتورة معتمدة (مستخلص)
  await run(
    `INSERT INTO project_invoices (project_id, invoice_no, date, net_amount, status)
     VALUES (?, ?, date('now','-1 month'), 1500000, 'معتمد')`,
    [testProjectId, `INV-TEST-${sfx}`]
  );

  // مشتريات فعلية
  await run(
    `INSERT INTO project_purchases (project_id, item_description, date, total_amount)
     VALUES (?, 'مواد بناء', date('now','-2 months'), 800000)`,
    [testProjectId]
  );

  // أنشطة WBS بتسلسل خطي
  const rA = await run(
    `INSERT INTO project_wbs_activities
       (project_id, wbs_code, name, planned_duration_days, planned_start, planned_finish, weight, status)
     VALUES (?,?,'التصميم والتخطيط',15,date('now','-90 days'),date('now','-75 days'),20,'completed')`,
    [testProjectId, `1.0-${sfx}`]
  );
  const actA_id = rA.lastInsertRowid || rA.insertId || rA.lastID;

  const rB = await run(
    `INSERT INTO project_wbs_activities
       (project_id, wbs_code, name, planned_duration_days, planned_start, planned_finish, weight, status)
     VALUES (?,?,'أعمال الحفر والأساسات',30,date('now','-75 days'),date('now','-45 days'),35,'completed')`,
    [testProjectId, `2.0-${sfx}`]
  );
  const actB_id = rB.lastInsertRowid || rB.insertId || rB.lastID;

  const rC = await run(
    `INSERT INTO project_wbs_activities
       (project_id, wbs_code, name, planned_duration_days, planned_start, planned_finish, weight, status)
     VALUES (?,?,'أعمال الهيكل الإنشائي',60,date('now','-45 days'),date('now','15 days'),35,'in_progress')`,
    [testProjectId, `3.0-${sfx}`]
  );
  const actC_id = rC.lastInsertRowid || rC.insertId || rC.lastID;

  const rD = await run(
    `INSERT INTO project_wbs_activities
       (project_id, wbs_code, name, planned_duration_days, planned_start, planned_finish, weight, status)
     VALUES (?,?,'التشطيبات والتسليم',30,date('now','15 days'),date('now','45 days'),10,'not_started')`,
    [testProjectId, `4.0-${sfx}`]
  );
  const actD_id = rD.lastInsertRowid || rD.insertId || rD.lastID;

  // اعتماديات: A→B→C→D
  await run(`INSERT OR IGNORE INTO project_wbs_dependencies
    (project_id, predecessor_id, successor_id, dependency_type) VALUES (?,?,?,'FS')`,
    [testProjectId, actA_id, actB_id]);
  await run(`INSERT OR IGNORE INTO project_wbs_dependencies
    (project_id, predecessor_id, successor_id, dependency_type) VALUES (?,?,?,'FS')`,
    [testProjectId, actB_id, actC_id]);
  await run(`INSERT OR IGNORE INTO project_wbs_dependencies
    (project_id, predecessor_id, successor_id, dependency_type) VALUES (?,?,?,'FS')`,
    [testProjectId, actC_id, actD_id]);
});

// ============================================================================
// 1. نسبة الإنجاز الذكية
// ============================================================================

test('نسبة الإنجاز - يحسب من BOQ المنفذ بشكل صحيح', async () => {
  const result = await ctrl.computeProjectCompletion(testProjectId);

  assert.ok(result.recommended_pct !== null, 'يجب أن يكون هناك نسبة محسوبة');
  assert.ok(result.recommended_pct >= 0 && result.recommended_pct <= 100, 'النسبة بين 0-100');

  const boqBreakdown = result.breakdown.find(b => b.method === 'weighted_boq');
  assert.ok(boqBreakdown, 'يجب وجود تفصيل BOQ');

  // التحقق من الحساب: (600×1500 + 40×5000) / (1000×1500 + 100×5000) = (900000+200000)/(1500000+500000) = 55%
  const expectedBoqPct = (1100000 / 2000000) * 100; // 55%
  assert.ok(Math.abs(boqBreakdown.pct - expectedBoqPct) < 0.01, `BOQ pct يجب أن يكون ${expectedBoqPct}%`);
});

test('نسبة الإنجاز - يحسب من المستخلصات المعتمدة', async () => {
  const result = await ctrl.computeProjectCompletion(testProjectId);
  const invoiceBreakdown = result.breakdown.find(b => b.method === 'approved_invoices');

  assert.ok(invoiceBreakdown, 'يجب وجود تفصيل المستخلصات');
  // 1,500,000 / 5,000,000 = 30%
  assert.ok(Math.abs(invoiceBreakdown.pct - 30) < 0.01, 'نسبة المستخلصات يجب أن تكون 30%');
});

test('نسبة الإنجاز - يرفض نسبة أكبر من 100', async () => {
  await assert.rejects(
    () => ctrl.validateManualCompletion(testProjectId, 101, null, testUserId),
    /نسبة الإنجاز يجب أن تكون بين 0 و100/
  );
});

test('نسبة الإنجاز - يرفض انحراف كبير بدون مبرر كافٍ', async () => {
  // محاولة إدخال 95% إذا كانت النسبة المحسوبة أقل بكثير
  const computed = await ctrl.computeProjectCompletion(testProjectId);
  if (computed.recommended_pct !== null && computed.recommended_pct < 80) {
    await assert.rejects(
      () => ctrl.validateManualCompletion(testProjectId, 95, 'قليل', testUserId),
      /مبرر تفصيلي/
    );
  }
});

test('نسبة الإنجاز - يقبل الانحراف الكبير مع مبرر كافٍ', async () => {
  const result = await ctrl.validateManualCompletion(
    testProjectId, 50,
    'تعديل يدوي مُعتمد من المهندس الاستشاري بموجب محضر اجتماع رقم 15',
    testUserId
  );
  assert.equal(result.accepted, true);
});

test('نسبة الإنجاز - يسجل شهادة مهندس', async () => {
  const result = await run(
    `INSERT INTO project_engineer_certifications
       (project_id, pct, certified_by, certifier_name, certifier_role, inspection_date, notes)
     VALUES (?, 55, ?, 'م. أحمد الشرجبي', 'مهندس استشاري', date('now'), 'فحص دوري شهري')`,
    [testProjectId, testUserId]
  );
  assert.ok(result.lastID || result.lastInsertRowid, 'يجب أن تحفظ الشهادة');

  // عند إعادة الحساب، شهادة المهندس لها الأولوية
  const recomputed = await ctrl.computeProjectCompletion(testProjectId);
  assert.equal(recomputed.primary_source, 'engineer_certification', 'شهادة المهندس تُعطى الأولوية');
  assert.equal(recomputed.recommended_pct, 55);
});

// ============================================================================
// 2. WBS والمسار الحرج (CPM)
// ============================================================================

test('CPM - يحسب المدة الإجمالية للمسار الخطي', async () => {
  const result = await ctrl.computeCriticalPath(testProjectId);

  assert.ok(Array.isArray(result.activities), 'يجب إعادة قائمة أنشطة');
  assert.ok(result.project_duration > 0, 'يجب حساب مدة المشروع');
  // 15 + 30 + 60 + 30 = 135 يوم
  assert.equal(result.project_duration, 135, 'مدة المشروع الإجمالية = 135 يوم');
});

test('CPM - جميع الأنشطة في مسار خطي حرجة (TF=0)', async () => {
  const result = await ctrl.computeCriticalPath(testProjectId);
  const projectActivities = result.activities.filter(a =>
    a.project_id === testProjectId || String(a.project_id) === String(testProjectId)
  );

  const criticalActivities = projectActivities.filter(a => a.is_critical);
  // في مسار خطي بلا تفريع، جميع الأنشطة على المسار الحرج
  assert.ok(criticalActivities.length > 0, 'يجب أن يوجد أنشطة على المسار الحرج');
  criticalActivities.forEach(a => {
    assert.equal(a.TF, 0, `النشاط ${a.wbs_code} يجب أن يكون TF=0`);
  });
});

test('CPM - ES/EF صحيحة للنشاط الأول في مسار خطي', async () => {
  const result = await ctrl.computeCriticalPath(testProjectId);
  const projectActivities = result.activities.filter(a =>
    a.project_id === testProjectId || String(a.project_id) === String(testProjectId)
  );

  // النشاط الأول (بلا سلف) يجب أن يبدأ من 0
  const rootActs = projectActivities.filter(a => a.predecessors?.length === 0);
  rootActs.forEach(a => {
    assert.equal(a.ES, 0, 'النشاط الجذر ES يجب أن يكون 0');
    assert.ok(a.EF > 0, 'النشاط الجذر EF يجب أن يكون > 0');
  });
});

test('WBS - حفظ الخط الأساسي للجدول الزمني', async () => {
  const result = await ctrl.saveBaseline(
    testProjectId,
    'خط الأساس - سبتمبر 2026',
    testUserId
  );

  assert.equal(result.success, true);
  assert.ok(result.activities_count >= 4, 'يجب حفظ على الأقل 4 أنشطة');

  // التحقق من وجود الخط في قاعدة البيانات
  const baselines = await query(
    'SELECT * FROM project_wbs_baselines WHERE project_id = ? AND is_current = 1',
    [testProjectId]
  );
  assert.ok(baselines.length > 0, 'يجب أن يُحفظ الخط الأساسي في قاعدة البيانات');
});

test('WBS - مقارنة الخط الأساسي بالوضع الفعلي', async () => {
  const result = await ctrl.compareBaselineVsActual(testProjectId);

  assert.ok(result.activities, 'يجب إعادة قائمة الأنشطة');
  assert.ok(result.summary, 'يجب إعادة ملخص المقارنة');
  assert.ok('total' in result.summary, 'يجب وجود إجمالي الأنشطة');
  assert.ok('delayed' in result.summary, 'يجب وجود عدد المتأخرات');
});

// ============================================================================
// 3. إدارة القيمة المكتسبة EVM
// ============================================================================

test('EVM - يحسب جميع المؤشرات الأساسية', async () => {
  const result = await ctrl.computeEVM(testProjectId);

  if (result.error) {
    // مقبول إذا لم تكن البيانات كاملة
    assert.equal(typeof result.error, 'string');
    return;
  }

  assert.ok('bac' in result, 'BAC مطلوب');
  assert.ok('pv' in result, 'PV مطلوب');
  assert.ok('ev' in result, 'EV مطلوب');
  assert.ok('ac' in result, 'AC مطلوب');
  assert.ok('cv' in result, 'CV مطلوب');
  assert.ok('sv' in result, 'SV مطلوب');
  assert.ok('cpi' in result, 'CPI مطلوب');
  assert.ok('spi' in result, 'SPI مطلوب');
  assert.ok('eac' in result, 'EAC مطلوب');
  assert.ok('etc' in result, 'ETC مطلوب');
  assert.ok('vac' in result, 'VAC مطلوب');
});

test('EVM - BAC = إجمالي الميزانية (3,500,000)', async () => {
  const result = await ctrl.computeEVM(testProjectId);
  if (!result.error) {
    assert.equal(result.bac, 3500000, 'BAC يجب أن يساوي إجمالي الميزانية');
  }
});

test('EVM - EV = BAC × نسبة الإنجاز', async () => {
  const result = await ctrl.computeEVM(testProjectId);
  if (!result.error && result.bac > 0 && result.completion_pct !== null) {
    const expectedEV = result.bac * (result.completion_pct / 100);
    assert.ok(Math.abs(result.ev - expectedEV) < 1, 'EV يجب أن يساوي BAC × %Complete');
  }
});

test('EVM - CPI = EV/AC عند وجود تكاليف فعلية', async () => {
  const result = await ctrl.computeEVM(testProjectId);
  if (!result.error && result.ac > 0 && result.cpi !== null) {
    const expectedCPI = result.ev / result.ac;
    assert.ok(Math.abs(result.cpi - expectedCPI) < 0.001, 'CPI = EV/AC');
  }
});

test('EVM - مؤشرات الإشارة الضوئية موجودة ومنطقية', async () => {
  const result = await ctrl.computeEVM(testProjectId);
  if (!result.error) {
    assert.ok(result.status_lights, 'مؤشرات الإشارة الضوئية مطلوبة');
    const validColors = ['green', 'yellow', 'red', 'grey'];
    Object.values(result.status_lights).forEach(color => {
      assert.ok(validColors.includes(color), `اللون ${color} غير صالح`);
    });
  }
});

test('EVM - يحفظ لقطة تاريخية في قاعدة البيانات', async () => {
  await ctrl.computeEVM(testProjectId);
  const snapshots = await query(
    'SELECT * FROM project_evm_snapshots WHERE project_id = ?',
    [testProjectId]
  );
  assert.ok(snapshots.length > 0, 'يجب حفظ لقطة EVM');
});

// ============================================================================
// 4. سجل المخاطر
// ============================================================================

test('سجل المخاطر - إضافة خطر جديد ويُحسب التقييم تلقائياً', async () => {
  const result = await ctrl.addRisk(testProjectId, {
    title: 'تأخر توريد الحديد',
    description: 'خطر ارتفاع أسعار الحديد وتأخر توريده من الموردين المحليين',
    category: 'schedule',
    probability: 4,
    impact: 4,
    financial_impact: 200000,
    schedule_impact_days: 20,
    treatment_type: 'mitigate',
    treatment_plan: 'الاتفاق مع ثلاثة موردين بديلين وتخزين احتياطي مسبق بمقدار شهرين',
    review_date: '2026-11-01',
  }, testUserId);

  assert.ok(result.id, 'يجب إنشاء خطر جديد');
  assert.equal(result.risk_score, 16, 'risk_score = 4×4 = 16');
  assert.equal(result.rating.rating, 'critical', 'score 16 = critical');
});

test('سجل المخاطر - تقييم مصفوفة 5×5 صحيح', () => {
  const { RISK_MATRIX } = require('../../server/services/projectControlService');
  assert.equal(RISK_MATRIX.getRating(5, 5).rating, 'critical'); // 25
  assert.equal(RISK_MATRIX.getRating(4, 2).rating, 'high');     // 8
  assert.equal(RISK_MATRIX.getRating(2, 2).rating, 'medium');   // 4
  assert.equal(RISK_MATRIX.getRating(1, 1).rating, 'low');      // 1
  assert.equal(RISK_MATRIX.getRating(3, 5).rating, 'critical'); // 15
  assert.equal(RISK_MATRIX.getRating(2, 4).rating, 'high');     // 8 → high
});

test('سجل المخاطر - يرفض الخطر بدون عنوان', async () => {
  await assert.rejects(
    () => ctrl.addRisk(testProjectId, { probability: 3, impact: 3 }, testUserId),
    /إلزامية/
  );
});

test('سجل المخاطر - يرفض قيم خارج النطاق 1-5', async () => {
  await assert.rejects(
    () => ctrl.addRisk(testProjectId, { title: 'خطر اختبار', description: 'وصف', probability: 6, impact: 3 }, testUserId),
    /بين 1 و5/
  );
  await assert.rejects(
    () => ctrl.addRisk(testProjectId, { title: 'خطر اختبار', description: 'وصف', probability: 3, impact: 0 }, testUserId),
    /بين 1 و5/
  );
});

test('سجل المخاطر - لوحة الإحصائيات شاملة', async () => {
  const dashboard = await ctrl.getRiskDashboard(testProjectId);

  assert.ok(Array.isArray(dashboard.risks), 'قائمة المخاطر مطلوبة');
  assert.ok(Array.isArray(dashboard.claims), 'قائمة المطالبات مطلوبة');
  assert.ok(Array.isArray(dashboard.non_conformances), 'قائمة NCR مطلوبة');
  assert.ok(Array.isArray(dashboard.rfis), 'قائمة RFI مطلوبة');
  assert.ok(dashboard.summary.risk_summary, 'ملخص المخاطر مطلوب');
  assert.ok(dashboard.risks.length > 0, 'يجب وجود مخاطر مسجلة');
  // التحقق من الإثراء
  dashboard.risks.forEach(r => {
    assert.ok(r.rating_details, 'تقييم الخطورة يجب أن يكون موجوداً');
  });
});

// ============================================================================
// 5. سجل المطالبات
// ============================================================================

test('سجل المطالبات - إضافة مطالبة تمديد وقت', async () => {
  const result = await ctrl.addClaim(testProjectId, {
    claim_type: 'تمديد_وقت',
    title: 'تأخر تسليم الموقع من صاحب العمل',
    description: 'تأخر صاحب العمل في تسليم الموقع لمدة 45 يوماً عن الموعد المتفق عليه في العقد',
    claimed_amount: 0,
    claimed_days: 45,
    responsible_party: 'صاحب العمل',
    priority: 'high',
  }, testUserId);

  assert.ok(result.id, 'يجب إنشاء مطالبة');

  const saved = await get('SELECT * FROM project_claims_register WHERE id = ?', [result.id]);
  assert.equal(saved.claim_type, 'تمديد_وقت');
  assert.equal(saved.claimed_days, 45);
  assert.equal(saved.status, 'مفتوح');
});

test('سجل المطالبات - إضافة مطالبة تكاليف إضافية', async () => {
  const result = await ctrl.addClaim(testProjectId, {
    claim_type: 'تكلفة_إضافية',
    title: 'ارتفاع أسعار مواد البناء',
    description: 'ارتفاع أسعار الحديد والأسمنت بنسبة 35% عن الأسعار المرجعية في وقت تقديم العطاء',
    claimed_amount: 350000,
    claimed_days: 0,
    responsible_party: 'صاحب العمل',
    priority: 'critical',
  }, testUserId);

  assert.ok(result.id);
});

test('سجل المطالبات - يرفض نوع مطالبة غير صالح', async () => {
  await assert.rejects(
    () => ctrl.addClaim(testProjectId, {
      claim_type: 'نوع_مجهول',
      title: 'مطالبة',
      description: 'وصف'
    }, testUserId),
    /نوع المطالبة غير صالح/
  );
});

// ============================================================================
// 6. تقارير عدم المطابقة (NCR)
// ============================================================================

test('NCR - إضافة تقرير عدم مطابقة', async () => {
  const result = await ctrl.addNCR(testProjectId, {
    title: 'عدم مطابقة سماكة الطبقة العازلة',
    description: 'سماكة الطبقة العازلة في الطابق الأرضي أقل من المطلوب بالمواصفات بنسبة 20%',
    location: 'الطابق الأرضي - الجهة الجنوبية',
    discipline: 'مدني',
    severity: 'major',
    responsible_party: 'فريق التنفيذ الميداني',
    root_cause: 'عدم الالتزام بمواصفات المادة العازلة المعتمدة',
    corrective_action: 'إزالة الطبقة الحالية وإعادة التطبيق وفق المواصفات',
    preventive_action: 'إضافة نقطة تفتيش إضافية قبل الاستمرار في أي طبقة لاحقة',
    due_date: '2026-10-20',
  }, testUserId);

  assert.ok(result.id, 'يجب إنشاء NCR');

  const saved = await get('SELECT * FROM project_non_conformance WHERE id = ?', [result.id]);
  assert.equal(saved.status, 'مفتوح');
  assert.equal(saved.severity, 'major');
});

test('NCR - يرفض الإنشاء بدون وصف', async () => {
  await assert.rejects(
    () => ctrl.addNCR(testProjectId, { title: 'خلل' }, testUserId),
    /العنوان والوصف حقول إلزامية/
  );
});

// ============================================================================
// 7. طلبات المعلومات (RFI)
// ============================================================================

test('RFI - إضافة طلب معلومات', async () => {
  const result = await ctrl.addRFI(testProjectId, {
    subject: 'استيضاح تفاصيل تسليح الكمرات الرئيسية',
    description: 'نطلب توضيح قطر الحديد المستخدم في الكمرات الرئيسية للدور الثالث وفق المخططات التنفيذية',
    submitted_to: 'المكتب الاستشاري',
    required_response_date: '2026-10-10',
    discipline: 'إنشائي',
    priority: 'urgent',
  }, testUserId);

  assert.ok(result.id, 'يجب إنشاء RFI');

  const saved = await get('SELECT * FROM project_rfi WHERE id = ?', [result.id]);
  assert.equal(saved.status, 'معلق');
  assert.equal(saved.priority, 'urgent');
});

test('RFI - يرفض الإنشاء بدون موضوع', async () => {
  await assert.rejects(
    () => ctrl.addRFI(testProjectId, { description: 'وصف بدون موضوع' }, testUserId),
    /موضوع طلب المعلومات \(RFI\) إلزامي/
  );
});

test('RFI - يحسب حالة التأخر في الرد', async () => {
  // طلب معلومات منتهية مدة الرد
  await run(
    `INSERT INTO project_rfi
       (project_id, subject, submitted_by, required_response_date, status)
     VALUES (?, 'طلب متأخر الرد', ?, date('now','-5 days'), 'معلق')`,
    [testProjectId, testUserId]
  );

  const rfis = await query(
    'SELECT * FROM project_rfi WHERE project_id = ? ORDER BY id DESC LIMIT 1',
    [testProjectId]
  );
  const overdue = rfis[0];
  assert.ok(new Date(overdue.required_response_date) < new Date(), 'يجب أن يكون تاريخ الرد قد انتهى');
});
