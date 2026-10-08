const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { get, query, run, connectionManager } = require('../database/db');
const {
  loginRateLimiter,
  recordFailedLogin,
  resetLoginAttempts,
  generateCsrfToken,
  requireAuth,
  JWT_SECRET
} = require('../middleware/security');

function getRoleDefaultPermissions(role) {
  switch (role) {
    case 'admin':
      return ['*'];
    case 'accountant':
      return [
        'dashboard:view', 'dashboard:export',
        'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:export',
        'expenses:view', 'expenses:create', 'expenses:edit', 'expenses:export',
        'revenues:view', 'revenues:create', 'revenues:edit', 'revenues:export',
        'billing:view', 'billing:create', 'billing:edit', 'billing:export',
        'custody:view', 'custody:create', 'custody:edit', 'custody:export',
        'clients:view', 'clients:create', 'clients:edit', 'clients:export',
        'suppliers:view', 'suppliers:create', 'suppliers:edit', 'suppliers:export',
        'cash:view',
        'hr:view', 'hr:payroll',
        'reports:view', 'reports:export'
      ];
    case 'auditor':
      return [
        'dashboard:view', 'dashboard:export',
        'accounting:view', 'accounting:approve', 'accounting:post', 'accounting:export',
        'expenses:view', 'expenses:approve', 'expenses:export',
        'revenues:view', 'revenues:approve', 'revenues:export',
        'billing:view', 'billing:approve', 'billing:export',
        'custody:view', 'custody:approve', 'custody:export',
        'projects:view', 'projects:export',
        'inventory:view', 'inventory:export',
        'purchases:view', 'purchases:approve', 'purchases:export',
        'hr:view', 'hr:approve', 'hr:export',
        'reports:view', 'reports:export',
        'cash:view'
      ];
    case 'project_manager':
      return [
        'dashboard:view',
        'projects:view', 'projects:create', 'projects:edit', 'projects:approve', 'projects:export',
        'expenses:view', 'expenses:create',
        'custody:view',
        'inventory:view', 'inventory:issue',
        'reports:view'
      ];
    case 'storekeeper':
      return [
        'inventory:view', 'inventory:create', 'inventory:edit', 'inventory:issue', 'inventory:export',
        'purchases:view',
        'projects:view'
      ];
    default:
      return ['dashboard:view'];
  }
}

function parseUserPermissions(user) {
  let permissionsList = [];
  if (user.permissions) {
    try {
      permissionsList = typeof user.permissions === 'string' && (user.permissions.startsWith('[') || user.permissions.startsWith('{'))
        ? JSON.parse(user.permissions)
        : user.permissions.split(',').map(s => s.trim()).filter(Boolean);
    } catch (e) {
      permissionsList = user.permissions.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  if (!permissionsList || permissionsList.length === 0) {
    permissionsList = getRoleDefaultPermissions(user.role);
  }

  return permissionsList;
}

// دالة لمعالجة وتوحيد التوقيت الزمني لـ Heartbeat بدون التباس المناطق الزمنية
function getHeartbeatTimestamp(hb) {
  if (!hb) return 0;
  if (typeof hb === 'number') return hb;
  const str = String(hb).trim();
  if (!str) return 0;
  if (str.endsWith('Z') || str.includes('+')) return new Date(str).getTime();
  return new Date(str.replace(' ', 'T') + 'Z').getTime();
}

// التحقق من أن المستخدم المتصل هو المدير العام (Admin Only)
function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'يرجى تسجيل الدخول بحساب المدير العام لتنفيذ هذا الإجراء' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.username !== 'admin') {
      return res.status(403).json({ success: false, message: 'عذراً! ضبط وتعديل خيارات الأمان متاح حصرياً لحساب المدير العام' });
    }
    req.adminUser = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'جلسة المدير العام غير صالحة أو منتهية، يرجى إعادة تسجيل الدخول' });
  }
}

// دالة مساعدة لتنسيق الوقت بالعربية
function formatTimeArabic(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'مساءً' : 'صباحاً';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

// دالة مساعدة لجلب إعدادات الأمان وسياسة الجلسات والتوكن
async function getSecuritySettings(user = null) {
  const defaults = {
    session_mode: 'multi',
    session_device_limit: 3,
    session_overflow_action: 'kick_oldest',
    jwt_token_expiry: '8h',
    jwt_custom_minutes: 480,
    work_start_time: '08:00',
    work_end_time: '16:00',
    work_hours_enabled: false
  };
  try {
    const rows = await query("SELECT `key`, `value` FROM settings WHERE `key` IN ('session_mode', 'session_device_limit', 'session_overflow_action', 'jwt_token_expiry', 'jwt_custom_minutes', 'work_start_time', 'work_end_time')");
    if (rows && rows.length > 0) {
      rows.forEach(r => {
        if (r.key === 'session_device_limit' || r.key === 'jwt_custom_minutes') {
          defaults[r.key] = Number(r.value) || defaults[r.key];
        } else if (r.value) {
          defaults[r.key] = r.value;
        }
      });
    }
  } catch (e) {
    console.warn('Could not read security settings from DB, using defaults:', e.message);
  }

  if (user && user.security_settings) {
    try {
      const userCustom = typeof user.security_settings === 'string'
        ? JSON.parse(user.security_settings)
        : user.security_settings;
      if (userCustom && typeof userCustom === 'object') {
        return Object.assign({}, defaults, userCustom, { is_custom: true });
      }
    } catch (e) {}
  }

  return defaults;
}

// 0.1 توليد والحصول على رمز CSRF للواجهة الأمامية
router.get('/csrf-token', (req, res) => {
  const token = generateCsrfToken();
  res.json({ success: true, csrfToken: token });
});

// 0.2 جلب إعدادات الأمان وسياسة الجلسات العامة
router.get('/security-settings', async (req, res) => {
  try {
    const settings = await getSecuritySettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب إعدادات الأمان: ' + err.message });
  }
});

// 0.3 حفظ وتطبيق إعدادات الأمان وسياسة الجلسات
router.post('/security-settings', verifyAdmin, async (req, res) => {
  try {
    const { session_mode, session_device_limit, session_overflow_action, jwt_token_expiry, jwt_custom_minutes, work_start_time, work_end_time } = req.body || {};

    const validModes = ['multi', 'single'];
    const validLimits = [2, 3, 5];
    const validOverflow = ['kick_oldest', 'block_new', 'lock_device'];
    const validExpiries = ['1h', '4h', '8h', '24h', '7d', '30d', 'custom'];

    const updates = {};
    if (session_mode && validModes.includes(session_mode)) {
      updates['session_mode'] = session_mode;
    }
    if (session_device_limit && (validLimits.includes(Number(session_device_limit)) || Number(session_device_limit) > 0)) {
      updates['session_device_limit'] = String(Number(session_device_limit));
    }
    if (session_overflow_action && validOverflow.includes(session_overflow_action)) {
      updates['session_overflow_action'] = session_overflow_action;
    }
    if (jwt_token_expiry && validExpiries.includes(jwt_token_expiry)) {
      updates['jwt_token_expiry'] = jwt_token_expiry;
    }
    if (jwt_custom_minutes && Number(jwt_custom_minutes) > 0) {
      updates['jwt_custom_minutes'] = String(Number(jwt_custom_minutes));
    }
    if (work_start_time) {
      updates['work_start_time'] = String(work_start_time);
    }
    if (work_end_time) {
      updates['work_end_time'] = String(work_end_time);
    }

    for (const [k, v] of Object.entries(updates)) {
      await run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [k, String(v)]);
    }

    const current = await getSecuritySettings();
    res.json({ success: true, message: 'تم حفظ وتطبيق إعدادات الأمان وسياسة الجلسات بنجاح 🛡️', settings: current });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ إعدادات الأمان: ' + err.message });
  }
});

// 0.4 جلب حالة وتفاصيل التحقق بخطوتين (2FA) للمدير العام
router.get('/2fa-status', verifyAdmin, async (req, res) => {
  try {
    const row2fa = await get("SELECT value FROM settings WHERE `key` = 'admin_2fa_enabled'");
    const rowPin = await get("SELECT value FROM settings WHERE `key` = 'admin_2fa_pin'");
    const isEnabled = row2fa ? (row2fa.value === '1' || row2fa.value === 'true') : true;
    const pin = rowPin && rowPin.value ? rowPin.value : '123456';
    res.json({ success: true, enabled: isEnabled, pin, backupCode: '889900' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 0.5 تحديث إعدادات 2FA للمدير العام
router.post('/2fa-config', verifyAdmin, async (req, res) => {
  try {
    const { enabled, pin } = req.body;
    if (enabled !== undefined) {
      await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_enabled', ?)", [enabled ? '1' : '0']);
    }
    if (pin && String(pin).trim().length >= 4) {
      await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_pin', ?)", [String(pin).trim()]);
    }
    res.json({ success: true, message: 'تم تحديث إعدادات التحقق بخطوتين (2FA) بنجاح 🛡️' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// دالة مركزية لإكمال جلسة تسجيل الدخول وتوليد التوكنات
async function completeLoginSession(user, req, res, { force, deviceInfo, deviceId, deviceName } = {}) {
  const secSettings = await getSecuritySettings(user);

  // فحص فترة وساعات العمل
  if (user.username !== 'admin' && (secSettings.jwt_token_expiry === 'custom' || secSettings.work_hours_enabled)) {
    const startTime = secSettings.work_start_time || '08:00';
    const endTime = secSettings.work_end_time || '16:00';
    const now = new Date();
    const currentH = now.getHours();
    const currentM = now.getMinutes();
    const currentTimeStr = `${String(currentH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`;

    let isAllowed = false;
    if (startTime <= endTime) {
      isAllowed = (currentTimeStr >= startTime && currentTimeStr <= endTime);
    } else {
      isAllowed = (currentTimeStr >= startTime || currentTimeStr <= endTime);
    }

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        outside_work_hours: true,
        message: `عذراً (${user.full_name || user.username})! الحساب مبرمج بفترة عمل محددة من الساعة (${formatTimeArabic(startTime)}) إلى الساعة (${formatTimeArabic(endTime)}). لا يُسمح بتسجيل الدخول خارج أوقات العمل الرسمية.`
      });
    }
  }

  // حساب مدة صلاحية التوكن (JWT)
  let tokenExpiry = secSettings.jwt_token_expiry || '8h';
  if (tokenExpiry === 'custom') {
    const startTime = secSettings.work_start_time || '08:00';
    const endTime = secSettings.work_end_time || '16:00';
    const now = new Date();
    const currentH = now.getHours();
    const currentM = now.getMinutes();
    const [endH, endM] = endTime.split(':').map(Number);

    let remainingMins = (endH * 60 + endM) - (currentH * 60 + currentM);
    if (remainingMins <= 0 && startTime > endTime) {
      remainingMins += 24 * 60;
    }
    if (remainingMins <= 0 || isNaN(remainingMins)) remainingMins = 60;
    tokenExpiry = `${remainingMins}m`;
  }

  // استخراج الجلسات النشطة المخزنة
  const ACTIVE_THRESHOLD_MS = 75 * 1000;
  const nowMs = Date.now();
  let activeSessions = [];
  try {
    activeSessions = user.active_sessions ? JSON.parse(user.active_sessions) : [];
  } catch (e) {
    activeSessions = [];
  }
  if (!Array.isArray(activeSessions)) activeSessions = [];

  activeSessions = activeSessions.filter(s => {
    const hb = s.lastHeartbeatMs || getHeartbeatTimestamp(s.lastHeartbeat);
    return (nowMs - hb) < ACTIVE_THRESHOLD_MS;
  });

  if (activeSessions.length === 0 && user.is_logged_in === 1 && user.session_token && user.last_heartbeat) {
    const lastHb = getHeartbeatTimestamp(user.last_heartbeat);
    if ((nowMs - lastHb) < ACTIVE_THRESHOLD_MS) {
      activeSessions.push({
        sessionId: user.session_token,
        device: user.last_login_device || 'متصفح النظام',
        ip: user.last_login_ip || '',
        loginAt: user.last_login_at || user.last_heartbeat,
        lastHeartbeat: user.last_heartbeat,
        lastHeartbeatMs: lastHb
      });
    }
  }

  const isSingleMode = secSettings.session_mode === 'single' || secSettings.session_overflow_action === 'lock_device';
  const maxDevices = isSingleMode ? 1 : (Number(secSettings.session_device_limit) || 3);
  const overflowAction = secSettings.session_overflow_action || 'kick_oldest';

  const incomingDeviceId = String(deviceId || '').trim();
  const incomingDeviceName = String(deviceName || deviceInfo || 'جهاز النظام').trim();

  if (overflowAction === 'lock_device') {
    const isSuperAdmin = (user.username === 'admin');

    if (!secSettings.authorized_device_id) {
      if (incomingDeviceId) {
        secSettings.authorized_device_id = incomingDeviceId;
        secSettings.authorized_device_name = incomingDeviceName;
        secSettings.authorized_device_at = new Date().toISOString();

        let userSecObj = {};
        try {
          userSecObj = user.security_settings ? JSON.parse(user.security_settings) : {};
        } catch (e) { userSecObj = {}; }
        userSecObj.authorized_device_id = incomingDeviceId;
        userSecObj.authorized_device_name = incomingDeviceName;
        userSecObj.authorized_device_at = secSettings.authorized_device_at;
        userSecObj.session_overflow_action = 'lock_device';
        userSecObj.session_mode = 'single';
        userSecObj.session_device_limit = 1;

        await run('UPDATE users SET security_settings = ? WHERE id = ?', [JSON.stringify(userSecObj), user.id]);
      }
    } else {
      if (incomingDeviceId && incomingDeviceId !== secSettings.authorized_device_id) {
        if (!isSuperAdmin || !force) {
          return res.status(403).json({
            success: false,
            device_locked: true,
            message: `⛔ تم رفض الدخول: هذا الحساب مقفل ومصرح له بالدخول من جهاز واحد فقط معتمد (${secSettings.authorized_device_name || 'الجهاز المعتمد'}). يمنع النظام تماماً تسجيل الدخول من أي جهاز جديد آخر.`
          });
        }
      }
    }
    activeSessions = [];
  }

  if (activeSessions.length >= maxDevices) {
    if (overflowAction === 'block_new' && !force) {
      const policyDesc = isSingleMode ? 'جلسة واحدة صارمة' : `سقف الجلسات المتعددة (${maxDevices} أجهزة)`;
      return res.status(409).json({
        success: false,
        already_logged_in: true,
        limit_exceeded: true,
        message: `المستخدم (${user.full_name || user.username}) متصل حالياً وبلغ الحد الأقصى للجلسات (${policyDesc}). لمنع التكرار والحفاظ على سرية البيانات، لا يمكن فتح جلسة جديدة.`,
        last_active: user.last_heartbeat,
        last_login_device: user.last_login_device,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name
        }
      });
    } else {
      activeSessions.sort((a, b) => {
        const tA = a.lastHeartbeatMs || getHeartbeatTimestamp(a.lastHeartbeat || a.loginAt);
        const tB = b.lastHeartbeatMs || getHeartbeatTimestamp(b.lastHeartbeat || b.loginAt);
        return tA - tB;
      });
      while (activeSessions.length >= maxDevices) {
        activeSessions.shift();
      }
    }
  }

  const permissionsList = parseUserPermissions(user);
  const sessionId = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2));
  const nowIsoDb = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const nowIsoFull = new Date().toISOString();
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const deviceStr = deviceInfo || req.headers['user-agent'] || 'متصفح النظام';

  activeSessions.push({
    sessionId,
    ip: String(clientIp),
    device: String(deviceStr).substring(0, 200),
    loginAt: nowIsoDb,
    lastHeartbeat: nowIsoFull,
    lastHeartbeatMs: nowMs
  });

  const userScope = {
    allowed_projects: user.allowed_projects || '*',
    allowed_branches: user.allowed_branches || '*',
    allowed_departments: user.allowed_departments || '*',
    branch_id: user.branch_id || 1,
    branch: user.branch || 'المركز الرئيسي',
    department_id: user.department_id || 1,
    department: user.department || 'الإدارة العامة'
  };

  const token = jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      full_name: user.full_name, 
      permissions: permissionsList, 
      scope: userScope,
      sessionId 
    },
    JWT_SECRET,
    { expiresIn: tokenExpiry }
  );

  const csrfToken = generateCsrfToken(sessionId);

  await run(`
    UPDATE users SET 
      is_logged_in = 1,
      session_token = ?,
      active_sessions = ?,
      last_heartbeat = ?,
      last_login_at = ?,
      last_login_ip = ?,
      last_login_device = ?
    WHERE id = ?
  `, [sessionId, JSON.stringify(activeSessions), nowIsoDb, nowIsoDb, String(clientIp), String(deviceStr).substring(0, 250), user.id]);

  let dbStatus = connectionManager ? connectionManager.getStatus() : { isOnline: false, mode: 'offline' };

  // نجاح الدخول - تصفير محاولات Rate Limit
  resetLoginAttempts(req);

  return res.json({
    success: true,
    message: `مرحباً بك ${user.full_name}! تم تسجيل الدخول بنجاح`,
    token,
    csrfToken,
    sessionId,
    dbStatus,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      status: user.status,
      branch_id: user.branch_id || 1,
      branch: user.branch || 'المركز الرئيسي',
      department_id: user.department_id || 1,
      department: user.department || 'الإدارة العامة',
      allowed_projects: user.allowed_projects || '*',
      allowed_branches: user.allowed_branches || '*',
      allowed_departments: user.allowed_departments || '*',
      permissions: permissionsList
    }
  });
}

// 1. تسجيل الدخول (Login) مع فحص محدد المحاولات Rate Limiter والتحقق بخطوتين 2FA
router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { username, password, force, deviceInfo, deviceId, deviceName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
    }

    const cleanUsername = String(username).trim();
    const user = await get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [cleanUsername]);
    
    if (!user) {
      const failInfo = recordFailedLogin(req);
      if (failInfo.isLocked) {
        return res.status(429).json({
          success: false,
          rateLimited: true,
          lockoutSeconds: failInfo.lockoutSeconds,
          remainingAttempts: 0,
          message: `⛔ تم تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). تم قفل تسجيل الدخول مؤقتاً لمدة ${failInfo.lockoutSeconds} ثانية لحماية الحساب.`
        });
      }
      return res.status(401).json({
        success: false,
        remainingAttempts: failInfo.remainingAttempts,
        message: `اسم المستخدم أو كلمة المرور غير صحيحة (متبقي ${failInfo.remainingAttempts} محاولات قبل القفل المؤقت)`
      });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'هذا الحساب معطل حالياً، يرجى مراجعة إدارة النظام' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      const failInfo = recordFailedLogin(req);
      if (failInfo.isLocked) {
        return res.status(429).json({
          success: false,
          rateLimited: true,
          lockoutSeconds: failInfo.lockoutSeconds,
          remainingAttempts: 0,
          message: `⛔ تم تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). تم قفل تسجيل الدخول مؤقتاً لمدة ${failInfo.lockoutSeconds} ثانية لحماية الحساب.`
        });
      }
      return res.status(401).json({
        success: false,
        remainingAttempts: failInfo.remainingAttempts,
        message: `اسم المستخدم أو كلمة المرور غير صحيحة (متبقي ${failInfo.remainingAttempts} محاولات قبل القفل المؤقت)`
      });
    }

    // التحقق هل الحساب مفعل له 2FA (المدير العام أو أي مستخدم مفعّل له التحقق بخطوتين)
    let is2FaEnabled = (user.two_factor_enabled !== undefined && user.two_factor_enabled !== null)
      ? (user.two_factor_enabled === 1 || user.two_factor_enabled === '1' || user.two_factor_enabled === true)
      : (user.role === 'admin' || user.username === 'admin');

    if (user.role === 'admin' || user.username === 'admin') {
      try {
        const row2fa = await get("SELECT value FROM settings WHERE `key` = 'admin_2fa_enabled'");
        if (row2fa && (user.two_factor_enabled === undefined || user.two_factor_enabled === null)) {
          is2FaEnabled = (row2fa.value === '1' || row2fa.value === 'true');
        }
      } catch (e) {}
    }

    if (is2FaEnabled) {
      const tempToken = jwt.sign(
        { id: user.id, username: user.username, role: user.role, isPending2FA: true },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({
        success: true,
        requires2FA: true,
        tempToken,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role
        },
        message: `مرحباً بك (${user.full_name || user.username})! يتطلب حسابك التحقق بخطوتين (2FA). أدخل رمز الأمان للمتابعة 🛡️`
      });
    }

    // إكمال تسجيل الدخول الاعتيادي
    return await completeLoginSession(user, req, res, { force, deviceInfo, deviceId, deviceName });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء تسجيل الدخول: ' + err.message, error: err.message });
  }
});

// 1.1 التحقق من رمز التحقق بخطوتين (2FA)
router.post('/verify-2fa', async (req, res) => {
  try {
    const { tempToken, code, force, deviceInfo, deviceId, deviceName } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال رمز التحقق بخطوتين' });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, message: 'جلسة التحقق المؤقتة منتهية، يرجى إعادة تسجيل الدخول' });
    }

    if (!decoded || !decoded.isPending2FA) {
      return res.status(401).json({ success: false, message: 'طلب التحقق غير صالح' });
    }

    // جلب بيانات المستخدم أولاً
    const user = await get('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // جلب الرمز السري المعتمد لـ 2FA الخاص بالمستخدم أو من إعدادات النظام
    let admin2FaPin = user.two_factor_pin;
    if (!admin2FaPin) {
      try {
        const rowPin = await get("SELECT value FROM settings WHERE `key` = 'admin_2fa_pin'");
        if (rowPin && rowPin.value) admin2FaPin = rowPin.value;
      } catch (e) {}
    }
    if (!admin2FaPin) admin2FaPin = '123456';

    const normalizeDigits = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
        .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
        .trim();
    };

    const cleanCode = normalizeDigits(code);
    const userPinNormalized = normalizeDigits(user.two_factor_pin);
    const adminPinNormalized = normalizeDigits(admin2FaPin);

    // قائمة الرموز المقبولة: رمز المستخدم، رمز الإعدادات، وكود الطوارئ 889900
    const validPins = new Set([
      userPinNormalized,
      adminPinNormalized,
      '889900'
    ].filter(Boolean));

    // دعم كلا الرمزين المعتمدين (654321 و 123456) لحساب المدير العام لضمان عدم القفل
    if (user.role === 'admin' || user.username === 'admin') {
      validPins.add('654321');
      validPins.add('123456');
    }

    if (!validPins.has(cleanCode)) {
      return res.status(401).json({
        success: false,
        message: 'رمز التحقق بخطوتين (2FA) غير صحيح، يرجى التأكد من الرمز والمحاولة مجدداً'
      });
    }

    // اعتماد الجلسة وإصدار التوكن النهائي
    return await completeLoginSession(user, req, res, { force, deviceInfo, deviceId, deviceName });
  } catch (err) {
    console.error('Verify 2FA error:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء التحقق بخطوتين: ' + err.message });
  }
});

// 2. نبض الحفاظ على الجلسة والتحقق من عدم تكرار الدخول
router.post('/heartbeat', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'جلسة غير صالحة' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id, is_logged_in, session_token, active_sessions, status, full_name, username FROM users WHERE id = ?', [decoded.id]);
    if (!user || user.status === 'inactive') {
      return res.status(401).json({ success: false, session_terminated: true, message: 'الحساب معطل أو غير موجود' });
    }

    let activeSessions = [];
    try {
      activeSessions = user.active_sessions ? JSON.parse(user.active_sessions) : [];
    } catch (e) {
      activeSessions = [];
    }
    if (!Array.isArray(activeSessions)) activeSessions = [];

    const nowIsoDb = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const nowIsoFull = new Date().toISOString();
    const nowMs = Date.now();

    if (activeSessions.length > 0) {
      const currentSess = activeSessions.find(s => s.sessionId === decoded.sessionId);
      if (!currentSess) {
        return res.status(401).json({
          success: false,
          session_terminated: true,
          message: 'تم إنهاء هذه الجلسة نظراً لتسجيل الدخول من جهاز آخر تجاوز سقف الأجهزة.'
        });
      }
      currentSess.lastHeartbeat = nowIsoFull;
      currentSess.lastHeartbeatMs = nowMs;
    } else {
      if (decoded.sessionId && user.session_token && decoded.sessionId !== user.session_token) {
        return res.status(401).json({
          success: false,
          session_terminated: true,
          message: 'تم تسجيل الدخول بحسابك من جهاز أو متصفح آخر. تم إنهاء هذه الجلسة منعاً للتكرار.'
        });
      }
      if (decoded.sessionId) {
        activeSessions.push({ sessionId: decoded.sessionId, lastHeartbeat: nowIsoFull, lastHeartbeatMs: nowMs });
      }
    }

    await run("UPDATE users SET last_heartbeat = ?, active_sessions = ?, is_logged_in = 1 WHERE id = ?", [nowIsoDb, JSON.stringify(activeSessions), user.id]);
    res.json({ success: true, is_logged_in: true });
  } catch (err) {
    res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة' });
  }
});

// 3. التحقق من صحة الجلسة (Verify Token)
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'جلسة غير صالحة' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id, username, full_name, role, email, phone, status, permissions, is_logged_in, session_token, active_sessions, branch_id, branch, department_id, department, allowed_projects, allowed_branches, allowed_departments FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'هذا الحساب معطل حالياً' });
    }

    let activeSessions = [];
    try {
      activeSessions = user.active_sessions ? JSON.parse(user.active_sessions) : [];
    } catch (e) {
      activeSessions = [];
    }
    if (!Array.isArray(activeSessions)) activeSessions = [];

    if (activeSessions.length > 0) {
      const currentSess = activeSessions.find(s => s.sessionId === decoded.sessionId);
      if (!currentSess) {
        return res.status(401).json({
          success: false,
          session_terminated: true,
          message: 'تم إنهاء هذه الجلسة تلقائياً نظراً لتسجيل الدخول من جهاز آخر.'
        });
      }
    } else if (decoded.sessionId && user.session_token && decoded.sessionId !== user.session_token) {
      return res.status(401).json({
        success: false,
        session_terminated: true,
        message: 'تم تسجيل الدخول بهذا الحساب من جهاز أو نافذة أخرى.'
      });
    }

    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await run("UPDATE users SET last_heartbeat = ?, is_logged_in = 1 WHERE id = ?", [nowIso, user.id]);

    const permissionsList = parseUserPermissions(user);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        branch_id: user.branch_id || 1,
        branch: user.branch || 'المركز الرئيسي',
        department_id: user.department_id || 1,
        department: user.department || 'الإدارة العامة',
        allowed_projects: user.allowed_projects || '*',
        allowed_branches: user.allowed_branches || '*',
        allowed_departments: user.allowed_departments || '*',
        permissions: permissionsList
      }
    });
  } catch (err) {
    res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة' });
  }
});

// 4. تسجيل الخروج وإنهاء الجلسة فوراً
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let userId = req.body?.userId;
    let username = req.body?.username;
    let currentSessionId = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        userId = userId || decoded.id;
        username = username || decoded.username;
        currentSessionId = decoded.sessionId;
      } catch {}
    }

    if (userId || username) {
      const targetUser = userId 
        ? await get("SELECT id, active_sessions, session_token FROM users WHERE id = ?", [userId])
        : await get("SELECT id, active_sessions, session_token FROM users WHERE LOWER(username) = LOWER(?)", [username]);

      if (targetUser) {
        let activeSessions = [];
        try {
          activeSessions = targetUser.active_sessions ? JSON.parse(targetUser.active_sessions) : [];
        } catch (e) {}

        if (currentSessionId && Array.isArray(activeSessions)) {
          activeSessions = activeSessions.filter(s => s.sessionId !== currentSessionId);
        } else {
          activeSessions = [];
        }

        const isLogged = activeSessions.length > 0 ? 1 : 0;
        const lastToken = activeSessions.length > 0 ? activeSessions[activeSessions.length - 1].sessionId : null;
        await run("UPDATE users SET is_logged_in = ?, active_sessions = ?, session_token = ? WHERE id = ?", [
          isLogged,
          JSON.stringify(activeSessions),
          lastToken,
          targetUser.id
        ]);
      }
    }

    res.json({ success: true, message: 'تم إنهاء الجلسة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تسجيل الخروج: ' + err.message, error: err.message });
  }
});

// 5. جلب قائمة المستخدمين المتصلين حالياً بالنظام
router.get('/connected-users', async (req, res) => {
  try {
    const ACTIVE_THRESHOLD_MS = 75 * 1000;
    const now = Date.now();

    const users = await query(`
      SELECT id, username, full_name, role, email, phone, last_heartbeat, last_login_at, last_login_device, last_login_ip, is_logged_in
      FROM users
      WHERE is_logged_in = 1 AND last_heartbeat IS NOT NULL
      ORDER BY last_heartbeat DESC
    `);

    const connectedUsers = users.filter(u => {
      const diff = now - new Date(u.last_heartbeat).getTime();
      return !isNaN(diff) && diff < ACTIVE_THRESHOLD_MS;
    });

    res.json({
      success: true,
      count: connectedUsers.length,
      users: connectedUsers
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخدمين المتصلين', error: err.message });
  }
});

// 6. فك قفل الشاشة بالتحقق من كلمة المرور للمستخدم الحالي
router.post('/unlock', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال كلمة المرور لإلغاء القفل' });
    }

    const cleanUsername = String(username).trim();
    const user = await get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [cleanUsername]);
    if (!user) {
      return res.status(401).json({ success: false, message: 'اسم المستخدم غير موجود' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'هذا الحساب معطل حالياً' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى' });
    }

    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await run('UPDATE users SET last_heartbeat = ?, is_logged_in = 1 WHERE id = ?', [nowIso, user.id]);

    res.json({
      success: true,
      message: 'تم فك القفل واستئناف العمل بنجاح',
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Unlock error:', err);
    res.status(500).json({ success: false, message: 'خطأ في التحقق من كلمة المرور: ' + err.message });
  }
});

router.verifyAdmin = verifyAdmin;
router.getSecuritySettings = getSecuritySettings;
router.JWT_SECRET = JWT_SECRET;

module.exports = router;
