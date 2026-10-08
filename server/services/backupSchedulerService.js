/**
 * backupSchedulerService.js
 * 
 * محرك جدولة النسخ الاحتياطي التلقائي لقاعدة البيانات - نظام رواسي عدن
 * يدعم الفترات اليومية والأسبوعية، المسارات المخصصة، الفحص والتدوير التلقائي، والإشعارات الحية.
 */

const fs = require('fs');
const path = require('path');
const { query, run, get, exec, dbPath, getActiveEngine } = require('../database/db');
const { logAudit } = require('./auditService');

class BackupSchedulerService {
  constructor() {
    this.timer = null;
    this.isExecuting = false;
    this.nextRunTime = null;
    this.defaultStoragePath = path.resolve(__dirname, '..', 'database', 'backups');
    this.config = {
      enabled: true,
      interval: 'daily', // 'daily' | 'weekly'
      time: '02:00', // HH:mm
      dayOfWeek: 5, // 5 = الجمعة (0 = الأحد, 6 = السبت)
      storagePath: this.defaultStoragePath,
      maxFiles: 14,
      lastRun: null,
      lastStatus: null,
      lastFile: null,
      lastSize: 0,
      lastError: null
    };
  }

  /**
   * تهيئة وبدء تشغيل خدمة الجدولة عند إقلاع الخادم
   */
  async init() {
    try {
      await this.loadConfig();
      this.ensureStoragePath(this.config.storagePath);
      this.calculateNextRunTime();

      // تشغيل فاحص دوري كل دقيقة (60 ثانية)
      if (this.timer) {
        clearInterval(this.timer);
      }
      this.timer = setInterval(() => this.checkSchedule(), 60 * 1000);
      if (this.timer && this.timer.unref) {
        this.timer.unref();
      }

      console.log(`🛡️ [BackupScheduler] تم تفعيل الجدولة التلقائية: ${this.config.enabled ? 'مفعل' : 'معطل'} (${this.config.interval})`);
      console.log(`📁 [BackupScheduler] مسار التخزين: ${this.config.storagePath}`);
      if (this.nextRunTime) {
        console.log(`⏰ [BackupScheduler] موعد النسخة القادمة: ${this.nextRunTime.toLocaleString('ar-YE')}`);
      }
    } catch (err) {
      console.error('⚠️ [BackupScheduler] خطأ أثناء تهيئة خدمة الجدولة:', err.message);
    }
  }

  /**
   * إيقاف مؤقت الجدولة
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * تحميل الإعدادات المحفوظة من جدول settings
   */
  async loadConfig() {
    try {
      const rows = await query(`
        SELECT \`key\`, \`value\` FROM settings 
        WHERE \`key\` LIKE 'auto_backup_%'
      `);

      const map = {};
      (rows || []).forEach(r => { map[r.key] = r.value; });

      this.config.enabled = map.auto_backup_enabled !== undefined ? (map.auto_backup_enabled === 'true' || map.auto_backup_enabled === '1') : true;
      this.config.interval = (map.auto_backup_interval === 'weekly') ? 'weekly' : 'daily';
      this.config.time = map.auto_backup_time || '02:00';
      this.config.dayOfWeek = map.auto_backup_day_of_week !== undefined ? Number(map.auto_backup_day_of_week) : 5;
      this.config.storagePath = map.auto_backup_path ? path.resolve(map.auto_backup_path) : this.defaultStoragePath;
      this.config.maxFiles = Math.max(1, Number(map.auto_backup_max_files) || 14);
      this.config.lastRun = map.auto_backup_last_run || null;
      this.config.lastStatus = map.auto_backup_last_status || null;
      this.config.lastFile = map.auto_backup_last_file || null;
      this.config.lastSize = Number(map.auto_backup_last_size) || 0;
      this.config.lastError = map.auto_backup_last_error || null;
    } catch (e) {
      console.warn('⚠️ [BackupScheduler] تعذر قراءة الإعدادات من القاعدة، استخدام القيم الافتراضية:', e.message);
    }
  }

  /**
   * حفظ الإعدادات في جدول settings وتحديث المؤقت
   */
  async saveConfig(newConfig = {}, user = 'system', req = null) {
    if (newConfig.enabled !== undefined) this.config.enabled = Boolean(newConfig.enabled);
    if (newConfig.interval) this.config.interval = newConfig.interval === 'weekly' ? 'weekly' : 'daily';
    if (newConfig.time && /^\d{1,2}:\d{2}$/.test(newConfig.time)) {
      const [h, m] = newConfig.time.split(':');
      this.config.time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    if (newConfig.dayOfWeek !== undefined) {
      const d = Number(newConfig.dayOfWeek);
      if (d >= 0 && d <= 6) this.config.dayOfWeek = d;
    }
    if (newConfig.storagePath) {
      this.config.storagePath = path.resolve(newConfig.storagePath.trim());
    } else {
      this.config.storagePath = this.defaultStoragePath;
    }
    if (newConfig.maxFiles) {
      this.config.maxFiles = Math.max(1, Math.min(100, Number(newConfig.maxFiles) || 14));
    }

    // التحقق من إنشاء المسار
    this.ensureStoragePath(this.config.storagePath);

    // كتابة الإعدادات لقاعدة البيانات
    const entries = [
      ['auto_backup_enabled', String(this.config.enabled)],
      ['auto_backup_interval', this.config.interval],
      ['auto_backup_time', this.config.time],
      ['auto_backup_day_of_week', String(this.config.dayOfWeek)],
      ['auto_backup_path', this.config.storagePath],
      ['auto_backup_max_files', String(this.config.maxFiles)]
    ];

    for (const [k, v] of entries) {
      await run(`
        INSERT OR REPLACE INTO settings (\`key\`, \`value\`) VALUES (?, ?)
      `, [k, v]);
    }

    this.calculateNextRunTime();

    if (req) {
      await logAudit(req, {
        action: 'UPDATE_BACKUP_SCHEDULE',
        entity_type: 'settings',
        entity_id: 'auto_backup',
        details: {
          enabled: this.config.enabled,
          interval: this.config.interval,
          time: this.config.time,
          storagePath: this.config.storagePath,
          maxFiles: this.config.maxFiles
        }
      });
    }

    return this.getStatus();
  }

  /**
   * التأكد من وجود مجلد التخزين وإنشائه إذا لزم الأمر
   */
  ensureStoragePath(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return true;
    } catch (err) {
      console.error(`⚠️ [BackupScheduler] تعذر إنشاء مجلد النسخ (${dirPath}):`, err.message);
      return false;
    }
  }

  /**
   * حساب موعد النسخة القادمة بناءً على الإعدادات
   */
  calculateNextRunTime() {
    if (!this.config.enabled) {
      this.nextRunTime = null;
      return null;
    }

    const now = new Date();
    const [targetHour, targetMinute] = (this.config.time || '02:00').split(':').map(Number);

    if (this.config.interval === 'daily') {
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMinute, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      this.nextRunTime = next;
    } else if (this.config.interval === 'weekly') {
      const targetDay = Number(this.config.dayOfWeek) || 5; // 5 = الجمعة
      const currentDay = now.getDay();
      let daysDiff = (targetDay - currentDay + 7) % 7;

      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysDiff, targetHour, targetMinute, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 7);
      }
      this.nextRunTime = next;
    }

    return this.nextRunTime;
  }

  /**
   * فحص الجدولة الدورية والتنفيذ عند حلول الموعد
   */
  async checkSchedule() {
    if (!this.config.enabled || this.isExecuting) return;

    const now = new Date();
    if (!this.nextRunTime) {
      this.calculateNextRunTime();
      return;
    }

    // إذا تجاوز الوقت الحالي موعد النسخة القادمة
    if (now >= this.nextRunTime) {
      console.log(`⏰ [BackupScheduler] حلول موعد النسخة المجدولة (${this.config.interval}) في ${now.toLocaleTimeString('ar-YE')}`);
      try {
        await this.executeBackup('scheduled', 'scheduler');
      } catch (err) {
        console.error('⚠️ [BackupScheduler] خطأ أثناء تشغيل النسخة المجدولة:', err.message);
      } finally {
        this.calculateNextRunTime();
      }
    }
  }

  /**
   * تنفيذ النسخ الاحتياطي التلقائي فعلياً وحفظه بالمسار المعتمد
   */
  async executeBackup(triggerSource = 'scheduled', username = 'system', req = null) {
    if (this.isExecuting) {
      throw new Error('عملية نسخ احتياطي أخرى قيد التنفيذ حالياً، يرجى الانتظار');
    }

    this.isExecuting = true;
    const startTime = Date.now();
    const targetDir = this.config.storagePath || this.defaultStoragePath;

    try {
      this.ensureStoragePath(targetDir);

      // نقاط تفتيش SQLite لضمان دمج ملفات WAL بالكامل
      try {
        await exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch (e) {}

      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const fileName = `backup_auto_${this.config.interval}_${dateStr}.db`;
      const targetFilePath = path.join(targetDir, fileName);

      // فحص وجود قاعدة البيانات ومصدر النسخ
      const sourceDbPath = dbPath || path.resolve(__dirname, '..', 'database', 'rawasi_aden.db');
      if (!fs.existsSync(sourceDbPath)) {
        throw new Error(`ملف قاعدة البيانات المصدر غير موجود: ${sourceDbPath}`);
      }

      // نسخ الملف بأمان
      fs.copyFileSync(sourceDbPath, targetFilePath);

      const stat = fs.statSync(targetFilePath);
      const fileSize = stat.size;

      // تدوير وحذف النسخ القديمة الزائدة عن الحد المسموح
      this.pruneOldBackups(targetDir, this.config.maxFiles);

      // تحديث الإحصائيات في الخدمة والقاعدة
      const nowIso = now.toISOString();
      this.config.lastRun = nowIso;
      this.config.lastStatus = 'success';
      this.config.lastFile = fileName;
      this.config.lastSize = fileSize;
      this.config.lastError = null;

      const updates = [
        ['auto_backup_last_run', nowIso],
        ['auto_backup_last_status', 'success'],
        ['auto_backup_last_file', fileName],
        ['auto_backup_last_size', String(fileSize)],
        ['auto_backup_last_error', ''],
        ['auto_backup_last_path', targetFilePath]
      ];

      for (const [k, v] of updates) {
        try {
          await run(`
            INSERT OR REPLACE INTO settings (\`key\`, \`value\`) VALUES (?, ?)
          `, [k, v]);
        } catch (e) {}
      }

      // توثيق في سجل التدقيق المالي والإداري
      await logAudit(req, {
        action: 'AUTO_SCHEDULED_BACKUP',
        entity_type: 'database',
        entity_id: fileName,
        details: {
          trigger: triggerSource,
          user: username || 'system',
          interval: this.config.interval,
          path: targetFilePath,
          size: fileSize,
          durationMs: Date.now() - startTime
        }
      });

      console.log(`✅ [BackupScheduler] تم إنشاء النسخة المجدولة بنجاح: ${fileName} (${(fileSize / (1024 * 1024)).toFixed(2)} MB) في ${targetDir}`);

      // محاولة المزامنة السحابية التلقائية إن كانت مفعلة
      try {
        const cloudService = require('./cloudBackupCryptoService');
        cloudService.getCloudConfig().then(cCfg => {
          if (cCfg.enabled && cCfg.autoSyncAfterBackup) {
            cloudService.syncArchiveToCloud(fileName, cCfg).catch(cErr => {
              console.warn('⚠️ [BackupScheduler] تحذير أثناء المزامنة السحابية التلقائية:', cErr.message);
            });
          }
        }).catch(() => {});
      } catch (e) {}

      return {
        success: true,
        fileName,
        filePath: targetFilePath,
        fileSize,
        interval: this.config.interval,
        timestamp: nowIso,
        nextRun: this.calculateNextRunTime()
      };
    } catch (err) {
      this.config.lastStatus = 'failed';
      this.config.lastError = err.message;

      try {
        await run(`
          INSERT OR REPLACE INTO settings (\`key\`, \`value\`) VALUES (?, ?)
        `, ['auto_backup_last_status', 'failed']);
        await run(`
          INSERT OR REPLACE INTO settings (\`key\`, \`value\`) VALUES (?, ?)
        `, ['auto_backup_last_error', err.message]);
      } catch (e) {}

      console.error('❌ [BackupScheduler] فشل تنفيذ النسخة التلقائية:', err.message);
      throw err;
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * تدوير وحذف النسخ التلقائية القديمة والاحتفاظ بالعدد المحدد فقط
   */
  pruneOldBackups(dirPath, maxCount = 14) {
    try {
      if (!fs.existsSync(dirPath)) return;
      const files = fs.readdirSync(dirPath);
      const autoBackups = [];

      files.forEach(file => {
        if (file.startsWith('backup_auto_') && (file.endsWith('.db') || file.endsWith('.sqlite'))) {
          const fullPath = path.join(dirPath, file);
          try {
            const stat = fs.statSync(fullPath);
            autoBackups.push({ file, path: fullPath, mtime: stat.mtime });
          } catch (e) {}
        }
      });

      // ترتيب من الأحدث إلى الأقدم
      autoBackups.sort((a, b) => (b.mtime - a.mtime) || b.file.localeCompare(a.file));

      if (autoBackups.length > maxCount) {
        const toDelete = autoBackups.slice(maxCount);
        toDelete.forEach(item => {
          try {
            fs.unlinkSync(item.path);
            console.log(`🧹 [BackupScheduler] حذف نسخة قديمة لتوفير المساحة: ${item.file}`);
          } catch (e) {}
        });
      }
    } catch (err) {
      console.warn('⚠️ [BackupScheduler] خطأ أثناء تدوير النسخ القديمة:', err.message);
    }
  }

  /**
   * جلب تقرير الحالة الشامل للواجهة الأمامية وهيدر التطبيق
   */
  getStatus() {
    const storagePathExists = fs.existsSync(this.config.storagePath);
    let storagePathWritable = false;
    if (storagePathExists) {
      try {
        const testFile = path.join(this.config.storagePath, `.perm_test_${Date.now()}`);
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
        storagePathWritable = true;
      } catch (e) {
        storagePathWritable = false;
      }
    }

    // جلب قائمة بأحدث النسخ الموجودة في المسار
    const recentFiles = [];
    try {
      if (storagePathExists) {
        const files = fs.readdirSync(this.config.storagePath);
        files.forEach(f => {
          if (f.startsWith('backup_auto_') && f.endsWith('.db')) {
            const fp = path.join(this.config.storagePath, f);
            try {
              const st = fs.statSync(fp);
              recentFiles.push({
                fileName: f,
                size: st.size,
                createdAt: st.mtime
              });
            } catch (e) {}
          }
        });
      }
    } catch (e) {}

    recentFiles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // حساب الوقت المتبقي
    let countdownText = 'غير مجدول';
    if (this.nextRunTime) {
      const diffMs = this.nextRunTime.getTime() - Date.now();
      if (diffMs > 0) {
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 24) {
          const days = Math.floor(hours / 24);
          countdownText = `بعد ${days} يوم و${hours % 24} ساعة`;
        } else if (hours > 0) {
          countdownText = `بعد ${hours} ساعة و${minutes} دقيقة`;
        } else {
          countdownText = `بعد ${minutes} دقيقة`;
        }
      } else {
        countdownText = 'حان الموعد';
      }
    }

    return {
      enabled: this.config.enabled,
      interval: this.config.interval,
      intervalLabel: this.config.interval === 'weekly' ? 'أسبوعي' : 'يومي',
      time: this.config.time,
      dayOfWeek: this.config.dayOfWeek,
      dayOfWeekName: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][this.config.dayOfWeek] || 'الجمعة',
      storagePath: this.config.storagePath,
      storagePathExists,
      storagePathWritable,
      defaultStoragePath: this.defaultStoragePath,
      maxFiles: this.config.maxFiles,
      lastRun: this.config.lastRun,
      lastStatus: this.config.lastStatus,
      lastFile: this.config.lastFile,
      lastSize: this.config.lastSize,
      lastError: this.config.lastError,
      nextRun: this.nextRunTime ? this.nextRunTime.toISOString() : null,
      countdownText,
      recentBackups: recentFiles.slice(0, 10),
      isExecuting: this.isExecuting
    };
  }

  /**
   * اختبار مسار تخزين محدد للتحقق من الصلاحيات
   */
  testStoragePath(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') {
      return { success: false, message: 'المسار غير صالح' };
    }
    const resolved = path.resolve(dirPath.trim());
    try {
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      const testFile = path.join(resolved, `.test_write_${Date.now()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return {
        success: true,
        resolvedPath: resolved,
        message: 'المسار صالح وقابل للكتابة بنجاح ✅'
      };
    } catch (err) {
      return {
        success: false,
        resolvedPath: resolved,
        message: 'تعذر الكتابة في المسار المحدد: ' + err.message
      };
    }
  }
}

const schedulerInstance = new BackupSchedulerService();
module.exports = schedulerInstance;
