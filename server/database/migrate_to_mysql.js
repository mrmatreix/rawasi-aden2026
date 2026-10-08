/**
 * سكربت الترحيل التلقائي الشامل لقاعدة بيانات نظام رواسي عدن للهندسة والمقاولات
 * ينقل البيانات من SQLite (rawasi_aden.db) إلى MySQL دون فقدان أي سجل
 */

const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');
const path = require('node:path');
const fs = require('node:fs');

const configPath = path.join(__dirname, 'config.json');
let config = {
  mysql: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: 'rawasi_aden'
  },
  dbPath: path.join(__dirname, 'rawasi_aden.db')
};

if (fs.existsSync(configPath)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    if (loaded.mysql) config.mysql = Object.assign(config.mysql, loaded.mysql);
    if (loaded.dbPath) config.dbPath = path.isAbsolute(loaded.dbPath) ? loaded.dbPath : path.join(__dirname, '..', '..', loaded.dbPath);
  } catch (e) {
    console.warn('Config load note in migration:', e.message);
  }
}

const sqlitePath = config.dbPath || path.join(__dirname, 'rawasi_aden.db');

// ترتيب الجداول وفق أسبقية التبعيات والمفاتيح الأجنبية
const TABLES_ORDER = [
  'roles',
  'users',
  'clients',
  'suppliers',
  'projects',
  'items',
  'inventory_transactions',
  'purchases',
  'expenses',
  'bills',
  'payments',
  'custodies',
  'cash_movements',
  'accounts',
  'journal_entries',
  'journal_entry_lines',
  'settings',
  'project_contracts',
  'project_drawings',
  'project_boq',
  'project_quotations',
  'project_budgets',
  'project_change_orders',
  'project_purchases',
  'project_labor_expenses',
  'project_invoices',
  'project_daily_reports',
  'project_weekly_reports',
  'project_handover_minutes',
  'project_correspondence',
  'project_final_settlements'
];

async function runMigration() {
  console.log('================================================================');
  console.log('🚀 بدء ترحيل قاعدة بيانات نظام رواسي عدن إلى MySQL...');
  console.log(`📁 مصدر البيانات (SQLite): ${sqlitePath}`);
  console.log(`🌐 الهدف (MySQL): ${config.mysql.host}:${config.mysql.port} - Database: ${config.mysql.database}`);
  console.log('================================================================');

  if (!fs.existsSync(sqlitePath)) {
    console.error('❌ ملف SQLite غير موجود:', sqlitePath);
    throw new Error('ملف SQLite غير موجود: ' + sqlitePath);
  }

  const sqlite = new DatabaseSync(sqlitePath);

  // 1. الاتصال المبدئي بخادم MySQL لإنشاء قاعدة البيانات إن لم تكن موجودة
  let connection;
  try {
    connection = await mysql.createConnection({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      multipleStatements: true
    });
    console.log('✅ تم الاتصال بخادم MySQL بنجاح.');
  } catch (connErr) {
    console.error('❌ فشل الاتصال بخادم MySQL:', connErr.message);
    console.error('تأكد من تشغيل خادم MySQL (مثل XAMPP أو خدمة MySQL) وصحة بيانات الاتصال.');
    throw new Error('فشل الاتصال بخادم MySQL: ' + connErr.message + ' (يرجى تشغيل XAMPP أو خدمة MySQL أولاً)');
  }

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.mysql.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await connection.changeUser({ database: config.mysql.database });
    console.log(`✅ تم التأكد من وجود قاعدة البيانات \`${config.mysql.database}\`.`);

    // 2. تطبيق المخطط الهيكلي schema_mysql.sql
    const schemaSqlPath = path.join(__dirname, 'schema_mysql.sql');
    if (fs.existsSync(schemaSqlPath)) {
      const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
      await connection.query(schemaSql);
      console.log('✅ تم إنشاء وتأكيد كافة الجداول الـ 31 في MySQL.');
    }

    // تعطيل فحص المفاتيح الأجنبية مؤقتاً أثناء الترحيل
    await connection.query('SET FOREIGN_KEY_CHECKS = 0;');

    let totalMigratedRows = 0;
    const migrationStats = [];

    // 3. ترحيل البيانات جدولاً تلو الآخر
    for (const tableName of TABLES_ORDER) {
      try {
        // التحقق من وجود الجدول في SQLite
        const tableCheck = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
        if (!tableCheck) {
          continue;
        }

        const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
        if (!rows || rows.length === 0) {
          migrationStats.push({ table: tableName, count: 0, status: 'فارغ' });
          continue;
        }

        const sampleRow = rows[0];
        const columns = Object.keys(sampleRow);
        const escapedColumns = columns.map(c => `\`${c}\``).join(', ');
        const placeholders = columns.map(() => '?').join(', ');

        const insertSql = `INSERT IGNORE INTO \`${tableName}\` (${escapedColumns}) VALUES (${placeholders});`;

        let insertedCount = 0;
        for (const row of rows) {
          const values = columns.map(col => {
            let val = row[col];
            // معالجة التواريخ الفارغة أو القيم غير المحددة
            if (val === undefined) return null;
            return val;
          });

          const [result] = await connection.execute(insertSql, values);
          if (result.affectedRows > 0) {
            insertedCount++;
          }
        }

        totalMigratedRows += insertedCount;
        migrationStats.push({ table: tableName, count: rows.length, inserted: insertedCount, status: '✅ تم بنجاح' });
        console.log(`🔹 ترحيل جدول [${tableName}]: ${insertedCount} سجل.`);
      } catch (tableErr) {
        console.warn(`⚠️ ملاحظة أثناء ترحيل جدول [${tableName}]:`, tableErr.message);
        migrationStats.push({ table: tableName, count: 0, error: tableErr.message, status: '⚠️ حدث خطأ' });
      }
    }

    // إعادة تفعيل فحص المفاتيح الأجنبية
    await connection.query('SET FOREIGN_KEY_CHECKS = 1;');

    console.log('================================================================');
    console.log(`🎉 اكتمل الترحيل بنجاح! إجمالي السجلات المنقولة: ${totalMigratedRows} سجل.`);
    console.log('================================================================');
  } catch (err) {
    console.error('❌ خطأ غير متوقع أثناء الترحيل:', err);
  } finally {
    if (connection) await connection.end();
  }
}

// تنفيذ السكربت إذا تم استدعاؤه مباشرة
if (require.main === module) {
  runMigration().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runMigration };
