/**
 * ترحيل قاعدة البيانات لدعم:
 * 1. حسابات السلف والعهد في جدول custodies
 * 2. اسم العميل والمورد المباشر في payments و expenses
 * 3. نوع الحركة النقدية/البنكية في cash_movements
 */

const { db, getActiveEngine, query, run } = require('./db');

async function migrate() {
  console.log('🔄 بدء ترحيل قاعدة البيانات للسندات والعهد والقيود...');
  const engine = getActiveEngine();
  console.log(`📦 المحرك الحالي: ${engine}`);

  const addColumnIfNotExists = async (tableName, columnName, columnDefinition) => {
    try {
      const cols = await query(`PRAGMA table_info(${tableName})`);
      const exists = cols.some(c => c.name === columnName);
      if (!exists) {
        console.log(`➕ إضافة عمود ${columnName} إلى جدول ${tableName}...`);
        await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
        console.log(`✅ تمت إضافة ${columnName} بنجاح`);
      } else {
        console.log(`ℹ️ العمود ${columnName} موجود مسبقاً في ${tableName}`);
      }
    } catch (e) {
      console.warn(`تحذير عند فحص/إضافة ${columnName} في ${tableName}:`, e.message);
    }
  };

  // 1. أعمدة جدول custodies (الحساب المالي وطريقة الدفع)
  await addColumnIfNotExists('custodies', 'account_id', 'INTEGER');
  await addColumnIfNotExists('custodies', 'account_code', 'TEXT');
  await addColumnIfNotExists('custodies', 'account_name', 'TEXT');
  await addColumnIfNotExists('custodies', 'payment_method', "TEXT DEFAULT 'نقدي'");

  // 2. أعمدة جدول payments (اسم العميل المباشر)
  await addColumnIfNotExists('payments', 'client_name', 'TEXT');

  // 3. أعمدة جدول expenses (اسم المورد المباشر)
  await addColumnIfNotExists('expenses', 'supplier_name', 'TEXT');

  // 4. أعمدة جدول cash_movements (نوع الحركة: نقدي / بنك، ورقم المرجع)
  await addColumnIfNotExists('cash_movements', 'movement_type', "TEXT DEFAULT 'نقدي'");
  await addColumnIfNotExists('cash_movements', 'payment_method', "TEXT DEFAULT 'نقدي'");
  await addColumnIfNotExists('cash_movements', 'reference_no', 'TEXT');
  await addColumnIfNotExists('cash_movements', 'account_id', 'INTEGER');

  // تحديث الحركات السابقة في cash_movements لتحديد نوع الحركة (نقدي أم بنك)
  await run(`
    UPDATE cash_movements 
    SET movement_type = 'بنك' 
    WHERE (notes LIKE '%شيك%' OR notes LIKE '%بنك%' OR notes LIKE '%تحويل%')
      AND (movement_type IS NULL OR movement_type = 'نقدي')
  `);

  console.log('🎉 اكتمل ترحيل قاعدة البيانات بنجاح!');
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ خطأ أثناء الترحيل:', err);
    process.exit(1);
  });
