/**
 * مسارات إدارة حسابات بوابة العملاء (Admin Side - Client Users Management)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 * محمية بصلاحيات الفريق الداخلي (requireAuth)
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/db');

/**
 * GET /api/admin/client-users
 * استعراض قائمة حسابات العملاء مع تفاصيل العميل والمشاريع المسموحة
 */
router.get('/', async (req, res) => {
  try {
    const users = await db.query(`
      SELECT 
        cu.id,
        cu.client_id,
        cu.email,
        cu.phone,
        cu.full_name,
        cu.role,
        cu.status,
        cu.two_factor_enabled,
        cu.last_login_at,
        cu.last_login_ip,
        cu.device_platform,
        cu.created_at,
        c.name AS client_name,
        c.company AS client_company,
        (SELECT COUNT(id) FROM client_project_access WHERE client_user_id = cu.id) AS assigned_projects_count
      FROM client_users cu
      LEFT JOIN clients c ON c.id = cu.client_id
      ORDER BY cu.id DESC
    `);

    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (err) {
    console.error('Admin Client Users List Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب حسابات العملاء' });
  }
});

/**
 * POST /api/admin/client-users
 * إنشاء حساب جديد لمستخدم عميل
 */
router.post('/', async (req, res) => {
  try {
    const { client_id, email, password, full_name, phone, role, two_factor_enabled, project_ids } = req.body;

    if (!client_id || !email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'الحقول المطلوبة: العميل، البريد الإلكتروني، كلمة المرور، الاسم الكامل'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // التحقق من عدم تكرار البريد الإلكتروني
    const existing = await db.get(`SELECT id FROM client_users WHERE LOWER(email) = ?`, [cleanEmail]);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'البريد الإلكتروني مسجل بالفعل لمستخدم آخر'
      });
    }

    // التحقق من وجود العميل
    const client = await db.get(`SELECT id, name FROM clients WHERE id = ?`, [client_id]);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'العميل المحدد غير موجود في النظام'
      });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(String(password), salt);
    const userRole = ['owner', 'manager', 'viewer'].includes(role) ? role : 'viewer';
    const enable2fa = typeof two_factor_enabled === 'boolean' ? (two_factor_enabled ? 1 : 0) : 1;

    const result = await db.run(`
      INSERT INTO client_users 
      (client_id, email, phone, password_hash, full_name, role, status, two_factor_enabled, two_factor_pin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, '123456', CURRENT_TIMESTAMP)
    `, [
      client_id,
      cleanEmail,
      phone ? String(phone).trim() : null,
      passwordHash,
      String(full_name).trim(),
      userRole,
      enable2fa
    ]);

    const newUserId = result.lastID || result.lastInsertRowid;

    // تعيين المشاريع المسموحة إذا تم تمريرها
    if (Array.isArray(project_ids) && project_ids.length > 0) {
      for (const pId of project_ids) {
        await db.run(`
          INSERT INTO client_project_access 
          (client_user_id, project_id, can_view_progress, can_view_invoices, can_view_payments, can_view_reports, can_view_drawings, can_approve_invoices, can_send_messages, granted_by)
          VALUES (?, ?, 1, 1, 1, 1, 1, ?, 1, ?)
        `, [newUserId, pId, userRole === 'owner' ? 1 : 0, req.user?.id || 1]);
      }
    }

    res.json({
      success: true,
      message: 'تم إنشاء حساب العميل بنجاح',
      user_id: newUserId
    });
  } catch (err) {
    console.error('Create Client User Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في إنشاء حساب العميل' });
  }
});

/**
 * PUT /api/admin/client-users/:id
 * تعديل بيانات حساب العميل وحالته
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { full_name, phone, role, status, two_factor_enabled, two_factor_pin } = req.body;

    const user = await db.get(`SELECT id FROM client_users WHERE id = ?`, [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const updates = [];
    const params = [];

    if (full_name) { updates.push('full_name = ?'); params.push(String(full_name).trim()); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone ? String(phone).trim() : null); }
    if (role && ['owner', 'manager', 'viewer'].includes(role)) { updates.push('role = ?'); params.push(role); }
    if (status && ['active', 'inactive', 'suspended'].includes(status)) { updates.push('status = ?'); params.push(status); }
    if (typeof two_factor_enabled === 'boolean') { updates.push('two_factor_enabled = ?'); params.push(two_factor_enabled ? 1 : 0); }
    if (two_factor_pin) { updates.push('two_factor_pin = ?'); params.push(String(two_factor_pin).trim()); }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(userId);
      await db.run(`UPDATE client_users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    res.json({ success: true, message: 'تم تحديث بيانات الحساب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تعديل الحساب' });
  }
});

/**
 * POST /api/admin/client-users/:id/reset-password
 * إعادة تعيين كلمة مرور مستخدم العميل
 */
router.post('/:id/reset-password', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { new_password } = req.body;

    if (!new_password || String(new_password).length < 6) {
      return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(String(new_password), salt);

    await db.run(`UPDATE client_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [hash, userId]);

    res.json({ success: true, message: 'تمت إعادة تعيين كلمة المرور بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إعادة تعيين كلمة المرور' });
  }
});

/**
 * GET /api/admin/client-users/:id/projects
 * جلب المشاريع المخصصة للمستخدم
 */
router.get('/:id/projects', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const access = await db.query(`
      SELECT 
        cpa.*,
        p.name AS project_name,
        p.code AS project_code,
        p.status AS project_status
      FROM client_project_access cpa
      INNER JOIN projects p ON p.id = cpa.project_id
      WHERE cpa.client_user_id = ?
    `, [userId]);

    res.json({ success: true, access });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب صلاحيات المشاريع' });
  }
});

/**
 * POST /api/admin/client-users/:id/projects
 * تحديث صلاحيات الوصول للمشاريع
 */
router.post('/:id/projects', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { projects } = req.body; // Array of { project_id, can_approve_invoices, ... }

    if (!Array.isArray(projects)) {
      return res.status(400).json({ success: false, message: 'صيغة البيانات غير صحيحة' });
    }

    // حذف الصلاحيات السابقة وإعادة الإدراج
    await db.run(`DELETE FROM client_project_access WHERE client_user_id = ?`, [userId]);

    for (const p of projects) {
      await db.run(`
        INSERT INTO client_project_access 
        (client_user_id, project_id, can_view_progress, can_view_invoices, can_view_payments, can_view_reports, can_view_drawings, can_approve_invoices, can_send_messages, granted_by)
        VALUES (?, ?, 1, 1, 1, 1, 1, ?, 1, ?)
      `, [
        userId,
        p.project_id,
        p.can_approve_invoices ? 1 : 0,
        req.user?.id || 1
      ]);
    }

    res.json({ success: true, message: 'تم تحديث صلاحيات المشاريع بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث صلاحيات المشاريع' });
  }
});

module.exports = router;
