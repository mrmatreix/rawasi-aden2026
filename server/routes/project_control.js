/**
 * مسارات التحكم المتقدم في المشاريع (Advanced Project Control API)
 * محاور: WBS | CPM | EVM | Risk | Claims | NCR | RFI
 */

'use strict';

const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database/db');
const { requirePermission, requireScope } = require('../middleware/security');
const ctrl = require('../services/projectControlService');

// حماية جميع المسارات
router.use('/:projectId', requireScope({ projectParam: 'projectId' }), (req, res, next) => {
  if (req.method === 'GET') return requirePermission('projects:view')(req, res, next);
  return requirePermission('projects:edit,projects:create')(req, res, next);
});

// ============================================================================
// A. نسبة الإنجاز الذكية (Smart % Complete)
// ============================================================================

/**
 * GET /:projectId/completion
 * يحسب نسبة الإنجاز الموزونة من جميع المصادر
 */
router.get('/:projectId/completion', async (req, res) => {
  try {
    const result = await ctrl.computeProjectCompletion(req.params.projectId);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * PUT /:projectId/completion/manual
 * يتحقق ثم يقبل/يرفض النسبة المُدخلة يدوياً
 * Body: { percent_complete, justification }
 */
router.put('/:projectId/completion/manual', async (req, res) => {
  try {
    const { percent_complete, justification } = req.body;
    if (percent_complete === undefined) {
      return res.status(400).json({ success: false, message: 'حقل percent_complete مطلوب' });
    }
    const validation = await ctrl.validateManualCompletion(
      req.params.projectId,
      Number(percent_complete),
      justification,
      req.user?.id
    );
    if (validation.accepted) {
      await run(
        `UPDATE projects SET progress_percentage = ? WHERE id = ?`,
        [Number(percent_complete), req.params.projectId]
      );
    }
    res.json({ success: true, validation });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/completion/engineer-cert
 * تسجيل شهادة إنجاز من مهندس/استشاري
 * Body: { pct, certifier_name, certifier_role, inspection_date, notes, attachment_base64 }
 */
router.post('/:projectId/completion/engineer-cert', async (req, res) => {
  try {
    const { pct, certifier_name, certifier_role, inspection_date, notes, attachment_base64 } = req.body;
    if (pct === undefined || pct < 0 || pct > 100) {
      return res.status(400).json({ success: false, message: 'نسبة الإنجاز يجب أن تكون بين 0 و100' });
    }
    const result = await run(
      `INSERT INTO project_engineer_certifications
         (project_id, pct, certified_by, certifier_name, certifier_role, inspection_date, notes, attachment_base64, created_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
      [req.params.projectId, pct, req.user?.id, certifier_name, certifier_role,
       inspection_date, notes, attachment_base64 || null]
    );
    res.json({ success: true, id: result.lastID, message: `تم تسجيل شهادة الإنجاز: ${pct}%` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * GET /:projectId/completion/engineer-certs
 * جلب سجل شهادات المهندس المشرف / الاستشاري
 */
router.get('/:projectId/completion/engineer-certs', async (req, res) => {
  try {
    const certs = await query(
      `SELECT * FROM project_engineer_certifications WHERE project_id = ? ORDER BY inspection_date DESC, id DESC`,
      [req.params.projectId]
    );
    res.json({ success: true, data: certs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================================
// B. WBS والجدول الزمني (WBS + CPM Scheduler)
// ============================================================================

/**
 * GET /:projectId/wbs
 * الحصول على كامل هيكل WBS بشجرة هرمية
 */
router.get('/:projectId/wbs', async (req, res) => {
  try {
    const activities = await query(
      `SELECT a.*, u.full_name as assigned_name
       FROM project_wbs_activities a
       LEFT JOIN users u ON u.id = a.assigned_to
       WHERE a.project_id = ? ORDER BY a.wbs_code`,
      [req.params.projectId]
    );
    // بناء الشجرة الهرمية
    const tree = buildTree(activities);
    const criticalCount = activities.filter(a => a.is_critical).length;
    res.json({
      success: true,
      data: { flat: activities, tree },
      activities,
      stats: {
        total_activities: activities.length,
        critical_activities: criticalCount
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/wbs
 * إضافة نشاط جديد إلى WBS
 */
router.post('/:projectId/wbs', async (req, res) => {
  try {
    const {
      wbs_code, name, description, discipline, activity_type, weight,
      parent_id, planned_start, planned_finish, planned_duration_days,
      priority, assigned_to, notes
    } = req.body;

    if (!wbs_code || !name) {
      return res.status(400).json({ success: false, message: 'wbs_code و name حقلان إلزاميان' });
    }

    // التحقق من تفرد كود WBS داخل المشروع
    const existing = await get(
      'SELECT id FROM project_wbs_activities WHERE project_id = ? AND wbs_code = ?',
      [req.params.projectId, wbs_code]
    );
    if (existing) {
      return res.status(409).json({ success: false, message: `كود WBS (${wbs_code}) مستخدم بالفعل في هذا المشروع` });
    }

    const result = await run(
      `INSERT INTO project_wbs_activities
         (project_id, parent_id, wbs_code, name, description, discipline, activity_type,
          weight, planned_start, planned_finish, planned_duration_days,
          priority, assigned_to, notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
      [req.params.projectId, parent_id || null, wbs_code, name, description,
       discipline, activity_type || 'task', weight || 1.0,
       planned_start, planned_finish, planned_duration_days || 0,
       priority || 'medium', assigned_to || null, notes, req.user?.id]
    );
    res.status(201).json({ success: true, id: result.lastID });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * PUT /:projectId/wbs/:activityId
 * تحديث نشاط WBS (حالة، نسبة إنجاز، تواريخ فعلية، ...)
 */
router.put('/:projectId/wbs/:activityId', async (req, res) => {
  try {
    const { activityId } = req.params;
    const {
      name, description, status, percent_complete,
      actual_start, actual_finish, actual_duration_days,
      planned_start, planned_finish, planned_duration_days,
      weight, priority, assigned_to, notes
    } = req.body;

    await run(
      `UPDATE project_wbs_activities SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         status = COALESCE(?, status),
         percent_complete = COALESCE(?, percent_complete),
         actual_start = COALESCE(?, actual_start),
         actual_finish = COALESCE(?, actual_finish),
         actual_duration_days = COALESCE(?, actual_duration_days),
         planned_start = COALESCE(?, planned_start),
         planned_finish = COALESCE(?, planned_finish),
         planned_duration_days = COALESCE(?, planned_duration_days),
         weight = COALESCE(?, weight),
         priority = COALESCE(?, priority),
         assigned_to = COALESCE(?, assigned_to),
         notes = COALESCE(?, notes),
         updated_at = datetime('now')
       WHERE id = ? AND project_id = ?`,
      [name, description, status, percent_complete,
       actual_start, actual_finish, actual_duration_days,
       planned_start, planned_finish, planned_duration_days,
       weight, priority, assigned_to, notes,
       activityId, req.params.projectId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/wbs/dependencies
 * إضافة اعتمادية بين نشاطين
 */
router.post('/:projectId/wbs/dependencies', async (req, res) => {
  try {
    const { predecessor_id, successor_id, dependency_type, lag_days } = req.body;
    if (!predecessor_id || !successor_id) {
      return res.status(400).json({ success: false, message: 'predecessor_id و successor_id مطلوبان' });
    }
    if (predecessor_id === successor_id) {
      return res.status(400).json({ success: false, message: 'لا يمكن أن يكون النشاط سلفاً وخلفاً لنفسه' });
    }
    const result = await run(
      `INSERT OR IGNORE INTO project_wbs_dependencies
         (project_id, predecessor_id, successor_id, dependency_type, lag_days, created_at)
       VALUES (?,?,?,?,?,datetime('now'))`,
      [req.params.projectId, predecessor_id, successor_id, dependency_type || 'FS', lag_days || 0]
    );
    res.status(201).json({ success: true, id: result.lastID });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * DELETE /:projectId/wbs/:activityId
 * حذف نشاط من WBS
 */
router.delete('/:projectId/wbs/:activityId', async (req, res) => {
  try {
    await run(`DELETE FROM project_wbs_activities WHERE id = ? AND project_id = ?`, [req.params.activityId, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف النشاط بنجاح' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/schedule/critical-path (أو /:projectId/wbs/cpm)
 * يحسب ويُحدث CPM كاملاً
 */
router.post(['/:projectId/schedule/critical-path', '/:projectId/wbs/cpm'], async (req, res) => {
  try {
    const result = await ctrl.computeCriticalPath(req.params.projectId);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * GET /:projectId/schedule/baseline-comparison (أو /:projectId/wbs/compare-baseline)
 * مقارنة الخط الأساسي بالوضع الفعلي
 */
router.get(['/:projectId/schedule/baseline-comparison', '/:projectId/wbs/compare-baseline'], async (req, res) => {
  try {
    const result = await ctrl.compareBaselineVsActual(req.params.projectId);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/schedule/baseline (أو /:projectId/wbs/baseline)
 * حفظ خط أساسي جديد
 * Body: { label } أو { name }
 */
router.post(['/:projectId/schedule/baseline', '/:projectId/wbs/baseline'], async (req, res) => {
  try {
    const label = req.body.label || req.body.name || `خط الأساس - ${new Date().toLocaleDateString('ar')}`;
    const result = await ctrl.saveBaseline(req.params.projectId, label, req.user?.id);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================================
// C. إدارة القيمة المكتسبة EVM
// ============================================================================

/**
 * GET /:projectId/evm
 * يحسب ويعيد جميع مؤشرات EVM الكاملة
 * Query: ?status_date=YYYY-MM-DD
 */
router.get('/:projectId/evm', async (req, res) => {
  try {
    const statusDate = req.query.status_date || null;
    const result = await ctrl.computeEVM(req.params.projectId, statusDate);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * GET /:projectId/evm/history
 * سجل EVM التاريخي (S-Curve data)
 */
router.get('/:projectId/evm/history', async (req, res) => {
  try {
    const history = await query(
      `SELECT * FROM project_evm_snapshots WHERE project_id = ? ORDER BY status_date ASC`,
      [req.params.projectId]
    );
    res.json({ success: true, data: history });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/evm/snapshot
 * حفظ لقطة دورية لمؤشرات EVM
 */
router.post('/:projectId/evm/snapshot', async (req, res) => {
  try {
    const result = await ctrl.computeEVM(req.params.projectId, null);
    res.json({ success: true, data: result, message: 'تم حفظ لقطة أداء EVM بنجاح' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================================
// D. سجل المخاطر (Risk Register)
// ============================================================================

/**
 * GET /:projectId/risks
 * عرض لوحة المخاطر الكاملة مع الإحصائيات
 */
router.get('/:projectId/risks', async (req, res) => {
  try {
    const dashboard = await ctrl.getRiskDashboard(req.params.projectId);
    res.json({ success: true, data: dashboard });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/risks
 * إضافة خطر جديد
 */
router.post('/:projectId/risks', async (req, res) => {
  try {
    const result = await ctrl.addRisk(req.params.projectId, req.body, req.user?.id);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * PUT /:projectId/risks/:riskId
 * تحديث خطر (إضافة معالجة، تغيير حالة، ...)
 */
router.put('/:projectId/risks/:riskId', async (req, res) => {
  try {
    const { riskId } = req.params;
    const { status, treatment_plan, review_date, closure_notes, probability, impact } = req.body;

    let extraFields = '';
    const params = [];

    if (probability !== undefined && impact !== undefined) {
      const { RISK_MATRIX } = require('../services/projectControlService');
      const rating = RISK_MATRIX.getRating(probability, impact);
      extraFields += ', probability=?, impact=?, risk_score=?, risk_rating=?';
      params.push(probability, impact, probability * impact, rating.rating);
    }

    await run(
      `UPDATE project_risk_register SET
         status = COALESCE(?, status),
         treatment_plan = COALESCE(?, treatment_plan),
         review_date = COALESCE(?, review_date),
         closure_notes = COALESCE(?, closure_notes),
         last_reviewed_at = datetime('now'),
         last_reviewed_by = ?,
         updated_at = datetime('now')
         ${extraFields}
       WHERE id = ? AND project_id = ?`,
      [status, treatment_plan, review_date, closure_notes, req.user?.id,
       ...params, riskId, req.params.projectId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================================
// E. سجل المطالبات والنزاعات (Claims Register)
// ============================================================================

/**
 * GET /:projectId/claims
 */
router.get('/:projectId/claims', async (req, res) => {
  try {
    const claims = await query(
      'SELECT * FROM project_claims_register WHERE project_id = ? ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json({ success: true, data: claims });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/claims
 */
router.post('/:projectId/claims', async (req, res) => {
  try {
    const result = await ctrl.addClaim(req.params.projectId, req.body, req.user?.id);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * PUT /:projectId/claims/:claimId
 * تحديث حالة مطالبة أو إضافة قيمة معتمدة
 */
router.put('/:projectId/claims/:claimId', async (req, res) => {
  try {
    const { status, approved_amount, approved_days, response_notes, resolution_date } = req.body;
    await run(
      `UPDATE project_claims_register SET
         status = COALESCE(?, status),
         approved_amount = COALESCE(?, approved_amount),
         approved_days = COALESCE(?, approved_days),
         response_notes = COALESCE(?, response_notes),
         resolution_date = COALESCE(?, resolution_date),
         updated_at = datetime('now')
       WHERE id = ? AND project_id = ?`,
      [status, approved_amount, approved_days, response_notes, resolution_date,
       req.params.claimId, req.params.projectId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================================
// F. تقارير عدم المطابقة (NCR)
// ============================================================================

/**
 * GET /:projectId/ncr
 */
router.get('/:projectId/ncr', async (req, res) => {
  try {
    const ncrs = await query(
      `SELECT n.*, u.full_name as reported_by_name, v.full_name as verified_by_name
       FROM project_non_conformance n
       LEFT JOIN users u ON u.id = n.reported_by
       LEFT JOIN users v ON v.id = n.verified_by
       WHERE n.project_id = ? ORDER BY n.reported_date DESC`,
      [req.params.projectId]
    );
    res.json({ success: true, data: ncrs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/ncr
 */
router.post('/:projectId/ncr', async (req, res) => {
  try {
    const result = await ctrl.addNCR(req.params.projectId, req.body, req.user?.id);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * PUT /:projectId/ncr/:ncrId/close
 * إغلاق تقرير عدم مطابقة
 */
router.put('/:projectId/ncr/:ncrId/close', async (req, res) => {
  try {
    const { verification_notes } = req.body;
    await run(
      `UPDATE project_non_conformance SET
         status = 'مغلق', closed_date = date('now'),
         verified_by = ?, verification_notes = COALESCE(?, verification_notes),
         updated_at = datetime('now')
       WHERE id = ? AND project_id = ?`,
      [req.user?.id, verification_notes, req.params.ncrId, req.params.projectId]
    );
    res.json({ success: true, message: 'تم إغلاق تقرير عدم المطابقة' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================================
// G. طلبات المعلومات (RFI)
// ============================================================================

/**
 * GET /:projectId/rfi
 */
router.get('/:projectId/rfi', async (req, res) => {
  try {
    const rfis = await query(
      `SELECT r.*, u.full_name as submitted_by_name
       FROM project_rfi r
       LEFT JOIN users u ON u.id = r.submitted_by
       WHERE r.project_id = ? ORDER BY r.submitted_date DESC`,
      [req.params.projectId]
    );
    // إضافة مؤشر التأخر في الرد
    const today = new Date();
    const enriched = rfis.map(r => ({
      ...r,
      is_overdue: r.required_response_date && new Date(r.required_response_date) < today && r.status === 'معلق',
      days_overdue: r.required_response_date && r.status === 'معلق'
        ? Math.max(0, Math.floor((today - new Date(r.required_response_date)) / 86400000))
        : 0,
    }));
    res.json({ success: true, data: enriched });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /:projectId/rfi
 */
router.post('/:projectId/rfi', async (req, res) => {
  try {
    const result = await ctrl.addRFI(req.params.projectId, req.body, req.user?.id);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * PUT /:projectId/rfi/:rfiId/respond (أو reply)
 * تسجيل الرد على طلب المعلومات
 */
router.put(['/:projectId/rfi/:rfiId/respond', '/:projectId/rfi/:rfiId/reply'], async (req, res) => {
  try {
    const { response, attachments } = req.body;
    if (!response) return res.status(400).json({ success: false, message: 'نص الرد مطلوب' });
    await run(
      `UPDATE project_rfi SET
         response = ?, response_date = date('now'),
         status = 'مُجاب', attachments = COALESCE(?, attachments),
         updated_at = datetime('now')
       WHERE id = ? AND project_id = ?`,
      [response, attachments, req.params.rfiId, req.params.projectId]
    );
    res.json({ success: true, message: 'تم تسجيل الرد بنجاح' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * GET /:projectId/risks/dashboard
 * لوحة حوكمة شاملة: المخاطر والمطالبات وNCR وRFI
 */
router.get('/:projectId/risks/dashboard', async (req, res) => {
  try {
    const data = await ctrl.getRiskDashboard(req.params.projectId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================================
// H. لوحة تحكم شاملة (Project Control Dashboard)
// ============================================================================

/**
 * GET /:projectId/control-dashboard
 * ملخص شامل: EVM + نسبة إنجاز + تأخيرات + مخاطر حرجة
 */
router.get('/:projectId/control-dashboard', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const [completion, evm, schedule, risks] = await Promise.all([
      ctrl.computeProjectCompletion(projectId),
      ctrl.computeEVM(projectId, null),
      ctrl.compareBaselineVsActual(projectId),
      ctrl.getRiskDashboard(projectId),
    ]);

    res.json({
      success: true,
      data: {
        project_id: projectId,
        generated_at: new Date().toISOString(),
        completion,
        evm,
        schedule_summary: schedule.summary,
        risk_summary: risks.summary,
        // تنبيهات حرجة
        alerts: buildAlerts(evm, schedule.summary, risks.summary),
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================================
// دوال مساعدة
// ============================================================================

function buildTree(activities) {
  const map = {};
  activities.forEach(a => { map[a.id] = { ...a, children: [] }; });
  const roots = [];
  activities.forEach(a => {
    if (a.parent_id && map[a.parent_id]) {
      map[a.parent_id].children.push(map[a.id]);
    } else {
      roots.push(map[a.id]);
    }
  });
  return roots;
}

function buildAlerts(evm, scheduleSummary, riskSummary) {
  const alerts = [];

  if (evm && !evm.error) {
    if (evm.cpi !== null && evm.cpi < 0.85) {
      alerts.push({ type: 'critical', category: 'cost', message: `CPI = ${evm.cpi} — تجاوز حاد للميزانية` });
    } else if (evm.cpi !== null && evm.cpi < 1.0) {
      alerts.push({ type: 'warning', category: 'cost', message: `CPI = ${evm.cpi} — تكاليف أعلى من المخطط` });
    }
    if (evm.spi !== null && evm.spi < 0.85) {
      alerts.push({ type: 'critical', category: 'schedule', message: `SPI = ${evm.spi} — تأخر حاد في الجدول` });
    } else if (evm.spi !== null && evm.spi < 1.0) {
      alerts.push({ type: 'warning', category: 'schedule', message: `SPI = ${evm.spi} — المشروع متأخر` });
    }
  }

  if (scheduleSummary?.critical_delays > 0) {
    alerts.push({ type: 'critical', category: 'schedule', message: `${scheduleSummary.critical_delays} نشاط في تأخر حرج (>30 يوم)` });
  }

  if (riskSummary?.risk_summary?.critical > 0) {
    alerts.push({ type: 'critical', category: 'risk', message: `${riskSummary.risk_summary.critical} خطر حرج مفتوح يتطلب اجراءً فورياً` });
  }

  const rfisOverdue = riskSummary?.rfi_summary?.overdue || 0;
  if (rfisOverdue > 0) {
    alerts.push({ type: 'warning', category: 'rfi', message: `${rfisOverdue} طلب معلومات (RFI) متأخر عن موعد الرد` });
  }

  return alerts;
}

module.exports = router;
