const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database/db');
const clientChainService = require('../services/clientChainService');
const { requirePermission, parseScopeArray } = require('../middleware/security');

// جلب جميع المشاريع مع اسم العميل وتطبيق نطاق الصلاحيات
router.get('/', requirePermission('projects:view,projects,accounting:view,accounting,expenses:view,expenses:create,revenues:view,revenues:create,billing:view,cash:view'), async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT p.*, c.name as client_name 
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
    `;
    const params = [];
    const conditions = [];

    // فلترة نطاق المشاريع المصرح بها للمستخدم (Project Scoping)
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      const allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
      if (!allowedProjects.includes('*') && !allowedProjects.includes('all')) {
        if (allowedProjects.length === 0) {
          return res.json({ success: true, data: [] });
        }
        const placeholders = allowedProjects.map(() => '?').join(',');
        conditions.push(`p.id IN (${placeholders})`);
        params.push(...allowedProjects.map(Number));
      }
    }

    if (status) {
      conditions.push(`p.status = ?`);
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` ORDER BY p.id ASC`;
    const projects = await query(sql, params);
    res.json({ success: true, data: projects });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المشاريع', error: err.message });
  }
});

// جلب عقود مشروع محدد
router.get('/:id/contracts', requirePermission('projects:view,projects,clients:view,billing:view,revenues:view'), async (req, res) => {
  try {
    const contracts = await query(`
      SELECT pc.*, p.name AS project_name, c.name AS client_name
      FROM project_contracts pc
      LEFT JOIN projects p ON pc.project_id = p.id
      LEFT JOIN clients c ON pc.client_id = c.id
      WHERE pc.project_id = ?
      ORDER BY pc.id DESC
    `, [req.params.id]);
    res.json({ success: true, data: contracts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// جلب مشروع محدد بالتفصيل مع فحص الصلاحية والنطاق
router.get('/:id', requirePermission('projects:view', { projectParam: 'id' }), async (req, res) => {
  try {
    const project = await get(`
      SELECT p.*, c.name as client_name, c.phone as client_phone
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [req.params.id]);

    if (!project) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }

    const expenses = await query(`SELECT * FROM expenses WHERE project_id = ? ORDER BY date DESC`, [req.params.id]);
    const bills = await query(`SELECT * FROM bills WHERE project_id = ? ORDER BY date DESC`, [req.params.id]);
    const payments = await query(`SELECT * FROM payments WHERE project_id = ? AND type = 'قبض' ORDER BY date DESC`, [req.params.id]);
    const inventory = await query(`
      SELECT it.*, i.name as item_name, i.unit 
      FROM inventory_transactions it
      JOIN items i ON it.item_id = i.id
      WHERE it.project_id = ?
      ORDER BY it.date DESC
    `, [req.params.id]);

    res.json({
      success: true,
      data: {
        ...project,
        expenses,
        bills,
        payments,
        inventory
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل المشروع', error: err.message });
  }
});

// إنشاء مشروع جديد مع التأكيد والتحقق من قاعدة البيانات
router.post('/', requirePermission('projects:create'), async (req, res) => {
  try {
    const {
      name,
      client_id,
      contract_value = 0,
      estimated_cost = 0,
      actual_cost = 0,
      currency = 'ر.ي',
      progress_percentage = 0,
      expected_profit = 0,
      actual_profit = 0,
      status = 'active',
      start_date,
      end_date,
      notes
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'اسم المشروع مطلوب' });
    }

    const trimmedName = name.trim();
    const selectedCurrency = currency || 'ر.ي';

    // توليد كود المشروع تلقائياً
    const countRes = await get('SELECT COUNT(*) as cnt FROM projects');
    const code = `PRJ-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(3, '0')}`;

    const result = await run(`
      INSERT INTO projects (
        code, name, client_id, contract_value, estimated_cost, 
        actual_cost, currency, progress_percentage, expected_profit, actual_profit, 
        status, start_date, end_date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      code, trimmedName, client_id ? Number(client_id) : null, Number(contract_value) || 0, Number(estimated_cost) || 0,
      Number(actual_cost) || 0, selectedCurrency, Number(progress_percentage) || 0, Number(expected_profit) || 0, Number(actual_profit) || 0,
      status || 'active', start_date || null, end_date || null, notes ? notes.trim() : ''
    ]);

    const newId = result.lastInsertRowid || result.insertId;

    // ربط العميل بالعقد والمشروع تلقائياً وإنشاء العقد الأولي
    if (client_id || Number(contract_value) > 0) {
      const contractCount = await get('SELECT COUNT(*) as cnt FROM project_contracts');
      const contractNo = `CNT-${code}-${String(((contractCount?.cnt || 0) + 1)).padStart(2, '0')}`;
      await run(`
        INSERT INTO project_contracts (
          project_id, client_id, contract_no, contract_value, currency,
          advance_payment_pct, retention_pct, signing_date, status, notes
        ) VALUES (?, ?, ?, ?, ?, 10, 10, date('now'), 'معتمد', ?)
      `, [newId, client_id ? Number(client_id) : null, contractNo, Number(contract_value) || 0, selectedCurrency, `عقد مشروع ${trimmedName}`]);

      // مزامنة الأثر المالي اللحظي في حساب العميل
      if (client_id) {
        await clientChainService.syncClientBalances(Number(client_id));
      }
    }

    const confirmedProject = await get(`
      SELECT p.*, c.name as client_name 
      FROM projects p 
      LEFT JOIN clients c ON p.client_id = c.id 
      WHERE p.id = ?
    `, [newId]);

    res.json({
      success: true,
      message: `تم حفظ وتأكيد إضافة المشروع (${confirmedProject ? confirmedProject.name : trimmedName}) وربطه بالعميل والعقد بنجاح`,
      data: confirmedProject,
      id: newId,
      code: confirmedProject ? confirmedProject.code : code
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إنشاء المشروع: ' + err.message, error: err.message });
  }
});

// تحديث مشروع مع فحص الصلاحية والنطاق
router.put('/:id', requirePermission('projects:edit', { projectParam: 'id' }), async (req, res) => {
  try {
    const {
      name,
      client_id,
      contract_value,
      estimated_cost,
      actual_cost,
      progress_percentage,
      expected_profit,
      actual_profit,
      status,
      currency,
      start_date,
      end_date,
      notes
    } = req.body;

    await run(`
      UPDATE projects SET
        name = COALESCE(?, name),
        client_id = COALESCE(?, client_id),
        contract_value = COALESCE(?, contract_value),
        estimated_cost = COALESCE(?, estimated_cost),
        actual_cost = COALESCE(?, actual_cost),
        currency = COALESCE(?, currency),
        progress_percentage = COALESCE(?, progress_percentage),
        expected_profit = COALESCE(?, expected_profit),
        actual_profit = COALESCE(?, actual_profit),
        status = COALESCE(?, status),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `, [
      name, client_id, contract_value, estimated_cost, actual_cost,
      currency, progress_percentage, expected_profit, actual_profit, status,
      start_date, end_date, notes, req.params.id
    ]);

    // تحديث العقد المرتبط بالعميل إن وجد
    if (client_id !== undefined) {
      await run('UPDATE project_contracts SET client_id = ? WHERE project_id = ?', [client_id ? Number(client_id) : null, req.params.id]);
      if (client_id) {
        await clientChainService.syncClientBalances(Number(client_id));
      }
    }

    res.json({ success: true, message: 'تم تحديث بيانات المشروع وربطه بالعميل بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تعديل المشروع', error: err.message });
  }
});

// حذف مشروع مع فحص الصلاحية والنطاق
router.delete('/:id', requirePermission('projects:cancel', { projectParam: 'id' }), async (req, res) => {
  try {
    await run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'تم حذف المشروع بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف المشروع', error: err.message });
  }
});

// تحديث نسبة إنجاز المشروع مع توثيق السجل وحساب القيمة المكتسبة (Earned Value)
router.post('/:id/progress', requirePermission('projects:edit', { projectParam: 'id' }), async (req, res) => {
  try {
    const { progress_percentage, notes = '', date = new Date().toISOString().split('T')[0] } = req.body;
    const projectId = req.params.id;

    if (progress_percentage === undefined || progress_percentage === null) {
      return res.status(400).json({ success: false, message: 'نسبة الإنجاز مطلوبة' });
    }

    const newProg = Math.min(100, Math.max(0, parseFloat(progress_percentage) || 0));
    const project = await get('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (!project) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }

    const oldProg = Number(project.progress_percentage) || 0;
    const recordedBy = req.user?.username || req.user?.full_name || 'مهندس المشروع';

    // تحديث النسبة في جدول المشاريع وحالة الإنجاز
    const newStatus = newProg >= 100 ? 'completed' : (project.status === 'under_study' ? 'active' : project.status);
    await run(`
      UPDATE projects 
      SET progress_percentage = ?, status = ?
      WHERE id = ?
    `, [newProg, newStatus, projectId]);

    // توثيق الحركة في سجل التتبع
    await run(`
      INSERT INTO project_progress_history (project_id, previous_percentage, new_percentage, notes, recorded_by, date)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [projectId, oldProg, newProg, notes || `تحديث نسبة الإنجاز من ${oldProg}% إلى ${newProg}%`, recordedBy, date]);

    // حساب مقاييس القيمة المكتسبة والسلامة المالية
    const contractValue = Number(project.contract_value) || 0;
    const earnedValue = Math.round((contractValue * (newProg / 100)) * 100) / 100;
    const actualCost = Number(project.actual_cost) || 0;
    const costVariance = earnedValue - actualCost;

    res.json({
      success: true,
      message: `تم تحديث نسبة إنجاز المشروع إلى ${newProg}% بنجاح`,
      data: {
        projectId,
        previous_percentage: oldProg,
        new_percentage: newProg,
        earned_value: earnedValue,
        actual_cost: actualCost,
        cost_variance: costVariance,
        status: newStatus
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تحديث نسبة الإنجاز: ' + err.message });
  }
});

// إضافة أمر تغييري (Variation Order) وتحديث قيمة العقد والسلسلة المالية
router.post('/:id/variation-order', requirePermission('projects:edit', { projectParam: 'id' }), async (req, res) => {
  try {
    const projectId = req.params.id;
    const {
      title,
      type = 'addition', // addition | reduction | scope_change
      amount = 0,
      time_extension_days = 0,
      reason = '',
      date = new Date().toISOString().split('T')[0]
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'عنوان الأمر التغييري مطلوب' });
    }

    const project = await get('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (!project) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }

    const voAmount = parseFloat(amount) || 0;
    const countRes = await get('SELECT COUNT(*) as cnt FROM project_variations WHERE project_id = ?', [projectId]);
    const voNo = `VO-${project.code || ('PRJ-' + projectId)}-${String((countRes?.cnt || 0) + 1).padStart(2, '0')}`;
    const approvedBy = req.user?.username || req.user?.full_name || 'إدارة المشاريع';

    // العقد المرتبط
    const contract = await get("SELECT * FROM project_contracts WHERE project_id = ? ORDER BY id DESC LIMIT 1", [projectId]);
    const contractId = contract ? contract.id : null;

    await run(`
      INSERT INTO project_variations (
        project_id, contract_id, vo_no, title, type, amount, time_extension_days, reason, approved_by, status, date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)
    `, [projectId, contractId, voNo, title, type, voAmount, Number(time_extension_days) || 0, reason, approvedBy, date]);

    // احتساب وتعديل قيمة العقد الجديدة للمشروع
    const oldContractValue = Number(project.contract_value) || 0;
    const diff = (type === 'reduction') ? -Math.abs(voAmount) : Math.abs(voAmount);
    const newContractValue = Math.max(0, Math.round((oldContractValue + diff) * 100) / 100);

    await run('UPDATE projects SET contract_value = ? WHERE id = ?', [newContractValue, projectId]);
    if (contractId) {
      await run('UPDATE project_contracts SET contract_value = ? WHERE id = ?', [newContractValue, contractId]);
    }

    // مزامنة الأثر المالي في حساب العميل
    if (project.client_id) {
      await clientChainService.syncClientBalances(project.client_id);
    }

    res.json({
      success: true,
      message: `تم اعتماد وتوثيق الأمر التغييري (${voNo}) وتحديث قيمة العقد إلى ${newContractValue.toLocaleString()} بنجاح`,
      data: {
        vo_no: voNo,
        previous_contract_value: oldContractValue,
        new_contract_value: newContractValue,
        diff
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تسجيل الأمر التغييري: ' + err.message });
  }
});

// استدعاء مقاييس التحكم المالي وسجل الأوامر التغييرية وتاريخ الإنجاز
router.get('/:id/control-metrics', requirePermission('projects:view', { projectParam: 'id' }), async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await get(`
      SELECT p.*, c.name as client_name 
      FROM projects p 
      LEFT JOIN clients c ON p.client_id = c.id 
      WHERE p.id = ?
    `, [projectId]);

    if (!project) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }

    const variations = await query('SELECT * FROM project_variations WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const history = await query('SELECT * FROM project_progress_history WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const bills = await query("SELECT * FROM bills WHERE project_id = ? AND status NOT IN ('reversed', 'cancelled') ORDER BY date DESC", [projectId]);
    const payments = await query("SELECT * FROM payments WHERE project_id = ? AND type = 'قبض' AND (status IN ('posted', 'cleared', 'approved') OR status IS NULL) ORDER BY date DESC", [projectId]);

    const contractValue = Number(project.contract_value) || 0;
    const progress = Number(project.progress_percentage) || 0;
    const earnedValue = Math.round((contractValue * (progress / 100)) * 100) / 100;
    const actualCost = Number(project.actual_cost) || 0;
    const estimatedCost = Number(project.estimated_cost) || 0;

    const totalGrossBilled = bills.reduce((s, b) => s + (Number(b.gross_amount) || Number(b.amount) || 0), 0);
    const totalNetBilled = bills.reduce((s, b) => s + (Number(b.net_amount) || Number(b.amount) || 0), 0);
    const totalCollected = payments.reduce((s, p) => s + (Number(p.local_amount) || Number(p.amount) || 0), 0);
    const activeRetention = bills.reduce((s, b) => s + (Number(b.retention_deduction) || 0), 0) -
      payments.filter(p => p.receipt_category === 'retention_release').reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const costVariance = earnedValue - actualCost; // موجب = وفر، سالب = تجاوز
    const cpi = actualCost > 0 ? (earnedValue / actualCost) : 1.0;

    res.json({
      success: true,
      data: {
        project,
        financials: {
          contract_value: contractValue,
          progress_percentage: progress,
          earned_value: earnedValue,
          estimated_cost: estimatedCost,
          actual_cost: actualCost,
          cost_variance: costVariance,
          cpi: Math.round(cpi * 100) / 100,
          is_over_budget: (actualCost > earnedValue && actualCost > 0),
          total_gross_billed: totalGrossBilled,
          total_net_billed: totalNetBilled,
          total_collected: totalCollected,
          active_retention: Math.max(0, activeRetention),
          outstanding_due: Math.max(0, Math.round((totalNetBilled - totalCollected) * 100) / 100)
        },
        variations,
        progress_history: history,
        bills_count: bills.length,
        payments_count: payments.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب مقاييس المشروع: ' + err.message });
  }
});

module.exports = router;
