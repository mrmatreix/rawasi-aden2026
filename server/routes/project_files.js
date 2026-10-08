const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { exec, execFile, spawn } = require('child_process');
const { get, query, run } = require('../database/db');
const { requirePermission, requireScope } = require('../middleware/security');

// المجلد الرئيسي الافتراضي لحفظ ملفات وتقارير المشاريع
const DEFAULT_PROJECTS_BASE_DIR = path.resolve(__dirname, '..', '..', 'ملفات_المشاريع');

// التأكد من وجود المجلد الافتراضي
if (!fs.existsSync(DEFAULT_PROJECTS_BASE_DIR)) {
  fs.mkdirSync(DEFAULT_PROJECTS_BASE_DIR, { recursive: true });
}

// حماية مسارات ملفات المشروع بالنطاق والصلاحيات
router.use('/:projectId', requireScope({ projectParam: 'projectId' }), (req, res, next) => {
  if (req.method === 'GET') {
    return requirePermission('projects:view')(req, res, next);
  }
  if (req.path.includes('/export-package')) {
    return requirePermission('projects:export,projects:view')(req, res, next);
  }
  return requirePermission('projects:edit,projects:create')(req, res, next);
});

/**
 * جلب المسار الأساسي الحالي المعتمد لمجلد حفظ ملفات المشاريع
 * يفحص جدول الإعدادات أولاً، وإن لم يوجد مسار مخصص يعتمد المسار الافتراضي
 */
async function getProjectsBaseDir() {
  try {
    const row = await get("SELECT value FROM settings WHERE `key` = 'projects_base_folder'");
    if (row && row.value && row.value.trim()) {
      const customPath = path.resolve(row.value.trim());
      if (!fs.existsSync(customPath)) {
        fs.mkdirSync(customPath, { recursive: true });
      }
      return customPath;
    }
  } catch (err) {
    console.warn('[getProjectsBaseDir] Warning reading custom path:', err.message);
  }
  return DEFAULT_PROJECTS_BASE_DIR;
}

// قائمة المجلدات الفرعية النموذجية لكل مشروع
const SUBFOLDERS = [
  '01_العقود_والمستندات',
  '02_المخططات_الهندسية',
  '03_جداول_الكميات_والأسعار',
  '04_المستخلصات_والفواتير',
  '05_التقارير_الميدانية_اليومية_والأسبوعية',
  '06_المشتريات_وفواتير_المواد',
  '07_أجور_العمالة_والمصروفات',
  '08_محاضر_الاستلام_والمراسلات',
  '09_الحساب_الختامي_والتصفية',
  '10_أرشيف_التقارير_الممسوحة',
  'تقارير_المشروع_المصدرة'
];

/**
 * تنظيف اسم المشروع ليكون مسار مجلد آمن في نظام ويندوز
 */
function sanitizeFolderName(name) {
  return (name || 'مشروع')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * تجهيز وإنشاء المجلد المخصص للمشروع
 */
async function ensureProjectFolder(projectId) {
  const project = await get('SELECT id, code, name FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    throw new Error(`المشروع رقم (${projectId}) غير موجود`);
  }

  const baseDir = await getProjectsBaseDir();
  const safeCode = (project.code || `PRJ-${project.id}`).replace(/[\\/:*?"<>|]/g, '_').trim();
  const safeName = sanitizeFolderName(project.name);
  const folderName = `[${safeCode}] ${safeName}`;
  const projectFolderPath = path.join(baseDir, folderName);

  // إنشاء المجلد الرئيسي للمشروع
  if (!fs.existsSync(projectFolderPath)) {
    fs.mkdirSync(projectFolderPath, { recursive: true });
  }

  // إنشاء المجلدات الفرعية
  for (const sub of SUBFOLDERS) {
    const subPath = path.join(projectFolderPath, sub);
    if (!fs.existsSync(subPath)) {
      fs.mkdirSync(subPath, { recursive: true });
    }
  }

  return {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    folderName,
    folderPath: projectFolderPath,
    baseDir,
    relativePath: path.relative(baseDir, projectFolderPath)
  };
}

/**
 * استخراج قائمة الملفات داخل مجلد المشروع
 */
function scanProjectFiles(folderPath, baseDir) {
  const filesList = [];
  if (!fs.existsSync(folderPath)) return filesList;
  const rootDir = baseDir || folderPath;

  function traverse(currentDir, currentSubfolder = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        traverse(full, currentSubfolder ? `${currentSubfolder}/${entry.name}` : entry.name);
      } else {
        const stat = fs.statSync(full);
        const sizeKB = (stat.size / 1024).toFixed(1);
        const ext = path.extname(entry.name).toLowerCase();
        filesList.push({
          name: entry.name,
          subfolder: currentSubfolder || 'المجلد الرئيسي',
          fullPath: full,
          relativePath: path.relative(rootDir, full),
          sizeBytes: stat.size,
          sizeFormatted: stat.size > 1048576 ? `${(stat.size / 1048576).toFixed(2)} MB` : `${sizeKB} KB`,
          createdAt: stat.birthtime,
          modifiedAt: stat.mtime,
          ext
        });
      }
    }
  }

  traverse(folderPath);
  return filesList.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

// =================== المسارات البرمجية (API Routes) ===================

// 0. إدارة وتحديد مسار حفظ ملفات المشاريع على الجهاز
router.get('/settings/base-folder', async (req, res) => {
  try {
    const baseDir = await getProjectsBaseDir();
    const row = await get("SELECT value FROM settings WHERE `key` = 'projects_base_folder'");
    res.json({
      success: true,
      data: {
        currentPath: baseDir,
        defaultPath: DEFAULT_PROJECTS_BASE_DIR,
        isCustom: !!(row && row.value && row.value.trim() && path.resolve(row.value.trim()) !== DEFAULT_PROJECTS_BASE_DIR)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في قراءة مسار المجلد: ' + err.message });
  }
});

router.post('/settings/base-folder', async (req, res) => {
  try {
    let { folderPath, resetToDefault } = req.body;

    if (resetToDefault) {
      await run("DELETE FROM settings WHERE `key` = 'projects_base_folder'");
      return res.json({
        success: true,
        message: 'تمت استعادة المسار الافتراضي لملفات المشاريع بنجاح',
        currentPath: DEFAULT_PROJECTS_BASE_DIR
      });
    }

    if (!folderPath || !folderPath.trim()) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال مسار المجلد' });
    }

    const targetPath = path.resolve(folderPath.trim());

    // التأكد من إمكانية إنشاء المجلد وصلاحية الكتابة فيه
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    // فحص كتابة تجريبي
    const testFile = path.join(targetPath, `.rawasi_write_test_${Date.now()}.tmp`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);

    // حفظ المسار في جدول الإعدادات بتوافق كامل مع SQLite و MySQL
    const existing = await get("SELECT `key` FROM settings WHERE `key` = 'projects_base_folder'");
    if (existing) {
      await run("UPDATE settings SET `value` = ? WHERE `key` = 'projects_base_folder'", [targetPath]);
    } else {
      await run("INSERT INTO settings (`key`, `value`) VALUES ('projects_base_folder', ?)", [targetPath]);
    }

    res.json({
      success: true,
      message: 'تم حفظ وتعيين مسار مجلد المشاريع الجديد بنجاح',
      currentPath: targetPath
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر اعتماد المسار المحدد: ' + err.message });
  }
});

router.post('/settings/open-base-folder', async (req, res) => {
  try {
    const baseDir = await getProjectsBaseDir();
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    openInWindows(baseDir, true);
    res.json({
      success: true,
      message: 'تم فتح المجلد الأساسي لملفات المشاريع في ويندوز',
      folderPath: baseDir
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر فتح المجلد: ' + err.message });
  }
});

// 1. جلب وتأكيد إنشاء مجلد المشروع ومساره
router.get('/:projectId/folder', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const folderInfo = await ensureProjectFolder(projectId);
    const files = scanProjectFiles(folderInfo.folderPath, folderInfo.baseDir);

    res.json({
      success: true,
      data: {
        ...folderInfo,
        subfolders: SUBFOLDERS,
        filesCount: files.length,
        files
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * فتح مجلد أو ملف في نظام ويندوز بطريقة فورية وموثوقة 100%
 * تدعم المسارات العربية والأقواس المربعة [PRJ-...] بدون مشاكل ترميز سطر الأوامر (CP437) أو تعليق
 */
function openInWindows(targetPath, isFolder = true) {
  const resolved = path.resolve(targetPath);

  if (isFolder) {
    // 1. استدعاء explorer.exe مباشرة عبر spawn (فوري وخفيف بدون تشويه UTF-8)
    try {
      const child = spawn('explorer.exe', [resolved], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch (e) {
      console.warn('[openInWindows] spawn explorer error:', e.message);
    }
  }

  // 2. تشغيل Invoke-Item مع -LiteralPath عبر PowerShell بترميز Base64 UTF-16LE
  // لضمان استدعاء مشغل ويندوز ShellExecute الأصلي بدقة مع كافة المسارات العربية والأقواس
  const psScript = `Invoke-Item -LiteralPath "${resolved.replace(/"/g, '`"')}"`;
  const b64 = Buffer.from(psScript, 'utf16le').toString('base64');

  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], (err) => {
    if (err) {
      console.warn('[openInWindows] PowerShell error:', err.message);
      if (isFolder) {
        exec(`explorer.exe "${resolved}"`);
      } else {
        spawn('explorer.exe', ['/select,', resolved], { detached: true, stdio: 'ignore' }).unref();
      }
    }
  });
}

// 2. فتح مجلد المشروع مباشرة في مستكشف ملفات ويندوز (Windows Explorer)
router.post('/:projectId/open-folder', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const folderInfo = await ensureProjectFolder(projectId);
    const targetPath = path.resolve(folderInfo.folderPath);

    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    openInWindows(targetPath, true);

    res.json({
      success: true,
      message: `تم فتح مجلد المشروع بنجاح: ${folderInfo.folderName}`,
      folderName: folderInfo.folderName,
      folderPath: targetPath
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر فتح مجلد المشروع: ' + err.message });
  }
});

// 3. فتح ملف محدد عبر تطبيقه الافتراضي في ويندوز
router.post('/open-file', (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'الملف غير موجود في المسار المحدد' });
    }

    openInWindows(filePath, false);

    res.json({ success: true, message: 'تم فتح الملف بنجاح', filePath });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3.1 تنزيل أو استعراض الملف مباشرة في المتصفح
router.get('/download', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).send('الملف غير موجود');
    }
    const resolved = path.resolve(filePath);
    const baseDir = await getProjectsBaseDir();
    if (!resolved.startsWith(baseDir) && !resolved.startsWith(DEFAULT_PROJECTS_BASE_DIR)) {
      return res.status(403).send('غير مصرح بالوصول لهذا المسار');
    }
    res.download(resolved);
  } catch (err) {
    res.status(500).send('خطأ أثناء تحميل الملف: ' + err.message);
  }
});


// 4. حفظ تقرير داخل مجلد المشروع المخصص
router.post('/:projectId/save-report', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { reportType, reportName, content, format = 'html', targetSubfolder } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, message: 'محتوى التقرير مطلوب للحفظ' });
    }

    const folderInfo = await ensureProjectFolder(projectId);
    const dateStr = new Date().toISOString().split('T')[0];
    const cleanTitle = (reportName || reportType || 'تقرير').replace(/[\\/:*?"<>|]/g, '_').trim();
    
    let ext = '.html';
    if (format === 'xls') ext = '.xls';
    else if (format === 'pdf') ext = '.pdf';
    else if (format === 'json') ext = '.json';

    const fileName = `${cleanTitle}_${dateStr}${ext}`;

    // تحديد المجلد الفرعي المناسب
    let subfolder = targetSubfolder || 'تقارير_المشروع_المصدرة';
    if (!targetSubfolder) {
      if (reportType === 'عقد' || reportType === 'contract') subfolder = '01_العقود_والمستندات';
      else if (reportType === 'مستخلص' || reportType === 'invoice') subfolder = '04_المستخلصات_والفواتير';
      else if (reportType === 'تقرير يومي' || reportType === 'daily') subfolder = '05_التقارير_الميدانية_اليومية_والأسبوعية';
      else if (reportType === 'جدول كميات' || reportType === 'boq') subfolder = '03_جداول_الكميات_والأسعار';
      else if (reportType === 'حساب ختامي' || reportType === 'settlement') subfolder = '09_الحساب_الختامي_والتصفية';
    }

    const destDir = path.join(folderInfo.folderPath, subfolder);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const targetFilePath = path.join(destDir, fileName);

    // كتابة محتوى التقرير (مع BOM UTF-8 لملفات الإكسيل والـ HTML)
    const fileData = (ext === '.xls' || ext === '.html') ? '\uFEFF' + content : content;
    fs.writeFileSync(targetFilePath, fileData, 'utf8');

    // حفظ نسخة إضافية مرجعية في مجلد تقارير_المشروع_المصدرة
    if (subfolder !== 'تقارير_المشروع_المصدرة') {
      const exportDir = path.join(folderInfo.folderPath, 'تقارير_المشروع_المصدرة');
      if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
      fs.writeFileSync(path.join(exportDir, fileName), fileData, 'utf8');
    }

    const stat = fs.statSync(targetFilePath);

    res.json({
      success: true,
      message: `تم حفظ التقرير بنجاح في مجلد المشروع!`,
      data: {
        fileName,
        filePath: targetFilePath,
        relativePath: path.relative(path.resolve(__dirname, '..', '..'), targetFilePath),
        subfolder,
        sizeBytes: stat.size,
        savedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error saving project report:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء حفظ التقرير: ' + err.message });
  }
});

// أرشفة تقرير تم الحصول عليه من ماسح ضوئي: PDF أو صورة، داخل مجلد المشروع فقط.
router.post('/:projectId/scan-archive', async (req, res) => {
  try {
    const { fileName, mimeType, contentBase64, reportTitle, category = 'تقرير ممسوح' } = req.body || {};
    if (!contentBase64 || !fileName) return res.status(400).json({ success: false, message: 'اختر ملف التقرير الممسوح أولاً' });
    const allowed = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
    const ext = allowed[mimeType];
    if (!ext) return res.status(400).json({ success: false, message: 'الملف يجب أن يكون PDF أو صورة JPG/PNG/WEBP' });
    const data = Buffer.from(String(contentBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!data.length || data.length > 25 * 1024 * 1024) return res.status(400).json({ success: false, message: 'حجم الملف غير صالح أو يتجاوز 25MB' });
    const folderInfo = await ensureProjectFolder(req.params.projectId);
    const archiveDir = path.join(folderInfo.folderPath, '10_أرشيف_التقارير_الممسوحة');
    fs.mkdirSync(archiveDir, { recursive: true });
    const safeTitle = sanitizeFolderName(reportTitle || path.basename(fileName, path.extname(fileName))).replace(/[^\w\u0600-\u06FF\s-]/g, '_').slice(0, 120) || 'تقرير_ممسوح';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetFilePath = path.join(archiveDir, `${safeTitle}_${stamp}${ext}`);
    fs.writeFileSync(targetFilePath, data);
    res.json({ success: true, message: `تمت أرشفة ${category} داخل مجلد المشروع بنجاح`, data: { fileName: path.basename(targetFilePath), filePath: targetFilePath, category } });
  } catch (err) { res.status(500).json({ success: false, message: 'تعذر أرشفة التقرير: ' + err.message }); }
});

// 5. استعراض كافة ملفات المشروع
router.get('/:projectId/files', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const folderInfo = await ensureProjectFolder(projectId);
    const files = scanProjectFiles(folderInfo.folderPath);

    res.json({
      success: true,
      data: {
        folderPath: folderInfo.folderPath,
        files
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 6. تصدير وتفريغ كافة ملفات وبيانات المشروع في مجلده الخاص (Full Project Export)
//    (إيرادات، مصروفات، نثريات وعهد، موردين، مخازن ومواد، صندوق وبنك، والملف الشامل)
// ============================================================================

function fmtNum(val) {
  if (val === undefined || val === null || val === '') return '0';
  const n = Number(String(val).replace(/[^\d.-]/g, ''));
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-US');
}

async function safeQuery(sql, params = []) {
  try {
    return await query(sql, params);
  } catch (err) {
    return [];
  }
}

function buildExcelWorkbook(sheetName, title, companyInfo, kpiCards, headers, rows, totals) {
  const companyName = companyInfo?.name || 'شركة رواسي عدن للهندسة والمقاولات';
  const slogan = companyInfo?.slogan || 'نبني الحاضر لنستثمر المستقبل';
  const today = new Date().toISOString().split('T')[0];

  let kpiHtml = '';
  if (kpiCards && kpiCards.length > 0) {
    kpiHtml = `
      <tr>
        ${kpiCards.map(k => `
          <td colspan="2" style="background:#f8fafc; border:1pt solid #cbd5e1; text-align:center; padding:10px;">
            <div style="font-size:9pt; color:#64748b;">${k.label}</div>
            <div style="font-size:13pt; font-weight:bold; color:${k.color || '#0f2744'};">${k.value}</div>
          </td>
        `).join('')}
      </tr>
      <tr><td colspan="${headers.length}" style="height:10px; border:none;"></td></tr>
    `;
  }

  let headersHtml = `<tr>` + headers.map(h => `
    <th style="background-color:#0f2744; color:#ffffff; font-size:10.5pt; font-weight:bold; padding:8px 10px; border:1pt solid #334155; text-align:center;">
      ${h}
    </th>
  `).join('') + `</tr>`;

  let rowsHtml = '';
  if (!rows || rows.length === 0) {
    rowsHtml = `<tr><td colspan="${headers.length}" style="text-align:center; padding:20px; color:#64748b; border:0.5pt solid #cbd5e1;">لا توجد سجلات مسجلة لهذا البند في المشروع</td></tr>`;
  } else {
    rowsHtml = rows.map((r, idx) => {
      const bg = idx % 2 === 1 ? '#f8fafc' : '#ffffff';
      return `<tr style="background-color:${bg};">` + r.map((cell, cIdx) => {
        const isNum = typeof cell === 'number' || (typeof cell === 'string' && /^-?[\d,]+(\.\d+)?(\s*ر\.ي)?$/.test(String(cell).trim()));
        const align = isNum ? 'left' : (cIdx === 0 ? 'center' : 'right');
        const numFormat = isNum ? 'mso-number-format:"\\#\\,\\#\\#0"; font-family:Consolas, monospace;' : '';
        return `<td style="padding:6px 10px; border:0.5pt solid #cbd5e1; text-align:${align}; font-size:10pt; ${numFormat}">${cell !== undefined && cell !== null ? cell : '-'}</td>`;
      }).join('') + `</tr>`;
    }).join('');
  }

  let totalsHtml = '';
  if (totals && totals.length > 0) {
    totalsHtml = `<tr style="background-color:#f1f5f9; font-weight:bold; border-top:2pt solid #0f2744; border-bottom:2pt solid #0f2744;">` +
      totals.map(t => `<td style="padding:8px 10px; border:1pt solid #0f2744; font-size:10.5pt; ${typeof t === 'number' || /[\d,]+/.test(String(t)) ? 'text-align:left; color:#0f2744;' : 'text-align:right; color:#0f2744;'}">${t}</td>`).join('') +
      `</tr>`;
  }

  const template = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" 
          xmlns:x="urn:schemas-microsoft-com:office:excel" 
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>${(sheetName || 'كشف').substring(0, 31)}</x:Name>
              <x:WorksheetOptions>
                <x:DisplayRightToLeft/>
                <x:DoNotDisplayGridlines/>
                <x:Selected/>
              </x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background-color: #ffffff; }
        table { border-collapse: collapse; width: 100%; direction: rtl; }
      </style>
    </head>
    <body>
      <table>
        <tr>
          <td colspan="${headers.length}" style="background-color:#0f2744; color:#d4af37; font-size:16pt; font-weight:bold; text-align:center; padding:12px; border:1.5pt solid #0f2744;">
            ${companyName}
          </td>
        </tr>
        <tr>
          <td colspan="${headers.length}" style="background-color:#1a365d; color:#ffffff; font-size:12pt; font-weight:bold; text-align:center; padding:8px; border:1pt solid #1a365d;">
            ${title}
          </td>
        </tr>
        <tr>
          <td colspan="${headers.length}" style="background-color:#f8fafc; color:#475569; font-size:9.5pt; text-align:center; padding:6px; border:0.5pt solid #cbd5e1;">
            تاريخ التصدير: ${today} | شعار الشركة: ${slogan}
          </td>
        </tr>
        <tr><td colspan="${headers.length}" style="height:12px; border:none;"></td></tr>
        ${kpiHtml}
        ${headersHtml}
        ${rowsHtml}
        ${totalsHtml}
        <tr><td colspan="${headers.length}" style="height:25px; border:none;"></td></tr>
        <tr>
          <td colspan="${Math.max(1, Math.floor(headers.length / 3))}" style="text-align:center; font-weight:bold; border:none; padding-top:15px; color:#475569;">
            المسؤول المالي: ___________________
          </td>
          <td colspan="${Math.max(1, Math.floor(headers.length / 3))}" style="text-align:center; font-weight:bold; border:none; padding-top:15px; color:#475569;">
            مهندس المشروع: ___________________
          </td>
          <td colspan="${Math.max(1, headers.length - 2 * Math.floor(headers.length / 3))}" style="text-align:center; font-weight:bold; border:none; padding-top:15px; color:#475569;">
            المدير العام: ___________________
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return '\uFEFF' + template;
}

function buildHtmlReport(title, subtitle, projectName, projectCode, clientName, kpiCards, headers, rows, totals) {
  const today = new Date().toLocaleDateString('ar-YE');

  let kpiHtml = '';
  if (kpiCards && kpiCards.length > 0) {
    kpiHtml = `
      <div style="display: grid; grid-template-columns: repeat(${Math.min(kpiCards.length, 4)}, 1fr); gap: 12px; margin-bottom: 20px;">
        ${kpiCards.map(k => `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center;">
            <div style="font-size: 0.8rem; color: #64748b;">${k.label}</div>
            <div style="font-size: 1.25rem; font-weight: bold; color: ${k.color || '#0f2744'}; margin-top: 4px;">${k.value}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  let headersHtml = `<tr>` + headers.map(h => `<th>${h}</th>`).join('') + `</tr>`;

  let rowsHtml = '';
  if (!rows || rows.length === 0) {
    rowsHtml = `<tr><td colspan="${headers.length}" style="text-align: center; padding: 25px; color: #64748b;">لا توجد سجلات مسجلة لهذا البند في المشروع</td></tr>`;
  } else {
    rowsHtml = rows.map(r => `<tr>` + r.map((c, i) => {
      const isNum = typeof c === 'number' || (typeof c === 'string' && /^-?[\d,]+(\.\d+)?(\s*ر\.ي)?$/.test(String(c).trim()));
      return `<td style="${isNum ? 'text-align:left; font-family:Consolas, monospace;' : (i === 0 ? 'text-align:center;' : 'text-align:right;')}">${c !== undefined && c !== null ? c : '-'}</td>`;
    }).join('') + `</tr>`).join('');
  }

  let totalsHtml = '';
  if (totals && totals.length > 0) {
    totalsHtml = `<tr style="background:#f1f5f9; font-weight:bold; border-top:2px solid #0f2744;">` +
      totals.map(t => `<td style="${typeof t === 'number' || /[\d,]+/.test(String(t)) ? 'text-align:left; color:#0f2744;' : 'text-align:right;'}">${t}</td>`).join('') +
      `</tr>`;
  }

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${title} - ${projectName}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; padding: 25px; background: #fff; color: #1e293b; line-height: 1.6; }
    .header { border-bottom: 3px double #d4af37; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; }
    h1 { color: #0f2744; margin: 0 0 4px 0; font-size: 22px; }
    .title-box { background: #0f2744; color: #fff; padding: 8px 14px; border-radius: 6px; font-weight: bold; font-size: 15px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 13.5px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; }
    th { background: #1e293b; color: #ffffff; text-align: center; }
    tr:nth-child(even) { background: #f8fafc; }
    .footer { margin-top: 35px; border-top: 1px solid #cbd5e1; padding-top: 15px; display: flex; justify-content: space-between; font-size: 12px; color: #64748b; }
    @media print { body { padding: 0; } button { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>شركة رواسي عدن للهندسة والمقاولات</h1>
      <div style="color: #d4af37; font-weight: bold; font-size: 13px;">نبني الحاضر لنستثمر المستقبل</div>
    </div>
    <div style="text-align: left; font-size: 12.5px; color: #64748b;">
      <div>المشروع: <strong>${projectName}</strong> (${projectCode || 'PRJ'})</div>
      <div>العميل: <strong>${clientName || 'عميل مباشر'}</strong></div>
      <div>تاريخ التقرير: ${today}</div>
    </div>
  </div>

  <div class="title-box">
    <span>${title}</span>
    <span style="font-size: 12px; color: #d4af37;">${subtitle || ''}</span>
  </div>

  ${kpiHtml}

  <table>
    <thead>
      ${headersHtml}
    </thead>
    <tbody>
      ${rowsHtml}
      ${totalsHtml}
    </tbody>
  </table>

  <div class="footer">
    <div>المسؤول المالي: ________________</div>
    <div>مهندس ومدير المشروع: ________________</div>
    <div>المدير العام: ________________</div>
  </div>
</body>
</html>
  `;
}

router.post('/:projectId/export-package', async (req, res) => {
  try {
    const projectId = req.params.projectId;

    // 1. بيانات المشروع الأساسية والعميل
    const project = await get(`
      SELECT p.*, c.name as client_name, c.phone as client_phone, c.company as client_company
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [projectId]);

    if (!project) {
      return res.status(404).json({ success: false, message: 'المشروع المحدد غير موجود' });
    }

    const folderInfo = await ensureProjectFolder(projectId);
    const folderPath = folderInfo.folderPath;
    const curr = project.currency || 'ر.ي';

    // جلب معلومات الشركة من الإعدادات
    let companyInfo = { name: 'شركة رواسي عدن للهندسة والمقاولات', slogan: 'نبني الحاضر لنستثمر المستقبل' };
    try {
      const cfgRow = await get("SELECT value FROM settings WHERE `key` = 'company_info'");
      if (cfgRow && cfgRow.value) {
        const parsed = JSON.parse(cfgRow.value);
        if (parsed.name) companyInfo.name = parsed.name;
        if (parsed.slogan) companyInfo.slogan = parsed.slogan;
      }
    } catch (e) {}

    const generatedFiles = [];

    function saveExportFile(fileName, subfolder, content) {
      // 1. حفظ في الجذر المباشر لمجلد المشروع
      const rootPath = path.join(folderPath, fileName);
      fs.writeFileSync(rootPath, content, 'utf8');

      // 2. حفظ نسخة في المجلد الفرعي المخصص
      if (subfolder) {
        const subDir = path.join(folderPath, subfolder);
        if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
        fs.writeFileSync(path.join(subDir, fileName), content, 'utf8');
      }

      // 3. حفظ نسخة في تقارير_المشروع_المصدرة
      if (subfolder !== 'تقارير_المشروع_المصدرة') {
        const expDir = path.join(folderPath, 'تقارير_المشروع_المصدرة');
        if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });
        fs.writeFileSync(path.join(expDir, fileName), content, 'utf8');
      }

      generatedFiles.push({ fileName, subfolder, fullPath: rootPath });
    }

    // ========================================================================
    // الملف 1: إيرادات ومستخلصات المشروع (Revenues & Invoices)
    // ========================================================================
    const bills = await safeQuery('SELECT * FROM bills WHERE project_id = ? ORDER BY date DESC', [projectId]);
    const invoices = await safeQuery('SELECT * FROM project_invoices WHERE project_id = ? ORDER BY date DESC', [projectId]);
    const clientPayments = await safeQuery("SELECT * FROM payments WHERE project_id = ? AND type = 'قبض' ORDER BY date DESC", [projectId]);

    let revRows = [];
    let sumBilled = 0;
    let sumDeducted = 0;
    let sumNet = 0;

    bills.forEach(b => {
      const g = Number(b.amount) || 0;
      const d = Number(b.deduction) || 0;
      const n = Number(b.net_amount) || (g - d);
      sumBilled += g; sumDeducted += d; sumNet += n;
      revRows.push([b.bill_no || 'BILL', b.date, b.bill_type || 'مستخلص', 'مستخلص أعمال', fmtNum(g), fmtNum(d), fmtNum(n), b.status || 'معتمد', b.notes || '']);
    });

    invoices.forEach(i => {
      const g = Number(i.current_gross_amount) || Number(i.cumulative_work_done) || 0;
      const d = (Number(i.advance_deduction) || 0) + (Number(i.retention_deduction) || 0) + (Number(i.other_deductions) || 0);
      const n = Number(i.net_amount) || (g - d);
      sumBilled += g; sumDeducted += d; sumNet += n;
      revRows.push([i.invoice_no || 'IPC', i.date, 'مستخلص جاري IPC', `من ${i.period_from || '-'} إلى ${i.period_to || '-'}`, fmtNum(g), fmtNum(d), fmtNum(n), i.status || 'معتمد', i.notes || '']);
    });

    let sumPaidByClient = 0;
    clientPayments.forEach(p => {
      const a = Number(p.amount) || 0;
      sumPaidByClient += a;
      revRows.push([p.receipt_no || 'PAY', p.date, 'سند قبض / دفعة عميل', p.payment_method || 'نقدي', fmtNum(a), '0', fmtNum(a), 'مسدد للمشروع', p.notes || '']);
    });

    const revHeaders = ['رقم المستند', 'التاريخ', 'النوع والتصنيف', 'البيان وفترة الأعمال', `إجمالي القيمة (${curr})`, `الاستقطاعات (${curr})`, `صافي المستحق / المقبوض (${curr})`, 'الحالة', 'ملاحظات'];
    const revTotals = ['الإجمالي العام', '-', '-', '-', fmtNum(sumBilled), fmtNum(sumDeducted), fmtNum(sumNet), 'صافي المستخلصات', `المسدد نقداً: ${fmtNum(sumPaidByClient)}`];
    const revKpis = [
      { label: 'إجمالي المستخلصات والفواتير', value: `${fmtNum(sumBilled)} ${curr}`, color: '#0f2744' },
      { label: 'إجمالي الاستقطاعات والضمان', value: `${fmtNum(sumDeducted)} ${curr}`, color: '#dc2626' },
      { label: 'صافي المستخلصات المعتمدة', value: `${fmtNum(sumNet)} ${curr}`, color: '#059669' },
      { label: 'إجمالي المقبوضات النقدية المسددة', value: `${fmtNum(sumPaidByClient)} ${curr}`, color: '#2563eb' }
    ];

    const revXls = buildExcelWorkbook('إيرادات ومستخلصات', `كشف حساب إيرادات ومستخلصات مشروع [${project.code || 'PRJ'}] ${project.name}`, companyInfo, revKpis, revHeaders, revRows, revTotals);
    const revHtml = buildHtmlReport('كشف حساب إيرادات ومستخلصات المشروع', `كشف تفصيلي بالفواتير والمستخلصات وسندات القبض`, project.name, project.code, project.client_name, revKpis, revHeaders, revRows, revTotals);

    saveExportFile('01_كشف_حساب_إيرادات_ومستخلصات_المشروع.xls', '04_المستخلصات_والفواتير', revXls);
    saveExportFile('01_تقرير_إيرادات_ومستخلصات_المشروع.html', '04_المستخلصات_والفواتير', revHtml);

    // ========================================================================
    // الملف 2: مصروفات وأجور عمالة المشروع (Expenses & Labor)
    // ========================================================================
    const expenses = await safeQuery(`
      SELECT e.*, s.name as supplier_name 
      FROM expenses e 
      LEFT JOIN suppliers s ON e.supplier_id = s.id 
      WHERE e.project_id = ? 
      ORDER BY e.date DESC
    `, [projectId]);
    const labor = await safeQuery('SELECT * FROM project_labor_expenses WHERE project_id = ? ORDER BY date DESC', [projectId]);

    let expRows = [];
    let sumExp = 0;
    let sumLabor = 0;

    expenses.forEach(e => {
      const a = Number(e.amount) || 0;
      sumExp += a;
      expRows.push([e.receipt_no || 'EXP', e.date, e.expense_type || 'مصروف عام', e.recipient || e.supplier_name || '-', e.payment_method || 'نقدي', fmtNum(a), e.notes || '']);
    });

    labor.forEach(l => {
      const a = Number(l.total_amount) || 0;
      sumLabor += a;
      expRows.push([`LAB-${l.id}`, l.date || l.work_date, l.labor_category || 'أجور عمالة', l.foreman_name || l.recipient || '-', l.payment_method || 'نقدي', fmtNum(a), `${l.workers_count || 1} عمال | ${l.notes || ''}`]);
    });

    const totalActualCost = sumExp + sumLabor;
    const expHeaders = ['رقم السند', 'التاريخ', 'نوع المصروف / البند', 'المستفيد / المستلم', 'طريقة الدفع', `المبلغ (${curr})`, 'التفاصيل والملاحظات'];
    const expTotals = ['الإجمالي العام', '-', '-', '-', 'إجمالي المنصرف', fmtNum(totalActualCost), `مصروفات: ${fmtNum(sumExp)} | عمالة: ${fmtNum(sumLabor)}`];
    const expKpis = [
      { label: 'إجمالي المصروفات العامة', value: `${fmtNum(sumExp)} ${curr}`, color: '#dc2626' },
      { label: 'إجمالي أجور العمالة الميدانية', value: `${fmtNum(sumLabor)} ${curr}`, color: '#ea580c' },
      { label: 'التكلفة الفعلية المنصرفة للمشروع', value: `${fmtNum(totalActualCost)} ${curr}`, color: '#b91c1c' },
      { label: 'التكلفة التقديرية للمشروع', value: `${fmtNum(project.estimated_cost)} ${curr}`, color: '#0f2744' }
    ];

    const expXls = buildExcelWorkbook('مصروفات وعمالة', `كشف مصروفات وأجور عمالة مشروع [${project.code || 'PRJ'}] ${project.name}`, companyInfo, expKpis, expHeaders, expRows, expTotals);
    const expHtml = buildHtmlReport('كشف مصروفات وأجور عمالة المشروع', `حصر تفصيلي للمصروفات النقدية والتشغيلية وأجور العمالة الميدانية`, project.name, project.code, project.client_name, expKpis, expHeaders, expRows, expTotals);

    saveExportFile('02_كشف_مصروفات_وأجور_عمالة_المشروع.xls', '07_أجور_العمالة_والمصروفات', expXls);
    saveExportFile('02_تقرير_مصروفات_وأجور_عمالة_المشروع.html', '07_أجور_العمالة_والمصروفات', expHtml);

    // ========================================================================
    // الملف 3: نثريات وعهد المشروع (Custodies & Petty Cash)
    // ========================================================================
    const custodies = await safeQuery(`
      SELECT * FROM custodies 
      WHERE notes LIKE ? OR operation_type LIKE ?
      ORDER BY date DESC
    `, [`%${project.name}%`, `%${project.code || 'PRJ'}%`]);

    const custodyExpenses = expenses.filter(e => 
      (e.expense_type && (e.expense_type.includes('عهدة') || e.expense_type.includes('نثر'))) ||
      (e.notes && (e.notes.includes('عهدة') || e.notes.includes('نثر')))
    );

    let cstRows = [];
    let sumCstTotal = 0;
    let sumCstSpent = 0;
    let sumCstRem = 0;

    custodies.forEach(c => {
      const tot = Number(c.total_amount) || 0;
      const sp = Number(c.spent_amount) || 0;
      const rem = Number(c.remaining_amount) || (tot - sp);
      sumCstTotal += tot; sumCstSpent += sp; sumCstRem += rem;
      cstRows.push([`CST-${c.id}`, c.date, c.operation_type || 'عهدة ميدانية', c.employee_name, fmtNum(tot), fmtNum(sp), fmtNum(rem), c.notes || '']);
    });

    custodyExpenses.forEach(ce => {
      const a = Number(ce.amount) || 0;
      sumCstTotal += a; sumCstSpent += a;
      cstRows.push([ce.receipt_no || 'PETTY', ce.date, ce.expense_type, ce.recipient || '-', fmtNum(a), fmtNum(a), '0', ce.notes || '']);
    });

    const cstHeaders = ['رقم العهدة / السند', 'التاريخ', 'نوع العملية', 'المسؤول / المهندس', `المبلغ المسلم (${curr})`, `المصروف الفعلي (${curr})`, `الرصيد المتبقي (${curr})`, 'بيان العهدة والملاحظات'];
    const cstTotals = ['الإجمالي العام', '-', '-', '-', fmtNum(sumCstTotal), fmtNum(sumCstSpent), fmtNum(sumCstRem), 'مخالصة العهد'];
    const cstKpis = [
      { label: 'إجمالي مبالغ العهد المسلمة', value: `${fmtNum(sumCstTotal)} ${curr}`, color: '#0f2744' },
      { label: 'المصروف الفعلي المصفى', value: `${fmtNum(sumCstSpent)} ${curr}`, color: '#dc2626' },
      { label: 'الرصيد المتبقي بذمة المهندسين', value: `${fmtNum(sumCstRem)} ${curr}`, color: '#059669' }
    ];

    const cstXls = buildExcelWorkbook('نثريات وعهد', `كشف النثريات والعهد الميدانية لمشروع [${project.code || 'PRJ'}] ${project.name}`, companyInfo, cstKpis, cstHeaders, cstRows, cstTotals);
    const cstHtml = buildHtmlReport('كشف النثريات والعهد الميدانية للمشروع', `حركة العهد المسلمة لمهندسي الموقع والمصروفات النثرية المصفاة`, project.name, project.code, project.client_name, cstKpis, cstHeaders, cstRows, cstTotals);

    saveExportFile('03_كشف_حركة_النثريات_والعهد_الميدانية.xls', '07_أجور_العمالة_والمصروفات', cstXls);
    saveExportFile('03_تقرير_النثريات_والعهد_الميدانية.html', '07_أجور_العمالة_والمصروفات', cstHtml);

    // ========================================================================
    // الملف 4: الموردين ومشتريات المواد (Suppliers & Purchases)
    // ========================================================================
    const purchases = await safeQuery(`
      SELECT p.*, s.name as supplier_name, s.phone as supplier_phone 
      FROM purchases p 
      LEFT JOIN suppliers s ON p.supplier_id = s.id 
      WHERE p.project_id = ? 
      ORDER BY p.date DESC
    `, [projectId]);
    const projectPurchases = await safeQuery('SELECT * FROM project_purchases WHERE project_id = ? ORDER BY date DESC', [projectId]);

    let purRows = [];
    let sumPurTotal = 0;
    let sumPurPaid = 0;

    purchases.forEach(p => {
      const tot = Number(p.total_amount) || 0;
      const paid = Number(p.paid_amount) || 0;
      const rem = tot - paid;
      sumPurTotal += tot; sumPurPaid += paid;
      purRows.push([p.invoice_no || 'PUR', p.date, p.supplier_name || 'مورد عام', 'فاتورة توريد مواد', p.payment_method || 'نقدي', fmtNum(tot), fmtNum(paid), fmtNum(rem), p.payment_status || 'سارية', p.notes || '']);
    });

    projectPurchases.forEach(pp => {
      const tot = Number(pp.total_amount) || 0;
      const paid = Number(pp.paid_amount) || 0;
      const rem = tot - paid;
      sumPurTotal += tot; sumPurPaid += paid;
      purRows.push([pp.invoice_no || `PP-${pp.id}`, pp.date || pp.purchase_date, pp.supplier_name || 'مورد', pp.item_description || 'مواد إنشائية', pp.payment_method || 'نقدي', fmtNum(tot), fmtNum(paid), fmtNum(rem), pp.payment_status || 'معتمد', pp.notes || '']);
    });

    const sumPurRem = sumPurTotal - sumPurPaid;
    const purHeaders = ['رقم الفاتورة', 'التاريخ', 'اسم المورد', 'بيان المشتريات والمواد', 'طريقة السداد', `إجمالي الفاتورة (${curr})`, `المسدد للمورد (${curr})`, `المتبقي للمورد (${curr})`, 'حالة السداد', 'ملاحظات'];
    const purTotals = ['الإجمالي العام', '-', '-', '-', '-', fmtNum(sumPurTotal), fmtNum(sumPurPaid), fmtNum(sumPurRem), 'صافي التوريدات', '-'];
    const purKpis = [
      { label: 'إجمالي فواتير المشتريات', value: `${fmtNum(sumPurTotal)} ${curr}`, color: '#0f2744' },
      { label: 'المسدد للموردين نقداً وبنكياً', value: `${fmtNum(sumPurPaid)} ${curr}`, color: '#059669' },
      { label: 'المتبقي مستحق للموردين', value: `${fmtNum(sumPurRem)} ${curr}`, color: '#dc2626' }
    ];

    const purXls = buildExcelWorkbook('مشتريات وموردين', `كشف حساب مشتريات وموردي مشروع [${project.code || 'PRJ'}] ${project.name}`, companyInfo, purKpis, purHeaders, purRows, purTotals);
    const purHtml = buildHtmlReport('كشف حساب مشتريات وموردي المشروع', `حصر كامل لفواتير التوريد للموقع وأرصدة الموردين المسددة والمتبقية`, project.name, project.code, project.client_name, purKpis, purHeaders, purRows, purTotals);

    saveExportFile('04_كشف_حساب_الموردين_وفواتير_المشتريات.xls', '06_المشتريات_وفواتير_المواد', purXls);
    saveExportFile('04_تقرير_حساب_الموردين_وفواتير_المشتريات.html', '06_المشتريات_وفواتير_المواد', purHtml);

    // ========================================================================
    // الملف 5: المخازن ومواد البناء (Inventory & Materials)
    // ========================================================================
    const materials = await safeQuery(`
      SELECT t.*, i.name as item_name, i.code as item_code, i.category as item_category, i.unit as item_unit
      FROM inventory_transactions t
      LEFT JOIN items i ON t.item_id = i.id
      WHERE t.project_id = ?
      ORDER BY t.date DESC
    `, [projectId]);

    let matRows = [];
    let sumMatQty = 0;
    let sumMatVal = 0;

    materials.forEach(t => {
      const q = Number(t.quantity) || 0;
      const v = Number(t.total_amount) || (q * (Number(t.unit_price) || 0));
      sumMatQty += q; sumMatVal += v;
      matRows.push([
        t.reference_no || `TX-${t.id}`,
        t.date,
        t.item_name || 'مادة بناء',
        t.item_code || '-',
        t.item_category || 'مواد عامة',
        t.type || 'صرف للمشروع',
        `${fmtNum(q)} ${t.item_unit || ''}`,
        fmtNum(t.unit_price),
        fmtNum(v),
        t.recipient || 'موقع المشروع',
        t.notes || ''
      ]);
    });

    const matHeaders = ['رقم الإذن / المرجع', 'التاريخ', 'اسم المادة / الصنف', 'كود الصنف', 'التصنيف', 'نوع الحركة', 'الكمية والوحدة', `سعر الوحدة (${curr})`, `إجمالي القيمة (${curr})`, 'المستلم / الموقع', 'ملاحظات'];
    const matTotals = ['الإجمالي العام', '-', '-', '-', '-', '-', `${fmtNum(sumMatQty)} وحدة`, '-', fmtNum(sumMatVal), 'إجمالي المواد المنصرفة', '-'];
    const matKpis = [
      { label: 'عدد حركات صرف وتوريد المواد', value: `${materials.length} حركة`, color: '#0f2744' },
      { label: 'إجمالي كميات المواد', value: `${fmtNum(sumMatQty)} وحدة`, color: '#2563eb' },
      { label: 'القيمة الإجمالية للمواد المنصرفة', value: `${fmtNum(sumMatVal)} ${curr}`, color: '#ea580c' }
    ];

    const matXls = buildExcelWorkbook('مخازن ومواد', `كشف حركة المخازن ومواد البناء لمشروع [${project.code || 'PRJ'}] ${project.name}`, companyInfo, matKpis, matHeaders, matRows, matTotals);
    const matHtml = buildHtmlReport('كشف حركة المخازن ومواد البناء للمشروع', `سجل أذونات الصرف والاستلام وحركة المواد المحولة والمستهلكة بالموقع`, project.name, project.code, project.client_name, matKpis, matHeaders, matRows, matTotals);

    saveExportFile('05_كشف_حركة_المخازن_ومواد_البناء.xls', '03_جداول_الكميات_والأسعار', matXls);
    saveExportFile('05_تقرير_حركة_المخازن_ومواد_البناء.html', '03_جداول_الكميات_والأسعار', matHtml);

    // ========================================================================
    // الملف 6: الصندوق والبنك وحركات الخزينة والقيود (Cash, Bank & Journal)
    // ========================================================================
    const projectPayments = await safeQuery('SELECT * FROM payments WHERE project_id = ? ORDER BY date DESC', [projectId]);
    const journalLines = await safeQuery(`
      SELECT l.*, j.entry_no, j.date as entry_date, j.description, a.name as account_name, a.code as account_code, a.type as account_type
      FROM journal_entry_lines l
      JOIN journal_entries j ON l.entry_id = j.id
      LEFT JOIN accounts a ON l.account_id = a.id
      WHERE l.project_id = ?
      ORDER BY j.date DESC
    `, [projectId]);

    let cshRows = [];
    let sumCashIn = 0;
    let sumCashOut = 0;

    projectPayments.forEach(p => {
      const a = Number(p.amount) || 0;
      if (p.type === 'قبض') {
        sumCashIn += a;
        cshRows.push([p.receipt_no || 'PAY-IN', p.date, 'سند قبض - إيداع نقدي/بنكي للمشروع', p.payment_method || 'نقدي', fmtNum(a), '0', p.notes || '']);
      } else {
        sumCashOut += a;
        cshRows.push([p.receipt_no || 'PAY-OUT', p.date, 'سند صرف - سحب من الصندوق/البنك للمشروع', p.payment_method || 'نقدي', '0', fmtNum(a), p.notes || '']);
      }
    });

    journalLines.forEach(l => {
      const deb = Number(l.debit) || 0;
      const crd = Number(l.credit) || 0;
      sumCashIn += deb; sumCashOut += crd;
      cshRows.push([l.entry_no || 'JV', l.entry_date, `قيد محاسبي: ${l.account_name || 'حساب'}`, l.description || '', fmtNum(deb), fmtNum(crd), l.notes || '']);
    });

    const netCashFlow = sumCashIn - sumCashOut;
    const cshHeaders = ['رقم السند / القيد', 'التاريخ', 'الحساب ونوع الحركة الخزينية', 'طريقة الدفع / البيان', `مدين / مقبوض (${curr})`, `دائن / مدفوع (${curr})`, 'ملاحظات'];
    const cshTotals = ['الإجمالي العام', '-', '-', 'إجمالي الحركة النقدية', fmtNum(sumCashIn), fmtNum(sumCashOut), `صافي التدفق: ${fmtNum(netCashFlow)}`];
    const cshKpis = [
      { label: 'إجمالي المقبوضات النقدية والبنكية', value: `${fmtNum(sumCashIn)} ${curr}`, color: '#059669' },
      { label: 'إجمالي المدفوعات والمنصرفات النقدية', value: `${fmtNum(sumCashOut)} ${curr}`, color: '#dc2626' },
      { label: 'صافي السيولة والتدفق النقدي للمشروع', value: `${fmtNum(netCashFlow)} ${curr}`, color: netCashFlow >= 0 ? '#059669' : '#dc2626' }
    ];

    const cshXls = buildExcelWorkbook('صندوق وبنك', `كشف حركة الصندوق والبنك والقيود لمشروع [${project.code || 'PRJ'}] ${project.name}`, companyInfo, cshKpis, cshHeaders, cshRows, cshTotals);
    const cshHtml = buildHtmlReport('كشف حركة الصندوق والبنك والقيود للمشروع', `كشف التدفق النقدي وسندات القبض والصرف المصرفية والقيود اليومية الخاصة بالمشروع`, project.name, project.code, project.client_name, cshKpis, cshHeaders, cshRows, cshTotals);

    saveExportFile('06_كشف_حركة_الصندوق_والبنك_والقيود.xls', 'تقارير_المشروع_المصدرة', cshXls);
    saveExportFile('06_تقرير_حركة_الصندوق_والبنك.html', 'تقارير_المشروع_المصدرة', cshHtml);

    // ========================================================================
    // الملف 7: الملف الشامل الموحد المالي والإداري (Master Consolidated Dossier)
    // ========================================================================
    const contract = await get('SELECT * FROM project_contracts WHERE project_id = ?', [projectId]);
    const boq = await safeQuery('SELECT * FROM project_boq WHERE project_id = ? ORDER BY id ASC', [projectId]);
    const changeOrders = await safeQuery('SELECT * FROM project_change_orders WHERE project_id = ? ORDER BY id DESC', [projectId]);
    const settlement = await get('SELECT * FROM project_final_settlements WHERE project_id = ?', [projectId]);

    const origContractVal = Number(project.contract_value) || 0;
    const totalApprovedChanges = changeOrders.filter(c => c.status === 'معتمد').reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const revisedContractVal = origContractVal + totalApprovedChanges;
    const actualProfitVal = Number(project.actual_profit) || (origContractVal - totalActualCost);

    const masterHeaders = ['البند والمؤشر المالي والهندسي', 'المبلغ والقيمة الرقمية', 'العملة', 'الحالة والبيان التفصيلي'];
    const masterRows = [
      ['اسم المشروع الرسمي', project.name, '-', `كود: ${project.code || 'PRJ'}`],
      ['العميل / المالك', project.client_name || 'عميل مباشر', '-', `الهاتف: ${project.client_phone || 'غير مسجل'}`],
      ['قيمة العقد الأصلية', fmtNum(origContractVal), curr, contract ? `عقد رقم: ${contract.contract_no || 'CNT'}` : 'عقد أولي'],
      ['أوامر التغيير والإضافيات المعتمدة', `+${fmtNum(totalApprovedChanges)}`, curr, `${changeOrders.length} أوامر تغيير مسجلة`],
      ['القيمة التعاقدية المعدلة النهائية', fmtNum(revisedContractVal), curr, 'شامل الإضافيات'],
      ['التكلفة التقديرية (الميزانية المستهدفة)', fmtNum(project.estimated_cost), curr, 'الميزانية التقديرية'],
      ['التكلفة الفعلية المنصرفة الكلية', fmtNum(totalActualCost), curr, `مصروفات: ${fmtNum(sumExp)} | عمالة: ${fmtNum(sumLabor)}`],
      ['إجمالي المستخلصات المفوترة', fmtNum(sumBilled), curr, `${invoices.length + bills.length} مستخلصات`],
      ['صافي المستخلصات المعتمدة', fmtNum(sumNet), curr, 'بعد خصم الدفعة المقدمة وضمان الأعمال'],
      ['إجمالي المقبوضات النقدية من العميل', fmtNum(sumPaidByClient), curr, 'المحصل فعلياً في الصندوق/البنك'],
      ['مشتريات مواد المشروع الكلية', fmtNum(sumPurTotal), curr, `${purchases.length + projectPurchases.length} فواتير توريد`],
      ['المسدد لموردي المشروع', fmtNum(sumPurPaid), curr, 'المسدد للموردين'],
      ['المتبقي مستحق لموردي المشروع', fmtNum(sumPurRem), curr, 'التزامات قائمة للموردين'],
      ['إجمالي نثريات وعهد المشروع', fmtNum(sumCstTotal), curr, `المصروف منها: ${fmtNum(sumCstSpent)}`],
      ['نسبة الإنجاز الفعلية للمشروع', `${project.progress_percentage || 0}%`, '-', project.status === 'completed' ? 'مكتمل ومسلم' : 'قيد التنفيذ'],
      ['الربح المالي الفعلي المحقق', fmtNum(actualProfitVal), curr, actualProfitVal >= 0 ? 'ربح صافي محقق' : 'عجز / تجاوز تكلفة']
    ];

    const masterKpis = [
      { label: 'القيمة التعاقدية المعدلة', value: `${fmtNum(revisedContractVal)} ${curr}`, color: '#0f2744' },
      { label: 'التكلفة الفعلية المنصرفة', value: `${fmtNum(totalActualCost)} ${curr}`, color: '#dc2626' },
      { label: 'الربح المالي الفعلي المحقق', value: `${fmtNum(actualProfitVal)} ${curr}`, color: actualProfitVal >= 0 ? '#059669' : '#dc2626' },
      { label: 'نسبة الإنجاز', value: `${project.progress_percentage || 0}%`, color: '#2563eb' }
    ];

    const masterXls = buildExcelWorkbook('الملف الشامل للمشروع', `الملف المالي والإداري الشامل لمشروع [${project.code || 'PRJ'}] ${project.name}`, companyInfo, masterKpis, masterHeaders, masterRows, []);
    const masterHtml = buildHtmlReport('الملف المالي والإداري والتنفيذي الشامل للمشروع', `ملخص تنفيذي موحد لكافة المؤشرات المالية والتعاقدية والميدانية`, project.name, project.code, project.client_name, masterKpis, masterHeaders, masterRows, []);

    saveExportFile('00_الملف_المالي_والإداري_الشامل_للمشروع.xls', 'تقارير_المشروع_المصدرة', masterXls);
    saveExportFile('00_الملف_التنفيذي_الشامل_للمشروع.html', 'تقارير_المشروع_المصدرة', masterHtml);

    // ========================================================================
    // أرشيف البيانات الرقمية JSON الخام
    // ========================================================================
    const rawArchive = {
      exportedAt: new Date().toISOString(),
      system: 'نظام رواسي عدن للهندسة والمقاولات',
      project,
      contract,
      bills,
      invoices,
      expenses,
      labor,
      custodies,
      purchases,
      projectPurchases,
      materials,
      projectPayments,
      boq,
      changeOrders,
      settlement
    };

    saveExportFile('بيانات_المشروع_الرقمية.json', 'تقارير_المشروع_المصدرة', JSON.stringify(rawArchive, null, 2));

    // استخراج قائمة الملفات المحدثة
    const allFiles = scanProjectFiles(folderPath);

    res.json({
      success: true,
      message: `تم تصدير وأرشفة كافة ملفات وبيانات المشروع بنجاح إلى مجلده الخاص!`,
      data: {
        projectId: project.id,
        projectCode: project.code,
        projectName: project.name,
        folderPath,
        filesGenerated: generatedFiles.length,
        filesList: generatedFiles,
        totalFilesInFolder: allFiles.length
      }
    });

  } catch (err) {
    console.error('Error exporting project package:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء تصدير حزمة ملفات المشروع: ' + err.message });
  }
});

module.exports = router;
