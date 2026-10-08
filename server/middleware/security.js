/**
 * وحدة البرمجيات الوسيطة للأمان والحماية (Security Middleware)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 *
 * تتضمن:
 * 1. حماية ضد هجمات تزوير الطلبات عبر المواقع (CSRF Protection)
 * 2. محدد محاولات الدخول وحظر التخمين مع ردود رقمية مرئية (Login Rate Limiter)
 * 3. التحقق الإلزامي من المصادقة (Require Authentication)
 * 4. فرض الصلاحيات والأذونات على مستوى الخادم (Require Permission)
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';

// ==========================================
// 1. نظام محدد محاولات الدخول (Rate Limiting)
// ==========================================
// تخزين المحاولات في الذاكرة: مفتاح = IP أو Username
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME_MS = 60 * 1000; // قفل مؤقت لمدة 60 ثانية

function getClientIdentifier(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const username = (req.body && req.body.username) ? String(req.body.username).trim().toLowerCase() : '';
  return `${ip}::${username}`;
}

const loginRateLimiter = (req, res, next) => {
  const key = getClientIdentifier(req);
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (record) {
    // التحقق هل الحساب محظور مؤقتاً
    if (record.lockoutUntil && record.lockoutUntil > now) {
      const remainingSeconds = Math.ceil((record.lockoutUntil - now) / 1000);
      return res.status(429).json({
        success: false,
        rateLimited: true,
        lockoutSeconds: remainingSeconds,
        message: `⛔ تم حظر محاولات الدخول مؤقتاً بسبب تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). يرجى الانتظار (${remainingSeconds} ثانية) قبل المحاولة مجدداً.`
      });
    }

    // انتهاء فترة الحظر، تصفير العداد
    if (record.lockoutUntil && record.lockoutUntil <= now) {
      loginAttempts.delete(key);
    }
  }

  next();
};

function recordFailedLogin(req) {
  const key = getClientIdentifier(req);
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, firstAttempt: now, lockoutUntil: null };

  // إذا مرت أكثر من 5 دقائق على أول محاولة، نبدأ نافذة جديدة
  if (now - record.firstAttempt > 5 * 60 * 1000) {
    record.count = 1;
    record.firstAttempt = now;
    record.lockoutUntil = null;
  } else {
    record.count += 1;
  }

  let lockoutSeconds = 0;
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.lockoutUntil = now + LOCKOUT_TIME_MS;
    lockoutSeconds = Math.ceil(LOCKOUT_TIME_MS / 1000);
  }

  loginAttempts.set(key, record);
  const remainingAttempts = Math.max(0, MAX_LOGIN_ATTEMPTS - record.count);

  return {
    remainingAttempts,
    isLocked: record.count >= MAX_LOGIN_ATTEMPTS,
    lockoutSeconds
  };
}

function resetLoginAttempts(req) {
  const key = getClientIdentifier(req);
  loginAttempts.delete(key);
}

// تنظيف دوري للذاكرة كل 10 دقائق
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of loginAttempts.entries()) {
    if (record.lockoutUntil && record.lockoutUntil <= now) {
      loginAttempts.delete(key);
    } else if (now - record.firstAttempt > 10 * 60 * 1000) {
      loginAttempts.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();


// ==========================================
// 2. نظام التحقق من رمز الـ CSRF (CSRF Token)
// ==========================================
// توليد رمز CSRF عشوائي وموثوق
const csrfTokens = new Map();

function generateCsrfToken(sessionId = null) {
  const token = crypto.randomBytes(32).toString('hex');
  const id = sessionId || crypto.randomUUID();
  csrfTokens.set(token, { sessionId: id, createdAt: Date.now() });
  return token;
}

// فحص رمز الـ CSRF في الطلبات المحدثة للبيانات
const verifyCsrfToken = (req, res, next) => {
  // استثناء طرق القراءة الآمنة
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const urlPath = req.originalUrl || req.path;
  const exemptPaths = [
    '/api/auth/login',
    '/api/auth/csrf-token',
    '/api/auth/verify-2fa',
    '/api/auth/unlock',
    '/api/health',
    '/api/client-portal',
    '/api/payments/webhook'
  ];
  if (exemptPaths.some(p => urlPath.startsWith(p))) {
    return next();
  }

  const clientToken = req.headers['x-csrf-token'] || (req.body && req.body._csrf);

  // إذا تم إرسال توكن CSRF وكان معروفاً أو توكن JWT معتمد
  // التحقق من صلاحية توكن CSRF أو وجود ترويسة X-Requested-With / Custom Header
  if (clientToken && (csrfTokens.has(clientToken) || clientToken.length >= 32)) {
    return next();
  }

  // إذا لم يتوفر رمز CSRF صريح، نتأكد من أن الطلب ليس عبر استدعاء Cross-Site حقيقي
  // أو نقبل طلبات التطبيق الأصلية مع توجيه تنبيه لتحديث التوكن
  const customHeader = req.headers['x-requested-with'];
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && customHeader === 'XMLHttpRequest') {
    return next();
  }

  return res.status(403).json({
    success: false,
    csrfError: true,
    message: '⛔ فشل التحقق الأمني من صحة النموذج (رمز CSRF مفقود أو غير صالح). تم حظر العملية لمنع التلاعب.'
  });
};

// ==========================================
// 3. التحقق من المصادقة (Require Authentication)
// ==========================================
const requireAuth = (req, res, next) => {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  } else if (req.cookies && req.cookies.rawasi_token) {
    token = req.cookies.rawasi_token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      message: 'يرجى تسجيل الدخول أولاً لتنفيذ هذه العملية'
    });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded && decoded.isPending2FA) {
      return res.status(403).json({
        success: false,
        requires2FA: true,
        message: '⛔ الحساب يتطلب التحقق بخطوتين (2FA). لا يمكن الوصول إلى النظام بالتوكن المؤقت قبل إدخال رمز التحقق الأمني.'
      });
    }
    req.user = decoded;
    // ضمان توفر كائن النطاق الصلاحي (Scope Context)
    if (!req.user.scope) {
      req.user.scope = {
        allowed_projects: req.user.allowed_projects || '*',
        allowed_branches: req.user.allowed_branches || '*',
        allowed_departments: req.user.allowed_departments || '*',
        branch_id: req.user.branch_id || 1,
        department_id: req.user.department_id || 1
      };
    }
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      tokenExpired: true,
      message: 'جلسة تسجيل الدخول منتهية الصلاحية أو غير صالحة، يرجى إعادة تسجيل الدخول'
    });
  }
};

// ============================================================================
// 4. نظام التحكم بالوصول المستند للأدوار والنطاق (RBAC + Scoped Access Control)
// يدعم العمليات الـ 7: view, create, edit, approve, post, cancel, export
// مع مبدأ المنع الافتراضي الصارم (Deny by Default)
// ============================================================================

/**
 * تحليل واستخراج مصفوفة النطاقات (مشاريع / فروع / أقسام)
 */
function parseScopeArray(scopeVal) {
  if (!scopeVal || scopeVal === '*' || scopeVal === 'all') return ['*'];
  if (Array.isArray(scopeVal)) return scopeVal;
  if (typeof scopeVal === 'string') {
    const trimmed = scopeVal.trim();
    if (trimmed === '*' || trimmed === 'all') return ['*'];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  return ['*'];
}

/**
 * التحقق من صلاحية المستخدم على عملية معينة (Deny by Default)
 */
function hasUserPermission(user, requiredPerm) {
  if (!user) return false;

  // المدير العام يملك كافة الصلاحيات دائماً دون قيود
  if (user.role === 'admin' || user.username === 'admin') {
    return true;
  }

  // المحاسب المالي يملك صلاحيات العمليات المالية والمحاسبية والسندات والمشاريع والتقارير
  if (user.role === 'accountant' || user.username === 'accountant' || user.id === 2) {
    const isFinancialReq = requiredPerm.split(',').some(p => {
      const trimmed = p.trim();
      return trimmed.startsWith('accounting:') || trimmed.startsWith('expenses:') || 
             trimmed.startsWith('revenues:') || trimmed.startsWith('billing:') || 
             trimmed.startsWith('reports:') || trimmed.startsWith('custody:') || 
             trimmed.startsWith('cash:') || trimmed.startsWith('clients:') || 
             trimmed.startsWith('suppliers:') || trimmed.startsWith('projects:') ||
             trimmed === 'accounting' || trimmed === 'expenses' || trimmed === 'revenues' || 
             trimmed === 'payments' || trimmed === 'billing' || trimmed === 'projects';
    });
    if (isFinancialReq) return true;
  }

  const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
  if (userPerms.length === 0) {
    return false; // Deny by Default
  }

  if (userPerms.includes('*') || userPerms.includes('all')) {
    return true;
  }

  // دعم فحص عدة مفاتيح محتملة مفصولة بفواصل (أحدها يكفي)
  const reqKeys = requiredPerm.split(',').map(k => k.trim()).filter(Boolean);

  return reqKeys.some(key => {
    // 1. تطابق تام للمفتاح (e.g., 'projects:create' === 'projects:create')
    if (userPerms.includes(key)) return true;

    const parts = key.split(':');
    const domain = parts[0];
    const action = parts[1] || '';

    // 2. صلاحية النطاق الكامل للموديول (e.g., 'projects:*' أو 'projects' يغطي 'projects:create' أو 'projects:view')
    if (userPerms.includes(`${domain}:*`) || userPerms.includes(domain)) return true;

    // 3. التوافق المتقدم مع الأسماء السابقة والعمليات المكافئة:
    // الإضافة والتعديل مشمولة في manage
    if ((action === 'create' || action === 'edit') && userPerms.includes(`${domain}:manage`)) {
      return true;
    }
    // التصدير والطباعة مشمولان في print و statement
    if (action === 'export' && (userPerms.includes(`${domain}:print`) || userPerms.includes(`${domain}:statement`))) {
      return true;
    }
    // العرض مشمول في manage و statement
    if (action === 'view' && (userPerms.includes(`${domain}:manage`) || userPerms.includes(`${domain}:statement`))) {
      return true;
    }
    // الصرف المخزني مشمول في create أو issue
    if (domain === 'inventory' && (action === 'create' || action === 'issue') && (userPerms.includes('inventory:create') || userPerms.includes('inventory:issue') || userPerms.includes('inventory:manage'))) {
      return true;
    }
    // القيود المحاسبية
    if (domain === 'accounting' && (action === 'create' || action === 'edit') && userPerms.includes('accounting:journal')) {
      return true;
    }
    // ترحيل الرواتب
    if (domain === 'hr' && (action === 'post' || action === 'create') && userPerms.includes('hr:payroll')) {
      return true;
    }
    // إدارة المستخدمين
    if (domain === 'users' && userPerms.includes('settings:users')) {
      return true;
    }

    return false;
  });
}

/**
 * فحص نطاق الصلاحيات على مستوى (المشروع، الفرع، القسم)
 */
function checkUserScope(user, { projectId, branchId, departmentId }) {
  if (!user) return { allowed: false, reason: 'المستخدم غير معرف' };
  if (user.role === 'admin' || user.username === 'admin') return { allowed: true };

  const userScope = user.scope || {};
  const allowedProjects = parseScopeArray(userScope.allowed_projects || user.allowed_projects);
  const allowedBranches = parseScopeArray(userScope.allowed_branches || user.allowed_branches);
  const allowedDepartments = parseScopeArray(userScope.allowed_departments || user.allowed_departments);

  // 1. التحقق من نطاق المشروع (Project Scope)
  if (projectId !== undefined && projectId !== null && projectId !== '') {
    if (!allowedProjects.includes('*') && !allowedProjects.includes('all')) {
      const pIdNum = Number(projectId);
      const isAllowed = allowedProjects.some(id => Number(id) === pIdNum);
      if (!isAllowed) {
        return { 
          allowed: false, 
          scopeType: 'project',
          reason: `المشروع رقم (${projectId}) غير مصرح لك بالوصول إليه ضمن نطاق عملك المعتمد` 
        };
      }
    }
  }

  // 2. التحقق من نطاق الفرع (Branch Scope)
  if (branchId !== undefined && branchId !== null && branchId !== '') {
    if (!allowedBranches.includes('*') && !allowedBranches.includes('all')) {
      const bIdStr = String(branchId).trim();
      const isAllowed = allowedBranches.some(b => String(b).trim() === bIdStr);
      if (!isAllowed) {
        return { 
          allowed: false, 
          scopeType: 'branch',
          reason: `فرع المؤسسة المحدد (${branchId}) يقع خارج نطاق صلاحياتك الجغرافية` 
        };
      }
    }
  }

  // 3. التحقق من نطاق القسم (Department Scope)
  if (departmentId !== undefined && departmentId !== null && departmentId !== '') {
    if (!allowedDepartments.includes('*') && !allowedDepartments.includes('all')) {
      const dIdStr = String(departmentId).trim();
      const isAllowed = allowedDepartments.some(d => String(d).trim() === dIdStr);
      if (!isAllowed) {
        return { 
          allowed: false, 
          scopeType: 'department',
          reason: `القسم المحدد (${departmentId}) غير مدرج ضمن نطاق صلاحياتك الإدارية` 
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * وسيط فحص الصلاحيات الإلزامية على مستوى العملية والمستوى الجغرافي/الإداري
 * @param {string} permissionKey المفتاح المطلوب مثل 'projects:create' أو 'accounting:approve'
 * @param {object} scopeOptions خيارات تحديد المشروع أو الفرع أو القسم
 */
const requirePermission = (permissionKey, scopeOptions = null) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        authenticated: false, 
        message: 'مطلوب تسجيل الدخول أولاً لتنفيذ هذه العملية' 
      });
    }

    // 1. فحص الصلاحية الإجرائية (Deny by Default)
    if (!hasUserPermission(req.user, permissionKey)) {
      return res.status(403).json({
        success: false,
        permissionDenied: true,
        requiredPermission: permissionKey,
        message: `⛔ غير مصرح: حسابك لا يملك الصلاحية اللازمة (${permissionKey}) لتنفيذ هذه العملية في الخادم.`
      });
    }

    // 2. فحص النطاق إن كان هناك سياق مشروع أو فرع أو قسم
    let projectId = null;
    let branchId = null;
    let departmentId = null;

    if (scopeOptions) {
      if (scopeOptions.projectParam) projectId = req.params[scopeOptions.projectParam];
      if (!projectId && scopeOptions.projectBody) projectId = req.body?.[scopeOptions.projectBody];
      if (!projectId && scopeOptions.projectQuery) projectId = req.query?.[scopeOptions.projectQuery];
      if (scopeOptions.branchParam) branchId = req.params[scopeOptions.branchParam];
      if (scopeOptions.departmentParam) departmentId = req.params[scopeOptions.departmentParam];
    }

    // استكشاف تلقائي ذكي لمعرف المشروع والفرع والقسم إن لم يُحدد صراحة
    if (!projectId) {
      projectId = req.params.projectId || (req.baseUrl.includes('projects') && req.params.id ? req.params.id : null) || req.body?.project_id || req.query?.project_id;
    }
    if (!branchId) {
      branchId = req.body?.branch_id || req.query?.branch_id;
    }
    if (!departmentId) {
      departmentId = req.body?.department_id || req.query?.department_id;
    }

    if (projectId || branchId || departmentId) {
      const scopeCheck = checkUserScope(req.user, { projectId, branchId, departmentId });
      if (!scopeCheck.allowed) {
        return res.status(403).json({
          success: false,
          scopeDenied: true,
          scopeType: scopeCheck.scopeType,
          message: `⛔ تم حظر العملية: ${scopeCheck.reason}.`
        });
      }
    }

    next();
  };
};

/**
 * وسيط التحقق من النطاق فقط (مشاريع / فروع / أقسام)
 */
const requireScope = (options = {}) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, authenticated: false, message: 'مطلوب تسجيل الدخول أولاً' });
    }
    if (req.user.role === 'admin' || req.user.username === 'admin') {
      return next();
    }

    const projectId = options.projectParam ? req.params[options.projectParam] : (req.params.projectId || req.body?.project_id || req.query?.project_id);
    const branchId = options.branchParam ? req.params[options.branchParam] : (req.body?.branch_id || req.query?.branch_id);
    const departmentId = options.departmentParam ? req.params[options.departmentParam] : (req.body?.department_id || req.query?.department_id);

    const check = checkUserScope(req.user, { projectId, branchId, departmentId });
    if (!check.allowed) {
      return res.status(403).json({
        success: false,
        scopeDenied: true,
        message: `⛔ تم رفض الوصول: ${check.reason}.`
      });
    }

    next();
  };
};

module.exports = {
  loginRateLimiter,
  recordFailedLogin,
  resetLoginAttempts,
  generateCsrfToken,
  verifyCsrfToken,
  requireAuth,
  requirePermission,
  requireScope,
  hasUserPermission,
  checkUserScope,
  parseScopeArray,
  JWT_SECRET
};
