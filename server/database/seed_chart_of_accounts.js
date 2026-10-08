/**
 * ============================================================================
 * نظام شركة رواسي عدن للهندسة والمقاولات
 * سكريبت Node.js الشامل لاستيراد دليل الحسابات من ملف Excel إلى SQLite / MySQL
 * ============================================================================
 *
 * الأعمدة المقروءة من ملف الإكسل (8 أعمدة):
 * A. رقم الحساب (فريد، هرمي)
 * B. العملة (YER/SAR/USD)
 * C. اسم الحساب (بالعربي)
 * D. المستوى (1-5)
 * E. النوع (رئيسي/فرعي)
 * F. الحساب الرئيسي (كود الأب أو 0)
 * G. التضمين (= أو اسم الفئة)
 * H. نوع التقرير (ميزانية عمومية / قائمة الدخل)
 *
 * القواعد والتصحيحات المطبقة:
 * 1. المستوى 1: 1 رقم (1, 2, 3, 4)
 * 2. المستوى 2: 2 أرقام (11, 12, 21, ...)
 * 3. المستوى 3: 3 أرقام (111, 121, ...)
 * 4. المستوى 4: 5 أرقام (11101, 12101, ...)
 * 5. المستوى 5: 8 أرقام (11101001, ...) -> فقط Level 5 (فرعي) يقبل قيود (is_posting=1)
 *
 * التصحيحات المحاسبية وفق IFRS:
 * - 211 (حقوق الملكية) ومشتقاتها -> type = 'equity' (ميزانية عمومية) بدلاً من liability
 * - 21103 (مجمعات الإهلاك) -> type = 'asset' مع is_contra = 1 (تخصم من الأصول الثابتة)
 * - الحساب الرئيسي 0 -> يُخزن كـ NULL
 * - تصحيح الأخطاء اللغوية: الاهكلاكات -> الإهلاكات | مصاريف التاسيس -> مصاريف التأسيس
 *
 * الاستخدام:
 *   node seed_chart_of_accounts.js [مسار_ملف_الاكسل]
 *   npm run seed:coa
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { query, run, get, transaction, getActiveEngine } = require('./server/database/db');

/**
 * تحديد مسار ملف Excel المصدري
 */
function findExcelFilePath() {
  const cliArg = process.argv[2];
  if (cliArg && fs.existsSync(cliArg)) {
    return path.resolve(cliArg);
  }

  const searchCandidates = [
    path.join(__dirname, 'chart_of_accounts.xlsx'),
    path.join(__dirname, 'دليل حسابات .xlsx'),
    'C:/Users/a.ba3baid/Desktop/سالم/دليل حسابات .xlsx',
    path.join(__dirname, 'server', 'database', 'standard_chart_of_accounts.json')
  ];

  for (const candidate of searchCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('❌ لم يتم العثور على ملف Excel المصدري لدليل الحسابات في المسارات المعتمدة!');
}

/**
 * قراءة وتجهيز وتصحيح بيانات الحسابات من ملف Excel
 */
function parseAndCleanExcel(filePath) {
  console.log(`📖 [Excel Loader] جاري قراءة ملف دليل الحسابات من: ${filePath}`);

  // في حال كان ملف JSON احتياطي
  if (filePath.endsWith('.json')) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }

  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet);

  if (!rawRows || rawRows.length === 0) {
    throw new Error('❌ ورقة عمل Excel فارغة أو لا تحتوي على صفوف صالحة!');
  }

  console.log(`📊 [Excel Loader] تم العثور على ${rawRows.length} صفاً في ورقة العمل [${firstSheetName}].`);

  const accounts = rawRows.map((row, index) => {
    // 1. رقم الحساب
    const rawCode = row['رقم الحساب'] !== undefined ? String(row['رقم الحساب']).trim() : '';
    if (!rawCode) {
      throw new Error(`الصف ${index + 2} لا يحتوي على رقم حساب!`);
    }

    // 2. اسم الحساب والتصحيحات الإملائية
    let name = String(row['اسم الحساب'] || '').trim();
    if (name.includes('الاهكلاكات')) name = name.replace(/الاهكلاكات/g, 'الإهلاكات');
    if (name.includes('مجمعات الاهلاك')) name = 'مجمعات الإهلاك';
    if (name.includes('مصاريف التاسيس')) name = 'مصاريف التأسيس';
    if (rawCode === '11301' && name.includes('الغير متداوله')) name = 'الأصول غير المتداولة';
    if (rawCode === '113' && name.includes('الاصول غير المتداوله')) name = 'الأصول غير المتداولة';

    // 3. المستوى والرتبة الهرمية
    const level = Number(row['المستوى']);
    if (isNaN(level) || level < 1 || level > 5) {
      throw new Error(`الصف ${index + 2} (كود ${rawCode}): المستوى غير صالح (${row['المستوى']})!`);
    }

    // 4. النوع وقبول الترحيل والقيود
    // فقط Level 5 (النوع="فرعي") يقبل قيود محاسبية مباشرة
    const is_posting = (level === 5 || String(row['النوع']).trim() === 'فرعي') ? 1 : 0;

    // 5. الحساب الرئيسي (كود الأب)
    const rawParent = String(row['الحساب الرئيسي'] !== undefined ? row['الحساب الرئيسي'] : '').trim();
    const isRoot = (rawParent === '0' || rawParent === '' || ['1', '2', '3', '4'].includes(rawCode));
    const parent_code = isRoot ? null : rawParent;

    // 6. التصنيف المحاسبي وفق معايير IFRS
    let type = '';
    let is_contra = 0;
    let report_type = 'balance_sheet';

    if (rawCode.startsWith('21103')) {
      // مجمعات الإهلاك: Contra-Asset تخصم من الأصول الثابتة
      type = 'asset';
      is_contra = 1;
      report_type = 'balance_sheet';
    } else if (rawCode.startsWith('211')) {
      // حقوق الملكية (رأس المال، الاحتياطيات، الأرباح والخسائر)
      type = 'equity';
      report_type = 'balance_sheet';
    } else if (rawCode.startsWith('1')) {
      type = 'asset';
      report_type = 'balance_sheet';
    } else if (rawCode.startsWith('2')) {
      type = 'liability';
      report_type = 'balance_sheet';
    } else if (rawCode.startsWith('3')) {
      type = 'expense';
      report_type = 'income_statement';
    } else if (rawCode.startsWith('4')) {
      type = 'revenue';
      report_type = 'income_statement';
    }

    // توافق إضافي مع عمود نوع التقرير
    const rawReport = String(row['نوع التقرير'] || '').trim();
    if (rawReport.includes('دخل') || rawReport.includes('أرباح')) {
      report_type = 'income_statement';
    } else if (rawReport.includes('ميزانية')) {
      report_type = 'balance_sheet';
    }

    // 7. العملات المدعومة
    let rawCurr = String(row['العملة'] || '').replace(/,\s*$/, '').trim();
    let currList = rawCurr.split(',').map(c => c.trim()).filter(Boolean);
    if (currList.length === 0) currList = ['YER'];

    // إضافة عملات SAR/USD للحسابات الحيوية
    if (['12201002', '21101001', '41101001', '41203002'].includes(rawCode)) {
      ['YER', 'SAR', 'USD'].forEach(c => {
        if (!currList.includes(c)) currList.push(c);
      });
    }
    const currencies = currList.join(',');

    // 8. التضمين
    const inclusion = String(row['التضمين'] || '=').trim();

    return {
      code: rawCode,
      name,
      type,
      parent_code,
      level,
      is_posting,
      currencies,
      report_type,
      inclusion,
      is_contra,
      is_active: 1
    };
  });

  // حفظ نسخة JSON متزامنة
  const jsonDest = path.join(__dirname, 'server', 'database', 'standard_chart_of_accounts.json');
  fs.writeFileSync(jsonDest, JSON.stringify(accounts, null, 2), 'utf8');

  return accounts;
}

/**
 * التأكد من وجود وتحديث جدول accounts ليدعم جميع الحقول المعيارية والفهارس
 */
async function ensureAccountsSchema(tx) {
  const engine = getActiveEngine();
  console.log(`🔧 [Schema Setup] ضبط مخطط جدول الحسابات accounts على محرك [${engine}]...`);

  if (engine === 'mysql') {
    await tx.run(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(30) NOT NULL,
        parent_code VARCHAR(20) NULL,
        parent_id INT NULL,
        level INT NOT NULL,
        is_posting TINYINT(1) NOT NULL DEFAULT 0,
        currencies TEXT NULL,
        report_type VARCHAR(50) NOT NULL,
        inclusion TEXT NULL,
        is_contra TINYINT(1) NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        balance DECIMAL(18, 4) DEFAULT 0.0000,
        status VARCHAR(20) DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_accounts_parent_code (parent_code),
        INDEX idx_accounts_parent_id (parent_id),
        INDEX idx_accounts_type (type),
        INDEX idx_accounts_is_posting (is_posting),
        INDEX idx_accounts_level (level),
        INDEX idx_accounts_report_type (report_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const cols = await tx.query("SHOW COLUMNS FROM accounts");
    const colNames = cols.map(c => c.Field);
    const addCol = async (col, def) => {
      if (!colNames.includes(col)) {
        await tx.run(`ALTER TABLE accounts ADD COLUMN ${col} ${def}`);
      }
    };
    await addCol('parent_code', 'VARCHAR(20) NULL');
    await addCol('parent_id', 'INT NULL');
    await addCol('is_posting', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addCol('currencies', 'TEXT NULL');
    await addCol('report_type', "VARCHAR(50) NOT NULL DEFAULT 'balance_sheet'");
    await addCol('inclusion', 'TEXT NULL');
    await addCol('is_contra', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addCol('is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
    await addCol('status', "VARCHAR(20) DEFAULT 'active'");
    await addCol('level', 'INT DEFAULT 1');
    await addCol('updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  } else {
    // محرك SQLite
    await tx.run(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        parent_code TEXT NULL,
        parent_id INTEGER NULL REFERENCES accounts(id),
        level INTEGER NOT NULL,
        is_posting INTEGER NOT NULL DEFAULT 0,
        currencies TEXT DEFAULT 'YER',
        report_type TEXT NOT NULL,
        inclusion TEXT NULL DEFAULT '=',
        is_contra INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        balance REAL DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const cols = await tx.query("PRAGMA table_info(accounts)");
    const colNames = cols.map(c => c.name);
    const addCol = async (col, def) => {
      if (!colNames.includes(col)) {
        await tx.run(`ALTER TABLE accounts ADD COLUMN ${col} ${def}`);
      }
    };
    await addCol('parent_code', 'TEXT');
    await addCol('parent_id', 'INTEGER REFERENCES accounts(id)');
    await addCol('is_posting', 'INTEGER DEFAULT 0');
    await addCol('currencies', "TEXT DEFAULT 'YER'");
    await addCol('report_type', "TEXT DEFAULT 'balance_sheet'");
    await addCol('inclusion', "TEXT DEFAULT '='");
    await addCol('is_contra', 'INTEGER DEFAULT 0');
    await addCol('is_active', 'INTEGER DEFAULT 1');
    await addCol('status', "TEXT DEFAULT 'active'");
    await addCol('level', 'INTEGER DEFAULT 1');
    await addCol('updated_at', 'DATETIME');

    // إنشاء الفهارس
    await tx.run('CREATE INDEX IF NOT EXISTS idx_accounts_parent_code ON accounts(parent_code);');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_accounts_parent_id ON accounts(parent_id);');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_accounts_is_posting ON accounts(is_posting);');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_accounts_level ON accounts(level);');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_accounts_report_type ON accounts(report_type);');
  }
}

/**
 * دالة التحقق البرمجي السريع أثناء الاستيراد (Pre-Import & Post-Import Validation)
 */
function validateTreeDataInMemory(accounts) {
  console.log('🧪 [Pre-Check] فحص الاتساق الهيكلي لبيانات الإكسل...');
  const codes = new Set();
  const duplicateCodes = [];
  const levelLengthErrors = [];

  accounts.forEach(acc => {
    // 1. فرادة الأكواد
    if (codes.has(acc.code)) duplicateCodes.push(acc.code);
    codes.add(acc.code);

    // 2. مطابقة طول الكود مع المستوى
    const len = acc.code.length;
    let expected = 0;
    if (acc.level === 1) expected = 1;
    else if (acc.level === 2) expected = 2;
    else if (acc.level === 3) expected = 3;
    else if (acc.level === 4) expected = 5;
    else if (acc.level === 5) expected = 8;

    if (expected > 0 && len !== expected) {
      levelLengthErrors.push({ code: acc.code, level: acc.level, actualLen: len, expected });
    }
  });

  if (duplicateCodes.length > 0) {
    throw new Error(`❌ توجد أكواد مكررة في الملف: ${duplicateCodes.join(', ')}`);
  }

  if (levelLengthErrors.length > 0) {
    throw new Error(`❌ توجد أخطاء في أطوال الأكواد مقارنة بالمستويات: ${JSON.stringify(levelLengthErrors)}`);
  }

  // 3. فحص الأباء
  const missingParents = [];
  accounts.forEach(acc => {
    if (acc.parent_code && !codes.has(acc.parent_code)) {
      missingParents.push({ code: acc.code, parent_code: acc.parent_code });
    }
  });

  if (missingParents.length > 0) {
    throw new Error(`❌ توجد حسابات فرعية تشير إلى حسابات أب غير موجودة: ${JSON.stringify(missingParents)}`);
  }

  console.log('✅ [Pre-Check] اجتازت البيانات فحص الاتساق المبدئي بنجاح تام.');
}

/**
 * الدالة الرئيسية لتنفيذ استيراد وتحديث شجرة دليل الحسابات
 */
async function seedChartOfAccounts(customExcelPath) {
  console.log('\n================================================================');
  console.log('🚀 [COA Importer] بدء استيراد دليل الحسابات من Excel إلى قاعدة البيانات');
  console.log('================================================================');

  const filePath = customExcelPath || findExcelFilePath();
  const accounts = parseAndCleanExcel(filePath);

  // التحقق المسبق
  validateTreeDataInMemory(accounts);

  // ترتيب الحسابات تصاعدياً بحسب المستوى لضمان إدخال الأباء قبل الأبناء
  accounts.sort((a, b) => a.level - b.level || a.code.localeCompare(b.code, undefined, { numeric: true }));

  await transaction(async (tx) => {
    // 1. التأكد من سلامة المخطط
    await ensureAccountsSchema(tx);

    const validCodes = accounts.map(a => a.code);

    // 2. خريطة ترحيل الحسابات القديمة (إن وجدت)
    const codeMapping = {
      '1115': '12201001', '1125': '12301001', '1128': '12301001', '1130': '12801001',
      '1140': '12401001', '2105': '22401002', '2110': '22101001', '2115': '22401002',
      '2130': '22202001', '3101': '21101001', '4101': '41101001', '4102': '41101001',
      '4205': '41203001', '5105': '32102005', '5110': '32102005', '5115': '32102005',
      '5205': '31101001', '5210': '31101001', '511': '32101008', '512': '32101006',
      '513': '32101010', '213': '22202001', '214': '22202002', '215': '22202004',
      '5': '3'
    };

    // 3. إدخال أو تحديث الحسابات بحسب الكود الفريد باستخدام Prepared Statements
    let insertedCount = 0;
    let updatedCount = 0;

    for (const acc of accounts) {
      const existing = await tx.get('SELECT id, code FROM accounts WHERE code = ?', [acc.code]);

      if (existing) {
        await tx.run(`
          UPDATE accounts 
          SET name = ?,
              type = ?,
              parent_code = ?,
              level = ?,
              is_posting = ?,
              currencies = ?,
              report_type = ?,
              inclusion = ?,
              is_contra = ?,
              is_active = ?,
              status = 'active',
              updated_at = CURRENT_TIMESTAMP
          WHERE code = ?
        `, [
          acc.name,
          acc.type,
          acc.parent_code,
          acc.level,
          acc.is_posting,
          acc.currencies,
          acc.report_type,
          acc.inclusion || '=',
          acc.is_contra || 0,
          acc.is_active !== undefined ? acc.is_active : 1,
          acc.code
        ]);
        updatedCount++;
      } else {
        await tx.run(`
          INSERT INTO accounts (
            code, name, type, parent_code, level, is_posting, 
            currencies, report_type, inclusion, is_contra, is_active, status, balance
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
        `, [
          acc.code,
          acc.name,
          acc.type,
          acc.parent_code,
          acc.level,
          acc.is_posting,
          acc.currencies,
          acc.report_type,
          acc.inclusion || '=',
          acc.is_contra || 0,
          acc.is_active !== undefined ? acc.is_active : 1
        ]);
        insertedCount++;
      }
    }

    console.log(`✨ تم إدراج ${insertedCount} حساباً جديداً وتحديث ${updatedCount} حساباً بنجاح.`);

    // 4. ربط وتحديث parent_id الرقمي تلقائياً بناءً على parent_code
    console.log('🔗 [COA Seeder] جاري ربط الهرمية وتحديث parent_id لجميع الحسابات...');
    await tx.run(`
      UPDATE accounts
      SET parent_id = (SELECT p.id FROM accounts p WHERE p.code = accounts.parent_code)
      WHERE parent_code IS NOT NULL
    `);

    await tx.run(`
      UPDATE accounts
      SET parent_id = NULL
      WHERE parent_code IS NULL OR level = 1
    `);

    // 5. إعادة توجيه القيود والعمليات المحاسبية السابقة
    for (const [oldCode, newCode] of Object.entries(codeMapping)) {
      const oldAcc = await tx.get('SELECT id FROM accounts WHERE code = ?', [oldCode]);
      const newAcc = await tx.get('SELECT id FROM accounts WHERE code = ?', [newCode]);
      if (oldAcc && newAcc) {
        try { await tx.run('UPDATE journal_entry_lines SET account_id = ? WHERE account_id = ?', [newAcc.id, oldAcc.id]); } catch {}
        try { await tx.run('UPDATE payments SET account_id = ? WHERE account_id = ?', [newAcc.id, oldAcc.id]); } catch {}
        try { await tx.run('UPDATE expenses SET account_id = ? WHERE account_id = ?', [newAcc.id, oldAcc.id]); } catch {}
      }
    }

    // 6. تأمين القيود المتبقية وحذف الحسابات غير المعيارية الزائدة
    const placeholders = validCodes.map(() => '?').join(',');
    const defaultAcc = await tx.get("SELECT id FROM accounts WHERE code = '12101001'");
    if (defaultAcc) {
      await tx.run(`UPDATE journal_entry_lines SET account_id = ? WHERE account_id NOT IN (SELECT id FROM accounts WHERE code IN (${placeholders}))`, [defaultAcc.id, ...validCodes]);
    }
    await tx.run(`UPDATE accounts SET parent_id = NULL WHERE parent_id NOT IN (SELECT id FROM accounts WHERE code IN (${placeholders}))`, validCodes);
    await tx.run(`DELETE FROM accounts WHERE code NOT IN (${placeholders})`, validCodes);

    console.log('🧹 [COA Seeder] تم تنظيف ومزامنة شجرة الحسابات بنجاح.');
  });

  console.log('✅ [COA Importer] اكتمل الاستيراد بنجاح تام!');
  console.log('================================================================\n');

  // تشغيل الفحص والتحقق الآلي بعد الاستيراد
  const { runValidation } = require('./validate_coa');
  await runValidation();
}

if (require.main === module) {
  const customPath = process.argv[2];
  seedChartOfAccounts(customPath)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ فشل استيراد دليل الحسابات:', err.message);
      process.exit(1);
    });
}

module.exports = { seedChartOfAccounts, parseAndCleanExcel };
