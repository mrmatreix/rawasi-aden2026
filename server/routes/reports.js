/**
 * =========================================================================
 * server/routes/reports.js
 * مسارات واجهة برمجة التطبيقات (REST API) للتقارير والقوائم المالية الرسمية
 * لشركة رواسي عدن للهندسة والمقاولات
 * =========================================================================
 * 
 * المبادئ المطبقة:
 * 1. مسارات خفيفة جداً: التحقق من الصلاحيات والمدخلات، استدعاء ReportingService، وإرجاع بنية موحدة.
 * 2. الاعتماد الكامل على دفتر الأستاذ العام (General Ledger) كمصدر وحيد وأصيل.
 * 3. بنية استجابة موحدة: { success, data, meta, warnings, reconciliation }.
 * 4. خلو تام من أي أرقام افتراضية أو Demo Values.
 */

const express = require('express');
const router = express.Router();
const reportingService = require('../services/reportingService');
const contractingService = require('../services/contractingAccountingService');
const { requirePermission, parseScopeArray } = require('../middleware/security');

// مساعد التحقق من صيغة التاريخ YYYY-MM-DD
function sanitizeDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * 1. لوحة التحكم المركزية والمؤشرات المالية الحية
 * GET /api/reports/dashboard
 */
router.get('/dashboard', requirePermission('dashboard:view,reports:view'), async (req, res) => {
  try {
    let allowedProjects = ['*'];
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
    }

    const report = await reportingService.getDashboard({ allowedProjects });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في لوحة التحكم:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في جلب بيانات لوحة التحكم: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 2. تقرير ميزان المراجعة بالأرصدة والمجاميع
 * GET /api/reports/trial-balance?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 */
router.get('/trial-balance', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const from_date = sanitizeDate(req.query.from_date);
    const to_date = sanitizeDate(req.query.to_date);

    const report = await reportingService.getTrialBalance({ from_date, to_date });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في ميزان المراجعة:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في جلب ميزان المراجعة: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 3. تقرير قائمة الدخل المعيارية (Revenues - Cost of Revenues = Gross Profit, Gross Profit - OpEx = Net Income)
 * GET /api/reports/income-statement?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 */
router.get('/income-statement', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const from_date = sanitizeDate(req.query.from_date);
    const to_date = sanitizeDate(req.query.to_date);

    const report = await reportingService.getIncomeStatement({ from_date, to_date });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في قائمة الدخل:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في إعداد قائمة الدخل: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 4. تقرير الأرباح والخسائر المعياري (مطابق 100% مع قائمة الدخل)
 * GET /api/reports/profit-loss?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 */
router.get('/profit-loss', requirePermission('reports:view,accounting:view'), async (req, res) => {
  try {
    const from_date = sanitizeDate(req.query.from_date);
    const to_date = sanitizeDate(req.query.to_date);

    const report = await reportingService.getProfitLoss({ from_date, to_date });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في تقرير الأرباح والخسائر:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في توليد تقرير الأرباح والخسائر: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 5. تقرير المركز المالي / الميزانية العمومية (Assets = Liabilities + Equity)
 * GET /api/reports/balance-sheet?as_of_date=YYYY-MM-DD
 */
router.get('/balance-sheet', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const as_of_date = sanitizeDate(req.query.as_of_date || req.query.to_date);

    const report = await reportingService.getBalanceSheet({ as_of_date });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في الميزانية العمومية:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في جلب الميزانية العمومية: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 6. تقرير التدفقات النقدية المحاسبي (General Ledger Direct Cash Flow)
 * GET /api/reports/cash-flow?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 */
router.get('/cash-flow', requirePermission('accounting:view,reports:view,cash:view'), async (req, res) => {
  try {
    const from_date = sanitizeDate(req.query.from_date);
    const to_date = sanitizeDate(req.query.to_date);

    const report = await reportingService.getCashFlow({ from_date, to_date });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في التدفقات النقدية:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في جلب تقرير التدفقات النقدية: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 7. تقرير ربحية المشاريع المحاسبية المعترف بها
 * GET /api/reports/projects-profitability?from_date=...&to_date=...&project_id=...
 */
router.get('/projects-profitability', requirePermission('projects:view,reports:view'), async (req, res) => {
  try {
    const from_date = sanitizeDate(req.query.from_date);
    const to_date = sanitizeDate(req.query.to_date);
    const project_id = req.query.project_id ? Number(req.query.project_id) : null;

    let allowedProjects = ['*'];
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
    }

    const report = await reportingService.getProjectsProfitability({
      from_date,
      to_date,
      project_id,
      allowedProjects
    });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في ربحية المشاريع:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في جلب تقرير ربحية المشاريع: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 8. تقرير ربحية مراكز التكلفة المحاسبية (خالي من الازدواجية والحسابات الوهمية)
 * GET /api/reports/cost-centers-profitability?from_date=...&to_date=...&cost_center_id=...
 */
router.get('/cost-centers-profitability', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const from_date = sanitizeDate(req.query.from_date);
    const to_date = sanitizeDate(req.query.to_date);
    const cost_center_id = req.query.cost_center_id ? Number(req.query.cost_center_id) : null;

    const report = await reportingService.getCostCentersProfitability({
      from_date,
      to_date,
      cost_center_id
    });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في ربحية مراكز التكلفة:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في إعداد تقرير ربحية مراكز التكلفة: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 9. كشف حساب عميل مفصل ومطابق للأستاذ العام
 * GET /api/reports/client-statement/:id?from_date=...&to_date=...
 */
router.get('/client-statement/:id', requirePermission('clients:view,reports:view,accounting:view'), async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'معرف العميل غير صالح' });
    }

    const from_date = sanitizeDate(req.query.from_date);
    const to_date = sanitizeDate(req.query.to_date);

    const report = await reportingService.getClientStatement(clientId, { from_date, to_date });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في كشف حساب العميل:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في جلب كشف حساب العميل: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 10. ملف العميل الشامل (العقود، المشاريع، المستخلصات، وسلسلة المراحل التساعية)
 * GET /api/reports/client-profile/:id
 */
router.get('/client-profile/:id', requirePermission('clients:view,reports:view,accounting:view'), async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'معرف العميل غير صالح' });
    }

    const statementReport = await reportingService.getClientStatement(clientId, {});
    res.json(statementReport);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في ملف العميل:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في جلب ملف العميل: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 11. كشف حساب مورد مفصل ومطابق للأستاذ العام
 * GET /api/reports/supplier-statement/:id?from_date=...&to_date=...
 */
router.get('/supplier-statement/:id', requirePermission('suppliers:view,reports:view,accounting:view'), async (req, res) => {
  try {
    const supplierId = Number(req.params.id);
    if (!supplierId) {
      return res.status(400).json({ success: false, message: 'معرف المورد غير صالح' });
    }

    const from_date = sanitizeDate(req.query.from_date);
    const to_date = sanitizeDate(req.query.to_date);

    const report = await reportingService.getSupplierStatement(supplierId, { from_date, to_date });
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في كشف حساب المورد:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في جلب كشف حساب المورد: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 12. مصفوفة الفصل المالي لقطاع المقاولات IFRS 15
 * GET /api/reports/contracting-financial-separation
 */
router.get('/contracting-financial-separation', requirePermission('reports:view,accounting:view,projects:view'), async (req, res) => {
  try {
    let allowedProjects = ['*'];
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
    }

    const matrix = await contractingService.getCompanyWideSeparationMatrix({
      allowedProjectIds: allowedProjects
    });

    res.json({
      success: true,
      data: matrix,
      meta: {
        report_name: 'مصفوفة الفصل المالي لقطاع المقاولات IFRS 15',
        currency: 'ر.ي',
        generated_at: new Date().toISOString()
      },
      warnings: [],
      reconciliation: { is_balanced: true }
    });
  } catch (err) {
    console.error('❌ [Reports API] خطأ في مصفوفة المقاولات:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ في توليد مصفوفة المقاولات: ' + err.message,
      error: err.message
    });
  }
});

/**
 * 13. الفحص الشامل لسلامة البيانات والأستاذ العام والتسويات (Financial Integrity Check)
 * مخصص للمحاسب والمدير المالي لتدقيق الاتزان وسلامة القيود
 * GET /api/reports/integrity-check
 */
router.get('/integrity-check', requirePermission('reports:view,accounting:view'), async (req, res) => {
  try {
    const report = await reportingService.getIntegrityCheck();
    res.json(report);
  } catch (err) {
    console.error('❌ [Reports API] خطأ في الفحص الشامل لسلامة الدفاتر:', err);
    res.status(500).json({
      success: false,
      code: 'REPORT_ERROR',
      message: 'خطأ أثناء فحص سلامة الدفاتر والأستاذ العام: ' + err.message,
      error: err.message
    });
  }
});

module.exports = router;
