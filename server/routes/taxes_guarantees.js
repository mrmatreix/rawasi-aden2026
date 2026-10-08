const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requirePermission } = require('../middleware/security');
const TaxAndGuaranteeService = require('../services/taxAndGuaranteeService');

// 1. إعدادات ونسب الضرائب والتحذير القانوني
router.get('/config', requirePermission('accounting:view,settings:view'), async (req, res) => {
  try {
    const data = await TaxAndGuaranteeService.getTaxConfigs();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. معالجة واستقطاع ضريبة المقاولات (3%) في المستخلص
router.post('/bill-tax/:id', requirePermission('accounting:create,billing:create'), async (req, res) => {
  try {
    const taxRate = req.body.tax_rate !== undefined ? Number(req.body.tax_rate) : 3.0;
    const result = await TaxAndGuaranteeService.processBillTaxDeduction(req.params.id, taxRate, req.user, req);
    res.json({ success: true, message: 'تم احتساب ضريبة الخصم من المنبع وترحيل القيد المحاسبي المتزن للمستخلص بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 3. تقرير الإقرارات الضريبية الدورية
router.get('/declarations', requirePermission('accounting:view'), async (req, res) => {
  try {
    const { period } = req.query;
    const data = await TaxAndGuaranteeService.getTaxDeclarationReport(period);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. خطابات الضمان البنكية للمقاولات
router.get('/guarantees', requirePermission('projects:view,accounting:view'), async (req, res) => {
  try {
    const { project_id, status } = req.query;
    let sql = `
      SELECT bg.*, p.name as project_name, c.name as client_name, ba.bank_name as bank_account_name
      FROM bank_guarantees bg
      JOIN projects p ON bg.project_id = p.id
      LEFT JOIN clients c ON bg.client_id = c.id
      LEFT JOIN bank_accounts ba ON bg.bank_account_id = ba.id
    `;
    const params = [];
    const conditions = [];

    if (project_id) { conditions.push('bg.project_id = ?'); params.push(project_id); }
    if (status) { conditions.push('bg.status = ?'); params.push(status); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY bg.expiry_date ASC';

    const guarantees = await query(sql, params);
    res.json({ success: true, data: guarantees });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/guarantees', requirePermission('accounting:create,projects:edit'), async (req, res) => {
  try {
    const result = await TaxAndGuaranteeService.issueBankGuarantee({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم إصدار خطاب الضمان وترحيل قيد الغطاء النقدي بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/guarantees/:id/release', requirePermission('accounting:create,projects:edit'), async (req, res) => {
  try {
    const result = await TaxAndGuaranteeService.releaseBankGuarantee(req.params.id, { ...req.body, user: req.user }, req);
    res.json({ success: true, message: result.message, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
