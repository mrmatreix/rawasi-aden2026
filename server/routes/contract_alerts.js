/**
 * =========================================================================
 * routes/contract_alerts.js
 * مسارات واجهة برمجة التطبيقات (REST API) لنظام التنبيهات الذكية للعقود
 * لشركة رواسي عدن للهندسة والمقاولات
 * =========================================================================
 */

const express = require('express');
const router = express.Router();
const ContractAlertsService = require('../services/contractAlertsService');
const { requirePermission } = require('../middleware/security');

/**
 * @route   GET /api/contracts/alerts/dashboard
 * @desc    لوحة ملخص وإحصائيات التنبيهات الذكية مع الفلترة
 * @access  خاص (projects:view)
 */
router.get(['/alerts/dashboard', '/dashboard'], requirePermission('projects:view'), async (req, res) => {
  try {
    const { status, severity, alert_type, project_id } = req.query;
    const data = await ContractAlertsService.getAlertsDashboard({
      status,
      severity,
      alert_type,
      project_id
    });
    res.json(data);
  } catch (error) {
    console.error('❌ [Contract Alerts API] خطأ أثناء جلب لوحة التنبيهات:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/contracts/alerts/stream
 * @desc    بث الإشعارات الفورية اللحظية (Server-Sent Events) لمتصفح الويب
 * @access  خاص
 */
router.get(['/alerts/stream', '/stream'], (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // إرسال رسالة ترحيبية وتثبيت الاتصال
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'متصل بمراقب تنبيهات العقود المباشر' })}\n\n`);

  const eventBus = ContractAlertsService.getEventBus();
  const alertListener = (alertData) => {
    res.write(`data: ${JSON.stringify(alertData)}\n\n`);
  };

  eventBus.on('new_alert', alertListener);

  req.on('close', () => {
    eventBus.removeListener('new_alert', alertListener);
  });
});

/**
 * @route   POST /api/contracts/alerts/scan
 * @desc    إعادة فحص وتوليد فوري لكافة التنبيهات
 * @access  خاص
 */
router.post(['/alerts/scan', '/scan'], requirePermission('projects:view'), async (req, res) => {
  try {
    const result = await ContractAlertsService.scanAndGenerateAlerts();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/contracts/:id/alerts
 * @desc    جلب التنبيهات الخاصة بعقد محدد
 * @access  خاص
 */
router.get('/:id/alerts', requirePermission('projects:view'), async (req, res) => {
  try {
    const { id } = req.params;
    const data = await ContractAlertsService.getContractAlerts(id);
    res.json(data);
  } catch (error) {
    console.error(`❌ [Contract Alerts API] خطأ أثناء جلب تنبيهات العقد [${req.params.id}]:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   POST /api/contracts/:id/alerts/:alertId/ack
 * @desc    الإقرار بمتابعة التنبيه
 * @access  خاص
 */
router.post('/:id/alerts/:alertId/ack', requirePermission('projects:edit'), async (req, res) => {
  try {
    const { alertId } = req.params;
    const { notes } = req.body || {};
    const result = await ContractAlertsService.acknowledgeAlert(alertId, req.user || {}, notes);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * @route   POST /api/contracts/:id/alerts/:alertId/resolve
 * @desc    حل ومعالجة التنبيه
 * @access  خاص
 */
router.post('/:id/alerts/:alertId/resolve', requirePermission('projects:edit'), async (req, res) => {
  try {
    const { alertId } = req.params;
    const result = await ContractAlertsService.resolveAlert(alertId, req.user || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
