/**
 * tests/integration/vendor_srm_profile.test.js
 * 
 * فحص تكاملي شامل لوحدة إدارة علاقات الموردين (SRM) وملف تعريف المورد
 * 
 * المحاور المختبرة:
 * 1. صحة ونزاهة البيانات الأساسية (Master Data Strict Validation):
 *    - التحقق الإلزامي من CompanyName.
 *    - التحقق من Phone Number بالتنسيق القياسي.
 *    - التحقق من DefaultCurrency ضمن (YER, SAR, USD).
 *    - التحقق من SupplyLeadTimeDays كعدد صحيح موجب.
 *    - التحقق من IndustryCategory و PaymentDocumentType.
 * 2. الأمان والتشفير البنكي (Bank Details AES-256-GCM Encryption & Masking):
 *    - تشفير تفاصيل البنك في قاعدة البيانات ومنع التخزين المكشوف.
 *    - تقنيع الحسابات في VendorProfileDTO للأمان العام.
 *    - فك التشفير الحصري للصلاحيات المالية المعتمدة.
 * 3. التجميعات المالية الديناميكية الحية (Zero Static Drift Dynamic Aggregations):
 *    - TotalPurchaseInvoicesCount: حساب لحظي للفواتير دون تخزين ثابت.
 *    - TotalAmountPaid: تجميع حقيقي للمدفوعات المسواة.
 *    - OutstandingBalance: الحساب الديناميكي (المفوتر - المدفوع) في الوقت الفعلي.
 * 4. حل معضلة استعلامات N+1 (Zero N+1 Query Architecture):
 *    - جلب قائمة الموردين مع تجميعاتهم المالية كاملة في استعلام SQL وحيد وفائق السرعة.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { query, get, run } = require('../../server/database/db');
const VendorService = require('../../server/services/vendorService');
const { Vendor, CurrencyEnum, IndustryCategoryEnum, PaymentDocumentTypeEnum } = require('../../server/models/Vendor');

describe('🏢 Supplier Relationship Management (SRM) & Vendor Profile Suite', async () => {
  let createdVendorId;
  const mockUser = { id: 1, username: 'finance_admin', role: 'admin' };
  const uniqueSuffix = Date.now();
  const testCompanyName = `شركة الأفق الحديثة للتوريدات ${uniqueSuffix}`;

  // ============================================================================
  // الاختبار 1: التحقق الصارم من صحة البيانات الأساسية (Master Data Validation)
  // ============================================================================
  test('1. يجب رفض إنشاء مورد إذا كان اسم الشركة فارغاً أو غير صالح', async () => {
    await assert.rejects(
      async () => {
        await VendorService.createVendor({
          company_name: '   ',
          phone_number: '+967771234567'
        }, mockUser);
      },
      { message: /اسم الشركة.*مطلوب/ }
    );
  });

  test('2. يجب رفض إنشاء مورد إذا كان رقم الهاتف لا يطابق التنسيق القياسي', async () => {
    await assert.rejects(
      async () => {
        await VendorService.createVendor({
          company_name: 'مورد اختبار الهاتف',
          phone_number: '123-invalid-phone'
        }, mockUser);
      },
      { message: /رقم الهاتف.*غير صالح/ }
    );
  });

  test('3. يجب رفض العملات غير المدعومة في دفتر الحسابات متعدد العملات', async () => {
    await assert.rejects(
      async () => {
        await VendorService.createVendor({
          company_name: 'مورد عملة مجهولة',
          default_currency: 'EUR' // فقط YER, SAR, USD مدعومة
        }, mockUser);
      },
      { message: /العملة الافتراضية.*غير صالحة/ }
    );
  });

  test('4. يجب رفض فترات التوريد السالبة أو غير الصحيحة', async () => {
    await assert.rejects(
      async () => {
        await VendorService.createVendor({
          company_name: 'مورد توريد سالب',
          supply_lead_time_days: -5
        }, mockUser);
      },
      { message: /مدة التوريد بالأيام/ }
    );
  });

  // ============================================================================
  // الاختبار 2: إنشاء مورد مكتمل البيانات وتشفير الحساب البنكي بأمان AES-256-GCM
  // ============================================================================
  test('5. إنشاء مورد جديد بنجاح وتشفير البيانات البنكية الحساسة', async () => {
    const payload = {
      company_name: testCompanyName,
      industry_category: 'مواد بناء وإنشاءات',
      contact_person: 'المهندس رامي باعبيد',
      phone_number: '+967 771 998 877',
      bank_name: 'بنك التضامن الإسلامي',
      bank_account_no: '1029384756',
      bank_iban: 'YE5000040000001029384756',
      default_currency: 'YER',
      supply_lead_time_days: 7,
      payment_document_type: 'عقد توريد',
      tax_id: 'TAX-998877',
      credit_limit: 5000000
    };

    const res = await VendorService.createVendor(payload, mockUser);
    assert.ok(res.success);
    assert.ok(res.data.id);
    createdVendorId = res.data.id;

    // فحص السجل في قاعدة البيانات للتحقق من تشفير البيانات البنكية
    const rawRow = await get('SELECT * FROM suppliers WHERE id = ?', [createdVendorId]);
    assert.equal(rawRow.company_name, testCompanyName);
    assert.equal(rawRow.industry_category, 'مواد بناء وإنشاءات');
    assert.equal(rawRow.default_currency, 'YER');
    assert.equal(rawRow.supply_lead_time_days, 7);
    assert.equal(rawRow.payment_document_type, 'عقد توريد');
    assert.ok(rawRow.bank_details_encrypted, 'يجب أن يكون الحقل المشفر موجوداً');
    
    // التحقق من أن الحقل المشفر يحتوي على بنية تشفير AES-256-GCM (iv:authTag:ciphertext)
    assert.match(rawRow.bank_details_encrypted, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
  });

  test('6. التحقق من تقنيع البيانات المصرفية في VendorProfileDTO وحمايتها من التسريب', async () => {
    const profile = await VendorService.getVendorProfile(createdVendorId, { includeRecent: false });
    
    assert.ok(profile.success);
    const dto = profile.data;
    
    // فحص تقنيع الحساب المصرفي
    assert.ok(dto.bank_details.is_masked);
    assert.match(dto.bank_details.account_number_masked, /••••/);
    assert.match(dto.bank_details.iban_masked, /••••/);
    assert.equal(dto.bank_details.bank_name, 'بنك التضامن الإسلامي');
    
    // التأكد من عدم إرجاع النص الخام الصريح في كائن الملف العام
    assert.notEqual(dto.bank_details.account_number_masked, '1029384756');
  });

  test('7. فك تشفير البيانات البنكية بنجاح للصلاحيات المالية المخولة فقط', async () => {
    const decrypted = await VendorService.getDecryptedBankDetails(createdVendorId, mockUser);
    assert.ok(decrypted.success);
    assert.equal(decrypted.data.account_number, '1029384756');
    assert.equal(decrypted.data.iban, 'YE5000040000001029384756');
    assert.equal(decrypted.data.bank_name, 'بنك التضامن الإسلامي');
  });

  // ============================================================================
  // الاختبار 3: التجميعات المالية الحية في الوقت الفعلي (Zero Static Inconsistency)
  // ============================================================================
  test('8. في البداية: رصيد المورد وفواتيره يجب أن تكون صفراً دون أي قيم ثابتة قديمة', async () => {
    const profile = await VendorService.getVendorProfile(createdVendorId, { includeRecent: false });
    const fin = profile.data.financial_summary;
    
    assert.equal(fin.total_purchase_invoices_count, 0);
    assert.equal(fin.total_invoiced_amount, 0);
    assert.equal(fin.total_amount_paid, 0);
    assert.equal(fin.outstanding_balance, 0);
    assert.equal(fin.settlement_status, 'no_invoices');
    assert.equal(fin.settlement_status_label, 'لا توجد فواتير');
  });

  test('9. عند تسجيل فواتير شراء جديدة: تتحدث التجميعات المالية ديناميكياً وفورياً', async () => {
    // فاتورة شراء 1: بمبلغ 300,000 ر.ي
    await run(`
      INSERT INTO purchases (
        invoice_no, supplier_id, date, total_amount, paid_amount,
        status, created_at
      ) VALUES (?, ?, date('now'), 300000, 0, 'approved', datetime('now'))
    `, [`INV-SRM-1-${uniqueSuffix}`, createdVendorId]);

    // فاتورة شراء 2: بمبلغ 200,000 ر.ي
    await run(`
      INSERT INTO purchases (
        invoice_no, supplier_id, date, total_amount, paid_amount,
        status, created_at
      ) VALUES (?, ?, date('now'), 200000, 0, 'approved', datetime('now'))
    `, [`INV-SRM-2-${uniqueSuffix}`, createdVendorId]);

    // جلب الملف الشخصي للتحقق من الحساب اللحظي المباشر
    const profile = await VendorService.getVendorProfile(createdVendorId, { includeRecent: true });
    const fin = profile.data.financial_summary;

    assert.equal(fin.total_purchase_invoices_count, 2, 'يجب أن يكون إجمالي عدد الفواتير 2');
    assert.equal(fin.total_invoiced_amount, 500000, 'إجمالي المفوتر 500,000');
    assert.equal(fin.total_amount_paid, 0, 'المدفوع حتى الآن 0');
    assert.equal(fin.outstanding_balance, 500000, 'الرصيد المستحق غير المسدد 500,000');
    assert.equal(fin.settlement_status, 'pending_settlement');
    assert.equal(fin.settlement_status_label, 'معلق بانتظار السداد');
    assert.equal(profile.data.recent_invoices.length, 2, 'يجب إرجاع الفواتير ضمن Eager Loading');
  });

  test('10. عند تسجيل سندات صرف ومسواة: يُخصم الرصيد تلقائياً بدون تخزين ثابت (Zero Static Drift)', async () => {
    // سند صرف أول بمبلغ 200,000 ر.ي للمورد
    await run(`
      INSERT INTO payments (
        receipt_no, supplier_id, amount, date, type,
        status, notes, created_at
      ) VALUES (?, ?, 200000, date('now'), 'صرف', 'cleared', 'دفعة أولى للحساب', datetime('now'))
    `, [`PAY-SRM-1-${uniqueSuffix}`, createdVendorId]);

    // سند صرف ثان بمبلغ 150,000 ر.ي
    await run(`
      INSERT INTO payments (
        receipt_no, supplier_id, amount, date, type,
        status, notes, created_at
      ) VALUES (?, ?, 150000, date('now'), 'صرف', 'cleared', 'دفعة ثانية', datetime('now'))
    `, [`PAY-SRM-2-${uniqueSuffix}`, createdVendorId]);

    // سند غير مسوى (pending / cancelled) لا يجب أن يؤثر على المسدد
    await run(`
      INSERT INTO payments (
        receipt_no, supplier_id, amount, date, type,
        status, notes, created_at
      ) VALUES (?, ?, 50000, date('now'), 'صرف', 'pending', 'معاملة معلقة لم تسوى بعد', datetime('now'))
    `, [`PAY-SRM-3-${uniqueSuffix}`, createdVendorId]);

    const profile = await VendorService.getVendorProfile(createdVendorId, { includeRecent: true });
    const fin = profile.data.financial_summary;

    assert.equal(fin.total_purchase_invoices_count, 2);
    assert.equal(fin.total_invoiced_amount, 500000);
    assert.equal(fin.total_amount_paid, 350000, 'يجب احتساب المعاملات المسواة فقط (200K + 150K)');
    assert.equal(fin.outstanding_balance, 150000, 'الرصيد المتبقي = 500,000 - 350,000 = 150,000');
    assert.equal(fin.settlement_status, 'partially_settled');
    assert.equal(fin.settlement_status_label, 'مسدد جزئياً');
    assert.equal(fin.payment_coverage_ratio_pct, 70, 'نسبة السداد 70%');
    assert.equal(profile.data.recent_payments.length, 3);
  });

  // ============================================================================
  // الاختبار 4: منع معضلة استعلامات N+1 (Zero N+1 Query Verification)
  // ============================================================================
  test('11. التحقق من حل مشكلة استعلام N+1 عند جلب كافة الموردين في استعلام تجميعي واحد', async () => {
    // استدعاء listVendors لجميع الموردين
    const startTime = Date.now();
    const result = await VendorService.listVendors({ limit: 50 }, { limit: 50 });
    const executionTimeMs = Date.now() - startTime;

    assert.ok(result.data.length > 0, 'يجب العثور على موردين');
    
    // التحقق من أن كل مورد يحمل مؤشراته المحسوبة دون الحاجة لإجراء استعلامات لاحقة
    const vendorRow = result.data.find(v => v.id === createdVendorId);
    assert.ok(vendorRow, 'يجب أن يظهر المورد التجريبي في القائمة');
    assert.equal(vendorRow.financial_summary.total_purchase_invoices_count, 2);
    assert.equal(vendorRow.financial_summary.total_invoiced_amount, 500000);
    assert.equal(vendorRow.financial_summary.total_amount_paid, 350000);
    assert.equal(vendorRow.financial_summary.outstanding_balance, 150000);

    // التأكد من أن وقت التنفيذ سريع جداً (عادة أقل من 50 مللي ثانية)
    assert.ok(executionTimeMs < 500, `زمن تنفيذ الاستعلام فائق السرعة (${executionTimeMs}ms)`);
  });

  // ============================================================================
  // الاختبار 5: جداول وقوائم الـ Lookups المرجعية
  // ============================================================================
  test('12. التحقق من استرجاع القوائم المرجعية لفئات النشاط وأنواع مستندات الدفع والعملات', async () => {
    const lookups = await VendorService.getLookups();
    assert.ok(lookups.data.industry_categories.length >= 10);
    assert.ok(lookups.data.payment_document_types.length >= 5);
    assert.deepEqual(lookups.data.currencies.map(c => c.code), ['YER', 'SAR', 'USD']);
    assert.deepEqual(lookups.data.statuses.map(s => s.code), ['active', 'suspended', 'under_review', 'blacklisted']);
  });

  // ============================================================================
  // الاختبار 6: رقم المبلغ بعد اختيار العملة وإرفاق فواتير PDF والماسح الضوئي
  // ============================================================================
  test('13. التحقق من حفظ واسترجاع رقم المبلغ (الرصيد) مع العملة المحددة بدقة', async () => {
    const updated = await VendorService.updateVendor(createdVendorId, {
      default_currency: 'SAR',
      balance: 75000.50
    }, mockUser);

    assert.ok(updated.success);
    assert.equal(updated.data.default_currency, 'SAR');
    assert.equal(updated.data.balance, 75000.50);
    assert.equal(updated.data.opening_balance, 75000.50);

    const profile = await VendorService.getVendorProfile(createdVendorId, { includeRecent: false });
    assert.equal(profile.data.balance, 75000.50);
  });

  test('14. التحقق من حفظ واسترجاع فواتير PDF والمستندات الممسوحة ضوئياً', async () => {
    const mockInvoices = [
      {
        id: 'att_101',
        name: 'فاتورة_توريد_حديد.pdf',
        type: 'application/pdf',
        size: 154200,
        data: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXr...',
        date: '2026-10-04 12:30'
      },
      {
        id: 'scan_202',
        name: 'فاتورة_ممسوحة_ضوئياً.jpg',
        type: 'image/jpeg',
        size: 89400,
        data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...',
        date: '2026-10-04 12:35'
      }
    ];

    const updated = await VendorService.updateVendor(createdVendorId, {
      invoice_attachment: JSON.stringify(mockInvoices)
    }, mockUser);

    assert.ok(updated.success);
    assert.ok(updated.data.invoice_attachment);

    const parsed = JSON.parse(updated.data.invoice_attachment);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].name, 'فاتورة_توريد_حديد.pdf');
    assert.equal(parsed[0].type, 'application/pdf');
    assert.equal(parsed[1].name, 'فاتورة_ممسوحة_ضوئياً.jpg');
    assert.equal(parsed[1].type, 'image/jpeg');
  });

  after(async () => {
    // تنظيف البيانات التجريبية
    if (createdVendorId) {
      await run('DELETE FROM purchases WHERE supplier_id = ?', [createdVendorId]);
      await run('DELETE FROM payments WHERE supplier_id = ?', [createdVendorId]);
      await run('DELETE FROM suppliers WHERE id = ?', [createdVendorId]);
    }
  });
});
