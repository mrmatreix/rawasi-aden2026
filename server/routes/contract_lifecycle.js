/**
 * =========================================================================
 * routes/contract_lifecycle.js
 * مسارات واجهة برمجة التطبيقات (REST API) لإدارة دورة حياة العقود
 * لشركة رواسي عدن للهندسة والمقاولات
 * =========================================================================
 */

const express = require('express');
const router = express.Router();
const { ContractLifecycleService } = require('../services/contractLifecycleService');
const { requirePermission } = require('../middleware/security');

/**
 * @route   GET /api/contracts/expiring
 * @desc    جلب العقود التي قاربت على الانتهاء وفق عدد أيام محدد
 * @access  خاص (projects:view, contracts:view)
 */
router.get('/expiring', requirePermission('projects:view'), async (req, res) => {
  try {
    const days = req.query.days || 30;
    const result = await ContractLifecycleService.getExpiringContracts(days);
    res.json(result);
  } catch (error) {
    console.error('❌ [Contract Lifecycle API] خطأ أثناء جلب العقود المقاربة للانتهاء:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/contracts/:id/lifecycle
 * @desc    جلب السجل التاريخي لمراحل العقد وحالته الراهنة
 * @access  خاص
 */
router.get('/:id/lifecycle', requirePermission('projects:view'), async (req, res) => {
  try {
    const { id } = req.params;
    const data = await ContractLifecycleService.getLifecycleHistory(id);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error(`❌ [Contract Lifecycle API] خطأ أثناء جلب مراحل العقد [${req.params.id}]:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   POST /api/contracts/:id/transition
 * @desc    الانتقال بالعقد إلى مرحلة جديدة في الدورة المستندية (10 مراحل)
 * @access  خاص (projects:edit, projects:approve)
 */
router.post('/:id/transition', requirePermission('projects:edit,projects:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, approval_notes, signature_date, signature_hash, documents_json } = req.body;

    if (!stage) {
      return res.status(400).json({ success: false, message: 'المرحلة المستهدفة (stage) مطلوبة' });
    }

    const result = await ContractLifecycleService.transitionStage(id, stage, {
      approval_notes,
      signature_date,
      signature_hash,
      documents_json,
      approved_by: req.user?.username || req.user?.full_name || 'SYSTEM'
    }, req.user || {});

    res.json(result);
  } catch (error) {
    console.error(`❌ [Contract Lifecycle API] خطأ أثناء نقل مرحلة العقد [${req.params.id}]:`, error);
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
