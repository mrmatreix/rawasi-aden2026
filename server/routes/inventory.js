const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const { requirePermission, parseScopeArray } = require('../middleware/security');

// جلب جميع المواد مع حالة المخزون وتنبيهات النواقص
router.get('/items', requirePermission('inventory:view'), async (req, res) => {
  try {
    const items = await query(`
      SELECT *,
        CASE 
          WHEN current_quantity <= min_quantity THEN 1 
          ELSE 0 
        END as is_low_stock
      FROM items 
      ORDER BY id ASC
    `);
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المواد', error: err.message });
  }
});

// إضافة صنف جديد للمخزن
router.post('/items', requirePermission('inventory:create'), async (req, res) => {
  try {
    const { name, category, unit, min_quantity = 10, current_quantity = 0, unit_price = 0, currency = 'ر.ي', notes } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'اسم المادة مطلوب' });
    }

    const countRes = await get('SELECT COUNT(*) as cnt FROM items');
    const code = `ITM-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(2, '0')}`;
    const selectedCurrency = currency || 'ر.ي';

    const result = await run(`
      INSERT INTO items (code, name, category, unit, min_quantity, current_quantity, unit_price, currency, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [code, name, category || '', unit || '', Number(min_quantity), Number(current_quantity), Number(unit_price), selectedCurrency, notes || '']);

    res.json({
      success: true,
      message: 'تم إضافة الصنف بنجاح للمخزون',
      id: result.lastInsertRowid || result.insertId,
      code
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة المادة', error: err.message });
  }
});

// جلب حركات المخزون (صرف وتوريد)
router.get('/transactions', requirePermission('inventory:view'), async (req, res) => {
  try {
    const { project_id, item_id, type } = req.query;
    let sql = `
      SELECT it.*, i.name as item_name, i.unit, p.name as project_name
      FROM inventory_transactions it
      JOIN items i ON it.item_id = i.id
      LEFT JOIN projects p ON it.project_id = p.id
    `;
    const params = [];
    const conditions = [];

    // التحقق من نطاق المشاريع المصرح بها
    const allowedProjects = parseScopeArray(req.user?.scope?.allowed_projects || req.user?.allowed_projects);
    if (allowedProjects.length > 0 && !allowedProjects.includes('*') && !allowedProjects.includes('all')) {
      const placeholders = allowedProjects.map(() => '?').join(',');
      conditions.push(`(it.project_id IS NULL OR it.project_id IN (${placeholders}))`);
      params.push(...allowedProjects);
    }

    if (project_id) {
      conditions.push('it.project_id = ?');
      params.push(project_id);
    }
    if (item_id) {
      conditions.push('it.item_id = ?');
      params.push(item_id);
    }
    if (type) {
      conditions.push('it.type = ?');
      params.push(type);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY it.date DESC, it.id DESC';
    const txs = await query(sql, params);
    res.json({ success: true, data: txs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب حركات المخزون', error: err.message });
  }
});

// تسجيل إذن صرف أو إدخال مخزني داخل Transaction ذرية
router.post('/transactions', (req, res, next) => {
  const reqPerm = req.body?.type === 'out' ? 'inventory:issue,inventory:create' : 'inventory:create';
  return requirePermission(reqPerm)(req, res, next);
}, async (req, res) => {
  try {
    const {
      item_id,
      project_id,
      boq_item_id,
      type = 'out', // 'out' (صرف لمشروع) أو 'in' (توريد للمخزن)
      quantity,
      unit_price,
      recipient,
      date = new Date().toISOString().split('T')[0],
      notes
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ الحركة المخزنية
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    if (!item_id || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد الصنف والكمية المطلوبة' });
    }

    const parsedQty = Number(quantity);

    const refPrefix = type === 'out' ? 'MAT-OUT' : 'MAT-IN';
    const countRes = await get('SELECT COUNT(*) as cnt FROM inventory_transactions WHERE type = ?', [type]);
    const reference_no = `${refPrefix}-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

    const txResult = await transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM items WHERE id = ?', [item_id]);
      if (!item) {
        throw new Error('الصنف غير موجود في المخزن');
      }

      const parsedPrice = unit_price !== undefined ? Number(unit_price) : Number(item.unit_price || 0);
      const totalAmount = parsedQty * parsedPrice;

      let boqWarning = null;
      if (type === 'out' && project_id && boq_item_id) {
        const boq = await tx.get('SELECT * FROM project_boq WHERE id = ? AND project_id = ?', [boq_item_id, project_id]);
        if (boq) {
          const priorIssues = await tx.get(`
            SELECT COALESCE(SUM(quantity), 0) as issued_qty 
            FROM inventory_transactions 
            WHERE project_id = ? AND boq_item_id = ? AND type = 'out'
          `, [project_id, boq_item_id]);

          const totalIssued = Number(priorIssues?.issued_qty || 0) + parsedQty;
          if (totalIssued > Number(boq.contract_qty)) {
            boqWarning = `تنبيه: إجمالي الكمية المصروفة للبند [${boq.item_no} - ${boq.description}] (${totalIssued}) تجاوزت الكمية المعتمدة في جدول الكميات التعاقدي (${boq.contract_qty})`;
          }
        }
      }

      if (type === 'out') {
        if (Number(item.current_quantity) < parsedQty) {
          throw new Error(`الكمية المتوفرة في المخزن (${item.current_quantity} ${item.unit}) لا تكفي للصرف المطلوب (${parsedQty} ${item.unit})`);
        }
        // إنقاص رصيد المخزن
        await tx.run('UPDATE items SET current_quantity = current_quantity - ? WHERE id = ?', [parsedQty, item_id]);

        // إذا كان الصرف لمشروع، زيادة التكلفة الفعلية للمشروع
        if (project_id) {
          await tx.run('UPDATE projects SET actual_cost = actual_cost + ? WHERE id = ?', [totalAmount, project_id]);
        }
      } else if (type === 'in') {
        // زيادة رصيد المخزن
        await tx.run('UPDATE items SET current_quantity = current_quantity + ? WHERE id = ?', [parsedQty, item_id]);
      }

      const finalNotes = notes ? `${notes} ${boqWarning ? ' | ' + boqWarning : ''}` : (boqWarning || '');

      const result = await tx.run(`
        INSERT INTO inventory_transactions (
          item_id, project_id, boq_item_id, type, quantity, unit_price, total_amount, 
          reference_no, recipient, date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        item_id, project_id || null, boq_item_id ? Number(boq_item_id) : null, type, parsedQty, parsedPrice, totalAmount,
        reference_no, recipient || '', date, finalNotes
      ]);

      return { result, totalAmount, parsedPrice, boqWarning };
    });


    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'inventory',
      entity_id: reference_no,
      details: { reference_no, item_id, project_id, type, quantity: parsedQty, unit_price: txResult.parsedPrice, total_amount: txResult.totalAmount, date }
    });

    res.json({
      success: true,
      message: `تم تسجيل حركة المخزون (${type === 'out' ? 'صرف لمشروع' : 'توريد'}) وتحديث الأرصدة بنجاح`,
      reference_no,
      id: txResult.result.lastInsertRowid || txResult.result.insertId,
      total_amount: txResult.totalAmount
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

const InventoryValuationService = require('../services/inventoryValuationService');

// 1. المستودعات ومواقع التخزين
router.get('/warehouses', requirePermission('inventory:view'), async (req, res) => {
  try {
    const warehouses = await query('SELECT * FROM warehouses ORDER BY id ASC');
    res.json({ success: true, data: warehouses });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/warehouses', requirePermission('inventory:create'), async (req, res) => {
  try {
    const { code, name, type = 'central', project_id, location, manager_name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'اسم المستودع مطلوب' });

    const whCode = code || `WH-${Date.now().toString().slice(-4)}`;
    const result = await run(`
      INSERT INTO warehouses (code, name, type, project_id, location, manager_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [whCode, name, type, project_id || null, location || '', manager_name || '']);

    res.json({ success: true, message: 'تم إنشاء المستودع بنجاح', id: result.lastInsertRowid || result.insertId, code: whCode });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 2. أرصدة المستودعات التفصيلية
router.get('/warehouse-stocks', requirePermission('inventory:view'), async (req, res) => {
  try {
    const { warehouse_id, item_id } = req.query;
    let sql = `
      SELECT ws.*, w.name as warehouse_name, w.code as warehouse_code, i.name as item_name, i.unit, i.code as item_code
      FROM warehouse_stocks ws
      JOIN warehouses w ON ws.warehouse_id = w.id
      JOIN items i ON ws.item_id = i.id
    `;
    const params = [];
    const conditions = [];

    if (warehouse_id) { conditions.push('ws.warehouse_id = ?'); params.push(warehouse_id); }
    if (item_id) { conditions.push('ws.item_id = ?'); params.push(item_id); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY ws.quantity DESC';

    const stocks = await query(sql, params);
    res.json({ success: true, data: stocks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. التحويل بين المستودعات
router.post('/transfers', requirePermission('inventory:create'), async (req, res) => {
  try {
    const result = await InventoryValuationService.transferStock({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم التحويل المخزني وتحديث أرصدة المستودعات بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 4. مرتجع مشتريات إلى المورد
router.post('/purchase-returns', requirePermission('inventory:create,purchases:create'), async (req, res) => {
  try {
    const result = await InventoryValuationService.processPurchaseReturn({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم تسجيل مرتجع المشتريات وترحيل قيده المحاسبي بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 5. مرتجع مواد من المشروع إلى المستودع
router.post('/project-returns', requirePermission('inventory:create,projects:edit'), async (req, res) => {
  try {
    const result = await InventoryValuationService.processProjectReturn({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم تسجيل مرتجع مواد المشروع وتخفيض التكلفة الفعلية بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 6. الجرد الدوري وتسويات الفائض والعجز
router.post('/adjustments', requirePermission('inventory:create,accounting:create'), async (req, res) => {
  try {
    const result = await InventoryValuationService.processStocktakingAdjustment({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم تنفيذ تسوية الجرد وترحيل القيد المحاسبي المتزن بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 7. تنبيهات حد إعادة الطلب والمخزون الحرج
router.get('/reorder-alerts', requirePermission('inventory:view'), async (req, res) => {
  try {
    const result = await InventoryValuationService.getReorderAlerts();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. صرف مواد مع الربط ببند جدول الكميات BOQ للمشروع
router.post('/issue-boq', requirePermission('inventory:issue,inventory:create'), async (req, res) => {
  try {
    const result = await InventoryValuationService.issueMaterialWithBOQBinding({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم صرف المواد وربطها ببند جدول الكميات وتحديث تكلفة المشروع بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;

