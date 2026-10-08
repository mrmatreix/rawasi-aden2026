/**
 * =========================================================================
 * tests/test_accounting_integration.js
 * سكريبت اختبار الدورة المحاسبية الكاملة وربط دليل الحسابات مع السندات والقيود
 * وفق الشروط المحاسبية الصارمة لنظام شركة رواسي عدن
 * =========================================================================
 */

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { get, query } = require('../server/database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
const BASE_URL = 'http://localhost:3000';

async function runAccountingTests() {
  console.log('🚀 بدء الاختبارات المحاسبية الشاملة لدليل الحسابات والسندات والقيود...\n');

  // تجهيز جلسة المصادقة ورمز الحماية CSRF
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf-token`).then(r => r.json());
  const csrfToken = csrfRes.token || csrfRes.csrfToken;
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  // 0. جلب الحسابات المعتمدة للاختبار من قاعدة البيانات
  const cashAcc = await get("SELECT * FROM accounts WHERE code = '12101001'");
  const bankAcc = await get("SELECT * FROM accounts WHERE code = '12201001'");
  const expAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '5%' OR code LIKE '4%') ORDER BY id ASC LIMIT 1");
  const revAcc = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '4%' OR code = '12301001') ORDER BY id DESC LIMIT 1");
  const parentAcc = await get("SELECT * FROM accounts WHERE level = 1 OR (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = accounts.id OR c.parent_code = accounts.code) > 0 LIMIT 1");
  const bankRecord = await get("SELECT * FROM bank_accounts WHERE is_active = 1 LIMIT 1");

  console.log('📌 الحسابات المستخدمة في سيناريوهات الاختبار:');
  console.log(`   - حساب الصندوق الرئيسي (نهائي): [${cashAcc?.id}] ${cashAcc?.code} - ${cashAcc?.name}`);
  console.log(`   - حساب البنك العام (نهائي): [${bankAcc?.id}] ${bankAcc?.code} - ${bankAcc?.name}`);
  console.log(`   - حساب المصروف المختار (نهائي): [${expAcc?.id}] ${expAcc?.code} - ${expAcc?.name}`);
  console.log(`   - حساب الإيراد المختار (نهائي): [${revAcc?.id}] ${revAcc?.code} - ${revAcc?.name}`);
  console.log(`   - حساب تجميعي أب (محظور): [${parentAcc?.id}] ${parentAcc?.code} - ${parentAcc?.name}`);
  console.log(`   - الحساب البنكي المسجل: [${bankRecord?.id}] ${bankRecord?.bank_name} (رقم: ${bankRecord?.account_number})`);
  console.log('--------------------------------------------------------------------------------\n');

  assert.ok(cashAcc, 'يجب أن يكون حساب الصندوق 12101001 موجوداً في قاعدة البيانات');
  assert.ok(bankAcc, 'يجب أن يكون حساب البنك 12201001 موجوداً في قاعدة البيانات');
  assert.ok(expAcc, 'يجب أن يتوفر حساب مصروف طرفي للتسجيل');
  assert.ok(parentAcc, 'يجب أن يتوفر حساب أب لاختبار المنع والرفض');

  let passedTests = 0;

  // =========================================================================
  // الاختبار 1: اختبار سند صرف نقدي (مصروف = 50,000)
  // مدين: حساب المصروف 50,000
  // دائن: الصندوق 50,000
  // =========================================================================
  console.log('▶ [الاختبار 1/8] اختبار سند صرف نقدي بقيمة 50,000 ر.ي...');
  const expCashRes = await fetch(`${BASE_URL}/api/expenses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expense_type: 'مصروفات إدارية',
      account_id: expAcc.id,
      amount: 50000,
      currency: 'ر.ي',
      payment_method: 'نقدي',
      date: new Date().toISOString().split('T')[0],
      notes: 'شراء أدوات مكتبية نقداً (اختبار آلي)'
    })
  });
  const expCashData = await expCashRes.json();
  assert.equal(expCashRes.status, 200, `فشل إنشاء سند الصرف النقدي: ${expCashData.message}`);
  assert.ok(expCashData.success, 'يجب أن تنجح عملية إنشاء سند الصرف');
  assert.ok(expCashData.journal_entry_id, 'يجب أن يرتبط سند الصرف بالقيد المحاسبي آلياً');

  // فحص أسطر القيد من قاعدة البيانات
  const expJeLines = await query(`
    SELECT l.*, a.code as acc_code, a.name as acc_name 
    FROM journal_entry_lines l 
    JOIN accounts a ON l.account_id = a.id 
    WHERE l.entry_id = ?
    ORDER BY l.debit DESC
  `, [expCashData.journal_entry_id]);

  assert.equal(expJeLines.length, 2, 'يجب أن يتكون القيد من سطرين متزنين (مدين ودائن)');
  // السطر المدين: حساب المصروف
  assert.equal(expJeLines[0].account_id, expAcc.id, 'الطرف المدين يجب أن يكون حساب المصروف المختار');
  assert.equal(Number(expJeLines[0].debit), 50000, 'قيمة المدين يجب أن تكون 50,000');
  assert.equal(Number(expJeLines[0].credit), 0, 'دائن سطر المصروف يجب أن يكون 0');
  // السطر الدائن: حساب الصندوق
  assert.equal(expJeLines[1].account_id, cashAcc.id, 'الطرف الدائن يجب أن يكون حساب الصندوق النهائي');
  assert.equal(Number(expJeLines[1].credit), 50000, 'قيمة الدائن يجب أن تكون 50,000');
  assert.equal(Number(expJeLines[1].debit), 0, 'مدين سطر الصندوق يجب أن يكون 0');

  console.log(`  ✅ نجح سند الصرف النقدي [${expCashData.receipt_no}] وتوليد القيد [JV-${expCashData.journal_entry_id}]:`);
  console.log(`     - مدين: [${expJeLines[0].acc_code}] ${expJeLines[0].acc_name} = ${expJeLines[0].debit}`);
  console.log(`     - دائن: [${expJeLines[1].acc_code}] ${expJeLines[1].acc_name} = ${expJeLines[1].credit}\n`);
  passedTests++;

  // =========================================================================
  // الاختبار 2: اختبار سند صرف بنكي (مصروف = 50,000)
  // مدين: حساب المصروف 50,000
  // دائن: البنك 50,000
  // =========================================================================
  console.log('▶ [الاختبار 2/8] اختبار سند صرف بتحويل بنكي بقيمة 50,000 ر.ي...');
  const expBankRes = await fetch(`${BASE_URL}/api/expenses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expense_type: 'مصروفات تشغيلية',
      account_id: expAcc.id,
      bank_account_id: bankRecord.id,
      amount: 50000,
      currency: 'ر.ي',
      payment_method: 'تحويل بنكي',
      date: new Date().toISOString().split('T')[0],
      notes: 'صرف تحويل بنكي للمورد (اختبار آلي)'
    })
  });
  const expBankData = await expBankRes.json();
  assert.equal(expBankRes.status, 200, `فشل إنشاء سند الصرف البنكي: ${expBankData.message}`);
  assert.ok(expBankData.success, 'يجب أن تنجح عملية إنشاء سند الصرف البنكي');
  assert.ok(expBankData.journal_entry_id, 'يجب ربط القيد بسند الصرف البنكي');

  const expBankJeLines = await query(`
    SELECT l.*, a.code as acc_code, a.name as acc_name 
    FROM journal_entry_lines l 
    JOIN accounts a ON l.account_id = a.id 
    WHERE l.entry_id = ?
    ORDER BY l.debit DESC
  `, [expBankData.journal_entry_id]);

  assert.equal(expBankJeLines.length, 2, 'يجب أن يتكون القيد البنكي من طرفين');
  assert.equal(expBankJeLines[0].account_id, expAcc.id, 'الطرف المدين يجب أن يكون حساب المصروف');
  assert.equal(Number(expBankJeLines[0].debit), 50000, 'المبلغ المدين 50,000');
  assert.equal(expBankJeLines[1].account_id, bankAcc.id, 'الطرف الدائن يجب أن يكون حساب البنك 12201001');
  assert.equal(Number(expBankJeLines[1].credit), 50000, 'المبلغ الدائن 50,000');

  console.log(`  ✅ نجح سند الصرف البنكي [${expBankData.receipt_no}] وتوليد القيد [JV-${expBankData.journal_entry_id}]:`);
  console.log(`     - مدين: [${expBankJeLines[0].acc_code}] ${expBankJeLines[0].acc_name} = ${expBankJeLines[0].debit}`);
  console.log(`     - دائن: [${expBankJeLines[1].acc_code}] ${expBankJeLines[1].acc_name} = ${expBankJeLines[1].credit}\n`);
  passedTests++;

  // =========================================================================
  // الاختبار 3: اختبار سند قبض نقدي (قبض = 100,000)
  // مدين: الصندوق 100,000
  // دائن: حساب الإيراد / العميل 100,000
  // =========================================================================
  console.log('▶ [الاختبار 3/8] اختبار سند قبض نقدي بقيمة 100,000 ر.ي...');
  const rcCashRes = await fetch(`${BASE_URL}/api/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'قبض',
      client_name: 'شركة الأفق للاستثمار (اختبار)',
      account_id: revAcc.id,
      amount: 100000,
      currency: 'ر.ي',
      payment_method: 'نقدي',
      date: new Date().toISOString().split('T')[0],
      notes: 'تحصيل إيرادات نقداً (اختبار آلي)'
    })
  });
  const rcCashData = await rcCashRes.json();
  assert.equal(rcCashRes.status, 200, `فشل إنشاء سند القبض النقدي: ${rcCashData.message}`);
  assert.ok(rcCashData.success, 'يجب أن ينجح إنشاء سند القبض');
  assert.ok(rcCashData.journal_entry_id, 'يجب توليد قيد اليومية المرتبط بسند القبض');

  const rcCashJeLines = await query(`
    SELECT l.*, a.code as acc_code, a.name as acc_name 
    FROM journal_entry_lines l 
    JOIN accounts a ON l.account_id = a.id 
    WHERE l.entry_id = ?
    ORDER BY l.debit DESC
  `, [rcCashData.journal_entry_id]);

  assert.equal(rcCashJeLines.length, 2, 'يجب أن يتكون القيد من سطرين');
  // السطر المدين: حساب الصندوق
  assert.equal(rcCashJeLines[0].account_id, cashAcc.id, 'الطرف المدين لسند القبض النقدي يجب أن يكون حساب الصندوق');
  assert.equal(Number(rcCashJeLines[0].debit), 100000, 'مدين الصندوق 100,000');
  // السطر الدائن: حساب الإيراد / الحساب المختار
  assert.equal(rcCashJeLines[1].account_id, revAcc.id, 'الطرف الدائن لسند القبض يجب أن يكون الحساب المختار');
  assert.equal(Number(rcCashJeLines[1].credit), 100000, 'دائن الحساب المختار 100,000');

  console.log(`  ✅ نجح سند القبض النقدي [${rcCashData.receipt_no}] وتوليد القيد [JV-${rcCashData.journal_entry_id}]:`);
  console.log(`     - مدين: [${rcCashJeLines[0].acc_code}] ${rcCashJeLines[0].acc_name} = ${rcCashJeLines[0].debit}`);
  console.log(`     - دائن: [${rcCashJeLines[1].acc_code}] ${rcCashJeLines[1].acc_name} = ${rcCashJeLines[1].credit}\n`);
  passedTests++;

  // =========================================================================
  // الاختبار 4: اختبار سند قبض بنكي (قبض = 100,000)
  // مدين: البنك 100,000
  // دائن: حساب الإيراد / الحساب المختار 100,000
  // =========================================================================
  console.log('▶ [الاختبار 4/8] اختبار سند قبض بتحويل بنكي بقيمة 100,000 ر.ي...');
  const rcBankRes = await fetch(`${BASE_URL}/api/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'قبض',
      client_name: 'شركة البناء الحديث (اختبار)',
      account_id: revAcc.id,
      bank_account_id: bankRecord.id,
      amount: 100000,
      currency: 'ر.ي',
      payment_method: 'تحويل بنكي',
      date: new Date().toISOString().split('T')[0],
      notes: 'تحصيل دفعة عبر البنك (اختبار آلي)'
    })
  });
  const rcBankData = await rcBankRes.json();
  assert.equal(rcBankRes.status, 200, `فشل إنشاء سند القبض البنكي: ${rcBankData.message}`);
  assert.ok(rcBankData.success, 'يجب أن ينجح إنشاء سند القبض البنكي');
  assert.ok(rcBankData.journal_entry_id, 'يجب ربط القيد بسند القبض');

  const rcBankJeLines = await query(`
    SELECT l.*, a.code as acc_code, a.name as acc_name 
    FROM journal_entry_lines l 
    JOIN accounts a ON l.account_id = a.id 
    WHERE l.entry_id = ?
    ORDER BY l.debit DESC
  `, [rcBankData.journal_entry_id]);

  assert.equal(rcBankJeLines.length, 2, 'يجب أن يتكون القيد من سطرين');
  assert.equal(rcBankJeLines[0].account_id, bankAcc.id, 'الطرف المدين لسند القبض البنكي يجب أن يكون حساب البنك 12201001');
  assert.equal(Number(rcBankJeLines[0].debit), 100000, 'مدين البنك 100,000');
  assert.equal(rcBankJeLines[1].account_id, revAcc.id, 'الطرف الدائن لسند القبض يجب أن يكون الحساب المختار');
  assert.equal(Number(rcBankJeLines[1].credit), 100000, 'دائن الحساب المختار 100,000');

  console.log(`  ✅ نجح سند القبض البنكي [${rcBankData.receipt_no}] وتوليد القيد [JV-${rcBankData.journal_entry_id}]:`);
  console.log(`     - مدين: [${rcBankJeLines[0].acc_code}] ${rcBankJeLines[0].acc_name} = ${rcBankJeLines[0].debit}`);
  console.log(`     - دائن: [${rcBankJeLines[1].acc_code}] ${rcBankJeLines[1].acc_name} = ${rcBankJeLines[1].credit}\n`);
  passedTests++;

  // =========================================================================
  // الاختبار 5: اختبار الحساب الأب (Parent Account Rejection)
  // محاولة اختيار حساب لديه حسابات فرعية أو غير نهائي
  // النتيجة المطلوبة: رفض العملية برسالة الخطأ المحددة تماماً:
  // "لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير."
  // =========================================================================
  console.log(`▶ [الاختبار 5/8] اختبار الحساب الأب: محاولة إرسال حساب رئيسي [${parentAcc.code} - ${parentAcc.name}]...`);
  const rejectExpectedMsg = 'لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير.';

  // 5.1 تجربة في سند الصرف
  const rejExpRes = await fetch(`${BASE_URL}/api/expenses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expense_type: 'مصروف غير مسموح',
      account_id: parentAcc.id,
      amount: 15000,
      currency: 'ر.ي',
      payment_method: 'نقدي',
      date: new Date().toISOString().split('T')[0],
      notes: 'محاولة اختراق بقيد على حساب رئيسي'
    })
  });
  const rejExpData = await rejExpRes.json();
  assert.equal(rejExpRes.status, 400, 'يجب رفض التسجيل على الحساب الأب بكود 400 في سند الصرف');
  assert.equal(rejExpData.success, false, 'يجب أن تفشل العملية');
  assert.ok(rejExpData.message.includes(rejectExpectedMsg), `يجب أن تحتوي رسالة الرفض على: "${rejectExpectedMsg}". الرسالة الفعلية: "${rejExpData.message}"`);

  // 5.2 تجربة في سند القبض
  const rejRcRes = await fetch(`${BASE_URL}/api/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'قبض',
      client_name: 'عميل اختبار',
      account_id: parentAcc.id,
      amount: 25000,
      currency: 'ر.ي',
      payment_method: 'نقدي',
      date: new Date().toISOString().split('T')[0],
      notes: 'محاولة اختراق بقيد قبض على حساب أب'
    })
  });
  const rejRcData = await rejRcRes.json();
  assert.equal(rejRcRes.status, 400, 'يجب رفض التسجيل على الحساب الأب بكود 400 في سند القبض');
  assert.equal(rejRcData.success, false, 'يجب أن تفشل العملية');
  assert.ok(rejRcData.message.includes(rejectExpectedMsg), `يجب أن تحتوي رسالة الرفض على: "${rejectExpectedMsg}". الرسالة الفعلية: "${rejRcData.message}"`);

  // 5.3 تجربة في قيد اليومية اليدوي
  const rejJeRes = await fetch(`${BASE_URL}/api/accounting/journal-entries`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      date: new Date().toISOString().split('T')[0],
      description: 'قيد تجريبي بحساب أب',
      lines: [
        { account_id: parentAcc.id, debit: 10000, credit: 0, notes: 'طرف مدين غير قانوني' },
        { account_id: cashAcc.id, debit: 0, credit: 10000, notes: 'طرف دائن' }
      ]
    })
  });
  const rejJeData = await rejJeRes.json();
  assert.equal(rejJeRes.status, 400, 'يجب رفض الحساب الأب في قيد اليومية اليدوي بكود 400');
  assert.ok(rejJeData.message.includes(rejectExpectedMsg), `يجب إرجاع رسالة الرفض المحددة للقيد اليومي. الرسالة: "${rejJeData.message}"`);

  console.log(`  ✅ تم رفض الحساب الأب بنجاح في السندات والقيود مع إرجاع الرسالة الإلزامية:`);
  console.log(`     "${rejectExpectedMsg}"\n`);
  passedTests++;

  // =========================================================================
  // الاختبار 6: اختبار الحساب النهائي (Leaf Account Acceptance)
  // اختيار حساب ليس لديه حسابات فرعية
  // النتيجة: السماح بالعملية
  // =========================================================================
  console.log(`▶ [الاختبار 6/8] اختبار قبول الحساب النهائي [${expAcc.code} - ${expAcc.name}]...`);
  const activeCc = await get('SELECT id FROM cost_centers LIMIT 1');
  const validCcId = activeCc ? activeCc.id : null;

  const leafJeRes = await fetch(`${BASE_URL}/api/accounting/journal-entries`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      date: new Date().toISOString().split('T')[0],
      description: 'قيد يومية نظامي بحسابات نهائية فقط',
      lines: [
        { account_id: expAcc.id, cost_center_id: validCcId, debit: 15000, credit: 0, notes: 'إثبات مصروف قانوني' },
        { account_id: cashAcc.id, debit: 0, credit: 15000, notes: 'صرف من الصندوق الرئيسي' }
      ]
    })
  });
  const leafJeData = await leafJeRes.json();
  assert.equal(leafJeRes.status, 200, `فشل قبول الحساب النهائي: ${leafJeData.message}`);
  assert.ok(leafJeData.success, 'يجب أن يقبل النظام الحساب النهائي القابل للتسجيل');
  assert.ok(leafJeData.entry_no, 'يجب توليد رقم القيد اليومي');
  console.log(`  ✅ تم قبول الحساب النهائي بنجاح وإنشاء القيد المتزن [${leafJeData.entry_no}]\n`);
  passedTests++;

  // =========================================================================
  // الاختبار 7: اختبار القيد غير المتوازن (مدين 100,000 != دائن 90,000)
  // النتيجة: رفض الحفظ
  // =========================================================================
  console.log('▶ [الاختبار 7/8] اختبار القيد غير المتوازن (مدين: 100,000 مقابل دائن: 90,000)...');
  const unbalRes = await fetch(`${BASE_URL}/api/accounting/journal-entries`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      date: new Date().toISOString().split('T')[0],
      description: 'محاولة إنشاء قيد غير متوازن',
      lines: [
        { account_id: expAcc.id, cost_center_id: validCcId, debit: 100000, credit: 0, notes: 'مدين 100 ألف' },
        { account_id: cashAcc.id, debit: 0, credit: 90000, notes: 'دائن 90 ألف فقط' }
      ]
    })
  });
  const unbalData = await unbalRes.json();
  assert.equal(unbalRes.status, 400, 'يجب أن يرفض النظام القيد غير المتوازن بكود 400');
  assert.equal(unbalData.success, false, 'يجب أن تفشل عملية حفظ القيد غير المتوازن');
  assert.ok(unbalData.message.includes('غير متزن') || unbalData.message.includes('متزن'), `يجب توضيح سبب الرفض بعدم توازن القيد. الرسالة: "${unbalData.message}"`);
  console.log(`  ✅ تم رفض القيد غير المتوازن بنجاح برسالة رقابية: "${unbalData.message}"\n`);
  passedTests++;

  // =========================================================================
  // الاختبار 8: اختبار منع الترحيل المكرر (Duplicate Posting Prevention)
  // =========================================================================
  console.log(`▶ [الاختبار 8/8] اختبار منع الترحيل المكرر للسند المرحل مسبقاً [${expCashData.receipt_no}]...`);
  const initialJeCount = await get('SELECT COUNT(*) as cnt FROM journal_entries WHERE reference_type = ? AND reference_id = ?', ['سند صرف', expCashData.id]);
  assert.equal(initialJeCount.cnt, 1, 'يجب أن يكون هناك قيد واحد فقط للسند في البداية');

  // محاولة ترحيل السند مرة ثانية
  const repostRes = await fetch(`${BASE_URL}/api/expenses/${expCashData.id}/post`, {
    method: 'POST',
    headers,
    body: JSON.stringify({})
  });
  const repostData = await repostRes.json();
  // التأكد من عدد القيود بعد محاولة الترحيل الإضافية
  const finalJeCount = await get('SELECT COUNT(*) as cnt FROM journal_entries WHERE reference_type = ? AND reference_id = ?', ['سند صرف', expCashData.id]);
  assert.equal(finalJeCount.cnt, 1, 'يجب عدم إنشاء أي قيد مكرر عند إعادة الترحيل أو استدعاء post مرة أخرى');
  console.log(`  ✅ تم منع الترحيل المكرر بنجاح؛ ظل عدد القيود المحاسبية للسند = 1 قيد فقط.\n`);
  passedTests++;

  // =========================================================================
  // اختبار إضافي: التحقق من قائمة الحسابات القابلة للاستخدام بالواجهة
  // =========================================================================
  console.log('▶ [فحص إضافي] فحص نقطة نهاية الحسابات للواجهة: GET /api/accounting/accounts?usable_only=true...');
  const usableAccsRes = await fetch(`${BASE_URL}/api/accounting/accounts?usable_only=true`, { headers });
  const usableAccsData = await usableAccsRes.json();
  assert.ok(usableAccsData.success, 'يجب أن تنجح استجابة الحسابات');
  assert.ok(Array.isArray(usableAccsData.data), 'يجب أن ترجع قائمة');
  
  const invalidParentsInList = usableAccsData.data.filter(a => a.children_count > 0 || a.is_posting === 0);
  assert.equal(invalidParentsInList.length, 0, `قائمة الحسابات القابلة للاختيار في الواجهة تحتوي على ${invalidParentsInList.length} حساب أب! يجب أن تكون 0`);
  console.log(`  ✅ تم التحقق من قائمة الحسابات للواجهة: تحتوي على ${usableAccsData.data.length} حساب نهائي فقط دون أي حساب أب.\n`);

  console.log('================================================================================');
  console.log(`🎉 اكتملت جميع الاختبارات بنجاح تام: ${passedTests} من 8 سيناريوهات متوافقة 100% مع الأصول المحاسبية!`);
  console.log('================================================================================');
}

runAccountingTests().catch(err => {
  console.error('\n❌ فشل في أحد الاختبارات المحاسبية:', err);
  process.exit(1);
});
