const fs = require('fs');
const path = require('path');

const root = __dirname;
const dest = path.join(root, 'www');

const { assembleHtml } = require('./scripts/assemble_html');

// 1. تجميع المكونات المعيارية وتحديث بصمات الكاش التلقائية
assembleHtml();

if (!fs.existsSync(dest)) {
  fs.mkdirSync(dest, { recursive: true });
}

// نسخ الملفات الأساسية
['index.html', 'manifest.json', 'sw.js'].forEach(file => {
  const src = path.join(root, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dest, file));
  }
});

// نسخ مجلدات الواجهة الأمامية
['css', 'js', 'images'].forEach(dir => {
  const src = path.join(root, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(dest, dir), { recursive: true });
  }
});

console.log('✓ www build completed successfully for Cloudflare Pages!');
process.exit(0);
