/**
 * server/routes/suppliers.js
 * 
 * مسارات إدارة علاقات الموردين والملف التعريفي (SRM / Vendors API)
 * نظام شركة رواسي عدن للهندسة والمقاولات
 */

const express = require('express');
const router = express.Router();
const VendorService = require('../services/vendorService');
const { requirePermission } = require('../middleware/security');

// ============================================================================
// 1. القوائم المرجعية وخيارات النشاط والعملات
// GET /api/suppliers/lookups
// ============================================================================
router.get('/lookups', requirePermission('suppliers:view'), async (req, res) => {
  try {
    const lookups = await VendorService.getLookups();
    res.json(lookups);
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب القوائم المرجعية', error: err.message });
  }
});

// ============================================================================
// 2. جلب جميع الموردين مع التجميعات المالية الحية في استعلام واحد (Zero N+1)
// GET /api/suppliers
// ============================================================================
router.get('/', requirePermission('suppliers:view'), async (req, res) => {
  try {
    const result = await VendorService.listVendors(req.query, req.query);
    // للحفاظ على التوافق الكامل مع الواجهات السابقة:
    res.json({
      success: true,
      data: result.data,
      meta: result.meta
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الموردين', error: err.message });
  }
});

// ============================================================================
// 3. جلب ملف تعريف المورد الشامل مع تاريخ الفواتير والمدفوعات (Eager-Loaded)
// GET /api/suppliers/:id/profile
// ============================================================================
router.get('/:id/profile', requirePermission('suppliers:view'), async (req, res) => {
  try {
    const result = await VendorService.getVendorProfile(req.params.id, {
      includeRecent: req.query.include_recent !== 'false',
      limit: req.query.history_limit || 15
    });
    res.json(result);
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4. جلب مورد محدد
// GET /api/suppliers/:id
// ============================================================================
router.get('/:id', requirePermission('suppliers:view'), async (req, res) => {
  try {
    const result = await VendorService.getVendorProfile(req.params.id, { includeRecent: false });
    res.json(result);
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 5. جلب البيانات المصرفية المفكوكة (للصلاحيات المالية المعتمدة فقط)
// GET /api/suppliers/:id/bank-details
// ============================================================================
router.get('/:id/bank-details', requirePermission('accounting:view,suppliers:edit'), async (req, res) => {
  try {
    const result = await VendorService.getDecryptedBankDetails(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 6. إضافة مورد جديد مع التحقق الصارم والتشفير المصرفي
// POST /api/suppliers
// ============================================================================
router.post('/', requirePermission('suppliers:create'), async (req, res) => {
  try {
    const result = await VendorService.createVendor(req.body, req.user);
    res.status(201).json({
      success: true,
      message: `تمت إضافة المورد (${result.data.company_name}) بنجاح وتفعيل ملف الـ SRM التعريفي.`,
      data: result.data,
      id: result.data.id
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 7. تعديل بيانات مورد
// PUT /api/suppliers/:id
// ============================================================================
router.put('/:id', requirePermission('suppliers:edit'), async (req, res) => {
  try {
    const result = await VendorService.updateVendor(req.params.id, req.body, req.user);
    res.json({
      success: true,
      message: `تم تحديث بيانات المورد (${result.data.company_name}) بنجاح.`,
      data: result.data
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 8. حذف مورد
// DELETE /api/suppliers/:id
// ============================================================================
router.delete('/:id', requirePermission('suppliers:delete,admin'), async (req, res) => {
  try {
    const result = await VendorService.deleteVendor(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
