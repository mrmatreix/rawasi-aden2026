/**
 * وحدة إدارة الاتصال بقواعد البيانات (Online / Offline Connection Manager)
 * نظام رواسي عدن للهندسة والمقاولات
 * 
 * تدير هذه الوحدة التحقق المسبق من الاتصال السحابي،
 * وتحديد نمط العمل (أونلاين 🟢 / أوفلاين 🟠)،
 * والتحويل التلقائي السلس عند انقطاع الإنترنت أو تعذر الوصول للسيرفر السحابي.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

class ConnectionManager {
  constructor() {
    this.mode = 'auto'; // 'auto' | 'online_only' | 'offline_only'
    this.onlineUrl = process.env.ONLINE_DB_URL || '';
    this.apiKey = process.env.ONLINE_DB_KEY || '';
    this.isOnline = false;
    this.activeDb = 'local'; // 'local' | 'remote'
    this.lastChecked = null;
    this.latencyMs = null;
    this.statusMessage = 'قاعدة البيانات المحلية (أوفلاين)';
  }

  /**
   * تحميل الإعدادات المحفوظة من قاعدة البيانات
   */
  initFromDb(db) {
    try {
      const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('db_mode', 'online_db_url', 'online_db_key')").all();
      rows.forEach(r => {
        if (r.key === 'db_mode' && r.value) this.mode = r.value;
        if (r.key === 'online_db_url' && r.value) this.onlineUrl = r.value;
        if (r.key === 'online_db_key' && r.value) this.apiKey = r.value;
      });
    } catch (e) {
      console.warn('ConnectionManager: تعذر قراءة إعدادات الاتصال من جدول settings:', e.message);
    }
  }

  /**
   * الفحص والتحقق المسبق من الاتصال بالسيرفر السحابي
   * @param {string} targetUrl رابط اختياري للاختبار
   * @param {number} timeoutMs المهلة القصوى بالميلي ثانية
   */
  async verifyOnlineConnection(targetUrl = null, timeoutMs = 3500) {
    const checkUrl = targetUrl || this.onlineUrl;
    const startTime = Date.now();

    // إذا تم تحديد وضع "أوفلاين محلي فقط" أو لم يتم تحديد رابط سحابي
    if (this.mode === 'offline_only' && !targetUrl) {
      this.isOnline = false;
      this.activeDb = 'local';
      this.latencyMs = 0;
      this.lastChecked = new Date().toISOString();
      this.statusMessage = 'الوضع المحلي اليدوي (أوفلاين - تم إيقاف الربط السحابي)';
      return {
        success: false,
        isOnline: false,
        activeDb: 'local',
        latencyMs: 0,
        message: this.statusMessage
      };
    }

    if (!checkUrl) {
      this.isOnline = false;
      this.activeDb = 'local';
      this.latencyMs = 0;
      this.lastChecked = new Date().toISOString();
      this.statusMessage = 'قاعدة البيانات المحلية نشطة (لم يتم إعداد رابط سحابي بعد)';
      return {
        success: false,
        isOnline: false,
        activeDb: 'local',
        latencyMs: 0,
        message: this.statusMessage
      };
    }

    try {
      const parsedUrl = new URL(checkUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      // محاولة الوصول لنقطة فحص الصحة أو الرابط الأساسي
      const options = {
        method: 'GET',
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname === '/' ? '/api/health' : parsedUrl.pathname,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'RawasiAden-CloudVerifier/1.0',
          'Accept': 'application/json'
        }
      };

      if (this.apiKey) {
        options.headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const result = await new Promise((resolve) => {
        const req = client.request(options, (res) => {
          const latency = Date.now() - startTime;
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            const isOk = res.statusCode >= 200 && res.statusCode < 400;
            resolve({
              ok: isOk,
              statusCode: res.statusCode,
              latency,
              body: body.substring(0, 300)
            });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, error: 'انتهت مهلة الاتصال (Timeout)' });
        });

        req.on('error', (err) => {
          resolve({ ok: false, error: err.message });
        });

        req.end();
      });

      this.lastChecked = new Date().toISOString();
      this.latencyMs = result.latency || (Date.now() - startTime);

      if (result.ok) {
        this.isOnline = true;
        this.activeDb = 'remote';
        this.statusMessage = `متصل بالسيرفر السحابي بنجاح (${this.latencyMs}ms)`;
        return {
          success: true,
          isOnline: true,
          activeDb: 'remote',
          latencyMs: this.latencyMs,
          message: this.statusMessage
        };
      } else {
        // فشل التحقق -> الرجوع التلقائي للوضع المحلي
        this.isOnline = false;
        this.activeDb = 'local';
        this.statusMessage = `تعذر الاتصال السحابي (${result.error || 'رمز الحالة: ' + result.statusCode}) - تم التحويل تلقائياً لقاعدة البيانات المحلية`;
        return {
          success: false,
          isOnline: false,
          activeDb: 'local',
          latencyMs: this.latencyMs,
          message: this.statusMessage
        };
      }
    } catch (err) {
      this.lastChecked = new Date().toISOString();
      this.isOnline = false;
      this.activeDb = 'local';
      this.statusMessage = `خطأ في تنسيق الرابط أو الشبكة: ${err.message} - استخدام قاعدة البيانات المحلية`;
      return {
        success: false,
        isOnline: false,
        activeDb: 'local',
        latencyMs: 0,
        message: this.statusMessage
      };
    }
  }

  /**
   * جلب تقرير كامل عن حالة الاتصال
   */
  getStatus() {
    return {
      mode: this.mode,
      isOnline: this.isOnline,
      activeDb: this.activeDb,
      onlineUrl: this.onlineUrl ? this.maskUrl(this.onlineUrl) : null,
      rawOnlineUrl: this.onlineUrl || '',
      lastChecked: this.lastChecked,
      latencyMs: this.latencyMs,
      statusMessage: this.statusMessage,
      localDbFile: 'rawasi_aden.db'
    };
  }

  /**
   * حجب البيانات الحساسة من الرابط عند العرض
   */
  maskUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      return urlStr;
    }
  }

  /**
   * تحديث إعدادات الربط وحفظها في قاعدة البيانات
   */
  updateConfig(db, { mode, onlineUrl, apiKey }) {
    if (mode) this.mode = mode;
    if (onlineUrl !== undefined) this.onlineUrl = onlineUrl.trim();
    if (apiKey !== undefined) this.apiKey = apiKey.trim();

    try {
      const stmt = db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      stmt.run('db_mode', this.mode);
      stmt.run('online_db_url', this.onlineUrl);
      stmt.run('online_db_key', this.apiKey);
    } catch (e) {
      console.warn('ConnectionManager: تعذر حفظ الإعدادات في قاعدة البيانات:', e.message);
    }
  }
}

// تصدير كائن أحادي (Singleton)
const connectionManager = new ConnectionManager();

module.exports = connectionManager;
