/**
 * ترحيل قاعدة البيانات لدعم:
 * 1. حالة ومستوى الحسابات في شجرة الحسابات (status, level)
 * 2. دعم العملات وأسعار الصرف والمبالغ بالعملة المحلية في السندات (exchange_rate, local_amount)
 */

const { query, run, get } = require('./db');

async function migrate() {
  console.log('🚀 بدء ترحيل قاعدة البيانات لدليل الحسابات والعملات والسندات...');

  // 1. إضافة أعمدة جدول accounts
  try {
    const accCols = await query('PRAGMA table_info(accounts)');
    const colNames = accCols.map(c => c.name);

    if (!colNames.includes('status')) {
      await run("ALTER TABLE accounts ADD COLUMN status TEXT DEFAULT 'active'");
      console.log('✓ تمت إضافة عمود status إلى جدول accounts');
    }
    if (!colNames.includes('level')) {
      await run("ALTER TABLE accounts ADD COLUMN level INTEGER DEFAULT 3");
      console.log('✓ تمت إضافة عمود level إلى جدول accounts');
    }
  } catch (err) {
    console.error('خطأ فحص accounts:', err.message);
  }

  // 2. تحديث مستويات الحسابات الحالية بحسب طول الكود وعلاقة الأب
  try {
    const allAccounts = await query('SELECT id, code, parent_id FROM accounts');
    for (const acc of allAccounts) {
      let lvl = 1;
      const codeLen = String(acc.code).length;
      if (!acc.parent_id) {
        lvl = 1;
      } else if (codeLen <= 2) {
        lvl = 2;
      } else if (codeLen === 3) {
        lvl = 3;
      } else {
        lvl = 4;
      }
      await run("UPDATE accounts SET level = ?, status = COALESCE(status, 'active') WHERE id = ?", [lvl, acc.id]);
    }
    console.log('✓ تم تحديث مستويات وحالة الحسابات المسجلة بنجاح');
  } catch (err) {
    console.error('خطأ تحديث مستويات accounts:', err.message);
  }

  // 3. إضافة أعمدة أسعار الصرف والمبالغ بالعملة المحلية في payments
  try {
    const payCols = await query('PRAGMA table_info(payments)');
    const payColNames = payCols.map(c => c.name);

    if (!payColNames.includes('exchange_rate')) {
      await run('ALTER TABLE payments ADD COLUMN exchange_rate REAL DEFAULT 1.0');
      console.log('✓ تمت إضافة exchange_rate إلى جدول payments');
    }
    if (!payColNames.includes('local_amount')) {
      await run('ALTER TABLE payments ADD COLUMN local_amount REAL DEFAULT 0');
      console.log('✓ تمت إضافة local_amount إلى جدول payments');
    }
    // تحديث السجلات القديمة: local_amount = amount
    await run('UPDATE payments SET local_amount = amount WHERE local_amount IS NULL OR local_amount = 0');
  } catch (err) {
    console.error('خطأ فحص payments:', err.message);
  }

  // 4. إضافة أعمدة أسعار الصرف والمبالغ بالعملة المحلية في expenses
  try {
    const expCols = await query('PRAGMA table_info(expenses)');
    const expColNames = expCols.map(c => c.name);

    if (!expColNames.includes('exchange_rate')) {
      await run('ALTER TABLE expenses ADD COLUMN exchange_rate REAL DEFAULT 1.0');
      console.log('✓ تمت إضافة exchange_rate إلى جدول expenses');
    }
    if (!expColNames.includes('local_amount')) {
      await run('ALTER TABLE expenses ADD COLUMN local_amount REAL DEFAULT 0');
      console.log('✓ تمت إضافة local_amount إلى جدول expenses');
    }
    // تحديث السجلات القديمة: local_amount = amount
    await run('UPDATE expenses SET local_amount = amount WHERE local_amount IS NULL OR local_amount = 0');
  } catch (err) {
    console.error('خطأ فحص expenses:', err.message);
  }

  // 5. التحقق من جدول cost_centers
  try {
    const ccCols = await query('PRAGMA table_info(cost_centers)');
    const ccColNames = ccCols.map(c => c.name);
    if (!ccColNames.includes('status')) {
      await run("ALTER TABLE cost_centers ADD COLUMN status TEXT DEFAULT 'active'");
      console.log('✓ تمت إضافة status إلى جدول cost_centers');
    }
  } catch (err) {
    console.error('خطأ فحص cost_centers:', err.message);
  }

  console.log('✅ اكتمل الترحيل بنجاح!');
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(err => {
    console.error('فشل الترحيل:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
