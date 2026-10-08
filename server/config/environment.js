/**
 * مدير إعدادات البيئات المتعددة - رواسي عدن (Multi-Environment Configuration)
 * يدعم بيئات: Development, Staging, Production مع عزل قواعد البيانات والمنافذ
 */

const path = require('path');
const fs = require('fs');

const env = (process.env.NODE_ENV || 'development').toLowerCase().trim();
const isStaging = env === 'staging';
const isProd = env === 'production';
const isDev = !isStaging && !isProd;

// تحديد المنفذ حسب البيئة (Port 3000 for AI Studio)
let defaultPort = 3000;
if (isStaging) defaultPort = 3000;

const port = Number(process.env.PORT) || defaultPort;

// تحديد مسار قاعدة البيانات المنفصلة للـ Staging
const rootDir = path.resolve(__dirname, '..', '..');
let dbPath = path.join(rootDir, 'server', 'database', 'rawasi_aden.db');

if (isStaging) {
  dbPath = path.join(rootDir, 'server', 'database', 'rawasi_aden_staging.db');
} else if (process.env.RAWASI_DB_PATH) {
  dbPath = path.isAbsolute(process.env.RAWASI_DB_PATH) 
    ? process.env.RAWASI_DB_PATH 
    : path.join(rootDir, process.env.RAWASI_DB_PATH);
}

// قراءة رقم الإصدار من package.json
let version = '5.3.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  version = pkg.version || version;
} catch (e) {}

const config = {
  env,
  isDev,
  isStaging,
  isProd,
  port,
  dbPath,
  version,
  appName: 'نظام رواسي عدن للهندسة والمقاولات',
  cors: {
    origin: isProd ? false : true,
    credentials: true
  },
  logging: {
    level: isDev ? 'debug' : (isStaging ? 'info' : 'warn')
  }
};

module.exports = config;
