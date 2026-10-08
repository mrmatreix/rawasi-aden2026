/**
 * أداة إدارة الإصدارات وكسر الكاش التلقائي (Automated Cache-Busting & Fingerprinting)
 * تحقن بصمة الإصدار تلقائياً في index.html و sw.js و js/app.js
 */

const fs = require('fs');
const path = require('path');

function updateAssetVersions(customVersion = null) {
  const root = path.resolve(__dirname, '..');
  const pkgPath = path.join(root, 'package.json');
  let baseVersion = '5.3.0';

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      baseVersion = pkg.version || baseVersion;
    } catch (e) {}
  }

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeHex = now.getTime().toString(36).slice(-4);
  const version = customVersion || `${baseVersion}.${dateStamp}-${timeHex}`;

  console.log(`⚡ [VersionManager] توليد بصمة الإصدار الآلية: ${version}`);

  // 1. تحديث index.html
  const indexPath = path.join(root, 'index.html');
  if (fs.existsSync(indexPath)) {
    let indexHtml = fs.readFileSync(indexPath, 'utf8');
    indexHtml = indexHtml.replace(/(href=["'][^"']+\.(?:css|json))\?v=[^"']*(["'])/gi, (_m, p1, p2) => `${p1}?v=${version}${p2}`);
    indexHtml = indexHtml.replace(/(src=["'][^"']+\.js)\?v=[^"']*(["'])/gi, (_m, p1, p2) => `${p1}?v=${version}${p2}`);
    indexHtml = indexHtml.replace(/(register\(['"]\.\/sw\.js)\?v=[^'"]*(['"]\))/gi, (_m, p1, p2) => `${p1}?v=${version}${p2}`);
    fs.writeFileSync(indexPath, indexHtml, 'utf8');
    console.log('✓ تم تحديث بصمات الكاش في index.html');
  }

  // 2. تحديث sw.js
  const swPath = path.join(root, 'sw.js');
  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    swContent = swContent.replace(/const CACHE_NAME = ['"][^'"]+['"];/, () => `const CACHE_NAME = 'rawasi-aden-${version}';`);
    fs.writeFileSync(swPath, swContent, 'utf8');
    console.log(`✓ تم تحديث CACHE_NAME في sw.js -> rawasi-aden-${version}`);
  }

  // 3. تحديث js/app.js (Module Registry)
  const appJsPath = path.join(root, 'js', 'app.js');
  if (fs.existsSync(appJsPath)) {
    let appJs = fs.readFileSync(appJsPath, 'utf8');
    if (appJs.includes('assetVersion:')) {
      appJs = appJs.replace(/assetVersion:\s*['"][^'"]*['"]/, () => `assetVersion: '${version}'`);
    } else {
      appJs = appJs.replace(/const App = \{/, () => `const App = {\n  assetVersion: '${version}',`);
    }
    appJs = appJs.replace(/(\.js)\?v=[^'"]*(['"])/g, (_m, p1, p2) => `${p1}?v=${version}${p2}`);
    fs.writeFileSync(appJsPath, appJs, 'utf8');
    console.log('✓ تم تحديث سجل الوحدات assetVersion في js/app.js');
  }

  return version;
}

if (require.main === module) {
  const custom = process.argv[2] || null;
  updateAssetVersions(custom);
}

module.exports = { updateAssetVersions };
