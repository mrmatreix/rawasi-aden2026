/**
 * البرمجية الوسيطة لمصادقة وحماية بوابة وتطبيق العملاء
 * Client Portal Authentication Middleware (Deny by Default)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 */

const jwt = require('jsonwebtoken');
const db = require('../database/db');

// مفتاح توقيع JWT مخصص ومنفصل تماماً لبوابة العملاء
const CLIENT_JWT_SECRET = process.env.CLIENT_JWT_SECRET || 'rawasi_aden_client_secret_key_2026_secured';

// ==========================================
// 1. محدد معدل الطلبات للعملاء (Rate Limiting)
// 200 طلب / 15 دقيقة لكل عميل
// ==========================================
const clientRateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 200;

function checkClientRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : '';
  const key = `client_rl_${ip}_${token.slice(-10)}`;
  const now = Date.now();

  let entry = clientRateLimitMap.get(key);
  if (!entry || now - entry.startTime > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 1, startTime: now };
    clientRateLimitMap.set(key, entry);
  } else {
    entry.count += 1;
  }

  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      success: false,
      rateLimited: true,
      message: '⛔ تم تجاوز الحد الأقصى للطلبات المسموح بها (200 طلب لكل 15 دقيقة). يرجى الانتظار قليلاً.'
    });
  }

  next();
}

// تنظيف دوري لمحدد الطلبات
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of clientRateLimitMap.entries()) {
    if (now - v.startTime > RATE_LIMIT_WINDOW_MS) {
      clientRateLimitMap.delete(k);
    }
  }
}, 5 * 60 * 1000).unref();

// ==========================================
// 2. التحقق الإلزامي من جلسة العميل (requireClientAuth)
// ==========================================
async function requireClientAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers['x-client-token'];
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        authError: true,
        message: '⛔ لم يتم توفير رمز الدخول (Authorization Token مطلوب)'
      });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        authError: true,
        message: '⛔ رمز الدخول فارغ أو غير صالح'
      });
    }

    // فك تشفير وفحص الـ JWT
    let decoded;
    try {
      decoded = jwt.verify(token, CLIENT_JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          tokenExpired: true,
          message: '⛔ انتهت صلاحية جلسة تسجيل الدخول، يرجى إعادة تسجيل الدخول'
        });
      }
      return res.status(401).json({
        success: false,
        authError: true,
        message: '⛔ رمز الدخول غير صالح أو تم التلاعب به'
      });
    }

    // التحقق من نوع التوكن: يجب أن يكون صريحاً خاصاً بالعميل
    if (!decoded || decoded.type !== 'client' || !decoded.id || !decoded.client_id) {
      return res.status(403).json({
        success: false,
        forbidden: true,
        message: '⛔ نوع التوكن غير مصرح به لبوابة العملاء'
      });
    }

    // جلب بيانات مستخدم العميل وقفل التحقق على حالة الحساب
    const clientUser = await db.get(`
      SELECT 
        cu.id,
        cu.client_id,
        cu.email,
        cu.phone,
        cu.full_name,
        cu.role,
        cu.permissions,
        cu.status,
        cu.two_factor_enabled,
        cu.device_token,
        cu.device_platform,
        c.name AS client_name,
        c.company AS client_company,
        c.phone AS client_phone,
        c.email AS client_email
      FROM client_users cu
      INNER JOIN clients c ON c.id = cu.client_id
      WHERE cu.id = ? AND cu.client_id = ?
    `, [decoded.id, decoded.client_id]);

    if (!clientUser) {
      return res.status(401).json({
        success: false,
        authError: true,
        message: '⛔ حساب العميل غير موجود أو تم حذفه من النظام'
      });
    }

    if (clientUser.status !== 'active') {
      return res.status(403).json({
        success: false,
        suspended: true,
        message: '⛔ تم إيقاف هذا الحساب أو تعطيله من قِبل إدارة الشركة. يرجى التواصل مع الدعم.'
      });
    }

    // تحليل الأذونات العامة
    let parsedPermissions = {};
    if (clientUser.permissions) {
      try {
        parsedPermissions = typeof clientUser.permissions === 'string' 
          ? JSON.parse(clientUser.permissions) 
          : clientUser.permissions;
      } catch {
        parsedPermissions = {};
      }
    }

    // جلب صلاحيات المشاريع المحددة المسموحة لهذا المستخدم
    const projectAccessRows = await db.query(`
      SELECT 
        project_id,
        can_view_progress,
        can_view_invoices,
        can_view_payments,
        can_view_reports,
        can_view_drawings,
        can_view_correspondence,
        can_approve_invoices,
        can_send_messages
      FROM client_project_access
      WHERE client_user_id = ?
    `, [clientUser.id]);

    const projectAccessMap = {};
    projectAccessRows.forEach(row => {
      projectAccessMap[row.project_id] = {
        can_view_progress: Boolean(row.can_view_progress),
        can_view_invoices: Boolean(row.can_view_invoices),
        can_view_payments: Boolean(row.can_view_payments),
        can_view_reports: Boolean(row.can_view_reports),
        can_view_drawings: Boolean(row.can_view_drawings),
        can_view_correspondence: Boolean(row.can_view_correspondence),
        can_approve_invoices: Boolean(row.can_approve_invoices),
        can_send_messages: Boolean(row.can_send_messages)
      };
    });

    // إرفاق كائن العميل بالطلب مع دوال التحقق من الصلاحيات
    req.clientUser = {
      id: clientUser.id,
      client_id: clientUser.client_id,
      email: clientUser.email,
      phone: clientUser.phone,
      full_name: clientUser.full_name,
      role: clientUser.role || 'viewer', // 'owner', 'manager', 'viewer'
      permissions: parsedPermissions,
      client_name: clientUser.client_name,
      client_company: clientUser.client_company,
      allowedProjects: projectAccessMap,
      hasExplicitProjectAccess: Object.keys(projectAccessMap).length > 0,
      
      /**
       * التحقق هل للمستخدم صلاحية على مشروع محدد
       */
      canAccessProject: (projectId) => {
        const pId = parseInt(projectId, 10);
        // إذا كان المالك أو لم يتم تحديد قيود مشاريع مخصصة، يسمح بالوصول لمشاريع العميل
        if (clientUser.role === 'owner') return true;
        if (Object.keys(projectAccessMap).length === 0) return true;
        return Boolean(projectAccessMap[pId]);
      },

      /**
       * التحقق من صلاحية فرعية محددة على مشروع (مثل اعتماد المستخلصات)
       */
      hasPermission: (projectId, permName) => {
        const pId = parseInt(projectId, 10);
        if (clientUser.role === 'owner') return true;
        if (Object.keys(projectAccessMap).length === 0) {
          return Boolean(parsedPermissions[permName] !== false);
        }
        const projPerms = projectAccessMap[pId];
        if (!projPerms) return false;
        return Boolean(projPerms[permName]);
      }
    };

    next();
  } catch (err) {
    console.error('Client Auth Error:', err);
    return res.status(500).json({
      success: false,
      message: '⛔ خطأ داخلي في الخادم أثناء مصادقة العميل'
    });
  }
}

// ==========================================
// 3. تسجيل العمليات في سجل التدقيق (Audit Log)
// ==========================================
async function logClientAudit(req, action, entityType, entityId, details = null) {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const clientUser = req.clientUser || {};
    const desc = typeof details === 'object' ? JSON.stringify(details) : String(details || '');

    await db.run(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientUser.id || null,
      `[CLIENT] ${clientUser.full_name || 'عميل'} (ID:${clientUser.id || 0}, Client:${clientUser.client_id || 0})`,
      action,
      entityType,
      entityId ? String(entityId) : null,
      desc,
      ip
    ]);
  } catch (err) {
    console.warn('Audit logging error (non-fatal):', err.message);
  }
}

module.exports = {
  CLIENT_JWT_SECRET,
  requireClientAuth,
  checkClientRateLimit,
  logClientAudit
};
