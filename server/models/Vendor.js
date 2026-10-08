/**
 * server/models/Vendor.js
 * 
 * تعريف كائن وكيان المورد (Vendor / Supplier Entity) ونموذج البيانات
 * وحدة إدارة علاقات الموردين (SRM - Supplier Relationship Management)
 * نظام شركة رواسي عدن للهندسة والمقاولات
 */

// ============================================================================
// 1. قوائم التعداد الصارمة (Strict Domain Enums)
// ============================================================================

const IndustryCategoryEnum = Object.freeze({
  ELECTRICAL: 'كهرباء وإنارة',
  PLUMBING: 'سباكة وصحي',
  BUILDING_MATERIALS: 'مواد بناء وأسمنت وحديد',
  ELECTRONICS: 'إلكترونيات وأنظمة أمان',
  PAINTS: 'دهانات وتشطيبات',
  HVAC: 'تكييف وتهوية',
  HEAVY_EQUIPMENT: 'معدات وآليات ثقيلة',
  CARPENTRY: 'نجارة وأخشاب',
  GENERAL_CONTRACTING: 'مقاولات عامة وتوريدات',
  OTHER: 'أخرى'
});

const CurrencyEnum = Object.freeze({
  YER: 'YER', // ريال يمني
  SAR: 'SAR', // ريال سعودي
  USD: 'USD'  // دولار أمريكي
});

const PaymentDocumentTypeEnum = Object.freeze({
  STANDARD_RECEIPT: 'إيصال عادي',
  SUPPLY_CONTRACT: 'عقد توريد',
  LETTER_OF_CREDIT: 'اعتماد مستندي LC',
  PROMISSORY_NOTE: 'سند لأمر',
  DEFERRED_INVOICE: 'فاتورة مؤجلة'
});

const VendorStatusEnum = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  BLACKLISTED: 'blacklisted',
  UNDER_REVIEW: 'under_review'
});

// ============================================================================
// 2. محددات التحقق من صحة البيانات (Validators)
// ============================================================================

const Validators = {
  /**
   * التحقق من صحة رقم الهاتف وفق التنسيق القياسي (الدولي والمحلي)
   */
  isValidPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const clean = phone.trim().replace(/[\s\-\(\)\.]/g, '');
    if (!clean) return false;
    // المعيار الدولي ITU-T E.164: +?[1-9]\d{6,14} أو الأرقام المحلية في اليمن (9 أرقام تبدأ بـ 7 أو الثابت)
    const e164Regex = /^\+?[1-9]\d{6,14}$/;
    const yemeniRegex = /^(?:00967|\+967|0)?(?:7[01378]\d{7}|[1-7]\d{6})$/;
    return e164Regex.test(clean) || yemeniRegex.test(clean);
  },

  /**
   * تنسيق وتطهير رقم الهاتف القياسي
   */
  sanitizePhoneNumber(phone) {
    if (!phone) return '';
    return phone.trim().replace(/[^\d\+]/g, '');
  },

  /**
   * التحقق من اسم الشركة (إلزامي لا يقل عن حرفين)
   */
  isValidCompanyName(name) {
    return Boolean(name && typeof name === 'string' && name.trim().length >= 2);
  },

  /**
   * التحقق من العملة الافتراضية
   */
  isValidCurrency(currency) {
    if (!currency) return false;
    const c = String(currency).toUpperCase().trim();
    // دعم الرموز الشائعة والترميز الدولي
    return ['YER', 'SAR', 'USD', 'ر.ي', 'ر.س', '$'].includes(c);
  },

  normalizeCurrency(currency) {
    if (!currency) return CurrencyEnum.YER;
    const c = String(currency).trim();
    if (c === 'ر.ي' || c.toUpperCase() === 'YER') return CurrencyEnum.YER;
    if (c === 'ر.س' || c.toUpperCase() === 'SAR') return CurrencyEnum.SAR;
    if (c === '$' || c.toUpperCase() === 'USD') return CurrencyEnum.USD;
    return CurrencyEnum.YER;
  }
};

// ============================================================================
// 3. مخطط كيان المورد ونموذج ORM (Vendor Model Definition)
// ============================================================================

class Vendor {
  constructor(attributes = {}) {
    this.id = attributes.id || null;
    this.company_name = attributes.company_name || attributes.name || '';
    this.industry_category = attributes.industry_category || attributes.category || IndustryCategoryEnum.BUILDING_MATERIALS;
    this.contact_person = attributes.contact_person || '';
    this.phone_number = attributes.phone_number || attributes.phone || '';
    this.email = attributes.email || '';
    this.address = attributes.address || '';
    
    // البيانات المصرفية
    this.bank_name = attributes.bank_name || '';
    this.bank_account_no = attributes.bank_account_no || '';
    this.bank_iban = attributes.bank_iban || '';
    this.bank_details_encrypted = attributes.bank_details_encrypted || null;

    // الخصائص التعاقدية والتشغيلية
    const rawCurrency = attributes.default_currency || attributes.currency;
    if (rawCurrency !== undefined && rawCurrency !== null && rawCurrency !== '') {
      this.default_currency = Validators.isValidCurrency(rawCurrency)
        ? Validators.normalizeCurrency(rawCurrency)
        : String(rawCurrency).trim();
    } else {
      this.default_currency = CurrencyEnum.YER;
    }

    const rawLeadTime = attributes.supply_lead_time_days !== undefined && attributes.supply_lead_time_days !== null && attributes.supply_lead_time_days !== ''
      ? Number(attributes.supply_lead_time_days)
      : 3;
    this.supply_lead_time_days = rawLeadTime;

    this.payment_document_type = attributes.payment_document_type || PaymentDocumentTypeEnum.STANDARD_RECEIPT;
    this.status = attributes.status || VendorStatusEnum.ACTIVE;
    
    this.tax_id = attributes.tax_id || attributes.tax_number || '';
    this.commercial_reg_no = attributes.commercial_reg_no || '';
    this.credit_limit = Number(attributes.credit_limit) || 0;
    this.balance = Number(attributes.balance) || 0;
    this.invoice_attachment = attributes.invoice_attachment || null;
    this.notes = attributes.notes || '';
    
    this.created_at = attributes.created_at || new Date().toISOString();
    this.updated_at = attributes.updated_at || new Date().toISOString();
  }

  /**
   * التحقق الصارم من صحة بيانات الكيان قبل الحفظ
   */
  validate() {
    const errors = [];

    if (!Validators.isValidCompanyName(this.company_name)) {
      errors.push('اسم الشركة (CompanyName) مطلوب ولا يمكن أن يكون فارغاً ويجب ألا يقل عن حرفين.');
    }

    if (this.phone_number && !Validators.isValidPhoneNumber(this.phone_number)) {
      errors.push(`رقم الهاتف (${this.phone_number}) غير صالح وفق التنسيق القياسي الدولي أو المحلي.`);
    }

    if (!Validators.isValidCurrency(this.default_currency)) {
      errors.push(`العملة الافتراضية (${this.default_currency}) غير صالحة. العملات المدعومة: YER, SAR, USD.`);
    }

    if (typeof this.supply_lead_time_days !== 'number' || isNaN(this.supply_lead_time_days) || this.supply_lead_time_days < 0 || !Number.isInteger(this.supply_lead_time_days)) {
      errors.push('مدة التوريد بالأيام يجب أن تكون رقماً صحيحاً غير سالب.');
    }

    if (!this.industry_category || typeof this.industry_category !== 'string' || this.industry_category.trim().length < 2) {
      errors.push('فئة النشاط والتوريد (IndustryCategory) مطلوبة ولا يمكن أن تقل عن حرفين.');
    }

    const validDocTypes = Object.values(PaymentDocumentTypeEnum);
    if (this.payment_document_type && !validDocTypes.includes(this.payment_document_type)) {
      errors.push(`نوع مستند الدفع (${this.payment_document_type}) غير صالح.`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * تعريف علاقات الكيان البرمجية (Entity Relationships / Associations)
   * يوثق علاقات (One-to-Many) وفق متطلبات بنية الأنظمة المؤسسية
   */
  static get associations() {
    return {
      // 1. علاقة واحد-إلى-متعدد مع فواتير الشراء (Vendor has many Purchase Invoices)
      purchaseInvoices: {
        type: 'HasMany',
        model: 'Purchase',
        foreignKey: 'supplier_id',
        sourceKey: 'id',
        description: 'فواتير الشراء التاريخية والجارية الصادرة للمورد'
      },

      // 2. علاقة واحد-إلى-متعدد مع المدفوعات الصادرة (Vendor has many Outgoing Payments)
      payments: {
        type: 'HasMany',
        model: 'Payment',
        foreignKey: 'supplier_id',
        sourceKey: 'id',
        scope: { type: 'صرف' },
        description: 'سندات ومعاملات الصرف المالي المنفذة للمورد'
      },

      // 3. علاقة واحد-إلى-متعدد مع أوامر الشراء (Vendor has many Purchase Orders)
      purchaseOrders: {
        type: 'HasMany',
        model: 'PurchaseOrder',
        foreignKey: 'supplier_id',
        sourceKey: 'id',
        description: 'أوامر الشراء المعتمدة والتوريدات قيد التنفيذ'
      },

      // 4. علاقة واحد-إلى-متعدد مع عروض أسعار المناقصات (Vendor has many RFQ Quotes)
      rfqQuotes: {
        type: 'HasMany',
        model: 'RfqVendorQuote',
        foreignKey: 'supplier_id',
        sourceKey: 'id',
        description: 'عروض الأسعار المقدمة في مناقصات المواد'
      }
    };
  }
}

module.exports = {
  Vendor,
  IndustryCategoryEnum,
  CurrencyEnum,
  PaymentDocumentTypeEnum,
  VendorStatusEnum,
  Validators
};
