/**
 * taxAndGuaranteeService.js
 * 
 * محرك الضرائب والخصم من المنبع والضمانات البنكية للمقاولات (Tax Engine & Bank Guarantees Suite)
 * مبني وفق:
 *  1. قانون ضرائب الدخل اليمني رقم 17 لسنة 2010 وتعديلاته (الخصم والإضافة تحت حساب الضريبة)
 *  2. استقطاعات المستخلصات المعتمدة (WHT & Retentions & Advance Amortization)
 *  3. الفاتورة الضريبية والرقم الضريبي للشركات والموردين والعملاء
 *  4. تقرير الإقرارات الضريبية الدورية لمصلحة الضرائب
 *  5. إدارة خطابات الضمان البنكية (L/G) وتتبع الغطاء النقدي (Cash Margin Collateral) والقيود المحاسبية
 */

const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('./auditService');
const { assertPeriodOpen, resolveValidUserId } = require('./financialControlService');

const TAX_GL_ACCOUNTS = {
  BANK_GL_ACCOUNT: 3,                 // 111 - الصندوق والبنك
  CLIENT_RECEIVABLES: 4,             // 112 - العملاء (الذمم المدينة)
  SUPPLIER_PAYABLES: 7,              // 211 - الموردون (الذمم الدائنة)
  RETENTION_RECEIVABLE: 16,          // 1125 - محتجزات ضمان لدى العملاء
  CUSTOMER_ADVANCES: 18,             // 2105 - دفعات مقدمة من العملاء
  CONTRACT_REVENUE: 20,              // 4101 - إيرادات عقود المقاولات المعترف بها
  CASH_MARGIN_GUARANTEES: 22,        // 1115 - غطاء خطابات ضمان لدى البنوك (أصل مقيد)
  WHT_RECEIVABLE_ASSET: 23,          // 1130 - ضرائب مخصومة من المنبع للشركة (رصيد ضريبي مدين)
  WHT_PAYABLE_LIABILITY: 24,         // 2130 - ضرائب مستحقة الدفع - مصلحة الضرائب (التزام دائن)
  GUARANTEE_COMMISSION_EXPENSE: 25   // 5205 - رسوم وعمولات خطابات الضمان البنكية
};

const LEGAL_DISCLAIMER = 'تنبيه مهني وقانوني: النسب والآليات المالية المضمنة في هذا النظام هي للاسترشاد ومبنية على التطبيق العملي الشائع لقانون ضرائب الدخل اليمني رقم 17 لسنة 2010 وتعديلاته، ويجب مراجعة وتحديث النسب دورياً بالتنسيق مع المحاسب القانوني المعتمد للشركة ومصلحة الضرائب.';

const TaxAndGuaranteeService = {
  TAX_GL_ACCOUNTS,
  LEGAL_DISCLAIMER,

  /**
   * جلب وتحديث نسب الضرائب والإعدادات
   */
  async getTaxConfigs() {
    const configs = await query('SELECT * FROM tax_configs WHERE is_active = 1');
    return {
      legal_disclaimer: LEGAL_DISCLAIMER,
      configs
    };
  },

  /**
   * احتساب ومعالجة ضرائب الخصم من المنبع في مستخلصات المقاولات (IPC Tax Handling)
   * يولد القيد المحاسبي المتزن شاملاً كافة الاستقطاعات التعاقدية والضريبية
   */
  async processBillTaxDeduction(billId, taxRate = 3.0, user = null, req = null) {
    const bill = await get('SELECT b.*, p.name as project_name FROM bills b JOIN projects p ON b.project_id = p.id WHERE b.id = ?', [billId]);
    if (!bill) throw new Error('المستخلص غير موجود في النظام');

    const grossAmount = Number(bill.gross_amount) || Number(bill.amount) || 0;
    const advanceDeduction = Number(bill.advance_deduction) || 0;
    const retentionDeduction = Number(bill.retention_deduction) || (grossAmount * 0.10);
    const parsedTaxRate = Number(taxRate) || 3.0; // 3% ضريبة أرباح تجارية ومقاولات حسب القانون اليمني

    // احتساب مبلغ ضريبة الخصم من المنبع من إجمالي الأعمال المنجزة
    const taxAmount = (grossAmount * parsedTaxRate) / 100;

    // صافي المستحق نقداً بعد كافة الاستقطاعات
    const netPayable = grossAmount - advanceDeduction - retentionDeduction - taxAmount;

    await assertPeriodOpen(bill.date);
    const userId = user ? await resolveValidUserId(user?.id) : null;

    return await transaction(async (tx) => {
      // 1. تحديث المستخلص
      await tx.run(`
        UPDATE bills
        SET tax_wht_rate = ?, tax_wht_amount = ?, net_amount = ?, deduction = ?
        WHERE id = ?
      `, [parsedTaxRate, taxAmount, netPayable, (advanceDeduction + retentionDeduction + taxAmount), billId]);

      // 2. توليد قيد اليومية المتزن الشامل لكافة أطراف المستخلص
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-TAX-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id,
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'مستخلص ضريبي', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, bill.date, `قيد إثبات مستخلص (${bill.bill_no}) لمشروع [${bill.project_name}] شاملاً ضريبة الخصم ${parsedTaxRate}%`,
        billId, grossAmount, grossAmount, userId, user?.username || 'المحاسب', userId, user?.username || 'المحاسب'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      // سطر مدين 1: ذمة العميل بالصافي القابل للتحصيل
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, 0, ?)
      `, [entryId, TAX_GL_ACCOUNTS.CLIENT_RECEIVABLES, bill.project_id, netPayable, `مدين: صافي مستحق من العميل لمستخلص ${bill.bill_no}`]);

      // سطر مدين 2: رصيد ضريبة الخصم من المنبع المسددة مقدماً (أصل ضريبي مدين للشركة)
      if (taxAmount > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?)
        `, [entryId, TAX_GL_ACCOUNTS.WHT_RECEIVABLE_ASSET, bill.project_id, taxAmount, `مدين: ضريبة مخصومة من المنبع (${parsedTaxRate}%) - قانون ضرائب الدخل اليمني`]);
      }

      // سطر مدين 3: محتجزات ضمان لدى العميل (أصل تعاقدي)
      if (retentionDeduction > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?)
        `, [entryId, TAX_GL_ACCOUNTS.RETENTION_RECEIVABLE, bill.project_id, retentionDeduction, `مدين: محتجز ضمان حسن تنفيذ لمستخلص ${bill.bill_no}`]);
      }

      // سطر مدين 4: استهلاك الدفعة المقدمة (تخفيض التزام تعاقدي)
      if (advanceDeduction > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?)
        `, [entryId, TAX_GL_ACCOUNTS.CUSTOMER_ADVANCES, bill.project_id, advanceDeduction, `مدين: استهلاك دفعة مقدمة تعاقدية لمستخلص ${bill.bill_no}`]);
      }

      // سطر دائن وحيد: إجمالي إيرادات أعمال المشروع المعتمدة
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?, ?)
      `, [entryId, TAX_GL_ACCOUNTS.CONTRACT_REVENUE, bill.project_id, grossAmount, `دائن: إيراد عقود المقاولات المعتمد لمستخلص ${bill.bill_no}`]);

      // 3. ربط القيد بالمستخلص
      await tx.run('UPDATE bills SET journal_entry_id = ? WHERE id = ?', [entryId, billId]);

      // 4. تسجيل شهادة الخصم في جدول الضرائب (tax_withholdings)
      const whtCount = await tx.get('SELECT COUNT(*) as cnt FROM tax_withholdings');
      const withholding_no = `WHT-REC-${new Date().getFullYear()}-${String(((whtCount ? whtCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;
      const taxPeriod = bill.date.substring(0, 7); // YYYY-MM

      await tx.run(`
        INSERT INTO tax_withholdings (
          withholding_no, type, project_id, client_id, source_doc_type, source_doc_id,
          base_amount, tax_rate, tax_amount, tax_period, date, journal_entry_id, status
        ) VALUES (?, 'deducted_from_client', ?, ?, 'bill', ?, ?, ?, ?, ?, ?, ?, 'pending')
      `, [
        withholding_no, bill.project_id, bill.client_id, billId,
        grossAmount, parsedTaxRate, taxAmount, taxPeriod, bill.date, entryId
      ]);

      if (req) {
        await logAudit(req, {
          action: 'PROCESS_BILL_TAX',
          entity_type: 'bill_tax',
          entity_id: bill.bill_no,
          details: { billId, grossAmount, taxAmount, netPayable, entry_no, withholding_no }
        });
      }

      return {
        bill_no: bill.bill_no,
        gross_amount: grossAmount,
        advance_deduction: advanceDeduction,
        retention_deduction: retentionDeduction,
        tax_wht_rate: parsedTaxRate,
        tax_wht_amount: taxAmount,
        net_amount: netPayable,
        journal_entry_no: entry_no,
        withholding_no
      };
    });
  },

  /**
   * تقرير الإقرارات الضريبية الدورية لمصلحة الضرائب
   */
  async getTaxDeclarationReport(taxPeriod) {
    const periodFilter = taxPeriod || new Date().toISOString().substring(0, 7);

    // 1. الضرائب المخصومة على الشركة من قبل العملاء (أرصدة ضريبية مدينة قابلة للتسوية)
    const clientWithholdings = await query(`
      SELECT tw.*, p.name as project_name, c.name as client_name, c.tax_number as client_tax_number
      FROM tax_withholdings tw
      LEFT JOIN projects p ON tw.project_id = p.id
      LEFT JOIN clients c ON tw.client_id = c.id
      WHERE tw.type = 'deducted_from_client' AND tw.tax_period = ?
      ORDER BY tw.date ASC
    `, [periodFilter]);

    // 2. الضرائب المخصومة من الشركة على الموردين والمقاولين الباطن (التزامات واجبة التوريد للمصلحة)
    const supplierWithholdings = await query(`
      SELECT tw.*, s.name as supplier_name, s.tax_number as supplier_tax_number
      FROM tax_withholdings tw
      LEFT JOIN suppliers s ON tw.supplier_id = s.id
      WHERE tw.type = 'withheld_from_supplier' AND tw.tax_period = ?
      ORDER BY tw.date ASC
    `, [periodFilter]);

    const totalClientWht = clientWithholdings.reduce((sum, r) => sum + Number(r.tax_amount || 0), 0);
    const totalSupplierWht = supplierWithholdings.reduce((sum, r) => sum + Number(r.tax_amount || 0), 0);

    return {
      tax_period: periodFilter,
      legal_disclaimer: LEGAL_DISCLAIMER,
      summary: {
        total_wht_deducted_by_clients: totalClientWht, // ضريبة مقاولات مسددة مقدماً
        total_wht_withheld_from_suppliers: totalSupplierWht, // ضريبة توريدات واجبة السداد
        net_tax_position: totalSupplierWht - totalClientWht
      },
      client_withholdings: clientWithholdings,
      supplier_withholdings: supplierWithholdings
    };
  },

  /**
   * إصدار وإدارة خطاب ضمان بنكي للمشروع (Bank Guarantee - L/G)
   * يولد القيد المحاسبي المتزن للغطاء النقدي والعمولات المصرفية
   */
  async issueBankGuarantee(data, req = null) {
    const {
      guarantee_no,
      type = 'performance_bond', // 'bid_bond', 'performance_bond', 'advance_payment', 'maintenance_bond'
      project_id,
      client_id,
      issuing_bank,
      bank_account_id = 1,
      amount,
      currency = 'ر.ي',
      cash_margin_pct = 10, // نسبة الغطاء النقدي المحتجز لدى البنك (افتراضياً 10%)
      commission_fee = 0,
      issue_date = new Date().toISOString().split('T')[0],
      expiry_date,
      notes,
      user
    } = data;

    if (!guarantee_no || !project_id || !issuing_bank || !amount || Number(amount) <= 0) {
      throw new Error('يرجى تحديد رقم الضمان، المشروع، البنك المصدر، ومبلغ الضمان');
    }

    await assertPeriodOpen(issue_date);
    const userId = await resolveValidUserId(user?.id);
    const totalGuaranteeAmount = Number(amount);
    const marginPct = Number(cash_margin_pct) || 10;
    const cashMarginAmount = (totalGuaranteeAmount * marginPct) / 100;
    const parsedCommission = Number(commission_fee) || 0;
    const totalBankDeduction = cashMarginAmount + parsedCommission;

    return await transaction(async (tx) => {
      // 1. توليد قيد اليومية للغطاء النقدي والعمولات:
      // من مذكورين:
      //  حـ/ غطاء خطابات ضمان (أصل متداول مقيد 1115) بمبلغ الغطاء
      //  حـ/ رسوم وعمولات خطابات الضمان (مصروف 5205) بمبلغ العمولة
      // إلى حـ/ البنك الجاري (3) بإجمالي المسحوب
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-LG-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, total_debit, total_credit,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'خطاب ضمان بنكي', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, issue_date, `إثبات غطاء خطاب ضمان بنكي (${guarantee_no}) لدى ${issuing_bank}`,
        totalBankDeduction, totalBankDeduction, userId, user?.username || 'المحاسب', userId, user?.username || 'المحاسب'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      // سطر مدين 1: غطاء خطابات الضمان (نقد مقيد)
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, 0, ?)
      `, [entryId, TAX_GL_ACCOUNTS.CASH_MARGIN_GUARANTEES, project_id, cashMarginAmount, `مدين: غطاء نقدي بنسبة ${marginPct}% لخطاب الضمان ${guarantee_no}`]);

      // سطر مدين 2: عمولة إصدار الضمان البنكية
      if (parsedCommission > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?)
        `, [entryId, TAX_GL_ACCOUNTS.GUARANTEE_COMMISSION_EXPENSE, project_id, parsedCommission, `مدين: عمولة ومصاريف إصدار خطاب الضمان ${guarantee_no}`]);
      }

      // سطر دائن: خصم من رصيد البنك الجاري
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, 0, ?, ?)
      `, [entryId, TAX_GL_ACCOUNTS.BANK_GL_ACCOUNT, totalBankDeduction, `دائن: خصم الغطاء والعمولة لخطاب الضمان ${guarantee_no}`]);

      // 2. تحديث رصيد الحساب البنكي
      await tx.run('UPDATE bank_accounts SET current_balance = current_balance - ? WHERE id = ?', [totalBankDeduction, bank_account_id]);

      // 3. تسجيل خطاب الضمان
      const lgRes = await tx.run(`
        INSERT INTO bank_guarantees (
          guarantee_no, type, project_id, client_id, issuing_bank, bank_account_id,
          amount, currency, cash_margin_pct, cash_margin_amount, commission_fee,
          issue_date, expiry_date, status, journal_entry_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `, [
        guarantee_no, type, project_id, client_id || null, issuing_bank, bank_account_id,
        totalGuaranteeAmount, currency, marginPct, cashMarginAmount, parsedCommission,
        issue_date, expiry_date || issue_date, entryId, notes || ''
      ]);

      if (req) {
        await logAudit(req, {
          action: 'ISSUE_BANK_GUARANTEE',
          entity_type: 'bank_guarantee',
          entity_id: guarantee_no,
          details: { guarantee_no, type, amount: totalGuaranteeAmount, cashMarginAmount, entry_no }
        });
      }

      return {
        id: lgRes.lastInsertRowid || lgRes.insertId,
        guarantee_no,
        type,
        amount: totalGuaranteeAmount,
        cash_margin_amount: cashMarginAmount,
        commission_fee: parsedCommission,
        journal_entry_no: entry_no,
        status: 'active'
      };
    });
  },

  /**
   * الإفراج عن خطاب الضمان واسترداد الغطاء النقدي (Release Bank Guarantee)
   */
  async releaseBankGuarantee(guaranteeId, releaseData = {}, req = null) {
    const { release_date = new Date().toISOString().split('T')[0], user } = releaseData;

    const lg = await get('SELECT * FROM bank_guarantees WHERE id = ?', [guaranteeId]);
    if (!lg) throw new Error('خطاب الضمان غير موجود');
    if (lg.status === 'released') throw new Error('تم الإفراج عن هذا الضمان مسبقاً');

    await assertPeriodOpen(release_date);
    const userId = user ? await resolveValidUserId(user?.id) : null;
    const marginToRefund = Number(lg.cash_margin_amount) || 0;

    return await transaction(async (tx) => {
      // 1. توليد قيد استرداد الغطاء النقدي:
      // من حـ/ البنك الجاري (3) إلى حـ/ غطاء خطابات الضمان (1115)
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-REL-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, total_debit, total_credit,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'استرداد غطاء ضمان', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, release_date, `استرداد الغطاء النقدي لخطاب الضمان المفرج عنه (${lg.guarantee_no})`,
        marginToRefund, marginToRefund, userId, user?.username || 'المحاسب', userId, user?.username || 'المحاسب'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      // سطر مدين: إعادة إيداع الغطاء في البنك الجاري
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?)
      `, [entryId, TAX_GL_ACCOUNTS.BANK_GL_ACCOUNT, marginToRefund, `مدين: استرداد غطاء خطاب الضمان ${lg.guarantee_no}`]);

      // سطر دائن: إقفال حساب غطاء خطابات الضمان
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?, ?)
      `, [entryId, TAX_GL_ACCOUNTS.CASH_MARGIN_GUARANTEES, lg.project_id, marginToRefund, `دائن: إقفال الغطاء المسترد لخطاب الضمان ${lg.guarantee_no}`]);

      // 2. إعادة الغطاء لرصيد الحساب البنكي
      if (lg.bank_account_id) {
        await tx.run('UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?', [marginToRefund, lg.bank_account_id]);
      }

      // 3. تحديث حالة خطاب الضمان
      await tx.run(`
        UPDATE bank_guarantees
        SET status = 'released', release_date = ?, release_journal_entry_id = ?
        WHERE id = ?
      `, [release_date, entryId, guaranteeId]);

      if (req) {
        await logAudit(req, {
          action: 'RELEASE_BANK_GUARANTEE',
          entity_type: 'bank_guarantee',
          entity_id: lg.guarantee_no,
          details: { guaranteeId, guarantee_no: lg.guarantee_no, marginToRefund, entry_no }
        });
      }

      return {
        id: guaranteeId,
        guarantee_no: lg.guarantee_no,
        refunded_margin: marginToRefund,
        journal_entry_no: entry_no,
        status: 'released',
        message: 'تم الإفراج عن خطاب الضمان واسترداد الغطاء النقدي وترحيل القيد بنجاح'
      };
    });
  }
};

module.exports = TaxAndGuaranteeService;
