/**
 * سكريبت تهيئة وتشغيل بيئة الاختبار والتجربة المعزولة (Staging Environment Runner)
 */

process.env.NODE_ENV = 'staging';

const fs = require('fs');
const path = require('path');
const config = require('../server/config/environment');

console.log('====================================================');
console.log(`🚀 بدء تشغيل بيئة الاختبار (STAGING ENVIRONMENT)`);
console.log(`   المنفذ: ${config.port}`);
console.log(`   قاعدة بيانات الاختبار: ${config.dbPath}`);
console.log('====================================================');

// إذا لم تكن قاعدة بيانات الـ Staging موجودة، يتم استنساخها من قاعدة البيانات الحالية
const prodDb = path.join(__dirname, '..', 'server', 'database', 'rawasi_aden.db');
if (!fs.existsSync(config.dbPath) && fs.existsSync(prodDb)) {
  console.log('📦 تهيئة نسخة اختبار أولية معزولة من قاعدة البيانات...');
  fs.copyFileSync(prodDb, config.dbPath);
  console.log('✓ تم إنشاء قاعدة بيانات الاختبار بنجاح:', config.dbPath);
}

// تشغيل الخادم
require('../server/server');
