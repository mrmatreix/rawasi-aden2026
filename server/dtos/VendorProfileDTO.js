/**
 * server/dtos/VendorProfileDTO.js
 * 
 * كائن نقل البيانات لملف تعريف المورد (VendorProfileDTO)
 * يجمع بشكل منظم ومتكامل بين البيانات الأساسية الثابتة للمورد والتجميعات المالية الديناميكية المحسوبة في الوقت الفعلي.
 * يضمن إخفاء وتأمين البيانات المصرفية الحساسة (Data Masking) وتوحيد مخرجات الـ API.
 */

class VendorProfileDTO {
  /**
   * @param {Object} masterData البيانات الأساسية الثابتة
   * @param {Object} dynamicAggregations التجميعات المالية المحسوبة في الوقت الفعلي
   * @param {Object} eagerRelations المجموعات المحملة بشكل مسبق (فواتير، مدفوعات)
   */
  constructor(masterData = {}, dynamicAggregations = {}, eagerRelations = {}) {
    // =========================================================================
    // 1. البيانات الأساسية الثابتة (Master Data)
    // =========================================================================
    this.id = masterData.id ?? masterData.vendor_id ?? null;
    this.company_name = masterData.company_name || masterData.name || '';
    this.industry_category = masterData.industry_category || masterData.category || 'مواد بناء';
    this.contact_person = masterData.contact_person || masterData.manager_name || 'غير محدد';
    this.phone_number = masterData.phone_number || masterData.phone || '';
    this.email = masterData.email || '';
    this.address = masterData.address || '';
    this.default_currency = masterData.default_currency || masterData.currency || 'YER';
    this.supply_lead_time_days = Number(masterData.supply_lead_time_days) || 3;
    this.payment_document_type = masterData.payment_document_type || 'إيصال عادي';
    this.status = masterData.status || 'active';
    this.tax_id = masterData.tax_id || masterData.tax_number || '';
    this.commercial_reg_no = masterData.commercial_reg_no || '';
    this.credit_limit = Number(masterData.credit_limit) || 0;
    this.balance = Number(masterData.balance) || 0;
    this.opening_balance = this.balance;
    this.invoice_attachment = masterData.invoice_attachment || null;
    this.notes = masterData.notes || '';
    this.created_at = masterData.created_at || null;
    this.updated_at = masterData.updated_at || null;

    // =========================================================================
    // 2. البيانات المصرفية الآمنة (Secure Masked Bank Details)
    // =========================================================================
    const rawAcc = masterData.bank_account_no || '';
    const rawIban = masterData.bank_iban || '';

    this.bank_details = {
      bank_name: masterData.bank_name || 'غير محدد',
      account_number_masked: this._maskAccountNumber(rawAcc),
      iban_masked: this._maskIban(rawIban),
      is_masked: true,
      has_bank_details: Boolean(masterData.bank_name && (rawAcc || rawIban)),
      has_encrypted_vault: Boolean(masterData.bank_details_encrypted)
    };

    // =========================================================================
    // 3. التجميعات المالية الديناميكية (Real-time Dynamic Financial Aggregations)
    // =========================================================================
    let attachedCount = 0;
    if (this.invoice_attachment) {
      try {
        const parsed = typeof this.invoice_attachment === 'string' 
          ? JSON.parse(this.invoice_attachment) 
          : this.invoice_attachment;
        if (Array.isArray(parsed)) {
          attachedCount = parsed.length;
        } else if (parsed && typeof parsed === 'object') {
          attachedCount = 1;
        }
      } catch (e) {
        if (typeof this.invoice_attachment === 'string' && this.invoice_attachment.trim().length > 5) {
          attachedCount = 1;
        }
      }
    }

    let invoicesCount = Number(
      dynamicAggregations.total_purchase_invoices_count ?? 
      masterData.total_purchase_invoices_count ?? 
      0
    );
    if (invoicesCount === 0 && attachedCount > 0) {
      invoicesCount = attachedCount;
    }

    let totalInvoiced = Number(
      dynamicAggregations.total_invoiced_amount ?? 
      masterData.total_invoiced_amount ?? 
      0
    );
    if (totalInvoiced === 0 && this.balance > 0) {
      totalInvoiced = this.balance;
    }

    const totalPaid = Number(
      dynamicAggregations.total_amount_paid ?? 
      masterData.total_amount_paid ?? 
      0
    );

    // حساب الرصيد المستحق ديناميكياً: (إجمالي المبلغ المفوتر - إجمالي المبلغ المدفوع)
    const outstanding = Math.round((totalInvoiced - totalPaid) * 100) / 100;

    // مؤشر صحة السداد والانتظام (Payment Health & Settlement Status)
    let settlementStatus = 'no_invoices';
    let settlementStatusLabel = 'لا توجد فواتير';
    if (invoicesCount > 0 || totalInvoiced > 0) {
      if (outstanding <= 0 && totalInvoiced > 0) {
        settlementStatus = 'fully_settled'; // مسدد بالكامل
        settlementStatusLabel = 'مسدد بالكامل';
      } else if (totalPaid > 0 && outstanding > 0) {
        settlementStatus = 'partially_settled'; // مسدد جزئياً
        settlementStatusLabel = 'مسدد جزئياً';
      } else {
        settlementStatus = 'pending_settlement'; // معلق بانتظار السداد
        settlementStatusLabel = 'معلق بانتظار السداد';
      }
    }

    const paymentRatio = totalInvoiced > 0
      ? Math.min(100, Math.round((totalPaid / totalInvoiced) * 1000) / 10)
      : (totalPaid > 0 ? 100 : 0);

    this.financial_summary = {
      total_purchase_invoices_count: invoicesCount,
      total_invoiced_amount: Math.round(totalInvoiced * 100) / 100,
      total_amount_paid: Math.round(totalPaid * 100) / 100,
      outstanding_balance: outstanding,
      currency: this.default_currency,
      settlement_status: settlementStatus,
      settlement_status_label: settlementStatusLabel,
      payment_coverage_ratio_pct: paymentRatio
    };

    // =========================================================================
    // 4. العمليات وسجلات النشاط المحملة مسبقاً (Eager-Loaded Collections)
    // =========================================================================
    if (eagerRelations.recent_invoices) {
      this.recent_invoices = eagerRelations.recent_invoices;
    }
    if (eagerRelations.recent_payments) {
      this.recent_payments = eagerRelations.recent_payments;
    }
    if (eagerRelations.active_orders) {
      this.active_orders = eagerRelations.active_orders;
    }
  }

  /**
   * إخفاء رقم الحساب المصرفي مع الإبقاء على آخر 4 أرقام
   * @param {string} acc 
   */
  _maskAccountNumber(acc) {
    if (!acc) return 'غير متوفر';
    const s = String(acc).trim();
    if (s.length <= 4) return s;
    return '•••• •••• ' + s.slice(-4);
  }

  /**
   * إخفاء رقم الآيبان مع إظهار كود الدولة وأول حرفين وآخر 4 خانات
   * @param {string} iban 
   */
  _maskIban(iban) {
    if (!iban) return 'غير متوفر';
    const s = String(iban).trim().replace(/\s/g, '');
    if (s.length <= 6) return s;
    return s.slice(0, 4) + ' •••• •••• •••• ' + s.slice(-4);
  }

  /**
   * تحويل الكائن إلى تمثيل JSON جاهز للواجهة
   */
  toJSON() {
    const obj = {
      id: this.id,
      company_name: this.company_name,
      industry_category: this.industry_category,
      contact_person: this.contact_person,
      phone_number: this.phone_number,
      email: this.email,
      address: this.address,
      default_currency: this.default_currency,
      supply_lead_time_days: this.supply_lead_time_days,
      payment_document_type: this.payment_document_type,
      status: this.status,
      tax_id: this.tax_id,
      commercial_reg_no: this.commercial_reg_no,
      credit_limit: this.credit_limit,
      balance: this.balance,
      opening_balance: this.opening_balance,
      invoice_attachment: this.invoice_attachment,
      notes: this.notes,
      created_at: this.created_at,
      updated_at: this.updated_at,
      bank_details: this.bank_details,
      financial_summary: this.financial_summary
    };

    if (this.recent_invoices) obj.recent_invoices = this.recent_invoices;
    if (this.recent_payments) obj.recent_payments = this.recent_payments;
    if (this.active_orders) obj.active_orders = this.active_orders;

    return obj;
  }
}

module.exports = VendorProfileDTO;
