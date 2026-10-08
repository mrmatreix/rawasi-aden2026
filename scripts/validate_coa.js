/**
 * ============================================================================
 * نظام شركة رواسي عدن للهندسة والمقاولات
 * سكريبت الفحص والتحقق الشامل من سلامة دليل الحسابات الشجري (COA Validation Suite)
 * ============================================================================
 * يفحص:
 * 1. عدم وجود أي حساب فرعي بدون حساب أب موجود (Orphan Accounts)
 * 2. عدم وجود حسابات فرعية متفرعة من حسابات طرفية قابلة للترحيل (Level 5 Integrity)
 * 3. فرادة كافة أكواد الحسابات (Unique Code Constraint)
 * 4. تطابق المستويات الهرمية مع أطوال أكواد الحسابات (Code-Level Rule)
 * 5. خلو الحسابات الرئيسية من القيمة '0' وتخزينها كـ NULL
 * 6. فحص معالجة حقوق الملكية ومجمعات الإهلاك المعيارية
 * 7. إحصائيات التوزيع، المستويات، والعملات
 */

const { query } = require('./server/database/db');

async function runValidation() {
  console.log('\n================================================================');
  console.log('🔍 [COA Validator] بدء الفحص المحاسبي والتقني لدليل الحسابات');
  console.log('================================================================\n');

  let hasError = false;

  // 1. عدد الحسابات الكلي
  const [totalRes] = await query('SELECT COUNT(*) as total FROM accounts');
  console.log(`📊 1. إجمالي الحسابات في الدليل: ${totalRes.total}`);

  // 2. توزيع المستويات الهرمية
  console.log('\n📑 2. توزيع الحسابات حسب المستويات الهرمية (Level 1 - 5):');
  const levelDist = await query('SELECT level, COUNT(*) as count FROM accounts GROUP BY level ORDER BY level ASC');
  console.table(levelDist);

  // 3. الحسابات القابلة للترحيل (is_posting = 1)
  const [postingRes] = await query('SELECT COUNT(*) as count FROM accounts WHERE is_posting = 1');
  console.log(`\n🟢 3. عدد الحسابات القابلة للترحيل واستقبال القيود (is_posting=1): ${postingRes.count}`);

  // 4. توزيع التصنيفات المحاسبية (IFRS Types)
  console.log('\n🏛️ 4. توزيع الحسابات حسب التصنيف المحاسبي المعتمد:');
  const typeDist = await query(`
    SELECT type, COUNT(*) as count, 
           SUM(CASE WHEN is_contra = 1 THEN 1 ELSE 0 END) as contra_count,
           SUM(CASE WHEN is_posting = 1 THEN 1 ELSE 0 END) as posting_count
    FROM accounts 
    GROUP BY type
    ORDER BY count DESC
  `);
  console.table(typeDist);

  // 5. توزيع العملات
  console.log('\n💱 5. توزيع الحسابات حسب العملات المدعومة:');
  const currDist = await query(`
    SELECT currencies, COUNT(*) as count,
           SUM(CASE WHEN is_posting = 1 THEN 1 ELSE 0 END) as posting_count
    FROM accounts
    GROUP BY currencies
    ORDER BY count DESC
  `);
  console.table(currDist);

  console.log('\n----------------------------------------------------------------');
  console.log('🧪 فحوصات السلامة الهيكلية الصارمة (Integrity Test Suite):');
  console.log('----------------------------------------------------------------');

  // فحص أ: عدم وجود حساب فرعي بدون أب
  const orphanAccounts = await query(`
    SELECT child.code, child.name, child.parent_code
    FROM accounts child
    LEFT JOIN accounts parent ON child.parent_code = parent.code
    WHERE child.parent_code IS NOT NULL AND parent.id IS NULL
  `);

  if (orphanAccounts.length === 0) {
    console.log('✅ فحص 1: لا يوجد أي حساب فرعي بدون حساب أب موجود (0 Orphan accounts).');
  } else {
    console.error(`❌ فحص 1: فشل! يوجد ${orphanAccounts.length} حسابات بدون أب:`, orphanAccounts);
    hasError = true;
  }

  // فحص ب: التأكد من أن الحسابات القابلة للترحيل (is_posting=1) ليس لها أبناء
  const invalidParents = await query(`
    SELECT a.code, a.name, a.level, COUNT(c.id) as children_count
    FROM accounts a
    LEFT JOIN accounts c ON c.parent_code = a.code
    WHERE a.is_posting = 1 AND c.id IS NOT NULL
    GROUP BY a.id
  `);

  if (invalidParents.length === 0) {
    console.log('✅ فحص 2: الحسابات القابلة للترحيل (Level 5) هي حسابات طرفية بحتة ولا تحتوي أبناء (0 Invalid parents).');
  } else {
    console.error(`❌ فحص 2: فشل! توجد حسابات قابلة للترحيل ولديها أبناء:`, invalidParents);
    hasError = true;
  }

  // فحص ج: فرادة أكواد الحسابات (Unique Account Codes)
  const duplicateCodes = await query(`
    SELECT code, COUNT(*) as occurrences
    FROM accounts
    GROUP BY code
    HAVING COUNT(*) > 1
  `);

  if (duplicateCodes.length === 0) {
    console.log('✅ فحص 3: جميع أكواد الحسابات فريدة 100% بدون أي تكرار.');
  } else {
    console.error(`❌ فحص 3: فشل! توجد أكواد مكررة:`, duplicateCodes);
    hasError = true;
  }

  // فحص د: تطابق المستويات مع طول كود الحساب
  // Level 1: 1, Level 2: 2, Level 3: 3, Level 4: 5, Level 5: 8
  const accounts = await query('SELECT code, name, level, parent_code, is_posting FROM accounts');
  const levelLengthMismatches = [];
  accounts.forEach(acc => {
    const len = String(acc.code).length;
    const lvl = Number(acc.level);
    let expectedLen = 0;
    if (lvl === 1) expectedLen = 1;
    else if (lvl === 2) expectedLen = 2;
    else if (lvl === 3) expectedLen = 3;
    else if (lvl === 4) expectedLen = 5;
    else if (lvl === 5) expectedLen = 8;

    if (expectedLen > 0 && len !== expectedLen) {
      levelLengthMismatches.push({ code: acc.code, name: acc.name, level: lvl, actualLength: len, expectedLen });
    }
  });

  if (levelLengthMismatches.length === 0) {
    console.log('✅ فحص 4: جميع الحسابات تطابق قاعدة طول الكود الهرمي للمستوى بدقة (Level 1:1, 2:2, 3:3, 4:5, 5:8).');
  } else {
    console.error(`❌ فحص 4: فشل! توجد حسابات لا تطابق طول الكود مع المستوى:`, levelLengthMismatches);
    hasError = true;
  }

  // فحص هـ: التأكد من أن الحسابات الرئيسية من المستوى 1 لها parent_code = NULL وليس '0'
  const invalidRootParents = await query(`
    SELECT code, name, parent_code
    FROM accounts
    WHERE level = 1 AND (parent_code IS NOT NULL AND parent_code != '')
  `);

  if (invalidRootParents.length === 0) {
    console.log('✅ فحص 5: الحسابات الرئيسية من المستوى الأول مخزنة بـ parent_code = NULL بشكل سليم.');
  } else {
    console.error(`❌ فحص 5: فشل! حسابات رئيسية تحتوي قيمة أب غير مفرغة:`, invalidRootParents);
    hasError = true;
  }

  // فحص و: التحقق من تصحيح حقوق الملكية (211 ومشتقاتها)
  const equityCheck = await query(`
    SELECT code, name, type, report_type 
    FROM accounts 
    WHERE code LIKE '211%' AND code NOT LIKE '21103%'
  `);
  const nonEquity = equityCheck.filter(a => a.type !== 'equity' || a.report_type !== 'balance_sheet');
  if (nonEquity.length === 0 && equityCheck.length > 0) {
    console.log(`✅ فحص 6: تم تصحيح حقوق الملكية بنجاح (${equityCheck.length} حسابات مصنفة كـ equity وميزانية عمومية).`);
  } else {
    console.error('❌ فحص 6: فشل تصنيف حقوق الملكية!', nonEquity);
    hasError = true;
  }

  // فحص ز: التحقق من تصحيح مجمعات الإهلاك (21103 ومشتقاتها كـ Contra-Asset)
  const contraCheck = await query(`
    SELECT code, name, type, is_contra, report_type 
    FROM accounts 
    WHERE code LIKE '21103%'
  `);
  const nonContra = contraCheck.filter(a => a.type !== 'asset' || Number(a.is_contra) !== 1 || a.report_type !== 'balance_sheet');
  if (nonContra.length === 0 && contraCheck.length > 0) {
    console.log(`✅ فحص 7: تم تصنيف مجمعات الإهلاك كـ Contra-Asset للأصول بنجاح (${contraCheck.length} حسابات is_contra=1).`);
  } else {
    console.error('❌ فحص 7: فشل تصنيف مجمعات الإهلاك كـ Contra-Asset!', nonContra);
    hasError = true;
  }

  console.log('\n================================================================');
  if (!hasError) {
    console.log('🎉 تهانينا! اجتاز دليل الحسابات الشجري الموحد كافة فحوصات السلامة بنسبة 100%!');
    console.log('================================================================\n');
    return true;
  } else {
    console.error('⚠️ تنبيه: تم رصد أخطاء في فحص دليل الحسابات! يرجى مراجعة التفاصيل أعلاه.');
    console.log('================================================================\n');
    return false;
  }
}

if (require.main === module) {
  runValidation()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal validation error:', err);
      process.exit(1);
    });
}

module.exports = { runValidation };
