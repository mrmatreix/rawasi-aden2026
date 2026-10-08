const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const { requirePermission, parseScopeArray } = require('../middleware/security');
const AccountingService = require('../services/accountingService');
const PaymentService = require('../services/paymentService');
const FinancialControlService = {
  ...require('../services/financialControlService')
};

// 1. جلب طرق الدفع المعرفة في النظام
router.get('/methods', async (req, res) => {
  try {
    const methods = await PaymentService.getPaymentMethods();
    res.json({ success: true, data: methods });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب طرق الدفع', error: err.message });
  }
});

// 2. جلب الحسابات المالية النشطة مع بيانات الحساب المحاسبي النهائي
router.get('/financial-accounts', async (req, res) => {
  try {
    const finAccounts = await PaymentService.getFinancialAccounts(req.query.type);
    res.json({ success: true, data: finAccounts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الحسابات المالية', error: err.message });
  }
});

// 3. مسار استلام إشعارات بوابات الدفع الإلكتروني (Webhooks) المحمي بتوقيع تشفيري
router.post('/webhook/:gateway', async (req, res) => {
  try {
    const gateway = req.params.gateway;
    const signature = req.headers['x-signature'] || req.headers['x-webhook-signature'] || req.headers['stripe-signature'];
    const result = await PaymentService.processWebhook({
      gateway,
      payload: req.body,
      signature,
      headers: req.headers
    });
    res.json(result);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// 4. مسار إنشاء معاملة دفع حديثة مع حماية Idempotency وفصل طريقة الدفع عن الحساب المالي
router.post('/initiate', requirePermission('revenues:create,expenses:create,accounting:view'), async (req, res) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotency_key;
    const result = await PaymentService.initiatePayment({
      ...req.body,
      idempotencyKey,
      user: req.user,
      req
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.message.includes('لا يمكن') || err.message.includes('غير صالح') || err.message.includes('مطلوب') || err.message.includes('الحساب') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// 5. مسار اعتماد وترحيل عملية الدفع (Capture Payment)
router.post('/:id/capture', requirePermission('revenues:approve,expenses:approve,accounting:post'), async (req, res) => {
  try {
    const result = await PaymentService.capturePayment(req.params.id, {
      externalTransactionId: req.body.external_transaction_id,
      feeAmount: req.body.fee_amount,
      user: req.user,
      req
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 6. مسار الاسترداد المالي (Refund) كامل أو جزئي دون حذف العملية
router.post('/:id/refund', requirePermission('revenues:approve,expenses:approve,accounting:post'), async (req, res) => {
  try {
    const { amount, reason, reference } = req.body;
    const result = await PaymentService.refundPayment(req.params.id, {
      amount,
      reason,
      reference,
      user: req.user,
      req
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 7. إلغاء معاملة دفع غير مرحلة (Cancel Pending Payment)
router.post('/:id/cancel', requirePermission('revenues:cancel,expenses:cancel,accounting:post'), async (req, res) => {
  try {
    const payment = await get('SELECT * FROM payments WHERE id = ?', [Number(req.params.id)]);
    if (!payment) return res.status(404).json({ success: false, message: 'عملية الدفع غير موجودة' });
    if (payment.status === PaymentService.PAYMENT_STATUSES.PAID) {
      return res.status(400).json({ success: false, message: 'لا يمكن إلغاء عملية مدفوعة ومرحلة، يرجى استخدام الاسترداد (Refund) أو القيد العكسي' });
    }
    await run('UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [PaymentService.PAYMENT_STATUSES.CANCELED, payment.id]);
    res.json({ success: true, message: 'تم إلغاء عملية الدفع بنجاح' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// جلب سندات القبض والصرف مع بيانات الحسابات ومراكز التكلفة وحالة دورة المستند
router.get('/', requirePermission('revenues:view,expenses:view,accounting:view'), async (req, res) => {
  try {
    const { type, client_id, supplier_id, project_id, status } = req.query;
    let sql = `
      SELECT p.*, 
        COALESCE(c.name, p.client_name, '') as client_name, 
        s.name as supplier_name,
        pr.name as project_name,
        a.name as account_name,
        a.code as account_code,
        cc.name as cost_center_name,
        cc.code as cost_center_code
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN accounts a ON p.account_id = a.id
      LEFT JOIN cost_centers cc ON p.cost_center_id = cc.id
    `;
    const params = [];
    const conditions = [];

    // تطبيق نطاق المشاريع المصرح بها
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      const allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
      if (!allowedProjects.includes('*') && !allowedProjects.includes('all')) {
        if (allowedProjects.length === 0) {
          return res.json({ success: true, data: [] });
        }
        const placeholders = allowedProjects.map(() => '?').join(',');
        conditions.push(`(p.project_id IS NULL OR p.project_id IN (${placeholders}))`);
        params.push(...allowedProjects.map(Number));
      }
    }

    if (type) {
      conditions.push('p.type = ?');
      params.push(type);
    }
    if (client_id) {
      conditions.push('p.client_id = ?');
      params.push(client_id);
    }
    if (supplier_id) {
      conditions.push('p.supplier_id = ?');
      params.push(supplier_id);
    }
    if (project_id) {
      conditions.push('p.project_id = ?');
      params.push(project_id);
    }
    if (status) {
      conditions.push('p.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY p.date DESC, p.id DESC';
    const payments = await query(sql, params);
    res.json({ success: true, data: payments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب السندات والمدفوعات', error: err.message });
  }
});

// إنشاء سند قبض أو صرف (مسودة أو ترحيل فوري) مع توثيق المنشئ وفحص الفترة
router.post('/', (req, res, next) => {
  const isReceipt = (req.body?.type === 'قبض');
  const reqPerm = isReceipt ? 'revenues:create' : 'expenses:create';
  return requirePermission(reqPerm)(req, res, next);
}, async (req, res) => {
  try {
    const {
      type = 'قبض', // 'قبض' أو 'صرف'
      client_id,
      supplier_id,
      project_id,
      account_id,
      cost_center_id,
      amount,
      currency = 'ر.ي',
      payment_method = 'نقدي', // تحويل بنكي، نقدي، شيك
      check_no,
      bank_name,
      bank_account_id,
      date = new Date().toISOString().split('T')[0],
      notes,
      status: requestedStatus
    } = req.body;

    // فحص الحماية من تكرار الإرسال والعمليات (Idempotency Protection)
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotency_key || null;
    if (idempotencyKey) {
      const existing = await get('SELECT * FROM payments WHERE idempotency_key = ?', [idempotencyKey]);
      if (existing) {
        return res.json({
          success: true,
          isDuplicate: true,
          message: 'تم استرجاع السند المسجل مسبقاً بنجاح ومنع التكرار (Idempotency Protected)',
          receipt_no: existing.receipt_no,
          payment_no: existing.payment_no || existing.receipt_no,
          id: existing.id,
          status: existing.status,
          journal_entry_id: existing.journal_entry_id
        });
      }
    }

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ السند
    await FinancialControlService.assertPeriodOpen(date);

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'المبلغ مطلوب ويجب أن يكون أكبر من الصفر' });
    }

    if (!account_id) {
      return res.status(400).json({ success: false, message: `يرجى اختيار الحساب المالي لسند ال${type}` });
    }

    // التحقق الصارم من الحساب المالي المختار أنه حساب فرعي أخير
    const leafAccount = await AccountingService.assertLeafAccount(account_id);

    if (!payment_method) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد طريقة الدفع / القبض (نقدي / تحويل بنكي / شيك)' });
    }

    if (payment_method === 'شيك' && (!check_no || !String(check_no).trim())) {
      return res.status(400).json({ success: false, message: `عند إصدار سند ${type} بطريقة الدفع (شيك) يجب إدخال رقم الشيك` });
    }

    const isBank = (payment_method === 'شيك' || payment_method === 'تحويل بنكي');
    let resolvedBank = null;
    if (isBank) {
      resolvedBank = await AccountingService.resolveBankAccount(bank_account_id, bank_name);
      if (!resolvedBank || !resolvedBank.coaAccount) {
        return res.status(400).json({ success: false, message: `عند إصدار سند ${type} عبر البنك يجب تحديد حساب البنك في دليل الحسابات` });
      }
    }

    const parsedAmount = Number(amount);
    const selectedCurrency = currency || 'ر.ي';
    const cleanCheckNo = check_no ? String(check_no).trim() : null;
    const cleanBankName = bank_name ? String(bank_name).trim() : (resolvedBank?.bankRecord?.bank_name || null);

    let finalExchangeRate = 1.0;
    if (selectedCurrency !== 'ر.ي') {
      if (req.body.exchange_rate && Number(req.body.exchange_rate) > 0) {
        finalExchangeRate = Number(req.body.exchange_rate);
      } else {
        const currRow = await get('SELECT rate_to_base FROM currencies WHERE symbol = ? OR code = ?', [selectedCurrency, selectedCurrency]);
        if (currRow && currRow.rate_to_base > 0) {
          finalExchangeRate = Number(currRow.rate_to_base);
        }
      }
    }
    const finalLocalAmount = req.body.local_amount && Number(req.body.local_amount) > 0
      ? Number(req.body.local_amount)
      : Math.round(parsedAmount * finalExchangeRate * 100) / 100;

    // توليد رقم السند
    const prefix = type === 'قبض' ? 'RC' : 'PV';
    const currentYear = new Date().getFullYear();
    const countRes = await get('SELECT COUNT(*) as cnt FROM payments WHERE type = ?', [type]);
    let seq = (countRes ? countRes.cnt : 0) + 1;
    let receipt_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    while (await get('SELECT id FROM payments WHERE receipt_no = ?', [receipt_no])) {
      seq++;
      receipt_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    }

    let bId = req.body.bill_id && req.body.bill_id !== '' ? Number(req.body.bill_id) : null;
    let cntId = req.body.contract_id && req.body.contract_id !== '' ? Number(req.body.contract_id) : null;
    let cId = client_id && client_id !== '' ? Number(client_id) : null;
    let pId = project_id && project_id !== '' ? Number(project_id) : null;

    // استنتاج وربط العميل والمشروع والعقد آلياً من المستخلص المختار
    if (bId) {
      const linkedBill = await get('SELECT id, project_id, client_id, contract_id, net_amount, paid_amount FROM bills WHERE id = ?', [bId]);
      if (linkedBill) {
        if (!cId && linkedBill.client_id) cId = linkedBill.client_id;
        if (!pId && linkedBill.project_id) pId = linkedBill.project_id;
        if (!cntId && linkedBill.contract_id) cntId = linkedBill.contract_id;
      }
    }
    if (!cntId && pId) {
      const activeContract = await get("SELECT id FROM project_contracts WHERE project_id = ? AND (status != 'ملغي' OR status IS NULL) ORDER BY id DESC LIMIT 1", [pId]);
      if (activeContract) cntId = activeContract.id;
    }

    const sId = supplier_id && supplier_id !== '' ? Number(supplier_id) : null;
    let validClientId = null;
    if (cId) {
      const clExists = await get('SELECT id FROM clients WHERE id = ?', [cId]);
      if (clExists) validClientId = clExists.id;
    }
    let validSupplierId = null;
    if (sId) {
      const suppExists = await get('SELECT id FROM suppliers WHERE id = ?', [sId]);
      if (suppExists) validSupplierId = suppExists.id;
    }
    let validProjectId = null;
    if (pId) {
      const prjExists = await get('SELECT id FROM projects WHERE id = ?', [pId]);
      if (prjExists) validProjectId = prjExists.id;
    }
    let validContractId = null;
    if (cntId) {
      const cntExists = await get('SELECT id FROM project_contracts WHERE id = ?', [cntId]);
      if (cntExists) validContractId = cntExists.id;
    }
    let validBillId = null;
    if (bId) {
      const billExists = await get('SELECT id FROM bills WHERE id = ?', [bId]);
      if (billExists) validBillId = billExists.id;
    }
    let validBankAccId = null;
    if (isBank) {
      const bAccId = bank_account_id ? Number(bank_account_id) : (resolvedBank?.bankRecord?.id || null);
      if (bAccId) {
        const bExists = await get('SELECT id FROM bank_accounts WHERE id = ?', [bAccId]);
        if (bExists) validBankAccId = bExists.id;
      }
    }

    const directClientName = req.body.client_name ? String(req.body.client_name).trim() : null;
    const directSupplierName = req.body.supplier_name ? String(req.body.supplier_name).trim() : null;
    const accId = leafAccount.id;
    let finalCcId = null;
    if (cost_center_id && cost_center_id !== '') {
      const ccExists = await get('SELECT id FROM cost_centers WHERE id = ?', [Number(cost_center_id)]);
      if (ccExists) finalCcId = ccExists.id;
    }
    if (!finalCcId && validProjectId) {
      const prjCc = await get('SELECT id FROM cost_centers WHERE project_id = ? LIMIT 1', [validProjectId]);
      if (prjCc) finalCcId = prjCc.id;
    }
    if (!finalCcId) {
      const defCc = await get('SELECT id FROM cost_centers ORDER BY id ASC LIMIT 1');
      if (defCc) finalCcId = defCc.id;
    }

    const rawCreatorId = req.user?.id || null;
    const creatorId = await FinancialControlService.resolveValidUserId(rawCreatorId);
    const creatorName = req.user?.username || req.user?.full_name || 'مسؤول مالي';
    const finalStatus = (requestedStatus === 'draft') ? 'draft' : 'posted';
    const cleanReceiptCategory = req.body.receipt_category || 'general';
    let createdJe = null;

    // استنتاج معرف طريقة الدفع والحساب المالي
    let pmId = req.body.payment_method_id ? Number(req.body.payment_method_id) : null;
    if (!pmId) {
      const pmRow = await get('SELECT id FROM payment_methods WHERE name = ? OR code = ? LIMIT 1', [payment_method, payment_method]);
      if (pmRow) pmId = pmRow.id;
    }
    let faId = req.body.financial_account_id ? Number(req.body.financial_account_id) : null;
    if (!faId) {
      if (isBank) {
        const faBank = validBankAccId 
          ? await get('SELECT id FROM financial_accounts WHERE account_number = (SELECT account_number FROM bank_accounts WHERE id = ?) LIMIT 1', [validBankAccId])
          : await get("SELECT id FROM financial_accounts WHERE type = 'bank' AND is_active = 1 LIMIT 1");
        if (faBank) faId = faBank.id;
      } else {
        const faCash = await get("SELECT id FROM financial_accounts WHERE type = 'cash' AND is_active = 1 LIMIT 1");
        if (faCash) faId = faCash.id;
      }
    }

    const txResult = await transaction(async (tx) => {
      // 1. تسجيل السند مع بيانات المنشئ وحالة الدورة وتصنيف المقبوضات وأسعار الصرف واسم العميل المباشر
      const result = await tx.run(`
        INSERT INTO payments (
          payment_no, receipt_no, type, client_id, client_name, supplier_id, project_id, 
          contract_id, bill_id,
          account_id, cost_center_id, amount, currency, payment_method, payment_method_id, financial_account_id,
          check_no, bank_name, bank_account_id, date, notes, receipt_category,
          exchange_rate, local_amount, fee_amount, net_amount, idempotency_key,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, 0, ?, ?,
          ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
        )
      `, [
        receipt_no, receipt_no, type, validClientId || null, directClientName || null, validSupplierId || null, validProjectId || null,
        validContractId || null, validBillId || null,
        accId, finalCcId || null, parsedAmount, selectedCurrency, payment_method, pmId || null, faId || null,
        cleanCheckNo || null, cleanBankName || null, validBankAccId || null, date, notes || '', cleanReceiptCategory || 'general',
        finalExchangeRate || 1.0, finalLocalAmount, finalLocalAmount, idempotencyKey || null,
        finalStatus, creatorId || null, creatorName || 'مسؤول مالي',
        finalStatus === 'posted' ? creatorId : null,
        finalStatus === 'posted' ? creatorName : null,
        finalStatus === 'posted' ? new Date().toISOString() : null
      ]);

      const paymentId = result.lastInsertRowid || result.insertId;

      // 2. إذا كانت مسودة، لا يتم التأثير المالي حتى الاعتماد والترحيل
      if (finalStatus === 'posted') {
        // التأثير المحاسبي وتحديث رصيد العميل الذري والمستخلص
        const clientChainService = require('../services/clientChainService');
        if (type === 'قبض') {
          if (bId) {
            await clientChainService.applyPaymentToBill(bId, finalLocalAmount, tx);
          }
          if (cId) {
            await clientChainService.syncClientBalances(cId, tx);
          }
        } else if (type === 'صرف' && sId) {
          await tx.run(`
            UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?
          `, [finalLocalAmount, sId]);
        }

        // التأثير على حركة الصندوق والبنك وتحديد نوع الحركة (نقدي / بنك)
        const lastCash = await tx.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
        const prevBal = Number(lastCash.current_balance) || 0;
        const newBal = type === 'قبض' ? prevBal + finalLocalAmount : prevBal - finalLocalAmount;
        const moveType = (payment_method === 'شيك' || payment_method === 'تحويل بنكي' || String(cleanBankName).length > 0) ? 'بنك' : 'نقدي';
        const partyLabel = directClientName || directSupplierName;
        const moveDesc = payment_method === 'شيك' 
          ? `سند ${type} بشيك رقم ${cleanCheckNo}: ${receipt_no}${partyLabel ? ' (' + partyLabel + ')' : ''}`
          : `سند ${type}: ${receipt_no}${partyLabel ? ' (' + partyLabel + ')' : ''} ${selectedCurrency !== 'ر.ي' ? '(' + parsedAmount + ' ' + selectedCurrency + ')' : ''}`;

        await tx.run(`
          INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes, movement_type, payment_method, reference_no, account_id)
          VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          prevBal,
          type === 'قبض' ? finalLocalAmount : 0,
          type === 'صرف' ? finalLocalAmount : 0,
          newBal,
          'ر.ي',
          date,
          moveDesc,
          moveType,
          payment_method,
          receipt_no,
          accId
        ]);

        // توليد قيد يومي تلقائي متزن بدقة عبر الخدمة المحاسبية الموحدة
        const voucherType = type === 'قبض' ? 'سند قبض' : 'سند صرف';
        createdJe = await AccountingService.createVoucherJournalEntry({
          voucherType,
          voucherId: paymentId,
          receiptNo: receipt_no,
          date,
          amount: finalLocalAmount,
          accountId: accId,
          paymentMethod: payment_method,
          bankAccountId: validBankAccId,
          bankName: cleanBankName || resolvedBank?.bankRecord?.bank_name || null,
          costCenterId: finalCcId,
          projectId: pId,
          notes: notes || (type === 'قبض' ? 'سند قبض إيرادات' : 'سند صرف مورد'),
          user: req.user,
          req
        }, tx);
      }

      return result;
    });

    await logAudit(req, {
      action: finalStatus === 'draft' ? 'CREATE_DRAFT' : 'INSERT',
      entity_type: type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: receipt_no,
      details: { type, amount: parsedAmount, status: finalStatus, created_by: creatorName },
      new_values: { receipt_no, type, amount: parsedAmount, date, status: finalStatus, created_by: creatorName }
    });

    res.json({
      success: true,
      message: finalStatus === 'draft'
        ? `تم حفظ مسودة سند ${type} بنجاح برقم ${receipt_no} وهي جاهزة للمراجعة`
        : `تم تسجيل وترحيل سند ال${type} بنجاح برقم ${receipt_no} وحفظ القيد اليومي التلقائي`,
      receipt_no,
      status: finalStatus,
      id: txResult.lastInsertRowid || txResult.insertId,
      journal_entry_id: createdJe?.id || null,
      entry_no: createdJe?.entry_no || null
    });
  } catch (err) {
    console.error('Payment transaction error:', err);
    const status = err.message.includes('لا يمكن') || err.message.includes('مغلقة') || err.message.includes('الحساب') || err.message.includes('غير متزن') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message, error: err.message });
  }
});

// إرسال مسودة السند للمراجعة (Draft -> Under Review)
router.post('/:id/submit-review', requirePermission('revenues:create,expenses:create'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ success: false, message: 'السند المالي غير موجود' });

    if (pay.status !== 'draft') {
      return res.status(400).json({ success: false, message: `لا يمكن إرسال السند للمراجعة لأنه في حالة [${pay.status}]` });
    }

    const rawRevId = req.user?.id || null;
    const reviewerId = await FinancialControlService.resolveValidUserId(rawRevId);
    const reviewerName = req.user?.username || req.user?.full_name || 'مراجع الحسابات';
    await run(`
      UPDATE payments 
      SET status = 'under_review', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
      WHERE id = ?
    `, [reviewerId, reviewerName, notes || null, id]);

    await logAudit(req, {
      action: 'SUBMIT_REVIEW',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: { status: 'draft' },
      new_values: { status: 'under_review', reviewed_by: reviewerName }
    });

    res.json({ success: true, message: `تم إرسال سند ${pay.type} (${pay.receipt_no}) للمراجعة بنجاح`, status: 'under_review' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// اعتماد السند المالي مع فحص مبدأ العيون الأربع (Maker-Checker / Four-Eyes Principle)
router.post('/:id/approve', (req, res, next) => {
  return requirePermission('revenues:approve,expenses:approve,accounting:approve')(req, res, next);
}, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ success: false, message: 'السند المالي غير موجود' });

    // فحص مبدأ العيون الأربع (منع منشئ السند من اعتماده بنفسه)
    try {
      FinancialControlService.assertMakerChecker(pay, req.user, 'اعتماد');
    } catch (soDError) {
      return res.status(403).json({ success: false, message: soDError.message, fourEyesViolation: true });
    }

    await FinancialControlService.assertPeriodOpen(pay.date);

    if (pay.status === 'approved' || pay.status === 'posted') {
      return res.status(400).json({ success: false, message: 'السند معتمد مسبقاً' });
    }

    const rawAppId = req.user?.id || null;
    const approverId = await FinancialControlService.resolveValidUserId(rawAppId);
    const approverName = req.user?.username || req.user?.full_name || 'المدير المالي';
    await run(`
      UPDATE payments 
      SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = CURRENT_TIMESTAMP, approval_notes = ?
      WHERE id = ?
    `, [approverId, approverName, notes || null, id]);

    await logAudit(req, {
      action: 'APPROVE',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: { status: pay.status },
      new_values: { status: 'approved', approved_by: approverName },
      reason: notes || 'اعتماد مالي قانوني'
    });

    res.json({ success: true, message: `تم اعتماد سند ${pay.type} (${pay.receipt_no}) بنجاح بواسطة [${approverName}]`, status: 'approved' });
  } catch (err) {
    const status = err.message.includes('انتهاك') || err.message.includes('لا يجوز') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ترحيل السند المالي لدفتر الأستاذ والصندوق (Post to GL)
router.post('/:id/post', (req, res, next) => {
  return requirePermission('accounting:post,revenues:create,expenses:create')(req, res, next);
}, async (req, res) => {
  try {
    const { id } = req.params;
    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ success: false, message: 'السند المالي غير موجود' });

    if (pay.status === 'posted') {
      return res.status(400).json({ success: false, message: 'السند مرحل مسبقاً' });
    }
    if (pay.status === 'reversed') {
      return res.status(400).json({ success: false, message: 'لا يمكن ترحيل سند تم عكسه مسبقاً' });
    }

    await FinancialControlService.assertPeriodOpen(pay.date);

    if (!pay.account_id) {
      return res.status(400).json({ success: false, message: `لا يمكن ترحيل سند ${pay.type} بدون تحديد حساب مالي صالح في الدليل` });
    }
    const leafAcc = await AccountingService.assertLeafAccount(pay.account_id);

    const rawPosterId = req.user?.id || null;
    const posterId = await FinancialControlService.resolveValidUserId(rawPosterId);
    const posterName = req.user?.username || req.user?.full_name || 'المحاسب المالي';
    const parsedAmount = Number(pay.amount);

    await transaction(async (tx) => {
      // 1. التأثير على العميل أو المورد
      if (pay.type === 'قبض' && pay.client_id) {
        await tx.run(`
          UPDATE clients SET 
            total_paid = total_paid + ?,
            current_balance = GREATEST(0, current_balance - ?)
          WHERE id = ?
        `, [parsedAmount, parsedAmount, pay.client_id]);
      } else if (pay.type === 'صرف' && pay.supplier_id) {
        await tx.run(`
          UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?
        `, [parsedAmount, pay.supplier_id]);
      }

      // 2. حركة الصندوق والبنك
      const lastCash = await tx.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
      const prevBal = Number(lastCash.current_balance) || 0;
      const newBal = pay.type === 'قبض' ? prevBal + parsedAmount : prevBal - parsedAmount;
      const moveDesc = pay.payment_method === 'شيك' 
        ? `سند ${pay.type} بشيك رقم ${pay.check_no}: ${pay.receipt_no}`
        : `سند ${pay.type}: ${pay.receipt_no}`;

      await tx.run(`
        INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?)
      `, [
        prevBal,
        pay.type === 'قبض' ? parsedAmount : 0,
        pay.type === 'صرف' ? parsedAmount : 0,
        newBal,
        pay.currency || 'ر.ي',
        pay.date,
        moveDesc
      ]);

      // 3. قيد اليومية التلقائي المتزن بدقة عبر الخدمة المحاسبية الموحدة مع منع التكرار
      const voucherType = pay.type === 'قبض' ? 'سند قبض' : 'سند صرف';
      await AccountingService.createVoucherJournalEntry({
        voucherType,
        voucherId: pay.id,
        receiptNo: pay.receipt_no,
        date: pay.date,
        amount: parsedAmount,
        accountId: leafAcc.id,
        paymentMethod: pay.payment_method || 'نقدي',
        bankAccountId: pay.bank_account_id || null,
        bankName: pay.bank_name || null,
        costCenterId: pay.cost_center_id,
        projectId: pay.project_id,
        notes: pay.notes || (pay.type === 'قبض' ? 'سند قبض إيرادات' : 'سند صرف مورد'),
        user: req.user,
        req
      }, tx);

      // 4. تحديث حالة السند
      await tx.run(`
        UPDATE payments 
        SET status = 'posted', posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [posterId, posterName, pay.id]);
    });

    await logAudit(req, {
      action: 'POST',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: { status: pay.status },
      new_values: { status: 'posted', posted_by: posterName }
    });

    res.json({ success: true, message: `تم ترحيل سند ${pay.type} (${pay.receipt_no}) بنجاح وتوليد القيد المحاسبي`, status: 'posted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء ترحيل السند: ' + err.message });
  }
});

// تعديل سند مالي (محمي صارماً: للمسودات فقط)
router.put('/:id', requirePermission('revenues:edit,expenses:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ success: false, message: 'السند المالي غير موجود' });

    try {
      FinancialControlService.assertMutable(pay, 'تعديل قيمة أو بيانات');
    } catch (mErr) {
      return res.status(400).json({ success: false, message: mErr.message, immutable: true });
    }

    await FinancialControlService.assertPeriodOpen(pay.date);

    const { amount, notes, date } = req.body;
    const targetDate = date || pay.date;
    await FinancialControlService.assertPeriodOpen(targetDate);

    const oldVals = { amount: pay.amount, notes: pay.notes, date: pay.date };
    const newVals = { 
      amount: amount ? Number(amount) : pay.amount, 
      notes: notes !== undefined ? notes : pay.notes,
      date: targetDate
    };

    await run(`
      UPDATE payments 
      SET amount = ?, notes = ?, date = ?
      WHERE id = ?
    `, [newVals.amount, newVals.notes, newVals.date, id]);

    await logAudit(req, {
      action: 'UPDATE',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: oldVals,
      new_values: newVals,
      reason: req.body.reason || 'تعديل مسودة سند مالي'
    });

    res.json({ success: true, message: 'تم تعديل مسودة السند بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تنفيذ قيد عكسي لسند القبض أو الصرف (Storno Reversal)
router.post('/:id/reverse', (req, res, next) => {
  return requirePermission('revenues:cancel,expenses:cancel,accounting:approve')(req, res, next);
}, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, reversal_date } = req.body;

    const result = await FinancialControlService.reversePayment(id, {
      user: req.user,
      reason,
      reversal_date,
      req
    });

    res.json(result);
  } catch (err) {
    const status = err.message.includes('لا يمكن') || err.message.includes('يجب كتابة') || err.message.includes('مغلقة') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// حذف سند (محمي صارماً: للمسودات فقط! يمنع حذف أي سند معتمد أو مرحل)
router.delete('/:id', (req, res, next) => {
  return requirePermission('revenues:cancel,expenses:cancel')(req, res, next);
}, async (req, res) => {
  try {
    const pay = await get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
    if (!pay) {
      return res.status(404).json({ success: false, message: 'السند غير موجود' });
    }

    try {
      FinancialControlService.assertDeletable(pay);
    } catch (dErr) {
      return res.status(400).json({ 
        success: false, 
        message: dErr.message, 
        financialControlProtected: true 
      });
    }

    await FinancialControlService.assertPeriodOpen(pay.date);

    await run('DELETE FROM payments WHERE id = ?', [req.params.id]);

    await logAudit(req, {
      action: 'DELETE_DRAFT',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: { receipt_no: pay.receipt_no, type: pay.type, amount: pay.amount, date: pay.date, status: pay.status },
      reason: req.body?.reason || 'حذف مسودة سند غير معتمدة'
    });

    res.json({ success: true, message: `تم حذف مسودة سند ال${pay.type} بنجاح` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف السند: ' + err.message });
  }
});

module.exports = router;
