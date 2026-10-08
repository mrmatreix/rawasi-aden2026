/**
 * project_closeout.js
 * 
 * مسارات API لوحدة إغلاق المشروع والتقارير التحليلية بنمط CQRS
 */

const express = require('express');
const router = express.Router();
const ProjectCloseoutService = require('../services/projectCloseoutService');
const { requirePermission } = require('../middleware/security');

// ============================================================================
// 1. جانب الأوامر (Commands - Write Side)
// ============================================================================

/**
 * 1.1 أمر إغلاق المشروع النهائي وتوليد نماذج القراءة المادية
 * POST /api/project-closeout/close/:id
 */
router.post('/close/:id', requirePermission('projects:edit,inventory:create'), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const result = await ProjectCloseoutService.closeProject({
      projectId,
      closeoutDate: req.body.closeout_date,
      notes: req.body.notes,
      closedByName: req.body.closed_by_name || req.user?.username,
      forceClose: Boolean(req.body.force_close)
    }, req.user);

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 1.2 أمر إعادة فتح المشروع بعد الإغلاق للاستدراك المالي
 * POST /api/project-closeout/reopen/:id
 */
router.post('/reopen/:id', requirePermission('projects:edit,accounting:close_period'), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const result = await ProjectCloseoutService.reopenProject({
      projectId,
      reason: req.body.reason,
      reopenedByName: req.user?.username
    }, req.user);

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 2. جانب الاستعلامات ونماذج القراءة (Queries - Read Side)
// ============================================================================

/**
 * 2.1 استعلام تقرير كشف الكميات الموجه للعميل (المستخلص الختامي الخارجي)
 * GET /api/project-closeout/:id/client-boq
 * 
 * 🛡️ كائن نقل بيانات معقم وخالي تماماً من أي تسريب للتكاليف الفعلية أو أسعار الشراء الداخلية
 */
router.get('/:id/client-boq', requirePermission('projects:view,billing:view'), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const data = await ProjectCloseoutService.getClientBoQReport(projectId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 2.2 استعلام تقرير كشف الكميات للرقابة الداخلية والتدقيق الهندسي
 * GET /api/project-closeout/:id/internal-audit-boq
 * 
 * 🔍 يحتوي على الحقول السبعة الدقيقة لدورة حياة المواد وانحراف التكاليف والهدر والربحية
 */
router.get('/:id/internal-audit-boq', requirePermission('projects:view,inventory:view'), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const data = await ProjectCloseoutService.getInternalAuditBoQReport(projectId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 2.3 ملخص الأداء التنفيذي والمؤشرات المالية للإغلاق
 * GET /api/project-closeout/:id/summary
 */
router.get('/:id/summary', requirePermission('projects:view'), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const data = await ProjectCloseoutService.getCloseoutSummary(projectId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 2.4 المعاينة المباشرة لنماذج القراءة قبل الإغلاق (Live Side-by-Side Preview)
 * GET /api/project-closeout/:id/preview
 */
router.get('/:id/preview', requirePermission('projects:view'), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const clientData = await ProjectCloseoutService.getClientBoQReport(projectId);
    const auditData = await ProjectCloseoutService.getInternalAuditBoQReport(projectId);
    const summary = await ProjectCloseoutService.getCloseoutSummary(projectId);

    res.json({
      success: true,
      data: {
        clientBoq: clientData,
        auditBoq: auditData,
        summary
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * 2.5 سجل المشاريع المغلقة
 * GET /api/project-closeout/closed-projects
 */
router.get('/closed-projects', requirePermission('projects:view'), async (req, res) => {
  try {
    const list = await ProjectCloseoutService.listClosedProjects();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
