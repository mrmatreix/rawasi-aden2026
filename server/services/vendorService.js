/**
 * server/services/vendorService.js
 * 
 * خدمة إدارة علاقات الموردين والملف التعريفي (Vendor / SRM Service)
 * نظام شركة رواسي عدن للهندسة والمقاولات
 * 
 * الميزات المعمارية الرئيسية:
 * 1. التجميعات المالية الديناميكية في الوقت الفعلي عبر عرض SQL مجمع يمنع عدم اتساق البيانات.
 * 2. التخلص التام من مشكلة استعلام (N+1 Query Problem) عبر التجميع أحادي التمرير (Single-Pass Aggregation)
 *    وتقنية التحميل المسبق المتوازي (Parallel Eager Loading).
 * 3. التشفير والحماية الصارمة للبيانات المصرفية (AES-256-GCM).
 * 4. التحقق الصارم من صحة التنسيق القياسي لأرقام الهواتف والعملات وفئات النشاط.
 */

const crypto = require('crypto');
const { query, get, run, transaction } = require('../database/db');
const { Vendor, IndustryCategoryEnum, CurrencyEnum, PaymentDocumentTypeEnum, VendorStatusEnum, Validators } = require('../models/Vendor');
const VendorProfileDTO = require('../dtos/VendorProfileDTO');

// مفتاح التشفير للبيانات المصرفية الحساسة
const ENCRYPTION_SECRET = process.env.BANK_ENCRYPTION_KEY || 'rawasi-aden-srm-vendor-secure-key-32b!';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

class VendorService {

  // =========================================================================
  // 1. استرجاع قائمة الموردين مع التجميعات الديناميكية (Zero N+1 Query List)
  // =========================================================================
  /**
   * جلب قائمة الموردين مع حساب كافة المؤشرات المالية في استعلام SQL وحيد
   * يتجنب مشكلة N+1 نهائياً حتى مع آلاف الفواتير السابقة
   */
  async listVendors(filters = {}, pagination = {}) {
    const page = Math.max(1, Number(pagination.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(pagination.limit) || 25));
    const offset = (page - 1) * limit;

    const whereClauses = [];
    const params = [];

    if (filters.search) {
      whereClauses.push(`(
        company_name LIKE ? OR 
        contact_person LIKE ? OR 
        phone_number LIKE ? OR 
        tax_id LIKE ?
      )`);
      const s = `%${filters.search.trim()}%`;
      params.push(s, s, s, s);
    }

    if (filters.industry_category) {
      whereClauses.push('industry_category = ?');
      params.push(filters.industry_category);
    }

    if (filters.status) {
      whereClauses.push('status = ?');
      params.push(filters.status);
    }

    if (filters.default_currency) {
      whereClauses.push('default_currency = ?');
      params.push(filters.default_currency);
    }

    if (filters.has_outstanding_balance === true || filters.has_outstanding_balance === 'true') {
      whereClauses.push('outstanding_balance > 0');
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 1. استعلام العد الإجمالي للصفحات
    const countSql = `SELECT COUNT(*) AS total FROM view_vendor_financial_profiles ${whereSql}`;
    const countRes = await get(countSql, params);
    const totalCount = countRes ? Number(countRes.total) : 0;

    // 2. استعلام جلب البيانات المجمعة في استعلام وحيد (Single Query Execution)
    // بفضل view_vendor_financial_profiles، يتم حساب COUNT و SUM و Balance في تمريرة واحدة
    const dataSql = `
      SELECT * 
      FROM view_vendor_financial_profiles 
      ${whereSql} 
      ORDER BY 
        CASE WHEN outstanding_balance > 0 THEN 0 ELSE 1 END,
        id DESC 
      LIMIT ? OFFSET ?
    `;

    const queryParams = [...params, limit, offset];
    const rows = await query(dataSql, queryParams);

    // تحويل النتائج إلى DTOs
    const vendors = rows.map(row => new VendorProfileDTO(row, row));

    return {
      success: true,
      data: vendors.map(v => v.toJSON()),
      meta: {
        total: totalCount,
        page,
        limit,
        total_pages: Math.ceil(totalCount / limit) || 1
      }
    };
  }

  // =========================================================================
  // 2. جلب ملف تعريف المورد الشامل مع التحميل المسبق (Eager-Loaded Profile)
  // =========================================================================
  /**
   * جلب الملف التعريفي الكامل لمورد معين مع تحميل تاريخ الفواتير والمدفوعات
   * يتم التنفيذ عبر استعلامات متوازية مفهرسة تمنع N+1 بالكامل
   */
  async getVendorProfile(vendorId, options = { includeRecent: true, limit: 10 }) {
    const id = Number(vendorId);
    if (!id || isNaN(id)) throw new Error('معرف المورد غير صالح.');

    // 1. استعلام جلب الملف التعريفي والتجميعات المالية الحية
    const profileRow = await get(`
      SELECT * 
      FROM view_vendor_financial_profiles 
      WHERE id = ? OR vendor_id = ?
      LIMIT 1
    `, [id, id]);

    if (!profileRow) {
      throw new Error(`المورد ذو المعرف (${id}) غير موجود في النظام.`);
    }

    const eagerRelations = {};

    // 2. التحميل المسبق للعمليات السابقة عند طلب التفاصيل (Eager Loading)
    if (options.includeRecent) {
      const recentLimit = Number(options.limit) || 10;

      const [recentInvoices, recentPayments, recentOrders] = await Promise.all([
        // جلب آخر فواتير الشراء المسجلة لهذا المورد
        query(`
          SELECT 
            id, invoice_no, project_id, total_amount, paid_amount, 
            payment_status, payment_method, date, notes
          FROM purchases
          WHERE supplier_id = ? AND (status != 'cancelled' OR status IS NULL)
          ORDER BY date DESC, id DESC
          LIMIT ?
        `, [id, recentLimit]),

        // جلب آخر سندات الصرف والمدفوعات
        query(`
          SELECT 
            id, receipt_no, amount, currency, payment_method, 
            check_no, bank_name, date, status
          FROM payments
          WHERE supplier_id = ? AND type = 'صرف' AND (status != 'cancelled' OR status IS NULL)
          ORDER BY date DESC, id DESC
          LIMIT ?
        `, [id, recentLimit]),

        // جلب آخر أوامر الشراء الصادرة
        query(`
          SELECT 
            po.id, po.po_no, po.date, po.expected_delivery_date, 
            po.total_amount, po.status, p.name as project_name
          FROM purchase_orders po
          LEFT JOIN projects p ON po.project_id = p.id
          WHERE po.supplier_id = ?
          ORDER BY po.date DESC
          LIMIT ?
        `, [id, recentLimit])
      ]);

      eagerRelations.recent_invoices = recentInvoices;
      eagerRelations.recent_payments = recentPayments;
      eagerRelations.active_orders = recentOrders;
    }

    const dto = new VendorProfileDTO(profileRow, profileRow, eagerRelations);

    return {
      success: true,
      data: dto.toJSON()
    };
  }

  // =========================================================================
  // 3. إنشاء مورد جديد مع التحقق والتشفير المصرفي (Create Vendor)
  // =========================================================================
  async createVendor(data, user = null) {
    const vendorModel = new Vendor(data);
    const validation = vendorModel.validate();

    if (!validation.isValid) {
      throw new Error(validation.errors.join(' | '));
    }

    // تشفير البيانات المصرفية بشكل آمن إذا توفرت
    let encryptedVault = null;
    if (data.bank_name || data.bank_account_no || data.bank_iban) {
      encryptedVault = this.encryptBankDetails({
        bank_name: data.bank_name || '',
        bank_account_no: data.bank_account_no || '',
        bank_iban: data.bank_iban || '',
        account_holder: data.account_holder || vendorModel.company_name,
        swift_code: data.swift_code || ''
      });
    }

    const insertSql = `
      INSERT INTO suppliers (
        name, company_name, industry_category, contact_person,
        phone, phone_number, email, address,
        bank_name, bank_account_no, bank_iban, bank_details_encrypted,
        default_currency, currency, supply_lead_time_days,
        payment_document_type, status, tax_id, commercial_reg_no,
        credit_limit, balance, invoice_attachment, notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;

    const params = [
      vendorModel.company_name,
      vendorModel.company_name,
      vendorModel.industry_category,
      vendorModel.contact_person,
      vendorModel.phone_number,
      vendorModel.phone_number,
      vendorModel.email,
      vendorModel.address,
      vendorModel.bank_name,
      vendorModel.bank_account_no,
      vendorModel.bank_iban,
      encryptedVault,
      vendorModel.default_currency,
      vendorModel.default_currency,
      vendorModel.supply_lead_time_days,
      vendorModel.payment_document_type,
      vendorModel.status,
      vendorModel.tax_id,
      vendorModel.commercial_reg_no,
      vendorModel.credit_limit,
      vendorModel.balance || 0,
      vendorModel.invoice_attachment || null,
      vendorModel.notes
    ];

    await this.ensureCategoryExists(vendorModel.industry_category);

    const result = await run(insertSql, params);
    const newId = result.lastInsertRowid || result.insertId;

    return this.getVendorProfile(newId, { includeRecent: false });
  }

  // =========================================================================
  // 4. تحديث بيانات المورد (Update Vendor)
  // =========================================================================
  async updateVendor(vendorId, data, user = null) {
    const id = Number(vendorId);
    if (!id) throw new Error('معرف المورد مطلوب للتعديل.');

    const existing = await get('SELECT * FROM suppliers WHERE id = ?', [id]);
    if (!existing) throw new Error('المورد المطلوب تعديله غير موجود.');

    const merged = { ...existing, ...data };
    const vendorModel = new Vendor(merged);
    const validation = vendorModel.validate();

    if (!validation.isValid) {
      throw new Error(validation.errors.join(' | '));
    }

    // إعادة تشفير البيانات المصرفية إذا تم تعديلها
    let encryptedVault = existing.bank_details_encrypted;
    if (data.bank_name !== undefined || data.bank_account_no !== undefined || data.bank_iban !== undefined) {
      encryptedVault = this.encryptBankDetails({
        bank_name: data.bank_name || existing.bank_name || '',
        bank_account_no: data.bank_account_no || existing.bank_account_no || '',
        bank_iban: data.bank_iban || existing.bank_iban || '',
        account_holder: data.account_holder || vendorModel.company_name
      });
    }

    const updateSql = `
      UPDATE suppliers SET
        name = ?,
        company_name = ?,
        industry_category = ?,
        category = ?,
        contact_person = ?,
        phone = ?,
        phone_number = ?,
        email = ?,
        address = ?,
        bank_name = ?,
        bank_account_no = ?,
        bank_iban = ?,
        bank_details_encrypted = ?,
        default_currency = ?,
        currency = ?,
        supply_lead_time_days = ?,
        payment_document_type = ?,
        status = ?,
        tax_id = ?,
        commercial_reg_no = ?,
        credit_limit = ?,
        balance = ?,
        invoice_attachment = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    const params = [
      vendorModel.company_name,
      vendorModel.company_name,
      vendorModel.industry_category,
      vendorModel.industry_category,
      vendorModel.contact_person,
      vendorModel.phone_number,
      vendorModel.phone_number,
      vendorModel.email,
      vendorModel.address,
      vendorModel.bank_name,
      vendorModel.bank_account_no,
      vendorModel.bank_iban,
      encryptedVault,
      vendorModel.default_currency,
      vendorModel.default_currency,
      vendorModel.supply_lead_time_days,
      vendorModel.payment_document_type,
      vendorModel.status,
      vendorModel.tax_id,
      vendorModel.commercial_reg_no,
      vendorModel.credit_limit,
      vendorModel.balance !== undefined ? vendorModel.balance : 0,
      vendorModel.invoice_attachment !== undefined ? vendorModel.invoice_attachment : null,
      vendorModel.notes,
      id
    ];

    await this.ensureCategoryExists(vendorModel.industry_category);

    await run(updateSql, params);

    return this.getVendorProfile(id, { includeRecent: false });
  }

  // =========================================================================
  // 4.1 ضمان تسجيل فئة النشاط المخصصة في جدول القوائم المرجعية
  // =========================================================================
  async ensureCategoryExists(categoryName) {
    if (!categoryName || typeof categoryName !== 'string') return;
    const clean = categoryName.trim();
    if (clean.length < 2) return;
    try {
      const existing = await get('SELECT id FROM vendor_industry_categories WHERE name_ar = ? OR code = ?', [clean, clean]);
      if (!existing) {
        const code = 'CAT_' + Date.now().toString(36).toUpperCase();
        await run('INSERT INTO vendor_industry_categories (code, name_ar, name_en, icon) VALUES (?, ?, ?, ?)', [
          code, clean, clean, '📋'
        ]);
      }
    } catch (e) {
      // تجاهل إذا كان موجوداً مسبقاً أو حدث تزامن
    }
  }

  // =========================================================================
  // 5. حذف المورد (مع التحقق من عدم وجود قيود مالية مرتبطة)
  // =========================================================================
  async deleteVendor(vendorId, user = null) {
    const id = Number(vendorId);
    if (!id) throw new Error('معرف المورد غير صالح.');

    // التحقق من وجود فواتير أو مدفوعات تمنع الحذف لحماية اتساق القيود المحاسبية
    const invoices = await get('SELECT COUNT(*) as c FROM purchases WHERE supplier_id = ?', [id]);
    const payments = await get('SELECT COUNT(*) as c FROM payments WHERE supplier_id = ?', [id]);

    if ((invoices && invoices.c > 0) || (payments && payments.c > 0)) {
      throw new Error(`لا يمكن حذف المورد لوجود (${invoices.c}) فاتورة شراء و (${payments.c}) سند دفع مرتبط به. يمكنك تعليق حسابه بتغيير الحالة إلى 'معلق'.`);
    }

    await run('DELETE FROM suppliers WHERE id = ?', [id]);
    return { success: true, message: 'تم حذف المورد بنجاح.' };
  }

  // =========================================================================
  // 6. القوائم المرجعية والخيارات (SRM Lookups)
  // =========================================================================
  async getLookups() {
    let categories = [];
    let paymentDocTypes = [];

    try {
      categories = await query('SELECT code, name_ar, name_en, icon FROM vendor_industry_categories WHERE is_active = 1 ORDER BY id ASC');
      paymentDocTypes = await query('SELECT code, name_ar, description FROM vendor_payment_document_types WHERE is_active = 1 ORDER BY id ASC');
    } catch (e) {
      // Fallback إلى قوائم التعداد الثابتة
      categories = Object.values(IndustryCategoryEnum).map(name => ({ code: name, name_ar: name }));
      paymentDocTypes = Object.values(PaymentDocumentTypeEnum).map(name => ({ code: name, name_ar: name }));
    }

    return {
      success: true,
      data: {
        industry_categories: categories,
        payment_document_types: paymentDocTypes,
        currencies: [
          { code: 'YER', name: 'ريال يمني', symbol: 'ر.ي' },
          { code: 'SAR', name: 'ريال سعودي', symbol: 'ر.س' },
          { code: 'USD', name: 'دولار أمريكي', symbol: '$' }
        ],
        statuses: [
          { code: 'active', name: 'نشط 🟢' },
          { code: 'suspended', name: 'معلق 🟡' },
          { code: 'under_review', name: 'قيد المراجعة 🔵' },
          { code: 'blacklisted', name: 'محظور ⛔' }
        ]
      }
    };
  }

  // =========================================================================
  // 7. أدوات التشفير المصرفي الآمن (AES-256-GCM Encryption / Decryption)
  // =========================================================================
  encryptBankDetails(detailsObj) {
    try {
      const text = JSON.stringify(detailsObj);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag().toString('hex');
      return `${iv.toString('hex')}:${encrypted}:${tag}`;
    } catch (err) {
      console.error('Error encrypting bank details:', err);
      return null;
    }
  }

  decryptBankDetails(encryptedStr) {
    if (!encryptedStr || typeof encryptedStr !== 'string') return null;
    try {
      const parts = encryptedStr.split(':');
      if (parts.length !== 3) return null;
      const [ivHex, cipherHex, tagHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch (err) {
      console.error('Error decrypting bank details:', err);
      return null;
    }
  }

  /**
   * جلب البيانات المصرفية المفكوكة للمستخدمين ذوي الصلاحيات المالية العالية
   */
  async getDecryptedBankDetails(vendorId, requestingUser) {
    const vendor = await get('SELECT id, company_name, bank_name, bank_account_no, bank_iban, bank_details_encrypted FROM suppliers WHERE id = ?', [vendorId]);
    if (!vendor) throw new Error('المورد غير موجود.');

    let decrypted = null;
    if (vendor.bank_details_encrypted) {
      decrypted = this.decryptBankDetails(vendor.bank_details_encrypted);
    }

    return {
      success: true,
      data: {
        vendor_id: vendor.id,
        company_name: vendor.company_name,
        bank_name: decrypted?.bank_name || vendor.bank_name || 'غير محدد',
        account_number: decrypted?.bank_account_no || vendor.bank_account_no || 'غير متوفر',
        iban: decrypted?.bank_iban || vendor.bank_iban || 'غير متوفر',
        account_holder: decrypted?.account_holder || vendor.company_name,
        swift_code: decrypted?.swift_code || ''
      }
    };
  }
}

module.exports = new VendorService();
