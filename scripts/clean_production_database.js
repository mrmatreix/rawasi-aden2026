/**
 * ============================================================================
 * سكربت التفريغ التشغيلي الآمن لنظام رواسي عدن (Clean Production Database Script)
 * ============================================================================
 * يقوم هذا السكربت بـ:
 * 1. إنشاء نسخة احتياطية فورية وكاملة من قاعدة البيانات قبل إجراء أي تعديل.
 * 2. تفريغ كافة المشاريع والمدخلات التجريبية والعمليات المالية والمخزنية.
 * 3. تصفير عدادات الترقيم التلقائي (Auto-Increment) لتبدأ السجلات الجديدة من الرقم 1.
 * 4. الحفاظ التام على:
 *    - حساب المدير العام والمستخدمين الأساسيين (admin, علوي, accountant)
 *    - شجرة الحسابات المحاسبية الكاملة (Chart of Accounts)
 *    - إعدادات الشركة وبياناتها وفروعها وأقسامها والعملات
 *    - بطاقة الموظف الرئيسي
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const rootDir = path.join(__dirname, '..');
const dbPath = path.join(rootDir, 'server', 'database', 'rawasi_aden.db');
const backupsDir = path.join(rootDir, 'server', 'database', 'backups');

console.log('===========================================================');
console.log('🚀 بدء عملية التفريغ التشغيلي الشامل لقاعدة البيانات (Clean Production)...');
console.log('===========================================================');

if (!fs.existsSync(dbPath)) {
  console.error('❌ لم يتم العثور على ملف قاعدة البيانات:', dbPath);
  process.exit(1);
}

// 1. أخذ نسخة احتياطية فورية أولاً
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupsDir, `rawasi_aden_pre_clean_${timestamp}.db`);

fs.copyFileSync(dbPath, backupPath);
const backupStat = fs.statSync(backupPath);
console.log(`✅ [1/4] تم إنشاء النسخة الاحتياطية بنجاح:`);
console.log(`   📁 المسار: ${backupPath}`);
console.log(`   📦 الحجم: ${(backupStat.size / (1024 * 1024)).toFixed(2)} ميغابايت\n`);

// 2. الاتصال بقاعدة البيانات وتنفيذ التنظيف
const db = new DatabaseSync(dbPath);

// قائمة الجداول التشغيلية المراد تفريغها بالكامل
const operationalTables = [
  // أ. دورة المشاريع ومركز التحكم
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
  'project_final_settlements',
  'project_wbs_activities',
  'project_wbs_baselines',
  'project_wbs_dependencies',
  'project_wbs_resources',
  'project_evm_snapshots',
  'project_risk_register',
  'project_claims_register',
  'project_non_conformance',
  'project_rfi',
  'project_engineer_certifications',
  'contract_revenue_recognitions',
  'contract_lifecycle',
  'contract_alerts',
  'cash_flow_projections',
  'project_labor',
  'project_closeouts',
  'material_movements',
  'material_audit_logs',
  'projects',

  // ب. العمليات المالية والمحاسبية
  'journal_entry_lines',
  'journal_entries',
  'expenses',
  'payments',
  'bills',
  'custodies',
  'cash_movements',
  'cheques',
  'bank_reconciliations',
  'bank_statement_lines',
  'bank_statements',
  'bank_guarantees',
  'tax_withholdings',
  'audit_logs',

  // ج. المشتريات والمخازن
  'purchase_order_items',
  'purchase_orders',
  'purchase_requisition_items',
  'purchase_requisitions',
  'rfq_vendor_quotes',
  'rfqs',
  'goods_receipt_items',
  'goods_receipt_notes',
  'inventory_transactions',
  'inventory_transfers',
  'inventory_adjustments',
  'inventory_returns',
  'inventory_valuation_layers',
  'warehouse_stocks',
  'items',
  'purchases',

  // د. أطراف التعامل التجريبيين
  'clients',
  'suppliers',

  // هـ. العمليات التشغيلية للموارد البشرية
  'payroll',
  'attendance',
  'employee_advances',
  'employee_leaves',
  'employee_evaluations'
];

console.log('🔄 [2/4] جاري تفريغ الجداول التشغيلية مع الحفاظ على البيانات التأسيسية...');

db.exec('PRAGMA foreign_keys = OFF;');

let totalDeletedRecords = 0;
const summary = [];

for (const tableName of operationalTables) {
  try {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
    if (tableExists) {
      const countBefore = db.prepare(`SELECT COUNT(*) as cnt FROM "${tableName}"`).get()?.cnt || 0;
      db.prepare(`DELETE FROM "${tableName}"`).run();
      totalDeletedRecords += countBefore;
      summary.push({ table: tableName, deleted: countBefore });
    }
  } catch (err) {
    console.warn(`⚠️ تعذر تفريغ جدول ${tableName}:`, err.message);
  }
}

// تنظيف الموظفين التجريبيين (مع الإبقاء على بطاقة الموظف الرئيسي رقم 1 إن وجدت)
try {
  const empBefore = db.prepare('SELECT COUNT(*) as cnt FROM employees WHERE id > 1').get()?.cnt || 0;
  db.prepare('DELETE FROM employees WHERE id > 1').run();
  totalDeletedRecords += empBefore;
  summary.push({ table: 'employees (demo id > 1)', deleted: empBefore });
} catch (e) {}

// تنظيف حسابات الاختبار التجريبية من المستخدمين
try {
  const testUsersBefore = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE username LIKE 'pm_test%' OR username IN ('maker_ctrl', 'checker_ctrl')").get()?.cnt || 0;
  db.prepare("DELETE FROM users WHERE username LIKE 'pm_test%' OR username IN ('maker_ctrl', 'checker_ctrl')").run();
  totalDeletedRecords += testUsersBefore;
  summary.push({ table: 'users (test accounts)', deleted: testUsersBefore });
} catch (e) {}

console.log(`✅ تم تفريغ إجمالي (${totalDeletedRecords}) سجل تجريبي من مختلف الأقسام.`);

// 3. تصفير عدادات الترقيم التلقائي
console.log('🔄 [3/4] تصفير عدادات الترقيم التلقائي لتبدأ المستندات والمشاريع الجديدة من 1...');
try {
  db.prepare("DELETE FROM sqlite_sequence WHERE name NOT IN ('users', 'roles', 'accounts', 'departments', 'branches', 'currencies', 'cost_centers', 'leave_types', 'warehouses', 'settings')").run();
  console.log('✅ تم تصفير العدادات التلقائية بنجاح.');
} catch (err) {
  console.warn('⚠️ خطأ في تصفير sqlite_sequence:', err.message);
}

db.exec('PRAGMA foreign_keys = ON;');

// 4. ضغط وتحسين حجم قاعدة البيانات
console.log('🔄 [4/4] ضغط وتحسين مساحة قاعدة البيانات (VACUUM)...');
db.exec('VACUUM;');

const finalStat = fs.statSync(dbPath);
console.log(`✅ الحجم الجديد لقاعدة البيانات بعد التنظيف: ${(finalStat.size / (1024 * 1024)).toFixed(2)} ميغابايت`);

// إغلاق الاتصال
db.close();

console.log('\n===========================================================');
console.log('🎉 اكتملت عملية تجهيز النظام بنجاح تام!');
console.log('✨ النظام الآن جاهز، فارغ من المدخلات والمشاريع، ومُهيأ للتشغيل الحي كنسخة إنتاجية جديدة.');
console.log('===========================================================');
