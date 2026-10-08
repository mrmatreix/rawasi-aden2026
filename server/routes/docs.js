/**
 * مسار توثيق واجهات برمجة التطبيقات (API Documentation & OpenAPI Viewer)
 * يقدم واجهة توثيق تفاعلية خفيفة وذاتية الاستضافة تعمل 100% أوفلاين
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const specPath = path.join(__dirname, '..', 'docs', 'openapi.json');

// 1. تقديم المواصفة الخام JSON
router.get('/docs/spec', (_req, res) => {
  if (fs.existsSync(specPath)) {
    res.sendFile(specPath);
  } else {
    res.status(404).json({ success: false, message: 'مواصفة OpenAPI غير متوفرة' });
  }
});

// 2. تقديم صفحة التوثيق التفاعلية (Interactive Docs UI)
router.get('/docs', (req, res) => {
  res.redirect('/api-docs');
});

module.exports = {
  router,
  renderDocsHtml() {
    let spec = { paths: {}, info: {} };
    try {
      spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (e) {}

    const pathsHtml = Object.entries(spec.paths || {}).map(([endpoint, methods]) => {
      return Object.entries(methods).map(([method, details]) => {
        const mUpper = method.toUpperCase();
        const badgeColor = mUpper === 'GET' ? '#0284c7' : (mUpper === 'POST' ? '#059669' : (mUpper === 'PUT' ? '#d97706' : '#dc2626'));

        const params = details.parameters || [];
        const paramsList = params.map(p => `
          <div style="font-family: monospace; font-size: 0.85rem; padding: 4px 0;">
            <strong style="color: #38bdf8;">${p.name}</strong> 
            <span style="color: #94a3b8;">(${p.in}, ${p.schema?.type || 'string'}${p.required ? ', إلزامي' : ''})</span>
          </div>
        `).join('');

        return `
          <div style="background: #152640; border: 1px solid #223a5e; border-radius: 8px; margin-bottom: 12px; overflow: hidden;">
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #0f1c30; border-bottom: 1px solid #223a5e; cursor: pointer;">
              <span style="background: ${badgeColor}; color: #fff; font-weight: 800; padding: 3px 10px; border-radius: 4px; font-size: 0.78rem; font-family: monospace;">${mUpper}</span>
              <strong style="font-family: monospace; font-size: 0.95rem; color: #f8fafc; direction: ltr;">${endpoint}</strong>
              <span style="color: #94a3b8; font-size: 0.88rem; margin-right: auto;">${details.summary || ''}</span>
            </div>
            <div style="padding: 14px 16px; font-size: 0.88rem;">
              ${params.length > 0 ? `
                <div style="font-weight: 700; color: #f3cf65; margin-bottom: 6px;">المعاملات (Parameters):</div>
                <div style="margin-bottom: 12px; padding-right: 10px;">${paramsList}</div>
              ` : ''}
              ${details.requestBody ? `
                <div style="font-weight: 700; color: #f3cf65; margin-bottom: 4px;">جسم الطلب (Request Body):</div>
                <div style="font-family: monospace; font-size: 0.8rem; background: #09111e; padding: 8px; border-radius: 4px; color: #38bdf8;">application/json</div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }).join('');

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>توثيق API - رواسي عدن للهندسة والمقاولات</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; font-family: system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif; }
    body { background: #09111e; color: #f8fafc; padding: 24px; }
    .container { max-width: 1000px; margin: 0 auto; }
    .header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #d4af37; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; }
    .title { font-size: 1.5rem; color: #f3cf65; font-weight: 800; }
    .badge-ver { background: rgba(212,175,55,0.15); border: 1px solid #d4af37; color: #f3cf65; padding: 4px 12px; border-radius: 20px; font-size: 0.82rem; }
    .btn { background: #10b981; color: #fff; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 0.85rem; font-weight: 700; }
    .search-input { width: 100%; padding: 10px 14px; background: #0f1c30; border: 1px solid #223a5e; border-radius: 8px; color: #fff; margin-bottom: 18px; font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 class="title">دليل وتوثيق واجهات برمجة التطبيقات (API Docs)</h1>
        <p style="color: #94a3b8; font-size: 0.88rem; margin-top: 4px;">نظام شركة رواسي عدن للهندسة والمقاولات - مواصفة OpenAPI 3.0</p>
      </div>
      <div style="display: flex; gap: 10px; align-items: center;">
        <span class="badge-ver">v5.3.0 Enterprise</span>
        <a href="/api/docs/spec" target="_blank" class="btn">تحميل مواصفة JSON ⚡</a>
      </div>
    </div>
    <input type="text" id="apiSearch" class="search-input" placeholder="ابحث عن مسار، معامل، أو خدمة..." onkeyup="filterApi()">
    <div id="apiList">
      ${pathsHtml}
    </div>
  </div>
  <script>
    function filterApi() {
      const q = document.getElementById('apiSearch').value.toLowerCase();
      document.querySelectorAll('#apiList > div').forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
  }
};
