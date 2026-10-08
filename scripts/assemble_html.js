/**
 * مجمع ومطور مكونات HTML - رواسي عدن (HTML Component Assembler)
 * يجمع النوافذ والمكونات المعيارية من views/ إلى index.html ويحقن البصمات التلقائية
 */

const fs = require('fs');
const path = require('path');
const { updateAssetVersions } = require('./version_manager');

function assembleHtml() {
  const root = path.resolve(__dirname, '..');
  const indexPath = path.join(root, 'index.html');
  const modalsDir = path.join(root, 'views', 'modals');

  if (!fs.existsSync(indexPath)) {
    console.error('index.html not found!');
    return;
  }

  let html = fs.readFileSync(indexPath, 'utf8');

  // 1. حقن events.js قبل app.js إذا لم يكن موجوداً
  if (!html.includes('js/events.js')) {
    html = html.replace(
      /(<script src="js\/auth\.js[^"]*"><\/script>)/i,
      `$1\n  <script src="js/events.js"></script>`
    );
    console.log('✓ تم ربط محرك تفويض الأحداث js/events.js');
  }

  // 2. حقن أزرار الفترات وسجل التدقيق في journalView إذا لم تكن موجودة
  if (!html.includes('Accounting.openClosePeriodModal') && !html.includes('accountingPeriodsModal')) {
    const oldBtns = `<button class="btn btn-secondary" onclick="Accounting.exportJournalToExcel()">`;
    const newBtns = `<button class="btn btn-secondary" style="border: 1px solid #ef4444; color: #ef4444;" onclick="Accounting.loadPeriods(); App.openModal('accountingPeriodsModal')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
              <span>إغلاق الفترات 🔒</span>
            </button>
            <button class="btn btn-secondary" style="border: 1px solid var(--accent-blue); color: var(--accent-blue);" onclick="Accounting.showAuditLogsModal()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
              <span>سجل التدقيق 🛡️</span>
            </button>
            <button class="btn btn-secondary" onclick="Accounting.exportJournalToExcel()">`;

    if (html.includes(oldBtns)) {
      html = html.replace(oldBtns, newBtns);
      console.log('✓ تم إضافة أزرار إغلاق الفترات وسجل التدقيق إلى شاشة القيود اليومية');
    }
  }

  // 3. حقن النوافذ المنبثقة من views/modals/ قبل نهاية body
  const modalFiles = ['period_close_modal.html', 'accounting_periods_modal.html', 'audit_log_modal.html'];
  modalFiles.forEach(file => {
    const mPath = path.join(modalsDir, file);
    if (fs.existsSync(mPath)) {
      const modalContent = fs.readFileSync(mPath, 'utf8').trim();
      const modalIdMatch = modalContent.match(/id=["']([^"']+)["']/);
      const modalId = modalIdMatch ? modalIdMatch[1] : null;

      if (modalId && !html.includes(`id="${modalId}"`)) {
        html = html.replace('</body>', `\n  ${modalContent}\n</body>`);
        console.log(`✓ تم حقن المكون المعياري: views/modals/${file}`);
      }
    }
  });

  fs.writeFileSync(indexPath, html, 'utf8');

  // 4. تشغيل مدير الإصدارات لحقن البصمة التلقائية
  const version = updateAssetVersions();
  console.log(`🚀 اكتمل تجميع وبناء المكونات بنجاح بالإصدار: ${version}`);
}

if (require.main === module) {
  assembleHtml();
}

module.exports = { assembleHtml };
