const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query, get, run } = require('../database/db');
const { verifyAdmin, getSecuritySettings } = require('./auth');
const { requirePermission } = require('../middleware/security');

// جلب بيانات الفروع والأقسام والمشاريع لنطاق الصلاحيات
router.get('/scopes-meta', requirePermission('settings:users'), async (req, res) => {
  try {
    const branches = await query('SELECT id, code, name FROM branches WHERE status = "active" ORDER BY id ASC');
    const departments = await query('SELECT id, code, name FROM departments WHERE status = "active" ORDER BY id ASC');
    const projects = await query('SELECT id, code, name, status FROM projects ORDER BY id ASC');
    const roles = await query('SELECT id, name, display_name FROM roles ORDER BY id ASC');
    res.json({ success: true, branches, departments, projects, roles });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات النطاقات: ' + err.message });
  }
});

// جلب المستخدمين والأدوار وحالة الاتصال الحية
router.get('/', requirePermission('settings:users'), async (req, res) => {
  try {
    const ACTIVE_THRESHOLD_MS = 75 * 1000;
    const now = Date.now();

    const users = await query(`
      SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.status, u.permissions, u.security_settings, u.two_factor_pin, u.two_factor_enabled, u.created_at,
             u.branch_id, u.branch, u.department_id, u.department, u.allowed_projects, u.allowed_branches, u.allowed_departments,
             u.is_logged_in, u.last_heartbeat, u.last_login_at, u.last_login_ip, u.last_login_device,
             r.display_name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      ORDER BY u.id ASC
    `);

    // Parse permissions & active status & security_settings
    const parsedUsers = (users || []).map(u => {
      let perms = [];
      if (u.permissions) {
        try {
          perms = typeof u.permissions === 'string' && (u.permissions.startsWith('[') || u.permissions.startsWith('{'))
            ? JSON.parse(u.permissions)
            : u.permissions.split(',').map(s => s.trim()).filter(Boolean);
        } catch (e) {
          perms = u.permissions.split(',').map(s => s.trim()).filter(Boolean);
        }
      }

      let secSettings = null;
      if (u.security_settings) {
        try {
          secSettings = typeof u.security_settings === 'string'
            ? JSON.parse(u.security_settings)
            : u.security_settings;
        } catch (e) {}
      }

      let allowedPrjs = '*';
      if (u.allowed_projects) {
        try {
          allowedPrjs = typeof u.allowed_projects === 'string' && (u.allowed_projects.startsWith('[') || u.allowed_projects.startsWith('{'))
            ? JSON.parse(u.allowed_projects)
            : u.allowed_projects;
        } catch (e) {
          allowedPrjs = u.allowed_projects;
        }
      }

      let isOnline = false;
      if (u.is_logged_in === 1 && u.last_heartbeat) {
        const diff = now - new Date(u.last_heartbeat).getTime();
        if (!isNaN(diff) && diff < ACTIVE_THRESHOLD_MS) {
          isOnline = true;
        }
      }

      return { 
        ...u, 
        two_factor_pin: u.two_factor_pin || (u.role === 'admin' || u.username === 'admin' ? '123456' : ''),
        two_factor_enabled: u.two_factor_enabled !== undefined && u.two_factor_enabled !== null ? u.two_factor_enabled : 1,
        branch_id: u.branch_id || 1,
        branch: u.branch || 'المركز الرئيسي',
        department_id: u.department_id || 1,
        department: u.department || 'الإدارة العامة',
        allowed_projects: allowedPrjs,
        allowed_branches: u.allowed_branches || '*',
        allowed_departments: u.allowed_departments || '*',
        permissions_list: perms,
        security_settings: secSettings,
        is_currently_online: isOnline
      };
    });

    const roles = await query('SELECT * FROM roles ORDER BY id ASC');
    res.json({ success: true, data: parsedUsers, roles });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخدمين', error: err.message });
  }
});

// إضافة مستخدم جديد مع الصلاحيات
router.post('/', requirePermission('settings:users'), async (req, res) => {
  try {
    const { 
      username, password, full_name, role_id, role, email, phone, status = 'active', 
      permissions, security_settings, two_factor_pin, two_factor_enabled,
      branch_id, branch, department_id, department, allowed_projects, allowed_branches, allowed_departments
    } = req.body;
    
    if (!username || !password || !full_name) {
      return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور والاسم الكامل حقول مطلوبة' });
    }

    const cleanUsername = username.trim();
    const existing = await get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [cleanUsername]);
    if (existing) {
      return res.status(400).json({ success: false, message: `اسم المستخدم (${cleanUsername}) مسجل مسبقاً، يرجى اختيار اسم آخر.` });
    }

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);

    let roleName = role || 'accountant';
    let roleIdVal = role_id;
    if (role_id) {
      const roleObj = await get('SELECT name FROM roles WHERE id = ?', [role_id]);
      if (roleObj) roleName = roleObj.name;
    } else if (role) {
      const roleObj = await get('SELECT id FROM roles WHERE name = ?', [role]);
      if (roleObj) roleIdVal = roleObj.id;
    }

    const permsString = Array.isArray(permissions) ? JSON.stringify(permissions) : (permissions || '');
    const secString = security_settings ? (typeof security_settings === 'string' ? security_settings : JSON.stringify(security_settings)) : null;

    const allowedProjectsStr = Array.isArray(allowed_projects) 
      ? JSON.stringify(allowed_projects) 
      : (allowed_projects || '*');
    const allowedBranchesStr = Array.isArray(allowed_branches) 
      ? JSON.stringify(allowed_branches) 
      : (allowed_branches || '*');
    const allowedDepartmentsStr = Array.isArray(allowed_departments) 
      ? JSON.stringify(allowed_departments) 
      : (allowed_departments || '*');

    const cleanPin = two_factor_pin !== undefined ? (String(two_factor_pin).replace(/\D/g, '').slice(0, 6) || '123456') : '123456';
    const tfaEnabled = two_factor_enabled !== undefined ? (two_factor_enabled ? 1 : 0) : 1;

    const result = await run(`
      INSERT INTO users (
        username, password_hash, full_name, role_id, role, email, phone, status, 
        permissions, security_settings, two_factor_pin, two_factor_enabled,
        branch_id, branch, department_id, department, allowed_projects, allowed_branches, allowed_departments
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      cleanUsername, password_hash, full_name.trim(), roleIdVal || 2, roleName, email || '', phone || '', status, 
      permsString, secString, cleanPin, tfaEnabled,
      branch_id || 1, branch || 'المركز الرئيسي', department_id || 1, department || 'الإدارة العامة',
      allowedProjectsStr, allowedBranchesStr, allowedDepartmentsStr
    ]);

    if (cleanUsername === 'admin') {
      try {
        await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_pin', ?)", [cleanPin]);
        await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_enabled', ?)", [String(tfaEnabled)]);
      } catch (e) {}
    }

    const newId = result.insertId || result.lastInsertRowid;
    const insertedUser = await get(`
      SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.status, u.permissions, u.security_settings, u.two_factor_pin, u.two_factor_enabled, u.created_at,
             u.branch_id, u.branch, u.department_id, u.department, u.allowed_projects, u.allowed_branches, u.allowed_departments,
             r.display_name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [newId]);

    if (!insertedUser) {
      throw new Error('فشل التحقق من حفظ المستخدم في قاعدة البيانات');
    }

    res.json({
      success: true,
      message: `تم إضافة المستخدم (${insertedUser.full_name}) وتعيين صلاحياته ونطاقه بنجاح!`,
      data: insertedUser
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء إنشاء المستخدم: ' + err.message });
  }
});

// تعديل بيانات وصلاحيات مستخدم
router.put('/:id', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { 
      username, password, full_name, role_id, role, email, phone, status, 
      permissions, security_settings, two_factor_pin, two_factor_enabled,
      branch_id, branch, department_id, department, allowed_projects, allowed_branches, allowed_departments
    } = req.body;

    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // Check username uniqueness if changed
    if (username && username.trim().toLowerCase() !== user.username.toLowerCase()) {
      const dup = await get('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?', [username.trim(), userId]);
      if (dup) {
        return res.status(400).json({ success: false, message: `اسم المستخدم (${username}) مسجل لمستخدم آخر.` });
      }
    }

    let roleName = role || user.role;
    let roleIdVal = role_id !== undefined ? role_id : user.role_id;
    if (role_id) {
      const roleObj = await get('SELECT name FROM roles WHERE id = ?', [role_id]);
      if (roleObj) roleName = roleObj.name;
    }

    const permsString = Array.isArray(permissions) ? JSON.stringify(permissions) : (permissions !== undefined ? permissions : user.permissions);

    const secString = security_settings !== undefined
      ? (security_settings ? (typeof security_settings === 'string' ? security_settings : JSON.stringify(security_settings)) : null)
      : user.security_settings;

    const allowedProjectsStr = allowed_projects !== undefined 
      ? (Array.isArray(allowed_projects) ? JSON.stringify(allowed_projects) : allowed_projects)
      : user.allowed_projects;
    const allowedBranchesStr = allowed_branches !== undefined
      ? (Array.isArray(allowed_branches) ? JSON.stringify(allowed_branches) : allowed_branches)
      : user.allowed_branches;
    const allowedDepartmentsStr = allowed_departments !== undefined
      ? (Array.isArray(allowed_departments) ? JSON.stringify(allowed_departments) : allowed_departments)
      : user.allowed_departments;

    const branchIdVal = branch_id !== undefined ? branch_id : (user.branch_id || 1);
    const branchVal = branch !== undefined ? branch : (user.branch || 'المركز الرئيسي');
    const deptIdVal = department_id !== undefined ? department_id : (user.department_id || 1);
    const deptVal = department !== undefined ? department : (user.department || 'الإدارة العامة');

    const cleanPin = two_factor_pin !== undefined 
      ? (String(two_factor_pin).replace(/\D/g, '').slice(0, 6) || user.two_factor_pin || '123456')
      : (user.two_factor_pin || '123456');
    const tfaEnabled = two_factor_enabled !== undefined 
      ? (two_factor_enabled ? 1 : 0) 
      : (user.two_factor_enabled !== undefined && user.two_factor_enabled !== null ? user.two_factor_enabled : 1);

    if (password && password.trim().length > 0) {
      const salt = bcrypt.genSaltSync(10);
      const password_hash = bcrypt.hashSync(password, salt);
      await run(`
        UPDATE users
        SET username = ?, password_hash = ?, full_name = ?, role_id = ?, role = ?, email = ?, phone = ?, status = ?, 
            permissions = ?, security_settings = ?, two_factor_pin = ?, two_factor_enabled = ?,
            branch_id = ?, branch = ?, department_id = ?, department = ?, 
            allowed_projects = ?, allowed_branches = ?, allowed_departments = ?
        WHERE id = ?
      `, [
        username ? username.trim() : user.username,
        password_hash,
        full_name ? full_name.trim() : user.full_name,
        roleIdVal,
        roleName,
        email !== undefined ? email : user.email,
        phone !== undefined ? phone : user.phone,
        status || user.status,
        permsString,
        secString,
        cleanPin,
        tfaEnabled,
        branchIdVal,
        branchVal,
        deptIdVal,
        deptVal,
        allowedProjectsStr,
        allowedBranchesStr,
        allowedDepartmentsStr,
        userId
      ]);
    } else {
      await run(`
        UPDATE users
        SET username = ?, full_name = ?, role_id = ?, role = ?, email = ?, phone = ?, status = ?, 
            permissions = ?, security_settings = ?, two_factor_pin = ?, two_factor_enabled = ?,
            branch_id = ?, branch = ?, department_id = ?, department = ?, 
            allowed_projects = ?, allowed_branches = ?, allowed_departments = ?
        WHERE id = ?
      `, [
        username ? username.trim() : user.username,
        full_name ? full_name.trim() : user.full_name,
        roleIdVal,
        roleName,
        email !== undefined ? email : user.email,
        phone !== undefined ? phone : user.phone,
        status || user.status,
        permsString,
        secString,
        cleanPin,
        tfaEnabled,
        branchIdVal,
        branchVal,
        deptIdVal,
        deptVal,
        allowedProjectsStr,
        allowedBranchesStr,
        allowedDepartmentsStr,
        userId
      ]);
    }

    if (user.username === 'admin' || user.id === 1 || (username && username.trim().toLowerCase() === 'admin')) {
      try {
        await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_pin', ?)", [cleanPin]);
        await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_enabled', ?)", [String(tfaEnabled)]);
      } catch (e) {}
    }

    const updatedUser = await get(`
      SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.status, u.permissions, u.security_settings, u.two_factor_pin, u.two_factor_enabled, u.created_at,
             u.branch_id, u.branch, u.department_id, u.department, u.allowed_projects, u.allowed_branches, u.allowed_departments,
             r.display_name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [userId]);

    res.json({
      success: true,
      message: `تم تحديث بيانات وصلاحيات ونطاق المستخدم (${updatedUser.full_name}) بنجاح!`,
      data: updatedUser
    });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء تحديث المستخدم: ' + err.message });
  }
});

// تبديل حالة المستخدم (نشط / معطل)
router.patch('/:id/status', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.username === 'admin' && user.status === 'active') {
      return res.status(400).json({ success: false, message: 'لا يمكن تعطيل حساب المدير العام الرئيسي للنظام' });
    }

    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    await run('UPDATE users SET status = ? WHERE id = ?', [newStatus, userId]);

    const statusLabel = newStatus === 'active' ? 'تنشيط' : 'تعطيل';
    res.json({
      success: true,
      message: `تم ${statusLabel} حساب المستخدم (${user.full_name}) بنجاح.`,
      newStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تغيير حالة المستخدم', error: err.message });
  }
});

// حذف مستخدم
router.delete('/:id', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.username === 'admin' || user.id === 1) {
      return res.status(400).json({ success: false, message: 'لا يمكن حذف حساب المدير العام الرئيسي للنظام' });
    }

    await run('DELETE FROM users WHERE id = ?', [userId]);
    res.json({
      success: true,
      message: `تم حذف المستخدم (${user.full_name}) بنجاح.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء حذف المستخدم', error: err.message });
  }
});

// إنهاء جلسة مستخدم وفصله عن النظام (Disconnect Active Session)
router.post('/:id/disconnect', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT id, username, full_name FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    await run("UPDATE users SET is_logged_in = 0, session_token = NULL, last_heartbeat = NULL WHERE id = ?", [userId]);
    res.json({
      success: true,
      message: `تم إنهاء جلسة المستخدم (${user.full_name || user.username}) وفصله عن النظام بنجاح.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إنهاء جلسة المستخدم', error: err.message });
  }
});
// جلب إعدادات الأمان وسياسة الجلسات المخصصة لمستخدم محدد
router.get('/:id/security-settings', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT id, username, full_name, role, security_settings FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const defaultSettings = await getSecuritySettings();
    let userCustom = null;
    let isCustom = false;

    if (user.security_settings) {
      try {
        userCustom = typeof user.security_settings === 'string'
          ? JSON.parse(user.security_settings)
          : user.security_settings;
        isCustom = !!(userCustom && typeof userCustom === 'object');
      } catch {}
    }

    const effectiveSettings = Object.assign({}, defaultSettings, userCustom || {});

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      },
      isCustom,
      settings: effectiveSettings,
      defaultSettings
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب إعدادات أمان المستخدم: ' + err.message });
  }
});

// حفظ أو إعادة ضبط إعدادات الأمان والجلسات لمستخدم محدد (مقتصرة حصرياً على حساب المدير العام)
router.post('/:id/security-settings', verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT id, username, full_name, role FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const { session_mode, session_device_limit, session_overflow_action, jwt_token_expiry, jwt_custom_minutes, work_start_time, work_end_time, work_hours_enabled, reset_to_default } = req.body || {};

    if (reset_to_default) {
      await run('UPDATE users SET security_settings = NULL WHERE id = ?', [userId]);
      const defaults = await getSecuritySettings();
      return res.json({
        success: true,
        message: `تمت استعادة الإعدادات العامة الافتراضية للنظام للمستخدم (${user.full_name}) بنجاح 🛡️`,
        isCustom: false,
        settings: defaults
      });
    }

    const validModes = ['multi', 'single'];
    const validOverflow = ['kick_oldest', 'block_new', 'lock_device'];
    const validExpiries = ['1h', '4h', '8h', '24h', '7d', '30d', 'custom'];

    let existingSec = {};
    const fullUser = await get('SELECT security_settings FROM users WHERE id = ?', [userId]);
    if (fullUser && fullUser.security_settings) {
      try { existingSec = JSON.parse(fullUser.security_settings); } catch (e) {}
    }
    const userSec = Object.assign({}, existingSec);

    if (req.body.reset_authorized_device) {
      delete userSec.authorized_device_id;
      delete userSec.authorized_device_name;
      delete userSec.authorized_device_at;
    }

    if (session_mode && validModes.includes(session_mode)) {
      userSec.session_mode = session_mode;
    }
    if (session_device_limit) {
      userSec.session_device_limit = Number(session_device_limit) || 1;
    }
    if (session_overflow_action && validOverflow.includes(session_overflow_action)) {
      userSec.session_overflow_action = session_overflow_action;
      if (session_overflow_action === 'lock_device') {
        userSec.session_mode = 'single';
        userSec.session_device_limit = 1;
      }
    }
    if (jwt_token_expiry && validExpiries.includes(jwt_token_expiry)) {
      userSec.jwt_token_expiry = jwt_token_expiry;
    }
    if (jwt_custom_minutes && Number(jwt_custom_minutes) > 0) {
      userSec.jwt_custom_minutes = Number(jwt_custom_minutes);
    }
    if (work_start_time) {
      userSec.work_start_time = String(work_start_time);
    }
    if (work_end_time) {
      userSec.work_end_time = String(work_end_time);
    }
    if (work_hours_enabled !== undefined) {
      userSec.work_hours_enabled = !!work_hours_enabled;
    }

    const secJson = JSON.stringify(userSec);
    await run('UPDATE users SET security_settings = ? WHERE id = ?', [secJson, userId]);

    const effectiveSettings = await getSecuritySettings({ security_settings: secJson });

    res.json({
      success: true,
      message: `تم حفظ وتطبيق خيارات الأمان وسياسة الجلسات المخصصة للمستخدم (${user.full_name}) بنجاح 🛡️`,
      isCustom: true,
      settings: effectiveSettings
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ إعدادات أمان المستخدم: ' + err.message });
  }
});

// فك قفل الجهاز المعتمد لمستخدم محدد (حصرياً للمدير العام)
router.post('/:id/reset-device', verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT id, username, full_name, security_settings FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    let sec = {};
    if (user.security_settings) {
      try { sec = JSON.parse(user.security_settings); } catch (e) {}
    }
    delete sec.authorized_device_id;
    delete sec.authorized_device_name;
    delete sec.authorized_device_at;

    await run('UPDATE users SET security_settings = ? WHERE id = ?', [JSON.stringify(sec), userId]);
    res.json({
      success: true,
      message: `تم فك قفل الجهاز للمستخدم (${user.full_name || user.username}) بنجاح. سيتم اعتماد أول جهاز جديد يسجل منه.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ: ' + err.message });
  }
});

module.exports = router;

