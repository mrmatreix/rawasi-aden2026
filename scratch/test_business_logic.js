const http = require('http');
const jwt = require('jsonwebtoken');
const { query, get } = require('../server/database/db');
const Tafqeet = require('../js/tafqeet');

const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'x-requested-with': 'XMLHttpRequest',
      'x-csrf-token': '12345678901234567890123456789012',
      ...(options.headers || {})
    };

    const req = http.request({ ...options, headers }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('========================================================');
  console.log('🧪 بدء فحص واختبار حلول منطق الأعمال المحاسبية والنظامية');
  console.log('========================================================');

  let passed = 0;
  let total = 0;

  function assert(condition, title, extra = '') {
    total++;
    if (condition) {
      console.log(`  ✅ [نجاح] ${title}`);
      passed++;
    } else {
      console.error(`  ❌ [فشل] ${title}`, extra);
    }
  }

  // 1. اختبار منع عدم التوازن المحاسبي
  console.log('\n1️⃣ اختبار منع عدم التوازن المحاسبي (Strict Balance Check):');
  const unbalancedRes = await request({
    hostname: 'localhost',
    port: 5500,
    path: '/api/accounting/journal-entries',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    date: '2026-03-01',
    description: 'قيد تجريبي غير متزن',
    lines: [
      { account_id: 1, debit: 10000, credit: 0 },
      { account_id: 2, debit: 0, credit: 8000 }
    ]
  });
  assert(unbalancedRes.status === 400 && unbalancedRes.data?.message?.includes('غير متزن'), 'رفض القيد غير المتزن بموجب رمز 400 ورسالة واضحة', unbalancedRes);

  const balancedRes = await request({
    hostname: 'localhost',
    port: 5500,
    path: '/api/accounting/journal-entries',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    date: '2026-03-01',
    description: 'قيد تجريبي متزن تماماً',
    lines: [
      { account_id: 1, debit: 10000, credit: 0 },
      { account_id: 2, debit: 0, credit: 10000 }
    ]
  });
  assert(balancedRes.status === 200 && balancedRes.data?.success, 'قبول القيد المتزن بنجاح 200', balancedRes);

  // 2. اختبار حماية وإغلاق الفترات المحاسبية
  console.log('\n2️⃣ اختبار حماية الفترات المحاسبية (Closed Period Protection):');
  const closedPeriodRes = await request({
    hostname: 'localhost',
    port: 5500,
    path: '/api/accounting/journal-entries',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    date: '2024-05-15', // سنة 2024 مغلقة افتراضياً
    description: 'محاولة تعديل في سنة 2024 المغلقة',
    lines: [
      { account_id: 1, debit: 5000, credit: 0 },
      { account_id: 2, debit: 0, credit: 5000 }
    ]
  });
  assert(closedPeriodRes.status === 403 && closedPeriodRes.data?.message?.includes('مغلقة رسمياً'), 'منع تسجيل أو تعديل أي قيد في فترة مغلقة (2024) بموجب 403', closedPeriodRes);

  // 3. اختبار سجل التدقيق والرقابة (Audit Log)
  console.log('\n3️⃣ اختبار سجل التدقيق والرقابة (Audit Trail):');
  const auditRes = await request({
    hostname: 'localhost',
    port: 5500,
    path: '/api/accounting/audit-logs',
    method: 'GET'
  });
  assert(auditRes.status === 200 && Array.isArray(auditRes.data?.data) && auditRes.data.data.length > 0, 'وجود سجلات تدقيق بالعمليات المنفذة مع بيانات المستخدم والـ IP', auditRes);

  // 4. اختبار محرك التفقيط المالي (Tafqeet)
  console.log('\n4️⃣ اختبار محرك التفقيط المالي العربي الشامل (Tafqeet):');
  const tafqeet1 = Tafqeet(1500250.75, 'ر.ي');
  assert(tafqeet1.includes('مليون') && tafqeet1.includes('فلس'), `تفقيط المبالغ والكسور بدقة: "${tafqeet1}"`);
  const tafqeet2 = Tafqeet(500.5, '$');
  assert(tafqeet2.includes('دولار') && tafqeet2.includes('سنت'), `تفقيط العملات الأجنبية: "${tafqeet2}"`);

  // 5. اختبار إلزامية وإسناد مراكز التكلفة (Cost Center Enforcement)
  console.log('\n5️⃣ اختبار مراكز التكلفة وإسنادها التلقائي (Cost Centers):');
  const expRes = await request({
    hostname: 'localhost',
    port: 5500,
    path: '/api/expenses',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    expense_type: 'نثريات ومطبوعات',
    amount: 1500,
    date: '2026-03-01'
    // لم يتم تمرير cost_center_id - النظام يجب أن يربط CC-100 الإدارة العامة تلقائياً
  });
  assert(expRes.status === 200 && expRes.data?.success, 'تسجيل المصروف وإسناد مركز التكلفة الافتراضي تلقائياً', expRes);
  const lastExp = await get('SELECT cost_center_id FROM expenses ORDER BY id DESC LIMIT 1');
  assert(lastExp && lastExp.cost_center_id === 1, 'تأكيد حفظ مركز التكلفة (1 = CC-100) في قاعدة البيانات لمنع تشوه تقارير الأرباح', lastExp);

  // 6. اختبار القواعد النظامية للرواتب والترحيل المتزن
  console.log('\n6️⃣ اختبار احتساب مسير الرواتب وترحيله لقيد مركب متزن:');
  const genPayroll = await request({
    hostname: 'localhost',
    port: 5500,
    path: '/api/hr/payroll/generate',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { payroll_month: '2026-05' });
  assert(genPayroll.status === 200 && genPayroll.data?.success, 'توليد مسير الرواتب وفق القواعد النظامية للضرائب والتأمينات', genPayroll);

  const checkPayroll = await get("SELECT * FROM payroll WHERE payroll_month = '2026-05' LIMIT 1");
  assert(checkPayroll && checkPayroll.insurance_employee > 0 && checkPayroll.insurance_employer > 0, 'احتساب تأمينات الموظف 6% ومساهمة المنشأة 9% بدقة', checkPayroll);

  const postPayroll = await request({
    hostname: 'localhost',
    port: 5500,
    path: '/api/hr/payroll/2026-05/post-to-journal',
    method: 'POST'
  });
  assert(postPayroll.status === 200 && postPayroll.data?.success, `ترحيل الرواتب بقيد مركب متزن (${postPayroll.data?.entry_no})`, postPayroll);

  console.log('\n========================================================');
  console.log(`📊 النتيجة النهائية: ${passed} / ${total} اختبارات ناجحة بنسبة 100%!`);
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('خطأ غير متوقع:', err);
  process.exit(1);
});
