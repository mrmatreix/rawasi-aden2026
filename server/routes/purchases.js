const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const { requirePermission, parseScopeArray } = require('../middleware/security');

// جلب فواتير المشتريات
router.get('/', requirePermission('purchases:view'), async (req, res) => {
  try {
    const { supplier_id, project_id } = req.query;
    let sql = `
      SELECT pu.*, 
        s.name as supplier_name, 
        p.name as project_name
      FROM purchases pu
      LEFT JOIN suppliers s ON pu.supplier_id = s.id
      LEFT JOIN projects p ON pu.project_id = p.id
    `;
    const params = [];
    const conditions = [];

    // التحقق من نطاق المشاريع المصرح بها للمستخدم
    const allowedProjects = parseScopeArray(req.user?.scope?.allowed_projects || req.user?.allowed_projects);
    if (allowedProjects.length > 0 && !allowedProjects.includes('*') && !allowedProjects.includes('all')) {
      const placeholders = allowedProjects.map(() => '?').join(',');
      conditions.push(`(pu.project_id IS NULL OR pu.project_id IN (${placeholders}))`);
      params.push(...allowedProjects);
    }

    if (supplier_id) {
      conditions.push('pu.supplier_id = ?');
      params.push(supplier_id);
    }
    if (project_id) {
      conditions.push('pu.project_id = ?');
      params.push(project_id);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY pu.date DESC, pu.id DESC';
    const purchases = await query(sql, params);
    res.json({ success: true, data: purchases });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المشتريات', error: err.message });
  }
});

const FinancialControlService = {
  ...require('../services/financialControlService')
};

// إنشاء فاتورة شراء جديدة داخل Transaction ذرية
router.post('/', requirePermission('purchases:create'), async (req, res) => {
  try {
    const {
      supplier_id,
      project_id,
      total_amount,
      paid_amount = 0,
      payment_status = 'pending',
      payment_method = 'نقدي',
      currency = 'ر.ي',
      date = new Date().toISOString().split('T')[0],
      notes,
      status: requestedStatus = 'posted'
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ فاتورة الشراء
    await FinancialControlService.assertPeriodOpen(date);

    if (!supplier_id || !total_amount || Number(total_amount) <= 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد المورد والمبلغ الإجمالي' });
    }

    const countRes = await get('SELECT COUNT(*) as cnt FROM purchases');
    const invoice_no = `PO-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

    const parsedTotal = Number(total_amount);
    const parsedPaid = Number(paid_amount);
    const remaining = parsedTotal - parsedPaid;

    const rawCreatorId = req.user?.id || null;
    const creatorId = await FinancialControlService.resolveValidUserId(rawCreatorId);
    const creatorName = req.user?.username || req.user?.full_name || 'مسؤول مشتريات';
    const finalStatus = (requestedStatus === 'draft') ? 'draft' : 'posted';

    const txResult = await transaction(async (tx) => {
      const result = await tx.run(`
        INSERT INTO purchases (
          invoice_no, supplier_id, project_id, total_amount, paid_amount, 
          payment_status, payment_method, currency, date, notes,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        invoice_no, supplier_id, project_id || null, parsedTotal, parsedPaid,
        remaining === 0 ? 'paid' : (parsedPaid > 0 ? 'partial' : 'pending'),
        payment_method, currency, date, notes || '',
        finalStatus, creatorId, creatorName,
        finalStatus === 'posted' ? creatorId : null,
        finalStatus === 'posted' ? creatorName : null,
        finalStatus === 'posted' ? new Date().toISOString() : null
      ]);

      if (finalStatus === 'posted') {
        // زيادة رصيد المورد بالمبلغ المتبقي غير المسدد
        if (remaining > 0) {
          await tx.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [remaining, supplier_id]);
        }

        // إذا دفعت مبالغ نقداً، تسجيل حركة الصندوق
        if (parsedPaid > 0) {
          const lastCash = await tx.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
          const prevBal = Number(lastCash.current_balance) || 0;
          const newBal = prevBal - parsedPaid;
          await tx.run(`
            INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes)
            VALUES (?, 0, ?, 0, ?, ?, ?, ?)
          `, [prevBal, parsedPaid, newBal, currency, date, `سداد مشتريات: ${invoice_no}`]);
        }
      }

      return result;
    });

    await logAudit(req, {
      action: finalStatus === 'draft' ? 'CREATE_DRAFT' : 'INSERT',
      entity_type: 'purchase',
      entity_id: invoice_no,
      details: { invoice_no, supplier_id, project_id, total_amount: parsedTotal, paid_amount: parsedPaid, date, status: finalStatus }
    });

    res.json({
      success: true,
      message: finalStatus === 'draft' ? 'تم حفظ مسودة فاتورة الشراء بنجاح' : 'تم تسجيل وترحيل فاتورة الشراء بنجاح',
      invoice_no,
      status: finalStatus,
      id: txResult.lastInsertRowid || txResult.insertId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إنشاء فاتورة المشتريات: ' + err.message, error: err.message });
  }
});

// إرسال مسودة الشراء للمراجعة (Draft -> Under Review)
router.post('/:id/submit-review', requirePermission('purchases:create,purchases:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const pu = await get('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!pu) return res.status(404).json({ success: false, message: 'فاتورة المشتريات غير موجودة' });

    if (pu.status !== 'draft') {
      return res.status(400).json({ success: false, message: `لا يمكن إرسال الفاتورة للمراجعة لأنها في حالة [${pu.status}]` });
    }

    const rawRevId = req.user?.id || null;
    const reviewerId = await FinancialControlService.resolveValidUserId(rawRevId);
    const reviewerName = req.user?.username || req.user?.full_name || 'مراجع المشتريات';

    await run(`
      UPDATE purchases 
      SET status = 'under_review', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
      WHERE id = ?
    `, [reviewerId, reviewerName, notes || null, id]);

    await logAudit(req, {
      action: 'SUBMIT_REVIEW',
      entity_type: 'purchase',
      entity_id: pu.invoice_no,
      old_values: { status: 'draft' },
      new_values: { status: 'under_review', reviewed_by: reviewerName }
    });

    res.json({ success: true, message: `تم إرسال فاتورة الشراء (${pu.invoice_no}) للمراجعة بنجاح`, status: 'under_review' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// اعتماد فاتورة الشراء مع تطبيق مبدأ العيون الأربع (Maker-Checker / Four-Eyes Principle)
router.post('/:id/approve', requirePermission('purchases:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const pu = await get('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!pu) return res.status(404).json({ success: false, message: 'فاتورة المشتريات غير موجودة' });

    try {
      FinancialControlService.assertMakerChecker(pu, req.user, 'اعتماد');
    } catch (soDError) {
      return res.status(403).json({ success: false, message: soDError.message, fourEyesViolation: true });
    }

    await FinancialControlService.assertPeriodOpen(pu.date);

    if (pu.status === 'approved' || pu.status === 'posted') {
      return res.status(400).json({ success: false, message: 'فاتورة الشراء معتمدة مسبقاً' });
    }

    const rawAppId = req.user?.id || null;
    const approverId = await FinancialControlService.resolveValidUserId(rawAppId);
    const approverName = req.user?.username || req.user?.full_name || 'مدير المشتريات';

    await run(`
      UPDATE purchases 
      SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = CURRENT_TIMESTAMP, approval_notes = ?
      WHERE id = ?
    `, [approverId, approverName, notes || null, id]);

    await logAudit(req, {
      action: 'APPROVE',
      entity_type: 'purchase',
      entity_id: pu.invoice_no,
      old_values: { status: pu.status },
      new_values: { status: 'approved', approved_by: approverName },
      reason: notes || 'اعتماد رسمي للمشتريات'
    });

    res.json({ success: true, message: `تم اعتماد فاتورة الشراء (${pu.invoice_no}) بنجاح بواسطة [${approverName}]`, status: 'approved' });
  } catch (err) {
    const status = err.message.includes('انتهاك') || err.message.includes('لا يجوز') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ترحيل فاتورة الشراء لدفتر الأستاذ والصندوق (Post to GL)
router.post('/:id/post', requirePermission('purchases:post,accounting:post'), async (req, res) => {
  try {
    const { id } = req.params;
    const pu = await get('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!pu) return res.status(404).json({ success: false, message: 'فاتورة المشتريات غير موجودة' });

    if (pu.status === 'posted') {
      return res.status(400).json({ success: false, message: 'فاتورة الشراء مرحلة مسبقاً' });
    }
    if (pu.status === 'reversed') {
      return res.status(400).json({ success: false, message: 'لا يمكن ترحيل فاتورة تم عكسها مسبقاً' });
    }

    await FinancialControlService.assertPeriodOpen(pu.date);

    const rawPosterId = req.user?.id || null;
    const posterId = await FinancialControlService.resolveValidUserId(rawPosterId);
    const posterName = req.user?.username || req.user?.full_name || 'المحاسب المالي';

    const parsedTotal = Number(pu.total_amount);
    const parsedPaid = Number(pu.paid_amount);
    const remaining = parsedTotal - parsedPaid;

    await transaction(async (tx) => {
      if (remaining > 0) {
        await tx.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [remaining, pu.supplier_id]);
      }

      if (parsedPaid > 0) {
        const lastCash = await tx.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
        const prevBal = Number(lastCash.current_balance) || 0;
        const newBal = prevBal - parsedPaid;
        await tx.run(`
          INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes)
          VALUES (?, 0, ?, 0, ?, ?, ?, ?)
        `, [prevBal, parsedPaid, newBal, pu.currency || 'ر.ي', pu.date, `ترحيل سداد مشتريات: ${pu.invoice_no}`]);
      }

      await tx.run(`
        UPDATE purchases 
        SET status = 'posted', posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [posterId, posterName, id]);
    });

    await logAudit(req, {
      action: 'POST',
      entity_type: 'purchase',
      entity_id: pu.invoice_no,
      old_values: { status: pu.status },
      new_values: { status: 'posted', posted_by: posterName }
    });

    res.json({ success: true, message: `تم ترحيل فاتورة الشراء (${pu.invoice_no}) بنجاح`, status: 'posted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء ترحيل فاتورة الشراء: ' + err.message });
  }
});

// تعديل فاتورة شراء (محمي صارماً: للمسودات فقط)
router.put('/:id', requirePermission('purchases:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const pu = await get('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!pu) return res.status(404).json({ success: false, message: 'فاتورة المشتريات غير موجودة' });

    try {
      FinancialControlService.assertMutable(pu, 'تعديل بيانات أو قيم');
    } catch (mErr) {
      return res.status(400).json({ success: false, message: mErr.message, immutable: true });
    }

    await FinancialControlService.assertPeriodOpen(pu.date);

    const { total_amount, paid_amount, notes, date } = req.body;
    const targetDate = date || pu.date;
    await FinancialControlService.assertPeriodOpen(targetDate);

    const parsedTotal = total_amount ? Number(total_amount) : Number(pu.total_amount);
    const parsedPaid = paid_amount !== undefined ? Number(paid_amount) : Number(pu.paid_amount);

    const oldVals = { total_amount: pu.total_amount, paid_amount: pu.paid_amount, date: pu.date };
    const newVals = { total_amount: parsedTotal, paid_amount: parsedPaid, date: targetDate };

    await run(`
      UPDATE purchases 
      SET total_amount = ?, paid_amount = ?, notes = COALESCE(?, notes), date = ?
      WHERE id = ?
    `, [parsedTotal, parsedPaid, notes, targetDate, id]);

    await logAudit(req, {
      action: 'UPDATE',
      entity_type: 'purchase',
      entity_id: pu.invoice_no,
      old_values: oldVals,
      new_values: newVals,
      reason: req.body.reason || 'تعديل مسودة فاتورة مشتريات'
    });

    res.json({ success: true, message: 'تم تعديل مسودة فاتورة الشراء بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تنفيذ قيد عكسي لفاتورة مشتريات معتمدة/مرحلة (Purchase Storno Reversal)
router.post('/:id/reverse', requirePermission('purchases:approve,accounting:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, reversal_date } = req.body;

    const result = await FinancialControlService.reversePurchase(id, {
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

// حذف فاتورة شراء (محمي صارماً: للمسودات فقط)
router.delete('/:id', requirePermission('purchases:cancel'), async (req, res) => {
  try {
    const pu = await get('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
    if (!pu) return res.status(404).json({ success: false, message: 'فاتورة المشتريات غير موجودة' });

    try {
      FinancialControlService.assertDeletable(pu);
    } catch (dErr) {
      return res.status(400).json({ 
        success: false, 
        message: dErr.message, 
        financialControlProtected: true 
      });
    }

    await FinancialControlService.assertPeriodOpen(pu.date);

    await run('DELETE FROM purchases WHERE id = ?', [req.params.id]);

    await logAudit(req, {
      action: 'DELETE_DRAFT',
      entity_type: 'purchase',
      entity_id: req.params.id,
      old_values: { invoice_no: pu.invoice_no, total_amount: pu.total_amount, status: pu.status },
      reason: req.body?.reason || 'حذف مسودة فاتورة شراء'
    });

    res.json({ success: true, message: 'تم حذف مسودة فاتورة الشراء بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف فاتورة الشراء: ' + err.message });
  }
});

module.exports = router;
