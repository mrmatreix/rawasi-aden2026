const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const { requirePermission, parseScopeArray } = require('../middleware/security');

// جلب الفواتير والمستخلصات مع تطبيق النطاق الصلاحي
router.get('/', requirePermission('billing:view,revenues:view'), async (req, res) => {
  try {
    const { project_id, client_id, status } = req.query;
    let sql = `
      SELECT b.*, 
        p.name as project_name, 
        c.name as client_name 
      FROM bills b
      LEFT JOIN projects p ON b.project_id = p.id
      LEFT JOIN clients c ON b.client_id = c.id
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
        conditions.push(`(b.project_id IS NULL OR b.project_id IN (${placeholders}))`);
        params.push(...allowedProjects.map(Number));
      }
    }

    if (project_id) {
      conditions.push('b.project_id = ?');
      params.push(project_id);
    }
    if (client_id) {
      conditions.push('b.client_id = ?');
      params.push(client_id);
    }
    if (status) {
      conditions.push('b.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY b.date DESC, b.id DESC';
    const bills = await query(sql, params);
    res.json({ success: true, data: bills });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخلصات', error: err.message });
  }
});

const FinancialControlService = {
  ...require('../services/financialControlService')
};
const clientChainService = require('../services/clientChainService');

// إنشاء مستخلص أو فاتورة أعمال جديدة مع التحقق من الصلاحيات والنطاق
router.post('/', requirePermission('billing:create'), async (req, res) => {
  try {
    const {
      bill_type = 'مستخلص جاري',
      project_id,
      client_id,
      contract_id,
      amount,
      deduction = 0,
      advance_deduction = 0,
      retention_deduction = 0,
      status: requestedStatus = 'draft',
      date = new Date().toISOString().split('T')[0],
      notes
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ المستخلص
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    if (!project_id || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد المشروع والمبلغ الإجمالي' });
    }

    // ربط واستنتاج العقد والعميل والاستقطاعات آلياً من دورة حياة المشروع
    const resolution = await clientChainService.resolveBillContractAndClient({
      project_id,
      client_id,
      contract_id,
      amount,
      advance_deduction,
      retention_deduction
    });

    const finalClientId = resolution.client_id;
    const finalContractId = resolution.contract_id;
    const parsedGrossAmount = resolution.gross_amount;
    const parsedAdvDed = resolution.advance_deduction;
    const parsedRetDed = resolution.retention_deduction;
    const totalDeductions = parsedAdvDed > 0 || parsedRetDed > 0 
      ? (parsedAdvDed + parsedRetDed) 
      : (Number(deduction) || 0);

    const net_amount = Math.max(0, parsedGrossAmount - totalDeductions);

    // توليد رقم المستخلص
    const countRes = await get('SELECT COUNT(*) as cnt FROM bills');
    const bill_no = `INV-${new Date().getFullYear()}-${String((countRes ? countRes.cnt : 0) + 1).padStart(4, '0')}`;

    const rawCreatorId = req.user?.id || null;
    const creatorId = await FinancialControlService.resolveValidUserId(rawCreatorId);
    const creatorName = req.user?.username || req.user?.full_name || 'مسؤول فواتير';

    const isPosted = (requestedStatus === 'معتمد' || requestedStatus === 'posted');
    const finalStatus = isPosted ? (requestedStatus === 'معتمد' ? 'معتمد' : 'posted') : (requestedStatus || 'draft');

    let jeNo = null;

    const txResult = await transaction(async (tx) => {
      const result = await tx.run(`
        INSERT INTO bills (
          bill_no, bill_type, project_id, client_id, contract_id,
          amount, deduction, net_amount, status, date, notes,
          gross_amount, advance_deduction, retention_deduction,
          paid_amount, remaining_amount, payment_status,
          created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?, ?, ?)
      `, [
        bill_no, bill_type, project_id, finalClientId || null, finalContractId || null,
        parsedGrossAmount, totalDeductions, net_amount, finalStatus, date, notes || '',
        parsedGrossAmount, parsedAdvDed, parsedRetDed,
        net_amount,
        creatorId, creatorName,
        isPosted ? creatorId : null,
        isPosted ? creatorName : null,
        isPosted ? new Date().toISOString() : null
      ]);

      const billId = result.lastInsertRowid || result.insertId;

      // تحديث نسبة إنجاز المشروع تلقائياً وتوثيقها في السجل التاريخي مع صدور المستخلص
      if (req.body.progress_percentage !== undefined && req.body.progress_percentage !== null && project_id) {
        const newProg = Math.min(100, Math.max(0, parseFloat(req.body.progress_percentage) || 0));
        const oldP = await tx.get('SELECT progress_percentage FROM projects WHERE id = ?', [project_id]);
        const oldProg = oldP ? (Number(oldP.progress_percentage) || 0) : 0;
        if (newProg !== oldProg && newProg > 0) {
          await tx.run('UPDATE projects SET progress_percentage = ? WHERE id = ?', [newProg, project_id]);
          await tx.run(`
            INSERT INTO project_progress_history (project_id, previous_percentage, new_percentage, notes, recorded_by, date)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [project_id, oldProg, newProg, `تحديث نسبة الإنجاز تلقائياً مع إصدار ${bill_type} رقم ${bill_no}`, creatorName, date]);
        }
      }

      // التأثير المحاسبي وتحديث رصيد العميل الذري التلقائي
      if (isPosted) {
        if (finalClientId) {
          await clientChainService.syncClientBalances(finalClientId, tx);
        }

        const jeCountRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
        let jeSeq = ((jeCountRes ? jeCountRes.cnt : 0) || 0) + 1;
        jeNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [jeNo])) {
          jeSeq++;
          jeNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        }

        const jeRes = await tx.run(`
          INSERT INTO journal_entries (
            entry_no, date, description, reference_type, reference_id,
            total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
          ) VALUES (?, ?, ?, 'مستخلص أعمال معتمد', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          jeNo, date,
          `استحقاق ${bill_type} رقم ${bill_no} - إجمالي منجز: ${parsedGrossAmount.toLocaleString()} ر.ي`,
          billId, parsedGrossAmount, parsedGrossAmount,
          creatorId, creatorName, creatorId, creatorName
        ]);

        const jeId = jeRes.lastInsertRowid || jeRes.insertId;

        // ربط المستخلص برقم القيد
        await tx.run('UPDATE bills SET journal_entry_id = ? WHERE id = ?', [jeId, billId]);

        // مدين: ذمم العملاء (بصافي المستخلص)
        if (net_amount > 0) {
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
            VALUES (?, 4, ?, ?, 0, ?)
          `, [jeId, project_id, net_amount, `ذمم عملاء مستحقة - صافي ${bill_type} رقم ${bill_no}`]);
        }

        // مدين: محتجزات ضمان لدى العملاء (Retention Receivable)
        if (parsedRetDed > 0) {
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
            VALUES (?, 16, ?, ?, 0, ?)
          `, [jeId, project_id, parsedRetDed, `أصل تعاقدي - محتجز ضمان مستقطع لحين التسليم النهائي`]);
        }

        // مدين: استهلاك الدفعة المقدمة (إطفاء التزام الدفعة المقدمة)
        if (parsedAdvDed > 0) {
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
            VALUES (?, 18, ?, ?, 0, ?)
          `, [jeId, project_id, parsedAdvDed, `إطفاء التزام تعاقدي - استقطاع استهلاك دفعة مقدمة`]);
        }

        // دائن: أصول تعاقدية / أعمال منجزة مفوترة (Contract Billings)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, 17, ?, 0, ?, ?)
        `, [jeId, project_id, parsedGrossAmount, `أصول تعاقدية - إجمالي الأعمال المنجزة المفوترة بالمستخلص`]);
      }

      return result;
    });

    await logAudit(req, {
      action: isPosted ? 'INSERT' : 'CREATE_DRAFT',
      entity_type: 'bill',
      entity_id: bill_no,
      details: {
        bill_no, bill_type, project_id, client_id: finalClientId,
        gross_amount: parsedGrossAmount, deductions: totalDeductions,
        net_amount, status: finalStatus, date, journal_entry_no: jeNo
      }
    });

    res.json({
      success: true,
      message: isPosted 
        ? `تم إنشاء واعتماد المستخلص (${bill_no}) بنجاح وتوليد القيد المحاسبي المتزن (${jeNo || 'بدون قيد'})`
        : `تم حفظ مسودة المستخلص (${bill_no}) بنجاح وهي جاهزة للمراجعة والاعتماد`,
      bill_no,
      status: finalStatus,
      id: txResult.lastInsertRowid || txResult.insertId,
      gross_amount: parsedGrossAmount,
      net_amount,
      journal_entry_no: jeNo
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء المستخلص: ' + err.message, error: err.message });
  }
});

// إرسال مسودة المستخلص للمراجعة (Draft -> Under Review)
router.post('/:id/submit-review', requirePermission('billing:create,billing:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const bill = await get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) return res.status(404).json({ success: false, message: 'المستخلص غير موجود' });

    if (bill.status !== 'draft') {
      return res.status(400).json({ success: false, message: `لا يمكن إرسال المستخلص للمراجعة لأنه في حالة [${bill.status}]` });
    }

    const rawRevId = req.user?.id || null;
    const reviewerId = await FinancialControlService.resolveValidUserId(rawRevId);
    const reviewerName = req.user?.username || req.user?.full_name || 'مهندس التدقيق';

    await run(`
      UPDATE bills 
      SET status = 'under_review', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
      WHERE id = ?
    `, [reviewerId, reviewerName, notes || null, id]);

    await logAudit(req, {
      action: 'SUBMIT_REVIEW',
      entity_type: 'bill',
      entity_id: bill.bill_no,
      old_values: { status: 'draft' },
      new_values: { status: 'under_review', reviewed_by: reviewerName }
    });

    res.json({ success: true, message: `تم إرسال المستخلص (${bill.bill_no}) للمراجعة والتدقيق الهندسي بنجاح`, status: 'under_review' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// اعتماد المستخلص مع فحص مبدأ العيون الأربع (Maker-Checker / Four-Eyes Principle)
router.post('/:id/approve', requirePermission('billing:approve,accounting:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const bill = await get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) return res.status(404).json({ success: false, message: 'المستخلص غير موجود' });

    // 1. تطبيق مبدأ العيون الأربع (منع منشئ المستخلص من اعتماده بنفسه)
    try {
      FinancialControlService.assertMakerChecker(bill, req.user, 'اعتماد');
    } catch (soDError) {
      return res.status(403).json({ success: false, message: soDError.message, fourEyesViolation: true });
    }

    // 2. التحقق من الفترة المحاسبية
    await FinancialControlService.assertPeriodOpen(bill.date);

    if (bill.status === 'approved' || bill.status === 'معتمد' || bill.status === 'posted') {
      return res.status(400).json({ success: false, message: 'المستخلص معتمد مسبقاً' });
    }

    const rawAppId = req.user?.id || null;
    const approverId = await FinancialControlService.resolveValidUserId(rawAppId);
    const approverName = req.user?.username || req.user?.full_name || 'مدير المشاريع';

    await run(`
      UPDATE bills 
      SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = CURRENT_TIMESTAMP, approval_notes = ?
      WHERE id = ?
    `, [approverId, approverName, notes || null, id]);

    await logAudit(req, {
      action: 'APPROVE',
      entity_type: 'bill',
      entity_id: bill.bill_no,
      old_values: { status: bill.status },
      new_values: { status: 'approved', approved_by: approverName },
      reason: notes || 'اعتماد هندسي ومالي معتمد'
    });

    res.json({ success: true, message: `تم اعتماد المستخلص (${bill.bill_no}) بنجاح بواسطة [${approverName}]`, status: 'approved' });
  } catch (err) {
    const status = err.message.includes('انتهاك') || err.message.includes('لا يجوز') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ترحيل المستخلص المعتمد لدفتر الأستاذ وحسابات العميل (Post to GL)
router.post('/:id/post', requirePermission('billing:post,accounting:post'), async (req, res) => {
  try {
    const { id } = req.params;
    const bill = await get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) return res.status(404).json({ success: false, message: 'المستخلص غير موجود' });

    if (bill.status === 'posted' || bill.status === 'معتمد') {
      return res.status(400).json({ success: false, message: 'المستخلص مرحل مسبقاً' });
    }
    if (bill.status === 'reversed') {
      return res.status(400).json({ success: false, message: 'لا يمكن ترحيل مستخلص تم عكسه مسبقاً' });
    }

    await FinancialControlService.assertPeriodOpen(bill.date);

    const rawPosterId = req.user?.id || null;
    const posterId = await FinancialControlService.resolveValidUserId(rawPosterId);
    const posterName = req.user?.username || req.user?.full_name || 'المحاسب المالي';

    const parsedGrossAmount = Number(bill.gross_amount || bill.amount || 0);
    const parsedAdvDed = Number(bill.advance_deduction || 0);
    const parsedRetDed = Number(bill.retention_deduction || 0);
    const net_amount = Number(bill.net_amount || (parsedGrossAmount - parsedAdvDed - parsedRetDed) || 0);

    let jeNo = null;

    await transaction(async (tx) => {
      // 1. زيادة مستحقات العميل بصافي المستخلص
      if (bill.client_id && net_amount > 0) {
        await tx.run(`
          UPDATE clients SET 
            total_due = total_due + ?,
            current_balance = current_balance + ?
          WHERE id = ?
        `, [net_amount, net_amount, bill.client_id]);
      }

      // 2. توليد قيد استحقاق المستخلص المركب المتزن
      const jeCountRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let jeSeq = ((jeCountRes ? jeCountRes.cnt : 0) || 0) + 1;
      jeNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [jeNo])) {
        jeSeq++;
        jeNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      }

      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id,
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'مستخلص أعمال معتمد', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        jeNo, bill.date,
        `استحقاق ${bill.bill_type} رقم ${bill.bill_no} - إجمالي منجز: ${parsedGrossAmount.toLocaleString()} ر.ي`,
        bill.id, parsedGrossAmount, parsedGrossAmount,
        posterId, posterName, posterId, posterName
      ]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      if (net_amount > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, 4, ?, ?, 0, ?)
        `, [jeId, bill.project_id, net_amount, `ذمم عملاء مستحقة - صافي ${bill.bill_type} رقم ${bill.bill_no}`]);
      }

      if (parsedRetDed > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, 16, ?, ?, 0, ?)
        `, [jeId, bill.project_id, parsedRetDed, `أصل تعاقدي - محتجز ضمان مستقطع لحين التسليم النهائي`]);
      }

      if (parsedAdvDed > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, 18, ?, ?, 0, ?)
        `, [jeId, bill.project_id, parsedAdvDed, `إطفاء التزام تعاقدي - استقطاع استهلاك دفعة مقدمة`]);
      }

      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, 17, ?, 0, ?, ?)
      `, [jeId, bill.project_id, parsedGrossAmount, `أصول تعاقدية - إجمالي الأعمال المنجزة المفوترة بالمستخلص`]);

      await tx.run(`
        UPDATE bills 
        SET status = 'posted', posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP, journal_entry_id = ?,
            remaining_amount = COALESCE(remaining_amount, net_amount)
        WHERE id = ?
      `, [posterId, posterName, jeId, bill.id]);

      if (bill.client_id) {
        await clientChainService.syncClientBalances(bill.client_id, tx);
      }
    });

    await logAudit(req, {
      action: 'POST',
      entity_type: 'bill',
      entity_id: bill.bill_no,
      old_values: { status: bill.status },
      new_values: { status: 'posted', posted_by: posterName, journal_entry_no: jeNo }
    });

    res.json({ success: true, message: `تم ترحيل المستخلص (${bill.bill_no}) بنجاح وتوليد القيد المحاسبي (${jeNo})`, status: 'posted', journal_entry_no: jeNo });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء ترحيل المستخلص: ' + err.message });
  }
});

// تعديل مستخلص (محمي صارماً: للمسودات فقط)
router.put('/:id', requirePermission('billing:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const bill = await get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) return res.status(404).json({ success: false, message: 'المستخلص غير موجود' });

    try {
      FinancialControlService.assertMutable(bill, 'تعديل بيانات أو قيم');
    } catch (mErr) {
      return res.status(400).json({ success: false, message: mErr.message, immutable: true });
    }

    await FinancialControlService.assertPeriodOpen(bill.date);

    const { amount, advance_deduction, retention_deduction, notes, date } = req.body;
    const targetDate = date || bill.date;
    await FinancialControlService.assertPeriodOpen(targetDate);

    const parsedGross = amount ? Number(amount) : Number(bill.gross_amount || bill.amount);
    const parsedAdv = advance_deduction !== undefined ? Number(advance_deduction) : Number(bill.advance_deduction || 0);
    const parsedRet = retention_deduction !== undefined ? Number(retention_deduction) : Number(bill.retention_deduction || 0);
    const totalDeds = parsedAdv + parsedRet;
    const newNet = Math.max(0, parsedGross - totalDeds);

    const oldVals = { gross_amount: bill.gross_amount || bill.amount, net_amount: bill.net_amount, date: bill.date };
    const newVals = { gross_amount: parsedGross, net_amount: newNet, date: targetDate };

    await run(`
      UPDATE bills 
      SET amount = ?, gross_amount = ?, advance_deduction = ?, retention_deduction = ?, 
          deduction = ?, net_amount = ?, notes = COALESCE(?, notes), date = ?
      WHERE id = ?
    `, [parsedGross, parsedGross, parsedAdv, parsedRet, totalDeds, newNet, notes, targetDate, id]);

    await logAudit(req, {
      action: 'UPDATE',
      entity_type: 'bill',
      entity_id: bill.bill_no,
      old_values: oldVals,
      new_values: newVals,
      reason: req.body.reason || 'تعديل مسودة مستخلص'
    });

    res.json({ success: true, message: 'تم تعديل مسودة المستخلص بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تنفيذ قيد عكسي لمستخلص معتمد/مرحل (IPC Storno Reversal)
router.post('/:id/reverse', requirePermission('billing:approve,accounting:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, reversal_date } = req.body;

    const result = await FinancialControlService.reverseBill(id, {
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

// حذف مستخلص (محمي صارماً: للمسودات فقط! يمنع حذف أي مستند معتمد أو مرحل)
router.delete('/:id', requirePermission('billing:cancel'), async (req, res) => {
  try {
    const bill = await get('SELECT * FROM bills WHERE id = ?', [req.params.id]);
    if (!bill) return res.status(404).json({ success: false, message: 'المستخلص غير موجود' });

    try {
      FinancialControlService.assertDeletable(bill);
    } catch (dErr) {
      return res.status(400).json({ 
        success: false, 
        message: dErr.message, 
        financialControlProtected: true 
      });
    }

    await FinancialControlService.assertPeriodOpen(bill.date);

    await run('DELETE FROM bills WHERE id = ?', [req.params.id]);

    await logAudit(req, {
      action: 'DELETE_DRAFT',
      entity_type: 'bill',
      entity_id: req.params.id,
      old_values: { bill_no: bill.bill_no, amount: bill.amount, status: bill.status },
      reason: req.body?.reason || 'حذف مسودة مستخلص غير معتمد'
    });

    res.json({ success: true, message: 'تم حذف مسودة المستخلص بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف المستخلص: ' + err.message });
  }
});

// مصفوفة الفصل المالي الشاملة لقطاع المقاولات (IFRS 15 Separation Matrix)
const ContractingAccountingService = require('../services/contractingAccountingService');

router.get('/contracting-matrix', requirePermission('billing:view,revenues:view,reports:view'), async (req, res) => {
  try {
    let allowedProjects = ['*'];
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
    }

    const matrix = await ContractingAccountingService.getCompanyWideSeparationMatrix({
      allowedProjectIds: allowedProjects
    });

    res.json(matrix);
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في توليد مصفوفة المقاولات المالية: ' + err.message });
  }
});

// جلب تفاصيل مشروع مفرد في مصفوفة المقاولات
router.get('/contracting-matrix/:projectId', requirePermission('billing:view,revenues:view,reports:view'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const metrics = await ContractingAccountingService.calculateProjectMetrics(projectId);
    res.json({ success: true, data: metrics });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// إثبات الإيراد المحاسبي الدوري لمشروع وفق نسبة الإنجاز POC
router.post('/recognize-revenue', requirePermission('billing:create,accounting:create'), async (req, res) => {
  try {
    const { project_id, period_date, notes } = req.body;
    if (!project_id) {
      return res.status(400).json({ success: false, message: 'يجب تحديد المشروع المطلوب إثبات إيراده' });
    }

    const result = await ContractingAccountingService.recognizeProjectRevenue({
      projectId: project_id,
      periodDate: period_date,
      notes,
      user: req.user,
      req
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إثبات الإيراد التعاقدي: ' + err.message });
  }
});

// سجل إثباتات الإيرادات التعاقدية السابقة
router.get('/recognitions', requirePermission('billing:view,revenues:view,accounting:view'), async (req, res) => {
  try {
    const { project_id } = req.query;
    let sql = `
      SELECT cr.*, p.name as project_name, je.entry_no as journal_entry_no
      FROM contract_revenue_recognitions cr
      LEFT JOIN projects p ON cr.project_id = p.id
      LEFT JOIN journal_entries je ON cr.journal_entry_id = je.id
    `;
    const params = [];
    if (project_id) {
      sql += ' WHERE cr.project_id = ?';
      params.push(project_id);
    }
    sql += ' ORDER BY cr.period_date DESC, cr.id DESC';

    const records = await query(sql, params);
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

