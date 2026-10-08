/**
 * =========================================================================
 * routes/profitability.js
 * مسارات واجهة برمجة التطبيقات (REST API) لمركز ربحية المشاريع
 * لشركة رواسي عدن للهندسة والمقاولات
 * =========================================================================
 */

const express = require('express');
const router = express.Router();
const ProfitabilityService = require('../services/profitabilityService');

/**
 * @route   GET /api/profitability/dashboard
 * @desc    لوحة المؤشرات والملخص المالي لربحية كافة مشاريع الشركة
 * @access  خاص (RequireAuth)
 */
router.get('/dashboard', async (req, res) => {
  try {
    const dashboardData = await ProfitabilityService.getCompanyProfitabilityDashboard();
    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('❌ [Profitability API] خطأ أثناء جلب لوحة مؤشرات الربحية:', error);
    res.status(500).json({
      success: false,
      message: 'تعذر جلب لوحة مؤشرات الربحية',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/profitability/:projectId
 * @desc    جلب بيانات الربحية اللحظية لمشروع محدد مع التنبيهات الذكية
 * @access  خاص (RequireAuth)
 */
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const profitability = await ProfitabilityService.getProjectProfitability(projectId);
    res.json({
      success: true,
      data: profitability
    });
  } catch (error) {
    console.error(`❌ [Profitability API] خطأ أثناء جلب ربحية المشروع [${req.params.projectId}]:`, error);
    res.status(500).json({
      success: false,
      message: error.message || 'تعذر جلب ربحية المشروع'
    });
  }
});

/**
 * @route   GET /api/profitability/:projectId/history
 * @desc    جلب سجل التدقيق وتطور الربحية عبر الزمن للمشروع
 * @access  خاص (RequireAuth)
 */
router.get('/:projectId/history', async (req, res) => {
  try {
    const { projectId } = req.params;
    const limit = Number(req.query.limit || 50);
    const history = await ProfitabilityService.getProfitabilityHistory(projectId, limit);
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error(`❌ [Profitability API] خطأ أثناء جلب سجل ربحية المشروع [${req.params.projectId}]:`, error);
    res.status(500).json({
      success: false,
      message: error.message || 'تعذر جلب سجل تطور الربحية'
    });
  }
});

/**
 * @route   POST /api/profitability/:projectId/refresh
 * @desc    إعادة احتساب يدوي فوري لربحية المشروع وتحديث كافة السجلات والـ View
 * @access  خاص (RequireAuth)
 */
router.post('/:projectId/refresh', async (req, res) => {
  try {
    const { projectId } = req.params;
    const user = req.user || { username: 'ADMIN_MANUAL' };

    const updatedProfitability = await ProfitabilityService.recalculateProjectProfitability(projectId, {
      trigger_event: 'MANUAL_REFRESH_API',
      username: user.username || user.full_name || 'MANUAL_API',
      reference_id: req.body?.reference_no || `REFRESH-${Date.now().toString().slice(-6)}`
    });

    res.json({
      success: true,
      message: 'تمت إعادة احتساب مؤشرات الربحية بنجاح وفق معيار IFRS 15',
      data: updatedProfitability
    });
  } catch (error) {
    console.error(`❌ [Profitability API] خطأ أثناء تحديث ربحية المشروع [${req.params.projectId}]:`, error);
    res.status(500).json({
      success: false,
      message: error.message || 'فشلت عملية إعادة احتساب الربحية'
    });
  }
});

module.exports = router;
