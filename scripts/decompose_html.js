/**
 * أداة تفكيك واستخراج شاشات HTML إلى مكونات معيارية في مجلد views/
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const viewsDir = path.join(root, 'views');
const modalsDir = path.join(viewsDir, 'modals');

if (!fs.existsSync(viewsDir)) fs.mkdirSync(viewsDir, { recursive: true });
if (!fs.existsSync(modalsDir)) fs.mkdirSync(modalsDir, { recursive: true });

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// استخراج الشاشات الرئيسية
const viewSections = [
  { id: 'dashboardView', file: 'dashboard.html' },
  { id: 'journalView', file: 'accounting.html' },
  { id: 'projectsView', file: 'projects.html' },
  { id: 'hrView', file: 'hr.html' },
  { id: 'reportsView', file: 'reports.html' },
  { id: 'settingsView', file: 'settings.html' },
  { id: 'inventoryView', file: 'inventory.html' },
  { id: 'billingView', file: 'billing.html' }
];

let extractedCount = 0;

viewSections.forEach(({ id, file }) => {
  const regex = new RegExp(`(<section[^>]*id=["']${id}["'][\\s\\S]*?<\\/section>)`, 'i');
  const match = indexHtml.match(regex);
  if (match) {
    fs.writeFileSync(path.join(viewsDir, file), match[1].trim(), 'utf8');
    console.log(`✓ تم استخراج المكون: views/${file} (${(match[1].length / 1024).toFixed(1)} KB)`);
    extractedCount++;
  } else {
    console.warn(`⚠️ لم يتم العثور على القسم: ${id}`);
  }
});

console.log(`✨ تم تفكيك واستخراج ${extractedCount} شاشات ومكونات بنجاح إلى مجلد views/!`);
