/**
 * مولد ملفات ترحيل ودليل الحسابات الشجري - شركة رواسي عدن
 */
const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, '..', 'server', 'database', 'standard_chart_of_accounts.json');
const accounts = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

let sql = '';
sql += '-- ============================================================================\n';
sql += '-- نظام شركة رواسي عدن للهندسة والمقاولات\n';
sql += '-- ملف ترحيل واستيراد دليل الحسابات الشجري الموحد (112 حساباً معيارياً)\n';
sql += '-- متوافق مع معايير المحاسبة الدولية (IFRS) وقواعد بيانات SQLite و MySQL\n';
sql += '-- ============================================================================\n\n';

sql += '-- 1. تنظيف جداول مؤقتة إن وجدت\n';
sql += 'DROP TABLE IF EXISTS accounts_import;\n\n';

sql += '-- 2. إنشاء جدول الحسابات بالبنية الهرمية المعيارية الجديدة\n';
sql += 'CREATE TABLE IF NOT EXISTS accounts (\n';
sql += '    id INTEGER PRIMARY KEY AUTOINCREMENT,\n';
sql += '    code VARCHAR(20) NOT NULL UNIQUE,\n';
sql += '    name VARCHAR(200) NOT NULL,\n';
sql += '    type VARCHAR(30) NOT NULL,\n';
sql += '    parent_code VARCHAR(20) NULL,\n';
sql += '    parent_id INTEGER NULL,\n';
sql += '    level INTEGER NOT NULL,\n';
sql += '    is_posting BOOLEAN NOT NULL DEFAULT 0,\n';
sql += '    currencies TEXT DEFAULT \'YER\',\n';
sql += '    report_type VARCHAR(50) NOT NULL,\n';
sql += '    inclusion TEXT NULL DEFAULT \'=\',\n';
sql += '    is_contra BOOLEAN NOT NULL DEFAULT 0,\n';
sql += '    is_active BOOLEAN NOT NULL DEFAULT 1,\n';
sql += '    balance REAL DEFAULT 0,\n';
sql += '    status VARCHAR(20) DEFAULT \'active\',\n';
sql += '    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n';
sql += '    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP\n';
sql += ');\n\n';

sql += '-- 3. إنشاء الفهارس لتسريع الاستعلامات الشجرية والتقارير المالية\n';
sql += 'CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_code ON accounts (code);\n';
sql += 'CREATE INDEX IF NOT EXISTS idx_accounts_parent_code ON accounts (parent_code);\n';
sql += 'CREATE INDEX IF NOT EXISTS idx_accounts_parent_id ON accounts (parent_id);\n';
sql += 'CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts (type);\n';
sql += 'CREATE INDEX IF NOT EXISTS idx_accounts_is_posting ON accounts (is_posting);\n';
sql += 'CREATE INDEX IF NOT EXISTS idx_accounts_level ON accounts (level);\n';
sql += 'CREATE INDEX IF NOT EXISTS idx_accounts_report_type ON accounts (report_type);\n\n';

sql += '-- 4. إدراج جميع الحسابات المعيارية بالترتيب الهرمي (المستويات 1 إلى 5)\n';
sql += 'BEGIN TRANSACTION;\n\n';

accounts.forEach(acc => {
  const pCode = acc.parent_code ? `'${acc.parent_code}'` : 'NULL';
  const nameSafe = acc.name.replace(/'/g, "''");
  const incSafe = (acc.inclusion || '=').replace(/'/g, "''");
  sql += `INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)\n`;
  sql += `VALUES ('${acc.code}', '${nameSafe}', '${acc.type}', ${pCode}, ${acc.level}, ${acc.is_posting}, '${acc.currencies}', '${acc.report_type}', '${incSafe}', ${acc.is_contra}, 1, 'active');\n`;
});

sql += '\n-- 5. تحديث parent_id استناداً إلى parent_code لربط المعرفات الرقمية\n';
sql += 'UPDATE accounts\n';
sql += 'SET parent_id = (SELECT p.id FROM accounts p WHERE p.code = accounts.parent_code)\n';
sql += 'WHERE parent_code IS NOT NULL;\n\n';

sql += 'COMMIT;\n\n';

sql += '-- ============================================================================\n';
sql += '-- 6. استعلامات التحقق الإحصائي وصحة البنية الهرمية\n';
sql += '-- ============================================================================\n\n';

sql += '-- 1. إجمالي الحسابات المسجلة (المتوقع: 112 حساباً)\n';
sql += 'SELECT COUNT(*) as total_accounts FROM accounts;\n\n';

sql += '-- 2. توزيع الحسابات حسب المستويات الهرمية (1 إلى 5)\n';
sql += 'SELECT level, COUNT(*) as count FROM accounts GROUP BY level ORDER BY level;\n\n';

sql += '-- 3. عدد الحسابات القابلة للترحيل وقبول القيود والسندات (Level 5)\n';
sql += 'SELECT COUNT(*) as posting_accounts FROM accounts WHERE is_posting = 1;\n\n';

sql += '-- 4. توزيع الحسابات حسب التصنيف المحاسبي المعتمد (IFRS)\n';
sql += 'SELECT type, COUNT(*) as count FROM accounts GROUP BY type ORDER BY count DESC;\n\n';

sql += '-- 5. التحقق الصارم: عدم وجود أي حساب فرعي بدون أب\n';
sql += 'SELECT child.code, child.name \n';
sql += 'FROM accounts child\n';
sql += 'LEFT JOIN accounts parent ON child.parent_code = parent.code\n';
sql += 'WHERE child.parent_code IS NOT NULL AND parent.id IS NULL;\n\n';

sql += '-- 6. التحقق الصارم: التأكد من أن الحسابات القابلة للترحيل (is_posting=1) هي حسابات طرفية ليس لها أبناء\n';
sql += 'SELECT a.code, a.name, COUNT(c.id) as children_count\n';
sql += 'FROM accounts a\n';
sql += 'LEFT JOIN accounts c ON c.parent_code = a.code\n';
sql += 'WHERE a.is_posting = 1 AND c.id IS NOT NULL\n';
sql += 'GROUP BY a.id;\n\n';

sql += '-- 7. توزيع العملات على الحسابات\n';
sql += 'SELECT currencies, COUNT(*) as accounts_count FROM accounts GROUP BY currencies;\n';

fs.writeFileSync(path.join(__dirname, '..', 'migration_chart_of_accounts.sql'), sql, 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'server', 'database', 'migration_chart_of_accounts.sql'), sql, 'utf8');
console.log('Migration SQL generated successfully! File size:', sql.length, 'bytes');
