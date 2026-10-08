const express = require('express');
const router = express.Router();
const { query, get } = require('../database/db');
const { requirePermission } = require('../middleware/security');
const BankReconciliationService = require('../services/bankReconciliationService');

// 1. الحسابات البنكية
router.get('/accounts', requirePermission('accounting:view,payments:view'), async (req, res) => {
  try {
    const accounts = await query('SELECT * FROM bank_accounts WHERE is_active = 1 ORDER BY id ASC');
    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. كشوف حسابات البنوك
router.get('/statements', requirePermission('accounting:view'), async (req, res) => {
  try {
    const { bank_account_id } = req.query;
    let sql = `
      SELECT bs.*, ba.bank_name, ba.account_number
      FROM bank_statements bs
      JOIN bank_accounts ba ON bs.bank_account_id = ba.id
    `;
    const params = [];
    if (bank_account_id) {
      sql += ' WHERE bs.bank_account_id = ?';
      params.push(bank_account_id);
    }
    sql += ' ORDER BY bs.statement_date DESC';
    const statements = await query(sql, params);
    res.json({ success: true, data: statements });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. استيراد كشف حساب بنكي
router.post('/statements/import', requirePermission('accounting:create'), async (req, res) => {
  try {
    const result = await BankReconciliationService.importBankStatement({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم استيراد كشف حساب البنك بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 4. تشغيل المطابقة الآلية
router.post('/statements/:id/auto-match', requirePermission('accounting:create'), async (req, res) => {
  try {
    const toleranceDays = Number(req.body.tolerance_days) || 5;
    const result = await BankReconciliationService.autoMatchStatementLines(req.params.id, toleranceDays, req.user, req);
    res.json({ success: true, message: 'اكتملت عملية المطابقة البنكية الآلية', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 5. تسجيل العمولات والمصاريف البنكية
router.post('/charges', requirePermission('accounting:create,expenses:create'), async (req, res) => {
  try {
    const result = await BankReconciliationService.recordBankCharge({ ...req.body, user: req.user }, req);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 6. محفظة الشيكات
router.get('/cheques', requirePermission('payments:view,accounting:view'), async (req, res) => {
  try {
    const { type, status } = req.query;
    let sql = 'SELECT * FROM cheques';
    const params = [];
    const conditions = [];

    if (type) { conditions.push('type = ?'); params.push(type); }
    if (status) { conditions.push('status = ?'); params.push(status); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY due_date ASC';

    const cheques = await query(sql, params);
    res.json({ success: true, data: cheques });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/cheques', requirePermission('payments:create'), async (req, res) => {
  try {
    const result = await BankReconciliationService.createCheque({ ...req.body, user: req.user }, req);
    res.json({ success: true, message: 'تم تسجيل الشيك في المحفظة بنجاح', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/cheques/:id/bounce', requirePermission('accounting:create,payments:edit'), async (req, res) => {
  try {
    const result = await BankReconciliationService.processBouncedCheque(req.params.id, { ...req.body, user: req.user }, req);
    res.json({ success: true, message: result.message, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 7. مذكرة التسوية البنكية الشهرية (BRS)
router.post('/brs', requirePermission('accounting:view'), async (req, res) => {
  try {
    const { bank_account_id, statement_id, period_date } = req.body;
    const result = await BankReconciliationService.generateBankReconciliationStatement(
      bank_account_id,
      statement_id,
      period_date || new Date().toISOString().split('T')[0],
      req.user,
      req
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
