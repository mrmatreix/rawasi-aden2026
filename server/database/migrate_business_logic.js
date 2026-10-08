/**
 * سكريبت هجرة وتحديث قاعدة البيانات لتطبيق قواعد منطق الأعمال:
 * 1. جدول الفترات المحاسبية (accounting_periods)
 * 2. جدول سجل التدقيق والرقابة (audit_logs)
 * 3. حقول التأمينات والضرائب في جدول مسير الرواتب (payroll)
 * 4. الحسابات المالية النظامية للتأمينات والضرائب في شجرة الحسابات (accounts)
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, 'rawasi_aden.db');
console.log('🔄 جاري تطبيق هجرة منطق الأعمال على قاعدة البيانات:', dbPath);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

try {
  // 1. جدول الفترات المحاسبية وإغلاق الحسابات
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_name TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT DEFAULT 'open', -- 'open' | 'closed'
      closed_at DATETIME NULL,
      closed_by TEXT NULL,
      reopened_at DATETIME NULL,
      reopened_by TEXT NULL,
      reopen_reason TEXT NULL,
      notes TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✓ تم إنشاء/التحقق من جدول الفترات المحاسبية (accounting_periods)');

  // إدراج الفترات المحاسبية التأسيسية إذا كان الجدول فارغاً
  const periodCount = db.prepare('SELECT COUNT(*) as cnt FROM accounting_periods').get().cnt;
  if (periodCount === 0) {
    const insertPeriod = db.prepare(`
      INSERT INTO accounting_periods (period_name, fiscal_year, start_date, end_date, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertPeriod.run('السنة المالية 2024', 2024, '2024-01-01', '2024-12-31', 'closed', 'تم إغلاق وتدقيق السنة المالية 2024');
    insertPeriod.run('الربع الأول 2025', 2025, '2025-01-01', '2025-03-31', 'open', 'الفترة الحالية قيد العمل');
    insertPeriod.run('الربع الثاني 2025', 2025, '2025-04-01', '2025-06-30', 'open', 'فترة مفتوحة');
    insertPeriod.run('الربع الثالث 2025', 2025, '2025-07-01', '2025-09-30', 'open', 'فترة مفتوحة');
    insertPeriod.run('الربع الرابع 2025', 2025, '2025-10-01', '2025-12-31', 'open', 'فترة مفتوحة');
    console.log('✓ تم تأسيس الفترات المحاسبية الافتراضية');
  }

  // 2. جدول سجل التدقيق والرقابة (Audit Log)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE', 'CLOSE_PERIOD', 'REOPEN_PERIOD', 'POST_PAYROLL'
      entity_type TEXT NOT NULL, -- 'journal_entry', 'payment', 'expense', 'custody', 'payroll', 'project', 'period'
      entity_id TEXT NULL,
      details TEXT NULL,
      ip_address TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✓ تم إنشاء/التحقق من جدول سجل التدقيق المالي (audit_logs)');

  // 3. إضافة حقول التأمينات والضرائب في جدول مسير الرواتب (payroll) إن لم تكن موجودة
  const payrollCols = db.prepare("PRAGMA table_info(payroll)").all().map(c => c.name);
  const newPayrollCols = [
    { name: 'allowances', type: 'REAL DEFAULT 0' },
    { name: 'insurance_employee', type: 'REAL DEFAULT 0' },
    { name: 'insurance_employer', type: 'REAL DEFAULT 0' },
    { name: 'tax_amount', type: 'REAL DEFAULT 0' },
    { name: 'gross_salary', type: 'REAL DEFAULT 0' }
  ];

  for (const col of newPayrollCols) {
    if (!payrollCols.includes(col.name)) {
      db.exec(`ALTER TABLE payroll ADD COLUMN ${col.name} ${col.type};`);
      console.log(`✓ تم إضافة العمود ${col.name} إلى جدول الرواتب payroll`);
    }
  }

  // 4. التأكد من وجود الحسابات المحاسبية النظامية للتأمينات والضرائب وسلف الموظفين
  const accountsToAdd = [
    { code: '114', name: 'سلف وعهد الموظفين', type: 'أصول', parent_code: '11' },
    { code: '213', name: 'أمانات مصلحة الضرائب (ضريبة كسب العمل)', type: 'خصوم', parent_code: '2' },
    { code: '214', name: 'الهيئة العامة للتأمينات والمعاشات', type: 'خصوم', parent_code: '2' },
    { code: '511', name: 'مصروف الرواتب والأجور الأساسية والبدلات', type: 'مصروفات', parent_code: '5' },
    { code: '512', name: 'مصروف مساهمة الشركة في التأمينات الاجتماعية', type: 'مصروفات', parent_code: '5' }
  ];

  const checkAccount = db.prepare('SELECT id FROM accounts WHERE code = ?');
  const getParent = db.prepare('SELECT id FROM accounts WHERE code = ?');
  const insertAccount = db.prepare(`
    INSERT INTO accounts (code, name, type, parent_id, balance)
    VALUES (?, ?, ?, ?, 0)
  `);

  for (const acc of accountsToAdd) {
    const exists = checkAccount.get(acc.code);
    if (!exists) {
      const parent = getParent.get(acc.parent_code);
      const parentId = parent ? parent.id : null;
      insertAccount.run(acc.code, acc.name, acc.type, parentId);
      console.log(`✓ تم إدراج الحساب المالي النظامي: [${acc.code}] ${acc.name}`);
    }
  }

  // 5. إنشاء مشغل (Trigger) على قاعدة البيانات لمنع إدراج أو تعديل أي قيد غير متزن إطلاقاً
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_insert
    BEFORE INSERT ON journal_entries
    BEGIN
      SELECT CASE 
        WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
        THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن حفظ قيد غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
      END;
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_update
    BEFORE UPDATE ON journal_entries
    BEGIN
      SELECT CASE 
        WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
        THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن تحديث قيد ليصبح غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
      END;
    END;
  `);
  console.log('✓ تم إنشاء مشغلات حماية التوازن المحاسبي (Balance Enforcement Triggers)');

  console.log('✅ اكتملت هجرة قاعدة البيانات لقواعد منطق الأعمال بنجاح 100%!');

} catch (err) {
  console.error('❌ خطأ أثناء تطبيق الهجرة:', err);
  process.exit(1);
}
