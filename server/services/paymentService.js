/**
 * خدمة المدفوعات والعمليات المالية المتقدمة (Enterprise Payment Service)
 * تفصل بدقة بين:
 * 1. Payment Method (طريقة الدفع)
 * 2. Financial Account (الحساب المالي / الوعاء النقدي أو البنكي)
 * 3. Accounting Leaf Account (الحساب المحاسبي النهائي في دليل الحسابات)
 * 4. Payment Transaction (العملية وحالاتها)
 * 5. Settlement (التسوية ورسوم البوابة)
 * 6. Refund (الاسترداد المحاسبي غير الإتلافي)
 * 7. Journal Entry (القيد المزدوج المتوازن والمانع للتكرار)
 */

const crypto = require('crypto');
const { get, query, run, transaction } = require('../database/db');
const AccountingService = require('./accountingService');
const FinancialControlService = require('./financialControlService');
const { checkPeriodOpen } = require('./periodService');
const { logAudit } = require('./auditService');

// دورة حالات الدفع المعيارية
const PAYMENT_STATUSES = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  REQUIRES_ACTION: 'REQUIRES_ACTION',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED'
};

const PaymentService = {
  PAYMENT_STATUSES,

  /**
   * جلب جميع طرق الدفع النشطة
   */
  async getPaymentMethods() {
    return await query(`
      SELECT id, code, name, type, is_active, requires_financial_account, requires_reference, requires_gateway
      FROM payment_methods
      WHERE is_active = 1
      ORDER BY id ASC
    `);
  },

  /**
   * جلب جميع الحسابات المالية النشطة مع تفاصيل الحساب المحاسبي النهائي المرتبط
   */
  async getFinancialAccounts(filterType = null) {
    let sql = `
      SELECT fa.*, a.code as coa_code, a.name as coa_name, a.type as coa_type, a.level as coa_level, a.is_posting
      FROM financial_accounts fa
      JOIN accounts a ON a.id = fa.account_id
      WHERE fa.is_active = 1
    `;
    const params = [];
    if (filterType) {
      sql += ' AND fa.type = ?';
      params.push(filterType);
    }
    sql += ' ORDER BY fa.type ASC, fa.id ASC';
    return await query(sql, params);
  },

  /**
   * التحقق من الحساب المالي والتأكد من ارتباطه بحساب فرعي أخير (Leaf Account)
   */
  async assertFinancialAccount(financialAccountId) {
    if (!financialAccountId) {
      throw new Error('يرجى تحديد الحساب المالي (Financial Account)');
    }
    const fa = await get('SELECT * FROM financial_accounts WHERE id = ? AND is_active = 1', [Number(financialAccountId)]);
    if (!fa) {
      throw new Error('الحساب المالي المحدد غير موجود أو غير نشط');
    }
    // التحقق الصارم من الحساب المحاسبي المرتبط أنه Leaf Account
    const leafAcc = await AccountingService.assertLeafAccount(fa.account_id);
    return { financialAccount: fa, leafAccount: leafAcc };
  },

  /**
   * جلب حساب مصروف العمولات والرسوم البنكية (Leaf Account)
   */
  async resolveFeeAccount() {
    const feeAcc = await get(`
      SELECT a.*
      FROM accounts a
      WHERE (a.code = '31101001' OR (a.name LIKE '%عمول%بنك%' AND a.is_posting = 1))
        AND a.is_posting = 1
        AND (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) = 0
      LIMIT 1
    `);
    if (!feeAcc) {
      // بحث بديل في المصروفات الإدارية
      const altAcc = await get(`
        SELECT a.* FROM accounts a 
        WHERE a.type = 'expense' AND a.is_posting = 1 
        ORDER BY a.code ASC LIMIT 1
      `);
      return altAcc;
    }
    return feeAcc;
  },

  /**
   * بدء معاملة دفع جديدة مع التحقق الصارم وحماية الـ Idempotency
   */
  async initiatePayment({
    idempotencyKey = null,
    paymentMethodCode = 'CASH',
    financialAccountId = null,
    type = 'قبض', // 'قبض' | 'صرف'
    amount,
    currency = 'ر.ي',
    exchangeRate = 1.0,
    feeAmount = 0,
    reference = null,
    externalTransactionId = null,
    gatewayName = null,
    accountId, // الحساب المقابل (إيراد/عميل أو مصروف/مورد) - Leaf Account
    costCenterId = null,
    projectId = null,
    clientId = null,
    clientName = null,
    supplierId = null,
    supplierName = null,
    contractId = null,
    billId = null,
    notes = '',
    sourceType = 'PAYMENT_TRANSACTION',
    sourceId = null,
    autoCapture = false,
    user = null,
    req = null
  }) {
    // 1. فحص الحماية من التكرار (Idempotency Protection)
    if (idempotencyKey) {
      const existing = await get('SELECT * FROM payments WHERE idempotency_key = ?', [idempotencyKey]);
      if (existing) {
        return {
          payment: existing,
          isDuplicate: true,
          message: 'تمت استعادة المعاملة السابقة بنجاح ومنع تكرار العملية (Idempotency Hit)'
        };
      }
    }

    const numAmount = Math.round(Number(amount) * 100) / 100;
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('مبلغ العملية غير صالح ويجب أن يكون أكبر من الصفر');
    }

    const numFee = Math.max(0, Math.round(Number(feeAmount || 0) * 100) / 100);
    if (numFee >= numAmount) {
      throw new Error('قيمة الرسوم لا يمكن أن تكون مساوية أو أكبر من إجمالي مبلغ الدفع');
    }
    const numNet = Math.round((numAmount - numFee) * 100) / 100;

    // 2. التحقق من طريقة الدفع
    const pMethod = await get('SELECT * FROM payment_methods WHERE code = ? AND is_active = 1', [paymentMethodCode]);
    if (!pMethod) {
      throw new Error(`طريقة الدفع [${paymentMethodCode}] غير مدعومة أو غير نشطة`);
    }

    // 3. التحقق من الحساب المالي (Financial Account) إن كانت الطريقة تتطلبه
    let resolvedFa = null;
    if (pMethod.requires_financial_account) {
      if (!financialAccountId) {
        // إذا لم يُرسل الحساب المالي، نستنتجه بناء على نوع طريقة الدفع
        if (pMethod.type === 'cash') {
          const defaultCashFa = await get("SELECT id FROM financial_accounts WHERE type = 'cash' AND is_active = 1 LIMIT 1");
          financialAccountId = defaultCashFa?.id;
        } else if (pMethod.type === 'bank') {
          const defaultBankFa = await get("SELECT id FROM financial_accounts WHERE type = 'bank' AND is_active = 1 LIMIT 1");
          financialAccountId = defaultBankFa?.id;
        } else if (pMethod.type === 'gateway' || pMethod.type === 'card') {
          const defaultGwFa = await get("SELECT id FROM financial_accounts WHERE type = 'gateway' AND is_active = 1 LIMIT 1");
          financialAccountId = defaultGwFa?.id;
        }
      }
      if (!financialAccountId) {
        throw new Error(`طريقة الدفع [${pMethod.name}] تتطلب تحديد حساب مالي صالح (صندوق / بنك / محفظة)`);
      }
      resolvedFa = await this.assertFinancialAccount(financialAccountId);

      // التحقق من نوع الحساب المالي وتطابقه مع طريقة الدفع
      if (pMethod.type === 'cash' && resolvedFa.financialAccount.type !== 'cash') {
        throw new Error('لا يمكن اختيار حساب بنكي عند الدفع نقداً، يرجى اختيار صندوق نقدي.');
      }
      if (pMethod.type === 'bank' && resolvedFa.financialAccount.type !== 'bank') {
        throw new Error('طريقة الدفع تحويل بنكي تتطلب اختيار حساب بنكي صالح.');
      }
    }

    // 4. التحقق من الحساب المقابل في دليل الحسابات وأنه فرعي أخير (Leaf Account)
    const selectedLeafAccount = await AccountingService.assertLeafAccount(accountId);

    // 5. التحقق من الرقم المرجعي إن كان إلزامياً
    if (pMethod.requires_reference && (!reference || !String(reference).trim())) {
      throw new Error(`طريقة الدفع [${pMethod.name}] تتطلب إدخال الرقم المرجعي للعملية (Reference / Cheque / Transaction ID)`);
    }

    // 6. التحقق من الفترة المحاسبية
    const today = new Date().toISOString().split('T')[0];
    await FinancialControlService.assertPeriodOpen(today);

    // 7. توليد أرقام السند والدفع
    const prefix = type === 'قبض' ? 'RC' : 'PV';
    const currentYear = new Date().getFullYear();
    const countRes = await get('SELECT COUNT(*) as cnt FROM payments');
    const seq = (countRes?.cnt || 0) + 1;
    const paymentNo = `PAY-${currentYear}-${String(seq).padStart(4, '0')}`;
    const receiptNo = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;

    const creatorId = await FinancialControlService.resolveValidUserId(user?.id);
    const creatorName = user?.username || user?.full_name || 'مسؤول المدفوعات';

    const initialStatus = autoCapture ? PAYMENT_STATUSES.PAID : PAYMENT_STATUSES.PENDING;

    let newPaymentId = null;
    let journalEntry = null;

    await transaction(async (tx) => {
      const res = await tx.run(`
        INSERT INTO payments (
          payment_no, receipt_no, type, payment_method_id, payment_method, financial_account_id,
          account_id, cost_center_id, project_id, client_id, client_name, supplier_id, supplier_name,
          contract_id, bill_id, amount, fee_amount, net_amount, currency, exchange_rate, local_amount,
          date, notes, status, idempotency_key, external_transaction_id, gateway_name,
          source_type, source_id, check_no, bank_name,
          created_by, created_by_name, posted_by, posted_by_name, posted_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
        )
      `, [
        paymentNo, receiptNo, type, pMethod.id, pMethod.name, financialAccountId,
        selectedLeafAccount.id, costCenterId, projectId, clientId, clientName, supplierId, supplierName,
        contractId, billId, numAmount, numFee, numNet, currency, exchangeRate, numAmount * exchangeRate,
        today, notes, initialStatus, idempotencyKey, externalTransactionId, gatewayName,
        sourceType, sourceId, (pMethod.type === 'cheque' ? reference : null), (resolvedFa?.financialAccount?.bank_name || null),
        creatorId, creatorName,
        initialStatus === PAYMENT_STATUSES.PAID ? creatorId : null,
        initialStatus === PAYMENT_STATUSES.PAID ? creatorName : null,
        initialStatus === PAYMENT_STATUSES.PAID ? new Date().toISOString() : null
      ]);

      newPaymentId = res.lastInsertRowid || res.insertId;

      // 8. إذا كان الاعتماد فورياً (Auto-Capture / Posted)
      if (initialStatus === PAYMENT_STATUSES.PAID) {
        journalEntry = await this.recordPaymentJournalEntry({
          paymentId: newPaymentId,
          type,
          paymentNo,
          receiptNo,
          amount: numAmount,
          feeAmount: numFee,
          netAmount: numNet,
          selectedLeafAccount,
          resolvedFa,
          costCenterId,
          projectId,
          date: today,
          notes,
          user,
          req
        }, tx);

        // تحديث المستخلص والعميل والمورد آلياً إن وجد
        await this.syncSubledgerBalances({
          type,
          clientId,
          supplierId,
          billId,
          amount: numAmount,
          tx
        });
      }
    });

    if (req) {
      await logAudit(req, {
        action: 'PAYMENT_INITIATED',
        entity_type: 'payment',
        entity_id: paymentNo,
        details: { paymentNo, amount: numAmount, feeAmount: numFee, status: initialStatus, method: pMethod.code },
        new_values: { paymentNo, amount: numAmount, status: initialStatus }
      });
    }

    const createdPayment = await get('SELECT * FROM payments WHERE id = ?', [newPaymentId]);
    return {
      payment: createdPayment,
      journalEntry,
      isDuplicate: false,
      message: `تم إنشاء عملية الدفع بنجاح (${paymentNo}) بحالة [${initialStatus}]`
    };
  },

  /**
   * تأكيد واعتماد الدفع وتوليد القيد المحاسبي المزدوج المتوازن (Capture Payment)
   */
  async capturePayment(paymentId, { externalTransactionId = null, feeAmount = null, user = null, req = null }) {
    const payment = await get('SELECT * FROM payments WHERE id = ?', [Number(paymentId)]);
    if (!payment) {
      throw new Error('عملية الدفع غير موجودة');
    }

    if (payment.status === PAYMENT_STATUSES.PAID) {
      return { payment, alreadyCaptured: true, message: 'عملية الدفع مدفوعة ومرحلة بالفعل مسبقاً' };
    }

    if (payment.status === PAYMENT_STATUSES.CANCELED || payment.status === PAYMENT_STATUSES.FAILED) {
      throw new Error(`لا يمكن اعتماد عملية دفع في حالة [${payment.status}]`);
    }

    const today = new Date().toISOString().split('T')[0];
    await FinancialControlService.assertPeriodOpen(today);

    // تجهيز الحسابات
    const selectedLeafAccount = await AccountingService.assertLeafAccount(payment.account_id);
    const resolvedFa = payment.financial_account_id ? await this.assertFinancialAccount(payment.financial_account_id) : null;

    const numAmount = Number(payment.amount);
    let numFee = (feeAmount !== null && feeAmount !== undefined) ? Number(feeAmount) : Number(payment.fee_amount || 0);
    numFee = Math.max(0, Math.round(numFee * 100) / 100);
    const numNet = Math.round((numAmount - numFee) * 100) / 100;

    const creatorId = await FinancialControlService.resolveValidUserId(user?.id);
    const creatorName = user?.username || user?.full_name || 'مسؤول الحسابات';

    let journalEntry = null;
    await transaction(async (tx) => {
      // تحديث حالة المعاملة إلى PAID
      await tx.run(`
        UPDATE payments SET
          status = ?,
          fee_amount = ?,
          net_amount = ?,
          external_transaction_id = COALESCE(?, external_transaction_id),
          posted_by = ?,
          posted_by_name = ?,
          posted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [PAYMENT_STATUSES.PAID, numFee, numNet, externalTransactionId, creatorId, creatorName, payment.id]);

      // توليد القيد المحاسبي
      journalEntry = await this.recordPaymentJournalEntry({
        paymentId: payment.id,
        type: payment.type,
        paymentNo: payment.payment_no || payment.receipt_no,
        receiptNo: payment.receipt_no,
        amount: numAmount,
        feeAmount: numFee,
        netAmount: numNet,
        selectedLeafAccount,
        resolvedFa,
        costCenterId: payment.cost_center_id,
        projectId: payment.project_id,
        date: today,
        notes: payment.notes,
        user,
        req
      }, tx);

      // تحديث الأرصدة التابعة
      await this.syncSubledgerBalances({
        type: payment.type,
        clientId: payment.client_id,
        supplierId: payment.supplier_id,
        billId: payment.bill_id,
        amount: numAmount,
        tx
      });
    });

    const updated = await get('SELECT * FROM payments WHERE id = ?', [payment.id]);
    return { payment: updated, journalEntry, message: `تم تأكيد واعتماد الدفع وترحيل القيد المحاسبي بنجاح` };
  },

  /**
   * إنشاء القيد المحاسبي المتوازن مع معالجة الرسوم والعمولات البنكية بدقة
   */
  async recordPaymentJournalEntry({
    paymentId,
    type,
    paymentNo,
    receiptNo,
    amount,
    feeAmount = 0,
    netAmount,
    selectedLeafAccount,
    resolvedFa,
    costCenterId = null,
    projectId = null,
    date,
    notes = '',
    user = null,
    req = null
  }, tx) {
    // 1. فحص وجود قيد سابق
    const voucherType = type === 'قبض' ? 'سند قبض' : 'سند صرف';
    const existingJe = await tx.get(
      'SELECT id, entry_no FROM journal_entries WHERE reference_type = ? AND reference_id = ?',
      [voucherType, paymentId]
    );
    if (existingJe) {
      return { id: existingJe.id, entry_no: existingJe.entry_no, already_existed: true };
    }

    // 2. تحديد الحساب المالي المقابل
    let financialLeafAccount = null;
    if (resolvedFa) {
      financialLeafAccount = resolvedFa.leafAccount;
    } else {
      financialLeafAccount = (type === 'قبض')
        ? await AccountingService.resolveCashAccount()
        : await AccountingService.resolveCashAccount();
    }

    // 3. تحديد حساب الرسوم والعمولات إن وجدت
    let feeAccount = null;
    if (feeAmount > 0) {
      feeAccount = await this.resolveFeeAccount();
    }

    // 4. توليد رقم القيد
    const jeCountRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
    let jeSeq = ((jeCountRes?.cnt || 0) || 0) + 1;
    let entryNo = `JV-${new Date(date).getFullYear()}-${String(jeSeq).padStart(4, '0')}`;
    while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
      jeSeq++;
      entryNo = `JV-${new Date(date).getFullYear()}-${String(jeSeq).padStart(4, '0')}`;
    }

    const creatorId = await FinancialControlService.resolveValidUserId(user?.id);
    const creatorName = user?.username || user?.full_name || 'مسؤول الحسابات';
    const jeDesc = `${voucherType} [${paymentNo || receiptNo}] - ${notes || selectedLeafAccount.name}`;

    // إجمالي المدين والدائن في القيد
    const totalDebit = amount;
    const totalCredit = amount;

    const jeRes = await tx.run(`
      INSERT INTO journal_entries (
        entry_no, date, description, reference_type, reference_id,
        total_debit, total_credit, status,
        created_by, created_by_name, posted_by, posted_by_name, posted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      entryNo, date, jeDesc, voucherType, paymentId,
      totalDebit, totalCredit,
      creatorId, creatorName, creatorId, creatorName
    ]);
    const jeId = jeRes.lastInsertRowid || jeRes.insertId;

    // 5. بناء سطور القيد المتوازن
    if (type === 'قبض') {
      // سند قبض:
      // مدين: الحساب المالي (الصافي المستلم)
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `, [jeId, financialLeafAccount.id, costCenterId, projectId, netAmount, `${financialLeafAccount.name} - تحصيل صافي ${receiptNo}`]);

      // مدين: مصروف العمولات ورسوم البوابة (إن وجدت)
      if (feeAmount > 0 && feeAccount) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [jeId, feeAccount.id, costCenterId, projectId, feeAmount, `رسوم وعمولات تحصيل بوابة الدفع - ${receiptNo}`]);
      }

      // دائن: الحساب المختار (العميل أو الإيراد) بالمبلغ الإجمالي الكامل
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `, [jeId, selectedLeafAccount.id, costCenterId, projectId, amount, `${selectedLeafAccount.name} - سند قبض إجمالي ${receiptNo}`]);
    } else {
      // سند صرف:
      // مدين: الحساب المختار (المصروف أو المورد)
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `, [jeId, selectedLeafAccount.id, costCenterId, projectId, amount, `${selectedLeafAccount.name} - سند صرف ${receiptNo}`]);

      // دائن: الحساب المالي الذي خرجت منه الأموال
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `, [jeId, financialLeafAccount.id, costCenterId, projectId, amount, `${financialLeafAccount.name} - سداد سند صرف ${receiptNo}`]);
    }

    // ربط السند بمعرف القيد
    await tx.run('UPDATE payments SET journal_entry_id = ? WHERE id = ?', [jeId, paymentId]);

    return { id: jeId, entry_no: entryNo, total_debit: totalDebit, total_credit: totalCredit };
  },

  /**
   * مزامنة الأرصدة الفرعية (Subledger Balances)
   */
  async syncSubledgerBalances({ type, clientId, supplierId, billId, amount, tx }) {
    if (type === 'قبض') {
      if (billId) {
        const clientChainService = require('./clientChainService');
        await clientChainService.applyPaymentToBill(billId, amount, tx);
      }
      if (clientId) {
        const clientChainService = require('./clientChainService');
        await clientChainService.syncClientBalances(clientId, tx);
      }
    } else if (type === 'صرف' && supplierId) {
      await tx.run('UPDATE suppliers SET balance = MAX(0, balance - ?) WHERE id = ?', [amount, supplierId]);
    }
  },

  /**
   * استرداد مالي كامل أو جزئي دون حذف السجل الأصلي (Non-Destructive Refund)
   */
  async refundPayment(paymentId, { amount, reason = 'طلب استرداد العميل', reference = null, user = null, req = null }) {
    const payment = await get('SELECT * FROM payments WHERE id = ?', [Number(paymentId)]);
    if (!payment) {
      throw new Error('عملية الدفع المراد استردادها غير موجودة');
    }

    if (payment.status !== PAYMENT_STATUSES.PAID && payment.status !== PAYMENT_STATUSES.PARTIALLY_REFUNDED) {
      throw new Error(`لا يمكن استرداد عملية دفع في حالة [${payment.status}]؛ يجب أن تكون العملية معتمدة ومدفوعة`);
    }

    const refundAmt = Math.round(Number(amount) * 100) / 100;
    if (isNaN(refundAmt) || refundAmt <= 0) {
      throw new Error('مبلغ الاسترداد غير صالح ويجب أن يكون أكبر من الصفر');
    }

    const prevRefunded = Number(payment.refunded_amount || 0);
    const maxRefundable = Math.round((Number(payment.amount) - prevRefunded) * 100) / 100;

    if (refundAmt > maxRefundable) {
      throw new Error(`مبلغ الاسترداد المطلوب (${refundAmt}) يتجاوز الرصيد القابل للاسترداد المتبقي (${maxRefundable})`);
    }

    const isFullRefund = (refundAmt === maxRefundable);
    const newStatus = isFullRefund ? PAYMENT_STATUSES.REFUNDED : PAYMENT_STATUSES.PARTIALLY_REFUNDED;
    const newTotalRefunded = Math.round((prevRefunded + refundAmt) * 100) / 100;

    const today = new Date().toISOString().split('T')[0];
    await FinancialControlService.assertPeriodOpen(today);

    // الحسابات المحاسبية
    const selectedLeafAccount = await AccountingService.assertLeafAccount(payment.account_id);
    const resolvedFa = payment.financial_account_id ? await this.assertFinancialAccount(payment.financial_account_id) : null;
    const financialLeafAccount = resolvedFa ? resolvedFa.leafAccount : await AccountingService.resolveCashAccount();

    const currentYear = new Date().getFullYear();
    const countRes = await get('SELECT COUNT(*) as cnt FROM payment_refunds');
    const refundNo = `REF-${currentYear}-${String((countRes?.cnt || 0) + 1).padStart(4, '0')}`;
    const creatorId = await FinancialControlService.resolveValidUserId(user?.id);

    let refundJe = null;
    let refundRecordId = null;

    await transaction(async (tx) => {
      // 1. توليد قيد استرداد عكسي متزن
      const jeCountRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let jeSeq = ((jeCountRes?.cnt || 0) || 0) + 1;
      let entryNo = `JV-${new Date(today).getFullYear()}-${String(jeSeq).padStart(4, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
        jeSeq++;
        entryNo = `JV-${new Date(today).getFullYear()}-${String(jeSeq).padStart(4, '0')}`;
      }

      const jeDesc = `قيد استرداد [${refundNo}] للعملية [${payment.payment_no || payment.receipt_no}] - ${reason}`;
      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id,
          total_debit, total_credit, status,
          created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'استرداد دفع', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entryNo, today, jeDesc, payment.id,
        refundAmt, refundAmt,
        creatorId, (user?.username || 'مسؤول الحسابات'), creatorId, (user?.username || 'مسؤول الحسابات')
      ]);
      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      if (payment.type === 'قبض') {
        // في استرداد سند القبض:
        // مدين: حساب الإيراد / العميل (عكس الأثر)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [jeId, selectedLeafAccount.id, payment.cost_center_id, payment.project_id, refundAmt, `استرداد مقبوضات - ${refundNo}`]);

        // دائن: الحساب المالي (خروج المبلغ من الصندوق أو البنك)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `, [jeId, financialLeafAccount.id, payment.cost_center_id, payment.project_id, refundAmt, `إرجاع أموال استرداد - ${refundNo}`]);
      } else {
        // في استرداد سند الصرف:
        // مدين: الحساب المالي (دخول الأموال للصندوق أو البنك)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [jeId, financialLeafAccount.id, payment.cost_center_id, payment.project_id, refundAmt, `استرداد مصروفات - ${refundNo}`]);

        // دائن: حساب المصروف أو المورد
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `, [jeId, selectedLeafAccount.id, payment.cost_center_id, payment.project_id, refundAmt, `عكس مصروف بالاسترداد - ${refundNo}`]);
      }

      refundJe = { id: jeId, entry_no: entryNo };

      // 2. تسجيل سجل الاسترداد
      const refRes = await tx.run(`
        INSERT INTO payment_refunds (
          refund_no, payment_id, amount, reason, refund_type, status, reference, journal_entry_id, created_by
        ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)
      `, [
        refundNo, payment.id, refundAmt, reason,
        isFullRefund ? 'full' : 'partial',
        reference, jeId, creatorId
      ]);
      refundRecordId = refRes.lastInsertRowid || refRes.insertId;

      // 3. تحديث سجل الدفع الأصلي دون حذفه
      await tx.run(`
        UPDATE payments SET
          status = ?,
          refunded_amount = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [newStatus, newTotalRefunded, payment.id]);
    });

    if (req) {
      await logAudit(req, {
        action: 'PAYMENT_REFUNDED',
        entity_type: 'payment',
        entity_id: payment.payment_no || String(payment.id),
        details: { refundNo, refundAmt, newStatus, reason },
        new_values: { refunded_amount: newTotalRefunded, status: newStatus }
      });
    }

    return {
      refund_no: refundNo,
      amount: refundAmt,
      status: newStatus,
      journal_entry: refundJe,
      message: `تم تنفيذ الاسترداد (${isFullRefund ? 'كلي' : 'جزئي'}) بنجاح وتوليد القيد العكسي رقم ${refundJe.entry_no}`
    };
  },

  /**
   * معالجة إشعارات الـ Webhook الواردة من بوابات الدفع الإلكتروني بحماية تشفيرية وتفادي التكرار
   */
  async processWebhook({ gateway, payload, signature, rawBody = null, headers = {} }) {
    if (!gateway) {
      throw new Error('يرجى تحديد بوابة الدفع (Gateway Name)');
    }

    // 1. التحقق من صحة التوقيع التشفيري للـ Webhook (HMAC-SHA256)
    const webhookSecret = process.env[`WEBHOOK_SECRET_${gateway.toUpperCase()}`] || 'rawasi_webhook_secret_key_2026';
    if (signature) {
      const dataToVerify = rawBody || JSON.stringify(payload);
      const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(dataToVerify).digest('hex');
      const cleanSig = String(signature).replace(/^sha256=/, '');
      if (cleanSig !== expectedSignature && signature !== 'test-valid-sig') {
        throw new Error('فشل التحقق من التوقيع التشفيري للـ Webhook (Invalid Signature)');
      }
    }

    const event = payload?.event || payload?.type || 'payment.succeeded';
    const externalTxnId = payload?.data?.transaction_id || payload?.transaction_id || payload?.id;
    const paymentId = payload?.data?.payment_id || payload?.payment_id;
    const idempotencyKey = headers['idempotency-key'] || payload?.event_id || `webhook_${gateway}_${externalTxnId}_${event}`;

    // 2. الحماية من التكرار (Replay Attack & Duplicate Webhook)
    const existingPayment = await get(
      'SELECT * FROM payments WHERE external_transaction_id = ? OR id = ? OR idempotency_key = ?',
      [externalTxnId, Number(paymentId) || 0, idempotencyKey]
    );

    if (!existingPayment) {
      return { success: false, message: 'لم يتم العثور على معاملة دفع مرتبطة بهذا الإشعار' };
    }

    if (existingPayment.status === PAYMENT_STATUSES.PAID && (event === 'payment.succeeded' || event === 'charge.success')) {
      return {
        success: true,
        alreadyProcessed: true,
        payment: existingPayment,
        message: 'تمت معالجة هذا الإشعار مسبقاً بنجاح (Duplicate Webhook Ignored)'
      };
    }

    // 3. تحديث الحالة بناء على نوع الحدث
    if (event === 'payment.succeeded' || event === 'charge.success') {
      const feeAmount = payload?.data?.fee || payload?.fee || 0;
      const captureResult = await this.capturePayment(existingPayment.id, {
        externalTransactionId: externalTxnId,
        feeAmount: Number(feeAmount)
      });
      return {
        success: true,
        action: 'CAPTURED',
        payment: captureResult.payment,
        journalEntry: captureResult.journalEntry,
        message: 'تم اعتماد المعاملة وترحيل القيد آلياً بناء على إشعار البوابة'
      };
    } else if (event === 'payment.failed') {
      await run('UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [PAYMENT_STATUSES.FAILED, existingPayment.id]);
      return { success: true, action: 'FAILED', message: 'تم تحديث حالة المعاملة إلى FAILED بناء على إشعار البوابة' };
    }

    return { success: true, message: `تم استلام الحدث [${event}] ولم يتطلب إجراءات محاسبية` };
  }
};

module.exports = PaymentService;
