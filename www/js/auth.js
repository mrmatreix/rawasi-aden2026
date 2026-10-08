/**
 * إدارة المصادقة وتسجيل الدخول والخروج وصلاحيات المستخدمين لنظام رواسي عدن
 * تتضمن التحقق من عدم تكرار تسجيل الدخول لنفس المستخدم بالتزامن والحفاظ على الجلسة الحية
 */

// ===================================================================
// حماية وتأمين كافة طلبات fetch تلقائياً مع توكن CSRF وتوكن المصادقة JWT
// ===================================================================
(function setupSecureFetch() {
  if (window._rawasiFetchSetupDone) return;
  window._rawasiFetchSetupDone = true;

  const originalFetch = window.fetch;
  window._rawasiOriginalFetch = originalFetch;

  window.fetch = async function (resource, init = {}) {
    try {
      const url = typeof resource === 'string' ? resource : (resource?.url || '');
      const isApiCall = url.startsWith('/api/') || url.includes('/api/');

      if (isApiCall) {
        init = init || {};
        let headers = init.headers;
        if (!headers) {
          headers = {};
        } else if (headers instanceof Headers) {
          const obj = {};
          for (let [k, v] of headers.entries()) {
            obj[k] = v;
          }
          headers = obj;
        } else if (typeof headers === 'object') {
          headers = { ...headers };
        }

        // 1. إضافة توكن المصادقة Authorization تلقائياً إذا لم يكن مضافاً وكان المستخدم مسجلاً
        if (!headers['Authorization'] && !headers['authorization']) {
          const activeToken = (window.Auth && window.Auth.token)
            || sessionStorage.getItem('rawasi_token')
            || localStorage.getItem('rawasi_token');
          if (activeToken) {
            headers['Authorization'] = `Bearer ${activeToken}`;
          }
        }

        // 2. إضافة توكن CSRF للعمليات غير الآمنة (POST, PUT, DELETE, PATCH)
        const method = (init.method || 'GET').toUpperCase();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          const csrfToken = (window.Auth && window.Auth.csrfToken)
            || sessionStorage.getItem('rawasi_csrf_token');
          if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
          }
          headers['X-Requested-With'] = 'XMLHttpRequest';
        }

        init.headers = headers;
      }
    } catch (e) {
      console.warn('[SecureFetch] Error attaching security headers:', e);
    }

    const response = await originalFetch(resource, init);

    // قراءة توكن CSRF الجديد من الهيدر إن وُجد لتحديثه دائماً
    try {
      const newCsrf = response.headers?.get('x-csrf-token');
      if (newCsrf && window.Auth && typeof window.Auth.setCsrfToken === 'function') {
        window.Auth.setCsrfToken(newCsrf);
      }
    } catch (e) {}

    return response;
  };
})();

const Auth = {
  currentUser: null,
  token: null,
  sessionId: null,
  csrfToken: null,
  _isLoggingIn: false,
  _heartbeatInterval: null,
  _pendingCredentials: null,
  _pending2FAToken: null,
  _pending2FAUser: null,
  _rateLimitTimer: null,
  isLocked: false,
  lockTimeoutMinutes: 15,
  lastActivityTime: Date.now(),
  _activityCheckInterval: null,
  _activityListenersBound: false,
  securitySettings: {
    session_mode: 'multi',
    session_device_limit: 3,
    session_overflow_action: 'kick_oldest',
    jwt_token_expiry: '8h',
    jwt_custom_minutes: 480
  },

  // تنظيف أي بيانات حساسة قديمة من localStorage ونقل الجلسة للـ sessionStorage
  purgeSensitiveLocalStorage() {
    const sensitiveKeys = [
      'rawasi_last_logout_backup',
      'rawasi_db_backup',
      'rawasi_backup_data',
      'rawasi_cached_credentials'
    ];
    sensitiveKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch(e){}
    });
    // ترحيل الجلسة الآمنة تلقائياً
    try {
      const legacyToken = localStorage.getItem('rawasi_token');
      const legacyUser = localStorage.getItem('rawasi_user');
      if (legacyToken && !sessionStorage.getItem('rawasi_token')) {
        sessionStorage.setItem('rawasi_token', legacyToken);
      }
      if (legacyUser && !sessionStorage.getItem('rawasi_user')) {
        sessionStorage.setItem('rawasi_user', legacyUser);
      }
      localStorage.removeItem('rawasi_token');
      localStorage.removeItem('rawasi_user');
    } catch (e) {}
  },

  // جلب رمز CSRF من الخادم
  async fetchCsrfToken() {
    try {
      const fetchFn = window._rawasiOriginalFetch || window.fetch;
      const res = await fetchFn('/api/auth/csrf-token');
      const data = await res.json();
      if (data && data.csrfToken) {
        this.setCsrfToken(data.csrfToken);
      }
    } catch (e) {
      console.warn('تعذر جلب توكن CSRF:', e);
    }
  },

  // تعيين رمز الـ CSRF في الجلسة والحقول المخفية
  setCsrfToken(token) {
    if (!token) return;
    this.csrfToken = token;
    try { sessionStorage.setItem('rawasi_csrf_token', token); } catch(e){}
    const input = document.getElementById('loginCsrfToken');
    if (input) input.value = token;
  },

  // تهيئة نظام الدخول والمصادقة
  async init() {
    this.purgeSensitiveLocalStorage();
    this.initLockEngine();
    this.fetchSecuritySettings();
    this.fetchCsrfToken();

    // التحقق مما إذا كانت هناك جلسة مصادقة نشطة ومصرح بها
    const savedToken = sessionStorage.getItem('rawasi_token') || localStorage.getItem('rawasi_token');
    const savedUserStr = sessionStorage.getItem('rawasi_user') || localStorage.getItem('rawasi_user');

    if (savedToken && savedUserStr) {
      try {
        this.token = savedToken;
        this.currentUser = JSON.parse(savedUserStr);
        sessionStorage.setItem('rawasi_session_active', 'true');
        sessionStorage.setItem('rawasi_token', savedToken);
        sessionStorage.setItem('rawasi_user', savedUserStr);
        localStorage.setItem('rawasi_token', savedToken);
        localStorage.setItem('rawasi_user', savedUserStr);

        // إذا كانت الشاشة مقفلة قبل إعادة تحميل الصفحة
        if (sessionStorage.getItem('rawasi_is_locked') === 'true') {
          this.showApp();
          this.updateUserUI();
          this.applyPermissions();
          this.lockScreen();
          return;
        }

        this.showApp();
        this.updateUserUI();
        this.applyPermissions();

        // بدء نبض التحقق الدوري من الجلسة وتتبع النشاط
        this.startHeartbeat();
        this.startActivityTracker();

        // التحقق من صحة وصلاحية الجلسة مع الخادم في الخلفية
        await this.verifySession();
        return;
      } catch (e) {
        console.warn('خطأ في استرجاع بيانات الجلسة السابقة:', e);
        this.token = null;
        this.currentUser = null;
      }
    }

    // عند بداية تشغيل المشروع: تسجيل الدخول إجباري دائماً
    this.token = null;
    this.currentUser = null;
    sessionStorage.removeItem('rawasi_session_active');
    this.showLogin();
  },

  // بدء نبض الحفاظ على الجلسة كل 25 ثانية والتحقق من عدم تكرار الحساب
  startHeartbeat() {
    this.stopHeartbeat();
    this._heartbeatInterval = setInterval(async () => {
      if (!this.token) return;
      try {
        const res = await fetch('/api/auth/heartbeat', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        });
        const data = await res.json();
        if (!data.success && data.session_terminated) {
          this.stopHeartbeat();
          this.logout(true, data.message || 'تم تسجيل الدخول بهذا الحساب من جهاز أو نافذة أخرى. تم إنهاء هذه الجلسة منعاً للتكرار.');
        }
      } catch (e) {
        // خطأ شبكة مؤقت
      }
    }, 25000);
  },

  // إيقاف نبض الجلسة
  stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  },

  // التحقق من الجلسة عبر السيرفر
  async verifySession() {
    if (!this.token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await res.json();
      if (data.success && data.user) {
        this.currentUser = data.user;
        localStorage.setItem('rawasi_user', JSON.stringify(this.currentUser));
        this.updateUserUI();
        this.applyPermissions();
      } else {
        // انتهت صلاحية الجلسة أو تم تسجيل الدخول من مكان آخر
        console.warn('جلسة الدخول منتهية أو غير صالحة:', data.message);
        this.stopHeartbeat();
        this.logout(false, data.message || 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول');
      }
    } catch (err) {
      console.warn('تعذر التحقق من الخادم حالياً، مواصلة العمل بالجلسة المخزنة محلياً:', err);
    }
  },

  // إظهار شاشة الدخول وإخفاء النظام
  showLogin() {
    const overlay = document.getElementById('loginScreenOverlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
    }
    const errorBox = document.getElementById('loginErrorMsg');
    if (errorBox) {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
    }
    const conflictBox = document.getElementById('loginConflictBox');
    if (conflictBox) {
      conflictBox.style.display = 'none';
    }

    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');

    // استرجاع آخر اسم مستخدم تم الدخول به لتسهيل العملية وتجنب تكرار كتابته
    const lastUser = localStorage.getItem('rawasi_last_username');
    if (usernameInput) {
      if (!usernameInput.value && lastUser) {
        usernameInput.value = lastUser;
      }
      setTimeout(() => {
        if (usernameInput.value && passwordInput) {
          passwordInput.focus();
        } else {
          usernameInput.focus();
        }
      }, 150);
    }
  },

  // إخفاء شاشة الدخول وإظهار النظام
  showApp() {
    const overlay = document.getElementById('loginScreenOverlay');
    if (overlay) {
      overlay.classList.add('hidden');
      setTimeout(() => {
        if (overlay.classList.contains('hidden')) {
          overlay.style.display = 'none';
        }
      }, 400);
    }
  },

  // تعبئة سريعة للحسابات التجريبية
  fillQuickLogin(username, password) {
    const uInput = document.getElementById('loginUsername');
    const pInput = document.getElementById('loginPassword');
    if (uInput) uInput.value = username;
    if (pInput) pInput.value = password;
    const btn = document.getElementById('btnLoginSubmit');
    if (btn) btn.focus();
    this.cancelConflictPrompt();
  },

  // الحصول على المعرف الفريد الثابت للجهاز أو توليده وتخزينه محلياً
  getDeviceId() {
    let devId = '';
    try {
      devId = localStorage.getItem('rawasi_device_uuid') || '';
    } catch (e) {}
    if (!devId) {
      const rand = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
      devId = 'dev_' + Date.now().toString(36) + '_' + rand;
      try {
        localStorage.setItem('rawasi_device_uuid', devId);
      } catch (e) {}
    }
    return devId;
  },

  // استخراج اسم ووصف مقروء للجهاز الحالي (الكمبيوتر / الموبايل / المتصفح)
  getDeviceFriendlyName() {
    const ua = navigator.userAgent || '';
    let platform = 'كمبيوتر';
    if (/android/i.test(ua)) platform = 'هاتف أندرويد';
    else if (/iphone|ipad|ipod/i.test(ua)) platform = 'جهاز آبل (iOS)';
    else if (/windows/i.test(ua)) platform = 'كمبيوتر ويندوز';
    else if (/macintosh|mac os x/i.test(ua)) platform = 'جهاز ماك';
    else if (/linux/i.test(ua)) platform = 'جهاز لينكس';

    let browser = '';
    if (/edg/i.test(ua)) browser = 'Edge';
    else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
    else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
    else if (/safari/i.test(ua)) browser = 'Safari';

    return browser ? `${platform} (${browser})` : platform;
  },

  // معالجة نموذج تسجيل الدخول (مع دعم خيار إنهاء الجلسة المتزامنة السابقة وقفل الجهاز المعتمد)
  async submitLogin(e, force = false) {
    if (e) e.preventDefault();

    if (this._isLoggingIn) return;

    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');
    const errorBox = document.getElementById('loginErrorMsg');
    const conflictBox = document.getElementById('loginConflictBox');
    const conflictText = document.getElementById('loginConflictText');
    const submitBtn = document.getElementById('btnLoginSubmit');

    const username = (this._pendingCredentials && force) ? this._pendingCredentials.username : usernameInput?.value?.trim();
    const password = (this._pendingCredentials && force) ? this._pendingCredentials.password : passwordInput?.value;

    if (!username || !password) {
      if (errorBox) {
        errorBox.textContent = 'يرجى إدخال اسم المستخدم وكلمة المرور';
        errorBox.style.display = 'block';
      }
      return;
    }

    this._isLoggingIn = true;

    if (errorBox) {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
    }
    if (conflictBox) {
      conflictBox.style.display = 'none';
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>جاري التحقق والاتصال...</span>`;
    }

    try {
      const devId = this.getDeviceId();
      const devName = this.getDeviceFriendlyName();

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          password, 
          force: !!force,
          deviceId: devId,
          deviceName: devName,
          deviceInfo: `${devName} | ${navigator.userAgent || 'متصفح النظام'}`
        })
      });

      const data = await res.json();

      // حالة قفل الحساب على جهاز واحد معتمد ومنع أي جهاز جديد
      if (res.status === 403 && data.device_locked) {
        if (errorBox) {
          errorBox.innerHTML = `<strong>⚠️ تنبيه أمان صارم:</strong><br>${data.message}`;
          errorBox.style.display = 'block';
        } else {
          alert(data.message);
        }
        return;
      }

      // حالة خارج فترة وساعات العمل المحددة
      if (res.status === 403 && data.outside_work_hours) {
        if (errorBox) {
          errorBox.innerHTML = `<strong>⏰ خارج أوقات العمل:</strong><br>${data.message}`;
          errorBox.style.display = 'block';
        } else {
          alert(data.message);
        }
        return;
      }

      // حالة قفل الحساب مؤقتاً بسبب استنفاد محاولات الدخول (Rate Limiting)
      if (res.status === 429 || data.rateLimited) {
        this.handleRateLimit(data.lockoutSeconds || 60, data.message);
        return;
      }

      // حالة طلب التحقق بخطوتين (2FA) لحساب المدير العام
      if (data.requires2FA) {
        this._pending2FAToken = data.tempToken;
        this._pending2FAUser = data.user;
        this.show2FAModal();
        return;
      }

      // حالة اكتشاف جلسة نشطة أخرى لنفس المستخدم (Duplicate Active Session)
      if (res.status === 409 || data.already_logged_in) {
        this._pendingCredentials = { username, password };
        if (conflictBox) {
          if (conflictText) {
            conflictText.textContent = data.message || `المستخدم (${username}) متصل بالنظام حالياً من جهاز آخر. لمنع تكرار الحسابات، هل ترغب في إنهاء الجلسة السابقة والدخول الآن؟`;
          }
          conflictBox.style.display = 'block';
        } else if (errorBox) {
          errorBox.textContent = data.message;
          errorBox.style.display = 'block';
        }
        return;
      }

      if (data.success && data.token && data.user) {
        // إيقاف مؤقت الحظر وإخفاء الصندوق عند النجاح
        if (this._rateLimitTimer) {
          clearInterval(this._rateLimitTimer);
          this._rateLimitTimer = null;
        }
        const rateLimitBox = document.getElementById('loginRateLimitBox');
        if (rateLimitBox) rateLimitBox.style.display = 'none';

        this._pendingCredentials = null;
        this.token = data.token;
        this.sessionId = data.sessionId;
        this.currentUser = data.user;

        sessionStorage.setItem('rawasi_session_active', 'true');
        sessionStorage.setItem('rawasi_token', this.token);
        sessionStorage.setItem('rawasi_user', JSON.stringify(this.currentUser));
        localStorage.setItem('rawasi_token', this.token);
        localStorage.setItem('rawasi_user', JSON.stringify(this.currentUser));
        sessionStorage.removeItem('rawasi_is_locked');
        localStorage.removeItem('rawasi_last_logout_backup');
        localStorage.setItem('rawasi_last_username', this.currentUser.username || username);

        this.isLocked = false;
        this.lastActivityTime = Date.now();

        this.showApp();
        this.updateUserUI();
        this.applyPermissions();
        this.startHeartbeat();
        this.startActivityTracker();

        // التحقق من حالة قاعدة البيانات والاتصال فورياً عند تسجيل الدخول
        if (typeof App !== 'undefined') {
          if (data.dbStatus && App.updateConnectionUI) {
            App.dbStatus = data.dbStatus;
            App.updateConnectionUI(data.dbStatus);
          } else if (App.checkDatabaseStatus) {
            await App.checkDatabaseStatus();
          }

          const isOnline = (App.dbStatus && App.dbStatus.isOnline);
          if (typeof App.showToast === 'function') {
            if (isOnline) {
              App.showToast(`🟢 تم التحقق: متصل بقاعدة البيانات السحابية (أونلاين) - مرحباً بك ${this.currentUser.full_name}`, 'success');
            } else {
              App.showToast(`🔴 تم التحقق: يعمل النظام على قاعدة البيانات المحلية (أوفلاين) - مرحباً بك ${this.currentUser.full_name}`, 'warning');
            }
          }
        } else if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(data.message || `مرحباً بك ${this.currentUser.full_name}!`, 'success');
        }

        // تفريغ كلمة المرور
        if (passwordInput) passwordInput.value = '';

        // التأكد من توجيه المستخدم لشاشة مسموحة
        if (this.hasPermission('dashboard:view')) {
          if (typeof App !== 'undefined' && App.navigate) App.navigate('dashboard');
        } else {
          this.navigateToFirstAllowed();
        }
      } else {
        let msg = data.message || 'بيانات الدخول غير صحيحة، يرجى المحاولة مرة أخرى.';
        if (data.remainingAttempts !== undefined) {
          msg = `<strong>⚠️ بيانات الدخول غير صحيحة</strong><br>المحاولات المتبقية قبل القفل المؤقت: <span style="font-weight:900;color:#f87171;">(${data.remainingAttempts} من 5)</span>`;
        }
        if (errorBox) {
          errorBox.innerHTML = msg;
          errorBox.style.display = 'block';
        }
        if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(data.message || 'خطأ في تسجيل الدخول', 'error');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      if (errorBox) {
        errorBox.textContent = 'تعذر الاتصال بالخادم، يرجى التأكد من تشغيل النظام وقاعدة البيانات.';
        errorBox.style.display = 'block';
      }
    } finally {
      this._isLoggingIn = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <span>تسجيل الدخول</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>
        `;
      }
    }
  },

  // إدارة وعرض عداد الحظر المرئي لمحاولات الدخول الخاطئة (Rate Limiting)
  handleRateLimit(lockoutSeconds, message) {
    const box = document.getElementById('loginRateLimitBox');
    const msg = document.getElementById('loginRateLimitMsg');
    const timer = document.getElementById('loginCooldownTimer');
    const submitBtn = document.getElementById('btnLoginSubmit');
    const errorBox = document.getElementById('loginErrorMsg');

    if (errorBox) {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
    }

    if (box) box.style.display = 'block';
    if (msg && message) msg.textContent = message;

    if (this._rateLimitTimer) {
      clearInterval(this._rateLimitTimer);
      this._rateLimitTimer = null;
    }

    let remaining = parseInt(lockoutSeconds, 10) || 60;

    const updateDisplay = () => {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      const str = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      if (timer) timer.textContent = str;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>محظور مؤقتاً (${str})</span>`;
      }
    };

    updateDisplay();

    this._rateLimitTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(this._rateLimitTimer);
        this._rateLimitTimer = null;
        if (box) box.style.display = 'none';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `
            <span>تسجيل الدخول</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>
          `;
        }
      } else {
        updateDisplay();
      }
    }, 1000);
  },

  // تطبيع وتوحيد مدخلات رمز التحقق بخطوتين (تحويل الأرقام العربية إلى إنجليزية ومنع الرموز)
  normalize2FaInput(input) {
    if (!input) return;
    let val = String(input.value || '')
      .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
      .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
      .replace(/[^0-9]/g, '');
    input.value = val.slice(0, 6);
  },

  // تبديل إظهار / إخفاء رمز 2FA في نافذة تسجيل الدخول
  toggle2FaLoginEye() {
    const input = document.getElementById('twoFactorCodeInput');
    const eye = document.getElementById('twoFactorLoginEyeIcon');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (eye) eye.textContent = '🙈';
    } else {
      input.type = 'password';
      if (eye) eye.textContent = '👁️';
    }
  },

  // فتح نافذة التحقق بخطوتين (2FA)
  show2FAModal() {
    const modal = document.getElementById('twoFactorModal');
    const input = document.getElementById('twoFactorCodeInput');
    const err = document.getElementById('twoFactorErrorMsg');
    const subtitle = document.getElementById('twoFactorSubtitle');
    if (err) {
      err.style.display = 'none';
      err.textContent = '';
    }
    if (subtitle && this._pending2FAUser) {
      const uName = this._pending2FAUser.full_name || this._pending2FAUser.username;
      subtitle.textContent = `مرحباً بك (${uName})! حسابك محمي بالتحقق بخطوتين. يرجى إدخال رمز الأمان (PIN) المكون من 6 أرقام للدخول.`;
    }
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
    }
    if (input) {
      input.value = '';
      input.type = 'password';
      const eye = document.getElementById('twoFactorLoginEyeIcon');
      if (eye) eye.textContent = '👁️';
      setTimeout(() => input.focus(), 150);
    }
  },

  // إلغاء عملية التحقق بخطوتين
  cancel2FA() {
    const modal = document.getElementById('twoFactorModal');
    if (modal) {
      modal.style.display = 'none';
    }
    this._pending2FAToken = null;
    this._pending2FAUser = null;
    const err = document.getElementById('twoFactorErrorMsg');
    if (err) err.style.display = 'none';
    const errorBox = document.getElementById('loginErrorMsg');
    if (errorBox) {
      errorBox.textContent = 'تم إلغاء عملية التحقق بخطوتين.';
      errorBox.style.display = 'block';
    }
  },

  // تأكيد رمز التحقق بخطوتين والدخول للنظام
  async submit2FA(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('twoFactorCodeInput');
    const err = document.getElementById('twoFactorErrorMsg');
    const btn = document.getElementById('btnSubmit2FA');

    const normalizeDigits = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
        .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
        .replace(/[^0-9]/g, '')
        .trim();
    };

    const code = normalizeDigits(input ? input.value : '');

    if (!code || code.length !== 6) {
      if (err) {
        err.textContent = 'يرجى إدخال رمز التحقق المكون من 6 أرقام (PIN)';
        err.style.display = 'block';
      }
      return;
    }

    if (!this._pending2FAToken) {
      if (err) {
        err.textContent = 'انتهت صلاحية رمز الجلسة المؤقت، يرجى إعادة تسجيل الدخول';
        err.style.display = 'block';
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'جاري التحقق...';
    }

    try {
      const devId = this.getDeviceId();
      const devName = this.getDeviceFriendlyName();

      const res = await fetch('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempToken: this._pending2FAToken,
          code: code,
          deviceId: devId,
          deviceName: devName,
          deviceInfo: `${devName} | ${navigator.userAgent || 'متصفح النظام'}`
        })
      });

      const data = await res.json();

      if (data.success && data.token && data.user) {
        const modal = document.getElementById('twoFactorModal');
        if (modal) modal.style.display = 'none';

        this._pending2FAToken = null;
        this._pending2FAUser = null;
        this._pendingCredentials = null;
        this.token = data.token;
        this.sessionId = data.sessionId;
        this.currentUser = data.user;

        sessionStorage.setItem('rawasi_session_active', 'true');
        sessionStorage.setItem('rawasi_token', this.token);
        sessionStorage.setItem('rawasi_user', JSON.stringify(this.currentUser));
        localStorage.setItem('rawasi_token', this.token);
        localStorage.setItem('rawasi_user', JSON.stringify(this.currentUser));
        sessionStorage.removeItem('rawasi_is_locked');
        localStorage.removeItem('rawasi_last_logout_backup');
        localStorage.setItem('rawasi_last_username', this.currentUser.username || 'admin');

        this.isLocked = false;
        this.lastActivityTime = Date.now();

        this.showApp();
        this.updateUserUI();
        this.applyPermissions();
        this.startHeartbeat();
        this.startActivityTracker();

        // إخفاء مؤقت الحظر إن وجد
        if (this._rateLimitTimer) {
          clearInterval(this._rateLimitTimer);
          this._rateLimitTimer = null;
        }
        const rateLimitBox = document.getElementById('loginRateLimitBox');
        if (rateLimitBox) rateLimitBox.style.display = 'none';

        if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(`🛡️ تم التحقق بخطوتين بنجاح - مرحباً بك يا ${this.currentUser.full_name}`, 'success');
        }

        if (this.hasPermission('dashboard:view')) {
          if (typeof App !== 'undefined' && App.navigate) App.navigate('dashboard');
        } else {
          this.navigateToFirstAllowed();
        }
      } else {
        if (err) {
          err.textContent = data.message || 'رمز التحقق (PIN) غير صحيح، يرجى المحاولة مجدداً';
          err.style.display = 'block';
        }
        if (input) {
          input.value = '';
          input.focus();
        }
      }
    } catch (error) {
      if (err) {
        err.textContent = 'حدث خطأ أثناء الاتصال بالخادم للتحقق من الرمز';
        err.style.display = 'block';
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✓ تأكيد ودخول';
      }
    }
  },

  // تأكيد وإنهاء الجلسة السابقة والدخول فوراً
  forceTakeoverLogin() {
    this.submitLogin(null, true);
  },

  // إلغاء رسالة تعارض الدخول
  cancelConflictPrompt() {
    const conflictBox = document.getElementById('loginConflictBox');
    if (conflictBox) conflictBox.style.display = 'none';
    this._pendingCredentials = null;
  },

  // تسجيل الخروج مع إنشاء نسخة احتياطية تلقائية وفورية لأحدث التعديلات
  async logout(showNotify = true, customMsg = null) {
    this.stopHeartbeat();
    this.stopActivityTracker();
    this.hideLockScreen();
    this.isLocked = false;
    sessionStorage.removeItem('rawasi_is_locked');
    sessionStorage.removeItem('rawasi_session_active');

    const currentUser = this.currentUser;
    const username = currentUser ? (currentUser.username || currentUser.full_name) : 'user';

    // حفظ اسم المستخدم للرجوع السريع
    if (currentUser && currentUser.username) {
      localStorage.setItem('rawasi_last_username', currentUser.username);
    }

    // إشعار المستخدم ببدء النسخ الاحتياطي التلقائي
    if (showNotify && typeof App !== 'undefined' && App.showToast) {
      App.showToast('جاري حفظ آخر التعديلات وإنشاء نسخة احتياطية آمنة لقاعدة البيانات... ⏳', 'warning');
    }

    let backupFileName = null;
    // إرسال طلب إنشاء النسخة الاحتياطية قبل إنهاء الجلسة
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const isOnline = (typeof App !== 'undefined' && App.dbStatus) ? App.dbStatus.isOnline : false;
      const res = await fetch('/api/settings/auto-backup-logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username,
          mode: isOnline ? 'online' : 'offline',
          notes: `تسجيل خروج المستخدم: ${username} (${isOnline ? 'وضع أونلاين سحابي' : 'وضع أوفلاين محلي'})`
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.success && data.data) {
        backupFileName = data.data.fileName;
        sessionStorage.setItem('rawasi_last_logout_backup_file', backupFileName || '');
        console.log('✅ Auto backup created upon logout:', backupFileName);
      }
    } catch (e) {
      console.warn('Auto backup note on logout:', e.message);
    }

    // إخطار السيرفر بإنهاء الجلسة فوراً في قاعدة البيانات
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': this.token ? `Bearer ${this.token}` : '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: username, userId: currentUser?.id })
      });
    } catch (e) {}

    // مسح بيانات الجلسة الحالية من sessionStorage و localStorage
    sessionStorage.removeItem('rawasi_token');
    sessionStorage.removeItem('rawasi_user');
    sessionStorage.removeItem('rawasi_session_active');
    sessionStorage.removeItem('rawasi_is_locked');
    localStorage.removeItem('rawasi_token');
    localStorage.removeItem('rawasi_user');
    localStorage.removeItem('rawasi_last_logout_backup');
    this.purgeSensitiveLocalStorage();

    this.token = null;
    this.sessionId = null;
    this.currentUser = null;

    if (showNotify && typeof App !== 'undefined' && App.showToast) {
      const successMsg = backupFileName
        ? `تم تسجيل الخروج بنجاح وحفظ نسخة احتياطية لقاعدة البيانات: (${backupFileName}) 🛡️`
        : (customMsg || 'تم تسجيل الخروج بنجاح وتم حفظ أحدث نسخة احتياطية لمشروعك ✅');
      App.showToast(successMsg, 'success');
    }

    const errorBox = document.getElementById('loginErrorMsg');
    if (errorBox) {
      if (customMsg) {
        errorBox.textContent = customMsg;
        errorBox.style.display = 'block';
      } else {
        errorBox.style.display = 'none';
      }
    }

    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) passwordInput.value = '';

    this.showLogin();
  },

  // جلب المسمى الوظيفي بالعربي
  getUserRoleTitle(role = null) {
    const r = role || (this.currentUser ? this.currentUser.role : '');
    if (r === 'admin') return 'المدير العام';
    if (r === 'accountant') return 'المحاسب المالي';
    if (r === 'project_manager') return 'مهندس المشاريع';
    if (r === 'storekeeper') return 'أمين المخزن';
    return 'مستخدم النظام';
  },

  // تحديث بيانات المستخدم في شريط الرأس العلوي (Header) وشاشة القفل
  updateUserUI() {
    if (!this.currentUser) return;

    const userNameEl = document.getElementById('headerUserName');
    const userRoleEl = document.getElementById('headerUserRole');
    const userAvatarEl = document.getElementById('headerUserAvatar');

    const displayName = this.currentUser.full_name || this.currentUser.username;
    const roleDisplay = this.getUserRoleTitle(this.currentUser.role);
    const initialChar = displayName ? displayName.charAt(0).toUpperCase() : 'م';

    if (userNameEl) userNameEl.textContent = displayName;
    if (userRoleEl) userRoleEl.textContent = roleDisplay;
    if (userAvatarEl) userAvatarEl.textContent = initialChar;

    // تحديث بيانات شاشة القفل
    const lockNameEl = document.getElementById('lockScreenUserName');
    const lockRoleEl = document.getElementById('lockScreenUserRole');
    const lockAvatarEl = document.getElementById('lockScreenUserAvatar');

    if (lockNameEl) lockNameEl.textContent = displayName;
    if (lockRoleEl) lockRoleEl.textContent = roleDisplay;
    if (lockAvatarEl) lockAvatarEl.textContent = initialChar;

    // تحديث شارة مهلة القفل
    this.updateLockTimeoutBadge();

    // تحديث شارة سياسة الجلسات والأمان
    this.updateSessionModeBadge();

    // تحديث مؤشر وشارة الاتصال عند اسم المستخدم أيضاً
    if (typeof App !== 'undefined' && App.updateConnectionUI && App.dbStatus) {
      App.updateConnectionUI(App.dbStatus);
    }
  },

  // فحص ما إذا كان المستخدم يملك صلاحية معينة (متطابق بالكامل مع محرك الخادم RBAC)
  hasPermission(permKey) {
    if (!this.currentUser) return false;

    // مدير النظام الرئيسي (Super Admin) يملك كافة الصلاحيات دائماً
    if (this.currentUser.username === 'admin' || this.currentUser.role === 'admin') {
      return true;
    }

    let perms = this.currentUser.permissions || [];
    if (typeof perms === 'string') {
      try {
        perms = (perms.startsWith('[') || perms.startsWith('{')) ? JSON.parse(perms) : perms.split(',').map(s => s.trim());
      } catch (e) {
        perms = perms.split(',').map(s => s.trim());
      }
    }

    // إذا كانت الصلاحيات فارغة تماماً ولم تُخصص، نطبق الصلاحيات الافتراضية حسب الدور
    if (!perms || perms.length === 0) {
      if (this.currentUser.role === 'admin') {
        return true;
      }
      if (this.currentUser.role === 'accountant') {
        perms = [
          'dashboard:view', 'dashboard:export',
          'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:export',
          'expenses:view', 'expenses:create', 'expenses:edit', 'expenses:export',
          'revenues:view', 'revenues:create', 'revenues:edit', 'revenues:export',
          'billing:view', 'billing:create', 'billing:edit', 'billing:export',
          'custody:view', 'custody:create', 'custody:manage', 'custody:export',
          'clients:view', 'clients:create', 'clients:manage', 'clients:statement',
          'suppliers:view', 'suppliers:create', 'suppliers:manage', 'suppliers:statement',
          'cash:view',
          'hr:view', 'hr:payroll',
          'reports:view', 'reports:export'
        ];
      } else if (this.currentUser.role === 'auditor') {
        perms = [
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
      } else if (this.currentUser.role === 'project_manager') {
        perms = [
          'dashboard:view',
          'projects:view', 'projects:create', 'projects:edit', 'projects:approve', 'projects:export', 'projects:manage', 'projects:print',
          'expenses:view', 'expenses:create',
          'custody:view',
          'inventory:view', 'inventory:issue',
          'reports:view'
        ];
      } else if (this.currentUser.role === 'storekeeper') {
        perms = [
          'inventory:view', 'inventory:create', 'inventory:edit', 'inventory:issue', 'inventory:export', 'inventory:manage',
          'purchases:view',
          'projects:view'
        ];
      } else {
        perms = ['dashboard:view'];
      }
    }

    if (Array.isArray(perms) && (perms.includes('*') || perms.includes('all'))) {
      return true;
    }

    // فحص المفاتيح المطلوبة مع دعم التوافقية والـ Wildcards
    const keys = permKey.split(',').map(k => k.trim()).filter(Boolean);
    return keys.some(key => {
      if (perms.includes(key)) return true;

      const [domain, action] = key.split(':');
      if (perms.includes(`${domain}:*`)) return true;

      if ((action === 'create' || action === 'edit') && perms.includes(`${domain}:manage`)) return true;
      if (action === 'export' && (perms.includes(`${domain}:print`) || perms.includes(`${domain}:statement`))) return true;
      if (action === 'view' && (perms.includes(`${domain}:manage`) || perms.includes(`${domain}:statement`))) return true;
      if (domain === 'inventory' && (action === 'create' || action === 'issue') && (perms.includes('inventory:issue') || perms.includes('inventory:manage'))) return true;
      if (domain === 'accounting' && (action === 'create' || action === 'edit') && perms.includes('accounting:journal')) return true;
      if (domain === 'hr' && (action === 'post' || action === 'create') && perms.includes('hr:payroll')) return true;
      if (domain === 'users' && perms.includes('settings:users')) return true;

      return false;
    });
  },

  // التحقق الأمني من صلاحية المستخدم للوصول لشاشة معينة لمنع التلاعب بالـ DOM
  canAccessView(viewId) {
    if (!this.currentUser) return false;
    if (this.currentUser.username === 'admin' || this.currentUser.role === 'admin') return true;

    const viewPermMap = {
      'dashboard': 'dashboard:view',
      'projects': 'projects:view',
      'projectHub': 'projects:view',
      'projectCloseout': 'projects:view,reports:view',
      'inventory': 'inventory:view',
      'hr': 'hr:view',
      'reports': 'reports:view',
      'revenues': 'revenues:view',
      'expenses': 'expenses:view',
      'journal': 'accounting:journal,accounting:view,reports:view',
      'chartOfAccounts': 'accounting:view,settings:company',
      'costCenters': 'accounting:view,projects:view',
      'currencies': 'accounting:view,settings:company',
      'custody': 'custody:view',
      'contractors': 'clients:view',
      'clients': 'clients:view',
      'suppliers': 'suppliers:view',
      'cash': 'cash:view',
      'contractLifecycle': 'projects:view',
      'cashFlow': 'accounting:view,reports:view',
      'settings': 'settings:users,settings:company,settings:backup'
    };

    const perm = viewPermMap[viewId];
    if (!perm) return true;
    return this.hasPermission(perm);
  },

  // تقييم قوة كلمة المرور وحساب درجات الأمان
  evaluatePasswordStrength(password) {
    if (!password) {
      return { score: 0, label: 'فارغة', color: '#64748b', rules: { hasLength: false, hasNumber: false, hasMixed: false, hasSymbol: false } };
    }
    const hasLength = password.length >= 8;
    const hasNumber = /[0-9]/.test(password);
    const hasMixed = /[a-zA-Z]/.test(password) || /[\u0600-\u06FF]/.test(password);
    const hasSymbol = /[^a-zA-Z0-9\u0600-\u06FF]/.test(password);

    let score = 0;
    if (hasLength) score++;
    if (hasNumber) score++;
    if (hasMixed) score++;
    if (hasSymbol) score++;

    if (password.length >= 12 && score >= 3) {
      score = 4;
    }

    const levels = [
      { label: 'ضعيفة جداً', color: '#ef4444' },
      { label: 'ضعيفة', color: '#f97316' },
      { label: 'متوسطة', color: '#eab308' },
      { label: 'جيدة', color: '#3b82f6' },
      { label: 'قوية وممتازة 🛡️', color: '#10b981' }
    ];

    const currentLevel = levels[score] || levels[0];

    return {
      score,
      label: currentLevel.label,
      color: currentLevel.color,
      rules: { hasLength, hasNumber, hasMixed, hasSymbol }
    };
  },

  // فحص وتحديث واجهة مؤشر القوة التفاعلي
  checkPasswordStrength(password, containerId = 'userPasswordStrengthBox') {
    const box = document.getElementById(containerId);
    if (!box) return;

    if (!password) {
      box.style.display = 'none';
      return;
    }

    box.style.display = 'block';
    const evalResult = this.evaluatePasswordStrength(password);

    const txt = box.querySelector('.strength-text');
    if (txt) {
      txt.textContent = evalResult.label;
      txt.style.color = evalResult.color;
    }

    const segs = box.querySelectorAll('.strength-seg');
    segs.forEach((seg, idx) => {
      if (idx < evalResult.score) {
        seg.style.background = evalResult.color;
      } else {
        seg.style.background = 'rgba(255,255,255,0.08)';
      }
    });

    const ruleLen = box.querySelector('.rule-length');
    const ruleNum = box.querySelector('.rule-number');
    const ruleMix = box.querySelector('.rule-mixed');
    const ruleSym = box.querySelector('.rule-symbol');

    if (ruleLen) {
      ruleLen.textContent = (evalResult.rules.hasLength ? '🟢' : '⚪') + ' 8+ خانات';
      ruleLen.style.color = evalResult.rules.hasLength ? '#10b981' : 'var(--text-secondary)';
    }
    if (ruleNum) {
      ruleNum.textContent = (evalResult.rules.hasNumber ? '🟢' : '⚪') + ' أرقام';
      ruleNum.style.color = evalResult.rules.hasNumber ? '#10b981' : 'var(--text-secondary)';
    }
    if (ruleMix) {
      ruleMix.textContent = (evalResult.rules.hasMixed ? '🟢' : '⚪') + ' أحرف A-z';
      ruleMix.style.color = evalResult.rules.hasMixed ? '#10b981' : 'var(--text-secondary)';
    }
    if (ruleSym) {
      ruleSym.textContent = (evalResult.rules.hasSymbol ? '🟢' : '⚪') + ' رموز خاصة';
      ruleSym.style.color = evalResult.rules.hasSymbol ? '#10b981' : 'var(--text-secondary)';
    }
  },

  // تطبيق الصلاحيات على عناصر القائمة الجانبية والإعدادات
  applyPermissions() {
    const navItems = document.querySelectorAll('#sidebarNavList li[data-perm]');
    let firstAllowed = null;

    navItems.forEach(li => {
      const reqPerm = li.getAttribute('data-perm');
      if (this.hasPermission(reqPerm)) {
        li.style.display = '';
        if (!firstAllowed) {
          const navLink = li.querySelector('a');
          if (navLink) {
            const match = navLink.getAttribute('onclick')?.match(/App\.navigate\('([^']+)'/);
            if (match) firstAllowed = match[1];
          }
        }
      } else {
        li.style.display = 'none';
      }
    });

    // إخفاء أو إظهار ألسنة الإعدادات حسب الصلاحيات
    const usersTab = document.getElementById('tabBtn_settings_users');
    if (usersTab) usersTab.style.display = this.hasPermission('settings:users') ? '' : 'none';

    const compTab = document.getElementById('tabBtn_settings_company');
    if (compTab) compTab.style.display = this.hasPermission('settings:company') ? '' : 'none';

    const backupTab = document.getElementById('tabBtn_settings_backup');
    if (backupTab) backupTab.style.display = this.hasPermission('settings:backup') ? '' : 'none';

    // إخفاء زر الأمان وسياسة الجلسات العام من رأس جدول المستخدمين لأنه أصبح داخل كل مستخدم
    const secBtn = document.getElementById('btnSecuritySessions');
    if (secBtn) {
      secBtn.style.display = 'none';
    }

    return firstAllowed;
  },

  // التوجيه لأول قسم مسموح
  navigateToFirstAllowed() {
    const firstAllowed = this.applyPermissions() || 'dashboard';
    if (typeof App !== 'undefined' && App.navigate) {
      App.navigate(firstAllowed);
    }
  },

  // =================== محرك قفل النظام التلقائي وشاشة القفل ===================

  // تهيئة إعداد مهلة القفل التلقائي
  initLockEngine() {
    const saved = localStorage.getItem('rawasi_lock_timeout');
    if (saved !== null && saved !== undefined && !isNaN(Number(saved))) {
      this.lockTimeoutMinutes = Number(saved);
    } else {
      this.lockTimeoutMinutes = 15; // 15 دقيقة افتراضياً
      localStorage.setItem('rawasi_lock_timeout', '15');
    }
    this.updateLockTimeoutBadge();
  },

  // تحديث نص شارة مهلة القفل في الزر
  updateLockTimeoutBadge() {
    const badge = document.getElementById('currentLockTimeoutBadge');
    if (!badge) return;
    if (this.lockTimeoutMinutes === 0) {
      badge.textContent = 'معطل';
      badge.style.background = 'rgba(148, 163, 184, 0.15)';
      badge.style.color = '#94a3b8';
    } else if (this.lockTimeoutMinutes === 60) {
      badge.textContent = '60 دقيقة';
      badge.style.background = 'rgba(212, 175, 55, 0.2)';
      badge.style.color = '#d4af37';
    } else {
      badge.textContent = `${this.lockTimeoutMinutes} دقيقة`;
      badge.style.background = 'rgba(212, 175, 55, 0.2)';
      badge.style.color = '#d4af37';
    }
  },

  // بدء تتبع نشاط المستخدم ومؤقت الخمول
  startActivityTracker() {
    this.lastActivityTime = Date.now();
    this.stopActivityTracker();

    if (!this._activityListenersBound) {
      this._activityListenersBound = true;
      let lastThrottle = 0;
      const resetActivity = () => {
        const now = Date.now();
        if (now - lastThrottle > 2000) {
          lastThrottle = now;
          if (!this.isLocked) {
            this.lastActivityTime = now;
          }
        }
      };

      window.addEventListener('mousemove', resetActivity, { passive: true });
      window.addEventListener('mousedown', resetActivity, { passive: true });
      window.addEventListener('keydown', resetActivity, { passive: true });
      window.addEventListener('touchstart', resetActivity, { passive: true });
      window.addEventListener('scroll', resetActivity, { passive: true });
    }

    // فحص خمول المستخدم كل 5 ثوانٍ
    this._activityCheckInterval = setInterval(() => {
      if (!this.token || !this.currentUser || this.isLocked) return;
      if (this.lockTimeoutMinutes <= 0) return; // معطل

      const idleDurationMs = Date.now() - this.lastActivityTime;
      const thresholdMs = this.lockTimeoutMinutes * 60 * 1000;

      if (idleDurationMs >= thresholdMs) {
        console.log(`🔒 Auto lock triggered after ${this.lockTimeoutMinutes} min of inactivity.`);
        this.lockScreen();
      }
    }, 5000);
  },

  // إيقاف مؤقت فحص النشاط
  stopActivityTracker() {
    if (this._activityCheckInterval) {
      clearInterval(this._activityCheckInterval);
      this._activityCheckInterval = null;
    }
  },

  // قفل شاشة النظام وإظهار واجهة القفل
  lockScreen() {
    this.isLocked = true;
    sessionStorage.setItem('rawasi_is_locked', 'true');

    const lockOverlay = document.getElementById('appLockScreenOverlay');
    if (lockOverlay) {
      lockOverlay.style.display = 'flex';
    }

    // تحديث بيانات المستخدم على شاشة القفل
    this.updateUserUI();

    const errBox = document.getElementById('lockErrorMsg');
    if (errBox) {
      errBox.style.display = 'none';
      errBox.textContent = '';
    }

    const pwdInput = document.getElementById('lockScreenPassword');
    if (pwdInput) {
      pwdInput.value = '';
      setTimeout(() => pwdInput.focus(), 150);
    }
  },

  // إخفاء شاشة القفل واستئناف العمل
  hideLockScreen() {
    this.isLocked = false;
    sessionStorage.removeItem('rawasi_is_locked');
    const lockOverlay = document.getElementById('appLockScreenOverlay');
    if (lockOverlay) {
      lockOverlay.style.display = 'none';
    }
    const pwdInput = document.getElementById('lockScreenPassword');
    if (pwdInput) pwdInput.value = '';
  },

  // معالجة إلغاء القفل بالتحقق من كلمة المرور
  async submitUnlock(e) {
    if (e) e.preventDefault();

    const pwdInput = document.getElementById('lockScreenPassword');
    const errBox = document.getElementById('lockErrorMsg');
    const submitBtn = document.getElementById('btnLockUnlockSubmit');

    const password = pwdInput ? pwdInput.value : '';
    const username = this.currentUser ? (this.currentUser.username || this.currentUser.full_name) : '';

    if (!password) {
      if (errBox) {
        errBox.textContent = 'يرجى إدخال كلمة المرور لإلغاء القفل';
        errBox.style.display = 'block';
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>جاري التحقق...</span>`;
    }

    try {
      const res = await fetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (data && data.success) {
        this.hideLockScreen();
        this.lastActivityTime = Date.now();
        if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(`تم إلغاء القفل بنجاح، مرحباً بعودتك ${this.currentUser?.full_name || ''} ✅`, 'success');
        }
      } else {
        if (errBox) {
          errBox.textContent = data.message || 'كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى.';
          errBox.style.display = 'block';
        }
        if (pwdInput) {
          pwdInput.select();
          pwdInput.focus();
        }
      }
    } catch (err) {
      console.error('Unlock error:', err);
      if (errBox) {
        errBox.textContent = 'تعذر التحقق من الخادم، يرجى التأكد من تشغيل النظام.';
        errBox.style.display = 'block';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <span>إلغاء القفل واستئناف العمل</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>
        `;
      }
    }
  },

  // فتح نافذة إعداد مهلة فترة القفل التلقائي
  openLockTimeoutModal() {
    const radios = document.querySelectorAll('input[name="lockTimeoutOption"]');
    radios.forEach(r => {
      r.checked = (Number(r.value) === this.lockTimeoutMinutes);
    });
    if (typeof App !== 'undefined' && App.openModal) {
      App.openModal('lockTimeoutModal');
    }
  },

  // حفظ إعداد مهلة فترة القفل
  saveLockTimeoutSettings() {
    const selected = document.querySelector('input[name="lockTimeoutOption"]:checked');
    const val = selected ? Number(selected.value) : 15;

    this.lockTimeoutMinutes = val;
    localStorage.setItem('rawasi_lock_timeout', String(val));
    this.updateLockTimeoutBadge();
    this.lastActivityTime = Date.now();

    if (typeof App !== 'undefined') {
      if (App.closeModal) App.closeModal('lockTimeoutModal');
      if (App.showToast) {
        const msg = val === 0
          ? 'تم تعطيل القفل التلقائي للشاشة (القفل يدوي فقط) 🛡️'
          : `تم ضبط مهلة فترة القفل التلقائي إلى ${val} دقيقة بنجاح ⏱️`;
        App.showToast(msg, 'success');
      }
    }
  },

  // =================== إعدادات الأمان وسياسة الجلسات والتوكن ===================
  _targetSecurityUserId: null,
  _securityUsersList: [],
  _isTargetUserCustom: false,
  _targetUserInfo: null,

  // جلب إعدادات الأمان وسياسة الجلسات من الخادم
  async fetchSecuritySettings() {
    try {
      const res = await fetch('/api/auth/security-settings');
      const data = await res.json();
      if (data && data.success && data.settings) {
        this.securitySettings = Object.assign(this.securitySettings, data.settings);
        this.updateSessionModeBadge();
      }
    } catch (e) {
      console.warn('Could not load security settings:', e);
    }
  },

  // جلب إعدادات أمان مستخدم محدد
  async fetchUserSecuritySettings(userId) {
    try {
      const res = await fetch(`/api/users/${userId}/security-settings`, {
        headers: { 'Authorization': this.token ? `Bearer ${this.token}` : '' }
      });
      const data = await res.json();
      if (data && data.success) {
        this.securitySettings = Object.assign({}, data.defaultSettings || {}, data.settings || {});
        this._isTargetUserCustom = !!data.isCustom;
        this._targetUserInfo = data.user;
      }
    } catch (e) {
      console.warn('Error fetching user security settings:', e);
    }
  },

  // تحديث نص ولون شارة وضع الجلسات في الزر العلوي
  updateSessionModeBadge() {
    const badge = document.getElementById('currentSessionModeBadge');
    if (!badge) return;
    const isMulti = this.securitySettings?.session_mode === 'multi';
    const limit = this.securitySettings?.session_device_limit || 3;
    if (isMulti) {
      badge.textContent = `متعددة (${limit})`;
      badge.style.background = 'rgba(16, 185, 129, 0.2)';
      badge.style.color = '#10b981';
    } else {
      badge.textContent = 'جلسة واحدة';
      badge.style.background = 'rgba(59, 130, 246, 0.2)';
      badge.style.color = '#60a5fa';
    }
  },

  // حساب وتنسيق تاريخ ووقت انتهاء الجلسة الحالية من التوكن (JWT)
  getCurrentSessionExpiryFormatted() {
    const token = this.token || localStorage.getItem('rawasi_token') || localStorage.getItem('token');
    if (!token) return 'غير متوفر (يرجى تسجيل الدخول)';
    try {
      const parts = token.split('.');
      if (parts.length < 2) return 'غير محدد';
      const payload = JSON.parse(atob(parts[1]));
      if (!payload.exp) return 'جلسة دائمة (بدون انتهاء)';
      const expDate = new Date(payload.exp * 1000);
      
      const dateStr = expDate.toLocaleDateString('ar-YE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const timeStr = expDate.toLocaleTimeString('ar-YE', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      return `${dateStr} ${timeStr}`;
    } catch (e) {
      return 'خطأ في قراءة التوكن';
    }
  },

  // فتح نافذة إعدادات الأمان وسياسة الجلسات والتوكن (مقتصرة على المدير العام فقط)
  async openSecuritySessionsModal(userId = null) {
    if (this.currentUser?.role !== 'admin' && this.currentUser?.username !== 'admin') {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('عذراً! ضبط وتعديل خيارات الأمان والجلسات متاح حصرياً للمدير العام فقط 🛡️', 'error');
      } else {
        alert('عذراً! ضبط وتعديل خيارات الأمان والجلسات متاح حصرياً للمدير العام فقط.');
      }
      return;
    }

    this._targetSecurityUserId = (userId && userId !== 'global') ? parseInt(userId) : null;

    // جلب قائمة المستخدمين لملء القائمة المنسدلة
    try {
      const res = await fetch('/api/users');
      const json = await res.json();
      if (json && json.success) {
        this._securityUsersList = json.data || [];
      }
    } catch (e) {}

    this.populateSecurityUsersDropdown();

    if (this._targetSecurityUserId) {
      await this.fetchUserSecuritySettings(this._targetSecurityUserId);
    } else {
      this._isTargetUserCustom = false;
      this._targetUserInfo = null;
      await this.fetchSecuritySettings();
    }

    this.renderSecurityModalState();
    if (typeof App !== 'undefined' && App.openModal) {
      App.openModal('securitySessionsModal');
    }
  },

  // ملء القائمة المنسدلة للمستخدمين في نافذة الأمان
  populateSecurityUsersDropdown() {
    const sel = document.getElementById('selectSecurityTargetUser');
    if (!sel) return;

    let html = `<option value="global">⚙️ الإعدادات العامة الافتراضية للنظام (لكل المستخدمين)</option>`;
    if (this._securityUsersList && this._securityUsersList.length > 0) {
      html += `<optgroup label="👤 تخصيص لمستخدم محدد:">`;
      this._securityUsersList.forEach(u => {
        const isSelected = this._targetSecurityUserId === u.id ? 'selected' : '';
        const roleLabel = u.role === 'admin' ? 'المدير العام' : (u.role_name || u.role);
        const hasCustom = u.security_settings ? ' ⭐ (مخصص)' : '';
        html += `<option value="${u.id}" ${isSelected}>👤 ${u.full_name} (@${u.username}) - [${roleLabel}]${hasCustom}</option>`;
      });
      html += `</optgroup>`;
    }
    sel.innerHTML = html;
    sel.value = this._targetSecurityUserId ? String(this._targetSecurityUserId) : 'global';
  },

  // عند تغيير المستخدم المستهدف من القائمة المنسدلة
  async onSecurityTargetUserChange() {
    const sel = document.getElementById('selectSecurityTargetUser');
    const val = sel ? sel.value : 'global';
    if (val === 'global') {
      this._targetSecurityUserId = null;
      this._isTargetUserCustom = false;
      this._targetUserInfo = null;
      await this.fetchSecuritySettings();
    } else {
      this._targetSecurityUserId = parseInt(val);
      await this.fetchUserSecuritySettings(this._targetSecurityUserId);
    }
    this.renderSecurityModalState();
  },

  // إعادة ضبط أمان المستخدم للإعدادات الافتراضية للنظام
  async resetTargetUserSecurityToDefault() {
    if (!this._targetSecurityUserId) return;
    const target = this._securityUsersList.find(u => u.id === this._targetSecurityUserId);
    const targetName = target?.full_name || target?.username || 'هذا المستخدم';
    const confirmReset = confirm(`هل أنت متأكد من رغبتك في إلغاء الإعدادات المخصصة للمستخدم (${targetName}) واستعادة الإعدادات العامة الافتراضية للنظام؟`);
    if (!confirmReset) return;

    try {
      const res = await fetch(`/api/users/${this._targetSecurityUserId}/security-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token ? `Bearer ${this.token}` : ''
        },
        body: JSON.stringify({ reset_to_default: true })
      });
      const data = await res.json();
      if (data && data.success) {
        this.securitySettings = Object.assign({}, data.settings);
        this._isTargetUserCustom = false;
        this.renderSecurityModalState();
        if (typeof Settings !== 'undefined' && Settings.loadUsers) {
          await Settings.loadUsers();
        }
        if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(data.message || `تمت استعادة الإعدادات العامة الافتراضية للمستخدم (${targetName}) بنجاح 🛡️`, 'success');
        }
      }
    } catch (e) {
      alert('خطأ أثناء إعادة الضبط: ' + e.message);
    }
  },

  // رسم وتحديث حالة العناصر داخل نافذة الأمان لتطابق التصميم
  renderSecurityModalState() {
    const s = this.securitySettings || {};
    const isUserMode = !!this._targetSecurityUserId;

    // تحديث عناوين وشارات المستهدف
    const bannerTitle = document.getElementById('securityModalHeaderTitle');
    const badgeCustom = document.getElementById('securityUserCustomStatusBadge');
    const btnReset = document.getElementById('btnResetUserSecurity');
    const saveBtn = document.getElementById('btnSaveSecuritySettings');
    const footerNote = document.getElementById('securityModalFooterNote');

    if (bannerTitle) {
      if (isUserMode) {
        const u = this._securityUsersList.find(x => x.id === this._targetSecurityUserId) || this._targetUserInfo;
        bannerTitle.innerHTML = `<span style="color:#10b981;">🛡️</span> تخصيص أمان وجلسات: <span style="color:#d4af37;">${u?.full_name || u?.username || 'المستخدم'}</span>`;
      } else {
        bannerTitle.innerHTML = `<span style="color:#10b981;">🛡️</span> إعدادات الأمان وسياسة الجلسات العامة للنظام`;
      }
    }

    if (badgeCustom) {
      if (isUserMode) {
        if (this._isTargetUserCustom) {
          badgeCustom.innerHTML = `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4);">⭐ إعدادات مخصصة خاصة بهذا المستخدم</span>`;
        } else {
          badgeCustom.innerHTML = `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);">⚙️ يرث حالياً الإعدادات العامة للنظام</span>`;
        }
      } else {
        badgeCustom.innerHTML = `<span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4);">🌐 تطبق افتراضياً على كل المستخدمين</span>`;
      }
    }

    if (btnReset) {
      btnReset.style.display = (isUserMode && this._isTargetUserCustom) ? 'inline-block' : 'none';
    }

    if (saveBtn) {
      if (isUserMode) {
        const u = this._securityUsersList.find(x => x.id === this._targetSecurityUserId) || this._targetUserInfo;
        saveBtn.innerHTML = `💾 حفظ أمان (${u?.full_name?.split(' ')[0] || u?.username || 'المستخدم'})`;
      } else {
        saveBtn.innerHTML = `💾 حفظ وتطبيق الإعدادات العامة`;
      }
    }

    if (footerNote) {
      if (isUserMode) {
        footerNote.textContent = `🛡️ تسري هذه الإعدادات خصيصاً على هذا المستخدم المختار فقط بإشراف المدير العام.`;
      } else {
        footerNote.textContent = `🛡️ تسري هذه الإعدادات كإعدادات عامة افتراضية لجميع مستخدمي نظام رواسي عدن.`;
      }
    }

    // 1. سياسة الجلسة (جلسة واحدة صارمة أو جلسات متعددة)
    const btnSingle = document.getElementById('btnModeSingle');
    const btnMulti = document.getElementById('btnModeMulti');
    const boxLimit = document.getElementById('boxDeviceLimit');
    const note = document.getElementById('sessionPolicyHelpNote');

    const isLockDevice = (s.session_overflow_action === 'lock_device');

    if (s.session_mode === 'single' || isLockDevice) {
      if (btnSingle) btnSingle.classList.add('active');
      if (btnMulti) btnMulti.classList.remove('active');
      if (boxLimit) {
        boxLimit.style.opacity = '0.35';
        boxLimit.style.pointerEvents = 'none';
      }
      if (note) {
        if (isLockDevice) {
          note.innerHTML = '🛡️ <strong>منع أي جهاز جديد:</strong> الحساب مصرح له بالدخول من جهاز واحد فقط يتم اعتماده عند أول تسجيل دخول، ويمنع النظام تماماً تسجيل الدخول من أي جهاز جديد آخر لحماية البيانات.';
        } else {
          note.innerHTML = '🔒 <strong>جلسة واحدة صارمة:</strong> مسموح بجهاز واحد فقط لهذا الحساب. في حال فتح جلسة جديدة، يتم تطبيق الإجراء المختار إما بطرد الجلسة السابقة أو رفض الدخول الجديد.';
        }
      }
    } else {
      if (btnSingle) btnSingle.classList.remove('active');
      if (btnMulti) btnMulti.classList.add('active');
      if (boxLimit) {
        boxLimit.style.opacity = '1';
        boxLimit.style.pointerEvents = 'auto';
      }
      if (note) {
        note.innerHTML = '💡 <strong>الجلسات المتعددة:</strong> تتيح فتح النظام من المتصفح والموبايل في وقت واحد حتى سقف الأجهزة المحدد، وعند التجاوز يتم تطبيق الإجراء المختار.';
      }
    }

    // 2. سقف الأجهزة (2, 3, 5)
    const limit = Number(s.session_device_limit) || 3;
    document.querySelectorAll('.device-limit-btn').forEach(btn => {
      const bLimit = Number(btn.getAttribute('data-limit'));
      btn.classList.toggle('active', bLimit === limit);
    });

    // 3. عند التجاوز (kick_oldest, block_new, lock_device)
    const action = s.session_overflow_action || 'kick_oldest';
    document.querySelectorAll('.overflow-action-btn').forEach(btn => {
      const bAction = btn.getAttribute('data-action');
      btn.classList.toggle('active', bAction === action);
    });

    // صندوق وحالة الجهاز المعتمد
    const devBox = document.getElementById('authorizedDeviceBox');
    const devText = document.getElementById('authorizedDeviceText');
    const resetDevBtn = document.getElementById('btnResetAuthorizedDevice');
    if (devBox) {
      if (action === 'lock_device' || s.authorized_device_id) {
        devBox.style.display = 'flex';
        if (s.authorized_device_id) {
          const devName = s.authorized_device_name || 'جهاز مسجل';
          const devDate = s.authorized_device_at ? new Date(s.authorized_device_at).toLocaleDateString('ar-YE') : '';
          devText.innerHTML = `📱 <strong>الجهاز المعتمد:</strong> <span style="color:#38bdf8;">${devName}</span> ${devDate ? `(تاريخ الربط: ${devDate})` : ''}`;
          if (resetDevBtn) resetDevBtn.style.display = 'inline-block';
        } else {
          devText.innerHTML = `📱 <strong>الجهاز المعتمد:</strong> <span style="color:#94a3b8;">لم يسجل جهاز بعد (سيتم قفل أول جهاز يسجل منه).</span>`;
          if (resetDevBtn) resetDevBtn.style.display = 'none';
        }
      } else {
        devBox.style.display = 'none';
      }
    }

    // 4. مدة صلاحية التوكن (JWT)
    const exp = s.jwt_token_expiry || '8h';
    document.querySelectorAll('.token-expiry-btn').forEach(btn => {
      const bExp = btn.getAttribute('data-exp');
      btn.classList.toggle('active', bExp === exp);
    });

    // الشارة الخضراء أعلى بطاقة التوكن
    const badge = document.getElementById('badgeCurrentTokenExpiry');
    if (badge) {
      if (exp === 'custom') {
        const sTime = s.work_start_time || '08:00';
        const eTime = s.work_end_time || '16:00';
        badge.textContent = `${sTime}-${eTime}`;
      } else {
        badge.textContent = exp;
      }
    }

    // صندوق فترة وساعات العمل المخصصة
    const customBox = document.getElementById('customExpiryBox');
    if (customBox) {
      customBox.style.display = (exp === 'custom') ? 'block' : 'none';
      if (exp === 'custom') {
        const startInput = document.getElementById('inputWorkStartTime');
        const endInput = document.getElementById('inputWorkEndTime');
        if (startInput) startInput.value = s.work_start_time || '08:00';
        if (endInput) endInput.value = s.work_end_time || '16:00';
        this.onWorkHoursChange();
      }
    }

    // 5. تذييل انتهاء الجلسة
    const expiryFooter = document.getElementById('currentSessionExpiryFormatted');
    if (expiryFooter) {
      expiryFooter.textContent = this.getCurrentSessionExpiryFormatted();
    }
  },

  // تبديل وضع الجلسة
  setSessionMode(mode) {
    this.securitySettings.session_mode = mode;
    if (mode === 'multi' && this.securitySettings.session_overflow_action === 'lock_device') {
      this.securitySettings.session_overflow_action = 'kick_oldest';
    }
    this.renderSecurityModalState();
  },

  // تحديد سقف الأجهزة
  setDeviceLimit(limit) {
    this.securitySettings.session_device_limit = Number(limit);
    this.renderSecurityModalState();
  },

  // تحديد إجراء التجاوز (طرد الأقدم، منع الجديد، منع أي جهاز جديد)
  setOverflowAction(action) {
    this.securitySettings.session_overflow_action = action;
    if (action === 'lock_device') {
      this.securitySettings.session_mode = 'single';
      this.securitySettings.session_device_limit = 1;
    }
    this.renderSecurityModalState();
  },

  // فك قفل الجهاز المعتمد لمستخدم محدد
  async resetAuthorizedDevice() {
    if (!confirm('هل أنت متأكد من فك قفل الجهاز المعتمد؟ سيتم السماح للمستخدم بتسجيل الدخول من جهاز جديد واعتماده.')) {
      return;
    }
    if (this._targetSecurityUserId) {
      try {
        const res = await fetch(`/api/users/${this._targetSecurityUserId}/reset-device`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.token ? `Bearer ${this.token}` : ''
          }
        });
        const data = await res.json();
        if (data.success) {
          delete this.securitySettings.authorized_device_id;
          delete this.securitySettings.authorized_device_name;
          delete this.securitySettings.authorized_device_at;
          this.renderSecurityModalState();
          if (typeof App !== 'undefined' && App.showToast) {
            App.showToast(data.message, 'success');
          } else {
            alert(data.message);
          }
        } else {
          alert(data.message || 'حدث خطأ أثناء فك الربط');
        }
      } catch (e) {
        alert('خطأ في الاتصال: ' + e.message);
      }
    } else {
      delete this.securitySettings.authorized_device_id;
      delete this.securitySettings.authorized_device_name;
      delete this.securitySettings.authorized_device_at;
      this.renderSecurityModalState();
    }
  },

  // تحديد مدة صلاحية التوكن
  setTokenExpiry(exp) {
    this.securitySettings.jwt_token_expiry = exp;
    this.renderSecurityModalState();
  },

  // عند تغيير فترة وساعات العمل المخصصة
  onWorkHoursChange() {
    const startInput = document.getElementById('inputWorkStartTime');
    const endInput = document.getElementById('inputWorkEndTime');
    const start = startInput?.value || '08:00';
    const end = endInput?.value || '16:00';

    this.securitySettings.work_start_time = start;
    this.securitySettings.work_end_time = end;
    this.securitySettings.work_hours_enabled = (this.securitySettings.jwt_token_expiry === 'custom');

    // حساب عدد الساعات
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff <= 0) diff += 24 * 60;
    const hours = (diff / 60).toFixed(1).replace('.0', '');

    this.securitySettings.jwt_custom_minutes = diff;

    const summaryEl = document.getElementById('customWorkHoursSummary');
    if (summaryEl) {
      summaryEl.textContent = `${hours} ساعات عمل`;
    }

    const badge = document.getElementById('badgeCurrentTokenExpiry');
    if (badge && this.securitySettings.jwt_token_expiry === 'custom') {
      badge.textContent = `${start}-${end}`;
    }

    const noteEl = document.getElementById('customWorkHoursNote');
    if (noteEl) {
      noteEl.innerHTML = `🔒 <strong>فترة الدوام:</strong> مسموح بالدخول والعمل فقط من <strong>${this.formatTimeArabic(start)}</strong> إلى <strong>${this.formatTimeArabic(end)}</strong>.`;
    }
  },

  formatTimeArabic(timeStr) {
    if (!timeStr) return '';
    const [hStr, mStr] = timeStr.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr || '00';
    const ampm = h >= 12 ? 'مساءً' : 'صباحاً';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${m} ${ampm}`;
  },

  // إظهار نافذة التلميحات والمساعدة
  showSecurityHelp() {
    alert(
      "🛡️ سياسة تسجيل الدخول والأجهزة (بإشراف المدير العام):\n\n" +
      "1. جلسة واحدة صارمة:\n" +
      "يُسمح باتصال جهاز واحد فقط لهذا الحساب. يفيد عند الرغبة في منع استخدام الحساب بالتزامن من متصفحين أو جهازين مختلفين.\n\n" +
      "2. الجلسات المتعددة:\n" +
      "تتيح للمستخدم فتح النظام من أكثر من جهاز (مثلاً: الكمبيوتر والهاتف) حتى سقف الأجهزة المحدد (2، 3، أو 5).\n\n" +
      "3. عند التجاوز:\n" +
      "• طرد الأقدم: عند تسجيل الدخول من جهاز جديد يتم إنهاء أقدم جلسة تلقائياً.\n" +
      "• منع الجديد: يتم رفض الدخول الجديد ومطالبة المستخدم بالخروج من أحد الأجهزة السابقة أولاً.\n\n" +
      "4. مدة صلاحية التوكن (JWT):\n" +
      "تحدد فترة بقاء تسجيل الدخول نشطاً لهذا المستخدم قبل الحاجة لإعادة كتابة كلمة المرور."
    );
  },

  // حفظ وتطبيق إعدادات الأمان للمستخدم أو العامة
  async saveSecuritySessionsSettings() {
    try {
      if (this.currentUser?.role !== 'admin' && this.currentUser?.username !== 'admin') {
        alert('عذراً! ضبط وتعديل خيارات الأمان متاح حصرياً للمدير العام.');
        return;
      }

      if (this.securitySettings.jwt_token_expiry === 'custom') {
        this.onCustomInputChange();
      }

      let url = '/api/auth/security-settings';
      let targetName = 'العامة للنظام';

      if (this._targetSecurityUserId) {
        url = `/api/users/${this._targetSecurityUserId}/security-settings`;
        const target = this._securityUsersList.find(u => u.id === this._targetSecurityUserId) || this._targetUserInfo;
        targetName = `للمستخدم (${target?.full_name || target?.username || '#' + this._targetSecurityUserId})`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token ? `Bearer ${this.token}` : ''
        },
        body: JSON.stringify(this.securitySettings)
      });

      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('الخادم أعاد استجابة غير متوقعة (' + res.status + '). يرجى إعادة تشغيل الخادم وتحديث الصفحة.');
      }
      if (data && data.success) {
        if (data.settings) {
          this.securitySettings = Object.assign(this.securitySettings, data.settings);
        }
        this.updateSessionModeBadge();

        if (typeof Settings !== 'undefined' && Settings.loadUsers) {
          await Settings.loadUsers();
        }

        if (typeof App !== 'undefined') {
          if (App.closeModal) App.closeModal('securitySessionsModal');
          if (App.showToast) {
            const modeName = this.securitySettings.session_mode === 'single' ? 'جلسة واحدة صارمة' : `جلسات متعددة (${this.securitySettings.session_device_limit} أجهزة)`;
            App.showToast(`تم حفظ وتطبيق خيارات الأمان بنجاح ${targetName}: [${modeName}] وصلاحية [${this.securitySettings.jwt_token_expiry}] 🛡️`, 'success');
          }
        }
      } else {
        alert(data?.message || 'حدث خطأ أثناء حفظ إعدادات الأمان');
      }
    } catch (e) {
      console.error('Save security settings error:', e);
      alert('خطأ في الاتصال بالخادم لحفظ الإعدادات: ' + e.message);
    }
  },

  // تأكيد وإغلاق البرنامج بالكامل من شاشة الدخول مع حفظ نسخة احتياطية
  async confirmShutdownApp() {
    const isConfirm = confirm('هل أنت متأكد من رغبتك في إغلاق نظام شركة رواسي عدن وإنهاء البرنامج؟\n\nسيتم حفظ نسخة احتياطية آمنة وتلقائية من قاعدة البيانات فوراً.');
    if (!isConfirm) return;

    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast('جاري حفظ النسخة الاحتياطية وإغلاق البرنامج... ⏳', 'warning');
    }

    try {
      const isOnline = (typeof App !== 'undefined' && App.dbStatus) ? App.dbStatus.isOnline : false;
      const data = JSON.stringify({
        username: (this.currentUser && this.currentUser.username) ? this.currentUser.username : 'admin',
        mode: isOnline ? 'online' : 'offline',
        notes: 'إغلاق البرنامج من زر شاشة تسجيل الدخول'
      });

      if (navigator.sendBeacon) {
        const blob = new Blob([data], { type: 'application/json' });
        navigator.sendBeacon('/api/settings/shutdown-app', blob);
      } else {
        await fetch('/api/settings/shutdown-app', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: data
        });
      }
    } catch (e) {
      console.warn('Shutdown error:', e);
    }

    setTimeout(() => {
      window.close();
      document.body.innerHTML = `
        <div style="display:flex;height:100vh;align-items:center;justify-content:center;background:#0f172a;color:#fff;font-family:'Segoe UI',Tahoma,sans-serif;direction:rtl;">
          <div style="text-align:center;padding:40px;background:#1e293b;border-radius:16px;border:1px solid #334155;max-width:480px;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
            <div style="font-size:48px;margin-bottom:16px;">🔒</div>
            <h2 style="color:#d4af37;margin-bottom:12px;">تم إغلاق نظام رواسي عدن بنجاح</h2>
            <p style="color:#cbd5e1;line-height:1.7;">تم حفظ أحدث نسخة احتياطية من قاعدة البيانات وإيقاف الخادم بأمان.<br>يمكنك إغلاق هذه النافذة الآن أو الضغط على Alt+F4.</p>
          </div>
        </div>
      `;
    }, 500);
  }
};

// =================== الحفاظ على الجلسة وسلامة البيانات ===================
// معالجة هادئة بدون حظر الإغلاق أو قطع الجلسة القسري في بيئات الـ iFrame
window.addEventListener('beforeunload', () => {
  // حفظ آخر نشاط محلياً بسلاسة
  if (Auth && Auth.currentUser && Auth.token) {
    try {
      localStorage.setItem('rawasi_last_active_time', Date.now().toString());
    } catch (e) {}
  }
});
