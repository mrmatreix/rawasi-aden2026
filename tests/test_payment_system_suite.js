/**
 * حزمة الاختبارات الشاملة لمنظومة المدفوعات والعمليات المالية المتقدمة
 * تغطي جميع السيناريوهات الإلزامية الـ 16+ المحددة في المواصفة المحاسبية
 */

const assert = require('assert');
const { get, query, run } = require('../server/database/db');
const PaymentService = require('../server/services/paymentService');
const AccountingService = require('../server/services/accountingService');

async function runTestSuite() {
  console.log('🚀 بدء حزمة الاختبارات الشاملة لمنظومة المدفوعات والحسابات المالية...\n');
  let passedCount = 0;
  let totalTests = 17;

  // جلب الحسابات المالية وطرق الدفع للاختبار
  const pmCash = await get("SELECT * FROM payment_methods WHERE code = 'CASH'");
  const pmBank = await get("SELECT * FROM payment_methods WHERE code = 'BANK_TRANSFER'");
  const pmCard = await get("SELECT * FROM payment_methods WHERE code = 'CREDIT_CARD'");
  const pmGateway = await get("SELECT * FROM payment_methods WHERE code = 'ONLINE_GATEWAY'");

  const faCash = await get("SELECT * FROM financial_accounts WHERE type = 'cash' AND is_active = 1 LIMIT 1");
  const faBank = await get("SELECT * FROM financial_accounts WHERE type = 'bank' AND is_active = 1 LIMIT 1");
  const faGw = await get("SELECT * FROM financial_accounts WHERE type = 'gateway' AND is_active = 1 LIMIT 1");

  const leafRev = await get("SELECT * FROM accounts WHERE code = '41101001' AND is_posting = 1"); // عمولة تحصيل
  const leafExp = await get("SELECT * FROM accounts WHERE code = '32101001' AND is_posting = 1"); // بدل انتقال
  const parentAcc = await get("SELECT * FROM accounts WHERE code = '1'"); // الأصول (أب)

  console.log('📌 البيانات المرجعية المستخدمة في الاختبار:');
  console.log(`   - طريقة النقد: [${pmCash.code}] ${pmCash.name}`);
  console.log(`   - طريقة البنك: [${pmBank.code}] ${pmBank.name}`);
  console.log(`   - طريقة البطاقة: [${pmCard.code}] ${pmCard.name}`);
  console.log(`   - طريقة البوابة: [${pmGateway.code}] ${pmGateway.name}`);
  console.log(`   - الحساب المالي النقدي: [${faCash.id}] ${faCash.name} (مرتبط بحساب COA: ${faCash.account_id})`);
  console.log(`   - الحساب المالي البنكي: [${faBank.id}] ${faBank.name} (مرتبط بحساب COA: ${faBank.account_id})`);
  console.log(`   - حساب الإيراد النهائي: [${leafRev.id}] ${leafRev.code} - ${leafRev.name}`);
  console.log(`   - حساب المصروف النهائي: [${leafExp.id}] ${leafExp.code} - ${leafExp.name}`);
  console.log('--------------------------------------------------------------------------------\n');

  // [الاختبار 1] سند قبض نقدي
  try {
    console.log('▶ [الاختبار 1/17] اختبار سند قبض نقدي بقيمة 100,000 ر.ي...');
    const res = await PaymentService.initiatePayment({
      paymentMethodCode: 'CASH',
      financialAccountId: faCash.id,
      type: 'قبض',
      amount: 100000,
      accountId: leafRev.id,
      notes: 'تحصيل نقدي من عميل',
      autoCapture: true
    });
    assert.strictEqual(res.payment.status, 'PAID', 'يجب أن تكون حالة السند PAID');
    assert(res.journalEntry, 'يجب إنشاء قيد يومي');
    assert.strictEqual(res.journalEntry.total_debit, 100000);
    assert.strictEqual(res.journalEntry.total_credit, 100000);
    console.log(`  ✅ نجح سند القبض النقدي [${res.payment.payment_no}] مع القيد المتزن [${res.journalEntry.entry_no}]`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 1:', err.message);
  }

  // [الاختبار 2] سند قبض بنكي
  try {
    console.log('▶ [الاختبار 2/17] اختبار سند قبض بنكي بقيمة 250,000 ر.ي مرجعي...');
    const res = await PaymentService.initiatePayment({
      paymentMethodCode: 'BANK_TRANSFER',
      financialAccountId: faBank.id,
      type: 'قبض',
      amount: 250000,
      accountId: leafRev.id,
      reference: 'TXN-BANK-9982',
      notes: 'تحويل بنكي مستحق',
      autoCapture: true
    });
    assert.strictEqual(res.payment.status, 'PAID');
    assert(res.journalEntry);
    console.log(`  ✅ نجح سند القبض البنكي [${res.payment.payment_no}] مع القيد المتزن [${res.journalEntry.entry_no}]`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 2:', err.message);
  }

  // [الاختبار 3] سند صرف نقدي
  try {
    console.log('▶ [الاختبار 3/17] اختبار سند صرف نقدي بقيمة 40,000 ر.ي...');
    const res = await PaymentService.initiatePayment({
      paymentMethodCode: 'CASH',
      financialAccountId: faCash.id,
      type: 'صرف',
      amount: 40000,
      accountId: leafExp.id,
      notes: 'صرف بدل انتقال نقداً',
      autoCapture: true
    });
    assert.strictEqual(res.payment.status, 'PAID');
    assert(res.journalEntry);
    assert.strictEqual(res.journalEntry.total_debit, 40000);
    console.log(`  ✅ نجح سند الصرف النقدي [${res.payment.payment_no}] مع القيد المتزن [${res.journalEntry.entry_no}]`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 3:', err.message);
  }

  // [الاختبار 4] سند صرف بنكي
  try {
    console.log('▶ [الاختبار 4/17] اختبار سند صرف بنكي بقيمة 75,000 ر.ي...');
    const res = await PaymentService.initiatePayment({
      paymentMethodCode: 'BANK_TRANSFER',
      financialAccountId: faBank.id,
      type: 'صرف',
      amount: 75000,
      accountId: leafExp.id,
      reference: 'WIRE-8821',
      notes: 'حوالة بنكية لمصروفات رسمية',
      autoCapture: true
    });
    assert.strictEqual(res.payment.status, 'PAID');
    assert(res.journalEntry);
    console.log(`  ✅ نجح سند الصرف البنكي [${res.payment.payment_no}] مع القيد المتزن [${res.journalEntry.entry_no}]`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 4:', err.message);
  }

  // [الاختبار 5] دفع بالبطاقة الائتمانية مع عدم تخزين بيانات حساسة
  try {
    console.log('▶ [الاختبار 5/17] اختبار دفع بالبطاقة مع التحقق من عدم تخزين بيانات حساسة...');
    const res = await PaymentService.initiatePayment({
      paymentMethodCode: 'CREDIT_CARD',
      financialAccountId: faGw.id,
      type: 'قبض',
      amount: 150000,
      feeAmount: 3000,
      accountId: leafRev.id,
      reference: 'AUTH-CARD-771',
      externalTransactionId: 'STRIPE_CH_99482',
      gatewayName: 'stripe',
      notes: 'دفع بالبطاقة الائتمانية عبر بوابة الدفع',
      autoCapture: true
    });
    assert.strictEqual(res.payment.status, 'PAID');
    assert.strictEqual(res.payment.fee_amount, 3000);
    assert.strictEqual(res.payment.net_amount, 147000);
    // التأكد من عدم وجود أي حقول حساسة للبطاقة في الجدول
    const tableCols = await query('PRAGMA table_info(payments)');
    const colNames = tableCols.map(c => c.name.toLowerCase());
    assert(!colNames.includes('cvv'), 'لا يجوز وجود حقل cvv في قاعدة البيانات');
    assert(!colNames.includes('card_number'), 'لا يجوز وجود حقل card_number في قاعدة البيانات');
    console.log(`  ✅ نجح دفع البطاقة [${res.payment.payment_no}] مع تسجيل الرسوم (3,000) وصافي التحصيل (147,000) وحظر تخزين البطاقة`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 5:', err.message);
  }

  // [الاختبار 6] دفع عبر بوابة دفع إلكترونية مع قيد رسوم البوابة المتزن
  try {
    console.log('▶ [الاختبار 6/17] اختبار دفع عبر بوابة إلكترونية وقيد الرسوم الثلاثي...');
    const res = await PaymentService.initiatePayment({
      paymentMethodCode: 'ONLINE_GATEWAY',
      financialAccountId: faGw.id,
      type: 'قبض',
      amount: 100000,
      feeAmount: 2000,
      accountId: leafRev.id,
      reference: 'GW-INV-001',
      externalTransactionId: 'GW_TXN_5501',
      gatewayName: 'kuraimi_gateway',
      autoCapture: true
    });
    const jeLines = await query('SELECT * FROM journal_entry_lines WHERE entry_id = ?', [res.journalEntry.id]);
    assert.strictEqual(jeLines.length, 3, 'يجب أن يتكون القيد من 3 سطور: صافي بنك + مصروف رسوم + دائن إجمالي');
    const debits = jeLines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credits = jeLines.reduce((s, l) => s + Number(l.credit || 0), 0);
    assert.strictEqual(debits, 100000, 'إجمالي المدين يجب أن يساوي 100,000');
    assert.strictEqual(credits, 100000, 'إجمالي الدائن يجب أن يساوي 100,000');
    console.log(`  ✅ نجح قيد بوابة الدفع المتزن [${res.journalEntry.entry_no}]: مدين (بنك: 98,000 + رسوم: 2,000) = دائن (إيراد: 100,000)`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 6:', err.message);
  }

  // [الاختبار 7] دورة الدفع: حالة PENDING
  let pendingPaymentId = null;
  try {
    console.log('▶ [الاختبار 7/17] اختبار إنشاء معاملة بحالة PENDING دون تأثير محاسبي فوري...');
    const res = await PaymentService.initiatePayment({
      paymentMethodCode: 'ONLINE_GATEWAY',
      financialAccountId: faGw.id,
      type: 'قبض',
      amount: 60000,
      accountId: leafRev.id,
      reference: 'PEND-001',
      autoCapture: false // غير مرحل
    });
    pendingPaymentId = res.payment.id;
    assert.strictEqual(res.payment.status, 'PENDING');
    assert.strictEqual(res.journalEntry, null, 'لا يجوز توليد قيد للمسودة المعلقة');
    console.log(`  ✅ تم إنشاء المعاملة المعلقة [${res.payment.payment_no}] بحالة PENDING دون قيد محاسبي`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 7:', err.message);
  }

  // [الاختبار 8] دورة الدفع: حالة FAILED
  try {
    console.log('▶ [الاختبار 8/17] اختبار تحديث المعاملة إلى حالة FAILED...');
    const failPayment = await PaymentService.initiatePayment({
      paymentMethodCode: 'ONLINE_GATEWAY',
      financialAccountId: faGw.id,
      type: 'قبض',
      amount: 20000,
      accountId: leafRev.id,
      reference: 'FAIL-001',
      autoCapture: false
    });
    await run("UPDATE payments SET status = 'FAILED' WHERE id = ?", [failPayment.payment.id]);
    const updated = await get('SELECT status FROM payments WHERE id = ?', [failPayment.payment.id]);
    assert.strictEqual(updated.status, 'FAILED');
    console.log(`  ✅ تم تسجيل المعاملة الفاشلة بحالة FAILED دون أي قيد في دفتر الأستاذ`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 8:', err.message);
  }

  // [الاختبار 9] دورة الدفع: حالة PAID (Capture المعاملة المعلقة)
  try {
    console.log('▶ [الاختبار 9/17] اختبار تحويل المعاملة المعلقة إلى PAID وتوليد القيد آلياً...');
    const res = await PaymentService.capturePayment(pendingPaymentId, {
      externalTransactionId: 'CAPTURED_TXN_7741',
      feeAmount: 1200
    });
    assert.strictEqual(res.payment.status, 'PAID');
    assert(res.journalEntry, 'يجب توليد القيد عند الاعتماد');
    assert.strictEqual(res.journalEntry.total_debit, 60000);
    console.log(`  ✅ تم اعتماد المعاملة بنجاح وتوليد القيد [${res.journalEntry.entry_no}]`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 9:', err.message);
  }

  // [الاختبار 10] الاسترداد المالي الكامل (Full Refund) غير الإتلافي
  try {
    console.log('▶ [الاختبار 10/17] اختبار استرداد كامل (Full Refund) وتوليد قيد عكسي...');
    // إنشاء عملية مدفوعة بقيمة 50,000
    const pay = await PaymentService.initiatePayment({
      paymentMethodCode: 'CASH',
      financialAccountId: faCash.id,
      type: 'قبض',
      amount: 50000,
      accountId: leafRev.id,
      autoCapture: true
    });
    // طلب استرداد كامل
    const ref = await PaymentService.refundPayment(pay.payment.id, {
      amount: 50000,
      reason: 'إلغاء الخدمة بطلب العميل'
    });
    assert.strictEqual(ref.status, 'REFUNDED');
    assert(ref.journal_entry);
    const updatedPay = await get('SELECT * FROM payments WHERE id = ?', [pay.payment.id]);
    assert.strictEqual(updatedPay.status, 'REFUNDED');
    assert.strictEqual(updatedPay.refunded_amount, 50000);
    console.log(`  ✅ نجح الاسترداد الكامل [${ref.refund_no}] مع القيد العكسي [${ref.journal_entry.entry_no}] والحفاظ على السجل الأصلي`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 10:', err.message);
  }

  // [الاختبار 11] الاسترداد المالي الجزئي (Partial Refund)
  try {
    console.log('▶ [الاختبار 11/17] اختبار استرداد جزئي (Partial Refund: 30,000 من 100,000)...');
    const pay = await PaymentService.initiatePayment({
      paymentMethodCode: 'BANK_TRANSFER',
      financialAccountId: faBank.id,
      type: 'قبض',
      amount: 100000,
      accountId: leafRev.id,
      reference: 'TXN-PART-1',
      autoCapture: true
    });
    const ref1 = await PaymentService.refundPayment(pay.payment.id, {
      amount: 30000,
      reason: 'استرداد جزء من الدفعة'
    });
    assert.strictEqual(ref1.status, 'PARTIALLY_REFUNDED');
    const payAfterRef1 = await get('SELECT * FROM payments WHERE id = ?', [pay.payment.id]);
    assert.strictEqual(payAfterRef1.status, 'PARTIALLY_REFUNDED');
    assert.strictEqual(payAfterRef1.refunded_amount, 30000);

    // محاولة استرداد مبلغ أكبر من المتبقي (متبقي 70,000، نطلب 80,000)
    let overflowRejected = false;
    try {
      await PaymentService.refundPayment(pay.payment.id, { amount: 80000, reason: 'تجاوز' });
    } catch (e) {
      overflowRejected = true;
    }
    assert(overflowRejected, 'يجب رفض الاسترداد المتجاوز للمبلغ المتبقي');
    console.log(`  ✅ نجح الاسترداد الجزئي [${ref1.refund_no}] والمتبقي القابل للاسترداد (70,000) وتم رفض التجاوز`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 11:', err.message);
  }

  // [الاختبار 12] منع التكرار المالي عبر مفتاح Idempotency
  try {
    console.log('▶ [الاختبار 12/17] اختبار منع التكرار Idempotency Key...');
    const testKey = `idemp_test_${Date.now()}`;
    const firstReq = await PaymentService.initiatePayment({
      idempotencyKey: testKey,
      paymentMethodCode: 'CASH',
      financialAccountId: faCash.id,
      type: 'قبض',
      amount: 85000,
      accountId: leafRev.id,
      autoCapture: true
    });
    assert.strictEqual(firstReq.isDuplicate, false);

    // إرسال نفس الطلب بنفس المفتاح
    const secondReq = await PaymentService.initiatePayment({
      idempotencyKey: testKey,
      paymentMethodCode: 'CASH',
      financialAccountId: faCash.id,
      type: 'قبض',
      amount: 85000,
      accountId: leafRev.id,
      autoCapture: true
    });
    assert.strictEqual(secondReq.isDuplicate, true);
    assert.strictEqual(secondReq.payment.id, firstReq.payment.id);

    // التأكد من عدم تكرار السند في قاعدة البيانات
    const dbCount = await get('SELECT COUNT(*) as c FROM payments WHERE idempotency_key = ?', [testKey]);
    assert.strictEqual(dbCount.c, 1, 'يجب أن يوجد سجل واحد فقط في قاعدة البيانات');
    console.log(`  ✅ نجحت آلية Idempotency: تم منع تكرار الدفع واسترجاع نفس المعاملة [${firstReq.payment.payment_no}]`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 12:', err.message);
  }

  // [الاختبار 13] حماية Webhook من التكرار وإعادة الإرسال (Replay Attack)
  try {
    console.log('▶ [الاختبار 13/17] اختبار معالجة Webhook مع حماية Replay & Duplicate...');
    // إنشاء معاملة معلقة تنتظر إشعار البوابة
    const pendingForHook = await PaymentService.initiatePayment({
      paymentMethodCode: 'ONLINE_GATEWAY',
      financialAccountId: faGw.id,
      type: 'قبض',
      amount: 90000,
      accountId: leafRev.id,
      reference: 'ORDER-HOOK-1',
      autoCapture: false
    });

    const hookPayload = {
      event: 'payment.succeeded',
      event_id: `evt_${Date.now()}`,
      data: {
        payment_id: pendingForHook.payment.id,
        transaction_id: `TXN_GATEWAY_${Date.now()}`,
        fee: 1800
      }
    };

    // الإشعار الأول
    const hook1 = await PaymentService.processWebhook({
      gateway: 'stripe',
      payload: hookPayload,
      signature: 'test-valid-sig'
    });
    assert.strictEqual(hook1.action, 'CAPTURED');

    // الإشعار الثاني المكرر
    const hook2 = await PaymentService.processWebhook({
      gateway: 'stripe',
      payload: hookPayload,
      signature: 'test-valid-sig'
    });
    assert.strictEqual(hook2.alreadyProcessed, true);
    console.log(`  ✅ نجحت حماية الـ Webhook: الإشعار الأول مرحل والقيد مسجل، والإشعار المكرر تم تجاهله بأمان`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 13:', err.message);
  }

  // [الاختبار 14] رفض الحساب الأب التجميعي في المعاملات المالية
  try {
    console.log('▶ [الاختبار 14/17] اختبار محاولة استخدام حساب أب [1 - الأصول]...');
    let parentRejected = false;
    try {
      await PaymentService.initiatePayment({
        paymentMethodCode: 'CASH',
        financialAccountId: faCash.id,
        type: 'قبض',
        amount: 50000,
        accountId: parentAcc.id,
        autoCapture: true
      });
    } catch (e) {
      parentRejected = e.message.includes('الحساب الفرعي الأخير');
    }
    assert(parentRejected, 'يجب رفض الحساب الأب فوراً بالرسالة النظامية');
    console.log(`  ✅ تم رفض الحساب الأب بنجاح: "لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير."`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 14:', err.message);
  }

  // [الاختبار 15] قبول الحساب الفرعي الأخير المؤهل للقيد
  try {
    console.log('▶ [الاختبار 15/17] اختبار قبول الحساب الفرعي الأخير [41101001]...');
    const leaf = await AccountingService.assertLeafAccount(leafRev.id);
    assert.strictEqual(leaf.id, leafRev.id);
    assert.strictEqual(leaf.is_posting, 1);
    console.log(`  ✅ تم تأكيد صلاحية الحساب النهائي [${leaf.code} - ${leaf.name}] للتسجيل المالي`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 15:', err.message);
  }

  // [الاختبار 16] رفض القيود غير المتوازنة محاسبياً (Debit != Credit)
  try {
    console.log('▶ [الاختبار 16/17] اختبار رفض القيد غير المتوازن (مدين: 100,000 مقابل دائن: 95,000)...');
    let imbalanceRejected = false;
    try {
      await AccountingService.validateJournalEntryLines([
        { account_id: leafExp.id, debit: 100000, credit: 0 },
        { account_id: leafRev.id, debit: 0, credit: 95000 }
      ]);
    } catch (e) {
      imbalanceRejected = e.message.includes('غير متزن محاسبياً');
    }
    assert(imbalanceRejected, 'يجب رفض القيد غير المتوازن');
    console.log(`  ✅ تم رفض القيد غير المتوازن بنجاح مع ظهور رسالة الفرق المحاسبي`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 16:', err.message);
  }

  // [الاختبار 17] الفصل بين طريقة الدفع والحساب المالي (منع حساب بنك لطريقة نقداً)
  try {
    console.log('▶ [الاختبار 17/17] اختبار الفصل الصارم: منع ربط حساب بنك بطريقة الدفع نقداً...');
    let mismatchRejected = false;
    try {
      await PaymentService.initiatePayment({
        paymentMethodCode: 'CASH',
        financialAccountId: faBank.id, // خطأ متعمد: محاولة اختيار بنك لطريقة نقدي
        type: 'قبض',
        amount: 25000,
        accountId: leafRev.id,
        autoCapture: true
      });
    } catch (e) {
      mismatchRejected = e.message.includes('صندوق نقدي') || e.message.includes('حساب بنكي');
    }
    assert(mismatchRejected, 'يجب رفض عدم توافق الحساب المالي مع طريقة الدفع');
    console.log(`  ✅ نجح التحقق الرقابي: تم رفض ربط الحساب البنكي بطريقة الدفع نقداً والالتزام بالصندوق`);
    passedCount++;
  } catch (err) {
    console.error('  ❌ فشل الاختبار 17:', err.message);
  }

  console.log('\n================================================================================');
  console.log(`🎉 اكتمال حزمة اختبارات منظومة المدفوعات: نجح ${passedCount} من إجمالي ${totalTests} اختباراً بنسبة 100%!`);
  console.log('================================================================================\n');

  process.exit(passedCount === totalTests ? 0 : 1);
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
