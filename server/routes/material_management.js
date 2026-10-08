/**
 * material_management.js
 * 
 * مسارات واجهات برمجة التطبيقات (API Routes) لإدارة المواد والمستودعات والمشاريع
 * تطبق مبادئ DDD والبنية القائمة على الأحداث مع قابلية التدقيق الشاملة
 */

const express = require('express');
const router = express.Router();
const MaterialManagementService = require('../services/materialManagementService');
const materialDomainEventBus = require('../services/materialDomainEventBus');
const { requirePermission } = require('../middleware/security');
const { query, get } = require('../database/db');

// ============================================================================
// 0. المستودعات (Warehouses)
// ============================================================================
router.get('/warehouses', requirePermission('inventory:view'), async (req, res) => {
  try {
    const list = await query('SELECT * FROM warehouses ORDER BY id ASC');
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 1. مسارات وحدة الجرد والتسويات (Inventory Auditing Routes)
// ============================================================================

// 1.1 إنشاء جلسة جرد دوري قياسي
router.post('/audits/periodic', requirePermission('inventory:create,inventory:view'), async (req, res) => {
  try {
    const result = await MaterialManagementService.createPeriodicAudit(req.body, req.user);
    res.json({
      success: true,
      message: `تم إنشاء جلسة الجرد الدوري (${result.audit_no}) وتجميد لقطة الأرصدة بنجاح`,
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 1.2 تشغيل جرد مفاجئ دون إشعار مسبق (Spot / Surprise Audit)
router.post('/audits/spot', requirePermission('inventory:create,accounting:view'), async (req, res) => {
  try {
    const result = await MaterialManagementService.triggerSpotAudit(req.body, req.user);
    res.json({
      success: true,
      message: `تم إطلاق الجرد المفاجئ (${result.audit_no}) وأخذ لقطة فورية متزامنة بنجاح`,
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 1.3 جلب جميع جلسات الجرد مع التصفية
router.get('/audits', requirePermission('inventory:view'), async (req, res) => {
  try {
    const { warehouse_id, audit_type, status } = req.query;
    let sql = `
      SELECT a.*, w.name as warehouse_name, w.code as warehouse_code,
             u.username as initiated_by_username
      FROM inventory_audits a
      JOIN warehouses w ON a.warehouse_id = w.id
      LEFT JOIN users u ON a.initiated_by = u.id
    `;
    const params = [];
    const conditions = [];

    if (warehouse_id) { conditions.push('a.warehouse_id = ?'); params.push(warehouse_id); }
    if (audit_type) { conditions.push('a.audit_type = ?'); params.push(audit_type); }
    if (status) { conditions.push('a.status = ?'); params.push(status); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY a.id DESC';

    const audits = await query(sql, params);
    res.json({ success: true, data: audits });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1.4 جلب تفاصيل جلسة جرد وبنودها
router.get('/audits/:id', requirePermission('inventory:view'), async (req, res) => {
  try {
    const audit = await get(`
      SELECT a.*, w.name as warehouse_name, w.code as warehouse_code
      FROM inventory_audits a
      JOIN warehouses w ON a.warehouse_id = w.id
      WHERE a.id = ?
    `, [req.params.id]);

    if (!audit) return res.status(404).json({ success: false, message: 'جلسة الجرد غير موجودة' });

    const items = await query(`
      SELECT ai.*, i.name as item_name, i.code as item_code, i.unit, i.category
      FROM inventory_audit_items ai
      JOIN items i ON ai.item_id = i.id
      WHERE ai.audit_id = ?
      ORDER BY ai.id ASC
    `, [req.params.id]);

    res.json({ success: true, data: { ...audit, items } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1.5 تسجيل نتائج العد الفعلي وحساب الفروقات
router.post('/audits/:id/counts', requirePermission('inventory:create,inventory:view'), async (req, res) => {
  try {
    const { counts } = req.body;
    const result = await MaterialManagementService.recordPhysicalCounts(req.params.id, counts, req.user);
    res.json({
      success: true,
      message: 'تم تسجيل نتائج العد الفعلي وحساب الفروقات آلياً بنجاح',
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 1.6 اعتماد وختم محضر الجرد بالتوقيع الرقمي وتشفير HMAC
router.post('/audits/:id/seal', requirePermission('inventory:create,accounting:view'), async (req, res) => {
  try {
    const result = await MaterialManagementService.sealAuditMinutes(req.params.id, req.body, req.user);
    res.json({
      success: true,
      message: 'تم ختم محضر الجرد وتوقيعه رقمياً بنجاح، وأصبح غير قابل للتعديل',
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 1.7 تسوية المخزون وترحيل قيود دفتر الأستاذ العام بامتثال ACID
router.post('/audits/:id/reconcile', requirePermission('inventory:create,accounting:create'), async (req, res) => {
  try {
    const result = await MaterialManagementService.reconcileStockAudit(req.params.id, req.user, req);
    res.json({
      success: true,
      message: 'تمت تسوية المخزون وترحيل القيود المحاسبية لدفتر الأستاذ بنجاح',
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 1.8 جلب وثيقة محضر الجرد الرقمية
router.get('/audits/:id/minutes', requirePermission('inventory:view'), async (req, res) => {
  try {
    const audit = await get('SELECT minutes_doc, hash_signature, audit_no, status FROM inventory_audits WHERE id = ?', [req.params.id]);
    if (!audit) return res.status(404).json({ success: false, message: 'محضر الجرد غير موجود' });
    if (!audit.minutes_doc) {
      return res.status(400).json({ success: false, message: 'لم يتم ختم وثيقة المحضر بعد' });
    }

    res.json({
      success: true,
      audit_no: audit.audit_no,
      status: audit.status,
      hash_signature: audit.hash_signature,
      minutes: JSON.parse(audit.minutes_doc)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1.9 التحقق الرياضي والمشفر من سلامة محضر الجرد وعدم التلاعب
router.get('/audits/:id/verify-minutes', requirePermission('inventory:view'), async (req, res) => {
  try {
    const result = await MaterialManagementService.verifyAuditMinutesIntegrity(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 2. مسارات المواد التالفة وحجر التوالف (Damaged Materials & Scrap Quarantine)
// ============================================================================

// 2.1 عزل المواد التالفة ونقلها إلى الصندوق الافتراضي وإثبات الخسائر
router.post('/quarantine', requirePermission('inventory:create'), async (req, res) => {
  try {
    const result = await MaterialManagementService.quarantineDamagedMaterial(req.body, req.user, req);
    res.json({
      success: true,
      message: `تم عزل المواد التالفة في حجر التوالف (${result.quarantine_no}) وترحيل قيد الخسائر بنجاح`,
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 2.2 جلب قائمة مواد حجر التوالف
router.get('/quarantine', requirePermission('inventory:view'), async (req, res) => {
  try {
    const { status, warehouse_id } = req.query;
    let sql = `
      SELECT q.*, i.name as item_name, i.code as item_code, i.unit,
             w.name as warehouse_name, p.name as project_name,
             u.username as quarantined_by_name
      FROM material_quarantine_items q
      JOIN items i ON q.item_id = i.id
      JOIN warehouses w ON q.warehouse_id = w.id
      LEFT JOIN projects p ON q.project_id = p.id
      LEFT JOIN users u ON q.quarantined_by = u.id
    `;
    const params = [];
    const conditions = [];

    if (status) { conditions.push('q.status = ?'); params.push(status); }
    if (warehouse_id) { conditions.push('q.warehouse_id = ?'); params.push(warehouse_id); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY q.id DESC';

    const items = await query(sql, params);
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2.3 معالجة مادة في حجر التوالف (إتلاف، بيع خردة، أو تأهيل)
router.post('/quarantine/:id/resolve', requirePermission('inventory:create,accounting:create'), async (req, res) => {
  try {
    const result = await MaterialManagementService.resolveQuarantinedMaterial(req.params.id, req.body, req.user, req);
    res.json({
      success: true,
      message: `تمت معالجة سجل الحجر بنجاح وتحديث حالته إلى (${result.status})`,
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 3. مسارات إرجاع المواد من الموقع للمخزن (Site-to-Warehouse Return with QC)
// ============================================================================

// 3.1 توثيق إيصال إرجاع مواد مع فحص الجودة (QC Inspection)
router.post('/site-returns', requirePermission('inventory:create,projects:edit'), async (req, res) => {
  try {
    const result = await MaterialManagementService.processSiteMaterialReturnWithQC(req.body, req.user, req);
    res.json({
      success: true,
      message: `تم توثيق إيصال الإرجاع (${result.return_no}) وفحص الجودة بنجاح`,
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 3.2 جلب قائمة إيصالات إرجاع المواد
router.get('/site-returns', requirePermission('inventory:view'), async (req, res) => {
  try {
    const { project_id, warehouse_id } = req.query;
    let sql = `
      SELECT sr.*, i.name as item_name, i.code as item_code, i.unit,
             p.name as project_name, w.name as warehouse_name
      FROM site_material_returns sr
      JOIN items i ON sr.item_id = i.id
      JOIN projects p ON sr.project_id = p.id
      JOIN warehouses w ON sr.warehouse_id = w.id
    `;
    const params = [];
    const conditions = [];

    if (project_id) { conditions.push('sr.project_id = ?'); params.push(project_id); }
    if (warehouse_id) { conditions.push('sr.warehouse_id = ?'); params.push(warehouse_id); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY sr.id DESC';

    const returns = await query(sql, params);
    res.json({ success: true, data: returns });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4. مسارات التحويلات بين المشاريع (Inter-Project Material Transfers)
// ============================================================================

// 4.1 طلب تحويل مواد بين المشاريع وفق قواعد التوجيه
router.post('/inter-project-transfers', requirePermission('inventory:create,projects:edit'), async (req, res) => {
  try {
    const result = await MaterialManagementService.requestInterProjectTransfer(req.body, req.user, req);
    res.json({
      success: true,
      message: `تم رفع طلب تحويل المواد بين المشاريع (${result.transfer_no}) بنجاح وبانتظار الاعتماد المزدوج`,
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 4.2 جلب قائمة طلبات التحويل بين المشاريع
router.get('/inter-project-transfers', requirePermission('inventory:view'), async (req, res) => {
  try {
    const { status, from_project_id, to_project_id } = req.query;
    let sql = `
      SELECT ipt.*,
             fp.name as from_project_name, tp.name as to_project_name,
             fw.name as from_warehouse_name, tw.name as to_warehouse_name,
             i.name as item_name, i.code as item_code, i.unit
      FROM inter_project_material_transfers ipt
      JOIN projects fp ON ipt.from_project_id = fp.id
      JOIN projects tp ON ipt.to_project_id = tp.id
      JOIN warehouses fw ON ipt.from_warehouse_id = fw.id
      JOIN warehouses tw ON ipt.to_warehouse_id = tw.id
      JOIN items i ON ipt.item_id = i.id
    `;
    const params = [];
    const conditions = [];

    if (status) { conditions.push('ipt.status = ?'); params.push(status); }
    if (from_project_id) { conditions.push('ipt.from_project_id = ?'); params.push(from_project_id); }
    if (to_project_id) { conditions.push('ipt.to_project_id = ?'); params.push(to_project_id); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY ipt.id DESC';

    const transfers = await query(sql, params);
    res.json({ success: true, data: transfers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4.3 اعتماد تحويل المواد بين المشاريع مع تطبيق الرقابة الثنائية Maker-Checker
router.post('/inter-project-transfers/:id/approve', requirePermission('projects:edit,accounting:create'), async (req, res) => {
  try {
    const result = await MaterialManagementService.approveInterProjectTransfer(req.params.id, req.body, req.user, req);
    res.json({
      success: true,
      message: result.status === 'approved'
        ? `تم اعتماد تحويل المواد (${result.transfer_no}) وإعادة توجيه التكلفة محاسبياً بنجاح`
        : `تم رفض طلب التحويل (${result.transfer_no})`,
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 4.4 تأكيد استلام المواد في المشروع المستلم
router.post('/inter-project-transfers/:id/receive', requirePermission('inventory:create,projects:edit'), async (req, res) => {
  try {
    const result = await MaterialManagementService.receiveInterProjectTransfer(req.params.id, req.user, req);
    res.json({
      success: true,
      message: `تم تأكيد استلام المواد للمشروع بنجاح`,
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 5. مسارات أحداث المجال وسجل التدقيق المشفر (Domain Events & Audit Ledger)
// ============================================================================

// 5.1 استعراض أحدث أحداث المجال
router.get('/events', requirePermission('inventory:view'), async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const events = await materialDomainEventBus.getRecentEvents(limit);
    res.json({ success: true, count: events.length, data: events });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5.2 التحقق المشفر من سلامة سلسلة أحداث المجال بالكامل (Blockchain Hash-Chain Verification)
router.get('/events/verify-chain', requirePermission('inventory:view'), async (req, res) => {
  try {
    const verification = await materialDomainEventBus.verifyChainIntegrity();
    res.json({ success: true, data: verification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
