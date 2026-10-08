/**
 * =========================================================================
 * js/excel-export.js
 * وحدة تصدير التقارير والقوائم المالية إلى Microsoft Excel بتنسيق رسمي معتمد
 * لشركة رواسي عدن للهندسة والمقاولات
 * =========================================================================
 * 
 * المبادئ المحاسبية المطبقة:
 * 1. دالة مستقلة ومتخصصة لكل تقرير مالي رسمي.
 * 2. قراءة الأرقام من بيانات الـ API الرسمية مباشرة (Structured API Response) وليس عبر Parsing لنصوص HTML.
 * 3. خلو تام من أي أرقام وهمية أو نسب افتراضية مصطنعة (1,250,000 / 850,000 / 45% إلخ).
 * 4. عند عدم وجود بيانات: تظهر 0 أو "لا توجد بيانات مسجلة".
 * 5. إلغاء أي تحويل تلقائي للتقارير المجهولة إلى أرباح وخسائر (No blind fallbacks).
 */

const ExcelExporter = {
  // جلب معلومات الشركة وإعدادات الترويسة
  getCompanyInfo() {
    let companyName = 'شركة رواسي عدن للهندسة والمقاولات';
    let phone = '773413937';
    let slogan = 'نبني الحاضر لنستثمر المستقبل';
    try {
      const cached = localStorage.getItem('rawasi_print_config');
      if (cached) {
        const c = JSON.parse(cached);
        if (c.header_title) companyName = c.header_title;
        if (c.header_subtitle) phone = c.header_subtitle;
        if (c.slogan) slogan = c.slogan;
      }
    } catch (e) {}
    return { companyName, phone, slogan };
  },

  formatNum(val) {
    if (val === undefined || val === null || val === '') return '0';
    const num = Number(String(val).replace(/[^\d.-]/g, ''));
    if (isNaN(num)) return '0';
    return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  },

  // تنزيل ملف Excel بتنسيق XML/HTML Spreadsheet المعتمد من Microsoft Office
  download(htmlBody, filename, worksheetName = 'التقرير المالي') {
    const cleanFilename = (filename || 'تقرير_رواسي_عدن').replace(/[\\/:*?"<>|]/g, '_') + '.xls';

    const excelTemplate = `
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
                <x:Name>${worksheetName.substring(0, 31)}</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayRightToLeft/>
                  <x:DoNotDisplayGridlines/>
                  <x:Print>
                    <x:ValidPrinterInfo/>
                    <x:PaperSizeIndex>9</x:PaperSizeIndex>
                  </x:Print>
                  <x:Selected/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background-color: #ffffff; margin: 0; padding: 10px; }
          table { border-collapse: collapse; width: 100%; direction: rtl; margin-bottom: 20px; }
          .hdr-company { background-color: #0f2744; color: #d4af37; font-size: 16pt; font-weight: bold; text-align: center; vertical-align: middle; height: 42px; border: 1.5pt solid #0f2744; }
          .hdr-title { background-color: #1a365d; color: #ffffff; font-size: 13pt; font-weight: bold; text-align: center; vertical-align: middle; height: 32px; border: 1pt solid #1a365d; }
          .hdr-meta { background-color: #f1f5f9; color: #334155; font-size: 10pt; text-align: center; vertical-align: middle; height: 24px; border: 0.5pt solid #cbd5e1; }
          .sec-header { background-color: #e2e8f0; color: #0f2744; font-size: 11pt; font-weight: bold; padding: 8px 12px; border: 1pt solid #94a3b8; text-align: right; }
          th { background-color: #1e293b; color: #f8fafc; font-size: 10.5pt; font-weight: bold; text-align: center; vertical-align: middle; padding: 8px 10px; border: 1pt solid #475569; white-space: nowrap; }
          td { font-size: 10pt; padding: 6px 10px; vertical-align: middle; border: 0.5pt solid #cbd5e1; color: #1e293b; text-align: right; }
          .text-center { text-align: center; }
          .text-left { text-align: left; }
          .text-right { text-align: right; }
          .font-bold { font-weight: bold; }
          .row-alt { background-color: #f8fafc; }
          .card-income { background-color: #ecfdf5; color: #047857; font-weight: bold; }
          .card-expense { background-color: #fef2f2; color: #b91c1c; font-weight: bold; }
          .card-profit { background-color: #fffbeb; color: #b45309; font-weight: bold; }
          .row-total { background-color: #f1f5f9; font-weight: bold; font-size: 11pt; border-top: 2pt solid #0f2744; border-bottom: 2pt solid #0f2744; }
          .num { mso-number-format: "\\#\\,\\#\\#0\\.00"; text-align: left; font-family: 'Consolas', monospace; }
          .currency { mso-number-format: "\\#\\,\\#\\#0\\.00\\ \\\"ر\\.ي\\\""; text-align: left; font-family: 'Consolas', monospace; font-weight: bold; }
          .pct { mso-number-format: "0\\.0%"; text-align: center; font-weight: bold; }
          .date-cell { mso-number-format: "yyyy\\-mm\\-dd"; text-align: center; }
          .sig-row td { border: none; padding-top: 25px; padding-bottom: 5px; font-weight: bold; text-align: center; color: #475569; }
        </style>
      </head>
      <body>
        ${htmlBody}
      </body>
      </html>
    `;

    const blob = new Blob(["\uFEFF", excelTemplate], {
      type: 'application/vnd.ms-excel;charset=utf-8'
    });

    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', cleanFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast(`تم تصدير ملف Excel بنجاح: ${cleanFilename} 📊✨`, 'success');
    }
  },

  // =========================================================================
  // 1. تصدير قائمة الأرباح والخسائر الرسمية (Profit & Loss)
  // =========================================================================
  exportProfitLoss(apiData = null) {
    const { companyName, slogan } = this.getCompanyInfo();
    const d = (apiData && apiData.data) ? apiData.data : (window.Reports?.lastReportData['profit-loss']?.data || {});
    const meta = (apiData && apiData.meta) ? apiData.meta : (window.Reports?.lastReportData['profit-loss']?.meta || {});

    const fromDate = meta.from_date || document.getElementById('repPlFromDate')?.value || '2024-01-01';
    const toDate = meta.to_date || document.getElementById('repPlToDate')?.value || new Date().toISOString().split('T')[0];

    const incomeVal = Number(d.total_income ?? d.total_revenues ?? 0);
    const expenseVal = Number(d.total_expenses ?? 0);
    const profitVal = Number(d.net_profit ?? (incomeVal - expenseVal));
    const profitMargin = incomeVal > 0 ? ((profitVal / incomeVal) * 100).toFixed(1) : '0.0';

    const breakdown = d.expenses_breakdown || [];
    const breakdownRows = breakdown.length > 0
      ? breakdown.map((b, idx) => `
          <tr class="${idx % 2 === 1 ? 'row-alt' : ''}">
            <td class="text-center">${idx + 1}</td>
            <td class="font-bold">${b.name || b.expense_type || 'بند مصروف'}</td>
            <td class="currency">${this.formatNum(b.amount || b.total || 0)}</td>
            <td class="text-center font-bold">${b.percentage !== undefined ? b.percentage + '%' : (expenseVal > 0 ? (((b.amount || b.total || 0) / expenseVal) * 100).toFixed(1) + '%' : '0%')}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="4" class="text-center" style="color: #64748b;">لا توجد تفاصيل مصروفات مسجلة لهذه الفترة</td></tr>`;

    const html = `
      <table>
        <tr><td colspan="4" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="4" class="hdr-title">قـائـمـة الأربــاح والـخـسـائـر المعيارية (General Ledger P&L)</td></tr>
        <tr>
          <td colspan="4" class="hdr-meta">
            الفترة: من <strong>${fromDate}</strong> إلى <strong>${toDate}</strong> | المصدر: <strong>دفتر الأستاذ العام</strong> | ${slogan}
          </td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 12px;"></td></tr>

        <tr><td colspan="4" class="sec-header">أولاً: ملخص نتائج النشاط والأرباح</td></tr>
        <tr>
          <th style="width: 8%;">م</th>
          <th style="width: 52%;">البيان المحاسبي</th>
          <th style="width: 25%;">المبلغ (ريال يمني)</th>
          <th style="width: 15%;">النسبة من الإيراد</th>
        </tr>
        <tr class="card-income">
          <td class="text-center">1</td>
          <td class="font-bold">إجمالي الإيرادات المعترف بها (4)</td>
          <td class="currency">${this.formatNum(incomeVal)}</td>
          <td class="text-center font-bold">100.0%</td>
        </tr>
        <tr class="card-expense">
          <td class="text-center">2</td>
          <td class="font-bold">إجمالي التكاليف والمصروفات (3/5)</td>
          <td class="currency">${this.formatNum(expenseVal)}</td>
          <td class="text-center font-bold">${incomeVal > 0 ? ((expenseVal / incomeVal) * 100).toFixed(1) + '%' : '0%'}</td>
        </tr>
        <tr class="row-total card-profit">
          <td class="text-center font-bold">★</td>
          <td class="font-bold" style="font-size: 11.5pt;">صافي الأرباح التشغيلية</td>
          <td class="currency" style="font-size: 11.5pt; color: #b45309;">${this.formatNum(profitVal)}</td>
          <td class="text-center font-bold" style="font-size: 11.5pt; color: #b45309;">هامش ربح: ${profitMargin}%</td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 16px;"></td></tr>

        <tr><td colspan="4" class="sec-header">ثانياً: تفصيل بنود المصروفات من دفتر الأستاذ</td></tr>
        <tr>
          <th>م</th>
          <th>نوع المصروف / البند</th>
          <th>المبلغ (ريال يمني)</th>
          <th>النسبة من المصروفات</th>
        </tr>
        ${breakdownRows}
        <tr class="row-total">
          <td colspan="2" class="text-center font-bold">إجمالي تكاليف ومصروفات الفترة:</td>
          <td class="currency">${this.formatNum(expenseVal)}</td>
          <td class="text-center font-bold">100.0%</td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="2">إعداد المحاسب المالي:<br><br>...........................................</td>
          <td colspan="2">اعتماد المدير العام:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `الأرباح_والخسائر_${fromDate}_إلى_${toDate}`, 'الأرباح والخسائر');
  },

  // =========================================================================
  // 2. تصدير ميزان المراجعة بالأرصدة والمجاميع (Trial Balance)
  // =========================================================================
  exportTrialBalance(apiData = null) {
    const { companyName, slogan } = this.getCompanyInfo();
    const d = (apiData && apiData.data) ? apiData.data : (window.Reports?.lastReportData['trial-balance']?.data || {});
    const meta = (apiData && apiData.meta) ? apiData.meta : (window.Reports?.lastReportData['trial-balance']?.meta || {});

    const fromDate = meta.from_date || document.getElementById('tbFromDate')?.value || '2024-01-01';
    const toDate = meta.to_date || document.getElementById('tbToDate')?.value || new Date().toISOString().split('T')[0];
    const accounts = d.accounts || [];
    const totals = d.totals || {};

    const rows = accounts.length > 0
      ? accounts.map((a, i) => `
          <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
            <td class="text-center font-bold">${a.code || '-'}</td>
            <td class="font-bold">${a.name || '-'}</td>
            <td class="text-center">${a.type || '-'}</td>
            <td class="currency">${this.formatNum(a.opening_debit || 0)}</td>
            <td class="currency">${this.formatNum(a.opening_credit || 0)}</td>
            <td class="currency" style="color: #047857;">${this.formatNum(a.period_debit || 0)}</td>
            <td class="currency" style="color: #0284c7;">${this.formatNum(a.period_credit || 0)}</td>
            <td class="currency font-bold" style="color: #047857;">${this.formatNum(a.closing_debit || 0)}</td>
            <td class="currency font-bold" style="color: #0284c7;">${this.formatNum(a.closing_credit || 0)}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="9" class="text-center" style="color: #64748b;">لا توجد حسابات أو حركات مسجلة</td></tr>`;

    const html = `
      <table>
        <tr><td colspan="9" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="9" class="hdr-title">مـيـزان الـمـراجـعـة بالأرصـدة والـمـجـامـيـع (Trial Balance)</td></tr>
        <tr>
          <td colspan="9" class="hdr-meta">
            الفترة: من <strong>${fromDate}</strong> إلى <strong>${toDate}</strong> | المصدر: <strong>الحسابات الفرعية الأخيرة (Leaf Accounts Only)</strong> | ${slogan}
          </td>
        </tr>
        <tr><td colspan="9" style="border:none; height: 12px;"></td></tr>
        <tr>
          <th rowspan="2">كود الحساب</th>
          <th rowspan="2">اسم الحساب المالي</th>
          <th rowspan="2">النوع</th>
          <th colspan="2" style="background-color: #334155;">الرصيد الافتتاحي</th>
          <th colspan="2" style="background-color: #0369a1;">حركات الفترة</th>
          <th colspan="2" style="background-color: #047857;">الأرصدة الختامية</th>
        </tr>
        <tr>
          <th>مدين</th>
          <th>دائن</th>
          <th>مدين (منه)</th>
          <th>دائن (له)</th>
          <th>رصيد مدين</th>
          <th>رصيد دائن</th>
        </tr>
        ${rows}
        <tr class="row-total">
          <td colspan="3" class="text-center font-bold">الإجمالي الكلي لميزان المراجعة:</td>
          <td class="currency">${this.formatNum(totals.opening_debit || 0)}</td>
          <td class="currency">${this.formatNum(totals.opening_credit || 0)}</td>
          <td class="currency" style="color: #047857;">${this.formatNum(totals.period_debit || totals.total_debit || 0)}</td>
          <td class="currency" style="color: #0284c7;">${this.formatNum(totals.period_credit || totals.total_credit || 0)}</td>
          <td class="currency font-bold" style="color: #047857;">${this.formatNum(totals.closing_debit || totals.balance_debit || 0)}</td>
          <td class="currency font-bold" style="color: #0284c7;">${this.formatNum(totals.closing_credit || totals.balance_credit || 0)}</td>
        </tr>
        <tr><td colspan="9" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="5">إعداد المحاسب المالي:<br><br>...........................................</td>
          <td colspan="4">مراجعة وتدقيق الإدارة المالية:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `ميزان_المراجعة_${fromDate}_إلى_${toDate}`, 'ميزان المراجعة');
  },

  // =========================================================================
  // 3. تصدير قائمة الدخل المعيارية (Income Statement)
  // =========================================================================
  exportIncomeStatement(apiData = null) {
    const { companyName, slogan } = this.getCompanyInfo();
    const d = (apiData && apiData.data) ? apiData.data : (window.Reports?.lastReportData['income-statement']?.data || {});
    const meta = (apiData && apiData.meta) ? apiData.meta : (window.Reports?.lastReportData['income-statement']?.meta || {});

    const fromDate = meta.from_date || document.getElementById('isFromDate')?.value || '2024-01-01';
    const toDate = meta.to_date || document.getElementById('isToDate')?.value || new Date().toISOString().split('T')[0];

    const totalRev = Number(d.total_revenues || 0);
    const directCost = Number(d.direct_costs || 0);
    const grossProfit = Number(d.gross_profit || (totalRev - directCost));
    const opEx = Number(d.operating_expenses || 0);
    const netIncome = Number(d.net_profit || (grossProfit - opEx));

    const revList = (d.revenues || []).map((r, i) => `
      <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
        <td>${r.code ? r.code + ' - ' : ''}${r.name}</td>
        <td class="currency" style="color: #047857;">${this.formatNum(r.amount || 0)}</td>
      </tr>
    `).join('') || `<tr><td colspan="2" class="text-center" style="color:#64748b">لا توجد إيرادات مسجلة</td></tr>`;

    const directList = (d.direct_cost_items || []).map((c, i) => `
      <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
        <td>${c.code ? c.code + ' - ' : ''}${c.name}</td>
        <td class="currency" style="color: #b91c1c;">${this.formatNum(c.amount || 0)}</td>
      </tr>
    `).join('') || `<tr><td colspan="2" class="text-center" style="color:#64748b">لا توجد تكاليف مباشرة مسجلة</td></tr>`;

    const opexList = (d.expense_items || []).map((e, i) => `
      <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
        <td>${e.code ? e.code + ' - ' : ''}${e.name}</td>
        <td class="currency" style="color: #b91c1c;">${this.formatNum(e.amount || 0)}</td>
      </tr>
    `).join('') || `<tr><td colspan="2" class="text-center" style="color:#64748b">لا توجد مصروفات تشغيلية مسجلة</td></tr>`;

    const html = `
      <table>
        <tr><td colspan="2" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="2" class="hdr-title">قـائـمـة الـدخـل الـمـعـيـاريـة (Income Statement)</td></tr>
        <tr>
          <td colspan="2" class="hdr-meta">
            الفترة المحاسبية: من <strong>${fromDate}</strong> إلى <strong>${toDate}</strong> | ${slogan}
          </td>
        </tr>
        <tr><td colspan="2" style="border:none; height: 12px;"></td></tr>

        <tr><td colspan="2" class="sec-header">1. الإيرادات التشغيلية وإثبات الـ POC</td></tr>
        <tr><th>بيان بند الإيراد</th><th style="width: 35%;">المبلغ (ريال يمني)</th></tr>
        ${revList}
        <tr class="row-total card-income">
          <td>إجمالي الإيرادات (1):</td>
          <td class="currency">${this.formatNum(totalRev)}</td>
        </tr>

        <tr><td colspan="2" style="border:none; height: 12px;"></td></tr>
        <tr><td colspan="2" class="sec-header">2. تكلفة الإيراد المباشرة (Direct Project Costs)</td></tr>
        <tr><th>بيان بند التكلفة</th><th>المبلغ (ريال يمني)</th></tr>
        ${directList}
        <tr class="row-total card-expense">
          <td>إجمالي تكلفة الإيراد المباشرة (2):</td>
          <td class="currency">${this.formatNum(directCost)}</td>
        </tr>

        <tr class="row-total card-profit" style="font-size: 11.5pt;">
          <td>مجمل الربح (1 - 2):</td>
          <td class="currency">${this.formatNum(grossProfit)}</td>
        </tr>

        <tr><td colspan="2" style="border:none; height: 12px;"></td></tr>
        <tr><td colspan="2" class="sec-header">3. المصروفات التشغيلية والإدارية والعمومية (OpEx)</td></tr>
        <tr><th>بيان بند المصروف</th><th>المبلغ (ريال يمني)</th></tr>
        ${opexList}
        <tr class="row-total card-expense">
          <td>إجمالي المصروفات التشغيلية (3):</td>
          <td class="currency">${this.formatNum(opEx)}</td>
        </tr>

        <tr class="row-total card-profit" style="font-size: 13pt; background-color: #fef3c7; border: 2pt solid #b45309;">
          <td>صافي الدخل / الربح النهائي قبل الضرائب:</td>
          <td class="currency" style="color: #047857;">${this.formatNum(netIncome)}</td>
        </tr>

        <tr><td colspan="2" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td>المحاسب المالي:<br><br>...........................................</td>
          <td>اعتماد المدير العام:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `قائمة_الدخل_${fromDate}_إلى_${toDate}`, 'قائمة الدخل');
  },

  // =========================================================================
  // 4. تصدير الميزانية العمومية والمركز المالي (Balance Sheet)
  // =========================================================================
  exportBalanceSheet(apiData = null) {
    const { companyName, slogan } = this.getCompanyInfo();
    const d = (apiData && apiData.data) ? apiData.data : (window.Reports?.lastReportData['balance-sheet']?.data || {});
    const meta = (apiData && apiData.meta) ? apiData.meta : (window.Reports?.lastReportData['balance-sheet']?.meta || {});

    const asOfDate = meta.as_of_date || document.getElementById('bsAsOfDate')?.value || new Date().toISOString().split('T')[0];
    const assets = d.assets || [];
    const liabilities = d.liabilities || [];
    const equity = d.equity || [];
    const totals = d.totals || {};

    const liabEquityCombined = [...liabilities, ...equity];
    const maxRows = Math.max(assets.length, liabEquityCombined.length, 1);
    let combinedRows = '';

    for (let i = 0; i < maxRows; i++) {
      const a = assets[i] || { name: '', balance: '' };
      const l = liabEquityCombined[i] || { name: '', balance: '' };
      combinedRows += `
        <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
          <td class="font-bold">${a.code ? a.code + ' - ' : ''}${a.name}</td>
          <td class="currency">${a.balance !== '' ? this.formatNum(a.balance) : ''}</td>
          <td class="font-bold" style="border-right: 2pt solid #0f2744;">${l.code ? l.code + ' - ' : ''}${l.name}</td>
          <td class="currency">${l.balance !== '' ? this.formatNum(l.balance) : ''}</td>
        </tr>
      `;
    }

    const html = `
      <table>
        <tr><td colspan="4" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="4" class="hdr-title">قائمة الميزانية العمومية والمركز المالي (Balance Sheet)</td></tr>
        <tr>
          <td colspan="4" class="hdr-meta">
            حتى تاريخ: <strong>${asOfDate}</strong> | المصدر: <strong>دفتر الأستاذ العام (General Ledger)</strong> | ${slogan}
          </td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 12px;"></td></tr>
        <tr>
          <th colspan="2" style="background-color: #047857; width: 50%;">الأصــول والـمـوجــودات (1 - Assets)</th>
          <th colspan="2" style="background-color: #b91c1c; width: 50%;">الالتـزامـات وحـقـوق المـلـكـيـة (2 - Liabilities & Equity)</th>
        </tr>
        <tr>
          <th style="width: 32%;">اسم الحساب (الفرعي الأخير)</th>
          <th style="width: 18%;">الرصيد المدين</th>
          <th style="width: 32%;">اسم الحساب (الفرعي الأخير)</th>
          <th style="width: 18%;">الرصيد الدائن</th>
        </tr>
        ${combinedRows}
        <tr class="row-total">
          <td class="text-center font-bold">إجمالي الأصول:</td>
          <td class="currency" style="color: #047857;">${this.formatNum(totals.assets || 0)}</td>
          <td class="text-center font-bold" style="border-right: 2pt solid #0f2744;">إجمالي الخصوم وحقوق الملكية:</td>
          <td class="currency" style="color: #b91c1c;">${this.formatNum(totals.liabilities_plus_equity || 0)}</td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="2">إعداد المحاسب المالي:<br><br>...........................................</td>
          <td colspan="2">اعتماد الإدارة العامة:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `الميزانية_العمومية_${asOfDate}`, 'الميزانية العمومية');
  },

  // =========================================================================
  // 5. تصدير قائمة التدفقات النقدية (Cash Flow Statement)
  // =========================================================================
  exportCashFlow(apiData = null) {
    const { companyName, slogan } = this.getCompanyInfo();
    const d = (apiData && apiData.data) ? apiData.data : (window.Reports?.lastReportData['cash-flow']?.data || {});
    const meta = (apiData && apiData.meta) ? apiData.meta : (window.Reports?.lastReportData['cash-flow']?.meta || {});

    const fromDate = meta.from_date || document.getElementById('cfFromDate')?.value || '2024-01-01';
    const toDate = meta.to_date || document.getElementById('cfToDate')?.value || new Date().toISOString().split('T')[0];

    const op = d.operating_activities || { inflows: [], outflows: [], net: 0 };
    const inv = d.investing_activities || { inflows: [], outflows: [], net: 0 };
    const fin = d.financing_activities || { inflows: [], outflows: [], net: 0 };

    const renderActivityRows = (title, act) => {
      let rows = `<tr><td colspan="4" class="sec-header">${title}</td></tr>`;
      (act.inflows || []).forEach(item => {
        rows += `
          <tr>
            <td>${item.item}</td>
            <td class="currency" style="color: #047857;">${this.formatNum(item.amount)}</td>
            <td class="currency">-</td>
            <td class="currency font-bold" style="color: #047857;">+${this.formatNum(item.amount)}</td>
          </tr>
        `;
      });
      (act.outflows || []).forEach(item => {
        rows += `
          <tr>
            <td>${item.item}</td>
            <td class="currency">-</td>
            <td class="currency" style="color: #b91c1c;">${this.formatNum(item.amount)}</td>
            <td class="currency font-bold" style="color: #b91c1c;">-${this.formatNum(item.amount)}</td>
          </tr>
        `;
      });
      rows += `
        <tr class="row-total" style="background-color: #f8fafc;">
          <td>صافي النقد من ${title.split(':')[1] || title}:</td>
          <td colspan="2"></td>
          <td class="currency font-bold" style="font-size: 11pt; color: ${act.net >= 0 ? '#047857' : '#b91c1c'}">${this.formatNum(act.net || 0)}</td>
        </tr>
      `;
      return rows;
    };

    const html = `
      <table>
        <tr><td colspan="4" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="4" class="hdr-title">قـائـمـة الـتـدفـقـات الـنـقـديـة الـفـعـلـيـة (Cash Flow Statement)</td></tr>
        <tr>
          <td colspan="4" class="hdr-meta">
            الفترة: من <strong>${fromDate}</strong> إلى <strong>${toDate}</strong> | المصدر: <strong>حسابات النقدية والبنوك في الأستاذ العام</strong> | ${slogan}
          </td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 12px;"></td></tr>
        <tr class="card-profit">
          <td colspan="3" class="font-bold">رصيد النقدية والبنوك في بداية الفترة (الافتتاحي):</td>
          <td class="currency">${this.formatNum(d.opening_balance || 0)}</td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 8px;"></td></tr>
        <tr>
          <th style="width: 45%;">بيان التدفق النقدي</th>
          <th style="width: 18%;">مقبوضات نقدية (+)</th>
          <th style="width: 18%;">مدفوعات نقدية (-)</th>
          <th style="width: 19%;">الصافي (ريال يمني)</th>
        </tr>
        ${renderActivityRows('أولاً: التدفقات النقدية من الأنشطة التشغيلية', op)}
        ${renderActivityRows('ثانياً: التدفقات النقدية من الأنشطة الاستثمارية', inv)}
        ${renderActivityRows('ثالثاً: التدفقات النقدية من الأنشطة التمويلية', fin)}
        <tr class="row-total" style="font-size: 11.5pt; background-color: #f1f5f9;">
          <td colspan="3" class="font-bold">صافي التغير في النقدية خلال الفترة:</td>
          <td class="currency">${this.formatNum(d.net_cash_change || 0)}</td>
        </tr>
        <tr class="row-total card-profit" style="font-size: 12pt; background-color: #fef3c7; border: 2pt solid #b45309;">
          <td colspan="3" class="font-bold">رصيد النقدية والبنوك في نهاية الفترة:</td>
          <td class="currency" style="color: #047857;">${this.formatNum(d.closing_balance || 0)}</td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="2">إعداد المحاسب المالي:<br><br>...........................................</td>
          <td colspan="2">اعتماد المدير العام:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `التدفقات_النقدية_${fromDate}_إلى_${toDate}`, 'التدفقات النقدية');
  },

  // =========================================================================
  // 6. تصدير ربحية المشاريع (Projects Profitability)
  // =========================================================================
  exportProjectsProfitability(apiData = null) {
    const { companyName, slogan } = this.getCompanyInfo();
    const today = new Date().toISOString().split('T')[0];
    const list = (apiData && apiData.data) ? apiData.data : (window.Reports?.lastReportData['projects-profitability']?.data || []);

    if (!list || list.length === 0) {
      if (typeof App !== 'undefined' && App.showToast) App.showToast('لا توجد بيانات مشاريع لتصديرها', 'warning');
      return;
    }

    let totContract = 0;
    let totCost = 0;
    let totRecRev = 0;
    let totProfit = 0;

    const rows = list.map((p, i) => {
      const cVal = Number(p.contract_value || 0);
      const cost = Number(p.actual_cost || 0);
      const rec = Number(p.recognized_revenue || 0);
      const profit = Number(p.calculated_actual_profit || 0);
      totContract += cVal;
      totCost += cost;
      totRecRev += rec;
      totProfit += profit;

      return `
        <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
          <td class="text-center">${i + 1}</td>
          <td class="font-bold">${p.name} (${p.code})</td>
          <td>${p.client_name || '-'}</td>
          <td class="currency">${this.formatNum(cVal)}</td>
          <td class="currency" style="color: #b91c1c;">${this.formatNum(cost)}</td>
          <td class="currency" style="color: #0284c7;">${this.formatNum(rec)}</td>
          <td class="currency font-bold" style="color: ${profit >= 0 ? '#047857' : '#b91c1c'}">${this.formatNum(profit)}</td>
          <td class="text-center font-bold">${p.profit_margin_percentage || 0}%</td>
          <td class="text-center">${p.progress_percentage || 0}%</td>
        </tr>
      `;
    }).join('');

    const avgMargin = totRecRev > 0 ? ((totProfit / totRecRev) * 100).toFixed(1) : (totContract > 0 ? ((totProfit / totContract) * 100).toFixed(1) : '0.0');

    const html = `
      <table>
        <tr><td colspan="9" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="9" class="hdr-title">تقرير تحليل ربحية وأداء المشاريع الهندسية</td></tr>
        <tr><td colspan="9" class="hdr-meta">تاريخ التقرير: <strong>${today}</strong> | المصدر: <strong>إيرادات POC وتكاليف الأستاذ العام</strong> | ${slogan}</td></tr>
        <tr><td colspan="9" style="border:none; height: 12px;"></td></tr>
        <tr>
          <th>م</th>
          <th>اسم المشروع وكوده</th>
          <th>العميل</th>
          <th>قيمة العقد</th>
          <th>التكلفة الفعلية</th>
          <th>الإيراد المعترف به</th>
          <th>صافي الربح الفعلي</th>
          <th>هامش الربح %</th>
          <th>نسبة الإنجاز</th>
        </tr>
        ${rows}
        <tr class="row-total">
          <td colspan="3" class="text-center font-bold">الإجمالي العام:</td>
          <td class="currency">${this.formatNum(totContract)}</td>
          <td class="currency" style="color: #b91c1c;">${this.formatNum(totCost)}</td>
          <td class="currency" style="color: #0284c7;">${this.formatNum(totRecRev)}</td>
          <td class="currency font-bold" style="color: #047857;">${this.formatNum(totProfit)}</td>
          <td class="text-center font-bold">${avgMargin}%</td>
          <td class="text-center">-</td>
        </tr>
        <tr><td colspan="9" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="5">المحاسب المالي:<br><br>...........................................</td>
          <td colspan="4">مدير إدارة المشاريع:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `ربحية_المشاريع_${today}`, 'ربحية المشاريع');
  },

  // =========================================================================
  // 7. تصدير ربحية مراكز التكلفة (Cost Centers Profitability)
  // =========================================================================
  exportCostCentersProfitability(apiData = null) {
    const { companyName, slogan } = this.getCompanyInfo();
    const today = new Date().toISOString().split('T')[0];
    const d = (apiData && apiData.data) ? apiData.data : (window.Reports?.lastReportData['cost-centers-profitability']?.data || {});
    const centers = d.centers || [];
    const totals = d.totals || {};

    if (!centers || centers.length === 0) {
      if (typeof App !== 'undefined' && App.showToast) App.showToast('لا توجد بيانات مراكز تكلفة لتصديرها', 'warning');
      return;
    }

    const rows = centers.map((c, i) => `
      <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
        <td class="text-center font-bold">${c.code || '-'}</td>
        <td class="font-bold">${c.name || '-'}</td>
        <td class="text-center">${c.type || '-'}</td>
        <td>${c.project_name || '-'}</td>
        <td class="currency" style="color: #0284c7;">${this.formatNum(c.total_revenue || 0)}</td>
        <td class="currency" style="color: #b91c1c;">${this.formatNum(c.total_expense || 0)}</td>
        <td class="currency font-bold" style="color: ${c.net_profit >= 0 ? '#047857' : '#b91c1c'};">${this.formatNum(c.net_profit || 0)}</td>
        <td class="text-center font-bold">${c.profit_margin || 0}%</td>
      </tr>
    `).join('');

    const html = `
      <table>
        <tr><td colspan="8" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="8" class="hdr-title">تقرير أداء وربحية مراكز التكلفة والمشاريع</td></tr>
        <tr><td colspan="8" class="hdr-meta">تاريخ التقرير: <strong>${today}</strong> | المصدر: <strong>دفتر الأستاذ العام ومراكز التكلفة</strong> | ${slogan}</td></tr>
        <tr><td colspan="8" style="border:none; height: 12px;"></td></tr>
        <tr>
          <th>كود المركز</th>
          <th>اسم مركز التكلفة</th>
          <th>النوع</th>
          <th>المشروع المرتبط</th>
          <th>إجمالي الإيرادات</th>
          <th>إجمالي المصروفات</th>
          <th>صافي الفائض / الربح</th>
          <th>هامش الربح %</th>
        </tr>
        ${rows}
        <tr class="row-total">
          <td colspan="4" class="text-center font-bold">الإجمالي العام لمراكز التكلفة:</td>
          <td class="currency" style="color: #0284c7;">${this.formatNum(totals.total_revenue || 0)}</td>
          <td class="currency" style="color: #b91c1c;">${this.formatNum(totals.total_expense || 0)}</td>
          <td class="currency font-bold" style="color: #047857;">${this.formatNum(totals.net_profit || 0)}</td>
          <td class="text-center font-bold">${totals.overall_margin || 0}%</td>
        </tr>
        <tr><td colspan="8" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="4">المحاسب المسؤول:<br><br>...........................................</td>
          <td colspan="4">مدير الحسابات العامة:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `ربحية_مراكز_التكلفة_${today}`, 'مراكز التكلفة');
  },

  // =========================================================================
  // 8. تصدير كشف حساب عميل مفصل (Client Statement)
  // =========================================================================
  exportClientStatement(apiData = null) {
    const { companyName } = this.getCompanyInfo();
    const today = new Date().toISOString().split('T')[0];
    const d = (apiData && apiData.data) ? apiData.data : (window.Reports?.lastReportData['client-statement']?.data || {});
    const client = d.client || {};
    const statement = d.statement || [];
    const summary = d.summary || {};

    if (!statement || statement.length === 0) {
      if (typeof App !== 'undefined' && App.showToast) App.showToast('يرجى عرض كشف حساب العميل أولاً قبل التصدير', 'warning');
      return;
    }

    const rows = statement.map((s, i) => `
      <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
        <td class="text-center">${i + 1}</td>
        <td class="date-cell">${s.date || '-'}</td>
        <td class="font-bold">${s.type || '-'}</td>
        <td class="text-center">${s.ref || '-'}</td>
        <td>${s.project_name || '-'}</td>
        <td class="currency" style="color: #b91c1c;">${s.debit ? this.formatNum(s.debit) : '-'}</td>
        <td class="currency" style="color: #047857;">${s.credit ? this.formatNum(s.credit) : '-'}</td>
        <td class="currency font-bold">${this.formatNum(s.running_balance || 0)}</td>
        <td>${s.notes || '-'}</td>
      </tr>
    `).join('');

    const html = `
      <table>
        <tr><td colspan="9" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="9" class="hdr-title">كـشـف حـسـاب عـمـيـل مـفـصـل ومـطـابـق للأستـاذ</td></tr>
        <tr>
          <td colspan="9" class="hdr-meta">
            العميل: <strong>${client.name || 'عميل'}</strong> | الهاتف: <strong>${client.phone || '-'}</strong> | تاريخ التصدير: <strong>${today}</strong>
          </td>
        </tr>
        <tr><td colspan="9" style="border:none; height: 12px;"></td></tr>
        <tr>
          <th>م</th>
          <th>التاريخ</th>
          <th>نوع الحركة</th>
          <th>المرجع / السند</th>
          <th>المشروع / العقد</th>
          <th>مدين (عقد/مستخلص)</th>
          <th>دائن (سداد/قبض)</th>
          <th>الرصيد المستحق</th>
          <th>البيان والملاحظات</th>
        </tr>
        ${rows}
        <tr class="row-total">
          <td colspan="5" class="text-center font-bold">الإجمالي العام لكشف الحساب:</td>
          <td class="currency" style="color: #b91c1c;">${this.formatNum(summary.total_invoiced || 0)}</td>
          <td class="currency" style="color: #047857;">${this.formatNum(summary.total_collected || 0)}</td>
          <td class="currency font-bold" style="font-size: 11pt; color: #b45309;">${this.formatNum(summary.outstanding_balance || 0)}</td>
          <td>${summary.outstanding_balance === 0 ? 'الحساب مسوى بالكامل ✓' : 'رصيد متبقي'}</td>
        </tr>
        <tr><td colspan="9" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="5">المحاسب المسؤول:<br><br>...........................................</td>
          <td colspan="4">مصادقة وتوقيع العميل:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `كشف_حساب_${(client.name || 'عميل').replace(/\s+/g, '_')}_${today}`, 'كشف حساب عميل');
  },

  // =========================================================================
  // 9. تصدير كشف حساب مورد مفصل (Supplier Statement)
  // =========================================================================
  exportSupplierStatement(apiData = null) {
    const { companyName } = this.getCompanyInfo();
    const today = new Date().toISOString().split('T')[0];
    const d = (apiData && apiData.data) ? apiData.data : (window.Reports?.lastReportData['supplier-statement']?.data || {});
    const supplier = d.supplier || {};
    const statement = d.statement || [];
    const summary = d.summary || {};

    if (!statement || statement.length === 0) {
      if (typeof App !== 'undefined' && App.showToast) App.showToast('يرجى عرض كشف حساب المورد أولاً قبل التصدير', 'warning');
      return;
    }

    const rows = statement.map((s, i) => `
      <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
        <td class="text-center">${i + 1}</td>
        <td class="date-cell">${s.date || '-'}</td>
        <td class="font-bold">${s.type || '-'}</td>
        <td class="text-center">${s.ref || '-'}</td>
        <td class="currency" style="color: #047857;">${s.credit ? this.formatNum(s.credit) : '-'}</td>
        <td class="currency" style="color: #b91c1c;">${s.debit ? this.formatNum(s.debit) : '-'}</td>
        <td class="currency font-bold">${this.formatNum(s.running_balance || 0)}</td>
        <td>${s.notes || '-'}</td>
      </tr>
    `).join('');

    const html = `
      <table>
        <tr><td colspan="8" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="8" class="hdr-title">كـشـف حـسـاب مـورد مـفـصـل ومـطـابـق للأستـاذ</td></tr>
        <tr>
          <td colspan="8" class="hdr-meta">
            المورد: <strong>${supplier.name || 'مورد'}</strong> | الهاتف: <strong>${supplier.phone || '-'}</strong> | تاريخ التصدير: <strong>${today}</strong>
          </td>
        </tr>
        <tr><td colspan="8" style="border:none; height: 12px;"></td></tr>
        <tr>
          <th>م</th>
          <th>التاريخ</th>
          <th>نوع الحركة</th>
          <th>المرجع</th>
          <th>دائن (استحقاق له)</th>
          <th>مدين (مسدد له)</th>
          <th>الرصيد التراكمي</th>
          <th>البيان والملاحظات</th>
        </tr>
        ${rows}
        <tr class="row-total">
          <td colspan="4" class="text-center font-bold">الإجمالي العام لكشف الحساب:</td>
          <td class="currency" style="color: #047857;">${this.formatNum(summary.total_invoiced || 0)}</td>
          <td class="currency" style="color: #b91c1c;">${this.formatNum(summary.total_paid || 0)}</td>
          <td class="currency font-bold" style="font-size: 11pt; color: #b45309;">${this.formatNum(summary.outstanding_balance || 0)}</td>
          <td>${summary.outstanding_balance === 0 ? 'الحساب مسوى بالكامل ✓' : 'رصيد متبقي للمورد'}</td>
        </tr>
        <tr><td colspan="8" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="4">المحاسب المسؤول:<br><br>...........................................</td>
          <td colspan="4">مطابقة واعتماد المورد:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `كشف_حساب_مورد_${(supplier.name || 'مورد').replace(/\s+/g, '_')}_${today}`, 'كشف حساب مورد');
  }
};

window.ExcelExporter = ExcelExporter;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExcelExporter;
}
