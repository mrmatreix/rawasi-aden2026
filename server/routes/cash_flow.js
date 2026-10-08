/**
 * =========================================================================
 * routes/cash_flow.js
 * مسارات واجهة برمجة التطبيقات (REST API) لنظام التدفق النقدي والتوقعات
 * لشركة رواسي عدن للهندسة والمقاولات
 * =========================================================================
 * 
 * يوفر كلاً من:
 * 1. قائمة التدفقات النقدية الفعلية المعيارية القائمة على دفتر الأستاذ العام (General Ledger Cash Flow Statement).
 * 2. توقعات التدفق النقدي المستقبلي وسيناريوهات محاكاة السيولة (Projections & Scenarios).
 */

const express = require('express');
const router = express.Router();
const CashFlowProjectionService = require('../services/cashFlowProjectionService');
const CashFlowReportService = require('../services/cashFlowReportService');
const { requirePermission } = require('../middleware/security');

/**
 * @route   GET /api/cash-flow/
 * @desc    قائمة التدفقات النقدية الفعلية الرسمية من دفتر الأستاذ العام
 * @access  خاص (محاسبة / تقارير / صندوق)
 */
router.get('/', requirePermission('accounting:view,reports:view,cash:view'), async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const data = await CashFlowReportService.getCashFlow({ from_date, to_date });
    res.json(data);
  } catch (error) {
    console.error('❌ [CashFlow API] خطأ أثناء جلب قائمة التدفقات النقدية الفعلية:', error);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'تعذر جلب قائمة التدفقات النقدية الفعلية',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/cash-flow/statement
 * @desc    مرادف رسمي صريح لقائمة التدفقات النقدية الفعلية
 */
router.get('/statement', requirePermission('accounting:view,reports:view,cash:view'), async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const data = await CashFlowReportService.getCashFlow({ from_date, to_date });
    res.json(data);
  } catch (error) {
    console.error('❌ [CashFlow API] خطأ أثناء جلب بيان التدفق النقدي:', error);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'تعذر جلب بيان التدفق النقدي',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/cash-flow/projection?from=YYYY-MM&to=YYYY-MM
 * @desc    جلب تقرير توقعات التدفق النقدي الشامل لفترة زمنية محددة
 * @access  خاص (محاسبة / تقارير / مشاريع)
 */
router.get('/projection', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    const defaultFrom = `${curYear}-${curMonth}`;

    const futureDate = new Date(now.getFullYear(), now.getMonth() + 5, 1);
    const defaultTo = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}`;

    const from = req.query.from || defaultFrom;
    const to = req.query.to || defaultTo;

    const data = await CashFlowProjectionService.getPeriodProjections(from, to);
    res.json(data);
  } catch (error) {
    console.error('❌ [CashFlow API] خطأ أثناء جلب توقعات التدفق النقدي:', error);
    res.status(500).json({
      success: false,
      message: 'تعذر جلب توقعات التدفق النقدي',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/cash-flow/month/:month
 * @desc    جلب تفاصيل التدفقات الداخلة والخارجة لشهر محدد (YYYY-MM)
 * @access  خاص
 */
router.get('/month/:month', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const { month } = req.params;
    const cashPos = await CashFlowProjectionService.getCurrentCashPosition();
    const data = await CashFlowProjectionService.getMonthProjection(month, cashPos.total_available);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error(`❌ [CashFlow API] خطأ أثناء جلب تدفق شهر [${req.params.month}]:`, error);
    res.status(500).json({
      success: false,
      message: 'تعذر جلب تفاصيل الشهر المحدد',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/cash-flow/project/:projectId
 * @desc    جلب توقعات التدفق النقدي والالتزامات لمشروع محدد
 * @access  خاص
 */
router.get('/project/:projectId', requirePermission('projects:view,accounting:view'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const data = await CashFlowProjectionService.getProjectProjections(projectId);
    res.json(data);
  } catch (error) {
    console.error(`❌ [CashFlow API] خطأ أثناء جلب تدفق المشروع [${req.params.projectId}]:`, error);
    res.status(500).json({
      success: false,
      message: error.message || 'تعذر جلب تدفق المشروع',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/cash-flow/scenarios
 * @desc    محاكاة وتوليد السيناريوهات الثلاثية (الواقعي / المتفائل / المتشائم)
 * @access  خاص
 */
router.get('/scenarios', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const data = await CashFlowProjectionService.getScenarios(from, to);
    res.json(data);
  } catch (error) {
    console.error('❌ [CashFlow API] خطأ أثناء توليد سيناريوهات التدفق النقدي:', error);
    res.status(500).json({
      success: false,
      message: 'تعذر توليد سيناريوهات التدفق النقدي',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/cash-flow/projection/regenerate
 * @desc    إعادة توليد وتحديث خطة التدفقات النقدية بناءً على أحدث فواتير ومستخلصات النظام
 * @access  خاص (إدارة مالية)
 */
router.post('/projection/regenerate', requirePermission('accounting:create,accounting:edit'), async (req, res) => {
  try {
    const { from, to } = req.body || {};
    const result = await CashFlowProjectionService.generateProjections(from, to);
    res.json({
      success: true,
      message: 'تمت إعادة احتساب وتحديث توقعات التدفق النقدي بنجاح',
      data: result
    });
  } catch (error) {
    console.error('❌ [CashFlow API] خطأ أثناء إعادة توليد التوقعات:', error);
    res.status(500).json({
      success: false,
      message: 'فشلت إعادة احتساب توقعات التدفق النقدي',
      error: error.message
    });
  }
});

module.exports = router;
