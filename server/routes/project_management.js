const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { query, get, run, transaction } = require('../database/db');
const { tafqeet } = require('../services/tafqeetService');
const clientChainService = require('../services/clientChainService');
const { requirePermission, requireScope } = require('../middleware/security');

// فرض نطاق المشروع الإلزامي وحماية العمليات على كافة مسارات إدارة المشاريع
router.use('/:projectId', requireScope({ projectParam: 'projectId' }), (req, res, next) => {
  if (req.method === 'GET') {
    return requirePermission('projects:view')(req, res, next);
  }
  if (req.method === 'DELETE') {
    return requirePermission('projects:cancel')(req, res, next);
  }
  // اعتماد أو تعديل حالة أو أمر تغيير
  if (req.path.includes('/status') || req.path.includes('/approve') || (req.body && req.body.status === 'معتمد')) {
    return requirePermission('projects:approve,projects:edit')(req, res, next);
  }
  return requirePermission('projects:edit,projects:create')(req, res, next);
});

// ============================================================================
// 0. ملخص شامل لجميع المتطلبات الـ 14 للمشروع المحدد
// ============================================================================
router.get('/:projectId/overview', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = await get(`
      SELECT p.*, c.name as client_name, c.phone as client_phone, c.company as client_company
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [projectId]);

    if (!project) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }

    const contract = await get('SELECT * FROM project_contracts WHERE project_id = ?', [projectId]);
    const drawings = await query('SELECT * FROM project_drawings WHERE project_id = ? ORDER BY id DESC', [projectId]);
    const boq = await query('SELECT * FROM project_boq WHERE project_id = ? ORDER BY id ASC', [projectId]);
    const quotations = await query('SELECT * FROM project_quotations WHERE project_id = ? ORDER BY id DESC', [projectId]);
    const budgets = await query('SELECT * FROM project_budgets WHERE project_id = ? ORDER BY id ASC', [projectId]);
    const changeOrders = await query('SELECT * FROM project_change_orders WHERE project_id = ? ORDER BY id DESC', [projectId]);
    const purchases = await query('SELECT * FROM project_purchases WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const labor = await query('SELECT * FROM project_labor_expenses WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const invoices = await query('SELECT * FROM project_invoices WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const rawDailyReports = await query('SELECT * FROM project_daily_reports WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const dailyReports = rawDailyReports.map(r => {
      let photos = [];
      let manpower_details = [];
      let equipment_details = [];
      let materials_details = [];
      try { photos = typeof r.photos === 'string' ? JSON.parse(r.photos) : (r.photos || []); } catch {}
      try { manpower_details = typeof r.manpower_details === 'string' ? JSON.parse(r.manpower_details) : (r.manpower_details || []); } catch {}
      try { equipment_details = typeof r.equipment_details === 'string' ? JSON.parse(r.equipment_details) : (r.equipment_details || []); } catch {}
      try { materials_details = typeof r.materials_details === 'string' ? JSON.parse(r.materials_details) : (r.materials_details || []); } catch {}
      return { ...r, photos, manpower_details, equipment_details, materials_details };
    });
    const weeklyReports = await query('SELECT * FROM project_weekly_reports WHERE project_id = ? ORDER BY date_to DESC, id DESC', [projectId]);
    const handovers = await query('SELECT * FROM project_handover_minutes WHERE project_id = ? ORDER BY inspection_date DESC, id DESC', [projectId]);
    const correspondence = await query('SELECT * FROM project_correspondence WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const settlement = await get('SELECT * FROM project_final_settlements WHERE project_id = ?', [projectId]);

    // الإحصائيات التراكمية المباشرة
    const totalApprovedChangeOrders = changeOrders.filter(c => c.status === 'معتمد').reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const revisedContractValue = (Number(project.contract_value) || 0) + totalApprovedChangeOrders;
    const totalPurchasesAmount = purchases.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
    const totalLaborAmount = labor.reduce((sum, l) => sum + (Number(l.total_amount) || 0), 0);
    const totalInvoicesGross = invoices.reduce((sum, i) => sum + (Number(i.current_gross_amount) || Number(i.net_amount) || 0), 0);
    const totalInvoicesNet = invoices.reduce((sum, i) => sum + (Number(i.net_amount) || 0), 0);
    const totalBoqValue = boq.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);

    res.json({
      success: true,
      data: {
        project,
        stats: {
          originalContractValue: Number(project.contract_value) || 0,
          totalApprovedChangeOrders,
          revisedContractValue,
          totalPurchasesAmount,
          totalLaborAmount,
          totalInvoicesGross,
          totalInvoicesNet,
          totalBoqValue,
          drawingsCount: drawings.length,
          dailyReportsCount: dailyReports.length,
          weeklyReportsCount: weeklyReports.length,
          handoversCount: handovers.length,
          correspondenceCount: correspondence.length,
          hasContract: !!contract,
          hasSettlement: !!settlement
        },
        contract,
        drawings,
        boq,
        quotations,
        budgets,
        changeOrders,
        purchases,
        labor,
        invoices,
        dailyReports,
        weeklyReports,
        handovers,
        correspondence,
        settlement
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المشروع الشاملة', error: err.message });
  }
});

// ============================================================================
// 1. عقد المشروع (Project Contract)
// ============================================================================
router.get('/:projectId/contract', async (req, res) => {
  try {
    const contract = await get('SELECT * FROM project_contracts WHERE project_id = ?', [req.params.projectId]);
    res.json({ success: true, data: contract });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/contract', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      contract_no, title, first_party, second_party, contract_date,
      start_date, end_date, duration_days, contract_value, currency,
      advance_payment_pct, advance_payment_amount, retention_pct,
      penalty_per_day, max_penalty_pct, payment_terms, scope_of_work,
      status, notes
    } = req.body;

    const proj = await get('SELECT client_id FROM projects WHERE id = ?', [projectId]);
    const finalClientId = req.body.client_id || (proj ? proj.client_id : null);

    const existing = await get('SELECT id FROM project_contracts WHERE project_id = ?', [projectId]);

    if (existing) {
      await run(`
        UPDATE project_contracts SET
          client_id = COALESCE(?, client_id),
          contract_no = ?, title = ?, first_party = ?, second_party = ?,
          contract_date = ?, start_date = ?, end_date = ?, duration_days = ?,
          contract_value = ?, currency = ?, advance_payment_pct = ?, advance_payment_amount = ?,
          retention_pct = ?, penalty_per_day = ?, max_penalty_pct = ?,
          payment_terms = ?, scope_of_work = ?, status = ?, notes = ?
        WHERE project_id = ?
      `, [
        finalClientId,
        contract_no, title, first_party, second_party,
        contract_date, start_date, end_date, duration_days || 0,
        Number(contract_value) || 0, currency || 'ر.ي',
        Number(advance_payment_pct) || 0, Number(advance_payment_amount) || 0,
        Number(retention_pct) || 10, Number(penalty_per_day) || 0, Number(max_penalty_pct) || 10,
        payment_terms, scope_of_work, status || 'ساري', notes, projectId
      ]);
    } else {
      await run(`
        INSERT INTO project_contracts (
          project_id, client_id, contract_no, title, first_party, second_party,
          contract_date, start_date, end_date, duration_days,
          contract_value, currency, advance_payment_pct, advance_payment_amount,
          retention_pct, penalty_per_day, max_penalty_pct,
          payment_terms, scope_of_work, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectId, finalClientId, contract_no || `CNT-${projectId}`, title, first_party, second_party,
        contract_date, start_date, end_date, duration_days || 0,
        Number(contract_value) || 0, currency || 'ر.ي',
        Number(advance_payment_pct) || 0, Number(advance_payment_amount) || 0,
        Number(retention_pct) || 10, Number(penalty_per_day) || 0, Number(max_penalty_pct) || 10,
        payment_terms, scope_of_work, status || 'ساري', notes
      ]);
    }

    // تحديث قيمة العقد وتواريخ المشروع في جدول المشاريع الأساسي
    if (contract_value) {
      await run(`
        UPDATE projects SET 
          contract_value = ?,
          start_date = COALESCE(?, start_date),
          end_date = COALESCE(?, end_date)
        WHERE id = ?
      `, [Number(contract_value), start_date, end_date, projectId]);
    }

    const saved = await get('SELECT * FROM project_contracts WHERE project_id = ?', [projectId]);
    res.json({ success: true, message: 'تم حفظ عقد المشروع وتحديث بياناته بنجاح', data: saved });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء حفظ العقد', error: err.message });
  }
});

// ============================================================================
// 2. المخططات الهندسية (Engineering Drawings)
// ============================================================================
router.get('/:projectId/drawings', async (req, res) => {
  try {
    const drawings = await query('SELECT * FROM project_drawings WHERE project_id = ? ORDER BY id DESC', [req.params.projectId]);
    res.json({ success: true, data: drawings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/drawings', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      drawing_no, title, category = 'معماري', scale = '1:100', revision = 'Rev 0',
      submission_date, approval_date, status = 'معتمد', engineer_name, file_name, notes
    } = req.body;

    if (!drawing_no || !title) {
      return res.status(400).json({ success: false, message: 'رقم المخطط وعنوانه مطلوبان' });
    }

    const result = await run(`
      INSERT INTO project_drawings (
        project_id, drawing_no, title, category, scale, revision,
        submission_date, approval_date, status, engineer_name, file_name, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, drawing_no, title, category, scale, revision,
      submission_date, approval_date, status, engineer_name, file_name, notes
    ]);

    const created = await get('SELECT * FROM project_drawings WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تمت إضافة المخطط الهندسي بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إضافة المخطط', error: err.message });
  }
});

router.put('/:projectId/drawings/:id', async (req, res) => {
  try {
    const {
      drawing_no, title, category, scale, revision,
      submission_date, approval_date, status, engineer_name, file_name, notes
    } = req.body;

    await run(`
      UPDATE project_drawings SET
        drawing_no = COALESCE(?, drawing_no),
        title = COALESCE(?, title),
        category = COALESCE(?, category),
        scale = COALESCE(?, scale),
        revision = COALESCE(?, revision),
        submission_date = COALESCE(?, submission_date),
        approval_date = COALESCE(?, approval_date),
        status = COALESCE(?, status),
        engineer_name = COALESCE(?, engineer_name),
        file_name = COALESCE(?, file_name),
        notes = COALESCE(?, notes)
      WHERE id = ? AND project_id = ?
    `, [
      drawing_no, title, category, scale, revision,
      submission_date, approval_date, status, engineer_name, file_name, notes,
      req.params.id, req.params.projectId
    ]);

    res.json({ success: true, message: 'تم تعديل المخطط الهندسي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/drawings/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_drawings WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف المخطط بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 3. جدول الكميات BOQ (Bill of Quantities) - Advanced Engine & Excel Sync
// ============================================================================
router.get('/:projectId/boq', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const boq = await query('SELECT * FROM project_boq WHERE project_id = ? ORDER BY id ASC', [projectId]);
    
    let totalContractValue = 0;
    let totalExecutedValue = 0;
    let overbilledCount = 0;
    const categoryTotals = {};

    const enriched = boq.map(b => {
      const cQty = Number(b.contract_qty) || 0;
      const eQty = Number(b.executed_qty) || 0;
      const rate = Number(b.unit_rate) || 0;
      const totalAmount = Number(b.total_amount) || (cQty * rate);
      const executedAmount = eQty * rate;
      const remainingQty = Math.max(0, cQty - eQty);
      const isOverbilled = eQty > cQty;
      const overbilledQty = isOverbilled ? (eQty - cQty) : 0;
      const progressPct = cQty > 0 ? Math.min(200, Math.round((eQty / cQty) * 100)) : (eQty > 0 ? 100 : 0);

      totalContractValue += totalAmount;
      totalExecutedValue += executedAmount;
      if (isOverbilled) overbilledCount++;

      const cat = b.category || 'أعمال عامة';
      if (!categoryTotals[cat]) categoryTotals[cat] = { count: 0, totalAmount: 0, executedAmount: 0 };
      categoryTotals[cat].count++;
      categoryTotals[cat].totalAmount += totalAmount;
      categoryTotals[cat].executedAmount += executedAmount;

      return {
        ...b,
        contract_qty: cQty,
        executed_qty: eQty,
        unit_rate: rate,
        total_amount: totalAmount,
        executed_amount: executedAmount,
        remaining_qty: remainingQty,
        is_overbilled: isOverbilled,
        overbilled_qty: overbilledQty,
        progress_pct: progressPct
      };
    });

    const overallProgress = totalContractValue > 0 ? Math.round((totalExecutedValue / totalContractValue) * 100) : 0;

    res.json({
      success: true,
      data: enriched,
      stats: {
        totalItems: enriched.length,
        totalContractValue,
        totalExecutedValue,
        remainingValue: Math.max(0, totalContractValue - totalExecutedValue),
        overallProgress,
        overbilledCount,
        categories: categoryTotals
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/boq', async (req, res) => {
  try {
    let projectId = parseInt(req.params.projectId, 10);
    if (!projectId || isNaN(projectId)) {
      projectId = parseInt(req.body.projectId || req.body.project_id, 10);
    }

    if (!projectId || isNaN(projectId) || projectId <= 0) {
      const fallbackProject = await get('SELECT id FROM projects ORDER BY id ASC LIMIT 1');
      if (fallbackProject) {
        projectId = fallbackProject.id;
      } else {
        return res.status(400).json({ success: false, message: 'معرف المشروع غير صالح أو غير محدد' });
      }
    }

    const projectExists = await get('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (!projectExists) {
      return res.status(404).json({ success: false, message: `المشروع برقم (${projectId}) غير موجود في النظام` });
    }

    const {
      item_no, description, category = 'أعمال خرسانية', unit = 'م3',
      contract_qty = 0, executed_qty = 0, unit_rate = 0, status = 'جاري التنفيذ', notes
    } = req.body;

    if (!item_no || !description) {
      return res.status(400).json({ success: false, message: 'رقم البند ووصف الأعمال مطلوبان' });
    }

    const cQty = Number(contract_qty) || 0;
    const rate = Number(unit_rate) || 0;
    const total = cQty * rate;

    const result = await run(`
      INSERT INTO project_boq (
        project_id, item_no, description, category, unit,
        contract_qty, executed_qty, unit_rate, total_amount, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, item_no, description, category, unit,
      cQty, Number(executed_qty) || 0, rate, total, status, notes
    ]);

    const created = await get('SELECT * FROM project_boq WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تمت إضافة بند جدول الكميات بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إضافة بند BOQ', error: err.message });
  }
});

// استيراد دفعة بنود كميات من Excel (Batch Import) بموثوقية عالية ومعاملات ذرية
router.post('/:projectId/boq/batch-import', async (req, res) => {
  try {
    let projectId = parseInt(req.params.projectId, 10);
    if (!projectId || isNaN(projectId)) {
      projectId = parseInt(req.body.projectId || req.body.project_id, 10);
    }

    if (!projectId || isNaN(projectId) || projectId <= 0) {
      // محاولة استرداد أول مشروع مسجل في النظام كخيار إنقاذ ذكي
      const fallbackProject = await get('SELECT id, name FROM projects ORDER BY id ASC LIMIT 1');
      if (fallbackProject) {
        projectId = fallbackProject.id;
      } else {
        return res.status(400).json({
          success: false,
          message: 'معرف المشروع غير صحيح أو غير محدد. يرجى اختيار مشروع معتمد أولاً.'
        });
      }
    }

    // التحقق الصارم من وجود المشروع في قاعدة البيانات
    const project = await get('SELECT id, name, currency FROM projects WHERE id = ?', [projectId]);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: `المشروع برقم (${projectId}) غير موجود في قاعدة البيانات.`
      });
    }

    const { items, mode = 'merge', updateContract = false } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'لم يتم توفير بنود للاستيراد' });
    }

    let insertedCount = 0;
    let updatedCount = 0;

    await transaction(async (tx) => {
      if (mode === 'replace') {
        // حماية المفاتيح الأجنبية (FK Protection): فك ارتباط طلبات الشراء والمرتجعات المرتبطة ببنود المشروع قبل الحذف
        await tx.run(`
          UPDATE purchase_requisitions 
          SET boq_item_id = NULL 
          WHERE boq_item_id IN (SELECT id FROM project_boq WHERE project_id = ?)
        `, [projectId]).catch(() => {});

        await tx.run(`
          UPDATE inventory_returns 
          SET boq_item_id = NULL 
          WHERE boq_item_id IN (SELECT id FROM project_boq WHERE project_id = ?)
        `, [projectId]).catch(() => {});

        await tx.run('DELETE FROM project_boq WHERE project_id = ?', [projectId]);
      }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const itemNo = String(it.item_no || it.code || `BOQ-${String(i + 1).padStart(3, '0')}`).trim();
        const desc = String(it.description || it.desc || it.name || 'بند أعمال').trim();
        const cat = String(it.category || it.wbs || 'أعمال إنشائية').trim();
        const unit = String(it.unit || 'م3').trim();
        const cQty = Math.max(0, Number(it.contract_qty ?? it.quantity ?? it.qty) || 0);
        const eQty = Math.max(0, Number(it.executed_qty ?? 0));
        const rate = Math.max(0, Number(it.unit_rate ?? it.price ?? it.rate) || 0);
        const total = Number(it.total_amount) || (cQty * rate);
        const notes = it.notes ? String(it.notes) : null;
        const status = eQty >= cQty && cQty > 0 ? 'مكتمل' : (eQty > 0 ? 'جاري التنفيذ' : 'لم يبدأ');

        if (mode === 'merge') {
          const existing = await tx.get('SELECT id FROM project_boq WHERE project_id = ? AND item_no = ?', [projectId, itemNo]);
          if (existing) {
            await tx.run(`
              UPDATE project_boq SET
                description = ?, category = ?, unit = ?, contract_qty = ?,
                executed_qty = ?, unit_rate = ?, total_amount = ?, status = ?, notes = ?
              WHERE id = ? AND project_id = ?
            `, [desc, cat, unit, cQty, eQty, rate, total, status, notes, existing.id, projectId]);
            updatedCount++;
            continue;
          }
        }

        await tx.run(`
          INSERT INTO project_boq (
            project_id, item_no, description, category, unit,
            contract_qty, executed_qty, unit_rate, total_amount, status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [projectId, itemNo, desc, cat, unit, cQty, eQty, rate, total, status, notes]);
        insertedCount++;
      }

      // تحديث قيمة العقد تلقائياً إذا طُلب ذلك
      const totalRow = await tx.get('SELECT SUM(total_amount) as total FROM project_boq WHERE project_id = ?', [projectId]);
      const totalVal = Number(totalRow?.total) || 0;

      if (updateContract && totalVal > 0) {
        await tx.run('UPDATE projects SET contract_value = ? WHERE id = ?', [totalVal, projectId]);
        const contractExists = await tx.get('SELECT id FROM project_contracts WHERE project_id = ?', [projectId]);
        if (contractExists) {
          await tx.run('UPDATE project_contracts SET contract_value = ? WHERE project_id = ?', [totalVal, projectId]);
        }
      }
    });

    const totalRow = await get('SELECT SUM(total_amount) as total FROM project_boq WHERE project_id = ?', [projectId]);
    const totalVal = Number(totalRow?.total) || 0;

    res.json({
      success: true,
      message: `تم استيراد ومعالجة بنود الكميات بنجاح لمشروع "${project.name}" (إدراج ${insertedCount} بند، وتحديث ${updatedCount} بند)`,
      projectId,
      projectName: project.name,
      insertedCount,
      updatedCount,
      totalCount: insertedCount + updatedCount,
      totalContractValue: totalVal
    });
  } catch (err) {
    console.error('Error in BOQ batch-import:', err);
    res.status(500).json({ success: false, message: 'فشل في استيراد جدول الكميات: ' + err.message });
  }
});

// تحديث الإنجاز السريع لبند في جدول الكميات
router.post('/:projectId/boq/quick-progress/:id', async (req, res) => {
  try {
    const { id, projectId } = req.params;
    const { executed_qty } = req.body;

    const existing = await get('SELECT * FROM project_boq WHERE id = ? AND project_id = ?', [id, projectId]);
    if (!existing) return res.status(404).json({ success: false, message: 'البند غير موجود' });

    const newExecuted = Math.max(0, Number(executed_qty) || 0);
    const status = newExecuted >= existing.contract_qty && existing.contract_qty > 0 ? 'مكتمل' : (newExecuted > 0 ? 'جاري التنفيذ' : 'لم يبدأ');

    await run('UPDATE project_boq SET executed_qty = ?, status = ? WHERE id = ? AND project_id = ?', [newExecuted, status, id, projectId]);

    const updated = await get('SELECT * FROM project_boq WHERE id = ?', [id]);
    res.json({ success: true, message: 'تم تحديث كمية الإنجاز المنفذة بنجاح', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تصدير جدول الكميات إلى ملف Excel رسمي (.xlsx)
router.get('/:projectId/boq/export-excel', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = await get('SELECT name, code FROM projects WHERE id = ?', [projectId]) || { name: 'المشروع' };
    const boq = await query('SELECT * FROM project_boq WHERE project_id = ? ORDER BY id ASC', [projectId]);

    const rows = [
      ['شركة رواسي عدن للهندسة والمقاولات'],
      [`جدول الكميات والمواصفات التعاقدية (BOQ) - مشروع: ${project.name}`],
      [`تاريخ التصدير: ${new Date().toISOString().split('T')[0]}`],
      [], // سطر فارغ
      ['م', 'رقم البند', 'التصنيف الإنشائي (WBS)', 'بيان الأعمال والمواصفات', 'الوحدة', 'الكمية التعاقدية', 'الكمية المنفذة', 'الكمية المتبقية', 'فئة السعر', 'الإجمالي التعاقدي', 'القيمة المنفذة', 'نسبة الإنجاز', 'الحالة', 'ملاحظات']
    ];

    let totalContract = 0;
    let totalExecuted = 0;

    boq.forEach((b, idx) => {
      const cQty = Number(b.contract_qty) || 0;
      const eQty = Number(b.executed_qty) || 0;
      const rate = Number(b.unit_rate) || 0;
      const cTotal = Number(b.total_amount) || (cQty * rate);
      const eTotal = eQty * rate;
      const rem = Math.max(0, cQty - eQty);
      const pct = cQty > 0 ? Math.round((eQty / cQty) * 100) + '%' : '0%';

      totalContract += cTotal;
      totalExecuted += eTotal;

      rows.push([
        idx + 1,
        b.item_no,
        b.category || 'عام',
        b.description,
        b.unit,
        cQty,
        eQty,
        rem,
        rate,
        cTotal,
        eTotal,
        pct,
        b.status || 'جاري التنفيذ',
        b.notes || ''
      ]);
    });

    // سطر المجموع النهائي
    rows.push([
      'المجموع', '', '', 'إجمالي قيمة جدول الكميات التعاقدي', '', '', '', '', '',
      totalContract,
      totalExecuted,
      totalContract > 0 ? Math.round((totalExecuted / totalContract) * 100) + '%' : '0%',
      '', ''
    ]);

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // تفعيل اتجاه RTL من اليمين لليسار
    if (!ws['!views']) ws['!views'] = [];
    ws['!views'].push({ RTL: true });

    // تحديد عروض الأعمدة
    ws['!cols'] = [
      { wch: 5 },  // م
      { wch: 12 }, // رقم البند
      { wch: 20 }, // التصنيف
      { wch: 45 }, // البيان
      { wch: 8 },  // الوحدة
      { wch: 14 }, // الكمية التعاقدية
      { wch: 14 }, // الكمية المنفذة
      { wch: 14 }, // المتبقي
      { wch: 14 }, // فئة السعر
      { wch: 18 }, // الإجمالي التعاقدي
      { wch: 18 }, // القيمة المنفذة
      { wch: 12 }, // نسبة الإنجاز
      { wch: 14 }, // الحالة
      { wch: 25 }  // ملاحظات
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'جدول الكميات BOQ');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `BOQ_${(project.name || 'Project').replace(/[^\w\u0621-\u064A]/g, '_')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (err) {
    console.error('Error exporting BOQ to Excel:', err);
    res.status(500).json({ success: false, message: 'فشل في تصدير ملف Excel: ' + err.message });
  }
});

// تنزيل نموذج وقالب Excel فارغ ومجهز لجدول الكميات (Sample BOQ Template)
router.get('/:projectId/boq/sample-template', async (req, res) => {
  try {
    const templateRows = [
      ['رقم البند', 'التصنيف الإنشائي', 'بيان ووصف بند العمل والمواصفات', 'الوحدة', 'الكمية', 'فئة السعر الإفرادي', 'ملاحظات'],
      ['1.01', 'أعمال الحفريات والردم', 'حفر في تربة صخرية ومتوسطة لتأسيس القواعد حتى المنسوب المعتمد شاملاً نقل المخلفات', 'م3', 450, 3500, 'يشمل النقل لمقالب عمومية'],
      ['1.02', 'أعمال الحفريات والردم', 'ردم حول القواعد والميدات برمل نظيف على طبقات 25 سم مع الرش والدمك بنسبة 95%', 'م3', 280, 1800, 'اختبار بروكتور مطلوب'],
      ['2.01', 'أعمال خرسانية', 'خرسانة عادية نظافة أسفل القواعد سمك 10 سم مقاومة 200 كجم/سم2', 'م3', 45, 18500, 'إسمنت مقاوم للكبريتات SRC'],
      ['2.02', 'أعمال خرسانية', 'خرسانة مسلحة للقواعد والرقاب مقاومة 350 كجم/سم2 مع المواد وحديد التسليح', 'م3', 120, 48000, 'حديد سابك رتبة 60'],
      ['2.03', 'أعمال خرسانية', 'خرسانة مسلحة للأعمدة والحوائط الخرسانية مقاومة 350 كجم/سم2', 'م3', 65, 52000, 'صب بالمضخة وتثبيت كانات'],
      ['2.04', 'أعمال خرسانية', 'خرسانة مسلحة للأسقف والكمرات الهوردي شاملاً القوالب والبلوك الهوردي والحديد', 'م3', 160, 54000, 'معالجة بالمياه 7 أيام'],
      ['3.01', 'أعمال مباني وعزل', 'مباني طابوق أسمنتي مصمت للميدات سمك 20 سم بمونة إسمنتية 1:3', 'م2', 320, 2400, 'طابوق آلي عالي الكثافة'],
      ['3.02', 'أعمال مباني وعزل', 'مباني طابوق أسمنتي مفرغ للقواطع الداخلية والخارجية سمك 20 سم', 'م2', 850, 1950, 'ربط بشبك مجلفن كل مدماكين'],
      ['3.03', 'أعمال مباني وعزل', 'عزل مائي للقواعد ورقاب الأعمدة بطبقتين من البيتومين المطاطي على البارد', 'م2', 540, 650, 'دهان متعامد'],
      ['4.01', 'أعمال تشطيبات', 'بياض ولياسة إسمنتية داخلية للأسقف والحوائط مع الطرطشة والشبك المعدني', 'م2', 1800, 1200, 'استواء تام ووزن قامة'],
      ['4.02', 'أعمال تشطيبات', 'دهانات بلاستيكية داخلية 3 أوجه مقاومة للبكتيريا شاملاً المعجون والأساس', 'م2', 1800, 950, 'نوع جوتن أو ما يماثله'],
      ['5.01', 'أعمال كهروميكانيكية', 'توريد وتمديد مواسير PVC وأسلاك النحاس للإنارة والمخارج لكل نقطة كاملة', 'نقطة', 240, 3200, 'أسلاك الرياض أو كابلات بحرة'],
      ['5.02', 'أعمال كهروميكانيكية', 'تمديد خطوط الصرف الصحي ومواسير التغذية PPR الحرارية لكل حمام ومطبخ', 'مقطوع', 8, 45000, 'مواسير ألمانية معتمدة']
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateRows);
    if (!ws['!views']) ws['!views'] = [];
    ws['!views'].push({ RTL: true });

    ws['!cols'] = [
      { wch: 12 }, // رقم البند
      { wch: 22 }, // التصنيف
      { wch: 55 }, // البيان
      { wch: 10 }, // الوحدة
      { wch: 14 }, // الكمية
      { wch: 18 }, // فئة السعر
      { wch: 30 }  // ملاحظات
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'قالب جدول كميات نموذجي');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="BOQ_Template_Rawasi_Aden.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('Error sending BOQ template:', err);
    res.status(500).json({ success: false, message: 'فشل في إنشاء قالب Excel: ' + err.message });
  }
});

router.put('/:projectId/boq/:id', async (req, res) => {
  try {
    const {
      item_no, description, category, unit,
      contract_qty, executed_qty, unit_rate, status, notes
    } = req.body;

    const existing = await get('SELECT * FROM project_boq WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    if (!existing) return res.status(404).json({ success: false, message: 'البند غير موجود' });

    const cQty = contract_qty !== undefined ? Number(contract_qty) : existing.contract_qty;
    const rate = unit_rate !== undefined ? Number(unit_rate) : existing.unit_rate;
    const total = cQty * rate;

    await run(`
      UPDATE project_boq SET
        item_no = COALESCE(?, item_no),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        contract_qty = ?,
        executed_qty = COALESCE(?, executed_qty),
        unit_rate = ?,
        total_amount = ?,
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
      WHERE id = ? AND project_id = ?
    `, [
      item_no, description, category, unit,
      cQty, executed_qty !== undefined ? Number(executed_qty) : null,
      rate, total, status, notes, req.params.id, req.params.projectId
    ]);

    res.json({ success: true, message: 'تم تحديث بند جدول الكميات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/boq/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_boq WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف البند بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4. عروض الأسعار (Quotations & Price Offers)
// ============================================================================
router.get('/:projectId/quotations', async (req, res) => {
  try {
    const quotations = await query(`
      SELECT q.*, c.name as client_name, c.company as client_company
      FROM project_quotations q
      LEFT JOIN clients c ON q.client_id = c.id
      WHERE q.project_id = ? OR q.project_id IS NULL
      ORDER BY q.id DESC
    `, [req.params.projectId]);
    res.json({ success: true, data: quotations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/quotations', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      quotation_no, client_id, title, date, valid_until,
      items_json, subtotal = 0, discount = 0, tax_vat = 0, total_amount = 0,
      currency = 'ر.ي', payment_terms, delivery_period, status = 'مسودة', notes
    } = req.body;

    const countRes = await get('SELECT COUNT(*) as cnt FROM project_quotations');
    const autoNo = quotation_no || `QUO-2024-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = await run(`
      INSERT INTO project_quotations (
        project_id, client_id, quotation_no, title, date, valid_until,
        items_json, subtotal, discount, tax_vat, total_amount,
        currency, payment_terms, delivery_period, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, client_id ? Number(client_id) : null, autoNo, title, date || new Date().toISOString().split('T')[0],
      valid_until, typeof items_json === 'object' ? JSON.stringify(items_json) : items_json,
      Number(subtotal) || 0, Number(discount) || 0, Number(tax_vat) || 0, Number(total_amount) || 0,
      currency, payment_terms, delivery_period, status, notes
    ]);

    const created = await get('SELECT * FROM project_quotations WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم حفظ عرض السعر بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إنشاء عرض السعر', error: err.message });
  }
});

router.put('/:projectId/quotations/:id', async (req, res) => {
  try {
    const {
      title, client_id, date, valid_until, items_json,
      subtotal, discount, tax_vat, total_amount, currency,
      payment_terms, delivery_period, status, notes
    } = req.body;

    await run(`
      UPDATE project_quotations SET
        title = COALESCE(?, title),
        client_id = COALESCE(?, client_id),
        date = COALESCE(?, date),
        valid_until = COALESCE(?, valid_until),
        items_json = COALESCE(?, items_json),
        subtotal = COALESCE(?, subtotal),
        discount = COALESCE(?, discount),
        tax_vat = COALESCE(?, tax_vat),
        total_amount = COALESCE(?, total_amount),
        currency = COALESCE(?, currency),
        payment_terms = COALESCE(?, payment_terms),
        delivery_period = COALESCE(?, delivery_period),
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `, [
      title, client_id, date, valid_until,
      typeof items_json === 'object' ? JSON.stringify(items_json) : items_json,
      subtotal, discount, tax_vat, total_amount, currency,
      payment_terms, delivery_period, status, notes, req.params.id
    ]);

    res.json({ success: true, message: 'تم تحديث عرض السعر بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/quotations/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_quotations WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'تم حذف عرض السعر بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 5. الميزانية والتكلفة المستهدفة (Budget & Target Cost)
// ============================================================================
router.get('/:projectId/budgets', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const budgets = await query('SELECT * FROM project_budgets WHERE project_id = ? ORDER BY id ASC', [projectId]);
    res.json({ success: true, data: budgets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/budgets', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { category, planned_cost = 0, actual_cost = 0, notes } = req.body;

    if (!category) return res.status(400).json({ success: false, message: 'تصنيف الميزانية مطلوب' });

    const result = await run(`
      INSERT INTO project_budgets (project_id, category, planned_cost, actual_cost, notes)
      VALUES (?, ?, ?, ?, ?)
    `, [projectId, category, Number(planned_cost) || 0, Number(actual_cost) || 0, notes]);

    const created = await get('SELECT * FROM project_budgets WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تمت إضافة مركز الميزانية بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:projectId/budgets/:id', async (req, res) => {
  try {
    const { category, planned_cost, actual_cost, notes } = req.body;
    await run(`
      UPDATE project_budgets SET
        category = COALESCE(?, category),
        planned_cost = COALESCE(?, planned_cost),
        actual_cost = COALESCE(?, actual_cost),
        notes = COALESCE(?, notes)
      WHERE id = ? AND project_id = ?
    `, [category, planned_cost, actual_cost, notes, req.params.id, req.params.projectId]);

    res.json({ success: true, message: 'تم تحديث مركز الميزانية بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/budgets/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_budgets WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف بند الميزانية بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 6. أوامر التغيير والإضافيات (Change Orders & Variations)
// ============================================================================
router.get('/:projectId/change-orders', async (req, res) => {
  try {
    const orders = await query('SELECT * FROM project_change_orders WHERE project_id = ? ORDER BY id DESC', [req.params.projectId]);
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/change-orders', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      change_no, title, type = 'إضافة بند جديد', request_date, approval_date,
      amount = 0, time_extension_days = 0, reason = 'طلب المالك',
      status = 'معتمد', requested_by, approved_by, notes
    } = req.body;

    if (!title) return res.status(400).json({ success: false, message: 'عنوان أمر التغيير مطلوب' });

    const countRes = await get('SELECT COUNT(*) as cnt FROM project_change_orders WHERE project_id = ?', [projectId]);
    const autoNo = change_no || `CO-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = await run(`
      INSERT INTO project_change_orders (
        project_id, change_no, title, type, request_date, approval_date,
        amount, time_extension_days, reason, status, requested_by, approved_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, title, type, request_date || new Date().toISOString().split('T')[0],
      approval_date, Number(amount) || 0, Number(time_extension_days) || 0,
      reason, status, requested_by, approved_by, notes
    ]);

    const created = await get('SELECT * FROM project_change_orders WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم حفظ أمر التغيير بنجاح وتحديث حسابات المشروع', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:projectId/change-orders/:id', async (req, res) => {
  try {
    const {
      change_no, title, type, request_date, approval_date,
      amount, time_extension_days, reason, status, requested_by, approved_by, notes
    } = req.body;

    await run(`
      UPDATE project_change_orders SET
        change_no = COALESCE(?, change_no),
        title = COALESCE(?, title),
        type = COALESCE(?, type),
        request_date = COALESCE(?, request_date),
        approval_date = COALESCE(?, approval_date),
        amount = COALESCE(?, amount),
        time_extension_days = COALESCE(?, time_extension_days),
        reason = COALESCE(?, reason),
        status = COALESCE(?, status),
        requested_by = COALESCE(?, requested_by),
        approved_by = COALESCE(?, approved_by),
        notes = COALESCE(?, notes)
      WHERE id = ? AND project_id = ?
    `, [
      change_no, title, type, request_date, approval_date,
      amount, time_extension_days, reason, status, requested_by, approved_by, notes,
      req.params.id, req.params.projectId
    ]);

    res.json({ success: true, message: 'تم تعديل أمر التغيير بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/change-orders/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_change_orders WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف أمر التغيير بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 7. مشتريات وفواتير المشروع (Project Purchases)
// ============================================================================
router.get('/:projectId/purchases', async (req, res) => {
  try {
    const purchases = await query(`
      SELECT pp.*, s.name as supplier_full_name, s.phone as supplier_phone
      FROM project_purchases pp
      LEFT JOIN suppliers s ON pp.supplier_id = s.id
      WHERE pp.project_id = ?
      ORDER BY pp.date DESC, pp.id DESC
    `, [req.params.projectId]);
    res.json({ success: true, data: purchases });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/purchases', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      invoice_no, supplier_id, supplier_name, item_description,
      quantity = 1, unit, unit_price = 0, total_amount, paid_amount = 0,
      payment_status = 'مدفوع', payment_method = 'نقدي', date, receipt_no, notes
    } = req.body;

    if (!item_description) return res.status(400).json({ success: false, message: 'وصف المواد المشتراة مطلوب' });

    const qty = Number(quantity) || 1;
    const price = Number(unit_price) || 0;
    const total = total_amount ? Number(total_amount) : (qty * price);

    const result = await run(`
      INSERT INTO project_purchases (
        project_id, invoice_no, supplier_id, supplier_name, item_description,
        quantity, unit, unit_price, total_amount, paid_amount,
        payment_status, payment_method, date, receipt_no, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, invoice_no, supplier_id ? Number(supplier_id) : null, supplier_name, item_description,
      qty, unit, price, total, Number(paid_amount) || 0,
      payment_status, payment_method, date || new Date().toISOString().split('T')[0], receipt_no, notes
    ]);

    // تسجيل مصروف آلي مرتبط بالمشروع إذا كان مدفوعاً
    if (Number(paid_amount) > 0) {
      const expReceipt = receipt_no || `EXP-PUR-${result.lastInsertRowid}`;
      await run(`
        INSERT INTO expenses (receipt_no, expense_type, project_id, supplier_id, amount, payment_method, date, notes)
        VALUES (?, 'مواد بناء', ?, ?, ?, ?, ?, ?)
      `, [expReceipt, projectId, supplier_id ? Number(supplier_id) : null, Number(paid_amount), payment_method, date || new Date().toISOString().split('T')[0], `فاتورة مشتريات: ${item_description}`]);
    }

    const created = await get('SELECT * FROM project_purchases WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم حفظ فاتورة المشتريات وتحديث تكلفة المشروع بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/purchases/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_purchases WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف الفاتورة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 8. العمالة والمصروفات الميدانية (Labor & Site Expenses)
// ============================================================================
router.get('/:projectId/labor', async (req, res) => {
  try {
    const labor = await query('SELECT * FROM project_labor_expenses WHERE project_id = ? ORDER BY date DESC, id DESC', [req.params.projectId]);
    res.json({ success: true, data: labor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/labor', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      date, worker_name_or_team, trade = 'نجار مسلح', workers_count = 1,
      daily_rate = 0, days_or_hours = 1, total_amount, expense_category = 'أجور عمالة',
      payment_status = 'مدفوع', supervisor_name, notes
    } = req.body;

    if (!worker_name_or_team) return res.status(400).json({ success: false, message: 'اسم العامل أو الطاقم مطلوب' });

    const count = Number(workers_count) || 1;
    const rate = Number(daily_rate) || 0;
    const days = Number(days_or_hours) || 1;
    const total = total_amount ? Number(total_amount) : (count * rate * days);

    const result = await run(`
      INSERT INTO project_labor_expenses (
        project_id, date, worker_name_or_team, trade, workers_count,
        daily_rate, days_or_hours, total_amount, expense_category,
        payment_status, supervisor_name, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, date || new Date().toISOString().split('T')[0], worker_name_or_team, trade,
      count, rate, days, total, expense_category, payment_status, supervisor_name, notes
    ]);

    // تسجيل مصروف آلي في جدول المصروفات العام
    if (payment_status === 'مدفوع' && total > 0) {
      const expReceipt = `EXP-LAB-${result.lastInsertRowid}`;
      await run(`
        INSERT INTO expenses (receipt_no, expense_type, project_id, amount, payment_method, date, notes)
        VALUES (?, 'أجور عمالة', ?, ?, 'نقدي', ?, ?)
      `, [expReceipt, projectId, total, date || new Date().toISOString().split('T')[0], `أجور ${trade}: ${worker_name_or_team}`]);
    }

    const created = await get('SELECT * FROM project_labor_expenses WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم تسجيل أجور العمالة والمصروف الميداني بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/labor/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_labor_expenses WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف السجل بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 9. مستخلصات وشهادات دفع المشروع (FIDIC Interim Payment Certificates - IPC)
// ============================================================================
router.get('/:projectId/invoices', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = await get('SELECT name, code, currency, client_name, contract_value FROM projects WHERE id = ?', [projectId]) || {};
    const invoices = await query(`
      SELECT pi.*, c.name as client_name, c.phone as client_phone
      FROM project_invoices pi
      LEFT JOIN clients c ON pi.client_id = c.id
      WHERE pi.project_id = ?
      ORDER BY pi.date DESC, pi.id DESC
    `, [projectId]);

    const enriched = invoices.map(i => {
      let items = [];
      try {
        if (i.items_json) items = JSON.parse(i.items_json);
      } catch (e) {}

      const net = Number(i.net_amount) || 0;
      const curr = project.currency || 'ر.ي';
      let tafqeetText = '';
      try {
        tafqeetText = tafqeet(net, curr);
      } catch (e) {
        tafqeetText = `${net} ${curr}`;
      }

      return {
        ...i,
        items,
        items_count: items.length,
        tafqeet: tafqeetText
      };
    });

    res.json({
      success: true,
      data: enriched,
      project
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تجهيز مسودة مستخلص تلقائياً بالاعتماد على جدول الكميات BOQ والمستخلصات السابقة
router.get('/:projectId/invoices/prepare-from-boq', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = await get('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (!project) return res.status(404).json({ success: false, message: 'المشروع غير موجود' });

    const contract = await get('SELECT * FROM project_contracts WHERE project_id = ?', [projectId]) || {};
    const prevInvoices = await query("SELECT * FROM project_invoices WHERE project_id = ? AND status != 'ملغي' ORDER BY id ASC", [projectId]);
    const boqItems = await query('SELECT * FROM project_boq WHERE project_id = ? ORDER BY id ASC', [projectId]);

    // حساب إجمالي المستخلصات السابقة
    let totalPrevGross = 0;
    let totalPrevNet = 0;
    const itemPreviousQuantities = {};

    prevInvoices.forEach(inv => {
      totalPrevGross += Number(inv.current_gross_amount) || 0;
      totalPrevNet += Number(inv.net_amount) || 0;

      if (inv.items_json) {
        try {
          const parsed = JSON.parse(inv.items_json);
          parsed.forEach(it => {
            const key = it.boq_item_id || it.item_no;
            itemPreviousQuantities[key] = Math.max(itemPreviousQuantities[key] || 0, Number(it.cumulative_qty) || Number(it.quantity) || 0);
          });
        } catch (e) {}
      }
    });

    const nextNo = `IPC-${String(prevInvoices.length + 1).padStart(2, '0')}`;
    const advancePct = Number(contract.advance_payment_pct) || 10;
    const retentionPct = Number(contract.retention_pct) || 10;

    // تجهيز بنود جدول الكميات مع الكميات السابقة والمنفذة
    const preparedItems = boqItems.map(b => {
      const cQty = Number(b.contract_qty) || 0;
      const rate = Number(b.unit_rate) || 0;
      const siteExecQty = Number(b.executed_qty) || 0;
      const prevQty = itemPreviousQuantities[b.id] !== undefined ? itemPreviousQuantities[b.id] : (itemPreviousQuantities[b.item_no] || 0);
      const currentQty = Math.max(0, siteExecQty - prevQty);
      const cumQty = prevQty + currentQty;

      return {
        boq_item_id: b.id,
        item_no: b.item_no,
        description: b.description,
        category: b.category,
        unit: b.unit,
        contract_qty: cQty,
        unit_rate: rate,
        contract_total: cQty * rate,
        previous_qty: prevQty,
        previous_amount: prevQty * rate,
        current_qty: currentQty,
        current_amount: currentQty * rate,
        cumulative_qty: cumQty,
        cumulative_amount: cumQty * rate,
        completion_pct: cQty > 0 ? Math.min(100, Math.round((cumQty / cQty) * 100)) : 0
      };
    });

    const currentGrossSum = preparedItems.reduce((acc, it) => acc + it.current_amount, 0);
    const cumulativeWorkSum = totalPrevGross + currentGrossSum;
    const advanceDeduction = (currentGrossSum * advancePct) / 100;
    const retentionDeduction = (currentGrossSum * retentionPct) / 100;
    const netDue = Math.max(0, currentGrossSum - (advanceDeduction + retentionDeduction));

    res.json({
      success: true,
      draft: {
        invoice_no: nextNo,
        invoice_type: 'مستخلص جاري',
        period_from: project.start_date || new Date().toISOString().split('T')[0],
        period_to: new Date().toISOString().split('T')[0],
        contract_value: Number(contract.contract_value) || Number(project.contract_value) || 0,
        previous_bills_amount: totalPrevGross,
        current_gross_amount: currentGrossSum,
        cumulative_work_done: cumulativeWorkSum,
        advance_pct: advancePct,
        advance_deduction: advanceDeduction,
        retention_pct: retentionPct,
        retention_deduction: retentionDeduction,
        other_deductions: 0,
        net_amount: netDue,
        items: preparedItems,
        currency: project.currency || 'ر.ي'
      }
    });
  } catch (err) {
    console.error('Error preparing IPC draft from BOQ:', err);
    res.status(500).json({ success: false, message: 'فشل في توليد مسودة المستخلص: ' + err.message });
  }
});

// استعراض مستخلص فردي كامل بالتفاصيل
router.get('/:projectId/invoices/:id', async (req, res) => {
  try {
    const { projectId, id } = req.params;
    const invoice = await get('SELECT * FROM project_invoices WHERE id = ? AND project_id = ?', [id, projectId]);
    if (!invoice) return res.status(404).json({ success: false, message: 'المستخلص غير موجود' });

    const project = await get('SELECT * FROM projects WHERE id = ?', [projectId]) || {};
    const contract = await get('SELECT * FROM project_contracts WHERE project_id = ?', [projectId]) || {};

    let items = [];
    try {
      if (invoice.items_json) items = JSON.parse(invoice.items_json);
    } catch (e) {}

    const curr = project.currency || 'ر.ي';
    let tafqeetText = '';
    try {
      tafqeetText = tafqeet(invoice.net_amount, curr);
    } catch (e) {
      tafqeetText = `${invoice.net_amount} ${curr}`;
    }

    res.json({
      success: true,
      data: {
        ...invoice,
        items,
        tafqeet: tafqeetText,
        project,
        contract
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/invoices', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      client_id, invoice_no, invoice_type = 'مستخلص جاري', period_from, period_to,
      cumulative_work_done = 0, previous_bills_amount = 0, current_gross_amount = 0,
      advance_pct = 10, advance_deduction = 0,
      retention_pct = 10, retention_deduction = 0,
      tax_wht_pct = 0, tax_wht_amount = 0,
      other_deductions = 0,
      net_amount, status = 'معتمد للصرف', date, approval_date, notes,
      items = []
    } = req.body;

    const countRes = await get('SELECT COUNT(*) as cnt FROM project_invoices WHERE project_id = ?', [projectId]);
    const autoNo = invoice_no || `IPC-${String((countRes?.cnt || 0) + 1).padStart(2, '0')}`;

    const gross = Number(current_gross_amount) || (Number(cumulative_work_done) - Number(previous_bills_amount));
    const deductions = (Number(advance_deduction) || 0) + (Number(retention_deduction) || 0) + (Number(other_deductions) || 0) + (Number(tax_wht_amount) || 0);
    const calculatedNet = net_amount !== undefined ? Number(net_amount) : Math.max(0, gross - deductions);

    const itemsJson = items && Array.isArray(items) && items.length > 0 ? JSON.stringify(items) : null;

    const result = await run(`
      INSERT INTO project_invoices (
        project_id, client_id, invoice_no, invoice_type, period_from, period_to,
        cumulative_work_done, previous_bills_amount, current_gross_amount,
        advance_pct, advance_deduction, retention_pct, retention_deduction,
        tax_wht_pct, tax_wht_amount, other_deductions, net_amount,
        status, date, approval_date, notes, items_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, client_id ? Number(client_id) : null, autoNo, invoice_type, period_from, period_to,
      Number(cumulative_work_done) || gross, Number(previous_bills_amount) || 0, gross,
      Number(advance_pct) || 0, Number(advance_deduction) || 0,
      Number(retention_pct) || 0, Number(retention_deduction) || 0,
      Number(tax_wht_pct) || 0, Number(tax_wht_amount) || 0,
      Number(other_deductions) || 0, calculatedNet,
      status, date || new Date().toISOString().split('T')[0], approval_date, notes, itemsJson
    ]);

    // إذا تم تزويد بنود، نقوم بتحديث الكميات المنفذة في جدول الكميات BOQ لمزامنة الإنجاز
    if (items && Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        if (it.boq_item_id && it.cumulative_qty !== undefined) {
          const cumQty = Number(it.cumulative_qty) || 0;
          await run(`
            UPDATE project_boq SET
              executed_qty = MAX(executed_qty, ?),
              status = CASE WHEN contract_qty > 0 AND ? >= contract_qty THEN 'مكتمل' ELSE 'جاري التنفيذ' END
            WHERE id = ? AND project_id = ?
          `, [cumQty, cumQty, it.boq_item_id, projectId]);
        }
      }
    }

    // جلب العقد والعميل المرتبط بالمشروع إذا لم يحددوا بدقة
    const contract = await get('SELECT * FROM project_contracts WHERE project_id = ? LIMIT 1', [projectId]);
    const effectiveClientId = client_id ? Number(client_id) : (contract?.client_id || (await get('SELECT client_id FROM projects WHERE id = ?', [projectId]))?.client_id || null);
    const effectiveContractId = contract?.id || null;

    // مزامنة مع جدول bills العام وربط السلسلة الهرمية
    await run(`
      INSERT INTO bills (
        bill_no, bill_type, project_id, contract_id, client_id,
        amount, gross_amount, advance_deduction, retention_deduction, deduction,
        net_amount, paid_amount, remaining_amount, payment_status,
        status, date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?)
    `, [
      autoNo, `${invoice_type} (${autoNo})`, projectId, effectiveContractId, effectiveClientId,
      calculatedNet, gross, Number(advance_deduction) || 0, Number(retention_deduction) || 0, deductions,
      calculatedNet, calculatedNet, status, date || new Date().toISOString().split('T')[0], notes
    ]);

    // التأثير التلقائي اللحظي في حساب ورصيد العميل
    if (effectiveClientId) {
      await clientChainService.syncClientBalances(effectiveClientId);
    }

    const created = await get('SELECT * FROM project_invoices WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم إصدار واعتماد شهادة المستخلص بنجاح 📑', data: created });
  } catch (err) {
    console.error('Error creating project invoice:', err);
    res.status(500).json({ success: false, message: 'خطأ في إنشاء المستخلص: ' + err.message });
  }
});

// تصدير تفاصيل المستخلص وشهادة الدفع إلى ملف Excel رسمي
router.get('/:projectId/invoices/:id/export-excel', async (req, res) => {
  try {
    const { projectId, id } = req.params;
    const inv = await get('SELECT * FROM project_invoices WHERE id = ? AND project_id = ?', [id, projectId]);
    if (!inv) return res.status(404).json({ success: false, message: 'المستخلص غير موجود' });

    const project = await get('SELECT * FROM projects WHERE id = ?', [projectId]) || { name: 'المشروع' };
    const contract = await get('SELECT * FROM project_contracts WHERE project_id = ?', [projectId]) || {};

    let items = [];
    try {
      if (inv.items_json) items = JSON.parse(inv.items_json);
    } catch (e) {}

    const curr = project.currency || 'ر.ي';

    // 1. ورقة الشهادة والملخص المالي
    const summaryRows = [
      ['شركة رواسي عدن للهندسة والمقاولات'],
      [`شهادة الدفع والمستخلص الجاري المعتمد (Interim Payment Certificate - IPC)`],
      [`رقم المستخلص: ${inv.invoice_no}`, `تاريخ الاعتماد: ${inv.date}`, `المشروع: ${project.name}`],
      [`المالك: ${project.client_name || inv.client_name || '-'}`, `المقاول: شركة رواسي عدن`, `الاستشاري المشرف: الإدارة الفنية والهندسية`],
      [`الفترة من: ${inv.period_from || '-'} إلى: ${inv.period_to || '-'}`],
      [],
      ['البيان الهندسي والمحاسبي المعتمد', 'المبلغ (' + curr + ')', 'النسبة / الملاحظات'],
      ['القيمة التعاقدية المعتمدة للمشروع', Number(contract.contract_value) || Number(project.contract_value) || 0, 'قيمة العقد الأصلية'],
      ['إجمالي قيمة الأعمال المنفذة التراكمية حتى تاريخه', Number(inv.cumulative_work_done) || 0, 'إجمالي الأعمال السابقة + الحالية'],
      ['يُخصم: إجمالي المستخلصات السابقة المصروفة', -(Number(inv.previous_bills_amount) || 0), 'قيمة ما تم صرفه سابقاً'],
      ['قيمة الأعمال المنجزة خلال هذا المستخلص (Gross Work)', Number(inv.current_gross_amount) || 0, 'إجمالي الأعمال الحالية'],
      ['يُخصم: استهلاك الدفعة المقدمة', -(Number(inv.advance_deduction) || 0), `بنسبة ${inv.advance_pct || 10}%`],
      ['يُخصم: محتجزات ضمان حسن التنفيذ (Retention)', -(Number(inv.retention_deduction) || 0), `بنسبة ${inv.retention_pct || 10}%`],
      ['يُخصم: استقطاعات وغرامات أخرى', -(Number(inv.other_deductions) || 0), 'خصميات أو مواد موردة'],
      ['صافي المبلغ المعتمد والمستحق للصرف للمقاول (Net Payable)', Number(inv.net_amount) || 0, 'المبلغ الصافي للصرف'],
      [],
      ['التفقيط المالي بالحروف:', tafqeet(inv.net_amount, curr)],
      [],
      ['التوقيعات والاعتمادات الرسمية:'],
      ['مهندس الموقع والمكتب الفني', 'مدير المشروع', 'المهندس الاستشاري المشرف', 'المالك / صاحب العمل']
    ];

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    if (!wsSummary['!views']) wsSummary['!views'] = [];
    wsSummary['!views'].push({ RTL: true });
    wsSummary['!cols'] = [{ wch: 45 }, { wch: 22 }, { wch: 28 }, { wch: 25 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, 'شهادة الدفع');

    // 2. ورقة تفريغ بنود جدول الكميات التفصيلية إذا توفرت
    if (items.length > 0) {
      const itemsRows = [
        ['شركة رواسي عدن للهندسة والمقاولات'],
        [`كشف حصر وتفريغ كميات المستخلص رقم (${inv.invoice_no}) - مشروع: ${project.name}`],
        [],
        ['م', 'رقم البند', 'بيان الأعمال والمواصفات', 'الوحدة', 'فئة السعر', 'كمية العقد', 'كمية سابقة', 'كمية حالية', 'إجمالي الكمية', 'قيمة سابقة', 'قيمة حالية', 'إجمالي القيمة', 'نسبة الإنجاز']
      ];

      items.forEach((it, idx) => {
        itemsRows.push([
          idx + 1,
          it.item_no,
          it.description,
          it.unit,
          it.unit_rate,
          it.contract_qty,
          it.previous_qty || 0,
          it.current_qty || 0,
          it.cumulative_qty || (Number(it.previous_qty || 0) + Number(it.current_qty || 0)),
          it.previous_amount || 0,
          it.current_amount || 0,
          it.cumulative_amount || 0,
          `${it.completion_pct || 0}%`
        ]);
      });

      // سطر المجموع
      itemsRows.push([
        'المجموع', '', 'إجمالي الأعمال المنفذة في هذا المستخلص', '', '', '', '', '', '',
        items.reduce((s, it) => s + (Number(it.previous_amount) || 0), 0),
        items.reduce((s, it) => s + (Number(it.current_amount) || 0), 0),
        items.reduce((s, it) => s + (Number(it.cumulative_amount) || 0), 0),
        ''
      ]);

      const wsItems = XLSX.utils.aoa_to_sheet(itemsRows);
      if (!wsItems['!views']) wsItems['!views'] = [];
      wsItems['!views'].push({ RTL: true });
      wsItems['!cols'] = [
        { wch: 5 }, { wch: 12 }, { wch: 45 }, { wch: 8 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
        { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 12 }
      ];
      XLSX.utils.book_append_sheet(wb, wsItems, 'تفاصيل بنود المستخلص');
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `IPC_${inv.invoice_no}_${(project.name || 'Project').replace(/[^\w\u0621-\u064A]/g, '_')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error exporting IPC to Excel:', err);
    res.status(500).json({ success: false, message: 'فشل في تصدير ملف المستخلص: ' + err.message });
  }
});

router.delete('/:projectId/invoices/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_invoices WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف المستخلص بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 10. التقارير اليومية للموقع (Daily Site Reports - Advanced Field Diary)
// ============================================================================
router.get('/:projectId/daily-reports', async (req, res) => {
  try {
    const reports = await query('SELECT * FROM project_daily_reports WHERE project_id = ? ORDER BY date DESC, id DESC', [req.params.projectId]);
    const parsed = reports.map(r => {
      let photos = [];
      let manpower_details = [];
      let equipment_details = [];
      let materials_details = [];
      try { photos = typeof r.photos === 'string' ? JSON.parse(r.photos) : (r.photos || []); } catch {}
      try { manpower_details = typeof r.manpower_details === 'string' ? JSON.parse(r.manpower_details) : (r.manpower_details || []); } catch {}
      try { equipment_details = typeof r.equipment_details === 'string' ? JSON.parse(r.equipment_details) : (r.equipment_details || []); } catch {}
      try { materials_details = typeof r.materials_details === 'string' ? JSON.parse(r.materials_details) : (r.materials_details || []); } catch {}
      return {
        ...r,
        photos,
        manpower_details,
        equipment_details,
        materials_details
      };
    });
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:projectId/daily-reports/:id', async (req, res) => {
  try {
    const report = await get('SELECT * FROM project_daily_reports WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    if (!report) return res.status(404).json({ success: false, message: 'التقرير غير موجود' });
    try { report.photos = typeof report.photos === 'string' ? JSON.parse(report.photos) : (report.photos || []); } catch { report.photos = []; }
    try { report.manpower_details = typeof report.manpower_details === 'string' ? JSON.parse(report.manpower_details) : (report.manpower_details || []); } catch { report.manpower_details = []; }
    try { report.equipment_details = typeof report.equipment_details === 'string' ? JSON.parse(report.equipment_details) : (report.equipment_details || []); } catch { report.equipment_details = []; }
    try { report.materials_details = typeof report.materials_details === 'string' ? JSON.parse(report.materials_details) : (report.materials_details || []); } catch { report.materials_details = []; }
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/daily-reports', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      report_no, date, weather = 'مشمس ومناسب للعمل', temperature, manpower_count = 0,
      manpower_details, equipment_summary, equipment_details, work_performed, materials_received,
      materials_details, safety_notes, delays_obstacles, site_engineer, notes,
      photos, gps_lat, gps_lng, status = 'معتمد', approved_by
    } = req.body;

    if (!work_performed) return res.status(400).json({ success: false, message: 'بيان الأعمال المنفذة مطلوب' });

    const countRes = await get('SELECT COUNT(*) as cnt FROM project_daily_reports WHERE project_id = ?', [projectId]);
    const autoNo = report_no || `DR-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const jsonManpower = typeof manpower_details === 'object' ? JSON.stringify(manpower_details) : (manpower_details || null);
    const jsonEquipment = typeof equipment_details === 'object' ? JSON.stringify(equipment_details) : (equipment_details || null);
    const jsonMaterials = typeof materials_details === 'object' ? JSON.stringify(materials_details) : (materials_details || null);
    const jsonPhotos = typeof photos === 'object' ? JSON.stringify(photos) : (photos || null);

    const result = await run(`
      INSERT INTO project_daily_reports (
        project_id, report_no, date, weather, temperature, manpower_count,
        manpower_details, equipment_summary, equipment_details, work_performed,
        materials_received, materials_details, safety_notes, delays_obstacles,
        site_engineer, notes, photos, gps_lat, gps_lng, status, approved_by, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, date || new Date().toISOString().split('T')[0], weather, temperature || null, Number(manpower_count) || 0,
      jsonManpower, equipment_summary || null, jsonEquipment, work_performed,
      materials_received || null, jsonMaterials, safety_notes || null, delays_obstacles || null,
      site_engineer || 'م. الموقع', notes || null, jsonPhotos,
      gps_lat ? Number(gps_lat) : null, gps_lng ? Number(gps_lng) : null,
      status || 'معتمد', approved_by || null, status === 'معتمد' ? new Date().toISOString() : null
    ]);

    const created = await get('SELECT * FROM project_daily_reports WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم توثيق التقرير اليومي للموقع بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:projectId/daily-reports/:id', async (req, res) => {
  try {
    const { id, projectId } = req.params;
    const {
      report_no, date, weather, temperature, manpower_count,
      manpower_details, equipment_summary, equipment_details, work_performed,
      materials_received, materials_details, safety_notes, delays_obstacles,
      site_engineer, notes, photos, gps_lat, gps_lng, status, approved_by
    } = req.body;

    const existing = await get('SELECT * FROM project_daily_reports WHERE id = ? AND project_id = ?', [id, projectId]);
    if (!existing) return res.status(404).json({ success: false, message: 'التقرير غير موجود' });

    const jsonManpower = manpower_details !== undefined ? (typeof manpower_details === 'object' ? JSON.stringify(manpower_details) : manpower_details) : existing.manpower_details;
    const jsonEquipment = equipment_details !== undefined ? (typeof equipment_details === 'object' ? JSON.stringify(equipment_details) : equipment_details) : existing.equipment_details;
    const jsonMaterials = materials_details !== undefined ? (typeof materials_details === 'object' ? JSON.stringify(materials_details) : materials_details) : existing.materials_details;
    const jsonPhotos = photos !== undefined ? (typeof photos === 'object' ? JSON.stringify(photos) : photos) : existing.photos;

    await run(`
      UPDATE project_daily_reports SET
        report_no = COALESCE(?, report_no),
        date = COALESCE(?, date),
        weather = COALESCE(?, weather),
        temperature = COALESCE(?, temperature),
        manpower_count = COALESCE(?, manpower_count),
        manpower_details = ?,
        equipment_summary = COALESCE(?, equipment_summary),
        equipment_details = ?,
        work_performed = COALESCE(?, work_performed),
        materials_received = COALESCE(?, materials_received),
        materials_details = ?,
        safety_notes = COALESCE(?, safety_notes),
        delays_obstacles = COALESCE(?, delays_obstacles),
        site_engineer = COALESCE(?, site_engineer),
        notes = COALESCE(?, notes),
        photos = ?,
        gps_lat = COALESCE(?, gps_lat),
        gps_lng = COALESCE(?, gps_lng),
        status = COALESCE(?, status),
        approved_by = COALESCE(?, approved_by)
      WHERE id = ? AND project_id = ?
    `, [
      report_no, date, weather, temperature, manpower_count !== undefined ? Number(manpower_count) : null,
      jsonManpower, equipment_summary, jsonEquipment, work_performed,
      materials_received, jsonMaterials, safety_notes, delays_obstacles,
      site_engineer, notes, jsonPhotos,
      gps_lat !== undefined ? Number(gps_lat) : null, gps_lng !== undefined ? Number(gps_lng) : null,
      status, approved_by, id, projectId
    ]);

    const updated = await get('SELECT * FROM project_daily_reports WHERE id = ?', [id]);
    res.json({ success: true, message: 'تم تحديث التقرير اليومي بنجاح', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:projectId/daily-reports/:id/approve', async (req, res) => {
  try {
    const { id, projectId } = req.params;
    const approvedBy = req.body.approved_by || req.user?.name || 'مدير المشروع / الاستشاري';
    await run(`
      UPDATE project_daily_reports SET
        status = 'معتمد',
        approved_by = ?,
        approved_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ?
    `, [approvedBy, id, projectId]);

    res.json({ success: true, message: 'تم اعتماد التقرير اليومي بنجاح', approved_by: approvedBy });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/daily-reports/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_daily_reports WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف التقرير اليومي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 11. التقارير الأسبوعية للموقع (Weekly Site Reports)
// ============================================================================
router.get('/:projectId/weekly-reports', async (req, res) => {
  try {
    const reports = await query('SELECT * FROM project_weekly_reports WHERE project_id = ? ORDER BY date_to DESC, id DESC', [req.params.projectId]);
    res.json({ success: true, data: reports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/weekly-reports', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      report_no, week_no = 1, date_from, date_to, planned_progress_pct = 0,
      actual_progress_pct = 0, achievements_summary, next_week_plan,
      critical_issues, prepared_by, approved_by, notes
    } = req.body;

    if (!achievements_summary) return res.status(400).json({ success: false, message: 'ملخص إنجازات الأسبوع مطلوب' });

    const countRes = await get('SELECT COUNT(*) as cnt FROM project_weekly_reports WHERE project_id = ?', [projectId]);
    const autoNo = report_no || `WR-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = await run(`
      INSERT INTO project_weekly_reports (
        project_id, report_no, week_no, date_from, date_to,
        planned_progress_pct, actual_progress_pct, achievements_summary,
        next_week_plan, critical_issues, prepared_by, approved_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, Number(week_no) || 1, date_from || new Date().toISOString().split('T')[0],
      date_to || new Date().toISOString().split('T')[0], Number(planned_progress_pct) || 0,
      Number(actual_progress_pct) || 0, achievements_summary, next_week_plan,
      critical_issues, prepared_by, approved_by, notes
    ]);

    // تحديث نسبة إنجاز المشروع إذا تم إدخالها
    if (actual_progress_pct > 0) {
      await run('UPDATE projects SET progress_percentage = ? WHERE id = ?', [Number(actual_progress_pct), projectId]);
    }

    const created = await get('SELECT * FROM project_weekly_reports WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم حفظ واعتماد التقرير الأسبوعي بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/weekly-reports/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_weekly_reports WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف التقرير الأسبوعي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 12. محاضر الاستلام والفحص الهندسي (Handover Minutes)
// ============================================================================
router.get('/:projectId/handovers', async (req, res) => {
  try {
    const handovers = await query('SELECT * FROM project_handover_minutes WHERE project_id = ? ORDER BY inspection_date DESC, id DESC', [req.params.projectId]);
    res.json({ success: true, data: handovers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/handovers', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      minute_no, type, location_axis, inspection_date,
      inspector_name, contractor_rep, status = 'معتمد ومقبول',
      punch_list, recommendations, notes
    } = req.body;

    if (!type || !inspector_name) return res.status(400).json({ success: false, message: 'نوع الاستلام واسم المهندس الفاحص مطلوبان' });

    const countRes = await get('SELECT COUNT(*) as cnt FROM project_handover_minutes WHERE project_id = ?', [projectId]);
    const autoNo = minute_no || `IR-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = await run(`
      INSERT INTO project_handover_minutes (
        project_id, minute_no, type, location_axis, inspection_date,
        inspector_name, contractor_rep, status, punch_list, recommendations, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, type, location_axis, inspection_date || new Date().toISOString().split('T')[0],
      inspector_name, contractor_rep, status, punch_list, recommendations, notes
    ]);

    const created = await get('SELECT * FROM project_handover_minutes WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم توثيق محضر الاستلام والفحص الهندسي بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/handovers/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_handover_minutes WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف المحضر بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 13. المراسلات مع المالك والاستشاري (Correspondence)
// ============================================================================
router.get('/:projectId/correspondence', async (req, res) => {
  try {
    const corr = await query('SELECT * FROM project_correspondence WHERE project_id = ? ORDER BY date DESC, id DESC', [req.params.projectId]);
    res.json({ success: true, data: corr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/correspondence', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      ref_no, direction = 'صادر إلى المالك', subject, date,
      priority = 'عادي', summary_body, required_action, response_status = 'قيد الإجراء',
      sender, recipient, attachment_name, notes
    } = req.body;

    if (!subject || !summary_body) return res.status(400).json({ success: false, message: 'موضوع الخطاب ومحتواه مطلوبان' });

    const countRes = await get('SELECT COUNT(*) as cnt FROM project_correspondence WHERE project_id = ?', [projectId]);
    const prefix = direction.includes('صادر') ? 'COR-OUT' : 'COR-IN';
    const autoNo = ref_no || `${prefix}-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = await run(`
      INSERT INTO project_correspondence (
        project_id, ref_no, direction, subject, date,
        priority, summary_body, required_action, response_status,
        sender, recipient, attachment_name, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, direction, subject, date || new Date().toISOString().split('T')[0],
      priority, summary_body, required_action, response_status,
      sender, recipient, attachment_name, notes
    ]);

    const created = await get('SELECT * FROM project_correspondence WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم أرشفة المراسلة والخطاب بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/correspondence/:id', async (req, res) => {
  try {
    await run('DELETE FROM project_correspondence WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف المراسلة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 14. الحساب الختامي وتصفية المشروع (Final Settlement)
// ============================================================================
router.get('/:projectId/settlement', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const settlement = await get('SELECT * FROM project_final_settlements WHERE project_id = ?', [projectId]);
    res.json({ success: true, data: settlement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/settlement', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      settlement_no, date, original_contract_val, approved_change_orders_val,
      revised_contract_val, total_executed_work_val, total_client_payments_received,
      released_retention_val, penalties_deductions_val, final_balance_due,
      due_to = 'لصالح المقاول', status = 'معتمد وموقع', prepared_by, approved_by, notes
    } = req.body;

    const autoNo = settlement_no || `SET-PRJ-${String(projectId).padStart(3, '0')}`;

    const existing = await get('SELECT id FROM project_final_settlements WHERE project_id = ?', [projectId]);

    if (existing) {
      await run(`
        UPDATE project_final_settlements SET
          settlement_no = ?, date = ?, original_contract_val = ?,
          approved_change_orders_val = ?, revised_contract_val = ?,
          total_executed_work_val = ?, total_client_payments_received = ?,
          released_retention_val = ?, penalties_deductions_val = ?,
          final_balance_due = ?, due_to = ?, status = ?,
          prepared_by = ?, approved_by = ?, notes = ?
        WHERE project_id = ?
      `, [
        autoNo, date || new Date().toISOString().split('T')[0],
        Number(original_contract_val) || 0, Number(approved_change_orders_val) || 0,
        Number(revised_contract_val) || 0, Number(total_executed_work_val) || 0,
        Number(total_client_payments_received) || 0, Number(released_retention_val) || 0,
        Number(penalties_deductions_val) || 0, Number(final_balance_due) || 0,
        due_to, status, prepared_by, approved_by, notes, projectId
      ]);
    } else {
      await run(`
        INSERT INTO project_final_settlements (
          project_id, settlement_no, date, original_contract_val,
          approved_change_orders_val, revised_contract_val, total_executed_work_val,
          total_client_payments_received, released_retention_val, penalties_deductions_val,
          final_balance_due, due_to, status, prepared_by, approved_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectId, autoNo, date || new Date().toISOString().split('T')[0],
        Number(original_contract_val) || 0, Number(approved_change_orders_val) || 0,
        Number(revised_contract_val) || 0, Number(total_executed_work_val) || 0,
        Number(total_client_payments_received) || 0, Number(released_retention_val) || 0,
        Number(penalties_deductions_val) || 0, Number(final_balance_due) || 0,
        due_to, status, prepared_by, approved_by, notes
      ]);
    }

    // إذا كانت المخالصة معتمدة ومغلقة، نقوم بتحديث حالة المشروع إلى completed
    if (status === 'مغلق ومصفى' || status === 'معتمد وموقع') {
      await run('UPDATE projects SET status = "completed", progress_percentage = 100 WHERE id = ?', [projectId]);
    }

    const saved = await get('SELECT * FROM project_final_settlements WHERE project_id = ?', [projectId]);
    res.json({ success: true, message: 'تم حفظ واعتماد الحساب الختامي والمخالصة بنجاح', data: saved });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// دالة تفقيط المبالغ المالية باللغة العربية المعتمدة على المحرك المالي الشامل
function tafqeetArabic(num, currency = 'ر.ي') {
  return tafqeet(num, currency);
}

// ============================================================================
// 16. عرض السعر والتسعير المتكامل (المخازن، المواد، الكميات، والموردين)
// ============================================================================
router.get('/:projectId/integrated-quotation', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    let project = await get(`
      SELECT p.*, c.name as client_name, c.phone as client_phone, c.company as client_company
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [projectId]);

    if (!project) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }

    const requestedQuoNo = req.query.quotation_no;
    let quotation = null;

    if (requestedQuoNo) {
      quotation = await get('SELECT * FROM project_quotations WHERE quotation_no = ? AND (project_id = ? OR project_id IS NULL)', [requestedQuoNo, projectId]);
    }

    // البحث عن أحدث عرض سعر خاص بهذا المشروع أولاً
    if (!quotation) {
      quotation = await get('SELECT * FROM project_quotations WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
    }

    // جلب بيانات العقد لتحديد صاحب العقد الموقع على المشروع (السادة)
    const contract = await get(`
      SELECT * FROM project_contracts
      WHERE project_id = ?
      ORDER BY id DESC LIMIT 1
    `, [projectId]);

    let contractOwner = project?.client_name || 'العميل المعتمد';
    if (contract) {
      if (contract.first_party && !contract.first_party.includes('رواسي')) {
        contractOwner = contract.first_party;
      } else if (contract.second_party && !contract.second_party.includes('رواسي')) {
        contractOwner = contract.second_party;
      }
    }

    // جلب بنود BOQ الخاصة بهذا المشروع
    const allBoq = await query('SELECT id, item_no, description, unit, contract_qty, unit_rate, total_amount FROM project_boq WHERE project_id = ? ORDER BY id ASC', [projectId]);

    // استخراج البنود إما من عرض السعر أو من جدول كميات المشروع BOQ أو بند افتراضي من العقد
    let items = [];
    if (quotation && quotation.items_json) {
      try {
        items = typeof quotation.items_json === 'string' ? JSON.parse(quotation.items_json) : quotation.items_json;
      } catch (e) {
        items = [];
      }
    } else if (allBoq && allBoq.length > 0) {
      items = allBoq.map((b, idx) => ({
        item_no: idx + 1,
        description: b.description || 'بند أعمال',
        unit: b.unit || 'وحدة',
        quantity: Number(b.contract_qty) || 1,
        unit_price: Number(b.unit_rate) || 0,
        total: Number(b.total_amount) || ((Number(b.contract_qty) || 1) * (Number(b.unit_rate) || 0)),
        boq_item_no: b.item_no || `BOQ-${String(idx + 1).padStart(2, '0')}`,
        category: 'أعمال تعاقدية',
        boq_linked: true
      }));
    } else {
      const contractVal = Number(contract?.contract_value || project.contract_value || 0);
      items = [{
        item_no: 1,
        description: contract?.title || `تنفيذ أعمال ومقاولات ${project.name}`,
        unit: 'مقطوع',
        quantity: 1,
        unit_price: contractVal,
        total: contractVal,
        boq_item_no: 'BOQ-01',
        category: 'أعمال تعاقدية',
        boq_linked: false
      }];
    }

    // جلب المخزون والموردين للربط الفوري والتأكد من أحدث الأرصدة
    const allMaterials = await query('SELECT id, code, name, category, unit, current_quantity, min_quantity, unit_price FROM items');
    const allSuppliers = await query('SELECT id, name, phone, category FROM suppliers');

    const materialsMap = {};
    allMaterials.forEach(m => {
      materialsMap[m.name] = m;
      materialsMap[m.id] = m;
    });

    const suppliersMap = {};
    allSuppliers.forEach(s => {
      suppliersMap[s.name] = s;
      suppliersMap[s.id] = s;
    });

    const boqMap = {};
    allBoq.forEach(b => {
      boqMap[b.item_no] = b;
    });

    // تحديث بيانات البنود بروابط المخزن والموردين و BOQ الحية
    const enrichedItems = items.map((it, idx) => {
      const itemNo = it.item_no || (idx + 1);
      const boqCode = it.boq_item_no || `BOQ-${String(itemNo).padStart(2, '0')}`;
      const boqMatch = boqMap[boqCode];

      const mat = materialsMap[it.material_id] || materialsMap[it.material_name] || null;
      let stockQty = mat ? mat.current_quantity : (it.stock_quantity || 10);
      let stockUnit = mat ? mat.unit : (it.stock_unit || it.unit);
      let stockStatus = 'متوفر بالمخزن 🟢';
      if (mat) {
        if (mat.current_quantity <= 0) stockStatus = 'نفذ من المخزن 🔴';
        else if (mat.current_quantity <= (mat.min_quantity || 5)) stockStatus = 'مخزون منخفض 🟡';
        else stockStatus = 'متوفر بالمخزن 🟢';
      }

      const supp = suppliersMap[it.supplier_id] || suppliersMap[it.supplier_name] || null;
      const suppPhone = supp ? supp.phone : (it.supplier_phone || '775566778');
      const suppName = supp ? supp.name : (it.supplier_name || 'مورد معتمد');

      const qty = Number(it.quantity) || 1;
      const price = Number(it.unit_price) || 0;
      const total = Number(it.total) || (qty * price);

      return {
        ...it,
        item_no: itemNo,
        description: it.description || 'بند أعمال',
        unit: it.unit || 'وحدة',
        quantity: qty,
        unit_price: price,
        total: total,
        boq_item_no: boqCode,
        boq_linked: !!boqMatch,
        material_id: mat ? mat.id : it.material_id,
        material_name: mat ? mat.name : (it.material_name || it.description),
        stock_quantity: stockQty,
        stock_unit: stockUnit,
        stock_status: stockStatus,
        supplier_id: supp ? supp.id : it.supplier_id,
        supplier_name: suppName,
        supplier_phone: suppPhone
      };
    });

    const activeCurrency = quotation?.currency || contract?.currency || project.currency || 'ر.ي';
    const totalAmount = enrichedItems.reduce((acc, curr) => acc + (Number(curr.total) || 0), 0) || (quotation ? Number(quotation.total_amount) : Number(contract?.contract_value || project.contract_value || 0));

    if (!quotation) {
      quotation = {
        id: null,
        project_id: Number(projectId),
        quotation_no: `QT-${project.code || 'PRJ'}-${new Date().getFullYear()}`,
        title: `عرض سعر ${project.name}`,
        date: contract?.contract_date || project.start_date || new Date().toISOString().split('T')[0],
        valid_until: contract?.end_date || project.end_date || null,
        currency: activeCurrency,
        total_amount: totalAmount,
        subtotal: totalAmount,
        notes: contract?.notes || project.notes || `عرض سعر رسمي خاص بمشروع ${project.name}`,
        payment_terms: contract?.payment_terms || 'دفعات مرحلية حسب المستخلصات والتقدم الميداني',
        delivery_period: contract?.duration_days ? `${contract.duration_days} يوماً` : '30 يوماً من استلام الموقع',
        status: 'معتمد'
      };
    }

    const words = tafqeetArabic(totalAmount, activeCurrency);

    // جلب قائمة كافة عروض الأسعار المسجلة للاختيار منها مع إبراز عروض هذا المشروع
    const allQuotations = await query(`
      SELECT q.id, q.project_id, q.quotation_no, q.title, q.date, q.total_amount, q.currency,
             p.name as project_name, c.name as client_name, c.phone as client_phone
      FROM project_quotations q
      LEFT JOIN projects p ON q.project_id = p.id
      LEFT JOIN clients c ON q.client_id = c.id
      ORDER BY CASE WHEN q.project_id = ? THEN 0 ELSE 1 END, q.id DESC
    `, [projectId]);

    res.json({
      success: true,
      data: {
        project: {
          ...project,
          contract_owner: contractOwner,
          contract_no: contract?.contract_no || null
        },
        quotation,
        items: enrichedItems,
        summary: {
          totalItems: enrichedItems.length,
          page1Count: Math.min(19, enrichedItems.length),
          page2Count: Math.max(0, enrichedItems.length - 19),
          totalAmount: totalAmount,
          currency: activeCurrency,
          notes: quotation.notes || contract?.notes || project.notes || `عرض سعر خاص بمشروع ${project.name}`,
          amountWords: `${words} (${activeCurrency} ${totalAmount.toLocaleString()})`
        },
        allMaterials,
        allSuppliers,
        allQuotations
      }
    });
  } catch (err) {
    console.error('Error in integrated-quotation:', err);
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات عرض السعر المتكامل', error: err.message });
  }
});

// حفظ وتحديث بنود عرض السعر المتكامل
router.post('/:projectId/integrated-quotation', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { quotation_no, date, valid_until, currency, notes, items, client_id, title } = req.body;

    const totalAmount = (items || []).reduce((acc, it) => acc + (Number(it.total) || ((Number(it.quantity) || 1) * (Number(it.unit_price) || 0))), 0);
    const itemsJsonStr = JSON.stringify(items || []);

    let existing = null;
    if (quotation_no) {
      existing = await get('SELECT id, project_id FROM project_quotations WHERE quotation_no = ?', [quotation_no]);
    }
    if (!existing) {
      existing = await get('SELECT id, project_id FROM project_quotations WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
    }

    if (existing) {
      await run(`
        UPDATE project_quotations SET
          title = ?, date = ?, valid_until = ?, items_json = ?,
          subtotal = ?, total_amount = ?, currency = ?, notes = ?
        WHERE id = ?
      `, [
        title || 'عرض سعر معتمد',
        date || new Date().toISOString().split('T')[0],
        valid_until || null,
        itemsJsonStr,
        totalAmount,
        totalAmount,
        currency || '$',
        notes || '',
        existing.id
      ]);
    } else {
      const qNo = quotation_no || `QUO-${projectId}-${Date.now().toString().slice(-4)}`;
      await run(`
        INSERT INTO project_quotations (
          project_id, client_id, quotation_no, title, date, valid_until,
          items_json, subtotal, discount, tax_vat, total_amount, currency,
          status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectId,
        client_id || null,
        qNo,
        title || 'عرض سعر معتمد',
        date || new Date().toISOString().split('T')[0],
        valid_until || null,
        itemsJsonStr,
        totalAmount,
        0,
        0,
        totalAmount,
        currency || '$',
        'معتمد',
        notes || ''
      ]);
    }

    res.json({ success: true, message: 'تم حفظ وتحديث عرض السعر والبنود بنجاح', total_amount: totalAmount });
  } catch (err) {
    console.error('Error saving integrated-quotation:', err);
    res.status(500).json({ success: false, message: 'خطأ في حفظ عرض السعر المتكامل', error: err.message });
  }
});

// تصدير بنود عرض السعر إلى جدول الكميات التعاقدي BOQ
router.post('/:projectId/integrated-quotation/export-boq', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'لا توجد بنود للتصدير' });
    }

    let insertedCount = 0;
    let updatedCount = 0;

    for (const item of items) {
      const boqCode = item.boq_item_no || `BOQ-${String(item.item_no).padStart(2, '0')}`;
      const existing = await get('SELECT id FROM project_boq WHERE project_id = ? AND item_no = ?', [projectId, boqCode]);

      if (existing) {
        await run(`
          UPDATE project_boq SET
            description = ?, unit = ?, contract_qty = ?, unit_rate = ?, total_amount = ?,
            notes = ?
          WHERE id = ?
        `, [
          item.description || 'بند أعمال',
          item.unit || 'وحدة',
          Number(item.quantity) || 1,
          Number(item.unit_price) || 0,
          Number(item.total) || 0,
          `مربوط بعرض السعر - مخزن: ${item.material_name || item.description || ''} - مورد: ${item.supplier_name || 'عام'}`,
          existing.id
        ]);
        updatedCount++;
      } else {
        await run(`
          INSERT INTO project_boq (
            project_id, item_no, description, category, unit,
            contract_qty, executed_qty, unit_rate, total_amount, status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          projectId,
          boqCode,
          item.description || 'بند أعمال',
          item.category || 'بنود عامة',
          item.unit || 'وحدة',
          Number(item.quantity) || 1,
          0,
          Number(item.unit_price) || 0,
          Number(item.total) || 0,
          'جاري التنفيذ',
          `مربوط بعرض السعر - مخزن: ${item.material_name || item.description || ''} - مورد: ${item.supplier_name || 'عام'}`
        ]);
        insertedCount++;
      }
    }

    res.json({
      success: true,
      message: `تم تصدير البنود بنجاح إلى جدول الكميات BOQ (أضيف ${insertedCount} وتم تحديث ${updatedCount} بند)`
    });
  } catch (err) {
    console.error('Error exporting quotation to BOQ:', err);
    res.status(500).json({ success: false, message: 'خطأ في تصدير البنود لجدول الكميات', error: err.message });
  }
});

// استيراد بنود جدول الكميات BOQ إلى عرض السعر
router.post('/:projectId/integrated-quotation/import-boq', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const boqItems = await query('SELECT * FROM project_boq WHERE project_id = ? ORDER BY id ASC', [projectId]);

    if (!boqItems || boqItems.length === 0) {
      return res.status(404).json({ success: false, message: 'لا توجد بنود مسجلة في جدول الكميات BOQ لهذا المشروع' });
    }

    const transformedItems = boqItems.map((b, idx) => ({
      item_no: idx + 1,
      description: b.description,
      unit: b.unit || 'وحدة',
      quantity: Number(b.contract_qty) || 1,
      unit_price: Number(b.unit_rate) || 0,
      total: Number(b.total_amount) || ((Number(b.contract_qty) || 1) * (Number(b.unit_rate) || 0)),
      category: b.category || 'تشطيبات وتجهيزات',
      boq_item_no: b.item_no || `BOQ-${String(idx + 1).padStart(2, '0')}`,
      material_name: b.description,
      stock_quantity: 10,
      stock_unit: b.unit || 'وحدة',
      stock_status: 'متوفر بالمخزن 🟢',
      supplier_name: 'مورد معتمد',
      supplier_phone: '772332164'
    }));

    res.json({
      success: true,
      message: `تم استيراد ${transformedItems.length} بند من جدول الكميات BOQ بنجاح`,
      items: transformedItems
    });
  } catch (err) {
    console.error('Error importing BOQ to quotation:', err);
    res.status(500).json({ success: false, message: 'خطأ في استيراد بنود جدول الكميات', error: err.message });
  }
});

module.exports = router;
