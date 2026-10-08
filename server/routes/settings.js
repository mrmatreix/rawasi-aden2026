const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const {
  query, run, get, backupDatabase, restoreDatabase, listBackups,
  createLogoutBackup, listLogoutBackups, connectionManager,
  getActiveEngine, getMysqlConfig, dbPath, initializeDatabase
} = require('../database/db');
const { runMigration } = require('../database/migrate_to_mysql');
const { requirePermission } = require('../middleware/security');

// جلب إعدادات الشركة
router.get('/', requirePermission('settings:view,settings:company'), async (req, res) => {
  try {
    const settingsRows = await query('SELECT * FROM settings');
    const settingsObj = {};
    settingsRows.forEach(row => {
      settingsObj[row.key] = row.value;
    });
    settingsObj.active_db_engine = getActiveEngine();
    res.json({ success: true, data: settingsObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الإعدادات', error: err.message });
  }
});

// تحديث الإعدادات
router.post('/', requirePermission('settings:company'), async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await run(`
        INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
      `, [key, String(value)]);
    }
    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ الإعدادات: ' + err.message, error: err.message });
  }
});

// جلب قائمة النسخ الاحتياطية المحفوظة محلياً
router.get('/backups', requirePermission('settings:backup'), (req, res) => {
  try {
    const backups = listBackups();
    res.json({ success: true, data: backups });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب قائمة النسخ الاحتياطية', error: err.message });
  }
});

const { logAudit } = require('../services/auditService');

// إنشاء وتنزيل نسخة احتياطية من قاعدة البيانات
router.get('/backup', requirePermission('settings:backup'), async (req, res) => {
  try {
    const backup = backupDatabase();
    await logAudit(req, {
      action: 'BACKUP_DOWNLOAD',
      entity_type: 'database',
      entity_id: backup.fileName,
      details: { fileName: backup.fileName, fileSize: backup.fileSize }
    });

    res.download(backup.filePath, backup.fileName, (err) => {
      if (err) {
        console.error('Error sending backup file:', err);
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء النسخة الاحتياطية', error: err.message });
  }
});

// استعادة نسخة احتياطية من ملف محلي على السيرفر
router.post('/restore-local', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ success: false, message: 'اسم ملف النسخة الاحتياطية مطلوب' });
    }
    const backupsDir = path.join(__dirname, '..', 'database', 'backups');
    const filePath = path.join(backupsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'ملف النسخة الاحتياطية غير موجود على الخادم' });
    }
    const result = restoreDatabase(filePath);

    await logAudit(req, {
      action: 'BACKUP_RESTORE_LOCAL',
      entity_type: 'database',
      entity_id: fileName,
      details: { fileName }
    });

    res.json({
      success: true,
      message: `تمت استعادة النسخة الاحتياطية (${fileName}) بنجاح`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
});

// استعادة نسخة احتياطية مرفوعة
router.post('/restore-upload', requirePermission('settings:backup'), express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  try {
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ success: false, message: 'لم يتم استلام أي بيانات لملف النسخة الاحتياطية' });
    }
    const result = restoreDatabase(req.body);

    await logAudit(req, {
      action: 'BACKUP_RESTORE_UPLOAD',
      entity_type: 'database',
      entity_id: 'uploaded_database_file',
      details: { bytesLength: req.body.length }
    });

    res.json({
      success: true,
      message: 'تمت استعادة قاعدة البيانات بنجاح من الملف المرفوع وتأكيد سلامة الجداول',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
});

// =================== مسارات فحص وضبط MySQL ===================

// جلب حالة إعدادات ومحرك MySQL
router.get('/mysql-status', requirePermission('settings:view,settings:company'), async (req, res) => {
  try {
    const activeEngine = getActiveEngine();
    const mysqlCfg = getMysqlConfig();
    let isConnected = false;
    let message = '';
    let serverVersion = null;

    try {
      const conn = await mysql.createConnection({
        host: mysqlCfg.host,
        port: mysqlCfg.port,
        user: mysqlCfg.user,
        password: mysqlCfg.password,
        connectTimeout: 2000
      });
      const [vRows] = await conn.query('SELECT VERSION() as ver;');
      serverVersion = vRows && vRows[0] ? vRows[0].ver : null;
      await conn.end();
      isConnected = true;
      message = 'خادم MySQL متصل وجاهز للعمل ✅';
    } catch (e) {
      isConnected = false;
      message = `خادم MySQL غير متاح حالياً (${e.message}). النظام يعمل بنمط الاحتياط الذكي.`;
    }

    res.json({
      success: true,
      data: {
        activeEngine,
        isConnected,
        serverVersion,
        message,
        mysqlConfig: {
          host: mysqlCfg.host,
          port: mysqlCfg.port,
          user: mysqlCfg.user,
          database: mysqlCfg.database
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// فحص اتصال مخصص بخادم MySQL
router.post('/test-mysql-conn', requirePermission('settings:company'), async (req, res) => {
  try {
    const { host = 'localhost', port = 3306, user = 'root', password = '', database = 'rawasi_aden' } = req.body;
    const startTime = Date.now();

    const conn = await mysql.createConnection({
      host,
      port: Number(port) || 3306,
      user,
      password,
      connectTimeout: 3000
    });

    const [vRows] = await conn.query('SELECT VERSION() as ver, CURRENT_USER() as cur_user;');
    const latencyMs = Date.now() - startTime;
    await conn.end();

    res.json({
      success: true,
      message: `تم الاتصال بنجاح بخادم MySQL (${host}:${port}) في ${latencyMs}ms 🚀`,
      version: vRows[0]?.ver,
      user: vRows[0]?.cur_user,
      latencyMs
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: `تعذر الاتصال بخادم MySQL: ${err.message}`
    });
  }
});

// حفظ إعدادات MySQL في config.json وإعادة الاتصال
router.post('/save-mysql-config', requirePermission('settings:company'), async (req, res) => {
  try {
    const { host, port, user, password, database } = req.body;
    const configPath = path.join(__dirname, '..', 'database', 'config.json');
    let cfg = {};
    if (fs.existsSync(configPath)) {
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); } catch {}
    }

    cfg.dbEngine = 'mysql';
    cfg.mysql = Object.assign(cfg.mysql || {}, {
      host: host || 'localhost',
      port: Number(port) || 3306,
      user: user || 'root',
      password: password !== undefined ? password : '',
      database: database || 'rawasi_aden'
    });

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');

    // إعادة تهيئة المحرك
    await initializeDatabase();

    res.json({
      success: true,
      message: 'تم حفظ إعدادات MySQL بنجاح وتحديث المحرك النشط للنظام.',
      activeEngine: getActiveEngine()
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ إعدادات MySQL: ' + err.message });
  }
});

// ترحيل البيانات الحالية من SQLite إلى MySQL
router.post('/run-migration', requirePermission('settings:company'), async (req, res) => {
  try {
    await runMigration();
    res.json({
      success: true,
      message: 'تم ترحيل كافة الجداول والبيانات إلى MySQL بنجاح وبأعلى دقة.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء الترحيل: ' + err.message });
  }
});

// إنشاء نسخة احتياطية فورية عند تسجيل الخروج
router.post('/auto-backup-logout', async (req, res) => {
  try {
    const { username, mode, notes } = req.body || {};
    const backupItem = createLogoutBackup(username || 'user', { mode, notes });

    if (backupItem && backupItem.fileName) {
      await logAudit(req, {
        action: 'AUTO_BACKUP_LOGOUT',
        entity_type: 'database',
        entity_id: backupItem.fileName,
        details: { username: username || 'user', mode: mode || 'manual' }
      });
    }

    res.json({
      success: true,
      message: 'تم حفظ نسخة احتياطية بنجاح عند تسجيل الخروج',
      data: backupItem
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر إنشاء نسخة الخروج: ' + err.message });
  }
});

// جلب سجل نسخ الخروج الاحتياطية
router.get('/logout-backups', requirePermission('settings:backup'), (req, res) => {
  try {
    const list = listLogoutBackups();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =================== الجدولة التلقائية للنسخ الاحتياطي (Scheduled Auto-Backup) ===================
const backupSchedulerService = require('../services/backupSchedulerService');

// جلب حالة الجدولة التلقائية الحالية (مفتوح لكافة المستخدمين المصرحين لتحديث الهيدر)
router.get('/auto-backup/status', async (req, res) => {
  try {
    const status = backupSchedulerService.getStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب حالة الجدولة التلقائية: ' + err.message });
  }
});

// حفظ وتحديث إعدادات الجدولة التلقائية والمسار
router.post('/auto-backup/config', requirePermission('settings:backup'), async (req, res) => {
  try {
    const result = await backupSchedulerService.saveConfig(req.body, req.user?.username || 'admin', req);
    res.json({
      success: true,
      message: 'تم حفظ وتطبيق إعدادات الجدولة التلقائية ومسار التخزين بنجاح 🛡️',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ إعدادات الجدولة: ' + err.message });
  }
});

// تشغيل نسخة احتياطية مجدولة فوراً الآن
router.post('/auto-backup/run-now', requirePermission('settings:backup'), async (req, res) => {
  try {
    const result = await backupSchedulerService.executeBackup('manual_instant', req.user?.username || 'admin', req);
    res.json({
      success: true,
      message: `تم إنشاء النسخة التلقائية المجدولة بنجاح وحفظها بالمسار المحدد (${result.fileName}) 🚀`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل تنفيذ النسخ التلقائي الآن: ' + err.message });
  }
});

// اختبار وفحص مسار التخزين المخصص
router.post('/auto-backup/test-path', requirePermission('settings:backup'), (req, res) => {
  try {
    const { path: testPath } = req.body || {};
    const result = backupSchedulerService.testStoragePath(testPath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء اختبار المسار: ' + err.message });
  }
});

// =================== محرك النسخ الاحتياطي السحابي المشفر والأرشفة الشاملة ===================
const cloudBackupCryptoService = require('../services/cloudBackupCryptoService');

// جلب حالة الخزنة السحابية وإعدادات التشفير
router.get('/cloud-backup/status', requirePermission('settings:backup'), async (req, res) => {
  try {
    const config = await cloudBackupCryptoService.getCloudConfig();
    const vaultItems = cloudBackupCryptoService.listVaultItems();
    const stats = await cloudBackupCryptoService.getSystemSummaryStats();

    res.json({
      success: true,
      config,
      vaultItems,
      systemStats: stats
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر جلب حالة الخزنة السحابية: ' + err.message });
  }
});

// حفظ إعدادات المزامنة السحابية
router.post('/cloud-backup/config', requirePermission('settings:backup'), async (req, res) => {
  try {
    const updated = await cloudBackupCryptoService.saveCloudConfig(req.body, req.user?.username || 'admin', req);
    res.json({
      success: true,
      message: 'تم حفظ إعدادات المزامنة السحابية بنجاح ☁️💾',
      config: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر حفظ إعدادات المزامنة السحابية: ' + err.message });
  }
});

// اختبار الاتصال بالسيرفر أو المجلد السحابي
router.post('/cloud-backup/test-connection', requirePermission('settings:backup'), async (req, res) => {
  try {
    const result = await cloudBackupCryptoService.testCloudConnection(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل اختبار الاتصال السحابي: ' + err.message });
  }
});

// توليد مفتاح أمان تشفير فائق القوة
router.get('/cloud-backup/generate-key', requirePermission('settings:backup'), (req, res) => {
  try {
    const key = cloudBackupCryptoService.generateSecureKey(24);
    res.json({ success: true, key });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// إنشاء أرشيف شامل للنظام (مشفر أو عادي)
router.post('/cloud-backup/create-archive', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { encrypt, passphrase, includeProjectsFiles } = req.body || {};
    const result = await cloudBackupCryptoService.createFullSystemArchive({
      encrypt: Boolean(encrypt),
      passphrase: passphrase || '',
      includeProjectsFiles: includeProjectsFiles !== undefined ? Boolean(includeProjectsFiles) : true,
      user: req.user?.username || 'admin',
      req
    });

    res.json({
      success: true,
      message: result.encrypted 
        ? `تم إنشاء الأرشيف الشامل وتشفيره عسكرياً بنجاح (AES-256-GCM) 🔒 (${result.fileName})`
        : `تم إنشاء الأرشيف الشامل للنظام بنجاح 📦 (${result.fileName})`,
      data: {
        fileName: result.fileName,
        fileSize: result.fileSize,
        rawZipSize: result.rawZipSize,
        encrypted: result.encrypted,
        sha256: result.sha256,
        timestamp: result.timestamp
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل إنشاء الأرشيف: ' + err.message });
  }
});

// تنزيل ملف أرشيف أو نسخة من الخزنة
router.get('/cloud-backup/download/:fileName', requirePermission('settings:backup'), (req, res) => {
  try {
    const { fileName } = req.params;
    // التحقق من أمان اسم الملف ومنع Path Traversal
    const safeName = path.basename(fileName);
    const filePath = path.join(cloudBackupCryptoService.vaultDir, safeName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'الملف المطلوب غير موجود في الخزنة' });
    }

    res.download(filePath, safeName, (err) => {
      if (err) {
        console.error('Error downloading vault archive:', err);
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تنزيل الملف: ' + err.message });
  }
});

// فحص ومعاينة الأرشيف قبل الاستعادة (Inspection)
router.post('/cloud-backup/inspect', requirePermission('settings:backup'), express.raw({ type: '*/*', limit: '150mb' }), (req, res) => {
  try {
    const passphrase = req.headers['x-passphrase'] ? decodeURIComponent(req.headers['x-passphrase']) : null;
    const fileName = req.headers['x-vault-filename'] || null;

    let targetBufferOrPath;
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      targetBufferOrPath = req.body;
    } else if (fileName) {
      const safeName = path.basename(fileName);
      targetBufferOrPath = path.join(cloudBackupCryptoService.vaultDir, safeName);
    } else {
      return res.status(400).json({ success: false, message: 'يرجى إرسال ملف الأرشيف أو اختيار نسخة من الخزنة' });
    }

    const inspection = cloudBackupCryptoService.inspectArchive(targetBufferOrPath, passphrase);
    res.json({ success: true, data: inspection });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// استعادة النظام من أرشيف الخزنة أو من ملف مرفوع
router.post('/cloud-backup/restore', requirePermission('settings:backup'), express.raw({ type: '*/*', limit: '150mb' }), async (req, res) => {
  try {
    const passphrase = req.headers['x-passphrase'] ? decodeURIComponent(req.headers['x-passphrase']) : null;
    const restoreFiles = req.headers['x-restore-files'] !== 'false';
    const vaultFileName = req.headers['x-vault-filename'] || null;

    let targetBufferOrPath;
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      targetBufferOrPath = req.body;
    } else if (vaultFileName) {
      const safeName = path.basename(vaultFileName);
      targetBufferOrPath = path.join(cloudBackupCryptoService.vaultDir, safeName);
    } else {
      return res.status(400).json({ success: false, message: 'يرجى تقديم ملف الأرشيف أو تحديد ملف من الخزنة' });
    }

    const result = await cloudBackupCryptoService.restoreFullSystemArchive(targetBufferOrPath, {
      passphrase,
      restoreFiles,
      user: req.user?.username || 'admin',
      req
    });

    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشلت عملية استعادة الأرشيف: ' + err.message });
  }
});

// مزامنة فورية إلى السحابة
router.post('/cloud-backup/sync-now', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { fileName } = req.body || {};
    let result;
    if (fileName) {
      result = await cloudBackupCryptoService.syncArchiveToCloud(path.basename(fileName));
    } else {
      result = await cloudBackupCryptoService.syncLatestBackupToCloud();
    }
    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر إتمام المزامنة السحابية: ' + err.message });
  }
});

module.exports = router;
