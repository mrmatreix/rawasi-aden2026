/**
 * وحدة إدارة قاعدة البيانات لنظام رواسي عدن للهندسة والمقاولات
 * تدعم محرك MySQL الأساسي عالي الأداء مع برك الاتصال (Connection Pooling)
 * وتدعم الـ Transactions الذرية والتبديل التلقائي الذكي إلى SQLite عند الحاجة
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');
const connectionManager = require('./connectionManager');

const configPath = path.join(__dirname, 'config.json');

function loadConfig() {
  const defaults = {
    dbEngine: process.env.DB_ENGINE || (process.env.MYSQL_HOST ? 'mysql' : 'sqlite'), // 'mysql' | 'sqlite'
    mysql: {
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'rawasi_aden',
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0
    },
    dbPath: 'server/database/rawasi_aden.db'
  };

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      return Object.assign(defaults, parsed, {
        mysql: Object.assign(defaults.mysql, parsed.mysql || {})
      });
    } catch (e) {
      console.warn('Config load note:', e.message);
    }
  }

  return defaults;
}

let appConfig = loadConfig();

function resolveSqlitePath() {
  if (process.env.RAWASI_DB_PATH && process.env.RAWASI_DB_PATH.trim()) {
    return path.isAbsolute(process.env.RAWASI_DB_PATH)
      ? process.env.RAWASI_DB_PATH
      : path.join(__dirname, '..', '..', process.env.RAWASI_DB_PATH);
  }
  if (appConfig.dbPath && appConfig.dbPath.trim()) {
    return path.isAbsolute(appConfig.dbPath)
      ? appConfig.dbPath
      : path.join(__dirname, '..', '..', appConfig.dbPath);
  }
  return path.join(__dirname, 'rawasi_aden.db');
}

let sqlitePath = resolveSqlitePath();
let activeEngine = 'sqlite'; // سيتم تحديده عند التهيئة: 'mysql' أو 'sqlite'
let mysqlPool = null;
let sqliteDb = null;

// التأكد من وجود مجلد SQLite
const sqliteParent = path.dirname(sqlitePath);
if (!fs.existsSync(sqliteParent)) {
  fs.mkdirSync(sqliteParent, { recursive: true });
}

// تهيئة محرك SQLite الاحتياطي دائماً للجاهزية
function initSqliteInstance() {
  if (!sqliteDb) {
    sqliteDb = new DatabaseSync(sqlitePath);
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
  }
  return sqliteDb;
}

/**
 * معالج ذكي لمواءمة استعلامات SQL بين MySQL و SQLite
 */
function normalizeSql(sql, targetEngine) {
  if (!sql || typeof sql !== 'string') return sql;
  let normalized = sql;

  if (targetEngine === 'mysql') {
    // 1. استبدال INSERT OR IGNORE بـ INSERT IGNORE
    normalized = normalized.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT IGNORE INTO');
    // 2. استبدال INSERT OR REPLACE بـ REPLACE INTO
    normalized = normalized.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'REPLACE INTO');
    // 3. استبدال ON CONFLICT(key) بـ ON DUPLICATE KEY UPDATE
    normalized = normalized.replace(/ON\s+CONFLICT\s*\(\s*`?key`?\s*\)\s*DO\s+UPDATE\s+SET\s+value\s*=\s*excluded\.value/gi,
      'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)');
    // 4. استبدال MAX(0, expr) بـ GREATEST(0, expr)
    normalized = normalized.replace(/MAX\s*\(\s*0\s*,\s*([^)]+)\)/gi, 'GREATEST(0, $1)');
    // 5. تغليف حقل key المحجوز بـ backticks إذا كان في جدول settings
    normalized = normalized.replace(/\bsettings\s*\(\s*key\s*,/gi, 'settings (`key`,');
    normalized = normalized.replace(/\bWHERE\s+key\s*=/gi, 'WHERE `key` =');
  } else {
    // في حالة SQLite
    normalized = normalized.replace(/GREATEST\s*\(\s*0\s*,\s*([^)]+)\)/gi, 'MAX(0, $1)');
    normalized = normalized.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT OR IGNORE INTO');
  }

  return normalized;
}

/**
 * الاتصال بمحرك MySQL مع إنشاء قاعدة البيانات والجداول تلقائياً إن لم تكن موجودة
 */
async function initMysql() {
  const mysqlCfg = appConfig.mysql;
  console.log(`📡 [Rawasi DB] Checking MySQL connection on ${mysqlCfg.host}:${mysqlCfg.port}...`);

  // 1. الاتصال بدون تحديد اسم قاعدة البيانات لضمان إنشائها أولاً
  let initConn;
  try {
    initConn = await mysql.createConnection({
      host: mysqlCfg.host,
      port: mysqlCfg.port,
      user: mysqlCfg.user,
      password: mysqlCfg.password,
      connectTimeout: 4000
    });

    await initConn.query(`CREATE DATABASE IF NOT EXISTS \`${mysqlCfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await initConn.end();
  } catch (err) {
    throw new Error(`MySQL connection failed: ${err.message}`);
  }

  // 2. إنشاء بركة الاتصال (Connection Pool)
  mysqlPool = mysql.createPool({
    host: mysqlCfg.host,
    port: mysqlCfg.port,
    user: mysqlCfg.user,
    password: mysqlCfg.password,
    database: mysqlCfg.database,
    waitForConnections: mysqlCfg.waitForConnections !== false,
    connectionLimit: mysqlCfg.connectionLimit || 20,
    queueLimit: mysqlCfg.queueLimit || 0,
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci'
  });

  // فحص الاتصال بالبركة
  const testConn = await mysqlPool.getConnection();
  testConn.release();

  // 3. التحقق من وجود الجداول وتطبيق schema_mysql.sql إن كانت جديدة
  const [rows] = await mysqlPool.query("SHOW TABLES LIKE 'users'");
  if (!rows || rows.length === 0) {
    console.log('🌱 [Rawasi DB] New MySQL database detected - Initializing 31 tables...');
    const schemaMysqlPath = path.join(__dirname, 'schema_mysql.sql');
    if (fs.existsSync(schemaMysqlPath)) {
      const schemaSql = fs.readFileSync(schemaMysqlPath, 'utf8');
      await mysqlPool.query(schemaSql);
    }
  }

  // 4. التحقق من وجود المستخدم الرئيسي الافتراضي في MySQL
  const [userCountRows] = await mysqlPool.query("SELECT count(*) as count FROM users");
  if (!userCountRows || userCountRows[0].count === 0) {
    console.log('👤 تهيئة حسابات الإدارة الافتراضية في MySQL...');
    const bcrypt = require('bcryptjs');
    const salt = bcrypt.genSaltSync(10);
    const adminHash = bcrypt.hashSync('admin123', salt);
    const accountantHash = bcrypt.hashSync('account123', salt);

    await mysqlPool.query(`
      INSERT IGNORE INTO roles (id, name, display_name, permissions) VALUES 
      (1, 'admin', 'المدير العام', 'all'),
      (2, 'accountant', 'المحاسب المالي', 'accounting,reports,payments,billing,expenses,revenues,custody,clients,suppliers,cash'),
      (3, 'project_manager', 'مدير المشاريع', 'projects,inventory,expenses'),
      (4, 'storekeeper', 'أمين المخزن', 'inventory,items'),
      (5, 'auditor', 'المراجع والمدقق المالي', 'accounting:view,accounting:approve,accounting:post,accounting:export,reports:view,reports:export,expenses:view,expenses:approve,revenues:view,revenues:approve,billing:view,billing:approve,custody:view,custody:approve,projects:view,projects:export,inventory:view,purchases:view,purchases:approve,hr:view,hr:approve,cash:view');
    `);

    await mysqlPool.query(`
      INSERT INTO users (username, password_hash, full_name, role_id, role, email, phone, status)
      VALUES 
      ('admin', ?, 'المدير العام', 1, 'admin', 'aalwi@engineer.com', '772332164', 'active'),
      ('accountant', ?, 'المحاسب المالي', 2, 'accountant', 'accountant@rawasiaden.com', '781278157', 'active');
    `, [adminHash, accountantHash]);

    await mysqlPool.query(`
      INSERT INTO settings (\`key\`, \`value\`, description) VALUES 
      ('company_name', 'رواسي عدن للهندسة والمقاولات', 'اسم الشركة بالعربي'),
      ('company_name_en', 'Rawasi Aden for Engineering & Contracting', 'اسم الشركة بالإنجليزي'),
      ('slogan', 'نبني الحاضر لنستثمر المستقبل', 'شعار الشركة اللفظي'),
      ('phone1', '772332164', 'رقم الهاتف الرئيسي'),
      ('phone2', '781278157', 'رقم الهاتف الإضافي'),
      ('email', 'aalwi@engineer.com', 'البريد الإلكتروني'),
      ('address', 'عدن - إنماء الجديدة - خلف القطيبي', 'عنوان المركز الرئيسي'),
      ('currency', 'ر.ي', 'العملة الافتراضية')
      ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`);
    `);
  }

  // فحص حقل active_sessions و security_settings في جدول users في MySQL
  try {
    const [cols] = await mysqlPool.query("SHOW COLUMNS FROM users LIKE 'active_sessions'");
    if (!cols || cols.length === 0) {
      await mysqlPool.query("ALTER TABLE users ADD COLUMN active_sessions TEXT NULL");
    }
  } catch {}
  try {
    const [secCols] = await mysqlPool.query("SHOW COLUMNS FROM users LIKE 'security_settings'");
    if (!secCols || secCols.length === 0) {
      await mysqlPool.query("ALTER TABLE users ADD COLUMN security_settings TEXT NULL");
    }
  } catch {}
  try {
    const [pinCols] = await mysqlPool.query("SHOW COLUMNS FROM users LIKE 'two_factor_pin'");
    if (!pinCols || pinCols.length === 0) {
      await mysqlPool.query("ALTER TABLE users ADD COLUMN two_factor_pin VARCHAR(20) DEFAULT '123456'");
    }
  } catch {}
  try {
    const [tfaCols] = await mysqlPool.query("SHOW COLUMNS FROM users LIKE 'two_factor_enabled'");
    if (!tfaCols || tfaCols.length === 0) {
      await mysqlPool.query("ALTER TABLE users ADD COLUMN two_factor_enabled TINYINT(1) DEFAULT 1");
    }
  } catch {}

  // ترقية جداول MySQL التلقائية لمراكز التكلفة والشيكات والعهد
  try {
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS cost_centers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(100) DEFAULT 'مشروع',
        project_id INT NULL,
        status VARCHAR(50) DEFAULT 'active',
        notes TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [ccCount] = await mysqlPool.query("SELECT count(*) as count FROM cost_centers");
    if (!ccCount || ccCount[0].count === 0) {
      await mysqlPool.query(`
        INSERT IGNORE INTO cost_centers (code, name, type, notes) VALUES
        ('CC-100', 'الإدارة العامة والمصروفات المشتركة', 'إدارة عامة', 'مركز تكلفة الإدارة الرئيسية والمصروفات العمومية'),
        ('CC-200', 'المعدات والآليات والتشغيل الميداني', 'معدات وآليات', 'مركز تكلفة المحروقات وصيانة المعدات');
      `);
      await mysqlPool.query(`
        INSERT IGNORE INTO cost_centers (code, name, type, project_id, notes)
        SELECT CONCAT('CC-', LPAD(id, 3, '0')), name, 'مشروع', id, 'مركز تكلفة خاص بالمشروع'
        FROM projects;
      `);
    }

    const checkAndAddCol = async (table, col, def) => {
      const [cols] = await mysqlPool.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${col}'`);
      if (!cols || cols.length === 0) {
        await mysqlPool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
      }
    };

    await checkAndAddCol('expenses', 'account_id', 'INT NULL');
    await checkAndAddCol('expenses', 'cost_center_id', 'INT NULL');
    await checkAndAddCol('expenses', 'check_no', 'VARCHAR(100) NULL');
    await checkAndAddCol('expenses', 'bank_name', 'VARCHAR(150) NULL');

    await checkAndAddCol('payments', 'account_id', 'INT NULL');
    await checkAndAddCol('payments', 'cost_center_id', 'INT NULL');
    await checkAndAddCol('payments', 'check_no', 'VARCHAR(100) NULL');
    await checkAndAddCol('payments', 'bank_name', 'VARCHAR(150) NULL');

    await checkAndAddCol('journal_entry_lines', 'cost_center_id', 'INT NULL');

    await checkAndAddCol('custodies', 'custody_no', 'VARCHAR(100) NULL');
    await checkAndAddCol('custodies', 'employee_id', 'INT NULL');
    await checkAndAddCol('custodies', 'employee_no', 'VARCHAR(50) NULL');
    await checkAndAddCol('custodies', 'related_custody_id', 'INT NULL');
    await checkAndAddCol('custodies', 'related_custody_no', 'VARCHAR(100) NULL');
    await checkAndAddCol('custodies', 'status', 'VARCHAR(50) DEFAULT \'مفتوحة\'');

    await checkAndAddCol('payroll', 'journal_entry_id', 'INT NULL');

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS currencies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(10) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        symbol VARCHAR(20) NOT NULL,
        rate_to_base DECIMAL(12,4) DEFAULT 1.0,
        is_base TINYINT(1) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlPool.query(`
      INSERT IGNORE INTO currencies (code, name, symbol, rate_to_base, is_base, status) VALUES
      ('YER', 'ريال يمني', 'ر.ي', 1.0, 1, 'active'),
      ('SAR', 'ريال سعودي', 'ر.س', 535.0, 0, 'active'),
      ('USD', 'دولار أمريكي', '$', 2040.0, 0, 'active');
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS leave_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        days_allowed INT DEFAULT 30,
        is_paid TINYINT(1) DEFAULT 1,
        notes TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlPool.query(`
      INSERT IGNORE INTO leave_types (name, days_allowed, is_paid, notes) VALUES
      ('إجازة سنوية اعتيادية', 30, 1, 'رصيد سنوي مدفوع الأجر بالكامل'),
      ('إجازة مرضية', 15, 1, 'بتقرير طبي معتمد مدفوعة الأجر'),
      ('إجازة طارئة وعارضة', 6, 1, 'إجازة ظروف طارئة مقتطعة من الرصيد'),
      ('إجازة بدون راتب', 90, 0, 'إجازة خاصة غير مدفوعة'),
      ('إجازة حج وعمرة', 15, 1, 'تمنح لمرة واحدة طوال الخدمة');
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS employee_evaluations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        evaluator_name VARCHAR(150) NULL,
        period VARCHAR(100) NOT NULL,
        evaluation_date DATE NOT NULL,
        score DECIMAL(5,2) DEFAULT 100,
        rating VARCHAR(50) DEFAULT 'ممتاز',
        strengths TEXT NULL,
        improvements TEXT NULL,
        recommendations TEXT NULL,
        notes TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // جداول بوابة وتطبيق العملاء في MySQL
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS client_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT NOT NULL,
        email VARCHAR(191) NOT NULL UNIQUE,
        phone VARCHAR(50) NULL,
        password_hash TEXT NOT NULL,
        full_name VARCHAR(150) NOT NULL,
        role VARCHAR(30) DEFAULT 'viewer',
        permissions TEXT NULL,
        status VARCHAR(20) DEFAULT 'active',
        two_factor_enabled TINYINT(1) DEFAULT 1,
        two_factor_pin VARCHAR(20) DEFAULT '123456',
        otp_code VARCHAR(10) NULL,
        otp_expires_at DATETIME NULL,
        last_login_at DATETIME NULL,
        last_login_ip VARCHAR(50) NULL,
        device_token TEXT NULL,
        device_platform VARCHAR(20) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS client_project_access (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_user_id INT NOT NULL,
        project_id INT NOT NULL,
        can_view_progress TINYINT(1) DEFAULT 1,
        can_view_invoices TINYINT(1) DEFAULT 1,
        can_view_payments TINYINT(1) DEFAULT 1,
        can_view_reports TINYINT(1) DEFAULT 1,
        can_view_drawings TINYINT(1) DEFAULT 1,
        can_view_correspondence TINYINT(1) DEFAULT 1,
        can_approve_invoices TINYINT(1) DEFAULT 0,
        can_send_messages TINYINT(1) DEFAULT 1,
        granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        granted_by INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_client_proj (client_user_id, project_id),
        FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS client_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_user_id INT NOT NULL,
        project_id INT NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        reference_type VARCHAR(50) NULL,
        reference_id INT NULL,
        is_read TINYINT(1) DEFAULT 0,
        sent_via_push TINYINT(1) DEFAULT 0,
        sent_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS client_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_user_id INT NOT NULL,
        project_id INT NULL,
        direction VARCHAR(20) DEFAULT 'outgoing',
        subject VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        attachment_url TEXT NULL,
        priority VARCHAR(20) DEFAULT 'normal',
        status VARCHAR(20) DEFAULT 'open',
        replied_by INT NULL,
        reply_body TEXT NULL,
        replied_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await checkAndAddCol('bills', 'client_approval_status', "VARCHAR(30) DEFAULT 'pending'");
    await checkAndAddCol('bills', 'client_approved_at', 'DATETIME NULL');
    await checkAndAddCol('bills', 'client_approval_notes', 'TEXT NULL');
    await checkAndAddCol('bills', 'client_approved_by_id', 'INT NULL');
  } catch (err) {
    console.warn('Accounting migration note (MySQL):', err.message);
  }

  activeEngine = 'mysql';
  console.log(`🐬 [Rawasi DB] MySQL engine active! Connected to [${mysqlCfg.database}] on ${mysqlCfg.host}:${mysqlCfg.port}`);
}

/**
 * تهيئة محرك SQLite الاحتياطي
 */
function initSqlite() {
  initSqliteInstance();

  // فحص استباقي للأعمدة المحدثة في الجداول الموجودة قبل تطبيق مخطط schema.sql
  try {
    const tableList = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    
    if (tableList.includes('project_contracts')) {
      const pcCols = sqliteDb.prepare("PRAGMA table_info(project_contracts)").all().map(c => c.name);
      if (!pcCols.includes('client_id')) sqliteDb.exec("ALTER TABLE project_contracts ADD COLUMN client_id INTEGER;");
    }

    if (tableList.includes('bills')) {
      const bCols = sqliteDb.prepare("PRAGMA table_info(bills)").all().map(c => c.name);
      if (!bCols.includes('contract_id')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN contract_id INTEGER;");
      if (!bCols.includes('paid_amount')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN paid_amount REAL DEFAULT 0;");
      if (!bCols.includes('remaining_amount')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN remaining_amount REAL DEFAULT 0;");
      if (!bCols.includes('payment_status')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN payment_status TEXT DEFAULT 'unpaid';");
      if (!bCols.includes('gross_amount')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN gross_amount REAL DEFAULT 0;");
      if (!bCols.includes('advance_deduction')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN advance_deduction REAL DEFAULT 0;");
      if (!bCols.includes('retention_deduction')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN retention_deduction REAL DEFAULT 0;");
    }

    if (tableList.includes('payments')) {
      const pCols = sqliteDb.prepare("PRAGMA table_info(payments)").all().map(c => c.name);
      if (!pCols.includes('contract_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN contract_id INTEGER;");
      if (!pCols.includes('bill_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN bill_id INTEGER;");
      if (!pCols.includes('receipt_category')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN receipt_category TEXT DEFAULT 'general';");
      if (!pCols.includes('exchange_rate')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN exchange_rate REAL DEFAULT 1.0;");
      if (!pCols.includes('local_amount')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN local_amount REAL DEFAULT 0;");
    }
  } catch (e) {
    console.warn('Pre-schema check note:', e.message);
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    sqliteDb.exec(schemaSql);
  }

  // Safe migration for SQLite
  try {
    const cols = sqliteDb.prepare("PRAGMA table_info(users)").all();
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('permissions')) sqliteDb.exec("ALTER TABLE users ADD COLUMN permissions TEXT;");
    if (!colNames.includes('is_logged_in')) sqliteDb.exec("ALTER TABLE users ADD COLUMN is_logged_in INTEGER DEFAULT 0;");
    if (!colNames.includes('session_token')) sqliteDb.exec("ALTER TABLE users ADD COLUMN session_token TEXT;");
    if (!colNames.includes('last_heartbeat')) sqliteDb.exec("ALTER TABLE users ADD COLUMN last_heartbeat DATETIME;");
    if (!colNames.includes('last_login_at')) sqliteDb.exec("ALTER TABLE users ADD COLUMN last_login_at DATETIME;");
    if (!colNames.includes('last_login_ip')) sqliteDb.exec("ALTER TABLE users ADD COLUMN last_login_ip TEXT;");
    if (!colNames.includes('last_login_device')) sqliteDb.exec("ALTER TABLE users ADD COLUMN last_login_device TEXT;");
    if (!colNames.includes('active_sessions')) sqliteDb.exec("ALTER TABLE users ADD COLUMN active_sessions TEXT;");
    if (!colNames.includes('security_settings')) sqliteDb.exec("ALTER TABLE users ADD COLUMN security_settings TEXT;");
    if (!colNames.includes('two_factor_pin')) sqliteDb.exec("ALTER TABLE users ADD COLUMN two_factor_pin TEXT DEFAULT '123456';");
    if (!colNames.includes('two_factor_enabled')) sqliteDb.exec("ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 1;");
    if (!colNames.includes('branch_id')) sqliteDb.exec("ALTER TABLE users ADD COLUMN branch_id INTEGER DEFAULT 1;");
    if (!colNames.includes('branch')) sqliteDb.exec("ALTER TABLE users ADD COLUMN branch TEXT DEFAULT 'المركز الرئيسي';");
    if (!colNames.includes('department_id')) sqliteDb.exec("ALTER TABLE users ADD COLUMN department_id INTEGER DEFAULT 1;");
    if (!colNames.includes('department')) sqliteDb.exec("ALTER TABLE users ADD COLUMN department TEXT DEFAULT 'الإدارة العامة';");
    if (!colNames.includes('allowed_projects')) sqliteDb.exec("ALTER TABLE users ADD COLUMN allowed_projects TEXT DEFAULT '*';");
    if (!colNames.includes('allowed_branches')) sqliteDb.exec("ALTER TABLE users ADD COLUMN allowed_branches TEXT DEFAULT '*';");
    if (!colNames.includes('allowed_departments')) sqliteDb.exec("ALTER TABLE users ADD COLUMN allowed_departments TEXT DEFAULT '*';");

    try {
      const cmCols = sqliteDb.prepare("PRAGMA table_info(cash_movements)").all();
      const cmNames = cmCols.map(c => c.name);
      if (!cmNames.includes('project_id')) sqliteDb.exec("ALTER TABLE cash_movements ADD COLUMN project_id INTEGER;");
    } catch {}

    // ترقية جداول الفروع والأقسام المؤسسية
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        address TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        manager_name TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const brCount = sqliteDb.prepare("SELECT count(*) as count FROM branches").get();
    if (!brCount || brCount.count === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO branches (id, code, name, address, status) VALUES
        (1, 'BR-01', 'المركز الرئيسي - عدن', 'عدن - إنماء الجديدة - خلف القطيبي', 'active'),
        (2, 'BR-02', 'فرع المنصورة', 'عدن - المنصورة - شارع التسعين', 'active'),
        (3, 'BR-03', 'فرع حضرموت / المكلا', 'المكلا - فوه - الشارع العام', 'active');
      `);
    }

    const deptCount = sqliteDb.prepare("SELECT count(*) as count FROM departments").get();
    if (!deptCount || deptCount.count === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO departments (id, code, name, manager_name, status) VALUES
        (1, 'DEP-01', 'الإدارة العامة والتنفيذية', 'م. علوي', 'active'),
        (2, 'DEP-02', 'الإدارة المالية والمحاسبة', 'المحاسب المالي', 'active'),
        (3, 'DEP-03', 'إدارة المشاريع والمقاولات', 'مدير المشاريع', 'active'),
        (4, 'DEP-04', 'المراجعة والتدقيق الداخلي', 'المراجع الداخلي', 'active'),
        (5, 'DEP-05', 'الموارد البشرية والشؤون الإدارية', 'مسؤول الموارد البشرية', 'active'),
        (6, 'DEP-06', 'المشتريات والمخازن', 'أمين المخزن', 'active');
      `);
    }

    // ترقية أدوار النظام وفصل الصلاحيات (Admin, Accountant, Auditor, Project Manager, Storekeeper)
    sqliteDb.exec(`
      INSERT OR IGNORE INTO roles (id, name, display_name, permissions) VALUES 
      (1, 'admin', 'المدير العام', 'all'),
      (2, 'accountant', 'المحاسب المالي', 'accounting,reports,payments,billing,expenses,revenues,custody,clients,suppliers,cash'),
      (3, 'project_manager', 'مدير المشاريع', 'projects,inventory,expenses'),
      (4, 'storekeeper', 'أمين المخزن', 'inventory,items'),
      (5, 'auditor', 'المراجع والمدقق المالي', 'accounting:view,accounting:approve,accounting:post,accounting:export,reports:view,reports:export,expenses:view,expenses:approve,revenues:view,revenues:approve,billing:view,billing:approve,custody:view,custody:approve,projects:view,projects:export,inventory:view,purchases:view,purchases:approve,hr:view,hr:approve,cash:view');
    `);

    // ترقية أعمدة جدول المشاريع لربطها بالفروع والأقسام
    const prjCols = sqliteDb.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
    if (!prjCols.includes('branch_id')) sqliteDb.exec("ALTER TABLE projects ADD COLUMN branch_id INTEGER DEFAULT 1;");
    if (!prjCols.includes('department_id')) sqliteDb.exec("ALTER TABLE projects ADD COLUMN department_id INTEGER DEFAULT 3;");

    // مزامنة الرمز مع إعدادات المدير العام إن وجدت
    try {
      const adminPinRow = sqliteDb.prepare("SELECT value FROM settings WHERE `key` = 'admin_2fa_pin'").get();
      if (adminPinRow && adminPinRow.value) {
        sqliteDb.prepare("UPDATE users SET two_factor_pin = ? WHERE username = 'admin' AND (two_factor_pin IS NULL OR two_factor_pin = '')").run(adminPinRow.value);
      }
    } catch {}

    // ترقية مراكز التكلفة وجداول المحاسبة والشيكات والعهد
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS cost_centers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'مشروع',
        project_id INTEGER REFERENCES projects(id),
        status TEXT DEFAULT 'active',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const ccCount = sqliteDb.prepare("SELECT count(*) as count FROM cost_centers").get();
    if (!ccCount || ccCount.count === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO cost_centers (code, name, type, notes) VALUES
        ('CC-100', 'الإدارة العامة والمصروفات المشتركة', 'إدارة عامة', 'مركز تكلفة الإدارة الرئيسية والمصروفات العمومية'),
        ('CC-200', 'المعدات والآليات والتشغيل الميداني', 'معدات وآليات', 'مركز تكلفة المحروقات وصيانة المعدات');
      `);
      sqliteDb.exec(`
        INSERT OR IGNORE INTO cost_centers (code, name, type, project_id, notes)
        SELECT 'CC-' || printf('%03d', id), name, 'مشروع', id, 'مركز تكلفة خاص بالمشروع'
        FROM projects;
      `);
    }

    const expCols = sqliteDb.prepare("PRAGMA table_info(expenses)").all().map(c => c.name);
    if (!expCols.includes('account_id')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN account_id INTEGER REFERENCES accounts(id);");
    if (!expCols.includes('cost_center_id')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);");
    if (!expCols.includes('check_no')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN check_no TEXT;");
    if (!expCols.includes('bank_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN bank_name TEXT;");
    // أعمدة دورة المستند المالي والرقابة الثنائية (Maker-Checker / Lifecycle)
    if (!expCols.includes('status')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN status TEXT DEFAULT 'posted';");
    if (!expCols.includes('created_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN created_by_name TEXT;");
    if (!expCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reviewed_by_name TEXT;");
    if (!expCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reviewed_at DATETIME;");
    if (!expCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN review_notes TEXT;");
    if (!expCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN approved_by_name TEXT;");
    if (!expCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN approved_at DATETIME;");
    if (!expCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN approval_notes TEXT;");
    if (!expCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN posted_by_name TEXT;");
    if (!expCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN posted_at DATETIME;");
    if (!expCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversed_by_name TEXT;");
    if (!expCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversed_at DATETIME;");
    if (!expCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversal_reason TEXT;");
    if (!expCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversal_ref_id INTEGER;");
    if (!expCols.includes('journal_entry_id')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);");
    if (!expCols.includes('bank_account_id')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN bank_account_id INTEGER REFERENCES bank_accounts(id);");

    const payCols = sqliteDb.prepare("PRAGMA table_info(payments)").all().map(c => c.name);
    if (!payCols.includes('account_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN account_id INTEGER REFERENCES accounts(id);");
    if (!payCols.includes('cost_center_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);");
    if (!payCols.includes('check_no')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN check_no TEXT;");
    if (!payCols.includes('bank_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN bank_name TEXT;");
    if (!payCols.includes('bank_account_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN bank_account_id INTEGER REFERENCES bank_accounts(id);");
    if (!payCols.includes('journal_entry_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);");
    // أعمدة دورة المستند المالي لسندات القبض والصرف
    if (!payCols.includes('status')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN status TEXT DEFAULT 'posted';");
    if (!payCols.includes('created_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN created_by_name TEXT;");
    if (!payCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reviewed_by_name TEXT;");
    if (!payCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reviewed_at DATETIME;");
    if (!payCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN review_notes TEXT;");
    if (!payCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN approved_by_name TEXT;");
    if (!payCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN approved_at DATETIME;");
    if (!payCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN approval_notes TEXT;");
    if (!payCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN posted_by_name TEXT;");
    if (!payCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN posted_at DATETIME;");
    if (!payCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversed_by_name TEXT;");
    if (!payCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversed_at DATETIME;");
    if (!payCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversal_reason TEXT;");
    if (!payCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversal_ref_id INTEGER;");
    if (!payCols.includes('receipt_category')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN receipt_category TEXT DEFAULT 'general';");

    const jeCols = sqliteDb.prepare("PRAGMA table_info(journal_entries)").all().map(c => c.name);
    if (!jeCols.includes('status')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN status TEXT DEFAULT 'posted';");
    if (!jeCols.includes('created_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN created_by_name TEXT;");
    if (!jeCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN approved_by_name TEXT;");
    if (!jeCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN approved_at DATETIME;");
    if (!jeCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN posted_by_name TEXT;");
    if (!jeCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN posted_at DATETIME;");
    if (!jeCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversed_by_name TEXT;");
    if (!jeCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversed_at DATETIME;");
    if (!jeCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversal_reason TEXT;");
    if (!jeCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversal_ref_id INTEGER;");

    const auditCols = sqliteDb.prepare("PRAGMA table_info(audit_logs)").all().map(c => c.name);
    if (!auditCols.includes('old_values')) sqliteDb.exec("ALTER TABLE audit_logs ADD COLUMN old_values TEXT;");
    if (!auditCols.includes('new_values')) sqliteDb.exec("ALTER TABLE audit_logs ADD COLUMN new_values TEXT;");
    if (!auditCols.includes('reason')) sqliteDb.exec("ALTER TABLE audit_logs ADD COLUMN reason TEXT;");

    const jelCols = sqliteDb.prepare("PRAGMA table_info(journal_entry_lines)").all().map(c => c.name);
    if (!jelCols.includes('cost_center_id')) sqliteDb.exec("ALTER TABLE journal_entry_lines ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);");

    const custCols = sqliteDb.prepare("PRAGMA table_info(custodies)").all().map(c => c.name);
    if (!custCols.includes('custody_no')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN custody_no TEXT;");
    if (!custCols.includes('employee_id')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN employee_id INTEGER REFERENCES employees(id);");
    if (!custCols.includes('employee_no')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN employee_no TEXT;");
    if (!custCols.includes('related_custody_id')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN related_custody_id INTEGER REFERENCES custodies(id);");
    if (!custCols.includes('related_custody_no')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN related_custody_no TEXT;");
    if (!custCols.includes('status')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN status TEXT DEFAULT 'مفتوحة';");

    sqliteDb.exec(`
      UPDATE custodies SET custody_no = 'CST-2024-' || printf('%04d', id) WHERE custody_no IS NULL OR custody_no = '';
    `);

    // ترقية جداول الإدارات المؤسسية الـ 7:
    // 1. جدول العملات وأسعار الصرف
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS currencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        rate_to_base REAL DEFAULT 1.0,
        is_base INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const curCount = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM currencies").get();
    if (!curCount || curCount.cnt === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO currencies (code, name, symbol, rate_to_base, is_base, status) VALUES
        ('YER', 'ريال يمني', 'ر.ي', 1.0, 1, 'active'),
        ('SAR', 'ريال سعودي', 'ر.س', 535.0, 0, 'active'),
        ('USD', 'دولار أمريكي', '$', 2040.0, 0, 'active');
      `);
    }

    // 2. جدول أنواع الإجازات
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS leave_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        days_allowed INTEGER DEFAULT 30,
        is_paid INTEGER DEFAULT 1,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const ltCount = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM leave_types").get();
    if (!ltCount || ltCount.cnt === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO leave_types (name, days_allowed, is_paid, notes) VALUES
        ('إجازة سنوية اعتيادية', 30, 1, 'رصيد سنوي مدفوع الأجر بالكامل'),
        ('إجازة مرضية', 15, 1, 'بتقرير طبي معتمد مدفوعة الأجر'),
        ('إجازة طارئة وعارضة', 6, 1, 'إجازة ظروف طارئة مقتطعة من الرصيد'),
        ('إجازة بدون راتب', 90, 0, 'إجازة خاصة غير مدفوعة'),
        ('إجازة حج وعمرة', 15, 1, 'تمنح لمرة واحدة طوال الخدمة');
      `);
    }

    // 3. جدول تقييم أداء الموظفين
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS employee_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        evaluator_name TEXT,
        period TEXT NOT NULL,
        evaluation_date DATE NOT NULL,
        score REAL DEFAULT 100,
        rating TEXT DEFAULT 'ممتاز',
        strengths TEXT,
        improvements TEXT,
        recommendations TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. ربط مسير الرواتب برقم القيد اليومي عند الترحيل المحاسبي
    const prCols = sqliteDb.prepare("PRAGMA table_info(payroll)").all().map(c => c.name);
    if (!prCols.includes('journal_entry_id')) {
      sqliteDb.exec("ALTER TABLE payroll ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);");
    }

    // 5. تهيئة عينة لمشاريع تحت الدراسة إن لم تكن موجودة
    const studyProj = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM projects WHERE status = 'under_study'").get();
    if (!studyProj || studyProj.cnt === 0) {
      sqliteDb.exec(`
        INSERT INTO projects (name, client_id, contract_value, estimated_cost, actual_cost, progress_percentage, status, notes)
        VALUES ('مشروع مجمع خورمكسر الطبي (قيد الدراسة والتسعير)', 1, 65000000, 52000000, 0, 0, 'under_study', 'مشروع قيد إعداد جدول الكميات BOQ والتسعير الهندسي للعطاء المنافس');
      `);
    }

    // 6. إضافة أعمدة تصنيف المستخلصات ودورة المستند والفصل المحاسبي للمقاولات
    const billCols = sqliteDb.prepare("PRAGMA table_info(bills)").all().map(c => c.name);
    if (!billCols.includes('gross_amount')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN gross_amount REAL DEFAULT 0;");
    if (!billCols.includes('advance_deduction')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN advance_deduction REAL DEFAULT 0;");
    if (!billCols.includes('retention_deduction')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN retention_deduction REAL DEFAULT 0;");
    if (!billCols.includes('created_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN created_by_name TEXT;");
    if (!billCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reviewed_by_name TEXT;");
    if (!billCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reviewed_at DATETIME;");
    if (!billCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN review_notes TEXT;");
    if (!billCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN approved_by_name TEXT;");
    if (!billCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN approved_at DATETIME;");
    if (!billCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN approval_notes TEXT;");
    if (!billCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN posted_by_name TEXT;");
    if (!billCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN posted_at DATETIME;");
    if (!billCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversed_by_name TEXT;");
    if (!billCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversed_at DATETIME;");
    if (!billCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversal_reason TEXT;");
    if (!billCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversal_ref_id INTEGER;");
    if (!billCols.includes('journal_entry_id')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);");

    // أعمدة دورة مستند المشتريات
    const puCols = sqliteDb.prepare("PRAGMA table_info(purchases)").all().map(c => c.name);
    if (!puCols.includes('status')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN status TEXT DEFAULT 'posted';");
    if (!puCols.includes('created_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN created_by_name TEXT;");
    if (!puCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reviewed_by_name TEXT;");
    if (!puCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reviewed_at DATETIME;");
    if (!puCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN review_notes TEXT;");
    if (!puCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN approved_by_name TEXT;");
    if (!puCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN approved_at DATETIME;");
    if (!puCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN approval_notes TEXT;");
    if (!puCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN posted_by_name TEXT;");
    if (!puCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN posted_at DATETIME;");
    if (!puCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversed_by_name TEXT;");
    if (!puCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversed_at DATETIME;");
    if (!puCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversal_reason TEXT;");
    if (!puCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversal_ref_id INTEGER;");
    if (!puCols.includes('journal_entry_id')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);");

    // أعمدة إضافية لقيود اليومية (المراجعة والاعتماد)
    if (!jeCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reviewed_by_name TEXT;");
    if (!jeCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reviewed_at DATETIME;");
    if (!jeCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN review_notes TEXT;");
    if (!jeCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN approval_notes TEXT;");

    // مشغلات حماية التوازن المحاسبي الصارم (Zero-Sum Invariant Triggers)
    sqliteDb.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_insert
      BEFORE INSERT ON journal_entries
      BEGIN
        SELECT CASE 
          WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
          THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن حفظ قيد غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
        END;
      END;
    `);

    sqliteDb.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_update
      BEFORE UPDATE OF total_debit, total_credit ON journal_entries
      BEGIN
        SELECT CASE 
          WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
          THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن تحديث قيد ليصبح غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
        END;
      END;
    `);

    // 7. إدارة دليل الحسابات الشجري تتم مركزياً عبر seed_chart_of_accounts.js لمنع تضارب البنية الهرمية المعيارية


    // 8. جدول إثبات وتسجيل الإيرادات التعاقدية ونسب الإنجاز (Contract Revenue Recognitions)
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS contract_revenue_recognitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recognition_no TEXT UNIQUE NOT NULL,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        period_date DATE NOT NULL,
        contract_value REAL DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        actual_cost_cumulative REAL DEFAULT 0,
        poc_percentage REAL DEFAULT 0,
        cumulative_recognized_revenue REAL DEFAULT 0,
        previous_recognized_revenue REAL DEFAULT 0,
        period_recognized_revenue REAL DEFAULT 0,
        cumulative_billings REAL DEFAULT 0,
        contract_asset_wip REAL DEFAULT 0,
        contract_liability REAL DEFAULT 0,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        status TEXT DEFAULT 'posted',
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_by_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 9. إضافة أعمدة إضافية لفواتير المشتريات والمستخلصات والأصناف والعملاء والموردين
    const puColsExt = sqliteDb.prepare("PRAGMA table_info(purchases)").all().map(c => c.name);
    if (!puColsExt.includes('po_id')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN po_id INTEGER;");
    if (!puColsExt.includes('grn_id')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN grn_id INTEGER;");
    if (!puColsExt.includes('matching_status')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN matching_status TEXT DEFAULT 'unmatched';");
    if (!puColsExt.includes('matching_notes')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN matching_notes TEXT;");

    const billColsExt = sqliteDb.prepare("PRAGMA table_info(bills)").all().map(c => c.name);
    if (!billColsExt.includes('tax_wht_rate')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN tax_wht_rate REAL DEFAULT 0;");
    if (!billColsExt.includes('tax_wht_amount')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN tax_wht_amount REAL DEFAULT 0;");

    const prjInvCols = sqliteDb.prepare("PRAGMA table_info(project_invoices)").all().map(c => c.name);
    if (!prjInvCols.includes('items_json')) sqliteDb.exec("ALTER TABLE project_invoices ADD COLUMN items_json TEXT;");
    if (!prjInvCols.includes('advance_pct')) sqliteDb.exec("ALTER TABLE project_invoices ADD COLUMN advance_pct REAL DEFAULT 10;");
    if (!prjInvCols.includes('retention_pct')) sqliteDb.exec("ALTER TABLE project_invoices ADD COLUMN retention_pct REAL DEFAULT 10;");
    if (!prjInvCols.includes('tax_wht_pct')) sqliteDb.exec("ALTER TABLE project_invoices ADD COLUMN tax_wht_pct REAL DEFAULT 0;");
    if (!prjInvCols.includes('tax_wht_amount')) sqliteDb.exec("ALTER TABLE project_invoices ADD COLUMN tax_wht_amount REAL DEFAULT 0;");

    const clientCols = sqliteDb.prepare("PRAGMA table_info(clients)").all().map(c => c.name);
    if (!clientCols.includes('tax_number')) sqliteDb.exec("ALTER TABLE clients ADD COLUMN tax_number TEXT;");

    const suppCols = sqliteDb.prepare("PRAGMA table_info(suppliers)").all().map(c => c.name);
    if (!suppCols.includes('tax_number')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN tax_number TEXT;");

    const itemCols = sqliteDb.prepare("PRAGMA table_info(items)").all().map(c => c.name);
    if (!itemCols.includes('costing_method')) sqliteDb.exec("ALTER TABLE items ADD COLUMN costing_method TEXT DEFAULT 'wac';");
    if (!itemCols.includes('reorder_level')) sqliteDb.exec("ALTER TABLE items ADD COLUMN reorder_level REAL DEFAULT 10;");
    if (!itemCols.includes('safety_stock')) sqliteDb.exec("ALTER TABLE items ADD COLUMN safety_stock REAL DEFAULT 5;");
    if (!itemCols.includes('has_batch_tracking')) sqliteDb.exec("ALTER TABLE items ADD COLUMN has_batch_tracking INTEGER DEFAULT 0;");

    const invTxCols = sqliteDb.prepare("PRAGMA table_info(inventory_transactions)").all().map(c => c.name);
    if (!invTxCols.includes('warehouse_id')) sqliteDb.exec("ALTER TABLE inventory_transactions ADD COLUMN warehouse_id INTEGER;");
    if (!invTxCols.includes('boq_item_id')) sqliteDb.exec("ALTER TABLE inventory_transactions ADD COLUMN boq_item_id INTEGER;");
    if (!invTxCols.includes('batch_number')) sqliteDb.exec("ALTER TABLE inventory_transactions ADD COLUMN batch_number TEXT;");
    if (!invTxCols.includes('serial_number')) sqliteDb.exec("ALTER TABLE inventory_transactions ADD COLUMN serial_number TEXT;");

    // 10. حسابات الضرائب والضمانات وعجز/فائض المخزون تدار معيارياً عبر seed_chart_of_accounts.js


    // 11. جداول دورة المشتريات المتقدمة (PR -> RFQ -> PO -> GRN -> 3-Way Match)
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_no TEXT UNIQUE NOT NULL,
        project_id INTEGER REFERENCES projects(id),
        boq_item_id INTEGER REFERENCES project_boq(id),
        department TEXT DEFAULT 'إدارة المشاريع',
        required_date DATE,
        urgency TEXT DEFAULT 'عادي',
        estimated_total REAL DEFAULT 0,
        status TEXT DEFAULT 'draft',
        created_by INTEGER REFERENCES users(id),
        created_by_name TEXT,
        approved_by INTEGER REFERENCES users(id),
        approved_by_name TEXT,
        approved_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS purchase_requisition_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requisition_id INTEGER NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id),
        item_name TEXT NOT NULL,
        unit TEXT,
        quantity REAL NOT NULL,
        estimated_price REAL DEFAULT 0,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS rfqs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rfq_no TEXT UNIQUE NOT NULL,
        requisition_id INTEGER REFERENCES purchase_requisitions(id),
        title TEXT NOT NULL,
        date DATE NOT NULL,
        closing_date DATE,
        winner_supplier_id INTEGER REFERENCES suppliers(id),
        winner_quote_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'draft',
        created_by INTEGER REFERENCES users(id),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rfq_vendor_quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        quote_reference TEXT,
        total_price REAL NOT NULL,
        delivery_days INTEGER DEFAULT 1,
        payment_terms TEXT,
        is_selected INTEGER DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_no TEXT UNIQUE NOT NULL,
        requisition_id INTEGER REFERENCES purchase_requisitions(id),
        rfq_id INTEGER REFERENCES rfqs(id),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        project_id INTEGER REFERENCES projects(id),
        warehouse_id INTEGER,
        date DATE NOT NULL,
        expected_delivery_date DATE,
        payment_terms TEXT DEFAULT '30 يوم من تاريخ الاستلام',
        delivery_terms TEXT DEFAULT 'موقع المشروع',
        currency TEXT DEFAULT 'ر.ي',
        subtotal REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        total_amount REAL NOT NULL,
        status TEXT DEFAULT 'draft',
        created_by INTEGER REFERENCES users(id),
        created_by_name TEXT,
        approved_by INTEGER REFERENCES users(id),
        approved_by_name TEXT,
        approved_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id),
        item_name TEXT NOT NULL,
        unit TEXT,
        ordered_qty REAL NOT NULL,
        received_qty REAL DEFAULT 0,
        billed_qty REAL DEFAULT 0,
        unit_price REAL NOT NULL,
        tax_rate REAL DEFAULT 0,
        total_price REAL NOT NULL,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS goods_receipt_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grn_no TEXT UNIQUE NOT NULL,
        po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        project_id INTEGER REFERENCES projects(id),
        warehouse_id INTEGER NOT NULL,
        delivery_note_no TEXT,
        received_date DATE NOT NULL,
        receiver_name TEXT NOT NULL,
        inspector_name TEXT,
        inspection_status TEXT DEFAULT 'accepted',
        status TEXT DEFAULT 'posted',
        created_by INTEGER REFERENCES users(id),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS goods_receipt_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grn_id INTEGER NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
        po_item_id INTEGER REFERENCES purchase_order_items(id),
        item_id INTEGER REFERENCES items(id),
        item_name TEXT NOT NULL,
        unit TEXT,
        received_qty REAL NOT NULL,
        accepted_qty REAL NOT NULL,
        rejected_qty REAL DEFAULT 0,
        rejection_reason TEXT,
        unit_cost REAL DEFAULT 0,
        total_cost REAL DEFAULT 0,
        batch_number TEXT,
        expiry_date DATE
      );
    `);

    // 12. جداول المستودعات المتعددة وتقييم المخزون والتسويات والجرد
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'central',
        project_id INTEGER REFERENCES projects(id),
        location TEXT,
        manager_name TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS warehouse_stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        quantity REAL DEFAULT 0,
        reorder_level REAL DEFAULT 10,
        safety_stock REAL DEFAULT 5,
        last_cost REAL DEFAULT 0,
        average_cost REAL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(warehouse_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS inventory_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transfer_no TEXT UNIQUE NOT NULL,
        from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        quantity REAL NOT NULL,
        unit_cost REAL DEFAULT 0,
        total_cost REAL DEFAULT 0,
        transfer_date DATE NOT NULL,
        status TEXT DEFAULT 'completed',
        created_by INTEGER REFERENCES users(id),
        received_by TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_no TEXT UNIQUE NOT NULL,
        return_type TEXT NOT NULL,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        total_amount REAL NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id),
        project_id INTEGER REFERENCES projects(id),
        boq_item_id INTEGER REFERENCES project_boq(id),
        date DATE NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'posted',
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        adjustment_no TEXT UNIQUE NOT NULL,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        system_qty REAL NOT NULL,
        physical_qty REAL NOT NULL,
        diff_qty REAL NOT NULL,
        unit_cost REAL NOT NULL,
        diff_amount REAL NOT NULL,
        adjustment_type TEXT NOT NULL,
        date DATE NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'posted',
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_valuation_layers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES items(id),
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        grn_id INTEGER REFERENCES goods_receipt_notes(id),
        date DATE NOT NULL,
        initial_qty REAL NOT NULL,
        remaining_qty REAL NOT NULL,
        unit_cost REAL NOT NULL,
        landed_cost_allocated REAL DEFAULT 0,
        batch_number TEXT,
        expiry_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- جناح إدارة المواد المتقدم، الجرد والتسويات، الحجر والتوالف، وتحويلات المشاريع (DDD Material Management)
      CREATE TABLE IF NOT EXISTS inventory_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_no TEXT UNIQUE NOT NULL,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        audit_type TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        scheduled_at DATETIME,
        executed_at DATETIME,
        snapshot_taken_at DATETIME,
        initiated_by INTEGER REFERENCES users(id),
        auditor_id INTEGER REFERENCES users(id),
        auditor_name TEXT NOT NULL,
        witness_name TEXT,
        category_filter TEXT,
        total_items_audited INTEGER DEFAULT 0,
        total_overage_qty REAL DEFAULT 0,
        total_shortage_qty REAL DEFAULT 0,
        total_overage_amount REAL DEFAULT 0,
        total_shortage_amount REAL DEFAULT 0,
        net_variance_amount REAL DEFAULT 0,
        digital_signature TEXT,
        hash_signature TEXT,
        minutes_doc TEXT,
        reconciled_at DATETIME,
        reconciled_by INTEGER REFERENCES users(id),
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_audit_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id INTEGER NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES items(id),
        system_qty REAL NOT NULL,
        physical_qty REAL DEFAULT 0,
        diff_qty REAL DEFAULT 0,
        unit_cost REAL NOT NULL,
        diff_amount REAL DEFAULT 0,
        discrepancy_type TEXT DEFAULT 'match',
        condition_status TEXT DEFAULT 'good',
        auditor_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS material_quarantine_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quarantine_no TEXT UNIQUE NOT NULL,
        item_id INTEGER NOT NULL REFERENCES items(id),
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        project_id INTEGER REFERENCES projects(id),
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL,
        total_loss_amount REAL NOT NULL,
        reason TEXT NOT NULL,
        inspection_notes TEXT,
        bin_location TEXT DEFAULT 'QUARANTINE_BIN_01',
        status TEXT DEFAULT 'quarantined',
        quarantined_by INTEGER REFERENCES users(id),
        quarantined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolution_date DATETIME,
        resolution_notes TEXT,
        resolved_by INTEGER REFERENCES users(id),
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS site_material_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_no TEXT UNIQUE NOT NULL,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        boq_item_id INTEGER REFERENCES project_boq(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        total_amount REAL NOT NULL,
        condition_status TEXT NOT NULL,
        qc_inspector_id INTEGER REFERENCES users(id),
        qc_inspector_name TEXT NOT NULL,
        qc_notes TEXT,
        qc_passed INTEGER DEFAULT 1,
        salvage_percentage REAL DEFAULT 100,
        credited_amount REAL NOT NULL,
        scrap_loss_amount REAL DEFAULT 0,
        return_date DATE NOT NULL,
        status TEXT DEFAULT 'inspected',
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        quarantine_id INTEGER REFERENCES material_quarantine_items(id),
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inter_project_material_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transfer_no TEXT UNIQUE NOT NULL,
        from_project_id INTEGER NOT NULL REFERENCES projects(id),
        to_project_id INTEGER NOT NULL REFERENCES projects(id),
        from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL,
        total_amount REAL NOT NULL,
        from_boq_item_id INTEGER REFERENCES project_boq(id),
        to_boq_item_id INTEGER REFERENCES project_boq(id),
        routing_rules_applied TEXT,
        status TEXT DEFAULT 'requested',
        requested_by INTEGER REFERENCES users(id),
        requested_by_name TEXT,
        approved_by INTEGER REFERENCES users(id),
        approved_by_name TEXT,
        received_by INTEGER REFERENCES users(id),
        received_by_name TEXT,
        rejection_reason TEXT,
        transfer_date DATE NOT NULL,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS material_domain_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE NOT NULL,
        event_name TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        user_id INTEGER,
        user_name TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        prev_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL
      );

      -- 13. جداول إغلاق المشروع وتقارير التحليلات بنمط CQRS
      CREATE TABLE IF NOT EXISTS project_closeouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        closeout_no TEXT UNIQUE NOT NULL,
        closeout_date DATE NOT NULL,
        closed_by INTEGER REFERENCES users(id),
        closed_by_name TEXT,
        status TEXT DEFAULT 'closed',
        total_contract_value REAL DEFAULT 0,
        total_billed_amount REAL DEFAULT 0,
        total_actual_cost REAL DEFAULT 0,
        gross_profit REAL DEFAULT 0,
        profit_margin_percent REAL DEFAULT 0,
        total_wastage_cost REAL DEFAULT 0,
        site_stock_value REAL DEFAULT 0,
        retention_amount REAL DEFAULT 0,
        net_client_payable REAL DEFAULT 0,
        notes TEXT,
        hash_signature TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- نموذج قراءة مستخلص العميل الخارجي (Client-Facing BoQ Read Model DTO)
      CREATE TABLE IF NOT EXISTS project_closeout_client_boq (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        closeout_id INTEGER NOT NULL REFERENCES project_closeouts(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        boq_item_id INTEGER REFERENCES project_boq(id),
        item_no TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT,
        unit TEXT NOT NULL,
        contract_qty REAL NOT NULL,
        billed_qty REAL NOT NULL,
        contract_unit_rate REAL NOT NULL,
        billable_amount REAL NOT NULL,
        previous_billed_amount REAL DEFAULT 0,
        current_billed_amount REAL DEFAULT 0,
        retention_percent REAL DEFAULT 5.0,
        retention_amount REAL DEFAULT 0,
        net_payable REAL NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- نموذج قراءة مستخلص الرقابة والتدقيق الداخلي (Internal Audit BoQ Read Model)
      CREATE TABLE IF NOT EXISTS project_closeout_internal_audit_boq (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        closeout_id INTEGER NOT NULL REFERENCES project_closeouts(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        boq_item_id INTEGER REFERENCES project_boq(id),
        item_no TEXT NOT NULL,
        item_name TEXT NOT NULL,
        category TEXT,
        unit TEXT NOT NULL,
        baseline_qty REAL NOT NULL,
        purchased_qty REAL DEFAULT 0,
        received_qty REAL DEFAULT 0,
        issued_qty REAL DEFAULT 0,
        consumed_qty REAL DEFAULT 0,
        site_stock_balance REAL DEFAULT 0,
        remaining_baseline REAL DEFAULT 0,
        returned_qty REAL DEFAULT 0,
        damaged_qty REAL DEFAULT 0,
        wastage_qty REAL DEFAULT 0,
        wastage_percent REAL DEFAULT 0,
        budgeted_unit_cost REAL DEFAULT 0,
        budgeted_cost REAL DEFAULT 0,
        actual_unit_cost REAL DEFAULT 0,
        total_actual_cost REAL DEFAULT 0,
        cost_variance REAL DEFAULT 0,
        contract_unit_rate REAL DEFAULT 0,
        contract_revenue REAL DEFAULT 0,
        gross_profit REAL DEFAULT 0,
        profit_margin_percent REAL DEFAULT 0,
        variance_status TEXT DEFAULT 'NORMAL',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_closeouts_proj ON project_closeouts(project_id);
      CREATE INDEX IF NOT EXISTS idx_client_boq_closeout ON project_closeout_client_boq(closeout_id);
      CREATE INDEX IF NOT EXISTS idx_audit_boq_closeout ON project_closeout_internal_audit_boq(closeout_id);
    `);

    // 14. جداول الحسابات البنكية والتسويات ومحفظة الشيكات
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER REFERENCES accounts(id),
        bank_name TEXT NOT NULL,
        account_number TEXT UNIQUE NOT NULL,
        iban TEXT,
        currency TEXT DEFAULT 'ر.ي',
        current_balance REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bank_statements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
        statement_date DATE NOT NULL,
        opening_balance REAL DEFAULT 0,
        closing_balance REAL DEFAULT 0,
        currency TEXT DEFAULT 'ر.ي',
        file_name TEXT,
        status TEXT DEFAULT 'draft',
        imported_by INTEGER REFERENCES users(id),
        imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bank_statement_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        statement_id INTEGER NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
        transaction_date DATE NOT NULL,
        value_date DATE,
        description TEXT NOT NULL,
        reference_no TEXT,
        debit REAL DEFAULT 0,
        credit REAL DEFAULT 0,
        balance REAL DEFAULT 0,
        is_reconciled INTEGER DEFAULT 0,
        matched_entity_type TEXT,
        matched_entity_id TEXT,
        matched_at DATETIME,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS bank_reconciliations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reconciliation_no TEXT UNIQUE NOT NULL,
        bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
        statement_id INTEGER REFERENCES bank_statements(id),
        reconciliation_date DATE NOT NULL,
        bank_statement_balance REAL NOT NULL,
        book_balance REAL NOT NULL,
        deposits_in_transit REAL DEFAULT 0,
        outstanding_cheques REAL DEFAULT 0,
        bank_charges_unrecorded REAL DEFAULT 0,
        adjusted_bank_balance REAL NOT NULL,
        adjusted_book_balance REAL NOT NULL,
        variance REAL DEFAULT 0,
        status TEXT DEFAULT 'balanced',
        prepared_by INTEGER REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        approved_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cheques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cheque_no TEXT NOT NULL,
        type TEXT NOT NULL,
        bank_account_id INTEGER REFERENCES bank_accounts(id),
        drawer_name TEXT,
        beneficiary_name TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'ر.ي',
        issue_date DATE NOT NULL,
        due_date DATE NOT NULL,
        status TEXT DEFAULT 'pending',
        project_id INTEGER REFERENCES projects(id),
        client_id INTEGER REFERENCES clients(id),
        supplier_id INTEGER REFERENCES suppliers(id),
        payment_id INTEGER REFERENCES payments(id),
        expense_id INTEGER REFERENCES expenses(id),
        clearance_date DATE,
        bounce_date DATE,
        bounce_reason TEXT,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 14. جداول الضرائب (الخصم من المنبع) والضمانات البنكية للمقاولات
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS tax_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tax_code TEXT UNIQUE NOT NULL,
        tax_name TEXT NOT NULL,
        rate_percentage REAL NOT NULL,
        type TEXT NOT NULL,
        law_reference TEXT,
        is_active INTEGER DEFAULT 1,
        legal_disclaimer TEXT,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS tax_withholdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        withholding_no TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        project_id INTEGER REFERENCES projects(id),
        client_id INTEGER REFERENCES clients(id),
        supplier_id INTEGER REFERENCES suppliers(id),
        source_doc_type TEXT NOT NULL,
        source_doc_id INTEGER NOT NULL,
        base_amount REAL NOT NULL,
        tax_rate REAL NOT NULL,
        tax_amount REAL NOT NULL,
        tax_period TEXT NOT NULL,
        date DATE NOT NULL,
        tax_number TEXT,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bank_guarantees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guarantee_no TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        client_id INTEGER REFERENCES clients(id),
        issuing_bank TEXT NOT NULL,
        bank_account_id INTEGER REFERENCES bank_accounts(id),
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'ر.ي',
        cash_margin_pct REAL DEFAULT 10,
        cash_margin_amount REAL NOT NULL,
        commission_fee REAL DEFAULT 0,
        issue_date DATE NOT NULL,
        expiry_date DATE NOT NULL,
        status TEXT DEFAULT 'active',
        release_date DATE,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        release_journal_entry_id INTEGER REFERENCES journal_entries(id),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 15. تهيئة بذور البيانات الافتراضية للمستودعات والحساب البنكي وإعدادات الضرائب اليمنية
    sqliteDb.exec(`
      INSERT OR IGNORE INTO warehouses (id, code, name, type, location, manager_name) VALUES
      (1, 'WH-MAIN', 'المستودع المركزي الرئيسي - خورمكسر', 'central', 'عدن - خورمكسر', 'أمين المستودع العام'),
      (2, 'WH-SITE-1', 'مستودع موقع مشروع برج الصالح', 'site', 'عدن - المعلا', 'مهندس الموقع');

      INSERT OR IGNORE INTO bank_accounts (id, account_id, bank_name, account_number, iban, currency, current_balance)
      SELECT 1, id, 'البنك الأهلي اليمني', '1023456789', 'YE98NBYE0000001023456789', 'ر.ي', 50000000 FROM accounts WHERE code = '12201001';
      INSERT OR IGNORE INTO bank_accounts (id, account_id, bank_name, account_number, iban, currency, current_balance)
      SELECT 2, id, 'بنك التضامن الإسلامي', '2034567890', 'YE98TDBE0000002034567890', 'ر.ي', 25000000 FROM accounts WHERE code = '12201001';

      INSERT OR IGNORE INTO tax_configs (id, tax_code, tax_name, rate_percentage, type, law_reference, legal_disclaimer) VALUES
      (1, 'WHT-CONT-3', 'ضريبة أرباح تجارية وصناعية - مقاولات (3%)', 3.0, 'wht_contracting', 'قانون ضرائب الدخل اليمني رقم 17 لسنة 2010 وتعديلاته', 'النسبة قابلة للتعديل حسب اللائحة التنفيذية وتوجيهات مصلحة الضرائب والمحاسب القانوني'),
      (2, 'WHT-SUPP-1', 'ضريبة خصم من المنبع - توريدات ومشتريات (1%)', 1.0, 'wht_supplies', 'قانون ضرائب الدخل اليمني رقم 17 لسنة 2010 وتعديلاته', 'النسبة قابلة للتعديل حسب اللائحة التنفيذية وتوجيهات مصلحة الضرائب والمحاسب القانوني'),
      (3, 'VAT-0', 'ضريبة المبيعات / القيمة المضافة (0% افتراضية للمقاولات)', 0.0, 'vat', 'قانون الضريبة العامة على المبيعات ولائحته التنفيذية', 'معفاة أو خاضعة لنسبة محددة وفق طبيعة العقد والتوريد');
    `);
  } catch (err) {
    console.warn('Accounting migration note (SQLite):', err.message);
  }

  // ============================================================
  // وحدة 15: جداول التحكم المتقدم في المشاريع (Auto-Migration)
  // ============================================================
  try {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS project_wbs_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES project_wbs_activities(id) ON DELETE SET NULL,
        wbs_code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT, discipline TEXT, activity_type TEXT DEFAULT 'task',
        weight REAL DEFAULT 1.0,
        planned_start DATE, planned_finish DATE, planned_duration_days REAL DEFAULT 0,
        actual_start DATE, actual_finish DATE, actual_duration_days REAL DEFAULT 0,
        percent_complete REAL DEFAULT 0,
        es_days REAL, ef_days REAL, ls_days REAL, lf_days REAL,
        total_float_days REAL, free_float_days REAL, is_critical INTEGER DEFAULT 0,
        status TEXT DEFAULT 'not_started', priority TEXT DEFAULT 'medium',
        assigned_to INTEGER REFERENCES users(id), notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_wbs_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        predecessor_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
        successor_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
        dependency_type TEXT DEFAULT 'FS', lag_days REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(predecessor_id, successor_id)
      );
      CREATE TABLE IF NOT EXISTS project_wbs_baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        activity_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        planned_start DATE, planned_finish DATE, planned_duration_days REAL,
        is_current INTEGER DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_engineer_certifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        pct REAL NOT NULL CHECK(pct >= 0 AND pct <= 100),
        certified_by INTEGER REFERENCES users(id),
        certified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        certifier_name TEXT, certifier_role TEXT, inspection_date DATE,
        notes TEXT, attachment_base64 TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_evm_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status_date DATE NOT NULL,
        bac REAL, pv REAL, ev REAL, ac REAL, cv REAL, sv REAL,
        cpi REAL, spi REAL, eac REAL, etc REAL, vac REAL, completion_pct REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, status_date)
      );
      CREATE TABLE IF NOT EXISTS project_risk_register (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        risk_ref TEXT, title TEXT NOT NULL, description TEXT,
        category TEXT DEFAULT 'general',
        probability INTEGER NOT NULL CHECK(probability BETWEEN 1 AND 5),
        impact INTEGER NOT NULL CHECK(impact BETWEEN 1 AND 5),
        risk_score INTEGER, risk_rating TEXT,
        financial_impact REAL DEFAULT 0, schedule_impact_days INTEGER DEFAULT 0,
        treatment_type TEXT DEFAULT 'mitigate', treatment_plan TEXT,
        owner_id INTEGER REFERENCES users(id),
        status TEXT DEFAULT 'open', review_date DATE,
        last_reviewed_at DATETIME, last_reviewed_by INTEGER REFERENCES users(id),
        closure_notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_claims_register (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        claim_ref TEXT, claim_type TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT, claimed_amount REAL DEFAULT 0, claimed_days INTEGER DEFAULT 0,
        approved_amount REAL DEFAULT 0, approved_days INTEGER DEFAULT 0,
        submitted_date DATE, responsible_party TEXT, priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'مفتوح', supporting_docs TEXT, response_notes TEXT,
        resolution_date DATE,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_non_conformance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        ncr_ref TEXT, title TEXT NOT NULL, description TEXT NOT NULL,
        location TEXT, discipline TEXT, severity TEXT DEFAULT 'medium',
        responsible_party TEXT, root_cause TEXT, corrective_action TEXT,
        preventive_action TEXT, due_date DATE, closed_date DATE,
        status TEXT DEFAULT 'مفتوح',
        verified_by INTEGER REFERENCES users(id), verification_notes TEXT,
        reported_by INTEGER REFERENCES users(id),
        reported_date DATE DEFAULT (date('now')), attachments TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_rfi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        rfi_ref TEXT, subject TEXT NOT NULL, description TEXT,
        discipline TEXT, submitted_to TEXT,
        submitted_by INTEGER REFERENCES users(id),
        submitted_date DATE DEFAULT (date('now')),
        required_response_date DATE, response_date DATE, response TEXT,
        priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'معلق', attachments TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_wbs_resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        resource_type TEXT NOT NULL, resource_name TEXT NOT NULL,
        unit TEXT, planned_qty REAL DEFAULT 0, actual_qty REAL DEFAULT 0,
        unit_cost REAL DEFAULT 0, notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ [Rawasi DB] Advanced Project Control tables initialized');

    // ترقية أعمدة التقارير اليومية للموقع (Daily Site Diary Migration)
    try {
      const dailyCols = sqliteDb.prepare("PRAGMA table_info(project_daily_reports)").all().map(c => c.name);
      if (!dailyCols.includes('manpower_details')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN manpower_details TEXT;");
      if (!dailyCols.includes('equipment_details')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN equipment_details TEXT;");
      if (!dailyCols.includes('materials_details')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN materials_details TEXT;");
      if (!dailyCols.includes('photos')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN photos TEXT;");
      if (!dailyCols.includes('gps_lat')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN gps_lat REAL;");
      if (!dailyCols.includes('gps_lng')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN gps_lng REAL;");
      if (!dailyCols.includes('temperature')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN temperature TEXT;");
      if (!dailyCols.includes('status')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN status TEXT DEFAULT 'معتمد';");
      if (!dailyCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN approved_by TEXT;");
      if (!dailyCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE project_daily_reports ADD COLUMN approved_at DATETIME;");
    } catch (e) {
      console.warn('Daily reports migration note (SQLite):', e.message);
    }

    // ترقية وتطوير وحدة علاقات الموردين (SRM / Vendor Profile Migration)
    try {
      // 1. جداول التعداد والجداول المرجعية (Lookup Tables)
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS vendor_industry_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          name_ar TEXT NOT NULL,
          name_en TEXT,
          icon TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS vendor_payment_document_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          name_ar TEXT NOT NULL,
          description TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // زرع البيانات المرجعية الأساسية إذا لم تكن موجودة
      const catCount = sqliteDb.prepare("SELECT COUNT(*) as c FROM vendor_industry_categories").get().c;
      if (catCount === 0) {
        const insertCat = sqliteDb.prepare("INSERT INTO vendor_industry_categories (code, name_ar, name_en, icon) VALUES (?, ?, ?, ?)");
        insertCat.run('ELEC', 'كهرباء وإنارة', 'Electrical & Lighting', '⚡');
        insertCat.run('PLUMB', 'سباكة وصحي', 'Plumbing & Sanitary', '🚰');
        insertCat.run('BLD_MAT', 'مواد بناء وأسمنت وحديد', 'Building Materials & Steel', '🧱');
        insertCat.run('ELECTRONICS', 'إلكترونيات وأنظمة أمان', 'Electronics & Security', '🔌');
        insertCat.run('PAINT', 'دهانات وتشطيبات', 'Paints & Finishing', '🎨');
        insertCat.run('HVAC', 'تكييف وتهوية', 'HVAC & Ventilation', '❄️');
        insertCat.run('HEAVY_EQ', 'معدات وآليات ثقيلة', 'Heavy Equipment', '🚜');
        insertCat.run('CARPENTRY', 'نجارة وأخشاب', 'Carpentry & Woodwork', '🪚');
        insertCat.run('GENERAL', 'مقاولات عامة وتوريدات', 'General Contracting & Supplies', '🏢');
        insertCat.run('OTHER', 'أخرى', 'Other Categories', '📦');
      }

      const docTypeCount = sqliteDb.prepare("SELECT COUNT(*) as c FROM vendor_payment_document_types").get().c;
      if (docTypeCount === 0) {
        const insertDocType = sqliteDb.prepare("INSERT INTO vendor_payment_document_types (code, name_ar, description) VALUES (?, ?, ?)");
        insertDocType.run('STANDARD_RECEIPT', 'إيصال عادي', 'سند صرف نقدي أو شيك بنكي مباشر');
        insertDocType.run('SUPPLY_CONTRACT', 'عقد توريد', 'عقد توريد رسمي بدفعات مجدولة وربط عقدي');
        insertDocType.run('LC', 'اعتماد مستندي LC', 'خطاب اعتماد بنكي مستندي للاستيراد الخارجي');
        insertDocType.run('PROMISSORY_NOTE', 'سند لأمر', 'سند إذني معتمد ومضمون الدفع');
        insertDocType.run('DEFERRED_INVOICE', 'فاتورة مؤجلة', 'شراء آجل مع فترة سماح محددة (Credit terms)');
      }

      // 2. تحديث وتوسيع جدول الموردين (Suppliers / Vendors Master Data)
      const suppCols = sqliteDb.prepare("PRAGMA table_info(suppliers)").all().map(c => c.name);
      if (!suppCols.includes('company_name')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN company_name TEXT;");
      if (!suppCols.includes('industry_category')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN industry_category TEXT DEFAULT 'مواد بناء';");
      if (!suppCols.includes('contact_person')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN contact_person TEXT;");
      if (!suppCols.includes('phone_number')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN phone_number TEXT;");
      if (!suppCols.includes('bank_name')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN bank_name TEXT;");
      if (!suppCols.includes('bank_account_no')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN bank_account_no TEXT;");
      if (!suppCols.includes('bank_iban')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN bank_iban TEXT;");
      if (!suppCols.includes('bank_details_encrypted')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN bank_details_encrypted TEXT;");
      if (!suppCols.includes('default_currency')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN default_currency TEXT DEFAULT 'YER';");
      if (!suppCols.includes('supply_lead_time_days')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN supply_lead_time_days INTEGER DEFAULT 3;");
      if (!suppCols.includes('payment_document_type')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN payment_document_type TEXT DEFAULT 'إيصال عادي';");
      if (!suppCols.includes('status')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN status TEXT DEFAULT 'active';");
      if (!suppCols.includes('tax_id')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN tax_id TEXT;");
      if (!suppCols.includes('commercial_reg_no')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN commercial_reg_no TEXT;");
      if (!suppCols.includes('credit_limit')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN credit_limit REAL DEFAULT 0;");
      if (!suppCols.includes('invoice_attachment')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN invoice_attachment TEXT;");
      if (!suppCols.includes('updated_at')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN updated_at DATETIME;");

      // مزامنة البيانات السابقة
      sqliteDb.exec(`
        UPDATE suppliers SET company_name = name WHERE company_name IS NULL OR company_name = '';
        UPDATE suppliers SET phone_number = phone WHERE (phone_number IS NULL OR phone_number = '') AND phone IS NOT NULL;
        UPDATE suppliers SET industry_category = category WHERE (industry_category IS NULL OR industry_category = '') AND category IS NOT NULL;
        UPDATE suppliers SET default_currency = CASE WHEN currency IS NOT NULL AND currency != '' THEN currency ELSE 'YER' END WHERE default_currency IS NULL OR default_currency = '';
      `);

      // 3. إنشاء فهارس الأداء (Performance Indexes for Real-Time Zero N+1)
      sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_purchases_supplier_status ON purchases (supplier_id, status);
        CREATE INDEX IF NOT EXISTS idx_payments_supplier_type_status ON payments (supplier_id, type, status);
        CREATE INDEX IF NOT EXISTS idx_suppliers_industry_status ON suppliers (industry_category, status);
      `);

      // 4. بناء العرض المجمع في الوقت الفعلي (SQL Aggregation View)
      sqliteDb.exec(`
        DROP VIEW IF EXISTS view_vendor_financial_profiles;
        CREATE VIEW view_vendor_financial_profiles AS
        SELECT 
            v.id AS id,
            v.id AS vendor_id,
            COALESCE(v.company_name, v.name) AS company_name,
            COALESCE(v.industry_category, v.category, 'مواد بناء') AS industry_category,
            v.contact_person,
            COALESCE(v.phone_number, v.phone) AS phone_number,
            v.email,
            v.address,
            v.bank_name,
            v.bank_account_no,
            v.bank_iban,
            v.bank_details_encrypted,
            COALESCE(v.default_currency, v.currency, 'YER') AS default_currency,
            COALESCE(v.supply_lead_time_days, 3) AS supply_lead_time_days,
            COALESCE(v.payment_document_type, 'إيصال عادي') AS payment_document_type,
            COALESCE(v.status, 'active') AS status,
            COALESCE(v.tax_id, v.tax_number) AS tax_id,
            v.commercial_reg_no,
            COALESCE(v.balance, 0.0) AS balance,
            COALESCE(v.balance, 0.0) AS opening_balance,
            v.invoice_attachment,
            v.notes,
            v.created_at,
            v.updated_at,
            
            -- التجميعات المالية الديناميكية المحسوبة في الوقت الفعلي (غير مخزنة ثابتاً)
            CASE 
                WHEN COALESCE(inv.total_invoices_count, 0) > 0 THEN inv.total_invoices_count
                WHEN v.invoice_attachment IS NOT NULL AND v.invoice_attachment != '' AND v.invoice_attachment != '[]' THEN 1
                ELSE 0
            END AS total_purchase_invoices_count,
            ROUND(COALESCE(v.balance, 0.0) + COALESCE(inv.total_invoiced_amount, 0.0), 2) AS total_invoiced_amount,
            ROUND(COALESCE(pay.total_amount_paid, 0.0), 2) AS total_amount_paid,
            ROUND((COALESCE(v.balance, 0.0) + COALESCE(inv.total_invoiced_amount, 0.0)) - COALESCE(pay.total_amount_paid, 0.0), 2) AS outstanding_balance
        FROM suppliers v
        LEFT JOIN (
            SELECT 
                supplier_id,
                COUNT(id) AS total_invoices_count,
                SUM(COALESCE(total_amount, 0.0)) AS total_invoiced_amount
            FROM purchases
            WHERE status != 'cancelled' OR status IS NULL
            GROUP BY supplier_id
        ) inv ON inv.supplier_id = v.id
        LEFT JOIN (
            SELECT 
                supplier_id,
                SUM(amount) AS total_amount_paid
            FROM (
                -- 1. صروفات الموردين من جدول سندات الصرف
                SELECT supplier_id, COALESCE(amount, 0.0) AS amount
                FROM payments 
                WHERE supplier_id IS NOT NULL 
                  AND type = 'صرف' 
                  AND (status IN ('cleared', 'posted', 'approved') OR status IS NULL)
                UNION ALL
                -- 2. المدفوعات المسجلة مباشرة على الفاتورة عند إنشائها
                SELECT supplier_id, COALESCE(paid_amount, 0.0) AS amount
                FROM purchases
                WHERE supplier_id IS NOT NULL 
                  AND paid_amount > 0 
                  AND (status != 'cancelled' OR status IS NULL)
                UNION ALL
                -- 3. المصروفات المباشرة غير المكررة في جدول payments
                SELECT supplier_id, COALESCE(amount, 0.0) AS amount
                FROM expenses
                WHERE supplier_id IS NOT NULL
                  AND (status IN ('cleared', 'posted', 'approved') OR status IS NULL)
                  AND (receipt_no IS NULL OR receipt_no NOT IN (SELECT receipt_no FROM payments WHERE receipt_no IS NOT NULL))
            )
            GROUP BY supplier_id
        ) pay ON pay.supplier_id = v.id;
      `);
      console.log('✅ [Rawasi DB] SRM & Vendor Financial Profiles view & tables initialized');
    } catch (e) {
      console.warn('SRM vendor migration note (SQLite):', e.message);
    }

    // ترقية وتطوير دورة حياة العميل والربط الهرمي التلقائي (Client Lifecycle & Hierarchy Migration)
    try {
      // 1. أعمدة العقود
      const contractCols = sqliteDb.prepare("PRAGMA table_info(project_contracts)").all().map(c => c.name);
      if (!contractCols.includes('client_id')) sqliteDb.exec("ALTER TABLE project_contracts ADD COLUMN client_id INTEGER REFERENCES clients(id);");

      // تحديث العقود القديمة لربطها بالعميل من المشروع
      sqliteDb.exec(`
        UPDATE project_contracts 
        SET client_id = (SELECT client_id FROM projects WHERE projects.id = project_contracts.project_id) 
        WHERE client_id IS NULL;
      `);

      // 2. أعمدة المستخلصات
      const billCols = sqliteDb.prepare("PRAGMA table_info(bills)").all().map(c => c.name);
      if (!billCols.includes('contract_id')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN contract_id INTEGER REFERENCES project_contracts(id);");
      if (!billCols.includes('paid_amount')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN paid_amount REAL DEFAULT 0;");
      if (!billCols.includes('remaining_amount')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN remaining_amount REAL DEFAULT 0;");
      if (!billCols.includes('payment_status')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN payment_status TEXT DEFAULT 'unpaid';");

      // تحديث المستخلصات القديمة لربطها بالعقد وتعيين المتبقي
      sqliteDb.exec(`
        UPDATE bills 
        SET contract_id = (SELECT id FROM project_contracts WHERE project_contracts.project_id = bills.project_id LIMIT 1) 
        WHERE contract_id IS NULL;

        UPDATE bills 
        SET remaining_amount = MAX(0, net_amount - COALESCE(paid_amount, 0))
        WHERE remaining_amount IS NULL OR remaining_amount = 0;
      `);

      // 3. أعمدة السندات والمدفوعات
      const payCols = sqliteDb.prepare("PRAGMA table_info(payments)").all().map(c => c.name);
      if (!payCols.includes('contract_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN contract_id INTEGER REFERENCES project_contracts(id);");
      if (!payCols.includes('bill_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN bill_id INTEGER REFERENCES bills(id);");
      if (!payCols.includes('receipt_category')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN receipt_category TEXT DEFAULT 'general';");

      // 4. إنشاء فهارس الأداء للسلسلة الهرمية
      sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_project_contracts_client ON project_contracts (client_id);
        CREATE INDEX IF NOT EXISTS idx_bills_client_project_status ON bills (client_id, project_id, status);
        CREATE INDEX IF NOT EXISTS idx_bills_contract_status ON bills (contract_id, status);
        CREATE INDEX IF NOT EXISTS idx_payments_client_bill_type ON payments (client_id, bill_id, type, status);
        CREATE INDEX IF NOT EXISTS idx_payments_contract_type ON payments (contract_id, type, status);
      `);

      // 5. بناء العرض المجمع في الوقت الفعلي للعملاء (Real-Time Zero N+1 View)
      sqliteDb.exec(`
        DROP VIEW IF EXISTS view_client_financial_profiles;
        CREATE VIEW view_client_financial_profiles AS
        SELECT
            c.id,
            c.id AS client_id,
            c.name,
            c.company,
            c.phone,
            c.email,
            c.address,
            COALESCE(c.currency, 'ر.ي') AS currency,
            COALESCE(c.previous_balance, 0.0) AS previous_balance,
            COALESCE(cnt.total_contracts_count, 0) AS total_contracts_count,
            ROUND(COALESCE(cnt.total_contracts_value, 0.0), 2) AS total_contracts_value,
            COALESCE(prj.total_projects_count, 0) AS total_projects_count,
            COALESCE(b.total_bills_count, 0) AS total_bills_count,
            ROUND(COALESCE(b.total_gross_billed, 0.0), 2) AS total_gross_billed,
            ROUND(COALESCE(b.total_net_billed, 0.0), 2) AS total_net_billed,
            ROUND(COALESCE(b.total_advance_deductions, 0.0), 2) AS total_advance_deductions,
            ROUND(COALESCE(b.total_retention_deductions, 0.0), 2) AS total_retention_deductions,
            ROUND(COALESCE(pay_adv.total_advance_received, 0.0), 2) AS total_advance_received,
            ROUND(MAX(0.0, COALESCE(pay_adv.total_advance_received, 0.0) - COALESCE(b.total_advance_deductions, 0.0)), 2) AS remaining_advance_balance,
            ROUND(COALESCE(pay_ret.total_retention_released, 0.0), 2) AS total_retention_released,
            ROUND(MAX(0.0, COALESCE(b.total_retention_deductions, 0.0) - COALESCE(pay_ret.total_retention_released, 0.0)), 2) AS active_retention_balance,
            ROUND(COALESCE(pay.total_collected, 0.0), 2) AS total_collected,
            ROUND((COALESCE(c.previous_balance, 0.0) + COALESCE(b.total_net_billed, 0.0)) - COALESCE(pay.total_collected, 0.0), 2) AS outstanding_balance
        FROM clients c
        LEFT JOIN (
            SELECT client_id, COUNT(id) AS total_projects_count
            FROM projects
            GROUP BY client_id
        ) prj ON prj.client_id = c.id
        LEFT JOIN (
            SELECT 
                COALESCE(pc.client_id, p.client_id) AS client_id,
                COUNT(pc.id) AS total_contracts_count,
                SUM(COALESCE(pc.contract_value, 0.0)) AS total_contracts_value
            FROM project_contracts pc
            LEFT JOIN projects p ON pc.project_id = p.id
            WHERE pc.status != 'ملغي'
            GROUP BY COALESCE(pc.client_id, p.client_id)
        ) cnt ON cnt.client_id = c.id
        LEFT JOIN (
            SELECT 
                client_id,
                COUNT(id) AS total_bills_count,
                SUM(COALESCE(gross_amount, amount, 0.0)) AS total_gross_billed,
                SUM(COALESCE(net_amount, amount, 0.0)) AS total_net_billed,
                SUM(COALESCE(advance_deduction, 0.0)) AS total_advance_deductions,
                SUM(COALESCE(retention_deduction, 0.0)) AS total_retention_deductions
            FROM bills
            WHERE status NOT IN ('draft', 'reversed', 'cancelled')
            GROUP BY client_id
        ) b ON b.client_id = c.id
        LEFT JOIN (
            SELECT client_id, SUM(COALESCE(amount, 0.0)) AS total_collected
            FROM payments
            WHERE type = 'قبض' AND (status IN ('posted', 'cleared', 'approved') OR status IS NULL)
            GROUP BY client_id
        ) pay ON pay.client_id = c.id
        LEFT JOIN (
            SELECT client_id, SUM(COALESCE(amount, 0.0)) AS total_advance_received
            FROM payments
            WHERE type = 'قبض' AND receipt_category = 'advance_payment' AND (status IN ('posted', 'cleared', 'approved') OR status IS NULL)
            GROUP BY client_id
        ) pay_adv ON pay_adv.client_id = c.id
        LEFT JOIN (
            SELECT client_id, SUM(COALESCE(amount, 0.0)) AS total_retention_released
            FROM payments
            WHERE type = 'قبض' AND receipt_category = 'retention_release' AND (status IN ('posted', 'cleared', 'approved') OR status IS NULL)
            GROUP BY client_id
        ) pay_ret ON pay_ret.client_id = c.id;

        CREATE TABLE IF NOT EXISTS project_variations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          contract_id INTEGER,
          vo_no TEXT NOT NULL,
          title TEXT NOT NULL,
          type TEXT DEFAULT 'addition',
          amount REAL NOT NULL DEFAULT 0,
          time_extension_days INTEGER DEFAULT 0,
          reason TEXT,
          approved_by TEXT,
          status TEXT DEFAULT 'approved',
          date DATE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS project_progress_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          previous_percentage REAL NOT NULL DEFAULT 0,
          new_percentage REAL NOT NULL DEFAULT 0,
          notes TEXT,
          recorded_by TEXT,
          date DATE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        -- جداول بوابة وتطبيق العملاء المخصص (Client Portal & Mobile App)
        CREATE TABLE IF NOT EXISTS client_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER NOT NULL,
          email VARCHAR(191) NOT NULL UNIQUE,
          phone VARCHAR(50),
          password_hash TEXT NOT NULL,
          full_name VARCHAR(150) NOT NULL,
          role VARCHAR(30) DEFAULT 'viewer',
          permissions TEXT DEFAULT '{"view_projects":true,"view_invoices":true,"view_payments":true,"approve_invoices":false,"send_messages":true}',
          status VARCHAR(20) DEFAULT 'active',
          two_factor_enabled INTEGER DEFAULT 1,
          two_factor_pin VARCHAR(20) DEFAULT '123456',
          otp_code VARCHAR(10),
          otp_expires_at DATETIME,
          last_login_at DATETIME,
          last_login_ip VARCHAR(50),
          device_token TEXT,
          device_platform VARCHAR(20),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS client_project_access (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_user_id INTEGER NOT NULL,
          project_id INTEGER NOT NULL,
          can_view_progress INTEGER DEFAULT 1,
          can_view_invoices INTEGER DEFAULT 1,
          can_view_payments INTEGER DEFAULT 1,
          can_view_reports INTEGER DEFAULT 1,
          can_view_drawings INTEGER DEFAULT 1,
          can_view_correspondence INTEGER DEFAULT 1,
          can_approve_invoices INTEGER DEFAULT 0,
          can_send_messages INTEGER DEFAULT 1,
          granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          granted_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(client_user_id, project_id),
          FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS client_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_user_id INTEGER NOT NULL,
          project_id INTEGER,
          type VARCHAR(50) NOT NULL,
          title VARCHAR(200) NOT NULL,
          body TEXT NOT NULL,
          reference_type VARCHAR(50),
          reference_id INTEGER,
          is_read INTEGER DEFAULT 0,
          sent_via_push INTEGER DEFAULT 0,
          sent_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS client_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_user_id INTEGER NOT NULL,
          project_id INTEGER,
          direction VARCHAR(20) DEFAULT 'outgoing',
          subject VARCHAR(200) NOT NULL,
          body TEXT NOT NULL,
          attachment_url TEXT,
          priority VARCHAR(20) DEFAULT 'normal',
          status VARCHAR(20) DEFAULT 'open',
          replied_by INTEGER,
          reply_body TEXT,
          replied_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cu_client_id ON client_users(client_id);
        CREATE INDEX IF NOT EXISTS idx_cu_email ON client_users(email);
        CREATE INDEX IF NOT EXISTS idx_cpa_user_proj ON client_project_access(client_user_id, project_id);
        CREATE INDEX IF NOT EXISTS idx_cn_user_read ON client_notifications(client_user_id, is_read);
        CREATE INDEX IF NOT EXISTS idx_cm_user ON client_messages(client_user_id);
      `);

      // إضافة أعمدة اعتماد المستخلصات في جدول bills إذا لم تكن موجودة
      try {
        const billsInfo = sqliteDb.prepare("PRAGMA table_info(bills)").all();
        const hasApprovalStatus = billsInfo.some(c => c.name === 'client_approval_status');
        if (!hasApprovalStatus) {
          sqliteDb.exec(`
            ALTER TABLE bills ADD COLUMN client_approval_status VARCHAR(30) DEFAULT 'pending';
            ALTER TABLE bills ADD COLUMN client_approved_at DATETIME;
            ALTER TABLE bills ADD COLUMN client_approval_notes TEXT;
            ALTER TABLE bills ADD COLUMN client_approved_by_id INTEGER;
          `);
        }
      } catch (colErr) {
        // أعمدة موجودة مسبقاً
      }

      console.log('✅ [Rawasi DB] Client Lifecycle & Portal tables initialized');
    } catch (e) {
      console.warn('Client hierarchy migration note (SQLite):', e.message);
    }

    // =========================================================================
    // ترقية وتطوير منظومة المدفوعات المتقدمة (Enterprise Payment System Architecture)
    // =========================================================================
    try {
      // 1. جدول طرق الدفع القابل للإدارة والتوسع (Payment Methods)
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS payment_methods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          is_active INTEGER DEFAULT 1,
          requires_financial_account INTEGER DEFAULT 1,
          requires_reference INTEGER DEFAULT 0,
          requires_gateway INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME
        );
      `);

      const pmCount = sqliteDb.prepare("SELECT COUNT(*) as c FROM payment_methods").get().c;
      if (pmCount === 0) {
        const insPm = sqliteDb.prepare(`
          INSERT INTO payment_methods (code, name, type, is_active, requires_financial_account, requires_reference, requires_gateway)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        insPm.run('CASH', 'نقداً', 'cash', 1, 1, 0, 0);
        insPm.run('BANK_TRANSFER', 'تحويل بنكي', 'bank', 1, 1, 1, 0);
        insPm.run('CREDIT_CARD', 'بطاقة ائتمانية', 'card', 1, 1, 1, 1);
        insPm.run('DEBIT_CARD', 'بطاقة خصم مباشر', 'card', 1, 1, 1, 1);
        insPm.run('WALLET', 'محفظة إلكترونية', 'wallet', 1, 1, 1, 0);
        insPm.run('ONLINE_GATEWAY', 'بوابة دفع إلكترونية', 'gateway', 1, 1, 1, 1);
        insPm.run('CHEQUE', 'شيك بنكي', 'cheque', 1, 1, 1, 0);
        insPm.run('POS', 'نقطة بيع POS', 'pos', 1, 1, 1, 1);
        insPm.run('COD', 'دفع عند الاستلام COD', 'cod', 1, 1, 0, 0);
        insPm.run('CREDIT', 'آجل', 'credit', 1, 0, 0, 0);
        insPm.run('INSTALLMENT', 'أقساط مجدولة', 'installment', 1, 0, 0, 0);
      }

      // 2. جدول الحسابات المالية (Financial Accounts) المرتبطة حصراً بحسابات نهائية (Leaf Accounts)
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS financial_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES accounts(id),
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          currency TEXT DEFAULT 'ر.ي',
          current_balance REAL DEFAULT 0,
          bank_name TEXT,
          account_number TEXT,
          iban TEXT,
          gateway_provider TEXT,
          is_active INTEGER DEFAULT 1,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME
        );
      `);

      const faCount = sqliteDb.prepare("SELECT COUNT(*) as c FROM financial_accounts").get().c;
      if (faCount === 0) {
        // العثور على الحسابات النهائية النقدية والبنكية في شجرة الحسابات
        const cashLeaf = sqliteDb.prepare("SELECT id FROM accounts WHERE code = '12101001' OR code LIKE '121%' AND is_posting = 1 ORDER BY CASE WHEN code = '12101001' THEN 0 ELSE 1 END LIMIT 1").get();
        const bankLeaf = sqliteDb.prepare("SELECT id FROM accounts WHERE code = '12201001' OR code LIKE '122%' AND is_posting = 1 ORDER BY CASE WHEN code = '12201001' THEN 0 ELSE 1 END LIMIT 1").get();
        
        const cashAccId = cashLeaf ? cashLeaf.id : 105;
        const bankAccId = bankLeaf ? bankLeaf.id : 106;

        const insFa = sqliteDb.prepare(`
          INSERT INTO financial_accounts (account_id, code, name, type, currency, bank_name, account_number, iban, gateway_provider)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insFa.run(cashAccId, 'FA-CASH-MAIN', 'صندوق الإدارة الرئيسي', 'cash', 'ر.ي', null, null, null, null);
        insFa.run(bankAccId, 'FA-BANK-NBY-01', 'البنك الأهلي اليمني - حساب جاري', 'bank', 'ر.ي', 'البنك الأهلي اليمني', '1023456789', 'YE98NBYE0000001023456789', null);
        insFa.run(bankAccId, 'FA-BANK-TADB-01', 'بنك التضامن الإسلامي - حساب رئيسي', 'bank', 'ر.ي', 'بنك التضامن الإسلامي', '2034567890', 'YE98TDBE0000002034567890', null);
        insFa.run(cashAccId, 'FA-WALLET-JAWWAL', 'محفظة جوال بي (Jawwal Pay)', 'wallet', 'ر.ي', null, '772332164', null, 'jawwal_pay');
        insFa.run(bankAccId, 'FA-GW-ONLINE', 'بوابة الدفع الإلكتروني المباشر', 'gateway', 'ر.ي', 'حساب وسيط البوابة', 'GW-99482', null, 'stripe');
      }

      // 3. ترقية جدول payments بإضافة أعمدة دورة الدفع الحديثة ومنع التكرار (Idempotency)
      const paymentsInfo = sqliteDb.prepare("PRAGMA table_info(payments)").all().map(c => c.name);
      if (!paymentsInfo.includes('payment_no')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN payment_no TEXT;");
      if (!paymentsInfo.includes('payment_method_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN payment_method_id INTEGER REFERENCES payment_methods(id);");
      if (!paymentsInfo.includes('financial_account_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN financial_account_id INTEGER REFERENCES financial_accounts(id);");
      if (!paymentsInfo.includes('idempotency_key')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN idempotency_key TEXT;");
      if (!paymentsInfo.includes('external_transaction_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN external_transaction_id TEXT;");
      if (!paymentsInfo.includes('gateway_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN gateway_name TEXT;");
      if (!paymentsInfo.includes('fee_amount')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN fee_amount REAL DEFAULT 0;");
      if (!paymentsInfo.includes('net_amount')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN net_amount REAL DEFAULT 0;");
      if (!paymentsInfo.includes('source_type')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN source_type TEXT DEFAULT 'RECEIPT_VOUCHER';");
      if (!paymentsInfo.includes('source_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN source_id INTEGER;");
      if (!paymentsInfo.includes('refunded_amount')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN refunded_amount REAL DEFAULT 0;");
      if (!paymentsInfo.includes('supplier_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN supplier_name TEXT;");
      if (!paymentsInfo.includes('updated_at')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN updated_at DATETIME;");

      // مزامنة أرقام الدفع وحسابات الصافي للمدفوعات السابقة
      sqliteDb.exec(`
        UPDATE payments SET payment_no = receipt_no WHERE payment_no IS NULL OR payment_no = '';
        UPDATE payments SET net_amount = amount - COALESCE(fee_amount, 0) WHERE net_amount IS NULL OR net_amount = 0;
      `);

      // 4. جدول التسويات المالية للعمليات والبوابات (Payment Settlements)
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS payment_settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          settlement_no TEXT UNIQUE NOT NULL,
          payment_id INTEGER NOT NULL REFERENCES payments(id),
          financial_account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
          gross_amount REAL NOT NULL,
          fee_amount REAL NOT NULL DEFAULT 0,
          net_amount REAL NOT NULL,
          settlement_date DATE NOT NULL,
          status TEXT DEFAULT 'settled',
          reference TEXT,
          journal_entry_id INTEGER REFERENCES journal_entries(id),
          created_by INTEGER REFERENCES users(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 5. جدول الاسترداد المالي الكامل والجزئي (Payment Refunds)
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS payment_refunds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          refund_no TEXT UNIQUE NOT NULL,
          payment_id INTEGER NOT NULL REFERENCES payments(id),
          amount REAL NOT NULL,
          reason TEXT NOT NULL,
          refund_type TEXT NOT NULL,
          status TEXT DEFAULT 'completed',
          reference TEXT,
          journal_entry_id INTEGER REFERENCES journal_entries(id),
          created_by INTEGER REFERENCES users(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 6. فهارس الأداء والحماية
      sqliteDb.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_payments_method_id ON payments(payment_method_id);
        CREATE INDEX IF NOT EXISTS idx_payments_fin_acc ON payments(financial_account_id);
        CREATE INDEX IF NOT EXISTS idx_payments_ext_txn ON payments(external_transaction_id);
        CREATE INDEX IF NOT EXISTS idx_settlements_payment ON payment_settlements(payment_id);
        CREATE INDEX IF NOT EXISTS idx_refunds_payment ON payment_refunds(payment_id);
      `);

      console.log('✅ [Rawasi DB] Modern Payment Lifecycle, Methods & Financial Accounts initialized');
    } catch (e) {
      console.warn('Payment architecture migration note (SQLite):', e.message);
    }

    // =========================================================================
    // ترقية وضمانات سلامة دفتر الأستاذ العام والتقارير المالية (General Ledger Integrity)
    // =========================================================================
    try {
      // 1. جداول الربط المحاسبي للتدفقات النقدية والذمم
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS cash_flow_account_mappings (
          account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
          activity TEXT NOT NULL CHECK (activity IN ('operating','investing','financing','excluded')),
          is_active INTEGER DEFAULT 1,
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS party_account_mappings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          party_type TEXT NOT NULL CHECK (party_type IN ('client','supplier')),
          party_id INTEGER NOT NULL,
          account_id INTEGER NOT NULL REFERENCES accounts(id),
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(party_type, party_id)
        );
      `);

      // 2. الفهارس المحاسبية الرقابية المتقدمة
      sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_je_status_date ON journal_entries(status, date);
        CREATE INDEX IF NOT EXISTS idx_jel_entry_account ON journal_entry_lines(entry_id, account_id);
        CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id);
        CREATE INDEX IF NOT EXISTS idx_jel_project ON journal_entry_lines(project_id);
        CREATE INDEX IF NOT EXISTS idx_jel_cost_center ON journal_entry_lines(cost_center_id);
        CREATE INDEX IF NOT EXISTS idx_payments_date_type_status ON payments(date, type, status);
        CREATE INDEX IF NOT EXISTS idx_expenses_date_status ON expenses(date, status);
      `);

      // 3. تصحيح أي قيود قديمة مسجلة على حسابات تجميعية غير ورقية للحفاظ على سلامة التقرير
      sqliteDb.exec(`
        UPDATE journal_entry_lines SET account_id = 103 WHERE account_id = 3;
        UPDATE journal_entry_lines SET account_id = 133 WHERE account_id = 8;
      `);

      // 4. قوادح الحماية الصارمة للحسابات الفرعية الأخيرة (Leaf Account Triggers)
      sqliteDb.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_journal_line_leaf_insert
        BEFORE INSERT ON journal_entry_lines
        FOR EACH ROW
        WHEN EXISTS (
            SELECT 1
            FROM accounts a
            WHERE a.id = NEW.account_id
              AND EXISTS (
                  SELECT 1
                  FROM accounts c
                  WHERE c.parent_id = a.id
              )
        )
        BEGIN
            SELECT RAISE(
                ABORT,
                'لا يمكن تسجيل العملية على حساب أب. يجب اختيار الحساب الفرعي الأخير.'
            );
        END;

        CREATE TRIGGER IF NOT EXISTS trg_journal_line_leaf_update
        BEFORE UPDATE OF account_id ON journal_entry_lines
        FOR EACH ROW
        WHEN EXISTS (
            SELECT 1
            FROM accounts a
            WHERE a.id = NEW.account_id
              AND EXISTS (
                  SELECT 1
                  FROM accounts c
                  WHERE c.parent_id = a.id
              )
        )
        BEGIN
            SELECT RAISE(
                ABORT,
                'لا يمكن تحديث القيد إلى حساب أب. يجب اختيار الحساب الفرعي الأخير.'
            );
        END;

        -- قوادح التحقق من صحة مبالغ أسطر القيد (مدين أو دائن فقط أكبر من الصفر)
        CREATE TRIGGER IF NOT EXISTS trg_journal_line_values_insert
        BEFORE INSERT ON journal_entry_lines
        FOR EACH ROW
        WHEN (NEW.debit <= 0 AND NEW.credit <= 0)
          OR (NEW.debit > 0 AND NEW.credit > 0)
          OR (NEW.debit < 0 OR NEW.credit < 0)
        BEGIN
            SELECT RAISE(
                ABORT,
                'سطر القيد غير صالح: يجب أن يكون إما مدين أكبر من الصفر فقط أو دائن أكبر من الصفر فقط.'
            );
        END;

        CREATE TRIGGER IF NOT EXISTS trg_journal_line_values_update
        BEFORE UPDATE OF debit, credit ON journal_entry_lines
        FOR EACH ROW
        WHEN (NEW.debit <= 0 AND NEW.credit <= 0)
          OR (NEW.debit > 0 AND NEW.credit > 0)
          OR (NEW.debit < 0 OR NEW.credit < 0)
        BEGIN
            SELECT RAISE(
                ABORT,
                'سطر القيد غير صالح: يجب أن يكون إما مدين أكبر من الصفر فقط أو دائن أكبر من الصفر فقط.'
            );
        END;
      `);

      // 5. التعيين التلقائي لخريطة التدفقات النقدية
      const mappingCount = sqliteDb.prepare("SELECT COUNT(*) as c FROM cash_flow_account_mappings").get().c;
      if (mappingCount === 0) {
        sqliteDb.exec(`
          INSERT OR IGNORE INTO cash_flow_account_mappings (account_id, activity, notes)
          SELECT id, 'operating', 'أنشطة تشغيلية - عملاء وموردين ومصروفات'
          FROM accounts 
          WHERE (code LIKE '123%' OR code LIKE '211%' OR code LIKE '3%' OR code LIKE '4%' OR code LIKE '5%')
            AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id);

          INSERT OR IGNORE INTO cash_flow_account_mappings (account_id, activity, notes)
          SELECT id, 'investing', 'أنشطة استثمارية - أصول ثابتة ومعدات'
          FROM accounts 
          WHERE code LIKE '111%'
            AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id);

          INSERT OR IGNORE INTO cash_flow_account_mappings (account_id, activity, notes)
          SELECT id, 'financing', 'أنشطة تمويلية - رأس المال والقروض'
          FROM accounts 
          WHERE (code LIKE '22%' OR code LIKE '212%')
            AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id);
        `);
      }

      console.log('✅ [Rawasi DB] General Ledger Integrity Rules, Leaf Triggers & Mappings initialized');
    } catch (e) {
      console.warn('Ledger integrity migration note (SQLite):', e.message);
    }
  } catch (err) {
    console.warn('Project control migration note (SQLite):', err.message);
  }

  activeEngine = 'sqlite';
  console.log(`📦 [Rawasi DB] SQLite engine active -> rawasi_aden.db`);
}

/**
 * دالة التهيئة والتشغيل العامة عند بدء الخادم
 */
async function initializeDatabase() {
  appConfig = loadConfig();

  if (appConfig.dbEngine === 'mysql') {
    try {
      await initMysql();
      return;
    } catch (err) {
      const isRefused = err.message.includes('ECONNREFUSED');
      console.warn(`⚠️  [Rawasi DB] MySQL server is offline (${isRefused ? 'Connection refused on port ' + (appConfig.mysql?.port || 3306) : err.message})`);
      console.warn('👉 [Rawasi DB] Fallback active: Automatically running on local SQLite.');
    }
  }

  initSqlite();
}

// بدء التهيئة الفورية
initializeDatabase().catch(e => {
  console.error('Fatal database initialization error:', e);
});

// =================== دوال الاستعلام العامة (Unified Query Layer) ===================

/**
 * استعلام يعيد كافة السجلات المطابقة كـ Array
 */
async function query(sql, params = []) {
  const targetSql = normalizeSql(sql, activeEngine);

  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(targetSql, params);
      return rows;
    } catch (err) {
      // محاولة تنفيذ استعلام احتياطي على SQLite إذا فشل اتصال MySQL فجأة
      if (sqliteDb && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST')) {
        console.warn('MySQL connection lost, fallback query to SQLite:', err.message);
        return sqliteDb.prepare(normalizeSql(sql, 'sqlite')).all(...params);
      }
      throw err;
    }
  }

  initSqliteInstance();
  return sqliteDb.prepare(targetSql).all(...params);
}

/**
 * استعلام يعيد سجلاً واحداً (أو null)
 */
async function get(sql, params = []) {
  const targetSql = normalizeSql(sql, activeEngine);

  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(targetSql, params);
      return (rows && rows.length > 0) ? rows[0] : null;
    } catch (err) {
      if (sqliteDb && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST')) {
        return sqliteDb.prepare(normalizeSql(sql, 'sqlite')).get(...params) || null;
      }
      throw err;
    }
  }

  initSqliteInstance();
  return sqliteDb.prepare(targetSql).get(...params) || null;
}

/**
 * تنفيذ جمل INSERT / UPDATE / DELETE
 * يعيد كائناً موحداً يحتوي { lastInsertRowid, insertId, changes, affectedRows }
 */
async function run(sql, params = []) {
  const targetSql = normalizeSql(sql, activeEngine);

  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      const [result] = await mysqlPool.query(targetSql, params);
      return {
        lastInsertRowid: result.insertId,
        insertId: result.insertId,
        lastID: result.insertId,
        changes: result.affectedRows,
        affectedRows: result.affectedRows
      };
    } catch (err) {
      if (sqliteDb && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST')) {
        const res = sqliteDb.prepare(normalizeSql(sql, 'sqlite')).run(...params);
        return {
          lastInsertRowid: res.lastInsertRowid,
          insertId: res.lastInsertRowid,
          lastID: res.lastInsertRowid,
          changes: res.changes,
          affectedRows: res.changes
        };
      }
      throw err;
    }
  }

  initSqliteInstance();
  const res = sqliteDb.prepare(targetSql).run(...params);
  return {
    id: res.lastInsertRowid,
    lastInsertRowid: res.lastInsertRowid,
    insertId: res.lastInsertRowid,
    lastID: res.lastInsertRowid,
    changes: res.changes,
    affectedRows: res.changes
  };
}

/**
 * تنفيذ سكربت أو مجموعة استعلامات نصية
 */
async function exec(sql) {
  const targetSql = normalizeSql(sql, activeEngine);
  if (activeEngine === 'mysql' && mysqlPool) {
    return mysqlPool.query(targetSql);
  }
  initSqliteInstance();
  return sqliteDb.exec(targetSql);
}

/**
 * تنفيذ معاملة مالية ذرية (Atomic Transaction) تدعم كلاً من MySQL و SQLite
 */
async function transaction(callback) {
  if (activeEngine === 'mysql' && mysqlPool) {
    const connection = await mysqlPool.getConnection();
    await connection.beginTransaction();
    try {
      // توفير دوال تنفيذ محلية تابعة لنفس الاتصال المعزول
      const tx = {
        query: async (sql, params = []) => {
          const [rows] = await connection.query(normalizeSql(sql, 'mysql'), params);
          return rows;
        },
        get: async (sql, params = []) => {
          const [rows] = await connection.query(normalizeSql(sql, 'mysql'), params);
          return (rows && rows.length > 0) ? rows[0] : null;
        },
        run: async (sql, params = []) => {
          const [res] = await connection.query(normalizeSql(sql, 'mysql'), params);
          return {
            lastInsertRowid: res.insertId,
            insertId: res.insertId,
            changes: res.affectedRows,
            affectedRows: res.affectedRows
          };
        }
      };

      const result = await callback(tx);
      await connection.commit();
      return result;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // في حالة SQLite
  initSqliteInstance();
  sqliteDb.exec('BEGIN TRANSACTION;');
  try {
    const tx = {
      query: async (sql, params = []) => sqliteDb.prepare(normalizeSql(sql, 'sqlite')).all(...params),
      get: async (sql, params = []) => sqliteDb.prepare(normalizeSql(sql, 'sqlite')).get(...params) || null,
      run: async (sql, params = []) => {
        const res = sqliteDb.prepare(normalizeSql(sql, 'sqlite')).run(...params);
        return {
          lastInsertRowid: res.lastInsertRowid,
          insertId: res.lastInsertRowid,
          changes: res.changes,
          affectedRows: res.changes
        };
      }
    };
    const result = await callback(tx);
    sqliteDb.exec('COMMIT;');
    return result;
  } catch (err) {
    sqliteDb.exec('ROLLBACK;');
    throw err;
  }
}

// =================== دوال النسخ الاحتياطي وإدارة السيرفر ===================

function backupDatabase() {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `backup_rawasi_${timestamp}.db`;
  const backupFilePath = path.join(backupsDir, backupFileName);
  if (fs.existsSync(sqlitePath)) {
    fs.copyFileSync(sqlitePath, backupFilePath);
  }
  return { fileName: backupFileName, filePath: backupFilePath };
}

function restoreDatabase(sourceFilePathOrBuffer) {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyBackupPath = path.join(backupsDir, `safety_before_restore_${timestamp}.db`);
  if (fs.existsSync(sqlitePath)) {
    fs.copyFileSync(sqlitePath, safetyBackupPath);
  }

  try {
    if (sqliteDb) {
      try { sqliteDb.close(); } catch {}
      sqliteDb = null;
    }

    if (Buffer.isBuffer(sourceFilePathOrBuffer)) {
      fs.writeFileSync(sqlitePath, sourceFilePathOrBuffer);
    } else if (typeof sourceFilePathOrBuffer === 'string') {
      fs.copyFileSync(sourceFilePathOrBuffer, sqlitePath);
    }

    initSqliteInstance();
    return {
      success: true,
      message: 'تمت استعادة نسخة قاعدة البيانات بنجاح'
    };
  } catch (err) {
    if (fs.existsSync(safetyBackupPath)) {
      fs.copyFileSync(safetyBackupPath, sqlitePath);
      initSqliteInstance();
    }
    throw err;
  }
}

function listBackups() {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) return [];
  const files = fs.readdirSync(backupsDir);
  const backups = [];
  files.forEach(file => {
    if (file.endsWith('.db') || file.endsWith('.sqlite') || file.endsWith('.sql')) {
      const filePath = path.join(backupsDir, file);
      const stat = fs.statSync(filePath);
      backups.push({
        fileName: file,
        size: stat.size,
        createdAt: stat.mtime
      });
    }
  });
  return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function createLogoutBackup(username = 'unknown', meta = {}) {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  if (sqliteDb) {
    try { sqliteDb.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
  }

  const safeUser = String(username || 'user').replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_');
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const backupFileName = `backup_logout_${safeUser}_${dateStr}.db`;
  const backupFilePath = path.join(backupsDir, backupFileName);

  if (fs.existsSync(sqlitePath)) {
    fs.copyFileSync(sqlitePath, backupFilePath);
  }

  const stat = fs.existsSync(backupFilePath) ? fs.statSync(backupFilePath) : { size: 0 };
  const backupItem = {
    fileName: backupFileName,
    filePath: backupFilePath,
    username: username || 'مستخدم',
    timestamp: now.toISOString(),
    displayTime: now.toLocaleString('ar-YE'),
    size: stat.size,
    mode: meta.mode || activeEngine,
    engine: activeEngine,
    notes: meta.notes || 'نسخة تلقائية تم إنشاؤها فور تسجيل الخروج'
  };

  return backupItem;
}

function listLogoutBackups() {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) return [];
  const files = fs.readdirSync(backupsDir);
  const list = [];
  files.forEach(f => {
    if (f.startsWith('backup_logout_')) {
      const p = path.join(backupsDir, f);
      const stat = fs.statSync(p);
      list.push({
        fileName: f,
        filePath: p,
        timestamp: stat.mtime.toISOString(),
        displayTime: new Date(stat.mtime).toLocaleString('ar-YE'),
        size: stat.size,
        engine: activeEngine
      });
    }
  });
  return list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function getActiveEngine() {
  return activeEngine;
}

function getMysqlConfig() {
  return appConfig.mysql;
}

module.exports = {
  db: sqliteDb,
  mysqlPool,
  query,
  get,
  run,
  exec,
  transaction,
  initializeDatabase,
  backupDatabase,
  restoreDatabase,
  listBackups,
  createLogoutBackup,
  listLogoutBackups,
  getActiveEngine,
  getMysqlConfig,
  connectionManager,
  dbPath: sqlitePath
};
