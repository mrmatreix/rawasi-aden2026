const express = require('express');
const router = express.Router();
const { query, get } = require('../database/db');
const { requirePermission } = require('../middleware/security');
const ProcurementService = require('../services/procurementService');

// 1. طلبات الشراء (Purchase Requisitions - PR)
router.get('/requisitions', requirePermission('purchases:view'), async (req, res) => {
  try {
    const { project_id, status } = req.query;
    let sql = `
      SELECT pr.*, p.name as project_name, boq.description as boq_item_description
      FROM purchase_requisitions pr
      LEFT JOIN projects p ON pr.project_id = p.id
      LEFT JOIN project_boq boq ON pr.boq_item_id = boq.id
    `;
    const params = [];
    const conditions = [];

    if (project_id) {
      conditions.push('pr.project_id = ?');
      params.push(project_id);
    }
    if (status) {
      conditions.push('pr.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY pr.id DESC';

    const requisitions = await query(sql, params);
    res.json({ success: true, data: requisitions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/requisitions', requirePermission('purchases:create'), async (req, res) => {
  try {
    const result = await ProcurementService.createRequisition({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم إنشاء طلب الشراء بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/requisitions/:id/approve', requirePermission('purchases:approve'), async (req, res) => {
  try {
    const result = await ProcurementService.approveRequisition(req.params.id, req.user, req, req.body.notes);
    res.json({ success: true, message: 'تم اعتماد طلب الشراء بنجاح', data: result });
  } catch (err) {
    const status = err.message.includes('الرقابة الثنائية') ? 403 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
});

// 2. طلبات عروض الأسعار (RFQs)
router.get('/rfqs', requirePermission('purchases:view'), async (req, res) => {
  try {
    const rfqs = await query(`
      SELECT r.*, s.name as winner_supplier_name
      FROM rfqs r
      LEFT JOIN suppliers s ON r.winner_supplier_id = s.id
      ORDER BY r.id DESC
    `);
    res.json({ success: true, data: rfqs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/rfqs', requirePermission('purchases:create'), async (req, res) => {
  try {
    const result = await ProcurementService.createRFQ({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم إنشاء ومقارنة عروض الأسعار بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 3. أوامر الشراء الرسمية (Purchase Orders - PO)
router.get('/purchase-orders', requirePermission('purchases:view'), async (req, res) => {
  try {
    const { supplier_id, project_id, status } = req.query;
    let sql = `
      SELECT po.*, s.name as supplier_name, p.name as project_name, w.name as warehouse_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN projects p ON po.project_id = p.id
      LEFT JOIN warehouses w ON po.warehouse_id = w.id
    `;
    const params = [];
    const conditions = [];

    if (supplier_id) { conditions.push('po.supplier_id = ?'); params.push(supplier_id); }
    if (project_id) { conditions.push('po.project_id = ?'); params.push(project_id); }
    if (status) { conditions.push('po.status = ?'); params.push(status); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY po.id DESC';

    const orders = await query(sql, params);
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/purchase-orders', requirePermission('purchases:create'), async (req, res) => {
  try {
    const result = await ProcurementService.createPurchaseOrder({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم إصدار أمر الشراء بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/purchase-orders/:id/approve', requirePermission('purchases:approve'), async (req, res) => {
  try {
    const result = await ProcurementService.approvePurchaseOrder(req.params.id, req.user, req, req.body.notes);
    res.json({ success: true, message: 'تم اعتماد أمر الشراء بنجاح وفق مبدأ الرقابة الثنائية', data: result });
  } catch (err) {
    const status = err.message.includes('الرقابة الثنائية') ? 403 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
});

// 4. إذن استلام وفحص المواد (Goods Receipt Note - GRN)
router.get('/grn', requirePermission('purchases:view,inventory:view'), async (req, res) => {
  try {
    const grns = await query(`
      SELECT g.*, po.po_no, s.name as supplier_name, p.name as project_name, w.name as warehouse_name
      FROM goods_receipt_notes g
      LEFT JOIN purchase_orders po ON g.po_id = po.id
      LEFT JOIN suppliers s ON g.supplier_id = s.id
      LEFT JOIN projects p ON g.project_id = p.id
      LEFT JOIN warehouses w ON g.warehouse_id = w.id
      ORDER BY g.id DESC
    `);
    res.json({ success: true, data: grns });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/grn', requirePermission('inventory:create,purchases:create'), async (req, res) => {
  try {
    const result = await ProcurementService.createGoodsReceiptNote({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم فحص واستلام المواد وتحديث رصيد المخزون بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 5. المطابقة الثلاثية الصارمة (Three-Way Matching)
router.post('/three-way-match', requirePermission('purchases:approve,purchases:view'), async (req, res) => {
  try {
    const result = await ProcurementService.executeThreeWayMatch({ ...req.body, user: req.user }, req);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
