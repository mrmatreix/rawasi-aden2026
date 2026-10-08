/**
 * =========================================================================
 * tests/test_cash_flow_and_contract_lifecycle.js
 * اختبار شامل ومتكامل لنظامي:
 * 1. توقعات التدفق النقدي (Cash Flow Projections & Scenarios)
 * 2. دورة حياة العقد والمحفزات الذكية (Contract Lifecycle & Smart Alerts)
 * =========================================================================
 */

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('🚀 بدء اختبارات نظام التدفق النقدي ودورة حياة العقود والتنبيهات...');

  // 1. توليد رمز مصادقة
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // جلب CSRF token
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf-token`).then(r => r.json());
  const csrfToken = csrfRes.token || csrfRes.csrfToken;
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  // =========================================================================
  // اختبارات المهمة 1: توقعات التدفق النقدي (Cash Flow Projections)
  // =========================================================================
  console.log('\n[1/2] اختبار مسارات التدفق النقدي (Cash Flow APIs)...');

  // 1.1 إعادة التوليد التلقائي POST /api/cash-flow/projection/regenerate
  const regenRes = await fetch(`${BASE_URL}/api/cash-flow/projection/regenerate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ from: '2026-10', to: '2026-12' })
  });
  assert.equal(regenRes.status, 200, 'فشل مسار إعادة احتساب التدفق النقدي');
  const regenData = await regenRes.json();
  assert.equal(regenData.success, true);
  console.log('✓ POST /api/cash-flow/projection/regenerate يعمل بنجاح.');

  // 1.2 جلب توقعات فترة GET /api/cash-flow/projection
  const projRes = await fetch(`${BASE_URL}/api/cash-flow/projection?from=2026-10&to=2026-12`, { headers });
  assert.equal(projRes.status, 200, 'فشل مسار تقرير فترة التدفق النقدي');
  const projData = await projRes.json();
  assert.equal(projData.success, true);
  assert.ok(projData.months.length >= 3, 'يجب أن تحتوي الفترة على 3 أشهر على الأقل');
  console.log(`✓ GET /api/cash-flow/projection ناجح (عدد الأشهر: ${projData.months.length} | صافي التدفق: ${projData.total_net_cash_flow.toLocaleString()})`);

  // 1.3 جلب تفاصيل شهر محدد GET /api/cash-flow/month/:month
  const monthRes = await fetch(`${BASE_URL}/api/cash-flow/month/2026-10`, { headers });
  assert.equal(monthRes.status, 200, 'فشل مسار تدفق الشهر');
  const monthData = await monthRes.json();
  assert.equal(monthData.success, true);
  assert.equal(monthData.data.period, '2026-10');
  assert.ok('expected_collections' in monthData.data);
  assert.ok('expected_payments' in monthData.data);
  assert.ok('net_cash_flow' in monthData.data);
  assert.ok('cumulative_balance' in monthData.data);
  assert.ok(Array.isArray(monthData.data.breakdown.by_project));
  console.log('✓ GET /api/cash-flow/month/2026-10 يطابق بدقة النموذج المعياري المطلوب.');

  // 1.4 جلب السيناريوهات الثلاثية GET /api/cash-flow/scenarios
  const scenRes = await fetch(`${BASE_URL}/api/cash-flow/scenarios?from=2026-10&to=2026-12`, { headers });
  assert.equal(scenRes.status, 200, 'فشل مسار السيناريوهات');
  const scenData = await scenRes.json();
  assert.equal(scenData.success, true);
  assert.ok(scenData.scenarios.realistic, 'السيناريو الواقعي مفقود');
  assert.ok(scenData.scenarios.optimistic, 'السيناريو المتفائل مفقود');
  assert.ok(scenData.scenarios.pessimistic, 'السيناريو المتشائم مفقود');
  console.log(`✓ GET /api/cash-flow/scenarios ناجح:
    - الواقعي: ${scenData.scenarios.realistic.final_balance.toLocaleString()}
    - المتفائل: ${scenData.scenarios.optimistic.final_balance.toLocaleString()}
    - المتشائم: ${scenData.scenarios.pessimistic.final_balance.toLocaleString()}`);

  // 1.5 جلب تدفق مشروع محدد GET /api/cash-flow/project/:projectId
  const prjRes = await fetch(`${BASE_URL}/api/cash-flow/project/1`, { headers });
  assert.equal(prjRes.status, 200, 'فشل مسار تدفق المشروع');
  const prjData = await prjRes.json();
  assert.equal(prjData.success, true);
  console.log(`✓ GET /api/cash-flow/project/1 ناجح لمشروع: [${prjData.project_name}]`);

  // =========================================================================
  // اختبارات المهمة 2: دورة حياة العقد والتنبيهات الذكية
  // =========================================================================
  console.log('\n[2/2] اختبار مسارات دورة حياة العقد والتنبيهات الذكية (Contract Lifecycle & Alerts)...');

  // إنشاء عقد تجريبي للاختبار
  const db = require('../server/database/db');
  const contractNo = `CNT-TEST-${Date.now().toString().slice(-5)}`;
  const insContract = await db.run(`
    INSERT INTO project_contracts (
      project_id, contract_no, title, contract_value, currency,
      advance_payment_pct, retention_pct, status, start_date, end_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE, date('now', '+25 days'))
  `, [1, contractNo, 'عقد إنشاءات تجريبي لفحص الدورة المستندية', 500000.00, 'USD', 10, 5, 'draft']);
  const testContractId = insContract.lastInsertRowid || insContract.insertId;

  // 2.1 جلب مراحل العقد الأولية GET /api/contracts/:id/lifecycle
  const lcRes = await fetch(`${BASE_URL}/api/contracts/${testContractId}/lifecycle`, { headers });
  assert.equal(lcRes.status, 200, 'فشل جلب مراحل العقد');
  const lcData = await lcRes.json();
  assert.equal(lcData.success, true);
  console.log(`✓ GET /api/contracts/${testContractId}/lifecycle يعمل بنجاح.`);

  // 2.2 نقل العقد إلى مرحلة 'signed' والتحقق من توليد الهاش الرقمي SHA-256
  const transSignedRes = await fetch(`${BASE_URL}/api/contracts/${testContractId}/transition`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      stage: 'signed',
      signature_date: '2026-10-06',
      approval_notes: 'توقيع رسمي للعقد بين المدير العام والمالك'
    })
  });
  assert.equal(transSignedRes.status, 200, 'فشل نقل العقد إلى مرحلة signed');
  const transSignedData = await transSignedRes.json();
  assert.equal(transSignedData.stage, 'signed');
  assert.ok(transSignedData.signature_hash && transSignedData.signature_hash.length === 64, 'لم يتم توليد هاش التوقيع SHA-256 المكون من 64 حرفاً');
  console.log(`✓ POST /api/contracts/${testContractId}/transition إلى 'signed' نجح مع توليد الختم الرقمي SHA-256: [${transSignedData.signature_hash.slice(0, 16)}...]`);

  // 2.3 نقل العقد إلى مرحلة 'active'
  const transActiveRes = await fetch(`${BASE_URL}/api/contracts/${testContractId}/transition`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      stage: 'active',
      approval_notes: 'بدء التنفيذ الميداني وتسليم الموقع'
    })
  });
  assert.equal(transActiveRes.status, 200);
  const transActiveData = await transActiveRes.json();
  assert.equal(transActiveData.stage, 'active');
  console.log('✓ POST transition إلى active ناجح وتم تفعيل المشروع.');

  // 2.4 فحص التنبيهات الذكية POST /api/contracts/alerts/scan
  const scanAlertsRes = await fetch(`${BASE_URL}/api/contracts/alerts/scan`, {
    method: 'POST',
    headers
  });
  assert.equal(scanAlertsRes.status, 200);
  const scanAlertsData = await scanAlertsRes.json();
  assert.equal(scanAlertsData.success, true);
  console.log(`✓ POST /api/contracts/alerts/scan تم بنجاح (فحص ${scanAlertsData.scanned_contracts} عقد).`);

  // 2.5 جلب لوحة التنبيهات GET /api/contracts/alerts/dashboard
  const dashRes = await fetch(`${BASE_URL}/api/contracts/alerts/dashboard`, { headers });
  assert.equal(dashRes.status, 200);
  const dashData = await dashRes.json();
  assert.equal(dashData.success, true);
  assert.ok('critical_count' in dashData.summary);
  assert.ok('warning_count' in dashData.summary);
  assert.ok('info_count' in dashData.summary);
  console.log(`✓ GET /api/contracts/alerts/dashboard ناجح:
    - تنبيهات حرجة (Critical): ${dashData.summary.critical_count}
    - تنبيهات تحذيرية (Warning): ${dashData.summary.warning_count}
    - تنبيهات معلوماتية (Info): ${dashData.summary.info_count}
    - إجمالي المبالغ المعرضة للمخاطر: ${dashData.summary.total_amount_at_risk.toLocaleString()}`);

  // 2.6 جلب تنبيهات العقد المحدد GET /api/contracts/:id/alerts
  const contractAlertsRes = await fetch(`${BASE_URL}/api/contracts/${testContractId}/alerts`, { headers });
  assert.equal(contractAlertsRes.status, 200);
  const contractAlertsData = await contractAlertsRes.json();
  assert.equal(contractAlertsData.success, true);
  console.log(`✓ GET /api/contracts/${testContractId}/alerts ناجح (وجد ${contractAlertsData.total_alerts} تنبيه للعقد).`);

  if (contractAlertsData.alerts.length > 0) {
    const targetAlert = contractAlertsData.alerts[0];
    // 2.7 الإقرار بالتنبيه POST /api/contracts/:id/alerts/:alertId/ack
    const ackRes = await fetch(`${BASE_URL}/api/contracts/${testContractId}/alerts/${targetAlert.id}/ack`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ notes: 'تم استلام التنبيه وتوجيه الإدارة الهندسية' })
    });
    assert.equal(ackRes.status, 200);
    const ackData = await ackRes.json();
    assert.equal(ackData.status, 'acknowledged');
    console.log(`✓ POST /api/contracts/.../ack تم بنجاح للتنبيه رقم [${targetAlert.id}].`);
  }

  // 2.8 جلب العقود المقاربة على الانتهاء GET /api/contracts/expiring?days=30
  const expRes = await fetch(`${BASE_URL}/api/contracts/expiring?days=30`, { headers });
  assert.equal(expRes.status, 200);
  const expData = await expRes.json();
  assert.equal(expData.success, true);
  assert.ok(expData.contracts.some(c => c.id === testContractId), 'يجب أن يظهر العقد التجريبي ضمن العقود المنتهية خلال 30 يوماً');
  console.log(`✓ GET /api/contracts/expiring?days=30 أظهر العقد التجريبي بدقة (ينتهي خلال 25 يوماً).`);

  // تنظيف السجل التجريبي
  await db.run('DELETE FROM contract_alerts WHERE contract_id = ?', [testContractId]);
  await db.run('DELETE FROM contract_lifecycle WHERE contract_id = ?', [testContractId]);
  await db.run('DELETE FROM project_contracts WHERE id = ?', [testContractId]);
  console.log('\n🎯 اكتملت جميع اختبارات نظام التدفق النقدي ودورة حياة العقد والتنبيهات بنجاح تام 100%!');
}

runTests().catch(err => {
  console.error('\n❌ فشل في الاختبارات:', err);
  process.exit(1);
});
